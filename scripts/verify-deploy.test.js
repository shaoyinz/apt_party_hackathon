import { describe, expect, it } from "vitest";
import { assertJsonBody, failureMessage } from "./verify-deploy.mjs";

describe("verify-deploy failure output", () => {
    it("includes the health response body", () => {
        const body = JSON.stringify({ ocr: "unavailable", ocrReason: "libGL.so.1: cannot open shared object file" });
        expect(failureMessage("/api/health", 503, body)).toBe(`/api/health returned 503: ${body}`);
    });

    it("keeps a status-only message when the body is empty", () => {
        expect(failureMessage("/api/health", 503, "  ")).toBe("/api/health returned 503");
    });

    it("requires OCR only on the health payload", () => {
        expect(() => assertJsonBody("/api/listings", { listings: [] })).not.toThrow();
        expect(() => assertJsonBody("/api/health", { ocr: "unavailable" })).toThrow("OCR is unavailable");
    });
});
