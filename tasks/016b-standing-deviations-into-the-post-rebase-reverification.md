# 016b — Hand the pre-rebase cycle's standing deviations to the post-rebase re-verification

## Why this task exists

Task 016 gave `wf-address-review` a second rebase point and, where it replays anything, a re-verification cycle over the rebased tree. That cycle REPLACES the verdict, so `mergedCycle` in `plugins/dev-skills/workflows/wf-address-review.js` folds the two cycles' `deviations` and `deviationAssessments` on the deviation's exact text: a deviation both cycles state arrives once, and its assessment resolves to the later cycle's, "whose round judged the tree actually being pushed".

That resolution rests on an input the re-verification is never given. `rebaseReverifyInstructions`/`rebaseReverifyCriteria` carry the prior cycle's `workReport` — the dispositions the fixer must carry forward and the reviewer's baseline — and nothing else: the pre-rebase cycle's standing deviations are not handed over. `review-cycle` has every pass restate a standing deviation VERBATIM, which is what makes exact text a usable identity, but a cycle that was never shown the deviation has nothing to restate. So "the later cycle's assessment wins" only fires when the re-verification's fixer independently re-derives the same deviation and writes it byte-identically; otherwise the merge keeps the pre-rebase assessment — a judgment formed against the base the replay moved off — and a deviation the replay resolved outright is still reported as standing.

`wf-address-tasks.js` already does the corresponding thing at the analogous seam: its collision re-review is handed `standingDeviations` and its `collisionDeviationCoverage` replaces the carried assessments with the fresh ones (task 025b, delivered). This task is that shape for the rebase seam.

Raised by the fresh-eyes reviewer during task 016's own review cycle (round 4) as a report-only observation, and recorded here rather than grown into the delivering branch.

## Scope

Included:

- Show the pre-rebase cycle's standing deviations to the re-verification — to its fixer, which `review-cycle` orders to restate each one, and to its reviewer, which owns the in-spec-route judgment and the RATIFY/CONFORM verdict.
- Decide what the merge means once they are shown, and say it where `mergedCycle` states its rule. With the set carried, the later cycle's assessment is a judgment of the tree being pushed rather than a coincidence of identical wording; a deviation the replay resolved should be able to leave the set rather than being folded forward forever.
- Keep the conservative direction the existing merge already has: a deviation the re-verification says nothing about keeps the earlier round's half rather than vanishing.

Out of scope:

- The fold itself and its identity (`deviationText`), settled under 016 and pinned in `scripts/test-address-review-reconcile.mjs`.
- The round budget and the exhausted stop.
- `wf-address-tasks.js`'s collision path, already delivered under 025b.

## Context and references

- `plugins/dev-skills/workflows/wf-address-review.js` — `mergedCycle` and the comment stating the fold's rule; `rebaseReverifyInstructions` and `rebaseReverifyCriteria`, which are what the re-verification is briefed with.
- `plugins/dev-skills/workflows/wf-address-tasks.js` — `standingDeviations` and `collisionDeviationCoverage` at the collision re-review call site, the precedent to follow.
- Task 025b (done) — the same correction for the collision seam, including its decision about what an incomplete assessment means on a path outside `runReviewCycle`'s enforcement.
- `plugins/dev-skills/skills/review-cycle/SKILL.md` — the deviation rules the merge is answerable to: every pass restates a standing deviation verbatim, none vanishes with the loop's last turn, and none reaches the maintainer carrying only the implementer's half.

## Also worth a pin while in this code

`reverifiedRecord`'s no-op branch is unpinned: gutting `return record.range ? { ...record, range: "", verified: "" } : record;` to correct unconditionally leaves the whole suite green. It is behaviourally harmless today — a record naming no commit is corrected to the same thing — and the equivalent property IS pinned for the sibling `collisionReviewedRecord` in `wf-address-tasks.js`, so this is a coverage asymmetry rather than a defect. A fixture whose `recordOnly` carries no `range` would close it.

## Target files or areas

- `plugins/dev-skills/workflows/wf-address-review.js`
- `scripts/test-address-review-reconcile.mjs`

## Acceptance criteria

- The re-verification's fixer and reviewer are both handed the standing deviations the pre-rebase cycle reported.
- The merged result's assessment for a deviation that survived the replay comes from the round that judged the rebased tree, without depending on the two cycles wording the deviation identically.
- Whatever the merge does with a deviation the re-verification drops or resolves is stated in the code that does it, and pinned.
- The no-op branch of `reverifiedRecord` is pinned, or the suite says why it is not worth pinning.

## Validation

- `node scripts/test-address-review-reconcile.mjs`, extended: a re-verification that reports a DIFFERENT assessment of the carried deviation, and one that reports it resolved.
- Gut each added check while keeping its keyword and confirm it fails; a pin that survives its own gutting is not a pin.

## Review plan

Reviewer confirms the deviations reach both roles rather than only the result, that the merge no longer depends on byte-identical restatement for the later assessment to win, and that nothing carried out of the first cycle is silently dropped.
