import {
  SCHEMA_VERSION,
  listingOrigin,
  parseBudget,
  type AppState,
  type Listing,
  type ListingOrigin,
  type PriorityId,
  type UsefulSelection,
} from "./model";

export interface ExportUsefulListing {
  id: string;
  title: string;
  note: string;
  currentlyMatching: boolean;
  origin: ListingOrigin;
  sourceUrl: string | null;
}

export interface LiveImportExport {
  status: string;
  importedAt: string | null;
  errorCode: string | null;
}

export interface FeedbackExport {
  schemaVersion: number;
  sampleData: boolean;
  includesImportedData: boolean;
  liveImport: LiveImportExport;
  area: string;
  huntingMode: AppState["mode"];
  householdSize: number | null;
  totalMonthlyBudget: number | null;
  priorities: PriorityId[];
  usefulListings: ExportUsefulListing[];
  generalFeedback: string;
}

export interface ExportContext {
  listings?: Listing[];
  liveImport?: LiveImportExport;
}

export function buildExport(
  state: AppState,
  titles: Map<string, string>,
  matchingIds: Set<string>,
  context: ExportContext = {},
): FeedbackExport {
  const parsed = parseBudget(state.budgetText);
  const listings = context.listings ?? [];
  const byId = new Map(listings.map((listing) => [listing.id, listing]));
  const usefulListings = state.useful.map((item) => toExportUseful(item, titles, matchingIds, byId));
  const includesImportedData = listings.some((listing) => listingOrigin(listing) === "imported");
  const liveImport = context.liveImport ?? { status: "not_loaded", importedAt: null, errorCode: null };
  return {
    schemaVersion: SCHEMA_VERSION,
    sampleData: true,
    includesImportedData,
    liveImport,
    area: state.area.trim(),
    huntingMode: state.mode,
    householdSize: state.mode === "roommates" ? state.householdSize : null,
    totalMonthlyBudget: parsed.ok ? parsed.budget : null,
    priorities: [...state.priorities],
    usefulListings,
    generalFeedback: state.generalFeedback,
  };
}

function toExportUseful(
  item: UsefulSelection,
  titles: Map<string, string>,
  matchingIds: Set<string>,
  listings: Map<string, Listing>,
): ExportUsefulListing {
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
