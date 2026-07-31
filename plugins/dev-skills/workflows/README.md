# Claude Dynamic Workflows

These are Claude-only dynamic-workflow counterparts to selected development skills: deterministic JavaScript orchestration scripts that spawn and sequence agents while leaving judgment and side effects to those agents. Codex has no workflow runtime, so this directory has no Codex sibling.

The workflows are distributed by the `dev-skills` plugin and register in its namespace: invoke `/dev-skills:wf-address-review` or `/dev-skills:wf-address-tasks`.

## Availability

These runtime facts were verified on 2026-06-10 against the documentation and Claude Code 2.1.170:

- Dynamic workflows require Claude Code 2.1.154 or newer and a paid Claude plan or supported API provider.
- Pro accounts default workflows off; enable them with the Dynamic workflows row in `/config`, which writes `"enableWorkflows": true` to `~/.claude/settings.json`. The explicit off switches are `"disableWorkflows": true` and `CLAUDE_CODE_DISABLE_WORKFLOWS=1`.
- Claude Code caches the effective plan in `~/.claude/.credentials.json`; re-login refreshes a stale `subscriptionType`, while an explicit `enableWorkflows` setting avoids relying on that default.

## Authoring constraints

- `export const meta = {...}` must be the script's first statement. The runtime registers the command only after parsing that pure literal, whose required fields are `name` and `description`; optional fields include `title`, `whenToUse`, and `phases`.
- Scripts must be deterministic plain JavaScript. `Date.now()`, `Math.random()`, and argument-less `new Date()` are rejected because they break resume, and TypeScript syntax does not parse.
- Workflow scripts own control flow; spawned agents own repository, shell, and Git work. A blocker is returned instead of prompting for input mid-run.

## Worktree model

The runtime's `agent(..., { isolation: "worktree" })` creates a separate temporary worktree for each agent from the repository's default branch, at a runtime-chosen location with no documented redirection option. That would hide an implementer's commits from its reviewer and cannot preserve one stable task worktree across stages.

`wf-address-tasks.js` therefore uses one explicit worktree per task and reuses it for the implementer, reviewer, and later fix rounds. Independent tasks still run concurrently, while sharing the on-disk task worktree makes commits visible across stages. The workflow depends on the environment-provided `wt-bootstrap`, `wt-enter`, and `wt-remove` helpers and reports a blocker when they are unavailable.

`wf-address-review.js` is a single-PR sequential pipeline, so its agents deliberately share the current checkout rather than creating worktrees.

The shared-filesystem assumption was verified on 2026-06-10 with Claude Code 2.1.170: a separately spawned agent could find the first agent's worktree, file, and commit, and a two-task workflow run kept each reviewer on its implementer's task worktree.

## Current scope

`wf-address-tasks.js` expresses dependency waves, storage-aware throttling, the bounded implement-review-fix loop, sibling collision handling, and per-task PR creation. It does not build the post-batch local review stack produced by the `address-tasks` skill.

`wf-address-review.js` expresses the bounded verify loop and conditionally publishes based on its flags. With no mid-run input, it behaves like the skill's hands-off mode: agents decide low-stakes ambiguity and report high-stakes blockers.

`rebase-stack` remains a skill because its value is sequential conflict judgment and user confirmation rather than agent fan-out.
