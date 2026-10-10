import { COMMUTE_SCALE_MINUTES, LEASE_FLEX_MAX_MONTHS, PRICE_CEILING, PRICE_SPAN, SPACE_SQFT_SCALE, TRAVEL_LABELS, formatMoney, normalizeArea } from "./model";
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
function metric(listing, options) {
    return options.metricsById?.[listing.id] ?? {};
}
function featureScore(listing, priority, options) {
    switch (priority) {
        case "commute": {
            const minutes = metric(listing, options).commuteStatus === "ok" ? metric(listing, options).commuteMinutes : null;
            if (minutes == null)
                return 0;
            return clamp01((COMMUTE_SCALE_MINUTES - minutes) / COMMUTE_SCALE_MINUTES);
        }
        case "convenience": {
            const score = metric(listing, options).convenienceStatus === "ok" ? metric(listing, options).convenienceScore : null;
            if (score == null)
                return 0;
            return clamp01(score / 100);
        }
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
function explain(listing, priority, options) {
    switch (priority) {
        case "commute": {
            const current = metric(listing, options);
            if (current.commuteStatus !== "ok" || current.commuteMinutes == null) {
                return { id: priority, detail: "Calculated commute is unavailable and earns no match." };
            }
            const mode = TRAVEL_LABELS[options.commuteMode] ?? "selected mode";
            const destination = options.destinationLabel || "the selected destination";
            const caveat = options.commuteMode === "driving"
                ? " OSM driving estimate without live traffic."
                : options.commuteMode === "transit"
                    ? " Scheduled transit estimate, not live delays."
                    : " OSM route estimate.";
            return { id: priority, detail: `${current.commuteMinutes} min ${mode.toLowerCase()} to ${destination}.${caveat}` };
        }
        case "convenience": {
            const current = metric(listing, options);
            if (current.convenienceStatus !== "ok" || current.convenienceScore == null) {
                return { id: priority, detail: "Convenience score is unavailable and earns no match." };
            }
            return {
                id: priority,
                detail: `Convenience ${current.convenienceScore}/100 from geographic proximity, not a walking route.`,
            };
        }
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
function isUnknown(listing, priority, options) {
    switch (priority) {
        case "commute":
            return metric(listing, options).commuteStatus !== "ok";
        case "convenience":
            return metric(listing, options).convenienceStatus !== "ok";
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
function isFavorable(listing, priority, options) {
    switch (priority) {
        case "commute":
            return metric(listing, options).commuteStatus === "ok" && metric(listing, options).commuteMinutes <= 30;
        case "convenience":
            return metric(listing, options).convenienceStatus === "ok" && metric(listing, options).convenienceScore >= 50;
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
export function rankListings(listings, area, budget, priorities, options = {}) {
    const inArea = listings.filter((listing) => listingMatchesArea(listing, area));
    const excludedUnknownRent = inArea.filter((listing) => budget != null && listing.rent == null).length;
    const eligibleListings = inArea.filter((listing) => withinBudget(listing, budget));
    const weights = priorities.map((_, index) => priorities.length - index);
    const eligible = eligibleListings
        .map((listing) => {
        const score = priorities.reduce((total, priority, index) => total + weights[index] * featureScore(listing, priority, options), 0);
        const matches = [];
        const tradeoffs = [];
        const unknowns = [];
        for (const priority of priorities) {
            const item = explain(listing, priority, options);
            if (isUnknown(listing, priority, options))
                unknowns.push(item);
            else if (isFavorable(listing, priority, options))
                matches.push(item);
            else
                tradeoffs.push(item);
        }
        return { listing, score, matches, tradeoffs, unknowns };
    })
        .sort((a, b) => b.score - a.score || a.listing.id.localeCompare(b.listing.id));
    return { areaKnown: inArea.length > 0, eligible, excludedUnknownRent };
}
