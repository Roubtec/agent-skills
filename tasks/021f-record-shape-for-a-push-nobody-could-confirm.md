# 021f — Give the disposition record a shape for a push whose read-back could not confirm the ref

## Why this task exists

Task 021a's disposition record has three renderings, and the `address-review` skill authors all three under "Content", "A publication that stopped part-way" and "A publication whose outcome is not known": a run that pushed nothing says its tips are LOCAL ONLY, a part-way publication says what reached origin, and a publication whose per-item account cannot be read says the outcome is UNKNOWN.

Task 023 then added a stop those three cannot describe. The skill's step 7 push recipe — the paragraph beginning "Then, whichever push ran: confirm what actually landed against the ref itself" — ends "an absent ref, a disagreeing OID, or a destination you could not reach is a stop, not a pass". That stop is the only one in step 7 reachable *after* `git push` has already returned 0, and the thing in doubt is the push itself. Whichever rendering the recorder picks, it asserts what the stop says nobody established: LOCAL ONLY puts the tips nowhere, the part-way and no-op lines put them on origin, and the flat unknown is entered on an account defect this run may not have.

So a skill-path run that meets its own push read-back's stop writes a record that misinforms the next run about origin. Nothing is lost — the record still carries the map and the drafted replies — but the reader is told either to expect commits that may not be there or to re-push over a ref that may already carry them.

This is a gap between two shipped changes rather than a defect of either. It became visible while task 023a carried the same recipe into `wf-address-review.js`'s publication brief: the workflow's own record renders a fourth case for exactly this stop (`pushUnconfirmed` in that file, read out of the abort rather than out of the push flags, whose truth the stop withdraws), and 023a was scoped to add no text to any skill, so the skill's contract still states three.

## Scope

Included:

- **A fourth shape in the skill's record contract, or a stated extension of one of the three**, covering a run whose push read-back could not confirm the ref. It must claim neither presence nor absence on origin, and it must not borrow the third state's per-entry reservation where the per-item account is readable — the skill's own rule is to say what is unknown and never to say unknown of what the run does know.
- **Both mirrors, edited in lockstep.** `plugins/dev-skills/skills/address-review/SKILL.md` and `codex/dev-skills/skills/address-review/SKILL.md`; the divergence count for that pair must be unchanged by the edit (40 as of this task).
- **Reconciliation with the workflow copy that already renders it.** `wf-address-review.js` renders this case today, so the skill's wording must agree with what that brief prints rather than describing a second shape, and the comparison belongs in the suite that already reads the record's rules out of the brief and both mirrors.

Out of scope: changing what any workflow does — the workflow side is already correct and its behavior is not in question here; the push recipe's own wording, which PR #68 settled; and the other three renderings, which stay as they are.

## Context and references

- Task 021a — the record contract and its three renderings.
- Task 023 — the push read-back recipe whose stop the contract has no shape for.
- Task 023a — where the gap was found, and where the workflow-side fourth case shipped; its branch changed no skill file by direction.

## Target files or areas

- `plugins/dev-skills/skills/address-review/SKILL.md` and `codex/dev-skills/skills/address-review/SKILL.md` — the disposition-record section.
- `scripts/test-address-review-reconcile.mjs` — the checks that read the record's push-state rules out of the publish brief and both mirrors.

## Acceptance criteria

- The skill states a rendering for a push whose read-back could not confirm the ref, in both mirrors, and the pair's divergence count is unchanged.
- No rendering in the skill asserts that the tips are on origin, or that they are not, for that case.
- The skill's wording and the workflow's rendering agree, and a suite check fails if either side is changed alone.
- The nine focused suites in `.github/workflows/tests.yml` stay green.

## Validation

- `diff codex/dev-skills/skills/address-review/SKILL.md plugins/dev-skills/skills/address-review/SKILL.md | grep -c '^[<>]'` before and after the edit; the count must match.
- Drive the record for that stop from both push-flag reports a publisher can hand back and confirm the skill's shape is what the brief prints.

## Review plan

Reviewer checks that the fourth shape claims less than the three rather than more, that it did not import the third state's reservation over a readable account, and that the skill and the workflow now say the same thing about the same stop.
