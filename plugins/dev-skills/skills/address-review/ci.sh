#!/usr/bin/env bash
# ci.sh — the CI lanes of a pull request's head, read the one way.
#
# Usage:
#   ci.sh lanes --repo <owner>/<repo> (--pr <N> | --commit <oid>)
#   ci.sh log   --url <details-url> [--lines <n>]
#   ci.sh rerun --url <details-url>
#
# `<owner>/<repo>` is the repository the PR is in, read from the PR's own URL;
# write it `<host>/<owner>/<repo>` where that is not github.com.
# `log` and `rerun` take a lane's details URL and read the host, the
# repository and the run out of it, never from the directory or gh's default.
#
# lanes  Reads the status rollup of the PR's head commit (or, with `--commit`,
#        of that commit: a default branch's own run has no PR) and prints
#        every lane instance that is not passing. A lane passes on SUCCESS, NEUTRAL or
#        SKIPPED and on nothing else; an instance still in progress is not a
#        failure.
#          outcome=failing | running | green | none
#          head=<oid>     the commit the rollup describes: a rollup for a head
#                         other than the one you reconciled against says
#                         nothing about this branch
#          lane=<identity> TAB <kind> TAB <verdict> TAB <details-url>
#                         one per failing instance. An identity printed more
#                         than once is ONE lane, failing while any instance is.
#          running=<identity>
#          passing=<identity>
#                         every lane that passes, so a lane recorded earlier
#                         can be told as green now from absent altogether
#        <identity> is `<workflow> / <job>` for a GitHub Actions check run,
#        `<app slug> / <check name>` for another app's check run (two apps
#        emitting one check name stay two lanes), and the context of a commit
#        status. <kind> is actions, external or status: only an `actions` lane
#        has a workflow run, so only it has logs and a re-run through gh.
# log    The log of the failed job the URL names, up to its last `##[error]`
#        line where it has one (what follows is the job's clean-up), tailed
#        to 200 lines unless `--lines` says otherwise, with terminal escape
#        sequences, the byte-order mark and carriage returns removed. A URL
#        naming only the run gets every failed job of its latest attempt, each
#        under a `==> <job name> (job <id>)` line.
#        It reads each job's own log, which exists once that job has finished,
#        whatever the rest of its run is doing. Stops with
#          outcome=not-finished   the job itself is still going (job= status=)
#          outcome=no-failed-job  the run holds no finished job that failed
#          outcome=no-logs        the URL names no workflow run
#        A gh failure is exit 1, never an empty tail that reads as evidence.
# rerun  Reads the run the URL names, then re-runs its failed jobs, once:
#          outcome=accepted | rejected
#          outcome=in-progress   the run has not completed, and GitHub re-runs
#                                nothing of a run until it has: nothing was
#                                asked, so ask again when it completes
#          outcome=superseded    the run's branch has moved past the run's
#                                commit (head= tip=): nothing was asked, since
#                                that commit's lanes no longer speak for the
#                                branch
#        each with run=<run-id> and repo=. Only `accepted` is a re-run under
#        way; after any other answer the lane is as red as it was.
#        Several failed jobs of one run share its id, so one request covers
#        them. Stops with `outcome=no-run` for a URL that names none. A run
#        whose branch is gone, or that names none, is not held to a tip.
#
# What GitHub does mid-run, as seen on 2026-11-27 with gh 2.105.0 on a run
# with one job failed and others still going:
#   - `gh run view --log-failed` and `--log`, by run or by `--job`, refuse:
#     "run <id> is still in progress; logs will be available when it is
#     complete". `repos/<owner>/<repo>/actions/jobs/<job>/logs` returned the
#     finished job's whole log, so `log` takes that route always.
#   - gh refuses to print an API answer holding escape sequences unless
#     `--allow-escape-sequences` is passed, a flag older gh does not know:
#     `log` passes it where `gh api --help` names it.
#   - The refusal of a mid-run re-run was not seen first hand: no run this
#     was allowed to re-run was in progress with a failed job. `rerun` does
#     not depend on how GitHub words it: it reads the run's status and asks
#     only of a completed run.
#
# Output: `key=value` lines on stdout, `outcome=` first (`log` prints the log
# and nothing else). Exit status: 0 done, 3 on a stop, 1 on a failure (network,
# gh), 64 on a usage error. Needs gh. Written for bash 3.2 and later.
set -u -o pipefail

TAB="$(printf '\t')"
case "$0" in
/*) SELF="$0" ;;
*) SELF="$PWD/$0" ;;
esac

say() { printf '%s\n' "$*"; }
note() { printf 'ci: %s\n' "$*" >&2; }
fail() {
	note "$*"
	exit 1
}
usage() {
	note "$*"
	sed -n '4,7p' "$SELF" | sed 's/^# \{0,1\}//' >&2
	exit 64
}
stop() { # <outcome> <explanation>
	say "outcome=$1"
	note "$2"
	exit 3
}

REPO="" PR="" COMMIT="" URL="" LINES=200

parse() {
	while [ $# -gt 0 ]; do
		[ $# -ge 2 ] || usage "$1 needs a value"
		case "$1" in
		--repo) REPO="$2" ;;
		--pr) PR="$2" ;;
		--commit) COMMIT="$2" ;;
		--url) URL="$2" ;;
		--lines) LINES="$2" ;;
		*) usage "unknown argument: $1" ;;
		esac
		shift 2
	done
}

# One page of the rollup as lines: a `pr` line (for a PR), a `head` line, a
# `page` line, then one line per context — TAB-separated: verdict class,
# identity, kind, verdict, url.
# shellcheck disable=SC2016 # the $names are GraphQL's and jq's
page() { # cursor (may be empty)
	local slug host subject contexts='statusCheckRollup{ contexts(first:100,after:$after){
          pageInfo{ hasNextPage endCursor }
          nodes{
            __typename
            ... on CheckRun { name status conclusion detailsUrl
              checkSuite{ app{ slug } workflowRun{ workflow{ name } } } }
            ... on StatusContext { context state targetUrl }
          }
        } }'
	# `--repo` may be `<host>/<owner>/<repo>`, as gh takes it.
	slug="$(printf '%s' "$REPO" | awk -F/ '{ print $(NF-1) "/" $NF }')"
	host="$(printf '%s' "$REPO" | awk -F/ 'NF > 2 { print $1 }')"
	set -- ${host:+--hostname} ${host:+"$host"} -f owner="${slug%%/*}" -f name="${slug##*/}" ${1:+-f} ${1:+after="$1"}
	if [ -n "$COMMIT" ]; then
		set -- "$@" -f oid="$COMMIT"
		subject='query($owner:String!,$name:String!,$oid:GitObjectID!,$after:String){
  repository(owner:$owner,name:$name){
    object(oid:$oid){ ... on Commit{ oid '"$contexts"' } }
  }
}'
	else
		set -- "$@" -F pr="$PR"
		subject='query($owner:String!,$name:String!,$pr:Int!,$after:String){
  repository(owner:$owner,name:$name){
    pullRequest(number:$pr){
      number
      commits(last:1){ nodes{ commit{ oid '"$contexts"' } } }
    }
  }
}'
	fi
	gh api graphql "$@" -f query="$subject" --jq '
  .data.repository as $r
  | ( if $r.pullRequest != null then $r.pullRequest.commits.nodes[0].commit else $r.object end ) as $c
  | ( if $r.pullRequest != null then "pr\t\($r.pullRequest.number)" else empty end ),
    "head\t\($c.oid // "")",
    "page\t\($c.statusCheckRollup.contexts.pageInfo.hasNextPage // false)\t\($c.statusCheckRollup.contexts.pageInfo.endCursor // "")",
    ( ($c.statusCheckRollup.contexts.nodes // [])[]
      | if .__typename == "CheckRun" then
          ( if .checkSuite.workflowRun != null
            then ["actions", "\(.checkSuite.workflowRun.workflow.name) / \(.name)"]
            else ["external", "\(.checkSuite.app.slug // "unknown-app") / \(.name)"] end ) as [$kind, $id]
          | ( if .status != "COMPLETED" then ["running", (.status // "")]
              elif (.conclusion == "SUCCESS" or .conclusion == "NEUTRAL" or .conclusion == "SKIPPED") then ["pass", .conclusion]
              else ["fail", (.conclusion // "NO_CONCLUSION")] end ) as [$class, $verdict]
          | [$class, $id, $kind, $verdict, (.detailsUrl // "")]
        elif .__typename == "StatusContext" then
          ( if .state == "SUCCESS" then "pass"
            elif (.state == "PENDING" or .state == "EXPECTED") then "running"
            else "fail" end ) as $class
          | [$class, .context, "status", (.state // ""), (.targetUrl // "")]
        else empty end
      | @tsv )'
}

cmd_lanes() {
	parse "$@"
	case "$REPO" in
	?*/?*) ;;
	*) usage "--repo <owner>/<repo> is required (the repository the PR is in)" ;;
	esac
	local what
	if [ -n "$COMMIT" ]; then
		[ -z "$PR" ] || usage "--pr and --commit are two different subjects: name one"
		case "$COMMIT" in
		*[!0-9a-f]*) usage "--commit takes a full commit id" ;;
		esac
		[ "${#COMMIT}" -ge 40 ] || usage "--commit takes a full commit id"
		what="commit $COMMIT"
	else
		case "$PR" in
		'' | *[!0-9]*) usage "--pr <N> or --commit <oid> is required" ;;
		esac
		what="PR #$PR"
	fi
	local cursor="" out head="" more seen=0 lanes="" running="" passing="" kind f1 f2 f3 f4 f5 guard=0
	while :; do
		out="$(page "$cursor")" || fail "could not read the status rollup of $what in $REPO (gh failed). Nothing here says the lanes are green."
		more=false
		while IFS="$TAB" read -r f1 f2 f3 f4 f5; do
			case "$f1" in
			pr) [ "$f2" = "$PR" ] || fail "the rollup answered for PR #$f2, not #$PR. Discard it and ask again." ;;
			head)
				# Every page re-reads the PR's live head: a push between two
				# pages would mix two commits' checks under one name.
				[ -z "$f2" ] || [ -z "$head" ] || [ "$head" = "$f2" ] || fail "the PR's head moved from $head to $f2 while its rollup was being read. Nothing here describes either commit; ask again."
				head="$f2"
				;;
			page)
				more="$f2"
				cursor="$f3"
				;;
			fail)
				seen=$((seen + 1))
				kind="$f3"
				lanes="$lanes
lane=$f2$TAB$kind$TAB$f4$TAB$f5"
				;;
			running)
				seen=$((seen + 1))
				running="$running
running=$f2"
				;;
			pass)
				seen=$((seen + 1))
				passing="$passing
passing=$f2"
				;;
			esac
		done <<EOF
$out
EOF
		[ "$more" = true ] || break
		[ -n "$cursor" ] || fail "the rollup promised another page and gave no cursor."
		guard=$((guard + 1))
		[ "$guard" -lt 50 ] || fail "the rollup did not end after 50 pages."
	done
	[ -n "$head" ] || fail "the rollup named no head commit for $what."
	[ -z "$COMMIT" ] || [ "$head" = "$COMMIT" ] || fail "the rollup answered for commit $head, not $COMMIT. Discard it and ask again."
	if [ -n "$lanes" ]; then
		say "outcome=failing"
	elif [ -n "$running" ]; then
		say "outcome=running"
	elif [ "$seen" -gt 0 ]; then
		say "outcome=green"
	else
		say "outcome=none"
	fi
	say "head=$head"
	printf '%s\n' "$lanes" | awk 'NF'
	printf '%s\n' "$running" | awk 'NF' | sort -u
	printf '%s\n' "$passing" | awk 'NF' | sort -u
}

R_REPO="" R_HOST="" R_SLUG="" R_RUN="" R_JOB=""
# The repository, run and job a GitHub Actions details URL names.
run_of() {
	local rest
	case "$URL" in
	*/actions/runs/*) ;;
	*) return 1 ;;
	esac
	rest="${URL#*://}"
	# Host-qualified, so gh addresses the run this URL names whatever its
	# default host is.
	R_REPO="${rest%%/actions/runs/*}"
	rest="${rest#*/actions/runs/}"
	R_RUN="${rest%%[!0-9]*}"
	R_JOB=""
	case "$rest" in
	*/job/*)
		rest="${rest#*/job/}"
		R_JOB="${rest%%[!0-9]*}"
		;;
	esac
	case "$R_REPO" in
	?*/?*/?*) ;;
	*) return 1 ;;
	esac
	R_HOST="${R_REPO%%/*}"
	R_SLUG="${R_REPO#*/}"
	[ -n "$R_RUN" ]
}
# gh api on the host the URL names.
api() { gh api --hostname "$R_HOST" "$@"; }

# One finished job's log, cleaned, cut after its last error line and tailed.
job_log() { # job id, file to use
	local last esc="" ESC BEL CR BOM
	ESC="$(printf '\033')" BEL="$(printf '\007')" CR="$(printf '\r')" BOM="$(printf '\357\273\277')"
	case "$(gh api --help 2>&1)" in
	*--allow-escape-sequences*) esc=--allow-escape-sequences ;;
	esac
	api $esc "repos/$R_SLUG/actions/jobs/$1/logs" >"$2.raw" || fail "could not read the log of job $1 in $R_REPO (gh failed). That is a failed gather, not an empty log."
	LC_ALL=C sed -e "1s/^$BOM//" -e "s/$ESC\\[[0-9;:?<=>]*[A-Za-z@~]//g" -e "s/$ESC][^$BEL]*$BEL//g" -e "s/$ESC//g" -e "s/$CR\$//" "$2.raw" >"$2" ||
		fail "could not clean the log of job $1."
	[ -s "$2" ] || fail "the log of job $1 in $R_REPO came back empty. That is a failed gather, not an empty log."
	last="$(awk 'index($0, "##[error]") { n = NR } END { print n + 0 }' "$2")"
	if [ "$last" -gt 0 ]; then head -n "$last" "$2"; else cat "$2"; fi | tail -n "$LINES"
}

cmd_log() {
	parse "$@"
	[ -n "$URL" ] || usage "--url <details-url> is required"
	case "$LINES" in
	'' | *[!0-9]*) usage "--lines takes a number" ;;
	esac
	run_of || stop no-logs "that URL names no workflow run, so gh can neither read its logs nor re-run it. Its details URL is the only mechanism: record that logs are unavailable through gh."
	local tmp status jobs id name
	tmp="$(mktemp -d "${TMPDIR:-/tmp}/ci.XXXXXX")" || fail "could not create a temporary directory."
	# shellcheck disable=SC2064 # expand now: the directory this run made
	trap "rm -rf '$tmp'" EXIT
	if [ -n "$R_JOB" ]; then
		status="$(api "repos/$R_SLUG/actions/jobs/$R_JOB" --jq .status)" || fail "could not read job $R_JOB in $R_REPO (gh failed). That is a failed gather, not an empty log."
		if [ "$status" != completed ]; then
			say "outcome=not-finished"
			say "job=$R_JOB"
			say "status=$status"
			note "job $R_JOB is $status, so it has no log to read yet. Ask again once that job has finished; the rest of its run need not have."
			exit 3
		fi
		job_log "$R_JOB" "$tmp/log"
		return 0
	fi
	jobs="$(api --paginate "repos/$R_SLUG/actions/runs/$R_RUN/jobs?filter=latest&per_page=100" --jq '
		.jobs[] | select(.status == "completed" and .conclusion != "success" and .conclusion != "skipped" and .conclusion != "neutral")
		| "\(.id)\t\(.name)"')" || fail "could not list the jobs of run $R_RUN in $R_REPO (gh failed). That is a failed gather, not an empty log."
	[ -n "$jobs" ] || stop no-failed-job "run $R_RUN in $R_REPO holds no finished job that failed, so there is no failing log to read yet."
	while IFS="$TAB" read -r id name; do
		say "==> $name (job $id)"
		job_log "$id" "$tmp/log"
	done <<EOF
$jobs
EOF
}

cmd_rerun() {
	parse "$@"
	[ -n "$URL" ] || usage "--url <details-url> is required"
	run_of || stop no-run "that URL names no workflow run, so there is nothing gh can re-run. Leave the lane for the maintainer."
	local run status sha branch home tip=""
	run="$(api "repos/$R_SLUG/actions/runs/$R_RUN" --jq '[.status, .head_sha, (.head_branch // "-"), (.head_repository.full_name // "-")] | map(if . == "" then "-" else . end) | @tsv')" ||
		fail "could not read run $R_RUN in $R_REPO (gh failed). Nothing was re-run."
	IFS="$TAB" read -r status sha branch home <<EOF
$run
EOF
	[ -n "$status" ] && [ -n "$sha" ] || fail "run $R_RUN in $R_REPO answered without a status or a commit. Nothing was re-run."
	if [ "$status" != completed ]; then
		say "outcome=in-progress"
		say "run=$R_RUN"
		say "repo=$R_REPO"
		say "status=$status"
		note "run $R_RUN in $R_REPO is $status, and GitHub re-runs nothing of a run until it has completed. Nothing was asked: ask again when it completes. The lane is still owed on that run."
		exit 3
	fi
	if [ "${branch:--}" != - ]; then
		[ "${home:--}" != - ] || home="$R_SLUG"
		tip="$(api "repos/$home/git/matching-refs/heads/$branch" --jq '.[] | "\(.ref)\t\(.object.sha)"')" ||
			fail "could not read the tip of '$branch' in $home (gh failed). Nothing was re-run."
		tip="$(printf '%s\n' "$tip" | awk -F "$TAB" -v r="refs/heads/$branch" '$1 == r { print $2; exit }')"
	fi
	if [ -n "$tip" ] && [ "$tip" != "$sha" ]; then
		say "outcome=superseded"
		say "run=$R_RUN"
		say "repo=$R_REPO"
		say "head=$sha"
		say "tip=$tip"
		note "run $R_RUN ran on $sha, and '$branch' is now at $tip. Nothing was asked: that commit's lanes no longer speak for the branch. Read the lanes of the new tip."
		exit 3
	fi
	if gh run rerun "$R_RUN" --repo "$R_REPO" --failed >&2; then
		say "outcome=accepted"
	else
		say "outcome=rejected"
		say "run=$R_RUN"
		say "repo=$R_REPO"
		note "gh did not accept the re-run of run $R_RUN in $R_REPO. The lane is still owed on that run."
		exit 3
	fi
	say "run=$R_RUN"
	say "repo=$R_REPO"
}

[ $# -ge 1 ] || usage "a command is required"
command="$1"
shift
case "$command" in
lanes) cmd_lanes "$@" ;;
log) cmd_log "$@" ;;
rerun) cmd_rerun "$@" ;;
-h | --help | help)
	awk 'NR > 1 && !/^#/ { exit } NR > 1 { sub(/^# ?/, ""); print }' "$SELF"
	;;
*) usage "unknown command: $command" ;;
esac
