# Task-number guard: reading a collision or an incomplete scan

This file is part of the `write-tasks` skill, which owns how task numbers are allocated.
The batch skills run `task-numbers.sh claims`, beside this file, before opening any PR, and read this file in full only when it answers `collision` or `incomplete`, or when the run tracks members of its own (a pipelined batch).
The script's `--help` prints what every line of its output means; this file holds what to do about it.

## What is compared

A task file's basename starts with a **full task number**: three digits plus an optional lowercase letter suffix, such as `001`, `001a`, or `042b`, followed by a dash and its slug.
Two files collide whenever their full task numbers are identical, regardless of slug; `001`, `001a`, and `001b` are distinct and do not collide.

The scanned branch claims every task file it adds against its own recorded base, less its own relocations.
Within one number, each file it removes pairs with one file it adds, the same basename first, so an archive, a deferral, a promotion or an in-place slug rename is a net-zero claim, and a two-file number swap clears too.
A single removal cannot exempt both a relocation and a second new claimant, and no pairing ever crosses numbers.
Because the pairing uses only removals against the branch's own base, it never releases a number another holder claims.

The comparison set is the union of two groups.
**Always:** the base branch and every open PR head, which the script reads itself.
**In a pipelined run, additionally:** branches delivered earlier in the same run, anything merged since the run started, numbers reserved by a task that cleared this guard but has not finished delivering, and currently-ready siblings awaiting the guard.
Track these run-local members as the pipeline advances, and hand the script the ones it cannot see for itself: `--reserved <number>` for each reserved number, and `--member <commit>:<its base commit>` for each sibling or delivered branch that has no open PR.
A delivered branch with an open PR is already an open PR head, and a merged one is already on the fetched base.

What a holder contributes is decided by its kind.
The base contributes its entire recursive task tree, so `done/`, `deferred/` and any future nested folder keep their numbers.
Any other tree-bearing holder contributes only the task files it adds relative to **its own** base, because a head inherits its base's files without claiming them and a whole-tree read would turn routine stacked work and task relocations into false collisions.

## The task folder

The script reads `tasks/` unless told otherwise.
Where the repository documents another task folder, pass it as `--folder <dir>` on every call.
Never read a clean answer from the conventional folder as a clean scan when the resolved folder is elsewhere.

## The base

`--base <branch>` is the normal and required form: the script fetches the scanned branch's recorded base from the repository before reading it, because a local or remote-tracking ref can be stale.
`--local-base <commit>` is the only fallback, for a recorded base the remote cannot represent because it exists only locally (an unpushed dependency base), or for a run already known to be local-only.
Name the exact commit, and report the base read as degraded: the script answers `incomplete` with a `degraded=` line for that reason.
A base that cannot be fetched fails the scan (exit 1); never turn that into an empty additions list or a silent pass.

## On `outcome=collision`

Each `collision=` line names the claim, its holder and the holder's path.
First claimant wins; the second claimant renumbers, and a delivered or reserved claimant is never rewritten.
When two currently-ready siblings are both still unguarded, establish the first claimant in the run's deterministic delivery order (dependency or scheduling order, then task number) and reserve it before evaluating the other; the delivered-or-reserved rule decides every asymmetric case.

- `same-path`: the identical path is added on both sides.
  Only this case may be handed to the skill's plain add/add procedure.
- `other-path`: a differing slug is the cross-branch case this guard exists to catch, and the same slug at a different path is a collision too, since `tasks/done/024-foo.md` or `tasks/deferred/024-foo.md` still holds `024`.
  Hold the scanned branch, renumber the **flagged new claimant**, regenerate derived files, and run fresh review again.
- A `branch` holder is another file on the scanned branch itself: two new files there claim one number, and one of them renumbers before the branch goes anywhere.

Never renumber a copy in `tasks/done/` or `tasks/deferred/`, because its stable number is part of the historical reference.
If the task path or its number is imperative, keep the branch held and ask the maintainer instead of inventing an alternative.
After a renumbering, run the script again: the new number is a new claim.

## On `outcome=incomplete`

No collision was found among what could be read, and not everything could be: note it and proceed, rather than block the delivery or call the scan complete.

- `skipped=pr:<N>`: that head, or its base, could not be read; name the PR and the reason in the report.
- `skipped=prs`: the enumeration itself failed, so no open head was compared; a local-only run may still rely on its `--member` and `--reserved` holders, but must not describe the remote scan as complete.
- `limit=200`: the enumeration returned as many PRs as it asks for, so later heads cannot be named; report the count and that the scan is incomplete.
  Do not add pagination to disguise that bound.
- `degraded=`: the base was read from a local commit.

## What the guard does not promise

This is a bounded snapshot, not a total guarantee.
It establishes that no collision existed among the heads at the commits the one enumeration returned.
A head can advance after that enumeration, or while this branch's own PR is being opened, and land a concurrent duplicate.
Do not re-query or compare `FETCH_HEAD` in an attempt to close an unclosable race; the `reap-tasks` recursive duplicate-number sweep is the backstop for that residual.
