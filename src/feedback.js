import { PACIFIC_TZ, SCHEMA_VERSION, parseBudget } from "./model";
export function buildExport(state, titles, matchingIds, snapshot = {}) {
    const parsed = parseBudget(state.budgetText);
    const confirmed = state.confirmedDestination?.query === state.destination.trim() ? state.confirmedDestination.place : null;
    return {
        schemaVersion: SCHEMA_VERSION,
        sampleData: true,
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
            resolutionStatus: snapshot.resolutionStatus ?? "not_calculated",
        },
        listingMetrics: snapshot.listingMetrics ?? [],
        usefulListings: state.useful.map((item) => toExportUseful(item, titles, matchingIds)),
        generalFeedback: state.generalFeedback,
    };
}
function toExportUseful(item, titles, matchingIds) {
    return {
        id: item.id,
        title: titles.get(item.id) ?? item.id,
        note: item.note,
        currentlyMatching: matchingIds.has(item.id),
    };
}
