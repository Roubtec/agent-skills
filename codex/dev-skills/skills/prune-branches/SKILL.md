---
name: prune-branches
description: "Safely classify and prune local Git branches after merged task batches while preserving uncertain or recoverable work with backup refs. Trigger when the user asks to prune branches, clean up local branches or the workspace, delete merged branches, or remove post-batch branch scaffolding. Do not trigger for remote branch cleanup, deleting branches on origin, rebase-stack work, or enabling worktrees."
---

# Prune Branches

Clean up local post-batch branches conservatively, without mutating the remote or losing work.

**Arguments:** `[no-pull] [hands-off] [free-form keep/delete guidance]`

## Invocation and arguments

Explicit Codex invocation uses `$prune-branches`; natural-language equivalents are fine.

Parse arguments leniently and let the inventory listing be the safety net:

- `no-pull` skips the local-default update entirely: an existing local default stays at its current tip, and an absent one is not created. The initial `git fetch --prune` and the targeted refresh of the remote default ref still run, so classification still compares against origin's current default.
- `hands-off` prints the listing and then performs a best-effort purge without waiting: delete only Merged and Transient branches, reserve recovery refs for every Transient deletion, and leave every Uncertain branch untouched.
- Treat all other text as guidance, especially branch names to keep and context such as "there is stashed work on X." Resolve and apply keeps before classification and before showing the listing.
- In an interactive run, plain `go` confirms only the proposed Merged and Transient set. Deleting an Uncertain branch requires the user to name that branch explicitly during this run; invocation-time instructions such as `delete old-spike even if uncertain` count only when they are unambiguous.

## Absolute safety rules

- Never push, delete a remote branch, edit a PR, or otherwise mutate `origin`. Allowed remote access is read-only: `git fetch`, `git remote set-head origin --auto`, read-only `gh` queries, and the optional fast-forward-only pull of the local default branch. `set-head` changes only the local symbolic ref.
- Never delete any branch unless the initial `git fetch --prune origin` succeeded in this run.
- Never delete the default branch under any name, the branch checked out in the invoking worktree, or a user-designated keep.
- Never accept cached `origin/HEAD` without a successful refresh of the remote's HEAD advertisement in this run.
- Never classify against a default tip that was not explicitly refreshed in this run. A successful `git fetch --prune origin` does not prove the default was refreshed, because a restricted fetch refspec can omit it.
- Never guess the default branch from names such as `main` or `master`. If authoritative resolution fails, delete nothing.
- Never let `GH_HOST`, `GH_REPO`, or the current checkout choose the repository for GitHub metadata. Resolve a canonical `HOST/OWNER/REPO` selector once from `origin`'s exact fetch URL and explicitly target it in every later default-branch or PR query. If that full identity cannot be resolved, make no PR-derived Merged classification; if it is also needed to resolve the default branch, delete nothing.
- Never classify a non-ancestry branch as Merged unless a merged PR based on the resolved default branch has a `headRefOid` that exactly equals the branch's current full tip OID.
- Never delete an Uncertain branch in `hands-off` mode or merely because the user typed `go`.
- Never delete a non-Merged branch until an unused recovery-ref name has been claimed atomically and verified at its exact tip.
- Never use `git worktree remove --force`, force helper cleanup, auto-stash, reset, clean, or any operation that can discard tracked modifications or non-ignored untracked files. If a worktree cannot be removed cleanly, keep its branch. Ignored untracked files are the one deliberate exception, defined in step 9.
- Never remove the invoking/main worktree. Remove another linked worktree only when this run created it, the user approved its exact annotated canonical path and branch, or it is a confirmed Merged/Transient branch proven to belong to this container's exact helper root and is removed through `wt-remove` as defined in step 9. A clean or helper-looking path outside that exact current-container root, `hands-off`, and general confirmation are not ownership proof.
- Never treat a `[gone]` upstream, a branch name, or a merge-looking commit subject as sufficient proof by itself.
- Never interpolate a branch name, ref, or path into a command unquoted. Git accepts names containing shell metacharacters such as `topic;echo_PWN` or `topic$(echo_PWN)`, so pass every dynamic value as a separate argv element or shell-quote it — in commands you run and in commands you print for the user. `--` stops Git's own option parsing and does nothing about shell expansion. Double quotes suffice around a variable expansion; a literal name substituted into a printed command needs single quotes, because double quotes still expand `$(...)` and backticks.
- Preserve the invoking checkout's branch or detached-HEAD state and all dirty state. Use `git -C "<path>"` and temporary linked worktrees rather than switching the invoking checkout.

## Procedure

### Step 1 — Parse guidance and capture local state

1. Record the invoking worktree's canonical path, current symbolic branch if any, HEAD OID, and `git status --porcelain=v1 --untracked-files=all` output. Detached HEAD is allowed; it means there is no current branch to protect in that worktree. Dirty state is also allowed and must remain untouched.
2. Parse `no-pull`, `hands-off`, explicit keeps, and any explicit requests to delete named branches. A vague cleanup request is not authorization to delete Uncertain branches.
3. Verify this is a Git repository and that an `origin` remote exists. If not, report the failure and delete nothing because the default branch cannot be resolved authoritatively.

Do not classify branches, inspect cached `origin/HEAD`, query PRs, or otherwise contact the remote before step 2's fetch.

### Step 2 — Refresh before resolving anything remote-derived

Run `git fetch --prune origin` as the run's first remote action. If it fails, report the failure and stop without resolving the default, classifying branches, or deleting anything. Never continue from existing remote-tracking refs after a failed fetch.

This both refreshes remote-tracking tips and removes stale ones. It must precede default-branch resolution because `git remote set-head origin --auto` can update `refs/remotes/origin/HEAD` only when the newly advertised default already has a local remote-tracking ref.

Do not perform a separate remote query first, even to discover the default branch. Do not classify against pre-fetch upstream state.

### Step 3 — Resolve the default branch authoritatively

After the mandatory fetch, read the exact fetch URL with `origin_url="$(git remote get-url origin)"`. Accept only an origin whose host can be extracted unambiguously from an HTTPS URL such as `https://HOST/OWNER/REPO.git` or an SSH-style URL such as `git@HOST:OWNER/REPO.git` or `ssh://git@HOST/OWNER/REPO.git`; unsupported or ambiguous URL forms fail identity resolution. Query that explicit URL once with `gh repo view "$origin_url" --json nameWithOwner,url`, require a non-empty canonical `OWNER/REPO`, and require the returned repository URL's host to equal the origin URL's host (compare host names case-insensitively). Construct `origin_selector="HOST/OWNER/REPO"` from that verified host and canonical name, and validate that it has exactly the `HOST/OWNER/REPO` form (the fully qualified case of `gh --repo`'s `[HOST/]OWNER/REPO` syntax). Keep this full selector for every later GitHub default-branch and PR lookup; never drop its host, re-resolve a query from `GH_HOST`, `GH_REPO`, or the current directory, or use an unqualified CLI default. Failure to resolve `origin_selector` disables all PR metadata lookups. It does not invalidate a successfully refreshed `origin/HEAD`, but if the default-branch fallback below is needed, stop without deleting.

Resolve the default branch by this exact order:

1. Run `git remote set-head origin --auto` and capture its exit status. This re-reads the remote's symbolic HEAD advertisement and writes only the local `refs/remotes/origin/HEAD` symbolic ref.
2. Only when `set-head` exited zero, read `git symbolic-ref --quiet refs/remotes/origin/HEAD`, require a target below `refs/remotes/origin/`, and verify that target resolves. Derive the default branch name from that target.
3. If `set-head` failed, could not run, or produced an invalid target, completely ignore any existing `origin/HEAD`, even if it still resolves. Query `gh repo view "$origin_selector" --json defaultBranchRef --jq '.defaultBranchRef.name'`. If `origin_selector` was not resolved or the query fails, the fallback failed. Validate a returned branch name with `git check-ref-format --branch` and use it as the authoritative protected name.
4. However the name was resolved, refresh that exact branch before it is used for anything: make one targeted fetch, `git fetch origin "+refs/heads/$default_name:refs/remotes/origin/$default_name"`, after the required initial fetch. The leading `+` is required. A default that dropped commits moved non-fast-forward, so an unforced refspec is rejected in exactly the case this refresh exists to catch; forcing rewrites only the local remote-tracking ref and still mutates nothing on origin. Never skip this fetch because the initial fetch succeeded or because a remote-tracking ref already resolves. If it fails, stop without deleting — a stale `refs/remotes/origin/<default-name>` that still resolves is not a permitted fallback, because an unrefreshed tip is exactly what must not be classified against.
5. If neither the refreshed advertisement nor the API resolves a default, stop and delete nothing. Report the failed commands and suggest checking connectivity/authentication, then running `git fetch --prune origin && git remote set-head origin --auto`.

A non-zero `set-head` is a hard boundary: never fall back to the cached symbolic ref. This covers the dangerous case where `origin/HEAD` still points to an old default while a restricted fetch refspec omitted the newly advertised default, causing `set-head --auto` to fail with `Not a valid ref` and leave the stale ref intact.

The targeted refresh closes the mirror image of that hazard. When a restricted refspec omits the default but a stale `refs/remotes/origin/<default-name>` already exists, both the initial fetch and `set-head --auto` succeed, because the newly advertised default does have a local remote-tracking ref — merely an outdated one. The name is then correct while the tip is stale, so a branch whose commits a force-moved remote default has dropped still looks like an ancestor of it and would be deleted as Merged without a recovery ref. Only an explicit fetch of the resolved default proves the tip is current.

Protect any local branch whose full ref is `refs/heads/<default-name>`. The resolved default is never a deletion candidate, whether its name is `main`, `master`, `develop`, `trunk`, or anything else.

### Step 4 — Update the local default unless `no-pull`

Unless `no-pull` was supplied, update the local default with a fast-forward-only pull while preserving the invoking checkout:

- If the default branch is checked out in a clean worktree, run `git -C "$worktree_path" pull --ff-only origin "refs/heads/$default_name"`.
- If it is checked out in a dirty worktree, report that dirty state blocks only the pull; do not stash, reset, or clean it.
- If it is not checked out and a local default branch exists, create a safely allocated temporary linked worktree for that branch, run `git -C "$temporary_path" pull --ff-only origin "refs/heads/$default_name"`, then remove the clean temporary worktree without `--force`.
- If only `origin/<default>` exists, create the local tracking branch in the temporary worktree from the freshly fetched `refs/remotes/origin/<default-name>`, run the same origin-and-ref-pinned pull, and retain the local default branch as a protected ref.
- If the pull, temporary-worktree creation, or cleanup fails, report it and continue; Merged classification is unaffected, because the comparison OID below comes from the freshly fetched remote default ref rather than from the local branch. A local default lagging behind origin's, or never created because the temporary worktree failed in the case above, can still cost a branch a Transient proof that rests on it; a branch left with no surviving proof at all is Uncertain and therefore kept. Never rewrite a divergent local default and never let a failed update make the protected default eligible.

With `no-pull`, the whole local-default update above is skipped, not merely the `pull` command: an existing local default stays at its current tip, and an absent one is not created. State that, and state that the comparison still uses origin's freshly fetched default tip. The initial fetch and step 3's targeted refresh both remain mandatory.

Capture the exact full default comparison OID from the `refs/remotes/origin/<default-name>` that step 3's targeted fetch refreshed, never from the local default branch, so classification reflects origin's current default whether or not the pull ran. Require that the refresh succeeded, not merely that the ref resolves: a stale ref resolves perfectly well, and using it is the failure this comparison exists to prevent. If the refresh did not succeed, or the refreshed ref does not resolve to a commit, stop without deleting.

### Step 5 — Inventory local branches and worktrees

Build one stable snapshot before classification:

- List every `refs/heads/*` ref with full tip OID, short tip OID, upstream ref, and upstream tracking state using `git for-each-ref`.
- Parse `git worktree list --porcelain` and map each checked-out `branch refs/heads/<name>` to its canonical worktree path. Record detached worktrees separately.
- Derive the canonical shared repository root from Git's absolute common directory. When `$CONTAINER_NAME` is a non-empty single path component, derive this repo's exact canonical helper root as `<shared-repo-root>/.worktrees/$CONTAINER_NAME`; never substitute a similarly named root or another container/session component.
- Record whether each linked worktree was created by this run, is a direct `<helper-root>/<slug>` child attributable to that exact current-container root, or is otherwise pre-existing. Current-container attribution is usable only when `wt-remove` is available and the target passes step 9's clean and operation-state checks.
- Mark the invoking worktree's current branch, the default branch, and every user-designated keep as protected.
- Keep a branch checked out in another worktree eligible for classification only as annotated `worktree: <canonical-path>`; it cannot be deleted unless the exact annotated path and branch are explicitly approved, or it is a confirmed Merged/Transient branch in an attributable current-container helper worktree, and step 9 safely removes that worktree first.
- Never offer removal of the invoking/main checkout itself. Its current branch remains protected.

The post-fetch `[gone]` upstream state is useful evidence but never a bucket by itself.

### Step 6 — Classify with minimal effort

Use only the following cheap checks. Do not add patch-id analysis, tree-diff equivalence, reflog archaeology, or other squash-merge forensics.

Classify each non-protected branch into exactly one bucket, in this order.

#### Merged

A branch is Merged when either:

1. Its snapshotted tip is an ancestor of the exact default comparison OID: `git merge-base --is-ancestor "$tip" "$default_oid"` exits zero; or
2. A read-only lookup identifies a merged PR for this branch **whose base is the resolved default branch**, and that PR's non-empty full `headRefOid` equals the branch's snapshotted full tip OID byte-for-byte.

For branches not merged by ancestry, use these fixed best-effort budgets:

- Permit GitHub PR lookups only when Step 3 resolved `origin_selector`. Pass `--repo "$origin_selector"` to every `gh pr` command; the selector must still contain the verified origin host, so neither `GH_HOST`, `GH_REPO`, the current checkout, nor shared fork history can redirect the query.
- In stable refname order, inspect at most 20 otherwise-unclassified branches with an upstream, including `[gone]`. Make at most one `gh pr list --repo "$origin_selector" --state merged --head "$branch" --base "$default_name" --limit 10 --json number,headRefName,headRefOid,baseRefName,mergedAt` read per inspected branch; branches beyond the 20-lookup budget receive no head-name lookup.
- Scan at most the newest 200 default-branch subjects once with `git log -n 200 --format='%H%x09%s' "$default_oid"` for conventional PR-number references. Resolve metadata for at most 20 distinct referenced PR numbers, newest reference first, with at most one `gh pr view "$number" --repo "$origin_selector" --json number,state,headRefName,headRefOid,baseRefName,mergedAt` read per number, and require all of `state == MERGED`, the matching `headRefName`, `baseRefName == <default-name>`, and `headRefOid == <tip>`.
- Treat the subject scan only as a way to identify a PR. The subject, PR number, merged state, or head name never replaces the exact base-and-head-OID gate.
- If an identified historical PR has a missing OID or an OID different from the current tip, classify the branch as Uncertain immediately. Do not let another name-based signal or Transient heuristic override this. This is how a branch advanced after merge or a reused branch name remains safe.
- If `origin_selector` could not be resolved, `gh` is unavailable, unauthenticated, or offline, a branch or PR falls beyond these budgets, or a query returns incomplete data, retain ancestry-based Merged results and conservatively classify affected branches with the local Transient rules or as Uncertain. Never query another repository, expand the budgets, or guess.

A merged PR whose base is not the resolved default never establishes Merged, even on an exact head-OID match. Merged is the only bucket that deletes without a recovery ref, and that exemption rests on the work having been integrated into the default branch, which is not deleted in the ordinary course; a release or intermediate base carries no such expectation and may be removed once it has served its purpose, taking the integration with it. Neither is an absolute guarantee — a default branch can still be force-rewritten, which is why step 3 refreshes it rather than trusting a cached tip. The exemption is about the integration surviving rather than the branch's own commits surviving, since a squash or rebase merge integrates the work without preserving them either way. Such a branch falls through to the Transient and Uncertain rules, where it is either preserved by a recovery ref or kept untouched. `--base` filters the list lookup by base branch, so the same gate must be re-checked on the `gh pr view` path, which is not filtered.

#### Transient

A branch is Transient only when its snapshotted tip is fully recoverable from refs guaranteed to remain after this run and one cheap topology check proves one of these cases:

- The tip is reachable from a protected, explicitly kept, or other local branch already committed to the kept set. Establish that kept set before using it as proof; do not create circular proof where two branches slated for deletion are each other's only recovery source.
- The tip is a local combination/test merge commit and every parent is reachable from the protected local default branch or another ref guaranteed to remain. A parent preserved only by a squash-merged branch that will also be deleted is not enough.
- It is a recognizable disposable rebase-stack snapshot and its tip is reachable from a surviving `refs/pre-rebase/...`, protected branch, the protected local default branch, or other kept ref. A snapshot-like name alone is not enough.

"The default" means the protected local `refs/heads/<default-name>` here, not `refs/remotes/origin/<default-name>`. The remote-tracking ref is the classification yardstick, but a later fetch can move or rewind it — this skill force-updates it in step 3 — so it is not a ref guaranteed to remain.

This pin costs nothing for the two tip-reachability cases: a branch tip reachable from the freshly fetched remote default is already Merged by ancestry before these rules run. It does bite the merge-parent case, which tests parents rather than a classified branch tip. A parent may sit on origin's default while the local default lags behind it, or while no local default exists at all because `no-pull` or a failed temporary worktree skipped its creation. Such a parent cannot be proven through the local default. The merge-parent case still admits any other ref guaranteed to remain, and the other two Transient cases are untouched; only a branch left with no surviving proof at all is Uncertain, and therefore kept. Pulling or creating the local default restores this route on a later run.

Record the exact surviving ref(s) that prove recoverability in the one-line reason. A backup ref will still be created before deleting every Transient branch.

#### Uncertain

Everything else is Uncertain: unique or unpushed commits, unclear provenance, a `[gone]` upstream without ancestry/PR proof, incomplete remote evidence, PR head-OID mismatch or absence, or transient-looking content without a surviving recovery source.

Spend no extra effort proving hypotheticals. Give each Uncertain branch one concise reason and leave it untouched unless the user explicitly names it for deletion in this run.

### Step 7 — Present one audit listing and confirm

Print a single scannable listing with bucket, branch, full or unambiguous short tip, worktree annotation when applicable, proposed action, and one-line reason. Also list protected branches separately so the resolved default, current branch, and user keeps are visibly excluded.

Example:

```text
Local branch cleanup against origin's default `develop` at a03ab1f:

  Merged     task/012       9a2f1c0  delete  tip is ancestor of develop
  Transient  combine/test   4e8dd11  delete  merge parents survive at keep/a and develop
  Uncertain  old-spike      7711a2b  keep    3 unique commits; upstream is [gone]
  Protected  develop        a03ab1f  keep    authoritative default branch
  Protected  feature/live   c133bbe  keep    current branch in invoking worktree

Non-Merged deletions will first be preserved under unused refs/pruned/... names.
`go` deletes only the proposed Merged and Transient rows. Name any rows to keep/skip, or explicitly name an Uncertain branch to delete.
```

In normal interactive mode, wait for typed `go` or a branch list. Typed `go` covers proposed Merged/Transient rows in attributable current-container helper worktrees because step 9 removes those only through `wt-remove`; every unattributed/pre-existing worktree and every explicitly requested Uncertain deletion requires approval naming its exact annotated path and branch. Apply changes, re-display the updated listing, and require a final `go`. If the user explicitly requests deletion of an Uncertain branch, mark that row `explicitly confirmed`, include it in the updated listing, and require the final `go`; it receives a recovery ref.

In `hands-off` mode, print the same listing for auditability and proceed immediately with only Merged and Transient rows that are not checked out in a linked worktree or whose linked worktree is attributable to this container's exact helper root and removable through `wt-remove`. Invocation-time keeps still apply. Ignore any ambiguous delete guidance, never remove an unattributed worktree, and never include Uncertain rows.

### Step 8 — Revalidate tips and reserve recovery refs

Re-read every confirmed branch ref before any worktree removal or branch deletion. If a branch disappeared or its full tip OID differs from the inventory snapshot, drop it from the deletion set, move it to Uncertain with `tip changed during run`, and report it.

For every confirmed branch not in Merged, reserve a recovery ref before deleting any branch:

1. Start with `refs/pruned/<YYYYMMDD-UTC>/<branch>`, using one UTC date for the run.
2. Atomically claim the candidate only if it does not exist, using `git update-ref --stdin -z` with its `create SP <ref> NUL <tip> NUL` form. The `-z` form delimits the ref by NUL instead of parsing it under the newline format's C-quoting rules, so a branch name containing a quote needs no reasoning about escaping. Do not use a blind `git update-ref "<ref>" "<tip>"` write: that can repoint an earlier run's breadcrumb.
3. Try at most 10 hierarchical candidates: the base name, `refs/pruned/<date>/<branch>-<short-tip>`, then that short-tip form suffixed `-2` through `-9`. Existing refs are never overwritten or deleted.
4. When none of those 10 can be claimed, fall back to the flat namespace below, because the usual cause is a directory/file conflict rather than a taken name. Every hierarchical candidate sits under `refs/pruned/<date>/<branch>`, so one earlier breadcrumb whose branch name is a path prefix of this branch blocks the whole family at once: once a same-date run pruned `foo`, Git cannot create any child ref beneath the existing `refs/pruned/<date>/foo`, and that is exactly where the base name, the short-tip form, and every counter for `foo/bar` live. The mirror image needs no fallback: when `refs/pruned/<date>/foo/bar` already exists and this run prunes `foo`, only the base candidate is blocked and its `-<short-tip>` siblings remain creatable.
5. Claim up to 10 flat candidates under `refs/pruned/flat/<YYYYMMDD-UTC>/`, the same atomic way: `<encoded>`, `<encoded>-<short-tip>`, then that short-tip form suffixed `-2` through `-9`. `<encoded>` is the branch name percent-encoded into a single path component — `%` to `%25` first, then `/` to `%2F`. Two properties make this subtree conflict-free rather than merely less conflict-prone: `flat` sits where a date segment goes, and a date segment is always `YYYYMMDD`, so no branch-derived name can reach into it; and every name inside it is a leaf, so nothing there creates a directory for a later breadcrumb to collide with. Encoding `%` before `/` keeps the mapping reversible, so two branches never share a base flat name. A suffixed candidate can still coincide with another branch's — `foo/bar` at tip `abc1234` and a branch literally named `foo/bar-abc1234` both want `foo%2Fbar-abc1234` — but that is the ordinary taken-name case the counters already cover, exactly as in the hierarchical family. Being conflict-free is not the same as always succeeding: collapsing every segment into one name can exceed the filesystem's limit on a single component, so a branch that is both prefix-conflicted and very long in one piece can fail here too. That is a length failure rather than a collision, it needs no further naming scheme, and it lands on the drop-and-report rule below, which keeps the branch.
6. After a successful create, resolve the new ref as a commit and require its full OID to equal the expected snapshotted tip.
7. If no name can be claimed in either family, or verification fails, drop that branch from the deletion set and report it. Continue best-effort for other branches.

Finish and verify reservation for all non-Merged deletions before removing any worktree or deleting any branch. Record every exact branch, tip, and recovery ref tuple for the final report, including refs whose branches are later kept because a worktree removal or final tip check fails.

### Step 9 — Handle linked worktrees without losing work

For each still-confirmed branch checked out in a linked worktree:

1. Re-read that worktree's branch and status. If it is detached, on another branch, missing, dirty, locked for an unclear reason, or has an in-progress operation, do not force anything; drop the branch from deletion and report it as Uncertain.
2. Authorize removal only if this run created the worktree, the user explicitly approved its exact annotated canonical path and branch, or the still-confirmed branch is Merged/Transient and the worktree is attributable to this container under the next rule. `hands-off` reaches only the last category; an Uncertain or unattributed branch requires explicit path-and-branch approval.
3. Automatic current-container attribution requires every condition: `CONTAINER_NAME` is available and a safe single path component; the canonical target is exactly a direct `<shared-repo-root>/.worktrees/$CONTAINER_NAME/<slug>` child for this repository; `wt-remove` is on PATH; and the branch/status checks above are clean and operation-free. Invoke `wt-remove "$slug"` from outside the target worktree. Its refusal is authoritative. Never accept a worktree under another container/session root, and never fall back to plain Git on this automatic-attribution path.
4. For a run-created or explicitly path-and-branch-approved worktree, prefer `wt-remove "$slug"` when it matches the exact current-container helper root and the helper is available. Use `git worktree remove "$worktree_path"` without `--force` for a candidate linked worktree only after the user explicitly approves its exact path and branch; run-created provenance and cleanliness do not waive that requirement. This does not change the separately specified cleanup of a clean temporary worktree created solely for step 4's default-branch pull.
5. If removal refuses or the path is the invoking/main checkout, keep the branch. Never follow up with a forced removal.

Ignored untracked files — build artifacts, a local `.env`, generated output — do not count as dirty and do not block removal, even though `git worktree remove` deletes them without `--force`. `.gitignore` marks paths the repository deliberately does not track, typically build output and local scratch, and treating them as blocking would keep any worktree whose build left artifacts behind. An ignored path can still be genuinely irreplaceable — a populated `.env` is the obvious case — but that is handled by the ferry requirement rather than by refusing to remove the worktree: anything valuable belongs in a scratchpad path outside the worktree, a committed `.env.example`, or a returned report, rather than existing only inside a disposable worktree.

The skill must work outside powbox: `$CONTAINER_NAME`, `.worktrees`, `wt-bootstrap`, and `wt-remove` are opportunistic, never prerequisites.

### Step 10 — Delete locally with exact-tip checks

Immediately before each deletion, verify `refs/heads/<branch>` still equals the snapshotted tip. If it moved, keep it and report the race; retain and explicitly report any already-created recovery ref as a breadcrumb for a branch that was not deleted.

Delete only the remaining confirmed local branches with `git branch -D -- "$branch"`. Never run a remote-delete form and never push.

Record success or failure per branch. A failed deletion is non-fatal and must not lead to cleanup of its recovery ref.

### Step 11 — Report and restore orientation

Confirm that the invoking checkout still has its original branch or detached-HEAD orientation and untouched dirty-state entries. Do not attempt destructive restoration if another process changed it; report the difference instead. Remove only clean temporary worktrees created for the default-branch pull, without force; preserve and report any that cannot be removed safely.

Print:

- Fetch, default-resolution source, authoritative default name/OID, and pull or `no-pull` result.
- Every deleted branch with bucket and full tip SHA. Include the exact recovery ref for each Transient or explicitly confirmed Uncertain deletion.
- Every kept, skipped, changed, dirty-worktree, or failed branch with its reason.
- Every recovery ref created in this run, separated into refs for deleted branches and refs reserved for branches that remained, with the reason each latter branch was not deleted.
- Every linked or temporary worktree removed or preserved.
- A clear statement that no remote refs or PRs were mutated.

Shell-quote every substituted branch name, ref, and path in the printed commands below, so they stay safe to copy and paste whatever the branch was called. Use **single** quotes here, escaping any embedded single quote as `'\''`. These templates carry a literal name rather than a variable expansion, and double quotes still expand `$(...)` and backticks — so a branch named `topic$(echo_PWN)` pasted inside double quotes would execute rather than be named. Double quotes are sufficient only around a variable, as in the commands the skill runs itself.

For every deletion, show direct restoration from the reported SHA:

```sh
git branch '<branch>' <full-tip-sha>
```

For non-Merged deletions, also show how to inspect and restore through the exact backup ref:

```sh
git for-each-ref 'refs/pruned/<YYYYMMDD-UTC>/' 'refs/pruned/flat/<YYYYMMDD-UTC>/'
git branch '<branch>' '<exact-refs/pruned/...-ref>'
```

Show cleanup only for the exact recovery refs created in this run, preferably with expected-old OIDs so a changed breadcrumb is not removed accidentally:

```sh
git update-ref -d '<exact-recovery-ref>' <preserved-full-tip-sha>
```

Explain that refs keep commits advertised indefinitely until those refs are dropped. A deleted Merged branch has no automatic backup ref, but its printed SHA and reflogs or `git fsck --lost-found` may recover otherwise unreferenced commits until Git garbage collection removes them.

## Checklist

- [ ] Invocation guidance and keeps parsed before listing.
- [ ] `git fetch --prune origin` was the first remote action and succeeded before any classification or deletion.
- [ ] Origin's canonical `HOST/OWNER/REPO` selector was resolved once from its exact fetch URL before GitHub metadata use; every default/PR query explicitly targeted that full selector, or PR-derived classification was disabled and a needed default fallback stopped deletion.
- [ ] `set-head --auto` succeeded before `origin/HEAD` was trusted, or an API query explicitly scoped to the resolved origin repository supplied the default; no name heuristic was used.
- [ ] Default branch protected and pulled explicitly from `origin`'s resolved default ref unless `no-pull` or dirty/failed safely.
- [ ] The resolved default was refreshed by an explicit targeted fetch, and the comparison OID came from that freshly fetched remote ref rather than a local or cached tip.
- [ ] Inventory includes OIDs, upstream state, and worktree paths.
- [ ] Every non-ancestry Merged result has an exact merged-PR `headRefOid == tip` proof on a PR based on the resolved default.
- [ ] Transient proofs name refs that survive the run; Uncertain branches remain untouched unless explicitly named interactively.
- [ ] Audit listing printed; interactive confirmation or `hands-off` rules applied.
- [ ] All non-Merged recovery refs atomically claimed at unused names and verified before any removal/deletion.
- [ ] Tips rechecked; automatic cleanup covered only clean Merged/Transient worktrees attributed to this container's exact helper root and removed through `wt-remove`; every plain-Git candidate removal had exact path-and-branch approval.
- [ ] Only local branches deleted; every deleted tip and every created recovery breadcrumb, including refs for branches that remained, reported.
- [ ] Every dynamic branch, ref, and path was passed as argv or shell-quoted, in executed and printed commands alike, with literals in printed commands single-quoted.
- [ ] Invoking checkout orientation and dirty work preserved; remote remained untouched.
