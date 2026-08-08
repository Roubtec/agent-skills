# 041 — Anchor task-file code references to named symbols, not line numbers

## Why this task exists

Line-number citations in durable task files rot on every rebase and every edit above them, and a stale pointer into look-alike code is worse than none. This repo has already paid for the lesson: task 015b exists solely to repair roughly twenty stale line citations in task 015, and its analysis shows why no mechanical offset can fix them. Meanwhile every agent and harness can grep a named symbol in a file or folder and land on its declaration, definition, and call sites with trivial effort — the durable reference is the name, not the coordinate.

## Scope

Included:

- **`write-tasks` guidance:** when citing existing code in a task file, point to named symbols and scopes — function, class, namespace, module, exported constant — within a named file or folder, not to line numbers or line ranges. When one file holds several same-named symbols, disambiguate the way the file's own language does (`v1::parseInput()`, `V1Api.prototype.parseInput`, an enclosing namespace or class path) rather than by position. A line-number citation is permitted only when no stable name exists for the thing being referenced (a data row, a generated-file region, a specific literal), and it must then state its reason and carry an as-of reference-frame stamp in the form tasks 012b and 014a already use.
- **`address-review` follow-up-task phrasing:** step 5 currently tells the writer to "restate the concern with file/line references and link the PR thread". Rephrase: the linked PR thread permanently anchors the exact line under review; the task body itself anchors to named symbols per `write-tasks` so it stays true after the branch moves. Same adjustment anywhere else a skill instructs writing file:line into a *task file*.
- A sentence in `write-tasks` delimiting the rule's reach: it governs durable task files, not ephemeral same-round artifacts.
- **Record the practice where this repo documents task-file practice:** the repository's own task conventions live in `tasks/AGENTS.md` (numbering, number-based cross-referencing — itself a durable-reference rule of the same genre), so the symbol-anchor rule gets a sentence or two there as well. Same split 037 applies to README's Contributing section: the repo file records this repository's practice, while `write-tasks` keeps authoring the rule for consumer repos that do not carry this file.

Out of scope:

- Ephemeral, same-tip references: reviewer findings, the peer verdict's required `file:line` format, open-question `artifacts` pointers, and review replies are read within the round or run that produces them and stay maximally precise — do not weaken those formats.
- Repairing existing stale citations (015b covers the known case; archived tasks are records and stay as written).

## Context and references

- Task 015b — the concrete rot case: two independent staleness causes, offsets that differ per file, anchors that crossed into different files entirely; its "Implementation notes" are the argument for names over coordinates.
- Tasks 012b and 014a — the as-of stamp wording the permitted-exception case must mirror.
- `plugins/dev-skills/skills/write-tasks/SKILL.md` — "Context and references" and "Writing guidance" are the natural homes.
- `plugins/dev-skills/skills/address-review/SKILL.md` — step 5's follow-up-task bullet list.

## Target files or areas

- `plugins/dev-skills/skills/{write-tasks,address-review}/SKILL.md`, their codex-side mirrors, and a grep across the other skills for any further instruction to put file:line into a task file (`reap-tasks` follow-ups inherit `write-tasks` conventions and should need no edit — verify rather than assume).
- `tasks/AGENTS.md` — the repository's own statement of the practice.

## Implementation notes

- Express the intent, not just the ban: the reference's job is to survive the code moving. "Name the symbol in the file; the reader greps" is the whole mechanism.
- Keep it to a handful of sentences per touchpoint; this is a conventions nudge, not a new section.
- The `review-cycle` prose reviewer checks task files against the repo's house conventions, so once `write-tasks` documents this rule, drafted tasks should pick up its enforcement — but the canonical prose brief names only the house conventions and documented numbering style, while it is `write-tasks`' own verbiage cycle that checks against the sections that skill requires, so verify the rule actually reaches the drafted-task review rather than assuming free enforcement (the same verify-rather-than-assume courtesy the reap-tasks grep gets); if it does not, the fix is stating the rule where `write-tasks` briefs its verbiage cycle, not editing the canonical reviewer.

## Acceptance criteria

- `write-tasks` states the symbol-anchor rule, the language-native disambiguation guidance, the narrow line-number exception with its reason-plus-stamp requirement, and the durable-vs-ephemeral boundary.
- `address-review` step 5 no longer instructs bare file/line restatement in the task body; the thread link carries the positional anchor.
- `tasks/AGENTS.md` states the symbol-anchor convention with its narrow exception, so the repository's own task-authoring practice does not go out of sync with `write-tasks`.
- No ephemeral format (reviewer findings, peer `file:line`, open-question artifacts) was weakened; codex mirrors match; the cross-skill grep found no remaining instruction to write line numbers into task files.

## Validation

- Read-through: drafting a follow-up task for a function deep in a large file, the guidance yields a reference that survives an unrelated 50-line insertion above it.
- Grep the shipped skills for task-file line-citation instructions and confirm only the documented exception remains.

## Review plan

Reviewer checks the exception is genuinely narrow (reason + stamp, not a loophole), that the durable/ephemeral boundary is stated where the rule is stated, and that no skill still tells a task writer to cite by line as the default.
