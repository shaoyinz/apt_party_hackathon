import { lookup as dnsLookup } from "node:dns/promises";
import { FETCH_LIMITS } from "./limits.js";
import { DestinationError, assertPublicUrl } from "./ssrf.js";

export class PageFetchError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "PageFetchError";
        this.code = code;
    }
}

export async function fetchPublicPage(value, options = {}) {
    const limits = { ...FETCH_LIMITS, ...options.limits };
    const lookupFn = options.lookup || dnsLookup;
    const fetchImpl = options.fetchImpl || fetch;
    let current = await resolvePublic(value, lookupFn);
    let redirects = 0;
    while (redirects <= limits.maxRedirects) {
        let response;
        try {
            response = await fetchImpl(current.href, {
                redirect: "manual",
                signal: AbortSignal.timeout(limits.timeoutMs),
                headers: {
                    accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
                    "user-agent": "RoostImport/0.1",
                },
            });
        }
        catch (error) {
            if (error instanceof DestinationError || error instanceof PageFetchError)
                throw error;
            throw new PageFetchError("unreadable", "Roost could not read that page before the time limit. Add screenshots or enter the facts yourself.");
        }
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            redirects += 1;
            const location = response.headers.get("location");
            if (!location || redirects > limits.maxRedirects) {
                throw new PageFetchError("unreadable", "That link redirected too many times. Add screenshots or enter the facts yourself.");
            }
            current = await resolvePublic(new URL(location, current).href, lookupFn);
            continue;
        }
        const body = await readLimited(response, limits.maxBytes);
        const contentType = response.headers.get("content-type") || "";
        if (response.status === 401 || response.status === 403 || response.status === 429) {
            throw new PageFetchError("blocked", "That page refused access. Roost will not try to get around a login or block. Add screenshots or enter the facts yourself.");
        }
        if (response.status < 200 || response.status >= 300) {
            throw new PageFetchError("unreadable", `That page returned status ${response.status}. Add screenshots or enter the facts yourself.`);
        }
        if (!/text\/html|text\/plain|application\/xhtml\+xml|application\/ld\+json/i.test(contentType) && !body.trim().startsWith("<")) {
            throw new PageFetchError("unsupported", "That URL did not return readable listing text. Add screenshots or enter the facts yourself.");
        }
        if (looksGated(body) && !hasListingEvidence(body)) {
            throw new PageFetchError("blocked", "That page looks login-gated or blocked. Roost will not bypass it. Add screenshots or enter the facts yourself.");
        }
        return { url: current.href, status: response.status, contentType, body };
    }
    throw new PageFetchError("unreadable", "That link redirected too many times.");
}

async function resolvePublic(value, lookupFn) {
    let host;
    try {
        host = new URL(value).hostname;
    }
    catch {
        throw new DestinationError("invalid_url", "Enter a full http:// or https:// listing URL.");
    }
    let records = [];
    if (!isIpHost(host)) {
        try {
            records = await lookupFn(host, { all: true, verbatim: true });
        }
        catch {
            throw new PageFetchError("unreadable", "Roost could not resolve that listing host.");
        }
    }
    try {
        return assertPublicUrl(value, records);
    }
    catch (error) {
        if (error instanceof DestinationError)
            throw error;
        throw new PageFetchError("unreadable", "Roost could not check that listing link.");
    }
}

function isIpHost(host) {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

async function readLimited(response, maxBytes) {
    if (!response.body || typeof response.body.getReader !== "function") {
        const text = await response.text();
        if (text.length > maxBytes)
            throw new PageFetchError("unreadable", "That page is larger than the 1.5 MB fetch limit.");
        return text;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let seen = 0;
    while (true) {
        const step = await reader.read();
        if (step.done)
            break;
        seen += step.value.byteLength;
        if (seen > maxBytes) {
            await reader.cancel();
            throw new PageFetchError("unreadable", "That page is larger than the 1.5 MB fetch limit.");
        }
        chunks.push(step.value);
    }
    return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}

function looksGated(body) {
    return /sign in|log in|captcha|access denied|enable javascript|just a moment/i.test(body.slice(0, 4000));
}

function hasListingEvidence(body) {
    return /\$\s?\d{3,5}|bedroom|bath|sq\.?\s*ft|available/i.test(body);
}
