import { describe, expect, it } from 'vitest';
import { formatGroupedPlain, formatPlain } from './plain.js';
import type { GroupedUsageSummary, UsageSummary } from '../types.js';

describe('plain formatter', () => {
  it('formats summary output as stable TSV rows', () => {
    const summary: UsageSummary = {
      period: { since: '2026-03-01', until: '2026-03-02' },
      providers: [
        {
          provider: 'codex',
          models: [
            {
              model: 'codex-mini',
              inputTokens: 100,
              outputTokens: 40,
              reasoningTokens: 5,
              cacheReadTokens: 0,
              cacheCreationTokens: 3,
              costUSD: 0.0155,
            },
          ],
          totalCostUSD: 0.0155,
          dataSource: 'local',
          errors: ['partial data'],
        },
      ],
      totalCostUSD: 0.0155,
    };

    const output = formatPlain(summary);
    const lines = output.split('\n');

    expect(lines[0]).toBe(
      'record\tsince\tuntil\tprovider\tmodel\tinput_tokens\toutput_tokens\treasoning_tokens\tcache_read_tokens\tcache_creation_tokens\ttotal_tokens\tcost_usd\terror',
    );
    expect(lines[1]).toBe(
      'model\t2026-03-01\t2026-03-02\tcodex\tcodex-mini\t100\t40\t5\t0\t3\t148\t0.015500\t',
    );
    expect(lines[2]).toBe(
      'provider_total\t2026-03-01\t2026-03-02\tcodex\tall\t100\t40\t5\t0\t3\t148\t0.015500\t',
    );
    expect(lines[3]).toBe(
      'warning\t2026-03-01\t2026-03-02\tcodex\t\t\t\t\t\t\t\t\tpartial data',
    );
    expect(lines[4]).toBe(
      'grand_total\t2026-03-01\t2026-03-02\tall\tall\t100\t40\t5\t0\t3\t148\t0.015500\t',
    );
  });

  it('formats grouped output as stable TSV rows', () => {
    const grouped: GroupedUsageSummary = {
      title: 'Daily Report',
      rows: [
        {
          label: '2026-03-01',
          inputTokens: 10,
          outputTokens: 2,
          reasoningTokens: 0,
          cacheReadTokens: 1,
          cacheCreationTokens: 0,
          costUSD: 0.0012,
        },
        {
          label: '2026-03-02',
          inputTokens: 30,
          outputTokens: 5,
          reasoningTokens: 2,
          cacheReadTokens: 3,
          cacheCreationTokens: 1,
          costUSD: 0.0044,
        },
      ],
      errors: ['cursor unavailable'],
    };

    const output = formatGroupedPlain(grouped, 'daily');
    const lines = output.split('\n');

    expect(lines[0]).toBe(
      'record\tperiod\tlabel\tinput_tokens\toutput_tokens\treasoning_tokens\tcache_read_tokens\tcache_creation_tokens\ttotal_tokens\tcost_usd\terror',
    );
    expect(lines[1]).toBe(
      'row\tdaily\t2026-03-01\t10\t2\t0\t1\t0\t13\t0.001200\t',
    );
    expect(lines[2]).toBe(
      'row\tdaily\t2026-03-02\t30\t5\t2\t3\t1\t41\t0.004400\t',
    );
    expect(lines[3]).toBe(
      'warning\tdaily\t\t\t\t\t\t\t\t\tcursor unavailable',
    );
    expect(lines[4]).toBe(
      'total\tdaily\tall\t40\t7\t2\t4\t1\t54\t0.005600\t',
    );
  });
});
