# 061 — Let `peer.sh` pick its own attempt directory

## Why this task exists

Task 055 moved the peer launch of `review-cycle` into `review-cycle/peer.sh`.
Its `run` command takes `--artifact-dir`, a directory that must be this attempt's own: absolute, outside the worktree, and never one a previous `run` used.
A reused directory is a usage error (exit 64).
The script enforces that, but choosing a fresh directory is left to the caller, and the workflow stage that calls it is told how in prose: use `run-2` when an earlier attempt left its artifact directory behind.
A stage that gets this wrong records the round's peer as `failed`, which the batch throttle counts as a trouble event, for a mistake that is purely mechanical.

This was found in the review of task 055 and deliberately left for a pull request of its own, because it changes the script's interface.

**Prerequisite: the pull request for task 055 has merged.**

## Scope

Included:

- **An `--artifact-root <dir>` mode for `peer.sh run`**, as an alternative to `--artifact-dir`: the script creates a fresh attempt directory of its own under the root and prints it as `artifact_dir=` in its answer, so the caller holds what `collect` needs.
- **The callers moved to it** where it removes prose: the embedded cycle section of `wf-review-cycle.js` and `wf-address-tasks.js` (byte-identical in both), and "The peer step" in both `review-cycle/SKILL.md` mirrors if they describe choosing a directory.
- **Tests** in `scripts/test-review-cycle-peer.sh`, and any pin in `scripts/test-review-cycle-retirement.mjs` on the `run-2` wording moved with it.

Out of scope:

- `--artifact-dir` itself, which stays for a caller that wants to name the directory.
- The retry inside `collect`, which already uses new paths of its own.
- Anything else in `peer.sh`: the outcome vocabulary, the launch model and the verdict rule do not change.

## Context and references

- `plugins/dev-skills/skills/review-cycle/peer.sh`: its header comment is the contract (`peer.sh --help`); the checks on `--artifact-dir` (absolute, outside the worktree, no `..` component, not already used) are what the new mode must keep true of the directory it creates.
- The embedded cycle section in `plugins/dev-skills/workflows/wf-review-cycle.js`, between its `review-cycle-core` markers, and its copy in `wf-address-tasks.js`; grep for `run-2`.
- `scripts/test-review-cycle-retirement.mjs` asserts the two copies are byte-identical and pins launch wording.
- Task 055 (in `tasks/` or `tasks/done/`) for what was decided about the launch and why.

## Target files or areas

`plugins/dev-skills/skills/review-cycle/peer.sh` and its byte-identical copy under `codex/dev-skills/skills/review-cycle/`, both `review-cycle/SKILL.md` mirrors if they change, `plugins/dev-skills/workflows/wf-review-cycle.js` and `wf-address-tasks.js`, `scripts/test-review-cycle-peer.sh`, `scripts/test-review-cycle-retirement.mjs`, `README.md` where it describes the script.

## Implementation notes

- Create the directory with a name that cannot collide with a sibling stage running at the same moment (`mktemp -d` under the root), not a counter read and then written.
- The root is checked the way `--artifact-dir` is before anything is created: absolute, outside the worktree, no `..` component.
- `--artifact-root` and `--artifact-dir` together are a usage error.
- Follow the helper contract the script already follows (bash 3.2, `outcome=` first, exits 0/3/1/64), mutation-test each new guard, and run the suite under real bash 3.2 (`docker.io/library/bash:3.2`) as well as bash 5.
- Do not launch a real provider from the tests; the suite's stubs cover both launch paths.

## Acceptance criteria

- A stage that passes `--artifact-root` never names an attempt directory itself, and no prose in the workflows or the skill tells it how to pick one.
- Two `run` calls with the same root get two different directories, including when started at the same moment.
- `collect` works with the `artifact_dir=` the script printed.
- The embedded cycle section is still byte-identical in both workflows, and the full test set passes.

## Validation

- Run every command `.github/workflows/tests.yml` runs, `shellcheck` on the script and the suite, and `wf-check` on the workflows.
- Run one real peer review through the new mode against a small committed diff and say in the pull request which provider and what it returned.

## Review plan

Check that the new mode cannot create a directory inside the reviewed worktree or reuse one, and that every instruction about choosing a directory is gone from the callers rather than left beside the new flag.
