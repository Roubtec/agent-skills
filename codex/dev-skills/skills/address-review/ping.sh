#!/usr/bin/env bash
# ping.sh — summon a fresh review round on a pull request, one reviewer at a time.
#
# Usage:
#   ping.sh --repo <owner>/<repo> --pr <N> <codex|claude|copilot>...
#
# `<owner>/<repo>` is the repository the PR is in, read from the PR's own URL;
# write it `<host>/<owner>/<repo>` where that is not github.com.
#
# Each reviewer named is summoned by its own action, in the order given:
#   codex, claude  a dedicated top-level comment, `@codex review` or
#                  `@claude review`, and nothing else in it
#   copilot        a review request (`gh pr edit --add-reviewer @copilot`),
#                  never an `@copilot review` comment: that mention drives
#                  Copilot's coding agent, which can start editing the branch
# and answers with one line:
#   pinged=<reviewer> TAB <comment url | review_requested event id>
#   unconfirmed=copilot
#                  the request was accepted, but no new `review_requested`
#                  event for Copilot has shown on the PR's timeline yet. The
#                  timeline is eventually consistent: record it as unconfirmed
#                  and do not issue the request again.
#   skipped=copilot TAB <reason>
#                  this gh is older than 2.88.0, which cannot make the request.
#                  Nothing was asked: upgrade gh, or re-request from the PR's
#                  web reviewer menu.
#   failed=<reviewer> TAB <reason>
#                  gh refused the comment or the request
# under `outcome=done` when every reviewer named was pinged, and
# `outcome=partial` (exit 3) otherwise. A reviewer that was not pinged never
# stops the ones after it.
#
# The Copilot request is confirmed from the timeline, by identity: the ids of
# the `review_requested` events naming Copilot are read before the request, and
# an event that is not among them afterwards is this one. Nothing is compared
# against a clock, and `reviewRequests` is not read: it comes back empty on a
# request that succeeded.
#
# It posts nothing but these pings. Whether to ping at all (only after a push
# that advanced the branch) and whom (the contributing set) is the caller's.
#
# Output: `key=value` lines on stdout, `outcome=` first. Exit status: 0 done,
# 3 partial, 64 on a usage error. Needs gh. Written for bash 3.2 and later.
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
TRIES="${PING_CONFIRM_TRIES:-5}"
POLL="${PING_POLL_SECONDS:-3}"

note() { printf 'ping: %s\n' "$*" >&2; }
usage() {
	note "$*"
	sed -n '4,5p' "$SELF" | sed 's/^# \{0,1\}//' >&2
	exit 64
}

REPO="" PR="" BOTS=""
while [ $# -gt 0 ]; do
	case "$1" in
	--repo | --pr)
		[ $# -ge 2 ] || usage "$1 needs a value"
		if [ "$1" = --repo ]; then REPO="$2"; else PR="$2"; fi
		shift 2
		;;
	-h | --help | help)
		awk 'NR > 1 && !/^#/ { exit } NR > 1 { sub(/^# ?/, ""); print }' "$SELF"
		exit 0
		;;
	codex | claude | copilot)
		case " $BOTS " in
		*" $1 "*) ;;
		*) BOTS="$BOTS $1" ;;
		esac
		shift
		;;
	*) usage "unknown argument: $1 (the reviewers are codex, claude and copilot)" ;;
	esac
done
case "$REPO" in
?*/?*) ;;
*) usage "--repo <owner>/<repo> is required (the repository the PR is in)" ;;
esac
case "$PR" in
'' | *[!0-9]*) usage "--pr <N> is required" ;;
esac
[ -n "$BOTS" ] || usage "name at least one reviewer: codex, claude or copilot"

SLUG="$(printf '%s' "$REPO" | awk -F/ '{ print $(NF-1) "/" $NF }')"
HOST="$(printf '%s' "$REPO" | awk -F/ 'NF > 2 { print $1 }')"

RESULT="" MISSED=0
record() { RESULT="$RESULT$*
"; }

# The ids of the timeline's `review_requested` events that name Copilot.
copilot_events() {
	gh api ${HOST:+--hostname} ${HOST:+"$HOST"} --paginate "repos/$SLUG/issues/$PR/timeline" \
		--jq '.[] | select(.event == "review_requested") | select((.requested_reviewer.login // "") | ascii_downcase | contains("copilot")) | .id'
}

ping_comment() { # reviewer
	local url
	if url="$(gh pr comment "$PR" --repo "$REPO" --body "@$1 review")"; then
		record "pinged=$1$TAB$(printf '%s\n' "$url" | awk 'NF' | tail -n 1)"
	else
		record "failed=$1${TAB}gh refused the comment"
		MISSED=1
	fi
}

ping_copilot() {
	local version before after new i=0
	version="$(gh --version 2>/dev/null | awk 'NR == 1 { print $3 }')"
	if ! printf '%s\n' "$version" | awk -F. '{ exit !($1 > 2 || ($1 == 2 && $2 >= 88)) }'; then
		record "skipped=copilot${TAB}gh ${version:-of an unknown version} is older than 2.88.0"
		MISSED=1
		return
	fi
	# Without the snapshot an older event would pass for this request.
	if ! before="$(copilot_events)"; then
		before=unread
	fi
	if ! gh pr edit "$PR" --repo "$REPO" --add-reviewer @copilot >/dev/null; then
		record "failed=copilot${TAB}gh refused the review request"
		MISSED=1
		return
	fi
	if [ "$before" != unread ]; then
		while :; do
			if after="$(copilot_events)"; then
				new="$(printf '%s\n' "$after" | SEEN="$before" awk 'BEGIN { n = split(ENVIRON["SEEN"], a, "\n"); for (i = 1; i <= n; i++) seen[a[i]] = 1 } NF && !($0 in seen)' | tail -n 1)"
				if [ -n "$new" ]; then
					record "pinged=copilot$TAB$new"
					return
				fi
			fi
			i=$((i + 1))
			[ "$i" -lt "$TRIES" ] || break
			sleep "$POLL"
		done
	fi
	record "unconfirmed=copilot"
	MISSED=1
}

for bot in $BOTS; do
	case "$bot" in
	copilot) ping_copilot ;;
	*) ping_comment "$bot" ;;
	esac
done

if [ "$MISSED" = 0 ]; then
	printf 'outcome=done\n%s' "$RESULT"
	exit 0
fi
printf 'outcome=partial\n%s' "$RESULT"
note "not every reviewer was pinged. The push and the summary stand; report who was not summoned, and do not issue an unconfirmed request again."
exit 3
