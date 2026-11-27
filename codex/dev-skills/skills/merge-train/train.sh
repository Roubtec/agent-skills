#!/usr/bin/env bash
# train.sh — the mechanical steps of a merge train, read and done the one way.
#
# Usage:
#   train.sh survey --repo <owner>/<repo> <PR>...
#   train.sh check  --repo <owner>/<repo> --pr <N> [--head <oid>] [--lane <identity>]... [--since <time>]
#   train.sh rebase --repo <owner>/<repo> --pr <N> --head <oid> [--green <oid>] [--from <parent's old tip>]
#   train.sh push   --repo <owner>/<repo> --pr <N> --expect <head-oid>
#   train.sh merge  --repo <owner>/<repo> --pr <N> --head <oid> [--wait <seconds>] [--state <file> --basis <words>]
#   train.sh watch  --repo <owner>/<repo> --list <file> --state <file> [--interval <seconds>] [--max <seconds>]
#   train.sh note   --state <file> [--pr <N>] <words>...
#   train.sh state  --state <file>
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
#           outcome=review    an unresolved review thread, or a reviewer
#                             whose latest review requests changes (read per
#                             reviewer: `reviewDecision` stays empty where no
#                             rule requires reviews)
#           outcome=stacked   its base is another branch, so it waits for its
#                             parent; merging it now would land nothing on the
#                             default branch
#           outcome=draft
#           outcome=red       a lane settled on something other than SUCCESS,
#                             NEUTRAL or SKIPPED: one `lane=` line each
#           outcome=waiting   a lane is still running, the rollup is empty, or
#                             a `--lane` is not among its passing lanes: one
#                             `missing=<identity>` line each
#         and always: pr= state= head= branch= base= default= draft=
#         mergeable= review= changes-requested= threads= ci= lanes= (how many
#         lanes pass), one `passing=<identity>` line per passing lane, and
#         checked= (a time to pass as `--since` next time).
#         A rollup read right after a push is empty or partial, and a partial
#         one can be all green. So keep the `passing=` lines of a full green run, and pass
#         each as its own `--lane` when checking a later head: every one of
#         them has to pass there, whatever else does.
#         `--since` adds one line per top-level comment or submitted review
#         newer than that time, of the latest 30 of each:
#           new=<comment|review:STATE> TAB <author> TAB <time> TAB <url>
#         Whether one of those carries actionable feedback is yours to read.
# survey  `check` over every listed PR, one line each, TAB-separated key=value
#         fields: pr= outcome= base= parent= (the listed PR whose branch this
#         one is based on, `-` for none) head= mergeable= review= threads= ci=
#         lanes= files=. Then one line per file two or more of them touch:
#           shared=<path> TAB <PR>,<PR>...
#         A listed PR that could not be read gets its line all the same, and
#         the others are surveyed without it:
#           pr=<N> TAB outcome=unreadable TAB reason=<no-such-pr|gh-failed>
#         `no-such-pr`: the repository has no pull request of that number.
#         `gh-failed`: its standing or its files could not be asked for.
#           outcome=surveyed    every listed PR was read
#           outcome=incomplete  an `outcome=unreadable` line is among them
#         A survey in which gh answered for none of them is a failure.
#         Last, one line per PR that is open against the default branch and
#         not on the list, of the 100 most recently created:
#           unlisted=<N> TAB <head branch> TAB <title>
#         These are information: the outcome and the exit status are the
#         listed PRs' alone. `unlisted=unknown` says those lines are not the
#         whole set: the listing failed or came back full, or no listed PR
#         was read to name the default branch.
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
#         With `--state`, a merge is also written to that state file, with
#         `--basis`: your words for what this head merged on.
# watch   The hours of a train, as one command for a background monitor: polls
#         `check` for every entry of the list file and prints a line when an
#         entry's outcome changes, and one when it stops. Nothing else.
#         The list file is yours to edit while the watch runs; it is read
#         again on every poll. One entry per line, `#` starting a comment:
#           <PR> [<head-oid>]   a PR on that head; with none, on the head it
#                               has when first read
#           commit <oid>        a commit's own lanes (a default branch's run)
#         An entry is a PR on a head. `moved` and `not-open` end it: it is
#         printed once and not polled again until the list names another head
#         for that PR. Every other entry is polled each time, so a red lane
#         re-run or a thread resolved is seen. A listed head GitHub does not
#         show yet, on a PR still at the head watched before, is a push on its
#         way: `waiting`, with `ci=unpushed`.
#           pr=<N> TAB head=<oid> TAB outcome=<as check> TAB ...   and then
#             ci=<rollup>, or state= and merge-commit= (not-open), or now=<the
#             head it moved to>
#           commit=<oid> TAB outcome=<green|red|waiting> TAB ci=<rollup>
#           entry=<line> TAB outcome=bad-entry   a line it cannot read, or a
#                                                PR listed twice; said once
#         The first time an entry's lanes are all green it keeps their names,
#         and holds every later head of that PR to them as `check --lane`
#         does, so a rollup still filling after a push is `waiting`. It cannot
#         tell a first rollup that is still filling: list a head that has
#         never had a full green run only once its lanes have shown.
#         It stops by itself, and its last line says why:
#           outcome=stopped TAB reason=<why> TAB pending=<ids> TAB unread=<ids>
#             idle        nothing listed is `waiting` any more (exit 0)
#             expired     `--max` seconds have passed (14400: four hours)
#             unreadable  five polls running could not read some entry
#             no-list     the list file is gone
#         A poll is one `check` per entry, every `--interval` seconds (120: a
#         CI run takes minutes, so two minutes late loses nothing, and ten PRs
#         then cost some 600 small queries an hour). A poll that could not
#         read an entry prints nothing and leaves its outcome standing; the
#         wait doubles with each such poll running, and where GitHub reports
#         the rate limit spent the watch sleeps until it resets. It runs no
#         longer than `--max` and one poll; where `timeout` is installed, an
#         entry's read is cut at five minutes.
#         The state file is the train's memory, and it lives where you say:
#         outside the repository. It is a journal, one TAB-separated record a
#         line, only ever appended to, so the latest record of a kind is the
#         current one: every line the watch printed with `at=<time>` added,
#         and
#           watch=started|stopped ...   with the list's path, the repository
#           green=<N> TAB head=<oid> TAB lane=<identity>...
#                                       the head of that PR's last full green
#                                       run (`rebase --green`) and its lanes
#           unlisted=<N or oid>         the list dropped that entry
#           merged=<N> TAB head= TAB merge-commit= TAB at= TAB basis=<words>
#           note=<N or -> TAB at= TAB text=<words>
#         A watch started on a state file that has records goes on from them:
#         it prints nothing for an outcome the file already holds.
# note    Appends a `note=` record: a run cancelled, a conflict resolved, a
#         merge made some other way.
# state   The state file read down to what stands: the last `watch=` record,
#         the latest record of every entry still listed, each PR's `green=`,
#         then every `merged=` and `note=`, after `outcome=state`.
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

# gh 2.105 and later, where it takes its caller for a coding agent, ends a PR
# read with a block on stderr that advertises `gh event listen`, and has no
# switch for it. That block alone is dropped here, by its own first line and
# the lines that continue it: every other line gh prints passes through, and
# so does its exit status.
gh() {
	command gh "$@" 2>&1 >&3 3>&- | awk '
		hint == 1 && index($0, "    gh event listen ") == 1 { hint = 2; next }
		hint == 2 && index($0, "  - ") == 1 { next }
		{ hint = 0 }
		$0 == "hint: if you need to wait for this pull request to be reviewed, merged, or closed before continuing, use this instead of polling:" { hint = 1; next }
		{ print }' >&2 3>&-
	return "${PIPESTATUS[0]}"
} 3>&1

TAB="$(printf '\t')"
case "$0" in
/*) SELF="$0" ;;
*) SELF="$PWD/$0" ;;
esac
SIBLING="$(dirname -- "$SELF")/../address-review"
PRB="$SIBLING/pr-branch.sh"
CI="$SIBLING/ci.sh"
POLL="${TRAIN_POLL_SECONDS:-5}"
# How many polls running may fail to read an entry before the watch gives up.
UNREADABLE_AFTER=5
# The longest one entry's read may take, where `timeout` is there to cut it.
READ_SECONDS=300

say() { printf '%s\n' "$*"; }
note() { printf 'train: %s\n' "$*" >&2; }
fail() {
	note "$*"
	exit 1
}
usage() {
	note "$*"
	sed -n '4,12p' "$SELF" | sed 's/^# \{0,1\}//' >&2
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
LIST="" STATE="" INTERVAL=120 MAX=14400 BASIS="" NEEDS_REPO=1

parse() {
	while [ $# -gt 0 ]; do
		case "$1" in
		--repo | --pr | --head | --lane | --since | --from | --expect | --green | --wait | --list | --state | --interval | --max | --basis)
			[ $# -ge 2 ] || usage "$1 needs a value"
			case "$1" in
			--repo) REPO="$2" ;;
			--pr) PR="$2" ;;
			--head) HEAD="$2" ;;
			--lane)
				[ -n "$2" ] || usage "--lane takes a lane as a \`passing=\` line printed it"
				LANES="$LANES$2
"
				;;
			--since) SINCE="$2" ;;
			--from) FROM="$2" ;;
			--expect) EXPECT="$2" ;;
			--green) GREEN="$2" ;;
			--wait) WAIT="$2" ;;
			--list) LIST="$2" ;;
			--state) STATE="$2" ;;
			--interval) INTERVAL="$2" ;;
			--max) MAX="$2" ;;
			--basis) BASIS="$2" ;;
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
	[ -n "$NEEDS_REPO" ] || return 0
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

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
# One record onto the end of the state file. TABs separate its fields, so a
# caller's words lose theirs.
journal() { printf '%s\n' "$1" >>"$STATE"; }
words() { printf '%s' "$*" | tr '\t\n\r' '   '; }
need_state() {
	[ -n "$STATE" ] || usage "--state <file> is required"
	case "$STATE" in
	/*) ;;
	*) STATE="$PWD/$STATE" ;;
	esac
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
      latestOpinionatedReviews(first:100){ nodes{ state } }
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
    "changes\t\([($p.latestOpinionatedReviews.nodes // [])[] | select(.state == "CHANGES_REQUESTED")] | length)",
    "page\t\($p.reviewThreads.pageInfo.hasNextPage)\t\($p.reviewThreads.pageInfo.endCursor // "")",
    "open\t\([$p.reviewThreads.nodes[] | select(.isResolved | not)] | length)",
    ( $p.comments.nodes[] | ["new", "comment", (.author.login // "ghost"), .createdAt, .url] | @tsv ),
    ( $p.reviews.nodes[] | select(.submittedAt != null)
      | ["new", "review:\(.state)", (.author.login // "ghost"), .submittedAt, .url] | @tsv )'
}

F_STATE="" F_DRAFT="" F_BASE="" F_DEFAULT="" F_BRANCH="" F_HEAD="" F_MERGEABLE="" F_DECISION="" F_MERGED="" F_CHANGES=0 F_THREADS=0 F_NEW=""
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
			changes) F_CHANGES="$f2" ;;
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
	elif [ "$F_THREADS" -gt 0 ] || [ "$F_CHANGES" -gt 0 ] || [ "$F_DECISION" = CHANGES_REQUESTED ]; then
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
	review) printf 'PR #%s has open review items (%s unresolved threads, %s reviewers requesting changes, review decision %s). They are the maintainer'"'"'s to settle: skip it, with every PR stacked on it.' "$PR" "$F_THREADS" "$F_CHANGES" "$F_DECISION" ;;
	red) printf 'PR #%s has a failing lane. Read its log before re-running anything.' "$PR" ;;
	waiting) printf 'PR #%s is not green yet: a lane is running, or the rollup does not hold the lanes of a full run.' "$PR" ;;
	esac
}

cmd_check() {
	parse "$@"
	need_pr
	[ -z "$HEAD" ] || need_oid --head "$HEAD"
	case "$SINCE" in
	*[!0-9TZ:.+-]*) usage "--since takes a time as \`checked=\` printed it" ;;
	esac
	need_sibling "$CI"
	local checked ci ciout cihead passing failing outcome missing=""
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
	passing="$(printf '%s\n' "$ciout" | awk 'index($0, "passing=") == 1' | sort -u)"
	# Each lane of the full run, by name: a count would let a lane the rebase
	# added stand in for one that has not shown yet.
	[ -z "$LANES" ] || missing="$(printf '%s' "$LANES" | sort -u | HAVE="$passing" awk '
		BEGIN { n = split(ENVIRON["HAVE"], a, "\n"); for (i = 1; i <= n; i++) have[substr(a[i], 9)] = 1 }
		NF && !($0 in have) { print "missing=" $0 }')"
	failing="$(printf '%s\n' "$ciout" | awk 'index($0, "lane=") == 1')"
	outcome="$(blocker)"
	if [ -z "$outcome" ]; then
		case "$ci" in
		failing) outcome=red ;;
		green)
			outcome=ready
			[ -z "$missing" ] || outcome=waiting
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
	say "changes-requested=$F_CHANGES"
	say "threads=$F_THREADS"
	say "ci=$ci"
	say "lanes=$(printf '%s\n' "$passing" | awk 'NF { n++ } END { print n + 0 }')"
	[ -z "$passing" ] || say "$passing"
	[ -z "$missing" ] || say "$missing"
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
	local n out rc tmp branches="" parent files o good="" bad=0 answered="" default="" open
	for n in $PRS; do
		case "$n" in
		*[!0-9]*) usage "'$n' is not a PR number" ;;
		esac
	done
	tmp="$(mktemp -d "${TMPDIR:-/tmp}/train.XXXXXX")" || fail "could not create a temporary directory."
	# shellcheck disable=SC2064 # expand now: the directory this run made
	trap "rm -rf '$tmp'" EXIT
	: >"$tmp/errs"
	for n in $PRS; do
		rc=0
		out="$(bash "$SELF" check --repo "$REPO" --pr "$n" 2>"$tmp/err")" || rc=$?
		case "$rc" in
		0 | 3)
			if gh pr diff "$n" --repo "$REPO" --name-only >"$tmp/files.$n" 2>"$tmp/err"; then
				printf '%s\n' "$out" >"$tmp/check.$n"
				good="$good $n"
				answered=1
				[ -n "$default" ] || default="$(field default "$out")"
				branches="$branches$(field branch "$out")$TAB$n
"
				continue
			fi
			;;
		esac
		bad=$((bad + 1))
		# The one failure that is an answer: gh asked, and GitHub has no such PR.
		if grep -F -q "Could not resolve to a PullRequest with the number of $n." "$tmp/err"; then
			echo no-such-pr >"$tmp/why.$n"
			answered=1
			# gh's own line and no more: the child's "gh failed" is not true of it.
			grep -F "Could not resolve to a PullRequest" "$tmp/err" >>"$tmp/errs"
		else
			echo gh-failed >"$tmp/why.$n"
			cat "$tmp/err" >>"$tmp/errs"
		fi
	done
	cat "$tmp/errs" >&2
	[ -n "$answered" ] || fail "could not read any of the listed PRs in $REPO (gh failed). Nothing was surveyed."
	if [ "$bad" -gt 0 ]; then say "outcome=incomplete"; else say "outcome=surveyed"; fi
	[ -z "$default" ] || say "default=$default"
	for n in $PRS; do
		if [ -f "$tmp/why.$n" ]; then
			say "pr=$n${TAB}outcome=unreadable${TAB}reason=$(cat "$tmp/why.$n")"
			continue
		fi
		out="$(cat "$tmp/check.$n")"
		o="$(field outcome "$out")"
		parent="$(printf '%s' "$branches" | awk -F "$TAB" -v b="$(field base "$out")" -v me="$n" '$1 == b && $2 != me { print $2; exit }')"
		files="$(awk 'NF' "$tmp/files.$n" | sort -u | awk 'END { print NR }')"
		say "pr=$n${TAB}outcome=$o${TAB}base=$(field base "$out")${TAB}parent=${parent:--}${TAB}head=$(field head "$out")${TAB}mergeable=$(field mergeable "$out")${TAB}review=$(field review "$out")${TAB}threads=$(field threads "$out")${TAB}ci=$(field ci "$out")${TAB}lanes=$(field lanes "$out")${TAB}files=$files"
	done
	for n in $good; do
		awk 'NF' "$tmp/files.$n" | sort -u | awk -v n="$n" -v t="$TAB" '{ print $0 t n }'
	done | sort -t "$TAB" -k1,1 -s | awk -F "$TAB" '
		$1 != path { if (count > 1) print "shared=" path "\t" list; path = $1; list = $2; count = 1; next }
		{ list = list "," $2; count++ }
		END { if (count > 1) print "shared=" path "\t" list }'
	if [ -z "$default" ]; then
		say "unlisted=unknown"
		note "no listed PR was read, so the default branch is not known and the open PRs that are not on the list were not looked for."
	elif open="$(gh pr list --repo "$REPO" --state open --base "$default" --limit 100 --json number,headRefName,title \
		--jq '.[] | "\(.number)\t\(.headRefName)\t\(.title | gsub("[[:cntrl:]]+"; " "))"')"; then
		printf '%s\n' "$open" | awk -F "$TAB" -v listed="$PRS" '
			BEGIN { n = split(listed, a, " "); for (i = 1; i <= n; i++) on[a[i] + 0] = 1 }
			$1 ~ /^[0-9]+$/ && !(($1 + 0) in on) { print "unlisted=" $0 }'
		if [ "$(printf '%s\n' "$open" | awk 'NF { n++ } END { print n + 0 }')" -ge 100 ]; then
			say "unlisted=unknown"
			note "100 PRs are open against '$default', which is as many as were asked for: there may be more that are not on the list."
		fi
	else
		say "unlisted=unknown"
		note "could not list the PRs open against '$default' (gh failed), so whether one is missing from the list is not known. The survey of the listed PRs stands."
	fi
	[ "$bad" -gt 0 ] || return 0
	note "$bad of the listed PRs could not be read: see the \`outcome=unreadable\` lines. The others were surveyed without them."
	exit 3
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
	if [ -n "$STATE$BASIS" ]; then
		need_state
		[ -n "$BASIS" ] || usage "--state takes --basis <words>: what this head merges on"
		: >>"$STATE" || fail "cannot write the state file $STATE. Nothing was merged."
	fi
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
	[ -z "$outcome" ] || stop "$outcome" "$(why "$outcome") Nothing was merged." "state=$F_STATE" "head=$F_HEAD" "base=$F_BASE" "threads=$F_THREADS" "review=$F_DECISION" "changes-requested=$F_CHANGES" ${F_MERGED:+"merge-commit=$F_MERGED"}
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
		[ -z "$STATE" ] || journal "merged=$PR${TAB}head=$F_HEAD${TAB}merge-commit=$F_MERGED${TAB}at=$(now)${TAB}basis=$(words "$BASIS")" ||
			note "PR #$PR merged, but the merge could not be written to $STATE. Record it with \`note\`."
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

# The latest record of one entry in the state file, as `<head> TAB <outcome>`;
# empty where it has none, or where the list dropped it since.
last_of() { # pr|commit, id
	awk -F "$TAB" -v k="$1=$2" -v u="unlisted=$2" '
		$1 == k {
			h = "-"; o = ""
			for (i = 2; i <= NF; i++) {
				if (index($i, "head=") == 1) h = substr($i, 6)
				if (index($i, "outcome=") == 1) o = substr($i, 9)
			}
			r = h "\t" o
		}
		$1 == u { r = "" }
		END { print r }' "$STATE"
}

W_PENDING="" W_UNREAD="" W_LISTED="" GUARD=""
# Says a record, and writes it to the state file with its time.
report() {
	say "$1"
	journal "$1${TAB}at=$(now)" || fail "cannot write the state file $STATE."
}
bad_entry() { # the line
	local rec
	rec="entry=$(words "$1")${TAB}outcome=bad-entry"
	grep -qF -- "$rec$TAB" "$STATE" || report "$rec"
}
watch_pr() { # PR, head the list names (may be empty)
	local id="$1" head="$2" last lhead="" lout="" kept rc=0 out o h ci rec green lane
	last="$(last_of pr "$id")"
	IFS="$TAB" read -r lhead lout <<EOF
$last
EOF
	[ -n "$head" ] || head="$lhead"
	if [ -n "$head" ] && [ "$head" = "$lhead" ]; then
		case "$lout" in
		moved | not-open) return 0 ;;
		esac
	fi
	kept="$(awk -F "$TAB" -v k="green=$id" '$1 == k { r = $0 } END { print r }' "$STATE")"
	set -- check --repo "$REPO" --pr "$id"
	[ -z "$head" ] || set -- "$@" --head "$head"
	while IFS= read -r lane; do
		case "$lane" in
		lane=*) set -- "$@" --lane "${lane#lane=}" ;;
		esac
	done <<EOF
$(printf '%s\n' "$kept" | tr "$TAB" '\n')
EOF
	out="$($GUARD bash "$SELF" "$@" 2>/dev/null)" || rc=$?
	o="$(field outcome "$out")"
	h="$(field head "$out")"
	case "$rc" in
	0 | 3) [ -n "$o" ] && [ -n "$h" ] || rc=1 ;;
	esac
	case "$rc" in
	0 | 3) ;;
	*)
		W_UNREAD="$W_UNREAD $id"
		return 0
		;;
	esac
	[ -n "$head" ] || head="$h"
	ci="$(field ci "$out")"
	# The list names a head GitHub does not show yet, and the PR is still on
	# the one watched before: a push on its way, not somebody else's.
	if [ "$o" = moved ] && [ "$head" != "$lhead" ] && [ "$h" = "$lhead" ]; then
		o=waiting
		ci=unpushed
	fi
	rec="pr=$id${TAB}head=$head${TAB}outcome=$o"
	case "$o" in
	not-open) rec="$rec${TAB}state=$(field state "$out")${TAB}merge-commit=$(field merge-commit "$out")" ;;
	moved) rec="$rec${TAB}now=$h" ;;
	*) rec="$rec${TAB}ci=$ci" ;;
	esac
	if [ "$head" != "$lhead" ] || [ "$o" != "$lout" ]; then report "$rec"; fi
	case "$o" in
	not-open | moved) ;;
	*)
		if [ "$ci" = green ] && ! printf '%s\n' "$out" | grep -q '^missing='; then
			green="green=$id${TAB}head=$head$(printf '%s\n' "$out" | awk -v t="$TAB" 'index($0, "passing=") == 1 { printf "%slane=%s", t, substr($0, 9) }')"
			[ "$green" = "$kept" ] || journal "$green" || fail "cannot write the state file $STATE."
		fi
		;;
	esac
	[ "$o" != waiting ] || W_PENDING="$W_PENDING $id"
}
watch_commit() { # oid
	local id="$1" last lhead="" lout="" out ci o
	last="$(last_of commit "$id")"
	IFS="$TAB" read -r lhead lout <<EOF
$last
EOF
	if ! out="$($GUARD bash "$CI" lanes --repo "$REPO" --commit "$id" 2>/dev/null)"; then
		W_UNREAD="$W_UNREAD $id"
		return 0
	fi
	ci="$(field outcome "$out")"
	case "$ci" in
	green) o=green ;;
	failing) o=red ;;
	running | none) o=waiting ;;
	*)
		W_UNREAD="$W_UNREAD $id"
		return 0
		;;
	esac
	[ "$o" = "$lout" ] || report "commit=$id${TAB}outcome=$o${TAB}ci=$ci"
	[ "$o" != waiting ] || W_PENDING="$W_PENDING $id"
}
# One poll: every entry of the list, then the entries the list has dropped.
poll() {
	local line id
	W_PENDING="" W_UNREAD="" W_LISTED=""
	# The list is read on its own descriptor: gh would drink the loop's stdin.
	while IFS= read -r line <&3 || [ -n "$line" ]; do
		line="${line%%#*}"
		set -f
		# shellcheck disable=SC2086 # split into words, with globbing off
		set -- $line
		set +f
		[ $# -gt 0 ] || continue
		id="$1"
		[ "$1" != commit ] || id="${2:-}"
		case " $W_LISTED " in
		*" $id "*)
			bad_entry "$line"
			continue
			;;
		esac
		case "$1" in
		commit)
			case "$id" in
			'' | *[!0-9a-f]*) id="" ;;
			esac
			if [ $# -ne 2 ] || [ "${#id}" -lt 40 ]; then
				bad_entry "$line"
				continue
			fi
			W_LISTED="$W_LISTED $id"
			watch_commit "$id"
			;;
		*[!0-9]*)
			bad_entry "$line"
			;;
		*)
			case "${2:-}" in
			*[!0-9a-f]*) set -- "$1" x x ;;
			esac
			if [ $# -gt 2 ] || { [ $# -eq 2 ] && [ "${#2}" -lt 40 ]; }; then
				bad_entry "$line"
				continue
			fi
			W_LISTED="$W_LISTED $id"
			watch_pr "$id" "${2:-}"
			;;
		esac
	done 3<"$LIST"
	awk -F "$TAB" '
		{ k = $1; sub(/=.*/, "", k); v = substr($1, length(k) + 2) }
		k == "pr" || k == "commit" { if (!(v in seen)) { seen[v] = 1; order[++n] = v }; live[v] = 1 }
		k == "unlisted" { live[v] = 0 }
		END { for (i = 1; i <= n; i++) if (live[order[i]]) print order[i] }' "$STATE" |
		while IFS= read -r id; do
			case " $W_LISTED " in
			*" $id "*) ;;
			*) journal "unlisted=$id${TAB}at=$(now)" ;;
			esac
		done
}

cmd_watch() {
	parse "$@"
	[ -z "$PR$PRS" ] || usage "watch takes its PRs from the list file"
	[ -n "$LIST" ] || usage "--list <file> is required"
	need_state
	case "$LIST" in
	/*) ;;
	*) LIST="$PWD/$LIST" ;;
	esac
	case "$INTERVAL" in
	'' | *[!0-9]*) usage "--interval takes a number of seconds" ;;
	esac
	case "$MAX" in
	'' | *[!0-9]*) usage "--max takes a number of seconds" ;;
	esac
	need_sibling "$CI"
	[ -r "$LIST" ] || fail "cannot read the list file $LIST."
	journal "watch=started${TAB}at=$(now)${TAB}repo=$REPO${TAB}list=$LIST${TAB}interval=$INTERVAL${TAB}max=$MAX" || fail "cannot write the state file $STATE."
	# A read that hangs would hold the watch past its bound.
	GUARD=""
	if command -v timeout >/dev/null 2>&1; then GUARD="timeout $READ_SECONDS"; fi
	local start="$SECONDS" waited=0 elapsed fails=0 reason wait n h limit rec
	h="$(host)"
	while :; do
		if [ ! -r "$LIST" ]; then
			reason=no-list
			break
		fi
		poll
		if [ -n "$W_UNREAD" ]; then
			fails=$((fails + 1))
			if [ "$fails" -ge "$UNREADABLE_AFTER" ]; then
				reason=unreadable
				break
			fi
		else
			fails=0
			if [ -z "$W_PENDING" ]; then
				reason=idle
				break
			fi
		fi
		# The longer of the clock and the waits asked for, so the bound holds
		# whatever a sleep really took.
		elapsed=$((SECONDS - start))
		[ "$waited" -le "$elapsed" ] || elapsed="$waited"
		if [ "$elapsed" -ge "$MAX" ]; then
			reason=expired
			break
		fi
		wait="$INTERVAL"
		n="$fails"
		while [ "$n" -gt 1 ]; do
			wait=$((wait * 2))
			n=$((n - 1))
		done
		if [ "$fails" -gt 0 ]; then
			limit="$(gh api ${h:+--hostname} ${h:+"$h"} rate_limit --jq '.resources.graphql | "\(.remaining) \(.reset)"' 2>/dev/null)" || limit=""
			case "$limit" in
			"0 "*[!0-9]* | "0 ") ;;
			"0 "*)
				n=$((${limit#0 } - $(date +%s) + 5))
				[ "$n" -le "$wait" ] || wait="$n"
				;;
			esac
		fi
		[ "$wait" -le $((MAX - elapsed)) ] || wait=$((MAX - elapsed))
		sleep "$wait"
		waited=$((waited + wait))
	done
	rec="reason=$reason${TAB}pending=$(printf '%s' "${W_PENDING# }" | tr ' ' ',')${TAB}unread=$(printf '%s' "${W_UNREAD# }" | tr ' ' ',')"
	say "outcome=stopped${TAB}$rec"
	journal "watch=stopped${TAB}at=$(now)${TAB}$rec" || note "could not write the stop to $STATE."
	case "$reason" in
	idle)
		note "nothing listed is waiting any more. Act on what the lines above say; start the watch again once something is waiting."
		return 0
		;;
	expired) note "the watch ran its $MAX seconds with entries still waiting. Start it again on the same list and state file: it goes on from what the state file holds." ;;
	unreadable) note "$UNREADABLE_AFTER polls running could not read:$W_UNREAD. Run \`check\` on one by hand to see why, then start the watch again." ;;
	no-list) note "the list file $LIST is gone, so there is nothing to watch." ;;
	esac
	exit 3
}

cmd_note() {
	NEEDS_REPO=""
	parse "$@"
	need_state
	case "$PR" in
	*[!0-9]*) usage "--pr takes a PR number" ;;
	esac
	[ -n "$PRS" ] || usage "note takes the words to record"
	journal "note=${PR:--}${TAB}at=$(now)${TAB}text=$(words "${PRS# }")" || fail "cannot write the state file $STATE."
	say "outcome=noted"
}

cmd_state() {
	NEEDS_REPO=""
	parse "$@"
	need_state
	[ -z "$PR$PRS" ] || usage "state takes --state alone"
	[ -r "$STATE" ] || fail "cannot read the state file $STATE."
	say "outcome=state"
	awk -F "$TAB" '
		{ k = $1; sub(/=.*/, "", k); v = substr($1, length(k) + 2) }
		k == "watch" { watch = $0 }
		k == "pr" || k == "commit" { if (!(v in seen)) { seen[v] = 1; order[++n] = v }; cur[v] = $0 }
		k == "unlisted" { cur[v] = "" }
		k == "green" { if (!(v in gseen)) { gseen[v] = 1; gorder[++g] = v }; green[v] = $0 }
		k == "merged" || k == "note" { rest[++r] = $0 }
		END {
			if (watch != "") print watch
			for (i = 1; i <= n; i++) if (cur[order[i]] != "") print cur[order[i]]
			for (i = 1; i <= g; i++) print green[gorder[i]]
			for (i = 1; i <= r; i++) print rest[i]
		}' "$STATE"
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
watch) cmd_watch "$@" ;;
note) cmd_note "$@" ;;
state) cmd_state "$@" ;;
-h | --help | help)
	awk 'NR > 1 && !/^#/ { exit } NR > 1 { sub(/^# ?/, ""); print }' "$SELF"
	;;
*) usage "unknown command: $command" ;;
esac
