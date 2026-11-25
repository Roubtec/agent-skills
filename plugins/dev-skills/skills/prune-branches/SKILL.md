---
name: prune-branches
description: Local branches have piled up after merged task batches and need cleaning out. Trigger when the user asks to prune branches, clean up local branches or the workspace, delete merged branches, remove post-batch branch scaffolding, or run prune-branches. Classifies before deleting and keeps backup refs for anything uncertain or recoverable. Not for remote branch cleanup or deleting branches on origin, for restacking (use rebase-stack), or for enabling worktrees (use enable-worktrees).
---

# Prune Branches

Clean up local post-batch branches conservatively, without mutating the remote or losing work.

**Arguments:** `[no-pull] [hands-off] [free-form keep/delete guidance]`

Explicit Claude Code invocation uses `/dev-skills:prune-branches`; natural-language equivalents are fine.

The mechanics live in `prune-branches.sh`, beside this file.
Run it by its absolute path, from the checkout the user invoked you in; `--help` prints its full contract.
You supply what it cannot: reading the user's guidance, the confirmation, and relaying its report.
Do not reproduce its steps by hand, and do not run any branch, ref, or worktree deletion of your own beside it.

## What the helper guarantees

- It never pushes, deletes a remote ref, edits a PR, force-removes a worktree, stashes, resets, or cleans.
- It fetches first, resolves origin's default branch authoritatively (never by name, never from a cached `origin/HEAD`), and stops without deleting when it cannot.
- It never deletes the default branch, the branch you are on, or a branch you told it to keep.
- It deletes a branch only at the exact tip it inventoried, and reserves a verified recovery ref under `refs/pruned/` before deleting anything that is not Merged.
- It removes a linked worktree only when that worktree is this container's own helper worktree or you passed its exact path; a dirty, locked, or mid-operation worktree keeps its branch.

## Buckets

- **Merged** — the tip is an ancestor of origin's default, or a merged PR into that default has exactly this tip as its head.
  Deleted without a backup ref.
- **Transient** — not merged, but the tip stays reachable from a ref that remains: a protected branch, a `refs/pre-rebase/**` ref, a branch this run keeps, or a merge commit whose parents all are.
  Deleted behind a recovery ref.
- **Uncertain** — everything else, and any branch not already in the default that heads an open PR, however reachable its tip and whatever a merged PR says of it.
  Kept unless the user names the branch for deletion in this run.
- **Protected** — the default, the current branch, the user's keeps, and any symbolic ref under `refs/heads/` (an alias, not a branch) with the branch it points at.

The listing also inventories recovery breadcrumbs earlier runs left under `refs/pruned/`: a **Redundant** one (landed in the default, at least 7 days old) is marked `sweep`; load-bearing, recent, changed, and unrecognized ones are kept.

## Procedure

1. **Read the guidance.**
   Take `no-pull` and `hands-off` leniently from the arguments.
   Treat all other text as guidance, especially branch names to keep and context such as "there is stashed work on X".
   A vague cleanup request is not authorization to delete an Uncertain branch; only an unambiguous instruction naming the branch is.
2. **Plan.**
   Run `prune-branches.sh plan [--no-pull] [--keep <branch>]...`, one `--keep` per branch the user wants kept.
   It prints the audit listing and ends with `plan: <path>`.
   If it exits non-zero it has stopped before classifying; relay its message and stop.
3. **Show the listing and confirm.**
   Show the listing as printed.
   Ask through `AskUserQuestion` whether to proceed, keep or skip named branches, or give other instructions.
   Selecting Proceed covers only the rows marked `delete` and the breadcrumb rows marked `sweep`.
   Each of these needs the user to say so explicitly, and becomes a flag on `apply`:
   - keeping a proposed row: `--keep <branch>`;
   - deleting an Uncertain branch: `--delete-uncertain <branch>`;
   - deleting a branch whose row says its worktree needs approval: `--approve-worktree <branch> <path>`, with the exact path the row shows, and only when the user named that path or branch;
   - leaving breadcrumbs alone: `--no-sweep`, or `--keep-breadcrumb <ref>` for one.
   When the user changed anything, run `prune-branches.sh apply --plan <path> --dry-run` with those flags, show the updated listing, and ask for final confirmation through `AskUserQuestion`.
4. **Apply.**
   Run `prune-branches.sh apply --plan <path>` with the confirmed flags.
   In `hands-off` mode skip step 3's confirmation, still print the listing, and run `apply --plan <path> --hands-off` with only `--keep` flags: it deletes Merged and Transient rows, never an Uncertain branch, never a worktree this container does not own, and sweeps no breadcrumb.
   A plan is refused once it is an hour old or origin's default has moved; plan again rather than working around it.
5. **Relay the report.**
   Give the user the report as printed: what was deleted and kept and why, the recovery refs, the breadcrumb outcomes, and the restore and cleanup commands.
   Do not rewrite those commands; they are quoted for pasting.
   If the report notes that the invoking checkout differs from when the plan was made, say so and restore nothing.

The helper works outside powbox: `gh`, `$CONTAINER_NAME`, and `wt-remove` are used when present and never required.
Without `gh`, or when it cannot confirm origin's repository, only ancestry proves a merge, so squash-merged branches show as Uncertain.
