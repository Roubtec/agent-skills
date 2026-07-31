# 012b — Require an absolute worktree base for workflow storage probes

## Why this task exists

The imported `wf-address-tasks` workflow asks its bootstrap agent to return an absolute `wtBase`, but `BOOTSTRAP_SCHEMA` requires only `ok` and the later wave-boundary probe falls back to the relative path `.worktrees` when `wtBase` is absent.

A storage-probe agent that starts from another working directory can therefore query no path or the wrong filesystem, weakening the storage-headroom throttle that is meant to prevent `ENOSPC` failures.

PR 27 deliberately keeps the workflow byte-faithful to its powbox source and sends behavior changes to follow-up work, so Copilot's review finding is queued here: https://github.com/Roubtec/agent-skills/pull/27#discussion_r3687598841.

## Scope

Included:

- Require a successful bootstrap result to provide a validated absolute worktree base before the batch starts.
- Remove the relative `.worktrees` fallback from later storage re-probes and always measure the verified bootstrap path.
- Preserve the last valid positive storage reading when a later probe fails or cannot measure the filesystem.
- Add focused regression coverage for omitted, relative, and valid absolute bootstrap paths and for a failed later re-probe.

Out of scope:

- Redesigning the workflow's wave scheduler or per-worktree storage estimate.
- The continuous pipeline and storage-throttling simplification planned by task 033.
- Changes to the image-baked `wt-bootstrap` helper's output contract.

## Context and references

- `plugins/dev-skills/workflows/wf-address-tasks.js:84-94` defines `BOOTSTRAP_SCHEMA`; `wtBase` is described as absolute but is not required.
- `plugins/dev-skills/workflows/wf-address-tasks.js:204-225` defines the bootstrap and storage-probe prompts.
- `plugins/dev-skills/workflows/wf-address-tasks.js:668-678` accepts the bootstrap result, and `plugins/dev-skills/workflows/wf-address-tasks.js:719-775` derives wave width and performs later probes.
- Task 012 is the prerequisite relocation and must land first; its byte-faithfulness constraint is why this behavior fix is separate.
- Task 033 later replaces wave-boundary re-probes as part of vertical pipelining, so complete this hardening before that scheduler rewrite or carry its acceptance criteria into task 033 explicitly.

## Target files or areas

- `plugins/dev-skills/workflows/wf-address-tasks.js`
- A focused workflow regression script under `scripts/`, either extending the existing extraction-based test where cohesive or adding a dedicated storage-probe test
- `plugins/dev-skills/workflows/README.md` if the validation command set changes

## Implementation notes

Treat `boot.ok === true` without a non-empty absolute `wtBase` as a bootstrap contract failure with a clear blocker rather than guessing a path from the workflow or agent working directory.

Keep the existing conservative failure behavior for later probes: a missing, zero, or invalid result must retain the prior measurement instead of resetting `availBytes` and widening concurrency.

Prefer a small pure validation/helper seam that the test can extract without executing the dynamic-workflow runtime, following the existing `mainCheckoutSummary` test pattern.

## Acceptance criteria

- A successful bootstrap cannot proceed when `wtBase` is missing, empty, or relative, and the returned error identifies the invalid bootstrap contract.
- Every later `df` probe receives the exact validated absolute `wtBase`; no relative `.worktrees` fallback remains.
- A failed or unmeasurable later probe retains the last valid positive `availBytes` value and cannot disable an active storage cap.
- Regression coverage proves the omitted, relative, valid absolute, and failed-reprobe cases without needing a live Claude workflow run.
- The workflow still parses under its documented validation command, and the existing checkout-cleanliness regression remains green.

## Validation

- Run the focused storage-probe regression test.
- Run `node scripts/test-checkout-cleanliness-report.mjs`.
- Run the workflow syntax validation documented in `plugins/dev-skills/workflows/README.md` for both workflow files.

## Review plan

Reviewer should verify that no execution path can hand a relative target to `df`, that invalid bootstrap data fails before task work begins, and that a later probe failure preserves rather than relaxes the previous concurrency cap.
