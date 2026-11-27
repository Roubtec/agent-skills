# 064 — Write down the convergence judgement, and stop the workflows spending rounds an orchestrator would not

## Why this task exists

An orchestrator running the review cycle by hand converges well.
It acts on nits, asks for another review only while one brings real value, and once a round's findings have all become immaterial it has the last ones fixed and moves on.
That judgement is practised more than it is written: the skill states it only as a grant an invoker may pass (the trivial-round close-out), and the roles and the workflows do not read it at all.

The workflows are where the gap costs something, because a script cannot fall back on judgement:

- A cycle that reaches its cap right after a passing round returns `review-cap`, although a fresh Reviewer passed a tree. The pass is discarded with the cap.
- The batch workflows never grant the close-out the cycle already implements, so a round whose only findings are wording buys a full reviewer-plus-peer round.
- `wf-address-review.js` calls the nested cycle by its bare name, while the plugin registers its workflows under the plugin's namespace. Whether the bare name resolves has not been re-tested on a current runtime.
- A fixer can add or rename files its brief never named, and nothing in the cycle's result says so.

**What this task deliberately does not do: narrow the gate by round number.**
The maintainer considered that and declined it. Long cycles have not been a recent problem, every piece of feedback is still considered however weak, and review continues while reviewers bring material findings. This task carries the existing judgement to where it is read; it adds no rule that counts rounds.

## Scope

Included:

- **The judgement, stated briefly where the round decision is made** in `review-cycle/SKILL.md`: nits are acted on; a further round is requested only while it brings real value; when a round's findings are all immaterial, the last ones are fixed where applicable and the cycle concludes; a final wording, grammar or similarly small fix does not buy another review round.
- **The same for a review on the pull request**: a push whose only content is fixes of that kind summons no fresh review round. `address-review`'s ping rules decide who is pinged, so that is where it goes.
- **What the roles need in order to serve that judgement**, in `reviewer-brief.md` and, only if it lacks it, `peer-brief.md`: the orchestrator can tell from a report which findings are material and which are wording-level without re-deriving it.
- **The workflow renders of those briefs**, which are constants in the workflow sources and do not read the brief files.
- **A passed tree survives the cap.** At the cap, a cycle whose last round passed returns that pass, with whatever was not disposed or not reviewed recorded as such.
- **The batch workflows grant the existing close-out**, and the publish brief of `wf-address-review.js` renders the record of one.
- **The nested cycle is called by a name that resolves**, after a test of the current runtime that says whether today's call works.
- **The cycle result lists paths the fixer added or renamed beyond its brief.**

Out of scope:

- What gates a round: both peer severities still gate, a decline is still the next Reviewer's to accept, and the cap keeps its value.
- A lower default cap for prose, and any new deferral disposition.
- `light`, which stays the invoker's explicit choice.

## Context and references

- `plugins/dev-skills/skills/review-cycle/SKILL.md` → "Disposing findings — how the cycle ends" (the close-out and its diff check) and "The loop and its gates".
- `plugins/dev-skills/workflows/wf-review-cycle.js`: `runReviewCycle` holds two `review-cap` returns; the one this task changes is reached after a passing round, when the final confirmation pass produced work no round can still review. The `closeOut` configuration, `cycleCloseOutPrompt` and the `closeOut` result record are the existing mechanism.
- `wf-address-review.js`: the two `workflow("wf-review-cycle", …)` calls, and the comment beginning "The nested cycle is granted no close-out above", which names what the publish brief still has to learn. `wf-address-tasks.js`: `taskCycleConfig`.
- `plugins/dev-skills/workflows/README.md` states the namespaced invocation names; `scripts/test-address-review-reconcile.mjs` pins the name the nested call uses.
- `address-review/SKILL.md` → the `ping-contributing` row of the arguments table and the ping step of step 7.
- `scripts/test-review-cycle-retirement.mjs` asserts the embedded cycle section is byte-identical in `wf-review-cycle.js` and `wf-address-tasks.js`; `scripts/test-unreviewed-close-carriage.mjs` covers how a close-out record travels.

## Target files or areas

`plugins/dev-skills/skills/review-cycle/` and `address-review/` with their Codex mirrors, the three files under `plugins/dev-skills/workflows/`, the suites above, `README.md` and `workflows/README.md` where they describe the changed behaviour.

## Implementation notes

- **Test the nested call first, on its own.** If the bare name does not resolve on the current runtime, `wf-address-review` fails at its first nested call, and that fix ships at once in a pull request of its own, ahead of the rest of this task. If it resolves, say so in the pull request and qualify the name only if the runtime documents the qualified form as the supported one.
- **Keep the prose short.** The skills are being cut down, not grown: a few sentences at the round decision, one in the Reviewer's brief, one beside the ping rules. If the close-out paragraph already says part of it, tighten that paragraph instead of adding a second statement of the same rule.
- The close-out is today "bounded invoker/orchestrator discretion". The judgement above makes using it the ordinary course for an orchestrator, so word it that way, and keep its diff check exactly as strict: the licence is still judged on the diff, and a semantic change still buys the normal round.
- **At the cap, prefer not starting work that cannot be reviewed.** The simplest shape may be to treat a pass on the last permitted round as `light` does: conclude there, and record the undisposed remarks. Whatever you choose, no exit may report as passed a tree that no round passed, and the result has to say which commit the Reviewer passed.
- A failed round at the cap still returns `review-cap`; that exit does not change.
- For the added-paths field, the fixer's brief is the reference: a path the work item names, or that a finding it was handed names, is expected; anything else added or renamed is listed. It is a report for the orchestrator and the maintainer, never a gate.
- The embedded cycle section must stay byte-identical in both workflows. The pull request for task 055 and task 061 edit the same section; rebase over whichever lands first.
- Task 056 moves the later-round rules of `review-cycle/SKILL.md` behind stubs. Put the judgement where the round decision lives when you start, and rebase over 056 if it lands first.

## Acceptance criteria

- `review-cycle/SKILL.md` states the judgement once, and no text introduces a gate keyed on a round number.
- A Reviewer's report lets the orchestrator separate material findings from wording-level ones, on the skill and the workflow surface.
- A workflow cycle whose last permitted round passed returns a pass that names the reviewed commit, with unreviewed or undisposed content recorded.
- A batch workflow run whose remaining findings are exclusively non-semantic concludes through the close-out, and the published summary shows what shipped unreviewed.
- The nested cycle starts on the current runtime, shown by a run and not by reading the source.
- A fixer pass that adds a file its brief did not name leaves that path in the cycle result.
- The full test set passes, with the embedded section still byte-identical.

## Validation

- Run every suite `tests.yml` runs and `wf-check` on all three workflows.
- Run `wf-address-review` far enough to reach its first nested call and report what happened.
- Drive the cap exit, the close-out grant and the added-paths field through the suites' stubs, and mutation-test each new branch after committing.

## Review plan

Confirm no sentence added here narrows what is reviewed or when, then follow the cap exit and the close-out grant through the workflow for a way an unreviewed semantic change could be reported as passed.
