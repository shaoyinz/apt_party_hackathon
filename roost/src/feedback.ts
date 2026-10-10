import {
  SCHEMA_VERSION,
  parseBudget,
  type AppState,
  type PriorityId,
  type UsefulSelection,
} from "./model";

export interface ExportUsefulListing {
  id: string;
  title: string;
  note: string;
  currentlyMatching: boolean;
}

export interface FeedbackExport {
  schemaVersion: number;
  sampleData: true;
  area: string;
  huntingMode: AppState["mode"];
  householdSize: number | null;
  totalMonthlyBudget: number | null;
  priorities: PriorityId[];
  usefulListings: ExportUsefulListing[];
  generalFeedback: string;
}

export function buildExport(
  state: AppState,
  titles: Map<string, string>,
  matchingIds: Set<string>,
): FeedbackExport {
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

function toExportUseful(
  item: UsefulSelection,
  titles: Map<string, string>,
  matchingIds: Set<string>,
): ExportUsefulListing {
  return {
    id: item.id,
    title: titles.get(item.id) ?? item.id,
    note: item.note,
    currentlyMatching: matchingIds.has(item.id),
  };
}
