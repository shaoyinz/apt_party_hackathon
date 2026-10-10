#!/usr/bin/env python3
import argparse
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    sys.stderr.write(
        "zillow_scraper: missing_dependency: Install requests and beautifulsoup4 from requirements-zillow.txt.\n"
    )
    raise SystemExit(1)

DEFAULT_URL = "https://www.zillow.com/homes/for_sale/Brooklyn,-New-York,-NY_rb/"
SCRAPINGDOG_ENDPOINT = "https://api.scrapingdog.com/scrape"
API_KEY_ENV = "SCRAPINGDOG_API_KEY"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)
API_KEY_QUERY = re.compile(r"(api_key=)[^&\s\"']+", re.I)
SQFT_RE = re.compile(r"(?i)(\d[\d,]*)\s*(sqft|sq\s*ft)")
ZPID_RE = re.compile(r"(\d+)_zpid")
GLUE_RE = re.compile(r"(?i)(bds?|beds?|baths?|ba|sqft|sq\s*ft)(?=\d)")
CHALLENGE_PHRASES = (
    "please verify you are a human",
    "are you a robot",
    "access to this page has been denied",
    "access denied",
    "px-captcha",
    "g-recaptcha",
    "cf-challenge",
    "perimeterx",
    "pardon our interruption",
)
EMPTY_PHRASES = (
    "no matching results",
    "no results found",
    "couldn't find any homes",
    "could not find any homes",
    "no homes match",
    "0 results",
)


class ScrapeError(Exception):
    def __init__(self, code, message):
        self.code = code
        self.message = message
        super().__init__(message)


def redact(text, secrets=()):
    cleaned = text or ""
    for secret in secrets:
        if secret:
            cleaned = cleaned.replace(secret, "[redacted]")
    return API_KEY_QUERY.sub(r"\1[redacted]", cleaned)


def is_zillow(url):
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    return parsed.scheme in {"http", "https"} and host in {"zillow.com", "www.zillow.com"}


def absolute_zillow(href):
    if not href:
        return None
    absolute = urljoin("https://www.zillow.com", href)
    if not is_zillow(absolute):
        return None
    return absolute.split("#")[0]


def element_text(node):
    if node is None:
        return ""
    return " ".join(node.get_text(" ", strip=True).split())


def readable_fragment(text):
    text = " ".join((text or "").split())
    return GLUE_RE.sub(r"\1, ", text)


def detail_fragments(card):
    lists = []
    for ul in card.find_all("ul"):
        classes = " ".join(ul.get("class") or [])
        if "StyledPropertyCardHomeDetailsList" in classes or "HomeDetails" in classes:
            lists.append(ul)
    if not lists:
        lists.extend(card.select('[data-test="property-card-details"]'))
    if lists:
        items = lists[0].find_all("li")
        if items:
            return [readable_fragment(element_text(item)) for item in items if element_text(item)]
        text = readable_fragment(element_text(lists[0]))
        return [text] if text else []
    fragments = []
    for attr in (
        "property-card-beds",
        "property-card-baths",
        "property-card-sqft",
        "property-card-living-area",
    ):
        node = card.select_one(f'[data-test="{attr}"]')
        if node and element_text(node):
            fragments.append(readable_fragment(element_text(node)))
    return fragments


def joined_size(fragments):
    parts = [part for part in fragments if part]
    if not parts:
        return None
    if len(parts) == 1:
        return parts[0]
    return ", ".join(parts)


def living_area(fragments):
    for fragment in fragments:
        low = fragment.lower()
        if "lot" in low or "acre" in low:
            continue
        match = SQFT_RE.search(fragment)
        if not match:
            continue
        if re.search(r"(?i)\b(bds?|beds?|ba|baths?)\b", fragment):
            unit = " ".join(match.group(2).split())
            return f"{match.group(1)} {unit}"
        return fragment
    return None


def price_type(raw):
    if not raw:
        return None
    low = raw.lower()
    if "/mo" in low or "per month" in low or "/month" in low:
        return "monthly_rent"
    return "asking_price"


def listing_link(card):
    labeled = card.select_one('[data-test="property-card-link"]')
    if labeled and labeled.get("href"):
        found = absolute_zillow(labeled["href"])
        if found:
            return found
    for anchor in card.find_all("a", href=True):
        href = anchor["href"]
        if "/homedetails/" in href or "_zpid" in href:
            found = absolute_zillow(href)
            if found:
                return found
    return None


def card_zpid(card, url):
    attr = card.get("data-zpid")
    if attr:
        return str(attr)
    if url:
        match = ZPID_RE.search(url)
        if match:
            return match.group(1)
    return None


def looks_like_card(node):
    if node.select_one('[data-test="property-card-price"]') or node.find("address"):
        return True
    classes = " ".join(node.get("class") or [])
    return "ListItem-" in classes or node.get("data-test") == "property-card"


def find_cards(soup):
    semantic = soup.select('[data-test="property-card"]')
    if semantic:
        return semantic
    listed = []
    for node in soup.find_all("li"):
        classes = " ".join(node.get("class") or [])
        if "ListItem-" in classes and looks_like_card(node):
            listed.append(node)
    if listed:
        return listed
    containers = []
    for price in soup.select('[data-test="property-card-price"]'):
        container = price.find_parent("li") or price.find_parent("article") or price.parent
        if container is not None and container not in containers:
            containers.append(container)
    return containers


def challenge_text(soup):
    title = element_text(soup.find("title")).lower()
    for tag in soup.find_all(["script", "style"]):
        tag.decompose()
    body = soup.get_text(" ", strip=True).lower()[:8000]
    sample = f"{title} {body}"
    return any(phrase in sample for phrase in CHALLENGE_PHRASES)


def empty_results(soup):
    if soup.select('[data-test="no-results"], [data-test="search-results-empty"], [data-test="empty-results"]'):
        return True
    sample = soup.get_text(" ", strip=True).lower()[:8000]
    return any(phrase in sample for phrase in EMPTY_PHRASES)


def extract_record(card, fetched_at):
    price_node = card.select_one('[data-test="property-card-price"]')
    pricing = element_text(price_node) or None
    address_node = card.find("address") or card.select_one('[data-test="property-card-addr"]')
    address = element_text(address_node) or None
    fragments = detail_fragments(card)
    url = listing_link(card)
    if not pricing and not address and not url and not fragments:
        return None
    return {
        "pricing": pricing,
        "price_type": price_type(pricing),
        "size": joined_size(fragments),
        "living_area": living_area(fragments),
        "address": address,
        "listing_url": url,
        "source": "zillow",
        "fetched_at": fetched_at,
        "_zpid": card_zpid(card, url),
    }


def identity(record, index):
    if record.get("_zpid"):
        return ("zpid", record["_zpid"])
    if record.get("listing_url"):
        return ("url", record["listing_url"].split("?")[0])
    return ("card", index)


def public_record(record):
    return {key: value for key, value in record.items() if key != "_zpid"}


def parse_html(html, fetched_at, limit):
    soup = BeautifulSoup(html or "", "html.parser")
    cards = find_cards(soup)
    records = []
    seen = set()
    truncated = False
    for card in cards:
        record = extract_record(card, fetched_at)
        if record is None:
            continue
        key = identity(record, len(records))
        if key in seen:
            continue
        if len(records) >= limit:
            truncated = True
            break
        seen.add(key)
        records.append(public_record(record))
    if records:
        return records, "ok", truncated
    if challenge_text(soup):
        raise ScrapeError(
            "challenge",
            "Zillow returned a CAPTCHA or access-denied page. HTTP 200 is not a successful extraction.",
        )
    if empty_results(soup):
        return [], "empty", False
    raise ScrapeError(
        "unrecognized_markup",
        "No property cards or explicit empty-results marker were found. Refusing to treat broken markup as an empty success.",
    )


def fetch_direct(url, timeout):
    try:
        response = requests.get(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept-Language": "en-US,en;q=0.9",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
            timeout=timeout,
        )
    except requests.Timeout:
        raise ScrapeError("timeout", f"Direct fetch timed out after {timeout} seconds.")
    except requests.RequestException:
        raise ScrapeError("fetch_error", "Direct fetch failed before a usable response was received.")
    if not is_zillow(response.url):
        raise ScrapeError("http_error", "Direct fetch was redirected off zillow.com.")
    if response.status_code == 429:
        raise ScrapeError("http_error", "Direct fetch was rate limited (HTTP 429).")
    if response.status_code == 403:
        raise ScrapeError("http_error", "Direct fetch was denied (HTTP 403).")
    if response.status_code != 200:
        raise ScrapeError("http_error", f"Direct fetch returned HTTP {response.status_code}.")
    return response.status_code, response.text


def fetch_scrapingdog(url, timeout, api_key):
    try:
        response = requests.get(
            SCRAPINGDOG_ENDPOINT,
            params={"api_key": api_key, "url": url, "dynamic": "false"},
            timeout=timeout,
        )
    except requests.Timeout:
        raise ScrapeError("timeout", f"Scrapingdog request timed out after {timeout} seconds.")
    except requests.RequestException:
        raise ScrapeError("fetch_error", "Scrapingdog request failed before a usable response was received.")
    if response.status_code == 401:
        raise ScrapeError("http_error", "Scrapingdog rejected the API key (HTTP 401).")
    if response.status_code == 429:
        raise ScrapeError("http_error", "Scrapingdog rate limited the request (HTTP 429).")
    if response.status_code != 200:
        raise ScrapeError("http_error", f"Scrapingdog returned HTTP {response.status_code}.")
    return response.status_code, response.text


def build_payload(listings, status, truncated, search_url, mode, fetched_at, http_status):
    return {
        "source": "zillow",
        "listing_kind": "for_sale",
        "price_meaning": "for_sale_asking_price",
        "monthly_rent": None,
        "data_origin": mode,
        "live": mode in {"direct_fetch", "scrapingdog"},
        "search_url": search_url,
        "fetched_at": fetched_at,
        "http_status": http_status,
        "status": status,
        "count": len(listings),
        "truncated": truncated,
        "listings": listings,
    }


def write_output(path, payload, stdout):
    encoded = json.dumps(payload, indent=2) + "\n"
    if not path:
        stdout.write(encoded)
        return
    directory = os.path.dirname(os.path.abspath(path)) or "."
    os.makedirs(directory, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=directory, prefix=".zillow-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(encoded)
        os.replace(tmp, path)
    except Exception:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def load_html(args, env):
    if args.html:
        if not os.path.isfile(args.html):
            raise ScrapeError("input_error", f"Saved HTML file not found: {args.html}")
        with open(args.html, "r", encoding="utf-8", errors="replace") as handle:
            return "saved_html", None, handle.read(), None
    if not is_zillow(args.url):
        raise ScrapeError("invalid_url", "Only http(s) URLs on zillow.com are accepted.")
    if args.provider == "scrapingdog":
        api_key = env.get(API_KEY_ENV) or ""
        if not api_key.strip():
            raise ScrapeError(
                "missing_credential",
                f"{API_KEY_ENV} is not set. Direct mode and saved HTML do not need a Scrapingdog key.",
            )
        status, html = fetch_scrapingdog(args.url, args.timeout, api_key)
        fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        return "scrapingdog", status, html, fetched_at
    status, html = fetch_direct(args.url, args.timeout)
    fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return "direct_fetch", status, html, fetched_at


def parser():
    tool = argparse.ArgumentParser(
        description=(
            "Extract Zillow for-sale price, size, address, and listing URL as JSON. "
            "Asking prices are not monthly rent. Saved HTML needs no network or API key."
        )
    )
    tool.add_argument("--url", default=DEFAULT_URL, help="Zillow search URL")
    tool.add_argument("--html", help="Parse this saved HTML file instead of fetching")
    tool.add_argument("--output", help="JSON destination. Defaults to stdout. Failures do not replace an existing file.")
    tool.add_argument("--timeout", type=float, default=20, help="Bounded request timeout in seconds (1-60)")
    tool.add_argument("--limit", type=int, default=40, help="Maximum listings to emit (1-100)")
    tool.add_argument(
        "--provider",
        choices=("direct", "scrapingdog"),
        default="direct",
        help="Network provider. scrapingdog reads SCRAPINGDOG_API_KEY and is ignored with --html.",
    )
    return tool


def validate(args):
    if args.timeout < 1 or args.timeout > 60:
        raise ScrapeError("usage", "Timeout must be between 1 and 60 seconds.")
    if args.limit < 1 or args.limit > 100:
        raise ScrapeError("usage", "Limit must be between 1 and 100.")


def run(argv=None, env=None, stdout=None, stderr=None):
    stdout = stdout or sys.stdout
    stderr = stderr or sys.stderr
    env = env if env is not None else os.environ
    secrets = [env.get(API_KEY_ENV) or "", os.environ.get(API_KEY_ENV) or ""]
    try:
        args = parser().parse_args(argv)
        validate(args)
        mode, http_status, html, fetched_at = load_html(args, env)
        listings, status, truncated = parse_html(html, fetched_at, args.limit)
        payload = build_payload(listings, status, truncated, args.url, mode, fetched_at, http_status)
        write_output(args.output, payload, stdout)
        return 0
    except ScrapeError as exc:
        stderr.write(f"zillow_scraper: {exc.code}: {redact(exc.message, secrets)}\n")
        return 2 if exc.code == "usage" else 1
    except Exception as exc:
        stderr.write(f"zillow_scraper: error: {redact(str(exc), secrets)}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(run())
