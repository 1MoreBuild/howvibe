import type { GroupedUsageSummary, SyncRuntimeMeta, UsageSummary } from '../types.js';

type PlainValue = string | number | null | undefined;

function sanitizeField(value: PlainValue): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[\t\r\n]/g, ' ');
}

function tsvRow(values: PlainValue[]): string {
  return values.map((value) => sanitizeField(value)).join('\t');
}

function formatCost(value: number): string {
  return value.toFixed(6);
}

export function formatPlain(summary: UsageSummary, syncMeta?: SyncRuntimeMeta): string {
  const lines: string[] = [];
  const since = summary.period.since;
  const until = summary.period.until;

  lines.push(tsvRow([
    'record',
    'since',
    'until',
    'provider',
    'model',
    'input_tokens',
    'output_tokens',
    'reasoning_tokens',
    'cache_read_tokens',
    'cache_creation_tokens',
    'total_tokens',
    'cost_usd',
    'error',
  ]));

  let grandInput = 0;
  let grandOutput = 0;
  let grandReasoning = 0;
  let grandCacheRead = 0;
  let grandCacheCreation = 0;

  for (const provider of summary.providers) {
    let providerInput = 0;
    let providerOutput = 0;
    let providerReasoning = 0;
    let providerCacheRead = 0;
    let providerCacheCreation = 0;
    let providerCost = 0;

    for (const model of provider.models) {
      const totalTokens =
        model.inputTokens +
        model.outputTokens +
        model.reasoningTokens +
        model.cacheReadTokens +
        model.cacheCreationTokens;

      lines.push(tsvRow([
        'model',
        since,
        until,
        provider.provider,
        model.model,
        model.inputTokens,
        model.outputTokens,
        model.reasoningTokens,
        model.cacheReadTokens,
        model.cacheCreationTokens,
        totalTokens,
        formatCost(model.costUSD),
        '',
      ]));

      providerInput += model.inputTokens;
      providerOutput += model.outputTokens;
      providerReasoning += model.reasoningTokens;
      providerCacheRead += model.cacheReadTokens;
      providerCacheCreation += model.cacheCreationTokens;
      providerCost += model.costUSD;
    }

    const providerTotal =
      providerInput +
      providerOutput +
      providerReasoning +
      providerCacheRead +
      providerCacheCreation;

    lines.push(tsvRow([
      'provider_total',
      since,
      until,
      provider.provider,
      'all',
      providerInput,
      providerOutput,
      providerReasoning,
      providerCacheRead,
      providerCacheCreation,
      providerTotal,
      formatCost(providerCost),
      '',
    ]));

    for (const error of provider.errors ?? []) {
      lines.push(tsvRow([
        'warning',
        since,
        until,
        provider.provider,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        error,
      ]));
    }

    grandInput += providerInput;
    grandOutput += providerOutput;
    grandReasoning += providerReasoning;
    grandCacheRead += providerCacheRead;
    grandCacheCreation += providerCacheCreation;
  }

  const grandTotal = grandInput + grandOutput + grandReasoning + grandCacheRead + grandCacheCreation;
  lines.push(tsvRow([
    'grand_total',
    since,
    until,
    'all',
    'all',
    grandInput,
    grandOutput,
    grandReasoning,
    grandCacheRead,
    grandCacheCreation,
    grandTotal,
    formatCost(summary.totalCostUSD),
    '',
  ]));

  if (syncMeta) {
    lines.push(tsvRow([
      'sync_meta',
      since,
      until,
      'all',
      syncMeta.status,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      JSON.stringify(syncMeta),
    ]));
  }

  return lines.join('\n');
}

export function formatGroupedPlain(
  summary: GroupedUsageSummary,
  period: 'daily' | 'monthly',
  syncMeta?: SyncRuntimeMeta,
): string {
  const lines: string[] = [];

  lines.push(tsvRow([
    'record',
    'period',
    'label',
    'input_tokens',
    'output_tokens',
    'reasoning_tokens',
    'cache_read_tokens',
    'cache_creation_tokens',
    'total_tokens',
    'cost_usd',
    'error',
  ]));

  let totalInput = 0;
  let totalOutput = 0;
  let totalReasoning = 0;
  let totalCacheRead = 0;
  let totalCacheCreation = 0;
  let totalCost = 0;

  for (const row of summary.rows) {
    const totalTokens =
      row.inputTokens +
      row.outputTokens +
      row.reasoningTokens +
      row.cacheReadTokens +
      row.cacheCreationTokens;

    lines.push(tsvRow([
      'row',
      period,
      row.label,
      row.inputTokens,
      row.outputTokens,
      row.reasoningTokens,
      row.cacheReadTokens,
      row.cacheCreationTokens,
      totalTokens,
      formatCost(row.costUSD),
      '',
    ]));

    totalInput += row.inputTokens;
    totalOutput += row.outputTokens;
    totalReasoning += row.reasoningTokens;
    totalCacheRead += row.cacheReadTokens;
    totalCacheCreation += row.cacheCreationTokens;
    totalCost += row.costUSD;
  }

  for (const error of summary.errors) {
    lines.push(tsvRow([
      'warning',
      period,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      error,
    ]));
  }

  const grandTotal = totalInput + totalOutput + totalReasoning + totalCacheRead + totalCacheCreation;
  lines.push(tsvRow([
    'total',
    period,
    'all',
    totalInput,
    totalOutput,
    totalReasoning,
    totalCacheRead,
    totalCacheCreation,
    grandTotal,
    formatCost(totalCost),
    '',
  ]));

  if (syncMeta) {
    lines.push(tsvRow([
      'sync_meta',
      period,
      syncMeta.status,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      JSON.stringify(syncMeta),
    ]));
  }

  return lines.join('\n');
}
