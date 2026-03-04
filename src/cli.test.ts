import { describe, expect, it } from 'vitest';
import { createProgram } from './cli.js';

describe('cli commands', () => {
  it('exposes sync enable/disable and hides snapshot/merge commands', () => {
    const program = createProgram();
    const topLevel = program.commands.map((command) => command.name());
    expect(topLevel).toContain('sync');
    expect(topLevel).not.toContain('snapshot');
    expect(topLevel).not.toContain('merge');

    const sync = program.commands.find((command) => command.name() === 'sync');
    expect(sync).toBeTruthy();
    const syncChildren = sync!.commands.map((command) => command.name());
    expect(syncChildren).toContain('enable');
    expect(syncChildren).toContain('disable');
  });
});
