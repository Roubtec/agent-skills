---
name: address-tasks
description: A batch of pre-planned task files is ready to be implemented. Trigger when the user asks to address tasks, work through a task batch, kick off implementation of planned work, process a folder of task files, or run address-tasks. The default concurrent task-batch executor - each task is implemented in its own worktree and delivered as its own PR. Not for one-off coding requests or small fixes, for planning new tasks (use write-tasks), or when strictly sequential single-branch execution is explicitly wanted (use address-tasks-serialized).
---

Implement a set of pre-planned task files using a **parallel, worktree-isolated** delegated subagent workflow.

**Arguments:** `<mixed-list of task numbers, task-file paths, and globs to implement> [peer-opinions=off]`

`peer-opinions=off` is the only accepted explicit peer-opinion setting. Omit it to use the default, which enables best-effort peer opinions.

## Task-pointer preflight

Before reading task dependencies, run `resolve-tasks` in a fresh resolution subagent with its own context window. Hand it the complete raw task-pointer list, have it follow the shared resolver contract, and consume its task-resolution packet; do not scavenge or re-resolve task filenames in the orchestrator's context. Reconcile the returned packet against the list you handed it: every deduplicated raw pointer must appear either in some path's `selectedBy` or as a `not-found` diagnostic, and a pointer the packet accounts for nowhere is a resolution failure to report, never a silently smaller batch; and no `selectedBy` or `not-found` raw value may name a pointer you never handed it — a packet that invents an input is the same resolution failure to report, never extra work to admit.

Use the packet's `selectedBy` provenance to apply policy. A path selected by an explicit path or glob executes exactly as it did before this additive preflight, whether its report context is `active`, `done`, `deferred`, `ambiguous`, or `outside-subtree`; if both explicit and number provenance selected it, explicit selection wins. A number-selected unambiguous `active` path executes normally. An unmatched number, path, or glob never executes and its `not-found` diagnostic is always surfaced.

Mode selection is part of the invocation, not an inference from the task mapping: a direct skill invocation defaults to interactive whenever the maintainer can answer in the current session. Use hands-off only when the maintainer explicitly requests it or the invoking runtime cannot accept mid-run input; the `wf-address-tasks` dynamic workflow is always hands-off because it cannot pause for a decision.

In an interactive run, show the resolved mapping whenever the invocation contains any number input, including a number mixed with otherwise clean explicit pointers. Also show the mapping whenever any input form produces a non-`active` classification or `not-found` anomaly. Require an explicit continue decision when any number-selected full number is `done`, `deferred`, or `ambiguous`, or when any input is `not-found`: `done` means already delivered and is skipped unless the maintainer explicitly includes it; `deferred` means deliberately unscheduled and needs explicit inclusion; for each `ambiguous` number, ask the maintainer to select exactly one candidate or exclude that number — a blanket continue must never include every candidate. Explicit path/glob selections remain executable while this decision is made.

In a hands-off run, execute only the number-selected unambiguous `active` paths plus every explicit path/glob selection. Exclude and document every number-selected `done`, `deferred`, or `ambiguous` classification and every `not-found` input; never guess an ambiguous number. Carry the complete mapping and exclusions into the run summary.

This skill is the parallel sibling of `address-tasks-serialized`. The roles (orchestrator / implementer / reviewer), the implementer and reviewer prompt contracts, and the code-quality review checklist are inherited from that skill, and the peer second-opinion protocol is the `review-cycle` skill's — read those for the contracts and their rationale. **What changes here is the execution model:** instead of one branch on one shared working tree processed strictly sequentially, each task gets its **own git worktree** so independent tasks can run **concurrently**, while each individual task still runs its implement→review→fix loop **sequentially**, bounded by the `review-cycle` round cap.

## Why worktrees change the rules

`address-tasks-serialized` will not let a reviewer start before its implementer's commits are on disk, because every subagent shares the orchestrator's single working tree — a reviewer spawned alongside its implementer scopes its diff against a branch the implementer hasn't finished committing to, sees nothing, and ships the work unreviewed.

A git worktree removes that constraint. Each worktree is a **separate working directory with its own `HEAD` and index** (`.git/worktrees/<name>/`), while sharing the one common object store (`.git/objects`, append-only and concurrency-safe) and refs (lock-protected). So:

- **Two agents in two different worktrees never corrupt each other.** They touch different files, different indexes, different HEADs. Concurrent commits land on different branches under separate ref locks.
- Therefore the base skill's "one agent at a time" rule is replaced by: **checkout-dependent `Agent` subagents that operate in distinct worktrees may run concurrently; within one worktree, an agent may not start until the previous agent's commits are on disk.** The inherited examination-only peer CLI is the deliberate exception during review.
- **Within a single task, the implementer and its reviewer still share that task's worktree** — so that reviewer may not start until that implementer's commits are on disk. That is committed state, not turn structure: a spawn may return immediately and report completion as a later notification, so wait for that notification; "one-at-a-time, implementer first" is the proxy for it. The parallelism is strictly *across* independent tasks, never between a task's own implementer and reviewer.

### Durability

Worktrees are disposable working directories: the shared `.git` object store keeps every commit and branch ref even after a worktree directory is deleted. The operating discipline that follows:

- Keep worktrees under a **gitignored base directory** (e.g. `.worktrees/` at the repo root) or outside the repository entirely, so worktree contents never show up in the main tree's status or get committed.
- **Commit early and often**, and **push after every commit** while the remote is available — a worktree's working tree is more volatile than committed-and-pushed history, and pushing provides remote durability and keeps the PR current. In the local-only fallback (Session Bootstrap's remote probe failed), commits are the durability boundary — push when access returns.
- Package managers with a content-addressed store (e.g. pnpm) make per-worktree installs cheap: when the store and the worktree share a filesystem, installs hardlink package files from the store instead of copying them, so many worktrees can install concurrently without multiplying disk usage.

## Session Bootstrap (run once, before any worktree)

Do this in the **main working tree** before creating worktrees. The worktree checks in steps 1–4 also serve `address-reviews`; both skills require step 5 when peer opinions are enabled (`address-reviews` also documents it in its own bootstrap):

1. **Choose the worktree base directory** (`$WT_BASE`): `.worktrees/` at the repo root, or a directory outside the repository. An in-repo base is `.worktrees/` or a path beneath it — the `wt-bootstrap` helper this bootstrap prefers reports `<repo>/.worktrees/$CONTAINER_NAME`, which is one — and nothing else: the ignore recipe that follows probes and appends exactly `/.worktrees/`, a root-anchored directory rule Git applies to everything beneath it, so a base under that name is carried by the very same append while one ANYWHERE ELSE in the repo would pass the re-probe while staying unignored. A base inside the repo has to BE ignored, and only this run makes it so: `git worktree add` excludes nothing on its own, so probe it with `git check-ignore -q "<repo>/.worktrees/"` — with the TRAILING SLASH, since `/.worktrees/` is a directory-only rule and `check-ignore` answers NO for a bare `.worktrees` that does not exist on disk yet, which is every first run — and, where it answers no, append `/.worktrees/` to the file `git rev-parse --git-path info/exclude` names — run it from inside `<repo>`, because in a primary checkout it answers with the RELATIVE `.git/info/exclude` (only a linked worktree gets an absolute path), so a `git -C <repo>` form whose answer you then append to from your own directory writes the rule to a file `check-ignore` never reads — then re-probe and make a still-no answer a blocker. Ask Git for that path rather than writing a literal `.git/info/exclude`: THIS checkout may itself be a linked worktree, where `.git` is a gitfile and `.git/info` is not a directory at all, so the literal append fails outright and the protection is never established — while `--git-path` resolves to the shared exclude file that `check-ignore` actually reads, in a linked worktree and a primary checkout alike. It is the repo-local ignore file, untracked and so dirtying nothing itself, and NOT the tracked `.gitignore` — an ignore edit dirties the main checkout mid-run.

2. **Prune stale state:** run `git worktree prune`, then remove any orphaned directories under the base — directories whose git worktree registration is gone (`git worktree list` no longer shows them). Never remove a directory that is still a registered worktree.

3. **Probe remote access:** `git ls-remote --heads origin`. Verify this up front — if pushes can't work, decide the fallback now, not mid-wave. A failure is **not** a blocker: fall back to **local reviewed branches only** and note in the final summary that PRs/pushes were skipped.

4. **Measure free disk space** on the base directory's filesystem (`df -k "$WT_BASE"`) — the starting input for Adaptive throttling below.

5. **Preflight the peer once** unless `peer-opinions=off`, per the `review-cycle` skill's peer preflight. Peer unavailability is never an error; proceed with own reviewers and note the reason once in the final summary.

6. **Baseline the shared main checkout** — read its working-tree state now, before any worktree exists, as the reading the closing cleanliness report compares against (see "Main-checkout cleanliness report"). Observe only; never "fix" a checkout that is already dirty.

If a `wt-bootstrap` helper is on PATH, prefer it for steps 1–4 — it performs those worktree checks, prunes orphans, and prints the base dir (`wtBase`) and free space (`availBytes`) as JSON. It covers those and nothing else — and not the whole of step 1: it establishes no ignore rule, so an in-repo `wtBase` is still yours to make ignored by step 1's recipe; the helper reports `ok` whether or not that rule exists. Run every remaining step above yourself.

## Orchestrator Responsibilities

You are the orchestrator. You MUST NOT do implementation work yourself (except the trivial-task escape hatch below). Your responsibilities:

1. Consume the **Task-pointer preflight** packet as the hard list of task files and the resolution context to report.
2. Run the **Session Bootstrap** above.
3. Build a **dependency graph** across the tasks; readiness is per task — a task starts the moment its specific prerequisites have delivered (see Scheduling).
4. For each task, the moment it is ready: create its worktree on the right base branch and drive its implement→review→fix loop to a pass — every ready task's loop runs **concurrently** with its siblings', each task one end-to-end pipeline.
5. Run each passing task through the **serialized pre-delivery guard**, then push its branch, open its PR against the resolved base, and reclaim its worktree — without waiting for any sibling (see Per-task pipeline and Delivery).
6. Clean up each finished worktree as its task delivers; once **every** task has reached a terminal state, act on any pushed branch left without a PR (see Delivery).
7. Build a **local review stack** from disposable copies of the mergeable branches — delegated to the `rebase-stack` skill in a subagent, never pushed and never rewriting the PR branches (see Post-batch restack).
8. Produce the final batch summary.

**Trivial-task escape hatch:** for a genuinely trivial task (single obvious change, unambiguous criteria) you may implement it directly in its worktree without an implementer subagent — but still spawn a fresh reviewer. No task skips review.

## Scheduling: per-task readiness on the dependency graph

True parallelism only helps for tasks that don't depend on each other. Determine dependencies from the task files (an explicit "Depends on" field, shared infrastructure, or files/modules two tasks both create or migrate). When in doubt, treat tasks that touch the same files or migrations as dependent.

- **Ready** = a task whose in-batch prerequisites have all **delivered** (their PR is open — or, in a local-only run, their branch is reviewed). Every ready task runs **concurrently**; there is no wave barrier, and a task never waits for a sibling it does not depend on.
- Tasks with **no** in-batch dependencies are ready at once; a dependent becomes ready the moment its specific prerequisite delivers, however many other tasks are still iterating.
- **Base branch per task.** A PR's base must be the ref its branch actually builds on, so the PR shows the honest diff of that branch's own contribution and nothing else; that is what routes each review comment to the PR that owns the code it is about. A dependent PR opened against `main` instead presents its parent's commits as its own work and collects the comments its parent's PR should have had.
  - Independent task (no dependency in-batch) → branch from and PR against the user's chosen base (default `main`, or an explicit override).
  - Dependent task → branch from and PR against its **dependency's branch** (stacked PRs), so it builds on work that may not be merged yet.
  - If a task depends on *several* tasks, branch from an integration branch that merges them, or from the single dependency it most directly extends — pick the simplest base that contains the code it needs and note the choice.
  - **Building a multi-parent integration branch is the orchestrator's job** — a bounded exception to "the orchestrator does not implement." Creating the branch and resolving its merge conflicts is small, mechanical, and a prerequisite for the dependent rather than task work, so do it yourself rather than delegating. Keep the merge minimal, build/lint the result before branching any task off it, and record any non-trivial conflict resolutions (in the batch summary or a short merge-advice note) so they can be reproduced when the stack later lands on `main`.
- Start a dependent only after every task it depends on has **delivered** (its branch is stable enough to build on). A prerequisite that ends any other way — failed review, held by the guard, crashed — skips its dependents with that reason rather than building them on known-bad work.

If the whole batch is a linear dependency chain, this degrades gracefully to one task at a time — i.e. effectively sequential, like `address-tasks-serialized`, but still worktree-isolated.

## Adaptive throttling (width from real constraints)

Default to running every ready task, bounded only by resources actually available to the run. If nine independent tasks are ready and nine worker slots plus their worktrees are supportable, launch nine implementers; do not impose an arbitrary small starting width merely because the run is unattended.

Throttle only for an objective constraint or a concrete reason to anticipate one: unavailable agent/process slots, measured storage headroom, shared exclusive resources, or observed provider pressure. If breadth causes failures, preserve completed and viable in-flight work, then reduce subsequent implement/review phases enough to avoid repeating the same failure rather than restarting partially completed tasks. Concretely, before a task starts and while tasks run:

- **Storage headroom.** Measure free space on the worktree base's filesystem at Bootstrap (`df -k "$WT_BASE"`; if you used the `wt-bootstrap` helper, it already reported this as `availBytes`). Estimate `per_worktree_need`, then cap the number of **live worktrees** at `max_concurrent = max(1, floor(free_bytes / per_worktree_need))`: a ready task waits for a slot while that many are live, and each delivery's reclaimed worktree frees one — deliver-then-reclaim per task bounds live worktrees continuously, which is what replaces the old wave-boundary re-measure. A worktree left in place for inspection (a cap-out, a hold, a crash) is still live and keeps its slot: headroom it holds does not return, and releasing its slot would admit one more live worktree per retained one over the headroom the cap was measured against. Once every slot is held by a retained worktree, no delivery can free one, so a ready task that would wait on it ends **storage-throttled** instead — a terminal state its dependents skip on, named in the summary beside the cap — rather than waiting forever or being admitted over that headroom. When the package store hardlinks into worktrees (same filesystem), `per_worktree_need` is mainly build artifacts plus package metadata; otherwise, measure one representative install and add its full package-copy cost. When unsure, measure one install before fanning out.
- **`ENOSPC` mid-run.** Stop adding concurrency, let viable in-flight tasks finish, and reclaim only worktrees whose changes are committed and pushed. Then retry the failed and remaining tasks under a smaller live-worktree cap — ultimately one at a time. Never force-remove a worktree with uncommitted changes just to free space, and never abandon a task because the parallel attempt failed.
- **Shared exclusive resources.** Some validation cannot run two-at-once even in separate worktrees because it contends for a single host-wide resource: a fixed listen port, one shared dev database on one port, or a build/e2e server that infers the workspace root from the repo-root lockfile (see below). Run such phases **serially** however many tasks are live — give each task exclusive use, then move on.
- **Provider rate-limiting.** Repeated `429`/`529` errors when spawning many subagents at once are a signal to fan out less. Reduce the number of concurrent subagents per phase and proceed.

Record in the final summary whenever you throttled below the ready set, and why — it tells the user whether the run was storage-bound, provider-bound, resource-serialized, or genuinely serial by dependency.

### App-server / e2e validation in a worktree

Validation that boots a *built* app server is the most common thing that won't run from inside a worktree. Next.js `next build` standalone output and Playwright's `webServer` both infer the workspace root from the repo-root lockfile, then look for the server at a path that ignores the nested `.worktrees/<slug>/` prefix — so `test:e2e` can't find the server and self-skips or errors. This is a repo-config limitation, not something the worktree skill can fix from the outside; handle it by choosing one of these, in order of preference:

1. **Run that task's e2e phase serially in the main checkout** after its branch is pushed: from the main tree, **check out the branch tip detached** (`git checkout --detach <branch>`) — a plain `git checkout <branch>` fails with `fatal: '<branch>' is already used by worktree ...` because the branch is still checked out in the task's worktree — then build, run e2e, and restore the main checkout's prior HEAD. (Or remove the task's clean worktree first, then check out the branch normally.) This keeps unit/integration coverage in-worktree and serializes only the part that needs the un-nested path.
2. **Defer e2e to CI** and rely on the in-worktree unit/integration suites for the in-loop signal, noting in the PR that e2e runs in CI.
3. **Run it in-worktree only if the repo's config is worktree-aware** (resolves the standalone/server path from `next build`'s actual output dir rather than assuming repo root).

Treat a task whose acceptance hinges on app-server e2e as a **serialize-this-phase** task per the shared-resource rule above, and say so in the summary. (Browser availability itself is fine in-worktree: `npx playwright install chromium`, or point Playwright at a system Chromium if your environment provides one via `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` — the worktree problem is the server path, not the browser.)

## Per-task pipeline

For each task `T`, the moment it is ready:

1. **Create the task's worktree** from the main tree (orchestrator calls; safe to run while other tasks' subagents are active — they touch only their own worktrees):

   ```bash
   task_slug="001-short-name"
   branch_name="task/001-short-name"
   base_branch="main"
   worktree="$WT_BASE/$task_slug"

   git worktree add "$worktree" -b "$branch_name" "$base_branch" # new branch off the base
   git worktree add "$worktree" "$branch_name"                    # rerun: attach the existing branch
   ```

   `$WT_BASE` is the base directory chosen in Bootstrap. Make this **rerun-safe**: check `git worktree list` first — if the task's worktree already exists, it must have the expected branch checked out (reuse it, prior commits intact); if it is on a different branch, or the base does not resolve, **stop and report rather than guessing**. If the branch already exists from an interrupted prior run, attach it (second form) instead of creating it with `-b`. If a `wt-enter <slug> <branch> <base>` helper is on PATH, prefer it — it encodes exactly these checks and prints the worktree's absolute path. Use a stable, collision-free slug per task (e.g. the task number + short name). The worktree's absolute path is what you hand to that task's subagents.

2. **Run the task's loop.** Each task runs its own implement→review→fix loop to a pass, independently of every sibling: the phases below are one task's, and same-phase agents of different ready tasks (which live in different worktrees) simply overlap in time — spawn them **in one tool block** when several tasks reach the same phase together, but never hold one task's phase for another's:

   - **Phase A — implement:** spawn the task's implementer, pointed at its own worktree path — beside whatever sibling implementers are running. Wait for it to return.
   - Adopt each returned implementation packet only under `review-cycle`'s packet hard-check: `git -C <worktree> status --porcelain` empty **and** no Git operation in progress (`rebase-merge`/`rebase-apply` paths, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG` — a tree left mid-rebase prints empty porcelain). Either failing means redrive or resume that task's Phase A rather than handing Phase B a worktree nobody can build on. The rest of that skill's *The loop and its gates* binds this loop whole too, later additions included.
   - **Phase B — review:** spawn the task's fresh reviewer only once its implementer's commits are on disk — its packet returned and adopted under the hard-check above — in its worktree; nothing about a sibling's phase enters into it. At the same moment, unless `peer-opinions=off`, launch the task's background peer while the peer remains available. Every rule the `review-cycle` skill states under *The peer step* binds this batch whole, later additions included. Share that section's one session-local adaptive throttle across every task and round — with no wave boundary to pace launches, it is the one global semaphore around the peer step — queue launches it holds, and surface every step-down in the batch summary. Before triage, wait for this task's own reviewer and for its peer if one was launched.
   - A task exits the loop only when its round passes the `review-cycle` gate; tasks with issues carry both reports verbatim as separately labeled blocks into the next round's Phase A, under that skill's grounding, blocking-and-minor gating, dispute, timeout/retry, and forfeit rules — never re-summarized.
   - Repeat A→B until each task converges or hits the `review-cycle` round cap; a task still failing at the cap does **not** get a PR — surface its outstanding findings to the user.

   > The per-task discipline is committed state: a task's reviewer never starts until that task's implementer's commits are on disk. Nothing about a sibling's phase enters into it — that is what buys cross-task parallelism without ever running a task's own implementer and reviewer at the same time.

   Concurrency is safe here **only because each agent has its own worktree.** If for any reason a task is not running in its own worktree, fall back to serializing that task as in `address-tasks-serialized`.

3. **When the loop passes, run the task through the serialized pre-delivery guard below** — one task at a time, in the order tasks pass (first-ready-wins). A task that clears it delivers at once: push and open its PR (see Delivery), then remove its worktree per Cleanup to reclaim storage (the branch and its commits persist in `.git` and on the remote). A task the guard holds does **not** open its PR yet; leave its worktree in place, reconcile the naming/path, symbol, or task-number conflict on the side the guard names, regenerate derived files, and re-review that task before delivery.

4. A task's delivery unlocks its dependents immediately (they branch from its now-stable branch) — never wait for the rest of the batch. A branch held by the guard is not delivered and must not unlock its dependents.

### Guarding against pre-PR collisions

Independent tasks run in **separate worktrees**, so two of them can each *add* the same new file — or a file exporting the same top-level class/symbol — with no conflict at implementation time. The clash only surfaces later, when the branches linearize or merge (an add/add conflict, or a duplicate definition). It is rare, but it has happened; the preventive check and the serialized guard below keep those clashes from costing a fix-up round. The task-number guard that follows extends the pre-PR check to task-number claims across the wider in-flight comparison set.

- **Prevent it up front.** When you fan out two independent tasks that both introduce the same *kind* of new surface (a "reconciliation controller", a "work-list endpoint", a migration helper), assign each a **distinct file and class name** in its implementer prompt. The implementers can't see each other, so the disambiguation has to come from you.
- **Catch it before the PR — one task at a time.** The moment a task passes review and **before** its PR, run it through the guard, serialized so that only one branch is ever under it (first-ready-wins, in the order tasks pass): compare what it newly added against every branch the run has **delivered or reserved** so far, by ref and from the main checkout — the scan enters no worktree, so it never becomes the new barrier:

  ```bash
  # The branch under the guard, plus every branch this run has delivered or reserved.
  guard_branches=("task/001-first" "task/002-second")
  declare -A branch_bases=(
    ["task/001-first"]="main"
    ["task/002-second"]="main"
  )

  # Exact same new path.
  for branch in "${guard_branches[@]}"; do
    base="${branch_bases[$branch]}"
    git diff --diff-filter=A --name-only "$base...$branch"
  done | sort | uniq -d

  # Same new basename at any path; inspect repeated first columns.
  for branch in "${guard_branches[@]}"; do
    base="${branch_bases[$branch]}"
    git diff --diff-filter=A --name-only "$base...$branch" |
      awk -v branch="$branch" '{ n=split($0, p, "/"); print p[n] "\t" branch "\t" $0 }'
  done | sort
  ```

  A duplicated path (or basename, or a shared exported top-level class/function/const/interface/type/enum name across two added files) is a collision. Hold the branch under the guard before PR delivery, then **deconflict — that call is yours to make** (a bounded exception to "the orchestrator doesn't implement", like building an integration branch): the branch under the guard is the side that changes — a delivered or reserved sibling is never rewritten, which is what removes the "least disruptive side" judgment for the common case — so rename enough files and/or symbols on it that no other holder shares the original colliding value, regenerate anything derived (e.g. contracts), and **re-review it with fresh eyes at the delivery tier** before its PR (the rename and the regeneration are a post-run change, so they void that task's own delivery-tier pass and owe it again); the sibling it clashed with is untouched and delivers, or has delivered, unchanged. If the shared name is **imperative** — a framework-mandated path, an external/published contract, or a name a task file explicitly pins — do **not** invent a divergent name: keep that branch held and surface it as a design decision for a human; a held branch holds only itself, and the pipeline keeps flowing around it. Diff each branch against **its own base** with the three-dot form so a dependent branch that legitimately builds on a sibling isn't flagged — it never re-lists an inherited file.

**Clearing the guard is a claim, held through delivery.** A branch that clears the guard reserves what it claims — its added surfaces and every task number its new task files claim — and the reservation stands until its delivery settles, because delivery is not atomic: a task that has left the guard but is still in its network-bound push/PR step is neither delivered nor a currently-ready sibling, and without the reservation the next branch through the guard would clear on the same value and both would publish. Release is asymmetric. The reservation **converts to delivered** once the PR exists (or, in a local-only run, once the reviewed branch is the delivery); it may be **dropped** only when delivery failed with no remote write; and where the push landed but PR creation did not, `origin` carries the branch while no PR advertises it, so the reservation **persists for the rest of the run** — see Delivery for what the batch owes such a branch before it ends.

**Early merges move the base.** A sibling's PR can merge while the batch is still running; the guard's scan is where the run notices (read each delivered sibling's PR state as you compare against it). A branch still on its way to delivery whose recorded base was that sibling's branch, or that shares the base the sibling merged into, is rebased onto the advanced base through `review-cycle`'s delegated rebase step before its final delivery-tier review — a dependent's PR base moves with it — so a clash with an already-merged sibling surfaces as an honest conflict at that rebase, never as an invisible add/add at merge time. A halted rebase holds only that branch, with its conflict as an open question. Per the no-latched-flags rule, the task's result describes its final state after any rebase, with the history in its artifact directory.

#### Task-number collisions across in-flight branches

Run this guard before opening any PR that adds task files. It is defined once, in `address-tasks-serialized` → "Task-number collisions across in-flight branches", and is deliberately not restated here: the full-number parsing, the comparison set and what each member contributes, the base-refresh and PR-head enumeration recipes with their note-and-proceed degradations, the same-branch relocation pairing, the renumber-the-flagged-new-claimant rule, and the bounded-snapshot caveat with its `reap-tasks` backstop all apply verbatim. The one reading specific to this skill: where that definition establishes the first claimant in the *run's* deterministic delivery order, use the order in which tasks pass review and reach the serialized guard — first-ready-wins, which the one-at-a-time guard makes deterministic. A branch that cleared the guard but is still delivering is a *reserved* member of that definition, a delivered one a *delivered* member, and the branch under the guard is the second claimant that renumbers; the definition's rule that a delivered or reserved claimant is never rewritten decides every such case.

## Diagnosis discipline

A subagent's environment or infrastructure diagnosis is a **hypothesis, not a finding**. Verify it against **observable state** — the reflog, the refs, the working tree, file contents, the output of a command you run yourself — before propagating any mitigation into sibling prompts: that observes the effect rather than the claim. A bounded grep of that subagent's own transcript is a fallback, and only where the harness exposes a greppable one — some hand back the transcript path with an instruction not to read or tail it, because it is full JSONL that will overflow your context. A scratch-filename collision was once misdiagnosed as a working-directory bug, and the wrong mitigation rode into roughly ten later subagent prompts before anyone checked.

## Subagent destroy boundary

State this in every subagent prompt this skill composes. A reviewer subagent authorized to verify a claim empirically once ran `rm -rf ./*` in a shared main checkout: its setup `git clone … | tail` had failed invisibly under `set -e` (a pipeline's status is its last command), so it deleted tracked files and moved a branch ref while believing it stood inside a clone.

- **Permitted:** reading, searching, and read-only `git`/`gh` queries — plus, for a fixer or implementer, edits, commits, and pushes confined to its own assigned worktree and branch.
- **Forbidden, named outright:** `rm -rf`, `git reset --hard`, `git clean`, `git branch -f`, `git update-ref`, `git gc`, and force-pushing — each of them beyond what the prompt itself spells out, whether as an exact command or as a skill it names to invoke. A subagent may not self-authorize one by putting itself somewhere it believes is safe — forbidden **not in a clone, not in a temp directory, not "safely"**. What you spelled out, and the disposable location below, are the only exemptions — and only because you named them.
- **A worktree is not a blast radius.** It isolates the working tree, not the repository: `branch -f`, `reset`, `update-ref`, and `gc` all reach every sibling worktree through the shared `.git`.
- **Any repository other than the subagent's own checkout is addressed by path.** `git -C <absolute path>`: never derive a working directory from a glob, and never chain a state-changing git command after a `cd` whose success you have not checked. A fix-up subagent ran `cd "$(ls -d <scratchpad>/tmp.*)" ; git commit …` where concurrent siblings had created scratch directories of their own — the glob expanded to three paths, the `cd` failed, and the `;`-chained commands landed in the shared main checkout, putting a commit on `main`.
- **Empirical verification that could change state goes where you send it.** Send the subagent to `DC="$(dc-enter <slug>)"` — one absolute path on stdout, dropped again with `dc-remove <slug>`; a reused slug is refused rather than re-derived, so anything that may run twice passes `--replace` or removes the slug first. Where that command is not found at all, install the helpers from the dev-skills plugin `bin/` rather than improvising a destination. Never leave the choice to the subagent. Give it the guarded `cd` too: `cd ""` returns 0 and moves nowhere, so checking the status catches nothing and a failed lookup leaves the subagent in the shared checkout — the form is `cd -- "${DC:?dc-enter returned no path — see its error above; if it is not installed, install it from the dev-skills plugin bin/}"`, with `pwd` confirmed before the first command that writes.

## Implementer Agent

Same contract as `address-tasks-serialized`, plus a **worktree isolation contract** and **push-every-commit**. Launch implementers as described in the per-task pipeline's Phase A.

Include in each implementer prompt:

- A **WORKTREE CONTRACT** as the very first instruction:
  - "Your worktree is `<absolute worktree path>`. Before anything else, `cd` into it and verify: `git rev-parse --show-toplevel` MUST print exactly that path. If it does not, STOP and report — do not run any git or edit command outside this path."
  - "Do all work inside this worktree only. Never `cd` to the repository root, never touch sibling worktrees or the main checkout. You are not the only agent in this repository; other agents are working in other worktrees concurrently — stay in yours."
- The **branch name** (already checked out in the worktree) and instruction to confirm it with `git branch --show-current`.
- **The full task file content**, pasted in. Do not assume prior context.
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

On a fix-up round, spawn a **fresh** implementer for the task — a new `Agent`, never a "continued" prior implementer. If an `Agent` result prints a `SendMessage` continuation footer, ignore it; this harness does not expose that tool. A fresh spawn is the preferred path because the new implementer reads the committed worktree plus the findings without bias toward its earlier choices. Paste both reports verbatim as separately labeled own-reviewer and peer blocks, omitting only a peer report forfeited under the `review-cycle` protocol, and instruct the implementer to address each finding specifically and report what changed (same branch, same worktree).

## Reviewer Agent

Same fresh-eyes contract and code-quality checklist as `address-tasks-serialized`. A reviewer is always a **new** `Agent` invocation — a fresh-eyes spawn, never a continuation of the implementer — launched only once that task's implementer's commits are on disk, so wait for its completion notification; no sibling's implementer has any bearing on it. Ignore any `SendMessage` continuation footer from earlier `Agent` results; this harness does not expose that tool.

Include in each reviewer prompt, beyond that inherited contract — which binds whole, later additions to it included:

- The same **WORKTREE CONTRACT** first: "Your worktree is `<absolute worktree path>`. `cd` into it and confirm `git rev-parse --show-toplevel` matches before doing anything. Review only this worktree."
- **The full task file content** (same source of truth the implementer got).
- The **PR base branch** for this task. After assigning it and the task worktree to the shell variables `base` and `worktree`, the reviewer scopes with `git -C "$worktree" diff --name-only "$base"...HEAD`. The implementation is already committed on the current branch in this worktree — the reviewer must read the actual files and must NOT conclude "no implementation" without first confirming the diff is genuinely empty (an empty diff at this stage signals a wrong worktree/branch, not real absence — say so rather than reviewing nothing).
- Instruction to run the **build / type-check first at the validation tier this round states** (a failure at that tier is an automatic blocker; do not block on a heavier suite the stated tier did not run), then check each acceptance criterion against the code, then a code-quality pass over the touched files using the inherited checklist (logic, error handling, edge cases, dead code, consistency, duplication, type safety).
- **Where validation output goes:** any build or check output that must land in a file goes inside this task's worktree (a gitignored path, removed before any commit), never a shared scratchpad filename. Two concurrent reviewers both redirecting to `<scratchpad>/verify.log` once had one reading the other worktree's results and returning a verdict for the wrong branch.
- Reporting format: **Pass** (all criteria met, build passes, no material issues) or **Issues** (numbered, each with category + file/line + what's wrong + what to change).
- **Do NOT edit, create, or delete any files** — the worktree-local validation output file above is the sole exception. **Do NOT read commit messages or `git diff` content** — list touched files for scoping only, then read whole files. Be strict but fair; flag real gaps, not style nits. Put any follow-up suggestions in the report only.

## Delivery (push + PR, per task)

Default behavior: each task that passes review and clears the guard gets **pushed and a PR opened** against its resolved base **the moment it does** — delivery is per task, never held for the batch, so a simple PR can be under review, or merged, while a hard sibling is still iterating.

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

After the PR is open, remove the task's worktree per Cleanup to reclaim storage. Do not delete the branch — the PR and any dependents need it (removing a worktree never touches branches).

**A pushed branch left without a PR is a terminal-state obligation.** A push that landed while PR creation failed leaves the branch on `origin` advertised by no PR, holding a task number the next run's same-number guard sees on neither the base branch nor any open PR head — so the collision this run caught would reappear there, and a session-local reservation cannot outlive the run to prevent it. Act on such a branch the moment its delivery settles, before its terminal state reaches its dependents: retry PR creation once (looking first for a PR the failed attempt may have opened, and reading the base back), and where that fails delete the branch from `origin` (its commits stay in the shared `.git` for a later push). Acted on only at the end of the batch, a prerequisite whose retry opened its PR would find its dependents already skipped on the state it held in between; acted on at once, a retry that succeeds delivers it and unlocks them, while a branch deleted from origin is local-only and — on a run with a remote — unlocks nothing, since a dependent stacked on it would open its PR against a base `origin` no longer carries. Name any branch that survives both attempts in the final summary beside the task number it still holds, so the next run can reclaim it by hand.

## Cleanup

- Remove each task's worktree once its PR is open (or once you've decided to stop on it). First verify it is safe: `git -C <worktree> status --porcelain` must be empty and no Git operation may be in progress (no `rebase-merge`/`rebase-apply` paths, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, or `BISECT_LOG` under its git dir — the same six the packet hard-check names, and for the same reason: the last three can print empty porcelain, so a porcelain-plus-rebase-only check clears a tree nobody should remove). Then `git worktree remove <path>`. **Never force-remove a worktree with uncommitted changes or an in-progress Git operation** — `git worktree remove --force` destroys that work; if the checks fail, leave the worktree in place and report why rather than deleting evidence. Use `--force` only to clear git's refusal over leftovers like ignored build artifacts *after* the clean checks pass. If a `wt-remove` helper is on PATH, prefer it — it enforces the full set itself (even with `--force`), so the enumerated list is the helper-absent fallback.
- After removing a worktree, run `git worktree prune` to clear its stale registration.
- Removing a worktree does not delete its branch; a dependent can still branch from that ref after the worktree is gone.

## Post-batch restack: a local review stack (never pushed)

After Delivery and Cleanup, build one linear **local** stack in the order you recommend reviewing and merging the PRs.
This is an integration check and merge-order guide; it is **never pushed**.

Do **not** rebase the task/PR branch names themselves.
Those local refs should continue to match the pushed PR heads; rewriting them locally creates misleading ahead/behind state and makes later pull/push operations error-prone.
Instead, create disposable `review-stack/...` branches that snapshot the canonical task branches, then rebase only those guide branches.
The guide refs persist in the repo's `.git`, while the PR branches and remote PRs remain unchanged.

**Skip it when** the batch produced **0 or 1** mergeable branch.
Exclude branches that failed review, that the user asked to skip, or whose PR merged during the run — its content is on the base already, so a guide snapshot of it would rebase to nothing; report it as merged rather than stacking it.
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
Those names are unique per batch and clock second, which is what the teardown's ownership check rests on: the same batch run twice at once in one container would share them (and already shares its per-task worktrees), so run a batch once per container.
Point each guide branch `gN` at the captured tip of its canonical branch `bN`; do not check out or move any `bN`.
Create a dedicated worktree attached to `g1`: `git worktree add "$WT_BASE/_review-stack-<batch>-<YYYYMMDD-HHMMSS>" <g1>` (same ref-safe timestamp; `g1` already exists, so this attaches it without creating any branch).
Running the restack there keeps the user's main checkout and current branch untouched.
A fresh worktree has no installed dependencies, so if `rebase-stack`'s post-conflict validation would need a build, install the project's dependencies in this worktree first (cheap when the package store hardlinks — same filesystem) — otherwise a resolved trivial conflict that triggers validation false-stops the guide on missing modules rather than a real failure.

Delegate the restack to one fresh `general-purpose` subagent in that dedicated worktree and have it invoke the `rebase-stack` skill with the explicit guide chain.
Use the explicit form because independently created branches have no topology from which to infer the intended order.
The prompt contract is:

- Start with the usual worktree contract: `cd` to the exact dedicated worktree, verify `git rev-parse --show-toplevel`, and operate only there.
- "Invoke the `rebase-stack` skill in its delegated unattended mode with exactly: `chain <g1> <g2> ... <gN> onto <base>`. This explicit chain and prompt are the up-front authorization; do not re-derive, reorder, or wait for confirmation."
- "Every `gN` is a disposable local snapshot created only for this integration check. The canonical task branches `b1 ... bN` and all remote refs are read-only."
- "Do not push and do not fetch. Resolve only conflicts the skill classifies as trivial. On the first non-trivial conflict or unrecoverable validation failure, use the unattended clean-stop behavior. If the stop follows the combined replay itself because no confident repair is apparent, restore every guide branch in that run to its snapshot. If the combined replay has already been restored for a clear repair and the stop occurs during its per-branch fallback, or the stop follows any other per-branch replay, restore only the current guide branch to its pre-rebase ref. Leave the worktree clean and stop without waiting for input."
- "If that validation runs a build and you redirect its output to a file, create a unique directory for it first with `mktemp -d`, outside every worktree, and write there — never a fixed shared scratchpad name (one session's agents share that directory), and never inside this worktree, which must be left clean."
- "Report the canonical merge order, the `bN → gN` mapping, each guide branch outcome, any stop point, every conflict's files/offending commit/resolution or abort reason, any guide branch with no unique commits relative to its new base, and the exact `refs/pre-rebase/...` snapshots created."

After the subagent returns, verify the canonical `bN` tips still equal the SHAs captured before creating the guide branches — every branch of the canonical order the inspection captured, not only the safe prefix, since a merge guard exempts the branches after it from the restack, never from this check — verify the dedicated worktree is at the exact path you created and clean with no rebase in progress, holding one of the guide branches or detached, which is how `rebase-stack` leaves the worktree after restoring a whole run to its snapshots and stopping — a worktree at any other path, or holding any other branch, is not yours to remove, however clean — then remove only that worktree per the Cleanup checks (clean status, no rebase in progress; then `git worktree remove` and `git worktree prune`).
If the subagent unexpectedly returns with a rebase in progress or dirty files, reset it to the newest snapshot under that disposable branch's own `refs/pre-rebase/<guide>/` namespace, enumerated the same way the deletion below finds them (aborting a rebase still in progress first with `git rebase --abort`, since a reset leaves the rebase state behind and the removal would still refuse), clear any untracked leftovers with `git clean -fd`, and confirm a clean `git status` before removal; never force-remove unresolved state.
Delete only the `refs/pre-rebase/...` snapshots the subagent created for these disposable guide branches, enumerated under each guide's own `refs/pre-rebase/<guide>/` namespace rather than taken from its report, so a subagent interrupted after saving them leaves none behind, and only once the worktree is removed; the unchanged canonical `bN` refs are their recovery source. Where the recovery above could not reclaim the worktree, or its removal refused, keep every snapshot and report them: the held worktree is what those refs recover, and deleting them would take away the recovery you or the maintainer still has to run.
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

- Each task: its PR link (or "local branch only" if PRs were skipped) and its terminal state — delivered, merged during the run, pushed without a PR, held by the guard, capped, crashed, storage-throttled, or skipped for a failed prerequisite.
- How many review rounds each task needed, and any task that hit the `review-cycle` round cap without passing (with its outstanding findings).
- Whether the peer participated; if it was unavailable or forfeited any rounds, note the reason once without treating it as a failure.
- The dependency graph actually used, the order in which tasks reached the guard, any base a merged sibling advanced (and the rebases it caused), and any base-branch/stacking choices worth flagging.
- The **recommended merge order** using canonical PR branch names — `b1 → … → bN`, merge `b1` first — plus the corresponding local `review-stack/...` guide refs, the integration-checked prefix, any stop point or merge-history guard, reproducible conflict notes, and any empty guide branch. Make clear the guide stack is local only and not pushed; the canonical PR branches were not rewritten, and independent-branch tie ordering is advisory.
- The main-checkout cleanliness report: what appeared, what disappeared, and what was pre-existing — carried with the claim bound that section states, never as an assurance the batch left the tree untouched.
- Any pushed branch that survived the end-of-batch reconciliation, named beside the task number it still holds.
- Any blockers, local branches that still need pushing, or uncertainties that remain.
