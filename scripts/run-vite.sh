#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

# Runs `vite` (dev/build/preview) with .env loaded the same safe way
# migrate.sh/backup.sh already load it — read line by line, never handed to Bun's own
# .env parser.
#
# Bun's automatic .env loading (both the implicit one under `bun run <script>` and the
# explicit `--env-file=`) expands any `$name` sequence it finds in a value against
# other environment variables, and does this unconditionally — single- and
# double-quoting the value does not suppress it. WORKLOG_PASSPHRASE_HASH is a real
# argon2id hash (`$argon2id$v=19$m=65536,...$<salt>$<hash>`); parsed through Bun's
# loader, every `$something` in it silently disappears, and `loadConfig()`
# (src/lib/server/core/config.ts) then refuses to start. A value that is already a
# real environment variable by the time Bun's process starts is never touched by this
# — only Bun's own file-parsing corrupts it — so this script exports every .env entry
# itself with plain `read` (which never re-parses the value for expansion) before
# `exec`ing `bun vite`, and Bun never gets to parse the file at all.
ENV_FILE=".env"

if [[ -f "${ENV_FILE}" ]]; then
	set -a
	while IFS='=' read -r KEY VALUE; do
		[[ -z "${KEY}" || "${KEY}" == \#* ]] && continue
		# A value already present in the environment wins — see the comment above:
		# "already a real environment variable by the time Bun's process starts is
		# never touched by this" is the documented contract, but an unconditional
		# `export` here broke it for any caller that pre-exports its own value
		# (e.g. scripts/test-e2e.sh pointing this process at the test database).
		[[ -z "${!KEY:-}" ]] && export "${KEY}=${VALUE}"
	done < "${ENV_FILE}"
	set +a
fi

exec bun vite "$@"
