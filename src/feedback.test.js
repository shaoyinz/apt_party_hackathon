import { describe, expect, it } from "vitest";
import { buildExport } from "./feedback";
import { LISTINGS, SAMPLE_SOURCE_URL } from "./fixtures";
import { emptyState, SCHEMA_VERSION } from "./model";
describe("feedback export", () => {
    it("gives every sample fixture the shared sample source", () => {
        expect(LISTINGS.length).toBeGreaterThan(0);
        expect(LISTINGS.every((listing) => listing.sourceUrl === SAMPLE_SOURCE_URL)).toBe(true);
    });
    it("includes current inputs, ordered priorities, notes, and sample designation", () => {
        const state = {
            ...emptyState(),
            area: "  Castro Street  ",
            mode: "roommates",
            householdSize: 3,
            budgetText: "3200",
            priorities: ["commute", "pets"],
            useful: [{ id: "mv-castro", note: "Close to the demo station" }],
            generalFeedback: "Need in-unit laundry",
        };
        const exported = buildExport(state, new Map([["mv-castro", "Castro walk-up"]]), new Set(["mv-castro"]), { listings: LISTINGS });
        expect(exported).toEqual({
            schemaVersion: SCHEMA_VERSION,
            sampleData: true,
            includesImportedData: false,
            liveImport: { status: "not_loaded", importedAt: null, errorCode: null },
            area: "Castro Street",
            huntingMode: "roommates",
            householdSize: 3,
            totalMonthlyBudget: 3200,
            priorities: ["commute", "pets"],
            usefulListings: [
                {
                    id: "mv-castro",
                    title: "Castro walk-up",
                    note: "Close to the demo station",
                    currentlyMatching: true,
                    origin: "sample",
                    sourceUrl: SAMPLE_SOURCE_URL,
                },
            ],
            generalFeedback: "Need in-unit laundry",
        });
    });
    it("exports empty feedback and marks listings outside the current results", () => {
        const state = {
            ...emptyState(),
            area: "Cupertino",
            useful: [{ id: "sunnyvale-thrift", note: "" }],
        };
        const exported = buildExport(state, new Map([["sunnyvale-thrift", "Maple Court 1BR"]]), new Set(), { listings: LISTINGS });
        expect(exported.generalFeedback).toBe("");
        expect(exported.totalMonthlyBudget).toBeNull();
        expect(exported.householdSize).toBeNull();
        expect(exported.usefulListings).toEqual([
            {
                id: "sunnyvale-thrift",
                title: "Maple Court 1BR",
                note: "",
                currentlyMatching: false,
                origin: "sample",
                sourceUrl: SAMPLE_SOURCE_URL,
            },
        ]);
        expect(exported.sampleData).toBe(true);
        expect(exported.schemaVersion).toBe(SCHEMA_VERSION);
    });
    it("does not invent a budget from an invalid entry", () => {
        const exported = buildExport({ ...emptyState(), budgetText: "0" }, new Map(), new Set());
        expect(exported.totalMonthlyBudget).toBeNull();
    });
});
