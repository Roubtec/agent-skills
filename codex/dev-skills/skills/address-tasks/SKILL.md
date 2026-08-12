---
name: address-tasks
description: Execute a batch of pre-planned task files in parallel using one git worktree per task — schedule independent tasks concurrently, run a sequential implement→review→fix loop inside each task's isolated worktree, open PRs, then create an unpushed local review stack without rewriting the PR branches. This is the default task-batch executor. Trigger when the user asks to address tasks, work through a task batch, kick off implementation of planned work, process a folder of task files, or fan out implementation across independent tasks. Do not trigger for one-off coding requests, for planning new tasks, or when strictly sequential single-branch execution is explicitly wanted (use `address-tasks-serialized` for that).
---

Implement a set of pre-planned task files using a **parallel, worktree-isolated** delegated subagent workflow.

**Arguments:** `<mixed-list of task numbers, task-file paths, and globs to implement> [peer-opinions=off]`

`peer-opinions=off` is the only accepted explicit peer-opinion setting. Omit it to use the default, which enables best-effort peer opinions.

## Task-pointer preflight

Before reading task dependencies, run `resolve-tasks` in a fresh resolution subagent with its own context window. Hand it the complete raw task-pointer list, have it follow the shared resolver contract, and consume its task-resolution packet; do not scavenge or re-resolve task filenames in the orchestrator's context.

Use the packet's `selectedBy` provenance to apply policy. A path selected by an explicit path or glob executes exactly as it did before this additive preflight, whatever its `active`, `done`, `deferred`, or `ambiguous` report context; if both explicit and number provenance selected it, explicit selection wins. A number-selected unambiguous `active` path executes normally. An unmatched number, path, or glob never executes and its `not-found` diagnostic is always surfaced.

In an interactive run, show the resolved mapping before executing a bare-numbers invocation. Require an explicit continue decision when any number-selected full number is `done`, `deferred`, or `ambiguous`, or when any input is `not-found`: `done` means already delivered and is skipped unless the maintainer explicitly includes it; `deferred` means deliberately unscheduled and needs explicit inclusion; for each `ambiguous` number, ask the maintainer to select exactly one candidate or exclude that number — a blanket continue must never include every candidate. Explicit path/glob selections remain executable while this decision is made.

In a hands-off run, execute only the number-selected unambiguous `active` paths plus every explicit path/glob selection. Exclude and document every number-selected `done`, `deferred`, or `ambiguous` classification and every `not-found` input; never guess an ambiguous number. Carry the complete mapping and exclusions into the run summary.

This skill is the parallel sibling of `address-tasks-serialized`.
The roles (orchestrator / implementer / reviewer), the implementer and reviewer prompt contracts, and the code-quality review checklist are inherited from that skill, and the peer second-opinion protocol is the `review-cycle` skill's — read those for the contracts and their rationale.
**What changes here is the execution model:** instead of one branch on one shared working tree processed strictly sequentially, each task gets its **own git worktree** so independent tasks can run **concurrently**, while each individual task still runs its implement→review→fix loop **sequentially**, bounded by the `review-cycle` round cap.

## Why worktrees change the rules

`address-tasks-serialized` will not let a reviewer start before its implementer's commits are on disk, because checkout-dependent Codex subagents normally share the orchestrator's single working tree — a reviewer spawned alongside its implementer scopes its diff against a branch the implementer hasn't finished committing to, sees nothing, and ships the work unreviewed.

A git worktree removes that constraint.
Each worktree is a **separate working directory with its own `HEAD` and index** (`.git/worktrees/<name>/`), while sharing the one common object store (`.git/objects`, append-only and concurrency-safe) and refs (lock-protected).
So:

- **Two subagents in two different worktrees never corrupt each other.** They touch different files, different indexes, different HEADs. Concurrent commits land on different branches under separate ref locks.
- Therefore the base skill's "one subagent at a time" rule is replaced by: **Codex subagents that operate in distinct worktrees may run concurrently; within one worktree, a subagent may not start until the previous subagent's commits are on disk.** The inherited examination-only peer CLI is the deliberate exception during review.
- **Within a single task, the implementer and its reviewer still share that task's worktree** — so that reviewer may not start until that implementer's commits are on disk. That is committed state, not turn structure: a spawn may return immediately and report completion as a later notification, so wait for that notification; "one-at-a-time, implementer first" is the proxy for it. The parallelism is strictly *across* independent tasks, never between a task's own implementer and reviewer.

### Durability

Worktrees are disposable working directories: the shared `.git` object store keeps every commit and branch ref even after a worktree directory is deleted.
The operating discipline that follows:

- Keep worktrees under a **gitignored base directory** (e.g. `.worktrees/` at the repo root) or outside the repository entirely, so worktree contents never show up in the main tree's status or get committed.
- **Commit early and often**, and **push after every commit** while the remote is available — a worktree's working tree is more volatile than committed-and-pushed history, and pushing provides remote durability and keeps the PR current. In the local-only fallback (Session Bootstrap's remote probe failed), commits are the durability boundary — push when access returns.
- Package managers with a content-addressed store (e.g. pnpm) make per-worktree installs cheap: when the store and the worktree share a filesystem, installs hardlink package files from the store instead of copying them, so many worktrees can install concurrently without multiplying disk usage.

## Session Bootstrap (run once, before any worktree)

Do this in the **main working tree** before creating worktrees.
The same bootstrap serves this skill and `address-reviews`:

1. **Choose the worktree base directory** (`$WT_BASE`): `.worktrees/` at the repo root, or a directory outside the repository. An in-repo base is `.worktrees/` or a path beneath it — the `wt-bootstrap` helper this bootstrap prefers reports `<repo>/.worktrees/$CONTAINER_NAME`, which is one — and nothing else: the ignore recipe that follows probes and appends exactly `/.worktrees/`, a root-anchored directory rule Git applies to everything beneath it, so a base under that name is carried by the very same append while one ANYWHERE ELSE in the repo would pass the re-probe while staying unignored. A base inside the repo has to BE ignored, and only this run makes it so: `git worktree add` excludes nothing on its own, so probe it with `git check-ignore -q "<repo>/.worktrees/"` — with the TRAILING SLASH, since `/.worktrees/` is a directory-only rule and `check-ignore` answers NO for a bare `.worktrees` that does not exist on disk yet, which is every first run — and, where it answers no, append `/.worktrees/` to the file `git rev-parse --git-path info/exclude` names — run it from inside `<repo>`, because in a primary checkout it answers with the RELATIVE `.git/info/exclude` (only a linked worktree gets an absolute path), so a `git -C <repo>` form whose answer you then append to from your own directory writes the rule to a file `check-ignore` never reads — then re-probe and make a still-no answer a blocker. Ask Git for that path rather than writing a literal `.git/info/exclude`: THIS checkout may itself be a linked worktree, where `.git` is a gitfile and `.git/info` is not a directory at all, so the literal append fails outright and the protection is never established — while `--git-path` resolves to the shared exclude file that `check-ignore` actually reads, in a linked worktree and a primary checkout alike. It is the repo-local ignore file, untracked and so dirtying nothing itself, and NOT the tracked `.gitignore` — an ignore edit dirties the main checkout mid-run.

2. **Prune stale state:** run `git worktree prune`, then remove any orphaned directories under the base — directories whose git worktree registration is gone (`git worktree list` no longer shows them). Never remove a directory that is still a registered worktree.

3. **Probe remote access:** `git ls-remote --heads origin`. Verify this up front — if pushes can't work, decide the fallback now, not mid-wave. A failure is **not** a blocker: fall back to **local reviewed branches only** and note in the final summary that PRs/pushes were skipped.

4. **Measure free disk space** on the base directory's filesystem (`df -k "$WT_BASE"`) — the starting input for Adaptive throttling below.

5. **Preflight the peer once** unless `peer-opinions=off`, per the `review-cycle` skill's peer preflight. Peer unavailability is never an error; proceed with own reviewers and note the reason once in the final summary.

6. **Baseline the shared main checkout** — read its working-tree state now, before any worktree exists, as the reading the closing cleanliness report compares against (see "Main-checkout cleanliness report"). Observe only; never "fix" a checkout that is already dirty.

If a `wt-bootstrap` helper is on PATH, prefer it for steps 1–4 — it performs those worktree checks, prunes orphans, and prints the base dir (`wtBase`) and free space (`availBytes`) as JSON. It covers those and nothing else: run every remaining step above yourself.

## Codex subagent execution

Use the subagent interface Codex exposes in the current session.
In interactive Codex sessions, ask Codex in natural language to spawn the appropriate built-in subagents and wait for their results.
In tool-enabled sessions, this capability is typically exposed through tools such as `multi_agent_v1.spawn_agent`, `multi_agent_v1.wait_agent`, and `multi_agent_v1.close_agent`; use those names only when they are present in the current tool listing.

Spawn implementers as `worker` agents and reviewers as `explorer` agents.
Do not fork context; instead, pass each subagent a self-contained prompt with the full task content and the worktree contract.
Omit model overrides unless the user explicitly asks for a different model.
After each subagent finishes, close that agent thread when it is no longer needed.
No custom agent personas (`~/.codex/agents/*.toml`) are required.

Parallelism is allowed only across subagents that are assigned distinct worktree paths.
Within one task's worktree the rule is committed state: that reviewer may not start until that implementer's commits are on disk. A spawn call returns an agent id immediately and reports completion later, so spawn the implementer, wait for that completion, close it, and only then spawn a fresh reviewer — waiting is what puts the commits there, and the spawn-wait-spawn ordering is the proxy, not the rule.
Never continue the implementer thread for review.
If the current session exposes no subagent capability, tell the user this skill requires Codex multi-agent support.
Only fall back to doing the implementation locally if the user explicitly approves that change in workflow.

## Orchestrator Responsibilities

You are the orchestrator.
You MUST NOT do implementation work yourself (except the trivial-task escape hatch below).
Your responsibilities:

1. Consume the **Task-pointer preflight** packet as the hard list of task files and the resolution context to report.
2. Run the **Session Bootstrap** above.
3. Build a **dependency graph** across the tasks and group them into **waves** (see Scheduling).
4. For each wave, create one worktree per task on the right base branch, then drive each task's implement→review→fix loop — fanning the loop's same-phase subagents out **concurrently** across the wave's tasks.
5. Push branches, open PRs against the resolved base, and track progress.
6. Clean up finished worktrees.
7. Build a **local review stack** from disposable copies of the mergeable branches — delegated to the `rebase-stack` skill in a subagent, never pushed and never rewriting the PR branches (see Post-batch restack).
8. Produce the final batch summary.

**Trivial-task escape hatch:** for a genuinely trivial task (single obvious change, unambiguous criteria) you may implement it directly in its worktree without an implementer subagent — but still spawn a fresh reviewer.
No task skips review.

## Scheduling: dependency waves

True parallelism only helps for tasks that don't depend on each other.
Determine dependencies from the task files (an explicit "Depends on" field, shared infrastructure, or files/modules two tasks both create or migrate).
When in doubt, treat tasks that touch the same files or migrations as dependent.

- **Wave** = the set of tasks whose dependencies are all already complete. All tasks in a wave run **concurrently**.
- Tasks with **no** unmet dependencies form wave 1; tasks depending on them form wave 2; etc.
- **Base branch per task.** A PR's base must be the ref its branch actually builds on, so the PR shows the honest diff of that branch's own contribution and nothing else; that is what routes each review comment to the PR that owns the code it is about. A dependent PR opened against `main` instead presents its parent's commits as its own work and collects the comments its parent's PR should have had.
  - Independent task (wave 1, or no dependency in-batch) → branch from and PR against the user's chosen base (default `main`, or an explicit override).
  - Dependent task → branch from and PR against its **dependency's branch** (stacked PRs), so it builds on work that may not be merged yet.
  - If a task depends on *several* tasks, branch from an integration branch that merges them, or from the single dependency it most directly extends — pick the simplest base that contains the code it needs and note the choice.
  - **Building a multi-parent integration branch is the orchestrator's job** — a bounded exception to "the orchestrator does not implement." Creating the branch and resolving its merge conflicts is small, mechanical, and a prerequisite for the wave rather than task work, so do it yourself rather than delegating. Keep the merge minimal, build/lint the result before branching any task off it, and record any non-trivial conflict resolutions (in the batch summary or a short merge-advice note) so they can be reproduced when the stack later lands on `main`.
- Start a wave only after every task it depends on has **passed review** (its branch is stable enough to build on).

If the whole batch is a linear dependency chain, this degrades gracefully to one task per wave — i.e. effectively sequential, like `address-tasks-serialized`, but still worktree-isolated.

## Adaptive throttling (width from real constraints)

Default to the wave's full dependency-derived width, bounded only by resources actually available to the run.
If nine independent tasks are ready and nine worker slots plus their worktrees are supportable, launch nine implementers; do not impose an arbitrary small starting width merely because the run is unattended.

Throttle only for an objective constraint or a concrete reason to anticipate one: unavailable agent/process slots, measured storage headroom, shared exclusive resources, or observed provider pressure.
If breadth causes failures, preserve completed and viable in-flight work, then reduce subsequent implement/review phases enough to avoid repeating the same failure rather than restarting partially completed tasks.
Concretely, before and during each wave:

- **Storage headroom.** Before launching a wave, measure free space on the worktree base's filesystem (`df -k "$WT_BASE"`, re-measured mid-run as needed; if you used the `wt-bootstrap` helper, it already reported this as `availBytes`). Estimate `per_worktree_need`, then cap width at `max_concurrent = max(1, floor(free_bytes / per_worktree_need))`; if that is below the wave's task count, run the wave in **sub-batches** of `max_concurrent` rather than all at once. When the package store hardlinks into worktrees (same filesystem), `per_worktree_need` is mainly build artifacts plus package metadata; otherwise, measure one representative install and add its full package-copy cost. When unsure, measure one install before fanning out.
- **`ENOSPC` mid-wave.** Stop adding concurrency, let viable in-flight tasks finish, and reclaim only worktrees whose changes are committed and pushed. Then retry the failed and remaining tasks in smaller sub-batches — ultimately one at a time. Never force-remove a worktree with uncommitted changes just to free space, and never abandon a task because the parallel attempt failed.
- **Shared exclusive resources.** Some validation cannot run two-at-once even in separate worktrees because it contends for a single host-wide resource: a fixed listen port, one shared dev database on one port, or a build/e2e server that infers the workspace root from the repo-root lockfile (see below). Run such phases **serially** regardless of wave width — give each task exclusive use, then move on.
- **Provider rate-limiting.** Repeated rate-limit / overload errors when spawning many subagents at once are a signal to fan out less. Reduce the number of concurrent subagents per phase and proceed.

Record in the final summary whenever you throttled below the dependency-derived width, and why — it tells the user whether the run was storage-bound, provider-bound, resource-serialized, or genuinely serial by dependency.

### App-server / e2e validation in a worktree

Validation that boots a *built* app server is the most common thing that won't run from inside a worktree. Next.js `next build` standalone output and Playwright's `webServer` both infer the workspace root from the repo-root lockfile, then look for the server at a path that ignores the nested `.worktrees/<slug>/` prefix — so `test:e2e` can't find the server and self-skips or errors. This is a repo-config limitation, not something the worktree skill can fix from the outside; handle it by choosing one of these, in order of preference:

1. **Run that task's e2e phase serially in the main checkout** after its branch is pushed: from the main tree, **check out the branch tip detached** (`git checkout --detach <branch>`) — a plain `git checkout <branch>` fails with `fatal: '<branch>' is already used by worktree ...` because the branch is still checked out in the task's worktree — then build, run e2e, and restore the main checkout's prior HEAD. (Or remove the task's clean worktree first, then check out the branch normally.) This keeps unit/integration coverage in-worktree and serializes only the part that needs the un-nested path.
2. **Defer e2e to CI** and rely on the in-worktree unit/integration suites for the in-loop signal, noting in the PR that e2e runs in CI.
3. **Run it in-worktree only if the repo's config is worktree-aware** (resolves the standalone/server path from `next build`'s actual output dir rather than assuming repo root).

Treat a task whose acceptance hinges on app-server e2e as a **serialize-this-phase** task per the shared-resource rule above, and say so in the summary. (Browser availability itself is fine in-worktree: `npx playwright install chromium`, or point Playwright at a system Chromium if your environment provides one via `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` — the worktree problem is the server path, not the browser.)

## Per-wave execution

For a wave of tasks `T1..Tn`:

1. **Create a worktree per task** from the main tree (orchestrator calls; safe to run while other waves' subagents are active — they touch only their own worktrees):

   ```bash
   task_slug="001-short-name"
   branch_name="task/001-short-name"
   base_branch="main"
   worktree="$WT_BASE/$task_slug"

   git worktree add "$worktree" -b "$branch_name" "$base_branch" # new branch off the base
   git worktree add "$worktree" "$branch_name"                    # rerun: attach the existing branch
   ```

   `$WT_BASE` is the base directory chosen in Bootstrap.
   Make this **rerun-safe**: check `git worktree list` first — if the task's worktree already exists, it must have the expected branch checked out (reuse it, prior commits intact); if it is on a different branch, or the base does not resolve, **stop and report rather than guessing**.
   If the branch already exists from an interrupted prior run, attach it (second form) instead of creating it with `-b`.
   If a `wt-enter <slug> <branch> <base>` helper is on PATH, prefer it — it encodes exactly these checks and prints the worktree's absolute path.
   Use a stable, collision-free slug per task (e.g. the task number + short name).
   The worktree's absolute path is what you hand to that task's subagents.

2. **Run each task's loop, fanned out by phase.** Each task runs its own implement→review→fix loop, but you advance all of the wave's tasks **in lockstep by phase** so that same-phase subagents (which live in different worktrees) can be spawned **together in one natural-language turn or tool-call batch and run concurrently**:

   - **Phase A — implement:** spawn one `worker` per still-unfinished task in the wave, each pointed at its own worktree path, all together. Wait until every implementer has completed, then close the finished implementer threads.
   - Adopt each returned implementation packet only under `review-cycle`'s packet hard-check: `git -C <worktree> status --porcelain` empty **and** no Git operation in progress (`rebase-merge`/`rebase-apply` paths, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG` — a tree left mid-rebase prints empty porcelain). Either failing means redrive or resume that task's Phase A rather than handing Phase B a worktree nobody can build on. The rest of that skill's *The loop and its gates* binds this loop whole too, later additions included.
   - **Phase B — review:** spawn one fresh `explorer` reviewer per task only once that task's implementer's commits are on disk — its packet returned and adopted under the hard-check above — each in its task's worktree, all together; waiting for and closing *all* Phase-A implementers is the proxy for that committed state in this lockstep loop, not the rule. At the same moment, unless `peer-opinions=off`, launch one background peer per task while the peer remains available. Every rule the `review-cycle` skill states under *The peer step* binds this batch whole, later additions included. Share that section's one session-local adaptive throttle across every task and round, queue launches it holds, and surface every step-down in the batch summary. Before triage, wait for every task's own reviewer and for every peer actually launched; then close the finished own-reviewer threads.
   - A task exits the loop only when its round passes the `review-cycle` gate; tasks with issues carry both reports verbatim as separately labeled blocks into the next round's Phase A, under that skill's grounding, blocking-and-minor gating, dispute, timeout/retry, and forfeit rules — never re-summarized.
   - Repeat A→B until each task converges or hits the `review-cycle` round cap; a task still failing at the cap does **not** get a PR — surface its outstanding findings to the user.

   > The per-task discipline is committed state: a task's reviewer never starts until that task's implementer's commits are on disk. Phase ordering is the proxy that keeps them there — waiting out every sibling implementer as well is more than the rule needs, and it is what buys cross-task parallelism without ever running a task's own implementer and reviewer at the same time.

   Concurrency is safe here **only because each subagent has its own worktree**.
   If for any reason a task is not running in its own worktree, fall back to serializing that task as in `address-tasks-serialized`.

3. **Before delivery, run the pre-PR collision guards below** across the wave's reviewed-passing branches.
   For non-colliding tasks, push and open a PR (see Delivery), then remove the task's worktree per Cleanup to reclaim storage (the branch and its commits persist in `.git` and on the remote).
   For colliding tasks, do **not** open the PR yet; leave the worktree in place, reconcile the naming/path, symbol, or task-number conflict, regenerate derived files, and re-review that task before delivery.

4. When the wave is fully resolved, unlock the next wave (dependents can now branch from these stable branches).
   A branch held for a collision is not resolved and must not unlock its dependents.

### Guarding against pre-PR collisions

Independent tasks in the same wave run in **separate worktrees**, so two of them can each *add* the same new file — or a file exporting the same top-level class/symbol — with no conflict at implementation time.
The clash only surfaces later, when the branches linearize or merge (an add/add conflict, or a duplicate definition).
It is rare, but it has happened; the preventive and wave-level checks below keep those clashes from costing a fix-up round.
The task-number guard that follows extends the pre-PR check to task-number claims across the wider in-flight comparison set.

- **Prevent it up front.** When you fan out two independent tasks that both introduce the same *kind* of new surface (a "reconciliation controller", a "work-list endpoint", a migration helper), assign each a **distinct file and class name** in its implementer prompt.
  The implementers can't see each other, so the disambiguation has to come from you.
- **Catch it before the PRs.** After a wave's tasks pass review but **before** opening their PRs, compare what each sibling branch newly added:

  ```bash
  wave_branches=("task/001-first" "task/002-second")
  declare -A branch_bases=(
    ["task/001-first"]="main"
    ["task/002-second"]="main"
  )

  # Exact same new path.
  for branch in "${wave_branches[@]}"; do
    base="${branch_bases[$branch]}"
    git diff --diff-filter=A --name-only "$base...$branch"
  done | sort | uniq -d

  # Same new basename at any path; inspect repeated first columns.
  for branch in "${wave_branches[@]}"; do
    base="${branch_bases[$branch]}"
    git diff --diff-filter=A --name-only "$base...$branch" |
      awk -v branch="$branch" '{ n=split($0, p, "/"); print p[n] "\t" branch "\t" $0 }'
  done | sort
  ```

  A duplicated path (or basename, or a shared exported top-level class/function/const/interface/type/enum name across two added files) is a collision.
  Hold the colliding branch(es) before PR delivery, then **deconflict — that call is yours to make** (a bounded exception to "the orchestrator doesn't implement", like building an integration branch): there is no inherent "first", so pick the side(s) whose rename is least disruptive, rename enough files and/or symbols that at most one branch keeps the original colliding value, regenerate anything derived (e.g. contracts), and **re-review each changed task with fresh eyes at the delivery tier** before its PR (the rename and the regeneration are a post-run change, so they void that task's own delivery-tier pass and owe it again); any unchanged non-colliding side then delivers unchanged.
  If the shared name is **imperative** — a framework-mandated path, an external/published contract, or a name a task file explicitly pins — do **not** invent a divergent name: keep those branches held and surface it as a design decision for a human.
  Diff each branch against **its own base** with the three-dot form so a dependent branch that legitimately builds on a sibling isn't flagged — it never re-lists an inherited file.

#### Task-number collisions across in-flight branches

Run this guard before opening any PR that adds task files. It is defined once, in `address-tasks-serialized` → "Task-number collisions across in-flight branches", and is deliberately not restated here: the full-number parsing, the comparison set and what each member contributes, the base-refresh and PR-head enumeration recipes with their note-and-proceed degradations, the same-branch relocation pairing, the renumber-the-flagged-new-claimant rule, and the bounded-snapshot caveat with its `reap-tasks` backstop all apply verbatim. The one reading specific to this skill: where that definition establishes the first claimant in the *run's* deterministic delivery order, use this skill's **wave** order (dependency or scheduling order, then task number).

## Diagnosis discipline

A subagent's environment or infrastructure diagnosis is a **hypothesis, not a finding**. Verify it against **observable state** — the reflog, the refs, the working tree, file contents, the output of a command you run yourself — before propagating any mitigation into sibling prompts: that observes the effect rather than the claim. A bounded grep of that subagent's own transcript is a fallback, and only where the harness exposes a greppable one — some hand back the transcript path with an instruction not to read or tail it, because it is full JSONL that will overflow your context. A scratch-filename collision was once misdiagnosed as a working-directory bug, and the wrong mitigation rode into roughly ten later subagent prompts before anyone checked.

## Subagent destroy boundary

State this in every subagent prompt this skill composes. A reviewer subagent authorized to verify a claim empirically once ran `rm -rf ./*` in a shared main checkout: its setup `git clone … | tail` had failed invisibly under `set -e` (a pipeline's status is its last command), so it deleted tracked files and moved a branch ref while believing it stood inside a clone.

- **Permitted:** reading, searching, and read-only `git`/`gh` queries — plus, for a fixer or implementer, edits, commits, and pushes confined to its own assigned worktree and branch.
- **Forbidden, named outright:** `rm -rf`, `git reset --hard`, `git clean`, `git branch -f`, `git update-ref`, `git gc`, and force-pushing — each of them beyond what the prompt itself spells out, whether as an exact command or as a skill it names to invoke. A subagent may not self-authorize one by putting itself somewhere it believes is safe — forbidden **not in a clone, not in a temp directory, not "safely"**. What you spelled out, and the disposable location below, are the only exemptions — and only because you named them.
- **A worktree is not a blast radius.** It isolates the working tree, not the repository: `branch -f`, `reset`, `update-ref`, and `gc` all reach every sibling worktree through the shared `.git`.
- **Any repository other than the subagent's own checkout is addressed by path.** `git -C <absolute path>`: never derive a working directory from a glob, and never chain a state-changing git command after a `cd` whose success you have not checked. A fix-up subagent ran `cd "$(ls -d <scratchpad>/tmp.*)" ; git commit …` where concurrent siblings had created scratch directories of their own — the glob expanded to three paths, the `cd` failed, and the `;`-chained commands landed in the shared main checkout, putting a commit on `main`.
- **Empirical verification that could change state goes where you send it.** Where `command -v dc-enter` finds the helper, send the subagent to `DC="$(dc-enter <slug>)"` — one absolute path on stdout, dropped again with `dc-remove <slug>`; a reused slug is refused rather than re-derived, so anything that may run twice passes `--replace` or removes the slug first. Where the helper is absent, name an absolute path outside the repository — never a relative one. Never leave the choice to the subagent. Give it the guarded `cd` too: `cd ""` returns 0 and moves nowhere, so checking the status catches nothing and a failed lookup leaves the subagent in the shared checkout — the form is `cd -- "${DC:?dc-enter returned no path}"`, with `pwd` confirmed before the first command that writes.

## Implementer Agent

Same contract as `address-tasks-serialized`, plus a **worktree isolation contract** and **push-every-commit**.
Launch implementers as `worker` subagents described in per-wave Phase A.

Include in each implementer prompt:

- A **WORKTREE CONTRACT** as the very first instruction:
  - "Your worktree is `<absolute worktree path>`. Before anything else, `cd` into it and verify: `git rev-parse --show-toplevel` MUST print exactly that path. If it does not, STOP and report — do not run any git or edit command outside this path."
  - "Do all work inside this worktree only. Never `cd` to the repository root, never touch sibling worktrees or the main checkout. You are not the only agent in this repository; other agents are working in other worktrees concurrently — stay in yours."
- The **branch name** (already checked out in the worktree) and instruction to confirm it with `git branch --show-current`.
- The **full task file content**, pasted in. Do not assume prior context.
- Instruction to **read the repository's agent-context file** (`AGENTS.md` / `CLAUDE.md` / `.github/CLAUDE.md`) for conventions.
- **Upstream context:** if this task builds on a dependency task, briefly describe what that task introduced (and that the worktree was branched from it, so that code is already present).
- **Commit, push, and validation instructions:**
  - Commit at logical milestones, keeping each commit buildable when practical.
  - **After every commit, push while the remote is available** (per Bootstrap's remote probe): `git push -u origin HEAD` on the first push, `git push` thereafter. Worktrees are disposable, so pushing is the backup. **In a known local-only run (Bootstrap's probe failed), skip pushing entirely** and rely on commits for durability — don't retry a push you already know will fail every commit; if a push unexpectedly fails mid-run, keep committing and note it — commits still persist locally.
  - Validate at the tier this round's brief states, per `review-cycle`'s two validation tiers: the round tier on an intermediate round, the delivery tier — the full applicable sanity set — on the state that concludes the task, before its PR. Say which you ran. The push-after-every-commit discipline above is durability, not delivery, and never raises the tier.
  - Any build or check output that must land in a file goes inside this worktree (a gitignored path, removed before any commit), never a shared scratchpad filename — two concurrent agents both redirecting to `<scratchpad>/verify.log` once crossed results between worktrees.
- **Coordination:** it must not revert unrelated or concurrent edits, and must accommodate that its base branch may itself be a sibling task's branch.
- **Finish inside your own turn.** Nothing resumes a subagent, so tell the implementer never to end its turn waiting for a notification or for a child it launched: it bounds and waits on anything it starts and reaps it before returning, leaving no process of its own running. It launches no peer review of its own either — the loop's peer step is the sanctioned second opinion (see `review-cycle`).
- **Reporting:** when done, report what was implemented, decisions/tradeoffs/deviations, and any areas needing focused review.

On a fix-up round, spawn a fresh `worker` implementer for the task; do not continue the prior implementer thread with `send_input`. Fresh context is intentional because the fix-up agent should read the committed worktree plus the findings without attachment to earlier choices. Paste both reports verbatim as separately labeled own-reviewer and peer blocks, omitting only a peer report forfeited under the `review-cycle` protocol, and instruct the implementer to address each finding specifically and report what changed (same branch, same worktree).

## Reviewer Agent

Same fresh-eyes contract and code-quality checklist as `address-tasks-serialized`.
A reviewer is always a **fresh** `explorer` subagent spawn, never a `send_input` continuation of the implementer, launched only once that task's implementer's commits are on disk — wait for its completion notification and close it. In this lockstep loop that means **after** every Phase-A implementer in the wave has returned, which is the proxy for the commits being there rather than the rule itself.

Include in each reviewer prompt, beyond that inherited contract — which binds whole, later additions to it included:

- The same **WORKTREE CONTRACT** first: "Your worktree is `<absolute worktree path>`. `cd` into it and confirm `git rev-parse --show-toplevel` matches before doing anything. Review only this worktree."
- The **full task file content** (same source of truth the implementer got).
- The **PR base branch** for this task. After assigning it and the task worktree to the shell variables `base` and `worktree`, the reviewer scopes with `git -C "$worktree" diff --name-only "$base"...HEAD`. The implementation is already committed on the current branch in this worktree — the reviewer must read the actual files and must NOT conclude "no implementation" without first confirming the diff is genuinely empty (an empty diff at this stage signals a wrong worktree/branch, not real absence — say so rather than reviewing nothing).
- Instruction to run the **build / type-check first at the validation tier this round states** (a failure at that tier is an automatic blocker; do not block on a heavier suite the stated tier did not run), then check each acceptance criterion against the code, then a code-quality pass over the touched files using the inherited checklist (logic, error handling, edge cases, dead code, consistency, duplication, type safety).
- **Where validation output goes:** any build or check output that must land in a file goes inside this task's worktree (a gitignored path, removed before any commit), never a shared scratchpad filename. Two concurrent reviewers both redirecting to `<scratchpad>/verify.log` once had one reading the other worktree's results and returning a verdict for the wrong branch.
- Reporting format: **Pass** (all criteria met, build passes, no material issues) or **Issues** (numbered, each with category + file/line + what's wrong + what to change).
- **Do NOT edit, create, or delete any files** — the worktree-local validation output file above is the sole exception. **Do NOT read commit messages or `git diff` content** — list touched files for scoping only, then read whole files. Be strict but fair; flag real gaps, not style nits. Put any follow-up suggestions in the report only.

## Delivery (push + PR, per task)

Default behavior, matching the existing workflow: each task that passes review gets **pushed and a PR opened** against its resolved base.

1. **While the remote is available** (per Bootstrap's probe), ensure the final state is pushed — the implementer already pushed its branch during the loop: `git -C <worktree> push`. In a known local-only run (Bootstrap's probe failed), there is nothing to push; skip to the local-branch fallback in step 3.
2. Open the PR against the recorded base branch (the chosen base for independent tasks; the dependency's branch for dependent tasks → stacked PR). **If the recorded base exists only locally — a synthetic multi-parent integration branch, or a dependency branch not yet pushed — push it to the remote first** (`git push -u origin <base-branch>`); otherwise `gh pr create --base <base-branch>` fails because GitHub has no such base ref:

   ```bash
   gh pr create --base <base-branch> --head <branch-name> --title "<task title>" --body "<summary>"
   ```

   - Reference the task file for context. Include reviewer-relevant caveats (tradeoffs, intentional divergences, uncertainties).
   - For stacked PRs, note in the body which branch it stacks on, so reviewers understand the base.
   - **Assert the base on the PR you just created:** capture the URL `gh pr create` printed and read *that* PR back — `gh pr view <pr-url> --json baseRefName` — requiring it to equal the recorded base. Address it by URL rather than letting the current branch pick the PR: creation runs here in the main checkout, not in the task's worktree, so an argument-less `gh pr view`/`gh pr edit` would answer for the main checkout's branch — some other PR, or none. On a mismatch, repair it in the same breath (`gh pr edit <pr-url> --base <base-branch>`) and record in the final summary which PR was repaired and what base it carried, so a genuinely wrong determination stays visible instead of being silently corrected; if the repair fails, report that PR as **delivered with the wrong base** rather than as delivered.
   - **If a creation attempt fails before printing a URL, the PR may exist server-side anyway.** Before retrying creation, look it up by the recorded head branch in the repository that owns the PR — the base repository the creation targeted, never the head repository, where a fork's PR does not live: `gh pr list --repo <base-repo> --head <branch-name> --state open --json url,headRepositoryOwner`. `--head` cannot carry an `<owner>:<branch>` form, so require the returned PR's head repository owner to match the recorded head before trusting the match, then assert its base as above. Only a lookup that finds nothing licenses the retry, and a delivery ending with neither a captured URL nor a lookup match is reported as that distinct failure, never as an opened PR.
3. If pushing/PR creation is unavailable (no remote auth — see Bootstrap step 3), fall back to **local reviewed branches**: the work persists in the shared `.git`. Note in the final summary which branches still need to be pushed once a remote is reachable.

After the PR is open, remove the task's worktree per Cleanup to reclaim storage.
Do not delete the branch — the PR and any dependents need it (removing a worktree never touches branches).

## Cleanup

- Remove each task's worktree once its PR is open (or once you've decided to stop on it). First verify it is safe: `git -C <worktree> status --porcelain` must be empty and no Git operation may be in progress (no `rebase-merge`/`rebase-apply` paths, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, or `BISECT_LOG` under its git dir — the same six the packet hard-check names, and for the same reason: the last three can print empty porcelain, so a porcelain-plus-rebase-only check clears a tree nobody should remove). Then `git worktree remove <path>`. **Never force-remove a worktree with uncommitted changes or an in-progress Git operation** — `git worktree remove --force` destroys that work; if the checks fail, leave the worktree in place and report why rather than deleting evidence. Use `--force` only to clear git's refusal over leftovers like ignored build artifacts *after* the clean checks pass. If a `wt-remove` helper is on PATH, prefer it — it enforces the full set itself (even with `--force`), so the enumerated list is the helper-absent fallback.
- After removing a worktree, run `git worktree prune` to clear its stale registration.
- Removing a worktree does not delete its branch; future dependent waves can still branch from that ref after the worktree is gone.

## Post-batch restack: a local review stack (never pushed)

After Delivery and Cleanup, build one linear **local** stack in the order you recommend reviewing and merging the PRs.
This is an integration check and merge-order guide; it is **never pushed**.

Do **not** rebase the task/PR branch names themselves.
Those local refs should continue to match the pushed PR heads; rewriting them locally creates misleading ahead/behind state and makes later pull/push operations error-prone.
Instead, create disposable `review-stack/...` branches that snapshot the canonical task branches, then rebase only those guide branches.
The guide refs persist in the repo's `.git`, while the PR branches and remote PRs remain unchanged.

**Skip it when** the batch produced **0 or 1** mergeable branch.
Exclude branches that failed review or that the user asked to skip.
If the batch was already a linear dependency chain, still build the guide stack: it verifies the chain against the current local base without risking the PR refs.

**Compute the order yourself.**
Reuse the dependency graph and emit a topological order: every dependency precedes its dependents.
Break ties between independent branches deterministically: keep closely related areas adjacent, then fall back to task number.
Record the order using the canonical task branches as `b1 → b2 → … → bN`, rooted at the chosen local base, where `b1` is the recommended first merge.
Dependency edges are binding; the relative order of independent branches is only a stable review recommendation, not a newly invented dependency.

Before creating guide branches, inspect each canonical branch's unique history relative to its recorded PR base for merge commits.
If the batch used a synthetic multi-parent integration branch, or `git rev-list --merges <pr-base>..<branch>` is non-empty, do not automatically rebase that branch or any dependent suffix: plain `rebase-stack` intentionally linearizes history and could discard merge-only conflict resolutions.
Build and report the safe prefix, then report the remaining canonical order as not integration-checked and include the integration-branch merge advice already recorded during Scheduling.

Create collision-free guide branch names such as `review-stack/<batch>-<YYYYMMDD-HHMMSS>/01-<task-slug>`, using a git-ref-safe UTC timestamp — digits and dashes only, no `:` (ISO-8601 colons are invalid in ref names), matching the `YYYYMMDD-HHMMSS` form `rebase-stack` already uses for pre-rebase refs.
Point each guide branch `gN` at the captured tip of its canonical branch `bN`; do not check out or move any `bN`.
Create a dedicated worktree attached to `g1`: `git worktree add "$WT_BASE/_review-stack-<batch>-<YYYYMMDD-HHMMSS>" <g1>` (same ref-safe timestamp; `g1` already exists, so this attaches it without creating any branch).
Running the restack there keeps the user's main checkout and current branch untouched.
A fresh worktree has no installed dependencies, so if `rebase-stack`'s post-conflict validation would need a build, install the project's dependencies in this worktree first (cheap when the package store hardlinks — same filesystem) — otherwise a resolved trivial conflict that triggers validation false-stops the guide on missing modules rather than a real failure.

Delegate the restack to one fresh `worker` subagent in that dedicated worktree and have it invoke `$rebase-stack` with the explicit guide chain.
Use the explicit form because independently created branches have no topology from which to infer the intended order.
The prompt contract is:

- Start with the usual worktree contract: `cd` to the exact dedicated worktree, verify `git rev-parse --show-toplevel`, and operate only there.
- "Invoke `$rebase-stack` in its delegated unattended mode with exactly: `chain <g1> <g2> ... <gN> onto <base>`. This explicit chain and prompt are the up-front authorization; do not re-derive, reorder, or wait for confirmation."
- "Every `gN` is a disposable local snapshot created only for this integration check. The canonical task branches `b1 ... bN` and all remote refs are read-only."
- "Do not push and do not fetch. Resolve only conflicts the skill classifies as trivial. On the first non-trivial conflict or unrecoverable validation failure, use the unattended clean-stop behavior. If the stop follows the combined replay itself because no confident repair is apparent, restore every guide branch in that run to its snapshot. If the combined replay has already been restored for a clear repair and the stop occurs during its per-branch fallback, or the stop follows any other per-branch replay, restore only the current guide branch to its pre-rebase ref. Leave the worktree clean and stop without waiting for input."
- "If that validation runs a build and you redirect its output to a file, create a unique directory for it first with `mktemp -d`, outside every worktree, and write there — never a fixed shared scratchpad name (one session's agents share that directory), and never inside this worktree, which must be left clean."
- "Report the canonical merge order, the `bN → gN` mapping, each guide branch outcome, any stop point, every conflict's files/offending commit/resolution or abort reason, any guide branch with no unique commits relative to its new base, and the exact `refs/pre-rebase/...` snapshots created."

Close the subagent after it returns.
Verify the canonical `bN` tips still equal the SHAs captured before creating the guide branches, verify the dedicated worktree is clean with no rebase in progress, then remove only that worktree per the Cleanup checks (clean status, no rebase in progress; then `git worktree remove` and `git worktree prune`).
If the subagent unexpectedly returns with a rebase in progress or dirty files, reset it to the disposable branch's reported pre-rebase ref, clear any untracked leftovers with `git clean -fd`, and confirm a clean `git status` before removal; never force-remove unresolved state.
Delete only the exact `refs/pre-rebase/...` snapshots the subagent created for these disposable guide branches; the unchanged canonical `bN` refs are their recovery source.
Never bulk-delete unrelated pre-rebase refs.
Do not delete or push the guide branches; they are the local artifact the maintainer can inspect.
The main checkout must remain on the branch and commit where it started.

An empty guide branch means that canonical branch contributes no unique patch after the earlier recommended branches; flag it as potentially redundant or already subsumed, not as a reason to merge it first.
If the restack stops partway, the canonical order remains the review recommendation, but only the completed prefix was integration-checked; report the first unstacked branch and the remaining suffix.

## Main-checkout cleanliness report

Every task runs in its own worktree, but the repository's main checkout is shared — with the maintainer, and with any peer harness running in the same container. Take a reading of its working-tree state at Bootstrap, and take the same reading again once **every** batch entry has reached a terminal state. Trigger it on batch termination, not on "the last task delivers": a batch in which every task blocks, fails, or aborts never reaches a delivery, and a failed implementer is at least as likely to have leaked strays as a successful one — so gating on a delivery skips the check exactly when it matters most.

Compare the two **by path**, so a path whose status code changed reads as a re-classification — a co-tenant staging their own work — rather than as one path vanishing and another appearing. Paths that appeared are a finding in the final report; paths that **disappeared** are a louder one, because a stray `checkout` or `clean` in the shared tree eating a co-tenant's uncommitted work is the hazard only a baseline can see. Report a vanished path as something to check against co-tenant commits, the reflog, and the stash rather than as established loss: a maintainer who committed their own work mid-run also removes a baseline path, with nothing gone. Everything else is pre-existing. Take a baseline rather than testing for emptiness — the maintainer's own work-in-progress is deliberately permitted in that checkout, so an unconditional non-empty rule would both blame the batch for work it never touched and destroy the one signal separating a real stray from the tree's starting state.

**Report, never clean.** Do not `git clean`, `checkout`, `reset`, or `stash` the shared main checkout on the strength of this report — another agent's uncommitted work is not yours to delete — and diff any stray against the delivered branches before touching it at all.

State the claim as narrowly as it is. The report says what its reading could see change; it claims nothing about what was **written into** paths already present in the baseline, nor about anything its reading does not surface. That is an exclusion rather than a list of blind spots, because the list is open: widening what the reading sees improves the report and leaves the claim exactly this narrow. What it does surface is a report to verify, not a conclusion — the same reading cannot tell a stray from a co-tenant's ordinary progress. It is never a proof that the batch wrote nothing, and must not be delivered as one.

## Final Output

After the batch, provide a concise summary:

- Each task: its PR link (or "local branch only" if PRs were skipped) and which wave it ran in.
- How many review rounds each task needed, and any task that hit the `review-cycle` round cap without passing (with its outstanding findings).
- Whether the peer participated; if it was unavailable or forfeited any rounds, note the reason once without treating it as a failure.
- The dependency/wave structure actually used, and any base-branch/stacking choices worth flagging.
- The **recommended merge order** using canonical PR branch names — `b1 → … → bN`, merge `b1` first — plus the corresponding local `review-stack/...` guide refs, the integration-checked prefix, any stop point or merge-history guard, reproducible conflict notes, and any empty guide branch. Make clear the guide stack is local only and not pushed; the canonical PR branches were not rewritten, and independent-branch tie ordering is advisory.
- The main-checkout cleanliness report: what appeared, what disappeared, and what was pre-existing — carried with the claim bound that section states, never as an assurance the batch left the tree untouched.
- Any blockers, local branches that still need pushing, or uncertainties that remain.
