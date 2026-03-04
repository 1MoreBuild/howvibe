#!/usr/bin/env bash
set -euo pipefail

HOWVIBE_DIR="${HOWVIBE_DIR:-$HOME/.howvibe}"
ASSUME_YES=false

normalize_path() {
  node -e 'const path = require("node:path"); console.log(path.resolve(process.argv[1] || ""));' "$1"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes)
      ASSUME_YES=true
      shift
      ;;
    -h|--help)
      cat <<'USAGE'
Reset local howvibe runtime state.

Usage:
  scripts/reset-local-howvibe.sh [--yes]

What it removes:
  - ~/.howvibe/config.json
  - ~/.howvibe/sync/state.json
  - ~/.howvibe/sync/cache/*
  - any other local howvibe runtime files under ~/.howvibe

Notes:
  - This does NOT delete remote GitHub Gist data.
  - This does NOT remove global npm link/install.
USAGE
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Use --help for usage." >&2
      exit 1
      ;;
  esac
done

if [[ -z "${HOWVIBE_DIR// }" ]]; then
  echo "Refusing to delete: HOWVIBE_DIR is empty." >&2
  exit 1
fi

SAFE_ROOT="$(normalize_path "$HOME/.howvibe")"
SAFE_HOME="$(normalize_path "$HOME")"
TARGET_DIR="$(normalize_path "$HOWVIBE_DIR")"

if [[ "$TARGET_DIR" == "/" || "$TARGET_DIR" == "$SAFE_HOME" ]]; then
  echo "Refusing to delete unsafe path: $TARGET_DIR" >&2
  exit 1
fi

if [[ "$TARGET_DIR" != "$SAFE_ROOT" && "$TARGET_DIR" != "$SAFE_ROOT/"* ]]; then
  echo "Refusing to delete outside $SAFE_ROOT: $TARGET_DIR" >&2
  exit 1
fi

if [[ "$ASSUME_YES" != true ]]; then
  echo "About to remove local howvibe state at: $TARGET_DIR"
  read -r -p "Continue? [y/N] " reply
  if [[ ! "$reply" =~ ^[Yy]$ ]]; then
    echo "Canceled."
    exit 0
  fi
fi

if [[ -d "$TARGET_DIR" ]]; then
  rm -rf "$TARGET_DIR"
  echo "Removed: $TARGET_DIR"
else
  echo "Nothing to remove: $TARGET_DIR does not exist."
fi

echo "Local howvibe state reset complete."
