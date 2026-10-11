import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

    it("gives each name a page and lets an invite code share that page", async () => {
        const repository = createMemoryRepository();
        const handler = await testHandler(repository);
        const ada = await session(handler, "/api/session", { name: "Ada" });
        const ben = await session(handler, "/api/session", { name: "Ben" });
        expect(ada.body.userId).not.toBe(ben.body.userId);
        expect(ada.body.inviteCode).not.toBe(ben.body.inviteCode);
        const reused = await call(handler, "POST", "/api/session", ada.cookie, { name: "Someone else" });
        expect(reused.body.userId).toBe(ada.body.userId);
        expect(reused.body.inviteCode).toBe(ada.body.inviteCode);
        const extracted = await call(handler, "POST", "/api/imports/extract", ada.cookie, { url: "https://listing.example/unit" });
        const saved = await call(handler, "POST", "/api/imports/confirm", ada.cookie, {
            draftId: extracted.body.draftId,
            idempotencyKey: "ada-key-1",
            confirmed: true,
            fields: { ...extracted.body.fields, city: "Sunnyvale", title: "Ada listing" },
            sourceUrl: extracted.body.sourceUrl,
        });
        expect(saved.status).toBe(200);
        expect((await call(handler, "GET", "/api/imports/saved", ben.cookie)).body.listings).toEqual([]);
        const wrong = await call(handler, "POST", "/api/session/join", "", {
            name: "Cara",
            inviteCode: "missing",
            groupId: "00000000-0000-4000-8000-000000000099",
        });
        expect(wrong.status).toBe(400);
        expect(wrong.body.error).toMatch(/invite code/i);
        const cara = await call(handler, "POST", "/api/session/join", "", {
            name: "Cara",
            inviteCode: ada.body.inviteCode,
            groupId: "00000000-0000-4000-8000-000000000099",
        });
        expect(cara.status).toBe(200);
        expect(cara.body.userId).not.toBe(ada.body.userId);
        expect(cara.body.inviteCode).toBe(ada.body.inviteCode);
        expect((await call(handler, "GET", "/api/imports/saved", cara.cookie)).body.listings).toHaveLength(1);
        const again = await call(handler, "POST", "/api/session/join", cara.cookie, {
            name: "Cara again",
            inviteCode: ada.body.inviteCode,
        });
        expect(again.body.userId).toBe(cara.body.userId);
        const added = await call(handler, "POST", "/api/imports/extract", cara.cookie, { url: "https://listing.example/unit" });
        const shared = await call(handler, "POST", "/api/imports/confirm", cara.cookie, {
            draftId: added.body.draftId,
            idempotencyKey: "cara-key-1",
            confirmed: true,
            fields: { ...added.body.fields, city: "Sunnyvale", title: "Cara listing" },
            sourceUrl: added.body.sourceUrl,
        });
        expect(shared.status).toBe(200);
        expect(shared.body.listings).toHaveLength(2);
        expect((await call(handler, "GET", "/api/imports/saved", ada.cookie)).body.listings).toHaveLength(2);
        expect((await call(handler, "GET", "/api/session", ada.cookie)).body.inviteCode).toBe(ada.body.inviteCode);
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

describe("strict health", () => {
    const saved = {};

    beforeEach(() => {
        saved.strict = process.env.ROOST_STRICT_HEALTH;
        saved.database = process.env.DATABASE_URL;
        saved.host = process.env.PGHOST;
        delete process.env.DATABASE_URL;
        delete process.env.PGHOST;
        process.env.ROOST_STRICT_HEALTH = "true";
    });

    afterEach(() => {
        restoreEnv("ROOST_STRICT_HEALTH", saved.strict);
        restoreEnv("DATABASE_URL", saved.database);
        restoreEnv("PGHOST", saved.host);
    });

    it("returns 503 with an OCR reason when OCR is unavailable and no database is configured", async () => {
        const handler = createHandler({
            repository: null,
            ocrStatus: async () => ({ available: false, reason: "libGL.so.1: cannot open shared object file" }),
        });
        const health = await call(handler, "GET", "/api/health");
        expect(health.status).toBe(503);
        expect(health.body.ocr).toBe("unavailable");
        expect(health.body.ocrReason).toBe("libGL.so.1: cannot open shared object file");
        expect(health.body.databaseReason).toBe("No database repository is configured.");
    });

    it("returns 200 when OCR is available and no database is configured", async () => {
        const handler = createHandler({
            repository: null,
            ocrStatus: async () => ({ available: true }),
        });
        const health = await call(handler, "GET", "/api/health");
        expect(health.status).toBe(200);
        expect(health.body.ocr).toBe("available");
        expect(health.body.ocrReason).toBeNull();
    });
});

function restoreEnv(name, value) {
    if (value === undefined)
        delete process.env[name];
    else
        process.env[name] = value;
}

async function testHandler(repository, fetchPage, ocrStatus) {
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
        ocrStatus: ocrStatus || (async () => ({ available: false })),
    });
}

async function session(handler, pathname = "/api/session", body) {
    const payload = pathname === "/api/session" ? (body || { name: "Ada" }) : body;
    const response = mockRes();
    await handler(mockReq("POST", pathname, "", payload), response);
    const raw = response.body || "";
    const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
    return { cookie: response.headers["set-cookie"].split(";")[0], body: text ? JSON.parse(text) : {} };
}

async function call(handler, method, pathname, cookie, body) {
    const response = mockRes();
    await handler(mockReq(method, pathname, cookie, body), response);
    const raw = response.body || "";
    const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
    const json = response.headers["content-type"]?.includes("json");
    const nextCookie = response.headers["set-cookie"] ? response.headers["set-cookie"].split(";")[0] : (cookie || "");
    return { status: response.statusCode, body: json && text ? JSON.parse(text) : {}, raw, cookie: nextCookie };
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
