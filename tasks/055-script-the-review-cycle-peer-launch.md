# 055 — Script the peer launch of `review-cycle`

## Why this task exists

This is one of a series (053–060) that cuts what a skill costs in context by moving deterministic procedure into bundled scripts and rarely-needed rules into files read on demand; README's "Helpers bundled inside a skill" describes the approach and what PRs #129–#149 already moved.

"The peer step" is the largest section in any skill here: about 2,000 words in `review-cycle/SKILL.md` on `main` at `de3b2993`.
Every skill that runs the cycle pays for it, and most of it is launch procedure: the login preflight, the prompt file built from `peer-brief.md` plus the run's facts, the primary launch through `peer-review-run` where that helper is on PATH, the manual `codex exec` form where it is not, the timeout, the read-only flags, where the output goes, and what counts as a forfeit.
None of that needs judgement once the provider and the scope are known.

## Scope

Included:

- **A new helper, `review-cycle/peer.sh`**, that owns the mechanics of a peer review: the once-per-run preflight, prompt assembly, the launch (through `peer-review-run` when present, the manual form otherwise), the manual form's timeout and identity-checked teardown, and a classified result.
- **"The peer step" rewritten around it**, keeping what needs judgement: when a peer runs, what it is told and not told, how a peer finding is weighed, which outcomes leave the cycle free to continue, and the one that does not (a teardown survivor stops the cycle and escalates).
- **Both harnesses.** The Claude mirror reviews with `codex`, the Codex mirror with `claude`, and both carry the same Muse section; the script is byte-identical in both trees, so the provider is an argument. Muse runs through `peer-review-run` only and has no manual form: without that helper it is unavailable.
- **The workflows.** `wf-review-cycle.js` and `wf-address-tasks.js` embed the same launch in their shared cycle section; give them a `bin/` shim (`review-cycle-peer`) and point that section at it. The skills that consume the cycle only point at "The peer step" and need no edit.
- **A test suite** against stub provider binaries, wired into `tests.yml` and README.

Out of scope:

- `peer-review-run` itself, which powbox ships; this script calls it and must work without it.
- The rules for disposing a peer finding ("Disposing findings"), and the rest of the cycle; task 056 covers the loop.
- Raising or lowering peer strength: the launch keeps today's explicit medium effort and each side's model rule (the Codex mirror names a model for `claude`, the Claude mirror names none for `codex`).

## Context and references

- `plugins/dev-skills/skills/review-cycle/SKILL.md` ("The peer step", "Roles") and `peer-brief.md`; the Codex mirror's same section, which carries a preflight classification ladder the Claude mirror lacks (pinned in `scripts/skill-mirror-parity-allowlist.json`).
- `scripts/verify-015-peer-review-run.md` and task 050 (in `tasks/done/`) record how the `peer-review-run` adoption was done and verified.
- `scripts/test-review-cycle-retirement.mjs` asserts the shared cycle section is byte-identical in the two workflows that embed it (`wf-address-review.js` nests the cycle and holds no copy), and also pins the peer-step prose in both mirrors: the exact `peer-review-run` line, the wait, and the Codex mirror's PID helpers, which it extracts and runs. Each of those pins moves to the script or its tests; none is deleted.
- README: "Helpers bundled inside a skill" for the shim rule; the existing scripts' header comments for the helper contract.

## Target files or areas

`plugins/dev-skills/skills/review-cycle/` and `codex/dev-skills/skills/review-cycle/`, `plugins/dev-skills/workflows/wf-review-cycle.js` and `wf-address-tasks.js`, `plugins/dev-skills/bin/review-cycle-peer`, `scripts/` (the new suite and `test-review-cycle-retirement.mjs`), `.github/workflows/tests.yml`, `README.md`.

## Implementation notes

- Follow the helper contract of the existing scripts: bash 3.2, `key=value` lines with `outcome=` first, exits 0/3/1/64, header comment as the contract, temp files under a directory removed on exit, committed `100755`.
- Keep today's result vocabulary whichever path ran: `passed`, `issues`, `unavailable`, `timeout`, `forfeited`, `failed`, with the exact reason on its own line. The batch throttle treats `timeout` and `failed` differently from `forfeited` and matches reason literals, so folding any two together changes throttling.
- Preflight is its own command, run once per run; a batch never repeats the probe inside its entries.
- Keep today's launch model. On the primary path `peer-review-run` runs exactly once, in the foreground, inside the concurrently started Peer role, and is never backgrounded, polled or signalled. The manual form is a detached launch with a PID identity handoff, collected later under a timeout longer than one tool call allows, so it needs separate launch and collect commands (or an equivalent you justify); a single capped foreground call is not a substitute.
- A forfeit is usually workload, not transport: do not add retries beyond what `peer-review-run` already does.
- **Landing order for the series.** 053, 055, 057, 059 and 060 can be worked in parallel; 054 follows 053 and 057, 056 follows 055, and 058 follows 056. Tasks that add a script each append to `.github/workflows/tests.yml`, README's "Focused tests" and the one-line paragraph under README's "Helpers bundled inside a skill", so whichever lands second resolves a mechanical conflict there.
- The prompt must never carry the implementer's reasoning; the script assembles it only from the brief and the facts file it is handed.
- The parity allowlist entry for the Codex mirror's ladder must be re-derived: if the ladder moves into the script, the entry goes with it.

## Acceptance criteria

- A cycle launches its peer through `peer.sh` on both harnesses, with and without `peer-review-run` on PATH.
- "The peer step" holds no launch command a run has to assemble by hand; the PR states its before and after word counts in both mirrors.
- Each of the six outcomes is reported with its reason on both paths, and a teardown survivor is reported as the one stop.
- The parity suite passes with an allowlist that matches what the mirrors now hold.
- The full test set passes.

## Validation

- Run every suite `tests.yml` runs, plus `shellcheck`.
- Mutation-test each guard in the script on a throwaway copy, after committing.
- Run one real peer review through the script against a small committed diff, on whichever provider is logged in, and say in the PR which one and what it returned.

## Review plan

Check the rewritten section against the old one for any launch rule that was dropped rather than moved into the script, then read the script for a path where a peer failure could block or be mistaken for a pass.
