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
- 2026-10-10T22:55:01Z direct Brooklyn fetch with `--timeout 15 --limit 3` returned HTTP 403, exited 1, and extracted 0 listings. Scrapingdog was not tested; no `SCRAPINGDOG_API_KEY`.
- `npm test` passed 61 tests, including city filtering against a memory cache. That is not a Supabase round trip.
- `node scripts/verify-zillow-db.mjs` exited 1 with `missing_database`. `DATABASE_URL` and `PGHOST` were unset. Migration `supabase/002_zillow_sale_cache.sql` was not applied to Supabase.
- The daily timer is started by `zillowCachePlugin()` only when `RAILWAY_ENVIRONMENT` is set or `ZILLOW_REFRESH_SCHEDULE=1`. It was not observed on the deployed roost service. That URL returned HTTP 404 `Application not found` at 2026-10-10T22:54:45Z. No Railway token is attached here. Do not add a second Railway service for the example cron file.
- Redfin migration `supabase/002_redfin_listings.sql` and Craigslist import were not modified.
