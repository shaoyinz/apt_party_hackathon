-- Store shared Redfin for-sale rows in public.listings.
-- Does not create a separate listings table and does not change price_monthly.
-- Run in the Supabase SQL editor after the existing listings schema and
-- supabase/001_demo_listings.sql. Private group rows stay private.
BEGIN;

ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS listing_type TEXT;
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS asking_price_usd NUMERIC(12, 2);
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS property_type TEXT;
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

UPDATE public.listings
SET listing_type = 'rental'
WHERE listing_type IS NULL
  AND source IS DISTINCT FROM 'redfin';

UPDATE public.listings
SET updated_at = created_at
WHERE updated_at IS NULL;

ALTER TABLE public.listings ALTER COLUMN updated_at SET DEFAULT NOW();

ALTER TABLE public.listings DROP CONSTRAINT IF EXISTS listings_listing_type_check;
ALTER TABLE public.listings
    ADD CONSTRAINT listings_listing_type_check
    CHECK (listing_type IS NULL OR listing_type IN ('rental', 'sale'));

ALTER TABLE public.listings DROP CONSTRAINT IF EXISTS listings_asking_price_check;
ALTER TABLE public.listings
    ADD CONSTRAINT listings_asking_price_check
    CHECK (asking_price_usd IS NULL OR asking_price_usd >= 0);

ALTER TABLE public.listings DROP CONSTRAINT IF EXISTS listings_source_check;
ALTER TABLE public.listings
    ADD CONSTRAINT listings_source_check
    CHECK (source IN ('seed', 'upload', 'link', 'text', 'telegram', 'redfin'));

INSERT INTO public.groups (id, name, invite_code)
VALUES (
    'd0e00000-0000-4000-8000-000000000002',
    'Roost shared Redfin cache',
    'roost-redfin-shared-2026'
)
ON CONFLICT (id) DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS listings_redfin_source_url_unique
    ON public.listings (source_url)
    WHERE source = 'redfin' AND source_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS listings_redfin_city_updated_idx
    ON public.listings (city, updated_at DESC)
    WHERE source = 'redfin';

ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read shared Redfin sale listings" ON public.listings;
CREATE POLICY "Public can read shared Redfin sale listings"
ON public.listings FOR SELECT TO anon, authenticated
USING (
    group_id = 'd0e00000-0000-4000-8000-000000000002'::uuid
    AND source = 'redfin'
    AND listing_type = 'sale'
);

COMMIT;
