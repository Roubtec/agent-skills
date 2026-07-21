---
name: address-review
description: Address the maintainer-vetted review feedback on one pull request — optionally rebase the branch onto a target first, fix, push back on, or defer each unresolved review thread to a committed follow-up task file, verify every disposition with a fresh-eyes reviewer, then publish by default — push with exact lease protection, reply/resolve the threads, post a "Summary of Review Fixes" comment, and re-ping the reviewers that contributed — unless no-push is given for a local-only pass. Trigger when the user asks to address review comments, action a reviewed PR, work through review feedback, or run address-review. Do not trigger for planning, for implementing new task files (use address-tasks), or for rebasing a whole stacked chain (use rebase-stack).
---

Address the review feedback on a single pull request, end to end.

**Arguments:** `[PR#] [rebase on top of <branch>] [no-push] [push] [hands-off] [peer-opinions=off] [ping-codex] [ping-claude] [ping-copilot] [ping-contributing]`

Explicit Codex invocation uses `$address-review`; natural-language equivalents are fine.

A maintainer triggers this skill once a PR has been reviewed (by bots like `@codex`/`@claude`/`@copilot` and/or humans) and they have decided the outstanding feedback is ready to be acted upon.
Your job is to work through every **unresolved** review thread — fix what is right, push back on what is wrong, confirm what is already handled, and capture what is real but out of scope in a committed follow-up task — keep the thread state tidy, and publish the result and summon a fresh review round — by default, unless `no-push` keeps the run local.

The maintainer signals intent through GitHub's own resolved/unresolved state, not a custom marker.
They resolve threads they want dropped (or reply with their own push-back) **before** triggering you, so the rule is simply: **unresolved = actionable, resolved = leave alone.**
Because you resolve the threads you address (on push runs), running this skill repeatedly is self-cleaning — each run only re-examines what truly remains open.

## Arguments

All arguments are optional and parsing is **lenient** — accept commas, `&`, and free word order, mirroring the example prompts. Trust yourself to extract intent, then sanity-check against the PR.

| Argument | Meaning |
|---|---|
| `PR#` (e.g. `#38`) | The PR to address. Takes precedence over auto-detection — useful when the current branch is a local off-shoot of a merge-pending branch or otherwise disjoint from the PR head. Always sanity-check that it really relates to this branch. |
| `rebase on top of <branch>` | Rebase the **current branch** onto `<branch>` before gathering or fixing review feedback (Procedure step 2). Single-branch rebase only. |
| `no-push` | **Local-only run** — make commits, but do **not** mutate the PR at all (no push, no replies/resolves, no summary comment, no ping). This was the default until now; it is now the explicit way to ask for a dry run / inspect-only pass. The final report still captures every disposition so a later push turn can replay it. |
| `push` | Push the branch to the PR's actual head repository/ref and perform all PR-side communication (replies, resolves, summary comment) — but **ping no reviewer**. Use it to publish fixes quietly, without summoning a fresh review round. (Normal push for a fast-forward; explicit `--force-with-lease=<ref>:<expected-oid>` only when history was rewritten.) |
| `hands-off` | Run with no user interaction — best-effort to completion, documenting every skipped/blocked item in the final report. See "Hands-off mode". Typically how a parallel review orchestrator invokes this skill in a subagent. |
| `peer-opinions=off` | Disable the best-effort `claude` second opinion for this run. By default it runs beside every fresh Reviewer round while the peer remains available. |
| `ping-codex` | After a push that advances the PR branch (new commits or rewritten history), post a dedicated top-level `@codex review` comment to summon a fresh review round. **Implies `push`**, but skip the ping on an "Everything up-to-date" no-op push. |
| `ping-claude` | After a push that advances the PR branch, post a dedicated top-level `@claude review` comment. **Implies `push`**, but skip the ping on an "Everything up-to-date" no-op push. |
| `ping-copilot` | After a push that advances the PR branch, request a fresh Copilot review via `gh pr edit <PR#> --add-reviewer @copilot` (the canonical CLI request; needs gh ≥ 2.88.0) — **not** an `@copilot review` comment, which drives Copilot's coding agent (it can start editing the branch) rather than its reviewer. **Implies `push`**, but skip on an "Everything up-to-date" no-op push. Tested working: `--add-reviewer @copilot` re-requests Copilot's review even on a PR it already reviewed (it does **not** silently no-op), and it never misfires into the coding agent the way an `@copilot` comment would. |
| `ping-contributing` | **The default** — a bare run with no push/ping argument behaves exactly as if you passed this, so spelling it out is redundant (kept for reference, and for combining with a named ping). As a **modifier** on the ping set: re-ping a bot only if it **brought a new finding this round.** Combined with explicit `ping-codex`/`ping-claude`/`ping-copilot`, it filters that named set down to the contributors; supplied **alone** (or as the bare default), it falls back to every known bot (codex/claude/copilot) that reviewed this round. **Implies `push`** and is still subject to the no-op-push skip. The point: keep one fixed reviewer set across rounds and let a bot that has gone quiet drop out of the ping cycle on its own — so a multi-bot review→address loop winds down bot-by-bot instead of pinging everyone forever. *Brought a new finding* = authored ≥1 thread this round that surfaces a real concern not raised before on this PR (typically `actionable-fixed`, or a genuinely new `follow-up-task`/`already-addressed`); it does **not** count a `push-back` (the comment was wrong), a re-raise of a concern already captured in a committed task, or a bot re-arguing a push-back it already lost — **unless** that thread carries a genuinely new angle this round. |

### Flag interactions

**The default is now to publish.** A run with **no** push/ping argument pushes the branch, performs all PR-side communication, **and** re-pings every bot that brought a new finding this round — i.e. a bare run behaves exactly like `ping-contributing`. The flags only adjust that default:

| You pass… | Push? | Who gets pinged |
|---|---|---|
| *(nothing)* | yes | contributing bots — every bot with a new finding this round |
| `ping-contributing` | yes | contributing bots — the explicit (redundant) spelling of the default |
| `push` | yes | **nobody** — publish quietly, summon no fresh review |
| `ping-codex` / `ping-claude` / `ping-copilot` | yes | exactly the bot(s) you name; this **overrides** the contributing default (add `ping-contributing` to instead filter the named set down to its contributors) |
| `no-push` | **no** | nobody — local-only dry run (the pre-change default) |

- **Resolution order — `no-push` wins.** If `no-push` is present it forces a local-only run; if it is somehow combined with `push`/`ping-*` (a contradiction), honor `no-push` and note the ignored flag. Otherwise push is always on; the ping set is then: the named bots if any were named (filtered to contributors when `ping-contributing` is also present), else **nobody** when `push` was spelled out, else the **contributing** set (the bare default, or `ping-contributing`).
- **`ping-*` implies `push`.** A named `ping-codex`/`ping-claude`/`ping-copilot` or `ping-contributing` always publishes — a re-review of unpushed work is meaningless. Only `no-push` suppresses the push.
- **A ping fires only when the push actually advanced the branch.** A ping summons a *fresh* review, which is only meaningful if new commits (or a rewritten history) were just pushed. If this run produces nothing new to push — every disposition was already-addressed or push-back, or the branch was already up to date — **skip the pings.** Re-requesting a review with nothing new to look at would spin the review → address → review cycle forever; the resolved threads and Summary comment already record the outcome.
- **`ping-contributing` prunes the ping set to the bots still adding value.** It is the default, and it also composes with named pings: a named bot is re-pinged only when it *brought a new finding* this round (see its table row for what counts). Decide this per comment author from this round's triage. Supplied **alone** or as the bare default (no explicit bot named), the candidate set is every known bot (codex/claude/copilot) that authored a review thread this round; supplied alongside explicit names, it intersects with them and never adds a bot you did not name. A round in which no candidate bot brought a new finding pings no bot — which, like the no-op-push skip, lets an automated multi-bot loop wind down reviewer-by-reviewer as each one goes quiet, even while the push itself advanced (e.g. you fixed a human's thread).
- **Multiple pings present** → perform each as its own dedicated action (a separate comment per named bot; the `gh pr edit --add-reviewer @copilot` request for Copilot), never a single comment mentioning several. They are also separate from the Summary comment.
- **`hands-off` + `rebase`** is uncommon and the riskiest combination: a non-trivial rebase conflict has no one to consult, so you abort cleanly and stop rather than guess (see "Hands-off mode" and step 2).
- **`no-push` → a local-only run.** Make commits, but **do not mutate the PR at all** (no replies, no resolves, no summary comment, no ping). The final report captures every disposition so a later "push now" turn can replay it. This is the only way to opt out of the now-default push.

## Architecture

At top level, address ordinary feedback **inline** and delegate only large or independent rework.
Then hand verification to a **fresh, independent reviewer subagent** and, by default, an independent best-effort `claude` peer.

Two top-level subagent roles plus one CLI peer:

- **Fixer** (optional) — a fresh `worker` subagent that handles a large, multi-file, or exploratory fix for one or more related comments. Skip it for small surgical fixes you can do directly.
- **Reviewer** (default before any push) — a fresh `explorer` subagent that receives every unresolved thread and explicitly included standalone item verbatim, plus the proposed disposition labels, but **not** your implementation reasoning; it independently confirms that each disposition is sound in the committed code and performs a quality pass on the changed files. This is the `address-tasks-serialized` reviewer pattern.
- **Peer (`claude`, best-effort)** — a read-only CLI review launched in the background at the same moment as the Reviewer. It receives the same disposition context but no implementation reasoning, examines code without running builds/tests, and returns an independent verdict. `peer-opinions=off`, unavailability, timeout, or unintelligible output forfeits only that opinion; a coherent, grounded finding is first-class.

> **Critical — one checkout-dependent agent at a time; Codex subagents share your working tree.**
> Unless explicitly assigned distinct git worktrees, subagents operate on the same checked-out branch as the orchestrator. Never spawn two checkout-dependent subagents in the same natural-language turn or tool-call batch, and never spawn the reviewer until the fixer's commits have landed. Spawn one, wait for it, close it, then spawn the next. A reviewer racing unfinished work can inspect an empty or partial branch and falsely pass it. The sole concurrency exception is the examination-only `claude` peer launched beside the Reviewer after the tree is clean and committed: two readers are safe, while the Reviewer alone owns build/typecheck execution.

> **Fix-ups and re-reviews always use a fresh subagent spawn**, never `send_input` to continue a prior worker or reviewer. Fresh context with no attachment to the earlier fix is intentional.

### Codex subagent execution

Use the subagent interface exposed in the current session.
In tool-enabled sessions this is typically available through tools such as `multi_agent_v1.spawn_agent`, `multi_agent_v1.wait_agent`, and `multi_agent_v1.close_agent`; use those names only when present in the current tool listing.
Spawn fixers as `worker` agents and reviewers as `explorer` agents.
Pass self-contained prompts; do not fork the orchestrator's context, and omit model overrides unless the user asks for one.
Wait for each subagent and close its thread when no longer needed.
No custom agent personas (`~/.codex/agents/*.toml`) are required.

If the session exposes no subagent capability, do not publish unreviewed changes.
Only use the trivial local-only escape hatch below; otherwise tell the user the workflow requires Codex multi-agent support.

**Trivial escape hatch:** only on a local, no-push run with one obvious actionable comment may you skip the reviewer. Never skip review before publishing, and never skip it for a push-back disposition.

### Delegated modes for the worktree orchestrator

Codex subagents must not be assumed to spawn nested subagents.
`address-reviews` therefore uses this skill in two internal modes; these are orchestrator controls, not normal user flags:

- **`delegated-fix`** — run steps 0–5 directly in the assigned worktree, without spawning helpers, then stop before review/publication and return a complete review packet: PR/head metadata, starting/final SHAs, every item verbatim with stable refs and proposed disposition, validation run, and any blocker.
- **`publish-reviewed`** — receive that packet plus a fresh external reviewer's Pass verdict and the peer outcome (no grounded findings, explicit forfeit/unavailability, or disabled), verify the packet still matches the clean committed `HEAD`, then run only step 7 and return step 8's report. Refuse to edit code, re-triage, or publish without this complete passing review gate.

The worktree orchestrator owns the fresh reviewer, peer invocation, and any fix-up rounds between these modes.

## Procedure

### Step 0 — Preflight

1. **Working tree must be completely clean** (`git status --porcelain`). If it prints anything (staged, modified, or untracked), stop and ask the user to commit/stash/clean it (hands-off: document and stop). Do not auto-stash or discard files.
2. **No rebase already in progress** — check `git rev-parse --git-path rebase-merge` and `--git-path rebase-apply`. If either exists, stop and ask the user to finish or abort it first.
3. **Confirm `gh` is authenticated** (`gh auth status`). Without it you cannot read threads, reply, resolve, or comment.
4. **Record the starting branch and tip SHA** so you can describe exactly what changed in the final report and recover if needed.
5. **Preflight the peer once for a standalone run, unless `peer-opinions=off`.** Classify the probe explicitly:
   - If `command -v claude` fails, mark the peer unavailable.
   - If `claude auth status` succeeds, mark the peer available.
   - If `claude auth status` fails while `ANTHROPIC_API_KEY` is set, defer classification to the first real invocation because the environment key may authenticate it without a saved login.
   - If the failure says this older CLI does not support the `auth status` subcommand, likewise defer classification to the first real invocation because no probe is available.
   - For any other `claude auth status` failure, mark the peer unavailable and retain the failure reason.
   In either deferred-classification path, an auth/usage failure at the first real invocation marks the peer unavailable for the rest of the run. Unavailability never blocks; record its reason for one final-summary note. Skip this probe in `delegated-fix` and `publish-reviewed`: `address-reviews` preflights once in its shared bootstrap and supplies the peer outcome.

### Step 1 — Resolve and verify the PR

Precedence for identifying the PR:

1. **Explicit `PR#`** — use it, but **sanity-check the relationship to the current branch**. Compare the PR's `headRefName` and head SHA against the current branch: do they share recent history? Is the branch an ahead/behind copy of the PR head? If they look genuinely unrelated (no shared commits), surface it — *"the supplied PR #N targets branch `x`, which shares no history with the current branch `y`; proceed anyway?"* — and ask before operating (hands-off: stop and document, since acting on the wrong PR is high-stakes).
2. **Auto-detect** — `gh pr view --json number,headRefName,baseRefName,url,title,state` resolves the PR for the current branch; `gh pr list --head <branch>` is the fallback.
3. **Ambiguous or none found** — ask the user which PR (hands-off: stop and document the blocker; do not guess).

Record `owner`, `repo`, PR `number`, `baseRefName`, `headRefName`, `headRefOid`, and the head repository owner/name for the API calls and publication guard below.

### Step 2 — Rebase first (only if `rebase on top of <branch>` was given)

Rebasing brings the branch close to its final merged state, so address the feedback against the geometry the work will actually land in (essential when several stacked PRs are being fixed at once).
This is a **single-branch** rebase. To restack a whole chain of dependent branches, that is the separate `rebase-stack` skill — mention it if the user seems to want chain-wide restacking.

1. Verify the target exists locally — a branch ref, or an exact commit SHA (a batch orchestrator pins the target to one commit so every entry rebases onto the same base).
2. Save the branch being rewritten, not the target: `current_branch="$(git branch --show-current)"`, require it to be non-empty, set `ts="$(date -u +%Y%m%d-%H%M%S)"`, then `git update-ref "refs/pre-rebase/$current_branch/$ts" HEAD`.
3. `git rebase <target>`. Git's patch-id detection drops commits already present on the target.
4. **Conflicts:**
   - **Trivial** (import/whitespace/formatting collisions, pure additions, or a patch already represented on the new base) → resolve in-file and `git add` + `git rebase --continue`, or `git rebase --skip` for an already-represented commit. Narrate one line each; don't pause.
   - **Non-trivial** (a genuine semantic dilemma) → **interactive:** present the conflict, your proposed resolution and reasoning, and confirm before applying — loop the user in as many times as needed rather than guessing. **Hands-off:** `git rebase --abort`, confirm `git status --porcelain` is empty, and **stop the whole run** — addressing review on a wrong/stale base then force-pushing is worse than not running. If abort leaves unexpected files, preserve and report them rather than deleting blindly. Document the conflict (files, offending commit, why) as the blocker.
5. After a conflicted rebase, run the project's build/lint (discover via `AGENTS.md`/`CLAUDE.md`, then `package.json` scripts, then ecosystem signals) to confirm the resolution is sound before proceeding. A clean rebase needs no validation.

If the rebase changed the branch tip, expect the eventual push to be a force-push (`--force-with-lease`).

### Step 3 — Gather the review feedback

Fetch the **unresolved** review threads and enough context to judge them (see "GitHub API recipes"):

- **Review threads** (inline comments) via the GraphQL recipe (see "GitHub API recipes"): run the query by hand — one single-shot query per page, following `endCursor` manually past 100 threads, never `gh api graphql --paginate` (under concurrent runs it has returned another PR's threads). If a `gh-review-threads` helper is available on PATH (`command -v gh-review-threads`), prefer it — it encodes the same fresh single-shot per-page queries, does the nested comment fetch-up, and applies the scope check below, failing closed on contamination. Either way, keep only `isResolved == false`, detect unexpectedly truncated comment lists, and **scope-check the result** (the helper already does): every returned comment `url` must match this repo and PR exactly (`https://github.com/OWNER/REPO/pull/<N>` followed by `#`, `/`, `?`, or end; never a plain substring check like `/pull/<N>`). On any mismatch, discard the whole response, retry once with a fresh single-shot query, and if it repeats fail closed without replying/resolving. For each thread, capture the thread `id`, `path`, `line`, `isOutdated`, and every comment's `databaseId`, author login/type, `body`, `diffHunk`, and `url`.
- **Top-level review summaries** (`gh pr view --json reviews`) and **issue comments** (`gh api --paginate repos/{owner}/{repo}/issues/{number}/comments`) — read for context, especially **maintainer replies/push-backs** that override or qualify a bot's original comment. They are not automatically actionable because they have no resolved/unresolved state; include a standalone item only when the maintainer explicitly identifies it as outstanding in the request or discussion.

A maintainer reply on an unresolved thread is **authoritative**: if they said "skip this" or "do X instead," follow the maintainer over the original reviewer.
The same authority extends to a **top-level decision comment** — a maintainer comment that walks the open feedback and records a verdict per item (often titled "Maintainer Decisions" or similar). Treat each recorded decision as the binding disposition for the thread(s) it covers — including "postpone to a follow-up task" and "keep as-is" — rather than re-triaging those threads from scratch.
Treat `isOutdated` as context, not a disposition: inspect the current code and re-locate the concern rather than auto-dismissing an outdated thread.
If there are no unresolved threads and no explicitly included standalone items, stop as a successful no-op: make no commits, do not push or ping, do not post a summary comment, and report that nothing actionable remains.

### Step 4 — Triage every review item

Classify each into one of:

- **Actionable** — a real issue; implement the fix.
- **Already addressed** — the current code (possibly thanks to the rebase or an earlier commit) already satisfies it. Note where.
- **Push-back** (should be **rare**) — the comment is wrong, misunderstands context, or points in the wrong direction. Do **not** implement it; draft a respectful, specific rationale instead. Lean on judgment; never implement a fix you believe is wrong just to clear a comment.
- **follow-up-task** — the concern is real, but at least one condition applies: fixing it here would expand the PR's scope considerably while the branch is defendable as it stands (it builds and covers its main paths); the work meets step 5's condition-bound deferred-placement criteria; or the maintainer has already requested a follow-up (reply or decision comment). Do **not** implement it; record it as a committed task file instead (step 5). Never use this to dodge a cheap fix.
- **Ambiguous** — the right fix needs an authoritative decision you cannot make from the code/history. **Interactive:** ask the user. **Hands-off:** make a best-effort call only when stakes are low; otherwise skip and document it — do not guess where an authoritative determination is required.

### Step 5 — Fix

For the actionable items:

- **Small/surgical** → fix directly in your own context, committing at logical milestones.
- **Large/multi-file/exploratory** → spawn a **Fixer** subagent (see Architecture and the prompt sketch below). One at a time; await its commits before moving on.
- **Preclude repeat comments:** for each pattern you fix, grep the PR's changed files and closely related code for the **same offending pattern** and fix those too, so the next review round doesn't re-raise it. Mention these proactive fixes in the summary.
- Keep commits buildable where practical; run the build/lint before declaring done.
- Before review, require `git status --porcelain` to be empty. Inspect and commit every intended change; if a fixer leaves partial or unexplained changes, resolve that state or stop rather than letting the reviewer inspect only the committed subset.

For the **follow-up-task** items, write the task file(s) following the `write-tasks` skill conventions (invoke that skill where available):

- Follow whatever task layout the repo already uses. Default to its task folder (commonly `tasks/`): a planned follow-up stays queued and numbered there even when it has prerequisites, which the task must state so its ordering remains visible.
- Use the deferred subfolder (for example, `tasks/deferred/`) only for deliberately unscheduled work: it depends on functionality that is not certain to arrive; it addresses a condition that cannot occur yet or has not manifested, and fixing it would be costly; or it awaits a spike or decision between competing options.
- When unsure, prefer `tasks/`: a mis-queued task can be reprioritized during a batch, while a mis-deferred task is easily forgotten.
- Number each file to continue the folder's existing sequence, slotted by priority/intended order.
- Each task must stand alone: restate the concern with file/line references and link the PR thread; an implementer should not need to re-read the review.
- **Commit task files on the current branch, separately from code-fix commits** (when practical). The task ships with the branch that prompted it — merging the PR then also lands the record of its loose ends, which is what makes a committed follow-up a legitimate way to close a thread.

Fixer subagent prompt should include: the relevant review comment(s) **verbatim**, the file/line locations, the branch name (and "verify you are on it"), an instruction to read `AGENTS.md` first, the same-pattern sweep instruction, commit/validation instructions, an instruction not to write to any shared task/plan tracker, and a request to report what it changed, any tradeoffs, and anything uncertain. Do **not** give it unrelated context.

In `delegated-fix` mode, do not spawn a Fixer or Reviewer and do not launch the peer; the batch orchestrator owns both review paths.
Perform the fixes directly, leave the worktree clean with all intended changes committed, return the review packet defined above, and stop here.

### Step 6 — Verify with a fresh reviewer

Once fixes are committed and the worktree is clean, spawn **one fresh `explorer` Reviewer subagent** (never concurrently with a fixer; only after commits land) and, unless disabled or unavailable, launch the `claude` peer in the background at that same moment. Wait for both outcomes, then close the Reviewer after recording them.

Give it: every unresolved thread and explicitly included standalone item verbatim, each proposed disposition label (actionable-fixed / already-addressed / push-back / follow-up-task / ambiguous), the effective review base, and the current branch. The effective review base is the requested rebase target when step 2 ran; otherwise it is `baseRefName`. Do **not** give it your implementation reasoning, drafted rationale, or the fixer's report. Tell it to:

- Independently verify every disposition: fixes and already-addressed claims must hold in the committed code; push-backs must be technically justified rather than convenient dismissals; follow-up-task items must point at a committed task file that genuinely covers the concern, with the follow-up itself justified (maintainer-directed, genuinely scope-expanding while the branch builds and covers its main paths, or condition-bound under step 5's deferred-placement criteria — never an evasion of a cheap fix) and its queued or deferred placement consistent with step 5; ambiguous items must genuinely require an authoritative decision. It may reclassify any item.
- Read the actual files; if `git diff --name-only <base>...HEAD` looks empty despite claimed fixes, report a likely race/wrong-branch flag rather than reviewing nothing.
- Run the build/typecheck; a failure is an automatic blocker.
- Do a quality pass on the changed files (logic correctness, error handling, edge cases, dead code, consistency, duplication, type safety) and check the same-pattern sweep did not miss a sibling occurrence.
- Report **Pass** or a numbered, actionable **Issues** list. Edit nothing; write to no shared task/plan tracker.

Give the peer the worktree path, effective review base, current branch, and every review item plus proposed disposition verbatim — the same evidence as the Reviewer, but not the fixer's report, your reasoning, drafted rationales, or the Reviewer's execution steps. Its prompt must instruct it to read the actual files, edit nothing, and verify dispositions in the committed code: fixes and already-addressed claims hold; push-backs are technically justified; and follow-up-task items point at a committed task file that genuinely covers the concern, with the follow-up itself justified (maintainer-directed, genuinely scope-expanding while the branch builds and covers its main paths, or condition-bound under step 5's deferred-placement criteria — never an evasion of a cheap fix) and its queued or deferred placement consistent with step 5. It may do a read-only quality pass, but must not run builds/tests; that remains the Reviewer's job. Require exactly `VERDICT: PASS | ISSUES`, followed for Issues by numbered findings tagged `blocking` or `minor`, each with `file:line` and a one-line rationale.

Before launching the peer CLI process, create a unique directory outside the worktree for this invocation and attempt; never reuse or share that directory. Write the prompt verbatim to a file there without evaluating it, and write `git -C <worktree> log --oneline <base>..HEAD` plus `git -C <worktree> diff <base>...HEAD` from this exact worktree to a read-only diff artifact in that same directory. Include the artifact path in the prompt and grant only this invocation directory with `--add-dir`; without that grant an out-of-cwd Read can be auto-denied, while granting a shared parent directory would let concurrent peers cross-read another invocation. Managed hooks and organization settings policy can still apply under `--safe-mode`, so an operator in a managed environment must disable peer opinions or first ensure those hooks cannot mutate the worktree before launching a peer concurrently with the Reviewer. The canonical launch below includes `--effort high`. Remove that flag only when the configured or default effort is known to be `high` or `xhigh`; for every other level, including `max` or `ultracode`, keep it so peer reviews run at `high`. Never put bracketed optional tokens in the command. Shell-quote every generated path when replacing the placeholders, keep `--safe-mode` and both read-only tool guard flags, and never pass permission-bypass flags.

Launch the peer in a dedicated session and process group; do not use a plain background subshell, because killing that subshell can orphan `claude` or its descendants. Require `setsid` for this path (otherwise disable/forfeit the peer), assign the worktree, invocation directory, prompt, JSON `outfile`, and diagnostic `errfile` paths to shell variables, require both output paths to be inside the invocation directory, and use this launch shape; `--fork --wait` keeps a waitable supervisor alive, while the inner shell records the distinct session/process-group leader before it becomes `claude`:

```sh
peer_session_file="$invocation_dir/session.pid"
if (umask 077 && : > "$peer_session_file"); then
  setsid --fork --wait sh -c '
    session_file=$1
    worktree=$2
    shift 2
    printf "%s\n" "$$" > "$session_file" || exit 125
    cd "$worktree" || exit 125
    exec "$@"
  ' peer-launch "$peer_session_file" "$worktree" \
    claude -p --effort high --safe-mode --tools "Read,Glob,Grep" --disallowedTools "mcp__*" \
    --add-dir "$invocation_dir" --output-format json \
    < "$prompt_file" > "$outfile" 2> "$errfile" &
  peer_wait_pid=$!
else
  peer_wait_pid=
  peer_launch_status=125
fi
```

Create `peer_session_file` as an empty, owner-only regular file before the launch and do not launch if that preparation fails. Poll for it to become non-empty, require its contents to be a positive decimal PID, and save that value as `peer_pgid`; do not infer it from `peer_wait_pid`, because `setsid --fork` deliberately makes the wait supervisor and session leader different processes. The PID-file write is the first operation in the session and is checked, so `claude` cannot start unless the handoff succeeds. If the supervisor exits before a valid handoff, immediately `wait "$peer_wait_pid"` to reap it, record the launch failure (normally status 125 for the write or `cd` guard), and never advance or retry from that attempt. Use a loose roughly 12-minute timeout, extending it when review size warrants.

After `peer_pgid` passes the numeric/positive check, use the following helpers. The negative PID operand targets the validated process group; omitting `--` is intentional because the Dash `kill` builtin rejects it. Keep this form for TERM, KILL, and every death probe:

```sh
peer_group_alive() {
  kill -0 "-$peer_pgid" 2>/dev/null
}

peer_stop_group() {
  kill -TERM "-$peer_pgid" 2>/dev/null || :
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    peer_group_alive || break
    sleep 1
  done
  if peer_group_alive; then
    kill -KILL "-$peer_pgid" 2>/dev/null || :
  fi
  wait "$peer_wait_pid" 2>/dev/null || :
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    peer_group_alive || break
    sleep 1
  done
  ! peer_group_alive
}

peer_finish_group() {
  if wait "$peer_wait_pid"; then
    peer_wait_status=0
  else
    peer_wait_status=$?
  fi
  if peer_group_alive; then
    peer_stop_group || return 1
  fi
  ! peer_group_alive
}
```

On timeout, call `peer_stop_group`; on observed supervisor completion, call `peer_finish_group` and interpret its saved `peer_wait_status` only after it succeeds. The final command on either path must succeed. `peer_stop_group` always performs TERM → bounded wait → KILL when needed → supervisor `wait` → bounded death check, and failure means a group member survived: do not retry or advance until it is gone. Apply this verification on every completion path, not only timeouts. Keep `outfile` reserved for parseable JSON and use `errfile` only for diagnostics and the retained failure reason. Retry a timeout or transient failure once with an entirely new invocation directory, prompt, outfile, errfile, artifact, session file, and process group, then forfeit that round. An auth/usage failure on a classify-at-first-invocation attempt marks the peer unavailable for later rounds. `claude -p` may print nothing until completion; wait for both Reviewer and peer before deciding the round.

Parse the peer's captured JSON only far enough to extract its final message, then read only the two verdict lines for orchestration. Unintelligible peer output is a non-blocking forfeit. A round clears the review gate when the Reviewer passes and the peer either reports no unaddressed grounded findings or has an explicit forfeited, unavailable, or disabled outcome; both `blocking` and `minor` grounded peer findings gate. Only when the Reviewer passed and peer findings alone would gate, cheaply spot-check each finding's `file:line` and factual claim; discard self-evidently false or nonexistent references and note that discard. Do not summarize, merge, or rewrite feedback: when another fix round is needed, give the fresh Fixer the complete results verbatim as labeled `Reviewer findings` and `Peer (claude) findings` blocks so it can reconcile overlap or conflict. A pushed-back peer claim is adjudicated by the next fresh Reviewer.

If either result leaves material gaps, re-triage the affected comments, then loop: a fresh `worker` Fixer with both verbatim finding blocks when code must change, followed by a fresh `explorer` Reviewer and peer round. Wait for and close each subagent before spawning the next. Allow at most **12 reviewer rounds total**, including the initial review; every fix-up round counts regardless of which reviewer triggered it. If issues persist after round 12, stop iterating, do **not** push, and surface both outstanding finding sets in the final report (and to the user if interactive).

### Step 7 — Publish after the review gate (every run except `no-push`)

If `no-push` was given this is a local-only run: **skip this entire step** — do not touch the PR. Go to step 8.

Otherwise:

Do not enter publication unless the fresh Reviewer passed and the peer either returned no grounded findings, forfeited/unavailable, or was explicitly disabled. Any outstanding grounded peer finding — `blocking` or `minor` — returns to step 6 while rounds remain, or stops publication at the cap.

In `publish-reviewed` mode, first require the supplied review packet, a fresh external reviewer Pass, the peer outcome satisfying that same gate, and a clean committed `HEAD` equal to the packet's final SHA. If any differ or the peer outcome is missing, stop; do not re-triage or publish stale work.

1. **Re-check before publication:** require a clean worktree and no rebase in progress; re-fetch the PR and confirm it is still open, still points to the recorded head repository/ref, and its current `headRefOid` is the expected remote tip you are prepared to replace. Resolve the current branch's exact push remote/ref, verify they match that PR head, and fetch that exact head ref without moving the local branch so the expected commit object is available for the ancestry test — never assume `origin`, especially for fork PRs. If the PR head moved, the push target cannot be matched, or the branch has no usable push permission, stop and report instead of guessing.
2. **Push:** if the expected remote tip is an ancestor of `HEAD`, use a normal explicit push (`git push <remote> HEAD:refs/heads/<headRefName>`). If history was rewritten, use an exact lease (`git push <remote> --force-with-lease=refs/heads/<headRefName>:<expected-head-oid> HEAD:refs/heads/<headRefName>`). If the lease is rejected, **never** escalate to bare `--force`; stop and report because the remote moved under you.
3. **Re-read unresolved threads after the push.** This catches comments resolved or added while fixes were in progress. Do not mutate newly-added feedback that was not triaged and reviewed in this run; leave it open and call it out for the next pass.
4. **Per-thread hygiene** — for each triaged thread still unresolved (recipes below):
   - *Actionable-fixed* → reply (`Fixed in <sha>: <one line>`) **and resolve**.
   - *Already-addressed* → reply pointing to where it's handled **and resolve**.
   - *Follow-up-task* → reply with the placement-specific template: queued work uses `Follow-up task committed: tasks/NNN[a-z]?-… — queued for an upcoming batch`; parked work uses `Deferred with full context to tasks/deferred/NNN[a-z]?-… — <the condition it waits on>`, where the lowercase letter suffix is optional. **Resolve** when the follow-up was maintainer-directed or the thread is bot-authored; leave a human-authored thread unresolved unless the maintainer authorized closing it. Never re-implement a task-backed thread.
   - *Push-back* → reply with the rationale and flag it prominently in the summary. Resolve a bot-authored thread after independent review validates the push-back. Leave a human-authored thread unresolved unless the maintainer explicitly authorized resolving it, so unattended runs do not silently close a person's objection.
   - *Ambiguous/skipped* → **leave open**, list it in the summary as needing a decision.
   Before replying, inspect the thread for an equivalent prior reply from the authenticated user (for example, a previous run replied but failed to resolve) and avoid posting duplicates. Resolve only after the reply succeeds; record any communication failure and leave that thread open.
5. **Summary comment** — post a top-level **"Summary of Review Fixes"** (`gh pr comment`). Structure: what was fixed (with proactive same-pattern fixes called out), a **prominent "Pushed back — please re-examine" section** for every push-back with its rationale, a **"Follow-up tasks" section** listing each item with its committed task file (explicitly flag deferred placement and flag agent-proposed follow-ups for confirmation), any ambiguous/skipped or newly-arrived items still needing a decision, and (in hands-off runs) every automatic low-stakes decision and every item skipped for lack of feedback. In this comment, avoid bare `@codex`/`@claude`/`@copilot` mentions (write "codex"/"claude"/"copilot" plain) so only the dedicated ping comments below trigger a review.
6. **Pings** — only after the push and summary succeeded **and only when the push actually introduced new commits or rewritten history** (the branch tip advanced — not an "Everything up-to-date" no-op push): `ping-codex` → a dedicated comment whose body is `@codex review`; `ping-claude` → a dedicated comment whose body is `@claude review`; `ping-copilot` → request a Copilot review with `gh pr edit <PR#> --add-reviewer @copilot` (never an `@copilot review` comment — a bare `@copilot` mention drives Copilot's coding agent, not its reviewer; the add-reviewer request re-triggers Copilot's review even on a PR it already reviewed — tested working). **Guard first:** confirm the installed `gh` supports the `@copilot` reviewer value (gh ≥ 2.88.0, e.g. `gh --version`); if the request errors on an older `gh` (< 2.88.0), **skip the Copilot request without failing the run** — the push and summary already succeeded — and report that Copilot was not summoned (upgrade `gh`, or re-request from the PR's web reviewer menu). **When `ping-contributing` is in effect — including on a bare default run, which is treated as `ping-contributing` — first determine which bots brought a new finding this round** (per "Flag interactions") and ping only those: the named set filtered to its contributors, or — if no bot was named — the contributors among every bot that reviewed this round. A bot you would otherwise ping but which only re-raised a follow-up-task item or re-argued a lost push-back this round is skipped; note each such skip in the summary. If more than one bot remains, perform each as its own dedicated action. **If nothing new was pushed this run, skip the pings entirely even when `ping-*` was supplied** (see "Flag interactions") — otherwise an automated review → address → review cycle never terminates.

### Step 8 — Final report

Always produce a report (this is the only output of a no-push run, and it doubles as the body of the Summary comment on push runs):

- The PR, the branch, before/after tip SHAs, and whether a rebase happened (and how conflicts went).
- Each addressed comment with a **stable reference** — file:line, comment author, the thread's GraphQL node id, and the comment permalink — and its disposition (fixed / already-addressed / pushed-back / follow-up-task / skipped). On a **no-push** run this mapping is essential: a later "push now" turn uses it to replay the exact replies/resolves without re-deriving everything.
- Push-backs, prominently, with rationale.
- Follow-up tasks, each with its committed file, queued or deferred placement, and whether it was maintainer-directed or agent-proposed.
- Proactive same-pattern fixes made beyond the literal comments.
- Reviewer outcome and how many iterations it took (and whether it hit the cap).
- Peer participation and outcome; note an unavailable/disabled/round-forfeited peer once with its reason, plus any discarded ungrounded findings.
- Anything blocked or skipped for lack of an authoritative decision, with what's needed to unblock.

## Hands-off mode

Purpose: run inside a parallelized agent that has no direct line to the user (e.g. a review orchestrator's subagent). Reach the orchestrator if you can, but otherwise drive to a best-effort completion and **document, never guess on high-stakes choices.**

- Low-stakes ambiguity → make a sensible best-effort call and record it.
- A real concern whose fix would expand the PR's scope, on a branch that is defendable as it stands → postpone it to a committed follow-up task (step 5) and flag the task and any deferred placement prominently; this is a legitimate unattended resolution, not a skip.
- High-stakes/authoritative ambiguity → skip, do not guess, document precisely what's needed.
- Non-trivial rebase conflict → abort cleanly and stop the run (step 2).
- Lease-rejected push, unidentifiable/unrelated PR, or reviewer cap hit → stop and document; do not force or guess your way past it.
- At top level, fixer/reviewer subagents are still fine. In `delegated-fix` mode, do not attempt nested delegation; return the packet to the orchestrator. Every skipped/blocked item must appear in the final report (and the Summary comment if pushing) so the user learns of it and can act later.

## GitHub API recipes

`gh api` expands `{owner}`/`{repo}` to the current repo. For GraphQL, pass real values (`gh repo view --json owner,name`).

**List unresolved review threads** (id for resolve, comment `databaseId` for replies).

**Primary — run the GraphQL query by hand.** Single-shot query — do **not** use `--paginate` here: run concurrently with other `gh` GraphQL calls (e.g. an `address-reviews` fan-out), `gh api graphql --paginate` has returned **another PR's** review threads, which unguarded would misfile replies/resolves onto the wrong PR. One page covers most PRs (`totalCount` ≤ 100); when `reviewThreads.pageInfo.hasNextPage` is true, fetch the next page as a fresh single-shot call passing the returned `endCursor` via `-F after=CURSOR`, and likewise fetch a thread's remaining comments when its nested `comments.pageInfo.hasNextPage` is true — always before triage:

```sh
gh api graphql -f query='
query($owner:String!,$repo:String!,$pr:Int!,$after:String){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$pr){
      reviewThreads(first:100,after:$after){ totalCount nodes{
        id isResolved isOutdated path line
        comments(first:100){
          nodes{ databaseId author{ login __typename } body diffHunk url }
          pageInfo{ hasNextPage endCursor }
        }
      } pageInfo{ hasNextPage endCursor }}
    }
  }
}' -F owner=OWNER -F repo=REPO -F pr=NUMBER   # for pages after the first, add: -F after=CURSOR
```

**Optional accelerator — if `gh-review-threads` is available on PATH** (`command -v gh-review-threads`), prefer it: it encodes the same query plus the scope check below. `gh-review-threads <PR#>` prints the unresolved threads as a JSON array on stdout — each thread with `id isResolved isOutdated path line` and `comments[]` (`databaseId`, `author { login __typename }`, `body`, `diffHunk`, `url`); add `--all` to include resolved threads, `--repo <owner>/<repo>` for a repo other than the current one. It already encapsulates everything the recipe above spells out: fresh single-shot per-page pagination (never `--paginate`), nested comment fetch-up, and the repo-qualified boundary-safe scope check — failing closed with exit code `3` and nothing on stdout if a response is contaminated (after one retry). If your environment ships such a helper, its query should match the block above.

Outside powbox, Codex users can copy `plugins/dev-skills/bin/gh-review-threads` onto their PATH.

```sh
gh-review-threads NUMBER | jq '...'          # unresolved threads, scope-checked
gh-review-threads --all NUMBER               # include resolved threads too
```

**Scope-check before acting** (the helper, where used, does this for you; this governs the hand-run recipe): every returned comment `url` must match the exact repo-qualified PR path for the PR you are addressing, for example `https://github.com/OWNER/REPO/pull/NUMBER#...`. Implement this as a boundary-safe match on `OWNER/REPO` plus `/pull/NUMBER` followed by `#`, `/`, `?`, or end; do not use a plain substring check, because `/pull/12` also appears inside `/pull/123`. A mismatch means the response was contaminated by a concurrent query (or you queried the wrong PR) — discard the entire result, retry once with a fresh single-shot query, and if it repeats fail closed; never reply to or resolve a thread whose `url` points at a different PR.

**Reply to a review comment** (REST, threads the reply under the original):

```sh
gh api --method POST repos/{owner}/{repo}/pulls/NUMBER/comments/COMMENT_DATABASE_ID/replies -f body='Fixed in <sha>: ...'
```

**Resolve a thread** (GraphQL, using the thread `id` from the query above):

```sh
gh api graphql -f query='mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}){ thread{ isResolved } } }' -F id=THREAD_NODE_ID
```

**Top-level comments** (summary and codex/claude pings):

```sh
gh pr comment NUMBER --body '...'        # Summary of Review Fixes
gh pr comment NUMBER --body '@codex review'
gh pr comment NUMBER --body '@claude review'
```

**Request a Copilot review** (canonical CLI; needs gh ≥ 2.88.0 — never `@copilot review` as a comment, which drives Copilot's coding agent rather than its reviewer):

```sh
gh pr edit NUMBER --add-reviewer @copilot
```

**Read context:** `gh pr view NUMBER --json reviews,comments,headRefName,headRefOid,headRepositoryOwner,baseRefName,url,state` and `gh api --paginate repos/{owner}/{repo}/issues/NUMBER/comments`.

## Checklist

- [ ] Working tree clean; no rebase in progress; `gh` authenticated.
- [ ] PR resolved (explicit `PR#` precedence) and sanity-checked against the current branch.
- [ ] If requested, single-branch rebase done first; non-trivial conflict handled (interactive loop-in / hands-off abort+stop); validated when conflicted.
- [ ] All **unresolved** threads gathered via the GraphQL recipe (or the `gh-review-threads` helper where available) — single-shot queries, manual `endCursor` paging past 100, never GraphQL `--paginate` — and scope-checked with a repo-qualified, boundary-safe PR URL match; resolved ones ignored; maintainer replies and top-level decision comments treated as authoritative; a zero-actionable run exits without push/comment/ping.
- [ ] Each thread triaged: actionable / already-addressed / push-back / follow-up-task / ambiguous.
- [ ] Fixes done inline or via a fixer subagent (one checkout-dependent agent at a time); same-pattern sweep done in changed/related code.
- [ ] Follow-up-task items recorded as standalone task files per `write-tasks` conventions, placed under step 5's queued-vs-deferred rule, and committed on the current branch separately from code fixes.
- [ ] Worktree clean and every intended change committed before review and publication.
- [ ] Fresh independent Reviewer and best-effort `claude` peer checked every disposition after commits landed; both outcomes were recorded before deciding each round (including any explicit peer forfeit, unavailability, or disablement); grounded blocking and minor findings gated publication; feedback loop capped at 12 reviewer rounds.
- [ ] Publish run (the default; suppressed only by `no-push`): PR head and exact push target re-verified; normal push used for fast-forward or explicit expected-OID lease used for rewrite (never bare `--force`); threads re-read after push; replies + resolves applied idempotently; push-backs resolved and flagged; follow-up-task threads replied with their committed task file and placement-specific wording; ambiguous/new items left open; Summary comment posted without stray `@` mentions; pings as separate dedicated actions (codex/claude → a comment; copilot → `gh pr edit --add-reviewer @copilot`, never an `@copilot review` comment) only after summary success **and only when new commits were actually pushed** (skip pings on a no-op push so an automated loop can terminate). Ping set: a bare run (or `ping-contributing`) pings the contributing bots; an explicit `push` pings nobody; a named `ping-*` pings exactly those (filtered to contributors when `ping-contributing` is also present).
- [ ] `no-push` run: zero PR mutations; final report maps every thread to its disposition for a later push turn.
- [ ] Final report covers rebase outcome, dispositions with stable refs, push-backs, proactive fixes, Reviewer and peer outcomes, and blocked/skipped items.
