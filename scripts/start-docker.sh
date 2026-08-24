#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

# Builds (if needed) and runs the production image locally, configuration coming
# entirely from .env at runtime — never baked into the Dockerfile.
#
# Usage: scripts/start-docker.sh [tag]

TAG="${1:-worklog:latest}"
CONTAINER_NAME="worklog"

if [[ ! -f .env ]]; then
	echo "start-docker.sh: .env not found — copy .env.example and fill it in first" >&2
	exit 1
fi

if [[ "$(docker images -q "${TAG}" 2>/dev/null)" == "" ]]; then
	"${SCRIPT_DIR}/build.sh" "${TAG}"
fi

docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true

# --network host so DATABASE_URL's default localhost:5432 (a Postgres running
# directly on the host, or published from another container) resolves from inside
# this one, without hardcoding a container name here. Linux only — see
# https://docs.docker.com/network/drivers/host/. On Docker Desktop, point
# DATABASE_URL at host.docker.internal in .env instead and drop --network host.
docker run -d \
	--name "${CONTAINER_NAME}" \
	--network host \
	--env-file .env \
	"${TAG}"

echo "start-docker.sh: ${CONTAINER_NAME} running — http://localhost:${PORT:-3000}"
