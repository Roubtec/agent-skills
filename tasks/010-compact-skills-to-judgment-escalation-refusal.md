# 010 — Compact the skills: replace exhaustive outcome matrices with judgment, escalation, or refusal

## Why this task exists

The skills have accreted case analysis that a capable model does not need and that we cannot keep consistent. PR #29 is the worked example, and it is the reason this task exists.

Two real review findings in `address-reviews` were fixed in two rounds. The fix introduced a small mechanism, and keeping that mechanism internally consistent then took **nine further review rounds** and grew `address-reviews/SKILL.md` by 27% (9,515 → 12,092 words). Each round found the same class of defect: a rule was repaired at the site a reviewer pointed at while an identical restatement stayed standing elsewhere — three times *inside the commit that was fixing that very pattern*. The end state was a five-outcome enumeration with precedence rules and a parent-category × descendant-state exit table, restated across roughly eight sites.

That is not bad luck. **A rule restated in eight places will drift**, and every new enumerated case multiplies the sites. The work was reverted to intent level and shipped at +719 words — 72% smaller, closing the same two findings. The abandoned version is preserved on `explore/021-stacked-pr-descendant-state-machine` (`65fe76b`) as reference for what over-specification looks like in this codebase.

The maintainer's framing, which this task encodes: **instead of enumerating every outcome combination, ask the agent to use judgment, reach out to the maintainer, or refuse to continue.** Advice drawn from experience stays — that is not the problem. The matrix is.

This is intended as the next PR, ahead of the queued work, so later tasks build on a better core.

## Scope

Included — all eleven skills in both mirrors, and a lighter pass over the two workflows:

- `address-reviews` (10,234 words), `address-review` (8,529), `address-tasks` (6,991), `address-tasks-serialized` (5,640), `prune-branches` (5,399), `rebase-stack` (4,555), `resolve-open-questions` (4,517) — the primary targets.
- `write-tasks` (1,398), `session-learnings` (1,303), `enable-worktrees` (1,229), `review-tasks` (1,079) — likely already close to right; verify rather than assume.
- `wf-address-review.js` (589 lines), `wf-address-tasks.js` (1,010) — see "Workflows differ" below.

Out of scope:

- **Changing behavior or policy.** This is a compaction, not a redesign. If a rule's substance seems wrong, note it as a follow-up task; do not fix it here. A compaction PR that also changes semantics cannot be reviewed.
- Removing any safety invariant (see the keep list).
- The two mirrors' harness-specific differences — leave them exactly as they are.

## The line to draw

This is the substance of the task. Getting it wrong in either direction is the main risk.

**Keep — compact the wording if you like, never the substance:**

- **Safety invariants.** Never bare `git push --force` (exact-OID `--force-with-lease` only); never force-remove a worktree with uncommitted changes or an in-progress rebase; never `git clean -fdx` against the shared main checkout; fail-closed gates that block rather than guess; never resolve or reply from an unvalidated GraphQL response.
- **The reason behind a counter-intuitive rule.** These exist because an agent reasoning from first principles gets them *confidently wrong*: why representation is tested by patch-id and not raw ancestry; why review threads use single-shot GraphQL and never `--paginate`; why only one checkout-dependent agent may run at a time; why Copilot is re-requested via `gh pr edit --add-reviewer @copilot` and never an `@copilot review` comment; why the boundary-safe PR-URL match cannot be a substring check. Strip the reason and the next editor "simplifies" the rule away.
- **Exact incantations and API recipes.** Commands, flags, and query shapes that are tedious to rediscover and easy to get subtly wrong.
- **Hard-won specifics from real incidents.** Where a rule cites an observed failure, the citation is what makes it credible; keep it, compressed.

**Compact or replace:**

- Enumerated outcome matrices — any passage that assigns an outcome to each combination of two or more condition sets.
- Precedence rules between enumerated outcomes ("outcome 5 takes precedence over outcome 4").
- The same rule restated at more than one site. State it once, at the decision point, and reference it from the others by name.
- Checklist lines that restate a whole rule instead of naming what to verify.
- Coverage for states that may never occur, written at the same weight as states that occur every run.

**Replace with one of three escape hatches**, chosen to fit the situation:

1. **Judgment** — "judge each X on what it actually holds", plus the one or two facts the judgment turns on. Use when a competent reader can reach the right answer from stated principles.
2. **Escalate to the maintainer** — stop and ask, stating exactly what to report so the maintainer can decide quickly. Use when the answer is a policy call, not a technical one.
3. **Refuse to continue** — block, record the reason, change nothing. Use when proceeding under any assumption risks losing work or publishing something wrong.

The three are already the skills' own vocabulary (`skip-and-record`, "stop and ask the maintainer", "fail closed"). This task mostly removes matrices that grew *around* them.

## Workflows differ — compact them less

Skills and workflows are not the same instrument, and the compaction should not treat them alike.

A **workflow** is a deterministic script that drives the happy path efficiently; its structure is the point, and its explicit staging is not micromanagement. Compact only genuine duplication and dead prose there.

A **skill** briefs an agent handling the messier real batch — the fork PR, the branch that diverged, the parent that merged mid-run. That is exactly where enumeration fails and judgment plus the escape hatches wins. Lean harder here.

Where a workflow and its equivalent skill state the same rule, prefer keeping the operational detail in the workflow and the judgment framing in the skill.

## Context and references

- **PR #29** — the case study. Read its "Summary of Review Fixes" comment for the diagnosis, and `explore/021-stacked-pr-descendant-state-machine` for the reverted over-specified version.
- **Task 021a** — already carries the same "define once, reference" constraint from a different angle; keep the two consistent.
- **Task 019** — review-loop convergence and briefing guidance; adjacent, and worth reading before briefing reviewers for this work.
- `AGENTS.md` — one line per paragraph in Markdown; no pre-wrapping.

## Target files or areas

- `codex/dev-skills/skills/*/SKILL.md` and `plugins/dev-skills/skills/*/SKILL.md` (eleven skills, two mirrors).
- `plugins/dev-skills/workflows/wf-address-review.js`, `plugins/dev-skills/workflows/wf-address-tasks.js`.

## Implementation notes

- **Mirror parity is the sharpest hazard in this task.** Every skill exists as two mirrors that must stay byte-identical apart from harness-specific lines (Codex `$skill-name` invocation, `worker`/`explorer` subagents, `claude` vs `codex` peer, Codex-only sections). Record each file's baseline divergence — `diff <codex> <plugins> | grep -c '^[<>]'` — before editing, apply every shared edit to both files with the identical old/new string, assert exactly one match per file, and re-check the count afterwards. Unchanged means parity held. A large compaction touching every file is precisely where hand-editing one side drifts. The mirrors are **not** line-aligned; do not build a positional line map.
- **Work skill by skill, one commit each.** A single commit rewriting eleven files in two mirrors is unreviewable, and per-skill commits let a reviewer check the keep list against one file at a time.
- **Brief reviewers that exhaustive case coverage is out of scope**, explicitly, in the reviewer and peer prompts. Left unbriefed they will generate unenumerated edge cases indefinitely — that is the mechanism that produced the eleven rounds, and it will re-inflate the files during the review of the very PR that compacts them. Say so, and say why.
- Report the word count before and after per skill in the PR description. The number is the deliverable's headline, and it keeps the pass honest.
- Prefer deleting to rewording. A passage that needs three sentences of scaffolding to survive was probably the matrix.

## Acceptance criteria

- Every skill in scope is materially smaller, with the before/after word count recorded per file. No target is imposed — the large skills should lose substantially more than the small ones, and a small skill may legitimately be left alone with a note saying why.
- No safety invariant from the keep list is removed. The implementer states each one and where it now lives.
- Every rule that appeared at more than one site appears once, with the other sites referencing it by name rather than restating it.
- Removed matrices are replaced by one of the three escape hatches, not simply deleted — a state that previously had a stated outcome must still have a stated *disposition*, even if that disposition is "use judgment" or "stop and ask".
- Mirror divergence counts are unchanged for every skill.
- No behavior or policy change. The PR description states this explicitly, and any semantic issue found along the way is filed as a follow-up task instead of fixed here.

## Validation

- `node scripts/test-checkout-cleanliness-report.mjs` exits 0.
- `diff <codex> <plugins> | grep -c '^[<>]'` matches the recorded baseline for all eleven skills.
- Walk at least three known-hazard scenarios from the existing skills against the compacted text and confirm each is still prevented — suggested: a stale remote-tracking ref used as a publication lease, a whole-file `--theirs` conflict resolution discarding auto-merged sibling content, and a reviewer subagent spawned before a fixer's commits landed.

## Review plan

The reviewer's job is the keep list, not case coverage. Confirm that every safety invariant and every stated *reason* for a counter-intuitive rule survived; that no rule is stated in two places; that removed matrices left a disposition behind rather than a gap; and that mirror parity held. The reviewer should be told, in its prompt, that unenumerated edge cases are out of scope and reporting them works against the task — a compaction PR reviewed by the standards that produced the bloat will simply rebuild it.
