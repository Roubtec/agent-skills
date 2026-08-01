# 012c — Adopt the gh-review-threads hermetic suite so helper changes are validated upstream

## Why this task exists

`plugins/dev-skills/bin/gh-review-threads` is the safety-critical fetcher both address-review skills rely on, yet this repo carries **no executable test for it**. The only guard lives downstream: powbox's hermetic suite `scripts/test-gh-review-threads.sh`, which powbox smoke Stage 0b runs against the helper baked verbatim from this repo's clone. Task 013 changed the helper's observable contract (positive response-identity assertion via `repository { nameWithOwner }` / `pullRequest { number url }`, fail-closed extraction) and merged to `main` on 2026-07-31 with no test executed anywhere — and the downstream suite, still fixtured to the old contract, promptly went red on powbox Tier 1 CI (run 30568178025: 38/56 checks failed, every case rejected by the new identity gate). Task 013 even carried a "coordinate landing order" note; it could not be honored mechanically because nothing upstream runs a test before merge. The suite must live where the helper lives. Precedent: task 012 already imported powbox's `test-checkout-cleanliness-report.mjs` into `scripts/` alongside the workflow it exercises.

## Scope

Included:

- Adopt an adapted copy of powbox's `scripts/test-gh-review-threads.sh` as this repo's `scripts/test-gh-review-threads.sh`, targeting `plugins/dev-skills/bin/gh-review-threads` as the default helper path. Preserve the `GH_REVIEW_THREADS_HELPER` env override (powbox Stage 0b uses it to point the suite at the baked `/usr/local/bin` copy) so one suite body can serve both repos.
- Update the fixtures to the post-013 contract: every threads-page stub must echo `repository.nameWithOwner` and `pullRequest.number` (plus `url`) matching the request, or the identity gate rejects it before any case logic runs. The wrong-PR-number case (powbox's d2, PR 123) echoes `number: 123`; the mixed-case `--repo` case (g) keeps a canonical-cased `nameWithOwner` to prove the case-insensitive compare.
- Add the fail-closed cases 013 introduced, mirroring what powbox task 033 adds downstream: malformed comment shapes (`comments: null`, `comments: {}`, `comments` absent) asserting exit 3 + empty stdout + a diagnostic on stderr, and identity-mismatch cases (wrong `nameWithOwner`, wrong `number`) asserting the same after the single whole-fetch retry.
- A sync-discipline note in the suite header and the helper's header comment: **any behavior change to `gh-review-threads` must update this suite in the same PR.** powbox's copy of the suite remains the bake-time consumer-contract check; fixture/contract updates made here should be importable there.

Out of scope:

- powbox-side changes — its suite update is powbox task 033, landing separately.
- CI wiring beyond documenting the run command. This repo has no shell-test workflow (only `claude.yml` / `claude-code-review.yml`); a minimal workflow running `bash scripts/test-gh-review-threads.sh` is welcome if it fits repo conventions, otherwise document the command — implementer's judgment.
- Deduplicating the two suite copies entirely (e.g. powbox running the suite straight from its staged `.agent-skills-src` clone instead of keeping its own) — a powbox-side follow-up to consider once this lands.

## Context and references

- `plugins/dev-skills/bin/gh-review-threads` — the helper under test; its header documents the contamination history and the fail-closed contract.
- Task 013 (this repo) — the helper contract change this suite must cover; its acceptance criteria are effectively the new cases' spec.
- Task 012 (this repo) — the adoption precedent, including `scripts/test-checkout-cleanliness-report.mjs`.
- powbox `scripts/test-gh-review-threads.sh` — the source suite (cases (a)–(g), fake-`gh` PATH-shim fixture machinery, `assert_eq`/`assert_contains` conventions); resolve the import base against powbox task 033's branch/PR if it has landed, else adapt the fixtures here and let powbox 033 import them back.
- powbox `commands/smoke-test.sh` Stage 0b — how the downstream consumer runs the suite against the baked helper.

## Target files or areas

- `scripts/test-gh-review-threads.sh` (new)
- `plugins/dev-skills/bin/gh-review-threads` (header comment only — the sync-discipline pointer; no behavior change)
- `README.md` or `AGENTS.md` if the repo documents how to run its scripts' tests

## Implementation notes

- The suite is hermetic: it stubs `gh` with a PATH shim and needs only `bash` and `jq` — no network, no auth. Keep it that way.
- Keep powbox's case naming and assertion conventions so diffs between the two copies stay reviewable; keep fixtures small and inline.
- Default helper resolution: powbox's copy defaults to `${ROOT_DIR}/.agent-skills-src/plugins/dev-skills/bin/gh-review-threads`; this repo's copy should default to `plugins/dev-skills/bin/gh-review-threads` relative to the repo root, with `GH_REVIEW_THREADS_HELPER` overriding.
- The scope-contamination stderr contract differs by failure class post-013: URL-scope offenders are still named on stderr; identity mismatches produce the generic "response identity does not match" diagnosis; extraction failures produce the "malformed response" diagnosis. Assert each class's own message, not one shared string.
- Coordination: no hard ordering against powbox task 033, but whichever lands second should reconcile fixtures so the two copies do not drift on day one.

## Acceptance criteria

- `bash scripts/test-gh-review-threads.sh` passes from a clean checkout against the in-repo helper.
- The suite covers: the original (a)–(g) behaviors under post-013 fixtures, the three malformed-comment shapes (exit 3, empty stdout, stderr diagnostic, retry attempted first), identity mismatch on repo and on PR number (same fail-closed assertions), and case-insensitive `nameWithOwner` acceptance (no retry, no failure).
- The sync-discipline note exists in both the suite header and the helper header.
- The run command is documented (workflow or docs, per repo conventions).

## Validation

- `bash scripts/test-gh-review-threads.sh` passes.
- `shellcheck` clean on the suite.
- Spot-check (not committed): reverting the helper to its pre-013 state flips the new cases to FAIL, proving they bind to the contract.

## Review plan

Reviewer confirms the fixtures genuinely echo the post-013 identity contract (not just enough to slip past the gate), that malformed-shape cases are shape-malformed rather than merely wrong-URL, that each failure class asserts its own stderr message, and that the helper's header now points changers at the suite.
