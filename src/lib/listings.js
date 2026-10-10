import { supabase } from "./supabase";

export const DEMO_GROUP_ID = "d0e00000-0000-4000-8000-000000000001";

function triState(value) {
  if (value === true || value === false || value == null) return value;
  const normalized = String(value).trim().toLowerCase();
  if (["yes", "true", "allowed", "included", "available"].includes(normalized)) return true;
  if (["no", "false", "not allowed", "not included", "unavailable"].includes(normalized)) return false;
  return null;
}

export function adaptListing(row) {
  const roomLabel = row.room_type === "private_room"
    ? "Private room"
    : row.room_type === "shared"
      ? "Shared room"
      : row.beds === 0 ? "Studio"
        : row.beds == null ? "Room type unknown"
          : `${row.beds} bedroom${row.beds === 1 ? "" : "s"}`;
  return {
    id: row.demo_fixture_id || row.id,
    title: row.title,
    city: row.city ?? "",
    neighborhood: row.neighborhood ?? "",
    rent: row.price_monthly == null ? null : Number(row.price_monthly),
    beds: row.beds,
    sqft: row.sqft,
    roomLabel,
    furnished: row.furnished,
    pets: triState(row.pets),
    parking: triState(row.parking),
    leaseMonths: row.lease_months,
    commuteMinutes: row.demo_commute_minutes,
  };
}

export async function fetchDemoListings() {
  if (!supabase)
    return [];
  const { data, error } = await supabase
    .from("listings")
    .select("id,demo_fixture_id,title,city,neighborhood,price_monthly,beds,sqft,room_type,furnished,pets,parking,lease_months,demo_commute_minutes")
    .eq("group_id", DEMO_GROUP_ID)
    .eq("source", "seed")
    .order("demo_fixture_id");
  if (error) throw error;
  return (data ?? []).map(adaptListing);
}
