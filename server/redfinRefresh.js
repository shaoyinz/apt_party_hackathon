import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { databaseConfig } from "./pgRepository.js";
import {
    REDFIN_CACHE_VERSION,
    REDFIN_CITY_TARGETS,
    REDFIN_REFRESH_MS,
    cacheIsFresh,
    cityCounts,
    emptyRedfinCache,
    listingsForCity,
    mergeCityRefresh,
    normalizeCity,
    rowsForTarget,
} from "../src/redfinCatalog.js";

const scheduler = {
    running: false,
    startedAt: null,
    nextRefreshAt: null,
    lastFinishedAt: null,
    timer: null,
};

export function schedulerStatus() {
    return {
        running: scheduler.running,
        startedAt: scheduler.startedAt,
        nextRefreshAt: scheduler.nextRefreshAt,
        lastFinishedAt: scheduler.lastFinishedAt,
    };
}

export function redfinCachePath(root) {
    return path.join(root, "data", "redfin-cache.json");
}

export function readRedfinCache(root) {
    const cachePath = redfinCachePath(root);
    if (!fs.existsSync(cachePath)) return emptyRedfinCache();
    try {
        return { ...emptyRedfinCache(), ...JSON.parse(fs.readFileSync(cachePath, "utf8")) };
    } catch {
        return emptyRedfinCache();
    }
}

export function writeRedfinCache(root, cache) {
    const cachePath = redfinCachePath(root);
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const temporary = `${cachePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(cache, null, 2));
    fs.renameSync(temporary, cachePath);
}

function refreshMs() {
    const hours = Number(process.env.REDFIN_REFRESH_HOURS || 24);
    if (!Number.isFinite(hours) || hours <= 0) return REDFIN_REFRESH_MS;
    return hours * 60 * 60 * 1000;
}

function rentalUrl(saleUrl) {
    return saleUrl ? `${saleUrl.replace(/\/$/, "")}/apartments-for-rent` : "";
}

function targets() {
    return REDFIN_CITY_TARGETS.flatMap((target) => [
        { ...target, listingType: "for-sale", url: target.saleUrl },
        { ...target, listingType: "rental", url: rentalUrl(target.saleUrl) },
    ]);
}

function runScraper(root, url) {
    const output = path.join(os.tmpdir(), `redfin-${process.pid}-${Date.now()}.json`);
    return new Promise((resolve) => {
        const child = spawn("python3", [
            path.join(root, "scripts", "redfin_scraper.py"),
            "search",
            "--url",
            url,
            "--output",
            output,
            "--format",
            "json",
            "--timeout",
            "20",
            "--limit",
            "40",
        ], { env: process.env });
        let stderr = "";
        const timer = setTimeout(() => child.kill("SIGKILL"), 30000);
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString("utf8");
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            let rows = null;
            if (code === 0 && fs.existsSync(output)) {
                try {
                    rows = JSON.parse(fs.readFileSync(output, "utf8"));
                } catch {
                    rows = null;
                }
            }
            fs.rmSync(output, { force: true });
            resolve({ code, stderr: stderr.slice(0, 240), rows });
        });
    });
}

async function databaseStatus() {
    const config = databaseConfig();
    if (!config.configured) {
        return {
            configured: false,
            migrationApplied: false,
            readOk: false,
            writeOk: false,
            reason: "DATABASE_URL and PGHOST are unset. No session secret is attached.",
        };
    }
    return { configured: true, migrationApplied: null, readOk: null, writeOk: null, reason: "" };
}

async function saveToDatabase(rows) {
    const config = databaseConfig();
    if (!config.configured) return { saved: false, readOk: false, writeOk: false, migrationApplied: false, reason: "database_unconfigured" };
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ ...config.connection, max: 1, connectionTimeoutMillis: 4000 });
    const schema = config.schema;
    const client = await pool.connect();
    try {
        await client.query(`CREATE TABLE IF NOT EXISTS ${schema}.redfin_listings (
            property_url TEXT PRIMARY KEY,
            city TEXT NOT NULL,
            source_url TEXT NOT NULL,
            listing_type TEXT NOT NULL CHECK (listing_type IN ('rental', 'for-sale')),
            price_text TEXT,
            configuration TEXT,
            address TEXT,
            availability TEXT,
            listing_status TEXT,
            source_page_url TEXT,
            collected_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
        await client.query(`ALTER TABLE ${schema}.redfin_listings ENABLE ROW LEVEL SECURITY`);
        await client.query(`CREATE INDEX IF NOT EXISTS redfin_listings_city_idx ON ${schema}.redfin_listings (city)`);
        for (const row of rows) {
            if (!row.sourceUrl || !row.city) continue;
            await client.query(
                `INSERT INTO ${schema}.redfin_listings (
                    property_url, city, source_url, listing_type, price_text, property_type, beds, baths, lat, lng,
                    configuration, address, availability, listing_status, source_page_url, collected_at, updated_at
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
                ON CONFLICT (property_url) DO UPDATE SET
                    city = EXCLUDED.city,
                    source_url = EXCLUDED.source_url,
                    listing_type = EXCLUDED.listing_type,
                    price_text = EXCLUDED.price_text,
                    property_type = EXCLUDED.property_type,
                    beds = EXCLUDED.beds,
                    baths = EXCLUDED.baths,
                    lat = EXCLUDED.lat,
                    lng = EXCLUDED.lng,
                    configuration = EXCLUDED.configuration,
                    address = EXCLUDED.address,
                    availability = EXCLUDED.availability,
                    listing_status = EXCLUDED.listing_status,
                    source_page_url = EXCLUDED.source_page_url,
                    collected_at = EXCLUDED.collected_at,
                    updated_at = NOW()`,
                [
                    row.sourceUrl,
                    row.city,
                    row.sourceUrl,
                    row.listingType,
                    row.listingType === "rental" ? row.rentalPriceText : row.salePriceText,
                    row.propertyType || null,
                    row.beds,
                    row.baths,
                    row.coordinates?.lat ?? null,
                    row.coordinates?.lon ?? null,
                    row.roomLabel,
                    row.title,
                    row.availability,
                    row.listingStatus,
                    "",
                    row.collectedAt || null,
                ],
            );
        }
        const check = await client.query(`SELECT COUNT(*)::int AS count FROM ${schema}.redfin_listings`);
        return { saved: true, migrationApplied: true, readOk: true, writeOk: true, count: check.rows[0].count, reason: "" };
    } catch {
        return { saved: false, migrationApplied: false, readOk: false, writeOk: false, reason: "database_write_failed" };
    } finally {
        client.release();
        await pool.end();
    }
}

async function readCityFromDatabase(city) {
    const config = databaseConfig();
    if (!config.configured) return null;
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ ...config.connection, max: 1, connectionTimeoutMillis: 4000 });
    const client = await pool.connect();
    try {
        const result = await client.query(
            `SELECT property_url, city, source_url, listing_type, price_text, configuration, address, availability, listing_status, collected_at, updated_at
             FROM ${config.schema}.redfin_listings
             WHERE lower(city) = lower($1)`,
            [city],
        );
        return result.rows.map((row) => ({
            property_url: row.property_url,
            address: row.address,
            price: row.price_text,
            configuration: row.configuration,
            listing_type: row.listing_type,
            availability: row.availability,
            listing_status: row.listing_status,
            collected_at: row.collected_at ? new Date(row.collected_at).toISOString() : "",
            updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : "",
            city: row.city,
        }));
    } catch {
        return null;
    } finally {
        client.release();
        await pool.end();
    }
}

export async function refreshRedfinCache(root, { force = false } = {}) {
    const stored = readRedfinCache(root);
    const current = stored.version === REDFIN_CACHE_VERSION ? stored : emptyRedfinCache();
    if (!force && cacheIsFresh(current, Date.now(), refreshMs())) return current;
    const attempt = new Date().toISOString();
    let listings = (current.listings || []).filter((listing) => REDFIN_CITY_TARGETS.some((target) => normalizeCity(target.city) === normalizeCity(listing.city)));
    const cities = { ...(current.cities || {}) };
    for (const target of targets()) {
        const key = `${target.city}:${target.listingType}`;
        if (!target.url) {
            cities[key] = {
                city: target.city,
                listingType: target.listingType,
                status: "unresolved",
                count: listingsForCity(listings, target.city).filter((row) => row.listingType === target.listingType).length,
                error: "Redfin city URL is not verified, so this city was not requested.",
                sourcePageUrl: "",
            };
            continue;
        }
        const result = await runScraper(root, target.url);
        if (!Array.isArray(result.rows)) {
            const merged = mergeCityRefresh(listings, target.city, target.listingType, { ok: false });
            listings = merged.listings;
            cities[key] = {
                city: target.city,
                listingType: target.listingType,
                status: merged.preserved && listingsForCity(listings, target.city).some((row) => row.listingType === target.listingType) ? "preserved" : "blocked",
                count: listingsForCity(listings, target.city).filter((row) => row.listingType === target.listingType).length,
                error: result.stderr || `Redfin request failed (${result.code}).`,
                sourcePageUrl: target.url,
            };
            continue;
        }
        const matched = rowsForTarget(result.rows, target.city, target.listingType);
        const merged = mergeCityRefresh(listings, target.city, target.listingType, { ok: true, listings: matched });
        listings = merged.listings;
        cities[key] = {
            city: target.city,
            listingType: target.listingType,
            status: "ready",
            count: matched.length,
            collectedAt: attempt,
            error: "",
            sourcePageUrl: target.url,
        };
    }
    const counts = cityCounts(listings);
    const blocked = Object.values(cities).filter((item) => item.status === "blocked" || item.status === "unresolved").length;
    const next = {
        ...emptyRedfinCache(),
        attemptedAt: attempt,
        collectedAt: listings.some((row) => row.collectedAt) ? attempt : current.collectedAt,
        status: listings.length ? (blocked ? "partial" : "ready") : "blocked",
        message: "Search reads the daily city cache and does not scrape Redfin.",
        cities,
        counts,
        listings,
        database: await saveToDatabase(listings),
    };
    writeRedfinCache(root, next);
    scheduler.lastFinishedAt = new Date().toISOString();
    return next;
}

export function publicCityCatalog(cache, city) {
    const wanted = String(city || "").trim();
    const listings = listingsForCity(cache.listings || [], wanted);
    const known = REDFIN_CITY_TARGETS.some((target) => normalizeCity(target.city) === normalizeCity(wanted));
    return {
        city: wanted,
        status: listings.length ? "ready" : "empty",
        count: listings.length,
        listings,
        collectedAt: cache.collectedAt,
        attemptedAt: cache.attemptedAt,
        message: listings.length
            ? `${listings.length} cached Redfin listing${listings.length === 1 ? "" : "s"} for ${wanted}. Prices are labeled by listing type and are not mixed into monthly rent.`
            : known
                ? `No cached Redfin listings for ${wanted}. Listings from other cities are not shown.`
                : `No cached Redfin listings for ${wanted}. Roost does not substitute another city.`,
        counts: cache.counts || cityCounts(cache.listings || []),
        cities: cache.cities || {},
        database: cache.database || { configured: false, migrationApplied: false, readOk: false, writeOk: false, reason: "not checked" },
        scheduler: schedulerStatus(),
    };
}

export async function cityCatalog(root, city) {
    const cache = readRedfinCache(root);
    const local = publicCityCatalog(cache, city);
    const remote = await readCityFromDatabase(city);
    if (!Array.isArray(remote)) return local;
    const listings = listingsForCity(remote.map((row) => ({
        ...row,
        city: row.city,
        listingType: row.listing_type,
        salePriceText: row.listing_type === "for-sale" ? row.price : "",
        rentalPriceText: row.listing_type === "rental" ? row.price : "",
        sourceUrl: row.property_url,
        title: row.address,
        origin: "redfin",
    })), city);
    if (!listings.length) return { ...local, database: { ...local.database, configured: true, readOk: true } };
    return {
        ...local,
        status: "ready",
        count: listings.length,
        listings,
        message: `${listings.length} Supabase Redfin listing${listings.length === 1 ? "" : "s"} for ${city}. Other cities were not included.`,
        database: { configured: true, migrationApplied: true, readOk: true, writeOk: local.database?.writeOk || false, reason: "" },
    };
}

export function startRedfinScheduler(root) {
    if (scheduler.running) return schedulerStatus();
    const interval = refreshMs();
    scheduler.running = true;
    scheduler.startedAt = new Date().toISOString();
    scheduler.nextRefreshAt = new Date(Date.now() + interval).toISOString();
    const tick = () => {
        scheduler.nextRefreshAt = new Date(Date.now() + interval).toISOString();
        return refreshRedfinCache(root).catch(() => readRedfinCache(root));
    };
    void tick();
    scheduler.timer = setInterval(() => {
        void tick();
    }, interval);
    if (typeof scheduler.timer.unref === "function") scheduler.timer.unref();
    return schedulerStatus();
}
