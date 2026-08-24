#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

# Applies every unapplied migration in migrations/ in filename order, inside a
# transaction each, recording the filename in schema_migrations. Idempotent — a
# second run applies nothing and exits 0. This is the only supported way to apply
# migrations; drizzle-kit migrate is not used because EXCLUDE constraints and
# expression-based partial indexes are not expressible in the Drizzle schema DSL.
# There are no down migrations: a mistake is corrected by a new forward migration.
#
# Usage: scripts/migrate.sh [environment]
#   environment defaults to the local .env (loaded automatically by `bun`'s env
#   handling is NOT relied on here — this script is plain bash and reads DATABASE_URL
#   directly from the environment or from .env.<environment>).

ENVIRONMENT="${1:-}"

if [[ -n "${ENVIRONMENT}" && "${ENVIRONMENT}" != "local" ]]; then
	ENV_FILE=".env.${ENVIRONMENT}"
else
	ENV_FILE=".env"
fi

if [[ -f "${ENV_FILE}" ]]; then
	# Read line by line rather than `source`: a value containing a literal `$` —
	# WORKLOG_PASSPHRASE_HASH is an argon2id hash, `$argon2id$v=19$...` — makes
	# `source` treat it as unset-variable expansion and abort under `set -u`. `read`
	# never re-parses the value for expansion, so it survives untouched.
	set -a
	while IFS='=' read -r KEY VALUE; do
		[[ -z "${KEY}" || "${KEY}" == \#* ]] && continue
		export "${KEY}=${VALUE}"
	done < "${ENV_FILE}"
	set +a
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
	echo "migrate.sh: DATABASE_URL is not set (looked in the environment and in ${ENV_FILE})" >&2
	exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
	echo "migrate.sh: psql is required but not found on PATH" >&2
	exit 1
fi

# Creates the database if it does not exist yet, so a fresh machine needs only
# PostgreSQL running and a DATABASE_URL — nothing else provisions it.
TARGET_DB="$(echo "${DATABASE_URL}" | sed -E 's#^[a-zA-Z0-9+.-]+://[^/]*/([^?]+).*#\1#')"
MAINTENANCE_URL="$(echo "${DATABASE_URL}" | sed -E "s#/${TARGET_DB}(\?.*)?\$#/postgres#")"

if ! psql "${DATABASE_URL}" -tAc 'select 1' >/dev/null 2>&1; then
	echo "migrate.sh: database ${TARGET_DB} does not exist yet — creating it"
	psql "${MAINTENANCE_URL}" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${TARGET_DB}\""
fi

psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    text PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now()
);
SQL

# One session advisory lock so two concurrent runs cannot interleave.
LOCK_KEY=4919372002

for MIGRATION in "${PROJECT_ROOT}"/migrations/*.sql; do
	[[ -e "${MIGRATION}" ]] || continue
	FILENAME="$(basename "${MIGRATION}")"
	ALREADY_APPLIED="$(psql "${DATABASE_URL}" -tAc "select 1 from schema_migrations where filename = '${FILENAME}'")"
	if [[ "${ALREADY_APPLIED}" == "1" ]]; then
		echo "migrate.sh: ${FILENAME} already applied, skipping"
		continue
	fi

	echo "migrate.sh: applying ${FILENAME}"
	psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -q <<SQL
SELECT pg_advisory_lock(${LOCK_KEY});
BEGIN;
\i ${MIGRATION}
INSERT INTO schema_migrations (filename) VALUES ('${FILENAME}');
COMMIT;
SELECT pg_advisory_unlock(${LOCK_KEY});
SQL
done

echo "migrate.sh: up to date"
