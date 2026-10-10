import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { roostApiPlugin } from "./server/attach.js";
const cacheRoot = process.env.XDG_CACHE_HOME;
export default defineConfig({
    plugins: [react(), roostApiPlugin()],
    server: {
        host: "127.0.0.1",
        allowedHosts: true,
        hmr: { clientPort: 443 },
    },
    preview: {
        host: "127.0.0.1",
        allowedHosts: true,
    },
    build: {
        outDir: process.env.PARTY_OUTPUT_DIR || "dist",
        emptyOutDir: true,
    },
    test: {
        environment: "node",
        cacheDir: cacheRoot ? path.join(cacheRoot, "vitest") : "node_modules/.vitest",
    },
});
