# 025b — Carry the deviation state through wf-address-tasks' collision re-review

## Why this task exists

Task 025 made the standing deviations from LOCKED maintainer decisions a tracked set with two halves: the implementer's report of what was delivered instead, and the reviewer's in-spec-route judgment plus a RATIFY-or-CONFORM verdict. `runReviewCycle` enforces both — a round does not pass while a standing deviation lacks the reviewer's half, and the result's `deviations`/`deviationAssessments` are what `prPrompt` leads the PR body with.

The collision guard's post-resolution re-review sits outside that cycle and outside its enforcement. When the resolver commits a deconfliction rename to a branch that already finished its cycle, the `re-review:${task.slug}` call in `wf-address-tasks.js` re-reviews the branch with `cycleReviewPrompt(taskCycleConfig(...), { round: 1, packet: null, artifactDir: "" })` — a state object carrying no `deviations` and no `deviationDrops`, so the reviewer's brief renders no deviations block and the reviewer is never shown them. On a pass, the branch is pushed onto `deliverable` as `{ ...result, notes: verdict.notes || result.notes }`: every other field of the cycle's result, `deviations` and `deviationAssessments` among them, is carried through unchanged. `deliverTask` then hands those pre-collision values to `prPrompt`, which leads the PR body with them.

A deconfliction rename changes a file path or an exported symbol on purpose, and a deviation's text is the implementer's prose naming what it delivered — commonly that same file or symbol. So the PR can lead with a deviation naming something the branch no longer contains, carrying a reviewer verdict formed against the pre-rename tree, with no stage between the rename and delivery that ever looked at either.

Raised by the codex reviewer as a P2 on PR #55: <https://github.com/Roubtec/agent-skills/pull/55#discussion_r3740620478>. Not fixed there because closing it properly means adding a coverage gate outside the byte-mirrored `review-cycle-core` section and building the first test harness for the collision dispatch, and because task 027a is already scheduled to rework this exact call site — see "Sequencing".

## Scope

Included:

- Show the branch's standing deviations to the collision re-review, so the one stage that sees the post-rename tree can judge them. A deviation whose text the rename has made obsolete is then something the reviewer can raise as an issue, which the existing arm already turns into a `collision-hold`.
- Replace the carried `deviationAssessments` with the re-review's, rather than delivering a judgment formed against the pre-rename tree.
- Decide, and state in the delivery, what an incomplete assessment means on this path. `cycleReviewPrompt`'s deviations block tells the reviewer "this round does not pass while one of them is unassessed" — a claim `runReviewCycle` enforces and this call site does not. Either enforce it here too (hold the branch, as every other degraded arm does) or give this path a brief that does not assert a gate it has no intention of applying. Do not ship the mismatch: prose that outruns enforcement is the exact defect 025 set out to remove one level up.
- Whatever shape wins, keep the conservative bias the surrounding dispatch already has: an unusable or missing answer holds the branch with an actionable `collision-hold` detail rather than delivering it.

Out of scope:

- The deviation text itself. Only a fixer pass can restate a deviation, and this path deliberately has none; the reviewer's job here is to detect that the text has gone stale, not to rewrite it. If the chosen shape wants a restatement, that is a fixer pass and needs its own justification against the cost this dispatch is trying to avoid.
- The `review-cycle-core` section. The collision dispatch is out-of-section code, so nothing here may perturb the two copies' byte-identity.
- Open questions and retirements on the same path. They are not led with in the PR body and a rename cannot make a question's text obsolete the way it can a deviation's; raise them separately if that judgment turns out wrong.
- The resolver's rename strategy, the `blocked` arm, and the collision facts themselves — those are 027a's.

## Sequencing

Implement AFTER task 027a, which reworks this same dispatch: it re-derives the collision facts from the refs after resolution and explicitly weighs "either feed the re-derived collision state into that prompt or keep the two checks separate". Whatever 027a decides about what the re-review is handed is the frame this task's state belongs in, and landing this first would put a second hand on the same call site.

## Context and references

- The re-review call and its state object: the `re-review:${task.slug}` agent label in `plugins/dev-skills/workflows/wf-address-tasks.js`, in the re-review arm of the `heldTasks` dispatch — the final arm, which 027a widened from "the branches the resolver said it changed" to every held branch of a cleared clash. Cited by anchor rather than by line on purpose: this file first carried a line number, and PR #55's own later commits — growing the `review-cycle-core` section above the call — moved it before the PR merged, while the label is a unique string that survives every such move.
- What the pass carries forward on success: the `deliverable.push({ task, result: { ...result, notes: ... } })` immediately below it.
- Where the carried values surface: `deliverTask` and `prPrompt` in the same file, which lead the PR body with `deviations` and `deviationAssessments`.
- The enforcement this path lacks: the deviation-coverage gate in `runReviewCycle` (the `unassessedDeviations` / `roundPassed` block) and the `deviationsBlock` prose in `cycleReviewPrompt`, both inside the `review-cycle-core` section.
- 027a — re-verify collisions after resolution; the task that owns this dispatch's next rework.
- 025 — the parent task that established the deviation contract.

## Target files or areas

- `plugins/dev-skills/workflows/wf-address-tasks.js` (out-of-section collision dispatch only).
- A test harness for the collision dispatch. None exists: `scripts/test-review-cycle-retirement.mjs` evaluates only the marked `review-cycle-core` section, so the wave/collision code has never been driven as running code. 027a's validation needs the same harness; build it once, under whichever task lands first.

## Acceptance criteria

- The collision re-review of a changed branch is shown the deviations still standing on that branch's cycle result.
- A branch delivered out of the collision dispatch does not carry a `deviationAssessments` entry formed before the rename it just received.
- A re-review that raises the deviation's staleness as an issue holds the branch rather than delivering it, with a detail that says what to do next.
- The brief this path renders and the gate this path applies agree: either an unassessed standing deviation holds the branch, or the brief does not claim it does.
- A branch with no standing deviations, and a wave with no collisions, behave exactly as before.
- The `review-cycle-core` section is untouched and both copies remain byte-identical.

## Validation

- Drive the collision dispatch with a stubbed resolver packet and a stubbed re-review verdict: a branch with a standing deviation whose re-review supplies a fresh assessment delivers with that assessment; one whose re-review raises the deviation as an issue is held; one whose re-review leaves it unassessed behaves as the chosen shape says, and the brief it was rendered says the same thing.
- Break each new gate deliberately and confirm the harness fails before believing it.
- `wf-check` on the changed workflow, and the `awk`/`diff` byte-identity check on the section.

## Review plan

Reviewer confirms the post-rename tree is judged by something that was actually shown the deviations, that no pre-rename verdict reaches `prPrompt`, that every degraded path holds rather than delivers, and — the finding underneath this one — that the brief rendered on this path makes no promise the code does not keep.
