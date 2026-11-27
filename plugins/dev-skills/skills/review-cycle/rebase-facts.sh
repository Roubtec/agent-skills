#!/usr/bin/env bash
# rebase-facts.sh — what a rebase point would do, and whether a verdict
# survives what one did, read from objects alone.
#
# Usage:
#   rebase-facts.sh [-C <dir>] before --onto <commit> [--parent-tip <commit>] [<branch>]
#   rebase-facts.sh [-C <dir>] after --old-base <commit> --old-tip <commit> --new-base <commit> [<branch>]
#
# Every `<commit>` is an exact commit or a ref this repository already holds,
# and `<branch>` (default `HEAD`) is the branch the point is about. Nothing is
# fetched, so pin the target first and hand over the commit that pin printed.
#
# before — ahead of a rebase point. `--onto` is the pinned commit the branch
# is to go onto. `--parent-tip` is given for a stacked child only: the tip its
# parent had when the child was last based on it, which is the boundary of
# `git rebase --onto <onto> <parent-tip>`.
#
#   outcome=noop          a rebase here replays nothing and moves no tip: the
#                         fork point IS `--onto`, with no merge commit in the
#                         range (a replay flattens a merge even over an
#                         unmoved base, so a merge in range is never a no-op)
#   outcome=replay        a rebase here has something to do
#   outcome=stale-parent  `--parent-tip` is not an ancestor of the branch, so
#                         it bounds nothing and `--onto` from it would replay
#                         the parent's old commits as the child's (exit 3).
#                         Only `branch=`, `onto=` and `parent-tip=` follow.
#
#   branch=<oid> onto=<oid> [parent-tip=<oid>]
#   fork-point=<oid>      where the branch's own commits start: `--parent-tip`
#                         where one was given, else the merge base of the
#                         branch and `--onto`
#   replay=<n>            commits a rebase here would replay: the non-merge
#                         commits in <fork-point>..<branch>, and 0 on a no-op
#   merges=<n>            merge commits in that range, then one `merge=<oid>`
#                         for each
#   onto-ahead=<n>        commits `--onto` holds that the branch lacks; 0 is a
#                         target the branch already contains
#   paths=<disjoint|shared>
#                         whether a file changed between the fork point and
#                         `--onto` is also a file the branch's commits touch
#   onto-path=<path>      one per file that differs between the fork point and
#                         `--onto`: what changes underneath the branch
#   shared=<path>         one per file on both sides
#
# after — once a replay is done. `--old-base` and `--old-tip` are the fork
# point and the branch tip `before` printed, `--new-base` is the commit the
# replay landed on, and `<branch>` is the replayed tip.
#
#   outcome=unchanged     the tip is the old tip: nothing was replayed
#   outcome=carry         the replay is patch-identical AND the two sides'
#                         paths are disjoint
#   outcome=verify        either half is missing (exit 3)
#
#   old-base=<oid> old-tip=<oid> new-base=<oid> new-tip=<oid>
#   identical=<yes|no>    yes where <new-base>..<new-tip> holds the commits of
#                         <old-base>..<old-tip> one for one and in order, each
#                         with the same patch, author and message, and neither
#                         range holds a merge
#   reason=<merge|count|patch|message>
#                         on `identical=no`, the first way they differ: a merge
#                         in either range, a commit dropped or added, or a
#                         pair that differs, named by `differs=<old> TAB <new>`
#   old-commits=<n> new-commits=<n>
#   paths=<disjoint|shared>, onto-path=<path>, shared=<path>
#                         as under `before`, between the old base and the new
#
# A file is counted without rename detection, so a renamed file is touched
# under its old name and its new one, and a path with unusual characters is
# printed as git quotes it. `carry` answers for the files alone: a change
# under `onto-path=` that reaches beyond its own file (build or lint
# configuration, a dependency, a generated contract) is the reader's to spot.
#
# Read-only: objects are read and nothing is written, no ref, index, working
# tree or temporary file.
#
# Output: `key=value` lines on stdout, `outcome=` first. Exit status: 0 on
# noop, replay, unchanged and carry; 3 on stale-parent and verify; 1 on a
# failure (a commit that does not resolve, histories with no common ancestor,
# a base that is not an ancestor of its tip), with nothing on stdout; 64 on a
# usage error. Written for bash 3.2 and later.
set -u

TAB="$(printf '\t')"
case "$0" in
/*) SELF="$0" ;;
*) SELF="$PWD/$0" ;;
esac

note() { printf 'rebase-facts: %s\n' "$*" >&2; }
fail() {
	note "$*"
	exit 1
}
usage() {
	note "$*"
	sed -n '5,7p' "$SELF" | sed 's/^# \{0,1\}//' >&2
	exit 64
}

commit() { # <what> <commit-ish>
	git rev-parse --verify --quiet "$2^{commit}" || fail "$1 '$2' names no commit here. Nothing was read."
}
contains() { # <ancestor> <descendant>: 0 yes, 1 no
	local rc=0
	git merge-base --is-ancestor "$1" "$2" 2>/dev/null || rc=$?
	case "$rc" in
	0 | 1) return "$rc" ;;
	*) fail "could not compare $1 and $2. Nothing here says which contains which." ;;
	esac
}
# The files a range's commits touch, one per line; a merge counts against
# every parent.
touched() { # <base> <tip>
	local revs
	revs="$(git rev-list "$1..$2")" || fail "could not list $1..$2."
	[ -n "$revs" ] || return 0
	printf '%s\n' "$revs" | git diff-tree --stdin -m -r --no-renames --name-only --no-commit-id | awk 'NF' | sort -u
}
differing() { # <tree-ish> <tree-ish>
	git diff-tree -r --no-renames --name-only "$1" "$2" | sort -u
}
# PATHS (disjoint|shared) and PATH_LINES (the onto-path= and shared= lines)
# for a branch range <base>..<tip> moving from <base> to <onto>.
paths() { # <base> <tip> <onto>
	local under own both
	under="$(differing "$1" "$3")" || fail "could not list what differs between $1 and $3."
	own="$(touched "$1" "$2")" || exit 1
	both="$({
		printf '%s\n' "$under" | awk 'NF { print "u" $0 }'
		printf '%s\n' "$own" | awk 'NF { print "o" $0 }'
	} | awk '{ k = substr($0, 1, 1); p = substr($0, 2) } k == "u" { u[p] = 1; next } (p in u) { print p }')"
	PATHS=disjoint
	[ -z "$both" ] || PATHS=shared
	PATH_LINES="$(
		printf '%s\n' "$under" | awk 'NF { print "onto-path=" $0 }'
		printf '%s\n' "$both" | awk 'NF { print "shared=" $0 }'
	)"
	[ -z "$PATH_LINES" ] || PATH_LINES="$PATH_LINES
"
}

before() {
	local branch_oid onto_oid parent_oid="" fork replay merges count ahead outcome merge_lines=""
	branch_oid="$(commit "the branch" "$BRANCH")" || exit 1
	onto_oid="$(commit "--onto" "$ONTO")" || exit 1
	if [ -n "$PARENT" ]; then
		parent_oid="$(commit "--parent-tip" "$PARENT")" || exit 1
		if ! contains "$parent_oid" "$branch_oid"; then
			printf 'outcome=stale-parent\nbranch=%s\nonto=%s\nparent-tip=%s\n' "$branch_oid" "$onto_oid" "$parent_oid"
			note "--parent-tip is not an ancestor of the branch, so 'git rebase --onto' from it would replay the parent's old commits. Nothing was changed."
			exit 3
		fi
		fork="$parent_oid"
	else
		fork="$(git merge-base "$branch_oid" "$onto_oid")" || fail "the branch and --onto share no history. Nothing was read."
	fi
	replay="$(git rev-list --count --no-merges "$fork..$branch_oid")" || fail "could not count $fork..$branch_oid."
	merges="$(git rev-list --merges "$fork..$branch_oid")" || fail "could not list the merges in $fork..$branch_oid."
	count=0
	if [ -n "$merges" ]; then
		count="$(printf '%s\n' "$merges" | awk 'END { print NR }')"
		merge_lines="$(printf '%s\n' "$merges" | awk '{ print "merge=" $0 }')
"
	fi
	ahead="$(git rev-list --count "$branch_oid..$onto_oid")" || fail "could not count $branch_oid..$onto_oid."
	outcome=replay
	if [ "$fork" = "$onto_oid" ] && [ "$count" = 0 ]; then outcome=noop replay=0; fi
	paths "$fork" "$branch_oid" "$onto_oid"
	printf 'outcome=%s\nbranch=%s\nonto=%s\n' "$outcome" "$branch_oid" "$onto_oid"
	[ -z "$parent_oid" ] || printf 'parent-tip=%s\n' "$parent_oid"
	printf 'fork-point=%s\nreplay=%s\nmerges=%s\n%sonto-ahead=%s\npaths=%s\n%s' \
		"$fork" "$replay" "$count" "$merge_lines" "$ahead" "$PATHS" "$PATH_LINES"
}

# What a replay carries of one commit: its patch, and its author and message.
patch_of() { # <commit>
	git diff-tree -p --binary --no-renames --no-ext-diff --no-textconv --no-commit-id --root "$1" | git patch-id --stable | awk '{ print $1 }'
}
words_of() { # <commit>
	git cat-file commit "$1" | awk 'body { print; next } /^$/ { body = 1; print; next } /^author / { print }'
}

after() {
	local ob ot nb nt old new old_n new_n identical=yes reason="" differs="" o n outcome
	ob="$(commit "--old-base" "$OLD_BASE")" || exit 1
	ot="$(commit "--old-tip" "$OLD_TIP")" || exit 1
	nb="$(commit "--new-base" "$NEW_BASE")" || exit 1
	nt="$(commit "the branch" "$BRANCH")" || exit 1
	if [ "$ot" = "$nt" ]; then
		printf 'outcome=unchanged\nold-base=%s\nold-tip=%s\nnew-base=%s\nnew-tip=%s\n' "$ob" "$ot" "$nb" "$nt"
		return 0
	fi
	contains "$ob" "$ot" || fail "--old-base is not an ancestor of --old-tip, so it bounds no range. Nothing was compared."
	contains "$nb" "$nt" || fail "--new-base is not an ancestor of the branch, so the branch was not replayed onto it. Nothing was compared."
	old="$(git rev-list --reverse "$ob..$ot")" || fail "could not list $ob..$ot."
	new="$(git rev-list --reverse "$nb..$nt")" || fail "could not list $nb..$nt."
	old_n="$(printf '%s\n' "$old" | awk 'NF { n++ } END { print n + 0 }')"
	new_n="$(printf '%s\n' "$new" | awk 'NF { n++ } END { print n + 0 }')"
	if [ -n "$(git rev-list --merges "$ob..$ot")" ] || [ -n "$(git rev-list --merges "$nb..$nt")" ]; then
		identical=no reason=merge
	elif [ "$old_n" != "$new_n" ]; then
		identical=no reason=count
	else
		while IFS= read -r o <&3 && IFS= read -r n <&4; do
			[ -n "$o" ] || continue
			if [ "$(patch_of "$o")" != "$(patch_of "$n")" ]; then
				identical=no reason=patch differs="$o$TAB$n"
				break
			fi
			if [ "$(words_of "$o")" != "$(words_of "$n")" ]; then
				identical=no reason=message differs="$o$TAB$n"
				break
			fi
		done 3<<OLD 4<<NEW
$old
OLD
$new
NEW
	fi
	paths "$ob" "$ot" "$nb"
	outcome=verify
	if [ "$identical" = yes ] && [ "$PATHS" = disjoint ]; then outcome=carry; fi
	printf 'outcome=%s\nold-base=%s\nold-tip=%s\nnew-base=%s\nnew-tip=%s\nidentical=%s\n' "$outcome" "$ob" "$ot" "$nb" "$nt" "$identical"
	[ -z "$reason" ] || printf 'reason=%s\n' "$reason"
	[ -z "$differs" ] || printf 'differs=%s\n' "$differs"
	printf 'old-commits=%s\nnew-commits=%s\npaths=%s\n%s' "$old_n" "$new_n" "$PATHS" "$PATH_LINES"
	[ "$outcome" = carry ] || {
		note "this replay does not carry a verdict by itself (identical=$identical, paths=$PATHS): verify the replayed tree."
		exit 3
	}
}

CMD="" BRANCH="" ONTO="" PARENT="" OLD_BASE="" OLD_TIP="" NEW_BASE=""
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
	--onto | --parent-tip | --old-base | --old-tip | --new-base)
		[ $# -ge 2 ] && [ -n "$2" ] || usage "$1 needs a commit"
		case "$1" in
		--onto) ONTO="$2" ;;
		--parent-tip) PARENT="$2" ;;
		--old-base) OLD_BASE="$2" ;;
		--old-tip) OLD_TIP="$2" ;;
		--new-base) NEW_BASE="$2" ;;
		esac
		shift 2
		;;
	-*) usage "unknown argument: $1" ;;
	before | after)
		if [ -z "$CMD" ]; then CMD="$1"; elif [ -z "$BRANCH" ]; then BRANCH="$1"; else usage "more than one branch was named"; fi
		shift
		;;
	*)
		[ -n "$CMD" ] || usage "unknown command: $1"
		[ -z "$BRANCH" ] || usage "more than one branch was named"
		BRANCH="$1"
		shift
		;;
	esac
done
[ -n "$BRANCH" ] || BRANCH=HEAD

case "$CMD" in
before)
	[ -n "$ONTO" ] || usage "before needs --onto <commit> (the pinned commit the branch is to go onto)"
	[ -z "$OLD_BASE$OLD_TIP$NEW_BASE" ] || usage "--old-base, --old-tip and --new-base belong to after"
	;;
after)
	[ -n "$OLD_BASE" ] && [ -n "$OLD_TIP" ] && [ -n "$NEW_BASE" ] || usage "after needs --old-base, --old-tip and --new-base"
	[ -z "$ONTO$PARENT" ] || usage "--onto and --parent-tip belong to before"
	;;
*) usage "name a command: before or after" ;;
esac
git rev-parse --git-dir >/dev/null 2>&1 || fail "this is not a git repository."
"$CMD"
