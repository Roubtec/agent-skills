# 021e — Classify a head rewound between `gh pr view` and the setup fetch

## Why this task exists

Task 021d made both review-addressing skills take the head they act on from what the setup fetch actually brought (`git rev-parse FETCH_HEAD`) rather than from the OID `gh pr view` reported, because an existence test on the recorded OID cannot tell a moved head from an unmoved one. That is settled, and the movement it was written for — an advance, or a force-push that left the recorded OID undownloaded — is handled correctly. Adopting the fetched OID unconditionally also widens one case by a seconds-wide window, and neither skill names it.

If `origin` is *rewound* inside that window — a force-push dropping a commit between `gh pr view` and the setup fetch — the entry records the rewound tip as its head, because that is what the fetch brought. A local `<headRefName>` still holding the dropped commit then reconciles as "represented" under `address-review`'s "Reconcile the working location's branch with the PR head before triaging anything", so the local tip is kept; "Step 7 — Publish after the review gate" sees the expected tip as an ancestor of `HEAD` and restores the dropped commit to `origin` through an **ordinary** push — no lease, no boundary re-verification, because the head OID this run recorded never moved. Before 021d the recorded/actual mismatch is what stopped that run.

`address-reviews`'s **Remote-tip refresh guard** already blocks this exact outcome when the rewind is observed *after* an entry's cycle recorded its head: a tip that is an ancestor of local `HEAD` is adopted "unless it is also behind the OID this cycle already recorded: that is a maintainer rewinding the head, and adopting it would let the publisher fast-forward the dropped commits straight back onto origin, so block it for a maintainer decision". The guard's before-Phase-A clause names only the other direction — "that is a head which advanced during setup … do not block" — and a rewind that lands *before* the recording leaves no earlier recorded OID for the fetched tip to be behind of, so the guard has nothing to classify it against. That the shape is real rather than theoretical is already documented in the same skill: step 2's no-local bullet describes the identical restore-the-dropped-commit-through-an-ordinary-push hazard arriving from a different cause (branching at a stale remote-tracking ref that is a *descendant* of the current head).

## Scope

Included:

- Decide what a run does when the head the setup fetch brings is *behind* the OID `gh pr view` reported for the same ref — the one direction 021d's "either way the head moved" collapses into the advance case — and state that decision where each skill states the adopt rule. The plausible answers are to block the entry for a maintainer decision, as the Remote-tip refresh guard does for the same event seen later, or to adopt the rewound tip while recording that a local tip holding dropped commits must not be published from; pick one rather than leaving both readable.
- Extend the Remote-tip refresh guard's before-Phase-A clause so it classifies both directions instead of naming only an advance, keeping it consistent with whatever the setup rule decides. `gh pr view`'s OID is the second observation that makes the classification possible at all, so the decision is available even before a cycle has recorded anything.
- Carry the same correction into `address-review`, whose step 1 is where the reconciliation actually consumes the head, and into both Codex mirrors.

Out of scope:

- Re-litigating 021d's rule that the head comes from the fetch, or 021b's reconciliation outcomes and its patch-id qualifier. Only the *behind* direction of the comparison is in question.
- The off-shoot publication hazard and the enumerated push cases, which are task 021c. If 021c's representation probe turns out to answer this case too, say so there rather than building a second gate here.
- Any attempt to close the window itself by re-reading `gh pr view` after the fetch. Two observations of a moving ref cannot be made atomic; this task is about classifying the pair, not about narrowing the gap.

## Context and references

- `plugins/dev-skills/skills/address-reviews/SKILL.md` — the "PR-number entry — work the PR head" canonical-path paragraph (where the fetched OID is adopted as the entry's head), the **Remote-tip refresh guard** and its before-Phase-A clause, and step 2's no-local bullet naming the same publication hazard from a stale descendant remote-tracking ref.
- `plugins/dev-skills/skills/address-review/SKILL.md` — "Reconcile the working location's branch with the PR head before triaging anything" in step 1, and "Step 7 — Publish after the review gate", where an expected tip that is an ancestor of `HEAD` publishes by ordinary push.
- `codex/dev-skills/skills/address-review/SKILL.md`, `codex/dev-skills/skills/address-reviews/SKILL.md` — the mirrors; no generator keeps them in step.
- `scripts/test-address-review-reconcile.mjs` — carries the workflow-side pin of where the compared head comes from and the four skill paragraphs' pin beside it; the natural home for whatever this task decides.
- Task 021d — the change this consequence follows from; task 021b — the reconciliation rule; task 021c — publication, the step where the loss actually lands.

## Target files or areas

- `plugins/dev-skills/skills/address-reviews/SKILL.md`
- `plugins/dev-skills/skills/address-review/SKILL.md`
- `codex/dev-skills/skills/address-reviews/SKILL.md` (mirror)
- `codex/dev-skills/skills/address-review/SKILL.md` (mirror)
- `scripts/test-address-review-reconcile.mjs`

## Implementation notes

- The window is seconds wide and the outcome is a silently restored commit, so weigh a one-sentence classification against a new mechanism: the guard's later-boundary rule already contains the reasoning and the vocabulary, and the cheapest honest fix is likely to make the setup rule defer to it rather than to state a second policy.
- Prefer a rule that is decidable from what the run already holds — the OID `gh pr view` reported and the OID the fetch brought — over anything requiring a further fetch.
- Whatever is decided must not disturb the advance case, which is the common one and which 021d deliberately made non-blocking.

## Acceptance criteria

- A setup fetch that brings a tip *behind* the reported `headRefOid` reaches a stated outcome in both skills, rather than being folded into the advance case.
- The Remote-tip refresh guard's before-Phase-A clause classifies a rewind as well as an advance, and agrees with the setup rule.
- The advance case and the undownloaded-force-push case still behave exactly as 021d left them.
- Both Codex mirrors carry the identical correction, and each pair's count of deliberate divergences is unchanged.

## Validation

- Walk three cases against the delivered text: the fetch brings the reported OID (nothing to decide), a descendant of it (advance — unchanged), and an ancestor of it (the rewind). The third must reach a named outcome without passing through the advance clause.
- Extend `scripts/test-address-review-reconcile.mjs`'s skill-paragraph block with the new rule, and negative-control the addition by gutting the shipped paragraph in a disposable clone before believing the pass.

## Review plan

Reviewer confirms the rewind direction is decided rather than described, that the setup rule and the Remote-tip refresh guard state the same policy, that the advance case is untouched, and that both mirrors moved together.
