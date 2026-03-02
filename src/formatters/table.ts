import Table from 'cli-table3';
import pc from 'picocolors';
import type { UsageSummary, ProviderUsageResult } from '../types.js';
import { formatNumber, formatCost } from '../utils/tokens.js';

const PROVIDER_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  openrouter: 'OpenRouter',
};

function renderTokenTable(result: ProviderUsageResult): string {
  const label = PROVIDER_LABELS[result.provider] ?? result.provider;
  const lines: string[] = [];

  lines.push(`  ${pc.bold(pc.cyan(label))}`);

  if (result.models.length === 0) {
    lines.push(`  ${pc.dim('No usage data')}`);
    return lines.join('\n');
  }

  // Detect which optional columns have data
  const hasCache = result.models.some((m) => m.cacheReadTokens > 0 || m.cacheCreationTokens > 0);
  const hasReasoning = result.models.some((m) => m.reasoningTokens > 0);

  // Build dynamic columns: Model, Input, Output, [Reasoning], [Cache R], [Cache W], Cost
  const head: string[] = ['Model', 'Input', 'Output'];
  const aligns: string[] = ['left', 'right', 'right'];
  if (hasReasoning) { head.push('Reasoning'); aligns.push('right'); }
  if (hasCache) { head.push('Cache R', 'Cache W'); aligns.push('right', 'right'); }
  head.push(pc.dim('Cost'));
  aligns.push('right');

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

  for (const m of result.models) {
    const row: string[] = [m.model, formatNumber(m.inputTokens), formatNumber(m.outputTokens)];
    if (hasReasoning) row.push(formatNumber(m.reasoningTokens));
    if (hasCache) row.push(formatNumber(m.cacheReadTokens), formatNumber(m.cacheCreationTokens));
    row.push(pc.dim(formatCost(m.costUSD)));
    table.push(row);

    totalInput += m.inputTokens;
    totalOutput += m.outputTokens;
    totalReasoning += m.reasoningTokens;
    totalCacheRead += m.cacheReadTokens;
    totalCacheCreate += m.cacheCreationTokens;
    totalCost += m.costUSD;
  }

  if (result.models.length > 1) {
    const row: string[] = [pc.bold('Subtotal'), pc.bold(formatNumber(totalInput)), pc.bold(formatNumber(totalOutput))];
    if (hasReasoning) row.push(pc.bold(formatNumber(totalReasoning)));
    if (hasCache) row.push(pc.bold(formatNumber(totalCacheRead)), pc.bold(formatNumber(totalCacheCreate)));
    row.push(pc.dim(formatCost(totalCost)));
    table.push(row);
  }

  const tableStr = table.toString();
  lines.push(tableStr.split('\n').map((l) => `  ${l}`).join('\n'));

  return lines.join('\n');
}

export function formatTable(summary: UsageSummary): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(`  ${pc.bold('howvibe')} — ${summary.period.since === summary.period.until ? summary.period.since : `${summary.period.since} to ${summary.period.until}`} Usage`);
  lines.push('');

  let grandInput = 0, grandOutput = 0, grandReasoning = 0;
  let grandCacheRead = 0, grandCacheWrite = 0;

  for (const provider of summary.providers) {
    if (provider.errors?.length && provider.models.length === 0) {
      const label = PROVIDER_LABELS[provider.provider] ?? provider.provider;
      lines.push(`  ${pc.bold(pc.cyan(label))}  ${pc.yellow(provider.errors[0])}`);
    } else {
      lines.push(renderTokenTable(provider));
      for (const m of provider.models) {
        grandInput += m.inputTokens;
        grandOutput += m.outputTokens;
        grandReasoning += m.reasoningTokens;
        grandCacheRead += m.cacheReadTokens;
        grandCacheWrite += m.cacheCreationTokens;
      }
    }
    lines.push('');
  }

  const grandTotal = grandInput + grandOutput + grandReasoning + grandCacheRead + grandCacheWrite;

  // Build breakdown string dynamically
  const parts = [`in: ${formatNumber(grandInput)}`, `out: ${formatNumber(grandOutput)}`];
  if (grandReasoning > 0) parts.push(`reasoning: ${formatNumber(grandReasoning)}`);
  if (grandCacheRead > 0) parts.push(`cache-r: ${formatNumber(grandCacheRead)}`);
  if (grandCacheWrite > 0) parts.push(`cache-w: ${formatNumber(grandCacheWrite)}`);

  lines.push(`  ${'═'.repeat(60)}`);
  lines.push(`  ${pc.bold('Total Tokens')}: ${pc.green(formatNumber(grandTotal))}  ${pc.dim(`(${parts.join('  ')})`)}`);
  lines.push(`  ${pc.bold('Total Cost')}:   ${pc.dim(formatCost(summary.totalCostUSD))}`);
  lines.push('');

  return lines.join('\n');
}
