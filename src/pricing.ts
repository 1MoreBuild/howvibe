// Prices per million tokens (USD)
type ModelPricing = {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
};

const PRICING: Record<string, ModelPricing> = {
  // Claude models
  'claude-opus-4-6': { input: 15, output: 75, cacheRead: 1.5, cacheCreate: 18.75 },
  'claude-opus-4': { input: 15, output: 75, cacheRead: 1.5, cacheCreate: 18.75 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheCreate: 3.75 },
  'claude-sonnet-4': { input: 3, output: 15, cacheRead: 0.3, cacheCreate: 3.75 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3, cacheCreate: 3.75 },
  'claude-haiku-4-5': { input: 0.8, output: 4, cacheRead: 0.08, cacheCreate: 1 },
  'claude-3-5-sonnet': { input: 3, output: 15, cacheRead: 0.3, cacheCreate: 3.75 },
  'claude-3-5-haiku': { input: 0.8, output: 4, cacheRead: 0.08, cacheCreate: 1 },

  // OpenAI models
  'gpt-5': { input: 1.25, output: 10, cacheRead: 0.125, cacheCreate: 0 },
  'gpt-5.2': { input: 1.75, output: 14, cacheRead: 0.175, cacheCreate: 0 },
  'gpt-4.1': { input: 2, output: 8, cacheRead: 0.5, cacheCreate: 0 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6, cacheRead: 0.1, cacheCreate: 0 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4, cacheRead: 0.025, cacheCreate: 0 },
  'gpt-4o': { input: 2.5, output: 10, cacheRead: 1.25, cacheCreate: 0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6, cacheRead: 0.075, cacheCreate: 0 },
  'o3': { input: 2, output: 8, cacheRead: 0.5, cacheCreate: 0 },
  'o3-mini': { input: 1.1, output: 4.4, cacheRead: 0.275, cacheCreate: 0 },
  'o4-mini': { input: 1.1, output: 4.4, cacheRead: 0.275, cacheCreate: 0 },
  'codex-mini': { input: 0.15, output: 0.6, cacheRead: 0.0375, cacheCreate: 0 },
};

/**
 * Normalize a model name by stripping date suffixes like -20250514
 */
function normalizeModelName(model: string): string {
  // Strip date suffix (e.g., -20250514)
  return model.replace(/-\d{8}$/, '');
}

export function getModelPricing(model: string): ModelPricing | undefined {
  const normalized = normalizeModelName(model);

  // Exact match first
  if (PRICING[normalized]) return PRICING[normalized];

  // Try fuzzy match: find the longest prefix match
  const candidates = Object.keys(PRICING).filter((key) => normalized.startsWith(key));
  if (candidates.length > 0) {
    // Pick the longest match
    candidates.sort((a, b) => b.length - a.length);
    return PRICING[candidates[0]];
  }

  return undefined;
}

const warnedModels = new Set<string>();

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreationTokens: number,
): number {
  const pricing = getModelPricing(model);
  if (!pricing) {
    if (!warnedModels.has(model) && model !== 'unknown' && model !== '<synthetic>') {
      warnedModels.add(model);
      process.stderr.write(`Warning: unknown model "${model}" — cost will be $0.00\n`);
    }
    return 0;
  }

  return (
    (inputTokens * pricing.input) / 1_000_000 +
    (outputTokens * pricing.output) / 1_000_000 +
    (cacheReadTokens * pricing.cacheRead) / 1_000_000 +
    (cacheCreationTokens * pricing.cacheCreate) / 1_000_000
  );
}
