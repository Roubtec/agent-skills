#!/usr/bin/env bash
# Hermetic test for the address-review ping helper
# (plugins/dev-skills/skills/address-review/ping.sh).
#
# Nothing here reaches the network: `gh` is a fake that logs every call,
# answers the timeline from canned JSON run through the real `jq` with the
# helper's own `--jq` program, and can be told to refuse a comment or a
# request. Needs Bash, jq and coreutils.
# shellcheck disable=SC2319 # `ok <label> $?` after a `[ … ]` test is the point
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SHIPPED="$SCRIPT_DIR/../plugins/dev-skills/skills/address-review/ping.sh"
HELPER="${PING_HELPER:-$SHIPPED}"
MIRROR="$SCRIPT_DIR/../codex/dev-skills/skills/address-review/ping.sh"
SHIM="$SCRIPT_DIR/../plugins/dev-skills/bin/address-review-ping"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
export PING_POLL_SECONDS=0 PING_CONFIRM_TRIES=3

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
# Files under $FAKE steer it:
#   version            what `gh --version` reports (2.105.0 without it)
#   timeline.json      the timeline before the request
#   timeline.<n>.json  the timeline on the n-th read, where that file exists
#   fail-comment, fail-request, fail-timeline, fail-timeline-once
printf '%s\n' "$*" >>"$FAKE/gh.log"
case "$1 ${2:-}" in
"--version ")
	printf 'gh version %s (2026-01-01)\nhttps://example.invalid\n' "$(cat "$FAKE/version" 2>/dev/null || echo 2.105.0)"
	;;
"pr comment")
	if [ -f "$FAKE/fail-comment" ]; then
		echo "GraphQL: comment refused" >&2
		exit 1
	fi
	printf 'https://github.com/acme/widgets/pull/7#issuecomment-%s\n' "$(grep -c '^pr comment' "$FAKE/gh.log")"
	;;
"pr edit")
	[ ! -f "$FAKE/fail-request" ] || exit 1
	echo "https://github.com/acme/widgets/pull/7"
	;;
"api "*)
	[ ! -f "$FAKE/fail-timeline" ] || exit 1
	if [ -f "$FAKE/fail-timeline-once" ]; then
		rm "$FAKE/fail-timeline-once"
		exit 1
	fi
	n=$(($(cat "$FAKE/reads" 2>/dev/null || echo 0) + 1))
	echo "$n" >"$FAKE/reads"
	file="$FAKE/timeline.json"
	[ ! -f "$FAKE/timeline.$n.json" ] || file="$FAKE/timeline.$n.json"
	expr=.
	while [ $# -gt 0 ]; do
		[ "$1" != --jq ] || expr="$2"
		shift
	done
	jq -r "$expr" "$file"
	;;
*) exit 1 ;;
esac
FAKEGH
chmod +x "$FAKE/gh"
export PATH="$FAKE:$PATH"

# event <id> <event> <reviewer login>
event() { printf '{"id":%s,"event":"%s","requested_reviewer":{"login":"%s","type":"Bot"}}' "$1" "$2" "$3"; }
OLD="$(event 11 review_requested Copilot),$(event 12 review_requested alice),{\"id\":13,\"event\":\"commented\"}"
fresh() {
	rm -f "$FAKE"/*.json "$FAKE"/fail-* "$FAKE/version" "$FAKE/reads" "$FAKE/gh.log"
	printf '[%s]\n' "$OLD" >"$FAKE/timeline.json"
}
call() { # [args...] → OUT (stdout), ERR (stderr), RC
	OUT="$(bash "$HELPER" "$@" 2>"$WORKDIR/err")"
	RC=$?
	ERR="$(cat "$WORKDIR/err")"
}
val() { printf '%s\n' "$OUT" | sed -n "s/^$1=//p" | head -n 1; }
log() { cat "$FAKE/gh.log" 2>/dev/null; }
ARGS=(--repo acme/widgets --pr 7)

# --- 1. comment pings ---------------------------------------------------------
fresh
call "${ARGS[@]}" codex claude
is "1: both comment pings posted is done" "$(val outcome)" "done"
is "1: ...with exit 0" "$RC" 0
grep -Fqx "pr comment 7 --repo acme/widgets --body @codex review" "$FAKE/gh.log"
ok "1: codex gets a dedicated comment holding only its ping" $?
grep -Fqx "pr comment 7 --repo acme/widgets --body @claude review" "$FAKE/gh.log"
ok "1: claude gets its own" $?
is "1: one comment per reviewer, never one naming several" "$(grep -c '^pr comment' "$FAKE/gh.log")" 2
has "1: each answers with its comment's URL" "$OUT" "pinged=codex	https://github.com/acme/widgets/pull/7#issuecomment-1"
has "1: ...in the order given" "$OUT" "pinged=claude	https://github.com/acme/widgets/pull/7#issuecomment-2"
lacks "1: no Copilot request is made unasked" "$(log)" "add-reviewer"
fresh
call "${ARGS[@]}" codex codex
is "1: a reviewer named twice is pinged once" "$(grep -c '^pr comment' "$FAKE/gh.log")" 1
fresh
touch "$FAKE/fail-comment"
call "${ARGS[@]}" codex
is "1: a refused comment is partial" "$(val outcome)" partial
is "1: ...with exit 3" "$RC" 3
has "1: ...naming the reviewer" "$OUT" "failed=codex"
has "1: ...and relaying what gh said" "$ERR" "comment refused"

# --- 2. the Copilot request ---------------------------------------------------
fresh
printf '[%s,%s]\n' "$OLD" "$(event 21 review_requested Copilot)" >"$FAKE/timeline.2.json"
call "${ARGS[@]}" copilot
is "2: a request with a new timeline event is done" "$(val outcome)" "done"
has "2: ...confirmed by that event's id" "$OUT" "pinged=copilot	21"
has "2: the request is the reviewer request, in the PR's repository" "$(log)" "pr edit 7 --repo acme/widgets --add-reviewer @copilot"
lacks "2: ...and never an @copilot comment" "$(log)" "pr comment"
has "2: the timeline is read in full, by repository and PR" "$(log)" "api --paginate repos/acme/widgets/issues/7/timeline"
[ "$(awk '/timeline/ { print NR; exit }' "$FAKE/gh.log")" -lt "$(awk '/^pr edit/ { print NR; exit }' "$FAKE/gh.log")" ]
ok "2: the snapshot is taken before the request" $?

fresh
call "${ARGS[@]}" copilot
is "2: an older request for Copilot does not confirm this one" "$(val outcome)" partial
has "2: ...which is reported unconfirmed" "$OUT" "unconfirmed=copilot"
is "2: ...after the bounded re-reads" "$(grep -c timeline "$FAKE/gh.log")" 4
is "2: ...having asked exactly once" "$(grep -c '^pr edit' "$FAKE/gh.log")" 1
has "2: ...with the do-not-reissue rule on stderr" "$ERR" "do not issue an unconfirmed request again"
fresh
printf '[%s,%s]\n' "$OLD" "$(event 22 review_requested bob)" >"$FAKE/timeline.2.json"
call "${ARGS[@]}" copilot
has "2: a new request for someone else does not confirm it either" "$OUT" "unconfirmed=copilot"
fresh
printf '[%s,%s]\n' "$OLD" "$(event 23 review_request_removed Copilot)" >"$FAKE/timeline.2.json"
call "${ARGS[@]}" copilot
has "2: nor does another kind of event naming Copilot" "$OUT" "unconfirmed=copilot"
fresh
printf '[%s,%s]\n' "$OLD" "$(event 24 review_requested Copilot)" >"$FAKE/timeline.3.json"
call "${ARGS[@]}" copilot
has "2: an event that shows on a later read confirms it" "$OUT" "pinged=copilot	24"
fresh
printf '[]\n' >"$FAKE/timeline.json"
printf '[%s]\n' "$(event 25 review_requested 'copilot-pull-request-reviewer[bot]')" >"$FAKE/timeline.2.json"
call "${ARGS[@]}" copilot
has "2: a first request on a PR is confirmed, whatever case the login takes" "$OUT" "pinged=copilot	25"
fresh
printf '[]\n' >"$FAKE/timeline.json"
call "${ARGS[@]}" copilot
has "2: an empty timeline before and after is unconfirmed" "$OUT" "unconfirmed=copilot"

fresh
touch "$FAKE/fail-request"
call "${ARGS[@]}" copilot codex
has "2: a refused request is reported" "$OUT" "failed=copilot"
has "2: ...and does not stop the reviewer after it" "$OUT" "pinged=codex"
is "2: ...leaving the run partial" "$(val outcome)" partial
fresh
touch "$FAKE/fail-timeline"
call "${ARGS[@]}" copilot
has "2: a timeline that cannot be read leaves the request unconfirmed" "$OUT" "unconfirmed=copilot"
is "2: ...though it was still made" "$(grep -c '^pr edit' "$FAKE/gh.log")" 1
fresh
touch "$FAKE/fail-timeline-once"
call "${ARGS[@]}" copilot
has "2: with the snapshot unread, an older event read afterwards confirms nothing" "$OUT" "unconfirmed=copilot"
fresh
echo 2.87.3 >"$FAKE/version"
call "${ARGS[@]}" copilot claude
has "2: a gh too old to make the request skips it" "$OUT" "skipped=copilot	gh 2.87.3 is older than 2.88.0"
lacks "2: ...without asking" "$(log)" "pr edit"
has "2: ...and still pings the rest" "$OUT" "pinged=claude"
is "2: ...as a partial run, exit 3" "$RC" 3
fresh
echo 2.88.0 >"$FAKE/version"
printf '[%s,%s]\n' "$OLD" "$(event 26 review_requested Copilot)" >"$FAKE/timeline.2.json"
call "${ARGS[@]}" copilot
has "2: the floor itself is new enough" "$OUT" "pinged=copilot	26"
fresh
echo 3.0.0 >"$FAKE/version"
printf '[%s,%s]\n' "$OLD" "$(event 27 review_requested Copilot)" >"$FAKE/timeline.2.json"
call "${ARGS[@]}" copilot
has "2: so is a later major version with a low minor" "$OUT" "pinged=copilot	27"

fresh
printf '[%s,%s]\n' "$OLD" "$(event 28 review_requested Copilot)" >"$FAKE/timeline.2.json"
call --repo ghe.example.com/acme/widgets --pr 7 copilot codex
has "2: on another host the timeline is read there" "$(log)" "api --hostname ghe.example.com --paginate repos/acme/widgets/issues/7/timeline"
has "2: ...and gh's own commands take the host-qualified repository" "$(log)" "pr edit 7 --repo ghe.example.com/acme/widgets --add-reviewer @copilot"

# --- 3. usage -----------------------------------------------------------------
fresh
call "${ARGS[@]}"
is "3: no reviewer is a usage error" "$RC" 64
call "${ARGS[@]}" gemini
is "3: an unknown reviewer is a usage error" "$RC" 64
call --repo acme/widgets codex
is "3: no PR is a usage error" "$RC" 64
call --pr 7 codex
is "3: no repository is a usage error" "$RC" 64
is "3: a usage error pings nobody" "$(log)" ""

# --- 4. the shipped files -----------------------------------------------------
cmp -s "$SHIPPED" "$MIRROR"
ok "4: the Codex mirror ships the same helper, byte for byte" $?
for f in plugins/dev-skills/skills/address-review/ping.sh codex/dev-skills/skills/address-review/ping.sh plugins/dev-skills/bin/address-review-ping; do
	mode="$(git -c safe.directory='*' -C "$SCRIPT_DIR/.." ls-files -s -- "$f" | cut -d' ' -f1)"
	is "4: $f is committed executable" "$mode" 100755
done
OUT="$(bash "$SHIPPED" --help 2>&1)"
has "4: the helper prints its contract" "$OUT" "ping.sh --repo"
lacks "4: ...and none of its code" "$OUT" "set -u"
fresh
OUT="$(bash "$SHIM" "${ARGS[@]}" codex 2>&1)"
has "4: the bin/ shim runs the same helper" "$OUT" "pinged=codex"
ln -s "$SHIM" "$WORKDIR/linked"
OUT="$(bash "$WORKDIR/linked" "${ARGS[@]}" claude 2>&1)"
has "4: ...through a symlink too" "$OUT" "pinged=claude"

if [ "$fails" -gt 0 ]; then
	printf 'address-review ping helper test: %d/%d checks FAILED.\n' "$fails" "$checks" >&2
	exit 1
fi
printf 'address-review ping helper test passed (%d checks).\n' "$checks"
