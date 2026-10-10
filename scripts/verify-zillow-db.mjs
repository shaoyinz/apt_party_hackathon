import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { databaseConfig } from "../server/pgRepository.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = "supabase/002_zillow_sale_cache.sql";
const probeUrl = "https://www.zillow.com/homes/for_sale/party-verify-do-not-use_rb/";

function safe(error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : "database_error";
    return String(code).replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]");
}

const config = databaseConfig();
if (!config.configured) {
    process.stderr.write(`zillow-db: missing_database: ${config.reason}\n`);
    process.exit(1);
}

const { default: pg } = await import("pg");
const pool = new pg.Pool({ ...config.connection, max: 1, connectionTimeoutMillis: 8000 });
const client = await pool.connect();
try {
    const sql = await readFile(path.join(root, migration), "utf8");
    await client.query(sql);
    const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'zillow_%' ORDER BY tablename");
    await client.query("BEGIN");
    await client.query(
        `INSERT INTO public.zillow_sale_snapshots (search_url, status, row_count, truncated, data_origin, provider, http_status, fetched_at, published_at, skipped_without_identity)
         VALUES ($1, 'ok', 1, false, 'verification', 'direct', 200, now(), now(), 0)`,
        [probeUrl],
    );
    await client.query(
        `INSERT INTO public.zillow_sale_rows (search_url, source_identity, pricing, asking_price_usd, price_type, size, address, listing_url, data_origin, fetched_at)
         VALUES ($1, 'zpid:verify', '$1', 1, 'asking_price', '1 sqft', 'verification only', 'https://www.zillow.com/homedetails/verify/1_zpid/', 'verification', now())`,
        [probeUrl],
    );
    const read = await client.query("SELECT asking_price_usd, price_type FROM public.zillow_sale_rows WHERE search_url = $1 AND source_identity = 'zpid:verify'", [probeUrl]);
    if (read.rowCount !== 1 || Number(read.rows[0].asking_price_usd) !== 1 || read.rows[0].price_type !== "asking_price")
        throw new Error("readback_failed");
    await client.query("DELETE FROM public.zillow_sale_rows WHERE search_url = $1", [probeUrl]);
    await client.query("DELETE FROM public.zillow_sale_snapshots WHERE search_url = $1", [probeUrl]);
    const left = await client.query("SELECT 1 FROM public.zillow_sale_rows WHERE source_identity = 'zpid:verify'");
    if (left.rowCount !== 0)
        throw new Error("cleanup_failed");
    await client.query("ROLLBACK");
    process.stdout.write(`${JSON.stringify({
        migration,
        tables: tables.rows.map((row) => row.tablename),
        write: "rolled_back",
        read: "ok",
        probe: "rolled_back",
        wrote_listings: false,
    })}\n`);
}
catch (error) {
    try {
        await client.query("ROLLBACK");
    }
    catch {
        // The connection may already be closed.
    }
    process.stderr.write(`zillow-db: ${safe(error)}\n`);
    process.exitCode = 1;
}
finally {
    client.release();
    await pool.end();
}
