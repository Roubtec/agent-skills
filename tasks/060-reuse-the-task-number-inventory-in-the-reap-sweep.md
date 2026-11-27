# 060 — Reuse the task-number inventory in the `reap-tasks` duplicate sweep

## Why this task exists

This is one of a series (053–060) that cuts what a skill costs in context by moving deterministic procedure into bundled scripts and rarely-needed rules into files read on demand; README's "Helpers bundled inside a skill" describes the approach and what PRs #129–#149 already moved.

PR #148 gave `write-tasks` a script, `task-numbers.sh`, whose `taken` command inventories every task file in the task folder and in every open PR head.
`reap-tasks` still describes the same inventory in prose for its duplicate sweep: the paragraph in "Reaping process" that begins "As part of every cleanup sweep" tells the agent to walk the folder recursively, parse full task numbers and flag duplicates, and to do it again before committing.
That is the one remaining hand-rolled copy of a scan the repository now has a tested implementation of.

## Scope

Included:

- **The duplicate sweep in `reap-tasks` runs through `task-numbers.sh`**, the script `write-tasks` owns, instead of a hand inventory.
- **If `taken` does not already make duplicates obvious, extend the script**: either a line per full number that stands more than once in the working tree, or a small command of its own; your choice, with tests.
- **`address-review`'s follow-up-task step** numbers a new file with one line ("Number each file to continue the folder's existing sequence"); point it at `write-tasks`' allocation rule and `taken`, so a number standing on an open PR head is not reused.

Out of scope:

- What the sweep does about a duplicate: it reports and never renumbers an archived or deferred task, as today.
- The pre-PR guard (`claims`) and `task-number-guard.md`.
- `resolve-tasks`, whose own recursive inventory resolves pointers and allocates nothing; it stays as it is.

## Context and references

- `plugins/dev-skills/skills/write-tasks/task-numbers.sh` (`--help` prints its contract) and "File naming and ordering" in `write-tasks/SKILL.md`, which explains why the allocator and the guard compare numbers differently.
- `plugins/dev-skills/skills/reap-tasks/SKILL.md`, "Reaping process".
- `scripts/test-write-tasks-task-numbers.sh`.
- `tasks/AGENTS.md` for this repository's numbering convention.

## Target files or areas

`plugins/dev-skills/skills/reap-tasks/SKILL.md` and its mirror, `write-tasks/task-numbers.sh` in both trees if it gains output, `scripts/test-write-tasks-task-numbers.sh`, `address-review/SKILL.md` in both trees, `README.md` where it describes the script.

## Implementation notes

- A duplicate is two files with the same **full** number (`024` twice), not the same three-digit slot (`001` and `001a` coexist); the sweep's rule is the guard's comparison, not the allocator's.
- The sweep concerns the working tree; `taken` also reads open PR heads, which is useful to report but must not turn a clean tree into a failed sweep when a head cannot be read.
- `reap-tasks` names the script on a line naming `write-tasks` as its owner, which `test-skill-bundled-files.mjs` enforces.
- **Landing order for the series.** 053, 055, 057, 059 and 060 can be worked in parallel; 054 follows 053 and 057, 056 follows 055, and 058 follows 056. Tasks that add a script each append to `.github/workflows/tests.yml`, README's "Focused tests" and the one-line paragraph under README's "Helpers bundled inside a skill", so whichever lands second resolves a mechanical conflict there.
- A repository with another numbering style still gets its paths listed with `-` for the number; keep the sentence telling the agent to apply that style's own rule.

## Acceptance criteria

- `reap-tasks` finds a duplicate full number through the script, before and after it writes follow-up tasks, and reports every colliding path.
- Neither `reap-tasks` nor `address-review` inventories task numbers by hand to find duplicates or to allocate one.
- Any new script output is covered by a test that fails when the output is removed.
- The full test set passes.

## Validation

- Run every suite `tests.yml` runs, plus `shellcheck` if the script changed.
- In a disposable clone (`dc-enter`), plant a duplicate across `tasks/` and `tasks/done/` and confirm the sweep's call names both paths; plant `001` beside `001a` and confirm it names neither.

## Review plan

Confirm the rewritten paragraph keeps every rule of the old one (report, never renumber, repeat before committing) and that the script's answer alone is enough to apply them.
