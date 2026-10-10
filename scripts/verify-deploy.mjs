const base = process.env.ROOST_PUBLIC_URL || "https://roost-production-c7d0.up.railway.app";
const deadline = Date.now() + 8 * 60 * 1000;

async function check(path, expectJson) {
  const response = await fetch(`${base}${path}`);
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  if (expectJson) {
    const body = JSON.parse(text);
    if (body.ocr !== "available") throw new Error("OCR is unavailable");
    if (process.env.DATABASE_URL && body.database !== "ok") throw new Error("Database health failed");
  }
  return text.slice(0, 80);
}

while (true) {
  try {
    await check("/api/health", true);
    await check("/api/listings", true);
    const location = await fetch(`${base}/api/location/suggest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "Mountain View" }),
    });
    if (!location.ok) throw new Error(`/api/location/suggest returned ${location.status}`);
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
