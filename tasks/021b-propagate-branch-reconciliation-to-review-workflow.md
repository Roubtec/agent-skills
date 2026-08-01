# 021b — Give `wf-address-review` the no-work-lost branch reconciliation, or state why it opts out

## Why this task exists

PR #29 added a branch-reconciliation rule to `address-review` step 1. Before addressing anything, the run compares the local tip against the PR's `headRefOid` and decides by ancestry rather than by a standing preference: fast-forward a strictly-behind branch, keep local whenever the PR head is represented in it by patch-id, and stop for a maintainer call on genuine divergence. It exists because the old "always use local" rule silently addressed review on a stale checkout, and because the zero-item path could otherwise carry a strictly-behind tip into publication, where the only push that reaches the recorded head is a force-push deleting newer remote commits.

`plugins/dev-skills/workflows/wf-address-review.js` implements the same procedure as a dynamic workflow and did not get that rule. Its resolve phase populates `headOid` purely as publication metadata for the lease and never compares it to the checked-out tip, so the workflow keeps exactly the behaviour the skill just stopped doing.

This is not a copy-paste of the skill's paragraph, which is why it is a task rather than a line in PR #29. The workflow deliberately does **not** own the checkout: its resolve prompt says *"Do NOT switch branches: `workingBranch` is whatever is checked out"*, and it supports a case the skill does not — a local off-shoot of a merge-pending PR, where `workingBranch` legitimately differs from the PR's `branch` and fixes are made on the off-shoot while `branch`/`headOid` stay publication metadata. A fast-forward is a checkout mutation, and on the off-shoot path "local is behind the PR head" is the normal, correct state rather than the hazard the skill's rule fires on. Applying the rule unconditionally would break the workflow's own supported case.

So the question this task answers is which of the two the workflow should do, not how to paste the paragraph in.

## Scope

Included:

- Decide, and state in the workflow, one of:
  1. **Reconcile like the skill**, restricted to runs where `workingBranch == branch` — the case where the off-shoot exemption does not apply and the skill's reasoning transfers intact; or
  2. **Opt out deliberately**, with the reason recorded where a reader will hit it, namely that the workflow never moves the checkout and treats the off-shoot case as first-class.
- Either way, close the publication hazard, which is independent of that choice and is the part that must not be left open: a strictly-behind tip must never reach the push step. The workflow's push already prefers a normal push when the expected tip is an ancestor of `HEAD` and an exact lease otherwise; add the missing case, where `HEAD` is a proper ancestor of `headOid`. There is nothing to publish, and the lease path would delete newer remote commits. It must set `published: false` with an explicit reason and stop, exactly as the lease-rejected path already does.
- Check whether `wf-address-tasks.js` has an equivalent exposure before assuming it does not.

Out of scope:

- Changing the workflow's off-shoot support or its "do not switch branches" stance. Both are deliberate; this task works within them.
- Re-litigating the reconciliation rule itself. It is settled in `address-review` and this task only decides its applicability here.

## Context and references

- `plugins/dev-skills/skills/address-review/SKILL.md` step 1, "Reconcile the local branch with the PR head" — the rule, and the reasoning to transfer or rebut.
- `plugins/dev-skills/workflows/wf-address-review.js` — the resolve phase populating `pr.headOid`/`workingBranch` (and its "Do NOT switch branches" instruction), and the publish phase's ancestor/lease branch.
- PR #29 thread `PRRT_kwDOTNFS7M6VaOv1` — the reviewer finding about a stale local tip reaching publication, and the maintainer's no-work-lost heuristic that the rule encodes.

## Target files or areas

- `plugins/dev-skills/workflows/wf-address-review.js`
- `plugins/dev-skills/workflows/wf-address-tasks.js` (audit only, unless the same exposure is found)

## Implementation notes

- The skill's rule tests representation by patch-id rather than raw ancestry, because a branch rebased onto a newer base carries the PR head's content forward while sharing no SHAs with it. Any port must keep that distinction; a raw-ancestry port would misclassify an ordinary rebased branch as divergent.
- The publication guard is worth landing even if option 2 is chosen — opting out of reconciliation is not a reason to allow a force-push that deletes commits.

## Acceptance criteria

- The workflow either performs the reconciliation under a stated condition, or documents its opt-out and the off-shoot reason at the point a reader would look for it.
- A run whose checked-out tip is a proper ancestor of `headOid` stops before publication with an explicit reason and never reaches the lease push.
- The off-shoot case (`workingBranch != branch`) still works, and a delivery that breaks it fails this criterion regardless of which option it took.
- `wf-address-tasks.js` is confirmed either unaffected or fixed.

## Validation

- Walk three cases against the delivered text: local equal to the PR head; local strictly behind it; and a local off-shoot of a merge-pending PR. The third must survive unchanged.

## Review plan

Reviewer confirms the off-shoot path is intact, that the publication guard exists independently of which option was taken, and that any ported test is patch-id-based rather than raw ancestry.
