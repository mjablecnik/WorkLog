#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

CONTAINER_NAME="worklog"

if [[ "$(docker ps -aq -f name="^${CONTAINER_NAME}\$")" == "" ]]; then
	echo "stop-docker.sh: ${CONTAINER_NAME} is not running"
	exit 0
fi

docker rm -f "${CONTAINER_NAME}" >/dev/null
echo "stop-docker.sh: ${CONTAINER_NAME} stopped"
