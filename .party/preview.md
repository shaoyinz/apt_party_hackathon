# Local preview

Verified for the Roost prototype in this project directory. The Vite dev server exposes `/api/listings` for Craigslist import and `/api/imports` for bring-your-own listings. Sample search needs no database. Database and OCR credentials are optional.

## Dependency setup

```bash
npm ci
```

Node.js 24 and npm 11 were used. `npm ci` installs from `package-lock.json`.

## Required services

`POST /api/listings/refresh` shells out to `python3 scripts/fetch_craigslist.py`. Commute and convenience calls use the Vite `/api/location` proxy and need outbound network access to public OSM and GTFS endpoints. Screenshot OCR is installed with `npm run py:sync`. Optional PostgreSQL when `DATABASE_URL` or `PGHOST` is set. No API keys are required for OSM.

## Environment prerequisites

Optional source override: `ROOST_LISTING_SOURCES`. The dev server reads `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` for demo listings. Those names are not exposed to the browser. If either is unset, `GET /api/demo-listings` returns a fallback and the page uses local sample fixtures. Do not put secrets in this file or in `.env`.

## Startup commands

From this project directory, install pinned Python OCR deps, then bind localhost only:

```bash
npm run py:sync
npm run dev -- --host 127.0.0.1 --port <port>
```

Party Preview:

```bash
party preview start --port <port> -- npm run dev -- --host 127.0.0.1 --port <port>
```

Allocate `<port>` with `party port allocate` first.

## Host, port, and networking

The dev server must listen on `127.0.0.1`, not `0.0.0.0`. Vite is configured with `server.allowedHosts: true` and `server.hmr.clientPort: 443` so the Preview tunnel can load the app and hot reload.

## Verification

`GET /` returns 200 and the page title is `Roost — sample housing search` until real listings load. `GET /api/listings` returns JSON. The area field is `#area`. The destination field is `#destination`. A search for Sunnyvale with at least one priority shows sample listing cards only when no user-provided or scraped listing is available. If a real listing exists, samples are excluded and a non-matching area stays empty. Commute results appear after a destination is entered and require the location proxy. Craigslist refresh is optional for that check. The browser-only group demo is at `#/groups`.

## Quirks and troubleshooting

- Do not pass `--host 0.0.0.0`.
- Production output goes to `PARTY_OUTPUT_DIR` when set, otherwise `dist`.
- Browser storage key is `roost-prototype-v1`. Reset in the UI clears it.
