import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const applicable = ["supabase/002_zillow_sale_cache.sql"];

if (!process.env.DATABASE_URL && !process.env.PGHOST) {
  console.log("Database is not configured. Skipping migrations. Listing saves and the Zillow sale cache stay unavailable until DATABASE_URL or PGHOST is set.");
  process.exit(0);
}

const { default: pg } = await import("pg");
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || undefined,
  host: process.env.DATABASE_URL ? undefined : process.env.PGHOST,
  port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: true } : undefined,
  connectionTimeoutMillis: 8000,
});

try {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    for (const filename of applicable) {
      const applied = await client.query("SELECT 1 FROM public.schema_migrations WHERE filename = $1", [filename]);
      if (applied.rowCount === 1) continue;
      const sql = await readFile(path.join(root, filename), "utf8");
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO public.schema_migrations (filename) VALUES ($1)", [filename]);
      await client.query("COMMIT");
      console.log(`Applied ${filename}`);
    }
  } finally {
    client.release();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Migration failed");
  process.exit(1);
} finally {
  await pool.end();
}
