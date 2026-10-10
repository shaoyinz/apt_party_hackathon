#!/usr/bin/env python3
import json
import os
import re
import sys
from datetime import datetime, timezone

POST_RE = re.compile(r"/posts/(\d+)|permalink/(\d+)|story_fbid=(\d+)")


def redact(text, secrets):
    out = text or ""
    for secret in secrets:
        if secret:
            out = out.replace(secret, "[redacted]")
    return out


def cookies():
    c_user = os.environ.get("FACEBOOK_C_USER") or os.environ.get("SECRET_FACEBOOK_C_USER") or ""
    xs = os.environ.get("FACEBOOK_XS") or os.environ.get("SECRET_FACEBOOK_XS") or ""
    return c_user, xs


def emit(payload, secrets):
    encoded = redact(json.dumps(payload), secrets)
    sys.stdout.write(encoded)
    sys.stdout.write("\n")


def post_identity(href):
    match = POST_RE.search(href or "")
    if not match:
        return None
    return next(group for group in match.groups() if group)


def absolute_url(href):
    clean = (href or "").split("?")[0]
    if clean.startswith("/"):
        clean = "https://www.facebook.com" + clean
    return clean


def challenge(url):
    low = (url or "").lower()
    if "/login" in low or "login.php" in low:
        return "login_challenge"
    if "checkpoint" in low:
        return "checkpoint"
    return None


def denied(text):
    low = (text or "").lower()
    phrases = (
        "this content isn't available",
        "content isn't available right now",
        "you don't have permission",
        "this group is private",
    )
    return any(phrase in low for phrase in phrases)


def posted_label(article):
    times = article.locator("time")
    if times.count():
        value = times.first.get_attribute("datetime")
        if value:
            return value[:80]
    links = article.locator("a[aria-label]")
    count = min(links.count(), 12)
    for index in range(count):
        link = links.nth(index)
        href = link.get_attribute("href") or ""
        label = link.get_attribute("aria-label") or ""
        if post_identity(href) and label and "comment" not in label.lower():
            return label[:80]
    return None


def collect_posts(page, source, limit):
    articles = page.locator('[role="article"]')
    count = min(articles.count(), limit)
    posts = []
    seen = set()
    for index in range(count):
        article = articles.nth(index)
        hrefs = article.locator("a[href]").evaluate_all(
            "els => els.map((el) => el.getAttribute('href')).filter(Boolean)"
        )
        post_id = None
        post_url = None
        for href in hrefs:
            found = post_identity(href)
            if found:
                post_id = found
                post_url = absolute_url(href)
                break
        if not post_id or post_id in seen:
            continue
        seen.add(post_id)
        text = article.inner_text(timeout=3000)
        posts.append(
            {
                "groupId": source["id"],
                "groupLabel": source["label"],
                "groupUrl": source["url"],
                "postId": post_id,
                "postUrl": post_url,
                "postedAt": posted_label(article),
                "text": text,
                "fetchedAt": datetime.now(timezone.utc).isoformat(),
            }
        )
    return posts, articles.count()


def main():
    c_user, xs = cookies()
    secrets = [c_user, xs]
    request_path = sys.argv[1]
    with open(request_path, "r", encoding="utf-8") as handle:
        request = json.load(handle)
    sources = request.get("sources") or []
    limits = request.get("limits") or {}
    timeout_ms = int(limits.get("navigationTimeoutMs") or 35000)
    post_limit = int(limits.get("postsPerGroup") or 8)
    if not c_user or not xs:
        emit(
            {
                "ok": False,
                "code": "missing_credentials",
                "error": "FACEBOOK_C_USER and FACEBOOK_XS are not set. No request was sent.",
                "fetchedAt": None,
                "sources": [
                    {
                        "id": source["id"],
                        "url": source["url"],
                        "label": source["label"],
                        "status": "missing_credentials",
                        "retrieved": 0,
                        "message": "Cookie pair is missing.",
                    }
                    for source in sources
                ],
                "posts": [],
            },
            secrets,
        )
        return 0
    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:
        emit(
            {
                "ok": False,
                "code": "retrieval_failed",
                "error": redact(f"Playwright is unavailable: {type(exc).__name__}", secrets),
                "fetchedAt": None,
                "sources": [],
                "posts": [],
            },
            secrets,
        )
        return 0

    reports = []
    posts = []
    failure = None
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            context = browser.new_context(
                locale="en-US",
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                viewport={"width": 1366, "height": 900},
            )
            context.add_cookies(
                [
                    {"name": "c_user", "value": c_user, "domain": ".facebook.com", "path": "/", "secure": True},
                    {"name": "xs", "value": xs, "domain": ".facebook.com", "path": "/", "secure": True, "httpOnly": True},
                ]
            )
            page = context.new_page()
            for source in sources:
                if failure:
                    reports.append(
                        {
                            "id": source["id"],
                            "url": source["url"],
                            "label": source["label"],
                            "status": "skipped",
                            "retrieved": 0,
                            "message": "Skipped after a login or checkpoint challenge.",
                        }
                    )
                    continue
                response = page.goto(source["url"], wait_until="domcontentloaded", timeout=timeout_ms)
                page.wait_for_timeout(4000)
                kind = challenge(page.url)
                if kind:
                    failure = kind
                    reports.append(
                        {
                            "id": source["id"],
                            "url": source["url"],
                            "label": source["label"],
                            "status": kind,
                            "retrieved": 0,
                            "message": "Stopped without bypassing the challenge.",
                        }
                    )
                    continue
                body = ""
                try:
                    body = page.locator("body").inner_text(timeout=3000)
                except Exception:
                    body = ""
                if denied(body):
                    reports.append(
                        {
                            "id": source["id"],
                            "url": source["url"],
                            "label": source["label"],
                            "status": "denied",
                            "retrieved": 0,
                            "message": "The group page denied access.",
                        }
                    )
                    continue
                found, seen = collect_posts(page, source, post_limit)
                title = page.title().strip().lower()
                status = "success" if found else "empty"
                message = "Retrieved posts." if found else "The group page had no identifiable posts."
                if response is not None and response.status >= 400:
                    status = "retrieval_failed"
                    message = f"Group request returned HTTP {response.status}."
                    found = []
                elif "/groups/" not in page.url.lower() or title in {"facebook", "error"}:
                    status = "retrieval_failed"
                    message = "The group feed did not stay on a readable group page."
                    found = []
                elif seen and not found:
                    status = "retrieval_failed"
                    message = "The page had articles, but none had a stable post link."
                    found = []
                reports.append(
                    {
                        "id": source["id"],
                        "url": source["url"],
                        "label": source["label"],
                        "status": status,
                        "retrieved": len(found) if status == "success" else 0,
                        "message": message,
                    }
                )
                posts.extend(found)
            browser.close()
    except Exception as exc:
        emit(
            {
                "ok": False,
                "code": "retrieval_failed",
                "error": redact(f"{type(exc).__name__}: {exc}", secrets)[:400],
                "fetchedAt": None,
                "sources": reports,
                "posts": [],
            },
            secrets,
        )
        return 0

    if failure:
        emit(
            {
                "ok": False,
                "code": failure,
                "error": "Facebook returned a login or checkpoint page. Refresh stopped and did not replace saved listings.",
                "fetchedAt": None,
                "sources": reports,
                "posts": [],
            },
            secrets,
        )
        return 0
    if any(report["status"] == "denied" for report in reports) and not posts:
        emit(
            {
                "ok": False,
                "code": "denied",
                "error": "Facebook denied access to the configured groups. Previous listings were kept.",
                "fetchedAt": None,
                "sources": reports,
                "posts": [],
            },
            secrets,
        )
        return 0
    if any(report["status"] == "retrieval_failed" for report in reports) and not posts:
        emit(
            {
                "ok": False,
                "code": "retrieval_failed",
                "error": "Facebook did not return a readable group feed. Previous listings were kept.",
                "fetchedAt": None,
                "sources": reports,
                "posts": [],
            },
            secrets,
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
        },
        secrets,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        c_user, xs = cookies()
        emit(
            {
                "ok": False,
                "code": "retrieval_failed",
                "error": redact(f"{type(exc).__name__}", [c_user, xs]),
                "fetchedAt": None,
                "sources": [],
                "posts": [],
            },
            [c_user, xs],
        )
        raise SystemExit(0)
