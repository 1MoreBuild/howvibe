import type { UsageProvider } from './interface.js';
import { ClaudeCodeProvider } from './claude-code.js';
import { CodexProvider } from './codex.js';
import { CursorProvider } from './cursor.js';
import { OpenRouterProvider } from './openrouter.js';

const DEFAULT_PROVIDERS: Record<string, () => UsageProvider> = {
  'claude-code': () => new ClaudeCodeProvider(),
  codex: () => new CodexProvider(),
  cursor: () => new CursorProvider(),
  openrouter: () => new OpenRouterProvider(),
};

export function getProviders(filter?: string): UsageProvider[] {
  if (filter) {
    const factory = DEFAULT_PROVIDERS[filter];
    if (!factory) {
      throw new Error(`Unknown provider: ${filter}. Available: ${Object.keys(DEFAULT_PROVIDERS).join(', ')}`);
    }
    return [factory()];
  }
  return Object.values(DEFAULT_PROVIDERS).map((factory) => factory());
}
