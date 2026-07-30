# 016 — Rebase-onto-base by default in address-review(s), with a delegated rebase step

## Why this task exists

The maintainer's repos use rebase-then-merge: linear default branches whose merge commits are parented by the previous merge commit and the PR tip. Keeping a batch of in-flight PRs continuously rebased onto the advancing base is currently manual toil between review rounds, and the skills only rebase when explicitly asked. Rebasing EARLY means the fixer works on the code as it will look when merged; rebasing again PRE-PUSH means reviewers (human and bot) see a minimal diff against the current base right when the PR may become mergeable. Both are often no-ops and cheap; when they are not, they are exactly the work the maintainer does by hand today.

## Scope

Included:

- **Opt-out default**: `address-review` and `address-reviews` rebase each entry onto its freshest base (its PR base branch, freshly fetched) unless the invocation passes `no-rebase` (e.g. `address-reviews 123 412 ping-codex no-rebase`). The existing explicit `rebase on top of <branch>` token still forces a specific target.
- **Two rebase points**: before triage/fixing, and after fixes before the final review and push. In the prose skills the agent may judge a point unnecessary (e.g. base unchanged); in `wf-address-review` both points are unconditional (no-ops are cheap and deterministic).
- **Ordering**: the pre-push rebase happens BEFORE the final reviewer round, so the passing verdict always applies to the exact tree being pushed; a build plus the project's test suite runs after any non-noop rebase.
- **Delegated rebase step**: rebasing runs in a subagent (never the orchestrator) with a compact brief — the "rebase nugget", specified once and referenced by both skills and the workflow, the same extraction shape as the review cycle of [014](014-extract-review-cycle-building-block.md). It resolves conflicts within its competence using the hunk-level rules of [021](021-stacked-pr-rebase-and-conflict-resolution-guidance.md), and when resolution genuinely needs maintainer input it halts that entry and returns the question through the `openQuestions[]` ferry rather than guessing.
- **Stack awareness**: the nugget maintains a parent map for the batch (each entry's PR base ref). Entries rebase in topological order: a parent onto the true base first, then each child onto its parent's NEW tip (`git rebase --onto <newParentTip> <oldParentTip>`), with patch-id dropping of commits the base already carries per 021. This also covers the leafy-stack case where a parent gained fix commits mid-run and its child still sits on the old parent tip.
- After any rebase, delegation ranges use stable refs, never pre-rebase SHAs (019 item 6 applies). The ref is the entry's **effective base** — its actual PR base ref (or, for a stacked entry, its parent's new tip), pinned at the moment the rebase completes to the **OID actually rebased onto**, or to an immutable snapshot ref created from it — delegated as `<effective-base>..HEAD`. Record the commit, never a movable remote-tracking name: `origin/<base>` advances whenever a sibling entry or a later fetch moves the base, and the range then resolves against a tip this branch was never rebased onto, so the final reviewer sees unrelated commits (some in reverse) or loses the intended boundary entirely — while the branch it is judging still sits on the old base. Do not hard-code `origin/main`: this task explicitly supports arbitrary PR bases and stacked entries, and on those a `origin/main..HEAD` range hands the reviewer unrelated commits or the wrong parent boundary, so a verdict can be rendered on a diff that is not the entry's own.

Out of scope:

- Whole-chain restacks after merges — that remains `rebase-stack`; the nugget handles single-entry-onto-moving-base with parent awareness, and points at `rebase-stack` when it detects a full-chain restack is what is actually needed.
- Mid-run base advancement caused by in-batch early merges (that integration lands with [033](033-vertical-task-pipelining.md), which reuses this nugget).

## Context and references

- **Sequencing**: implement AFTER [012](012-adopt-powbox-skills-and-workflows.md), which creates `plugins/dev-skills/workflows/` and the `wf-address-review.js` this task edits, and AFTER [014](014-extract-review-cycle-building-block.md), which establishes where the rebase nugget is placed.
- [021](021-stacked-pr-rebase-and-conflict-resolution-guidance.md) — the correctness guidance (stacked ordering hazards, hunk-vs-file conflict resolution, patch-id) this task turns from advice-on-request into default behavior; implement 021's text first or together, and reference rather than restate it.
- `plugins/dev-skills/skills/address-review/SKILL.md` — the existing optional `rebase on top of <branch>` token and its flag parsing; `wf-address-review.js` — the flag-parsing block and pipeline where the two rebase points slot in.
- [014](014-extract-review-cycle-building-block.md) — the `openQuestions[]` ferry the halted-conflict path reports through.

## Target files or areas

- `plugins/dev-skills/skills/{address-review,address-reviews}/SKILL.md`, `plugins/dev-skills/workflows/wf-address-review.js`, a shared rebase-nugget reference (place it where 014 puts the review-cycle protocol), Codex mirrors.

## Implementation notes

- Parent-map tracking must stay cheap to codify: one `gh pr view` per entry for its base and head **repository plus ref** (not the branch names alone — the parent/child match is the repo-qualified comparison 021 specifies) plus recording each parent's pre- and post-rebase tips; resist reimplementing `rebase-stack`.
- `no-rebase` is per-invocation, not a per-entry parameter; per-entry exclusions are expressed in invocation prose ("rebase everything except branch `special/snowflake`") and honored as ordinary instructions — no flag syntax needed.
- Force-pushes after rebase follow the existing exact-lease rules already in the skills (never bare `--force`).

## Acceptance criteria

- Default runs rebase at both points; `no-rebase` suppresses both; the explicit rebase token still works.
- The final reviewer verdict is always rendered on the post-rebase tree; build+tests run after every non-noop rebase.
- Delegated diff ranges name the entry's effective post-rebase base, so an entry whose PR targets something other than `main` — or that is stacked on another PR — is reviewed against its own diff. That base is pinned to the OID rebased onto (or an immutable snapshot of it), so a base advancing later in the run cannot retarget an already-delegated range.
- Stacked entries rebase in topological order and the leafy-stack case produces a child based on the parent's new tip without duplicated parent commits.
- A conflict beyond the nugget's competence halts that entry with an open question; other entries proceed.

## Validation

- Replay the kalm2 #140/#141 scenario from 021 against the new default: the child never re-shows parent commits at either rebase point.
- A batch with an intentionally conflicting entry: the entry halts with a question, siblings deliver.

## Review plan

Reviewer checks the two rebase points cannot double-apply (idempotent no-ops), that stacked ordering is derived from PR base refs rather than assumed, and that the nugget's halt path never leaves a worktree mid-rebase.
