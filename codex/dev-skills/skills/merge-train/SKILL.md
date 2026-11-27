---
name: merge-train
description: A batch of reviewed PRs needs to be babysat through CI and merged one after another while the user is away. Trigger when the user hands over a list of PR numbers to merge as they pass CI, asks to run a merge train, babysit or shepherd PRs to merge, merge a batch serially by rebasing each PR on main in turn, or run merge-train. Not for addressing review feedback (use address-review or address-reviews) or for restacking branches without merging them (use rebase-stack).
---

# merge-train

Take a list of PRs that are ready to merge apart from pending CI, watch them, and merge them into `main` one at a time: whichever is ready next is rebased onto the latest `origin/main` and merged with a merge commit, so every branch sits directly on the `main` it merges into (semi-linear history).
The run is hands-off after a short preflight, and the deliverable is the final report.
`main` throughout stands for the repository's default branch.

It leaves anything that needs a human call unmerged, including PRs with unresolved review threads.
For addressing review threads use `address-review`/`address-reviews` instead, for restacking branches without merging use `rebase-stack`.

The mechanical steps are in `train.sh`, beside this file: reading a PR's standing, the rebase, the leased push, and the merge with its checks.
Run it by its absolute path; `--help` prints its full contract.
Where the PRs are on a host other than github.com, write `--repo` as `<host>/<owner>/<repo>`.
It prints `key=value` lines with `outcome=` first, exits 0 to proceed and 3 on anything else it read cleanly, and explains itself on stderr.
Exit 1 is a failure with no `outcome=` line (the network, `gh`): retry it once, then treat it as unread.
Do not reproduce its steps by hand, and never work past one of its stops by running the rebase, push or merge yourself.

**Arguments:** `<PR numbers…> [pause-on-review] [notes]`: the PRs to merge, plus anything the user says about them in the same message (which ones are already failing, an overlapping effort elsewhere, a shared counter to watch).
Carry every such note through the run.
`pause-on-review` changes what a review arriving mid-run does (see *Open review items*).

## Ground rules

- **Merge mechanics.**
  `train.sh rebase` brings the PR onto the latest tip of `main`, `train.sh push --expect <before>` publishes it under an exact lease, and `train.sh merge --head <pushed head>` merges it with a merge commit on exactly that head.
  `merge` refuses a PR that is not open, has moved, is based on another branch, has open review items, or is behind `main`.
  Never squash, and never bypass what the repository enforces (`--admin`, `bypass_rules`): a merge the rules refuse is a human call.
- **One writer.**
  Rebase in a task worktree, never in the main checkout: `wt-enter merge-train-<N> <branch> origin/<branch>` where the helper is on PATH, plain `git worktree add` otherwise.
  `train.sh rebase` brings a stale local branch up to the PR head only where that discards nothing.
  It stops where the PR head is not the `--head` whose rollup you read (`moved`), on a dirty or mid-operation worktree (`dirty`), and on a local branch holding commits the PR head lacks (`local-ahead`, `divergent`); a branch checked out somewhere else cannot be attached at all.
  All of these are the user's to sort out: leave that PR unmerged and report it, rather than reset, detach or switch anything.
- **Leave the user's calls to the user.**
  A conflict whose resolution changes behavior, or a red lane whose fix needs a product or money decision: leave that PR unmerged and say why in the report.
  Abort the rebase first, so the branch stays as the PR has it.
  Mechanical conflicts are yours to resolve: imports, adjacent additions, a renamed neighbor, a regenerated artifact, prose where both sides only added.
- **CI failures are yours to chase.**
  Re-run a lane that failed for a flaky or infrastructure reason.
  Push a fix to the PR when the PR caused the failure.
  Use `review-cycle` for larger edits to increase confidence.
  When `main` itself becomes broken, open a standalone fix PR, give bots time to comment on it (usually takes less time than CI does), address any actionable feedback using `address-review`, and merge it inside the train to pre-empt those CI failures from blocking the other PRs.
  If the runners themselves keep failing and nothing in the code is at fault, stop the train and report rather than burn the queue.
- **Never merge a PR with open review items.**
  These are unresolved review threads or a reviewer whose latest review requests changes: `outcome=review` from `train.sh check`, which reads the reviews themselves because GitHub's review decision stays empty where no rule requires reviews.
  They are the maintainer's to settle, and merging over them makes follow-up churn.
  A user who lists such a PR has most likely missed the open items.
  Do not address them yourself on a listed PR.
  The train skips that PR, together with every PR stacked on it, and the user can ask to merge it again once it is clean.
  See *Open review items* for how the preflight and the loop handle this.
- **The train's own fix PRs** are the exception: review on a fix PR you opened goes through `address-review`, because you own that PR.
- **The report goes in your final message;** there is no place for it on GitHub.
  Log each merge and its basis, each cancelled run and each resolved conflict in a line of output as it happens: the run outlasts what you will remember of it, and the report is assembled from those lines.

## Preflight, before the user leaves

Run `train.sh survey --repo <owner>/<repo> <PR numbers…>`.
It prints one line per PR (its `check` outcome, base, `parent=`, head, mergeability, review decision, open threads, CI, passing lanes, file count) and a `shared=` line for each file two or more of them touch.
A line reading `outcome=unreadable` is a listed number it could not read (`reason=no-such-pr`: the repository has no such PR, most often a mistyped number; `reason=gh-failed`: it could not be asked about), and the survey then answers `outcome=incomplete` with exit 3: name each such number to the user before starting, and run the train without it unless they correct it.
From that, and from the diffs where a `shared=` line or a migration calls for a look, work out and tell the user:

- **Stacks.**
  A PR with a `parent=` waits for that PR to merge.
  It then needs a rebase onto `main` and a **full** CI run: its checks ran against the parent's branch, and a pipeline may deliberately skip the expensive lanes on a stacked PR while its parent churns.
- **Unblockers.**
  A fix PR that other PRs' red lanes depend on goes first, whatever its readiness rank.
  Recognize these from the failure logs: the same lane red on several PRs for one cause outside all of them.
- **Ordering hazards.**
  Migration timestamps (see *Ordering*), and among the `shared=` files the counters several PRs bump and the generated artifacts several PRs regenerate.
- **The plan:** order, which PRs you expect to merge without a fresh CI run, and what you will leave unmerged.
  A PR that is passing on its own will likely pass after rebase, so expect to merge it right after the rebase unless *Merge now or wait* says a fresh run is advisable.

If any listed PR shows `outcome=review`, name those PRs and their items, together with any PRs stacked on them.
Ask the user to choose: skip those PRs and merge the rest, or not start the entire train at all.
This is the one question the preflight always asks when it applies.
Lead with it, because the user will likely leave.

Otherwise, ask only what changes what you will do.
Then start.

### Open review items

The preflight question above settles the PRs that already have open items.
A review that arrives mid-run lands while the user is away.
The user is not expected to unblock it and does not care about the exact order, so the train handles it without asking:

- **By default, skip that PR** and every PR stacked on it, and keep merging the rest.
  Leave the skipped PR's branch as it is, apart from a rebase already pushed.
  If you cancel its in-flight CI run to free up a runner, say so in the report.
- **With `pause-on-review`,** the first review item on any listed PR stops the whole train after the merge in progress, if any.
  Report what merged and what is waiting, and wait for the user.

Check for open items twice for each PR: when you pick it up, and again just before the merge call, since a review may land while its CI runs.
With `pause-on-review`, both checks cover every PR still on the list, because that mode stops on a review item on any of them.
Each check is `train.sh check --since <the checked= of your last check of that PR>`: `outcome=review` is the open items the ground rule names, and each `new=` line is a top-level review or comment that arrived since.
An unresolved thread or a review requesting changes always blocks; read each `new=` item, which blocks only when it carries actionable feedback.

## The loop

Watch with a shell loop that polls `train.sh check --repo <owner>/<repo> --pr <N> --head <the head you expect> --lane <identity>…` for the active PRs and exits the first time an outcome changes.
`check` reads the rollup by what it positively says: `ready` means every lane has settled on `SUCCESS`, `NEUTRAL` or `SKIPPED`.
Right after a push the new head's rollup is empty or partial, and a partial one can be all green.
So keep the `passing=` lines `check` printed for the PR's last full green run, and pass each as its own `--lane` on every check of a later head: a lane among them that has not shown yet makes the answer `waiting` with a `missing=` line, never `ready`.
Leave `--lane` out only for a head whose full run you are reading for the first time.
`survey` prints the count alone, and a watch that reports only outcome changes drops the lines, so before rebasing a PR that reads `ready`, run `check` on that head once and keep its `passing=` lines.
`moved` means someone pushed: put that PR back under watch on its new head instead of rebasing or merging it.
Give the loop a deadline of its own, because the shell tool's wait hands control back without stopping the command.
When a call returns with the loop still running, resume that session instead of starting a second loop, and start a new one only after the last has exited.
Widen what counts as a transition if the silence was unexpected.
Nothing wakes a finished turn, so keep waiting in this one until the train is done or stopped.
React to each event:

1. **A PR goes green** (`outcome=ready`).
   Check for open review items, and skip or pause as *Open review items* says.
   Run `train.sh -C <worktree> rebase --repo <owner>/<repo> --pr <N> --head <the head check called ready>`.
   `moved` means the PR head is no longer that one: put the PR back under watch on its new head, whose rollup is the one that counts.
   On `conflict`, resolve it and `git -C <worktree> rebase --continue`, or `git -C <worktree> rebase --abort`, as the ground rules say; the head to push is then the worktree's `HEAD`.
   Decide whether it needs another CI run (*Merge now or wait*).
   If it does, push and put it back under watch: it returns to this step when that run is green.
   Otherwise push (nothing to push on `current`) and run `train.sh merge --head <head>`, which waits out the moment after a push when GitHub reports "not mergeable".
2. **A PR goes red.**
   Read the failed job's log before re-running anything: each `lane=` line of `check` carries the lane's URL, and `ci.sh log --url <url>` and `ci.sh rerun --url <url>` read the failing log's tail and re-run the failed jobs (that `ci.sh` is the `address-review` skill's, in the folder beside this skill's).
   Classify the failure: flaky or infrastructure, the PR's own, or `main`'s.
   Then act as the ground rules say.
3. **After every merge,** re-assess the remaining PRs.
   Their CI was run against an older base, so the next merge decision has to account for everything that landed since.

### Merge now or wait

The cost of a fresh CI run is hours when runners are scarce, so do not spend one by reflex.
A PR **merges right after its rebase** when all of these hold: its last full CI run was green, the rebase was clean, and nothing merged into `main` since that run's base touches the files or mechanisms the PR depends on.
`train.sh rebase` prints the evidence: `landed=` counts the files changed on `main` since the green run forked from it, and each `overlap=` line is one of them that the PR touches too.
It takes the green run's head as `--head` unless told otherwise, so once you have rebased and pushed a PR without a full run going green on that push, pass `--green <the head its last full green run was on>` on every later rebase: without it the lines cover only what landed since the previous rebase, and an overlap that called for a run would read as gone.
No `overlap=` line rules out the files; the mechanisms (a counter, a registry, a generated artifact that reads other files) are yours to judge from what landed.
This shortcut needs a repository that lets a not-yet-checked head merge: where branch protection requires checks on the pushed head, `merge` answers `refused`, so wait for the run.

A PR **gets a full CI run** when the rebase resolved a conflict in code, when it is a stacked child whose parent just merged, or when what landed since overlaps a risk class the repository reviews conservatively (for example money, auth, migrations, the state of sensitive documents).

The middle ground is often the right one: run the affected checks locally instead of the whole queue.
That means typecheck, regenerating generated artifacts and checking for drift, the counter or registry tests the overlap could break, and the DB-backed specs for the overlapping area against a throwaway database, if applicable (`pg-dev-up --worktree` where that helper exists).
Say in the report which PRs merged on local checks and what those checks were.

### Ordering

First green wins, with three exceptions (if applicable for the given repository):

- **Unblockers jump the queue.**
- **Hold, don't push, a PR that cannot go green yet.**
  When a red lane on a PR waits on a fix landing in `main`, rebasing and pushing it before the fix merges spends a full CI run on a result you already know.
  Rebase once, after the unblocker lands.
- **Weakly prefer landing migration timestamps in order if practical and trivial.**
  A migration tool that applies out-of-order stamps (Prisma does) makes this a preference: interleaved migrations are only harder to roll back by hand.
  A tool that refuses them makes it a constraint: merge those PRs in stamp order, or re-stamp the later one as part of its rebase and give it a full CI run.

If another PR (especially one not on the list) has merged while you were waiting, this is not necessarily a blocker: `merge` answers `behind`, and a rebase puts the PR back on the tip.
Use judgment whether to start rebasing on top of the new tip immediately, wait (bounded) for conditions to be favorable for continuing, or stop the train if continuing would waste CI resources or violate the repository's merge policies.
Other contributors may not be aware that a merge train is in flight, so use judgment on how to proceed in a way that balances efficiency and coordination.

### Stacked PRs and the merge API

A PR that GitHub considers part of a stack refuses an ordinary merge and a base change: `train.sh merge` answers `async-required`.
That holds for the bottom PR, and for a child even after its parent merged and GitHub retargeted it to `main`.
Merge through `PUT repos/{owner}/{repo}/pulls/<N>/merge-async` with `merge_method=merge`, `merge_action=direct_merge` and `sha=<pushed head>`.
Then poll `GET …/pulls/<N>/merge-async/<uuid>` until `status` is `merged` or `failed`.
For a stacked request the async merge "includes all open downstack pull requests", which is nothing extra for the bottom PR.
So request it only for a PR with no open PR beneath it: on a child it would merge the parents too, whatever state they are in.

After the parent merges, rebase the child with `train.sh rebase --from <parent's old tip>`, so the parent's pre-rebase commits do not replay.
The old tip is the parent's head from before you rebased it (the `before=` of its rebase, or its head where that answered `current`), so note it then.
A child outside GitHub's own stacks keeps its parent's branch as base unless GitHub retargeted it when that branch was deleted: `rebase` then answers `stacked` and prints the `gh pr edit <N> --base main` that retargets it.
The child then needs its full CI run.

### Runner economy

The queue may be shared with other sessions on a machine with limited runner slots.
Consider freeing what the train will not use:

- Cancel a PR's in-flight CI run when the PR has to be re-pushed anyway: it turned `CONFLICTING`, or its red lane waits on a `main` fix.
- After merging right after a rebase, cancel the CI run that push started on the PR, but only where `main` gets a run of its own to cover the same tree.
- After a re-push, cancel the previous head's CI run yourself.
  Lane-level concurrency cancels a stale lane only once the new run reaches that lane, and until then the stale run's queued jobs can take a runner.
- When the queue stalls, look at which runner labels the waiting jobs need (`gh api repos/{owner}/{repo}/actions/runs/<id>/jobs`) and which runners are busy (`…/actions/runners`).
  A stall from a small PR pool is a wait; runners offline or erroring is an infrastructure problem worth reporting.
- Runs left `queued` with zero jobs are ghost runs.
  They hold no runner and `gh run cancel` does not move them, so leave them alone.

## Finishing

After the last merge, watch `main`'s own CI run on the final tip.
Where the repository's workflows run on pull requests only, no such run will appear: say so in the report instead of waiting for one.
Where each push to `main` cancels the previous `main` run, that one run covers the whole train.
A lane cancelled with no newer push behind it, or failed for an infrastructure reason, gets a re-run once the run completes.
Use reasonable effort on further re-runs, taking into account infrastructure issues, runner contention, and the history and state of the train.
Stop the retries on persistent failures and report the issues encountered for the user to take further action.
A real failure gets a fix PR, per the ground rules.
If foreign pushes start interfering with `main`'s CI after the train is done, abandon the watch and report forfeiting the responsibility for follow-up work.

Remove each worktree you created once its PR is merged or given up (`wt-remove merge-train-<N>`, or plain `git worktree remove`).
Leave the branches themselves alone: the remote ones belong to the repository's auto-delete setting, the local ones to `prune-branches`.

The final report gives, for each PR: merged (merge commit, and whether on a fresh CI run, on local checks, or as a clean rebase of a green run), skipped for open review items (which items, and which stacked PRs went with it), or left unmerged (why, and what the user has to decide).
Add fix PRs opened, conflicts resolved and how, re-stamps, runs cancelled, the state of `main`'s CI, and any observations about the CI pipeline worth the user's time.
