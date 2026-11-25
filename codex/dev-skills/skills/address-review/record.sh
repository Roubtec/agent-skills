#!/usr/bin/env bash
# record.sh — the disposition record of an address-review run: one top-level
# PR comment, found by its marker, never by its prose.
#
# Usage:
#   record.sh find   --repo <owner>/<repo> --pr <N>
#   record.sh render --pr <N> --branch <branch> --state <state> ... <body
#   record.sh post   --repo <owner>/<repo> --pr <N> --branch <branch> --state <state> ... <body
#   record.sh spend  --repo <owner>/<repo> --pr <N> --branch <branch> --id <comment-id> [--summary-url <url>]
#
# `<owner>/<repo>` is the repository the PR is in, read from the PR's own URL;
# every `gh` call names it.
#
# find    Lists the records on the PR: comments whose FIRST LINE is the marker,
#         byte for byte (a comment that merely quotes the marker is not one).
#           outcome=found   id=, url=, spent=yes|no — the most recent record of
#                           the authenticated user
#           outcome=none    the authenticated user has no record here
#         and, either way, one line for every further record, anyone's:
#           other=<url> <login> <updated-at> spent=<yes|no>
# render  Prints the record: the header this script words, then stdin, which
#         is the `## Threads` block and the `## Summary comment` block.
# post    Renders, then writes it ONCE: over the most recent record of the
#         authenticated user where there is one, else as a new comment.
#         `--incomplete` never writes over anything: a map known to be
#         incomplete is posted new, every earlier record left standing.
#           outcome=posted  url=, superseded=yes|no, and the other= lines
#         and stops, writing nothing, on:
#           mention         the record carries a bare @codex/@claude/@copilot
#                           outside a code span, in any letter case
#           malformed       stdin lacks a `## Threads` or `## Summary comment`
# spend   Empties the record `--id` names, in place, once its map has been
#         published in full: marker, title and a SPENT status, no blocks.
#           outcome=spent   url=
#         and stops, writing nothing, on:
#           absent          that id is not a record of the authenticated user
#
# The states, and the two header lines each one words:
#   --state not-published  nothing of the map is on the PR.
#                          --push none (default): the tips are local only
#                          --push noop: an "Everything up-to-date" push, so
#                          the tips are on origin and the map is not
#   --state part           part of the map is on the PR. Needs --landed,
#                          --outstanding and --push advanced | noop | none,
#                          which says what that means for the tips
#   --state unknown        the publication left no usable account. --push
#                          advanced | noop | none is the one fact still known
#   --state unconfirmed    the push returned and its read-back did not confirm
#                          the ref; nothing else was published
# Every state takes --reason <one line>, and the facts of the run:
#   --starting <sha> --final <sha> --head-oid <sha> --base <sha>
#   --validation <text> --reviewer <text> --peer <text>
#
# Output: `key=value` lines on stdout, `outcome=` first (render prints only
# the record). Exit status: 0 done, 3 on a stop, 1 on a failure (network, gh),
# 64 on a usage error. It writes at most one comment and deletes nothing.
# After an exit 1 from post or spend, run find before writing again: the write
# may have landed. Needs gh. Written for bash 3.2 and later.
set -u

MARKER='<!-- address-review:disposition-record -->'
SEP="$(printf '\037')"

say() { printf '%s\n' "$*"; }
note() { printf 'record: %s\n' "$*" >&2; }
fail() {
	note "$*"
	exit 1
}
usage() {
	note "$*"
	sed -n '5,9p' "$0" | sed 's/^# \{0,1\}//' >&2
	exit 64
}
stop() { # <outcome> <explanation>
	say "outcome=$1"
	note "$2"
	exit 3
}

REPO="" PR="" BRANCH="" STATE="" PUSH="" REASON="" LANDED="" OUTSTANDING=""
STARTING="" FINAL="" HEADOID="" BASE="" VALIDATION="" REVIEWER="" PEER=""
INCOMPLETE=0 ID="" SUMMARY_URL=""

parse() {
	while [ $# -gt 0 ]; do
		case "$1" in
		--incomplete)
			INCOMPLETE=1
			shift
			continue
			;;
		esac
		[ $# -ge 2 ] || usage "$1 needs a value"
		case "$1" in
		--repo) REPO="$2" ;;
		--pr) PR="$2" ;;
		--branch) BRANCH="$2" ;;
		--state) STATE="$2" ;;
		--push) PUSH="$2" ;;
		--reason) REASON="$2" ;;
		--landed) LANDED="$2" ;;
		--outstanding) OUTSTANDING="$2" ;;
		--starting) STARTING="$2" ;;
		--final) FINAL="$2" ;;
		--head-oid) HEADOID="$2" ;;
		--base) BASE="$2" ;;
		--validation) VALIDATION="$2" ;;
		--reviewer) REVIEWER="$2" ;;
		--peer) PEER="$2" ;;
		--id) ID="$2" ;;
		--summary-url) SUMMARY_URL="$2" ;;
		*) usage "unknown argument: $1" ;;
		esac
		shift 2
	done
}
need_repo() {
	case "$REPO" in
	?*/?*) ;;
	*) usage "--repo <owner>/<repo> is required (the repository the PR is in)" ;;
	esac
}
need_pr() {
	case "$PR" in
	'' | *[!0-9]*) usage "--pr <N> is required" ;;
	esac
}
one_line() { # name, value
	case "$2" in
	*"
"*) usage "$1 must be one line" ;;
	esac
}
need_render_args() {
	need_pr
	[ -n "$BRANCH" ] || usage "--branch <branch> is required"
	[ -n "$REASON" ] || usage "--reason <one line> is required"
	local n
	for n in "$BRANCH" "$REASON" "$LANDED" "$OUTSTANDING" "$STARTING" "$FINAL" "$HEADOID" "$BASE" "$VALIDATION" "$REVIEWER" "$PEER"; do
		one_line "every header value" "$n"
	done
	# Unsaid, the push is the state that claims least: except for `part`, where
	# "no push" asserts the tips are absent from origin, so it has to be said.
	[ "$STATE" != part ] || [ -n "$PUSH" ] || usage "--state part needs --push advanced, noop or none: it decides what the record says of the tips"
	[ -n "$PUSH" ] || PUSH=none
	case "$PUSH" in
	advanced | noop | none) ;;
	*) usage "--push is advanced, noop or none" ;;
	esac
	case "$STATE" in
	not-published)
		[ "$PUSH" != advanced ] || usage "a push that advanced the remote put part of this run on origin: that is --state part"
		;;
	part)
		[ -n "$LANDED" ] && [ -n "$OUTSTANDING" ] || usage "--state part needs --landed and --outstanding"
		;;
	unknown | unconfirmed) ;;
	*) usage "--state is not-published, part, unknown or unconfirmed" ;;
	esac
}

# The two lines that differ by state: STATUS_LINE and ORIGIN_LINE.
# shellcheck disable=SC2016 # the backticks are Markdown, not a command
word_state() {
	local status origin
	case "$STATE" in
	not-published)
		status="not published"
		if [ "$PUSH" = noop ]; then
			origin='this run changed NOTHING on origin: its push was an `Everything up-to-date` no-op, so the tips above are already on origin while no reply, resolve or Summary comment reached it'
		else
			origin='the tips above are LOCAL ONLY — this run pushed nothing, so they are not on origin'
		fi
		;;
	part)
		status="published in part"
		origin="reached origin: $LANDED — still outstanding: $OUTSTANDING"
		case "$PUSH" in
		noop) origin="$origin"' — and the tips above are already on origin, this run having put nothing there: its push was an `Everything up-to-date` no-op' ;;
		none) origin="$origin — and the tips above are still LOCAL-ONLY: what landed rode the API with no successful push, so nothing of the branch is on origin" ;;
		esac
		;;
	unknown)
		case "$PUSH" in
		advanced)
			status="published in part (the push), and UNKNOWN whether any reply, resolve or Summary comment was published"
			origin="the push WAS published — it advanced the remote branch, so the tips above ARE on origin — while whether any reply, resolve or Summary comment below was published is UNKNOWN"
			;;
		noop)
			status="UNKNOWN whether any reply, resolve or Summary comment was published"
			origin='this run'"'"'s push published NOTHING — it was an `Everything up-to-date` no-op, so the tips above are already on origin though this run put nothing there — while whether any reply, resolve or Summary comment below was published is UNKNOWN'
			;;
		*)
			status="UNKNOWN whether anything was published"
			origin="whether anything reached origin is UNKNOWN — not even a push is known to have advanced the remote branch, so whether the tips above are on origin is unknown too"
			;;
		esac
		origin="$origin: check the PR itself before acting on any tip or any entry below"
		;;
	unconfirmed)
		status="UNKNOWN whether its push reached origin, and nothing else was published"
		origin='whether this run'"'"'s push reached origin is UNKNOWN — `git push` returned and the read-back at the ref did not confirm the ref moved, so read the ref itself before treating the tips above as either published or local, while no reply, resolve or Summary comment reached the PR'
		;;
	esac
	if [ "$INCOMPLETE" = 1 ]; then
		status="$status, and this map is PARTIAL"
		[ -z "$STANDING" ] || status="$status — an earlier record still stands at $STANDING"
	fi
	STATUS_LINE="status: $status ($REASON)"
	ORIGIN_LINE="$origin"
}

TMPF="" STANDING=""
cleanup() { [ -z "$TMPF" ] || rm -f "$TMPF" "$TMPF.body"; }
trap cleanup EXIT
new_tmp() {
	TMPF="$(mktemp "${TMPDIR:-/tmp}/record.XXXXXX")" || fail "could not create a temporary file. Nothing was written."
}
# A bare bot mention in the text on stdin: outside a fenced block or a code
# span (GitHub notifies from neither), in any letter case.
# shellcheck disable=SC2016 # the backticks are Markdown's
has_mention() {
	awk '/^[ \t]*```/ { fence = !fence; next } !fence' |
		sed 's/`[^`]*`//g' |
		grep -Eiq '(^|[^A-Za-z0-9_])@(codex|claude|copilot)([^A-Za-z0-9_-]|$)'
}
# take_body: stdin → $TMPF.body, stopping on one that is not a record's body.
take_body() {
	cat >"$TMPF.body" || fail "could not write the record to a temporary file. Nothing was posted."
	if ! grep -q '^## Threads' "$TMPF.body" || ! grep -q '^## Summary comment' "$TMPF.body"; then
		stop malformed 'the body on stdin needs a "## Threads" block and a "## Summary comment" block. Nothing was posted.'
	fi
}
# write_record: header + body → $TMPF, stopping on a record that must not be posted.
write_record() {
	word_state
	{
		say "$MARKER" &&
			say "# address-review packet — PR #$PR ($BRANCH)" &&
			say "$STATUS_LINE" &&
			say "starting HEAD ${STARTING:-(not recorded)} | final HEAD ${FINAL:-(not recorded)} | recorded headRefOid ${HEADOID:-(not recorded)}" &&
			say "base ${BASE:-(not recorded)} | validation ${VALIDATION:-(not recorded)} | reviewer ${REVIEWER:-(not recorded)} | peer ${PEER:-(not recorded)}" &&
			say "$ORIGIN_LINE" &&
			say "" &&
			cat "$TMPF.body"
	} >"$TMPF" || fail "could not write the record to a temporary file. Nothing was posted."
	if has_mention <"$TMPF"; then
		stop mention 'the record carries a bare @codex, @claude or @copilot, which would summon a review round for work this run did not publish. Write the name plain, or inside a code span where it is quoted. Nothing was posted.'
	fi
}

ME="" OWN_ID="" OWN_URL="" OWN_SPENT="" OWN_AT="" OTHERS="" OWN_IDS=""
# Every record on the PR, the authenticated user's most recent one picked out.
list_records() {
	local rows id login updated url spent best="" newer
	ME="$(gh api user --jq .login)" || fail "could not read the authenticated user (gh failed). Nothing was written."
	[ -n "$ME" ] || fail "gh named no authenticated user. Nothing was written."
	# shellcheck disable=SC2016 # $m is jq's
	rows="$(gh api --paginate "repos/$REPO/issues/$PR/comments" --jq '
		"<!-- address-review:disposition-record -->" as $m
		| .[]
		| (.body | split("\n")) as $l
		| select(($l[0] // "" | rtrimstr("\r")) == $m)
		| [(.id | tostring), .user.login, .updated_at, .html_url,
		   (if ($l[2] // "" | startswith("status: SPENT")) then "yes" else "no" end)]
		| join("\u001f")')" || fail "could not list the comments of PR #$PR in $REPO (gh failed). Nothing was written."
	while IFS="$SEP" read -r id login updated url spent; do
		[ -n "$id" ] || continue
		if [ "$login" = "$ME" ]; then
			OWN_IDS="$OWN_IDS $id"
			# ISO timestamps order as strings; on a tie the later comment wins.
			newer=0
			if [ -z "$best" ] || [ "$updated" \> "$best" ]; then
				newer=1
			elif [ "$updated" = "$best" ] && [ "$id" -gt "$OWN_ID" ]; then
				newer=1
			fi
			if [ "$newer" = 1 ]; then
				[ -z "$OWN_ID" ] || OTHERS="$OTHERS
other=$OWN_URL $ME $best spent=$OWN_SPENT"
				best="$updated" OWN_ID="$id" OWN_URL="$url" OWN_SPENT="$spent"
				continue
			fi
		fi
		OTHERS="$OTHERS
other=$url $login $updated spent=$spent"
	done <<EOF
$rows
EOF
	OWN_AT="$best"
}
others() { printf '%s\n' "$OTHERS" | awk 'NF'; }

cmd_find() {
	parse "$@"
	need_repo
	need_pr
	list_records
	if [ -n "$OWN_ID" ]; then
		say "outcome=found"
		say "id=$OWN_ID"
		say "url=$OWN_URL"
		say "spent=$OWN_SPENT"
	else
		say "outcome=none"
	fi
	others
}

cmd_render() {
	parse "$@"
	need_render_args
	new_tmp
	take_body
	write_record
	cat "$TMPF"
}

cmd_post() {
	parse "$@"
	need_repo
	need_render_args
	local url superseded
	new_tmp
	take_body
	# Refuse a mention before asking GitHub anything; the header is checked
	# again below, once it can be worded.
	if has_mention <"$TMPF.body"; then
		write_record
	fi
	list_records
	[ "$INCOMPLETE" = 0 ] || STANDING="$OWN_URL"
	write_record
	if [ -n "$OWN_ID" ] && [ "$INCOMPLETE" = 0 ]; then
		url="$(gh api --method PATCH "repos/$REPO/issues/comments/$OWN_ID" -F "body=@$TMPF" --jq .html_url)" ||
			fail "could not update record $OWN_URL (gh failed). Whether it changed is not established: run find, and read it, before writing again."
		superseded=yes
	else
		url="$(gh api --method POST "repos/$REPO/issues/$PR/comments" -F "body=@$TMPF" --jq .html_url)" ||
			fail "could not post the record on PR #$PR (gh failed). Whether it landed is not established: run find before posting again."
		superseded=no
		# The record left standing is one of the others now.
		[ -z "$OWN_ID" ] || OTHERS="$OTHERS
other=$OWN_URL $ME $OWN_AT spent=$OWN_SPENT"
	fi
	[ -n "$url" ] || fail "gh answered the write without a comment url. Whether it landed is not established: run find before writing again."
	say "outcome=posted"
	say "url=$url"
	say "superseded=$superseded"
	others
}

cmd_spend() {
	parse "$@"
	need_repo
	need_pr
	[ -n "$BRANCH" ] || usage "--branch <branch> is required"
	case "$ID" in
	'' | *[!0-9]*) usage "--id <comment-id> is required: the record this run replayed" ;;
	esac
	one_line "--summary-url" "$SUMMARY_URL"
	list_records
	case " $OWN_IDS " in
	*" $ID "*) ;;
	*) stop absent "comment $ID is not a record of $ME on PR #$PR: it is gone, or another actor's. Nothing was written, and no other record is spent in its place." ;;
	esac
	local url by=""
	[ -z "$SUMMARY_URL" ] || by=", whose Summary comment is at $SUMMARY_URL"
	new_tmp
	{
		say "$MARKER" &&
			say "# address-review packet — PR #$PR ($BRANCH)" &&
			say "status: SPENT — the map this record held has since been published in full by a later run$by" &&
			say "nothing here is outstanding: every reply and resolve that publication owed reached the PR, and every standalone item and CI lane this record named was carried into that run's Summary comment — one it could not settle appearing there as the ambiguous/skipped item it is, which is where a maintainer picks it up, since a spent record hands nothing to a later run. This record is kept, findable by its marker, so a later run reads a SPENT record rather than a live one."
	} >"$TMPF" || fail "could not write the record to a temporary file. Nothing was written."
	url="$(gh api --method PATCH "repos/$REPO/issues/comments/$ID" -F "body=@$TMPF" --jq .html_url)" ||
		fail "could not update record $ID (gh failed). Whether it changed is not established: read it before writing again."
	say "outcome=spent"
	say "url=$url"
}

[ $# -ge 1 ] || usage "a command is required"
cmd="$1"
shift
case "$cmd" in
find) cmd_find "$@" ;;
render) cmd_render "$@" ;;
post) cmd_post "$@" ;;
spend) cmd_spend "$@" ;;
-h | --help | help)
	awk 'NR > 1 && !/^#/ { exit } NR > 1 { sub(/^# ?/, ""); print }' "$0"
	;;
*) usage "unknown command: $cmd" ;;
esac
