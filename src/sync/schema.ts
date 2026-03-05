import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ProviderUsageResult, UsageSummary } from '../types.js';
import { ProviderNameSchema } from '../types.js';
import {
  HOWVIBE_SYNC_DAY_FILE_PREFIX,
  HOWVIBE_SYNC_DAY_FILE_SUFFIX,
  HOWVIBE_SYNC_MARKER,
  HOWVIBE_SYNC_META_FILE,
  HOWVIBE_SYNC_SCHEMA_VERSION,
} from './constants.js';

const ModelUsageRecordSchema = z.object({
  model: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  reasoningTokens: z.number(),
  cacheCreationTokens: z.number(),
  cacheReadTokens: z.number(),
  costUSD: z.number(),
});

const ProviderUsageResultSchema = z.object({
  provider: ProviderNameSchema,
  models: z.array(ModelUsageRecordSchema),
  totalCostUSD: z.number(),
  dataSource: z.enum(['local', 'api']),
  errors: z.array(z.string()).optional(),
});

const SyncMetaSchema = z.object({
  schemaVersion: z.literal(HOWVIBE_SYNC_SCHEMA_VERSION),
  marker: z.literal(HOWVIBE_SYNC_MARKER),
  createdAt: z.string(),
  storeId: z.string(),
});

const DaySnapshotSchema = z.object({
  schemaVersion: z.literal(HOWVIBE_SYNC_SCHEMA_VERSION),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  machineId: z.string().min(1),
  machineName: z.string().min(1).optional(),
  generatedAt: z.string(),
  providers: z.array(ProviderUsageResultSchema),
  totalCostUSD: z.number(),
  digest: z.string().min(1),
});

export type SyncMeta = z.infer<typeof SyncMetaSchema>;
export type DaySnapshot = z.infer<typeof DaySnapshotSchema>;

export function createSyncMeta(now = new Date()): SyncMeta {
  return {
    schemaVersion: HOWVIBE_SYNC_SCHEMA_VERSION,
    marker: HOWVIBE_SYNC_MARKER,
    createdAt: now.toISOString(),
    storeId: randomUUID(),
  };
}

export function parseSyncMeta(raw: unknown): SyncMeta {
  const parsed = SyncMetaSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid sync meta: ${parsed.error.issues[0]?.message ?? 'unknown format'}`);
  }
  return parsed.data;
}

function stableProviders(providers: ProviderUsageResult[]): ProviderUsageResult[] {
  return providers
    .map((provider) => ({
      ...provider,
      models: [...provider.models].sort((a, b) => a.model.localeCompare(b.model)),
      errors: provider.errors ? [...provider.errors].sort() : undefined,
    }))
    .sort((a, b) => a.provider.localeCompare(b.provider));
}

function computeDayDigest(input: Omit<DaySnapshot, 'digest' | 'generatedAt'>): string {
  const canonical = {
    ...input,
    providers: stableProviders(input.providers),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function createDaySnapshot(
  date: string,
  machineId: string,
  summary: UsageSummary,
  generatedAt = new Date(),
  machineName?: string,
): DaySnapshot {
  const payload: Omit<DaySnapshot, 'digest'> = {
    schemaVersion: HOWVIBE_SYNC_SCHEMA_VERSION,
    date,
    machineId,
    machineName,
    generatedAt: generatedAt.toISOString(),
    providers: summary.providers,
    totalCostUSD: summary.totalCostUSD,
  };
  return {
    ...payload,
    digest: computeDayDigest({
      schemaVersion: payload.schemaVersion,
      date: payload.date,
      machineId: payload.machineId,
      machineName: payload.machineName,
      providers: payload.providers,
      totalCostUSD: payload.totalCostUSD,
    }),
  };
}

export function parseDaySnapshot(raw: unknown): DaySnapshot {
  const parsed = DaySnapshotSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid day snapshot: ${parsed.error.issues[0]?.message ?? 'unknown format'}`);
  }
  const data = parsed.data;
  const expected = computeDayDigest({
    schemaVersion: data.schemaVersion,
    date: data.date,
    machineId: data.machineId,
    machineName: data.machineName,
    providers: data.providers,
    totalCostUSD: data.totalCostUSD,
  });
  if (expected !== data.digest) {
    throw new Error(`Invalid day snapshot: digest mismatch for ${daySnapshotFilename(data.date, data.machineId)}`);
  }
  return data;
}

export function parseSyncMetaFileName(filename: string): boolean {
  return filename === HOWVIBE_SYNC_META_FILE;
}

export function daySnapshotFilename(date: string, machineId: string): string {
  return `${HOWVIBE_SYNC_DAY_FILE_PREFIX}${date}.${machineId}${HOWVIBE_SYNC_DAY_FILE_SUFFIX}`;
}

export function parseDaySnapshotFilename(filename: string): { date: string; machineId: string } | null {
  if (!filename.startsWith(HOWVIBE_SYNC_DAY_FILE_PREFIX) || !filename.endsWith(HOWVIBE_SYNC_DAY_FILE_SUFFIX)) {
    return null;
  }
  const mid = filename.slice(
    HOWVIBE_SYNC_DAY_FILE_PREFIX.length,
    filename.length - HOWVIBE_SYNC_DAY_FILE_SUFFIX.length,
  );
  const firstDot = mid.indexOf('.');
  if (firstDot <= 0) return null;
  const date = mid.slice(0, firstDot);
  const machineId = mid.slice(firstDot + 1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !machineId) return null;
  return { date, machineId };
}

export function sanitizeMachineId(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}
