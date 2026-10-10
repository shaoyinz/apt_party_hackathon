# Roost interactive prototype

Scratch version of Roost for solo renters and roommate households. Sample fixtures still ship with the app. A dev-server importer can add unverified Craigslist posts. Bring your own listing can extract a public link or screenshots, then save to PostgreSQL when database credentials are configured. Commute and convenience calculations use public OpenStreetMap services and published VTA/Caltrain schedules. No API keys are required for those location services.

## Status

Runnable local prototype. Craigslist search import is included in the dev server. Commute routing and convenience scores are calculated when the dev server can reach the documented location services. Maps, Telegram, collaboration, and AI reviews are not included.

## Setup

From this project directory:

```bash
npm ci
npm run py:sync
npm run dev
```

The dev server binds to `127.0.0.1` and serves `/api/listings`. Pass `--port <port>` when a specific port is required. Open the printed local URL.

Copy `.env.example` to `.env` if you want a local env file. No values are required, and `.env` is not committed.

```bash
npm test
npm run build
```

`npm test` checks filtering, ranking, unknown-data handling, export contents, storage recovery, convenience scoring, transit duration, and stale requests. `npm run build` writes the production bundle to `PARTY_OUTPUT_DIR` when that variable is set, otherwise `dist`.

```bash
npm run smoke:location
```

The smoke check geocodes Mountain View Caltrain, requests an OSM driving route, queries nearby amenities, and plans a scheduled VTA/Caltrain journey from Sunnyvale Station to Mountain View Station for 2026-10-10 09:00 America/Los_Angeles. It downloads GTFS into `GTFS_CACHE_DIR` or `.cache/gtfs` on first use. A static `npm run build` does not include the location proxy; use `npm run dev` for calculations.

## Scope

1. Enter an ideal South Bay city or neighborhood, choose solo or roommate hunting, and optionally set a total monthly rent ceiling.
2. Select and order the features that matter.
3. Review explained sample matches, mark useful listings, and leave notes.
4. Download a JSON summary to share manually when refining the PRD.

Roommate mode stores a household size of 2–4. It does not send invitations or open a shared board. Bedroom count is not treated as occupancy eligibility.

## Ranking

Area matching compares the trimmed, lowercased query, with internal whitespace collapsed, to each fixture city and neighborhood. An unknown area returns no listings. Roost does not substitute a nearby city.

If a total monthly budget is entered, a listing stays only when its known total rent is less than or equal to that amount. Unknown rent never passes a budget ceiling.

Selected priorities are weighted from most to least important. With `n` priorities, rank 1 has weight `n`, rank 2 has weight `n - 1`, and the last has weight 1. A listing score is the sum of `weight × feature score`. Feature scores are from 0 to 1:

- **Commute:** 0 when the current calculation is unavailable; otherwise `(60 - minutes) / 60`, clamped. Minutes come only from the current destination and mode. Fixed sample minutes are not a calculation.
- **Convenience:** 0 when unavailable; otherwise `score / 100`. The score is the rounded sum of four category contributions, each `25 × max(0, 1 − distanceMeters / 1000)`, using the nearest unique OSM feature. Geographic distance, not a walking route. A failed query is unavailable, not zero.
- **Lower price:** 0 when rent is unknown; otherwise `(5000 - rent) / 4000`, clamped.
- **More space:** 0 when both square footage and beds are unknown; otherwise square footage / 1400, or beds / 4 if square footage is missing.
- **Furnished, pets, parking:** 1 only when the fact is explicitly true. False and unknown score 0.
- **Lease flexibility:** 1 when the known term is six months or less. Longer and unknown terms score 0.

Sort by score descending, then listing id ascending. The same inputs always produce the same order.

A known favorable fact is described as a match. A known unfavorable fact is a tradeoff and can still add a partial score. An unknown fact adds zero and is never described as a match.

Contrasting Sunnyvale fixtures, with no budget:

- `sunnyvale-thrift` (Maple Court 1BR, $2100) ranks first when Lower price is ahead of Commute and the calculated commutes are 46 and 14 minutes.
- `sunnyvale-close` (Murphy Station 3BR, $4300) ranks first when Commute is ahead of Lower price for those same calculated minutes.

## Craigslist import

The default source is Craigslist South Bay apartments: `https://sfbay.craigslist.org/search/sby/apa`. Change `sources.json`, or set `ROOST_LISTING_SOURCES` to a comma-separated list of Craigslist search URLs, without editing fixtures. The fetcher rejects non-Craigslist hosts.

No Facebook cookies are used. Facebook group refresh stopped after a login page. Zillow, Redfin, Marketplace, and Apartments.com are not fetched.

Refresh from the Craigslist import panel, which calls `POST /api/listings/refresh`. The fetcher is `scripts/fetch_craigslist.py`. It reads one search page per source, keeps at most 8 posts, times out at 20 seconds, and waits at least 60 seconds between refresh attempts. A failed refresh keeps `data/import-cache.json` and its last successful timestamp. That directory is gitignored.

Craigslist apartment prices are treated as monthly rents. A title that says room or sublet is not labeled as a whole unit. City comes from the listing title or location text, not from the South Bay search name. Unknown amenities stay unknown. Sample commute estimates are not copied onto imported posts.

### Live check

On 2026-10-10 the fetcher read the South Bay apartments search, retrieved 8 posts, and accepted 8. One source link was `https://www.craigslist.org/view/d/sunnyvale-delightful-home/324Az84i8ksG3ApxZ8Js2c`. Cities included Sunnyvale, Santa Clara, Milpitas, Los Gatos, and San Jose. Two posts had no explicit city and were not assigned South Bay.

## Sample limitations

Fixtures cover Sunnyvale, Santa Clara, Mountain View, Cupertino, and San Jose, plus named neighborhoods such as Downtown Sunnyvale, Castro Street, Santana Row, and Cupertino Village. They are not live availability, verified reviews, or real commute routes. Suggestions are listed in the area field.

## Privacy and feedback sharing

Search inputs, useful listings, notes, and general feedback are stored in this browser under `roost-prototype-v1`. Reload restores them when storage works. Reset clears that saved copy and the current form.

If storage is unavailable or the saved payload is invalid, Roost keeps working in memory, explains the limitation, and still allows search and export.

Download JSON (`roost-search-feedback.json`) is created only when you click Download JSON. It includes schema version 2, `sampleData`, `includesImportedData`, live-import status, commute inputs, timezone, metric values and statuses, origin precision, source labels, the current area, hunting mode, household size, optional total budget, ordered priorities, useful listing ids, titles, notes, origin, source URL, match status, and general feedback. Roost does not submit it. Share the file yourself if the team should see it. PRD edits stay a human decision. Older saved browser payloads without commute fields still load.

## Deferred integrations

Marketplace, Zillow, Redfin, Facebook group scraping, Telegram, maps, invitations, voting, realtime collaboration, external reviews, and webhook hosting are out of scope. Do not treat any control in this prototype as one of those services.

Bring your own listing is documented in [docs/bring-your-own-listing.md](docs/bring-your-own-listing.md). Sample fixtures and Craigslist imports stay separately labeled.

## Location services

The Vite dev server proxies `/api/location/*`. The browser does not hold credentials. Defaults, all public and keyless:

- Address suggestions: `https://photon.komoot.io` (OpenStreetMap autocomplete, biased toward the South Bay)
- Geocoding: `https://nominatim.openstreetmap.org`
- Street routes: `https://router.project-osrm.org` profiles `driving`, `bike`, and `foot`
- Amenities: Overpass, trying `https://lz4.overpass-api.de/api/interpreter`, then `https://overpass.openstreetmap.fr/api/interpreter`, then `https://overpass.osm.ch/api/interpreter`
- Transit: local planner using Caltrain GTFS (`https://data.trilliumtransit.com/gtfs/caltrain-ca-us/caltrain-ca-us.zip`) and VTA GTFS (`https://gtfs.vta.org/gtfs_vta.zip`), plus OSM walking connections from OSRM. At most one transfer. Set `OTP_BASE_URL` to use a local OpenTripPlanner `/otp/routers/default/plan` endpoint instead.

Override names are listed in `.env.example`. Do not commit endpoint credentials or downloaded feeds. First transit request loads GTFS into `.cache/gtfs`. Results are scheduled estimates in America/Los_Angeles. Live delays, fares, and live traffic are not included. Credit [OpenStreetMap contributors](https://www.openstreetmap.org/copyright).

## Checks

Party runs the argv commands in `.party/checks.json` from this directory: dependency install, tests, and production build. The wrapper sends npm's cache to `XDG_CACHE_HOME` when that variable is set. Build artifacts go to `PARTY_OUTPUT_DIR` when set.
