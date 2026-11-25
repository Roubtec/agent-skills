---
name: rebase-stack
description: A set of local branches should end up as one clean linear chain on a new base - a stacked-PR chain whose predecessors were merged, a leafy stack whose middle branches grew fix commits their descendants lack, or independent ready-to-merge branches to be stacked in a chosen order. A smart `git rebase --update-refs` with conflict resolution for the cases `--update-refs` cannot handle alone. Trigger when the user asks to rebase or restack a stack of branches, linearize a leafy stack, move a chain of PRs onto main after merges, stack branches on top of each other, or run rebase-stack. Not for a single branch that is its own PR (address-review rebases that itself).
---

Rebase a chain of stacked local branches onto a target branch.

**Arguments:** `[<source-branch>] [onto <target-branch>]`

This skill is built for the "stacked PRs" workflow where each feature branch was originally based on its predecessor.
After predecessors get merged into the target branch (typically `main`), the remaining branches need to be rebased so their unique commits land on top of the new target tip — and so each subsequent branch in the chain ends up cleanly stacked on the freshly rebased one above it.

It uses one deliberate replay for a verified linear run and otherwise works one branch at a time, with explicit user confirmation up front and intelligent conflict resolution along the way.

## When to use this

Typical scenario: you produced a chain of branches `feature/01 → feature/02 → ... → feature/N`, each PR'd into the previous.
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
- The user is responsible for fetch/pull hygiene; the skill uses local refs only, except that detection asks `gh` which branches have an open PR.

## Invocation forms

Explicit Codex invocation uses `$rebase-stack`; natural-language equivalents are fine.
All forms route through the same logic.
Be lenient about parsing: trust the agent to extract source, target, and (optionally) explicit chain, then rely on the confirmation listing as the safety net.

| Form | Meaning |
| --- | --- |
| `$rebase-stack` | Current branch onto `main`; chain auto-detected |
| `$rebase-stack onto <target>` | Current branch onto `<target>`; chain auto-detected |
| `$rebase-stack <source>` | `<source>` onto `main`; chain auto-detected |
| `$rebase-stack <source> onto <target>` | `<source>` onto `<target>`; chain auto-detected |
| `$rebase-stack <source> -> <target>` | Same; arrow tolerated |
| `$rebase-stack <source> → <target>` | Same; unicode arrow tolerated |
| `$rebase-stack chain <b1> <b2> ... <bN> onto <target>` | Explicit chain in stacking order; the last branch is the source; auto-detection is skipped entirely |
| `$rebase-stack chain <b1> -> <b2> -> ... -> <bN>` | Same with arrows; `onto <target>` defaults to `main` if omitted |

Quoting is optional; branch names with spaces should use quotes.
If `main` doesn't exist, fall back to `master`.
If neither exists, ask the user for the target branch.

**When to use the explicit `chain` form**: if auto-detection comes back empty or wrong (most often after a chain branch was merged via rebase-and-merge — see "Detection corner cases" below), the explicit form is the simple, robust answer.

### Delegated unattended mode

Another skill may invoke `rebase-stack` without an interactive user only when its prompt supplies an explicit chain, explicitly authorizes execution, and states that every chain branch is a disposable snapshot.
In that mode:

- Validate and print the proposed chain for the record, but treat the parent prompt as confirmation and do not wait for another `go`.
- Never re-derive, reorder, or drop branches from the chain, and never push or fetch.
  (This bars dropping a *chain branch*; the `git rebase --skip` used for the "patch already represented in HEAD" trivial subtype is still expected.)
- Resolve trivial conflicts as usual.
- On the first non-trivial conflict outside a combined replay, abort the current rebase and stop; during a combined replay, abort and restore the whole run, then use the per-branch fallback to establish and stop at the actual branch boundary.
  Do not leave conflict markers or an in-progress rebase for the parent agent.
- If conflict resolution completes but validation cannot be repaired confidently, restore the whole run after a combined replay or reset the current disposable branch after a per-branch replay, then stop as Steps 4 and 6 prescribe.
- Before returning, run `git clean -fd` to remove untracked leftovers (`git rebase --abort` and `git reset --hard` restore tracked files but leave `.orig`/build outputs) and confirm `git status --porcelain` is empty, so the parent can `git worktree remove` without `--force`.
- **What these commands may reach.**
  Every `git reset --hard` and `git clean -fd` this mode runs — the restore after a stop, the pre-return clean, and the clean-stop that follows a restore — is scoped to the disposable chain branch currently being processed (the caller's guide branch) and to the worktree this invocation was pointed at: never a canonical task branch, never a remote ref, never a sibling worktree.
  The combined replay and combined-run restore are the only multi-ref writers: Step 4 gates the replay to exactly the disposable run branches, and its guarded `git update-ref --stdin` restore transaction reaches exactly those branches and their saved snapshot OIDs — never a canonical branch, remote ref, skipped branch, or branch outside that run.
  `git clean -fd` is bounded to the tree it runs in; ref-moving commands are not — a worktree isolates the working tree, not the repository, so a `reset --hard` on the wrong branch or an incorrectly scoped ref transaction reaches every sibling worktree through the shared `.git`.

Do not infer this mode merely because the caller is a subagent.
Without all three guarantees — explicit chain, explicit authorization, and disposable branches — use the normal interactive confirmation and stopping behavior.

## What the skill does NOT do

- It does not push to origin.
- It does not fetch from origin.
- It does not delete branches, including chain branches that end up with no unique commits after rebase.
  Empty branches are reported in the final summary for the user to handle.
- It does not modify the target branch.
- It does not skip branches the user marks as "skip" during confirmation.
  Those branches are left entirely untouched.

## Procedure

### Step 1 — Preflight

`stack.sh`, beside this file, does the ref arithmetic of the steps below; run it by absolute path.
It prints `key=value` lines with `outcome=` first, exits 0 to proceed and 3 on a stop that needs a decision, and explains a stop on stderr; `stack.sh --help` lists every command and the lines it prints.
It never fetches, pushes, rebases, or deletes a ref, and reads local refs only, except that `detect` also asks `gh` for the open PRs where it can.

Run `stack.sh preflight [--source <branch>] [--target <ref>]`, passing whichever of the two the user named.

- **`ready`** → it prints the resolved `target` (default `main`, then `master`), the `source` (default: the current branch; it need not be checked out, since the skill checks branches out as it goes), and the `stamp` every pre-rebase ref of this run shares.
  `untracked=` counts untracked files: they do not block the run, unless a checkout of a chain branch would overwrite one, in which case ask the user to move it first.
- **`dirty`**, **`rebase-in-progress`** → stop with a clear message asking the user to commit, stash, or clean, or to finish or abort the rebase.
  Do not auto-stash.
- **`no-target`**, **`no-source`** → ask the user for the branch it could not resolve.

### Step 2 — Detect the chain

If the user supplied an explicit `chain` form (see Invocation forms), skip detection entirely and use the provided list as-is — the last branch is the source, the rest are chain branches in stacking order.

Otherwise run `stack.sh detect --source <source> --target <target>`, adding `--repo <owner>/<repo>` where the user named the repository, or `--offline` to ask `gh` nothing.

It computes the **effective frontier** `EF`: the newest commit on the source's history that is patch-equivalent to one reachable from the target, or their strict merge-base where there is none (`ef-kind=` says which, `equivalent=` how many source commits the target already carries).
A chain candidate is a local branch that forks from the source's history past `EF`, ordered from the frontier up, and the chain to rebase is the `branch=` lines in order, the source last.
A branch holding a commit the source lacks is a candidate on that alone.
One with none — a branch of a linear stack, or a snapshot ref left by an earlier workflow stage, which look alike — is a candidate only on the evidence its `evidence=` line names: an open PR publishes from it, or else it tracks a remote branch that exists (`prs=` says whether `gh` could be asked).

This is **heuristic, not metadata**: it can also catch an unrelated branch that shares a merge-base on the spine (e.g., `login-tests` accidentally branched from `feature/03`), which the confirmation listing lets the user filter out.

- A `near=` line names a spine branch with no commit of its own, no open PR and no upstream: a snapshot ref, or a chain branch never published.
  To carry it along, use the explicit `chain` form (that list is authoritative) or a deliberate manual `git rebase --update-refs --no-rebase-merges` after explicitly enumerating and approving every ref the replay would move and applying Step 4's all-worktree checkout check.
- A `merged=` line names a spine branch whose every commit the target already carries: a merged predecessor left behind.
  It is never a chain branch, but while it exists Step 4 replays the run it points into one branch at a time.
  Offer in the listing to delete it first (`git branch -d`, or the `prune-branches` skill); delete nothing without the user's word, and never in delegated unattended mode.

#### 2c. Detection corner cases

- **Detection finds nothing** (`outcome=empty`): surface this clearly, show `EF` and the `near=` branches that *almost* qualified and offer two paths: re-run with the explicit `chain` form, or proceed with just the source.
  Don't silently treat "empty chain" as "rebase the source alone" — confirm.
- **Source is a checkpoint, not a tip** (a `checkpoint=` line): the source is itself an ancestor of that other local branch, so the user probably meant that branch as the source.
  Note this in the confirmation listing as a `[!]` flag.
  Such a branch is never listed as a chain branch: it sits above the source, and the chain is replayed with the source last.

### Step 3 — Present the confirmation listing

Output a clear, scannable listing, from what `detect` printed: each `branch=` line is a name, its tip, its count of commits past the branch above it, that branch's name, and the tip's subject, tab-separated.
Include for each branch in the proposed chain:

- Branch name.
- Short SHA of its tip and tip subject line.
- Count of commits unique to this branch versus the next-up candidate (or versus the source for the topmost).
  Use this to highlight likely fix commits — small numbers are normal; large numbers on a branch with a name like `login-tests` are a red flag.
- For a branch taken on an `evidence=` line, that evidence (`PR #12`, `tracks origin/feature/05`), with a `[!]` flag where it looks like a shared integration or release branch rather than a branch of this stack.
- For any branch that looks suspicious (e.g., an outlier in commit count or whose name doesn't fit the apparent chain pattern), flag it with `[!]` and a one-line reason.

Also state that any qualifying contiguous linear run may be replayed once with `--update-refs`, moving exactly that run's listed branch refs together, while every run that fails the exact-ref, topology, or worktree checks falls back to branch-at-a-time replay.

Also report **target divergence info** as a non-blocking courtesy:

- Local target SHA.
- Cached `origin/<target>` SHA (read from local cache; do not fetch).
- Approximately when that cached ref last changed (`origin-read=`, where its reflog says).
- Whether they differ.

Do **not** block on divergence.
The user may pull manually while the confirmation prompt is open; on "go" the skill re-reads the local target ref.

Example listing:

```text
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

Execution: each verified linear run may move exactly its listed branch refs together in one replay; all other branches will be replayed one at a time.

Conflicts: trivial resolutions will be applied silently; non-trivial ones will be confirmed with you before continuing.
Validation (build/test) will run only after a branch had conflicts to resolve. Clean rebases skip validation.

Confirm with `go` to proceed, or list branches to skip, or supply an explicit chain like `chain b1 -> b2 -> b3`.
```

In normal interactive mode, wait for the user's reply.
In delegated unattended mode, print the same listing for auditability and proceed immediately; the explicit parent prompt is the confirmation.

If the user provides branches to skip, remove them from the chain and re-display the updated listing for a final confirmation.
Skipped branches are **left entirely untouched**.

### Step 4 — Linear-run fast path and per-branch rebase loop

After the chain is confirmed and any skipped branches have been removed, run `stack.sh segments <b1> ... <bN>` on it, in order: it divides the chain at every consecutive pair `X → Y` where `X`'s tip is not an ancestor of `Y`'s.
Each `segment=run` line is a candidate run of at least two branches; a `segment=single` branch uses the per-branch loop.
Process candidate runs and single-branch segments strictly left to right under one base-selection invariant: before qualifying or executing any segment `<first> ...`, set its `<segment-base>` to `<target>` if and only if `<first>` is the first branch of the entire confirmed chain; otherwise set it to the freshly rebased tip of `<first>`'s immediately preceding confirmed branch.
Never choose the base from whether this is the first fast-path run or the first run of a particular kind.
If a candidate run falls back, its first branch keeps that same `<segment-base>` and each later branch advances onto its freshly rebased immediate predecessor; after any segment succeeds, apply the invariant anew to the next segment.
For a candidate run `<first> ... <last>`, run `stack.sh qualify --base <segment-base> <first> ... <last>`.
It never guesses a boundary: the run is replayed together only where every one of its checks holds, and any one failing sends the whole run to the per-branch loop.

- **`combined`** → the run has one fork from the base (`fork=`), carries no merge and no commit off that line, is pointed into by exactly its own branches — no omitted or skipped chain branch and no unrelated local branch — has every intermediate tip actually replayed rather than dropped as patch-equivalent to the base, and has no branch checked out in another worktree.
  Where it prints `detach-first=`, this worktree stands on a run branch: run `git checkout --detach <segment-base>` and qualify again before replaying.
- **`per-branch`** → `reason=` names the check that failed; process the run's branches with the per-branch loop below.
  A run whose fork already is the segment base needs no combined replay, and that loop's iterations safely no-op as appropriate.

Whenever the instructions below say to restore an entire run, run `stack.sh restore --stamp <stamp> <first> ... <last>`.
It detaches this worktree if it stands on a run branch, and moves every run branch back to its snapshot ref in one transaction, each update guarded by the commit the branch holds now, so it restores all of them or none.
On `ref-moved`, or on any stop, report the concurrent or unexpected ref movement; do not start the fallback from a state that was not restored exactly.

For a qualifying run:

1. **Save every pre-rebase ref before replaying anything.**
   `stack.sh snapshot --stamp <stamp> <first> ... <last>` saves `refs/pre-rebase/<X>/<stamp>` for each branch, with the stamp `preflight` printed, and records every local branch's tip for the verification below.
   These snapshots receive the same inspection and run-scoped cleanup treatment as the per-branch snapshots below.
2. **Replay once from the last branch.**
   Run the `replay=` command `qualify` printed, exactly as printed: `git rebase --update-refs --no-rebase-merges --no-fork-point <segment-base> <last-branch>`.
   Do **not** respell it as `--onto <segment-base> <fork>`: that makes `<fork>` the upstream used for cherry-pick dropping, so commits already represented on `<segment-base>` can be replayed instead of dropped.
3. **Verify exact ref movement and topology before accepting the run.**
   `stack.sh verify --stamp <stamp> --base <segment-base> <first> ... <last>` requires that exactly the run's branches moved, each off its snapshot, onto the base, and each an ancestor of the next.
   On `postcondition-failed`, restore the entire run and use the per-branch loop from the same `<segment-base>`.
   On `outside-moved`, a branch outside the run changed: stop and report it rather than hiding out-of-scope movement with a fallback.
4. **Handle conflicts under Step 5.**
   Attribute a conflicted commit to `<first>` when it lies in `<fork>..<first-original-tip>`, or to the later branch `Y` whose original interval is `<previous-original-tip>..<Y-original-tip>`.
   Trivial conflicts and accepted resolutions continue within the combined replay.
   A non-trivial conflict that the agent cannot resolve confidently, or whose proposed resolution the user rejects, is the explicit exception to Step 5's normal interactive stop-in-place rule: record it, abort the combined replay, restore the entire run, and start the per-branch loop for the whole run from the same `<segment-base>`.
   If that loop reaches the same conflict, do not ask the user to reconsider the same rejected or indeterminate resolution: in normal interactive mode leave that branch's per-branch rebase in progress for inspection; in delegated unattended mode abort and restore that current disposable branch, clean it, and stop.
5. **Keep validation branch-gated.**
   After a successful single replay and its postcondition check, apply Step 6 separately to every run branch attributed at least one in-file conflict, checking out each such branch to validate it; clean and `--skip`-only branch intervals still skip validation.
   Do not make a repair commit on an intermediate run ref while its descendants already point past it.
   On the first failure, inspect enough to decide whether a focused repair is clear.
   If it is, restore the entire run and process it with the per-branch loop from the same `<segment-base>` so Step 6 applies the repair at the correct branch boundary and later branches inherit it; from that point Step 6 governs, including stopping at that branch if the attempted repair fails.
   If no confident repair is apparent, restore the entire run and stop immediately without starting the fallback or touching later branches; delegated unattended mode also performs its clean-stop.
   This is the fast-path exception to Step 6 and Step 7's usual rebased-but-failing interactive state.
   Finish a successful run with `<last-branch>` checked out.

For every branch `X` not processed by the fast path, use this loop in confirmed-chain order.
Apply the segment-base invariant above: set `<new-base>` for the first branch of a fallback or singleton segment to that segment's already selected `<segment-base>`, then set `<new-base>` for every later branch in the same fallback to the freshly rebased immediately preceding confirmed branch:

1. **Save pre-rebase ref.**
   `stack.sh snapshot --stamp <stamp> <X>` saves `refs/pre-rebase/<X>/<stamp>`, with the one `YYYYMMDD-HHMMSS` stamp `preflight` printed, so every ref this run creates shares it.
   These refs are not deleted automatically; document the cleanup pattern in the final summary — scoped to **this run's** refs (the shared timestamp, or the exact list saved), never the whole `refs/pre-rebase/` namespace.
2. **Checkout.**
   `git checkout <X>`.
3. **Rebase.**
   `git rebase --no-update-refs --no-rebase-merges <new-base>`.
   The flags state both behavior axes instead of inheriting `rebase.updateRefs` or `rebase.rebaseMerges` configuration.

   **Important caveat — patch-id cascades.**
   If the previous branch's rebase had to *resolve* a conflict (Step 5), the resolved commit's patch-id no longer matches the original still present in the descendant's history, so git will not auto-skip it and replaying it conflicts.

   The right move in that case is **`git rebase --skip`** for that single commit.
   See Step 5's "patch already represented in HEAD" rule.
4. **Conflict handling** — see Step 5.
5. **Validation** — see Step 6.
6. **Move on** to the next branch.

After the last branch in the chain, the source branch is checked out at its rebased tip.

### Step 5 — Conflict handling

When `git rebase` halts on a conflict:

**Combined-replay exception:** while the linear-run fast path is active, use Step 4.4 wherever the rules below would normally abort and stop in delegated unattended mode or leave an interactive rebase in progress.

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
     The incoming commit's content is *already on HEAD* — either literally (a true duplicate that patch-id should have skipped but didn't, because a predecessor's rebase mutated the patch-id — see Step 4's cascade caveat) or as a strict superset (HEAD has the same content plus refinements introduced by review-feedback fixups or by predecessor conflict resolutions).
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
   On user "no": use the combined-replay exception when it applies; otherwise stop the skill (see Step 7 below).
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

### Step 6 — Validation

Run validation **only for branches whose rebase had at least one in-file conflict to resolve** (trivial in-file or non-trivial).
Skip validation entirely for:

- Clean rebases (no conflicts at all).
- `--skip`-only resolutions (the "patch already represented in HEAD" trivial subtype).

When validation is required:

During validation after a combined replay, use Step 4.5 in place of items 3–4 below: an intermediate repair must be applied through the per-branch fallback, and an ambiguous or failed repair restores the combined run and stops.

1. **Discover commands.**
   In order of preference:
   - `CLAUDE.md` or `AGENTS.md` in the project — look for explicit build/test instructions.
   - `package.json` `scripts` — common keys: `build`, `typecheck`, `lint`, `test`.
     Run the smallest sensible subset (e.g., `build` + `test` if both exist; just `build` if no `test`).
   - Other ecosystem signals: `Cargo.toml` → `cargo build && cargo test`; `pyproject.toml`/`setup.py` → `pytest` if present; `Makefile` → check for `make build` / `make test` targets.
2. **Run them.**
3. **On failure, attempt to fix.**
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

A combined fast-path replay is never left as the stopped state; Steps 4.4 and 4.5 restore it first.

In normal interactive mode:

- Earlier branches that completed are left **rebased and checked-in locally**, not pushed.
- A per-branch current branch is left in whatever state stopped progress (rebase in progress, or rebased-but-failing-validation); the restored fast-path validation case instead stops with every branch in that run at its snapshot.
- Subsequent chain branches are completely untouched.
- All pre-rebase refs created so far are preserved.

In delegated unattended mode, a stop instead restores the run or the current disposable branch as Steps 4–6 prescribe and leaves the worktree clean; only the completed prefix before the restored run or branch remains rebased.

**Note on detached HEAD during in-progress rebase**: while a `git rebase` is paused mid-flight, the working tree is on a detached HEAD — `git branch --show-current` returns empty, which can be disorienting.
Use `git status` (which reports the in-progress rebase, the branch being rebased, and the conflicted files) for orientation when resuming.

The user can resume by:

- Manually completing or aborting the in-progress rebase.
- Re-invoking `$rebase-stack` from the source (or any descendant of where things stopped).
  The new invocation will re-detect a fresh, smaller chain starting from the current state of the world.

### Step 8 — Final summary

Output:

- The chain that was processed, in order, with one-line outcome per branch (`rebased clean`, `rebased with conflicts (resolved silently / with confirmation)`, `rebased + validation passed`, `stopped at this branch`).
- Any branches that ended up empty (no unique commits relative to their new base) — flagged for the user to delete or close as appropriate.
  In delegated unattended mode, report emptiness as an integration result only; do not recommend closing a canonical branch without inspection.
- The list of pre-rebase refs created, with **inspection** and **cleanup** hints.
  Pre-rebase refs live in a custom git ref namespace (`refs/pre-rebase/...`), not under `refs/heads/`, so they are **invisible to most git GUIs** (GitKraken, GitHub Desktop, Sourcetree).
  Use the CLI:

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
