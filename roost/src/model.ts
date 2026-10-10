export const SCHEMA_VERSION = 1;

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
