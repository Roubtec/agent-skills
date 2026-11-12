---
name: merge-train
description: A batch of reviewed PRs needs to be babysat through CI and merged one after another while the user is away. Trigger when the user hands over a list of PR numbers to merge as they pass CI, asks to run a merge train, babysit or shepherd PRs to merge, or merge a batch serially by rebasing each PR on main in turn.
---

# merge-train

Take a list of PRs that are ready to merge apart from pending CI, watch them, and merge them into `main` one at a time: whichever is ready next is rebased onto the latest `origin/main` and merged with a merge commit, so every branch sits directly on the `main` it merges into (semi-linear history).
Expect the run to be largely unattended; the run is hands-off after a short preflight, and the deliverable is the final report.

Leaves anything that needs a human call unmerged, including PRs with unresolved review threads.
For addressing review threads use `address-review`/`address-reviews` instead, for restacking branches without merging use `rebase-stack`.

**Arguments:** `<PR numbers…> [--pause-on-review] [notes]`: the PRs to merge, plus anything the user says about them in the same message (which ones are already failing, an overlapping effort elsewhere, a shared counter to watch).
Carry every such note through the run.
`--pause-on-review` changes what a review arriving mid-run does (see *Open review items*).

## Ground rules

- **Merge mechanics.**
  Rebase the PR onto the latest `origin/main`, push with `--force-with-lease=<branch>:<the exact sha you rebased from>`, then `gh pr merge <N> --merge --match-head-commit <pushed sha>`.
  Never squash, never merge a PR that is not on the current `origin/main`.
- **One writer.**
  Rebase in a task worktree (`wt-enter merge-train-<N> <branch> origin/<branch>`, then `git -C <wt> reset --hard origin/<branch>`, since a local branch of the same name may be stale), never in the main checkout.
  State-changing git runs as `git -C <abs path>` in one sequential call.
- **Leave the user's calls to the user.**
  A conflict whose resolution changes behavior, or a red lane whose fix needs a product or money decision: leave that PR unmerged and say why in the report.
  Mechanical conflicts are yours to resolve: imports, adjacent additions, a renamed neighbor, a regenerated artifact, prose where both sides only added.
- **CI failures are yours to chase.**
  Re-run a lane that failed for a flaky or infrastructure reason.
  Push a fix to the PR when the PR caused the failure.
  Use `review-cycle` for larger edits to increase confidence.
  When `main` itself becomes broken, open a standalone fix PR, give bots time to comment on it (usually takes less time than CI does), address any actionable feedback using `address-review`, and merge it inside the train to pre-empt those CI failures from blocking the other PRs.
  If the runners themselves keep failing and nothing in the code is at fault, stop the train and report rather than burn the queue.
- **Never merge a PR with open review items.**
  These are unresolved review threads (`gh-review-threads <N>`) or a review requesting changes.
  They are the maintainer's to settle, and merging over them makes follow-up churn.
  A user who lists such a PR has most likely missed the open items.
  Do not address them yourself on a listed PR.
  The train skips that PR, together with every PR stacked on it, and the user can ask to merge it again once it is clean.
  See *Open review items* for how the preflight and the loop handle this.
- **The train's own fix PRs** are the exception: review on a fix PR you opened goes through `address-review`, because you own that PR.
- **The report goes in your final message,** there is no place for it on GitHub.

## Preflight, before the user leaves

Survey every PR: base branch, mergeable state, check results, open threads, the files it touches, and any migrations it adds.
From that, work out and tell the user:

- **Stacks.**
  A PR based on another PR's branch waits for its parent to merge.
  It then needs a rebase onto `main` and a **full** CI run, because stacked PRs deliberately skip the expensive lanes while their parent churns.
- **Unblockers.**
  A fix PR that other PRs' red lanes depend on goes first, whatever its readiness rank.
  Recognize these from the failure logs: the same lane red on several PRs for one cause outside all of them.
- **Ordering hazards.**
  Migration timestamps (see *Ordering*), shared counters several PRs bump, generated artifacts several PRs regenerate.
- **The plan:** order, which PRs you expect to merge without a fresh CI run, and what you will leave unmerged.
  A PR that is passing on its own will likely pass after rebase and may be merged prematurely unless something indicates that waiting for a full CI run again is advisable.

- **Open review items.**
  If any listed PR has them, name the PRs and their open items, together with any PRs stacked on them.
  Ask the user to choose: skip those PRs and merge the rest, or not start the entire train at all.
  This is the one question the preflight always asks when it applies.
  Ask it before anything else, because the user will likely leave.

Otherwise, ask only what changes what you will do.
Then start.

### Open review items

The preflight question above settles the PRs that already have open items.
A review that arrives mid-run lands while the user is away.
The user is not expected to unblock it and does not care about the exact order, so the train handles it without asking:

- **By default, skip that PR** and every PR stacked on it, and keep merging the rest.
  Leave the skipped PR's branch as it is, apart from a rebase already pushed.
  If you cancel its in-flight CI run to free up a runner, say so in the report.
- **With `--pause-on-review`,** the first review item on any listed PR stops the whole train after the merge in progress, if any.
  Report what merged and what is waiting, and wait for the user.

Check for open items twice for each PR: when you pick it up, and again just before the merge call, since a review may land while its CI runs.
Both checks count a review or comment newer than the last push, and unresolved threads.
Not all comments are blocking, only consider pausing on actionable feedback.

## The loop

Watch with a background `Monitor` that polls `gh pr view <N> --json state,headRefOid,statusCheckRollup` for the active PRs and emits a line only on a terminal transition: all checks complete, a new failure, a merge.
Monitors expire, so re-arm on expiry and widen the filter if the silence was unexpected.
React to each event:

1. **A PR goes green.**
   Check for open review items, and skip or pause as *Open review items* says.
   Rebase it onto `origin/main`.
   Decide whether it needs another CI run (*Merge now or wait*).
   Push, wait for GitHub to report it `MERGEABLE` (right after a push it briefly reports "not mergeable"), and merge.
2. **A PR goes red.**
   Read the failed job's log before re-running anything.
   Classify the failure: flaky or infrastructure, the PR's own, or `main`'s.
   Then act as the ground rules say.
3. **After every merge,** re-assess the remaining PRs.
   Their CI was run against an older base, so the next merge decision has to account for everything that landed since.

### Merge now or wait

The cost of a fresh CI run is hours when runners are scarce, so do not spend one by reflex.
A PR **merges right after its rebase** when all of these hold: its last full CI run was green, the rebase was clean, and nothing merged into `main` since that run's base touches the files or mechanisms the PR depends on.
To find what landed since, compare the run's `createdAt` with the merges' `mergedAt`, then intersect `git diff --name-only <run base>..origin/main` with the PR's files.

A PR **gets a full CI run** when the rebase resolved a conflict in code, when it is a stacked child whose parent just merged, or when what landed since overlaps a risk class this repo reviews conservatively (money, auth, migrations, state of sensitive documents).

The middle ground is often the right one: run the affected checks locally instead of the whole queue.
That means typecheck, regenerating generated artifacts and checking for drift, the counter or registry tests the overlap could break, and the DB-backed specs for the overlapping area against a throwaway database, if applicable (`pg-dev-up --worktree`).
Say in the report which PRs merged on local checks and what those checks were.

### Ordering

First green wins, with three exceptions (if applicable for the given repository):

- **Unblockers jump the queue.**
- **Hold, don't push, a PR that cannot go green yet.**
  When a red lane on a PR waits on a fix landing in `main`, rebasing and pushing it before the fix merges spends a full CI run on a result you already know.
  Rebase once, after the unblocker lands.
- **Weakly prefer landing migration timestamps in order if practical and trivial.**
  Prisma applies out-of-order migrations, but interleaved ones are harder to roll back by hand.
  Prefer merging migration-bearing PRs in stamp order.

If another PR (especially not from our list) has merged while we were waiting, this is not necessarily a blocker.
Use judgment whether to start rebasing on top of the new `origin/main` tip immediately, wait (bounded) for conditions to be favorable for continuing, or stop the train if continuing would waste CI resources or violate the repository's merge policies.
Other contributors may not be aware that a merge train is in flight so use judgment on how to proceed in a way that balances efficiency and coordination.

### Stacked PRs and the merge API

A PR that GitHub considers part of a stack refuses `gh pr merge` ("must be merged using the asynchronous merge REST API") and refuses a base change.
That holds for the bottom PR, and for a child even after its parent merged and GitHub retargeted it to `main`.
Merge through `PUT repos/{owner}/{repo}/pulls/<N>/merge-async` with `merge_method=merge`, `merge_action=direct_merge` and `sha=<pushed head>`.
Then poll `GET …/pulls/<N>/merge-async/<uuid>` until `status` is `merged` or `failed`.
For a stacked request the async merge "includes all open downstack pull requests", which is nothing extra for the bottom PR.

After the parent merges, rebase the child with `git rebase --onto origin/main <parent's old tip> <child>`, so the parent's pre-rebase commits do not replay.
The child then needs its full CI run.

### Runner economy

The queue may be shared with other sessions on a machine with limited runner slots.
Consider freeing what the train will not use:

- Cancel a PR's in-flight CI run when the PR has to be re-pushed anyway: it turned `CONFLICTING`, or its red lane waits on a `main` fix.
- After a re-push, cancel the previous head's CI run yourself.
  Lane-level concurrency cancels a stale lane only once the new run reaches that lane, and until then the stale run's queued jobs can take a runner.
- When the queue stalls, look at which runner labels the waiting jobs need (`gh api repos/{owner}/{repo}/actions/runs/<id>/jobs`) and which runners are busy (`…/actions/runners`).
  A stall from a small PR pool is a wait; runners offline or erroring is an infrastructure problem worth reporting.
- Runs left `queued` with zero jobs are ghost runs.
  They hold no runner and `gh run cancel` does not move them, so leave them alone.

## Finishing

After the last merge, watch `main`'s own CI run on the final tip.
Each merge's push cancels the previous `main` run, so that one run covers the whole train.
A lane cancelled with no newer push behind it, or failed for an infrastructure reason, gets one re-run once the run completes.
A real failure gets a fix PR, per the ground rules.
If foreign pushes start interfering with `main`'s CI after the train is done, abandon the watch and report forfeiting the responsibility for follow-up work.

Use reasonable effort to re-run failed CI runs/jobs for `main`, taking into account infrastructure issues, runner contention, and the history and state of the merge train session.
Stop the retries on persistent failures and report the issues encountered for the user to take further action.

The final report gives, for each PR: merged (merge commit, and whether on a fresh CI run, on local checks, or as a clean rebase of a green run), skipped for open review items (which items, and which stacked PRs went with it), or left unmerged (why, and what the user has to decide).
Add fix PRs opened, conflicts resolved and how, re-stamps, runs cancelled, the state of `main`'s CI, and any observations about the CI pipeline worth the user's time.
