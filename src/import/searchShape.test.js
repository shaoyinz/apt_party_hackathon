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
});
