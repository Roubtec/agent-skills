# 018 — address-review picks its working location: inline on the branch, worktree from anywhere else

## Why this task exists

Singular `address-review` today works in the current checkout: invoked from the target branch it advances that branch under the maintainer (expected and desired), but invoked from anywhere else it must check the branch out in place, which hijacks the main checkout for the duration of an interactive run and demands a clean tree even when the maintainer's dirt is unrelated.
The maintainer wants the singular skill malleable: keep the inline behavior when already on the branch, but otherwise do the work in a worktree so the main checkout stays free for branch management while the review-addressing proceeds — without giving up the interactive main-loop orchestration that distinguishes singular from the hands-off plural.
Worktree mode also gives the [016](016-default-rebase-policy-in-review-addressing.md) rebase points a disposable tree to conflict in, and drops the clean-main-checkout preflight where it no longer protects anything.

## Scope

Included:

- **Mode selection** in `address-review`:
  1. Current checkout is on the target branch (compare against the PR `headRefName` / named branch) → work **inline** in place, exactly as today.
  2. Current checkout is on any other branch, or detached → work in a **worktree** (`wt-enter` with a stable slug when the helpers are on PATH, plain `git worktree add` fallback per the `address-reviews` attach rules), leaving the main checkout untouched and free to repoint — git itself already refuses to check the worktree's branch out a second time, so "anything but the worktree branch" needs no extra guard.
  3. An explicit `inline` argument forces mode 1 from anywhere: check the target branch out in the current checkout (creating a local tracking branch if needed) and proceed as if 1 applied; the run ends on that branch.
- **Preflight scopes to the working location**: the clean-tree and no-rebase-in-progress checks apply where the work will happen. In worktree mode the main checkout may be dirty or mid-anything — a newly created worktree is clean by construction, but a **reused** one (the stable slug surviving a prior halted run) gets the same preflight checks, and dirt or a mid-rebase state there is a stop-and-report (it is probably that prior run's remains), never an auto-clean. Only forced `inline` (and natural mode 1) keeps today's clean-main-tree requirement.
- **Orchestration is unchanged**: the main-loop agent stays the orchestrator in every mode, so the interactive channel (ambiguous dispositions, conflict confirmation, PR-identity doubt) is preserved; fixers/reviewer/peer are simply pointed at the working location. Publication pushes from the working location under the existing exact-lease rules.
- **Worktree lifecycle**: branch resolution and attach follow `address-reviews`' "Resolving and checking out each entry" rules wholesale — local-first (a local ref wins over `origin`), `origin` head only when no local branch exists, and fork PRs via the detached-worktree + `gh pr checkout` case (reference, do not restate); after publication (or a `no-push` finish) the worktree is removed via `wt-remove` — the branch ref persists in the shared `.git` — and a worktree kept alive by a halt (blocker, unresolved conflict) is reported with its path.
- **`wf-address-review.js` adopts the same rule**: the workflow currently commits on the PR branch in the shared checkout ("no worktree isolation"); as a hands-off flow it takes mode 2 whenever the checkout is not already on the branch, honoring the same `inline` argument.
- Codex mirror updated in step.

Out of scope:

- A symmetric `worktree` token forcing mode 2 while standing on the target branch — that needs the detach-and-restore dance from `address-reviews`; switching off the branch before invoking achieves the same with zero mechanics. Revisit only if the workaround proves annoying.
- `address-reviews` (already always-worktree, hands-off) and [033](033-vertical-task-pipelining.md) (batch pipelining) — unaffected.

## Context and references

- `plugins/dev-skills/skills/address-review/SKILL.md` — the preflight (clean tree, no rebase in progress) and PR-resolution steps this task makes location-aware.
- `plugins/dev-skills/skills/address-reviews/SKILL.md` — "Resolving and checking out each entry" carries the attach rules, local-first guarantee, and slug conventions to borrow (reference, do not restate).
- [014](014-extract-review-cycle-building-block.md) — implement after it: the skill and workflow both shrink around the extracted review cycle first, so this task edits the surviving per-PR shell once.
- [016](016-default-rebase-policy-in-review-addressing.md) — its two rebase points run in the working location this task selects; in inline mode a rebase rewrites the branch under the maintainer, which is the accepted mode-1 contract (the branch advancing under you is the point).

## Target files or areas

- `plugins/dev-skills/skills/address-review/SKILL.md`, `plugins/dev-skills/workflows/wf-address-review.js`, Codex mirror of the skill.

## Implementation notes

- Mode detection starts with one comparison (`git rev-parse --abbrev-ref HEAD` vs the resolved target branch) but a name match alone is not enough: mode 1 additionally requires the skill's existing PR-vs-branch sanity check to pass (shared recent history with the PR head; for fork PRs, the current branch's resolved push remote/ref matching the PR head repo/ref, as the publish preflight already computes) — a same-named but unrelated local branch falls through to mode 2 with the mismatch surfaced. Detached HEAD counts as "any other branch" — there is nothing to advance under the user.
- In worktree mode, never touch the main checkout after setup: no restore step is needed (nothing moved), and end-of-run reporting must not assume the main checkout still points where it did at invocation.
- The `inline` token joins the existing argument table; it composes with `no-push` and the ping flags without interaction.

## Acceptance criteria

- Invoked from the target branch: behavior is byte-identical to today (inline, branch advances under the user).
- Invoked from `main` (or detached): the fix lands in a worktree, the main checkout is never switched, dirtied, or required to be clean, and the user can repoint it to any other branch mid-run without breaking the run.
- `inline` from another branch checks out the target and works in place, requiring the clean tree.
- The worktree is reclaimed after publication; a halted run reports the surviving worktree path.
- `wf-address-review` no longer commits in the shared checkout unless it started on the branch or was passed `inline`.

## Validation

- Three dry-runs (`no-push`) against a disposable PR: from the head branch, from `main` with a dirty main checkout, and from `main` with `inline` — verifying working location, main-checkout untouched-ness, and the clean-tree requirement respectively.

## Review plan

Reviewer checks mode selection cannot misfire on branch-name vs `headRefName` mismatches (fork PRs, renamed local branches), that no step after worktree setup touches the main checkout, and that the preflight text is scoped to the working location rather than duplicated per mode.
