# 014b — Validate the `questionId` of a SPONTANEOUS escalated disposition

## Why this task exists

The review cycle validates an `escalated` disposition's `questionId` only as part of deciding whether a HANDED finding was covered.

```js
// plugins/dev-skills/workflows/wf-review-cycle.js:675
if (!handed.length || !d.findingId) continue;
```

A disposition that covers no handed finding — one with no `findingId`, and every disposition on a pass that was handed nothing at all, which the final confirmation pass always is — reaches that `continue` before the `knownQuestionIds` check at `wf-review-cycle.js:685` and is never examined. So a spontaneous `escalated` disposition may name a `questionId` under which no question exists anywhere: the disposition is still recorded in `findingDispositions` (`wf-review-cycle.js:809`), the schema still calls the back-reference REQUIRED (`wf-review-cycle.js:243`), and nothing reports the breach. The one channel that would have carried it — the `stray:`/`retire:` `disposition-error` entries — is not reachable, because it hangs off the same coverage walk.

Nothing is silently *dropped* in the current shape: the fixer's own question, when it emits one, is appended and served. What is missing is the structural report every other contract breach in this section gets, so the one shape the schema still admits as a `string` is the one that no-ops.

## Scope

Included:

- Validate every `escalated` disposition's `questionId` independently of the coverage walk, so a spontaneous one is judged too.
- Report an id that names no live question as a `disposition-error` carried entry, the way `stray:` and `retire:` breaches already are, under a prefix that cannot collide with a real round-scoped id.
- Decide and state whether an id naming a question the cycle carries as `retired` or `retirementPending` is the same breach or a distinct one — a settled question cannot be escalated to, but a fixer restating a still-live question is the documented re-report, not an error.
- Mirror every change into `wf-address-tasks.js`'s embedded `review-cycle-core` section (`wf-address-tasks.js:1022`, `:1032`, `:1156`, `:590`) and verify the two sections stay byte-identical.
- Extend `scripts/test-review-cycle-retirement.mjs` with the confirmation-pass shapes and bump its per-leg check count.

Out of scope:

- Changing the re-report rule. A pass reusing an id the cycle already carries is restating that question, and the entry from the pass that raised it stays authoritative; that is settled by task 014a and pinned by its scenarios 13 and 17.
- Any coverage obligation on a spontaneous disposition. It covers no finding by construction — this is about the question back-reference alone.

## Context and references

Raised by the peer reviewer on task 014a's branch as a claimed acceptance-criterion-3 blocker, and adjudicated there as neither.

Criterion 3 of task 014a — "A question already retired cannot validate a later `escalated` disposition that names it" — is about VALIDATING a disposition, which in this section means letting it cover a handed finding. A spontaneous disposition covers nothing, so no question validates it. On the path the criterion does name, task 014a's branch enforces it and `main` did not: driving both through a round whose fixer escalates a handed finding onto an already-retired question, the branch carries that finding forward as `outstanding.carried` and `main` counted it covered. Task 014a's scenario 16 pins that.

The gap here is inherited from `main` verbatim, not introduced by task 014a. `main`'s `cycleUndisposedFindings` opened with `if (!handed.length) return [];`, so a pass handed nothing got no validation of any kind. Driving `main` and the branch through the same confirmation pass emitting an `escalated` disposition whose `questionId` names nothing (`"ghost"`, no `openQuestions` entry) produces the identical result on both: verdict `pass`, the disposition recorded, no error, no question. Task 014a narrowed the early return to a per-disposition `continue` so the retirement guard could bind on a pass handed nothing; it did not widen it to the question back-reference, which is this task.

One nearby behaviour is task 014a's and deliberately NOT a defect to undo here: a spontaneous escalation that reuses an id the cycle already carries has its new question body dropped by the re-report rule. That is not retirement-specific — it happens identically when the reused id belongs to a still-LIVE question and no retirement exists anywhere in the cycle — and it is what the fixer prompt already forbids ("under an id no earlier pass used"). `main` instead appended a second entry under the same id, forking the question. A structural report is the right remedy for the reuse; resurrecting the fork is not.

## Target files or areas

- `plugins/dev-skills/workflows/wf-review-cycle.js` — the canonical `review-cycle-core` section: `cycleUndisposedFindings` and the `knownQuestionIds` construction.
- `plugins/dev-skills/workflows/wf-address-tasks.js` — the synthesized copy, which must stay byte-identical.
- `scripts/test-review-cycle-retirement.mjs` — the behavior suite; `CHECKS_PER_LEG` is the assertion that every scenario ran.
- `plugins/dev-skills/skills/review-cycle/SKILL.md` and `codex/dev-skills/skills/review-cycle/SKILL.md` — the wire-format prose mirrors, if the new error is worth stating there.

## Implementation notes

Task 014a must land first: this edits the guard that task reshaped, and the byte-identical mirroring constraint comes from task 014.

The existing guards are the model. `cycleUndisposedFindings` already collects a set (`retiring`) in a first walk over the dispositions before judging coverage in a second; a question-id check fits the same shape without disturbing the coverage contract.

Keep the empty string reportable. The schema asks for non-empty ids, so an empty `questionId` names nothing and is precisely the breach worth reporting — dropping it would repeat the mistake the `retire:` guard's comment calls out.

Weigh the cost of reporting against the round it costs. A carried `disposition-error` entry fails the round, and the confirmation pass is where the cycle is trying to converge, so an over-eager check turns a passing cycle into another round. That is the argument for treating a re-report of a still-LIVE question as no error at all.

## Acceptance criteria

- An `escalated` disposition on a pass handed nothing, whose `questionId` names no question the cycle carries live, is reported as a `disposition-error` carried entry rather than recorded silently.
- The same holds for a disposition with no `findingId` on a pass that WAS handed findings.
- A spontaneous `escalated` disposition naming the question its own packet raises is not reported — that is the normal shape.
- The chosen treatment of a `retired`/`retirementPending` id, and of a re-report of a still-live one, is stated with its reasoning.
- The `review-cycle-core` sections in `wf-review-cycle.js` and `wf-address-tasks.js` are byte-identical.
- `scripts/test-review-cycle-retirement.mjs` covers each of the above on both workflow legs, with `CHECKS_PER_LEG` updated.

## Validation

- Confirm the embedded section is byte-identical:
  `diff <(awk '/BEGIN EMBEDDABLE SECTION: review-cycle-core/,/END EMBEDDABLE SECTION: review-cycle-core/' plugins/dev-skills/workflows/wf-review-cycle.js) <(awk '/BEGIN EMBEDDABLE SECTION: review-cycle-core/,/END EMBEDDABLE SECTION: review-cycle-core/' plugins/dev-skills/workflows/wf-address-tasks.js)`
- Parse-check every touched workflow script with `wf-check`, or with the wrapped `node --check` documented in `plugins/dev-skills/workflows/README.md`'s Validation section — a bare `node --check` on these sources can only fail on an error above their first `export`, so it is not the gate.
- Run `node scripts/test-review-cycle-retirement.mjs` and `node scripts/test-checkout-cleanliness-report.mjs`.
- Mutate the new check away in both workflow files and confirm the suite fails, so the new scenarios pin it rather than merely accompany it.
- If either skill mirror moves, diff the two `review-cycle` SKILL.md mirrors against each other and confirm the divergence set is unchanged apart from the new prose.

## Review plan

Reviewer should drive a confirmation pass that emits an `escalated` disposition naming a `questionId` no question exists under and confirm it now comes back as a carried disposition error; confirm a spontaneous escalation naming the question its own packet raised is still accepted silently; check that the coverage contract for handed findings is unchanged (a spontaneous disposition still carries no coverage obligation); and verify the embedded section is byte-identical as running code, not only as bytes.
