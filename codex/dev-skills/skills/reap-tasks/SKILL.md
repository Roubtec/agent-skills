---
name: reap-tasks
description: Delivered task files need to be checked against the codebase and closed out. Trigger when the user asks to reap completed tasks, close out a delivered batch, sweep finished work, audit task acceptance after implementation, or run reap-tasks. Archives satisfied tasks and writes follow-up task files for concrete gaps. Not for unfinished work or for reviewing an in-flight PR (use address-review or review-cycle).
---

Reap the specified task files by checking them against the current state of the codebase and determining whether each task has been delivered satisfactorily.

**Arguments:** `<mixed-list of task numbers, task-file paths, and globs to reap>`

## Task-pointer preflight

When the caller supplies task pointers, run `resolve-tasks` before verification in a fresh resolution subagent with its own context window.
Hand it the complete raw task-pointer list, have it follow the shared resolver contract, and consume its task-resolution packet; do not scavenge or re-resolve task filenames in the reaping orchestrator's context.
An ordinary no-argument sweep retains its existing inventory flow: discover candidate active task paths under the resolved task subtree as described below, report deferred and already-done entries separately, then pass those discovered candidate paths through this same resolver packet boundary.
No arguments never means a glob over `done/` or permission to re-verify it.
Reconcile the returned packet against the list you handed it: every deduplicated raw pointer must appear either in some path's `selectedBy` or as a `not-found` diagnostic, and a pointer the packet accounts for nowhere is a resolution failure to report, never a silently smaller batch; and no `selectedBy` or `not-found` raw value may name a pointer you never handed it — a packet that invents an input is the same resolution failure to report, never extra work to admit.

The one exception is a list that needs no resolving: where every pointer is a task number, and one recursive listing of the task subtree shows each of those full numbers on exactly one file, directly in the task folder itself, the orchestrator may resolve the list itself, treating each such file as a number-selected unambiguous `active` path, and says in its report that it resolved the list inline.
Any path, glob, miss, duplicate, letter-suffixed or unpadded number, or match outside the task folder itself sends the whole list to the resolver as above.

Use the packet's `selectedBy` provenance to apply policy.
A path selected by an explicit path or glob is reaped exactly as it was before this additive preflight, whether its report context is `active`, `done`, `deferred`, `ambiguous`, or `outside-subtree`; if both explicit and number provenance selected it, explicit selection wins.
A number-selected unambiguous `active` path is eligible for verification immediately; a number-selected unambiguous `deferred` path becomes eligible only after the maintainer explicitly includes it in an interactive run and is excluded hands-off.
A number that resolves only to `done` means already reaped: report it and never re-verify it, even after confirmation.
An unmatched number, path, or glob never executes and its `not-found` diagnostic is always surfaced.

Mode selection is part of the invocation, not an inference from the task mapping: a direct skill invocation defaults to interactive whenever the maintainer can answer in the current session.
Use hands-off only when the maintainer explicitly requests it or the invoking runtime cannot accept mid-run input; a dynamic workflow that cannot pause for a decision uses the same hands-off policy.

In an interactive run, show the resolved mapping whenever the invocation contains any number input, including a number mixed with otherwise clean explicit pointers.
Also show the mapping whenever any input form produces a non-`active` classification or `not-found` anomaly.
Require an explicit continue decision when any number-selected full number is `done`, `deferred`, or `ambiguous`, or when any input is `not-found`: a `done` entry remains skipped as already reaped, and its confirmation asks only whether to proceed with the remaining selected work; it must never offer to re-verify that done entry.
A `deferred` entry needs explicit inclusion.
For each `ambiguous` number, ask the maintainer to select exactly one candidate or exclude that number — a blanket continue must never verify every candidate.
Explicit path/glob selections remain executable while this decision is made.

In a hands-off run, verify only the number-selected unambiguous `active` paths plus every explicit path/glob selection.
Exclude and document every number-selected `done` (already reaped), `deferred`, or `ambiguous` classification and every `not-found` input; never guess an ambiguous number.
Carry the complete mapping and exclusions into the run summary.

## Primary objective

For each task file admitted by the task-pointer preflight, verify against the actual codebase that the task's acceptance criteria, scope, and intent have been met.
The goal is to close completed work cleanly and surface any remaining gaps as new, actionable follow-up tasks.
Treat merged implementations as already covered by the project's normal code-review practices.
Do not perform another general code review; inspect the implementation deeply enough to establish task acceptance and identify concrete gaps.

Choose the execution shape that best fits the task set.
Consider parallel subagents for disparate, independent tasks when their implementations and evidence do not overlap.
Keep dependent tasks or a chain of dependent PRs in one analysis when acceptance depends on their combined end state or shared context.
Base the choice on dependency structure, validation cost, and the risk of conflicting follow-up files; regardless of execution shape, synthesize one coherent result and perform shared cleanup checks once.

Open every verification subagent's prompt with this line, filling in the absolute path of the `subagent-boundary.md` that sits beside this file: "Before your first command, read `<path>/subagent-boundary.md` in full; it binds you. Whatever else you read, never run `rm -rf`, `git reset --hard`, `git clean`, `git branch -f`, `git update-ref`, `git gc`, or a force-push beyond what this prompt spells out, wherever you believe you are standing."
A subagent that may need to verify something in a way that could change state is sent to a disposable clone: name `dc-enter <slug>` in its prompt with a slug unique to it, and never leave the destination to the subagent.
A reap sweep has no worktree isolation at all — every subagent you spawn shares the one checkout — so say in the prompt which build it may run and where its output goes.

## Reaping process

For a sweep, if the repo's deferred task subfolder exists (for example, `tasks/deferred/`), inspect it and report entries whose recorded condition appears to have arrived; promotion into the active task folder remains a maintainer decision, so do not move them automatically.

As part of every cleanup sweep, run `task-numbers.sh duplicates`, in the `write-tasks` skill's folder beside this skill's, by its absolute path from the checkout being swept (`--folder <dir>` where the task folder is not `tasks/`): it reads the working tree's whole task subtree and nothing remote, so no unreadable PR head can fail a sweep.
`outcome=duplicate` (exit 3) prints a `duplicate=` line for every file whose **full task number** stands on more than one (two `024` files collide regardless of slug or folder, while `001`, `001a`, and `001b` may coexist), and exit 1 is a folder that could not be read, never a clean sweep.
Apply the repository's documented equivalent to the `unnumbered=` paths, which were compared with nothing, when its naming convention differs: `numbered=0` means the script compared nothing at all.
Report every colliding path.
Do not renumber or rename an archived or deferred task to repair a duplicate — the stable number preserves historical references; report the collision for explicit remediation instead.
Run it again after creating any follow-up tasks and before committing the cleanup, so the sweep also catches a number allocated during the current run.

For every task file:

1. **Read the task file fully**, including its acceptance criteria, validation steps, scope, implementation notes, and spec divergences.

2. **Run a full build** and verify there are no type errors.
   A build failure is an automatic blocker regardless of whether the task's acceptance criteria mention it.
   Output that must land in a file goes to a path namespaced by the task number, or one created with `mktemp -d` — never a fixed shared scratchpad name: one session's agents share that directory, and two of them redirecting to `<scratchpad>/verify.log` once had one report a verdict for the wrong branch.
   When you spawn a subagent to run the build, hand it the path rather than leaving it to choose.

3. **Inspect the implementation** to verify delivery.
   Do not take file existence at face value — read the relevant source files, check route behavior, verify that tests exist and pass, confirm that types are sound, and validate that the implementation matches the task's stated intent.

4. **Compare against legacy references** when the task cites them.
   Verify that behavioral fidelity has been preserved unless the task explicitly documents a spec divergence.

5. **Decide the task status:**
   - **Satisfied** — the task has been delivered as expected or better.
     All acceptance criteria are met.
     Minor stylistic preferences do not block closure.
   - **Needs follow-up** — the core delivery is present but there are concrete, actionable gaps: missing edge cases, incomplete validation, absent tests, broken behavior, accessibility issues, or deviations from the stated spec that were not flagged as intentional divergences.

## Actions after verification

### For satisfied tasks

Move the task file, unchanged, into a `done` subfolder alongside it.
Create the `done` folder if it does not already exist.
The work is done, but the file is preserved for future reference and lookback (git history alone is not always convenient).

### For tasks that need follow-up

Do **not** modify the original task file.
Instead, create one or more new follow-up task files in the same task folder using the `$write-tasks` skill conventions:

- Continue the numbering sequence within the same phase.
  For example, if reaping six `01-*` tasks, a follow-up file might be `01-07-phase-01-follow-ups.md`.
  Allocate the number by that skill's "File naming and ordering" and its `task-numbers.sh taken --repo <owner>/<repo>` call, never a hand inventory; a head it could not read (`outcome=incomplete`) leaves the allocation reported as not fully checked and fails nothing.
- If the remaining items are small and span multiple original tasks, prefer a single consolidated follow-up task (e.g. "Phase 01 minor fixes and gaps") over one file per original task.
  Group by theme or proximity, not by origin.
- If a gap is substantial enough to warrant its own task, give it its own file with a descriptive name.
- Follow-up tasks must stand on their own: include enough context, references, and acceptance criteria that an implementer can pick them up without re-reading the archived original tasks.
  Past tasks can be referenced for background, but the follow-up should be actionable independently.
- Then move the original task file, unchanged, into the `done` subfolder alongside it (creating the folder if needed).
  The follow-up replaces it going forward, but the original is preserved for reference.

### Consolidated follow-up format

When grouping small items into a single follow-up task, structure it as:

1. A brief summary of what was reaped and why follow-up is needed.
2. A numbered or bulleted list of individual action items, each with:
   - what needs to change and where
   - why it matters (reference the original acceptance criterion or spec)
   - what done looks like for that item
3. Standard acceptance criteria and validation sections covering the full set.

### Committing the result

Once every reaped task has been resolved (moved into `done/` and/or replaced by a follow-up file), commit the changes locally with a single descriptive commit message that summarises what was archived and what follow-ups were created.
Do **not** push — leave that to the user.
Skip this step only if the user has explicitly asked not to commit.

## Acceptance standards

- Be thorough but fair.
  The goal is to catch real gaps, not to nitpick style.
- A task is satisfied if its acceptance criteria are met, even if the implementation took a different structural approach than the task suggested.
- Do not fail a task for work that is explicitly out of scope or deferred to a later phase.
- Do not fail a task for missing test coverage unless the task's acceptance criteria specifically require tests.
- Flag security, accessibility, and data-integrity issues even if the original task did not explicitly mention them — these are always in scope.
- If you discover a problem that is clearly outside the scope of the tasks being reaped, note it to the user but do not create a follow-up task for it unless asked.

## Output expectations

After reaping all tasks, provide a clear summary to the user:

- Which tasks were closed (satisfied and moved into `done/`).
- Which tasks produced follow-up work, with a brief description of what remains.
- Any observations that fall outside the reaped tasks but are worth flagging.
