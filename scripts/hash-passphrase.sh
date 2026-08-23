#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

# Produces the value for WORKLOG_PASSPHRASE_HASH. Reads the passphrase from the
# terminal without echoing it, prints the argon2id hash, and nothing else.
read -rs -p 'Passphrase: ' PASSPHRASE < /dev/tty
echo

PASSPHRASE="${PASSPHRASE}" bun -e 'console.log(await Bun.password.hash(process.env.PASSPHRASE, { algorithm: "argon2id", memoryCost: 65536, timeCost: 3 }))'
