#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

# Builds the production Docker image locally. This is what `dploy build worklog`
# invokes; scripts/start-docker.sh runs the image this produces.
#
# Usage: scripts/build.sh [tag]
#   tag defaults to "worklog:latest".

TAG="${1:-worklog:latest}"

echo "build.sh: building ${TAG}"
docker build -t "${TAG}" "${PROJECT_ROOT}"
echo "build.sh: built ${TAG}"
