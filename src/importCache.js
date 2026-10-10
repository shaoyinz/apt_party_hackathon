import { parseGroupPost } from "./parsePost.js";

export function emptySnapshot() {
  return {
    listings: [],
    importedAt: null,
    refreshedAt: null,
    stale: false,
    errorCode: null,
    error: null,
    sources: [],
  };
}

export function listingIdentity(listing) {
  if (listing.sourceGroupId && listing.sourcePostId) return `${listing.sourceGroupId}:${listing.sourcePostId}`;
  return listing.id;
}

export function applyRefresh(previous, payload, now) {
  if (!payload.ok) {
    return {
      ...previous,
      refreshedAt: now,
      stale: previous.importedAt != null,
      errorCode: payload.code ?? "retrieval_failed",
      error: payload.error ?? "Import failed. Previous results were kept.",
      sources: payload.sources.map((source) => ({ ...source, accepted: source.accepted ?? 0 })),
    };
  }

  const parsed = payload.posts.map((post) => ({ post, result: parseGroupPost(post) }));
  const incoming = parsed.flatMap((item) => (item.result.accepted ? [item.result.listing] : []));
  const acceptedBySource = new Map();
  for (const item of parsed) {
    if (!item.result.accepted) continue;
    acceptedBySource.set(item.post.groupId, (acceptedBySource.get(item.post.groupId) ?? 0) + 1);
  }
  const refreshedIds = new Set(payload.sources.filter((source) => source.status === "success" || source.status === "empty").map((source) => source.id));
  const kept = previous.listings.filter((listing) => !listing.sourceGroupId || !refreshedIds.has(listing.sourceGroupId));
  const merged = dedupe([...kept, ...incoming]);
  const sources = payload.sources.map((source) => ({
    id: source.id,
    url: source.url,
    label: source.label,
    status: source.status,
    retrieved: source.retrieved,
    accepted: acceptedBySource.get(source.id) ?? 0,
    message: source.message,
  }));
  return {
    listings: merged,
    importedAt: payload.fetchedAt ?? now,
    refreshedAt: now,
    stale: false,
    errorCode: null,
    error: null,
    sources,
  };
}

export function publicCatalog(snapshot, configured, credentialsConfigured) {
  return {
    credentialsConfigured,
    configuredSources: configured.map((source) => ({ id: source.id, url: source.url, label: source.label })),
    listings: snapshot.listings.map(publicListing),
    importedAt: snapshot.importedAt,
    refreshedAt: snapshot.refreshedAt,
    stale: snapshot.stale,
    errorCode: snapshot.errorCode,
    error: snapshot.error,
    sources: snapshot.sources,
  };
}

function publicListing(listing) {
  const copy = { ...listing };
  for (const key of ["c_user", "xs", "cookie", "cookies", "password"]) {
    if (key in copy) delete copy[key];
  }
  return copy;
}

function dedupe(listings) {
  const byIdentity = new Map();
  for (const listing of listings) byIdentity.set(listingIdentity(listing), listing);
  return [...byIdentity.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function redactSecrets(text, secrets) {
  let out = text;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("[redacted]");
  }
  return out;
}
