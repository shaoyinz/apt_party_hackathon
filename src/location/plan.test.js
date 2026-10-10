import { describe, expect, it } from "vitest";
import { planTransit } from "./plan";
import { parsePacificLocal } from "./time";
function graph() {
    const stops = [
        { id: "origin", name: "Origin Stop", lat: 37.37, lon: -122.03, parentId: null },
        { id: "mid", name: "Mid Stop", lat: 37.38, lon: -122.05, parentId: null },
        { id: "dest", name: "Dest Stop", lat: 37.39, lon: -122.07, parentId: null },
    ];
    const trips = new Map([
        ["local", {
            routeName: "Local",
            serviceId: "weekend",
            stops: [
                { stopId: "origin", arr: 9 * 3600, dep: 9 * 3600, dropOff: "0", pickup: "0" },
                { stopId: "mid", arr: 9 * 3600 + 20 * 60, dep: 9 * 3600 + 20 * 60, dropOff: "0", pickup: "0" },
            ],
        }],
        ["onward", {
            routeName: "Express",
            serviceId: "weekend",
            stops: [
                { stopId: "mid", arr: 9 * 3600 + 30 * 60, dep: 9 * 3600 + 30 * 60, dropOff: "0", pickup: "0" },
                { stopId: "dest", arr: 9 * 3600 + 50 * 60, dep: 9 * 3600 + 50 * 60, dropOff: "0", pickup: "0" },
            ],
        }],
    ]);
    const departuresByStop = new Map();
    for (const [tripId, trip] of trips) {
        trip.stops.forEach((stop, index) => {
            const list = departuresByStop.get(stop.stopId) ?? [];
            list.push({ tripId, index, dep: stop.dep, serviceId: trip.serviceId });
            departuresByStop.set(stop.stopId, list);
        });
    }
    return {
        feeds: [{ id: "vta", name: "VTA", start: "20260810", end: "20261025" }],
        stops,
        stopById: new Map(stops.map((stop) => [stop.id, stop])),
        children: new Map(),
        trips,
        departuresByStop,
        neighbors: new Map([["mid", [{ id: "mid", walkSeconds: 180 }]]]),
        servicesOn() {
            return new Set(["weekend"]);
        },
    };
}
describe("transit planner", () => {
    it("adds access, wait, ride, transfer, and egress into one scheduled duration", () => {
        const departure = parsePacificLocal("2026-10-10T08:00");
        const result = planTransit({
            graph: graph(),
            departure,
            accessWalk: { origin: 600 },
            egressWalk: { dest: 300 },
        });
        expect(result.status).toBe("ok");
        expect(result.transfers).toBe(1);
        expect(result.lines).toEqual(["Local", "Express"]);
        expect(result.minutes).toBe(115);
        expect(result.departureTime).toContain("9:00 AM PT");
        expect(result.arrivalTime).toContain("9:55 AM PT");
        expect(result.timezone).toBe("America/Los_Angeles");
        expect(result.accessMinutes + result.waitMinutes + result.rideMinutes + result.transferWalkMinutes + result.egressMinutes).toBe(115);
    });
    it("reports an out-of-range schedule instead of a zero-minute trip", () => {
        const result = planTransit({
            graph: graph(),
            departure: parsePacificLocal("2028-01-01T08:00"),
            accessWalk: { origin: 60 },
            egressWalk: { dest: 60 },
        });
        expect(result.status).toBe("expired_schedule");
        expect(result.minutes).toBeUndefined();
    });
});
