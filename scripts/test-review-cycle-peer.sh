#!/usr/bin/env bash
# Hermetic test for the review-cycle peer helper
# (plugins/dev-skills/skills/review-cycle/peer.sh).
#
# No provider is contacted: `peer-review-run`, `codex`, `claude` and `muse` are
# stubs on a private PATH that log how they were called and answer as files
# under $STEER tell them to. The direct launch runs those stubs as real
# detached processes, so the identity handoff, the deadline and the teardown
# are exercised for real; the one thing a real process cannot do — survive
# KILL — is driven by sourcing the helper beside a fake `kill` and a fake
# /proc. Needs Bash, git, jq, coreutils and Linux /proc.
# shellcheck disable=SC2319 # `ok <label> $?` after a `[ … ]` test is the point
# shellcheck disable=SC2016 # single-quoted text is literal prompt bytes, or a program for another shell
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SHIPPED="$SCRIPT_DIR/../plugins/dev-skills/skills/review-cycle/peer.sh"
HELPER="${REVIEW_CYCLE_PEER_HELPER:-$SHIPPED}"
MIRROR="$SCRIPT_DIR/../codex/dev-skills/skills/review-cycle/peer.sh"
BRIEF="$SCRIPT_DIR/../plugins/dev-skills/skills/review-cycle/peer-brief.md"
SHIM="$SCRIPT_DIR/../plugins/dev-skills/bin/review-cycle-peer"
WORKDIR="$(cd -P "$(mktemp -d)" && pwd)"
cleanup() {
	local f pid
	for f in "$WORKDIR"/art/*/manual-attempt-*/peer-review.pid "$WORKDIR"/art/*/peer-run.*/manual-attempt-*/peer-review.pid; do
		[ -f "$f" ] || continue
		read -r pid _ <"$f" || continue
		case "$pid" in '' | *[!0-9]*) continue ;; esac
		[ "$(cat "/proc/$pid/comm" 2>/dev/null)" != sleep ] || kill -KILL "$pid" 2>/dev/null
	done
	rm -rf "$WORKDIR"
}
trap cleanup EXIT
export REVIEW_CYCLE_PEER_POLL_SECONDS=0.1

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
val() { printf '%s\n' "$OUT" | sed -n "s/^$1=//p" | head -n 1; }
first() { printf '%s\n' "$OUT" | head -n 1; }

for tool in peer-review-run codex claude muse; do
	if PATH=/usr/bin:/bin command -v "$tool" >/dev/null 2>&1; then
		printf 'review-cycle peer helper test: a real %s sits in /usr/bin or /bin, so the private PATH cannot hide it.\n' "$tool" >&2
		exit 1
	fi
done

# --- stubs ---------------------------------------------------------------
ALL="$WORKDIR/bin-all"         # every provider and the helper
NOHELPER="$WORKDIR/bin-direct" # the providers, no peer-review-run
BARE="$WORKDIR/bin-bare"       # nothing
STEER="$WORKDIR/steer"
mkdir -p "$ALL" "$NOHELPER" "$BARE" "$STEER" "$WORKDIR/art"
export STEER

cat >"$ALL/peer-review-run" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$STEER/helper.calls"
root="" prompt=""
while [ $# -gt 0 ]; do
	case "$1" in
	--artifact-root) root="$2" ;;
	--prompt-file) prompt="$2" ;;
	esac
	shift
done
cp "$prompt" "$STEER/helper.prompt"
mode="$(cat "$STEER/helper.mode" 2>/dev/null || echo passed)"
echo '{"event":"progress","line":"working"}' >&2
case "$mode" in
usage-provider | usage-attempts | usage-other)
	if [ "$mode" = usage-provider ]; then
		echo "peer-review-run: unsupported --provider 'muse' (claude|codex)" >&2
	elif [ "$mode" = usage-attempts ]; then
		echo "peer-review-run: unknown flag '--attempts'" >&2
	else
		echo "peer-review-run: --timeout must be a positive number of seconds (got '0')" >&2
	fi
	echo "Try: peer-review-run --provider <claude|codex|muse> --worktree <dir> --prompt-file <file> --artifact-root <dir>" >&2
	exit 64
	;;
crash)
	echo "peer-review-run: cannot create the review file" >&2
	exit 70
	;;
crash-provider)
	echo "peer-review-run: the --provider launch could not be prepared" >&2
	exit 70
	;;
cutoff)
	kill -KILL "$PPID"
	exit 0
	;;
raw)
	cat "$STEER/helper.raw"
	exit 0
	;;
esac
review=null
case "$mode" in
passed | issues)
	mkdir -p "$root/session/attempt-1"
	cat "$STEER/helper.review" >"$root/session/attempt-1/review.txt"
	review="\"$root/session/attempt-1/review.txt\""
	;;
passed-nofile) mode=passed ;;
issues-ghost)
	mode=issues
	review="\"$root/session/attempt-1/review.txt\""
	;;
issues-dir)
	mode=issues
	mkdir -p "$root/session/attempt-1/review.txt"
	review="\"$root/session/attempt-1/review.txt\""
	;;
passed-unreadable)
	mode=passed
	mkdir -p "$root/session/attempt-1"
	cat "$STEER/helper.review" >"$root/session/attempt-1/review.txt"
	chmod 000 "$root/session/attempt-1/review.txt"
	review="\"$root/session/attempt-1/review.txt\""
	;;
esac
echo "a line of provider noise before the result"
jq -cn --arg outcome "$mode" --arg reason "$(cat "$STEER/helper.reason" 2>/dev/null)" \
	--argjson model "$(cat "$STEER/helper.model" 2>/dev/null || echo null)" \
	--argjson effort "$(cat "$STEER/helper.effort" 2>/dev/null || echo '"medium"')" \
	--argjson review "$review" \
	'{schema: "powbox.peer-review-run/v1", outcome: $outcome, reason: $reason, model: $model, effort: $effort, artifactDir: "/nowhere", reviewFile: $review}'
STUB

cat >"$NOHELPER/codex" <<'STUB'
#!/usr/bin/env bash
if [ "$1 ${2:-}" = "login status" ]; then
	state="$(cat "$STEER/codex.login" 2>/dev/null || echo ok)"
	[ "$state" = ok ] && { echo "Logged in using ChatGPT"; exit 0; }
	echo "$state" >&2
	exit 1
fi
n=$(($(cat "$STEER/codex.count" 2>/dev/null || echo 0) + 1))
echo "$n" >"$STEER/codex.count"
for a in "$@"; do printf '%s\n--ARG--\n' "$a"; done >"$STEER/codex.args.$n"
{ pwd; readlink /proc/$$/fd/0; } >"$STEER/codex.env.$n"
out=""
while [ $# -gt 0 ]; do
	[ "$1" != -o ] || out="$2"
	shift
done
mode="$(cat "$STEER/codex.mode.$n" 2>/dev/null || cat "$STEER/codex.mode" 2>/dev/null || echo pass)"
echo "codex stub progress on stderr" >&2
case "$mode" in
pass) cat "$STEER/codex.review" >"$out" ;;
empty) : ;;
blank) printf '\n  \n' >"$out" ;;
garbled) echo "It looks broadly fine to me." >"$out" ;;
auth)
	echo "ERROR: You are not logged in. Run codex login." >&2
	exit 1
	;;
crash)
	echo "error: stream disconnected before completion" >&2
	exit 1
	;;
crash-then-noise)
	printf '%s\n' "ERROR: stream error" "error: giving up" "tokens used" "1,234" >&2
	exit 1
	;;
transcript)
	printf '%s\n' "+  return 401 if unauthorized" "+  // rate limit the caller" >&2
	exit 0
	;;
old-error)
	echo "error: a hiccup the provider recovered from" >&2
	for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do echo "progress $i" >&2; done
	exit 0
	;;
not-found)
	echo "peer-launch: 12: codex-core: not found" >&2
	exit 127
	;;
too-long)
	echo "peer-launch: 12: codex: Argument list too long" >&2
	exit 126
	;;
die) exit 3 ;;
hang) exec sleep 300 ;;
late)
	cat "$STEER/codex.review" >"$out"
	exec sleep 300
	;;
esac
STUB

cat >"$NOHELPER/claude" <<'STUB'
#!/usr/bin/env bash
if [ "$1 ${2:-}" = "auth status" ]; then
	state="$(cat "$STEER/claude.auth" 2>/dev/null || echo ok)"
	[ "$state" = ok ] && { echo '{"loggedIn": true}'; exit 0; }
	echo "$state" >&2
	exit 1
fi
n=$(($(cat "$STEER/claude.count" 2>/dev/null || echo 0) + 1))
echo "$n" >"$STEER/claude.count"
for a in "$@"; do printf '%s\n--ARG--\n' "$a"; done >"$STEER/claude.args.$n"
pwd >"$STEER/claude.env.$n"
cat >"$STEER/claude.stdin.$n"
mode="$(cat "$STEER/claude.mode" 2>/dev/null || echo pass)"
case "$mode" in
pass) jq -n --arg r "$(cat "$STEER/claude.review")" '{type: "result", is_error: false, result: $r}' ;;
error) jq -n --arg r "$(cat "$STEER/claude.review")" '{type: "result", is_error: true, result: $r}' ;;
notresult) jq -n --arg r "$(cat "$STEER/claude.review")" '{type: "assistant", is_error: false, result: $r}' ;;
notjson) echo "Segmentation fault (core dumped)" ;;
esac
STUB

cat >"$NOHELPER/muse" <<'STUB'
#!/usr/bin/env bash
if [ "$1" = usage ]; then
	state="$(cat "$STEER/muse.usage" 2>/dev/null || echo ok)"
	[ "$state" = ok ] && { echo "plan: wonder"; exit 0; }
	echo "$state" >&2
	exit 1
fi
echo "the muse stub is only ever asked for usage" >&2
exit 99
STUB
chmod +x "$ALL/peer-review-run" "$NOHELPER/codex" "$NOHELPER/claude" "$NOHELPER/muse"
for tool in codex claude muse; do ln -s "$NOHELPER/$tool" "$ALL/$tool"; done

BIN="$ALL"
peer() { PATH="$BIN:/usr/bin:/bin" bash "$HELPER" "$@"; }
fresh() { # a clean steering directory and a new artifact directory in $A
	rm -rf "$STEER"
	mkdir -p "$STEER"
	N=$((${N:-0} + 1))
	A="$WORKDIR/art/$N"
	printf 'VERDICT: PASS\nVERIFICATION: STATIC (executed no tests)\n' >"$STEER/helper.review"
	cp "$STEER/helper.review" "$STEER/codex.review"
}
args_of() { # <stub> <call number>: the logged arguments, one per line, the prompt replaced
	awk -v RS='\n--ARG--\n' '{ if ($0 ~ /\n/) print "<PROMPT>"; else print }' "$STEER/$1.args.$2" | tr '\n' ' '
}

# --- a small committed diff to review --------------------------------------
REPO="$WORKDIR/repo"
git init -q "$REPO"
git -C "$REPO" config user.email t@example.invalid
git -C "$REPO" config user.name T
printf 'contextword stays\nold line\nlast\n' >"$REPO/a.txt"
git -C "$REPO" add a.txt
git -C "$REPO" commit -q -m base
BASE_OID="$(git -C "$REPO" rev-parse HEAD)"
printf 'contextword stays\nnew zebracrossing line\ntwice_token\ntwice_token again\nlast\n' >"$REPO/a.txt"
git -C "$REPO" commit -q -am change
TIP_OID="$(git -C "$REPO" rev-parse HEAD)"
FACTS="$WORKDIR/facts.txt"
printf 'Work item: tidy a.txt.\nBranch: main. Base: %s.\n$(echo not expanded) `nor this`\n' "$BASE_OID" >"$FACTS"
proof() { # <token>
	printf 'VERDICT: PASS\nVERIFICATION: STATIC (executed no tests)\nEVIDENCE_BASE_OID: %s\nEVIDENCE_TIP_OID: %s\nEVIDENCE_TOKEN: %s\n' "$BASE_OID" "$TIP_OID" "$1"
}

# --- 1: what ships -----------------------------------------------------------
cmp -s "$SHIPPED" "$MIRROR"
ok "1: the Codex mirror ships the same helper, byte for byte" $?
for f in plugins/dev-skills/skills/review-cycle/peer.sh codex/dev-skills/skills/review-cycle/peer.sh plugins/dev-skills/bin/review-cycle-peer; do
	mode="$(git -c safe.directory='*' -C "$SCRIPT_DIR/.." ls-files -s -- "$f" | cut -d' ' -f1)"
	is "1: $f is committed executable" "$mode" 100755
done
OUT="$(bash "$SHIPPED" --help 2>&1)"
has "1: the helper prints its contract" "$OUT" "peer.sh preflight --provider"
has "1: ...which names the one stop" "$OUT" "Exit status: 0 for every outcome above; 3 when a provider this script"
has "1: ...says a failed handoff started no provider" "$OUT" "fails its identity handoff started no provider"
has "1: ...and gives collect a default wait that fits the caller's tool wait" "$OUT" "wait up to --wait seconds (default 520)"
lacks "1: ...and none of its code" "$OUT" "set -u"
is "1: the bin/ shim runs the same helper" "$(bash "$SHIM" --help 2>&1)" "$OUT"
ln -s "$SHIM" "$WORKDIR/linked"
is "1: ...through a symlink too" "$(bash "$WORKDIR/linked" run --help 2>&1)" "$OUT"

# --- 2: usage errors launch nothing ------------------------------------------
fresh
usage_case() { # <label> <args...>
	local label="$1"
	shift
	OUT="$(peer "$@" 2>&1)"
	is "2: $label is a usage error" "$?" 64
	lacks "2: ...with no outcome line" "$OUT" "outcome="
}
usage_case "no command"
usage_case "an unknown command" review
usage_case "an unknown provider" run --provider gemini --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS"
usage_case "a missing provider" preflight
usage_case "a relative worktree" run --provider codex --worktree repo --artifact-dir "$A" --facts "$FACTS"
usage_case "a relative artifact directory" run --provider codex --worktree "$REPO" --artifact-dir art --facts "$FACTS"
usage_case "an artifact directory inside the worktree" run --provider codex --worktree "$REPO" --artifact-dir "$REPO/.peer" --facts "$FACTS"
[ ! -e "$REPO/.peer" ]
ok "2: ...and is not created there first" $?
usage_case "a new nested artifact directory inside the worktree" run --provider codex --worktree "$REPO" --artifact-dir "$REPO/new/deeper" --facts "$FACTS"
[ ! -e "$REPO/new" ]
ok "2: ...nor is any of its parents" $?
ln -s "$REPO" "$WORKDIR/repo-link"
usage_case "an artifact directory reaching the worktree through a symlink" run --provider codex --worktree "$REPO" --artifact-dir "$WORKDIR/repo-link/.peer" --facts "$FACTS"
[ ! -e "$REPO/.peer" ]
ok "2: ...which is not created either" $?
usage_case "an artifact directory that climbs back into the worktree past a directory not yet there" run --provider codex --worktree "$REPO" --artifact-dir "$WORKDIR/art/nope/../../repo/.peer" --facts "$FACTS"
[ ! -e "$REPO/.peer" ] && [ ! -e "$WORKDIR/art/nope" ]
ok "2: ...and nothing on that path is created" $?
usage_case "the worktree itself as artifact directory" run --provider codex --worktree "$REPO" --artifact-dir "$REPO" --facts "$FACTS"
usage_case "neither an artifact root nor an artifact directory" run --provider codex --worktree "$REPO" --facts "$FACTS"
has "2: ...told of both flags" "$OUT" "give --artifact-root <abs dir> or --artifact-dir <abs dir>"
usage_case "an artifact root beside an artifact directory" run --provider codex --worktree "$REPO" --artifact-root "$WORKDIR/art/both-root" --artifact-dir "$A" --facts "$FACTS"
has "2: ...named as the choice it is" "$OUT" "give --artifact-root or --artifact-dir, not both"
[ ! -e "$WORKDIR/art/both-root" ] && [ ! -e "$A" ]
ok "2: ...and neither is created" $?
usage_case "a relative artifact root" run --provider codex --worktree "$REPO" --artifact-root art --facts "$FACTS"
has "2: ...named by its own flag" "$OUT" "--artifact-root must be an absolute path"
usage_case "an artifact root inside the worktree" run --provider codex --worktree "$REPO" --artifact-root "$REPO/.peer/deeper" --facts "$FACTS"
usage_case "the worktree itself as artifact root" run --provider codex --worktree "$REPO" --artifact-root "$REPO" --facts "$FACTS"
usage_case "an artifact root reaching the worktree through a symlink" run --provider codex --worktree "$REPO" --artifact-root "$WORKDIR/repo-link" --facts "$FACTS"
usage_case "an artifact root that climbs back into the worktree past a directory not yet there" run --provider codex --worktree "$REPO" --artifact-root "$WORKDIR/art/nope/../../repo" --facts "$FACTS"
[ ! -e "$REPO/.peer" ] && [ ! -e "$WORKDIR/art/nope" ] && [ -z "$(git -C "$REPO" status --porcelain --ignored)" ]
ok "2: ...and no root left anything in the worktree" $?
usage_case "neither facts nor prompt" run --provider codex --worktree "$REPO" --artifact-dir "$A"
usage_case "both facts and prompt" run --provider codex --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS" --prompt-file "$FACTS"
has "2: ...named as the choice it is" "$OUT" "give --facts or --prompt-file, not both"
usage_case "an empty facts file" run --provider codex --worktree "$REPO" --artifact-dir "$A" --facts /dev/null
usage_case "claude without an evidence base" run --provider claude --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS"
usage_case "an evidence base beside a complete prompt" run --provider codex --worktree "$REPO" --artifact-dir "$A" --prompt-file "$FACTS" --evidence-base "$BASE_OID"
usage_case "a deadline that is not a number" run --provider codex --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS" --deadline soon
usage_case "a flag with no value" run --provider
usage_case "collect where nothing was launched" collect --artifact-dir "$WORKDIR/art"
usage_case "a wait that is not a number" collect --artifact-dir "$A" --wait 0
[ ! -e "$STEER/helper.calls" ] && [ ! -e "$STEER/codex.count" ]
ok "2: none of them reached the helper or a provider" $?

# --- 3: preflight ------------------------------------------------------------
fresh
BIN="$BARE"
OUT="$(peer preflight --provider codex)"
is "3: codex missing is unavailable" "$(first)|$(val reason)" "outcome=unavailable|missing binary"
OUT="$(peer preflight --provider claude)"
is "3: claude missing is unavailable" "$(first)|$(val reason)" "outcome=unavailable|missing binary"
OUT="$(peer preflight --provider muse)"
is "3: muse missing is absent, which a run says nothing about" "$(first)|$(val reason)" "outcome=absent|missing binary"
BIN="$ALL"
OUT="$(peer preflight --provider codex)"
is "3: a logged-in codex is available" "$?|$(first)|$(val provider)" "0|outcome=available|codex"
echo "Not logged in" >"$STEER/codex.login"
OUT="$(CODEX_API_KEY='' peer preflight --provider codex)"
is "3: a logged-out codex with no key is unavailable, with the probe's own words" "$?|$(first)|$(val reason)" "0|outcome=unavailable|Not logged in"
OUT="$(CODEX_API_KEY=k peer preflight --provider codex)"
is "3: ...and deferred to the first launch where CODEX_API_KEY is set" "$(first)" "outcome=deferred"
OUT="$(peer preflight --provider claude)"
is "3: a logged-in claude is available" "$(first)" "outcome=available"
echo "Invalid credentials" >"$STEER/claude.auth"
OUT="$(ANTHROPIC_API_KEY='' peer preflight --provider claude)"
is "3: any other claude auth failure is unavailable and keeps its reason" "$(first)|$(val reason)" "outcome=unavailable|Invalid credentials"
OUT="$(ANTHROPIC_API_KEY=k peer preflight --provider claude)"
is "3: ...deferred where ANTHROPIC_API_KEY is set" "$(first)" "outcome=deferred"
echo "error: unknown command 'auth'" >"$STEER/claude.auth"
OUT="$(ANTHROPIC_API_KEY='' peer preflight --provider claude)"
is "3: ...and deferred where this claude has no auth status" "$(first)|$(val reason)" "outcome=deferred|this claude has no auth status subcommand"
OUT="$(peer preflight --provider muse)"
is "3: a muse that answers usage is available" "$(first)" "outcome=available"
echo "not logged in to muse" >"$STEER/muse.usage"
OUT="$(peer preflight --provider muse)"
is "3: ...and unavailable where it does not" "$?|$(first)|$(val reason)" "0|outcome=unavailable|not logged in to muse"
[ ! -e "$STEER/helper.calls" ] && [ ! -e "$STEER/codex.count" ] && [ ! -e "$STEER/claude.count" ]
ok "3: no preflight launched a review" $?

# --- 4: the helper path --------------------------------------------------------
fresh
OUT="$(peer run --provider codex --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS" 2>"$WORKDIR/stderr")"
is "4: a passing codex review through peer-review-run" "$?|$(first)|$(val path)" "0|outcome=passed|helper"
is "4: codex is launched at medium effort with no model flag, in the default budget" "$(cat "$STEER/helper.calls")" \
	"--provider codex --worktree $REPO --prompt-file $A/peer-review.prompt --artifact-root $A/peer-review-run --timeout 260 --effort medium"
is "4: the prompt is the brief, a blank line, and the facts, byte for byte" "$(cat "$A/peer-review.prompt" | cksum)" "$({ cat "$BRIEF" && printf '\n' && cat "$FACTS"; } | cksum)"
cmp -s "$A/peer-review.prompt" "$STEER/helper.prompt"
ok "4: ...and that is the file the helper was handed" $?
is "4: the review file is the one the result names" "$(val review_file)" "$A/peer-review-run/session/attempt-1/review.txt"
is "4: a null model is reported as a strength note, with the pin held" "$(val model)|$(val effort)|$(val strength_pin)" "null|medium|held"
is "4: the helper's progress stays out of the caller's output" "$(cat "$WORKDIR/stderr")" ""
lacks "4: no evidence was asked for, so none is reported" "$OUT" "evidence="
has "4: the prompt file is named" "$OUT" "prompt_file=$A/peer-review.prompt"

fresh
printf 'A complete prompt.\n' >"$WORKDIR/whole.txt"
OUT="$(peer run --provider codex --worktree "$REPO" --artifact-dir "$A" --prompt-file "$WORKDIR/whole.txt")"
cmp -s "$A/peer-review.prompt" "$WORKDIR/whole.txt"
ok "4: a complete prompt is handed over unchanged, with no brief added" $?
OUT="$(peer run --provider codex --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS" 2>&1)"
is "4: an artifact directory is never used twice" "$?" 64
is "4: ...and the helper ran once, not twice" "$(wc -l <"$STEER/helper.calls" | tr -d ' ')" 1
lacks "4: ...and a directory the caller named is not answered back" "$(peer run --provider codex --worktree "$REPO" --artifact-dir "$A-named" --facts "$FACTS")" "artifact_dir="

# The script picks the attempt directory itself under --artifact-root.
fresh
OUT="$(peer run --provider codex --worktree "$REPO" --artifact-root "$A/not/yet/there" --facts "$FACTS")"
RC=$?
D1="$(val artifact_dir)"
is "4: under an artifact root the review runs as before" "$RC|$(first)|$(val path)" "0|outcome=passed|helper"
case "$D1" in "$A/not/yet/there"/peer-run.??????) [ -d "$D1" ] ;; *) false ;; esac
ok "4: ...in a directory the script made directly under that root, which it answers" $?
is "4: ...holding the prompt" "$(val prompt_file)" "$D1/peer-review.prompt"
is "4: ...and everything the helper was handed" "$(cat "$STEER/helper.calls")" \
	"--provider codex --worktree $REPO --prompt-file $D1/peer-review.prompt --artifact-root $D1/peer-review-run --timeout 260 --effort medium"
is "4: ...its review included" "$(val review_file)" "$D1/peer-review-run/session/attempt-1/review.txt"
OUT="$(peer run --provider codex --worktree "$REPO" --artifact-root "$A/not/yet/there" --facts "$FACTS")"
RC=$?
D2="$(val artifact_dir)"
[ "$RC|$(first)" = "0|outcome=passed" ] && [ -n "$D2" ] && [ "$D2" != "$D1" ] && [ -f "$D2/peer-review.prompt" ]
ok "4: a second run under the same root gets a directory of its own" $?
OUT="$(peer run --provider codex --worktree "$REPO" --artifact-root "$WORKDIR" --facts "$FACTS")"
RC=$?
D3="$(val artifact_dir)"
case "$RC|$D3" in "0|$WORKDIR"/peer-run.??????) [ -z "$(git -C "$REPO" status --porcelain --ignored)" ] ;; *) false ;; esac
ok "4: a root that holds the worktree still puts the attempt beside it, not in it" $?
fresh
for _ in 1 2 3 4 5 6 7 8; do
	peer run --provider codex --worktree "$REPO" --artifact-root "$A" --facts "$FACTS" >"$(mktemp "$WORKDIR/racer.XXXXXX")" &
done
wait
is "4: eight runs started together under one root get eight directories" \
	"$(sed -n 's/^artifact_dir=//p' "$WORKDIR"/racer.* | sort -u | wc -l | tr -d ' ')|$(find "$A" -name peer-review.prompt | wc -l | tr -d ' ')|$(grep -c '^outcome=passed$' "$WORKDIR"/racer.* | grep -c ':1$')" "8|8|8"

for outcome in issues unavailable timeout forfeited failed; do
	fresh
	echo "$outcome" >"$STEER/helper.mode"
	printf 'VERDICT: ISSUES\n1. blocking a.txt:2 wrong\n' >"$STEER/helper.review"
	echo "the helper's own words for $outcome" >"$STEER/helper.reason"
	OUT="$(peer run --provider codex --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS")"
	is "4: helper outcome $outcome is carried with its reason and exits 0" "$?|$(first)|$(val reason)" "0|outcome=$outcome|the helper's own words for $outcome"
	if [ "$outcome" = issues ]; then
		[ -s "$(val review_file)" ]
		ok "4: issues names a readable review file" $?
	else
		lacks "4: $outcome carries no review file" "$OUT" "review_file="
	fi
done

fresh
echo "provider exited 0 but emitted no recognizable VERDICT token" >"$STEER/helper.reason"
echo forfeited >"$STEER/helper.mode"
OUT="$(peer run --provider codex --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS")"
is "4: a reason the batch throttle matches literally arrives unaltered" "$(val reason)" "provider exited 0 but emitted no recognizable VERDICT token"

fresh
LONG="$(printf 'word %.0s' $(seq 1 200))"
printf '%s\nsecond line\tend\n' "$LONG" >"$STEER/helper.reason"
echo failed >"$STEER/helper.mode"
OUT="$(peer run --provider codex --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS")"
is "4: a long reason arrives whole, its line break and tab flattened to spaces" "$(val reason)" "$LONG second line end"
is "4: ...on the one reason line" "$(printf '%s\n' "$OUT" | grep -c 'second line')|$(printf '%s\n' "$OUT" | grep -c '^reason=')" "1|1"

fresh
echo '"gpt-next"' >"$STEER/helper.model"
echo '"high"' >"$STEER/helper.effort"
OUT="$(peer run --provider codex --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS")"
is "4: an effort other than the one pinned is reported as a pin that differs" "$(val model)|$(val effort)|$(val strength_pin)" "gpt-next|high|differs"

helper_review_case() { # <label> <provider> <helper outcome> <review text> <expected first line> <expected reason>
	fresh
	echo "$3" >"$STEER/helper.mode"
	echo "the helper's own reason" >"$STEER/helper.reason"
	printf '%s' "$4" >"$STEER/helper.review"
	OUT="$(peer run --provider "$2" --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS")"
	is "4: $1" "$?|$(first)|$(val reason)" "0|$5|$6"
}
for provider in codex muse; do
	helper_review_case "a $provider pass over an empty review file is forfeited as empty output" "$provider" passed "" "outcome=forfeited" "empty output"
	lacks "4: ...with no review offered" "$OUT" "review_file="
	helper_review_case "a $provider pass over whitespace alone is empty output too" "$provider" passed $'\n  \n' "outcome=forfeited" "empty output"
	helper_review_case "a $provider pass whose review has no verdict line is forfeited as garbled output" "$provider" passed $'It looks broadly fine to me.\n' "outcome=forfeited" "garbled output"
	lacks "4: ...with no review offered" "$OUT" "review_file="
	helper_review_case "a $provider pass spaced with a form feed is the pass the helper read" "$provider" passed $'VERDICT:\fPASS\n' "outcome=passed" "the helper's own reason"
	helper_review_case "a $provider issues result whose review reads as a pass stays issues, under the helper's reason" "$provider" issues $'VERDICT: PASS\n1. blocking a.txt:2 wrong\n' "outcome=issues" "the helper's own reason"
	[ -s "$(val review_file)" ]
	ok "4: ...with its review, so no finding is dropped" $?
	helper_review_case "so does a $provider issues result whose review has no verdict line" "$provider" issues $'1. blocking a.txt:2 wrong\n' "outcome=issues" "the helper's own reason"
	[ -s "$(val review_file)" ]
	ok "4: ...with its review too" $?
	helper_review_case "a $provider issues result over an empty review file is forfeited as empty output" "$provider" issues "" "outcome=forfeited" "empty output"
	lacks "4: ...with no review offered" "$OUT" "review_file="
	helper_review_case "a $provider issues result over whitespace alone is empty output too" "$provider" issues $'\n  \n' "outcome=forfeited" "empty output"
	helper_review_case "a $provider pass whose review says issues is issues, under no borrowed reason" "$provider" passed $'VERDICT: PASS WITH ISSUES\n1. blocking a.txt:2 wrong\n' "outcome=issues" ""
	[ -s "$(val review_file)" ]
	ok "4: ...and keeps its review, so no finding is dropped" $?
done
[ ! -e "$STEER/codex.count" ]
ok "4: none of those is a reason to launch the provider directly" $?

fresh
echo raw >"$STEER/helper.mode"
echo '{"schema":"powbox.peer-review-run/v1","outcome":"exploded","reason":""}' >"$STEER/helper.raw"
OUT="$(peer run --provider codex --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS")"
is "4: an outcome outside the vocabulary is forfeited, never a pass" "$?|$(first)" "0|outcome=forfeited"
echo '{"schema":"something/else","outcome":"passed","reviewFile":"/etc/hostname"}' >"$STEER/helper.raw"
fresh_a() { N=$((N + 1)) A="$WORKDIR/art/$N"; }
fresh_a
OUT="$(peer run --provider codex --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS")"
is "4: a result under another schema is not read as one" "$?|$(first)" "0|outcome=failed"
has "4: ...and says the helper gave no result" "$(val reason)" "peer-review-run exited 0 with no result line"
fresh
echo crash >"$STEER/helper.mode"
OUT="$(peer run --provider codex --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS")"
is "4: a helper that dies without a result is failed, with its last words" "$?|$(first)|$(val reason)" "0|outcome=failed|peer-review-run exited 70 with no result line: peer-review-run: cannot create the review file"
[ ! -e "$STEER/codex.count" ]
ok "4: ...and is no reason to launch the provider directly" $?

# --- 5: claude and muse on the helper path --------------------------------------
fresh
echo '"opus"' >"$STEER/helper.model"
proof zebracrossing >"$STEER/helper.review"
OUT="$(peer run --provider claude --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS" --evidence-base "$BASE_OID")"
is "5: claude is launched with the model named and medium effort" "$(cat "$STEER/helper.calls")" \
	"--provider claude --worktree $REPO --prompt-file $A/peer-review.prompt --artifact-root $A/peer-review-run --timeout 260 --model opus --effort medium"
is "5: a proved pass is a pass, with both pins held" "$(first)|$(val evidence)|$(val strength_pin)" "outcome=passed|proved|held"
fresh
echo '"sonnet"' >"$STEER/helper.model"
proof zebracrossing >"$STEER/helper.review"
OUT="$(peer run --provider claude --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS" --evidence-base "$BASE_OID")"
is "5: a model other than the one pinned is reported as a pin that differs" "$(first)|$(val model)|$(val effort)|$(val strength_pin)" "outcome=passed|sonnet|medium|differs"
fresh
echo '"opus"' >"$STEER/helper.model"
proof zebracrossing >"$STEER/helper.review"
OUT="$(peer run --provider claude --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS" --evidence-base "$BASE_OID")"
{
	git -C "$REPO" log --oneline "$BASE_OID..$TIP_OID"
	git -C "$REPO" diff "$BASE_OID...$TIP_OID"
} >"$WORKDIR/evidence.txt"
cmp -s "$WORKDIR/evidence.txt" "$A/diff-evidence.txt"
ok "5: the audit copy of the evidence is the log and the diff of base..tip" $?
is "5: ...read-only to its owner" "$(stat -c %a "$A/diff-evidence.txt")" 400
sed -n '/^BEGIN EMBEDDED GIT EVIDENCE$/,/^END EMBEDDED GIT EVIDENCE$/p' "$A/peer-review.prompt" | sed '1d;$d' >"$WORKDIR/embedded.txt"
cmp -s "$WORKDIR/evidence.txt" "$WORKDIR/embedded.txt"
ok "5: nothing but those bytes sits between the evidence markers" $?
PROMPT="$(cat "$A/peer-review.prompt")"
has "5: the brief still leads the prompt" "$PROMPT" "$(head -n 1 "$BRIEF")"
has "5: the facts are inside the generated data, unexpanded" "$PROMPT" "BEGIN GENERATED REVIEW DATA
$(cat "$FACTS")
Effective base OID: $BASE_OID
Review tip OID: $TIP_OID
BEGIN EMBEDDED GIT EVIDENCE"
is "5: the prompt ends with the closing markers" "$(tail -n 2 "$A/peer-review.prompt" | tr '\n' '|')" "END EMBEDDED GIT EVIDENCE|END GENERATED REVIEW DATA|"
has "5: the peer is asked for the three proof lines" "$PROMPT" 'EVIDENCE_BASE_OID: <full OID>` and `EVIDENCE_TIP_OID: <full OID>`'
lacks "5: ...and is never shown a token to copy" "${PROMPT%%BEGIN GENERATED REVIEW DATA*}" "zebracrossing"

proof_case() { # <label> <review text> <expected first line> <expected reason> <expected evidence>
	fresh
	echo '"opus"' >"$STEER/helper.model"
	printf '%s\n' "$2" >"$STEER/helper.review"
	case "$2" in *ISSUES*) echo issues >"$STEER/helper.mode" ;; esac
	OUT="$(peer run --provider claude --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS" --evidence-base "$BASE_OID")"
	is "5: $1" "$(first)|$(val reason)|$(val evidence)" "$3|$4|$5"
}
UNPROVED='diff evidence unreadable or proof absent'
proof_case "a pass with no proof lines is forfeited" "VERDICT: PASS" "outcome=forfeited" "$UNPROVED" unproved
lacks "5: ...and its review is not offered as one" "$OUT" "review_file="
proof_case "a token in backticks is still the token" "$(proof '`zebracrossing`')" "outcome=passed" "" proved
proof_case "a token that occurs twice proves nothing" "$(proof twice_token)" "outcome=forfeited" "$UNPROVED" unproved
proof_case "a token from an unchanged line proves nothing" "$(proof contextword)" "outcome=forfeited" "$UNPROVED" unproved
is "5: (the diff names its new file exactly once, on a header line)" "$(grep -c -F -- '+++' "$A/diff-evidence.txt")|$(grep -c -- '^+++ ' "$A/diff-evidence.txt")" "1|1"
proof_case "a token from a diff file-header line proves nothing" "$(proof '+++')" "outcome=forfeited" "$UNPROVED" unproved
proof_case "a token that is not in the diff proves nothing" "$(proof giraffe)" "outcome=forfeited" "$UNPROVED" unproved
proof_case "a token holding a space proves nothing" "$(proof 'new zebracrossing')" "outcome=forfeited" "$UNPROVED" unproved
proof_case "a wrong base OID proves nothing" "$(proof zebracrossing | sed "s/^EVIDENCE_BASE_OID: .*/EVIDENCE_BASE_OID: $TIP_OID/")" "outcome=forfeited" "$UNPROVED" unproved
proof_case "a wrong tip OID proves nothing" "$(proof zebracrossing | sed "s/^EVIDENCE_TIP_OID: .*/EVIDENCE_TIP_OID: $BASE_OID/")" "outcome=forfeited" "$UNPROVED" unproved
proof_case "issues without proof stay issues, with the reason attached" "VERDICT: ISSUES
1. blocking a.txt:2 wrong" "outcome=issues" "$UNPROVED" unproved
[ -s "$(val review_file)" ]
ok "5: ...and keep their review, so no finding is dropped" $?

fresh
OUT="$(peer run --provider claude --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS" --evidence-base no-such-ref)"
is "5: evidence that cannot be rendered forfeits the launch" "$?|$(first)|$(val reason)" "0|outcome=forfeited|diff evidence could not be rendered: no-such-ref names no commit"
[ ! -e "$STEER/helper.calls" ] && [ ! -e "$A/peer-review.prompt" ]
ok "5: ...before any prompt is written or any peer asked" $?

fresh
OUT="$(peer run --provider muse --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS")"
is "5: muse gets one long attempt and no model flag" "$(cat "$STEER/helper.calls")" \
	"--provider muse --worktree $REPO --prompt-file $A/peer-review.prompt --artifact-root $A/peer-review-run --timeout 540 --attempts 1 --effort medium"
is "5: ...and its pass is a pass" "$(first)|$(val provider)" "outcome=passed|muse"
fresh
echo usage-provider >"$STEER/helper.mode"
OUT="$(peer run --provider muse --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS")"
is "5: a helper that predates the muse provider makes muse unavailable, naming the helper's refusal and not its synopsis" "$?|$(first)|$(val reason)" \
	"0|outcome=unavailable|peer-review-run predates this launch: peer-review-run: unsupported --provider 'muse' (claude|codex)"
fresh
echo usage-attempts >"$STEER/helper.mode"
OUT="$(peer run --provider muse --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS")"
is "5: so does a helper that knows muse but not a flag of this launch" "$?|$(first)|$(val reason)" \
	"0|outcome=unavailable|peer-review-run predates this launch: peer-review-run: unknown flag '--attempts'"
fresh
echo usage-other >"$STEER/helper.mode"
OUT="$(peer run --provider muse --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS")"
is "5: any other usage error is the call's own failure, though its synopsis names --provider" "$(first)|$(val reason)" \
	"outcome=failed|peer-review-run exited 64 with no result line: peer-review-run: --timeout must be a positive number of seconds (got '0')"
fresh
echo crash-provider >"$STEER/helper.mode"
OUT="$(peer run --provider muse --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS")"
is "5: so is an error naming --provider that is no usage error" "$(first)|$(val reason)" \
	"outcome=failed|peer-review-run exited 70 with no result line: peer-review-run: the --provider launch could not be prepared"
fresh
echo usage-provider >"$STEER/helper.mode"
OUT="$(peer run --provider codex --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS")"
is "5: and a usage error naming --provider for a provider every helper knows" "$(first)|$(val reason)" \
	"outcome=failed|peer-review-run exited 64 with no result line: peer-review-run: unsupported --provider 'muse' (claude|codex)"
fresh
echo issues-dir >"$STEER/helper.mode"
OUT="$(peer run --provider muse --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS")"
is "5: a muse review file that is a directory is no review file" "$(first)|$(val reason)" "outcome=forfeited|helper result carried no usable reviewFile"
fresh
echo passed-nofile >"$STEER/helper.mode"
OUT="$(peer run --provider muse --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS")"
is "5: a muse verdict with no review file is forfeited: there is no direct launch" "$(first)|$(val reason)" "outcome=forfeited|helper result carried no usable reviewFile"
fresh
BIN="$NOHELPER"
OUT="$(peer run --provider muse --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS")"
is "5: muse without the helper is unavailable" "$?|$(first)|$(val reason)" "0|outcome=unavailable|peer-review-run absent from PATH"
[ ! -e "$A/manual.state" ]
ok "5: ...and nothing was launched for it" $?

# --- 6: the direct launch -------------------------------------------------------
launch() { peer run --provider codex --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS" "$@"; }
pid_of() { cut -d' ' -f1 "$A/manual-attempt-$1/peer-review.pid"; }
# A zombie has exited and only awaits its parent. Where PID 1 does not reap
# (a container started on some other command), a provider this suite stopped
# stays one and answers `kill -0` for ever, so "still there" is read the way
# peer.sh reads it: by the state in /proc as well.
alive() { # <pid>: it answers, and is not a zombie
	local stat
	kill -0 "$1" 2>/dev/null || return 1
	stat="$(cat "/proc/$1/stat" 2>/dev/null)" || return 0
	case "${stat##*) }" in Z*) return 1 ;; esac
	return 0
}
gone() { # <pid>: wait briefly for it to leave
	local _
	for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
		alive "$1" || return 0
		sleep 0.1
	done
	return 1
}

fresh
BIN="$NOHELPER"
OUT="$(launch)"
is "6: without the helper, codex is launched directly and run returns at once" "$?|$(first)|$(val path)|$(val attempt)" "0|outcome=launched|manual|1"
is "6: ...saying why" "$(val fallback_reason)" "peer-review-run absent from PATH"
OUT="$(peer collect --artifact-dir "$A")"
is "6: collect reads its pass" "$?|$(first)|$(val reason)" "0|outcome=passed|"
is "6: ...from the provider's own result file" "$(val review_file)" "$A/manual-attempt-1/peer-review.out"
is "6: ...and still says why the direct launch ran" "$(val fallback_reason)|$(val effort)" "peer-review-run absent from PATH|medium"
is "6: codex is launched read-only, in the worktree, at medium effort, with the prompt as its argument" "$(args_of codex 1)" \
	"exec --sandbox read-only --cd $REPO -o $A/manual-attempt-1/peer-review.out -c mcp_servers={} -c model_reasoning_effort=medium <PROMPT> "
is "6: ...standing in the worktree with stdin closed" "$(tr '\n' '|' <"$STEER/codex.env.1")" "$REPO|/dev/null|"
has "6: ...and that prompt is the assembled one" "$(cat "$STEER/codex.args.1")" "$(cat "$A/peer-review.prompt")"
has "6: its stderr is kept apart from the result" "$(cat "$A/manual-attempt-1/peer-review.stderr")" "codex stub progress on stderr"
is "6: a second collect repeats the answer without a new launch" "$(peer collect --artifact-dir "$A" | head -n 1)|$(cat "$STEER/codex.count")" "outcome=passed|1"

fresh
OUT="$(peer run --provider codex --worktree "$REPO" --artifact-root "$A" --facts "$FACTS")"
RC=$?
D1="$(val artifact_dir)"
is "6: a direct launch under an artifact root answers the directory it made" "$RC|$(first)|$(dirname "$D1")" "0|outcome=launched|$A"
OUT="$(peer collect --artifact-dir "$D1")"
is "6: ...and collect works with it" "$?|$(first)|$(val review_file)" "0|outcome=passed|$D1/manual-attempt-1/peer-review.out"
OUT="$(peer collect --artifact-root "$D1" 2>&1)"
is "6: ...by that name only: an artifact root is not something to collect" "$?|$(first)" "64|peer: collect takes --artifact-dir: the artifact_dir run answered"

fresh
echo passed-nofile >"$STEER/helper.mode"
BIN="$ALL"
OUT="$(launch)"
is "6: a helper verdict with no review file hands the round to the direct launch" "$(first)|$(val fallback_reason)" "outcome=launched|helper result carried no usable reviewFile"
lacks "6: ...without the helper's strength note" "$OUT" "strength_pin="
OUT="$(peer collect --artifact-dir "$A")"
is "6: ...which is collected as usual" "$(first)|$(val path)" "outcome=passed|manual"
fresh
echo issues-ghost >"$STEER/helper.mode"
OUT="$(launch)"
is "6: so does a review file that is not there" "$(first)|$(val fallback_reason)" "outcome=launched|helper result carried no usable reviewFile"
peer collect --artifact-dir "$A" >/dev/null
fresh
echo issues-dir >"$STEER/helper.mode"
OUT="$(launch)"
is "6: and one that is a directory" "$(first)|$(val fallback_reason)" "outcome=launched|helper result carried no usable reviewFile"
peer collect --artifact-dir "$A" >/dev/null
fresh
echo passed-unreadable >"$STEER/helper.mode"
OUT="$(launch)"
# Root reads a mode-000 file, so there the helper's pass simply stands.
if [ "$(id -u)" = 0 ]; then
	is "6: (as root, a mode-000 review file is readable)" "$(first)" "outcome=passed"
else
	is "6: and one this user cannot read" "$(first)|$(val fallback_reason)" "outcome=launched|helper result carried no usable reviewFile"
	peer collect --artifact-dir "$A" >/dev/null
fi
BIN="$NOHELPER"

manual_case() { # <label> <codex mode> <review text> <expected first line> <expected reason> <expected launches>
	fresh
	echo "$2" >"$STEER/codex.mode"
	[ -z "$3" ] || printf '%s\n' "$3" >"$STEER/codex.review"
	launch >/dev/null
	OUT="$(peer collect --artifact-dir "$A")"
	is "6: $1" "$?|$(first)|$(val reason)|$(cat "$STEER/codex.count")" "0|$4|$5|$6"
}
manual_case "a verdict of issues is issues" pass "VERDICT: ISSUES
1. minor a.txt:2 naming" "outcome=issues" "" 1
manual_case "a verdict under Markdown emphasis still counts" pass "**VERDICT: PASS**" "outcome=passed" "" 1
manual_case "a pass that goes on to name issues is issues" pass "VERDICT: PASS WITH ISSUES
1. blocking a.txt:2 wrong" "outcome=issues" "" 1
manual_case "the template line naming both verdicts is not a pass" pass "VERDICT: PASS | ISSUES" "outcome=issues" "" 1
manual_case "a later verdict of issues outranks an earlier pass" pass "VERDICT: PASS
On reflection:
VERDICT: ISSUES" "outcome=issues" "" 1
manual_case "a quoted example pass does not outrank the real verdict" pass "> VERDICT: PASS
VERDICT: ISSUES" "outcome=issues" "" 1
manual_case "a quoted pass alone is no verdict" pass "> VERDICT: PASS" "outcome=forfeited" "garbled output" 1
manual_case "nor is a pass inside a code fence" pass '```
VERDICT: PASS
```' "outcome=forfeited" "garbled output" 1
manual_case "nor is a longer word that begins with one" pass "VERDICT: PASSING" "outcome=forfeited" "garbled output" 1
manual_case "a verdict behind a list dash counts" pass "- VERDICT: PASS" "outcome=passed" "" 1
manual_case "a verdict in another case counts" pass "Verdict: pass" "outcome=passed" "" 1
manual_case "a pass that says it found no issues stays a pass" pass "VERDICT: PASS, no issues found" "outcome=passed" "" 1
manual_case "a verdict behind a list number is none, as peer-review-run reads it" pass "1. VERDICT: ISSUES" "outcome=forfeited" "garbled output" 1
# The rest of the verdict rule, each row as `peer-review-run` reads it.
while IFS='|' read -r want label text <&3; do
	# shellcheck disable=SC2059 # the row is the format: its escapes are the bytes under test
	text="$(printf -- "$text")"
	case "$want" in
	none) manual_case "$label is no verdict" pass "$text" "outcome=forfeited" "garbled output" 1 ;;
	*) manual_case "$label is $want" pass "$text" "outcome=$want" "" 1 ;;
	esac
done 3<<'ROWS'
issues|a quoted verdict of issues|> VERDICT: ISSUES
none|a pass indented as code|    VERDICT: PASS
none|a pass behind a tab|\tVERDICT: PASS
passed|a pass indented by three spaces|   VERDICT: PASS
none|a pass in a four-backtick fence holding a three-backtick line|````\n```\nVERDICT: PASS\n````
none|a pass in a tilde fence holding a three-backtick line|~~~\n```\nVERDICT: PASS\n~~~
none|a pass in a fence after a line of three backticks and a word|```\n```x\nVERDICT: PASS\n```
none|a pass after a bare fence line that cannot close a quoted fence|> ```\n```\nVERDICT: PASS
none|a pass in a fence opened behind a list dash|- ```\nVERDICT: PASS\n```
passed|a pass after three backticks that open an inline code span|``` `x`\nVERDICT: PASS
passed|a pass between two two-backtick lines|``\nVERDICT: PASS\n``
issues|no issues followed by changes required|VERDICT: NO ISSUES, CHANGES REQUIRED
issues|no issues run straight into an issue word|VERDICT: NO ISSUES CHANGES REQUIRED
passed|a pass followed by a word that only ends in an issue word|VERDICT: PASS, unblocking the release
passed|a pass followed by a word that only begins with one|VERDICT: PASS, failing nothing
none|a pass in a fence opened behind a form feed|\f```\nVERDICT: PASS\n```
none|a pass in a fence opened behind a vertical tab|\v```\nVERDICT: PASS\n```
issues|issues spaced with a form feed, before a pass|VERDICT:\fISSUES\nVERDICT: PASS
issues|issues spaced with a vertical tab, before a pass|VERDICT:\vISSUES\nVERDICT: PASS
issues|issues spaced with a carriage return, before a pass|VERDICT:\rISSUES\nVERDICT: PASS
passed|a pass spaced with a vertical tab|VERDICT:\vPASS
passed|a pass behind a form feed|\fVERDICT: PASS
none|a pass in a fence quoted with a form feed|>\f```\nVERDICT: PASS
passed|a pass after a fence closed before a form feed|```\nx\n```\f\nVERDICT: PASS
none|a pass in a fence opened behind a dash and a form feed|-\f```\nVERDICT: PASS
passed|no issues spaced with a form feed|VERDICT: NO\fISSUES
issues|no issues spaced with a form feed, run into an issue word|VERDICT: NO\fISSUES CHANGES
passed|a pass that names no issues across a form feed|VERDICT: PASS, no\fissues
passed|a pass that names no real issues across form feeds|VERDICT: PASS, no\freal\fissues
issues|request changes spaced with a form feed|VERDICT: REQUEST\fCHANGES
ROWS
manual_case "no output at all is forfeited as empty output" empty "" "outcome=forfeited" "empty output" 1
manual_case "whitespace alone is empty output too" blank "" "outcome=forfeited" "empty output" 1
manual_case "prose with no verdict line is forfeited as garbled output" garbled "" "outcome=forfeited" "garbled output" 1
lacks "6: ...and offers no review" "$OUT" "review_file="
manual_case "a login failure is unavailable, with the provider's words, and is not retried" auth "" "outcome=unavailable" "ERROR: You are not logged in. Run codex login." 1
manual_case "a crash is told by the first error line of the stderr tail, not its last line" crash-then-noise "" "outcome=failed" "ERROR: stream error" 2
manual_case "an auth word in the transcript a provider echoes is not the provider's own error" transcript "" "outcome=forfeited" "empty output" 1
manual_case "a provider that dies without a word left no status to read: empty output, no retry" die "" "outcome=forfeited" "empty output" 1
manual_case "an error line the provider left more than twenty lines before it ended is not what ended it" old-error "" "outcome=forfeited" "empty output" 1
manual_case "a command the shell could not find is a crash, with the shell's words" not-found "" "outcome=failed" "peer-launch: 12: codex-core: not found" 2
manual_case "a prompt too long to pass as an argument is a crash, with the shell's words" too-long "" "outcome=failed" "peer-launch: 12: codex: Argument list too long" 2
manual_case "a crash is retried once and then failed, with the provider's words" crash "" "outcome=failed" "error: stream disconnected before completion" 2
is "6: ...in a second attempt directory of its own" "$(val attempt)|$(find "$A" -maxdepth 1 -name 'manual-attempt-*' | wc -l | tr -d ' ')" "2|2"
fresh
echo crash >"$STEER/codex.mode.1"
launch >/dev/null
OUT="$(peer collect --artifact-dir "$A")"
is "6: a retry that passes is a pass" "$(first)|$(val attempt)|$(val review_file)" "outcome=passed|2|$A/manual-attempt-2/peer-review.out"

fresh
echo hang >"$STEER/codex.mode"
launch --deadline 600 >/dev/null
OUT="$(peer collect --artifact-dir "$A" --wait 1)"
is "6: a provider still inside its deadline is pending, not timed out" "$?|$(first)|$(val attempt)" "0|outcome=pending|1"
PID="$(pid_of 1)"
alive "$PID"
ok "6: ...and was left running" $?
# The same PID under another start time is another process: never signalled.
read -r _ START <"$A/manual-attempt-1/peer-review.pid"
echo "$PID $((START + 1))" >"$A/manual-attempt-1/peer-review.pid"
OUT="$(peer collect --artifact-dir "$A" --wait 1)"
is "6: a PID whose start time no longer matches is the old peer's death" "$(first)|$(val reason)" "outcome=forfeited|empty output"
alive "$PID"
ok "6: ...and the process now holding that number is not touched" $?
kill -KILL "$PID" 2>/dev/null
for bad in one-field surplus-field zero-pid not-numbers; do
	fresh
	echo hang >"$STEER/codex.mode"
	launch --deadline 1 >/dev/null
	PID="$(pid_of 1)"
	read -r _ START <"$A/manual-attempt-1/peer-review.pid"
	sleep 1
	case "$bad" in
	one-field) echo "$PID" ;;
	surplus-field) echo "$PID $START extra" ;;
	zero-pid) echo "0 $START" ;;
	not-numbers) echo "x y" ;;
	esac >"$A/manual-attempt-1/peer-review.pid"
	echo pass >"$STEER/codex.mode"
	OUT="$(peer collect --artifact-dir "$A" --wait 5)"
	alive "$PID"
	ok "6: a malformed handoff ($bad) signals nothing, even past the deadline" $?
	kill -KILL "$PID" 2>/dev/null
done

fresh
echo hang >"$STEER/codex.mode"
launch --deadline 1 >/dev/null
P1="$(pid_of 1)"
OUT="$(peer collect --artifact-dir "$A" --wait 60)"
is "6: a provider past its deadline is stopped, retried once, and then a timeout" "$?|$(first)|$(val attempt)|$(cat "$STEER/codex.count")" "0|outcome=timeout|2|2"
is "6: ...whose reason names the deadline" "$(val reason)" "no verdict within 1 seconds"
P2="$(pid_of 2)"
gone "$P1" && gone "$P2" && [ "$P1" != "$P2" ]
ok "6: ...with both providers dead and a new identity for the second" $?

fresh
echo late >"$STEER/codex.mode"
launch --deadline 1 >/dev/null
OUT="$(peer collect --artifact-dir "$A" --wait 60)"
is "6: a verdict written before the deadline stop is authoritative once the provider is dead" "$(first)|$(cat "$STEER/codex.count")" "outcome=passed|1"
gone "$(pid_of 1)"
ok "6: ...and it is dead" $?

fresh
echo hang >"$STEER/codex.mode"
mkdir -p "$A/manual.state.new"
OUT="$(launch 2>/dev/null)"
is "6: a launch that cannot be recorded is failed, non-blocking" "$?|$(first)|$(val reason)" "0|outcome=failed|cannot write $A/manual.state"
gone "$(pid_of 1)"
ok "6: ...and the provider it had started is stopped before run answers" $?
is "6: ...which it had started" "$(cat "$STEER/codex.count")" 1

# Everything the helper and the stubs call, and no jq.
NOJQ="$WORKDIR/bin-nojq"
mkdir "$NOJQ"
for tool in bash sh env sed awk tr cut cat mkdir dirname date sleep nohup mv head tail grep git chmod readlink; do
	ln -s "$(PATH=/usr/bin:/bin command -v "$tool")" "$NOJQ/$tool"
done
for tool in peer-review-run codex claude muse; do ln -s "$ALL/$tool" "$NOJQ/$tool"; done
nojq() { PATH="$NOJQ" "$NOJQ/bash" "$HELPER" "$@"; }
fresh
OUT="$(nojq run --provider codex --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS")"
is "6: without jq the helper's result could not be read, so codex is launched directly" "$?|$(first)|$(val fallback_reason)" "0|outcome=launched|jq absent from PATH, so no peer-review-run result could be read"
OUT="$(nojq collect --artifact-dir "$A")"
is "6: ...and collected without jq" "$?|$(first)" "0|outcome=passed"
[ ! -e "$STEER/helper.calls" ]
ok "6: ...with the helper never run" $?
for provider in claude muse; do
	fresh
	OUT="$(nojq run --provider "$provider" --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS" --evidence-base "$BASE_OID" 2>&1)"
	is "6: without jq $provider cannot be read on either path: the script's own failure" "$?|$OUT" "1|peer: jq is required to read the $provider result"
done

fresh
BIN="$BARE"
OUT="$(launch)"
is "6: with neither helper nor provider the peer is unavailable" "$?|$(first)|$(val reason)" "0|outcome=unavailable|missing binary"
BIN="$NOHELPER"

# --- 7: the direct claude launch ---------------------------------------------------
claude_launch() { peer run --provider claude --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS" --evidence-base "$BASE_OID"; }
fresh
proof zebracrossing >"$STEER/claude.review"
OUT="$(claude_launch)"
is "7: claude is launched directly too" "$(first)|$(val fallback_reason)" "outcome=launched|peer-review-run absent from PATH"
OUT="$(peer collect --artifact-dir "$A")"
is "7: its proved pass is a pass, at the strength the launch pinned" "$(first)|$(val evidence)|$(val model)|$(val effort)" "outcome=passed|proved|opus|medium"
is "7: with the model and effort named, read-only tools, and only the artifact directory added" "$(args_of claude 1)" \
	"-p --model opus --effort medium --safe-mode --tools Read,Glob,Grep --disallowedTools mcp__* --add-dir $A --output-format json "
is "7: it runs from the reviewed worktree, which is the only way claude -p learns where to read" "$(cat "$STEER/claude.env.1")" "$REPO"
cmp -s "$STEER/claude.stdin.1" "$A/peer-review.prompt"
ok "7: the prompt, evidence included, arrives on stdin" $?
is "7: the review is the decoded message, not the JSON envelope" "$(head -n 1 "$(val review_file)")" "VERDICT: PASS"
fresh
echo "VERDICT: PASS" >"$STEER/claude.review"
claude_launch >/dev/null
OUT="$(peer collect --artifact-dir "$A")"
is "7: an unproved pass is forfeited on this path as well" "$(first)|$(val reason)" "outcome=forfeited|diff evidence unreadable or proof absent"
fresh
echo error >"$STEER/claude.mode"
echo "Invalid API key · Please run /login" >"$STEER/claude.review"
claude_launch >/dev/null
OUT="$(peer collect --artifact-dir "$A")"
is "7: an auth error result is unavailable and not retried" "$(first)|$(val reason)|$(cat "$STEER/claude.count")" "outcome=unavailable|Invalid API key · Please run /login|1"
fresh
echo error >"$STEER/claude.mode"
printf 'VERDICT: PASS\nthe model returned an error turn\n' >"$STEER/claude.review"
claude_launch >/dev/null
OUT="$(peer collect --artifact-dir "$A")"
is "7: an error result is failed after one retry, never a pass, whatever its text says" "$(first)|$(val reason)|$(cat "$STEER/claude.count")" "outcome=failed|VERDICT: PASS|2"
fresh
echo notresult >"$STEER/claude.mode"
proof zebracrossing >"$STEER/claude.review"
claude_launch >/dev/null
OUT="$(peer collect --artifact-dir "$A")"
is "7: a JSON object that is not a result envelope is garbled output, whatever verdict it carries" "$(first)|$(val reason)" "outcome=forfeited|garbled output"
fresh
echo notjson >"$STEER/claude.mode"
claude_launch >/dev/null
OUT="$(peer collect --artifact-dir "$A")"
is "7: output that is not the JSON envelope is garbled output" "$(first)|$(val reason)" "outcome=forfeited|garbled output"

# --- 8: identity checks and teardown, beside a fake kill and a fake /proc ----------
PROC="$WORKDIR/proc"
SIGLOG="$WORKDIR/signals.log"
IDFILE="$WORKDIR/peer.pid"
mkdir -p "$PROC/731"
stat_line() { printf '731 (peer ) name with spaces) %s 1 731 731 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 %s 0\n' "${2:-S}" "$1" >"$PROC/731/stat"; }
# The fake kill logs every operand. `-0` answers from the fake /proc; KILL
# removes the record unless this run models a survivor.
lifecycle() { # <survivor: yes|no> <commands...>
	: >"$SIGLOG"
	(
		export PROC SIGLOG IDFILE SURVIVOR="$1"
		shift
		PATH="$NOHELPER:/usr/bin:/bin" bash -c '
			source "$1"
			PEER_PROC_ROOT="$PROC"
			kill() {
				printf "%s\n" "$*" >>"$SIGLOG"
				if [ "$1" = -0 ]; then [ -f "$PROC/$2/stat" ]; return; fi
				if [ "$1" = -KILL ] && [ "$SURVIVOR" != yes ]; then rm -f "$PROC/$2/stat"; fi
				return 0
			}
			sleep() { :; }
			shift
			eval "$1"' peer-test "$HELPER" "$@"
	)
}
signals() { tr '\n' '|' <"$SIGLOG"; }

stat_line 424242
echo "731 424242" >"$IDFILE"
lifecycle no 'peer_alive "$IDFILE"; peer_signal TERM "$IDFILE"'
is "8: probe and TERM reach only the identity-checked PID, past a comm holding spaces and a parenthesis" "$?|$(signals)" "0|-0 731|-TERM 731|"
stat_line 999999
lifecycle no 'peer_alive "$IDFILE" || :; peer_signal TERM "$IDFILE" || :'
is "8: a reused PID with another start time is never probed or signalled" "$(signals)" ""
rm -f "$PROC/731/stat"
lifecycle no 'peer_alive "$IDFILE" || :; peer_signal TERM "$IDFILE" || :'
is "8: a missing /proc record is the original's death, without a signal" "$(signals)" ""
stat_line 424242
echo "731 424242 surplus" >"$IDFILE"
lifecycle no 'peer_alive "$IDFILE" || :; peer_signal KILL "$IDFILE" || :'
is "8: a handoff with a surplus field fails closed before every kill" "$(signals)" ""
echo "731 424242" >"$IDFILE"
printf '731 (peer) S 1 731 731 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n' >"$PROC/731/stat"
lifecycle no 'peer_alive "$IDFILE" || :'
is "8: a zero start time is no identity" "$(signals)" ""
lifecycle no 'peer_start_time 731'
is "8: ...and is not read as a start time at all" "$?" 1
stat_line 424242 Z
echo "731 424242" >"$IDFILE"
lifecycle no 'peer_alive "$IDFILE" || :; peer_signal TERM "$IDFILE" || :'
is "8: a zombie under the recorded start time has exited: never probed or signalled" "$(signals)" ""
lifecycle no 'peer_stop "$IDFILE"'
is "8: ...and counts as proved dead" "$?|$(signals)" "0|"
is "8: collect waits 520 seconds unless told otherwise" "$(lifecycle no 'echo "$WAIT"')" 520
# Operands `kill` would read as a process group or as every process.
for bad in 0 -1; do
	mkdir -p "$PROC/$bad"
	sed 's/^731 /1 /' "$PROC/731/stat" | sed 's/ 0 0$/ 424242 0/' >"$PROC/$bad/stat"
	echo "$bad 424242" >"$IDFILE"
	lifecycle no 'peer_alive "$IDFILE" || :; peer_signal TERM "$IDFILE" || :; peer_stop "$IDFILE" || :'
	is "8: a handoff naming PID $bad is never probed or signalled" "$(signals)" ""
done
echo "731 424242" >"$IDFILE"
stat_line 424242
lifecycle no 'peer_stop "$IDFILE"'
is "8: a provider that ignores TERM is killed, on the same PID, and its death confirmed" "$?" 0
has "8: ...TERM first" "$(signals)" "-TERM 731|-0 731|"
has "8: ...then KILL" "$(signals)" "-KILL 731|"
stat_line 424242
lifecycle yes 'peer_stop "$IDFILE"'
is "8: an identity that outlives TERM and KILL makes the stop fail" "$?|$(grep -c -- '-KILL 731' "$SIGLOG")" "1|1"
stat_line 424242
lifecycle no 'peer_abort_unhanded 731'
is "8: a launch with no identity gets TERM and KILL back to back, then probes only" "$?|$(signals)" "0|-TERM 731|-KILL 731|-0 731|"
stat_line 424242
lifecycle yes 'peer_abort_unhanded 731'
is "8: ...and reports a child it could not prove dead" "$?" 1

# A direct launch, well past its deadline, whose provider survives KILL.
survivor_state() { # <deadline>
	fresh
	mkdir -p "$A/manual-attempt-1"
	printf 'provider=codex\ndeadline=%s\nfallback_reason=peer-review-run absent from PATH\nattempt=1\nlaunched_at=1\nworktree=%s\n' "$1" "$REPO" >"$A/manual.state"
	echo "731 424242" >"$A/manual-attempt-1/peer-review.pid"
	echo prompt >"$A/peer-review.prompt"
	stat_line 424242
}
survivor_state 5
OUT="$(A="$A" lifecycle yes 'main collect --artifact-dir "$A" --wait 5')"
is "8: a teardown survivor is the one stop: exit 3" "$?" 3
is "8: ...reported as failed, flagged, with the PID to hand the operator" "$(first)|$(val teardown)|$(val pid)" "outcome=failed|survivor|731"
has "8: ...and a reason naming the probe that still answered" "$(val reason)" "PID 731 still answered kill -0 after TERM and KILL"
[ ! -e "$A/manual-attempt-2" ] && [ ! -e "$STEER/codex.count" ] && [ ! -e "$A/manual.result" ]
ok "8: ...with no retry launched and no result recorded" $?
survivor_state 5
OUT="$(A="$A" lifecycle no 'main collect --artifact-dir "$A" --wait 5' 2>/dev/null)"
has "8: where KILL does land, the same deadline is an ordinary non-blocking outcome" "$?|$(first)" "0|outcome="
lacks "8: ...with no survivor flag" "$OUT" "teardown="

# A finished provider nobody reaped is classified, not held for a survivor.
survivor_state 5
stat_line 424242 Z
printf 'VERDICT: ISSUES\n1. minor a.txt:2 naming\n' >"$A/manual-attempt-1/peer-review.out"
OUT="$(A="$A" lifecycle yes 'main collect --artifact-dir "$A" --wait 5')"
is "8: a zombie past its deadline is a finished provider: its verdict is read, with no signal sent" "$?|$(first)|$(signals)" "0|outcome=issues|"
lacks "8: ...and no survivor flag" "$OUT" "teardown="

# A wrapper that cannot record its identity never becomes a provider.
fresh
OUT="$(A="$A" REPO="$REPO" FACTS_FILE="$FACTS" lifecycle no 'PEER_PROC_ROOT=/nonexistent; main run --provider codex --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS_FILE"')"
is "8: a failed identity handoff is failed, non-blocking" "$?|$(first)|$(val reason)" "0|outcome=failed|peer launch handoff failed before the provider started"
[ ! -e "$STEER/codex.count" ] && [ ! -e "$A/manual.state" ]
ok "8: ...and no provider was started without one" $?

# A handoff file that does not name the launched child is no handoff, and a
# launch left running without one is the same stop as any other survivor.
fresh
OUT="$(A="$A" REPO="$REPO" FACTS_FILE="$FACTS" lifecycle yes 'nohup() { echo "1 77" >"$5"; command sleep 3; }; sleep() { command sleep 0.05; }; kill() { printf "%s\n" "$*" >>"$SIGLOG"; return 0; }; main run --provider codex --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS_FILE"')"
is "8: an identity file naming another PID is not accepted, and the child that outlives TERM and KILL is the stop" "$?|$(first)|$(val teardown)" "3|outcome=failed|survivor"
has "8: ...named as a failed handoff" "$(val reason)" "survived TERM and KILL after a failed launch handoff"
is "8: ...after TERM and KILL went to that child, back to back" "$(grep -A 1 -- '^-TERM ' "$SIGLOG" | sed 's/ [0-9]*$//' | tr '\n' '|')" "-TERM|-KILL|"
[ ! -e "$A/manual.state" ]
ok "8: ...and nothing is recorded as launched" $?

fresh
OUT="$(A="$A" REPO="$REPO" FACTS_FILE="$FACTS" lifecycle yes 'nohup() { echo "$BASHPID 77 surplus" >"$5"; command sleep 3; }; sleep() { command sleep 0.05; }; kill() { printf "%s\n" "$*" >>"$SIGLOG"; return 0; }; main run --provider codex --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS_FILE"')"
is "8: an identity file with a surplus field is not accepted at launch either" "$?|$(first)|$(val teardown)" "3|outcome=failed|survivor"
[ ! -e "$A/manual.state" ]
ok "8: ...and nothing is recorded as launched" $?

# A launch that cannot be recorded, whose provider then outlives TERM and KILL:
# the real /proc and a real provider, beside a kill that lands nowhere.
fresh
echo hang >"$STEER/codex.mode"
mkdir -p "$A/manual.state.new"
OUT="$(A="$A" REPO="$REPO" FACTS_FILE="$FACTS" lifecycle yes 'PEER_PROC_ROOT=/proc; sleep() { command sleep 0.05; }; kill() { printf "%s\n" "$*" >>"$SIGLOG"; return 0; }; main run --provider codex --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS_FILE"' 2>/dev/null)"
is "8: a provider that outlives the stop of an unrecorded launch is the stop: exit 3" "$?|$(first)|$(val teardown)" "3|outcome=failed|survivor"
PID="$(pid_of 1)"
is "8: ...naming the recorded provider and what it survived" "$(val pid)|$(val reason)" "$PID|PID $PID survived TERM and KILL after a launch that could not be recorded"
has "8: ...after TERM went to that identity" "$(signals)" "-TERM $PID|-0 $PID|"
has "8: ...and KILL" "$(signals)" "-KILL $PID|"
kill -KILL "$PID" 2>/dev/null

# --- 9: the budget, the effort, the basis and the round's record ---------------------
BIN="$ALL"
sized() { head -c "$1" /dev/zero | tr '\0' x >"$WORKDIR/sized.txt"; }
budget_case() { # <label> <provider> <prompt bytes> <expected budget> <expected helper flags> [run args...]
	local label="$1" provider="$2" bytes="$3" want="$4" flags="$5"
	shift 5
	fresh
	sized "$bytes"
	OUT="$(peer run --provider "$provider" --worktree "$REPO" --artifact-dir "$A" --prompt-file "$WORKDIR/sized.txt" "$@")"
	is "9: $label" "$(first)|$(val budget)|$(val prompt_bytes)|$(sed 's/.*peer-review-run //' "$STEER/helper.calls")" "outcome=passed|$want|$bytes|$flags --effort medium"
}
budget_case "a prompt of 150000 bytes keeps two short attempts, and the answer says so" codex 150000 short "--timeout 260"
budget_case "one byte more gets one long attempt" codex 150001 long "--timeout 540 --attempts 1"
budget_case "the caller can force the short budget on a large review" codex 150001 short "--timeout 260" --budget short
budget_case "...and the long one on a small review" codex 20 long "--timeout 540 --attempts 1" --budget long
budget_case "muse keeps its one long attempt at any size" muse 20 long "--timeout 540 --attempts 1"
budget_case "...unless the caller forces the short budget" muse 20 short "--timeout 260" --budget short
fresh
OUT="$(peer run --provider codex --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS" --evidence-base "$BASE_OID" --budget auto)"
is "9: the measured size is that of the whole prompt, embedded evidence included" "$(val prompt_bytes)" "$(wc -c <"$A/peer-review.prompt" | tr -d ' ')"
fresh
OUT="$(nojq run --provider codex --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS" 2>&1)"
is "9: a size that cannot be measured costs the launch nothing: the default budget, and no size claimed" "$(first)|$(val budget)|$(val prompt_bytes)" "outcome=launched|short|"
nojq collect --artifact-dir "$A" >/dev/null

BIN="$NOHELPER"
fresh
echo crash >"$STEER/codex.mode"
launch --budget long >/dev/null
is "9: on the direct launch a long budget is one attempt of twice the deadline" "$(sed -n 's/^deadline=//p' "$A/manual.state")" 1440
OUT="$(peer collect --artifact-dir "$A")"
is "9: ...with no retry after a crash, and the answer says which budget ran" "$(first)|$(val budget)|$(val attempt)|$(cat "$STEER/codex.count")" "outcome=failed|long|1|1"
fresh
launch --deadline 7 >/dev/null
is "9: ...and a short one keeps the deadline it was given" "$(sed -n 's/^deadline=//p' "$A/manual.state")" 7
peer collect --artifact-dir "$A" >/dev/null

BIN="$ALL"
fresh
echo '"high"' >"$STEER/helper.effort"
OUT="$(peer run --provider codex --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS" --effort high)"
is "9: an effort given to run is what the helper is handed" "$(sed 's/.*--timeout 260 //' "$STEER/helper.calls")" "--effort high"
is "9: ...and what the answer reports, as a pin that held" "$(first)|$(val effort)|$(val strength_pin)" "outcome=passed|high|held"
fresh
OUT="$(peer run --provider codex --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS" --effort high)"
is "9: a helper that reviewed at another effort than the one asked for is a pin that differs" "$(val effort)|$(val strength_pin)" "medium|differs"
fresh
proof zebracrossing >"$STEER/helper.review"
echo '"opus"' >"$STEER/helper.model"
echo '"max"' >"$STEER/helper.effort"
OUT="$(peer run --provider claude --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS" --evidence-base "$BASE_OID" --effort max)"
is "9: claude takes max" "$(first)|$(val effort)|$(val strength_pin)|$(sed 's/.*--model //' "$STEER/helper.calls")" "outcome=passed|max|held|opus --effort max"
fresh
usage_case "an effort that is no level" run --provider codex --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS" --effort extreme
usage_case "max for codex, which offers none" run --provider codex --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS" --effort max
usage_case "a budget that is no budget" run --provider codex --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS" --budget huge
usage_case "a round that is not a number" run --provider codex --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS" --round two
[ ! -e "$STEER/helper.calls" ] && [ ! -e "$A" ]
ok "9: ...and none of them launched or created anything" $?
BIN="$NOHELPER"
fresh
echo crash >"$STEER/codex.mode.1"
launch --effort high >/dev/null
OUT="$(peer collect --artifact-dir "$A")"
is "9: the direct launch reviews at the effort given, its retry too, and reports it" "$(first)|$(val effort)|$(args_of codex 1 | grep -c 'model_reasoning_effort=high')|$(args_of codex 2 | grep -c 'model_reasoning_effort=high')" "outcome=passed|high|1|1"

BIN="$ALL"
basis_case() { # <label> <review text> <expected first line> <expected basis>
	fresh
	printf '%s\n' "$2" >"$STEER/helper.review"
	OUT="$(peer run --provider codex --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS")"
	is "9: $1" "$(first)|$(val basis)" "$3|$4"
}
basis_case "a pass that says what it checked is a pass with its basis stated" "VERDICT: PASS
VERIFICATION: STATIC (executed no tests)
CHECKED: a.txt against the work item" "outcome=passed" stated
basis_case "a pass that does not is a pass all the same, with its basis unstated" "VERDICT: PASS
VERIFICATION: STATIC (executed no tests)" "outcome=passed" unstated
basis_case "a CHECKED line that names nothing states nothing" "VERDICT: PASS
CHECKED:   " "outcome=passed" unstated
basis_case "a CHECKED line under Markdown emphasis counts" "VERDICT: PASS
**CHECKED:** a.txt" "outcome=passed" stated
basis_case "the word inside a sentence is not that line" "VERDICT: PASS
I checked: everything" "outcome=passed" unstated
fresh
echo issues >"$STEER/helper.mode"
printf 'VERDICT: ISSUES\nCHECKED: a.txt\n1. blocking a.txt:2 wrong\n' >"$STEER/helper.review"
OUT="$(peer run --provider codex --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS")"
is "9: issues carry findings, not a basis" "$(first)|$(val basis)" "outcome=issues|"
fresh
printf 'VERDICT: PASS\nCHECKED: a.txt\n' >"$STEER/helper.review"
OUT="$(peer run --provider codex --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS" --evidence-base "$BASE_OID")"
is "9: nor does a pass forfeited for its missing proof" "$(first)|$(val basis)" "outcome=forfeited|"
BIN="$NOHELPER"
fresh
printf 'VERDICT: PASS\nCHECKED: a.txt against the work item\n' >"$STEER/codex.review"
launch >/dev/null
OUT="$(peer collect --artifact-dir "$A")"
is "9: the direct launch reports the basis too" "$(first)|$(val basis)" "outcome=passed|stated"

# The round's record: what a round decision reads instead of trusting a role's report.
BIN="$ALL"
fresh
OUT="$(peer record --artifact-root "$A")"
is "9: a root no run ever used answers not-launched, and exits 0" "$?|$OUT" "0|outcome=not-launched
reason="
OUT="$(peer run --provider codex --worktree "$REPO" --artifact-root "$A" --facts "$FACTS" --round 2)"
D1="$(val artifact_dir)"
is "9: a run given a round answers it" "$(first)|$(val round)" "outcome=passed|2"
RUN_OUT="$OUT"
OUT="$(peer record --artifact-root "$A" --round 2)"
is "9: the record of that round is the answer the run gave" "$OUT" "$RUN_OUT"
OUT="$(peer record --artifact-root "$A" --round 3 --provider codex)"
is "9: another round was not launched, and the answer names what was asked" "$(first)|$(val provider)|$(val round)" "outcome=not-launched|codex|3"
OUT="$(peer record --artifact-root "$A" --round 2 --provider muse)"
is "9: nor was another provider in this one" "$(first)" "outcome=not-launched"
peer run --provider muse --worktree "$REPO" --artifact-root "$A" --facts "$FACTS" --round 2 >/dev/null
peer run --provider codex --worktree "$REPO" --artifact-root "$A" --facts "$FACTS" --round 3 >/dev/null
OUT="$(peer record --artifact-root "$A" --round 2)"
is "9: two providers launched in one round are two blocks, an empty line between them" "$(printf '%s\n' "$OUT" | grep -c '^outcome=passed$')|$(printf '%s\n' "$OUT" | grep -c '^$')|$(printf '%s\n' "$OUT" | grep -c '^round=2$')|$(printf '%s\n' "$OUT" | sed -n 's/^provider=//p' | sort | tr '\n' ' ')" "2|1|2|codex muse "
OUT="$(peer record --artifact-root "$A" --round 2 --provider codex)"
is "9: ...narrowed to one by its provider" "$(printf '%s\n' "$OUT" | grep -c '^outcome=')|$(val artifact_dir)" "1|$D1"
OUT="$(peer record --artifact-dir "$D1")"
is "9: one attempt directory answers its own record" "$(first)|$(val round)|$(val artifact_dir)" "outcome=passed|2|$D1"
usage_case "a record with no directory" record
usage_case "a record with both directories" record --artifact-root "$A" --artifact-dir "$D1"
usage_case "a record of a round that is not a number" record --artifact-root "$A" --round last

fresh
echo cutoff >"$STEER/helper.mode"
OUT="$(peer run --provider codex --worktree "$REPO" --artifact-root "$A" --facts "$FACTS" --round 1 2>/dev/null)"
is "9: a run killed while its review ran answers nothing" "$?|$OUT" "137|"
OUT="$(peer record --artifact-root "$A" --round 1)"
is "9: ...and its record says a launch was started and never answered" "$(first)|$(val provider)|$(val round)" "outcome=started|codex|1"
case "$(val artifact_dir)" in "$A"/peer-run.??????) ok "9: ...naming the attempt directory to look in" 0 ;; *) ok "9: ...naming the attempt directory to look in" 1 ;; esac

BIN="$NOHELPER"
fresh
echo late >"$STEER/codex.mode"
OUT="$(peer run --provider codex --worktree "$REPO" --artifact-root "$A" --facts "$FACTS" --round 4)"
D1="$(val artifact_dir)"
OUT="$(peer record --artifact-root "$A" --round 4)"
is "9: a direct launch is recorded as launched" "$(first)|$(val attempt)" "outcome=launched|1"
peer collect --artifact-dir "$D1" --wait 1 >/dev/null
OUT="$(peer record --artifact-root "$A" --round 4)"
is "9: ...as pending while collect still waits, the round kept" "$(first)|$(val round)" "outcome=pending|4"
kill -KILL "$(cut -d' ' -f1 "$D1/manual-attempt-1/peer-review.pid")" 2>/dev/null
RUN_OUT="$(peer collect --artifact-dir "$D1")"
OUT="$(peer record --artifact-root "$A" --round 4)"
is "9: ...and as what collect last answered once it is in" "$(first)|$(printf '%s\n' "$OUT" | grep -v '^artifact_dir=')" "outcome=passed|$RUN_OUT"

BIN="$ALL"
fresh
mkdir -p "$A/peer.record.new"
OUT="$(peer run --provider codex --worktree "$REPO" --artifact-dir "$A" --facts "$FACTS" 2>"$WORKDIR/stderr")"
is "9: a record that cannot be written changes no answer" "$?|$(first)|$(val review_file)" "0|outcome=passed|$A/peer-review-run/session/attempt-1/review.txt"
has "9: ...and is said on stderr" "$(cat "$WORKDIR/stderr")" "peer: cannot write $A/peer.record"
OUT="$(peer record --artifact-dir "$A")"
is "9: ...leaving nothing to read back" "$(first)" "outcome=not-launched"
OUT="$(bash "$SHIPPED" --help 2>&1)"
has "9: the contract states the size threshold" "$OUT" "Up to 150000"
has "9: ...and the record's two answers that are not review outcomes" "$OUT" "So \`started\` is a launch that was"

if [ "$fails" -gt 0 ]; then
	printf 'review-cycle peer helper test: %d/%d checks FAILED.\n' "$fails" "$checks" >&2
	exit 1
fi
printf 'review-cycle peer helper test passed (%d checks).\n' "$checks"
