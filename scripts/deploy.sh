#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

# Deploys to Fly.io. Never runs migrate.sh itself: DATABASE_URL in .env.<environment>
# names a Fly private address that does not resolve from a developer's machine, so a
# local run would either fail outright or, worse, migrate the wrong database with a
# stale .env. Migration is the release_command in fly.toml — part of the deploy
# transaction Fly itself runs, inside the private network, with the real secrets. A
# manual repair goes through the same script the same way:
#   fly ssh console --app worklog -C './scripts/migrate.sh'
#
# Usage: scripts/deploy.sh [environment]
#   environment defaults to "prod".

ENVIRONMENT="${1:-prod}"
ENV_FILE=".env.${ENVIRONMENT}"

if [[ -f "fly.${ENVIRONMENT}.toml" ]]; then
	FLY_CONFIG="fly.${ENVIRONMENT}.toml"
else
	FLY_CONFIG="fly.toml"
fi

# Validate every required file BEFORE any remote call — a missing file is a local,
# instant, exit-2 failure, never a half-finished remote deploy.
if [[ ! -f "${ENV_FILE}" ]]; then
	echo "deploy.sh: ${ENV_FILE} not found — copy .env.example to ${ENV_FILE} and fill in the secrets" >&2
	exit 2
fi
if [[ ! -f "${FLY_CONFIG}" ]]; then
	echo "deploy.sh: ${FLY_CONFIG} not found" >&2
	exit 2
fi
if ! command -v fly >/dev/null 2>&1; then
	echo "deploy.sh: flyctl is required but not found on PATH" >&2
	exit 2
fi

APP_NAME="$(grep -E '^app\s*=' "${FLY_CONFIG}" | head -1 | sed -E 's/^app\s*=\s*"([^"]+)".*/\1/')"
if [[ -z "${APP_NAME}" ]]; then
	echo "deploy.sh: could not read 'app = \"...\"' from ${FLY_CONFIG}" >&2
	exit 2
fi

echo "deploy.sh: environment=${ENVIRONMENT} app=${APP_NAME} config=${FLY_CONFIG}"

# The org: read a previously persisted choice, or fetch available orgs from Fly and
# let the user pick interactively. Persisted so subsequent deploys never prompt again.
ORG_FILE="${PROJECT_ROOT}/.fly-org"
if [[ -f "${ORG_FILE}" ]]; then
	FLY_ORG="$(cat "${ORG_FILE}")"
else
	if ! command -v jq >/dev/null 2>&1; then
		echo "deploy.sh: jq is required to choose a Fly organization" >&2
		echo "  install it, or write the org slug into .fly-org by hand" >&2
		exit 1
	fi

	echo "deploy.sh: fetching available organizations..." >&2

	ORG_JSON=$(fly orgs list --json 2>/dev/null || true)

	if [[ -z "$ORG_JSON" || "$ORG_JSON" == "null" || "$ORG_JSON" == "{}" ]]; then
		echo "deploy.sh: no organizations found. Are you logged in? (fly auth login)" >&2
		exit 1
	fi

	# The JSON is {"slug": "name", ...}. Parse it with jq, not with sed/awk: an org
	# name containing a comma ("Acme, Inc.") splits into a phantom entry under any
	# delimiter-based parse, which then shifts the menu numbering and deploys the
	# app somewhere other than what the user picked.
	ORGS=()
	ORG_NAMES=()
	while IFS='|' read -r slug name; do
		[[ -z "$slug" ]] && continue
		ORGS+=("$slug")
		ORG_NAMES+=("$name")
	done < <(echo "$ORG_JSON" | jq -r 'to_entries[] | "\(.key)|\(.value)"')

	if [[ ${#ORGS[@]} -eq 0 ]]; then
		echo "deploy.sh: could not parse organizations. Are you logged in? (fly auth login)" >&2
		exit 1
	elif [[ ${#ORGS[@]} -eq 1 ]]; then
		FLY_ORG="${ORGS[0]}"
		echo "deploy.sh: only one org available: ${ORG_NAMES[0]} (${FLY_ORG})" >&2
	else
		echo "" >&2
		echo "Select organization:" >&2
		for i in "${!ORGS[@]}"; do
			echo "  $((i+1))) ${ORG_NAMES[$i]} (${ORGS[$i]})" >&2
		done
		echo "" >&2
		while true; do
			printf "Choice [1-${#ORGS[@]}]: " >&2
			read -r CHOICE < /dev/tty
			# Strip everything that isn't a digit.
			CHOICE="${CHOICE//[^0-9]/}"
			if [[ -n "$CHOICE" ]] && [[ "$CHOICE" -ge 1 ]] && [[ "$CHOICE" -le ${#ORGS[@]} ]]; then
				FLY_ORG="${ORGS[$((CHOICE-1))]}"
				break
			fi
			echo "Invalid choice. Try again." >&2
		done
	fi

	echo "${FLY_ORG}" > "${ORG_FILE}"
	echo "deploy.sh: ✓ saved org=${FLY_ORG} to .fly-org" >&2
fi

# Create the app only when it does not already exist.
if ! fly status --app "${APP_NAME}" >/dev/null 2>&1; then
	echo "deploy.sh: creating app ${APP_NAME} in org ${FLY_ORG}"
	fly apps create "${APP_NAME}" --org "${FLY_ORG}"
fi

# Keys already declared in fly.toml's [env] table are non-secret and set from there;
# only the [env]-table's own keys are ones this loop should not read as env from the
# secrets file, so it filters accordingly.
mapfile -t ENV_TABLE_KEYS < <(
	awk '/^\[env\]/{f=1; next} /^\[/{f=0} f && /^[ \t]*[A-Za-z_][A-Za-z0-9_]*[ \t]*=/{sub(/^[ \t]+/,""); sub(/[ \t]*=.*/, ""); print}' "${FLY_CONFIG}"
)

SECRET_ARGS=()
while IFS='=' read -r KEY VALUE; do
	[[ -z "${KEY}" || "${KEY}" == \#* ]] && continue
	SKIP=false
	for ENV_KEY in "${ENV_TABLE_KEYS[@]:-}"; do
		if [[ "${KEY}" == "${ENV_KEY}" ]]; then
			SKIP=true
			break
		fi
	done
	[[ "${SKIP}" == true ]] && continue
	SECRET_ARGS+=("${KEY}=${VALUE}")
done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "${ENV_FILE}")

if [[ ${#SECRET_ARGS[@]} -gt 0 ]]; then
	echo "deploy.sh: setting ${#SECRET_ARGS[@]} secret(s)"
	fly secrets set --app "${APP_NAME}" --stage "${SECRET_ARGS[@]}"
fi

# Never --ha: the default high-availability pair violates Requirement 13.25 — a
# second machine would silently double the login rate-limit allowance.
echo "deploy.sh: deploying"
fly deploy --app "${APP_NAME}" --config "${FLY_CONFIG}"
echo "deploy.sh: done"
