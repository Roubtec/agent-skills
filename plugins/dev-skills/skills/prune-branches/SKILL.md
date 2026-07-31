---
name: prune-branches
description: "Safely classify and prune local Git branches after merged task batches while preserving uncertain or recoverable work with backup refs. Trigger when the user asks to prune branches, clean up local branches or the workspace, delete merged branches, or remove post-batch branch scaffolding. Do not trigger for remote branch cleanup, deleting branches on origin, rebase-stack work, or enabling worktrees."
---

# Prune Branches

Clean up local post-batch branches conservatively, without mutating the remote or losing work.

**Arguments:** `[no-pull] [hands-off] [free-form keep/delete guidance]`

## Invocation and arguments

Explicit Claude Code invocation uses `/dev-skills:prune-branches`; natural-language equivalents are fine.

Parse arguments leniently and let the inventory listing be the safety net:

- `no-pull` keeps the local default branch at its current tip; the initial `git fetch --prune` still runs.
- `hands-off` prints the listing and then performs a best-effort purge without waiting: delete only Merged and Transient branches, reserve recovery refs for every Transient deletion, and leave every Uncertain branch untouched.
- Treat all other text as guidance, especially branch names to keep and context such as "there is stashed work on X." Resolve and apply keeps before classification and before showing the listing.
- In an interactive run, plain `go` confirms only the proposed Merged and Transient set. Deleting an Uncertain branch requires the user to name that branch explicitly during this run; invocation-time instructions such as `delete old-spike even if uncertain` count only when they are unambiguous.

## Absolute safety rules

- Never push, delete a remote branch, edit a PR, or otherwise mutate `origin`. Allowed remote access is read-only: `git fetch`, `git remote set-head origin --auto`, read-only `gh` queries, and the optional fast-forward-only pull of the local default branch. `set-head` changes only the local symbolic ref.
- Never delete the default branch under any name, the branch checked out in the invoking worktree, or a user-designated keep.
- Never accept cached `origin/HEAD` without a successful refresh of the remote's HEAD advertisement in this run.
- Never guess the default branch from names such as `main` or `master`. If authoritative resolution fails, delete nothing.
- Never classify a non-ancestry branch as Merged unless a merged PR's `headRefOid` exactly equals the branch's current full tip OID.
- Never delete an Uncertain branch in `hands-off` mode or merely because the user typed `go`.
- Never delete a non-Merged branch until an unused recovery-ref name has been claimed atomically and verified at its exact tip.
- Never use `git worktree remove --force`, force helper cleanup, auto-stash, reset, clean, or any operation that can discard uncommitted work. If a worktree cannot be removed cleanly, keep its branch.
- Never treat a `[gone]` upstream, a branch name, or a merge-looking commit subject as sufficient proof by itself.
- Preserve the invoking checkout's branch or detached-HEAD state and all dirty state. Use `git -C <path>` and temporary linked worktrees rather than switching the invoking checkout.

## Procedure

### Step 1 — Parse guidance and capture local state

1. Record the invoking worktree's canonical path, current symbolic branch if any, HEAD OID, and `git status --porcelain=v1 --untracked-files=all` output. Detached HEAD is allowed; it means there is no current branch to protect in that worktree. Dirty state is also allowed and must remain untouched.
2. Parse `no-pull`, `hands-off`, explicit keeps, and any explicit requests to delete named branches. A vague cleanup request is not authorization to delete Uncertain branches.
3. Verify this is a Git repository and that an `origin` remote exists. If not, report the failure and delete nothing because the default branch cannot be resolved authoritatively.

Do not classify branches, inspect cached `origin/HEAD`, query PRs, or otherwise contact the remote before step 2's fetch.

### Step 2 — Refresh before resolving anything remote-derived

Run `git fetch --prune origin` as the run's first remote action. Record success or failure.

This both refreshes remote-tracking tips and removes stale ones. It must precede default-branch resolution because `git remote set-head origin --auto` can update `refs/remotes/origin/HEAD` only when the newly advertised default already has a local remote-tracking ref.

Do not perform a separate remote query first, even to discover the default branch. Do not classify against pre-fetch upstream state.

### Step 3 — Resolve the default branch authoritatively

Resolve the default branch by this exact order:

1. Run `git remote set-head origin --auto` and capture its exit status. This re-reads the remote's symbolic HEAD advertisement and writes only the local `refs/remotes/origin/HEAD` symbolic ref.
2. Only when `set-head` exited zero, read `git symbolic-ref --quiet refs/remotes/origin/HEAD`, require a target below `refs/remotes/origin/`, and verify that target resolves. Derive the default branch name from that target.
3. If `set-head` failed, could not run, or produced an invalid target, completely ignore any existing `origin/HEAD`, even if it still resolves. Query `gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'` instead. Validate the returned branch name with `git check-ref-format --branch` and use it as the authoritative protected name.
4. If the API supplied a name but neither `refs/remotes/origin/<name>` nor `refs/heads/<name>` resolves, make one read-only targeted fetch for that branch after the required initial fetch. If no commit ref can be obtained, stop without deleting.
5. If neither the refreshed advertisement nor the API resolves a default, stop and delete nothing. Report the failed commands and suggest checking connectivity/authentication, then running `git fetch --prune origin && git remote set-head origin --auto`.

A non-zero `set-head` is a hard boundary: never fall back to the cached symbolic ref. This covers the dangerous case where `origin/HEAD` still points to an old default while a restricted fetch refspec omitted the newly advertised default, causing `set-head --auto` to fail with `Not a valid ref` and leave the stale ref intact.

Protect any local branch whose full ref is `refs/heads/<default-name>`. The resolved default is never a deletion candidate, whether its name is `main`, `master`, `develop`, `trunk`, or anything else.

### Step 4 — Update the local default unless `no-pull`

Unless `no-pull` was supplied, update the local default with a fast-forward-only pull while preserving the invoking checkout:

- If the default branch is checked out in a clean worktree, run `git -C <that-path> pull --ff-only`.
- If it is checked out in a dirty worktree, report that dirty state blocks only the pull; do not stash, reset, or clean it.
- If it is not checked out and a local default branch exists, create a safely allocated temporary linked worktree for that branch, run `git -C <temporary-path> pull --ff-only`, then remove the clean temporary worktree without `--force`.
- If only `origin/<default>` exists, create the local tracking branch in the temporary worktree, pull it fast-forward-only, and retain the local default branch as a protected ref.
- If the pull, temporary-worktree creation, or cleanup fails, report it and continue only with the last resolvable local or freshly fetched default ref. Never rewrite a divergent local default and never let a failed update make the protected default eligible.

With `no-pull`, state that the comparison uses the current local default tip. The initial fetch remains mandatory.

Capture the exact full default comparison OID after this step. If no local or freshly fetched default commit resolves, stop without deleting.

### Step 5 — Inventory local branches and worktrees

Build one stable snapshot before classification:

- List every `refs/heads/*` ref with full tip OID, short tip OID, upstream ref, and upstream tracking state using `git for-each-ref`.
- Parse `git worktree list --porcelain` and map each checked-out `branch refs/heads/<name>` to its canonical worktree path. Record detached worktrees separately.
- Mark the invoking worktree's current branch, the default branch, and every user-designated keep as protected.
- Keep a branch checked out in another worktree eligible for classification only as annotated `worktree: <path>`; it cannot be deleted unless step 9 safely removes that linked worktree first.
- Never offer removal of the invoking/main checkout itself. Its current branch remains protected.

The post-fetch `[gone]` upstream state is useful evidence but never a bucket by itself.

### Step 6 — Classify with minimal effort

Use only the following cheap checks. Do not add patch-id analysis, tree-diff equivalence, reflog archaeology, or other squash-merge forensics.

Classify each non-protected branch into exactly one bucket, in this order.

#### Merged

A branch is Merged when either:

1. Its snapshotted tip is an ancestor of the exact default comparison OID: `git merge-base --is-ancestor <tip> <default-oid>` exits zero; or
2. A read-only lookup identifies a merged PR for this branch and that PR's non-empty full `headRefOid` equals the branch's snapshotted full tip OID byte-for-byte.

For branches not merged by ancestry, use bounded best effort:

- For otherwise-unclassified branches with an upstream, including `[gone]`, make at most one capped `gh pr list --state merged --head <branch> --json number,headRefName,headRefOid,mergedAt` read per branch. Cap the total branch lookups and batch them where the available interface supports it.
- Scan recent default-branch subjects once with a bounded `git log --format='%H%x09%s' <default-oid>` window for conventional PR-number references. Resolve only a capped set of those PR numbers with read-only `gh` metadata, batching when possible, and require both `state == MERGED`, the matching `headRefName`, and `headRefOid == <tip>`.
- Treat the subject scan only as a way to identify a PR. The subject, PR number, merged state, or head name never replaces the exact head-OID gate.
- If an identified historical PR has a missing OID or an OID different from the current tip, classify the branch as Uncertain immediately. Do not let another name-based signal or Transient heuristic override this. This is how a branch advanced after merge or a reused branch name remains safe.
- If `gh` is unavailable, unauthenticated, offline, capped, or returns incomplete data, retain ancestry-based Merged results and conservatively classify affected branches with the local Transient rules or as Uncertain. Never guess.

#### Transient

A branch is Transient only when its snapshotted tip is fully recoverable from refs guaranteed to remain after this run and one cheap topology check proves one of these cases:

- The tip is reachable from another protected or explicitly kept local branch.
- The tip is a local combination/test merge commit and every parent is reachable from the default or another ref guaranteed to remain. A parent preserved only by a squash-merged branch that will also be deleted is not enough.
- It is a recognizable disposable rebase-stack snapshot and its tip is reachable from a surviving `refs/pre-rebase/...`, protected branch, default ref, or other kept ref. A snapshot-like name alone is not enough.
- The tip is reachable from another local branch already committed to the kept set. Do not create circular proof where two branches slated for deletion are each other's only recovery source.

Record the exact surviving ref(s) that prove recoverability in the one-line reason. A backup ref will still be created before deleting every Transient branch.

#### Uncertain

Everything else is Uncertain: unique or unpushed commits, unclear provenance, a `[gone]` upstream without ancestry/PR proof, incomplete remote evidence, PR head-OID mismatch or absence, or transient-looking content without a surviving recovery source.

Spend no extra effort proving hypotheticals. Give each Uncertain branch one concise reason and leave it untouched unless the user explicitly names it for deletion in this run.

### Step 7 — Present one audit listing and confirm

Print a single scannable listing with bucket, branch, full or unambiguous short tip, worktree annotation when applicable, proposed action, and one-line reason. Also list protected branches separately so the resolved default, current branch, and user keeps are visibly excluded.

Example:

```text
Local branch cleanup against origin's default `develop` at a03ab1f:

  Merged     task/012       9a2f1c0  delete  tip is ancestor of develop
  Transient  combine/test   4e8dd11  delete  merge parents survive at keep/a and develop
  Uncertain  old-spike      7711a2b  keep    3 unique commits; upstream is [gone]
  Protected  develop        a03ab1f  keep    authoritative default branch
  Protected  feature/live   c133bbe  keep    current branch in invoking worktree

Non-Merged deletions will first be preserved under unused refs/pruned/<UTC-date>/... names.
`go` deletes only the proposed Merged and Transient rows. Name any rows to keep/skip, or explicitly name an Uncertain branch to delete.
```

In normal interactive mode, use Claude Code's native question mechanism to ask whether to proceed, keep/skip named branches, or give other instructions. Apply keep/skip changes, re-display the updated listing, and ask for final confirmation through the native question mechanism. If the user explicitly requests deletion of an Uncertain branch, mark that row `explicitly confirmed`, include it in the updated listing, and require final confirmation; it receives a recovery ref.

In `hands-off` mode, print the same listing for auditability and proceed immediately with only Merged and Transient rows. Invocation-time keeps still apply. Ignore any ambiguous delete guidance, and never include Uncertain rows.

### Step 8 — Revalidate tips and reserve recovery refs

Re-read every confirmed branch ref before any worktree removal or branch deletion. If a branch disappeared or its full tip OID differs from the inventory snapshot, drop it from the deletion set, move it to Uncertain with `tip changed during run`, and report it.

For every confirmed branch not in Merged, reserve a recovery ref before deleting any branch:

1. Start with `refs/pruned/<YYYYMMDD-UTC>/<branch>`, using one UTC date for the run.
2. Atomically claim the candidate only if it does not exist, using `git update-ref --stdin` with the `create <ref> <tip>` command. Do not use a blind `git update-ref <ref> <tip>` write: that can repoint an earlier run's breadcrumb.
3. If the base name is taken, try `refs/pruned/<date>/<branch>-<short-tip>`, then append `-2`, `-3`, and so on until a bounded number of valid unused candidates has been attempted. Existing refs are never overwritten or deleted.
4. After a successful create, resolve the new ref as a commit and require its full OID to equal the expected snapshotted tip.
5. If no name can be claimed or verification fails, drop that branch from the deletion set and report it. Continue best-effort for other branches.

Finish and verify reservation for all non-Merged deletions before removing any worktree or deleting any branch. Record the exact branch, tip, and recovery ref tuple for the final report.

### Step 9 — Handle linked worktrees without losing work

For each still-confirmed branch checked out in a linked worktree:

1. Re-read that worktree's branch and status. If it is detached, on another branch, missing, dirty, locked for an unclear reason, or has an in-progress operation, do not force anything; drop the branch from deletion and report it as Uncertain.
2. Prefer `wt-remove <slug>` when `wt-remove` is on PATH and the path is a helper-managed `.worktrees/$CONTAINER_NAME/<slug>` worktree. Invoke it from outside the target worktree. Its refusal to remove dirty work is authoritative.
3. Otherwise run `git worktree remove <path>` without `--force`.
4. If removal refuses or the path is the invoking/main checkout, keep the branch. Never follow up with a forced removal.

The skill must work outside powbox: `$CONTAINER_NAME`, `.worktrees`, `wt-bootstrap`, and `wt-remove` are opportunistic, never prerequisites.

### Step 10 — Delete locally with exact-tip checks

Immediately before each deletion, verify `refs/heads/<branch>` still equals the snapshotted tip. If it moved, keep it and report the race; an already-created recovery ref may remain as an extra breadcrumb.

Delete only the remaining confirmed local branches with `git branch -D -- <branch>`. Never run a remote-delete form and never push.

Record success or failure per branch. A failed deletion is non-fatal and must not lead to cleanup of its recovery ref.

### Step 11 — Report and restore orientation

Confirm that the invoking checkout still has its original branch or detached-HEAD orientation and untouched dirty-state entries. Do not attempt destructive restoration if another process changed it; report the difference instead. Remove only clean temporary worktrees created for the default-branch pull, without force; preserve and report any that cannot be removed safely.

Print:

- Fetch, default-resolution source, authoritative default name/OID, and pull or `no-pull` result.
- Every deleted branch with bucket and full tip SHA. Include the exact recovery ref for each Transient or explicitly confirmed Uncertain deletion.
- Every kept, skipped, changed, dirty-worktree, or failed branch with its reason.
- Every linked or temporary worktree removed or preserved.
- A clear statement that no remote refs or PRs were mutated.

For every deletion, show direct restoration from the reported SHA:

```sh
git branch <branch> <full-tip-sha>
```

For non-Merged deletions, also show how to inspect and restore through the exact backup ref:

```sh
git for-each-ref refs/pruned/<YYYYMMDD-UTC>/
git branch <branch> <exact-refs/pruned/...-ref>
```

Show cleanup only for the exact recovery refs created in this run, preferably with expected-old OIDs so a changed breadcrumb is not removed accidentally:

```sh
git update-ref -d <exact-recovery-ref> <preserved-full-tip-sha>
```

Explain that refs keep commits advertised indefinitely until those refs are dropped. A deleted Merged branch has no automatic backup ref, but its printed SHA and reflogs or `git fsck --lost-found` may recover otherwise unreferenced commits until Git garbage collection removes them.

## Checklist

- [ ] Invocation guidance and keeps parsed before listing.
- [ ] `git fetch --prune origin` was the first remote action.
- [ ] `set-head --auto` succeeded before `origin/HEAD` was trusted, or the API supplied the default; no name heuristic was used.
- [ ] Default branch protected and pulled by default unless `no-pull` or dirty/failed safely.
- [ ] Inventory includes OIDs, upstream state, and worktree paths.
- [ ] Every non-ancestry Merged result has an exact merged-PR `headRefOid == tip` proof.
- [ ] Transient proofs name refs that survive the run; Uncertain branches remain untouched unless explicitly named interactively.
- [ ] Audit listing printed; interactive confirmation or `hands-off` rules applied.
- [ ] All non-Merged recovery refs atomically claimed at unused names and verified before any removal/deletion.
- [ ] Tips rechecked; linked worktrees removed without force, preferring `wt-remove` where applicable.
- [ ] Only local branches deleted; every deleted tip and recovery breadcrumb reported.
- [ ] Invoking checkout orientation and dirty work preserved; remote remained untouched.
