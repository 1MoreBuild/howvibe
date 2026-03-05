import type { HowvibeConfig } from './config.js';
import type { DateRange, ProviderUsageResult, UsageSummary } from './types.js';
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
