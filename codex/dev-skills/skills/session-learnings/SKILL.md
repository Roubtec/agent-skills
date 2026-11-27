---
name: session-learnings
description: A substantial Codex agent run has just finished and its friction is worth recording. Trigger when the user asks to record session learnings, run a post-run retrospective, capture environment issues, document improvement opportunities after an agent session, improve powbox based on agent-run friction, or run session-learnings. May suggest useful skill improvements. Not for ordinary code review or project bug reports unless the agent environment caused issues or was accidentally affected.
---

# Session Learnings

Record practical improvement opportunities discovered during a Codex run.

This skill is a retrospective capture and transport tool, not a repair workflow.
The output is a Markdown artifact for humans to triage later.

## Rules

- Create a report only when there is at least one concrete learning, unless the user explicitly asks for a no-issue report.
- Never stage or commit the report on the session's current branch or checkout.
- Ferry by default whenever ferrying is possible, and always when explicitly requested: a working directory inside a Git repository with an `origin` remote defaults to ferry mode, because a throwaway branch is cheap and pulling a stray untracked file off a remote box or a container-local checkout is not.
  Everywhere else defaults to local mode (an untracked report file, zero git mutations).
  An explicit `local` request forces local mode anywhere.
- In ferry mode, publish the report through an isolated temporary worktree on a dedicated throwaway branch based on the remote default branch.
- In ferry mode, add exactly one report-only commit, push the branch to `origin`, and do not open a pull request.
- Do not switch, stash, clean, reset, or alter the session's current branch, tracked files, or pre-existing uncommitted changes.
- Do not paste raw transcripts, long command logs, credentials, tokens, API keys, private URLs, or secret-looking values.
- Prefer observed facts over speculation; label uncertain inferences as such.
- Keep the audit efficient.
  Use the transcript/context already available first, and inspect files or logs only when they materially improve the report.

## Scope

Capture issues and opportunities related to the powbox environment or agent orchestration, such as:

- missing or stale tools, package caches, browser/runtime setup, shell defaults, or lint/test helpers
- sandbox, firewall, mount, volume, permissions, path, line-ending, or cross-platform friction
- ambiguous container instructions, skills, task workflows, or agent delegation mechanics
- repeated manual commands, avoidable waits, noisy output, brittle setup, or wasted turns
- cases where better default docs, scripts, smoke tests, hooks, status lines, or baked assets would have saved time
- project-specific friction only when it points to an environment, documentation, or workflow improvement

Do not use this skill to file ordinary product bugs, code-review findings, or feature requests unless they explain agent-run friction or a powbox improvement.

## Procedure

1. **Review the run.**
   Use the current conversation transcript/context, your command history, failed commands, interruptions, retries, and any relevant user corrections.
   If the user provides a transcript path, read it.
   If no transcript path is provided, do not spend more than a few minutes searching for on-disk session logs; the visible context is sufficient.

2. **Filter for actionability.**
   Keep only items with a plausible improvement path.
   Merge duplicates.
   Drop complaints that cannot be reproduced, cannot be acted on, or are purely about task complexity.

3. **Set aside known limitations.**
   Skip this step when step 2 left nothing to report: the read costs context, and it is only worth paying when a report is going to exist.
   A known-limitations document records friction its provider has accepted and does not want filed again; any environment or project may provide one, and this step is the whole convention for doing so.
   Read every one of these that exists: each file the `AGENT_KNOWN_LIMITATIONS` environment variable names (one or more paths, separated the way `PATH` is on the platform), then `KNOWN-LIMITATIONS.md` at the repository root (the current directory when there is no repository), then `docs/KNOWN-LIMITATIONS.md` beneath it.
   The expected shape is Markdown with one short titled entry per limitation, holding enough words to recognise the friction when it is met again.
   Read a richer document for its entries, and treat one that cannot be read or made sense of as absent, to be mentioned to the user in step 10 and not in the report.
   Finding none is the ordinary case: carry on, and say nothing about it in the report.
   Leave an issue out only when it plainly is a recorded limitation and the run adds nothing to it — no new trigger, no higher cost, no workaround worth recording — and note the entry it matched.
   Where the run does add something, keep the issue and cite the entry in its Evidence.
   Where you are unsure, or the resemblance is only loose, keep the issue: the default is to report.
   When every issue was left out, write no report unless the user asked for one regardless, and name the matched entries in step 10 instead.

4. **Choose the transport mode.**
   An explicit `local` (or `no-push`) argument forces local mode; an explicit `ferry` (or `push`) argument forces ferry mode.
   Otherwise default by whether ferrying is possible at all: when the current directory is inside a Git repository (`git rev-parse --is-inside-work-tree`) that has an `origin` remote (`git remote get-url origin`), default to ferry mode; when either check fails — no git in reach, or a Git repository with no `origin` remote to ferry to — default to local mode, because ferrying cannot work in either case.
   Keep both checks local; do not probe the network here.
   An `origin` that exists but is unreachable surfaces at the fetch and push steps below, which already fall back to a preserved local report.
   Local mode makes zero git mutations and skips steps 6, 8, and 9.

5. **Choose artifact names.**
   Use one UTC timestamp from `date -u +%Y%m%d-%H%M%S` for both `docs/agent-session-learnings-YYYYMMDD-HHMMSS.md` (when `docs/` does not exist, fall back to the repo root, or to the current directory when there is no repository) and, in ferry mode, the branch `learnings/session-YYYYMMDD-HHMMSS`.
   If either the path or branch already exists locally or on `origin`, append the same short numeric suffix to both instead of overwriting or force-pushing.

6. **Prepare an isolated ferry branch (ferry mode only).**
   Verify that the current directory belongs to a Git repository with an `origin` remote, and resolve and fetch `origin`'s default branch.
   When the powbox worktree helpers are available, attempt `wt-bootstrap` first; if it fails, do not abandon the capture — record the failure for the final report and use the plain-`git worktree` fallback below, whose temporary directory sits outside the `.worktrees` roots the bootstrap guards.
   When it succeeds, create the ferry worktree with `wt-enter <slug> <branch> <base>` — a session-scoped slug derived from the same timestamp (e.g. `session-learnings-<timestamp>`), the chosen ferry branch, and the fetched default branch as base.
   When the helpers are unavailable or `wt-bootstrap` failed, create the worktree with plain `git worktree` in a safely allocated temporary directory.
   Do not create or check out the ferry branch in the session's current worktree.
   If the repository or remote is unavailable, fall back to local mode and clearly report that the report could not be ferried.

7. **Write the report.**
   In ferry mode write it in the temporary worktree; in local mode write it at the path chosen in step 5, leaving it untracked and unstaged when that path is inside a repository.
   Keep it concise but specific enough that a maintainer can convert entries into tasks.
   Use this structure:

   ```markdown
   # Agent Session Learnings - YYYY-MM-DD HH:MM UTC

   Repository: <repo name or path>
   Agent: Codex
   Session focus: <one-line summary of the work>
   Transport: <Temporary branch [branch] (no PR) | Local untracked file>

   ## Summary

   - <highest-signal takeaway>

   ## Issues and Opportunities

   ### 1. <short title>

   - Type: <tooling | sandbox | docs | workflow | automation | agent-instructions | other>
   - Target: <environment | skills | project | upstream (name the tool) | unknown>
   - Severity: <low | medium | high>
   - Evidence: <brief observed symptom; no raw secrets or long logs>
   - Impact: <how it wasted turns or blocked work>
   - Suggested improvement: <specific fix, experiment, or investigation>
   - Repro/trigger: <when this happens again>
   - Confidence: <observed | inferred>

   Left out as known limitations: <entry title (document)>; <...>

   ## Follow-Up Candidates

   - <small actionable next step>
   ```

   Omit empty sections, and the left-out line when step 3 left nothing out.
   `Target` names where a fix would land — the environment or container the agent ran in, the skills or workflows it followed, the project's own code and tooling, or an upstream tool such as the harness — and is the reporting agent's best reading, binding nobody.
   Name both, comma-separated, where an issue spans two targets, and write `unknown` rather than guess where the target is not easy to determine.
   Add a short "No concrete issues found" summary only when the user explicitly requested a report even if nothing went wrong.

8. **Commit and publish only the report (ferry mode only).**
   Check the temporary worktree's status, stage the report path explicitly, and verify that the staged path set contains only that file before committing.
   Create one commit with a descriptive session-learnings message, then push the ferry branch to `origin` with upstream tracking.
   Never force-push and never create a pull request.

9. **Clean up safely (ferry mode only).**
   After a successful push, verify that the temporary worktree is clean, then remove it with `wt-remove <slug>` (plain `git worktree remove` only if the helpers were unavailable or `wt-bootstrap` failed in step 6); keep the local and remote ferry branch so the user can retrieve the report.
   If committing or pushing fails, preserve the report, branch, and temporary worktree for recovery, and report the exact failure instead of deleting the only usable copy.
   Leave the session's original checkout untouched except for the explicit untracked fallback when publication cannot be attempted.

10. **Report back.**
    Tell the user the transport mode, report path, and issue count.
    Name each issue left out as a known limitation by the entry it matched, and any known-limitations document that could not be read.
    In ferry mode also give the ferry branch, commit, and push status, state that no pull request was opened, and note that the local and remote `learnings/…` branches are throwaway transport refs, safe to delete once the report has been triaged.
    If no concrete learnings were found and no report was requested for that case, say directly that no file or branch was created.
