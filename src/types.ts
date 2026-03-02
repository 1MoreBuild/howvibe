import { z } from 'zod';

export const ProviderNameSchema = z.enum(['claude-code', 'codex', 'cursor', 'openrouter']);
export type ProviderName = z.infer<typeof ProviderNameSchema>;

export type ModelUsageRecord = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costUSD: number;
};

export type ProviderUsageResult = {
  provider: ProviderName;
  models: ModelUsageRecord[];
  totalCostUSD: number;
  dataSource: 'local' | 'api';
  errors?: string[];
};

export type UsageSummary = {
  period: { since: string; until: string };
  providers: ProviderUsageResult[];
  totalCostUSD: number;
};

export type DateRange = {
  since: Date;
  until: Date;
};

// Claude Code JSONL schema
export const ClaudeUsageLineSchema = z.object({
  timestamp: z.string(),
  sessionId: z.string().optional(),
  message: z.object({
    usage: z.object({
      input_tokens: z.number(),
      output_tokens: z.number(),
      cache_creation_input_tokens: z.number().optional(),
      cache_read_input_tokens: z.number().optional(),
    }),
    model: z.string().optional(),
    id: z.string().optional(),
  }),
  costUSD: z.number().optional(),
  requestId: z.string().optional(),
});
export type ClaudeUsageLine = z.infer<typeof ClaudeUsageLineSchema>;

// Codex JSONL schemas
export const CodexEntrySchema = z.object({
  timestamp: z.string(),
  type: z.string(),
  payload: z.unknown(),
});
export type CodexEntry = z.infer<typeof CodexEntrySchema>;

export const CodexTokenCountPayloadSchema = z.object({
  type: z.literal('token_count'),
  info: z.object({
    total_token_usage: z.object({
      input_tokens: z.number(),
      cached_input_tokens: z.number().optional(),
      output_tokens: z.number(),
      reasoning_output_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    }).optional(),
    last_token_usage: z.object({
      input_tokens: z.number(),
      cached_input_tokens: z.number().optional(),
      output_tokens: z.number(),
      reasoning_output_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    }).optional(),
    model: z.string().optional(),
  }).optional(),
  model: z.string().optional(),
});

export const CodexTurnContextPayloadSchema = z.object({
  model: z.string().optional(),
});

// OpenRouter API response
export type OpenRouterCreditsResponse = {
  data: {
    totalCredits: number;  // USD
    totalUsage: number;    // USD
  };
};
