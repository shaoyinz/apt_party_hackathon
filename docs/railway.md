# Railway deployment

Merges to `main` deploy one combined frontend and API service after checks pass. Pull requests run the same checks and cannot deploy.

## Target

| Name | Value |
| --- | --- |
| Project | Apt (`18fc9f9e-b67d-4095-8033-64fab3a82ce9`) |
| Environment | production (`23d46e3f-e318-4abf-9936-15d68917f15e`) |
| Service | roost (`dd181a3d-c3e6-4b32-a943-029573fe3509`) |
| Volume | roost-volume (`f70010a6-ac8b-423e-83c8-e0575db40ad6`), mount `/data` |
| Public URL | `https://roost-production-c7d0.up.railway.app` |

No other Railway service existed when this target was created. Do not add a second production service without choosing it explicitly.

## What runs

`.github/workflows/ci.yml` installs the lockfile, runs `npm run py:sync`, `npm test`, and `npm run build` on pull requests and on `main`. The deploy job runs only for a push to `main`, and only that job receives `RAILWAY_TOKEN`. It uploads the checked commit with `railway up`. A queued older commit skips itself when `origin/main` has moved, so it does not overwrite a newer release. The production concurrency group does not cancel an in-progress release.

The image builds the Vite bundle, installs OCR dependencies from `uv.lock`, applies applicable SQL, then starts `server/production.mjs`. That process serves `dist` and the listing, location, import, and Zillow-cache routes. It does not use the Vite dev server.

## Environment variable names

Set these on the Railway service. Never commit values.

- `RAILWAY_TOKEN` — GitHub Actions secret only. It is a project token for the production environment. It is not a frontend variable.
- `ROOST_DATA_DIR` — `/data` in production, the volume mount for uploaded listing images.
- `ROOST_STRICT_HEALTH` — `true` in the image. `/api/health` returns 503 when OCR is unavailable, or when `DATABASE_URL` is set and the database ping fails. The body includes `ocrReason` when OCR is unavailable. The image installs `libgl1`, `libglib2.0-0`, and the X11 libraries that `opencv-python` needs on Debian slim.
- `DATABASE_URL` or `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGSSLMODE`
- `DB_SCHEMA`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
- `ROOST_PYTHON`, `PORT` (Railway sets `PORT`)

`VITE_*` values are baked at image build time. Put them in the Railway service before a deploy if the browser should call Supabase directly.

## Database

The repository does not contain the nine-table listing schema (`groups`, `members`, `listings`, `attribute_definitions`, `listing_attributes`). `supabase/001_demo_listings.sql` and `supabase/002_redfin_listings.sql` assume that schema already exists and are not applied automatically. Do not point a new empty PostgreSQL database at those files.

`supabase/002_zillow_sale_cache.sql` is self-contained. `scripts/migrate.mjs` applies it once when `DATABASE_URL` or `PGHOST` is set, and records the filename in `public.schema_migrations`. A migration error exits before the server listens, so the release fails. Existing rows are not deleted. If those variables are unset, migrations are skipped, listing save stays unavailable, and `GET /api/zillow-sales` returns 503. That is not a successful database release.

No Railway PostgreSQL service was created. The project token could not run `railway add`, and creating an empty database would not satisfy the missing base schema. Keep the existing Supabase project when those credentials are available. Set `DATABASE_URL` to that database only if its role can write the tables the server uses and can apply `002`.

## Files that must survive redeploy

- Uploaded screenshots under `$ROOST_DATA_DIR/listings/` must stay on the `/data` volume.
- `data/import-cache.json` and `.cache/gtfs` are regenerable. A refresh or the next transit request rebuilds them.
- The Zillow sale cache lives in Postgres, not on the volume. The example cron in `deploy/zillow-refresh.cron` is not installed on Railway.

## Retry and rollback

Retry a failed main workflow from GitHub Actions. Do not deploy from a pull request.

Application rollback is a new deploy of a known-good commit, or Railway's previous deployment rollback for service `roost`. That does not undo database rows. `002` is additive. Recovering listing or sale-cache data requires a database backup restore, which this repository does not automate.

## Checks after deploy

`scripts/verify-deploy.mjs` waits for `/`, `/api/health` with OCR available, `/api/listings`, and `POST /api/location/suggest`. A failed check prints the response body and fails the workflow.
