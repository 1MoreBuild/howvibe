import { describe, expect, it } from 'vitest';
import { getProviders } from './registry.js';

describe('provider registry', () => {
  it('returns only local providers for cli source', () => {
    const names = getProviders(undefined, 'cli').map((provider) => provider.name).sort();
    expect(names).toEqual(['claude-code', 'codex']);
  });

  it('returns only remote providers for web source', () => {
    const names = getProviders(undefined, 'web').map((provider) => provider.name).sort();
    expect(names).toEqual(['cursor', 'openrouter']);
  });

  it('returns all providers for auto source', () => {
    const names = getProviders(undefined, 'auto').map((provider) => provider.name).sort();
    expect(names).toEqual(['claude-code', 'codex', 'cursor', 'openrouter']);
  });

  it('throws when provider does not support selected source', () => {
    expect(() => getProviders('cursor', 'cli')).toThrow('does not support source');
  });
});
