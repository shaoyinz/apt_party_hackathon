import { describe, expect, it } from "vitest";
import { fetchPublicPage } from "./fetchPage.js";
import { DestinationError, isPrivateAddress } from "./ssrf.js";

describe("public link fetch limits", () => {
    it("rejects non-web schemes and private addresses", async () => {
        expect(isPrivateAddress("127.0.0.1")).toBe(true);
        expect(isPrivateAddress("10.1.2.3")).toBe(true);
        expect(isPrivateAddress("169.254.169.254")).toBe(true);
        expect(isPrivateAddress("8.8.8.8")).toBe(false);
        await expect(fetchPublicPage("file:///etc/passwd", { lookup: async () => [] })).rejects.toBeInstanceOf(DestinationError);
        await expect(fetchPublicPage("http://127.0.0.1/listing", { lookup: async () => [] })).rejects.toBeInstanceOf(DestinationError);
    });

    it("rejects a redirect to a private address and stops after the redirect limit", async () => {
        const lookup = async (host) => [{ address: host === "evil.test" ? "127.0.0.1" : "8.8.8.8", family: 4 }];
        const fetchImpl = async () => ({
            status: 302,
            headers: new Headers({ location: "http://evil.test/secret" }),
            body: null,
            text: async () => "",
        });
        await expect(fetchPublicPage("https://listing.example/start", { lookup, fetchImpl })).rejects.toMatchObject({ code: "private_destination" });
    });

    it("reads a bounded public page", async () => {
        const lookup = async () => [{ address: "8.8.8.8", family: 4 }];
        const fetchImpl = async () => new Response("<title>Public listing</title><p>$2,200/month 1 bed</p>", {
            status: 200,
            headers: { "content-type": "text/html" },
        });
        const page = await fetchPublicPage("https://listing.example/unit", { lookup, fetchImpl });
        expect(page.body).toMatch(/\$2,200\/month/);
        expect(page.url).toBe("https://listing.example/unit");
    });
});
