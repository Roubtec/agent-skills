#!/usr/bin/env bash
# pr-branch.sh — the git mechanics of addressing one pull request.
#
# Usage, from the working location (the tree standing on the PR's head branch),
# or from anywhere with `-C <dir>` ahead of the command, as git takes it:
#   pr-branch.sh check
#   pr-branch.sh head      --repo <owner>/<repo> --pr <N> [--expect <head-oid>]
#   pr-branch.sh reconcile --repo <owner>/<repo> --pr <N>
#   pr-branch.sh pin-base  --repo <owner>/<repo> --base <branch>
#   pr-branch.sh pin-base  --target <ref>
#   pr-branch.sh push      --repo <owner>/<repo> --pr <N> --expect <head-oid>
#
# `<owner>/<repo>` is the repository the PR is in, read from the PR's own URL.
# Every `gh` call names it and the PR number; nothing is left to the directory.
# Its host is the one the selector names (`<host>/<owner>/<repo>`), else the
# host of the PR's own URL as `gh` reports it, else `$GH_HOST`, else
# github.com; a remote on another host is never the PR's.
#
# check      The tree is clean and no Git operation is in progress.
# head       For a tree that is NOT on the head branch (an orchestrator's, ahead
#            of attaching a worktree). Reads the PR, fetches its head ref, and
#            says how a local branch of the same name stands to it; it moves
#            nothing and needs no clean tree. `outcome=open` with `head=` (the
#            fetched commit: create or compare the branch at this, never at a
#            remote-tracking ref), `head-ref=`, `base-ref=`, `remote=`, and
#              relation=absent       no local branch of that name
#              relation=equal | behind | ahead | represented | divergent
#                                    with `local=`, read as reconcile reads them
#            and stops on rewind | fork | closed | no-remote. `--expect`
#            names a head read earlier: a fetched head behind THAT is a
#            rewind too, though GitHub now reports the rewound one.
#            `head` and `pin-base` read no FETCH_HEAD, which every fetch in a
#            tree shares, so several may run at once in one tree.
# reconcile  Runs `check`, reads the PR, fetches its head ref, and brings the
#            branch level with it where that loses nothing:
#              equal           the tip is the PR head
#              fast-forwarded  the tip was strictly behind and has been moved up
#                              (`was=` is where it stood; `tip=` is where the
#                              run starts from)
#              ahead           the PR head is an ancestor of the tip
#              represented     every commit unique to the PR head is in the tip
#                              by patch-id (the branch was rebased)
#            and stops, changing nothing, on:
#              divergent       the PR head holds commits the tip lacks, or a
#                              merge commit carrying content of its own
#              rewind          the fetched head is behind the one GitHub reports
#              fork | closed | wrong-branch | no-remote | dirty
# pin-base   Prints the commit a base resolves to right now: `--base` fetches
#            that branch from the PR's repository, `--target` resolves a ref
#            the request named in this checkout and substitutes nothing.
# push       Runs `check`, confirms the PR is open and its head is still
#            `--expect`, then publishes HEAD to the head ref:
#              up-to-date      the tip is already the PR head; the push was a
#                              no-op ("Everything up-to-date"), advanced=no
#              pushed          mode=fast-forward, or mode=rewrite; advanced=yes
#            and stops on:
#              behind          the tip is a proper ancestor of the PR head
#              head-moved      the PR head is no longer `--expect`
#              rejected        git refused the push, and every push URL
#                              answered the read-back without the tip; never
#                              retried with --force
#              unconfirmed     some push URL does not show the tip at the head
#                              ref or did not answer, whatever the push command
#                              answered
#            Every push carries an exact --force-with-lease on `--expect`, and
#            is confirmed by `git ls-remote` on every push URL, after a refused
#            push as well.
#
# Output: `key=value` lines on stdout, `outcome=` first; the explanation of a
# stop goes to stderr. Exit status: 0 to proceed, 3 on a stop that needs a
# decision, 1 on a failure (network, gh), 64 on a usage error.
#
# It never stashes, resets, cleans, rebases, deletes a ref, merges beyond the
# one fast-forward above, or pushes with a bare --force. Written for bash 3.2
# and later.
set -u

SEP="$(printf '\037')"
# This file, by a path that survives `-C`.
case "$0" in
/*) SELF="$0" ;;
*) SELF="$PWD/$0" ;;
esac

say() { printf '%s\n' "$*"; }
note() { printf 'pr-branch: %s\n' "$*" >&2; }
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
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

REPO="" PR="" EXPECT="" BASE="" TARGET=""

parse() {
	while [ $# -gt 0 ]; do
		case "$1" in
		--repo) REPO="${2:-}" ;;
		--pr) PR="${2:-}" ;;
		--expect) EXPECT="${2:-}" ;;
		--base) BASE="${2:-}" ;;
		--target) TARGET="${2:-}" ;;
		*) usage "unknown argument: $1" ;;
		esac
		[ $# -ge 2 ] || usage "$1 needs a value"
		shift 2
	done
}
need_repo() {
	case "$REPO" in
	?*/?*) ;;
	*) usage "--repo <owner>/<repo> is required (the repository the PR is in)" ;;
	esac
}
need_pr() {
	case "$PR" in
	'' | *[!0-9]*) usage "--pr <N> is required" ;;
	esac
}

# Why the tree is not clean and idle; empty when it is.
busy_reason() {
	local out p f
	out="$(git status --porcelain 2>/dev/null)" || {
		printf 'git status failed here'
		return
	}
	if [ -n "$out" ]; then
		printf 'uncommitted changes'
		return
	fi
	for p in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG; do
		f="$(git rev-parse --git-path "$p" 2>/dev/null)" || continue
		if [ -e "$f" ]; then
			printf 'a Git operation is in progress (%s)' "$p"
			return
		fi
	done
	# Under the reftable backend these are refs with no file of their own.
	for p in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD; do
		if git rev-parse --verify --quiet "$p" >/dev/null 2>&1; then
			printf 'a Git operation is in progress (%s)' "$p"
			return
		fi
	done
}
require_idle() {
	git rev-parse --show-toplevel >/dev/null 2>&1 || fail "not inside a Git working tree"
	local why
	why="$(busy_reason)"
	[ -z "$why" ] || stop dirty "$(git rev-parse --show-toplevel): $why. Nothing was changed; commit, stash or finish it first." "reason=$why"
}

# Does a configured URL name the repository $2 (lowercase owner/repo) on the
# host $1? Understood: scheme://[user@]host[:port]/owner/repo and the scp form
# [user@]host:owner/repo, with or without a trailing slash or `.git`.
names_repo() { # host, owner/repo, url
	local u rest port
	u="$(lower "$3")"
	u="${u%/}"
	u="${u%.git}"
	case "$u" in
	*://*) u="${u#*://}" ;;
	esac
	# Drop a user part, which sits ahead of the first slash.
	case "${u%%/*}" in
	*@*) u="${u#*@}" ;;
	esac
	# GitHub's SSH-over-443 endpoint is github.com under another name.
	case "$u" in
	ssh.github.com[:/]*) u="${u#ssh.}" ;;
	esac
	case "$u" in
	"$1/$2" | "$1:$2") return 0 ;;
	"$1":*/"$2")
		rest="${u#"$1":}"
		port="${rest%%/*}"
		case "$port" in
		'' | *[!0-9]*) return 1 ;;
		esac
		[ "${rest#*/}" = "$2" ] && return 0
		;;
	esac
	return 1
}
# Succeeds when one of the URLs on stdin names the repository $2 on host $1.
any_names_repo() {
	local u
	while IFS= read -r u; do
		[ -n "$u" ] && names_repo "$1" "$2" "$u" && return 0
	done
	return 1
}
# The host find_remote looks for; it runs in a subshell, so this re-derives it.
wanted_host() {
	local host
	host="$(lower "$REPO" | awk -F/ 'NF > 2 { print $1 }')"
	[ -n "$host" ] || host="$(lower "${P_HOST:-${GH_HOST:-github.com}}")"
	printf '%s' "$host"
}
# The remote of this checkout that both fetches from $REPO and pushes to it.
# The match is on the URLs as configured, so a local insteadOf rewrite does not
# hide it. A remote whose push URLs all point elsewhere is not a match: a push
# through it would never reach the PR. `find_remote fetch` asks only where it
# fetches from, for a command that pushes nothing.
find_remote() {
	local host want r matches="" pick="" cur
	# The same reading `gh --repo [HOST/]OWNER/REPO` gives the selector.
	want="$(lower "$REPO" | awk -F/ '{ print $(NF-1) "/" $NF }')"
	host="$(wanted_host)"
	for r in $(git remote); do
		# `git fetch <remote>` reads the FIRST url only, so that one decides.
		git config --get-all "remote.$r.url" | head -n 1 | any_names_repo "$host" "$want" || continue
		[ "${1:-}" = fetch ] || { git config --get-all "remote.$r.pushurl" || git config --get-all "remote.$r.url"; } |
			any_names_repo "$host" "$want" || continue
		matches="$matches$r
"
	done
	[ -n "$matches" ] || return 1
	cur="$(git branch --show-current)"
	for r in "$(git config --get "branch.$cur.pushRemote")" "$(git config --get "branch.$cur.remote")" origin; do
		[ -n "$r" ] || continue
		if printf '%s' "$matches" | grep -Fqx -- "$r"; then
			pick="$r"
			break
		fi
	done
	[ -n "$pick" ] || pick="$(printf '%s' "$matches" | head -n 1)"
	printf '%s' "$pick"
}

P_STATE="" P_HEAD="" P_OID="" P_BASE="" P_CROSS="" P_HOST=""
read_pr() {
	local out
	out="$(gh pr view "$PR" --repo "$REPO" --json state,headRefName,headRefOid,baseRefName,isCrossRepository,url \
		--jq '[.state, .headRefName, .headRefOid, .baseRefName, (.isCrossRepository | tostring), .url] | join("\u001f")')" ||
		fail "could not read PR #$PR in $REPO (gh failed). Nothing was changed."
	local url
	IFS="$SEP" read -r P_STATE P_HEAD P_OID P_BASE P_CROSS url <<EOF
$out
EOF
	# The host this PR is on, which is the host its remote has to be on.
	url="${url#*://}"
	P_HOST="${url%%/*}"
	[ -n "$P_HEAD" ] && [ -n "$P_OID" ] || fail "PR #$PR in $REPO answered without a head ref. Nothing was changed."
}
# Is $1 an ancestor of $2? A probe that could not run (a missing object, a
# partial clone offline) is neither answer: it fails the command, since read as
# "no" it would send a push down the rewrite arm.
is_ancestor() {
	local rc=0
	git merge-base --is-ancestor "$1" "$2" 2>/dev/null || rc=$?
	[ "$rc" -le 1 ] || fail "could not tell whether $1 is an ancestor of $2 (git merge-base failed). Nothing was changed, and nothing was pushed."
	return "$rc"
}
# The checks every command that touches the head ref shares.
require_open() {
	[ "$P_CROSS" != true ] || stop fork "PR #$PR is a fork PR: its head lives in another repository, which is not supported."
	[ "$P_STATE" = OPEN ] || stop closed "PR #$PR is $P_STATE, not open." "state=$P_STATE"
}
require_head_branch() {
	require_open
	local cur
	cur="$(git branch --show-current)"
	[ "$cur" = "$P_HEAD" ] || stop wrong-branch "this tree is on '${cur:-a detached HEAD}', but PR #$PR publishes from '$P_HEAD'." "branch=$cur" "head-ref=$P_HEAD"
}
# The commit a branch of the remote names now, with its objects fetched. Not
# read from FETCH_HEAD: every fetch in a tree shares that file, so two of
# these overlapping would each read the other's line.
fetch_ref() { # remote, branch → prints the fetched commit
	local oid again
	for _ in 1 2; do
		oid="$(git ls-remote "$1" "refs/heads/$2" 2>/dev/null | cut -f1)"
		[ -n "$oid" ] || return 1
		# --no-write-fetch-head needs git 2.29; older gits just write the file.
		git fetch --quiet --no-write-fetch-head "$1" "refs/heads/$2" >/dev/null 2>&1 ||
			git fetch --quiet "$1" "refs/heads/$2" >/dev/null 2>&1 || return 1
		# The same answer on both sides of the fetch is the head it fetched. A
		# ref that moved in between gets one more try, then is a failure: an
		# object already here would otherwise pass for the head.
		again="$(git ls-remote "$1" "refs/heads/$2" 2>/dev/null | cut -f1)"
		if [ "$again" = "$oid" ] && git cat-file -e "$oid^{commit}" 2>/dev/null; then
			printf '%s\n' "$oid"
			return 0
		fi
	done
	return 1
}

cmd_check() {
	[ $# -eq 0 ] || usage "check takes no arguments"
	require_idle
	say "outcome=clean"
	say "branch=$(git branch --show-current)"
	say "tip=$(git rev-parse HEAD)"
}

# Commits unique to $2 that $1 does not carry: non-merge commits by patch-id,
# and any merge that is more than the automatic join of its parents.
unrepresented() { # tip, head
	local m parents auto merges
	# A comparison that could not run (a missing object, a partial clone
	# offline) proves nothing: fail it, since empty output means "none lost".
	git rev-list --right-only --cherry-pick --no-merges "$1...$2" || return 1
	merges="$(git rev-list --merges "$1..$2")" || return 1
	for m in $merges; do
		parents="$(git rev-list --parents -n 1 "$m" | cut -d' ' -f2-)"
		auto=""
		# shellcheck disable=SC2086 # the parents are separate arguments
		[ "$(printf '%s' "$parents" | wc -w)" -eq 2 ] &&
			auto="$(git merge-tree --write-tree $parents 2>/dev/null | head -n 1)"
		[ -n "$auto" ] && [ "$auto" = "$(git rev-parse "$m^{tree}")" ] || say "$m"
	done
}

# A fetched head behind the one GitHub reports is a rewind, not an advance.
refuse_rewind() { # fetched head, extra key=value line
	local seen
	# The head GitHub reports now, and one the caller read earlier.
	for seen in "$P_OID" "$EXPECT"; do
		[ -n "$seen" ] && [ "$1" != "$seen" ] || continue
		if git cat-file -e "$seen^{commit}" 2>/dev/null && git merge-base --is-ancestor "$1" "$seen"; then
			stop rewind "the head ref now points at $1, which is behind the $seen recorded for PR #$PR. A maintainer decides; nothing was adopted." \
				"fetched=$1" "reported=$seen" "$2"
		fi
	done
}

cmd_head() {
	parse "$@"
	need_repo
	need_pr
	git rev-parse --git-dir >/dev/null 2>&1 || fail "not inside a Git repository"
	read_pr
	require_open
	local remote head tip relation lost
	remote="$(find_remote)" || stop no-remote "no remote of this checkout both fetches from and pushes to $REPO on $(wanted_host), so the head ref cannot be fetched."
	head="$(fetch_ref "$remote" "$P_HEAD")" || fail "could not fetch refs/heads/$P_HEAD from $remote. Nothing was changed."
	tip="$(git rev-parse --verify --quiet "refs/heads/$P_HEAD^{commit}")" || tip=""
	refuse_rewind "$head" "local=${tip:-absent}"
	if [ -z "$tip" ]; then
		relation=absent
	elif [ "$tip" = "$head" ]; then
		relation=equal
	elif git merge-base --is-ancestor "$tip" "$head"; then
		relation=behind
	elif git merge-base --is-ancestor "$head" "$tip"; then
		relation=ahead
	else
		lost="$(unrepresented "$tip" "$head")" || fail "could not compare the local $P_HEAD with the PR head $head, so whether its commits are carried there is not established. Nothing was changed."
		if [ -n "$lost" ]; then relation=divergent; else relation=represented; fi
	fi
	say "outcome=open"
	say "head=$head"
	say "head-ref=$P_HEAD"
	say "base-ref=$P_BASE"
	say "remote=$remote"
	say "relation=$relation"
	[ -z "$tip" ] || say "local=$tip"
}

cmd_reconcile() {
	parse "$@"
	need_repo
	need_pr
	require_idle
	read_pr
	require_head_branch
	local remote start head tip lost
	remote="$(find_remote)" || stop no-remote "no remote of this checkout both fetches from and pushes to $REPO on $(wanted_host), so the head ref cannot be reconciled."
	start="$(git rev-parse HEAD)"
	head="$(fetch_ref "$remote" "$P_HEAD")" || fail "could not fetch refs/heads/$P_HEAD from $remote. Nothing was changed."
	# The fetch took its time on the network: what follows moves whichever
	# branch is checked out now, so it must still be the one read before it.
	require_head_branch
	[ "$(git rev-parse HEAD)" = "$start" ] || fail "this branch moved off $start while the head ref was being fetched. Nothing was changed."
	refuse_rewind "$head" "tip=$start"
	tip="$start"
	if [ "$tip" = "$head" ]; then
		say "outcome=equal"
	elif is_ancestor "$tip" "$head"; then
		git merge --quiet --ff-only "$head" >/dev/null 2>&1 || fail "could not fast-forward $P_HEAD to $head. Nothing was changed."
		tip="$(git rev-parse HEAD)"
		say "outcome=fast-forwarded"
	elif is_ancestor "$head" "$tip"; then
		say "outcome=ahead"
	else
		lost="$(unrepresented "$tip" "$head")" || fail "could not compare this branch with the PR head $head, so whether its commits are carried here is not established. Nothing was changed."
		if [ -n "$lost" ]; then
			say "outcome=divergent"
			say "head=$head"
			say "tip=$tip"
			# shellcheck disable=SC2086 # one commit id per word
			git log --no-show-signature --no-walk --format='remote-only=%H %s' $lost
			git log --no-show-signature --format='local-only=%H %s' "$head..$tip"
			note "the PR head and this branch each hold work the other lacks. Do not pick a side, merge or rebase: report both tips and ask the maintainer."
			exit 3
		fi
		say "outcome=represented"
	fi
	say "head=$head"
	say "tip=$tip"
	say "was=$start"
	say "base-ref=$P_BASE"
	say "remote=$remote"
}

cmd_pin_base() {
	parse "$@"
	local oid remote
	if [ -n "$TARGET" ]; then
		[ -z "$BASE" ] || usage "give --base or --target, not both"
		oid="$(git rev-parse --verify --quiet "$TARGET^{commit}")" ||
			stop unresolved "'$TARGET' does not resolve to a commit in this checkout. Nothing was substituted for it." "target=$TARGET"
		say "outcome=pinned"
		say "base=$oid"
		say "source=target $TARGET, resolved in this checkout"
		return 0
	fi
	[ -n "$BASE" ] || usage "pin-base needs --base <branch> or --target <ref>"
	need_repo
	remote="$(find_remote fetch)" || stop no-remote "no remote of this checkout fetches from $REPO on $(wanted_host), so its $BASE cannot be fetched."
	oid="$(fetch_ref "$remote" "$BASE")" || fail "could not fetch refs/heads/$BASE from $remote. A stale ref is not a fallback."
	say "outcome=pinned"
	say "base=$oid"
	say "source=$BASE, fetched from $remote ($REPO)"
}

cmd_push() {
	parse "$@"
	need_repo
	need_pr
	case "$EXPECT" in
	'' | *[!0-9a-f]*) usage "--expect <head-oid> is required: the full PR head this run reconciled against" ;;
	esac
	[ "${#EXPECT}" -ge 40 ] || usage "--expect must be a full commit id"
	require_idle
	read_pr
	require_head_branch
	local remote tip fetched mode url got raw bad="" seen="" refused=0 urls=0 landed=0 unread=0 urlfile
	tip="$(git rev-parse HEAD)"
	[ "$P_OID" = "$EXPECT" ] || stop head-moved "PR #$PR's head is now $P_OID, not the $EXPECT this run worked against. Nothing was pushed." "now=$P_OID" "expected=$EXPECT" "tip=$tip"
	remote="$(find_remote)" || stop no-remote "no remote of this checkout both fetches from and pushes to $REPO on $(wanted_host), so there is no push target."
	fetched="$(fetch_ref "$remote" "$P_HEAD")" || fail "could not fetch refs/heads/$P_HEAD from $remote. Nothing was pushed."
	[ "$fetched" = "$EXPECT" ] || stop head-moved "refs/heads/$P_HEAD on $remote is now $fetched, not the $EXPECT this run worked against. Nothing was pushed." "now=$fetched" "expected=$EXPECT" "tip=$tip"

	# One exclusion chain: the stop first, because the lease MATCHES there.
	if [ "$tip" != "$EXPECT" ] && is_ancestor "$tip" "$EXPECT"; then
		stop behind "this branch is behind the PR head: there is nothing of yours to publish, and a lease push would rewind the PR. Nothing was pushed." "expected=$EXPECT" "tip=$tip"
	elif [ "$tip" = "$EXPECT" ]; then
		mode=none
	elif is_ancestor "$EXPECT" "$tip"; then
		mode=fast-forward
	else
		mode=rewrite
	fi
	# Everything the read-back needs exists before the push, so nothing can fail
	# between a push and the account of it.
	urlfile="$(mktemp "${TMPDIR:-/tmp}/pr-branch.XXXXXX")" || fail "could not create a temporary file for the read-back. Nothing was pushed."
	git remote get-url --push --all "$remote" >"$urlfile" 2>/dev/null
	# The lease is exact on every push, the fast-forward included: the remote
	# is only ever replaced where it still holds the head this run worked on.
	# What is pushed is the commit the checks above read, not whatever HEAD
	# names by the time the fetch has returned.
	git push --quiet "$remote" "--force-with-lease=refs/heads/$P_HEAD:$EXPECT" "$tip:refs/heads/$P_HEAD" >&2 || refused=1

	# Read the ref back through every push URL, after a refused push as well:
	# with several push URLs one can take the update before another refuses.
	# A URL that did not answer is not one that lacks the tip.
	while IFS= read -r url; do
		[ -n "$url" ] || continue
		urls=$((urls + 1))
		if raw="$(git ls-remote "$url" "refs/heads/$P_HEAD" 2>/dev/null)"; then
			got="$(printf '%s' "$raw" | cut -f1)"
			seen="$seen
readback=$url ${got:-absent}"
			if [ "$got" = "$tip" ]; then
				landed=$((landed + 1))
			else
				bad=1
			fi
		else
			unread=$((unread + 1))
			bad=1
			seen="$seen
readback=$url no answer"
		fi
	done <"$urlfile"
	rm -f "$urlfile"
	# `rejected` claims nothing was pushed, so every URL has to have said so.
	if [ "$refused" = 1 ] && [ "$urls" -gt 0 ] && [ "$unread" = 0 ] && [ "$landed" = 0 ]; then
		stop rejected "the push to refs/heads/$P_HEAD on $remote was refused, and every push URL answered without $tip: the remote moved, or the push is not permitted. Never retry with --force." "expected=$EXPECT" "tip=$tip"
	fi
	if [ -n "$bad" ] || [ "$urls" = 0 ]; then
		say "outcome=unconfirmed"
		say "mode=$mode"
		say "tip=$tip"
		say "expected=$EXPECT"
		if [ "$refused" = 1 ]; then say "push-command=refused"; else say "push-command=returned"; fi
		# Every URL's answer, the ones that do show the tip included.
		printf '%s\n' "$seen" | awk 'NF'
		note "the head ref does not show $tip at every push URL ($landed of $urls do, $unread did not answer). Whether this push reached origin is not established; read the ref before going on."
		exit 3
	fi
	if [ "$mode" = none ]; then
		say "outcome=up-to-date"
		say "advanced=no"
	else
		say "outcome=pushed"
		say "advanced=yes"
	fi
	say "mode=$mode"
	say "head=$tip"
	say "previous=$EXPECT"
	say "remote=$remote"
}

if [ "${1:-}" = -C ]; then
	[ $# -ge 2 ] || usage "-C needs a directory"
	cd -- "$2" 2>/dev/null || fail "cannot enter $2"
	shift 2
fi
[ $# -ge 1 ] || usage "a command is required"
command="$1"
shift
case "$command" in
check) cmd_check "$@" ;;
head) cmd_head "$@" ;;
reconcile) cmd_reconcile "$@" ;;
pin-base) cmd_pin_base "$@" ;;
push) cmd_push "$@" ;;
-h | --help | help)
	awk 'NR > 1 && !/^#/ { exit } NR > 1 { sub(/^# ?/, ""); print }' "$SELF"
	;;
*) usage "unknown command: $command" ;;
esac
