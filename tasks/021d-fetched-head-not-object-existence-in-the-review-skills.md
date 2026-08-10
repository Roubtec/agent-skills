# 021d — Read the PR head from the fetch, not from an object-existence test, in the review-addressing skills

## Why this task exists

Both review-addressing skills fetch the PR's exact head ref and then guard against the head having moved since `gh pr view` reported it — and both guard with the wrong probe. `plugins/dev-skills/skills/address-review/SKILL.md`, in "Step 1 — Resolve and verify the PR" under "Reconcile the working location's branch with the PR head before triaging anything", says to "confirm the recorded commit is a local object (`git cat-file -e <headRefOid>^{commit}`)" and to re-read the PR head only when that fails. `plugins/dev-skills/skills/address-reviews/SKILL.md` states the same check in its canonical worktree-entry path, the paragraph beginning "The canonical path. Resolve the PR, then prefer a same-named local branch if you have one", before creating the entry's branch at the recorded OID.

Object existence cannot answer the question either one is asking. The check is written for a force-push landing in the window, which leaves the recorded OID undownloaded — but the far more ordinary movement is an advance, and there the recorded OID is still reachable from the local checkout (in `address-review` it is typically an ancestor of `HEAD`; in `address-reviews` it came in with the same fetch). `git cat-file -e` therefore succeeds and the run proceeds against a stale head. In `address-review` that stale head goes straight into the reconciliation: the first probe finds nothing unrepresented, the run reports work-as-it-stands, and it addresses review on a checkout that is in fact strictly behind — precisely the defect task 021b's rule exists to stop, arriving through the rule's own front door. With items to address, the cost is a whole fix-and-review cycle before publication notices the moved head; with none, the run reports a clean no-op that was not one.

PR #67 fixed this in `plugins/dev-skills/workflows/wf-address-review.js`, whose gather brief now takes the comparison head from `git rev-parse FETCH_HEAD` — what the fetch actually brought — and records it as `pr.headOid` when it differs from what was read earlier. The skills were left as they are because 021b scoped itself to rendering the settled rule for the workflow, not to editing the rule; this task carries the same correction back to the skill side, where the wording differs enough per skill that it is not a copy-paste.

## Scope

Included:

- Replace the object-existence check in `address-review`'s reconciliation paragraph with a comparison of what the fetch brought against the recorded `headRefOid`, and reconcile against the fetched OID. Keep the force-push case working: an undownloaded recorded OID is still a head that moved, and the fetched OID answers that case as well as the advance case, so the fix should delete the extra step rather than add one beside it.
- Apply the same correction to `address-reviews`'s canonical worktree-entry path, where the recorded OID names the commit an entry's branch is created at. Decide there whether "the head moved" means adopt the fetched OID as the entry's head (the skill's existing instruction, "re-read the PR head, record the refreshed OID as this entry's head, and continue from it") or something else; the skip-and-record fallback for a head that keeps moving stays.
- Mirror both changes into `codex/dev-skills/skills/address-review/SKILL.md` and `codex/dev-skills/skills/address-reviews/SKILL.md` in the same PR — the flavors diverge deliberately elsewhere, but this sentence is shared text and no generator keeps them in step.

Out of scope:

- Re-litigating the reconciliation rule itself (its probes, its three outcomes, its no-work-lost heuristic). Only where the head it compares against comes from is in question.
- `wf-address-review.js`, already fixed in PR #67 and covered by `scripts/test-address-review-reconcile.mjs`.
- The off-shoot publication hazard, which is task 021c.

## Context and references

- `plugins/dev-skills/workflows/wf-address-review.js` — the gather brief's reconciliation paragraph (the one instructing `git rev-parse FETCH_HEAD`), which is the shape to carry across.
- `scripts/test-address-review-reconcile.mjs` — the check named "and takes their `R` from the fetched ref, not from an existence test on the recorded OID", which pins the workflow side.
- PR #67 thread `PRRT_kwDOTNFS7M6Xj00y` — the review finding this task comes from, raised against the workflow and disposed there; the skills were deferred to here.
- Task 021b — the rule the workflow renders; task 021c — the other 021b follow-up, on publication rather than on the head being compared.

## Target files or areas

- `plugins/dev-skills/skills/address-review/SKILL.md`
- `plugins/dev-skills/skills/address-reviews/SKILL.md`
- `codex/dev-skills/skills/address-review/SKILL.md` (mirror)
- `codex/dev-skills/skills/address-reviews/SKILL.md` (mirror)
- `scripts/test-address-review-reconcile.mjs` — the regression pin for the four skill paragraphs, beside the workflow-side check it already carries

## Implementation notes

- Prefer deleting the existence check to keeping it beside a comparison: the fetched OID is a local object by construction, so a second probe on it re-states what the fetch already established.
- Name what the fetch is read with, so the instruction is executable rather than a principle — the workflow uses `git rev-parse FETCH_HEAD` after fetching the exact head ref.
- The two skills' paragraphs read differently and serve different next steps (reconcile a checked-out branch vs. create an entry's branch). Rewrite each in its own terms rather than pasting one into the other.

## Acceptance criteria

- Neither skill treats the recorded OID's presence in the local object store as evidence that the head did not move.
- Both take the head they act on from what the fetch brought, and record it where the rest of the skill consumes it (`address-review`'s reconciliation and lease, `address-reviews`'s entry head).
- A force-pushed head that left the recorded OID undownloaded is still handled, and `address-reviews`'s skip-and-record fallback for a head that keeps moving is unchanged.
- The two Codex mirrors carry the identical correction; the count of deliberate divergences between each pair is unchanged.

## Validation

- Walk both cases against the delivered text: a head advanced by a push (recorded OID still reachable locally) and a head force-pushed away (recorded OID absent). Both must reach the same "the head moved" handling.
- `scripts/test-address-review-reconcile.mjs` pins this rule on the workflow side only, and its brief-reading check does not read SKILL.md. Skill prose is pinnable all the same — `scripts/test-review-cycle-retirement.mjs` and `scripts/test-subagent-destroy-boundary.mjs` both read `SKILL.md` files — so extend that suite to read the rule out of the paragraph that states it in both skills and both mirrors: the fetched-head read present in each of the four, and `git cat-file -e` absent from all of them. The deleted probe is the shape a later edit re-imports as a safety check, and nothing else would notice.

## Review plan

Reviewer confirms the existence check is gone rather than supplemented, that the force-push case is still covered, that each skill's paragraph was rewritten in its own terms, and that both Codex mirrors moved with them.
