import { describe, expect, it } from 'vitest';
import {
  createDaySnapshot,
  daySnapshotFilename,
  parseDaySnapshot,
  parseDaySnapshotFilename,
  sanitizeMachineId,
} from './schema.js';
import type { UsageSummary } from '../types.js';

function sampleSummary(date: string): UsageSummary {
  return {
    period: { since: date, until: date },
    providers: [
      {
        provider: 'codex',
        models: [
          {
            model: 'gpt-5',
            inputTokens: 10,
            outputTokens: 5,
            reasoningTokens: 0,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            costUSD: 0.12,
          },
        ],
        totalCostUSD: 0.12,
        dataSource: 'local',
      },
    ],
    totalCostUSD: 0.12,
  };
}

describe('sync schema', () => {
  it('creates and validates day snapshots with digest', () => {
    const snapshot = createDaySnapshot('2026-03-02', 'mbp14', sampleSummary('2026-03-02'));
    expect(parseDaySnapshot(snapshot)).toEqual(snapshot);
  });

  it('fails when digest is tampered', () => {
    const snapshot = createDaySnapshot('2026-03-02', 'mbp14', sampleSummary('2026-03-02'));
    const tampered = {
      ...snapshot,
      providers: [
        {
          ...snapshot.providers[0],
          models: [
            {
              ...snapshot.providers[0]!.models[0]!,
              inputTokens: 999,
            },
          ],
        },
      ],
    };
    expect(() => parseDaySnapshot(tampered)).toThrow('digest mismatch');
  });

  it('round-trips day snapshot file names', () => {
    const name = daySnapshotFilename('2026-03-02', 'dev-machine_1');
    expect(name).toBe('howvibe.day.v1.2026-03-02.dev-machine_1.json');
    expect(parseDaySnapshotFilename(name)).toEqual({
      date: '2026-03-02',
      machineId: 'dev-machine_1',
    });
    expect(parseDaySnapshotFilename('unknown.json')).toBeNull();
  });

  it('sanitizes machine ids for file-safe names', () => {
    expect(sanitizeMachineId(' Mac Book Pro (A) ')).toBe('Mac-Book-Pro-A');
    expect(sanitizeMachineId('___')).toBe('___');
  });
});
