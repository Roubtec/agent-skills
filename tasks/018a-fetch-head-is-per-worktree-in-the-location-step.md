# 018a — `one fetch serves both` is false in worktree mode: `FETCH_HEAD` is per-worktree

## Why this task exists

Task 018 gave `wf-address-review`'s gather brief a WORKING LOCATION step that either works inline or attaches a worktree, and it left one sentence behind that the new mode falsifies.

In `plugins/dev-skills/workflows/wf-address-review.js`, the step beginning "Pick the WORKING LOCATION now" fetches the PR's exact head ref and reads `R` from `git rev-parse FETCH_HEAD`, then tells the agent that this is "the same `R` the reconciliation below uses, so one fetch serves both". That fetch runs where the step starts — the main checkout — because the worktree does not exist yet: it is case 4 that attaches one, and `R` is what case 4 creates the branch at. The reconciliation runs somewhere else: the same brief says that in worktree mode "every step below — the reconciliation, the rebase, the thread gathering's git reads — happens there".

`FETCH_HEAD` does not cross that boundary. Git keeps it in the per-worktree git dir, so in a linked worktree `git rev-parse --git-path FETCH_HEAD` prints `.git/worktrees/<name>/FETCH_HEAD`, and a freshly attached worktree has no such file at all: `git rev-parse FETCH_HEAD` there fails with `fatal: ambiguous argument 'FETCH_HEAD': unknown revision or path not in the working tree` while the main checkout resolves one fine (verified directly in a throwaway clone, 2026-08-10). So in worktree mode the two fetches are not one fetch, and an agent that takes "one fetch serves both" as licence to skip the reconciliation's own fetch reads `FETCH_HEAD` in a tree that has none.

Nothing is silently wrong on an ordinary run: the reconciliation paragraph still orders its own fetch in its own words ("fetch the PR's exact head ref WITHOUT moving the local branch, then take `R` from what that fetch actually brought"), so a literal reader fetches twice and is correct. What the clause supplies is a reason not to, and a run that follows it stops with a bare `rev-parse` failure at the gate that decides whether the branch may be acted on at all.

Raised by the fresh-eyes reviewer during task 016's review cycle (round 4), against text that predates 016 on `task/018-address-review-working-location-modes`, and left for this task rather than grown into an already-delivered branch.

## Scope

Included:

- Correct the claim in the location step. Either delete "so one fetch serves both" and say that each tree reads its own `FETCH_HEAD`, or keep one fetch and carry `R` across as a VALUE the reconciliation is handed rather than re-reads — whichever leaves fewer clauses standing. State the per-worktree fact once, wherever the fix lands, so the next reader does not re-derive it.
- Keep the location step's own fetch: `R` is what case 4 creates a missing local `T` at, and what the identity check compares against.
- Leave the reconciliation's fetch ordering an actual fetch. Whatever the fix, the reconciliation must still be able to establish `R` in the tree it runs in.

Out of scope:

- The neighbouring sentence about the base fetch overwriting `FETCH_HEAD` ("run it only after every read of `R` above — the location step's, and the reconciliation's where it ran"), which task 016 already states over readers rather than over one step, and which stays true either way.
- The reconciliation rule itself, its probes and its four outcomes.
- Both `address-review` and `address-reviews` SKILL.md, which do not read `FETCH_HEAD` at all (task 021d is the one that would give them one, and it should land this fact rather than re-import the false clause).

## Context and references

- `plugins/dev-skills/workflows/wf-address-review.js` — the gather brief's location step ("Pick the WORKING LOCATION now", the sentence ending "so one fetch serves both"), the worktree instruction naming which steps run in the worktree, and the reconciliation paragraph's own `git rev-parse FETCH_HEAD`.
- `scripts/test-address-review-reconcile.mjs` — the check "and takes their `R` from the fetched ref, not from an existence test on the recorded OID", which reads the reconciliation half of this out of the rendered brief; a fix here should stay compatible with it or extend it.
- Task 018 — the prerequisite that introduced worktree mode and so made the clause false; it is delivered as PR #71, so this correction cannot ride it.
- Task 021d — carries the fetched-head rule back into the two skills; the same per-worktree fact applies to whatever it writes there.

## Target files or areas

- `plugins/dev-skills/workflows/wf-address-review.js` (the gather brief; no Codex mirror exists for `workflows/`)
- `scripts/test-address-review-reconcile.mjs`, if the fix is worth a pin

## Acceptance criteria

- The brief no longer tells an agent that the location step's fetch serves the reconciliation in worktree mode.
- Either the reconciliation is told to fetch in its own tree (with the per-worktree reason stated), or `R` reaches it as a carried value and no step reads `FETCH_HEAD` outside the tree that wrote it.
- The location step still fetches, and case 4 still has an `R` to create a missing branch at.

## Validation

- Read the delivered brief for both modes: inline, where one fetch genuinely does serve both, and worktree, where the reconciliation runs in a tree the earlier fetch never touched.
- The per-worktree fact is checkable in seconds and worth re-checking on the delivering machine: `git rev-parse --git-path FETCH_HEAD` in a linked worktree, and `git rev-parse FETCH_HEAD` in one that has never fetched.

## Review plan

Reviewer confirms the clause is corrected rather than qualified into something still readable as "skip the second fetch", that whichever tree reads `FETCH_HEAD` is the tree that wrote it, and that the location step's `R` is still available to the case that creates the branch.
