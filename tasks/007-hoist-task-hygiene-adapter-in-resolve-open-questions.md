# 007 - Hoist Task-File Hygiene Out of resolve-open-questions' Review Layer

## Why this task exists

Issue [#2](https://github.com/Roubtec/agent-skills/issues/2) asked for a full restructure of `resolve-open-questions` into a generic core plus parallel item-source adapters (review-run deferrals, task files, ad-hoc decision lists).
The maintainer scoped that down (2026-07-10): the skill already has the core/layer shape — a domain-neutral core loop (steps 1–5) plus a review-addressing layer — and an ad-hoc adapter would be nearly empty because the generic core *is* the ad-hoc handling.
The one genuinely misplaced piece is the task-hygiene machinery ("Deferred items → task hygiene": reuse task numbers / no orphans, lock the chosen option, keep-standalone vs bind-to-prerequisite, archive to `tasks/done/`), which lives inside the review layer but applies to **any** task-file-sourced decision regardless of whether a review run produced it.
This task hoists exactly that piece into its own source-agnostic section and nothing more.
The PR should close issue #2 (`Closes #2`) and record the full parallel-adapters restructure as **considered & declined** (reason above).

## Scope

- Move the task-hygiene content into its own small adapter/section that applies whenever decisions live in task files under the `tasks/` convention; have the review layer reference it instead of owning it.
- Keep it one skill with a layered body (the issue is explicit: no split into two skills), and keep the frontmatter `description` byte-for-byte stable so trigger matching is untouched.
- Mirror the edit across both flavors (`plugins/` and `codex/` trees).
- Out of scope: the full parallel-adapters restructure; a new ad-hoc-list adapter; any change to the core loop, recommendation heuristics, review-specific apply mechanics (worktree/publish/ping), or the frontmatter.

## Context and references

- `plugins/dev-skills/skills/resolve-open-questions/SKILL.md` — the layered-structure blockquote ("Generic core, review-aware layer", ~line 32), the review layer ("When the items come from a review-addressing pass", ~line 177), the subsection to hoist ("**Deferred items → task hygiene** (no code, but leave nothing dangling)", ~lines 247–260), and the checklist bullet that restates it (~lines 323–325).
- `codex/dev-skills/skills/resolve-open-questions/SKILL.md` — same sections, offset by ~10 lines; the two flavors' texts are intentionally near-identical here.
- Issue: https://github.com/Roubtec/agent-skills/issues/2

## Target files or areas

- The two SKILL.md files above; nothing else.

## Implementation notes

1. Create a new section — e.g. "When decisions live in task files (the `tasks/` convention)" — placed between the core loop and the review layer (or immediately after the review layer; pick whichever reads better and use the same placement in both flavors). It owns the four hygiene rules: reuse task numbers / no orphans, lock the chosen option (demote rejected ones to "considered & declined"), keep-standalone vs bind-to-prerequisite as the maintainer's risk call, archive implemented tasks to `tasks/done/` with the implementing commit noted.
2. Phrase the hoisted section source-agnostically (a decision that refines a task file needs this hygiene whether it came from a review deferral, a `write-tasks` batch, or a pointed run over `tasks/`).
3. Shrink the review layer's "Deferred items" subsection to a pointer at the new section plus whatever is genuinely review-specific (e.g. "the resolved thread already points at the file").
4. Update the layered-structure blockquote to mention the task-file section alongside the review layer, and adjust the checklist bullet so it references the hoisted section without duplicating its content.
5. Frontmatter stays untouched in both files — verify with `git diff` that no hunk touches lines 1–14.
6. Mirror the edit so the two flavors' new/changed sections stay textually parallel (their existing deliberate divergences elsewhere are not in scope).
7. One line per paragraph is the repo's convention for *new* Markdown; this file is pre-wrapped throughout, so match its existing wrapped style instead of reflowing.

## Acceptance criteria

- The task-hygiene rules appear exactly once per file, in a source-agnostic section; the review layer references that section without restating the rules.
- Every clause of the old subsection survives — either in the hoisted section or explicitly kept in the review layer as review-specific; nothing is silently dropped.
- Frontmatter (name + description) is unchanged in both files; the skill remains one skill.
- Both flavors carry the mirrored edit with the same section title and placement.
- The PR closes issue #2 and its description records the full restructure as considered & declined, with the maintainer's rationale.

## Validation

- No build applies — proofread the restructured files end to end.
- `git diff` shows no frontmatter changes and no edits outside the two SKILL.md files.
- Diff the hoisted section between the two flavors: textually parallel.
- Grep each file for a hygiene keyword (e.g. `tasks/done/`) and confirm the rules are stated once and referenced (not duplicated) from the review layer and checklist.

## Review plan

Reviewer reads the old subsection against the new layout in both flavors and confirms clause-for-clause survival, checks the frontmatter hunks are absent, and verifies the blockquote/checklist now describe the actual structure.
