#!/usr/bin/env bash
# peer.sh — run one best-effort cross-harness peer review and classify its result.
#
# Usage:
#   peer.sh preflight --provider <codex|claude|muse>
#   peer.sh run --provider <codex|claude|muse> --worktree <abs dir>
#               (--artifact-root <abs dir> | --artifact-dir <abs dir>)
#               (--facts <file> | --prompt-file <file>)
#               [--evidence-base <ref> | --base <ref>] [--effort <level>]
#               [--budget <auto|short|long>] [--round <n>] [--deadline <seconds>]
#   peer.sh collect --artifact-dir <abs dir> [--wait <seconds>]
#   peer.sh record (--artifact-root <abs dir> | --artifact-dir <abs dir>)
#               [--round <n>] [--provider <codex|claude|muse>]
#
# preflight  Probe one provider, once per run. Answers `outcome=available`,
#            `outcome=unavailable` with the probe's diagnostic as `reason`,
#            `outcome=deferred` (the probe cannot tell: an API key is set
#            beside a failed login probe, or this `claude` has no
#            `auth status`; the first real launch classifies instead), or, for
#            muse only, `outcome=absent` when the binary is not installed.
#            It launches no review.
#
# run        Review the committed state of --worktree, read-only. --effort
#            <low|medium|high|xhigh|max> (default medium; codex offers no max)
#            is what this one call passes, never a saved setting, and comes
#            back as `effort=`. Every attempt has an artifact directory of its
#            own.
#            Under --artifact-root, `run` makes it: a new `peer-run.XXXXXX`
#            (mktemp) inside that directory, so calls sharing a root, at the
#            same moment too, never share an attempt. Its path is answered as
#            `artifact_dir=`, which is what `collect` takes. --artifact-dir
#            names the directory instead, and never one a previous `run` used.
#            Either flag's path is absolute, outside the worktree, and has no
#            `..` component. The prompt is `peer-brief.md` (beside this
#            script) followed by the bytes of --facts, or the bytes of
#            --prompt-file alone where the caller holds a complete prompt; it
#            is written to <artifact-dir>/peer-review.prompt and nothing else
#            is added to it. What else an attempt leaves is in that directory
#            too: the helper's tree under `peer-review-run/`, and a direct
#            launch's `manual.state`, `manual-attempt-<n>/` and `manual.result`.
#            --evidence-base <ref> (needs --facts; required for claude, whose
#            read-only tools cannot run git) embeds the log and diff of
#            <ref>..HEAD in the prompt between fixed markers, asks the peer for
#            three proof lines, and checks them on the result.
#
#            The attempt budget follows the size of the review: the bytes of
#            the assembled prompt (`prompt_bytes=`) and, under --base <ref>,
#            which names the review's base where the prompt does not embed
#            the diff, the bytes of `git diff <ref>...HEAD` as well
#            (`diff_bytes=`). Up to 150000 bytes together, codex and claude
#            get two attempts of 260 seconds (`budget=short`); above it, one
#            attempt of 540 (`budget=long`), which is what muse gets at any
#            size. --budget short|long forces either. Under --evidence-base
#            the diff is in the prompt and counted there. With neither flag
#            only the prompt is measured, and a --base that names no commit,
#            or one sharing no history with HEAD, adds nothing and prints no
#            `diff_bytes=`. Where 150000 comes
#            from: of the last 60 pull requests merged here by November 2026,
#            the largest quarter had diffs above about 160000 bytes. No
#            timeout was there to calibrate on: the 29 codex reviews
#            measured, all at medium effort on prompts of 9 to 19 kB with no
#            diff embedded, answered in 22 to 96 seconds. On the direct
#            launch `long` is one attempt of twice --deadline, with no retry.
#            That launch hands codex the prompt as one argument, which Linux
#            caps at 131072 bytes with 4 kB pages: a longer prompt is `failed`
#            at launch whatever the budget, and --base, unlike
#            --evidence-base, keeps the diff out of the prompt.
#
#            Where `peer-review-run` is on PATH it is run exactly once, in the
#            foreground: give this call a tool wait of at least 570 seconds.
#            Otherwise, or where its passed/issues result names no readable
#            review file, codex and claude are launched directly, detached,
#            and `run` answers `outcome=launched` at once; muse has no direct
#            launch and is `unavailable` without the helper. A launch that
#            fails its identity handoff started no provider: it answers
#            `failed` and exits 0. A launch that cannot be recorded is stopped
#            again before `run` answers.
#
# collect    After `outcome=launched`: wait up to --wait seconds (default 520)
#            for the detached provider. `outcome=pending` means it is still
#            running inside its deadline (--deadline on `run`, default 720
#            seconds per attempt, doubled for the one attempt of a long
#            budget): call `collect` again. At the deadline the
#            provider is stopped (TERM, up to ten seconds, KILL, up to ten
#            more), each signal sent only to a PID whose /proc start time
#            still matches the one recorded at launch. On a short budget a
#            timeout or a crash is retried once, in a fresh attempt directory,
#            only after the first provider is confirmed dead. A detached provider leaves no exit
#            status, so a crash is one that left an error line on stderr; one
#            that left nothing at all is `forfeited` with `empty output`.
#            Only that one PID is ever signalled and proved dead: no process
#            group, no supervisor, and no promise about its descendants.
#
# record     What became of the launches of one round. Every attempt directory
#            holds `peer.record`: `outcome=started` from before anything is
#            launched, replaced by each answer `run` and `collect` give for
#            that attempt, or by `outcome=failed` with the message where the
#            script itself fails after that, with `round=` where `run` was
#            given --round.
#            `record` prints one block of those lines per attempt under
#            --artifact-root (or for the one --artifact-dir), each ending in
#            its `artifact_dir=`, an empty line between blocks, narrowed to
#            one --round or --provider where given. With no such attempt it
#            answers `outcome=not-launched`. So `started` is a launch that was
#            cut off before it answered, and `not-launched` is no launch at
#            all; neither is a review outcome. Writing the record is best
#            effort: a failure is one line on stderr and changes no answer.
#
# Output: `key=value` lines on stdout, `outcome=` first, then `reason=` (the
# helper's reason verbatim; on the direct launch the provider's own diagnostic,
# or exactly `empty output` / `garbled output`; whole whatever its length, a
# line break or tab in it written as a space), `provider=`, `path=helper` or
# `path=manual`, and where they apply `fallback_reason=`, `attempt=`,
# `review_file=` (the peer's full review as plain text, for passed/issues),
# `model=`, `effort=`, `strength_pin=held|differs`, `evidence=proved|unproved`,
# `budget=short|long`, `prompt_bytes=`, `diff_bytes=`, `basis=stated|unstated` (on `passed`
# only: whether the review carries a `CHECKED:` line saying what it looked at;
# the outcome is `passed` either way), `round=`, `pid=`, `prompt_file=` and, on
# a `run` given --artifact-root, `artifact_dir=`.
#
# The review outcomes are passed, issues, unavailable, timeout, forfeited and
# failed. Only passed and issues carry a review; none of the six blocks the
# caller. The verdict is read from the review text on both paths, by the rule
# `peer-review-run` applies: a verdict line naming issues decides wherever it
# stands, and a pass counts only unquoted, outside code, with no issue word
# after it. A review with no such line is forfeited (`garbled output`, or
# `empty output` for an empty one), also where the helper called it a pass.
# What the helper called issues stays issues, with its review, unless the
# review file is empty. A passed review whose evidence proof is missing or
# wrong becomes forfeited with reason `diff evidence unreadable or proof
# absent`; an issues review keeps its outcome and takes that reason.
#
# Exit status: 0 for every outcome above; 3 when a provider this script
# launched could not be proved dead (`outcome=failed`, `teardown=survivor`,
# `pid=`): stop and ask the operator, start nothing else; 1 when the script
# itself failed before it could classify anything; 64 on a usage error.
#
# Needs jq to read a `peer-review-run` or claude result (without it codex is
# launched directly), and Linux /proc for the direct launch. Written for bash
# 3.2 and later.
set -u
umask 077

EFFORT=medium
BUDGET_SHORT="--timeout 260"
BUDGET_LONG="--timeout 540 --attempts 1"
LONG_BYTES=150000
DEADLINE_DEFAULT=720
# The stop (20 s) and the retry handoff (5 s, 10 s more to abort it) can follow
# the last poll, and the sum has to fit the caller's 570-second tool wait.
WAIT_DEFAULT=520
SCHEMA='powbox.peer-review-run/v1'
HELPER_ABSENT='peer-review-run absent from PATH'
UNUSABLE_REVIEW='helper result carried no usable reviewFile'
JQ_ABSENT='jq absent from PATH, so no peer-review-run result could be read'
PROOF_ABSENT='diff evidence unreadable or proof absent'
PEER_PROC_ROOT=/proc
POLL="${REVIEW_CYCLE_PEER_POLL_SECONDS:-2}"
SELF="${BASH_SOURCE[0]}"

note() { printf 'peer: %s\n' "$*" >&2; }
usage() {
	note "$*"
	awk '/^# Usage:/ { on = 1 } on && /^#$/ { exit } on { sub(/^# ?/, ""); print }' "$SELF" >&2
	exit 64
}
die() {
	note "$*"
	[ -z "${RECORD:-}" ] || record_put "$(emit_lines failed "$*")"
	exit 1
}
oneline() { printf '%s' "$1" | tr '\n\r\t' '   '; }
is_count() {
	case "$1" in '' | *[!0-9]*) return 1 ;; esac
	[ "$1" -gt 0 ] 2>/dev/null
}

PROVIDER="" WORKTREE="" ADIR="" AROOT="" FACTS="" PROMPT_SRC="" EVIDENCE_BASE="" BASE=""
DEADLINE="$DEADLINE_DEFAULT" WAIT="$WAIT_DEFAULT" BUDGET_ARG=auto ROUND="" RECORD=""
R_PATH="" R_FALLBACK="" R_ATTEMPT="" R_REVIEW="" R_MODEL="" R_EFFORT="" R_PIN="" R_EVIDENCE="" R_PID="" R_TEARDOWN=""
R_BUDGET="" R_BYTES="" R_DIFF="" R_BASIS=""

emit_lines() { # <outcome> <reason>
	printf 'outcome=%s\n' "$1"
	printf 'reason=%s\n' "$(oneline "$2")"
	[ -z "$PROVIDER" ] || printf 'provider=%s\n' "$PROVIDER"
	[ -z "$R_PATH" ] || printf 'path=%s\n' "$R_PATH"
	[ -z "$R_FALLBACK" ] || printf 'fallback_reason=%s\n' "$R_FALLBACK"
	[ -z "$R_ATTEMPT" ] || printf 'attempt=%s\n' "$R_ATTEMPT"
	[ -z "$R_REVIEW" ] || printf 'review_file=%s\n' "$R_REVIEW"
	[ -z "$R_MODEL" ] || printf 'model=%s\n' "$R_MODEL"
	[ -z "$R_EFFORT" ] || printf 'effort=%s\n' "$R_EFFORT"
	[ -z "$R_PIN" ] || printf 'strength_pin=%s\n' "$R_PIN"
	[ -z "$R_EVIDENCE" ] || printf 'evidence=%s\n' "$R_EVIDENCE"
	[ -z "$R_BUDGET" ] || printf 'budget=%s\n' "$R_BUDGET"
	[ -z "$R_BYTES" ] || printf 'prompt_bytes=%s\n' "$R_BYTES"
	[ -z "$R_DIFF" ] || printf 'diff_bytes=%s\n' "$R_DIFF"
	[ -z "$R_BASIS" ] || printf 'basis=%s\n' "$R_BASIS"
	[ -z "$ROUND" ] || printf 'round=%s\n' "$ROUND"
	[ -z "$R_TEARDOWN" ] || printf 'teardown=%s\n' "$R_TEARDOWN"
	[ -z "$R_PID" ] || printf 'pid=%s\n' "$R_PID"
	[ -z "$ADIR" ] || [ ! -f "$ADIR/peer-review.prompt" ] || printf 'prompt_file=%s\n' "$ADIR/peer-review.prompt"
	[ -z "$AROOT" ] || [ -z "$ADIR" ] || printf 'artifact_dir=%s\n' "$ADIR"
}

# The record is a copy of an answer and never part of one: where it cannot be
# written the answer still stands, so a full disk cannot turn a review into a
# failure.
record_put() { # <answer lines>
	[ -n "$RECORD" ] || return 0
	{ printf '%s\n' "$1" >"$RECORD.new" && mv -f "$RECORD.new" "$RECORD"; } 2>/dev/null || note "cannot write $RECORD"
}

emit() { # <outcome> <reason>
	local text
	text="$(emit_lines "$@")"
	printf '%s\n' "$text"
	record_put "$text"
}

# What differs per provider: the helper's attempt budget before the review's
# size is known (muse gets one long attempt at any size, because a retry would
# start a slow review over inside the same wait),
# the model pin (codex and muse expose no stable alias to name), and whether a
# direct launch exists.
provider_setup() {
	case "$PROVIDER" in
	codex) BUDGET="--timeout 260" MODEL="" MANUAL=1 ;;
	claude) BUDGET="--timeout 260" MODEL=opus MANUAL=1 ;;
	muse) BUDGET="--timeout 540 --attempts 1" MODEL="" MANUAL=0 ;;
	'') usage "--provider <codex|claude|muse> is required" ;;
	*) usage "unknown provider: $PROVIDER (codex, claude or muse)" ;;
	esac
}

# The same signals `peer-review-run` classifies as an unavailable peer, applied
# only to what the provider itself reported as an error, never to the transcript
# it echoes on stderr.
ERROR_LINE_RE='^[^[:alnum:]]*(error|fatal|panic)|: not found$|argument list too long'
UNAVAILABLE_RE='not (logged|signed) ?in|missing [a-z]+ credentials|please (run )?[^ ]*login|log ?in (again|required)|re-?authenticate|unauthorized|(^|[^0-9])401([^0-9]|$)|(^|[^0-9])429([^0-9]|$)|usage limit|rate.?limit|too many requests|quota (exceeded|exhausted|reached)|(credits?|usage|balance) (exhausted|exceeded|depleted)|insufficient (quota|credit)'

# --- preflight ---------------------------------------------------------------

probe() { # <command...>: sets PROBE_RC and PROBE_OUT (first non-empty line)
	local out
	out="$("$@" 2>&1 </dev/null)"
	PROBE_RC=$?
	PROBE_OUT="$(printf '%s\n' "$out" | awk 'NF { print; exit }')"
}

cmd_preflight() {
	provider_setup
	if ! command -v "$PROVIDER" >/dev/null 2>&1; then
		if [ "$PROVIDER" = muse ]; then emit absent 'missing binary'; else emit unavailable 'missing binary'; fi
		return 0
	fi
	case "$PROVIDER" in
	codex)
		probe codex login status
		if [ "$PROBE_RC" = 0 ]; then
			emit available ''
		elif [ -n "${CODEX_API_KEY:-}" ]; then
			emit deferred 'codex login status failed while CODEX_API_KEY is set'
		else
			emit unavailable "${PROBE_OUT:-codex login status exited $PROBE_RC}"
		fi
		;;
	claude)
		probe claude auth status
		if [ "$PROBE_RC" = 0 ]; then
			emit available ''
		elif [ -n "${ANTHROPIC_API_KEY:-}" ]; then
			emit deferred 'claude auth status failed while ANTHROPIC_API_KEY is set'
		elif printf '%s\n' "$PROBE_OUT" | grep -Eiq "unknown (command|option|argument)|unrecognized|invalid (command|argument)|no such command|is not a .*command"; then
			emit deferred 'this claude has no auth status subcommand'
		else
			emit unavailable "${PROBE_OUT:-claude auth status exited $PROBE_RC}"
		fi
		;;
	muse)
		probe muse usage
		if [ "$PROBE_RC" = 0 ]; then
			emit available ''
		else
			emit unavailable "${PROBE_OUT:-muse usage exited $PROBE_RC}"
		fi
		;;
	esac
	return 0
}

# --- process identity --------------------------------------------------------
# A numeric PID alone is never probed or signalled: it may have been reused. The
# start time (field 22 of /proc/<pid>/stat) is read after stripping everything
# through the final `) `, because the comm field may hold spaces and `)`.

peer_start_time() { # <pid>
	local stat rest
	stat="$(cat "$PEER_PROC_ROOT/$1/stat" 2>/dev/null)" || return 1
	rest="${stat##*) }"
	[ "$rest" != "$stat" ] || return 1
	# shellcheck disable=SC2086 # the fields are split on purpose
	set -- $rest
	[ "$#" -ge 20 ] || return 1
	# A zombie has exited and only awaits its parent: where PID 1 does not reap,
	# it would answer `kill -0` under its old start time for ever.
	[ "$1" != Z ] || return 1
	shift 19
	case "$1" in '' | 0 | *[!0-9]*) return 1 ;; esac
	printf '%s\n' "$1"
}

peer_load_identity() { # <pid file>: sets PEER_PID only when that incarnation is still there
	local pid start extra now value
	PEER_PID=""
	IFS=' ' read -r pid start extra 2>/dev/null <"$1" || return 1
	for value in "$pid" "$start"; do
		case "$value" in '' | 0 | *[!0-9]*) return 1 ;; esac
	done
	[ -z "$extra" ] || return 1
	now="$(peer_start_time "$pid")" || return 1
	[ "$now" = "$start" ] || return 1
	PEER_PID="$pid"
}

peer_alive() { # <pid file>
	peer_load_identity "$1" && kill -0 "$PEER_PID" 2>/dev/null
}

peer_signal() { # <signal> <pid file>
	peer_load_identity "$2" && kill "-$1" "$PEER_PID" 2>/dev/null
}

peer_stop() { # <pid file>: 0 only when the recorded incarnation is proved gone
	peer_signal TERM "$1" || :
	for _ in 1 2 3 4 5 6 7 8 9 10; do
		peer_alive "$1" || break
		sleep 1
	done
	if peer_alive "$1"; then
		peer_signal KILL "$1" || :
	fi
	for _ in 1 2 3 4 5 6 7 8 9 10; do
		peer_alive "$1" || break
		sleep 1
	done
	! peer_alive "$1"
}

# A launch whose identity file never became valid. The wrapper writes that file
# before it execs the provider, so no provider is running; what may be left is
# the wrapper itself, a fresh direct child of this shell. TERM and KILL go to it
# back to back at this boundary and later checks only probe.
peer_abort_unhanded() { # <child pid>
	kill -TERM "$1" 2>/dev/null || :
	kill -KILL "$1" 2>/dev/null || :
	for _ in 1 2 3 4 5 6 7 8 9 10; do
		kill -0 "$1" 2>/dev/null || return 0
		sleep 1
	done
	return 1
}

# --- prompt and evidence -----------------------------------------------------

# Either budget fits the caller's 570-second wait by the helper's own sum,
# attempts x (timeout + 5) + 10: 540 seconds for short and 555 for long.
# A size that cannot be measured counts as nothing, which leaves the provider's
# own budget in place.
choose_budget() { # sets BUDGET, R_BUDGET, R_BYTES and, under --base, R_DIFF
	local base_oid
	R_BYTES="$({ wc -c <"$ADIR/peer-review.prompt" | tr -d ' '; } 2>/dev/null)"
	if [ -n "$BASE" ] && base_oid="$(git -C "$WORKTREE" rev-parse --verify --quiet "$BASE^{commit}" 2>/dev/null)" &&
		git -C "$WORKTREE" merge-base "$base_oid" HEAD >/dev/null 2>&1; then
		R_DIFF="$({ git -C "$WORKTREE" diff "$base_oid...HEAD" | wc -c | tr -d ' '; } 2>/dev/null)"
	fi
	case "$BUDGET_ARG" in
	short) BUDGET="$BUDGET_SHORT" ;;
	long) BUDGET="$BUDGET_LONG" ;;
	*) [ "$((${R_BYTES:-0} + ${R_DIFF:-0}))" -le "$LONG_BYTES" ] || BUDGET="$BUDGET_LONG" ;;
	esac
	R_BUDGET=short
	if [ "$BUDGET" = "$BUDGET_LONG" ]; then
		R_BUDGET=long DEADLINE=$((DEADLINE * 2))
	fi
}

resolve_dirs() {
	local flag=--artifact-dir given="$ADIR"
	[ -z "$AROOT" ] || flag=--artifact-root given="$AROOT"
	case "$given" in /*) ;; *) usage "$flag must be an absolute path" ;; esac
	case "$WORKTREE" in /*) ;; *) usage "--worktree must be an absolute path" ;; esac
	[ -d "$WORKTREE" ] || usage "--worktree is not a directory: $WORKTREE"
	case "$given/" in */../*) usage "$flag must not contain a .. component" ;; esac
	local wt ad there="$given" rest=""
	wt="$(cd -P -- "$WORKTREE" && pwd)" || die "cannot enter $WORKTREE"
	# Judged before anything is created, from the deepest directory that exists.
	while [ ! -d "$there" ]; do
		rest="/${there##*/}$rest" there="${there%/*}"
		[ -n "$there" ] || there=/
	done
	ad="$(cd -P -- "$there" && pwd)" || die "cannot enter $there"
	case "${ad%/}$rest/" in "$wt"/*) usage "$flag must be outside the reviewed worktree" ;; esac
	mkdir -p "$given" || die "cannot create $given"
	ad="$(cd -P -- "$given" && pwd)" || die "cannot enter $given"
	if [ -n "$AROOT" ]; then
		ad="$(mktemp -d "${ad%/}/peer-run.XXXXXX")" || die "cannot create an attempt directory under $AROOT"
	fi
	WORKTREE="$wt" ADIR="$ad"
	[ ! -e "$ADIR/peer-review.prompt" ] || usage "--artifact-dir already holds a peer run: give each attempt a directory of its own"
}

write_prompt() { # 0, or 1 with EVIDENCE_ERROR set when the evidence could not be rendered
	local prompt="$ADIR/peer-review.prompt" brief evidence="$ADIR/diff-evidence.txt" base_oid tip_oid
	EVIDENCE_ERROR=""
	if [ -n "$PROMPT_SRC" ]; then
		cat -- "$PROMPT_SRC" >"$prompt" || die "cannot write $prompt"
		return 0
	fi
	brief="$(dirname -- "$SELF")/peer-brief.md"
	[ -s "$brief" ] || die "peer-brief.md is missing beside $SELF"
	if [ -z "$EVIDENCE_BASE" ]; then
		{ cat -- "$brief" && printf '\n' && cat -- "$FACTS"; } >"$prompt" || die "cannot write $prompt"
		return 0
	fi
	base_oid="$(git -C "$WORKTREE" rev-parse --verify --quiet "$EVIDENCE_BASE^{commit}")" || {
		EVIDENCE_ERROR="diff evidence could not be rendered: $EVIDENCE_BASE names no commit"
		return 1
	}
	tip_oid="$(git -C "$WORKTREE" rev-parse --verify --quiet 'HEAD^{commit}')" || {
		EVIDENCE_ERROR="diff evidence could not be rendered: HEAD names no commit"
		return 1
	}
	if ! {
		git -C "$WORKTREE" log --oneline "$base_oid..$tip_oid" &&
			git -C "$WORKTREE" diff "$base_oid...$tip_oid"
	} >"$evidence" 2>/dev/null || ! chmod 400 "$evidence"; then
		EVIDENCE_ERROR="diff evidence could not be rendered: git log or git diff failed"
		return 1
	fi
	printf '%s %s\n' "$base_oid" "$tip_oid" >"$ADIR/evidence.oids" || die "cannot write $ADIR/evidence.oids"
	{
		cat -- "$brief" && cat <<'PEER_PROMPT' && cat -- "$FACTS" &&

The generated review data below ends with an embedded git evidence section: the commit log and the complete diff of the change, between the lines `BEGIN EMBEDDED GIT EVIDENCE` and `END EMBEDDED GIT EVIDENCE`.
Inspect that section before rendering your verdict; you need no other access to the diff.
Directly after your verification statement, copy these three proof lines into your final response: `EVIDENCE_BASE_OID: <full OID>` and `EVIDENCE_TIP_OID: <full OID>`, taken from the `Effective base OID` and `Review tip OID` lines of the data, and `EVIDENCE_TOKEN: <token>`, an exact distinctive non-whitespace token from an added or removed diff line that occurs exactly once between the evidence markers.

BEGIN GENERATED REVIEW DATA
PEER_PROMPT
			printf -- '%s\n' "Effective base OID: $base_oid" "Review tip OID: $tip_oid" 'BEGIN EMBEDDED GIT EVIDENCE' &&
			cat -- "$evidence" &&
			printf -- '%s\n' 'END EMBEDDED GIT EVIDENCE' 'END GENERATED REVIEW DATA'
	} >"$prompt" || die "cannot write $prompt"
}

proof_value() { # <review file> <label>: the first such line's value, one pair of backticks dropped
	awk -v label="$2: " 'index($0, label) == 1 { v = substr($0, length(label) + 1); sub(/[ \t\r]+$/, "", v); if (v ~ /^`.*`$/) v = substr(v, 2, length(v) - 2); print v; exit }' "$1"
}

proof_holds() { # <review file>
	local base_oid tip_oid token
	IFS=' ' read -r base_oid tip_oid 2>/dev/null <"$ADIR/evidence.oids" || return 1
	[ -n "$base_oid" ] && [ -n "$tip_oid" ] || return 1
	[ "$(proof_value "$1" EVIDENCE_BASE_OID)" = "$base_oid" ] || return 1
	[ "$(proof_value "$1" EVIDENCE_TIP_OID)" = "$tip_oid" ] || return 1
	token="$(proof_value "$1" EVIDENCE_TOKEN)"
	case "$token" in '' | *[[:space:]]*) return 1 ;; esac
	PEER_TOKEN="$token" awk '
		BEGIN { t = ENVIRON["PEER_TOKEN"] }
		{
			s = $0; hit = 0
			while ((i = index(s, t)) > 0) { n++; hit = 1; s = substr(s, i + length(t)) }
			if (hit && $0 ~ /^[+-]/ && $0 !~ /^(\+\+\+|---)( |$)/) changed++
		}
		END { exit !(n == 1 && changed == 1) }' "$ADIR/diff-evidence.txt"
}

# The one verdict rule, for both paths; it follows `peer-review-run`. A verdict
# line naming issues decides wherever it stands, quoted or not, because reading
# one too many can never pass a review. A pass counts only on a line of its own
# outside fenced and indented code, behind no quote marker, as a whole word with
# no issue word after it ("no issues" aside).
verdict_of() { # <review file>: prints passed or issues, or nothing where no line decides
	awk '
		BEGIN {
			# The blanks [[:space:]] matches in peer-review-run, spelt out for
			# awks without character classes.
			b = " \t\r\f\v"
			lead = "^[" b ">*#`-]*verdict[" b "]*[:=][" b "]*"
			plain = "^[" b "*#-]*verdict[" b "]*[:=][" b "]*"
			issue = "(issues?|changes?|blocking|block|reject|rejected|fail|failed|request[" b "_-]*changes?)"
			pass = "(passed|pass|approved|approve|lgtm|no[" b "_-]*issues?)"
			nw = "[^a-z0-9_]"
			quote = "^>[" b "]*"
			marker = "^([*+-]|[0-9]+[.)])[" b "]*"
		}
		{
			l = tolower($0)
			sub(/\r$/, "", l)
			if (l ~ (lead issue)) { v = "issues"; exit }
			s = l
			sub("^[" b "]*", "", s)
			depth = 0
			while (match(s, quote)) { depth++; s = substr(s, RLENGTH + 1) }
			if (fence != "") {
				# Closed only by a longer-or-equal run of the same character, alone
				# on its line, at the quote depth the fence opened at.
				run = ""
				if (match(s, /^`+/) || match(s, /^~+/)) run = substr(s, 1, RLENGTH)
				tail = substr(s, length(run) + 1)
				sub("[" b "]+$", "", tail)
				if (depth == fdepth && length(run) >= flen && substr(run, 1, 1) == fence && tail == "") fence = ""
				next
			}
			while (sub(marker, "", s)) continue
			run = ""
			if (match(s, /^`+/) || match(s, /^~+/)) run = substr(s, 1, RLENGTH)
			if (length(run) >= 3 && (substr(run, 1, 1) == "~" || index(substr(s, length(run) + 1), "`") == 0)) {
				fence = substr(run, 1, 1); flen = length(run); fdepth = depth
				next
			}
			if ($0 ~ /^(    |\t| \t|  \t|   \t)/) next
			if (l !~ (plain pass "(" nw "|$)")) next
			sub(plain, "", l)
			if (match(l, "^no[" b "_-]*issues?")) l = "pass" substr(l, RLENGTH + 1)
			l = " " l
			gsub(nw "(no|zero|without)([" b "_-]+[a-z0-9]+)?[" b "_-]+(issues?|changes?|blockers?|blocking|problems?|failures?)", " ", l)
			match(l, "^ " pass)
			if (substr(l, RLENGTH + 1) ~ (nw issue "(" nw "|$)")) { v = "issues"; exit }
			v = "passed"
		}
		END { if (v != "") print v }' "$1" 2>/dev/null
}

basis_of() { # <review file>: whether a CHECKED line says anything
	if grep -Eiq '^[[:space:]>*#-]*CHECKED[[:space:]]*:[[:space:]*]*[^[:space:]*]' "$1" 2>/dev/null; then
		printf 'stated\n'
	else
		printf 'unstated\n'
	fi
}

# Report a verdict, applying the evidence proof where this run embedded evidence.
emit_verdict() { # <passed|issues> <reason> <review file>
	local outcome="$1" reason="$2"
	R_REVIEW="$3"
	if [ -f "$ADIR/evidence.oids" ]; then
		if proof_holds "$3"; then
			R_EVIDENCE=proved
		else
			R_EVIDENCE=unproved reason="$PROOF_ABSENT"
			if [ "$outcome" = passed ]; then outcome=forfeited R_REVIEW=""; fi
		fi
	fi
	[ "$outcome" != passed ] || R_BASIS="$(basis_of "$3")"
	emit "$outcome" "$reason"
}

# --- the helper path ---------------------------------------------------------

run_helper() { # returns 0 when it emitted a result, 1 when the direct launch must take over
	local out="$ADIR/peer-review-run.out" err="$ADIR/peer-review-run.stderr" rc last outcome reason review seen
	R_PATH=helper
	# shellcheck disable=SC2086 # BUDGET is a fixed flag list, split on purpose
	if [ -n "$MODEL" ]; then
		peer-review-run --provider "$PROVIDER" --worktree "$WORKTREE" --prompt-file "$ADIR/peer-review.prompt" --artifact-root "$ADIR/peer-review-run" $BUDGET --model "$MODEL" --effort "$EFFORT" >"$out" 2>"$err" </dev/null
	else
		peer-review-run --provider "$PROVIDER" --worktree "$WORKTREE" --prompt-file "$ADIR/peer-review.prompt" --artifact-root "$ADIR/peer-review-run" $BUDGET --effort "$EFFORT" >"$out" 2>"$err" </dev/null
	fi
	rc=$?
	last="$(awk 'NF { l = $0 } END { print l }' "$out" 2>/dev/null)"
	if ! printf '%s' "$last" | jq -e --arg schema "$SCHEMA" 'type == "object" and .schema == $schema and (.outcome | type == "string")' >/dev/null 2>&1; then
		# The helper's own diagnostic is its first `peer-review-run:` line; a
		# usage error follows it with a synopsis that names every flag.
		reason="$(grep -m 1 '^peer-review-run:' "$err" 2>/dev/null)" || reason="$(awk 'NF { l = $0 } END { print l }' "$err" 2>/dev/null)"
		# A helper that predates this provider, or a flag of its launch, answers
		# with a usage error and no result: the provider is unavailable for the
		# run. Any other error is this call's own failure.
		if [ "$MANUAL" = 0 ] && [ "$rc" = 64 ] && printf '%s\n' "$reason" | grep -Eq -- '--provider|--attempts'; then
			emit unavailable "peer-review-run predates this launch: $reason"
		else
			emit failed "peer-review-run exited $rc with no result line${reason:+: $reason}"
		fi
		return 0
	fi
	outcome="$(printf '%s' "$last" | jq -r '.outcome')"
	reason="$(printf '%s' "$last" | jq -r '.reason // ""')"
	review="$(printf '%s' "$last" | jq -r '.reviewFile // ""')"
	R_MODEL="$(printf '%s' "$last" | jq -r '.model | if . == null then "null" else tostring end')"
	R_EFFORT="$(printf '%s' "$last" | jq -r '.effort | if . == null then "null" else tostring end')"
	R_PIN=held
	[ "$R_EFFORT" = "$EFFORT" ] || R_PIN=differs
	[ -z "$MODEL" ] || [ "$R_MODEL" = "$MODEL" ] || R_PIN=differs
	case "$outcome" in
	passed | issues)
		if [ -n "$review" ] && [ -f "$review" ] && [ -r "$review" ]; then
			seen="$(verdict_of "$review")"
			if ! grep -q '[^[:space:]]' "$review" 2>/dev/null; then
				emit forfeited 'empty output'
			elif [ "$outcome" = issues ]; then
				# Its findings reach the caller however this script reads the text.
				emit_verdict issues "$reason" "$review"
			elif [ "$seen" = passed ]; then
				emit_verdict passed "$reason" "$review"
			elif [ "$seen" = issues ]; then
				emit_verdict issues '' "$review"
			else
				emit forfeited 'garbled output'
			fi
		elif [ "$MANUAL" = 1 ]; then
			R_FALLBACK="$UNUSABLE_REVIEW" R_MODEL="" R_EFFORT="" R_PIN=""
			return 1
		else
			emit forfeited "$UNUSABLE_REVIEW"
		fi
		;;
	unavailable | timeout | forfeited | failed) emit "$outcome" "$reason" ;;
	*) emit forfeited "peer-review-run reported an unrecognized outcome: $outcome" ;;
	esac
	return 0
}

# --- the direct launch -------------------------------------------------------

state_get() { sed -n "s/^$1=//p" "$ADIR/manual.state" 2>/dev/null | head -n 1; }
state_put() { # <attempt> <launched at>
	{
		printf 'provider=%s\n' "$PROVIDER"
		printf 'deadline=%s\n' "$DEADLINE"
		printf 'fallback_reason=%s\n' "$R_FALLBACK"
		printf 'attempt=%s\n' "$1"
		printf 'launched_at=%s\n' "$2"
		printf 'worktree=%s\n' "$WORKTREE"
		printf 'effort=%s\n' "$EFFORT"
		printf 'budget=%s\n' "$R_BUDGET"
		printf 'prompt_bytes=%s\n' "$R_BYTES"
		printf 'diff_bytes=%s\n' "$R_DIFF"
		printf 'round=%s\n' "$ROUND"
	} >"$ADIR/manual.state.new" && mv -f "$ADIR/manual.state.new" "$ADIR/manual.state"
}

# Runs detached as the provider's own process: it records its identity and then
# execs the provider, so the recorded PID is the provider and nothing is ever
# running without an identity file. `claude -p` has no working-directory flag,
# so the `cd` is what decides which checkout the peer reads; a failed `cd` ends
# the launch rather than reviewing wherever the caller stood.
# shellcheck disable=SC2016 # a program for `sh -c`, expanded there
LAUNCH_WRAPPER='
pid_file=$1
proc_root=$2
cd -- "$3" || exit 125
shift 3
stat=$(cat "$proc_root/$$/stat" 2>/dev/null) || exit 125
rest=${stat##*) }
[ "$rest" != "$stat" ] || exit 125
start=$(set -- $rest; [ "$#" -ge 20 ] || exit 1; shift 19; printf "%s" "$1") || exit 125
case $start in ""|0|*[!0-9]*) exit 125 ;; esac
printf "%s %s\n" "$$" "$start" > "$pid_file" || exit 125
exec "$@"
'

# 0 launched; 1 not launched and nothing left running (LAUNCH_ERROR says why);
# 3 the launch failed and its process could not be proved dead (R_PID names it,
# LAUNCH_SURVIVED says after what).
launch_manual() { # <attempt>
	local dir="$ADIR/manual-attempt-$1" prompt="$ADIR/peer-review.prompt" child pid start extra gone=0
	LAUNCH_ERROR="" LAUNCH_SURVIVED='a failed launch handoff'
	if ! command -v "$PROVIDER" >/dev/null 2>&1; then
		LAUNCH_ERROR='missing binary'
		return 1
	fi
	mkdir "$dir" || die "cannot create $dir"
	case "$PROVIDER" in
	codex)
		nohup sh -c "$LAUNCH_WRAPPER" peer-launch "$dir/peer-review.pid" "$PEER_PROC_ROOT" "$WORKTREE" \
			codex exec --sandbox read-only --cd "$WORKTREE" -o "$dir/peer-review.out" \
			-c 'mcp_servers={}' -c "model_reasoning_effort=$EFFORT" "$(cat -- "$prompt")" \
			</dev/null >/dev/null 2>"$dir/peer-review.stderr" &
		;;
	claude)
		nohup sh -c "$LAUNCH_WRAPPER" peer-launch "$dir/peer-review.pid" "$PEER_PROC_ROOT" "$WORKTREE" \
			claude -p --model "$MODEL" --effort "$EFFORT" --safe-mode --tools "Read,Glob,Grep" \
			--disallowedTools "mcp__*" --add-dir "$ADIR" --output-format json \
			<"$prompt" >"$dir/peer-review.out" 2>"$dir/peer-review.stderr" &
		;;
	esac
	child=$!
	for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25; do
		pid="" start="" extra=""
		if IFS=' ' read -r pid start extra 2>/dev/null <"$dir/peer-review.pid" && [ "$pid" = "$child" ] && is_count "$start" && [ -z "$extra" ]; then
			if state_put "$1" "$(date +%s)"; then return 0; fi
			# No later `collect` could find this provider, so it is stopped here.
			LAUNCH_ERROR="cannot write $ADIR/manual.state" LAUNCH_SURVIVED='a launch that could not be recorded'
			if peer_stop "$dir/peer-review.pid"; then return 1; fi
			R_PID="$child"
			return 3
		fi
		if ! kill -0 "$child" 2>/dev/null; then
			gone=1
			break
		fi
		sleep 0.2
	done
	LAUNCH_ERROR="peer launch handoff failed before the provider started"
	if [ "$gone" = 1 ] || peer_abort_unhanded "$child"; then
		return 1
	fi
	R_PID="$child"
	return 3
}

emit_survivor() { # <pid> <what still answered>
	R_TEARDOWN=survivor R_PID="$1"
	emit failed "PID $1 $2"
	exit 3
}

start_manual() { # <attempt>: emits `launched`, or the outcome of a launch that did not start
	local rc
	R_PATH=manual R_ATTEMPT="$1"
	launch_manual "$1"
	rc=$?
	case "$rc" in
	0) emit launched '' ;;
	3) emit_survivor "$R_PID" "survived TERM and KILL after $LAUNCH_SURVIVED" ;;
	*) if [ "$LAUNCH_ERROR" = 'missing binary' ]; then emit unavailable "$LAUNCH_ERROR"; else emit failed "$LAUNCH_ERROR"; fi ;;
	esac
}

# Classify a provider that is confirmed dead, from what it left behind. Sets
# C_OUTCOME, C_REASON and C_REVIEW.
classify_dead() { # <attempt dir> <timed out: 0|1>
	local dir="$1" out="$1/peer-review.out" err="$1/peer-review.stderr" text="" garbled=0 errored=0 diag
	C_OUTCOME="" C_REASON="" C_REVIEW=""
	# What the provider itself reported as an error: the error-shaped lines of
	# its last stderr, and a claude error result.
	diag="$dir/diagnostic.txt"
	tail -n 20 "$err" 2>/dev/null | grep -Ei -- "$ERROR_LINE_RE" >"$diag" || :
	case "$PROVIDER" in
	codex) text="$out" ;;
	claude)
		if [ -s "$out" ]; then
			if jq -e 'type == "object" and .type == "result"' "$out" >/dev/null 2>&1; then
				text="$dir/review.txt"
				jq -r '.result // "" | tostring' "$out" >"$text"
				if jq -e '.is_error == true' "$out" >/dev/null 2>&1; then
					errored=1
					cat "$text" >>"$diag"
				fi
			else
				garbled=1
			fi
		fi
		;;
	esac
	if [ "$errored" = 0 ] && [ -n "$text" ] && [ -s "$text" ]; then
		C_OUTCOME="$(verdict_of "$text")"
		if [ -n "$C_OUTCOME" ]; then
			C_REVIEW="$text"
			return 0
		fi
	fi
	if [ "$2" = 1 ]; then
		C_OUTCOME=timeout C_REASON="no verdict within $(state_get deadline) seconds"
	elif C_REASON="$(grep -Ei -m 1 -- "$UNAVAILABLE_RE" "$diag" 2>/dev/null)"; then
		C_OUTCOME=unavailable
	elif [ "$errored" = 1 ]; then
		C_OUTCOME=failed C_REASON="$(awk 'NF { print; exit }' "$text")"
	elif [ "$garbled" = 1 ] || { [ -n "$text" ] && grep -q '[^[:space:]]' "$text" 2>/dev/null; }; then
		C_OUTCOME=forfeited C_REASON='garbled output'
	elif [ -s "$diag" ]; then
		C_OUTCOME=failed C_REASON="$(head -n 1 "$diag")"
	else
		C_OUTCOME=forfeited C_REASON='empty output'
	fi
}

cmd_run() {
	provider_setup
	[ -n "$WORKTREE" ] || usage "--worktree <abs dir> is required"
	if [ -n "$AROOT" ] && [ -n "$ADIR" ]; then usage "give --artifact-root or --artifact-dir, not both"; fi
	[ -n "$AROOT$ADIR" ] || usage "give --artifact-root <abs dir> or --artifact-dir <abs dir>"
	if [ -n "$FACTS" ] && [ -n "$PROMPT_SRC" ]; then usage "give --facts or --prompt-file, not both"; fi
	[ -n "$FACTS$PROMPT_SRC" ] || usage "give --facts <file> or --prompt-file <file>"
	[ -s "$FACTS$PROMPT_SRC" ] || usage "not a readable, non-empty file: $FACTS$PROMPT_SRC"
	if [ -n "$EVIDENCE_BASE" ] && [ -z "$FACTS" ]; then usage "--evidence-base needs --facts"; fi
	if [ -n "$EVIDENCE_BASE" ] && [ -n "$BASE" ]; then usage "give --evidence-base or --base, not both: embedded evidence is measured in the prompt"; fi
	if [ "$PROVIDER" = claude ] && [ -z "$EVIDENCE_BASE" ]; then usage "--provider claude needs --evidence-base <ref>: its read-only tools cannot run git"; fi
	is_count "$DEADLINE" || usage "--deadline needs a positive number of seconds"
	case "$EFFORT" in
	low | medium | high | xhigh) ;;
	max) [ "$PROVIDER" != codex ] || usage "--effort max is not offered by codex" ;;
	*) usage "--effort is low, medium, high, xhigh or max" ;;
	esac
	case "$BUDGET_ARG" in auto | short | long) ;; *) usage "--budget is auto, short or long" ;; esac
	[ -z "$ROUND" ] || is_count "$ROUND" || usage "--round needs a positive number"
	resolve_dirs
	RECORD="$ADIR/peer.record"
	record_put "$(emit_lines started '')"
	if ! write_prompt; then
		emit forfeited "$EVIDENCE_ERROR"
		return 0
	fi
	choose_budget
	if command -v peer-review-run >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
		if run_helper; then return 0; fi
	elif command -v peer-review-run >/dev/null 2>&1; then
		[ "$PROVIDER" = codex ] || die "jq is required to read the $PROVIDER result"
		R_FALLBACK="$JQ_ABSENT"
	elif [ "$MANUAL" = 1 ]; then
		R_FALLBACK="$HELPER_ABSENT"
	else
		emit unavailable "$HELPER_ABSENT"
		return 0
	fi
	if [ "$PROVIDER" = claude ]; then
		command -v jq >/dev/null 2>&1 || die "jq is required to read the claude result"
	fi
	start_manual 1
}

cmd_collect() {
	[ -z "$AROOT" ] || usage "collect takes --artifact-dir: the artifact_dir run answered"
	[ -n "$ADIR" ] || usage "--artifact-dir <abs dir> is required"
	is_count "$WAIT" || usage "--wait needs a positive number of seconds"
	if [ -f "$ADIR/manual.result" ]; then
		cat "$ADIR/manual.result"
		return 0
	fi
	[ -f "$ADIR/manual.state" ] || usage "no direct launch is recorded in $ADIR: collect follows a launched answer from run"
	PROVIDER="$(state_get provider)" DEADLINE="$(state_get deadline)" WORKTREE="$(state_get worktree)"
	R_FALLBACK="$(state_get fallback_reason)" R_PATH=manual
	R_BUDGET="$(state_get budget)" R_BYTES="$(state_get prompt_bytes)" R_DIFF="$(state_get diff_bytes)" ROUND="$(state_get round)"
	EFFORT="$(state_get effort)"
	[ -n "$EFFORT" ] || EFFORT=medium
	provider_setup
	is_count "$DEADLINE" || die "$ADIR/manual.state is damaged"
	RECORD="$ADIR/peer.record"
	local attempt launched_at dir pid_file now waited_until timed rc
	waited_until=$(($(date +%s) + WAIT))
	while :; do
		attempt="$(state_get attempt)" launched_at="$(state_get launched_at)"
		if ! is_count "$attempt" || ! is_count "$launched_at"; then die "$ADIR/manual.state is damaged"; fi
		dir="$ADIR/manual-attempt-$attempt" pid_file="$ADIR/manual-attempt-$attempt/peer-review.pid"
		R_ATTEMPT="$attempt" timed=0
		if peer_alive "$pid_file"; then
			now="$(date +%s)"
			if [ "$now" -ge $((launched_at + DEADLINE)) ]; then
				if ! peer_stop "$pid_file"; then
					emit_survivor "$PEER_PID" "still answered kill -0 after TERM and KILL"
				fi
				timed=1
			elif [ "$now" -ge "$waited_until" ]; then
				emit pending ''
				return 0
			else
				sleep "$POLL"
				continue
			fi
		fi
		classify_dead "$dir" "$timed"
		case "$C_OUTCOME" in
		timeout | failed)
			if [ "$attempt" = 1 ] && [ "$R_BUDGET" != long ]; then
				launch_manual 2
				rc=$?
				if [ "$rc" = 0 ]; then continue; fi
				R_ATTEMPT=2
				if [ "$rc" = 3 ]; then emit_survivor "$R_PID" "survived TERM and KILL after $LAUNCH_SURVIVED"; fi
				C_OUTCOME=failed C_REASON="$LAUNCH_ERROR"
			fi
			;;
		esac
		break
	done
	case "$C_OUTCOME" in
	passed | issues)
		[ "$PROVIDER" != claude ] || R_MODEL="$MODEL"
		R_EFFORT="$EFFORT"
		emit_verdict "$C_OUTCOME" '' "$C_REVIEW" >"$ADIR/manual.result.new"
		;;
	*) emit "$C_OUTCOME" "$C_REASON" >"$ADIR/manual.result.new" ;;
	esac
	mv -f "$ADIR/manual.result.new" "$ADIR/manual.result" || die "cannot write $ADIR/manual.result"
	cat "$ADIR/manual.result"
}

cmd_record() {
	local f found=0
	if [ -n "$AROOT" ] && [ -n "$ADIR" ]; then usage "give --artifact-root or --artifact-dir, not both"; fi
	[ -n "$AROOT$ADIR" ] || usage "give --artifact-root <abs dir> or --artifact-dir <abs dir>"
	[ -z "$ROUND" ] || is_count "$ROUND" || usage "--round needs a positive number"
	[ -z "$PROVIDER" ] || provider_setup
	if [ -n "$ADIR" ]; then set -- "$ADIR/peer.record"; else set -- "$AROOT"/peer-run.*/peer.record; fi
	for f in "$@"; do
		[ -f "$f" ] || continue
		[ -z "$ROUND" ] || [ "$(sed -n 's/^round=//p' "$f" | head -n 1)" = "$ROUND" ] || continue
		[ -z "$PROVIDER" ] || [ "$(sed -n 's/^provider=//p' "$f" | head -n 1)" = "$PROVIDER" ] || continue
		[ "$found" = 0 ] || printf '\n'
		found=1
		grep -v '^artifact_dir=' "$f"
		printf 'artifact_dir=%s\n' "${f%/peer.record}"
	done
	[ "$found" = 1 ] || ADIR="" emit_lines not-launched ''
}

main() {
	local command="${1:-}"
	[ $# -eq 0 ] || shift
	case "$command" in
	-h | --help | help)
		awk 'NR > 1 && !/^#/ { exit } NR > 1 { sub(/^# ?/, ""); print }' "$SELF"
		exit 0
		;;
	preflight | run | collect | record) ;;
	'') usage "name a command: preflight, run, collect or record" ;;
	*) usage "unknown command: $command" ;;
	esac
	while [ $# -gt 0 ]; do
		case "$1" in
		-h | --help)
			awk 'NR > 1 && !/^#/ { exit } NR > 1 { sub(/^# ?/, ""); print }' "$SELF"
			exit 0
			;;
		--provider | --worktree | --artifact-root | --artifact-dir | --facts | --prompt-file | --evidence-base | --base | --effort | --budget | --round | --deadline | --wait)
			[ $# -ge 2 ] || usage "$1 needs a value"
			case "$1" in
			--provider) PROVIDER="$2" ;;
			--worktree) WORKTREE="$2" ;;
			--artifact-root) AROOT="$2" ;;
			--artifact-dir) ADIR="$2" ;;
			--facts) FACTS="$2" ;;
			--prompt-file) PROMPT_SRC="$2" ;;
			--evidence-base) EVIDENCE_BASE="$2" ;;
			--base) BASE="$2" ;;
			--effort) EFFORT="$2" ;;
			--budget) BUDGET_ARG="$2" ;;
			--round) ROUND="$2" ;;
			--deadline) DEADLINE="$2" ;;
			--wait) WAIT="$2" ;;
			esac
			shift 2
			;;
		*) usage "unknown argument: $1" ;;
		esac
	done
	"cmd_$command"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
	main "$@"
fi
