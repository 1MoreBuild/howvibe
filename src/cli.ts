import { Command } from 'commander';
import { loadConfig } from './config.js';
import { getProviders } from './providers/registry.js';
import { aggregateUsage, aggregateGrouped } from './aggregator.js';
import { buildDateRange, getTodayRange, splitIntoDays, splitIntoMonths } from './utils/date.js';
import { formatTable } from './formatters/table.js';
import { formatJSON } from './formatters/json.js';
import { formatGroupedTable, formatGroupedJSON } from './formatters/grouped-table.js';
import type { DateRange } from './types.js';

type GlobalOpts = {
  json?: boolean;
  provider?: string;
  since?: string;
  until?: string;
};

async function runCommand(dateRange: DateRange, opts: GlobalOpts) {
  const config = await loadConfig();
  const providers = getProviders(opts.provider);
  const summary = await aggregateUsage(providers, dateRange, config);

  if (opts.json) {
    console.log(formatJSON(summary));
  } else {
    console.log(formatTable(summary));
  }
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('howvibe')
    .description('Track AI coding tool token usage and costs')
    .version('0.1.0')
    .option('--json', 'Output as JSON')
    .option('--provider <name>', 'Only show a specific provider (claude-code, codex, cursor, openrouter)')
    .option('--since <date>', 'Start date (YYYY-MM-DD)')
    .option('--until <date>', 'End date (YYYY-MM-DD)');

  // No subcommand and no options → show help
  program.action(async (opts: GlobalOpts) => {
    if (!opts.json && !opts.provider && !opts.since && !opts.until) {
      program.help();
      return;
    }
    const dateRange = buildDateRange(opts.since, opts.until);
    await runCommand(dateRange, opts);
  });

  program
    .command('today')
    .description('Show today\'s usage per provider with model breakdown')
    .action(async () => {
      const opts = program.opts<GlobalOpts>();
      await runCommand(getTodayRange(), opts);
    });

  program
    .command('daily')
    .description('Show usage grouped by day')
    .action(async () => {
      const opts = program.opts<GlobalOpts>();
      const dateRange = buildDateRange(opts.since, opts.until);
      const periods = splitIntoDays(dateRange);
      const config = await loadConfig();
      const providers = getProviders(opts.provider);
      const title = `Daily Report (${periods[0].label} to ${periods[periods.length - 1].label})`;
      const summary = await aggregateGrouped(providers, periods, config, title);

      if (opts.json) {
        console.log(formatGroupedJSON(summary));
      } else {
        console.log(formatGroupedTable(summary));
      }
    });

  program
    .command('monthly')
    .description('Show usage grouped by month')
    .action(async () => {
      const opts = program.opts<GlobalOpts>();
      const dateRange = buildDateRange(opts.since, opts.until);
      const periods = splitIntoMonths(dateRange);
      const config = await loadConfig();
      const providers = getProviders(opts.provider);
      const title = `Monthly Report`;
      const summary = await aggregateGrouped(providers, periods, config, title);

      if (opts.json) {
        console.log(formatGroupedJSON(summary));
      } else {
        console.log(formatGroupedTable(summary, 'Month'));
      }
    });

  return program;
}
