import Table from 'cli-table3';
import pc from 'picocolors';
import type { GroupedUsageSummary, SyncRuntimeMeta } from '../types.js';
import { formatNumber, formatCost } from '../utils/tokens.js';

export function formatGroupedTable(summary: GroupedUsageSummary, periodLabel = 'Date'): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(`  ${pc.bold('howvibe')} — ${summary.title}`);
  lines.push('');

  if (summary.errors.length > 0) {
    for (const err of summary.errors) {
      lines.push(`  ${pc.yellow(err)}`);
    }
    lines.push('');
  }

  if (summary.rows.length === 0) {
    lines.push(`  ${pc.dim('No usage data')}`);
    lines.push('');
    return lines.join('\n');
  }

  const hasCache = summary.rows.some((r) => r.cacheReadTokens > 0 || r.cacheCreationTokens > 0);
  const hasReasoning = summary.rows.some((r) => r.reasoningTokens > 0);

  const head: string[] = [periodLabel, 'Input', 'Output'];
  const aligns: string[] = ['left', 'right', 'right'];
  if (hasReasoning) { head.push('Reasoning'); aligns.push('right'); }
  if (hasCache) { head.push('Cache R', 'Cache W'); aligns.push('right', 'right'); }
  head.push('Total', pc.dim('Cost'));
  aligns.push('right', 'right');

  const table = new Table({
    head,
    colAligns: aligns as ('left' | 'right')[],
    style: { head: [], border: [], compact: true },
    chars: {
      top: '─', 'top-mid': '┬', 'top-left': '┌', 'top-right': '┐',
      bottom: '─', 'bottom-mid': '┴', 'bottom-left': '└', 'bottom-right': '┘',
      left: '│', 'left-mid': '├', mid: '─', 'mid-mid': '┼',
      right: '│', 'right-mid': '┤', middle: '│',
    },
  });

  let totalInput = 0, totalOutput = 0, totalReasoning = 0;
  let totalCacheRead = 0, totalCacheCreate = 0, totalCost = 0;

  for (const r of summary.rows) {
    const rowTotal = r.inputTokens + r.outputTokens + r.reasoningTokens + r.cacheReadTokens + r.cacheCreationTokens;
    const row: string[] = [r.label, formatNumber(r.inputTokens), formatNumber(r.outputTokens)];
    if (hasReasoning) row.push(formatNumber(r.reasoningTokens));
    if (hasCache) row.push(formatNumber(r.cacheReadTokens), formatNumber(r.cacheCreationTokens));
    row.push(formatNumber(rowTotal), pc.dim(formatCost(r.costUSD)));
    table.push(row);

    totalInput += r.inputTokens;
    totalOutput += r.outputTokens;
    totalReasoning += r.reasoningTokens;
    totalCacheRead += r.cacheReadTokens;
    totalCacheCreate += r.cacheCreationTokens;
    totalCost += r.costUSD;
  }

  if (summary.rows.length > 1) {
    const grandTotal = totalInput + totalOutput + totalReasoning + totalCacheRead + totalCacheCreate;
    const row: string[] = [pc.bold('Total'), pc.bold(formatNumber(totalInput)), pc.bold(formatNumber(totalOutput))];
    if (hasReasoning) row.push(pc.bold(formatNumber(totalReasoning)));
    if (hasCache) row.push(pc.bold(formatNumber(totalCacheRead)), pc.bold(formatNumber(totalCacheCreate)));
    row.push(pc.bold(formatNumber(grandTotal)), pc.dim(formatCost(totalCost)));
    table.push(row);
  }

  const tableStr = table.toString();
  lines.push(tableStr.split('\n').map((l) => `  ${l}`).join('\n'));

  // Average line
  if (summary.rows.length > 1) {
    const count = summary.rows.length;
    const grandTotal = totalInput + totalOutput + totalReasoning + totalCacheRead + totalCacheCreate;
    const avgTokens = Math.round(grandTotal / count);
    const avgCost = totalCost / count;
    const isMonthly = periodLabel === 'Month';
    const unit = isMonthly ? 'month' : 'day';
    const label = isMonthly ? 'Monthly Avg' : 'Daily Avg';
    lines.push('');
    lines.push(`  ${pc.bold(label)}: ${pc.green(formatNumber(avgTokens))} tokens  ${pc.dim(formatCost(avgCost) + '/' + unit)}  ${pc.dim(`(${count} ${unit}s with usage)`)}`);
  }

  lines.push('');
  return lines.join('\n');
}

export function formatGroupedJSON(summary: GroupedUsageSummary, syncMeta?: SyncRuntimeMeta): string {
  return JSON.stringify(
    {
      title: summary.title,
      rows: summary.rows,
      errors: summary.errors.length > 0 ? summary.errors : undefined,
      sync_meta: syncMeta,
    },
    null,
    2,
  );
}
