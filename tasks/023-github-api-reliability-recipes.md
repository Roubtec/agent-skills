# 023 — GitHub API reliability recipes for the review skills

## Why this task exists

Agents repeatedly lose turns to a small set of GitHub CLI/API behaviors that look like failures but aren't (or vice versa). Each was independently rediscovered — some by three separate subagents in one session — and each has a one-line reliable recipe the skills can carry.

## Scope

Add a compact "GitHub API notes" block (or inline notes at the step that hits each) covering:

1. **Push verification.** Immediately after a (force-)push, `gh pr view --json headRefOid` can return the *old* head. Verify pushes against `git ls-remote` (or a fresh `git fetch`), not the PR API.
2. **Reviewer-request verification.** After `gh pr edit --add-reviewer @copilot` (or `@codex`), GraphQL-backed `gh pr view --json reviewRequests` reads back empty while REST `GET /pulls/<n>/requested_reviewers` (or the timeline's `review_requested` event) shows the request; GraphQL also empties as the bot picks the request up. Treat REST/timeline as authoritative; do not re-issue the request on an empty GraphQL read.
3. **Check-status polling.** In `gh pr view --json statusCheckRollup`, in-progress checks have `conclusion: ""` (empty string, not null), so jq `//` fallbacks like `.conclusion // .status` never fall through and a poll loop exits early reporting checks settled. Poll on `.status != "COMPLETED"`; read `.conclusion` only once `.status == "COMPLETED"`.
4. **Merging with `--delete-branch` while a worktree holds the branch.** `gh pr merge --merge --delete-branch` merges and deletes the remote branch, then errors on the local delete ("used by worktree") — a non-zero exit after a successful merge. Either remove the worktree first or omit the flag and clean up explicitly; on that error, verify merge state before retrying anything.
5. **Re-verify at publish/apply boundaries.** (Cross-reference to the same rule task 021 adds): PR/merge state captured earlier in a long run is stale; re-fetch before replying, resolving, or pushing.

Out of scope: `gh-review-threads` internals (task 013), rate-limit handling, auth.

## Context and references

- `plugins/dev-skills/skills/address-review/SKILL.md` — publish step (push + reply/resolve + re-ping) is where items 1, 2, 5 anchor; CI-wait guidance if present anchors item 3.
- `plugins/dev-skills/skills/address-tasks/SKILL.md` — PR-open/merge steps anchor item 4.
- Codex-side mirrors.
- All five behaviors were observed on github.com with current `gh` during July 2026 sessions (items 1–2 on multiple PRs each); they are eventual-consistency artifacts, so recipes say "verify via X", not "wait N seconds".

## Target files or areas

- `address-review/SKILL.md`, `address-reviews/SKILL.md`, `address-tasks/SKILL.md` (+ serialized variant if it owns merge steps), codex mirrors.

## Implementation notes

- Prefer one shared block per skill over five scattered warnings where the skill structure allows; keep total addition ~10–15 lines per skill.
- Word each recipe as the positive instruction (what to trust) rather than a bug narrative.

## Acceptance criteria

- Each of the five behaviors has exactly one authoritative recipe in the skill(s) whose step encounters it.
- No recipe contradicts existing skill text (e.g. the lease-push verification flow).

## Validation

- Grep for `headRefOid`, `reviewRequests`, `statusCheckRollup`, `--delete-branch` across the skills — each hit sits next to its recipe.

## Review plan

Reviewer checks the recipes are stated as verification procedures (trust X over Y) and anchored at the steps that perform the operations, not in a detached appendix nobody reads mid-run.
