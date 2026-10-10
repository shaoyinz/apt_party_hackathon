import {
  emptyState,
  isPriorityId,
  type AppState,
  type HuntingMode,
  type PriorityId,
  type UsefulSelection,
} from "./model";

export const STORAGE_KEY = "roost-prototype-v1";

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LoadResult {
  state: AppState;
  warning: string | null;
}

const INVALID_WARNING =
  "Saved search data in this browser was unreadable, so Roost started fresh. New changes can still be saved here.";

const UNAVAILABLE_WARNING =
  "This browser is not keeping a saved copy. You can still search and export during this visit. A reload may clear your entries.";

export function loadState(store: KeyValueStore | null): LoadResult {
  if (!store) return { state: emptyState(), warning: UNAVAILABLE_WARNING };
  let raw: string | null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return { state: emptyState(), warning: UNAVAILABLE_WARNING };
  }
  if (!raw) return { state: emptyState(), warning: null };
  const parsed = parseState(raw);
  if (!parsed) return { state: emptyState(), warning: INVALID_WARNING };
  return { state: parsed, warning: null };
}

export function saveState(store: KeyValueStore | null, state: AppState): string | null {
  if (!store) return UNAVAILABLE_WARNING;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(state));
    return null;
  } catch {
    return UNAVAILABLE_WARNING;
  }
}

export function clearState(store: KeyValueStore | null): string | null {
  if (!store) return UNAVAILABLE_WARNING;
  try {
    store.removeItem(STORAGE_KEY);
    return null;
  } catch {
    return UNAVAILABLE_WARNING;
  }
}

export function probeBrowserStore(): KeyValueStore | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const probe = "__roost_probe__";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

function parseState(raw: string): AppState | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    const mode = record.mode === "roommates" ? "roommates" : record.mode === "solo" ? "solo" : null;
    const view = record.view === "results" ? "results" : record.view === "setup" ? "setup" : null;
    if (!mode || !view) return null;
    if (typeof record.area !== "string" || typeof record.budgetText !== "string") return null;
    if (typeof record.generalFeedback !== "string") return null;
    const householdSize = parseHousehold(record.householdSize);
    if (householdSize === undefined) return null;
    const priorities = parsePriorities(record.priorities);
    const useful = parseUseful(record.useful);
    if (!priorities || !useful) return null;
    return {
      area: record.area,
      mode: mode as HuntingMode,
      householdSize,
      budgetText: record.budgetText,
      priorities,
      useful,
      generalFeedback: record.generalFeedback,
      view,
    };
  } catch {
    return null;
  }
}

function parseHousehold(value: unknown): number | null | undefined {
  if (value == null) return null;
  if (value === 2 || value === 3 || value === 4) return value;
  return undefined;
}

function parsePriorities(value: unknown): PriorityId[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((item) => typeof item === "string" && isPriorityId(item))) return null;
  return value as PriorityId[];
}

function parseUseful(value: unknown): UsefulSelection[] | null {
  if (!Array.isArray(value)) return null;
  const useful: UsefulSelection[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.note !== "string") return null;
    useful.push({ id: record.id, note: record.note });
  }
  return useful;
}
