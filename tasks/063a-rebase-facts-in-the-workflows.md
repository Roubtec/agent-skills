# 063a — The workflows take the rebase facts and carry a verdict where the skills now do

## Why this task exists

Task 063 gave the delegated rebase step a read-only helper, `rebase-facts.sh`, and rewrote the skills around its answers: a point proved a no-op spawns no rebaser, a stacked child whose recorded parent tip is not its ancestor is never handed to `--onto`, and a replay proved patch-identical over a base that touched none of the branch's files carries the verdict it already had.
Task 063 allowed its workflow half to be queued under its own number where it proved larger than the helper and the skill text together, and it did: the two workflows render the rebase step inline, each with its own report schema, adoption checks and driven suite, and one of them owns a whole re-verification cycle that the carry-over exists to skip.

So the workflows still spawn a rebaser for every point and re-verify every replay.
That is the conservative side of the difference, and nothing they do is wrong; it is the cost task 063 set out to remove, still being paid wherever a run goes through a workflow instead of a skill.

## Scope

Included:

- **`wf-address-review.js` asks before each of its two points.** A gathering agent pins the target and runs `review-cycle-rebase-facts before`; `outcome=noop` records the point as skipped on that proof with its effective base, and spawns no rebaser.
- **The pre-push re-verification is skipped on a carry.** After a pre-push replay, `review-cycle-rebase-facts after` answering `outcome=carry` lets the verdict that already passed stand for the replayed tip, with no post-rebase validation and no second cycle; any other answer re-verifies exactly as today.
- **`wf-address-tasks.js` takes the same answers** for the rebase onto a base a merged sibling advanced: no rebaser on a proved no-op, and no re-review on a carry.
- **The rebaser's prompt takes its facts from the helper's output**, marked verified this turn, in both workflows.
- **A carried verdict is visible in the result**: the tip the verdict was rendered on, the tip it was carried to, and the answer it was carried on, in the workflow's structured result and in the summary comment a push run writes.
- **Judgement stays in the loop.** The `onto-path=` lines reach an agent that can refuse the carry for a base-side change reaching beyond its own files; the script never carries on the helper's answer alone where no agent read them.
- **Driven checks** for each new branch, added to the suites that already drive these stages.

Out of scope:

- The helper and the skill text, which task 063 delivered.
- Stacked `--onto` restacks inside a workflow: neither workflow hands a rebaser a parent tip today, and `rebase-stack` owns whole chains.
- Whether rebasing is the default, and the points it runs at.

## Context and references

- `plugins/dev-skills/skills/review-cycle/rebase-facts.sh`, whose header is the contract, and `delegating-a-rebase.md` beside it, which says what a caller does with each answer.
- `plugins/dev-skills/bin/review-cycle-rebase-facts`, the name a workflow agent reaches the helper by.
- `wf-address-review.js` → `rebasePrompt`, `REBASE_SCHEMA`, `rebasePoint`, and the pre-push block that calls `rebaseReverifyInstructions` and `rebaseReverifyCriteria`; the no-op adoption under the `rebase-unevidenced-noop` stop is the existing model for adopting a claim on its evidence.
- `wf-address-tasks.js` → `taskRebasePrompt`, `TASK_REBASE_SCHEMA` and `rebaseOntoAdvancedBase`.
- `scripts/test-address-review-reconcile.mjs` and `scripts/test-pipelined-batch.mjs`, which drive those stages and carry absolute check-count literals.
- `plugins/dev-skills/workflows/README.md`, which describes both workflows' rebase behavior.

## Target files or areas

`plugins/dev-skills/workflows/wf-address-review.js`, `wf-address-tasks.js` and `README.md`, the two suites named above, and `README.md` at the root where it describes what those suites cover.

## Implementation notes

- A workflow script runs no git itself, so each answer arrives through an agent. Have that agent return the helper's stdout verbatim and parse it in the script, the way `parseOverlapOutput` reads `overlap.sh`, instead of trusting a restated field.
- A missing or unparseable answer decides nothing: the point is delegated and the replay is re-verified, exactly as today.
- Both halves of the carry are one answer, `outcome=carry`. Do not rebuild it in the script from `identical=` and `paths=`.
- `publishPrompt` already distinguishes the cycle before a pre-push rebase from the one after it; a carried verdict is a third case, with one cycle behind it and two tips.
- Repair the suites' check-count literals by delta arithmetic and verify by check names.

## Acceptance criteria

- A workflow run whose base has not moved spawns no rebaser at either point, and its result says each point was skipped on the helper's proof.
- A pre-push replay the helper answers `carry` for publishes on the verdict already passed, runs no second cycle, and says so in the result and the summary.
- A replay the helper answers `verify` for, or gives no answer for, is re-verified exactly as before this task.
- The same three hold for `wf-address-tasks.js`'s rebase onto an advanced base.
- The full test set passes, and `wf-check` passes on each workflow.

## Validation

- Run every suite `tests.yml` runs and `wf-check` on each `plugins/dev-skills/workflows/*.js`.
- Break each new driven check deliberately after committing and watch it fail.

## Review plan

Look for a path where the script carries a verdict without the helper's `outcome=carry`, or skips a point without its `outcome=noop`, then check that an agent failure anywhere on those paths falls back to today's behavior.
