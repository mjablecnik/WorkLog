#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

# Dumps the target environment's database into backups/, timestamped, and prints the
# command that restores it. The logged time is invoicing evidence, so a backup path
# must exist from day one.
#
# Usage: scripts/backup.sh <environment>

ENVIRONMENT="${1:?usage: scripts/backup.sh <environment>}"
ENV_FILE=".env.${ENVIRONMENT}"

if [[ "${ENVIRONMENT}" == "local" ]]; then
	ENV_FILE=".env"
fi

if [[ ! -f "${ENV_FILE}" ]]; then
	echo "backup.sh: ${ENV_FILE} not found" >&2
	exit 2
fi

# Read line by line rather than `source`: a value containing a literal `$` —
# WORKLOG_PASSPHRASE_HASH is an argon2id hash, `$argon2id$v=19$...` — makes `source`
# treat it as unset-variable expansion and abort under `set -u`. `read` never
# re-parses the value for expansion, so it survives untouched.
set -a
while IFS='=' read -r KEY VALUE; do
	[[ -z "${KEY}" || "${KEY}" == \#* ]] && continue
	export "${KEY}=${VALUE}"
done < "${ENV_FILE}"
set +a

if [[ -z "${DATABASE_URL:-}" ]]; then
	echo "backup.sh: DATABASE_URL is not set in ${ENV_FILE}" >&2
	exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
	echo "backup.sh: pg_dump is required but not found on PATH" >&2
	exit 1
fi

mkdir -p "${PROJECT_ROOT}/backups"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="${PROJECT_ROOT}/backups/worklog-${ENVIRONMENT}-${TIMESTAMP}.sql"

echo "backup.sh: dumping ${ENVIRONMENT} to ${OUT_FILE}"
pg_dump "${DATABASE_URL}" --no-owner --no-privileges -f "${OUT_FILE}"
echo "backup.sh: done"
echo
echo "To restore:"
echo "  psql \"\${DATABASE_URL}\" -f '${OUT_FILE}'"
