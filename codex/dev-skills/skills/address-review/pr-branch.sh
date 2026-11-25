#!/usr/bin/env bash
# pr-branch.sh — the git mechanics of addressing one pull request.
#
# Usage, from the working location (the tree standing on the PR's head branch):
#   pr-branch.sh check
#   pr-branch.sh reconcile --repo <owner>/<repo> --pr <N>
#   pr-branch.sh pin-base  --repo <owner>/<repo> --base <branch>
#   pr-branch.sh pin-base  --target <ref>
#   pr-branch.sh push      --repo <owner>/<repo> --pr <N> --expect <head-oid>
#
# `<owner>/<repo>` is the repository the PR is in, read from the PR's own URL.
# Every `gh` call names it and the PR number; nothing is left to the directory.
#
# check      The tree is clean and no Git operation is in progress.
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
#              rejected        git refused the push and no push URL shows the
#                              tip; never retried with --force
#              unconfirmed     some push URL does not show the tip at the head
#                              ref, whatever the push command answered
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

say() { printf '%s\n' "$*"; }
note() { printf 'pr-branch: %s\n' "$*" >&2; }
fail() {
	note "$*"
	exit 1
}
usage() {
	note "$*"
	sed -n '4,9p' "$0" | sed 's/^# \{0,1\}//' >&2
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

# Does a configured URL name $1 (a lowercase owner/repo)?
names_repo() { # want, url
	local u
	u="$(lower "$2")"
	u="${u%/}"
	u="${u%.git}"
	case "$u" in
	*[:/]"$1") return 0 ;;
	esac
	return 1
}
# Succeeds when one of the URLs on stdin names $1.
any_names_repo() {
	local u
	while IFS= read -r u; do
		[ -n "$u" ] && names_repo "$1" "$u" && return 0
	done
	return 1
}
# The remote of this checkout that both fetches from $REPO and pushes to it.
# The match is on the URLs as configured, so a local insteadOf rewrite does not
# hide it. A remote whose push URLs all point elsewhere is not a match: a push
# through it would never reach the PR.
find_remote() {
	local want r matches="" pick="" cur
	# A host-qualified selector (host/owner/repo) is matched on owner/repo.
	want="$(lower "$REPO" | awk -F/ '{ print $(NF-1) "/" $NF }')"
	for r in $(git remote); do
		git config --get-all "remote.$r.url" | any_names_repo "$want" || continue
		{ git config --get-all "remote.$r.pushurl" || git config --get-all "remote.$r.url"; } |
			any_names_repo "$want" || continue
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

P_STATE="" P_HEAD="" P_OID="" P_BASE="" P_CROSS=""
read_pr() {
	local out
	out="$(gh pr view "$PR" --repo "$REPO" --json state,headRefName,headRefOid,baseRefName,isCrossRepository \
		--jq '[.state, .headRefName, .headRefOid, .baseRefName, (.isCrossRepository | tostring)] | join("\u001f")')" ||
		fail "could not read PR #$PR in $REPO (gh failed). Nothing was changed."
	IFS="$SEP" read -r P_STATE P_HEAD P_OID P_BASE P_CROSS <<EOF
$out
EOF
	[ -n "$P_HEAD" ] && [ -n "$P_OID" ] || fail "PR #$PR in $REPO answered without a head ref. Nothing was changed."
}
# The checks every command that touches the head ref shares.
require_head_branch() {
	[ "$P_CROSS" != true ] || stop fork "PR #$PR is a fork PR: its head lives in another repository, which is not supported."
	[ "$P_STATE" = OPEN ] || stop closed "PR #$PR is $P_STATE, not open." "state=$P_STATE"
	local cur
	cur="$(git branch --show-current)"
	[ "$cur" = "$P_HEAD" ] || stop wrong-branch "this tree is on '${cur:-a detached HEAD}', but PR #$PR publishes from '$P_HEAD'." "branch=$cur" "head-ref=$P_HEAD"
}
fetch_ref() { # remote, branch → prints the fetched commit
	git fetch --quiet "$1" "refs/heads/$2" >/dev/null 2>&1 || return 1
	git rev-parse --verify --quiet 'FETCH_HEAD^{commit}'
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
	local m parents auto
	git rev-list --right-only --cherry-pick --no-merges "$1...$2"
	for m in $(git rev-list --merges "$1..$2"); do
		parents="$(git rev-list --parents -n 1 "$m" | cut -d' ' -f2-)"
		auto=""
		# shellcheck disable=SC2086 # the parents are separate arguments
		[ "$(printf '%s' "$parents" | wc -w)" -eq 2 ] &&
			auto="$(git merge-tree --write-tree $parents 2>/dev/null | head -n 1)"
		[ -n "$auto" ] && [ "$auto" = "$(git rev-parse "$m^{tree}")" ] || say "$m"
	done
}

cmd_reconcile() {
	parse "$@"
	need_repo
	need_pr
	require_idle
	read_pr
	require_head_branch
	local remote start head tip lost
	remote="$(find_remote)" || stop no-remote "no remote of this checkout both fetches from and pushes to $REPO, so the head ref cannot be reconciled."
	start="$(git rev-parse HEAD)"
	head="$(fetch_ref "$remote" "$P_HEAD")" || fail "could not fetch refs/heads/$P_HEAD from $remote. Nothing was changed."
	if [ "$head" != "$P_OID" ] && git cat-file -e "$P_OID^{commit}" 2>/dev/null &&
		git merge-base --is-ancestor "$head" "$P_OID"; then
		stop rewind "the head ref now points at $head, which is behind the $P_OID GitHub reports for PR #$PR. A maintainer decides; nothing was adopted." \
			"fetched=$head" "reported=$P_OID" "tip=$start"
	fi
	tip="$start"
	if [ "$tip" = "$head" ]; then
		say "outcome=equal"
	elif git merge-base --is-ancestor "$tip" "$head"; then
		git merge --quiet --ff-only "$head" >/dev/null 2>&1 || fail "could not fast-forward $P_HEAD to $head. Nothing was changed."
		tip="$(git rev-parse HEAD)"
		say "outcome=fast-forwarded"
	elif git merge-base --is-ancestor "$head" "$tip"; then
		say "outcome=ahead"
	else
		lost="$(unrepresented "$tip" "$head")"
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
	remote="$(find_remote)" || stop no-remote "no remote of this checkout points at $REPO, so its $BASE cannot be fetched."
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
	local remote tip fetched mode url got bad="" refused=0 urls=0 landed=0 urlfile
	tip="$(git rev-parse HEAD)"
	[ "$P_OID" = "$EXPECT" ] || stop head-moved "PR #$PR's head is now $P_OID, not the $EXPECT this run worked against. Nothing was pushed." "now=$P_OID" "expected=$EXPECT" "tip=$tip"
	remote="$(find_remote)" || stop no-remote "no remote of this checkout both fetches from and pushes to $REPO, so there is no push target."
	fetched="$(fetch_ref "$remote" "$P_HEAD")" || fail "could not fetch refs/heads/$P_HEAD from $remote. Nothing was pushed."
	[ "$fetched" = "$EXPECT" ] || stop head-moved "refs/heads/$P_HEAD on $remote is now $fetched, not the $EXPECT this run worked against. Nothing was pushed." "now=$fetched" "expected=$EXPECT" "tip=$tip"

	# One exclusion chain: the stop first, because the lease MATCHES there.
	if [ "$tip" != "$EXPECT" ] && git merge-base --is-ancestor "$tip" "$EXPECT"; then
		stop behind "this branch is behind the PR head: there is nothing of yours to publish, and a lease push would rewind the PR. Nothing was pushed." "expected=$EXPECT" "tip=$tip"
	elif [ "$tip" = "$EXPECT" ]; then
		mode=none
	elif git merge-base --is-ancestor "$EXPECT" "$tip"; then
		mode=fast-forward
	else
		mode=rewrite
	fi
	# The lease is exact on every push, the fast-forward included: the remote
	# is only ever replaced where it still holds the head this run worked on.
	git push --quiet "$remote" "--force-with-lease=refs/heads/$P_HEAD:$EXPECT" "HEAD:refs/heads/$P_HEAD" >&2 || refused=1

	# Read the ref back through every push URL, after a refused push as well:
	# with several push URLs one can take the update before another refuses.
	urlfile="$(mktemp "${TMPDIR:-/tmp}/pr-branch.XXXXXX")" || fail "could not create a temporary file to read the push back; the push command had already run."
	git remote get-url --push --all "$remote" >"$urlfile" 2>/dev/null
	while IFS= read -r url; do
		[ -n "$url" ] || continue
		urls=$((urls + 1))
		got="$(git ls-remote "$url" "refs/heads/$P_HEAD" 2>/dev/null | cut -f1)"
		if [ "$got" = "$tip" ]; then
			landed=$((landed + 1))
		else
			bad="$bad
readback=$url ${got:-no answer}"
		fi
	done <"$urlfile"
	rm -f "$urlfile"
	if [ "$refused" = 1 ] && [ "$landed" = 0 ]; then
		stop rejected "the push to refs/heads/$P_HEAD on $remote was refused and no push URL shows $tip: the remote moved, or the push is not permitted. Never retry with --force." "expected=$EXPECT" "tip=$tip"
	fi
	if [ -n "$bad" ] || [ "$urls" = 0 ]; then
		say "outcome=unconfirmed"
		say "mode=$mode"
		say "tip=$tip"
		say "expected=$EXPECT"
		if [ "$refused" = 1 ]; then say "push-command=refused"; else say "push-command=returned"; fi
		printf '%s\n' "$bad" | awk 'NF'
		note "the head ref does not show $tip at every push URL ($landed of $urls do). Whether this push reached origin is not established; read the ref before going on."
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

[ $# -ge 1 ] || usage "a command is required"
command="$1"
shift
case "$command" in
check) cmd_check "$@" ;;
reconcile) cmd_reconcile "$@" ;;
pin-base) cmd_pin_base "$@" ;;
push) cmd_push "$@" ;;
-h | --help | help)
	awk 'NR > 1 && !/^#/ { exit } NR > 1 { sub(/^# ?/, ""); print }' "$0"
	;;
*) usage "unknown command: $command" ;;
esac
