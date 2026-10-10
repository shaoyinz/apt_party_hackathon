import { distanceMeters } from "./geo.js";
export const AMENITY_CATEGORIES = ["groceries", "transit", "pharmacies", "parks"];
export const AMENITY_LABELS = {
    groceries: "Groceries",
    transit: "Transit stops",
    pharmacies: "Pharmacies",
    parks: "Parks",
};
export const CONVENIENCE_RADIUS_METERS = 1000;
const DUPLICATE_METERS = 40;
export function categoryPoints(distanceMetersValue) {
    if (distanceMetersValue == null || !Number.isFinite(distanceMetersValue))
        return 0;
    return 25 * Math.max(0, 1 - distanceMetersValue / CONVENIENCE_RADIUS_METERS);
}
export function nearestUnique(features) {
    const sorted = [...features].sort((a, b) => a.distanceMeters - b.distanceMeters);
    const kept = [];
    for (const feature of sorted) {
        const duplicate = kept.some((other) => samePlace(other, feature));
        if (!duplicate)
            kept.push(feature);
    }
    return kept[0] ?? null;
}
function samePlace(a, b) {
    const nameA = normalizeName(a.name);
    const nameB = normalizeName(b.name);
    if (nameA && nameB && nameA === nameB)
        return true;
    return distanceMeters(a, b) <= DUPLICATE_METERS;
}
function normalizeName(name) {
    return (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
export function scoreAmenities(featuresByCategory) {
    const categories = AMENITY_CATEGORIES.map((id) => {
        const nearest = nearestUnique(featuresByCategory[id] ?? []);
        const within = nearest && nearest.distanceMeters <= CONVENIENCE_RADIUS_METERS ? nearest : null;
        const points = within ? categoryPoints(within.distanceMeters) : 0;
        return {
            id,
            label: AMENITY_LABELS[id],
            name: within?.name ?? null,
            distanceMeters: within ? Math.round(within.distanceMeters) : null,
            points,
        };
    });
    const score = Math.min(100, Math.max(0, Math.round(categories.reduce((total, item) => total + item.points, 0))));
    return { score, categories };
}
export function convenienceFromElements(elements, origin) {
    const grouped = { groceries: [], transit: [], pharmacies: [], parks: [] };
    for (const element of elements) {
        const category = categoryOf(element.tags ?? {});
        const point = elementPoint(element);
        if (!category || !point)
            continue;
        const meters = distanceMeters(origin, point);
        if (meters > CONVENIENCE_RADIUS_METERS)
            continue;
        grouped[category].push({
            name: featureName(element.tags ?? {}, category),
            lat: point.lat,
            lon: point.lon,
            distanceMeters: meters,
        });
    }
    return scoreAmenities(grouped);
}
export function categoryOf(tags) {
    if (tags.shop === "supermarket" || tags.shop === "grocery" || tags.shop === "greengrocer")
        return "groceries";
    if (tags.amenity === "pharmacy")
        return "pharmacies";
    if (tags.leisure === "park")
        return "parks";
    if (tags.highway === "bus_stop" ||
        tags.amenity === "bus_station" ||
        tags.railway === "station" ||
        tags.railway === "halt" ||
        tags.railway === "stop" ||
        tags.public_transport === "station" ||
        tags.public_transport === "stop_position" ||
        tags.public_transport === "platform") {
        return "transit";
    }
    return null;
}
function elementPoint(element) {
    if (Number.isFinite(element.lat) && Number.isFinite(element.lon))
        return { lat: element.lat, lon: element.lon };
    if (element.center && Number.isFinite(element.center.lat) && Number.isFinite(element.center.lon)) {
        return { lat: element.center.lat, lon: element.center.lon };
    }
    return null;
}
function featureName(tags, category) {
    return tags.name || tags.brand || `Unnamed ${AMENITY_LABELS[category].toLowerCase()}`;
}
