# Delegating a rebase: the caller's half

This file is part of the `review-cycle` skill, under its `SKILL.md` → "The delegated rebase step", beside it; the other sections it names (**The loop and its gates**) are that file's.
It is read in full by a caller that has reached a rebase point, and by no run that rebases nothing.

**How the step is carried out is `rebase-brief.md`, beside this file, and the rebaser reads it rather than you restating it.**
Open the rebaser's prompt with the destroy-boundary line, then tell it to read `<path>/rebase-brief.md` in full and carry it out.
That file holds the recovery ref and its read-back, pinning the base to a commit, the `--no-update-refs --no-rebase-merges` shape of every replay, the guard that halts on a merge commit carrying its own content, hunk-level conflict resolution under `rebase-stack`, the clean halt, the validation, and what the step returns.
What follows is the caller's half: the facts a point starts from, what the prompt has to carry, and what to do with what comes back.

**A rebase point starts from facts `rebase-facts.sh` read, never from ones you composed.**
Pin the target to a commit as below, then run `rebase-facts.sh -C <working location> before --onto <pinned commit>`, the script beside this file, adding `--parent-tip <the parent's old tip>` for a stacked child; its `--help` is the contract for every line it prints.
It reads objects and writes nothing, so it is one cheap call per point, and its output goes into the rebaser's prompt verbatim, marked *verified this turn*: the fork point, the commits that would replay, a merge in range, and the files changed on both sides are never worked out by hand or restated from an earlier turn.
Its `outcome=` decides what the point is:

- **`noop`: spawn no rebaser.**
  The target is the fork point and the range holds no merge, so a replay would move nothing: report the point as skipped on that proof, quoting `branch=`, `onto=` and `fork-point=`, and take `onto=` as the entry's effective base.
  That proof is the only thing that skips a point; an impression that the base has not moved skips nothing.
- **`stale-parent` (exit 3): delegate nothing.**
  The old parent tip is not an ancestor of the child, so it bounds nothing and `--onto` from it would replay the parent's superseded commits as the child's own.
  The entry goes to `rebase-stack`, or halts as an open question naming both tips.
- **`replay`: delegate the step.**
  Its `onto-path=` lines decide whether the replay's validation may be carried, below.
- **No answer (exit 1) decides nothing:** it skips no point and carries no verdict, so delegate the point and verify what comes back.

**A verdict crosses a replay that changed nothing it was rendered on.**
`rebase-facts.sh -C <working location> after --old-base <fork-point> --old-tip <pre-rebase tip> --new-base <effective base>` answers for a replayed tip, its three commits being `before`'s `fork-point=`, `branch=` and `onto=`.
`outcome=carry` is both halves of one proof: the replay is patch-identical — the same commits carrying the same patches, none dropped, skipped, altered or flattened — and the files that changed between the old base and the new are none of the branch's.
Then whatever was rendered on the old tip stands for the new one, the validation run and a reviewer's passing verdict alike: no delivery-tier validation and no reviewer or peer round is owed on account of the rebase.
Judgement stays yours, exercised on `before`'s `onto-path=` lines ahead of the spawn: a change there that reaches beyond its own file — build or lint configuration, a dependency, a generated contract, what the validation-tiers bullet under **The loop and its gates** singles out — is the reason to refresh the verdict whatever the helper says.
Where you see none, the rebaser's prompt says its validation may be carried and spells out that `after` command by the script's absolute path, so the rebaser skips a run the answer makes unnecessary; where you see one, the prompt says to validate regardless.
When the rebaser returns, run the same call yourself and act on that answer, never on the rebaser's account of it.
`outcome=verify` (exit 3), and no answer, leave the replay to be verified in full.
A carried verdict is reported as one: the cycle's result and any summary name the tip the verdict was rendered on, the tip it was carried to, and the `outcome=carry` answer it was carried on, so the maintainer can see a tree was published on a carried verdict.

**Where it runs is the caller's working location for that entry** — the checkout it works inline, or the worktree it attached — so the brief carries that absolute path, the branch, the pinned base below, and a destination for any build output under this cycle's artifact-directory rules.
An inline location means the rebase rewrites a branch someone may be standing on: that is inline working's contract rather than a side effect, and the caller says which mode it is handing over.
The prompt also spells out, as commands, the two ref writes the step makes, because the destroy boundary otherwise forbids `update-ref`: the recovery ref saved before the first replay (`git update-ref refs/pre-rebase/<branch>/<ts> HEAD`, timestamp `YYYYMMDD-HHMMSS`), and the snapshot that keeps a pinned base reachable where nothing else does (`git update-ref refs/pinned-base/<slug>/<ts> <oid>`).
Adopt the replay on the recovery ref's read-back the step reports, never on the ref's shape.

**The target is pinned to a commit before the facts are read, and whose ref it is decides how.**
`rebase-facts.sh` fetches nothing, so the pin is the caller's, made immediately before the point with the pin its own skill names; the rebaser is handed that **OID** and rebases onto it.
The OID actually rebased onto is this entry's *effective base*, and it is what every delegation range afterwards names — `<effective base>..HEAD` — under the stable-refs rule below.
A target that is a ref name is fetched fresh from the repository that ref **lives in**: for a PR's base that is the repository the PR itself is in, whose `<owner>/<repo>` is the one in the PR's own `url`.
That fetch is one of two arms, because WHOSE ref the target is decides where it lives: a target the **request** named outright — `rebase on top of <target>` — is routinely a local branch, so it is resolved in the working location and fetched from nowhere.
Never hand over a movable remote-tracking name such as `origin/<base>`, and never hard-code `origin/main`: entries legitimately target other branches and other entries' heads.

**After a rebase, delegate ranges relative to stable refs** — the effective review base pinned to an immutable OID or a recorded snapshot wherever it can move mid-run, never a movable remote-tracking name like `origin/main` — and never a SHA captured before the rebase, which is no longer reachable: re-record the prior-round SHA afterwards.

**Stacked entries rebase parent-first, in topological order.**
What makes that possible is a parent map — each entry's PR base and head as **repository-qualified** pairs, from one `gh pr view --json baseRefName,headRefName,headRepository,headRepositoryOwner,isCrossRepository` per entry, the base side being that PR's own repository — specified here and held by the caller, since it spans entries and outlives any one delegation.
Match child to parent on those pairs, never on bare branch names, exactly as `address-reviews` does it: its `targets.sh plan` holds a batch to the one repository its PRs' own URLs name before it matches a base branch to a head branch, and leaves a fork's head branch out of the match.
A parent rebases onto its own base first; each child is then handed its parent's **new** tip and its old one, and rebases onto the new with `--onto`.
The old tip is handed over only once `before --parent-tip` has shown it is the child's ancestor: a child that sat out an earlier restack is never given to an `--onto` replay.

**A no-op is the common outcome, and it is what makes a caller's two points safe.**
Over a linear range, against a base already an ancestor of `HEAD`, a replay moves nothing; a pure-join merge still in range is the one exception, flattened once and then gone from the range, so either way a second point cannot re-apply the first's work.
`before` proves the no-op ahead of the spawn, the merge included, and that proof keeps the caller's verdict over an unchanged tree with no rebaser and no validation.
A no-op a rebaser reports instead, at a point delegated without that proof, switches the same checks OFF, so the caller adopts it on the unchanged tip it names rather than on the flag alone: a no-op naming a moved tip, or naming none, is unevidenced and stops that caller's run.

**A halt comes back as an open question, with the tree left clean and idle.**
A conflict beyond the step's competence, and a merge commit that introduced content of its own, both halt the entry rather than guess: the rebase is aborted, or never started, and the halt is reported in the format of `open-questions.md`, beside this file (`origin: rebase`), naming the files, the offending commit or merge, and what the judgment turns on; the caller gives that question its `id` and round, and its `coupledWith` where it shares a decision with another.
One entry's halt is one entry's: siblings proceed, and nothing of the halted entry is published.

**A replay that does not carry is validated at the delivery tier**, per the validation tiers under **The loop and its gates**; a no-op and a carried replay earn none.
Where a caller rebases after its fixes, that point runs **before** its final reviewer round, so the passing verdict is rendered on the tree that will be pushed; a point that falls after a passing verdict keeps that verdict only by the carry above, and is otherwise reviewed again.
