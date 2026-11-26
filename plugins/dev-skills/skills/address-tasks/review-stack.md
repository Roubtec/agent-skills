# Post-batch restack: a local review stack (never pushed)

This file is part of the `address-tasks` skill, and the sections it names (Delivery, Cleanup, Scheduling, Session Bootstrap's `$WT_BASE`) are that skill's `SKILL.md`, beside it.
It is read in full only when the invocation carries `review-stack` or the user asks for the stack afterwards, by a batch that delivered two or more mergeable branches; no batch builds the stack by default.

After Delivery and Cleanup, build one linear **local** stack in the order you recommend reviewing and merging the PRs.
This is an integration check and merge-order guide; it is **never pushed**.

Do **not** rebase the task/PR branch names themselves.
Those local refs should continue to match the pushed PR heads; rewriting them locally creates misleading ahead/behind state and makes later pull/push operations error-prone.
Instead, create disposable `review-stack/...` branches that snapshot the canonical task branches, then rebase only those guide branches.
The guide refs persist in the repo's `.git`, while the PR branches and remote PRs remain unchanged.

**Skip it when** the batch produced **0 or 1** mergeable branch.
Exclude branches that failed review, that the user asked to skip, or whose PR merged during the run — its content is on the base already, so a guide snapshot of it would rebase to nothing; report it as merged rather than stacking it.
If the batch was already a linear dependency chain, still build the guide stack: it verifies the chain against the current local base without risking the PR refs.

**The order** is the merge order `SKILL.md` → "Post-batch overlap check" already had you compute.
Record the order using the canonical task branches as `b1 → b2 → … → bN`, rooted at the chosen local base, where `b1` is the recommended first merge.

Before creating guide branches, inspect each canonical branch's unique history relative to its recorded PR base for merge commits.
If the batch used a synthetic multi-parent integration branch, or `git rev-list --merges <pr-base>..<branch>` is non-empty, do not automatically rebase that branch or any dependent suffix: plain `rebase-stack` intentionally linearizes history and could discard merge-only conflict resolutions.
Build and report the safe prefix, then report the remaining canonical order as not integration-checked and include the integration-branch merge advice already recorded during Scheduling.

Create collision-free guide branch names such as `review-stack/<batch>-<YYYYMMDD-HHMMSS>/01-<task-slug>`, using a git-ref-safe UTC timestamp — digits and dashes only, no `:` (ISO-8601 colons are invalid in ref names), matching the `YYYYMMDD-HHMMSS` form `rebase-stack` already uses for pre-rebase refs.
Those names are unique per batch and clock second, which is what the teardown's ownership check rests on: the same batch run twice at once in one container would share them (and already shares its per-task worktrees), so run a batch once per container.
Point each guide branch `gN` at the captured tip of its canonical branch `bN`; do not check out or move any `bN`.
Create a dedicated worktree attached to `g1`: `git worktree add "$WT_BASE/_review-stack-<batch>-<YYYYMMDD-HHMMSS>" <g1>` (same ref-safe timestamp; `g1` already exists, so this attaches it without creating any branch).
Running the restack there keeps the user's main checkout and current branch untouched.
A fresh worktree has no installed dependencies, so if `rebase-stack`'s post-conflict validation would need a build, install the project's dependencies in this worktree first (cheap when the package store hardlinks — same filesystem).

Delegate the restack to one fresh subagent in that dedicated worktree — one that can edit and run git, which is a `general-purpose` subagent in Claude Code and a `worker` in Codex — and have it invoke the `rebase-stack` skill with the explicit guide chain.
The prompt contract is:

- Start with the usual worktree contract: `cd` to the exact dedicated worktree, verify `git rev-parse --show-toplevel`, and operate only there.
- "Invoke the `rebase-stack` skill in its delegated unattended mode with exactly: `chain <g1> <g2> ... <gN> onto <base>`.
  This explicit chain and prompt are the up-front authorization; do not re-derive, reorder, or wait for confirmation."
- "Every `gN` is a disposable local snapshot created only for this integration check.
  The canonical task branches `b1 ... bN` and all remote refs are read-only."
- "Do not push and do not fetch.
  Resolve only conflicts the skill classifies as trivial.
  On the first non-trivial conflict or unrecoverable validation failure, use the unattended clean-stop behavior.
  If the stop follows the combined replay itself because no confident repair is apparent, restore every guide branch in that run to its snapshot.
  If the combined replay has already been restored for a clear repair and the stop occurs during its per-branch fallback, or the stop follows any other per-branch replay, restore only the current guide branch to its pre-rebase ref.
  Leave the worktree clean and stop without waiting for input."
- "If that validation runs a build and you redirect its output to a file, create a unique directory for it first with `mktemp -d`, outside every worktree, and write there — never a fixed shared scratchpad name (one session's agents share that directory), and never inside this worktree, which must be left clean."
- "Report the canonical merge order, the `bN → gN` mapping, each guide branch outcome, any stop point, every conflict's files/offending commit/resolution or abort reason, any guide branch with no unique commits relative to its new base, and the exact `refs/pre-rebase/...` snapshots created."

After the subagent returns — closing it first where your harness has you close subagents — verify the canonical `bN` tips still equal the SHAs captured before creating the guide branches — every branch of the canonical order the inspection captured, not only the safe prefix, since a merge guard exempts the branches after it from the restack, never from this check — verify the dedicated worktree is at the exact path you created and clean with no rebase in progress, holding one of the guide branches or detached, which is how `rebase-stack` leaves the worktree after restoring a whole run to its snapshots and stopping — a worktree at any other path, or holding any other branch, is not yours to remove, however clean — then remove only that worktree per the Cleanup checks (clean status, no rebase in progress; then `git worktree remove` and `git worktree prune`).
If the subagent unexpectedly returns with a rebase in progress or dirty files, reset it to the newest snapshot under that disposable branch's own `refs/pre-rebase/<guide>/` namespace, enumerated the same way the deletion below finds them (aborting a rebase still in progress first with `git rebase --abort`, since a reset leaves the rebase state behind and the removal would still refuse), clear any untracked leftovers with `git clean -fd`, and confirm a clean `git status` before removal; never force-remove unresolved state.
Delete only the `refs/pre-rebase/...` snapshots the subagent created for these disposable guide branches, enumerated under each guide's own `refs/pre-rebase/<guide>/` namespace rather than taken from its report, so a subagent interrupted after saving them leaves none behind, and only once the worktree is removed; the unchanged canonical `bN` refs are their recovery source.
Where the recovery above could not reclaim the worktree, or its removal refused, keep every snapshot and report them: the held worktree is what those refs recover, and deleting them would take away the recovery you or the maintainer still has to run.
Never bulk-delete unrelated pre-rebase refs.
Do not delete or push the guide branches; they are the local artifact the maintainer can inspect.
The main checkout must remain on the branch and commit where it started.

An empty guide branch means that canonical branch contributes no unique patch after the earlier recommended branches; flag it as potentially redundant or already subsumed, not as a reason to merge it first.
If the restack stops partway, the canonical order remains the review recommendation, but only the completed prefix was integration-checked; report the first unstacked branch and the remaining suffix.
