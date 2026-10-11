import { describe, expect, it } from "vitest";
import { rankListings } from "../matching.js";
import { toSearchListing } from "./searchShape.js";

describe("imported listing search shape", () => {
    it("keeps room rent out of the whole-unit budget filter and labels user-provided listings", () => {
        const room = toSearchListing({
            id: "room-1",
            title: "Olive room",
            city: "Sunnyvale",
            neighborhood: "Downtown Sunnyvale",
            priceMonthly: 900,
            roomType: "private_room",
            beds: 3,
            source: "upload",
            pets: "Yes",
        });
        const entire = toSearchListing({
            id: "entire-1",
            title: "Olive apartment",
            city: "Sunnyvale",
            neighborhood: "Downtown Sunnyvale",
            priceMonthly: 2400,
            roomType: "entire",
            beds: 1,
            source: "link",
            sourceUrl: "https://listing.example/olive",
        });
        expect(room.rent).toBe(900);
        expect(room.rentBasis).toBe("monthly-room");
        expect(room.sampleData).toBe(false);
        expect(entire.origin).toBe("user-provided");
        expect(entire.source).toBe("link");
        const ranked = rankListings([room, entire], "Sunnyvale", 2500, ["price"], "roommates");
        expect(ranked.eligible.map((item) => item.listing.id)).toEqual(["entire-1"]);
    });

    it("keeps a confirmed origin and does not invent commute or convenience scores", () => {
        const located = toSearchListing({
            id: "olive",
            title: "Olive",
            city: "Sunnyvale",
            address: "18 Olive Ave",
            priceMonthly: 2400,
            roomType: "entire",
            source: "upload",
            location: { lat: 37.371, lon: -122.038, precision: "address", label: "18 Olive Ave", source: "OpenStreetMap via Nominatim" },
        });
        const missing = toSearchListing({
            id: "blank",
            title: "Blank",
            city: "Sunnyvale",
            priceMonthly: 2200,
            roomType: "entire",
            source: "link",
        });
        expect(located.coordinates).toMatchObject({ lat: 37.371, precision: "address" });
        expect(located.commuteMinutes).toBeNull();
        expect(missing.coordinates).toBeNull();
        const ranked = rankListings([located, missing], "Sunnyvale", null, ["commute", "convenience"], {
            metricsById: {
                olive: { commuteStatus: "ok", commuteMinutes: 12, convenienceStatus: "ok", convenienceScore: 80 },
                blank: { commuteStatus: "missing_location", commuteMinutes: null, convenienceStatus: "missing_location", convenienceScore: null },
            },
        });
        expect(ranked.eligible.map((item) => item.listing.id)).toEqual(["olive", "blank"]);
        expect(ranked.eligible[0].matches.map((item) => item.id)).toEqual(["commute", "convenience"]);
        expect(ranked.eligible[1].matches).toEqual([]);
        expect(ranked.eligible[1].unknowns.map((item) => item.detail).join(" ")).toMatch(/unavailable/);
    });
});
