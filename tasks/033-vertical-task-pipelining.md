# 033 — Vertical per-task pipelining in the batch flows (deliver early, keep stragglers iterating)

## Why this task exists

`wf-address-tasks` (and the prose batch skills) synchronize horizontally: a wave's tasks all finish implementation before reviews fan out, and delivery waits for the whole wave's pre-PR collision scan; `address-reviews` similarly tends to hold publishing until every entry converges. That leaves finished work idle — PR reviewers could already be chewing on the easy entries while the hard ones iterate, and simple PRs could merge before the batch ends. The throughput ceiling is orchestration-imposed, not inherent: per-task worktrees already isolate the work.

## Scope

Included:

- **Dependency-DAG scheduling** in `wf-address-tasks`: replace wave barriers with per-task readiness — a task starts the moment its specific prerequisites succeed (the structural `base`->`branch` derivation already in the script), and each task's implement -> review -> fix cycle, delivery, and worktree reclaim run as one end-to-end pipeline.
- **Incremental collision guard**: when a task's cycle passes, run it through a single serialized guard step (first-ready-wins) before delivery. This composes the same-number guard of 027, which owns the comparison set and defines it in one place, pipelined members included. Do **not** enumerate that set here as the set, not even parenthetically: every partial restatement so far has silently dropped a member. Naming individual members while arguing about a specific scenario is fine — what is forbidden is a second list presenting itself as the membership rule. The second claimant of a number always renumbers, and it is never the delivered or reserved side, which removes the "least disruptive side" judgment for the common case.
- **The guard's reservation is what makes serialization real**: clearing the guard claims the number atomically, and the claim is held through delivery. A task that has left the guard but is still in its network-bound push/PR-creation step is neither "already delivered" nor a "currently-ready sibling"; without the reservation a second task clears the guard on the same number and both publish, defeating the serialization entirely. Release is asymmetric because delivery is not atomic: a reservation converts to delivered once the PR exists, and may only be **dropped** when delivery failed with no remote write. If the push landed but PR creation did not, `origin` already carries a branch holding that number while no PR advertises it, so it appears in neither the reservation set nor open PR heads — the reservation must persist for the rest of the run. A session-local reservation cannot outlive the run, so the batch must not simply end holding one: **an orphaned pushed branch with no PR is a terminal-state obligation**, resolved at end of batch by retrying PR creation or deleting the branch, and named explicitly in the batch summary if neither succeeded. Otherwise the collision reappears in the next run, whose guard sees the number on neither the base branch nor any open PR head.
- **Early merges move the base**: when a sibling merges mid-run, later tasks may rebase onto the advanced base via the rebase nugget of 016 before their final review; a clash with an already-merged sibling surfaces as an honest conflict at that rebase, not as an invisible add/add.
- **Publish-as-ready in `address-reviews`**: each entry publishes (push, thread hygiene, summary, pings) the moment its own gate passes; no batch-level publish barrier.
- **Peer throttle integration**: peer invocations use the session-local adaptive throttle of 015 as a global semaphore around the peer step, since pipelining removes the natural wave-boundary pacing.
- **End-of-batch artifacts adapt**: the review-stack construction and batch summary tolerate already-merged members; the summary and the main-checkout cleanliness comparison remain the only true end-of-batch barriers. Both fire once every entry has reached **any** terminal state — delivered, blocked, failed, or merged-during-run — per 017; pipelining removes the wave boundary but must not turn the cleanliness assertion into something only a delivery can trigger.
- Storage throttling simplifies: deliver-then-reclaim per task bounds live worktrees continuously, replacing the wave-boundary `df` re-probe with a concurrency cap derived from the same measurement.

Out of scope:

- The review-cycle extraction (014) and rebase default (016) — prerequisites this task composes, not redefines.
- Cross-container coordination of any kind.

## Context and references

- `plugins/dev-skills/workflows/wf-address-tasks.js` — the wave loop, `slugByBranch` structural gating, collision scan/resolve stages, and storage throttling to be restructured.
- `plugins/dev-skills/skills/{address-tasks,address-reviews}/SKILL.md` — the prose counterparts; keep their orchestration descriptions in step.
- Prerequisites — implement first: 012 (it brings `wf-address-tasks.js` into this repo, so there is nothing to restructure before it lands), 014, 015, 016, 027, and the block-content tasks 019 and 025 (033 relies on 025's no-latched-flags/final-state rule directly).

## Target files or areas

- `plugins/dev-skills/workflows/wf-address-tasks.js` (primary), the two prose batch skills (`address-tasks`, `address-reviews`), Codex mirrors. `wf-address-review.js` stays untouched — it is the single-PR workflow; publish-as-ready for batches lives in the prose `address-reviews` orchestration (a future batch front-end workflow would inherit it from there).

## Implementation notes

- The serialized guard step is the one new synchronization point; keep it cheap (ref-only diffs, no worktree entry) so it never becomes the new barrier.
- A blocked collision (imperative shared name) holds only the branches involved; the pipeline must keep flowing around them.
- Mid-run rebases interact with the no-latched-flags rule of 025: a task's result describes its final state after any rebase, with history in the artifact dir.

## Acceptance criteria

- A batch with one slow task delivers every fast task's PR without waiting for the slow one; a dependent task starts as soon as its specific prerequisite delivers.
- The incremental guard catches an add/add clash between a ready task and an already-delivered one, renaming the side that is neither delivered nor reserved, and catches it equally against a task still in flight through delivery on a number it reserved — including one whose push landed before its PR creation failed.
- `address-reviews` publishes each entry on its own gate; no entry waits on a sibling.
- Batch summary correctly reports mixed terminal states including merged-during-run, and every orphaned pushed branch is acted on before the batch ends — PR creation retried, or the branch deleted — with any that survives both attempts named in the summary alongside the task number it still holds, so the next run can reclaim it.

## Validation

- A three-task batch (one artificially slow, one dependent) run end to end: observe early PR creation, dependent start on prerequisite delivery, and a correct final summary.

## Review plan

Reviewer checks the guard's serialization cannot deadlock with held branches, that first-ready-wins never renames a delivered branch, that a number reserved by a task still mid-delivery is visible to the next task entering the guard and is not released while a pushed branch still holds it, that the comparison set is defined only in 027 and referenced here rather than re-enumerated as a second membership rule, that a branch pushed without its PR cannot survive the batch unreported, and that removing the wave barriers did not remove the dependency gate itself.
