# Local preview

Verified for the Roost prototype in this project directory. The Vite dev server exposes `/api/listings` for Craigslist import and `/api/imports` for bring-your-own listings. Sample search needs no database. Database and OCR credentials are optional.

## Dependency setup

```bash
npm ci
```

Node.js 24 and npm 11 were used. `npm ci` installs from `package-lock.json`.

## Required services

None for the sample UI. `POST /api/listings/refresh` shells out to `python3 scripts/fetch_craigslist.py`. Optional PostgreSQL when `DATABASE_URL` or `PGHOST` is set. Screenshot OCR uses `python3 -m pip install -r scripts/requirements-ocr.txt`. Variable names are in `.env.example`.

## Environment prerequisites

Optional source override: `ROOST_LISTING_SOURCES`. `.env.example` lists `XDG_CACHE_HOME` and `PARTY_OUTPUT_DIR` by name only. Do not put secrets in this file or in `.env`.

## Startup commands

From this project directory, bind localhost only:

```bash
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

`GET /` returns 200 and the page title is `Roost — sample housing search`. `GET /api/listings` returns JSON. The area field is `#area`. A search for Sunnyvale with at least one priority shows sample listing cards. Craigslist refresh is optional for that check.

## Quirks and troubleshooting

- Do not pass `--host 0.0.0.0`.
- Production output goes to `PARTY_OUTPUT_DIR` when set, otherwise `dist`.
- Browser storage key is `roost-prototype-v1`. Reset in the UI clears it.
