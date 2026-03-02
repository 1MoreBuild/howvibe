import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export type HowvibeConfig = {
  cursorSessionToken?: string;
  openrouterManagementKey?: string;
  providers?: string[];
};

let cachedConfig: HowvibeConfig | null = null;

export async function loadConfig(): Promise<HowvibeConfig> {
  if (cachedConfig) return cachedConfig;

  const configPath = join(homedir(), '.howvibe', 'config.json');
  try {
    const raw = await readFile(configPath, 'utf-8');
    cachedConfig = JSON.parse(raw) as HowvibeConfig;
  } catch {
    cachedConfig = {};
  }
  return cachedConfig;
}

export function getCursorSessionToken(config: HowvibeConfig): string | undefined {
  return process.env['CURSOR_SESSION_TOKEN'] ?? config.cursorSessionToken;
}

export function getOpenRouterManagementKey(config: HowvibeConfig): string | undefined {
  return process.env['OPENROUTER_MANAGEMENT_KEY'] ?? config.openrouterManagementKey;
}

export function getClaudeConfigDir(): string {
  return process.env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), '.claude');
}

export function getCodexHome(): string {
  return process.env['CODEX_HOME'] ?? join(homedir(), '.codex');
}
