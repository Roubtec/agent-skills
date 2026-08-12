# 027b — wf-address-tasks: a discovery-scan collision it cannot attribute must hold, not deliver

## Why this task exists

The pre-PR collision guard added in 027 discovers add/add clashes with a read-only scan (`collisionScanPrompt`, `COLLISION_SCHEMA`) and then partitions the wave's reviewed branches on `heldBranches.has(task.branch) || heldBranches.has(task.slug)`, where `heldBranches` is built by flattening `collisionBranchNames` over the scan's entries.

`collisionBranchNames` normalizes each name through `normalizeBranchName`, which strips surrounding shell quote characters and nothing else — it does not canonicalize a fully-qualified ref. So a scan entry that echoes `refs/heads/task/a` rather than `task/a` matches no reviewed branch: `heldBranches` is non-empty, `heldTasks` is empty, `settleWaveCollisions` returns on its own `heldTasks.length` guard, and both sides of a live clash fall through to `deliverable` and open PRs. The resolution stage is never reached at all, so none of the re-verification 027a added applies.

The schema's "two or more branches" contract has the same gap one step earlier: an entry naming only one of the wave's reviewed branches holds that branch and lets its counterpart deliver carrying the colliding value.

027a closed both shapes at the *post-resolution re-scan* — `settleWaveCollisions` now reads a re-scan packet as usable only when every entry is attributable to at least two held branches — but its Scope explicitly excludes the discovery scan, so the same hole is still open at the stage that decides whether the guard runs at all. With the re-scan gate tightened, this is the one remaining route by which a known live clash reaches a PR.

Raised by the fresh reviewer on 027a's round 2 as an explicitly out-of-scope observation, recorded here rather than fixed there.

## Scope

Included:

- Decide the discovery partition from names actually attributable to the wave's reviewed branches, rather than from whatever strings the scan echoed.
- Treat an entry naming fewer than two of the wave's reviewed branches as a scan that established nothing, matching `COLLISION_SCHEMA`'s own "the two or more branches that each independently added it" contract, rather than as a clash that affects nobody.
- Hold on that finding with the guard's existing conservative bias and an actionable detail, the way the `scanError` arm already holds everything the scan covered when the scan itself fails.
- Keep the cost where it is: a wave whose scan comes back clean must behave exactly as today, with no added agent calls.

Out of scope:

- The post-resolution re-scan gate and the rest of `settleWaveCollisions` — 027a's territory. This task may tighten what reaches that stage; it must not loosen the stage itself.
- The resolver agent's rename strategy, its choice of which side to rename, or the `blocked` path for imperative shared names.
- Any change to the per-task implement→review→fix loop or to `deliverTask`.
- The `codex/` tree: the dynamic workflows are Claude-only and have no Codex mirror.

## Context and references

- 027 — the parent task that introduced the cross-branch collision guard.
- 027a — closed this same attribution hole at the post-resolution re-scan; its `attributableBranches` predicate inside `settleWaveCollisions` is the shape to mirror, and its comment there states the reasoning.
- `plugins/dev-skills/workflows/wf-address-tasks.js` — `collisionScanPrompt` / `COLLISION_SCHEMA` (discovery), `normalizeBranchName` / `collisionBranchNames` (attribution), and the wave body's `heldBranches` / `scanError` partition that runs just ahead of the `settleWaveCollisions` call.

## Target files or areas

- `plugins/dev-skills/workflows/wf-address-tasks.js`
- `scripts/test-collision-dispatch.mjs`, or a sibling suite: the existing one drives `settleWaveCollisions` directly and does not exercise the wave body's partition, so covering this needs a driver over that partition rather than another scenario in the current harness.

## Implementation notes

- The complexity-deleting fix is one shared attribution rule, not a second matcher: canonicalizing a `refs/heads/` (and bare `heads/`) prefix inside `normalizeBranchName` or `collisionBranchNames` covers the discovery site and the re-scan at once, since both read branch names through the same helper.
- That shared reach cuts both ways, and it is the thing to decide before writing the change rather than after. `settleWaveCollisions`'s `involves` reads names through the same helper, so canonicalizing there also makes 027a's post-resolution gate ATTRIBUTE re-scan packets it currently voids: an entry echoing `refs/heads/task/a` and `refs/heads/task/b` fails that gate's "fewer than two held branches" test today and holds everything the scan covered, and canonicalized it becomes usable evidence — which a packet's other entries could then use to clear a branch. Attributing a name properly plausibly beats voiding a packet over its spelling, but that is a change to 027a's gate rather than to what reaches it, so make it deliberately and say so in the PR instead of letting it arrive as a side effect of a helper edit. Declining it means canonicalizing at the discovery partition only and accepting the duplicated matcher the note above argues against — a real trade, not a non-choice. The concrete tell either way is `scripts/test-collision-dispatch.mjs`'s "re-scan entry names branches in an unmatched form" case, which asserts exactly the voiding a shared canonicalization removes.
- Three rounds on 027a established that a per-site special case is what keeps regrowing here. Prefer a predicate that expresses the invariant — an entry is usable only when it names two or more branches this stage can attribute — over an arm added per observed shape.
- Weigh whether an entry the partition cannot attribute should hold the whole wave, as the existing scan-failure path does, or only the branches it can name. The guard's own stated bias is that holding a real conflict beats shipping a wrong delivery.
- A discovery scan that reports nothing is already the ordinary clean-wave path and must stay one; only a *reported* clash that cannot be attributed is the new hold.

## Acceptance criteria

- A discovery scan whose entry names branches in a form the partition cannot match never lets both sides deliver; the branches the scan covered are held with a detail that says what to do next.
- A discovery entry naming fewer than two of the wave's reviewed branches is answered the same way.
- A well-formed clash still partitions into `heldTasks` exactly as today and reaches `settleWaveCollisions` unchanged.
- A wave whose scan reports no collisions runs exactly as before, with no added agent calls.
- 027a's re-scan gate is left unchanged or strictly tighter, and is never loosened by accident. The one admissible exception is the shared-helper reach under Implementation notes: if canonicalizing branch names makes that gate attribute re-scan packets it currently voids, that is a decision to take and state in the PR, and to re-decide `scripts/test-collision-dispatch.mjs`'s unmatched-form case against — never an assertion to relax so the suite keeps passing.

## Validation

- Drive the wave partition with a scripted scan packet echoing `refs/heads/<branch>` and confirm no branch reaches `deliverable`.
- Repeat with an entry naming a single reviewed branch, and confirm its counterpart does not deliver.
- Confirm a well-formed clash still routes to the resolution dispatch, and that `node scripts/test-collision-dispatch.mjs` still passes.
- Negative-control whatever check is added: break the fix deliberately and confirm the new coverage fails before believing its pass.

## Review plan

Reviewer checks that a discovery entry the guard cannot attribute holds rather than delivers, that the attribution rule is shared with the re-scan rather than duplicated per site, that a well-formed clash is routed exactly as before, that the added cost falls only on waves that actually reported a clash, and that 027a's re-scan gate is not loosened on the way past — other than by the shared-helper reach this task calls out, which the PR must show was decided rather than inherited.
