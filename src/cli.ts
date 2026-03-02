import { Command } from 'commander';
import { loadConfig } from './config.js';
import { getProviders } from './providers/registry.js';
import { aggregateUsage } from './aggregator.js';
import { buildDateRange, getTodayRange } from './utils/date.js';
import { formatTable } from './formatters/table.js';
import { formatJSON } from './formatters/json.js';
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
    .option('--provider <name>', 'Only show a specific provider')
    .option('--since <date>', 'Start date (YYYY-MM-DD)')
    .option('--until <date>', 'End date (YYYY-MM-DD)');

  // Default action (no subcommand) = today
  program.action(async (opts: GlobalOpts) => {
    const dateRange = buildDateRange(opts.since, opts.until);
    await runCommand(dateRange, opts);
  });

  program
    .command('today')
    .description('Show today\'s usage (default)')
    .action(async () => {
      const opts = program.opts<GlobalOpts>();
      await runCommand(getTodayRange(), opts);
    });

  program
    .command('daily')
    .description('Show usage for a date range')
    .action(async () => {
      const opts = program.opts<GlobalOpts>();
      const dateRange = buildDateRange(opts.since, opts.until);
      await runCommand(dateRange, opts);
    });

  program
    .command('summary')
    .description('Show usage summary')
    .action(async () => {
      const opts = program.opts<GlobalOpts>();
      const dateRange = buildDateRange(opts.since, opts.until);
      await runCommand(dateRange, opts);
    });

  return program;
}
