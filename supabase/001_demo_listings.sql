-- Run in Supabase SQL Editor, after the existing nine-table schema.
-- Only the dedicated, synthetic demo group's seed rows are publicly readable.
-- No private group/member/vote/comment access is granted.
BEGIN;
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS neighborhood text;
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS demo_fixture_id text;
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS demo_commute_minutes integer;
CREATE UNIQUE INDEX IF NOT EXISTS listings_demo_fixture_id_unique
  ON public.listings(demo_fixture_id);
CREATE INDEX IF NOT EXISTS listings_city_neighborhood_idx
  ON public.listings(city, neighborhood);
INSERT INTO public.groups (id, name, invite_code)
VALUES ('d0e00000-0000-4000-8000-000000000001', 'Roost synthetic demo listings', 'roost-demo-public-2026')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.listings (id, group_id, source, title, city, neighborhood, price_monthly, beds, sqft, room_type, furnished, pets, parking, lease_months, demo_fixture_id, demo_commute_minutes) VALUES
  ('a1ec4a47-b923-5f75-abb2-3fbdcbb50820', 'd0e00000-0000-4000-8000-000000000001', 'seed', 'Maple Court 1BR', 'Sunnyvale', 'Downtown Sunnyvale', 2100, 1, 520, 'entire', FALSE, 'no', 'yes', 12, 'sunnyvale-thrift', 46),
  ('2fda0223-214a-5eba-8d2d-15e91aea0384', 'd0e00000-0000-4000-8000-000000000001', 'seed', 'Murphy Station 3BR', 'Sunnyvale', 'Downtown Sunnyvale', 4300, 3, 1280, 'entire', TRUE, 'yes', 'yes', 6, 'sunnyvale-close', 14),
  ('7b89ec83-548f-5aef-83a2-c84a901d568a', 'd0e00000-0000-4000-8000-000000000001', 'seed', 'Olive Ave room, rent unlisted', 'Sunnyvale', 'Downtown Sunnyvale', NULL, 1, 180, 'private_room', NULL, NULL, NULL, NULL, 'sunnyvale-unknown-rent', NULL),
  ('2e3ecf38-9a8b-5db2-b18e-e6310d0012d8', 'd0e00000-0000-4000-8000-000000000001', 'seed', 'Franklin Mall private room', 'Santa Clara', 'Santa Clara University', 1850, 1, 400, 'private_room', TRUE, 'no', 'no', 4, 'santa-clara-room', 28),
  ('0bea22a5-a57c-5a34-8f8f-94480a455453', 'd0e00000-0000-4000-8000-000000000001', 'seed', 'Homestead garden flat', 'Santa Clara', 'Santa Clara University', 3600, 3, 1100, 'entire', FALSE, 'yes', 'yes', 12, 'santa-clara-house', 32),
  ('d9d4f1af-0997-53c4-8732-7b8de33a57e9', 'd0e00000-0000-4000-8000-000000000001', 'seed', 'Castro walk-up', 'Mountain View', 'Castro Street', 3900, 2, 900, 'entire', FALSE, 'no', 'no', 12, 'mv-castro', 8),
  ('fd8a754f-015d-51d7-aeb1-f0cbde6ad81d', 'd0e00000-0000-4000-8000-000000000001', 'seed', 'Shoreline furnished 2BR', 'Mountain View', 'Castro Street', 3100, 2, 850, 'entire', TRUE, NULL, 'yes', 6, 'mv-furnished', 18),
  ('661c9926-2117-559c-9542-b39f345ba09d', 'd0e00000-0000-4000-8000-000000000001', 'seed', 'Village Oaks 3BR', 'Cupertino', 'Cupertino Village', 4500, 3, 1350, 'entire', FALSE, 'yes', 'yes', 12, 'cupertino-village', 22),
  ('1be7f061-fd44-5612-895d-fd7737d2b3eb', 'd0e00000-0000-4000-8000-000000000001', 'seed', 'De Anza studio', 'Cupertino', 'Cupertino Village', 2400, 0, 420, 'entire', TRUE, 'no', 'no', 3, 'cupertino-studio', 26),
  ('fbf31fe5-dd51-5fd4-b02a-1f34e01fb779', 'd0e00000-0000-4000-8000-000000000001', 'seed', 'Santana Row loft', 'San Jose', 'Santana Row', 3700, 2, 980, 'entire', TRUE, 'no', 'yes', 12, 'sj-santana', 24),
  ('f80460d2-3e66-5853-b1e0-be1d6ee60c27', 'd0e00000-0000-4000-8000-000000000001', 'seed', 'SoFA 1BR', 'San Jose', 'Downtown San Jose', 2800, 1, 640, 'entire', FALSE, 'yes', 'no', 6, 'sj-downtown', 38),
  ('0da75d0a-bbec-552c-9652-c57a234062b9', 'd0e00000-0000-4000-8000-000000000001', 'seed', 'Japantown share, size unlisted', 'San Jose', 'Downtown San Jose', 2600, NULL, NULL, 'entire', FALSE, 'no', 'yes', 12, 'sj-unknown-space', 40)
ON CONFLICT (demo_fixture_id) DO UPDATE SET
  group_id = EXCLUDED.group_id,
  source = EXCLUDED.source,
  title = EXCLUDED.title,
  city = EXCLUDED.city,
  neighborhood = EXCLUDED.neighborhood,
  price_monthly = EXCLUDED.price_monthly,
  beds = EXCLUDED.beds,
  sqft = EXCLUDED.sqft,
  room_type = EXCLUDED.room_type,
  furnished = EXCLUDED.furnished,
  pets = EXCLUDED.pets,
  parking = EXCLUDED.parking,
  lease_months = EXCLUDED.lease_months,
  demo_commute_minutes = EXCLUDED.demo_commute_minutes;

-- Restrict anonymous SELECT to this one synthetic group and only seed listings.
-- NOTE: PostgreSQL RLS policies are permissive/OR-combined. Audit any
-- additional SELECT policies before using this alongside real private groups.
ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can read synthetic Roost demo listings" ON public.listings;
CREATE POLICY "Public can read synthetic Roost demo listings"
ON public.listings FOR SELECT TO anon, authenticated
USING (
  group_id = 'd0e00000-0000-4000-8000-000000000001'::uuid
  AND source = 'seed'
);
COMMIT;
SELECT demo_fixture_id, title, city, price_monthly
FROM public.listings WHERE group_id = 'd0e00000-0000-4000-8000-000000000001'::uuid
ORDER BY demo_fixture_id;
