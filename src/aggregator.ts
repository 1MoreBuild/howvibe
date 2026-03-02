import type { HowvibeConfig } from './config.js';
import type { DateRange, ProviderUsageResult, UsageSummary, GroupedUsageRow, GroupedUsageSummary } from './types.js';
import type { UsageProvider } from './providers/interface.js';
import { formatDate } from './utils/date.js';

export async function aggregateUsage(
  providers: UsageProvider[],
  dateRange: DateRange,
  config: HowvibeConfig,
): Promise<UsageSummary> {
  // Run all providers in parallel; catch individual failures
  const results = await Promise.all(
    providers.map(async (provider): Promise<ProviderUsageResult> => {
      try {
        return await provider.getUsage(dateRange, config);
      } catch (err) {
        return {
          provider: provider.name as ProviderUsageResult['provider'],
          models: [],
          totalCostUSD: 0,
          dataSource: 'local',
          errors: [err instanceof Error ? err.message : String(err)],
        };
      }
    }),
  );

  const totalCostUSD = results.reduce((sum, r) => sum + r.totalCostUSD, 0);

  return {
    period: {
      since: formatDate(dateRange.since),
      until: formatDate(dateRange.until),
    },
    providers: results,
    totalCostUSD,
  };
}

/**
 * Aggregate usage across periods (days or months).
 * Calls all providers for each period and sums cross-provider totals.
 */
export async function aggregateGrouped(
  providers: UsageProvider[],
  periods: { label: string; range: DateRange }[],
  config: HowvibeConfig,
  title: string,
): Promise<GroupedUsageSummary> {
  const errorSet = new Set<string>();
  const rows: GroupedUsageRow[] = [];

  for (const period of periods) {
    const summary = await aggregateUsage(providers, period.range, config);

    // Collect errors from all periods, deduplicated
    for (const p of summary.providers) {
      if (p.errors?.length) {
        for (const e of p.errors) errorSet.add(e);
      }
    }

    let input = 0, output = 0, reasoning = 0, cacheRead = 0, cacheCreate = 0, cost = 0;
    for (const p of summary.providers) {
      for (const m of p.models) {
        input += m.inputTokens;
        output += m.outputTokens;
        reasoning += m.reasoningTokens;
        cacheRead += m.cacheReadTokens;
        cacheCreate += m.cacheCreationTokens;
        cost += m.costUSD;
      }
    }

    // Include rows with either token usage or non-zero cost.
    if (input + output + reasoning + cacheRead + cacheCreate > 0 || cost > 0) {
      rows.push({
        label: period.label,
        inputTokens: input,
        outputTokens: output,
        reasoningTokens: reasoning,
        cacheReadTokens: cacheRead,
        cacheCreationTokens: cacheCreate,
        costUSD: cost,
      });
    }
  }

  return { title, rows, errors: [...errorSet] };
}
