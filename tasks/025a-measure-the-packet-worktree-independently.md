# 025a — Measure the packet's worktree independently instead of trusting the fixer's `clean` flag

## Why this task exists

Task 025's item 3 binds the ORCHESTRATOR: "the orchestrator verifies the worktree is both clean AND idle: `git -C <worktree> status --porcelain` is empty ... and no Git operation is in progress. Check the operation-state paths explicitly ... Failing either condition means redrive or resume, never silent adoption."

The workflow rendering delivered in PR #55 cannot run shell commands, so it implemented that as a self-report: the fixer's brief instructs the check, the packet schema's `clean` property defines exactly what the boolean must mean, and `runReviewCycle` refuses any packet whose `clean` is false. What it does not do is measure. The precise failure the guard exists to contain — a pass that returns `clean: true` while a rebase or cherry-pick is still in progress, which prints empty porcelain and would hand the next round a worktree nobody can safely build on — passes the guard, because nothing but the fixer ever looked at the worktree.

Raised by the codex peer as P1 on PR #55: <https://github.com/Roubtec/agent-skills/pull/55#discussion_r3740189045>. Deferred there rather than fixed because every remedy costs an agent turn per fixer pass or changes where a role's responsibilities sit, and that price is exactly what task 035 is deciding; see "Sequencing" below.

## Scope

Give the two shipped copies of `review-cycle-core` an independent measurement of the returned worktree's state, and make the redrive/resume response fire on the measurement rather than on the packet's own word.

Choose between (at least) these shapes and state why in the delivery:

1. **A dedicated checker turn after each fixer pass.** Most faithful to 025's wording, and the only shape that also covers the FINAL confirmation pass, which terminates the cycle without a reviewer round. Costs one extra agent turn per fixer pass — up to thirteen in a capped cycle.
2. **Fold the measurement into the reviewer's round.** Costs nothing extra: the reviewer already enters the same worktree at the same commit and already runs the build. It would report the porcelain and operation-state readings structurally, and an unclean or mid-operation tree would gate the round exactly as an unassessed deviation now does. Its gap is the confirmation pass, which no reviewer sees — close it with a single checker turn on that one pass, which is one turn per cycle rather than shape 1's one per fixer pass; the acceptance criteria below do not accept documenting the gap instead of closing it.
3. **Ask the peer stage for the reading.** Rejected on its face unless argued: the peer is best-effort and non-blocking by contract, so a gate resting on it is a gate that vanishes when the peer is unavailable.

Whichever shape wins, the measurement must be a reading rather than a repair: no stage may stage, commit, reset, stash, or abort anything to make the tree clean. That is the same posture `mainCheckoutStatusPrompt` already takes in `wf-address-tasks.js`, and its schema and prompt are the model to copy — including its `measured: false` degradation, so a reading that cannot be taken is reported as unknown rather than silently passing as clean.

## Context and references

- The self-report the task replaces: `CYCLE_FIX_SCHEMA`'s `clean` property (`plugins/dev-skills/workflows/wf-review-cycle.js:264`, mirrored at `wf-address-tasks.js:656`) and the packet hard-check in `runReviewCycle` (`wf-review-cycle.js:1015`, mirrored at `wf-address-tasks.js:1407`). Line numbers are as of PR #55's head; the anchors are the `clean` schema property and the `if (!fix.clean)` guard.
- The instruction the fixer receives is the last bullet of `cycleFixPrompt`'s Rules block ("Before returning, the worktree MUST be clean AND idle...") — it stays either way; this task adds the check that does not depend on it being followed.
- The skill flavor needs no change: `plugins/dev-skills/skills/review-cycle/SKILL.md`'s "Packet hard-check" bullet already tells a skill-driven orchestrator to run the commands itself, and a skill orchestrator has a shell. Only the workflow rendering is short of it. Keep the two mirrors in step if the bullet is touched at all.
- The non-destructive reading to model: `mainCheckoutStatusPrompt` and `MAIN_CHECKOUT_STATUS_SCHEMA` in `plugins/dev-skills/workflows/wf-address-tasks.js`.
- `plugins/dev-skills/workflows/README.md` — Validation section; both workflows are parse-checked and the `review-cycle-core` section must stay byte-identical between the two files.

## Sequencing

Implement AFTER task 035 (proportionate effort in the review cycle). 035 is deciding what each round is allowed to cost, and shape 1 above adds an unconditional agent turn per fixer pass while shape 2 adds none — a cost question 035 answers rather than this task. Land 035 first, then pick the shape its tiering makes affordable.

## Target files or areas

- `plugins/dev-skills/workflows/wf-review-cycle.js` (canonical `review-cycle-core` section) and the byte-identical embedded copy in `plugins/dev-skills/workflows/wf-address-tasks.js`.
- `scripts/test-review-cycle-retirement.mjs` (or a sibling suite) for the behavior coverage below; `scripts/test-subagent-destroy-boundary.mjs` if a new prompt builder is added, which needs a rendered fixture.

## Acceptance criteria

- A fixer packet reporting `clean: true` from a worktree whose measured state is dirty, or which is mid-rebase/mid-cherry-pick/mid-merge/mid-revert/mid-bisect, does not reach the next round: the cycle redrives or resumes that pass and says which condition failed.
- The measurement is taken by something other than the pass that produced the packet, and never modifies the worktree.
- A measurement that cannot be taken is reported as unknown and is not treated as clean.
- EVERY fixer packet the cycle adopts is measured, the final confirmation pass included — that one is measured when its packet returns, before either terminal exit branches on it, since no reviewer round follows it. A shape that no reviewer round covers there takes the dedicated checker turn on that pass alone; stating the gap in a comment does not discharge this criterion. Task 025's item 3 binds the orchestrator on every returned packet, and a cycle whose last packet is unmeasured is the hole that item forbids.
- If the chosen shape genuinely cannot measure some pass even with that turn, the cycle does not end as though it had: that pass is reported `measured: false`, the residual gap is named in the code comment and in the result contract, and the result says the cycle finished on an unverified worktree rather than reporting a clean finish.
- Both `review-cycle-core` copies carry the change and remain byte-identical.

## Validation

- A scripted scenario per direction in the retirement suite's style, driven through both workflow legs: a measured-clean packet proceeds; a measured-dirty or mid-operation one does not; an unmeasurable one does not pass as clean. At least one of them puts the failing packet on the FINAL confirmation pass, so the gate is proven on the pass no reviewer round follows.
- Break each new gate deliberately and confirm the suite fails on both legs before believing it.
- `wf-check` (or the README's hand-rolled parse wrapper) on every changed workflow, and the `awk`/`diff` byte-identity check on the section.

## Review plan

Reviewer confirms the measurement is genuinely independent of the packet it judges (not a second question to the same turn), that no stage can repair the tree it is measuring, and that no packet the cycle adopts — the final confirmation pass most of all — reaches a terminal exit unmeasured, with any residual gap reported as unknown rather than left silent.
