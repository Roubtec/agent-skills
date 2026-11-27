# Delegating a rebase: the caller's half

This file is part of the `review-cycle` skill, under its `SKILL.md` → "The delegated rebase step", beside it; the other sections it names (**The loop and its gates**) are that file's.
It is read in full by a caller that is about to delegate a rebase, and by no run that rebases nothing.

**How the step is carried out is `rebase-brief.md`, beside this file, and the rebaser reads it rather than you restating it.**
Open the rebaser's prompt with the destroy-boundary line, then tell it to read `<path>/rebase-brief.md` in full and carry it out.
That file holds the recovery ref and its read-back, pinning the base to a commit, the `--no-update-refs --no-rebase-merges` shape of every replay, the guard that halts on a merge commit carrying its own content, hunk-level conflict resolution under `rebase-stack`, the clean halt, the validation, and what the step returns.
What follows is the caller's half: what the prompt has to carry, and what to do with what comes back.

**Where it runs is the caller's working location for that entry** — the checkout it works inline, or the worktree it attached — so the brief carries that absolute path, the branch, the pinned base below, and a destination for any build output under this cycle's artifact-directory rules.
An inline location means the rebase rewrites a branch someone may be standing on: that is inline working's contract rather than a side effect, and the caller says which mode it is handing over.
The prompt also spells out, as commands, the two ref writes the step makes, because the destroy boundary otherwise forbids `update-ref`: the recovery ref saved before the first replay (`git update-ref refs/pre-rebase/<branch>/<ts> HEAD`, timestamp `YYYYMMDD-HHMMSS`), and the snapshot that keeps a pinned base reachable where nothing else does (`git update-ref refs/pinned-base/<slug>/<ts> <oid>`).
Adopt the replay on the recovery ref's read-back the step reports, never on the ref's shape.

**The target is pinned to a commit, and the caller says whose ref it is.**
The step resolves the target once and rebases onto that **OID**; the OID actually rebased onto is this entry's *effective base*, and it is what every delegation range afterwards names — `<effective base>..HEAD` — under the stable-refs rule below.
Where the target is a ref name rather than a commit, it is fetched fresh from the repository that ref **lives in**, which the caller names in the prompt: for a PR's base that is the repository the PR itself is in, whose `<owner>/<repo>` is the one in the PR's own `url`.
That fetch is one of two arms and the caller says which it is handing over, because WHOSE ref the target is decides where it lives: a target the **request** named outright — `rebase on top of <target>` — is routinely a local branch, so it is resolved in the working location and fetched from nowhere.
Never hand over a movable remote-tracking name such as `origin/<base>`, and never hard-code `origin/main`: entries legitimately target other branches and other entries' heads.

**After a rebase, delegate ranges relative to stable refs** — the effective review base pinned to an immutable OID or a recorded snapshot wherever it can move mid-run, never a movable remote-tracking name like `origin/main` — and never a SHA captured before the rebase, which is no longer reachable: re-record the prior-round SHA afterwards.

**Stacked entries rebase parent-first, in topological order.**
What makes that possible is a parent map — each entry's PR base and head as **repository-qualified** pairs, from one `gh pr view --json baseRefName,headRefName,headRepository,headRepositoryOwner,isCrossRepository` per entry, the base side being that PR's own repository — specified here and held by the caller, since it spans entries and outlives any one delegation.
Match child to parent on those pairs, never on bare branch names, exactly as `address-reviews` does it: its `targets.sh plan` holds a batch to the one repository its PRs' own URLs name before it matches a base branch to a head branch, and leaves a fork's head branch out of the match.
A parent rebases onto its own base first; each child is then handed its parent's **new** tip and its old one, and rebases onto the new with `--onto`.

**A no-op is the common outcome, and it is what makes a caller's two points safe.**
Over a linear range, against a base already an ancestor of `HEAD`, the step replays nothing and the tip is unchanged; a pure-join merge still in range is the one exception, flattened once and then gone from the range, so either way a second point cannot re-apply the first's work.
A reported no-op lets the caller keep its verdict over an unchanged tree and skip the validation.
That claim is the one that switches checks OFF, the validation and any re-verification a caller runs over a replayed tree, so a caller adopts it on the unchanged tip it names rather than on the flag alone: a no-op naming a moved tip, or naming none, is unevidenced and stops that caller's run.

**A halt comes back as an open question, with the tree left clean and idle.**
A conflict beyond the step's competence, and a merge commit that introduced content of its own, both halt the entry rather than guess: the rebase is aborted, or never started, and the halt is reported in the format of `open-questions.md`, beside this file (`origin: rebase`), naming the files, the offending commit or merge, and what the judgment turns on; the caller gives that question its `id` and round, and its `coupledWith` where it shares a decision with another.
One entry's halt is one entry's: siblings proceed, and nothing of the halted entry is published.

**A rebase that actually replayed something is validated at the delivery tier**, per the validation tiers under **The loop and its gates**; a no-op earns none.
Where a caller rebases after its fixes, that point runs **before** its final reviewer round, so the passing verdict is rendered on the exact tree that will be pushed.
