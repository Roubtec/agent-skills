---
name: address-reviews
description: Address maintainer-vetted review feedback on several pull requests in parallel, one git worktree per entry — supply the batch as PR numbers and/or local branch names; each worktree checks out the chosen branch (your local ref when you name a branch, the PR head when you give a number) and runs the address-review skill in hands-off mode (publishing each entry by default, with push/ping flags passed through; no-push for a local-only batch), so many PRs are fixed concurrently without cross-talk. Trigger when the user asks to address reviews on multiple PRs or branches at once, fix review comments across many PRs in parallel, or fan out review-addressing with worktrees. Do not trigger for a single PR (use address-review), for implementing new task files (use address-tasks), or for rebasing a stack (use rebase-stack).
---

Address the review feedback on **several pull requests at once**, fanning each PR out into its own git worktree so they progress concurrently without polluting each other.

**Arguments:** `<PRs and/or branches> [no-push] [push] [peer-opinions=off] [ping-codex] [ping-claude] [ping-copilot] [ping-contributing]`

Explicit Codex invocation uses `$address-reviews`; natural-language equivalents are fine.

This skill is the parallel batch front-end for `address-review`.
It does **not** re-implement review-addressing — it sets up one isolated worktree per entry and uses `address-review`'s delegated fix and publish procedures, with a fresh orchestrator-owned reviewer and best-effort `claude` second opinion between them.
Each batch entry is either a **PR number** (resolve the PR head, preferring a usable same-named local branch before falling back to `origin`) or a **local branch name** (work *your* local ref exactly as it stands) — see "Resolving and checking out each entry" for the local-first rule that keeps a locally-rebased branch from being silently replaced by a stale `origin` copy.
It borrows its worktree machinery (isolation model, Session Bootstrap, adaptive throttling, cleanup) wholesale from `address-tasks` — **read that skill for the rationale behind those pieces**; only the deltas are spelled out here.

## How this differs from address-tasks

Everything here follows from one fact: **the PRs already exist**, so we modify existing branches rather than create new ones.

- **No new PR head lineage, no `gh pr create`.** Each worktree checks out an **existing PR head branch** (creating a local tracking branch only when needed); pushing is handled inside `address-review`.
- **No dependency waves.** Distinct PR heads are independent review-addressing units, so they can run concurrently from the start (subject to throttling). Entries that resolve to the same head branch must be serialized; genuinely stacked but distinct branches can still run independently, with restacking left for later.
- **Per-PR guidance comes from `address-review`, but the parallel orchestrator owns the phases.** A fix subagent runs `delegated-fix`; a separate fresh Reviewer and concurrent best-effort `claude` peer check the returned packet; fix-up/re-review rounds follow as needed; only an entry whose Reviewer passes and whose peer has no grounded findings or is explicitly forfeited, unavailable, or disabled gets a `publish-reviewed` subagent. The peer wiring in standalone `address-review` is not inherited because `delegated-fix` stops before review.
- **A leafy branch stack is the expected outcome and is fine.** Parallel fixes leave the PR branches diverged. This skill does **not** build a restack guide — integrating the result is a deliberate follow-up via `rebase-stack` (or manual rebases). See "After the batch".

## Stacked PRs: a fix may be hostable on only one branch

When the batch contains stacked PRs, a thread's fix can depend on code that exists only higher up the stack (a gate, helper, or schema a later branch introduces). A per-PR fixer on a lower branch cannot host that fix, and two worktrees must never implement halves of one atomic change. When triage reveals such a dependency, concentrate the change on the branch where its prerequisite lives (often top-of-stack), and close out the lower PR's thread without a local code fix — while keeping each disposition's `address-review` contract intact. Cross-PR references are valid and expected here, but they ride on the normal disposition mechanics: use **deferred-to-task** backed by a committed task file that restates the concern and points at the hosting PR/branch — the committed record the reply cites, not the bare reply itself, is what proves the concern will not be forgotten after the merge. The task normally rides the PR's own branch, but any committed home whose merge is part of the plan qualifies: an earlier branch in the stack that already carries the task, or — a maintainer-accepted calculated risk — the hosting branch higher up (that record evaporates if its branch never merges). Use **already-addressed** only when the branch's *own* code already satisfies the concern — never on the strength of a fix that exists only on another branch. For *reading* across the stack without touching any checkout, use `git show <ref>:<path>` (pipe through `cat -n` when you need line numbers); if a `gitcat <ref> <path> [<start> [<end>]]` helper is on PATH, prefer it — it prints another branch's version of a file with stable line numbers directly.

## Arguments

Parsing is **lenient** — accept commas, `&`, `#` prefixes, and free word order.

| Argument | Meaning |
|---|---|
| `<PRs and/or branches>` | The batch: one or more entries, each a **PR number** (`#38`, `38`) or a **local branch name** (`task/088`). May be mixed (`#38 task/084 6`). Each becomes one worktree + one phased review-addressing workflow. This is the only required argument. |
| `no-push` | Passed through to every entry as a **local-only run**: fix and commit in each worktree, but mutate no PR (no push, replies, resolves, Summary, or ping). This was the default until now; it is now the explicit way to run the whole batch as a dry run. |
| `push` | Passed through to every passing entry's publisher: push the fixed branch (normal fast-forward or exact expected-OID lease for a rewrite) and do the PR-side communication (replies, resolves, Summary comment) — but **ping no reviewer**. Use it to publish the batch quietly, without summoning fresh review rounds. |
| `peer-opinions=off` | Disable the best-effort `claude` disposition review for the whole batch. It is on by default, including in hands-off mode. |
| `ping-codex` | Passed through: after `address-review` pushes new commits or rewritten history, post a dedicated `@codex review` comment on that PR. Implies `push`; `address-review` skips the ping when publication is an "Everything up-to-date" no-op. |
| `ping-claude` | Passed through: after `address-review` pushes new commits or rewritten history, post a dedicated `@claude review` comment on that PR. Implies `push`; `address-review` skips the ping when publication is an "Everything up-to-date" no-op. |
| `ping-copilot` | Passed through: after `address-review` pushes new commits or rewritten history, request a Copilot review on that PR via `gh pr edit <PR#> --add-reviewer @copilot` (canonical CLI request, not an `@copilot review` comment — that drives Copilot's coding agent, not its reviewer). Implies `push`; `address-review` skips the request when publication is an "Everything up-to-date" no-op. |
| `ping-contributing` | **The default** — a bare batch with no push/ping argument publishes every entry and re-pings its contributing bots exactly as if this were passed, so spelling it out is redundant (kept for reference, and for combining with a named ping). Passed through: each PR's publisher re-pings a bot only if it brought a genuinely new finding **on that PR** this round (a re-raise of an already-deferred concern or a re-argued push-back does not count unless it adds a new angle). Combined with explicit `ping-*` it filters that named set per PR; supplied alone (or as the bare default) it falls back to the known bots (codex/claude/copilot) that reviewed each PR. Implies `push`. Because the decision is made inside each `address-review`, the ping set is pruned **per PR** — a bot may keep being pinged on a PR where it is still finding issues while it has gone quiet on another. |

**Classifying each entry:** a bare integer or `#`-prefixed integer is a **PR number**; anything else (contains a `/`, letters, etc.) is a **branch name**. A branch literally named like an integer is the one ambiguous case — name it with an explicit `refs/heads/` prefix or just pass its PR number instead.

**Local-first guarantee.** When you supply a branch name, the worktree is checked out from **your local ref, never from `origin`** — so a branch you rebased locally while `origin` is stale is worked exactly as it stands on disk. More broadly, this skill checks out `origin` for an entry **only when there is no local branch to use** (a PR number whose head branch you don't have locally). It never silently swaps your local copy for a stale remote one. The `git fetch origin` in Bootstrap updates **remote-tracking refs only** (`origin/*`); it never moves a local branch or changes which commits a branch-entry worktree operates on — it just makes the later force-with-lease accurate.

**Always force-injected into each `address-review` invocation (not a user argument):** `hands-off`.
Every parallel subagent has no line back to the user, so its prompt must impose the equivalent unattended contract: best-effort on low-stakes choices, document and stop on high-stakes blockers.
The top-level orchestrator (you) may still consult the user for **batch-level** blockers (e.g. a PR number that resolves to nothing) when you yourself are running interactively.

**Not user-facing (orchestrator may supply at its own discretion):** the per-PR `#N` (you always pass each subagent its assigned PR) and `rebase on top of <branch>`.
The user has no reason to pass a rebase here — the leafy stack is resolved later — but if you detect a stacked PR that genuinely must be addressed against its near-final base, you may pass a rebase target to that one PR's `address-review`. Off by default.
When you do pass one, **pin it to an exact commit**: resolve the target once, right after Bootstrap's `git fetch` (e.g. `git rev-parse origin/main`), and pass that SHA rather than the symbolic name. Remote-tracking refs can advance mid-batch (any later fetch moves them), so a name each entry resolves at its own time could rebase entries onto different bases; one recorded SHA keeps the whole batch deterministic.

**The default is to publish.** A bare batch (no push/ping argument) publishes every entry and re-pings its contributing bots, exactly as `ping-contributing` (resolution order and precedence are as in `address-review` → "Flag interactions"); `no-push` is the only way to run the whole batch local-only. Flag pass-through is otherwise **batch-uniform**: the same resolved `push`/`ping-*` set applies to every PR in the run. With `ping-contributing` (including the bare default), the *flag* is uniform but its *effect* is evaluated independently inside each PR's `address-review`, so each PR re-pings only the bots still contributing to it.

## Worktree isolation (inherited)

Each PR runs in its **own git worktree** — a separate working directory with its own `HEAD` and index, sharing the one append-only object store and lock-protected refs.
Two subagents in two worktrees never corrupt each other, so they run **concurrently**.
The only serialization rule that survives: agents sharing *one* worktree must run one-at-a-time. Across distinct PR head branches, same-phase agents may run concurrently.
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
Within one PR's worktree, wait for and close the fixer before spawning its fresh reviewer, and wait for and close the reviewer before any fix-up or publisher. The examination-only `claude` peer is a plain shell process, not a Codex subagent, and is the sole same-worktree concurrency exception: launch it beside the Reviewer only after the tree is committed and clean, then collect both before advancing.
Never continue a fixer thread for review.
If the session exposes no subagent capability, stop and tell the user this workflow requires Codex multi-agent support.

## Session Bootstrap (run once, in the main working tree, before any worktree)

Follows `address-tasks` → "Session Bootstrap" — see that skill's Bootstrap for the fuller rationale. In brief, all idempotent:

1. **Prepare the worktree base and prune stale state.** Pick or create a base directory for worktrees — an ignored directory inside the repo (e.g. `<repo>/.worktrees/`; if it is not already ignored, list it in `.git/info/exclude` rather than editing `.gitignore` — a dirty main checkout would later block freeing a batch branch it occupies) or a directory outside the repo. Run `git worktree prune` to clear stale registrations, and remove any orphaned directories under the base that `git worktree list` no longer knows about. Then probe remote access with `git ls-remote origin`. **Stricter than the task batch:** here a failed remote probe is a stop — PR-number resolution and lease-safe publication cannot be trusted from stale refs. The chosen base is the `$WT_BASE` used below. If a `wt-bootstrap` helper is on PATH, prefer it — it performs these checks and prints the base dir as JSON.
2. **Confirm GitHub API access.** `gh auth status` must succeed for every run because each subagent must read review threads (the `git ls-remote` probe checks git remote access, not the API).
3. **Preflight the peer once for the batch, unless `peer-opinions=off`.** In this main working tree, classify the probe explicitly:
   - If `command -v claude` fails, mark the peer unavailable.
   - If `claude auth status` succeeds, mark the peer available.
   - If `claude auth status` fails while `ANTHROPIC_API_KEY` is set, defer classification to the first real invocation because the environment key may authenticate it without a saved login.
   - If the failure says this older CLI does not support the `auth status` subcommand, likewise defer classification to the first real invocation because no probe is available.
   - For any other `claude auth status` failure, mark the peer unavailable and retain the failure reason.
   In either deferred-classification path, an auth/usage failure on the first real invocation marks the peer unavailable for the rest of the batch. Never repeat the probe inside entries. Unavailability does not block the batch; retain its reason for one final-summary note.
4. **`git fetch origin`** to refresh remote-tracking refs. This updates `origin/*` only — it never moves a local branch or rewrites a worktree — so it is safe for branch entries (which work the local ref regardless) and is what makes a later `--force-with-lease` push compare against the true current remote tip. It also lets a PR-number entry whose head you lack locally check out the current `origin` head.
5. **Record the main checkout's starting checkout mode:** current branch (which may be empty when detached) and `HEAD` SHA. A branch can be checked out in only one place at a time, so any entry branch the **main checkout currently occupies** must be freed before its worktree is created. The orchestrator does this on demand by detaching the main `HEAD` (see "Resolving and checking out each entry"), which needs the main tree clean. Restore the original branch after all entries using it are finished, or the original detached SHA if the session began detached. Starting from a branch outside the batch (usually `main`) avoids this dance.

## Orchestrator responsibilities

You are the orchestrator. You do **not** edit the PR branches yourself; delegated fixers and publishers follow `address-review`, while you own worktree setup, fresh reviewer phases, and result aggregation. Your job:

1. Parse the batch into a list of entries, classifying each as a PR number or a branch name (see Arguments); capture the pass-through flag set.
2. Run the **Session Bootstrap**.
3. Resolve every entry to a `(local-or-origin branch, PR number)` pair before creating worktrees. De-duplicate aliases for the same PR (for example `#38` plus its branch name), and group different PRs that share one head branch so they run serially rather than contending for the same ref.
4. **Create one worktree per distinct head branch in the current sub-batch** (see next section). Create a later same-head entry's worktree only after the earlier entry is complete and removed. Skip-and-record any entry that cannot be set up (closed/merged or PR-less, branch checked out elsewhere, unsupported fork branch entry).
5. Run the per-PR **fix → review → fix-up** loop in lockstep phases across distinct worktrees, up to 6 reviewer rounds (see "Per-PR phased subagents").
6. For entries that pass, spawn `publish-reviewed` subagents concurrently across distinct worktrees — unless the run is `no-push` (local-only), in which case skip publication and keep each entry's disposition map for a later push.
7. **Clean up** each worktree once its subagents return (never delete the PR branch).
8. **Aggregate** every per-PR report into one batch summary, surfacing the hands-off blockers prominently.

## Resolving and checking out each entry

This is the part that differs most from the task-file skills: you check out a branch that **already exists** (your local ref, or `origin`'s, occasionally a fork's) rather than creating one. Each entry resolves to a `(branch-to-check-out, PR-number)` pair; the pair drives the worktree and the subagent.

Shared setup, from the main tree: `$WT_BASE` is the worktree base dir chosen in Bootstrap, and `$ROOT` the repo root. For the **plain attach cases** below the standard form is `git worktree add "$WT_BASE/<slug>" <branch>` — after checking `git worktree list` for an existing entry: if the target directory already exists, verify it has the right branch checked out and reuse it; a wrong branch or an occupied ref means stop and report that entry, never guess. If a `wt-enter <slug> <branch>` helper is on PATH, prefer it — it encodes exactly these checks (rerun-safe attach under `$WT_BASE`, refusing rather than guessing on wrong-branch or occupied-ref conflicts). The cases the plain attach does not cover (detaching the main checkout, tracking `origin`, forks) keep their explicit commands. These calls are safe to run while other entries' subagents are active — they touch only their own worktrees and the lock-protected refs. Use a stable, collision-free slug per entry (e.g. `pr-<N>` or a sanitized branch name).

### Branch entry — work your local ref

The local-control path (the rebased-locally / stale-origin case). Normalize an explicit `refs/heads/<name>` input to the bare `<name>`, then require `git show-ref --verify "refs/heads/<name>"` before doing anything else; skip if it is not a local branch. The bare local branch name must equal the PR's `headRefName` (which is the norm: a local rebase keeps the branch name). If your local copy has a different name than the PR head, this auto-pairing cannot see it; use that PR's number with `address-review` directly, or rename to match.

1. **Pair to the PR by head:** `gh pr list --head <branch> --state open --json number,url,headRepositoryOwner`.
   - Exactly one open PR → that's the pairing.
   - Zero → skip-and-record: with no PR there are no review threads to address.
   - More than one → skip-and-record as ambiguous (or, interactive, ask which).
   - If the PR head is a fork, skip-and-record this branch-form entry and tell the user to pass the PR number instead; the unconditional `origin/<branch>` upstream used below is valid only for same-repository heads.
2. **Check out the verified local ref as-is** — never `origin`, never a reset:
   - Not checked out anywhere → the plain attach: `git worktree add "$WT_BASE/<slug>" <branch>`.
   - Occupied by the **main checkout** (it's the orchestrator's current branch) → free it by detaching the main `HEAD` (`git -C "$ROOT" switch --detach`) **when the main tree is clean**, then attach it with the plain attach; the starting checkout mode recorded in Bootstrap is restored in Cleanup. If the main tree is *dirty*, skip-and-record (commit/stash or move the main checkout off it first). If setup fails after detaching and no later entry needs that branch free, restore immediately before continuing.
   - Occupied by **another worktree** (a sibling entry, or the same branch listed twice) → skip-and-record; a branch can't live in two worktrees.
3. **Set the push target:** `git -C "$WT_BASE/<slug>" branch --set-upstream-to=origin/<branch>` (origin's head ref for the paired same-repository PR, refreshed by Bootstrap's fetch). `address-review` still verifies the exact PR head and uses an expected-OID lease before any rewrite.

### PR-number entry — work the PR head

The canonical path. Resolve the PR, then prefer a same-named local branch if you have one (so we still never bypass your local copy), else check out `origin`'s head.

1. **Resolve and sanity-check:** `gh pr view N --json number,state,headRefName,headRepositoryOwner,baseRefName,url,title`. If `state` is not `OPEN`, skip-and-record. Note `headRefName` and whether `headRepositoryOwner` matches `origin`'s owner (same-repo) or differs (fork).
2. **Same-repo:**
   - If local `<headRefName>` exists, compare it with `origin/<headRefName>` **before** considering checkout occupancy. If it is strictly behind with no unique local commits, skip-and-record rather than force-rewriting newer remote work; ask the user to fast-forward it or explicitly pass the branch if they truly intend the stale local state.
   - A usable local `<headRefName>` that is free → the plain attach (`git worktree add "$WT_BASE/pr-<N>" <headRefName>`) and **record any ahead/diverged state** in the summary.
   - A usable local `<headRefName>` occupied by the main checkout → detach the clean main `HEAD` and add the worktree as in the Branch-entry case; if held by another worktree or the main tree is dirty, skip-and-record.
   - No local `<headRefName>` → `git worktree add --track -b <headRefName> "$WT_BASE/pr-<N>" origin/<headRefName>`.
3. **Fork PR** — let `gh` wire up the fork remote and tracking inside a detached worktree:
   ```bash
   git worktree add --detach "$WT_BASE/pr-<N>"
   ( cd "$WT_BASE/pr-<N>" && gh pr checkout N )
   ```
   `gh pr checkout` also works for same-repo PRs, so it is a fine uniform fallback whenever the explicit `git worktree add` path is awkward.

The absolute worktree path, the checked-out branch name, the **paired PR number**, and (for branch entries) the note "this is your local ref" are what you hand that entry's subagent.

## Per-PR phased subagents

Codex subagents must not be assumed to spawn their own subagents, so the top-level orchestrator owns every phase, including peer launch and triage.
For each reviewer round, fan out one same-phase subagent per distinct worktree in one tool-call batch and launch that entry's peer beside it, wait for both outcomes for every entry, close the subagents, then advance the phase.

Every prompt starts with:

- **WORKTREE CONTRACT first:** "Your worktree is `<absolute path>`. Before anything else, `cd` into it and verify `git rev-parse --show-toplevel` prints exactly that path; if not, STOP and report. Do all work inside this worktree only — never `cd` to the repo root or touch sibling worktrees. Other agents are working in other worktrees concurrently; stay in yours."
- **The assignment:** "You are on branch `<branch>`, paired with PR #N. Confirm the branch with `git branch --show-current`. PR #N is the **authoritative pairing** — treat the supplied number as correct and do not re-derive it. This branch may be a local, possibly-rebased copy of the PR head, so its SHAs can differ from `origin`'s; that is expected, not a wrong-PR signal." (For a branch entry, add: "This is *your local ref*; work it exactly as it stands — do not reset or pull from `origin`.")
- **Skill:** pass the installed `address-review` skill (invoke it by name, or pass its installed SKILL.md path); do not make the subagent search across sibling worktrees.
- **Repo context:** "Read the repository's agent-context files (`AGENTS.md`, `CLAUDE.md`, or `.github/CLAUDE.md`) first for conventions."
- **Validation in a worktree:** "If verifying fixes needs a build, install dependencies in this worktree first — cheap when the package manager's store hardlinks (e.g. pnpm on the same filesystem). Point Playwright at a system Chromium if your environment provides one. App-server / `next build` e2e may not run from a nested worktree path; defer it per `address-tasks`'s app-server caveat and note that in your report rather than forcing it."
- **No shared plan tracker:** "Do not write to any shared task or plan tracker; child entries leak into the orchestrator's view."

### Phase A — initial fix

Spawn one `worker` per PR and prompt it to invoke `$address-review #N hands-off delegated-fix <optional rebase target>` (or read the supplied absolute skill path and follow that mode).
It must make no PR mutations and return the complete review packet defined by `address-review`.
If it reports a successful no-op because no actionable review items remain, mark that entry complete without a reviewer or publisher.

### Phase B — fresh review

Only after all Phase-A workers return and are closed, spawn one fresh `explorer` Reviewer per PR and, at the same moment for each entry, launch a background `claude` peer unless disabled or unavailable.
Give it the verbatim review items and proposed dispositions from that PR's packet, its effective review base, branch, and worktree path — never the fixer's reasoning.
Use `address-review` step 6's reviewer contract.
It edits nothing and reports Pass or numbered Issues.

Give the peer those same inputs verbatim, not the fixer's reasoning or the Reviewer's execution steps. Tell it to read the actual files, edit nothing, and verify dispositions in committed code: fixes hold, already-addressed claims are true, push-backs are technically justified, and deferrals point to a committed task file that covers the concern. It may inspect code for quality but must not run builds/tests; the fresh Reviewer owns build/typecheck. Require `VERDICT: PASS | ISSUES`, followed for Issues by numbered findings tagged `blocking` or `minor`, each with `file:line` and a one-line rationale.

Before each launch, create a unique directory outside all entry worktrees for this entry, invocation, and attempt; never reuse or share it. Write the prompt verbatim to a file there without evaluating it, and write `git -C <worktree> log --oneline <base>..HEAD` plus `git -C <worktree> diff <base>...HEAD` from that entry's exact worktree to a read-only artifact in the same directory; never populate it from the orchestrator checkout or another entry. Include the artifact path in the prompt and grant only this invocation directory with `--add-dir`, never a shared parent directory. Managed hooks and organization settings policy can still apply under `--safe-mode`, so an operator in a managed environment must disable peer opinions or first ensure those hooks cannot mutate the worktree before launching peers concurrently with Reviewers. The canonical launch below includes `--effort high` for the common unknown/default-effort case. Only when the configured or default effort is already known to be `high` or stronger (`high`, `xhigh`, `max`, or `ultracode`), remove that flag so the configured effort is preserved; never put bracketed optional tokens in the command. Shell-quote every generated path when replacing the placeholders, keep `--safe-mode` and both read-only tool guard flags, and never pass permission-bypass flags.

Launch every entry's peer in its own dedicated session and process group; do not use plain background subshells, because killing one can orphan `claude` or its descendants. Require `setsid` for this path (otherwise disable/forfeit the peer), bind distinct `worktree`, `invocation_dir`, `prompt_file`, JSON `outfile`, and diagnostic `errfile` values for each concurrent entry, require both output paths to be inside that entry's invocation directory, and execute this block in that entry's isolated launch context:

```sh
peer_session_file="$invocation_dir/session.pid"
if (umask 077 && : > "$peer_session_file"); then
  setsid --fork --wait sh -c '
    session_file=$1
    worktree=$2
    shift 2
    printf "%s\n" "$$" > "$session_file" || exit 125
    cd "$worktree" || exit 125
    exec "$@"
  ' peer-launch "$peer_session_file" "$worktree" \
    claude -p --effort high --safe-mode --tools "Read,Glob,Grep" --disallowedTools "mcp__*" \
    --add-dir "$invocation_dir" --output-format json \
    < "$prompt_file" > "$outfile" 2> "$errfile" &
  peer_wait_pid=$!
else
  peer_wait_pid=
  peer_launch_status=125
fi
```

Create each entry's `peer_session_file` as an empty, owner-only regular file before launch and do not launch that entry if preparation fails. Store `peer_wait_pid` in the entry's record, poll for the file to become non-empty, require its contents to be a positive decimal PID, and store that value as the entry's `peer_pgid`. Never infer the group ID from the supervisor PID, because `setsid --fork` deliberately makes them different. The PID-file write is the session's first operation and is checked, so `claude` cannot start unless the handoff succeeds. If a supervisor exits before a valid handoff, immediately `wait` for that entry's `peer_wait_pid` to reap it, record the launch failure (normally status 125 for the write or `cd` guard), and never advance or retry from that attempt.

Use a loose roughly 12-minute timeout per entry, extending it when review size warrants. After an entry's `peer_pgid` passes the numeric/positive check, define these helpers in that entry's isolated context. The negative PID operand targets the validated process group; omitting `--` is intentional because the Dash `kill` builtin rejects it. Keep this form for TERM, KILL, and every death probe:

```sh
peer_group_alive() {
  kill -0 "-$peer_pgid" 2>/dev/null
}

peer_stop_group() {
  kill -TERM "-$peer_pgid" 2>/dev/null || :
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    peer_group_alive || break
    sleep 1
  done
  if peer_group_alive; then
    kill -KILL "-$peer_pgid" 2>/dev/null || :
  fi
  wait "$peer_wait_pid" 2>/dev/null || :
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    peer_group_alive || break
    sleep 1
  done
  ! peer_group_alive
}

peer_finish_group() {
  if wait "$peer_wait_pid"; then
    peer_wait_status=0
  else
    peer_wait_status=$?
  fi
  if peer_group_alive; then
    peer_stop_group || return 1
  fi
  ! peer_group_alive
}
```

On timeout, call that entry's `peer_stop_group`; on observed supervisor completion, call its `peer_finish_group` and interpret the saved `peer_wait_status` only after it succeeds. The final command on either path must succeed. `peer_stop_group` always performs TERM → bounded wait → KILL when needed → supervisor `wait` → bounded death check, and failure means that entry still has a group member: do not retry or advance it until the member is gone. Apply this verification independently on every completion path for every entry, not only timeouts. Keep each entry's `outfile` reserved for parseable JSON and use its `errfile` only for diagnostics and the retained failure reason. Retry a timeout or transient failure once with an entirely new invocation directory, prompt, outfile, errfile, artifact, session file, and process group, then forfeit that entry's opinion for the round. An auth/usage failure on a classify-at-first-invocation attempt makes the peer unavailable for all later entries and rounds. `claude -p` may emit nothing until completion; wait for both the Reviewer and peer before deciding this entry's outcome.

Parse each peer's captured JSON only far enough to extract its final message, then read only both verdict lines for orchestration. Unintelligible peer output is a non-blocking forfeit. A round clears the review gate when the Reviewer passes and the peer either reports no unaddressed grounded findings or has an explicit forfeited, unavailable, or disabled outcome; both `blocking` and `minor` grounded peer findings gate. Only when the Reviewer passed and the peer alone would gate, cheaply spot-check each gate-deciding `file:line` and claim; discard nonexistent or self-evidently false references and note the discard. Do not summarize, merge, or rewrite either result.

### Fix-up rounds

For each failed entry, spawn a fresh `worker` fix-up agent with that PR's packet and the complete outputs verbatim as separate `Reviewer findings` and `Peer (claude) findings` blocks, omitting only a forfeited peer block.
It works only in that worktree, addresses each finding directly, runs validation, commits everything, leaves a clean worktree, and returns an updated packet.
Wait for and close the worker, then spawn a fresh `explorer` Reviewer and peer round; the next Reviewer adjudicates any evidence-backed push-back on a peer claim.
Allow at most 6 reviewer rounds total, counting every fix-up regardless of which reviewer triggered it; an entry still failing after round 6 is blocked and must not publish, and both outstanding finding sets are surfaced verbatim.

### Publication

Unless the run is `no-push` (local-only), spawn a fresh `worker` publisher only for an entry whose Reviewer passed and whose peer returned no grounded findings, forfeited/unavailable, or was disabled; pass its final packet, Reviewer Pass, and explicit peer outcome.
Tell it to invoke `$address-review #N hands-off publish-reviewed <resolved push/ping tokens>` — pass the run's resolved push/ping set (a bare default batch resolves to `ping-contributing`; a `no-push` batch skips publication entirely).
It edits no code and returns the full final report, including per-thread dispositions, push/ping outcome, and blockers.

Do **not** give any subagent another PR's context — strict per-PR isolation.

## Adaptive throttling (finish over fan-out)

Inherit `address-tasks` → "Adaptive throttling" in full (storage headroom before each fan-out, `ENOSPC` back-off, serialize shared-exclusive-resource phases, fan out less on `429`/`529`).

Effective subagent concurrency remains the number of PRs in the current phase, while each review entry also starts one peer CLI process.
Still start with a modest number of PRs in flight (for example 2–3), widen only when storage and provider limits are comfortable, and serialize shared build/database resources.
Because concurrent entries each invoke the peer, repeated peer-side rate, transient usage, or capacity failures are a signal to reduce the next fan-out (and retry each affected invocation at most once), just like provider `429`/`529` pressure; a definitive auth/usage exhaustion may mark the peer unavailable without blocking own-harness review.
Record whenever you ran narrower than the batch size and why.

## Cleanup

- Remove each worktree once a PR's subagents have returned cleanly and its work is committed — but check first: `git -C "$WT_BASE/<slug>" status --porcelain` must print nothing and no rebase/merge may be in progress (no `rebase-merge`, `rebase-apply`, or `MERGE_HEAD` under its git dir); only then `git worktree remove "$WT_BASE/<slug>"`. **Never force-remove a worktree with uncommitted changes or an in-progress rebase/merge** — `git worktree remove --force` destroys that work; on dirt, leave the worktree in place and report its path instead of deleting evidence or work. If a `wt-remove` helper is on PATH, prefer it — it enforces these refusal checks itself (even with `--force`). The branch and commits persist in shared `.git`; on push runs, the publisher's report must state whether publication succeeded or why it did not.
- **Never delete the branch** — it is the PR's head. (This is the opposite of nothing-to-lose task branches: deleting it would orphan the PR.)
- **Restore the main checkout** after every entry using its starting branch is complete, including failure paths: switch back to the recorded starting branch, or `git switch --detach <starting-sha>` if the session began detached. Do not restore the branch between serial same-head entries or it will occupy the ref again. A restored branch points at its addressed local tip. Note the restore in the summary.
- After removing worktrees, run `git worktree prune` to clear any stale registrations left under `.git/worktrees`; it is also the fix for a stale registration blocking a re-attach mid-session.

## After the batch

The PR branches are now independently fixed and almost certainly form a **leafy stack** (diverged tips, possibly shared ancestors).
This skill intentionally stops here.
If the user wants them integrated into a linear, mergeable order, point them at **`rebase-stack`** (explicit-chain form for independent branches) or a manual rebase — that is the deliberate, separate follow-up step, not something to fold into this parallel run.

## Final summary

Aggregate the per-PR `address-review` reports into one batch summary:

- **Per entry:** its PR URL, the branch, **which ref was worked** (your local ref — and how far it diverged from `origin` — vs. the `origin` head), reviewer rounds, whether it was pushed, and whether any requested ping was posted or skipped as a no-op, plus a one-line outcome (`fixed & pushed`, `fixed, not pushed`, `skipped — <reason>`, `blocked — <reason>`). Call out divergence explicitly: it tells the user a push rewrote `origin` to their local state.
- **Hands-off blockers, surfaced prominently** — every item any subagent skipped for lack of an authoritative decision, gathered across all PRs so the user can act on them in one place. This is the main value of an unattended batch: nothing silently dropped.
- **Push-backs** made across the batch, with their rationale.
- **No-push runs:** include each PR's per-thread disposition map (from its `address-review` report) so a later "push now" pass can replay replies/resolves precisely.
- **Throttling:** note whenever you ran narrower than the batch size, and why (storage-bound, rate-limited, resource-serialized).
- **Peer opinion:** note participation and grounded/discarded findings per affected entry; report a disabled/unavailable/round-forfeited peer once with its reason rather than repeating the same failure for every PR.
- **A leafy-stack note** pointing at `rebase-stack` if the user will want to integrate the branches.

## Checklist

- [ ] Session Bootstrap ran: worktree base prepared, stale worktree registrations pruned, GitHub/remote access confirmed, one-time peer preflight completed unless disabled, `git fetch origin` done.
- [ ] Batch parsed into entries (each classified PR-number vs branch-name); pass-through flag set captured (the default — no push/ping argument — resolves to publish + `ping-contributing`; `no-push` makes the whole batch local-only); `hands-off` force-injected into every `address-review` invocation and equivalent unattended guidance given to reviewers/fix-ups; aliases for one PR de-duplicated and same-head PRs serialized.
- [ ] Each entry resolved to a `(branch, PR#)` pair and checked out on the right ref — **branch entries use the local ref, never `origin`**; PR-number entries prefer a same-named local branch, else `origin` head; worktrees under the chosen base dir; un-setup-able / PR-less entries skipped-and-recorded.
- [ ] Per-PR phases ran in order: `$address-review ... delegated-fix`, fresh `explorer` Reviewer plus concurrent best-effort peer, fresh `worker` fix-up/re-review as needed (6 reviewer rounds max), then `$address-review ... publish-reviewed` only after the Reviewer passed and the peer had no grounded findings or was explicitly forfeited, unavailable, or disabled unless the run is `no-push`; distinct heads fanned out concurrently but throttled; same-head entries serialized.
- [ ] No new PR head lineage created, no `gh pr create`, no restack performed.
- [ ] Clean worktrees removed after each subagent returns; dirty/in-progress worktrees preserved and reported; **no PR branch deleted**; main checkout restored to its starting checkout mode after any temporary detach.
- [ ] Batch summary aggregates outcomes, hands-off blockers (prominently), push-backs, peer outcomes/forfeits, no-push disposition maps, throttling notes, and the `rebase-stack` follow-up pointer.
