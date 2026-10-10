import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Connect, Plugin } from "vite";
import {
  applyRefresh,
  emptySnapshot,
  publicCatalog,
  redactSecrets,
  type FetchPayload,
  type ImportSnapshot,
} from "../src/importCache";
import { DEFAULT_LIMITS, resolveSources, type ConfiguredSource, type ImportLimits } from "../src/sources";

interface SourceFile {
  groups?: ConfiguredSource[];
  limits?: Partial<ImportLimits>;
}

export function listingsPlugin(root: string): Plugin {
  const cachePath = path.join(root, "data", "import-cache.json");
  let refreshing = false;

  function secretValues(): string[] {
    return [
      process.env.FACEBOOK_C_USER,
      process.env.SECRET_FACEBOOK_C_USER,
      process.env.FACEBOOK_XS,
      process.env.SECRET_FACEBOOK_XS,
    ].filter((value): value is string => Boolean(value));
  }

  function readConfig(): { sources: ConfiguredSource[]; limits: ImportLimits } {
    const raw = JSON.parse(fs.readFileSync(path.join(root, "sources.json"), "utf8")) as SourceFile;
    return {
      sources: resolveSources(raw.groups ?? [], process.env.ROOST_FACEBOOK_GROUPS),
      limits: { ...DEFAULT_LIMITS, ...raw.limits },
    };
  }

  function readSnapshot(): ImportSnapshot {
    if (!fs.existsSync(cachePath)) return emptySnapshot();
    try {
      return JSON.parse(fs.readFileSync(cachePath, "utf8")) as ImportSnapshot;
    } catch {
      return emptySnapshot();
    }
  }

  function writeSnapshot(snapshot: ImportSnapshot) {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(snapshot, null, 2));
  }

  function catalog() {
    const { sources } = readConfig();
    return publicCatalog(readSnapshot(), sources, secretValues().length >= 2);
  }

  function refresh(): Promise<ReturnType<typeof catalog>> {
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
      const child = spawn("python3", [path.join(root, "scripts", "fetch_facebook_groups.py"), requestPath], {
        env: process.env,
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => child.kill("SIGKILL"), 90000);
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("close", () => {
        clearTimeout(timer);
        fs.rmSync(requestPath, { force: true });
        refreshing = false;
        const secrets = secretValues();
        let payload: FetchPayload;
        try {
          payload = JSON.parse(redactSecrets(stdout, secrets)) as FetchPayload;
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
        resolve(publicCatalog(next, sources, secrets.length >= 2));
      });
    });
  }

  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const url = req.url?.split("?")[0];
    if (url !== "/api/listings" && url !== "/api/listings/refresh") return next();
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(JSON.stringify(body));
    };
    if (url === "/api/listings" && req.method === "GET") {
      send(200, catalog());
      return;
    }
    if (url === "/api/listings/refresh" && req.method === "POST") {
      void refresh()
        .then((body) => send(200, body))
        .catch((error: unknown) => {
          send(500, {
            ...catalog(),
            errorCode: "retrieval_failed",
            error: redactSecrets(error instanceof Error ? error.name : "Refresh failed.", secretValues()),
          });
        });
      return;
    }
    send(405, { errorCode: "retrieval_failed", error: "Method not allowed." });
  };

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
