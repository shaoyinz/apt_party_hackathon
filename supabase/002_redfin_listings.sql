-- Separate from public.listings. Redfin prices are for-sale display prices,
-- never price_monthly. Run in the Supabase SQL editor after 001_demo_listings.sql.
-- The dev server also creates this table when DATABASE_URL or PGHOST is set.
CREATE TABLE IF NOT EXISTS public.redfin_listings (
    property_url TEXT PRIMARY KEY,
    price_text TEXT,
    configuration TEXT,
    address TEXT,
    city TEXT,
    broker TEXT,
    availability TEXT,
    listing_status TEXT,
    description TEXT,
    source_page_url TEXT,
    collected_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.redfin_listings ENABLE ROW LEVEL SECURITY;

-- No anon policy. The server connection writes rows. Search reads the local
-- daily cache so a page load does not wait on Redfin or this table.
