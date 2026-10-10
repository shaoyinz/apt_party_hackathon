import type { Listing } from "./model";
import { parseGroupPost, type RawGroupPost } from "./parsePost";

export type SourceStatus =
  | "success"
  | "empty"
  | "missing_credentials"
  | "login_challenge"
  | "checkpoint"
  | "denied"
  | "retrieval_failed"
  | "skipped";

export interface SourceReport {
  id: string;
  url: string;
  label: string;
  status: SourceStatus;
  retrieved: number;
  accepted: number;
  message: string;
}

export interface ImportSnapshot {
  listings: Listing[];
  importedAt: string | null;
  refreshedAt: string | null;
  stale: boolean;
  errorCode: string | null;
  error: string | null;
  sources: SourceReport[];
}

export interface FetchPayload {
  ok: boolean;
  code: string | null;
  error: string | null;
  fetchedAt: string | null;
  sources: Array<Omit<SourceReport, "accepted"> & { accepted?: number }>;
  posts: RawGroupPost[];
}

export function emptySnapshot(): ImportSnapshot {
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

export function listingIdentity(listing: Listing): string {
  if (listing.sourceGroupId && listing.sourcePostId) return `${listing.sourceGroupId}:${listing.sourcePostId}`;
  return listing.id;
}

export function applyRefresh(previous: ImportSnapshot, payload: FetchPayload, now: string): ImportSnapshot {
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
  const acceptedBySource = new Map<string, number>();
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

export interface PublicCatalog {
  credentialsConfigured: boolean;
  configuredSources: { id: string; url: string; label: string }[];
  listings: Listing[];
  importedAt: string | null;
  refreshedAt: string | null;
  stale: boolean;
  errorCode: string | null;
  error: string | null;
  sources: SourceReport[];
}

export function publicCatalog(
  snapshot: ImportSnapshot,
  configured: { id: string; url: string; label: string }[],
  credentialsConfigured: boolean,
): PublicCatalog {
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

function publicListing(listing: Listing): Listing {
  const copy = { ...listing };
  const secretKeys = ["c_user", "xs", "cookie", "cookies", "password"];
  for (const key of secretKeys) {
    if (key in copy) delete (copy as Record<string, unknown>)[key];
  }
  return copy;
}

function dedupe(listings: Listing[]): Listing[] {
  const byIdentity = new Map<string, Listing>();
  for (const listing of listings) byIdentity.set(listingIdentity(listing), listing);
  return [...byIdentity.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function redactSecrets(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("[redacted]");
  }
  return out;
}
