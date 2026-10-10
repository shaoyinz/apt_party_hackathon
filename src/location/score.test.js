import { describe, expect, it } from "vitest";
import { categoryPoints, convenienceFromElements, nearestUnique, scoreAmenities } from "./score";
describe("convenience score", () => {
    it("scores each category at the documented boundaries", () => {
        expect(categoryPoints(0)).toBe(25);
        expect(categoryPoints(500)).toBe(12.5);
        expect(categoryPoints(1000)).toBe(0);
        expect(categoryPoints(1500)).toBe(0);
        const full = scoreAmenities({
            groceries: [{ name: "Market", lat: 0, lon: 0, distanceMeters: 0 }],
            transit: [{ name: "Stop", lat: 0, lon: 0, distanceMeters: 0 }],
            pharmacies: [{ name: "Pharmacy", lat: 0, lon: 0, distanceMeters: 0 }],
            parks: [{ name: "Park", lat: 0, lon: 0, distanceMeters: 0 }],
        });
        expect(full.score).toBe(100);
        const half = scoreAmenities({
            groceries: [{ name: "Market", lat: 0, lon: 0, distanceMeters: 500 }],
            transit: [{ name: "Stop", lat: 0, lon: 0, distanceMeters: 500 }],
            pharmacies: [{ name: "Pharmacy", lat: 0, lon: 0, distanceMeters: 500 }],
            parks: [{ name: "Park", lat: 0, lon: 0, distanceMeters: 500 }],
        });
        expect(half.score).toBe(50);
        const empty = scoreAmenities({ groceries: [], transit: [], pharmacies: [], parks: [] });
        expect(empty.score).toBe(0);
        expect(empty.categories).toHaveLength(4);
    });
    it("does not let duplicate features inflate the score", () => {
        const nearest = nearestUnique([
            { name: "Market", lat: 37.37, lon: -122.03, distanceMeters: 100 },
            { name: "Market", lat: 37.3701, lon: -122.0301, distanceMeters: 120 },
            { name: "Other Market", lat: 37.38, lon: -122.04, distanceMeters: 800 },
        ]);
        expect(nearest.distanceMeters).toBe(100);
        const scored = scoreAmenities({
            groceries: [
                { name: "Market", lat: 37.37, lon: -122.03, distanceMeters: 100 },
                { name: "Market", lat: 37.3701, lon: -122.0301, distanceMeters: 120 },
            ],
            transit: [],
            pharmacies: [],
            parks: [],
        });
        expect(scored.score).toBe(Math.round(categoryPoints(100)));
        expect(scored.categories.find((item) => item.id === "groceries").name).toBe("Market");
    });
    it("uses a successful empty query as zero and keeps failed queries out of the score", () => {
        const origin = { lat: 37.37, lon: -122.03 };
        const none = convenienceFromElements([], origin);
        expect(none.score).toBe(0);
        const far = convenienceFromElements([
            { lat: 37.4, lon: -122.03, tags: { shop: "supermarket", name: "Far Market" } },
        ], origin);
        expect(far.score).toBe(0);
        expect(far.categories.find((item) => item.id === "groceries").name).toBeNull();
    });
});
