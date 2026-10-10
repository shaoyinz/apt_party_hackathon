import { describe, expect, it } from "vitest";
import { parseZillowCoverage, saleStatusCopy } from "./zillowCoverage.js";

const brooklyn = "https://www.zillow.com/homes/for_sale/Brooklyn,-New-York,-NY_rb/";

describe("zillow coverage", () => {
    it("keeps commas inside a Brooklyn search URL", () => {
        expect(parseZillowCoverage(brooklyn)).toEqual([{ label: "Brooklyn, New York, NY", url: brooklyn }]);
        expect(parseZillowCoverage(`Brooklyn, NY => ${brooklyn}`)).toEqual([{ label: "Brooklyn, NY", url: brooklyn }]);
    });

    it("does not describe a blocked cache as empty or live", () => {
        expect(saleStatusCopy({ state: "unavailable", latest_attempt: { outcome: "http_error" } })).toMatch(/not an empty market/);
        expect(saleStatusCopy({ state: "database_unavailable" })).toMatch(/No sample sale listings/);
        expect(saleStatusCopy({ state: "fresh" })).toMatch(/not monthly rent/);
    });
});
