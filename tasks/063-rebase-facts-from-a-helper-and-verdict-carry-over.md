# 063 — Give the rebase step its facts from a helper, and let a verdict cross a patch-identical replay

## Why this task exists

Rebasing onto the freshest base is the default at two points of every review round, so whatever a rebase point costs is paid again each round.
Three costs recur, and in several long batches they dominated the run:

- **A rebaser is spawned for a point that has nothing to do.** The orchestrator can often show the base has not moved, yet `address-reviews` tells it to spawn the step anyway.
- **A clean replay buys a full re-verification.** When the base gained commits that touch none of the branch's files, the replay is patch-identical, but the moved tip still costs a delivery-tier run and a reviewer-plus-peer round.
- **A stacked child's boundary is taken on trust.** The child is handed its parent's old tip as the `--onto` boundary, and nothing checks that tip is an ancestor of the child. A child that sat out an earlier restack then replays stale parent commits, and the rebaser learns it only from the conflicts.

Underneath all three, the facts a rebaser works from (fork point, how many commits will replay, which tip is whose) are composed by the orchestrator into the brief, and they have been wrong.

The maintainer has decided the policy question: a test and review verdict carries across a patch-identical rebase when the base's new commits touch none of the branch's files, unless there is reason to believe interaction with the new code needs it refreshed. The facts must be cheap to gather and to parse.

## Scope

Included:

- **A read-only helper that answers, before a rebase point**, for a branch, the commit it is to go onto, and where there is one the parent's old tip: the fork point, how many commits would replay, whether a merge commit is in that range, whether the old parent tip is an ancestor of the branch, whether there is anything to replay onto at all, and whether the paths changed on the target side since the fork point intersect the paths the branch changed.
- **The same helper answering, after a replay**, whether the new range is patch-identical to the old one: the same commits carrying the same patches, none dropped, skipped or altered.
- **"The delegated rebase step" in `review-cycle` says what a caller does with each answer**: skip the spawn on a proved no-op and report the proof; refuse to delegate an `--onto` whose boundary is not an ancestor, and send that entry to `rebase-stack` or halt it as an open question; carry the verdict on a disjoint, patch-identical replay; otherwise proceed as today.
- **`rebase-brief.md` halts clean** when it is handed an old parent tip that is not an ancestor of `HEAD`, so the check holds even where a caller skipped the helper.
- **The contradictions this removes are reconciled in the text**, not left side by side (see the notes).
- **The workflows** take the same answers where they rebase: the re-verification `wf-address-review.js` runs after a pre-push rebase, and the delegated rebase `wf-address-tasks.js` runs when an early merge moves a base.
- **A test suite** for the helper, wired into `tests.yml` and README.

Out of scope:

- Whether rebasing is the default, and the two points it runs at.
- Restacking a whole chain, which stays `rebase-stack`'s.
- Forecasting conflicts for sibling entries when one merges, and checking commit references cited in replies.

## Context and references

- `plugins/dev-skills/skills/review-cycle/SKILL.md` → "The delegated rebase step" and `rebase-brief.md` beside it; the paragraphs to read closely are the one on a no-op being what makes two points safe, the one that validates a replay at the delivery tier, and the one that renders the passing verdict "on the exact tree that will be pushed".
- `address-review/SKILL.md` → "Step 2 — Rebase onto the freshest base", which lets a run skip a point it judges unnecessary, and `address-reviews/SKILL.md` → "Re-pin a default target at each rebase point", which says a no-op is never a reason not to spawn the step.
- `address-reviews/targets.sh` (`plan`, `repin`) and `address-review/pr-branch.sh` (`pin-base`) produce the pinned commit the new helper takes as input; `address-tasks/overlap.sh` shows how changed paths are counted without a worktree, including a rename counting under both names.
- `review-cycle/SKILL.md` → the validation-tiers bullet under "The loop and its gates", which already singles out build configuration, dependencies and generated contracts.

## Target files or areas

`plugins/dev-skills/skills/review-cycle/` and its Codex mirror, the rebase sections of `address-review`, `address-reviews` and `address-tasks` in both mirrors, `plugins/dev-skills/workflows/wf-address-review.js` and `wf-address-tasks.js`, `plugins/dev-skills/bin/` for a shim, `scripts/` for the suite and any suite that pins the edited text, `.github/workflows/tests.yml`, `README.md`.

## Implementation notes

- **Where the helper lives is yours to choose and justify.** The step is defined in `review-cycle` and consumed by three skills and two workflows, which argues for a script beside `rebase-brief.md` with a `bin/` shim; a command on an existing helper is acceptable if it serves every consumer.
- **Cheap means local.** Object reads only: no fetch beyond the pin the caller already made, no worktree, no index or ref write, one call per question, `key=value` lines with `outcome=` first, and the rest of the helper contract the existing scripts follow (bash 3.2, exits 0/3/1/64, header comment as the contract, byte-identical in both mirrors).
- **The no-op proof includes "no merge commit in the range".** A replay flattens a pure-join merge even over an unmoved base, which is the reason `address-reviews` gives for forbidding the skip. With that in the proof, both skills can state one rule: a point is skipped on the helper's proof, and never on the orchestrator's impression.
- **Carry-over is bounded by its trigger, and judgement stays.** Disjoint paths plus a patch-identical replay is what carries a verdict. A base-side change that reaches beyond its own files (build or lint configuration, a dependency, a generated contract) is the stated reason to refresh anyway, so the helper prints the base-side paths and the caller reads them. A replay that resolved a conflict, skipped or dropped a commit, or flattened a merge is not patch-identical, whatever the paths say.
- **A carried verdict is visible.** The cycle result and any summary say which tip the verdict was rendered on, which tip it was carried to, and on which answer, so the maintainer can see a tree was published on a carried verdict.
- The sentences that tie a passing verdict to the exact pushed tree, and that order a delivery-tier run after any replay, are relaxed by this decision. Rewrite them to state the carry-over; do not leave them contradicting it.
- Facts in a rebaser's prompt come from the helper's output, marked as verified this turn under the provenance rule.
- Task 056 moves "The delegated rebase step" behind a stub and task 054 trims `address-reviews`: edit the text where it lives when you start, and rebase over whichever lands first.
- If the workflow half proves larger than the helper and the skill text together, deliver those first and queue the workflow half under this task's number with a letter suffix, saying so in the pull request.

## Acceptance criteria

- One helper call gives a caller every fact listed under Scope, and no skill or brief asks an orchestrator to compute or restate one of them by hand.
- A point whose target is already contained in the branch, with no merge in range, spawns no rebaser, in `address-review` and `address-reviews` alike.
- A stacked child whose recorded parent tip is not its ancestor is never handed to an `--onto` replay.
- After a replay the helper proves patch-identical over a base whose changes are disjoint from the branch's, the caller runs no delivery-tier validation and no reviewer round on account of the rebase, and its result says the verdict was carried.
- A replay that touched a shared path, resolved a conflict or dropped a commit is verified exactly as today.
- The full test set passes.

## Validation

- Run every suite `tests.yml` runs, `shellcheck`, and `wf-check` on the workflows.
- Build fixture histories for each answer: unmoved base, moved and disjoint, moved and overlapping, a pure-join merge in range, a child off a rewritten parent, a replay with a dropped commit. Mutation-test each guard after committing.
- Walk one two-point round by hand on a branch whose base moved disjointly and state in the pull request which spawns and runs it saved.

## Review plan

Look for a path where a verdict carries without both halves of the proof, then check that every sentence in the skills and briefs about skipping a rebase point or re-verifying after one now says the same thing.
