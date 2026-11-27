#!/usr/bin/env bash
# bootstrap.sh — the session bootstrap the worktree-running skills share: where
# worktrees go, that the place is ignored, whether pushes work, how much room
# there is.
#
# Usage:
#   bootstrap.sh [-C <dir>] run [--require-helper]
#   bootstrap.sh [-C <dir>] ignore
#
# Run it anywhere inside the repository: a subdirectory and a linked worktree
# answer for the same main checkout, the one whose `.git` directory the
# worktrees share. Both commands are idempotent.
#
# `run` is the whole bootstrap, and its two paths do not enforce the same
# things. Where `wt-bootstrap` is on PATH it is called and its answer
# translated, refusals included: that path enforces powbox's layout (the
# worktree roots are mountpoints, the harness's own root is tmpfs, the worktree
# metadata is as durable as the worktrees). Where it is not on PATH plain git
# does the job and enforces none of that, because those requirements describe
# powbox and a machine without the helper is not assumed to be one:
#   - the worktree base is `<main checkout>/.worktrees/$CONTAINER_NAME`, or
#     `<main checkout>/.worktrees` where CONTAINER_NAME is unset
#   - the filesystem under the base is reported (`fstype=`, `host-shared=`)
#     and nothing is refused on it
#   - `git worktree prune`, then every directory under the base that holds no
#     registered worktree is removed where it is empty and named where it is
#     not; nothing with content is ever deleted
#   - `git ls-remote --heads origin` is the push probe
#   - `df` on the base is the free space
# `--require-helper` makes a missing `wt-bootstrap` a stop instead, for a
# caller whose later steps need the other `wt-*` helpers anyway.
#
# `ignore` is the ignore rule alone, for a caller that attaches one worktree
# and needs nothing else. `run` does the same thing on both of its paths,
# because `wt-bootstrap` establishes no ignore rule and reports `ok` without
# one.
#
# The ignore rule: the base is asked of `git check-ignore` with a trailing
# slash (a directory-only rule answers no for a bare name that is not on disk
# yet). Where the answer is no, `/.worktrees/` is appended to the main
# checkout's repo-local exclude file, the one `git rev-parse --git-path
# info/exclude` names from inside that checkout, and the base is asked again.
# That file is untracked and shared by every linked worktree. The tracked
# `.gitignore` and the user's git configuration are never written.
#
# Output: `key=value` lines on stdout, `outcome=` first.
#   outcome=ready     (exit 0)
#     wt-base=<absolute path>       where worktrees go
#     ignore=present|added          the rule was already there, or this run
#                                   appended it
#   and, from `run`:
#     via=wt-bootstrap|git          which path answered
#     remote=yes|no                 whether `origin` could be reached. `no` is
#                                   a fact for the caller, not a stop here
#     avail-bytes=<n>|unknown       free bytes on the base's filesystem;
#                                   `unknown` where no positive figure could
#                                   be read
#     fstype=<type>|unknown         via=git only; `unknown` where `findmnt`
#                                   is not installed
#     host-shared=yes|no|unknown    via=git only. `yes` where that type is
#                                   9p, drvfs or virtiofs: worktrees will sit
#                                   on a filesystem shared with a host, slower
#                                   and visible there. `no` says only that the
#                                   type is none of those (a Linux host's bind
#                                   mount reads as an ordinary type); `unknown`
#                                   goes with `fstype=unknown`. Never a stop
#     pruned=<name>                 one per empty leftover directory removed
#     quarantined=<name>            via=wt-bootstrap: one per leftover with
#                                   content that it moved aside
#     orphan=<name>                 via=git: one per leftover with content,
#                                   left exactly where it was
#   outcome=stop      (exit 3) no worktree may be added until someone decides
#     blocker=<why, on one line>
#     wt-base=<absolute path>       where one had been settled
#   The stops: `wt-bootstrap` reported a blocker (passed on verbatim), is
#   missing under `--require-helper`, or is there without the `jq` its answer
#   needs; the main checkout cannot be found (a bare repository, a submodule,
#   a `--separate-git-dir` repository); the base is still not ignored once the
#   rule is listed, which means a later rule un-ignores it. Only the last of
#   these is reached after a write of the script's own: `wt-bootstrap` creates
#   its roots before it reports a blocker.
#
# Exit status: 0 ready, 3 stop, 1 on a failure (not a git repository, git or
# the filesystem refusing, a `wt-bootstrap` answer that is not its JSON
# object), 64 on a usage error. Needs `jq` only to read `wt-bootstrap`'s
# answer. Written for bash 3.2 and later.
set -u

RULE='/.worktrees/'
case "$0" in
/*) SELF="$0" ;;
*) SELF="$PWD/$0" ;;
esac

say() { printf '%s\n' "$*"; }
note() { printf 'bootstrap: %s\n' "$*" >&2; }
fail() {
	note "$*"
	exit 1
}
usage() {
	note "$*"
	sed -n '6,8p' "$SELF" | sed 's/^# \{0,1\}//' >&2
	exit 64
}

COMMAND="" REQUIRE_HELPER=no
while [ $# -gt 0 ]; do
	case "$1" in
	-C)
		[ $# -ge 2 ] || usage "-C needs a directory"
		cd "$2" 2>/dev/null || fail "could not enter $2."
		shift 2
		;;
	--require-helper)
		REQUIRE_HELPER=yes
		shift
		;;
	-h | --help | help)
		awk 'NR > 1 && !/^#/ { exit } NR > 1 { sub(/^# ?/, ""); print }' "$SELF"
		exit 0
		;;
	run | ignore)
		[ -z "$COMMAND" ] || usage "name one command, not '$COMMAND' and '$1'"
		COMMAND="$1"
		shift
		;;
	*) usage "unknown argument: $1" ;;
	esac
done
[ -n "$COMMAND" ] || usage "name a command: run or ignore"
[ "$REQUIRE_HELPER" = no ] || [ "$COMMAND" = run ] || usage "--require-helper belongs to run"

WT_BASE="" BODY=""
record() { BODY="$BODY$*
"; }
stop() { # <blocker>
	say "outcome=stop"
	say "blocker=$(printf '%s' "$*" | tr '\n\r' '  ')"
	[ -z "$WT_BASE" ] || say "wt-base=$WT_BASE"
	exit 3
}

git rev-parse --git-dir >/dev/null 2>&1 || fail "this is not a git repository."
COMMON="$(git rev-parse --git-common-dir 2>/dev/null)" || fail "git did not name this repository's common directory."
COMMON="$(cd "$COMMON" 2>/dev/null && pwd -P)" || fail "could not enter this repository's common git directory."
case "$COMMON" in
*'
'*) fail "this repository's path holds a newline, which a key=value answer cannot carry." ;;
*/.git) ROOT="${COMMON%/.git}" ;;
*) stop "cannot find the main checkout from $COMMON: a bare repository or a submodule has none to hold .worktrees/." ;;
esac

tmp="$(mktemp -d "${TMPDIR:-/tmp}/bootstrap.XXXXXX")" || fail "could not create a temporary directory."
# shellcheck disable=SC2064 # expand now: the directory this run made
trap "rm -rf '$tmp'" EXIT

# 0 where the base is ignored, 1 where it is not; anything else is git failing.
ignored() {
	local rc=0
	git -C "$ROOT" check-ignore -q -- "$WT_BASE/" 2>"$tmp/err" || rc=$?
	case "$rc" in
	0 | 1) return "$rc" ;;
	*) fail "git could not say whether $WT_BASE/ is ignored: $(cat "$tmp/err")" ;;
	esac
}

ensure_ignored() {
	local exclude
	if ignored; then
		record "ignore=present"
		return 0
	fi
	# Asked from inside the main checkout, where the answer is relative to it.
	exclude="$(cd "$ROOT" && git rev-parse --git-path info/exclude)" || fail "git did not name the exclude file."
	case "$exclude" in
	/*) ;;
	*) exclude="$ROOT/$exclude" ;;
	esac
	# Already listed and still not ignored: appending it again changes nothing.
	if ! { [ -f "$exclude" ] && grep -Fxq -- "$RULE" "$exclude"; }; then
		mkdir -p "$(dirname "$exclude")" || fail "could not create $(dirname "$exclude")."
		if [ -s "$exclude" ] && [ "$(tail -c 1 "$exclude" | wc -l)" -eq 0 ]; then
			printf '\n' >>"$exclude" || fail "could not write $exclude."
		fi
		printf '%s\n' "$RULE" >>"$exclude" || fail "could not write $exclude."
	fi
	ignored || stop "$WT_BASE/ is still not ignored with $RULE listed in $exclude: a later rule un-ignores it (git -C $ROOT check-ignore -v -n .worktrees/ names the pattern). Nothing else was changed."
	record "ignore=added"
}

by_helper() {
	local json rc=0 base avail
	command -v jq >/dev/null 2>&1 || stop "jq not found on PATH, and wt-bootstrap's answer cannot be read without it."
	json="$(wt-bootstrap 2>"$tmp/helper-err")" || rc=$?
	cat "$tmp/helper-err" >&2
	printf '%s' "$json" | jq -e 'type == "object" and (.ok | type == "boolean")' >/dev/null 2>&1 ||
		fail "wt-bootstrap (exit $rc) did not answer with its JSON object: $json"
	if [ "$(printf '%s' "$json" | jq -r '.ok')" != true ]; then
		stop "$(printf '%s' "$json" | jq -r '.blocker // "" | if . == "" then "wt-bootstrap reported a stop and named no blocker." else . end')"
	fi
	[ "$rc" -eq 0 ] || fail "wt-bootstrap reported ok and exited $rc; its answer cannot be trusted."
	base="$(printf '%s' "$json" | jq -r '.wtBase // "" | tostring | sub("(?<=.)/+$"; "")')"
	case "$base" in
	*'
'*) fail "wt-bootstrap reported a worktree base holding a newline." ;;
	/*) ;;
	*) fail "wt-bootstrap reported ok without an absolute worktree base (got '$base')." ;;
	esac
	WT_BASE="$base"
	record "via=wt-bootstrap"
	record "wt-base=$WT_BASE"
	ensure_ignored
	if [ "$(printf '%s' "$json" | jq -r '.remote == true')" = true ]; then record "remote=yes"; else record "remote=no"; fi
	avail="$(printf '%s' "$json" | jq -r '.availBytes | if type == "number" and . > 0 then floor else "unknown" end')"
	record "avail-bytes=$avail"
	BODY="$BODY$(printf '%s' "$json" | jq -r '(.prunedOrphans // [] | .[] | "pruned=\(.)"), (.quarantinedOrphans // [] | .[] | "quarantined=\(.)")')
"
}

by_git() {
	local where type shared dir name kb
	WT_BASE="$ROOT/.worktrees${CONTAINER_NAME:+/$CONTAINER_NAME}"
	# A base that is not on disk yet is no mount of its own: it will sit on
	# whatever holds the nearest directory above it that exists.
	where="$ROOT/.worktrees"
	[ -d "$where" ] || where="$ROOT"
	type=unknown shared=unknown
	if command -v findmnt >/dev/null 2>&1; then
		type="$(findmnt -nro FSTYPE -T "$where" 2>"$tmp/err")" && [ -n "$type" ] ||
			fail "findmnt could not name the filesystem under $where: $(cat "$tmp/err")"
		case "$type" in
		9p | drvfs | virtiofs) shared=yes ;;
		*) shared=no ;;
		esac
	fi
	record "via=git"
	record "wt-base=$WT_BASE"
	ensure_ignored
	mkdir -p "$WT_BASE" || fail "could not create $WT_BASE."

	git -C "$ROOT" worktree prune || fail "git worktree prune failed."
	git -C "$ROOT" worktree list --porcelain >"$tmp/list" || fail "git could not list the registered worktrees."
	for dir in "$WT_BASE"/*/; do
		dir="${dir%/}"
		[ -d "$dir" ] && [ ! -L "$dir" ] || continue
		# Registered itself, or holding a registered worktree further down.
		awk -v d="worktree $dir" '$0 == d || index($0, d "/") == 1 { found = 1 } END { exit !found }' "$tmp/list" && continue
		name="${dir##*/}"
		if rmdir "$dir" 2>/dev/null; then record "pruned=$name"; else record "orphan=$name"; fi
	done

	if git -C "$ROOT" remote get-url origin >/dev/null 2>&1 &&
		GIT_TERMINAL_PROMPT=0 git -C "$ROOT" ls-remote --heads origin >/dev/null 2>&1; then
		record "remote=yes"
	else
		record "remote=no"
	fi
	kb="$(df -Pk "$WT_BASE" 2>/dev/null | awk 'NR == 2 { print $4 }')"
	case "$kb" in
	'' | *[!0-9]* | 0) record "avail-bytes=unknown" ;;
	*) record "avail-bytes=$((kb * 1024))" ;;
	esac
	record "fstype=$type"
	record "host-shared=$shared"
}

case "$COMMAND" in
ignore)
	WT_BASE="$ROOT/.worktrees${CONTAINER_NAME:+/$CONTAINER_NAME}"
	record "wt-base=$WT_BASE"
	ensure_ignored
	;;
run)
	if command -v wt-bootstrap >/dev/null 2>&1; then
		by_helper
	elif [ "$REQUIRE_HELPER" = yes ]; then
		stop "wt-bootstrap is not on PATH: the image predates the wt-* helpers; rebuild the powbox image and relaunch."
	else
		by_git
	fi
	;;
esac

say "outcome=ready"
printf '%s' "$BODY" | awk 'NF'
