---
name: prune-branches
description: "Safely classify and prune local Git branches after merged task batches while preserving uncertain or recoverable work with backup refs. Trigger when the user asks to prune branches, clean up local branches or the workspace, delete merged branches, or remove post-batch branch scaffolding. Do not trigger for remote branch cleanup, deleting branches on origin, rebase-stack work, or enabling worktrees."
---

# Prune Branches

Clean up local post-batch branches conservatively, without mutating the remote or losing work.

**Arguments:** `[no-pull] [hands-off] [free-form keep/delete guidance]`

## Invocation and arguments

Explicit Claude Code invocation uses `/dev-skills:prune-branches`; natural-language equivalents are fine.

Parse arguments leniently and let the inventory listing be the safety net:

- `no-pull` skips the local-default update entirely: an existing local default stays at its current tip, and an absent one is not created. The initial `git fetch --prune` and the targeted refresh of the remote default ref still run, so classification still compares against origin's current default.
- `hands-off` prints the listing and then performs a best-effort purge without waiting: delete only Merged and Transient branches, reserve recovery refs for every Transient deletion, and leave every Uncertain branch untouched. It sweeps no recovery breadcrumb from an earlier run either: those are inventoried and reported — with cleanup commands only for the ones that were otherwise eligible to be swept — and left in place.
- Treat all other text as guidance, especially branch names to keep and context such as "there is stashed work on X." Resolve and apply keeps before classification and before showing the listing.
- In an interactive run, selecting Proceed through `AskUserQuestion` confirms only the proposed Merged and Transient set plus the breadcrumb rows the listing marked `sweep`. Deleting an Uncertain branch requires the user to name that branch explicitly during this run; invocation-time instructions such as `delete old-spike even if uncertain` count only when they are unambiguous.

## Absolute safety rules

- Never push, delete a remote branch, edit a PR, or otherwise mutate `origin`. Allowed remote access is read-only: `git fetch`, `git remote set-head origin --auto`, read-only `gh` queries, and the optional fast-forward-only pull of the local default branch. `set-head` changes only the local symbolic ref.
- Never delete any branch unless the initial `git fetch --prune origin` succeeded in this run.
- Never delete the default branch under any name, the branch checked out in the invoking worktree, or a user-designated keep.
- Never accept cached `origin/HEAD` without a successful refresh of the remote's HEAD advertisement in this run.
- Never classify against a default tip that was not explicitly refreshed in this run. A successful `git fetch --prune origin` does not prove the default was refreshed, because a restricted fetch refspec can omit it.
- Never guess the default branch from names such as `main` or `master`. If authoritative resolution fails, delete nothing.
- Never let `GH_HOST`, `GH_REPO`, or the current checkout choose the repository for GitHub metadata. Resolve a canonical `HOST/OWNER/REPO` selector once from `origin`'s exact fetch URL and explicitly target it in every later default-branch or PR query. If that full identity cannot be resolved, make no PR-derived Merged classification; if it is also needed to resolve the default branch, delete nothing.
- Never classify a non-ancestry branch as Merged unless a merged PR based on the resolved default branch has a `headRefOid` that exactly equals the branch's current full tip OID.
- Never delete an Uncertain branch in `hands-off` mode or merely because the user selected Proceed.
- Never delete a non-Merged branch until an unused recovery-ref name has been claimed atomically and verified at its exact tip.
- Never delete a recovery breadcrumb under `refs/pruned/**` outside step 10's confirmed sweep, and never sweep one unless this run proposed it, a confirmation covered it, the inventory saw it as a direct ref rather than a symbolic one, the ref still held its inventoried OID when it was classified, that OID is reachable from the resolved default, its date segment clears the age threshold, and the deletion passes that same inventoried OID as the expected old value under `--no-deref`, so it can only ever remove the breadcrumb name itself and never whatever a symbolic ref planted at that name points at. Step 8's rule that reservation never overwrites or deletes a ref that holds anything still holds in full; it constrains the claim loop, which must never disturb a breadcrumb it happens to collide with, and says nothing about this separate, deliberate, confirmed removal of refs the run inventoried and reported first.
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

The targeted refresh closes the mirror image of that hazard: when a restricted refspec omits the default but a stale `refs/remotes/origin/<default-name>` already exists, both the initial fetch and `set-head --auto` succeed — the resolved name is correct while the tip is stale — and a branch whose commits a force-moved remote default has dropped would be deleted as Merged without a recovery ref. Only an explicit fetch of the resolved default proves the tip is current.

Protect any local branch whose full ref is `refs/heads/<default-name>`. The resolved default is never a deletion candidate, whether its name is `main`, `master`, `develop`, `trunk`, or anything else.

### Step 4 — Update the local default unless `no-pull`

Unless `no-pull` was supplied, update the local default with a fast-forward-only pull while preserving the invoking checkout:

- If the default branch is checked out in a clean worktree, run `git -C "$worktree_path" pull --ff-only origin "refs/heads/$default_name"`.
- If it is checked out in a dirty worktree, report that dirty state blocks only the pull; do not stash, reset, or clean it.
- If it is not checked out and a local default branch exists, create a safely allocated temporary linked worktree for that branch, run `git -C "$temporary_path" pull --ff-only origin "refs/heads/$default_name"`, then remove the clean temporary worktree without `--force`.
- If only `origin/<default>` exists, create the local tracking branch in the temporary worktree from the freshly fetched `refs/remotes/origin/<default-name>`, run the same origin-and-ref-pinned pull, and retain the local default branch as a protected ref.
- If the pull, temporary-worktree creation, or cleanup fails, report it and continue; Merged classification is unaffected (the comparison OID below comes from the freshly fetched remote default ref), though a lagging or absent local default can still cost a branch a Transient proof that rests on it — see the Transient rules. Never rewrite a divergent local default and never let a failed update make the protected default eligible.

With `no-pull`, the whole local-default update above is skipped, not merely the `pull` command — exactly as the argument table defines. State that, and state that classification still compares against origin's freshly fetched default tip; the initial fetch and step 3's targeted refresh both remain mandatory.

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

Inventory the recovery breadcrumbs earlier runs left behind as part of the same snapshot. They accumulate indefinitely, they are invisible to `git branch`, and every one of them keeps its commits advertised forever, so a skill whose purpose is to reduce carried scaffolding must account for them rather than only for branches. Taking the snapshot here, before step 8 reserves anything, also keeps this run's own breadcrumbs out of the inventory by construction.

- Read each layout with its own capped query: `git for-each-ref --count=201 --format='%(objectname) %(objecttype) %(if)%(symref)%(then)symref%(else)direct%(end) %(refname)' refs/pruned/flat/` for the flat fallback layout, and `git for-each-ref --count=201 --exclude=refs/pruned/flat/ --format='%(objectname) %(objecttype) %(if)%(symref)%(then)symref%(else)direct%(end) %(refname)' refs/pruned/` for the hierarchical one. Two queries rather than one because refname order sorts every `YYYYMMDD` date segment ahead of `flat`, so a single shared budget would let a crowded hierarchical family hide the flat family entirely.
- Exclude the flat subtree inside the hierarchical query rather than discarding its rows after the fact, because a discard has already spent the budget on them. Measured against 158 hierarchical and 304 flat breadcrumbs, the unexcluded query returns 201 rows of which 44 are flat, drops every hierarchical ref sorting after `flat` — `refs/pruned/notadate/foo` among them — and then reports the hierarchical layout as truncated while its listing sits far below the cap, which is a truncation message that contradicts what the user is looking at. `--exclude` needs Git 2.42 or newer, and the trailing slash matters: before Git 2.50 a pattern that is not a directory prefix also excludes refs that merely start with it. On older Git, fall back to the single unexcluded query and attribute any truncation to the whole `refs/pruned/` namespace rather than to one layout, so the report still says plainly that something went unseen.
- Put the OID first in that format and split each line on its first three spaces: object name, object type, symbolic-ref marker, then the refname, exactly, whatever the branch was called, because `git check-ref-format` admits neither spaces nor control characters. Write that third field as `%(if)%(symref)%(then)symref%(else)direct%(end)` rather than a bare `%(symref)` so it is never empty: a bare atom emits nothing at all for an ordinary breadcrumb, leaving two adjacent spaces that a whitespace-collapsing read silently mistakes for a present symref field, and the refname lands in the wrong column on exactly the rows that are fine. `%(symref)` has been available since Git 1.7.1 and the `%(if)`/`%(then)`/`%(else)`/`%(end)` form since Git 2.13, both far below the 2.42 `--exclude` floor, so the marker is also available on the older-Git fallback path above. Do not reach for a NUL-delimited format instead. `for-each-ref` has no `-z`, and it terminates every record with a newline of its own, so a format ending in `%00` emits `\0\n` between records rather than the clean NUL stream it looks like.
- The inventory budget is 200 breadcrumbs per layout, in the same spirit as step 6's lookup budgets. Asking for 201 is how truncation is detected: a query that returned more rows than its budget means that layout's listing is incomplete, and steps 7 and 11 must say so plainly, naming the layout and the cap, rather than letting a partial listing read as the whole picture. Because each query sees only its own layout, that signal names the layout that actually overflowed instead of blaming one for the other's crowding.
- Recover the date segment and the real branch name from the layout, never from the ref's shape alone. `refs/pruned/<YYYYMMDD-UTC>/<branch>` carries both directly, while `refs/pruned/flat/<YYYYMMDD-UTC>/<encoded>` puts the date one segment deeper and holds a percent-encoded name. Never present a flat breadcrumb under a date segment of `flat` or under its encoded name.
- What follows the date segment is not always the branch name. Step 8 disambiguates a claim that collided by appending `-<short-tip>`, and then `-2` through `-9` to that form, so a branch pruned twice on one date leaves a breadcrumb whose last component is not what it was called. Strip that suffix, and only that suffix, using the row's own inventoried OID as the evidence: a trailing `-<hex>` of at least four characters that is a prefix of that OID, optionally followed by `-` and one digit `2` through `9`. A bare trailing `-2` is not enough on its own — `refs/pruned/<date>/bar-2` is the plain breadcrumb of a branch called `bar-2`. Strip before decoding and on the encoded component, so one rule covers both layouts.
- The suffix is evidence, not proof: a branch can genuinely be called `foo-a9cb40e` and happen to have been pruned at a tip starting `a9cb40e`. Report such a row under both readings — `foo or foo-a9cb40e` — rather than asserting either. Nothing about the sweep turns on which is right, because reachability, the date segment, the exact ref, and the expected old OID decide that and the listing prints the ref itself; the name is what the user reads, so an unresolved one is worth showing as unresolved rather than guessed at.
- Decode `<encoded>` by undoing step 8's two substitutions in the opposite order: `%2F` to `/` first, then `%25` to `%`. That order is load-bearing — decoding `%25` first turns `a%252Fb`, the encoding of a branch literally named `a%2Fb`, into `a/b`.
- Treat any ref under `refs/pruned/` matching neither layout, whose date segment is not eight digits, whose `%(objecttype)` is not `commit`, or whose symbolic-ref marker reads `symref`, as unrecognized: report it and never propose it for removal. Read both the type and the marker from the inventory rather than inferring them from step 6's answers. A blob or tree does fall out of both of them, but an annotated tag sitting under an eight-digit date segment peels and comes back from `--merged` with `%(objectname)` equal to the tag's own OID — so "in neither answer" is not the test it looks like, and a breadcrumb-shaped tag would otherwise be swept on the strength of what it happens to point at. A symbolic ref is the sharpest form of that same problem and the reason the marker is inventoried at all: step 8 only ever creates direct refs, so a symref under `refs/pruned/` is never a breadcrumb this skill left, yet `%(objectname)` and `%(objecttype)` describe its *target* rather than the ref — a symref at `refs/pruned/20260120/decoy` pointing at `refs/heads/<default>` reports `commit` at the default's own tip, reads as a flawlessly formed redundant breadcrumb, and would classify as Redundant on commits it does not hold.

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

A merged PR whose base is not the resolved default never establishes Merged, even on an exact head-OID match. Merged is the only bucket that deletes without a recovery ref, and that exemption rests on the integration surviving in the default branch, which is not deleted in the ordinary course; a release or intermediate base carries no such expectation and may be removed once it has served its purpose, taking the integration with it. Such a branch falls through to the Transient and Uncertain rules, where it is either preserved by a recovery ref or kept untouched. `--base` filters the list lookup by base branch, so the same gate must be re-checked on the `gh pr view` path, which is not filtered.

#### Transient

A branch is Transient only when its snapshotted tip is fully recoverable from refs guaranteed to remain after this run and one cheap topology check proves one of these cases:

- The tip is reachable from a protected, explicitly kept, or other local branch already committed to the kept set. Establish that kept set before using it as proof; do not create circular proof where two branches slated for deletion are each other's only recovery source.
- The tip is a local combination/test merge commit and every parent is reachable from the protected local default branch or another ref guaranteed to remain. A parent preserved only by a squash-merged branch that will also be deleted is not enough.
- It is a recognizable disposable rebase-stack snapshot and its tip is reachable from a surviving `refs/pre-rebase/...`, protected branch, the protected local default branch, or other kept ref. A snapshot-like name alone is not enough.

"The default" means the protected local `refs/heads/<default-name>` here, not `refs/remotes/origin/<default-name>`. The remote-tracking ref is the classification yardstick, but a later fetch can move or rewind it — this skill force-updates it in step 3 — so it is not a ref guaranteed to remain.

This pin bites only the merge-parent case, which tests parents rather than a classified branch tip (a tip reachable from the freshly fetched remote default is already Merged by ancestry): a parent sitting on origin's default while the local default lags — or does not exist because `no-pull` or a failed temporary worktree skipped its creation — cannot be proven through the local default. Any other ref guaranteed to remain still serves as proof; a branch left with no surviving proof at all is Uncertain, and therefore kept. Pulling or creating the local default restores this route on a later run.

Record the exact surviving ref(s) that prove recoverability in the one-line reason. A backup ref will still be created before deleting every Transient branch.

#### Uncertain

Everything else is Uncertain: unique or unpushed commits, unclear provenance, a `[gone]` upstream without ancestry/PR proof, incomplete remote evidence, PR head-OID mismatch or absence, or transient-looking content without a surviving recovery source.

Spend no extra effort proving hypotheticals. Give each Uncertain branch one concise reason and leave it untouched unless the user explicitly names it for deletion in this run.

#### Pre-existing recovery breadcrumbs

Breadcrumbs from earlier runs are not branches and do not enter the buckets above. Sort each breadcrumb the inventory recognized by reachability from the same default comparison OID the branch buckets use — two queries per layout rather than a process per ref:

- **Redundant** — returned by `git for-each-ref --merged="$default_oid" <prefix>` at the OID step 5 inventoried. The work the breadcrumb preserves landed in the resolved default, so the ref now only keeps bytes advertised. `git merge-base --is-ancestor "$old_oid" "$default_oid"` is the per-ref equivalent when a single breadcrumb needs re-checking; pass the inventoried OID rather than the ref name, and read exit 1 as "not an ancestor" but exit 128 as a failed query rather than an answer.
- **Load-bearing** — returned by `git for-each-ref --no-merged="$default_oid" <prefix>` at the OID step 5 inventoried. Its commits are not reachable from the resolved default, so the breadcrumb may be the only ref keeping them alive; a surviving local branch could hold them too, but nothing checked here proves one does. Report it with that reason and never propose it for removal. Age is irrelevant here: an old load-bearing breadcrumb is precisely the one worth keeping.
- **Changed since inventory** — the OID the classification query reported differs from the inventoried one, or neither query returned the ref at all. Report it as changed and never sweep it. These queries read the live ref rather than the snapshot, so without that equality check a breadcrumb repointed onto a landed commit after the inventory is classified Redundant on commits it no longer holds — and if it is put back at its inventoried OID before step 10, the expected-old-OID deletion then passes and takes the unreachable commits with it.
- A Redundant breadcrumb becomes a sweep candidate only when its date segment is at least 7 days before the run's UTC date. Anything newer is reported as `too recent to sweep` and kept. The threshold protects a user still orienting after a recent prune, and it is deliberately generous because the costs are asymmetric: a stale ref costs bytes, while a breadcrumb swept out from under someone costs the recovery they were about to make.

Restrict the reachability queries to the same prefixes the inventory read, `--exclude=refs/pruned/flat/` included, and use them only to classify the rows the inventory recognized. They are a classification lookup, not a second, unbudgeted inventory: ignore every row they return that the inventory did not recognize, both the rows the budget deliberately excluded and the unrecognized ones, which `--merged` will otherwise hand back as happily as any breadcrumb.

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

Recovery breadcrumbs from earlier runs (both layouts inventoried in full):

  Redundant     20260112  task/007            refs/pruned/20260112/task/007         1c0ffee  sweep  landed in develop; 205 days old
  Redundant     20260112  spike/a             refs/pruned/flat/20260112/spike%2Fa   b0bab1e  sweep  landed in develop; 205 days old
  Redundant     20260118  foo or foo-a9cb40e  refs/pruned/20260118/foo-a9cb40e      a9cb40e  sweep  landed in develop; 199 days old
  Load-bearing  20260130  spike/kv            refs/pruned/flat/20260130/spike%2Fkv  55ac0de  keep   commits unreachable from develop
  Changed       20260125  task/009            refs/pruned/20260125/task/009         7f3a1b2  keep   ref moved since the inventory
  Unrecognized  -         -                   refs/pruned/notadate/foo              4d5e6f7  keep   date segment is not YYYYMMDD
  Unrecognized  -         -                   refs/pruned/20260120/decoy            a03ab1f  keep   symbolic ref; the tip shown is its target's
  Redundant     20260803  task/011            refs/pruned/20260803/task/011         3d4e5f6  keep   landed, but only 2 days old

Non-Merged deletions will first be preserved under unused refs/pruned/... names.
Choosing Proceed deletes only the proposed Merged and Transient rows and sweeps only the breadcrumb rows marked `sweep`. Choose other instructions to keep/skip rows or explicitly name an Uncertain branch to delete.
```

List every inventoried breadcrumb, not only the sweep candidates, with its date segment, decoded branch name — both readings when a disambiguation suffix left it unresolved — exact ref, and tip, so the refs someone would otherwise have to remember a `git for-each-ref refs/pruned/` incantation to see are on screen next to the branches. When a layout's budget truncated the inventory, say so on its own line — `flat layout truncated at the 200-breadcrumb budget` — because a listing that silently omits breadcrumbs reads as an all-clear it has not earned.

In normal interactive mode, use Claude Code's native `AskUserQuestion` mechanism to ask whether to proceed, keep/skip named branches, or give other instructions. Proceed confirmation covers proposed Merged/Transient rows in attributable current-container helper worktrees because step 9 removes those only through `wt-remove`; every unattributed/pre-existing worktree and every explicitly requested Uncertain deletion requires approval naming its exact annotated path and branch. Apply changes, re-display the updated listing, and ask for final confirmation through `AskUserQuestion`. If the user explicitly requests deletion of an Uncertain branch, mark that row `explicitly confirmed`, include it in the updated listing, and require final confirmation; it receives a recovery ref.

In `hands-off` mode, print the same listing for auditability and proceed immediately with only Merged and Transient rows that are not checked out in a linked worktree or whose linked worktree is attributable to this container's exact helper root and removable through `wt-remove`. Invocation-time keeps still apply. Ignore any ambiguous delete guidance, never remove an unattributed worktree, and never include Uncertain rows.

`hands-off` prints the breadcrumb inventory in full but sweeps nothing, for the same reason it refuses to touch Uncertain branches: an unattended run should not make a removal decision the user has not had the chance to see first. Report the redundant breadcrumbs, mark the sweep-eligible ones `report only (hands-off)` rather than `sweep`, and print their cleanup commands in step 11 so the user can finish the job in one paste.

### Step 8 — Revalidate tips and reserve recovery refs

Re-read every confirmed branch ref before any worktree removal or branch deletion. If a branch disappeared or its full tip OID differs from the inventory snapshot, drop it from the deletion set, move it to Uncertain with `tip changed during run`, and report it.

For every confirmed branch not in Merged, reserve a recovery ref before deleting any branch:

1. Start with `refs/pruned/<YYYYMMDD-UTC>/<branch>`, using one UTC date for the run.
2. Atomically claim the candidate only if it does not exist, using `git update-ref --stdin -z` with its `create SP <ref> NUL <tip> NUL` form, opening the transaction with `option no-deref NUL` so the claim binds the candidate name itself. The `-z` form delimits the ref by NUL instead of parsing it under the newline format's C-quoting rules, so a branch name containing a quote needs no reasoning about escaping. Do not use a blind `git update-ref "<ref>" "<tip>"` write: that can repoint an earlier run's breadcrumb.
3. Try at most 10 hierarchical candidates: the base name, `refs/pruned/<date>/<branch>-<short-tip>`, then that short-tip form suffixed `-2` through `-9`. The claim loop never overwrites or deletes a ref that holds anything; it only ever creates a name nothing holds — a dangling symbolic ref, discussed below, being the one name that resolves to nothing while still occupying the slot — and a breadcrumb it collides with is left exactly as it was. The single place any breadcrumb is removed is step 10's sweep of earlier runs' redundant refs, which acts only on refs this run inventoried, reported, and had confirmed.
4. When none of those 10 can be claimed, fall back to the flat namespace below. The usual cause is a directory/file conflict rather than a taken name: a same-date breadcrumb whose branch name is a path prefix of this branch (an earlier-pruned `foo` sitting where every `refs/pruned/<date>/foo/bar` candidate must live) blocks the whole hierarchical family at once.
5. Claim up to 10 flat candidates under `refs/pruned/flat/<YYYYMMDD-UTC>/`, the same atomic, `no-deref` way: `<encoded>`, `<encoded>-<short-tip>`, then that short-tip form suffixed `-2` through `-9`. `<encoded>` is the branch name percent-encoded into a single path component — `%` to `%25` first, then `/` to `%2F`; that order keeps the mapping reversible, so two branches never share a base flat name. Two properties make this subtree conflict-free rather than merely less conflict-prone: `flat` sits where a date segment goes, and a date segment is always `YYYYMMDD`, so no branch-derived name can reach into it; and every name inside it is a leaf, so nothing there creates a directory for a later breadcrumb to collide with. A taken name is the ordinary case the counters already cover. Only a branch that exhausts all ten is stuck — percent-encoding expands as well as joins, and a literal `%` triples, so a long or `%`-dense branch can exceed the filesystem's limit on a single name — and that needs no further naming scheme; it lands on the drop-and-report rule below, which keeps the branch.
6. After a successful create, resolve the new ref as a commit and require its full OID to equal the expected snapshotted tip.
7. If no name can be claimed in either family, or verification fails, drop that branch from the deletion set and report it. Continue best-effort for other branches.

`no-deref` on that transaction is what makes the claim bind the candidate name rather than whatever it resolves to. Without it, `create` follows a symbolic ref sitting at the candidate name: one whose target exists is refused either way (`cannot lock ref ...: reference already exists`), but a **dangling** one — pointing at a name that does not exist — dereferences to that missing name, so the `create` succeeds against *it*. The run then writes a stray ref at the symref's target name, at the branch tip, while the candidate itself stays a symref; item 6's verification resolves it, finds exactly the expected OID, and passes, so the branch is deleted against a breadcrumb that is really a pointer to a ref outside `refs/pruned/`. Step 5's inventory cannot be counted on to catch this case, because `for-each-ref` skips a dangling symref rather than listing it, so `no-deref` is the guard that always applies. With it the dangling symref is replaced by a proper direct breadcrumb, and nothing is lost: a symref whose target does not exist preserves no commit.

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

Then, and only then, sweep the confirmed redundant breadcrumbs from earlier runs. Doing it after the branch deletions keeps the refs this run reserved out of the set by ordering as well as by age.

- Delete each with `git update-ref --no-deref -d "$ref" "$old_oid"`, passing the OID step 5 inventoried as the expected old value. Git refuses whenever the ref no longer holds that OID; that refusal is the entire reason for the expected-old value, so leave the breadcrumb unswept and never retry without it. A failing `update-ref` is informative in its own right whatever its shape, but only the probe below separates a refusal by the expected-old check from an ordinary failure that left the ref at its inventoried OID — lock contention being the usual one, and it reports `cannot lock ref` too. Record the breadcrumb as a **refused** sweep only once the probe has attributed the failure to that check, and as a plain **failed** sweep otherwise; never as a bare skip, which says nothing about which of the two happened. That attribution is also what establishes that something outside this run moved, deleted, or replaced a ref under `refs/pruned/**` while the run was in progress, which the user should hear about regardless of what else the report says about that breadcrumb.
- The refusal names a current position only when the ref still resolves to one, which for a direct breadcrumb means it **moved** — `cannot lock ref '<ref>': is at <actual> but expected <expected>`. A breadcrumb another process **deleted** in between refuses with `cannot lock ref '<ref>': unable to resolve reference '<ref>'`, and one **replaced by a dangling symbolic ref** refuses with `cannot lock ref '<ref>': reference is missing but expected <expected>`. Neither of those two names a current position, because neither has one to name, so no report may promise one for every refusal.
- `--no-deref` is what confines the deletion to the breadcrumb name. `git update-ref -d` follows a symbolic ref by default and deletes its **target** instead of the ref named, leaving the symref itself in place and now dangling, so a symref standing at a breadcrumb name turns this sweep into a branch deletion — `refs/heads/<default>` included — while the breadcrumb it was meant to remove survives, invisibly, because `for-each-ref` skips a dangling symref. Step 5 holds back a symref that was already there at inventory, but no inventory check can cover a direct breadcrumb *replaced* by a symref afterwards: the swap satisfies the expected-old comparison, because the symref resolves to a ref sitting at `$old_oid`, and the default dereference then deletes that ref instead of the breadcrumb. The two guards are not redundant — the inventory one keeps the classification and the listing honest, this one keeps the deletion safe. Under `--no-deref` the expected-old comparison still resolves the symref and still refuses on a mismatch, while the deletion removes only the breadcrumb name and leaves whatever it pointed at untouched.
- After any failed deletion, establish which of the three shapes above happened, or that none of them did, by probing the ref itself, never by matching on Git's message — the wording is not an interface Git promises to keep stable, and it does not separate these cases anyway: a breadcrumb replaced by a symref whose target still exists refuses with the *moved* wording while nothing moved at all. Probe in this order. `git symbolic-ref --quiet "$ref"` succeeding means the breadcrumb name is still standing, now as a symbolic ref that replaced the direct one; record it as **present but unexpectedly replaced**, naming the target it reports. Otherwise `git rev-parse --verify --quiet "$ref"` returning an OID that differs from `$old_oid` means the breadcrumb **moved**; record that OID as its current position. The same probe returning `$old_oid` unchanged means the expected-old check is not what refused — the deletion failed for some other reason, lock contention being the ordinary one — so record a plain failed sweep and claim no move, because a report of a move nobody made sends the user looking for a race that did not happen. Only a ref that fails both probes is **vanished**. On a dangling symref `rev-parse --verify --quiet` still prints `warning: ignoring dangling symref <ref>` on stderr while exiting non-zero; that warning is not an error, and the `symbolic-ref` probe has already claimed that case. Assign `vanished` from these probes alone — the deleted and replaced refusals both name no OID, so the message cannot tell them apart, and reading one as the other retires a breadcrumb that is still there.
- Sweep only rows the listing marked `sweep` and a confirmation covered. Never sweep in `hands-off` mode, never sweep a load-bearing, changed, or unrecognized breadcrumb whatever its age, and never sweep one inside the age threshold.
- Record swept, refused, and failed breadcrumbs separately, each refused one carrying the disposition its probe established — moved with the OID the ref now holds, vanished, or present but unexpectedly replaced with the target its symref now names. A failed sweep is non-fatal and changes nothing about the branch results.

### Step 11 — Report and restore orientation

Confirm that the invoking checkout still has its original branch or detached-HEAD orientation and untouched dirty-state entries. Do not attempt destructive restoration if another process changed it; report the difference instead. Remove only clean temporary worktrees created for the default-branch pull, without force; preserve and report any that cannot be removed safely.

Print:

- Fetch, default-resolution source, authoritative default name/OID, and pull or `no-pull` result.
- Every deleted branch with bucket and full tip SHA. Include the exact recovery ref for each Transient or explicitly confirmed Uncertain deletion.
- Every kept, skipped, changed, dirty-worktree, or failed branch with its reason.
- Every recovery ref created in this run, separated into refs for deleted branches and refs reserved for branches that remained, with the reason each latter branch was not deleted.
- Every pre-existing breadcrumb inventoried, separated into swept, kept as load-bearing, kept as too recent, kept because the user or `hands-off` declined the sweep, kept as changed since the inventory, unrecognized, failed (the sweep errored with the ref still at its inventoried OID), and the three refused-sweep dispositions step 10's probe established: **moved**, naming the OID the ref now holds; **vanished**, naming no current OID because the ref is gone; and **present but unexpectedly replaced by a symbolic ref**, naming the target it now points at rather than an OID. Give each its date segment, decoded branch name (both readings when a disambiguation suffix left it unresolved), exact ref, and tip. The tip shown for a changed or refused breadcrumb is the inventoried one — the position step 5 recorded, not where the ref stands now — so label it that way instead of presenting it as current; for a vanished breadcrumb report no current OID, since there is none, and for a replaced one report the target its symref names rather than an OID, because any OID it resolves to is its target's position and not the breadcrumb's. A refused sweep is worth stating plainly as a race: another process touched `refs/pruned/**` during the run. Vanished is the outcome the sweep wanted anyway; replaced is the one that leaves the user something to act on, because the breadcrumb name survived the sweep as a symref nobody has explained — and whether anything surfaces it again turns on that symref's target: `for-each-ref` skips a dangling one, so a later run's inventory will not list it either, while a symref whose target exists is listed and held back as unrecognized. When either layout's budget truncated the inventory, state that in the report too, naming the layout and the cap, so the listing is never read as the complete set.
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

Show cleanup for the exact recovery refs this run created, never for a ref it did not report, and always with expected-old OIDs so a changed breadcrumb is not removed accidentally:

```sh
git update-ref --no-deref -d '<exact-recovery-ref>' <preserved-full-tip-sha>
```

Print the same form for every redundant breadcrumb from an earlier run that was reported and eligible but not swept — under `hands-off` or because the user kept it — so the cleanup this run declined to perform stays one paste away. Do not print one for a breadcrumb the age threshold held back: the threshold exists so a recent breadcrumb is not removed while the user is still orienting, and handing over the command that removes it undoes most of that. Say instead that it is redundant and becomes a sweep candidate once its date segment is 7 days old. Never print a removal command for a load-bearing breadcrumb; say instead that its commits are not reachable from the resolved default and it may be the only ref still keeping them advertised. Report an unrecognized ref as it stands, with no removal command and no claim about what it holds — a symbolic ref in particular reports the tip of whatever it points at, which is not a commit it preserves. Every printed removal command carries `--no-deref` for the same reason the executed one does: pasted minutes or days later, it must still remove the named breadcrumb rather than follow a symbolic ref that appeared at that name in the meantime.

Print no removal command for a breadcrumb that changed since the inventory, and none for one whose sweep the expected-old-OID check refused. These are one condition observed at two moments — a sweep refuses *because* the ref no longer holds the inventoried OID — so they get one treatment. The inventoried OID is no longer known to be the one the ref holds, so a command carrying it fails — and in the one case where it would not, it is worse than useless: a breadcrumb put back at its inventoried OID after this run observed it change, the case step 6 already guards the classification against, would take that command successfully and delete content nothing in this run ever classified as redundant. Report each by the disposition already established instead of handing over a command. For a **moved** breadcrumb, give the mismatch and the OID the ref now holds, so the situation is diagnosable without re-running the skill. For a **vanished** one, say it is gone and report no current OID, because there is none to report. For one **replaced by a symbolic ref**, say the breadcrumb name is still present with an unexplained symref where the direct ref was, name its target, and say whether a re-inventory will surface it: it will not when that target does not exist, because `for-each-ref` skips a dangling symref, and it will, as an unrecognized ref, when the target exists. A breadcrumb that changed since the inventory is reported the same way, from what step 6 observed: the differing OID when the classification query returned one, and otherwise only that the queries no longer return the ref, which is as much as that check establishes.

Do not re-derive the expected-old value from the ref's current OID to print a command that would work. The breadcrumb moved for a reason nobody in this run can explain, and a re-derived command deletes whatever the ref holds now — which, if something repointed it onto commits unreachable from the resolved default, is exactly the load-bearing ref the rule above forbids removing. That would turn a failure Git refuses into the loss this skill exists to prevent. Anyone who does want a working command has the ref's current OID from the report and can inspect it first, which is the step no printed command can perform for them.

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
- [ ] All non-Merged recovery refs atomically claimed at unused names, with `no-deref` so the claim bound the candidate name rather than a symbolic ref's target, and verified before any removal/deletion.
- [ ] Earlier runs' `refs/pruned/**` breadcrumbs inventoried under both layouts within budget and without either layout spending the other's, non-commit, symbolic, and mis-shaped refs held back as unrecognized, flat names decoded and step 8's disambiguation suffixes resolved or reported under both readings, split into redundant and load-bearing, and any truncation stated plainly in listing and report.
- [ ] No breadcrumb swept without a confirmation covering it; every sweep classified the inventoried OID and used the `--no-deref` expected-old-OID `git update-ref -d` form, in printed commands as well as executed ones; load-bearing, recent, changed, symbolic, and unrecognized breadcrumbs kept, and `hands-off` swept none.
- [ ] Every refused sweep had its disposition — moved, vanished, or present but unexpectedly replaced — established by probing the ref rather than by reading Git's refusal text, and no removal command was printed for a breadcrumb that changed since the inventory or whose sweep refused.
- [ ] Tips rechecked; automatic cleanup covered only clean Merged/Transient worktrees attributed to this container's exact helper root and removed through `wt-remove`; every plain-Git candidate removal had exact path-and-branch approval.
- [ ] Only local branches deleted; every deleted tip and every created recovery breadcrumb, including refs for branches that remained, reported.
- [ ] Every dynamic branch, ref, and path was passed as argv or shell-quoted, in executed and printed commands alike, with literals in printed commands single-quoted.
- [ ] Invoking checkout orientation and dirty work preserved; remote remained untouched.
