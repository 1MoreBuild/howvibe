import { getOpenRouterManagementKey, type HowvibeConfig } from '../config.js';
import { formatDate } from '../utils/date.js';
import { mergeByModel } from '../utils/tokens.js';
import type { DateRange, ModelUsageRecord, ProviderUsageResult } from '../types.js';
import type { UsageProvider } from './interface.js';

type ActivityItem = {
  date: string;
  model: string;
  usage: number;         // USD cost
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens?: number;
};

async function fetchActivity(managementKey: string, dateRange: DateRange): Promise<ActivityItem[]> {
  const dates: string[] = [];
  const cur = new Date(dateRange.since);
  while (cur <= dateRange.until) {
    dates.push(formatDate(cur));
    cur.setDate(cur.getDate() + 1);
  }

  const allItems: ActivityItem[] = [];

  for (const date of dates) {
    const res = await fetch(`https://openrouter.ai/api/v1/activity?date=${date}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${managementKey}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) continue;

    const body = (await res.json()) as Record<string, unknown>;
    const data = body.data;
    if (Array.isArray(data)) {
      allItems.push(...(data as ActivityItem[]));
    }
  }

  return allItems;
}

export class OpenRouterProvider implements UsageProvider {
  readonly name = 'openrouter';

  async getUsage(dateRange: DateRange, config: HowvibeConfig): Promise<ProviderUsageResult> {
    const managementKey = getOpenRouterManagementKey(config);

    if (!managementKey) {
      return {
        provider: 'openrouter',
        models: [],
        totalCostUSD: 0,
        dataSource: 'api',
        errors: ['OPENROUTER_MANAGEMENT_KEY not set. Create one at openrouter.ai/settings/keys'],
      };
    }

    try {
      const items = await fetchActivity(managementKey, dateRange);

      let records: ModelUsageRecord[] = items.map((item) => ({
        model: item.model,
        inputTokens: item.prompt_tokens ?? 0,
        outputTokens: item.completion_tokens ?? 0,
        reasoningTokens: item.reasoning_tokens ?? 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        costUSD: item.usage ?? 0,
      }));
      records = mergeByModel(records);

      const totalCostUSD = records.reduce((sum, m) => sum + m.costUSD, 0);

      return {
        provider: 'openrouter',
        models: records,
        totalCostUSD,
        dataSource: 'api',
      };
    } catch (err) {
      return {
        provider: 'openrouter',
        models: [],
        totalCostUSD: 0,
        dataSource: 'api',
        errors: [`OpenRouter API error: ${err instanceof Error ? err.message : String(err)}`],
      };
    }
  }
}
