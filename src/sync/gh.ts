import { spawn } from 'node:child_process';

type ExecResult = {
  code: number;
  stdout: string;
  stderr: string;
};

function run(command: string, args: string[], inheritStdIO = false): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: inheritStdIO ? 'inherit' : 'pipe',
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    if (!inheritStdIO) {
      child.stdout?.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk);
      });
    }

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

export async function ensureGhInstalled(): Promise<void> {
  const result = await run('gh', ['--version']);
  if (result.code !== 0) {
    throw new Error('GitHub CLI (gh) is required for sync. Install it from https://cli.github.com/');
  }
}

export async function getGhToken(): Promise<string | null> {
  const result = await run('gh', ['auth', 'token']);
  if (result.code !== 0 || !result.stdout) return null;
  return result.stdout;
}

export async function loginGhWithGistScope(): Promise<void> {
  const result = await run('gh', ['auth', 'login', '--web', '--scopes', 'gist'], true);
  if (result.code !== 0) {
    throw new Error('GitHub login failed. Please run `gh auth login --web --scopes gist` and try again.');
  }
}
