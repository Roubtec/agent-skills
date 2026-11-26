#!/usr/bin/env bash
# overlap.sh — which of a batch's delivered branches would conflict, read
# without a worktree, a rebase or a temporary branch.
#
# Usage:
#   overlap.sh [-C <dir>] --base <commit> <branch> <branch>...
#
# `--base` is the commit the branches are headed for, as an exact commit or a
# ref this repository already holds; nothing is fetched. Each `<branch>` is a
# branch name or a commit, and is named in the output as it was written.
#
# For every branch it prints
#   branch=<branch> TAB <oid> TAB <clean|conflict|merged>
#                  how a trial merge into the base goes. `merged` is a branch
#                  the base already contains: it takes no further part.
#   base-conflict=<branch> TAB <path>
#                  one per file that trial merge conflicts in
# and for every pair of the others
#   pair=<a> TAB <b> TAB <clean|overlap|conflict|stacked>
#                  `stacked` is a pair where one branch contains the other: the
#                  later one already holds the earlier one's work, so there is
#                  nothing to forecast. `overlap` is a pair that touches a file
#                  in common and still merges; `conflict` is a pair whose trial
#                  merge does not.
#   shared=<a> TAB <b> TAB <path>
#                  one per file both touch, counted from where each left the
#                  base or the other branch, whichever is nearer
#   conflict=<a> TAB <b> TAB <path>
#                  one per file the trial merge of the two conflicts in. Where
#                  the base moved between the two branches' fork points, a file
#                  here that is no `shared=` file is the base's change meeting
#                  one branch, which that branch's `base-conflict=` also shows.
# under
#   outcome=clean     no pair touches a file in common, and every branch
#                     merges into the base
#   outcome=overlap   some pair touches a file in common; everything merges
#   outcome=conflict  a pair, or a branch and the base, does not merge (exit 3)
#
# The trial merges are `git merge-tree --write-tree`, which reads and writes
# objects only: no ref, index or working tree is touched. A path with unusual
# characters is printed as git quotes it.
#
# Output: `key=value` lines on stdout, `outcome=` first. Exit status: 0 on
# clean and overlap, 3 on conflict, 1 on a failure (a commit that does not
# resolve, histories with no common ancestor, a git older than 2.38), 64 on a
# usage error. Needs git 2.38 or later. Written for bash 3.2 and later.
set -u

TAB="$(printf '\t')"
case "$0" in
/*) SELF="$0" ;;
*) SELF="$PWD/$0" ;;
esac

say() { printf '%s\n' "$*"; }
note() { printf 'overlap: %s\n' "$*" >&2; }
fail() {
	note "$*"
	exit 1
}
usage() {
	note "$*"
	sed -n '5,6p' "$SELF" | sed 's/^# \{0,1\}//' >&2
	exit 64
}

BASE="" BRANCHES="" COUNT=0
while [ $# -gt 0 ]; do
	case "$1" in
	-C)
		[ $# -ge 2 ] || usage "-C needs a directory"
		cd "$2" 2>/dev/null || fail "could not enter $2."
		shift 2
		;;
	--base)
		[ $# -ge 2 ] || usage "--base needs a commit"
		BASE="$2"
		shift 2
		;;
	-h | --help | help)
		awk 'NR > 1 && !/^#/ { exit } NR > 1 { sub(/^# ?/, ""); print }' "$SELF"
		exit 0
		;;
	-*) usage "unknown argument: $1" ;;
	*)
		case "$1" in
		*"$TAB"* | *'
'*) usage "a branch name cannot hold a tab or a newline" ;;
		esac
		case "
$BRANCHES" in
		*"
$1
"*) usage "'$1' is named twice" ;;
		esac
		BRANCHES="$BRANCHES$1
"
		COUNT=$((COUNT + 1))
		shift
		;;
	esac
done
[ -n "$BASE" ] || usage "--base <commit> is required (the commit the branches are headed for)"
[ "$COUNT" -ge 2 ] || usage "name at least two branches"

git rev-parse --git-dir >/dev/null 2>&1 || fail "this is not a git repository."
# `merge-tree --write-tree` arrived in git 2.38; an older git reads the same
# arguments as its three-tree form and answers something else entirely.
git version | awk '{ split($3, v, "."); exit !(v[1] > 2 || (v[1] == 2 && v[2] >= 38)) }' ||
	fail "this needs git 2.38 or later ($(git version)). Nothing was compared."

commit() { # <what> <commit-ish>
	git rev-parse --verify --quiet "$2^{commit}" || fail "$1 '$2' names no commit here. Nothing was compared."
}
BASE_OID="$(commit "the base" "$BASE")" || exit 1

tmp="$(mktemp -d "${TMPDIR:-/tmp}/overlap.XXXXXX")" || fail "could not create a temporary directory."
# shellcheck disable=SC2064 # expand now: the directory this run made
trap "rm -rf '$tmp'" EXIT

# The files a trial merge of two commits conflicts in, one per line, into
# $tmp/conflicts; returns 0 when it merges, 1 when it conflicts.
trial() { # <ours> <theirs>
	local rc=0
	git merge-tree --write-tree --name-only --no-messages "$1" "$2" >"$tmp/merge" 2>"$tmp/err" || rc=$?
	case "$rc" in
	0) : >"$tmp/conflicts" ;;
	1) sed 1d "$tmp/merge" | awk 'NF' | sort -u >"$tmp/conflicts" ;;
	*) fail "could not trial-merge $1 and $2: $(cat "$tmp/err"). Nothing here says they merge." ;;
	esac
	return "$rc"
}

RESULT="" WORST=clean
record() { RESULT="$RESULT$*
"; }
worse() { # <clean|overlap|conflict>
	case "$WORST:$1" in
	clean:overlap | clean:conflict | overlap:conflict) WORST="$1" ;;
	esac
}

# Every branch against the base. LIVE holds the ones the base lacks.
LIVE=""
while IFS= read -r b; do
	[ -n "$b" ] || continue
	oid="$(commit "the branch" "$b")" || exit 1
	if git merge-base --is-ancestor "$oid" "$BASE_OID"; then
		record "branch=$b$TAB$oid${TAB}merged"
		continue
	fi
	git merge-base "$oid" "$BASE_OID" >/dev/null || fail "'$b' and the base share no history. Nothing was compared."
	LIVE="$LIVE$b$TAB$oid
"
	if trial "$BASE_OID" "$oid"; then
		record "branch=$b$TAB$oid${TAB}clean"
	else
		record "branch=$b$TAB$oid${TAB}conflict"
		while IFS= read -r path; do record "base-conflict=$b$TAB$path"; done <"$tmp/conflicts"
		worse conflict
	fi
done <<EOF
$BRANCHES
EOF

# Every pair of them, in the order they were named.
printf '%s' "$LIVE" >"$tmp/live"
i=0
while IFS="$TAB" read -r a aoid; do
	i=$((i + 1))
	j=0
	while IFS="$TAB" read -r b boid; do
		j=$((j + 1))
		[ "$j" -gt "$i" ] || continue
		if git merge-base --is-ancestor "$aoid" "$boid" || git merge-base --is-ancestor "$boid" "$aoid"; then
			record "pair=$a$TAB$b${TAB}stacked"
			continue
		fi
		# Where each left the base or the other branch, whichever is nearer:
		# a parent both are stacked on, and what the base gained between
		# their fork points, are neither branch's own change.
		if ! afork="$(git merge-base "$aoid" "$boid" "$BASE_OID")" || ! bfork="$(git merge-base "$boid" "$aoid" "$BASE_OID")"; then
			fail "'$a' and '$b' share no history. Nothing was compared."
		fi
		git diff --name-only "$afork" "$aoid" | sort -u >"$tmp/a" || fail "could not list what '$a' touches."
		git diff --name-only "$bfork" "$boid" | sort -u >"$tmp/b" || fail "could not list what '$b' touches."
		comm -12 "$tmp/a" "$tmp/b" >"$tmp/shared"
		verdict=clean
		[ ! -s "$tmp/shared" ] || verdict=overlap
		trial "$aoid" "$boid" || verdict=conflict
		record "pair=$a$TAB$b$TAB$verdict"
		while IFS= read -r path; do record "shared=$a$TAB$b$TAB$path"; done <"$tmp/shared"
		while IFS= read -r path; do record "conflict=$a$TAB$b$TAB$path"; done <"$tmp/conflicts"
		worse "$verdict"
	done <"$tmp/live"
done <"$tmp/live"

printf 'outcome=%s\nbase=%s\n%s' "$WORST" "$BASE_OID" "$RESULT"
[ "$WORST" != conflict ] || {
	note "some of these branches do not merge as they stand. Nothing was changed: this is a forecast, and whichever merges second is the one that will need the rebase."
	exit 3
}
