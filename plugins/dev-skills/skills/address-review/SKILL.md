---
name: address-review
description: Pull request review comments or CI failures require addressing or resolving. Trigger when the user asks to address review comments, action a reviewed PR, work through review feedback, or run address-review. Propels the review-fix-review cycle in a structured way. Not for planning, for implementing task files (use address-tasks), or for rebasing a whole stacked chain (use rebase-stack).
---

Address the review feedback on a single pull request, end to end.

**Arguments:** `[PR#] [rebase on top of <target>] [no-rebase] [inline] [no-push] [push] [hands-off] [peer-opinions=off] [ping-codex] [ping-claude] [ping-copilot] [ping-contributing]`

A maintainer triggers this skill once a PR has been reviewed (by bots like `@codex`/`@claude`/`@copilot` and/or humans) and they have decided the outstanding feedback is ready to be acted upon.
Your job is to work through every **unresolved** review thread — fix what is right, push back on what is wrong, confirm what is already handled, and capture what is real but out of scope in a committed follow-up task — plus every failing CI lane on the PR head, keep the thread state tidy, and publish the result and summon a fresh review round — by default, unless `no-push` keeps the run local.

The maintainer signals intent through GitHub's own resolved/unresolved state, not a custom marker.
They resolve threads they want dropped (or reply with their own push-back) **before** triggering you, so the rule is simply: **unresolved = actionable, resolved = leave alone.**
Because you resolve the threads you address (on push runs), running this skill repeatedly is self-cleaning — each run only re-examines what truly remains open.

The branch mechanics — the clean-and-idle check, reconciling with the PR head, pinning a base, and the publication push — live in `pr-branch.sh`, beside this file.
Run it by its absolute path from the working location; `--help` prints its full contract.
Where the PR is on a host other than github.com, write `--repo` as `<host>/<owner>/<repo>`, the way `gh` takes it.
It prints `key=value` lines with `outcome=` first, exits 0 to proceed and 3 on a stop that needs a decision, and explains a stop on stderr.
Exit 1 is a failure with no `outcome=` line (the network, `gh`): retry it once, then stop and report what it said.
Do not reproduce its steps by hand, and never work past a stop by running the fetch, fast-forward, or push yourself.

## Arguments

All arguments are optional and parsing is **lenient** — accept commas, `&`, and free word order, mirroring the example prompts.
Trust yourself to extract intent, then sanity-check against the PR.

| Argument | Meaning |
| --- | --- |
| `PR#` (e.g. `#38`) | The PR to address. Takes precedence over auto-detection — useful when the current branch is not the PR head, in which case the run works in a worktree. Always sanity-check that it really relates to the branch it would be worked on. |
| `rebase on top of <target>` | Rebase the **working location's branch** onto `<target>` — a branch name or an exact commit — rather than onto the PR's own base, which is what step 2 rebases onto by default. Single-branch rebase only. |
| `no-rebase` | Opt out of the default rebase entirely — **both** of step 2's points, so the branch is addressed and pushed on the base it already sits on. Use it when the base is known to be moving under you, or when a rebase would obscure what a reviewer is being asked to look at. It wins over `rebase on top of <target>` if both arrive — for the REBASE only: the token is not discarded, and a still-standing target is what step 6 pins as this run's effective review base. |
| `inline` | Force **inline** working on the **target branch** — do the work in the current checkout rather than in a worktree, checking that branch out there when the checkout is not already on it. Requires that checkout to be clean, and the run ends on that branch. Unnecessary when you already stand on it (that is mode 1 anyway). See "Working location". |
| `no-push` | **Local-only run** — make commits, but perform no PR-side communication: no push, no replies/resolves, no summary comment, no ping. It makes **exactly one** PR write, the single documented exception: the disposition record comment of "The durable disposition record" below. The final report still captures every disposition so a later push turn can replay it. |
| `push` | Push the branch to the PR's head ref and perform all PR-side communication (replies, resolves, summary comment) — but **ping no reviewer**. Use it to publish fixes quietly, without summoning a fresh review round. |
| `hands-off` | Run with no user interaction — best-effort to completion, documenting every skipped/blocked item in the final report. See "Hands-off mode". Typically how a parallel review orchestrator invokes this skill in a subagent. |
| `peer-opinions=off` | Disable the best-effort `codex` second opinion for this run. By default it runs beside every fresh Reviewer round while the peer remains available. |
| `ping-codex` | After a push that advances the PR branch, post a dedicated top-level `@codex review` comment to summon a fresh review round. |
| `ping-claude` | After a push that advances the PR branch, post a dedicated top-level `@claude review` comment. |
| `ping-copilot` | After a push that advances the PR branch, request a fresh Copilot review via `gh pr edit <PR#> --repo <owner>/<repo> --add-reviewer @copilot` (the canonical CLI request; needs gh ≥ 2.88.0) — **never** an `@copilot review` comment, which drives Copilot's coding agent (it can start editing the branch) rather than its reviewer. |
| `ping-contributing` | **The default** — a bare run behaves exactly as if you passed this. As a **modifier** on the ping set: re-ping a bot only if it **brought a new finding this round.** Combined with explicit `ping-codex`/`ping-claude`/`ping-copilot`, it filters that named set down to the contributors; supplied **alone** (or as the bare default), it falls back to every known bot (codex/claude/copilot) that reviewed this round. *Brought a new finding* = authored ≥1 thread this round that surfaces a real concern not raised before on this PR (typically `actionable-fixed`, or a genuinely new `follow-up-task`/`already-addressed`); it does **not** count a `push-back` (the comment was wrong), a re-raise of a concern already captured in a committed task, or a bot re-arguing a push-back it already lost — **unless** that thread carries a genuinely new angle this round. |

### Flag interactions

Push unless `no-push`.
Ping the named bot(s) if any were named (filtered to contributors when `ping-contributing` is also present), else **nobody** when `push` was spelled out, else the **contributing** set (the bare default, identical to `ping-contributing`).

- **`no-push` wins.**
  Combined with `push`/`ping-*` (a contradiction), honor `no-push` and note the ignored flag.
- **A ping fires only when the push actually advanced the branch.**
  If this run produces nothing new to push — every disposition was already-addressed or push-back, or the branch was already up to date — **skip the pings.**
- **`ping-contributing` prunes the ping set per this round's triage** (its table row defines what counts as a new finding).
  It never adds a bot you did not name, and a round in which no candidate bot brought a new finding pings no bot — even while the push itself advanced (e.g. you fixed a human's thread).
- **Multiple pings present** → perform each as its own dedicated action (a separate comment per named bot; the `gh pr edit --add-reviewer @copilot` request for Copilot), never a single comment mentioning several.
  They are also separate from the Summary comment.
- **`hands-off` + the default rebase** is the ordinary unattended combination now that rebasing is not opt-in, and its sharp edge is a decision nobody can be consulted about: whatever halts the delegated rebase — step 2's "A halt is a stop, not a guess" defines the cases, and this bullet does not restate them — leaves the tree clean and idle, and the run stops with that open question rather than guessing (see "Hands-off mode").
  `no-rebase` is how an unattended run avoids the edge entirely.
- **`inline` selects the working location and nothing else.**
  It neither implies nor suppresses a push, names or drops a ping, or changes how anything is triaged; it is orthogonal to every row of the table above and to `hands-off`.
  The one thing it changes is what the preflight requires — an inline run needs the current checkout clean (see "Working location").

## Working location

Where this run does its work is **chosen, not configured**: standing on the branch it works there in place, and from anywhere else it works in a git worktree, leaving the main checkout free for branch management while the run proceeds.
Orchestration does not change with the mode.
You remain the main-loop orchestrator in every one of them, so the interactive channel — ambiguous dispositions, conflict confirmation, PR-identity doubt — is preserved exactly as it is; all that moves is the location the fixers, the Reviewer, the peer, and the publication push are pointed at.
Architecture's *one checkout-dependent agent at a time* rule follows the working location too: in worktree mode the subagents share that worktree rather than the main checkout, and the invariant it protects — never spawn the reviewer until the fixer's commits are on disk — is untouched.

Pick the mode once, after step 1 has resolved the PR and **before** step 1's reconciliation: that reconciliation can fast-forward a branch, so it has to run where the work will happen.
Take the first mode below that applies, with forced `inline` (3) ahead of the rest.

**The target branch** is the PR's `headRefName`, or the branch an orchestrator named for this entry.
In `delegated-fix` and `publish-reviewed` there is no mode to pick at all: `address-reviews` has already assigned this entry a worktree, that worktree *is* the working location, and this skill neither selects nor creates nor reclaims one.

**The PR identity check** is step 1's PR-vs-branch sanity check, applied to whichever branch is a *candidate* working location rather than only to the one you happen to be standing on: the candidate shares recent history with the PR head.
A branch that fails it never becomes the working location — not by being checked out, not by being attached.

1. **Inline — the checkout is already on the target branch.**
   `git branch --show-current` equals the target branch **and** that branch passes the identity check.
   Work in place.
   The branch advances under the maintainer, so a step-2 rebase rewriting their checked-out branch is expected.
2. **Worktree — anywhere else.**
   Any other branch, and a detached HEAD (there is nothing to advance under the user).
   Attach the target branch in a worktree and do everything there.
   The main checkout is never switched, never dirtied, and never required to be clean, and the maintainer may repoint it to any other branch mid-run without breaking anything.
   Auto-detection has no PR to resolve from a branch that is not the PR head, so a mode-2 run normally arrives with an explicit `PR#` (or an orchestrator's pairing); step 1's ambiguous case already covers the rest.
3. **Forced `inline` — the argument.**
   It forces the work into the current checkout, on the target branch.
   Where that checkout is not already on the target branch, run step 0.1's two checks on it **first** and stop if either fails, then check the target branch out there (creating a local tracking branch from the PR head when there is none) and proceed as mode 1. The run ends on that branch — the maintainer asked for the checkout, so it is not restored.
   Where the checkout already stands on the target branch there is nothing to switch and nothing to restore: that is mode 1, and `inline` changes none of it.

A name match alone never selects mode 1. A same-named local branch that fails the identity check falls through to mode 2, and there into the collision stop below — never *onto that branch*.

### Preflight in the working location

Step 0.1 states the two checks — clean tree, no Git operation in progress — and this section says only **where** they run, which is wherever the work will happen rather than the main checkout:

- Inline — mode 1 and forced `inline` — runs them on that checkout.
- Worktree mode requires nothing of the main checkout, which may be dirty or mid-anything.
  A worktree created for this run is clean by construction.
  A **reused** one — the stable slug surviving a prior halted run — gets the same two checks, and either one failing there is a stop-and-report naming the worktree path: what it holds is most likely that prior run's remains, and this run neither cleans nor forces past it (hands-off: document and stop).

Either way, nothing is auto-stashed or discarded anywhere; dirt is the maintainer's to resolve.

### Attaching the worktree

Branch resolution and attach follow `address-reviews` → "Resolving and checking out each entry" wholesale — local-first (a local ref wins over `origin`), the `origin` head only when no local branch exists.
Use a stable slug (`pr-<N>`) whichever command attaches the worktree, so a halted run's worktree is found again rather than duplicated — which that recipe's registration read before EVERY attach is what delivers: a halt keeps its worktree, so the resume meets a LIVE `pr-<N>` registration, which `git worktree prune` does not clear and a bare `git worktree add` would then fail on.
The base those attaches place a worktree under is that recipe's too, and its ignore rule comes with it: `git worktree add` excludes nothing on its own, so where `<repo>/.worktrees/` is not already ignored — probe it with the trailing slash, a directory-only rule answering no for a bare `.worktrees` that is not yet on disk — list it before the first attach in the repo-local exclude file `git rev-parse --git-path info/exclude` names, untracked and so dirtying nothing itself, rather than editing the tracked `.gitignore`, which is the maintainer's — and run that `rev-parse` from inside `<repo>`, because in a primary checkout it answers with the RELATIVE `.git/info/exclude` (only a linked worktree gets an absolute path), so a `git -C <repo>` form whose answer you then append to from your own directory writes the rule to a file `check-ignore` never reads.
Ask Git for that path: where the checkout is itself a linked worktree, `.git` is a gitfile and a literal `.git/info/exclude` is not a path at all, so the append fails and nothing is ignored.
Where the worktree helpers are on PATH, `wt-enter <slug> <branch>` covers the plain attach of a branch that **already exists locally**; it refuses to create a missing one without a base (`branch '<branch>' does not exist and no <base> was given`), and no local ref for the PR head is mode 2's commonest arrival — standing on `main` with a head you have never checked out.
So pass the verified head OID as that base (`wt-enter pr-<N> <branch> <headRefOid>`, which reads the base only when the branch is missing and so is safe when a local ref wins), or use the explicit `git worktree add -b <branch> <path> <headRefOid>` the inherited rules already keep for the tracking-`origin` case.
Where the helpers are absent, those explicit commands are the whole path.

One exception suspends local-first: **a local ref bearing the target's name that has already failed the PR identity check.**
Attach nothing and substitute nothing.
Report the collision — the rejected local ref, the verified PR head, and what each points at — and ask the maintainer how to proceed, resuming on their answer; hands-off, halt the entry with that same report.
The same stop applies wherever a same-named local ref is the candidate, forced `inline`'s checkout included.

### After setup, the main checkout is not yours

In worktree mode nothing after setup touches the main checkout.
No step switches it, and there is no restore step because nothing moved — and end-of-run reporting must not assume it still points where it did at invocation, since the maintainer was free to repoint it while you worked.

Reclaim the worktree with `wt-remove <slug>` (plain `git worktree remove` where the helper is absent) once the run finishes — **after publication, and equally after a `no-push` finish**.
The branch ref and its commits persist in the shared `.git`, so removal loses nothing, and the branch is never deleted.
Never force past uncommitted changes or an operation in progress.
A run that halts instead — a blocker, an unresolved conflict, a failed publication — leaves its worktree in place and **reports the path**, so the maintainer can inspect it or a later run can resume there.

## Architecture

At top level, address ordinary feedback **inline** and delegate only large or independent rework — plus every rebase, which is delegated whatever its size.
Then hand verification to a **fresh, independent reviewer subagent** and, by default, an independent best-effort `codex` peer.

Three top-level subagent roles — all spawned via the `Agent` tool with `subagent_type: "general-purpose"` — plus a best-effort peer CLI:

- **Fixer** (optional) — handles a large, multi-file, or exploratory fix for one or more related comments.
  Skip it for small surgical fixes you can do directly.
- **Reviewer** (default before any push) — a fresh-eyes agent that receives every unresolved thread, standalone item, and gathered CI lane verbatim, plus the proposed disposition labels, but **not** your implementation reasoning; it independently confirms that each disposition is sound in the committed code and performs a quality pass on the changed files.
  This is the `review-cycle` skill's Reviewer role.
- **Peer (`codex`, best-effort)** — the `review-cycle` skill's cross-harness peer step: a read-only CLI review launched beside the Reviewer with the same disposition context but no implementation reasoning.
  Every rule that skill states under *The peer step* binds here whole, later additions included; a coherent, grounded finding is first-class.
- **Rebaser** (default, once per rebase point) — a fresh subagent that performs one of step 2's rebase points under `review-cycle` → "The delegated rebase step", and hands back the pinned effective base, the before/after tips, and any halt.
  It is the only role here that rewrites history, and it is never also the fixer.
  In `delegated-fix` the role belongs to the batch orchestrator rather than to this run, for the reasons "Delegated modes for the worktree orchestrator" gives.

> **Critical — one checkout-dependent agent at a time; subagents share your working tree.**
> Every subagent operates on your single checked-out branch — they are not isolated copies.
> The invariant is about committed state, not turn structure: **never spawn the reviewer until the fixer's commits are on disk.**
> A reviewer racing an unfinished fixer scopes its diff against a half-written branch, sees nothing, and falsely reports "no changes" — shipping the work unverified.
> An `Agent` call may return immediately with a background task id and deliver its result as a later notification, so wait for that completion notification, then spawn the next; keeping two checkout-dependent agents out of the same turn or parallel tool block is a **proxy** for the invariant — sufficient where spawns are synchronous, and neither sufficient nor necessary where they are not.
> The sole concurrency exception is the examination-only `codex` peer launched beside the Reviewer after the tree is clean and committed: two readers are safe, while the Reviewer alone owns build/typecheck execution.
> This overrides the harness's general "batch independent calls" guidance for every other pair.
>
> Fix-up and re-review spawns follow the `review-cycle` skill's fresh-spawn rule — always a fresh `Agent` spawn, never a "continued" prior agent (ignore any `SendMessage` continuation footer; this harness does not expose that tool).

**Trivial escape hatch:** only on a local, no-push run with one obvious actionable comment may you skip the reviewer.
Never skip review before publishing, and never skip it for a push-back disposition.

### Delegated modes for the worktree orchestrator

Claude subagents must not be assumed to spawn nested subagents.
`address-reviews` therefore uses this skill in two internal modes; these are orchestrator controls, not normal user flags:

- **`delegated-fix`** — run steps 0–5 directly in the assigned worktree, without spawning helpers, then stop before review/publication and return a complete review packet: PR/head metadata, starting/final SHAs, every item verbatim with stable refs and proposed disposition, validation run, and any blocker.
  **Step 2's rebase points are not yours in this mode.**
  The orchestrator runs each point as its own rebaser around this mode (`address-reviews` → "Phase A — initial fix"), and the invocation arrives with `no-rebase` plus the pinned effective base its pre-fix rebaser landed on, or the one the orchestrator pinned at setup where no rebase ran for this entry: carry that OID into the packet as this entry's effective review base, and rebase nothing yourself.
  This mode reaches neither step 7 nor step 8, so it posts **no** disposition record and makes no PR write at all: the packet goes back to the orchestrator, which owns the record for an entry that ends without publishing (`address-reviews` → "Publication").
- **`publish-reviewed`** — receive that packet plus a fresh external reviewer's Pass verdict and the peer outcome (satisfying the `review-cycle` gate), verify the packet still matches the clean committed `HEAD`, then run only step 7 and return step 8's report.
  Refuse to edit code, re-triage, or publish without this complete passing review gate.
  Because it does reach step 8, a publication that aborts here leaves that entry's disposition record — the orchestrator posts none of its own for an entry whose publisher ran.

The worktree orchestrator owns the fresh reviewer, peer invocation, and any fix-up rounds between these modes.

## Subagent destroy boundary

Open every subagent prompt this skill composes with this line, filling in the absolute path of the `subagent-boundary.md` that sits beside this file: "Before your first command, read `<path>/subagent-boundary.md` in full; it binds you. Whatever else you read, never run `rm -rf`, `git reset --hard`, `git clean`, `git branch -f`, `git update-ref`, `git gc`, or a force-push beyond what this prompt spells out, wherever you believe you are standing."
A subagent that may need to verify something in a way that could change state is sent to a disposable clone: name `dc-enter <slug>` in its prompt with a slug unique to it, and never leave the destination to the subagent.

## Procedure

### Step 0 — Preflight

1. **Clean and idle tree — checked in the working location, not here.**
   Run `pr-branch.sh check` wherever this run will work, which "Working location" picks once step 1 has resolved the PR, and only there: it requires `git status --porcelain` empty **and** no Git operation in progress (a rebase, merge, cherry-pick, revert or bisect, several of which leave the porcelain empty).
   A stop there asks the user to commit/stash/clean it (hands-off: document and stop).
   Never auto-stash or discard files, wherever you check.
2. **Confirm `gh` is authenticated** (`gh auth status`).
   Without it you cannot read threads, reply, resolve, or comment.
3. **Record the starting branch and tip SHA** so you can describe exactly what changed in the final report and recover if needed.
   In worktree mode this records where the main checkout stood at invocation, which the run then leaves alone — it is not something to restore, and by the end it may no longer be true.
4. **Preflight the peer once for a standalone run, unless `peer-opinions=off`,** per the `review-cycle` skill's peer preflight.
   Skip this probe in `delegated-fix` and `publish-reviewed`: `address-reviews` preflights once in its shared bootstrap and supplies the peer outcome.

### Step 1 — Resolve and verify the PR

Precedence for identifying the PR:

1. **Explicit `PR#`** — use it, but **sanity-check the relationship to the candidate branch**.
   Compare the PR's `headRefName` and head SHA against it: do they share recent history?
   Is the branch an ahead/behind copy of the PR head?
   If they look genuinely unrelated (no shared commits), surface it — *"the supplied PR #N targets branch `x`, which shares no history with the current branch `y`; proceed anyway?"* — and ask before operating (hands-off: stop and document, since acting on the wrong PR is high-stakes).
   This is the **PR identity check** "Working location" turns on, and the candidate is whichever branch is in line to become the working location — the one you are standing on, or the local ref a worktree attach would otherwise pick up.
2. **Auto-detect** — `gh pr view --json number,headRefName,headRefOid,isCrossRepository,baseRefName,url,title,state` resolves the PR for the current branch; `gh pr list --head <branch>` is the fallback.
3. **Ambiguous or none found** — ask the user which PR (hands-off: stop and document the blocker; do not guess).

Record `owner`, `repo` (both from the PR's own `url`), PR `number`, `baseRefName`, `headRefName`, and `headRefOid` for the API calls and publication guard below.
**A fork PR is not supported.**
Where `isCrossRepository` is true the head lives in another repository, so stop and say so (hands-off: skip the entry and document it); nothing below resolves a head anywhere but the PR's own repository.

**Now pick the working location**, per "Working location" above, and set it up before going any further: everything below this line — the reconciliation, the rebase, the fixes, the review, and the push — happens there.

**Reconcile the working location's branch with the PR head before triaging anything:** run `pr-branch.sh reconcile --repo <owner>/<repo> --pr <N>` there.
The rule is *no work lost*, and ancestry decides it rather than a standing preference for either side.
It fetches the head ref itself and prints the head it reconciled against as `head=`: adopt that as `headRefOid` from here on, whatever `gh pr view` reported, so step 7's lease names the head you actually reconciled against.

- **`equal`, `ahead`, `represented`** → proceed; the branch was not moved.
  `represented` is a branch rebased onto a newer base, which carries the PR head's content by patch-id while sharing no SHAs with it.
- **`fast-forwarded`** → the branch was strictly behind and now stands on the PR head; address the feedback from there.
- **`divergent`** → each side holds work the other lacks, or the PR head carries a merge commit with content of its own, which no patch-id can speak for: **stop and ask the maintainer**, reporting both tips and the `remote-only=` and `local-only=` commits it printed.
  Do not pick a side, merge, or rebase on your own.
  Hands-off: skip the entry and document exactly this.
- **`rewind`** → the head ref is behind the head GitHub reports: block the entry for a maintainer decision without adopting either.
- **`fork`, `closed`, `wrong-branch`, `no-remote`, `dirty`** → stop and report what it said.

The tip this run started from is the `tip=` it printed — the **working location's**, after any fast-forward (`was=` is where the branch stood before one) — not step 0's reading, which in worktree mode describes the main checkout the run never touches.

### Step 2 — Rebase onto the freshest base (the default; `no-rebase` opts out)

The rebase happens at **two points**: here, before triage and fixing, and again at the end of step 5, before step 6's reviewer round — the second one repeating whenever step 6 sends the work back for further fixing.
You may judge a point unnecessary — where the base demonstrably has not moved since this run's earlier rebase, say so in the report and skip it rather than delegating a replay of nothing.
`no-rebase` suppresses **both** points, and nothing else does.
`rebase on top of <target>` replaces the default target with the one it names.
Given both, honor `no-rebase` and note the token it overrode, exactly as `no-push` wins over `push` — overrode for the rebase, and no further: the target still stands, and step 6 pins IT as the effective review base rather than `baseRefName`, since the branch was deliberately based on it.

**Do not run the rebase in your own turn.**
Delegate each point to a fresh subagent under `review-cycle` → "The delegated rebase step", which defines that brief whole — the pre-rebase recovery ref, the base pinned to the OID actually rebased onto, the hunk-level conflict rules it takes from `rebase-stack`, the clean halt, the validation, and the packet it hands back.
What is specific to one PR:

- **The target.**
  By default the PR's own `baseRefName`, fetched fresh at the point the rebase runs rather than read from a remote-tracking ref some earlier step updated — and fetched from the repository that ref lives in, which is the repository this PR is in, so hand the delegated step that repository as the `<owner>/<repo>` of the PR's own `url`.
  `rebase on top of <target>` names a branch or an exact commit instead (a batch orchestrator pins one commit so every entry rebases onto the same base), and that one is resolved where the maintainer named it — locally, in the working location — rather than fetched, since an explicit token routinely names a local branch that the remote has no such ref for.
  Tell the delegated step which of the two it is holding.
  Either way this is a **single-branch** rebase: a whole chain of dependent branches is the separate `rebase-stack` skill — mention it if the user seems to want chain-wide restacking.
  Where this PR's base is another in-flight PR's head, the target is that parent's new tip, per the delegated step's parent-first rule — which for a single-PR run reduces to that branch's tip as freshly fetched, since nothing here rebases the parent; a batch orchestrator holding the parent map is what rebases it first and then pins the resulting tip as this entry's target.
- **Where it runs.**
  The working location, like everything else after step 1.
- **Both points are this run's own** at top level, the second once every intended change is committed, so the packet a top-level run reports has the rebased tip as its final SHA.
  In `delegated-fix` neither point is this run's ("Delegated modes for the worktree orchestrator"), and a `publish-reviewed` run rebases nothing.
- **The pinned effective base is this run's effective review base** (step 6) and the boundary of every range you delegate afterwards.
  Take it from the returned packet — the OID that rebase actually landed on — and never re-derive it later from `baseRefName` or `origin/<base>`.
- **The second point runs before each reviewer round**, so a passing verdict always describes the exact tree step 7 pushes.
  Where it replayed anything, its delivery-tier validation runs and step 6 reviews the rebased tree; where it was a no-op, the tree the reviewer sees is already the one being pushed.
- **A halt is a stop, not a guess.**
  A conflict beyond the delegated step's competence — or a merge carrying its own content, met before any replay (the conflict is aborted; the merge starts no rebase, so there is nothing to abort) — comes back as an open question with the tree left clean and idle.
  **Interactive:** put that question to the user — what it turns on, your proposed resolution, and the reasoning — and hand their answer to a *fresh* rebase subagent rather than finishing the rebase in your own turn; loop them in as many times as needed.
  **Hands-off:** the run stops there having pushed nothing, with that open question and its detail (the offending commit, the files, why) as the blocker.

If either rebase changed the branch tip, expect the eventual push to be a force-push (step 7's exact `--force-with-lease`).

### Step 3 — Gather the review feedback

Fetch the **unresolved** review threads and enough context to judge them (see "GitHub API recipes"):

- **Review threads** (inline comments): fetch every **unresolved** thread exactly per "GitHub API recipes" below — prefer the `gh-review-threads` helper when it is on PATH, else run the GraphQL query by hand as fresh single-shot per-page queries — keep only `isResolved == false`, and **validate every response before acting** as the recipes specify, failing closed on any identity, shape, or scope failure.
  For each thread, capture the thread `id`, `path`, `line`, `isOutdated`, and every comment's `databaseId`, author login/type, `body`, `diffHunk`, and `url`.
- **CI on the PR head** (`gh pr view --json headRefOid,statusCheckRollup`, read the way README's *Contributing* reads it — by `__typename`, terminal values tested positively): every lane whose verdict is not `SUCCESS`/`NEUTRAL`/`SKIPPED` is a review item too, gathered with its identity — the `workflowName` and `name` of a `CheckRun` — an external app's has no `workflowName`, so its `checkSuite.app.slug` fills that slot, read through GraphQL's `statusCheckRollup.contexts` since `gh pr view` does not carry it, and two apps emitting one check name stay two lanes — the `context` of a `StatusContext`; a rollup carrying that identity more than once, one workflow fired by several events on the head, holds one lane there, failing while any instance is — and its details URL, and — for a GitHub Actions `CheckRun`, whose `detailsUrl` carries the segment `/<owner>/<repo>/actions/runs/<run-id>` (usually followed by `/job/<job-id>`) — the failing job's log tail — `gh run view --repo <owner>/<repo> --job <job-id> --log-failed | tail -n 200` where the URL names the job, else `gh run view <run-id> --repo <owner>/<repo> --log-failed | tail -n 200` for the run as a whole — under `set -o pipefail`, so a `gh` that failed (a stale job id, an expired token) is a failed gather to stop on rather than an empty tail that reads as evidence — with `<owner>/<repo>` taken from that URL rather than left to the checkout's default. A `StatusContext` or an external app's `CheckRun` has no workflow run at all, so `gh run` can neither read nor re-run it: gather it with its `targetUrl`/`detailsUrl` as the only details mechanism, and record that logs and re-runs are unavailable through `gh run`.
  A lane still in progress on the current head is not an item: note it and let the push, or the re-run below, settle it.
  A rollup describing a head other than the one you reconciled against says nothing about this branch; re-read it after the push instead.
- **Top-level review summaries** (`gh pr view --json reviews`) and **issue comments** (`gh api --paginate repos/{owner}/{repo}/issues/{number}/comments`) — read for context, especially **maintainer replies/push-backs** that override or qualify a bot's original comment.
  They are not automatically actionable because they have no resolved/unresolved state; include a standalone item only when the maintainer explicitly identifies it as outstanding in the request or discussion — or when a prior disposition record already holds a standalone disposition for it, which is an earlier run having gathered it — by the request that identified it or as a misfired finding that qualified on its own — and is what makes that entry replayable at all ("Replaying a record").
  **One more source qualifies on its own: a bot reviewer that misfired and posted findings into a top-level review summary or issue comment instead of threads.**
  One route per comment, never both: such a comment is never taken whole under the rule above, even where the maintainer names it — it is split into per-finding items here, the maintainer's naming settling that its findings are taken rather than re-judged by the freshness test below — since a whole-comment item on the url alone beside per-finding items on the url plus ordinal would let one finding be addressed twice, or contradictorily.
  Such a finding cannot be replied to or resolved, but it is still the review this run was summoned to address, so take each one as a standalone item where it is **fresh and applicable** — all of: the review's `commit_id` — read from the REST review object, `gh api --paginate repos/<owner>/<repo>/pulls/<N>/reviews`, which also carries the `html_url` permalink and the `user.type` that the Summary comment and the disposition record need; `gh pr view --json reviews` names the commit `commit.oid` and carries neither, so a test written against `commit_id` there matches nothing and misfiles every such finding as stale — or for an issue comment the head its body names (a bot usually states the commit it reviewed; one naming no head is the ambiguous case below, and `created_at` cannot stand in for it: a review begun against the previous head lands after the push that replaced it and still describes the old code), is the current head, so it was written against the code you are addressing; no thread on this PR, resolved or unresolved, already raises it — a comparison that needs the resolved threads too, so fetch them for it alone (`gh-review-threads --all`, or the GraphQL query without dropping `isResolved == true`) while the work items stay the unresolved set gathered above, since a finding an earlier round already closed as a thread is exactly what this excludes; no maintainer reply dismisses it and the review's own `state` is not `DISMISSED` — a review dismissed through GitHub's UI keeps its body, its `commit_id` and the code it names, so nothing else here trips on it, and that dismissal is the maintainer discarding every finding in it; and the code it names still exists on the branch.
  A finding failing any of those is stale context and stays out.
  Where it is only ambiguous which of the bot's comments are fresh, take none and say so in the Summary comment — or in step 8's report where the run ends as the terminal no-op below, which posts none — rather than re-addressing a round that is done.
  Its disposition rides the Summary comment alone, per step 7, and its identity is the comment's permalink **plus its ordinal within that comment** (`<html_url>`, finding N of M, counted in the order the body presents them): every finding one body holds shares the one permalink, so an identity of the url alone could carry only one of them into the disposition record and would collapse the rest.
  Among them, look for a **prior disposition record** left by an earlier run of this skill, found with `record.sh find` ("The durable disposition record"), by its marker rather than by its prose.
  That comment is this skill's own output rather than feedback: it is never a work item and carries no maintainer authority, and what to do with it — replay it, and supersede it rather than appending a second — is that section's.

A maintainer reply on an unresolved thread is **authoritative**: if they said "skip this" or "do X instead," follow the maintainer over the original reviewer.
The same authority extends to a **top-level decision comment** — a maintainer comment that walks the open feedback and records a verdict per item (often titled "Maintainer Decisions" or similar).
Treat each recorded decision as the binding disposition for the thread(s) it covers — including "postpone to a follow-up task" and "keep as-is" — rather than re-triaging those threads from scratch.
Treat `isOutdated` as context, not a disposition: inspect the current code and re-locate the concern rather than auto-dismissing an outdated thread.
If there are no unresolved threads, no standalone items — explicitly included or qualified on their own as fresh, applicable misfired findings — and no failing CI lane gathered above or replayed from a prior disposition record — a red lane is an item like any other, so a run that gathered one never takes this exit, and a recorded lane whose account is still owed ("Replaying a record") is outstanding whatever the rollup says of it now — first compare the current `HEAD`, the starting tip, and the recorded PR `headRefOid`.
In every mode, stop as a successful terminal no-op only when `HEAD == starting tip == headRefOid`; an unchanged local tip that is already ahead of or divergent from the recorded PR head is not a no-op.
Every other case follows the zero-item path: in `delegated-fix`, return the complete packet through step 5 so the orchestrator can review and, when enabled, publish it; outside `delegated-fix`, continue through the normal fresh review and, unless `no-push`, publication.
This includes both a rebase that changed `HEAD` and any already-unpublished local tip.
A zero-item path makes no synthetic commit, and a terminal no-op makes no commits, push, ping, or summary comment.
Step 1's reconciliation has already fast-forwarded a strictly-behind branch, so `HEAD` cannot be a proper ancestor of `headRefOid` by the time you get here.
If it somehow is, stop and report rather than entering the zero-item path.

### Step 4 — Triage every review item

Classify each into one of:

- **Actionable** — a real issue; implement the fix.
- **Already addressed** — the current code (possibly thanks to the rebase or an earlier commit) already satisfies it.
  Note where.
- **Push-back** (should be **rare**) — the comment is wrong, misunderstands context, or points in the wrong direction.
  Do **not** implement it; draft a respectful, specific rationale instead.
  Lean on judgment; never implement a fix you believe is wrong just to clear a comment.
- **follow-up-task** — the concern is real, but at least one condition applies: fixing it here would expand the PR's scope considerably while the branch is defendable as it stands (it builds and covers its main paths); the work meets step 5's condition-bound deferred-placement criteria; or the maintainer has already requested a follow-up (reply or decision comment).
  Do **not** implement it; record it as a committed task file instead (step 5).
  Never use this to dodge a cheap fix.
- **CI failure** — one of the lanes step 3 gathered.
  Judge the cause from the evidence step 3 gathered — the log tail for an Actions lane, the details URL and whatever it shows for a lane that has no workflow run, marked as such — never from the lane's name.
  Caused by this branch and within the PR's scope → **actionable**; fix it like any other item, and the push re-runs every lane.
  Not caused by this branch, or caused by it but structural or sprawling to fix (a shared fixture, a toolchain pin, a suite that fails on the base too) → **ambiguous**: the maintainer chooses between fixing here, a follow-up task, or accepting the red lane — hands-off records the lane, the cause you found, and that choice unmade, and pushes nothing for it.
  A **flake** — evidence, not a hunch: the same lane green on the base at a commit carrying the same relevant files, or an earlier re-run of this same head having gone green.
  A log that names only files the diff does not touch is **not** that evidence: find the cause, or compare against an equivalent base run, before calling it one.
  An evidenced flake is re-run rather than fixed (`gh run rerun <run-id> --repo <owner>/<repo> --failed` for an Actions lane — once per run, the repository taken from the run URL as step 3 takes it: several failed jobs of one run share its id and `--failed` re-runs them all, and a second request meets a run already re-running; a lane with no workflow run is left for the maintainer, since nothing here can re-run it), and only where the run pushes nothing new, since a push re-runs it anyway; a flake that has bitten before earns a follow-up-task item to fix the flake itself, offered rather than assumed on an interactive run.
  Those three are a failing lane's only dispositions — **already-addressed** is the replay disposition of a recorded lane this head shows green, running or absent, and a fix the tree already carries for a lane still red on the head (this branch's from an earlier run, or the base's after a rebase) is **actionable** with where the fix lives, since only the push re-runs the lane.
  Every CI item reaches the Summary comment with its cause, whichever way it went: a lane has no thread to reply on.
- **Ambiguous** — the right fix needs an authoritative decision you cannot make from the code/history.
  **Interactive:** ask the user.
  **Hands-off:** make a best-effort call only when stakes are low; otherwise skip and document it — do not guess where an authoritative determination is required.

A thread asking you to **document** some behavior is satisfied by a minimal why-comment under `review-cycle`'s comment rule (an actionable fix), or — where no comment would earn its keep — by push-back; never by adjacent code re-implemented in prose.
There is no reply-only disposition: the fuller rationale rides the reply whichever disposition you chose already posts on the thread, so pick the one that is true of the committed code rather than the one that suits the reply.
Where such a push-back is sustained, that rule's carve-out for a standing overruled decision is worth the comment precisely here: an external reviewer re-raises the same point across PR rounds and runs, and nothing in this run's replies is in front of it next time.

### Step 5 — Fix

For the actionable items:

- **Small/surgical** → fix directly in your own context, committing at logical milestones.
- **Large/multi-file/exploratory** → spawn a **Fixer** subagent (see Architecture and the prompt sketch below).
  One at a time; await its commits before moving on.
- **Preclude repeat comments:** for each pattern you fix, grep the PR's changed files and closely related code for the **same offending pattern** and fix those too, so the next review round doesn't re-raise it.
  Mention these proactive fixes in the summary.
- Keep commits buildable where practical, and validate at `review-cycle`'s tiers: the round tier while iterating, and the delivery tier — the full applicable sanity set — on the state you publish, before step 7 pushes.
- Before review, apply `review-cycle`'s packet hard-check to the working location: `git status --porcelain` empty **and** no Git operation in progress.
  Inspect and commit every intended change; if a fixer leaves partial or unexplained changes, resolve that state or stop rather than letting the reviewer inspect only the committed subset.
- Then run **step 2's second rebase point** — after that hard-check passes, before anything reaches review or publication.
  Its pinned effective base supersedes the first point's for step 6's brief and every later range, and a rebase that replayed anything runs its delivery-tier validation there rather than leaving step 6 to discover the breakage.
  In `delegated-fix` that point is the orchestrator's: leave the worktree clean at the hard-check and return the packet.

For the **follow-up-task** items, write the task file(s) following the `write-tasks` skill conventions (invoke that skill where available):

- Follow whatever task layout the repo already uses.
  Default to its task folder (commonly `tasks/`): a planned follow-up stays queued and numbered there even when it has prerequisites, which the task must state so its ordering remains visible.
- Use the deferred subfolder (for example, `tasks/deferred/`) only for deliberately unscheduled work: it depends on functionality that is not certain to arrive; it addresses a condition that cannot occur yet or has not manifested, and fixing it would be costly; or it awaits a spike or decision between competing options.
- When unsure, prefer `tasks/`: a mis-queued task can be reprioritized during a batch, while a mis-deferred task is easily forgotten.
- Number each file to continue the folder's existing sequence, slotted by priority/intended order.
- Each task must stand alone: restate the concern and link the PR thread; an implementer should not need to re-read the review.
  The link permanently anchors the exact line under review, so the task body anchors to named symbols per the `write-tasks` conventions and stays true after the branch moves.
- **Commit task files on the current branch, separately from code-fix commits** (when practical).

Fixer subagent prompt should include: the relevant review comment(s) **verbatim**, the file/line locations, the branch name (and "verify you are on it"), the **absolute path of the working location** with an instruction to `cd` there and confirm `git rev-parse --show-toplevel` prints exactly it before touching anything (in worktree mode a fixer that resolved the branch itself would land in the main checkout), an instruction to read `AGENTS.md` first, the same-pattern sweep instruction, commit/validation instructions, an instruction **not** to use the `TaskCreate`/`TaskUpdate`/`TaskList` tools (their entries leak into your task view), and a request to report what it changed, any tradeoffs, and anything uncertain.
Do **not** give it unrelated context.
With those validation instructions, hand it the path any build or check output must land in — namespaced by this PR number, or created with `mktemp -d`, and outside the checkout it commits from — never a fixed shared scratchpad name, since one session's agents share that directory.
Never leave the choice to the fixer.
This Fixer runs before step 6, so it never receives the prompt that cycle composes: brief it under `review-cycle`'s Fixer contract whole — every rule that skill states for a Fixer binds here, later additions included — rather than importing named rules one at a time.

In `delegated-fix` mode, do not spawn a Fixer or Reviewer, do not launch the peer, and rebase nothing; the batch orchestrator owns both review paths and both of step 2's rebase points.
Perform the fixes directly, leave the worktree clean with all intended changes committed, return the review packet defined above, and stop here.

### Step 6 — Verify with a fresh reviewer

Once fixes are committed and the worktree is clean, run the `review-cycle` skill's verification loop on this branch (artifact type `code`).
Its roles — the fresh Reviewer spawn and the best-effort `codex` peer launched beside it — are defined there and are not restated here.
Every rule that skill states under *The peer step* and *The loop and its gates* binds this run whole, later additions included; the no-latched-flags rule applies to whatever this run carries into step 8's report and the Summary comment.
The peer preflight outcome from step 0 and `peer-opinions=off` carry into the cycle.

This skill's deltas on the cycle:

- The work items are every unresolved thread and standalone item verbatim, and every CI lane step 3 gathered — its identity as step 3 gathers it, its details URL, the log tail or the explicit logs-unavailable marker step 3 recorded, the cause found, and any fix made for it — each with its proposed disposition label (actionable-fixed / already-addressed / push-back / follow-up-task / ambiguous, or the CI disposition step 4 gave a lane), plus the effective review base, the branch, and the **working location** — its absolute path in worktree mode, so the Reviewer and the peer read the tree the fixes landed in rather than the main checkout.
  The effective review base is the **pinned OID** step 2's latest rebase point landed on — the same commit every delegated range is taken against; where no rebase ran at all this turn (`no-rebase`, or both points judged unnecessary), pin the target the rebase would have used, once here instead, with `pr-branch.sh pin-base`.
  A `rebase on top of <target>` target still standing — named by the request and not discarded by `no-rebase`, which suppresses the rebase and not the target — is pinned with `--target '<target>'` (quoted as ONE argument), which resolves it in this checkout and fetches nothing.
  Where that reports `unresolved`, stop and report it rather than substituting anything: `baseRefName` is the target only where the request named NONE, never the fallback for one that failed to resolve.
  Otherwise — the request having named none — pin `baseRefName` with `--repo <owner>/<repo> --base <baseRefName>`, which fetches it fresh from the PR's own repository and moves no branch.
  Never a bare ref name or an `origin/<base>`, not even where it stops on `no-remote`: those resolve a same-named local branch or a stale remote-tracking ref.
  Neither the Reviewer nor the peer gets your implementation reasoning, drafted rationale, or the fixer's report.
- The Reviewer independently verifies every disposition: fixes and already-addressed claims must hold in the committed code; push-backs must be technically justified rather than convenient dismissals; follow-up-task items must point at a committed task file that genuinely covers the concern, with the follow-up itself justified under step 4's conditions — never an evasion of a cheap fix — and its queued or deferred placement consistent with step 5; ambiguous items must genuinely require an authoritative decision.
  It may reclassify any item.
- When a round fails, re-triage the affected comments before the cycle's next fresh Fixer round.
- If the cycle stops at its round cap, do **not** push; surface every outstanding finding set in the final report (and to the user if interactive).
  Such a run leaves the disposition record on the PR ("The durable disposition record").

### Step 7 — Publish after the review gate (every run except `no-push`)

If `no-push` was given, **skip this entire step** and go to step 8, which posts the disposition record — the one PR write such a run makes.

Otherwise:

Do not enter publication unless step 6's review cycle passed its gate.
An outstanding grounded peer finding returns to step 6 while rounds remain, or stops publication at the cap.

In `publish-reviewed` mode, first require the supplied review packet, a fresh external reviewer Pass, the peer outcome satisfying that same gate, and a clean committed `HEAD` equal to the packet's final SHA.
If any differ or the peer outcome is missing, stop; do not re-triage or publish stale work.

Publication runs in the working location: the re-check, the resolved push remote/ref, and the push itself all read and write that tree and its `HEAD`, never the main checkout.

**Which repository every `gh` call below addresses: the one the PR is in**, written out literally (`--repo <owner>/<repo>`, `repos/<owner>/<repo>/…`) per "GitHub API recipes" rather than left to default.

1. **Re-check and push:** run `pr-branch.sh push --repo <owner>/<repo> --pr <N> --expect <headRefOid>`, naming the head step 1 reconciled against.
   It re-checks everything publication depends on — the tree clean, idle and still on the head branch; the PR open, with its head and the head ref itself both still the expected commit — then pushes `HEAD` to the head ref under an exact `--force-with-lease` on the expected head, whether that push is a fast-forward, a rewrite, or the no-op of a tip already there.
   It then reads the ref back with `git ls-remote` through every push URL, after a refused push as well, since `gh pr view --json headRefOid` can report the pre-push head for a while.

2. **Read its outcome:**
   - **`pushed`** → the branch advanced (`advanced=yes`), and `head=` is what origin now carries.
   - **`up-to-date`** → the tip was already the PR head, so the push was the `Everything up-to-date` no-op (`advanced=no`); carry on with the PR-side communication.
   - **`behind`, `head-moved`, `rejected`** → nothing was pushed, and for `rejected` every push URL answered the read-back without the tip: stop and report.
     Reconcile nothing to make the push legal, and **never** escalate to a bare `--force`.
   - **`unconfirmed`** → some push URL does not show the tip at the head ref or did not answer, whether the push command returned or was refused (`push-command=`), so whether it reached origin is unknown: stop, and render the disposition record as its read-back case.
   - **`fork`, `closed`, `wrong-branch`, `no-remote`, `dirty`** → stop and report what it said.

3. **Re-read unresolved threads after the push.**
   Re-run any lane step 4 judged a flake only where the push was a no-op — a push that advanced the branch already re-ran every lane, and this run does not wait on the fresh rollup: CI gates the merge, and the next round reads it.
   Each re-run request is part of the publication's success contract: report which run ids' `gh run rerun` was accepted, per id rather than per lane — a repeated lane names several runs and each request accepts one, and the lane counts as re-run only where the accepted ids cover every run it names — and where one was rejected or failed the publication has not completed — stop before the replies, report the failure with the lane and what `gh` returned, and leave the disposition record as any part-way publication does, since the one action that disposition promised never happened while the lane stays red; the record names the accepted ids beside the owed ones, so the next turn orders only the rest rather than meeting an accepted run already re-running.
   This catches comments resolved or added while fixes were in progress.
   Do not mutate newly-added feedback that was not triaged and reviewed in this run; leave it open and call it out for the next pass.
4. **Per-thread hygiene** — for each triaged thread still unresolved (recipes below):
   - *Actionable-fixed* → reply (`Fixed in <sha>: <one line>`) **and resolve**.
   - *Already-addressed* → reply pointing to where it's handled **and resolve**.
   - *Follow-up-task* → reply with the placement-specific template: queued work uses `Follow-up task committed: tasks/NNN[a-z]?-… — queued for an upcoming batch`; parked work uses `Deferred with full context to tasks/deferred/NNN[a-z]?-… — <the condition it waits on>`, where the lowercase letter suffix is optional.
     **Resolve** when the follow-up was maintainer-directed or the thread is bot-authored; leave a human-authored thread unresolved unless the maintainer authorized closing it.
     Never re-implement a task-backed thread.
   - *Push-back* → reply with the rationale and flag it prominently in the summary.
     Resolve a bot-authored thread after independent review validates the push-back.
     Leave a human-authored thread unresolved unless the maintainer explicitly authorized resolving it, so unattended runs do not silently close a person's objection.
   - *Ambiguous/skipped* → **leave open**, list it in the summary as needing a decision.
     Before replying, inspect the thread for an equivalent prior reply from the authenticated user (for example, a previous run replied but failed to resolve) and avoid posting duplicates.
     Resolve only after the reply succeeds; record any communication failure and leave that thread open.
5. **Summary comment** — post a top-level **"Summary of Review Fixes"** (`gh pr comment <PR#> --repo <owner>/<repo>`).
   Structure: what was fixed (with proactive same-pattern fixes called out), a **prominent "Pushed back — please re-examine" section** for every push-back with its rationale, a **"Follow-up tasks" section** listing each item with its committed task file (explicitly flag deferred placement and flag agent-proposed follow-ups for confirmation), a **"Top-level findings"** section for every standalone item taken from a bot's misfired top-level comment (step 3), each with its disposition and the permalink of the comment it came from, since no thread carries the reply — a **"CI"** section where step 3 gathered a failing lane or a replayed record carried one — each lane with the cause found and its disposition (fixed, re-run as an evidenced flake, or left for the maintainer's choice) — any ambiguous/skipped or newly-arrived items still needing a decision, and (in hands-off runs) every automatic low-stakes decision and every item skipped for lack of feedback.
   In this comment, avoid bare `@codex`/`@claude`/`@copilot` mentions (write "codex"/"claude"/"copilot" plain) so only the dedicated ping comments below trigger a review.
6. **Pings** — only after the push and summary succeeded, **and only when the push actually advanced the branch** (skip all pings on an "Everything up-to-date" no-op push, even when `ping-*` was supplied).
   `ping-codex` → a dedicated comment whose body is `@codex review`; `ping-claude` → a dedicated comment whose body is `@claude review` — both posted with `gh pr comment <PR#> --repo <owner>/<repo>`; `ping-copilot` → `gh pr edit <PR#> --repo <owner>/<repo> --add-reviewer @copilot`, never an `@copilot review` comment (its table row says why).
   **Guard first:** check `gh --version` against the `ping-copilot` row's gh floor; if the request errors on an older `gh`, **skip the Copilot request without failing the run** — the push and summary already succeeded — and report that Copilot was not summoned (upgrade `gh`, or re-request from the PR's web reviewer menu).
   **Confirm the request from the timeline, never from `gh pr view --json reviewRequests`:** that GraphQL-backed field reads back empty on a request that succeeded, and REST `gh api repos/<owner>/<repo>/pulls/NUMBER/requested_reviewers` lists the request only while it is still pending, so it can confirm one but never refute one — the durable evidence is a `review_requested` event in `gh api --paginate repos/<owner>/<repo>/issues/NUMBER/timeline`.
   Match that event to *this* request by identity: a repeatedly reviewed PR already carries older `review_requested` events for the same reviewer, so snapshot the `id`s of the events naming the intended reviewer *before* issuing the request, and afterwards require one that is not in that snapshot.
   Compare by event id, never against your own clock.
   Paginate **both** reads: the timeline is oldest-first and pages at 30.
   If no unseen event appears, record that request as unconfirmed and carry on with any pings that remain — do not fail the run, and do not issue this one again: the timeline is eventually consistent.
   An empty `reviewRequests` read is not a failed request — do not re-issue on the strength of it.
   When `ping-contributing` is in effect — including on a bare default run — determine which bots brought a new finding this round (its table row defines what counts) and ping only those; note each skipped bot in the summary.
   If more than one bot remains, perform each as its own dedicated action.

### Step 8 — Final report

Post the disposition record first, where this run leaves one ("The durable disposition record" says which runs do): the tips it cites — its `final HEAD` above all — are read in the working location, and a worktree already given back is no location to read anything in.
Then, in worktree mode, reclaim the worktree, per "Working location" — never in `delegated-fix`/`publish-reviewed`, where the worktree is the orchestrator's to reclaim (and it deliberately keeps a held descendant's).

Always produce a report (it doubles as the body of the Summary comment on push runs):

- The PR, the branch, before/after tip SHAs, and what each of step 2's two rebase points did — replayed, no-op, skipped as unnecessary (with why), or suppressed by `no-rebase` — plus the pinned effective base the run ended on and how any conflicts went.
  In `delegated-fix`, where those points are the orchestrator's, report the pinned effective base you were handed and carried rather than a rebase of your own.
- **The working location and how it was selected** — inline on the target branch, forced `inline`, or a worktree (created or reused) — plus whether that worktree was reclaimed, or its absolute path where a halt left it standing.
  Say nothing about where the main checkout points now: a worktree run neither moved it nor watched it.
- Each addressed comment with a **stable reference** — file:line, comment author, the thread's GraphQL node id, and the comment permalink — and its disposition (fixed / already-addressed / pushed-back / follow-up-task / skipped).
  On a **no-push** run this mapping is essential: a later "push now" turn uses it to replay the exact replies/resolves without re-deriving everything.
- Push-backs, prominently, with rationale.
- Each failing CI lane step 3 gathered, with the cause found and what was done about it, and each lane replayed from a prior disposition record with its recorded cause and disposition — or, where there was neither, that the rollup was green or still running.
- Follow-up tasks, each with its committed file, queued or deferred placement, and whether it was maintainer-directed or agent-proposed.
- Proactive same-pattern fixes made beyond the literal comments.
- Reviewer outcome and how many iterations it took (and whether it hit the cap).
- Peer participation and outcome; note an unavailable/disabled/round-forfeited peer once with its reason, plus any discarded ungrounded findings.
- Anything blocked or skipped for lack of an authoritative decision, with what's needed to unblock — including misfired top-level bot findings step 3 took none of because their freshness was ambiguous, where a terminal no-op left no Summary comment to say so.
- The disposition record: its comment URL and whether it superseded a prior record or was posted fresh, or why the run left none.
  Where this run **replayed** a record, say what the branch's tree said about each recorded disposition — replayed, re-triaged because the fix was gone, or handed to the maintainer as unsettleable.

## The durable disposition record

Step 8's report is chat output, and dies with the session.
So every run that ends **without publishing in full** leaves that mapping on the PR itself, as one top-level comment.

**When it is posted.**
Any run holding a triaged disposition map that did not publish it in full: a `no-push` run, and a run that intended to publish and could not — stopped at step 6's round cap, halted on a blocker, or waiting on a maintainer decision.
Hands-off runs included.
A publication that stopped part-way is the same case rather than an exception: it has replies left to replay, so it leaves the record too — in the `part` state below, since `not published` is false once part of the map is on origin, while what the record may say of the tips follows the push rather than the map: "local only" is false where a push advanced the remote or an `Everything up-to-date` no-op found the tips already there, still true where what landed rode the API with no successful push.
A run that published posts none — step 7's replies, resolves, and Summary comment are the durable record there — and "published" means a publication whose own report can show it: an account of every item, and the URL of the Summary comment step 7 ends with.
A run reporting itself complete over less has not published in this sense, and neither has one whose account **contradicts** the claim: a report calling the publication complete while its own entries say a thread it owed a reply never got one — or while reporting that no push command succeeded, which no complete publication reports, step 2's push being where publication starts and an `Everything up-to-date` no-op push already reporting its success — is refused exactly as one that accounts for nothing — over the same set of what step 7 owes each disposition that the outstanding count below is taken over, so the two cannot drift apart.
It leaves the record, keeps its worktree, and reports an incomplete publication.
A run with nothing triaged posts none either, whether step 3's terminal no-op or a stop before triage: there is no mapping to replay, so say so in the report rather than posting an empty record.
One last run posts none: one whose review stopped without any reviewer round ever having passed over the map it holds — a round that never finished, over a tree nobody read.
That map rides out in the run's report instead.
That exemption is about the MAP and never about how the review stopped: a final confirmation pass that stops the cycle leaves an error standing over the map a round has just passed, and that map is recorded like any other.

**One record per PR per run, written by `record.sh`.**
`record.sh` sits beside this file and is run by absolute path, like `pr-branch.sh`, answering the same way: `outcome=` first, exit 3 on a stop, exit 1 on a failure.
After an exit 1 from `post` or `spend`, run `find` before writing again, since the write may have landed.
It words the record's header and makes the one write.
A record is a comment whose first line is the marker `<!-- address-review:disposition-record -->`, byte for byte, so a later run finds it by that marker and never by matching prose: `record.sh find --repo <owner>/<repo> --pr <N>` prints the most recent record of the authenticated user (`id=`, `url=`, `spent=`) and an `other=<url> <login> <updated-at> spent=<yes|no>` line for every further one.
Another actor's record shows only as an `other=` line, under `outcome=none` where you have none of your own, and is still the record to replay where it is the most recent.
`record.sh post` writes over that most recent record of your own where there is one and posts a new comment where there is none, so this run writes exactly one record, the same idempotence step 7 requires of thread replies.
Report the `other=` records it lists: nothing here deletes, sweeps, or expires a record, and another actor's is never written to.
**One map may not supersede: a map this run already knows is incomplete** — an item gathered and left with no disposition, one carrying two, or an entry publication rejected as unpublishable.
Pass `--incomplete`, which posts it as a *new* comment, leaves every earlier record standing, and says in the status line that it is partial, naming the record of yours that still stands.
Step 3's gather replays only the **most recent** record, so the partial record **carries the displaced record's orphaned entries forward**: every `## Threads` entry of the record this run replayed whose identity (`thread=<threadId or url>`, the url carrying its finding ordinal for a misfired finding) none of its own dispositions carries — a disposition that is itself the incompleteness (one of several naming the same gathered item, or one publication rejected as unpublishable) carrying nothing for this test, since its account of the item is the very thing the map cannot publish while the displaced record's entry is the only durable copy of a judged reply for it — is copied in verbatim and whole, marked as carried unchanged from that record, so the newest record stays the one complete replay surface while the older one stands as provenance — the next run's replay re-judges every entry against the tree either way, a carried one included.
**A run that publishes in full SPENDS the record it replayed:** `record.sh spend --repo <owner>/<repo> --pr <N> --branch <branch> --id <that record's comment id> --summary-url <the Summary comment's url>` empties it in place — the marker, the header line, and a `SPENT` status, with no `## Threads` block and no `## Summary comment` block.
It spends only a record already there: where the PR carries none, there is nothing to spend and nothing is posted, since a published run has nothing to hand forward.
`--id` is **the record this run replayed**, never the "most recent record of my own" that `post` selects on — the two differ where the record replayed is another actor's, and where the incomplete-map carve-out left a second one of this account's standing beside an earlier one.
Where it answers `absent`, the PR no longer carries that exact record of your own: nothing was written, and the report says so.

**Content.**
The header is the script's, worded from the facts you pass; the body is yours, on stdin — the `## Threads` block and the `## Summary comment` block:

```sh
record.sh post --repo <owner>/<repo> --pr 141 --branch task/141-foo \
  --state not-published --reason '<why, one line>' \
  --starting 9f3a1c2 --final abc1234 --head-oid 9f3a1c2 --base 21af561 \
  --validation PASS --reviewer 'Pass (2 rounds)' --peer forfeited <<'RECORD'
## Threads
[fixed]     SKILL.md:265  codex  thread=PRRT_kwDO...vv
            url:   .../pull/141#discussion_r369...
            reply: "Fixed in <tip>: gate merged parents on ..."
[push-back] SKILL.md:148  codex  thread=PRRT_kwDO...v1
            url:   .../pull/141#discussion_r369...
            reply: "<full drafted rationale, verbatim>"
[task]      SKILL.md:302  codex  thread=PRRT_kwDO...v2
            url:   .../pull/141#discussion_r369...
            reply: "Follow-up task committed: tasks/0NNa-foo.md — queued for an upcoming batch"
            -> tasks/0NNa-foo.md (queued)

## Summary comment (verbatim, ready to post)
<full markdown body>
RECORD
```

Write "codex"/"claude"/"copilot" plain in the body and in the facts: a bare `@`-mention would summon a review round for unpublished work, and the script stops on one (`mention`).
Where a reply or a finding quotes one verbatim, keep it inside a code span or a fenced block, which notifies nobody.

**Which `--state`** — the first of these that is true of the run, since each later one asserts more about origin than the ones above it allow:

- **`unknown` — the publication left no usable account of what it posted.**
  The per-item account is missing, incomplete while the PR already carries part of this map, names one item twice, or names an item that is no disposition this run holds — those entries are keyed by `threadId`/`url` — a misfired finding's url with its ordinal, a CI lane's identity as step 3 gathers it — never by a `ref`, which two threads a re-review left on one line share.
  Absence of a report is not evidence that nothing reached the PR: publication pushes first and replies after, so a stop after the push with nothing usable reported is the ordinary shape of a part-way stop.
  `--reason` says which facts are missing.
  Say what is unknown; never say nothing reached origin — and never say unknown of what the run does know: `--push` carries the one fact still held, `advanced` where the push moved the remote, `noop` where it was an `Everything up-to-date` no-op, `none` where no successful push is known.
  A report that broke its own required-field contract is distrusted **whole** rather than field by field, its per-thread half included: every thread entry carries the reservation to check it on the PR before replying or resolving, even where only the Summary URL is missing and the account looks complete.
  One empty account is complete rather than missing — a publisher whose push never succeeded acted on no thread, since the push precedes every reply and the Summary — and that run is `not-published`, or `unconfirmed` where its own push read-back is what stopped it.
- **`part` — part of the map is on the PR and the rest is not.**
  `--reason` says what landed and what did not.
  `--landed` names what **is on the PR**, never what this run itself did: each thread's end state when publication stopped, so a reply an earlier run posted, a reply skipped as a duplicate, and a resolve already done all count.
  `--outstanding` names what step 7 still owes, which is not every disposition without a reported reply: a standalone item is addressed in the Summary comment alone and is never resolved as a thread, and an ambiguous-skipped thread is deliberately left without a reply and left open, so both stand at "nothing is owed" on a *complete* publication.
  The **resolve** is owed over a narrower set again: step 7 resolves a push-back or a deferral only on a bot thread, so a human push-back or deferral is unresolved by policy on a complete publication — it is out of the resolve count, and its entry says the resolve turns on the maintainer's authorization rather than that one is still owed.
  `--push` is required here, and says what that means for the tips: `advanced` where a push put them on origin (name it in `--landed`), `noop` where they were already there, `none` where what landed rode the API with no successful push and the tips are still local.
- **`unconfirmed` — `pr-branch.sh push` answered `unconfirmed`, and nothing else was published.**
  Whether the ref moved is the one fact that stop failed to establish, so the record calls the tips neither published nor local; put what each push URL returned (the `readback=` lines) in `--reason`.
  The entries carry no reservation: the read-back stops ahead of the first reply, so what this run posted is not in doubt.
- **`not-published` — nothing of the map is on the PR.**
  A `no-push` run, a round cap, a blocker.
  Add `--push noop` where a push succeeded as an `Everything up-to-date` no-op and no reply, resolve or Summary comment followed: the tips are then already on origin, and the record must not call them local.

In `part` and `unknown`, every thread keeps its entry and its verbatim reply, and each entry says where it stands, from what the publication actually confirmed per thread rather than from what it set out to do: an entry whose reply is already posted says so and whether its resolve is still owed, and one the publication reported no outcome for says that rather than guessing either way, since a reply posted twice and a reply never posted are both worse than an entry that sends the next turn to look.

**Every entry carries the same field set whatever its disposition** — the stable reference (path:line, the comment author, and the thread's node id; for a standalone item, whose url is its permalink below and is written there once rather than in both slots, the comment author and — for a misfired finding — the finding's ordinal within its comment, `finding N of M`, since every finding that comment holds shares the one url — and, on its own `finding:` line, that finding's text verbatim as step 3 took it — as a one-line JSON string literal, its newlines and quotes escaped, since a finding is ordinarily several paragraphs or a code fence and placed raw would run into the entry's other slots — since the ordinal alone cannot tell the recorded finding from different text a later edit of the comment puts at N; for a CI lane, its identity as step 3 gathers it — its details URL names one head's run and the next push replaces it, so it is the lane's permalink rather than its identity), the permalink (the thread's, the standalone comment's url, or the lane's details URL), and the reply body verbatim — with a follow-up-task entry adding the committed file and its queued or deferred placement, and a standalone item or CI lane, which has no thread to reply on, carrying in the reply slot the Summary-comment text drafted for it (its cause and disposition, for a lane) rather than a reply nothing will post.

Everything else in the record can be re-derived from the PR.
The drafted reply bodies and the ready-to-post Summary body cannot, so they go in **verbatim**; step 8's report is the source of both.

**The SHAs are provenance, never a replay gate.**
They say what this run saw, not what a later run must find.
A rebase before the final push invalidates any `final HEAD == branch tip` assertion while changing nothing about whether the work is still there.
So never assert that equality, and never replay a recorded `Fixed in <sha>` citation as written: **re-derive every SHA from the branch at replay time**, so each reply cites a commit the branch actually carries.

**Replaying a record.**
What replay must establish is that the reviewed work is still in the branch, and the branch's tree as it now stands is the authority on that.

- **A spent record replays to nothing.**
  A record whose status line reads `SPENT` and which carries no `## Threads` block was emptied by the run that published its map, the marker kept so this step reads it as spent rather than as absent.
  It names no disposition and cites no final tip, so the probes below have nothing to run on: every gathered item is ordinary untriaged work, and the report says the record handed over was spent.
  The rest of this list is about a record that still holds entries.
- **Patch-id is the first probe, not the gate.**
  With `F` the recorded final tip and `B` the branch tip now, `git rev-list --right-only --cherry-pick B...F` printing nothing means every recorded commit is represented and the record replays as written — the same representation test step 1's reconciliation uses.
- **A non-empty result rejects nothing.**
  A rebase that resolved a conflict, or split or squashed a commit, mutates the resulting patch-ids while keeping the work — `rebase-stack` documents that as the patch-id cascade — and such a rebase is this record's expected case rather than an edge one.
  A probe that cannot run at all says the same: `F` may no longer be a local object (a fresh clone, a pruned repository), and an absent recorded commit is not an absent fix.
  Fall through to the tree.
- **Then judge per thread, against the tree rather than the record.**
  Is the fix this disposition claims present in the branch as it now stands — for a follow-up-task disposition, is its task file still committed there?
  Present → replay the disposition, its SHA re-derived.
  Genuinely gone → that thread loses its disposition and must **not** be replied to as fixed; re-triage it from scratch this run.
  Unsettleable from the tree → it goes to the maintainer with the record intact (hands-off: leave the thread open and report it), never discarded because a probe was inconclusive.
- **Replay against the threads as they now stand**, per step 3's unresolved-only rule.
  A record whose threads have since been resolved and published replays to nothing, which is the right answer rather than a conflict: a record is only ever the account of the run that wrote it.
- **A recorded standalone item is gathered again.**
  Re-fetch each standalone url the record names and reintroduce the comment as an item where it is still there — an earlier run having gathered it, by the request that identified it or as a misfired finding that qualified on its own, is what makes it one — then judge it against the tree like any other.
  A misfired finding is reintroduced by its recorded ordinal, checked against the finding's text the record carries for it, decoded from the JSON string literal its `finding:` line holds — the record carries it for exactly this, since the ordinal alone cannot tell the recorded finding from whatever text a later edit puts at N — and where the comment now holds fewer than M findings, or the text at N differs from the recorded text beyond whitespace, the body was edited or reordered since and that entry is unsettleable and goes to the maintainer rather than being matched to whichever finding now sits at N.
  Where the comment is gone, it is not outstanding work and that entry replays to nothing.
  A recorded CI lane is re-gathered in the same spirit: step 3 reads the rollup of the current head, and where that lane — matched by the identity step 3 gathers, the new head's run carrying a new details URL — is still failing it is an item again, judged against the tree like any other; where it has since gone green — the push that recorded it re-ran it — or is still running, nothing re-gathers it, so the entry replays as its recorded cause and disposition into this run's Summary comment rather than being dropped, since a green lane on the new head is the outcome the entry claimed and its account is what is still owed.
  The same holds where no lane of the current head's rollup carries the recorded identity at all — the workflow or check renamed or removed since, or not fired for this head by a path filter: the entry replays as its recorded account with that absence named, for the maintainer to read, rather than falling out of the run because nothing matched it; no state of the rollup drops a recorded lane, so an otherwise clean PR still carries that account out rather than taking the terminal no-op over it.
  What ends this — the standalone half's answer to the unresolved-only rule the thread half self-terminates on — is the spend above: the run that publishes such an entry leaves a record with no entries at all, so nothing is re-gathered from it again.

## Hands-off mode

Purpose: run inside a parallelized agent that has no direct line to the user (e.g. a review orchestrator's subagent).
Reach the orchestrator if you can, but otherwise drive to a best-effort completion and **document, never guess on high-stakes choices.**

- Every stop tagged "(hands-off: …)" inline applies as written, and so does every unconditional stop (a rejected lease, the reviewer cap): do not force or guess your way past it.
- Ambiguity → step 4's rule: a recorded best-effort call only when stakes are low; otherwise skip, do not guess, and document precisely what's needed.
- A real concern whose fix would expand the PR's scope, on a branch that is defendable as it stands → postpone it to a committed follow-up task (step 5) and flag the task and any deferred placement prominently; this is a legitimate unattended resolution, not a skip.
- A delegated-rebase halt — step 2's "A halt is a stop, not a guess" defines the cases, and this list does not restate them → the step leaves the tree clean and idle, and the run stops with the halt's open question.
  Nothing is pushed on the old base instead.
- At top level, fixer/reviewer subagents are still fine.
  In `delegated-fix` mode, do not attempt nested delegation; return the packet to the orchestrator.
  Every skipped/blocked item must appear in the final report (and the Summary comment if pushing) so the user learns of it and can act later.

## GitHub API recipes

`gh api` expands `{owner}`/`{repo}` to the current repo.
For GraphQL, pass real values — the `<owner>`/`<repo>` of the PR's own URL.
Qualify every PR-scoped call with the `<owner>/<repo>` of the PR's own URL (`repos/<owner>/<repo>/…`, `--repo <owner>/<repo>`) rather than letting it default to whatever repository the directory resolves to.

**List unresolved review threads** (id for resolve, comment `databaseId` for replies).

**Primary — run the GraphQL query by hand.**
Single-shot query — do **not** use `--paginate` here: run concurrently with other `gh` GraphQL calls (e.g. an `address-reviews` fan-out), `gh api graphql --paginate` has returned **another PR's** review threads, which unguarded would misfile replies/resolves onto the wrong PR.
One page covers most PRs (`totalCount` ≤ 100); when `reviewThreads.pageInfo.hasNextPage` is true, fetch the next page as a fresh single-shot call passing the returned `endCursor` via `-F after=CURSOR`, and likewise fetch a thread's remaining comments when its nested `comments.pageInfo.hasNextPage` is true — always before triage:

```sh
gh api graphql -f query='
query($owner:String!,$repo:String!,$pr:Int!,$after:String){
  repository(owner:$owner,name:$repo){
    nameWithOwner
    pullRequest(number:$pr){
      number url
      reviewThreads(first:100,after:$after){ totalCount nodes{
        id isResolved isOutdated path line
        comments(first:100){
          nodes{ databaseId author{ login __typename } body diffHunk url }
          pageInfo{ hasNextPage endCursor }
        }
      } pageInfo{ hasNextPage endCursor }}
    }
  }
}' -F owner=OWNER -F repo=REPO -F pr=NUMBER   # for pages after the first, add: -F after=CURSOR
```

**Optional accelerator — if `gh-review-threads` is available on PATH** (`command -v gh-review-threads`), prefer it: it encodes the query above plus the whole validation contract below (fresh single-shot per-page pagination, nested comment fetch-up, identity/shape/scope checks), retrying once and then failing closed with exit code `3` and nothing on stdout when validation keeps failing; ordinary `gh` API failures remain ordinary fatal errors.
`gh-review-threads <PR#>` prints the unresolved threads as a JSON array on stdout — each thread with `id isResolved isOutdated path line` and `comments[]` (`databaseId`, `author { login __typename }`, `body`, `diffHunk`, `url`); add `--all` to include resolved threads.
Qualify it like every call here — `--repo <owner>/<repo>` from the PR's own URL.

```sh
gh-review-threads --repo <owner>/<repo> NUMBER | jq '...'   # unresolved threads, scope-checked
gh-review-threads --all --repo <owner>/<repo> NUMBER        # include resolved threads too
```

**Validate identity, shape, pagination, and scope before acting** (the helper, where used, does this for you; this governs the hand-run recipe): on every page, compare `repository.nameWithOwner` to `OWNER/REPO` case-insensitively and `pullRequest.number` to `NUMBER` exactly before inspecting comments; this positive identity check catches crossed responses even when there are zero comments.
Require `reviewThreads.nodes` and every comment `nodes` value to be arrays, every `hasNextPage` to be a JSON boolean, and every cursor promised by a true value to be a non-empty string.
Then require every returned comment `url` to match the exact repo-qualified PR path for the PR you are addressing, for example `https://github.com/OWNER/REPO/pull/NUMBER#...`.
Implement the URL check as a boundary-safe match on `OWNER/REPO` plus `/pull/NUMBER` followed by `#`, `/`, `?`, or end; do not use a plain substring check, because `/pull/12` also appears inside `/pull/123`.
An identity mismatch, malformed thread/comment shape or pagination metadata, comment-URL extraction failure, or URL mismatch means the response is untrusted — discard the entire result, retry once with a fresh single-shot query, and if it repeats fail closed; never reply to or resolve a thread from an unvalidated response.

**Reply to a review comment** (REST, threads the reply under the original):

```sh
gh api --method POST repos/<owner>/<repo>/pulls/NUMBER/comments/COMMENT_DATABASE_ID/replies -f body='Fixed in <sha>: ...'
```

**Resolve a thread** (GraphQL, using the thread `id` from the query above).
This mutation takes a global node id and has no repository argument to qualify, so what qualifies it is that id's **provenance**: it comes from the thread list above, whose scope check already required every comment `url` to name this PR in this repository.
So pass an id that list gave you and never one re-derived in some other way — a thread id fetched without that check is a thread resolved in whatever repository the working location answers for:

```sh
gh api graphql -f query='mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}){ thread{ isResolved } } }' -F id=THREAD_NODE_ID
```

**Top-level comments** (summary and codex/claude pings):

```sh
gh pr comment NUMBER --repo <owner>/<repo> --body '...'        # Summary of Review Fixes
gh pr comment NUMBER --repo <owner>/<repo> --body '@codex review'
gh pr comment NUMBER --repo <owner>/<repo> --body '@claude review'
```

**Request a Copilot review** — this request, never an `@copilot review` comment (the `ping-copilot` table row says why and carries the gh version floor):

```sh
gh pr edit NUMBER --repo <owner>/<repo> --add-reviewer @copilot
```

**Read context:** `gh pr view NUMBER --repo <owner>/<repo> --json reviews,comments,headRefName,headRefOid,isCrossRepository,baseRefName,url,state` and `gh api --paginate repos/<owner>/<repo>/issues/NUMBER/comments`.
