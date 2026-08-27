#!/bin/bash
#
#  Copyright (c) 2026 Martin Jablečník
#  Authors: Martin Jablečník
#  Description: Fails when a directory holds more source files than the project
#               structure standard allows.
#
#  Why this exists: a flat directory of eighty source files never arrives in one
#  commit. It accumulates one compliant-looking file at a time, and every single
#  addition looks reasonable on its own, so a prose rule is never triggered by any
#  individual change. Only a check that fails the build catches the drift.
#
#  See infra-project-structure.md — beyond the threshold a directory is split into
#  subdirectories by responsibility (core/, data/, clients/, services/).
#
#  Two tiers, deliberately: the standard's ~8 files is the point at which you should
#  START splitting, this ceiling is the point at which the build REFUSES to proceed.
#  The gap between them is room for judgement — a feature with twelve components is
#  a defensible call, a directory with thirty-nine files is not a call at all.
#
#  Usage: ./check-structure.sh [--max N] [--list] [PATH]
#
#    --max N   Override the file-count ceiling (default: 15)
#    --list    Report every directory's count and exit 0 — surveys without failing
#    PATH      Directory to check (default: the project root, resolved from this script)
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MAX_FILES="${MAX_FILES_PER_DIR:-15}"
LIST_ONLY=false
TARGET=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--max)
			[[ $# -ge 2 ]] || { echo "check-structure.sh: --max needs a number" >&2; exit 2; }
			MAX_FILES="$2"
			shift 2
			;;
		--list)
			LIST_ONLY=true
			shift
			;;
		-h|--help)
			sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's|^#||;s|^ ||'
			exit 0
			;;
		-*)
			echo "check-structure.sh: unknown option '$1'" >&2
			exit 2
			;;
		*)
			TARGET="$1"
			shift
			;;
	esac
done

if [[ ! "$MAX_FILES" =~ ^[0-9]+$ ]] || [[ "$MAX_FILES" -lt 1 ]]; then
	echo "check-structure.sh: --max must be a positive integer, got '${MAX_FILES}'" >&2
	exit 2
fi

# Default to the project root: this script lives in <project>/scripts/.
ROOT="${TARGET:-$(dirname "${SCRIPT_DIR}")}"

if [[ ! -d "$ROOT" ]]; then
	echo "check-structure.sh: '${ROOT}' is not a directory" >&2
	exit 2
fi

ROOT="$(cd "$ROOT" && pwd)"

# Source files only. Anything not in this list (JSON, SQL, Markdown, assets) is
# either data or documentation and does not carry the structure this check defends.
SOURCE_EXT='\.(go|ts|tsx|js|jsx|mjs|cjs|svelte|dart|rs|py|kt|java|rb|php|vue|swift|c|cc|cpp|h|hpp)$'

# Directories excluded by nature, not by taste:
#   - generated or vendored trees are not ours to organize
#   - migrations/ is sequential by design (001_, 002_, ... 999_) and must stay flat
#   - platform folders come from the framework's own scaffolding
EXCLUDE_DIRS='^(node_modules|build|dist|vendor|target|coverage|test-results|migrations|android|ios|macos|windows|\.git|\.svelte-kit|\.dart_tool|\.venv|__pycache__|paraglide)$'

# Prefer git: it already knows what is generated, vendored or ignored. --cached
# --others --exclude-standard covers committed AND not-yet-committed files while
# still respecting .gitignore — plain `git ls-files` alone sees only committed
# files, which makes a freshly scaffolded, not-yet-committed project look empty
# and lets this check pass with nothing actually checked. Fall back to find when
# this is not a repository at all (e.g. a vendored copy).
collect_files() {
	if git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
		git -C "$ROOT" ls-files --cached --others --exclude-standard
	else
		(cd "$ROOT" && find . -type f | sed 's|^\./||')
	fi
}

# Count source files per directory, skipping any path that crosses an excluded
# directory at any depth.
COUNTS="$(
	collect_files \
		| grep -Ei "$SOURCE_EXT" \
		| grep -v '\.d\.ts$' \
		| while IFS= read -r file; do
			dir="$(dirname "$file")"
			skip=false
			IFS='/' read -ra parts <<< "$dir"
			for part in "${parts[@]}"; do
				if [[ "$part" =~ $EXCLUDE_DIRS ]]; then
					skip=true
					break
				fi
			done
			[[ "$skip" == true ]] || echo "$dir"
		done \
		| sort | uniq -c | sort -rn || true
)"

if [[ -z "$COUNTS" ]]; then
	echo "check-structure.sh: no source files found under ${ROOT}"
	exit 0
fi

if [[ "$LIST_ONLY" == true ]]; then
	echo "Source files per directory (ceiling ${MAX_FILES}):"
	echo ""
	while read -r count dir; do
		[[ -z "$count" ]] && continue
		marker="  "
		[[ "$count" -gt "$MAX_FILES" ]] && marker=" !"
		printf "%s%4s  %s\n" "$marker" "$count" "$dir"
	done <<< "$COUNTS"
	exit 0
fi

VIOLATIONS=""
while read -r count dir; do
	[[ -z "$count" ]] && continue
	if [[ "$count" -gt "$MAX_FILES" ]]; then
		VIOLATIONS+="$(printf "  %4s files  %s" "$count" "$dir")"$'\n'
	fi
done <<< "$COUNTS"

if [[ -n "$VIOLATIONS" ]]; then
	echo "check-structure.sh: directories over the ${MAX_FILES}-file ceiling:" >&2
	echo "" >&2
	printf "%s" "$VIOLATIONS" >&2
	echo "" >&2
	echo "Split each by responsibility — core/, data/, clients/, services/ — per" >&2
	echo "infra-project-structure.md. Run with --list to see every directory's count." >&2
	exit 1
fi

echo "check-structure.sh: ✓ no directory exceeds ${MAX_FILES} source files"
