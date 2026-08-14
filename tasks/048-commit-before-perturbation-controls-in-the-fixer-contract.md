# 048 — Order the implementation committed before any perturbation control in the fixer contract

## Why this task exists

A fixer or implementer told to negative-control its own work — gut a check, perturb a predicate, confirm the named failure, restore — routinely restores with `git restore <path>`, and that command is only safe against committed state.
In the 2026-08-13 batch, three separate subagents (on tasks 027c, 016a, and 039a) ran a perturbation control before committing their implementation, restored the file, and wiped their own uncommitted fix; each had to re-apply the work from context or a scratch backup, and one of the three re-applied a ~180-line change by hand.
The orchestrator stopped further incidents mid-batch by adding one sentence to every subsequent brief, which is session memory, not coverage: the next orchestrator composes fixer briefs from the `review-cycle` skill's Fixer contract, and that contract does not carry the rule.

## Scope

Included:

- State the rule once in the `review-cycle` Fixer role's prompt contract, beside its existing commit/validation instructions: the implementation is committed before any perturbation-style control runs, and `git restore` is never pointed at a file carrying uncommitted implementation edits.
- Keep it one instruction, not a narrative of the incidents; the why above belongs to this task file, not the skill.

Out of scope:

- The consumer skills (`address-tasks`, `address-tasks-serialized`, `address-review`, `address-reviews`, `write-tasks`, `resolve-open-questions`), which bind the Fixer contract whole by reference and inherit the sentence without edits.
- The workflow briefs (`plugins/dev-skills/workflows/*.js`), none of which currently restates perturbation or negative-control instructions — verified by grep at drafting time; re-verify rather than trust, and if one has since gained such a restatement, it needs the same sentence and its suite pin moves with it.
- The destroy boundary's `git reset --hard`/`git clean` prohibitions, which are a different rule (protecting others' state, not the fixer's own) and already stated.

## Context and references

- `plugins/dev-skills/skills/review-cycle/SKILL.md` and `codex/dev-skills/skills/review-cycle/SKILL.md` — the Fixer bullet under "Roles", whose clause "commit/validation instructions" is the anchor; both mirrors are hand-edited in lockstep, and there is no generator.
- Task 039a's delivery (PR #93, this branch) — one of the three incidents happened in that task's own round-2 fix pass, which is why this task file rides this branch.
- The repo memory note `commit-before-perturbation-controls` records the incident details; this task exists so the rule outlives that memory.

## Target files or areas

- `plugins/dev-skills/skills/review-cycle/SKILL.md`
- `codex/dev-skills/skills/review-cycle/SKILL.md`

## Implementation notes

- Place the sentence inside the Fixer bullet where the commit/validation instructions are named, so every brief composed from the contract carries it — a wording of the shape: any perturbation-style control (gutting a check, perturbing a predicate for a negative control) runs only after the implementation is committed, and `git restore` never targets a file holding uncommitted implementation edits.
- Edit both mirrors identically; measure the mirror divergence before and after (diff line count or hash of the diff hunks) and confirm it is unchanged.
- `scripts/test-skill-worktree-base-exclude.mjs` and the other suites do not read this bullet today; add no pin unless one already covers the Fixer bullet's wording, in which case extend it deliberately.

## Acceptance criteria

- The Fixer contract in both mirrors orders commit-before-perturbation and forbids `git restore` on uncommitted implementation edits, in one instruction beside the existing commit/validation clause.
- The consumer skills are untouched, and no workflow brief needed the sentence (or, where one has since gained a negative-control restatement, it carries the same rule and its suite coverage moved deliberately).
- The mirror divergence for `review-cycle/SKILL.md` is unchanged by the edit.
- Every suite named in `.github/workflows/tests.yml` passes.

## Validation

- Render nothing; this is skill prose. Diff both mirrors against their pre-edit state and read the sentence in place.
- Run the full suite list in `.github/workflows/tests.yml` to confirm no pinned wording elsewhere was disturbed.

## Review plan

Reviewer confirms the sentence lands inside the Fixer prompt contract rather than in commentary, that both mirrors carry it byte-identically, that no consumer skill or workflow was edited without the out-of-scope re-verification finding a restatement, and that the instruction stays at task 044's bar — the rule, not the incident story.
