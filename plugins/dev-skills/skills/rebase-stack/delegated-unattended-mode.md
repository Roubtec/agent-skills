# Delegated unattended mode

This file is part of the `rebase-stack` skill; its step numbers and section names are that skill's `SKILL.md`, beside it.
It is read in full, before Step 1, by a run another skill invoked with all three guarantees `SKILL.md` names — an explicit chain, explicit authorization to execute, and the statement that every chain branch is a disposable snapshot — and by no other run.

In this mode:

- Validate and print the proposed chain for the record, but treat the parent prompt as confirmation and do not wait for another `go`.
- Never re-derive, reorder, or drop branches from the chain, and never push or fetch.
  (This bars dropping a *chain branch*; the `git rebase --skip` used for the "patch already represented in HEAD" trivial subtype is still expected.)
- A rebase that stops on a conflict sends this run to `conflict-handling.md`, beside this file, as it does any other: read it in full then, since nobody can be asked what it says, and resolve trivial conflicts as it describes.
- On the first non-trivial conflict outside a combined replay, abort the current rebase and stop; during a combined replay, abort and restore the whole run, then use the per-branch fallback to establish and stop at the actual branch boundary.
  Do not leave conflict markers or an in-progress rebase for the parent agent.
- If conflict resolution completes but validation cannot be repaired confidently, restore the whole run after a combined replay or reset the current disposable branch after a per-branch replay, then stop as Step 6 and `conflict-handling.md` prescribe.
- Before returning, run `git clean -fd` to remove untracked leftovers (`git rebase --abort` and `git reset --hard` restore tracked files but leave `.orig`/build outputs) and confirm `git status --porcelain` is empty, so the parent can `git worktree remove` without `--force`.
- **What these commands may reach.**
  Every `git reset --hard` and `git clean -fd` this mode runs — the restore after a stop, the pre-return clean, and the clean-stop that follows a restore — is scoped to the disposable chain branch currently being processed (the caller's guide branch) and to the worktree this invocation was pointed at: never a canonical task branch, never a remote ref, never a sibling worktree.
  The combined replay and combined-run restore are the only multi-ref writers: `stack.sh qualify` gates the replay to exactly the disposable run branches, and the guarded transaction of `stack.sh restore` reaches exactly those branches and their saved snapshot OIDs — never a canonical branch, remote ref, skipped branch, or branch outside that run.
  `git clean -fd` is bounded to the tree it runs in; ref-moving commands are not — a worktree isolates the working tree, not the repository, so a `reset --hard` on the wrong branch or an incorrectly scoped ref transaction reaches every sibling worktree through the shared `.git`.
