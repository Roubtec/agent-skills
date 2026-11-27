# 054 — Trim `address-reviews` "Publication" and "Arguments" to what is batch-specific

## Why this task exists

This is one of a series (053–060) that cuts what a skill costs in context by moving deterministic procedure into bundled scripts and rarely-needed rules into files read on demand; README's "Helpers bundled inside a skill" describes the approach and what PRs #141–#149 already moved.

`address-reviews` is the second-largest skill (about 10,000 words on `main` at `de3b2993`).
Its "Publication" section (about 1,320 words) restates much of what `address-review` step 7 says about a single PR's publish, and its "Arguments" section is still about 2,000 words after #149 moved the target arithmetic into `targets.sh`.
The orchestrator reads all of it on every batch, including the cases a given batch never meets.

**Prerequisite: task 053.**
Once `address-review/publish.sh` exists, a publisher's writes are one call, and this section can say so instead of describing them.

## Scope

Included:

- **"Publication"**: keep what only a batch has (publish-as-ready, parent-before-dependent ordering, the blocked-parent carve-out, the remote-tip refresh at the publication boundary, what a publisher is handed) and replace every restatement of the single-PR publish with a pointer to `address-review` step 7 and its helpers.
- **"Arguments"**: keep the table and the interactions an ordinary batch meets; move the rules that apply only to an unusual combination into a file beside `SKILL.md`, behind a stub whose trigger the orchestrator can evaluate from the arguments it was given.
- **Any deterministic residue** found while doing this goes into `targets.sh` or the script from 053 rather than staying as prose, where that is a small change.

Out of scope:

- Changing any batch behaviour: ordering, gating, descendant invalidation and the refresh guard keep their meaning.
- "Per-PR phased subagents" and "Session Bootstrap"; the latter is task 057.

## Context and references

- `plugins/dev-skills/skills/address-reviews/SKILL.md`, `targets.sh` (its header is its contract), and `address-review/SKILL.md` step 7 as it stands after 053.
- `address-review/disposition-record.md` and `misfired-findings.md` are the model for an on-demand file: the `SKILL.md` keeps a stub saying when to read the file, in full, and the file holds the rules.
- `scripts/test-skill-bundled-files.mjs`: a file another skill owns must be introduced on a line naming that skill.
- Several suites pin clauses in this skill by text (`test-unreviewed-close-carriage.mjs`, `test-subagent-destroy-boundary.mjs`, `test-skill-worktree-base-exclude.mjs`, `test-skill-mirror-parity.mjs`); a clause that moves into another file moves its assertion with it.

## Target files or areas

`plugins/dev-skills/skills/address-reviews/` and its mirror under `codex/dev-skills/skills/address-reviews/`, the suites above where a pinned clause moves, and `README.md` where it describes the skill's files.

## Implementation notes

- A stub's trigger must be something the reader can evaluate without opening the file: "the batch names a rebase target and an entry opts out", not "in complex cases".
- Do not weaken a guard to make it shorter. If a rule exists because of an incident, it stays, in the main file or the on-demand one.
- Edit both mirrors in lockstep; the Codex mirror's harness-specific wording stays its own.

## Acceptance criteria

- "Publication" no longer describes how a single PR's threads, Summary or pings are written; it points at `address-review`.
- Every rule removed from "Arguments" is present in the on-demand file, and the stub names when to read it.
- The PR states the before and after word counts of both sections and of the whole file.
- The full test set passes, with any moved assertion still asserting.

## Validation

- Run every suite `tests.yml` runs.
- For each moved clause, check the suite that pinned it still fails when the clause is deleted from its new home.

## Review plan

Diff the old sections against the new main file plus the on-demand file and account for every sentence: kept, moved, replaced by a pointer, or deliberately dropped with the reason.
