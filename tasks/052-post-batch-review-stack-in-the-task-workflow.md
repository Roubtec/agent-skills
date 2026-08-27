# 052 — Build the post-batch local review stack in `wf-address-tasks.js`

## Why this task exists

The `address-tasks` skill ends a batch by building a **local review stack**: disposable `review-stack/...` guide branches snapshotting the mergeable task branches, rebased into one linear chain in the recommended merge order, in a dedicated worktree, never pushed and never touching the canonical task branches.
It is the batch's integration check and its merge-order guide, and it is the thing that tells a maintainer facing eight fresh PRs which one to read first and whether they compose at all.

The workflow flavor does not build it, and `plugins/dev-skills/workflows/README.md` says so outright under *Current scope*: "It does not build the post-batch local review stack produced by the `address-tasks` skill."
So a batch run through `/dev-skills:wf-address-tasks` delivers the same PRs and withholds the guide — the same skill-versus-workflow divergence that task 049 is closing for `address-review`, and the same one the repo's mirror discipline exists to prevent.

Task 033 (vertical pipelining) already assumes this stage exists: its scope requires that "the review-stack construction and batch summary tolerate already-merged members". That clause has nothing to attach to until this lands, which is why this task is ordered before it.

## Scope

Included:

- **A terminal restack stage in `wf-address-tasks.js`**, running in the `Summary` phase after the batch's deliverable work is done, that carries out the skill's *Post-batch restack* section: compute the merge order from the dependency graph the workflow already holds, snapshot each mergeable canonical branch onto a collision-free `review-stack/...` guide branch, attach one dedicated worktree to the first guide branch, and delegate the restack to a single fresh subagent invoking the `rebase-stack` skill in its delegated unattended mode with an explicit `chain <g1> ... <gN> onto <base>`.
- **The skill's skip and exclusion rules, inherited rather than restated:** skip on a batch with 0 or 1 mergeable branch; exclude branches that failed review or were skipped; build the guide stack even for an already-linear chain.
- **Define which `results` statuses count as mergeable rather than leaving it to be inferred.** The skill's rule — reviewed and delivered, minus failed review and skipped — is wider than `done` on this workflow: `deliverTask` records `local-only` for every reviewed task on a run with no usable remote, so a predicate written as `status === "done"` withholds the stack from an entire successful batch while still passing an acceptance case built only from delivered branches. The wave loop's `succeeded` gate answers a different question (may a dependent build on this) and is not this predicate.
- **The merge-commit safety check** the skill states: inspect each canonical branch's unique history against its recorded PR base, and where `git rev-list --merges <pr-base>..<branch>` is non-empty, build and report the safe prefix rather than linearizing away merge-only conflict resolutions, reporting the remaining canonical order as not integration-checked.
- **The stage's result joins the batch return value**: the canonical merge order, the `bN → gN` mapping, each guide branch's outcome, any stop point with its conflict files and resolution or abort reason, and the exact `refs/pre-rebase/...` snapshots created. It is reported, never thrown — a failed integration check must not lose a batch's delivery results.
- **The post-return teardown, inherited rather than restated:** once the subagent returns and that result is captured, verify the canonical `bN` tips still equal the SHAs captured before the guide branches were created and that the dedicated worktree is clean with no rebase in progress, then remove that worktree and prune its registration behind it — the guarded `wt-remove` the batch already uses for a task's worktree is the removal, refusing rather than forcing over uncommitted state — a refusal the skill's own abnormal-return recovery is what clears, so carry that paragraph too rather than stopping at the refusal — and its success path removes without pruning, so the `git worktree prune` the skill names is still the stage's to run — and delete only the exact `refs/pre-rebase/...` snapshots the subagent reported. This runs on the clean-stop path as well as the success path: a stopped restack leaves the same worktree registered with `g1` checked out, so a stage that only reclaims on success is the one that accumulates them. The guide branches are never deleted; they are the artifact the maintainer inspects.
- **The teardown needs a fresh agent of its own.** The script cannot do it — workflow scripts own control flow while spawned agents own repository, shell, and Git work (`plugins/dev-skills/workflows/README.md`, *Authoring constraints*) — and folding it into the restack agent is wrong twice over: that agent cannot be resumed once its result is in hand, and the tips-unchanged verification is a check on its own work. The batch's per-task `cleanupNote` reclaim is the shape to copy.
- **The stage is skipped with a stated reason rather than silently**, whenever the batch reached fewer than two mergeable branches.
- **An aborted batch is excluded outright, whatever it delivered.** The thrown-stage catch stays the batch's guaranteed report path — no restack, no guide refs, no worktree teardown reached from it — and its accumulated `results` and closing cleanliness report are unchanged. It gains only a stated reason that the integration check did not run, so the absence is never read as the fewer-than-two skip above. This is deliberately narrower than the skill's own rule.

Out of scope:

- Pushing anything, rewriting or moving any canonical task branch `bN`, or touching any remote ref. The guide branches and the stage's dedicated worktree are its entire footprint; the teardown above, not this bullet, says what becomes of that worktree.
- Changing `rebase-stack` itself, which stays a skill: its value is sequential conflict judgment, not fan-out.
- Restructuring the wave loop or the delivery path — that is task 033, which adapts this stage rather than being blocked by it.
- Building the same stage for `wf-address-review.js`, which is the single-PR pipeline and has no batch to stack.

## Context and references

- `plugins/dev-skills/skills/address-tasks/SKILL.md` — step 7 and the section *Post-batch restack: a local review stack (never pushed)*, which owns every rule above including the guide-branch naming form, the dedicated-worktree attach, and the verbatim prompt contract for the delegated subagent. Follow it; do not re-derive a second version of it here.
- `plugins/dev-skills/workflows/wf-address-tasks.js` — the terminal `phase("Summary")` block and its neighbours: `finalMainCheckoutReport`, `mainCheckoutSummary`, `deliverTask`, and `cleanupNote`. The batch's own `results` array, whose entries carry each task's terminal status, is the input to "which branches are mergeable".
- `plugins/dev-skills/workflows/README.md` — *Current scope*, whose statement of this gap is retired by this task, and *Worktree model*, whose one-worktree-per-task rule the dedicated restack worktree sits beside.
- Task 033 — the pipelining task that depends on this stage existing; task 017 — the destroy boundary and the rule that a brief ordering a build must name where redirected output goes; task 021 — the stacked-PR rebase guidance `rebase-stack` carries.

## Target files or areas

`plugins/dev-skills/workflows/wf-address-tasks.js` (primary) and `plugins/dev-skills/workflows/README.md`. The `address-tasks` skill mirrors are the source of the rules and should need no edit; if implementing reveals the skill's own text is wrong or ambiguous, fix it in both mirrors in lockstep and say so.

Task 050 reaches the same primary file in a disjoint region — the embedded `review-cycle-core` section, never the terminal `Summary` stage this task builds — so a parallel batch should expect a same-file collision there and nowhere else.

## Implementation notes

- **The timestamp cannot come from the script.** Workflow scripts may not call `Date.now()`, `Math.random()`, or an argument-less `new Date()` — the runtime rejects them because they break resume — and the guide-branch names and worktree path both want the ref-safe `YYYYMMDD-HHMMSS` form `rebase-stack` already uses. Have the delegating subagent derive the stamp in its own shell and report the exact names it created, or thread one in through `args`. Do not invent a stamp-free naming scheme: collision-free names across repeated batches are the reason the form exists.
- **The stage must not dirty the shared main checkout.** `finalMainCheckoutReport` compares the main checkout against a baseline taken at batch start, and that comparison is a real end-of-batch barrier. Guide refs live in the shared `.git` and the restack worktree lives under the worktree base, so neither should register — confirm that empirically rather than by reading, and decide deliberately whether the restack runs before or after the final report, stating why in the code comment.
- **One restack subagent, one worktree, unattended mode.** The skill's prompt contract is explicit that the chain and the prompt together are the up-front authorization, that canonical branches and remote refs are read-only, that only conflicts the skill classifies as trivial are resolved, and that the first non-trivial conflict takes the clean-stop path with the documented restore rule. Render it once and pass it verbatim rather than paraphrasing.
- **Output destination.** If the restack's post-conflict validation runs a build that redirects output to a file, the brief must name where it goes — a unique `mktemp -d` directory outside every worktree, never a fixed shared scratchpad name, never inside the restack worktree, which must be left clean. `scripts/test-subagent-destroy-boundary.mjs` asserts this rule over every rendered subagent brief, so a new brief that omits it fails CI.
- **A fresh worktree has no installed dependencies.** Where validation would need a build, install them there first, or a resolved trivial conflict false-stops the guide on missing modules rather than a real failure.
- Reuse the dependency graph the workflow already computed for its waves; do not recompute an ordering from branch topology, which independently created branches do not carry.

## Acceptance criteria

- A batch delivering two or more mergeable branches ends by reporting a canonical merge order, a `bN → gN` mapping, and a per-guide-branch outcome, with no canonical branch moved and nothing pushed.
- A batch with 0 or 1 mergeable branch reports the stage as skipped with its reason and does nothing else.
- A batch with no usable remote, whose reviewed tasks therefore all end as `local-only`, builds the stack rather than skipping it.
- A batch that aborts after delivering two or more mergeable branches returns its abort report with the exclusion stated, and no guide branch, worktree, or pre-rebase ref created.
- A canonical branch carrying a merge commit in `<pr-base>..<branch>` is not linearized: the safe prefix is built, and the remainder is reported as not integration-checked.
- A non-trivial conflict stops the stage cleanly with the documented restore behavior, leaves the restack worktree clean so the teardown's checks pass, and still returns the batch's delivery results and final main-checkout report.
- The dedicated restack worktree is gone when the stage returns — on the success path and the clean-stop path alike — with `git worktree list` carrying no `_review-stack-...` entry and the `refs/pre-rebase/...` snapshots the subagent reported deleted, while every guide branch remains.
- The main-checkout cleanliness comparison is unaffected by the guide refs and the restack worktree.
- `plugins/dev-skills/workflows/README.md` no longer states that the workflow omits the review stack.

## Validation

- Run a three-task batch end to end and inspect the resulting guide branches and the reported order; confirm every canonical branch tip is where delivery left it, that `origin` is untouched, and that `git worktree list` carries no leftover restack worktree.
- Run the same batch once with no usable remote so every task ends `local-only`, and confirm the stack is built rather than skipped.
- Force an abort in a later wave of a batch that has already delivered two or more mergeable branches; confirm the report names the exclusion and nothing was created.
- Force the non-trivial-conflict path on a scratch batch and confirm the stop, the restore, and that the batch summary still arrives intact.
- Run `node scripts/test-subagent-destroy-boundary.mjs` after adding the new subagent brief, and `node scripts/test-checkout-cleanliness-report.mjs` after touching anything near the final report. The full `tests.yml` set must stay green.

## Review plan

Reviewer checks that no canonical task branch or remote ref is written on any path including the failure paths, that the mergeable predicate is the one this task states rather than the wave loop's `succeeded` gate or a bare `done`, that the teardown runs as its own agent rather than in the script or inside the restack agent, that the abort path creates nothing and explains itself, that the stage's rules are the skill's rather than a second rendering of them, that no `Date.now()`/`Math.random()`/`new Date()` reached the script, that the new subagent brief carries the output-destination rule and the disposable-clone bullet the boundary suite asserts, that a stage failure is reported rather than thrown so the batch's results survive it, that the dedicated worktree is reclaimed on the success and clean-stop paths with the guide branches surviving it, and that the placement relative to `finalMainCheckoutReport` is justified in a comment rather than incidental.
