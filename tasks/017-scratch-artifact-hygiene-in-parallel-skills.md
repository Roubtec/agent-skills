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
3. **Post-batch cleanliness assertion** in `address-tasks`/`address-tasks-serialized`: once every batch entry has reached **any terminal state**, the orchestrator runs `git -C <main-checkout> status --porcelain --untracked-files=all` and compares it against the same reading taken at batch start; entries the run introduced are a loud finding in the final report, entries that vanished are a louder one (a stray `checkout`/`clean` in the shared tree eating the maintainer's work is the co-tenant hazard below, and only the baseline can see it), and entries present in both are reported as pre-existing (diff strays against delivered branches before touching them — another agent's uncommitted work is not ours to delete). Take the baseline, don't just test for emptiness: the bootstrap deliberately permits the maintainer's own uncommitted work in the main checkout, so an unconditional non-empty rule both blames the batch for work it never touched and destroys the one signal that tells a real stray from the tree's starting state. Two limits belong in the text rather than in an implementer's assumptions, because a line-wise comparison of two porcelain readings under-reports by construction. `--untracked-files=all` is load-bearing: the default collapses an untracked directory to one `?? dir/` entry, so a subagent writing into a directory that was already untracked at bootstrap produces a byte-identical line and lands in the pre-existing bucket. And a tracked path already modified at bootstrap keeps its ` M path` line however much the batch then writes to it, which no status-code comparison can decompose — so such a path is reported as pre-existing **and not verified clean of batch writes**, never as a path the check has cleared. Trigger it unconditionally on batch termination, not on "the last task delivers": a batch where every task blocks, fails, or aborts never reaches a delivery, so gating on one skips the check exactly when it matters most — a failed implementer is at least as likely to have leaked strays, and the report would otherwise close out clean without surfacing them.
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
- `address-tasks` (both variants) ends with the porcelain check and the report-don't-clean rule, and runs it on every batch termination — including zero-delivery and aborted batches — not only when a task delivered. It reports against a baseline captured at batch start, so a main checkout that was already dirty at bootstrap does not read as batch leakage, and it states the comparison's two blind spots — untracked-directory collapse, defeated by listing untracked files individually, and further writes to an already-modified path, which is bounded by reporting such paths as unverified rather than clear.
- The hypothesis-not-finding line is present in the batch skills.

## Validation

- Grep the skills for `threads.json` / `verify.log` / other fixed scratch names — none remain unqualified.
- Walk one `address-reviews` dry run mentally (or live on two disposable PRs) confirming two concurrent fixers cannot share a filename under the documented recipe.

## Review plan

Reviewer enumerates every scratch-file mention across the four skills named above and checks each is either worktree-local or identity-namespaced, and that the cleanliness step cannot be read as license to clean the shared checkout.
