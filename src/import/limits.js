export const UPLOAD_LIMITS = {
    formats: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    extensions: [".jpg", ".jpeg", ".png", ".webp", ".gif"],
    maxImages: 8,
    maxBytesEach: 8 * 1024 * 1024,
    maxBytesTotal: 24 * 1024 * 1024,
};

export const FETCH_LIMITS = {
    timeoutMs: 8000,
    maxBytes: 1_500_000,
    maxRedirects: 3,
};

export const FETCH_LIMIT_LABEL = "8s timeout, 1.5 MB response, 3 redirects, public HTTP(S) only";

export const UPLOAD_LIMIT_LABEL = "JPEG, PNG, WEBP, or GIF. Up to 8 images, 8 MB each, 24 MB total. One listing per import.";
