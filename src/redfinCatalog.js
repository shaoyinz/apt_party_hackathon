export const REDFIN_REFRESH_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_REDFIN_SEARCH_URL = "https://www.redfin.com/city/30749/NY/New-York/filter/status=active";

export function emptyRedfinCache() {
    return {
        attemptedAt: null,
        collectedAt: null,
        status: "empty",
        message: "No Redfin collection is cached yet.",
        sourcePageUrl: "",
        listings: [],
    };
}

export function cacheIsFresh(cache, now = Date.now(), maxAgeMs = REDFIN_REFRESH_MS) {
    const attempted = Date.parse(cache?.attemptedAt || "");
    if (!Number.isFinite(attempted) || now - attempted >= maxAgeMs) return false;
    return cache.status === "ready" || cache.status === "blocked";
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

export function adaptRedfinRow(row) {
    const propertyUrl = row.property_url || "";
    const address = row.address || "";
    const price = row.price || "";
    return {
        id: propertyUrl || `redfin-${address || "unknown"}`,
        title: address || "Redfin listing",
        city: cityFromAddress(address),
        neighborhood: "",
        rent: null,
        rentBasis: "for-sale",
        salePriceText: price,
        beds: countFrom(row.configuration, "beds"),
        sqft: countFrom(row.configuration, "sq ft"),
        roomLabel: row.configuration || "For sale",
        furnished: null,
        pets: null,
        parking: null,
        leaseMonths: null,
        origin: "redfin",
        source: "redfin",
        sourceUrl: propertyUrl,
        sourceGroup: "Redfin",
        sampleData: false,
        collectedAt: row.collected_at || null,
        listingStatus: row.listing_status || "",
        availability: row.availability || "",
    };
}

export function adaptRedfinRows(rows) {
    const seen = new Set();
    const listings = [];
    for (const row of rows || []) {
        const listing = adaptRedfinRow(row);
        if (!listing.city && !listing.sourceUrl) continue;
        if (seen.has(listing.id)) continue;
        seen.add(listing.id);
        listings.push(listing);
    }
    return listings;
}
