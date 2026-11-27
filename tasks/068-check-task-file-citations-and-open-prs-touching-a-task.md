# 068 — Check what a task file cites, and report open pull requests that touch a task being implemented

## Why this task exists

The batch skills treat a task file as a fixed and correct input.
It is neither, and both ways of being wrong are found late:

- **A task cites things that are not there.** A file path, a function or a script named in backticks was renamed, or never existed under that name, and the implementer spends its first turns searching, or builds on a guess. `write-tasks` asks for references anchored to named symbols, but that is prose: nothing checks that a cited name has a single hit anywhere.
- **A task changes while it is being implemented.** Another open pull request edits the same task file (a correction, a rescoping, a follow-up folded in), and the implementer works from the stale copy on its own base. `task-numbers.sh` already reads every open pull request head, but only to ask which task numbers a head claims.

Both are cheap to answer with a read-only script, and neither needs a rule in a skill beyond "run it and read the answer".

## Scope

Included:

- **A citation check**: for the given task files and a ref, list the backticked paths and identifiers that resolve nowhere in that ref's tree.
- **An open-pull-request check**: for the given task files, list every open pull request whose own changes touch one of them, with the pull request number and the path.
- **Where they are run**: `write-tasks` runs the citation check on what it drafted, before its review cycle; `address-tasks` and `address-tasks-serialized` run both on the selected tasks before dispatch and report what they found.
- **Tests** in the suite that covers `task-numbers.sh`, or a sibling suite, wired into `tests.yml` and README.

Out of scope:

- Blocking on either answer. A task legitimately names a file it asks the implementer to create, and an open pull request that touches a task file may be irrelevant to the work. Both checks report; the writer or the orchestrator decides.
- Checking prose claims, ordinals, or whether a cited symbol still means what the task says.
- Running the citation check over this repository's own task folder in CI: archived tasks cite what has since moved, by design.
- A check on a pull request's own task file having changed on its base during an `address-review` run.

## Context and references

- `plugins/dev-skills/skills/write-tasks/task-numbers.sh`: its header is the contract, and its enumeration of open pull request heads (with the `skipped=` and `limit=` lines that say what it could not read) is what the second check should reuse and not reimplement. The `claims` command shows how a head's own additions are told from files it inherits from its base; the same distinction applies to a head's own changes to a task file.
- `write-tasks/SKILL.md` → "Anchor code references to named symbols" and "Review the drafted tasks (the verbiage cycle)".
- `address-tasks/SKILL.md` and `address-tasks-serialized/SKILL.md`: the step that resolves task pointers through `resolve-tasks` is where a pre-dispatch report belongs; `resolve-tasks` itself is read-only and stays as it is.
- `plugins/dev-skills/bin/write-tasks-task-numbers`, the shim the workflows use, and `wf-address-tasks.js` where it resolves its task set.
- `scripts/test-write-tasks-task-numbers.sh`.

## Target files or areas

`plugins/dev-skills/skills/write-tasks/` and its Codex mirror, the pre-dispatch sections of `address-tasks` and `address-tasks-serialized` in both mirrors, `plugins/dev-skills/workflows/wf-address-tasks.js` if the workflow should report the same, `plugins/dev-skills/bin/` for a shim if a new script needs one, `scripts/`, `.github/workflows/tests.yml`, `README.md`.

## Implementation notes

- **New commands on `task-numbers.sh`, or a sibling script: your call.** The open-pull-request check shares that script's enumeration and failure reporting, which argues for a command there. The citation check shares nothing with it but the folder; a separate script beside it may read better. Whichever you choose follows the helper contract: bash 3.2, `key=value` lines with `outcome=` first, exits 0/3/1/64, the header comment as the contract, byte-identical in both mirrors.
- **What counts as a citation has to be stated and conservative.** A backticked token that looks like a path is checked as a path against the ref's tree; one that looks like an identifier is checked for at least one occurrence in the tree outside the task folder. Command lines, flags, placeholders in angle brackets, globs, example values and bare words should not be reported, or the report becomes noise nobody reads. Write the recognition rules in the header, the way `scripts/test-skill-bundled-files.mjs` states what it treats as a name.
- A task's "Target files or areas" routinely names files to be created. The report cannot know which those are, so it lists what did not resolve and leaves the reading to the caller; say this in the skill sentence that invokes it, in a clause.
- **The citation check reads a ref, not the working tree**, so `address-tasks` can ask about the base an implementer will actually start from.
- The open-pull-request check compares a head against its own base, as `claims` does, so a head that merely inherits a task file is not reported. A head or base that could not be read yields the same incomplete outcome `taken` gives, never a clean answer.
- Keep the skill text to the call and what to do with a non-empty answer: for a citation, fix the task or note the gap in the implementer's prompt; for a touching pull request, say so in the batch report and decide whether that task waits.

## Acceptance criteria

- Given a task file citing a path and an identifier that exist and one of each that do not, the citation check lists exactly the two that do not, against a named ref.
- A file the task asks to be created appears in the report and blocks nothing.
- Given a fixture with an open pull request that edits a selected task file and one that only inherits it, the second check reports the first and not the second, and reports an incomplete scan as incomplete.
- `write-tasks`, `address-tasks` and `address-tasks-serialized` each run the checks at the stated point in both mirrors, in a sentence or two.
- The full test set passes.

## Validation

- Run every suite `tests.yml` runs, plus `shellcheck`.
- Run the citation check over this repository's active task files and include its output in the pull request, with a note on any false report and what rule would have avoided it.
- Mutation-test each guard after committing.

## Review plan

Read the recognition rules against a handful of real task files for noise and for misses, then confirm neither check can turn into a gate through the wording of the skills that call it.
