import { describe, expect, it } from "vitest";
import { parseZillowCoverage, saleStatusCopy, sourcesForQuery } from "./zillowCoverage.js";

const brooklyn = "https://www.zillow.com/homes/for_sale/Brooklyn,-New-York,-NY_rb/";

describe("zillow coverage", () => {
    it("keeps commas inside a Brooklyn search URL", () => {
        expect(parseZillowCoverage(brooklyn)).toEqual([{ label: "Brooklyn, New York, NY", url: brooklyn }]);
        expect(parseZillowCoverage(`Brooklyn, NY => ${brooklyn}`)).toEqual([{ label: "Brooklyn, NY", url: brooklyn }]);
        const sources = [
            { label: "Brooklyn, NY", url: brooklyn },
            { label: "11215", url: "https://www.zillow.com/homes/for_sale/11215_rb/" },
        ];
        expect(sourcesForQuery(sources, "Brooklyn")).toEqual([sources[0]]);
        expect(sourcesForQuery(sources, "11215")).toEqual([sources[1]]);
        expect(sourcesForQuery(sources, "Queens")).toEqual([]);
    });

    it("does not describe a blocked cache as empty or live", () => {
        expect(saleStatusCopy({ state: "unavailable", latest_attempt: { outcome: "http_error" } })).toMatch(/not an empty market/);
        expect(saleStatusCopy({ state: "database_unavailable" })).toMatch(/No sample sale listings/);
        expect(saleStatusCopy({ state: "fresh" })).toMatch(/not monthly rent/);
        expect(saleStatusCopy({ state: "unknown_coverage" })).toMatch(/not configured/);
    });
});
