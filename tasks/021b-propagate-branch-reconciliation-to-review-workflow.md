# 021b — Give `wf-address-review` the no-work-lost branch reconciliation

## Why this task exists

PR #29 added a branch-reconciliation rule to `address-review` step 1. Before addressing anything, the run compares the local tip against the PR's `headRefOid` and decides by ancestry rather than by a standing preference: fast-forward a strictly-behind branch, keep local whenever the PR head is represented in it by patch-id, and stop for a maintainer call on genuine divergence. It exists because the old "always use local" rule silently addressed review on a stale checkout, and because the zero-item path could otherwise carry a strictly-behind tip into publication, where the only push that reaches the recorded head is a force-push deleting newer remote commits.

`plugins/dev-skills/workflows/wf-address-review.js` implements the same procedure as a dynamic workflow and did not get that rule. Its resolve phase populates `headOid` purely as publication metadata for the lease and never compares it to the checked-out tip, so the workflow keeps exactly the behaviour the skill just stopped doing.

This is not a copy-paste of the skill's paragraph, which is why it is a task rather than a line in PR #29. The workflow deliberately does **not** own the checkout: its resolve prompt says *"Do NOT switch branches: `workingBranch` is whatever is checked out"*, and it supports a case the skill does not — a local off-shoot of a merge-pending PR, where `workingBranch` legitimately differs from the PR's `branch` and fixes are made on the off-shoot while `branch`/`headOid` stay publication metadata. A fast-forward is a checkout mutation, and on the off-shoot path "local is behind the PR head" is the normal, correct state rather than the hazard the skill's rule fires on. Applying the rule unconditionally would break the workflow's own supported case.

## The decision

**The workflow reconciles, restricted to runs where `workingBranch == branch`.** Where the names differ, the off-shoot case is in play and reconciliation is skipped entirely — that is the whole of the exemption, and it needs no further conditions.

Deliberate opt-out was **considered and declined.** Opting out would close the publication hazard via the guard below while leaving the workflow to review and fix against a stale tip — wasted or wrong work rather than destroyed work. The rule exists because addressing review on a stale checkout is itself the defect; the guard only stops the loss that follows.

The workflow is meant to be the *efficient* path for happy-path situations, with as few places as possible where it must exercise judgment. So the rule is expressed as two probes with three outcomes, and anything it does not recognise is handed back to the maintainer rather than guessed at.

## The rule

Let `H` be the checked-out tip and `R` the PR's `headRefOid`.

```
S = git rev-list --right-only --cherry-pick H...R    # remote work not represented in local
if S is empty                          -> work on H as it stands
elif git merge-base --is-ancestor H R  -> git merge --ff-only R, then work
else                                   -> skip this PR for the run, with a reason
```

The first probe is doing the real work: `--cherry-pick` drops commits that have a patch-id twin on the other side, so one empty result covers *identical*, *local ahead by unpushed commits*, *local rebased onto a newer base*, and *rebased plus ahead* — the cases in which local already carries everything the remote has. Patch-id rather than raw ancestry is the load-bearing choice: a branch rebased onto a newer base carries the PR head's content forward while sharing no SHAs with it, so a raw-ancestry test would misclassify an ordinary rebased branch as divergent.

Behaviour was verified against a scratch repository for each case below.

| Situation | `S` | `H` ancestor of `R` | Outcome |
|---|---|---|---|
| Identical | empty | yes | work |
| Local ahead by an unpushed commit | empty | no | work |
| Rebased onto a newer base | empty | no | work |
| Rebased *and* ahead | empty | no | work |
| Predecessor squash-merged upstream, local restacked | empty | no | work |
| Strictly behind | non-empty | **yes** | fast-forward, then work |
| Genuine divergence | non-empty | no | skip |
| Local squashed or dropped commits | non-empty | no | skip |
| Remote head carries a merge the local branch lacks | non-empty | no | skip |

The stacked-PR row matters because chained PRs are a normal use: a restack after a predecessor merged keeps the replayed commits' patch-ids, so it lands in the "work" bucket without special handling.

**An unrepresented merge commit on the remote head is deliberately treated as ambiguous.** Patch-id cannot speak for a merge, so the probe reports it and the run stops. That costs one extra ask when the PR head was advanced by a UI "Update branch" merge while local is a linear rebase. Excluding merges from the probe would remove the ask, and must not be done: a merge that resolved conflicts would then read as represented and its resolution would be dropped on publication — the work-loss path PR #29 closed on the skill side. Distinguishing a trivial merge from a resolving one was considered and declined as more intricacy than the case is worth.

The skip path is not a failure. It reports what it saw, asks the maintainer to put the branch into a state the rule recognises, and moves on without addressing that PR in this run. Users converge on branch states the workflow accepts, which is the intended outcome.

## Scope

Included:

- Reconcile per the rule above in the resolve phase, gated on `workingBranch == branch`.
- Close the publication hazard, which is independent of the reconciliation and is the part that must not be left open: a strictly-behind tip must never reach the push step. The workflow's push already prefers a normal push when the expected tip is an ancestor of `HEAD` and an exact lease otherwise; add the missing case, where `HEAD` is a proper ancestor of `headOid`. There is nothing to publish, and the lease path would delete newer remote commits — the lease matches, so it succeeds and rewinds the branch. It must set `published: false` with an explicit reason and stop, exactly as the lease-rejected path already does.
- Check whether `wf-address-tasks.js` has an equivalent exposure before assuming it does not.

Out of scope:

- Changing the workflow's off-shoot support or its "do not switch branches" stance. Both are deliberate; this task works within them.
- Re-litigating the reconciliation rule itself. It is settled in `address-review` and this task only renders it for the workflow.
- Recovering branch states the rule does not recognise. Dropped commits, squashes, and resolving merges are handed back to the maintainer by design.

## Context and references

- `plugins/dev-skills/skills/address-review/SKILL.md` step 1, "Reconcile the local branch with the PR head" — the rule this renders, including its merge-commit sentence.
- `plugins/dev-skills/workflows/wf-address-review.js` — the resolve phase populating `pr.headOid`/`workingBranch` (and its "Do NOT switch branches" instruction), and the publish phase's ancestor/lease branch.
- PR #29 thread `PRRT_kwDOTNFS7M6VaOv1` — the reviewer finding about a stale local tip reaching publication, and the maintainer's no-work-lost heuristic that the rule encodes.

## Target files or areas

- `plugins/dev-skills/workflows/wf-address-review.js`
- `plugins/dev-skills/workflows/wf-address-tasks.js` (audit only, unless the same exposure is found)

## Implementation notes

- The two probes are the whole rule. Resist growing them into a classifier that names every branch state; the third outcome exists precisely so unrecognised states need no enumeration.
- The fast-forward is the only checkout mutation this task introduces, and it is confined to the `workingBranch == branch` path.
- The publication guard is worth landing on its own merits and does not depend on the reconciliation being present.

## Acceptance criteria

- The workflow reconciles per the rule when `workingBranch == branch`, and skips reconciliation entirely when the names differ.
- Every "work" row of the table above proceeds without a maintainer prompt; every "skip" row stops with a reason naming what it saw.
- A run whose checked-out tip is a proper ancestor of `headOid` stops before publication with an explicit reason and never reaches the lease push.
- The off-shoot case (`workingBranch != branch`) still works, and a delivery that breaks it fails this criterion.
- The representation test is patch-id-based, not raw ancestry.
- `wf-address-tasks.js` is confirmed either unaffected or fixed.

## Validation

- Walk every row of the table against the delivered text, plus a local off-shoot of a merge-pending PR. The off-shoot must survive unchanged.
- The scratch-repository construction used to verify the table is cheap to rebuild: create a two-commit remote head, then derive each local state from it and run the two probes.

## Review plan

Reviewer confirms the off-shoot path is intact, that the publication guard exists independently of the reconciliation, that the representation test is patch-id-based rather than raw ancestry, and that the skip path reports rather than guesses.
