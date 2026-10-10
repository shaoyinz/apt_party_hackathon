# Local preview

Verified for the Roost prototype in this project directory. No databases, queues, or API credentials are required.

## Dependency setup

```bash
npm ci
```

Node.js 24 and npm 11 were used. `npm ci` installs from `package-lock.json`.

## Required services

None for the page itself. Commute and convenience calls from the running app use the Vite `/api/location` proxy, which needs outbound network access to public OSM and GTFS endpoints. No API keys.

## Environment prerequisites

None for the app. `.env.example` lists `XDG_CACHE_HOME` and `PARTY_OUTPUT_DIR` by name only. Party checks may set those variables. Do not put secrets in this file or in `.env`.

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

`GET /` returns 200 and the page title is `Roost — sample housing search`. The area field is `#area`. The destination field is `#destination`. A search for Sunnyvale with at least one priority shows sample listing cards. Commute results appear after a destination is entered; they require the location proxy and outbound network.

## Quirks and troubleshooting

- Do not pass `--host 0.0.0.0`.
- Production output goes to `PARTY_OUTPUT_DIR` when set, otherwise `dist`.
- Browser storage key is `roost-prototype-v1`. Reset in the UI clears it.
