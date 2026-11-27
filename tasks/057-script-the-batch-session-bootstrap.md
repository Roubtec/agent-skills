# 057 — Script the session bootstrap the batch skills share

## Why this task exists

This is one of a series (053–060) that cuts what a skill costs in context by moving deterministic procedure into bundled scripts and rarely-needed rules into files read on demand; README's "Helpers bundled inside a skill" describes the approach and what PRs #141–#149 already moved.

`address-tasks` and `address-reviews` each open with a "Session Bootstrap" section (about 630 and 750 words on `main` at `de3b2993`) that checks where worktrees will live, makes sure the base is ignored, probes push access and measures free space.
Where powbox's `wt-bootstrap` is on PATH it does all of that, so the prose is mostly the fallback for when it is not, written out twice.
`address-review`'s "Attaching the worktree" (about 480 words) carries the ignore rule a third time, with the detail that makes it easy to get wrong by hand: the exclude file's path must come from `git rev-parse --git-path info/exclude`, run from inside the repository.

## Scope

Included:

- **A new helper owned by `address-tasks`, `address-tasks/bootstrap.sh`**, that performs the bootstrap: it calls `wt-bootstrap` when that is on PATH and otherwise does the plain-git equivalent, and reports the worktree base, whether the ignore rule was already there or was added, push access, and free space, in one answer.
- **A command for the ignore rule alone**, for `address-review`, which attaches one worktree and needs nothing else from the bootstrap.
- **Both "Session Bootstrap" sections and the ignore-rule paragraph rewritten around it**, keeping what needs judgement: what to do when the answer is a stop, and how width follows from the reported headroom.
- **The other hand-rolled copies**, where they are the same procedure: `session-learnings` attaches a temporary worktree with the same prefer-the-helper fallback.
- **A test suite**, wired into `tests.yml` and README, and the existing suites that pin this text brought along.

Out of scope:

- Reimplementing `wt-enter` or `wt-remove`. Their safety rules are long and powbox owns them; a fallback attach or remove stays the plain `git worktree` command the skills already name.
- Throttling policy ("Adaptive throttling"), which reads the reported numbers and stays prose.
- Any write outside the repository: the ignore rule goes in the repo-local exclude file, never a tracked `.gitignore` and never the user's global configuration.

## Context and references

- `plugins/dev-skills/skills/address-tasks/SKILL.md` ("Session Bootstrap", "Why worktrees change the rules", "Adaptive throttling"), `address-reviews/SKILL.md` ("Session Bootstrap", "Worktree isolation (inherited)"), `address-review/SKILL.md` ("Attaching the worktree"), `session-learnings/SKILL.md`.
- `scripts/test-skill-worktree-base-exclude.mjs` asserts three named steps are byte-identical across skills and mirrors, and `scripts/test-storage-probe-target.mjs` pins what the free-space probe measures; both encode incidents, so their guarantees move into the script's tests rather than disappear.
- Task 047 and 047a (in `tasks/done/`) record why the exclude rule is established even when the helper is preferred.
- README: "Helpers bundled inside a skill" and "Safety posture".

## Target files or areas

`plugins/dev-skills/skills/address-tasks/` (the script), the four skills' `SKILL.md` in both trees, `plugins/dev-skills/bin/` and `plugins/dev-skills/workflows/wf-address-tasks.js` if the workflow's bootstrap adopts it, `scripts/`, `.github/workflows/tests.yml`, `README.md`.

## Implementation notes

- Follow the helper contract of the existing scripts: bash 3.2, `key=value` lines with `outcome=` first, exits 0/3/1/64, header comment as the contract, committed `100755`.
- `wt-bootstrap` prints one JSON object and exits non-zero to mean stop; translate that into the same answer the fallback gives, so the prose reads one format.
- Probe the ignore rule with the trailing slash (`.worktrees/`): a directory-only rule answers no for a bare name that is not on disk yet.
- The script must give the right exclude path from a linked worktree and from a subdirectory, the two cases a hand-run append gets wrong.
- A consumer skill names the script on a line naming `address-tasks` as its owner, which `test-skill-bundled-files.mjs` enforces.
- Do not let the fallback be more permissive than the helper: a root the helper would refuse is a stop here too.

## Acceptance criteria

- Each of the four skills bootstraps or sets the ignore rule through the script, with and without `wt-bootstrap` on PATH, and no skill still spells the exclude-file append.
- The ignore rule lands in the file `git check-ignore` reads when run from the primary checkout, a subdirectory and a linked worktree.
- The guarantees of the two suites named above are still tested.
- The PR states the before and after word counts of the rewritten sections.
- The full test set passes.

## Validation

- Run every suite `tests.yml` runs, plus `shellcheck`.
- Mutation-test each guard in the script on a throwaway copy, after committing.
- Run it for real once in this repository with the helper on PATH and once with PATH stripped of it, in a disposable clone (`dc-enter`), and report both answers.

## Review plan

Compare the script's fallback against what `wt-bootstrap` checks and name any check present in one and not the other, then confirm no rewritten section lost a stop condition.
