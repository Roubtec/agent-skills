# 021c — Guard publication from an off-shoot that does not carry the PR head

## Why this task exists

Task 021b gave `wf-address-review` the no-work-lost branch reconciliation and, deliberately, gated it on the checked-out branch being the PR's head ref. Where the two names differ the supported local off-shoot of a merge-pending PR is in play, "behind the PR head" is that case's normal state, and reconciliation is skipped whole. That decision is settled and this task does not reopen it.

Nothing else covers the off-shoot on the way out. Publication in `wf-address-review.js` is prose in `publishPrompt`, whose step 2 establishes which of THREE cases the push is in: `HEAD` a proper ancestor of the expected tip (stop, nothing to publish — 021b added this one), the expected tip an ancestor of `HEAD` (normal push), and otherwise an exact `--force-with-lease` against the recorded head OID. On the off-shoot path the third case is reachable in an ordinary situation: an off-shoot cut before the current PR head and then advanced with its own commits is neither an ancestor nor a descendant of the recorded head, so it falls to the lease — and the lease MATCHES, because the recorded OID is exactly what the remote still points at. The push succeeds and rewinds the PR branch over every commit between the cut point and the recorded head. Those commits were never in the off-shoot, so nothing in the run ever saw them.

This is the same work-loss shape PR #29 closed for the skill's own branch, arriving by the one route reconciliation deliberately does not watch. The lease is doing exactly its job — it protects against the remote moving *since* the run started, not against a local tip that never contained what the remote already had.

The same question is open for the singular skill, whose `PR#` argument names the off-shoot case explicitly and whose Step 7 "Push" has the same three-way shape; it must be checked rather than assumed unaffected. Task 018 changes where each flavor works but not what it pushes, so it neither fixes nor blocks this.

## Scope

Included:

- Decide and render the publication rule for a run whose checked-out branch is not the PR's head ref: before any lease, establish that the expected tip is REPRESENTED in what is being pushed, and stop with `published: false` and an explicit reason when it is not — the shape the proper-ancestor case and the rejected lease already use.
- Check `plugins/dev-skills/skills/address-review/SKILL.md`'s publish step for the same exposure before assuming it does not have it, and fix it there too if it does. The Codex mirror moves in step with any skill change.
- Say in the workflow's off-shoot prose that skipping reconciliation is not a promise that the off-shoot may publish over the head — the two decisions are separate, and 021b's gate comment should not be readable as covering this.

Out of scope:

- Re-litigating 021b's gate. Reconciliation stays keyed on the branch names, and the off-shoot keeps working on a tip behind the PR head; the question here is only what may be PUSHED from it.
- Fast-forwarding, merging, or otherwise reconciling the off-shoot. It exists to be a branch of its own; a run that cannot publish safely reports that and stops.
- Teaching the run to recover a mixed state. As with the reconciliation rule, an unrecognised situation goes back to the maintainer rather than being guessed at.

## Context and references

- `plugins/dev-skills/workflows/wf-address-review.js` — `publishPrompt`, step 2's three push cases and the expected-tip OID they interpolate; `PACKET_SCHEMA`'s `pr.workingBranch` field, whose description states the off-shoot case; and the reconciliation gate whose comment names the same exemption.
- `plugins/dev-skills/skills/address-review/SKILL.md` — the `PR#` argument row naming the off-shoot, "Step 1 — Resolve and verify the PR" (its "Reconcile the local branch with the PR head before triaging anything" paragraph), and "Step 7 — Publish after the review gate", item 2 "Push".
- Task 021b — the reconciliation this sits beside, and the settled decision that it skips entirely where the branch names differ.
- PR #29 thread `PRRT_kwDOTNFS7M6VaOv1` — the maintainer's no-work-lost heuristic the reconciliation rule encodes; this task applies the same heuristic to the push rather than to the checkout.

## Target files or areas

- `plugins/dev-skills/workflows/wf-address-review.js`
- `plugins/dev-skills/skills/address-review/SKILL.md` (audit; fix if the exposure is there)
- `codex/dev-skills/skills/address-review/SKILL.md` (mirror, only if the skill changes)

## Implementation notes

- The representation probe the reconciliation already states (`git rev-list --right-only --cherry-pick H...R`, patch-id rather than raw ancestry) answers this question too, and reusing it keeps one idea in the file instead of two. Prefer that over a new classifier: this needs a yes/no, not a taxonomy of branch states.
- The proper-ancestor case 021b added is the model for the stop — same result shape, same "never escalate to bare `--force`" discipline, a reason naming what was seen.
- Whatever is decided must not fire on the ordinary off-shoot that DOES carry the head (cut from it, or rebased onto it), which publishes correctly today.

## Acceptance criteria

- An off-shoot missing commits the recorded PR head carries never reaches a lease push; the run stops with `published: false` and a reason naming both tips.
- An off-shoot that carries the recorded head still publishes exactly as it does today.
- The proper-ancestor stop and the rejected-lease stop are unchanged.
- 021b's reconciliation gate is unchanged: still keyed on the branch names, still skipped whole on the off-shoot path.
- The skill is confirmed either unaffected or fixed, with its Codex mirror in step.

## Validation

- Extend `scripts/test-address-review-reconcile.mjs`, which already renders `publishPrompt` and asserts the proper-ancestor stop precedes the lease, with the off-shoot case; its expected-check count is the assertion that the new scenario runs.
- Rebuild the scratch-repository construction 021b used: a two-commit remote head, an off-shoot cut before it and advanced with its own commit, and the probes run against that pair.

## Review plan

Reviewer confirms the off-shoot still publishes when it carries the head, that the new stop names what it saw rather than guessing, that 021b's gate and the two existing stops are untouched, and that the skill audit was performed rather than asserted.
