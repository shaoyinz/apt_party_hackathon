import { describe, it, expect, vi } from "vitest";
vi.mock("./supabase", () => ({ supabase: {} }));
import { adaptListing } from "./listings";
describe("Supabase listing adapter", () => {
  it("preserves unknowns and maps demo fields", () => {
    const listing = adaptListing({
      id: "db-id", demo_fixture_id: "fixture-1", title: "Test",
      city: "Sunnyvale", neighborhood: "Downtown Sunnyvale",
      price_monthly: null, beds: 1, sqft: 500,
      room_type: "private_room", furnished: null,
      pets: null, parking: "yes", lease_months: 6,
      demo_commute_minutes: 15,
    });
    expect(listing.id).toBe("fixture-1");
    expect(listing.rent).toBeNull();
    expect(listing.pets).toBeNull();
    expect(listing.parking).toBe(true);
    expect(listing.roomLabel).toBe("Private room");
  });
});
