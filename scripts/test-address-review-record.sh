#!/usr/bin/env bash
# Hermetic test for the address-review disposition-record helper
# (plugins/dev-skills/skills/address-review/record.sh).
#
# Nothing here reaches the network: `gh` is a fake that keeps a PR's comments
# in one JSON file and runs the helper's own `--jq` expressions through the
# real `jq`, so the marker match and the field extraction are tested as
# written. Needs Bash, jq and coreutils.
# shellcheck disable=SC2319 # `ok <label> $?` after a `[ … ]` test is the point
# shellcheck disable=SC2016 # backticks in a fixture body are Markdown
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="${RECORD_HELPER:-$SCRIPT_DIR/../plugins/dev-skills/skills/address-review/record.sh}"
MIRROR="$SCRIPT_DIR/../codex/dev-skills/skills/address-review/record.sh"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
mkdir "$WORKDIR/tmp"
export TMPDIR="$WORKDIR/tmp"

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
# A PR's comments live in $FAKE/comments.json; $FAKE/me is who is asking.
echo "$*" >>"$FAKE/gh.log"
[ "$1" = api ] || exit 1
shift
if [ "$1" = --hostname ]; then
	echo "$2" >"$FAKE/host"
	shift 2
fi
method=GET path="" expr="." bodyfile=""
while [ $# -gt 0 ]; do
	case "$1" in
	--paginate) ;;
	--method)
		method="$2"
		shift
		;;
	--jq)
		expr="$2"
		shift
		;;
	-F)
		bodyfile="${2#body=@}"
		shift
		;;
	*) path="$1" ;;
	esac
	shift
done
[ ! -f "$FAKE/fail-$method" ] || exit 1
db="$FAKE/comments.json"
case "$method $path" in
"GET user") jq -r "$expr" <<<"{\"login\":\"$(cat "$FAKE/me")\"}" ;;
"GET repos/acme/widgets/issues/7/comments")
	[ ! -f "$FAKE/fail-list" ] || exit 1
	jq -r "$expr" "$db"
	;;
"PATCH repos/acme/widgets/issues/comments/"*)
	id="${path##*/}"
	jq --rawfile b "$bodyfile" --argjson id "$id" \
		'map(if .id == $id then .body = $b | .updated_at = "2026-12-31T00:00:00Z" else . end)' "$db" >"$db.new" && mv "$db.new" "$db"
	jq -r --argjson id "$id" ".[] | select(.id == \$id) | $expr" "$db"
	;;
"POST repos/acme/widgets/issues/7/comments")
	id="$(jq 'map(.id) | max + 1' "$db")"
	jq --rawfile b "$bodyfile" --argjson id "$id" --arg me "$(cat "$FAKE/me")" \
		'. + [{id: $id, user: {login: $me}, created_at: "2026-12-30T00:00:00Z", updated_at: "2026-12-30T00:00:00Z", html_url: "https://github.com/acme/widgets/pull/7#issuecomment-\($id)", body: $b}]' "$db" >"$db.new" && mv "$db.new" "$db"
	jq -r --argjson id "$id" ".[] | select(.id == \$id) | $expr" "$db"
	;;
*) exit 1 ;;
esac
FAKEGH
chmod +x "$FAKE/gh"
export PATH="$FAKE:$PATH"

MARK='<!-- address-review:disposition-record -->'
# comment <id> <login> <created_at, and updated_at> <body> → appended to the PR
comment() {
	jq --argjson id "$1" --arg login "$2" --arg at "$3" --arg b "$4" \
		'. + [{id: $id, user: {login: $login}, created_at: $at, updated_at: $at, html_url: "https://github.com/acme/widgets/pull/7#issuecomment-\($id)", body: $b}]' \
		"$FAKE/comments.json" >"$FAKE/comments.json.new" && mv "$FAKE/comments.json.new" "$FAKE/comments.json"
}
fresh() { # an empty PR, asked about by `bot`
	echo '[{"id":1,"user":{"login":"human"},"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z","html_url":"https://github.com/acme/widgets/pull/7#issuecomment-1","body":"looks good"}]' >"$FAKE/comments.json"
	echo bot >"$FAKE/me"
	rm -f "$FAKE"/fail-*
	: >"$FAKE/gh.log"
}
body_of() { jq -r --argjson id "$1" '.[] | select(.id == $id) | .body' "$FAKE/comments.json"; }
count() { jq 'length' "$FAKE/comments.json"; }
BODY='## Threads
[fixed] a.sh:3  codex  thread=PRRT_1
        url:   https://github.com/acme/widgets/pull/7#discussion_r1
        reply: "Fixed in abc: done"

## Summary comment (verbatim, ready to post)
Fixed one thing; codex raised it.'
run() { # <command> [args...] with $BODY on stdin → OUT, ERR, RC
	OUT="$(printf '%s\n' "${STDIN-$BODY}" | bash "$HELPER" "$@" 2>"$WORKDIR/err")"
	RC=$?
	ERR="$(cat "$WORKDIR/err")"
}
val() { printf '%s\n' "$OUT" | sed -n "s/^$1=//p" | head -n 1; }
line() { printf '%s\n' "$OUT" | sed -n "$1p"; }
FACTS=(--starting 111 --final 222 --head-oid 111 --base 000 --validation PASS --reviewer "Pass (2 rounds)" --peer forfeited)
R=(--pr 7 --branch task/foo "${FACTS[@]}")
P=(--repo acme/widgets "${R[@]}")

# --- 1. render: the header, by state ----------------------------------------
run render "${R[@]}" --state not-published --reason "no-push run"
is "1: a rendered record exits 0" "$RC" 0
is "1: the marker is the first line, byte for byte" "$(line 1)" "$MARK"
is "1: then the title" "$(line 2)" "# address-review packet — PR #7 (task/foo)"
is "1: then the status" "$(line 3)" "status: not published (no-push run)"
is "1: then the tips" "$(line 4)" "starting HEAD 111 | final HEAD 222 | recorded headRefOid 111"
is "1: then the gate" "$(line 5)" "base 000 | validation PASS | reviewer Pass (2 rounds) | peer forfeited"
is "1: an unpublished run's tips are local only" "$(line 6)" "the tips above are LOCAL ONLY — this run pushed nothing, so they are not on origin"
is "1: a blank line parts the header from the body" "$(line 7)" ""
is "1: and the body follows unchanged" "$(printf '%s\n' "$OUT" | tail -n +8)" "$BODY"

run render "${R[@]}" --state not-published --push noop --reason "stopped before the replies"
has "1: a no-op push keeps 'not published'" "$(line 3)" "status: not published ("
has "1: ...while saying the tips are already on origin" "$(line 6)" "so the tips above are already on origin while no reply"
lacks "1: ...and never that they are local only" "$OUT" "LOCAL ONLY"

run render "${R[@]}" --state not-published --push advanced --reason x
is "1: a push that advanced is not 'not published'" "$RC" 64

run render "${R[@]}" --state part --push advanced --reason "two replies failed" --landed "the push, 3 replies" --outstanding "2 replies, the Summary"
is "1: part-way has its own status" "$(line 3)" "status: published in part (two replies failed)"
is "1: ...and names both halves, with no tips clause after a push that advanced" "$(line 6)" "reached origin: the push, 3 replies — still outstanding: 2 replies, the Summary"
run render "${R[@]}" --state part --push noop --reason r --landed "3 replies" --outstanding "the Summary"
has "1: part-way over a no-op push says the tips were already there" "$(line 6)" "— and the tips above are already on origin, this run having put nothing there"
run render "${R[@]}" --state part --push none --reason r --landed "3 replies" --outstanding "the Summary"
has "1: part-way with no push says the tips are still local" "$(line 6)" "— and the tips above are still LOCAL-ONLY"
run render "${R[@]}" --state part --push none --reason r --landed "3 replies"
is "1: part-way needs both halves named" "$RC" 64
run render "${R[@]}" --state part --reason r --landed "the push, 3 replies" --outstanding "the Summary"
is "1: ...and the push said, since unsaid it would read as 'the tips are local'" "$RC" 64
has "1: ...which the usage error explains" "$ERR" "--state part needs --push"

run render "${R[@]}" --state unknown --push none --reason "no per-thread account"
is "1: unknown, with no push known" "$(line 3)" "status: UNKNOWN whether anything was published (no per-thread account)"
has "1: ...claims nothing about origin" "$(line 6)" "whether anything reached origin is UNKNOWN"
has "1: ...and sends the reader to the PR" "$(line 6)" "check the PR itself before acting on any tip or any entry below"
run render "${R[@]}" --state unknown --push advanced --reason "no per-thread account"
has "1: unknown after a push that advanced still says the push landed" "$(line 3)" "status: published in part (the push), and UNKNOWN whether any reply"
has "1: ...in the same terms on the line under it" "$(line 6)" "so the tips above ARE on origin"
run render "${R[@]}" --state unknown --push noop --reason "no per-thread account"
has "1: unknown after a no-op push reserves the unknown for the replies" "$(line 3)" "status: UNKNOWN whether any reply, resolve or Summary comment was published ("
has "1: ...and says the tips were already there" "$(line 6)" "so the tips above are already on origin though this run put nothing there"

run render "${R[@]}" --state unconfirmed --reason "origin: no answer"
is "1: an unconfirmed push has its own status" "$(line 3)" "status: UNKNOWN whether its push reached origin, and nothing else was published (origin: no answer)"
has "1: ...and calls the tips neither published nor local" "$(line 6)" "read the ref itself before treating the tips above as either published or local"
lacks "1: ...so never local only" "$OUT" "LOCAL ONLY"

run render "${R[@]}" --state part --incomplete --push none --reason r --landed a --outstanding b
is "1: an incomplete map says so in its status, claiming no earlier record it has not seen" "$(line 3)" "status: published in part, and this map is PARTIAL (r)"

run render "${R[@]}" --state bogus --reason r
is "1: an unknown state is a usage error" "$RC" 64
run render "${R[@]}" --state not-published
is "1: so is a missing reason" "$RC" 64
run render "${R[@]}" --state not-published --reason "two
lines"
is "1: and a header value that is not one line" "$RC" 64

# --- 2. render: what must not be posted --------------------------------------
STDIN='## Threads
## Summary comment
thanks @codex review' run render "${R[@]}" --state not-published --reason r
is "2: a bare bot mention is a stop" "$(val outcome)" mention
is "2: ...with exit 3" "$RC" 3
STDIN='## Threads
## Summary comment
reply with `@codex review` to re-run, or `gh pr comment --body "@claude review"`; mail a@codex.example; ask @codexter or @claude-bot
```sh
gh pr comment 7 --body "@copilot review"
```' run render "${R[@]}" --state not-published --reason r
is "2: a mention in a code span or a fenced block, an address and a longer name are not one" "$RC" 0
STDIN='## Threads
## Summary comment
~~~
@codex review
~~~
use ``@claude `review` `` or `` `@copilot` ``
````md
```
@codex review
```
````' run render "${R[@]}" --state not-published --reason r
is "2: nor is one in a tilde fence, a longer fence or a double-backtick span" "$RC" 0
STDIN='## Threads
## Summary comment
````md
```
quoted
````
@codex review' run render "${R[@]}" --state not-published --reason r
is "2: a shorter fence inside a longer one does not close it, so what follows the real close is seen" "$(val outcome)" mention
STDIN='## Threads
## Summary comment
```
quoted
~~~
@codex review' run render "${R[@]}" --state not-published --reason r
is "2: a fence of the other character closes nothing" "$RC" 0
STDIN='## Threads
## Summary comment
an unclosed ` and then @claude' run render "${R[@]}" --state not-published --reason r
is "2: an unclosed backtick quotes nothing" "$(val outcome)" mention
STDIN='## Threads
## Summary comment
```example `code`
@codex review' run render "${R[@]}" --state not-published --reason r
is "2: a backtick fence with a backtick in its info string is no fence" "$(val outcome)" mention
STDIN="$(printf '## Threads\n## Summary comment\n```\nquoted\n```\t\n@codex review')" run render "${R[@]}" --state not-published --reason r
is "2: a closing fence followed by a tab still closes" "$(val outcome)" mention
STDIN='## Threads
## Summary comment
escaped \` @codex review `' run render "${R[@]}" --state not-published --reason r
is "2: an escaped backtick opens no span" "$(val outcome)" mention
STDIN='## Threads
## Summary comment
Use `C:\` and ask @codex review; see `details`.' run render "${R[@]}" --state not-published --reason r
is "2: a backslash inside a span is literal, so the span closes where it closes" "$(val outcome)" mention
STDIN='## Threads
## Summary comment
a literal \\`@claude` is quoted' run render "${R[@]}" --state not-published --reason r
is "2: an escaped backslash escapes nothing after it" "$RC" 0
STDIN="$(printf '## Threads\r\n## Summary comment\r\n```\r\nquoted @codex\r\n```\r\n@codex review\r\n')" run render "${R[@]}" --state not-published --reason r
is "2: CRLF line endings do not keep a fence open" "$(val outcome)" mention
STDIN="$(printf '## Threads\r\n## Summary comment\r\n```\r\nquoted @codex\r\n```\r\nplain\r\n')" run render "${R[@]}" --state not-published --reason r
is "2: ...nor stop a body that only quotes one" "$RC" 0
STDIN='## Threads
## Summary comment
use `@codex
review` here' run render "${R[@]}" --state not-published --reason r
is "2: where it cannot tell — a span over a line break — it stops" "$(val outcome)" mention
for m in "@copilot" "@Codex flagged this" "see .@claude" "x/@COPILOT." "_@codex_ said" "__@claude__" "snake_@copilot_case"; do
	STDIN="## Threads
## Summary comment
$m" run render "${R[@]}" --state not-published --reason r
	is "2: '$m' is a mention" "$(val outcome)" mention
done
run render "${R[@]}" --state not-published --reason "waiting on @codex review"
is "2: a mention in the header is one too (--reason)" "$(val outcome)" mention
run render --pr 7 --branch b --peer "@codex PASS" --state not-published --reason r
is "2: ...whichever fact carries it (--peer)" "$(val outcome)" mention
STDIN='## Summary comment
x' run render "${R[@]}" --state not-published --reason r
is "2: a body with no Threads block is malformed" "$(val outcome)" malformed
STDIN='## Threads
x' run render "${R[@]}" --state not-published --reason r
is "2: so is one with no Summary block" "$(val outcome)" malformed

# --- 3. find -------------------------------------------------------------------
fresh
run find --repo acme/widgets --pr 7
is "3: a PR with no record says none" "$(val outcome)" none
comment 2 human 2026-02-01T00:00:00Z "what does $MARK mean?"
comment 3 bot 2026-02-02T00:00:00Z "see $MARK
in the docs"
run find --repo acme/widgets --pr 7
is "3: a comment that only quotes the marker is not a record" "$(val outcome)" none
comment 4 bot 2026-02-03T00:00:00Z "$MARK
# address-review packet — PR #7 (task/foo)
status: not published (x)"
comment 5 other 2026-02-04T00:00:00Z "$MARK
# theirs"
run find --repo acme/widgets --pr 7
is "3: a record of mine is found" "$(val outcome)" found
is "3: ...by id" "$(val id)" 4
is "3: ...and is not spent" "$(val spent)" no
has "3: another actor's record is reported, never selected, with what a reader needs to weigh it" "$OUT" "other=https://github.com/acme/widgets/pull/7#issuecomment-5 other 2026-02-04T00:00:00Z spent=no"
comment 6 bot 2026-02-05T00:00:00Z "$(printf '%s\r\n# t\r\nstatus: SPENT — x\r\n' "$MARK")"
run find --repo acme/widgets --pr 7
is "3: the most recent of mine wins, CRLF endings and all" "$(val id)" 6
is "3: ...and reads as spent" "$(val spent)" yes
has "3: ...with my older one reported" "$OUT" "other=https://github.com/acme/widgets/pull/7#issuecomment-4 bot 2026-02-03T00:00:00Z spent=no"
comment 8 bot 2026-02-05T00:00:00Z "$MARK
# written in the same second"
comment 7 bot 2026-02-05T00:00:00Z "$MARK
# listed after it, though it came first"
run find --repo acme/widgets --pr 7
is "3: of two records posted in the same second, the later comment wins" "$(val id)" 8
echo other >"$FAKE/me"
run find --repo acme/widgets --pr 7
is "3: asked by another account, the answer is theirs" "$(val id)" 5
: >"$FAKE/me"
run find --repo acme/widgets --pr 7
is "3: with no authenticated user named, nothing is answered" "$RC" 1
echo bot >"$FAKE/me"
has "3: every call names the repository" "$(cat "$FAKE/gh.log")" "repos/acme/widgets/issues/7/comments"
touch "$FAKE/fail-GET"
run find --repo acme/widgets --pr 7
is "3: a gh failure is a failure, not 'none'" "$RC" 1
is "3: ...with no outcome" "$(val outcome)" ""
rm "$FAKE/fail-GET"
touch "$FAKE/fail-list"
run find --repo acme/widgets --pr 7
is "3: so is a listing that failed once the user was known" "$RC" 1
is "3: ...which is never read as an empty PR" "$(val outcome)" ""
N="$(count)"
run post "${P[@]}" --state not-published --reason r
is "3: ...and never posted over" "$(count)" "$N"

fresh
run find --repo ghe.example.test/acme/widgets --pr 7
is "3: a host-qualified repository is read on its own host" "$(cat "$FAKE/host" 2>/dev/null)" ghe.example.test
is "3: ...by its owner and name" "$(val outcome)" none
rm -f "$FAKE/host"
run find --repo acme/widgets --pr 7
[ ! -e "$FAKE/host" ]
ok "3: ...and an unqualified one names no host, leaving gh its default" $?

# --- 4. post -------------------------------------------------------------------
fresh
run post "${P[@]}" --state not-published --reason "no-push run"
is "4: with no prior record, one is posted" "$(val outcome)" posted
is "4: ...as a new comment" "$(val superseded)" no
is "4: ...the only write" "$(count)" 2
is "4: ...whose url is reported" "$(val url)" "https://github.com/acme/widgets/pull/7#issuecomment-2"
is "4: ...and whose first line is the marker" "$(body_of 2 | head -n 1)" "$MARK"
has "4: ...carrying the body" "$(body_of 2)" 'reply: "Fixed in abc: done"'

run post "${P[@]}" --state part --push advanced --reason again --landed x --outstanding y
is "4: a second post supersedes" "$(val superseded)" yes
is "4: ...in place, adding nothing" "$(count)" 2
has "4: ...with the new status" "$(body_of 2)" "status: published in part (again)"

comment 9 other 2026-03-01T00:00:00Z "$MARK
# theirs"
run post "${P[@]}" --state not-published --reason third
is "4: another actor's record is never written over" "$(body_of 9)" "$MARK
# theirs"
has "4: ...only reported" "$OUT" "other=https://github.com/acme/widgets/pull/7#issuecomment-9 other"

BEFORE="$(body_of 2)"
run post "${P[@]}" --incomplete --state not-published --reason "one item has two dispositions"
is "4: an incomplete map is posted new" "$(val superseded)" no
is "4: ...leaving my earlier record as it was" "$(body_of 2)" "$BEFORE"
has "4: ...and naming it as still standing" "$OUT" "other=https://github.com/acme/widgets/pull/7#issuecomment-2 bot"
has "4: ...with a status that says partial and names the record that stands" "$(body_of 10)" "this map is PARTIAL — an earlier record still stands at https://github.com/acme/widgets/pull/7#issuecomment-2 ("

N="$(count)"
: >"$FAKE/gh.log"
STDIN='## Threads
## Summary comment
@claude review' run post "${P[@]}" --state not-published --reason r
is "4: a body with a mention posts nothing" "$(count)" "$N"
is "4: ...and says why" "$(val outcome)" mention
is "4: ...without so much as a gh call" "$(cat "$FAKE/gh.log")" ""
has "4: ...and tells the reader nothing was posted" "$ERR" "Nothing was posted"

touch "$FAKE/fail-PATCH"
run post "${P[@]}" --state not-published --reason r
is "4: a failed write is a failure" "$RC" 1
is "4: ...with no 'posted'" "$(val outcome)" ""
rm "$FAKE/fail-PATCH"
run post --pr 7 --branch b --state not-published --reason r
is "4: post needs the repository" "$RC" 64
fresh
touch "$FAKE/fail-POST"
run post "${P[@]}" --incomplete --state not-published --reason r
is "4: a failed first post is a failure" "$RC" 1
is "4: ...with no 'posted'" "$(val outcome)" ""
has "4: ...sending the reader to look before posting again" "$ERR" "run find before posting again"
rm "$FAKE/fail-POST"
run post "${P[@]}" --incomplete --state not-published --reason r
lacks "4: an incomplete first record claims no predecessor" "$(body_of 2)" "an earlier record still stands"
is "4: nothing is left behind in the temporary directory" "$(find "$WORKDIR/tmp" -mindepth 1 | wc -l | tr -d ' ')" 0
# The body is readable by its owner alone while it exists, whatever the umask.
printf '#!/usr/bin/env bash\nfor d in "%s"/tmp/record.*; do [ -d "$d" ] && ls -ld "$d"; done >>"%s/modes"\nexec "%s/gh.real" "$@"\n' "$WORKDIR" "$WORKDIR" "$FAKE" >"$FAKE/gh.spy"
mv "$FAKE/gh" "$FAKE/gh.real"
mv "$FAKE/gh.spy" "$FAKE/gh"
chmod +x "$FAKE/gh"
(umask 022 && printf '%s\n' "$BODY" | bash "$HELPER" post "${P[@]}" --state not-published --reason r >/dev/null 2>&1)
mv "$FAKE/gh.real" "$FAKE/gh"
is "4: while it exists, the record sits in a directory of the owner's alone, whatever the umask" "$(cut -c1-10 "$WORKDIR/modes" | sort -u)" "drwx------"

# --- 5. spend ------------------------------------------------------------------
fresh
comment 4 bot 2026-02-03T00:00:00Z "$MARK
# address-review packet — PR #7 (task/foo)
status: not published (x)

## Threads
[fixed] a.sh:3

## Summary comment
s"
comment 5 other 2026-02-04T00:00:00Z "$MARK
# theirs"
comment 6 bot 2026-02-05T00:00:00Z "$MARK
# a later partial record of mine"
run spend --repo acme/widgets --pr 7 --branch task/foo --id 4 --summary-url https://github.com/acme/widgets/pull/7#issuecomment-99
is "5: the record replayed is spent" "$(val outcome)" spent
is "5: ...keeping its marker" "$(body_of 4 | head -n 1)" "$MARK"
has "5: ...with a SPENT status naming the Summary" "$(body_of 4 | sed -n 3p)" "status: SPENT — the map this record held has since been published in full by a later run, whose Summary comment is at https://github.com/acme/widgets/pull/7#issuecomment-99"
has "5: ...saying where an unsettled item went" "$(body_of 4)" "which is where a maintainer picks it up"
lacks "5: ...and no Threads block" "$(body_of 4)" "## Threads"
lacks "5: ...nor a Summary block" "$(body_of 4)" "## Summary comment"
is "5: my more recent record is not the one spent" "$(body_of 6)" "$MARK
# a later partial record of mine"
run find --repo acme/widgets --pr 7
is "5: a spent record is still found as a record" "$(val outcome)" found
is "5: ...but spending the older one does not lift it over my later, outstanding one" "$(val id)" 6
has "5: ...and it is listed with the time it was spent" "$OUT" "other=https://github.com/acme/widgets/pull/7#issuecomment-4 bot 2026-12-31T00:00:00Z spent=yes"

run spend --repo acme/widgets --pr 7 --branch task/foo --id 5
is "5: another actor's record is not mine to spend" "$(val outcome)" absent
is "5: ...and stays as it was" "$(body_of 5)" "$MARK
# theirs"
run spend --repo acme/widgets --pr 7 --branch task/foo --id 77
is "5: a record that is gone is not replaced by another" "$(val outcome)" absent
is "5: ...nothing being written" "$(grep -c PATCH "$FAKE/gh.log")" 1
run spend --repo acme/widgets --pr 7 --branch task/foo --id 1
is "5: an ordinary comment of someone's is not a record" "$(val outcome)" absent
run spend --repo acme/widgets --pr 7 --branch task/foo
is "5: spend needs the id" "$RC" 64
has "5: ...and the usage shown includes spend" "$ERR" "record.sh spend"

# --- 6. the shipped files ------------------------------------------------------
cmp -s "$SCRIPT_DIR/../plugins/dev-skills/skills/address-review/record.sh" "$MIRROR"
ok "6: the codex mirror ships the same bytes" $?
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
for f in plugins/dev-skills/skills/address-review/record.sh codex/dev-skills/skills/address-review/record.sh; do
	is "6: $f is committed executable" "$(git -C "$ROOT" ls-files -s -- "$f" | cut -c1-6)" 100755
done
OUT="$(bash "$HELPER" --help)"
has "6: --help prints the header" "$OUT" "record.sh find"
lacks "6: ...and none of the code" "$OUT" "set -u"

if [ "$fails" -gt 0 ]; then
	echo "address-review record helper test: $fails/$checks checks FAILED." >&2
	exit 1
fi
echo "address-review record helper test passed ($checks checks)."
