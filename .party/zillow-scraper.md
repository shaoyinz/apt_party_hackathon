# Zillow scraper

Standalone CLI at `scripts/zillow_scraper.py`. It is not wired into Roost rent matching. For-sale asking prices must not be treated as monthly rent.

Verified 2026-10-10:

- `python3 scripts/test_zillow_scraper.py` passed after `python3 -m pip install -r requirements-zillow.txt`.
- `npm ci`, `npm test` (26 tests), and `npm run build` passed. The Craigslist importer was not changed.
- Direct live fetch of the Brooklyn for-sale URL at 2026-10-10T21:16:35Z with `--timeout 25 --limit 5` returned HTTP 403, exited 1, and wrote no JSON. Extracted count was 0. That is a block, not a successful scrape.
- Scrapingdog live mode is untested. No `SCRAPINGDOG_API_KEY` was attached. The client calls `https://api.scrapingdog.com/scrape` with `api_key`, `url`, and `dynamic=false`, matching Scrapingdog's Web Scraping API docs checked the same day.
- Sale cache migration is `supabase/002_zillow_sale_cache.sql`. It does not write `listings.price_monthly`.
- `npm test` later passed 58 tests, including `server/zillowCache.test.js`. Those are mock-store tests, not a real database.
- Real database persistence was not verified. `DATABASE_URL` and `PGHOST` were unset. `node scripts/zillow-refresh.mjs` exited 1 with `missing_database`.
- No production schedule is installed. `deploy/zillow-refresh.cron` is an example for 03:00 UTC. `crontab` is not present here, and the repo has no GitHub Actions workflow.
- Rechecked direct Brooklyn fetch at 2026-10-10T21:37:45Z: HTTP 403, 0 listings.
