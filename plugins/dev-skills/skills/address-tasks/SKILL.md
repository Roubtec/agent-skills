---
name: address-tasks
description: A batch of pre-planned task files is ready to be implemented. Trigger when the user asks to address tasks, work through a task batch, kick off implementation of planned work, process a folder of task files, or run address-tasks. The default concurrent task-batch executor - each task is implemented in its own worktree and delivered as its own PR. Not for one-off coding requests or small fixes, for planning new tasks (use write-tasks), or when strictly sequential single-branch execution is explicitly wanted (use address-tasks-serialized).
---

Implement a set of pre-planned task files using a **parallel, worktree-isolated** delegated subagent workflow.

**Arguments:** `<mixed-list of task numbers, task-file paths, and globs to implement> [peer-opinions=off] [review-stack]`

`peer-opinions=off` is the only accepted explicit peer-opinion setting.
Omit it to use the default, which enables best-effort peer opinions.
`review-stack` asks for the local review stack after the batch, which is otherwise not built (see Post-batch overlap check).

## Task-pointer preflight

Before reading task dependencies, run `resolve-tasks` in a fresh resolution subagent with its own context window.
Hand it the complete raw task-pointer list, have it follow the shared resolver contract, and consume its task-resolution packet; do not scavenge or re-resolve task filenames in the orchestrator's context.
Reconcile the returned packet against the list you handed it: every deduplicated raw pointer must appear either in some path's `selectedBy` or as a `not-found` diagnostic, and a pointer the packet accounts for nowhere is a resolution failure to report, never a silently smaller batch; and no `selectedBy` or `not-found` raw value may name a pointer you never handed it — a packet that invents an input is the same resolution failure to report, never extra work to admit.

Use the packet's `selectedBy` provenance to apply policy.
A path selected by an explicit path or glob executes exactly as it did before this additive preflight, whether its report context is `active`, `done`, `deferred`, `ambiguous`, or `outside-subtree`; if both explicit and number provenance selected it, explicit selection wins.
A number-selected unambiguous `active` path executes normally.
An unmatched number, path, or glob never executes and its `not-found` diagnostic is always surfaced.

Mode selection is part of the invocation, not an inference from the task mapping: a direct skill invocation defaults to interactive whenever the maintainer can answer in the current session.
Use hands-off only when the maintainer explicitly requests it or the invoking runtime cannot accept mid-run input; the `wf-address-tasks` dynamic workflow is always hands-off because it cannot pause for a decision.

In an interactive run, show the resolved mapping whenever the invocation contains any number input, including a number mixed with otherwise clean explicit pointers.
Also show the mapping whenever any input form produces a non-`active` classification or `not-found` anomaly.
Require an explicit continue decision when any number-selected full number is `done`, `deferred`, or `ambiguous`, or when any input is `not-found`: `done` means already delivered and is skipped unless the maintainer explicitly includes it; `deferred` means deliberately unscheduled and needs explicit inclusion; for each `ambiguous` number, ask the maintainer to select exactly one candidate or exclude that number — a blanket continue must never include every candidate.
Explicit path/glob selections remain executable while this decision is made.

In a hands-off run, execute only the number-selected unambiguous `active` paths plus every explicit path/glob selection.
Exclude and document every number-selected `done`, `deferred`, or `ambiguous` classification and every `not-found` input; never guess an ambiguous number.
Carry the complete mapping and exclusions into the run summary.

This skill is the parallel sibling of `address-tasks-serialized`.
The roles (orchestrator / implementer / reviewer), the implementer and reviewer prompt contracts, and the code-quality review checklist are inherited from that skill, and the peer second-opinion protocol is the `review-cycle` skill's — read those for the contracts and their rationale.
**What changes here is the execution model:** instead of one branch on one shared working tree processed strictly sequentially, each task gets its **own git worktree** so independent tasks can run **concurrently**, while each individual task still runs its implement→review→fix loop **sequentially**, bounded by the `review-cycle` round cap.

## Why worktrees change the rules

`address-tasks-serialized` will not let a reviewer start before its implementer's commits are on disk, because every subagent shares the orchestrator's single working tree.

A git worktree removes that constraint.
Each worktree is a **separate working directory with its own `HEAD` and index** (`.git/worktrees/<name>/`), while sharing the one common object store (`.git/objects`, append-only and concurrency-safe) and refs (lock-protected).
So:

- **Two agents in two different worktrees never corrupt each other.**
  They touch different files, different indexes, different HEADs.
  Concurrent commits land on different branches under separate ref locks.
- Therefore the base skill's "one agent at a time" rule is replaced by: **checkout-dependent `Agent` subagents that operate in distinct worktrees may run concurrently; within one worktree, an agent may not start until the previous agent's commits are on disk.**
  The inherited examination-only peer CLI is the deliberate exception during review.

### Durability

Worktrees are disposable working directories: the shared `.git` object store keeps every commit and branch ref even after a worktree directory is deleted.
The operating discipline that follows:

- Keep worktrees under a **gitignored base directory** (e.g. `.worktrees/` at the repo root) or outside the repository entirely, so worktree contents never show up in the main tree's status or get committed.
- **Commit early and often**, and **push after every commit** while the remote is available — a worktree's working tree is more volatile than committed-and-pushed history, and pushing provides remote durability and keeps the PR current.
  In the local-only fallback (Session Bootstrap's remote probe failed), commits are the durability boundary — push when access returns.
- Package managers with a content-addressed store (e.g. pnpm) make per-worktree installs cheap: when the store and the worktree share a filesystem, installs hardlink package files from the store instead of copying them, so many worktrees can install concurrently without multiplying disk usage.

## Session Bootstrap (run once, before any worktree)

Do this in the **main working tree** before creating worktrees.
The worktree checks in steps 1–4 also serve `address-reviews`; both skills require step 5 when peer opinions are enabled (`address-reviews` also documents it in its own bootstrap):

1. **Choose the worktree base directory** (`$WT_BASE`): `.worktrees/` at the repo root, or a directory outside the repository.
   An in-repo base is `.worktrees/` or a path beneath it — the `wt-bootstrap` helper this bootstrap prefers reports `<repo>/.worktrees/$CONTAINER_NAME`, which is one — and nothing else: the ignore recipe that follows probes and appends exactly `/.worktrees/`, a root-anchored directory rule Git applies to everything beneath it, so a base under that name is carried by the very same append while one ANYWHERE ELSE in the repo would pass the re-probe while staying unignored.
   A base inside the repo has to BE ignored, and only this run makes it so: `git worktree add` excludes nothing on its own, so probe it with `git check-ignore -q "<repo>/.worktrees/"` — with the TRAILING SLASH, since `/.worktrees/` is a directory-only rule and `check-ignore` answers NO for a bare `.worktrees` that does not exist on disk yet, which is every first run — and, where it answers no, append `/.worktrees/` to the file `git rev-parse --git-path info/exclude` names — run it from inside `<repo>`, because in a primary checkout it answers with the RELATIVE `.git/info/exclude` (only a linked worktree gets an absolute path), so a `git -C <repo>` form whose answer you then append to from your own directory writes the rule to a file `check-ignore` never reads — then re-probe and make a still-no answer a blocker.
   Ask Git for that path rather than writing a literal `.git/info/exclude`: THIS checkout may itself be a linked worktree, where `.git` is a gitfile and `.git/info` is not a directory at all, so the literal append fails outright and the protection is never established — while `--git-path` resolves to the shared exclude file that `check-ignore` actually reads, in a linked worktree and a primary checkout alike.
   It is the repo-local ignore file, untracked and so dirtying nothing itself, and NOT the tracked `.gitignore` — an ignore edit dirties the main checkout mid-run.

2. **Prune stale state:** run `git worktree prune`, then remove any orphaned directories under the base — directories whose git worktree registration is gone (`git worktree list` no longer shows them).
   Never remove a directory that is still a registered worktree.

3. **Probe remote access:** `git ls-remote --heads origin`.
   Verify this up front — if pushes can't work, decide the fallback now, not mid-wave.
   A failure is **not** a blocker: fall back to **local reviewed branches only** and note in the final summary that PRs/pushes were skipped.

4. **Measure free disk space** on the base directory's filesystem (`df -k "$WT_BASE"`) — the starting input for Adaptive throttling below.

5. **Preflight the peer once** unless `peer-opinions=off`, per the `review-cycle` skill's peer preflight.
   Peer unavailability is never an error; proceed with own reviewers and note the reason once in the final summary.

6. **Baseline the shared main checkout** — read its working-tree state now, before any worktree exists, as the reading the closing cleanliness report compares against (see "Main-checkout cleanliness report").
   Observe only; never "fix" a checkout that is already dirty.

If a `wt-bootstrap` helper is on PATH, prefer it for steps 1–4 — it performs those worktree checks, prunes orphans, and prints the base dir (`wtBase`) and free space (`availBytes`) as JSON.
It covers those and nothing else — and not the whole of step 1: it establishes no ignore rule, so an in-repo `wtBase` is still yours to make ignored by step 1's recipe; the helper reports `ok` whether or not that rule exists.
Run every remaining step above yourself.

## Orchestrator Responsibilities

You are the orchestrator.
You MUST NOT do implementation work yourself (except the trivial-task escape hatch below).
Your responsibilities:

1. Consume the **Task-pointer preflight** packet as the hard list of task files and the resolution context to report.
2. Run the **Session Bootstrap** above.
3. Build a **dependency graph** across the tasks; readiness is per task — a task starts the moment its specific prerequisites have delivered (see Scheduling).
4. For each task, the moment it is ready: create its worktree on the right base branch and drive its implement→review→fix loop to a pass — every ready task's loop runs **concurrently** with its siblings', each task one end-to-end pipeline.
5. Run each passing task through the **serialized pre-delivery guard**, then push its branch, open its PR against the resolved base, and reclaim its worktree — without waiting for any sibling (see Per-task pipeline and Delivery).
6. Clean up each finished worktree as its task delivers; act on a pushed branch left without a PR the moment its delivery settles, inside that task's own pipeline and before its terminal state reaches its dependents (see Delivery).
7. Run the **overlap check** over the mergeable branches: a read-only script that says which of them touch the same files and which would conflict (see Post-batch overlap check).
8. Produce the final batch summary.

**Trivial-task escape hatch:** for a genuinely trivial task (single obvious change, unambiguous criteria) you may implement it directly in its worktree without an implementer subagent — but still spawn a fresh reviewer.
No task skips review.

## Scheduling: per-task readiness on the dependency graph

True parallelism only helps for tasks that don't depend on each other.
Determine dependencies from the task files (an explicit "Depends on" field, shared infrastructure, or files/modules two tasks both create or migrate).
When in doubt, treat tasks that touch the same files or migrations as dependent.

- **Ready** = a task whose in-batch prerequisites have all **delivered** (their PR is open — or, in a local-only run, their branch is reviewed).
  Every ready task runs **concurrently**; there is no wave barrier, and a task never waits for a sibling it does not depend on.
- Tasks with **no** in-batch dependencies are ready at once; a dependent becomes ready the moment its specific prerequisite delivers, however many other tasks are still iterating.
- **Base branch per task.**
  A PR's base must be the ref its branch actually builds on, so the PR shows the honest diff of that branch's own contribution and nothing else; that is what routes each review comment to the PR that owns the code it is about.
  - Independent task (no dependency in-batch) → branch from and PR against the user's chosen base (default `main`, or an explicit override).
  - Dependent task → branch from and PR against its **dependency's branch** (stacked PRs), so it builds on work that may not be merged yet.
  - If a task depends on *several* tasks, branch from an integration branch that merges them, or from the single dependency it most directly extends — pick the simplest base that contains the code it needs and note the choice.
  - **Building a multi-parent integration branch is the orchestrator's job** — a bounded exception to "the orchestrator does not implement."
    Creating the branch and resolving its merge conflicts is small, mechanical, and a prerequisite for the dependent rather than task work, so do it yourself rather than delegating.
    Keep the merge minimal, build/lint the result before branching any task off it, and record any non-trivial conflict resolutions (in the batch summary or a short merge-advice note) so they can be reproduced when the stack later lands on `main`.
- A prerequisite that ends any other way than **delivered** — failed review, held by the guard, crashed — skips its dependents with that reason rather than building them on known-bad work.

## Adaptive throttling (width from real constraints)

Default to running every ready task, bounded only by resources actually available to the run.
If nine independent tasks are ready and nine worker slots plus their worktrees are supportable, launch nine implementers; do not impose an arbitrary small starting width merely because the run is unattended.

Throttle only for an objective constraint or a concrete reason to anticipate one: unavailable agent/process slots, measured storage headroom, shared exclusive resources, or observed provider pressure.
If breadth causes failures, preserve completed and viable in-flight work, then reduce subsequent implement/review phases enough to avoid repeating the same failure rather than restarting partially completed tasks.
Concretely, before a task starts and while tasks run:

- **Storage headroom.**
  Measure free space on the worktree base's filesystem at Bootstrap (`df -k "$WT_BASE"`; if you used the `wt-bootstrap` helper, it already reported this as `availBytes`).
  Estimate `per_worktree_need`, then cap the number of **live worktrees** at `max_concurrent = max(1, floor(free_bytes / per_worktree_need))`: a ready task waits for a slot while that many are live, and each delivery's reclaimed worktree frees one.
  A worktree left in place for inspection (a cap-out, a hold, a crash, or a delivery whose reclaim `wt-remove` refused — read the reclaim's outcome rather than assuming it) is still live and keeps its slot.
  Once every slot is held by a retained worktree, no delivery can free one, so a ready task that would wait on it ends **storage-throttled** instead — a terminal state its dependents skip on, named in the summary beside the cap — rather than waiting forever or being admitted over that headroom.
  When the package store hardlinks into worktrees (same filesystem), `per_worktree_need` is mainly build artifacts plus package metadata; otherwise, measure one representative install and add its full package-copy cost.
  When unsure, measure one install before fanning out.
- **`ENOSPC` mid-run.**
  Stop adding concurrency, let viable in-flight tasks finish, and reclaim only worktrees whose changes are committed and pushed.
  Then retry the failed and remaining tasks under a smaller live-worktree cap — ultimately one at a time.
  Never force-remove a worktree with uncommitted changes just to free space, and never abandon a task because the parallel attempt failed.
- **Shared exclusive resources.**
  Some validation cannot run two-at-once even in separate worktrees because it contends for a single host-wide resource: a fixed listen port, one shared dev database on one port, or a build/e2e server that infers the workspace root from the repo-root lockfile (see below).
  Run such phases **serially** however many tasks are live — give each task exclusive use, then move on.
- **Provider rate-limiting.**
  Repeated `429`/`529` errors when spawning many subagents at once are a signal to fan out less.
  Reduce the number of concurrent subagents per phase and proceed.

Record in the final summary whenever you throttled below the ready set, and why — it tells the user whether the run was storage-bound, provider-bound, resource-serialized, or genuinely serial by dependency.

### App-server / e2e validation in a worktree

Validation that boots a *built* app server is the most common thing that won't run from inside a worktree.
Next.js `next build` standalone output and Playwright's `webServer` both infer the workspace root from the repo-root lockfile, then look for the server at a path that ignores the nested `.worktrees/<slug>/` prefix — so `test:e2e` can't find the server and self-skips or errors.
This is a repo-config limitation, not something the worktree skill can fix from the outside; handle it by choosing one of these, in order of preference:

1. **Run that task's e2e phase serially in the main checkout** after its branch is pushed: from the main tree, **check out the branch tip detached** (`git checkout --detach <branch>`) — a plain `git checkout <branch>` fails with `fatal: '<branch>' is already used by worktree ...` because the branch is still checked out in the task's worktree — then build, run e2e, and restore the main checkout's prior HEAD.
   (Or remove the task's clean worktree first, then check out the branch normally.)
   This keeps unit/integration coverage in-worktree and serializes only the part that needs the un-nested path.
2. **Defer e2e to CI** and rely on the in-worktree unit/integration suites for the in-loop signal, noting in the PR that e2e runs in CI.
3. **Run it in-worktree only if the repo's config is worktree-aware** (resolves the standalone/server path from `next build`'s actual output dir rather than assuming repo root).

Treat a task whose acceptance hinges on app-server e2e as a **serialize-this-phase** task per the shared-resource rule above, and say so in the summary.
(Browser availability itself is fine in-worktree: `npx playwright install chromium`, or point Playwright at a system Chromium if your environment provides one via `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` — the worktree problem is the server path, not the browser.)

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

   `$WT_BASE` is the base directory chosen in Bootstrap.
   Make this **rerun-safe**: check `git worktree list` first — if the task's worktree already exists, it must have the expected branch checked out (reuse it, prior commits intact); if it is on a different branch, or the base does not resolve, **stop and report rather than guessing**.
   If the branch already exists from an interrupted prior run, attach it (second form) instead of creating it with `-b`.
   If a `wt-enter <slug> <branch> <base>` helper is on PATH, prefer it — it encodes exactly these checks and prints the worktree's absolute path.
   Use a stable, collision-free slug per task (e.g. the task number + short name).
   The worktree's absolute path is what you hand to that task's subagents.

2. **Run the task's loop.**
   Each task runs its own implement→review→fix loop to a pass, independently of every sibling: the phases below are one task's, and same-phase agents of different ready tasks (which live in different worktrees) simply overlap in time — spawn them **in one tool block** when several tasks reach the same phase together, but never hold one task's phase for another's:

   - **Phase A — implement:** spawn the task's implementer, pointed at its own worktree path — beside whatever sibling implementers are running.
     Wait for it to return.
   - Adopt each returned implementation packet only under `review-cycle`'s packet hard-check: `git -C <worktree> status --porcelain` empty **and** no Git operation in progress (`rebase-merge`/`rebase-apply` paths, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG` — a tree left mid-rebase prints empty porcelain).
     Either failing means redrive or resume that task's Phase A rather than handing Phase B a worktree nobody can build on.
     The rest of that skill's *The loop and its gates* binds this loop whole too, later additions included.
   - **Phase B — review:** spawn the task's fresh reviewer only once its implementer's commits are on disk — its packet returned and adopted under the hard-check above — in its worktree; nothing about a sibling's phase enters into it.
     At the same moment, unless `peer-opinions=off`, launch the task's background peer while the peer remains available.
     Every rule the `review-cycle` skill states under *The peer step* binds this batch whole, later additions included.
     Share that section's one session-local adaptive throttle across every task and round, queue launches it holds, and surface every step-down in the batch summary.
     Before triage, wait for this task's own reviewer and for its peer if one was launched.
   - A task exits the loop only when its round passes the `review-cycle` gate; tasks with issues carry both reports verbatim as separately labeled blocks into the next round's Phase A, under that skill's grounding, blocking-and-minor gating, dispute, timeout/retry, and forfeit rules — never re-summarized.
   - Repeat A→B until each task converges or hits the `review-cycle` round cap; a task still failing at the cap does **not** get a PR — surface its outstanding findings to the user.

   Concurrency is safe here **only because each agent has its own worktree.**
   If for any reason a task is not running in its own worktree, fall back to serializing that task as in `address-tasks-serialized`.

3. **When the loop passes, run the task through the serialized pre-delivery guard below** — one task at a time, in the order tasks pass (first-ready-wins).
   A task that clears it delivers at once: push and open its PR (see Delivery), then remove its worktree per Cleanup to reclaim storage (the branch and its commits persist in `.git` and on the remote).
   A task the guard holds does **not** open its PR yet; leave its worktree in place, reconcile the naming/path, symbol, or task-number conflict on the side the guard names, regenerate derived files, and re-review that task before delivery.

4. A task's delivery unlocks its dependents immediately (they branch from its now-stable branch) — never wait for the rest of the batch.
   A branch held by the guard is not delivered and must not unlock its dependents.

### Guarding against pre-PR collisions

Independent tasks run in **separate worktrees**, so two of them can each *add* the same new file — or a file exporting the same top-level class/symbol — with no conflict at implementation time.
The clash only surfaces later, when the branches linearize or merge (an add/add conflict, or a duplicate definition).
The task-number guard that follows extends the pre-PR check to task-number claims across the wider in-flight comparison set.

- **Prevent it up front.**
  When you fan out two independent tasks that both introduce the same *kind* of new surface (a "reconciliation controller", a "work-list endpoint", a migration helper), assign each a **distinct file and class name** in its implementer prompt.
  The implementers can't see each other, so the disambiguation has to come from you.
- **Catch it before the PR — one task at a time.**
  The moment a task passes review and **before** its PR, run it through the guard, serialized so that only one branch is ever under it (first-ready-wins, in the order tasks pass): compare what it newly added against every branch the run has **delivered or reserved** so far, by ref and from the main checkout — the scan enters no worktree, so it never becomes the new barrier:

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

  A duplicated path (or basename, or a shared exported top-level class/function/const/interface/type/enum name across two added files) is a collision.
  Hold the branch under the guard before PR delivery, then **deconflict — that call is yours to make** (a bounded exception to "the orchestrator doesn't implement", like building an integration branch): the branch under the guard is the side that changes — a delivered or reserved sibling is never rewritten — so rename enough files and/or symbols on it that no other holder shares the original colliding value, regenerate anything derived (e.g. contracts), and **re-review it with fresh eyes at the delivery tier** before its PR (the rename and the regeneration are a post-run change, so they void that task's own delivery-tier pass and owe it again); the sibling it clashed with is untouched and delivers, or has delivered, unchanged.
  If the shared name is **imperative** — a framework-mandated path, an external/published contract, or a name a task file explicitly pins — do **not** invent a divergent name: keep that branch held and surface it as a design decision for a human; a held branch holds only itself, and the pipeline keeps flowing around it.
  Diff each branch against **its own base** with the three-dot form so a dependent branch that legitimately builds on a sibling isn't flagged — it never re-lists an inherited file.

**Clearing the guard is a claim, held through delivery.**
A branch that clears the guard reserves what it claims — its added surfaces and every task number its new task files claim — and the reservation stands until its delivery settles, because delivery is not atomic.
Release is asymmetric.
The reservation **converts to delivered** once the PR exists (or, in a local-only run, once the reviewed branch is the delivery); it may be **dropped** only when delivery failed with no remote write; and where the push landed but PR creation did not, `origin` carries the branch while no PR advertises it, so the reservation **persists for the rest of the run** — see Delivery for what the batch owes such a branch before it ends.

**Early merges move the base.**
A sibling's PR can merge while the batch is still running; the guard's scan is where the run notices (read each delivered sibling's PR state as you compare against it).
A branch still on its way to delivery whose recorded base was that sibling's branch, or that shares the base the sibling merged into, is rebased onto the advanced base through `review-cycle`'s delegated rebase step before its final delivery-tier review — a dependent's PR base moves with it — so a clash with an already-merged sibling surfaces as an honest conflict at that rebase, never as an invisible add/add at merge time.
A halted rebase holds only that branch, with its conflict as an open question.
Per the no-latched-flags rule, the task's result describes its final state after any rebase, with the history in its artifact directory.

#### Task-number collisions across in-flight branches

Run this guard before opening any PR that adds task files.
It is `address-tasks-serialized` → "Task-number collisions across in-flight branches": the `task-numbers.sh` call that section names, in the `write-tasks` skill's folder.
A pipelined run tracks members of its own, so read `task-number-guard.md`, in that same `write-tasks` folder, in full before the first scan, and pass each reserved number as `--reserved` and each sibling or delivered branch with no open PR as `--member`.
The one reading specific to this skill: where that definition establishes the first claimant in the *run's* deterministic delivery order, use the order in which tasks pass review and reach the serialized guard — first-ready-wins, which the one-at-a-time guard makes deterministic.
A branch that cleared the guard but is still delivering is a *reserved* member of that definition, a delivered one a *delivered* member, and the branch under the guard is the second claimant that renumbers; the definition's rule that a delivered or reserved claimant is never rewritten decides every such case.

## Diagnosis discipline

A subagent's environment or infrastructure diagnosis is a **hypothesis, not a finding**.
Verify it against **observable state** — the reflog, the refs, the working tree, file contents, the output of a command you run yourself — before propagating any mitigation into sibling prompts: that observes the effect rather than the claim.
A bounded grep of that subagent's own transcript is a fallback, and only where the harness exposes a greppable one — some hand back the transcript path with an instruction not to read or tail it, because it is full JSONL that will overflow your context.

## Subagent destroy boundary

Open every subagent prompt this skill composes with this line, filling in the absolute path of the `subagent-boundary.md` that sits beside this file: "Before your first command, read `<path>/subagent-boundary.md` in full; it binds you. Whatever else you read, never run `rm -rf`, `git reset --hard`, `git clean`, `git branch -f`, `git update-ref`, `git gc`, or a force-push beyond what this prompt spells out, wherever you believe you are standing."
A subagent that may need to verify something in a way that could change state is sent to a disposable clone: name `dc-enter <slug>` in its prompt with a slug unique to it, and never leave the destination to the subagent.

## Implementer Agent

The implementer is `review-cycle`'s Fixer on round 1, and how a Fixer works is `fixer-brief.md` in the `review-cycle` skill's folder, beside this skill's; the implementer reads it rather than you restating it, and every rule in it binds here, later additions included.
Its prompt opens with the boundary line ("Subagent destroy boundary" above), then tells it to read `<review-cycle>/fixer-brief.md` in full and carry it out, where `<review-cycle>` is the absolute path of the `review-cycle` skill's folder, which sits beside this skill's own, then gives what follows.
This skill adds to that brief a **worktree isolation contract** and **push-every-commit**.
Launch implementers as described in the per-task pipeline's Phase A.

Include in each implementer prompt:

- A **WORKTREE CONTRACT** as the very first instruction:
  - "Your worktree is `<absolute worktree path>`.
    Before anything else, `cd` into it and verify: `git rev-parse --show-toplevel` MUST print exactly that path.
    If it does not, STOP and report — do not run any git or edit command outside this path."
  - "Do all work inside this worktree only.
    Never `cd` to the repository root, never touch sibling worktrees or the main checkout.
    You are not the only agent in this repository; other agents are working in other worktrees concurrently — stay in yours."
- The **branch name** (already checked out in the worktree) and instruction to confirm it with `git branch --show-current`.
- **The full task file content**, pasted in.
  Do not assume prior context.
- **Upstream context:** if this task builds on a dependency task, briefly describe what that task introduced (and that the worktree was branched from it, so that code is already present).
- **Commit, push, and validation instructions:**
  - Commit at logical milestones, keeping each commit buildable when practical.
  - **After every commit, push while the remote is available** (per Bootstrap's remote probe): `git push -u origin HEAD` on the first push, `git push` thereafter.
    Worktrees are disposable, so pushing is the backup.
    **In a known local-only run (Bootstrap's probe failed), skip pushing entirely** and rely on commits for durability — don't retry a push you already know will fail every commit; if a push unexpectedly fails mid-run, keep committing and note it — commits still persist locally.
  - Validate at the tier this round's brief states, per `review-cycle`'s two validation tiers: the round tier on an intermediate round, the delivery tier — the full applicable sanity set — on the state that concludes the task, before its PR.
    Say which you ran.
    The push-after-every-commit discipline above is durability, not delivery, and never raises the tier.
  - Any build or check output that must land in a file goes inside this worktree (a gitignored path, removed before any commit), never a shared scratchpad filename.
- **Coordination:** it must not revert unrelated or concurrent edits, and must accommodate that its base branch may itself be a sibling task's branch.
- **Reporting:** when done, report what was implemented, decisions/tradeoffs/deviations, and any areas needing focused review.

On a fix-up round, spawn a **fresh** implementer for the task — a new `Agent`, never a "continued" prior implementer.
If an `Agent` result prints a `SendMessage` continuation footer, ignore it; this harness does not expose that tool.
Paste both reports verbatim as separately labeled own-reviewer and peer blocks, omitting only a peer report forfeited under the `review-cycle` protocol, with the deviations and open questions that still stand, and instruct the implementer to address each finding specifically and report what changed (same branch, same worktree).

## Reviewer Agent

How a Reviewer works is `reviewer-brief.md` in the `review-cycle` skill's folder, beside this skill's — whole touched files rather than diffs, the acceptance criteria, the quality pass and its dimensions, **Pass** or a numbered **Issues** list — and the reviewer reads it rather than you restating it: its prompt opens with the boundary line, then tells it to read `<review-cycle>/reviewer-brief.md` in full and carry it out, where `<review-cycle>` is the absolute path of the `review-cycle` skill's folder, which sits beside this skill's own, then gives what follows; it launches no review of its own beside the loop's sanctioned peer step, which the prompt says since that brief does not.
A reviewer is always a **new** `Agent` invocation — a fresh-eyes spawn, never a continuation of the implementer.

Include in each reviewer prompt, beyond that inherited contract — which binds whole, later additions to it included:

- The same **WORKTREE CONTRACT** first: "Your worktree is `<absolute worktree path>`.
  `cd` into it and confirm `git rev-parse --show-toplevel` matches before doing anything.
  Review only this worktree."
- The **PR base branch** for this task.
  After assigning it and the task worktree to the shell variables `base` and `worktree`, the reviewer scopes with `git -C "$worktree" diff --name-only "$base"...HEAD`.
  The implementation is already committed on the current branch in this worktree — the reviewer must read the actual files and must NOT conclude "no implementation" without first confirming the diff is genuinely empty (an empty diff at this stage signals a wrong worktree/branch, not real absence — say so rather than reviewing nothing).
- Instruction to run the **build / type-check first at the validation tier this round states** (a failure at that tier is an automatic blocker; do not block on a heavier suite the stated tier did not run), then check each acceptance criterion against the code, then a code-quality pass over the touched files using the inherited checklist (logic, error handling, edge cases, dead code, consistency, duplication, type safety).
- **Where validation output goes:** any build or check output that must land in a file goes inside this task's worktree (a gitignored path, removed before any commit), never a shared scratchpad filename.
- **Do NOT edit, create, or delete any files** — the worktree-local validation output file above is the sole exception.

## Delivery (push + PR, per task)

Default behavior: each task that passes review and clears the guard gets **pushed and a PR opened** against its resolved base **the moment it does** — delivery is per task, never held for the batch, so a simple PR can be under review, or merged, while a hard sibling is still iterating.

1. **While the remote is available** (per Bootstrap's probe), ensure the final state is pushed — the implementer already pushed its branch during the loop: `git -C <worktree> push`.
   In a known local-only run (Bootstrap's probe failed), there is nothing to push; skip to the local-branch fallback in step 3.
2. Open the PR against the recorded base branch (the chosen base for independent tasks; the dependency's branch for dependent tasks → stacked PR).
   **If the recorded base exists only locally — a synthetic multi-parent integration branch, or a dependency branch not yet pushed — push it to the remote first** (`git push -u origin <base-branch>`); otherwise `gh pr create --base <base-branch>` fails because GitHub has no such base ref:

   ```bash
   gh pr create --base <base-branch> --head <branch-name> --title "<task title>" --body "<summary>"
   ```

   - Reference the task file for context.
     Include reviewer-relevant caveats (tradeoffs, intentional divergences, uncertainties).
   - For stacked PRs, note in the body which branch it stacks on, so reviewers understand the base.
   - **Assert the base on the PR you just created:** capture the URL `gh pr create` printed and read *that* PR back — `gh pr view <pr-url> --json baseRefName` — requiring it to equal the recorded base.
     Address it by URL rather than letting the current branch pick the PR: creation runs here in the main checkout, not in the task's worktree, so an argument-less `gh pr view`/`gh pr edit` would answer for the main checkout's branch — some other PR, or none.
     On a mismatch, repair it in the same breath (`gh pr edit <pr-url> --base <base-branch>`) and record in the final summary which PR was repaired and what base it carried, so a genuinely wrong determination stays visible instead of being silently corrected; if the repair fails, report that PR as **delivered with the wrong base** rather than as delivered.
   - **If a creation attempt fails before printing a URL, the PR may exist server-side anyway.**
     Before retrying creation, look it up by the recorded head branch in the repository that owns the PR — the base repository the creation targeted, never the head repository, where a fork's PR does not live: `gh pr list --repo <base-repo> --head <branch-name> --state open --json url,headRepositoryOwner`.
     `--head` cannot carry an `<owner>:<branch>` form, so require the returned PR's head repository owner to match the recorded head before trusting the match, then assert its base as above.
     Only a lookup that finds nothing licenses the retry, and a delivery ending with neither a captured URL nor a lookup match is reported as that distinct failure, never as an opened PR.
3. If pushing/PR creation is unavailable (no remote auth — see Bootstrap step 3), fall back to **local reviewed branches**: the work persists in the shared `.git`.
   Note in the final summary which branches still need to be pushed once a remote is reachable.

Do not delete the branch — the PR and any dependents need it (removing a worktree never touches branches).

**A pushed branch left without a PR is a terminal-state obligation.**
Act on such a branch the moment its delivery settles, before its terminal state reaches its dependents: retry PR creation once (looking first for a PR the failed attempt may have opened, and reading the base back), and where that fails delete the branch from `origin` (its commits stay in the shared `.git` for a later push).
A retry that succeeds delivers it and unlocks its dependents; a branch deleted from origin is local-only and — on a run with a remote — unlocks nothing.
Name any branch that survives both attempts in the final summary beside the task number it still holds, so the next run can reclaim it by hand.

## Cleanup

- Remove a task's worktree once its PR is open — a **delivered** task's only.
  A task that stopped short of delivery (a review cap-out, a guard hold, a crash) keeps its worktree in place for inspection and keeps its live-worktree slot (see Storage headroom above): report it as retained, with the state it stopped in, rather than removing it.
  First verify a delivered worktree is safe to remove: `git -C <worktree> status --porcelain` must be empty and no Git operation may be in progress (no `rebase-merge`/`rebase-apply` paths, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, or `BISECT_LOG` under its git dir — the same six the packet hard-check names).
  Then `git worktree remove <path>`.
  **Never force-remove a worktree with uncommitted changes or an in-progress Git operation** — `git worktree remove --force` destroys that work; if the checks fail, leave the worktree in place and report why rather than deleting evidence.
  Use `--force` only to clear git's refusal over leftovers like ignored build artifacts *after* the clean checks pass.
  If a `wt-remove` helper is on PATH, prefer it — it enforces the full set itself (even with `--force`), so the enumerated list is the helper-absent fallback.
- After removing a worktree, run `git worktree prune` to clear its stale registration.
- Removing a worktree does not delete its branch; a dependent can still branch from that ref after the worktree is gone.

## Post-batch overlap check

After Delivery and Cleanup, a batch that delivered two or more mergeable branches ends with a read-only forecast of how they will meet.
A mergeable branch is one that passed review, that the user did not ask to skip, and whose PR did not merge during the run.

**Compute the merge order yourself.**
Reuse the dependency graph and emit a topological order: every dependency precedes its dependents.
Break ties between independent branches deterministically: keep closely related areas adjacent, then fall back to task number.
Dependency edges are binding; the relative order of independent branches is only a stable review recommendation, not a newly invented dependency.

Then run `overlap.sh`, beside this file, from the main checkout: `overlap.sh --base <base> <b1> … <bN>`, the branches in that order and `<base>` the commit the PRs are headed for as the batch last fetched it.
Its `--help` prints what every line means.
It trial-merges each branch into the base and every pair of branches with `git merge-tree`, so it fetches nothing and touches no ref, index or working tree.
Report what it answers, and act on none of it:

- `outcome=clean`: one line saying no two independent branches touch the same file.
- `outcome=overlap`: the pairs and their `shared=` files, as a note for whoever reviews them side by side.
- `outcome=conflict` (exit 3): each conflicting pair with its `conflict=` files, and each branch with a `base-conflict=` file, which already needs a rebase onto the base as it stands.
  Whichever of a conflicting pair merges second is the one that will need the rebase, so say which you would merge first and why.
- Exit 1: the check did not run, with what it printed, never as a clean result.

**On a conflict, offer to stack the pair, and do it only when the user says so.**
The offer is one closing line of the summary: rebase the later branch of the pair onto the earlier one now, while the batch's context is still at hand, resolve the conflict there, push it, and repoint its PR's base to the earlier branch (`gh pr edit <N> --repo <owner>/<repo> --base <earlier branch>`), which makes the two a stacked pair like any other.
It rewrites a delivered PR's branch and turns advice about order into a dependency, so it is never done unasked, and a batch that nobody is watching leaves the offer in its report.
When the user takes it, the rebase is `rebase-stack`'s, the changed branch goes back through its review gate before the push, and the push is a leased one.

### The local review stack, on request

A full integration check is available and is not part of a batch: one linear **local** stack of disposable `review-stack/...` branches, rebased in the recommended order and never pushed.
Build it only when the invocation carries `review-stack` or the user asks for it afterwards; then read `review-stack.md`, beside this file, in full and carry it out.

## Main-checkout cleanliness report

Every task runs in its own worktree, but the repository's main checkout is shared — with the maintainer, and with any peer harness running in the same container.
Take a reading of its working-tree state at Bootstrap, and take the same reading again once **every** batch entry has reached a terminal state.
Trigger it on batch termination, not on "the last task delivers": a batch in which every task blocks, fails, or aborts never reaches a delivery.

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

After the batch, provide a concise summary:

- Each task: its PR link (or "local branch only" if PRs were skipped) and its terminal state — delivered, merged during the run, pushed without a PR, held by the guard, capped, crashed, storage-throttled, or skipped for a failed prerequisite.
- How many review rounds each task needed, and any task that hit the `review-cycle` round cap without passing (with its outstanding findings).
- Whether the peer participated; if it was unavailable or forfeited any rounds, note the reason once without treating it as a failure.
- The dependency graph actually used, the order in which tasks reached the guard, any base a merged sibling advanced (and the rebases it caused), and any base-branch/stacking choices worth flagging.
- The **recommended merge order** using canonical PR branch names — `b1 → … → bN`, merge `b1` first — with the overlap check's answer: the pairs that share files, the pairs and branches that conflict, or that the check did not run.
  Independent-branch tie ordering is advisory.
  On a conflict, close with the offer to stack the pair; where a review stack was asked for, add its guide refs, the integration-checked prefix, any stop point or merge-history guard, reproducible conflict notes and any empty guide branch, and make clear it is local only.
- The main-checkout cleanliness report: what appeared, what disappeared, and what was pre-existing — carried with the claim bound that section states, never as an assurance the batch left the tree untouched.
- Any pushed branch that survived its orphan reconciliation, and any held branch whose durability push sits on origin without a PR, each named beside the task numbers it still holds — a held branch is outside the same-number comparison set, so the maintainer is the one who sees its number.
- Any blockers, local branches that still need pushing, or uncertainties that remain.
