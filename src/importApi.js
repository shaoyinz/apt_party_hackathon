async function request(path, options) {
    const response = await fetch(path, { credentials: "same-origin", ...options });
    const isJson = (response.headers.get("content-type") || "").includes("json");
    const body = isJson ? await response.json() : null;
    if (!response.ok)
        throw new Error(body?.error || "Roost could not reach the import service.");
    return body;
}

export function loadHealth() {
    return request("/api/health");
}

export function openImportSession() {
    return request("/api/session", { method: "POST" });
}

export function loadImports() {
    return request("/api/listings");
}

export function extractImport(payload) {
    return request("/api/imports/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
    });
}

export function confirmImport(payload) {
    return request("/api/imports/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
    });
}

export function cancelImport(draftId) {
    if (!draftId)
        return Promise.resolve();
    return request(`/api/imports/drafts/${draftId}`, { method: "DELETE" });
}
