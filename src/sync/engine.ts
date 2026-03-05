import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { HowvibeConfig } from '../config.js';
import { DEFAULT_SYNC_BOOTSTRAP_DAYS } from '../config.js';
import type { UsageProvider } from '../providers/interface.js';
import { aggregateUsage } from '../aggregator.js';
import type { DateRange, UsageSummary } from '../types.js';
import { formatDate } from '../utils/date.js';
import { GistClient, findOrCreateSyncGist } from './gist-client.js';
import {
  buildDateLabelsInRange,
  dayLabelToRange,
  mergeDaySnapshots,
  summarizeFromDaily,
  todayLabel,
} from './merge.js';
import {
  createDaySnapshot,
  daySnapshotFilename,
  parseDaySnapshot,
  parseDaySnapshotFilename,
  sanitizeMachineId,
  type DaySnapshot,
} from './schema.js';
import {
  createEmptySyncState,
  loadSyncState,
  readCachedSnapshot,
  saveSyncState,
  writeCachedSnapshot,
} from './state.js';
import { ensureGhInstalled, getGhToken, loginGhWithGistScope } from './gh.js';
import { SYNC_REMINDER } from './constants.js';

type SyncDependencies = {
  ensureGhInstalled: () => Promise<void>;
  getGhToken: () => Promise<string | null>;
  loginGhWithGistScope: () => Promise<void>;
  createGistClient: (token: string) => GistClient;
  now: () => Date;
};

type EnableSyncOptions = {
  onProgress?: (message: string) => void;
  noInput?: boolean;
};

const HISTORY_REPAIR_BATCH_DAYS = 3;
const FLOAT_EPSILON = 1e-6;

const DEFAULT_DEPS: SyncDependencies = {
  ensureGhInstalled,
  getGhToken,
  loginGhWithGistScope,
  createGistClient: (token: string) => new GistClient(token),
  now: () => new Date(),
};

export type SyncRunResult = {
  summary: UsageSummary;
  daily: Map<string, UsageSummary>;
  warnings: string[];
  reminder?: string;
  syncApplied: boolean;
};

export type EnableSyncResult = {
  config: HowvibeConfig;
  warnings: string[];
  gistId: string;
  machineId: string;
  bootstrapDays: number;
};

function providerNames(providers: UsageProvider[]): string[] {
  return providers.map((provider) => provider.name);
}

function generateMachineIdFromHostname(name: string): string {
  const base = sanitizeMachineId(name) || 'machine';
  return `${base}-${randomUUID().slice(0, 8)}`;
}

async function collectLocalDailySummaries(
  labels: string[],
  providers: UsageProvider[],
  config: HowvibeConfig,
  onProgress?: (current: number, total: number, label: string) => void,
): Promise<Map<string, UsageSummary>> {
  const out = new Map<string, UsageSummary>();
  const total = labels.length;
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i]!;
    const range = dayLabelToRange(label);
    const summary = await aggregateUsage(providers, range, config);
    out.set(label, summary);
    onProgress?.(i + 1, total, label);
  }
  return out;
}

function localResult(
  labels: string[],
  localDaily: Map<string, UsageSummary>,
  providers: UsageProvider[],
  period: { since: string; until: string },
  warnings: string[],
  includeReminder: boolean,
): SyncRunResult {
  const byDay = new Map<string, UsageSummary>();
  for (const label of labels) {
    const summary = localDaily.get(label);
    if (summary) byDay.set(label, summary);
  }
  return {
    daily: byDay,
    summary: summarizeFromDaily(byDay, providerNames(providers), period),
    warnings,
    reminder: includeReminder ? SYNC_REMINDER : undefined,
    syncApplied: false,
  };
}

function upsertSnapshot(snapshots: DaySnapshot[], candidate: DaySnapshot): DaySnapshot[] {
  const kept = snapshots.filter((snapshot) => snapshot.machineId !== candidate.machineId || snapshot.date !== candidate.date);
  kept.push(candidate);
  return kept;
}

function nextRepairLabels(
  now: Date,
  bootstrapDays: number,
  state: ReturnType<typeof createEmptySyncState>,
  chunk = HISTORY_REPAIR_BATCH_DAYS,
): string[] {
  const window = buildBootstrapLabels(bootstrapDays, now);
  const today = todayLabel(now);
  const history = window.filter((label) => label !== today);
  if (history.length === 0 || chunk <= 0) return [];

  let cursor = state.repairCursorDate ? history.indexOf(state.repairCursorDate) : -1;
  if (cursor < 0) cursor = 0;

  const take = Math.min(chunk, history.length);
  const out: string[] = [];
  for (let i = 0; i < take; i++) {
    const idx = (cursor + i) % history.length;
    out.push(history[idx]!);
  }

  state.repairCursorDate = history[(cursor + take) % history.length];
  return out;
}

async function parseSnapshotFromGistFile(
  filename: string,
  file: { content?: string; raw_url?: string; truncated?: boolean },
  state: ReturnType<typeof createEmptySyncState>,
  client: GistClient,
): Promise<DaySnapshot> {
  const version = file.raw_url ?? '';
  if (version && state.remoteFileVersions[filename] === version) {
    const cached = await readCachedSnapshot(filename);
    if (cached) return cached;
  }

  const raw = (!file.truncated && file.content) ? file.content : (file.raw_url ? await client.downloadRawFile(file.raw_url) : null);
  if (!raw) {
    throw new Error(`Missing raw content for ${filename}`);
  }
  const parsed = parseDaySnapshot(JSON.parse(raw));
  await writeCachedSnapshot(filename, parsed);
  if (version) state.remoteFileVersions[filename] = version;
  return parsed;
}

function hasMeaningfulProviderData(snapshot: DaySnapshot): boolean {
  for (const provider of snapshot.providers) {
    if (providerHasMeaningfulData(provider)) return true;
    if ((provider.errors?.length ?? 0) > 0) return true;
  }
  return false;
}

function providerHasMeaningfulData(provider: DaySnapshot['providers'][number]): boolean {
  return provider.models.length > 0 || provider.totalCostUSD > 0;
}

function modelHasMeaningfulData(model: DaySnapshot['providers'][number]['models'][number]): boolean {
  return (
    model.inputTokens > 0 ||
    model.outputTokens > 0 ||
    model.reasoningTokens > 0 ||
    model.cacheCreationTokens > 0 ||
    model.cacheReadTokens > 0 ||
    model.costUSD > 0
  );
}

function compareModelUsage(
  localModel: DaySnapshot['providers'][number]['models'][number],
  remoteModel: DaySnapshot['providers'][number]['models'][number],
): number {
  const deltas = [
    localModel.inputTokens - remoteModel.inputTokens,
    localModel.outputTokens - remoteModel.outputTokens,
    localModel.reasoningTokens - remoteModel.reasoningTokens,
    localModel.cacheCreationTokens - remoteModel.cacheCreationTokens,
    localModel.cacheReadTokens - remoteModel.cacheReadTokens,
  ];
  if (deltas.some((delta) => delta < 0)) return -1;
  if (deltas.some((delta) => delta > 0)) return 1;

  if (localModel.costUSD + FLOAT_EPSILON < remoteModel.costUSD) return -1;
  if (localModel.costUSD > remoteModel.costUSD + FLOAT_EPSILON) return 1;
  return 0;
}

function compareProviderData(
  localProvider: DaySnapshot['providers'][number],
  remoteProvider: DaySnapshot['providers'][number],
): { improved: boolean; regressed: boolean } {
  const localByModel = new Map(localProvider.models.map((model) => [model.model, model]));
  const remoteByModel = new Map(remoteProvider.models.map((model) => [model.model, model]));
  let improved = false;

  for (const remoteModel of remoteProvider.models) {
    const localModel = localByModel.get(remoteModel.model);
    if (!localModel) {
      if (modelHasMeaningfulData(remoteModel)) {
        return { improved: false, regressed: true };
      }
      continue;
    }
    const compared = compareModelUsage(localModel, remoteModel);
    if (compared < 0) {
      return { improved: false, regressed: true };
    }
    if (compared > 0) {
      improved = true;
    }
  }

  for (const localModel of localProvider.models) {
    if (!remoteByModel.has(localModel.model) && modelHasMeaningfulData(localModel)) {
      improved = true;
    }
  }

  const remoteErrors = remoteProvider.errors?.length ?? 0;
  if (remoteErrors > 0 && providerHasMeaningfulData(localProvider)) {
    improved = true;
  }

  return { improved, regressed: false };
}

function isMonotonicHistoricalImprovement(
  localSnapshot: DaySnapshot,
  remoteSnapshot: DaySnapshot,
): boolean {
  if (localSnapshot.digest === remoteSnapshot.digest) return false;

  const localByProvider = new Map(localSnapshot.providers.map((provider) => [provider.provider, provider]));
  const remoteByProvider = new Map(remoteSnapshot.providers.map((provider) => [provider.provider, provider]));
  let improved = false;

  for (const remoteProvider of remoteSnapshot.providers) {
    const localProvider = localByProvider.get(remoteProvider.provider);
    if (!localProvider) {
      if (providerHasMeaningfulData(remoteProvider)) return false;
      continue;
    }
    const compared = compareProviderData(localProvider, remoteProvider);
    if (compared.regressed) return false;
    if (compared.improved) improved = true;
  }

  for (const localProvider of localSnapshot.providers) {
    const remoteProvider = remoteByProvider.get(localProvider.provider);
    if (!remoteProvider && providerHasMeaningfulData(localProvider)) {
      improved = true;
      continue;
    }
    if (remoteProvider && !providerHasMeaningfulData(remoteProvider) && providerHasMeaningfulData(localProvider)) {
      improved = true;
    }
  }

  return improved;
}

function snapshotHasNewProviderData(
  localSnapshot: DaySnapshot,
  remoteSnapshot: DaySnapshot | null,
): boolean {
  for (const localProvider of localSnapshot.providers) {
    if (!providerHasMeaningfulData(localProvider)) continue;
    const remoteProvider = remoteSnapshot?.providers.find((provider) => provider.provider === localProvider.provider);
    if (!remoteProvider || !providerHasMeaningfulData(remoteProvider)) {
      return true;
    }
  }
  return false;
}

function shouldUploadSnapshot(
  localSnapshot: DaySnapshot,
  remoteSnapshot: DaySnapshot | null,
  isToday: boolean,
): boolean {
  if (isToday) {
    if (!remoteSnapshot) return true;
    return remoteSnapshot.digest !== localSnapshot.digest;
  }
  if (!remoteSnapshot) {
    return hasMeaningfulProviderData(localSnapshot);
  }
  return isMonotonicHistoricalImprovement(localSnapshot, remoteSnapshot);
}

async function resolveTokenForEnable(deps: SyncDependencies, options: EnableSyncOptions): Promise<string> {
  let token = await deps.getGhToken();
  if (token) return token;

  if (options.noInput) {
    throw new Error(
      'GitHub auth token is unavailable in non-interactive mode. ' +
      'Run `gh auth login --web --scopes gist` first, then retry.',
    );
  }

  await deps.loginGhWithGistScope();
  token = await deps.getGhToken();
  if (!token) {
    throw new Error('GitHub authentication succeeded but `gh auth token` is still unavailable.');
  }
  return token;
}

function buildBootstrapLabels(days: number, now: Date): string[] {
  const out: string[] = [];
  const count = Math.max(1, days);
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - (count - 1));
  for (let i = 0; i < count; i++) {
    out.push(formatDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

async function patchGistInBatches(
  client: GistClient,
  gistId: string,
  files: Record<string, { content: string }>,
  batchSize = 20,
  onBatch?: (current: number, total: number) => void,
): Promise<Record<string, { content?: string; raw_url?: string }>> {
  const entries = Object.entries(files);
  if (entries.length === 0) return {};

  let latestFiles: Record<string, { content?: string; raw_url?: string }> = {};
  const totalBatches = Math.ceil(entries.length / batchSize);
  for (let i = 0; i < entries.length; i += batchSize) {
    const currentBatch = Math.floor(i / batchSize) + 1;
    onBatch?.(currentBatch, totalBatches);
    const batch = Object.fromEntries(entries.slice(i, i + batchSize));
    const patched = await client.patchGist(gistId, batch);
    latestFiles = patched.files;
  }
  return latestFiles;
}

export function isSyncEnabled(config: HowvibeConfig): boolean {
  return config.sync?.enabled === true && config.sync.provider === 'github_gist' && Boolean(config.sync.gistId);
}

export async function enableSync(
  config: HowvibeConfig,
  providers: UsageProvider[],
  depsOverride: Partial<SyncDependencies> = {},
  options: EnableSyncOptions = {},
): Promise<EnableSyncResult> {
  const deps: SyncDependencies = { ...DEFAULT_DEPS, ...depsOverride };
  const onProgress = options.onProgress ?? (() => {});

  onProgress('Checking GitHub CLI...');
  await deps.ensureGhInstalled();

  onProgress('Authorizing GitHub account...');
  const token = await resolveTokenForEnable(deps, options);
  const client = deps.createGistClient(token);

  onProgress('Locating or creating sync gist...');
  const { gist } = await findOrCreateSyncGist(client);

  const machineId =
    config.sync?.machineId
      ? (sanitizeMachineId(config.sync.machineId) || `machine-${randomUUID().slice(0, 8)}`)
      : generateMachineIdFromHostname(hostname());
  const bootstrapDays = Math.max(1, config.sync?.bootstrapDays ?? DEFAULT_SYNC_BOOTSTRAP_DAYS);
  const now = deps.now();
  onProgress(`Using machine id: ${machineId}`);

  const nextConfig: HowvibeConfig = {
    ...config,
    sync: {
      ...config.sync,
      enabled: true,
      provider: 'github_gist',
      gistId: gist.id,
      machineId,
      bootstrapDays,
    },
  };

  const labels = buildBootstrapLabels(bootstrapDays, now);
  onProgress(`Building local history for ${bootstrapDays} days...`);
  const localDaily = await collectLocalDailySummaries(
    labels,
    providers,
    nextConfig,
    (current, total, label) => {
      if (current === total || current === 1 || current % 10 === 0) {
        onProgress(`Backfill progress ${current}/${total} (${label})`);
      }
    },
  );
  const today = todayLabel(now);
  const state = await loadSyncState();
  const warnings: string[] = [];

  const filesToUpload: Record<string, { content: string }> = {};
  for (const label of labels) {
    const summary = localDaily.get(label);
    if (!summary) continue;

    const snapshot = createDaySnapshot(label, machineId, summary, now);
    const filename = daySnapshotFilename(label, machineId);
    const existsRemote = Boolean(gist.files[filename]);

    // History is frozen by default. Today is always upsert-able.
    if (label !== today && existsRemote) continue;

    filesToUpload[filename] = { content: JSON.stringify(snapshot, null, 2) };
    state.localDigests[filename] = snapshot.digest;
    await writeCachedSnapshot(filename, snapshot);
  }

  if (Object.keys(filesToUpload).length > 0) {
    onProgress(`Uploading ${Object.keys(filesToUpload).length} day snapshots...`);
    try {
      const latestFiles = await patchGistInBatches(client, gist.id, filesToUpload, 20, (current, total) => {
        onProgress(`Upload batch ${current}/${total}`);
      });
      for (const [filename, file] of Object.entries(latestFiles)) {
        if (file.raw_url) {
          state.remoteFileVersions[filename] = file.raw_url;
        }
      }
    } catch (err) {
      warnings.push(`Initial sync backfill failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    onProgress('No backfill upload needed.');
  }

  state.lastSyncedAt = now.toISOString();
  await saveSyncState(state);
  onProgress('Sync enable completed.');

  return {
    config: nextConfig,
    warnings,
    gistId: gist.id,
    machineId,
    bootstrapDays,
  };
}

export function disableSync(config: HowvibeConfig): HowvibeConfig {
  return {
    ...config,
    sync: {
      ...config.sync,
      enabled: false,
      provider: 'github_gist',
    },
  };
}

export async function aggregateWithAutoSync(
  dateRange: DateRange,
  providers: UsageProvider[],
  config: HowvibeConfig,
  depsOverride: Partial<SyncDependencies> = {},
  options: { requireDaily?: boolean } = {},
): Promise<SyncRunResult> {
  const deps: SyncDependencies = { ...DEFAULT_DEPS, ...depsOverride };
  const requireDaily = options.requireDaily ?? false;
  const now = deps.now();
  const queryLabels = buildDateLabelsInRange(dateRange.since, dateRange.until);
  const today = todayLabel(now);
  let labelsForLocal = [...new Set([...queryLabels, today])];
  const period = {
    since: formatDate(dateRange.since),
    until: formatDate(dateRange.until),
  };

  const syncReady = isSyncEnabled(config) && Boolean(config.sync?.gistId) && Boolean(config.sync?.machineId);
  const state = syncReady ? await loadSyncState() : createEmptySyncState();
  const repairLabels = syncReady
    ? nextRepairLabels(now, Math.max(1, config.sync?.bootstrapDays ?? DEFAULT_SYNC_BOOTSTRAP_DAYS), state)
    : [];
  if (repairLabels.length > 0) {
    labelsForLocal = [...new Set([...labelsForLocal, ...repairLabels])];
  }

  if (!syncReady && !requireDaily) {
    const summary = await aggregateUsage(providers, dateRange, config);
    return {
      summary,
      daily: new Map(),
      warnings: [],
      syncApplied: false,
    };
  }

  const localDaily = await collectLocalDailySummaries(labelsForLocal, providers, config);
  if (!syncReady || !config.sync?.gistId || !config.sync.machineId) {
    return localResult(queryLabels, localDaily, providers, period, [], false);
  }

  const warnings: string[] = [];
  try {
    await deps.ensureGhInstalled();
  } catch (err) {
    warnings.push(`Sync skipped: ${err instanceof Error ? err.message : String(err)}`);
    return localResult(queryLabels, localDaily, providers, period, warnings, true);
  }

  const token = await deps.getGhToken();
  if (!token) {
    warnings.push('Sync skipped: `gh auth token` unavailable. Run `howvibe sync enable` again to re-authenticate.');
    return localResult(queryLabels, localDaily, providers, period, warnings, true);
  }

  const client = deps.createGistClient(token);

  let gist: Awaited<ReturnType<GistClient['getGist']>>;
  try {
    gist = await client.getGist(config.sync.gistId);
  } catch (err) {
    warnings.push(`Sync skipped: ${err instanceof Error ? err.message : String(err)}`);
    return localResult(queryLabels, localDaily, providers, period, warnings, true);
  }

  const querySet = new Set(labelsForLocal);
  const remoteByDay = new Map<string, DaySnapshot[]>();
  for (const [filename, file] of Object.entries(gist.files)) {
    const parsedName = parseDaySnapshotFilename(filename);
    if (!parsedName || !querySet.has(parsedName.date)) continue;

    try {
      const parsed = await parseSnapshotFromGistFile(filename, file, state, client);
      const list = remoteByDay.get(parsed.date) ?? [];
      list.push(parsed);
      remoteByDay.set(parsed.date, list);
    } catch (err) {
      warnings.push(`Skipping remote snapshot ${filename}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const existingRemoteByLabel = new Map<string, DaySnapshot | null>();
  for (const label of labelsForLocal) {
    const remoteForMachine =
      (remoteByDay.get(label) ?? []).find((snapshot) => snapshot.machineId === config.sync.machineId) ?? null;
    existingRemoteByLabel.set(label, remoteForMachine);
  }

  let forceFullHistoryBackfill = false;
  for (const label of labelsForLocal) {
    const summary = localDaily.get(label);
    if (!summary) continue;
    const localSnapshot = createDaySnapshot(label, config.sync.machineId, summary, now);
    const remoteSnapshot = existingRemoteByLabel.get(label) ?? null;
    if (snapshotHasNewProviderData(localSnapshot, remoteSnapshot)) {
      forceFullHistoryBackfill = true;
      break;
    }
  }

  let fullHistoryLabels: string[] = [];
  if (forceFullHistoryBackfill) {
    fullHistoryLabels = buildBootstrapLabels(
      Math.max(1, config.sync?.bootstrapDays ?? DEFAULT_SYNC_BOOTSTRAP_DAYS),
      now,
    );
    const missingLabels = fullHistoryLabels.filter((label) => !localDaily.has(label));
    if (missingLabels.length > 0) {
      const missingDaily = await collectLocalDailySummaries(missingLabels, providers, config);
      for (const [label, summary] of missingDaily.entries()) {
        localDaily.set(label, summary);
      }
    }

    // Full-history backfill can introduce labels outside the original query window.
    // Load remote snapshots for this machine before upload gating, so history writes
    // still go through monotonic-regression protection instead of assuming "missing".
    for (const label of fullHistoryLabels) {
      if (existingRemoteByLabel.has(label)) continue;

      const filename = daySnapshotFilename(label, config.sync.machineId);
      const file = gist.files[filename];
      if (!file) {
        existingRemoteByLabel.set(label, null);
        continue;
      }

      try {
        const parsed = await parseSnapshotFromGistFile(filename, file, state, client);
        existingRemoteByLabel.set(label, parsed);
        const snapshots = remoteByDay.get(label) ?? [];
        remoteByDay.set(label, upsertSnapshot(snapshots, parsed));
      } catch (err) {
        warnings.push(`Skipping remote snapshot ${filename}: ${err instanceof Error ? err.message : String(err)}`);
        existingRemoteByLabel.set(label, null);
      }
    }
    labelsForLocal = [...new Set([...labelsForLocal, ...fullHistoryLabels])];
  }

  // In-memory overlay: local always wins for this machine in the current report.
  for (const label of labelsForLocal) {
    const localSummary = localDaily.get(label);
    if (!localSummary) continue;
    const localSnapshot = createDaySnapshot(label, config.sync.machineId, localSummary, now);
    const list = remoteByDay.get(label) ?? [];
    remoteByDay.set(label, upsertSnapshot(list, localSnapshot));
  }

  // Incremental upsert: today plus a small rolling history-repair batch.
  const uploadLabels = [...new Set([today, ...queryLabels, ...repairLabels, ...fullHistoryLabels])];
  const filesToUpload: Record<string, { content: string }> = {};
  const pendingSnapshots = new Map<string, DaySnapshot>();

  for (const label of uploadLabels) {
    const summary = localDaily.get(label);
    if (!summary) continue;
    const snapshot = createDaySnapshot(label, config.sync.machineId, summary, now);
    const remoteSnapshot = existingRemoteByLabel.get(label) ?? null;
    const isToday = label === today;
    if (!shouldUploadSnapshot(snapshot, remoteSnapshot, isToday)) continue;

    const filename = daySnapshotFilename(label, config.sync.machineId);
    filesToUpload[filename] = { content: JSON.stringify(snapshot, null, 2) };
    pendingSnapshots.set(filename, snapshot);
  }

  if (Object.keys(filesToUpload).length > 0) {
    try {
      const patched = await patchGistInBatches(client, config.sync.gistId, filesToUpload);
      for (const [filename, snapshot] of pendingSnapshots.entries()) {
        const latestFile = patched[filename];
        if (latestFile?.raw_url) {
          state.remoteFileVersions[filename] = latestFile.raw_url;
        }
        state.localDigests[filename] = snapshot.digest;
        await writeCachedSnapshot(filename, snapshot);
      }
    } catch (err) {
      warnings.push(`Sync upload skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const daily = new Map<string, UsageSummary>();
  for (const label of queryLabels) {
    const snapshots = remoteByDay.get(label) ?? [];
    daily.set(label, mergeDaySnapshots(snapshots, providerNames(providers), label));
  }

  state.lastSyncedAt = now.toISOString();
  await saveSyncState(state);

  return {
    daily,
    summary: summarizeFromDaily(daily, providerNames(providers), period),
    warnings,
    reminder: SYNC_REMINDER,
    syncApplied: true,
  };
}
