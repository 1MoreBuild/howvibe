import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { getHowvibeSyncCacheDir, getHowvibeSyncStatePath } from '../config.js';
import type { DaySnapshot } from './schema.js';
import { parseDaySnapshot } from './schema.js';
import { HOWVIBE_SYNC_SCHEMA_VERSION } from './constants.js';

const SyncStateSchema = z.object({
  schemaVersion: z.literal(HOWVIBE_SYNC_SCHEMA_VERSION),
  syncedDays: z.array(z.string()),
  remoteFileVersions: z.record(z.string(), z.string()),
  localDigests: z.record(z.string(), z.string()),
  repairCursorDate: z.string().optional(),
  lastSyncedAt: z.string().optional(),
});

export type SyncState = z.infer<typeof SyncStateSchema>;

export function createEmptySyncState(): SyncState {
  return {
    schemaVersion: HOWVIBE_SYNC_SCHEMA_VERSION,
    syncedDays: [],
    remoteFileVersions: {},
    localDigests: {},
  };
}

export async function loadSyncState(): Promise<SyncState> {
  const statePath = getHowvibeSyncStatePath();
  try {
    const raw = await readFile(statePath, 'utf-8');
    const parsed = SyncStateSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return createEmptySyncState();
    return parsed.data;
  } catch {
    return createEmptySyncState();
  }
}

export async function saveSyncState(state: SyncState): Promise<void> {
  const statePath = getHowvibeSyncStatePath();
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}

export function markSyncedDays(state: SyncState, date: string, providers: string[]): void {
  const set = new Set(state.syncedDays);
  for (const provider of providers) {
    set.add(`${provider}:${date}`);
  }
  state.syncedDays = [...set].sort();
}

function cachePath(filename: string): string {
  return join(getHowvibeSyncCacheDir(), filename);
}

export async function writeCachedSnapshot(filename: string, snapshot: DaySnapshot): Promise<void> {
  await mkdir(getHowvibeSyncCacheDir(), { recursive: true });
  await writeFile(cachePath(filename), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8');
}

export async function readCachedSnapshot(filename: string): Promise<DaySnapshot | null> {
  const path = cachePath(filename);
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, 'utf-8');
    return parseDaySnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}
