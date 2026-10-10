#!/usr/bin/env python3
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
POST_ID = re.compile(r"/([^/?#]+)/?$")


class SearchParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.results = []
        self.current = None
        self.field = None
        self.buf = []

    def handle_starttag(self, tag, attrs):
        ad = dict(attrs)
        classes = set((ad.get("class") or "").split())
        if tag == "li" and "cl-static-search-result" in classes:
            self.current = {"title": ad.get("title") or "", "url": "", "price": "", "location": ""}
            return
        if not self.current:
            return
        if tag == "a" and ad.get("href") and not self.current["url"]:
            self.current["url"] = ad["href"]
        if tag == "div" and classes & {"title", "price", "location"}:
            self.field = next(iter(classes & {"title", "price", "location"}))
            self.buf = []

    def handle_data(self, data):
        if self.field:
            self.buf.append(data)

    def handle_endtag(self, tag):
        if tag == "div" and self.field and self.current:
            text = " ".join("".join(self.buf).split())
            if text and (self.field != "title" or not self.current["title"]):
                self.current[self.field] = text
            self.field = None
            self.buf = []
        if tag == "li" and self.current:
            self.results.append(self.current)
            self.current = None


def emit(payload):
    sys.stdout.write(json.dumps(payload))
    sys.stdout.write("\n")


def allowed(url):
    host = urllib.request.urlparse(url).hostname or ""
    return host == "craigslist.org" or host.endswith(".craigslist.org")


def post_id(url):
    match = POST_ID.search(urllib.request.urlparse(url).path)
    return match.group(1) if match else None


def fetch(url, timeout):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Language": "en-US"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.status, response.read().decode("utf-8", "replace"), response.geturl()


def listing_text(item):
    parts = [item["title"], item["location"]]
    if item["price"]:
        parts.append(f"{item['price']} per month")
    return ". ".join(part for part in parts if part)


def main():
    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        request = json.load(handle)
    sources = request.get("sources") or []
    limits = request.get("limits") or {}
    timeout = max(5, int(limits.get("navigationTimeoutMs") or 20000) / 1000)
    post_limit = int(limits.get("postsPerGroup") or 8)
    reports = []
    posts = []
    for source in sources:
        url = source.get("url") or ""
        if not allowed(url):
            reports.append(
                {
                    "id": source.get("id"),
                    "url": url,
                    "label": source.get("label"),
                    "status": "retrieval_failed",
                    "retrieved": 0,
                    "message": "Only Craigslist search URLs are fetched.",
                }
            )
            continue
        try:
            status, body, final_url = fetch(url, timeout)
        except Exception as exc:
            reports.append(
                {
                    "id": source.get("id"),
                    "url": url,
                    "label": source.get("label"),
                    "status": "retrieval_failed",
                    "retrieved": 0,
                    "message": f"{type(exc).__name__}: {exc}"[:240],
                }
            )
            continue
        if "login" in final_url or status >= 400:
            reports.append(
                {
                    "id": source.get("id"),
                    "url": url,
                    "label": source.get("label"),
                    "status": "retrieval_failed",
                    "retrieved": 0,
                    "message": f"Craigslist returned HTTP {status}.",
                }
            )
            continue
        parser = SearchParser()
        parser.feed(body)
        found = []
        seen = set()
        for item in parser.results:
            if len(found) >= post_limit:
                break
            listing_url = item["url"].split("?")[0]
            if listing_url.startswith("/"):
                listing_url = "https://sfbay.craigslist.org" + listing_url
            identity = post_id(listing_url)
            if not identity or identity in seen or not item["title"]:
                continue
            seen.add(identity)
            found.append(
                {
                    "groupId": source["id"],
                    "groupLabel": source["label"],
                    "groupUrl": url,
                    "postId": identity,
                    "postUrl": listing_url,
                    "postedAt": None,
                    "title": item["title"],
                    "text": listing_text(item),
                    "fetchedAt": datetime.now(timezone.utc).isoformat(),
                    "listingCategory": "apartment",
                }
            )
        reports.append(
            {
                "id": source["id"],
                "url": url,
                "label": source["label"],
                "status": "success" if found else "empty",
                "retrieved": len(found),
                "message": "Retrieved Craigslist housing posts." if found else "The search page had no identifiable posts.",
            }
        )
        posts.extend(found)
    if reports and all(report["status"] == "retrieval_failed" for report in reports):
        emit(
            {
                "ok": False,
                "code": "retrieval_failed",
                "error": "Craigslist search could not be read. Previous listings were kept.",
                "fetchedAt": None,
                "sources": reports,
                "posts": [],
            }
        )
        return 0
    emit(
        {
            "ok": True,
            "code": None,
            "error": None,
            "fetchedAt": datetime.now(timezone.utc).isoformat(),
            "sources": reports,
            "posts": posts,
        }
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        emit(
            {
                "ok": False,
                "code": "retrieval_failed",
                "error": type(exc).__name__,
                "fetchedAt": None,
                "sources": [],
                "posts": [],
            }
        )
        raise SystemExit(0)
