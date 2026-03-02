import type { ModelUsageRecord } from '../types.js';

/**
 * Merge multiple usage records by model, summing all token counts and costs.
 */
export function mergeByModel(records: ModelUsageRecord[]): ModelUsageRecord[] {
  const map = new Map<string, ModelUsageRecord>();

  for (const r of records) {
    const existing = map.get(r.model);
    if (existing) {
      existing.inputTokens += r.inputTokens;
      existing.outputTokens += r.outputTokens;
      existing.reasoningTokens += r.reasoningTokens;
      existing.cacheCreationTokens += r.cacheCreationTokens;
      existing.cacheReadTokens += r.cacheReadTokens;
      existing.costUSD += r.costUSD;
    } else {
      map.set(r.model, { ...r });
    }
  }

  return Array.from(map.values());
}

/**
 * Format a number with thousands separators
 */
export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * Format USD cost
 */
export function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}
