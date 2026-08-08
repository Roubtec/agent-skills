# 037 — State the intent of stacked PR bases and assert them after creation

## Why this task exists

A dependent task's PR opened against `main` instead of its parent branch shows the whole stack's diff as its own. Reviewers then comment on the parent's code in the child's PR, and review-addressing runs land fixes for those comments on the wrong branch — misdirected review is expensive precisely because everything downstream of it inherits the misdirection. The batch skills already *determine* the base correctly (dependent task → the dependency's branch; the workflow's plan stage derives `base` per task and `gh pr create --base` receives it), but nothing verifies the created PR actually carries the recorded base, and the rule's rationale is unstated, so it reads as bookkeeping rather than as the thing that keeps review honest.

## Scope

Included:

- **State the intent once, where the base rules live:** a PR's base must be the ref its branch actually builds on, so the PR shows the honest diff of that branch's own contribution to the stack — this is what routes review comments to the right PR. One or two sentences; the existing determination rules stay as they are.
- **Post-create assertion:** immediately after `gh pr create`, capture the PR URL it returned and read *that* PR back explicitly (`gh pr view <pr-url> --json baseRefName`), requiring the result to equal the recorded base. When a creation attempt fails before printing a URL, the PR may still exist server-side: before retrying creation, look it up by the recorded head branch in the head repository (`gh pr list --head <branch>`) and assert against the URL the lookup returns; only a lookup that finds nothing licenses the retry, and a delivery ending with neither a captured URL nor a lookup match fails distinctly rather than reporting success. Address the repair the same way (`gh pr edit <pr-url> --base <recorded-base>`) and note it; if the repair fails, report the PR as delivered-with-wrong-base rather than silently succeeding. The explicit target is load-bearing, not ceremony: the parallel `address-tasks` Delivery creates the PR with `--head <branch-name>` from the main checkout (its neighbouring steps reach into the task's worktree with `git -C`, they do not `cd` there), so an argument-less `gh pr view`/`gh pr edit` would resolve the main checkout's PR — or none at all — and assert against, and repair, the wrong PR. The other two delivery points stand on the task branch as they are written today; naming the returned PR explicitly is not repairing a live bug there, it is removing the assertion's dependence on that incidental coupling so a later edit to where creation runs cannot silently redirect the check.
- Apply the assertion at every delivery point: the Delivery section of `address-tasks`, the per-task loop's PR step in `address-tasks-serialized`, and the PR-creation stage prompt in `wf-address-tasks.js` (the agent asserts the base before it may return `opened: true`).
- **Record the practice where the repo documents PR practice:** how we open and merge PRs lives in `README.md`'s Contributing section, so the honest-diff base rule and the assert-then-repair policy get a sentence or two there as well — the practice stated once for humans and agents alike, with the skills carrying the mechanics.

Out of scope:

- The base *determination* precedence itself (explicit override → dependency's branch → current branch) — already defined; do not restate it.
- Retargeting PRs after a parent merges (GitHub's auto-retarget and the `rebase-stack` skill own that), and any change to the local review-stack construction.

## Context and references

- `plugins/dev-skills/skills/address-tasks/SKILL.md` — Scheduling ("Base branch per task") and Delivery; the Delivery step already pushes a local-only base before `gh pr create`.
- `plugins/dev-skills/skills/address-tasks-serialized/SKILL.md` — "Determining the PR base" and the per-task loop's PR step.
- `plugins/dev-skills/workflows/wf-address-tasks.js` — the plan-stage `base` derivation and the PR-stage prompt that runs `gh pr create --base` and reports `opened`/`pushed`.

## Target files or areas

- `plugins/dev-skills/skills/{address-tasks,address-tasks-serialized}/SKILL.md`, `plugins/dev-skills/workflows/wf-address-tasks.js`, the codex-side mirrors of the two skills, and `README.md`'s Contributing section.

## Implementation notes

- This is a tightening, not a redesign: a sentence or two of assertion mechanics per delivery point plus the workflow prompt's assertion — the honest-diff rationale itself is not repeated there. Keep the repair path (`gh pr edit <pr-url> --base`) in the same breath as the check so an agent never stops a batch over a repairable mismatch.
- The likeliest real mismatch sources are a retried creation after a partial failure and an omitted `--base` falling back to the default branch; the assertion catches both without needing to enumerate causes.
- The stacked-PR body note ("which branch it stacks on") already exists in `address-tasks` Delivery; leave it, the assertion complements it.

## Acceptance criteria

- Each of the three delivery points performs the post-create base assertion with the repair-then-report escalation, addressing the PR that `gh pr create` returned explicitly rather than relying on the current branch to select it, and recovering the PR by the recorded-head lookup when creation fails before printing a URL (failing distinctly when the lookup finds nothing). The honest-diff rationale is authored only where the base rules live and in README's Contributing section — delivery points carry the assertion mechanics, not a restated rationale.
- `README.md`'s Contributing section states the honest-diff base rule and the assert-then-repair policy, so the repository's own PR practice does not go out of sync with the skills.
- The `wf-address-tasks.js` PR-stage prompt cannot report `opened: true` without having verified (or repaired) the base, and its structured result reflects a delivered-with-wrong-base outcome distinctly when repair failed.
- No change to base determination, retargeting behavior, or the review-stack construction; codex mirrors match.

## Validation

- `wf-check` passes on `wf-address-tasks.js`; read-through of each delivery point (the `address-tasks` Delivery section, the serialized per-task loop's PR step) confirms the assertion sits immediately after creation — and, where a worktree is in play, before it is reclaimed.

## Review plan

Reviewer checks the assertion uses the recorded per-task base (not a re-derived one), that the repair path cannot mask a genuinely wrong determination (the note must surface what was repaired), and that nothing restates the determination precedence in a second place.
