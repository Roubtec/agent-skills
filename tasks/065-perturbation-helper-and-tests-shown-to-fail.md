# 065 — A perturbation helper that cannot pass silently, and new tests shown to fail without the fix

## Why this task exists

A green suite is evidence only if it can go red.
Two failures of that kind keep recurring in reviewed work:

- **A control that never applied.** A role "breaks" a guard to prove a test notices, the edit matches nothing (a stale string, the wrong file), the suite stays green on unchanged code, and the role reports zero failures as the expected result of a perturbation that did not happen.
- **A new test that could not fail.** A fix arrives with a test that passes with or without the fix, and the Reviewer has no stated reason to ask.

A third is the cost of doing it by hand: a perturbation restored with a path-level discard has thrown away uncommitted work more than once, which is why `fixer-brief.md` already orders such controls after the commit.

A small helper removes the mechanical ways to get this wrong, and one sentence in the Reviewer's brief gives the second failure an owner.

**How this must read.**
Most repositories these skills are used in have no mutation checks at all, and the maintainer's condition for this task is that nothing may suggest such checks are mandatory. The helper is a safer way to run a control a role has already decided to run. It is not a new gate, and it must never leave a tree mutated.

## Scope

Included:

- **A helper beside the role briefs in `review-cycle/`** that applies one exact-string replacement to one named file, fails when the string did not match, runs the named command expecting it to fail, restores the file, and says which of those happened.
- **`fixer-brief.md` points at it** from the sentence that already orders a perturbation-style control after the commit.
- **`reviewer-brief.md` gains the expectation** that where a change adds or extends a test for a fix, the Reviewer satisfies itself the test fails without the fix, and says how it did.
- **The workflow renders of those two briefs**, and a `bin/` shim if a workflow role needs the helper.
- **A test suite** for the helper, wired into `tests.yml` and README.

Out of scope:

- Any rule that a repository, a task or a round must run mutation checks.
- Mutation frameworks, multi-file or regular-expression mutations, and coverage measurement.
- The task files' own "mutation-test each guard" lines, which are this repository's practice for its scripts and stay as each task wrote them.

## Context and references

- `plugins/dev-skills/skills/review-cycle/fixer-brief.md` → "Commit your work, and validate it at the tier your prompt states", which holds the commit-first rule from task 048.
- `reviewer-brief.md`: the Reviewer edits nothing, and "A sweep is re-enumerated, never spot-checked" is the nearest existing rule of the same kind.
- `subagent-boundary.md`: empirical verification that could change state goes to the disposable clone the prompt names (`dc-enter <slug>`).
- `review-cycle/SKILL.md` → "Roles": the peer reads the committed checkout at the same moment the Reviewer works, which is what makes a mutation in the reviewed tree unsafe during a review round.
- The existing helpers' header comments for the contract a bundled script follows.

## Target files or areas

`plugins/dev-skills/skills/review-cycle/` and its Codex mirror, `plugins/dev-skills/workflows/wf-review-cycle.js` and `wf-address-tasks.js` where they render the two briefs, `plugins/dev-skills/bin/` if a shim is needed, `scripts/` for the suite and any suite that pins brief text, `.github/workflows/tests.yml`, `README.md`.

## Implementation notes

- **The outcomes are the point.** A caller must be able to tell apart: the string did not match (nothing ran), the command failed as expected, the command passed although the file was changed (the control found a real gap), and the helper could not restore. Only the second is a success.
- **Restoring is unconditional.** The file returns to its exact prior bytes on every exit path the script can catch, including a signal and a command that times out, and the helper checks the restored content before it answers. It restores from a copy it made, never through `git restore`, `git checkout` or a stash, so it cannot discard anything.
- **It refuses to start on a file with uncommitted changes**, which keeps the commit-first rule true by construction, and it refuses a path outside the directory it was pointed at.
- **Where it runs matters.** A fixer is alone in its worktree during its pass, so it may run the helper there after committing. A Reviewer edits nothing in the reviewed tree and a peer is reading that tree at the same moment, so a Reviewer's control runs in the disposable clone its prompt names. Give the helper a `-C <dir>` argument so both are one form, and say this in the two briefs in a clause, not a paragraph.
- **The Reviewer sentence is proportionate.** It applies where a change claims a test for a fix. Reverting the fix in the disposable clone and running that one test is the direct way; reading the test against the pre-fix code is acceptable where running is impractical, and the report says which was done. It does not ask for a control on every test, and with no clone slug in the prompt the Reviewer reports that the check needs one, as the boundary already says.
- A command that fails for an unrelated reason looks like an expected failure. The helper cannot know the difference, so its header says so, and the brief sentence asks the role to name the failure it expected.
- Follow the helper contract of the existing scripts: bash 3.2, `key=value` lines with `outcome=` first, exits 0/3/1/64, the header comment as the contract, temp files under a directory removed on exit, byte-identical in both mirrors, committed `100755`.
- Task 067 edits the same two brief files; whichever lands second rebases.

## Acceptance criteria

- A replacement that matches nothing ends the helper with a non-zero status and a distinct outcome, and the command is never run.
- After any outcome, including an interrupted run, the file is byte-identical to what it was, and `git status --porcelain` is as it was before the call.
- The helper refuses a file with uncommitted changes.
- The two briefs name the helper without restating how it works, and neither says a control is required where the task or repository did not ask for one.
- A reader of `reviewer-brief.md` in a repository with no mutation checks finds nothing that obliges it to add any.
- The full test set passes.

## Validation

- Run every suite `tests.yml` runs, plus `shellcheck`.
- Cover each outcome with a fixture repository in the suite, including a command killed mid-run and a file whose restore is made to fail.
- Mutation-test the helper's own guards on a throwaway copy, after committing.

## Review plan

Try to make the helper leave a file changed or report success on a perturbation that did not apply, then read the two brief sentences as a newcomer to a repository without mutation checks would.
