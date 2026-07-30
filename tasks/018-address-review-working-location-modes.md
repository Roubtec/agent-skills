# 018 — address-review picks its working location: inline on the branch, worktree from anywhere else

## Why this task exists

Singular `address-review` today works in the current checkout: invoked from the target branch it advances that branch under the maintainer (expected and desired), but invoked from anywhere else it must check the branch out in place, which hijacks the main checkout for the duration of an interactive run and demands a clean tree even when the maintainer's dirt is unrelated. The maintainer wants the singular skill malleable: keep the inline behavior when already on the branch, but otherwise do the work in a worktree so the main checkout stays free for branch management while the review-addressing proceeds — without giving up the interactive main-loop orchestration that distinguishes singular from the hands-off plural. Worktree mode also gives the 016 rebase points a disposable tree to conflict in, and drops the clean-main-checkout preflight where it no longer protects anything.

## Scope

Included:

- **Mode selection** in `address-review`:
  1. Current checkout is on the target branch (compare against the PR `headRefName` / named branch) → work **inline** in place, exactly as today.
  2. Current checkout is on any other branch, or detached → work in a **worktree** (`wt-enter` with a stable slug when the helpers are on PATH, plain `git worktree add` fallback per the `address-reviews` attach rules), leaving the main checkout untouched and free to repoint — git itself already refuses to check the worktree's branch out a second time, so "anything but the worktree branch" needs no extra guard.
  3. An explicit `inline` argument forces mode 1 from anywhere: check the target branch out in the current checkout (creating a local tracking branch if needed) and proceed as if 1 applied; the run ends on that branch.
- **Preflight scopes to the working location**: the clean-tree and no-rebase-in-progress checks apply where the work will happen. In worktree mode the main checkout may be dirty or mid-anything — a newly created worktree is clean by construction, but a **reused** one (the stable slug surviving a prior halted run) gets the same preflight checks, and dirt or a mid-rebase state there is a stop-and-report (it is probably that prior run's remains), never an auto-clean. Only forced `inline` (and natural mode 1) keeps today's clean-main-tree requirement.
- **Orchestration is unchanged**: the main-loop agent stays the orchestrator in every mode, so the interactive channel (ambiguous dispositions, conflict confirmation, PR-identity doubt) is preserved; fixers/reviewer/peer are simply pointed at the working location. Publication pushes from the working location under the existing exact-lease rules.
- **Worktree lifecycle**: branch resolution and attach follow `address-reviews`' "Resolving and checking out each entry" rules wholesale — local-first (a local ref wins over `origin`), `origin` head only when no local branch exists, and fork PRs via the detached-worktree + `gh pr checkout` case (reference, do not restate) — with one exception: a local ref bearing the target's name that has already failed the PR identity check (the check itself is under Implementation notes below), for which local-first is suspended. There the run attaches nothing and substitutes nothing: it reports the collision — the rejected local ref, the verified PR head, and what each points at — and asks the maintainer how to proceed, resuming on their answer; hands-off, the entry halts with that same report. Branch hygiene is the maintainer's call, and every heuristic the run could apply instead invents a new local downstream for an existing upstream: attaching by branch name lands on the rejected ref and succeeds silently (`wt-enter` verifies the branch is checked out, which it is, so unrelated history passes without complaint), deriving a disambiguated name hands back a branch with no verified push target for the publication preflight to match, and checking out detached leaves the fix commits reachable from nothing once `wt-remove` reclaims the worktree. Stopping costs one question; each of those costs a run's work. After publication (or a `no-push` finish) the worktree is removed via `wt-remove` — the branch ref persists in the shared `.git` — and a worktree kept alive by a halt (blocker, unresolved conflict) is reported with its path.
- **`wf-address-review.js` adopts the same rule**: the workflow currently commits on the PR branch in the shared checkout ("no worktree isolation"); as a hands-off flow it takes mode 2 whenever the checkout is not already on the branch, honoring the same `inline` argument.
- **Fork-recipe hardening** in `address-reviews`: the attach recipe this task inherits by reference pairs `git worktree add --detach` with a bare `gh pr checkout <N>`, and the detach does not stop gh selecting a same-named local branch. Unrelated history is caught there only by luck: `gh pr checkout` without `-f` never resets an existing local branch, so the fetch or the `--ff-only` merge refuses it — a side effect of gh declining to clobber, not a check the recipe performs, and one that leaves the run sitting on the rejected ref rather than on the PR head. Fixed where the recipe lives so every caller benefits rather than each working around it: after the checkout, verify for itself that what it landed on carries the verified PR head, and treat a mismatch as the same stop-and-ask above. Hardening it by detaching instead is not available, for the reason the Worktree lifecycle bullet gives: it would trade a wrong branch for no branch.
- Codex mirror updated in step.

Out of scope:

- A symmetric `worktree` token forcing mode 2 while standing on the target branch — that needs the detach-and-restore dance from `address-reviews`; switching off the branch before invoking achieves the same with zero mechanics. Revisit only if the workaround proves annoying.
- `address-reviews`' own mode selection and orchestration (already always-worktree, hands-off) and 033 (batch pipelining) — unaffected. The one exception is the attach recipe this task inherits from it by reference, whose hardening is in scope above.

## Context and references

- `plugins/dev-skills/skills/address-review/SKILL.md` — the preflight (clean tree, no rebase in progress) and PR-resolution steps this task makes location-aware.
- `plugins/dev-skills/skills/address-reviews/SKILL.md` — "Resolving and checking out each entry" carries the attach rules, local-first guarantee, and slug conventions to borrow (reference, do not restate).
- 014 — implement after it: the skill and workflow both shrink around the extracted review cycle first, so this task edits the surviving per-PR shell once.
- 016 — its two rebase points run in the working location this task selects; in inline mode a rebase rewrites the branch under the maintainer, which is the accepted mode-1 contract (the branch advancing under you is the point).

## Target files or areas

- `plugins/dev-skills/skills/address-review/SKILL.md`, `plugins/dev-skills/workflows/wf-address-review.js`, Codex mirror of the skill.
- `plugins/dev-skills/skills/address-reviews/SKILL.md` and its Codex mirror, for the one-line hardening of the fork attach recipe this task depends on: it pairs `git worktree add --detach` with a bare `gh pr checkout <N>`, which does not stop gh selecting a same-named local branch.

## Implementation notes

- Mode detection starts with one comparison (`git rev-parse --abbrev-ref HEAD` vs the resolved target branch) but a name match alone is not enough: mode 1 additionally requires the skill's existing PR-vs-branch sanity check to pass (shared recent history with the PR head; for fork PRs, the candidate branch's resolved push remote/ref matching the PR head repo/ref, as the publish preflight already computes). The same check gates the ref local-first would attach in mode 2, whichever branch the run started on — otherwise a stale same-named ref is only caught when the run happens to be standing on it. So a same-named but unrelated local branch falls through to mode 2, and there into the stop-and-ask the Worktree lifecycle bullet defines, never *onto that branch*. Reusing a name like `minor-fixes` or `batch-wrap-up` across unrelated work is normal maintainer practice, so this collision is expected rather than exotic; why the run stops instead of picking a branch itself is argued once, in that bullet. Detached HEAD counts as "any other branch" — there is nothing to advance under the user.
- In worktree mode, never touch the main checkout after setup: no restore step is needed (nothing moved), and end-of-run reporting must not assume the main checkout still points where it did at invocation.
- The `inline` token joins the existing argument table; it composes with `no-push` and the ping flags without interaction.

## Acceptance criteria

- Invoked from the target branch: behavior is byte-identical to today (inline, branch advances under the user).
- Invoked from `main` (or detached): the fix lands in a worktree, the main checkout is never switched, dirtied, or required to be clean, and the user can repoint it to any other branch mid-run without breaking the run.
- `inline` from another branch checks out the target and works in place, requiring the clean tree.
- A local branch bearing the target's name but failing the PR identity check never becomes the working location, and is never silently worked around either: the run names both refs, asks the maintainer how to proceed, and resumes on their answer (hands-off: halts the entry with that report) rather than falling through to the local-first attach and committing onto unrelated history.
- Nothing on that path invents a branch. A text resolving the collision by deriving a disambiguated name fails this criterion, because that branch carries no verified push target for the publication preflight to match; so does one prescribing a detached checkout, whose commits are reachable from nothing once the worktree is reclaimed.
- The `address-reviews` attach recipe verifies for itself that what it checked out carries the PR head, rather than resting on gh's refusal to clobber a same-named local ref, and on the success path it still lands that head on a durable local branch — a detached fix-up fails this criterion however correctly it avoids the rejected ref, since it orphans a fork PR's commits at the next worktree reclaim.
- The worktree is reclaimed after publication **and after a `no-push` finish**; a halted run reports the surviving worktree path.
- `wf-address-review` no longer commits in the shared checkout unless it started on the branch or was passed `inline`.

## Validation

- Three dry-runs (`no-push`) against a disposable PR: from the head branch, from `main` with a dirty main checkout, and from `main` with `inline` — verifying working location, main-checkout untouched-ness, and the clean-tree requirement respectively.

## Review plan

Reviewer checks mode selection cannot misfire on branch-name vs `headRefName` mismatches (fork PRs, renamed local branches), that no step after worktree setup touches the main checkout, and that the preflight text is scoped to the working location rather than duplicated per mode.
