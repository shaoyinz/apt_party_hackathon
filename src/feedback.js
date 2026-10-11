import { isRealListing } from "./catalogSelection";
import { PACIFIC_TZ, SCHEMA_VERSION, listingOrigin, parseBudget } from "./model";
export function buildExport(state, titles, matchingIds, context = {}) {
    const parsed = parseBudget(state.budgetText);
    const listings = context.listings ?? [];
    const byId = new Map(listings.map((listing) => [listing.id, listing]));
    const catalogMode = context.catalogMode ?? "sample";
    const confirmed = state.confirmedDestination?.query === state.destination.trim() ? state.confirmedDestination.place : null;
    const usefulListings = state.useful.flatMap((item) => {
        const listing = byId.get(item.id);
        if (catalogMode !== "sample" && (!listing || !isRealListing(listing)))
            return [];
        return [toExportUseful(item, titles, matchingIds, byId)];
    });
    return {
        schemaVersion: SCHEMA_VERSION,
        sampleData: catalogMode === "sample",
        catalogMode,
        includesImportedData: listings.some((listing) => listingOrigin(listing) === "imported"),
        includesUserProvidedData: listings.some((listing) => listing.origin === "user-provided"),
        includesScrapedData: listings.some((listing) => listing.origin === "redfin"),
        liveImport: context.liveImport ?? { status: "not_loaded", importedAt: null, errorCode: null },
        area: state.area.trim(),
        huntingMode: state.mode,
        householdSize: state.mode === "roommates" ? state.householdSize : null,
        totalMonthlyBudget: parsed.ok ? parsed.budget : null,
        priorities: [...state.priorities],
        commute: {
            destination: state.destination.trim(),
            travelMode: state.travelMode,
            transitDeparture: state.transitDeparture,
            timezone: PACIFIC_TZ,
            resolvedDestination: confirmed,
            resolutionStatus: context.resolutionStatus ?? "not_calculated",
        },
        listingMetrics: (context.listingMetrics ?? []).filter((metric) => catalogMode === "sample" || isRealListing(byId.get(metric.id))),
        usefulListings,
        generalFeedback: state.generalFeedback,
    };
}
function toExportUseful(item, titles, matchingIds, listings) {
    const listing = listings.get(item.id);
    return {
        id: item.id,
        title: titles.get(item.id) ?? listing?.title ?? item.id,
        note: item.note,
        currentlyMatching: matchingIds.has(item.id),
        origin: listing ? listingOrigin(listing) : "sample",
        sourceUrl: listing?.sourceUrl ?? null,
    };
}
