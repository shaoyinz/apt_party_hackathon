import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHandler } from "./handler.js";
import { createMemoryRepository } from "./memoryRepository.js";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
let root;

afterEach(async () => {
    if (root)
        await rm(root, { recursive: true, force: true });
});

describe("import handler", () => {
    it("requires confirmation, saves once, and hides the listing from another group", async () => {
        const repository = createMemoryRepository();
        const handler = await testHandler(repository);
        const home = await session(handler);
        const other = await session(handler, "/api/session/test-peer");
        const extracted = await call(handler, "POST", "/api/imports/extract", home.cookie, {
            url: "https://listing.example/unit",
            images: [{ name: "shot.png", type: "image/png", dataBase64: PNG }],
        });
        expect(extracted.status).toBe(200);
        expect(extracted.body.fields.priceMonthly).toBe(2400);
        expect(extracted.body.source).toBe("link");
        const unconfirmed = await call(handler, "POST", "/api/imports/confirm", home.cookie, {
            draftId: extracted.body.draftId,
            idempotencyKey: "retry-key-1",
            confirmed: false,
            fields: extracted.body.fields,
        });
        expect(unconfirmed.status).toBe(400);
        expect(await call(handler, "GET", "/api/imports/saved", home.cookie)).toMatchObject({ body: { listings: [] } });
        const payload = {
            draftId: extracted.body.draftId,
            idempotencyKey: "retry-key-1",
            confirmed: true,
            fields: { ...extracted.body.fields, city: "Sunnyvale", title: "Olive import" },
            attributes: extracted.body.attributes,
            sourceUrl: extracted.body.sourceUrl,
            rawText: extracted.body.rawText,
        };
        const saved = await call(handler, "POST", "/api/imports/confirm", home.cookie, payload);
        const retried = await call(handler, "POST", "/api/imports/confirm", home.cookie, payload);
        expect(saved.body.created).toBe(true);
        expect(retried.body.created).toBe(false);
        expect(retried.body.listings).toHaveLength(1);
        expect(retried.body.listings[0].source).toBe("link");
        expect(retried.body.listings[0].status).toBe("New");
        expect(retried.body.id).toBe(saved.body.id);
        const hidden = await call(handler, "GET", "/api/imports/saved", other.cookie);
        expect(hidden.body.listings).toEqual([]);
        const image = saved.body.listings[0].imageUrls[0];
        const denied = await call(handler, "GET", image, other.cookie);
        expect(denied.status).toBe(404);
        const allowed = await call(handler, "GET", image, home.cookie);
        expect(allowed.status).toBe(200);
    });

    it("keeps an unreadable link for manual entry and does not save a partial listing", async () => {
        const repository = createMemoryRepository();
        repository.saveImport = async () => {
            throw new Error("database down");
        };
        const handler = await testHandler(repository, async () => {
            throw Object.assign(new Error("login"), { code: "blocked", message: "That page looks login-gated." });
        });
        const home = await session(handler);
        const extracted = await call(handler, "POST", "/api/imports/extract", home.cookie, { url: "https://gated.example/listing" });
        expect(extracted.body.ok).toBe(false);
        expect(extracted.body.sourceUrl).toBe("https://gated.example/listing");
        expect(extracted.body.fallback).toBe("screenshot_or_manual");
        const saved = await call(handler, "POST", "/api/imports/confirm", home.cookie, {
            draftId: extracted.body.draftId,
            idempotencyKey: "manual-key-1",
            confirmed: true,
            fields: { title: "Manual", city: "Sunnyvale", priceMonthly: 2000, roomType: "entire" },
            sourceUrl: extracted.body.sourceUrl,
        });
        expect(saved.status).toBe(503);
        expect(saved.body.draftPreserved).toBe(true);
        expect((await call(handler, "GET", "/api/imports/saved", home.cookie)).body.listings).toEqual([]);
    });

    it("rejects an oversized screenshot before creating a listing", async () => {
        const handler = await testHandler(createMemoryRepository());
        const home = await session(handler);
        const huge = Buffer.alloc(8 * 1024 * 1024 + 1, 1).toString("base64");
        const extracted = await call(handler, "POST", "/api/imports/extract", home.cookie, {
            images: [{ name: "big.png", type: "image/png", dataBase64: huge }],
        });
        expect(extracted.status).toBe(400);
        expect(extracted.body.error).toMatch(/8 MB/);
    });
});

async function testHandler(repository, fetchPage) {
    root = await mkdtemp(path.join(tmpdir(), "roost-import-"));
    return createHandler({
        repository,
        testResolver: true,
        dataRoot: root,
        secret: Buffer.from("test-secret"),
        fetchPage: fetchPage || (async () => ({
            url: "https://listing.example/unit",
            status: 200,
            contentType: "text/html",
            body: "<title>Olive import</title><p>18 Olive Ave, Sunnyvale, CA. Entire apartment. $2,400/month. 1 bed. 1 bath. Available March 1, 2026.</p>",
        })),
        ocrStatus: async () => ({ available: false }),
    });
}

async function session(handler, pathname = "/api/session") {
    const response = mockRes();
    await handler(mockReq("POST", pathname), response);
    return { cookie: response.headers["set-cookie"].split(";")[0] };
}

async function call(handler, method, pathname, cookie, body) {
    const response = mockRes();
    await handler(mockReq(method, pathname, cookie, body), response);
    const raw = response.body || "";
    const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
    const json = response.headers["content-type"]?.includes("json");
    return { status: response.statusCode, body: json && text ? JSON.parse(text) : {}, raw };
}

function mockReq(method, pathname, cookie, body) {
    const payload = body ? Buffer.from(JSON.stringify(body)) : Buffer.alloc(0);
    return {
        method,
        url: pathname,
        headers: { cookie: cookie || "" },
        async *[Symbol.asyncIterator]() {
            if (payload.length)
                yield payload;
        },
    };
}

function mockRes() {
    return {
        statusCode: 200,
        headers: {},
        body: "",
        setHeader(key, value) {
            this.headers[key.toLowerCase()] = value;
        },
        end(body) {
            this.body = body || "";
        },
    };
}
