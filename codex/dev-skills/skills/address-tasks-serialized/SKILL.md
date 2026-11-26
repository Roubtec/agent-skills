---
name: address-tasks-serialized
description: A batch of pre-planned task files must be implemented strictly one after another on a single working tree. Trigger only when the user explicitly wants sequential single-branch execution - to stay within rate limits, or because parallel worktrees are unsuitable - or runs address-tasks-serialized; otherwise address-tasks is the default. Not for one-off coding requests or for planning new tasks (use write-tasks).
---

Implement the given task or a set of tasks using a delegated subagent workflow.

**Arguments:** `<mixed-list of task numbers, task-file paths, and globs to implement> [peer-opinions=off]`

`peer-opinions=off` is the only accepted explicit peer-opinion setting.
Omit it to use the default, which enables best-effort peer opinions.

## Task-pointer preflight

Before reading task dependencies, run `resolve-tasks` in a fresh resolution subagent with its own context window.
Hand it the complete raw task-pointer list, have it follow the shared resolver contract, and consume its task-resolution packet; do not scavenge or re-resolve task filenames in the orchestrator's context.
Reconcile the returned packet against the list you handed it: every deduplicated raw pointer must appear either in some path's `selectedBy` or as a `not-found` diagnostic, and a pointer the packet accounts for nowhere is a resolution failure to report, never a silently smaller batch; and no `selectedBy` or `not-found` raw value may name a pointer you never handed it — a packet that invents an input is the same resolution failure to report, never extra work to admit.

Use the packet's `selectedBy` provenance to apply policy.
A path selected by an explicit path or glob executes exactly as it did before this additive preflight, whether its report context is `active`, `done`, `deferred`, `ambiguous`, or `outside-subtree`; if both explicit and number provenance selected it, explicit selection wins.
A number-selected unambiguous `active` path executes normally.
An unmatched number, path, or glob never executes and its `not-found` diagnostic is always surfaced.

Mode selection is part of the invocation, not an inference from the task mapping: a direct skill invocation defaults to interactive whenever the maintainer can answer in the current session.
Use hands-off only when the maintainer explicitly requests it or the invoking runtime cannot accept mid-run input; a dynamic workflow that cannot pause for a decision uses the same hands-off policy.

In an interactive run, show the resolved mapping whenever the invocation contains any number input, including a number mixed with otherwise clean explicit pointers.
Also show the mapping whenever any input form produces a non-`active` classification or `not-found` anomaly.
Require an explicit continue decision when any number-selected full number is `done`, `deferred`, or `ambiguous`, or when any input is `not-found`: `done` means already delivered and is skipped unless the maintainer explicitly includes it; `deferred` means deliberately unscheduled and needs explicit inclusion; for each `ambiguous` number, ask the maintainer to select exactly one candidate or exclude that number — a blanket continue must never include every candidate.
Explicit path/glob selections remain executable while this decision is made.

In a hands-off run, execute only the number-selected unambiguous `active` paths plus every explicit path/glob selection.
Exclude and document every number-selected `done`, `deferred`, or `ambiguous` classification and every `not-found` input; never guess an ambiguous number.
Carry the complete mapping and exclusions into the run summary.

## Architecture

You are the **orchestrator**.
Your job is to sequence tasks, manage branches and PRs, and coordinate two specialized subagent roles per task:

- **Orchestrator** (you) — sequencing, branching, PR creation, progress tracking.
  Runs as the top-level agent.
- **Implementer** — deep implementation work for a single task.
  Spawned as a fresh `worker` subagent with a focused prompt.
- **Reviewer** — fresh-eyes acceptance check against the task definition.
  Spawned as a fresh `explorer` subagent with a focused prompt that forbids edits.

> **Critical — one agent at a time; Codex subagents share your working tree.**
> Unless you explicitly configured per-agent git worktrees, each subagent operates on the same checked-out branch and working tree as the orchestrator.
> Two checkout-dependent subagents running at once can race or corrupt each other's view of the repo.
> The invariant is about committed state, not about turn structure: **a reviewer may not start until its implementer's commits are on disk.**
> A harness may run spawns asynchronously — a spawn call can return immediately with an agent id and deliver its result as a later notification — so your obligation is to wait for that completion (and close the agent) before starting the reviewer.
> The general guidance to batch independent tool calls does not apply here: implementers and reviewers are not independent because they contend for one working tree.
> The examination-only peer CLI described below is the sole exception: launch it alongside the reviewer only after the implementation is committed, and forbid it from running builds or tests, so it remains a concurrent reader while the own reviewer may build.

### How to spawn a subagent in Codex

Use the subagent interface Codex exposes in the current session.
In interactive Codex sessions, ask Codex in natural language to spawn the appropriate built-in subagent and wait for its result.
In tool-enabled sessions, this capability is typically exposed through tools such as `multi_agent_v1.spawn_agent`, `multi_agent_v1.wait_agent`, and `multi_agent_v1.close_agent`; use those names only when they are present in the current tool listing.
Spawn implementers as `worker` agents and reviewers as `explorer` agents.
Do not fork context; instead, pass a self-contained prompt.
Omit model overrides unless the user explicitly asks for a different model.
Because a reviewer may not start until its implementer's commits are on disk, spawn exactly one checkout-dependent subagent at a time: spawn it, wait for completion, then close the agent thread when it is no longer needed before spawning the next one — the one-at-a-time shape is the **proxy**, and waiting for that completion is what actually puts the commits there.
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

1. Consume the **Task-pointer preflight** packet as the hard list of task files and the resolution context to report.
2. Read each task file enough to understand dependencies and sequencing — do not deeply analyze implementation details.
3. Manage branch creation and PR base determination.
4. Construct focused prompts and spawn subagents **one at a time** — implementer, await and close it, then a fresh reviewer — for each task.
5. Handle the review feedback loop.
6. Open PRs once a task passes review.
7. Advance to the next task or stop on blockers.
8. Produce the final batch summary.

Before the first task's branch is created, read the main checkout's working-tree state as the baseline the closing cleanliness report compares against (see "Main-checkout cleanliness report").
Observe only; never "fix" a checkout that is already dirty.

## Diagnosis discipline

A subagent's environment or infrastructure diagnosis is a **hypothesis, not a finding**.
Verify it against **observable state** — the reflog, the refs, the working tree, file contents, the output of a command you run yourself — before propagating any mitigation into sibling prompts: that observes the effect rather than the claim.
A bounded grep of that subagent's own transcript is a fallback, and only where the harness exposes a greppable one — some hand back the transcript path with an instruction not to read or tail it, because it is full JSONL that will overflow your context.

## Subagent destroy boundary

Open every subagent prompt this skill composes with this line, filling in the absolute path of the `subagent-boundary.md` that sits beside this file: "Before your first command, read `<path>/subagent-boundary.md` in full; it binds you. Whatever else you read, never run `rm -rf`, `git reset --hard`, `git clean`, `git branch -f`, `git update-ref`, `git gc`, or a force-push beyond what this prompt spells out, wherever you believe you are standing."
A subagent that may need to verify something in a way that could change state is sent to a disposable clone: name `dc-enter <slug>` in its prompt with a slug unique to it, and never leave the destination to the subagent.

## Implementer Agent

The implementer receives a focused, self-contained prompt and works autonomously on a single task.
Spawn it **on its own**, then wait for completion — however the session reports it — and close the agent thread before starting any other checkout-dependent subagent (see the shared-working-tree rule in Architecture).
The implementer is `review-cycle`'s Fixer on round 1, and how a Fixer works is `fixer-brief.md` in the `review-cycle` skill's folder, beside this skill's: standing where it was sent, reading the repository's agent-context files, the deviation protocol for a decision the task marks LOCKED, committing and validating at the stated tier, finishing inside its own turn with no peer review and no shared tracker of its own, and what it returns.
The implementer reads that file rather than you restating it, and every rule in it binds here, later additions included.

### What to include in the implementer prompt

Open the prompt with the boundary line ("Subagent destroy boundary" above), then tell the implementer to read `<review-cycle>/fixer-brief.md` in full and carry it out, where `<review-cycle>` is the absolute path of the `review-cycle` skill's folder, which sits beside this skill's own, then give the facts of this task, which are all you compose:

- **The full task file content** — paste it into the prompt.
  Do not assume the agent has prior context.
- **The working tree and the branch name** it should be working on, which it verifies before starting.
- **Relevant upstream context** — if this task depends on a previous task in the batch, briefly describe what the previous task introduced so the implementer can build on it.
- **The validation tier of this round**, per `review-cycle`'s two validation tiers: the round tier on an intermediate round, the delivery tier — the full applicable sanity set — on the state that concludes the task, before its PR.
- **An absolute path for validation output**, which you allocate — namespaced by this task's number or created with `mktemp -d`, and outside the working tree the implementer commits from.
  Any build or lint output that must land in a file goes there, never a fixed shared scratchpad name: one session's agents share that directory.
  Never leave the choice to the implementer.
- **This loop's own instructions, which the brief does not carry:** commit at logical milestones, keeping each commit buildable when practical; it is not alone in the codebase, so it must not revert unrelated edits made by others and should accommodate concurrent changes; it says which validation tier it ran; and its report adds any decisions, tradeoffs, deviations from the task description, and areas that may need focused review.
- **On a fix-up round**, what `review-cycle` hands a Fixer: every finding verbatim as separately labeled blocks, and the deviations and open questions that still stand.

### What the implementer should NOT receive

- The full batch context or other unrelated task files.
- Review feedback from unrelated prior tasks.

## Reviewer Agent

The reviewer is a **fresh** subagent with no knowledge of the implementation process.
It evaluates the current codebase state against two orthogonal dimensions: acceptance criteria compliance and implementation quality.
It must be a **fresh** subagent spawn — never a continuation of the implementer's thread.
Spawn it only **after** the implementer's commits are on disk — wait for that completion and close the implementer (see the shared-working-tree rule in Architecture).
Wait for completion and close the reviewer before the orchestrator advances branches or starts the next task.
How a Reviewer works is `reviewer-brief.md` in the `review-cycle` skill's folder, beside this skill's: whole touched files rather than diffs or commit messages, the build and type-check first at the stated tier, the acceptance criteria and then the quality pass (logic, error handling, edge cases, dead code, consistency, duplication, type safety), the empty-diff flag, editing nothing, no shared tracker, finishing inside its own turn, and **Pass** or a numbered **Issues** list.
The reviewer reads that file rather than you restating it, and every rule in it binds here, later additions included.

### What to include in the reviewer prompt

Open the prompt with the boundary line, then tell the reviewer to read `<review-cycle>/reviewer-brief.md` in full and carry it out, where `<review-cycle>` is the absolute path of the `review-cycle` skill's folder, which sits beside this skill's own, then give the facts of this review:

- **The full task file content** — same source of truth the implementer received, as a **code** artifact.
- **The current branch and the PR base branch name** (the branch this task will be merged into), which is what `git diff --name-only <base>...HEAD` scopes the touched files against.
  Tell it that with no base named it falls back to `main` and notes the fallback in its report.
- **That the implementation is already committed on the current branch**, so an empty diff at this stage is far more likely an orchestration error than real absence.
- **The validation tier of this round.**
- **An absolute path for validation output**, which you allocate — namespaced by this task's number or created with `mktemp -d`.
  Any build or check output that must land in a file goes there, never a fixed shared scratchpad name: one session's agents share that directory.
  This batch runs serially, but the session around it does not.
  Never leave the choice to the reviewer.
- **This loop's own instructions, which the brief does not carry:** it may follow references from touched files into untouched ones to judge consistency and call sites; it launches no review of its own beside the loop's sanctioned peer step; it must not create, update, or delete follow-up task files, and any suggested follow-up work belongs in the review report only; and each issue names its category (criteria gap, or which quality dimension), where in the code it is, and what needs to change.
- **Whatever the round has to adjudicate**, as `review-cycle` hands it to a Reviewer: declines, retired questions, and deviations still standing — each with the implementer's stated claim and nothing more of its report, the one exception to the list below.

### What the reviewer should NOT receive

- The implementer's summary, reasoning, or notes.
- Instruction to read commit messages or diffs.
  The reviewer may use git to list touched files (for scoping), but it should not read commit messages or `git diff` output, since both anchor the reviewer to the implementer's intent and to a line-by-line view that hides issues spanning the boundary between changed and unchanged code.
  Read whole files instead.

## Execution Model

Process the batch **sequentially**, not in parallel — and within each task, never start the reviewer until its implementer's commits are on disk (see the rule in Architecture).
Each task is its own delivery unit, but stack later task branches on top of earlier ones when needed so dependent work can continue without waiting for review.

### Determining the PR base

A PR's base must be the ref its branch actually builds on, so the PR shows the honest diff of that branch's own contribution and nothing else; that is what routes each review comment to the PR that owns the code it is about.

Use the following precedence:

1. **Explicit override** — if the user specifies a base branch (e.g. "make a PR against `main`"), use that for every task in the batch.
   If the user asks for no PR, skip PR creation entirely.
2. **Previous task branch** — for the second task onward in a serialized batch, branch from and target the previous task branch when the work depends on earlier changes.
3. **Current branch** — if neither of the above applies, the branch you are on when the batch starts is the PR base for the first task.

## Per-Task Workflow

For each task file in the input set:

1. **Record the PR base branch** for this task (see precedence rules above).
2. **Create a dedicated implementation branch** for the task.
3. **Read the task file** enough to construct a good implementer prompt.
   Identify the acceptance criteria so you can later evaluate the reviewer's report.
4. **Spawn the implementer agent** with a well-structured prompt (see Implementer Agent section).
   Wait for completion and close the agent.
5. **Evaluate the implementer's packet.**
   Apply `review-cycle`'s packet hard-check before adopting it: `git status --porcelain` empty **and** no Git operation in progress — check `git rev-parse --git-path rebase-merge` and `rebase-apply` for an existing path, plus `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG`, since a tree left mid-rebase or mid-cherry-pick prints empty porcelain.
   Either condition failing means redrive or resume that implementer, never silent adoption.
   If the implementer hit a blocker it could not resolve, stop and surface it to the user before spawning a reviewer.
6. **Only after step 5, spawn the reviewer agent** with a fresh prompt (see Reviewer Agent section) and launch the peer second opinion in the background at the same moment (unless unavailable or `peer-opinions=off`).
   Always wait for the reviewer before triage, and also wait for the peer when one was launched; then close the reviewer agent.
   The gate is the implementer's commits being on disk — you share one working tree, so a reviewer started before the commit reviews an unfinished branch; keeping it out of the implementer's natural-language turn or tool block is only the **proxy** for that gate.
7. **Evaluate the reviewer's report:**
   - If the report says the branch is **empty / has no implementation / shows an empty diff**, do not trust it at face value — that is the signature of a race (reviewer started before the implementer committed) or a wrong-branch checkout, not a real gap.
     Verify with `git diff --name-only <base>...HEAD`; if the work is actually present, spawn a fresh reviewer and use that verdict instead.
   - If the own reviewer **passes** and the peer has no unaddressed grounded findings under the protocol below: proceed to step 8.
   - If either feedback source has issues: enter the feedback loop (see below).
8. **Run the pre-PR collision guard below.**
   If this branch collides, do not open its PR; deconflict the flagged new claimant and send the changed branch through fresh review again.
   A held branch is not delivered and does not become the base of the next task.
9. **Open a PR** against the recorded base branch.
   - **First push the task branch** (`git push -u origin HEAD`), and push the recorded base too if it exists only locally (e.g. a dependency's not-yet-pushed branch).
     `gh pr create` on an unpushed branch prompts interactively for a push target, which hangs a delegated/no-TTY run.
     If the remote is unavailable (see the local-only fallback), skip the PR and record the branch as pending push instead.
   - Reference the task file in the PR description for context.
   - Include any reviewer-relevant caveats (tradeoffs, intentional divergences, uncertainties surfaced by the implementer or reviewer).
   - Do not restate the entire task unless doing so adds real review value.
   - **Assert the base on the PR you just created:** capture the URL `gh pr create` printed and read *that* PR back — `gh pr view <pr-url> --json baseRefName` — requiring it to equal the recorded base.
     Address it by URL rather than letting the current branch pick the PR, so a later change to where creation runs cannot redirect the check at some other PR.
     On a mismatch, repair it in the same breath (`gh pr edit <pr-url> --base <recorded-base>`) and record in the final summary which PR was repaired and what base it carried, so a genuinely wrong determination stays visible instead of being silently corrected; if the repair fails, report that PR as **delivered with the wrong base** rather than as delivered.
   - **If a creation attempt fails before printing a URL, the PR may exist server-side anyway.**
     Before retrying creation, look it up by the recorded head branch in the repository that owns the PR — the base repository the creation targeted, never the head repository, where a fork's PR does not live: `gh pr list --repo <base-repo> --head <branch-name> --state open --json url,headRepositoryOwner`.
     `--head` cannot carry an `<owner>:<branch>` form, so require the returned PR's head repository owner to match the recorded head before trusting the match, then assert its base as above.
     Only a lookup that finds nothing licenses the retry, and a delivery ending with neither a captured URL nor a lookup match is reported as that distinct failure, never as an opened PR.
10. **Continue to the next task** or, if this was the last one, produce the final summary.
    If you hit a blocker that prevents responsible progress, stop and ask the user for clarification.

## Pre-PR collision guard

The task-number guard below can surface an identical-path add/add clash between task files.
Hand only that already-identified case to this plain add/add procedure: hold the scanning branch, rename the flagged new claimant, regenerate derived files, and run fresh review again.
If the task path is imperative, hold the branch and ask the maintainer instead of inventing an invalid alternative.
The serialized flow does not add a second repo-wide scan of every open PR's other added paths, basenames, or exported symbols; the parallel skill retains its separate wave-local check for those surfaces.

### Task-number collisions across in-flight branches

Run this guard before opening any PR.
It is `task-numbers.sh` in the `write-tasks` skill's folder, a sibling of this skill's, run by its absolute path from the branch's working tree: `task-numbers.sh claims --repo <owner>/<repo> --base <the branch's recorded base>`, with `--folder <dir>` where the repository's task folder is not `tasks/`.
It fetches that base, reads what the branch adds and removes against it, and compares each task number the branch newly claims with the base's whole task tree and with what every open PR head adds.
`outcome=clean` (exit 0) means go on, and a branch that adds no task file gets it without a remote read.
On `outcome=collision` or `outcome=incomplete` (exit 3), read `task-number-guard.md`, in that same `write-tasks` folder, in full: it holds what collides, the comparison set and what each holder contributes, the renumber-the-flagged-new-claimant rule, the note-and-proceed reading of an incomplete scan, the local-base fallback, and what the snapshot does not promise.
Exit 1 is a read that failed, such as a base that could not be fetched: never a clean scan.

## Peer second opinion (best-effort)

Unless `peer-opinions=off`, run the `review-cycle` skill's peer step beside every review round.
Every rule that skill states under *The peer step* binds here whole, later additions included.

Deltas for this serialized skill:

- The peer's worktree is the orchestrator's single shared repository checkout path, not a separately created git worktree; launch it from the committed task checkout at the same moment as the own reviewer, with the relevant task content verbatim and the base branch or commit range in its prompt.
- Every implementer round counts toward the feedback-loop cap, whichever reviewer triggered it; invoke the peer on every round while it remains available, and mention an unavailable or forfeited peer once in the final summary.

## Feedback Loop

This loop is `review-cycle`'s: every rule that skill states under *The loop and its gates* binds it whole — the packet hard-check above, the no-latched-flags rule for whatever this loop carries into its final summary, the round cap, and every later addition — and the steps below are only this skill's deltas.

When either reviewer reports issues:

> **Fix-ups always use a fresh subagent spawn — never a continuation of the prior implementer.**

1. **Spawn a fresh `worker` implementer** (on its own, as in step 4).
   Do not continue the prior implementer thread with `send_input`; fresh context is intentional because the fix-up agent should read the committed branch plus the reviewers' findings without attachment to earlier choices.
   Include:
   - The original task file content.
   - Both the own reviewer's and peer's numbered findings verbatim as two labeled blocks; omit only a peer report forfeited under the `review-cycle` protocol.
   - The branch name (same as before).
   - Instruction to address each finding specifically and report what was fixed.
   - The same project context and validation instructions as the original implementer prompt.
2. Once the fix-up implementer's commits are on disk — wait for its completion — **spawn a new reviewer agent** and launch the peer per the protocol above to re-check (same fresh prompt structure as before; never concurrent with the fix-up implementer).
3. Repeat until the own reviewer passes and the peer has no unaddressed grounded findings under the protocol above.
4. **Cap the feedback loop at the `review-cycle` skill's round cap.**
   If issues persist at the cap, stop iterating and do not open a PR for this task.
   Surface the outstanding findings clearly to the user in the final summary and ask for guidance on how to proceed.

## Hints

If a PR cannot be opened for any reason, still create the task branch and finish the implementation commits.
The user can open the PR manually later.

Prefer every commit to remain buildable, but do not treat that as an absolute requirement for intermediate checkpoints.
The completed task branch and final PR should be clean and pass validation.

## Main-checkout cleanliness report

This batch runs on the repository's main checkout, which is shared — with the maintainer, and with any peer harness running in the same container.
Take a reading of its working-tree state before the first task's branch is created, and take the same reading again once **every** batch entry has reached a terminal state.
Trigger it on batch termination, not on "the last task delivers": a batch in which every task blocks, fails, or aborts never reaches a delivery.
Because the flow works in that very tree, the reading is about uncommitted and untracked residue left behind rather than about staying out of it — a stray is still a stray.

Compare the two **by path**, so a path whose status code changed reads as a re-classification — a co-tenant staging their own work — rather than as one path vanishing and another appearing.
Paths that appeared are a finding in the final report; paths that **disappeared** are a louder one, because a stray `checkout` or `clean` in the shared tree eating a co-tenant's uncommitted work is the hazard only a baseline can see.
Report a vanished path as something to check against co-tenant commits, the reflog, and the stash rather than as established loss: a maintainer who committed their own work mid-run also removes a baseline path, with nothing gone.
Everything else is pre-existing.
Take a baseline rather than testing for emptiness — the maintainer's own work-in-progress is deliberately permitted in that checkout.

**Report, never clean.**
Do not `git clean`, `checkout`, `reset`, or `stash` the shared main checkout on the strength of this report — another agent's uncommitted work is not yours to delete — and diff any stray against the delivered branches before touching it at all.

State the claim as narrowly as it is.
The report says what its reading could see change; it claims nothing about what was **written into** paths already present in the baseline, nor about anything its reading does not surface.
What it does surface is a report to verify, not a conclusion — the same reading cannot tell a stray from a co-tenant's ordinary progress.
It is never a proof that the batch wrote nothing, and must not be delivered as one.

## Final Output

After completing the batch, provide a concise summary:

- Which tasks were implemented and their PR links.
- How many review iterations each task required (and whether any hit the cap).
- Whether the peer participated; if it was unavailable or forfeited any rounds, note the reason once without treating it as a failure.
- Any observations outside the task descriptions worth flagging.
- The main-checkout cleanliness report: what appeared, what disappeared, and what was pre-existing — carried with the claim bound that section states, never as an assurance the batch left the tree untouched.
- Any blockers or uncertainties that remain.
