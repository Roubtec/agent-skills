---
name: address-review
description: Address the maintainer-vetted review feedback on one pull request — optionally rebase the branch onto a target first, fix, push back on, or defer each unresolved review thread to a committed follow-up task file, verify every disposition with a fresh-eyes reviewer, then publish by default — push with exact lease protection, reply/resolve the threads, post a "Summary of Review Fixes" comment, and re-ping the reviewers that contributed — unless no-push is given for a local-only pass. Trigger when the user asks to address review comments, action a reviewed PR, work through review feedback, or run address-review. Do not trigger for planning, for implementing new task files (use address-tasks), or for rebasing a whole stacked chain (use rebase-stack).
---

Address the review feedback on a single pull request, end to end.

**Arguments:** `[PR#] [rebase on top of <branch>] [inline] [off-shoot] [no-push] [push] [hands-off] [peer-opinions=off] [ping-codex] [ping-claude] [ping-copilot] [ping-contributing]`

Explicit Codex invocation uses `$address-review`; natural-language equivalents are fine.

A maintainer triggers this skill once a PR has been reviewed (by bots like `@codex`/`@claude`/`@copilot` and/or humans) and they have decided the outstanding feedback is ready to be acted upon.
Your job is to work through every **unresolved** review thread — fix what is right, push back on what is wrong, confirm what is already handled, and capture what is real but out of scope in a committed follow-up task — keep the thread state tidy, and publish the result and summon a fresh review round — by default, unless `no-push` keeps the run local.

The maintainer signals intent through GitHub's own resolved/unresolved state, not a custom marker.
They resolve threads they want dropped (or reply with their own push-back) **before** triggering you, so the rule is simply: **unresolved = actionable, resolved = leave alone.**
Because you resolve the threads you address (on push runs), running this skill repeatedly is self-cleaning — each run only re-examines what truly remains open.

## Arguments

All arguments are optional and parsing is **lenient** — accept commas, `&`, and free word order, mirroring the example prompts. Trust yourself to extract intent, then sanity-check against the PR.

| Argument | Meaning |
|---|---|
| `PR#` (e.g. `#38`) | The PR to address. Takes precedence over auto-detection — useful when the current branch is a local off-shoot of a merge-pending branch or otherwise disjoint from the PR head; pass `off-shoot` too when you want the run to work on that branch rather than on the PR's head ref. Always sanity-check that it really relates to this branch. |
| `rebase on top of <branch>` | Rebase the **working location's branch** onto `<branch>` before gathering or fixing review feedback (Procedure step 2). Single-branch rebase only. |
| `inline` | Force **inline** working on the **target branch** — do the work in the current checkout rather than in a worktree, checking that branch out there when the checkout is not already on it. Requires that checkout to be clean, and the run ends on that branch. Unnecessary when you already stand on it (that is mode 1 anyway); to work in this checkout on a *different* branch — a local off-shoot of the PR — pass `off-shoot` instead, which is the only thing that selects one. See "Working location". It composes with `no-push` and the ping flags without interacting with either. |
| `off-shoot` | The checkout stands on a local **off-shoot** of this PR's branch (the `PR#` row's case) and you are saying so, so the run works inline on **that** branch rather than the PR's head ref: fixes land there, `headRefName`/`headRefOid` stay publication metadata, and step 1's reconciliation is skipped — a tip behind the head is this case's normal state. Needs an explicit `PR#` and a named branch, and requires the current checkout clean like any inline run. It is inline working by construction, so `inline` beside it is redundant rather than contradictory. Nothing else selects an off-shoot: no test on your history's shape may conclude one, because none can — see "Working location". |
| `no-push` | **Local-only run** — make commits, but do **not** mutate the PR at all (no push, no replies/resolves, no summary comment, no ping). This was the default until now; it is now the explicit way to ask for a dry run / inspect-only pass. The final report still captures every disposition so a later push turn can replay it. |
| `push` | Push the branch to the PR's actual head repository/ref and perform all PR-side communication (replies, resolves, summary comment) — but **ping no reviewer**. Use it to publish fixes quietly, without summoning a fresh review round. (Normal push for a fast-forward; explicit `--force-with-lease=<ref>:<expected-oid>` only when history was rewritten.) |
| `hands-off` | Run with no user interaction — best-effort to completion, documenting every skipped/blocked item in the final report. See "Hands-off mode". Typically how a parallel review orchestrator invokes this skill in a subagent. |
| `peer-opinions=off` | Disable the best-effort `claude` second opinion for this run. By default it runs beside every fresh Reviewer round while the peer remains available. |
| `ping-codex` | After a push that advances the PR branch, post a dedicated top-level `@codex review` comment to summon a fresh review round. |
| `ping-claude` | After a push that advances the PR branch, post a dedicated top-level `@claude review` comment. |
| `ping-copilot` | After a push that advances the PR branch, request a fresh Copilot review via `gh pr edit <PR#> --add-reviewer @copilot` (the canonical CLI request; needs gh ≥ 2.88.0) — **never** an `@copilot review` comment, which drives Copilot's coding agent (it can start editing the branch) rather than its reviewer. Tested working: the add-reviewer request re-triggers Copilot's review even on a PR it already reviewed, and never misfires into the coding agent. |
| `ping-contributing` | **The default** — a bare run behaves exactly as if you passed this. As a **modifier** on the ping set: re-ping a bot only if it **brought a new finding this round.** Combined with explicit `ping-codex`/`ping-claude`/`ping-copilot`, it filters that named set down to the contributors; supplied **alone** (or as the bare default), it falls back to every known bot (codex/claude/copilot) that reviewed this round. The point: keep one fixed reviewer set across rounds and let a bot that has gone quiet drop out of the ping cycle on its own, so a multi-bot review→address loop winds down bot-by-bot instead of pinging everyone forever. *Brought a new finding* = authored ≥1 thread this round that surfaces a real concern not raised before on this PR (typically `actionable-fixed`, or a genuinely new `follow-up-task`/`already-addressed`); it does **not** count a `push-back` (the comment was wrong), a re-raise of a concern already captured in a committed task, or a bot re-arguing a push-back it already lost — **unless** that thread carries a genuinely new angle this round. |

### Flag interactions

**The default is now to publish.** A run with **no** push/ping argument pushes the branch, performs all PR-side communication, **and** re-pings every bot that brought a new finding this round — i.e. a bare run behaves exactly like `ping-contributing`. The flags only adjust that default:

| You pass… | Push? | Who gets pinged |
|---|---|---|
| *(nothing)* | yes | contributing bots — every bot with a new finding this round |
| `ping-contributing` | yes | contributing bots — the explicit (redundant) spelling of the default |
| `push` | yes | **nobody** — publish quietly, summon no fresh review |
| `ping-codex` / `ping-claude` / `ping-copilot` | yes | exactly the bot(s) you name; this **overrides** the contributing default (add `ping-contributing` to instead filter the named set down to its contributors) |
| `no-push` | **no** | nobody — local-only dry run (the pre-change default) |

- **Resolution order — `no-push` wins.** If `no-push` is present it forces a local-only run; if it is somehow combined with `push`/`ping-*` (a contradiction), honor `no-push` and note the ignored flag. Otherwise push is always on; the ping set is then: the named bots if any were named (filtered to contributors when `ping-contributing` is also present), else **nobody** when `push` was spelled out, else the **contributing** set (the bare default, or `ping-contributing`).
- **`ping-*` implies `push`.** A named `ping-codex`/`ping-claude`/`ping-copilot` or `ping-contributing` always publishes — a re-review of unpushed work is meaningless. Only `no-push` suppresses the push.
- **A ping fires only when the push actually advanced the branch.** A ping summons a *fresh* review, which is only meaningful if new commits (or a rewritten history) were just pushed. If this run produces nothing new to push — every disposition was already-addressed or push-back, or the branch was already up to date — **skip the pings.** Re-requesting a review with nothing new to look at would spin the review → address → review cycle forever; the resolved threads and Summary comment already record the outcome.
- **`ping-contributing` prunes the ping set per this round's triage** (its table row defines what counts as a new finding). It never adds a bot you did not name, and a round in which no candidate bot brought a new finding pings no bot — even while the push itself advanced (e.g. you fixed a human's thread) — which, like the no-op-push skip, lets an automated multi-bot loop wind down reviewer-by-reviewer.
- **Multiple pings present** → perform each as its own dedicated action (a separate comment per named bot; the `gh pr edit --add-reviewer @copilot` request for Copilot), never a single comment mentioning several. They are also separate from the Summary comment.
- **`hands-off` + `rebase`** is uncommon and the riskiest combination: a non-trivial rebase conflict has no one to consult, so you abort cleanly and stop rather than guess (see "Hands-off mode" and step 2).
- **`inline` and `off-shoot` select the working location and nothing else.** Neither implies or suppresses a push, names or drops a ping, or changes how anything is triaged; both are orthogonal to every row of the table above and to `hands-off`. The one thing they change is what the preflight requires — an inline run of either kind needs the current checkout clean (see "Working location"). Passed together, `off-shoot` decides which branch is worked and `inline` adds nothing, since an off-shoot run is already inline.

## Working location

Where this run does its work is **chosen, not configured**: standing on the branch it works there in place, and from anywhere else it works in a git worktree, leaving the main checkout free for branch management while the run proceeds.
Orchestration does not change with the mode. You remain the main-loop orchestrator in every one of them, so the interactive channel — ambiguous dispositions, conflict confirmation, PR-identity doubt — is preserved exactly as it is; all that moves is the location the fixers, the Reviewer, the peer, and the publication push are pointed at.
Architecture's *one checkout-dependent agent at a time* rule follows the working location too: in worktree mode the subagents share that worktree rather than the main checkout, and the invariant it protects — never spawn the reviewer until the fixer's commits are on disk — is untouched.

Pick the mode once, after step 1 has resolved the PR and **before** step 1's reconciliation: that reconciliation can fast-forward a branch, so it has to run where the work will happen. Take the first mode below that applies, with the two argument-driven ones ahead of the rest and `off-shoot` (4) ahead of `inline` (3) where both were given: an argument the maintainer supplied outranks whatever the checkout happens to be standing on, and of the two only `off-shoot` names the branch to work on — `inline` names the tree, which is the same tree either way.

**The target branch** is the PR's `headRefName`, or the branch an orchestrator named for this entry. In `delegated-fix` and `publish-reviewed` there is no mode to pick at all: `address-reviews` has already assigned this entry a worktree, that worktree *is* the working location, and this skill neither selects nor creates nor reclaims one.

**The PR identity check** is step 1's PR-vs-branch sanity check, applied to whichever branch is a *candidate* working location rather than only to the one you happen to be standing on: the candidate shares recent history with the PR head, and for a fork PR its resolved push remote/ref matches the PR head repository/ref (the same resolution step 7's publication preflight performs). A branch that fails it never becomes the working location — not by being checked out, not by being attached. The fork clause gates a candidate meant to **be** the PR head ref — the same-named local ref, and the branch forced `inline` checks out — where a push resolving elsewhere proves the ref is not that head. A named off-shoot is a different branch by construction: it shares the head's recent history but resolves its push wherever the maintainer's own remote points, so the fork clause is not a gate on it, and whether anything may be published from it at all is step 7's question.

1. **Inline — the checkout is already on the target branch.** `git rev-parse --abbrev-ref HEAD` equals the target branch **and** that branch passes the identity check. Work in place, exactly as this skill always has. The branch advances under the maintainer: that is the mode's contract rather than a side effect, so a step-2 rebase rewriting their checked-out branch is expected.
2. **Worktree — anywhere else.** Any other branch, and a detached HEAD (there is nothing to advance under the user). Attach the target branch in a worktree and do everything there. The main checkout is never switched, never dirtied, and never required to be clean, and the maintainer may repoint it to any other branch mid-run without breaking anything — git itself refuses to check the worktree's branch out a second time, so "anything but the worktree branch" needs no guard of ours. Auto-detection has no PR to resolve from a branch that is not the PR head, so a mode-2 run normally arrives with an explicit `PR#` (or an orchestrator's pairing); step 1's ambiguous case already covers the rest.
3. **Forced `inline` — the argument.** It forces the work into the current checkout, on the target branch. Where that checkout is not already on the target branch, run step 0.1's two checks on it **first** and stop if either fails — a run that switches the maintainer's checkout and only then discovers their dirt has moved them for nothing — then check the target branch out there (creating a local tracking branch from the PR head when there is none — `gh pr checkout <N>` for a fork head, which wires the fork remote and tracking for you) and proceed as mode 1. The run ends on that branch — the maintainer asked for the checkout, so it is not restored. Where the checkout already stands on the target branch there is nothing to switch and nothing to restore: that is mode 1, and `inline` changes none of it.
4. **The off-shoot — the `off-shoot` argument.** The maintainer stands on a local off-shoot of this PR's branch and has said so, so the run works inline on that branch: fixes land there, `headRefName`/`headRefOid` stay publication metadata, and step 1's reconciliation is skipped whole rather than used to drag the off-shoot onto the head — a tip behind the head is this case's normal state. It requires an explicit `PR#` (auto-detection resolves no PR from a branch that is not a PR head) and a named branch: a detached HEAD is nobody's off-shoot, so there the argument selects nothing and the run stops saying exactly that (hands-off: halt with that report). Standing on the target branch already, it is redundant — that is mode 1. `inline` alone is not this mode and never becomes it: from an off-shoot it does what its own row says — checks the target branch out in this checkout and works there, leaving the off-shoot's ref and commits untouched — so name the off-shoot when the work belongs on it. Skipping the reconciliation is not a licence to publish over the head either: what an off-shoot may push is step 7's question, and step 7 stops on a push target it cannot match to the PR head. This mode settles only where the work happens.

A name match alone never selects mode 1. A same-named local branch that fails the identity check falls through to mode 2, and there into the collision stop below — never *onto that branch*. Reusing a name like `minor-fixes` or `batch-wrap-up` across unrelated work is ordinary maintainer practice, so treat that collision as expected rather than exotic. `off-shoot` does not rescue such a ref: a branch bearing the target's own name is not an off-shoot of it, whatever it carries — the fork PR's same-named local ref, which carries the head yet resolves its push to `origin`, is precisely the ref the identity check refused.

**The off-shoot is stated, never recognised.** No test on the branch's shape can find it, so none is allowed to try. The supported case is a branch cut *before* the current PR head and advanced with its own commits, which therefore neither carries the head nor is carried by it — and a child cut *from* the head and advanced is the same shape up to where the cut was made, while working on the second as if it were the first publishes that child's own commits onto this PR under `headRefName`. Both halves of that were tried here and both failed: requiring the branch to **carry** the PR head rejects the very case this mode exists for, and requiring it to have no open PR of its own admits every stacked child not yet PR'd — which is exactly what a batch executor leaves behind when it opens PRs and then builds an unpushed local review stack. So one word from the maintainer settles what no probe can, and without that word every branch that is not the target takes mode 2, which is safe by construction.

**Another open PR on that branch makes the request ambiguous — it disproves nothing.** A branch can be an off-shoot of this PR's head *and* be the head of another open PR; the two are compatible, so such a PR is no evidence against what the token asserts. What it does mean is that two PRs could be advanced by the same commits and only the maintainer can say which, so it is a stop rather than a mode: ask which PR was meant (hands-off: halt naming both branches and both PRs). Probe it with `gh pr list --head <branch> --state open --json number,headRefName,headRepository,headRepositoryOwner`, and count a hit only when it clears two filters — it is a **different PR** from the one being addressed (compare the number: where the branch *is* this PR's head the query answers with this very PR, and stopping there would halt an ordinary run), and its head is the **same repository-qualified ref** as the branch's own resolved push remote/ref (`headRepositoryOwner.login + "/" + headRepository.name` plus `headRefName`, against the push target step 7 resolves — the repo-qualified comparison `address-reviews` already uses for pairing and stack detection). Nothing short-circuits that comparison, and `isCrossRepository` is not requested for it: the field reports whether the other PR's *own* head and base repositories differ, not whether its head is the repository this branch pushes to, so in a fork clone it reads `false` for an upstream PR whose head is not the fork this branch pushes to — the very misfire the qualification exists to prevent. `--head` matches a bare branch name, so without that qualification a same-named head in a fork answers for a branch it has nothing to do with; a branch that has never been pushed is nobody's PR head and clears the check trivially. This is not how the deleted heuristic used the same probe, and the difference is what makes it safe: as a recognizer it needed "no open PR" to imply "off-shoot", which is invalid and rejected the very case the mode exists for; as an ambiguity check on a claim already made, what it misses costs nothing — the token still decides the mode, and the probe only decides whether one question comes first.

### Preflight in the working location

Step 0.1 states the two checks — clean tree, no Git operation in progress — and this section says only **where** they run, which is wherever the work will happen rather than the main checkout:

- Inline — mode 1, forced `inline`, and a named off-shoot — keeps today's requirement whole: they run on that checkout.
- Worktree mode requires nothing of the main checkout, which may be dirty or mid-anything. A worktree created for this run is clean by construction. A **reused** one — the stable slug surviving a prior halted run — gets the same two checks, and either one failing there is a stop-and-report naming the worktree path: what it holds is most likely that prior run's remains, and this run neither cleans nor forces past it (hands-off: document and stop).

Either way, nothing is auto-stashed or discarded anywhere; dirt is the maintainer's to resolve.

### Attaching the worktree

Branch resolution and attach follow `address-reviews` → "Resolving and checking out each entry" wholesale — local-first (a local ref wins over `origin`), the `origin` head only when no local branch exists, and a fork PR through its detached-worktree + `gh pr checkout` case, whose landed-on-the-right-head verification is part of that recipe. Use a stable slug (`pr-<N>`) whichever command attaches the worktree, so a halted run's worktree is found again rather than duplicated — which that recipe's registration read before EVERY attach, the fork case included, is what delivers: a halt keeps its worktree, so the resume meets a LIVE `pr-<N>` registration, which `git worktree prune` does not clear and a bare `git worktree add` would then fail on. The one tree that recipe hands back is inherited unchanged rather than dropped here: a fork attach whose landing verification fails gives its worktree back (`wt-remove pr-<N>`), because that tree never became the working location and, left on the rejected ref, it is what the registration read would stop on at every re-run. Where the worktree helpers are on PATH, `wt-enter <slug> <branch>` covers the plain attach of a branch that **already exists locally**; it refuses to create a missing one without a base (`branch '<branch>' does not exist and no <base> was given`), and no local ref for the PR head is mode 2's commonest arrival — standing on `main` with a head you have never checked out. So pass the verified head OID as that base (`wt-enter pr-<N> <branch> <headRefOid>`, which reads the base only when the branch is missing and so is safe when a local ref wins), or use the explicit `git worktree add -b <branch> <path> <headRefOid>` the inherited rules already keep for the tracking-`origin` case. Where the helpers are absent, those explicit commands are the whole path.

One exception suspends local-first: **a local ref bearing the target's name that has already failed the PR identity check.** Attach nothing and substitute nothing. Report the collision — the rejected local ref, the verified PR head, and what each points at — and ask the maintainer how to proceed, resuming on their answer; hands-off, halt the entry with that same report. Branch hygiene is the maintainer's call, and every heuristic the run could apply instead invents a new local downstream for an existing upstream: attaching by branch name lands on the rejected ref and succeeds silently (`wt-enter` verifies the branch is checked out, which it is, so unrelated history passes without complaint), deriving a disambiguated name hands back a branch with no verified push target for step 7's preflight to match, and checking out detached leaves the fix commits reachable from nothing once `wt-remove` reclaims the worktree. Stopping costs one question; each of those costs a run's work. The same stop applies wherever a same-named local ref is the candidate, forced `inline`'s checkout included.

### After setup, the main checkout is not yours

In worktree mode nothing after setup touches the main checkout. No step switches it, and there is no restore step because nothing moved — and end-of-run reporting must not assume it still points where it did at invocation, since the maintainer was free to repoint it while you worked.

Reclaim the worktree with `wt-remove <slug>` (plain `git worktree remove` where the helper is absent) once the run finishes — **after publication, and equally after a `no-push` finish**. The branch ref and its commits persist in the shared `.git`, so removal loses nothing, and the branch is never deleted. Never force past uncommitted changes or an operation in progress. A run that halts instead — a blocker, an unresolved conflict, a failed publication — leaves its worktree in place and **reports the path**, so the maintainer can inspect it or a later run can resume there.

## Architecture

At top level, address ordinary feedback **inline** and delegate only large or independent rework.
Then hand verification to a **fresh, independent reviewer subagent** and, by default, an independent best-effort `claude` peer.

Two top-level subagent roles plus one CLI peer:

- **Fixer** (optional) — a fresh `worker` subagent that handles a large, multi-file, or exploratory fix for one or more related comments. Skip it for small surgical fixes you can do directly.
- **Reviewer** (default before any push) — a fresh `explorer` subagent that receives every unresolved thread and explicitly included standalone item verbatim, plus the proposed disposition labels, but **not** your implementation reasoning; it independently confirms that each disposition is sound in the committed code and performs a quality pass on the changed files. This is the `review-cycle` skill's Reviewer role.
- **Peer (`claude`, best-effort)** — the `review-cycle` skill's cross-harness peer step: a read-only CLI review launched beside the Reviewer with the same disposition context but no implementation reasoning. Its preflight, pinned-strength launch, outcome vocabulary, and gating are defined in that skill; a coherent, grounded finding is first-class.

> **Critical — one checkout-dependent agent at a time; Codex subagents share your working tree.**
> Unless explicitly assigned distinct git worktrees, subagents operate on the same checked-out branch as the orchestrator. The invariant is about committed state, not turn structure: **never spawn the reviewer until the fixer's commits are on disk.** A reviewer racing unfinished work can inspect an empty or partial branch and falsely pass it. A harness may run spawns asynchronously, returning an id immediately and delivering the result as a later notification, so wait for that completion, close the subagent, then spawn the next; keeping two checkout-dependent subagents out of the same natural-language turn or tool-call batch is a **proxy** for the invariant — sufficient where spawns are synchronous, and neither sufficient nor necessary where they are not. The sole concurrency exception is the examination-only `claude` peer launched beside the Reviewer after the tree is clean and committed: two readers are safe, while the Reviewer alone owns build/typecheck execution.

> Fix-up and re-review spawns follow the `review-cycle` skill's fresh-spawn rule — always a fresh subagent spawn, never `send_input` to continue a prior worker or reviewer.

### Codex subagent execution

Use the subagent interface exposed in the current session.
In tool-enabled sessions this is typically available through tools such as `multi_agent_v1.spawn_agent`, `multi_agent_v1.wait_agent`, and `multi_agent_v1.close_agent`; use those names only when present in the current tool listing.
Spawn fixers as `worker` agents and reviewers as `explorer` agents.
Pass self-contained prompts; do not fork the orchestrator's context, and omit model overrides unless the user asks for one.
Wait for each subagent and close its thread when no longer needed.
No custom agent personas (`~/.codex/agents/*.toml`) are required.

If the session exposes no subagent capability, do not publish unreviewed changes.
Only use the trivial local-only escape hatch below; otherwise tell the user the workflow requires Codex multi-agent support.

**Trivial escape hatch:** only on a local, no-push run with one obvious actionable comment may you skip the reviewer. Never skip review before publishing, and never skip it for a push-back disposition.

### Delegated modes for the worktree orchestrator

Codex subagents must not be assumed to spawn nested subagents.
`address-reviews` therefore uses this skill in two internal modes; these are orchestrator controls, not normal user flags:

- **`delegated-fix`** — run steps 0–5 directly in the assigned worktree, without spawning helpers, then stop before review/publication and return a complete review packet: PR/head metadata, starting/final SHAs, every item verbatim with stable refs and proposed disposition, validation run, and any blocker.
- **`publish-reviewed`** — receive that packet plus a fresh external reviewer's Pass verdict and the peer outcome (satisfying the `review-cycle` gate), verify the packet still matches the clean committed `HEAD`, then run only step 7 and return step 8's report. Refuse to edit code, re-triage, or publish without this complete passing review gate.

The worktree orchestrator owns the fresh reviewer, peer invocation, and any fix-up rounds between these modes.

## Subagent destroy boundary

State this in every subagent prompt this skill composes. A reviewer subagent authorized to verify a claim empirically once ran `rm -rf ./*` in a shared main checkout: its setup `git clone … | tail` had failed invisibly under `set -e` (a pipeline's status is its last command), so it deleted tracked files and moved a branch ref while believing it stood inside a clone.

- **Permitted:** reading, searching, and read-only `git`/`gh` queries — plus, for a fixer or implementer, edits, commits, and pushes confined to its own assigned worktree and branch.
- **Forbidden, named outright:** `rm -rf`, `git reset --hard`, `git clean`, `git branch -f`, `git update-ref`, `git gc`, and force-pushing — each of them beyond what the prompt itself spells out, whether as an exact command or as a skill it names to invoke. A subagent may not self-authorize one by putting itself somewhere it believes is safe — forbidden **not in a clone, not in a temp directory, not "safely"**. What you spelled out, and the disposable location below, are the only exemptions — and only because you named them.
- **A worktree is not a blast radius.** It isolates the working tree, not the repository: `branch -f`, `reset`, `update-ref`, and `gc` all reach every sibling worktree through the shared `.git`.
- **Empirical verification that could change state goes where you send it.** Where `command -v dc-enter` finds the helper, send the subagent to `DC="$(dc-enter <slug>)"` — one absolute path on stdout, dropped again with `dc-remove <slug>`; a reused slug is refused rather than re-derived, so anything that may run twice passes `--replace` or removes the slug first. Where the helper is absent, name an absolute path outside the repository — never a relative one. Never leave the choice to the subagent. Give it the guarded `cd` too: `cd ""` returns 0 and moves nowhere, so checking the status catches nothing and a failed lookup leaves the subagent in the shared checkout — the form is `cd -- "${DC:?dc-enter returned no path}"`, with `pwd` confirmed before the first command that writes.

## Procedure

### Step 0 — Preflight

1. **Clean and idle tree — checked in the working location, not here.** Both checks survive unchanged in substance but are scoped to wherever this run will work, which "Working location" picks once step 1 has resolved the PR; run them there, and only there. This is where they are stated, whichever mode selects them: `git status --porcelain` empty, **and** no Git operation in progress — `git rev-parse --git-path rebase-merge` and `rebase-apply` for an existing path, plus `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG`. Those markers are not decoration: a tree left mid-cherry-pick, mid-merge or mid-revert prints empty porcelain and has no rebase path, so a rebase-only probe passes it here and the state surfaces only at step 5's packet hard-check, with a run's fixes already committed on top of it. Either check failing stops the run to ask the user to commit/stash/clean it (hands-off: document and stop). Never auto-stash or discard files, wherever you check.
2. **Confirm `gh` is authenticated** (`gh auth status`). Without it you cannot read threads, reply, resolve, or comment.
3. **Record the starting branch and tip SHA** so you can describe exactly what changed in the final report and recover if needed. In worktree mode this records where the main checkout stood at invocation, which the run then leaves alone — it is not something to restore, and by the end it may no longer be true.
4. **Preflight the peer once for a standalone run, unless `peer-opinions=off`,** per the `review-cycle` skill's peer preflight. Skip this probe in `delegated-fix` and `publish-reviewed`: `address-reviews` preflights once in its shared bootstrap and supplies the peer outcome.

### Step 1 — Resolve and verify the PR

Precedence for identifying the PR:

1. **Explicit `PR#`** — use it, but **sanity-check the relationship to the candidate branch**. Compare the PR's `headRefName` and head SHA against it: do they share recent history? Is the branch an ahead/behind copy of the PR head? If they look genuinely unrelated (no shared commits), surface it — *"the supplied PR #N targets branch `x`, which shares no history with the current branch `y`; proceed anyway?"* — and ask before operating (hands-off: stop and document, since acting on the wrong PR is high-stakes). This is the **PR identity check** "Working location" turns on, and the candidate is whichever branch is in line to become the working location — the one you are standing on, or the local ref a worktree attach would otherwise pick up.
2. **Auto-detect** — `gh pr view --json number,headRefName,baseRefName,url,title,state` resolves the PR for the current branch; `gh pr list --head <branch>` is the fallback.
3. **Ambiguous or none found** — ask the user which PR (hands-off: stop and document the blocker; do not guess).

Record `owner`, `repo`, PR `number`, `baseRefName`, `headRefName`, `headRefOid`, and the head repository owner/name for the API calls and publication guard below.

**Now pick the working location**, per "Working location" above, and set it up before going any further: everything below this line — the reconciliation, the rebase, the fixes, the review, and the push — happens there. It comes before the reconciliation rather than after because reconciling can move a branch, and the branch it must move is the one the work will land on. A named off-shoot has no reconciliation to run at all: `headRefName` is a branch that run is not on.

**Reconcile the working location's branch with the PR head before triaging anything.** The rule is *no work lost*, and ancestry decides it rather than a standing preference for either side. Fetch the PR's exact head ref without moving the local branch; a fetch brings whatever the ref names *now*, so confirm the recorded commit is a local object (`git cat-file -e <headRefOid>^{commit}`) first — a force-push landing in between leaves it undownloaded, which is a head that moved rather than a broken run: re-read the PR head, fetch and record the refreshed OID in place of the stale one, and reconcile against that once it too is a local object. Then compare `HEAD` against `headRefOid`:

- **Equal** → the two agree; proceed.
- **`HEAD` is a proper ancestor of `headRefOid`** (local strictly behind, nothing unpushed) → fast-forward the local branch to the PR head and address the feedback from there. Someone advanced the branch on origin and you hold nothing it lacks. Never carry a strictly-behind tip into publication: a normal push cannot fast-forward it, and an exact-lease force-push from it would delete the newer remote commits.
- **`headRefOid` is represented in `HEAD`** — either it is an ancestor, or every commit unique to it is present in `HEAD` by patch-id → keep the local branch and put the fixes on top. Test representation by patch-id rather than raw ancestry: a branch rebased onto a newer base carries the PR head's content forward while sharing no SHAs with it, so a raw-ancestry test would misread that routine case as divergence and stop a run that should simply proceed. Patch-id cannot speak for a merge commit, which has no patch of its own: ignore one that merely joined its parents, but treat a conflict resolution it introduced as unrepresented work unless `HEAD` carries that resolution too.
- **Genuinely divergent** — each side holds commits the other lacks, and the remote's are not represented in `HEAD` by patch-id → **stop and ask the maintainer.** Do not pick a side, merge, or rebase on your own; report both tips and the commits unique to each. Two contributors fixing one branch unaware of each other, or a deliberately dropped commit, are a maintainer call every time — the likely answers (preserve both efforts, or choose between competing fixes) are judgments this skill must not encode. Hands-off: skip the entry and document exactly this.

The tip this run started from is the **working location's** tip as attached, not step 0's reading — in worktree mode that reading describes the main checkout, which the run never touches. Record it when the location is set up, and re-record it if the fast-forward above moved the branch; either way the pre-reconciliation value no longer describes what this run started from.

### Step 2 — Rebase first (only if `rebase on top of <branch>` was given)

Rebasing brings the branch close to its final merged state, so address the feedback against the geometry the work will actually land in (essential when several stacked PRs are being fixed at once).
This is a **single-branch** rebase. To restack a whole chain of dependent branches, that is the separate `rebase-stack` skill — mention it if the user seems to want chain-wide restacking.
Every command in this step runs in the working location. Inline that rewrites the branch the maintainer is standing on, which is mode 1's accepted contract; in worktree mode the rewrite and any conflict happen in a tree that is disposable, and the main checkout is unaffected either way.

1. Verify the target exists locally — a branch ref, or an exact commit SHA (a batch orchestrator pins the target to one commit so every entry rebases onto the same base).
2. Save the branch being rewritten, not the target: `current_branch="$(git branch --show-current)"`, require it to be non-empty, set `ts="$(date -u +%Y%m%d-%H%M%S)"`, then `git update-ref "refs/pre-rebase/$current_branch/$ts" HEAD`.
3. `git rebase <target>`. Git's patch-id detection drops commits already present on the target.
4. **Conflicts:**
   Resolve them hunk by hunk in place, preserving cleanly auto-merged changes elsewhere in each file. Whole-file `git checkout --ours` or `--theirs` is safe only after inspecting the merged result and verifying that the file contains no cleanly auto-merged content from the other side; otherwise it can silently delete a sibling's already-shipped behavior with no conflict marker left behind.
   - **Trivial** (import/whitespace/formatting collisions, pure additions, or a patch already represented on the new base) → resolve in-file and `git add` + `git rebase --continue`, or `git rebase --skip` for an already-represented commit. Narrate one line each; don't pause.
   - **Non-trivial** (a genuine semantic dilemma) → **interactive:** present the conflict, your proposed resolution and reasoning, and confirm before applying — loop the user in as many times as needed rather than guessing. **Hands-off:** `git rebase --abort`, confirm `git status --porcelain` is empty, and **stop the whole run** — addressing review on a wrong/stale base then force-pushing is worse than not running. If abort leaves unexpected files, preserve and report them rather than deleting blindly. Document the conflict (files, offending commit, why) as the blocker.
5. After a conflicted rebase, run the project's build/lint (discover via `AGENTS.md`/`CLAUDE.md`, then `package.json` scripts, then ecosystem signals) to confirm the resolution is sound before proceeding. A clean rebase needs no validation.

If the rebase changed the branch tip, expect the eventual push to be a force-push (`--force-with-lease`).

### Step 3 — Gather the review feedback

Fetch the **unresolved** review threads and enough context to judge them (see "GitHub API recipes"):

- **Review threads** (inline comments): fetch every **unresolved** thread exactly per "GitHub API recipes" below — prefer the `gh-review-threads` helper when it is on PATH, else run the GraphQL query by hand as fresh single-shot per-page queries (never `gh api graphql --paginate`) — keep only `isResolved == false`, and **validate every response before acting** as the recipes specify, failing closed on any identity, shape, or scope failure. For each thread, capture the thread `id`, `path`, `line`, `isOutdated`, and every comment's `databaseId`, author login/type, `body`, `diffHunk`, and `url`.
- **Top-level review summaries** (`gh pr view --json reviews`) and **issue comments** (`gh api --paginate repos/{owner}/{repo}/issues/{number}/comments`) — read for context, especially **maintainer replies/push-backs** that override or qualify a bot's original comment. They are not automatically actionable because they have no resolved/unresolved state; include a standalone item only when the maintainer explicitly identifies it as outstanding in the request or discussion.

A maintainer reply on an unresolved thread is **authoritative**: if they said "skip this" or "do X instead," follow the maintainer over the original reviewer.
The same authority extends to a **top-level decision comment** — a maintainer comment that walks the open feedback and records a verdict per item (often titled "Maintainer Decisions" or similar). Treat each recorded decision as the binding disposition for the thread(s) it covers — including "postpone to a follow-up task" and "keep as-is" — rather than re-triaging those threads from scratch.
Treat `isOutdated` as context, not a disposition: inspect the current code and re-locate the concern rather than auto-dismissing an outdated thread.
If there are no unresolved threads and no explicitly included standalone items, first compare the current `HEAD`, the starting tip, and the recorded PR `headRefOid`. In every mode, stop as a successful terminal no-op only when `HEAD == starting tip == headRefOid`; an unchanged local tip that is already ahead of or divergent from the recorded PR head is not a no-op. Every other case follows the zero-item path: in `delegated-fix`, return the complete packet through step 5 so the orchestrator can review and, when enabled, publish it; outside `delegated-fix`, continue through the normal fresh review and, unless `no-push`, publication. This includes both a requested rebase that changed `HEAD` and any already-unpublished local tip. A zero-item path makes no synthetic commit, and a terminal no-op makes no commits, push, ping, or summary comment.
Step 1's reconciliation has already fast-forwarded a strictly-behind branch, so `HEAD` cannot be a proper ancestor of `headRefOid` by the time you get here. If it somehow is, stop and report rather than entering the zero-item path: that tip has no unpublished work to publish, and the only push that could reach the recorded head is a force-push that deletes the newer remote commits.

### Step 4 — Triage every review item

Classify each into one of:

- **Actionable** — a real issue; implement the fix.
- **Already addressed** — the current code (possibly thanks to the rebase or an earlier commit) already satisfies it. Note where.
- **Push-back** (should be **rare**) — the comment is wrong, misunderstands context, or points in the wrong direction. Do **not** implement it; draft a respectful, specific rationale instead. Lean on judgment; never implement a fix you believe is wrong just to clear a comment.
- **follow-up-task** — the concern is real, but at least one condition applies: fixing it here would expand the PR's scope considerably while the branch is defendable as it stands (it builds and covers its main paths); the work meets step 5's condition-bound deferred-placement criteria; or the maintainer has already requested a follow-up (reply or decision comment). Do **not** implement it; record it as a committed task file instead (step 5). Never use this to dodge a cheap fix.
- **Ambiguous** — the right fix needs an authoritative decision you cannot make from the code/history. **Interactive:** ask the user. **Hands-off:** make a best-effort call only when stakes are low; otherwise skip and document it — do not guess where an authoritative determination is required.

A thread asking you to **document** some behavior is satisfied by a minimal why-comment under `review-cycle`'s comment rule (an actionable fix), or — where no comment would earn its keep — by push-back; never by adjacent code re-implemented in prose. There is no reply-only disposition: the fuller rationale rides the reply whichever disposition you chose already posts on the thread, so pick the one that is true of the committed code rather than the one that suits the reply. Where such a push-back is sustained, that rule's carve-out for a standing overruled decision is worth the comment precisely here: an external reviewer re-raises the same point across PR rounds and runs, and nothing in this run's replies is in front of it next time.

### Step 5 — Fix

For the actionable items:

- **Small/surgical** → fix directly in your own context, committing at logical milestones.
- **Large/multi-file/exploratory** → spawn a **Fixer** subagent (see Architecture and the prompt sketch below). One at a time; await its commits before moving on.
- **Preclude repeat comments:** for each pattern you fix, grep the PR's changed files and closely related code for the **same offending pattern** and fix those too, so the next review round doesn't re-raise it. Mention these proactive fixes in the summary.
- Keep commits buildable where practical, and validate at `review-cycle`'s tiers: the round tier while iterating, and the delivery tier — the full applicable sanity set — on the state you publish, before step 7 pushes.
- Before review, apply `review-cycle`'s packet hard-check to the working location: `git status --porcelain` empty **and** no Git operation in progress. Inspect and commit every intended change; if a fixer leaves partial or unexplained changes, resolve that state or stop rather than letting the reviewer inspect only the committed subset.

For the **follow-up-task** items, write the task file(s) following the `write-tasks` skill conventions (invoke that skill where available):

- Follow whatever task layout the repo already uses. Default to its task folder (commonly `tasks/`): a planned follow-up stays queued and numbered there even when it has prerequisites, which the task must state so its ordering remains visible.
- Use the deferred subfolder (for example, `tasks/deferred/`) only for deliberately unscheduled work: it depends on functionality that is not certain to arrive; it addresses a condition that cannot occur yet or has not manifested, and fixing it would be costly; or it awaits a spike or decision between competing options.
- When unsure, prefer `tasks/`: a mis-queued task can be reprioritized during a batch, while a mis-deferred task is easily forgotten.
- Number each file to continue the folder's existing sequence, slotted by priority/intended order.
- Each task must stand alone: restate the concern and link the PR thread; an implementer should not need to re-read the review. The link permanently anchors the exact line under review, so the task body anchors to named symbols per the `write-tasks` conventions and stays true after the branch moves.
- **Commit task files on the current branch, separately from code-fix commits** (when practical). The task ships with the branch that prompted it — merging the PR then also lands the record of its loose ends, which is what makes a committed follow-up a legitimate way to close a thread.

Fixer subagent prompt should include: the relevant review comment(s) **verbatim**, the file/line locations, the branch name (and "verify you are on it"), the **absolute path of the working location** with an instruction to `cd` there and confirm `git rev-parse --show-toplevel` prints exactly it before touching anything (in worktree mode a fixer that resolved the branch itself would land in the main checkout), an instruction to read `AGENTS.md` first, the same-pattern sweep instruction, commit/validation instructions, an instruction not to write to any shared task/plan tracker, and a request to report what it changed, any tradeoffs, and anything uncertain. Do **not** give it unrelated context. With those validation instructions, hand it the path any build or check output must land in — namespaced by this PR number, or created with `mktemp -d`, and outside the checkout it commits from — never a fixed shared scratchpad name: one session's agents share that directory, and two of them redirecting to `<scratchpad>/verify.log` once had one report a verdict for the wrong branch. Never leave the choice to the fixer. This Fixer runs before step 6, so it never receives the prompt that cycle composes: brief it under `review-cycle`'s Fixer contract whole — every rule that skill states for a Fixer binds here, later additions included — rather than importing named rules one at a time.

In `delegated-fix` mode, do not spawn a Fixer or Reviewer and do not launch the peer; the batch orchestrator owns both review paths.
Perform the fixes directly, leave the worktree clean with all intended changes committed, return the review packet defined above, and stop here.

### Step 6 — Verify with a fresh reviewer

Once fixes are committed and the worktree is clean, run the `review-cycle` skill's verification loop on this branch (artifact type `code`). Its roles — the fresh Reviewer spawn and the best-effort `claude` peer launched beside it — plus the peer's pinned-strength launch and outcome vocabulary, the gates (grounding spot-check, blocking and minor peer findings, verbatim finding relay), the disposition rule, and the round cap are all defined there and are not restated here. Beyond those named pieces, every rule that skill states under *The loop and its gates* binds this loop whole, later additions included — the no-latched-flags rule among them, for whatever this run carries into step 8's report and the Summary comment. The peer preflight outcome from step 0 and `peer-opinions=off` carry into the cycle.

This skill's deltas on the cycle:

- The work items are every unresolved thread and explicitly included standalone item verbatim, each with its proposed disposition label (actionable-fixed / already-addressed / push-back / follow-up-task / ambiguous), plus the effective review base, the branch, and the **working location** — its absolute path in worktree mode, so the Reviewer and the peer read the tree the fixes landed in rather than the main checkout. The effective review base is the requested rebase target when step 2 ran; otherwise it is `baseRefName`. Neither the Reviewer nor the peer gets your implementation reasoning, drafted rationale, or the fixer's report.
- The Reviewer independently verifies every disposition: fixes and already-addressed claims must hold in the committed code; push-backs must be technically justified rather than convenient dismissals; follow-up-task items must point at a committed task file that genuinely covers the concern, with the follow-up itself justified under step 4's conditions — never an evasion of a cheap fix — and its queued or deferred placement consistent with step 5; ambiguous items must genuinely require an authoritative decision. It may reclassify any item.
- When a round fails, re-triage the affected comments before the cycle's next fresh Fixer round.
- If the cycle stops at its round cap, do **not** push; surface every outstanding finding set in the final report (and to the user if interactive).

### Step 7 — Publish after the review gate (every run except `no-push`)

If `no-push` was given this is a local-only run: **skip this entire step** — do not touch the PR. Go to step 8.

Otherwise:

Do not enter publication unless step 6's review cycle passed its gate. An outstanding grounded peer finding returns to step 6 while rounds remain, or stops publication at the cap.

In `publish-reviewed` mode, first require the supplied review packet, a fresh external reviewer Pass, the peer outcome satisfying that same gate, and a clean committed `HEAD` equal to the packet's final SHA. If any differ or the peer outcome is missing, stop; do not re-triage or publish stale work.

Publication runs in the working location: the re-check, the resolved push remote/ref, and the push itself all read and write that tree and its `HEAD`, never the main checkout.

1. **Re-check before publication:** require the working location clean and idle, by step 0.1's two checks; re-fetch the PR and confirm it is still open, still points to the recorded head repository/ref, and its current `headRefOid` is the expected remote tip you are prepared to replace. Resolve the current branch's exact push remote/ref, verify they match that PR head, and fetch that exact head ref without moving the local branch so the expected commit object is available for the ancestry test — never assume `origin`, especially for fork PRs. If the PR head moved, the push target cannot be matched, or the branch has no usable push permission, stop and report instead of guessing.
2. **Push:** if the expected remote tip is an ancestor of `HEAD`, use a normal explicit push (`git push <remote> HEAD:refs/heads/<headRefName>`). If history was rewritten, use an exact lease (`git push <remote> --force-with-lease=refs/heads/<headRefName>:<expected-head-oid> HEAD:refs/heads/<headRefName>`). If the lease is rejected, **never** escalate to bare `--force`; stop and report because the remote moved under you. Confirm what actually landed against the ref itself — one `git ls-remote "<url>" refs/heads/<headRefName>` for each URL `git remote get-url --push --all <remote>` lists — rather than `gh pr view --json headRefOid`, which can still report the pre-push head for a while after the push returns. Read back through the resolved **push** URLs, not the remote name: where a remote carries a distinct `pushurl` (a fork or a writable mirror), the push wrote to one repository while `git ls-remote <remote>` and any fetch read the other, so the name would confirm the push against a repository it never wrote to. Enumerate with `--all` and read the URLs one at a time: `git push` writes to *every* configured push URL, plain `--push` names only the first, and interpolating the whole list into a single `ls-remote` either fails outright when quoted or, unquoted, swallows the second URL as a ref pattern and reports the first URL's ref as if it spoke for both. Every URL has to come back with the `HEAD` you pushed: `git ls-remote` is observational and exits 0 even when it prints nothing, so an absent ref, a disagreeing OID, or a destination you could not reach is a stop, not a pass.
3. **Re-read unresolved threads after the push.** This catches comments resolved or added while fixes were in progress. Do not mutate newly-added feedback that was not triaged and reviewed in this run; leave it open and call it out for the next pass.
4. **Per-thread hygiene** — for each triaged thread still unresolved (recipes below):
   - *Actionable-fixed* → reply (`Fixed in <sha>: <one line>`) **and resolve**.
   - *Already-addressed* → reply pointing to where it's handled **and resolve**.
   - *Follow-up-task* → reply with the placement-specific template: queued work uses `Follow-up task committed: tasks/NNN[a-z]?-… — queued for an upcoming batch`; parked work uses `Deferred with full context to tasks/deferred/NNN[a-z]?-… — <the condition it waits on>`, where the lowercase letter suffix is optional. **Resolve** when the follow-up was maintainer-directed or the thread is bot-authored; leave a human-authored thread unresolved unless the maintainer authorized closing it. Never re-implement a task-backed thread.
   - *Push-back* → reply with the rationale and flag it prominently in the summary. Resolve a bot-authored thread after independent review validates the push-back. Leave a human-authored thread unresolved unless the maintainer explicitly authorized resolving it, so unattended runs do not silently close a person's objection.
   - *Ambiguous/skipped* → **leave open**, list it in the summary as needing a decision.
   Before replying, inspect the thread for an equivalent prior reply from the authenticated user (for example, a previous run replied but failed to resolve) and avoid posting duplicates. Resolve only after the reply succeeds; record any communication failure and leave that thread open.
5. **Summary comment** — post a top-level **"Summary of Review Fixes"** (`gh pr comment`). Structure: what was fixed (with proactive same-pattern fixes called out), a **prominent "Pushed back — please re-examine" section** for every push-back with its rationale, a **"Follow-up tasks" section** listing each item with its committed task file (explicitly flag deferred placement and flag agent-proposed follow-ups for confirmation), any ambiguous/skipped or newly-arrived items still needing a decision, and (in hands-off runs) every automatic low-stakes decision and every item skipped for lack of feedback. In this comment, avoid bare `@codex`/`@claude`/`@copilot` mentions (write "codex"/"claude"/"copilot" plain) so only the dedicated ping comments below trigger a review.
6. **Pings** — only after the push and summary succeeded, **and only when the push actually advanced the branch** (per "Flag interactions": skip all pings on an "Everything up-to-date" no-op push, even when `ping-*` was supplied, or an automated review → address → review cycle never terminates). `ping-codex` → a dedicated comment whose body is `@codex review`; `ping-claude` → a dedicated comment whose body is `@claude review`; `ping-copilot` → `gh pr edit <PR#> --add-reviewer @copilot`, never an `@copilot review` comment (its table row says why). **Guard first:** check `gh --version` against the `ping-copilot` row's gh floor; if the request errors on an older `gh`, **skip the Copilot request without failing the run** — the push and summary already succeeded — and report that Copilot was not summoned (upgrade `gh`, or re-request from the PR's web reviewer menu). **Confirm the request from the timeline, never from `gh pr view --json reviewRequests`:** that GraphQL-backed field reads back empty on a request that succeeded, and REST `gh api repos/{owner}/{repo}/pulls/NUMBER/requested_reviewers` lists the request only while it is still pending, so it can confirm one but never refute one — the durable evidence is a `review_requested` event in `gh api --paginate repos/{owner}/{repo}/issues/NUMBER/timeline`. Match that event to *this* request by identity: a repeatedly reviewed PR already carries older `review_requested` events for the same reviewer, so snapshot the `id`s of the events naming the intended reviewer *before* issuing the request, and afterwards require one that is not in that snapshot. Compare by event id, never against your own clock: a "newer than the time I noted" test fails whenever the runner clock runs ahead of GitHub's or the event lands in the same one-second `created_at` tick, reporting the reviewer as un-summoned while the correct event sits right there in the timeline. Paginate **both** reads: the timeline is oldest-first and pages at 30, so an unpaginated confirmation returns the oldest events and misses the one you just made, while an unpaginated snapshot misses any existing `review_requested` event beyond the first 30 entries — and that one then reads back as unseen and falsely confirms a request that may never have landed, the worse direction of the two. If no unseen event appears, record that request as unconfirmed and carry on with any pings that remain — do not fail the run, and do not issue this one again: the timeline is eventually consistent like every other read in this step, so an absent event is as consistent with a request that has not propagated yet as with one that never landed. An empty `reviewRequests` read is not a failed request — do not re-issue on the strength of it. When `ping-contributing` is in effect — including on a bare default run — determine which bots brought a new finding this round (its table row defines what counts) and ping only those; note each skipped bot in the summary. If more than one bot remains, perform each as its own dedicated action.

### Step 8 — Final report

In worktree mode, reclaim the worktree first, per "Working location" — after publication and equally after a `no-push` finish, but never in `delegated-fix`/`publish-reviewed`, where the worktree is the orchestrator's to reclaim (and it deliberately keeps a held descendant's). A run that is halting rather than finishing keeps its worktree and reports the path instead.

Always produce a report (this is the only output of a no-push run, and it doubles as the body of the Summary comment on push runs):

- The PR, the branch, before/after tip SHAs, and whether a rebase happened (and how conflicts went).
- **The working location and how it was selected** — inline on the target branch, forced `inline`, the off-shoot the `off-shoot` argument named, or a worktree (created or reused) — plus whether that worktree was reclaimed, or its absolute path where a halt left it standing. Say nothing about where the main checkout points now: a worktree run neither moved it nor watched it.
- Each addressed comment with a **stable reference** — file:line, comment author, the thread's GraphQL node id, and the comment permalink — and its disposition (fixed / already-addressed / pushed-back / follow-up-task / skipped). On a **no-push** run this mapping is essential: a later "push now" turn uses it to replay the exact replies/resolves without re-deriving everything.
- Push-backs, prominently, with rationale.
- Follow-up tasks, each with its committed file, queued or deferred placement, and whether it was maintainer-directed or agent-proposed.
- Proactive same-pattern fixes made beyond the literal comments.
- Reviewer outcome and how many iterations it took (and whether it hit the cap).
- Peer participation and outcome; note an unavailable/disabled/round-forfeited peer once with its reason, plus any discarded ungrounded findings.
- Anything blocked or skipped for lack of an authoritative decision, with what's needed to unblock.

## Hands-off mode

Purpose: run inside a parallelized agent that has no direct line to the user (e.g. a review orchestrator's subagent). Reach the orchestrator if you can, but otherwise drive to a best-effort completion and **document, never guess on high-stakes choices.**

- Low-stakes ambiguity → make a sensible best-effort call and record it.
- A real concern whose fix would expand the PR's scope, on a branch that is defendable as it stands → postpone it to a committed follow-up task (step 5) and flag the task and any deferred placement prominently; this is a legitimate unattended resolution, not a skip.
- High-stakes/authoritative ambiguity → skip, do not guess, document precisely what's needed.
- Non-trivial rebase conflict → abort cleanly and stop the run (step 2).
- Lease-rejected push, unidentifiable/unrelated PR, or reviewer cap hit → stop and document; do not force or guess your way past it.
- A same-named local ref failing the PR identity check, a named off-shoot that is also a *different* open PR's head by the repository-qualified comparison "Working location" states, `off-shoot` given on a detached HEAD, or a reused worktree holding a prior run's dirt or half-finished operation → halt with the report "Working location" defines (both refs and what each points at; both PRs for the branch carrying its own; the current `HEAD` for the detached case; or the worktree path and what it holds). Attach nothing, substitute no branch name, clean nothing.
- At top level, fixer/reviewer subagents are still fine. In `delegated-fix` mode, do not attempt nested delegation; return the packet to the orchestrator. Every skipped/blocked item must appear in the final report (and the Summary comment if pushing) so the user learns of it and can act later.

## GitHub API recipes

`gh api` expands `{owner}`/`{repo}` to the current repo. For GraphQL, pass real values (`gh repo view --json owner,name`).

**List unresolved review threads** (id for resolve, comment `databaseId` for replies).

**Primary — run the GraphQL query by hand.** Single-shot query — do **not** use `--paginate` here: run concurrently with other `gh` GraphQL calls (e.g. an `address-reviews` fan-out), `gh api graphql --paginate` has returned **another PR's** review threads, which unguarded would misfile replies/resolves onto the wrong PR. One page covers most PRs (`totalCount` ≤ 100); when `reviewThreads.pageInfo.hasNextPage` is true, fetch the next page as a fresh single-shot call passing the returned `endCursor` via `-F after=CURSOR`, and likewise fetch a thread's remaining comments when its nested `comments.pageInfo.hasNextPage` is true — always before triage:

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

**Optional accelerator — if `gh-review-threads` is available on PATH** (`command -v gh-review-threads`), prefer it: it encodes the query above plus the whole validation contract below (fresh single-shot per-page pagination, nested comment fetch-up, identity/shape/scope checks), retrying once and then failing closed with exit code `3` and nothing on stdout when validation keeps failing; ordinary `gh` API failures remain ordinary fatal errors. `gh-review-threads <PR#>` prints the unresolved threads as a JSON array on stdout — each thread with `id isResolved isOutdated path line` and `comments[]` (`databaseId`, `author { login __typename }`, `body`, `diffHunk`, `url`); add `--all` to include resolved threads, `--repo <owner>/<repo>` for a repo other than the current one.

Outside powbox, Codex users can copy `plugins/dev-skills/bin/gh-review-threads` onto their PATH.

```sh
gh-review-threads NUMBER | jq '...'          # unresolved threads, scope-checked
gh-review-threads --all NUMBER               # include resolved threads too
```

**Validate identity, shape, pagination, and scope before acting** (the helper, where used, does this for you; this governs the hand-run recipe): on every page, compare `repository.nameWithOwner` to `OWNER/REPO` case-insensitively and `pullRequest.number` to `NUMBER` exactly before inspecting comments; this positive identity check catches crossed responses even when there are zero comments. Require `reviewThreads.nodes` and every comment `nodes` value to be arrays, every `hasNextPage` to be a JSON boolean, and every cursor promised by a true value to be a non-empty string. Then require every returned comment `url` to match the exact repo-qualified PR path for the PR you are addressing, for example `https://github.com/OWNER/REPO/pull/NUMBER#...`. Implement the URL check as a boundary-safe match on `OWNER/REPO` plus `/pull/NUMBER` followed by `#`, `/`, `?`, or end; do not use a plain substring check, because `/pull/12` also appears inside `/pull/123`. An identity mismatch, malformed thread/comment shape or pagination metadata, comment-URL extraction failure, or URL mismatch means the response is untrusted — discard the entire result, retry once with a fresh single-shot query, and if it repeats fail closed; never reply to or resolve a thread from an unvalidated response.

**Reply to a review comment** (REST, threads the reply under the original):

```sh
gh api --method POST repos/{owner}/{repo}/pulls/NUMBER/comments/COMMENT_DATABASE_ID/replies -f body='Fixed in <sha>: ...'
```

**Resolve a thread** (GraphQL, using the thread `id` from the query above):

```sh
gh api graphql -f query='mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}){ thread{ isResolved } } }' -F id=THREAD_NODE_ID
```

**Top-level comments** (summary and codex/claude pings):

```sh
gh pr comment NUMBER --body '...'        # Summary of Review Fixes
gh pr comment NUMBER --body '@codex review'
gh pr comment NUMBER --body '@claude review'
```

**Request a Copilot review** — this request, never an `@copilot review` comment (the `ping-copilot` table row says why and carries the gh version floor):

```sh
gh pr edit NUMBER --add-reviewer @copilot
```

**Read context:** `gh pr view NUMBER --json reviews,comments,headRefName,headRefOid,headRepositoryOwner,baseRefName,url,state` and `gh api --paginate repos/{owner}/{repo}/issues/NUMBER/comments`.

## Checklist

- [ ] `gh` authenticated; the working location's tree clean and idle there, by step 0.1's two checks — the main checkout held to that only on an inline run, and checked before a forced `inline` switches it.
- [ ] Working location picked per "Working location" before any reconciliation: inline on the target branch, a worktree from anywhere else (detached included), the target branch checked out in the current checkout when `inline` was given, or the branch you are standing on when `off-shoot` named it as this PR's local off-shoot — nothing inferred that last one from the shape of the history. A candidate branch failing the PR identity check was reported to the maintainer with both refs and never worked, checked out, or attached; nothing invented a branch name in its place.
- [ ] Worktree mode: the main checkout was never switched, dirtied, or required to be clean after setup; the worktree was reclaimed after publication or after a `no-push` finish, or its path reported where a halt left it standing.
- [ ] PR resolved (explicit `PR#` precedence) and sanity-checked against the candidate branch; the working location's branch reconciled against the PR head by ancestry — fast-forward when strictly behind, keep local when the head is represented by patch-id, ask the maintainer on genuine divergence.
- [ ] If requested, single-branch rebase done first; non-trivial conflict handled (interactive loop-in / hands-off abort+stop); validated when conflicted.
- [ ] All **unresolved** threads gathered and validated per "GitHub API recipes" (single-shot queries, never GraphQL `--paginate`); resolved ones ignored; maintainer replies and top-level decision comments treated as authoritative; step 3's zero-item rule applied (terminal no-op only on the three-way tip equality).
- [ ] Each thread triaged: actionable / already-addressed / push-back / follow-up-task / ambiguous.
- [ ] Fixes done inline or via a fixer subagent (no reviewer started until the fixer's commits are on disk — one checkout-dependent agent at a time is the proxy for that; briefed under `review-cycle`'s Fixer contract); same-pattern sweep done in changed/related code.
- [ ] Follow-up-task items recorded as standalone task files per `write-tasks` conventions, placed under step 5's queued-vs-deferred rule, and committed on the current branch separately from code fixes.
- [ ] Worktree clean and every intended change committed before review and publication.
- [ ] Step 6 ran the `review-cycle` verification loop to a pass — every disposition checked by the fresh Reviewer and best-effort peer under that skill's gates, non-blocking peer outcomes recorded — or stopped at its round cap without pushing.
- [ ] Publish run (the default; suppressed only by `no-push`): step 7 followed — PR head and exact push target re-verified; normal push for a fast-forward or explicit expected-OID lease for a rewrite (never bare `--force`); threads re-read after push; replies + resolves applied idempotently per disposition; Summary comment posted without stray `@` mentions; pings fired per "Flag interactions", only after summary success and only when new commits were actually pushed.
- [ ] `no-push` run: zero PR mutations; final report maps every thread to its disposition for a later push turn.
- [ ] Final report covers rebase outcome, dispositions with stable refs, push-backs, proactive fixes, Reviewer and peer outcomes, and blocked/skipped items.
