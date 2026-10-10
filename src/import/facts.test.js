import { describe, expect, it } from "vitest";
import { extractFacts, extractFromHtml, mergeExtractions } from "./facts.js";

describe("listing fact extraction", () => {
    it("reads monthly rent, studio bedrooms, fractional baths, and amenities without inventing a coordinate", () => {
        const parsed = extractFacts("Sunnyvale studio at 18 Olive Ave, available March 1, 2026. $2,400/month. 1.5 baths. 540 sq ft. Pet friendly. In-unit laundry. Entire apartment.");
        expect(parsed.fields.priceMonthly).toBe(2400);
        expect(parsed.fields.beds).toBe(0);
        expect(parsed.fields.baths).toBe(1.5);
        expect(parsed.fields.availableFrom).toBe("2026-03-01");
        expect(parsed.fields.city).toBe("Sunnyvale");
        expect(parsed.fields.address).toMatch(/18 Olive Ave/);
        expect(parsed.fields.sqft).toBe(540);
        expect(parsed.fields.roomType).toBe("entire");
        expect(parsed.attributes.map((item) => item.name)).toContain("In-unit laundry");
        expect(parsed.fields.lat).toBeUndefined();
    });

    it("does not convert weekly rent or ambiguous dates into monthly facts", () => {
        const parsed = extractFacts("Private room available now. $800/week. 3 bedrooms in the home.");
        expect(parsed.fields.priceMonthly).toBeNull();
        expect(parsed.fields.priceIssue).toBe("nonmonthly");
        expect(parsed.fields.availableFrom).toBeNull();
        expect(parsed.notes.availableFrom).toMatch(/ambiguous/);
        expect(parsed.fields.beds).toBe(3);
        expect(parsed.fields.roomType).toBe("private_room");
    });

    it("leaves conflicting screenshot facts unknown", () => {
        const merged = mergeExtractions([
            extractFacts("12 Castro Street, Mountain View. $3,100/month. 2 beds. 1 bath."),
            extractFacts("12 Castro Street, Mountain View. $2,800/month. 2 beds. 1 bath."),
        ]);
        expect(merged.fields.priceMonthly).toBeNull();
        expect(merged.conflicts).toContain("priceMonthly");
        expect(merged.fields.beds).toBe(2);
    });

    it("reads a linked page without treating a bare price as monthly rent", () => {
        const html = `<!doctype html><title>Castro walk-up</title><script type="application/ld+json">{"name":"Castro walk-up","address":{"streetAddress":"88 Castro Street","addressLocality":"Mountain View","addressRegion":"CA"},"offers":{"price":"3100"}}</script><p>2 beds, 1 bath, available 2026-04-01.</p>`;
        const parsed = extractFromHtml(html);
        expect(parsed.fields.title).toBe("Castro walk-up");
        expect(parsed.fields.address).toMatch(/88 Castro Street/);
        expect(parsed.fields.city).toBe("Mountain View");
        expect(parsed.fields.priceMonthly).toBeNull();
        expect(parsed.fields.priceIssue).toBe("ambiguous");
        expect(parsed.fields.availableFrom).toBe("2026-04-01");
    });
});
