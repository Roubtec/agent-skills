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
