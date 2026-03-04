import type { UsageProvider } from './interface.js';
import { ClaudeCodeProvider } from './claude-code.js';
import { CodexProvider } from './codex.js';
import { CursorProvider } from './cursor.js';
import { OpenRouterProvider } from './openrouter.js';
import type { UsageSource } from '../source.js';

type ProviderDescriptor = {
  create: () => UsageProvider;
  supportedSources: UsageSource[];
};

const DEFAULT_PROVIDERS: Record<string, ProviderDescriptor> = {
  'claude-code': {
    create: () => new ClaudeCodeProvider(),
    supportedSources: ['cli'],
  },
  codex: {
    create: () => new CodexProvider(),
    supportedSources: ['cli'],
  },
  cursor: {
    create: () => new CursorProvider(),
    supportedSources: ['web', 'oauth'],
  },
  openrouter: {
    create: () => new OpenRouterProvider(),
    supportedSources: ['web', 'oauth'],
  },
};

function supportsSource(provider: ProviderDescriptor, source: UsageSource): boolean {
  if (source === 'auto') return true;
  return provider.supportedSources.includes(source);
}

export function getProviders(filter?: string, source: UsageSource = 'auto'): UsageProvider[] {
  if (filter) {
    const descriptor = DEFAULT_PROVIDERS[filter];
    if (!descriptor) {
      throw new Error(`Unknown provider: ${filter}. Available: ${Object.keys(DEFAULT_PROVIDERS).join(', ')}`);
    }
    if (!supportsSource(descriptor, source)) {
      throw new Error(
        `Provider "${filter}" does not support source "${source}". ` +
        `Supported sources: auto, ${descriptor.supportedSources.join(', ')}`,
      );
    }
    return [descriptor.create()];
  }
  return Object.values(DEFAULT_PROVIDERS)
    .filter((descriptor) => supportsSource(descriptor, source))
    .map((descriptor) => descriptor.create());
}
