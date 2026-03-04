import { Command } from 'commander';
import { disableSync, enableSync, aggregateWithAutoSync } from './sync/engine.js';
import { loadConfig, saveConfig, getUsageSource, type HowvibeConfig } from './config.js';
import { getProviders } from './providers/registry.js';
import { buildDateRange, getTodayRange, splitIntoDays, splitIntoMonths } from './utils/date.js';
import { formatTable } from './formatters/table.js';
import { formatJSON } from './formatters/json.js';
import { formatGroupedTable, formatGroupedJSON } from './formatters/grouped-table.js';
import type { DateRange, GroupedUsageSummary, UsageSummary } from './types.js';

type GlobalOpts = {
  json?: boolean;
  provider?: string;
  source?: string;
  since?: string;
  until?: string;
};

function summarizeUsage(summary: UsageSummary) {
  const errors: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let costUSD = 0;

  for (const provider of summary.providers) {
    if (provider.errors?.length) {
      errors.push(...provider.errors);
    }
    for (const model of provider.models) {
      inputTokens += model.inputTokens;
      outputTokens += model.outputTokens;
      reasoningTokens += model.reasoningTokens;
      cacheReadTokens += model.cacheReadTokens;
      cacheCreationTokens += model.cacheCreationTokens;
      costUSD += model.costUSD;
    }
  }

  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheReadTokens,
    cacheCreationTokens,
    costUSD,
    errors,
  };
}

function buildDailyGroupedSummary(dateRange: DateRange, byDay: Map<string, UsageSummary>): GroupedUsageSummary {
  const periods = splitIntoDays(dateRange);
  const rows: GroupedUsageSummary['rows'] = [];
  const errorSet = new Set<string>();

  for (const period of periods) {
    const summary = byDay.get(period.label);
    if (!summary) continue;

    const totals = summarizeUsage(summary);
    for (const err of totals.errors) {
      errorSet.add(err);
    }

    const totalTokens =
      totals.inputTokens +
      totals.outputTokens +
      totals.reasoningTokens +
      totals.cacheReadTokens +
      totals.cacheCreationTokens;

    if (totalTokens > 0 || totals.costUSD > 0) {
      rows.push({
        label: period.label,
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        reasoningTokens: totals.reasoningTokens,
        cacheReadTokens: totals.cacheReadTokens,
        cacheCreationTokens: totals.cacheCreationTokens,
        costUSD: totals.costUSD,
      });
    }
  }

  return {
    title: `Daily Report (${periods[0].label} to ${periods[periods.length - 1].label})`,
    rows,
    errors: [...errorSet],
  };
}

function buildMonthlyGroupedSummary(dateRange: DateRange, byDay: Map<string, UsageSummary>): GroupedUsageSummary {
  const periods = splitIntoMonths(dateRange);
  const errorSet = new Set<string>();
  const monthTotals = new Map<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      reasoningTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      costUSD: number;
    }
  >();

  for (const [dayLabel, summary] of byDay.entries()) {
    const monthLabel = dayLabel.slice(0, 7);
    const totals = summarizeUsage(summary);
    for (const err of totals.errors) {
      errorSet.add(err);
    }

    const bucket = monthTotals.get(monthLabel) ?? {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUSD: 0,
    };

    bucket.inputTokens += totals.inputTokens;
    bucket.outputTokens += totals.outputTokens;
    bucket.reasoningTokens += totals.reasoningTokens;
    bucket.cacheReadTokens += totals.cacheReadTokens;
    bucket.cacheCreationTokens += totals.cacheCreationTokens;
    bucket.costUSD += totals.costUSD;
    monthTotals.set(monthLabel, bucket);
  }

  const rows: GroupedUsageSummary['rows'] = [];
  for (const period of periods) {
    const bucket = monthTotals.get(period.label);
    if (!bucket) continue;

    const totalTokens =
      bucket.inputTokens +
      bucket.outputTokens +
      bucket.reasoningTokens +
      bucket.cacheReadTokens +
      bucket.cacheCreationTokens;

    if (totalTokens > 0 || bucket.costUSD > 0) {
      rows.push({
        label: period.label,
        inputTokens: bucket.inputTokens,
        outputTokens: bucket.outputTokens,
        reasoningTokens: bucket.reasoningTokens,
        cacheReadTokens: bucket.cacheReadTokens,
        cacheCreationTokens: bucket.cacheCreationTokens,
        costUSD: bucket.costUSD,
      });
    }
  }

  return {
    title: 'Monthly Report',
    rows,
    errors: [...errorSet],
  };
}

function emitSyncNotes(warnings: string[], reminder: string | undefined, asJson: boolean): void {
  for (const warning of warnings) {
    console.error(`Sync warning: ${warning}`);
  }
  if (!reminder) return;

  if (asJson) {
    console.error(reminder);
  } else {
    console.log(`  ${reminder}`);
    console.log('');
  }
}

async function resolveConfig(opts: GlobalOpts): Promise<HowvibeConfig> {
  const baseConfig = await loadConfig();
  return {
    ...baseConfig,
    source: getUsageSource(baseConfig, opts.source),
  };
}

async function runSummaryCommand(dateRange: DateRange, opts: GlobalOpts) {
  const config = await resolveConfig(opts);
  const providers = getProviders(opts.provider, config.source ?? 'auto');
  const result = await aggregateWithAutoSync(dateRange, providers, config);

  if (opts.json) {
    console.log(formatJSON(result.summary));
  } else {
    console.log(formatTable(result.summary));
  }
  emitSyncNotes(result.warnings, result.reminder, Boolean(opts.json));
}

async function runGroupedCommand(dateRange: DateRange, opts: GlobalOpts, mode: 'daily' | 'monthly') {
  const config = await resolveConfig(opts);
  const providers = getProviders(opts.provider, config.source ?? 'auto');
  const result = await aggregateWithAutoSync(dateRange, providers, config, {}, { requireDaily: true });
  const grouped = mode === 'daily'
    ? buildDailyGroupedSummary(dateRange, result.daily)
    : buildMonthlyGroupedSummary(dateRange, result.daily);

  if (opts.json) {
    console.log(formatGroupedJSON(grouped));
  } else {
    console.log(formatGroupedTable(grouped, mode === 'daily' ? 'Date' : 'Month'));
  }
  emitSyncNotes(result.warnings, result.reminder, Boolean(opts.json));
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('howvibe')
    .description('Track AI coding tool token usage and costs')
    .version('0.1.0')
    .option('--json', 'Output as JSON')
    .option('--provider <name>', 'Only show a specific provider (claude-code, codex, cursor, openrouter)')
    .option('--source <source>', 'Usage source (auto, web, cli, oauth)')
    .option('--since <date>', 'Start date (YYYY-MM-DD)')
    .option('--until <date>', 'End date (YYYY-MM-DD)');

  // No subcommand and no options → show help
  program.action(async (opts: GlobalOpts) => {
    if (!opts.json && !opts.provider && !opts.source && !opts.since && !opts.until) {
      program.help();
      return;
    }
    const dateRange = buildDateRange(opts.since, opts.until);
    await runSummaryCommand(dateRange, opts);
  });

  program
    .command('today')
    .description('Show today\'s usage per provider with model breakdown')
    .action(async () => {
      const opts = program.opts<GlobalOpts>();
      await runSummaryCommand(getTodayRange(), opts);
    });

  program
    .command('daily')
    .description('Show usage grouped by day')
    .action(async () => {
      const opts = program.opts<GlobalOpts>();
      const dateRange = buildDateRange(opts.since, opts.until);
      await runGroupedCommand(dateRange, opts, 'daily');
    });

  program
    .command('monthly')
    .description('Show usage grouped by month')
    .action(async () => {
      const opts = program.opts<GlobalOpts>();
      const dateRange = buildDateRange(opts.since, opts.until);
      await runGroupedCommand(dateRange, opts, 'monthly');
    });

  const sync = program.command('sync').description('Configure automatic cross-machine sync using GitHub Gist');

  sync
    .command('enable')
    .description('Authorize with GitHub and enable automatic sync')
    .action(async () => {
      const config = await loadConfig();
      const providers = getProviders();
      console.log('Starting sync setup. This may take a while on first run...');
      const enableResult = await enableSync(
        { ...config, source: 'auto' },
        providers,
        {},
        {
          onProgress: (message) => {
            console.log(`  - ${message}`);
          },
        },
      );
      await saveConfig({
        ...config,
        sync: enableResult.config.sync,
      });

      console.log('Sync enabled.');
      console.log(`Gist: ${enableResult.gistId}`);
      console.log(`Machine ID: ${enableResult.machineId}`);
      console.log(`Initial backfill: last ${enableResult.bootstrapDays} days`);

      for (const warning of enableResult.warnings) {
        console.error(`Sync warning: ${warning}`);
      }
    });

  sync
    .command('disable')
    .description('Disable automatic sync')
    .action(async () => {
      const config = await loadConfig();
      const next = disableSync(config);
      await saveConfig(next);
      console.log('Sync disabled.');
    });

  return program;
}
