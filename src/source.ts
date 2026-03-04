export const USAGE_SOURCES = ['auto', 'web', 'cli', 'oauth'] as const;

export type UsageSource = (typeof USAGE_SOURCES)[number];

export function parseUsageSource(value: string): UsageSource {
  const normalized = value.trim().toLowerCase();
  if (USAGE_SOURCES.includes(normalized as UsageSource)) {
    return normalized as UsageSource;
  }
  throw new Error(`Unknown source: ${value}. Available: ${USAGE_SOURCES.join(', ')}`);
}

export function resolveUsageSource(value?: string): UsageSource {
  if (!value) return 'auto';
  return parseUsageSource(value);
}
