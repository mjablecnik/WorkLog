#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

# Produces the value for WORKLOG_PASSPHRASE_HASH. Reads the passphrase from the
# terminal without echoing it, prints the argon2id hash, and nothing else.
#
# A caller that already has the plaintext in hand (scripts/test-e2e.sh, minting
# the E2E suite's throwaway hash from tests/e2e/e2e-passphrase.ts's constant) may
# export PASSPHRASE itself instead — this is what keeps that hash and the
# plaintext the suite logs in with from drifting apart, since both come from the
# one algorithm defined here rather than a second copy of it.
if [[ -z "${PASSPHRASE:-}" ]]; then
	read -rs -p 'Passphrase: ' PASSPHRASE < /dev/tty
	echo
fi

PASSPHRASE="${PASSPHRASE}" bun -e 'console.log(await Bun.password.hash(process.env.PASSPHRASE, { algorithm: "argon2id", memoryCost: 65536, timeCost: 3 }))'
