import { describe, expect, it } from 'vitest';
import { createProgram } from './cli.js';

describe('cli commands', () => {
  it('exposes sync commands and hides removed snapshot/merge commands', () => {
    const program = createProgram();
    const topLevel = program.commands.map((command) => command.name());
    expect(topLevel).toContain('sync');
    expect(topLevel).not.toContain('snapshot');
    expect(topLevel).not.toContain('merge');

    const sync = program.commands.find((command) => command.name() === 'sync');
    expect(sync).toBeTruthy();
    expect(sync?.description()).toContain('no third-party storage');
    const syncChildren = sync!.commands.map((command) => command.name());
    expect(syncChildren).toContain('enable');
    expect(syncChildren).toContain('disable');
    expect(syncChildren).toContain('status');
  });

  it('supports guideline-aligned global flags', () => {
    const program = createProgram();
    const flags = program.options.flatMap((option) => [option.short, option.long].filter(Boolean));

    expect(flags).toContain('--json');
    expect(flags).toContain('-q');
    expect(flags).toContain('--quiet');
    expect(flags).toContain('--no-input');
    expect(flags).toContain('--no-color');
    expect(flags).toContain('--plain');
  });

  it('maps --no-input to the input option key', () => {
    const program = createProgram();
    const option = program.options.find((candidate) => candidate.long === '--no-input');
    expect(option).toBeTruthy();
    expect(option?.attributeName()).toBe('input');
  });
});
