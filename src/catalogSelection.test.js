import { describe, expect, it } from "vitest";
import { isRealListing, isSampleListing, selectCatalog } from "./catalogSelection";

const sample = { id: "sunnyvale-close", title: "Sample", origin: "sample", source: "Sample fixture", rent: 2000, coordinates: { lat: 1, lon: 2 } };
const demoDb = { id: "db-1", title: "Database fixture", rent: 1800, city: "Sunnyvale" };
const user = { id: "user-1", title: "My listing", origin: "user-provided", sampleData: false, city: "Palo Alto", rent: 2400 };
const imported = { id: "cl-1", title: "Imported", origin: "imported", city: "San Jose", rent: 2100 };
const scraped = { id: "sale-1", title: "Scraped sale", origin: "redfin", rentBasis: "for-sale", rent: null, salePriceText: "$900,000", city: "Mountain View" };

describe("catalog selection", () => {
    it("keeps labeled samples only after sources settle with no real data", () => {
        const selected = selectCatalog({ samples: [sample, demoDb], sourcesSettled: true });
        expect(selected.mode).toBe("sample");
        expect(selected.sampleData).toBe(true);
        expect(selected.listings.map((listing) => listing.id)).toEqual(["sunnyvale-close", "db-1"]);
        expect(selected.listings.every((listing) => listing.source === "Sample fixture" && listing.sampleData === true)).toBe(true);
        expect(isSampleListing(demoDb)).toBe(true);
        expect(isRealListing(demoDb)).toBe(false);
    });

    it("does not present samples while sources are still loading", () => {
        const selected = selectCatalog({ samples: [sample], sourcesSettled: false });
        expect(selected.mode).toBe("loading");
        expect(selected.listings).toEqual([]);
        expect(selected.sampleData).toBe(false);
    });

    it("drops every sample when only a user listing, only scraped listings, or both real sources exist", () => {
        const userOnly = selectCatalog({ samples: [sample, demoDb], userProvided: [user], sourcesSettled: true });
        const scrapedOnly = selectCatalog({ samples: [sample], scraped: [scraped], sourcesSettled: true });
        const both = selectCatalog({ samples: [sample, demoDb], imported: [imported], userProvided: [user], scraped: [scraped], sourcesSettled: true });
        expect(userOnly.listings).toEqual([user]);
        expect(scrapedOnly.listings).toEqual([scraped]);
        expect(both.listings.map((listing) => listing.id)).toEqual(["cl-1", "user-1", "sale-1"]);
        expect(both.listings.some((listing) => listing.coordinates)).toBe(false);
        expect(both.sampleData).toBe(false);
    });

    it("does not restore samples after real mode or a failed source check", () => {
        const failed = selectCatalog({ samples: [sample], sourcesSettled: true, sourceError: "Refresh failed.", realModeReached: true });
        const emptyAfterReal = selectCatalog({ samples: [sample], sourcesSettled: true, realModeReached: true });
        const cached = selectCatalog({
            samples: [sample],
            imported: [imported],
            sourcesSettled: true,
            sourceError: "Refresh failed.",
            realModeReached: true,
        });
        expect(failed.mode).toBe("unavailable");
        expect(failed.listings).toEqual([]);
        expect(emptyAfterReal.mode).toBe("unavailable");
        expect(cached.mode).toBe("real");
        expect(cached.listings).toEqual([imported]);
        expect(cached.stale).toBe(true);
        expect(cached.detail).toMatch(/Refresh failed/);
        expect(cached.detail).toMatch(/Sample fixtures were not added/);
    });
});
