# 016a — Give `wf-address-review` the skill's zero-item path instead of one terminal no-op

## Why this task exists

`address-review` step 3 distinguishes two things the workflow does not. A run with no unresolved threads and no included standalone item is a **terminal no-op** only when `HEAD == starting tip == recorded headRefOid`; every other zero-item case — a local tip already ahead of the PR head, an unpublished commit from an earlier run, a rebase that moved the tip — takes the **zero-item path**, which continues through the normal fresh review and, unless `no-push`, through publication. The skill spells out why: that tip has work on it that the PR does not, and reporting "nothing to address" leaves it unreviewed and unpushed.

`wf-address-review.js` collapses both into one exit. Its empty-`items` return (the `no-op` status, just after the branch-reconciliation gate) fires on the item count alone, so an ahead-but-unpushed local tip is reported as "nothing to address — nothing was pushed", which is the same sentence a genuinely clean PR gets and is indistinguishable from it in the result.

The divergence predates task 016, which is why 016 left it alone: 016's reviewers split over whether that exit may sit ahead of the run's first rebase point, and both agreed the exit itself is the thing to fix rather than the rebase's position. The peer reviewer's argument is the sharpest statement of the cost: a branch with no feedback but an advanced base is not necessarily a rebase no-op, so the case the workflow reports as "nothing to do" can be a case with real work in it — and once the exit is fixed, the rebase points sit on a path that reviews and publishes what they rewrite, which is what makes rebasing there safe.

## Scope

Included:

- **Split the workflow's empty-`items` exit into the skill's two outcomes.** Terminal no-op only where the gather reports `HEAD`, the tip the run started from, and the PR's recorded `headRefOid` are all the same commit; anything else continues. That needs the gather packet to carry the two tips it does not carry today (its starting tip and its final `HEAD`), which is a schema plus brief change, not a control-flow trick.
- **Run the zero-item path through the pipeline it already has.** The nested cycle, the pre-push rebase point, and publication all accept an empty item set; what has to be true is that a zero-item run makes no synthetic commit, posts no per-thread reply or resolve (there are none), and still posts its summary and pings only under the existing rules. Decide explicitly whether a zero-item publication posts a Summary comment at all, and record the answer — the skill says a terminal no-op makes none, and is silent on the zero-item path.
- **Then reconsider the rebase points' position on that path**, which is what 016 deferred: with the zero-item path reviewing and publishing what it rewrites, the first point can run before the exit decision without the objection 016 recorded, and 016's amended Scope note is the text to update if it does.
- **Cover it in `scripts/test-address-review-reconcile.mjs`**, whose harness already drives scripted gather packets and scripted cycle results through the shipped script.

Out of scope: the prose skills' own zero-item wording, which is settled; and any change to what a *terminal* no-op does.

## Context and references

- Task 016 — the amended "Two rebase points" Scope bullet records the split reviewers and points here.
- `address-review` step 3 (the paragraph beginning "If there are no unresolved threads and no explicitly included standalone items") — the authority for the two outcomes, in both mirrors.
- `address-reviews` → "Phase A — initial fix" — the batch's version of the same distinction, already implemented as the terminal zero-feedback shortcut with its exact three-way tip comparison; the workflow's version should read the same way rather than inventing a second rule.

## Target files or areas

- `plugins/dev-skills/workflows/wf-address-review.js` — `PACKET_SCHEMA`, the gather brief's zero-item paragraph, and the empty-`items` return.
- `scripts/test-address-review-reconcile.mjs`.

## Acceptance criteria

- A zero-item run whose three tips agree exits as a terminal no-op, unchanged from today.
- A zero-item run whose local tip is ahead of the recorded PR head reaches the review cycle and, on a push run, publication — and its result says which of the two outcomes it took and why.
- The suite drives both, and a negative control confirms the discriminating comparison is what decides it.

## Review plan

Reviewer checks that the tip comparison is the skill's three-way one rather than a paraphrase, that a zero-item publication cannot post a reply or resolve for an item that does not exist, and that the terminal no-op still reclaims its worktree exactly as it does today.
