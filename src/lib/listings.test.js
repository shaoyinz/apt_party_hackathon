import { describe, it, expect } from "vitest";
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
      source_url: "https://sfbay.craigslist.org/sby/apa/d/kept/99",
    });
    expect(listing.id).toBe("fixture-1");
    expect(listing.rent).toBeNull();
    expect(listing.pets).toBeNull();
    expect(listing.parking).toBe(true);
    expect(listing.roomLabel).toBe("Private room");
    expect(listing.sourceUrl).toBe("https://sfbay.craigslist.org/sby/apa/d/kept/99");
  });
});
