import { getCookies, toCookieHeader } from '@steipete/sweet-cookie';
import { getCursorSessionToken, type HowvibeConfig } from '../config.js';
import { mergeByModel } from '../utils/tokens.js';
import type { DateRange, ModelUsageRecord, ProviderUsageResult } from '../types.js';
import type { UsageProvider } from './interface.js';

type CursorUsageEvent = {
  timestamp: string;
  model: string;
  kind: string;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheWriteTokens?: number;
    cacheReadTokens?: number;
    totalCents?: number;
  };
  isTokenBasedCall?: boolean;
};

type CursorResponse = {
  totalUsageEventsCount?: number;
  usageEventsDisplay?: CursorUsageEvent[];
};

async function getCursorCookieHeader(): Promise<string | null> {
  try {
    // Try multiple browsers, not just Chrome
    const { cookies } = await getCookies({
      url: 'https://cursor.com/',
      names: ['WorkosCursorSessionToken'],
    });
    if (cookies.length === 0) return null;
    return toCookieHeader(cookies, { dedupeByName: true });
  } catch {
    return null;
  }
}

export class CursorProvider implements UsageProvider {
  readonly name = 'cursor';

  async getUsage(dateRange: DateRange, config: HowvibeConfig): Promise<ProviderUsageResult> {
    // Try: 1) Chrome cookie auto-import, 2) manual config/env
    let cookieHeader: string | null = null;

    cookieHeader = await getCursorCookieHeader();

    if (!cookieHeader) {
      const manualToken = getCursorSessionToken(config);
      if (manualToken) {
        cookieHeader = `WorkosCursorSessionToken=${manualToken}`;
      }
    }

    if (!cookieHeader) {
      return {
        provider: 'cursor',
        models: [],
        totalCostUSD: 0,
        dataSource: 'api',
        errors: ['Cursor: log in at cursor.com in Chrome, or set cursorSessionToken in ~/.howvibe/config.json'],
      };
    }

    const startDate = dateRange.since.getTime().toString();
    const endDate = dateRange.until.getTime().toString();

    const allEvents: CursorUsageEvent[] = [];
    let page = 1;
    const pageSize = 100;
    const maxPages = 100; // Safety limit: 10,000 events max

    while (page <= maxPages) {
      const res = await fetch('https://cursor.com/api/dashboard/get-filtered-usage-events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://cursor.com',
          Cookie: cookieHeader,
        },
        body: JSON.stringify({ teamId: 0, startDate, endDate, page, pageSize }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          provider: 'cursor',
          models: [],
          totalCostUSD: 0,
          dataSource: 'api',
          errors: [`Cursor API error ${res.status}: ${text.slice(0, 200)}`],
        };
      }

      const body = (await res.json()) as CursorResponse;
      const events = body.usageEventsDisplay ?? [];
      allEvents.push(...events);

      const total = body.totalUsageEventsCount ?? 0;
      if (page * pageSize >= total || events.length === 0) break;
      page++;
    }

    const errors: string[] = [];
    if (page > maxPages) {
      errors.push(`Cursor: pagination limit reached (${maxPages * pageSize} events). Results may be incomplete.`);
    }

    const records: ModelUsageRecord[] = allEvents
      .filter((e) => e.isTokenBasedCall && e.tokenUsage)
      .map((e) => {
        const t = e.tokenUsage!;
        return {
          model: e.model || 'unknown',
          inputTokens: t.inputTokens ?? 0,
          outputTokens: t.outputTokens ?? 0,
          reasoningTokens: 0,
          cacheCreationTokens: t.cacheWriteTokens ?? 0,
          cacheReadTokens: t.cacheReadTokens ?? 0,
          costUSD: (t.totalCents ?? 0) / 100,
        };
      });

    const merged = mergeByModel(records);
    const totalCostUSD = merged.reduce((sum, m) => sum + m.costUSD, 0);

    return {
      provider: 'cursor',
      models: merged,
      totalCostUSD,
      dataSource: 'api',
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}
