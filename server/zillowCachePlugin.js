import { databaseConfig } from "./pgRepository.js";
import { createPgSaleStore, DEFAULT_SEARCH_URL, readSaleCache } from "./zillowCache.js";

function send(res, status, body) {
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify(body));
}

function blocked(reason) {
    return {
        source: "zillow",
        listing_kind: "for_sale",
        price_meaning: "for_sale_asking_price",
        monthly_rent: null,
        served_from: "cache",
        live: false,
        state: "database_unavailable",
        stale: false,
        last_success_at: null,
        latest_attempt: null,
        count: 0,
        truncated: false,
        listings: [],
        error: reason,
    };
}

export function createZillowReadMiddleware(getStore) {
    return async function zillowRead(req, res, next) {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        if (url.pathname !== "/api/zillow-sales")
            return next();
        if (req.method !== "GET") {
            send(res, 405, { error: "Method not allowed." });
            return;
        }
        const searchUrl = url.searchParams.get("url") || DEFAULT_SEARCH_URL;
        let parsed;
        try {
            parsed = new URL(searchUrl);
        }
        catch {
            send(res, 400, { error: "Only zillow.com search URLs can be read from the cache." });
            return;
        }
        if (!["https:", "http:"].includes(parsed.protocol) || !["zillow.com", "www.zillow.com"].includes(parsed.hostname)) {
            send(res, 400, { error: "Only zillow.com search URLs can be read from the cache." });
            return;
        }
        try {
            const store = await getStore();
            if (!store?.configured)
                return send(res, 503, blocked(store?.reason || "DATABASE_URL and PGHOST are unset."));
            send(res, 200, await readSaleCache(store, searchUrl, new Date()));
        }
        catch {
            send(res, 503, blocked("The sale cache could not be read. Credentials were not included."));
        }
    };
}

export function zillowCachePlugin() {
    let storePromise;
    const middleware = createZillowReadMiddleware(() => {
        const config = databaseConfig();
        if (!config.configured)
            return { configured: false, reason: config.reason };
        storePromise = storePromise || createPgSaleStore();
        return storePromise;
    });
    return {
        name: "zillow-sale-cache",
        middleware,
        configureServer(server) {
            server.middlewares.use(middleware);
        },
        configurePreviewServer(server) {
            server.middlewares.use(middleware);
        },
    };
}
