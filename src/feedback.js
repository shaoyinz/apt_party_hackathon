import { SCHEMA_VERSION, parseBudget } from "./model";
export function buildExport(state, titles, matchingIds) {
    const parsed = parseBudget(state.budgetText);
    return {
        schemaVersion: SCHEMA_VERSION,
        sampleData: true,
        area: state.area.trim(),
        huntingMode: state.mode,
        householdSize: state.mode === "roommates" ? state.householdSize : null,
        totalMonthlyBudget: parsed.ok ? parsed.budget : null,
        priorities: [...state.priorities],
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
