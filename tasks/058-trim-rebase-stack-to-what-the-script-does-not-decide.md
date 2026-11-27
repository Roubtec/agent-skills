# 058 — Trim `rebase-stack` to what `stack.sh` does not decide

## Why this task exists

This is one of a series (053–060) that cuts what a skill costs in context by moving deterministic procedure into bundled scripts and rarely-needed rules into files read on demand; README's "Helpers bundled inside a skill" describes the approach and what PRs #141–#149 already moved.

`rebase-stack` got `stack.sh` early in that work, and its `SKILL.md` is still about 5,170 words on `main` at `de3b2993`.
"Step 4 — Linear-run fast path and per-branch rebase loop" is about 1,180 of them and was written around the script rather than rewritten for it, so it is likely to explain decisions that `stack.sh qualify`, `snapshot`, `verify` and `restore` now make.
Two more sections apply only in a case most runs never meet: "Delegated unattended mode" (about 440 words) and "Step 5 — Conflict handling" (about 730).

## Scope

Included:

- **Audit step 4 against `stack.sh`**: for each sentence, decide whether the script already enforces it. What the script decides is cut down to the call and how to act on each outcome; what is still judgement stays.
- **Move "Delegated unattended mode" and "Step 5 — Conflict handling" into files beside `SKILL.md`**, each behind a stub with an evaluable trigger: the run was invoked by another skill with the delegated form, or a rebase stopped on a conflict.
- **"Step 3 — Present the confirmation listing"** (about 550 words): if the listing can be printed by the script from what `detect` and `segments` already know, add that; if the listing needs judgement the script lacks, leave the section alone and say so in the PR.

Out of scope:

- Changing what a run does: chain detection, the fast path's qualification, the snapshot refs and the stop conditions keep their meaning.
- `address-review`'s and `review-cycle`'s own rebase steps.

## Context and references

- `plugins/dev-skills/skills/rebase-stack/SKILL.md` and `stack.sh`, whose header comment is its contract (`stack.sh --help`).
- `scripts/test-rebase-stack.sh` covers the script; README's `test-rebase-stack.sh` entry says when to run it.
- `review-cycle`'s "The delegated rebase step" and `rebase-brief.md` are the callers of the delegated form; a moved section must still be reachable from what they cite.
- `address-review/misfired-findings.md` shows the stub-and-file pattern.

## Target files or areas

`plugins/dev-skills/skills/rebase-stack/` and `codex/dev-skills/skills/rebase-stack/`, `scripts/test-rebase-stack.sh` if the script gains a command, any `SKILL.md` or brief that cites a moved section, `README.md` where it lists the skill's files.

## Implementation notes

- Read `stack.sh` before reading step 4, so the audit asks "does the script do this" rather than "does this sound mechanical".
- The conflict file must be read in full the first time a rebase stops, including in a delegated run, where nobody can be asked; say so in the stub.
- A new script command follows the existing contract and gets tests with a mutation check on each guard.
- Keep the headings other files cite, as stubs.

## Acceptance criteria

- Step 4 states each `stack.sh` call once, with what to do on each outcome, and does not restate a check the script makes.
- A run with no conflict that was not delegated reads neither on-demand file.
- Every rule from the three sections is in the main file, an on-demand file, or enforced by the script; the PR lists any sentence dropped and why.
- The PR states the before and after word counts of `SKILL.md`.
- The full test set passes.

## Validation

- Run every suite `tests.yml` runs, and `shellcheck` if the script changed.
- In a disposable clone (`dc-enter`), restack a three-branch chain by following only the new text, once cleanly and once with a planted conflict, and report whether anything had to be looked up in the old text.

## Review plan

For each sentence cut from step 4, point at the line of `stack.sh` that enforces it; anything without such a line was dropped and needs a reason.
