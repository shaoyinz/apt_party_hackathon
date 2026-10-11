import path from "node:path";
import { fileURLToPath } from "node:url";

const base = process.env.ROOST_PUBLIC_URL || "https://roost-production-c7d0.up.railway.app";
const deadline = Date.now() + 8 * 60 * 1000;

export function failureMessage(pathName, status, text) {
  const body = String(text || "").replace(/\s+/g, " ").trim().slice(0, 500);
  return body ? `${pathName} returned ${status}: ${body}` : `${pathName} returned ${status}`;
}

async function check(pathName, expectJson) {
  const response = await fetch(`${base}${pathName}`);
  const text = await response.text();
  if (!response.ok) throw new Error(failureMessage(pathName, response.status, text));
  if (expectJson) {
    const body = JSON.parse(text);
    if (body.ocr !== "available") {
      const reason = body.ocrReason ? `: ${String(body.ocrReason).slice(0, 240)}` : "";
      throw new Error(`OCR is unavailable${reason}`);
    }
    if (process.env.DATABASE_URL && body.database !== "ok") throw new Error("Database health failed");
  }
  return text.slice(0, 80);
}

async function verify() {
  while (true) {
    try {
      await check("/api/health", true);
      await check("/api/listings", true);
      const location = await fetch(`${base}/api/location/suggest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "Mountain View" }),
      });
      if (!location.ok) {
        const text = await location.text();
        throw new Error(failureMessage("/api/location/suggest", location.status, text));
      }
      const page = await check("/", false);
      if (!page.includes("<")) throw new Error("Frontend did not return HTML");
      console.log(`Verified ${base}`);
      process.exit(0);
    } catch (error) {
      if (Date.now() > deadline) {
        console.error(error instanceof Error ? error.message : "Deployment verification failed");
        process.exit(1);
      }
      await new Promise((resolve) => setTimeout(resolve, 15000));
    }
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) verify();
