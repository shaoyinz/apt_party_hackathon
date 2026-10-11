import { describe, expect, it } from "vitest";
import { classifyListingGeocode, confirmedLocationPayload, matchConfirmedPlace, originDisclosure } from "./listingGeo.js";

const street = {
    display_name: "18 Olive Ave, Sunnyvale, California",
    lat: "37.371",
    lon: "-122.038",
    addresstype: "house",
    address: { house_number: "18", road: "Olive Ave", city: "Sunnyvale" },
};
const otherStreet = {
    display_name: "180 Olive Ave, Sunnyvale, California",
    lat: "37.390",
    lon: "-122.050",
    addresstype: "house",
    address: { house_number: "180", road: "Olive Ave", city: "Sunnyvale" },
};
const city = {
    display_name: "Sunnyvale, California",
    lat: "37.3688",
    lon: "-122.0363",
    addresstype: "city",
    address: { city: "Sunnyvale", state: "California" },
};
const neighborhood = {
    display_name: "Downtown Sunnyvale",
    lat: "37.376",
    lon: "-122.030",
    addresstype: "suburb",
    address: { suburb: "Downtown", city: "Sunnyvale" },
};

describe("listing geocode confirmation", () => {
    it("accepts one street match and does not treat a city center as exact", () => {
        const exact = classifyListingGeocode([street, city]);
        expect(exact.status).toBe("ok");
        expect(exact.place.precision).toBe("address");
        const center = classifyListingGeocode([city]);
        expect(center.status).toBe("approximate");
        expect(center.place.precision).toBe("city");
        expect(center.message).toMatch(/city center/i);
        expect(classifyListingGeocode([]).status).toBe("not_found");
    });

    it("requires a choice for ambiguous streets and an explicit approximate confirmation", () => {
        const ambiguous = classifyListingGeocode([street, otherStreet]);
        expect(ambiguous.status).toBe("ambiguous");
        expect(ambiguous.candidates).toHaveLength(2);
        expect(matchConfirmedPlace(ambiguous, { lat: 37.371, lon: -122.038 }).label).toMatch(/18 Olive/);
        expect(matchConfirmedPlace(ambiguous, { lat: 0, lon: 0 })).toBeNull();
        const approximate = classifyListingGeocode([neighborhood]);
        expect(approximate.place.precision).toBe("neighborhood");
        expect(matchConfirmedPlace(approximate, { lat: 37.376, lon: -122.030 })).toBeNull();
        expect(matchConfirmedPlace(approximate, { lat: 37.376, lon: -122.030, confirmedApproximate: true }).precision).toBe("neighborhood");
    });

    it("drops a confirmed place when the address query changes", () => {
        const confirmed = { query: "18 Olive Ave, Sunnyvale", lat: 37.37, lon: -122.03, label: "18 Olive Ave", precision: "address" };
        expect(confirmedLocationPayload("18 Olive Ave, Sunnyvale", confirmed)?.precision).toBe("address");
        expect(confirmedLocationPayload("19 Olive Ave, Sunnyvale", confirmed)).toBeNull();
        expect(originDisclosure(null, "user-provided")).toMatch(/unavailable/i);
        expect(originDisclosure({ precision: "city", label: "Sunnyvale" }, "user-provided")).toMatch(/Not an exact property location/);
    });
});
