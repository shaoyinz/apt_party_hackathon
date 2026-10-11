import { describe, expect, it } from "vitest";
import { rankListings } from "./matching";
import { rentFact } from "./model";
import { adaptRedfinRow, listingsForCity, mergeCityRefresh, rowsForTarget } from "./redfinCatalog";

describe("Redfin search cache", () => {
    it("keeps a for-sale price out of monthly rent", () => {
        const listing = adaptRedfinRow({
            price: "$900,000",
            configuration: "5 beds 3 baths 2,100 sq ft",
            address: "8244 263rd St, Glen Oaks, NY 11004",
            property_url: "https://www.redfin.com/NY/Glen-Oaks/8244-263rd-St-11004/home/20793540",
            collected_at: "2026-10-10T21:40:00Z",
        });
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
        const listings = [adaptRedfinRow({
            price: "$1,250,000",
            address: "112 E 35th St, New York, NY 10016",
            property_url: "https://www.redfin.com/NY/New-York/112-E-35th-St-10016/home/45333496",
        })];
        const open = rankListings(listings, "New York", null, ["price"]);
        expect(open.areaKnown).toBe(true);
        expect(open.eligible).toEqual([]);
        const capped = rankListings(listings, "New York", 3000, ["price"]);
        expect(capped.eligible).toEqual([]);
        expect(capped.excludedUnknownRent).toBe(0);
        expect(capped.excludedForSale).toBe(1);
        expect(rankListings(listings, "Sunnyvale", null, ["price"]).areaKnown).toBe(false);
    });

    it("returns only the searched city and keeps the previous city cache when refresh fails", () => {
        const rows = rowsForTarget([
            { price: "$900,000", address: "1 Main St, Sunnyvale, CA 94086", property_url: "https://www.redfin.com/CA/Sunnyvale/home/1" },
            { price: "$1", address: "2 Other St, San Jose, CA 95110", property_url: "https://www.redfin.com/CA/San-Jose/home/2" },
        ], "Sunnyvale", "for-sale");
        expect(rows).toHaveLength(1);
        expect(listingsForCity(rows, "San Jose")).toEqual([]);
        const previous = rows;
        const failed = mergeCityRefresh(previous, "Sunnyvale", "for-sale", { ok: false });
        expect(failed.preserved).toBe(true);
        expect(failed.listings).toHaveLength(1);
        const replaced = mergeCityRefresh(previous, "Sunnyvale", "for-sale", { ok: true, listings: [] });
        expect(replaced.listings).toEqual([]);
    });
});
