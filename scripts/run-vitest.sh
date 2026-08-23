#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

# Runs Vitest under real Node, never under Bun. `bun run <script>` — with this
# project's bunfig.toml `[run] bun = true` (required elsewhere for `Bun.password.hash`
# and automatic .env loading in dev/build scripts) — puts a shim directory at the
# FRONT of PATH whose `node` is actually Bun itself, so even a plain `node ...` call
# nested inside a shell script still runs under Bun, not real Node. Bun's transpiler
# has a reproducible bug where importing the `postgres` driver (used by
# tests/setup/db.ts) corrupts a separately-imported `zod` named export for the rest of
# the test file — verified down to a two-line repro with no application code involved,
# confirmed absent under plain Node and under `bunx vitest` run outside a `bun run`
# wrapper, and traced to that PATH shim via `which node` inside a `bun run` script
# resolving to a `/tmp/bun-node-*/node` shim rather than the real interpreter.
# Resolving the real `node` binary explicitly (skipping the shimmed PATH entry) is
# what actually avoids Bun's substitution.
REAL_NODE="$(type -ap node | grep -v '/bun-node-' | head -1)"
if [[ -z "${REAL_NODE}" ]]; then
	echo "run-vitest.sh: could not find a real (non-Bun-shimmed) node on PATH" >&2
	exit 1
fi
exec "${REAL_NODE}" --env-file-if-exists=.env node_modules/vitest/vitest.mjs "$@"
