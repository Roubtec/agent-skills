# 055 — Script the peer launch of `review-cycle`

## Why this task exists

This is one of a series (053–060) that cuts what a skill costs in context by moving deterministic procedure into bundled scripts and rarely-needed rules into files read on demand; README's "Helpers bundled inside a skill" describes the approach and what PRs #141–#149 already moved.

"The peer step" is the largest section in any skill here: about 2,000 words in `review-cycle/SKILL.md` on `main` at `de3b2993`.
Every skill that runs the cycle pays for it, and most of it is launch procedure: the login preflight, the prompt file built from `peer-brief.md` plus the run's facts, the primary launch through `peer-review-run` where that helper is on PATH, the manual `codex exec` form where it is not, the timeout, the read-only flags, where the output goes, and what counts as a forfeit.
None of that needs judgement once the provider and the scope are known.

## Scope

Included:

- **A new helper, `review-cycle/peer.sh`**, that runs one peer review end to end: preflight, prompt assembly, the launch (through `peer-review-run` when present, the manual form otherwise), and a classified result.
- **"The peer step" rewritten around it**, keeping what needs judgement: when a peer runs, what it is told and not told, how a peer finding is weighed, and that a peer outcome never blocks.
- **Both harnesses.** The Claude mirror reviews with `codex` (and `muse` where available), the Codex mirror with `claude`; the script is byte-identical in both trees, so the provider is an argument.
- **The other places that restate the launch**: `address-tasks-serialized`'s "Peer second opinion (best-effort)", and the workflows' embedded cycle if they launch a peer by hand (a `bin/` shim serves a workflow agent).
- **A test suite** against stub provider binaries, wired into `tests.yml` and README.

Out of scope:

- `peer-review-run` itself, which powbox ships; this script calls it and must work without it.
- The rules for disposing a peer finding ("Disposing findings"), and the rest of the cycle; task 056 covers the loop.
- Raising or lowering peer strength: the launch keeps today's explicit medium effort.

## Context and references

- `plugins/dev-skills/skills/review-cycle/SKILL.md` ("The peer step", "Roles") and `peer-brief.md`; the Codex mirror's same section, which carries a preflight classification ladder the Claude mirror lacks (pinned in `scripts/skill-mirror-parity-allowlist.json`).
- `scripts/verify-015-peer-review-run.md` and task 050 (in `tasks/done/`) record how the `peer-review-run` adoption was done and verified.
- `scripts/test-review-cycle-retirement.mjs` asserts the workflows' shared cycle section is byte-identical; a change there is made in all three workflows at once.
- README: "Helpers bundled inside a skill" for the helper contract and the shim rule.

## Target files or areas

`plugins/dev-skills/skills/review-cycle/` and `codex/dev-skills/skills/review-cycle/`, `address-tasks-serialized/SKILL.md` in both trees, `plugins/dev-skills/workflows/*.js` and `plugins/dev-skills/bin/` if the workflows adopt it, `scripts/`, `.github/workflows/tests.yml`, `README.md`.

## Implementation notes

- Follow the helper contract of the existing scripts: bash 3.2, `key=value` lines with `outcome=` first, exits 0/3/1/64, header comment as the contract, temp files under a directory removed on exit, committed `100755`.
- The result should say which of three things happened, in terms the prose can act on without reading provider output: a verdict was returned (and where the file is), the peer is unavailable (binary missing, not logged in, no models served), or the run forfeited (timeout, transport failure, empty answer). Keep the reason on its own line.
- The caller must stay free to launch it beside the Reviewer and collect it later, so the script runs in the foreground and the caller backgrounds it; do not make it poll or daemonize.
- A forfeit is usually workload, not transport: do not add retries beyond what `peer-review-run` already does.
- The prompt must never carry the implementer's reasoning; the script assembles it only from the brief and the facts file it is handed.
- The parity allowlist entry for the Codex mirror's ladder must be re-derived: if the ladder moves into the script, the entry goes with it.

## Acceptance criteria

- A cycle launches its peer through `peer.sh` on both harnesses, with and without `peer-review-run` on PATH.
- "The peer step" holds no launch command a run has to assemble by hand; the PR states its before and after word counts in both mirrors.
- Each unavailable and forfeit case is reported as such and exits in a way the caller treats as non-blocking.
- The parity suite passes with an allowlist that matches what the mirrors now hold.
- The full test set passes.

## Validation

- Run every suite `tests.yml` runs, plus `shellcheck`.
- Mutation-test each guard in the script on a throwaway copy, after committing.
- Run one real peer review through the script against a small committed diff, on whichever provider is logged in, and say in the PR which one and what it returned.

## Review plan

Check the rewritten section against the old one for any launch rule that was dropped rather than moved into the script, then read the script for a path where a peer failure could block or be mistaken for a pass.
