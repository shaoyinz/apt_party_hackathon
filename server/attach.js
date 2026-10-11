import path from "node:path";
import { fileURLToPath } from "node:url";
import { geocodeListing } from "../scripts/location/handle.mjs";
import { createHandler } from "./handler.js";
import { ocrStatus } from "./ocr.js";
import { createPgRepository, databaseConfig } from "./pgRepository.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function createDevHandler() {
    const config = databaseConfig();
    let repository = null;
    if (config.configured) {
        const created = await createPgRepository();
        repository = created.configured === false ? null : created;
    }
    return createHandler({
        repository,
        testResolver: process.env.ENABLE_TEST_RESOLVER === "true",
        dataRoot: process.env.ROOST_DATA_DIR || path.join(root, "data"),
        ocrStatus,
        geocodeListing,
    });
}

export function roostApiPlugin() {
    let handler;
    return {
        name: "roost-api",
        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                if (!req.url?.startsWith("/api/"))
                    return next();
                try {
                    handler = handler || (await createDevHandler());
                    const handled = await handler(req, res);
                    if (handled === false)
                        return next();
                }
                catch {
                    if (!res.headersSent) {
                        res.statusCode = 500;
                        res.end(JSON.stringify({ error: "Import service failed." }));
                    }
                }
            });
        },
    };
}
