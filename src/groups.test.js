import { describe, expect, it } from "vitest";
import { LISTINGS } from "./fixtures";
import {
    addNote,
    addShortlist,
    bestValueIds,
    createGroup,
    currentSignalIds,
    filterListings,
    findInvite,
    groupScore,
    joinGroup,
    memberCommute,
    missingFacts,
    perPersonRent,
    regenerateInvite,
    removeMember,
    removeShortlist,
    setTouring,
    shortlistSummary,
    sortListings,
    toggleSignal,
    validateFilters,
} from "./groups";

const ids = () => {
    let n = 0;
    return () => `id-${++n}`;
};

function filters(overrides = {}) {
    return {
        text: "",
        minPrice: null,
        maxPrice: null,
        minBeds: null,
        maxCommute: null,
        status: "any",
        source: "any",
        ...overrides,
    };
}

describe("groups", () => {
    it("creates an isolated group and rejects a blank display name", () => {
        const nextId = ids();
        const first = createGroup("Sunnyvale hunters", "Priya", nextId);
        const second = createGroup("Other", "Alex", nextId);
        expect(first.error).toBeNull();
        expect(joinGroup(first.group, "  ", ids()).error).toMatch(/display name/i);
        const joined = joinGroup(first.group, "Sam", ids());
        expect(joined.group.members.map((member) => member.name)).toEqual(["Priya", "Sam"]);
        expect(second.group.members).toHaveLength(1);
        expect(second.group.id).not.toBe(first.group.id);
    });

    it("recovers invalid and revoked invites without treating a missing local group as shared access", () => {
        const created = createGroup("Hunters", "Priya", ids());
        const next = regenerateInvite(created.group, ids());
        expect(findInvite([next], created.group.inviteToken).status).toBe("revoked");
        expect(findInvite([next], next.inviteToken).status).toBe("ok");
        expect(findInvite([], next.inviteToken).status).toBe("unavailable");
        expect(findInvite([next], "missing").status).toBe("unavailable");
    });

    it("combines search and filters and never lets unknown numbers pass", () => {
        const group = createGroup("Hunters", "Priya", ids()).group;
        const text = filterListings(LISTINGS, group, filters({ text: "MURPHY" }));
        expect(text.map((listing) => listing.id)).toEqual(["sunnyvale-close"]);
        const addressMiss = filterListings(LISTINGS, group, filters({ text: "214 Murphy" }));
        expect(addressMiss).toEqual([]);
        const numeric = filterListings(LISTINGS, group, filters({ maxPrice: 2000, minBeds: 1, maxCommute: 30 }));
        expect(numeric.every((listing) => listing.rent != null && listing.rent <= 2000)).toBe(true);
        expect(numeric.some((listing) => listing.id === "sunnyvale-unknown-rent")).toBe(false);
        expect(validateFilters({ minPrice: "5000", maxPrice: "1000", minBeds: "2", maxCommute: "" }).errors.maxPrice).toMatch(/at least/i);
    });

    it("sorts by group score, price, commute, and newest with unknowns last", () => {
        const sample = [
            { id: "b", rent: null, commuteMinutes: 5, listedOn: "2026-10-01" },
            { id: "a", rent: 100, commuteMinutes: null, listedOn: null },
            { id: "c", rent: 50, commuteMinutes: 9, listedOn: "2026-09-01" },
        ];
        expect(sortListings(sample, "price", () => 1).map((item) => item.id)).toEqual(["c", "a", "b"]);
        expect(sortListings(sample, "commute", () => 1).map((item) => item.id)).toEqual(["b", "c", "a"]);
        expect(sortListings(sample, "newest", () => 1).map((item) => item.id)).toEqual(["b", "c", "a"]);
        const scored = sortListings(sample, "score", (item) => (item.id === "a" ? 1 : item.id === "c" ? 9 : null));
        expect(scored.map((item) => item.id)).toEqual(["c", "a", "b"]);
    });

    it("keeps shortlist entries unique and aggregates only known values", () => {
        let group = createGroup("Hunters", "Priya", ids()).group;
        group = addShortlist(addShortlist(group, "sunnyvale-close"), "sunnyvale-close");
        group = addShortlist(group, "sunnyvale-unknown-rent");
        expect(group.shortlist).toEqual(["sunnyvale-close", "sunnyvale-unknown-rent"]);
        const listings = group.shortlist.map((id) => LISTINGS.find((listing) => listing.id === id));
        const summary = shortlistSummary(listings, () => 4);
        expect(summary.rentRange.known).toBe(1);
        expect(summary.rentRange.total).toBe(2);
        expect(summary.avgCommute).toBeNull();
        expect(missingFacts(listings[1]).some((fact) => fact.label === "Rent")).toBe(true);
        expect(shortlistSummary([], () => null).rentRange).toBeNull();
        group = removeShortlist(group, "sunnyvale-close");
        expect(group.shortlist).toEqual(["sunnyvale-unknown-rent"]);
    });

    it("toggles member signals once, keeps comments after removal, and moves touring without dropping discussion", () => {
        const nextId = ids();
        let { group, member } = createGroup("Hunters", "Priya", nextId);
        const joined = joinGroup(group, "Alex", nextId);
        group = joined.group;
        const alex = joined.member;
        group = toggleSignal(group, "mv-castro", member.id, "vote");
        group = toggleSignal(group, "mv-castro", member.id, "vote");
        group = toggleSignal(group, "mv-castro", member.id, "vote");
        group = toggleSignal(group, "mv-castro", alex.id, "veto");
        expect(currentSignalIds(group, "mv-castro", "vote")).toEqual([member.id]);
        expect(currentSignalIds(group, "mv-castro", "veto")).toEqual([alex.id]);
        const noted = addNote(group, "mv-castro", alex, "  ", "comment", nextId);
        expect(noted.error).toMatch(/comment/i);
        group = addNote(group, "mv-castro", alex, "Street parking?", "question", nextId).group;
        group = addShortlist(group, "mv-castro");
        group = setTouring(group, "mv-castro", true);
        expect(group.touring).toEqual(["mv-castro"]);
        expect(group.shortlist).toEqual(["mv-castro"]);
        expect(group.questions).toHaveLength(1);
        group = setTouring(group, "mv-castro", false);
        expect(group.touring).toEqual([]);
        const removed = removeMember(group, alex.id);
        expect(removed.error).toBeNull();
        expect(currentSignalIds(removed.group, "mv-castro", "veto")).toEqual([]);
        expect(removed.group.questions[0].memberName).toBe("Alex");
        expect(removeMember(removed.group, member.id).error).toMatch(/at least one/i);
    });

    it("does not infer member commute, per-person rent, or best value", () => {
        const listing = LISTINGS.find((item) => item.id === "sunnyvale-unknown-rent");
        const known = LISTINGS.find((item) => item.id === "sunnyvale-close");
        expect(memberCommute(known, { commuteDestinationId: null })).toBeNull();
        expect(memberCommute(known, { commuteDestinationId: "other" })).toBeNull();
        expect(memberCommute(known, { commuteDestinationId: "mv-caltrain" })).toBe(known.commuteMinutes ?? null);
        expect(perPersonRent(null, 3)).toBeNull();
        expect(perPersonRent(3000, 0)).toBeNull();
        expect(perPersonRent(3000, 3)).toBe(1000);
        const ids = bestValueIds([listing, known, { id: "x", rent: 100 }]);
        expect(ids.has(listing.id)).toBe(false);
        expect(ids.has("x")).toBe(true);
        expect(groupScore(known, []).note).toMatch(/not an AI recommendation/i);
        expect(groupScore(known, ["price"]).kind).toBe("preference");
    });
});
