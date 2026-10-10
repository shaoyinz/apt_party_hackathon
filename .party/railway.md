# Railway

Verified 2026-10-10 with the project token (`RAILWAY_TOKEN` / `SECRET_RAILWAY_TOKEN`), not an account token.

- GraphQL `Project-Access-Token` resolves project Apt `18fc9f9e-b67d-4095-8033-64fab3a82ce9`, environment production `23d46e3f-e318-4abf-9936-15d68917f15e`.
- `railway whoami` and `railway link` return unauthorized for this token. `railway add --database postgres` cannot run until the project is linked.
- Service `roost` (`dd181a3d-c3e6-4b32-a943-029573fe3509`) and volume `roost-volume` mounted at `/data` were created through the GraphQL API. Public domain: `roost-production-c7d0.up.railway.app`.
- No database service existed. Do not apply `supabase/001_demo_listings.sql` or `supabase/002_redfin_listings.sql` to an empty database. Apply only `supabase/002_zillow_sale_cache.sql` when `DATABASE_URL` or `PGHOST` is set.
