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

type FetchActivityResult = {
  items: ActivityItem[];
  errors: string[];
};

async function fetchActivity(managementKey: string, dateRange: DateRange): Promise<FetchActivityResult> {
  const dates: string[] = [];
  const cur = new Date(dateRange.since);
  while (cur <= dateRange.until) {
    dates.push(formatDate(cur));
    cur.setDate(cur.getDate() + 1);
  }

  const results = await Promise.all(
    dates.map(async (date) => {
      try {
        const res = await fetch(`https://openrouter.ai/api/v1/activity?date=${date}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${managementKey}`,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(15_000),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          return { items: [] as ActivityItem[], error: `HTTP ${res.status} for ${date}${text ? `: ${text.slice(0, 200)}` : ''}` };
        }

        const body = (await res.json()) as Record<string, unknown>;
        const data = body.data;
        if (Array.isArray(data)) {
          return { items: data as ActivityItem[], error: null };
        }
        return { items: [] as ActivityItem[], error: `Invalid response shape for ${date}: missing data[]` };
      } catch (err) {
        return { items: [] as ActivityItem[], error: `Request failed for ${date}: ${err instanceof Error ? err.message : String(err)}` };
      }
    }),
  );

  const allItems: ActivityItem[] = [];
  const errors: string[] = [];
  for (const result of results) {
    allItems.push(...result.items);
    if (result.error) errors.push(result.error);
  }

  return { items: allItems, errors };
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
        errors: ['OPENROUTER_MANAGEMENT_KEY not set. Create one at https://openrouter.ai/settings/management-keys'],
      };
    }

    try {
      const { items, errors } = await fetchActivity(managementKey, dateRange);

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
        errors: errors.length > 0 ? errors.map((e) => `OpenRouter API error: ${e}`) : undefined,
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
