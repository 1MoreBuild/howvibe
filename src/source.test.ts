import { describe, expect, it } from 'vitest';
import { parseUsageSource, resolveUsageSource } from './source.js';

describe('source parsing', () => {
  it('parses known source names case-insensitively', () => {
    expect(parseUsageSource('AUTO')).toBe('auto');
    expect(parseUsageSource('Cli')).toBe('cli');
    expect(parseUsageSource('web')).toBe('web');
    expect(parseUsageSource('oauth')).toBe('oauth');
  });

  it('uses auto as default', () => {
    expect(resolveUsageSource()).toBe('auto');
    expect(resolveUsageSource('')).toBe('auto');
  });

  it('throws for unknown values', () => {
    expect(() => parseUsageSource('remote')).toThrow('Unknown source');
  });
});
