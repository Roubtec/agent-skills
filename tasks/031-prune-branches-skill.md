# 031 — New skill: prune-branches (post-batch local workspace cleanup)

## Why this task exists

A fan-out implementation batch (`address-tasks`, `address-reviews`, `rebase-stack`) leaves the local checkout littered with task feature branches, rebase-stack disposable snapshots, and ad-hoc combination branches created to test stacked or interdependent work together. After the batch is merged, pruning this noise is a repetitive manual chore: figure out which branches are safely merged, which are transient scaffolding, which still hold unique work, then delete the safe ones without losing anything. We want a skill that automates the listing, classification, and confirmed local deletion — erring on the side of caution and leaving recovery breadcrumbs — so the workspace returns to a clean state in one prompt.

## Scope

Create a new skill `prune-branches` in both flavors, following the structure of the existing skills:

- `plugins/dev-skills/skills/prune-branches/SKILL.md` (Claude Code plugin flavor)
- `codex/dev-skills/skills/prune-branches/SKILL.md` + `codex/dev-skills/skills/prune-branches/agents/openai.yaml` (Codex flavor)

Update the README's `dev-skills` summary sentence to include the new workflow area if it enumerates the skill domains.

### Core behavior

1. **Inventory.** List all local branches with tip SHA, upstream state, and the worktree (if any) each is checked out in. Detect the default branch by ref, never by name — and never trust a cached `origin/HEAD` as it stands. `refs/remotes/origin/HEAD` survives a default-branch rename on the remote and `git fetch --prune` does **not** update it, so a present-but-stale symbolic ref names a branch that is no longer default and silently leaves the real default eligible for classification and deletion. **Refresh before reading:** run `git remote set-head origin --auto` (which re-reads the remote's symbolic HEAD advertisement) and only then resolve `origin/HEAD`; if the refresh cannot run or does not produce a ref (offline, no remote, no advertisement), fall back to `gh repo view --json defaultBranchRef`, which is authoritative over any unrefreshed `origin/HEAD`. If none of those resolves, **stop and refuse to delete anything** — report that the default branch could not be identified and what to run to fix it. Do NOT fall back to common-name heuristics: guessing `main`/`master` in a repo whose real default is something else (`develop`, `trunk`) leaves the actual default branch eligible for classification and deletion, violating the absolute safety rule below. The default branch is never a deletion candidate, and neither is the currently checked-out branch of any worktree until that worktree is handled.
2. **Refresh.** `git fetch --prune` up front so classification runs against origin's true tip and stale remote-tracking refs disappear as part of the same cleanup. Then pull the default branch to its latest state by default; the `no-pull` argument suppresses the pull (the fetch stays, it is read-only).
3. **Classify with minimal effort.** Three buckets:
   - **Merged:** either the branch tip is an ancestor of the default branch (the normal case — our repos merge with provenance intact), or a merged PR is identified for the branch **and that PR's `headRefOid` equals the current local tip**. Two paths identify the PR: a read-only `gh pr list --state merged --head <branch>` lookup, or — best effort for squash-merge repos, where ancestry never holds — the default branch's recent commit subjects referencing the branch's PR. **The head-OID match gates both**, not just the first: a branch is only Merged if its tip is exactly what was merged. A head-name lookup or a subject scan alone still identifies the historical merged PR when the local branch has gained commits since that PR merged, or when the branch name was reused for new work, and would classify genuinely unique commits as Merged — the one bucket that gets deleted without a backup ref. Whenever the identified PR's head OID does not match the tip — or no OID can be obtained for it — the branch is **Uncertain**, not Merged. No patch-id forensics, no deep computation; squash-merge repos simply get less coverage and that is acceptable.
   - **Transient:** helper scaffolding whose content is fully recoverable from kept refs — e.g. a local combination/test branch whose tip is a merge commit all of whose parents are kept or merged branches, a disposable rebase-stack snapshot, or a branch whose tip is reachable from another kept local branch.
   - **Uncertain:** everything else (unique unpushed commits, unclear provenance). These are only ever offered to the user with a one-line reason each; the skill never auto-deletes them and never burns effort proving hypotheticals about them.
4. **Confirm.** Present one listing (bucket, branch, tip, reason) in the style of rebase-stack's confirmation listing. The Codex flavor waits for a typed `go` (or a list of branches to keep/skip); the Claude flavor asks via its native question mechanism. User guidance given at invocation time ("keep xyz, I have work stashed there") must be honored as keeps before the listing is shown.
5. **Reserve recovery refs first.** Before any deletion, create the backup ref (e.g. `refs/pruned/<date>/<branch>`) for every confirmed branch that is not in the Merged bucket, and verify each ref resolves to the expected tip. A branch whose backup ref could not be created or verified is dropped from the deletion set and reported. This ordering is the point: creating the breadcrumb after `git branch -D` means an interruption or a failed ref write between the two steps leaves the commits dangling with no advertised way back, which is exactly the guarantee the skill sells.
6. **Delete locally.** `git branch -D` the confirmed set, only after step 5 has reserved its refs. For a branch checked out in a linked worktree, remove the worktree first — via `wt-remove` where available (its refusal to discard uncommitted work is exactly the safety we want), else `git worktree remove` without `--force`; if removal refuses because the tree is dirty, the branch moves to Uncertain and is reported, not forced.
7. **Report breadcrumbs.** Print the deleted tip SHA for every branch — for non-Merged deletions this SHA is already preserved by step 5's ref — and tell the user how to restore (`git branch <name> <sha>`) and how to drop the backups later. Mention that unreferenced commits remain recoverable until garbage collection.

### Arguments

- `no-pull` — keep the default branch where it is (fetch still runs).
- `hands-off` — skip the confirmation and perform a best-effort no-work-lost purge start to finish: delete only Merged and Transient branches, create backup refs for all Transient deletions, and report the Uncertain bucket untouched at the end.
- Free-form guidance (branch names to keep, extra context) — parsed leniently like rebase-stack's arguments, with the confirmation listing as the safety net.

### Hard safety rules

- Never mutate origin: no pushes, no remote branch deletion, no PR operations. Remote access is read-only (`git fetch`, `gh` read queries) plus the optional default-branch pull.
- Never delete the default branch, the current branch, or any user-designated keep.
- Never use `git worktree remove --force` or otherwise discard uncommitted work; when in doubt a branch stays.
- Works outside the powbox container too: `wt-remove` and `$CONTAINER_NAME` paths are opportunistic, with plain-git fallbacks.

## Context and references

- `plugins/dev-skills/skills/rebase-stack/SKILL.md` — precedent for the confirmation listing, lenient argument parsing, typed `go`, and the safety-rules tone; mirror its structure and flavor divergence.
- `codex/dev-skills/skills/rebase-stack/agents/openai.yaml` — Codex flavor metadata to mirror.
- powbox `wt-remove` helper (documented in the container CLAUDE.md) — never-lose-work worktree removal; the skill should prefer it when present on PATH.
- `README.md` — flavor layout and marketplace packaging; new skill directories are picked up by the existing plugin manifest without per-skill registration.

## Target files or areas

- `plugins/dev-skills/skills/prune-branches/SKILL.md` (new)
- `codex/dev-skills/skills/prune-branches/SKILL.md` (new)
- `codex/dev-skills/skills/prune-branches/agents/openai.yaml` (new)
- `README.md` (only if it enumerates skills/domains)

## Implementation notes

- The skill description/frontmatter must trigger on "prune branches", "clean up my branches/workspace", "delete merged branches", and must NOT trigger for remote branch cleanup, `rebase-stack` work, or worktree enablement.
- Classification is intentionally cheap: ancestry checks (`git merge-base --is-ancestor`), one `gh` read per otherwise-unclassified branch with an upstream, one `git log --oneline` scan of the default branch for PR-number references. Cap and batch the `gh` calls; degrade gracefully to local-only classification when offline or unauthenticated, moving affected branches to Uncertain rather than guessing.
- A branch whose upstream is gone (`[gone]` after the prune) is a strong Merged/Transient signal but not sufficient alone — combine with ancestry or PR state before putting it in Merged.
- In `hands-off` mode the listing is still printed for auditability before acting, mirroring rebase-stack's delegated unattended mode.
- Detached-HEAD and dirty-working-tree states in the main checkout must be handled: report and continue with what is safe (a dirty main checkout blocks only the pull, not branch deletion elsewhere).
- Keep the two flavors' shared text aligned, diverging only where the harnesses differ (confirmation mechanism, invocation syntax), as the existing skills do.

## Acceptance criteria

- Both flavors exist, follow the repo's SKILL.md conventions, and describe identical classification/safety semantics.
- The default branch is pulled by default, not pulled with `no-pull`, and never deleted under any name.
- The default branch is resolved from a **refreshed** remote HEAD advertisement (or the API), never from a cached `origin/HEAD` taken at face value; when it cannot be resolved the skill refuses to delete rather than falling back to a name guess.
- Merged and Transient buckets are defined exactly as scoped above; Uncertain branches are never deleted without explicit per-run user confirmation, including in `hands-off` mode.
- Every non-ancestry Merged path — head-name PR lookup and squash-merge subject scan alike — requires the identified PR's head OID to equal the branch tip; a branch that advanced past its merged PR, or reused a merged PR's name, lands in Uncertain.
- Every deletion path prints tip SHAs; non-Merged deletions get backup refs with documented restore instructions, and every such ref is created and verified **before** its branch is deleted.
- No instruction in either flavor can cause a remote mutation or a forced removal of uncommitted work.
- Worktree-checked-out branches are handled via worktree removal with no-work-lost semantics, with `wt-remove` preferred when available.

## Validation

- Dry-run the skill text against a scratch repo seeded with: a merged-by-ancestry branch, a squash-merged branch (PR-lookup path), a branch that gained commits after its PR merged, a branch reusing a merged PR's name for new work, a combination-merge test branch, a branch with unique commits, a branch checked out in a dirty worktree, and a `[gone]`-upstream branch — verify each lands in the intended bucket (the two post-merge-divergence cases must land in Uncertain, not Merged) and the confirmation/hands-off flows behave as specced.
- Dry-run a repo whose default branch is neither `main` nor `master` and whose `origin/HEAD` is unset: the skill must refuse to delete rather than heuristically selecting a branch. Dry-run the stale variant too — `origin/HEAD` still pointing at a branch the remote has since replaced as default: the refresh must correct it, and the branch that is *actually* default must never enter a deletion bucket.
- Verify the Claude flavor loads as a plugin skill (frontmatter parses, name/namespace correct) and the Codex flavor mirrors rebase-stack's file layout.

## Review plan

Reviewer checks the safety rules are stated as absolutes (no remote mutation, no forced worktree removal, default/current/keep branches untouchable), that the default branch is identified authoritatively or deletion is refused, that `hands-off` cannot reach the Uncertain bucket, that no branch is deleted before its recovery ref exists and verifies, that recovery-ref instructions are complete enough to salvage a mistaken deletion, and that classification stays within the "minimal effort" budget rather than accreting squash-merge forensics.
