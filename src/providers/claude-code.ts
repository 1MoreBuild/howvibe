import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { glob } from 'tinyglobby';
import { getClaudeConfigDir, getUsageSource, type HowvibeConfig } from '../config.js';
import { processJSONLFile } from '../utils/fs.js';
import { isInRange } from '../utils/date.js';
import { calculateCost } from '../pricing.js';
import { mergeByModel } from '../utils/tokens.js';
import { ClaudeUsageLineSchema, type DateRange, type ModelUsageRecord, type ProviderUsageResult } from '../types.js';
import type { UsageProvider } from './interface.js';

function findProjectsDir(): string | undefined {
  const configDir = getClaudeConfigDir();

  // Try ~/.claude/projects/ first
  const claudeProjects = join(configDir, 'projects');
  if (existsSync(claudeProjects)) return claudeProjects;

  // Try ~/.config/claude/projects/
  const xdgProjects = join(configDir.replace(/\.claude$/, '.config/claude'), 'projects');
  if (existsSync(xdgProjects)) return xdgProjects;

  return undefined;
}

export class ClaudeCodeProvider implements UsageProvider {
  readonly name = 'claude-code';

  async getUsage(dateRange: DateRange, config: HowvibeConfig): Promise<ProviderUsageResult> {
    const source = getUsageSource(config);
    if (source !== 'auto' && source !== 'cli') {
      return {
        provider: 'claude-code',
        models: [],
        totalCostUSD: 0,
        dataSource: 'local',
        errors: [`Claude Code detailed token usage is local-only. Source "${source}" is not supported for this provider.`],
      };
    }

    const errors: string[] = [];
    const projectsDir = findProjectsDir();

    if (!projectsDir) {
      return {
        provider: 'claude-code',
        models: [],
        totalCostUSD: 0,
        dataSource: 'local',
        errors: ['Claude Code projects directory not found'],
      };
    }

    const files = await glob('**/*.jsonl', { cwd: projectsDir, absolute: true });

    if (files.length === 0) {
      return {
        provider: 'claude-code',
        models: [],
        totalCostUSD: 0,
        dataSource: 'local',
        errors: ['No JSONL files found'],
      };
    }

    const records: ModelUsageRecord[] = [];
    const seen = new Set<string>();

    for (const file of files) {
      try {
        await processJSONLFile(file, (parsed) => {
          const result = ClaudeUsageLineSchema.safeParse(parsed);
          if (!result.success) return;

          const data = result.data;

          // Date filter
          if (!isInRange(data.timestamp, dateRange)) return;

          // Deduplication: message.id + requestId
          if (data.message.id && data.requestId) {
            const key = `${data.message.id}:${data.requestId}`;
            if (seen.has(key)) return;
            seen.add(key);
          }

          const model = data.message.model ?? 'unknown';

          // Skip synthetic/internal messages
          if (model === '<synthetic>') return;

          const usage = data.message.usage;
          const inputTokens = usage.input_tokens;
          const outputTokens = usage.output_tokens;
          const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;
          const cacheReadTokens = usage.cache_read_input_tokens ?? 0;

          // Prefer costUSD from data, fall back to pricing table
          const costUSD =
            data.costUSD ?? calculateCost(model, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens);

          records.push({
            model,
            inputTokens,
            outputTokens,
            reasoningTokens: 0,
            cacheCreationTokens,
            cacheReadTokens,
            costUSD,
          });
        });
      } catch (err) {
        errors.push(`Error reading ${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const models = mergeByModel(records);
    const totalCostUSD = models.reduce((sum, m) => sum + m.costUSD, 0);

    return {
      provider: 'claude-code',
      models,
      totalCostUSD,
      dataSource: 'local',
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}
