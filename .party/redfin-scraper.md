# Redfin scraper

Verified in this repo on 2026-10-10.

- Run `python3 scripts/test_redfin_scraper.py` from the project directory. Dependencies are `requirements-redfin.txt` (`requests`, `beautifulsoup4`), not the OCR `uv` environment.
- CLI: `python3 scripts/redfin_scraper.py search|property`. Defaults and schema are in `docs/redfin-scraper.md`.
- Prices are for-sale or last-sold display prices. Do not write them to `listings.price_monthly`.
- Search reads only the requested city from `GET /api/redfin-listings?city=`. It does not scrape during search and does not substitute another city.
- On 2026-10-10 the sale URLs for Sunnyvale (19457), Santa Clara (17675), Mountain View (12739), Cupertino (4561), and San Jose (17420) returned HTTP 200 with matching titles. A later extraction pass, including the running scheduler, got HTTP 200 challenge pages and saved 0 listings for every target city. Palo Alto, Milpitas, and Campbell city IDs were not verified.
- `DATABASE_URL` and `PGHOST` were unset and no session secret was attached, so the Supabase migration was not applied and database read/write was not verified.
- Optional database table is `redfin_listings`, created by `supabase/002_redfin_listings.sql` or by the server when `DATABASE_URL` or `PGHOST` is set.
- Direct Redfin requests from this host can return HTTP 200 robot pages. That is a failed extraction, not an empty result. A later retry after a successful HTTP 200 was blocked; do not describe fixture CSV as live data.
