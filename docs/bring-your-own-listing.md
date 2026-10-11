# Bring your own listing

Users import one listing from screenshots, a public listing link, or manual entry after a failed read. Confirmed facts are saved on that person's saved-listings page, or on a page they joined with an invite code.

## Flow

1. Use the **Bring your own listing** form between Craigslist import and Your saved-listings page. It stays on the page.
2. Paste an `http` or `https` URL and/or add screenshots. Limits are shown in the form: JPEG, PNG, WEBP, GIF; 8 images; 8 MB each; 24 MB total.
3. Extract, or enter facts manually. Nothing is written to `listings` before **Save listing**.
4. Correct blanks and conflicts. Ambiguous dates and nonmonthly prices stay unknown unless you type a monthly value.
5. Confirm, then save. A retry of the same save reuses one listing id.

Saved cards are labeled **User-provided, unverified** and say whether they came from a link or screenshots. They join area and budget ranking. Room rent is not treated as whole-unit rent. Sample fixtures stay separate.

## Database

The app uses the supplied `groups`, `members`, `listings`, `attribute_definitions`, and `listing_attributes` tables. It does not disable row-level security. Policies are still pending, so the server role must be able to perform the group-scoped writes the app checks itself.

Connection variable names, never values:

- `DATABASE_URL`, or `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGSSLMODE`
- `DB_SCHEMA` as the search path identifier, defaulting to `public`

`source` is `upload` for screenshot-only imports and `link` when a valid listing URL led the import, including screenshot or manual fallback. `source_url` stores that URL. `status` is `New`. `image_urls` are same-origin API paths. `raw_text` keeps extracted text. `field_confidence` stores the idempotency key, confirmed city and neighborhood, and conflict notes. It does not invent numeric confidence, ratings, or commute times. Extra amenities go to `listing_attributes` with `verified=false`.

City and neighborhood are not columns on `listings`. Confirmed values are kept in `field_confidence` so search can reload them. The server does not geocode.

If `DATABASE_URL` and `PGHOST` are unset, extract can still build a draft, and save returns an error without inserting a listing.

## Access

The browser cannot choose `group_id`. A person enters a display name to create a saved-listings page. That member id is the demo user id. **Invite others** shows the group's existing `invite_code`. Another person enters their name and that code to join the same page. A server-signed `roost_session` cookie stores the member. A wrong code does not join, and a supplied group id is ignored. An existing cookie is reused until they join a different code.

Screenshot files live under ignored `data/listings/<group>/<listing>/` and are served only to that group. Another group's cookie receives not found.

## Links and OCR

Fetches allow public HTTP(S) only, follow at most 3 redirects, stop at 8 seconds, and read at most 1.5 MB. Each hop is checked against loopback, private, link-local, and similar destinations. Login walls and blocked pages are not bypassed.

Screenshot OCR uses the project virtualenv, not a separate `tesseract` install. `pyproject.toml` and `uv.lock` pin RapidOCR. From this directory:

```bash
npm run py:sync
```

That runs `uv sync --frozen` and creates `.venv`. The API uses `.venv/bin/python`. If `uv sync` has not been run, screenshot text is not invented; the user can type the facts and still save the images.

## Checks

`npm test` covers parsing, fetch limits, ranking, confirmation, idempotency, and cross-group denial with an in-memory repository. That is not live OCR or live database proof. Report those separately when the binary and database are reachable.
