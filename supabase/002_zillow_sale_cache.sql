-- Dedicated Zillow for-sale cache. Does not alter public.listings, price_monthly, or rental source checks.
-- Reads are served by the app server. Row level security blocks anonymous table access.
-- The job connection is expected to be the table owner or another role that bypasses RLS.

CREATE TABLE IF NOT EXISTS public.zillow_sale_snapshots (
    search_url text PRIMARY KEY,
    status text NOT NULL CHECK (status IN ('ok', 'empty')),
    row_count integer NOT NULL CHECK (row_count >= 0),
    truncated boolean NOT NULL DEFAULT false CHECK (truncated = false),
    data_origin text NOT NULL,
    provider text NOT NULL,
    http_status integer,
    fetched_at timestamptz,
    published_at timestamptz NOT NULL,
    skipped_without_identity integer NOT NULL DEFAULT 0 CHECK (skipped_without_identity >= 0)
);

CREATE TABLE IF NOT EXISTS public.zillow_sale_rows (
    search_url text NOT NULL REFERENCES public.zillow_sale_snapshots (search_url) ON DELETE CASCADE,
    source_identity text NOT NULL,
    pricing text,
    asking_price_usd numeric(12, 2),
    price_type text,
    size text,
    living_area text,
    address text,
    listing_url text,
    data_origin text NOT NULL,
    fetched_at timestamptz,
    PRIMARY KEY (search_url, source_identity),
    CHECK (asking_price_usd IS NULL OR asking_price_usd >= 0),
    CHECK (price_type IS NULL OR price_type IN ('asking_price', 'monthly_rent'))
);

CREATE TABLE IF NOT EXISTS public.zillow_refresh_runs (
    id uuid PRIMARY KEY,
    search_url text NOT NULL,
    started_at timestamptz NOT NULL,
    finished_at timestamptz,
    outcome text NOT NULL,
    http_status integer,
    error_category text,
    provider text NOT NULL,
    row_count integer,
    truncated boolean,
    skipped_without_identity integer,
    data_origin text
);

CREATE INDEX IF NOT EXISTS zillow_refresh_runs_search_started
    ON public.zillow_refresh_runs (search_url, started_at DESC);

ALTER TABLE public.zillow_sale_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zillow_sale_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zillow_refresh_runs ENABLE ROW LEVEL SECURITY;
