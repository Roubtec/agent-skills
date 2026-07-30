# 013 — gh-review-threads: fail closed on parser failure and assert response identity

## Why this task exists

`plugins/dev-skills/bin/gh-review-threads` exists to detect the (server-side, GitHub) failure where concurrent GraphQL calls return **another PR's** review threads, and to fail closed (exit 3, empty stdout) instead of letting a publisher post replies and `resolveReviewThread` mutations onto the wrong PR.
Its scope check has a shape blind spot, reproduced deterministically in a kalm2 session: `scope_offenders()` reads comment URLs via a process substitution (`done < <(jq -r '.[].comments.nodes[].url' <<<"$combined")` at line 282), and a `jq` failure inside a process substitution is not caught by `set -euo pipefail`.
With any thread carrying `comments: null`, `comments: {}`, or no `comments` key, `jq` errors and prints nothing, the offender list is empty, and the helper emits its payload with **exit 0** — the guard fails open on exactly the malformed shapes a crossed or truncated response can produce.
Well-formed contamination (right shape, wrong URLs) is still caught; the fix is about shape.
In the same session a live `gh-review-threads 142` call returned PR #143's comments at exit 0, so the fail-open is not theoretical.

## Scope

Two changes to `plugins/dev-skills/bin/gh-review-threads`, both request-free:

1. **Fail closed on extraction failure.** Two coordinated edits — the callee alone is not sufficient:
   - In `scope_offenders()`, replace the process substitution with a checked command substitution: `urls="$(jq -r '.[].comments.nodes[].url' <<<"$combined")" || return 1`, then iterate over `$urls`. Return a distinguished non-zero status rather than calling the script's `die()` here — `die` exits 1 on the spot, so the first malformed response would bypass the mandatory whole-fetch retry and never produce the documented exit 3.
   - At **both** call sites (`gh-review-threads:287` and the retry at `:291`), capture that status in a condition context — `if ! offenders="$(scope_offenders "$combined")"; then` — and treat a non-zero return exactly like a non-empty offender list. This edit is mandatory: the call sites today are bare assignments discriminating only on `[ -n "$offenders" ]`, and a `return 1` yields *empty* output plus status 1, so under `set -euo pipefail` the bare assignment would abort the script with exit 1 — reproducing the very bypass this task exists to close.

   Only a retried response that also fails extraction produces exit 3 and empty stdout.
2. **Positive identity assertion.** Request `repository { nameWithOwner }` and `pullRequest { number url }` in the same GraphQL query the helper already sends, and verify they match the requested owner/repo and PR number **before** inspecting comments. Compare `nameWithOwner` **case-insensitively** (lowercase both sides, exactly as the existing URL scope check already does) and the PR number exactly — GitHub resolves `roubtec/powbox` to `Roubtec/powbox`, so an exact string comparison would reject a valid response for a caller who passed noncanonical `--repo` casing, retry, and then fail closed on a healthy PR. This catches a wholesale crossed response even when every thread has zero comments (the URL-based check has nothing to inspect then). Verified against the live API: both fields are returned on the existing query shape at no extra request.

Out of scope: the hermetic test suite lives in `Roubtec/powbox` (`scripts/test-gh-review-threads.sh`) and gets malformed-shape cases in powbox task 033 — coordinate landing order so powbox's Stage 0b (which bakes this file verbatim from the agent-skills clone) does not go red in between.

## Context and references

- `plugins/dev-skills/bin/gh-review-threads:272-300` — `scope_offenders`, the fetch/retry/exit-3 flow to preserve.
- The helper's header comment documents the contamination history and the fail-closed contract; update it to mention the identity assertion.
- powbox `docker/agent/Dockerfile` copies this file to `/usr/local/bin` at image build; behavior changes here reach every container on the next bake.

## Target files or areas

- `plugins/dev-skills/bin/gh-review-threads`

## Implementation notes

- Keep the retry-once-then-fail-closed semantics: an identity mismatch or extraction failure on the first fetch triggers the same single whole-fetch retry as a URL-scope offender today; a second failure exits 3.
- Preserve output byte-compatibility for the success path (downstream consumers parse the JSON array shape).
- Threads legitimately can have zero comment nodes (`nodes: []`) — that is well-formed and must still pass; only parser errors and identity mismatches fail.
- Bash 4+ constructs already in the file are fine to use; keep `set -euo pipefail` discipline. Note the asymmetry that makes Scope item 1 a two-sided edit: a `$(...)` failure IS caught when the assignment carries its own handler or sits in a condition context (`|| return`, `if ! x="$(…)"`), but a bare `x="$(…)"` under `set -e` aborts the script outright. `die` is still correct for genuinely unrecoverable errors elsewhere in the file — just not on the extraction path, which must reach the retry.

## Acceptance criteria

- A response containing a thread with `comments: null`, `comments: {}`, or missing `comments` produces exit 3 and empty stdout (after the one retry).
- A response whose echoed `repository.nameWithOwner` or `pullRequest.number` differs from the request produces exit 3 and empty stdout (after the one retry).
- A response whose echoed `repository.nameWithOwner` differs from the request only in letter case is accepted as valid — no retry, no failure.
- No failure path reaches exit 3 without the single whole-fetch retry having been attempted first.
- Clean well-formed responses (including zero-comment threads) behave byte-identically to today.

## Validation

- Manual fixture runs with a stubbed `gh` covering the three malformed shapes, an identity mismatch, and a clean response.
- `shellcheck` clean.
- Cross-check with powbox task 033's new suite cases once both exist.

## Review plan

Reviewer verifies no code path can reach the final emit with an unvalidated `$combined`, that the identity fields are asserted before comment inspection, and that retry/exit conventions match the existing contamination path exactly.
