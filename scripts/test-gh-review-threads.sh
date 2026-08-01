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
#   (e) nested comment fetch-up, scope validation, and multi-page cursor following
#   (f) default repo resolution via `gh repo view` when --repo is omitted
#   (g) case-insensitive response identity and owner/repo url scope matches
#   (h) malformed thread/comment shapes and pagination metadata at every layer —
#       the helper must fail closed
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
# (e) nested comment fetch-up, scope validation, and multi-page cursor following
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

# e3: nested comment pagination follows each validated cursor until completion.
d="$(new_case)"
cat >"$d/threads-1" <<'JSON'
{"data":{"repository":{"nameWithOwner":"acme/widgets","pullRequest":{"number":12,"url":"https://github.com/acme/widgets/pull/12","reviewThreads":{"totalCount":1,"nodes":[
  {"id":"T_nested_multi","isResolved":false,"isOutdated":false,"path":"n.js","line":9,
   "comments":{"nodes":[{"databaseId":315,"author":{"login":"codex","__typename":"Bot"},"body":"comment A","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r315"}],"pageInfo":{"hasNextPage":true,"endCursor":"CCUR_MULTI_1"}}}
],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}
JSON
cat >"$d/comments-1" <<'JSON'
{"data":{"node":{"comments":{"nodes":[{"databaseId":316,"author":{"login":"alice","__typename":"User"},"body":"comment B","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r316"}],"pageInfo":{"hasNextPage":true,"endCursor":"CCUR_MULTI_2"}}}}}
JSON
cat >"$d/comments-2" <<'JSON'
{"data":{"node":{"comments":{"nodes":[{"databaseId":317,"author":{"login":"bob","__typename":"User"},"body":"comment C","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r317"}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}
JSON
run "$d" --repo acme/widgets 12
assert_eq "e3: exit 0" "$RUN_RC" 0
assert_eq "e3: all comments merged" "$(jqr '[.[0].comments[].databaseId]|join(",")' "$RUN_OUT")" "315,316,317"
assert_eq "e3: one thread-list call" "$(count_matches "$d/log" '[owner=')" 1
assert_eq "e3: two nested-page calls" "$(count_matches "$d/log" '[threadId=')" 2
assert_contains "e3: first nested cursor" "$(nth_match 1 "$d/log" '[threadId=')" "[after=CCUR_MULTI_1]"
assert_contains "e3: second nested cursor" "$(nth_match 2 "$d/log" '[threadId=')" "[after=CCUR_MULTI_2]"

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
# (g) case-insensitive response identity and owner/repo url scope matches
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
# (h) malformed thread and pagination response shapes must fail closed
# ============================================================================
# These cases bind parser-failure paths, not only wrong-value validation paths.
# The pre-013 helper passed every wrong-URL case above yet failed open on h1–h3:
# a malformed thread comment shape made url extraction fail in a process
# substitution, and the empty offender list looked clean. Cases h4 onward cover
# malformed nested-comment, initial-comment, and outer-thread pagination shapes.
# Every case keeps the asserted response identity correct so shape extraction is
# solely responsible for retry-once, exit 3, empty stdout, and the diagnosis.
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

# h4: a nested-comments page whose node is null must not silently truncate the
# thread's remaining comments. The malformed page is a retryable extraction
# failure, so both attempts restart from the thread-list query and fail closed.
d="$(new_case)"
for n in 1 2; do
	cat >"$d/threads-$n" <<'JSON'
{"data":{"repository":{"nameWithOwner":"acme/widgets","pullRequest":{"number":12,"url":"https://github.com/acme/widgets/pull/12","reviewThreads":{"totalCount":1,"nodes":[
  {"id":"T_nested_null","isResolved":false,"isOutdated":false,"path":"h4.js","line":5,
   "comments":{"nodes":[{"databaseId":822,"author":{"login":"codex","__typename":"Bot"},"body":"comment A","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r822"}],"pageInfo":{"hasNextPage":true,"endCursor":"CCUR_NULL"}}}
],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}
JSON
	printf '%s\n' '{"data":{"node":null}}' >"$d/comments-$n"
done
run "$d" --repo acme/widgets 12
assert_eq "h4: nested node:null fails closed (exit 3)" "$RUN_RC" 3
assert_eq "h4: no stdout emitted" "$RUN_OUT" ""
assert_contains "h4: extraction diagnosis on stderr" "$RUN_ERR" "malformed response — could not extract comment urls"
assert_eq "h4: both whole-fetch attempts ran" "$(count_matches "$d/log" '[owner=')" 2
assert_eq "h4: both nested-page attempts ran" "$(count_matches "$d/log" '[threadId=')" 2

# h5: malformed nested pagination metadata must also fail closed. A string
# "false" must not be treated as a valid boolean false and silently stop fetch-up.
d="$(new_case)"
for n in 1 2; do
	cat >"$d/threads-$n" <<'JSON'
{"data":{"repository":{"nameWithOwner":"acme/widgets","pullRequest":{"number":12,"url":"https://github.com/acme/widgets/pull/12","reviewThreads":{"totalCount":1,"nodes":[
  {"id":"T_nested_metadata","isResolved":false,"isOutdated":false,"path":"h5.js","line":6,
   "comments":{"nodes":[{"databaseId":823,"author":{"login":"codex","__typename":"Bot"},"body":"comment A","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r823"}],"pageInfo":{"hasNextPage":true,"endCursor":"CCUR_METADATA"}}}
],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}
JSON
	cat >"$d/comments-$n" <<'JSON'
{"data":{"node":{"comments":{"nodes":[{"databaseId":824,"author":{"login":"alice","__typename":"User"},"body":"comment B","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r824"}],"pageInfo":{"hasNextPage":"false","endCursor":null}}}}}
JSON
done
run "$d" --repo acme/widgets 12
assert_eq "h5: malformed nested pageInfo fails closed (exit 3)" "$RUN_RC" 3
assert_eq "h5: no stdout emitted" "$RUN_OUT" ""
assert_contains "h5: extraction diagnosis on stderr" "$RUN_ERR" "malformed response — could not extract comment urls"
assert_eq "h5: both whole-fetch attempts ran" "$(count_matches "$d/log" '[owner=')" 2
assert_eq "h5: both nested-page attempts ran" "$(count_matches "$d/log" '[threadId=')" 2

# h6: a nested page that promises another page must carry a usable cursor.
d="$(new_case)"
for n in 1 2; do
	cat >"$d/threads-$n" <<'JSON'
{"data":{"repository":{"nameWithOwner":"acme/widgets","pullRequest":{"number":12,"url":"https://github.com/acme/widgets/pull/12","reviewThreads":{"totalCount":1,"nodes":[
  {"id":"T_nested_cursor","isResolved":false,"isOutdated":false,"path":"h6.js","line":7,
   "comments":{"nodes":[{"databaseId":825,"author":{"login":"codex","__typename":"Bot"},"body":"comment A","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r825"}],"pageInfo":{"hasNextPage":true,"endCursor":"CCUR_CURSOR"}}}
],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}
JSON
	cat >"$d/comments-$n" <<'JSON'
{"data":{"node":{"comments":{"nodes":[{"databaseId":826,"author":{"login":"alice","__typename":"User"},"body":"comment B","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r826"}],"pageInfo":{"hasNextPage":true,"endCursor":null}}}}}
JSON
done
run "$d" --repo acme/widgets 12
assert_eq "h6: missing nested cursor fails closed (exit 3)" "$RUN_RC" 3
assert_eq "h6: no stdout emitted" "$RUN_OUT" ""
assert_contains "h6: extraction diagnosis on stderr" "$RUN_ERR" "malformed response — could not extract comment urls"
assert_eq "h6: both whole-fetch attempts ran" "$(count_matches "$d/log" '[owner=')" 2
assert_eq "h6: both nested-page attempts ran" "$(count_matches "$d/log" '[threadId=')" 2

# h7: initial comment pagination metadata must use a JSON boolean.
INITIAL_META_STRING='[
  {"id":"T_initial_metadata","isResolved":false,"isOutdated":false,"path":"h7.js","line":8,
   "comments":{"nodes":[{"databaseId":827,"author":{"login":"codex","__typename":"Bot"},"body":"comment A","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r827"}],"pageInfo":{"hasNextPage":"false","endCursor":null}}}
]'
d="$(new_case)"
threads_one_page "$INITIAL_META_STRING" >"$d/threads-1"
threads_one_page "$INITIAL_META_STRING" >"$d/threads-2"
run "$d" --repo acme/widgets 12
assert_eq "h7: malformed initial pageInfo fails closed (exit 3)" "$RUN_RC" 3
assert_eq "h7: no stdout emitted" "$RUN_OUT" ""
assert_contains "h7: extraction diagnosis on stderr" "$RUN_ERR" "malformed response — could not extract comment urls"
assert_eq "h7: both whole-fetch attempts ran" "$(count_matches "$d/log" '[owner=')" 2
assert_eq "h7: no nested request attempted" "$(count_matches "$d/log" '[threadId=')" 0

# h8: an initial comment page that promises fetch-up needs a usable cursor.
INITIAL_CURSOR_NULL='[
  {"id":"T_initial_cursor","isResolved":false,"isOutdated":false,"path":"h8.js","line":9,
   "comments":{"nodes":[{"databaseId":828,"author":{"login":"codex","__typename":"Bot"},"body":"comment A","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r828"}],"pageInfo":{"hasNextPage":true,"endCursor":null}}}
]'
d="$(new_case)"
threads_one_page "$INITIAL_CURSOR_NULL" >"$d/threads-1"
threads_one_page "$INITIAL_CURSOR_NULL" >"$d/threads-2"
run "$d" --repo acme/widgets 12
assert_eq "h8: missing initial cursor fails closed (exit 3)" "$RUN_RC" 3
assert_eq "h8: no stdout emitted" "$RUN_OUT" ""
assert_contains "h8: extraction diagnosis on stderr" "$RUN_ERR" "malformed response — could not extract comment urls"
assert_eq "h8: both whole-fetch attempts ran" "$(count_matches "$d/log" '[owner=')" 2
assert_eq "h8: no nested request attempted" "$(count_matches "$d/log" '[threadId=')" 0

# h9: reviewThreads itself must contain a nodes array and pageInfo object.
d="$(new_case)"
for n in 1 2; do
	cat >"$d/threads-$n" <<'JSON'
{"data":{"repository":{"nameWithOwner":"acme/widgets","pullRequest":{"number":12,"url":"https://github.com/acme/widgets/pull/12","reviewThreads":null}}}}
JSON
done
run "$d" --repo acme/widgets 12
assert_eq "h9: reviewThreads:null fails closed (exit 3)" "$RUN_RC" 3
assert_eq "h9: no stdout emitted" "$RUN_OUT" ""
assert_contains "h9: extraction diagnosis on stderr" "$RUN_ERR" "malformed response — could not extract comment urls"
assert_eq "h9: both whole-fetch attempts ran" "$(count_matches "$d/log" '[owner=')" 2

# h10: outer thread pagination metadata must use a JSON boolean.
d="$(new_case)"
for n in 1 2; do
	cat >"$d/threads-$n" <<'JSON'
{"data":{"repository":{"nameWithOwner":"acme/widgets","pullRequest":{"number":12,"url":"https://github.com/acme/widgets/pull/12","reviewThreads":{"totalCount":0,"nodes":[],"pageInfo":{"hasNextPage":"false","endCursor":null}}}}}}
JSON
done
run "$d" --repo acme/widgets 12
assert_eq "h10: malformed outer pageInfo fails closed (exit 3)" "$RUN_RC" 3
assert_eq "h10: no stdout emitted" "$RUN_OUT" ""
assert_contains "h10: extraction diagnosis on stderr" "$RUN_ERR" "malformed response — could not extract comment urls"
assert_eq "h10: both whole-fetch attempts ran" "$(count_matches "$d/log" '[owner=')" 2

# h11: an outer thread page that promises another page needs a usable cursor.
d="$(new_case)"
for n in 1 2; do
	cat >"$d/threads-$n" <<'JSON'
{"data":{"repository":{"nameWithOwner":"acme/widgets","pullRequest":{"number":12,"url":"https://github.com/acme/widgets/pull/12","reviewThreads":{"totalCount":0,"nodes":[],"pageInfo":{"hasNextPage":true,"endCursor":null}}}}}}
JSON
done
run "$d" --repo acme/widgets 12
assert_eq "h11: missing outer cursor fails closed (exit 3)" "$RUN_RC" 3
assert_eq "h11: no stdout emitted" "$RUN_OUT" ""
assert_contains "h11: extraction diagnosis on stderr" "$RUN_ERR" "malformed response — could not extract comment urls"
assert_eq "h11: both whole-fetch attempts ran" "$(count_matches "$d/log" '[owner=')" 2

# h12: a fetched nested page also rejects an empty-string cursor.
d="$(new_case)"
for n in 1 2; do
	cat >"$d/threads-$n" <<'JSON'
{"data":{"repository":{"nameWithOwner":"acme/widgets","pullRequest":{"number":12,"url":"https://github.com/acme/widgets/pull/12","reviewThreads":{"totalCount":1,"nodes":[
  {"id":"T_nested_empty_cursor","isResolved":false,"isOutdated":false,"path":"h12.js","line":12,
   "comments":{"nodes":[{"databaseId":829,"author":{"login":"codex","__typename":"Bot"},"body":"comment A","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r829"}],"pageInfo":{"hasNextPage":true,"endCursor":"CCUR_EMPTY"}}}
],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}
JSON
	cat >"$d/comments-$n" <<'JSON'
{"data":{"node":{"comments":{"nodes":[{"databaseId":830,"author":{"login":"alice","__typename":"User"},"body":"comment B","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r830"}],"pageInfo":{"hasNextPage":true,"endCursor":""}}}}}
JSON
done
run "$d" --repo acme/widgets 12
assert_eq "h12: empty nested cursor fails closed (exit 3)" "$RUN_RC" 3
assert_eq "h12: no stdout emitted" "$RUN_OUT" ""
assert_contains "h12: extraction diagnosis on stderr" "$RUN_ERR" "malformed response — could not extract comment urls"
assert_eq "h12: both whole-fetch attempts ran" "$(count_matches "$d/log" '[owner=')" 2
assert_eq "h12: both nested-page attempts ran" "$(count_matches "$d/log" '[threadId=')" 2

# h13: initial comment metadata rejects an empty-string cursor before fetch-up.
INITIAL_CURSOR_EMPTY='[
  {"id":"T_initial_empty_cursor","isResolved":false,"isOutdated":false,"path":"h13.js","line":13,
   "comments":{"nodes":[{"databaseId":833,"author":{"login":"codex","__typename":"Bot"},"body":"comment A","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r833"}],"pageInfo":{"hasNextPage":true,"endCursor":""}}}
]'
d="$(new_case)"
threads_one_page "$INITIAL_CURSOR_EMPTY" >"$d/threads-1"
threads_one_page "$INITIAL_CURSOR_EMPTY" >"$d/threads-2"
run "$d" --repo acme/widgets 12
assert_eq "h13: empty initial cursor fails closed (exit 3)" "$RUN_RC" 3
assert_eq "h13: no stdout emitted" "$RUN_OUT" ""
assert_contains "h13: extraction diagnosis on stderr" "$RUN_ERR" "malformed response — could not extract comment urls"
assert_eq "h13: both whole-fetch attempts ran" "$(count_matches "$d/log" '[owner=')" 2
assert_eq "h13: no nested request attempted" "$(count_matches "$d/log" '[threadId=')" 0

# h14: outer reviewThreads metadata rejects an empty-string cursor.
d="$(new_case)"
for n in 1 2; do
	cat >"$d/threads-$n" <<'JSON'
{"data":{"repository":{"nameWithOwner":"acme/widgets","pullRequest":{"number":12,"url":"https://github.com/acme/widgets/pull/12","reviewThreads":{"totalCount":0,"nodes":[],"pageInfo":{"hasNextPage":true,"endCursor":""}}}}}}
JSON
done
run "$d" --repo acme/widgets 12
assert_eq "h14: empty outer cursor fails closed (exit 3)" "$RUN_RC" 3
assert_eq "h14: no stdout emitted" "$RUN_OUT" ""
assert_contains "h14: extraction diagnosis on stderr" "$RUN_ERR" "malformed response — could not extract comment urls"
assert_eq "h14: both whole-fetch attempts ran" "$(count_matches "$d/log" '[owner=')" 2

# h15: keep scope_offenders' own extraction-failure path bound. The comments
# container is an array, but a scalar element makes `.url` extraction fail.
SCALAR_COMMENT_NODE='[
  {"id":"T_scalar_comment","isResolved":false,"isOutdated":false,"path":"h15.js","line":15,
   "comments":{"nodes":[1],"pageInfo":{"hasNextPage":false,"endCursor":null}}}
]'
d="$(new_case)"
threads_one_page "$SCALAR_COMMENT_NODE" >"$d/threads-1"
threads_one_page "$SCALAR_COMMENT_NODE" >"$d/threads-2"
run "$d" --repo acme/widgets 12
assert_eq "h15: scalar comment node fails closed (exit 3)" "$RUN_RC" 3
assert_eq "h15: no stdout emitted" "$RUN_OUT" ""
assert_contains "h15: extraction diagnosis on stderr" "$RUN_ERR" "malformed response — could not extract comment urls"
assert_eq "h15: both whole-fetch attempts ran" "$(count_matches "$d/log" '[owner=')" 2

# h16: an overflowed thread needs a string id before a nested query can run.
NULL_THREAD_ID='[
  {"id":null,"isResolved":false,"isOutdated":false,"path":"h16.js","line":16,
   "comments":{"nodes":[{"databaseId":834,"author":{"login":"codex","__typename":"Bot"},"body":"comment A","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r834"}],"pageInfo":{"hasNextPage":true,"endCursor":"CCUR_NULL_ID"}}}
]'
d="$(new_case)"
threads_one_page "$NULL_THREAD_ID" >"$d/threads-1"
threads_one_page "$NULL_THREAD_ID" >"$d/threads-2"
run "$d" --repo acme/widgets 12
assert_eq "h16: null overflow thread id fails closed (exit 3)" "$RUN_RC" 3
assert_eq "h16: no stdout emitted" "$RUN_OUT" ""
assert_contains "h16: extraction diagnosis on stderr" "$RUN_ERR" "malformed response — could not extract comment urls"
assert_eq "h16: both whole-fetch attempts ran" "$(count_matches "$d/log" '[owner=')" 2
assert_eq "h16: no nested request attempted" "$(count_matches "$d/log" '[threadId=')" 0

# h17: the overflow thread id must also be non-empty.
EMPTY_THREAD_ID='[
  {"id":"","isResolved":false,"isOutdated":false,"path":"h17.js","line":17,
   "comments":{"nodes":[{"databaseId":835,"author":{"login":"codex","__typename":"Bot"},"body":"comment A","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r835"}],"pageInfo":{"hasNextPage":true,"endCursor":"CCUR_EMPTY_ID"}}}
]'
d="$(new_case)"
threads_one_page "$EMPTY_THREAD_ID" >"$d/threads-1"
threads_one_page "$EMPTY_THREAD_ID" >"$d/threads-2"
run "$d" --repo acme/widgets 12
assert_eq "h17: empty overflow thread id fails closed (exit 3)" "$RUN_RC" 3
assert_eq "h17: no stdout emitted" "$RUN_OUT" ""
assert_contains "h17: extraction diagnosis on stderr" "$RUN_ERR" "malformed response — could not extract comment urls"
assert_eq "h17: both whole-fetch attempts ran" "$(count_matches "$d/log" '[owner=')" 2
assert_eq "h17: no nested request attempted" "$(count_matches "$d/log" '[threadId=')" 0

# h18: an empty comments array is a valid boundary value, not malformed data.
ZERO_COMMENTS='[
  {"id":"T_zero_comments","isResolved":false,"isOutdated":false,"path":"h18.js","line":18,
   "comments":{"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}}
]'
d="$(new_case)"
threads_one_page "$ZERO_COMMENTS" >"$d/threads-1"
run "$d" --repo acme/widgets 12
assert_eq "h18: zero-comment thread exits 0" "$RUN_RC" 0
assert_eq "h18: emits one thread" "$(jqr 'length' "$RUN_OUT")" 1
assert_eq "h18: preserves empty comments" "$(jqr '.[0].comments | length' "$RUN_OUT")" 0
assert_eq "h18: no retry needed" "$(count_matches "$d/log" '[owner=')" 1

# h19: an empty comment URL is malformed, not an ignorable blank line.
EMPTY_COMMENT_URL='[
  {"id":"T_empty_url","isResolved":false,"isOutdated":false,"path":"h19.js","line":19,
   "comments":{"nodes":[{"databaseId":836,"author":{"login":"codex","__typename":"Bot"},"body":"missing url","diffHunk":"@@","url":""}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}
]'
d="$(new_case)"
threads_one_page "$EMPTY_COMMENT_URL" >"$d/threads-1"
threads_one_page "$EMPTY_COMMENT_URL" >"$d/threads-2"
run "$d" --repo acme/widgets 12
assert_eq "h19: empty comment url fails closed (exit 3)" "$RUN_RC" 3
assert_eq "h19: no stdout emitted" "$RUN_OUT" ""
assert_contains "h19: extraction diagnosis on stderr" "$RUN_ERR" "malformed response — could not extract comment urls"
assert_eq "h19: both whole-fetch attempts ran" "$(count_matches "$d/log" '[owner=')" 2

# h20: a newline can split one malformed URL into separately in-scope lines, so
# URL validation must reject it before the shell's line-oriented scope check.
NEWLINE_COMMENT_URL='[
  {"id":"T_newline_url","isResolved":false,"isOutdated":false,"path":"h20.js","line":20,
   "comments":{"nodes":[{"databaseId":837,"author":{"login":"codex","__typename":"Bot"},"body":"split url","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#a\nhttps://github.com/acme/widgets/pull/12#b"}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}
]'
d="$(new_case)"
threads_one_page "$NEWLINE_COMMENT_URL" >"$d/threads-1"
threads_one_page "$NEWLINE_COMMENT_URL" >"$d/threads-2"
run "$d" --repo acme/widgets 12
assert_eq "h20: newline comment url fails closed (exit 3)" "$RUN_RC" 3
assert_eq "h20: no stdout emitted" "$RUN_OUT" ""
assert_contains "h20: extraction diagnosis on stderr" "$RUN_ERR" "malformed response — could not extract comment urls"
assert_eq "h20: both whole-fetch attempts ran" "$(count_matches "$d/log" '[owner=')" 2

# h21: carriage returns are line-unsafe too, even though the shell pattern's
# trailing wildcard would otherwise accept one inside an in-scope URL.
CARRIAGE_RETURN_COMMENT_URL='[
  {"id":"T_carriage_return_url","isResolved":false,"isOutdated":false,"path":"h21.js","line":21,
   "comments":{"nodes":[{"databaseId":838,"author":{"login":"codex","__typename":"Bot"},"body":"carriage-return url","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#a\rhttps://github.com/acme/widgets/pull/12#b"}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}
]'
d="$(new_case)"
threads_one_page "$CARRIAGE_RETURN_COMMENT_URL" >"$d/threads-1"
threads_one_page "$CARRIAGE_RETURN_COMMENT_URL" >"$d/threads-2"
run "$d" --repo acme/widgets 12
assert_eq "h21: carriage-return comment url fails closed (exit 3)" "$RUN_RC" 3
assert_eq "h21: no stdout emitted" "$RUN_OUT" ""
assert_contains "h21: extraction diagnosis on stderr" "$RUN_ERR" "malformed response — could not extract comment urls"
assert_eq "h21: both whole-fetch attempts ran" "$(count_matches "$d/log" '[owner=')" 2

# h22: bind the outer nodes-array check without relying on malformed pageInfo.
d="$(new_case)"
for n in 1 2; do
	cat >"$d/threads-$n" <<'JSON'
{"data":{"repository":{"nameWithOwner":"acme/widgets","pullRequest":{"number":12,"url":"https://github.com/acme/widgets/pull/12","reviewThreads":{"totalCount":1,"nodes":{"one":{"id":"T_outer_nodes","isResolved":false,"isOutdated":false,"path":"h22.js","line":22,"comments":{"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}}},"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}
JSON
done
run "$d" --repo acme/widgets 12
assert_eq "h22: non-array outer nodes fails closed (exit 3)" "$RUN_RC" 3
assert_eq "h22: no stdout emitted" "$RUN_OUT" ""
assert_contains "h22: extraction diagnosis on stderr" "$RUN_ERR" "malformed response — could not extract comment urls"
assert_eq "h22: both whole-fetch attempts ran" "$(count_matches "$d/log" '[owner=')" 2

# h23: bind the outer boolean check with an otherwise-usable cursor.
d="$(new_case)"
for n in 1 2; do
	cat >"$d/threads-$n" <<'JSON'
{"data":{"repository":{"nameWithOwner":"acme/widgets","pullRequest":{"number":12,"url":"https://github.com/acme/widgets/pull/12","reviewThreads":{"totalCount":0,"nodes":[],"pageInfo":{"hasNextPage":"false","endCursor":"OUTER_BOOL_CURSOR"}}}}}}
JSON
done
run "$d" --repo acme/widgets 12
assert_eq "h23: non-boolean outer hasNextPage fails closed (exit 3)" "$RUN_RC" 3
assert_eq "h23: no stdout emitted" "$RUN_OUT" ""
assert_contains "h23: extraction diagnosis on stderr" "$RUN_ERR" "malformed response — could not extract comment urls"
assert_eq "h23: both whole-fetch attempts ran" "$(count_matches "$d/log" '[owner=')" 2

# h24: bind the initial comments nodes-array check with valid pageInfo.
INITIAL_NODES_OBJECT='[
  {"id":"T_initial_nodes","isResolved":false,"isOutdated":false,"path":"h24.js","line":24,
   "comments":{"nodes":{"one":{"databaseId":843,"author":{"login":"codex","__typename":"Bot"},"body":"comment A","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r843"}},"pageInfo":{"hasNextPage":false,"endCursor":null}}}
]'
d="$(new_case)"
threads_one_page "$INITIAL_NODES_OBJECT" >"$d/threads-1"
threads_one_page "$INITIAL_NODES_OBJECT" >"$d/threads-2"
run "$d" --repo acme/widgets 12
assert_eq "h24: non-array initial nodes fails closed (exit 3)" "$RUN_RC" 3
assert_eq "h24: no stdout emitted" "$RUN_OUT" ""
assert_contains "h24: extraction diagnosis on stderr" "$RUN_ERR" "malformed response — could not extract comment urls"
assert_eq "h24: both whole-fetch attempts ran" "$(count_matches "$d/log" '[owner=')" 2
assert_eq "h24: no nested request attempted" "$(count_matches "$d/log" '[threadId=')" 0

# h25: bind the initial comments boolean check with an otherwise-usable cursor.
INITIAL_BOOL_STRING='[
  {"id":"T_initial_bool","isResolved":false,"isOutdated":false,"path":"h25.js","line":25,
   "comments":{"nodes":[{"databaseId":839,"author":{"login":"codex","__typename":"Bot"},"body":"comment A","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r839"}],"pageInfo":{"hasNextPage":"false","endCursor":"INITIAL_BOOL_CURSOR"}}}
]'
d="$(new_case)"
threads_one_page "$INITIAL_BOOL_STRING" >"$d/threads-1"
threads_one_page "$INITIAL_BOOL_STRING" >"$d/threads-2"
run "$d" --repo acme/widgets 12
assert_eq "h25: non-boolean initial hasNextPage fails closed (exit 3)" "$RUN_RC" 3
assert_eq "h25: no stdout emitted" "$RUN_OUT" ""
assert_contains "h25: extraction diagnosis on stderr" "$RUN_ERR" "malformed response — could not extract comment urls"
assert_eq "h25: both whole-fetch attempts ran" "$(count_matches "$d/log" '[owner=')" 2
assert_eq "h25: no nested request attempted" "$(count_matches "$d/log" '[threadId=')" 0

# h26: bind the fetched nested comments nodes-array check with valid pageInfo.
d="$(new_case)"
for n in 1 2; do
	cat >"$d/threads-$n" <<'JSON'
{"data":{"repository":{"nameWithOwner":"acme/widgets","pullRequest":{"number":12,"url":"https://github.com/acme/widgets/pull/12","reviewThreads":{"totalCount":1,"nodes":[
  {"id":"T_nested_nodes","isResolved":false,"isOutdated":false,"path":"h26.js","line":26,
   "comments":{"nodes":[{"databaseId":840,"author":{"login":"codex","__typename":"Bot"},"body":"comment A","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r840"}],"pageInfo":{"hasNextPage":true,"endCursor":"NESTED_NODES_CURSOR"}}}
],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}
JSON
	printf '%s\n' '{"data":{"node":{"comments":{"nodes":null,"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}' >"$d/comments-$n"
done
run "$d" --repo acme/widgets 12
assert_eq "h26: non-array nested nodes fails closed (exit 3)" "$RUN_RC" 3
assert_eq "h26: no stdout emitted" "$RUN_OUT" ""
assert_contains "h26: extraction diagnosis on stderr" "$RUN_ERR" "malformed response — could not extract comment urls"
assert_eq "h26: both whole-fetch attempts ran" "$(count_matches "$d/log" '[owner=')" 2
assert_eq "h26: both nested-page attempts ran" "$(count_matches "$d/log" '[threadId=')" 2

# h27: bind the fetched nested boolean check with an otherwise-usable cursor.
d="$(new_case)"
for n in 1 2; do
	cat >"$d/threads-$n" <<'JSON'
{"data":{"repository":{"nameWithOwner":"acme/widgets","pullRequest":{"number":12,"url":"https://github.com/acme/widgets/pull/12","reviewThreads":{"totalCount":1,"nodes":[
  {"id":"T_nested_bool","isResolved":false,"isOutdated":false,"path":"h27.js","line":27,
   "comments":{"nodes":[{"databaseId":841,"author":{"login":"codex","__typename":"Bot"},"body":"comment A","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r841"}],"pageInfo":{"hasNextPage":true,"endCursor":"NESTED_BOOL_START"}}}
],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}
JSON
	cat >"$d/comments-$n" <<'JSON'
{"data":{"node":{"comments":{"nodes":[{"databaseId":842,"author":{"login":"alice","__typename":"User"},"body":"comment B","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r842"}],"pageInfo":{"hasNextPage":"false","endCursor":"NESTED_BOOL_CURSOR"}}}}}
JSON
done
run "$d" --repo acme/widgets 12
assert_eq "h27: non-boolean nested hasNextPage fails closed (exit 3)" "$RUN_RC" 3
assert_eq "h27: no stdout emitted" "$RUN_OUT" ""
assert_contains "h27: extraction diagnosis on stderr" "$RUN_ERR" "malformed response — could not extract comment urls"
assert_eq "h27: both whole-fetch attempts ran" "$(count_matches "$d/log" '[owner=')" 2
assert_eq "h27: both nested-page attempts ran" "$(count_matches "$d/log" '[threadId=')" 2

# h28: bind the overflow thread-id type check with a positive-length object.
NONSTRING_THREAD_ID='[
  {"id":{"value":"T_nonstring_id"},"isResolved":false,"isOutdated":false,"path":"h28.js","line":28,
   "comments":{"nodes":[{"databaseId":844,"author":{"login":"codex","__typename":"Bot"},"body":"comment A","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r844"}],"pageInfo":{"hasNextPage":true,"endCursor":"NONSTRING_ID_CURSOR"}}}
]'
d="$(new_case)"
threads_one_page "$NONSTRING_THREAD_ID" >"$d/threads-1"
threads_one_page "$NONSTRING_THREAD_ID" >"$d/threads-2"
cat >"$d/comments-1" <<'JSON'
{"data":{"node":{"comments":{"nodes":[{"databaseId":845,"author":{"login":"alice","__typename":"User"},"body":"comment B","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r845"}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}
JSON
run "$d" --repo acme/widgets 12
assert_eq "h28: non-string overflow thread id fails closed (exit 3)" "$RUN_RC" 3
assert_eq "h28: no stdout emitted" "$RUN_OUT" ""
assert_contains "h28: extraction diagnosis on stderr" "$RUN_ERR" "malformed response — could not extract comment urls"
assert_eq "h28: both whole-fetch attempts ran" "$(count_matches "$d/log" '[owner=')" 2
assert_eq "h28: no nested request attempted" "$(count_matches "$d/log" '[threadId=')" 0

# h29: bind the initial cursor type check with a positive-length object.
NONSTRING_INITIAL_CURSOR='[
  {"id":"T_nonstring_initial_cursor","isResolved":false,"isOutdated":false,"path":"h29.js","line":29,
   "comments":{"nodes":[{"databaseId":846,"author":{"login":"codex","__typename":"Bot"},"body":"comment A","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r846"}],"pageInfo":{"hasNextPage":true,"endCursor":{"value":"INITIAL_CURSOR"}}}}
]'
d="$(new_case)"
threads_one_page "$NONSTRING_INITIAL_CURSOR" >"$d/threads-1"
threads_one_page "$NONSTRING_INITIAL_CURSOR" >"$d/threads-2"
cat >"$d/comments-1" <<'JSON'
{"data":{"node":{"comments":{"nodes":[{"databaseId":847,"author":{"login":"alice","__typename":"User"},"body":"comment B","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r847"}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}
JSON
run "$d" --repo acme/widgets 12
assert_eq "h29: non-string initial cursor fails closed (exit 3)" "$RUN_RC" 3
assert_eq "h29: no stdout emitted" "$RUN_OUT" ""
assert_contains "h29: extraction diagnosis on stderr" "$RUN_ERR" "malformed response — could not extract comment urls"
assert_eq "h29: both whole-fetch attempts ran" "$(count_matches "$d/log" '[owner=')" 2
assert_eq "h29: no nested request attempted" "$(count_matches "$d/log" '[threadId=')" 0

# h30: bind the fetched nested cursor type check with a positive-length object.
d="$(new_case)"
for n in 1 2; do
	cat >"$d/threads-$n" <<'JSON'
{"data":{"repository":{"nameWithOwner":"acme/widgets","pullRequest":{"number":12,"url":"https://github.com/acme/widgets/pull/12","reviewThreads":{"totalCount":1,"nodes":[
  {"id":"T_nonstring_nested_cursor","isResolved":false,"isOutdated":false,"path":"h30.js","line":30,
   "comments":{"nodes":[{"databaseId":848,"author":{"login":"codex","__typename":"Bot"},"body":"comment A","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r848"}],"pageInfo":{"hasNextPage":true,"endCursor":"NESTED_CURSOR_START"}}}
],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}
JSON
	cat >"$d/comments-$n" <<'JSON'
{"data":{"node":{"comments":{"nodes":[{"databaseId":849,"author":{"login":"alice","__typename":"User"},"body":"comment B","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r849"}],"pageInfo":{"hasNextPage":true,"endCursor":{"value":"NESTED_CURSOR"}}}}}}
JSON
done
cat >"$d/comments-3" <<'JSON'
{"data":{"node":{"comments":{"nodes":[{"databaseId":850,"author":{"login":"bob","__typename":"User"},"body":"comment C","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r850"}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}
JSON
run "$d" --repo acme/widgets 12
assert_eq "h30: non-string nested cursor fails closed (exit 3)" "$RUN_RC" 3
assert_eq "h30: no stdout emitted" "$RUN_OUT" ""
assert_contains "h30: extraction diagnosis on stderr" "$RUN_ERR" "malformed response — could not extract comment urls"
assert_eq "h30: both whole-fetch attempts ran" "$(count_matches "$d/log" '[owner=')" 2
assert_eq "h30: both nested-page attempts ran" "$(count_matches "$d/log" '[threadId=')" 2

# h31: bind the outer cursor type check with a positive-length object.
d="$(new_case)"
for n in 1 2; do
	cat >"$d/threads-$n" <<'JSON'
{"data":{"repository":{"nameWithOwner":"acme/widgets","pullRequest":{"number":12,"url":"https://github.com/acme/widgets/pull/12","reviewThreads":{"totalCount":0,"nodes":[],"pageInfo":{"hasNextPage":true,"endCursor":{"value":"OUTER_CURSOR"}}}}}}}
JSON
done
cat >"$d/threads-3" <<'JSON'
{"data":{"repository":{"nameWithOwner":"acme/widgets","pullRequest":{"number":12,"url":"https://github.com/acme/widgets/pull/12","reviewThreads":{"totalCount":0,"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}
JSON
run "$d" --repo acme/widgets 12
assert_eq "h31: non-string outer cursor fails closed (exit 3)" "$RUN_RC" 3
assert_eq "h31: no stdout emitted" "$RUN_OUT" ""
assert_contains "h31: extraction diagnosis on stderr" "$RUN_ERR" "malformed response — could not extract comment urls"
assert_eq "h31: both whole-fetch attempts ran" "$(count_matches "$d/log" '[owner=')" 2

# ============================================================================
# (i) response-identity mismatch — fail closed after the single whole-fetch retry
# ============================================================================
# Post-013 the helper asserts the identity echoed by every threads page BEFORE
# looking at any comment url. The nodes here are well-formed and in scope, so
# only the identity gate can reject them; its stderr diagnosis is the generic
# "response identity does not match" line (no urls are named — the whole page
# is untrusted), distinct from the offender-listing scope and malformed-response
# diagnoses exercised above. Each case keeps pullRequest.url pinned to the
# CANONICAL value so exactly one asserted identity field is wrong — a helper
# that skipped the nameWithOwner/number checks could not pass these by validating
# the (unasserted) url instead.
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

# i4: a stringified copy of the requested number must fail the numeric type gate
# even though jq -r would otherwise render it identically to the CLI argument.
d="$(new_case)"
for n in 1 2; do
	cat >"$d/threads-$n" <<'JSON'
{"data":{"repository":{"nameWithOwner":"acme/widgets","pullRequest":{"number":"12","url":"https://github.com/acme/widgets/pull/12","reviewThreads":{"totalCount":1,"nodes":[
  {"id":"T_string_pr","isResolved":false,"isOutdated":false,"path":"i4.js","line":4,
   "comments":{"nodes":[{"databaseId":851,"author":{"login":"codex","__typename":"Bot"},"body":"in scope","diffHunk":"@@","url":"https://github.com/acme/widgets/pull/12#discussion_r851"}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}
],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}
JSON
done
run "$d" --repo acme/widgets 12
assert_eq "i4: string PR number fails closed (exit 3)" "$RUN_RC" 3
assert_eq "i4: no stdout emitted" "$RUN_OUT" ""
assert_contains "i4: identity diagnosis on stderr" "$RUN_ERR" "response identity does not match"
assert_eq "i4: fetched twice (retry once)" "$(count_matches "$d/log" '[owner=')" 2

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
