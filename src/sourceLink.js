export const SAMPLE_SOURCE_URL = "https://sfbay.craigslist.org/search/sby/apa";
export const SAMPLE_WITHOUT_SOURCE_ID = "sunnyvale-unknown-rent";

export function usableSourceUrl(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    let url;
    try {
        url = new URL(trimmed);
    }
    catch {
        return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:")
        return null;
    if (url.username || url.password)
        return null;
    if (isBlockedHost(url.hostname))
        return null;
    return url.href;
}

export function isSharedSampleSearch(value) {
    const usable = usableSourceUrl(value);
    if (!usable)
        return false;
    const url = new URL(usable);
    const sample = new URL(SAMPLE_SOURCE_URL);
    return url.origin === sample.origin && normalizePath(url.pathname) === normalizePath(sample.pathname);
}

export function isIndividualListingUrl(value) {
    const usable = usableSourceUrl(value);
    if (!usable || isSharedSampleSearch(usable))
        return false;
    const url = new URL(usable);
    const path = normalizePath(url.pathname);
    if (!path || path.includes("/search"))
        return false;
    return true;
}

export function sourceAction(listing) {
    const origin = listing?.origin ?? "sample";
    const usable = usableSourceUrl(listing?.sourceUrl);
    if (origin === "sample") {
        if (usable && (isSharedSampleSearch(usable) || isIndividualListingUrl(usable))) {
            return { kind: "sample", href: usable, label: "View sample source" };
        }
        return { kind: "unavailable", href: null, label: "Source unavailable" };
    }
    if (isIndividualListingUrl(usable)) {
        return { kind: "listing", href: usable, label: "View listing" };
    }
    return { kind: "unavailable", href: null, label: "Source unavailable" };
}

export function retainListingSource(listing) {
    const origin = listing?.origin ?? "sample";
    const own = usableSourceUrl(listing?.sourceUrl);
    if (origin !== "sample") {
        return { ...listing, sourceUrl: own };
    }
    if (listing?.id === SAMPLE_WITHOUT_SOURCE_ID && !isIndividualListingUrl(own)) {
        return { ...listing, sourceUrl: null };
    }
    if (own)
        return { ...listing, sourceUrl: own };
    return { ...listing, sourceUrl: SAMPLE_SOURCE_URL };
}

function normalizePath(pathname) {
    return pathname.replace(/\/+$/, "");
}

function isBlockedHost(hostname) {
    const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal"))
        return true;
    if (host === "::" || host === "::1")
        return true;
    const mapped = host.startsWith("::ffff:") ? host.slice(7) : host;
    const parts = mapped.split(".");
    if (parts.length !== 4)
        return false;
    const numbers = parts.map((part) => Number(part));
    if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
        return true;
    const [a, b] = numbers;
    if (a === 0 || a === 10 || a === 127 || a >= 224)
        return true;
    if (a === 169 && b === 254)
        return true;
    if (a === 172 && b >= 16 && b <= 31)
        return true;
    if (a === 192 && b === 168)
        return true;
    if (a === 100 && b >= 64 && b <= 127)
        return true;
    return false;
}
