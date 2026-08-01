# 027a — wf-address-tasks: re-verify collisions after resolution instead of trusting the resolver's packet

## Why this task exists

The pre-PR collision guard added in 027 discovers add/add clashes with a read-only scan (`collisionScanPrompt`, `COLLISION_SCHEMA`), holds every involved branch, and then hands the whole set to one deputy resolver agent. The guard's decision about whether a clash is actually gone is taken entirely from that resolver's own report: `changedBranches` per resolution feeds `changedBranchesByCollision`, and `remainingForCollision` declares a collision resolved as soon as at most one involved branch still carries the original colliding value.

Nothing re-checks the tree. A resolver that reports a rename it only partly applied — renaming the file but leaving the duplicate exported symbol, or renaming on one branch and forgetting the regenerated mirror — is believed. The clash then counts as resolved, the changed branch goes to a fresh `reviewPrompt(task)` re-review that is the ordinary per-task review and carries no cross-branch collision context, and the unchanged side delivers through the `related.every(collisionResolved)` arm with no review at all. Both branches can therefore open PRs with the original conflict intact, which is precisely the outcome the guard exists to prevent.

This is the failure mode the guard's own comments already worry about in the adjacent case: the code deliberately refuses to credit a mis-echoed collision name because "holding a real conflict beats shipping a wrong delivery". The same bias should apply to a mis-reported rename, and today it does not.

Raised as a P2 by the codex reviewer on PR #31 (`plugins/dev-skills/workflows/wf-address-tasks.js`, the resolution-indexing block around the `changedBranchesByCollision` build). It was not fixed in that PR: PR #31 adds the `prune-branches` skill, and after its rebase onto main the workflow file is no longer part of its diff. The guard's *design* is 027's, but the code itself reached main with the workflow adoption in PR #27 (commit `28ab922`), already carrying this implementation; PR #30, which delivered 027, changed only `SKILL.md` files. This task is filed under 027 because that is where the semantics belong.

## Scope

Included:

- Re-establish the collision facts from the actual refs after the resolver returns and before any held branch is added to `deliverable`. Re-running the existing read-only scan over the involved branches is the obvious route, since it is the same evidence the guard already trusts at discovery time; an equivalent targeted re-check of each reported collision across all involved refs is acceptable if it is genuinely exhaustive for that clash.
- Decide delivery from that re-derived state rather than from `changedBranches`. The resolver's packet may still select which branches to re-review and what to report, but it must not by itself be sufficient proof that a clash is gone.
- Keep the existing conservative bias on every degraded path: a re-scan that fails, returns nothing usable, or still shows the clash leaves the involved branches held with an actionable `collision-hold` detail, exactly as the current `no result` and `two or more unchanged branches` arms do.
- Make sure the unchanged side of a supposedly resolved clash is covered too. It currently delivers with no verification at all, so it is the arm that most needs the re-derived state.
- Preserve the 3+ branch semantics 027 established: a clash is resolved only when at most one involved branch still carries the colliding value.

Out of scope:

- The discovery-time scan itself, its schema, or the wave/`widthCap` scheduling around it.
- The resolver agent's rename strategy, its choice of which side to rename, or the `blocked` path for imperative shared names.
- Any change to the per-task implement→review→fix loop or to `deliverTask`.
- The `codex/` tree: the dynamic workflows are Claude-only and have no Codex mirror.

## Context and references

- 027 — the parent task that introduced the cross-branch collision guard.
- `plugins/dev-skills/workflows/wf-address-tasks.js` — `collisionScanPrompt` / `COLLISION_SCHEMA` (discovery), `resolveCollisionsPrompt` / `RESOLUTION_SCHEMA` (resolution), and the `heldTasks` dispatch that builds `changedBranchesByCollision`, `remainingForCollision`, `collisionResolved`, and `collisionStillIncludes`.
- PR #31 review thread: https://github.com/Roubtec/agent-skills/pull/31#discussion_r3693333190

## Target files or areas

- `plugins/dev-skills/workflows/wf-address-tasks.js`

## Implementation notes

- A second scan costs one extra agent per wave that had a collision, and only for waves that actually held branches — the common no-collision wave is unaffected. That is a fair price for the guard's whole premise.
- Scope the re-scan to the branches involved in this wave's collisions rather than the full ready set, so the cost stays proportional to the clash.
- Watch the interaction with the existing re-review: a branch the resolver changed is re-reviewed by `reviewPrompt(task)`, which is not collision-aware. Either feed the re-derived collision state into that prompt or keep the two checks separate and require both to pass; do not let a passing generic review stand in for collision proof.
- A resolver that renames a symbol without regenerating a derived mirror is the concrete case to keep in mind, because this repo's own skills ship as paired mirrors.

## Acceptance criteria

- No branch reaches `deliverable` out of a held collision without the clash having been re-verified against the refs after resolution.
- A resolver that reports `renamed` with `changedBranches` set, while the clash is still present in the tree, results in the involved branches staying held rather than delivering.
- The unchanged side of a clash reported as resolved is covered by the same re-verification as the changed side.
- A failed or unusable re-scan holds the involved branches with a detail that says what to do next, and never delivers them.
- A wave with no collisions runs exactly as before, with no added agent calls.

## Validation

- Exercise the resolution dispatch with a stubbed resolver packet that claims a rename the tree does not reflect, and confirm the involved branches are held rather than delivered.
- Confirm a genuinely resolved two-branch clash still delivers both sides, and that a 3+ branch clash with only one side renamed still holds the remaining two.
- Confirm a wave with no collisions spawns no extra agents.

## Review plan

Reviewer checks that delivery is gated on re-derived collision state rather than the resolver's self-report, that every degraded path holds rather than delivers, that the unchanged side is no longer trusted implicitly, that the 3+ branch semantics from 027 are intact, and that the added cost falls only on waves that actually collided.
