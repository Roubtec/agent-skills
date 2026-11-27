#!/usr/bin/env bash
# publish.sh — the PR-side writes of an address-review publication: one reply
# per triaged thread, the resolve where the disposition asks for one, and the
# Summary comment.
#
# Usage:
#   publish.sh --repo <owner>/<repo> --pr <N> --dispositions <file> --summary <file>
#   publish.sh --repo <owner>/<repo> --pr <N> --no-threads --summary <file>
#
# `<owner>/<repo>` is the repository the PR is in, read from the PR's own URL,
# on github.com: the threads come from `gh-review-threads.sh`, beside this
# file, which reads no other host.
#
# --dispositions  one line per thread this run triaged and owes a reply:
#                   <thread node id> TAB <action> TAB <reply file>
#                 `reply` posts the reply and leaves the thread open; `resolve`
#                 posts the reply and then resolves the thread. The reply file
#                 holds the reply's body, verbatim; a relative path is read
#                 from the folder the dispositions file is in. A thread left
#                 open without a reply has no line. Blank lines are skipped.
# --no-threads    this publication owes no thread anything (a zero-item run,
#                 or one whose items are all standalone or CI lanes). One of
#                 the two is required, so an empty file never passes for that.
# --summary       the Summary comment's body, verbatim.
#
# It reads the PR's threads afresh, resolved ones included, through
# `gh-review-threads.sh`, whose scope check requires every comment to name
# this PR in this repository, and checks every thread id in the file against
# that list BEFORE the first write. The comment a reply is threaded under is
# the listed thread's own first comment, never an id taken from the file.
#
# Then, per line, in the file's order:
#   - a thread already holding a reply of the authenticated user with this
#     body gets no second one (bodies are compared with line ends and outer
#     whitespace normalised);
#   - a resolve is attempted only once the reply is on the thread, and not at
#     all on a thread found resolved, which still gets its reply.
# and the Summary is posted once every line succeeded, unless a top-level
# comment of the authenticated user already holds that body. So a run that
# stopped part-way is finished by running it again with the same files.
#
#   outcome=published   every line is settled and the Summary is on the PR
#   outcome=partial     a write failed, or could not be confirmed (exit 3)
# with, under either:
#   thread=<id> TAB reply=<r> TAB resolve=<s> TAB <reply url, or ->
#       r: posted | present (an equal reply was there) | failed
#       s: done | already (found resolved) | open (not asked for) | failed |
#          skipped (the reply failed)
#   unlisted=<id> TAB <url>
#       an unresolved thread the file does not name: feedback that arrived
#       after triage, or an item left for a decision. Never written to.
#   summary=posted TAB <url> | present TAB <url> | failed | withheld
#       withheld: a thread write failed, so the Summary waits for the re-run
# and stops before any write (exit 3) on:
#   outcome=malformed       a line is not three tab-separated fields, names an
#                           unknown action or a thread twice, a reply or the
#                           Summary is unreadable or empty, or the file names
#                           no thread
#   outcome=foreign-thread  a `foreign=<id>` line per thread id that is not a
#                           review thread of this PR
#   outcome=contaminated    the thread list failed its scope check twice
#
# A `failed` write may still have landed (a timeout, a 502); the re-run reads
# the PR again rather than trusting this run's account. The resolve takes a
# node id and no repository, so what scopes it is that list; `gh api user` is
# the only other call naming none.
#
# Output: `key=value` lines on stdout, `outcome=` first. Exit status: 0
# published, 3 on a stop, 1 on a failure before any write (gh, the network),
# 64 on a usage error. It posts at most one reply per line and one Summary,
# and edits or deletes nothing. Needs gh and jq. Written for bash 3.2 and later.
set -u

TAB="$(printf '\t')"
SEP="$(printf '\037')"
case "$0" in
/*) SELF="$0" ;;
*) SELF="$PWD/$0" ;;
esac
HERE="$(cd "$(dirname "$SELF")" && pwd)"

say() { printf '%s\n' "$*"; }
note() { printf 'publish: %s\n' "$*" >&2; }
fail() {
	note "$*"
	exit 1
}
usage() {
	note "$*"
	sed -n '6,8p' "$SELF" | sed 's/^# \{0,1\}//' >&2
	exit 64
}
stop() { # <outcome> <explanation>
	say "outcome=$1"
	[ -z "${3:-}" ] || say "$3"
	note "$2"
	exit 3
}

REPO="" PR="" DISPOSITIONS="" SUMMARY="" NO_THREADS=0
while [ $# -gt 0 ]; do
	case "$1" in
	-h | --help | help)
		awk 'NR > 1 && !/^#/ { exit } NR > 1 { sub(/^# ?/, ""); print }' "$SELF"
		exit 0
		;;
	--no-threads)
		NO_THREADS=1
		shift
		continue
		;;
	esac
	[ $# -ge 2 ] || usage "$1 needs a value"
	case "$1" in
	--repo) REPO="$2" ;;
	--pr) PR="$2" ;;
	--dispositions) DISPOSITIONS="$2" ;;
	--summary) SUMMARY="$2" ;;
	*) usage "unknown argument: $1" ;;
	esac
	shift 2
done
case "$REPO" in
*/*/*) usage "--repo is <owner>/<repo>, on github.com: the thread list reads no other host" ;;
?*/?*) ;;
*) usage "--repo <owner>/<repo> is required (the repository the PR is in)" ;;
esac
case "$PR" in
'' | *[!0-9]*) usage "--pr <N> is required" ;;
esac
[ -n "$SUMMARY" ] || usage "--summary <file> is required"
if [ "$NO_THREADS" = 1 ]; then
	[ -z "$DISPOSITIONS" ] || usage "--no-threads and --dispositions contradict each other"
else
	[ -n "$DISPOSITIONS" ] || usage "say which threads: --dispositions <file>, or --no-threads where the publication owes none"
fi

TMPD=""
# shellcheck disable=SC2329 # the EXIT trap runs it
cleanup() {
	[ -n "$TMPD" ] || return 0
	rm -f "$TMPD/raw" "$TMPD/lines" "$TMPD/plan" "$TMPD/threads.json" "$TMPD/comments"
	rmdir "$TMPD" 2>/dev/null
}
trap cleanup EXIT
TMPD="$(mktemp -d "${TMPDIR:-/tmp}/publish.XXXXXX")" || fail "could not create a temporary directory. Nothing was written."

# A body with nothing but whitespace in it is not one GitHub would accept.
has_text() { [ -f "$1" ] && [ -r "$1" ] && grep -q '[^[:space:]]' "$1"; }

has_text "$SUMMARY" || stop malformed "the Summary file $SUMMARY is missing, unreadable or empty. Nothing was written."

# --- the dispositions file → $TMPD/lines: id SEP action SEP reply file's path ---
: >"$TMPD/lines" || fail "could not write to the temporary directory. Nothing was written."
if [ "$NO_THREADS" = 0 ]; then
	[ -f "$DISPOSITIONS" ] && [ -r "$DISPOSITIONS" ] || stop malformed "the dispositions file $DISPOSITIONS is missing or unreadable. Nothing was written."
	base="$(cd "$(dirname "$DISPOSITIONS")" && pwd)" || fail "could not resolve the folder of $DISPOSITIONS. Nothing was written."
	bad="$(awk -F '\t' -v sep="$SEP" -v out="$TMPD/raw" '
		{ sub(/\r$/, "") }
		!NF { next }
		NF != 3 || $1 == "" {
			print "line " NR " is not <thread id> TAB <reply|resolve> TAB <reply file>"; exit
		}
		$2 != "reply" && $2 != "resolve" { print "line " NR " names the action \"" $2 "\": it is reply or resolve"; exit }
		$1 in seen { print "line " NR " names thread " $1 " a second time"; exit }
		{ seen[$1] = 1; print $1 sep $2 sep $3 >out }
	' "$DISPOSITIONS")" || fail "could not read $DISPOSITIONS. Nothing was written."
	[ -z "$bad" ] || stop malformed "$DISPOSITIONS: $bad. Nothing was written."
	[ -s "$TMPD/raw" ] || stop malformed "$DISPOSITIONS names no thread. Where the publication owes none, say --no-threads. Nothing was written."
	while IFS="$SEP" read -r id action file; do
		case "$file" in
		/*) ;;
		*) file="$base/$file" ;;
		esac
		has_text "$file" || stop malformed "the reply for thread $id, $file, is missing, unreadable or empty. Nothing was written."
		say "$id$SEP$action$SEP$file" >>"$TMPD/lines"
	done <"$TMPD/raw"
fi

# --- what the PR holds ------------------------------------------------------------
ME="$(gh api user --jq .login)" || fail "could not read the authenticated user (gh failed). Nothing was written."
[ -n "$ME" ] || fail "gh named no authenticated user. Nothing was written."

bash "$HERE/gh-review-threads.sh" --all --repo "$REPO" "$PR" >"$TMPD/threads.json"
rc=$?
[ "$rc" != 3 ] || stop contaminated "the thread list of PR #$PR in $REPO failed its scope check twice (see above). Nothing was written, and no thread id from another source is safe to write to."
[ "$rc" = 0 ] || fail "could not list the review threads of PR #$PR in $REPO. Nothing was written."

# One thread of the list → resolved SEP first comment id SEP the url of an equal
# reply of the authenticated user; `absent` where the list holds no such thread.
# shellcheck disable=SC2016 # $id, $me and $body are jq's
THREAD_JQ='
	def norm: gsub("\r"; "") | gsub("[ \t]+\n"; "\n") | sub("^[ \t\n]+"; "") | sub("[ \t\n]+$"; "");
	($body | norm) as $want
	| [.[] | select(.id == $id)]
	| if length == 0 then "absent"
	  else .[0]
		| [ (.isResolved == true | tostring),
			(.comments[0].databaseId | tostring),
			([.comments[1:][] | select(.author.login == $me and ((.body // "") | norm) == $want) | .url][0] // "") ]
		| join("\u001f")
	  end'

: >"$TMPD/plan"
FOREIGN=""
while IFS="$SEP" read -r id action file; do
	row="$(jq -r --arg id "$id" --arg me "$ME" --rawfile body "$file" "$THREAD_JQ" "$TMPD/threads.json")" ||
		fail "could not read thread $id out of the thread list. Nothing was written."
	if [ "$row" = absent ]; then
		FOREIGN="$FOREIGN
foreign=$id"
		continue
	fi
	cid="$(printf '%s' "$row" | cut -d "$SEP" -f 2)"
	case "$cid" in
	'' | *[!0-9]*) fail "thread $id lists no first comment to reply under. Nothing was written." ;;
	esac
	say "$id$SEP$action$SEP$file$SEP$row" >>"$TMPD/plan"
done <"$TMPD/lines"
[ -z "$FOREIGN" ] || stop foreign-thread "the dispositions name a thread that is not a review thread of PR #$PR in $REPO. Nothing was written: take every thread id from this PR's own thread list." "$(printf '%s\n' "$FOREIGN" | awk 'NF')"

# shellcheck disable=SC2016 # $named is jq's
UNLISTED="$(jq -r --rawfile named "$TMPD/lines" '
	($named | split("\n") | map(split("\u001f")[0])) as $ids
	| .[] | select(.isResolved != true) | select(.id as $i | $ids | index($i) | not)
	| "unlisted=\(.id)\t\(.comments[0].url // "-")"' "$TMPD/threads.json")" || fail "could not read the thread list for the threads the file does not name. Nothing was written."


# --- the thread writes ------------------------------------------------------------
RESULT="" MISSED=0
record() { RESULT="$RESULT$*
"; }

# shellcheck disable=SC2016 # $id is GraphQL's
RESOLVE='mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}){ thread{ id isResolved } } }'

# gh reads no stdin in these calls, but the plan stays on its own descriptor
# so that nothing a later edit adds to the loop can eat it.
while IFS="$SEP" read -r id action file resolved cid prior <&3; do
	if [ -n "$prior" ]; then
		reply=present url="$prior"
	elif url="$(gh api --method POST "repos/$REPO/pulls/$PR/comments/$cid/replies" -F "body=@$file" --jq '.html_url // empty')" && [ -n "$url" ]; then
		reply=posted
	else
		record "thread=$id${TAB}reply=failed${TAB}resolve=skipped$TAB-"
		MISSED=1
		continue
	fi
	if [ "$resolved" = true ]; then
		record "thread=$id${TAB}reply=$reply${TAB}resolve=already$TAB$url"
	elif [ "$action" != resolve ]; then
		record "thread=$id${TAB}reply=$reply${TAB}resolve=open$TAB$url"
	elif [ "$(gh api graphql -f query="$RESOLVE" -f id="$id" --jq .data.resolveReviewThread.thread.isResolved)" = true ]; then
		record "thread=$id${TAB}reply=$reply${TAB}resolve=done$TAB$url"
	else
		record "thread=$id${TAB}reply=$reply${TAB}resolve=failed$TAB$url"
		MISSED=1
	fi
done 3<"$TMPD/plan"

[ -z "$UNLISTED" ] || record "$UNLISTED"

# --- the Summary ------------------------------------------------------------------
if [ "$MISSED" = 1 ]; then
	record "summary=withheld"
else
	# shellcheck disable=SC2016 # $me and $body are jq's
	if gh api --paginate "repos/$REPO/issues/$PR/comments" --jq '.[] | {login: .user.login, body, url: .html_url}' >"$TMPD/comments" &&
		prior="$(jq -rs --arg me "$ME" --rawfile body "$SUMMARY" '
			def norm: gsub("\r"; "") | gsub("[ \t]+\n"; "\n") | sub("^[ \t\n]+"; "") | sub("[ \t\n]+$"; "");
			($body | norm) as $want
			| [.[] | select(.login == $me and ((.body // "") | norm) == $want) | .url][0] // ""' "$TMPD/comments")"; then
		if [ -n "$prior" ]; then
			record "summary=present$TAB$prior"
		elif url="$(gh api --method POST "repos/$REPO/issues/$PR/comments" -F "body=@$SUMMARY" --jq '.html_url // empty')" && [ -n "$url" ]; then
			record "summary=posted$TAB$url"
		else
			record "summary=failed"
			MISSED=1
		fi
	else
		# Unread, a Summary an earlier run posted would be posted again.
		record "summary=failed"
		MISSED=1
	fi
fi

if [ "$MISSED" = 0 ]; then
	printf 'outcome=published\n%s' "$RESULT"
	exit 0
fi
printf 'outcome=partial\n%s' "$RESULT"
note "the publication is not complete, and a write reported failed may still have landed. Run this again with the same files: it reads the PR afresh and skips every reply, resolve and Summary already there."
exit 3
