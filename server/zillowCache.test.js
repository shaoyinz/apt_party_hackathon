import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createZillowReadMiddleware, readCachedSources } from "./zillowCachePlugin.js";
import { askingPriceUsd, createMemorySaleStore, cronExpression, DEFAULT_SEARCH_URL, nextDailyRun, readSaleCache, runRefresh, scheduleIsActive, scheduleShouldStart, startDailyRefresh, stopDailyRefresh } from "./zillowCache.js";
import { failureFromStderr } from "../scripts/zillow-refresh.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = DEFAULT_SEARCH_URL;

function card(id, price = "$599,900", address = "10 Main Street") {
    return {
        pricing: price,
        price_type: "asking_price",
        size: "3 bds, 2 ba, 1,200 sqft",
        living_area: "1,200 sqft",
        address,
        listing_url: `https://www.zillow.com/homedetails/10-Main/${id}_zpid/`,
        fetched_at: "2026-10-10T03:00:00Z",
    };
}

function success(listings, extra = {}) {
    return {
        ok: true,
        status: "ok",
        truncated: false,
        listings,
        data_origin: "direct_fetch",
        fetched_at: "2026-10-10T03:00:00Z",
        http_status: 200,
        ...extra,
    };
}

async function refresh(store, result, now = "2026-10-10T03:00:00Z") {
    return runRefresh(store, {
        searchUrl: url,
        provider: "direct",
        now: new Date(now),
        fetchSnapshot: async () => result,
    });
}

describe("zillow sale cache", () => {
    it("keeps asking prices out of the rental migration", () => {
        const sql = readFileSync(path.join(root, "supabase/002_zillow_sale_cache.sql"), "utf8");
        expect(sql).not.toMatch(/insert into public\.listings/i);
        expect(sql).not.toMatch(/update public\.listings/i);
        expect(sql).not.toMatch(/alter table public\.listings/i);
        expect(sql).toMatch(/zillow_sale_rows/);
    });

    it("parses only unambiguous asking prices", () => {
        expect(askingPriceUsd("$599,900", "asking_price")).toBe(599900);
        expect(askingPriceUsd("$599,900+", "asking_price")).toBeNull();
        expect(askingPriceUsd("$2,500/mo", "monthly_rent")).toBeNull();
        expect(askingPriceUsd(null, "asking_price")).toBeNull();
    });

    it("publishes idempotent snapshots and preserves them after 403, challenge, and database failure", async () => {
        const store = createMemorySaleStore();
        expect((await refresh(store, success([card("1"), card("1"), card("2", "$10")]))).published).toBe(true);
        let body = await readSaleCache(store, url, new Date("2026-10-10T04:00:00Z"));
        expect(body.state).toBe("fresh");
        expect(body.live).toBe(false);
        expect(body.monthly_rent).toBeNull();
        expect(body.listings.map((item) => item.source_identity)).toEqual(["zpid:1", "zpid:2"]);
        expect(body.listings[0].asking_price_usd).toBe(599900);

        const before = structuredClone(body.listings);
        expect((await refresh(store, { ok: false, code: "http_error", http_status: 403 })).published).toBe(false);
        expect((await refresh(store, { ok: false, code: "challenge", http_status: 200 })).published).toBe(false);
        expect((await refresh(store, success([card("9")], { truncated: true }))).outcome).toBe("truncated");
        store.failNextReplace();
        expect((await refresh(store, success([card("8")]))).outcome).toBe("database_error");
        body = await readSaleCache(store, url, new Date("2026-10-10T05:00:00Z"));
        expect(body.listings).toEqual(before);
        expect(body.latest_attempt.outcome).toBe("database_error");
    });

    it("does not clear a missing first snapshot on HTTP 403 and distinguishes empty results", async () => {
        const blocked = createMemorySaleStore();
        await refresh(blocked, { ok: false, code: "http_error", http_status: 403 });
        const unavailable = await readSaleCache(blocked, url, new Date("2026-10-10T03:10:00Z"));
        expect(unavailable.state).toBe("unavailable");
        expect(unavailable.listings).toEqual([]);
        expect(unavailable.latest_attempt.http_status).toBe(403);

        const empty = createMemorySaleStore();
        await refresh(empty, success([card("1")]));
        await refresh(empty, success([], { status: "empty", listings: [] }));
        const cleared = await readSaleCache(empty, url, new Date("2026-10-10T04:00:00Z"));
        expect(cleared.state).toBe("empty");
        expect(cleared.listings).toEqual([]);
    });

    it("rejects overlap, ambiguous prices, and rows without identity", async () => {
        const store = createMemorySaleStore();
        await refresh(store, success([card("1", "$599,900+")]));
        const priced = await readSaleCache(store, url, new Date("2026-10-10T03:10:00Z"));
        expect(priced.listings[0].asking_price_usd).toBeNull();
        expect(priced.listings[0].pricing).toBe("$599,900+");

        expect(await store.tryLock()).toBe(true);
        const second = await runRefresh(store, { searchUrl: url, fetchSnapshot: async () => success([card("5")]) });
        expect(second.outcome).toBe("overlap");
        await store.unlock();
        expect((await refresh(store, success([card("4")]))).published).toBe(true);
        const body = await readSaleCache(store, url, new Date("2026-10-10T03:20:00Z"));
        expect(body.listings.map((item) => item.source_identity)).toEqual(["zpid:4"]);

        const noId = createMemorySaleStore();
        await refresh(noId, success([card("1")]));
        await refresh(noId, success([{ pricing: "$1", listing_url: null }]));
        const kept = await readSaleCache(noId, url, new Date("2026-10-10T03:20:00Z"));
        expect(kept.listings).toHaveLength(1);
    });

    it("marks data stale after 24 hours and does not call the scraper on read", async () => {
        const store = createMemorySaleStore();
        const fetchSnapshot = vi.fn(async () => success([card("1")]));
        await runRefresh(store, { searchUrl: url, now: new Date("2026-10-08T03:00:00Z"), fetchSnapshot });
        fetchSnapshot.mockClear();
        const stale = await readSaleCache(store, url, new Date("2026-10-10T04:00:00Z"));
        expect(stale.state).toBe("stale");
        expect(fetchSnapshot).not.toHaveBeenCalled();
        expect(cronExpression({})).toBe("0 3 * * *");
        expect(scheduleShouldStart({})).toBe(false);
        expect(scheduleShouldStart({ RAILWAY_ENVIRONMENT: "production" })).toBe(true);
        expect(scheduleShouldStart({ RAILWAY_ENVIRONMENT: "production", ZILLOW_REFRESH_SCHEDULE: "0" })).toBe(false);
        expect(nextDailyRun(new Date("2026-10-10T03:00:00Z")).toISOString()).toBe("2026-10-11T03:00:00.000Z");
        expect(scheduleIsActive()).toBe(false);
        const run = vi.fn(async () => {});
        startDailyRefresh(run, {
            env: { ZILLOW_REFRESH_SCHEDULE: "1" },
            now: () => new Date("2026-10-10T02:00:00Z"),
            setTimer: () => 0,
        });
        expect(run).not.toHaveBeenCalled();
        expect(scheduleIsActive()).toBe(true);
        stopDailyRefresh();
        expect(scheduleIsActive()).toBe(false);
        expect(failureFromStderr("zillow_scraper: http_error: Direct fetch was denied (HTTP 403).\n").http_status).toBe(403);
    });

    it("serves cached reads without scraping and separates database failure", async () => {
        const store = createMemorySaleStore();
        store.configured = true;
        await refresh(store, success([card("1")]));
        const fetchSnapshot = vi.fn();
        const res = { setHeader() {}, end: vi.fn() };
        await createZillowReadMiddleware(async () => store)({ method: "GET", url: "/api/zillow-sales" }, res, () => {});
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.end.mock.calls[0][0]).state).toBe("fresh");
        expect(fetchSnapshot).not.toHaveBeenCalled();

        const down = { setHeader() {}, end: vi.fn() };
        await createZillowReadMiddleware(async () => ({ configured: false, reason: "DATABASE_URL and PGHOST are unset." }))({ method: "GET", url: "/api/zillow-sales" }, down, () => {});
        expect(down.statusCode).toBe(503);
        expect(JSON.parse(down.end.mock.calls[0][0]).state).toBe("database_unavailable");
        expect(JSON.parse(down.end.mock.calls[0][0]).listings).toEqual([]);
    });

    it("filters cached rows by city without scraping", async () => {
        const queens = "https://www.zillow.com/homes/for_sale/Queens,-NY_rb/";
        const store = createMemorySaleStore();
        store.configured = true;
        await refresh(store, success([card("1", "$700,000", "10 Brooklyn Ave")]));
        await runRefresh(store, {
            searchUrl: queens,
            fetchSnapshot: async () => success([card("9", "$800,000", "9 Queens Blvd")]),
        });
        const fetchSnapshot = vi.fn();
        const brooklyn = await readCachedSources(store, [{ label: "Brooklyn, NY", url }], new Date("2026-10-10T04:00:00Z"));
        expect(brooklyn.listings.map((item) => item.city)).toEqual(["Brooklyn, NY"]);
        expect(brooklyn.listings[0].asking_price_usd).toBe(700000);
        expect(brooklyn.monthly_rent).toBeNull();
        const queensBody = await readCachedSources(store, [{ label: "Queens, NY", url: queens }], new Date("2026-10-10T04:00:00Z"));
        expect(queensBody.listings.map((item) => item.source_identity)).toEqual(["zpid:9"]);
        expect(fetchSnapshot).not.toHaveBeenCalled();

        const res = { setHeader() {}, end: vi.fn() };
        await createZillowReadMiddleware(async () => store)({ method: "GET", url: "/api/zillow-sales?city=Brooklyn" }, res, () => {});
        const body = JSON.parse(res.end.mock.calls[0][0]);
        expect(body.listings).toHaveLength(1);
        expect(body.listings[0].search_url).toBe(url);
        expect(body.live).toBe(false);

        const missing = { setHeader() {}, end: vi.fn() };
        await createZillowReadMiddleware(async () => store)({ method: "GET", url: "/api/zillow-sales?city=Austin" }, missing, () => {});
        expect(JSON.parse(missing.end.mock.calls[0][0]).state).toBe("unknown_coverage");
        expect(JSON.parse(missing.end.mock.calls[0][0]).listings).toEqual([]);
    });
});
