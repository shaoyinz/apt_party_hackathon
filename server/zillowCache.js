import { randomUUID } from "node:crypto";
import { databaseConfig } from "./pgRepository.js";

export const DEFAULT_SEARCH_URL = "https://www.zillow.com/homes/for_sale/Brooklyn,-New-York,-NY_rb/";
export const DEFAULT_CRON = "0 3 * * *";
const STALE_MS = 24 * 60 * 60 * 1000;
const LOCK_KEY = "zillow-sale-refresh";
const PRICE = /^\$(\d{1,3}(?:,\d{3})+|\d+)$/;

export function cronExpression(env = process.env) {
    return env.ZILLOW_REFRESH_CRON || DEFAULT_CRON;
}

export function scheduleIsActive() {
    return false;
}

export function askingPriceUsd(pricing, priceType) {
    if (!pricing || priceType === "monthly_rent")
        return null;
    const match = PRICE.exec(String(pricing).trim());
    if (!match)
        return null;
    return Number(match[1].replaceAll(",", ""));
}

export function sourceIdentity(listing) {
    const url = listing?.listing_url;
    if (!url)
        return null;
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        return null;
    }
    if (!["zillow.com", "www.zillow.com"].includes(parsed.hostname))
        return null;
    const zpid = parsed.pathname.match(/(\d+)_zpid/);
    if (zpid)
        return `zpid:${zpid[1]}`;
    return `url:${parsed.origin}${parsed.pathname}`;
}

function fixSkipped(listings) {
    const kept = [];
    const seen = new Set();
    let skipped = 0;
    for (const listing of listings || []) {
        const identity = sourceIdentity(listing);
        if (!identity) {
            skipped += 1;
            continue;
        }
        if (seen.has(identity))
            continue;
        seen.add(identity);
        kept.push({
            source_identity: identity,
            pricing: listing.pricing ?? null,
            asking_price_usd: askingPriceUsd(listing.pricing, listing.price_type),
            price_type: listing.price_type ?? null,
            size: listing.size ?? null,
            living_area: listing.living_area ?? null,
            address: listing.address ?? null,
            listing_url: listing.listing_url,
            data_origin: listing.data_origin || null,
            fetched_at: listing.fetched_at || null,
        });
    }
    return { rows: kept, skipped };
}

export function classifyFailure(result) {
    if (result?.truncated)
        return { outcome: "truncated", error_category: "truncated", http_status: result.http_status ?? null };
    const code = result?.code || "fetch_error";
    if (code === "challenge")
        return { outcome: "challenge", error_category: "challenge", http_status: result.http_status ?? 200 };
    if (code === "unrecognized_markup")
        return { outcome: "unrecognized_markup", error_category: "unrecognized_markup", http_status: result.http_status ?? null };
    if (code === "timeout")
        return { outcome: "timeout", error_category: "timeout", http_status: null };
    if (code === "missing_credential")
        return { outcome: "missing_credential", error_category: "missing_credential", http_status: null };
    if (code === "database_error")
        return { outcome: "database_error", error_category: "database_error", http_status: null };
    return {
        outcome: "http_error",
        error_category: code,
        http_status: result?.http_status ?? null,
    };
}

function envelope(searchUrl, state, snapshot, attempt, listings) {
    return {
        source: "zillow",
        listing_kind: "for_sale",
        price_meaning: "for_sale_asking_price",
        monthly_rent: null,
        served_from: "cache",
        live: false,
        search_url: searchUrl,
        state,
        stale: state === "stale" || Boolean(snapshot?.stale && state === "empty"),
        last_success_at: snapshot?.published_at ?? null,
        latest_attempt: attempt,
        count: listings.length,
        truncated: false,
        skipped_without_identity: snapshot?.skipped_without_identity ?? 0,
        listings,
    };
}

export async function readSaleCache(store, searchUrl, now = new Date()) {
    const snapshot = await store.readSnapshot(searchUrl);
    const attempt = await store.latestRun(searchUrl);
    if (!snapshot) {
        return envelope(searchUrl, "unavailable", null, attempt, []);
    }
    const stale = now.getTime() - Date.parse(snapshot.published_at) > STALE_MS;
    const listings = snapshot.rows.map((row) => ({
        source_identity: row.source_identity,
        pricing: row.pricing,
        asking_price_usd: row.asking_price_usd,
        price_type: row.price_type,
        size: row.size,
        living_area: row.living_area,
        address: row.address,
        listing_url: row.listing_url,
        source: "zillow",
        data_origin: row.data_origin,
        fetched_at: row.fetched_at,
    }));
    if (snapshot.status === "empty") {
        const body = envelope(searchUrl, "empty", snapshot, attempt, []);
        body.stale = stale;
        return body;
    }
    return envelope(searchUrl, stale ? "stale" : "fresh", snapshot, attempt, listings);
}

async function finishFailure(store, run, failure) {
    await store.transaction(async (tx) => {
        await tx.finishRun(run.id, {
            outcome: failure.outcome,
            http_status: failure.http_status,
            error_category: failure.error_category,
            row_count: 0,
            truncated: failure.outcome === "truncated",
            skipped_without_identity: 0,
            data_origin: null,
        });
    });
}

export async function runRefresh(store, options) {
    const searchUrl = options.searchUrl;
    const provider = options.provider || "direct";
    const started = (options.now || new Date()).toISOString();
    if (!(await store.tryLock())) {
        const id = randomUUID();
        await store.transaction(async (tx) => {
            await tx.insertRun({
                id,
                search_url: searchUrl,
                started_at: started,
                provider,
                outcome: "overlap",
            });
            await tx.finishRun(id, {
                outcome: "overlap",
                http_status: null,
                error_category: "overlap",
                row_count: null,
                truncated: null,
                skipped_without_identity: null,
                data_origin: null,
            });
        });
        return { ok: false, outcome: "overlap", published: false };
    }
    const id = randomUUID();
    try {
        await store.transaction(async (tx) => {
            await tx.insertRun({ id, search_url: searchUrl, started_at: started, provider, outcome: "running" });
        });
        let result;
        try {
            result = await options.fetchSnapshot();
        }
        catch {
            await finishFailure(store, { id }, classifyFailure({ code: "timeout" }));
            return { ok: false, outcome: "timeout", published: false };
        }
        if (!result?.ok || result.truncated) {
            const failure = classifyFailure(result);
            await finishFailure(store, { id }, failure);
            return { ok: false, outcome: failure.outcome, published: false };
        }
        const prepared = fixSkipped(result.listings);
        if (result.status === "ok" && prepared.rows.length === 0) {
            await finishFailure(store, { id }, { outcome: "validation", error_category: "missing_identity", http_status: result.http_status ?? null });
            return { ok: false, outcome: "validation", published: false };
        }
        const publishedAt = (options.now || new Date()).toISOString();
        try {
            await store.transaction(async (tx) => {
                await tx.replaceSnapshot(searchUrl, {
                    status: result.status,
                    row_count: prepared.rows.length,
                    data_origin: result.data_origin,
                    provider,
                    http_status: result.http_status ?? null,
                    fetched_at: result.fetched_at ?? null,
                    published_at: publishedAt,
                    skipped_without_identity: prepared.skipped,
                }, prepared.rows.map((row) => ({ ...row, data_origin: result.data_origin, fetched_at: row.fetched_at || result.fetched_at || null })));
                await tx.finishRun(id, {
                    outcome: result.status === "empty" ? "empty" : "success",
                    http_status: result.http_status ?? null,
                    error_category: null,
                    row_count: prepared.rows.length,
                    truncated: false,
                    skipped_without_identity: prepared.skipped,
                    data_origin: result.data_origin,
                });
            });
        }
        catch {
            await finishFailure(store, { id }, classifyFailure({ code: "database_error" }));
            return { ok: false, outcome: "database_error", published: false };
        }
        return { ok: true, outcome: result.status === "empty" ? "empty" : "success", published: true };
    }
    finally {
        await store.unlock();
    }
}

export function createMemorySaleStore() {
    const state = { lock: false, snapshots: new Map(), runs: [] };
    function clone() {
        return {
            lock: state.lock,
            snapshots: structuredClone([...state.snapshots.entries()]),
            runs: structuredClone(state.runs),
        };
    }
    function restore(saved) {
        state.lock = saved.lock;
        state.snapshots = new Map(saved.snapshots);
        state.runs = saved.runs;
    }
    function api(target) {
        return {
            async insertRun(run) {
                target.runs.push({ ...run, finished_at: null, http_status: null, error_category: null, row_count: null, truncated: null, skipped_without_identity: null, data_origin: null });
            },
            async finishRun(id, patch) {
                const run = target.runs.find((item) => item.id === id);
                if (!run)
                    throw new Error("missing run");
                Object.assign(run, patch, { finished_at: new Date().toISOString() });
            },
            async replaceSnapshot(searchUrl, snapshot, rows) {
                if (state.failReplace)
                    throw new Error("database write failed");
                target.snapshots.set(searchUrl, { ...snapshot, search_url: searchUrl, rows });
            },
        };
    }
    return {
        failNextReplace() {
            state.failReplace = true;
        },
        async tryLock() {
            if (state.lock)
                return false;
            state.lock = true;
            return true;
        },
        async unlock() {
            state.lock = false;
        },
        async transaction(fn) {
            const saved = clone();
            const draft = {
                lock: state.lock,
                snapshots: new Map(structuredClone([...state.snapshots.entries()])),
                runs: structuredClone(state.runs),
                failReplace: state.failReplace,
            };
            try {
                await fn(api(draft));
                state.snapshots = draft.snapshots;
                state.runs = draft.runs;
            }
            catch (error) {
                restore(saved);
                throw error;
            }
        },
        async readSnapshot(searchUrl) {
            const found = state.snapshots.get(searchUrl);
            return found ? structuredClone(found) : null;
        },
        async latestRun(searchUrl) {
            const runs = state.runs.filter((run) => run.search_url === searchUrl && run.finished_at);
            return runs.length ? structuredClone(runs[runs.length - 1]) : null;
        },
    };
}

function quoteIdent(value) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value))
        throw new Error("unsafe schema");
    return `"${value}"`;
}

export async function createPgSaleStore() {
    const config = databaseConfig();
    if (!config.configured)
        return { configured: false, reason: config.reason };
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ ...config.connection, max: 2, connectionTimeoutMillis: 4000 });
    const schema = quoteIdent(config.schema);
    async function withClient(fn) {
        const client = await pool.connect();
        try {
            await client.query(`SET search_path TO ${schema}, public`);
            return await fn(client);
        }
        finally {
            client.release();
        }
    }
    return {
        configured: true,
        async tryLock() {
            const locked = await withClient((client) => client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [LOCK_KEY]));
            return locked.rows[0].locked === true;
        },
        async unlock() {
            await withClient((client) => client.query("SELECT pg_advisory_unlock(hashtext($1))", [LOCK_KEY]));
        },
        async transaction(fn) {
            await withClient(async (client) => {
                await client.query("BEGIN");
                try {
                    await fn({
                        async insertRun(run) {
                            await client.query(
                                `INSERT INTO zillow_refresh_runs (id, search_url, started_at, outcome, provider) VALUES ($1, $2, $3, $4, $5)`,
                                [run.id, run.search_url, run.started_at, run.outcome, run.provider],
                            );
                        },
                        async finishRun(id, patch) {
                            await client.query(
                                `UPDATE zillow_refresh_runs SET finished_at = now(), outcome = $2, http_status = $3, error_category = $4, row_count = $5, truncated = $6, skipped_without_identity = $7, data_origin = $8 WHERE id = $1`,
                                [id, patch.outcome, patch.http_status, patch.error_category, patch.row_count, patch.truncated, patch.skipped_without_identity, patch.data_origin],
                            );
                        },
                        async replaceSnapshot(searchUrl, snapshot, rows) {
                            await client.query(
                                `INSERT INTO zillow_sale_snapshots (search_url, status, row_count, truncated, data_origin, provider, http_status, fetched_at, published_at, skipped_without_identity)
                                 VALUES ($1, $2, $3, false, $4, $5, $6, $7, $8, $9)
                                 ON CONFLICT (search_url) DO UPDATE SET status = EXCLUDED.status, row_count = EXCLUDED.row_count, truncated = false, data_origin = EXCLUDED.data_origin, provider = EXCLUDED.provider, http_status = EXCLUDED.http_status, fetched_at = EXCLUDED.fetched_at, published_at = EXCLUDED.published_at, skipped_without_identity = EXCLUDED.skipped_without_identity`,
                                [searchUrl, snapshot.status, snapshot.row_count, snapshot.data_origin, snapshot.provider, snapshot.http_status, snapshot.fetched_at, snapshot.published_at, snapshot.skipped_without_identity],
                            );
                            await client.query("DELETE FROM zillow_sale_rows WHERE search_url = $1", [searchUrl]);
                            for (const row of rows) {
                                await client.query(
                                    `INSERT INTO zillow_sale_rows (search_url, source_identity, pricing, asking_price_usd, price_type, size, living_area, address, listing_url, data_origin, fetched_at)
                                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                                    [searchUrl, row.source_identity, row.pricing, row.asking_price_usd, row.price_type, row.size, row.living_area, row.address, row.listing_url, row.data_origin, row.fetched_at],
                                );
                            }
                        },
                    });
                    await client.query("COMMIT");
                }
                catch (error) {
                    await client.query("ROLLBACK");
                    throw new Error("database_error");
                }
            });
        },
        async readSnapshot(searchUrl) {
            return withClient(async (client) => {
                const snapshot = await client.query("SELECT search_url, status, row_count, data_origin, provider, http_status, fetched_at, published_at, skipped_without_identity FROM zillow_sale_snapshots WHERE search_url = $1", [searchUrl]);
                if (!snapshot.rows[0])
                    return null;
                const rows = await client.query("SELECT source_identity, pricing, asking_price_usd, price_type, size, living_area, address, listing_url, data_origin, fetched_at FROM zillow_sale_rows WHERE search_url = $1 ORDER BY source_identity", [searchUrl]);
                return {
                    ...snapshot.rows[0],
                    published_at: snapshot.rows[0].published_at.toISOString(),
                    fetched_at: snapshot.rows[0].fetched_at ? snapshot.rows[0].fetched_at.toISOString() : null,
                    asking_price_usd: undefined,
                    rows: rows.rows.map((row) => ({
                        ...row,
                        asking_price_usd: row.asking_price_usd == null ? null : Number(row.asking_price_usd),
                        fetched_at: row.fetched_at ? row.fetched_at.toISOString() : null,
                    })),
                };
            });
        },
        async latestRun(searchUrl) {
            return withClient(async (client) => {
                const run = await client.query("SELECT outcome, http_status, error_category, finished_at, provider, row_count FROM zillow_refresh_runs WHERE search_url = $1 AND finished_at IS NOT NULL ORDER BY started_at DESC LIMIT 1", [searchUrl]);
                if (!run.rows[0])
                    return null;
                return { ...run.rows[0], finished_at: run.rows[0].finished_at.toISOString() };
            });
        },
    };
}
