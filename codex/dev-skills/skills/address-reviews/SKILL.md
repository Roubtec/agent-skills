---
name: address-reviews
description: Several pull requests or branches need their review feedback addressed at once. Trigger when the user asks to address reviews on multiple PRs or branches, fix review comments across many PRs in parallel, or run address-reviews. Fans address-review out over isolated worktrees so the PRs are fixed concurrently without cross-talk. Not for implementing task spec files (use address-tasks); for a single PR prefer address-review.
---

Address the review feedback on **several pull requests at once**, fanning each PR out into its own git worktree so they progress concurrently without polluting each other.

**Arguments:** `<PRs and/or branches> [rebase on top of <target>] [no-rebase] [no-push] [push] [peer-opinions=off] [ping-codex] [ping-claude] [ping-copilot] [ping-contributing]`

Explicit Codex invocation uses `$address-reviews`; natural-language equivalents are fine.

This skill is the parallel batch front-end for `address-review`.
It does **not** re-implement review-addressing — it sets up one isolated worktree per entry and uses `address-review`'s delegated fix and publish procedures, with a fresh orchestrator-owned reviewer and best-effort `claude` second opinion between them.
Each batch entry is either a **PR number** (resolve the PR head, preferring a usable same-named local branch before falling back to `origin`) or a **local branch name** (work *your* local ref, which `address-review` step 1 then reconciles against the PR head without discarding local work) — see "Resolving and checking out each entry" for the local-first rule that keeps a locally-rebased branch from being silently replaced by a stale `origin` copy.
It borrows its worktree machinery (isolation model, Session Bootstrap, adaptive throttling, cleanup) wholesale from `address-tasks` — **read that skill for the rationale behind those pieces**; only the deltas are spelled out here.

## How this differs from address-tasks

Everything here follows from one fact: **the PRs already exist**, so we modify existing branches rather than create new ones.

- **No new PR head lineage, no `gh pr create`.**
  Each worktree checks out an **existing PR head branch** (creating a local tracking branch only when needed); pushing is handled inside `address-review`.
- **No dependency waves for review addressing itself.**
  Distinct PR heads can run concurrently from the start (subject to throttling), and entries that resolve to the same head branch must still be serialized.
  The rebase path is the exception: stacked entries follow the base-before-dependent order below.
- **Per-PR guidance comes from `address-review`, but the parallel orchestrator owns the phases.**
  A rebaser subagent puts the entry on its freshest base, a fix subagent runs `delegated-fix`, a second rebaser lands those fixes on the base as it then stands, and a separate fresh reviewer and concurrent best-effort `claude` peer check the returned packet; fix-up/re-review rounds follow as needed, each with its own pre-review rebase; only an entry that clears the review gate gets a `publish-reviewed` subagent — and gets it the moment it clears, since publication is per entry rather than a batch barrier.
  The peer wiring in standalone `address-review` is not inherited because `delegated-fix` stops before review.
- **A leafy branch stack is the expected outcome and is fine.**
  Parallel fixes leave the PR branches diverged.
  This skill does **not** build a restack guide — integrating the result is a deliberate follow-up via `rebase-stack` (or manual rebases).
  See "After the batch".

## Stacked PRs: a fix may be hostable on only one branch

When the batch contains stacked PRs, a thread's fix can depend on code that exists only higher up the stack (a gate, helper, or schema a later branch introduces).
A per-PR fixer on a lower branch cannot host that fix, and two worktrees must never implement halves of one atomic change.
When triage reveals such a dependency, concentrate the change on the branch where its prerequisite lives (often top-of-stack), and close out the lower PR's thread without a local code fix — while keeping each disposition's `address-review` contract intact.
Cross-PR references are valid and expected here, but they ride on the normal disposition mechanics: use **follow-up-task** backed by a committed task file that restates the concern and points at the hosting PR/branch — the committed record the reply cites, not the bare reply itself, is what proves the concern will not be forgotten after the merge.
The task normally rides the PR's own branch, but any committed home whose merge is part of the plan qualifies: an earlier branch in the stack that already carries the task, or — a maintainer-accepted calculated risk — the hosting branch higher up (that record evaporates if its branch never merges).
Use **already-addressed** only when the branch's *own* code already satisfies the concern — never on the strength of a fix that exists only on another branch.
For *reading* across the stack without touching any checkout, use `git show <ref>:<path>` (pipe through `cat -n` when you need line numbers); if a `gitcat <ref> <path> [<start> [<end>]]` helper is on PATH, prefer it — it prints another branch's version of a file with stable line numbers directly.

## Arguments

Parsing is **lenient** — accept commas, `&`, `#` prefixes, and free word order.

| Argument | Meaning |
| --- | --- |
| `<PRs and/or branches>` | The batch: one or more entries, each a **PR number** (`#38`, `38`) or a **local branch name** (`task/088`). May be mixed (`#38 task/084 6`). Each becomes one worktree + one phased review-addressing workflow. This is the only required argument. |
| `no-push` | Passed through to every entry as a **local-only run**: fix and commit in each worktree, but perform no PR-side communication (no push, replies, resolves, Summary, or ping). The one PR write that remains is the disposition record comment, which **you** leave per entry — see "An entry that will not publish still leaves its record." below. |
| `push` | Passed through to every passing entry's publisher: push the fixed branch (normal fast-forward, or an exact expected-OID lease for every other state that pushes at all) and do the PR-side communication (replies, resolves, Summary comment) — but **ping no reviewer**. Use it to publish the batch quietly, without summoning fresh review rounds. |
| `rebase on top of <target>` | Rebase every entry onto **this** target — a branch name or an exact commit — instead of onto each entry's own base ref. It is resolved to a commit ONCE at setup, by `targets.sh plan` below, and reused at both points; a stacked dependent still goes onto its **parent's new tip**. `no-rebase` wins over it for the REBASE but does not discard the target itself: it remains the pinned effective base every entry's ranges are taken against. |
| `no-rebase` | **Do not rebase** — you run neither of the two rebase points for any entry, so each branch is addressed and published on the base it already sits on. It is per-invocation, not per entry; a single entry sits out only because the invocation prose said so ("rebase everything except `special/snowflake`"), which you honor as an ordinary instruction and record in the summary — no flag syntax for it. |
| `peer-opinions=off` | Disable the best-effort `claude` disposition review for the whole batch. It is on by default, including in hands-off mode. |
| `ping-codex` | Passed through to each publisher with `address-review`'s meaning: a dedicated `@codex review` comment after a real push. Implies `push`. |
| `ping-claude` | Passed through likewise: a dedicated `@claude review` comment after a real push. Implies `push`. |
| `ping-copilot` | Passed through likewise: a Copilot review request after a real push. Implies `push`. |
| `ping-contributing` | **The default** — a bare batch with no push/ping argument publishes every entry and re-pings its contributing bots exactly as if this were passed. Passed through with `address-review`'s meaning and evaluated **per PR**: each publisher re-pings a bot only if it brought a genuinely new finding on that PR this round; combined with explicit `ping-*` it filters that named set, and alone it falls back to the known bots (codex/claude/copilot) that reviewed each PR. Implies `push`. |

**Classifying each entry** is the helper's, below: a bare or `#`-prefixed integer is a **PR number**, anything else a **branch name**, and a branch literally named like an integer is passed with an explicit `refs/heads/` prefix, or by its PR number instead.

**Local-first guarantee.**
When you supply a branch name, the worktree is checked out from **your local ref, never from `origin`** — so a branch you rebased locally while `origin` is stale is worked as it stands on disk rather than being replaced by the stale remote copy.
The guarantee is *never replaced by a stale remote*, not *never moved*: `address-review` step 1 does fast-forward a local ref that is **strictly behind** the PR head with nothing unpushed, because there is no local work to lose in that case, and it stops for a maintainer call rather than guessing when the two have genuinely diverged.
More broadly, this skill checks out `origin` for an entry **only when there is no local branch to use** (a PR number whose head branch you don't have locally).

**Always force-injected into each `address-review` invocation (not a user argument):** `hands-off`.
Every parallel subagent has no line back to the user, so its prompt must impose the equivalent unattended contract: best-effort on low-stakes choices, document and stop on high-stakes blockers.
The top-level orchestrator (you) may still consult the user for **batch-level** blockers (e.g. a PR number that resolves to nothing) when you yourself are running interactively.

**Not user-facing (orchestrator may supply at its own discretion):** the per-PR `#N` (you always pass each subagent its assigned PR).
**Rebasing is on by default**, per entry — and it is **yours to run**, at both of `address-review`'s two points (see "Phase A — initial fix" for where each runs), so the pinned targets and the topological order below govern every batch rather than only a requested one.
`no-rebase` in an entry's own argument string says the ENTRY rebases nothing rather than that the batch does not rebase.
`no-rebase` turns the default off for the whole batch, and an entry the invocation prose excluded is treated the same way.
The step itself is `review-cycle` → "The delegated rebase step": the brief, the base pinning, the parent-first `--onto` form, the hunk-level conflict rules, the clean halt, and the packet it returns are defined there, and nothing about them is restated here or in the entry's prompt.

**One call plans the batch:** `targets.sh plan --repo <owner>/<repo> [--target <target>] [--no-rebase | --except <entry>…] <entries…>` — the helper beside this file, run by absolute path in the main tree, whose `--help` is the contract for every field named here.
`--repo` is the repository the batch's PRs are in (`<host>/<owner>/<repo>` where that is not github.com): take it from a PR URL the invocation gave, else from `gh repo view --json nameWithOwner` in the main tree, which is only a first guess, since the plan fails and names the right repository where a PR's own URL disagrees.
The `repo=` it prints back, read from the PRs' own URLs and always host-qualified, is what every later command for an entry names.
Exit 1 prints no plan at all (a PR, a head or a base that could not be read, a head that kept moving under the fetch): run it once more, then report it as a batch-level blocker, never work from part of a plan; `outcome=cycle` and `outcome=unresolved` (exit 3) are batch-level stops too.
`--target` carries a `rebase on top of <target>` token, quoted as ONE argument; `--no-rebase` carries the batch-wide token; `--except` names each entry the invocation prose excluded.
It prints one line per entry, parents first: the paired PR, its fetched head, its `parent=` in the batch, whether it rebases, and the exact commit it is pinned to (`pin=`), whose `target=` is `default` (the entry's own base ref), `named` (the invocation's) or `parent`.
A line with a `skip=` reason is an entry to skip-and-record while the rest proceed; `no-remote` there is that entry's blocker, never a reason to pin `origin/<baseRefName>`.

A target the invocation named is resolved WHERE IT WAS NAMED — in your own checkout, ONCE, by that call, with nothing fetched for it — so the call runs after Bootstrap's `git fetch origin`: a remote-tracking ref resolved before that fetch names a staler commit than the request meant.
Where it stops on `unresolved`, stop the batch and report what you tried rather than substituting anything.
Its `named=` commit is the batch's one base: that single OID serves every rebase-enabled entry at both of its points — overridden only for a stacked dependent, whose parent tip wins — and it, never the ref name again, is what any later `plan` is given as `--target`.

For a rebase-enabled stack, rebase the base entry first onto its pinned target, then pin the dependent's target to the exact rebased base tip (a `target=parent` line has no `pin=` until then) — never rebase the dependent directly onto the original pinned target.
If a parent PR merges during the batch, resolve the refreshed branch containing that merge once to an exact commit at that refresh and reuse the pinned SHA for every affected dependent.
Restacking each **rebase-enabled** dependent onto that commit is mandatory because the merge may rewrite the parent's commit SHAs; rely on patch-id dropping, then verify the dependent's diff no longer contains parent content and rerun its review gate before publication.
A dependent for which rebase remained disabled has no restack obligation.

**Re-pin a default target at each rebase point.**
It is the DEFAULT target this governs, and only it: immediately before each point, `targets.sh repin --repo <repo> --pr <N>` fetches the entry's own base ref afresh, and the `pin=` it prints is what you pin.
A named target is the batch's single pinned base and a parent tip is that parent's post-rebase tip, both by construction, so neither is re-resolved per point.
That the second point then normally finds nothing to do for a named target is intended.
Normally rather than always, and the point runs either way — a pure-join merge still in range is flattened by the replay, moving the tip over an unmoved base — so a no-op is what that point may REPORT, never a reason for you not to spawn it.

**"Rebase-enabled" is now every entry** — the phrase survives in the rules below because `no-rebase`, or an entry the invocation prose excluded, still turns rebasing off (`rebase=no`), and those entries keep their exemption from every restack obligation.
The **parent map** those orderings are computed from is that plan's `parent=` column, extended with each parent's **pre- and post-rebase tips** as its rebase completes, because that pair is exactly what restacks its children (`git rebase --no-update-refs --no-rebase-merges --onto <new parent tip> <old parent tip>`).
That is the whole of the stack bookkeeping this skill does; a chain that genuinely needs a whole-chain restack is `rebase-stack`'s after the batch, and reimplementing it here is the thing to resist.
Each entry's **pinned effective base** — the OID its rebase actually landed on, read from the delegated step's packet — is what that entry's later delegations name as `<effective base>..HEAD`: Phase B's review base, and any range a fix-up round is handed.
Where no rebase ran for an entry at all — a `no-rebase` batch, or an entry the invocation prose excluded — its effective base is its line's `pin=`, fixed ONCE at setup: the invocation-named target's own pinned OID on a `no-rebase` batch that named one, since `no-rebase` suppresses the rebase without discarding the token, and the entry's own base ref otherwise.
Never re-derive it afterwards from `origin/<base>` or the entry's `baseRefName`: a sibling entry's push or the next fetch moves those.
**A rebase that halts is one entry's blocker, not the batch's.**
The delegated step stops clean — a conflict beyond its competence aborted, or a content-bearing merge left unreplayed with no rebase started — leaves that worktree clean and idle, and hands back what it turns on as an open question: skip-and-record the entry with it, surface it among the hands-off blockers, and give its rebase-enabled descendants the parent's reason exactly as any other Phase-A failure does.
Siblings deliver.

**The default is to publish.**
A bare batch (no push/ping argument) publishes every entry and re-pings its contributing bots, exactly as `ping-contributing` (resolution order and precedence are as in `address-review` → "Flag interactions"); `no-push` is the only way to run the whole batch local-only.
Flag pass-through is otherwise **batch-uniform**: the same resolved `push`/`ping-*` set applies to every PR in the run, with one carve-out — a stacked dependent published ahead of its parent **whose diff is not honest** has its ping tokens replaced by `push`, unless the maintainer named a bot outright (see "Publication" → ping only on an honest diff).
With `ping-contributing` (including the bare default), the *flag* is uniform but its *effect* is evaluated independently inside each PR's `address-review`, so each PR re-pings only the bots still contributing to it.

## Worktree isolation (inherited)

Each PR runs in its **own git worktree** — a separate working directory with its own `HEAD` and index, sharing the one append-only object store and lock-protected refs.
Two subagents in two worktrees never corrupt each other, so they run **concurrently**.
The only serialization rule that survives is about committed state, not turn structure: within *one* worktree, an agent may not start until the previous agent's commits are on disk — so wait for that completion notification, however the harness delivers it, and treat "one-at-a-time" as the proxy it is.
See `address-tasks` → "Why worktrees change the rules" and "Durability & host isolation" for the full model.
The durability rule here is **commit early, but do not push before `address-review`'s reviewed publication step**: committed objects and branch refs survive in the shared `.git`, while premature pushes would publish unreviewed fixes and break no-push runs.

## Codex subagent execution

Use the subagent interface exposed in the current session.
In tool-enabled sessions this is typically available through tools such as `multi_agent_v1.spawn_agent`, `multi_agent_v1.wait_agent`, and `multi_agent_v1.close_agent`; use those names only when present in the current tool listing.
Spawn fixers and publishers as `worker` agents and reviewers as `explorer` agents.
Pass self-contained prompts; do not fork context, and omit model overrides unless the user asks for one.
After each same-phase batch returns, close those agent threads before advancing the phase.
No custom agent personas (`~/.codex/agents/*.toml`) are required.

Parallelism is allowed only across subagents assigned distinct worktree paths.
Within one PR's worktree the rule is committed state: the reviewer may not start until that fixer's commits are on disk, and no fix-up or publisher may start until the reviewer has returned its verdict.
A spawn call returns an agent id immediately and reports completion later, so wait for and close the fixer before spawning its fresh reviewer, and wait for and close the reviewer before any fix-up or publisher — that wait is what puts the commits there, and the wait-then-spawn ordering is the proxy, not the rule.
The examination-only `claude` peer is a plain shell process, not a Codex subagent, and is the sole same-worktree concurrency exception: launch it beside the Reviewer only after the tree is committed and clean, then collect both before advancing.
Never continue a fixer thread for review.
If the session exposes no subagent capability, stop and tell the user this workflow requires Codex multi-agent support.

## Session Bootstrap (run once, in the main working tree, before any worktree)

Follows `address-tasks` → "Session Bootstrap" — see that skill's Bootstrap for the fuller rationale.
In brief, all idempotent:

1. **Prepare the worktree base and prune stale state.**
   Run `bootstrap.sh run` — the script in the sibling `address-tasks` skill folder, run by absolute path — and do none of what it does by hand.
   It settles the worktree base, makes it ignored, prunes stale worktree state, probes remote access and measures free space, then answers in `key=value` lines with `outcome=` first.
   Where a `wt-bootstrap` helper is on PATH the script runs it for all of that but the ignore rule — the helper establishes no ignore rule, and reports `ok` whether or not one exists — and where it is absent plain git does the job, refusing nothing on the powbox layout checks that are the helper's alone; the ignore rule is the script's own on both paths.
   That rule goes in the repo-local exclude file, untracked and so dirtying nothing itself, and NOT in the tracked `.gitignore` — editing that would dirty the main checkout, which would later block freeing a batch branch it occupies.
   `outcome=stop` is a blocker: report its `blocker=` line, which names its own remedy, and create no worktree — never work around it by choosing another base or by listing the rule yourself.
   Any other non-zero exit arrives with no `outcome=` line and is a blocker too: report what the script printed on stderr, and create no worktree.
   `host-shared=yes`, which only the plain-git path prints, is **not** a blocker: tell the user once that the worktrees will live on a filesystem shared with the host — slower, and visible there — and proceed.
   **Stricter than the task batch:** here `remote=no` is a stop too — PR-number resolution and lease-safe publication cannot be trusted from stale refs.
   On `outcome=ready` with `remote=yes`, the `wt-base=` path is the `$WT_BASE` used below, and no other: it is `<repo>/.worktrees/` or a path beneath it (`<repo>/.worktrees/$CONTAINER_NAME` in a container), the one name the script's rule covers.
   Its `avail-bytes=` reading is the storage input to "Adaptive throttling"; where it reads `unknown`, measure it yourself (`df -k "$WT_BASE"`).
   An `orphan=` line names a leftover directory under the base that holds content and no registered worktree, and a `quarantined=` line one that `wt-bootstrap` moved aside: the script deleted neither, so name each in the final summary and never remove one yourself.
2. **Confirm GitHub API access.**
   `gh auth status` must succeed for every run because each subagent must read review threads (the `git ls-remote` probe checks git remote access, not the API).
3. **Preflight the peer once for the batch, unless `peer-opinions=off`,** in this main working tree, per the `review-cycle` skill's peer preflight.
   Never repeat the probe inside entries.
   Unavailability does not block the batch; retain its reason for one final-summary note.
4. **`git fetch origin`** to refresh remote-tracking refs.
   This updates `origin/*` only — it never moves a local branch or rewrites a worktree — so it is safe for branch entries (which work the local ref regardless) and keeps `origin/*` roughly current for orientation.
   Lease safety does **not** rest on it: the expected-OID lease is taken against the head ref that `address-review` re-fetches exactly at the publication boundary, which is what makes the comparison sound even when this ref has since gone stale.
5. **Record the main checkout's starting checkout mode:** current branch (which may be empty when detached) and `HEAD` SHA.
   A branch can be checked out in only one place at a time, so any entry branch the **main checkout currently occupies** must be freed before its worktree is created.
   The orchestrator does this on demand by detaching the main `HEAD` (see "Resolving and checking out each entry"), which needs the main tree clean.
   Restore the original branch after all entries using it are finished, or the original detached SHA if the session began detached.
   Starting from a branch outside the batch (usually `main`) avoids this dance.

## Orchestrator responsibilities

You are the orchestrator.
You do **not** edit the PR branches yourself; delegated fixers and publishers follow `address-review`, while you own worktree setup, fresh reviewer phases, and result aggregation.
Your job:

1. Parse the batch into a list of entries (see Arguments); capture the pass-through flag set.
2. Run the **Session Bootstrap**.
3. **Plan the batch** with `targets.sh plan` (see Arguments) — once, here, after Bootstrap's fetch and before any entry launches, since every entry's two points and every no-rebase effective base are taken against the commits it pins.
4. Take every entry's `(local-or-origin branch, PR number)` pair from its line before creating worktrees.
   An alias for a PR already listed (for example `#38` plus its branch name) comes back `skip=alias` and is dropped, and different PRs that share one head branch (`same-head=`) run serially rather than contending for the same ref.
5. **Create one worktree per distinct head branch in the current sub-batch** (see next section).
   Create a later same-head entry's worktree only after the earlier entry is complete and removed.
   Skip-and-record any entry that cannot be set up (closed/merged or PR-less, branch checked out elsewhere, a fork PR).
6. Run the per-PR **fix → review → fix-up** loop, bounded by the `review-cycle` round cap, in topological waves for rebase-enabled stacks, with unrelated entries advancing concurrently (see "Per-PR phased subagents": the parent gate, **Descendant invalidation**, and the **Remote-tip refresh guard**).
7. For each entry that passes, spawn its `publish-reviewed` subagent the moment its own gate passes — parent-before-dependent on a best-effort basis, concurrently for unrelated entries, never held for the batch — under the "Publication" rules (the blocked-parent carve-out, honest-diff ping suppression, and merged-parent content gate).
   If the run is `no-push` (local-only), skip publication and keep each entry's disposition map for a later push — then leave that map on each entry's PR **yourself**, per "An entry that will not publish still leaves its record.".
8. **Clean up** each worktree once its subagents return (never delete the PR branch).
9. **Aggregate** every per-PR report into one batch summary, surfacing the hands-off blockers prominently.

## Resolving and checking out each entry

This is the part that differs most from the task-file skills: you check out a branch that **already exists** (your local ref, or `origin`'s) rather than creating one.
Each entry resolves to a `(branch-to-check-out, PR-number)` pair — the `head-ref=` and `pr=` of its `targets.sh plan` line — and the pair drives the worktree and the subagent.

Shared setup, from the main tree: `$WT_BASE` is the worktree base dir chosen in Bootstrap, and `$ROOT` the repo root.
**Every** attach below reads `git worktree list` for an existing entry at `$WT_BASE/<slug>` FIRST — the plain form and the explicit commands alike, since they all add at that one path and a stable slug is precisely what a halted run leaves registered there: if the target directory already exists, verify it has the right branch checked out and reuse it; a wrong branch or an occupied ref means stop and report that entry, never guess.
For the **plain attach cases** below the standard form is then `git worktree add "$WT_BASE/<slug>" <branch>`.
If a `wt-enter <slug> <branch>` helper is on PATH, prefer it — it encodes exactly these checks (rerun-safe attach under `$WT_BASE`, refusing rather than guessing on wrong-branch or occupied-ref conflicts).
The cases the plain attach does not cover (detaching the main checkout, tracking `origin`) keep their explicit commands, under that same registration read.
These calls are safe to run while other entries' subagents are active — they touch only their own worktrees and the lock-protected refs.
Use a stable, collision-free slug per entry (e.g. `pr-<N>` or a sanitized branch name).

### Branch entry — work your local ref

The local-control path (the rebased-locally / stale-origin case).
The plan has already required a local branch of that name and paired it to the one open PR from that head, and its skip-and-records are `skip=not-local`, `skip=no-pr` (with no PR there are no review threads to address), `skip=ambiguous` (several such PRs; interactive, ask which and plan it by number) and `skip=fork` (fork PRs are not supported).
The bare local branch name must equal the PR's `headRefName` (which is the norm: a local rebase keeps the branch name).
If your local copy has a different name than the PR head, this auto-pairing cannot see it; use that PR's number with `address-review` directly, or rename to match.

1. **Check out the verified local ref as-is** — never a reset that discards local commits.
   `address-review`'s step 1 then reconciles that ref against the PR head without discarding local work.
   The checkout below never pre-empts that decision:
   - Not checked out anywhere → the plain attach: `git worktree add "$WT_BASE/<slug>" <branch>`.
   - Occupied by the **main checkout** (it's the orchestrator's current branch) → free it by detaching the main `HEAD` (`git -C "$ROOT" switch --detach`) **when the main tree is clean**, then attach it with the plain attach; the starting checkout mode recorded in Bootstrap is restored in Cleanup.
     If the main tree is *dirty*, skip-and-record (commit/stash or move the main checkout off it first).
     If setup fails after detaching and no later entry needs that branch free, restore immediately before continuing.
   - Occupied by **another worktree** (a sibling entry, or the same branch listed twice) → skip-and-record; a branch can't live in two worktrees.
2. **Set the push target:** `git -C "$WT_BASE/<slug>" branch --set-upstream-to=origin/<branch>` (origin's head ref for the paired PR, refreshed by Bootstrap's fetch).
   `address-review` still verifies the exact PR head and uses an expected-OID lease before any rewrite.
   Best-effort here too, for the reason given under "PR-number entry".

### PR-number entry — work the PR head

The canonical path.
Prefer a same-named local branch if you have one (so we still never bypass your local copy), else create the branch at the entry's **`head=`** — not at `origin/<headRefName>`, which Bootstrap's single fetch can leave stale in either direction.
`targets.sh plan` fetches the PR's exact head ref, moves nothing, and prints the entry's head as `head=` — what the fetch brought *now*, which is not necessarily the OID `gh pr view` just reported (`reported=`), and is the `headRefOid` recorded for the steps below.
**A fetched-behind-reported head is a rewind, not an advance:** where the entry is `skip=rewind`, block the entry for a maintainer decision without adopting the fetched OID.
Every other difference is adopted: create the entry's branch at `head=` on the path that creates one, and move nothing on the path where a usable local `<headRefName>` already exists, which `address-review` step 1 reconciles against this head instead.
Its `relation=` field says how that local branch stands to the head — `absent`, `equal`, `behind`, `ahead`, `represented`, or `divergent` — read as step 1 reads them.
Besides that rewind block, skip-and-record a `skip=closed` entry (the PR is not open) and a `skip=fork` one (fork PRs are not supported).

**Attach**, from the entry's line:

- If local `<headRefName>` exists, read `relation=` from that line rather than trusting `origin/<headRefName>` — Bootstrap's `git fetch` runs once, so a PR force-updated since then leaves the remote-tracking ref stale.
  Do this **before** considering checkout occupancy.
  Then let `address-review` step 1's reconciliation decide: check out a `behind` or `represented` branch and let it run, and skip-and-record only `divergent` — each side holds commits the other lacks **and** the remote's are not represented in the local tip by patch-id, the qualifier that keeps an ordinary locally-rebased branch workable.
- A usable local `<headRefName>` that is free → the plain attach (`git worktree add "$WT_BASE/pr-<N>" <headRefName>`) and **record any ahead/diverged state** in the summary.
- A usable local `<headRefName>` occupied by the main checkout → detach the clean main `HEAD` and add the worktree as in the Branch-entry case; if held by another worktree or the main tree is dirty, skip-and-record.
- No local `<headRefName>` (`relation=absent`) → create the branch at that **`head=` OID**, not at `origin/<headRefName>`: `git worktree add -b <headRefName> "$WT_BASE/pr-<N>" <head>`, then set tracking separately with `git -C "$WT_BASE/pr-<N>" branch --set-upstream-to=origin/<headRefName>` — best-effort: a clone whose fetch refspec does not cover this branch has no `origin/<headRefName>` to track, so record the failure and continue rather than losing an otherwise valid entry; publication resolves the exact push remote and ref itself instead of reading the upstream.

The absolute worktree path, the checked-out branch name, the **paired PR number**, and (for branch entries) the note "this is your local ref" are what you hand that entry's subagent.

## Per-PR phased subagents

Codex subagents must not be assumed to spawn their own subagents, so the top-level orchestrator owns every phase, including both rebase points, peer launch and triage.
For each reviewer round, fan out one same-phase subagent per distinct worktree in one tool-call batch and launch that entry's peer beside it; wait for each entry's own Reviewer and its launched peer, close that entry's subagents, then advance **that entry** — to its fix-up round or, per "Publication", its publisher — the moment its own outcomes are in.
The phase is per entry, not a batch barrier: an entry never waits for a sibling's reviewer, and the only waits between entries are the stack dependencies "Publication" and the parent gate name.

At every apply boundary — immediately before Phase A, each later dependency-wave launch, and each fix-up — re-fetch each affected PR's current state and relevant remote refs, then re-verify its open/merged state, head and base names, and OIDs.
Recompute stack ordering from those refreshed facts, but preserve the original non-parent target the invocation named, in either of its flavors — the commit it gave, or the OID a ref it named was resolved to once at setup: what this holds stable is the pin against a recomputation, and for a named target it is held across the run's own rebase points too, only a DEFAULT target being re-resolved there per "Re-pin a default target at each rebase point".

**Descendant invalidation.**
Whenever an established parent tip changes for any reason — not only a rebase or merge — invalidate every existing packet and review gate for its rebase-enabled descendants, but **hold** them un-restacked until the parent's situation resolves.
Once it does, pin each direct child to the parent's exact settled tip (for a newly merged parent: the refreshed branch containing the merge, resolved to one exact commit at that boundary and reused for every affected direct dependent), rerun `delegated-fix` with the required restack, rerun its fresh review gate, and cascade the same invalidation down the chain before any descendant can publish.
The revocation is provisional: where the parent resolves to a block rather than a new gated tip, the blocked-parent carve-out under "Publication" restores that descendant's last valid gate instead.
**Remote-tip refresh guard** — the one rule for any head movement observed after an entry's cycle has recorded its remote head OID; every later refresh, including the publication boundary, applies it.
Fetch the newly observed exact head tip without moving the local branch and classify it against local `HEAD` before adopting it as a new expected lease or continuing the cycle.
A tip that is an **ancestor** of local `HEAD` is the ordinary case — adopt it as the new expected lease, unless it is also behind the OID this cycle already recorded: that is a maintainer rewinding the head, and adopting it would let the publisher fast-forward the dropped commits straight back onto origin, so block it for a maintainer decision.
A tip that local `HEAD` is an ancestor of is a plain remote fast-forward, not divergence — taking it loses nothing.
Before Phase A, where no cycle has recorded a head yet, use the `headRefOid` that `gh pr view` reported at setup as the earlier observation: if the fetched tip is a proper ancestor of that available reported OID, block the entry for the same maintainer decision rather than recording it as replaceable.
Every other setup difference keeps the existing non-blocking behavior: re-record the fetched tip as this entry's PR head, let `address-review` step 1 reconcile the branch, and do not block (there is no packet yet to invalidate); this includes a head which advanced during setup and an unavailable reported OID in the undownloaded-force-push case.
At any later boundary take a plain remote fast-forward as an entry-affecting change — reviewed content moved under the packet, so invalidate the packet and rerun `delegated-fix`, the full fresh review gate, and Descendant invalidation before publication.
Only a genuinely divergent tip — each side holding commits the other lacks — blocks the entry and its rebase-enabled descendants; never publish, force-push, or record that OID as replaceable, and the hands-off batch never guesses the reconciliation — only an explicit reconciliation incorporating the remote tip, followed by `delegated-fix`, the full review gate, and Descendant invalidation, may resume the entry.
Do not extend step 1's patch-id qualifier to this guard: an unexpected concurrent push during the run deserves a maintainer call even when its commits are already represented locally by patch-id.

Every prompt starts with:

- **WORKTREE CONTRACT first:** "Your worktree is `<absolute path>`.
  Before anything else, `cd` into it and verify `git rev-parse --show-toplevel` prints exactly that path; if not, STOP and report.
  Do all work inside this worktree only — never `cd` to the repo root or touch sibling worktrees.
  Other agents are working in other worktrees concurrently; stay in yours."
- **The assignment:** "You are on branch `<branch>`, paired with PR #N.
  Confirm the branch with `git branch --show-current`.
  PR #N is the **authoritative pairing** — treat the supplied number as correct and do not re-derive it.
  This branch may be a local, possibly-rebased copy of the PR head, so its SHAs can differ from `origin`'s; that is expected, not a wrong-PR signal."
  (For a branch entry, add: "This is *your local ref*.
  Reconcile it against the PR head with step 1's no-work-lost rule: fast-forward it when it is strictly behind with nothing unpushed; keep it as it stands when the PR head is already represented in it by patch-id; and **stop and report for a maintainer decision** when the two have genuinely diverged, each holding commits the other lacks.
  Never reset or hard-pull from `origin`, and never publish over a divergence you did not resolve.")
- **Skill:** pass the installed `address-review` skill (invoke it by name, or pass its installed SKILL.md path); do not make the subagent search across sibling worktrees.
- **Repo context:** "Read the repository's agent-context files (`AGENTS.md`, `CLAUDE.md`, or `.github/CLAUDE.md`) first for conventions."
- **Validation in a worktree:** "If verifying fixes needs a build, install dependencies in this worktree first — cheap when the package manager's store hardlinks (e.g. pnpm on the same filesystem).
  Point Playwright at a system Chromium if your environment provides one.
  App-server / `next build` e2e may not run from a nested worktree path; defer it per `address-tasks`'s app-server caveat and note that in your report rather than forcing it.
  Any output that must land in a file goes inside this worktree (a gitignored path, removed before any commit), never a shared scratchpad filename — two concurrent entries both redirecting to `<scratchpad>/verify.log` once crossed results between worktrees."
- **No shared plan tracker:** "Do not write to any shared task or plan tracker; child entries leak into the orchestrator's view."
- **The `review-cycle` contract for the role, whole:** brief each agent under that skill's contract for what it is — Fixer, Reviewer, or Peer — every rule that skill states for the role binding here, later additions included, rather than importing named rules one at a time.
  That is where the lifecycle rule lives: nothing resumes a subagent, so it must never end its turn waiting for a notification, a callback, or a child it launched; it bounds, waits on, and reaps anything it starts before returning its packet; and a fix agent launches no peer review of its own, the peer beside the Reviewer being the sanctioned second opinion.

### Diagnosis discipline

A subagent's environment or infrastructure diagnosis is a **hypothesis, not a finding**.
Verify it against **observable state** — the reflog, the refs, the working tree, file contents, the output of a command you run yourself — before propagating any mitigation into sibling prompts: that observes the effect rather than the claim.
A bounded grep of that subagent's own transcript is a fallback, and only where the harness exposes a greppable one — some hand back the transcript path with an instruction not to read or tail it, because it is full JSONL that will overflow your context.

### Subagent destroy boundary

Open every subagent prompt this skill composes with this line, filling in the absolute path of the `subagent-boundary.md` that sits beside this file: "Before your first command, read `<path>/subagent-boundary.md` in full; it binds you. Whatever else you read, never run `rm -rf`, `git reset --hard`, `git clean`, `git branch -f`, `git update-ref`, `git gc`, or a force-push beyond what this prompt spells out, wherever you believe you are standing."
A subagent that may need to verify something in a way that could change state is sent to a disposable clone: name `dc-enter <slug>` in its prompt with a slug unique to it, and never leave the destination to the subagent.

### Phase A — initial fix

Before launching Phase A, topologically partition rebase-enabled stack entries into dependency waves.
A parent makes its dependent ready only after the parent has either cleared its complete Phase-B/fix-up review gate at its final stable local tip or qualified for the terminal zero-feedback shortcut (defined below); only then pin the dependent's rebase target to that exact parent tip and launch its wave.
Unrelated and non-rebase entries may still run concurrently, but if a required parent was skip-and-recorded during setup, fails Phase A, or is blocked at the `review-cycle` round cap, skip-and-record every affected dependent and descendant with the parent's reason rather than falling back to the original pinned target.

**Both rebase points are yours, on either side of the fix agent.**
Spawn each as its own rebaser subagent under `review-cycle` → "The delegated rebase step", with the boundaries explicit — the pinned target for a non-stacked entry — the entry's own base ref re-resolved for each point per "Re-pin a default target at each rebase point" so the pre-review point lands on the base as it stands then, or the one OID pinned at setup where the invocation named the target — and for a stacked one both the parent's new tip and its old tip, which is what makes the canonical `git rebase --no-update-refs --no-rebase-merges --onto <new parent tip> <old parent tip>` executable at all.
Per entry, in order: the **pre-fix** rebaser, whose pinned effective base you hand to the fix agent below; then that agent; then, once its packet is adopted under the hard-check, the **pre-review** rebaser, after which you update the entry's packet — final SHA to the rebased tip, effective base to the new pin — before Phase B sees it.
A halt at either point is that entry's blocker, per "A rebase that halts is one entry's blocker".

Spawn one `worker` per PR and prompt it to invoke `$address-review #N hands-off delegated-fix no-rebase` (or read the supplied absolute skill path and follow that mode), and give it the pinned effective base from the pre-fix rebaser, or the one you pinned at setup where no rebase ran for this entry, to carry in its packet.
Record both the entry's exact starting `HEAD` and its recorded PR `headRefOid`, and tell the worker to make no PR mutations and to return the complete review packet defined by `address-review` whenever the final local tip differs from either value even if no review items remain; that is a zero-item packet, not a terminal no-op.
If the worker reports that step 1's reconciliation fast-forwarded the branch, adopt its new tip as this entry's recorded starting `HEAD`.
If it reports a successful no-op because no actionable review items remain, apply the **terminal zero-feedback shortcut**: accept it without a reviewer or publisher only when `final HEAD == starting HEAD == recorded PR headRefOid`, and treat that published-tip completion as satisfying each dependent's topological gate.
The shortcut is deliberately the one path that ends an entry without its pre-review rebaser.
A rebase-changed tip or an unchanged but already ahead/diverged local tip does not qualify: it requires a complete zero-item packet, Phase B, and, unless `no-push`, the normal publication waves.
Adopt a returned packet only under `review-cycle`'s packet hard-check: `pr-branch.sh -C <worktree> check` — the helper in the sibling `address-review` skill folder, run by absolute path — must answer `clean` for that entry's worktree — an empty `git status --porcelain` **and** no Git operation in progress, since a tree left mid-rebase or mid-cherry-pick prints empty porcelain.
Either condition failing means redrive or resume that entry, never silent adoption.

### Phase B — fresh review

Spawn one fresh `explorer` Reviewer per packet-bearing PR only once that entry's fixer commits are on disk — its packet returned and adopted under the hard-check above — and, at the same moment for each entry, launch a background `claude` peer unless disabled or unavailable.
Complete every required fix-up and re-review in that wave before releasing dependents into Phase A, so an ordinary parent fix-up changes the tip that dependents are later pinned to rather than leaving already-reviewed dependents on the old tip; a parent tip changed again by a later rerun goes through **Descendant invalidation** above.
Give it the verbatim review items and proposed dispositions from that PR's packet, its **pinned** effective review base (the OID that entry's latest rebase landed on, from the packet — or, where no rebase ran for it, the effective base you pinned for it at setup by the rule above — the invocation-named target's own pinned OID on a `no-rebase` batch where the invocation named one, else the commit its `baseRefName` resolved to; never `origin/<base>` or a bare `baseRefName`), branch, and worktree path — never the fixer's reasoning.
Use `address-review` step 6's reviewer contract.
It edits nothing and reports Pass or numbered Issues.

Give the peer those same inputs verbatim, not the fixer's reasoning or the Reviewer's execution steps.
Every rule the `review-cycle` skill states under *The peer step* binds this batch whole, later additions included.
Launch from each entry's worktree; an auth/usage failure on a classify-at-first-invocation attempt makes the peer unavailable for all later entries and rounds.
Share that section's one session-local adaptive throttle across every entry and round in this batch, queue launches it holds, and surface every step-down in the batch summary.
Always wait for the Reviewer; when a peer was launched, wait for it too before deciding this entry's outcome, otherwise carry the disabled or unavailable outcome forward explicitly.
Decide each entry's round by the `review-cycle` gate, relaying findings verbatim per that skill.
Every rule that skill states under *The loop and its gates* binds this loop whole, later additions included — the no-latched-flags rule among them, for whatever an entry carries into its final summary and publication, which must describe that entry's final state rather than a condition some round latched.

### Fix-up rounds

For each failed entry, spawn a fresh `worker` fix-up agent with that PR's packet and the complete outputs verbatim as separate `Reviewer findings` and `Peer (claude) findings` blocks, omitting only a forfeited peer block.
It works only in that worktree, addresses each finding directly, runs validation, commits everything, leaves a clean worktree, and returns an updated packet.
Spawn a fresh `explorer` Reviewer and peer round only once that fix-up worker's commits are on disk, its updated packet returned and adopted under Phase A's hard-check; wait for and close the worker first.
The next Reviewer adjudicates any evidence-backed push-back on a peer claim.
A fix-up changes the packet, so Phase A's **pre-review** rebase point runs again before that reviewer: spawn its rebaser on the adopted packet and re-pin the packet from the report, exactly as after the initial fix.
The `review-cycle` round cap bounds each entry, counting every fix-up regardless of which reviewer triggered it; an entry still failing at the cap is blocked and must not publish, and every outstanding finding set is surfaced verbatim.

### Publication

Unless the run is `no-push` (local-only), spawn a fresh `worker` publisher only for an entry that cleared the `review-cycle` gate; pass its final packet, Reviewer Pass, and explicit peer outcome.
**Publish as ready.**
Launch that publisher the moment the entry's own gate passes — push, thread hygiene, Summary comment, pings — and hold nothing for a batch-level publish barrier: no entry waits on a sibling except through the stack ordering below.
For each detected rebase-enabled stack, publish parent-before-dependent as a **best-effort ordering, not a hard gate**: prefer to launch a dependent's publisher only after every parent has published successfully, refreshed as merged (content-verified below), or completed Phase A through the terminal zero-feedback shortcut, and take the blocked-parent carve-out below when a parent cannot get there at all.
Publishers for unrelated entries may still run concurrently.

**Blocked-parent carve-out.**
A parent that *cannot* publish — blocked at the `review-cycle` round cap, holding a blocker, or awaiting a maintainer decision — blocks only itself, provided it became blocked **after** its dependent's wave had already launched.
A parent blocked *before* its dependent launches still skip-and-records that dependent — Phase A is about building on a correct base, while this rule only governs getting already-reviewed work to origin — and a parent stopped by a divergent remote or an unverifiable merge is not covered either: the rules that block those block the dependent along with it, and are the more specific ones.
Descendant invalidation's revocation is **provisional** until the parent's rerun concludes: when the rerun ends in a block, the parent's new tip will never publish, so restore the dependent's last packet and review gate — the ones valid against the last parent tip that satisfied its Phase-A gate — and treat that restored gate as satisfying publisher eligibility.
The un-restacked hold is what makes the restore work — the dependent's worktree still matches that packet's final SHA, which `publish-reviewed` verifies — so do not instead re-gate the dependent by restacking it onto the blocked parent's newer un-gated tip, which would carry un-gated parent work into its PR.
Judge each held descendant on what it actually holds: one that never passed a review gate of its own has nothing to restore, and is skip-and-recorded with the parent's reason.
Publish a dependent that cleared its own gate onto the parent's existing remote tip and reply and resolve its threads normally (whether its diff renders honestly is settled separately by the honest-diff rule below).
Never publish the parent's un-gated work on the dependent's behalf, and do not merge a dependent before its parent — an ordering this skill can only state, never enforce.
None of this discourages a dependent PR that deliberately targets a feature branch rather than the default.

**An entry that will not publish still leaves its record.**
`delegated-fix` reaches neither of `address-review`'s publication steps and writes nothing to any PR, so for an entry that ends without a publisher the disposition record is **yours** to leave, from the packet you already hold: every entry of a `no-push` batch, an entry blocked at the `review-cycle` round cap or holding a blocker, and a held descendant whose parent's block leaves it unpublished.
Post it per the `address-review` skill's `disposition-record.md`, in that skill's folder beside this one, read in full first — one per PR, superseding your own prior record rather than appending a second unless the map is one you already know is incomplete, which that file posts beside the earlier record rather than over it, drafted replies and the ready-to-post Summary body verbatim, the cited tips stated as local-only.
An entry whose publisher *did* run needs nothing from you even when publication aborted: that subagent reaches step 8 and leaves the record itself, and a second one here would be the stack that rule exists to prevent.
An entry with no packet — skip-and-recorded at setup, or failed before triage — has no map to record; it belongs in the hands-off blockers instead.

**Ping only on an honest diff.**
Publishing a dependent while its parent's rebase is still unpublished leaves the dependent's PR diffed against a base ref its local history no longer descends from, so the PR shows every commit the rebase pulled in rather than the dependent's own change.
Test it against the range GitHub will actually show: list `<base-ref current remote tip>..<the tip just pushed>` and require every commit in it to be one of the dependent's **own**, defined exactly as `<the exact parent tip this dependent was pinned or restacked onto>..<the tip just pushed>`.
Take the set from that pinned tip rather than by matching commits across the restack.
Anything else in that range (a parent commit, or a commit the restack pulled in from the rebase target) means the diff is not honest.
Test the range, never tip ancestry and never patch-id presence of the parent's commits.
When the range holds anything that is not the dependent's own work, complete the push, replies, resolves, and Summary comment, but **ping no reviewer**, and say so prominently in that PR's Summary comment and in the batch report, including that the diff narrows once the parent publishes or at the pre-merge rebase onto the default branch, and that re-requesting review is then the maintainer's to trigger.
Deliver the suppression through the publisher's arguments: invoke that entry's `publish-reviewed` with `push` substituted for the run's ping tokens, since `address-review` owns pings and has no honest-diff concept of its own.
Only an explicitly named `ping-codex`/`ping-claude`/`ping-copilot` overrides the suppression — not `ping-contributing`, and not the bare default, which *resolves to* `ping-contributing`.

A parent refreshed as **merged** satisfies a dependent's ordering only when the merge actually carries the parent's final reviewed content.
Verify that the parent's final reviewed **content** is present in the refreshed base's **current tree**.
The tree is the authority, and per-commit patch-id only enumerates what to check — it never concludes on its own, in either direction.
Fail closed: an unverifiable parent counts as unsatisfied.
If the content is missing or cannot be confirmed, do not treat the parent as satisfied: block that parent, report its unpublished reviewed commits with their SHAs and what each fixed, and leave to the maintainer whether they re-land as their own PR or ride the dependent.
The batch never makes that call silently.
Immediately before that launch, re-fetch the PR and relevant refs and re-verify the same state, pair, and OID facts again.
A changed head OID goes through the **Remote-tip refresh guard** above — at this boundary an adopted fast-forward is an entry-affecting change and a rewound or genuinely divergent tip blocks the entry.
Invalidate the stale packet only when an entry-affecting fact changed: its head OID, open/merged state, head or base name, or dependency target because any parent tip changed; unrelated `baseRefOid` movement alone does not invalidate it.
When a packet is invalidated, do not launch its publisher: rerun `delegated-fix` (including the required restack when a rebase-enabled dependent's parent changed its dependency target) and the fresh review gate first, and apply **Descendant invalidation** to any parent tip that rerun changes — restoring the last valid gate instead where the rerun ends with the parent blocked.
When no parent changed the dependency target, preserve the original exact non-parent target — subject to the same carve-out: the rebase point that follows re-resolves a default one for itself.
Tell it to invoke `$address-review #N hands-off publish-reviewed <resolved push/ping tokens>` — pass the run's resolved push/ping set (a bare default batch resolves to `ping-contributing`; a `no-push` batch skips publication entirely) — except for an entry whose diff is not honest and for which no bot was named outright, where the ping tokens are replaced by `push` (see "Publication" → ping only on an honest diff).
It edits no code and returns the full final report, including per-thread dispositions, push/ping outcome, and blockers.

Do **not** give any subagent another PR's context — strict per-PR isolation.

## Adaptive throttling (width from real constraints)

Inherit `address-tasks` → "Adaptive throttling" in full (storage headroom before each fan-out, `ENOSPC` back-off, serialize shared-exclusive-resource phases, fan out less on `429`/`529`).

Effective subagent concurrency remains the number of PRs in flight at once, while each review entry also starts one peer CLI process.
Because concurrent entries each invoke the peer, repeated peer-side rate, transient usage, or capacity failures are a signal to reduce the next fan-out (and retry each affected invocation at most once), just like provider `429`/`529` pressure; a definitive auth/usage exhaustion may mark the peer unavailable without blocking own-harness review.

## Cleanup

- Remove each worktree once a PR's subagents have returned cleanly and its work is committed — but check first: `pr-branch.sh -C "$WT_BASE/<slug>" check` must answer `clean`, the same check the packet hard-check runs; only then `git worktree remove "$WT_BASE/<slug>"`.
  **Never force-remove a worktree with uncommitted changes or an in-progress Git operation** — `git worktree remove --force` destroys that work; on dirt, leave the worktree in place and report its path instead of deleting evidence or work.
  If a `wt-remove` helper is on PATH, prefer it — it enforces these refusal checks itself (even with `--force`).
  Keep the worktree of a descendant held pending its parent's situation, or blocked alongside it, even though its subagents returned cleanly and its tree is clean: the eventual restack runs there, and a carve-out publication needs a `HEAD` that still matches the packet being restored.
  The branch and commits persist in shared `.git`; on push runs, the publisher's report must state whether publication succeeded or why it did not.
- **Never delete the branch** — it is the PR's head.
  (This is the opposite of nothing-to-lose task branches: deleting it would orphan the PR.)
- **Restore the main checkout** after every entry using its starting branch is complete, including failure paths: switch back to the recorded starting branch, or `git switch --detach <starting-sha>` if the session began detached.
  Do not restore the branch between serial same-head entries or it will occupy the ref again.
  A restored branch points at its addressed local tip.
  Note the restore in the summary.
- After removing worktrees, run `git worktree prune` to clear any stale registrations left under `.git/worktrees`; it is also the fix for a stale registration blocking a re-attach mid-session.

## After the batch

The PR branches are now independently fixed and almost certainly form a **leafy stack** (diverged tips, possibly shared ancestors).
This skill intentionally stops here.
If the user wants them integrated into a linear, mergeable order, point them at **`rebase-stack`** (explicit-chain form for independent branches) or a manual rebase — that is the deliberate, separate follow-up step, not something to fold into this parallel run.

## Final summary

Aggregate the per-PR `address-review` reports into one batch summary:

- **Per entry:** its PR URL, the branch, **which ref was worked** (your local ref — and how far it diverged from `origin` — vs. the `origin` head), reviewer rounds, whether it was pushed, and whether any requested ping was posted or skipped as a no-op, plus a one-line outcome (`fixed & pushed`, `fixed, not pushed`, `skipped — <reason>`, `blocked — <reason>`).
  Call out divergence explicitly: it tells the user a push rewrote `origin` to their local state.
- **Hands-off blockers, surfaced prominently** — every item any subagent skipped for lack of an authoritative decision, gathered across all PRs so the user can act on them in one place.
- **Items orphaned by a mid-run merge** — a maintainer merging an in-scope PR while the batch is still running strands its remaining items: their files are on the merge target and the branch that carried them is gone.
  Re-derive that PR's merge state from the API rather than the batch's earlier snapshot, list the stranded items here, and point at `resolve-open-questions` → "Re-homing an orphaned finding" for picking a host PR, rebasing it onto its own base ref first, and stating provenance.
- **Push-backs** made across the batch, with their rationale.
- **No-push runs:** include each PR's per-thread disposition map (from its `address-review` report) so a later "push now" pass can replay replies/resolves precisely, and note each entry's disposition record comment — posted or superseding a prior one, per `address-review` → "The durable disposition record" — since that comment is where the map survives this session.
- **Throttling:** note whenever you ran narrower than the batch size, and why (storage-bound, rate-limited, resource-serialized).
- **Peer opinion:** note participation and grounded/discarded findings per affected entry; report a disabled/unavailable/round-forfeited peer once with its reason rather than repeating the same failure for every PR.
- **A leafy-stack note** pointing at `rebase-stack` if the user will want to integrate the branches.

## Checklist

- [ ] Stacks detected only by one entry's base name equalling another's head name; every entry rebased by default — each point spawned by the orchestrator per `review-cycle` → "The delegated rebase step", before the fix agent and again after it and after every packet-changing fix-up, each point's default target re-resolved from the PR's repository rather than reused from setup, an invocation-named target instead resolved once at setup and reused by every entry at both points, with each entry's later delegations naming its pinned effective base OID (for an entry no rebase ran for, that named target's pinned OID on a `no-rebase` batch, or the commit its `baseRefName` resolved to at setup — a prose-excluded entry the latter wherever its siblings rebased) rather than a remote-tracking name, and a halted rebase skip-and-recorded with its open question; rebase-enabled stacks ran and published parent-before-dependent on best-effort ordering with pinned exact targets; the terminal zero-feedback shortcut, **Descendant invalidation**, the blocked-parent carve-out, the honest-diff ping suppression, and the merged-parent content gate were each applied as defined; dependents of setup-skipped, Phase-A-failed, or round-cap-blocked parents were skip-and-recorded with the parent's reason rather than rebased onto the original target.
