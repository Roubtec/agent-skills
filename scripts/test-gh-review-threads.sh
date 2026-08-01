#!/usr/bin/env bash
set -euo pipefail

# Offline unit test for the canonical gh-review-threads helper in
# plugins/dev-skills/bin. It fetches a PR's review threads safely (manual
# pagination, never --paginate), asserts the repository/PR identity echoed by
# every threads page (repository.nameWithOwner case-insensitively and
# pullRequest.number exactly), and asserts every returned comment url belongs
# to the requested PR, failing closed with exit 3 on a persistently
# contaminated or malformed response.
#
# Sync discipline: any behavior change to gh-review-threads must update this
# suite in the same PR. Powbox keeps an importable copy as its bake-time
# consumer-contract check; keep fixture and contract changes reconcilable.
#
# Hermetic and host-independent: no live GitHub. `gh` is replaced by a PATH shim
# that serves canned JSON fixtures per invocation and records every argv, so the
# test can assert the pagination loop (fresh per-page calls with the right
# `after` cursors), that `--paginate` is never used, the scope assertion's
# boundary/repo-qualified match, the retry-once-then-fail-closed semantics, and
# nested comment fetch-up.
#
# Run from the repository root: bash scripts/test-gh-review-threads.sh
#
# Covers cases (a)–(i) — (a)–(g) from the original powbox suite and (h)–(i)
# added for the fail-closed parser/identity guards:
#   (a) unresolved-only filtering, and --all
#   (b) a two-page thread list followed via endCursor (two separate gh calls,
#       right `after` values, no --paginate)
#   (c) a contaminated response — fail closed on repeat, succeed on a clean retry
#   (d) repo/PR scope boundaries (`#`, `/`, `?`, and end-of-string)
#   (e) nested comment-page fetch-up and crossed-page fail-closed scope checks
#   (f) default repo resolution via `gh repo view` when --repo is omitted
#   (g) case-insensitive response identity and owner/repo url scope matches
#   (h) malformed thread shapes (comments null / {} / absent) — the url PARSER
#       fails, and the helper must still fail closed
#   (i) response-identity mismatch (wrong nameWithOwner / wrong PR number,
#       including a later-page mismatch) — fail closed after one whole-fetch retry
#
# Every threads-page fixture echoes the positive response identity the helper
# asserts since task 013: repository.nameWithOwner plus pullRequest.number (and
# url). Nested comments pages (.data.node...) are not identity-asserted and
# carry no identity fields.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# Exercise the canonical in-repo helper by default. Powbox's consumer copy
# preserves this override to target the baked /usr/local/bin artifact.
HELPER="${GH_REVIEW_THREADS_HELPER:-${ROOT_DIR}/plugins/dev-skills/bin/gh-review-threads}"

[ -x "$HELPER" ] || {
	echo "test-gh-review-threads: helper not found or not executable: $HELPER" >&2
	exit 1
}
command -v jq >/dev/null || {
	echo "test-gh-review-threads: jq is required" >&2
	exit 1
}

WORK="$(mktemp -d "${TMPDIR:-/tmp}/gh-review-threads-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

fails=0
checks=0

assert_eq() {
	checks=$((checks + 1))
	if [ "$2" != "$3" ]; then
		fails=$((fails + 1))
		printf 'FAIL [%s]: got %q, want %q\n' "$1" "$2" "$3" >&2
	fi
}
assert_contains() {
	checks=$((checks + 1))
	case "$2" in
	*"$3"*) ;;
	*)
		fails=$((fails + 1))
		printf 'FAIL [%s]: %q does not contain %q\n' "$1" "$2" "$3" >&2
		;;
	esac
}
assert_not_contains() {
	checks=$((checks + 1))
	case "$2" in
	*"$3"*)
		fails=$((fails + 1))
		printf 'FAIL [%s]: %q unexpectedly contains %q\n' "$1" "$2" "$3" >&2
		;;
	*) ;;
	esac
}

# --- The `gh` PATH shim ------------------------------------------------------
# Serves fixtures from $GH_STUB_DIR keyed by a per-query-type invocation counter
# and records every argv (one line per call, newlines in the query arg collapsed)
# to $GH_STUB_LOG. Classifies a call by the GraphQL variable the helper passes:
# `owner=` ⇒ the review-threads query, `threadId=` ⇒ the nested-comments query.
cat >"$WORK/gh-stub" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
line=""
for a in "$@"; do
	a="${a//$'\n'/ }"
	line="$line [$a]"
done
printf '%s\n' "$line" >>"$GH_STUB_LOG"

kind=other
for a in "$@"; do
	case "$a" in
	owner=*) kind=threads ;;
	threadId=*) kind=comments ;;
	esac
done
[ "${1:-}" = repo ] && kind=repo

serve() {
	local prefix="$1" counter="$2" n f
	n=$(($(cat "$GH_STUB_DIR/$counter" 2>/dev/null || echo 0) + 1))
	printf '%s\n' "$n" >"$GH_STUB_DIR/$counter"
	f="$GH_STUB_DIR/$prefix-$n"
	if [ ! -f "$f" ]; then
		echo "gh-stub: no fixture $f" >&2
		exit 90
	fi
	cat "$f"
}

case "$kind" in
repo) cat "$GH_STUB_DIR/repo" ;;
threads) serve threads .tn ;;
comments) serve comments .cn ;;
*)
	echo "gh-stub: unexpected invocation: $*" >&2
	exit 99
	;;
esac
STUB
chmod +x "$WORK/gh-stub"

# A fresh, isolated stub environment per case (unique dir → fresh per-query
# invocation counters). mktemp keeps it correct even though new_case runs in a
# command-substitution subshell, where a shared counter variable would not
# persist to the parent.
new_case() {
	local d
	d="$(mktemp -d "$WORK/case-XXXXXX")"
	mkdir -p "$d/bin"
	cp "$WORK/gh-stub" "$d/bin/gh"
	chmod +x "$d/bin/gh"
	printf '%s' "$d"
}

# run <case-dir> <helper args...> — sets RUN_OUT / RUN_RC / RUN_ERR / RUN_LOG.
run() {
	local d="$1"
	shift
	set +e
	RUN_OUT="$(GH_STUB_DIR="$d" GH_STUB_LOG="$d/log" PATH="$d/bin:$PATH" "$HELPER" "$@" 2>"$d/err")"
	RUN_RC=$?
	set -e
	RUN_ERR="$(cat "$d/err" 2>/dev/null || true)"
	RUN_LOG="$(cat "$d/log" 2>/dev/null || true)"
}

jqr() { jq -r "$1" <<<"$2"; }

# Bash-3.2-safe log inspection (no mapfile/readarray/arrays). Powbox runs its
# consumer copy directly on the downstream host in commands/smoke-test.sh Stage
# 0b, where macOS ships Bash 3.2, so these must stay portable here too.
count_matches() {
	# count_matches <file> <fixed-string> — number of matching lines (0 if none).
	# grep -c prints "0" and exits 1 on no match; `|| true` keeps set -e happy.
	grep -Fc "$2" "$1" || true
}
nth_match() {
	# nth_match <n> <file> <fixed-string> — the n-th matching line (1-indexed),
	# empty if fewer than n matches. `sed -n Np` (no early `q`) drains all of
	# grep's output, so grep never takes SIGPIPE under `set -o pipefail`.
	grep -F "$3" "$2" | sed -n "${1}p" || true
}

# A single-page reviewThreads response wrapping the given nodes JSON, echoing
# the response identity the helper asserts (nameWithOwner + PR number/url).
# threads_one_page <nodes> [<pr-number>] [<nameWithOwner>] [<pr-url>] — defaults
# match the canonical test repo/PR (acme/widgets, PR 12); the url derives from
# the other two unless overridden. The (i) cases override it back to canonical
# so each presents exactly ONE wrong asserted identity field.
threads_one_page() {
	local nodes="$1" pr="${2:-12}" nwo="${3:-acme/widgets}" url
	url="${4:-https://github.com/$nwo/pull/$pr}"
	printf '{"data":{"repository":{"nameWithOwner":"%s","pullRequest":{"number":%s,"url":"%s","reviewThreads":{"totalCount":1,"nodes":%s,"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}\n' \
		"$nwo" "$pr" "$url" "$nodes"
}

# ============================================================================
# (a) unresolved-only filtering, and --all
# ============================================================================
NODES_A='[
  {"id":"T_unres","isResolved":false,"isOutdated":false,"path":"src/a.js","line":10,
   "comments":{"nodes":[{"databaseId":111,"author":{"login":"chatgpt-codex-connector","__typename":"Bot"},"body":"unresolved issue","diffHunk":"@@ -1 +1 @@","url":"https://github.com/acme/widgets/pull/12#discussion_r111"}],"pageInfo":{"hasNextPage":false,"endCursor":null}}},
  {"id":"T_res","isResolved":true,"isOutdated":true,"path":"src/b.js","line":20,
   "comments":{"nodes":[{"databaseId":222,"author":{"login":"alice","__typename":"User"},"body":"resolved issue","diffHunk":"@@ -2 +2 @@","url":"https://github.com/acme/widgets/pull/12#discussion_r222"}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}
]'

d="$(new_case)"
threads_one_page "$NODES_A" >"$d/threads-1"
run "$d" --repo acme/widgets 12
assert_eq "a: default exit 0" "$RUN_RC" 0
assert_eq "a: unresolved-only length" "$(jqr 'length' "$RUN_OUT")" 1
assert_eq "a: keeps the unresolved thread" "$(jqr '.[0].id' "$RUN_OUT")" T_unres
assert_eq "a: isResolved false" "$(jqr '.[0].isResolved' "$RUN_OUT")" false
assert_eq "a: comment databaseId" "$(jqr '.[0].comments[0].databaseId' "$RUN_OUT")" 111
assert_eq "a: comment author type" "$(jqr '.[0].comments[0].author.__typename' "$RUN_OUT")" Bot
assert_eq "a: comment diffHunk" "$(jqr '.[0].comments[0].diffHunk' "$RUN_OUT")" "@@ -1 +1 @@"
assert_not_contains "a: never --paginate" "$RUN_LOG" "[--paginate]"

d="$(new_case)"
threads_one_page "$NODES_A" >"$d/threads-1"
run "$d" --all --repo acme/widgets 12
assert_eq "a: --all exit 0" "$RUN_RC" 0
assert_eq "a: --all includes resolved" "$(jqr 'length' "$RUN_OUT")" 2
assert_eq "a: --all sorted ids" "$(jqr '[.[].id]|sort|join(",")' "$RUN_OUT")" T_res,T_unres

# ============================================================================
# (b) two-page thread list followed via endCursor
# ============================================================================
d="$(new_case)"
cat >"$d/threads-1" <<'JSON'
{"data":{"repository":{"nameWithOwner":"acme/widgets","pullRequest":{"number":12,"url":"https://github.com/acme/widgets/pull/12","reviewThreads":{"totalCount":2,"nodes":[
  {"id":"T_p1","isResolved":false,"isOutdated":false,"path":"p1.js","line":1,
   "comments":{"nodes":[{"databaseId":301,"author":{"login":"codex","__typename":"Bot"},"body":"page1","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r301"}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}
],"pageInfo":{"hasNextPage":true,"endCursor":"CURSOR_ONE"}}}}}}
JSON
cat >"$d/threads-2" <<'JSON'
{"data":{"repository":{"nameWithOwner":"acme/widgets","pullRequest":{"number":12,"url":"https://github.com/acme/widgets/pull/12","reviewThreads":{"totalCount":2,"nodes":[
  {"id":"T_p2","isResolved":false,"isOutdated":false,"path":"p2.js","line":2,
   "comments":{"nodes":[{"databaseId":302,"author":{"login":"codex","__typename":"Bot"},"body":"page2","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r302"}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}
],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}
JSON
run "$d" --repo acme/widgets 12
assert_eq "b: exit 0" "$RUN_RC" 0
assert_eq "b: both pages merged" "$(jqr 'length' "$RUN_OUT")" 2
assert_eq "b: page ids" "$(jqr '[.[].id]|sort|join(",")' "$RUN_OUT")" T_p1,T_p2
assert_eq "b: exactly two thread-list calls" "$(count_matches "$d/log" '[owner=')" 2
assert_not_contains "b: first page has no cursor" "$(nth_match 1 "$d/log" '[owner=')" "[after="
assert_contains "b: second page uses endCursor" "$(nth_match 2 "$d/log" '[owner=')" "[after=CURSOR_ONE]"
assert_not_contains "b: never --paginate" "$RUN_LOG" "[--paginate]"

# ============================================================================
# (c) contamination — fail closed on repeat; succeed on a clean retry
# ============================================================================
CONTAMINATED='[
  {"id":"T_bad","isResolved":false,"isOutdated":false,"path":"x.js","line":1,
   "comments":{"nodes":[{"databaseId":901,"author":{"login":"codex","__typename":"Bot"},"body":"wrong pr","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/999#discussion_r901"}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}
]'
CLEAN='[
  {"id":"T_ok","isResolved":false,"isOutdated":false,"path":"y.js","line":2,
   "comments":{"nodes":[{"databaseId":401,"author":{"login":"codex","__typename":"Bot"},"body":"right pr","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r401"}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}
]'

# c1: contaminated on BOTH the first response and the internal retry → exit 3.
d="$(new_case)"
threads_one_page "$CONTAMINATED" >"$d/threads-1"
threads_one_page "$CONTAMINATED" >"$d/threads-2"
run "$d" --repo acme/widgets 12
assert_eq "c1: fails closed with exit 3" "$RUN_RC" 3
assert_eq "c1: no stdout emitted" "$RUN_OUT" ""
assert_contains "c1: scope diagnosis on stderr" "$RUN_ERR" "comment url(s) do not belong"
assert_contains "c1: names the offending url on stderr" "$RUN_ERR" "https://github.com/acme/widgets/pull/999"
assert_eq "c1: fetched twice (retry once)" "$(count_matches "$d/log" '[owner=')" 2

# c2: contaminated first response, clean retry → success.
d="$(new_case)"
threads_one_page "$CONTAMINATED" >"$d/threads-1"
threads_one_page "$CLEAN" >"$d/threads-2"
run "$d" --repo acme/widgets 12
assert_eq "c2: clean retry exit 0" "$RUN_RC" 0
assert_eq "c2: emits the clean thread" "$(jqr '.[0].id' "$RUN_OUT")" T_ok
assert_eq "c2: clean comment url" "$(jqr '.[0].comments[0].url' "$RUN_OUT")" "https://github.com/acme/widgets/pull/12#discussion_r401"

# ============================================================================
# (d) boundary-safe, repo-qualified /pull/<N> match
# ============================================================================
# d1: querying PR 12, a /pull/123 comment is out of scope (12 must not match 123).
BOUNDARY_123='[
  {"id":"T_b","isResolved":false,"isOutdated":false,"path":"z.js","line":3,
   "comments":{"nodes":[{"databaseId":501,"author":{"login":"codex","__typename":"Bot"},"body":"neighbour pr","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/123#discussion_r501"}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}
]'
d="$(new_case)"
threads_one_page "$BOUNDARY_123" >"$d/threads-1"
threads_one_page "$BOUNDARY_123" >"$d/threads-2"
run "$d" --repo acme/widgets 12
assert_eq "d1: /pull/123 rejected for PR 12 (exit 3)" "$RUN_RC" 3
assert_eq "d1: no stdout" "$RUN_OUT" ""
assert_contains "d1: names /pull/123" "$RUN_ERR" "https://github.com/acme/widgets/pull/123"

# d2: querying PR 123, that same /pull/123 comment IS in scope (exact number, `#` boundary).
d="$(new_case)"
threads_one_page "$BOUNDARY_123" 123 >"$d/threads-1"
run "$d" --repo acme/widgets 123
assert_eq "d2: /pull/123 accepted for PR 123 (exit 0)" "$RUN_RC" 0
assert_eq "d2: emits the thread" "$(jqr 'length' "$RUN_OUT")" 1

# d3: end-of-string boundary — a bare /pull/12 url (no fragment) is in scope.
BOUNDARY_END='[
  {"id":"T_end","isResolved":false,"isOutdated":false,"path":"e.js","line":4,
   "comments":{"nodes":[{"databaseId":601,"author":{"login":"codex","__typename":"Bot"},"body":"bare url","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12"}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}
]'
d="$(new_case)"
threads_one_page "$BOUNDARY_END" >"$d/threads-1"
run "$d" --repo acme/widgets 12
assert_eq "d3: bare /pull/12 accepted (exit 0)" "$RUN_RC" 0
assert_eq "d3: emits the thread" "$(jqr '.[0].id' "$RUN_OUT")" T_end

# d4: a same-number PR in a DIFFERENT repo is out of scope (repo-qualified match).
BOUNDARY_OTHERREPO='[
  {"id":"T_or","isResolved":false,"isOutdated":false,"path":"o.js","line":5,
   "comments":{"nodes":[{"databaseId":701,"author":{"login":"codex","__typename":"Bot"},"body":"other repo","diffHunk":"@@","url":"https://github.com/other/widgets/pull/12#discussion_r701"}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}
]'
d="$(new_case)"
threads_one_page "$BOUNDARY_OTHERREPO" >"$d/threads-1"
threads_one_page "$BOUNDARY_OTHERREPO" >"$d/threads-2"
run "$d" --repo acme/widgets 12
assert_eq "d4: other-repo /pull/12 rejected (exit 3)" "$RUN_RC" 3
assert_contains "d4: names the other-repo url" "$RUN_ERR" "https://github.com/other/widgets/pull/12"

# d5: slash boundary — a path below /pull/12 is in scope.
BOUNDARY_SLASH='[
  {"id":"T_slash","isResolved":false,"isOutdated":false,"path":"s.js","line":6,
   "comments":{"nodes":[{"databaseId":702,"author":{"login":"codex","__typename":"Bot"},"body":"files url","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12/files"}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}
]'
d="$(new_case)"
threads_one_page "$BOUNDARY_SLASH" >"$d/threads-1"
run "$d" --repo acme/widgets 12
assert_eq "d5: /pull/12/files accepted (exit 0)" "$RUN_RC" 0
assert_eq "d5: emits the thread" "$(jqr '.[0].id' "$RUN_OUT")" T_slash

# d6: query boundary — a query string after /pull/12 is in scope.
BOUNDARY_QUERY='[
  {"id":"T_query","isResolved":false,"isOutdated":false,"path":"q.js","line":7,
   "comments":{"nodes":[{"databaseId":703,"author":{"login":"codex","__typename":"Bot"},"body":"query url","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12?diff=split"}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}
]'
d="$(new_case)"
threads_one_page "$BOUNDARY_QUERY" >"$d/threads-1"
run "$d" --repo acme/widgets 12
assert_eq "d6: /pull/12?diff=split accepted (exit 0)" "$RUN_RC" 0
assert_eq "d6: emits the thread" "$(jqr '.[0].id' "$RUN_OUT")" T_query

# ============================================================================
# (e) nested comment-page fetch-up
# ============================================================================
d="$(new_case)"
cat >"$d/threads-1" <<'JSON'
{"data":{"repository":{"nameWithOwner":"acme/widgets","pullRequest":{"number":12,"url":"https://github.com/acme/widgets/pull/12","reviewThreads":{"totalCount":1,"nodes":[
  {"id":"T_nested","isResolved":false,"isOutdated":false,"path":"n.js","line":7,
   "comments":{"nodes":[{"databaseId":311,"author":{"login":"codex","__typename":"Bot"},"body":"comment A","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r311"}],"pageInfo":{"hasNextPage":true,"endCursor":"CCUR1"}}}
],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}
JSON
cat >"$d/comments-1" <<'JSON'
{"data":{"node":{"comments":{"nodes":[{"databaseId":312,"author":{"login":"alice","__typename":"User"},"body":"comment B","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r312"}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}
JSON
run "$d" --repo acme/widgets 12
assert_eq "e: exit 0" "$RUN_RC" 0
assert_eq "e: one thread" "$(jqr 'length' "$RUN_OUT")" 1
assert_eq "e: both comments merged" "$(jqr '.[0].comments | length' "$RUN_OUT")" 2
assert_eq "e: comment ids in order" "$(jqr '[.[0].comments[].databaseId]|join(",")' "$RUN_OUT")" "311,312"
assert_eq "e: one nested-comments call" "$(count_matches "$d/log" '[threadId=')" 1
cline1="$(nth_match 1 "$d/log" '[threadId=')"
assert_contains "e: nested call targets the thread" "$cline1" "[threadId=T_nested]"
assert_contains "e: nested call uses the comment endCursor" "$cline1" "[after=CCUR1]"
assert_not_contains "e: never --paginate" "$RUN_LOG" "[--paginate]"

# e2: a crossed nested-comments page is caught by the merged comment-url scope
# check. Nested pages carry no response identity, so this is their fail-closed
# guard; both whole-fetch attempts must restart the thread and nested queries.
d="$(new_case)"
for n in 1 2; do
	cat >"$d/threads-$n" <<'JSON'
{"data":{"repository":{"nameWithOwner":"acme/widgets","pullRequest":{"number":12,"url":"https://github.com/acme/widgets/pull/12","reviewThreads":{"totalCount":1,"nodes":[
  {"id":"T_nested_bad","isResolved":false,"isOutdated":false,"path":"n.js","line":8,
   "comments":{"nodes":[{"databaseId":313,"author":{"login":"codex","__typename":"Bot"},"body":"comment A","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r313"}],"pageInfo":{"hasNextPage":true,"endCursor":"CCUR_BAD"}}}
],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}
JSON
	cat >"$d/comments-$n" <<'JSON'
{"data":{"node":{"comments":{"nodes":[{"databaseId":314,"author":{"login":"alice","__typename":"User"},"body":"crossed comment","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/999#discussion_r314"}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}
JSON
done
run "$d" --repo acme/widgets 12
assert_eq "e2: crossed nested page fails closed (exit 3)" "$RUN_RC" 3
assert_eq "e2: no stdout emitted" "$RUN_OUT" ""
assert_contains "e2: scope diagnosis on stderr" "$RUN_ERR" "comment url(s) do not belong"
assert_contains "e2: names the nested-page offender" "$RUN_ERR" "https://github.com/acme/widgets/pull/999"
assert_eq "e2: both whole-fetch attempts ran" "$(count_matches "$d/log" '[owner=')" 2
assert_eq "e2: both nested-page attempts ran" "$(count_matches "$d/log" '[threadId=')" 2

# ============================================================================
# (f) default repo resolution via `gh repo view` when --repo is omitted
# ============================================================================
# With no --repo, the helper resolves OWNER/REPO from `gh repo view --json
# owner,name` and scopes against that. The stub serves $GH_STUB_DIR/repo for the
# `gh repo view` call; a thread url under the resolved repo must pass. Exit 0
# proves the .owner.login/.name parse: a misparse would build a wrong
# EXPECTED_REPO_LC and prevent successful response-identity validation.
NODES_F='[
  {"id":"T_default","isResolved":false,"isOutdated":false,"path":"d.js","line":1,
   "comments":{"nodes":[{"databaseId":801,"author":{"login":"codex","__typename":"Bot"},"body":"default repo","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r801"}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}
]'
d="$(new_case)"
printf '%s\n' '{"owner":{"login":"acme"},"name":"widgets"}' >"$d/repo"
threads_one_page "$NODES_F" >"$d/threads-1"
run "$d" 12
assert_eq "f: default-repo exit 0" "$RUN_RC" 0
assert_eq "f: one thread" "$(jqr 'length' "$RUN_OUT")" 1
assert_eq "f: keeps the in-scope thread" "$(jqr '.[0].id' "$RUN_OUT")" T_default
assert_contains "f: resolved repo via gh repo view" "$RUN_LOG" "[repo] [view]"
assert_not_contains "f: never --paginate" "$RUN_LOG" "[--paginate]"

# ============================================================================
# (g) case-insensitive owner/repo scope match
# ============================================================================
# GitHub owner/repo are case-insensitive, but responses and comment urls carry
# canonical casing. A lowercase --repo must scope-match mixed canonical casing;
# a second cross-cased --repo proves both sides of each compare are normalized.
NODES_G='[
  {"id":"T_case","isResolved":false,"isOutdated":false,"path":"g.js","line":1,
   "comments":{"nodes":[{"databaseId":811,"author":{"login":"codex","__typename":"Bot"},"body":"canonical-cased url","diffHunk":"@@","url":"https://github.com/Acme/Widgets/pull/12#discussion_r811"}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}
]'
d="$(new_case)"
threads_one_page "$NODES_G" 12 Acme/Widgets >"$d/threads-1"
run "$d" --repo acme/widgets 12
assert_eq "g1: lowercase --repo accepted (exit 0)" "$RUN_RC" 0
assert_eq "g: one thread" "$(jqr 'length' "$RUN_OUT")" 1
assert_eq "g: emits the in-scope thread" "$(jqr '.[0].id' "$RUN_OUT")" T_case
assert_eq "g: preserves canonical url casing" "$(jqr '.[0].comments[0].url' "$RUN_OUT")" "https://github.com/Acme/Widgets/pull/12#discussion_r811"
assert_eq "g1: no retry needed" "$(count_matches "$d/log" '[owner=')" 1

d="$(new_case)"
threads_one_page "$NODES_G" 12 Acme/Widgets >"$d/threads-1"
run "$d" --repo aCME/wIDGETS 12
assert_eq "g2: cross-cased --repo accepted (exit 0)" "$RUN_RC" 0
assert_eq "g2: no retry needed" "$(count_matches "$d/log" '[owner=')" 1

# ============================================================================
# (h) malformed thread shapes — the url PARSER fails, and that must fail closed
# ============================================================================
# Principle: every fail-closed guard needs at least one case where the input
# PARSER fails, not only where the VALIDATION fails. The pre-013 helper passed
# every wrong-URL (validation) case above yet failed OPEN on these shapes: its
# url extraction ran in a process substitution, where a jq error under
# `set -euo pipefail` went unnoticed, so an empty offender list read as "all
# clean" and the contaminated payload was emitted with exit 0. Each fixture is
# a response that would OTHERWISE pass — correct identity and a well-formed
# in-scope thread — plus one thread whose `comments` shape breaks extraction,
# proving the parser path alone forces exit 3 / empty stdout / a diagnosis.
WELLFORMED_H='{"id":"T_good","isResolved":false,"isOutdated":false,"path":"h.js","line":1,
   "comments":{"nodes":[{"databaseId":821,"author":{"login":"codex","__typename":"Bot"},"body":"fine","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r821"}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}'

# h1: a thread with "comments": null.
MALFORMED_NULL="[$WELLFORMED_H,
  {\"id\":\"T_null\",\"isResolved\":false,\"isOutdated\":false,\"path\":\"h1.js\",\"line\":2,\"comments\":null}]"
d="$(new_case)"
threads_one_page "$MALFORMED_NULL" >"$d/threads-1"
threads_one_page "$MALFORMED_NULL" >"$d/threads-2"
run "$d" --repo acme/widgets 12
assert_eq "h1: comments:null fails closed (exit 3)" "$RUN_RC" 3
assert_eq "h1: no stdout emitted" "$RUN_OUT" ""
assert_contains "h1: extraction diagnosis on stderr" "$RUN_ERR" "malformed response — could not extract comment urls"
assert_eq "h1: fetched twice (retry once)" "$(count_matches "$d/log" '[owner=')" 2

# h2: a thread with "comments": {} (no nodes).
MALFORMED_EMPTY="[$WELLFORMED_H,
  {\"id\":\"T_empty\",\"isResolved\":false,\"isOutdated\":false,\"path\":\"h2.js\",\"line\":3,\"comments\":{}}]"
d="$(new_case)"
threads_one_page "$MALFORMED_EMPTY" >"$d/threads-1"
threads_one_page "$MALFORMED_EMPTY" >"$d/threads-2"
run "$d" --repo acme/widgets 12
assert_eq "h2: comments:{} fails closed (exit 3)" "$RUN_RC" 3
assert_eq "h2: no stdout emitted" "$RUN_OUT" ""
assert_contains "h2: extraction diagnosis on stderr" "$RUN_ERR" "malformed response — could not extract comment urls"
assert_eq "h2: fetched twice (retry once)" "$(count_matches "$d/log" '[owner=')" 2

# h3: a thread with comments absent entirely.
MALFORMED_ABSENT="[$WELLFORMED_H,
  {\"id\":\"T_absent\",\"isResolved\":false,\"isOutdated\":false,\"path\":\"h3.js\",\"line\":4}]"
d="$(new_case)"
threads_one_page "$MALFORMED_ABSENT" >"$d/threads-1"
threads_one_page "$MALFORMED_ABSENT" >"$d/threads-2"
run "$d" --repo acme/widgets 12
assert_eq "h3: absent comments fails closed (exit 3)" "$RUN_RC" 3
assert_eq "h3: no stdout emitted" "$RUN_OUT" ""
assert_contains "h3: extraction diagnosis on stderr" "$RUN_ERR" "malformed response — could not extract comment urls"
assert_eq "h3: fetched twice (retry once)" "$(count_matches "$d/log" '[owner=')" 2

# ============================================================================
# (i) response-identity mismatch — fail closed after the single whole-fetch retry
# ============================================================================
# Post-013 the helper asserts the identity echoed by every threads page BEFORE
# looking at any comment url. The nodes here are well-formed and in scope, so
# only the identity gate can reject them; its stderr diagnosis is the generic
# "response identity does not match" line (no urls are named — the whole page
# is untrusted), distinct from the offender-listing scope diagnosis (c1/d1/d4)
# and the extraction diagnosis (h1–h3). Each case keeps pullRequest.url pinned
# to the CANONICAL value so exactly one asserted identity field is wrong — a
# helper that skipped the nameWithOwner/number checks could not pass these by
# validating the (unasserted) url instead.
CANONICAL_PR_URL='https://github.com/acme/widgets/pull/12'
NODES_I='[
  {"id":"T_id","isResolved":false,"isOutdated":false,"path":"i.js","line":1,
   "comments":{"nodes":[{"databaseId":831,"author":{"login":"codex","__typename":"Bot"},"body":"in scope","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r831"}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}
]'

# i1: the response echoes the WRONG nameWithOwner (url stays canonical).
d="$(new_case)"
threads_one_page "$NODES_I" 12 other/widgets "$CANONICAL_PR_URL" >"$d/threads-1"
threads_one_page "$NODES_I" 12 other/widgets "$CANONICAL_PR_URL" >"$d/threads-2"
run "$d" --repo acme/widgets 12
assert_eq "i1: wrong nameWithOwner fails closed (exit 3)" "$RUN_RC" 3
assert_eq "i1: no stdout emitted" "$RUN_OUT" ""
assert_contains "i1: identity diagnosis on stderr" "$RUN_ERR" "response identity does not match"
assert_eq "i1: fetched twice (retry once)" "$(count_matches "$d/log" '[owner=')" 2

# i2: the response echoes the WRONG pullRequest.number (url stays canonical).
d="$(new_case)"
threads_one_page "$NODES_I" 999 acme/widgets "$CANONICAL_PR_URL" >"$d/threads-1"
threads_one_page "$NODES_I" 999 acme/widgets "$CANONICAL_PR_URL" >"$d/threads-2"
run "$d" --repo acme/widgets 12
assert_eq "i2: wrong PR number fails closed (exit 3)" "$RUN_RC" 3
assert_eq "i2: no stdout emitted" "$RUN_OUT" ""
assert_contains "i2: identity diagnosis on stderr" "$RUN_ERR" "response identity does not match"
assert_eq "i2: fetched twice (retry once)" "$(count_matches "$d/log" '[owner=')" 2

# i3: a later threads page echoes the wrong repository. Both whole-fetch
# attempts start with a clean page, proving identity validation is applied to
# every page and the retry restarts from the beginning.
d="$(new_case)"
for n in 1 3; do
	cat >"$d/threads-$n" <<'JSON'
{"data":{"repository":{"nameWithOwner":"acme/widgets","pullRequest":{"number":12,"url":"https://github.com/acme/widgets/pull/12","reviewThreads":{"totalCount":1,"nodes":[],"pageInfo":{"hasNextPage":true,"endCursor":"IDENTITY_CURSOR"}}}}}}
JSON
done
for n in 2 4; do
	cat >"$d/threads-$n" <<'JSON'
{"data":{"repository":{"nameWithOwner":"other/widgets","pullRequest":{"number":12,"url":"https://github.com/acme/widgets/pull/12","reviewThreads":{"totalCount":1,"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}
JSON
done
run "$d" --repo acme/widgets 12
assert_eq "i3: later-page identity mismatch fails closed (exit 3)" "$RUN_RC" 3
assert_eq "i3: no stdout emitted" "$RUN_OUT" ""
assert_contains "i3: identity diagnosis on stderr" "$RUN_ERR" "response identity does not match"
assert_eq "i3: both two-page attempts fetched" "$(count_matches "$d/log" '[owner=')" 4
assert_not_contains "i3: retry restarts without cursor" "$(nth_match 3 "$d/log" '[owner=')" "[after="
assert_contains "i3: retry reaches later page" "$(nth_match 4 "$d/log" '[owner=')" "[after=IDENTITY_CURSOR]"

# ============================================================================
# usage / arg handling
# ============================================================================
d="$(new_case)"
run "$d" -h
assert_eq "usage: -h exits 0" "$RUN_RC" 0
assert_contains "usage: -h prints usage to stdout" "$RUN_OUT" "usage: gh-review-threads"
d="$(new_case)"
run "$d"
assert_eq "usage: no PR exits non-zero" "$RUN_RC" 1
d="$(new_case)"
run "$d" --repo acme/widgets notanumber
assert_eq "usage: non-numeric PR rejected" "$RUN_RC" 1
d="$(new_case)"
run "$d" --repo not-owner-repo 12
assert_eq "usage: bad --repo rejected" "$RUN_RC" 1

if [ "$fails" -ne 0 ]; then
	echo "gh-review-threads unit test: $fails/$checks checks FAILED." >&2
	exit 1
fi
echo "gh-review-threads unit test passed ($checks checks)."
