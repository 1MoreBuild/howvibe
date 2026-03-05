import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getHowvibeDir } from './config.js';

type UpdateCache = {
  lastCheckedAt?: string;
  latestVersion?: string;
  notifiedVersion?: string;
};

type NotifyOptions = {
  quiet?: boolean;
  machineReadable?: boolean;
};

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 1500;
const UPDATE_CACHE_FILE = 'update-check.json';
const PACKAGE_NAME = 'howvibe';
const REGISTRY_LATEST_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;

function getUpdateCachePath(): string {
  return join(getHowvibeDir(), UPDATE_CACHE_FILE);
}

function normalizeCache(raw: unknown): UpdateCache {
  if (!raw || typeof raw !== 'object') return {};
  const obj = raw as Record<string, unknown>;
  const cache: UpdateCache = {};
  if (typeof obj['lastCheckedAt'] === 'string') cache.lastCheckedAt = obj['lastCheckedAt'];
  if (typeof obj['latestVersion'] === 'string') cache.latestVersion = obj['latestVersion'];
  if (typeof obj['notifiedVersion'] === 'string') cache.notifiedVersion = obj['notifiedVersion'];
  return cache;
}

function parseSemver(version: unknown): [number, number, number] | null {
  if (typeof version !== 'string') return null;
  const main = version.trim().replace(/^v/, '').split('-', 1)[0] ?? '';
  const parts = main.split('.');
  if (parts.length !== 3) return null;
  const major = Number(parts[0]);
  const minor = Number(parts[1]);
  const patch = Number(parts[2]);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch)) {
    return null;
  }
  return [major, minor, patch];
}

function isNewerVersion(latest: string, current: string): boolean {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  if (!a || !b) return false;
  if (a[0] !== b[0]) return a[0] > b[0];
  if (a[1] !== b[1]) return a[1] > b[1];
  return a[2] > b[2];
}

async function loadCache(): Promise<UpdateCache> {
  try {
    const raw = await readFile(getUpdateCachePath(), 'utf-8');
    return normalizeCache(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
}

async function saveCache(cache: UpdateCache): Promise<void> {
  try {
    await mkdir(getHowvibeDir(), { recursive: true, mode: 0o700 });
    await writeFile(getUpdateCachePath(), `${JSON.stringify(cache, null, 2)}\n`, {
      encoding: 'utf-8',
      mode: 0o600,
    });
  } catch {
    // Best effort only.
  }
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(REGISTRY_LATEST_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    if (typeof body.version !== 'string' || body.version.length === 0) return null;
    return body.version;
  } catch {
    return null;
  }
}

function shouldRefresh(lastCheckedAt: string | undefined, nowMs: number): boolean {
  if (!lastCheckedAt) return true;
  const ts = Date.parse(lastCheckedAt);
  if (Number.isNaN(ts)) return true;
  return nowMs - ts >= CHECK_INTERVAL_MS;
}

export async function maybeNotifyUpdate(currentVersion: string, options: NotifyOptions = {}): Promise<void> {
  if (options.quiet) return;

  const nowMs = Date.now();
  const cache = await loadCache();
  let changed = false;
  let latestVersion = cache.latestVersion;

  if (shouldRefresh(cache.lastCheckedAt, nowMs)) {
    cache.lastCheckedAt = new Date(nowMs).toISOString();
    changed = true;
    const fetched = await fetchLatestVersion();
    if (fetched) {
      cache.latestVersion = fetched;
      latestVersion = fetched;
      changed = true;
    }
  }

  const hasUpdate = latestVersion ? isNewerVersion(latestVersion, currentVersion) : false;
  if (!hasUpdate) {
    if (cache.notifiedVersion) {
      cache.notifiedVersion = undefined;
      changed = true;
    }
    if (changed) await saveCache(cache);
    return;
  }

  const shouldPrint = !options.machineReadable && process.stderr.isTTY;
  if (shouldPrint && cache.notifiedVersion !== latestVersion) {
    process.stderr.write(
      `howvibe: new version available ${currentVersion} -> ${latestVersion}. ` +
      'Run: npm i -g howvibe@latest\n',
    );
    cache.notifiedVersion = latestVersion;
    changed = true;
  }

  if (changed) await saveCache(cache);
}
