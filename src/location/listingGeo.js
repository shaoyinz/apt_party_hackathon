import { distanceMeters } from "./geo.js";

export const LISTING_GEOCODE_SOURCE = "OpenStreetMap via Nominatim";
export const LISTING_GEOCODE_DISCLOSURE = "Resolving a listing sends the address and city to OpenStreetMap geocoding. Provider credentials stay on the server.";

export function listingGeocodeQuery(address, city) {
    return [address, city]
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
        .join(", ");
}

export function classifyListingGeocode(results) {
    const places = (Array.isArray(results) ? results : [])
        .map(toListingPlace)
        .filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lon));
    if (places.length === 0) {
        return {
            status: "not_found",
            message: "No matching place. Correct the address and city, then try again.",
            candidates: [],
            place: null,
        };
    }
    const streets = dedupe(places.filter((place) => place.precision === "address"));
    if (streets.length === 1) {
        return { status: "ok", place: streets[0], candidates: [], message: "" };
    }
    if (streets.length > 1) {
        return {
            status: "ambiguous",
            message: "More than one street match. Choose one. Roost will not guess.",
            candidates: streets.slice(0, 5),
            place: null,
        };
    }
    const approximate = dedupe(places.filter((place) => place.precision !== "city"));
    const pool = approximate.length ? approximate : dedupe(places);
    if (pool.length > 1) {
        return {
            status: "ambiguous",
            message: "More than one place matches. Choose one. Roost will not guess.",
            candidates: pool.slice(0, 5),
            place: null,
        };
    }
    const only = pool[0];
    return {
        status: "approximate",
        place: only,
        candidates: [],
        message: only.precision === "city"
            ? "This match is a city center, not the property. Confirm it only if estimates should use that approximate origin."
            : "This match is a neighborhood or street without a house number, not an exact property location. Confirm it only as an approximate origin.",
    };
}

export function matchConfirmedPlace(result, selection) {
    if (!result || !selection)
        return null;
    if (result.status === "ok" && result.place?.precision === "address")
        return stamp(result.place);
    if (result.status === "approximate") {
        if (selection.confirmedApproximate !== true || !near(result.place, selection))
            return null;
        return stamp(result.place);
    }
    if (result.status === "ambiguous") {
        const chosen = (result.candidates || []).find((candidate) => near(candidate, selection));
        return chosen ? stamp(chosen) : null;
    }
    return null;
}

export function confirmedLocationPayload(currentQuery, confirmed) {
    if (!confirmed || confirmed.query !== currentQuery)
        return null;
    return {
        query: currentQuery,
        lat: confirmed.lat,
        lon: confirmed.lon,
        label: confirmed.label,
        precision: confirmed.precision,
        confirmedApproximate: confirmed.precision !== "address",
    };
}

export function originDisclosure(coordinates, origin) {
    if (!coordinates)
        return "Missing coordinates. Commute and convenience are unavailable.";
    if (origin === "sample")
        return "Approximate sample origin. Not a verified street address.";
    if (coordinates.precision === "address")
        return `${coordinates.label ? `${coordinates.label}. ` : ""}Confirmed street match from OpenStreetMap. Not an independent property verification.`;
    const kind = coordinates.precision === "city" ? "City-center origin" : "Approximate origin";
    return `${kind}${coordinates.label ? `: ${coordinates.label}` : ""}. Not an exact property location. Commute and convenience estimates use this origin.`;
}

function stamp(place) {
    return {
        label: place.label,
        lat: place.lat,
        lon: place.lon,
        precision: place.precision,
        source: LISTING_GEOCODE_SOURCE,
    };
}

function near(place, selection) {
    const lat = Number(selection.lat);
    const lon = Number(selection.lon);
    if (!place || !Number.isFinite(lat) || !Number.isFinite(lon))
        return false;
    return distanceMeters(place, { lat, lon }) <= (place.precision === "address" ? 25 : 200);
}

function dedupe(places) {
    const kept = [];
    for (const place of places) {
        if (kept.some((item) => distanceMeters(item, place) <= (place.precision === "address" ? 25 : 200)))
            continue;
        kept.push(place);
    }
    return kept;
}

function toListingPlace(result) {
    const address = result.address || {};
    return {
        label: result.label || result.display_name || "Unnamed place",
        lat: Number(result.lat),
        lon: Number(result.lon),
        precision: precisionOf(result, address),
    };
}

function precisionOf(result, address) {
    const type = String(result.addresstype || result.type || "").toLowerCase();
    if (address.house_number || address.housenumber)
        return "address";
    if (["neighbourhood", "neighborhood", "suburb", "quarter", "locality", "road", "pedestrian", "street"].includes(type))
        return "neighborhood";
    if (address.road || address.neighbourhood || address.neighborhood || address.suburb)
        return "neighborhood";
    return "city";
}
