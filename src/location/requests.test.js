import { describe, expect, it } from "vitest";
import { LISTINGS } from "../fixtures";
import { commuteSignature, createRequestGate, rankingMetrics } from "./requests";
describe("stale location requests", () => {
    it("ignores a late response after a newer input", () => {
        const gate = createRequestGate();
        const first = gate.next("commute");
        const second = gate.next("commute");
        expect(gate.isCurrent("commute", first)).toBe(false);
        expect(gate.isCurrent("commute", second)).toBe(true);
        const amenity = gate.next("amenities");
        expect(gate.isCurrent("amenities", amenity)).toBe(true);
        expect(gate.isCurrent("commute", amenity)).toBe(false);
    });
    it("drops commute minutes that belong to a previous destination", () => {
        const state = {
            destination: "Mountain View Caltrain",
            travelMode: "driving",
            transitDeparture: "",
            confirmedDestination: { query: "Mountain View Caltrain", place: { lat: 37.39, lon: -122.07, label: "Mountain View" } },
        };
        const signature = commuteSignature(state);
        const commute = {
            signature: commuteSignature({ ...state, destination: "San Jose Diridon" }),
            byId: { "sunnyvale-close": { status: "ok", minutes: 10 } },
        };
        const metrics = rankingMetrics(LISTINGS, commute, { byId: {} }, signature);
        expect(metrics["sunnyvale-close"].commuteMinutes).toBeNull();
        expect(metrics["sunnyvale-close"].commuteStatus).toBe("unavailable");
    });
});
