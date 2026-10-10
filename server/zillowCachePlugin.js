import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { databaseConfig } from "./pgRepository.js";
import { createPgSaleStore, DEFAULT_SEARCH_URL, readSaleCache, scheduleIsActive, scheduleShouldStart, startDailyRefresh } from "./zillowCache.js";
import { parseZillowCoverage, sourcesForQuery } from "../src/zillowCoverage.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function configuredZillowSources(env = process.env) {
    const override = parseZillowCoverage(env.ZILLOW_SEARCH_SOURCES);
    if (override)
        return override;
    try {
        const file = JSON.parse(readFileSync(path.join(root, "zillow-sources.json"), "utf8"));
        if (Array.isArray(file) && file.length)
            return file;
    }
    catch {
        return [{ label: "Brooklyn, NY", url: DEFAULT_SEARCH_URL }];
    }
    return [{ label: "Brooklyn, NY", url: DEFAULT_SEARCH_URL }];
}

function send(res, status, body) {
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify(body));
}

function spawnRefresh() {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [path.join(root, "scripts/zillow-refresh.mjs")], {
            env: process.env,
            stdio: "ignore",
        });
        child.on("close", () => resolve());
        child.on("error", () => resolve());
    });
}

function tagListings(body, source) {
    return {
        ...body,
        listings: body.listings.map((listing) => ({
            ...listing,
            search_url: source.url,
            city: source.label,
            monthly_rent: null,
        })),
        coverage: [{ label: source.label, url: source.url, state: body.state, count: body.count }],
    };
}

export async function readCachedSources(store, targets, now = new Date()) {
    if (targets.length === 1)
        return tagListings(await readSaleCache(store, targets[0].url, now), targets[0]);
    const listings = [];
    const coverage = [];
    let lastSuccess = null;
    let latest = null;
    const states = [];
    for (const source of targets) {
        const body = await readSaleCache(store, source.url, now);
        states.push(body.state);
        coverage.push({ label: source.label, url: source.url, state: body.state, count: body.count, last_success_at: body.last_success_at });
        if (body.last_success_at && (!lastSuccess || body.last_success_at > lastSuccess))
            lastSuccess = body.last_success_at;
        if (body.latest_attempt && (!latest || String(body.latest_attempt.finished_at || "") >= String(latest.finished_at || "")))
            latest = body.latest_attempt;
        for (const listing of body.listings)
            listings.push({ ...listing, search_url: source.url, city: source.label, monthly_rent: null });
    }
    const state = states.includes("fresh")
        ? "fresh"
        : states.includes("stale")
            ? "stale"
            : states.length && states.every((item) => item === "empty")
                ? "empty"
                : "unavailable";
    return {
        source: "zillow",
        listing_kind: "for_sale",
        price_meaning: "for_sale_asking_price",
        monthly_rent: null,
        served_from: "cache",
        live: false,
        state,
        stale: state === "stale",
        last_success_at: lastSuccess,
        latest_attempt: latest,
        count: listings.length,
        truncated: false,
        listings,
        coverage,
    };
}

function blocked(reason) {
    return {
        source: "zillow",
        listing_kind: "for_sale",
        price_meaning: "for_sale_asking_price",
        monthly_rent: null,
        served_from: "cache",
        live: false,
        state: "database_unavailable",
        stale: false,
        last_success_at: null,
        latest_attempt: null,
        count: 0,
        truncated: false,
        listings: [],
        configured_sources: configuredZillowSources(),
        error: reason,
    };
}

export function createZillowReadMiddleware(getStore) {
    return async function zillowRead(req, res, next) {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        if (url.pathname !== "/api/zillow-sales")
            return next();
        if (req.method !== "GET") {
            send(res, 405, { error: "Method not allowed." });
            return;
        }
        const sources = configuredZillowSources();
        const city = url.searchParams.get("city");
        let targets = sources;
        if (city) {
            targets = sourcesForQuery(sources, city);
            if (!targets.length) {
                send(res, 200, {
                    source: "zillow",
                    listing_kind: "for_sale",
                    price_meaning: "for_sale_asking_price",
                    monthly_rent: null,
                    served_from: "cache",
                    live: false,
                    state: "unknown_coverage",
                    stale: false,
                    last_success_at: null,
                    latest_attempt: null,
                    count: 0,
                    truncated: false,
                    listings: [],
                    configured_sources: sources,
                    error: "That city or ZIP is not configured for Zillow scraping.",
                });
                return;
            }
        }
        else if (url.searchParams.has("url")) {
            const searchUrl = url.searchParams.get("url") || DEFAULT_SEARCH_URL;
            let parsed;
            try {
                parsed = new URL(searchUrl);
            }
            catch {
                send(res, 400, { error: "Only zillow.com search URLs can be read from the cache." });
                return;
            }
            if (!["https:", "http:"].includes(parsed.protocol) || !["zillow.com", "www.zillow.com"].includes(parsed.hostname)) {
                send(res, 400, { error: "Only zillow.com search URLs can be read from the cache." });
                return;
            }
            const known = sources.find((source) => source.url === searchUrl);
            targets = [{ label: known?.label || "Configured Zillow search", url: searchUrl }];
        }
        try {
            const store = await getStore();
            if (!store?.configured)
                return send(res, 503, blocked(store?.reason || "DATABASE_URL and PGHOST are unset."));
            const body = await readCachedSources(store, targets, new Date());
            send(res, 200, { ...body, configured_sources: sources });
        }
        catch {
            send(res, 503, blocked("The sale cache could not be read. Credentials were not included."));
        }
    };
}

export function zillowCachePlugin() {
    if (scheduleShouldStart() && !scheduleIsActive())
        startDailyRefresh(spawnRefresh);
    let storePromise;
    const middleware = createZillowReadMiddleware(() => {
        const config = databaseConfig();
        if (!config.configured)
            return { configured: false, reason: config.reason };
        storePromise = storePromise || createPgSaleStore();
        return storePromise;
    });
    return {
        name: "zillow-sale-cache",
        configureServer(server) {
            server.middlewares.use(middleware);
        },
        configurePreviewServer(server) {
            server.middlewares.use(middleware);
        },
    };
}
