import { COMMUTE_SCALE_MINUTES, DEMO_COMMUTE_DESTINATION, LEASE_FLEX_MAX_MONTHS, PRICE_CEILING, PRICE_SPAN, SPACE_SQFT_SCALE, formatMoney, normalizeArea } from "./model";
function clamp01(value) {
    return Math.min(1, Math.max(0, value));
}
export function listingMatchesArea(listing, area) {
    const query = normalizeArea(area);
    if (!query)
        return false;
    return normalizeArea(listing.city) === query || normalizeArea(listing.neighborhood) === query;
}
export function withinBudget(listing, budget) {
    if (budget == null)
        return true;
    if (listing.rent == null)
        return false;
    return listing.rent <= budget;
}
function featureScore(listing, priority) {
    switch (priority) {
        case "commute":
            if (listing.commuteMinutes == null)
                return 0;
            return clamp01((COMMUTE_SCALE_MINUTES - listing.commuteMinutes) / COMMUTE_SCALE_MINUTES);
        case "price":
            if (listing.rent == null)
                return 0;
            return clamp01((PRICE_CEILING - listing.rent) / PRICE_SPAN);
        case "space":
            if (listing.sqft != null)
                return clamp01(listing.sqft / SPACE_SQFT_SCALE);
            if (listing.beds != null)
                return clamp01(listing.beds / 4);
            return 0;
        case "furnished":
            return listing.furnished === true ? 1 : 0;
        case "pets":
            return listing.pets === true ? 1 : 0;
        case "parking":
            return listing.parking === true ? 1 : 0;
        case "lease":
            if (listing.leaseMonths == null)
                return 0;
            return listing.leaseMonths <= LEASE_FLEX_MAX_MONTHS ? 1 : 0;
    }
}
function explain(listing, priority) {
    switch (priority) {
        case "commute":
            if (listing.commuteMinutes == null) {
                return {
                    id: priority,
                    detail: `Sample commute to ${DEMO_COMMUTE_DESTINATION} is unknown and earns no match.`,
                };
            }
            return {
                id: priority,
                detail: `Sample estimate ${listing.commuteMinutes} min to ${DEMO_COMMUTE_DESTINATION}. Not a calculated route.`,
            };
        case "price":
            if (listing.rent == null) {
                return { id: priority, detail: "Total monthly rent is unknown and earns no price match." };
            }
            return { id: priority, detail: `${formatMoney(listing.rent)} total monthly rent.` };
        case "space":
            if (listing.sqft == null && listing.beds == null) {
                return { id: priority, detail: "Size is unknown and earns no space match." };
            }
            if (listing.sqft != null)
                return { id: priority, detail: `${listing.sqft} sq ft, ${listing.roomLabel}.` };
            return { id: priority, detail: `${listing.roomLabel}. Square footage is unknown.` };
        case "furnished":
            if (listing.furnished == null) {
                return { id: priority, detail: "Furnished status is unknown and earns no match." };
            }
            return { id: priority, detail: listing.furnished ? "Furnished." : "Not furnished." };
        case "pets":
            if (listing.pets == null) {
                return { id: priority, detail: "Pet policy is unknown and earns no match." };
            }
            return { id: priority, detail: listing.pets ? "Pet-friendly." : "Pets not allowed." };
        case "parking":
            if (listing.parking == null) {
                return { id: priority, detail: "Parking is unknown and earns no match." };
            }
            return { id: priority, detail: listing.parking ? "Parking included." : "No parking listed." };
        case "lease":
            if (listing.leaseMonths == null) {
                return { id: priority, detail: "Lease length is unknown and earns no flexibility match." };
            }
            if (listing.leaseMonths <= LEASE_FLEX_MAX_MONTHS) {
                return {
                    id: priority,
                    detail: `${listing.leaseMonths}-month term. Lease flexibility means six months or less.`,
                };
            }
            return {
                id: priority,
                detail: `${listing.leaseMonths}-month term, longer than the six-month flexibility cutoff.`,
            };
    }
}
function isUnknown(listing, priority) {
    switch (priority) {
        case "commute":
            return listing.commuteMinutes == null;
        case "price":
            return listing.rent == null;
        case "space":
            return listing.sqft == null && listing.beds == null;
        case "furnished":
            return listing.furnished == null;
        case "pets":
            return listing.pets == null;
        case "parking":
            return listing.parking == null;
        case "lease":
            return listing.leaseMonths == null;
    }
}
function isFavorable(listing, priority) {
    switch (priority) {
        case "commute":
            return listing.commuteMinutes != null && listing.commuteMinutes <= 30;
        case "price":
            return listing.rent != null && listing.rent <= 3200;
        case "space":
            if (listing.sqft != null)
                return listing.sqft >= 800;
            return listing.beds != null && listing.beds >= 2;
        case "furnished":
            return listing.furnished === true;
        case "pets":
            return listing.pets === true;
        case "parking":
            return listing.parking === true;
        case "lease":
            return listing.leaseMonths != null && listing.leaseMonths <= LEASE_FLEX_MAX_MONTHS;
    }
}
export function rankListings(listings, area, budget, priorities) {
    const inArea = listings.filter((listing) => listingMatchesArea(listing, area));
    const excludedUnknownRent = inArea.filter((listing) => budget != null && listing.rent == null).length;
    const eligibleListings = inArea.filter((listing) => withinBudget(listing, budget));
    const weights = priorities.map((_, index) => priorities.length - index);
    const eligible = eligibleListings
        .map((listing) => {
        const score = priorities.reduce((total, priority, index) => total + weights[index] * featureScore(listing, priority), 0);
        const matches = [];
        const tradeoffs = [];
        const unknowns = [];
        for (const priority of priorities) {
            const item = explain(listing, priority);
            if (isUnknown(listing, priority))
                unknowns.push(item);
            else if (isFavorable(listing, priority))
                matches.push(item);
            else
                tradeoffs.push(item);
        }
        return { listing, score, matches, tradeoffs, unknowns };
    })
        .sort((a, b) => b.score - a.score || a.listing.id.localeCompare(b.listing.id));
    return { areaKnown: inArea.length > 0, eligible, excludedUnknownRent };
}
