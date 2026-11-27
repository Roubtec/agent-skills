# 071 — Script the long-running half of `merge-train`

## Why this task exists

`merge-train/train.sh` covers every step of a train that happens at a moment: `survey`, `check`, `rebase`, `push`, `merge`.
What it does not cover is the part that takes hours.
The skill tells the orchestrator to watch with a background monitor that polls `train.sh check` and prints a line only when an outcome changes, and each run writes that loop from scratch.

The hand-written loops have had the same defects each time: they emit on a changed count when the outcome did not change, they have to be restarted to add or drop a pull request, and they lose what they knew when the monitor expires.
The train's state (which pull requests are pending on which head, which lanes a full green run showed, what merged on what basis) lives only in the orchestrator's context, so a scheduled wakeup or a re-armed monitor starts from a prompt that names pull requests already merged.

Two smaller gaps sit in the same hours:

- **A re-run asked for too early is refused**, because GitHub will not re-run a failed job while its run is still in progress. `ci.sh rerun` answers `rejected` for that as for any other refusal, so the train cannot tell "ask again when the run completes" from "this will never work".
- **A failed job's log cannot be read until the whole run has finished**, on the route `ci.sh log` takes, so diagnosing a red lane waits on unrelated jobs, and what comes back is a raw tail with terminal escape sequences in it.

## Scope

Included:

- **`train.sh watch`**: one long-running command for the harness's monitor to run. It reads the pull requests to watch from a file, keeps the train's state in a file, and prints a line only when a pull request's outcome changes.
- **The watch also covers a commit**, for the default branch's own run on the final tip in "Finishing".
- **`ci.sh rerun` tells a run still in progress from any other refusal**, and does not re-run a run whose commit is no longer its branch's tip.
- **`ci.sh log` reads a failed job's log while its run is still in progress**, with terminal escape sequences removed.
- **`merge-train/SKILL.md` rewritten around them**: the watch paragraph of "The loop", the logging rule in "Ground rules", the red-lane step, and "Finishing" point at the commands and the state file and keep only what needs judgement.
- Both mirrors and tests in `scripts/test-merge-train.sh` and `scripts/test-address-review-ci.sh`.

Out of scope:

- The decisions of a train: merge now or wait, ordering, what a red lane means, when to cancel a run.
- Parsing a particular test framework's failures out of a log. The reader returns the failing job's log; what failed in it is the orchestrator's to read.
- Validating several pull requests as one combined tree, and local rebases made only to run checks.
- Any process that outlives the session that started it.

## Context and references

- `plugins/dev-skills/skills/merge-train/train.sh`: the header is the contract. `check` already defines every outcome the watch reports, the `--lane` filter for the lanes a full green run showed, and why a rollup read right after a push cannot be trusted.
- `merge-train/SKILL.md` → "The loop" (the watch, `moved`, re-arming an expired monitor), "Ground rules" (log each merge and its basis as it happens), "Runner economy" and "Finishing".
- `plugins/dev-skills/skills/address-review/ci.sh`: `cmd_log` and `cmd_rerun`. It belongs to `address-review` and `merge-train` calls it from the folder beside its own, so a change there serves both skills and is tested in `address-review`'s suite.
- `scripts/test-merge-train.sh` and `scripts/test-address-review-ci.sh` for how `gh` is stubbed.

## Target files or areas

`plugins/dev-skills/skills/merge-train/` and `plugins/dev-skills/skills/address-review/ci.sh` with their Codex mirrors, `address-review/SKILL.md` where it describes `ci.sh`, the two suites, `README.md`.

## Implementation notes

- **The state file is the train's memory, and the caller names it.** It lives where the caller says, outside the repository, and holds what a resumed orchestrator needs: each pull request with the head it is watched on and its last outcome, the passing lanes kept from a full green run, and each merge with its basis. The skill's instruction then becomes "read the state file" wherever it now relies on the orchestrator remembering, and a wakeup prompt points at the file instead of carrying a list.
- **Adding or dropping a pull request is an edit to the list file**, picked up on the next poll, so the watch is never restarted for it.
- **Emit on a change of outcome, not of any field.** A red pull request whose number of pending lanes changed has not changed outcome.
- **The watch ends by itself**: when nothing in its list is still pending, and at a maximum duration the caller can set. A watch that polls forever is exactly the stale loop a long-lived container accumulates. Its last line says why it stopped, so the orchestrator knows whether to re-arm.
- `moved` and `not-open` are terminal for the head being watched: report once and stop polling that entry until the list names a new head.
- **Confirm the two GitHub behaviours before coding around them**, and record what you observed in `ci.sh`'s header: that a failed job cannot be re-run until its run completes, and that the failed-log route refuses while other jobs of the run are going. If a per-job log read works mid-run, use it; if nothing does, say so and make `log` answer with a distinct outcome instead of a failure.
- A new `rerun` outcome is an addition to an existing contract. `address-review` reads `accepted` and `rejected`; check its text and its workflow for anything that treats an unknown outcome as a failure.
- Follow the helper contract both scripts already follow: bash 3.2, `key=value` lines with `outcome=` first, exits 0/3/1/64, the header comment as the contract, byte-identical in both mirrors.
- Polling costs API calls. Keep one `check` per pending pull request per interval, state the default interval and why, and back off on a rate-limit answer instead of failing the watch.

## Acceptance criteria

- A train is watched by one `train.sh watch` call, and `merge-train/SKILL.md` no longer asks the orchestrator to write a polling loop.
- Editing the list file changes what is watched without a restart.
- A line is printed when, and only when, a watched pull request's outcome changes, and when the watch stops.
- A new session given only the state file can say which pull requests are pending, on which heads, and what has merged on what basis.
- `ci.sh rerun` on a run still in progress answers with an outcome distinct from a permanent refusal, and re-runs nothing for a superseded commit.
- `ci.sh log` returns a failed job's log while a sibling job is still running, free of escape sequences, or answers with the distinct outcome the notes describe.
- The full test set passes.

## Validation

- Run every suite `tests.yml` runs, plus `shellcheck` on both scripts and suites.
- Drive the watch against the `gh` stub through a sequence of outcomes, a list edit, an expiry and a rate-limit answer; mutation-test each guard after committing.
- Run the watch read-only against one real open pull request for a few intervals and quote its output and state file in the pull request.

## Review plan

Check that the watch cannot outlive its bound or print on noise, that the state file alone is enough to resume, and that no merge decision moved from the skill into the script.
