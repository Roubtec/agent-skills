# 027c — Require distinct reported branches in collision attribution

## Why this task exists

Task 027b made the `wf-address-tasks` discovery partition hold a collision packet that cannot be attributed to at least two reviewed branches, and shared that rule with the post-resolution re-scan through `collisionIsAttributable`.

The delivered predicate counts distinct matching task entries but not distinct branch names in the collision packet.
A single reported string can therefore satisfy the two-task check when it equals one task's branch and another task's slug: for example, task `a` on branch `b` beside task `b` on branch `task/b`, with a malformed collision entry whose entire `branches` array is `["b"]`.
The shipped helper routes both tasks into collision resolution and leaves unrelated tasks deliverable, even though the scan reported only one branch string and therefore violated `COLLISION_SCHEMA`'s two-or-more-branches contract.

This gap was reproduced while reaping task 027b.
The ordinary one-branch regression in `scripts/test-collision-discovery.mjs` does not expose it because its one name matches only one task.

## Scope

Included:

- Make a collision entry usable only when it contains at least two distinct normalized reported branch names as well as matching at least two distinct reviewed tasks.
- Preserve the existing rejection of empty, malformed, foreign, partly attributable, and one-task entries.
- Cover the cross-task branch/slug alias shape at discovery and at the post-resolution re-scan, since both stages deliberately consume the shared attribution predicate.
- Keep qualified local ref canonicalization (`refs/heads/…` and `heads/…`) and all clean/well-formed behavior unchanged.

Out of scope:

- Removing slug aliases from collision attribution generally; the workflow still accepts them where they unambiguously identify the task the scan meant.
- Changing collision resolution, rename strategy, per-task review, or PR delivery beyond refusing an unusable scan packet.
- Adding agent calls to clean waves or to malformed-packet handling.

## Context and references

- Task 027b — introduced the discovery-stage attribution gate and the shared branch-name normalization rule whose remaining hole this task closes.
- Task 027a — introduced the post-resolution re-scan gate that also consumes `collisionIsAttributable`.
- `plugins/dev-skills/workflows/wf-address-tasks.js` — `normalizeBranchName`, `collisionBranchNames`, `collisionInvolvesTask`, `collisionIsAttributable`, `discoverWaveCollisions`, and `settleWaveCollisions`.
- `scripts/test-collision-discovery.mjs` — drives the shipped discovery partition.
- `scripts/test-collision-dispatch.mjs` — drives the shipped post-resolution collision gate.

## Target files or areas

- `plugins/dev-skills/workflows/wf-address-tasks.js`
- `scripts/test-collision-discovery.mjs`
- `scripts/test-collision-dispatch.mjs`

## Implementation notes

- Express the schema invariant in `collisionIsAttributable`: the normalized reported-name set must contain at least two values, independently of the existing check that at least two task entries are involved.
- Count normalized names, so duplicate raw spellings that canonicalize to one ref (for example, `task/a` and `refs/heads/task/a`) still count as one reported branch.
- Keep the distinct-task check too: two different accepted aliases for one task must not make a packet attributable.
- Because the predicate is shared, the same malformed singleton-alias packet must void a post-resolution re-scan rather than becoming usable evidence that clears any branch.

## Acceptance criteria

- A discovery collision entry with `branches: ["b"]` against task `a` on branch `b` and task `b` on branch `task/b` is rejected as attributable to fewer than two reported branches; the whole reviewed wave is held with the existing actionable scan-error detail, and no branch reaches delivery or collision resolution.
- A collision entry whose multiple raw names normalize to one branch is rejected the same way.
- Entries with at least two distinct normalized names but only one matching task remain rejected by the existing distinct-task requirement.
- The post-resolution re-scan treats the same malformed shapes as unusable and holds every affected branch rather than clearing one for delivery.
- Qualified-ref attribution, well-formed clashes, clean waves, agent-call counts, and the conservative foreign-name behavior remain unchanged.

## Validation

- Extend `scripts/test-collision-discovery.mjs` with the cross-task branch/slug alias case and a duplicate-normalized-name case; confirm both hold the whole reviewed wave and dispatch no resolver.
- Extend `scripts/test-collision-dispatch.mjs` with the corresponding malformed re-scan case; confirm the re-scan establishes nothing and no held branch delivers.
- Run `node scripts/test-collision-discovery.mjs` and `node scripts/test-collision-dispatch.mjs`.
- Run `wf-check plugins/dev-skills/workflows/wf-address-tasks.js`.
- Run every suite named in `.github/workflows/tests.yml`.
- Negative-control the new discovery coverage by temporarily restoring the current task-count-only predicate in a disposable clone and confirming the added case fails before trusting the pass.

## Review plan

Reviewer confirms that attribution requires both two distinct normalized reported names and two distinct matched tasks, that the shared predicate keeps discovery and re-scan behavior aligned, and that clean or correctly attributed waves pay no added agent call.
