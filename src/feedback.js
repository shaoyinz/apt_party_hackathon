import { PACIFIC_TZ, SCHEMA_VERSION, listingOrigin, parseBudget } from "./model";
export function buildExport(state, titles, matchingIds, context = {}) {
    const parsed = parseBudget(state.budgetText);
    const listings = context.listings ?? [];
    const byId = new Map(listings.map((listing) => [listing.id, listing]));
    const confirmed = state.confirmedDestination?.query === state.destination.trim() ? state.confirmedDestination.place : null;
    return {
        schemaVersion: SCHEMA_VERSION,
        sampleData: true,
        includesImportedData: listings.some((listing) => listingOrigin(listing) === "imported"),
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
        listingMetrics: context.listingMetrics ?? [],
        usefulListings: state.useful.map((item) => toExportUseful(item, titles, matchingIds, byId)),
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
