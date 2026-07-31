---
name: address-tasks-serialized
description: Execute a batch of pre-planned task files end to end, strictly sequentially on one shared working tree — one branch per task, delegate implementation and review to fresh subagents, and open PRs against the resolved base. Trigger only when sequential single-branch execution is explicitly wanted — e.g. to stay within rate limits, or when parallel worktrees are not suitable; otherwise the parallel `address-tasks` is the default. Do not trigger for one-off coding requests or for planning new tasks.
---

Implement the given task or a set of tasks using a delegated subagent workflow.

**Arguments:** `<glob-or-file-list of task files to implement> [peer-opinions=off]`

`peer-opinions=off` is the only accepted explicit peer-opinion setting. Omit it to use the default, which enables best-effort peer opinions.

## Architecture

You are the **orchestrator**.
Your job is to sequence tasks, manage branches and PRs, and coordinate two specialized subagent roles per task:

- **Orchestrator** (you) — sequencing, branching, PR creation, progress tracking. Runs as the top-level agent.
- **Implementer** — deep implementation work for a single task. Spawned as a fresh `worker` subagent with a focused prompt.
- **Reviewer** — fresh-eyes acceptance check against the task definition. Spawned as a fresh `explorer` subagent with a focused prompt that forbids edits.

This separation keeps your context window clean across long batches and ensures the reviewer evaluates the work without implementation bias.

> **Critical — one agent at a time; Codex subagents share your working tree.**
> Unless you explicitly configured per-agent git worktrees, each subagent operates on the same checked-out branch and working tree as the orchestrator. Two checkout-dependent subagents running at once can race or corrupt each other's view of the repo. The most common failure: a reviewer spawned alongside its implementer scopes `git diff <base>...HEAD` before the implementer has finished committing, sees nothing, and falsely reports "no implementation" — so the work ships **unreviewed**.
> Therefore: **never spawn or request two checkout-dependent subagents in the same natural-language turn, same tool block, or before the previous subagent has been waited on and closed.** Start one subagent, wait for its result, close it, then start the next. The general guidance to batch independent tool calls does not apply here: implementers and reviewers are not independent because they contend for one working tree.
> The examination-only peer CLI described below is the sole exception: launch it alongside the reviewer only after the implementation is committed, and forbid it from running builds or tests, so it remains a concurrent reader while the own reviewer may build.

### How to spawn a subagent in Codex

Use the subagent interface Codex exposes in the current session.
In interactive Codex sessions, ask Codex in natural language to spawn the appropriate built-in subagent and wait for its result.
In tool-enabled sessions, this capability is typically exposed through tools such as `multi_agent_v1.spawn_agent`, `multi_agent_v1.wait_agent`, and `multi_agent_v1.close_agent`; use those names only when they are present in the current tool listing.
Spawn implementers as `worker` agents and reviewers as `explorer` agents.
Do not fork context; instead, pass a self-contained prompt.
Omit model overrides unless the user explicitly asks for a different model.
Because each task step depends on the subagent result, spawn exactly one checkout-dependent subagent at a time: spawn it, wait for completion, then close the agent thread when it is no longer needed before spawning the next one.
No custom agent personas (`~/.codex/agents/*.toml`) are required.

If the current session exposes no subagent capability, tell the user this skill requires Codex multi-agent support.
Only fall back to doing the implementation locally if the user explicitly approves that change in workflow.

**Trivial-task escape hatch:** for genuinely trivial tasks (a single obvious change with unambiguous criteria), you may implement directly without delegating.
Default to delegation for anything requiring exploration or judgment.
Even when you skip the implementer, always spawn a fresh reviewer agent — no task skips review.

## Orchestrator Responsibilities

You own the overall workflow.
You MUST NOT do implementation work yourself (except for the trivial-task escape hatch above).
Your responsibilities are:

1. Resolve the input arguments to a list of task files.
2. Read each task file enough to understand dependencies and sequencing — do not deeply analyze implementation details.
3. Manage branch creation and PR base determination.
4. Construct focused prompts and spawn subagents **one at a time** — implementer, await and close it, then a fresh reviewer — for each task. Never batch the implementer and reviewer into one natural-language request or tool block (see the shared-working-tree rule above).
5. Handle the review feedback loop.
6. Open PRs once a task passes review.
7. Advance to the next task or stop on blockers.
8. Produce the final batch summary.

## Implementer Agent

The implementer receives a focused, self-contained prompt and works autonomously on a single task.
Spawn it **on its own**, then wait for completion and close the agent thread before proceeding. The orchestrator needs both the implementer's result and its committed work on disk before spawning a reviewer, so do not start any other checkout-dependent subagent in the same turn or tool block.

### What to include in the implementer prompt

Construct a prompt that contains:

- **The full task file content** — paste it into the prompt. Do not assume the agent has prior context.
- **The branch name** it should be working on, and instruction to verify it is on the correct branch.
- **Instruction to read `AGENTS.md`** at the start for full project context and conventions.
- **Relevant upstream context** — if this task depends on a previous task in the batch, briefly describe what the previous task introduced so the implementer can build on it.
- **Commit and validation instructions:**
  - Commit at logical milestones, keeping each commit buildable when practical.
- **Coordination instructions** — remind the implementer that it is not alone in the codebase, must not revert unrelated edits made by others, and should accommodate concurrent changes.
- **No shared task/plan tracker.** Tell the implementer not to write to any shared task or plan tracker (e.g. a shared todo/plan list). A subagent's entries leak into the orchestrator's view and linger there as stale, misleading items (e.g. a child step still shown as in-progress after it finished), adding noise to every later turn without helping the orchestrator spot a struggling task — that signal comes from the implement→review→fix result, not from a child's micro-steps. The implementer should track its own steps however it likes and surface progress only in its final report.
- **Reporting instructions** — when done, report back with:
  - A concise summary of what was implemented.
  - Any decisions, tradeoffs, or deviations from the task description.
  - Any uncertainties or areas that may need focused review.

### What the implementer should NOT receive

- The full batch context or other unrelated task files.
- Review feedback from unrelated prior tasks.

### Example implementer prompt structure

```text
You are implementing a single task on branch `feature/task-slug`.
Verify you are on this branch before starting.

Read `AGENTS.md` first for project conventions.

## Task

<full task file content pasted here>

## Context

<any relevant info about prior tasks this builds on>

## Instructions

- Implement the task according to its description and acceptance criteria.
- Commit at logical milestones. Aim for one commit per logical unit of work.
- Do not revert unrelated or concurrent edits. Accommodate changes made by others.
- Run the project's build and lint commands periodically. Run a full build check before reporting completion.
- When done, report: what you did, any decisions/tradeoffs, any uncertainties.
```

## Reviewer Agent

The reviewer is a **fresh** subagent with no knowledge of the implementation process.
It evaluates the current codebase state against two orthogonal dimensions: acceptance criteria compliance and implementation quality.
It must be a **fresh** subagent spawn — never a continuation of the implementer's thread.
Spawn it only **after** the implementer has fully completed and its commits have landed — never concurrently with the implementer, and never in the same natural-language turn or tool block. You share one working tree, so a concurrent reviewer can scan an empty or half-finished branch and wrongly report "no implementation" (see the shared-working-tree rule in Architecture).
Wait for completion and close the reviewer before the orchestrator advances branches or starts the next task.

### What to include in the reviewer prompt

- **The full task file content** — same source of truth the implementer received.
- **The PR base branch name** (the branch this task will be merged into). The reviewer uses this to scope its review by listing files touched on the task branch versus the base. If the orchestrator omits this, the reviewer should fall back to `main` and note the fallback in its report.
- **Instruction to read the relevant areas of the codebase** and check each acceptance criterion against the actual code.
- **A note that the implementation is already committed on the current branch** — the reviewer must read the actual files, and must NOT conclude "no implementation" without first confirming the diff is genuinely empty (an empty diff at this stage is far more likely an orchestration error than real absence; the reviewer should say so rather than spend its budget reviewing nothing).
- **Instruction to perform a code quality pass** (see dimensions below) orthogonal to the criteria check.
- **Scoping guidance** — the reviewer may run `git diff --name-only <base>...HEAD` to identify the set of touched files and prioritize quality review there. It must still read each touched file in full (not just the diff) and may follow references into untouched files when needed to evaluate consistency or call sites.
- **Reporting format:**
  - **Pass** — all acceptance criteria are met, build passes, and no material quality issues found. State this clearly.
  - **Issues** — a numbered list of specific, actionable findings. Each finding must include: the category (criteria gap vs. quality), where in the code the gap is, and what needs to change.
- **Instruction to be strict but fair** — flag genuine gaps and functional problems, not style preferences or minor nitpicks.
- **Instruction NOT to edit any files** — the reviewer only reads and reports. It must not create, update, or delete follow-up task files; any suggested follow-up work belongs in the review report only.
- **Instruction not to use any shared task/plan tracker** — like the implementer, a reviewer's entries in a shared todo/plan list bleed into the orchestrator's view.

#### Code quality dimensions to check

These are checked **in addition to** the acceptance criteria, not instead of them.

- **Logic correctness** — control flow, conditionals, and branching produce the right outcomes. Look for off-by-one errors, inverted conditions, incorrect operator precedence, or logic that silently produces wrong results.
- **Error handling** — errors are caught where they can occur, propagated with meaningful context, and never silently swallowed. Return types and thrown types are accurate.
- **Edge cases** — null/undefined inputs, empty collections, zero/negative numbers, and boundary values are handled gracefully or explicitly rejected with a clear error.
- **Dead code and unreachable paths** — branches, parameters, or exported symbols that can never be reached or used should be flagged. Defensive code for conditions that cannot occur should be questioned.
- **Code consistency** — naming, patterns, and idioms are consistent with the surrounding codebase. New abstractions follow the same conventions as existing ones.
- **Avoid code duplication** — Reused patterns should ideally be implemented once and shared rather than duplicated (if practical) to reduce maintenance overhead and improve readability.
- **Type safety** — types are precise and not widened unnecessarily. Casts, `any`, or `as unknown` that could hide real type errors should be flagged.

### What the reviewer should NOT receive

- The implementer's summary, reasoning, or notes.
- Instruction to read commit messages or diffs. The reviewer may use git to list touched files (for scoping), but it should not read commit messages or `git diff` output, since both anchor the reviewer to the implementer's intent and to a line-by-line view that hides issues spanning the boundary between changed and unchanged code. Read whole files instead.

### Example reviewer prompt structure

```text
You are reviewing a task implementation. You have no prior knowledge of how it was built.
Your job is to evaluate the current codebase on two orthogonal dimensions:
1. Acceptance criteria compliance — does the code do what was specified?
2. Implementation quality — is the code correct, robust, and consistent?

The implementation is already committed on the current branch — read the actual files. Do not
report "no implementation": if `git diff --name-only <base-branch>...HEAD` looks empty, say so as a
flag to the orchestrator (it signals a likely race or wrong branch) rather than reviewing nothing.

DO NOT edit, create, or delete any files. Only read, search, and run validation commands.
Do not write follow-up task files; put any suggested follow-up work in your review report only.

The PR base branch for this task is `<base-branch>`. The current branch is `<task-branch>`.

## Task

<full task file content pasted here>

## Instructions

- Run a full build and verify there are no type errors before checking anything else. A build failure is an automatic blocker.
- Identify the touched files with `git diff --name-only <base-branch>...HEAD`. Use this list to scope your code quality review. If no base branch was provided above, fall back to `main` and mention the fallback in your report.
- Do NOT read commit messages (`git log`) and do NOT read diffs (`git diff` with content). Read each touched file in full instead — diff-only review hides issues that span the boundary between changed and unchanged code, and commit messages anchor you to the implementer's intent.
- You may follow references from touched files into untouched files when needed to evaluate consistency, call sites, or downstream effects.
- Read the relevant areas of the codebase and check each acceptance criterion.
- Perform a code quality pass on the touched files using the following checklist:
  - **Logic**: are conditionals, branching, and control flow correct? Any off-by-one, inverted conditions, or silent wrong-result paths?
  - **Error handling**: are errors caught and propagated with context? Anything silently swallowed?
  - **Edge cases**: are null/undefined, empty collections, and boundary values handled or explicitly rejected?
  - **Dead code**: any unreachable branches, unused parameters, or defensive guards for impossible conditions?
  - **Consistency**: do naming, patterns, and idioms match the surrounding codebase?
  - **Duplication**: any non-trivial patterns duplicated that could be shared instead?
  - **Type safety**: are types precise? Flag unnecessary widening, `any`, or unsafe casts.
- Report either:
  - **Pass**: all criteria met, build passes, no material quality issues.
  - **Issues**: numbered list. For each: category (criteria gap / logic / error-handling / edge-case / dead-code / consistency / duplication / types), file and line, what is wrong, and what should change instead.
- Be strict but fair. Flag real gaps and functional problems. Do not flag style preferences or superficial nitpicks.
```

## Execution Model

Process the batch **sequentially**, not in parallel — and within each task, run the implementer and its reviewer one at a time, never concurrently (they share your single working tree; see the rule in Architecture).
Each task is its own delivery unit, but stack later task branches on top of earlier ones when needed so dependent work can continue without waiting for review.

### Determining the PR base

Use the following precedence:

1. **Explicit override** — if the user specifies a base branch (e.g. "make a PR against `main`"), use that for every task in the batch. If the user asks for no PR, skip PR creation entirely.
2. **Previous task branch** — for the second task onward in a serialized batch, branch from and target the previous task branch when the work depends on earlier changes.
3. **Current branch** — if neither of the above applies, the branch you are on when the batch starts is the PR base for the first task.

## Per-Task Workflow

For each task file in the input set:

1. **Record the PR base branch** for this task (see precedence rules above).
2. **Create a dedicated implementation branch** for the task.
3. **Read the task file** enough to construct a good implementer prompt. Identify the acceptance criteria so you can later evaluate the reviewer's report.
4. **Spawn the implementer agent** with a well-structured prompt (see Implementer Agent section). Wait for completion and close the agent. Spawn nothing else in the same natural-language turn or tool block — the reviewer comes only after the implementer's commits exist on disk.
5. **Evaluate the implementer's report.** If the implementer hit a blocker it could not resolve, stop and surface it to the user before spawning a reviewer.
6. **Only after step 5, spawn the reviewer agent** with a fresh prompt (see Reviewer Agent section) and launch the peer second opinion in the background at the same moment (unless unavailable or `peer-opinions=off`). Always wait for the reviewer before triage, and also wait for the peer when one was launched; then close the reviewer agent. Do not spawn the reviewer in the same natural-language turn or tool block as the implementer — you share one working tree, so a reviewer started before the commit reviews an unfinished branch.
7. **Evaluate the reviewer's report:**
   - If the report says the branch is **empty / has no implementation / shows an empty diff**, do not trust it at face value — that is the signature of a race (reviewer started before the implementer committed) or a wrong-branch checkout, not a real gap. Verify with `git diff --name-only <base>...HEAD`; if the work is actually present, spawn a fresh reviewer and use that verdict instead.
   - If the own reviewer **passes** and the peer has no unaddressed grounded findings under the protocol below: proceed to step 8.
   - If either feedback source has issues: enter the feedback loop (see below).
8. **Run the pre-PR collision guard below.** If this branch collides, do not open its PR; deconflict the flagged new claimant and send the changed branch through fresh review again. A held branch is not delivered and does not become the base of the next task.
9. **Open a PR** against the recorded base branch.
   - **First push the task branch** (`git push -u origin HEAD`), and push the recorded base too if it exists only locally (e.g. a dependency's not-yet-pushed branch). `gh pr create` on an unpushed branch prompts interactively for a push target, which hangs a delegated/no-TTY run. If the remote is unavailable (see the local-only fallback), skip the PR and record the branch as pending push instead.
   - Reference the task file in the PR description for context.
   - Include any reviewer-relevant caveats (tradeoffs, intentional divergences, uncertainties surfaced by the implementer or reviewer).
   - Do not restate the entire task unless doing so adds real review value.
10. **Continue to the next task** or, if this was the last one, produce the final summary.
   If you hit a blocker that prevents responsible progress, stop and ask the user for clarification.

## Pre-PR collision guard

First apply the plain add/add check to the branch's newly added files using the task-number guard's single comparison set and kind-based contribution rule below. Compare exact paths and basenames, and inspect contributed files for shared exported top-level class/function/const/interface/type/enum names; compute a tree-bearing member's additions with a three-dot diff against its own base, just as the task-number scan does. A duplicated value is a collision. Hold the second claimant, rename the least disruptive new side, regenerate derived files, and run fresh review again. If the name or path is imperative, hold the branch and ask the maintainer instead of inventing an invalid alternative.

### Task-number collisions across in-flight branches

Run this guard before opening any PR that adds task files. Parse the basename of every task file as a **full task number** (three digits plus an optional lowercase letter suffix, such as `001`, `001a`, or `042b`) followed by its slug. Two files collide whenever their full task numbers are identical, regardless of slug; `001`, `001a`, and `001b` are distinct and do not collide. Compare the scanning branch's unpaired additions with one another as well as with the comparison set, so two new files on that branch cannot claim one number before either reaches another member.

The comparison set is defined here, once, as the union of two groups. **Always:** the base branch and every open PR head. **In a pipelined run, additionally:** branches delivered earlier in the same run, anything merged since the run started, numbers reserved by a task that cleared this guard but has not finished delivering, and currently-ready siblings awaiting the guard. Track these run-local members as the pipeline advances. First claimant wins; the second claimant renumbers, and never rewrite a delivered or reserved claimant. When two currently-ready siblings are both still unguarded, establish the first claimant in the run's deterministic delivery order (dependency or scheduling order, then task number) and reserve it before evaluating the other; the delivered-or-reserved rule decides every asymmetric case.

What a member contributes is determined only by its kind, not by re-enumerating that membership list: the base branch contributes its entire recursive `tasks/` tree; any other tree-bearing member contributes only task files it adds relative to **its own** base; and a member already represented as a reserved number contributes that number directly. Never read a non-base head as a whole tree. It inherits its base's files without claiming them, and a whole-tree read would turn routine stacked work and task relocations into false collisions. Likewise, compute the scanning branch's additions and removals only against its own recorded base, never by diffing it against another head.

Refresh the scanning branch's recorded base before reading it, with an explicit refspec, and use the remote-tracking name in every subsequent command; a bare local base name or `git fetch origin "$base"` can remain stale in a narrow clone:

```bash
git fetch origin "+refs/heads/${base}:refs/remotes/origin/${base}"
git ls-tree -r --name-only "origin/${base}" -- tasks/
git diff --no-renames --diff-filter=A --name-only "origin/${base}...${branch}" -- tasks/
git diff --no-renames --diff-filter=D --name-only "origin/${base}...${branch}" -- tasks/
```

The recursive `ls-tree` is load-bearing: `tasks/done/`, `tasks/deferred/`, and any future nested folder retain their numbers. `--no-renames` is load-bearing on both diffs: a move must decompose into one removal and one addition, and a renumbering rename must expose its destination as a fresh claim.

The explicit remote refresh remains the normal and required path. The only fallback is a recorded base that the remote cannot represent because it exists only locally (an unpushed dependency base) or the run is already known to be local-only: resolve that local base to an exact commit OID, use the OID — not the bare branch name — for the recursive tree read and both diffs, and report the base read as degraded under the note-and-proceed rule. Never turn a failed refresh into an empty additions list or a silent pass.

Enumerate the point-in-time remote comparison data once with `gh pr list --state open --limit 200 --json number,headRefOid,baseRefName,baseRefOid`. The pinned bound avoids the CLI's silent default of 30; if the enumeration returns as many entries as the pinned limit, report the returned count (the limit), explain that any additional unreturned heads cannot be named, and mark the scan incomplete, then continue under the note-and-proceed rule rather than claiming a complete result. Do not add pagination to disguise that bound.

Before diffing an enumerated head, fetch it from the base repository with `git fetch origin "refs/pull/${number}/head"`, then read the exact enumerated `headRefOid`, not a guessed local or fork branch name. Also collect each distinct `baseRefName` and refresh it **unconditionally once per name** with `git fetch origin "+refs/heads/${pr_base}:refs/remotes/origin/${pr_base}"` before any head uses it; mere ref presence says nothing about freshness. Take that head's contribution with `git diff --no-renames --diff-filter=A --name-only "origin/${pr_base}...${headRefOid}" -- tasks/`. The three-dot form uses the fetched history's merge base and prevents a stacked PR from claiming files inherited from its sibling base.

If a PR's base no longer resolves by `baseRefName`, use its enumerated `baseRefOid` when that object is reachable; if neither base object can be read, or the exact enumerated head OID cannot be read after the PR-ref fetch, note that the named head (or at least PR number when that is all the enumeration supplied) was skipped and proceed without substituting a wrong base. Apply the same note-and-proceed behavior when the remote or `gh` is unavailable. Report every skipped head and the limit condition explicitly; a local-only run may still use its readable run-local members, but must not describe the remote scan as complete.

Before comparing claims, exempt only relocations made by the scanning branch itself. Within each full-number group, pair each removed file with at most one added file and always consume an available same-number removal. Prefer an addition with the same slug as the removal; otherwise use the closest rename match only to choose among multiple same-number candidates. The slug or similarity heuristic never permits cross-number pairing. This makes an archive, deferral, promotion, or in-place slug rename a net-zero claim, and it also clears a two-file number swap; a single removal cannot exempt both a relocation and a second new claimant. Because the pairing uses only removals against this branch's own base, it never releases a number genuinely claimed by another member.

For every unpaired addition, an identical full number is a collision. A differing slug is the cross-branch case this guard exists to catch. The same slug at a different path is also a collision: `tasks/done/024-foo.md` or `tasks/deferred/024-foo.md` still holds `024`, and the identical-path add/add guard cannot see that pair. Only an identical path may be handed to the existing add/add procedure. Otherwise hold the second claimant, renumber the **flagged new claimant**, and run fresh review again; never renumber a copy in `tasks/done/` or `tasks/deferred/`, because its stable number is part of the historical reference. If the new number is imperative, keep the branch held and ask the maintainer instead.

This is a bounded snapshot, not a total guarantee. It establishes that no collision existed among heads at the OIDs returned by the single enumeration. A head can advance after that enumeration — before or after its fetch, or while this branch's own PR is being opened — and land a concurrent duplicate. Do not re-query or compare `FETCH_HEAD` in an attempt to close an unclosable race; the `review-tasks` recursive duplicate-number sweep is the backstop for that residual.

## Peer second opinion (best-effort)

Unless `peer-opinions=off`, preflight `claude` once per skill run in the main working tree before the first review: require `command -v claude`, then run `claude auth status`. A missing binary or failed authentication makes the peer unavailable, except that a set `ANTHROPIC_API_KEY` downgrades a failed probe to classify-at-first-invocation. If the failure indicates an older CLI without the `auth status` subcommand, also classify at the first real invocation rather than marking the peer unavailable. On either classify-at-first-invocation path, an auth or usage failure on that invocation makes the peer unavailable for the rest of the run. Unavailability never fails or delays the own reviewer; record the reason and mention the peer forfeit once in the final summary.

On every review round while available, use named variables and quoted expansions to create the artifacts and launch the peer as a plain background shell process from the committed task working tree at the same moment as the own reviewer:

```bash
working_tree="/absolute/path/to/task-working-tree"
base_ref="main"
artifact_dir="$(mktemp -d "${TMPDIR:-/tmp}/address-tasks-peer.XXXXXX")"
peer_out="${artifact_dir}/peer.out"
peer_err="${artifact_dir}/peer.err"
prompt_file="${artifact_dir}/prompt"
prompt="$(
  printf '%s\n' "Review ${working_tree} against ${base_ref}; read ${artifact_dir}/commits.log and ${artifact_dir}/changes.diff, then follow the full prompt contract below."
  cat <<'PEER_REVIEW_PROMPT'
<the complete peer prompt, including verbatim task content>
PEER_REVIEW_PROMPT
)"
effort_args=()
# When the configured effort is not known to be high or xhigh:
# effort_args=(--effort high)

git -C "${working_tree}" log --oneline "${base_ref}..HEAD" > "${artifact_dir}/commits.log"
git -C "${working_tree}" diff "${base_ref}...HEAD" > "${artifact_dir}/changes.diff"
printf '%s\n' "${prompt}" > "${prompt_file}"
(
  cd -- "${working_tree}" || exit
  claude -p --safe-mode --tools "Read,Glob,Grep" --disallowedTools "mcp__*" --add-dir "${artifact_dir}" --output-format json "${effort_args[@]}" < "${prompt_file}" > "${peer_out}" 2> "${peer_err}"
) &
```

Replace the example values with the round's actual working tree, base, and complete prompt; the prompt must name both exact artifact paths. Writing the safely constructed prompt to a unique invocation file and feeding it through stdin keeps review-controlled backticks and `$()` out of shell evaluation. The redirects are the capture contract: every invocation gets separate stdout and stderr files, so JSON stdout stays parseable while diagnostics remain available. Keep `--safe-mode` and both examination-only tool guards; never pass permission-bypass or autonomy flags.

Use the peer's configured high-capability model. If its configured effort is not known to be high or xhigh, request `--effort high` without overriding a known stronger setting; never request `max`. Allow a loose timeout of about 12 minutes, with discretion to wait longer for an expected wide review. After each attempt's output has been read or the attempt has been classified as timed out or failed, remove its artifact directory, including both capture files, before retrying or continuing. On timeout or transient failure, retry once (two attempts total), then forfeit only that round. An auth or usage failure on a classify-at-first-invocation path disables the peer for the rest of the run.

The peer is **examination-only**: it may use only `Read`, `Glob`, and `Grep`, with all MCP tools denied; it must edit nothing and run no builds or tests. Its prompt must include the working-tree path, base branch or commit range, the exact `<artifact-dir>/commits.log` and `<artifact-dir>/changes.diff` paths, the relevant task content verbatim, an instruction to read the actual files, and this output contract: `VERDICT: PASS | ISSUES`, followed by numbered findings tagged `blocking` or `minor`, each with `file:line` and a one-line rationale. The own reviewer retains the full-build-first contract, which makes the parallel launch safe.

Always wait for the own reviewer before deciding the round, and wait for the peer only when it was actually launched. Read only the available verdict lines for triage; do not summarize, merge, or rewrite their reports. Unintelligible peer output that lacks a parseable verdict and findings forfeits that round. When either reviewer reports issues, give the next fresh implementer the own-reviewer report and any available peer report verbatim as separately labeled **Reviewer findings** and **Peer (claude) findings** blocks.

A round passes only when the own reviewer passes and the peer, when it delivered an intelligible report, has no unaddressed grounded findings, whether `blocking` or `minor`. Only when a passing own review would otherwise be overturned by peer findings, cheaply spot-check that each gate-deciding `file:line` exists and its claim is not self-evidently false; discard and record ungrounded findings, but pass all other feedback through verbatim. Pure noise or stylistic churn against repository conventions may be pushed back with evidence; the next round's fresh own reviewer adjudicates disputes, and a rejected peer claim stops gating when that reviewer confirms it is not real.

Every implementer round counts toward the feedback-loop cap, whichever reviewer triggered it. Invoke the peer on every round while it remains available.

## Feedback Loop

When either reviewer reports issues:

> **Fix-ups always use a fresh subagent spawn — never a continuation of the prior implementer.** Fresh context is intentional: the fix-up agent reads the already-committed branch plus the reviewers' verbatim findings with no attachment to its earlier choices.

1. **Spawn a fresh `worker` implementer** (on its own, as in step 4). Do not continue the prior implementer thread with `send_input`; fresh context is intentional because the fix-up agent should read the committed branch plus the reviewers' findings without attachment to earlier choices. Include:
   - The original task file content.
   - Both the own reviewer's and peer's numbered findings verbatim as two labeled blocks; omit only a peer report that was unavailable, forfeited, or unintelligible that round.
   - The branch name (same as before).
   - Instruction to address each finding specifically and report what was fixed.
   - The same project context and validation instructions as the original implementer prompt.
2. After the fix-up implementer completes — and only then, in a later turn — **spawn a new reviewer agent** and launch the peer per the protocol above to re-check (same fresh prompt structure as before; never concurrent with the fix-up implementer).
3. Repeat until the own reviewer passes and the peer has no unaddressed grounded findings under the protocol above.
4. **Cap the feedback loop at 12 iterations.** This is a runaway-loop guard against arcane token bloat, not a quality dial; more legitimate rounds are expected with another reviewer. If issues persist after 12 rounds, stop iterating and do not open a PR for this task. Surface the outstanding findings clearly to the user in the final summary and ask for guidance on how to proceed.

## Hints

For serialized task batches, branch each new task from the previous task branch when the work is expected to depend on earlier changes.
This keeps the batch moving while review happens incrementally.

If a PR cannot be opened for any reason, still create the task branch and finish the implementation commits.
The user can open the PR manually later.

Prefer every commit to remain buildable, but do not treat that as an absolute requirement for intermediate checkpoints.
The completed task branch and final PR should be clean and pass validation.

## Final Output

After completing the batch, provide a concise summary:

- Which tasks were implemented and their PR links.
- How many review iterations each task required (and whether any hit the cap).
- Whether the peer participated; if it was unavailable or forfeited any rounds, note the reason once without treating it as a failure.
- Any observations outside the task descriptions worth flagging.
- Any blockers or uncertainties that remain.
