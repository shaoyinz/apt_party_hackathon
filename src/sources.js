export const DEFAULT_LIMITS = {
  postsPerGroup: 8,
  navigationTimeoutMs: 20000,
  minRefreshIntervalMs: 60000,
};

const GROUP_URL = /facebook\.com\/groups\/([^/?#]+)/i;

export function sourceFromRef(ref, label) {
  const trimmed = ref.trim();
  if (!trimmed) return null;
  const urlMatch = trimmed.match(GROUP_URL);
  if (urlMatch) {
    const id = urlMatch[1];
    return { id, url: trimmed.split("?")[0], label: label?.trim() || id };
  }
  if (/^https?:\/\//i.test(trimmed)) {
    const url = trimmed.split("#")[0];
    try {
      const parsed = new URL(url);
      const id = `${parsed.hostname}${parsed.pathname}${parsed.search}`
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80);
      return { id, url, label: label?.trim() || parsed.hostname };
    } catch {
      return null;
    }
  }
  if (!/^[\w.-]+$/.test(trimmed)) return null;
  return {
    id: trimmed,
    url: `https://www.facebook.com/groups/${trimmed}`,
    label: label?.trim() || trimmed,
  };
}

export function sourcesFromEnv(value) {
  if (value == null || !value.trim()) return null;
  const sources = [];
  for (const part of value.split(",")) {
    const source = sourceFromRef(part);
    if (source && !sources.some((item) => item.id === source.id)) sources.push(source);
  }
  return sources;
}

export function resolveSources(fileSources, envValue) {
  return sourcesFromEnv(envValue) ?? fileSources;
}
