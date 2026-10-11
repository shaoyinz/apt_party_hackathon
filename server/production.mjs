import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { locationPlugin } from "../scripts/location/plugin.mjs";
import { createDevHandler } from "./attach.js";
import { listingsPlugin } from "./listingsPlugin.js";
import { zillowCachePlugin } from "./zillowCachePlugin.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = process.env.ROOST_DIST_DIR || path.join(root, "dist");
const listings = listingsPlugin(root);
const location = locationPlugin();
const zillow = zillowCachePlugin();
const api = await createDevHandler();

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function connect(middleware, req, res) {
  return new Promise((resolve) => {
    let settled = false;
    middleware(req, res, () => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    });
    res.on("finish", () => {
      if (!settled) {
        settled = true;
        resolve(true);
      }
    });
  });
}

async function serveStatic(req, res) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.end("Method not allowed.");
    return true;
  }
  const requested = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const candidate = path.join(dist, requested);
  if (!candidate.startsWith(dist)) {
    res.statusCode = 400;
    res.end("Bad path.");
    return true;
  }
  let file = candidate;
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = path.join(file, "index.html");
  } catch {
    file = path.extname(requested) ? "" : path.join(dist, "index.html");
  }
  if (!file || !existsSync(file)) {
    res.statusCode = file ? 404 : 404;
    res.end(existsSync(path.join(dist, "index.html")) ? "Not found." : "Production build is missing.");
    return true;
  }
  res.statusCode = 200;
  res.setHeader("content-type", types[path.extname(file)] || "application/octet-stream");
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  createReadStream(file).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = req.url || "/";
  if (url.startsWith("/api/listings") || url.startsWith("/api/demo-listings") || url.startsWith("/api/redfin-")) {
    if (await connect(listings.middleware, req, res)) return;
  }
  if (url.startsWith("/api/location/")) {
    if (await connect(location.handle, req, res)) return;
  }
  if (url.startsWith("/api/zillow-sales")) {
    if (await connect(zillow.middleware, req, res)) return;
  }
  if (url.startsWith("/api/")) {
    const handled = await api(req, res);
    if (handled !== false) return;
  }
  await serveStatic(req, res);
});

const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "0.0.0.0";
server.listen(port, host);
