# Conflict handling

This file is part of the `rebase-stack` skill, and is its `SKILL.md` → "Step 5 — Conflict handling"; the step numbers and section names it uses are that file's, beside it.
It is read in full the first time a `git rebase` of a run stops on a conflict — in a delegated unattended run as much as an interactive one, since there nobody can be asked what it says — and by no run whose rebases are all clean.
The `review-cycle` skill's `rebase-brief.md` sends its rebaser here as well, for items 1–3 below; everything else in this file is a `rebase-stack` run's own.

**Why a branch can conflict on a commit nobody changed: patch-id cascades.**
If the previous branch's rebase had to *resolve* a conflict, the resolved commit's patch-id no longer matches the original still present in the descendant's history, so git will not auto-skip it and replaying it conflicts.
The right move in that case is **`git rebase --skip`** for that single commit, under the "patch already represented in HEAD" rule of item 2.

**Combined-replay exception:** where the rebase that stopped is Step 4's combined replay, **Inside a combined replay** below governs wherever items 4–5 would abort and stop in delegated unattended mode or leave an interactive rebase in progress.

1. **Inspect the conflict.**
   Read the conflicting files, the offending commit (`git show REBASE_HEAD`), and the recent history of the affected hunks.
   Resolve conflicts hunk by hunk in place, preserving cleanly auto-merged changes elsewhere in each file.
   Whole-file `git checkout --ours` or `--theirs` is safe only after inspecting the merged result and verifying that the file contains no cleanly auto-merged content from the other side; otherwise it can silently delete a sibling's already-shipped behavior with no conflict marker left behind.
2. **Classify.**
   A conflict is **trivial** if any of:
   - It's a pure import-ordering or formatting collision.
   - One side is an addition only and the other side is empty.
   - It's a whitespace-only difference.
   - The resolution is clearly traceable to a fix already applied earlier in this same rebase run (i.e., the same hunk's resolution was just chosen on a predecessor branch).
   - **Patch already represented in HEAD.**
     The incoming commit's content is *already on HEAD* — either literally (a true duplicate that patch-id should have skipped but didn't, because a predecessor's rebase mutated the patch-id — the cascade above) or as a strict superset (HEAD has the same content plus refinements introduced by review-feedback fixups or by predecessor conflict resolutions).
     The resolution is `git rebase --skip`, **not** an in-file edit; the recognition recipe below decides it.

     **Recognition recipe (concrete)**: (a) every new file `REBASE_HEAD` adds (`A` lines in `git show --name-status REBASE_HEAD`) already exists on HEAD; AND (b) for every modified file, every hunk's *post-image* (the `+` lines) is already present at the corresponding location on HEAD (literally or refined by a later commit).
     If both hold, `--skip`.
     If (b) holds only partially, this is **not** the patch-already-represented case — fall through to non-trivial.

   Otherwise it is **non-trivial**.
3. **Trivial — resolve.**
   Two paths depending on the trivial subtype:
   - **In-file resolution** (import collisions, whitespace, predecessor-traceable): apply the merge, `git add` the resolved files, `git rebase --continue`.
     Mention briefly in the running narration ("resolved trivial conflict in `<file>`: kept both imports") so the user can scan after the fact, but don't pause.
   - **Patch already represented in HEAD**: run `git rebase --skip` (do *not* edit files).
     Narrate one line: "skipped redundant commit `<short-sha>` — content already on rebased base".
     Do not `git add` or `git rebase --continue` for this subtype; `--skip` advances the rebase by itself.
4. **Non-trivial → stop unattended, otherwise propose and confirm.**
   In delegated unattended mode outside a combined replay, record the conflicting files, offending commit, and why it is non-trivial; then run `git rebase --abort`, report the branch as the stop point, and return without touching subsequent branches.
   The current disposable branch is restored to its pre-rebase tip; then apply the delegated-mode clean-stop (`git clean -fd`, empty `git status --porcelain`) before returning.
   In normal interactive mode, present the conflict, the proposed resolution (with reasoning, including any traceable precedent), and ask the user to confirm before applying.
   On user "go": apply, `git add`, `git rebase --continue` (or `git rebase --skip` if the proposed resolution is "skip this commit").
   On user "no": use the combined-replay exception when it applies; otherwise stop the skill (see Step 7).
5. **Normal interactive mode only: if the agent cannot determine a confident resolution at all** — e.g., the conflict involves intent that isn't apparent from the code or history — **stop the skill without aborting the rebase**.
   Leave the rebase in progress (working tree contains conflict markers and `git rev-parse --git-path rebase-merge` points to the active state).
   Tell the user clearly:
   - Which branch is mid-rebase (`<X>`).
   - Where the pre-rebase ref is saved.
   - That the user can finish the rebase manually with `git rebase --continue` after resolving, or `git rebase --abort` to roll back to the pre-rebase ref.
   - That subsequent branches in the chain have not been touched.
   - That re-invoking the skill from the source branch (or any later branch) will produce a fresh, smaller chain detection on top of whatever state the user leaves things in.

   Do **not** run `git rebase --abort` automatically.
   The user may want to inspect the in-progress state.

## Inside a combined replay

**Attribute each conflicted commit to a run branch.**
It belongs to `<first>` when it lies in `<fork>..<first-original-tip>` — `<fork>` being the `fork=` that `qualify` printed, and an original tip the commit its snapshot ref holds — or to the later branch `Y` whose original interval is `<previous-original-tip>..<Y-original-tip>`.
Trivial conflicts and accepted resolutions continue within the combined replay.
A non-trivial conflict that the agent cannot resolve confidently, or whose proposed resolution the user rejects, is the explicit exception to the normal interactive stop-in-place rule of items 4–5: record it, abort the combined replay, restore the entire run as Step 4 says, and start the per-branch loop for the whole run from the same `<segment-base>`.
If that loop reaches the same conflict, do not ask the user to reconsider the same rejected or indeterminate resolution: in normal interactive mode leave that branch's per-branch rebase in progress for inspection; in delegated unattended mode abort and restore that current disposable branch, clean it, and stop.

**Validation stays branch-gated.**
After a successful single replay and its `verify`, apply Step 6 separately to every run branch attributed at least one in-file conflict, checking out each such branch to validate it; clean and `--skip`-only branch intervals still skip validation.
Do not make a repair commit on an intermediate run ref while its descendants already point past it.
On the first failure, inspect enough to decide whether a focused repair is clear.
If it is, restore the entire run and process it with the per-branch loop from the same `<segment-base>` so Step 6 applies the repair at the correct branch boundary and later branches inherit it; from that point Step 6 governs, including stopping at that branch if the attempted repair fails.
If no confident repair is apparent, restore the entire run and stop immediately without starting the fallback or touching later branches; delegated unattended mode also performs its clean-stop.
This is the fast-path exception to Step 6 and Step 7's usual rebased-but-failing interactive state.
Finish a successful run with `<last-branch>` checked out.
