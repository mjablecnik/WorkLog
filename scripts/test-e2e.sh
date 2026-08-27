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
export APP_ENV="test"

# DATABASE_URL is deliberately NOT exported here, even though the running app must
# end up pointed at the same database TEST_DATABASE_URL names. `playwright.config.ts`'s
# `webServer.env` already does that — explicitly, for the spawned app process alone —
# so nothing in this script's own shell needs `DATABASE_URL` except the one-off
# `migrate.sh` call below, which gets it passed inline instead. Exporting it here used
# to make it ambient in THIS process too, which `tests/e2e/global-setup.ts` (via
# `tests/setup/db.ts`) then inherits: that file's safety check refuses to run whenever
# `TEST_DATABASE_URL === DATABASE_URL`, specifically to catch a real
# production/test mixup — and this script was tripping its own check with two
# variables it had made byte-identical on purpose. See .agents/ISSUES.md.

# loadConfig() (src/lib/server/core/config.ts) refuses to start without a real
# WORKLOG_API_TOKEN (>= 32 chars) and a real argon2id WORKLOG_PASSPHRASE_HASH — on a
# clean checkout neither is set, since .env is gitignored and never committed. A
# throwaway token is fine here (nothing in this suite exercises the bearer-token
# API surface). The passphrase hash MUST match tests/e2e/e2e-passphrase.ts's
# E2E_PASSPHRASE — minted through scripts/hash-passphrase.sh (the one place the
# hashing algorithm/parameters are defined) rather than duplicated here, so the
# plaintext every spec logs in with and the hash the server checks against can
# never drift apart.
export WORKLOG_API_TOKEN="${WORKLOG_API_TOKEN:-e2e-test-api-token-abcdefghijklmnop}"
E2E_PASSPHRASE_VALUE="$(bun -e "import { E2E_PASSPHRASE } from './tests/e2e/e2e-passphrase.ts'; console.log(E2E_PASSPHRASE);")"
export WORKLOG_PASSPHRASE_HASH="$(PASSPHRASE="${E2E_PASSPHRASE_VALUE}" "${SCRIPT_DIR}/hash-passphrase.sh")"

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
# exists and otherwise leaves an already-set DATABASE_URL alone. No .env.e2e is ever
# created, so this always uses the ephemeral database named by TEST_DATABASE_URL above
# — never a developer's own .env, which points at a different database entirely.
# Passed inline, scoped to this one command, rather than exported into the whole
# script — see the note above DATABASE_URL's absence from the exports at the top.
DATABASE_URL="${TEST_DATABASE_URL}" "${SCRIPT_DIR}/migrate.sh" e2e

# .agents/ISSUES.md, "Full E2E suite ... still occasionally exceeds the login rate
# limit" (5 attempts / 15 minutes, Requirement 11.13 — never loosened for tests):
# auth.spec.ts's own logout-invalidation cycle (3 real logins its cached session
# cannot survive) plus its deliberate wrong-then-right passphrase pair already spend
# the whole budget by design, leaving none for a11y.spec.ts's per-theme beforeAll (2
# more real logins) or anything after it in the same run. Reordering alone cannot
# fix this — whichever file needs the next real login past the 5th still fails.
# The login limiter is in-process and resets when the app process restarts, so this
# runs auth.spec.ts as its own Playwright invocation first: `webServer` starts a
# fresh `bun run preview`, Playwright tears it down when this invocation ends, and
# the second invocation's `webServer` starts an equally fresh one with a clean
# rate-limit slate for everything else.
echo "test-e2e.sh: running Playwright (auth.spec.ts first, its own server instance)"
bunx playwright test tests/e2e/auth.spec.ts

# Playwright's --grep/--grep-invert match against the test *title*, not the file
# path, so excluding auth.spec.ts here needs an explicit file list rather than a
# grep pattern.
REST_SPECS=()
for f in tests/e2e/*.spec.ts; do
	[[ "$(basename "${f}")" == "auth.spec.ts" ]] && continue
	REST_SPECS+=("${f}")
done

echo "test-e2e.sh: running Playwright (everything else, a fresh server instance)"
bunx playwright test "${REST_SPECS[@]}"

echo "test-e2e.sh: done"
