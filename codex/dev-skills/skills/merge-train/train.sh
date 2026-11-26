#!/usr/bin/env bash
# train.sh — the mechanical steps of a merge train, read and done the one way.
#
# Usage:
#   train.sh survey --repo <owner>/<repo> <PR>...
#   train.sh check  --repo <owner>/<repo> --pr <N> [--head <oid>] [--lanes <n>] [--since <time>]
#   train.sh rebase --repo <owner>/<repo> --pr <N> --head <oid> [--green <oid>] [--from <parent's old tip>]
#   train.sh push   --repo <owner>/<repo> --pr <N> --expect <head-oid>
#   train.sh merge  --repo <owner>/<repo> --pr <N> --head <oid> [--wait <seconds>]
#
# `rebase` and `push` run in the PR's worktree: stand in it, or put
# `-C <worktree>` ahead of the command, as git takes it.
# `<owner>/<repo>` is the repository the PRs are in; write it
# `<host>/<owner>/<repo>` where that is not github.com.
#
# check   One PR's standing, every fact printed and the first thing in the way
#         named by the outcome:
#           outcome=ready     open, based on the default branch, no open review
#                             item, every lane settled and green
#           outcome=not-open  merged or closed (`state=`, `merge-commit=`)
#           outcome=moved     the head is not `--head`: someone pushed
#           outcome=review    an unresolved review thread, or a review
#                             requesting changes
#           outcome=stacked   its base is another branch, so it waits for its
#                             parent; merging it now would land nothing on the
#                             default branch
#           outcome=draft
#           outcome=red       a lane settled on something other than SUCCESS,
#                             NEUTRAL or SKIPPED: one `lane=` line each
#           outcome=waiting   a lane is still running, the rollup is empty, or
#                             it holds fewer passing lanes than `--lanes`
#         and always: pr= state= head= branch= base= default= draft=
#         mergeable= review= threads= ci= lanes= (the passing lanes: pass this
#         count of a full green run as `--lanes` later, since a rollup read
#         right after a push is empty or partial) and checked= (a time to pass
#         as `--since` next time).
#         `--since` adds one line per top-level comment or submitted review
#         newer than that time, of the latest 30 of each:
#           new=<comment|review:STATE> TAB <author> TAB <time> TAB <url>
#         Whether one of those carries actionable feedback is yours to read.
# survey  `check` over every listed PR, one line each, TAB-separated key=value
#         fields: pr= outcome= base= parent= (the listed PR whose branch this
#         one is based on, `-` for none) head= mergeable= review= threads= ci=
#         lanes= files=. Then one line per file two or more of them touch:
#           shared=<path> TAB <PR>,<PR>...
# rebase  Brings the worktree's branch level with the PR head where that loses
#         nothing, pins the default branch's tip, and rebases onto it with
#         `--no-update-refs --no-rebase-merges`. `--head` is the head whose
#         rollup you read: a PR head that is anything else is `moved`, and is
#         not rebased. With `--from`, replays only the commits after that
#         commit (a child whose parent has merged).
#           outcome=current   already on the default branch's tip; untouched
#           outcome=rebased   before= (the PR head: the lease for `push`)
#                             head= base= commits=
#           outcome=conflict  the rebase stopped: one `conflict=<path>` each,
#                             left in progress for you to resolve or abort
#         and stops, rebasing nothing, on moved, stacked, local-ahead (the
#         local branch holds commits the PR head lacks), bad-from, bad-green,
#         or whatever the reconciliation stopped on (dirty, divergent, closed,
#         …).
#         Every outcome past those also prints, read before the rebase:
#           landed=<n>        files changed on the default branch since the
#                             last full green run forked from it
#           overlap=<path>    each of those the PR touches too
#         `--green` is the head that last full green run was on. Leave it out
#         only while that is `--head` itself: once a PR has been rebased and
#         pushed without a full run going green on the new head, the fork
#         point of `--head` says nothing about what its last green run saw.
# push    Publishes the worktree's HEAD to the PR's head ref under an exact
#         lease on `--expect`, confirmed by reading the ref back.
#           outcome=pushed | up-to-date, with head=
#         and stops on head-moved, behind, rejected, refused, unconfirmed.
# merge   Checks the PR again (open, head still `--head`, based on the default
#         branch, not a draft, no open review item, not behind the default
#         branch), waits up to `--wait` seconds (90) for GitHub to settle
#         mergeability, then merges with a merge commit on exactly that head
#         and reads the result back.
#           outcome=merged    merge-commit= head=
#         and stops on not-open, moved, stacked, draft, review, behind,
#         conflicting, unsettled, async-required (GitHub wants this PR merged
#         through its asynchronous merge API), refused, unconfirmed.
#         It does not read CI: whether this head needs a fresh run is decided
#         before calling it. It never squashes, deletes a branch or bypasses
#         what the repository enforces.
#
# The branch mechanics and the rollup reading are not reimplemented here:
# they are `pr-branch.sh` and `ci.sh` of the `address-review` skill, called
# from that skill's folder beside this skill's.
#
# Output: `key=value` lines on stdout, `outcome=` first; the explanation of a
# stop goes to stderr. Exit status: 0 to proceed, 3 on anything else that was
# read cleanly (`check` exits 3 on every outcome but ready), 1 on a failure
# (network, gh), 64 on a usage error. Needs gh. Written for bash 3.2 and later.
set -u

TAB="$(printf '\t')"
case "$0" in
/*) SELF="$0" ;;
*) SELF="$PWD/$0" ;;
esac
SIBLING="$(dirname -- "$SELF")/../address-review"
PRB="$SIBLING/pr-branch.sh"
CI="$SIBLING/ci.sh"
POLL="${TRAIN_POLL_SECONDS:-5}"

say() { printf '%s\n' "$*"; }
note() { printf 'train: %s\n' "$*" >&2; }
fail() {
	note "$*"
	exit 1
}
usage() {
	note "$*"
	sed -n '4,9p' "$SELF" | sed 's/^# \{0,1\}//' >&2
	exit 64
}
stop() { # <outcome> <explanation> [key=value...]
	say "outcome=$1"
	note "$2"
	shift 2
	local l
	for l in "$@"; do say "$l"; done
	exit 3
}
need_sibling() {
	[ -f "$1" ] || fail "$1 is missing. This helper uses the address-review skill's scripts, which install in the folder beside this skill's."
}
# The value of the first `<key>=` line of a helper's output.
field() { # key, text
	printf '%s\n' "$2" | awk -v k="$1=" 'index($0, k) == 1 { print substr($0, length(k) + 1); exit }'
}

REPO="" PR="" HEAD="" LANES="" SINCE="" FROM="" EXPECT="" GREEN="" WAIT=90 PRS=""

parse() {
	while [ $# -gt 0 ]; do
		case "$1" in
		--repo | --pr | --head | --lanes | --since | --from | --expect | --green | --wait)
			[ $# -ge 2 ] || usage "$1 needs a value"
			case "$1" in
			--repo) REPO="$2" ;;
			--pr) PR="$2" ;;
			--head) HEAD="$2" ;;
			--lanes) LANES="$2" ;;
			--since) SINCE="$2" ;;
			--from) FROM="$2" ;;
			--expect) EXPECT="$2" ;;
			--green) GREEN="$2" ;;
			--wait) WAIT="$2" ;;
			esac
			shift 2
			;;
		-*) usage "unknown argument: $1" ;;
		*)
			PRS="$PRS $1"
			shift
			;;
		esac
	done
	case "$REPO" in
	?*/?*) ;;
	*) usage "--repo <owner>/<repo> is required (the repository the PRs are in)" ;;
	esac
}
need_pr() {
	[ -z "$PRS" ] || usage "unexpected argument:$PRS"
	case "$PR" in
	'' | *[!0-9]*) usage "--pr <N> is required" ;;
	esac
}
need_oid() { # flag, value
	case "$2" in
	'' | *[!0-9a-f]*) usage "$1 takes a full commit id" ;;
	esac
	[ "${#2}" -ge 40 ] || usage "$1 takes a full commit id"
}

slug() { printf '%s' "$REPO" | awk -F/ '{ print $(NF-1) "/" $NF }'; }
host() { printf '%s' "$REPO" | awk -F/ 'NF > 2 { print $1 }'; }

# One page of a PR's standing, as TAB-separated lines.
# shellcheck disable=SC2016 # the $names are GraphQL's and jq's
facts_page() { # cursor (may be empty)
	local s h
	s="$(slug)"
	h="$(host)"
	set -- ${h:+--hostname} ${h:+"$h"} -f owner="${s%%/*}" -f name="${s##*/}" -F pr="$PR" ${1:+-f} ${1:+after="$1"}
	gh api graphql "$@" -f query='
query($owner:String!,$name:String!,$pr:Int!,$after:String){
  repository(owner:$owner,name:$name){
    defaultBranchRef{ name }
    pullRequest(number:$pr){
      number state isDraft baseRefName headRefName headRefOid mergeable reviewDecision
      mergeCommit{ oid }
      reviewThreads(first:100,after:$after){
        pageInfo{ hasNextPage endCursor }
        nodes{ isResolved }
      }
      comments(last:30){ nodes{ author{ login } createdAt url } }
      reviews(last:30){ nodes{ author{ login } state submittedAt url } }
    }
  }
}' --jq '
  .data.repository as $r | $r.pullRequest as $p
  | "pr\t\($p.number)",
    "state\t\($p.state)",
    "draft\t\($p.isDraft)",
    "base\t\($p.baseRefName)",
    "default\t\($r.defaultBranchRef.name // "")",
    "branch\t\($p.headRefName)",
    "head\t\($p.headRefOid)",
    "mergeable\t\($p.mergeable)",
    "decision\t\($p.reviewDecision // "NONE")",
    "merged\t\($p.mergeCommit.oid // "")",
    "page\t\($p.reviewThreads.pageInfo.hasNextPage)\t\($p.reviewThreads.pageInfo.endCursor // "")",
    "open\t\([$p.reviewThreads.nodes[] | select(.isResolved | not)] | length)",
    ( $p.comments.nodes[] | ["new", "comment", (.author.login // "ghost"), .createdAt, .url] | @tsv ),
    ( $p.reviews.nodes[] | select(.submittedAt != null)
      | ["new", "review:\(.state)", (.author.login // "ghost"), .submittedAt, .url] | @tsv )'
}

F_STATE="" F_DRAFT="" F_BASE="" F_DEFAULT="" F_BRANCH="" F_HEAD="" F_MERGEABLE="" F_DECISION="" F_MERGED="" F_THREADS=0 F_NEW=""
# Reads every page of the PR's standing into F_*. Every page re-reads the live
# PR, so a head that moves between two pages fails the read.
facts() { # [what a failed read leaves unknown]
	local cursor="" out more guard=0 f1 f2 f3 f4 f5 seen=""
	F_THREADS=0 F_NEW="" F_HEAD=""
	while :; do
		out="$(facts_page "$cursor")" || fail "could not read PR #$PR in $REPO (gh failed). ${1:-Nothing was changed.}"
		more=false
		while IFS="$TAB" read -r f1 f2 f3 f4 f5; do
			case "$f1" in
			pr)
				[ "$f2" = "$PR" ] || fail "the answer was for PR #$f2, not #$PR. Discard it and ask again."
				seen=1
				;;
			state) F_STATE="$f2" ;;
			draft) F_DRAFT="$f2" ;;
			base) F_BASE="$f2" ;;
			default) F_DEFAULT="$f2" ;;
			branch) F_BRANCH="$f2" ;;
			head)
				[ -z "$F_HEAD" ] || [ "$F_HEAD" = "$f2" ] || fail "PR #$PR's head moved from $F_HEAD to $f2 while it was being read. Ask again."
				F_HEAD="$f2"
				;;
			mergeable) F_MERGEABLE="$f2" ;;
			decision) F_DECISION="$f2" ;;
			merged) F_MERGED="$f2" ;;
			page)
				more="$f2"
				cursor="$f3"
				;;
			open) F_THREADS=$((F_THREADS + f2)) ;;
			new)
				# The same latest comments and reviews come back on every page.
				[ "$guard" -gt 0 ] || F_NEW="$F_NEW
$f2$TAB$f3$TAB$f4$TAB$f5"
				;;
			esac
		done <<EOF
$out
EOF
		[ -n "$seen" ] || fail "PR #$PR in $REPO answered with nothing."
		[ "$more" = true ] || break
		[ -n "$cursor" ] || fail "the review threads promised another page and gave no cursor."
		guard=$((guard + 1))
		[ "$guard" -lt 50 ] || fail "the review threads did not end after 50 pages."
	done
	[ -n "$F_HEAD" ] && [ -n "$F_STATE" ] && [ -n "$F_BASE" ] || fail "PR #$PR in $REPO answered without a state, a base or a head."
	[ -n "$F_DEFAULT" ] || fail "$REPO answered without a default branch."
}

# The first thing in the way of merging that the PR itself shows, CI aside;
# empty when there is none.
blocker() {
	if [ "$F_STATE" != OPEN ]; then
		printf not-open
	elif [ -n "$HEAD" ] && [ "$F_HEAD" != "$HEAD" ]; then
		printf moved
	elif [ "$F_THREADS" -gt 0 ] || [ "$F_DECISION" = CHANGES_REQUESTED ]; then
		printf review
	elif [ "$F_BASE" != "$F_DEFAULT" ]; then
		printf stacked
	elif [ "$F_DRAFT" = true ]; then
		printf draft
	fi
}
why() { # outcome
	case "$1" in
	not-open) printf 'PR #%s is %s, not open.' "$PR" "$F_STATE" ;;
	moved) printf "PR #%s's head is %s, not the %s you named: someone pushed. Put it back under watch; do not rebase or merge it." "$PR" "$F_HEAD" "$HEAD" ;;
	stacked) printf "PR #%s is based on '%s', not on '%s': it waits for its parent, and merging it now would land nothing on '%s'." "$PR" "$F_BASE" "$F_DEFAULT" "$F_DEFAULT" ;;
	draft) printf 'PR #%s is a draft.' "$PR" ;;
	review) printf 'PR #%s has open review items (%s unresolved threads, review decision %s). They are the maintainer'"'"'s to settle: skip it, with every PR stacked on it.' "$PR" "$F_THREADS" "$F_DECISION" ;;
	red) printf 'PR #%s has a failing lane. Read its log before re-running anything.' "$PR" ;;
	waiting) printf 'PR #%s is not green yet: a lane is running, or the rollup does not hold the lanes of a full run.' "$PR" ;;
	esac
}

cmd_check() {
	parse "$@"
	need_pr
	[ -z "$HEAD" ] || need_oid --head "$HEAD"
	case "$LANES" in
	*[!0-9]*) usage "--lanes takes a number" ;;
	esac
	case "$SINCE" in
	*[!0-9TZ:.+-]*) usage "--since takes a time as \`checked=\` printed it" ;;
	esac
	need_sibling "$CI"
	local checked ci ciout cihead passing failing outcome
	# Two minutes back: a comment shown twice costs a glance, one skipped
	# because two clocks disagree costs the review it carried.
	checked="$(date -u -d '2 minutes ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)" ||
		checked="$(date -u -v-2M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)" ||
		fail "could not read the clock."
	facts
	ciout="$(bash "$CI" lanes --repo "$REPO" --pr "$PR")" || fail "could not read the status rollup of PR #$PR in $REPO. Nothing here says its lanes are green."
	ci="$(field outcome "$ciout")"
	cihead="$(field head "$ciout")"
	[ "$cihead" = "$F_HEAD" ] || fail "PR #$PR's head moved from $F_HEAD to $cihead between its two reads. Ask again."
	passing="$(printf '%s\n' "$ciout" | awk 'index($0, "passing=") == 1' | sort -u | awk 'END { print NR }')"
	failing="$(printf '%s\n' "$ciout" | awk 'index($0, "lane=") == 1')"
	outcome="$(blocker)"
	if [ -z "$outcome" ]; then
		case "$ci" in
		failing) outcome=red ;;
		green)
			outcome=ready
			[ -z "$LANES" ] || [ "$passing" -ge "$LANES" ] || outcome=waiting
			;;
		running | none) outcome=waiting ;;
		*) fail "the status rollup of PR #$PR answered '$ci', which is no outcome this helper knows." ;;
		esac
	fi
	say "outcome=$outcome"
	say "pr=$PR"
	say "state=$F_STATE"
	[ -z "$F_MERGED" ] || say "merge-commit=$F_MERGED"
	say "head=$F_HEAD"
	say "branch=$F_BRANCH"
	say "base=$F_BASE"
	say "default=$F_DEFAULT"
	say "draft=$F_DRAFT"
	say "mergeable=$F_MERGEABLE"
	say "review=$F_DECISION"
	say "threads=$F_THREADS"
	say "ci=$ci"
	say "lanes=$passing"
	[ -z "$failing" ] || say "$failing"
	printf '%s\n' "$ciout" | awk 'index($0, "running=") == 1'
	[ -z "$SINCE" ] || printf '%s\n' "$F_NEW" | awk -F "$TAB" -v s="$SINCE" 'NF && ($3 "") > (s "") { print "new=" $0 }'
	say "checked=$checked"
	[ "$outcome" = ready ] && return 0
	note "$(why "$outcome")"
	exit 3
}

cmd_survey() {
	parse "$@"
	[ -z "$PR" ] || usage "survey takes the PR numbers as plain arguments"
	[ -n "$PRS" ] || usage "survey needs at least one PR number"
	local n out rc tmp lines="" branches="" parent files o
	for n in $PRS; do
		case "$n" in
		*[!0-9]*) usage "'$n' is not a PR number" ;;
		esac
	done
	tmp="$(mktemp -d "${TMPDIR:-/tmp}/train.XXXXXX")" || fail "could not create a temporary directory."
	# shellcheck disable=SC2064 # expand now: the directory this run made
	trap "rm -rf '$tmp'" EXIT
	for n in $PRS; do
		rc=0
		out="$(bash "$SELF" check --repo "$REPO" --pr "$n" 2>"$tmp/err")" || rc=$?
		case "$rc" in
		0 | 3) ;;
		*)
			cat "$tmp/err" >&2
			fail "could not survey PR #$n."
			;;
		esac
		printf '%s\n' "$out" >"$tmp/check.$n"
		gh pr diff "$n" --repo "$REPO" --name-only >"$tmp/files.$n" || fail "could not list the files PR #$n touches (gh failed)."
		branches="$branches$(field branch "$out")$TAB$n
"
	done
	say "outcome=surveyed"
	for n in $PRS; do
		out="$(cat "$tmp/check.$n")"
		o="$(field outcome "$out")"
		[ -z "$lines" ] && say "default=$(field default "$out")"
		lines=1
		parent="$(printf '%s' "$branches" | awk -F "$TAB" -v b="$(field base "$out")" -v me="$n" '$1 == b && $2 != me { print $2; exit }')"
		files="$(awk 'NF' "$tmp/files.$n" | sort -u | awk 'END { print NR }')"
		say "pr=$n${TAB}outcome=$o${TAB}base=$(field base "$out")${TAB}parent=${parent:--}${TAB}head=$(field head "$out")${TAB}mergeable=$(field mergeable "$out")${TAB}review=$(field review "$out")${TAB}threads=$(field threads "$out")${TAB}ci=$(field ci "$out")${TAB}lanes=$(field lanes "$out")${TAB}files=$files"
	done
	for n in $PRS; do
		awk 'NF' "$tmp/files.$n" | sort -u | awk -v n="$n" -v t="$TAB" '{ print $0 t n }'
	done | sort -t "$TAB" -k1,1 -s | awk -F "$TAB" '
		$1 != path { if (count > 1) print "shared=" path "\t" list; path = $1; list = $2; count = 1; next }
		{ list = list "," $2; count++ }
		END { if (count > 1) print "shared=" path "\t" list }'
}

# Is $1 an ancestor of $2? A probe that could not run is neither answer.
is_ancestor() {
	local rc=0
	git merge-base --is-ancestor "$1" "$2" 2>/dev/null || rc=$?
	[ "$rc" -le 1 ] || fail "could not tell whether $1 is an ancestor of $2 (git merge-base failed). Nothing was changed."
	return "$rc"
}

cmd_rebase() {
	parse "$@"
	need_pr
	need_oid --head "$HEAD"
	[ -z "$FROM" ] || need_oid --from "$FROM"
	[ -z "$GREEN" ] || need_oid --green "$GREEN"
	need_sibling "$PRB"
	local out rc=0 rec tip baseref default base fork ran landed mine tmp unmerged
	out="$(bash "$PRB" reconcile --repo "$REPO" --pr "$PR")" || rc=$?
	case "$rc" in
	0) ;;
	3)
		# Its own stop, with its own outcome and explanation.
		say "$out"
		exit 3
		;;
	*) fail "could not reconcile this worktree with PR #$PR. Nothing was changed." ;;
	esac
	rec="$(field outcome "$out")"
	tip="$(field tip "$out")"
	baseref="$(field base-ref "$out")"
	[ "$(field head "$out")" = "$HEAD" ] || stop moved "PR #$PR's head is $(field head "$out"), not the $HEAD whose rollup you read: someone pushed. Put it back under watch on the new head; nothing was rebased." "head=$(field head "$out")" "expected=$HEAD"
	case "$rec" in
	equal | fast-forwarded) ;;
	*) stop local-ahead "this branch holds commits PR #$PR's head lacks (reconcile answered '$rec'). That is someone's unpublished work: leave this PR unmerged and report it." "tip=$tip" "head=$(field head "$out")" ;;
	esac
	default="$(gh repo view "$REPO" --json defaultBranchRef --jq .defaultBranchRef.name)" && [ -n "$default" ] ||
		fail "could not read the default branch of $REPO (gh failed). Nothing was rebased."
	[ "$baseref" = "$default" ] || stop stacked "PR #$PR is based on '$baseref', not on '$default'. Once its parent has merged, confirm GitHub retargeted it (or set it with \`gh pr edit $PR --repo $REPO --base $default\`), then ask again." "base=$baseref" "default=$default"
	out="$(bash "$PRB" pin-base --repo "$REPO" --base "$default")" || fail "could not fetch '$default' from $REPO. A stale ref is not a fallback; nothing was rebased."
	base="$(field base "$out")"
	[ -n "$base" ] || fail "the pinned base came back empty. Nothing was rebased."
	if [ -n "$FROM" ]; then
		if ! git cat-file -e "$FROM^{commit}" 2>/dev/null || ! is_ancestor "$FROM" "$tip"; then
			stop bad-from "--from $FROM is not a commit this branch is built on, so replaying from it would not drop the parent's commits. Nothing was rebased." "tip=$tip"
		fi
	fi
	fork="$(git merge-base "$tip" "$base")" || fail "this branch and '$default' share no history. Nothing was rebased."
	ran="$fork"
	if [ -n "$GREEN" ]; then
		if ! ran="$(git merge-base "$GREEN" "$base" 2>/dev/null)"; then
			stop bad-green "--green $GREEN is not a commit this worktree holds on a history shared with '$default', so what landed since its run cannot be listed. Nothing was rebased." "tip=$tip"
		fi
	fi
	tmp="$(mktemp -d "${TMPDIR:-/tmp}/train.XXXXXX")" || fail "could not create a temporary directory. Nothing was rebased."
	# shellcheck disable=SC2064 # expand now: the directory this run made
	trap "rm -rf '$tmp'" EXIT
	git diff --name-only "$ran" "$base" | sort -u >"$tmp/landed" || fail "could not list what landed on '$default'. Nothing was rebased."
	git diff --name-only "${FROM:-$fork}" "$tip" | sort -u >"$tmp/mine" || fail "could not list what this branch touches. Nothing was rebased."
	landed="$(awk 'END { print NR }' "$tmp/landed")"
	mine="$(comm -12 "$tmp/landed" "$tmp/mine" | sed 's/^/overlap=/')"
	if [ -z "$FROM" ] && [ "$fork" = "$base" ]; then
		say "outcome=current"
		say "head=$tip"
		say "base=$base"
		say "landed=$landed"
		[ -z "$mine" ] || say "$mine"
		return 0
	fi
	if git rebase --no-update-refs --no-rebase-merges --onto "$base" "${FROM:-$base}" >"$tmp/out" 2>&1; then
		if [ -n "$(git status --porcelain)" ] || ! is_ancestor "$base" HEAD; then
			fail "the rebase returned, but this tree is not a clean branch on $base. Inspect it before anything else."
		fi
		say "outcome=rebased"
		say "before=$tip"
		say "head=$(git rev-parse HEAD)"
		say "base=$base"
		say "commits=$(git rev-list --count "$base..HEAD")"
		say "landed=$landed"
		[ -z "$mine" ] || say "$mine"
		return 0
	fi
	if [ -d "$(git rev-parse --git-path rebase-merge)" ] || [ -d "$(git rev-parse --git-path rebase-apply)" ]; then
		unmerged="$(git diff --name-only --diff-filter=U | sed 's/^/conflict=/')"
		say "outcome=conflict"
		say "before=$tip"
		say "base=$base"
		[ -z "$unmerged" ] || say "$unmerged"
		say "landed=$landed"
		[ -z "$mine" ] || say "$mine"
		note "the rebase of PR #$PR stopped on a conflict and is left in progress. A mechanical one is yours to resolve and \`git rebase --continue\`; one whose resolution changes behavior is the user's: \`git rebase --abort\` and leave the PR unmerged. A conflict resolved in code means a full CI run."
		exit 3
	fi
	cat "$tmp/out" >&2
	fail "git rebase failed without starting. Nothing was rebased."
}

cmd_push() {
	parse "$@"
	need_pr
	need_oid --expect "$EXPECT"
	need_sibling "$PRB"
	exec bash "$PRB" push --repo "$REPO" --pr "$PR" --expect "$EXPECT"
}

cmd_merge() {
	parse "$@"
	need_pr
	need_oid --head "$HEAD"
	case "$WAIT" in
	'' | *[!0-9]*) usage "--wait takes a number of seconds" ;;
	esac
	local outcome s h behind waited=0 err rc=0 tries=0
	facts
	# Right after a push GitHub can still report the head from before it.
	while [ "$F_STATE" = OPEN ] && [ "$F_HEAD" != "$HEAD" ] && [ "$tries" -lt 3 ]; do
		tries=$((tries + 1))
		sleep "$POLL"
		facts
	done
	tries=0
	outcome="$(blocker)"
	[ -z "$outcome" ] || stop "$outcome" "$(why "$outcome") Nothing was merged." "state=$F_STATE" "head=$F_HEAD" "base=$F_BASE" "threads=$F_THREADS" "review=$F_DECISION" ${F_MERGED:+"merge-commit=$F_MERGED"}
	s="$(slug)"
	h="$(host)"
	while [ "$F_MERGEABLE" != MERGEABLE ]; do
		[ "$F_MERGEABLE" != CONFLICTING ] || stop conflicting "GitHub reports PR #$PR as conflicting with '$F_DEFAULT'. Nothing was merged."
		[ "$waited" -lt "$WAIT" ] || stop unsettled "GitHub still reports PR #$PR's mergeability as $F_MERGEABLE after $WAIT seconds. Nothing was merged; ask again." "mergeable=$F_MERGEABLE"
		sleep "$POLL"
		waited=$((waited + POLL))
		facts
		outcome="$(blocker)"
		[ -z "$outcome" ] || stop "$outcome" "$(why "$outcome") Nothing was merged." "state=$F_STATE" "head=$F_HEAD"
	done
	# Compared last, after any wait: a PR that merged meanwhile moved the tip.
	behind="$(gh api ${h:+--hostname} ${h:+"$h"} "repos/$s/compare/$F_DEFAULT...$HEAD" --jq .behind_by)" || fail "could not compare PR #$PR's head with '$F_DEFAULT' (gh failed). Nothing was merged."
	case "$behind" in
	'' | *[!0-9]*) fail "the comparison with '$F_DEFAULT' answered '$behind', not a count. Nothing was merged." ;;
	0) ;;
	*) stop behind "PR #$PR's head is $behind commits behind '$F_DEFAULT': a train merges only a PR that sits on the current tip. Rebase it first. Nothing was merged." "behind=$behind" ;;
	esac
	err="$(gh pr merge "$PR" --repo "$REPO" --merge --match-head-commit "$HEAD" 2>&1 >/dev/null)" || rc=$?
	# The result is read back whatever the command answered: a merge can land
	# behind an error, and an exit of 0 is not a merge commit.
	while :; do
		facts "The merge was requested and its result is unread: read the PR before anything else."
		[ "$F_STATE" != MERGED ] || break
		tries=$((tries + 1))
		# A refusal is read twice too: a merge can land just behind an error.
		if [ "$rc" = 0 ]; then [ "$tries" -lt 6 ] || break; else [ "$tries" -lt 2 ] || break; fi
		sleep "$POLL"
	done
	if [ "$F_STATE" = MERGED ]; then
		say "outcome=merged"
		say "merge-commit=$F_MERGED"
		say "head=$F_HEAD"
		return 0
	fi
	if [ "$rc" != 0 ]; then
		printf '%s\n' "$err" >&2
		case "$err" in
		*merge-async* | *"asynchronous merge"*) stop async-required "GitHub wants PR #$PR merged through its asynchronous merge API. Nothing was merged." "head=$F_HEAD" ;;
		esac
		stop refused "GitHub refused to merge PR #$PR, and it is still $F_STATE. A merge the repository's rules refuse is a human call: never bypass them." "state=$F_STATE" "head=$F_HEAD"
	fi
	stop unconfirmed "the merge command returned, but PR #$PR still reads $F_STATE. Read it again before going on." "state=$F_STATE" "head=$F_HEAD"
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
survey) cmd_survey "$@" ;;
check) cmd_check "$@" ;;
rebase) cmd_rebase "$@" ;;
push) cmd_push "$@" ;;
merge) cmd_merge "$@" ;;
-h | --help | help)
	awk 'NR > 1 && !/^#/ { exit } NR > 1 { sub(/^# ?/, ""); print }' "$SELF"
	;;
*) usage "unknown command: $command" ;;
esac
