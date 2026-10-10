import { describe, expect, it } from "vitest";
import { classifyPlaces, interpretOsrm, suggestionPlaces } from "./places";
describe("destination and route interpretation", () => {
    it("asks the user to choose an ambiguous destination", () => {
        const result = classifyPlaces([
            { display_name: "Sunnyvale, California", lat: "37.3688", lon: "-122.0363" },
            { display_name: "Sunnyvale, Texas", lat: "32.7965", lon: "-96.5603" },
            { display_name: "Downtown Sunnyvale", lat: "37.376", lon: "-122.030" },
        ]);
        expect(result.status).toBe("ambiguous");
        expect(result.candidates.map((place) => place.label)).not.toContain("Sunnyvale, Texas");
    });
    it("accepts a single Bay Area match and maps missing routes", () => {
        const one = classifyPlaces([{ display_name: "Mountain View Caltrain", lat: "37.393", lon: "-122.073" }]);
        expect(one.status).toBe("ok");
        expect(one.place.label).toBe("Mountain View Caltrain");
        expect(classifyPlaces([]).status).toBe("not_found");
        expect(suggestionPlaces([
            { geometry: { coordinates: [-96.56, 32.8] }, properties: { name: "Sunnyvale", city: "Sunnyvale", state: "Texas", countrycode: "US" } },
            { geometry: { coordinates: [-122.036, 37.369] }, properties: { name: "Sunnyvale", city: "Sunnyvale", state: "California", countrycode: "US" } },
            { geometry: { coordinates: [2.35, 48.86] }, properties: { name: "Paris", countrycode: "FR" } },
            { geometry: { coordinates: [-122.03, 37.378] }, properties: { housenumber: "100", street: "Murphy Avenue", city: "Sunnyvale", state: "California", countrycode: "US" } },
        ]).map((place) => place.label)).toEqual([
            "Sunnyvale, California",
            "100 Murphy Avenue, Sunnyvale, California",
            "Sunnyvale, Texas",
        ]);
        expect(interpretOsrm({ code: "NoRoute" }).status).toBe("no_route");
        expect(interpretOsrm({ code: "Ok", routes: [{ duration: 414 }] }).minutes).toBe(7);
    });
});
