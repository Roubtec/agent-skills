# 062 — Keep argument placeholders out of skill bodies, and read task numbers past 999

## Why this task exists

Two small defects, each a script-and-test fix, combined because both end in the same suites.

**A skill body is not literal text.**
Claude Code replaces positional placeholders in a skill's body with the invocation's arguments before the model reads it, so `$0` in a `SKILL.md` becomes the first argument.
`address-tasks` → "Guarding against pre-PR collisions" prints a bash snippet whose awk program uses `$0` as awk's own record.
Invoked with arguments, the orchestrator is shown that program with a task number where the record was, and the guard scan it then runs prints nonsense or fails.
This has been met in a real batch, and nothing in the suites looks for the pattern, so the next snippet that uses a positional parameter will ship the same way.

**`task-numbers.sh` stops counting at 999.**
The script recognises a task number as exactly three digits and an optional lowercase letter.
In a repository whose task numbers have grown past 999, `taken` prints `-` for every four-digit file, and `claims` and `duplicates` see none of them, so the allocator and the pre-PR guard are blind in exactly the repository that has the most tasks in flight.
The caller ends up parsing file names by hand, which is what the script exists to prevent.

**Prerequisite: the pull request for task 055 has merged.**
The fallback launcher that task deletes from `review-cycle/SKILL.md` holds the other positional parameters in a skill body, so the new check cannot pass on a tree that still carries it.

## Scope

Included:

- **The add/add and same-basename scan leaves the `address-tasks` body** and becomes a call to a bundled script: a new command of `address-tasks/overlap.sh` or a sibling beside it, whichever keeps that script's contract coherent. It answers what the snippet answers today: which newly added paths, and which newly added basenames, more than one of the listed branches holds, each branch diffed against its own base. The Codex mirror carries the same snippet and moves with it, so the mirrors stay in step.
- **A suite check that fails on a positional placeholder in any Claude-mirror `SKILL.md` body**, naming the file and line. `scripts/test-skill-bundled-files.mjs` already walks every skill folder and is the natural home; a suite of its own is fine if the fit is poor.
- **`task-numbers.sh` reads a task number of three or more digits** with its optional letter, in all three commands and in `--reserved`, with its header comment, `task-number-guard.md` and the allocation paragraph of `write-tasks/SKILL.md` saying the same thing.
- **Tests** for both, in the existing suites.

Out of scope:

- This repository's own convention: `tasks/AGENTS.md` keeps three digits.
- The judgement in that section of `address-tasks` (what counts as a collision, how to deconflict, when a name is imperative), and the shared-symbol comparison, which stays the orchestrator's to make.
- Numbering styles that are not a run of digits: a file such as `A-01-…` still reads as `-`, and its repository still reads the paths.

## Context and references

- `plugins/dev-skills/skills/address-tasks/SKILL.md` → "Guarding against pre-PR collisions", and `overlap.sh` beside it, whose header comment is its contract.
- `scripts/test-skill-bundled-files.mjs`: its header lists what it asserts per skill folder and how a name is recognised.
- `plugins/dev-skills/skills/write-tasks/task-numbers.sh`: the header defines a task file; grep the script for `[0-9][0-9][0-9]` to find every place the width is written. `scripts/test-write-tasks-task-numbers.sh` is its suite.
- `write-tasks/SKILL.md` → "File naming and ordering" describes the three-digit numeric slot the allocator compares; `resolve-tasks/SKILL.md` defers to the same parsing definition for this repository's convention. Read both for a sentence the wider number contradicts.
- README → "Helpers bundled inside a skill" for the shim rule: the workflows render this guard in their own briefs, so check whether they need the new command and a `bin/` shim, or already do the scan another way.

## Target files or areas

`plugins/dev-skills/skills/address-tasks/` and `codex/dev-skills/skills/address-tasks/`, `plugins/dev-skills/skills/write-tasks/` and its Codex mirror, `scripts/test-skill-bundled-files.mjs`, `scripts/test-address-tasks-overlap.sh`, `scripts/test-write-tasks-task-numbers.sh`, `README.md` where it describes either script.

## Implementation notes

- **Establish what the harness substitutes before writing the check.** With a throwaway skill, find out which tokens are replaced (`$0`, `$1`, braced forms, the whole-arguments placeholder), what happens when the invocation has fewer arguments than the index, and whether a fenced code block is exempt. Record the answer in the check's header comment, and make the check cover what the harness replaces, not a guess at it.
- The substitution applies to the body the harness loads, not to a bundled file a role reads by path. That is why moving the snippet fixes it; confirm it with the same throwaway skill, and do not extend the check to bundled files unless the test shows they are substituted too.
- A dollar sign followed by a digit is legitimate inside a bundled script. The check is about `SKILL.md` bodies only.
- Follow the helper contract the scripts already follow: bash 3.2, `key=value` lines with `outcome=` first, exits 0/3/1/64, the header comment as the contract, byte-identical copies in both mirrors.
- Keep three as the lower bound of a task number, so a two-digit scheme stays "another numbering style" as it is today.
- Numbers are compared as written. Decide what a repository holding both `0999` and `999` gets, say so in the header, and test it; do not normalise silently.
- The allocator's "numeric slot" wording in `write-tasks/SKILL.md` describes this repository's convention as an example. Reword it only as far as needed for it to stay true of a four-digit repository.

## Acceptance criteria

- No Claude-mirror `SKILL.md` body holds a positional placeholder, and the suite fails, naming the file and line, when one is added.
- The pre-PR scan in `address-tasks` is a script call in both mirrors, and it reports the same duplicated paths and basenames the snippet did on the same branches.
- On a fixture with four-digit task files, `taken`, `claims` and `duplicates` report those numbers, suffix included, and `--reserved` accepts one.
- Every existing case of `scripts/test-write-tasks-task-numbers.sh` and `scripts/test-address-tasks-overlap.sh` still passes unchanged.

## Validation

- Run every suite `.github/workflows/tests.yml` runs, plus `shellcheck` on the changed scripts and suites.
- Put the old snippet back into a `SKILL.md` on a throwaway copy and confirm the new check fails; mutation-test each new guard in the scripts the same way, after committing.
- Invoke `address-tasks` with arguments in a scratch repository, or the throwaway skill, and quote in the pull request what the harness showed for the section that used to hold the snippet.

## Review plan

Check the harness finding is recorded and that the check matches it, then read the script change for any place a three-digit assumption survives (a sort, a comparison, a usage message), and confirm no judgement moved out of the skill together with the snippet.
