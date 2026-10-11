import { amenityOrigins, geocodeQuery, routeOrigins, suggestQuery } from "./handle.mjs";
export function locationPlugin() {
    return {
        name: "roost-location",
        handle,
        configureServer(server) {
            server.middlewares.use(handle);
        },
        configurePreviewServer(server) {
            server.middlewares.use(handle);
        },
    };
}
async function handle(req, res, next) {
    const url = req.url || "";
    if (!url.startsWith("/api/location/"))
        return next();
    if (req.method !== "POST") {
        send(res, 405, { status: "provider_failure", message: "Use POST." });
        return;
    }
    try {
        const body = await readJson(req);
        if (url.startsWith("/api/location/suggest")) {
            send(res, 200, await suggestQuery(body.query));
            return;
        }
        if (url.startsWith("/api/location/geocode")) {
            send(res, 200, await geocodeQuery(body.query, { purpose: body.purpose }));
            return;
        }
        if (url.startsWith("/api/location/routes")) {
            send(res, 200, await routeOrigins(body));
            return;
        }
        if (url.startsWith("/api/location/amenities")) {
            send(res, 200, await amenityOrigins(body.origins ?? []));
            return;
        }
        next();
    }
    catch {
        send(res, 502, { status: "provider_failure", message: "The location service failed. Retry to try again." });
    }
}
function readJson(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
            try {
                const text = Buffer.concat(chunks).toString("utf8");
                resolve(text ? JSON.parse(text) : {});
            }
            catch (error) {
                reject(error);
            }
        });
        req.on("error", reject);
    });
}
function send(res, status, body) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
}
