import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { resolveUsageSource, type UsageSource } from './source.js';

export const DEFAULT_SYNC_BOOTSTRAP_DAYS = 90;

export type SyncSettings = {
  enabled?: boolean;
  provider?: 'github_gist';
  gistId?: string;
  machineName?: string;
  machineId?: string;
  bootstrapDays?: number;
};

export type HowvibeConfig = {
  cursorSessionToken?: string;
  openrouterManagementKey?: string;
  claudeOrganizationUuid?: string;
  source?: UsageSource;
  sync?: SyncSettings;
  providers?: string[];
};

let cachedConfig: HowvibeConfig | null = null;

export function getHowvibeDir(): string {
  return join(homedir(), '.howvibe');
}

export function getHowvibeConfigPath(): string {
  return join(getHowvibeDir(), 'config.json');
}

export function getHowvibeSyncDir(): string {
  return join(getHowvibeDir(), 'sync');
}

export function getHowvibeSyncStatePath(): string {
  return join(getHowvibeSyncDir(), 'state.json');
}

export function getHowvibeSyncCacheDir(): string {
  return join(getHowvibeSyncDir(), 'cache');
}

export async function loadConfig(): Promise<HowvibeConfig> {
  if (cachedConfig) return cachedConfig;

  const configPath = getHowvibeConfigPath();
  try {
    const raw = await readFile(configPath, 'utf-8');
    cachedConfig = JSON.parse(raw) as HowvibeConfig;
  } catch {
    cachedConfig = {};
  }
  return cachedConfig;
}

export async function saveConfig(config: HowvibeConfig): Promise<void> {
  const configPath = getHowvibeConfigPath();
  await mkdir(getHowvibeDir(), { recursive: true, mode: 0o700 });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
  cachedConfig = config;
}

export function clearConfigCache(): void {
  cachedConfig = null;
}

export function getCursorSessionToken(config: HowvibeConfig): string | undefined {
  return process.env['CURSOR_SESSION_TOKEN'] ?? config.cursorSessionToken;
}

export function getOpenRouterManagementKey(config: HowvibeConfig): string | undefined {
  return process.env['OPENROUTER_MANAGEMENT_KEY'] ?? config.openrouterManagementKey;
}

export function getClaudeOrganizationUuid(config: HowvibeConfig): string | undefined {
  return process.env['CLAUDE_ORGANIZATION_UUID'] ?? config.claudeOrganizationUuid;
}

export function getUsageSource(config: HowvibeConfig, override?: string): UsageSource {
  return resolveUsageSource(override ?? process.env['HOWVIBE_SOURCE'] ?? config.source);
}

export function getClaudeConfigDir(): string {
  return process.env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), '.claude');
}

export function getCodexHome(): string {
  return process.env['CODEX_HOME'] ?? join(homedir(), '.codex');
}
