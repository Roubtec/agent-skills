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
# passed); `gh run` calls are logged and answered from $FAKE/run.*.
printf '%s\n' "$*" >>"$FAKE/gh.log"
case "$1 $2" in
"api graphql")
	[ ! -f "$FAKE/fail-api" ] || exit 1
	page=page1.json expr=.
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
"run view")
	[ ! -f "$FAKE/fail-run" ] || exit 1
	seq 1 300 | sed 's/^/log line /'
	;;
"run rerun") [ ! -f "$FAKE/fail-run" ] ;;
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
	rm -f "$FAKE"/fail-* "$FAKE"/page*.json
	: >"$FAKE/gh.log"
}
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

fresh
rollup page1.json 7 false "" "$(run_node tests scripts COMPLETED '"SUCCESS"' "$RUN"),$(run_node tests deploy QUEUED null "$RUN"),$(status_node ci/slow EXPECTED https://legacy.example/2)"
call lanes "${ARGS[@]}"
is "1: nothing failing and something in progress is 'running'" "$(val outcome)" running

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
call lanes --repo widgets --pr 7
is "1: the repository has to be owner/repo" "$RC" 64
call lanes --repo acme/widgets
is "1: and the PR a number" "$RC" 64

# --- 2. log --------------------------------------------------------------------
fresh
call log --url "$RUN"
is "2: a job's failing log is tailed to 200 lines" "$(printf '%s\n' "$OUT" | wc -l | tr -d ' ')" 200
is "2: ...the last ones" "$(printf '%s\n' "$OUT" | tail -n 1)" "log line 300"
has "2: ...read by the job the URL names, in the repository it names" "$(cat "$FAKE/gh.log")" "run view --repo acme/widgets --job 222 --log-failed"
fresh
call log --url https://github.com/acme/widgets/actions/runs/111 --lines 5
is "2: a URL naming only the run reads the run, to the length asked" "$(printf '%s\n' "$OUT" | wc -l | tr -d ' ')" 5
has "2: ...as a whole" "$(cat "$FAKE/gh.log")" "run view 111 --repo acme/widgets --log-failed"
fresh
call log --url "https://github.com/acme/widgets/actions/runs/111/job/222?pr=7#step:4:1"
has "2: a query string or fragment on the URL is not part of the job id" "$(cat "$FAKE/gh.log")" "--job 222 --log-failed"
call log --url https://codecov.example/x
is "2: a URL with no workflow run has no logs through gh" "$(val outcome)" no-logs
is "2: ...which is a stop" "$RC" 3
fresh
touch "$FAKE/fail-run"
call log --url "$RUN"
is "2: a gh that failed is a failed gather, not an empty tail" "$RC" 1
has "2: ...and says so" "$ERR" "not an empty log"
call log
is "2: log needs the URL" "$RC" 64

# --- 3. rerun ------------------------------------------------------------------
fresh
call rerun --url "$RUN"
is "3: an accepted re-run says so" "$(val outcome)" accepted
is "3: ...by run id" "$(val run)" 111
has "3: ...having asked for the failed jobs of that run, in its repository" "$(cat "$FAKE/gh.log")" "run rerun 111 --repo acme/widgets --failed"
fresh
touch "$FAKE/fail-run"
call rerun --url "$RUN"
is "3: a rejected re-run is a stop" "$(val outcome)" rejected
is "3: ...still naming the run it is owed on" "$(val run)" 111
is "3: ...with exit 3" "$RC" 3
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
