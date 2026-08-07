# 039 — `resolve-tasks`: a shared task-pointer resolver adopted by the task-consuming skills

## Why this task exists

`address-tasks`, `address-tasks-serialized`, and `reap-tasks` all take a "glob-or-file-list of task files", but the person invoking them thinks in task numbers — the repo's own cross-referencing convention (`tasks/AGENTS.md`) says numbers, not paths, are the stable handle. Today a numbers-only invocation forces each skill to improvise resolution mid-run, and the interesting failure cases — a number whose file is already in `done/`, a number that matches nothing, or two files in different folders claiming the same full number under different slugs (which version control never surfaces) — are discovered mid-batch instead of at preflight, when they are cheapest to resolve with the user.

## Scope

Included:

- **A new stand-alone skill module `resolve-tasks`** in `plugins/dev-skills/skills/`, invocable directly by a user and consumable by other skills. Argument: a deduplicable mixed list of task numbers, task file paths, and globs. Behavior: resolve the repository's task folder, normalize each number per the documented convention (three digits plus optional lowercase letter; accept unpadded input like `27` → `027`), search the entire subtree recursively including `done/`, `deferred/`, and any nested folders, and return (a) the deduplicated hard list of well-formed task spec paths and (b) a per-input classification: `active`, `done`, `deferred`, `not-found`, or `ambiguous` (multiple files sharing one full number). Read-only: it resolves and reports, it never moves, renumbers, or edits task files.
- **Adoption in the three consumers:** each preflight runs `resolve-tasks` in a subagent with its own context window (the scavenging must not pollute the orchestrator's context) and receives back the hard path list plus classifications. Consumer policy on non-`active` results: interactively, surface a continue-prompt showing the resolved mapping — proceeding needs explicit confirmation when any input resolved to `done`, `deferred`, `not-found`, or `ambiguous`, and a bare-numbers invocation shows its resolved list before execution so caller and agent agree on what will run. Hands-off: proceed with the unambiguous `active` set only and document every exclusion; never guess an ambiguous number.
- **Consumer-specific readings:** for `reap-tasks`, a number resolving only into `done/` means already reaped — report it, do not re-verify it; for the implement skills, `done` means already delivered (prompt/skip) and `deferred` means deliberately unscheduled, so implementing it needs explicit confirmation rather than silent inclusion.
- **Explicit non-applicability:** `address-review`/`address-reviews` arguments remain PR numbers and branch names; a bare number there is a PR, never a task. Say so in `resolve-tasks` so the module is not misapplied.

Out of scope: changing the consumers' existing path/glob handling (raw paths keep working; the resolver is additive), any task-file mutation, and the number-collision *guard* semantics (027 owns collision handling at delivery; the resolver only reports what it finds).

## Context and references

- `tasks/AGENTS.md` — the numbering convention and the numbers-as-stable-references rule this module operationalizes.
- `plugins/dev-skills/skills/{address-tasks,address-tasks-serialized,reap-tasks}/SKILL.md` — the current `<glob-or-file-list>` argument contracts and their orchestrator preflights.
- `tasks/done/027` — full-number parsing (three digits + optional lowercase suffix) already specified for the pre-PR guard; reuse the same parsing rules rather than describing them a second time.
- `reap-tasks` already inventories the subtree for duplicate full numbers during sweeps — the resolver's `ambiguous` classification is the same detection surfaced at preflight; keep the two consistent.

## Target files or areas

- New: `plugins/dev-skills/skills/resolve-tasks/SKILL.md` (plus plugin manifest registration if the plugin enumerates skills), and its codex-side mirror per the existing mirror pattern.
- Adoption edits: the argument-resolution/preflight sections of `plugins/dev-skills/skills/{address-tasks,address-tasks-serialized,reap-tasks}/SKILL.md` and their codex mirrors.

## Implementation notes

- The module is prose-only like its siblings — a skill instruction file, not a shipped binary; keep its contract crisp enough that a subagent following it returns a mechanically usable list.
- A number with letter suffix (`015b`) is a full number matching exactly one file; a bare primary (`015`) matches only the primary, not its suffixed follow-ups — spell this out, it is the likeliest ambiguity in practice.
- Classification is per full number across the whole subtree: `active` beats nothing, but a number found in both `tasks/` and `done/` is `ambiguous` (a relocation half-done), not `active`.
- Keep consumer deltas small: the consumers state when they invoke the resolver and what each classification means for them; the resolution mechanics live only in `resolve-tasks`.

## Acceptance criteria

- `resolve-tasks` exists, handles a mixed numbers/paths/globs argument, returns the deduplicated path list plus the five-way classification, and states its read-only contract and the PR-numbers non-applicability note.
- All three consumers document the subagent-preflight invocation, the interactive confirmation on any non-`active` resolution (including the bare-numbers echo of the resolved list), and the hands-off exclude-and-document degradation.
- A numbers-only invocation of each consumer is now a documented, first-class form; existing path/glob invocations are unchanged.
- Codex mirrors exist and match.

## Validation

- Dry-run the resolver contract by hand in this repo: `27`, `015b`, `015`, a `done/` number, a nonexistent number, and a deliberately staged same-number pair must classify as the spec says (stage the pair in a scratch copy, not in `tasks/`).
- Read-through of each consumer's preflight confirms the continue-prompt and hands-off behavior are unambiguous.

## Review plan

Reviewer checks the resolver's classifications are exhaustive and mutually exclusive, that no consumer restates the resolution mechanics, that the `reap-tasks` done-means-reaped reading cannot silently skip a half-relocated task (that case must classify `ambiguous`), and that nothing lets a hands-off run act on a guessed resolution.
