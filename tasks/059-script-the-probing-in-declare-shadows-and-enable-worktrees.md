# 059 — Script the probing in `declare-shadows` and `enable-worktrees`

## Why this task exists

This is one of a series (053–060) that cuts what a skill costs in context by moving deterministic procedure into bundled scripts and rarely-needed rules into files read on demand; README's "Helpers bundled inside a skill" describes the approach and what PRs #141–#149 already moved.

`declare-shadows` (about 2,990 words on `main` at `de3b2993`) and `enable-worktrees` (about 2,070) are the two skills of any size with no bundled script.
Each spends most of its "Procedure" section (about 1,950 and 1,160 words) telling the agent which commands to run to learn the repository's state: which folders are ignored, which of those hold tracked files, which are mountpoints, what `.powbox.yml` and `.gitignore` already declare, and which launch mode the container is in.
They run rarely, so the saving per session is small, but the probing is exactly the kind of thing an agent gets subtly wrong by hand and a script gets right every time.

## Scope

Included:

- **A read-only probe for each skill**, `declare-shadows/probe.sh` and `enable-worktrees/probe.sh`, that gathers the facts its procedure asks for and prints them in one answer.
- **Each "Procedure" rewritten around its probe**, keeping the judgement: which candidates are disposable output worth shadowing and which are caches to leave alone, what to declare, and what to tell the user.
- **Test suites** for both, wired into `tests.yml` and README.

Out of scope:

- Scripting the edits to `.powbox.yml` or `.gitignore`. They are small, they are the user's files, and what goes in them is the judgement these skills exist for; the probes only read.
- Changing what either skill recommends.
- Anything powbox ships (`shadow-refresh.sh`, `wt-bootstrap`); the probes may call them where present and must work where they are absent.

## Context and references

- `plugins/dev-skills/skills/declare-shadows/SKILL.md` ("What to shadow, and what to leave alone", "Declare literals, not globs", "Procedure") and `enable-worktrees/SKILL.md` ("What \"worktree-ready\" means", "Procedure").
- `prune-branches/prune-branches.sh` is the nearest model: a classifier whose brief keeps only the judgement and the confirmation.
- README: "Helpers bundled inside a skill" and "Safety posture".

## Target files or areas

`plugins/dev-skills/skills/declare-shadows/` and `enable-worktrees/`, their mirrors under `codex/dev-skills/skills/`, `scripts/`, `.github/workflows/tests.yml`, `README.md`.

## Implementation notes

- Follow the helper contract of the existing scripts: bash 3.2, `key=value` lines with `outcome=` first, exits 0/3/1/64, header comment as the contract, committed `100755`.
- If the two probes turn out to share most of their code, one script owned by one skill and named by the other (on a line naming the owner) is better than two near-copies.
- The probes must behave outside a powbox container: no `.powbox.yml`, no `POWBOX_WORKSPACE_HOST_PATH`, no helpers on PATH is an ordinary answer, not an error.
- Print candidates as literal paths, one per line, since the skill declares literals and never globs.
- Bound the scan: a repository with a very large ignored tree must not make the probe walk all of it.

## Acceptance criteria

- Each skill's procedure gathers its facts with one probe call and holds no hand-run inspection command the probe covers.
- Neither probe writes anything, inside or outside the repository.
- Both give a sensible answer in a plain checkout with no powbox files.
- The PR states the before and after word counts of both `SKILL.md` files.
- The full test set passes.

## Validation

- Run every suite `tests.yml` runs, plus `shellcheck`.
- Mutation-test each guard on a throwaway copy, after committing.
- Run each probe against this repository and against one fixture repository with ignored build folders, and include the answers in the PR.

## Review plan

Check each fact the old procedure gathered is in the probe's answer, then check the rewritten procedure still leads to the same declaration for the fixture repository.
