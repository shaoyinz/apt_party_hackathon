import { describe, expect, it } from "vitest";
import { formatPacificClock, journeyMinutes, parsePacificLocal, servicesForDate, weekdayOfYmd } from "./time";
describe("Pacific departure handling", () => {
    it("treats the entered time as America/Los_Angeles wall time", () => {
        const parsed = parsePacificLocal("2026-10-12T08:30");
        expect(parsed.ok).toBe(true);
        expect(parsed.timezone).toBe("America/Los_Angeles");
        expect(parsed.seconds).toBe(8 * 3600 + 30 * 60);
        expect(parsed.gtfsDate).toBe("20261012");
        expect(parsePacificLocal("2026-13-01T08:30").ok).toBe(false);
        expect(parsePacificLocal("08:30").ok).toBe(false);
        expect(parsePacificLocal("").ok).toBe(false);
    });
    it("includes walking, waiting, riding, and transfers in total minutes", () => {
        expect(journeyMinutes(8 * 3600, 8 * 3600 + 115 * 60)).toBe(115);
        expect(formatPacificClock("2026-10-12", 8 * 3600 + 30 * 60)).toBe("2026-10-12 8:30 AM PT");
        expect(formatPacificClock("2026-10-12", 13 * 3600 + 5 * 60)).toBe("2026-10-12 1:05 PM PT");
        expect(formatPacificClock("2026-10-12", 24 * 3600 + 10 * 60)).toBe("2026-10-13 12:10 AM PT");
    });
    it("activates the weekday or weekend service that covers the civil date", () => {
        expect(weekdayOfYmd("2026-10-10")).toBe("saturday");
        const calendar = [
            { serviceId: "weekday", start: "20260131", end: "20270131", monday: "1", tuesday: "1", wednesday: "1", thursday: "1", friday: "1", saturday: "0", sunday: "0" },
            { serviceId: "weekend", start: "20260131", end: "20270131", monday: "0", tuesday: "0", wednesday: "0", thursday: "0", friday: "0", saturday: "1", sunday: "1" },
        ];
        expect(servicesForDate(calendar, [], "2026-10-10")).toEqual(new Set(["weekend"]));
        expect(servicesForDate(calendar, [{ serviceId: "weekend", date: "20261010", exceptionType: "2" }], "2026-10-10")).toEqual(new Set());
        expect(servicesForDate(calendar, [], "2028-01-01").size).toBe(0);
    });
});
