import { describe, expect, it } from "vitest";
import { emptyState, type PriorityId } from "./model";
import { clearState, loadState, saveState, STORAGE_KEY, type KeyValueStore } from "./storage";

function memoryStore(initial?: string): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial != null) data.set(STORAGE_KEY, initial);
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

describe("local persistence", () => {
  it("round-trips search, useful selections, and feedback", () => {
    const store = memoryStore();
    const state = {
      ...emptyState(),
      area: "San Jose",
      mode: "roommates" as const,
      householdSize: 2,
      budgetText: "2800",
      priorities: ["lease", "price"] as PriorityId[],
      useful: [{ id: "sj-downtown", note: "Flexible term" }],
      generalFeedback: "Show washer hookups",
      view: "results" as const,
    };
    expect(saveState(store, state)).toBeNull();
    expect(loadState(store)).toEqual({ state, warning: null });
  });

  it("recovers from corrupted storage without throwing", () => {
    const store = memoryStore("{not json");
    const loaded = loadState(store);
    expect(loaded.state).toEqual(emptyState());
    expect(loaded.warning).toMatch(/unreadable/i);
  });

  it("reports unavailable storage and still returns defaults", () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(loadState(broken).warning).toMatch(/not keeping a saved copy/i);
    expect(loadState(broken).state).toEqual(emptyState());
    expect(saveState(broken, emptyState())).toMatch(/not keeping a saved copy/i);
    expect(loadState(null).warning).toMatch(/not keeping a saved copy/i);
  });

  it("clears stored state on reset", () => {
    const store = memoryStore();
    saveState(store, { ...emptyState(), area: "Cupertino", view: "results" });
    expect(clearState(store)).toBeNull();
    expect(loadState(store).state).toEqual(emptyState());
  });
});
