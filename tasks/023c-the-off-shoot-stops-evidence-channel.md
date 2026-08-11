# 023c — Give the off-shoot stop's evidence the same channel the push read-back's stop got

## Why this task exists

023a's review raised that `wf-address-review.js`'s publish brief ordered the publisher to set a FIXED literal `aborted` for the push read-back's stop and, in the same breath, to "report what each URL returned" — while `PUBLISH_SCHEMA` has exactly one free-text field for a stop's reason, `aborted`, which the caller's `stopReason` quotes verbatim into the disposition record. A publisher following that instruction literally satisfies the literal and drops the evidence. 023a fixed that one stop: the brief now orders the phrase to LEAD the field with the per-URL evidence riding after it, and the reconcile suite pins both halves.

The same shape survives one step earlier in the same brief, at the off-shoot's gate, and 023a did not touch it. That clause orders `aborted: "off-shoot does not carry the PR head"` as a closed literal and then requires the stop to name BOTH tips — the expected tip and the HEAD that would have been pushed — and every commit the `git rev-list --right-only --cherry-pick` probe printed. Those three pieces of evidence have the same single channel and the same absent instruction: nothing in the brief says which field carries them, so a publisher can satisfy the literal and report the tips and commits nowhere the caller can read.

It was left out of 023a deliberately rather than missed. The clause and its pins belong to task 021c (`task/021c-publication-guard-for-an-off-shoot`, PR #76), which was in flight in a sibling worktree while 023a was being fixed; 023a's branch carried the clause only as unchanged context. Editing it there would have collided with that branch on the same lines and on the same exact-literal test pins.

## Prerequisite

PR #76 (task 021c) must have landed, so this task edits a settled clause rather than one being rewritten under it. This is an ordering constraint only — the work does not depend on any behavior 021c adds beyond the clause existing in its final wording.

## Scope

Included:

- **The off-shoot stop's evidence channel**, in `publishPrompt` in `plugins/dev-skills/workflows/wf-address-review.js` — the clause whose abort literal is `off-shoot does not carry the PR head`. Say which field carries the two tips and the probe's commits, the way the push read-back's neighbouring clause now says it for the per-URL evidence. `PUBLISH_SCHEMA`'s `aborted` example list carries that literal too, and a publisher filling the field from the example emits whatever it offers: 023a rendered the push read-back's example with its evidence placeholder for exactly that reason, so this literal's example moves with the clause.
- **Whether the two stops should state it the same way.** 023a's clause leads `aborted` with the phrase and appends the evidence, which works because that phrase has exactly one reader — the caller's `pushUnconfirmed` — and it tests the phrase as a case-folded substring rather than by equality. Establish what reads the off-shoot literal and whether it has the same tolerance before copying the form — and if it does not, say what makes the appended form safe here.
- **The pins**, in `scripts/test-address-review-reconcile.mjs`. Two reads currently match `aborted: "off-shoot does not carry the PR head"` as a closed literal: the `offStop` index, and the `gate` line lookup that `namesBothTips`/`namesTheCommits`/`refusesToReconcile` are then derived from — one read feeding three assertions, not three reads. An appended-evidence form breaks both, so they move with the wording, and the suite's `EXPECTED_CHECKS` moves only if a check is genuinely added.

Out of scope: `PUBLISH_SCHEMA`'s field set — this task is about telling the publisher where evidence goes, not about adding a field; the other abort literals in the brief, none of which order evidence the schema has no room for; and the push read-back's own clause, which 023a settled.

## Constraints this task must respect

Task 044's rule governs workflow prompt prose: state the instruction, not a per-case why. 023a's clause earns its short reason because the field choice is not inferable from the schema; hold this one to the same bar rather than restating the whole rationale above in the brief.

The abort literal itself is load-bearing in more than one place. Establish what reads it before changing its shape — a reader matching it by equality rather than as a substring would break silently on an appended form, which is exactly the failure the reconcile suite's negative controls exist to catch.

## Context and references

- Task 023 — the parent, and its criterion of one authoritative recipe at the step that performs the operation.
- Task 023a — the sibling stop this one mirrors, and where the pattern was found and fixed once.
- Task 021c — the off-shoot publication guard that authors the clause, and the reason this was not fixed in 023a's branch.

## Target files or areas

- `plugins/dev-skills/workflows/wf-address-review.js` — `publishPrompt`, the off-shoot gate clause; and `stopReason`, which is what makes `aborted` the channel.
- `scripts/test-address-review-reconcile.mjs` — the two existing reads of the off-shoot abort literal.

## Acceptance criteria

- The off-shoot stop names the field its two tips and probe commits ride in, and a publisher following the clause literally can no longer drop them — nor by filling the field from `PUBLISH_SCHEMA`'s example for that literal, which offers the same form the clause orders.
- Both reads of that literal still resolve against the new wording, and each of the two checks they feed — the one `offStop` is read for and the one derived from `gate` — fails when the evidence instruction is removed, demonstrated by breaking it deliberately, not asserted.
- The clause's other pinned properties are untouched: it still names both tips, still names every commit the probe printed, and still refuses to fast-forward, merge or rebase the off-shoot.
- The suite's check count moves deliberately or not at all.

## Validation

- The focused suites in `.github/workflows/tests.yml` stay green, and `wf-check` passes on `wf-address-review.js`.
- Render the publish brief for the off-shoot path and read the added clause out of the rendered text rather than out of the builder.

## Review plan

Reviewer checks that the change told the publisher where the evidence goes rather than only describing the hazard, that no reader of the abort literal matches it by equality after the change, and that the negative control for each moved pin was actually run.
