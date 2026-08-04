# 011 — Adopt workflow-infra's shared Claude workflows via thin callers

## Why this task exists

This repo's `.github/workflows/claude.yml` and `.github/workflows/claude-code-review.yml` were the seed material for the shared, reusable dual-trigger workflows now maintained in [Roubtec/workflow-infra](https://github.com/Roubtec/workflow-infra) (its PR #1).
The shared versions have since been hardened well beyond the local copies (per-run tool-allowlist computation, fork/Dependabot/untrusted-issue guards, enumerated `gh` verbs for the reviewer, dropped checkout credentials on the review job, a centrally staged review-format contract), and keeping full local definitions here means drift in exactly the direction the extraction was meant to end.
Converting this repo into a thin-caller consumer completes the extraction for its repo of origin and doubles as the reference example for onboarding every other consumer repo.

## Prerequisite

**workflow-infra PR #1 must be merged to its `main` before this task can be implemented** — the callers reference `Roubtec/workflow-infra/.github/workflows/*@main`, and the bundled `stage-review-format` action only exists on `main` once that PR lands.
This task stays queued (not deferred) so its ordering remains visible; the prerequisite is expected to be met shortly.

## Scope

Included:

- Replace the two local workflow files with thin callers per the templates in workflow-infra's `README.md` ("Onboarding a consumer repo").
- A behavior-delta summary in the PR body (see Implementation notes).
- A decision (flagged, not silently applied) on the now-duplicated review-format guidance in this repo's `CLAUDE.md`.

Out of scope:

- Any change to the shared workflows themselves (that work belongs in workflow-infra, reviewed at its own bar).
- Onboarding other consumer repos (this task is their template, executed here only).

## Context and references

- workflow-infra `README.md` → "Onboarding a consumer repo": the canonical caller templates, one-time prerequisites, and the rationale for explicit secret mapping over `secrets: inherit`. Copy the caller YAML from there rather than re-deriving it.
- workflow-infra `.github/workflows/claude.yml` and `claude-code-review.yml`: the called definitions, including the trust-scoped allowlist logic and its comments.
- This repo's PR #23 (`minor-fixes`): the last hardening pass on the local copies; its read-only-reviewer rationale lives on in the shared versions' comments.
- One-time prerequisites are already satisfied for this repo: the Claude GitHub App is installed and `CLAUDE_CODE_OAUTH_TOKEN` exists (the local workflows run today), and workflow-infra's Actions access policy is `user` (shared with all Roubtec-owned repos). Verify rather than assume — see Validation.

## Target files

- `.github/workflows/claude.yml` — replace body with the mention-bot caller template (triggers: `issue_comment`, `pull_request_review_comment`, `issues: [opened]`, `pull_request_review`; permissions `contents: write`, `pull-requests: write`, `issues: write`, `id-token: write`, `actions: read`; explicit `CLAUDE_CODE_OAUTH_TOKEN` secret mapping).
- `.github/workflows/claude-code-review.yml` — replace body with the review caller template (trigger: `pull_request` `[opened, ready_for_review, reopened]`; permissions `contents: read`, `pull-requests: write`, `issues: read`, `id-token: write`; explicit secret mapping).
- `CLAUDE.md` — the "Code Review Format Guidelines" section now duplicates the contract the shared workflows stage via `stage-review-format@main`. Propose trimming it or keeping it (it still serves interactive/local review sessions that never run through CI); flag the choice in the PR body either way, do not silently delete.

## Implementation notes

- The trigger blocks and permissions cannot be centralized — GitHub requires them in the caller, and a called workflow can only downgrade granted permissions. The templates are the irreducible per-repo surface; replicate them exactly and add nothing (no extra secrets, no `secrets: inherit`).
- List the behavior deltas in the PR body so review is about deltas, not boilerplate. Known deltas of the shared versions over the local copies:
  - Review job: Dependabot-actor guard added; `persist-credentials: false` on checkout; allowlist narrowed from `Bash(gh pr:*)` to enumerated verbs (`view`/`diff`/`list`/`checks`/`comment`) plus the inline-comment MCP tool; review-format contract staged from workflow-infra instead of relying on the consumer checkout.
  - Mention bot: tool allowlist computed per-run — build tools (`pnpm`/`npx`/`corepack`) withheld on fork PRs, Dependabot PRs, and untrusted-author issues; `gh pr` surface narrowed to read + comment on fork-PR/untrusted-issue paths; Node/Corepack setup conditional on `package.json` (inert in this repo).
  - Unchanged: model/effort pins (`--model claude-opus-4-8 --effort xhigh`), the same-repo guard, the author-association gate, concurrency groups.
- Comments worth keeping from the local files (e.g. why `synchronize` is not a review trigger) already exist in the shared definitions; do not re-add local comment blocks to the callers — the callers should stay near-verbatim template copies so consumers can be diffed against the template trivially.
- Any behavior this repo needs that the shared workflows do not provide is a workflow-infra change first, not a caller-side workaround; if one surfaces, stop and flag it.

## Acceptance criteria

- Both local workflow files contain only the thin caller (name, trigger block, one `uses:` job with permissions and the explicit secret mapping) — no `runs-on`, no steps, no inlined logic.
- `uses:` refs point at `Roubtec/workflow-infra/.github/workflows/<file>@main`.
- The PR body lists the behavior deltas and the `CLAUDE.md` review-format decision.
- No other workflow, secret, or settings change is bundled in.

## Validation

- `actionlint` passes on the repo.
- Preflight before opening the PR: both reusable workflows resolve on workflow-infra's `main`; `gh api repos/Roubtec/workflow-infra/actions/permissions/access` reports `user`; this repo has the `CLAUDE_CODE_OAUTH_TOKEN` Actions secret and the Claude GitHub App installation.
- The PR itself is the end-to-end test: `pull_request` workflows run from the PR head, so the auto-review check on this very PR exercises the new caller → called-workflow → staged-contract path live. A passing `claude-review` check that posts a contract-conformant review is the acceptance signal.
- After merge, exercise the mention-bot path once (`@claude` comment on a PR or issue) to confirm the called `claude.yml` job fires and responds.

## Review plan

Reviewer: diff each caller against the README template (should be near-verbatim), confirm the permissions match the template exactly and no extra secret is passed, check the PR body's delta list against the shared workflow sources, and confirm the live `claude-review` check on the PR ran the called workflow (job log shows the `workflow_call` resolution) and posted a review following the staged contract.
