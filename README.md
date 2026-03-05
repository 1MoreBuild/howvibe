# howvibe

Track AI coding tool token usage and costs from the command line.

## Install

Requirements:

- Node.js >= 20

Install from npm:

```bash
npm i -g howvibe@latest
howvibe --version
```

Install from source (local dev):

```bash
npm ci
npm run build
npm link
howvibe --version
```

## Quick Start

Show today usage:

```bash
howvibe today
```

Show grouped daily usage in a date range:

```bash
howvibe daily --since 2026-03-01 --until 2026-03-07
```

Show grouped monthly usage:

```bash
howvibe monthly
```

Machine-readable output:

```bash
howvibe today --json
howvibe monthly --plain
```

## Common Sync Commands

Enable cross-machine sync (GitHub Gist):

```bash
howvibe sync enable
```

Disable sync:

```bash
howvibe sync disable
```

Non-interactive mode (no prompts/login flow):

```bash
howvibe --no-input sync enable
```

Notes:

- `sync enable` may open GitHub login if `gh auth token` is unavailable.
- In `--no-input` mode, you must already have a valid GitHub token from `gh auth login --web --scopes gist`.
- `gh` CLI is required for sync.

## CLI Usage

```bash
howvibe [options] [command]

Commands:
  today
  daily
  monthly
  sync enable
  sync disable
```

Global options:

- `--json`: JSON output
- `--plain`: line-based plain text output (TSV)
- `-q, --quiet`: suppress non-essential output
- `--no-input`: disable prompts/login flow
- `--no-color`: disable colored output
- `--provider <name>`: `claude-code`, `codex`, `cursor`, `openrouter`
- `--source <source>`: `auto`, `web`, `cli`, `oauth`
- `--since <YYYY-MM-DD>`
- `--until <YYYY-MM-DD>`

## Providers and Sources

Supported source matrix:

- `claude-code`: `cli`
- `codex`: `cli`
- `cursor`: `web`, `oauth`
- `openrouter`: `web`, `oauth`

Use `--source auto` (default) to let howvibe choose all compatible providers.

## Environment Variables

- `HOWVIBE_SOURCE`
- `CURSOR_SESSION_TOKEN`
- `OPENROUTER_MANAGEMENT_KEY`
- `CLAUDE_ORGANIZATION_UUID`
- `CLAUDE_CONFIG_DIR`
- `CODEX_HOME`

## Releasing

See release guide:

- [RELEASING.md](./RELEASING.md)
