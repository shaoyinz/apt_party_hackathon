import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPgSaleStore, cronExpression, DEFAULT_SEARCH_URL, runRefresh, scheduleIsActive } from "../server/zillowCache.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scraper = path.join(root, "scripts", "zillow_scraper.py");

function bounded(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        return fallback;
    return Math.min(max, Math.max(min, parsed));
}

export function fetchSnapshotWithScraper({ searchUrl, timeout, limit, provider, spawnImpl = spawn }) {
    return new Promise((resolve) => {
        mkdtemp(path.join(os.tmpdir(), "zillow-cache-")).then((dir) => {
            const output = path.join(dir, "out.json");
            const child = spawnImpl("python3", [
                scraper,
                "--url", searchUrl,
                "--timeout", String(timeout),
                "--limit", String(limit),
                "--provider", provider,
                "--output", output,
            ], { env: process.env });
            let stderr = "";
            const timer = setTimeout(() => child.kill("SIGKILL"), (timeout + 5) * 1000);
            child.stderr.on("data", (chunk) => {
                stderr += chunk.toString("utf8");
            });
            child.on("close", (code) => {
                clearTimeout(timer);
                readFile(output, "utf8").then((text) => {
                    rm(dir, { recursive: true, force: true });
                    if (code !== 0)
                        return resolve(failureFromStderr(stderr));
                    const payload = JSON.parse(text);
                    resolve({
                        ok: true,
                        status: payload.status,
                        truncated: payload.truncated === true,
                        listings: payload.listings || [],
                        data_origin: payload.data_origin,
                        fetched_at: payload.fetched_at,
                        http_status: payload.http_status,
                    });
                }).catch(() => {
                    rm(dir, { recursive: true, force: true });
                    resolve(failureFromStderr(stderr));
                });
            });
        }).catch(() => resolve({ ok: false, code: "fetch_error" }));
    });
}

export function failureFromStderr(stderr) {
    const match = String(stderr || "").match(/zillow_scraper: ([a-z_]+):/);
    const http = String(stderr || "").match(/HTTP (\d{3})/);
    return { ok: false, code: match?.[1] || "fetch_error", http_status: http ? Number(http[1]) : null };
}

async function main() {
    const store = await createPgSaleStore();
    const cron = cronExpression();
    if (!store.configured) {
        process.stderr.write(`zillow-refresh: missing_database: ${store.reason} Schedule ${cron} is not installed in this environment.\n`);
        process.exitCode = 1;
        return;
    }
    const urls = (process.env.ZILLOW_SEARCH_URLS || DEFAULT_SEARCH_URL).split(",").map((item) => item.trim()).filter(Boolean);
    const timeout = bounded(process.env.ZILLOW_REFRESH_TIMEOUT, 20, 1, 60);
    const limit = bounded(process.env.ZILLOW_REFRESH_LIMIT, 40, 1, 100);
    const provider = process.env.ZILLOW_REFRESH_PROVIDER === "scrapingdog" ? "scrapingdog" : "direct";
    const deadline = Date.now() + bounded(process.env.ZILLOW_JOB_TIMEOUT_SECONDS, 90, 5, 180) * 1000;
    const results = [];
    for (const searchUrl of urls) {
        if (Date.now() > deadline) {
            results.push({ searchUrl, ok: false, outcome: "timeout", published: false });
            continue;
        }
        results.push({
            searchUrl,
            ...await runRefresh(store, {
                searchUrl,
                provider,
                fetchSnapshot: () => fetchSnapshotWithScraper({ searchUrl, timeout, limit, provider }),
            }),
        });
    }
    process.stdout.write(`${JSON.stringify({
        schedule: cron,
        schedule_active: scheduleIsActive(),
        provider,
        results,
    })}\n`);
    if (results.some((item) => !item.ok))
        process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    await main();
