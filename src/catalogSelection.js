const REAL_ORIGINS = new Set(["imported", "user-provided", "redfin"]);

export function isRealListing(listing) {
    return Boolean(listing) && REAL_ORIGINS.has(listing.origin);
}

export function isSampleListing(listing) {
    return Boolean(listing) && !isRealListing(listing);
}

export function labelSample(listing) {
    return {
        ...listing,
        origin: "sample",
        source: listing.source || "Sample fixture",
        sampleData: true,
    };
}

export function describeCatalog(listings) {
    const origins = new Set(listings.filter(isRealListing).map((listing) => listing.origin));
    const parts = [];
    if (origins.has("user-provided"))
        parts.push("your listings");
    if (origins.has("imported"))
        parts.push("imported listings");
    if (origins.has("redfin"))
        parts.push("scraped listings");
    return parts.length ? parts.join(" and ") : "real listings";
}

function dedupe(listings) {
    const byId = new Map();
    for (const listing of listings) {
        if (!byId.has(listing.id))
            byId.set(listing.id, listing);
    }
    return [...byId.values()];
}

export function selectCatalog({
    samples = [],
    imported = [],
    userProvided = [],
    scraped = [],
    sourcesSettled = false,
    sourceError = null,
    realModeReached = false,
} = {}) {
    const real = dedupe([...imported, ...userProvided, ...scraped].filter(isRealListing));
    const labeledSamples = samples.filter(isSampleListing).map(labelSample);
    if (real.length > 0) {
        return {
            mode: "real",
            listings: real,
            sampleData: false,
            label: describeCatalog(real),
            detail: sourceError
                ? `${sourceError} Showing the last saved real listings. Sample fixtures were not added.`
                : `Using ${describeCatalog(real)}. Sample fixtures are excluded.`,
            stale: Boolean(sourceError),
            error: sourceError,
        };
    }
    if (!sourcesSettled) {
        return {
            mode: "loading",
            listings: [],
            sampleData: false,
            label: "Checking listing sources",
            detail: "Checking saved listings and scraped catalogs. Sample fixtures are not shown as the result.",
            stale: false,
            error: null,
        };
    }
    if (realModeReached || sourceError) {
        const error = sourceError || "Real listings could not be loaded.";
        return {
            mode: "unavailable",
            listings: [],
            sampleData: false,
            label: "Real listings unavailable",
            detail: `${error} Sample fixtures were not substituted.`,
            stale: Boolean(sourceError),
            error,
        };
    }
    return {
        mode: "sample",
        listings: labeledSamples,
        sampleData: true,
        label: "Sample data",
        detail: "Sample fixtures for the initial demo. They are not live offers.",
        stale: false,
        error: null,
    };
}
