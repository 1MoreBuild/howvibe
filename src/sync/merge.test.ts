import { describe, expect, it } from 'vitest';
import { createDaySnapshot } from './schema.js';
import { mergeDaySnapshots, summarizeFromDaily } from './merge.js';
import type { UsageSummary } from '../types.js';

function makeSummary(date: string, input: number, cost: number): UsageSummary {
  return {
    period: { since: date, until: date },
    providers: [
      {
        provider: 'codex',
        models: [
          {
            model: 'gpt-5',
            inputTokens: input,
            outputTokens: 0,
            reasoningTokens: 0,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            costUSD: cost,
          },
        ],
        totalCostUSD: cost,
        dataSource: 'local',
      },
    ],
    totalCostUSD: cost,
  };
}

describe('sync merge', () => {
  it('merges snapshots from multiple machines', () => {
    const day = '2026-03-02';
    const a = createDaySnapshot(day, 'machine-a', makeSummary(day, 100, 1.0), new Date('2026-03-02T10:00:00.000Z'));
    const b = createDaySnapshot(day, 'machine-b', makeSummary(day, 50, 0.5), new Date('2026-03-02T10:00:00.000Z'));
    const merged = mergeDaySnapshots([a, b], ['codex'], day);

    expect(merged.providers[0]?.models[0]?.inputTokens).toBe(150);
    expect(merged.totalCostUSD).toBeCloseTo(1.5);
  });

  it('deduplicates same machine/day by latest generatedAt', () => {
    const day = '2026-03-02';
    const oldSnap = createDaySnapshot(day, 'machine-a', makeSummary(day, 10, 0.1), new Date('2026-03-02T10:00:00.000Z'));
    const newSnap = createDaySnapshot(day, 'machine-a', makeSummary(day, 20, 0.2), new Date('2026-03-02T12:00:00.000Z'));
    const merged = mergeDaySnapshots([oldSnap, newSnap], ['codex'], day);

    expect(merged.providers[0]?.models[0]?.inputTokens).toBe(20);
    expect(merged.totalCostUSD).toBeCloseTo(0.2);
  });

  it('summarizes multiple days into a single period', () => {
    const day1 = '2026-03-01';
    const day2 = '2026-03-02';
    const byDay = new Map<string, UsageSummary>([
      [day1, mergeDaySnapshots([createDaySnapshot(day1, 'a', makeSummary(day1, 10, 0.1))], ['codex'], day1)],
      [day2, mergeDaySnapshots([createDaySnapshot(day2, 'b', makeSummary(day2, 20, 0.2))], ['codex'], day2)],
    ]);

    const summary = summarizeFromDaily(byDay, ['codex'], { since: day1, until: day2 });
    expect(summary.providers[0]?.models[0]?.inputTokens).toBe(30);
    expect(summary.totalCostUSD).toBeCloseTo(0.3);
  });
});
