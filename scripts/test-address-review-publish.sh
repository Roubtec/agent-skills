#!/usr/bin/env bash
# Hermetic test for the address-review publication helper
# (plugins/dev-skills/skills/address-review/publish.sh).
#
# Nothing here reaches the network: `gh` is a fake that keeps one PR's review
# threads and top-level comments in a JSON file, logs every call, applies each
# reply, resolve and comment to that file so a second run meets what the first
# left, and runs the helper's own `--jq` programs through the real `jq`. The
# thread list is fetched by the real `gh-review-threads.sh` beside the helper,
# so its scope check is the one under test. Needs Bash, jq and coreutils.
# shellcheck disable=SC2319 # `ok <label> $?` after a `[ … ]` test is the point
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SHIPPED="$SCRIPT_DIR/../plugins/dev-skills/skills/address-review/publish.sh"
HELPER="${PUBLISH_HELPER:-$SHIPPED}"
MIRROR="$SCRIPT_DIR/../codex/dev-skills/skills/address-review/publish.sh"
SHIM="$SCRIPT_DIR/../plugins/dev-skills/bin/address-review-publish"
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
# $FAKE/state.json holds the PR: {"threads": [...], "issue": [...]}.
# Files under $FAKE steer it:
#   fail-user, fail-threads, fail-list, fail-summary   that call exits 1
#   empty-user     the authenticated user comes back with no login
#   fail-reply     a first-comment id whose reply is refused
#   lost-reply     a first-comment id whose reply lands and is then reported failed
#   fail-resolve   a thread id whose resolve is refused
#   unresolved     a thread id whose resolve answers isResolved=false
#   no-url         every write answers without a url
printf '%s\n' "$*" >>"$FAKE/gh.log"
S="$FAKE/state.json"
[ "$1" = api ] || exit 1
shift
method=GET path="" expr=. query="" id="" body=""
while [ $# -gt 0 ]; do
	case "$1" in
	--method)
		method="$2"
		shift 2
		;;
	--jq)
		expr="$2"
		shift 2
		;;
	--paginate) shift ;;
	-f | -F)
		case "$2" in
		query=*) query="${2#query=}" ;;
		id=*) id="${2#id=}" ;;
		body=@*) body="${2#body=@}" ;;
		esac
		shift 2
		;;
	*)
		path="$1"
		shift
		;;
	esac
done
update() { jq "$@" "$S" >"$S.new" && mv "$S.new" "$S"; }
is_in() { [ -f "$FAKE/$1" ] && grep -Fqx -- "$2" "$FAKE/$1"; }
answer() { # <url>
	if [ -f "$FAKE/no-url" ]; then echo '{}' | jq -r "$expr"; else jq -n --arg u "$1" '{html_url: $u}' | jq -r "$expr"; fi
}
next() {
	local n
	n=$(($(cat "$FAKE/serial" 2>/dev/null || echo 900) + 1))
	echo "$n" >"$FAKE/serial"
	echo "$n"
}
case "$method $path" in
"GET user")
	[ ! -f "$FAKE/fail-user" ] || exit 1
	if [ -f "$FAKE/empty-user" ]; then echo '{"login":""}' | jq -r "$expr"; else echo '{"login":"me-bot"}' | jq -r "$expr"; fi
	;;
"GET graphql")
	case "$query" in
	*resolveReviewThread*)
		is_in fail-resolve "$id" && exit 1
		jq -e --arg id "$id" 'any(.threads[]; .id == $id)' "$S" >/dev/null || exit 1
		if is_in unresolved "$id"; then
			jq -n --arg id "$id" '{data: {resolveReviewThread: {thread: {id: $id, isResolved: false}}}}' | jq -r "$expr"
			exit 0
		fi
		update --arg id "$id" '(.threads[] | select(.id == $id) | .isResolved) = true'
		jq -n --arg id "$id" '{data: {resolveReviewThread: {thread: {id: $id, isResolved: true}}}}' | jq -r "$expr"
		;;
	*reviewThreads*)
		[ ! -f "$FAKE/fail-threads" ] || exit 1
		jq '{data: {repository: {nameWithOwner: "acme/widgets", pullRequest: {number: 7, url: "https://github.com/acme/widgets/pull/7",
			reviewThreads: {totalCount: (.threads | length),
				nodes: [.threads[] | .comments = {nodes: .comments, pageInfo: {hasNextPage: false, endCursor: null}}],
				pageInfo: {hasNextPage: false, endCursor: null}}}}}}' "$S"
		;;
	*) exit 1 ;;
	esac
	;;
"POST repos/acme/widgets/pulls/7/comments/"*"/replies")
	cid="${path#repos/acme/widgets/pulls/7/comments/}"
	cid="${cid%/replies}"
	is_in fail-reply "$cid" && exit 1
	# Only a thread's first comment takes a reply here.
	jq -e --argjson cid "$cid" 'any(.threads[]; .comments[0].databaseId == $cid)' "$S" >/dev/null || exit 1
	n="$(next)"
	update --argjson cid "$cid" --argjson n "$n" --rawfile body "$body" \
		'(.threads[] | select(.comments[0].databaseId == $cid) | .comments) += [{databaseId: $n, author: {login: "me-bot", __typename: "User"}, body: $body, diffHunk: "", url: "https://github.com/acme/widgets/pull/7#discussion_r\($n)"}]'
	is_in lost-reply "$cid" && exit 1
	answer "https://github.com/acme/widgets/pull/7#discussion_r$n"
	;;
"GET repos/acme/widgets/issues/7/comments")
	[ ! -f "$FAKE/fail-list" ] || exit 1
	jq '.issue' "$S" | jq -c "$expr"
	;;
"POST repos/acme/widgets/issues/7/comments")
	[ ! -f "$FAKE/fail-summary" ] || exit 1
	n="$(next)"
	update --argjson n "$n" --rawfile body "$body" \
		'.issue += [{id: $n, user: {login: "me-bot"}, body: $body, html_url: "https://github.com/acme/widgets/pull/7#issuecomment-\($n)"}]'
	answer "https://github.com/acme/widgets/pull/7#issuecomment-$n"
	;;
*) exit 1 ;;
esac
FAKEGH
chmod +x "$FAKE/gh"
export PATH="$FAKE:$PATH"

# thread <id> <first comment id> <author> <resolved: true|false> [<pr of its comment urls>]
thread() {
	jq -n --arg id "$1" --argjson cid "$2" --arg who "$3" --argjson res "$4" --arg pr "${5:-7}" \
		'{id: $id, isResolved: $res, isOutdated: false, path: "src/a.sh", line: 3,
		  comments: [{databaseId: $cid, author: {login: $who, __typename: "Bot"}, body: "a finding", diffHunk: "@@", url: "https://github.com/acme/widgets/pull/\($pr)#discussion_r\($cid)"}]}'
}
# Four threads: T1 and T2 to publish, T3 arrived after triage, T4 long resolved.
fresh() {
	rm -f "$FAKE"/fail-* "$FAKE/empty-user" "$FAKE/lost-reply" "$FAKE/unresolved" "$FAKE/no-url" "$FAKE/serial" "$FAKE/gh.log"
	{
		thread T1 101 codex-bot false
		thread T2 102 alice false
		thread T3 103 codex-bot false
		thread T4 104 alice true
	} | jq -s '{threads: ., issue: [{id: 1, user: {login: "alice"}, body: "please look", html_url: "https://github.com/acme/widgets/pull/7#issuecomment-1"}]}' >"$FAKE/state.json"
	D="$WORKDIR/d"
	mkdir -p "$D"
	rm -f "$D"/*
	printf 'Fixed in abc1234: quoted the path\n' >"$D/t1.md"
	printf 'Not changing this: the caller already checks.\n\nSee run().\n' >"$D/t2.md"
	printf '## Summary of Review Fixes\n\n- quoted the path\n' >"$D/summary.md"
	printf 'T1\tresolve\tt1.md\nT2\treply\t%s\n' "$D/t2.md" >"$D/dispositions.tsv"
}
state() { jq -r "$1" "$FAKE/state.json"; }
add_reply() { # <thread id> <login> <body>
	jq --arg id "$1" --arg who "$2" --arg body "$3" \
		'(.threads[] | select(.id == $id) | .comments) += [{databaseId: 555, author: {login: $who, __typename: "User"}, body: $body, diffHunk: "", url: "https://github.com/acme/widgets/pull/7#discussion_r555"}]' \
		"$FAKE/state.json" >"$FAKE/state.new" && mv "$FAKE/state.new" "$FAKE/state.json"
}
call() { # [args...] → OUT (stdout), ERR (stderr), RC
	OUT="$(bash "$HELPER" "$@" 2>"$WORKDIR/err")"
	RC=$?
	ERR="$(cat "$WORKDIR/err")"
}
publish() { call --repo acme/widgets --pr 7 --dispositions "$D/dispositions.tsv" --summary "$D/summary.md"; }
val() { printf '%s\n' "$OUT" | sed -n "s/^$1=//p" | head -n 1; }
log() { cat "$FAKE/gh.log" 2>/dev/null; }
count() { log | grep -Ec -- "$1"; }
writes() { count '--method POST|resolveReviewThread'; }
replies() { count '^api --method POST repos/acme/widgets/pulls/7/comments/[0-9]+/replies'; }
summaries() { count '^api --method POST repos/acme/widgets/issues/7/comments'; }

# --- 1. a whole publication -----------------------------------------------------
fresh
publish
is "1: every write landing is published" "$(val outcome)" published
is "1: ...with exit 0" "$RC" 0
is "1: outcome is the first line" "$(printf '%s\n' "$OUT" | head -n 1)" "outcome=published"
has "1: a resolve line is replied to, then resolved" "$OUT" "thread=T1	reply=posted	resolve=done	https://github.com/acme/widgets/pull/7#discussion_r901"
has "1: a reply line is replied to and left open" "$OUT" "thread=T2	reply=posted	resolve=open	https://github.com/acme/widgets/pull/7#discussion_r902"
has "1: the reply is threaded under the listed thread's first comment, in the PR's repository" "$(log)" "api --method POST repos/acme/widgets/pulls/7/comments/101/replies -F body=@$D/t1.md --jq .html_url // empty"
is "1: the reply's body is the file, verbatim" "$(state '.threads[1].comments[1].body')" "$(cat "$D/t2.md")"
is "1: a relative reply file is read from the dispositions file's folder" "$(state '.threads[0].comments[1].body')" "Fixed in abc1234: quoted the path"
is "1: one reply per line" "$(replies)" 2
is "1: the resolve line's thread is resolved" "$(state '.threads[0].isResolved')" true
is "1: the reply line's thread is not" "$(state '.threads[1].isResolved')" false
is "1: exactly one resolve is asked for" "$(count resolveReviewThread)" 1
[ "$(log | awk '/comments\/101\/replies/ { print NR; exit }')" -lt "$(log | awk '/resolveReviewThread/ { print NR; exit }')" ]
ok "1: the reply goes before its resolve" $?
has "1: an unresolved thread the file does not name is reported" "$OUT" "unlisted=T3	https://github.com/acme/widgets/pull/7#discussion_r103"
is "1: ...and never written to" "$(state '.threads[2] | [.isResolved, (.comments | length)] | join(" ")')" "false 1"
lacks "1: a resolved thread the file does not name is not" "$OUT" "T4"
lacks "1: ...nor is a thread the file does name" "$OUT" "unlisted=T1"
has "1: the Summary is posted" "$OUT" "summary=posted	https://github.com/acme/widgets/pull/7#issuecomment-903"
has "1: ...as a top-level comment of the PR, in its repository" "$(log)" "api --method POST repos/acme/widgets/issues/7/comments -F body=@$D/summary.md --jq .html_url // empty"
is "1: ...holding the file, verbatim" "$(state '.issue[-1].body')" "$(cat "$D/summary.md")"
[ "$(log | awk '/resolveReviewThread/ { print NR; exit }')" -lt "$(log | awk '/POST repos\/acme\/widgets\/issues/ { print NR; exit }')" ]
ok "1: ...after the thread writes" $?
has "1: the threads are read through the scope-checked list, resolved ones included" "$(log)" "reviewThreads(first:100"
has "1: ...for this repository" "$(log)" "-f owner=acme -f repo=widgets -F pr=7"

fresh
(cd "$WORKDIR" && bash "$HELPER" --repo acme/widgets --pr 7 --dispositions d/dispositions.tsv --summary d/summary.md >"$WORKDIR/out" 2>/dev/null)
is "1: a relative dispositions path still finds its reply files" "$(head -n 1 "$WORKDIR/out")" "outcome=published"

fresh
printf '\r\nT1\tresolve\tt1.md\r\n\n' >"$D/dispositions.tsv"
publish
has "1: blank lines and CRLF line ends are read through" "$OUT" "thread=T1	reply=posted	resolve=done"

fresh
call --repo acme/widgets --pr 7 --no-threads --summary "$D/summary.md"
is "1: a publication owing no thread posts the Summary alone" "$(val outcome)" published
is "1: ...with no reply and no resolve" "$(writes)" 1
has "1: ...and still reports the unresolved threads" "$OUT" "unlisted=T1"
has "1: ...all of them" "$OUT" "unlisted=T3"

# --- 2. a second run posts nothing twice ---------------------------------------
fresh
echo 102 >"$FAKE/fail-reply"
publish
is "2: a refused reply is partial" "$(val outcome)" partial
is "2: ...with exit 3" "$RC" 3
has "2: ...naming the thread, its resolve not attempted" "$OUT" "thread=T2	reply=failed	resolve=skipped	-"
has "2: the lines before it still landed" "$OUT" "thread=T1	reply=posted	resolve=done"
has "2: the Summary waits for the re-run" "$OUT" "summary=withheld"
is "2: ...unposted" "$(summaries)" 0
has "2: ...and stderr says to run it again" "$ERR" "Run this again with the same files"
rm "$FAKE/fail-reply"
publish
is "2: the re-run completes the publication" "$(val outcome)" published
has "2: ...finding the settled thread resolved, its reply there" "$OUT" "thread=T1	reply=present	resolve=already	https://github.com/acme/widgets/pull/7#discussion_r901"
has "2: ...and posting the reply that failed" "$OUT" "thread=T2	reply=posted	resolve=open"
is "2: no thread holds two replies" "$(state '[.threads[].comments | length] | join(" ")')" "2 2 1 1"
is "2: the Summary is posted once" "$(summaries)" 1
: >"$FAKE/gh.log"
publish
is "2: a third run finds everything there" "$(val outcome)" published
has "2: ...the open thread's reply" "$OUT" "thread=T2	reply=present	resolve=open	https://github.com/acme/widgets/pull/7#discussion_r"
has "2: ...and the Summary" "$OUT" "summary=present	https://github.com/acme/widgets/pull/7#issuecomment-"
is "2: ...and writes nothing" "$(writes)" 0

fresh
echo T1 >"$FAKE/fail-resolve"
publish
has "2: a refused resolve leaves the reply posted" "$OUT" "thread=T1	reply=posted	resolve=failed	https://github.com/acme/widgets/pull/7#discussion_r901"
is "2: ...as a partial run" "$(val outcome)" partial
has "2: ...which does not stop the line after it" "$OUT" "thread=T2	reply=posted	resolve=open"
has "2: ...but withholds the Summary" "$OUT" "summary=withheld"
rm "$FAKE/fail-resolve"
publish
has "2: the re-run resolves it without replying again" "$OUT" "thread=T1	reply=present	resolve=done"
is "2: ...one reply on the thread" "$(state '.threads[0].comments | length')" 2
is "2: ...and published" "$(val outcome)" published

fresh
echo T1 >"$FAKE/unresolved"
publish
has "2: a resolve GitHub answers as unresolved is failed, not done" "$OUT" "thread=T1	reply=posted	resolve=failed"
is "2: ...and partial" "$RC" 3

fresh
echo 101 >"$FAKE/lost-reply"
publish
has "2: a reply reported failed is failed, and its thread is not resolved" "$OUT" "thread=T1	reply=failed	resolve=skipped"
is "2: ...whatever landed" "$(state '.threads[0] | [.isResolved, (.comments | length)] | join(" ")')" "false 2"
rm "$FAKE/lost-reply"
publish
has "2: the re-run finds the reply that did land" "$OUT" "thread=T1	reply=present	resolve=done"
is "2: ...and posts no second one" "$(state '.threads[0].comments | length')" 2

fresh
touch "$FAKE/no-url"
publish
has "2: a reply answered without a url is not counted as posted" "$OUT" "thread=T1	reply=failed	resolve=skipped"
fresh
call --repo acme/widgets --pr 7 --no-threads --summary "$D/summary.md"
touch "$FAKE/no-url"
call --repo acme/widgets --pr 7 --no-threads --summary "$D/summary.md"
has "2: ...and a Summary already there is found by its body, whatever a write answers" "$OUT" "summary=present"
fresh
touch "$FAKE/no-url"
call --repo acme/widgets --pr 7 --no-threads --summary "$D/summary.md"
has "2: nor is a Summary answered without one" "$OUT" "summary=failed"
is "2: ...which is partial" "$RC" 3

fresh
touch "$FAKE/fail-summary"
publish
has "2: a refused Summary is reported" "$OUT" "summary=failed"
is "2: ...as a partial run" "$(val outcome)" partial
has "2: ...with the thread lines it follows" "$OUT" "thread=T1	reply=posted	resolve=done"
rm "$FAKE/fail-summary"
publish
has "2: the re-run posts it" "$OUT" "summary=posted"
is "2: ...over threads it leaves alone" "$(replies)" 2
is "2: ...exactly once" "$(state '[.issue[] | select(.user.login == "me-bot")] | length')" 1

fresh
touch "$FAKE/fail-list"
publish
has "2: with the PR's comments unread, no Summary is posted over one that may be there" "$OUT" "summary=failed"
is "2: ...none at all" "$(summaries)" 0
is "2: ...and the run is partial" "$RC" 3

fresh
add_reply T2 alice "$(cat "$D/t2.md")"
publish
has "2: another user's equal reply is not this run's" "$OUT" "thread=T2	reply=posted"
fresh
add_reply T2 me-bot "an earlier, different reply"
publish
has "2: nor is a different reply of the authenticated user" "$OUT" "thread=T2	reply=posted"
fresh
add_reply T2 me-bot "$(printf '\r\nNot changing this: the caller already checks.  \r\n\r\nSee run().\r\n\r\n')"
publish
has "2: an equal reply is recognised across line ends and outer whitespace" "$OUT" "thread=T2	reply=present	resolve=open	https://github.com/acme/widgets/pull/7#discussion_r555"
fresh
jq --rawfile b "$D/t1.md" '.threads[0].comments[0] |= (.author.login = "me-bot" | .body = $b)' "$FAKE/state.json" >"$FAKE/state.new" && mv "$FAKE/state.new" "$FAKE/state.json"
publish
has "2: the comment under review is never taken for the reply to it" "$OUT" "thread=T1	reply=posted"
fresh
jq --rawfile b "$D/summary.md" '.issue += [{id: 2, user: {login: "alice"}, body: $b, html_url: "u"}]' "$FAKE/state.json" >"$FAKE/state.new" && mv "$FAKE/state.new" "$FAKE/state.json"
publish
has "2: another user's equal comment is not this run's Summary" "$OUT" "summary=posted"
fresh
jq '.issue += [{id: 2, user: {login: "me-bot"}, body: "@codex review", html_url: "u"}]' "$FAKE/state.json" >"$FAKE/state.new" && mv "$FAKE/state.new" "$FAKE/state.json"
publish
has "2: nor is a different comment of the authenticated user" "$OUT" "summary=posted"
fresh
jq '.issue += [{id: 2, user: {login: "me-bot"}, body: "\r\n## Summary of Review Fixes  \r\n\r\n- quoted the path\r\n\r\n", html_url: "https://github.com/acme/widgets/pull/7#issuecomment-2"}]' "$FAKE/state.json" >"$FAKE/state.new" && mv "$FAKE/state.new" "$FAKE/state.json"
publish
has "2: an equal Summary is recognised across line ends and outer whitespace" "$OUT" "summary=present	https://github.com/acme/widgets/pull/7#issuecomment-2"

fresh
printf 'T4\tresolve\tt1.md\nT1\treply\tt1.md\n' >"$D/dispositions.tsv"
publish
has "2: a thread found resolved still gets its reply" "$OUT" "thread=T4	reply=posted	resolve=already	https://github.com/acme/widgets/pull/7#discussion_r901"
is "2: ...and the run publishes" "$(val outcome)" published
is "2: no resolve is asked for it, nor for a reply line" "$(count resolveReviewThread)" 0
jq '.threads[1].isResolved = true' "$FAKE/state.json" >"$FAKE/state.new" && mv "$FAKE/state.new" "$FAKE/state.json"
printf 'T2\treply\tt2.md\n' >"$D/dispositions.tsv"
publish
has "2: a reply line's thread found resolved is reported as it stands" "$OUT" "thread=T2	reply=posted	resolve=already"

# A `-` line: an earlier run replied, a later one owes the resolve alone.
fresh
add_reply T1 me-bot "Fixed in 0ld5ha1: quoted the path"
printf 'T1\tresolve\t-\nT2\treply\tt2.md\n' >"$D/dispositions.tsv"
publish
has "2: a resolve line with - resolves on the reply already there" "$OUT" "thread=T1	reply=present	resolve=done	https://github.com/acme/widgets/pull/7#discussion_r555"
is "2: ...posting no second reply on that thread" "$(state '.threads[0] | [.isResolved, (.comments | length)] | join(" ")')" "true 2"
is "2: ...only the other line's" "$(replies)" 1
is "2: ...and the run publishes" "$(val outcome)" published
: >"$FAKE/gh.log"
publish
has "2: run again, it finds the thread resolved" "$OUT" "thread=T1	reply=present	resolve=already	https://github.com/acme/widgets/pull/7#discussion_r555"
is "2: ...and writes nothing" "$(writes)" 0

# The same on a `reply` line: the reply stands and no resolve is owed, so the
# thread's outcome still comes from a line of the helper's.
fresh
add_reply T2 me-bot "Not changing this, as said in the last round."
printf 'T1\tresolve\tt1.md\nT2\treply\t-\n' >"$D/dispositions.tsv"
publish
has "2: a reply line with - stands on the reply already there" "$OUT" "thread=T2	reply=present	resolve=open	https://github.com/acme/widgets/pull/7#discussion_r555"
is "2: ...posting no second reply on that thread and leaving it open" "$(state '.threads[1] | [.isResolved, (.comments | length)] | join(" ")')" "false 2"
is "2: ...only the other line's" "$(replies)" 1
is "2: ...and the run publishes" "$(val outcome)" published
fresh
printf 'T1\tresolve\tt1.md\nT2\treply\t-\n' >"$D/dispositions.tsv"
publish
is "2: a reply line with - on a thread holding no reply is refused" "$(val outcome)" no-reply
has "2: ...by name" "$OUT" "unreplied=T2"
is "2: ...before any write, the line ahead of it included" "$(writes)" 0

unreplied() { # <label> — after the PR is arranged
	printf 'T2\treply\tt2.md\nT1\tresolve\t-\n' >"$D/dispositions.tsv"
	publish
	is "2: a resolve line with - on $1 is refused" "$(val outcome)" no-reply
	is "2: ...with exit 3" "$RC" 3
	has "2: ...by name" "$OUT" "unreplied=T1"
	is "2: ...before any write, the line ahead of it included" "$(writes)" 0
	lacks "2: ...and no thread line claims one" "$OUT" "thread="
}
fresh
unreplied "a thread holding no reply"
has "2: ...stderr saying what the line needs" "$ERR" "give that line the reply's file"
fresh
jq '.threads[0].comments[0].author.login = "me-bot"' "$FAKE/state.json" >"$FAKE/state.new" && mv "$FAKE/state.new" "$FAKE/state.json"
unreplied "a thread whose first comment is the authenticated user's only one"
fresh
add_reply T1 alice "Fixed, I think"
unreplied "a thread only another user replied on"
fresh
printf 'PRRT_other\tresolve\t-\nT1\tresolve\t-\n' >"$D/dispositions.tsv"
publish
is "2: a thread that is not this PR's is said first" "$(val outcome)" foreign-thread

# --- 3. a thread that is not this PR's -----------------------------------------
fresh
printf 'T1\tresolve\tt1.md\nPRRT_other\tresolve\tt1.md\nT2\treply\tt2.md\n' >"$D/dispositions.tsv"
publish
is "3: a thread id the PR does not hold is refused" "$(val outcome)" foreign-thread
is "3: ...with exit 3" "$RC" 3
has "3: ...by name" "$OUT" "foreign=PRRT_other"
is "3: ...before any write, to that thread or to the PR's own" "$(writes)" 0
lacks "3: ...and no thread line claims one" "$OUT" "thread="

fresh
jq --argjson t "$(thread T9 109 codex-bot false 9)" '.threads += [$t]' "$FAKE/state.json" >"$FAKE/state.new" && mv "$FAKE/state.new" "$FAKE/state.json"
printf 'T9\tresolve\tt1.md\n' >"$D/dispositions.tsv"
publish
is "3: a thread list naming another PR's comments is contaminated" "$(val outcome)" contaminated
is "3: ...with exit 3" "$RC" 3
is "3: ...and nothing is written, the thread it smuggled in included" "$(writes)" 0
has "3: ...the list's own diagnosis relayed" "$ERR" "do not belong to acme/widgets PR #7"

fresh
touch "$FAKE/fail-threads"
publish
is "3: a thread list that cannot be read is a failure" "$RC" 1
is "3: ...with no outcome" "$OUT" ""
is "3: ...and no write" "$(writes)" 0
fresh
touch "$FAKE/fail-threads"
call --repo acme/widgets --pr 7 --no-threads --summary "$D/summary.md"
is "3: ...and no Summary posted over threads it could not list" "$RC $(writes)" "1 0"
fresh
touch "$FAKE/fail-user"
publish
is "3: an unreadable authenticated user is a failure" "$RC" 1
is "3: ...before any write" "$(writes)" 0
fresh
touch "$FAKE/empty-user"
publish
is "3: so is an authenticated user with no login" "$RC" 1
is "3: ...before any write" "$(writes)" 0
fresh
jq '.threads[0].comments[0].databaseId = null' "$FAKE/state.json" >"$FAKE/state.new" && mv "$FAKE/state.new" "$FAKE/state.json"
publish
is "3: a thread with no comment id to reply under is a failure" "$RC" 1
is "3: ...before any write" "$(writes)" 0

# --- 4. a file that cannot be published, and usage -----------------------------
malformed() { # <label> — after the files are arranged
	publish
	is "4: $1 is malformed" "$(val outcome)" malformed
	is "4: ...with exit 3" "$RC" 3
	is "4: ...and asks GitHub nothing" "$(log)" ""
}
fresh
printf 'T1 resolve t1.md\n' >"$D/dispositions.tsv"
malformed "a line without tabs"
fresh
printf 'T1\tresolve\tt1.md\textra\n' >"$D/dispositions.tsv"
malformed "a line of four fields"
fresh
printf 'T1\tresolve\t\n' >"$D/dispositions.tsv"
malformed "a line with no reply file"
fresh
printf '\tresolve\tt1.md\n' >"$D/dispositions.tsv"
malformed "a line with no thread id"
fresh
printf 'T1\tdismiss\tt1.md\n' >"$D/dispositions.tsv"
malformed "an unknown action"
has "4: ...named on stderr" "$ERR" 'names the action "dismiss"'
fresh
printf 'T1\tresolve\tt1.md\nT1\treply\tt2.md\n' >"$D/dispositions.tsv"
malformed "a thread named twice"
fresh
printf 'T1\tresolve\tabsent.md\n' >"$D/dispositions.tsv"
malformed "a missing reply file"
fresh
printf ' \n\t\n' >"$D/t1.md"
malformed "a reply of whitespace alone"
fresh
printf '\n\n' >"$D/dispositions.tsv"
malformed "a dispositions file naming no thread"
has "4: ...pointing at --no-threads" "$ERR" "--no-threads"
fresh
rm "$D/dispositions.tsv"
malformed "a missing dispositions file"
fresh
: >"$D/summary.md"
malformed "an empty Summary"
fresh
rm "$D/summary.md"
malformed "a missing Summary"

fresh
misuse() { # <label> [args...]
	local label="$1"
	shift
	call "$@"
	is "4: $label is a usage error" "$RC" 64
	is "4: ...with nothing on stdout" "$OUT" ""
}
misuse "no repository" --pr 7 --no-threads --summary "$D/summary.md"
misuse "a bare repository name" --repo widgets --pr 7 --no-threads --summary "$D/summary.md"
misuse "a host-qualified repository, which the thread list cannot read" --repo ghe.example.com/acme/widgets --pr 7 --no-threads --summary "$D/summary.md"
has "4: ...saying why" "$ERR" "reads no other host"
misuse "no PR" --repo acme/widgets --no-threads --summary "$D/summary.md"
misuse "a PR that is not a number" --repo acme/widgets --pr 7a --no-threads --summary "$D/summary.md"
misuse "no Summary" --repo acme/widgets --pr 7 --no-threads
misuse "neither --dispositions nor --no-threads" --repo acme/widgets --pr 7 --summary "$D/summary.md"
misuse "both of them" --repo acme/widgets --pr 7 --no-threads --dispositions "$D/dispositions.tsv" --summary "$D/summary.md"
misuse "an unknown argument" --repo acme/widgets --pr 7 --no-threads --summary "$D/summary.md" --force yes
misuse "a flag without its value" --repo acme/widgets --pr 7 --no-threads --summary
is "4: a usage error asks GitHub nothing" "$(log)" ""

# --- 5. the shipped files -------------------------------------------------------
cmp -s "$SHIPPED" "$MIRROR"
ok "5: the Codex mirror ships the same helper, byte for byte" $?
for f in plugins/dev-skills/skills/address-review/publish.sh codex/dev-skills/skills/address-review/publish.sh plugins/dev-skills/bin/address-review-publish; do
	mode="$(git -c safe.directory='*' -C "$SCRIPT_DIR/.." ls-files -s -- "$f" | cut -d' ' -f1)"
	is "5: $f is committed executable" "$mode" 100755
done
OUT="$(bash "$SHIPPED" --help 2>&1)"
has "5: the helper prints its contract" "$OUT" "publish.sh --repo"
has "5: ...to its last line" "$OUT" "Written for bash 3.2 and later."
lacks "5: ...and none of its code" "$OUT" "set -u"
fresh
OUT="$(bash "$SHIM" --repo acme/widgets --pr 7 --dispositions "$D/dispositions.tsv" --summary "$D/summary.md" 2>&1)"
has "5: the bin/ shim runs the same helper" "$OUT" "outcome=published"
ln -s "$SHIM" "$WORKDIR/linked"
OUT="$(bash "$WORKDIR/linked" --repo acme/widgets --pr 7 --dispositions "$D/dispositions.tsv" --summary "$D/summary.md" 2>&1)"
has "5: ...through a symlink too, meeting what the first run left" "$OUT" "summary=present"

if [ "$fails" -gt 0 ]; then
	printf 'address-review publish helper test: %d/%d checks FAILED.\n' "$fails" "$checks" >&2
	exit 1
fi
printf 'address-review publish helper test passed (%d checks).\n' "$checks"
