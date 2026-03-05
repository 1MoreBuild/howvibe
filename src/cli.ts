import { Command, Option } from 'commander';
import { readFileSync } from 'node:fs';
import { disableSync, enableSync, aggregateWithAutoSync, isSyncEnabled } from './sync/engine.js';
import { loadConfig, saveConfig, getUsageSource, type HowvibeConfig } from './config.js';
import { getProviders } from './providers/registry.js';
import { buildDateRange, getTodayRange, splitIntoDays, splitIntoMonths } from './utils/date.js';
import { formatTable } from './formatters/table.js';
import { formatJSON } from './formatters/json.js';
import { formatGroupedTable, formatGroupedJSON } from './formatters/grouped-table.js';
import { formatPlain, formatGroupedPlain } from './formatters/plain.js';
import { maybeNotifyUpdate } from './update-notifier.js';
import { ensureGhInstalled, getGhToken } from './sync/gh.js';
import { GistClient } from './sync/gist-client.js';
import { parseDaySnapshotFilename } from './sync/schema.js';
import { loadSyncState } from './sync/state.js';
import type { DateRange, GroupedUsageSummary, SyncMachineInfo, SyncRuntimeMeta, UsageSummary } from './types.js';

type GlobalOpts = {
  json?: boolean;
  plain?: boolean;
  quiet?: boolean;
  input?: boolean;
  color?: boolean;
  provider?: string;
  source?: string;
  since?: string;
  until?: string;
};

async function withProgress<T>(
  opts: GlobalOpts,
  label: string,
  work: () => Promise<T>,
): Promise<T> {
  if (opts.quiet || !process.stderr.isTTY) {
    return work();
  }

  let shown = false;
  let success = false;
  const timer = setTimeout(() => {
    shown = true;
    process.stderr.write(`howvibe: ${label}...\n`);
  }, 800);
  timer.unref();

  try {
    const result = await work();
    success = true;
    return result;
  } finally {
    clearTimeout(timer);
    if (shown) {
      process.stderr.write(`howvibe: ${success ? 'done' : 'failed'}.\n`);
    }
  }
}

function readPackageVersion(): string {
  try {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf-8');
    const parsed = JSON.parse(raw) as { version?: string };
    if (typeof parsed.version === 'string' && parsed.version.length > 0) {
      return parsed.version;
    }
  } catch {
    // Fall back to a safe default when package metadata is unavailable.
  }
  return '0.0.0';
}

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

function emitSyncNotes(
  warnings: string[],
  reminder: string | undefined,
  syncMeta: SyncRuntimeMeta,
  machineReadable: boolean,
  quiet = false,
): void {
  for (const warning of warnings) {
    console.error(`Sync warning: ${warning}`);
  }
  if (quiet) return;

  if (machineReadable) {
    if (!reminder) return;
    console.error(reminder);
    return;
  }

  const statusLines = buildSyncStatusLines(syncMeta);
  for (const line of statusLines) {
    console.log(`  ${line}`);
  }
  if (reminder) {
    console.log(`  ${reminder}`);
  }
  console.log('');
}

type SyncStatusReport = {
  enabled: boolean;
  gistId?: string;
  auditUrl?: string;
  machineId?: string;
  machineName?: string;
  bootstrapDays?: number;
  lastSyncedAt?: string;
  ghInstalled: boolean;
  ghTokenAvailable: boolean;
  remoteAccessible: boolean;
  remoteSnapshotFiles: number;
  machines: SyncMachineInfo[];
  issues: string[];
};

function formatMachineLabel(machine: SyncMachineInfo): string {
  const base =
    machine.name && machine.name !== machine.id
      ? `${machine.name} [${machine.id}]`
      : machine.id;
  if (typeof machine.snapshotDays === 'number') {
    return `${base} (${machine.snapshotDays}d)`;
  }
  return base;
}

function formatMachinesInline(machines: SyncMachineInfo[], limit = 6): string {
  if (machines.length === 0) return 'none';
  const shown = machines.slice(0, limit).map(formatMachineLabel);
  const extra = machines.length - shown.length;
  return extra > 0 ? `${shown.join(', ')}, +${extra} more` : shown.join(', ');
}

function buildSyncStatusLines(syncMeta: SyncRuntimeMeta): string[] {
  if (syncMeta.status === 'disabled') {
    return [
      `Sync: disabled (local-only). ${syncMeta.reason ?? 'Run "howvibe sync enable" to enable cross-machine merge.'}`,
    ];
  }

  if (syncMeta.status === 'skipped') {
    return [
      `Sync: enabled but skipped this run. ${syncMeta.reason ?? 'Using local-only results for this report.'}`,
      `Current machine: ${syncMeta.machineName ?? '(unknown)'} [${syncMeta.machineId ?? 'unknown'}]`,
    ];
  }

  const lines = [
    `Sync: active. Merged ${syncMeta.mergedSnapshots} snapshots from ${syncMeta.mergedMachines} machine(s).`,
    syncMeta.gistId ? `Sync store: https://gist.github.com/${syncMeta.gistId}` : 'Sync store: (unknown gist)',
    `Merged machines: ${formatMachinesInline(syncMeta.machines)}`,
    `Uploaded snapshots this run: ${syncMeta.uploadedSnapshots}`,
  ];
  if (syncMeta.accountWideProviders.length > 0 && syncMeta.mergedMachines > 1) {
    lines.push(
      `Note: ${syncMeta.accountWideProviders.join(', ')} are account-wide providers and are not summed across machines.`,
    );
  }
  return lines;
}

function formatSyncStatusPlain(report: SyncStatusReport): string {
  const lines: string[] = ['field\tvalue'];
  lines.push(`enabled\t${report.enabled ? 'true' : 'false'}`);
  lines.push(`gist_id\t${report.gistId ?? ''}`);
  lines.push(`audit_url\t${report.auditUrl ?? ''}`);
  lines.push(`machine_name\t${report.machineName ?? ''}`);
  lines.push(`machine_id\t${report.machineId ?? ''}`);
  lines.push(`bootstrap_days\t${report.bootstrapDays ?? ''}`);
  lines.push(`last_synced_at\t${report.lastSyncedAt ?? ''}`);
  lines.push(`gh_installed\t${report.ghInstalled ? 'true' : 'false'}`);
  lines.push(`gh_token_available\t${report.ghTokenAvailable ? 'true' : 'false'}`);
  lines.push(`remote_accessible\t${report.remoteAccessible ? 'true' : 'false'}`);
  lines.push(`remote_snapshot_files\t${report.remoteSnapshotFiles}`);
  lines.push(`remote_machines\t${report.machines.length}`);
  for (const machine of report.machines) {
    lines.push(`remote_machine\t${formatMachineLabel(machine)}`);
  }
  for (const issue of report.issues) {
    lines.push(`issue\t${issue}`);
  }
  return lines.join('\n');
}

async function buildSyncStatusReport(config: HowvibeConfig): Promise<SyncStatusReport> {
  const report: SyncStatusReport = {
    enabled: false,
    gistId: config.sync?.gistId,
    auditUrl: config.sync?.gistId ? `https://gist.github.com/${config.sync.gistId}` : undefined,
    machineId: config.sync?.machineId,
    machineName: config.sync?.machineName,
    bootstrapDays: config.sync?.bootstrapDays,
    ghInstalled: false,
    ghTokenAvailable: false,
    remoteAccessible: false,
    remoteSnapshotFiles: 0,
    machines: [],
    issues: [],
  };

  if (!isSyncEnabled(config) || !config.sync?.gistId || !config.sync.machineId) {
    report.issues.push('Sync is not enabled. Run "howvibe sync enable".');
    return report;
  }

  report.enabled = true;
  const state = await loadSyncState();
  report.lastSyncedAt = state.lastSyncedAt;

  try {
    await ensureGhInstalled();
    report.ghInstalled = true;
  } catch (err) {
    report.issues.push(`GitHub CLI unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return report;
  }

  const token = await getGhToken();
  if (!token) {
    report.issues.push('GitHub auth token unavailable. Run "howvibe sync enable" again to re-authenticate.');
    return report;
  }
  report.ghTokenAvailable = true;

  try {
    const gist = await new GistClient(token).getGist(config.sync.gistId);
    report.remoteAccessible = true;

    const byMachine = new Map<string, Set<string>>();
    for (const filename of Object.keys(gist.files)) {
      const parsed = parseDaySnapshotFilename(filename);
      if (!parsed) continue;
      report.remoteSnapshotFiles += 1;
      const days = byMachine.get(parsed.machineId) ?? new Set<string>();
      days.add(parsed.date);
      byMachine.set(parsed.machineId, days);
    }

    report.machines = [...byMachine.entries()]
      .map(([id, days]) => ({ id, snapshotDays: days.size }))
      .sort((a, b) => {
        const byDays = (b.snapshotDays ?? 0) - (a.snapshotDays ?? 0);
        if (byDays !== 0) return byDays;
        return a.id.localeCompare(b.id);
      });
  } catch (err) {
    report.issues.push(`Failed to read sync gist: ${err instanceof Error ? err.message : String(err)}`);
  }

  return report;
}

async function resolveConfig(opts: GlobalOpts): Promise<HowvibeConfig> {
  const baseConfig = await loadConfig();
  return {
    ...baseConfig,
    source: getUsageSource(baseConfig, opts.source),
  };
}

async function runSummaryCommand(dateRange: DateRange, opts: GlobalOpts) {
  const currentVersion = readPackageVersion();
  const config = await resolveConfig(opts);
  const providers = getProviders(opts.provider, config.source ?? 'auto');
  const result = await withProgress(opts, 'collecting usage data', async () =>
    aggregateWithAutoSync(dateRange, providers, config, {}, { skipHistoryRepair: true }),
  );

  if (opts.json) {
    console.log(formatJSON(result.summary, result.syncMeta));
  } else if (opts.plain) {
    console.log(formatPlain(result.summary, result.syncMeta));
  } else {
    console.log(formatTable(result.summary));
  }
  emitSyncNotes(
    result.warnings,
    result.reminder,
    result.syncMeta,
    Boolean(opts.json || opts.plain),
    Boolean(opts.quiet),
  );
  await maybeNotifyUpdate(currentVersion, {
    quiet: Boolean(opts.quiet),
    machineReadable: Boolean(opts.json || opts.plain),
  });
}

async function runGroupedCommand(dateRange: DateRange, opts: GlobalOpts, mode: 'daily' | 'monthly') {
  const currentVersion = readPackageVersion();
  const config = await resolveConfig(opts);
  const providers = getProviders(opts.provider, config.source ?? 'auto');
  const result = await withProgress(opts, 'collecting usage data', async () =>
    aggregateWithAutoSync(
      dateRange,
      providers,
      config,
      {},
      { requireDaily: true, skipHistoryRepair: true },
    ),
  );
  const grouped = mode === 'daily'
    ? buildDailyGroupedSummary(dateRange, result.daily)
    : buildMonthlyGroupedSummary(dateRange, result.daily);

  if (opts.json) {
    console.log(formatGroupedJSON(grouped, result.syncMeta));
  } else if (opts.plain) {
    console.log(formatGroupedPlain(grouped, mode, result.syncMeta));
  } else {
    console.log(formatGroupedTable(grouped, mode === 'daily' ? 'Date' : 'Month'));
  }
  emitSyncNotes(
    result.warnings,
    result.reminder,
    result.syncMeta,
    Boolean(opts.json || opts.plain),
    Boolean(opts.quiet),
  );
  await maybeNotifyUpdate(currentVersion, {
    quiet: Boolean(opts.quiet),
    machineReadable: Boolean(opts.json || opts.plain),
  });
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('howvibe')
    .description('Track AI coding tool token usage and costs')
    .version(readPackageVersion())
    .addOption(new Option('--json', 'Output as JSON').conflicts('plain'))
    .addOption(new Option('--plain', 'Output as line-based plain text').conflicts('json'))
    .option('-q, --quiet', 'Suppress non-essential output')
    .option('--no-input', 'Disable interactive prompts/login flow')
    .option('--no-color', 'Disable colored output')
    .option('--provider <name>', 'Only show a specific provider (claude-code, codex, cursor, openrouter)')
    .option('--source <source>', 'Usage source (auto, web, cli, oauth)')
    .option('--since <date>', 'Start date (YYYY-MM-DD)')
    .option('--until <date>', 'End date (YYYY-MM-DD)');

  program.addHelpCommand('help [command]', 'Display help for command');
  program.showHelpAfterError('\nRun "howvibe --help" for usage.');
  program.addHelpText(
    'after',
    [
      '',
      'Examples:',
      '  howvibe today',
      '  howvibe --provider codex --since 2026-03-01 --until 2026-03-07',
      '  howvibe daily --since 2026-02-01 --until 2026-02-28 --json',
      '  howvibe monthly --plain',
      '  howvibe sync enable',
      '  howvibe sync status',
      '  howvibe --source web monthly',
      '',
    ].join('\n'),
  );

  // No subcommand and no options → show help
  program.action(async (opts: GlobalOpts) => {
    if (!opts.json && !opts.plain && !opts.provider && !opts.source && !opts.since && !opts.until) {
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

  const sync = program
    .command('sync')
    .description('Configure automatic cross-machine sync using your private GitHub Gist (no third-party storage)');

  sync
    .command('enable')
    .description('Authorize with GitHub and enable automatic sync')
    .action(async () => {
      const currentVersion = readPackageVersion();
      const opts = program.opts<GlobalOpts>();
      const quiet = Boolean(opts.quiet);
      const noInput = opts.input === false || !process.stdin.isTTY;
      const config = await loadConfig();
      const providers = getProviders();
      if (!quiet) {
        console.log('Starting sync setup. This may take a while on first run...');
        console.log('Security: sync data is stored only in your private GitHub Gist and local ~/.howvibe/sync cache.');
        console.log('Security: uploaded snapshots include daily token/cost aggregates only (no prompts/responses).');
      }
      const enableResult = await enableSync(
        { ...config, source: 'auto' },
        providers,
        {},
        {
          noInput,
          onProgress: quiet ? undefined : (message) => {
            console.log(`  - ${message}`);
          },
        },
      );
      await saveConfig({
        ...config,
        sync: enableResult.config.sync,
      });

      if (!quiet) {
        console.log('Sync enabled.');
        console.log(`Gist: ${enableResult.gistId}`);
        console.log(`Audit URL: ${enableResult.auditUrl}`);
        console.log(`Audit via CLI: gh gist view ${enableResult.gistId}`);
        console.log(`Machine Name: ${enableResult.machineName}`);
        console.log(`Machine ID: ${enableResult.machineId}`);
        console.log(`Initial backfill: last ${enableResult.bootstrapDays} days`);
      }

      for (const warning of enableResult.warnings) {
        console.error(`Sync warning: ${warning}`);
      }

      await maybeNotifyUpdate(currentVersion, {
        quiet,
      });
    });

  sync
    .command('disable')
    .description('Disable automatic sync')
    .action(async () => {
      const currentVersion = readPackageVersion();
      const opts = program.opts<GlobalOpts>();
      const config = await loadConfig();
      const next = disableSync(config);
      await saveConfig(next);
      if (!opts.quiet) {
        console.log('Sync disabled.');
      }

      await maybeNotifyUpdate(currentVersion, {
        quiet: Boolean(opts.quiet),
      });
    });

  sync
    .command('status')
    .description('Show current sync status and remote machine coverage')
    .action(async () => {
      const currentVersion = readPackageVersion();
      const opts = program.opts<GlobalOpts>();
      const report = await buildSyncStatusReport(await loadConfig());

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else if (opts.plain) {
        console.log(formatSyncStatusPlain(report));
      } else {
        console.log('');
        if (!report.enabled) {
          console.log('  Sync: disabled (local-only).');
          console.log('  Run: howvibe sync enable');
          if (report.issues.length > 0) {
            console.log(`  Detail: ${report.issues[0]}`);
          }
        } else {
          console.log('  Sync: enabled');
          console.log(`  Gist: ${report.gistId ?? '(unknown)'}`);
          console.log(`  Audit URL: ${report.auditUrl ?? '(unknown)'}`);
          console.log(`  Machine Name: ${report.machineName ?? '(unknown)'}`);
          console.log(`  Machine ID: ${report.machineId ?? '(unknown)'}`);
          console.log(`  Backfill Window: last ${report.bootstrapDays ?? '(unknown)'} days`);
          console.log(`  Last Synced At: ${report.lastSyncedAt ?? '(never)'}`);
          console.log(`  GitHub CLI: ${report.ghInstalled ? 'ok' : 'missing'}`);
          console.log(`  GitHub Token: ${report.ghTokenAvailable ? 'available' : 'missing'}`);
          console.log(`  Remote Reachable: ${report.remoteAccessible ? 'yes' : 'no'}`);
          if (report.remoteAccessible) {
            console.log(`  Remote Snapshot Files: ${report.remoteSnapshotFiles}`);
            console.log(`  Remote Machines: ${report.machines.length}`);
            for (const machine of report.machines) {
              console.log(`    - ${formatMachineLabel(machine)}`);
            }
          }
        }
        if (report.enabled && report.issues.length > 0) {
          for (const issue of report.issues) {
            console.log(`  Warning: ${issue}`);
          }
        }
        console.log('');
      }

      await maybeNotifyUpdate(currentVersion, {
        quiet: Boolean(opts.quiet),
        machineReadable: Boolean(opts.json || opts.plain),
      });
    });

  return program;
}
