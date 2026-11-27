#!/usr/bin/env bash
# Hermetic test for the address-review CI helper
# (plugins/dev-skills/skills/address-review/ci.sh).
#
# Nothing here reaches the network: `gh` is a fake that answers the rollup
# query from canned GraphQL responses, run through the real `jq` with the
# helper's own `--jq` program, and logs every `gh run` call it is given.
# Needs Bash, jq and coreutils.
# shellcheck disable=SC2319 # `ok <label> $?` after a `[ … ]` test is the point
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SHIPPED="$SCRIPT_DIR/../plugins/dev-skills/skills/address-review/ci.sh"
HELPER="${CI_HELPER:-$SHIPPED}"
MIRROR="$SCRIPT_DIR/../codex/dev-skills/skills/address-review/ci.sh"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

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
# The rollup comes from $FAKE/page1.json (and page2.json once a cursor is
# passed). A run is $FAKE/run.json, its jobs jobs.json, a job job.<id>.json
# and its log log.<id>, a branch's refs refs.json. Every call is logged.
printf '%s\n' "$*" >>"$FAKE/gh.log"
expr=. path="" flags=""
case "$1 $2" in
"api --help")
	[ -f "$FAKE/old-gh" ] || echo "      --allow-escape-sequences   Allow printing terminal escape sequences"
	exit 0
	;;
"api graphql")
	[ ! -f "$FAKE/fail-api" ] || exit 1
	page=page1.json
	shift 2
	while [ $# -gt 0 ]; do
		case "$1" in
		--jq)
			expr="$2"
			shift
			;;
		-f | -F)
			case "$2" in after=*) page=page2.json ;; esac
			shift
			;;
		esac
		shift
	done
	jq -r "$expr" "$FAKE/$page"
	;;
"api "*)
	shift
	while [ $# -gt 0 ]; do
		case "$1" in
		--jq)
			expr="$2"
			shift
			;;
		--hostname) shift ;;
		--*) flags="$flags $1" ;;
		*) path="$1" ;;
		esac
		shift
	done
	[ ! -f "$FAKE/fail-run" ] || exit 1
	case "$path" in
	*/jobs/*/logs)
		id="${path%/logs}"
		# As gh does: an answer holding escape sequences is refused unless
		# the caller allowed them.
		if [ ! -f "$FAKE/old-gh" ] && grep -q "$(printf '\033')" "$FAKE/log.${id##*/}"; then
			case "$flags" in *--allow-escape-sequences*) ;; *) exit 1 ;; esac
		fi
		cat "$FAKE/log.${id##*/}"
		;;
	*/actions/jobs/*) jq -r "$expr" "$FAKE/job.${path##*/}.json" ;;
	*/actions/runs/*/jobs*) jq -r "$expr" "$FAKE/jobs.json" ;;
	*/actions/runs/*) jq -r "$expr" "$FAKE/run.json" ;;
	*/git/matching-refs/heads/*) jq -r "$expr" "$FAKE/refs.json" ;;
	*) exit 1 ;;
	esac
	;;
"run rerun") [ ! -f "$FAKE/fail-rerun" ] ;;
*) exit 1 ;;
esac
FAKEGH
chmod +x "$FAKE/gh"
export PATH="$FAKE:$PATH"

# rollup <file> <pr> <hasNextPage> <endCursor> <context nodes, comma-separated JSON>
rollup() {
	printf '{"data":{"repository":{"pullRequest":{"number":%s,"commits":{"nodes":[{"commit":{"oid":"abc123","statusCheckRollup":{"contexts":{"pageInfo":{"hasNextPage":%s,"endCursor":"%s"},"nodes":[%s]}}}}]}}}}}\n' \
		"$2" "$3" "$4" "$5" >"$FAKE/$1"
}
# run <workflow> <job> <status> <conclusion> <url>
run_node() {
	printf '{"__typename":"CheckRun","name":"%s","status":"%s","conclusion":%s,"detailsUrl":"%s","checkSuite":{"app":{"slug":"github-actions"},"workflowRun":{"workflow":{"name":"%s"}}}}' \
		"$2" "$3" "$4" "$5" "$1"
}
# app <slug> <check> <status> <conclusion> <url>
app_node() {
	printf '{"__typename":"CheckRun","name":"%s","status":"%s","conclusion":%s,"detailsUrl":"%s","checkSuite":{"app":{"slug":"%s"},"workflowRun":null}}' \
		"$2" "$3" "$4" "$5" "$1"
}
# status <context> <state> <url>
status_node() { printf '{"__typename":"StatusContext","context":"%s","state":"%s","targetUrl":"%s"}' "$1" "$2" "$3"; }

call() { # <command> [args...] → OUT (stdout), ERR (stderr), RC
	OUT="$(bash "$HELPER" "$@" 2>"$WORKDIR/err")"
	RC=$?
	ERR="$(cat "$WORKDIR/err")"
}
val() { printf '%s\n' "$OUT" | sed -n "s/^$1=//p" | head -n 1; }
vals() { printf '%s\n' "$OUT" | sed -n "s/^$1=//p"; }
fresh() {
	rm -f "$FAKE"/fail-* "$FAKE"/*.json "$FAKE"/log.* "$FAKE/old-gh"
	: >"$FAKE/gh.log"
}
# Whether gh was asked to re-run anything.
asked() { grep -c '^run rerun' "$FAKE/gh.log"; }
ARGS=(--repo acme/widgets --pr 7)
RUN=https://github.com/acme/widgets/actions/runs/111/job/222
RUN2=https://github.com/acme/widgets/actions/runs/333/job/444

# --- 1. lanes ------------------------------------------------------------------
fresh
rollup page1.json 7 false "" "$(run_node tests scripts COMPLETED '"SUCCESS"' "$RUN"),$(run_node tests markdown COMPLETED '"SKIPPED"' "$RUN"),$(app_node codecov patch COMPLETED '"NEUTRAL"' https://codecov.example/x),$(status_node ci/legacy SUCCESS https://legacy.example/1)"
call lanes "${ARGS[@]}"
is "1: every lane passing is green" "$(val outcome)" green
is "1: the head the rollup describes is given" "$(val head)" abc123
is "1: ...and no lane is listed" "$(vals lane)" ""
is "1: every passing lane is named, once, so a recorded lane can be told green from gone" "$(vals passing | tr '\n' '|')" "ci/legacy|codecov / patch|tests / markdown|tests / scripts|"
has "1: the query names the repository and the PR" "$(cat "$FAKE/gh.log")" "owner=acme -f name=widgets -F pr=7"

fresh
rollup page1.json 7 false "" "$(run_node tests scripts COMPLETED '"FAILURE"' "$RUN"),$(run_node tests scripts COMPLETED '"SUCCESS"' "$RUN2"),$(run_node tests markdown COMPLETED '"CANCELLED"' "$RUN2"),$(app_node codecov patch COMPLETED '"FAILURE"' https://codecov.example/x),$(app_node other-app patch COMPLETED '"TIMED_OUT"' https://other.example/y),$(status_node ci/legacy FAILURE https://legacy.example/1),$(status_node ci/slow PENDING https://legacy.example/2),$(run_node tests deploy IN_PROGRESS null "$RUN"),$(run_node tests lint COMPLETED '"ACTION_REQUIRED"' "$RUN")"
call lanes "${ARGS[@]}"
is "1: a failing lane makes the rollup failing" "$(val outcome)" failing
is "1: every instance that is not passing is a lane line" "$(vals lane | wc -l | tr -d ' ')" 6
has "1: an Actions lane is its workflow and job, with its verdict and URL" "$OUT" "lane=tests / scripts	actions	FAILURE	$RUN"
lacks "1: the passing instance of that lane is not listed" "$OUT" "$RUN2	"
has "1: a cancelled job is not a pass" "$OUT" "lane=tests / markdown	actions	CANCELLED	$RUN2"
has "1: nor is one awaiting action" "$OUT" "lane=tests / lint	actions	ACTION_REQUIRED"
has "1: another app's check is its slug and name, with no workflow run" "$OUT" "lane=codecov / patch	external	FAILURE	https://codecov.example/x"
has "1: two apps emitting one check name stay two lanes" "$OUT" "lane=other-app / patch	external	TIMED_OUT"
has "1: a commit status is its context" "$OUT" "lane=ci/legacy	status	FAILURE	https://legacy.example/1"
is "1: what is still in progress is named as running, not as failing" "$(vals running | tr '\n' '|')" "ci/slow|tests / deploy|"
is "1: a lane with one instance passing and one failing is listed under both" "$(vals passing | tr '\n' '|')" "tests / scripts|"

fresh
rollup page1.json 7 false "" "$(run_node tests scripts COMPLETED '"SUCCESS"' "$RUN"),$(run_node tests deploy QUEUED null "$RUN"),$(status_node ci/slow EXPECTED https://legacy.example/2)"
call lanes "${ARGS[@]}"
is "1: nothing failing and something in progress is 'running'" "$(val outcome)" running

fresh
rollup page1.json 7 false "" "$(run_node tests scripts COMPLETED '"SUCCESS"' "$RUN")"
call lanes --repo ghe.example.test/acme/widgets --pr 7
is "1: a host-qualified repository is read by its owner and name" "$(val outcome)" green
has "1: ...on its own host" "$(cat "$FAKE/gh.log")" "api graphql --hostname ghe.example.test -f owner=acme -f name=widgets"
fresh
rollup page1.json 7 false "" ""
call lanes "${ARGS[@]}"
is "1: a head with no checks at all is 'none', not green" "$(val outcome)" none

fresh
printf '{"data":{"repository":{"pullRequest":{"number":7,"commits":{"nodes":[{"commit":{"oid":"abc123","statusCheckRollup":null}}]}}}}}\n' >"$FAKE/page1.json"
call lanes "${ARGS[@]}"
is "1: so is one with no rollup" "$(val outcome)" none

# Two pages: the failure is on the second.
fresh
rollup page1.json 7 true CURSOR1 "$(run_node tests scripts COMPLETED '"SUCCESS"' "$RUN")"
rollup page2.json 7 false "" "$(run_node tests markdown COMPLETED '"FAILURE"' "$RUN2")"
call lanes "${ARGS[@]}"
is "1: a rollup of several pages is read to its end" "$(val outcome)" failing
has "1: ...by the cursor the first page gave" "$(cat "$FAKE/gh.log")" "after=CURSOR1"
fresh
rollup page1.json 7 true CURSOR1 "$(run_node tests scripts COMPLETED '"FAILURE"' "$RUN")"
rollup page2.json 7 false "" "$(run_node tests markdown COMPLETED '"SUCCESS"' "$RUN2")"
sed 's/abc123/def456/' "$FAKE/page2.json" >"$FAKE/page2.json.new" && mv "$FAKE/page2.json.new" "$FAKE/page2.json"
call lanes "${ARGS[@]}"
is "1: a head that moved between two pages is a failure, not a rollup of two commits" "$RC" 1
is "1: ...with no outcome and no lane" "$OUT" ""
has "1: ...naming both heads" "$ERR" "moved from abc123 to def456"
fresh
rollup page1.json 7 true "" "$(run_node tests scripts COMPLETED '"SUCCESS"' "$RUN")"
call lanes "${ARGS[@]}"
is "1: a promised page with no cursor is a failure, not a green rollup" "$RC" 1
is "1: ...with no outcome" "$(val outcome)" ""

fresh
rollup page1.json 8 false "" "$(run_node tests scripts COMPLETED '"SUCCESS"' "$RUN")"
call lanes "${ARGS[@]}"
is "1: a response for another PR is refused" "$RC" 1
has "1: ...saying which it answered for" "$ERR" "answered for PR #8"
fresh
touch "$FAKE/fail-api"
call lanes "${ARGS[@]}"
is "1: a gh failure is a failure, never 'green'" "$RC" 1
is "1: ...with no outcome" "$(val outcome)" ""
# A commit's own rollup: a default branch's run has no PR.
OID=abc1230000000000000000000000000000000000
commit_rollup() { # <oid in the answer> <nodes>
	printf '{"data":{"repository":{"object":{"oid":"%s","statusCheckRollup":{"contexts":{"pageInfo":{"hasNextPage":false,"endCursor":""},"nodes":[%s]}}}}}}\n' "$1" "$2" >"$FAKE/page1.json"
}
fresh
commit_rollup "$OID" "$(run_node tests scripts COMPLETED '"SUCCESS"' "$RUN"),$(run_node tests markdown COMPLETED '"FAILURE"' "$RUN2")"
call lanes --repo acme/widgets --commit "$OID"
is "1: a commit's rollup is read like a PR head's" "$(val outcome)" failing
is "1: ...naming that commit" "$(val head)" "$OID"
has "1: ...its failing lane" "$OUT" "lane=tests / markdown	actions	FAILURE	$RUN2"
has "1: ...and its passing one" "$OUT" "passing=tests / scripts"
has "1: ...asked for by its id, not by a PR" "$(cat "$FAKE/gh.log")" "-f oid=$OID"
lacks "1: ...no PR number in the question" "$(cat "$FAKE/gh.log")" "pr="
fresh
commit_rollup def4560000000000000000000000000000000000 ""
call lanes --repo acme/widgets --commit "$OID"
is "1: an answer for another commit is a failure" "$RC" 1
fresh
printf '{"data":{"repository":{"object":null}}}\n' >"$FAKE/page1.json"
call lanes --repo acme/widgets --commit "$OID"
is "1: a commit the repository does not hold is a failure, not 'none'" "$RC" 1
is "1: ...with no outcome" "$(val outcome)" ""
call lanes --repo acme/widgets --commit abc123
is "1: a short commit id is a usage error" "$RC" 64
call lanes --repo acme/widgets --pr 7 --commit "$OID"
is "1: a PR and a commit together are a usage error" "$RC" 64
call lanes --repo widgets --pr 7
is "1: the repository has to be owner/repo" "$RC" 64
call lanes --repo acme/widgets
is "1: and the PR a number" "$RC" 64

# --- 2. log --------------------------------------------------------------------
ESC="$(printf '\033')"
job() { printf '{"id":%s,"status":"%s"}\n' "$1" "$2" >"$FAKE/job.$1.json"; }
# A job's log as GitHub serves it: a byte-order mark, CRLF line ends, colour
# codes, the failing step, then the job's clean-up.
joblog() { # <job id> <lines before the error>
	{
		printf '\357\273\277'
		seq 1 "$2" | sed "s/^/log line /"
		printf '%s[31mFAILED%s[0m tests/a.spec %s]0;title\007end\r\n' "$ESC" "$ESC" "$ESC"
		printf '##[error]Process completed with exit code 1.\r\n'
		printf 'Post job cleanup.\nCleaning up orphan processes\n'
	} >"$FAKE/log.$1"
}
fresh
job 222 completed
joblog 222 300
call log --url "$RUN"
is "2: a job's failing log is tailed to 200 lines" "$(printf '%s\n' "$OUT" | wc -l | tr -d ' ')" 200
is "2: ...ending on its last error line, not on the job's clean-up" "$(printf '%s\n' "$OUT" | tail -n 1)" "##[error]Process completed with exit code 1."
is "2: ...with colour codes, a title sequence and the carriage return gone from the line above it" "$(printf '%s\n' "$OUT" | tail -n 2 | head -n 1)" "FAILED tests/a.spec end"
lacks "2: ...and no escape byte anywhere" "$OUT" "$ESC"
has "2: ...read as that job's own log, in the repository and on the host the URL names" "$(cat "$FAKE/gh.log")" "api --hostname github.com --allow-escape-sequences repos/acme/widgets/actions/jobs/222/logs"
lacks "2: ...never by the route that waits for the whole run" "$(cat "$FAKE/gh.log")" "run view"
fresh
job 222 completed
joblog 222 3
call log --url "$RUN"
is "2: a log shorter than the tail starts at its first line, the byte-order mark gone" "$(printf '%s\n' "$OUT" | head -n 1)" "log line 1"
fresh
job 222 completed
seq 1 10 | sed 's/^/plain line /' >"$FAKE/log.222"
call log --url "$RUN" --lines 4
is "2: a log with no error line is tailed whole, to the length asked" "$(printf '%s\n' "$OUT" | tr '\n' '|')" "plain line 7|plain line 8|plain line 9|plain line 10|"
fresh
job 222 completed
joblog 222 3
touch "$FAKE/old-gh"
call log --url "$RUN"
is "2: a gh that does not know the escape flag is not passed it" "$RC" 0
lacks "2: ...at all" "$(cat "$FAKE/gh.log")" "--allow-escape-sequences"
lacks "2: ...and its log is cleaned the same" "$OUT" "$ESC"
fresh
job 222 in_progress
call log --url "$RUN"
is "2: a job still going has no log yet, which is its own outcome" "$(val outcome)" not-finished
is "2: ...a stop, not a failure" "$RC" 3
is "2: ...naming the job" "$(val job)" 222
is "2: ...and where it stands" "$(val status)" in_progress
lacks "2: ...with no log asked for" "$(cat "$FAKE/gh.log")" "/logs"
fresh
job 222 completed
joblog 222 3
call log --url "https://github.com/acme/widgets/actions/runs/111/job/222?pr=7#step:4:1"
has "2: a query string or fragment on the URL is not part of the job id" "$(cat "$FAKE/gh.log")" "actions/jobs/222/logs"
call log --url https://ghe.example.test/acme/widgets/actions/runs/111/job/222
has "2: an Enterprise run is read on the host its URL names" "$(cat "$FAKE/gh.log")" "api --hostname ghe.example.test --allow-escape-sequences repos/acme/widgets/actions/jobs/222/logs"

# A URL naming only the run: every finished job that failed, a sibling still running.
fresh
printf '{"jobs":[{"id":222,"name":"scripts","status":"completed","conclusion":"failure"},{"id":223,"name":"lint","status":"completed","conclusion":"success"},{"id":224,"name":"slow","status":"in_progress","conclusion":null},{"id":225,"name":"e2e","status":"completed","conclusion":"timed_out"},{"id":226,"name":"docs","status":"completed","conclusion":"skipped"}]}\n' >"$FAKE/jobs.json"
joblog 222 300
joblog 225 2
call log --url https://github.com/acme/widgets/actions/runs/111 --lines 5
is "2: a URL naming only the run reads each failed job of it, to the length asked, under its name" "$(printf '%s\n' "$OUT" | grep -c '^==> ')" 2
has "2: ...the failed one" "$OUT" "==> scripts (job 222)"
has "2: ...and the timed-out one" "$OUT" "==> e2e (job 225)"
is "2: ...five lines each beside the two headings" "$(printf '%s\n' "$OUT" | wc -l | tr -d ' ')" 11
lacks "2: ...and neither the passing, the skipped nor the running job's" "$(cat "$FAKE/gh.log")" "jobs/223/"
lacks "2: ...the running one least of all" "$(cat "$FAKE/gh.log")" "jobs/224"
has "2: ...of the run's latest attempt" "$(cat "$FAKE/gh.log")" "repos/acme/widgets/actions/runs/111/jobs?filter=latest"
fresh
printf '{"jobs":[{"id":224,"name":"slow","status":"in_progress","conclusion":null},{"id":223,"name":"lint","status":"completed","conclusion":"success"}]}\n' >"$FAKE/jobs.json"
call log --url https://github.com/acme/widgets/actions/runs/111
is "2: a run with no finished failed job says so" "$(val outcome)" no-failed-job
is "2: ...as a stop" "$RC" 3
call log --url https://codecov.example/x
is "2: a URL with no workflow run has no logs through gh" "$(val outcome)" no-logs
is "2: ...which is a stop" "$RC" 3
fresh
touch "$FAKE/fail-run"
call log --url "$RUN"
is "2: a gh that failed is a failed gather, not an empty tail" "$RC" 1
has "2: ...and says so" "$ERR" "not an empty log"
fresh
job 222 completed
: >"$FAKE/log.222"
call log --url "$RUN"
is "2: a log that came back empty is a failed gather too" "$RC" 1
call log
is "2: log needs the URL" "$RC" 64

# --- 3. rerun ------------------------------------------------------------------
SHA=abc1230000000000000000000000000000000000
NEWER=def4560000000000000000000000000000000000
# run <status> [<head branch> [<head repository>]]
run() {
	local branch="${2-feature}" home="${3-acme/widgets}"
	[ "$branch" = null ] || branch="\"$branch\""
	[ "$home" = null ] || home="{\"full_name\":\"$home\"}"
	printf '{"status":"%s","head_sha":"%s","head_branch":%s,"head_repository":%s}\n' "$1" "$SHA" "$branch" "$home" >"$FAKE/run.json"
}
# refs <branch>=<oid>...
refs() {
	local kv sep=""
	{
		printf '['
		for kv in "$@"; do
			printf '%s{"ref":"refs/heads/%s","object":{"sha":"%s"}}' "$sep" "${kv%%=*}" "${kv#*=}"
			sep=,
		done
		printf ']\n'
	} >"$FAKE/refs.json"
}
fresh
run completed
refs feature="$SHA"
call rerun --url "$RUN"
is "3: an accepted re-run says so" "$(val outcome)" accepted
is "3: ...by run id" "$(val run)" 111
has "3: ...having asked for the failed jobs of that run, in its repository" "$(cat "$FAKE/gh.log")" "run rerun 111 --repo github.com/acme/widgets --failed"
has "3: ...after reading the run on the host its URL names" "$(cat "$FAKE/gh.log")" "api --hostname github.com repos/acme/widgets/actions/runs/111 "
fresh
run completed
refs feature="$SHA"
touch "$FAKE/fail-rerun"
call rerun --url "$RUN"
is "3: a rejected re-run is a stop" "$(val outcome)" rejected
is "3: ...still naming the run it is owed on" "$(val run)" 111
is "3: ...with exit 3" "$RC" 3
for status in in_progress queued waiting; do
	fresh
	run "$status"
	refs feature="$SHA"
	call rerun --url "$RUN"
	is "3: a run that is $status is not a refusal: it is in-progress" "$(val outcome)" in-progress
	is "3: ...a stop ($status)" "$RC" 3
	is "3: ...naming the run to ask again of ($status)" "$(val run)" 111
	is "3: ...and nothing was asked of GitHub ($status)" "$(asked)" 0
done
has "3: ...which the explanation says" "$ERR" "ask again when it completes"
fresh
run completed
refs feature="$NEWER"
call rerun --url "$RUN"
is "3: a run whose branch has moved past its commit is superseded" "$(val outcome)" superseded
is "3: ...a stop" "$RC" 3
is "3: ...naming the commit it ran on" "$(val head)" "$SHA"
is "3: ...and the tip that replaced it" "$(val tip)" "$NEWER"
is "3: ...and nothing was re-run" "$(asked)" 0
fresh
run completed feature fork/widgets
refs feature="$NEWER"
call rerun --url "$RUN"
has "3: a fork's branch is read in the fork" "$(cat "$FAKE/gh.log")" "repos/fork/widgets/git/matching-refs/heads/feature"
is "3: ...and supersedes the same" "$(val outcome)" superseded
fresh
run completed feature
refs feature-2="$NEWER" feature="$SHA"
call rerun --url "$RUN"
is "3: a branch whose name only starts the same is not the run's branch" "$(val outcome)" accepted
fresh
run completed feature
refs
call rerun --url "$RUN"
is "3: a run whose branch is gone is not held to a tip" "$(val outcome)" accepted
fresh
run completed null null
call rerun --url "$RUN"
is "3: nor is one that names no branch" "$(val outcome)" accepted
lacks "3: ...for which no ref is read" "$(cat "$FAKE/gh.log")" "matching-refs"
fresh
touch "$FAKE/fail-run"
call rerun --url "$RUN"
is "3: a run that could not be read is a failure" "$RC" 1
is "3: ...with no outcome" "$(val outcome)" ""
is "3: ...and nothing re-run" "$(asked)" 0
call rerun --url https://legacy.example/1
is "3: a lane with no workflow run cannot be re-run here" "$(val outcome)" no-run

# --- 4. the shipped files ------------------------------------------------------
cmp -s "$SHIPPED" "$MIRROR"
ok "4: the Codex mirror ships the same helper, byte for byte" $?
for f in plugins/dev-skills/skills/address-review/ci.sh codex/dev-skills/skills/address-review/ci.sh; do
	mode="$(git -c safe.directory='*' -C "$SCRIPT_DIR/.." ls-files -s -- "$f" | cut -d' ' -f1)"
	is "4: $f is committed executable" "$mode" 100755
done
OUT="$(bash "$SHIPPED" --help 2>&1)"
has "4: the helper prints its contract" "$OUT" "ci.sh rerun"
lacks "4: ...and none of its code" "$OUT" "set -u"

if [ "$fails" -gt 0 ]; then
	printf 'address-review ci helper test: %d/%d checks FAILED.\n' "$fails" "$checks" >&2
	exit 1
fi
printf 'address-review ci helper test passed (%d checks).\n' "$checks"
