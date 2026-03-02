import type { UsageSummary } from '../types.js';

export function formatJSON(summary: UsageSummary): string {
  return JSON.stringify(summary, null, 2);
}
