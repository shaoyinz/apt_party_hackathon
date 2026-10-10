import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractFacts, extractFromHtml, mergeExtractions } from "../src/import/facts.js";
import { fetchPublicPage, PageFetchError } from "../src/import/fetchPage.js";
import { DestinationError, assertSaveableUrl } from "../src/import/ssrf.js";
import { FETCH_LIMIT_LABEL, UPLOAD_LIMIT_LABEL } from "../src/import/limits.js";
import { decodeImages } from "./images.js";
import { readImageText } from "./ocr.js";

const COOKIE = "roost_session";

export function createHandler(options) {
    const drafts = new Map();
    const sessions = new Map();
    const secret = options.secret || randomBytes(32);
    const dataRoot = options.dataRoot;
    const testResolver = options.testResolver === true;
    return async function handle(req, res) {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        if (!url.pathname.startsWith("/api/") || url.pathname === "/api/listings" || url.pathname === "/api/listings/refresh")
            return false;
        try {
            if (req.method === "GET" && url.pathname === "/api/health") {
                return send(res, 200, await health(options));
            }
            if (req.method === "POST" && url.pathname === "/api/session") {
                const existing = await readSession(req, secret, sessions, options.repository);
                if (existing)
                    return send(res, 200, { ok: true, testResolver });
                return send(res, 200, await openSession(res, options, sessions, secret, testResolver, "Roost test member"));
            }
            if (req.method === "POST" && url.pathname === "/api/session/test-peer") {
                if (!testResolver)
                    return send(res, 404, { error: "Not found." });
                return send(res, 200, await openSession(res, options, sessions, secret, true, "Roost other group"));
            }
            const session = await readSession(req, secret, sessions, options.repository);
            if (!session)
                return send(res, 401, { error: "Sign-in is not available yet. Roost will not trust a group id from the browser." });
            if (req.method === "GET" && url.pathname === "/api/imports/saved") {
                if (!options.repository)
                    return send(res, 503, { error: databaseBlocker() });
                const listings = await options.repository.listGroup(session.groupId);
                return send(res, 200, { listings });
            }
            const imageMatch = url.pathname.match(/^\/api\/imports\/saved\/([^/]+)\/images\/([^/]+)$/);
            if (req.method === "GET" && imageMatch) {
                return sendImage(res, dataRoot, session.groupId, imageMatch[1], imageMatch[2], options.repository);
            }
            if (req.method === "POST" && url.pathname === "/api/imports/extract") {
                const body = await readJson(req);
                return send(res, 200, await extractImport({ body, session, drafts, dataRoot, fetchPage: options.fetchPage }));
            }
            if (req.method === "DELETE" && url.pathname.startsWith("/api/imports/drafts/")) {
                const draftId = url.pathname.split("/").pop();
                const draft = drafts.get(draftId);
                if (draft && draft.groupId === session.groupId) {
                    drafts.delete(draftId);
                    await rm(path.join(dataRoot, "drafts", session.groupId, draftId), { recursive: true, force: true });
                }
                return send(res, 200, { cancelled: true });
            }
            if (req.method === "POST" && url.pathname === "/api/imports/confirm") {
                const body = await readJson(req);
                const result = await confirmImport({ body, session, drafts, dataRoot, repository: options.repository });
                return send(res, result.status, result.payload);
            }
            return send(res, 404, { error: "Not found." });
        }
        catch (error) {
            if (error instanceof HttpError)
                return send(res, error.status, { error: error.message });
            return send(res, 500, { error: "Roost could not finish that import step. Your draft is still on this page." });
        }
    };
}

async function health(options) {
    const ocr = options.ocrStatus ? await options.ocrStatus() : { available: false };
    let database = "unavailable";
    let databaseReason = "No database repository is configured.";
    if (options.repository?.ping) {
        try {
            await options.repository.ping();
            database = "ok";
            databaseReason = null;
        }
        catch {
            database = "unavailable";
            databaseReason = "The database did not accept a connection. Credentials were not included in this response.";
        }
    }
    else if (options.repository) {
        database = "test";
        databaseReason = null;
    }
    return {
        database,
        databaseReason,
        ocr: ocr.available ? "available" : "unavailable",
        testResolver: options.testResolver === true,
        authPolicies: "pending",
        uploadLimits: UPLOAD_LIMIT_LABEL,
        fetchLimits: FETCH_LIMIT_LABEL,
    };
}

async function openSession(res, options, sessions, secret, enabled, label) {
    if (!enabled)
        throw new HttpError(503, "Authentication policies are not deployed, so Roost will not create a group from the browser.");
    const member = options.repository
        ? await options.repository.ensureMember(label)
        : { groupId: randomUUID(), memberId: randomUUID(), name: label };
    sessions.set(`${member.groupId}:${member.memberId}`, member);
    const token = sign({ gid: member.groupId, mid: member.memberId, exp: Date.now() + 12 * 60 * 60 * 1000 }, secret);
    res.setHeader("set-cookie", `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`);
    return { ok: true, testResolver: true };
}

async function extractImport({ body, session, drafts, dataRoot, fetchPage }) {
    const url = typeof body.url === "string" ? body.url.trim() : "";
    const decoded = decodeImages(body.images || []);
    if (!decoded.ok)
        throw new HttpError(400, decoded.message);
    if (!url && decoded.images.length === 0)
        throw new HttpError(400, "Add screenshots or a listing link before extracting.");
    const parts = [];
    const warnings = [];
    let sourceUrl = null;
    let mode = decoded.images.length > 0 && !url ? "upload" : "link";
    if (url) {
        try {
            assertSaveableUrl(url);
            mode = "link";
            try {
                const page = await (fetchPage || fetchPublicPage)(url);
                sourceUrl = page.url;
                parts.push(extractFromHtml(page.body));
            }
            catch (error) {
                const known = error instanceof PageFetchError || error instanceof DestinationError;
                warnings.push(known ? error.message : "Roost could not read that link. Add screenshots or enter the facts yourself. The URL is still in the form.");
                sourceUrl = url;
            }
        }
        catch (error) {
            warnings.push(error instanceof DestinationError ? error.message : "Enter a full http:// or https:// listing URL. The text you entered is still in the form.");
            mode = decoded.images.length > 0 ? "upload" : "link";
        }
    }
    const draftId = randomUUID();
    const stored = [];
    if (decoded.images.length > 0) {
        const dir = path.join(dataRoot, "drafts", session.groupId, draftId);
        await mkdir(dir, { recursive: true });
        for (const [index, image] of decoded.images.entries()) {
            const filename = `${index}-${image.name}`;
            const filePath = path.join(dir, filename);
            await writeFile(filePath, image.bytes);
            stored.push({ filename, type: image.type });
            const ocr = await readImageText(filePath);
            if (!ocr.ok)
                warnings.push(ocr.message);
            else
                parts.push(extractFacts(ocr.text));
        }
    }
    const merged = parts.length ? mergeExtractions(parts) : { fields: emptyClientFields(), conflicts: [], notes: {}, attributes: [], rawText: "" };
    drafts.set(draftId, {
        groupId: session.groupId,
        source: mode,
        sourceUrl,
        files: stored,
        rawText: merged.rawText,
    });
    return {
        ok: warnings.length === 0,
        draftId,
        source: mode,
        sourceUrl,
        fields: merged.fields,
        conflicts: merged.conflicts,
        notes: merged.notes,
        attributes: merged.attributes,
        rawText: merged.rawText,
        warnings,
        fallback: warnings.length ? "screenshot_or_manual" : null,
    };
}

async function confirmImport({ body, session, drafts, dataRoot, repository }) {
    if (body.confirmed !== true)
        return { status: 400, payload: { error: "Confirm the draft before saving. Nothing was stored." } };
    if (!repository)
        return { status: 503, payload: { error: databaseBlocker(), draftPreserved: true } };
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(idempotencyKey))
        return { status: 400, payload: { error: "Save retry could not be matched. Nothing was stored." } };
    const draft = body.draftId ? drafts.get(body.draftId) : null;
    if (draft && draft.groupId !== session.groupId)
        return { status: 404, payload: { error: "That draft is not in this group.", draftPreserved: true } };
    if (repository.findIdempotent) {
        const prior = await repository.findIdempotent(session.groupId, idempotencyKey);
        if (prior) {
            const listings = await repository.listGroup(session.groupId);
            return { status: 200, payload: { ok: true, created: false, id: prior.id, listings } };
        }
    }
    if (body.draftId && !draft)
        return { status: 404, payload: { error: "That draft expired. Your entries are still on this page; extract again before saving.", draftPreserved: true } };
    const record = sanitizeRecord(body.fields || {}, draft, body);
    if (!record.ok)
        return { status: 400, payload: { error: record.message, draftPreserved: true } };
    const listingId = idFromKey(session.groupId, idempotencyKey);
    const imageUrls = [];
    const files = draft?.files || [];
    try {
        if (files.length > 0) {
            const finalDir = path.join(dataRoot, "listings", session.groupId, listingId);
            await mkdir(finalDir, { recursive: true });
            for (const file of files) {
                const from = path.join(dataRoot, "drafts", session.groupId, body.draftId, file.filename);
                const dest = path.join(finalDir, file.filename);
                await writeFile(dest, await readFile(from));
                imageUrls.push(`/api/imports/saved/${listingId}/images/${file.filename}`);
            }
        }
        const saved = await repository.saveImport({
            groupId: session.groupId,
            memberId: session.memberId,
            id: listingId,
            idempotencyKey,
            record: {
                ...record.value,
                imageUrls,
                fieldConfidence: {
                    idempotencyKey,
                    city: record.value.city,
                    neighborhood: record.value.neighborhood,
                    conflicts: body.conflicts || [],
                    origins: body.origins || {},
                },
            },
            attributes: Array.isArray(body.attributes) ? body.attributes.filter((item) => item && typeof item.name === "string" && item.value != null) : [],
        });
        if (draft)
            drafts.delete(body.draftId);
        const listings = await repository.listGroup(session.groupId);
        return { status: 200, payload: { ok: true, created: saved.created, id: saved.id, listings } };
    }
    catch {
        await rm(path.join(dataRoot, "listings", session.groupId, listingId), { recursive: true, force: true });
        return { status: 503, payload: { error: "Save failed before the listing was committed. Nothing was added to search. Correct the draft and retry.", draftPreserved: true } };
    }
}

function sanitizeRecord(fields, draft, body) {
    const source = draft?.source || (body.source === "upload" ? "upload" : "link");
    const sourceUrl = draft?.sourceUrl || (typeof body.sourceUrl === "string" ? body.sourceUrl.trim() : "");
    if (source === "link" && sourceUrl) {
        try {
            assertSaveableUrl(sourceUrl);
        }
        catch (error) {
            return { ok: false, message: error.message };
        }
    }
    if (source === "link" && !sourceUrl)
        return { ok: false, message: "Add a public http or https listing link, or import screenshots instead." };
    if (source === "upload" && !(draft?.files?.length))
        return { ok: false, message: "Screenshot imports need the uploaded images still attached." };
    const priceMonthly = numberOrNull(fields.priceMonthly);
    if (priceMonthly != null && priceMonthly < 0)
        return { ok: false, message: "Monthly rent cannot be negative." };
    const roomType = ["entire", "private_room", "shared"].includes(fields.roomType) ? fields.roomType : null;
    return {
        ok: true,
        value: {
            source,
            sourceUrl: source === "link" ? sourceUrl || null : sourceUrl || null,
            rawText: typeof body.rawText === "string" ? body.rawText.slice(0, 100000) : draft?.rawText || "",
            title: textOrNull(fields.title),
            address: textOrNull(fields.address),
            city: textOrNull(fields.city),
            neighborhood: textOrNull(fields.neighborhood),
            priceMonthly,
            roomType,
            beds: numberOrNull(fields.beds),
            baths: numberOrNull(fields.baths),
            sqft: integerOrNull(fields.sqft),
            availableFrom: dateOrNull(fields.availableFrom),
            leaseMonths: positiveIntOrNull(fields.leaseMonths),
            furnished: boolOrNull(fields.furnished),
            utilitiesIncluded: boolOrNull(fields.utilitiesIncluded),
            pets: textOrNull(fields.pets),
            parking: textOrNull(fields.parking),
        },
    };
}

async function sendImage(res, dataRoot, groupId, listingId, filename, repository) {
    if (!/^[\w.-]+$/.test(filename) || !repository)
        return send(res, 404, { error: "Image not found." });
    const listing = await repository.getForGroup(listingId, groupId);
    if (!listing)
        return send(res, 404, { error: "Image not found." });
    const filePath = path.join(dataRoot, "listings", groupId, listingId, filename);
    try {
        const bytes = await readFile(filePath);
        res.statusCode = 200;
        res.setHeader("content-type", contentType(filename));
        res.setHeader("cache-control", "private, no-store");
        res.end(bytes);
        return true;
    }
    catch {
        return send(res, 404, { error: "Image not found." });
    }
}

function sign(payload, secret) {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const mac = createHmac("sha256", secret).update(body).digest("base64url");
    return `${body}.${mac}`;
}

async function readSession(req, secret, sessions, repository) {
    const header = req.headers.cookie || req.headers.Cookie || "";
    const pair = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
    if (!pair)
        return null;
    const token = pair.slice(COOKIE.length + 1);
    const [body, mac] = token.split(".");
    if (!body || !mac)
        return null;
    const expected = createHmac("sha256", secret).update(body).digest("base64url");
    const left = Buffer.from(mac);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right))
        return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.exp || payload.exp < Date.now())
        return null;
    if (repository?.memberInGroup && !(await repository.memberInGroup(payload.mid, payload.gid)))
        return null;
    sessions.set(`${payload.gid}:${payload.mid}`, payload);
    return { groupId: payload.gid, memberId: payload.mid };
}

function databaseBlocker() {
    return "Database endpoint credentials are not configured, so this listing was not saved. DATABASE_URL and PGHOST are unset. The draft is still on this page.";
}

function emptyClientFields() {
    return {
        title: null, address: null, city: null, neighborhood: null, availableFrom: null,
        priceMonthly: null, priceRaw: null, priceIssue: null, roomType: null, beds: null,
        baths: null, sqft: null, leaseMonths: null, furnished: null, utilitiesIncluded: null,
        pets: null, parking: null,
    };
}

function idFromKey(groupId, key) {
    const hash = createHash("sha256").update(`${groupId}:${key}`).digest();
    hash[6] = (hash[6] & 0x0f) | 0x40;
    hash[8] = (hash[8] & 0x3f) | 0x80;
    const hex = hash.subarray(0, 16).toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function isHttp(value) {
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
    }
    catch {
        return false;
    }
}

function textOrNull(value) {
    const text = typeof value === "string" ? value.trim() : "";
    return text ? text.slice(0, 500) : null;
}

function numberOrNull(value) {
    if (value == null || value === "")
        return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
}

function integerOrNull(value) {
    const number = numberOrNull(value);
    return number == null ? null : Math.round(number);
}

function positiveIntOrNull(value) {
    const number = integerOrNull(value);
    return number != null && number > 0 ? number : null;
}

function boolOrNull(value) {
    if (value === true || value === false)
        return value;
    if (value === "true")
        return true;
    if (value === "false")
        return false;
    return null;
}

function dateOrNull(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        return null;
    return value;
}

function contentType(filename) {
    if (filename.endsWith(".png"))
        return "image/png";
    if (filename.endsWith(".webp"))
        return "image/webp";
    if (filename.endsWith(".gif"))
        return "image/gif";
    return "image/jpeg";
}

async function readJson(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req)
        chunks.push(chunk);
    size = chunks.reduce((total, chunk) => total + chunk.length, 0);
    if (size > 32 * 1024 * 1024)
        throw new HttpError(413, "That upload is over the 32 MB request limit.");
    const text = Buffer.concat(chunks).toString("utf8");
    if (!text)
        return {};
    try {
        return JSON.parse(text);
    }
    catch {
        throw new HttpError(400, "The import request was not valid JSON.");
    }
}

function send(res, status, payload) {
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
    return true;
}

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
