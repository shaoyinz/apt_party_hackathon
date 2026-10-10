import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { demoCatalog } from "./demoListings.js";
import { applyRefresh, emptySnapshot, publicCatalog, redactSecrets } from "../src/importCache.js";
import { DEFAULT_LIMITS, resolveSources } from "../src/sources.js";

export function listingsPlugin(root) {
  const cachePath = path.join(root, "data", "import-cache.json");
  let refreshing = false;

  function secretValues() {
    return [process.env.FACEBOOK_C_USER, process.env.SECRET_FACEBOOK_C_USER, process.env.FACEBOOK_XS, process.env.SECRET_FACEBOOK_XS].filter(Boolean);
  }

  function readConfig() {
    const raw = JSON.parse(fs.readFileSync(path.join(root, "sources.json"), "utf8"));
    return {
      sources: resolveSources(raw.groups ?? [], process.env.ROOST_LISTING_SOURCES),
      limits: { ...DEFAULT_LIMITS, ...raw.limits },
    };
  }

  function readSnapshot() {
    if (!fs.existsSync(cachePath)) return emptySnapshot();
    try {
      return JSON.parse(fs.readFileSync(cachePath, "utf8"));
    } catch {
      return emptySnapshot();
    }
  }

  function writeSnapshot(snapshot) {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(snapshot, null, 2));
  }

  function catalog() {
    const { sources } = readConfig();
    return publicCatalog(readSnapshot(), sources, true);
  }

  function refresh() {
    if (refreshing) {
      return Promise.resolve({ ...catalog(), errorCode: "retrieval_failed", error: "A refresh is already running." });
    }
    const snapshot = readSnapshot();
    const { sources, limits } = readConfig();
    const last = snapshot.refreshedAt ? Date.parse(snapshot.refreshedAt) : 0;
    if (last && Date.now() - last < limits.minRefreshIntervalMs) {
      return Promise.resolve({
        ...catalog(),
        errorCode: snapshot.errorCode,
        error: "Refresh was skipped because the last attempt is still inside the rate limit. Saved listings were kept.",
      });
    }
    refreshing = true;
    const requestPath = path.join(os.tmpdir(), `roost-import-${process.pid}.json`);
    fs.writeFileSync(requestPath, JSON.stringify({ sources, limits }));
    return new Promise((resolve) => {
      const child = spawn("python3", [path.join(root, "scripts", "fetch_craigslist.py"), requestPath], {
        env: process.env,
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => child.kill("SIGKILL"), 90000);
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });
      child.on("close", () => {
        clearTimeout(timer);
        fs.rmSync(requestPath, { force: true });
        refreshing = false;
        const secrets = secretValues();
        let payload;
        try {
          payload = JSON.parse(redactSecrets(stdout, secrets));
        } catch {
          payload = {
            ok: false,
            code: "retrieval_failed",
            error: redactSecrets(stderr || "Importer returned no JSON.", secrets).slice(0, 400),
            fetchedAt: null,
            sources: [],
            posts: [],
          };
        }
        const next = applyRefresh(readSnapshot(), payload, new Date().toISOString());
        writeSnapshot(next);
        resolve(publicCatalog(next, sources, true));
      });
    });
  }

  function middleware(req, res, next) {
    const url = req.url?.split("?")[0];
    const send = (status, body) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(JSON.stringify(body));
    };
    if (url === "/api/demo-listings" && req.method === "GET") {
      void demoCatalog()
        .then((body) => send(200, body))
        .catch(() => send(200, { status: "fallback", listings: [] }));
      return;
    }
    if (url !== "/api/listings" && url !== "/api/listings/refresh") return next();
    if (url === "/api/listings" && req.method === "GET") {
      send(200, catalog());
      return;
    }
    if (url === "/api/listings/refresh" && req.method === "POST") {
      void refresh()
        .then((body) => send(200, body))
        .catch((error) => {
          send(500, {
            ...catalog(),
            errorCode: "retrieval_failed",
            error: redactSecrets(error instanceof Error ? error.name : "Refresh failed.", secretValues()),
          });
        });
      return;
    }
    send(405, { errorCode: "retrieval_failed", error: "Method not allowed." });
  }

  return {
    name: "roost-listings",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
