import type { ProviderUsageResult, UsageSummary } from '../types.js';
import type { DaySnapshot } from './schema.js';
import { mergeByModel } from '../utils/tokens.js';
import { formatDate, parseDate } from '../utils/date.js';

export function todayLabel(now = new Date()): string {
  return formatDate(now);
}

export function buildDateLabelsInRange(since: Date, until: Date): string[] {
  const out: string[] = [];
  const cursor = new Date(since.getFullYear(), since.getMonth(), since.getDate(), 0, 0, 0, 0);
  const limit = new Date(until.getFullYear(), until.getMonth(), until.getDate(), 23, 59, 59, 999);
  while (cursor <= limit) {
    out.push(formatDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export function dayLabelToRange(day: string): { since: Date; until: Date } {
  const base = parseDate(day);
  const since = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
  const until = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 59, 999);
  return { since, until };
}

function providerOrder(providerNames: string[]): ProviderUsageResult['provider'][] {
  const known: ProviderUsageResult['provider'][] = ['claude-code', 'codex', 'cursor', 'openrouter'];
  const set = new Set(providerNames);
  return known.filter((name) => set.has(name));
}

export function mergeDaySnapshots(
  snapshots: DaySnapshot[],
  providerNames: string[],
  date: string,
): UsageSummary {
  const dedup = new Map<string, DaySnapshot>();
  for (const snapshot of snapshots) {
    const key = `${snapshot.date}:${snapshot.machineId}`;
    const existing = dedup.get(key);
    if (!existing || existing.generatedAt < snapshot.generatedAt) {
      dedup.set(key, snapshot);
    }
  }

  const byProvider = new Map<ProviderUsageResult['provider'], { records: ProviderUsageResult['models']; errors: string[] }>();
  for (const provider of providerOrder(providerNames)) {
    byProvider.set(provider, { records: [], errors: [] });
  }

  for (const snapshot of dedup.values()) {
    for (const provider of snapshot.providers) {
      if (!byProvider.has(provider.provider)) continue;
      const bucket = byProvider.get(provider.provider)!;
      bucket.records.push(...provider.models.map((m) => ({ ...m })));
      if (provider.errors?.length) {
        for (const err of provider.errors) {
          bucket.errors.push(`[${snapshot.machineId}] ${err}`);
        }
      }
    }
  }

  const providers: ProviderUsageResult[] = [];
  for (const name of providerOrder(providerNames)) {
    const bucket = byProvider.get(name)!;
    const models = mergeByModel(bucket.records);
    providers.push({
      provider: name,
      models,
      totalCostUSD: models.reduce((sum, model) => sum + model.costUSD, 0),
      dataSource: 'local',
      errors: bucket.errors.length > 0 ? bucket.errors : undefined,
    });
  }

  return {
    period: { since: date, until: date },
    providers,
    totalCostUSD: providers.reduce((sum, provider) => sum + provider.totalCostUSD, 0),
  };
}

export function summarizeFromDaily(
  byDay: Map<string, UsageSummary>,
  providerNames: string[],
  period: { since: string; until: string },
): UsageSummary {
  const byProvider = new Map<ProviderUsageResult['provider'], { records: ProviderUsageResult['models']; errors: string[] }>();
  for (const provider of providerOrder(providerNames)) {
    byProvider.set(provider, { records: [], errors: [] });
  }

  for (const day of byDay.values()) {
    for (const provider of day.providers) {
      if (!byProvider.has(provider.provider)) continue;
      const bucket = byProvider.get(provider.provider)!;
      bucket.records.push(...provider.models.map((m) => ({ ...m })));
      if (provider.errors?.length) {
        bucket.errors.push(...provider.errors);
      }
    }
  }

  const providers: ProviderUsageResult[] = [];
  for (const provider of providerOrder(providerNames)) {
    const bucket = byProvider.get(provider)!;
    const models = mergeByModel(bucket.records);
    providers.push({
      provider,
      models,
      totalCostUSD: models.reduce((sum, model) => sum + model.costUSD, 0),
      dataSource: 'local',
      errors: bucket.errors.length > 0 ? bucket.errors : undefined,
    });
  }

  return {
    period,
    providers,
    totalCostUSD: providers.reduce((sum, provider) => sum + provider.totalCostUSD, 0),
  };
}
