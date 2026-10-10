import { describe, expect, it } from "vitest";
import { rankListings } from "./matching";
import { rentFact } from "./model";
import { adaptRedfinRows, cacheIsFresh, cityFromAddress } from "./redfinCatalog";

describe("Redfin search cache", () => {
    it("keeps a for-sale price out of monthly rent", () => {
        const [listing] = adaptRedfinRows([{
            price: "$900,000",
            configuration: "5 beds 3 baths 2,100 sq ft",
            address: "8244 263rd St, Glen Oaks, NY 11004",
            property_url: "https://www.redfin.com/NY/Glen-Oaks/8244-263rd-St-11004/home/20793540",
            collected_at: "2026-10-10T21:40:00Z",
        }]);
        expect(listing.rent).toBeNull();
        expect(listing.rentBasis).toBe("for-sale");
        expect(listing.salePriceText).toBe("$900,000");
        expect(listing.city).toBe("Glen Oaks");
        expect(listing.beds).toBe(5);
        expect(listing.sqft).toBe(2100);
        expect(listing.sampleData).toBe(false);
        expect(rentFact(listing, "solo")).toContain("Not monthly rent");
        expect(rentFact(listing, "solo")).not.toContain("total monthly rent");
    });

    it("matches the parsed city and does not pass a rent ceiling", () => {
        const listings = adaptRedfinRows([{
            price: "$1,250,000",
            address: "112 E 35th St, New York, NY 10016",
            property_url: "https://www.redfin.com/NY/New-York/112-E-35th-St-10016/home/45333496",
        }]);
        const open = rankListings(listings, "New York", null, ["price"]);
        expect(open.eligible).toHaveLength(1);
        expect(open.eligible[0].listing.rent).toBeNull();
        const capped = rankListings(listings, "New York", 3000, ["price"]);
        expect(capped.eligible).toEqual([]);
        expect(capped.excludedUnknownRent).toBe(0);
        expect(capped.excludedForSale).toBe(1);
        expect(rankListings(listings, "Sunnyvale", null, ["price"]).areaKnown).toBe(false);
    });

    it("does not refresh a collection younger than a day", () => {
        const now = Date.parse("2026-10-10T21:00:00Z");
        expect(cacheIsFresh({ status: "ready", attemptedAt: "2026-10-10T20:00:00Z" }, now)).toBe(true);
        expect(cacheIsFresh({ status: "blocked", attemptedAt: "2026-10-09T20:00:00Z" }, now)).toBe(false);
        expect(cityFromAddress("112 E 35th St, New York, NY 10016")).toBe("New York");
    });
});
