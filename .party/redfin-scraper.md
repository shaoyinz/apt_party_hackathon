# Redfin scraper

Verified in this repo on 2026-10-10.

- Run `python3 scripts/test_redfin_scraper.py` from the project directory. Dependencies are `requirements-redfin.txt` (`requests`, `beautifulsoup4`), not the OCR `uv` environment.
- CLI: `python3 scripts/redfin_scraper.py search|property`. Defaults and schema are in `docs/redfin-scraper.md`.
- Prices are for-sale or last-sold display prices. Do not write them to `listings.price_monthly`.
- Search reads `data/redfin-cache.json` via `GET /api/redfin-listings`. The dev server refreshes that cache in the background at startup only if the last attempt is older than 24 hours. It does not scrape during search.
- Optional database table is `redfin_listings`, created by `supabase/002_redfin_listings.sql` or by the server when `DATABASE_URL` or `PGHOST` is set.
- Direct Redfin requests from this host can return HTTP 200 robot pages. That is a failed extraction, not an empty result. A later retry after a successful HTTP 200 was blocked; do not describe fixture CSV as live data.
