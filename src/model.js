export const SCHEMA_VERSION = 2;
export const PACIFIC_TZ = "America/Los_Angeles";
export const TRAVEL_MODES = ["driving", "cycling", "walking", "transit"];
export const TRAVEL_LABELS = {
    driving: "Driving",
    cycling: "Cycling",
    walking: "Walking",
    transit: "Public transit",
};
export const LEASE_FLEX_MAX_MONTHS = 6;
export const COMMUTE_SCALE_MINUTES = 60;
export const PRICE_CEILING = 5000;
export const PRICE_SPAN = 4000;
export const SPACE_SQFT_SCALE = 1400;
export const PRIORITY_IDS = [
    "commute",
    "convenience",
    "price",
    "space",
    "furnished",
    "pets",
    "parking",
    "lease",
];
export const PRIORITY_LABELS = {
    commute: "Commute",
    convenience: "Convenience",
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
export function emptyState() {
    return {
        area: "",
        mode: "solo",
        householdSize: null,
        budgetText: "",
        priorities: [],
        destination: "",
        travelMode: "driving",
        transitDeparture: "",
        confirmedDestination: null,
        useful: [],
        generalFeedback: "",
        view: "setup",
    };
}
export function isPriorityId(value) {
    return PRIORITY_IDS.includes(value);
}
export function isTravelMode(value) {
    return TRAVEL_MODES.includes(value);
}
export function normalizeArea(value) {
    return value.trim().toLowerCase().replace(/\s+/g, " ");
}
export function parseBudget(value) {
    const trimmed = value.trim();
    if (!trimmed)
        return { ok: true, budget: null };
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed))
        return { ok: false };
    const budget = Number(trimmed);
    if (!Number.isFinite(budget) || budget <= 0)
        return { ok: false };
    return { ok: true, budget };
}
export function householdError(mode, size) {
    if (mode === "solo")
        return null;
    if (size === 2 || size === 3 || size === 4)
        return null;
    return "Choose a household size from 2 to 4. Roommate mode does not send invitations.";
}
export function validateSearch(draft) {
    const errors = {};
    if (!draft.area.trim()) {
        errors.area = "Enter a city or neighborhood. Blank area cannot be searched.";
    }
    const household = householdError(draft.mode, draft.householdSize);
    if (household)
        errors.household = household;
    if (!parseBudget(draft.budgetText).ok) {
        errors.budget = "Enter a positive total monthly rent in USD, or leave budget blank.";
    }
    if (draft.priorities.length === 0) {
        errors.priorities =
            "Choose at least one priority. Roost will not invent a recommendation without one.";
    }
    return errors;
}
export function formatMoney(amount) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    }).format(amount);
}
export function yesNoUnknown(value) {
    if (value === true)
        return "Yes";
    if (value === false)
        return "No";
    return "Unknown";
}
export function leaseFact(months) {
    if (months == null)
        return "Unknown";
    if (months <= LEASE_FLEX_MAX_MONTHS)
        return `${months} months (flexible: six months or less)`;
    return `${months} months (not flexible)`;
}
