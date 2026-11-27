#!/usr/bin/env bash
# Hermetic test for the merge-train helper
# (plugins/dev-skills/skills/merge-train/train.sh).
#
# Nothing here reaches the network: `gh` is a fake that answers each query from
# canned JSON run through the real `jq` with the helper's own `--jq` program,
# and the rebase and push cases run against throwaway repositories whose
# "GitHub" remote is a bare repository behind an insteadOf rewrite. The
# address-review scripts the helper calls are the shipped ones.
# Needs Bash, git, jq and coreutils.
# shellcheck disable=SC2319 # `ok <label> $?` after a `[ … ]` test is the point
# shellcheck disable=SC2016 # a hook's text is expanded by the fake that sources it
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SHIPPED="$SCRIPT_DIR/../plugins/dev-skills/skills/merge-train/train.sh"
HELPER="${TRAIN_HELPER:-$SHIPPED}"
MIRROR="$SCRIPT_DIR/../codex/dev-skills/skills/merge-train/train.sh"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
export TRAIN_POLL_SECONDS=1
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null

checks=0
fails=0
ok() { # <label> <condition status>
	checks=$((checks + 1))
	if [ "$2" != 0 ]; then
		fails=$((fails + 1))
		printf 'FAIL [%s]\n' "$1" >&2
	fi
}
has() { # <label> <haystack> <needle>
	case "$2" in *"$3"*) ok "$1" 0 ;; *)
		ok "$1" 1
		printf '      wanted: %s\n      got:    %s\n' "$3" "$2" >&2
		;;
	esac
}
lacks() { # <label> <haystack> <needle>
	case "$2" in *"$3"*)
		ok "$1" 1
		printf '      unwanted: %s\n' "$3" >&2
		;;
	*) ok "$1" 0 ;; esac
}
is() { # <label> <actual> <expected>
	if [ "$2" = "$3" ]; then ok "$1" 0; else
		ok "$1" 1
		printf '      wanted: %s\n      got:    %s\n' "$3" "$2" >&2
	fi
}

FAKE="$WORKDIR/bin"
mkdir -p "$FAKE"
export FAKE
cat >"$FAKE/gh" <<'FAKEGH'
#!/usr/bin/env bash
# Answers from files under $FAKE:
#   facts.<pr>.json        the PR's standing (facts.<pr>.<n>.json on the n-th
#                          read, where that file exists; facts.<pr>.p2.json
#                          once a cursor is passed)
#   rollup.<pr>.json       its status rollup
#   compare.json           the compare API's answer
#   files.<pr>             `gh pr diff --name-only`
#   missing.<pr>           the repository has no such PR: gh's own words, exit 1
#   open.json              `gh pr list`: the open PRs (fail-list: it fails)
#   pr.json                `gh pr view`, as pr-branch.sh reads it
#   merge-error            `gh pr merge` fails, printing this
#   merge-lands            `gh pr merge` installs facts.<pr>.merged.json
#   merge-moves-main       `gh pr merge` is never reached: the compare answers
#                          from compare.late.json once facts were read twice
#   merge-breaks-api       every read after `gh pr merge` fails
#   rollup.<pr>.<n>.json   its rollup on the PR's n-th read, where that exists
#   crollup.json           a commit's rollup (crollup.<n>.json on the n-th)
#   hook.<pr>.<n>          sourced on the PR's n-th read, before it is answered
#   ratelimit.json         the rate_limit API's answer; none is a failed call
printf '%s\n' "$*" >>"$FAKE/gh.log"
expr=. pr="" oid="" after="" query="" args=("$@")
i=0
while [ $i -lt ${#args[@]} ]; do
	a="${args[$i]}" b="${args[$((i + 1))]:-}"
	case "$a" in
	--jq) expr="$b" ;;
	-f | -F)
		case "$b" in
		pr=*) pr="${b#pr=}" ;;
		oid=*) oid="${b#oid=}" ;;
		after=*) after=1 ;;
		query=*) query="$b" ;;
		esac
		;;
	esac
	i=$((i + 1))
done
case "$1 $2" in
"api graphql")
	[ ! -f "$FAKE/fail-api" ] || exit 1
	case "$query" in
	*reviewThreads*)
		if [ -f "$FAKE/missing.$pr" ]; then
			printf 'gh: Could not resolve to a PullRequest with the number of %s.\n' "$pr" >&2
			exit 1
		fi
		n=$(($(cat "$FAKE/reads.$pr" 2>/dev/null || echo 0) + 1))
		echo "$n" >"$FAKE/reads.$pr"
		# shellcheck disable=SC1090 # a test's own hook
		[ ! -f "$FAKE/hook.$pr.$n" ] || . "$FAKE/hook.$pr.$n"
		file="$FAKE/facts.$pr.json"
		[ ! -f "$FAKE/facts.$pr.$n.json" ] || file="$FAKE/facts.$pr.$n.json"
		[ -z "$after" ] || file="$FAKE/facts.$pr.p2.json"
		;;
	*statusCheckRollup*)
		[ ! -f "$FAKE/fail-rollup" ] || exit 1
		if [ -n "$oid" ]; then
			n=$(($(cat "$FAKE/reads.commit" 2>/dev/null || echo 0) + 1))
			echo "$n" >"$FAKE/reads.commit"
			file="$FAKE/crollup.json"
			[ ! -f "$FAKE/crollup.$n.json" ] || file="$FAKE/crollup.$n.json"
		else
			n="$(cat "$FAKE/reads.$pr" 2>/dev/null || echo 0)"
			file="$FAKE/rollup.$pr.json"
			[ ! -f "$FAKE/rollup.$pr.$n.json" ] || file="$FAKE/rollup.$pr.$n.json"
		fi
		;;
	*) exit 1 ;;
	esac
	jq -r "$expr" "$file"
	;;
"api rate_limit" | "api --hostname")
	[ -f "$FAKE/ratelimit.json" ] || exit 1
	jq -r "$expr" "$FAKE/ratelimit.json"
	;;
"api "*)
	file="$FAKE/compare.json"
	[ ! -f "$FAKE/merge-moves-main" ] || [ "$(cat "$FAKE/reads.7" 2>/dev/null || echo 0)" -lt 2 ] || file="$FAKE/compare.late.json"
	jq -r "$expr" "$file"
	;;
"pr diff") cat "$FAKE/files.$3" ;;
"pr view") jq -r "$expr" "$FAKE/pr.json" ;;
"pr list")
	if [ -f "$FAKE/fail-list" ]; then
		echo "gh: the listing broke" >&2
		exit 1
	fi
	jq -r "$expr" "$FAKE/open.json"
	;;
"repo view") printf '{"defaultBranchRef":{"name":"main"}}' | jq -r "$expr" ;;
"pr merge")
	[ ! -f "$FAKE/merge-breaks-api" ] || touch "$FAKE/fail-api"
	if [ -f "$FAKE/merge-lands" ]; then cp "$FAKE/facts.$3.merged.json" "$FAKE/facts.$3.json"; fi
	if [ -f "$FAKE/merge-error" ]; then
		cat "$FAKE/merge-error" >&2
		exit 1
	fi
	;;
*) exit 1 ;;
esac
FAKEGH
chmod +x "$FAKE/gh"
export PATH="$FAKE:$PATH"

H1=1111111111111111111111111111111111111111
H2=2222222222222222222222222222222222222222
MC=cccccccccccccccccccccccccccccccccccccccc
fresh() {
	rm -f "$FAKE"/*.json "$FAKE"/reads.* "$FAKE"/files.* "$FAKE"/missing.* "$FAKE"/fail-* "$FAKE"/merge-* "$FAKE"/hook.* "$FAKE/gh.log" "$FAKE/sleep.log"
	printf '{"behind_by":0}\n' >"$FAKE/compare.json"
	printf '[]\n' >"$FAKE/open.json"
}
# facts <file-suffix> key=value...  — an open, mergeable, clean PR by default.
# Keys: pr state draft base branch head mergeable decision merged threads
# (comma-separated true/false: resolved or not) more cursor comments reviews
# latest (comma-separated states: each reviewer's latest opinionated review).
facts() {
	local suffix="$1" kv
	shift
	local pr=7 state=OPEN draft=false base=main branch=feature head="$H1" mergeable=MERGEABLE decision=null merged=null threads="" more=false cursor="" comments="" reviews="" latest=""
	for kv in "$@"; do local "${kv%%=*}"="${kv#*=}"; done
	[ "$decision" = null ] || decision="\"$decision\""
	[ "$merged" = null ] || merged="{\"oid\":\"$merged\"}"
	threads="$(printf '%s' "$threads" | awk -F, '{ for (i = 1; i <= NF; i++) printf "%s{\"isResolved\":%s}", (i > 1 ? "," : ""), $i }')"
	latest="$(printf '%s' "$latest" | awk -F, '{ for (i = 1; i <= NF; i++) printf "%s{\"state\":\"%s\"}", (i > 1 ? "," : ""), $i }')"
	printf '{"data":{"repository":{"defaultBranchRef":{"name":"main"},"pullRequest":{"number":%s,"state":"%s","isDraft":%s,"baseRefName":"%s","headRefName":"%s","headRefOid":"%s","mergeable":"%s","reviewDecision":%s,"latestOpinionatedReviews":{"nodes":[%s]},"mergeCommit":%s,"reviewThreads":{"pageInfo":{"hasNextPage":%s,"endCursor":"%s"},"nodes":[%s]},"comments":{"nodes":[%s]},"reviews":{"nodes":[%s]}}}}}\n' \
		"$pr" "$state" "$draft" "$base" "$branch" "$head" "$mergeable" "$decision" "$latest" "$merged" "$more" "$cursor" "$threads" "$comments" "$reviews" >"$FAKE/facts.$suffix.json"
}
# rollup <pr>[.<n>] <head> <nodes>
rollup() {
	printf '{"data":{"repository":{"pullRequest":{"number":%s,"commits":{"nodes":[{"commit":{"oid":"%s","statusCheckRollup":{"contexts":{"pageInfo":{"hasNextPage":false,"endCursor":""},"nodes":[%s]}}}}]}}}}}\n' \
		"${1%%.*}" "$2" "$3" >"$FAKE/rollup.$1.json"
}
# lane <job> <status> <conclusion (JSON)>
lane() {
	printf '{"__typename":"CheckRun","name":"%s","status":"%s","conclusion":%s,"detailsUrl":"https://github.com/acme/widgets/actions/runs/1/job/2","checkSuite":{"app":{"slug":"github-actions"},"workflowRun":{"workflow":{"name":"Tests"}}}}' "$1" "$2" "$3"
}
GREEN="$(lane a COMPLETED '"SUCCESS"'),$(lane b COMPLETED '"SKIPPED"')"

call() { # <command> [args...] → OUT (stdout), ERR (stderr), RC
	OUT="$(cd "${R:-$WORKDIR}" && bash "$HELPER" "$@" 2>"$WORKDIR/err")"
	RC=$?
	ERR="$(cat "$WORKDIR/err")"
}
val() { printf '%s\n' "$OUT" | sed -n "s/^$1=//p" | head -n 1; }
ARGS=(--repo acme/widgets --pr 7)

# --- 1. check -----------------------------------------------------------------
fresh
facts 7
rollup 7 "$H1" "$GREEN"
call check "${ARGS[@]}"
is "1: an open PR on the default branch with a green rollup is ready" "$(val outcome)" ready
is "1: ...with exit 0" "$RC" 0
is "1: ...reporting its head" "$(val head)" "$H1"
is "1: ...its passing lanes" "$(val lanes)" 2
is "1: ...and no review decision as NONE" "$(val review)" NONE
has "1: ...with a time to pass as --since" "$OUT" "checked=20"
has "1: the PR read names the PR and the repository" "$(cat "$FAKE/gh.log")" "owner=acme -f name=widgets -F pr=7"
has "1: ...each by name" "$OUT" "passing=Tests / a
passing=Tests / b"
call check "${ARGS[@]}" --lane "Tests / a" --lane "Tests / b"
is "1: the lanes of a full run being present is still ready" "$(val outcome)" ready
lacks "1: ...with none missing" "$OUT" "missing="
rollup 7 "$H1" "$(lane a COMPLETED '"SUCCESS"'),$(lane c COMPLETED '"SUCCESS"')"
call check "${ARGS[@]}" --lane "Tests / a" --lane "Tests / b"
is "1: a new lane does not stand in for one of the full run's that is absent" "$(val outcome)" waiting
is "1: ...with exit 3" "$RC" 3
is "1: ...naming the absent lane" "$(val missing)" "Tests / b"
is "1: ...and it alone" "$(printf '%s\n' "$OUT" | grep -c '^missing=')" 1
call check "${ARGS[@]}" --lane "Tests / a" --lane "Tests / c"
is "1: lanes beyond the named ones do not matter" "$(val outcome)" ready
rollup 7 "$H1" "$(lane ab COMPLETED '"SUCCESS"')"
call check "${ARGS[@]}" --lane "Tests / a"
is "1: a lane is matched whole, not as a prefix" "$(val outcome)" waiting
rollup 7 "$H1" "$(lane a COMPLETED '"SUCCESS"')"
call check "${ARGS[@]}" --lane "Tests / ab"
is "1: ...in either direction" "$(val outcome)" waiting
call check "${ARGS[@]}" --lane ""
is "1: an empty --lane is a usage error" "$RC" 64
rollup 7 "$H1" "$(lane a COMPLETED '"SUCCESS"'),$(lane b IN_PROGRESS null)"
call check "${ARGS[@]}"
is "1: a lane in progress is waiting" "$(val outcome)" waiting
has "1: ...naming it" "$OUT" "running=Tests / b"
rollup 7 "$H1" ""
call check "${ARGS[@]}"
is "1: an empty rollup is waiting, never green" "$(val outcome)" waiting
is "1: ...reported as none" "$(val ci)" none
rollup 7 "$H1" "$(lane a COMPLETED '"SUCCESS"'),$(lane b COMPLETED '"FAILURE"'),$(lane c IN_PROGRESS null)"
call check "${ARGS[@]}"
is "1: a failed lane is red though another still runs" "$(val outcome)" red
has "1: ...with the lane and its URL" "$OUT" "lane=Tests / b	actions	FAILURE	https://github.com/acme/widgets/actions/runs/1/job/2"
rollup 7 "$H1" "$(lane a COMPLETED '"CANCELLED"')"
call check "${ARGS[@]}"
is "1: a cancelled lane is red: only SUCCESS, NEUTRAL and SKIPPED pass" "$(val outcome)" red

rollup 7 "$H1" "$(lane b COMPLETED '"FAILURE"')"
facts 7 threads=true,false,true more=true cursor=c1
facts 7.p2 threads=false
call check "${ARGS[@]}"
is "1: an unresolved thread outranks a red lane" "$(val outcome)" review
is "1: ...counted across every page" "$(val threads)" 2
has "1: ...and the lane is still printed" "$OUT" "lane=Tests / b"
has "1: ...with the skip rule on stderr" "$ERR" "maintainer's to settle"
rollup 7 "$H1" "$GREEN"
facts 7 threads=true decision=CHANGES_REQUESTED
call check "${ARGS[@]}"
is "1: a review requesting changes blocks with no thread open" "$(val outcome)" review
facts 7 latest=APPROVED,CHANGES_REQUESTED
call check "${ARGS[@]}"
is "1: one reviewer's standing change request blocks where no rule sets a review decision" "$(val outcome)" review
is "1: ...counted" "$(val changes-requested)" 1
is "1: ...beside the empty decision" "$(val review)" NONE
facts 7 threads=true decision=APPROVED latest=APPROVED,DISMISSED
call check "${ARGS[@]}"
is "1: resolved threads, an approval and a dismissed review do not block" "$(val outcome)" ready
facts 7 draft=true
call check "${ARGS[@]}"
is "1: a draft is not ready" "$(val outcome)" draft
facts 7 base=parent-branch threads=false
call check "${ARGS[@]}"
is "1: a stacked PR with an open thread reads as review, so the preflight question sees it" "$(val outcome)" review
facts 7 base=parent-branch
call check "${ARGS[@]}"
is "1: a PR based on another branch is stacked" "$(val outcome)" stacked
has "1: ...saying why it must not merge" "$ERR" "would land nothing on 'main'"
facts 7
call check "${ARGS[@]}" --head "$H2"
is "1: a head other than the one named is moved" "$(val outcome)" moved
call check "${ARGS[@]}" --head "$H1"
is "1: the named head still standing is ready" "$(val outcome)" ready
facts 7 state=MERGED merged="$MC" base=parent-branch
call check "${ARGS[@]}"
is "1: a merged PR is not-open, ahead of everything else" "$(val outcome)" not-open
is "1: ...with its merge commit" "$(val merge-commit)" "$MC"

C1='{"author":{"login":"alice"},"createdAt":"2026-01-01T10:00:00Z","url":"https://x/c1"}'
C2='{"author":null,"createdAt":"2026-01-03T10:00:00Z","url":"https://x/c2"}'
V1='{"author":{"login":"bot"},"state":"COMMENTED","submittedAt":"2026-01-04T10:00:00Z","url":"https://x/r1"}'
V2='{"author":{"login":"me"},"state":"PENDING","submittedAt":null,"url":"https://x/r2"}'
facts 7 comments="$C1,$C2" reviews="$V1,$V2"
call check "${ARGS[@]}"
lacks "1: without --since no comment is listed" "$OUT" "new="
call check "${ARGS[@]}" --since 2026-01-02T00:00:00Z
lacks "1: a comment older than --since is not listed" "$OUT" "https://x/c1"
has "1: a newer one is, a deleted author as ghost" "$OUT" "new=comment	ghost	2026-01-03T10:00:00Z	https://x/c2"
has "1: a newer submitted review is, with its state" "$OUT" "new=review:COMMENTED	bot	2026-01-04T10:00:00Z	https://x/r1"
lacks "1: a pending review nobody submitted is not" "$OUT" "https://x/r2"
facts 7 comments="$C2" more=true cursor=c1
facts 7.p2 comments="$C2"
call check "${ARGS[@]}" --since 2026-01-02T00:00:00Z
is "1: a comment repeated on every thread page is listed once" "$(printf '%s\n' "$OUT" | grep -c '^new=')" 1

facts 7 pr=8
call check "${ARGS[@]}"
is "1: an answer for another PR is a failure" "$RC" 1
is "1: ...with nothing on stdout" "$OUT" ""
facts 7
rollup 7 "$H2" "$GREEN"
call check "${ARGS[@]}"
is "1: a rollup describing another head is a failure, not a verdict" "$RC" 1
facts 7 more=true cursor=c1
facts 7.p2 head="$H2"
rollup 7 "$H2" "$GREEN"
call check "${ARGS[@]}"
is "1: a head that moves between two pages is a failure" "$RC" 1
has "1: ...caught on the pages themselves" "$ERR" "while it was being read"
facts 7
touch "$FAKE/fail-rollup"
call check "${ARGS[@]}"
is "1: a rollup that could not be read is a failure" "$RC" 1
has "1: ...that claims nothing" "$ERR" "Nothing here says its lanes are green"
fresh
touch "$FAKE/fail-api"
call check "${ARGS[@]}"
is "1: a PR that could not be read is a failure" "$RC" 1
fresh
facts 7
rollup 7 "$H1" "$GREEN"
call check --repo ghe.example.com/acme/widgets --pr 7
is "1: a repository on another host is read there" "$(val outcome)" ready
has "1: ...by --hostname" "$(cat "$FAKE/gh.log")" "api graphql --hostname ghe.example.com -f owner=acme -f name=widgets"
call check --repo acme/widgets
is "1: no PR number is a usage error" "$RC" 64
has "1: ...whose usage text lists every command" "$ERR" "train.sh merge"
call check "${ARGS[@]}" --head abc
is "1: a short --head is a usage error" "$RC" 64
call check "${ARGS[@]}" --since 'yesterday; rm'
is "1: a --since that is not a time is a usage error" "$RC" 64

# --- 2. survey ----------------------------------------------------------------
fresh
facts 7 branch=feature
facts 8 pr=8 branch=child base=feature head="$H2"
facts 9 pr=9 branch=other threads=false
rollup 7 "$H1" "$GREEN"
rollup 8 "$H2" "$(lane a IN_PROGRESS null)"
rollup 9 "$H1" "$GREEN"
printf 'src/a.js\nREADME.md\n' >"$FAKE/files.7"
printf 'src/b.js\n' >"$FAKE/files.8"
printf 'README.md\nsrc/b.js\nsrc/c.js\n' >"$FAKE/files.9"
call survey --repo acme/widgets 7 8 9
is "2: a survey exits 0 whatever the PRs' standing" "$RC" 0
is "2: ...as outcome=surveyed" "$(val outcome)" surveyed
is "2: ...naming the default branch" "$(val default)" main
has "2: a ready PR on the default branch has no parent" "$OUT" "pr=7	outcome=ready	base=main	parent=-	head=$H1	mergeable=MERGEABLE	review=NONE	threads=0	ci=green	lanes=2	files=2"
has "2: a PR based on a listed PR's branch names that PR as its parent" "$OUT" "pr=8	outcome=stacked	base=feature	parent=7"
has "2: a PR with an open thread is shown as such" "$OUT" "pr=9	outcome=review	base=main	parent=-"
facts 8 pr=8 branch=child base=feature head="$H2" threads=false
call survey --repo acme/widgets 7 8 9
has "2: ...and so is a stacked one, still with its parent" "$OUT" "pr=8	outcome=review	base=feature	parent=7"
facts 8 pr=8 branch=child base=feature head="$H2"
has "2: a file two PRs touch is listed with both" "$OUT" "shared=README.md	7,9"
has "2: ...each such file" "$OUT" "shared=src/b.js	8,9"
lacks "2: a file one PR touches is not" "$OUT" "shared=src/a.js"
has "2: the files are read per PR, by number and repository" "$(cat "$FAKE/gh.log")" "pr diff 8 --repo acme/widgets --name-only"
lacks "2: with nothing else open, no PR is named as unlisted" "$OUT" "unlisted="
# open <number> <branch> <title (JSON string body)>...
open_prs() {
	local sep="" out="["
	while [ $# -ge 3 ]; do
		out="$out$sep{\"number\":$1,\"headRefName\":\"$2\",\"title\":\"$3\"}"
		sep=,
		shift 3
	done
	printf '%s]\n' "$out" >"$FAKE/open.json"
}
open_prs 12 late 'Fix the\tthing\r\nfor good' 9 other 'Listed' 7 feature 'Listed too' 70 seventy 'Not seven'
call survey --repo acme/widgets 7 8 9
is "2: an open PR that is not on the list is named, its title on one line" "$(printf '%s\n' "$OUT" | grep '^unlisted=12')" "unlisted=12	late	Fix the thing for good"
is "2: ...each of them, and no listed one" "$(printf '%s\n' "$OUT" | grep -c '^unlisted=')" 2
has "2: ...matched by its whole number" "$OUT" "unlisted=70	seventy	Not seven"
is "2: ...after everything else" "$(printf '%s\n' "$OUT" | tail -n 1)" "unlisted=70	seventy	Not seven"
is "2: ...and changes neither the outcome" "$(val outcome)" surveyed
is "2: ...nor the exit status" "$RC" 0
has "2: the open PRs asked for are the default branch's, in that repository, up to the bound" "$(cat "$FAKE/gh.log")" "pr list --repo acme/widgets --state open --base main --limit 100 "
touch "$FAKE/fail-list"
call survey --repo acme/widgets 7 8 9
is "2: a listing that fails is reported as unknown" "$(val unlisted)" unknown
is "2: ...which is not a failed survey" "$RC" 0
is "2: ...nor an incomplete one" "$(val outcome)" surveyed
has "2: ...the listed PRs standing as read" "$OUT" "pr=7	outcome=ready"
has "2: ...with the reason on stderr" "$ERR" "could not list the PRs open against 'main'"
rm "$FAKE/fail-list"
seq 101 199 | awk '{ printf "%s{\"number\":%s,\"headRefName\":\"b%s\",\"title\":\"t\"}", (NR > 1 ? "," : "["), $1, $1 } END { print "]" }' >"$FAKE/open.json"
call survey --repo acme/widgets 7 8 9
is "2: a listing one short of the bound is the whole set" "$(printf '%s\n' "$OUT" | grep -c '^unlisted=')" 99
lacks "2: ...and says so by saying nothing" "$OUT" "unlisted=unknown"
seq 101 200 | awk '{ printf "%s{\"number\":%s,\"headRefName\":\"b%s\",\"title\":\"t\"}", (NR > 1 ? "," : "["), $1, $1 } END { print "]" }' >"$FAKE/open.json"
call survey --repo acme/widgets 7 8 9
is "2: a listing that came back full names what it holds" "$(printf '%s\n' "$OUT" | grep -c '^unlisted=[0-9]')" 100
is "2: ...and ends on unknown, for the ones it may not hold" "$(printf '%s\n' "$OUT" | tail -n 1)" "unlisted=unknown"
is "2: ...still without stopping" "$RC" 0
open_prs 12 late 'Unlisted'
touch "$FAKE/missing.9"
call survey --repo acme/widgets 7 9 8
is "2: a listed number that is no PR leaves the survey incomplete" "$(val outcome)" incomplete
is "2: ...which is a stop" "$RC" 3
is "2: ...with a line of its own, in its place on the list" "$(printf '%s\n' "$OUT" | sed -n 4p)" "pr=9	outcome=unreadable	reason=no-such-pr"
has "2: ...while the others are surveyed as before" "$OUT" "pr=7	outcome=ready	base=main	parent=-	head=$H1	mergeable=MERGEABLE	review=NONE	threads=0	ci=green	lanes=2	files=2"
has "2: ...each of them, with its parent" "$OUT" "pr=8	outcome=stacked	base=feature	parent=7"
is "2: ...and the default branch still named" "$(val default)" main
lacks "2: ...and its files, never read, are shared with nobody" "$OUT" "shared="
has "2: gh's own words for it reach stderr" "$ERR" "Could not resolve to a PullRequest with the number of 9."
has "2: ...beside the helper's count" "$ERR" "1 of the listed PRs could not be read"
has "2: an incomplete survey still names the unlisted PRs" "$OUT" "unlisted=12	late	Unlisted"
rm "$FAKE/missing.9" "$FAKE/rollup.9.json"
call survey --repo acme/widgets 7 8 9
is "2: a PR gh could not be asked about is unreadable too, for that reason" "$(printf '%s\n' "$OUT" | grep '^pr=9')" "pr=9	outcome=unreadable	reason=gh-failed"
is "2: ...and the survey a stop" "$RC" 3
rollup 9 "$H1" "$GREEN"
rm "$FAKE/files.8"
call survey --repo acme/widgets 7 8 9
is "2: so is a PR whose files could not be listed" "$(printf '%s\n' "$OUT" | grep '^pr=8')" "pr=8	outcome=unreadable	reason=gh-failed"
is "2: ...which leaves the survey incomplete" "$(val outcome)" incomplete
has "2: ...and the files of the others still compared" "$OUT" "shared=README.md	7,9"
lacks "2: ...without its own" "$OUT" "shared=src/b.js"
printf 'src/b.js\n' >"$FAKE/files.8"
touch "$FAKE/missing.7" "$FAKE/missing.8" "$FAKE/missing.9"
: >"$FAKE/gh.log"
call survey --repo acme/widgets 7 8 9
is "2: a list of numbers that are all no PR is still an answer" "$(val outcome)" incomplete
is "2: ...a stop, not a failure" "$RC" 3
is "2: ...naming each" "$(printf '%s\n' "$OUT" | grep -c 'outcome=unreadable	reason=no-such-pr$')" 3
is "2: ...and, with no default branch read, the unlisted PRs unknown" "$(val unlisted)" unknown
lacks "2: ...without asking for them" "$(cat "$FAKE/gh.log")" "pr list"
rm "$FAKE"/missing.*
touch "$FAKE/fail-api"
call survey --repo acme/widgets 7 8 9
is "2: a survey in which gh answered for no PR is a failure" "$RC" 1
is "2: ...with nothing on stdout" "$OUT" ""
has "2: ...saying so" "$ERR" "could not read any of the listed PRs"
rm "$FAKE/fail-api"
call survey --repo acme/widgets
is "2: a survey of nothing is a usage error" "$RC" 64

# --- 3. rebase ----------------------------------------------------------------
commit() { # <repo> <file> <content>
	printf '%s\n' "$3" >"$1/$2"
	git -C "$1" add -A
	git -C "$1" commit -q -m "$2: $3"
}
tip() { git -C "${2:-$R}" rev-parse "$1"; }
# pr <state> <headRefName> <headRefOid> [<baseRefName>]
pr() {
	printf '{"state":"%s","headRefName":"%s","headRefOid":"%s","baseRefName":"%s","isCrossRepository":false,"url":"https://github.com/Acme/Widgets/pull/7"}\n' \
		"$1" "$2" "$3" "${4-main}" >"$FAKE/pr.json"
	PRHEAD="$3"
}
# new_repo → O (bare origin), R (clone on `feature`, two commits past main,
# pushed), U (a second clone, to move origin from elsewhere).
new_repo() {
	local d
	fresh
	d="$(mktemp -d "$WORKDIR/case.XXXXXX")"
	O="$d/origin.git"
	R="$d/repo"
	U="$d/other"
	git init -q --bare -b main "$O"
	git init -q -b main "$R"
	commit "$R" base one
	commit "$R" shared one
	git -C "$R" remote add origin "https://github.com/Acme/Widgets.git"
	git -C "$R" config "url.$O.insteadOf" "https://github.com/Acme/Widgets.git"
	git -C "$R" push -q -u origin main
	git -C "$R" checkout -q -b feature
	commit "$R" f1 one
	commit "$R" f2 one
	git -C "$R" push -q -u origin feature
	git clone -q "$O" "$U"
	pr OPEN feature "$(tip HEAD)"
}
land() { # <file> <content> — a commit on origin's main, from elsewhere
	git -C "$U" checkout -q main
	git -C "$U" pull -q origin main
	commit "$U" "$1" "$2"
	git -C "$U" push -q origin main
}

new_repo
BEFORE="$(tip HEAD)"
call rebase "${ARGS[@]}" --head "$PRHEAD"
is "3: a branch already on the default branch's tip is current" "$(val outcome)" current
is "3: ...and untouched" "$(tip HEAD)" "$BEFORE"
is "3: ...with nothing landed since" "$(val landed)" 0

land m1 one
land f1 other-content-on-main-side
git -C "$U" revert --no-edit HEAD >/dev/null
git -C "$U" push -q origin main
land shared two
MAIN="$(tip main "$U")"
# A second local branch inside the stack, which --update-refs would drag along.
git -C "$R" branch mid HEAD~1
git -C "$R" config rebase.updateRefs true
MID="$(tip mid)"
call rebase "${ARGS[@]}" --head "$PRHEAD"
is "3: a branch behind the default branch is rebased" "$(val outcome)" rebased
is "3: ...with exit 0" "$RC" 0
is "3: ...onto the tip fetched just now, not a stale ref" "$(val base)" "$MAIN"
is "3: ...which HEAD now descends from" "$(git -C "$R" merge-base HEAD "$MAIN")" "$MAIN"
is "3: the PR head it started from is reported as the lease" "$(val before)" "$BEFORE"
is "3: the new head is reported" "$(val head)" "$(tip HEAD)"
is "3: with its commit count" "$(val commits)" 2
is "3: another local branch in the stack is left where it was" "$(tip mid)" "$MID"
is "3: the files that landed are counted" "$(val landed)" 2
lacks "3: a file only the default branch touched is no overlap" "$OUT" "overlap=m1"
lacks "3: a file only the PR touched is no overlap" "$OUT" "overlap=f2"
lacks "3: a file the default branch changed and changed back is not landed" "$OUT" "overlap=f1"
is "3: the origin branch is not pushed by a rebase" "$(git -C "$O" rev-parse feature)" "$BEFORE"

new_repo
commit "$R" shared mine
git -C "$R" push -q origin feature
pr OPEN feature "$(tip HEAD)"
land other one
call rebase "${ARGS[@]}" --head "$PRHEAD"
is "3: (setup) no conflict when the default branch left the file alone" "$(val outcome)" rebased
lacks "3: ...and no overlap" "$OUT" "overlap="

new_repo
commit "$R" shared mine
git -C "$R" push -q origin feature
BEFORE="$(tip HEAD)"
pr OPEN feature "$BEFORE"
land shared theirs
call rebase "${ARGS[@]}" --head "$PRHEAD"
is "3: a conflicting rebase is a stop" "$RC" 3
is "3: ...reported as a conflict" "$(val outcome)" conflict
has "3: ...naming the file" "$OUT" "conflict=shared"
has "3: ...and the overlap that predicted it" "$OUT" "overlap=shared"
is "3: ...with the lease for the push that follows a resolution" "$(val before)" "$BEFORE"
[ -d "$(git -C "$R" rev-parse --absolute-git-dir)/rebase-merge" ]
ok "3: ...left in progress to resolve or abort" $?
has "3: ...with both ways out on stderr" "$ERR" "git rebase --abort"
call rebase "${ARGS[@]}" --head "$PRHEAD"
is "3: asking again mid-rebase stops on the tree, changing nothing" "$(val outcome)" dirty
git -C "$R" rebase --abort

# A child whose parent merged: only the commits after the parent's old tip replay.
new_repo
PARENT_OLD="$(tip HEAD)"
git -C "$R" checkout -q -b child
commit "$R" c1 one
git -C "$R" push -q -u origin child
pr OPEN child "$(tip HEAD)"
# The parent lands on main from elsewhere, amended on its way in: its commits
# are there under other ids and with other content, so nothing but --from
# keeps the child's rebase from replaying the old ones.
git -C "$U" checkout -q main
commit "$U" f1 amended
commit "$U" f2 one
git -C "$U" push -q origin main
land later one
CHILD="$(tip HEAD)"
call rebase "${ARGS[@]}" --head "$PRHEAD" --from "$H1"
is "3: a --from that is no commit of this branch is a stop" "$(val outcome)" bad-from
is "3: ...that rebased nothing" "$(tip HEAD)" "$CHILD"
call rebase "${ARGS[@]}" --head "$PRHEAD" --from "$PARENT_OLD"
is "3: a child is rebased past its merged parent" "$(val outcome)" rebased
is "3: ...replaying its own commit alone" "$(val commits)" 1
has "3: ...which is the child's" "$(git -C "$R" log -1 --format=%s)" "c1"
lacks "3: ...and the parent's files are not counted as the child's" "$OUT" "overlap="

new_repo
pr OPEN feature "$(tip HEAD)" parent-branch
call rebase "${ARGS[@]}" --head "$PRHEAD"
is "3: a PR still based on its parent's branch is not rebased" "$(val outcome)" stacked
has "3: ...with the retarget named" "$ERR" "gh pr edit 7 --repo acme/widgets --base main"

new_repo
commit "$R" local-only one
LOCAL="$(tip HEAD)"
land m1 one
call rebase "${ARGS[@]}" --head "$PRHEAD"
is "3: a local branch holding commits the PR lacks is a stop" "$(val outcome)" local-ahead
is "3: ...and is not moved" "$(tip HEAD)" "$LOCAL"

new_repo
BEFORE="$(tip HEAD)"
commit "$U" unrelated one 2>/dev/null
git -C "$U" checkout -q feature
commit "$U" f3 pushed-by-someone
git -C "$U" push -q origin feature
MOVED="$(tip HEAD "$U")"
land m1 one
git -C "$R" fetch -q origin main
pr OPEN feature "$MOVED"
call rebase "${ARGS[@]}" --head "$BEFORE"
is "3: a PR head other than the one whose rollup was read is moved" "$(val outcome)" moved
is "3: ...with exit 3" "$RC" 3
is "3: ...naming the head it found" "$(val head)" "$MOVED"
is "3: ...and nothing is rebased onto the new main" "$(git -C "$R" merge-base --is-ancestor origin/main HEAD; echo $?)" 1
call rebase "${ARGS[@]}"
is "3: a rebase with no --head is a usage error" "$RC" 64

# The overlap is measured from the last full green run, not from the last rebase.
new_repo
GREENHEAD="$(tip HEAD)"
commit "$R" shared mine
git -C "$R" push -q origin feature
pr OPEN feature "$(tip HEAD)"
GREENHEAD="$(tip HEAD)"
land shared-other one
call rebase "${ARGS[@]}" --head "$PRHEAD"
call push "${ARGS[@]}" --expect "$PRHEAD"
pr OPEN feature "$(tip HEAD)"
land m2 one
call rebase "${ARGS[@]}" --head "$PRHEAD"
is "3: (setup) a second rebase alone sees only what landed since the first" "$(val landed)" 1
git -C "$R" reset -q --hard "$PRHEAD"
call rebase "${ARGS[@]}" --head "$PRHEAD" --green "$GREENHEAD"
is "3: with --green, what landed is counted from the green run's fork" "$(val landed)" 2
git -C "$R" reset -q --hard "$PRHEAD"
call rebase "${ARGS[@]}" --head "$PRHEAD" --green "$H1"
is "3: a --green this worktree does not hold is a stop" "$(val outcome)" bad-green
call rebase "${ARGS[@]}" --head "$PRHEAD" --green not-a-commit
is "3: a --green that is no commit id is a usage error" "$RC" 64

new_repo
git -C "$R" reset -q --hard HEAD~1
STALE="$(tip HEAD)"
land m1 one
call rebase "${ARGS[@]}" --head "$PRHEAD"
is "3: a stale local branch is brought to the PR head first" "$(val outcome)" rebased
is "3: ...so both of the PR's commits are replayed" "$(val commits)" 2
is "3: ...and the lease is the PR head, not the stale tip" "$(val before)" "$PRHEAD"
[ "$PRHEAD" != "$STALE" ]
ok "3: (setup) the stale tip was not the PR head" $?

new_repo
echo x >"$R/stray"
call rebase "${ARGS[@]}" --head "$PRHEAD"
is "3: a dirty worktree is a stop, passed on from the reconciliation" "$(val outcome)" dirty
is "3: ...with exit 3" "$RC" 3
rm "$R/stray"
pr CLOSED feature "$(tip HEAD)"
call rebase "${ARGS[@]}" --head "$PRHEAD"
is "3: so is a closed PR" "$(val outcome)" closed

new_repo
land m1 one
D="$R"
R="$WORKDIR"
call -C "$D" rebase "${ARGS[@]}" --head "$PRHEAD"
is "3: -C names the worktree from anywhere" "$(val outcome)" rebased
R="$D"

# --- 4. push ------------------------------------------------------------------
new_repo
BEFORE="$(tip HEAD)"
land m1 one
call rebase "${ARGS[@]}" --head "$PRHEAD"
NEW="$(val head)"
call push "${ARGS[@]}" --expect "$BEFORE"
is "4: the rebased branch is published" "$(val outcome)" pushed
is "4: ...to the PR's head ref" "$(git -C "$O" rev-parse feature)" "$NEW"
new_repo
BEFORE="$(tip HEAD)"
land m1 one
call rebase "${ARGS[@]}" --head "$PRHEAD"
commit "$U" elsewhere one 2>/dev/null
git -C "$U" checkout -q feature 2>/dev/null
commit "$U" f3 one
git -C "$U" push -q origin feature
MOVED="$(tip HEAD "$U")"
call push "${ARGS[@]}" --expect "$BEFORE"
is "4: a head that moved since the lease is a stop" "$(val outcome)" head-moved
is "4: ...and the other writer's commit stands" "$(git -C "$O" rev-parse feature)" "$MOVED"
call push "${ARGS[@]}"
is "4: a push with no lease is a usage error" "$RC" 64

# --- 5. merge -----------------------------------------------------------------
unset R
MARGS=(--repo acme/widgets --pr 7 --head "$H1")
fresh
facts 7
facts 7.merged state=MERGED merged="$MC"
touch "$FAKE/merge-lands"
call merge "${MARGS[@]}"
is "5: a ready PR is merged" "$(val outcome)" merged
is "5: ...with exit 0" "$RC" 0
is "5: ...reporting the merge commit read back" "$(val merge-commit)" "$MC"
MERGE="$(grep '^pr merge' "$FAKE/gh.log")"
is "5: ...by a merge commit on exactly that head, in that repository" "$MERGE" "pr merge 7 --repo acme/widgets --merge --match-head-commit $H1"
has "5: the head is compared with the default branch first" "$(cat "$FAKE/gh.log")" "api repos/acme/widgets/compare/main...$H1"

nomerge() { # <label>
	if grep -q '^pr merge' "$FAKE/gh.log"; then ok "$1" 1; else ok "$1" 0; fi
}
fresh
facts 7 head="$H2"
call merge "${MARGS[@]}"
is "5: a head that moved is not merged" "$(val outcome)" moved
is "5: ...with exit 3" "$RC" 3
nomerge "5: ...and no merge is asked for"
fresh
facts 7 threads=false
call merge "${MARGS[@]}"
is "5: an open thread is not merged over" "$(val outcome)" review
nomerge "5: ...and no merge is asked for"
fresh
facts 7 latest=CHANGES_REQUESTED
call merge "${MARGS[@]}"
is "5: a standing change request is not merged over, review decision or none" "$(val outcome)" review
is "5: ...and is counted" "$(val changes-requested)" 1
nomerge "5: ...and no merge is asked for"
fresh
facts 7 base=parent-branch
call merge "${MARGS[@]}"
is "5: a PR based on another branch is not merged into it" "$(val outcome)" stacked
nomerge "5: ...and no merge is asked for"
fresh
facts 7 draft=true
call merge "${MARGS[@]}"
is "5: a draft is not merged" "$(val outcome)" draft
fresh
facts 7 state=MERGED merged="$MC"
call merge "${MARGS[@]}"
is "5: an already merged PR is not-open" "$(val outcome)" not-open
is "5: ...with the merge commit it has" "$(val merge-commit)" "$MC"
nomerge "5: ...and no second merge is asked for"
fresh
facts 7
printf '{"behind_by":2}\n' >"$FAKE/compare.json"
call merge "${MARGS[@]}"
is "5: a head behind the default branch is not merged" "$(val outcome)" behind
is "5: ...with the count" "$(val behind)" 2
nomerge "5: ...and no merge is asked for"
fresh
facts 7
printf '{}\n' >"$FAKE/compare.json"
call merge "${MARGS[@]}"
is "5: a comparison that gives no count is a failure, not zero" "$RC" 1
nomerge "5: ...and no merge is asked for"
fresh
facts 7 mergeable=CONFLICTING
call merge "${MARGS[@]}"
is "5: a conflicting PR is not merged" "$(val outcome)" conflicting
nomerge "5: ...and no merge is asked for"

fresh
facts 7 mergeable=UNKNOWN
facts 7.2 mergeable=MERGEABLE
facts 7.merged state=MERGED merged="$MC"
touch "$FAKE/merge-lands"
call merge "${MARGS[@]}"
is "5: mergeability still unknown right after a push is waited out" "$(val outcome)" merged
fresh
facts 7 mergeable=UNKNOWN
call merge "${MARGS[@]}" --wait 1
is "5: mergeability that never settles is a stop" "$(val outcome)" unsettled
is "5: ...after the wait it was given and no longer" "$(cat "$FAKE/reads.7")" 2
nomerge "5: ...and no merge is asked for"
fresh
facts 7 mergeable=UNKNOWN
facts 7.2 mergeable=MERGEABLE
printf '{"behind_by":1}\n' >"$FAKE/compare.late.json"
touch "$FAKE/merge-moves-main"
call merge "${MARGS[@]}"
is "5: a PR that fell behind during the wait is not merged" "$(val outcome)" behind
nomerge "5: ...and no merge is asked for"
fresh
facts 7 head="$H2"
facts 7.2
facts 7.merged state=MERGED merged="$MC"
touch "$FAKE/merge-lands"
call merge "${MARGS[@]}"
is "5: a head GitHub reports late, right after the push, is waited for" "$(val outcome)" merged
fresh
facts 7
touch "$FAKE/merge-breaks-api"
call merge "${MARGS[@]}"
is "5: a read-back that fails after the merge was asked for is a failure" "$RC" 1
has "5: ...that does not claim nothing changed" "$ERR" "its result is unread"
lacks "5: ...in either wording" "$ERR" "Nothing was changed"
fresh
facts 7 mergeable=UNKNOWN
facts 7.2 mergeable=UNKNOWN threads=false
call merge "${MARGS[@]}"
is "5: a review that lands during the wait stops the merge" "$(val outcome)" review
nomerge "5: ...and no merge is asked for"

fresh
facts 7
printf 'GraphQL: Repository rule violations found (mergePullRequest)\n' >"$FAKE/merge-error"
call merge "${MARGS[@]}"
is "5: a merge GitHub refuses is a stop" "$(val outcome)" refused
is "5: ...with exit 3" "$RC" 3
has "5: ...relaying what GitHub said" "$ERR" "Repository rule violations"
has "5: ...and that it is not to be bypassed" "$ERR" "never bypass"
is "5: ...asked for once" "$(grep -c '^pr merge' "$FAKE/gh.log")" 1
lacks "5: ...and never with --admin" "$(cat "$FAKE/gh.log")" "--admin"
fresh
facts 7
printf 'Pull request must be merged using the asynchronous merge REST API\n' >"$FAKE/merge-error"
call merge "${MARGS[@]}"
is "5: a stacked PR GitHub wants merged asynchronously says so" "$(val outcome)" async-required
fresh
facts 7
facts 7.merged state=MERGED merged="$MC"
touch "$FAKE/merge-lands"
printf 'failed to delete local branch\n' >"$FAKE/merge-error"
call merge "${MARGS[@]}"
is "5: a merge that landed behind an error is read back as merged" "$(val outcome)" merged
fresh
facts 7
call merge "${MARGS[@]}"
is "5: a merge command that returned with the PR still open is unconfirmed" "$(val outcome)" unconfirmed
call merge --repo acme/widgets --pr 7
is "5: a merge without a head is a usage error" "$RC" 64

# --- 6. the shipped files -----------------------------------------------------
cmp -s "$SHIPPED" "$MIRROR"
ok "6: the Codex mirror ships the same helper, byte for byte" $?
for f in plugins/dev-skills/skills/merge-train/train.sh codex/dev-skills/skills/merge-train/train.sh; do
	mode="$(git -c safe.directory='*' -C "$SCRIPT_DIR/.." ls-files -s -- "$f" | cut -d' ' -f1)"
	is "6: $f is committed executable" "$mode" 100755
done
OUT="$(bash "$SHIPPED" --help 2>&1)"
has "6: the helper prints its contract" "$OUT" "train.sh merge"
has "6: ...the watch's part of it too" "$OUT" "outcome=stopped"
lacks "6: ...and none of its code" "$OUT" "set -u"
for sibling in pr-branch.sh ci.sh; do
	[ -f "$(dirname "$MIRROR")/../address-review/$sibling" ]
	ok "6: the Codex mirror has the address-review $sibling the helper calls" $?
done
EMPTY="$WORKDIR/alone/merge-train"
mkdir -p "$EMPTY"
cp "$HELPER" "$EMPTY/train.sh"
fresh
facts 7
OUT="$(bash "$EMPTY/train.sh" check "${ARGS[@]}" 2>&1)"
is "6: a copy with no address-review folder beside it fails" "$?" 1
has "6: ...saying what is missing" "$OUT" "address-review skill's scripts"

# --- 7. watch, note, state ----------------------------------------------------
# The watch's waits are a `sleep` that returns at once and logs what it was
# asked for, so hours of polling run in a moment and each wait can be read.
SLEEP="$WORKDIR/sleepbin"
mkdir -p "$SLEEP"
printf '#!/bin/sh\nprintf "%%s\\n" "$1" >>"$FAKE/sleep.log"\n' >"$SLEEP/sleep"
chmod +x "$SLEEP/sleep"
REALPATH="$PATH"
PATH="$SLEEP:$PATH"
L="$WORKDIR/train.list"
S="$WORKDIR/train.state"
export L
WARGS=(--repo acme/widgets --list "$L" --state "$S")
RUNNING="$(lane a IN_PROGRESS null)"
lines() { printf '%s\n' "$OUT" | grep -c "$1"; }
sleeps() { tr '\n' ' ' <"$FAKE/sleep.log" 2>/dev/null; }
polls() { cat "$FAKE/reads.$1" 2>/dev/null || echo 0; }
# hook <pr> <n> <shell> — run on that PR's n-th read; a list is replaced
# whole, by a rename, as an editor does it.
hook() { printf '%s\n' "$3" >"$FAKE/hook.$1.$2"; }
wfresh() {
	fresh
	rm -f "$S" "$L"
	: >"$FAKE/gh.log"
}

# A sequence of outcomes on two PRs: 7 waits, goes red, then green; 8 waits
# throughout and goes green last.
wfresh
printf '# the train\n7\n8 %s   # pinned\n\n' "$H2" >"$L"
facts 7
facts 8 pr=8 head="$H2" branch=other
rollup 7 "$H1" "$RUNNING"
rollup 7.2 "$H1" "$RUNNING,$(lane b QUEUED null)"
rollup 7.3 "$H1" "$(lane a COMPLETED '"SUCCESS"'),$(lane b COMPLETED '"FAILURE"'),$(lane c IN_PROGRESS null)"
rollup 7.4 "$H1" "$(lane a COMPLETED '"SUCCESS"'),$(lane b COMPLETED '"FAILURE"'),$(lane c COMPLETED '"SUCCESS"')"
rollup 7.5 "$H1" "$GREEN"
rollup 7.6 "$H1" "$GREEN"
rollup 8 "$H2" "$RUNNING"
rollup 8.6 "$H2" "$GREEN"
call watch "${WARGS[@]}"
is "7: a watch whose entries have all left waiting ends by itself, with exit 0" "$RC" 0
is "7: it printed one line per change of outcome and one for stopping, and nothing else" "$(printf '%s\n' "$OUT" | wc -l | tr -d ' ')" 6
is "7: ...a PR's first reading, on the head it had" "$(printf '%s\n' "$OUT" | sed -n 1p)" "pr=7	head=$H1	outcome=waiting	ci=running"
is "7: ...and one pinned to a head by the list" "$(printf '%s\n' "$OUT" | sed -n 2p)" "pr=8	head=$H2	outcome=waiting	ci=running"
is "7: ...red once, though its running lanes changed while it was red" "$(lines 'pr=7.*outcome=red')" 1
is "7: ...waiting once, though its running lanes changed while it waited" "$(lines 'pr=7.*outcome=waiting')" 1
is "7: ...then ready" "$(printf '%s\n' "$OUT" | sed -n 4p)" "pr=7	head=$H1	outcome=ready	ci=green"
is "7: the last line says why it stopped" "$(printf '%s\n' "$OUT" | tail -n 1)" "outcome=stopped	reason=idle	pending=	unread="
is "7: each poll read each PR once" "$(polls 7) $(polls 8)" "6 6"
is "7: ...two minutes apart unless told otherwise" "$(sleeps)" "120 120 120 120 120 "
has "7: the state file holds every line it printed, with its time" "$(cat "$S")" "pr=7	head=$H1	outcome=red	ci=failing	at=20"
has "7: ...the lanes of the PR's full green run, with the head it was on" "$(cat "$S")" "green=7	head=$H1	lane=Tests / a	lane=Tests / b"
has "7: ...and how the watch ended" "$(cat "$S")" "reason=idle"
has "7: ...and what it was started on" "$(cat "$S")" "watch=started"
# A second watch on the same state file knows what the first one said.
rollup 7 "$H1" "$GREEN"
rollup 8 "$H2" "$GREEN"
call watch "${WARGS[@]}"
is "7: a watch resumed on its state file repeats no outcome the file holds" "$OUT" "outcome=stopped	reason=idle	pending=	unread="
call state --state "$S"
is "7: the state file read down starts with outcome=state" "$(val outcome)" state
has "7: ...gives each PR's head and standing" "$OUT" "pr=7	head=$H1	outcome=ready	ci=green"
is "7: ...once each, the latest" "$(lines '^pr=')" 2
has "7: ...and the latest word on the watch itself" "$OUT" "watch=stopped"
is "7: state needs no repository" "$RC" 0

# The list is edited while the watch runs: 9 added on the second poll, 7
# dropped on the third.
wfresh
printf '7\n' >"$L"
facts 7
facts 9 pr=9 head="$H2"
rollup 7 "$H1" "$RUNNING"
rollup 9 "$H2" "$GREEN"
hook 7 2 'printf "7\n9\n" >"$L.new" && mv "$L.new" "$L"'
hook 7 3 'printf "9\n" >"$L.new" && mv "$L.new" "$L"'
call watch "${WARGS[@]}"
is "7: a PR added to the list is picked up without a restart" "$(lines "pr=9	head=$H2	outcome=ready")" 1
is "7: ...from the poll after the edit, not before" "$(polls 9)" 2
is "7: a PR dropped from the list is polled no more" "$(polls 7)" 3
is "7: ...and no longer keeps the watch going" "$(printf '%s\n' "$OUT" | tail -n 1)" "outcome=stopped	reason=idle	pending=	unread="
has "7: ...which the state file records" "$(cat "$S")" "unlisted=7	at="
is "7: ...once" "$(grep -c '^unlisted=7' "$S")" 1
call state --state "$S"
lacks "7: ...so the state read down no longer lists it" "$OUT" "pr=7"

# The bound: entries still waiting when --max runs out.
wfresh
printf '7\n' >"$L"
facts 7
rollup 7 "$H1" "$RUNNING"
call watch "${WARGS[@]}" --interval 60 --max 150
is "7: a watch stops at its maximum duration with something still waiting" "$(printf '%s\n' "$OUT" | tail -n 1)" "outcome=stopped	reason=expired	pending=7	unread="
is "7: ...as a stop, so the caller knows to re-arm" "$RC" 3
is "7: ...having waited no longer than the bound, the last wait cut to fit" "$(sleeps)" "60 60 30 "
is "7: ...and said nothing in between" "$(printf '%s\n' "$OUT" | wc -l | tr -d ' ')" 2
has "7: ...with how to go on, on stderr" "$ERR" "Start it again on the same list and state file"
call watch "${WARGS[@]}" --max 0
is "7: a maximum of nothing is one poll" "$(polls 7)" 5

# moved and not-open end an entry: said once, then not polled until the list
# names another head.
wfresh
printf '7 %s\n9\n8\n' "$H1" >"$L"
facts 7 head="$H2"
facts 9 pr=9 state=MERGED merged="$MC"
facts 8 pr=8
rollup 7 "$H2" "$GREEN"
rollup 9 "$H1" "$GREEN"
rollup 8 "$H1" "$RUNNING"
hook 8 3 'printf "7 '"$H2"'\n9\n8\n" >"$L.new" && mv "$L.new" "$L"'
call watch "${WARGS[@]}" --max 600
is "7: a head someone else pushed over is reported as moved, with the head it moved to" "$(lines "pr=7	head=$H1	outcome=moved	now=$H2")" 1
is "7: a merged PR is reported with its merge commit" "$(lines "pr=9	head=$H1	outcome=not-open	state=MERGED	merge-commit=$MC")" 1
is "7: ...and is not polled again" "$(polls 9)" 1
is "7: the moved PR is polled again only once the list names its new head" "$(polls 7)" 4
is "7: ...and is then reported on that head" "$(lines "pr=7	head=$H2	outcome=ready")" 1
is "7: (setup) the watch ran its six polls" "$(polls 8)" 6

# After a full green run the watch holds a later head to that run's lanes, and
# a listed head GitHub does not show yet is a push on its way.
wfresh
printf '8\n7 %s\n' "$H1" >"$L"
facts 8 pr=8 head="$H2"
rollup 8 "$H2" "$RUNNING"
facts 7
facts 7.h2 head="$H2"
rollup 7 "$H1" "$GREEN"
rollup 7.h2a "$H2" "$(lane a COMPLETED '"SUCCESS"')"
rollup 7.h2ab "$H2" "$GREEN,$(lane c COMPLETED '"SUCCESS"')"
hook 7 1 'printf "8\n7 '"$H2"'\n" >"$L.new" && mv "$L.new" "$L"'
hook 7 3 'cp "$FAKE/facts.7.h2.json" "$FAKE/facts.7.json"; cp "$FAKE/rollup.7.h2a.json" "$FAKE/rollup.7.json"'
hook 7 5 'cp "$FAKE/rollup.7.h2ab.json" "$FAKE/rollup.7.json"'
call watch "${WARGS[@]}" --interval 10 --max 60
is "7: a listed head the PR has not reached yet is a push on its way, not a move" "$(lines "pr=7	head=$H2	outcome=waiting	ci=unpushed")" 1
is "7: ...and is not called moved" "$(lines 'outcome=moved')" 0
is "7: the new head is ready once" "$(lines "pr=7	head=$H2	outcome=ready")" 1
lacks "7: ...and not on a rollup that is green but lacks a lane of the full run" "$(cat "$S")" "green=7	head=$H2	lane=Tests / a
"
has "7: ...the green run on the new head replaces the kept one, with the lane it added" "$(cat "$S")" "green=7	head=$H2	lane=Tests / a	lane=Tests / b	lane=Tests / c"
is "7: every line: two first readings, the push, the green run, the stop" "$(printf '%s\n' "$OUT" | wc -l | tr -d ' ')" 5
call state --state "$S"
is "7: the state read down gives the head of the last full green run, for rebase --green" "$(printf '%s\n' "$OUT" | grep -c "^green=7	head=$H2")" 1

# A poll that cannot be read says nothing, waits longer each time, and gives up.
wfresh
printf '7\n' >"$L"
facts 7
rollup 7 "$H1" "$RUNNING"
touch "$FAKE/fail-rollup"
call watch "${WARGS[@]}"
is "7: five unreadable polls running stop the watch" "$OUT" "outcome=stopped	reason=unreadable	pending=	unread=7"
is "7: ...as a stop" "$RC" 3
is "7: ...the wait doubling between them" "$(sleeps)" "120 240 480 960 "
wfresh
printf '7\n' >"$L"
facts 7
rollup 7 "$H1" "$RUNNING"
rollup 7.4 "$H1" "$GREEN"
hook 7 2 'touch "$FAKE/fail-rollup"'
hook 7 4 'rm -f "$FAKE/fail-rollup"'
call watch "${WARGS[@]}"
is "7: an unreadable poll leaves the outcome standing and the watch running" "$(printf '%s\n' "$OUT" | tr '\n' '|')" "pr=7	head=$H1	outcome=waiting	ci=running|pr=7	head=$H1	outcome=ready	ci=green|outcome=stopped	reason=idle	pending=	unread=|"
is "7: ...backing off while it lasts" "$(sleeps)" "120 120 240 "
# The rate limit spent: wait for its reset, not for the next interval.
wfresh
printf '7\n' >"$L"
facts 7
rollup 7 "$H1" "$RUNNING"
rollup 7.3 "$H1" "$GREEN"
printf '{"resources":{"graphql":{"remaining":0,"reset":%s}}}\n' "$(($(date +%s) + 1000))" >"$FAKE/ratelimit.json"
hook 7 1 'touch "$FAKE/fail-rollup"'
hook 7 2 'rm -f "$FAKE/fail-rollup"'
call watch "${WARGS[@]}"
is "7: a rate-limit answer does not fail the watch" "$RC" 0
FIRST="$(head -n 1 "$FAKE/sleep.log")"
[ "$FIRST" -ge 1000 ] && [ "$FIRST" -le 1010 ]
ok "7: ...it sleeps until the limit resets (slept $FIRST)" $?
is "7: ...then polls at its interval again" "$(sed -n 2p "$FAKE/sleep.log")" 120
wfresh
printf '7\n' >"$L"
facts 7
rollup 7 "$H1" "$RUNNING"
printf '{"resources":{"graphql":{"remaining":0,"reset":%s}}}\n' "$(($(date +%s) + 1000))" >"$FAKE/ratelimit.json"
touch "$FAKE/fail-rollup"
call watch "${WARGS[@]}" --max 300
is "7: a reset beyond the bound does not carry the watch past it" "$(sleeps)" "300 "
has "7: ...it expires" "$OUT" "reason=expired"

# A commit's own lanes: the default branch's run on the final tip.
wfresh
printf 'commit %s\n' "$MC" >"$L"
crollup() { # <file suffix> <nodes>
	printf '{"data":{"repository":{"object":{"oid":"%s","statusCheckRollup":{"contexts":{"pageInfo":{"hasNextPage":false,"endCursor":""},"nodes":[%s]}}}}}}\n' "$MC" "$2" >"$FAKE/crollup$1.json"
}
crollup "" "$RUNNING"
crollup .3 "$GREEN"
call watch "${WARGS[@]}"
is "7: a commit is watched to the end of its run" "$(printf '%s\n' "$OUT" | tr '\n' '|')" "commit=$MC	outcome=waiting	ci=running|commit=$MC	outcome=green	ci=green|outcome=stopped	reason=idle	pending=	unread=|"
has "7: ...read by its id" "$(cat "$FAKE/gh.log")" "oid=$MC"
wfresh
printf 'commit %s\n' "$MC" >"$L"
crollup "" "$(lane a COMPLETED '"CANCELLED"'),$RUNNING"
call watch "${WARGS[@]}"
is "7: a commit with a lane that did not pass is red, and the watch has nothing left to wait for" "$(printf '%s\n' "$OUT" | tr '\n' '|')" "commit=$MC	outcome=red	ci=failing|outcome=stopped	reason=idle	pending=	unread=|"
wfresh
printf 'commit %s\n' "$MC" >"$L"
crollup "" ""
call watch "${WARGS[@]}" --max 240
is "7: a commit with no run yet is waiting, never green" "$(printf '%s\n' "$OUT" | sed -n 1p)" "commit=$MC	outcome=waiting	ci=none"

# Lines the watch cannot read, and a list that goes away.
wfresh
printf 'seven\n7 abc\n7\n7\ncommit abc\n' >"$L"
facts 7
rollup 7 "$H1" "$RUNNING"
call watch "${WARGS[@]}" --max 240
is "7: an entry it cannot read is said once, however many polls meet it" "$(lines 'entry=seven	outcome=bad-entry')" 1
is "7: ...a head that is no commit id" "$(lines 'entry=7 abc	outcome=bad-entry')" 1
is "7: ...a PR listed twice" "$(lines 'entry=7	outcome=bad-entry')" 1
is "7: ...a commit that is no commit id" "$(lines 'entry=commit abc	outcome=bad-entry')" 1
is "7: ...and the PR is polled once a poll all the same" "$(polls 7)" 3
wfresh
printf '7\n' >"$L"
facts 7
rollup 7 "$H1" "$RUNNING"
hook 7 2 'rm -f "$L"'
call watch "${WARGS[@]}"
is "7: a list that is gone stops the watch" "$(printf '%s\n' "$OUT" | tail -n 1)" "outcome=stopped	reason=no-list	pending=7	unread="
is "7: ...as a stop" "$RC" 3
rm -f "$L" "$S"
call watch "${WARGS[@]}"
is "7: a list that was never there is a failure" "$RC" 1
call watch --repo acme/widgets --state "$S"
is "7: watch needs a list" "$RC" 64
call watch --repo acme/widgets --list "$L"
is "7: ...and a state file" "$RC" 64
call watch "${WARGS[@]}" --interval soon
is "7: ...and an interval in seconds" "$RC" 64
call watch "${WARGS[@]}" --pr 7
is "7: ...and takes no PR of its own" "$RC" 64
PATH="$REALPATH"

# merge --state, note, and the state read down.
wfresh
facts 7
facts 7.merged state=MERGED merged="$MC"
touch "$FAKE/merge-lands"
call merge "${MARGS[@]}" --state "$S" --basis "clean rebase of a green run	nothing overlapping"
is "7: a merge with a state file still merges" "$(val outcome)" merged
is "7: ...and is written there with its head, merge commit and basis" "$(grep -c "^merged=7	head=$H1	merge-commit=$MC	at=20.*	basis=clean rebase of a green run nothing overlapping\$" "$S")" 1
wfresh
facts 7 threads=false
call merge "${MARGS[@]}" --state "$S" --basis "fresh run"
is "7: a merge that stopped writes no merge" "$(grep -c '^merged=' "$S")" 0
call merge "${MARGS[@]}" --state "$S"
is "7: a state file without a basis is a usage error" "$RC" 64
nomerge "7: ...before anything is merged"
call merge "${MARGS[@]}" --basis "fresh run"
is "7: and so is a basis without a state file" "$RC" 64
wfresh
facts 7
facts 7.merged state=MERGED merged="$MC"
touch "$FAKE/merge-lands"
call merge "${MARGS[@]}" --state "$WORKDIR/no-such-dir/state" --basis "fresh run"
is "7: a state file that cannot be written is found before the merge" "$RC" 1
nomerge "7: ...which is then not asked for"
wfresh
call note --state "$S" --pr 8 cancelled run 123 after the re-push
is "7: a note is recorded" "$(val outcome)" noted
has "7: ...against its PR" "$(cat "$S")" "note=8	at="
has "7: ...in the caller's words" "$(cat "$S")" "text=cancelled run 123 after the re-push"
call note --state "$S" "main's run covers the whole train"
has "7: a note about no PR is kept too" "$(cat "$S")" "note=-	at="
call note --state "$S"
is "7: a note with no words is a usage error" "$RC" 64
printf 'merged=7\thead=%s\tmerge-commit=%s\tat=2026-01-01T00:00:00Z\tbasis=fresh run\n' "$H1" "$MC" >>"$S"
call state --state "$S"
has "7: the state read down keeps every merge with its basis" "$OUT" "merged=7	head=$H1	merge-commit=$MC	at=2026-01-01T00:00:00Z	basis=fresh run"
is "7: ...and every note" "$(lines '^note=')" 2
call state --state "$WORKDIR/none"
is "7: a state file that is not there is a failure" "$RC" 1

if [ "$fails" -gt 0 ]; then
	printf 'merge-train helper test: %d/%d checks FAILED.\n' "$fails" "$checks" >&2
	exit 1
fi
printf 'merge-train helper test passed (%d checks).\n' "$checks"
