import { COMMUTE_SCALE_MINUTES, LEASE_FLEX_MAX_MONTHS, PRICE_CEILING, PRICE_SPAN, SPACE_SQFT_SCALE, TRAVEL_LABELS, applicableMonthlyRent, formatMoney, listingOrigin, listingRentBasis, normalizeArea } from "./model";
function isForSaleListing(listing) {
    return listingRentBasis(listing) === "for-sale" || listing.listingType === "for-sale" || listing.listingType === "sale";
}
function clamp01(value) {
    return Math.min(1, Math.max(0, value));
}
export function listingMatchesArea(listing, area) {
    const query = normalizeArea(area);
    if (!query)
        return false;
    return normalizeArea(listing.city) === query || normalizeArea(listing.neighborhood) === query;
}
export function withinBudget(listing, budget, mode = "solo") {
    if (budget == null)
        return true;
    const amount = applicableMonthlyRent(listing, mode);
    if (amount == null)
        return false;
    return amount <= budget;
}
function rankingOptions(modeOrOptions) {
    if (typeof modeOrOptions === "string")
        return { mode: modeOrOptions };
    return { mode: "solo", ...(modeOrOptions ?? {}) };
}
function metric(listing, options) {
    return options.metricsById?.[listing.id] ?? {};
}
function featureScore(listing, priority, options) {
    const mode = options.mode;
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
        case "price": {
            const amount = applicableMonthlyRent(listing, mode);
            if (amount == null)
                return 0;
            return clamp01((PRICE_CEILING - amount) / PRICE_SPAN);
        }
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
    const mode = options.mode;
    switch (priority) {
        case "commute": {
            const current = metric(listing, options);
            if (current.commuteStatus !== "ok" || current.commuteMinutes == null) {
                const imported = listingOrigin(listing) === "imported" ? " for this imported post" : "";
                return { id: priority, detail: `Calculated commute is unavailable${imported} and earns no match.` };
            }
            const label = TRAVEL_LABELS[options.commuteMode] ?? "selected mode";
            const destination = options.destinationLabel || "the selected destination";
            const caveat = options.commuteMode === "driving"
                ? " OSM driving estimate without live traffic."
                : options.commuteMode === "transit"
                    ? " Scheduled transit estimate, not live delays."
                    : " OSM route estimate.";
            return { id: priority, detail: `${current.commuteMinutes} min ${label.toLowerCase()} to ${destination}.${caveat}` };
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
return { id: priority, detail: priceDetail(listing, mode) };
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
function priceDetail(listing, mode) {
    const basis = listingRentBasis(listing);
    if (listing.rent == null || basis === "unknown")
        return "Monthly rent is unknown or ambiguous and earns no price match.";
    if (basis === "nonmonthly")
        return `${formatMoney(listing.rent)} is not monthly, so it earns no price match and cannot pass a monthly budget.`;
    if (basis === "monthly-room" && mode !== "solo")
        return `${formatMoney(listing.rent)} is monthly room rent, not household total rent, so it earns no price match.`;
    if (basis === "monthly-room")
        return `${formatMoney(listing.rent)} monthly room rent. This is not whole-unit rent.`;
    return `${formatMoney(listing.rent)} total monthly rent.`;
}
function isUnknown(listing, priority, options) {
    switch (priority) {
        case "commute":
            return metric(listing, options).commuteStatus !== "ok";
        case "convenience":
            return metric(listing, options).convenienceStatus !== "ok";
        case "price":
            return applicableMonthlyRent(listing, options.mode) == null;
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
        case "price": {
            const amount = applicableMonthlyRent(listing, options.mode);
            return amount != null && amount <= 3200;
        }
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
export function preferenceWeightScore(listing, priorities, modeOrOptions = {}) {
    if (!priorities.length)
        return null;
    const options = rankingOptions(modeOrOptions);
    const weights = priorities.map((_, index) => priorities.length - index);
    return priorities.reduce((total, priority, index) => total + weights[index] * featureScore(listing, priority, options), 0);
}
export function rankListings(listings, area, budget, priorities, modeOrOptions = {}) {
    const options = rankingOptions(modeOrOptions);
    const mode = options.mode;
    const inArea = listings.filter((listing) => listingMatchesArea(listing, area));
    const notComparable = inArea.filter((listing) => budget != null && applicableMonthlyRent(listing, mode) == null);
    const excludedForSale = notComparable.filter((listing) => listingRentBasis(listing) === "for-sale").length;
    const comparableGaps = notComparable.filter((listing) => listingRentBasis(listing) !== "for-sale");
    const excludedUnknownRent = comparableGaps.filter((listing) => listing.rent == null || listingRentBasis(listing) === "unknown").length;
    const excludedInapplicableRent = comparableGaps.length - excludedUnknownRent;
    const eligibleListings = inArea.filter((listing) => !isForSaleListing(listing) && withinBudget(listing, budget, mode));
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
    return { areaKnown: inArea.length > 0, eligible, excludedUnknownRent, excludedInapplicableRent, excludedForSale };
}
