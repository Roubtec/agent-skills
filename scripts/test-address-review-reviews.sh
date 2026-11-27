#!/usr/bin/env bash
# Hermetic test for the address-review review-listing helper
# (plugins/dev-skills/skills/address-review/reviews.sh).
#
# Nothing here reaches the network: `gh` is a fake that logs every call and
# answers the three REST listings from canned JSON, a page at a time, and the
# comparison with a head runs in a throwaway repository. Needs Bash, jq, git
# and coreutils.
# shellcheck disable=SC2319,SC2016 # `ok <label> $?` after a `[ … ]` test is the point; the backticks in canned bodies are Markdown
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SHIPPED="$SCRIPT_DIR/../plugins/dev-skills/skills/address-review/reviews.sh"
HELPER="${REVIEWS_HELPER:-$SHIPPED}"
MIRROR="$SCRIPT_DIR/../codex/dev-skills/skills/address-review/reviews.sh"
SHIM="$SCRIPT_DIR/../plugins/dev-skills/bin/address-review-reviews"
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
# Files under $FAKE steer it:
#   reviews.<page>.json, comments.<page>.json, toplevel.<page>.json
#                                 one page of a listing; a page with no file
#                                 is `[]`
#   <listing>.<page>.once.json    served instead, once
#   fail-reviews, fail-comments, fail-toplevel
printf '%s\n' "$*" >>"$FAKE/gh.log"
[ "$1" = api ] || exit 1
shift
[ "$1" != --hostname ] || shift 2
case "$1" in
repos/[Aa]cme/[Ww]idgets/pulls/7/reviews\?per_page=100\&page=*) kind=reviews ;;
repos/[Aa]cme/[Ww]idgets/pulls/7/comments\?per_page=100\&page=*) kind=comments ;;
repos/[Aa]cme/[Ww]idgets/issues/7/comments\?per_page=100\&page=*) kind=toplevel ;;
*) exit 1 ;;
esac
[ ! -f "$FAKE/fail-$kind" ] || exit 1
page="${1##*page=}"
if [ -f "$FAKE/$kind.$page.once.json" ]; then
	cat "$FAKE/$kind.$page.once.json"
	rm "$FAKE/$kind.$page.once.json"
elif [ -f "$FAKE/$kind.$page.json" ]; then
	cat "$FAKE/$kind.$page.json"
else
	echo '[]'
fi
FAKEGH
chmod +x "$FAKE/gh"
export PATH="$FAKE:$PATH"

PRURL=https://github.com/acme/widgets/pull/7
A=1111111111111111111111111111111111111111
# review <id> <login> <type> <state> <commit> <body> [<html_url>]
review() {
	jq -cn --argjson id "$1" --arg login "$2" --arg type "$3" --arg state "$4" --arg commit "$5" --arg body "$6" \
		--arg url "${7:-$PRURL#pullrequestreview-$1}" \
		'{id: $id, user: {login: $login, type: $type}, state: $state, commit_id: $commit, body: $body, html_url: $url, submitted_at: "2026-08-15T09:38:25Z"}'
}
# comment <id> <review id> [<html_url>]
comment() {
	jq -cn --argjson id "$1" --argjson rid "$2" --arg url "${3:-$PRURL#discussion_r$1}" \
		'{id: $id, pull_request_review_id: $rid, html_url: $url, user: {login: "Copilot"}}'
}
# toplevel <id> <login> <body> [<html_url>]
toplevel() {
	jq -cn --argjson id "$1" --arg login "$2" --arg body "$3" --arg url "${4:-$PRURL#issuecomment-$1}" \
		'{id: $id, user: {login: $login}, body: $body, html_url: $url}'
}
page() { # <file> <object>...
	local file="$1"
	shift
	printf '%s\n' "$@" | jq -cs . >"$FAKE/$file"
}
fresh() { rm -f "$FAKE"/*.json "$FAKE"/fail-* "$FAKE/gh.log"; }
call() { # [args...] → OUT (stdout), ERR (stderr), RC
	OUT="$(bash "$HELPER" "$@" 2>"$WORKDIR/err")"
	RC=$?
	ERR="$(cat "$WORKDIR/err")"
}
val() { printf '%s\n' "$OUT" | sed -n "s/^$1=//p" | head -n 1; }
# rv <review id> <jq filter> → that review's line, filtered
rv() { printf '%s\n' "$OUT" | sed -n 's/^review=//p' | jq -c --argjson id "$1" "select(.id == \$id) | $2"; }
log() { cat "$FAKE/gh.log" 2>/dev/null; }
ARGS=(--repo acme/widgets --pr 7)

# The two openings Copilot's reviews gave the block, and the earlier wording.
DETAILS="$(printf '## Pull request overview\r\n\r\nCopilot reviewed 3 out of 3 changed files and generated 1 comment.\r\n\r\n<details>\r\n<summary>Suppressed comments (2)</summary>\r\n\r\n**README.md:39**\r\n* The layout bullet contradicts the next sentence.\r\n```\r\n- **`codex/`** mirrors the plugin tree.\r\n# a heading inside the excerpt\r\n</details>\r\n```\r\n**src/a b.sh:7**\r\n* An unquoted expansion.\r\n</details>\r\n\r\n---\r\n\r\nfooter\r\n')"
HEADING="$(printf '### Changes recommended\n\n<details>\n<summary>Review details</summary>\n\n### Suppressed comments (1)\n\n**docs/guide.md:25**\n* Same note as above.\n```\nan excerpt\n```\n\n- **Files reviewed:** 8/8 changed files\n- **Comments generated:** 7\n</details>\n')"
EARLIER="$(printf '<details>\n<summary>Comments suppressed due to low confidence (1)</summary>\n\n**lib/x.py:3**\n* Unused import.\n</details>\n')"

# --- 1. the listing -----------------------------------------------------------
fresh
page reviews.1.json \
	"$(review 101 'copilot-pull-request-reviewer[bot]' Bot COMMENTED "$A" "$DETAILS")" \
	"$(review 102 'copilot-pull-request-reviewer[bot]' Bot COMMENTED "$A" "$HEADING")" \
	"$(review 103 alice User CHANGES_REQUESTED "$A" 'Please split this.')" \
	"$(review 104 alice User PENDING "$A" 'a draft')" \
	"$(review 105 'claude[bot]' Bot COMMENTED "$A" 'Found 3 issues: 2 bugs, 1 nit. Each is in its own thread.')" \
	"$(review 106 'chatgpt-codex-connector[bot]' Bot DISMISSED "$A" "$EARLIER")" \
	"$(review 107 bob User COMMENTED "$A" '')"
page comments.1.json "$(comment 1 101)" "$(comment 2 103)" "$(comment 3 103)" "$(comment 4 107)"
page toplevel.1.json \
	"$(toplevel 11 roubtec "## Summary of Review Fixes\n- $PRURL#pullrequestreview-101, finding 1 of 2: pushed back")" \
	"$(toplevel 12 alice "see $PRURL#pullrequestreview-1011 and $PRURL#pullrequestreview-10")" \
	"$(toplevel 13 alice "skip ($PRURL#pullrequestreview-101)")"
call "${ARGS[@]}"
is "1: a pull request with reviews is listed" "$(val outcome)" "listed"
is "1: ...with exit 0" "$RC" 0
is "1: outcome= is the first line" "$(printf '%s\n' "$OUT" | head -n 1)" "outcome=listed"
is "1: one line per submitted review, a pending one left out" "$(printf '%s\n' "$OUT" | grep -c '^review=')" 6
is "1: a review names its author, whether that is a bot, its state, its commit and its permalink" \
	"$(rv 103 '[.author, .bot, .state, .commit, .url]')" "[\"alice\",false,\"CHANGES_REQUESTED\",\"$A\",\"$PRURL#pullrequestreview-103\"]"
is "1: a bot is told by the account's type" "$(rv 101 '[.author, .bot]')" '["copilot-pull-request-reviewer[bot]",true]'
is "1: the inline comments a review authored are counted to it alone" "$(rv 101 .inline),$(rv 103 .inline),$(rv 107 .inline)" "1,2,1"
is "1: a bot review with a body and no inline comment shows both" "$(rv 105 '[.bot, .inline, .body]')" '[true,0,"Found 3 issues: 2 bugs, 1 nit. Each is in its own thread."]'
is "1: a review names the top-level comments that cite its permalink, and no comment citing a longer id" \
	"$(rv 101 .cited)" "[{\"url\":\"$PRURL#issuecomment-11\",\"author\":\"roubtec\"},{\"url\":\"$PRURL#issuecomment-13\",\"author\":\"alice\"}]"
is "1: ...and none where nothing cites it" "$(rv 103 .cited)" "[]"
is "1: a body with no block has none" "$(rv 105 .suppressed)" "null"
is "1: an empty body has none" "$(rv 107 '[.body, .suppressed]')" '["",null]'
is "1: a dismissed review keeps its state" "$(rv 106 .state)" '"DISMISSED"'
is "1: the <details> form gives its declared count and is parsed" "$(rv 101 '.suppressed | [.declared, .parsed, (.entries | length)]')" "[2,true,2]"
is "1: ...each entry with its file and line, in the body's order" "$(rv 101 '[.suppressed.entries[] | [.file, .line]]')" '[["README.md",39],["src/a b.sh",7]]'
is "1: ...and its text, the excerpt included, a heading or a closing tag inside the fence not ending it" \
	"$(rv 101 '.suppressed.entries[0].text')" '"* The layout bullet contradicts the next sentence.\n```\n- **`codex/`** mirrors the plugin tree.\n# a heading inside the excerpt\n</details>\n```"'
is "1: ...the block ending at its closing tag" "$(rv 101 '.suppressed.entries[1].text')" '"* An unquoted expansion."'
is "1: the heading form is parsed, ending before the list that follows it" \
	"$(rv 102 '.suppressed | [.declared, .parsed, .entries[0].file, .entries[0].line, .entries[0].text]')" '[1,true,"docs/guide.md",25,"* Same note as above.\n```\nan excerpt\n```"]'
is "1: the earlier wording is parsed" "$(rv 106 '.suppressed | [.declared, .parsed, .entries[0].file, .entries[0].line]')" '[1,true,"lib/x.py",3]'
is "1: without --head nothing is compared" "$(rv 101 '[has("current"), (.suppressed.entries[0] | has("changed"))]')" "[false,false]"
lacks "1: ...and no head line is printed" "$OUT" "head="
lacks "1: no listing is read with --paginate" "$(log)" "--paginate"
is "1: the three listings are read, a page at a time" "$(log)" "api repos/acme/widgets/pulls/7/reviews?per_page=100&page=1
api repos/acme/widgets/pulls/7/comments?per_page=100&page=1
api repos/acme/widgets/issues/7/comments?per_page=100&page=1"

fresh
call "${ARGS[@]}"
is "1: a pull request with no review is none" "$(val outcome)" "none"
is "1: ...with exit 0 and nothing listed" "$RC,$(printf '%s\n' "$OUT" | grep -c '^review=')" "0,0"

# --- 2. a block the parser does not recognise ---------------------------------
fresh
page reviews.1.json \
	"$(review 201 'copilot-pull-request-reviewer[bot]' Bot COMMENTED "$A" "$(printf '<details>\n<summary>Suppressed comments (2)</summary>\n\n**README.md:39**\n* Only one of the two.\n</details>\n')")" \
	"$(review 202 'copilot-pull-request-reviewer[bot]' Bot COMMENTED "$A" "$(printf '<b>Suppressed comments: 2</b>\n\n<i>README.md, line 39</i>: a new markup.\n')")" \
	"$(review 203 'copilot-pull-request-reviewer[bot]' Bot COMMENTED "$A" "$(printf '<details>\n<summary>Suppressed comments (1)</summary>\n\n**README.md:39-41**\n* A range.\n</details>\n')")" \
	"$(review 204 'copilot-pull-request-reviewer[bot]' Bot COMMENTED "$A" "$(printf 'The overview.\n\n```\n<summary>Suppressed comments (1)</summary>\n**README.md:39**\n```\n')")" \
	"$(review 205 'copilot-pull-request-reviewer[bot]' Bot COMMENTED "$A" "$(printf '<details>\n<summary>Suppressed comments (0)</summary>\n</details>\n')")"
call "${ARGS[@]}"
is "2: fewer entries than the heading declares is a block present and unparsed, with none of them given" "$(rv 201 .suppressed)" '{"declared":2,"parsed":false,"entries":[]}'
is "2: ...beside the review's permalink" "$(rv 201 .url)" "\"$PRURL#pullrequestreview-201\""
is "2: a markup the parser was not written against is a block present and unparsed, never no block" "$(rv 202 .suppressed)" '{"declared":null,"parsed":false,"entries":[]}'
is "2: an entry heading in another shape is unparsed" "$(rv 203 .suppressed)" '{"declared":1,"parsed":false,"entries":[]}'
is "2: a block quoted inside a code fence is not one" "$(rv 204 .suppressed)" "null"
is "2: a block declaring none is parsed and empty" "$(rv 205 .suppressed)" '{"declared":0,"parsed":true,"entries":[]}'

# --- 3. scope -----------------------------------------------------------------
foreign() { # <label> <outcome>
	is "3: $1 stops as $2" "$(val outcome)" "$2"
	is "3: ...with exit 3" "$RC" 3
	lacks "3: ...and lists nothing" "$OUT" "review="
}
fresh
page reviews.1.json "$(review 301 alice User COMMENTED "$A" ok)" "$(review 302 mallory User COMMENTED "$A" 'not here' https://github.com/acme/widgets/pull/9#pullrequestreview-302)"
call "${ARGS[@]}"
foreign "a review of another pull request" foreign
has "3: ...naming the url that is not this pull request's" "$ERR" "https://github.com/acme/widgets/pull/9#pullrequestreview-302"
is "3: ...after reading the whole listing a second time" "$(log | grep -c 'pulls/7/reviews')" 2

fresh
page reviews.1.json "$(review 303 alice User COMMENTED "$A" ok https://github.com/acme/widgets/pull/70#pullrequestreview-303)"
call "${ARGS[@]}"
foreign "a pull request whose number only starts with this one's" foreign
fresh
page reviews.1.json "$(review 304 alice User COMMENTED "$A" ok https://github.com/acme/gadgets/pull/7#pullrequestreview-304)"
call "${ARGS[@]}"
foreign "the same number in another repository" foreign
fresh
page reviews.1.json "$(review 305 alice User COMMENTED "$A" ok)"
page comments.1.json "$(comment 5 305)" "$(comment 6 305 https://github.com/acme/widgets/pull/8#discussion_r6)"
call "${ARGS[@]}"
foreign "an inline comment of another pull request" foreign
fresh
page reviews.1.json "$(review 311 alice User COMMENTED "$A" ok)"
page toplevel.1.json "$(toplevel 14 alice hello https://github.com/acme/widgets/pull/8#issuecomment-14)"
call "${ARGS[@]}"
foreign "a top-level comment of another pull request" foreign
fresh
page reviews.1.json "$(review 306 alice User COMMENTED "$A" ok | jq -c 'del(.html_url)')"
call "${ARGS[@]}"
foreign "a review with no url to place it by" foreign

fresh
page reviews.1.json "$(review 307 alice User COMMENTED "$A" ok)"
page reviews.1.once.json "$(review 308 mallory User COMMENTED "$A" crossed https://github.com/acme/widgets/pull/9#pullrequestreview-308)"
call "${ARGS[@]}"
is "3: a foreign answer followed by a clean one is listed from the clean one" "$(val outcome),$RC,$(rv 307 .id),$(rv 308 .id)" "listed,0,307,"

fresh
page reviews.1.json "$(review 309 alice User COMMENTED "$A" ok https://github.com/Acme/Widgets/pull/7#pullrequestreview-309)"
call "${ARGS[@]}"
is "3: the repository's casing is not a mismatch" "$(val outcome)" "listed"
call --repo Acme/Widgets --pr 7
is "3: ...whichever side carries the capitals" "$(val outcome)" "listed"
call --repo ghe.example.com/acme/widgets --pr 7
foreign "a github.com url where another host was asked" foreign
has "3: ...the listing having been read on that host" "$(log)" "api --hostname ghe.example.com repos/acme/widgets/pulls/7/reviews?per_page=100&page=1"

fresh
echo '{"message":"Not Found"}' >"$FAKE/reviews.1.json"
call "${ARGS[@]}"
foreign "an answer that is no list" malformed
fresh
echo null >"$FAKE/reviews.1.json"
call "${ARGS[@]}"
foreign "an empty answer that is no list either" malformed
fresh
touch "$FAKE/fail-reviews"
call "${ARGS[@]}"
is "3: a gh failure is exit 1" "$RC" 1
lacks "3: ...which answers nothing, least of all none" "$OUT" "outcome="
fresh
page reviews.1.json "$(review 310 alice User COMMENTED "$A" ok)"
touch "$FAKE/fail-comments"
call "${ARGS[@]}"
is "3: an unread comment listing is exit 1 rather than a count of zero" "$RC,$OUT" "1,"
fresh
page reviews.1.json "$(review 312 alice User COMMENTED "$A" ok)"
touch "$FAKE/fail-toplevel"
call "${ARGS[@]}"
is "3: an unread top-level listing is exit 1 rather than a review nothing cites" "$RC,$OUT" "1,"

# --- 4. more than one page ----------------------------------------------------
fresh
many=()
for i in $(seq 1 100); do many+=("$(review "$((400 + i))" alice User COMMENTED "$A" '')"); done
page reviews.1.json "${many[@]}"
page reviews.2.json "$(review 501 'copilot-pull-request-reviewer[bot]' Bot COMMENTED "$A" "$EARLIER")"
call "${ARGS[@]}"
is "4: a full page is followed by the next" "$(printf '%s\n' "$OUT" | grep -c '^review=')" 101
is "4: ...whose reviews are parsed like the first's" "$(rv 501 .suppressed.parsed)" "true"
has "4: ...asked for by its number" "$(log)" "api repos/acme/widgets/pulls/7/reviews?per_page=100&page=2"

# --- 5. the comparison with a head --------------------------------------------
REPO_DIR="$WORKDIR/repo"
git init -q "$REPO_DIR"
g() { git -C "$REPO_DIR" -c user.name=t -c user.email=t@example.invalid -c commit.gpgsign=false "$@"; }
printf 'one\n' >"$REPO_DIR/same.md"
printf 'one\n' >"$REPO_DIR/edited.md"
printf 'one\n' >"$REPO_DIR/gone.md"
printf 'one\n' >"$REPO_DIR/[a].md"
printf 'one\n' >"$REPO_DIR/a.md"
g add -A
g commit -q -m first
OLD="$(g rev-parse HEAD)"
printf 'two\n' >"$REPO_DIR/edited.md"
printf 'two\n' >"$REPO_DIR/a.md"
g rm -q gone.md
g commit -q -a -m second
NEW="$(g rev-parse HEAD)"
block() { # <file>... → a body suppressing one comment on each
	printf '<details>\n<summary>Suppressed comments (%s)</summary>\n\n' "$#"
	local f
	for f in "$@"; do printf '**%s:1**\n* A comment.\n' "$f"; done
	printf '</details>\n'
}
fresh
page reviews.1.json \
	"$(review 601 'copilot-pull-request-reviewer[bot]' Bot COMMENTED "$OLD" "$(block same.md edited.md gone.md '[a].md' never.md)")" \
	"$(review 602 'copilot-pull-request-reviewer[bot]' Bot COMMENTED "$NEW" "$(block edited.md)")" \
	"$(review 603 'copilot-pull-request-reviewer[bot]' Bot COMMENTED "$A" "$(block same.md)")" \
	"$(review 604 alice User COMMENTED "$OLD" 'no block')"
OUT="$(cd "$REPO_DIR" && bash "$HELPER" "${ARGS[@]}" --head "$NEW" 2>"$WORKDIR/err")"
RC=$?
ERR="$(cat "$WORKDIR/err")"
is "5: with --head the listing names the commit it compared to" "$(val head)" "$NEW"
is "5: a review written against an earlier head is not current, one against this head is" "$(rv 601 .current),$(rv 602 .current),$(rv 604 .current)" "false,true,false"
is "5: an entry whose file is unchanged since the review's commit is same; one edited, gone, or never there is changed" \
	"$(rv 601 '[.suppressed.entries[] | [.file, .changed]]')" '[["same.md","same"],["edited.md","changed"],["gone.md","changed"],["[a].md","same"],["never.md","changed"]]'
is "5: an entry of a review against this head is same" "$(rv 602 '.suppressed.entries[0].changed')" '"same"'
is "5: a review commit this repository does not hold leaves its entries unknown" "$(rv 603 '.suppressed.entries[0].changed')" '"unknown"'
has "5: ...and says which commit" "$ERR" "$A"
is "5: ...none of which fails the listing" "$RC,$(val outcome)" "0,listed"
OUT="$(cd "$REPO_DIR" && bash "$HELPER" "${ARGS[@]}" --head HEAD 2>/dev/null)"
is "5: --head takes a name and reports the commit" "$(val head)" "$NEW"
OUT="$(cd "$REPO_DIR" && bash "$HELPER" "${ARGS[@]}" --head no-such-ref 2>/dev/null)"
is "5: a --head that names no commit is a failure, not a listing" "$?,$OUT" "1,"

# --- 6. usage -----------------------------------------------------------------
fresh
call --repo acme/widgets
is "6: no PR is a usage error" "$RC" 64
call --pr 7
is "6: no repository is a usage error" "$RC" 64
call --repo widgets --pr 7
is "6: a repository with no owner is a usage error" "$RC" 64
call "${ARGS[@]}" --all
is "6: an unknown argument is a usage error" "$RC" 64
is "6: a usage error reads nothing" "$(log)" ""

# --- 7. the shipped files -----------------------------------------------------
cmp -s "$SHIPPED" "$MIRROR"
ok "7: the Codex mirror ships the same helper, byte for byte" $?
for f in plugins/dev-skills/skills/address-review/reviews.sh codex/dev-skills/skills/address-review/reviews.sh plugins/dev-skills/bin/address-review-reviews; do
	mode="$(git -c safe.directory='*' -C "$SCRIPT_DIR/.." ls-files -s -- "$f" | cut -d' ' -f1)"
	is "7: $f is committed executable" "$mode" 100755
done
OUT="$(bash "$SHIPPED" --help 2>&1)"
has "7: the helper prints its contract" "$OUT" "reviews.sh --repo"
lacks "7: ...and none of its code" "$OUT" "set -u"
fresh
page reviews.1.json "$(review 701 alice User COMMENTED "$A" ok)"
OUT="$(bash "$SHIM" "${ARGS[@]}" 2>&1)"
has "7: the bin/ shim runs the same helper" "$OUT" '"id":701'
ln -s "$SHIM" "$WORKDIR/linked"
OUT="$(bash "$WORKDIR/linked" "${ARGS[@]}" 2>&1)"
has "7: ...through a symlink too" "$OUT" '"id":701'

if [ "$fails" -gt 0 ]; then
	printf 'address-review reviews helper test: %d/%d checks FAILED.\n' "$fails" "$checks" >&2
	exit 1
fi
printf 'address-review reviews helper test passed (%d checks).\n' "$checks"
