# 049a — Settle the three clause-level nits PR #114 recorded but did not change

## Why this task exists

PR #114 taught `address-review` (both mirrors) to gather failing CI lanes and misfired top-level bot findings, over five review rounds.
Three reviewer nits were judged non-blocking at the time and recorded in that PR's round summaries under "Noted, not changed" rather than fixed, so the branch could converge.
A later round of that PR then overtook part of the first one, so what nit 1 below states is the part of it still standing at `e14ced7`.
They are small, they are all in prose that task 049 is about to copy onto the workflow surface, and each is a place where the shipped text says less than the rule it belongs to.
Settling them before or alongside 049 keeps the port from carrying a known-imprecise sentence into a second file.

They are recorded here rather than left in a PR comment because a nit that lives only in a merged PR's summary is one nobody will find again.

## Scope

Three prose fixes in `address-review`'s step 3, step 7, step 8, the durable-disposition-record section, and the checklist — both mirrors in lockstep:

1. **The record's field set makes a standalone item's url fill both the stable-reference slot and the permalink slot.** The sentence beginning "**Every entry carries the same field set whatever its disposition**" puts "a standalone item's url" in the stable-reference slot — for a misfired finding, that url plus its `finding N of M` ordinal — and then goes on to require "the permalink" as the next field, which for both of those entry kinds is the same url again. An implementer reading the list literally records it twice or wonders which one is meant. Say once what each entry kind puts in each slot. PR #114 recorded this nit against the CI lane, whose details URL then filled both slots; its rounds 4 and 5 gave a lane a head-independent identity — the workflow-qualified check name, or an external app's slug — so a lane now fills the two slots with two different values and the standalone kinds are what is left. Do not re-word the lane clause back into the nit.
2. **Step 8's CI report bullet and the checklist's CI item do not admit the replayed-lane case.** Step 7 item 5 and the replay rule under "A recorded standalone item is gathered again" both handle a lane carried in from a prior disposition record whose lane has since gone green — its recorded cause and disposition replay into this run's Summary comment rather than being dropped. But step 8's bullet offers only "each failing CI lane step 3 gathered ... — or that the rollup was green or still running", and the checklist item likewise speaks only of lanes gathered on the reconciled head. A run whose only CI content is a replayed entry has no true line to write in either place.
3. **The replay bullet's premise clause still describes only the explicitly-included standalone.** In the same bullet, the phrase "an earlier run's request having identified it is what makes it one" was the whole story when a standalone item could only arrive by the maintainer naming it. Since PR #114 a misfired bot finding qualifies on its own, so for that kind the clause names a thing that never happened. Round 2 broadened the surrounding premise and left this clause; broaden it too, or state the two routes separately.

Out of scope:

- Any change to what the rules *do*. All three are the shipped rule stated more exactly; none of them adds a case, a condition, or a disposition.
- Re-opening anything else from PR #114. The five rounds converged; findings that were fixed stay fixed and the pushed-back set stays pushed back.
- The workflow port itself, which is task 049's whole subject. If 049 lands first, it ports these sentences and this task then corrects them in both places.
- Expanding step 8 or the checklist into an enumeration of every CI outcome. Each is a short account of what the run did; the replayed case needs a clause, not a table.

## Context and references

- `plugins/dev-skills/skills/address-review/SKILL.md` and `codex/dev-skills/skills/address-review/SKILL.md` — anchor each fix by the strings named above: "Every entry carries the same field set whatever its disposition" for nit 1; the *Step 8 — Final report* bullet beginning "Each failing CI lane step 3 gathered" and the checklist item beginning "Failing CI lanes on the reconciled head gathered as items" for nit 2; the bullet "**A recorded standalone item is gathered again.**" for nit 3.
- PR #114's round-1 and round-2 summary comments, which record all three under "Noted, not changed".
- Task 049 — the workflow port that consumes these sentences, and whose own quoted forms may need to follow a wording change here.

## Target files or areas

The two `address-review` mirrors only. `scripts/test-address-review-reconcile.mjs` pins some of this prose beside the workflow's, so a reworded phrase it asserts on must be updated there in the same commit.

## Implementation notes

- Both mirrors move together; their divergence is harness-specific and none of these three sentences is part of it.
- Check each edited phrase against `scripts/test-address-review-reconcile.mjs` before committing — the suite reads skill prose beside the workflow precisely so neither can drift alone, and a reworded anchor breaks it by design rather than by accident.
- If task 049 has already landed, make the same three fixes in `wf-address-review.js`'s corresponding prompt text so the port does not preserve the imprecision.
- Prefer the smallest edit that removes the ambiguity. These are clause-level; a rewritten paragraph would put a five-round convergence back in play for no gain.

## Acceptance criteria

- The record's field set states, for each entry kind, exactly what goes in the stable-reference slot and what goes in the permalink slot, with no entry kind filling both slots with the same url.
- Step 8's CI bullet and the checklist's CI item each admit a replayed lane, so a run reporting only replayed CI content has a true line to write.
- The replay bullet's premise covers both routes by which a standalone item arrives.
- No rule changed: the same items are gathered, the same dispositions are available, and the same things are published.
- Both mirrors are in lockstep and `node scripts/test-address-review-reconcile.mjs` passes.

## Validation

- `node scripts/test-address-review-reconcile.mjs`, plus the full `tests.yml` script set.
- Read the three edited passages against step 3's gather rules and step 7 item 5 end to end, checking that an implementer following only the edited text reaches the same behavior the unedited rules describe.

## Review plan

Reviewer checks that all three nits are settled and none was broadened into a rule change, that the field-set sentence is unambiguous for all three entry kinds rather than only for a CI lane, that step 8 and the checklist gained a clause rather than an enumeration, and that both mirrors and any prose the reconcile suite pins moved together.
