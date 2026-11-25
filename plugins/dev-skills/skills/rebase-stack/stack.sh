#!/usr/bin/env bash
# stack.sh — the ref arithmetic of rebasing a chain of local branches.
#
# Usage, from the tree the rebase runs in:
#   stack.sh preflight [--source <branch>] [--target <ref>]
#   stack.sh detect    --source <branch> --target <ref> [--repo <o/r>] [--offline]
#   stack.sh segments  <b1> <b2> ... <bN>
#   stack.sh qualify   --base <ref> <first> ... <last>
#   stack.sh snapshot  --stamp <stamp> <branch>...
#   stack.sh verify    --stamp <stamp> --base <ref> <first> ... <last>
#   stack.sh restore   --stamp <stamp> <branch>...
#
# It never fetches, pushes, rebases, or deletes a ref, and reads local refs
# only — but for `detect`, which also asks gh for the open PRs where it can.
# `snapshot` creates refs under refs/pre-rebase/, and `restore` moves the
# branches it is given back to those snapshots in one guarded transaction.
#
# preflight  Nothing is staged or modified and no rebase is in progress.
#            `outcome=ready` with target=, target-oid=, source=, source-oid=,
#            untracked=<count> and stamp=<YYYYMMDD-HHMMSS> — the one stamp
#            every snapshot of this run shares. The target defaults to main,
#            then master; the source to the current branch. Stops on:
#              dirty | rebase-in-progress | no-target | no-source
#            It also removes the tip records of earlier runs whose snapshots
#            are all deleted (`swept=<n>` where it removed any).
# detect     The chain between a source and a target, by the effective
#            frontier: the newest source commit that is patch-equivalent to
#            one on the target, else their merge-base.
#              outcome=chain | empty
#              ef=<oid>  ef-subject=  ef-kind=patch-equivalent|merge-base
#              equivalent=<n>   source commits the target already carries
#              branch=<name> TAB <tip> TAB <n> TAB <next> TAB <subject>
#                  one per chain branch in stacking order, the source last;
#                  <n> is its commits past <next>, the branch above it
#              evidence=<name> TAB <why>  a chain branch with no commit of
#                  its own past the source, taken for one because an open PR
#                  publishes from it, or else because it tracks an upstream
#              prs=read|unavailable|skipped   whether gh listed the open PRs
#                  (`--repo` names the repository to ask, else gh's own
#                  default for this tree; `--offline` skips the question)
#              near=<name> TAB <why>      on the spine, but not a candidate
#              merged=<name>              on the spine, every commit already
#                  carried by the target: a merged predecessor left behind,
#                  which keeps a run from being replayed in one go until it
#                  is deleted
#              checkpoint=<name>          a branch the source is an ancestor of
#              target-oid=, and where a cached origin/<target> exists:
#              origin-oid=, origin-ahead=, origin-behind= (commits origin
#              has past local, and local past origin), and origin-read=, when
#              that cached ref last changed, where its reflog says
# segments   Splits a confirmed chain where one tip is not an ancestor of the
#            next: `segment=run <b>...` (two or more) or `segment=single <b>`.
# qualify    Whether one run may be replayed once with --update-refs onto
#            `--base` (the target for the chain's first branch, else the
#            rebased tip of the branch before the run):
#              outcome=combined   fork=, base-oid=, replay=<the command>, and
#                                 detach-first=<branch> where this tree stands
#                                 on a run branch
#              outcome=per-branch reason=<which check failed>
# snapshot   Saves refs/pre-rebase/<branch>/<stamp> for each branch, and the
#            tips of every local branch as they stand, for `verify` (one
#            small `rebase-stack-<stamp>.heads` file in the git dir, which a
#            later preflight removes once the run's snapshots are deleted).
#            `outcome=saved`, one `ref=` line each. Stops on `conflict` where
#            that snapshot already exists with another commit.
# verify     After a combined replay: exactly the run's branches moved, each
#            off its snapshot, onto the base, each an ancestor of the next.
#              outcome=verified
#            and stops on:
#              postcondition-failed   restore the run, then go branch by branch
#              outside-moved          a branch outside the run moved: stop
# restore    Puts every branch of a run back on its snapshot, all or none,
#            each update guarded by the commit the branch holds now.
#            Detaches this tree first if it stands on one of them.
#              outcome=restored
#            and stops, moving nothing, on:
#              rebase-in-progress | no-snapshot | checked-out | ref-moved
#
# Output: `key=value` lines on stdout, `outcome=` first; the explanation of a
# stop goes to stderr. Exit status: 0 to proceed, 3 on a stop that needs a
# decision, 1 on a failure, 64 on a usage error. Written for bash 3.2 and
# later; needs nothing beyond git, and uses gh where it is there.
set -u

TAB="$(printf '\t')"
case "$0" in
/*) SELF="$0" ;;
*) SELF="$PWD/$0" ;;
esac

say() { printf '%s\n' "$*"; }
note() { printf 'stack: %s\n' "$*" >&2; }
fail() {
	note "$*"
	exit 1
}
usage() {
	note "$*"
	sed -n '4,11p' "$SELF" | sed 's/^# \{0,1\}//' >&2
	exit 64
}
# stop <outcome> <explanation> [extra key=value lines...]
stop() {
	say "outcome=$1"
	note "$2"
	shift 2
	local l
	for l in "$@"; do say "$l"; done
	exit 3
}

SOURCE="" TARGET="" BASE="" STAMP="" BRANCHES="" REPO="" OFFLINE=0

parse() {
	while [ $# -gt 0 ]; do
		case "$1" in
		--offline)
			OFFLINE=1
			shift
			;;
		--source | --target | --base | --stamp | --repo)
			[ $# -ge 2 ] || usage "$1 needs a value"
			case "$1" in
			--source) SOURCE="$2" ;;
			--target) TARGET="$2" ;;
			--base) BASE="$2" ;;
			--stamp) STAMP="$2" ;;
			--repo) REPO="$2" ;;
			esac
			shift 2
			;;
		-*) usage "unknown argument: $1" ;;
		*)
			BRANCHES="$BRANCHES $1"
			shift
			;;
		esac
	done
	BRANCHES="${BRANCHES# }"
}
in_repo() { git rev-parse --git-dir >/dev/null 2>&1 || fail "not inside a Git repository"; }
oid() { git rev-parse --verify --quiet "$1^{commit}"; }
tip() { git rev-parse --verify --quiet "refs/heads/$1^{commit}"; }
# What a target or base names: the local branch of that name where there is
# one — a tag called `main` must not answer for the branch — else any revision.
commit_of() { tip "$1" || oid "$1"; }
need_branches() { # minimum count
	local n=0 b
	for b in $BRANCHES; do
		tip "$b" >/dev/null || fail "'$b' is not a local branch"
		n=$((n + 1))
	done
	[ "$n" -ge "$1" ] || usage "this command needs at least $1 branch name(s)"
}
need_stamp() {
	case "$STAMP" in
	'' | *[!0-9A-Za-z-]*) usage "--stamp <stamp> is required: the one preflight printed" ;;
	esac
}
rebasing() {
	local p f
	for p in rebase-merge rebase-apply; do
		f="$(git rev-parse --git-path "$p" 2>/dev/null)" || continue
		[ ! -e "$f" ] || return 0
	done
	return 1
}
# Every local branch and its tip. Not %(refname:short), which prints
# `heads/<name>` for a branch that shares its name with a tag.
heads() { git for-each-ref --format='%(refname) %(objectname)' refs/heads/ | sed 's|^refs/heads/||'; }
# In the common git dir, so every worktree of the repository reads one record.
frozen_file() { printf '%s/rebase-stack-%s.heads' "$(cd "$(git rev-parse --git-common-dir)" && pwd)" "$STAMP"; }
# Removes the tip records of runs whose snapshots are all gone: no run can
# verify against one any more. Nothing tells this script a run has ended, so
# the next run's preflight clears up after it. Prints how many it removed.
sweep() {
	local dir refs f stamp n=0
	dir="$(cd "$(git rev-parse --git-common-dir)" && pwd)" || return 0
	refs="$(git for-each-ref --format='%(refname)' refs/pre-rebase/)" || return 0
	for f in "$dir"/rebase-stack-[0-9]*-[0-9]*.heads "$dir"/rebase-stack-[0-9]*-[0-9]*.taken; do
		[ -f "$f" ] || continue
		stamp="${f##*/rebase-stack-}"
		stamp="${stamp%.*}"
		case "$stamp" in *[!0-9-]*) continue ;; esac
		printf '%s\n' "$refs" | grep -q "/$stamp\$" && continue
		rm -f "$f" && n=$((n + 1))
	done
	printf '%s' "$n"
}
# The open PRs of the repository, where gh can be asked: `<head branch> TAB
# <number>` lines in PRS. It is evidence for one question only — whether a
# branch on the source's own history is a branch of the stack — so a gh that
# is missing, signed out or offline is no failure: PRS_STATE says which.
PRS="" PRS_STATE=skipped
read_prs() {
	[ "$OFFLINE" = 0 ] || return 0
	PRS_STATE=unavailable
	command -v gh >/dev/null 2>&1 || return 0
	local out
	# shellcheck disable=SC2016 # the \(...) are jq's
	set -- pr list --state open --limit 200 --json number,headRefName,isCrossRepository \
		--jq '.[] | select(.isCrossRepository | not) | "\(.headRefName)\t\(.number)"'
	[ -z "$REPO" ] || set -- "$@" --repo "$REPO"
	out="$(gh "$@" 2>/dev/null)" || return 0
	PRS="$out" PRS_STATE=read
}
# Why a branch with no commit of its own is still taken for a branch of the
# stack: an open PR publishes from it, else it tracks an upstream. Empty where
# neither holds, which leaves it a `near=` line.
evidence() { # branch
	local n up
	n="$(printf '%s\n' "$PRS" | awk -F'\t' -v b="$1" '("b:" $1) == ("b:" b) { print $2; exit }')"
	if [ -n "$n" ]; then
		printf 'open PR #%s' "$n"
		return 0
	fi
	up="$(git for-each-ref --format='%(upstream:short)' "refs/heads/$1")"
	[ -z "$up" ] || printf 'upstream %s' "$up"
}
# Fails where a branch is checked out in a worktree other than this one,
# printing that worktree.
elsewhere() { # branch
	local here wt="" key val
	here="$(git rev-parse --show-toplevel)"
	while read -r key val; do
		case "$key" in
		worktree) wt="$val" ;;
		branch)
			if [ "$val" = "refs/heads/$1" ] && [ "$wt" != "$here" ]; then
				printf '%s' "$wt"
				return 0
			fi
			;;
		esac
	done <<EOF
$(git worktree list --porcelain)
EOF
	return 1
}

cmd_preflight() {
	parse "$@"
	[ -z "$BRANCHES" ] || usage "preflight takes --source and --target only"
	in_repo
	local dirty t s swept
	swept="$(sweep)"
	# The rebase first: a paused one leaves the tree dirty, and is the truer answer.
	! rebasing || stop rebase-in-progress "a rebase is already in progress here. Finish or abort it first."
	dirty="$(git status --porcelain --untracked-files=no 2>/dev/null)" || fail "git status failed here"
	[ -z "$dirty" ] || stop dirty "there are staged or modified files. Commit, stash or clean them first; nothing is stashed for you."
	if [ -n "$TARGET" ]; then
		t="$TARGET"
	elif tip main >/dev/null; then
		t=main
	elif tip master >/dev/null; then
		t=master
	else
		stop no-target "there is no local main or master. Name the target."
	fi
	commit_of "$t" >/dev/null || stop no-target "'$t' does not resolve to a commit here." "target=$t"
	s="${SOURCE:-$(git branch --show-current)}"
	[ -n "$s" ] || stop no-source "HEAD is detached and no source was named."
	tip "$s" >/dev/null || stop no-source "'$s' is not a local branch." "source=$s"
	say "outcome=ready"
	say "target=$t"
	say "target-oid=$(commit_of "$t")"
	say "source=$s"
	say "source-oid=$(tip "$s")"
	say "untracked=$(git status --porcelain --untracked-files=all 2>/dev/null | grep -c '^??')"
	say "stamp=$(date +%Y%m%d-%H%M%S)"
	[ "${swept:-0}" = 0 ] || say "swept=$swept"
}

cmd_detect() {
	parse "$@"
	[ -z "$BRANCHES" ] || usage "detect takes --source, --target, --repo and --offline only"
	[ -n "$SOURCE" ] && [ -n "$TARGET" ] || usage "detect needs --source <branch> and --target <ref>"
	in_repo
	local s t ef kind marks equiv x xt mb n rows="" near="" sorted next left why found=""
	s="$(tip "$SOURCE")" || fail "'$SOURCE' is not a local branch"
	t="$(commit_of "$TARGET")" || fail "'$TARGET' does not resolve to a commit"
	marks="$(git rev-list --right-only --cherry-mark --no-merges "$t...$s")" || fail "could not compare $SOURCE with $TARGET"
	ef="$(printf '%s\n' "$marks" | sed -n 's/^=//p' | head -n 1)"
	equiv="$(printf '%s\n' "$marks" | grep -c '^=')"
	kind=patch-equivalent
	if [ -z "$ef" ]; then
		ef="$(git merge-base "$s" "$t")" || fail "$SOURCE and $TARGET share no history"
		kind=merge-base
	fi
	read_prs
	while read -r x xt; do
		[ -n "$x" ] || continue
		[ "$x" != "$SOURCE" ] && [ "$x" != "$TARGET" ] || continue
		mb="$(git merge-base "$xt" "$s" 2>/dev/null)" || continue
		# A branch above the source is flagged wherever the frontier lies, and
		# is never a chain branch: it would be replayed BELOW the source.
		if [ "$xt" != "$s" ] && [ "$mb" = "$s" ]; then
			near="$near
checkpoint=$x"
			continue
		fi
		# A branch on the source's history whose every commit the target already
		# carries is a merged predecessor left behind. It is no chain branch,
		# but it points into the range a combined replay moves, so it is named.
		if [ "$mb" = "$xt" ] && ! git merge-base --is-ancestor "$xt" "$t"; then
			left="$(git rev-list --right-only --cherry-pick "$t...$xt")" || fail "could not compare $x with $TARGET"
			if [ -z "$left" ]; then
				near="$near
merged=$x"
				continue
			fi
		fi
		[ "$mb" != "$ef" ] || continue
		git merge-base --is-ancestor "$ef" "$mb" || continue
		n="$(git rev-list --count "$ef..$mb")"
		if [ "$(git rev-list --count "$s..$xt")" = 0 ]; then
			# On the source's own history with no commit past it: a branch of a
			# linear stack, or a snapshot ref. Only evidence tells them apart.
			why="$(evidence "$x")"
			if [ -z "$why" ]; then
				near="$near
near=$x${TAB}no commits of its own past $SOURCE, no open PR and no upstream (a snapshot ref, or an unpublished chain branch: name it in an explicit chain to carry it)"
				continue
			fi
			found="$found
evidence=$x$TAB$why"
			rows="$rows
$n 0 $x"
			continue
		fi
		rows="$rows
$n 1 $x"
	done <<EOF
$(heads)
EOF
	# From the frontier up; where a branch forks at another's tip, the tip first.
	sorted="$(printf '%s\n' "$rows" | awk 'NF' | sort -k1,1n -k2,2n -k3,3)"
	if [ -n "$sorted" ]; then say "outcome=chain"; else say "outcome=empty"; fi
	say "ef=$ef"
	say "ef-subject=$(git log --no-show-signature -1 --format=%s "$ef")"
	say "ef-kind=$kind"
	say "equivalent=$equiv"
	say "prs=$PRS_STATE"
	# Each chain branch against the one above it; the source closes the list.
	# shellcheck disable=SC2046 # one branch name per word
	set -- $(printf '%s\n' "$sorted" | awk 'NF { print $3 }') "$SOURCE"
	while [ $# -gt 0 ]; do
		if [ $# -gt 1 ]; then
			next="$2"
			n="$(git rev-list --count "refs/heads/$next..refs/heads/$1")"
		else
			next=source
			n=0
		fi
		say "branch=$1$TAB$(tip "$1")$TAB$n$TAB$next$TAB$(git log --no-show-signature -1 --format=%s "refs/heads/$1")"
		shift
	done
	printf '%s\n' "$found" | awk 'NF'
	printf '%s\n' "$near" | awk 'NF'
	say "target-oid=$t"
	local o read_at
	if o="$(git rev-parse --verify --quiet "refs/remotes/origin/$TARGET^{commit}")"; then
		say "origin-oid=$o"
		say "origin-ahead=$(git rev-list --count "$t..$o")"
		say "origin-behind=$(git rev-list --count "$o..$t")"
		read_at="$(git log --no-show-signature -g -1 --date=relative --format=%gd "refs/remotes/origin/$TARGET" 2>/dev/null | sed -n 's/.*@{\(.*\)}$/\1/p')"
		[ -z "$read_at" ] || say "origin-read=$read_at"
	fi
}

cmd_segments() {
	parse "$@"
	need_branches 1
	in_repo
	local run="" count=0 prev="" b
	flush() {
		[ "$count" -gt 0 ] || return 0
		if [ "$count" -ge 2 ]; then say "segment=run$run"; else say "segment=single$run"; fi
		run="" count=0
	}
	say "outcome=segments"
	for b in $BRANCHES; do
		if [ -n "$prev" ] && ! git merge-base --is-ancestor "$(tip "$prev")" "$(tip "$b")"; then
			flush
		fi
		run="$run $b"
		count=$((count + 1))
		prev="$b"
	done
	flush
}

per_branch() {
	say "outcome=per-branch"
	say "reason=$*"
	exit 0
}

cmd_qualify() {
	parse "$@"
	[ -n "$BASE" ] || usage "qualify needs --base <ref>: the target, or the rebased tip of the branch before this run"
	need_branches 2
	in_repo
	local base last lastb="" forks fork b t range prev="" here wt br detach="" key val
	base="$(commit_of "$BASE")" || fail "'$BASE' does not resolve to a commit"
	for b in $BRANCHES; do lastb="$b"; done
	last="$(tip "$lastb")"
	forks="$(git merge-base --all "$base" "$last")" || per_branch "the base and $lastb share no history"
	[ "$(printf '%s\n' "$forks" | awk 'NF' | wc -l | tr -d ' ')" = 1 ] || per_branch "the base and $lastb have more than one merge-base, so the replay boundary is not unique"
	fork="$forks"
	[ "$fork" != "$base" ] || per_branch "the run already starts at the base, so there is nothing to replay together"
	[ -z "$(git rev-list --merges "$fork..$last")" ] || per_branch "the run carries a merge commit"
	# One fork and no merge make the range a single line, so nothing in it can
	# lie off the way from the fork to the last tip.
	range="$(git rev-list "$fork..$last")"
	for b in $BRANCHES; do
		t="$(tip "$b")"
		printf '%s\n' "$range" | grep -Fqx -- "$t" || per_branch "$b's tip is not in the replay range"
		[ -z "$prev" ] || git merge-base --is-ancestor "$prev" "$t" || per_branch "$b does not descend from the run branch before it"
		prev="$t"
	done
	# Exactly the run's branches may point into the replay range.
	while read -r br t; do
		[ -n "$br" ] || continue
		printf '%s\n' "$range" | grep -Fqx -- "$t" || continue
		case " $BRANCHES " in
		*" $br "*) ;;
		*) per_branch "local branch $br also points into the replay range, and --update-refs would move it" ;;
		esac
	done <<EOF
$(heads)
EOF
	# Git must actually replay every intermediate tip.
	local marks
	marks="$(git rev-list --right-only --cherry-mark --no-merges "$base...$last")" || fail "could not compare the base with $lastb"
	for b in $BRANCHES; do
		[ "$b" != "$lastb" ] || continue
		printf '%s\n' "$marks" | grep -Fqx -- "+$(tip "$b")" || per_branch "$b's tip is patch-equivalent to a commit on the base, so the replay would drop it and leave the ref behind"
	done
	# No run branch may be checked out, bar this tree's, which can step aside.
	here="$(git rev-parse --show-toplevel)"
	wt=""
	while read -r key val; do
		case "$key" in
		worktree) wt="$val" ;;
		branch)
			br="${val#refs/heads/}"
			case " $BRANCHES " in
			*" $br "*)
				[ "$wt" = "$here" ] || per_branch "$br is checked out in another worktree ($wt)"
				detach="$br"
				;;
			esac
			;;
		esac
	done <<EOF
$(git worktree list --porcelain)
EOF
	say "outcome=combined"
	say "fork=$fork"
	say "base-oid=$base"
	[ -z "$detach" ] || say "detach-first=$detach"
	say "replay=git rebase --update-refs --no-rebase-merges --no-fork-point $base $(printf '%q' "$lastb")"
}

cmd_snapshot() {
	parse "$@"
	need_stamp
	need_branches 1
	in_repo
	local b t ref have out=""
	for b in $BRANCHES; do
		t="$(tip "$b")"
		ref="refs/pre-rebase/$b/$STAMP"
		have="$(git rev-parse --verify --quiet "$ref")" || have=""
		[ -z "$have" ] || [ "$have" = "$t" ] || stop conflict "$ref already holds $have, and $b is now at $t. Nothing was saved; take a new stamp rather than overwrite a snapshot." "ref=$ref"
	done
	for b in $BRANCHES; do
		t="$(tip "$b")"
		ref="refs/pre-rebase/$b/$STAMP"
		git rev-parse --verify --quiet "$ref" >/dev/null ||
			git update-ref "$ref" "$t" "" || fail "could not create $ref"
		out="$out
ref=$ref $t"
	done
	heads >"$(frozen_file)" || fail "could not record the local branch tips"
	say "outcome=saved"
	printf '%s\n' "$out" | awk 'NF'
}

cmd_verify() {
	parse "$@"
	need_stamp
	[ -n "$BASE" ] || usage "verify needs --base <ref>: the base the run was replayed onto"
	need_branches 2
	in_repo
	local base frozen b t was snap prev="" moved="" br
	base="$(commit_of "$BASE")" || fail "'$BASE' does not resolve to a commit"
	frozen="$(frozen_file)"
	[ -f "$frozen" ] || fail "there is no record of the branch tips for stamp $STAMP: snapshot the run before replaying it"
	while read -r br was; do
		[ -n "$br" ] || continue
		t="$(tip "$br")" || t="(gone)"
		[ "$t" != "$was" ] || continue
		case " $BRANCHES " in
		*" $br "*) ;;
		*) moved="$moved
moved=$br $was $t" ;;
		esac
	done <"$frozen"
	if [ -n "$moved" ]; then
		say "outcome=outside-moved"
		printf '%s\n' "$moved" | awk 'NF'
		note "a branch outside the run moved during the replay. Stop and report it; a fallback would hide it."
		exit 3
	fi
	for b in $BRANCHES; do
		t="$(tip "$b")"
		snap="$(git rev-parse --verify --quiet "refs/pre-rebase/$b/$STAMP")" || stop postcondition-failed "$b has no snapshot for stamp $STAMP." "branch=$b"
		[ "$t" != "$snap" ] || stop postcondition-failed "$b did not move off its snapshot. Restore the run and go branch by branch." "branch=$b"
		git merge-base --is-ancestor "$base" "$t" || stop postcondition-failed "$b does not descend from the base. Restore the run and go branch by branch." "branch=$b"
		[ -z "$prev" ] || git merge-base --is-ancestor "$prev" "$t" || stop postcondition-failed "$b does not descend from the run branch before it. Restore the run and go branch by branch." "branch=$b"
		prev="$t"
	done
	say "outcome=verified"
}

cmd_restore() {
	parse "$@"
	need_stamp
	need_branches 1
	in_repo
	! rebasing || stop rebase-in-progress "a rebase is in progress here. Abort it first; nothing was restored."
	local b snap cur lines="" here wt
	for b in $BRANCHES; do
		! wt="$(elsewhere "$b")" || stop checked-out "$b is checked out in another worktree ($wt): moving it from here would leave that tree's files on the rebased commit. Nothing was restored; restore from there, or free the branch first." "branch=$b"
	done
	for b in $BRANCHES; do
		snap="$(git rev-parse --verify --quiet "refs/pre-rebase/$b/$STAMP")" || stop no-snapshot "$b has no snapshot for stamp $STAMP. Nothing was restored." "branch=$b"
		cur="$(tip "$b")" || stop ref-moved "$b is no longer a local branch: it was deleted since this command read it. Nothing was restored; a restore never recreates a branch." "branch=$b"
		lines="$lines
update refs/heads/$b $snap $cur"
	done
	here="$(git branch --show-current)"
	case " $BRANCHES " in
	*" $here "*) git checkout --quiet --detach >/dev/null 2>&1 || fail "could not detach this tree from $here. Nothing was restored." ;;
	esac
	{
		say start
		printf '%s\n' "$lines" | awk 'NF'
		say prepare
		say commit
	} | git update-ref --stdin >/dev/null 2>&1 ||
		stop ref-moved "the restore transaction was refused: a branch moved since it was read, or a ref is locked. Nothing was restored; report the unexpected movement."
	for b in $BRANCHES; do
		[ "$(tip "$b")" = "$(git rev-parse --verify --quiet "refs/pre-rebase/$b/$STAMP")" ] || fail "$b is not at its snapshot after the restore"
	done
	say "outcome=restored"
	for b in $BRANCHES; do say "branch=$b $(tip "$b")"; done
}

[ $# -ge 1 ] || usage "a command is required"
command="$1"
shift
case "$command" in
preflight) cmd_preflight "$@" ;;
detect) cmd_detect "$@" ;;
segments) cmd_segments "$@" ;;
qualify) cmd_qualify "$@" ;;
snapshot) cmd_snapshot "$@" ;;
verify) cmd_verify "$@" ;;
restore) cmd_restore "$@" ;;
-h | --help | help)
	awk 'NR > 1 && !/^#/ { exit } NR > 1 { sub(/^# ?/, ""); print }' "$SELF"
	;;
*) usage "unknown command: $command" ;;
esac
