# Redfin scraper

Verified in this repo on 2026-10-10.

- Run `python3 scripts/test_redfin_scraper.py` from the project directory. Dependencies are `requirements-redfin.txt` (`requests`, `beautifulsoup4`), not the OCR `uv` environment.
- CLI: `python3 scripts/redfin_scraper.py search|property`. Defaults and schema are in `docs/redfin-scraper.md`.
- Prices are for-sale or last-sold display prices. Do not feed them into Roost monthly-rent filtering.
- Direct Redfin requests from this host can return HTTP 200 robot pages. That is a failed extraction, not an empty result. A later retry after a successful HTTP 200 was blocked; do not describe fixture CSV as live data.
