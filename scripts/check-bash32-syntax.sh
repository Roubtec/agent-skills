#!/usr/bin/env bash
# Parse check for every bash script the skills ship: `bash -n` on each, under
# the bash that runs this file. Their contract is bash 3.2, which parses less
# than later versions do, so the answer that counts is the one bash 3.2 gives:
#
#   docker run --rm -v "$PWD":/w:ro -w /w docker.io/library/bash:3.2 \
#     bash scripts/check-bash32-syntax.sh --require 3.2
#
# Usage: check-bash32-syntax.sh [--require <version-prefix>]
#
#   --require <prefix>   fail unless the running bash's version starts with
#                        <prefix>, so a run that was meant for bash 3.2 cannot
#                        pass under another one
#
# Checked, found by glob so a new helper is covered without a list to edit:
#   plugins/dev-skills/skills/*/*.sh and codex/dev-skills/skills/*/*.sh, where
#     the folder holds a SKILL.md
#   plugins/dev-skills/bin/*, where the first line is a bash shebang
#
# A parse check only: it runs none of them. Uses bash builtins alone, because
# the bash:3.2 image carries busybox tools and no git.
#
# Exit: 0 every script parses; 1 one does not, a location held no script, or
# the version is not the required one; 64 misuse.
set -u

REQUIRE=""
while [ $# -gt 0 ]; do
	case "$1" in
	--require)
		[ $# -ge 2 ] && [ -n "$2" ] || {
			echo "check-bash32-syntax: --require needs a version prefix" >&2
			exit 64
		}
		REQUIRE="$2"
		shift
		;;
	*)
		echo "check-bash32-syntax: unknown argument: $1" >&2
		exit 64
		;;
	esac
	shift
done

cd "$(dirname "$0")/.." || exit 1
echo "bash $BASH_VERSION ($BASH)"
case "$BASH_VERSION" in
"$REQUIRE"*) ;;
*)
	echo "check-bash32-syntax: this is not bash $REQUIRE; nothing was checked" >&2
	exit 1
	;;
esac

checked=0
failed=0
check() { # <file>
	checked=$((checked + 1))
	found=$((found + 1))
	if ! "$BASH" -n "$1"; then
		failed=$((failed + 1))
		echo "FAIL $1: does not parse under bash $BASH_VERSION" >&2
	fi
}
# A location that yields nothing is a moved tree or a stale glob, not a pass.
found=0
location() { # <what was searched>
	if [ "$found" = 0 ]; then
		failed=$((failed + 1))
		echo "FAIL $1: no script found" >&2
	fi
	found=0
}

for mirror in plugins/dev-skills/skills codex/dev-skills/skills; do
	for f in "$mirror"/*/*.sh; do
		[ -f "$f" ] && [ -f "${f%/*}/SKILL.md" ] || continue
		check "$f"
	done
	location "$mirror/*/*.sh"
done
for f in plugins/dev-skills/bin/*; do
	[ -f "$f" ] || continue
	first=""
	IFS= read -r first <"$f" || true
	case "$first" in
	'#!'*bash*) check "$f" ;;
	*) echo "skipped $f: not a bash script" ;;
	esac
done
location "plugins/dev-skills/bin/*"

if [ "$failed" -gt 0 ]; then
	echo "bash syntax check: $failed failure(s) over $checked script(s) under bash $BASH_VERSION." >&2
	exit 1
fi
echo "bash syntax check passed ($checked scripts parse under bash $BASH_VERSION)."
