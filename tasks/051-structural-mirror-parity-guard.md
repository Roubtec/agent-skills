# 051 — Guard the skill mirrors' structure so a one-sided edit fails CI

## Why this task exists

Every skill ships twice — `plugins/dev-skills/skills/<name>/SKILL.md` and `codex/dev-skills/skills/<name>/SKILL.md` — hand-edited in lockstep with no generator between them.
The only thing standing between that arrangement and silent drift is a ritual: each PR touching a skill re-measures the pair and asserts in its summary that the divergence is unchanged ("both mirrors in lockstep; mirror divergence unchanged at 40 lines").
A number recited by the author of the change is not a check. It catches nothing when the author forgets, and it is exactly as strong on the round where a rule was added to one mirror and dropped from the other as on the round where nothing moved.

The guards that do exist are clause-scoped by design and do not cover this: `test-resolve-tasks-contract.mjs` asserts byte identity for the `resolve-tasks` mirrors and for each consumer's preflight block, `test-skill-worktree-base-exclude.mjs` asserts it for three named steps, and `test-subagent-destroy-boundary.mjs` runs a census of specific clauses across every `SKILL.md` in either tree.
Each pins a clause someone already knew to worry about. None would notice a whole numbered step, bullet, or section appearing in one mirror and not the other.

Whole-file byte parity is not the answer and never will be: the mirrors legitimately differ in prose, because they address different harnesses — `Agent`/`subagent_type: "general-purpose"` against `worker`/`explorer` subagents, a `codex` peer against a `claude` peer, `write-tasks` against `$write-tasks`. Structure is the part that should not differ, and today it very nearly does not.

## Scope

Included:

- **A new suite, `scripts/test-skill-mirror-parity.mjs`**, run over every skill present in either tree. For each pair it asserts:
  - the same skill exists in both trees (a skill added to one only is the loudest possible drift and currently fails nothing);
  - the ordered sequence of headings — level and text — matches;
  - within each section, the count of ordered-list items and of top-level bullets matches.
- **A declared allowlist for legitimate structural divergence**, checked in beside the suite as data, with a one-line reason per entry. An entry names the skill and the specific heading or section it excuses. Divergence not named there fails; an allowlist entry whose divergence has since disappeared fails too, so the list cannot rot into a list of things that used to be true.
- **Wire it into `.github/workflows/tests.yml`** and give it a subsection under README's *Focused tests*, in that section's established shape: the command first, then the change that obliges you to run it.
- **The `scripts/` map in README's Layout block** gains its line.

Out of scope:

- Byte-level or line-count parity of any kind, and any attempt to pin the divergence *count* — the number the current ritual recites. It is the wrong instrument: it moves for every legitimate reword and holds still for a swapped pair of one-sided edits.
- Any prose change to the mirrors to make them structurally agree. If the suite finds a real asymmetry, that is a finding for its own task, reported and left alone here — this task ships the instrument, not the repairs. A divergence that turns out to be legitimate goes in the allowlist with its reason.
- Building a generator, or any move toward one. The mirrors stay hand-edited; this measures them.
- The workflow scripts, whose `review-cycle-core` byte identity is already asserted by `test-review-cycle-retirement.mjs`.

## Context and references

- `plugins/dev-skills/skills/` and `codex/dev-skills/skills/` — fourteen skills in each tree today.
- `scripts/test-resolve-tasks-contract.mjs` (checks "resolve-tasks skill mirrors are byte-identical" and the per-consumer "preflight is byte-identical across mirrors"), `scripts/test-skill-worktree-base-exclude.mjs`, and `scripts/test-subagent-destroy-boundary.mjs` — the three clause-scoped guards this suite sits beside rather than replaces. Read what each already covers before adding a check; a second spelling of an existing assertion is worse than no assertion.
- README's *Focused tests* section, whose per-suite shape task 046f established.
- Task 019 established the pattern for carrying one rule into every derived rendering; this task guards the shape of those renderings rather than restating the rule.

## Target files or areas

`scripts/test-skill-mirror-parity.mjs` (new), `.github/workflows/tests.yml`, `README.md`. No `SKILL.md` is edited by this task.

## Implementation notes

- **Measured starting point, as of this task's authoring on `main` at `e14ced7`:** heading text is already identical across mirrors for 10 of the 14 skills. `address-review`, `address-reviews`, `address-tasks`, and `address-tasks-serialized` differ by exactly one heading each, and `review-cycle` by four. These are line-free numbers, so they are quotable, but re-derive them rather than trusting them — the point of the suite is that nobody's recited count is authoritative.
- Inspect what those five divergences actually are before writing a single allowlist entry. The single-heading cases look like the Codex trees' explicit-invocation line; `review-cycle`'s four are the provider-specific peer-launch structure. Each entry's reason should name the harness difference that produces it, so a reader can tell a legitimate divergence from one nobody has looked at yet.
- Keep the allowlist small and reasoned. The failure mode to avoid is the one PR #29 spent eleven rounds learning: an instrument that grows into an exhaustive state table stops being read. If the allowlist needs more than a handful of entries, that is evidence the structural comparison is drawn at the wrong granularity — loosen the comparison rather than enumerating exceptions.
- Parse structure from the Markdown rather than by matching known strings: the suite's whole value is catching a heading nobody anticipated.
- Failures must name the skill, the heading, and which mirror holds the extra or missing element. A parity failure that reports only a count reproduces the ritual this replaces.
- The suite reads files and needs no network, no `gh`, and no repository writes; keep it hermetic like its neighbours so it runs anywhere `node` does.

## Acceptance criteria

- `node scripts/test-skill-mirror-parity.mjs` passes on `main` as it stands, with every divergence either absent or named in the allowlist with a reason.
- Deleting a numbered step, a bullet, or a section heading from one mirror only fails the suite, and the failure names the skill, the element, and the side.
- Adding a new skill to one tree only fails the suite.
- Removing an allowlist entry whose divergence still exists fails; keeping one whose divergence no longer exists also fails.
- Rewording a paragraph in one mirror to match its harness — without changing the structure — passes.
- The suite runs in `tests.yml` and is documented in README's *Focused tests* and `scripts/` map.

## Validation

- Run the full `tests.yml` script set; all pass.
- Prove the guard by breaking it deliberately before believing it: on a throwaway copy, delete one numbered step from a single mirror and confirm the suite fails naming that step, then restore it and confirm it passes. Commit the implementation before any such perturbation, and never let a `git restore` reach a file holding uncommitted work.
- Do the same for a skill present in one tree only, and for a stale allowlist entry.

## Review plan

Reviewer checks that the suite fails for each of the acceptance criteria's break cases rather than only passing on a clean tree, that it does not duplicate an assertion the three existing clause-scoped suites already make, that no check rests on the divergence count, that every allowlist entry names a harness reason a reader can verify, and that no `SKILL.md` was edited to make the guard pass.
