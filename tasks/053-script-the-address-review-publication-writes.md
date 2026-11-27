# 053 — Script the thread replies, resolves and summary comment of `address-review` publication

## Why this task exists

This is one of a series (053–060) that cuts what a skill costs in context by moving deterministic procedure out of `SKILL.md` and into a script bundled in the skill's folder, and by moving rules that apply only in a rare case into a file read on demand.
PRs #141–#149 did this for the branch mechanics, the disposition record, CI lanes, pings, the thread fetch, the merge train, the overlap check, the task-number guard and the batch targets; README's "Helpers bundled inside a skill" describes what exists and the contract every helper follows.

`address-review`'s "Step 7 — Publish after the review gate" is still that skill's largest section (about 1,290 words on `main` at `de3b2993`), with "GitHub API recipes" (about 220) behind it.
The push, the record and the pings are scripted (`pr-branch.sh push`, `record.sh`, `ping.sh`), but the thread replies, the resolves and the Summary comment are still hand-run `gh` calls and GraphQL mutations that each run re-derives from prose.
Once the dispositions are decided, those writes are mechanical.

## Scope

Included:

- **A new helper, `address-review/publish.sh`**, that takes the PR and a dispositions file and makes the PR-side writes step 7 describes today: one reply per thread, the resolve where the disposition calls for it, and the Summary comment.
- **Step 7 rewritten around it**, keeping only what needs judgement: which disposition gets a reply and which a resolve, what the reply and the Summary say, and the order of push, record, thread writes and pings.
- **"GitHub API recipes" reduced** to whatever a run still has to do by hand, or removed if nothing is left.
- **The workflow surface.** `wf-address-review.js`'s publisher brief restates these writes; give it a `bin/` shim (`address-review-publish`) and point the brief at it, as the existing shims do for `push`, `record` and `ping`.
- **A test suite, `scripts/test-address-review-publish.sh`**, wired into `.github/workflows/tests.yml` and README in the established shape.

Out of scope:

- Any change to what a disposition means, to the review gate, or to when a run publishes.
- `pr-branch.sh`, `record.sh` and `ping.sh` beyond what calling them in sequence needs.
- `address-reviews`' own "Publication" section: task 054 follows this one.

## Context and references

- README: "Helpers bundled inside a skill", "Safety posture", and the per-suite entries under "Focused tests".
- `plugins/dev-skills/skills/address-review/`: `SKILL.md` (step 7, "The durable disposition record", "GitHub API recipes"), `disposition-record.md`, and the neighbouring helpers, whose header comments are their contracts.
- `scripts/test-address-review-ping.sh` and `scripts/test-address-review-record.sh` show how a helper is tested against a stubbed `gh`.
- `scripts/test-skill-bundled-files.mjs` and `scripts/test-skill-mirror-parity.mjs` constrain how files and mirrors are added.

## Target files or areas

`plugins/dev-skills/skills/address-review/` and its byte-identical helper copy plus lockstep `SKILL.md` edit under `codex/dev-skills/skills/address-review/`, `plugins/dev-skills/bin/address-review-publish`, `plugins/dev-skills/workflows/wf-address-review.js`, `scripts/`, `.github/workflows/tests.yml`, `README.md`.

## Implementation notes

- Follow the helper contract the neighbours follow: bash 3.2, `key=value` lines with `outcome=` first, exit 0 to proceed, 3 on a stop that needs a decision, 1 on a failure, 64 on misuse; the header comment is the contract and `--help` prints it; every `gh` call names the repository and the PR; committed `100755`.
- Choose a dispositions format that needs no quoting of free text: reply bodies and the Summary are best passed as file paths.
- A publish that fails partway must be resumable: print which threads were replied to and resolved, and make a second run with the same file skip what is already done rather than post a duplicate reply.
- Check that every thread id belongs to the named PR before writing to it. `gh-review-threads.sh` exists because a concurrent GraphQL call once returned another PR's threads; a write to the wrong PR is worse than a read.
- Whether the script also sequences `push`, `record` and `ping` is your call. Prefer the smaller script unless one command removes real prose.

## Acceptance criteria

- A run publishes its thread replies, resolves and Summary comment through `publish.sh`; no hand-run reply or resolve mutation remains in step 7 or in the workflow's publisher brief.
- Step 7 and "GitHub API recipes" together are materially shorter, and nothing a run needs to decide was lost; report the before and after word counts in the PR.
- A second run after a partial failure posts no duplicate.
- A thread id from another PR is refused without a write.
- Both mirrors hold the same script, and the full test set passes.

## Validation

- Run every suite `tests.yml` runs, plus `shellcheck` on the new script and shim.
- Mutation-test each guard in the script: remove it on a throwaway copy, confirm a test fails, restore. Commit before perturbing anything.

## Review plan

Read the new step 7 against the old one and list every rule that disappeared, confirming each is either enforced by the script or deliberately dropped; then read the script for writes that could reach the wrong PR or repeat.
