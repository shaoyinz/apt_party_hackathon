import { distanceMeters, inBayArea } from "./geo.js";
export function classifyPlaces(results) {
    const places = results
        .map(toPlace)
        .filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lon));
    if (places.length === 0) {
        return {
            status: "not_found",
            message: "No matching place. Enter a South Bay address, station, or landmark.",
            candidates: [],
        };
    }
    const bay = places.filter((place) => inBayArea(place));
    const pool = bay.length ? bay : places;
    if (pool.length === 1 || samePlace(pool[0], pool[1])) {
        return { status: "ok", place: pool[0], candidates: [], message: "" };
    }
    return {
        status: "ambiguous",
        message: "More than one place matches. Choose one. Roost will not guess.",
        candidates: pool.slice(0, 5),
    };
}
export function suggestionPlaces(features) {
    if (!Array.isArray(features))
        return [];
    const places = [];
    for (const feature of features) {
        const [lon, lat] = feature?.geometry?.coordinates ?? [];
        const props = feature?.properties ?? {};
        if (!Number.isFinite(lat) || !Number.isFinite(lon))
            continue;
        if (props.countrycode && props.countrycode !== "US")
            continue;
        places.push({ label: photonLabel(props), lat, lon });
    }
    const seen = new Set();
    return places
        .sort((a, b) => Number(inBayArea(b)) - Number(inBayArea(a)))
        .filter((place) => {
        if (seen.has(place.label))
            return false;
        seen.add(place.label);
        return true;
    })
        .slice(0, 6);
}
function photonLabel(props) {
    const street = [props.housenumber, props.street].filter(Boolean).join(" ");
    const named = props.name && props.name !== props.street && props.name !== props.city ? props.name : "";
    const primary = street || named;
    const locality = [props.city || props.town || props.village || props.county, props.state].filter(Boolean).join(", ");
    if (primary && locality)
        return `${primary}, ${locality}`;
    return primary || locality || props.name || "Unnamed place";
}
function toPlace(result) {
    return {
        label: result.label ?? result.display_name ?? "Unnamed place",
        lat: Number(result.lat),
        lon: Number(result.lon),
    };
}
function samePlace(a, b) {
    if (!b)
        return true;
    return distanceMeters(a, b) <= 200;
}
export function interpretOsrm(body) {
    if (!body || typeof body !== "object")
        return { status: "provider_failure", message: "Routing returned an unreadable response." };
    if (body.code === "NoRoute")
        return { status: "no_route", message: "No street route was found for this mode." };
    const duration = body.routes?.[0]?.duration;
    if (body.code !== "Ok" || !Number.isFinite(duration)) {
        return { status: "provider_failure", message: "Routing did not return a duration." };
    }
    return { status: "ok", minutes: Math.round(duration / 60), distanceMeters: body.routes[0].distance ?? null };
}
