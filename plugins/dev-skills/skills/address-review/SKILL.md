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
| `ping-copilot` | After a push that advances the PR branch, request a fresh Copilot review (a reviewer request; needs gh ≥ 2.88.0) — **never** an `@copilot review` comment, which drives Copilot's coding agent (it can start editing the branch) rather than its reviewer. |
| `ping-contributing` | **The default** — a bare run behaves exactly as if you passed this. As a **modifier** on the ping set: re-ping a bot only if it **brought a new finding this round.** Combined with explicit `ping-codex`/`ping-claude`/`ping-copilot`, it filters that named set down to the contributors; supplied **alone** (or as the bare default), it falls back to every known bot (codex/claude/copilot) that reviewed this round. *Brought a new finding* = authored ≥1 thread this round that surfaces a real concern not raised before on this PR (typically `actionable-fixed`, or a genuinely new `follow-up-task`/`already-addressed`); it does **not** count a `push-back` (the comment was wrong), a re-raise of a concern already captured in a committed task, or a bot re-arguing a push-back it already lost — **unless** that thread carries a genuinely new angle this round. |

### Flag interactions

Push unless `no-push`.
Ping the named bot(s) if any were named (filtered to contributors when `ping-contributing` is also present), else **nobody** when `push` was spelled out, else the **contributing** set (the bare default, identical to `ping-contributing`).

- **`no-push` wins.**
  Combined with `push`/`ping-*` (a contradiction), honor `no-push` and note the ignored flag.
- **A ping fires only when the push actually advanced the branch.**
  If this run produces nothing new to push — every disposition was already-addressed or push-back, or the branch was already up to date — **skip the pings.**
- **A push whose only content is wording-level fixes summons no fresh review round.**
  Where everything pushed is wording, grammar, typos, comment phrasing or formatting — judged on the pushed diff, as `review-cycle`'s close-out is — skip the pings and say so in the summary.
- **`ping-contributing` prunes the ping set per this round's triage** (its table row defines what counts as a new finding).
  It never adds a bot you did not name, and a round in which no candidate bot brought a new finding pings no bot — even while the push itself advanced (e.g. you fixed a human's thread).
- **Multiple pings present** → each is its own dedicated action (a separate comment per named bot; a reviewer request for Copilot), never a single comment mentioning several, which is how `ping.sh` makes them.
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
The base those attaches place a worktree under is that recipe's too, and its ignore rule comes with it: `git worktree add` excludes nothing on its own, so before the first attach run `bootstrap.sh ignore` — the script in the sibling `address-tasks` skill folder, run by absolute path — and do not establish the rule by hand.
Where `<repo>/.worktrees/` is not already ignored it lists it in the repo-local exclude file, untracked and so dirtying nothing itself, rather than in the tracked `.gitignore`, which is the maintainer's, and its `wt-base=` line names the base.
Its `outcome=stop` does not halt this run as it halts a batch, where the answer still carries a `wt-base=` line: attach all the same, and carry its `blocker=` line into the final report, because the main checkout shows `?? .worktrees/` for as long as that worktree stands.
A stop with no `wt-base=` line found no checkout to hold the worktree: report its `blocker=` line and attach nothing.
Any other non-zero exit prints no `outcome=` line and no base: report its stderr and attach nothing.
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
- **Rebaser** (default, once per rebase point that is not a proved no-op) — a fresh subagent that performs one of step 2's rebase points under `review-cycle` → "The delegated rebase step", and hands back the pinned effective base, the before/after tips, and any halt.
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
A point is skipped on proof and never on an impression that the base has not moved: `review-cycle`'s `rebase-facts.sh before` answering `outcome=noop` for the pinned target is that proof, and the report quotes it.
`no-rebase` suppresses **both** points, and nothing else does.
`rebase on top of <target>` replaces the default target with the one it names.
Given both, honor `no-rebase` and note the token it overrode, exactly as `no-push` wins over `push` — overrode for the rebase, and no further: the target still stands, and step 6 pins IT as the effective review base rather than `baseRefName`, since the branch was deliberately based on it.

**Do not run the rebase in your own turn.**
Delegate each point that is not skipped to a fresh subagent under `review-cycle` → "The delegated rebase step", which defines that brief whole — the facts read before the spawn and what each answer decides (`review-cycle`'s `delegating-a-rebase.md`), the pre-rebase recovery ref, the base pinned to the OID actually rebased onto, the hunk-level conflict rules it takes from `rebase-stack`, the clean halt, the validation, and the packet it hands back.
What is specific to one PR:

- **The target.**
  By default the PR's own `baseRefName`, fetched fresh at the point the rebase runs rather than read from a remote-tracking ref some earlier step updated — and fetched from the repository that ref lives in, which is the repository this PR is in: pin it immediately before the point with `pr-branch.sh pin-base --repo <owner>/<repo> --base <baseRefName>`, the `<owner>/<repo>` being the one in the PR's own `url`.
  `rebase on top of <target>` names a branch or an exact commit instead (a batch orchestrator pins one commit so every entry rebases onto the same base), and that one is resolved where the maintainer named it — locally, in the working location — rather than fetched, since an explicit token routinely names a local branch that the remote has no such ref for (`pr-branch.sh pin-base --target '<target>'`).
  Either way the commit that pin prints is what `rebase-facts.sh before` is asked about and what the delegated step is handed.
  Either way this is a **single-branch** rebase: a whole chain of dependent branches is the separate `rebase-stack` skill — mention it if the user seems to want chain-wide restacking.
  Where this PR's base is another in-flight PR's head, the target is that parent's new tip, per the delegated step's parent-first rule — which for a single-PR run reduces to that branch's tip as freshly fetched, since nothing here rebases the parent; a batch orchestrator holding the parent map is what rebases it first and then pins the resulting tip as this entry's target.
- **Where it runs.**
  The working location, like everything else after step 1.
- **Both points are this run's own** at top level, the second once every intended change is committed, so the packet a top-level run reports has the rebased tip as its final SHA.
  In `delegated-fix` neither point is this run's ("Delegated modes for the worktree orchestrator"), and a `publish-reviewed` run rebases nothing.
- **The pinned effective base is this run's effective review base** (step 6) and the boundary of every range you delegate afterwards.
  Take it from the returned packet — the OID that rebase actually landed on — and never re-derive it later from `baseRefName` or `origin/<base>`.
- **The second point runs before each reviewer round**, so a passing verdict describes the tree step 7 pushes.
  Where it replayed anything, step 6 reviews the rebased tree, and the replay's delivery-tier validation runs unless `rebase-facts.sh after` carries step 5's across it; where it was a proved no-op, the tree the reviewer sees is already the one being pushed.
- **A halt is a stop, not a guess.**
  A conflict beyond the delegated step's competence — or a merge carrying its own content, met before any replay (the conflict is aborted; the merge starts no rebase, so there is nothing to abort) — comes back as an open question with the tree left clean and idle.
  **Interactive:** put that question to the user — what it turns on, your proposed resolution, and the reasoning — and hand their answer to a *fresh* rebase subagent rather than finishing the rebase in your own turn; loop them in as many times as needed.
  **Hands-off:** the run stops there having pushed nothing, with that open question and its detail (the offending commit, the files, why) as the blocker.

If either rebase changed the branch tip, expect the eventual push to be a force-push (step 7's exact `--force-with-lease`).

### Step 3 — Gather the review feedback

Fetch the **unresolved** review threads and enough context to judge them (see "GitHub API recipes"):

- **Review threads** (inline comments): run `gh-review-threads.sh --repo <owner>/<repo> <N>` — beside this file, run by absolute path — which prints every **unresolved** thread as a JSON array: each thread's `id`, `path`, `line`, `isOutdated`, and every comment's `databaseId`, author login/type, `body`, `diffHunk`, and `url`.
  It pages by hand and checks that every response names this repository and PR and that every comment `url` belongs to this PR, because a paginated query run beside other `gh` calls has returned **another PR's** threads.
  Exit 3 with nothing on stdout is a response that failed that check twice: stop, and never reply to or resolve a thread from a list fetched some other way.
- **CI on the PR head:** run `ci.sh lanes --repo <owner>/<repo> --pr <N>` — beside this file, run by absolute path, and answering like the other helpers.
  It reads the head's status rollup the way README's *Contributing* reads it — by `__typename`, terminal values tested positively — and prints a `lane=` line for every instance whose verdict is not `SUCCESS`/`NEUTRAL`/`SKIPPED`: its identity, its kind, its verdict and its details URL.
  Every such lane is a review item too, gathered with that identity — `<workflow> / <job>` for a GitHub Actions check run, `<app slug> / <check name>` for another app's, so two apps emitting one check name stay two lanes, and the `context` of a commit status; an identity printed more than once, one workflow fired by several events on the head, holds one lane there, failing while any instance is.
  For an `actions` lane, gather the failing job's log tail with `ci.sh log --url <details-url>`, which reads the repository and the job out of that URL rather than leaving them to the checkout's default; an exit 1 from it is a failed gather to stop on rather than an empty tail that reads as evidence.
  A `status` or `external` lane has no workflow run at all, so `gh run` can neither read nor re-run it (`log` answers `no-logs`): gather it with its details URL as the only details mechanism, and record that logs and re-runs are unavailable through `gh run`.
  It names every passing lane too (`passing=`), which is not an item but is how a lane a prior record named is told as green now from absent from this head altogether.
  A lane still in progress on the current head (a `running=` line) is not an item: note it and let the push, or the re-run below, settle it.
  A rollup describing a head other than the one you reconciled against (its `head=` line) says nothing about this branch; re-read it after the push instead.
- **Submitted reviews:** run `reviews.sh --repo <owner>/<repo> --pr <N> --head <the head step 1 reconciled against>` — beside this file, run by absolute path from the working location, and answering like the other helpers.
  It prints one `review=` JSON line per submitted review: its author and whether that is a bot, its state, the commit it was written against and whether that is still the head, its permalink, its body, how many inline comments it authored, the top-level comments that cite it, and the entries of any suppressed-comment block in its body, each with its file, its line and whether that file changed since the review's commit.
  It checks that every object it read belongs to this PR as the thread fetcher does, and exit 3 is a listing that failed that check twice: stop rather than read the reviews some other way.
- **Top-level review summaries** (`gh pr view --json reviews`) and **issue comments** (`gh api --paginate repos/<owner>/<repo>/issues/<N>/comments`) — read for context, especially **maintainer replies/push-backs** that override or qualify a bot's original comment.
  They are not automatically actionable because they have no resolved/unresolved state; include a standalone item only when the maintainer explicitly identifies it as outstanding in the request or discussion — or when a prior disposition record already holds a standalone disposition for it, which is an earlier run having gathered it — by the request that identified it or as a misfired finding that qualified on its own — and is what makes that entry replayable at all (`disposition-record.md` → "Replaying a record").
  A bot reviewer sometimes misfires, posting its findings into a top-level review summary or issue comment instead of threads.
  Where a bot's top-level review or comment on this PR states a finding of its own about the code — as against an overview of the threads it opened, or a bare status — or the listing shows a `suppressed` block, or a bot's review with a body beside `inline: 0`, read `misfired-findings.md`, beside this file, in full before triage: it says which of those findings are taken as standalone items without the maintainer naming them, the identity each is carried under, and how a review that claims findings it never delivered is named.
  Where none of those is there, there is nothing to take and that file is not needed.
  Among them, look for a **prior disposition record** left by an earlier run of this skill, found by its marker rather than by its prose: `record.sh find --repo <owner>/<repo> --pr <N>`, beside this file and run by absolute path, answers `outcome=none` with no `other=` line where the PR carries none, and otherwise prints the record (`id=`, `url=`, `spent=`) or an `other=` line for another actor's ("The durable disposition record").
  That comment is this skill's own output rather than feedback: it is never a work item and carries no maintainer authority, and what to do with it — replay it, and supersede it rather than appending a second — is that section's.

A maintainer reply on an unresolved thread is **authoritative**: if they said "skip this" or "do X instead," follow the maintainer over the original reviewer.
The same authority extends to a **top-level decision comment** — a maintainer comment that walks the open feedback and records a verdict per item (often titled "Maintainer Decisions" or similar).
Treat each recorded decision as the binding disposition for the thread(s) it covers — including "postpone to a follow-up task" and "keep as-is" — rather than re-triaging those threads from scratch.
Treat `isOutdated` as context, not a disposition: inspect the current code and re-locate the concern rather than auto-dismissing an outdated thread.
If there are no unresolved threads, no standalone items — explicitly included or qualified on their own as fresh, applicable misfired findings — and no failing CI lane gathered above or replayed from a prior disposition record — a red lane is an item like any other, so a run that gathered one never takes this exit, and a recorded lane whose account is still owed (`disposition-record.md` → "Replaying a record") is outstanding whatever the rollup says of it now — first compare the current `HEAD`, the starting tip, and the recorded PR `headRefOid`.
In every mode, stop as a successful terminal no-op only when `HEAD == starting tip == headRefOid`; an unchanged local tip that is already ahead of or divergent from the recorded PR head is not a no-op.
Every other case follows the zero-item path: in `delegated-fix`, return the complete packet through step 5 so the orchestrator can review and, when enabled, publish it; outside `delegated-fix`, continue through the normal fresh review and, unless `no-push`, publication.
This includes both a rebase that changed `HEAD` and any already-unpublished local tip.
A zero-item path makes no synthetic commit, and a terminal no-op makes no commits, push, ping, or summary comment.
A bot review that claims findings it never delivered (`misfired-findings.md`) is no item and changes neither exit, but a terminal no-op that read one names it in step 8's report rather than reporting only that there was nothing to address.
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
  An evidenced flake is re-run rather than fixed (`ci.sh rerun --url <details-url>` for an Actions lane — once per run, the run and its repository read out of that URL: several failed jobs of one run share its id and `--failed` re-runs them all, and a second request meets a run already re-running; a lane with no workflow run is left for the maintainer, since nothing here can re-run it), and only where the run pushes nothing new, since a push re-runs it anyway; a flake that has bitten before earns a follow-up-task item to fix the flake itself, offered rather than assumed on an interactive run.
  Those three are a failing lane's only dispositions — **already-addressed** is the replay disposition of a recorded lane this head shows green, running or absent, and a fix the tree already carries for a lane still red on the head (this branch's from an earlier run, or the base's after a rebase) is **actionable** with where the fix lives, since only the push re-runs the lane.
  Every CI item reaches the Summary comment with its cause, whichever way it went: a lane has no thread to reply on.
- **Ambiguous** — the right fix needs an authoritative decision you cannot make from the code/history.
  **Interactive:** ask the user.
  **Hands-off:** make a best-effort call only when stakes are low; otherwise skip and document it — do not guess where an authoritative determination is required.

A thread asking you to **document** some behavior is satisfied by a minimal why-comment under `review-cycle`'s comment rule, which that skill's `fixer-brief.md` states (an actionable fix), or — where no comment would earn its keep — by push-back; never by adjacent code re-implemented in prose.
There is no reply-only disposition: the fuller rationale rides the reply whichever disposition you chose already posts on the thread, so pick the one that is true of the committed code rather than the one that suits the reply.
Where such a push-back is sustained, that rule's carve-out for a standing overruled decision is worth the comment precisely here: an external reviewer re-raises the same point across PR rounds and runs, and nothing in this run's replies is in front of it next time.

### Step 5 — Fix

For the actionable items:

- **Small/surgical** → fix directly in your own context, committing at logical milestones.
- **Large/multi-file/exploratory** → spawn a **Fixer** subagent (see Architecture and the prompt sketch below).
  One at a time; await its commits before moving on.
- **Reproduce what a finding names:** where a finding names the conditions it fails under and they can be built cheaply, build them and watch it fail before changing anything and pass after, then hand the recipe to the Reviewer in step 6.
  Where they cannot be built, say so in the reply.
- **Preclude repeat comments:** for each pattern you fix, grep the PR's changed files and closely related code for the **same offending pattern** and fix those too, so the next review round doesn't re-raise it.
  Mention these proactive fixes in the summary.
- Keep commits buildable where practical, and validate at `review-cycle`'s tiers: the round tier while iterating, and the delivery tier — the full applicable sanity set — on the state you publish, before step 7 pushes.
- Before review, apply `review-cycle`'s packet hard-check to the working location: `git status --porcelain` empty **and** no Git operation in progress.
  Inspect and commit every intended change; if a fixer leaves partial or unexplained changes, resolve that state or stop rather than letting the reviewer inspect only the committed subset.
- Then run **step 2's second rebase point** — after that hard-check passes, before anything reaches review or publication.
  Its pinned effective base supersedes the first point's for step 6's brief and every later range, and a replay that does not carry step 5's validation runs its delivery-tier validation there rather than leaving step 6 to discover the breakage.
  In `delegated-fix` that point is the orchestrator's: leave the worktree clean at the hard-check and return the packet.

For the **follow-up-task** items, write the task file(s) following the `write-tasks` skill conventions (invoke that skill where available):

- Follow whatever task layout the repo already uses.
  Default to its task folder (commonly `tasks/`): a planned follow-up stays queued and numbered there even when it has prerequisites, which the task must state so its ordering remains visible.
- Use the deferred subfolder (for example, `tasks/deferred/`) only for deliberately unscheduled work: it depends on functionality that is not certain to arrive; it addresses a condition that cannot occur yet or has not manifested, and fixing it would be costly; or it awaits a spike or decision between competing options.
- When unsure, prefer `tasks/`: a mis-queued task can be reprioritized during a batch, while a mis-deferred task is easily forgotten.
- Number each file to continue the folder's existing sequence, slotted by priority/intended order, by the allocation rule in that skill's "File naming and ordering": `task-numbers.sh taken --repo <owner>/<repo>`, in the `write-tasks` skill's folder beside this skill's, lists every number standing in the working tree and on every open PR head, so a number a head holds is not reused; `outcome=incomplete` means the allocation is not fully checked, which is reported and stops nothing.
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
  The effective review base is the **pinned OID** step 2's latest rebase point landed on — the same commit every delegated range is taken against; a point skipped as a proved no-op was pinned all the same, and that pin is the commit it landed on; under `no-rebase`, where nothing was pinned, pin the target the rebase would have used, once here instead, with `pr-branch.sh pin-base`.
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

**Which repository every command below addresses: the one the PR is in**, written out literally as `--repo <owner>/<repo>` from the PR's own URL rather than left to default.

1. **Re-check and push:** run `pr-branch.sh push --repo <owner>/<repo> --pr <N> --expect <headRefOid>`, naming the head step 1 reconciled against.

2. **Read its outcome:**
   - **`pushed`** → the branch advanced (`advanced=yes`), and `head=` is what origin now carries.
   - **`up-to-date`** → the tip was already the PR head, so the push was the `Everything up-to-date` no-op (`advanced=no`); carry on with the PR-side communication.
   - **`behind`, `head-moved`, `rejected`** → nothing was pushed, and for `rejected` every push URL answered the read-back without the tip: stop and report.
     Reconcile nothing to make the push legal, and **never** escalate to a bare `--force`.
   - **`unconfirmed`** → some push URL does not show the tip at the head ref or did not answer, whether the push command returned or was refused (`push-command=`), so whether it reached origin is unknown: stop, and render the disposition record as its read-back case.
   - **`refused`** → git refused the push although every push URL already shows the tip (a hook said no, or the same commit arrived another way): this run published nothing, so stop and report.
   - **`fork`, `closed`, `wrong-branch`, `no-remote`, `dirty`** → stop and report what it said.

3. **Re-read unresolved threads after the push.**
   Re-run any lane step 4 judged a flake only where the push was a no-op — a push that advanced the branch already re-ran every lane, and this run does not wait on the fresh rollup: CI gates the merge, and the next round reads it.
   Each re-run request is part of the publication's success contract: report which run ids' `gh run rerun` was accepted, per id rather than per lane — a repeated lane names several runs and each request accepts one, and the lane counts as re-run only where the accepted ids cover every run it names — and where one was rejected or failed the publication has not completed — stop before the replies, report the failure with the lane and what `gh` returned, and leave the disposition record as any part-way publication does, since the one action that disposition promised never happened while the lane stays red; the record names the accepted ids beside the owed ones, so the next turn orders only the rest rather than meeting an accepted run already re-running.
   A thread it shows that this run did not triage gets no line below: it stays open, called out in the Summary for the next pass.
4. **Per-thread hygiene** — one line per triaged thread in a dispositions file, `<thread id> TAB <action> TAB <reply file>`: `resolve` replies and then resolves, `reply` replies and leaves the thread open.
   Where your reply to this finding already stands on the thread (a replayed record says so, or the thread shows it), compose no second one: write `-` for the reply file.
   A reply that answers a comment made after yours is a new reply and takes its file.
   - *Actionable-fixed* → `Fixed in <sha>: <one line>`; `resolve`.
   - *Already-addressed* → where it's handled; `resolve`.
   - *Follow-up-task* → the placement-specific template: queued work uses `Follow-up task committed: tasks/NNN[a-z]?-… — queued for an upcoming batch`; parked work uses `Deferred with full context to tasks/deferred/NNN[a-z]?-… — <the condition it waits on>`, where the lowercase letter suffix is optional.
     `resolve` when the follow-up was maintainer-directed or the thread is bot-authored; else `reply`, leaving a human-authored thread unresolved unless the maintainer authorized closing it.
     Never re-implement a task-backed thread.
   - *Push-back* → the rationale, flagged prominently in the summary.
     `resolve` on a bot-authored thread once independent review validated the push-back; `reply` on a human-authored one unless the maintainer explicitly authorized resolving it, so unattended runs do not silently close a person's objection.
   - *Ambiguous/skipped* → **no line**: it stays open, listed in the summary as needing a decision.
5. **Summary comment** — post a top-level **"Summary of Review Fixes"**: write it to a file and run `publish.sh --repo <owner>/<repo> --pr <N> --dispositions <file> --summary <file>`, beside this file and by absolute path (`--no-threads` where step 4 produced no lines).
   It posts step 4's replies and resolves, then the Summary (`summary=` is its URL); `partial` (exit 3) is finished by running it again with the same files.
   `malformed` or `no-reply`: correct the line and run it again; still `partial`, or any other stop: report its lines, and write nothing by hand in its place.
   Structure: what was fixed (with proactive same-pattern fixes called out), a **prominent "Pushed back — please re-examine" section** for every push-back with its rationale, a **"Follow-up tasks" section** listing each item with its committed task file (explicitly flag deferred placement and flag agent-proposed follow-ups for confirmation), a **"Top-level findings"** section for every standalone item taken from a bot's misfired top-level comment (step 3), each with its disposition and the permalink of the comment it came from, since no thread carries the reply — a **"Review input that never arrived"** section for every bot review step 3 found claiming findings it delivered none of, with its permalink — a **"CI"** section where step 3 gathered a failing lane or a replayed record carried one — each lane with the cause found and its disposition (fixed, re-run as an evidenced flake, or left for the maintainer's choice) — any ambiguous/skipped or newly-arrived items still needing a decision, and (in hands-off runs) every automatic low-stakes decision and every item skipped for lack of feedback.
   In this comment, avoid bare `@codex`/`@claude`/`@copilot` mentions (write "codex"/"claude"/"copilot" plain) so only the dedicated ping comments below trigger a review.
6. **Pings** — only after the push and summary succeeded, **and only when the push actually advanced the branch** (skip all pings on an "Everything up-to-date" no-op push, even when `ping-*` was supplied).
   Run `ping.sh --repo <owner>/<repo> --pr <N> <the reviewers to ping>` — beside this file, run by absolute path — naming `codex`, `claude` and `copilot` as the ping set holds them.
   Anything but `pinged=` (exit 3, `outcome=partial`) never fails the run — the push and summary already succeeded — so report it as the line gives it and carry on: `unconfirmed=` as requested but unconfirmed, `skipped=` and `failed=` as not summoned, with the reason.
   Never issue an `unconfirmed` Copilot request again: the helper confirms it from the PR's timeline, which is eventually consistent, and a second request is a second review.
   When `ping-contributing` is in effect — including on a bare default run — determine which bots brought a new finding this round (its table row defines what counts) and ping only those; note each skipped bot in the summary.

### Step 8 — Final report

Post the disposition record first, where this run leaves one ("The durable disposition record" says which runs do): the tips it cites — its `final HEAD` above all — are read in the working location, and a worktree already given back is no location to read anything in.
Then, in worktree mode, reclaim the worktree, per "Working location" — never in `delegated-fix`/`publish-reviewed`, where the worktree is the orchestrator's to reclaim (and it deliberately keeps a held descendant's).

Always produce a report (it doubles as the body of the Summary comment on push runs):

- The PR, the branch, before/after tip SHAs, and what each of step 2's two rebase points did — replayed, replayed with the validation carried (the tip it ran on, the tip it was carried to, and the `outcome=carry` answer), skipped as a proved no-op (with the proof), or suppressed by `no-rebase` — plus the pinned effective base the run ended on and how any conflicts went.
  In `delegated-fix`, where those points are the orchestrator's, report the pinned effective base you were handed and carried rather than a rebase of your own; in `publish-reviewed`, report any carry the packet names, with its two tips and its answer.
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
- Anything blocked or skipped for lack of an authoritative decision, with what's needed to unblock — including misfired top-level bot findings step 3 took none of because their freshness was ambiguous, where a terminal no-op left no Summary comment to say so, a finding left out because its file changed since the superseded head it was written against, and every bot review that claimed findings it never delivered, named as review input that never arrived.
- The disposition record: its comment URL and whether it superseded a prior record or was posted fresh, or why the run left none.
  Where this run **replayed** a record, say what the branch's tree said about each recorded disposition — replayed, re-triaged because the fix was gone, or handed to the maintainer as unsettleable.

## The durable disposition record

Step 8's report is chat output, and dies with the session.
So every run that ends **without publishing in full** leaves that mapping on the PR itself, as one top-level comment written by `record.sh`, and a later run replays it.
A run that finds no record in step 3 and then publishes in full needs nothing more from this section: it posts no record, since step 7's replies, resolves, and Summary comment are the durable record there.
**Published in full** means a publication whose own report can show it: the push succeeded, every reply, resolve and re-run step 7 owed was made, and the Summary comment's URL is in hand.
One reply that failed to post, one owed resolve or re-run that did not happen, or a missing Summary URL is a publication that stopped part-way, whatever else landed.
Everything else about the record is in `disposition-record.md`, beside this file.
Read that file in full, before acting, in each of these cases:

- **Step 3's `record.sh find` printed a record** (an `id=` line or an `other=` line): how it is replayed, entry by entry, against the tree as it now stands.
- **This run holds a triaged disposition map and will not publish it in full** — a `no-push` run, step 6's round cap, a blocker, a maintainer decision still pending, a publication that stopped part-way or whose own report cannot show it complete: which runs post a record, which `--state` it takes, and what every entry carries.
  A `delegated-fix` run is not one of these: it posts no record and its orchestrator owns that, so it does not read the file for this case.
- **This run replayed a record and then published in full** — in `publish-reviewed`, the packet it publishes came from a run that did: how that record is spent.

`record.sh` sits beside this file too and is run by absolute path, like `pr-branch.sh`, answering the same way: `outcome=` first, exit 3 on a stop, exit 1 on a failure.

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

Every PR write goes through a helper beside this file, which names the repository and the PR itself; what a run still calls by hand are reads.
Qualify each with the `<owner>/<repo>` of the PR's own URL (`repos/<owner>/<repo>/…`, `--repo <owner>/<repo>`) rather than letting it default to whatever repository the directory resolves to, which is also what `gh api`'s `{owner}`/`{repo}` expand to.

**Read context:** `gh pr view NUMBER --repo <owner>/<repo> --json reviews,comments,headRefName,headRefOid,isCrossRepository,baseRefName,url,state` and `gh api --paginate repos/<owner>/<repo>/issues/NUMBER/comments`.
