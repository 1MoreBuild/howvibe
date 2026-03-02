import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { glob } from 'tinyglobby';
import { getCodexHome, type HowvibeConfig } from '../config.js';
import { isInRange } from '../utils/date.js';
import { calculateCost } from '../pricing.js';
import { mergeByModel } from '../utils/tokens.js';
import {
  CodexEntrySchema,
  CodexTokenCountPayloadSchema,
  CodexTurnContextPayloadSchema,
  type DateRange,
  type ModelUsageRecord,
  type ProviderUsageResult,
} from '../types.js';
import type { UsageProvider } from './interface.js';

type RawUsage = {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
};

function normalizeRawUsage(value: unknown): RawUsage | null {
  if (value == null || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;

  const input = ensureNumber(r['input_tokens']);
  const cached = ensureNumber(r['cached_input_tokens'] ?? r['cache_read_input_tokens']);
  const output = ensureNumber(r['output_tokens']);
  const reasoning = ensureNumber(r['reasoning_output_tokens']);
  const total = ensureNumber(r['total_tokens']);

  return {
    input_tokens: input,
    cached_input_tokens: cached,
    output_tokens: output,
    reasoning_output_tokens: reasoning,
    total_tokens: total > 0 ? total : input + output,
  };
}

function ensureNumber(v: unknown): number {
  return typeof v === 'number' && !isNaN(v) ? v : 0;
}

function subtractRawUsage(current: RawUsage, previous: RawUsage | null): RawUsage {
  return {
    input_tokens: Math.max(current.input_tokens - (previous?.input_tokens ?? 0), 0),
    cached_input_tokens: Math.max(current.cached_input_tokens - (previous?.cached_input_tokens ?? 0), 0),
    output_tokens: Math.max(current.output_tokens - (previous?.output_tokens ?? 0), 0),
    reasoning_output_tokens: Math.max(current.reasoning_output_tokens - (previous?.reasoning_output_tokens ?? 0), 0),
    total_tokens: Math.max(current.total_tokens - (previous?.total_tokens ?? 0), 0),
  };
}

export class CodexProvider implements UsageProvider {
  readonly name = 'codex';

  async getUsage(dateRange: DateRange, _config: HowvibeConfig): Promise<ProviderUsageResult> {
    const errors: string[] = [];
    const codexHome = getCodexHome();
    const sessionsDir = join(codexHome, 'sessions');

    if (!existsSync(sessionsDir)) {
      return {
        provider: 'codex',
        models: [],
        totalCostUSD: 0,
        dataSource: 'local',
        errors: ['Codex sessions directory not found'],
      };
    }

    const files = await glob('**/*.jsonl', { cwd: sessionsDir, absolute: true });

    if (files.length === 0) {
      return {
        provider: 'codex',
        models: [],
        totalCostUSD: 0,
        dataSource: 'local',
        errors: ['No JSONL files found'],
      };
    }

    const allRecords: ModelUsageRecord[] = [];

    for (const file of files) {
      try {
        const content = await readFile(file, 'utf-8');
        const lines = content.split(/\r?\n/);

        let currentModel = 'gpt-5';
        let previousTotals: RawUsage | null = null;

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let parsed: unknown;
          try {
            parsed = JSON.parse(trimmed);
          } catch {
            continue;
          }

          const entryResult = CodexEntrySchema.safeParse(parsed);
          if (!entryResult.success) continue;

          const entry = entryResult.data;

          // Date filter
          if (!isInRange(entry.timestamp, dateRange)) continue;

          // Handle turn_context: extract model
          if (entry.type === 'turn_context') {
            const ctxResult = CodexTurnContextPayloadSchema.safeParse(entry.payload);
            if (ctxResult.success && ctxResult.data.model) {
              currentModel = ctxResult.data.model;
            }
            continue;
          }

          // Handle event_msg with token_count
          if (entry.type === 'event_msg') {
            const tokenResult = CodexTokenCountPayloadSchema.safeParse(entry.payload);
            if (!tokenResult.success) continue;

            const payload = tokenResult.data;
            const info = payload.info;

            // Extract model from payload if available
            const model = info?.model ?? payload.model ?? currentModel;

            const lastUsage = normalizeRawUsage(info?.last_token_usage);
            const totalUsage = normalizeRawUsage(info?.total_token_usage);

            // Prefer last_token_usage (already a delta), fall back to total - previous
            let raw = lastUsage;
            if (raw == null && totalUsage != null) {
              raw = subtractRawUsage(totalUsage, previousTotals);
            }

            if (totalUsage != null) {
              previousTotals = totalUsage;
            }

            if (raw != null) {
              // OpenAI convention: input_tokens is the TOTAL (includes cached).
              // Normalize to Anthropic convention: prompt = non-cached only, cacheRead = cached portion.
              const cachedInput = Math.min(raw.cached_input_tokens, raw.input_tokens);
              const nonCachedInput = raw.input_tokens - cachedInput;
              const costUSD = calculateCost(model, nonCachedInput, raw.output_tokens, cachedInput, 0);

              allRecords.push({
                model,
                inputTokens: nonCachedInput,
                outputTokens: raw.output_tokens,
                reasoningTokens: raw.reasoning_output_tokens,
                cacheCreationTokens: 0,
                cacheReadTokens: cachedInput,
                costUSD,
              });
            }
          }
        }
      } catch (err) {
        errors.push(`Error reading ${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const models = mergeByModel(allRecords);
    const totalCostUSD = models.reduce((sum, m) => sum + m.costUSD, 0);

    return {
      provider: 'codex',
      models,
      totalCostUSD,
      dataSource: 'local',
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}
