import { describe, expect, it } from "vitest";
import { buildExport } from "./feedback";
import { emptyState, SCHEMA_VERSION } from "./model";
describe("feedback export", () => {
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
        const exported = buildExport(state, new Map([["mv-castro", "Castro walk-up"]]), new Set(["mv-castro"]));
        expect(exported).toEqual({
            schemaVersion: SCHEMA_VERSION,
            sampleData: true,
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
        const exported = buildExport(state, new Map([["sunnyvale-thrift", "Maple Court 1BR"]]), new Set());
        expect(exported.generalFeedback).toBe("");
        expect(exported.totalMonthlyBudget).toBeNull();
        expect(exported.householdSize).toBeNull();
        expect(exported.usefulListings).toEqual([
            {
                id: "sunnyvale-thrift",
                title: "Maple Court 1BR",
                note: "",
                currentlyMatching: false,
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
