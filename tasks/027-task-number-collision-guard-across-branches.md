# 027 — Guard task-file numbering against same-number collisions across in-flight branches

## Why this task exists

Task numbers are allocated by scanning the working tree for the next free number, but concurrent branches each scan their **own** tree.
In Scribz, PR #78 created `tasks/024-bound-the-unconfirmed-entitlement-retry-rate.md` while PR #83 already carried `tasks/024-bound-sqlcmd-execution-time-in-the-integration-rig.md`; the filenames differ, so Git reports no conflict and both would have merged, silently corrupting the numbering convention.
It was caught only by an explicit manual cross-branch check.
The `address-tasks` pre-PR collision guard already deconflicts **add/add clashes on identical paths**; the same-number-different-name case is invisible to it.

## Scope

Included:

- **`address-tasks` (and serialized variant) pre-PR guard extension:** before opening a PR that adds task files, check the new files' `NNN` prefixes against task files present on the base branch AND on every open PR head in the repo (e.g. `gh pr list --json headRefName` + `git ls-tree <head> tasks/`); a same-number-different-name hit is handled like the existing add/add clash (renumber one side + re-review, or hold with an imperative name).
- **`write-tasks` numbering guidance:** when allocating numbers, scan not just the working tree but also open PR heads for `tasks/NNN-*` prefixes; on collision risk (or when the repo has multiple task-bearing PRs in flight), prefer the next number clear of all of them and say so in the task-writing commit message.
- **`review-tasks` sweep addition:** during task cleanup cycles, flag duplicate `NNN` prefixes in `tasks/` (including `done/`, where a renumber-on-archive would break references — report, don't rename there).

Out of scope:

- A manifest-based allocator (repo-level choice; only worth proposing if the guard proves insufficient).
- Renumbering existing duplicates in any consumer repo.

## Context and references

- `plugins/dev-skills/skills/address-tasks/SKILL.md` — the existing pre-PR collision guard (add/add deconfliction) whose mechanism and vocabulary this extends.
- `plugins/dev-skills/skills/write-tasks/SKILL.md` — "File naming and ordering" section.
- `plugins/dev-skills/skills/review-tasks/SKILL.md` — the audit sweep.
- `tasks/AGENTS.md` in this repo — the odd/even numbering house style the guard protects (consumer repos carry equivalents).

## Target files or areas

- `address-tasks/SKILL.md`, `address-tasks-serialized/SKILL.md`, `write-tasks/SKILL.md`, `review-tasks/SKILL.md`, codex mirrors.

## Implementation notes

- The check is prefix-based (`tasks/NNN-` and `tasks/NNNx-` with the letter suffix): two files sharing a numeric prefix (same suffix or one suffixed/one not is fine per house style — `001` and `001a` coexist by design) collide only when the FULL number+suffix matches with different slugs. State the matching rule precisely so the guard doesn't false-positive on legitimate `001`/`001a` families.
- Keep it cheap: one `gh pr list` + one `git ls-tree` per open head at guard time; degrade gracefully (note-and-proceed) when the remote is unavailable, since local-only runs can't see PR heads.
- Write the guard parallelism-ready for [033](033-vertical-task-pipelining.md): in a pipelined run the comparison set is open PR heads PLUS branches delivered earlier in the same run, first claimant wins, and the second claimant renumbers (never the delivered side).

## Acceptance criteria

- The batch skills' guard section names the same-number-different-name case and its deconfliction procedure.
- `write-tasks` instructs checking open PR heads before allocating.
- `review-tasks` flags duplicate prefixes with the done/-folder exception.
- The matching rule distinguishes suffix families from true collisions.

## Validation

- Walk the Scribz `024` scenario against the new text: both the writing skill (allocation) and the batch skill (pre-PR guard) now catch it at different stages.

## Review plan

Reviewer verifies the matching rule against the house numbering convention (odd primaries, even inserts, letter suffixes) and that remote-unavailable degradation is note-and-proceed, not silent skip.
