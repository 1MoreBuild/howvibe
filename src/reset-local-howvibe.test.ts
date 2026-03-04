import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const RESET_SCRIPT = join(process.cwd(), 'scripts', 'reset-local-howvibe.sh');

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

describe('reset-local-howvibe script', () => {
  let tempHome = '';

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'howvibe-reset-test-'));
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it('removes a safe target inside ~/.howvibe', async () => {
    const root = join(tempHome, '.howvibe');
    const nested = join(root, 'sync', 'cache');
    await mkdir(nested, { recursive: true });
    await writeFile(join(nested, 'snapshot.json'), '{}');

    const run = spawnSync('bash', [RESET_SCRIPT, '--yes'], {
      env: { ...process.env, HOME: tempHome, HOWVIBE_DIR: root },
      encoding: 'utf-8',
    });

    expect(run.status).toBe(0);
    expect(await pathExists(root)).toBe(false);
  });

  it('refuses to delete paths outside ~/.howvibe', async () => {
    const keepDir = join(tempHome, 'keep-me');
    await mkdir(keepDir, { recursive: true });
    await writeFile(join(keepDir, 'note.txt'), 'keep');

    const unsafe = join(tempHome, '.howvibe', '..');
    const run = spawnSync('bash', [RESET_SCRIPT, '--yes'], {
      env: { ...process.env, HOME: tempHome, HOWVIBE_DIR: unsafe },
      encoding: 'utf-8',
    });

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('Refusing to delete');
    expect(await pathExists(keepDir)).toBe(true);
  });
});
