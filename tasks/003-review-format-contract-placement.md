# 003 - Scope the Review-Format Contract to Review Runs (claude-code-action prompt)

## Why this task exists

`CLAUDE.md` § "Code Review Format Guidelines" carries the full review-format contract — including the `mcp__github_inline_comment__create_inline_comment` tool anchor — into **every** Claude session in this repo, although it only applies when Claude reviews a PR via the GitHub integration.
Moving the action-specific parts into the claude-code-action invocation's prompt input scopes them to review runs, while `CLAUDE.md` keeps only the durable behavioral rule that must survive any tooling change: **one finding = one independently resolvable thread, severity prefixes, overview-only summary**.
Deliberately deferred from PR #4 review (thread: https://github.com/Roubtec/agent-skills/pull/4#discussion_r3558685093) — the maintainer wants this assessed, not assumed.

## Scope

- Establish where the review-format contract lives for review runs (workflow prompt input) and slim `CLAUDE.md` to the durable rule.
- Out of scope: changing the contract's *content* (the per-thread format itself is proven and stays as-is); anything under `plugins/` or `codex/`; the `tasks/001*` protocol work.

## Context and references

- Current contract: `CLAUDE.md` § "Code Review Format Guidelines" (four bullets: inline per-finding comments with the tool anchor + `gh api` fallback, severity markers, overview-only summary, use-existing-comments/no-re-raise).
- Rationale for the tool-name anchor: left to its own devices, Claude posts one monolithic review comment; naming the exact MCP tool is the proven lever that produces per-finding resolvable threads (which the `address-review`/`address-reviews` **skills** depend on — their whole triage model reads GitHub's per-thread resolved/unresolved state; no GitHub Actions workflow is meant here, this repo has none). Whatever placement wins, that anchor must keep firing in review runs.
- **Discovered constraint:** this repo has **no `.github/workflows/`** — `@claude review` is currently triggered through the app-managed integration, so there is no repo-side prompt input yet. The prompt-scoping idea therefore requires either (a) adding a repo workflow using [claude-code-action](https://github.com/anthropics/claude-code-action) with a `prompt`/`claude_args` input carrying the contract, or (b) finding the integration's existing configuration surface, if any.

## Target files or areas

- `.github/workflows/` (likely a new `claude.yml`) — the review-run home for the action-specific contract.
- `CLAUDE.md` — reduced to the durable rule (thread-per-finding, severity prefixes, overview-only summary, no-re-raise), with no MCP tool name.

## Implementation notes

1. **Investigate first, change second.** Determine exactly how `@claude review` fires for this repo today (app-managed default vs. some existing config). Record the finding in the PR description. If adding a repo workflow would *change trigger semantics* (double-fire alongside the app default, altered permissions, secrets requirements), stop and surface that as a decision item for the maintainer instead of guessing — this is the main risk of the whole task.
2. If a repo workflow is viable: port the action-specific bullets (tool anchor, "the action posts the summary as the top-level tracking comment" mechanics) into its prompt input verbatim in spirit; keep the durable rule in `CLAUDE.md` phrased tool-agnostically.
3. **Prove no regression before slimming CLAUDE.md:** trigger a review on a throwaway/test PR and confirm findings arrive as separate inline resolvable threads with severity prefixes and an overview-only summary. Only then remove the action-specific text from `CLAUDE.md`. If the scoped placement cannot be proven to work, keep `CLAUDE.md` as-is and report — the current placement is sound; this task is an optimization, not a correction.
4. One line per paragraph in Markdown (repo convention); do not sweep unrelated `CLAUDE.md` edits into the change.

## Acceptance criteria

- A review run triggered after the change still produces one inline, independently resolvable thread per finding, severity-prefixed, with an overview-only top-level summary.
- `CLAUDE.md` retains the durable behavioral rule and no longer names the MCP tool; the action-specific contract exists exactly once, in the review-run configuration.
- The investigation outcome (how reviews trigger; why the chosen home is safe) is documented in the PR description.
- If blocked on trigger semantics, the task instead delivers a written decision brief for the maintainer — no half-migrated state.

## Validation

- Live end-to-end check on a test PR (see note 3) — this is the only meaningful validation; there is no build.
- `grep -n "mcp__github_inline_comment" CLAUDE.md` is empty after the migration (and non-empty in the workflow config).

## Review plan

Reviewer verifies the live test-PR evidence (threads, prefixes, summary shape), confirms `CLAUDE.md` still carries the durable rule intact, and checks the workflow change introduces no unrelated triggers or permission expansions.

## Decision brief (2026-07-12)

### Investigation outcome

The repository no longer has the integration topology described above: PR #14 added two active repository workflows, [`.github/workflows/claude.yml`](../.github/workflows/claude.yml) for trusted `@claude` mentions and [`.github/workflows/claude-code-review.yml`](../.github/workflows/claude-code-review.yml) for automatic reviews on `pull_request` open, reopen, and ready-for-review events.

`@claude review` now fires through the `issue_comment` trigger in `claude.yml`, not through an additional app-managed default: [run 29173036316](https://github.com/Roubtec/agent-skills/actions/runs/29173036316) was triggered by [this `@claude review` comment](https://github.com/Roubtec/agent-skills/pull/11#issuecomment-4949244224), ran the repository workflow once, and produced an overview-only tracking comment plus no new inline threads because the review was clean.

Earlier reviews on the same PR prove the current unmodified contract's finding path: [run 29169600761](https://github.com/Roubtec/agent-skills/actions/runs/29169600761) produced a [top-level overview](https://github.com/Roubtec/agent-skills/pull/11#issuecomment-4948895410) and separate severity-prefixed, independently resolvable inline threads such as [the security finding](https://github.com/Roubtec/agent-skills/pull/11#discussion_r3565112898) and [the suggestion](https://github.com/Roubtec/agent-skills/pull/11#discussion_r3565113135) through the mention workflow.

The action's mode boundary makes a direct `prompt:` migration unsafe without an explicit behavior decision: for comment events, the inspected v1 revision [selects agent mode whenever `prompt` is non-empty and tag mode otherwise](https://github.com/anthropics/claude-code-action/blob/e90deca47693f9457b72f2b53c17d7c445a87342/src/modes/detector.ts), while agent mode [bypasses mention checking and tracking comments](https://github.com/anthropics/claude-code-action/blob/e90deca47693f9457b72f2b53c17d7c445a87342/src/modes/agent/index.ts).

The dedicated automatic-review workflow has a different execution path: its explicit prompt invokes Anthropic's `code-review` plugin, whose [command already names `mcp__github_inline_comment__create_inline_comment` for one-comment-per-issue posting](https://github.com/anthropics/claude-code/blob/d4d8fbbb333c627d8fe2c1c583a5ccc26fdb1aed/plugins/code-review/commands/code-review.md), but its native summary behavior is not the same tracking-comment behavior as the mention workflow.

### Why this branch does not migrate the contract

The required live proof cannot be obtained safely before merge because `claude-code-action` validates that a workflow file on a PR is byte-for-byte identical to the default-branch copy; [run 29167095938](https://github.com/Roubtec/agent-skills/actions/runs/29167095938) shows the action skipping a PR-local workflow revision for exactly that reason.

Consequently, a single PR cannot both change the review workflow and prove that changed workflow before slimming `CLAUDE.md`; doing so would violate the explicit prove-before-slimming rule, while adding the scoped contract and leaving the global copy indefinitely would create the forbidden half-migrated duplicate state.

This branch therefore leaves `CLAUDE.md` and both workflows unchanged.

### Maintainer decision and recommended sequence

Decision required: authorize a two-PR migration, or retain the current global placement.

The recommended option is a two-PR migration because it preserves the current behavior until evidence exists:

1. PR A adds the action-specific contract to review-run configuration while retaining `CLAUDE.md` unchanged; for `@claude review`, use a review-conditional `claude_args` system-prompt addition rather than the action's `prompt:` input so the established tag-mode tracking behavior remains intact, and cover the automatic-review path without duplicating the contract text (for example through one shared review-run configuration surface).
2. After PR A merges, open a throwaway PR with deterministic review findings and trigger both the automatic review and `@claude review`; verify one severity-prefixed resolvable inline thread per finding and an overview-only top-level summary, and record the PR, run, comment, and thread URLs.
3. Only after that evidence exists, PR B removes the MCP/action mechanics from `CLAUDE.md`, retaining the durable tool-agnostic rule.

If the maintainer does not want the temporary duplication between PR A and the E2E proof, retain the current `CLAUDE.md` placement; there is no safe one-PR migration under the action's default-branch workflow validation.
