# Local preview

Verified for the Roost prototype in this project directory. No databases, queues, or API credentials are required.

## Dependency setup

```bash
npm ci
```

Node.js 24 and npm 11 were used. `npm ci` installs from `package-lock.json`.

## Required services

None. Listings are local fixtures.

## Environment prerequisites

None for the app. Party checks may set `XDG_CACHE_HOME` and `PARTY_OUTPUT_DIR`. Do not put secrets in this file.

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

`GET /` returns 200 and the page title is `Roost — sample housing search`. The area field is `#area`. A search for Sunnyvale with at least one priority shows sample listing cards. No external request is required.

## Quirks and troubleshooting

- Do not pass `--host 0.0.0.0`.
- Production output goes to `PARTY_OUTPUT_DIR` when set, otherwise `dist`.
- Browser storage key is `roost-prototype-v1`. Reset in the UI clears it.
