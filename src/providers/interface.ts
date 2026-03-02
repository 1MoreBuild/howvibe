import type { DateRange, ProviderUsageResult } from '../types.js';
import type { HowvibeConfig } from '../config.js';

export interface UsageProvider {
  readonly name: string;
  getUsage(dateRange: DateRange, config: HowvibeConfig): Promise<ProviderUsageResult>;
}
