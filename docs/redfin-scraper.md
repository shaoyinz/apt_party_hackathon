# Redfin CSV scraper

Standalone collector for one Redfin search page or one property page. It does not write to the database, change Roost rent filtering, or treat for-sale prices as monthly rent.

Database integration, UI import, scheduling, pagination, provider/proxy block handling, and cross-source matching are deferred.

## Install

From this project directory, using the declared Requests and BeautifulSoup versions:

```bash
python3 -m pip install -r requirements-redfin.txt
```

These packages are not part of `npm run py:sync`. That command remains the OCR environment.

## Commands

Search the default New York active-listings page, or pass another `https://www.redfin.com` URL:

```bash
python3 scripts/redfin_scraper.py search --output redfin-search.csv --timeout 20 --limit 40
python3 scripts/redfin_scraper.py search --url "https://www.redfin.com/city/30749/NY/New-York/filter/status=active" --output redfin-search.csv --timeout 20 --limit 40
```

Property page:

```bash
python3 scripts/redfin_scraper.py property --output redfin-property.csv --timeout 20 --limit 40
python3 scripts/redfin_scraper.py property --url "https://www.redfin.com/NY/New-York/112-E-35th-St-10016/home/45333496" --output redfin-property.csv
```

Saved HTML does not use the network. `collected_at` stays blank, so fixture output is not labeled as a live collection. `--url` with `--html` is provenance only.

```bash
python3 scripts/redfin_scraper.py search --html scripts/fixtures/redfin/search.html --output redfin-search.csv --limit 40
python3 scripts/redfin_scraper.py property --html scripts/fixtures/redfin/property-pending.html --output redfin-property.csv
```

`--timeout` must be greater than 0 and at most 60 seconds. `--limit` must be from 1 to 100. Only `https://www.redfin.com` and `https://redfin.com` are fetched. Certificate verification stays enabled.

## CSV schema

Header, in order:

`price,configuration,address,broker,property_url,availability,listing_status,description,source_name,source_page_url,collected_at`

- `price` is the listing or last-sold display price, never monthly rent.
- Missing values are blank. `availability` is `true` or `false` only for explicit statuses such as Active, For sale, Sold, or Off Market. Pending, Under Contract, and missing status stay blank and are not stored as false. `listing_status` keeps the source text.
- Commas, quotes, and multiline descriptions are quoted.
- Network runs set `source_name` to Redfin, `source_page_url` to the fetched URL, and `collected_at` to UTC `YYYY-MM-DDTHH:MM:SSZ`.
- Rows are deduped by canonical property URL (`https`, `www.redfin.com`, path without query or trailing slash). Later copies fill blanks only. The same street address with different property URLs stays as separate rows. Records with no property URL are not merged.

## Parsing

Search cards use `HomeCardContainer`, `homecardV2Price`, `HomeStatsV2`, `homeAddressV2`, and `brokerageDisclaimerV2`. Configuration text keeps readable spaces.

Embedded JSON is parsed with `json.loads` only. Scripts are never executed. Supported shapes include `reactServerState.InitialContext`, stingray `{}&&` payloads, and listing objects with `price.value`, `streetLine`, `city`, `state`, and `zip`.

An explicit empty-results page writes a header-only CSV. Unrecognized markup exits nonzero. HTTP 200 alone is not success. Robot, CAPTCHA, and access-denied pages, including a 200 response that says JavaScript is disabled, exit nonzero and do not replace an existing CSV. The same is true for HTTP errors, HTTP 429, timeouts, and certificate failures.

The supplied page is the whole run. Pagination and crawling at scale are deferred.

## Search cache

The dev server does not scrape during a search. A scheduler starts with the dev server and refreshes once a day (`REDFIN_REFRESH_HOURS`, default 24). `GET /api/redfin-listings?city=Sunnyvale` returns only that city. Other cities are not substituted. A failed city refresh keeps that city's last successful rows.

Default collection targets are Sunnyvale, Santa Clara, Mountain View, Cupertino, San Jose, Palo Alto, Milpitas, and Campbell. Sale page URLs were verified for the first five. Palo Alto, Milpitas, and Campbell are not requested until a Redfin city URL is verified, because guessed IDs resolved to other cities.

For-sale prices are not written to `listings.price_monthly`. When `DATABASE_URL` or `PGHOST` is set, a successful collection upserts `redfin_listings` (`supabase/002_redfin_listings.sql`). That table has no monthly-rent column. If the database is unset or the write fails, search still uses the file cache.

## Tests

```bash
python3 scripts/test_redfin_scraper.py
```

## Live check on 2026-10-10

The first bounded direct request to the default search URL returned HTTP 200 (about 1.8 MB) and included listing JSON. One source URL in that payload was `https://www.redfin.com/NY/Glen-Oaks/8244-263rd-St-11004/home/20793540`, with `price.value` 900000, street `8244 263rd St`, Glen Oaks, NY 11004, broker Fave Realty Inc., and status Active. The parser at that moment did not yet map `price.value` or top-level address fields, so that run's rows lacked price and address.

The first bounded request to the default property URL also returned HTTP 200. It showed last-sold price `$8,789,002`, address `112 E 35th St, New York, NY 10016`, and status Off Market for `https://www.redfin.com/NY/New-York/112-E-35th-St-10016/home/45333496`. That run's status text was still the long page summary; the parser now keeps a short status and was checked against a saved copy of that shape.

A later retry of both URLs, after those parser fixes, returned HTTP 200 robot interstitials (`JavaScript is disabled` / `verify that you're not a robot`). Those attempts were not extraction successes, and no live CSV was written. Live extraction with the corrected parser is unverified. Fixture results are not live data.

## Limitations

Redfin can change markup or return a robot page to this host. The scraper does not buy a proxy or scraping API. It reads one page, stops at the listing limit, and leaves a previous CSV in place when a fetch or parse fails.
