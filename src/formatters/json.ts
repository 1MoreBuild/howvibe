import type { SyncRuntimeMeta, UsageSummary } from '../types.js';

export function formatJSON(summary: UsageSummary, syncMeta?: SyncRuntimeMeta): string {
  if (!syncMeta) {
    return JSON.stringify(summary, null, 2);
  }
  return JSON.stringify(
    {
      ...summary,
      sync_meta: syncMeta,
    },
    null,
    2,
  );
}
