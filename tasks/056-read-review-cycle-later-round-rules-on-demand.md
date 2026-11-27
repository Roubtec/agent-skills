# 056 — Read the `review-cycle` rules for later rounds, escalation and rebase only when they apply

## Why this task exists

This is one of a series (053–060) that cuts what a skill costs in context by moving deterministic procedure into bundled scripts and rarely-needed rules into files read on demand; README's "Helpers bundled inside a skill" describes the approach and what PRs #141–#149 already moved.

`review-cycle/SKILL.md` is about 8,400 words on `main` at `de3b2993`, and every skill that runs a cycle reads all of it before the first round.
Most cycles converge in one or two rounds without a rebase or an open question, yet the reader has already paid for "The loop and its gates" (about 1,600 words, much of it round caps and stall rules), "Escalation: open questions" (about 900), "The delegated rebase step" (about 1,080) and "Roles" (about 1,100), part of which the role briefs beside the file now repeat.
Splitting by when a rule is needed is what took `address-review` from 14,852 words to 10,956.

## Scope

Included:

- **Sort each of those four sections by when its rules are needed**: before round one, from round two on, on a stall or a cap, when a finding is escalated, when a rebase is delegated.
- **Keep the first group in `SKILL.md`** and move the rest into files beside it, each behind a stub whose trigger the orchestrator can evaluate ("a second reviewer round is about to start", "a finding is to be escalated", "the caller delegated a rebase").
- **Remove from "Roles" what `reviewer-brief.md`, `fixer-brief.md`, `peer-brief.md` and `rebase-brief.md` already tell the role itself**, keeping what the orchestrator needs in order to spawn and brief each one.
- **Update every citation.** Other skills and the workflows cite these sections by name (for example `review-cycle` → "The delegated rebase step", and "every rule that skill states under *The peer step*"); each citation must still lead to the rule.

Out of scope:

- "The peer step", which is task 055. The two tasks edit different sections of one file: land 055 first, or rebase this one over it.
- Changing a rule: caps, the fresh-spawn rule, the disposition rule and the escalation format keep their meaning.
- "Disposing findings — how the cycle ends" stays in the main file unless part of it clearly belongs to a rare case.

## Context and references

- `plugins/dev-skills/skills/review-cycle/` in full, including the four briefs.
- The consumers: `address-review`, `address-reviews`, `address-tasks`, `address-tasks-serialized`, `write-tasks`, `merge-train` and `resolve-open-questions` cite the cycle; grep both trees for `review-cycle` before moving a heading.
- `scripts/test-review-cycle-retirement.mjs`, `test-subagent-destroy-boundary.mjs`, `test-skill-mirror-parity.mjs` and `test-skill-bundled-files.mjs` pin text and structure here.
- `address-review/disposition-record.md` and `address-tasks/review-stack.md` show the stub-and-file pattern.

## Target files or areas

`plugins/dev-skills/skills/review-cycle/` and `codex/dev-skills/skills/review-cycle/`, every `SKILL.md` and workflow that cites a moved section, the suites above, `README.md` where it lists the skill's files.

## Implementation notes

- Keep a moved section's heading in `SKILL.md` as the stub's heading where other files cite it by name; that keeps most citations valid without an edit.
- A rule needed before round one must not sit behind a later trigger. The round cap itself is such a rule if a caller may lower it at launch; what happens on reaching it is not.
- A stub says to read the file in full; a half-read rules file is worse than a long section.
- The Codex mirror moves the same rules into the same-named files; only its harness wording differs.

## Acceptance criteria

- A cycle that converges in one round with no rebase and no escalation reads none of the on-demand files.
- Every rule from the four sections is present in the main file, an on-demand file or a brief; none exists in two places.
- Every citation of a moved section in either tree and in the workflows still resolves.
- The PR states the before and after word counts of `SKILL.md` in both mirrors.
- The full test set passes, with any moved pinned clause still asserted.

## Validation

- Run every suite `tests.yml` runs.
- Grep both trees and the workflows for each old heading and confirm what each hit now points at.
- For each pinned clause that moved, confirm its suite fails when the clause is deleted from its new home.

## Review plan

Account for every sentence of the four old sections (kept, moved, already in a brief, deliberately dropped), then walk one ordinary cycle and one stalled cycle through the new text to confirm each rule is met before it is needed.
