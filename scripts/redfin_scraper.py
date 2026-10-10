#!/usr/bin/env python3
"""Collect Redfin search or property pages into a UTF-8 CSV.

Prices are for-sale listing prices, never monthly rent. Database, UI, and
provider-based fetching are out of scope.
"""

import argparse
import csv
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import requests
from bs4 import BeautifulSoup

SOURCE_NAME = "Redfin"
DEFAULT_SEARCH_URL = "https://www.redfin.com/city/30749/NY/New-York/filter/status=active"
DEFAULT_PROPERTY_URL = "https://www.redfin.com/NY/New-York/112-E-35th-St-10016/home/45333496"
DEFAULT_TIMEOUT = 20
MAX_TIMEOUT = 60
DEFAULT_LIMIT = 40
MAX_LIMIT = 100
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)
COLUMNS = [
    "price",
    "configuration",
    "address",
    "broker",
    "property_url",
    "availability",
    "listing_status",
    "description",
    "source_name",
    "source_page_url",
    "collected_at",
]
TRUE_STATUSES = {
    "active",
    "for sale",
    "for-sale",
    "available",
    "on market",
    "on-market",
}
FALSE_STATUSES = {
    "sold",
    "off market",
    "off-market",
    "not available",
    "unavailable",
    "withdrawn",
    "expired",
    "closed",
    "delisted",
}
CHALLENGE_TITLE = (
    "captcha",
    "access denied",
    "verify you are a human",
    "are you a robot",
    "pardon our interruption",
    "unusual traffic",
    "datadome",
    "px-captcha",
)
CARD_CLASS = "HomeCardContainer"
PRICE_CLASS = "homecardV2Price"
CONFIG_CLASS = "HomeStatsV2"
ADDRESS_CLASS = "homeAddressV2"
BROKER_CLASS = "brokerageDisclaimerV2"


class ScraperError(Exception):
    pass


def collapse(text):
    return " ".join((text or "").split())


def clean_multiline(text):
    lines = [" ".join(line.split()) for line in (text or "").replace("\r\n", "\n").split("\n")]
    return "\n".join(line for line in lines if line).strip()


def class_tokens(tag):
    raw = tag.get("class") or []
    if isinstance(raw, str):
        return raw.split()
    return list(raw)


def has_class(tag, name):
    return any(token == name or token.startswith(name) for token in class_tokens(tag))


def find_class(scope, name, tag_name=None):
    return scope.find(lambda tag: (tag_name is None or tag.name == tag_name) and has_class(tag, name))


def find_all_class(scope, name, tag_name=None):
    return scope.find_all(lambda tag: (tag_name is None or tag.name == tag_name) and has_class(tag, name))


def test_id(scope, value):
    return scope.find(attrs={"data-rf-test-id": value})


def text_of(tag, multiline=False):
    if tag is None:
        return ""
    raw = tag.get_text("\n" if multiline else " ", strip=True)
    return clean_multiline(raw) if multiline else collapse(raw)


def validate_url(url):
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    if parts.scheme != "https" or host not in {"redfin.com", "www.redfin.com"}:
        raise ScraperError(
            "Only https://www.redfin.com URLs are accepted. Certificate verification stays enabled."
        )
    return url


def canonical_property_url(href):
    if not href:
        return ""
    href = href.strip()
    if href.startswith("//"):
        href = "https:" + href
    elif href.startswith("/"):
        href = "https://www.redfin.com" + href
    parts = urlsplit(href)
    host = (parts.hostname or "").lower()
    if parts.scheme not in {"http", "https"} or host not in {"redfin.com", "www.redfin.com"}:
        return ""
    if "/home/" not in parts.path:
        return ""
    path = parts.path.rstrip("/") or "/"
    return urlunsplit(("https", "www.redfin.com", path, "", ""))


def format_amount(amount):
    if isinstance(amount, bool) or not isinstance(amount, (int, float)):
        return ""
    if isinstance(amount, float) and not amount.is_integer():
        return f"${amount:,.2f}"
    return f"${int(amount):,}"


def availability_from_status(status):
    normalized = collapse(status).lower()
    if not normalized:
        return ""
    if normalized in TRUE_STATUSES:
        return "true"
    if normalized in FALSE_STATUSES:
        return "false"
    return ""


def blank_record():
    return {
        "price": "",
        "configuration": "",
        "address": "",
        "broker": "",
        "property_url": "",
        "availability": "",
        "listing_status": "",
        "description": "",
    }


def useful(record):
    return any(record.get(key) for key in ("price", "configuration", "address", "broker", "listing_status", "description"))


def display_count(value):
    if isinstance(value, bool):
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, int):
        return str(value)
    return collapse(str(value))


def config_from_parts(beds, baths, sqft):
    parts = []
    if beds not in (None, ""):
        parts.append(f"{display_count(beds)} beds")
    if baths not in (None, ""):
        parts.append(f"{display_count(baths)} baths")
    if sqft not in (None, ""):
        if isinstance(sqft, (int, float)) and not isinstance(sqft, bool):
            number = int(sqft) if float(sqft).is_integer() else sqft
            sqft = f"{number:,}"
        parts.append(f"{sqft} sq ft")
    return " ".join(parts)


def first_string(mapping, *keys):
    for key in keys:
        value = mapping.get(key)
        if isinstance(value, str) and collapse(value):
            return collapse(value)
    return ""


def nested_amount(mapping):
    info = mapping.get("priceInfo")
    if isinstance(info, dict):
        display = first_string(info, "display", "formattedPrice", "price")
        if display:
            return display
        formatted = format_amount(info.get("amount"))
        if formatted:
            return formatted
    for key in ("listingPrice", "amount"):
        formatted = format_amount(mapping.get(key))
        if formatted:
            return formatted
    return ""


def price_from_value(value):
    if isinstance(value, dict):
        display = first_string(value, "display", "formattedPrice", "text")
        if display:
            return display
        amount = value.get("value", value.get("amount"))
        return format_amount(amount)
    if isinstance(value, str):
        return collapse(value)
    return format_amount(value)


def price_from_mapping(mapping):
    if mapping.get("hideSalePrice") is True:
        return ""
    for key in ("formattedPrice", "displayPrice", "price", "priceInfo", "latestPriceInfo", "listingPrice"):
        if key not in mapping:
            continue
        text = price_from_value(mapping.get(key))
        if text:
            return text
    return nested_amount(mapping)


def street_from_object(street_obj):
    if isinstance(street_obj, str):
        return collapse(street_obj)
    if not isinstance(street_obj, dict):
        return ""
    assembled = first_string(street_obj, "assembledAddress", "streetLine")
    if assembled:
        return assembled
    parts = [
        first_string(street_obj, "streetNumber"),
        first_string(street_obj, "directionalPrefix"),
        first_string(street_obj, "streetName"),
        first_string(street_obj, "streetType"),
    ]
    street = " ".join(part for part in parts if part)
    unit = first_string(street_obj, "unitValue")
    if unit:
        street = f"{street} #{unit}" if street else unit
    return street


def address_from_mapping(mapping):
    direct = mapping.get("address")
    if isinstance(direct, str) and collapse(direct):
        return collapse(direct)
    info = mapping.get("addressInfo") if isinstance(mapping.get("addressInfo"), dict) else {}
    if not info and isinstance(mapping.get("addressSectionInfo"), dict):
        info = mapping["addressSectionInfo"]
    street = street_from_object(mapping.get("streetAddress")) or street_from_object(info.get("streetAddress"))
    if not street:
        street = first_string(info, "formattedStreetLine", "assembledAddress", "streetLine") or first_string(
            mapping, "streetLine", "formattedStreetLine"
        )
    city = first_string(info, "city") or first_string(mapping, "city")
    state = first_string(info, "state") or first_string(mapping, "state")
    postal = first_string(info, "zip", "postalCode") or first_string(mapping, "zip", "postalCode")
    locality = f"{city}, {state}" if city and state else " ".join(part for part in (city, state) if part)
    if postal:
        locality = f"{locality} {postal}".strip()
    return collapse(", ".join(part for part in (street, locality) if part))


def broker_from_mapping(mapping):
    broker = mapping.get("listingBroker") or mapping.get("sellingBroker") or mapping.get("listingAgent")
    if isinstance(broker, dict):
        name = first_string(broker, "name", "brokerName")
        if name:
            return name
    return first_string(mapping, "brokerageName", "broker", "listingBrokerName")


def status_from_mapping(mapping):
    status = mapping.get("status")
    if isinstance(status, dict):
        text = first_string(status, "displayValue", "value", "text")
        if text:
            return text
    if isinstance(status, str):
        return collapse(status)
    return first_string(mapping, "mlsStatus", "listingStatus", "homeStatusLabel", "searchStatus")


def description_from_mapping(mapping):
    remarks = mapping.get("marketingRemarks") or mapping.get("listingRemarks")
    if isinstance(remarks, list):
        chunks = []
        for item in remarks:
            if isinstance(item, str) and collapse(item):
                chunks.append(collapse(item))
            elif isinstance(item, dict):
                text = first_string(item, "marketingRemark", "remark", "text")
                if text:
                    chunks.append(text)
        if chunks:
            return "\n".join(chunks)
    if isinstance(remarks, str) and clean_multiline(remarks):
        return clean_multiline(remarks)
    return first_string(mapping, "publicRemarks", "remarks", "description", "about")


def sqft_value(mapping):
    raw = mapping.get("sqFt")
    if isinstance(raw, dict):
        return raw.get("value")
    return raw if raw is not None else mapping.get("sqft")


def record_from_mapping(mapping):
    if not isinstance(mapping, dict):
        return None
    home = mapping.get("homeData") if isinstance(mapping.get("homeData"), dict) else mapping
    record = blank_record()
    record["price"] = price_from_mapping(home)
    record["configuration"] = config_from_parts(home.get("beds"), home.get("baths"), sqft_value(home))
    record["address"] = address_from_mapping(home)
    record["broker"] = broker_from_mapping(home)
    record["property_url"] = canonical_property_url(
        first_string(home, "url", "urlPath", "propertyUrl", "listingUrl")
    )
    record["listing_status"] = status_from_mapping(home)
    record["availability"] = availability_from_status(record["listing_status"])
    record["description"] = description_from_mapping(home)
    record["beds"] = home.get("beds")
    record["baths"] = home.get("baths")
    record["property_type"] = first_string(home, "propertyType", "uiPropertyType")
    point = home.get("latLong") if isinstance(home.get("latLong"), dict) else {}
    record["lat"] = point.get("latitude", home.get("latitude"))
    record["lng"] = point.get("longitude", home.get("longitude"))
    if not useful(record):
        return None
    if record["property_url"] == "" and not any(record[key] for key in ("price", "address", "description", "listing_status")):
        return None
    return record


def decode_stingray(value):
    if isinstance(value, str) and value.startswith("{}&&"):
        try:
            return json.loads(value[4:])
        except json.JSONDecodeError:
            return value
    return value


def normalize_tree(node):
    node = decode_stingray(node)
    if isinstance(node, dict):
        return {key: normalize_tree(value) for key, value in node.items()}
    if isinstance(node, list):
        return [normalize_tree(value) for value in node]
    return node


def json_objects_from_text(text):
    stripped = text.strip()
    if not stripped:
        return []
    if stripped[0] in "[{":
        try:
            return [json.loads(stripped)]
        except json.JSONDecodeError:
            pass
    decoder = json.JSONDecoder()
    found = []
    index = 0
    while index < len(text):
        start = text.find("{", index)
        if start < 0:
            break
        try:
            obj, end = decoder.raw_decode(text, start)
        except json.JSONDecodeError:
            index = start + 1
            continue
        if isinstance(obj, (dict, list)):
            found.append(obj)
        index = end
    return found


def script_is_relevant(script):
    identity = " ".join(
        [
            script.get("id") or "",
            script.get("type") or "",
            " ".join(class_tokens(script)),
        ]
    ).lower()
    if script.get("type") == "application/json":
        return True
    if any(token in identity for token in ("initialcontext", "reactserverstate", "stingray")):
        return True
    text = script.string or ""
    sample = text[:4000].lower()
    return any(token in sample for token in ("initialcontext", "reactserverstate", "homedata", "marketingremark", "{}&&"))


def embedded_trees(soup):
    trees = []
    for script in soup.find_all("script"):
        if not script_is_relevant(script):
            continue
        text = script.string or script.get_text() or ""
        for obj in json_objects_from_text(text):
            trees.append(normalize_tree(obj))
    return trees


def keep_json_record(record):
    return bool(record and record.get("property_url"))


def walk_records(node, found):
    if isinstance(node, dict):
        record = record_from_mapping(node)
        if keep_json_record(record):
            found.append(record)
        for value in node.values():
            walk_records(value, found)
    elif isinstance(node, list):
        for item in node:
            walk_records(item, found)


def records_from_trees(trees):
    found = []
    for tree in trees:
        walk_records(tree, found)
    return found


def has_empty_homes(node):
    if isinstance(node, dict):
        homes = node.get("homes")
        if homes == []:
            return True
        return any(has_empty_homes(value) for value in node.values())
    if isinstance(node, list):
        return any(has_empty_homes(item) for item in node)
    return False


def is_challenge(html):
    soup = BeautifulSoup(html, "html.parser")
    title = text_of(soup.title).lower()
    if any(marker in title for marker in CHALLENGE_TITLE):
        return True
    for tag in soup.find_all(True):
        identity = " ".join([tag.get("id") or "", " ".join(class_tokens(tag))]).lower()
        if any(marker in identity for marker in ("captcha", "datadome", "px-captcha", "challenge-form")):
            return True
    head = soup.get_text(" ", strip=True)[:800].lower()
    if any(
        marker in head
        for marker in (
            "verify you are a human",
            "are you a robot",
            "not a robot",
            "access denied",
            "pardon our interruption",
            "javascript is disabled",
            "enable javascript",
        )
    ):
        return True
    return bool(re.search(r"\bcaptcha\b", head))


def explicit_empty(soup, trees):
    if soup.find(attrs={"data-rf-empty-results": "true"}):
        return True
    if find_class(soup, "noResults") or find_class(soup, "EmptyResults"):
        return True
    if find_class(soup, "HomeViews") and soup.find(string=re.compile(r"No homes match", re.I)):
        return True
    return any(has_empty_homes(tree) for tree in trees)


def clean_status(text):
    text = collapse(text)
    if not text or len(text) > 40 or "$" in text:
        return ""
    return text


def status_tag(scope):
    tagged = scope.find(attrs={"data-rf-test-id": re.compile(r"(^|-)status$", re.I)})
    if tagged and clean_status(text_of(tagged)):
        return tagged
    return scope.find(
        lambda tag: any(token.lower() in {"status", "listingstatus"} for token in class_tokens(tag))
        and clean_status(text_of(tag))
    )


def card_record(card):
    record = blank_record()
    record["price"] = text_of(find_class(card, PRICE_CLASS, "span") or find_class(card, PRICE_CLASS))
    record["configuration"] = text_of(find_class(card, CONFIG_CLASS))
    record["address"] = text_of(find_class(card, ADDRESS_CLASS))
    record["broker"] = text_of(find_class(card, BROKER_CLASS))
    link = card.find("a", href=True)
    record["property_url"] = canonical_property_url(link.get("href") if link else "")
    record["listing_status"] = clean_status(text_of(status_tag(card)))
    record["availability"] = availability_from_status(record["listing_status"])
    if not useful(record):
        return None
    return record


def search_records_from_html(soup):
    records = []
    for card in find_all_class(soup, CARD_CLASS):
        record = card_record(card)
        if record:
            records.append(record)
    records.extend(records_from_trees(embedded_trees(soup)))
    return records


def property_records_from_html(soup):
    record = blank_record()
    price = test_id(soup, "abp-price") or find_class(soup, "statsValue")
    record["price"] = text_of(price)
    street = text_of(test_id(soup, "abp-streetLine"))
    locality = text_of(test_id(soup, "abp-cityStateZip"))
    record["address"] = collapse(", ".join(part for part in (street, locality) if part))
    if not record["address"]:
        record["address"] = text_of(
            test_id(soup, "abp-homeinfo-homeaddress") or find_class(soup, ADDRESS_CLASS) or soup.find("h1")
        )
    record["listing_status"] = clean_status(text_of(test_id(soup, "abp-status") or status_tag(soup)))
    record["availability"] = availability_from_status(record["listing_status"])
    remarks = (
        test_id(soup, "abp-remarks")
        or soup.find(id="marketing-remarks")
        or soup.find(lambda tag: any("marketing-remark" in token.lower() or token.lower() == "remarks" for token in class_tokens(tag) + [tag.get("id") or ""]))
    )
    record["description"] = text_of(remarks, multiline=True)
    beds = text_of(test_id(soup, "abp-beds"))
    baths = text_of(test_id(soup, "abp-baths"))
    sqft = text_of(test_id(soup, "abp-sqFt"))
    config_bits = [bit for bit in (beds, baths, sqft) if bit]
    record["configuration"] = " ".join(config_bits) or text_of(find_class(soup, CONFIG_CLASS))
    record["broker"] = text_of(find_class(soup, BROKER_CLASS) or test_id(soup, "listing-agent"))
    canonical = soup.find("link", rel=lambda value: value and "canonical" in value)
    href = canonical.get("href") if canonical and canonical.get("href") else ""
    if not href:
        link = soup.find("a", href=re.compile(r"/home/\d+"))
        href = link.get("href") if link else ""
    record["property_url"] = canonical_property_url(href)
    records = [record] if useful(record) else []
    records.extend(records_from_trees(embedded_trees(soup)))
    return records


def home_id(url):
    match = re.search(r"/home/(\d+)", url or "")
    return match.group(1) if match else ""


def dedupe(records):
    merged = []
    index = {}
    missing = 0
    for record in records:
        url = record.get("property_url") or ""
        if not url:
            missing += 1
            key = f"missing:{missing}"
        else:
            key = url
        if key not in index:
            index[key] = len(merged)
            merged.append(dict(record))
            continue
        current = merged[index[key]]
        for field, value in record.items():
            if value and not current.get(field):
                current[field] = value
    return merged


def absorb_page_details(records):
    keyed = [record for record in records if record.get("property_url")]
    unkeyed = [record for record in records if not record.get("property_url")]
    if len(keyed) != 1 or not unkeyed:
        return records
    target = dict(keyed[0])
    for extra in unkeyed:
        for field, value in extra.items():
            if value and not target.get(field):
                target[field] = value
    return [target]


def filter_property_records(records, page_url):
    wanted = home_id(page_url)
    if not wanted:
        return absorb_page_details(records)
    matched = [record for record in records if not record.get("property_url") or home_id(record["property_url"]) == wanted]
    return absorb_page_details(matched or records)


def finalize(records, source_page_url, collected_at, limit):
    rows = []
    for record in dedupe(records)[:limit]:
        row = {column: "" for column in COLUMNS}
        row.update(record)
        row["availability"] = record.get("availability") or ""
        row["source_name"] = SOURCE_NAME
        row["source_page_url"] = source_page_url
        row["collected_at"] = collected_at
        rows.append(row)
    return rows


def parse_html(html, mode, source_page_url, collected_at, limit):
    if is_challenge(html):
        raise ScraperError(
            "Page is a CAPTCHA or access-denied challenge. HTTP 200 is not extraction success. Previous CSV was not changed."
        )
    soup = BeautifulSoup(html, "html.parser")
    trees = embedded_trees(soup)
    if mode == "search":
        records = search_records_from_html(soup)
        if not records:
            if explicit_empty(soup, trees):
                return []
            raise ScraperError(
                "Search markup was not recognized and was not an explicit empty-results page. Previous CSV was not changed."
            )
    else:
        records = filter_property_records(property_records_from_html(soup), source_page_url)
        if not records:
            raise ScraperError(
                "Property markup had no price, address, status, or description. Previous CSV was not changed."
            )
    return finalize(records, source_page_url, collected_at, limit)


def fetch(url, timeout):
    validate_url(url)
    try:
        response = requests.get(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "en-US,en;q=0.9",
            },
            timeout=timeout,
            verify=True,
            allow_redirects=True,
        )
    except requests.exceptions.Timeout as exc:
        raise ScraperError(
            f"Request timed out after {timeout}s. Increase --timeout up to {MAX_TIMEOUT} and retry. Previous CSV was not changed."
        ) from exc
    except requests.exceptions.SSLError as exc:
        raise ScraperError(
            "HTTPS certificate verification failed. Verification stays enabled, so the request was not retried. Previous CSV was not changed."
        ) from exc
    except requests.RequestException as exc:
        raise ScraperError(
            f"Request failed ({type(exc).__name__}). Previous CSV was not changed."
        ) from exc
    if response.status_code == 429:
        raise ScraperError("Redfin rate limited the request (HTTP 429). Wait and retry. Previous CSV was not changed.")
    if response.status_code >= 400:
        raise ScraperError(f"Redfin returned HTTP {response.status_code}. Previous CSV was not changed.")
    final_url = response.url
    try:
        validate_url(final_url)
    except ScraperError as exc:
        raise ScraperError(f"Redirect left Redfin. {exc}") from exc
    if is_challenge(response.text or ""):
        raise ScraperError(
            "Redfin returned HTTP 200 but the page is a CAPTCHA or access-denied challenge. Extraction was not successful. Previous CSV was not changed."
        )
    return response.text, final_url


def write_json(path, rows):
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".redfin-", suffix=".json", dir=destination.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            extras = ("beds", "baths", "property_type", "lat", "lng")
            json.dump([{**{column: row.get(column, "") for column in COLUMNS}, **{key: row.get(key) for key in extras}} for row in rows], handle)
        os.replace(temporary, destination)
    except Exception:
        if os.path.exists(temporary):
            os.unlink(temporary)
        raise


def write_output(path, rows, export_format):
    if export_format == "json":
        write_json(path, rows)
        return
    write_csv(path, rows)


def write_csv(path, rows):
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".redfin-", suffix=".csv", dir=destination.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=COLUMNS, extrasaction="ignore", lineterminator="\n")
            writer.writeheader()
            for row in rows:
                writer.writerow({column: row.get(column, "") for column in COLUMNS})
        os.replace(temporary, destination)
    except Exception:
        if os.path.exists(temporary):
            os.unlink(temporary)
        raise


def bounded_timeout(value):
    try:
        timeout = float(value)
    except (TypeError, ValueError) as exc:
        raise argparse.ArgumentTypeError("timeout must be a number") from exc
    if timeout <= 0 or timeout > MAX_TIMEOUT:
        raise argparse.ArgumentTypeError(f"timeout must be between 0 and {MAX_TIMEOUT} seconds")
    return timeout


def bounded_limit(value):
    try:
        limit = int(value)
    except (TypeError, ValueError) as exc:
        raise argparse.ArgumentTypeError("limit must be an integer") from exc
    if limit < 1 or limit > MAX_LIMIT:
        raise argparse.ArgumentTypeError(f"limit must be from 1 to {MAX_LIMIT}")
    return limit


def build_parser():
    parser = argparse.ArgumentParser(description="Scrape one Redfin search or property page into CSV. Prices are for-sale prices, not monthly rent.")
    sub = parser.add_subparsers(dest="mode", required=True)
    for name, default_url, default_output in (
        ("search", DEFAULT_SEARCH_URL, "redfin-search.csv"),
        ("property", DEFAULT_PROPERTY_URL, "redfin-property.csv"),
    ):
        command = sub.add_parser(name, help=f"Collect a Redfin {name} page")
        command.add_argument("--url", default=None, help=f"Redfin https URL. Default: {default_url}")
        command.add_argument("--html", default=None, help="Saved HTML file. No network request is made.")
        command.add_argument("--output", default=default_output, help="CSV destination")
        command.add_argument("--format", choices=("csv", "json"), default="csv", help="csv is the stable export; json is for the app cache")
        command.add_argument("--timeout", type=bounded_timeout, default=DEFAULT_TIMEOUT, help=f"Seconds, max {MAX_TIMEOUT}")
        command.add_argument("--limit", type=bounded_limit, default=DEFAULT_LIMIT, help=f"Max listings, max {MAX_LIMIT}")
    return parser


def utc_now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def source_label(args, fetched_url):
    if fetched_url:
        return fetched_url
    if args.url:
        return args.url
    return str(Path(args.html).resolve()) if args.html else ""


def run(args):
    fetched_url = ""
    collected_at = ""
    if args.html:
        html = Path(args.html).read_text(encoding="utf-8")
        if args.url:
            validate_url(args.url)
    else:
        url = args.url or (DEFAULT_SEARCH_URL if args.mode == "search" else DEFAULT_PROPERTY_URL)
        html, fetched_url = fetch(url, args.timeout)
        collected_at = utc_now()
    rows = parse_html(html, args.mode, source_label(args, fetched_url), collected_at, args.limit)
    write_output(args.output, rows, args.format)
    print(f"Wrote {len(rows)} Redfin listing(s) to {args.output}", file=sys.stderr)
    return 0


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return run(args)
    except ScraperError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"Could not read or write a file ({exc.__class__.__name__}). Previous CSV was not changed.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
