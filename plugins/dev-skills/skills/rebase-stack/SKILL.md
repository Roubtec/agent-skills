---
name: rebase-stack
description: Replay a chain of dependent local branches onto a target (typically main) after some predecessors have been merged, using one replay for verified linear runs and a branch-at-a-time fallback, dropping commits already present on the target and resolving conflicts with awareness of the chain's history. Trigger when the user asks to rebase a stack of stacked-PR branches, move a chain forward onto main after merges, or restack feature branches. Do not trigger for single-branch rebases.
---

Rebase a chain of stacked local branches onto a target branch.

**Arguments:** `[<source-branch>] [onto <target-branch>]`

This skill is built for the "stacked PRs" workflow where each feature branch was originally based on its predecessor.
After predecessors get merged into the target branch (typically `main`), the remaining branches need to be rebased so their unique commits land on top of the new target tip — and so each subsequent branch in the chain ends up cleanly stacked on the freshly rebased one above it.

It uses one deliberate replay for a verified linear run and otherwise works one branch at a time, with explicit user confirmation up front and intelligent conflict resolution along the way.

## When to use this

Typical scenario: you produced a chain of branches `feature/01 → feature/02 → ... → feature/N` (e.g. via the `address-tasks` skill), each PR'd into the previous.
After PR review, branches accumulate "fixes" commits.
After `feature/01` and `feature/02` are merged into `main`, the remaining branches still share an old common ancestor with `main` and contain commits that are now duplicated in `main` (with different hashes but identical patches).
Use this skill from the topmost branch (or pass it explicitly) to bring the entire remaining stack forward, branch by branch, onto the new `main` tip.

It also handles "leafy" stacks — branches in the middle that have grown their own fix commits not yet present in their descendants.
The per-branch fallback naturally re-stacks them flatly: each rebased branch becomes the base for the next.

## Assumptions

- The team **rebases-and-merges** PRs rather than squashing.
  Git's default patch-id detection during rebase will drop commits already present in the new base, which is exactly what we rely on.
  This skill does not implement squash-aware heuristics.
- Auto-detected branches were created sequentially, each from the tip of its predecessor at branch-creation time.
  An explicit chain may instead contain independent disposable snapshots; each branch is still replayed onto the freshly rebased predecessor in the supplied order.
- The user is responsible for fetch/pull hygiene.
  This skill **does not run `git fetch`** and **does not pull**.
  It uses local refs only, so the user has complete control over which commits come into play.

## Invocation forms

All forms route through the same logic.
Be lenient about parsing: trust the agent to extract source, target, and (optionally) explicit chain, then rely on the confirmation listing as the safety net.

| Form | Meaning |
|---|---|
| `/dev-skills:rebase-stack` | Current branch onto `main`; chain auto-detected |
| `/dev-skills:rebase-stack onto <target>` | Current branch onto `<target>`; chain auto-detected |
| `/dev-skills:rebase-stack <source>` | `<source>` onto `main`; chain auto-detected |
| `/dev-skills:rebase-stack <source> onto <target>` | `<source>` onto `<target>`; chain auto-detected |
| `/dev-skills:rebase-stack <source> -> <target>` | Same; arrow tolerated |
| `/dev-skills:rebase-stack <source> → <target>` | Same; unicode arrow tolerated |
| `/dev-skills:rebase-stack chain <b1> <b2> ... <bN> onto <target>` | Explicit chain in stacking order; the last branch is the source; auto-detection is skipped entirely |
| `/dev-skills:rebase-stack chain <b1> -> <b2> -> ... -> <bN>` | Same with arrows; `onto <target>` defaults to `main` if omitted |

Quoting is optional; branch names with spaces should use quotes.
If `main` doesn't exist, fall back to `master`.
If neither exists, ask the user for the target branch.

**When to use the explicit `chain` form**: if auto-detection comes back empty or wrong (most often after a chain branch was merged via rebase-and-merge — see "Detection corner cases" below), the explicit form is the simple, robust answer.
You list the branches in stacking order, the skill rebases each onto the previous one's new tip, and the patch-id-aware first step still drops commits already on the target.

### Delegated unattended mode

Another skill may invoke `rebase-stack` without an interactive user only when its prompt supplies an explicit chain, explicitly authorizes execution, and states that every chain branch is a disposable snapshot.
In that mode:

- Validate and print the proposed chain for the record, but treat the parent prompt as confirmation and do not wait for another `go`.
- Never re-derive, reorder, or drop branches from the chain, and never push or fetch. (This bars dropping a *chain branch*; the `git rebase --skip` used for the "patch already represented in HEAD" trivial subtype is still expected.)
- Resolve trivial conflicts as usual.
- On the first non-trivial conflict outside a combined replay, abort the current rebase and stop; during a combined replay, abort and restore the whole run, then use the per-branch fallback to establish and stop at the actual branch boundary. Do not leave conflict markers or an in-progress rebase for the parent agent.
- If conflict resolution completes but validation cannot be repaired confidently, restore the whole run after a combined replay or reset the current disposable branch after a per-branch replay, then stop as Steps 4 and 6 prescribe.
- Before returning, run `git clean -fd` to remove untracked leftovers (`git rebase --abort` and `git reset --hard` restore tracked files but leave `.orig`/build outputs) and confirm `git status --porcelain` is empty, so the parent can `git worktree remove` without `--force`.
- **What these commands may reach.** Every `git reset --hard` and `git clean -fd` this mode runs — the restore after a stop, the pre-return clean, and the clean-stop that follows a restore — is scoped to the disposable chain branch currently being processed (the caller's guide branch) and to the worktree this invocation was pointed at: never a canonical task branch, never a remote ref, never a sibling worktree. `git clean -fd` is bounded to the tree it runs in; the ref-moving half is not — a worktree isolates the working tree, not the repository, so a `reset --hard` on the wrong branch reaches every sibling worktree through the shared `.git`.

Do not infer this mode merely because the caller is a subagent.
Without all three guarantees — explicit chain, explicit authorization, and disposable branches — use the normal interactive confirmation and stopping behavior.

## What the skill does NOT do

- It does not push to origin. Pushing remains a manual step the user controls.
- It does not fetch from origin. Local refs are the source of truth.
- It does not delete branches, including chain branches that end up with no unique commits after rebase. Empty branches are reported in the final summary for the user to handle.
- It does not modify the target branch. The target ref is read-only throughout.
- It does not skip branches the user marks as "skip" during confirmation. Those branches are left entirely untouched.

## Procedure

### Step 1 — Preflight

1. **Working tree must be clean.**
   Run `git status --porcelain`.
   If anything is staged or modified, or any untracked file would be overwritten by a checkout (a `git checkout` or `git rebase` to another branch in the chain would fail), abort with a clear message asking the user to commit, stash, or clean.
   Do not auto-stash.
2. **Resolve target.**
   Default target is `main` (fall back to `master` if `main` is absent).
   Verify the local target ref exists.
3. **Resolve source.**
   Default source is the currently checked-out branch.
   If the user specified a source, locate it; the source need not be checked out yet — the skill will check out branches as it goes.
4. **Check no rebase is already in progress.**
   Use `git rev-parse --git-path rebase-merge` and `git rev-parse --git-path rebase-apply`, which work in both the main checkout and linked worktrees.
   If either path exists, abort with a message asking the user to finish or abort the in-progress rebase first.

### Step 2 — Detect the chain

If the user supplied an explicit `chain` form (see Invocation forms), skip detection entirely and use the provided list as-is — the last branch is the source, the rest are chain branches in stacking order.

Otherwise, auto-detect:

#### 2a. Compute the **effective frontier** `EF` between source and target

The naïve "merge-base of source with target" is wrong whenever target has grown via rebase-and-merge: `git merge-base` only sees SHA-equality, so a chain branch's commits that **already landed on target with rewritten SHAs** look like part of source's unique history.
Patch-id detection is what fixes this — and `git rebase` already uses it internally to drop redundant commits.

Compute `EF` as the latest commit on source's history that is patch-equivalent to a commit reachable from target:

```sh
# Walk source's commits past the strict merge-base, marked + (unique) or = (patch-equiv on target).
git rev-list --right-only --cherry-mark --no-merges <target>...<source>
```

The newest `=`-marked commit is `EF` (which is the **first** `=` line in the output, since `git rev-list` emits commits newest-first).
If there are none, fall back to `EF = git merge-base <source> <target>` (the strict merge-base — same as `git rebase`'s default base in that case).

This single rule handles the otherwise-awkward geometries without special cases: the steady-state stack (`EF` ≈ `target`), the ancient fork (`EF` advances to source's last commit patch-equivalent to anything on target, exposing the abandoned line's branches as candidates), and the just-merged chain branch (`EF` advances past source's copy of its tip; see also "Detection corner cases").

#### 2b. Identify chain candidates

For each local branch `X` (excluding `source` and `target`):

```
mb = git merge-base X <source>
```

Include `X` as a chain candidate if all of these hold:
- `mb` is a descendant of `EF`: `git merge-base --is-ancestor <EF> mb` (and `mb != EF`)
- `mb` is an ancestor of `<source>`: `git merge-base --is-ancestor mb <source>`
- `X != <target>` and `X != <source>`
- **`X` has at least one unique commit past `<source>`**: `git rev-list --count <source>..<X>` is greater than zero. All-ancestor tips are usually "snapshot" refs left behind from a prior workflow stage; excluding them keeps such refs out of the chain, at the cost of also skipping a real chain branch that has no commits of its own — to carry those refs along too, use the explicit `chain` form (which bypasses this filter — that list is authoritative) or a deliberate manual `git rebase --update-refs --no-rebase-merges` after applying the same exact-ref and worktree checks as Step 4.

This is **heuristic, not metadata** — pure git topology with patch-id awareness.
It correctly catches "leafy" branches whose tip has diverged from their descendants (e.g., `feature/03` with a `fixes 03` commit that `feature/04` doesn't have), because the merge-base of any such leafy branch with the source still lies on the chain spine.
It can also catch unrelated branches that happen to share a merge-base on the spine (e.g., `login-tests` accidentally branched from `feature/03`).
The confirmation listing is how the user filters those out.

Order candidates by `git rev-list --count <EF>..<mb>` ascending — closest to the effective frontier comes first.

The full ordered chain to be rebased is `[chain_branch_1, chain_branch_2, ..., chain_branch_M, source]`.

#### 2c. Detection corner cases

- **Detection finds nothing**: surface this clearly, show `EF` and any nearby branches that *almost* qualified, and offer two paths: re-run with the explicit `chain` form, or proceed with just the source. Don't silently treat "empty chain" as "rebase the source alone" — confirm.
- **Source is a checkpoint, not a tip**: if `source` is itself an ancestor of some other local branch, the user probably meant that other branch as the source. Note this in the confirmation listing as a `[!]` flag.
- **A chain branch was just merged into target**: that branch's tip will be patch-equivalent to a commit on target, so `EF` advances past it — its merge-base with source is at-or-before `EF` and it's correctly excluded. Detection moves on to the next branch in the stack.

### Step 3 — Present the confirmation listing

Output a clear, scannable listing.
Include for each branch in the proposed chain:

- Branch name.
- Short SHA of its tip and tip subject line.
- Count of commits unique to this branch versus the next-up candidate (or versus the source for the topmost). Use this to highlight likely fix commits — small numbers are normal; large numbers on a branch with a name like `login-tests` are a red flag.
- For any branch that looks suspicious (e.g., an outlier in commit count or whose name doesn't fit the apparent chain pattern), flag it with `[!]` and a one-line reason.

Also report **target divergence info** as a non-blocking courtesy:
- Local target SHA.
- Cached `origin/<target>` SHA (read from local cache; do not fetch).
- Approximate time since last fetch (from the cached ref's mtime, if available).
- Whether they differ.

Do **not** block on divergence.
The user may pull manually while the confirmation prompt is open; on "go" the skill re-reads the local target ref.

Example listing:

```
The following branches will be rebased on top of `main` (a03ab1f), in order:

  feature/03   1 commit  ahead of feature/04   tip: 0b34e10  fixes 03
  feature/04   1 commit  ahead of feature/05   tip: 9a2f1c0  fixes 04
  feature/05   0 commits ahead of feature/06   tip: 4e8dd11  feature/05 last commit
  feature/06   0 commits ahead of feature/07   tip: 7711a2b  feature/06 last commit
  feature/07   0 commits ahead of source       tip: c133bbe  feature/07 last commit  (current branch, source)

[!] login-tests  47 commits ahead of feature/03  tip: 88f9011  test login UI
                 Merge-base lies on the chain spine but commit count and name suggest unrelated work.

effective frontier (EF):  d4f12a8  01-12 example-feature   (3 source commits patch-equivalent to main)
local main:               a03ab1f
cached origin/main:       a02ee02  (1 commit behind local main, last fetched 4h ago)

Pre-rebase refs will be saved at refs/pre-rebase/<branch>/<timestamp> so you can recover any branch if needed.

Conflicts: trivial resolutions will be applied silently; non-trivial ones will be confirmed with you before continuing.
Validation (build/test) will run only after a branch had conflicts to resolve. Clean rebases skip validation.

Confirm with `go` to proceed, or list branches to skip, or supply an explicit chain like `chain b1 -> b2 -> b3`.
```

In normal interactive mode, wait for the user's reply.
In delegated unattended mode, print the same listing for auditability and proceed immediately; the explicit parent prompt is the confirmation.

If the user provides branches to skip, remove them from the chain and re-display the updated listing for a final confirmation.
Skipped branches are **left entirely untouched** — they stay on their current commits, are not rebased, are not modified.

### Step 4 — Linear-run fast path and per-branch rebase loop

After the chain is confirmed and any skipped branches have been removed, freeze every confirmed branch's original tip and divide the chain at every consecutive pair `X → Y` for which `git merge-base --is-ancestor <X-original-tip> <Y-original-tip>` fails.
Each maximal resulting sequence of at least two branches is a candidate run; single branches use the per-branch loop.
For a candidate run `<first> ... <last>`, `<new-base>` is the target for the first run or the freshly rebased predecessor for a later run.
Derive its replay boundary with `git merge-base --all <new-base> <last-original-tip>` and qualify the run only if that command returns exactly one commit distinct from `<new-base>`; call it `<fork>`. A run whose fork already is the new base needs no combined replay and uses the per-branch loop, whose iterations safely no-op as appropriate.
The replay command below passes `<new-base>` as its upstream and `--no-fork-point`, so Git selects the single line after this ordinary merge-base and performs patch-equivalence dropping against `<new-base>`, just as the first iteration of the branch-at-a-time loop does.
Do **not** spell this as `--onto <new-base> <fork>`: that makes `<fork>` the upstream used for cherry-pick dropping, so commits already represented on `<new-base>` can be replayed instead of dropped.
If a unique `<fork>` or the exact replay range cannot be proved by the checks below, use the per-branch loop; never guess a boundary.

Use the linear-run fast path only when **all** of these checks pass:

- Every run branch's original tip lies in `<fork>..<last-original-tip>` on the one ancestry line from `<fork>` through `<last-original-tip>`, in confirmed-chain order. The consecutive ancestry checks establish tip contiguity; also require `git rev-list --merges <fork>..<last-original-tip>` to be empty and require the OID sets from `git rev-list <fork>..<last-original-tip>` and `git rev-list --ancestry-path <fork>..<last-original-tip>` to be identical, so no branch can carry a merge or commits off that line.
- Enumerate that same replay range with `git rev-list <fork>..<last-original-tip>`, then enumerate every local branch with `git for-each-ref --format='%(refname) %(objectname)' refs/heads/`. The local branches whose exact tip OIDs occur in that replay set must be **exactly** the run's branches: no omitted or skipped chain branch and no unrelated local branch may point into it. This exact-set check matters because `--update-refs` moves every un-checked-out local branch pointing at a replayed commit.
- Prove that Git will actually replay every intermediate branch tip. Enumerate the right side with `git rev-list --right-only --cherry-mark --no-merges <new-base>...<last-original-tip>` and require every run tip except `<last-original-tip>` to appear as `+<full-tip-OID>`; a `=<tip-OID>` is patch-equivalent to `<new-base>` and disqualifies the whole run. The exact-tip check above is not enough: `--update-refs` does not move an intermediate ref whose tip Git omits as a clean cherry, so that ref would otherwise remain on the old line.
- No run branch is checked out in any worktree. If this worktree currently has a run branch checked out, first detach it at `<new-base>` with `git checkout --detach <new-base>`, then inspect all `branch` entries from `git worktree list --porcelain`; if any run branch remains checked out, fall back. This avoids `--update-refs` silently skipping that ref and leaving a partially restacked run, while the per-branch loop's checkout would fail loudly.

Any failed condition disqualifies the whole candidate run; process its branches with the per-branch loop below.
In particular, a divergent leaf, or any later branch that does not belong to another independently qualifying contiguous run, remains branch-at-a-time.
The fast path is permitted only when the refs the replay can move are exactly the run's own branch refs.

Whenever the instructions below say to restore an entire run, first detach this worktree, verify each snapshot still resolves to its frozen original tip, and record every run branch's current OID. Restore all run branches in one `git update-ref --stdin` transaction: `start`, one `update refs/heads/<X> <snapshot-OID> <recorded-current-OID>` line per branch, `prepare`, then `commit`. The old-OID guards and transaction make the restore all-or-nothing; verify every run branch equals its snapshot afterwards. If a current OID changed before the restore or the transaction fails, stop and report the concurrent or unexpected ref movement; do not start the fallback from a state that was not restored exactly.

For a qualifying run:

1. **Save every pre-rebase ref before replaying anything.** For each branch `X` in the run, run `git update-ref refs/pre-rebase/<X>/<timestamp> <X>`, using the `YYYYMMDD-HHMMSS` timestamp captured once at the start of the whole stack run. These snapshots receive the same inspection and run-scoped cleanup treatment as the per-branch snapshots below.
2. **Replay once from the last branch.** Run `git rebase --update-refs --no-rebase-merges --no-fork-point <new-base> <last-branch>`. Both behavior axes are deliberate: `--update-refs` is the verified ref movement this fast path exists to perform, and `--no-rebase-merges` preserves the skill's flat replay instead of inheriting `rebase.rebaseMerges=true`. Explicit `--no-fork-point` keeps the selection boundary equal to the verified `<fork>`. The one replay moves every intermediate run ref to the same commit the per-branch loop would produce without repeatedly replaying shared commits.
3. **Verify exact ref movement and topology before accepting the run.** Re-enumerate all local branch tips and require the set whose OIDs changed from the frozen pre-replay enumeration to be exactly the run's branches. Require every run branch's new tip to differ from its snapshot, descend from `<new-base>`, and be an ancestor of the next run branch's new tip. Command success alone is not sufficient: these are the ref and topology postconditions that prove every intermediate boundary moved onto the new line. If only run refs changed but any run postcondition fails, restore the entire run and use the per-branch loop; this catches an intermediate tip unexpectedly omitted despite the clean-cherry precheck. If any outside branch changed, stop and report it rather than hiding out-of-scope movement with a fallback.
4. **Handle conflicts under Step 5.** Attribute a conflicted commit to `<first>` when it lies in `<fork>..<first-original-tip>`, or to the later branch `Y` whose original interval is `<previous-original-tip>..<Y-original-tip>`. Trivial conflicts and accepted resolutions continue within the combined replay. A non-trivial conflict that the agent cannot resolve confidently, or whose proposed resolution the user rejects, is the explicit exception to Step 5's normal interactive stop-in-place rule: record it, abort the combined replay, restore the entire run, and start the per-branch loop for the whole run. If that loop reaches the same conflict, do not ask the user to reconsider the same rejected or indeterminate resolution: in normal interactive mode leave that branch's per-branch rebase in progress for inspection; in delegated unattended mode abort and restore that current disposable branch, clean it, and stop. This establishes the correct branch boundary without ever leaving the multi-ref replay half-finished.
5. **Keep validation branch-gated.** After a successful single replay and its postcondition check, apply Step 6 separately to every run branch attributed at least one in-file conflict, checking out each such branch to validate it; clean and `--skip`-only branch intervals still skip validation. Do not make a repair commit on an intermediate run ref while its descendants already point past it. On the first failure, inspect enough to decide whether a focused repair is clear. If it is, restore the entire run and process it with the per-branch loop so Step 6 applies the repair at the correct branch boundary and later branches inherit it; from that point Step 6 governs, including stopping at that branch if the attempted repair fails. If no confident repair is apparent, restore the entire run and stop immediately without starting the fallback or touching later branches; delegated unattended mode also performs its clean-stop. This is the fast-path exception to Step 6 and Step 7's usual rebased-but-failing interactive state. Finish a successful run with `<last-branch>` checked out.

For every branch `X` not processed by the fast path, use this loop in confirmed-chain order. Use `<target>` as `<new-base>` only when `X` is the first branch of the entire confirmed chain; otherwise use the freshly rebased immediately preceding confirmed branch, including when that predecessor is the last branch of a fast-path run:

1. **Save pre-rebase ref.**
   `git update-ref refs/pre-rebase/<X>/<timestamp> <X>` where `<timestamp>` is `YYYYMMDD-HHMMSS`, **captured once at the start of the run** so every ref this run creates shares the same timestamp.
   This is the safety net.
   These refs are not deleted automatically; document the cleanup pattern in the final summary — scoped to **this run's** refs (the shared timestamp, or the exact list saved), never the whole `refs/pre-rebase/` namespace.
2. **Checkout.**
   `git checkout <X>`.
3. **Rebase.**
   `git rebase --no-update-refs --no-rebase-merges <new-base>`.
   Git's default patch-id detection drops commits already in the new base.
   The flags state both behavior axes instead of inheriting configuration: `rebase.updateRefs=true` would move later chain branches before their own iterations, defeating this loop's per-branch conflict handling, validation, and snapshots, while `rebase.rebaseMerges=true` would reshape the replay instead of preserving the skill's flat topology.

   **Important caveat — patch-id cascades.** If the previous branch's rebase had to *resolve* a conflict (Step 5), that resolution mutated the resulting commit's content, so its patch-id no longer matches the original commit on the descendant's branch. When the descendant's rebase replays that same commit (still present in its history under the original SHA), git **will not** auto-skip it — it sees a different patch-id and tries to apply it as a new commit, which conflicts because the new base already represents the content (just with a different surface).

   The right move in that case is **`git rebase --skip`** for that single commit: HEAD already represents its content (sometimes literally the same, sometimes refined). See Step 5's "patch already represented in HEAD" rule.
4. **Conflict handling** — see Step 5.
5. **Validation** — see Step 6.
6. **Move on** to the next branch.

After the last branch in the chain, the source branch is checked out at its rebased tip.

### Step 5 — Conflict handling

When `git rebase` halts on a conflict:

**Combined-replay exception:** while the linear-run fast path is active, use Step 4.4 wherever the rules below would normally abort and stop in delegated unattended mode or leave an interactive rebase in progress.
The combined replay must first be aborted and every run ref restored, then the per-branch fallback establishes the real stop branch; Step 5's normal stop-in-place behavior applies only after that fallback reaches the rejected or indeterminate conflict.

1. **Inspect the conflict.**
   Read the conflicting files, the offending commit (`git show REBASE_HEAD`), and the recent history of the affected hunks.
   Resolve conflicts hunk by hunk in place, preserving cleanly auto-merged changes elsewhere in each file. Whole-file `git checkout --ours` or `--theirs` is safe only after inspecting the merged result and verifying that the file contains no cleanly auto-merged content from the other side; otherwise it can silently delete a sibling's already-shipped behavior with no conflict marker left behind.
2. **Classify.**
   A conflict is **trivial** if any of:
   - It's a pure import-ordering or formatting collision.
   - One side is an addition only and the other side is empty.
   - It's a whitespace-only difference.
   - The resolution is clearly traceable to a fix already applied earlier in this same rebase run (i.e., the same hunk's resolution was just chosen on a predecessor branch).
   - **Patch already represented in HEAD.** The incoming commit's content is *already on HEAD* — either literally (a true duplicate that patch-id should have skipped but didn't, because a predecessor's rebase mutated the patch-id — see Step 4's cascade caveat) or as a strict superset (HEAD has the same content plus refinements introduced by review-feedback fixups or by predecessor conflict resolutions). The resolution is `git rebase --skip`, **not** an in-file edit; the recognition recipe below decides it.

     **Recognition recipe (concrete)**: (a) every new file `REBASE_HEAD` adds (`A` lines in `git show --name-status REBASE_HEAD`) already exists on HEAD; AND (b) for every modified file, every hunk's *post-image* (the `+` lines) is already present at the corresponding location on HEAD (literally or refined by a later commit). If both hold, `--skip`. If (b) holds only partially, this is **not** the patch-already-represented case — fall through to non-trivial.

   Otherwise it is **non-trivial**.
3. **Trivial — resolve.** Two paths depending on the trivial subtype:
   - **In-file resolution** (import collisions, whitespace, predecessor-traceable): apply the merge, `git add` the resolved files, `git rebase --continue`. Mention briefly in the running narration ("resolved trivial conflict in `<file>`: kept both imports") so the user can scan after the fact, but don't pause.
   - **Patch already represented in HEAD**: run `git rebase --skip` (do *not* edit files). Narrate one line: "skipped redundant commit `<short-sha>` — content already on rebased base". Do not `git add` or `git rebase --continue` for this subtype; `--skip` advances the rebase by itself.
4. **Non-trivial → stop unattended, otherwise propose and confirm.**
   In delegated unattended mode outside a combined replay, record the conflicting files, offending commit, and why it is non-trivial; then run `git rebase --abort`, report the branch as the stop point, and return without touching subsequent branches.
   The current disposable branch is restored to its pre-rebase tip; then apply the delegated-mode clean-stop (`git clean -fd`, empty `git status --porcelain`) before returning.
   In normal interactive mode, present the conflict, the proposed resolution (with reasoning, including any traceable precedent), and ask the user to confirm before applying.
   On user "go": apply, `git add`, `git rebase --continue` (or `git rebase --skip` if the proposed resolution is "skip this commit").
   On user "no": use the combined-replay exception when it applies; otherwise stop the skill (see Step 7 below).
5. **Normal interactive mode only: if the agent cannot determine a confident resolution at all** — e.g., the conflict involves intent that isn't apparent from the code or history — **stop the skill without aborting the rebase**.
   If this is a combined replay, use the exception above instead; the following stop-in-place behavior applies only to a per-branch replay.
   Leave the rebase in progress (working tree contains conflict markers and `git rev-parse --git-path rebase-merge` points to the active state).
   Tell the user clearly:
   - Which branch is mid-rebase (`<X>`).
   - Where the pre-rebase ref is saved.
   - That the user can finish the rebase manually with `git rebase --continue` after resolving, or `git rebase --abort` to roll back to the pre-rebase ref.
   - That subsequent branches in the chain have not been touched.
   - That re-invoking the skill from the source branch (or any later branch) will produce a fresh, smaller chain detection on top of whatever state the user leaves things in.

   Do **not** run `git rebase --abort` automatically.
   The user may want to inspect the in-progress state.

### Step 6 — Validation

Run validation **only for branches whose rebase had at least one in-file conflict to resolve** (trivial in-file or non-trivial).
Skip validation entirely for:
- Clean rebases (no conflicts at all).
- `--skip`-only resolutions (the "patch already represented in HEAD" trivial subtype). These don't introduce semantic change — the new base already represents the dropped commit's content — so there's nothing to validate that wasn't already validated when the predecessor branch was built.

Many repos take minutes to build and we don't want to waste time on rebases that didn't change anything semantically.

When validation is required:

During validation after a combined replay, use Step 4.5 in place of items 3–4 below: an intermediate repair must be applied through the per-branch fallback, and an ambiguous or failed repair restores the combined run and stops.

1. **Discover commands.**
   In order of preference:
   - `CLAUDE.md` or `AGENTS.md` in the project — look for explicit build/test instructions.
   - `package.json` `scripts` — common keys: `build`, `typecheck`, `lint`, `test`. Run the smallest sensible subset (e.g., `build` + `test` if both exist; just `build` if no `test`).
   - Other ecosystem signals: `Cargo.toml` → `cargo build && cargo test`; `pyproject.toml`/`setup.py` → `pytest` if present; `Makefile` → check for `make build` / `make test` targets.
2. **Run them.**
3. **On failure, attempt to fix.**
   The conflict resolution may have introduced a real issue (e.g., dropped a dependency, misnamed a symbol).
   Read the failure, attempt a focused fix, commit it as a follow-on commit on `<X>` (do not amend the rebased commits), re-run validation.
4. **If the fix is ambiguous or attempts fail** — stop the skill at this branch.
   In delegated unattended mode, record the exact failure and attempted fixes, run `git reset --hard <pre-rebase-ref>` on the disposable branch, apply the delegated-mode clean-stop (`git clean -fd`, empty `git status --porcelain`), and stop without touching subsequent branches.
   In normal interactive mode, tell the user:
   - The rebase succeeded but validation is failing.
   - The exact failure output.
   - What was attempted, if anything.
   - The pre-rebase ref location for rollback.

If no validation commands can be discovered, mention that fact and continue without validation.

### Step 7 — Stopping cleanly

The skill can stop at three points:
- During confirmation (user declines).
- On non-trivial conflict the user rejects, or one the agent cannot resolve.
- On validation failure that cannot be auto-fixed.

A combined fast-path replay is never left as the stopped state.
On a rejected or indeterminate conflict it is aborted and restored before the per-branch fallback reaches the actual stop branch; on an ambiguous or failed validation repair the entire run is restored before the skill stops.

In normal interactive mode:
- Earlier branches that completed are left **rebased and checked-in locally**, not pushed.
- A per-branch current branch is left in whatever state stopped progress (rebase in progress, or rebased-but-failing-validation); the restored fast-path validation case instead stops with every branch in that run at its snapshot.
- Subsequent chain branches are completely untouched.
- All pre-rebase refs created so far are preserved.

In delegated unattended mode, a stop after a combined-replay validation failure restores every branch in that run to its snapshot, while a stop after a per-branch replay restores only the current disposable branch to its pre-rebase ref. In either case the worktree is left clean, and only the completed prefix before the restored run or branch remains rebased.

**Note on detached HEAD during in-progress rebase**: while a `git rebase` is paused mid-flight, the working tree is on a detached HEAD — `git branch --show-current` returns empty, which can be disorienting. Use `git status` (which reports the in-progress rebase, the branch being rebased, and the conflicted files) for orientation when resuming.

The user can resume by:
- Manually completing or aborting the in-progress rebase.
- Re-invoking `/dev-skills:rebase-stack` from the source (or any descendant of where things stopped). The new invocation will re-detect a fresh, smaller chain starting from the current state of the world.

The skill itself is **not re-entrant** in the formal sense — it does not persist state across invocations. Each run is a fresh detection-and-execution cycle. Git is the only persistent state.

### Step 8 — Final summary

Output:
- The chain that was processed, in order, with one-line outcome per branch (`rebased clean`, `rebased with conflicts (resolved silently / with confirmation)`, `rebased + validation passed`, `stopped at this branch`).
- Any branches that ended up empty (no unique commits relative to their new base) — flagged for the user to delete or close as appropriate.
  In delegated unattended mode, report emptiness as an integration result only; do not recommend closing a canonical branch without inspection.
- The list of pre-rebase refs created, with **inspection** and **cleanup** hints. Pre-rebase refs live in a custom git ref namespace (`refs/pre-rebase/...`), not under `refs/heads/`, so they are **invisible to most git GUIs** (GitKraken, GitHub Desktop, Sourcetree). Use the CLI:
  ```sh
  # Inspect — see all pre-rebase refs and the SHAs they preserve:
  git for-each-ref refs/pre-rebase/

  # Restore a single branch from its pre-rebase snapshot:
  git update-ref refs/heads/<branch> $(git rev-parse refs/pre-rebase/<branch>/<timestamp>)

  # Delete only the pre-rebase refs created in THIS run. Every ref this run saved shares one <timestamp>,
  # so filter by that suffix — do NOT blanket-delete refs/pre-rebase/, which would also remove snapshots
  # from other branches and earlier runs:
  git for-each-ref --format='%(refname)' refs/pre-rebase/ | grep '/<timestamp>$' | while IFS= read -r ref; do git update-ref -d "$ref"; done
  ```
- A reminder that nothing has been pushed.
- Any divergence between local target and cached `origin/<target>` (still a non-blocking note).

## Design notes

### Why per-branch rebase instead of `git rebase --update-refs`

This skill deliberately uses `--update-refs` itself for each verified linear run whose intermediate tips will all be replayed: one replay preserves the run's ancestry, moves exactly its intermediate branch refs, avoids repeated shared-commit replays and their patch-id cascade, and retains snapshots, exact postconditions, and per-branch validation gates.
It deliberately falls back to `--no-update-refs` branch-by-branch when the history is non-linear or the exact-ref and worktree checks fail: conflict resolution then benefits from per-branch reasoning, validation still gates on "did this branch have a conflict?", and stopping mid-chain leaves later branches untouched.
Using `--update-refs` without the fast path's gates is unsafe for a non-linear stack because it can move later, skipped, or unrelated refs before their own controlled iteration; inheriting `rebase.updateRefs=true` would create the same hazard implicitly.

### Why no fetch

Fetching is a side effect that influences which commits the rebase will see; doing it implicitly would surprise users who deliberately keep their local refs at a particular state. Ref hygiene stays in the user's hands.

### Why keep pre-rebase refs

They are cheap (just refs, no extra blobs), the value if a rebase goes wrong is high, and the final summary's one-liner cleans up this run's refs.

## Checklist for the agent

- [ ] Working tree is clean before starting.
- [ ] Target branch resolved (default `main`, fallback `master`).
- [ ] Source branch resolved (default current); explicit `chain` form short-circuits detection.
- [ ] No rebase already in progress.
- [ ] Effective frontier `EF` computed via patch-id (`--cherry-mark`) before chain detection.
- [ ] Chain detected via `EF`-relative topology, or taken verbatim from explicit chain spec.
- [ ] Confirmation listing produced (with `EF` shown) and approved.
- [ ] Maximal contiguous linear runs classified by ancestry, single-line history, exact moved-ref set, replayable intermediate tips, and all-worktree checkout state; every failed run assigned to the per-branch fallback.
- [ ] Pre-rebase ref saved for every branch before its per-branch replay or before a run's single fast-path replay.
- [ ] Every replay start states ref movement and merge topology explicitly: `--update-refs --no-rebase-merges` for a qualifying run, `--no-update-refs --no-rebase-merges` for the per-branch loop.
- [ ] Every fast-path success satisfies the exact changed-ref and ancestry postconditions; an unexpected run-only omission restores the whole run before per-branch fallback.
- [ ] Conflicts classified trivial (in-file resolve OR `--skip` for "patch already represented") vs non-trivial; interactive non-trivial conflicts confirmed before applying, unattended ones recorded and aborted.
- [ ] Validation only after branches or fast-path branch intervals that had in-file conflicts.
- [ ] Interactive stopping does not auto-abort in-progress rebases; delegated unattended stopping aborts/resets cleanly.
- [ ] Delegated unattended mode used only for an explicit, preauthorized chain of disposable branches; non-trivial stops abort/reset cleanly without waiting.
- [ ] No pushes, no fetches, no auto-deletion of branches.
- [ ] Final summary lists outcomes, empty branches, and cleanup hint.
