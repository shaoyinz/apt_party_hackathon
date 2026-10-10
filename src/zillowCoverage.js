export const DEFAULT_ZILLOW_COVERAGE = [
    {
        label: "Brooklyn, NY",
        url: "https://www.zillow.com/homes/for_sale/Brooklyn,-New-York,-NY_rb/",
    },
];

export function parseZillowCoverage(value) {
    const text = String(value || "").trim();
    if (!text)
        return null;
    if (/^https?:\/\//i.test(text) && !/[\n|]/.test(text))
        return [entryFromUrl(text)];
    const entries = [];
    for (const part of text.split(/[\n|]/)) {
        const chunk = part.trim();
        if (!chunk)
            continue;
        const arrow = chunk.split("=>").map((item) => item.trim());
        if (arrow.length === 2 && /^https?:\/\//i.test(arrow[1])) {
            entries.push({ label: arrow[0], url: arrow[1] });
            continue;
        }
        if (/^https?:\/\//i.test(chunk))
            entries.push(entryFromUrl(chunk));
    }
    return entries.length ? entries : null;
}

function entryFromUrl(url) {
    const cleaned = url.trim();
    let label = "Configured Zillow search";
    try {
        const parsed = new URL(cleaned);
        const slug = parsed.pathname.split("/").filter(Boolean).at(-1) || "";
        if (slug) {
            label = decodeURIComponent(slug)
                .replace(/_rb$/i, "")
                .replace(/,-/g, ", ")
                .replace(/[-_]+/g, " ")
                .replace(/\s+/g, " ")
                .trim();
        }
    }
    catch {
        return null;
    }
    return { label, url: cleaned };
}

export function saleStatusCopy(body) {
    if (!body)
        return "Loading the Zillow sale cache. This does not start a scrape.";
    if (body.state === "database_unavailable")
        return "The sale cache database is unavailable. No sample sale listings are shown.";
    if (body.state === "unavailable")
        return `No successful scrape is stored. Latest attempt: ${body.latest_attempt?.outcome || "none"}. This is not an empty market.`;
    if (body.state === "empty")
        return "The last successful scrape found no listings. That is an empty result, not a block.";
    if (body.state === "stale")
        return "Showing the last successful sale cache. It is older than 24 hours. A failed refresh did not replace these rows.";
    if (body.state === "fresh")
        return "Showing cached for-sale listings. Asking prices are not monthly rent.";
    return "The sale cache could not be read. No sample sale listings are shown.";
}
