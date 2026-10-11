import { describe, expect, it } from "vitest";
import { LISTINGS } from "./fixtures";
import { rankListings } from "./matching";
import { AREA_SUGGESTIONS, validateSearch } from "./model";
const cities = ["Sunnyvale", "Santa Clara", "Mountain View", "Cupertino", "San Jose"];
function draft(overrides = {}) {
    return {
        area: "Sunnyvale",
        mode: "solo",
        householdSize: null,
        budgetText: "",
        priorities: ["price"],
        ...overrides,
    };
}
describe("area and budget filtering", () => {
    it("covers five cities and named neighborhoods", () => {
        for (const city of cities) {
            expect(LISTINGS.some((listing) => listing.city === city)).toBe(true);
        }
        for (const name of ["Downtown Sunnyvale", "Castro Street", "Santana Row", "Cupertino Village"]) {
            expect(LISTINGS.some((listing) => listing.neighborhood === name)).toBe(true);
        }
        for (const suggestion of AREA_SUGGESTIONS) {
            expect(rankListings(LISTINGS, suggestion, null, ["price"]).areaKnown).toBe(true);
        }
    });
    it("matches city and neighborhood ignoring case and surrounding whitespace", () => {
        const sunnyvale = rankListings(LISTINGS, "  SUNNYVALE  ", null, ["price"]);
        expect(sunnyvale.eligible.map((item) => item.listing.id)).toContain("sunnyvale-thrift");
        const neighborhood = rankListings(LISTINGS, "  santana row  ", null, ["price"]);
        expect(neighborhood.eligible.map((item) => item.listing.id)).toEqual(["sj-santana"]);
    });
    it("does not substitute an unsupported area", () => {
        const outcome = rankListings(LISTINGS, "Palo Alto", null, ["price"]);
        expect(outcome.areaKnown).toBe(false);
        expect(outcome.eligible).toEqual([]);
    });
    it("applies a total-rent ceiling and rejects unknown rent", () => {
        const open = rankListings(LISTINGS, "Sunnyvale", null, ["price"]);
        expect(open.eligible.map((item) => item.listing.id)).toContain("sunnyvale-unknown-rent");
        const capped = rankListings(LISTINGS, "Sunnyvale", 2500, ["price"]);
        const ids = capped.eligible.map((item) => item.listing.id);
        expect(ids).toContain("sunnyvale-thrift");
        expect(ids).not.toContain("sunnyvale-close");
        expect(ids).not.toContain("sunnyvale-unknown-rent");
        expect(capped.excludedUnknownRent).toBe(1);
        const unknown = open.eligible.find((item) => item.listing.id === "sunnyvale-unknown-rent");
        expect(unknown?.matches.some((item) => item.id === "price")).toBe(false);
        expect(unknown?.unknowns.some((item) => item.id === "price")).toBe(true);
    });
    it("does not treat unknown pet policy as a match", () => {
        const outcome = rankListings(LISTINGS, "Mountain View", null, ["pets"]);
        const furnished = outcome.eligible.find((item) => item.listing.id === "mv-furnished");
        expect(furnished?.unknowns.map((item) => item.id)).toContain("pets");
        expect(furnished?.matches).toEqual([]);
        expect(furnished?.score).toBe(0);
    });
});
describe("ranking", () => {
    it("flips Sunnyvale order when calculated commute and price swap priority", () => {
        const metricsById = {
            "sunnyvale-thrift": { commuteStatus: "ok", commuteMinutes: 46, convenienceStatus: "ok", convenienceScore: 20 },
            "sunnyvale-close": { commuteStatus: "ok", commuteMinutes: 14, convenienceStatus: "ok", convenienceScore: 80 },
        };
        const priceFirst = rankListings(LISTINGS, "Sunnyvale", null, ["price", "commute"], { metricsById }).eligible.map((item) => item.listing.id);
        const commuteFirst = rankListings(LISTINGS, "Sunnyvale", null, ["commute", "price"], { metricsById }).eligible.map((item) => item.listing.id);
        const convenienceFirst = rankListings(LISTINGS, "Sunnyvale", null, ["convenience", "price"], { metricsById }).eligible.map((item) => item.listing.id);
        expect(priceFirst[0]).toBe("sunnyvale-thrift");
        expect(commuteFirst[0]).toBe("sunnyvale-close");
        expect(convenienceFirst[0]).toBe("sunnyvale-close");
        expect(priceFirst).not.toEqual(commuteFirst);
    });
    it("does not rank a for-sale price as monthly rent", () => {
        const sale = { id: "sale-only", title: "Sale", city: "Sunnyvale", neighborhood: "", rent: null, rentBasis: "for-sale", salePriceText: "$900,000", beds: 2, sqft: 900, furnished: null, pets: null, parking: null, leaseMonths: null, origin: "redfin" };
        const open = rankListings([sale], "Sunnyvale", null, ["price"]);
        expect(open.areaKnown).toBe(true);
        expect(open.eligible).toEqual([]);
    });
    it("does not treat missing calculations or fixture leftovers as a favorable commute", () => {
        const outcome = rankListings(LISTINGS, "Sunnyvale", null, ["commute", "convenience"]);
        const close = outcome.eligible.find((item) => item.listing.id === "sunnyvale-close");
        expect(close?.unknowns.map((item) => item.id)).toEqual(["commute", "convenience"]);
        expect(close?.matches).toEqual([]);
        expect(close?.score).toBe(0);
        expect(LISTINGS.find((listing) => listing.id === "sunnyvale-unknown-rent").coordinates).toBeNull();
    });
    it("repeats an identical search in the same order and breaks ties by id", () => {
        const first = rankListings(LISTINGS, "San Jose", 4000, ["space", "parking"]).eligible.map((item) => item.listing.id);
        const second = rankListings(LISTINGS, "San Jose", 4000, ["space", "parking"]).eligible.map((item) => item.listing.id);
        expect(second).toEqual(first);
        const tied = rankListings([
            {
                id: "b-tie",
                title: "B",
                city: "San Jose",
                neighborhood: "Santana Row",
                rent: 3000,
                beds: 2,
                sqft: 900,
                roomLabel: "2 bedrooms",
                furnished: false,
                pets: false,
                parking: true,
                leaseMonths: 12,
                commuteMinutes: 20,
            },
            {
                id: "a-tie",
                title: "A",
                city: "San Jose",
                neighborhood: "Santana Row",
                rent: 3000,
                beds: 2,
                sqft: 900,
                roomLabel: "2 bedrooms",
                furnished: false,
                pets: false,
                parking: true,
                leaseMonths: 12,
                commuteMinutes: 20,
            },
        ], "San Jose", null, ["price"]);
        expect(tied.eligible.map((item) => item.listing.id)).toEqual(["a-tie", "b-tie"]);
    });
});
describe("validation", () => {
    it("rejects blank area, invalid budget, invalid household size, and no priorities", () => {
        expect(validateSearch(draft({ area: "   " })).area).toBeTruthy();
        expect(validateSearch(draft({ budgetText: "0" })).budget).toBeTruthy();
        expect(validateSearch(draft({ budgetText: "-5" })).budget).toBeTruthy();
        expect(validateSearch(draft({ budgetText: "abc" })).budget).toBeTruthy();
        expect(validateSearch(draft({ mode: "roommates", householdSize: 1 })).household).toBeTruthy();
        expect(validateSearch(draft({ priorities: [] })).priorities).toBeTruthy();
    });
    it("accepts a blank budget and preserves unrelated fields conceptually", () => {
        const errors = validateSearch(draft({ mode: "roommates", householdSize: 3, budgetText: "  ", priorities: ["lease"] }));
        expect(errors).toEqual({});
    });
});
