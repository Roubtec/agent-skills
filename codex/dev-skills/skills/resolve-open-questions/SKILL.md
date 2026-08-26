---
name: resolve-open-questions
description: Open decisions are blocking progress and need the maintainer's call, one at a time. Trigger when the user wants to work through decision points, decide fix-now-vs-defer on follow-ups, unblock PR or implementation progress, resolve the open items left by an address-review, address-reviews, or review-cycle run, or run resolve-open-questions. Grounds each question in real artifacts, offers a recommendation, and applies the choice. With no arguments it takes the just-completed run's in-context items; with a pointer (PRs, task file, issue list, doc) it re-derives the list. Not for addressing fresh review threads (use address-review or address-reviews) or rebasing a stack (use rebase-stack).
---

# resolve-open-questions

Put the human in the loop on a **batch of decisions**, served **one at a time**. Any non-trivial
process — addressing a review, executing a plan, untangling a migration, or coordinating an
operational change — can produce forks where several legitimate paths exist and only the maintainer
can pick. This skill takes that pile of contentious calls and, instead of dumping them or guessing,
presents each as a tight, grounded brief, captures the decision, then applies it.

The agent does the unattended part (research, grounding, an adjacent-invariant audit, and once a
call is locked, the implementation); the **human makes every judgment call**. The agent only
recommends.

Explicit Codex invocation uses `$resolve-open-questions`; natural-language equivalents are fine.

This is the **interactive counterpart** to the hands-off skills. Where `address-review`,
`address-reviews`, and batch executors *document and stop* on anything they should not
guess, this skill is where those parked questions get answered.

> **Generic core, task-file hygiene, review-aware layer.** Sections 1–5 below are domain-neutral and
> apply to any list of open questions. The later **"When decisions live in task files (the `tasks/`
> convention)"** section adds source-agnostic hygiene for decisions recorded under that convention.
> The **"When the items come from a review-addressing pass"** section then adds the review-lifecycle
> machinery (task-backed follow-ups, cross-branch reads, fix-now publish) and points task-file decisions to that
> hygiene. If the list at hand is *not* review follow-up, read the review layer as inapplicable and
> ignore its vocabulary — don't force review framing onto, say, a set of product or accounting
> decisions.

## Inputs

- **Continuation mode (no args).** A run just completed in this session (commonly a review pass).
  Harvest the open questions from the **in-context output**: every parked decision, "hands-off
  blocker", "ambiguous / needs-a-decision" item, and "discovered finding" note. This is the common
  case and the richest — the candidate options are often already drafted.
  A completed `review-cycle`'s open questions are already in this skill's four-part brief shape (grounded context, concrete trigger, distinct options, recommendation) — consume them without re-derivation; step 2's grounding still re-verifies every carried claim (reachability especially) against current state before serving.
  Pass over any entry that cycle marked **retired**: a later pass settled the issue behind it, and the mark names the pass and disposition that did, so the decision is no longer the maintainer's to make. It rides along in the result for auditing, not for serving — raise one only to question the cycle's own call, never as a live decision. A **pending** retirement is not that mark: there the cycle stopped before any reviewer round accepted the claim, so the decision is still the maintainer's and the entry is served like any other.
- **Pointed mode (a pointer to the list).** No prior context. The user hands you where the questions
  live — PR numbers, a task/issues file, a doc, or a free-form description. **Re-derive** the
  work-list from that source (for the review case, see the review layer), then proceed identically.

Optional trailing flags, honored only by the review layer's apply phase for items chosen to fix now,
mirror the review skills: `push` and `ping-codex` / `ping-claude` / `ping-copilot` / `ping-contributing`
(re-request bot review after the follow-up push). This is a **fully interactive** skill, so it does **not** assume
publication: even for a fix-now item it **asks the maintainer to confirm before pushing and before
editing any review threads** (the flags merely pre-answer that prompt). `ping-codex` / `ping-claude`
post an `@codex` / `@claude` review comment; **`ping-copilot` requests review via
`gh pr edit <PR#> --add-reviewer @copilot`** (needs gh ≥ 2.88.0; on an older `gh`, request the
review from the PR's web reviewer menu) — never an `@copilot review` comment, which drives
Copilot's coding agent rather than its reviewer. **`ping-contributing`** carries the same meaning as in
`address-review`: re-ping a bot only if it brought a genuinely new finding this round, so a reviewer
that has gone quiet drops out of the loop — combined with explicit `ping-*` it filters that named set,
supplied alone it falls back to the bots that reviewed.

For any code-writing decision, whether generic or review-derived, the optional `peer-opinions=off` flag disables cross-harness second opinions. Otherwise, lazily run the `review-cycle` skill's peer preflight once per run, in the orchestrator's main working tree, when the first resolution needs an implementation. Decision-only sessions perform no preflight and mention no peer forfeit in their summary.

## The core loop

### 1. Gather the work-list

Sweep every source into one list of **distinct decisions**. Generic sources:

- **Parked choices** — anything an earlier turn flagged as "needs a human call" / "ambiguous" /
  "I didn't want to guess".
- **Blockers** — something a process *stopped on* because proceeding required authority it lacked.
- **Discovered side-issues** — observations noticed but not actioned because they were out of the
  run's scope.
- **Coupled forks** — one underlying choice that surfaces in two places (handle as one item).

(For the review-addressing case, the concrete forms these take — `follow-up-task` dispositions,
hands-off blockers, sibling observations, cross-branch issues — are enumerated in the review layer.)

### 2. Ground each item — do this BEFORE asking anything

A question the maintainer can decide **in seconds** needs the concrete situation and the true blast
radius, not a summary. For every item pull the **authoritative artifact**, never a paraphrase and
never the original agent's reasoning:

- Read the real source of truth (the code at the cited sites, the spec/task file, the data, the
  document) — *end to end* for short artifacts, at the exact sites for long ones.
- **Confirm the gap still exists** as described. An earlier fix or an intervening change may have
  altered or resolved it; re-verify against the current state before you put it to the user.
- Establish **how real and how reachable** it is — the single most important input to your
  recommendation:
  - *Live today* — a real user/operator path hits it in normal operation.
  - *Dormant* — only bites after a specific condition flips (a deploy-time flag, a stub replaced by
    a real implementation, a config change).
  - *Impossible until X* — a named prerequisite must land first for the situation to even arise.

### 3. Triage & order

- **Couple items that share one decision.** Two forks at the same seam — or a fix plus its analog
  elsewhere — are one call; present them together so the user isn't asked the same thing twice.
- **Order for momentum and dependency.** Lead with the clearest / highest-value calls; keep
  prerequisite-bound items adjacent. Note coupled groups up front so the user sees the shape.
- **Serve in turn — don't pre-bundle into one giant prompt.** One decision per round (a coupled pair
  counts as one). The whole point is piecemeal presentation. *Exception:* genuinely trivial,
  independent calls may be batched into **a single multiple-choice round** when doing so saves the
  user time without losing clarity.

### 4. Serve each question — the core move

For each item (or coupled group), present a tight brief, then ask.

**Open each round with a one-line progress header** — e.g. `Progress: 12 resolved · 23 pending · 35
total — this round: #13–14 (coupled).` It counts individual items (*pending* includes the item(s)
about to be served; call it out if coupling or a fresh discovery shifts the *total*). Use judgment on
cadence: it matters most on long lists, may fold into the prose for a quick run of trivial
confirmations, and must never let the maintainer lose the sense of how far along they are — nor
bury the brief.

Every brief has the same four parts:

1. **Context (grounded).** What the concern is, in terms of the actual artifact and the documented
   intent. Cite the exact site (`file:line`, the spec, the record).
2. **A concrete trigger example.** The specific situation that produces the problem — *what causes
   it or how to make it manifest* — with the reachability verdict explicit ("live today: a user
   who…", "dormant until the async rail exists", "only on a flag flip across overlapping periods").
   This is what lets a busy maintainer decide fast.
3. **Options as distinct outcomes.** The candidate resolutions — typically *do it now (A/B)*,
   *postpone (follow-up task, queued)*, *park (deferred, condition-bound)*, or *leave as-is* — and
   for each, **what choosing it actually produces**:
   blast radius, where it lands, cost, what stays exposed. Pull pre-drafted options straight from
   the source where they exist; add the do-now / postpone / park / leave-as-is axis.
4. **A recommendation, when one is defensible.** State your pick and *why*, using the heuristics
   below. Put it first in the option list and mark it "(Recommended)". If the call genuinely turns
   on something only the maintainer knows ("do you ever change this cadence live?"), say so and make
   the recommendation conditional on their answer.

Then capture the decision through the best interaction surface Codex exposes:

- If a structured user-input tool is available, use it for short multiple-choice choices: one
  question for the current item, 2-3 mutually exclusive options, recommended first and labelled
  "(Recommended)". A single request may contain up to three trivial independent questions, but only
  when batching does not hide context or tradeoffs.
- If no structured tool is available, ask in chat with a numbered list and wait for the maintainer
  to pick.

Wait for the answer before locking the decision. Honor clarifying push-back first — maintainers
often refine the *mechanism*, not just the yes/no.

**Escape hatch — let the maintainer wrap up early.** Codex cannot render an extra structured control
beside a decision, so make the exit explicit in words: tell the maintainer up front — and again
whenever a round serves a long queue — that they may say **"wrap up"** (or "stop after this") at any
time, instead of having to smuggle the request into a free-text answer. When they do, do **not**
abandon the work in flight: finish resolving and **persisting/applying the item(s) already on the
table** (step 5), then stop and produce the ledger plus a closing progress count (`N of TOTAL
resolved; M still pending, listed`) so a later session resumes cleanly. Treat a wrap-up as a clean
pause, never a discard. If the session *does* expose a structured user-input tool, you may add a
small "continue / wrap up after this" question to each round (while more than one item remains) as
the richer equivalent — but the spoken request is the baseline and always honored.

**Sub-step — audit adjacent code/data when the decision relies on an invariant.** If a resolution
introduces or leans on a non-obvious invariant (e.g. "a record may stay `ACTIVE` past its
soft-expiry"), do not just implement it — first **sweep every other consumer of that invariant** and
report whether any mishandles it. This turns "fix this one spot" into "confirm the whole subsystem
agrees", and is frequently the most valuable thing the skill does. Use `rg` where available (else
`git grep`/`grep -R`) and, for broad sweeps, a focused `explorer` subagent when the current session
exposes subagents; report findings before
proceeding.

### 5. Apply the decision

Collect decisions across the whole list, then apply. The mechanics depend on the kind of item:

- **A decision that just records intent** (a product choice, a spec edit, a "leave as-is") → make
  the edit, leave nothing dangling, note where it landed.
- **A decision that writes code** → delegate the locked decision to a fresh implementation
  subagent in the worktree that owns the change, under whatever verification the repo expects
  (tests, build/lint, isolated validation), and require a clean commit before review.
  Hand it the path any of that output must land in — namespaced by the item, or created with `mktemp -d` — never a fixed shared scratchpad name: one session's agents share that directory, and two of them redirecting to `<scratchpad>/verify.log` once had one report a verdict for the wrong branch. Never leave the choice to the subagent.

For **every code-writing decision**, run a scoped `review-cycle` on the applied decision's diff (artifact type: decision) before recording the item as applied or offering the change for delivery. Every rule that skill states under *The peer step* and *The loop and its gates* binds here whole, later additions included. Deltas for this skill:

- The cycle's work item is the locked decision verbatim with its commit range; its reviewer verifies the diff implements exactly the locked option and nothing beyond it, under whatever verification the repo expects.
- When a dispute is a judgment call rather than a factual claim, prefer surfacing the peer finding verbatim in the item's brief for the maintainer to decide instead of spending more subagent rounds. The peer informs; the maintainer still makes every judgment call.
- Do not record the item as applied or offer the change for delivery unless the cycle passed with no grounded peer finding on that item left unaddressed.

Keep a per-item ledger: the decision, where it landed (file/commit/record), or how the item was
refined.

## Subagent destroy boundary

State this in every subagent prompt this skill composes. A reviewer subagent authorized to verify a claim empirically once ran `rm -rf ./*` in a shared main checkout: its setup `git clone … | tail` had failed invisibly under `set -e` (a pipeline's status is its last command), so it deleted tracked files and moved a branch ref while believing it stood inside a clone.

- **Permitted:** reading, searching, and read-only `git`/`gh` queries — plus, for a fixer or implementer, edits, commits, and pushes confined to its own assigned worktree and branch.
- **Forbidden, named outright:** `rm -rf`, `git reset --hard`, `git clean`, `git branch -f`, `git update-ref`, `git gc`, and force-pushing — each of them beyond what the prompt itself spells out, whether as an exact command or as a skill it names to invoke. A subagent may not self-authorize one by putting itself somewhere it believes is safe — forbidden **not in a clone, not in a temp directory, not "safely"**. What you spelled out, and the disposable location below, are the only exemptions — and only because you named them.
- **A worktree is not a blast radius.** It isolates the working tree, not the repository: `branch -f`, `reset`, `update-ref`, and `gc` all reach every sibling worktree through the shared `.git`.
- **Any repository other than the subagent's own checkout is addressed by path.** `git -C <absolute path>`: never derive a working directory from a glob, and never chain a state-changing git command after a `cd` whose success you have not checked. A fix-up subagent ran `cd "$(ls -d <scratchpad>/tmp.*)" ; git commit …` where concurrent siblings had created scratch directories of their own — the glob expanded to three paths, the `cd` failed, and the `;`-chained commands landed in the shared main checkout, putting a commit on `main`.
- **Empirical verification that could change state goes where you send it.** Send the subagent to `DC="$(dc-enter <slug>)"` — one absolute path on stdout, dropped again with `dc-remove <slug>`; a reused slug is refused rather than re-derived, so anything that may run twice passes `--replace` or removes the slug first. Where that command is not found at all, install the helpers from the dev-skills plugin `bin/` rather than improvising a destination. Never leave the choice to the subagent. Give it the guarded `cd` too: `cd ""` returns 0 and moves nowhere, so checking the status catches nothing and a failed lookup leaves the subagent in the shared checkout — the form is `cd -- "${DC:?dc-enter returned no path — see its error above; if it is not installed, install it from the dev-skills plugin bin/}"`, with `pwd` confirmed before the first command that writes.

---

## When decisions live in task files (the `tasks/` convention)

Apply this hygiene whenever a decision lives in a task file under the repository's `tasks/`
convention, regardless of whether it came from a review follow-up, a `write-tasks` batch, or a
pointed run over `tasks/`:

- **Reuse task numbers — no orphans.** If a better solution emerged, **rewrite the existing task in
  place** rather than spawning a new number. If two tasks collapse into one (a shared helper),
  consolidate into one existing number and have it absorb the others.
- **Lock the chosen option.** Edit the task to mark the maintainer-selected approach as *the*
  solution and demote the rejected ones to a "considered & declined" note, so the implementer has no
  ambiguity.
- **Keep-standalone vs bind-to-prerequisite is the maintainer's risk call.** Binding a task as a
  hard prerequisite of a future feature is clean on paper but fragile (it can be forgotten when the
  feature ships). Default to a **self-standing committed task** unless the maintainer prefers the
  binding.
- **Queue planned tasks; defer only deliberately unscheduled work.** Follow the repo's layout and
  default to its task folder (commonly `tasks/`). A planned follow-up stays queued and numbered there
  even when it has prerequisites; state them in the task so ordering remains visible. Use the
  deferred subfolder (for example, `tasks/deferred/`) only for deliberately unscheduled work: it
  depends on functionality that is not certain to arrive; it addresses a condition that cannot occur
  yet or has not manifested, and fixing it would be costly; or it awaits a spike or decision between
  competing options. When unsure, prefer `tasks/`: a mis-queued task can be reprioritized during a
  batch, while a mis-deferred task is easily forgotten.
- **Promote awakened deferred tasks.** When a deferred task's condition arrives, move it into the
  repo's task folder, keeping its number unless the repo's numbering convention requires otherwise.
- **Archive implemented tasks** to `tasks/done/` (repo convention) with the implementing commit
  noted.

---

## When the items come from a review-addressing pass

This is the canonical application and the reason the skill exists. `address-review` (one PR) and
`address-reviews` (a batch) run **hands-off**: every thread a fixer couldn't resolve with
authority is parked, the run surfaces blockers and out-of-scope findings, and **none of those are
calls an unattended agent should make**. This layer is where they get made — interactively — and
where the agreed fixes land. It is the interactive inverse of the review-addressing contract.

### Review-specific sources for the work-list (step 1)

- **`follow-up-task` dispositions** — every thread the run answered with a queued-follow-up or
  condition-bound deferred-task reply. The committed task file is the spec; the thread is the origin.
- **Hands-off blockers** — anything a fixer or publisher *documented and stopped on* (a
  migration-ordering conflict, an ambiguous high-stakes choice).
- **Discovered findings with no thread** — sibling observations a fixer/reviewer noticed but didn't
  action (often a bug on an adjacent branch).
- **Cross-branch issues** — a fix whose prerequisite lives only on another branch in a stack, or an
  analog of one fix that recurs on a sibling branch.

In **pointed mode** for review work, re-derive these: for each PR read its committed task files
(grep `tasks/` for bodies citing that PR's task-backed threads), read the threads resolved with a
`follow-up-task` disposition, and scan recent run reports / commit messages for discovered findings.

### Review-specific grounding (step 2)

- Read the **committed task file** end to end — it restates the concern, names the code sites, lists
  "decision direction" options, and gives acceptance criteria. Pull its options straight into the
  brief.
- Read the **real code** at those sites. In a stack, read **across branches without checking
  anything out** using `git show <ref>:<path>` (pipe through `cat -n` when line numbers matter); if
  a `gitcat` helper is on PATH, prefer it for stable line-numbered slices. Confirm the gap still
  exists on the *addressed* tip.
- Classify **reachability** exactly as in the core (live today / dormant under a stub-flag-adapter /
  impossible until a named prerequisite) — it drives the recommendation.

### Review-specific apply (step 5)

**Fix-now items → worktree → review → publish** (borrow the machinery from
`address-reviews`):

- One **git worktree per owning branch** (see the `address-reviews` skill's Session Bootstrap and
  isolation model). A coupled fix + sibling-analog may span two branches: each lands on **the
  branch that owns that code**; never split one atomic change across two worktrees.

  **Re-homing an orphaned finding.** A long session outlives its own PRs: a maintainer merges an in-scope PR mid-run while non-blocking items on it are still open, so the file the finding concerns now lives on `main` and the branch that carried it is gone. The item still deserves to land — it just needs a different host, chosen by these rules:

  1. **Match by code ownership.** Host it on the open PR that already touches that file or subsystem. When no open PR does, do **not** stretch an unrelated PR's scope to carry it: fall back to the skill's ordinary deferral — a committed queued follow-up task under **"When decisions live in task files (the `tasks/` convention)"** above, which is where a postponed item lands anyway.
  2. **Rebase first, onto the host's own base ref.** Before applying the fix, bring the host branch forward so the finding's file — now on `main` — is actually present on it; otherwise the fix re-introduces or conflicts with merged content. Rebase onto the **host PR's actual base ref**, not onto the merge target by default: a host stacked on another open PR, rebased straight onto `main`, replays its parent's commits into its own diff, especially once the parent's merge rewrote their SHAs. **Fetch that base ref first and pin every rebase to an explicit commit that already contains the merge** — `rebase-stack` deliberately never fetches, so a local `main` still pointing before the merge lets the rebase succeed with the finding's file still absent, which is exactly the stale geometry this rule exists to prevent. For a stacked host, restack in the topological order the `address-reviews` and `rebase-stack` skills define (task 021's ordering rule, in the repos that track these skills' tasks) — parent onto its true base first, then the host onto the parent's new tip — rather than skipping to the merge target.
  3. **State provenance, and split the publication between the two PRs.** Name the merged PR the finding came from in the commit message, and in the thread reply whenever the original thread still exists, so the host PR's reviewer can tell why an out-of-scope-looking hunk is there. That reply is the **only** action aimed at the merged source PR; the push, the Summary comment, and any reviewer ping below target the open PR(s) whose diff actually changed — the **host**, plus a stacked host's rebased parent, published parent-first as the publish bullet says. A ping on the merged PR summons no review of the new commit, and the host PR's reviewers never learn there is something to look at.
  4. **Mid-run merge checkpoint.** When a batch discovers that an in-scope PR was merged mid-session, re-derive that PR's state and merge commit from the API *before* triaging its leftovers — never triage from the session's earlier snapshot, which is exactly the state the merge invalidated.
- Delegate the implementation to a fresh subagent with the worktree contract, the task-file spec,
  and the decided option. Require: real **tests** (deterministic, clock-injected where the bug is a
  race — they verify the fix even when the production trigger is dormant), validation on an
  **isolated DB**, a clean commit, **no push**.
  Hand it the path any of that validation output must land in — namespaced by the item, or created with `mktemp -d`, and outside the worktree it commits from, which must be left clean — never a fixed shared scratchpad name: one session's agents share that directory, and two of them redirecting to `<scratchpad>/verify.log` once had one report a verdict for the wrong branch. Never leave the choice to the subagent.
  When the fix **fully satisfies** the task, that same
  commit must also **move the task file to `tasks/done/`** so a later round cannot pick up a stale
  copy of work already done; when it only **partially** satisfies the task, leave the file in
  `tasks/` for a follow-up round and do **not** claim the thread as done. Archiving inside the
  *same* commit/PR is deliberate, not a violation of `tasks/AGENTS.md`'s "move to `done/` after
  merge" rule (where the repo follows the `tasks/` convention): a fix-now item pulled into another
  PR's scope has **no branch of its own**, so its `tasks/done/` move can only ride that PR — if the
  PR never merges, the move is discarded with it and nothing is lost. That is distinct from a task
  **selected for its own implementation**, which stays in `tasks/` for a final review under the
  one-task-one-branch model.
- Run the core code-writing review/peer loop above in each implementation worktree. Its delivery gate
  additionally means: do not reply to a review thread, update a task file, or offer the change for
  publication while any grounded peer finding on that item remains unaddressed.
- **Publish** each passing change *only after the maintainer confirms the push* — this interactive
  skill never pushes or edits review threads unprompted (a one-line "publish these fixes now?"
  question, pre-answered by a `push`/`ping-*` flag): these are commits *on top of* an already-pushed
  tip, so the push is a normal **fast-forward** (not a lease rewrite) — except a branch that re-homing rule 2 rebased (the host, and for a stacked host its parent), whose already-pushed commits that rebase rewrote: those publish with an exact expected-OID lease exactly as `address-review`'s push step defines, never a bare `--force`, and a rebased parent publishes before the host — until it does, the host's PR diff shows the parent's replayed commits. Then post a **follow-up reply
  on the now-implemented thread** ("now implemented in `<sha>`" — append "task moved to
  `tasks/done/`" only when the commit actually archived it; a partially-satisfied task stays in
  `tasks/` and its thread is left as it stands — do **not** reopen a thread a prior run already
  resolved, since a re-review (codex especially) re-raises anything still unaddressed and rewriting
  historical resolutions is needless and messy), a Summary comment, and re-ping bots if requested, exactly per the
  ping-flag definitions under Inputs.

**Task-backed follow-up items → task-file hygiene** (no code, but leave nothing dangling):

Apply **"When decisions live in task files (the `tasks/` convention)"** above to every task-backed
follow-up decision. The review-specific context is that the resolved thread already points at the
file; preserve that target while applying the source-agnostic hygiene.

### Review-specific aggregate & flag

- **New review threads that arrived mid-run.** A bot re-review triggered by the *original* push may
  have posted fresh threads while this session ran; publishers will report them. Surface them
  prominently — they are a *new* round, **not this skill's scope** (point at `address-review` /
  `address-reviews`).
- **Stack state.** Fix-now follow-ups make a stacked chain leafier; inherited-code fixes and
  consolidated tasks **collapse at restack**. Point at `rebase-stack` for the integration pass.

---

## Recommendation heuristics (how to pick the "(Recommended)" option)

- **Reachability dominates.** *Live today* → lean **do it now** (it bites real users). *Dormant
  under a stub/adapter/flag* → lean **postpone** to a queued follow-up with the trigger stated as a
  prerequisite. *Impossible until a named prerequisite* → likewise **postpone** by default and state
  that prerequisite, while keeping the work *implementable and verifiable now* when it is independent
  (hardening a seam *before* the feature that exposes it is the safer order). **Park** in the deferred
  folder only when the waking condition is genuinely uncertain.
- **Blast radius & altitude.** A one-seam fix that mirrors an already-accepted pattern → do it now.
  A change that widens a cross-module interface, reverses a prior accepted decision, or touches the
  most sensitive path (money, auth, migrations) → prefer the **robust** option or postpone to a
  queued follow-up; park only under the condition-bound criteria above, and never choose the
  blunt stopgap on a sensitive path.
- **Robust over blunt** for a correctness invariant: prefer the option that holds under *any* input
  (and is a no-op in the common case) over one that parks/blocks legitimate flows.
- **Stack-aware placement** (review case). Land a fix on the branch that **owns** the code; inherited
  copies heal at restack — don't duplicate it on every branch. Surface a sibling-branch **analog**
  and let the maintainer opt in rather than silently expanding scope.
- **Conservatism on the sensitive path.** When unsure between do-now and postpone on a
  financial/security/migration change, recommend the committed queued task/deliberate build —
  defendable as it stands, and the fix gets built carefully.
- **Make it conditional when it hinges on intent.** If the right answer depends on a product/ops
  fact only the maintainer holds ("will you ever change this setting live?"), ask *that* and frame
  the recommendation around the answer.

## Notes

- This skill **consults the user** — that is its whole purpose. The only things it does unattended
  are the *grounding/audit research* and, once a decision is locked, the *implementation* (which
  still goes through review before publish).
- Read `AGENTS.md` / `CLAUDE.md` for repo conventions (task layout, `tasks/done/`, test harness,
  isolated-DB story) before forming options.

## Checklist

- [ ] Mode detected (continuation vs pointed); full work-list gathered (parked choices + blockers +
      discovered findings + — for review work — follow-up tasks & cross-branch issues).
- [ ] Each item **grounded** in its authoritative artifact (real code/data/spec; cross-branch via
      `git show`/`gitcat`); gap re-confirmed; reachability classified.
- [ ] Coupled items grouped; order set; served **one at a time** (trivial independents may share one
      multiple-choice round) with context + trigger example + options-as-outcomes + recommendation;
      decision captured through the best available Codex interaction surface. Each round opens with a
      `resolved · pending · total` progress line, and the maintainer is told they can say "wrap up" to
      end early — on which, finish + persist the current item, then stop with a resume-ready ledger.
- [ ] Adjacent-invariant audit run whenever a resolution relies on/introduces one; findings reported
      before implementing.
- [ ] Code-writing decisions verified (tests, build, isolated validation) through a scoped `review-cycle` on each applied decision's diff, with only disputed judgment calls surfaced for the maintainer's judgment; review-case fix-now items additionally use a worktree per owning branch and **fast-forward** publish (thread reply, Summary, re-ping) — an exact expected-OID lease only where re-homing rule 2 rebased a branch (the host, and for a stacked host its parent, published parent-first) — with no atomic change split across branches.
- [ ] Decisions recorded under the `tasks/` convention follow **"When decisions live in task files
      (the `tasks/` convention)"**; review-case follow-up-task items preserve the file their resolved
      thread already points at.
- [ ] Final ledger + (review case) prominent flag of any NEW review threads + `rebase-stack` pointer
      for the leafy stack.
