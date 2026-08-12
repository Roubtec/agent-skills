# 023a — Carry the GitHub API reliability recipes into the address-review workflow's own publish brief

## Why this task exists

Task 023 put one authoritative recipe for each of five GitHub/`gh` behaviors at the step that performs the operation, and its acceptance criterion scopes that to "the skill(s) whose step encounters it". The dynamic-workflow form of the same skill was never in scope, and it turns out to perform the same steps from prose of its own.

`plugins/dev-skills/workflows/wf-address-review.js` builds a self-contained publication brief — the template holding the numbered `1. Re-check before publication` / `2. Push` / `6. Pings` steps, reached from the publish-brief builder near the file's `DEPUTY_FINISH_IN_TURN` and `DESTROY_BOUNDARY` interpolations. That brief neither references `address-review/SKILL.md` nor names any file under `skills/`, and it carries neither of the two recipes 023 placed in this skill. What it is missing is item 1 at its step 2, which orders the same normal-push / exact-lease pair and then stops at the push's own result, and item 2 at its step 6, which orders the same `gh pr edit --add-reviewer @copilot` request behind the same gh-version guard and never says how to confirm it. So an agent driven down the workflow path performs exactly the operations those two recipes exist for and is told none of what settles them: it can treat `gh pr view --json headRefOid` as proof of a push, read back only one of a remote's push URLs, and get no instruction at all for confirming the reviewer request it just made.

Item 5 is a different case and must not be swept in with them. The workflow already satisfies it at its own steps 1 and 3 — re-fetching the PR before pushing, re-reading threads after — exactly as the skill does, which is why commit 390156a added no text for item 5 anywhere: restating it would have been a fourth copy. Items 3 and 4 have no workflow step behind them at all.

The gap was found by the fresh reviewer during PR #68's verification rounds, which flagged it as a coverage question rather than a defect of that branch, since no repo convention requires skill→workflow parity and closing it there would have expanded the PR well past its task.

## Scope

Included:

- **Decide whether the workflow path is meant to be reachable without the skill's recipes, and record the answer.** This is the real question and it is prior to any edit. If the workflow is a peer entry point, it needs the recipes; if it is a driver that expects its subagents to have read the skill, then what it needs is a pointer, and the absence of one is the defect. Do not assume the first.
- **Whichever of the five recipes the workflow's own steps actually encounter**, placed at those steps. From reading the publish brief, that is at least item 1 (push verification) at its step 2 and item 2 (reviewer-request verification) at its step 6. Derive the full set by walking the workflow's briefs rather than from this list.
- **The same question for the sibling workflows.** `wf-address-tasks.js` opens PRs and `wf-review-cycle.js` may not touch GitHub at all; enumerate by grepping the `workflows/` tree for the operations themselves (`--add-reviewer`, `headRefOid`, `ls-remote`, `statusCheckRollup`, `pr merge`) rather than trusting this paragraph.

Out of scope: re-opening any recipe's wording, which PR #68 settled across its verification rounds and both mirrors; adding recipes to a workflow step that does not perform the operation; README's Contributing recipes (items 3 and 4), which are maintainer-facing merge guidance with no workflow step behind them; and item 5, which the workflow already satisfies at its steps 1 and 3 and for which 390156a deliberately added no text — writing one here would create exactly the copy that commit declined.

## Constraints this task must respect

Task 044 forbids pushing workflow detail up into a skill and treats a workflow comment that restates its skill as something to delete. This task points the other way — text into a workflow — so it must not become a second authoring point for prose the skill already owns. Prefer a pointer where the reader will follow one; where the recipe must be inline because the brief is handed to a subagent that has read nothing else, keep it to the instruction and its one settling read, per 044's rule that a prompt states what to do rather than why across cases.

Note also that `plugins/dev-skills/workflows/` has no codex mirror, so unlike the `SKILL.md` changes this work has a single copy.

## Context and references

- Task 023 — the parent; its five behaviors and its "one authoritative recipe" criterion.
- PR #68 — where 023 landed and where this gap was found. Its final two commits carry the shipped wording for the push read-back and the reviewer-request confirmation, which is what any inline copy here must not contradict.
- Task 044 — the prose discipline that governs what may be written into a workflow at all.

## Target files or areas

- `plugins/dev-skills/workflows/wf-address-review.js` — the publish-brief template holding the numbered publication steps
- `plugins/dev-skills/workflows/wf-address-tasks.js` and `wf-review-cycle.js` — only where the sweep shows they perform one of the operations

## Acceptance criteria

- The workflow-path question above is answered in the change itself (a pointer or an inline recipe), not left implicit.
- Every workflow step that performs one of the five operations either carries its recipe or points at the skill section that holds it; no workflow step performs one of them silently.
- No recipe is restated in a way that can drift out of step with the `address-review` skill's wording, and no workflow prose is duplicated into a skill.

## Validation

- Grep the `workflows/` tree for `--add-reviewer`, `headRefOid`, `ls-remote`, `statusCheckRollup` and `pr merge`; every hit sits next to its recipe or its pointer.
- `.github/workflows/tests.yml` stays green — in particular `scripts/test-subagent-destroy-boundary.mjs`, which renders these briefs.

## Review plan

Reviewer checks that the workflow path can no longer perform a push or a reviewer request without being told what settles it, and that nothing added here restates the skill in a form that can drift.
