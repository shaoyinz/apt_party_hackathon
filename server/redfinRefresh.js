import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { databaseConfig } from "./pgRepository.js";
import { DEFAULT_REDFIN_SEARCH_URL, REDFIN_REFRESH_MS, adaptRedfinRows, cacheIsFresh, emptyRedfinCache } from "../src/redfinCatalog.js";

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

export function publicRedfinCatalog(cache) {
    return {
        status: cache.status,
        collectedAt: cache.collectedAt,
        attemptedAt: cache.attemptedAt,
        message: cache.message,
        sourcePageUrl: cache.sourcePageUrl,
        listings: cache.listings || [],
    };
}

function searchUrl() {
    return process.env.REDFIN_SEARCH_URL || DEFAULT_REDFIN_SEARCH_URL;
}

function refreshMs() {
    const hours = Number(process.env.REDFIN_REFRESH_HOURS || 24);
    if (!Number.isFinite(hours) || hours <= 0) return REDFIN_REFRESH_MS;
    return hours * 60 * 60 * 1000;
}

function runScraper(root, url) {
    const output = path.join(os.tmpdir(), `redfin-${process.pid}.json`);
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
            resolve({ code, stderr: stderr.slice(0, 400), rows });
        });
    });
}

async function saveToDatabase(rows) {
    const config = databaseConfig();
    if (!config.configured) return { saved: false, reason: "database_unconfigured" };
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ ...config.connection, max: 1, connectionTimeoutMillis: 4000 });
    const schema = config.schema;
    const client = await pool.connect();
    try {
        await client.query(`CREATE TABLE IF NOT EXISTS ${schema}.redfin_listings (
            property_url TEXT PRIMARY KEY,
            price_text TEXT,
            configuration TEXT,
            address TEXT,
            city TEXT,
            broker TEXT,
            availability TEXT,
            listing_status TEXT,
            description TEXT,
            source_page_url TEXT,
            collected_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
        await client.query(`ALTER TABLE ${schema}.redfin_listings ENABLE ROW LEVEL SECURITY`);
        for (const row of rows) {
            if (!row.sourceUrl) continue;
            await client.query(
                `INSERT INTO ${schema}.redfin_listings (
                    property_url, price_text, configuration, address, city, broker, availability,
                    listing_status, description, source_page_url, collected_at, updated_at
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
                ON CONFLICT (property_url) DO UPDATE SET
                    price_text = EXCLUDED.price_text,
                    configuration = EXCLUDED.configuration,
                    address = EXCLUDED.address,
                    city = EXCLUDED.city,
                    broker = EXCLUDED.broker,
                    availability = EXCLUDED.availability,
                    listing_status = EXCLUDED.listing_status,
                    description = EXCLUDED.description,
                    source_page_url = EXCLUDED.source_page_url,
                    collected_at = EXCLUDED.collected_at,
                    updated_at = NOW()`,
                [
                    row.sourceUrl,
                    row.salePriceText,
                    row.roomLabel,
                    row.title,
                    row.city,
                    "",
                    row.availability,
                    row.listingStatus,
                    "",
                    searchUrl(),
                    row.collectedAt || null,
                ],
            );
        }
        return { saved: true };
    } catch {
        return { saved: false, reason: "database_write_failed" };
    } finally {
        client.release();
        await pool.end();
    }
}

export async function hydrateRedfinCache(root) {
    const current = readRedfinCache(root);
    if (current.listings?.length) return current;
    const config = databaseConfig();
    if (!config.configured) return current;
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ ...config.connection, max: 1, connectionTimeoutMillis: 4000 });
    const client = await pool.connect();
    try {
        const result = await client.query(
            `SELECT property_url, price_text, configuration, address, availability, listing_status, collected_at
             FROM ${config.schema}.redfin_listings`,
        );
        const listings = adaptRedfinRows(result.rows.map((row) => ({
            property_url: row.property_url,
            price: row.price_text,
            configuration: row.configuration,
            address: row.address,
            availability: row.availability,
            listing_status: row.listing_status,
            collected_at: row.collected_at ? new Date(row.collected_at).toISOString() : "",
        })));
        if (!listings.length) return current;
        const next = {
            ...current,
            status: "ready",
            collectedAt: listings.find((listing) => listing.collectedAt)?.collectedAt || null,
            message: "Search is using the saved Redfin table. Prices are for sale, not monthly rent.",
            listings,
        };
        writeRedfinCache(root, next);
        return next;
    } catch {
        return current;
    } finally {
        client.release();
        await pool.end();
    }
}

export async function refreshRedfinCache(root, { force = false } = {}) {
    const current = readRedfinCache(root);
    if (!force && cacheIsFresh(current, Date.now(), refreshMs())) return current;
    const url = searchUrl();
    const attempt = new Date().toISOString();
    const result = await runScraper(root, url);
    if (!Array.isArray(result.rows)) {
        const kept = {
            ...current,
            attemptedAt: attempt,
            status: current.listings?.length ? "ready" : "blocked",
            message: current.listings?.length
                ? "The latest Redfin request failed. Search is using the previous collection. For-sale prices are not monthly rent."
                : "Redfin did not return listings. Search was not blocked, and no fixture data was substituted. For-sale prices are not monthly rent.",
        };
        writeRedfinCache(root, kept);
        return kept;
    }
    const listings = adaptRedfinRows(result.rows);
    const next = {
        attemptedAt: attempt,
        collectedAt: listings.find((listing) => listing.collectedAt)?.collectedAt || attempt,
        status: "ready",
        message: "Redfin rows are from the last completed collection, not a scrape during search. Prices are for sale, not monthly rent.",
        sourcePageUrl: url,
        listings,
    };
    writeRedfinCache(root, next);
    await saveToDatabase(listings);
    return next;
}
