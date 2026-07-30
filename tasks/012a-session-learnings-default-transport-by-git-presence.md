# 012a — session-learnings: default transport keys on git presence, not the host-mount env var

## Why this task exists

The `session-learnings` skill currently picks its default transport from `POWBOX_WORKSPACE_HOST_PATH`: set (host bind mount) means local mode, unset means ferry mode. That heuristic answers the wrong question ("can the user already see this file?") and is powbox-specific — once the skill is distributed via the plugin ([012](012-adopt-powbox-skills-and-workflows.md)), it runs in environments where the variable never exists and the guess degrades to always-ferry or always-local by accident of the env. The maintainer's decision: the useful signal is whether a git repo is in reach at all. Creating a throwaway branch is basically free even on `origin`, and agents often run on remote boxes or isolated containers whence fetching a stray untracked file is cumbersome — so when ferrying is possible, it should be the default, bind mount or not.

## Scope

Included:

- **New default rule**: ferry mode whenever the working directory is inside a git repository with a usable `origin` remote; local mode any other time (a random folder with no git in sight — where ferrying is impossible anyway). The `POWBOX_WORKSPACE_HOST_PATH` heuristic is removed entirely; defaulting to ferry on a host bind mount is a deliberate behavior change, not an oversight.
- Explicit `local`/`no-push` and `ferry`/`push` arguments keep forcing their mode exactly as today.
- The existing graceful degradation stays: when ferry mode is selected but the repo or remote turns out unusable mid-run (fetch fails, push rejected), fall back to a preserved local report and say so — never lose the capture.
- Update the skill's frontmatter `description` (it currently narrates the bind-mount heuristic) and step 3's mode-selection text; sweep any other in-skill restatement of the old default.
- Apply to both harness renderings: `plugins/dev-skills/skills/session-learnings/SKILL.md` and the Codex mirror `codex/dev-skills/skills/session-learnings/` (including its `agents/openai.yaml` sidecar if it restates the default).

Out of scope:

- Any other change to the report structure, branch naming, worktree mechanics, or cleanup steps.
- The powbox-side copies — after the forfeit merge they no longer exist; do not patch powbox.

## Context and references

- [012](012-adopt-powbox-skills-and-workflows.md) — prerequisite: the skill must live in this repo first (012 is a verbatim import; this behavior change deliberately rides separately so the relocation diff stays a pure move).
- powbox `docker/claude/agent-container/skills/session-learnings/SKILL.md` step 3 — the current mode-selection logic being replaced (frontmatter description narrates the same heuristic).

## Target files or areas

- `plugins/dev-skills/skills/session-learnings/SKILL.md`, `codex/dev-skills/skills/session-learnings/` (SKILL.md + `agents/openai.yaml` if applicable).

## Implementation notes

- "Usable origin" should be a cheap check (`git rev-parse --is-inside-work-tree` plus an `origin` remote existing); do not add a network probe to mode selection — an unreachable origin surfaces naturally at the existing fetch/push steps, which already fall back to local with an honest report.
- Keep the description's trigger conditions untouched; only the transport-default narration changes.

## Acceptance criteria

- In a git repo with `origin`, a bare invocation ferries; in a non-git directory, a bare invocation writes a local untracked report; explicit arguments override both.
- No reference to `POWBOX_WORKSPACE_HOST_PATH` remains in either harness copy.
- Ferry-mode failure paths still preserve the report locally and report the failure.

## Validation

- Dry-run the skill in a scratch non-git directory (expect local) and in this repo (expect ferry against a throwaway branch, then delete it).

## Review plan

Reviewer checks the mode-selection text has exactly one decision rule (git+origin → ferry, else local, args force), that no stale bind-mount narration survives in frontmatter or body, and that the mid-run fallback to local is unchanged.
