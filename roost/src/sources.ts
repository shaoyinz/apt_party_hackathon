export interface ConfiguredSource {
  id: string;
  url: string;
  label: string;
}

export interface ImportLimits {
  postsPerGroup: number;
  navigationTimeoutMs: number;
  minRefreshIntervalMs: number;
}

export const DEFAULT_LIMITS: ImportLimits = {
  postsPerGroup: 8,
  navigationTimeoutMs: 35000,
  minRefreshIntervalMs: 60000,
};

const GROUP_URL = /facebook\.com\/groups\/([^/?#]+)/i;

export function sourceFromRef(ref: string, label?: string): ConfiguredSource | null {
  const trimmed = ref.trim();
  if (!trimmed) return null;
  const urlMatch = trimmed.match(GROUP_URL);
  const id = urlMatch?.[1] ?? (/^[\w.-]+$/.test(trimmed) ? trimmed : "");
  if (!id) return null;
  const url = urlMatch ? trimmed.split("?")[0] : `https://www.facebook.com/groups/${id}`;
  return { id, url, label: label?.trim() || id };
}

export function sourcesFromEnv(value: string | undefined): ConfiguredSource[] | null {
  if (value == null || !value.trim()) return null;
  const sources: ConfiguredSource[] = [];
  for (const part of value.split(",")) {
    const source = sourceFromRef(part);
    if (source && !sources.some((item) => item.id === source.id)) sources.push(source);
  }
  return sources;
}

export function resolveSources(
  fileSources: ConfiguredSource[],
  envValue: string | undefined,
): ConfiguredSource[] {
  return sourcesFromEnv(envValue) ?? fileSources;
}
