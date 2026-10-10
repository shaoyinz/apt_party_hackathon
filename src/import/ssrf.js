import { isIP } from "node:net";

const BLOCKED_HOSTS = new Set([
    "localhost",
    "localhost.localdomain",
    "metadata.google.internal",
    "metadata.internal",
]);

export class DestinationError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "DestinationError";
        this.code = code;
    }
}

export function isPrivateAddress(address) {
    const ip = address.replace(/^\[|\]$/g, "").toLowerCase();
    if (ip.startsWith("::ffff:"))
        return isPrivateAddress(ip.slice(7));
    if (ip.includes(":") ) {
        if (ip === "::" || ip === "::1")
            return true;
        if (ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd"))
            return true;
        return false;
    }
    const parts = ip.split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
        return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127)
        return true;
    if (a === 169 && b === 254)
        return true;
    if (a === 172 && b >= 16 && b <= 31)
        return true;
    if (a === 192 && b === 168)
        return true;
    if (a === 100 && b >= 64 && b <= 127)
        return true;
    if (a >= 224)
        return true;
    return false;
}

export function assertPublicUrl(value, records = []) {
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new DestinationError("invalid_url", "Enter a full http:// or https:// listing URL.");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new DestinationError("invalid_url", "Only public http and https listing links are accepted.");
    }
    if (url.username || url.password) {
        throw new DestinationError("invalid_url", "Listing links cannot include a username or password.");
    }
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (!host || BLOCKED_HOSTS.has(host) || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) {
        throw new DestinationError("private_destination", "That link points at a local or private destination, so Roost will not fetch it.");
    }
    if (isIP(host) && isPrivateAddress(host)) {
        throw new DestinationError("private_destination", "That link points at a local or private address, so Roost will not fetch it.");
    }
    if (!isIP(host) && records.length > 0 && records.some((record) => isPrivateAddress(record.address))) {
        throw new DestinationError("private_destination", "That link resolves to a local or private address, so Roost will not fetch it.");
    }
    return url;
}

export function assertSaveableUrl(value) {
    const url = assertPublicUrl(value, []);
    if (!isIP(url.hostname) && url.hostname === "") {
        throw new DestinationError("invalid_url", "Enter a full http:// or https:// listing URL.");
    }
    return url;
}
