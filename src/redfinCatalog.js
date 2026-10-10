export const REDFIN_REFRESH_MS = 24 * 60 * 60 * 1000;
export const REDFIN_CACHE_VERSION = 2;

// Sale URLs verified by HTTP 200 and a matching city title on 2026-10-10.
// Palo Alto, Milpitas, and Campbell IDs were not verified; wrong IDs resolved
// to other cities, so those targets stay unresolved until a page link is found.
export const REDFIN_CITY_TARGETS = [
    { city: "Sunnyvale", saleUrl: "https://www.redfin.com/city/19457/CA/Sunnyvale" },
    { city: "Santa Clara", saleUrl: "https://www.redfin.com/city/17675/CA/Santa-Clara" },
    { city: "Mountain View", saleUrl: "https://www.redfin.com/city/12739/CA/Mountain-View" },
    { city: "Cupertino", saleUrl: "https://www.redfin.com/city/4561/CA/Cupertino" },
    { city: "San Jose", saleUrl: "https://www.redfin.com/city/17420/CA/San-Jose" },
    { city: "Palo Alto", saleUrl: "" },
    { city: "Milpitas", saleUrl: "" },
    { city: "Campbell", saleUrl: "" },
];

export function normalizeCity(value) {
    return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function emptyRedfinCache() {
    return {
        version: REDFIN_CACHE_VERSION,
        attemptedAt: null,
        collectedAt: null,
        status: "empty",
        message: "No Redfin collection is cached yet.",
        cities: {},
        listings: [],
    };
}

export function cacheIsFresh(cache, now = Date.now(), maxAgeMs = REDFIN_REFRESH_MS) {
    if (cache?.version !== REDFIN_CACHE_VERSION) return false;
    const attempted = Date.parse(cache?.attemptedAt || "");
    if (!Number.isFinite(attempted) || now - attempted >= maxAgeMs) return false;
    return cache.status === "ready" || cache.status === "partial" || cache.status === "blocked";
}

export function cityFromAddress(address) {
    const parts = String(address || "").split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) return "";
    const tail = parts[parts.length - 1];
    if (/^[A-Z]{2}(?:\s+\d{5})?$/.test(tail)) return parts[parts.length - 2];
    return tail.replace(/\s+\d{5}(?:-\d{4})?$/, "");
}

function countFrom(configuration, label) {
    const match = String(configuration || "").match(new RegExp(`([\\d,.]+)\\s+${label}`));
    if (!match) return null;
    const value = Number(match[1].replace(/,/g, ""));
    return Number.isFinite(value) ? value : null;
}

export function adaptRedfinRow(row, target = {}) {
    const propertyUrl = row.property_url || row.sourceUrl || "";
    const address = row.address || row.title || "";
    const price = row.price || row.price_text || row.salePriceText || "";
    const listingType = row.listing_type || row.listingType || target.listingType || "for-sale";
    const parsedCity = cityFromAddress(address);
    const city = parsedCity || target.city || "";
    return {
        id: `${listingType}:${propertyUrl || address || "unknown"}`,
        title: address || "Redfin listing",
        city,
        neighborhood: "",
        rent: listingType === "rental" ? null : null,
        rentBasis: listingType === "rental" ? "unknown" : "for-sale",
        salePriceText: listingType === "for-sale" ? price : "",
        rentalPriceText: listingType === "rental" ? price : "",
        listingType,
        beds: countFrom(row.configuration || row.roomLabel, "beds"),
        sqft: countFrom(row.configuration || row.roomLabel, "sq ft"),
        roomLabel: row.configuration || row.roomLabel || (listingType === "rental" ? "Rental" : "For sale"),
        furnished: null,
        pets: null,
        parking: null,
        leaseMonths: null,
        origin: "redfin",
        source: "redfin",
        sourceUrl: propertyUrl,
        sourceGroup: "Redfin",
        sampleData: false,
        collectedAt: row.collected_at || row.collectedAt || null,
        updatedAt: row.updated_at || row.updatedAt || row.collected_at || null,
        listingStatus: row.listing_status || row.listingStatus || "",
        availability: row.availability || "",
    };
}

export function rowsForTarget(rows, city, listingType) {
    const wanted = normalizeCity(city);
    return (rows || []).map((row) => adaptRedfinRow(row, { city, listingType })).filter((listing) => {
        if (!listing.sourceUrl) return false;
        return normalizeCity(cityFromAddress(listing.title)) === wanted;
    });
}

export function listingsForCity(listings, city) {
    const wanted = normalizeCity(city);
    if (!wanted) return [];
    return (listings || []).filter((listing) => normalizeCity(listing.city) === wanted);
}

export function mergeCityRefresh(previousListings, city, listingType, outcome) {
    const wanted = normalizeCity(city);
    if (!outcome.ok) {
        return { listings: previousListings || [], preserved: true };
    }
    const kept = (previousListings || []).filter((listing) => !(normalizeCity(listing.city) === wanted && listing.listingType === listingType));
    return { listings: [...kept, ...outcome.listings], preserved: false };
}

export function cityCounts(listings) {
    const counts = {};
    for (const target of REDFIN_CITY_TARGETS) counts[target.city] = 0;
    for (const listing of listings || []) {
        const city = REDFIN_CITY_TARGETS.find((target) => normalizeCity(target.city) === normalizeCity(listing.city))?.city;
        if (!city) continue;
        counts[city] += 1;
    }
    return counts;
}
