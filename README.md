# Roost interactive prototype

Scratch version of Roost for solo renters and roommate households. It runs in the browser with sample listings only. No API keys, accounts, or network services are required.

## Status

Runnable local prototype. Live listing search, maps, Telegram, commute routing, collaboration, and AI reviews are not included.

## Setup

From this project directory:

```bash
npm ci
npm run dev
```

The dev server binds to `127.0.0.1`. Pass `--port <port>` when a specific port is required. Open the printed local URL.

Copy `.env.example` to `.env` if you want a local env file. No values are required, and `.env` is not committed.

```bash
npm test
npm run build
```

`npm test` checks filtering, ranking, unknown-data handling, export contents, and storage recovery. `npm run build` writes the production bundle to `PARTY_OUTPUT_DIR` when that variable is set, otherwise `dist`.

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

- **Commute:** 0 when unknown; otherwise `(60 - minutes) / 60`, clamped. Minutes are sample estimates to Mountain View Caltrain station, not a calculated route.
- **Lower price:** 0 when rent is unknown; otherwise `(5000 - rent) / 4000`, clamped.
- **More space:** 0 when both square footage and beds are unknown; otherwise square footage / 1400, or beds / 4 if square footage is missing.
- **Furnished, pets, parking:** 1 only when the fact is explicitly true. False and unknown score 0.
- **Lease flexibility:** 1 when the known term is six months or less. Longer and unknown terms score 0.

Sort by score descending, then listing id ascending. The same inputs always produce the same order.

A known favorable fact is described as a match. A known unfavorable fact is a tradeoff and can still add a partial score. An unknown fact adds zero and is never described as a match.

Contrasting Sunnyvale fixtures, with no budget:

- `sunnyvale-thrift` (Maple Court 1BR, $2100, 46 min sample commute) ranks first when Lower price is ahead of Commute.
- `sunnyvale-close` (Murphy Station 3BR, $4300, 14 min sample commute) ranks first when Commute is ahead of Lower price.

## Sample limitations

Fixtures cover Sunnyvale, Santa Clara, Mountain View, Cupertino, and San Jose, plus named neighborhoods such as Downtown Sunnyvale, Castro Street, Santana Row, and Cupertino Village. They are not live availability, verified reviews, or real commute routes. Suggestions are listed in the area field.

## Privacy and feedback sharing

Search inputs, useful listings, notes, and general feedback are stored in this browser under `roost-prototype-v1`. Reload restores them when storage works. Reset clears that saved copy and the current form.

If storage is unavailable or the saved payload is invalid, Roost keeps working in memory, explains the limitation, and still allows search and export.

Download JSON (`roost-search-feedback.json`) is created only when you click Download JSON. It includes schema version 1, `sampleData: true`, the current area, hunting mode, household size, optional total budget, ordered priorities, useful listing ids, titles, notes, match status, and general feedback. Roost does not submit it. Share the file yourself if the team should see it. PRD edits stay a human decision.

## Deferred integrations

Listing ingestion, scraping, screenshots, Telegram, geocoding, maps, real commute calculations, invitations, voting, realtime collaboration, external reviews, shared databases, and webhook hosting are out of scope. Do not treat any control in this prototype as one of those services.

## Checks

Party runs the argv commands in `.party/checks.json` from this directory: dependency install, tests, and production build. The wrapper sends npm's cache to `XDG_CACHE_HOME` when that variable is set. Build artifacts go to `PARTY_OUTPUT_DIR` when set.
