#!/usr/bin/env bash
# added-files.sh — which newly added files more than one of a run's branches
# holds, by path and by basename, read by ref and without a worktree.
#
# Usage:
#   added-files.sh [-C <dir>] <branch>:<its base> [<branch>:<its base>]...
#
# Each `<branch>` and each base is a branch name or a commit this repository
# already holds; nothing is fetched. A branch is read against its own base in
# the three-dot form, from where it left that base, so a branch stacked on a
# sibling never lists the files it inherited from it. A file a branch renamed
# into place is a file it added, whatever `diff.renames` says here.
#
# For every branch, in the order named, it prints
#   branch=<branch> TAB <its base> TAB <how many files it adds>
# then, for what more than one of the branches adds,
#   path=<path> TAB <branch>
#                  one per branch that adds this exact path
#   basename=<name> TAB <branch> TAB <path>
#                  one per added file whose last path component more than one
#                  branch adds, at whatever path; a `path=` file is here too
# and every added file, for a comparison this script does not make (two files
# of different names that declare the same top-level symbol):
#   added=<branch> TAB <path>
# under
#   outcome=clean      no path and no basename is added by two branches
#   outcome=duplicate  at least one is (exit 3)
#
# Nothing is written to the repository. A path with unusual characters is
# printed as git quotes it, and its basename is read from that form.
#
# Output: `key=value` lines on stdout, `outcome=` first. Exit status: 0 on
# clean, 3 on duplicate, 1 on a failure (a commit that does not resolve, a
# branch and its base with no common ancestor), 64 on a usage error. Written
# for bash 3.2 and later.
set -u
# Paths as they are, not C-quoted: they are compared and printed as names.
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.quotePath GIT_CONFIG_VALUE_0=false

TAB="$(printf '\t')"
case "$0" in
/*) SELF="$0" ;;
*) SELF="$PWD/$0" ;;
esac

say() { printf '%s\n' "$*"; }
note() { printf 'added-files: %s\n' "$*" >&2; }
fail() {
	note "$*"
	exit 1
}
usage() {
	note "$*"
	sed -n '5,6p' "$SELF" | sed 's/^# \{0,1\}//' >&2
	exit 64
}

SPECS="" NAMED="" COUNT=0
while [ $# -gt 0 ]; do
	case "$1" in
	-C)
		[ $# -ge 2 ] || usage "-C needs a directory"
		cd "$2" 2>/dev/null || fail "could not enter $2."
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
		?*:?*) ;;
		*) usage "'$1' is not <branch>:<its base>" ;;
		esac
		case "
$NAMED" in
		*"
${1%%:*}
"*) usage "'${1%%:*}' is named twice" ;;
		esac
		NAMED="$NAMED${1%%:*}
"
		SPECS="$SPECS$1
"
		COUNT=$((COUNT + 1))
		shift
		;;
	esac
done
[ "$COUNT" -ge 1 ] || usage "name at least one <branch>:<its base>"

git rev-parse --git-dir >/dev/null 2>&1 || fail "this is not a git repository."

tmp="$(mktemp -d "${TMPDIR:-/tmp}/added-files.XXXXXX")" || fail "could not create a temporary directory."
# shellcheck disable=SC2064 # expand now: the directory this run made
trap "rm -rf '$tmp'" EXIT

# Every added file, as `<branch> TAB <path>`.
: >"$tmp/all"
BRANCHES=""
while IFS= read -r spec; do
	[ -n "$spec" ] || continue
	b="${spec%%:*}"
	base="${spec#*:}"
	# As commits: a name git would read as an option never reaches the diff.
	oid="$(git rev-parse --verify --quiet "$b^{commit}")" || fail "the branch '$b' names no commit here. Nothing was compared."
	base_oid="$(git rev-parse --verify --quiet "$base^{commit}")" || fail "the base '$base' of '$b' names no commit here. Nothing was compared."
	git merge-base "$base_oid" "$oid" >/dev/null || fail "'$b' and its base '$base' share no history. Nothing was compared."
	git diff --no-renames --diff-filter=A --name-only "$base_oid...$oid" >"$tmp/adds" ||
		fail "could not list what '$b' adds against '$base'. Nothing was compared."
	while IFS= read -r path; do printf '%s\t%s\n' "$b" "$path"; done <"$tmp/adds" >>"$tmp/all"
	BRANCHES="${BRANCHES}branch=$b$TAB$base$TAB$(awk 'END { print NR }' "$tmp/adds")
"
done <<EOF
$SPECS
EOF

awk -F "$TAB" '
	{ rows[$2] = rows[$2] "path=" $2 "\t" $1 "\n"; count[$2]++ }
	END { for (p in count) if (count[p] > 1) printf "%s", rows[p] }' "$tmp/all" | sort >"$tmp/paths"
awk -F "$TAB" '
	{
		name = $2; sub(/.*\//, "", name)
		rows[name] = rows[name] "basename=" name "\t" $1 "\t" $2 "\n"
		if (!((name, $1) in seen)) { seen[name, $1] = 1; count[name]++ }
	}
	END { for (n in count) if (count[n] > 1) printf "%s", rows[n] }' "$tmp/all" | sort >"$tmp/names"

OUTCOME=clean
[ ! -s "$tmp/paths" ] && [ ! -s "$tmp/names" ] || OUTCOME=duplicate
say "outcome=$OUTCOME"
printf '%s' "$BRANCHES"
cat "$tmp/paths" "$tmp/names"
sed 's/^/added=/' "$tmp/all"
[ "$OUTCOME" = clean ] || {
	note "more than one of these branches adds the same path or the same file name. Nothing was changed: whether each is a collision, and which branch changes, is the caller's to decide."
	exit 3
}
