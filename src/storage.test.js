import { describe, expect, it } from "vitest";
import { emptyState } from "./model";
import { clearState, loadState, saveState, STORAGE_KEY } from "./storage";
function memoryStore(initial) {
    const data = new Map();
    if (initial != null)
        data.set(STORAGE_KEY, initial);
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
            mode: "roommates",
            householdSize: 2,
            budgetText: "2800",
            priorities: ["lease", "price"],
            useful: [{ id: "sj-downtown", note: "Flexible term" }],
            generalFeedback: "Show washer hookups",
            view: "results",
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
        const broken = {
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
    it("loads a saved search that predates groups", () => {
        const store = memoryStore(JSON.stringify({
            area: "San Jose",
            mode: "solo",
            householdSize: null,
            budgetText: "",
            priorities: ["price"],
            useful: [],
            generalFeedback: "",
            view: "results",
        }));
        const loaded = loadState(store);
        expect(loaded.warning).toBeNull();
        expect(loaded.state.area).toBe("San Jose");
        expect(loaded.state.groups).toEqual([]);
        expect(loaded.state.view).toBe("results");
    });
    it("keeps the search when group data is corrupt", () => {
        const store = memoryStore(JSON.stringify({
            ...emptyState(),
            area: "Cupertino",
            view: "setup",
            groups: { bad: true },
        }));
        const loaded = loadState(store);
        expect(loaded.state.area).toBe("Cupertino");
        expect(loaded.state.groups).toEqual([]);
        expect(loaded.warning).toMatch(/group data/i);
    });
    it("clears stored state on reset", () => {
        const store = memoryStore();
        saveState(store, { ...emptyState(), area: "Cupertino", view: "results" });
        expect(clearState(store)).toBeNull();
        expect(loadState(store).state).toEqual(emptyState());
    });
});
