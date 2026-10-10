import { UPLOAD_LIMITS } from "../src/import/limits.js";

const MAGIC = [
    { type: "image/jpeg", test: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
    { type: "image/png", test: (bytes) => bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 },
    { type: "image/gif", test: (bytes) => bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 },
    { type: "image/webp", test: (bytes) => bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 },
];

export function decodeImages(images) {
    if (!Array.isArray(images))
        return { ok: false, message: "Screenshot uploads were not readable." };
    if (images.length > UPLOAD_LIMITS.maxImages) {
        return { ok: false, message: `Upload at most ${UPLOAD_LIMITS.maxImages} screenshots for one listing.` };
    }
    const decoded = [];
    let total = 0;
    for (const image of images) {
        const result = decodeOne(image);
        if (!result.ok)
            return result;
        total += result.image.bytes.length;
        if (total > UPLOAD_LIMITS.maxBytesTotal) {
            return { ok: false, message: "Those screenshots exceed the 24 MB total limit." };
        }
        decoded.push(result.image);
    }
    return { ok: true, images: decoded };
}

function decodeOne(image) {
    if (!image || typeof image.dataBase64 !== "string")
        return { ok: false, message: "A screenshot could not be read. Remove it and try another file." };
    let bytes;
    try {
        bytes = Buffer.from(image.dataBase64, "base64");
    }
    catch {
        return { ok: false, message: "A screenshot could not be read. Remove it and try another file." };
    }
    if (bytes.length === 0)
        return { ok: false, message: "A screenshot was empty. Remove it and choose a readable image." };
    if (bytes.length > UPLOAD_LIMITS.maxBytesEach)
        return { ok: false, message: "A screenshot is over 8 MB. Remove it and choose a smaller image." };
    const detected = MAGIC.find((item) => item.test(bytes));
    if (!detected || !UPLOAD_LIMITS.formats.includes(detected.type)) {
        return { ok: false, message: "Use JPEG, PNG, WEBP, or GIF screenshots. That file is not a supported image." };
    }
    const name = safeName(image.name, detected.type);
    return { ok: true, image: { name, type: detected.type, bytes } };
}

function safeName(name, type) {
    const ext = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" }[type];
    const base = String(name || "screenshot").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^\.+/, "").slice(0, 80) || "screenshot";
    return base.toLowerCase().endsWith(ext) ? base : `${base}${ext}`;
}
