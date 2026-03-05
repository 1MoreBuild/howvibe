import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getHowvibeDir } from './config.js';
import { maybeNotifyUpdate } from './update-notifier.js';

describe('update notifier', () => {
  const originalHome = process.env.HOME;
  let tempHome = '';

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'howvibe-update-test-'));
    process.env.HOME = tempHome;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await rm(tempHome, { recursive: true, force: true });
  });

  it('checks npm latest version once and reuses cache within interval', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ version: '0.2.0' }),
    } as unknown as Response);

    await maybeNotifyUpdate('0.1.0');
    await maybeNotifyUpdate('0.1.0');

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const cachePath = join(getHowvibeDir(), 'update-check.json');
    const cacheRaw = await readFile(cachePath, 'utf-8');
    const cache = JSON.parse(cacheRaw) as { latestVersion?: string; lastCheckedAt?: string };
    expect(cache.latestVersion).toBe('0.2.0');
    expect(typeof cache.lastCheckedAt).toBe('string');
  });

  it('skips update check in quiet mode', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await maybeNotifyUpdate('0.1.0', { quiet: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats malformed cache shape as empty values', async () => {
    const howvibeDir = getHowvibeDir();
    await mkdir(howvibeDir, { recursive: true });
    const cachePath = join(howvibeDir, 'update-check.json');
    await writeFile(
      cachePath,
      JSON.stringify({
        latestVersion: 1,
        lastCheckedAt: '2099-01-01T00:00:00.000Z',
        notifiedVersion: '0.3.0',
      }),
      'utf-8',
    );

    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await expect(maybeNotifyUpdate('0.1.0', { machineReadable: true })).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();

    const cacheRaw = await readFile(cachePath, 'utf-8');
    const cache = JSON.parse(cacheRaw) as {
      latestVersion?: string;
      lastCheckedAt?: string;
      notifiedVersion?: string;
    };
    expect(cache.latestVersion).toBeUndefined();
    expect(cache.lastCheckedAt).toBe('2099-01-01T00:00:00.000Z');
    expect(cache.notifiedVersion).toBeUndefined();
  });
});
