import { mkdtemp, rm } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsageProvider } from '../providers/interface.js';
import type { DateRange, ProviderUsageResult } from '../types.js';
import { formatDate } from '../utils/date.js';
import { aggregateWithAutoSync, enableSync } from './engine.js';
import { createDaySnapshot, createSyncMeta, daySnapshotFilename } from './schema.js';
import { HOWVIBE_SYNC_META_FILE } from './constants.js';
import type { GistClient } from './gist-client.js';
import { createEmptySyncState, saveSyncState } from './state.js';

type FakeFile = {
  filename?: string;
  content?: string;
  raw_url?: string;
};

class FakeGistClient {
  readonly id = 'gist-1';
  files: Record<string, FakeFile>;
  patchCalls: Array<Record<string, { content: string }>> = [];
  private version = 0;
  private listed = false;

  constructor(initial: Record<string, FakeFile> = {}, listed = false) {
    this.files = { ...initial };
    this.listed = listed;
  }

  private setFile(filename: string, content: string): void {
    this.version += 1;
    this.files[filename] = {
      filename,
      content,
      raw_url: `raw://${filename}#${this.version}`,
    };
  }

  private applyPatch(files: Record<string, { content: string } | null>): void {
    for (const [filename, value] of Object.entries(files)) {
      if (value == null) {
        delete this.files[filename];
        continue;
      }
      this.setFile(filename, value.content);
    }
  }

  async listGists() {
    if (!this.listed) return [];
    return [
      {
        id: this.id,
        public: false,
        description: 'howvibe sync store v1',
        files: this.files,
      },
    ];
  }

  async getGist(_id: string) {
    return { id: this.id, files: this.files };
  }

  async createGist(files: Record<string, { content: string }>) {
    this.applyPatch(files);
    this.listed = true;
    return { id: this.id, files: this.files };
  }

  async patchGist(_id: string, files: Record<string, { content: string } | null>) {
    this.patchCalls.push(files as Record<string, { content: string }>);
    this.applyPatch(files);
    return { id: this.id, files: this.files };
  }

  async downloadRawFile(rawUrl: string): Promise<string> {
    const match = rawUrl.match(/^raw:\/\/(.+)#\d+$/);
    if (!match) throw new Error(`Unknown raw URL: ${rawUrl}`);
    const filename = match[1]!;
    const content = this.files[filename]?.content;
    if (!content) throw new Error(`No content for ${filename}`);
    return content;
  }
}

function providerWithDailyInput(provider: ProviderUsageResult['provider'], amountByDate: Record<string, number>): UsageProvider {
  return {
    name: provider,
    async getUsage(dateRange: DateRange) {
      const date = formatDate(dateRange.since);
      const input = amountByDate[date] ?? 0;
      if (input === 0) {
        return {
          provider,
          models: [],
          totalCostUSD: 0,
          dataSource: 'local',
        };
      }
      return {
        provider,
        models: [
          {
            model: `${provider}-model`,
            inputTokens: input,
            outputTokens: 0,
            reasoningTokens: 0,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            costUSD: input / 1000,
          },
        ],
        totalCostUSD: input / 1000,
        dataSource: 'local',
      };
    },
  };
}

describe('sync engine', () => {
  const originalHome = process.env.HOME;
  let tempHome = '';

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'howvibe-sync-test-'));
    process.env.HOME = tempHome;
  });

  afterEach(async () => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await rm(tempHome, { recursive: true, force: true });
  });

  it('enableSync triggers gh login when token is initially missing', async () => {
    const fake = new FakeGistClient();
    const getToken = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('token-123');
    const login = vi.fn<() => Promise<void>>().mockResolvedValue();

    const result = await enableSync(
      { sync: { bootstrapDays: 2 } },
      [providerWithDailyInput('codex', { '2026-03-01': 10, '2026-03-02': 20 })],
      {
        ensureGhInstalled: async () => {},
        getGhToken: getToken,
        loginGhWithGistScope: login,
        createGistClient: () => fake as unknown as GistClient,
        now: () => new Date('2026-03-02T12:00:00.000Z'),
      },
    );

    expect(login).toHaveBeenCalledTimes(1);
    expect(result.config.sync?.enabled).toBe(true);
    expect(result.gistId).toBe('gist-1');
    const hostPrefix = `${hostname().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'machine'}-`;
    expect(result.machineId.startsWith(hostPrefix)).toBe(true);
    expect(Object.keys(fake.files).some((name) => name.includes('2026-03-02'))).toBe(true);
  });

  it('enableSync fails fast in no-input mode when token is missing', async () => {
    const fake = new FakeGistClient();
    const getToken = vi.fn<() => Promise<string | null>>().mockResolvedValue(null);
    const login = vi.fn<() => Promise<void>>().mockResolvedValue();

    await expect(
      enableSync(
        { sync: { bootstrapDays: 2 } },
        [providerWithDailyInput('codex', { '2026-03-01': 10, '2026-03-02': 20 })],
        {
          ensureGhInstalled: async () => {},
          getGhToken: getToken,
          loginGhWithGistScope: login,
          createGistClient: () => fake as unknown as GistClient,
          now: () => new Date('2026-03-02T12:00:00.000Z'),
        },
        { noInput: true },
      ),
    ).rejects.toThrow(/non-interactive mode/i);

    expect(login).not.toHaveBeenCalled();
  });

  it('enableSync keeps historical files frozen and only upserts today', async () => {
    const meta = createSyncMeta(new Date('2026-03-01T00:00:00.000Z'));
    const machineId = 'macbook-1';
    const day = '2026-03-01';
    const existingHistorical = createDaySnapshot(
      day,
      machineId,
      {
        period: { since: day, until: day },
        providers: [],
        totalCostUSD: 0,
      },
      new Date('2026-03-01T09:00:00.000Z'),
    );
    const historicalFile = daySnapshotFilename(day, machineId);
    const fake = new FakeGistClient(
      {
        [HOWVIBE_SYNC_META_FILE]: { content: JSON.stringify(meta) },
        [historicalFile]: { content: JSON.stringify(existingHistorical), raw_url: `raw://${historicalFile}#1` },
      },
      true,
    );

    await enableSync(
      { sync: { bootstrapDays: 3, machineId } },
      [providerWithDailyInput('codex', { '2026-02-28': 1, '2026-03-01': 2, '2026-03-02': 3 })],
      {
        ensureGhInstalled: async () => {},
        getGhToken: async () => 'token',
        loginGhWithGistScope: async () => {},
        createGistClient: () => fake as unknown as GistClient,
        now: () => new Date('2026-03-02T12:00:00.000Z'),
      },
    );

    const touchedHistorical = fake.patchCalls.some((call) => Object.prototype.hasOwnProperty.call(call, historicalFile));
    const todayFile = daySnapshotFilename('2026-03-02', machineId);
    const touchedToday = fake.patchCalls.some((call) => Object.prototype.hasOwnProperty.call(call, todayFile));

    expect(touchedHistorical).toBe(false);
    expect(touchedToday).toBe(true);
  });

  it('aggregateWithAutoSync uploads today when local digest changed', async () => {
    const day = '2026-03-02';
    const machineId = 'macbook-1';
    const oldSummary = {
      period: { since: day, until: day },
      providers: [
        {
          provider: 'codex' as const,
          models: [
            {
              model: 'codex-model',
              inputTokens: 10,
              outputTokens: 0,
              reasoningTokens: 0,
              cacheCreationTokens: 0,
              cacheReadTokens: 0,
              costUSD: 0.01,
            },
          ],
          totalCostUSD: 0.01,
          dataSource: 'local' as const,
        },
      ],
      totalCostUSD: 0.01,
    };
    const oldSnapshot = createDaySnapshot(day, machineId, oldSummary, new Date('2026-03-02T08:00:00.000Z'));
    const dayFile = daySnapshotFilename(day, machineId);
    const fake = new FakeGistClient({
      [dayFile]: { content: JSON.stringify(oldSnapshot), raw_url: `raw://${dayFile}#1` },
    });

    const result = await aggregateWithAutoSync(
      { since: new Date('2026-03-02T00:00:00.000Z'), until: new Date('2026-03-02T23:59:59.999Z') },
      [providerWithDailyInput('codex', { '2026-03-02': 20 })],
      {
        sync: {
          enabled: true,
          provider: 'github_gist',
          gistId: 'gist-1',
          machineId,
          bootstrapDays: 90,
        },
      },
      {
        ensureGhInstalled: async () => {},
        getGhToken: async () => 'token',
        loginGhWithGistScope: async () => {},
        createGistClient: () => fake as unknown as GistClient,
        now: () => new Date('2026-03-02T12:00:00.000Z'),
      },
    );

    expect(fake.patchCalls.length).toBe(1);
    expect(result.syncApplied).toBe(true);
    expect(result.reminder).toBeTruthy();
  });

  it('aggregateWithAutoSync skips upload when today digest is unchanged', async () => {
    const day = '2026-03-02';
    const machineId = 'macbook-1';
    const summary = {
      period: { since: day, until: day },
      providers: [
        {
          provider: 'codex' as const,
          models: [
            {
              model: 'codex-model',
              inputTokens: 20,
              outputTokens: 0,
              reasoningTokens: 0,
              cacheCreationTokens: 0,
              cacheReadTokens: 0,
              costUSD: 0.02,
            },
          ],
          totalCostUSD: 0.02,
          dataSource: 'local' as const,
        },
      ],
      totalCostUSD: 0.02,
    };
    const sameSnapshot = createDaySnapshot(day, machineId, summary, new Date('2026-03-02T08:00:00.000Z'));
    const dayFile = daySnapshotFilename(day, machineId);
    const fake = new FakeGistClient({
      [dayFile]: { content: JSON.stringify(sameSnapshot), raw_url: `raw://${dayFile}#1` },
    });

    await aggregateWithAutoSync(
      { since: new Date('2026-03-02T00:00:00.000Z'), until: new Date('2026-03-02T23:59:59.999Z') },
      [providerWithDailyInput('codex', { '2026-03-02': 20 })],
      {
        sync: {
          enabled: true,
          provider: 'github_gist',
          gistId: 'gist-1',
          machineId,
          bootstrapDays: 90,
        },
      },
      {
        ensureGhInstalled: async () => {},
        getGhToken: async () => 'token',
        loginGhWithGistScope: async () => {},
        createGistClient: () => fake as unknown as GistClient,
        now: () => new Date('2026-03-02T12:00:00.000Z'),
      },
    );

    expect(fake.patchCalls.length).toBe(0);
  });

  it('falls back to local when gh token is unavailable', async () => {
    const result = await aggregateWithAutoSync(
      { since: new Date('2026-03-02T00:00:00.000Z'), until: new Date('2026-03-02T23:59:59.999Z') },
      [providerWithDailyInput('codex', { '2026-03-02': 42 })],
      {
        sync: {
          enabled: true,
          provider: 'github_gist',
          gistId: 'gist-1',
          machineId: 'macbook-1',
          bootstrapDays: 90,
        },
      },
      {
        ensureGhInstalled: async () => {},
        getGhToken: async () => null,
        loginGhWithGistScope: async () => {},
        createGistClient: () => new FakeGistClient() as unknown as GistClient,
        now: () => new Date('2026-03-02T12:00:00.000Z'),
      },
    );

    expect(result.syncApplied).toBe(false);
    expect(result.warnings.some((warning) => warning.includes('gh auth token'))).toBe(true);
    expect(result.summary.providers[0]?.models[0]?.inputTokens).toBe(42);
  });

  it('uses single-pass aggregation when sync is disabled', async () => {
    const getUsage = vi.fn(async () => ({
      provider: 'codex' as const,
      models: [
        {
          model: 'codex-model',
          inputTokens: 9,
          outputTokens: 0,
          reasoningTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          costUSD: 0.009,
        },
      ],
      totalCostUSD: 0.009,
      dataSource: 'local' as const,
    }));

    const provider: UsageProvider = {
      name: 'codex',
      getUsage,
    };

    const result = await aggregateWithAutoSync(
      { since: new Date('2026-03-01T00:00:00.000Z'), until: new Date('2026-03-03T23:59:59.999Z') },
      [provider],
      {},
      {
        now: () => new Date('2026-03-03T12:00:00.000Z'),
      },
    );

    expect(result.syncApplied).toBe(false);
    expect(getUsage).toHaveBeenCalledTimes(1);
  });

  it('re-uploads today when remote snapshot is missing even if local digest cache matches', async () => {
    const day = '2026-03-02';
    const machineId = 'macbook-1';
    const summary = {
      period: { since: day, until: day },
      providers: [
        {
          provider: 'codex' as const,
          models: [
            {
              model: 'codex-model',
              inputTokens: 20,
              outputTokens: 0,
              reasoningTokens: 0,
              cacheCreationTokens: 0,
              cacheReadTokens: 0,
              costUSD: 0.02,
            },
          ],
          totalCostUSD: 0.02,
          dataSource: 'local' as const,
        },
      ],
      totalCostUSD: 0.02,
    };
    const snapshot = createDaySnapshot(day, machineId, summary, new Date('2026-03-02T08:00:00.000Z'));
    const dayFile = daySnapshotFilename(day, machineId);
    const fake = new FakeGistClient();

    const state = createEmptySyncState();
    state.localDigests[dayFile] = snapshot.digest;
    await saveSyncState(state);

    await aggregateWithAutoSync(
      { since: new Date('2026-03-02T00:00:00.000Z'), until: new Date('2026-03-02T23:59:59.999Z') },
      [providerWithDailyInput('codex', { '2026-03-02': 20 })],
      {
        sync: {
          enabled: true,
          provider: 'github_gist',
          gistId: 'gist-1',
          machineId,
          bootstrapDays: 90,
        },
      },
      {
        ensureGhInstalled: async () => {},
        getGhToken: async () => 'token',
        loginGhWithGistScope: async () => {},
        createGistClient: () => fake as unknown as GistClient,
        now: () => new Date('2026-03-02T12:00:00.000Z'),
      },
    );

    expect(fake.patchCalls.length).toBe(1);
  });

  it('auto-repairs historical day when provider data becomes available later', async () => {
    const machineId = 'macbook-1';
    const repairDay = '2026-03-02';
    const today = '2026-03-05';
    const oldSnapshot = createDaySnapshot(
      repairDay,
      machineId,
      {
        period: { since: repairDay, until: repairDay },
        providers: [],
        totalCostUSD: 0,
      },
      new Date('2026-03-02T08:00:00.000Z'),
    );
    const repairFile = daySnapshotFilename(repairDay, machineId);
    const fake = new FakeGistClient({
      [repairFile]: { content: JSON.stringify(oldSnapshot), raw_url: `raw://${repairFile}#1` },
    });

    const state = createEmptySyncState();
    state.repairCursorDate = repairDay;
    await saveSyncState(state);

    await aggregateWithAutoSync(
      { since: new Date(`${today}T00:00:00.000Z`), until: new Date(`${today}T23:59:59.999Z`) },
      [providerWithDailyInput('codex', { [repairDay]: 50, [today]: 5 })],
      {
        sync: {
          enabled: true,
          provider: 'github_gist',
          gistId: 'gist-1',
          machineId,
          bootstrapDays: 5,
        },
      },
      {
        ensureGhInstalled: async () => {},
        getGhToken: async () => 'token',
        loginGhWithGistScope: async () => {},
        createGistClient: () => fake as unknown as GistClient,
        now: () => new Date(`${today}T12:00:00.000Z`),
      },
    );

    const uploadedRepair = fake.patchCalls.some((call) => Object.prototype.hasOwnProperty.call(call, repairFile));
    expect(uploadedRepair).toBe(true);
  });

  it('does not overwrite richer historical snapshot when local data regresses', async () => {
    const machineId = 'macbook-1';
    const historyDay = '2026-03-02';
    const today = '2026-03-05';
    const historyFile = daySnapshotFilename(historyDay, machineId);
    const remoteSnapshot = createDaySnapshot(
      historyDay,
      machineId,
      {
        period: { since: historyDay, until: historyDay },
        providers: [
          {
            provider: 'codex',
            models: [
              {
                model: 'codex-model',
                inputTokens: 50,
                outputTokens: 0,
                reasoningTokens: 0,
                cacheCreationTokens: 0,
                cacheReadTokens: 0,
                costUSD: 0.05,
              },
            ],
            totalCostUSD: 0.05,
            dataSource: 'local',
          },
        ],
        totalCostUSD: 0.05,
      },
      new Date('2026-03-02T08:00:00.000Z'),
    );
    const fake = new FakeGistClient({
      [historyFile]: { content: JSON.stringify(remoteSnapshot), raw_url: `raw://${historyFile}#1` },
    });

    await aggregateWithAutoSync(
      { since: new Date(`${historyDay}T00:00:00.000Z`), until: new Date(`${historyDay}T23:59:59.999Z`) },
      [providerWithDailyInput('codex', { [historyDay]: 20 })],
      {
        sync: {
          enabled: true,
          provider: 'github_gist',
          gistId: 'gist-1',
          machineId,
          bootstrapDays: 90,
        },
      },
      {
        ensureGhInstalled: async () => {},
        getGhToken: async () => 'token',
        loginGhWithGistScope: async () => {},
        createGistClient: () => fake as unknown as GistClient,
        now: () => new Date(`${today}T12:00:00.000Z`),
      },
    );

    const uploadedHistory = fake.patchCalls.some((call) => Object.prototype.hasOwnProperty.call(call, historyFile));
    expect(uploadedHistory).toBe(false);
  });

  it('uploads historical snapshot when local data monotonically improves remote snapshot', async () => {
    const machineId = 'macbook-1';
    const historyDay = '2026-03-02';
    const today = '2026-03-05';
    const historyFile = daySnapshotFilename(historyDay, machineId);
    const remoteSnapshot = createDaySnapshot(
      historyDay,
      machineId,
      {
        period: { since: historyDay, until: historyDay },
        providers: [
          {
            provider: 'codex',
            models: [
              {
                model: 'codex-model',
                inputTokens: 20,
                outputTokens: 0,
                reasoningTokens: 0,
                cacheCreationTokens: 0,
                cacheReadTokens: 0,
                costUSD: 0.02,
              },
            ],
            totalCostUSD: 0.02,
            dataSource: 'local',
          },
        ],
        totalCostUSD: 0.02,
      },
      new Date('2026-03-02T08:00:00.000Z'),
    );
    const fake = new FakeGistClient({
      [historyFile]: { content: JSON.stringify(remoteSnapshot), raw_url: `raw://${historyFile}#1` },
    });

    await aggregateWithAutoSync(
      { since: new Date(`${historyDay}T00:00:00.000Z`), until: new Date(`${historyDay}T23:59:59.999Z`) },
      [providerWithDailyInput('codex', { [historyDay]: 30 })],
      {
        sync: {
          enabled: true,
          provider: 'github_gist',
          gistId: 'gist-1',
          machineId,
          bootstrapDays: 90,
        },
      },
      {
        ensureGhInstalled: async () => {},
        getGhToken: async () => 'token',
        loginGhWithGistScope: async () => {},
        createGistClient: () => fake as unknown as GistClient,
        now: () => new Date(`${today}T12:00:00.000Z`),
      },
    );

    const uploadedHistory = fake.patchCalls.some((call) => Object.prototype.hasOwnProperty.call(call, historyFile));
    expect(uploadedHistory).toBe(true);
  });

  it('triggers full history backfill when provider becomes newly meaningful', async () => {
    const machineId = 'macbook-1';
    const today = '2026-03-05';
    const todayFile = daySnapshotFilename(today, machineId);
    const remoteTodayEmpty = createDaySnapshot(
      today,
      machineId,
      {
        period: { since: today, until: today },
        providers: [],
        totalCostUSD: 0,
      },
      new Date('2026-03-05T08:00:00.000Z'),
    );
    const fake = new FakeGistClient({
      [todayFile]: { content: JSON.stringify(remoteTodayEmpty), raw_url: `raw://${todayFile}#1` },
    });

    await aggregateWithAutoSync(
      { since: new Date(`${today}T00:00:00.000Z`), until: new Date(`${today}T23:59:59.999Z`) },
      [providerWithDailyInput('codex', {
        '2026-03-01': 11,
        '2026-03-02': 12,
        '2026-03-03': 13,
        '2026-03-04': 14,
        '2026-03-05': 15,
      })],
      {
        sync: {
          enabled: true,
          provider: 'github_gist',
          gistId: 'gist-1',
          machineId,
          bootstrapDays: 5,
        },
      },
      {
        ensureGhInstalled: async () => {},
        getGhToken: async () => 'token',
        loginGhWithGistScope: async () => {},
        createGistClient: () => fake as unknown as GistClient,
        now: () => new Date(`${today}T12:00:00.000Z`),
      },
    );

    const dayOutsideDefaultRepair = daySnapshotFilename('2026-03-04', machineId);
    const uploadedDayOutsideDefaultRepair = fake.patchCalls.some((call) =>
      Object.prototype.hasOwnProperty.call(call, dayOutsideDefaultRepair),
    );
    expect(uploadedDayOutsideDefaultRepair).toBe(true);
  });

  it('skips full history backfill when skipHistoryRepair is enabled', async () => {
    const machineId = 'macbook-1';
    const today = '2026-03-05';
    const todayFile = daySnapshotFilename(today, machineId);
    const remoteTodayEmpty = createDaySnapshot(
      today,
      machineId,
      {
        period: { since: today, until: today },
        providers: [],
        totalCostUSD: 0,
      },
      new Date('2026-03-05T08:00:00.000Z'),
    );
    const fake = new FakeGistClient({
      [todayFile]: { content: JSON.stringify(remoteTodayEmpty), raw_url: `raw://${todayFile}#1` },
    });

    await aggregateWithAutoSync(
      { since: new Date(`${today}T00:00:00.000Z`), until: new Date(`${today}T23:59:59.999Z`) },
      [providerWithDailyInput('codex', {
        '2026-03-01': 11,
        '2026-03-02': 12,
        '2026-03-03': 13,
        '2026-03-04': 14,
        '2026-03-05': 15,
      })],
      {
        sync: {
          enabled: true,
          provider: 'github_gist',
          gistId: 'gist-1',
          machineId,
          bootstrapDays: 5,
        },
      },
      {
        ensureGhInstalled: async () => {},
        getGhToken: async () => 'token',
        loginGhWithGistScope: async () => {},
        createGistClient: () => fake as unknown as GistClient,
        now: () => new Date(`${today}T12:00:00.000Z`),
      },
      {
        skipHistoryRepair: true,
      },
    );

    const dayOutsideQuery = daySnapshotFilename('2026-03-03', machineId);
    const uploadedOutsideQuery = fake.patchCalls.some((call) =>
      Object.prototype.hasOwnProperty.call(call, dayOutsideQuery),
    );
    expect(uploadedOutsideQuery).toBe(false);
  });

  it('loads remote history before full backfill uploads to avoid overwriting richer snapshots', async () => {
    const machineId = 'macbook-1';
    const today = '2026-03-05';
    const protectedHistoryDay = '2026-03-02';
    const todayFile = daySnapshotFilename(today, machineId);
    const historyFile = daySnapshotFilename(protectedHistoryDay, machineId);

    const remoteTodayEmpty = createDaySnapshot(
      today,
      machineId,
      {
        period: { since: today, until: today },
        providers: [],
        totalCostUSD: 0,
      },
      new Date('2026-03-05T08:00:00.000Z'),
    );
    const remoteHistoryRicher = createDaySnapshot(
      protectedHistoryDay,
      machineId,
      {
        period: { since: protectedHistoryDay, until: protectedHistoryDay },
        providers: [
          {
            provider: 'codex',
            models: [
              {
                model: 'codex-model',
                inputTokens: 100,
                outputTokens: 0,
                reasoningTokens: 0,
                cacheCreationTokens: 0,
                cacheReadTokens: 0,
                costUSD: 0.1,
              },
            ],
            totalCostUSD: 0.1,
            dataSource: 'local',
          },
        ],
        totalCostUSD: 0.1,
      },
      new Date('2026-03-02T08:00:00.000Z'),
    );
    const fake = new FakeGistClient({
      [todayFile]: { content: JSON.stringify(remoteTodayEmpty), raw_url: `raw://${todayFile}#1` },
      [historyFile]: { content: JSON.stringify(remoteHistoryRicher), raw_url: `raw://${historyFile}#2` },
    });

    await aggregateWithAutoSync(
      { since: new Date(`${today}T00:00:00.000Z`), until: new Date(`${today}T23:59:59.999Z`) },
      [providerWithDailyInput('codex', {
        '2026-03-01': 11,
        '2026-03-02': 20,
        '2026-03-03': 13,
        '2026-03-04': 14,
        '2026-03-05': 15,
      })],
      {
        sync: {
          enabled: true,
          provider: 'github_gist',
          gistId: 'gist-1',
          machineId,
          bootstrapDays: 5,
        },
      },
      {
        ensureGhInstalled: async () => {},
        getGhToken: async () => 'token',
        loginGhWithGistScope: async () => {},
        createGistClient: () => fake as unknown as GistClient,
        now: () => new Date(`${today}T12:00:00.000Z`),
      },
    );

    const overwroteRicherHistory = fake.patchCalls.some((call) => Object.prototype.hasOwnProperty.call(call, historyFile));
    expect(overwroteRicherHistory).toBe(false);
  });
});
