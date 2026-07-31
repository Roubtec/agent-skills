# 021 — Stacked-PR rebase ordering in address-reviews; hunk-level conflict resolution in rebase-stack

## Why this task exists

Two rebase hazards produced wrong-but-plausible results in real batches and are not covered by the skills:

1. **Stacked PRs under a "rebase onto latest main" instruction.** In a kalm2 batch, PR #141 was based on PR #140's branch. A literal reading of "rebase each entry onto latest main" would have replayed #140's commits into #141, making #141's diff re-show the parent's changes. The hazard recurred **after** #140 merged: GitHub landed it under rewritten SHAs, so #141 again showed duplicate commits until a second rebase dropped them by patch-id. `address-reviews` warns about stacked PRs only for fix placement, not for the rebase argument.
2. **Whole-file conflict resolution discarding auto-merged content.** Rebasing a Scribz branch over a merged sibling conflicted in one hunk of `+layout.svelte` while other hunks from the merged PR had auto-merged cleanly elsewhere in the same file. The obvious `git checkout --theirs <file>` would have silently deleted the sibling's shipped behavior from `main` on merge. `rebase-stack` (and the rebase step of `address-review`) say nothing about hunk-vs-file resolution.

## Scope

Included:

- `address-reviews` (rebase step): when one batch entry's base branch is another entry's head, rebase the **base first**, then restack the dependent onto the rebased base — never onto the pinned target directly. After a parent PR merges mid-batch, treat a dependent's restack as **required, not optional**, because the merged commits may land under different SHAs (rely on patch-id dropping; verify the dependent's diff no longer shows parent content).
- `rebase-stack` + the single-PR rebase guidance in `address-review`: resolve conflicts **by hunk, in place**; `--ours`/`--theirs` on a whole file is safe only after verifying the file contains no cleanly-auto-merged content from the other side (inspect the merged result for non-conflicted additions first). One sentence naming the silent failure mode: whole-file resolution can delete a sibling's already-shipped behavior with no conflict marker left behind.
- `address-reviews` (publish/apply boundaries): re-fetch and re-verify PR/merge state before acting on state captured earlier in a long run — humans merge PRs mid-batch, and both hazards above fire exactly then.

Out of scope: rebase mechanics that already work (patch-id duplicate dropping is git behavior, not skill text), lease-push rules (already specified).

## Context and references

- `plugins/dev-skills/skills/address-reviews/SKILL.md` — the batch-entry rebase instruction and the existing stacked-PR fix-placement warning to extend.
- `plugins/dev-skills/skills/rebase-stack/SKILL.md` — the per-branch replay loop where conflict-resolution guidance belongs (it already handles dropping merged commits; the gap is the resolution rule).
- `plugins/dev-skills/skills/address-review/SKILL.md` — optional-rebase step mirror.
- Codex-side mirrors under `codex/dev-skills/skills/`.

## Target files or areas

- `address-reviews/SKILL.md`, `rebase-stack/SKILL.md`, `address-review/SKILL.md`, codex mirrors.

## Implementation notes

- Keep each addition to 2–4 sentences at the exact decision point; the batch skill should detect the stacked case from PR data it already fetches — one entry's base **repository and ref** matching another entry's head **repository and ref** — and name that check concretely. Compare the pair, not the two short branch names: a fork PR's head branch can share a name with some other entry's base while living in a different repository, and a PR in the base repository cannot target a fork's branch at all, so a name-only match declares an unrelated pair a stack and the base-first rule then rebases the supposed dependent onto a foreign tip.
- Do not prescribe `git rerere` or tooling changes; this is decision guidance.

## Acceptance criteria

- The batch rebase instruction explicitly orders base-before-dependent and mandates post-merge restacks with the SHA-rewrite rationale. The stacked-case check it names matches repository **and** ref on both sides, so two entries sharing only a branch name across different repositories are not treated as a stack.
- Both rebase-executing skills carry the hunk-vs-whole-file rule with the auto-merged-content check.
- The publish/apply-boundary re-verification sentence exists in the batch skill.

## Validation

- Mental walkthrough of the kalm2 #140/#141 scenario and the Scribz layout-file scenario against the new text: each now has an explicit instruction preventing the observed wrong outcome.

## Review plan

Reviewer confirms the stacked-case detection is stated in terms of data the skill already gathers, and that the conflict rule cannot be read as banning `--ours`/`--theirs` outright (it is a verify-first rule).
