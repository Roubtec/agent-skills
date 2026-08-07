# 037 — State the intent of stacked PR bases and assert them after creation

## Why this task exists

A dependent task's PR opened against `main` instead of its parent branch shows the whole stack's diff as its own. Reviewers then comment on the parent's code in the child's PR, and review-addressing runs land fixes for those comments on the wrong branch — misdirected review is expensive precisely because everything downstream of it inherits the misdirection. The batch skills already *determine* the base correctly (dependent task → the dependency's branch; the workflow's plan stage derives `base` per task and `gh pr create --base` receives it), but nothing verifies the created PR actually carries the recorded base, and the rule's rationale is unstated, so it reads as bookkeeping rather than as the thing that keeps review honest.

## Scope

Included:

- **State the intent once, where the base rules live:** a PR's base must be the ref its branch actually builds on, so the PR shows the honest diff of that branch's own contribution to the stack — this is what routes review comments to the right PR. One or two sentences; the existing determination rules stay as they are.
- **Post-create assertion:** immediately after `gh pr create`, read the PR back (`gh pr view --json baseRefName`) and require it to equal the recorded base. On mismatch, repair with `gh pr edit --base <recorded-base>` and note the repair; if the repair fails, report the PR as delivered-with-wrong-base rather than silently succeeding.
- Apply the assertion at every delivery point: the Delivery sections of `address-tasks` and `address-tasks-serialized`, and the PR-creation stage prompt in `wf-address-tasks.js` (the agent asserts the base before it may return `opened: true`).

Out of scope:

- The base *determination* precedence itself (explicit override → dependency's branch → current branch) — already defined; do not restate it.
- Retargeting PRs after a parent merges (GitHub's auto-retarget and the `rebase-stack` skill own that), and any change to the local review-stack construction.

## Context and references

- `plugins/dev-skills/skills/address-tasks/SKILL.md` — Scheduling ("Base branch per task") and Delivery; the Delivery step already pushes a local-only base before `gh pr create`.
- `plugins/dev-skills/skills/address-tasks-serialized/SKILL.md` — "Determining the PR base" and the per-task loop's PR step.
- `plugins/dev-skills/workflows/wf-address-tasks.js` — the plan-stage `base` derivation and the PR-stage prompt that runs `gh pr create --base` and reports `opened`/`pushed`.

## Target files or areas

- `plugins/dev-skills/skills/{address-tasks,address-tasks-serialized}/SKILL.md`, `plugins/dev-skills/workflows/wf-address-tasks.js`, and the codex-side mirrors of the two skills.

## Implementation notes

- This is a tightening, not a redesign: a few sentences per delivery point plus the workflow prompt's assertion. Keep the repair path (`gh pr edit --base`) in the same breath as the check so an agent never stops a batch over a repairable mismatch.
- The likeliest real mismatch sources are a retried creation after a partial failure and an omitted `--base` falling back to the default branch; the assertion catches both without needing to enumerate causes.
- The stacked-PR body note ("which branch it stacks on") already exists in `address-tasks` Delivery; leave it, the assertion complements it.

## Acceptance criteria

- Each of the three delivery points states the honest-diff intent and performs the post-create base assertion with the repair-then-report escalation.
- The `wf-address-tasks.js` PR-stage prompt cannot report `opened: true` without having verified (or repaired) the base, and its structured result reflects a delivered-with-wrong-base outcome distinctly when repair failed.
- No change to base determination, retargeting behavior, or the review-stack construction; codex mirrors match.

## Validation

- `wf-check` passes on `wf-address-tasks.js`; read-through of both skills' delivery sections confirms the assertion sits after creation, before the worktree is reclaimed.

## Review plan

Reviewer checks the assertion uses the recorded per-task base (not a re-derived one), that the repair path cannot mask a genuinely wrong determination (the note must surface what was repaired), and that nothing restates the determination precedence in a second place.
