#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

# Starts an ephemeral PostgreSQL with plain `docker run` (never `docker compose`),
# migrates it, runs the Playwright suite against it, then tears the container down —
# every state on exit, success or failure alike.

CONTAINER_NAME="worklog-e2e-postgres"
DB_PORT="${WORKLOG_E2E_DB_PORT:-55432}"
export TEST_DATABASE_URL="postgres://worklog:worklog@localhost:${DB_PORT}/worklog_test"
export DATABASE_URL="${TEST_DATABASE_URL}"
export APP_ENV="test"

cleanup() {
	docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
echo "test-e2e.sh: starting PostgreSQL"
docker run -d \
	--name "${CONTAINER_NAME}" \
	-e POSTGRES_USER=worklog \
	-e POSTGRES_PASSWORD=worklog \
	-e POSTGRES_DB=worklog_test \
	-p "${DB_PORT}:5432" \
	postgres:16 >/dev/null

echo "test-e2e.sh: waiting for PostgreSQL to accept connections"
for _ in $(seq 1 30); do
	if docker exec "${CONTAINER_NAME}" pg_isready -U worklog >/dev/null 2>&1; then
		break
	fi
	sleep 1
done

# The official postgres image restarts itself once internally right after first-time
# initialization, and pg_isready can report ready for the instance that is about to
# restart. A real query, retried, is what actually confirms the database is up.
echo "test-e2e.sh: confirming the database actually accepts a query"
for _ in $(seq 1 15); do
	if docker exec "${CONTAINER_NAME}" psql -U worklog -d worklog_test -c 'select 1' >/dev/null 2>&1; then
		break
	fi
	sleep 1
done

# btree_gist is a plain SQL-callable extension (unlike a background-worker extension,
# it needs no shared_preload_libraries) — migrations/001_init.sql's own first
# statement is CREATE EXTENSION IF NOT EXISTS btree_gist, so migrate.sh is enough.
echo "test-e2e.sh: migrating"
# "e2e" rather than "local": migrate.sh sources ".env.<environment>" when that file
# exists and otherwise leaves the already-exported DATABASE_URL alone. No .env.e2e
# is ever created, so this always uses the ephemeral database exported above —
# never a developer's own .env, which points at a different database entirely.
"${SCRIPT_DIR}/migrate.sh" e2e

echo "test-e2e.sh: running Playwright"
bunx playwright test

echo "test-e2e.sh: done"
