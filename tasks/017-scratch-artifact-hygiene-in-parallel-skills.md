# 017 — Scratch-artifact hygiene for parallel runs: unique names, worktree-local paths, post-batch cleanliness

## Why this task exists

Concurrent subagents in one session share a single scratchpad directory, and the parallel skills have silently bled data across isolation boundaries three separate times:

- two parallel `address-review` fixers both wrote review threads to a fixed `threads.json`; one triaged with the other PR's data and was saved only by the per-comment URL scope check (jabko, 6-PR batch; recurred in a kalm2 batch);
- two parallel reviewers both redirected `pnpm verify` output to `<scratchpad>/verify.log`; one read the other worktree's results and reported a validation verdict for the wrong branch — caught only because the file count didn't match (Scribz);
- the Scribz incident was then **misdiagnosed** as a working-directory bug, and the wrong mitigation propagated to ~10 subsequent subagent prompts before being root-caused to the filename collision.

Separately, `address-tasks` batches have leaked stray files into the shared main checkout (an implementer wrote to the repo root instead of its worktree; the strays survived to the end of the run), and nothing in the skill asserts the main checkout ends clean.

## Scope

Included:

1. **Unique-name rule** in every skill that runs parallel subagents (`address-reviews`, `address-tasks`, and `address-review` when invoked as a batch member): any scratch artifact a subagent writes outside its own worktree MUST be namespaced by its task identity — PR number, worktree slug, or `$$` — or live in a per-task subdirectory the orchestrator hands it. Name the two observed collisions (`threads.json`, `verify.log`) as the canonical counterexamples. Prefer redirecting validation output to a file **inside the assigned worktree** (gitignored or cleaned before commit) over the shared scratchpad.
2. **`address-review` internal artifacts**: everywhere the skill's own recipe names a scratch file (review threads dump, verify logs, prompt files), bake the PR number into the documented filename (`threads-<PR#>.json`) so even single-PR guidance is collision-proof by default. The URL scope-check stays as backstop, not primary defense.
3. **Post-batch cleanliness assertion** in `address-tasks`/`address-tasks-serialized`: once every batch entry has reached **any terminal state**, the orchestrator reads the main checkout's working-tree state and compares it against a reading of the same shape taken at batch start; keyed by path, so that a status code changing under one path reads as a re-classification rather than as one path vanishing and another appearing; paths that appeared are a loud finding in the final report, paths that disappeared are a louder one — a stray `checkout`/`clean` in the shared tree eating a co-tenant's uncommitted work is the hazard the implementation notes warn about, and only a baseline can see it — though reported as something to check against co-tenant commits rather than as established loss, since a maintainer committing their own work mid-run also removes a baseline path and nothing is gone. The rest are reported as pre-existing (diff strays against delivered branches before touching them — another agent's uncommitted work is not ours to delete). Take a baseline rather than testing for emptiness: the bootstrap deliberately permits the maintainer's own uncommitted work in the main checkout, so an unconditional non-empty rule both blames the batch for work it never touched and destroys the one signal that tells a real stray from the tree's starting state. Specify what the assertion **claims** rather than how to compute it. The obvious computation — diffing two `git status --porcelain` outputs line by line — misreports in both directions, in more ways than this spec can usefully close, and successive review rounds each found a fresh one: a path that already carried an entry at bootstrap absorbs any volume of later writes behind an identical line, ignored paths lie outside `status` altogether while item 1 above actively steers scratch output into them, and a maintainer staging or committing mid-run rewrites baseline lines with nothing lost at all. So state the rule as an **exclusion rather than an enumeration**: the check reports what it can see change, and claims nothing about *what was written to* paths already present in the baseline, nor about paths invisible to the reading it takes. Reporting that such a path was re-classified is an observation it can make; asserting it was left alone is not. Bound it in the other direction too: what it does surface is a report to verify, not a conclusion, because the same reading cannot tell a stray from a co-tenant's ordinary progress. It is a report obligation, never a proof that the batch wrote nothing, and must not be delivered as one. An implementer who widens what it can see — listing untracked files individually, extending the reading to ignored paths — improves the report and must leave that claim exactly as narrow. Trigger it unconditionally on batch termination, not on "the last task delivers": a batch where every task blocks, fails, or aborts never reaches a delivery, so gating on one skips the check exactly when it matters most — a failed implementer is at least as likely to have leaked strays, and the report would otherwise close out clean without surfacing them.
4. **Diagnosis discipline** one-liner in the batch skills: a subagent's environment/infrastructure diagnosis is a hypothesis, not a finding — verify against its transcript (bounded greps for the specific commands it claims it ran) before propagating any mitigation to sibling prompts.

Out of scope:

- Harness-level per-subagent scratchpad namespacing (upstream Claude Code concern).
- powbox container-doc wording (tracked as powbox task 045).

## Context and references

- `plugins/dev-skills/skills/address-review/SKILL.md` — thread-fetch and validation recipes naming scratch files.
- `plugins/dev-skills/skills/address-reviews/SKILL.md`, `address-tasks/SKILL.md`, `address-tasks-serialized/SKILL.md` — orchestrator prompt templates where the rule and the cleanliness assertion belong.
- `codex/dev-skills/skills/*` — mirror where the same recipes exist.

## Target files or areas

- The four Claude-side skill files above, plus codex-side mirrors.

## Implementation notes

- Keep it terse: one rule statement plus the counterexamples where subagent prompts are specified; do not add a lecture to every section.
- The cleanliness assertion is a REPORT obligation, not an auto-clean: the skill must not instruct `git clean`/`checkout` on the shared main tree (that is exactly the co-tenant hazard powbox's shared-surfaces guidance warns about).

## Acceptance criteria

- No skill documents a fixed-name scratch file for anything a parallel subagent writes; `threads-<PR#>.json`-style naming appears in the recipes.
- Batch skills instruct orchestrators to hand each subagent a unique scratch location (or require worktree-local output) in the subagent prompt template.
- `address-tasks` (both variants) ends with the main-checkout cleanliness check and the report-don't-clean rule, and runs it on every batch termination — including zero-delivery and aborted batches — not only when a task delivered. It compares against a baseline captured at batch start, so a checkout already dirty at bootstrap does not read as batch leakage and a vanished baseline **path** is surfaced rather than passing silently — keyed by path, so a status-code change (a co-tenant staging their own work) reads as a re-classification rather than as one path vanishing and another appearing.
- The delivered text states the check as a report obligation whose claim excludes what was written to paths already present in the baseline, and paths its reading cannot see, rather than as an assurance the batch left the tree untouched. A text presenting it as a completeness guarantee fails this criterion whatever comparison it prescribes, and one that instead enumerates a closed list of blind spots fails it too — the exclusion is the point, since the list is open.
- The hypothesis-not-finding line is present in the batch skills.

## Validation

- Grep the skills for `threads.json` / `verify.log` / other fixed scratch names — none remain unqualified.
- Walk one `address-reviews` dry run mentally (or live on two disposable PRs) confirming two concurrent fixers cannot share a filename under the documented recipe.

## Review plan

Reviewer enumerates every scratch-file mention across the four skills named above and checks each is either worktree-local or identity-namespaced, and that the cleanliness step cannot be read as license to clean the shared checkout.
