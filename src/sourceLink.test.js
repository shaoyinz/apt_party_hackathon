import { describe, expect, it } from "vitest";
import { LISTINGS } from "./fixtures";
import { SAMPLE_SOURCE_URL, SAMPLE_WITHOUT_SOURCE_ID, isIndividualListingUrl, retainListingSource, sourceAction } from "./sourceLink";

describe("source links", () => {
    it("keeps each sample on the configured search except the listing with no source", () => {
        const missing = LISTINGS.find((listing) => listing.id === SAMPLE_WITHOUT_SOURCE_ID);
        const linked = LISTINGS.filter((listing) => listing.id !== SAMPLE_WITHOUT_SOURCE_ID);
        expect(missing.sourceUrl).toBeNull();
        expect(sourceAction(missing)).toEqual({ kind: "unavailable", href: null, label: "Source unavailable" });
        expect(linked.every((listing) => listing.sourceUrl === SAMPLE_SOURCE_URL)).toBe(true);
        expect(linked.every((listing) => sourceAction(listing).label === "View sample source")).toBe(true);
        expect(linked.every((listing) => sourceAction(listing).href === SAMPLE_SOURCE_URL)).toBe(true);
    });

    it("opens a result's own detail URL and does not replace it with the sample search", () => {
        const first = "https://sfbay.craigslist.org/sby/apa/d/sunnyvale-maple/123";
        const second = "https://www.redfin.com/CA/Sunnyvale/1-Main-St-94086/home/99";
        expect(sourceAction({ origin: "imported", sourceUrl: first })).toEqual({
            kind: "listing",
            href: first,
            label: "View listing",
        });
        expect(sourceAction({ origin: "redfin", sourceUrl: second }).href).toBe(second);
        const kept = retainListingSource({ origin: "imported", id: "live", sourceUrl: first });
        expect(kept.sourceUrl).toBe(first);
        expect(kept.sourceUrl).not.toBe(SAMPLE_SOURCE_URL);
    });

    it("does not link a missing, unsafe, homepage, or shared-search URL as a listing", () => {
        for (const sourceUrl of [null, "", "javascript:alert(1)", "http://127.0.0.1/admin", "https://example.com", SAMPLE_SOURCE_URL]) {
            const action = sourceAction({ origin: "imported", sourceUrl });
            expect(action).toEqual({ kind: "unavailable", href: null, label: "Source unavailable" });
            expect(action.href).toBeNull();
        }
        expect(isIndividualListingUrl("https://example.com/")).toBe(false);
    });

    it("does not present a sample detail URL as a verified listing", () => {
        const detail = "https://sfbay.craigslist.org/sby/apa/d/example/7Fbc1UHwbZjLiikQs4yPxL";
        const action = sourceAction({ origin: "sample", sourceUrl: detail });
        expect(action.label).toBe("View sample source");
        expect(action.href).toBe(detail);
        expect(retainListingSource({ id: "kept", origin: "sample", sourceUrl: detail }).sourceUrl).toBe(detail);
    });
});
