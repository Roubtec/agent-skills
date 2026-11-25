# The delegated rebase step

You were sent here by the prompt that started you, to bring one branch onto its freshest base.
That prompt names the working location (an absolute path, and whether it is a checkout someone may be standing on or a worktree), the branch, the target and which kind it is, where any build output goes, and the two `git update-ref` commands this step may run.
Everything below is how the step is carried out; where your prompt and this file disagree on a fact of the run — a path, a branch, a target — your prompt wins.

**Save the recovery ref before the first replay.**
Run the `git update-ref refs/pre-rebase/<branch>/<ts> HEAD` command your prompt spells out (timestamp `YYYYMMDD-HHMMSS`); it is spelled out there because the destroy boundary otherwise forbids `update-ref`.
Then read that ref back (`git rev-parse --verify`) and report the full ref path, the OID it resolved to, and the pre-rebase tip: the caller adopts the replay on that read-back rather than on the ref's shape.

**Pin the effective base before rebasing onto it, and pin it to a commit.**
Resolve the target once (`git rev-parse`) and rebase onto that **OID**; the OID actually rebased onto is this entry's *effective base*, and it is what every range afterwards names — `<effective base>..HEAD`.
Where the target is a ref name rather than a commit, fetch it fresh from the repository that ref **lives in**, which your prompt names: for a PR's base that is the repository the PR itself is in (a PR's base always is), whose `<owner>/<repo>` is the one in the PR's own `url` — never the head's push remote, and never a bare `gh repo view --json nameWithOwner`, which with no repository argument answers for whatever repository the working location resolves to.
Fetch from the remote whose URL is that repository, or from that repository's URL where no remote points at it — `git fetch <that> refs/heads/<base>`, moving no branch — and resolve what the fetch brought.
That fetch is one of two arms and your prompt says which it handed you, because WHOSE ref the target is decides where it lives: a target the **request** named outright — `rebase on top of <target>` — is routinely a local branch, so it is resolved in the working location (`git rev-parse --verify`, the operand quoted as one argument) and fetched from nowhere.
Never carry a movable remote-tracking name such as `origin/<base>` instead.
Never hard-code `origin/main` either: entries legitimately target other branches and other entries' heads.
An OID is immutable, so recording it *is* the pin; where nothing the run keeps holds that commit reachable, save a snapshot ref for it with the `git update-ref refs/pinned-base/<slug>/<ts> <oid>` command your prompt spells out.

**A stacked child rebases onto its parent's new tip.**
Where your prompt hands you a parent's new tip and its old one, the form is `git rebase --no-update-refs --no-rebase-merges --onto <new parent tip> <old parent tip>`, which replays the child's own commits alone, and git's patch-id dropping removes whatever the base already carries.
That is also the shape of the parent that merely gained fix commits mid-run while its child still sits on the old tip.
Restacking a whole chain after merges is the `rebase-stack` skill's job: name it and stop rather than growing into it.

**The replay's shape is stated, never inherited: it moves one ref — the entry's own branch — and flattens what it replays.**
So every rebase this step runs passes `--no-update-refs`, the ordinary onto-the-pinned-OID form and the stacked `--onto` form alike, whatever `rebase.updateRefs` the user or repository config sets; a sibling branch moves in its own parent-first turn, behind its own recovery ref.
Merge topology is the other half of the statement — the replay flattens whatever `rebase.rebaseMerges` is set to — so the stated flags are `--no-update-refs --no-rebase-merges`, on the ordinary form and the stacked `--onto` form alike.

**A no-op is the common outcome.**
Pinning first and rebasing onto a commit is idempotent over a linear range: against an OID already an ancestor of `HEAD`, `git rebase` replays nothing and the tip is unchanged.
A pure-join merge still in range is the one exception — the replay flattens it, moving the tip even over an unmoved base — and only once, since flattened it is gone from the range (a content-bearing or octopus merge never reaches a replay at all: the guard below halts both).
Report the no-op as one, and report the two tips beside it: the caller adopts the claim on the unchanged tip you name, never on the flag alone.

**A merge commit that introduced its own content is never silently flattened.**
A plain `git rebase` replays no merge commit, so before the first replay enumerate the merges in the range — `git rev-list --merges <effective base>..HEAD`.
One that merely joined its parents flattens harmlessly: its content is its parents', and the replay carries it.
One that introduced content of its own — a conflict resolution, or a hand edit made in the merge; `git show --remerge-diff <merge>` prints the delta — carries work no replayed commit holds, and where nothing replayed conflicts over the same lines the rebase drops that work silently, with the force-push that may follow making the loss permanent.
That probe answers only for a two-parent merge: handed an octopus merge (more than two parents — `git rev-list --parents -n 1 <merge>` shows them), `git show --remerge-diff` prints no delta at all — just the commit header and `diff: warning: Skipping remerge-diff for octopus merges.` — and exits 0, silence that is the probe declining to answer rather than evidence of a pure join — so an octopus merge in range halts unprobed, exactly as if it carried content.
Such a merge halts the entry clean, exactly like a conflict beyond competence below, the halt naming the merge and the files its delta touches (for an unprobed octopus, the files `git diff <merge>^1 <merge>` names): whether to flatten and re-resolve, preserve the topology (`git rebase --rebase-merges` re-creates the merge and resurfaces its conflicts), or leave the branch unrebased is the maintainer's call.

**Conflicts are resolved by hunk**, under the `rebase-stack` skill's "Step 5 — Conflict handling", in the `rebase-stack` folder beside this skill's: it states the trivial/non-trivial classification, in-place hunk-level resolution, the verify-first condition on whole-file `--ours`/`--theirs`, and the `git rebase --skip` for a patch the new base already represents.
Read that step and follow it as written; this file neither restates nor softens it.

**A conflict beyond that competence halts the entry — and halts it clean.**
`git rebase --abort`, then confirm the working location is clean and idle: `git status --porcelain` prints nothing, and no Git operation is in progress (no `rebase-merge` or `rebase-apply` path, no `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD` or `BISECT_LOG`).
The step never returns leaving a tree mid-rebase.
Report the halt as an open question rather than guessing a resolution: the `question` phrased as the decision fork, not a narrative; `origin: rebase`; that it is `blocking`; `artifacts` as authoritative pointers (the conflicting files, the offending commit), never a paraphrase; the concrete `trigger` that manifests the problem; its `reachability` (live, here); drafted `options` with the blast radius of each; and a `recommendation` with a one-line why, left empty where the call turns on maintainer intent.
The caller gives the question its `id` and round, and couples it to any sibling question.

**Validate after a rebase that actually replayed something**, with the full applicable sanity set — lint, typecheck, build, tests, whichever the repo has — writing any build output only where your prompt says.
A no-op rebase earns no validation.

**What you return:** the pinned effective base OID, the pre- and post-rebase tips, whether the tip changed at all, the recovery ref and what it read back as, the conflicts you resolved and the commits you skipped, the validation outcome, and any halt with its open question.
