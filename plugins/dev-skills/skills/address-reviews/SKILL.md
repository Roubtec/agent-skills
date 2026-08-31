---
name: address-reviews
description: Several pull requests or branches need their review feedback addressed at once. Trigger when the user asks to address reviews on multiple PRs or branches, fix review comments across many PRs in parallel, or run address-reviews. Fans address-review out over isolated worktrees so the PRs are fixed concurrently without cross-talk. Not for implementing task spec files (use address-tasks); for a single PR prefer address-review.
---

Address the review feedback on **several pull requests at once**, fanning each PR out into its own git worktree so they progress concurrently without polluting each other.

**Arguments:** `<PRs and/or branches> [rebase on top of <target>] [no-rebase] [no-push] [push] [peer-opinions=off] [ping-codex] [ping-claude] [ping-copilot] [ping-contributing]`

This skill is the parallel batch front-end for `address-review`.
It does **not** re-implement review-addressing — it sets up one isolated worktree per entry and uses `address-review`'s delegated fix and publish procedures, with a fresh orchestrator-owned reviewer and best-effort `codex` second opinion between them.
Each batch entry is either a **PR number** (resolve the PR head, preferring a usable same-named local branch before falling back to `origin`) or a **local branch name** (work *your* local ref, which `address-review` step 1 then reconciles against the PR head without discarding local work) — see "Resolving and checking out each entry" for the local-first rule that keeps a locally-rebased branch from being silently replaced by a stale `origin` copy.
It borrows its worktree machinery (isolation model, Session Bootstrap, adaptive throttling, cleanup) wholesale from `address-tasks` — **read that skill for the rationale behind those pieces**; only the deltas are spelled out here.

## How this differs from address-tasks

Everything here follows from one fact: **the PRs already exist**, so we modify existing branches rather than create new ones.

- **No new PR head lineage, no `gh pr create`.**
  Each worktree checks out an **existing PR head branch** (creating a local tracking branch only when needed); pushing is handled inside `address-review`.
- **No dependency waves for review addressing itself.**
  Distinct PR heads can run concurrently from the start (subject to throttling), and entries that resolve to the same head branch must still be serialized.
  The rebase path is the exception, and since rebasing is now on by default it is the ordinary case rather than an opt-in one: stacked entries follow the base-before-dependent order below.
- **Per-PR guidance comes from `address-review`, but the parallel orchestrator owns the phases.**
  A rebaser subagent puts the entry on its freshest base, a fix subagent runs `delegated-fix`, a second rebaser lands those fixes on the base as it then stands, and a separate fresh reviewer and concurrent best-effort `codex` peer check the returned packet; fix-up/re-review rounds follow as needed, each with its own pre-review rebase; only an entry that clears the review gate gets a `publish-reviewed` subagent — and gets it the moment it clears, since publication is per entry rather than a batch barrier.
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
| `no-push` | Passed through to every entry as a **local-only run**: fix and commit in each worktree, but perform no PR-side communication (no push, replies, resolves, Summary, or ping). The one PR write `address-review` documents as `no-push`'s single exception — the disposition record comment (`address-review` → "The durable disposition record") — is **yours** on this path rather than the entry's: a batch entry runs `delegated-fix`, which reaches neither of that skill's publication steps and posts no record at all, so what keeps each entry's mapping from dying with the batch is the record you leave per "An entry that will not publish still leaves its record." below. This was the default until now; it is now the explicit way to run the whole batch as a dry run. |
| `push` | Passed through to every passing entry's publisher: push the fixed branch (normal fast-forward, or an exact expected-OID lease for every other state that pushes at all) and do the PR-side communication (replies, resolves, Summary comment) — but **ping no reviewer**. Use it to publish the batch quietly, without summoning fresh review rounds. |
| `rebase on top of <target>` | Rebase every entry onto **this** target — a branch name or an exact commit — instead of onto each entry's own base ref, which is what the default rebases onto. One target for the whole batch, applied by **you** at both points like every other rebase (each entry's own invocation carries `no-rebase` regardless): it is resolved to a commit ONCE at setup as "For any rebase target…" below requires, and that one OID is what every non-stacked entry rebases onto at both of its points — a stacked dependent still goes onto its **parent's new tip**, that parent having been rebased onto this target first. `no-rebase` wins over it for the REBASE, exactly as in `address-review` — and, exactly as there, does not discard the target itself: a still-standing named target remains the pinned effective base every entry's ranges are taken against. |
| `no-rebase` | **Do not rebase** — you run neither of the two rebase points for any entry, so each branch is addressed and published on the base it already sits on. (Each entry's own `address-review` invocation carries `no-rebase` regardless, since the points are never the entry's; what this flag decides is whether *you* rebase.) It is per-invocation, not per entry; a single entry sits out only because the invocation prose said so ("rebase everything except `special/snowflake`"), which you honor as an ordinary instruction and record in the summary — no flag syntax for it. |
| `peer-opinions=off` | Disable the best-effort `codex` disposition review for the whole batch. It is on by default, including in hands-off mode. |
| `ping-codex` | Passed through: after `address-review` pushes new commits or rewritten history, post a dedicated `@codex review` comment on that PR. Implies `push`; `address-review` skips the ping when publication is an "Everything up-to-date" no-op. |
| `ping-claude` | Passed through: after `address-review` pushes new commits or rewritten history, post a dedicated `@claude review` comment on that PR. Implies `push`; `address-review` skips the ping when publication is an "Everything up-to-date" no-op. |
| `ping-copilot` | Passed through: after `address-review` pushes new commits or rewritten history, request a Copilot review on that PR via `gh pr edit <PR#> --repo <owner>/<repo> --add-reviewer @copilot`, qualified at that PR's own `<owner>/<repo>` recorded at setup (canonical CLI request, not an `@copilot review` comment — that drives Copilot's coding agent, not its reviewer). Implies `push`; `address-review` skips the request when publication is an "Everything up-to-date" no-op. |
| `ping-contributing` | **The default** — a bare batch with no push/ping argument publishes every entry and re-pings its contributing bots exactly as if this were passed, so spelling it out is redundant (kept for reference, and for combining with a named ping). Passed through: each PR's publisher re-pings a bot only if it brought a genuinely new finding **on that PR** this round (a re-raise of a concern already captured in a follow-up task or a re-argued push-back does not count unless it adds a new angle). Combined with explicit `ping-*` it filters that named set per PR; supplied alone (or as the bare default) it falls back to the known bots (codex/claude/copilot) that reviewed each PR. Implies `push`. Because the decision is made inside each `address-review`, the ping set is pruned **per PR** — a bot may keep being pinged on a PR where it is still finding issues while it has gone quiet on another. |

**Classifying each entry:** a bare integer or `#`-prefixed integer is a **PR number**; anything else (contains a `/`, letters, etc.) is a **branch name**.
A branch literally named like an integer is the one ambiguous case — name it with an explicit `refs/heads/` prefix or just pass its PR number instead.

**Local-first guarantee.**
When you supply a branch name, the worktree is checked out from **your local ref, never from `origin`** — so a branch you rebased locally while `origin` is stale is worked as it stands on disk rather than being replaced by the stale remote copy.
The guarantee is *never replaced by a stale remote*, not *never moved*: `address-review` step 1 does fast-forward a local ref that is **strictly behind** the PR head with nothing unpushed, because there is no local work to lose in that case, and it stops for a maintainer call rather than guessing when the two have genuinely diverged.
More broadly, this skill checks out `origin` for an entry **only when there is no local branch to use** (a PR number whose head branch you don't have locally).
The `git fetch origin` in Bootstrap updates **remote-tracking refs only** (`origin/*`); it never moves a local branch or changes which commits a branch-entry worktree operates on, and lease safety does not rest on it (see Bootstrap step 4).

**Always force-injected into each `address-review` invocation (not a user argument):** `hands-off`.
Every parallel subagent has no line back to the user, so its prompt must impose the equivalent unattended contract: best-effort on low-stakes choices, document and stop on high-stakes blockers.
The top-level orchestrator (you) may still consult the user for **batch-level** blockers (e.g. a PR number that resolves to nothing) when you yourself are running interactively.

**Not user-facing (orchestrator may supply at its own discretion):** the per-PR `#N` (you always pass each subagent its assigned PR).
**Rebasing is on by default**, per entry — and it is **yours to run**, at both of `address-review`'s two points, so the pinned targets and the topological order below govern every batch rather than only a requested one.
You run them because a per-entry fix agent cannot be assumed to spawn the fresh rebaser that step requires, and because the boundaries a stacked entry needs are yours anyway: you hold the parent map, you can say whether this entry belongs on its own base ref or on a parent's new tip, and only you hold that parent's OLD tip, which the `--onto` form needs and no entry can see.
Pin every target exactly as the next three paragraphs require — including re-resolving a default one at each of the two points — and see "Phase A — initial fix" for where each point runs.
`no-rebase` in an entry's own argument string therefore says the ENTRY rebases nothing rather than that the batch does not rebase.
`no-rebase` turns the default off for the whole batch, and an entry the invocation prose excluded is treated the same way.
The step itself is `review-cycle` → "The delegated rebase step": the brief, the base pinning, the parent-first `--onto` form, the hunk-level conflict rules, the clean halt, and the packet it returns are defined there, and nothing about them is restated here or in the entry's prompt.

Detect a stack only when one entry's fully qualified `(base repository, baseRefName)` pair equals another entry's `(head repository, headRefName)` pair; construct the head repository as `headRepositoryOwner.login + "/" + headRepository.name`, take the base repository from that PR's own `url` (its `<owner>/<repo>` — a PR's base always lives in the repository the PR itself is in) rather than a bare `gh repo view --json nameWithOwner`, which with no repository argument answers for whatever repository the orchestrator's directory resolves to, and never infer a stack from matching short branch names alone.
For a rebase-enabled stack, rebase the base entry first onto the pinned target, then pin the dependent's target to the exact rebased base tip — never rebase the dependent directly onto the original pinned target.

For any rebase target that is not a just-rebased parent tip, **pin it to an exact commit** rather than passing a symbolic name that a later fetch could move — and pin it out of the repository that ref actually lives in, which Bootstrap's `git fetch origin` does not reach.
`origin` is whatever this clone calls its own remote, and in a fork clone that is the HEAD repository, while a PR's base always lives in the repository the PR itself is in: `git rev-parse origin/<baseRefName>` there names a same-named branch in the fork — a different branch's tip, which pins and rebases onto the wrong history, or nothing at all, which stops an otherwise valid entry.
Which repository that is, is the `<owner>/<repo>` of the PR's own `url`, an explicit repository-qualified value you already record per entry; never re-derive it from a bare `gh repo view --json nameWithOwner`, which answers for whatever repository the orchestrator's directory resolves to — in a fork clone the very head fork this sentence rules out.
So per entry: `git fetch <the remote whose URL is that repository, or that repository's URL where no remote points at it> refs/heads/<baseRefName>`, moving no branch, then `git rev-parse --verify FETCH_HEAD^{commit}` read immediately after that fetch (the next one overwrites `FETCH_HEAD`), and pin the full OID it prints.
Select that remote by matching its URL every time; `isCrossRepository` cannot short-circuit the match, because it compares the PR's own head and base and says nothing about what THIS clone calls `origin` — a fork clone addressing a PR whose head and base both live upstream reads `false` while `origin` is still the fork, so taking the short-circuit fetches the fork's same-named base and rebases the entry onto the wrong history.
That fetch is the **default** target's — the entry's own `baseRefName`, the one ref whose repository the PR names — and a target the invocation itself named is not resolved there at all, because whose ref it is decides where it lives.
An exact commit needs no fetch, but it is still resolved once here, `git rev-parse --verify '<it>^{commit}'`, which proves it names an existing commit and prints the full OID to pin: carrying the string as typed would send an abbreviation, or a plain typo, out to every entry's rebaser to be discovered once per entry instead of stopping the batch once, here.
A ref name (`rebase on top of release`) is resolved WHERE IT WAS NAMED — here, in your own checkout — with `git rev-parse --verify '<the target>^{commit}'`, the operand quoted as ONE argument because a legal ref name may carry `$`, backticks or `;`, and an unquoted `$`-fragment can silently resolve some other existing ref instead; that resolution takes a local branch, a remote-tracking ref or a commit, and the full OID it prints is what you pin.
Fetch nothing for it, and never send it at the base repository as `refs/heads/<it>` — `git fetch <repository> <refspec>` reads that refspec THERE, and an explicitly named target is routinely a local branch or one in the head fork, so that fetch pins an unrelated same-named branch upstream or fails outright on a target that was on disk all along.
Letting a named ref fall through to the `<baseRefName>` fetch above is the one outcome this clause exists to forbid: the request named `release`, every entry would pin and rebase onto its own default base instead, and the batch would review and force-push branches the request never asked to move — so where an invocation-named target does not resolve — a ref or a commit alike — stop the batch and report what you tried rather than substituting anything.
Either way the invocation-named target is resolved ONCE, here at setup and in your own checkout — after Bootstrap's `git fetch origin`, since the resolution takes a remote-tracking ref too and before that fetch one names a staler commit than the request meant — and that single OID serves every rebase-enabled entry at both of its points — overridden only for a stacked dependent, whose parent tip wins by the paragraph above.
If a parent PR merges during the batch, resolve the refreshed branch containing that merge once to an exact commit at that refresh and reuse the pinned SHA for every affected dependent.
Restacking each **rebase-enabled** dependent onto that commit is mandatory because the merge may rewrite the parent's commit SHAs; rely on patch-id dropping, then verify the dependent's diff no longer contains parent content and rerun its review gate before publication.
A dependent for which rebase remained disabled has no restack obligation.

**Re-pin a default target at each rebase point.**
It is the DEFAULT target this governs, and only it — the entry's own base ref; the other two kinds are resolved once and reused, per the sentences after this one.
Pinning freezes that target so a later fetch cannot move it under a delegation already dispatched against it, but it does not freeze it across the two points: the pre-review point exists precisely to land an entry's fixes on the base as it stands *then*, so handing both points the one OID pinned at setup makes that second point a no-op over a base that has since moved, and leaves Phase B reviewing a tree that is not on the freshest base — the drift this default was added to remove.
So resolve the entry's own base ref afresh by the fetch above, immediately before each point, and pin what it names now.
A target the invocation itself named — a commit, or a ref resolved to one at setup by the rule above — is the batch's single pinned base by construction: the maintainer named it deliberately rather than as the thing to chase, and re-resolving it per point per entry would land concurrent entries wherever that ref happened to stand when each of them got there.
A parent tip is that parent's post-rebase tip by construction and is already the freshest thing there is.
That the second point then normally finds nothing to do for a named target is intended, not the drift this rule removes: what the rule chases is a base ref moving under the run, and a named target is not moving.
Normally rather than always, and the point runs either way — a pure-join merge still in range is flattened by the replay, moving the tip over an unmoved base — so a no-op is what that point may REPORT, never a reason for you not to spawn it.
It is also the one place the batch's TARGET PINNING deliberately parts from the single-PR pipeline, whose two points re-resolve even a named target because there is one entry there and so nothing to hold comparable.

**"Rebase-enabled" is now every entry** — the phrase survives in the rules below because `no-rebase`, or an entry the invocation prose excluded, still turns rebasing off, and those entries keep their exemption from every restack obligation.
The **parent map** those orderings are computed from is the per-entry data you already record — the fully qualified head/base pairs and both OIDs, from one `gh pr view --json number,state,url,headRefName,headRefOid,headRepository,headRepositoryOwner,baseRefName,baseRefOid` per entry, whose `url` is where the base repository is read from — extended with each parent's **pre- and post-rebase tips** as its rebase completes, because that pair is exactly what restacks its children (`git rebase --no-update-refs --no-rebase-merges --onto <new parent tip> <old parent tip>`).
That is the whole of the stack bookkeeping this skill does; a chain that genuinely needs a whole-chain restack is `rebase-stack`'s after the batch, and reimplementing it here is the thing to resist.
Each entry's **pinned effective base** — the OID its rebase actually landed on, read from the delegated step's packet — is what that entry's later delegations name as `<effective base>..HEAD`: Phase B's review base, and any range a fix-up round is handed.
Where no rebase ran for an entry at all — a `no-rebase` batch, or an entry the invocation prose excluded — pin its effective base ONCE at setup, beside the target pinning above: on a `no-rebase` batch, the invocation-named target's own pinned OID where the invocation named one, since `no-rebase` suppresses the rebase without discarding the token, and that entry's `baseRefName` resolved to a commit otherwise — including for an entry the prose excluded while its siblings rebased, since excluding it is the statement that THAT branch stays on its own base, and bounding its ranges at a target it was deliberately not moved onto is the same wrong-boundary harm by the other road.
Bounding a named-target run's ranges at `baseRefName` instead would hand every Reviewer and peer the underlying branch's own commits as this PR's diff, which is why the single-PR skill keeps the token here too: nothing about the boundary rule relaxes because rebasing is off, and the entry cannot fall back on `address-review` step 6's own resolution of it, since `delegated-fix` stops before step 6. Never re-derive it afterwards from `origin/<base>` or the entry's `baseRefName`: a sibling entry's push or the next fetch moves those, and a range against one then bounds the reviewer's diff at a tip this branch was never rebased onto — unrelated commits, or no boundary at all, while the branch under review still sits where it did.
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
Across distinct PR head branches, same-phase agents may run concurrently.
See `address-tasks` → "Why worktrees change the rules" and "Durability & host isolation" for the full model.
The durability rule here is **commit early, but do not push before `address-review`'s reviewed publication step**: committed objects and branch refs survive in the shared `.git`, while premature pushes would publish unreviewed fixes and break no-push runs.

## Session Bootstrap (run once, in the main working tree, before any worktree)

Follows `address-tasks` → "Session Bootstrap" — see that skill's Bootstrap for the fuller rationale.
In brief, all idempotent:

1. **Prepare the worktree base and prune stale state.**
   Pick or create a base directory for worktrees — `<repo>/.worktrees/` inside the repo, or a directory outside the repo.
   An in-repo base is `.worktrees/` or a path beneath it — the `wt-bootstrap` helper this bootstrap prefers reports `<repo>/.worktrees/$CONTAINER_NAME`, which is one — and nothing else: the ignore recipe that follows probes and appends exactly `/.worktrees/`, a root-anchored directory rule Git applies to everything beneath it, so a base under that name is carried by the very same append while one ANYWHERE ELSE in the repo would pass the re-probe while staying unignored.
   A base inside the repo has to BE ignored, and only this run makes it so: `git worktree add` excludes nothing on its own, so probe it with `git check-ignore -q "<repo>/.worktrees/"` — with the TRAILING SLASH, since `/.worktrees/` is a directory-only rule and `check-ignore` answers NO for a bare `.worktrees` that does not exist on disk yet, which is every first run — and, where it answers no, append `/.worktrees/` to the file `git rev-parse --git-path info/exclude` names — run it from inside `<repo>`, because in a primary checkout it answers with the RELATIVE `.git/info/exclude` (only a linked worktree gets an absolute path), so a `git -C <repo>` form whose answer you then append to from your own directory writes the rule to a file `check-ignore` never reads — then re-probe and make a still-no answer a blocker.
   Ask Git for that path rather than writing a literal `.git/info/exclude`: THIS checkout may itself be a linked worktree, where `.git` is a gitfile and `.git/info` is not a directory at all, so the literal append fails outright and the protection is never established — while `--git-path` resolves to the shared exclude file that `check-ignore` actually reads, in a linked worktree and a primary checkout alike.
   It is the repo-local ignore file, untracked and so dirtying nothing itself, and NOT the tracked `.gitignore` — editing that would dirty the main checkout, which would later block freeing a batch branch it occupies.
   Run `git worktree prune` to clear stale registrations, and remove any orphaned directories under the base that `git worktree list` no longer knows about.
   Then probe remote access with `git ls-remote origin`.
   **Stricter than the task batch:** here a failed remote probe is a stop — PR-number resolution and lease-safe publication cannot be trusted from stale refs.
   The chosen base is the `$WT_BASE` used below.
   If a `wt-bootstrap` helper is on PATH, prefer it — it performs these checks and prints the base dir as JSON.
   It establishes no ignore rule, though: an in-repo base is still yours to make ignored by the recipe above, and the helper reports `ok` whether or not that rule exists.
2. **Confirm GitHub API access.**
   `gh auth status` must succeed for every run because each subagent must read review threads (the `git ls-remote` probe checks git remote access, not the API).
3. **Preflight the peer once for the batch, unless `peer-opinions=off`,** in this main working tree, per the `review-cycle` skill's peer preflight.
   Never repeat the probe inside entries.
   Unavailability does not block the batch; retain its reason for one final-summary note.
4. **`git fetch origin`** to refresh remote-tracking refs.
   This updates `origin/*` only — it never moves a local branch or rewrites a worktree — so it is safe for branch entries (which work the local ref regardless) and keeps `origin/*` roughly current for orientation.
   Lease safety does **not** rest on it: the expected-OID lease is taken against the head ref that `address-review` re-fetches exactly at the publication boundary, which is what makes the comparison sound even when this ref has since gone stale.
   It does **not** license branching a PR-number entry from `origin/<headRefName>`: one fetch at Bootstrap can leave that ref stale in either direction by the time the entry is resolved, so an entry whose head you lack locally fetches the exact head ref itself and branches at the recorded `headRefOid` (see "PR-number entry").
5. **Record the main checkout's starting checkout mode:** current branch (which may be empty when detached) and `HEAD` SHA.
   A branch can be checked out in only one place at a time, so any entry branch the **main checkout currently occupies** must be freed before its worktree is created.
   The orchestrator does this on demand by detaching the main `HEAD` (see "Resolving and checking out each entry"), which needs the main tree clean.
   Restore the original branch after all entries using it are finished, or the original detached SHA if the session began detached.
   Starting from a branch outside the batch (usually `main`) avoids this dance.

## Orchestrator responsibilities

You are the orchestrator.
You do **not** edit the PR branches yourself; delegated fixers and publishers follow `address-review`, while you own worktree setup, fresh reviewer phases, and result aggregation.
Your job:

1. Parse the batch into a list of entries, classifying each as a PR number or a branch name (see Arguments); capture the pass-through flag set.
2. Run the **Session Bootstrap**.
3. **Pin this batch's rebase target**, where the invocation named one, per "For any rebase target…" — once, here, after Bootstrap's fetch and before any entry launches, since every entry's two points and every no-rebase effective base are taken against that one OID.
4. Resolve every entry to a `(local-or-origin branch, PR number)` pair before creating worktrees.
   De-duplicate aliases for the same PR (for example `#38` plus its branch name), and group different PRs that share one head branch so they run serially rather than contending for the same ref.
5. **Create one worktree per distinct head branch in the current sub-batch** (see next section).
   Create a later same-head entry's worktree only after the earlier entry is complete and removed.
   Skip-and-record any entry that cannot be set up (closed/merged or PR-less, branch checked out elsewhere, unsupported fork branch entry).
6. Run the per-PR **fix → review → fix-up** loop, bounded by the `review-cycle` round cap, in topological waves for rebase-enabled stacks, with unrelated entries advancing concurrently (see "Per-PR phased subagents": the parent gate, **Descendant invalidation**, and the **Remote-tip refresh guard**).
7. For each entry that passes, spawn its `publish-reviewed` subagent the moment its own gate passes — parent-before-dependent on a best-effort basis, concurrently for unrelated entries, never held for the batch — under the "Publication" rules (the blocked-parent carve-out, honest-diff ping suppression, and merged-parent content gate).
   If the run is `no-push` (local-only), skip publication and keep each entry's disposition map for a later push — then leave that map on each entry's PR **yourself**, per "An entry that will not publish still leaves its record.", so the batch summary is not the only copy.
   No entry does it for you: the `delegated-fix` run each one made posts no disposition record.
8. **Clean up** each worktree once its subagents return (never delete the PR branch).
9. **Aggregate** every per-PR report into one batch summary, surfacing the hands-off blockers prominently.

## Resolving and checking out each entry

This is the part that differs most from the task-file skills: you check out a branch that **already exists** (your local ref, or `origin`'s, occasionally a fork's) rather than creating one.
Each entry resolves to a `(branch-to-check-out, PR-number)` pair; the pair drives the worktree and the subagent.

Shared setup, from the main tree: `$WT_BASE` is the worktree base dir chosen in Bootstrap, and `$ROOT` the repo root.
**Every** attach below reads `git worktree list` for an existing entry at `$WT_BASE/<slug>` FIRST — the plain form and the explicit commands alike, forks included, since they all add at that one path and a stable slug is precisely what a halted run leaves registered there: if the target directory already exists, verify it has the right branch checked out and reuse it; a wrong branch or an occupied ref means stop and report that entry, never guess.
For the **plain attach cases** below the standard form is then `git worktree add "$WT_BASE/<slug>" <branch>`.
If a `wt-enter <slug> <branch>` helper is on PATH, prefer it — it encodes exactly these checks (rerun-safe attach under `$WT_BASE`, refusing rather than guessing on wrong-branch or occupied-ref conflicts).
The cases the plain attach does not cover (detaching the main checkout, tracking `origin`, forks) keep their explicit commands, under that same registration read.
These calls are safe to run while other entries' subagents are active — they touch only their own worktrees and the lock-protected refs.
Use a stable, collision-free slug per entry (e.g. `pr-<N>` or a sanitized branch name).

### Branch entry — work your local ref

The local-control path (the rebased-locally / stale-origin case).
Normalize an explicit `refs/heads/<name>` input to the bare `<name>`, then require `git show-ref --verify "refs/heads/<name>"` before doing anything else; skip if it is not a local branch.
The bare local branch name must equal the PR's `headRefName` (which is the norm: a local rebase keeps the branch name).
If your local copy has a different name than the PR head, this auto-pairing cannot see it; use that PR's number with `address-review` directly, or rename to match.

1. **Pair to the PR by head:** `gh pr list --head <branch> --state open --json number,url,headRefName,headRefOid,headRepository,headRepositoryOwner,baseRefName,baseRefOid`; for the one match, take the fully qualified base repository from that PR's own `url` — the `<owner>/<repo>` it names, already in the `--json` list above — and not from a bare `gh repo view --json nameWithOwner`, which answers for whatever repository the orchestrator's directory resolves to; then record the same fully qualified head/base pairs and OIDs used by stack detection.
   - Exactly one open PR → that's the pairing.
   - Zero → skip-and-record: with no PR there are no review threads to address.
   - More than one → skip-and-record as ambiguous (or, interactive, ask which).
   - If the PR head is a fork, skip-and-record this branch-form entry and tell the user to pass the PR number instead; the `origin/<branch>` upstream used below is valid only for same-repository heads.
2. **Check out the verified local ref as-is** — never a reset that discards local commits.
   `address-review`'s step 1 then reconciles that ref against the PR head by ancestry: it fast-forwards only a strictly-behind branch, keeps the local tip whenever the PR head is represented in it by patch-id, and stops for a maintainer call on genuine divergence.
   The checkout below never pre-empts that decision:
   - Not checked out anywhere → the plain attach: `git worktree add "$WT_BASE/<slug>" <branch>`.
   - Occupied by the **main checkout** (it's the orchestrator's current branch) → free it by detaching the main `HEAD` (`git -C "$ROOT" switch --detach`) **when the main tree is clean**, then attach it with the plain attach; the starting checkout mode recorded in Bootstrap is restored in Cleanup.
     If the main tree is *dirty*, skip-and-record (commit/stash or move the main checkout off it first).
     If setup fails after detaching and no later entry needs that branch free, restore immediately before continuing.
   - Occupied by **another worktree** (a sibling entry, or the same branch listed twice) → skip-and-record; a branch can't live in two worktrees.
3. **Set the push target:** `git -C "$WT_BASE/<slug>" branch --set-upstream-to=origin/<branch>` (origin's head ref for the paired same-repository PR, refreshed by Bootstrap's fetch).
   `address-review` still verifies the exact PR head and uses an expected-OID lease before any rewrite.
   Best-effort here too, for the reason given under "PR-number entry".

### PR-number entry — work the PR head

The canonical path.
Resolve the PR, then prefer a same-named local branch if you have one (so we still never bypass your local copy), else create the branch at the PR's **recorded exact `headRefOid`** — not at `origin/<headRefName>`, which Bootstrap's single fetch can leave stale in either direction.
Both same-repo paths (step 2) fetch that exact head ref first, and a fetch brings whatever the ref names *now* — not necessarily the OID `gh pr view` just reported — so take a same-repo entry's head from what that fetch brought, `git rev-parse FETCH_HEAD`, and classify the pair by ancestry before letting the fetched OID be the `headRefOid` recorded for its steps below.
**A fetched-behind-reported head is a rewind, not an advance:** when both commits are available and the fetched OID is a proper ancestor of the `headRefOid` that `gh pr view` reported, block the entry for a maintainer decision without adopting the fetched OID.
Every other difference keeps the existing adoption rule: adopt the fetched OID as this entry's head and continue, including an advance and a force-push whose reported OID was not downloaded — creating the entry's branch at that OID on the path that creates one, and moving nothing on the path where a usable local `<headRefName>` already exists, which `address-review` step 1 reconciles against this head instead.
Whether the reported OID is already a local object decides no other outcome: an advance arrives with this very fetch, so the OID is perfectly readable and an existence check on it passes while the entry's branch is created at a tip origin has moved past; a force-push is the same event with the reported OID merely undownloaded.
Read `FETCH_HEAD` in the tree that fetched it — the main tree, where both same-repo paths' fetches and every `git worktree add` run — and before any later fetch overwrites it, since git keeps a separate `FETCH_HEAD` per worktree.
Besides that rewind block, skip-and-record only if the head keeps moving under you.
A fork entry (step 3) has no such head-ref fetch of its own — its only fetch is the `gh pr checkout` run inside its worktree — so there is nothing of its own to read here: the main tree's `FETCH_HEAD` answers for whatever last fetched there, which after Bootstrap's bare `git fetch origin` from a main tree standing on `main` is `origin/main`'s tip, an unrelated commit.
So a fork entry keeps the OID `gh pr view` reported, which step 3 needs as an independently obtained head that the branch it landed on must carry — checking it against `gh`'s own fetch would only confirm `gh` to itself — and leaves that worktree's head to `address-review` step 1's reconciliation there, which fetches the exact head ref in that tree and reads it the same way.

1. **Resolve and sanity-check:** `gh pr view N --json number,state,headRefName,headRefOid,headRepository,headRepositoryOwner,baseRefName,baseRefOid,url,title`.
   If `state` is not `OPEN`, skip-and-record.
   Record the fully qualified head repository/ref, record the fully qualified base repository as the `<owner>/<repo>` of the PR's own `url` — requested above, and a PR's base always lives in the repository the PR itself is in — and not from a bare `gh repo view --json nameWithOwner`, which answers for whatever repository the orchestrator's directory resolves to; record both OIDs; note whether `headRepositoryOwner` matches `origin`'s owner (same-repo) or differs (fork).
2. **Same-repo:**
   - If local `<headRefName>` exists, compare it with the PR's **exact recorded `headRefOid`**, fetching that exact head ref first rather than trusting `origin/<headRefName>` — Bootstrap's `git fetch` runs once, so a PR force-updated since then leaves the remote-tracking ref stale while `headRefOid` is current.
     Do this **before** considering checkout occupancy.
     Then let `address-review` step 1's reconciliation decide: check out a strictly-behind or represented branch and let it run — skipping those here would make an identical repository state succeed as a branch entry and fail as a PR-number entry — and skip-and-record only genuine divergence in step 1's exact sense (each side holds commits the other lacks **and** the remote's are not represented in the local tip by patch-id, the qualifier that keeps an ordinary locally-rebased branch workable).
   - A usable local `<headRefName>` that is free → the plain attach (`git worktree add "$WT_BASE/pr-<N>" <headRefName>`) and **record any ahead/diverged state** in the summary.
   - A usable local `<headRefName>` occupied by the main checkout → detach the clean main `HEAD` and add the worktree as in the Branch-entry case; if held by another worktree or the main tree is dirty, skip-and-record.
   - No local `<headRefName>` → create the branch at the **recorded exact `headRefOid`**, not at `origin/<headRefName>`: `git fetch origin refs/heads/<headRefName>`, then `git worktree add -b <headRefName> "$WT_BASE/pr-<N>" <headRefOid>`, then set tracking separately with `git -C "$WT_BASE/pr-<N>" branch --set-upstream-to=origin/<headRefName>` — best-effort: a clone whose fetch refspec does not cover this branch has no `origin/<headRefName>` to track, so record the failure and continue rather than losing an otherwise valid entry; publication resolves the exact push remote and ref itself instead of reading the upstream.
     Branching at a stale remote-tracking ref that is a *descendant* of the current head (a maintainer force-pushed to drop a commit after Bootstrap's one fetch) would carry the dropped commit forward: step 1 reads the recorded head as an ancestor and keeps the local tip, and publication then restores the dropped commit to origin through an **ordinary** push — no lease, no boundary re-verify, because the recorded head OID never moved.
3. **Fork PR** — after the shared setup's registration read, which covers this case too (a live `pr-<N>` a halted run left is reused or reported there, never added over), let `gh` wire up the fork remote and tracking inside a detached worktree:

   ```bash
   git worktree add --detach "$WT_BASE/pr-<N>"
   ( cd -- "${WT_BASE:?Session Bootstrap step 1 set no worktree base — prepare one there before attaching}/pr-<N>" && gh pr checkout N )
   ```

   Then **verify for yourself what you landed on**, rather than resting on `gh`'s refusal to clobber: `--detach` does not stop `gh pr checkout` selecting a same-named local branch, and unrelated history is caught there only by luck — without `-f`, `gh` never resets an existing local branch, so the fetch or the `--ff-only` merge refuses it, which is a side effect of gh declining to clobber rather than a check this recipe performs, and it leaves the worktree wherever the failure stopped it (still detached where the fetch failed, standing on the rejected ref where the merge did) instead of on the PR head.
   So require both, in the worktree: `git -C "$WT_BASE/pr-<N>" branch --show-current` names a branch (the success path must end on a durable local one — see below), and that branch **carries the recorded `headRefOid`** in step 1's exact sense (an ancestor of `HEAD`, or every commit unique to it represented by patch-id), which admits the ordinary locally-ahead or locally-rebased copy `gh` fast-forwarded onto and refuses unrelated history.
   On a mismatch — a HEAD that does not carry the PR head, a failed `gh pr checkout`, or a detached HEAD left standing — attach nothing further and substitute nothing: report the collision (the rejected local ref, the verified PR head, and what each points at) and ask the maintainer how to proceed; hands-off, skip-and-record the entry with that report.
   Give that worktree back as part of the report — `wt-remove pr-<N>` where the helper is on PATH, else `git worktree remove "$WT_BASE/pr-<N>"`, whose path argument is required and is the path to report if it refuses — so the failed attempt does not sit on the rejected ref and block this slug when the entry is rerun; neither is a force, though their refusals are not the same — `wt-remove` refuses a dirty tree and one with a Git operation in progress, the operations that leave `git status` clean included, while plain `git worktree remove` refuses the dirty tree and is blind to that mid-operation state — and either way a tree the command declines to remove is named with its path beside the collision instead.
   Nothing rides on that gap here (this tree was created seconds earlier and had only `gh pr checkout` run in it), so do not grow a guard for it.
   Do **not** harden this by staying detached instead: commits on a detached HEAD are reachable from nothing once the worktree is reclaimed, so that would trade a wrong branch for no branch.
   (`address-review` → "Working location" argues once why the run stops here rather than picking a branch itself.)
   `gh pr checkout` also works for same-repo PRs, so it is a fine uniform fallback whenever the explicit `git worktree add` path is awkward.

The absolute worktree path, the checked-out branch name, the **paired PR number**, and (for branch entries) the note "this is your local ref" are what you hand that entry's subagent.

## Per-PR phased subagents

Claude subagents cannot be assumed to spawn their own subagents, so the top-level orchestrator owns every phase, including both rebase points, peer launch and triage.
For each reviewer round, fan out one same-phase `general-purpose` `Agent` per distinct worktree concurrently and, when enabled and available, launch that entry's peer beside it; wait for each entry's own Reviewer and its launched peer, recording disabled, unavailable, or forfeited peer outcomes explicitly, then advance **that entry** — to its fix-up round or, per "Publication", its publisher — the moment its own outcomes are in.
The phase is per entry, not a batch barrier: an entry never waits for a sibling's reviewer, and the only waits between entries are the stack dependencies "Publication" and the parent gate name.

At every apply boundary — immediately before Phase A, each later dependency-wave launch, and each fix-up — re-fetch each affected PR's current state and relevant remote refs, then re-verify its open/merged state, fully qualified head/base pairs, and OIDs.
Recompute stack ordering from those refreshed facts, but preserve the original non-parent target the invocation named, in either of its flavors — the commit it gave, or the OID a ref it named was resolved to once at setup: what this holds stable is the pin against a recomputation, and for a named target it is held across the run's own rebase points too, only a DEFAULT target being re-resolved there per "Re-pin a default target at each rebase point".

**Descendant invalidation.**
Whenever an established parent tip changes for any reason — not only a rebase or merge — invalidate every existing packet and review gate for its rebase-enabled descendants, but **hold** them un-restacked until the parent's situation resolves.
Once it does, pin each direct child to the parent's exact settled tip (for a newly merged parent: the refreshed branch containing the merge, resolved to one exact commit at that boundary and reused for every affected direct dependent), rerun `delegated-fix` with the required restack, rerun its fresh review gate, and cascade the same invalidation down the chain before any descendant can publish.
Restacking earlier, onto a tip the parent has not re-gated, builds the descendant on work that may never survive and strands its worktree away from the packet it may need to fall back on — which matters because the revocation is provisional: where the parent resolves to a block rather than a new gated tip, the blocked-parent carve-out under "Publication" restores that descendant's last valid gate instead.
**Remote-tip refresh guard** — the one rule for any head movement observed after an entry's cycle has recorded its remote head OID; every later refresh, including the publication boundary, applies it.
Fetch the newly observed exact head tip without moving the local branch and classify it against local `HEAD` before adopting it as a new expected lease or continuing the cycle.
A tip that is an **ancestor** of local `HEAD` is the ordinary case — adopt it as the new expected lease, unless it is also behind the OID this cycle already recorded: that is a maintainer rewinding the head, and adopting it would let the publisher fast-forward the dropped commits straight back onto origin, so block it for a maintainer decision.
A tip that local `HEAD` is an ancestor of is a plain remote fast-forward, not divergence — taking it loses nothing.
Before Phase A, where no cycle has recorded a head yet, use the `headRefOid` that `gh pr view` reported at setup as the earlier observation: if the fetched tip is a proper ancestor of that available reported OID, block the entry for the same maintainer decision rather than recording it as replaceable.
Every other setup difference keeps the existing non-blocking behavior: re-record the fetched tip as this entry's PR head, let `address-review` step 1 reconcile the branch, and do not block (there is no packet yet to invalidate); this includes a head which advanced during setup and an unavailable reported OID in the undownloaded-force-push case.
At any later boundary take a plain remote fast-forward as an entry-affecting change — reviewed content moved under the packet, so invalidate the packet and rerun `delegated-fix`, the full fresh review gate, and Descendant invalidation before publication.
Only a genuinely divergent tip — each side holding commits the other lacks — blocks the entry and its rebase-enabled descendants; never publish, force-push, or record that OID as replaceable, and the hands-off batch never guesses the reconciliation — only an explicit reconciliation incorporating the remote tip, followed by `delegated-fix`, the full review gate, and Descendant invalidation, may resume the entry.
Do not extend step 1's patch-id qualifier to this guard: step 1 reconciles a local ref the maintainer prepared against the head recorded at setup, while this guard reacts to the head moving *during* the run, where an unexpected concurrent push deserves a maintainer call even when its commits are already represented locally by patch-id.

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
  The three-way wording matters: a bare "otherwise keep it as it stands" reads as licence to keep a genuinely divergent tip and then force-push over the remote-only commits, which is the one case step 1 refuses to decide.
- **Skill:** pass the installed `address-review` skill (invoke it by name, or pass its installed SKILL.md path); do not make the subagent search across sibling worktrees.
- **Repo context:** "Read `AGENTS.md` / `CLAUDE.md` first for conventions."
- **Validation in a worktree:** "If verifying fixes needs a build, install dependencies in this worktree first — cheap when the package manager's store hardlinks (e.g. pnpm on the same filesystem).
  Point Playwright at a system Chromium if your environment provides one.
  App-server / `next build` e2e may not run from a nested worktree path; defer it per `address-tasks`'s app-server caveat and note that in your report rather than forcing it.
  Any output that must land in a file goes inside this worktree (a gitignored path, removed before any commit), never a shared scratchpad filename — two concurrent entries both redirecting to `<scratchpad>/verify.log` once crossed results between worktrees."
- **No shared task-tracker:** "Do not use the `TaskCreate`/`TaskUpdate`/`TaskList` tools — their entries leak into the orchestrator's view."
- **The `review-cycle` contract for the role, whole:** brief each agent under that skill's contract for what it is — Fixer, Reviewer, or Peer — every rule that skill states for the role binding here, later additions included, rather than importing named rules one at a time.
  That is where the lifecycle rule lives, and this batch is exactly where it was broken: nothing resumes a subagent, so it must never end its turn waiting for a notification, a callback, or a child it launched; it bounds, waits on, and reaps anything it starts before returning its packet; and a fix agent launches no peer review of its own, the peer beside the Reviewer being the sanctioned second opinion.

### Diagnosis discipline

A subagent's environment or infrastructure diagnosis is a **hypothesis, not a finding**.
Verify it against **observable state** — the reflog, the refs, the working tree, file contents, the output of a command you run yourself — before propagating any mitigation into sibling prompts: that observes the effect rather than the claim.
A bounded grep of that subagent's own transcript is a fallback, and only where the harness exposes a greppable one — some hand back the transcript path with an instruction not to read or tail it, because it is full JSONL that will overflow your context.
A scratch-filename collision was once misdiagnosed as a working-directory bug, and the wrong mitigation rode into roughly ten later subagent prompts before anyone checked.

### Subagent destroy boundary

State this in every subagent prompt this skill composes.
A reviewer subagent authorized to verify a claim empirically once ran `rm -rf ./*` in a shared main checkout: its setup `git clone … | tail` had failed invisibly under `set -e` (a pipeline's status is its last command), so it deleted tracked files and moved a branch ref while believing it stood inside a clone.

- **Permitted:** reading, searching, and read-only `git`/`gh` queries — plus, for a fixer or implementer, edits, commits, and pushes confined to its own assigned worktree and branch.
- **Forbidden, named outright:** `rm -rf`, `git reset --hard`, `git clean`, `git branch -f`, `git update-ref`, `git gc`, and force-pushing — each of them beyond what the prompt itself spells out, whether as an exact command or as a skill it names to invoke.
  A subagent may not self-authorize one by putting itself somewhere it believes is safe — forbidden **not in a clone, not in a temp directory, not "safely"**.
  What you spelled out, and the disposable location below, are the only exemptions — and only because you named them.
- **A worktree is not a blast radius.**
  It isolates the working tree, not the repository: `branch -f`, `reset`, `update-ref`, and `gc` all reach every sibling worktree through the shared `.git`.
- **Any repository other than the subagent's own checkout is addressed by path.**
  `git -C <absolute path>`: never derive a working directory from a glob, and never chain a state-changing git command after a `cd` whose success you have not checked.
  A fix-up subagent ran `cd "$(ls -d <scratchpad>/tmp.*)" ; git commit …` where concurrent siblings had created scratch directories of their own — the glob expanded to three paths, the `cd` failed, and the `;`-chained commands landed in the shared main checkout, putting a commit on `main`.
- **Empirical verification that could change state goes where you send it.**
  Send the subagent to `DC="$(dc-enter <slug>)"` — one absolute path on stdout, dropped again with `dc-remove <slug>`; a reused slug is refused rather than re-derived, so anything that may run twice passes `--replace` or removes the slug first.
  Where that command is not found at all, install the helpers from the dev-skills plugin `bin/` rather than improvising a destination.
  Never leave the choice to the subagent.
  Give it the guarded `cd` too: `cd ""` returns 0 and moves nowhere, so checking the status catches nothing and a failed lookup leaves the subagent in the shared checkout — the form is `cd -- "${DC:?dc-enter returned no path — see its error above; if it is not installed, install it from the dev-skills plugin bin/}"`, with `pwd` confirmed before the first command that writes.

### Phase A — initial fix

Before launching Phase A, topologically partition rebase-enabled stack entries into dependency waves.
A parent makes its dependent ready only after the parent has either cleared its complete Phase-B/fix-up review gate at its final stable local tip or qualified for the terminal zero-feedback shortcut (defined below); only then pin the dependent's rebase target to that exact parent tip and launch its wave.
Unrelated and non-rebase entries may still run concurrently, but if a required parent was skip-and-recorded during setup, fails Phase A, or is blocked at the `review-cycle` round cap, skip-and-record every affected dependent and descendant with the parent's reason rather than falling back to the original pinned target.

**Both rebase points are yours, on either side of the fix agent.**
Spawn each as its own rebaser subagent under `review-cycle` → "The delegated rebase step", with the boundaries explicit — the pinned target for a non-stacked entry — the entry's own base ref re-resolved for each point per "Re-pin a default target at each rebase point" so the pre-review point lands on the base as it stands then, or the one OID pinned at setup where the invocation named the target — and for a stacked one both the parent's new tip and its old tip, which is what makes the canonical `git rebase --no-update-refs --no-rebase-merges --onto <new parent tip> <old parent tip>` executable at all.
Per entry, in order: the **pre-fix** rebaser, whose pinned effective base you hand to the fix agent below; then that agent; then, once its packet is adopted under the hard-check, the **pre-review** rebaser, after which you update the entry's packet — final SHA to the rebased tip, effective base to the new pin — before Phase B sees it.
A halt at either point is that entry's blocker, per "A rebase that halts is one entry's blocker".

Prompt one agent per PR to invoke the `address-review` skill with arguments `#N hands-off delegated-fix no-rebase` (or read the supplied absolute skill path and follow that mode), and give it the pinned effective base from the pre-fix rebaser, or the one you pinned at setup where no rebase ran for this entry, to carry in its packet — the entry rebases nothing because you already did, and will again once its packet is in.
Record both the entry's exact starting `HEAD` and its recorded PR `headRefOid`, and tell the agent to make no PR mutations and to return the complete review packet defined by `address-review` whenever the final local tip differs from either value even if no review items remain; that is a zero-item packet, not a terminal no-op.
If the agent reports that step 1's reconciliation fast-forwarded the branch, adopt its new tip as this entry's recorded starting `HEAD`; keeping the pre-reconciliation value would make a fast-forwarded entry look changed, forfeit the zero-feedback shortcut, and drive a full zero-item review and a no-op publish.
If it reports a successful no-op because no actionable review items remain, apply the **terminal zero-feedback shortcut**: accept it without a reviewer or publisher only when `final HEAD == starting HEAD == recorded PR headRefOid`, and treat that published-tip completion as satisfying each dependent's topological gate.
The shortcut is deliberately the one path that ends an entry without its pre-review rebaser: the second point exists so no verdict that authorizes a push is rendered on a tree whose last base refresh predates its last fix, and a shortcut entry renders no verdict and pushes nothing — its remote tip is untouched, and the tip the dependent gate pins is that published tip, which drift on the parent's own base does not move; a base that had already moved by the pre-fix pin forfeits the shortcut below as a rebase-changed tip, and one that moves after it is the next run's to catch, exactly as `address-review`'s own terminal no-op stops before its second point.
A rebase-changed tip or an unchanged but already ahead/diverged local tip does not qualify: it requires a complete zero-item packet, Phase B, and, unless `no-push`, the normal publication waves.
Adopt a returned packet only under `review-cycle`'s packet hard-check: that entry's worktree must have `git -C <worktree> status --porcelain` empty **and** no Git operation in progress (`rebase-merge`/`rebase-apply` paths, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG` — a tree left mid-rebase or mid-cherry-pick prints empty porcelain, so a porcelain-only check hands Phase B a worktree nobody can build on).
Either condition failing means redrive or resume that entry, never silent adoption.

### Phase B — fresh review

Spawn one fresh reviewer per packet-bearing PR only once that entry's fixer commits are on disk — its packet returned and adopted under the hard-check above — and, at the same moment for each entry, launch a background `codex` peer unless disabled or unavailable.
Waiting out every Phase-A agent in the current dependency wave is the proxy for that committed state, not the rule.
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

For each failed entry, spawn a fresh fix-up agent with that PR's packet and the complete available outputs verbatim as separate `Reviewer findings` and, when present, `Peer (codex) findings` blocks; omit the peer block when disabled, unavailable, or forfeited.
It works only in that worktree, addresses each finding directly, runs validation, commits everything, leaves a clean worktree, and returns an updated packet.
Spawn a fresh reviewer — and, when enabled and available, a peer round — only once that fix-up agent's commits are on disk, its updated packet returned and adopted under Phase A's hard-check; waiting the agent out is the proxy for that committed state, not the rule.
The next Reviewer adjudicates any evidence-backed push-back on a peer claim.
A fix-up changes the packet, so Phase A's **pre-review** rebase point runs again before that reviewer: spawn its rebaser on the adopted packet and re-pin the packet from the report, exactly as after the initial fix.
Skipping it would have every review-driven fix reach its verdict — and publication — on a tree whose last rebase predates it, which is precisely what "after the fixes, before the final review" forbids.
The `review-cycle` round cap bounds each entry, counting every fix-up regardless of which reviewer triggered it; an entry still failing at the cap is blocked and must not publish, and every outstanding finding set is surfaced verbatim.

### Publication

Unless the run is `no-push` (local-only), spawn a fresh publisher only for an entry that cleared the `review-cycle` gate; pass its final packet, Reviewer Pass, and explicit peer outcome.
**Publish as ready.**
Launch that publisher the moment the entry's own gate passes — push, thread hygiene, Summary comment, pings — and hold nothing for a batch-level publish barrier: no entry waits on a sibling except through the stack ordering below, so the easy entries reach their PR reviewers while the hard ones are still iterating.
For each detected rebase-enabled stack, publish parent-before-dependent as a **best-effort ordering, not a hard gate**: prefer to launch a dependent's publisher only after every parent has published successfully, refreshed as merged (content-verified below), or completed Phase A through the terminal zero-feedback shortcut, and take the blocked-parent carve-out below when a parent cannot get there at all.
Publishers for unrelated entries may still run concurrently.

**Blocked-parent carve-out.**
A parent that *cannot* publish — blocked at the `review-cycle` round cap, holding a blocker, or awaiting a maintainer decision — blocks only itself, provided it became blocked **after** its dependent's wave had already launched.
A parent blocked *before* its dependent launches still skip-and-records that dependent — Phase A is about building on a correct base, while this rule only governs getting already-reviewed work to origin — and a parent stopped by a divergent remote or an unverifiable merge is not covered either: the rules that block those block the dependent along with it, and are the more specific ones.
Descendant invalidation's revocation is **provisional** until the parent's rerun concludes (otherwise the carve-out would be unreachable in the very case it names): when the rerun ends in a block, the parent's new tip will never publish, so restore the dependent's last packet and review gate — the ones valid against the last parent tip that satisfied its Phase-A gate — and treat that restored gate as satisfying publisher eligibility.
The un-restacked hold is what makes the restore work — the dependent's worktree still matches that packet's final SHA, which `publish-reviewed` verifies — so do not instead re-gate the dependent by restacking it onto the blocked parent's newer un-gated tip, which would carry un-gated parent work into its PR.
Judge each held descendant on what it actually holds: one that never passed a review gate of its own has nothing to restore, and is skip-and-recorded with the parent's reason.
Publish a dependent that cleared its own gate onto the parent's existing remote tip and reply and resolve its threads normally — the fixes are on origin, so the thread state is honest, and holding it instead is the more fragile choice: its reviewed work would survive only in a removable worktree, and while its disposition context does outlive this session as that entry's own durable record (`address-review` → "The durable disposition record"), the reviewed commits are what evaporates with the worktree (whether its diff renders honestly is settled separately by the honest-diff rule below).
Never publish the parent's un-gated work on the dependent's behalf, and do not merge a dependent before its parent — an ordering this skill can only state, never enforce.
None of this discourages a dependent PR that deliberately targets a feature branch rather than the default.

**An entry that will not publish still leaves its record.**
`delegated-fix` reaches neither of `address-review`'s publication steps and writes nothing to any PR, so for an entry that ends without a publisher the disposition record is **yours** to leave, from the packet you already hold: every entry of a `no-push` batch, an entry blocked at the `review-cycle` round cap or holding a blocker, and a held descendant whose parent's block leaves it unpublished.
Post it per `address-review` → "The durable disposition record" — one per PR, superseding your own prior record rather than appending a second unless the map is one you already know is incomplete, which that section posts beside the earlier record rather than over it, drafted replies and the ready-to-post Summary body verbatim, the cited tips stated as local-only.
An entry whose publisher *did* run needs nothing from you even when publication aborted: that subagent reaches step 8 and leaves the record itself, and a second one here would be the stack that rule exists to prevent.
An entry with no packet — skip-and-recorded at setup, or failed before triage — has no map to record; it belongs in the hands-off blockers instead.

**Ping only on an honest diff.**
Publishing a dependent while its parent's rebase is still unpublished leaves the dependent's PR diffed against a base ref its local history no longer descends from, so the PR shows every commit the rebase pulled in rather than the dependent's own change.
Test it against the range GitHub will actually show: list `<base-ref current remote tip>..<the tip just pushed>` and require every commit in it to be one of the dependent's **own**, defined exactly as `<the exact parent tip this dependent was pinned or restacked onto>..<the tip just pushed>`.
Take the set from that pinned tip rather than by matching commits across the restack: a rebase gives the dependent's own commits new OIDs, duplicate patches are ambiguous, and rewritten merge commits have no reliable patch-id, so any identity-matching definition is undecidable exactly where this rule is needed.
Anything else in that range (a parent commit, or a commit the restack pulled in from the rebase target) means the diff is not honest.
Test the range rather than tip ancestry, which is wrong in both directions: ancestry misses a parent that merely *appended* an unpublished fix-up, since the old tip stays an ancestor while that fix-up still lands in the range; and it fires spuriously when the base ref simply advanced with commits of its own, which leaves the range clean.
Testing the parent's commits for patch-id presence fails too, and on the commonest case of all: a rebased-but-unpublished parent keeps every patch-id it had, so the parent looks present while the range is still full of whatever the rebase pulled in.
When the range holds anything that is not the dependent's own work, complete the push, replies, resolves, and Summary comment, but **ping no reviewer** — a review round against a sprawling diff is wasted effort — and say so prominently in that PR's Summary comment and in the batch report, including that the diff narrows once the parent publishes or at the pre-merge rebase onto the default branch, and that re-requesting review is then the maintainer's to trigger.
Deliver the suppression through the publisher's arguments: invoke that entry's `publish-reviewed` with `push` substituted for the run's ping tokens, since `address-review` owns pings and has no honest-diff concept of its own.
This is the one documented per-entry exception to batch-uniform flag pass-through.
Only an explicitly named `ping-codex`/`ping-claude`/`ping-copilot` overrides the suppression — not `ping-contributing`, and not the bare default, which *resolves to* `ping-contributing`: a publisher handed only the resolved set cannot tell the two apart, so the override must rest on a bot the maintainer named outright.

A parent refreshed as **merged** satisfies a dependent's ordering only when the merge actually carries the parent's final reviewed content.
A parent merged after its review gate but before its publisher ran holds reviewed fix-up commits that never reached origin, and restacking the dependent onto that merge then either drops them or silently replays them into the dependent's PR — either way the batch reports success while the parent merged without its fixes.
Verify that the parent's final reviewed **content** is present in the refreshed base's **current tree**.
The tree is the authority, and per-commit patch-id only enumerates what to check — it never concludes on its own, in either direction.
A squash or a conflict resolution carries the content under a single or rewritten commit and so matches no patch-id despite having landed it, while a commit whose patch-id matches proves nothing if something later reverted its effect.
Fail closed: an unverifiable parent counts as unsatisfied.
If the content is missing or cannot be confirmed, do not treat the parent as satisfied: block that parent, report its unpublished reviewed commits with their SHAs and what each fixed, and leave to the maintainer whether they re-land as their own PR or ride the dependent.
The batch never makes that call silently.
Immediately before that launch, re-fetch the PR and relevant refs and re-verify the same state, pair, and OID facts again.
A changed head OID goes through the **Remote-tip refresh guard** above — at this boundary an adopted fast-forward is an entry-affecting change and a rewound or genuinely divergent tip blocks the entry.
Invalidate the stale packet only when an entry-affecting fact changed: its head OID, open/merged state, fully qualified head/base pair identity, or dependency target because any parent tip changed; unrelated `baseRefOid` movement alone does not invalidate it.
When a packet is invalidated, do not launch its publisher: rerun `delegated-fix` (including the required restack when a rebase-enabled dependent's parent changed its dependency target) and the fresh review gate first, and apply **Descendant invalidation** to any parent tip that rerun changes — restoring the last valid gate instead where the rerun ends with the parent blocked.
When no parent changed the dependency target, preserve the original exact non-parent target — subject to the same carve-out: the rebase point that follows re-resolves a default one for itself.
Tell it to invoke the `address-review` skill with arguments `#N hands-off publish-reviewed <resolved push/ping tokens>` — pass the run's resolved push/ping set (a bare default batch resolves to `ping-contributing`; a `no-push` batch skips publication entirely) — except for an entry whose diff is not honest and for which no bot was named outright, where the ping tokens are replaced by `push` (see "Publication" → ping only on an honest diff).
It edits no code and returns the full final report, including per-thread dispositions, push/ping outcome, and blockers.

Do **not** give any subagent another PR's context — strict per-PR isolation.

## Adaptive throttling (width from real constraints)

Inherit `address-tasks` → "Adaptive throttling" in full (storage headroom before each fan-out, `ENOSPC` back-off, serialize shared-exclusive-resource phases, fan out less on `429`/`529`).

Effective subagent concurrency remains the number of PRs in flight at once, while each review entry also starts one peer CLI process.
Start every distinct, dependency-ready PR that available agent slots and objective resource headroom support; do not impose a fixed small initial sub-batch.
Serialize shared build/database resources when their exclusivity is known or reasonably anticipated.
Because concurrent entries each invoke the peer, repeated peer-side rate, transient usage, or capacity failures are a signal to reduce the next fan-out (and retry each affected invocation at most once), just like provider `429`/`529` pressure; a definitive auth/usage exhaustion may mark the peer unavailable without blocking own-harness review.
When breadth contributes to a failure, preserve completed and viable in-flight entries and use a materially narrower subsequent review/fix-up phase rather than restarting partial work or repeating a full failed review at the same width.
Record whenever you ran narrower than the batch size and why.

## Cleanup

- Remove each worktree once a PR's subagents have returned cleanly and its work is committed — but check first: `git -C "$WT_BASE/<slug>" status --porcelain` must print nothing and no Git operation may be in progress (no `rebase-merge`/`rebase-apply` paths, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, or `BISECT_LOG` under its git dir — the same six the packet hard-check names, and for the same reason: the last three can print empty porcelain, so a porcelain-plus-rebase-only check clears a tree nobody should remove); only then `git worktree remove "$WT_BASE/<slug>"`.
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
  This is the main value of an unattended batch: nothing silently dropped.
- **Items orphaned by a mid-run merge** — a maintainer merging an in-scope PR while the batch is still running strands its remaining items: their files are on the merge target and the branch that carried them is gone.
  Re-derive that PR's merge state from the API rather than the batch's earlier snapshot, list the stranded items here, and point at `resolve-open-questions` → "Re-homing an orphaned finding" for picking a host PR, rebasing it onto its own base ref first, and stating provenance.
- **Push-backs** made across the batch, with their rationale.
- **No-push runs:** include each PR's per-thread disposition map (from its `address-review` report) so a later "push now" pass can replay replies/resolves precisely, and note each entry's disposition record comment — posted or superseding a prior one, per `address-review` → "The durable disposition record" — since that comment is where the map survives this session.
- **Throttling:** note whenever you ran narrower than the batch size, and why (storage-bound, rate-limited, resource-serialized).
- **Peer opinion:** note participation and grounded/discarded findings per affected entry; report a disabled/unavailable/round-forfeited peer once with its reason rather than repeating the same failure for every PR.
- **A leafy-stack note** pointing at `rebase-stack` if the user will want to integrate the branches.

## Checklist

- [ ] Session Bootstrap ran: worktree base prepared, stale worktree registrations pruned, GitHub/remote access confirmed, one-time peer preflight completed unless disabled, `git fetch origin` done.
- [ ] Batch parsed into entries (each classified PR-number vs branch-name); pass-through flag set captured (the default — no push/ping argument — resolves to publish + `ping-contributing`; `no-push` makes the whole batch local-only apart from the one disposition record **you** leave per entry, per "An entry that will not publish still leaves its record." — no `delegated-fix` entry writes one; `no-rebase` turns off the default rebase for every entry, as does invocation prose excluding one); `hands-off` force-injected into every `address-review` invocation and equivalent unattended guidance given to reviewers/fix-ups; aliases for one PR de-duplicated and same-head PRs serialized.
- [ ] Stacks detected only by matching fully qualified repository/ref pairs; every entry rebased by default — each point spawned by the orchestrator per `review-cycle` → "The delegated rebase step", before the fix agent and again after it and after every packet-changing fix-up, each point's default target re-resolved from the PR's base repository rather than reused from setup, an invocation-named target instead resolved once at setup and reused by every entry at both points, with each entry's later delegations naming its pinned effective base OID (for an entry no rebase ran for, that named target's pinned OID on a `no-rebase` batch, or the commit its `baseRefName` resolved to at setup — a prose-excluded entry the latter wherever its siblings rebased) rather than a remote-tracking name, and a halted rebase skip-and-recorded with its open question; rebase-enabled stacks ran and published parent-before-dependent on best-effort ordering with pinned exact targets; the terminal zero-feedback shortcut, **Descendant invalidation**, the blocked-parent carve-out, the honest-diff ping suppression, and the merged-parent content gate were each applied as defined; dependents of setup-skipped, Phase-A-failed, or round-cap-blocked parents were skip-and-recorded with the parent's reason rather than rebased onto the original target.
- [ ] Each entry resolved to a `(branch, PR#)` pair and checked out on the right ref — both branch and PR-number resolution sourced the base repository from the PR's own `url`, never from a bare `gh repo view --json nameWithOwner`; **branch entries check out the local ref, leaving `address-review`'s no-work-lost reconciliation to decide between it and the PR head**; PR-number entries prefer a same-named local branch, else the recorded exact `headRefOid` (never the possibly-stale `origin/<headRefName>`); the fork attach verified for itself that what it checked out is a durable local branch carrying the PR head, reporting the collision rather than resting on `gh`'s refusal to clobber a same-named ref; worktrees under the chosen base dir; un-setup-able / PR-less entries skipped-and-recorded.
- [ ] PR/merge state and relevant refs refreshed and re-verified at every apply boundary and at publication; only entry-affecting head/state/pair/dependency-target changes invalidated review, while unrelated `baseRefOid` movement did not; every later head movement went through the **Remote-tip refresh guard** before any lease was adopted or publication proceeded; refreshed facts preserved the pinned non-parent target, which moved only where a rebase point re-resolved a default one for itself.
- [ ] Per-PR phases ran in order: the pre-fix rebaser, `address-review ... delegated-fix`, the pre-review rebaser (and another after every packet-changing fix-up), fresh external Reviewer plus a concurrent best-effort peer when enabled and available, fresh fix-up/re-review as needed (bounded by the `review-cycle` round cap), then `address-review ... publish-reviewed` only after the entry cleared the `review-cycle` gate unless the run is `no-push`; every packet-bearing entry that ended without a publisher got its disposition record from you, and no entry whose publisher ran got a second; each rebase-enabled parent cleared its complete review/fix-up gate before its dependent's Phase A began, and every zero-item case honored the terminal zero-feedback shortcut's exact bounds; distinct dependency-ready heads fanned out concurrently but throttled only for objective or anticipated constraints; same-head entries serialized.
- [ ] No new PR head lineage created and no `gh pr create`; restacks occurred only for rebase-enabled entries, including the required restack after an enabled dependent's parent merged.
- [ ] Clean worktrees removed after each subagent returns; dirty/in-progress worktrees preserved and reported; **no PR branch deleted**; main checkout restored to its starting checkout mode after any temporary detach.
- [ ] Batch summary aggregates outcomes, hands-off blockers (prominently), items orphaned by a mid-run merge, push-backs, peer outcomes/forfeits, no-push disposition maps and the record comment each unpublished entry left, throttling notes, and the `rebase-stack` follow-up pointer.
