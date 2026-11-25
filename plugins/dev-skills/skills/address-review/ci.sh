#!/usr/bin/env bash
# ci.sh — the CI lanes of a pull request's head, read the one way.
#
# Usage:
#   ci.sh lanes --repo <owner>/<repo> --pr <N>
#   ci.sh log   --url <details-url> [--lines <n>]
#   ci.sh rerun --url <details-url>
#
# `<owner>/<repo>` is the repository the PR is in, read from the PR's own URL;
# write it `<host>/<owner>/<repo>` where that is not github.com.
# `log` and `rerun` take a lane's details URL and read the host, the
# repository and the run out of it, never from the directory or gh's default.
#
# lanes  Reads the status rollup of the PR's head commit and prints every lane
#        instance that is not passing. A lane passes on SUCCESS, NEUTRAL or
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
# log    The failing job's log tail (200 lines unless `--lines` says
#        otherwise): of the job the URL names, else of the run as a whole.
#        Stops with `outcome=no-logs` for a URL that names no workflow run.
#        A gh failure is exit 1, never an empty tail that reads as evidence.
# rerun  Re-runs the failed jobs of the run the URL names, once:
#          outcome=accepted | rejected     with run=<run-id>
#        Several failed jobs of one run share its id, so one request covers
#        them. Stops with `outcome=no-run` for a URL that names none.
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

REPO="" PR="" URL="" LINES=200

parse() {
	while [ $# -gt 0 ]; do
		[ $# -ge 2 ] || usage "$1 needs a value"
		case "$1" in
		--repo) REPO="$2" ;;
		--pr) PR="$2" ;;
		--url) URL="$2" ;;
		--lines) LINES="$2" ;;
		*) usage "unknown argument: $1" ;;
		esac
		shift 2
	done
}

# One page of the rollup as lines: a `head` line, a `page` line, then one line
# per context — TAB-separated: verdict class, identity, kind, verdict, url.
# shellcheck disable=SC2016 # the $names are GraphQL's and jq's
page() { # cursor (may be empty)
	local slug host
	# `--repo` may be `<host>/<owner>/<repo>`, as gh takes it.
	slug="$(printf '%s' "$REPO" | awk -F/ '{ print $(NF-1) "/" $NF }')"
	host="$(printf '%s' "$REPO" | awk -F/ 'NF > 2 { print $1 }')"
	set -- ${host:+--hostname} ${host:+"$host"} -f owner="${slug%%/*}" -f name="${slug##*/}" -F pr="$PR" ${1:+-f} ${1:+after="$1"}
	gh api graphql "$@" -f query='
query($owner:String!,$name:String!,$pr:Int!,$after:String){
  repository(owner:$owner,name:$name){
    pullRequest(number:$pr){
      number
      commits(last:1){ nodes{ commit{
        oid
        statusCheckRollup{ contexts(first:100,after:$after){
          pageInfo{ hasNextPage endCursor }
          nodes{
            __typename
            ... on CheckRun { name status conclusion detailsUrl
              checkSuite{ app{ slug } workflowRun{ workflow{ name } } } }
            ... on StatusContext { context state targetUrl }
          }
        } }
      } } }
    }
  }
}' --jq '
  .data.repository.pullRequest as $p
  | ($p.commits.nodes[0].commit) as $c
  | "pr\t\($p.number)",
    "head\t\($c.oid)",
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
	case "$PR" in
	'' | *[!0-9]*) usage "--pr <N> is required" ;;
	esac
	local cursor="" out head="" more seen=0 lanes="" running="" passing="" kind f1 f2 f3 f4 f5 guard=0
	while :; do
		out="$(page "$cursor")" || fail "could not read the status rollup of PR #$PR in $REPO (gh failed). Nothing here says the lanes are green."
		more=false
		while IFS="$TAB" read -r f1 f2 f3 f4 f5; do
			case "$f1" in
			pr) [ "$f2" = "$PR" ] || fail "the rollup answered for PR #$f2, not #$PR. Discard it and ask again." ;;
			head)
				# Every page re-reads the PR's live head: a push between two
				# pages would mix two commits' checks under one name.
				[ -z "$head" ] || [ "$head" = "$f2" ] || fail "the PR's head moved from $head to $f2 while its rollup was being read. Nothing here describes either commit; ask again."
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
	[ -n "$head" ] || fail "the rollup named no head commit for PR #$PR."
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

R_REPO="" R_RUN="" R_JOB=""
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
	[ -n "$R_RUN" ]
}

cmd_log() {
	parse "$@"
	[ -n "$URL" ] || usage "--url <details-url> is required"
	case "$LINES" in
	'' | *[!0-9]*) usage "--lines takes a number" ;;
	esac
	run_of || stop no-logs "that URL names no workflow run, so gh can neither read its logs nor re-run it. Its details URL is the only mechanism: record that logs are unavailable through gh."
	if [ -n "$R_JOB" ]; then
		gh run view --repo "$R_REPO" --job "$R_JOB" --log-failed | tail -n "$LINES"
	else
		gh run view "$R_RUN" --repo "$R_REPO" --log-failed | tail -n "$LINES"
	fi || fail "could not read the failing log of run $R_RUN in $R_REPO (gh failed). That is a failed gather, not an empty log."
}

cmd_rerun() {
	parse "$@"
	[ -n "$URL" ] || usage "--url <details-url> is required"
	run_of || stop no-run "that URL names no workflow run, so there is nothing gh can re-run. Leave the lane for the maintainer."
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
