export const SCHEMA_VERSION = 2;

export const DEMO_COMMUTE_DESTINATION = "Mountain View Caltrain station";

export const LEASE_FLEX_MAX_MONTHS = 6;

export const COMMUTE_SCALE_MINUTES = 60;

export const PRICE_CEILING = 5000;

export const PRICE_SPAN = 4000;

export const SPACE_SQFT_SCALE = 1400;

export const PRIORITY_IDS = [
  "commute",
  "price",
  "space",
  "furnished",
  "pets",
  "parking",
  "lease",
] as const;

export type PriorityId = (typeof PRIORITY_IDS)[number];

export type HuntingMode = "solo" | "roommates";

export type ListingOrigin = "sample" | "imported";

export type OfferKind = "whole" | "room" | "sublet" | "unknown";

export type RentBasis = "monthly-total" | "monthly-room" | "nonmonthly" | "unknown";

export interface Listing {
  id: string;
  title: string;
  city: string;
  neighborhood: string;
  rent: number | null;
  beds: number | null;
  sqft: number | null;
  roomLabel: string;
  furnished: boolean | null;
  pets: boolean | null;
  parking: boolean | null;
  leaseMonths: number | null;
  commuteMinutes: number | null;
  origin?: ListingOrigin;
  offerKind?: OfferKind;
  rentBasis?: RentBasis;
  sourceGroup?: string | null;
  sourceGroupId?: string | null;
  sourcePostId?: string | null;
  sourceUrl?: string | null;
  postedAt?: string | null;
  importedAt?: string | null;
  availability?: string | null;
}

export interface UsefulSelection {
  id: string;
  note: string;
}

export interface SearchDraft {
  area: string;
  mode: HuntingMode;
  householdSize: number | null;
  budgetText: string;
  priorities: PriorityId[];
}

export interface AppState extends SearchDraft {
  useful: UsefulSelection[];
  generalFeedback: string;
  view: "setup" | "results";
}

export const PRIORITY_LABELS: Record<PriorityId, string> = {
  commute: "Commute",
  price: "Lower price",
  space: "More space",
  furnished: "Furnished housing",
  pets: "Pet-friendly housing",
  parking: "Parking",
  lease: "Lease flexibility",
};

export const AREA_SUGGESTIONS = [
  "Sunnyvale",
  "Santa Clara",
  "Mountain View",
  "Cupertino",
  "San Jose",
  "Downtown Sunnyvale",
  "Santa Clara University",
  "Castro Street",
  "Cupertino Village",
  "Santana Row",
  "Downtown San Jose",
];

export function emptyState(): AppState {
  return {
    area: "",
    mode: "solo",
    householdSize: null,
    budgetText: "",
    priorities: [],
    useful: [],
    generalFeedback: "",
    view: "setup",
  };
}

export function isPriorityId(value: string): value is PriorityId {
  return (PRIORITY_IDS as readonly string[]).includes(value);
}

export function normalizeArea(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function parseBudget(value: string): { ok: true; budget: number | null } | { ok: false } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, budget: null };
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return { ok: false };
  const budget = Number(trimmed);
  if (!Number.isFinite(budget) || budget <= 0) return { ok: false };
  return { ok: true, budget };
}

export function householdError(mode: HuntingMode, size: number | null): string | null {
  if (mode === "solo") return null;
  if (size === 2 || size === 3 || size === 4) return null;
  return "Choose a household size from 2 to 4. Roommate mode does not send invitations.";
}

export interface FieldErrors {
  area?: string;
  household?: string;
  budget?: string;
  priorities?: string;
}

export function validateSearch(draft: SearchDraft): FieldErrors {
  const errors: FieldErrors = {};
  if (!draft.area.trim()) {
    errors.area = "Enter a city or neighborhood. Blank area cannot be searched.";
  }
  const household = householdError(draft.mode, draft.householdSize);
  if (household) errors.household = household;
  if (!parseBudget(draft.budgetText).ok) {
    errors.budget = "Enter a positive total monthly rent in USD, or leave budget blank.";
  }
  if (draft.priorities.length === 0) {
    errors.priorities =
      "Choose at least one priority. Roost will not invent a recommendation without one.";
  }
  return errors;
}

export function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}

export function yesNoUnknown(value: boolean | null): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "Unknown";
}

export function leaseFact(months: number | null): string {
  if (months == null) return "Unknown";
  if (months <= LEASE_FLEX_MAX_MONTHS) return `${months} months (flexible: six months or less)`;
  return `${months} months (not flexible)`;
}

export function listingOrigin(listing: Listing): ListingOrigin {
  return listing.origin ?? "sample";
}

export function listingRentBasis(listing: Listing): RentBasis {
  return listing.rentBasis ?? (listingOrigin(listing) === "sample" ? "monthly-total" : "unknown");
}

export function applicableMonthlyRent(listing: Listing, mode: HuntingMode): number | null {
  if (listing.rent == null) return null;
  const basis = listingRentBasis(listing);
  if (basis === "monthly-total") return listing.rent;
  if (basis === "monthly-room" && mode === "solo") return listing.rent;
  return null;
}

export function offerKindLabel(kind: OfferKind | undefined): string {
  if (kind === "room") return "Room";
  if (kind === "sublet") return "Sublet";
  if (kind === "whole") return "Whole unit";
  return "Offer type unknown";
}

export function rentFact(listing: Listing, mode: HuntingMode): string {
  const basis = listingRentBasis(listing);
  if (basis === "unknown") {
    if (listing.rent == null) return "Unknown. Missing or ambiguous rent is not treated as affordable.";
    return `${formatMoney(listing.rent)} has no explicit monthly whole-unit basis, so it cannot pass a monthly budget.`;
  }
  if (listing.rent == null) return "Unknown. Missing or ambiguous rent is not treated as affordable.";
  const amount = formatMoney(listing.rent);
  if (basis === "nonmonthly") {
    return `${amount}, not a monthly rate. It cannot pass a monthly budget.`;
  }
  if (basis === "monthly-room") {
    if (mode === "roommates") {
      return `${amount} monthly room rent. Not household total rent, so it cannot pass the total budget.`;
    }
    return `${amount} monthly room rent. Not whole-unit rent.`;
  }
  return `${amount} total monthly rent.`;
}
