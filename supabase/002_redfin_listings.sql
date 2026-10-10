-- City cache for Redfin. Not public.listings.
-- price_text is a for-sale display price or a rental price, selected by listing_type.
-- Never copy for-sale price_text into listings.price_monthly.
CREATE TABLE IF NOT EXISTS public.redfin_listings (
    property_url TEXT PRIMARY KEY,
    city TEXT NOT NULL,
    source_url TEXT NOT NULL,
    listing_type TEXT NOT NULL CHECK (listing_type IN ('rental', 'for-sale')),
    price_text TEXT,
    configuration TEXT,
    address TEXT,
    availability TEXT,
    listing_status TEXT,
    source_page_url TEXT,
    collected_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.redfin_listings ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE public.redfin_listings ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE public.redfin_listings ADD COLUMN IF NOT EXISTS listing_type TEXT;
ALTER TABLE public.redfin_listings ADD COLUMN IF NOT EXISTS price_text TEXT;
ALTER TABLE public.redfin_listings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS redfin_listings_city_idx ON public.redfin_listings (city);

ALTER TABLE public.redfin_listings ENABLE ROW LEVEL SECURITY;
