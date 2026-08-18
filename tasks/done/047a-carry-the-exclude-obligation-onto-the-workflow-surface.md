# 047a — Carry the worktree-base exclude obligation onto the workflow surface

## Why

Task 047 narrowed the skills' bootstrap prose so that preferring `wt-bootstrap` no longer reads as discharging step 1 whole: the helper establishes no ignore rule, and an in-repo base is still the run's to make ignored. That fix landed in four files — the `plugins/` and `codex/` mirrors of `address-tasks` and `address-reviews`.

It did not reach the workflow surface, and the review of 047 found that surface asserting the opposite. In `plugins/dev-skills/workflows/wf-address-tasks.js`, the bootstrap prompt builder tells its subagent that running the helper "performs the whole Session Bootstrap deterministically" and then enumerates what it does — container-local root verification, orphan pruning, the remote rewrite, the push probe, one JSON object. No ignore rule appears in that list, because the helper does not establish one.

The workflow surface is worse off than the skill surface was, for two reasons measured on the file as of task 047's delivery:

- `wf-address-tasks.js` contains **no** occurrence of `check-ignore` or `info/exclude` anywhere. The skills at least stated the probe/append/re-probe recipe in the by-hand branch; this file never states it at all, so there is nothing for a run to fall back to.
- The helper-absent branch does not fall back either. It instructs the subagent to return `ok: false` with an "image predates the wt-* helpers" blocker, and closes with "Do not re-derive the checks by hand." So the ignore rule is established in no configuration: helper present, and the run is told the bootstrap is complete; helper absent, and the run is told to stop rather than perform it.

The sibling workflow `wf-address-review.js` does carry the recipe, so the asymmetry between the two is now visible and is the cheapest evidence that this is an omission rather than a deliberate divergence.

The reachable case is the one task 047 identified and is unchanged by this task: an **unprepared** repository where `wt-bootstrap` nonetheless reports `ok` — self-hosted (`--isolated`) mode, where the worktree roots are plain subdirectories of the single workspace volume rather than separate mounts. There the batch dirties the shared main checkout for as long as its worktrees live. The batch's closing main-checkout cleanliness report surfaces the resulting `?? .worktrees/` after the fact, which is why this is booked rather than treated as a blocker on 047.

This is queued rather than deferred: it has no unmet prerequisite, and 047 landing is what makes the target wording already written down.

## What to do

- In `wf-address-tasks.js`, carry the one clause 047 added into the bootstrap prompt builder — the helper establishes no ignore rule, so an in-repo base is still the run's to make ignored — and give that surface a way to discharge it. Decide during implementation whether the recipe is stated there or the prompt points at the skill that states it; the constraint is that a run reaching the end of the bootstrap step has either established the rule or been stopped by the blocker, and today it does neither.
- Settle what the helper-absent branch should do. Its current "return `ok: false` … do not re-derive the checks by hand" is a deliberate choice about the `wt-*` helpers being image-baked and unshippable from this repository, and task 046b's boundary keeps such fallbacks reachable rather than retiring them. Changing it is in scope; changing it *silently* is not.
- Keep the recipe stated once per surface. Task 047's suite exists to prevent a second spelling, and `scripts/test-skill-worktree-base-exclude.mjs` already counts occurrences file-wide on the skill files.
- Consider pinning the workflow clause in that same suite, beside the `PREFERENCE` block 047 added, so the two surfaces cannot drift apart again.

## Context and references

- Task 047 is the prerequisite and the model: it authors the clause, the placement rule (put the obligation where a helper-preferring run meets it, not only in the by-hand branch it skipped), and the suite's `PREFERENCE` pins. Implement against that wording rather than inventing a second one.
- Task 018a repaired the probe/append/re-probe recipe itself, and is why the recipe must be resolved through `git rev-parse --git-path info/exclude` rather than a literal `.git/info/exclude`.
- Task 046b bounds what may be retired: `wt-bootstrap` is baked into the powbox image and is not shipped from this repository, so its no-helper fallbacks stay reachable.
- `wf-address-review.js` already states the recipe and is the reference for how much detail this surface needs.

## Target files or areas

- `plugins/dev-skills/workflows/wf-address-tasks.js` — the bootstrap prompt builder, and the schema field descriptions that carry the bootstrap contract.
- `scripts/test-skill-worktree-base-exclude.mjs` — the `PREFERENCE` block, if the clause is pinned.

## Acceptance criteria

- A run following `wf-address-tasks.js`'s bootstrap step either establishes the ignore rule for an in-repo base or stops on a blocker; it can no longer complete the step having done neither.
- The workflow no longer claims the helper performs the whole Session Bootstrap, in prompt literals or schema field descriptions.
- The probe/append/re-probe recipe is stated at most once on this surface, and no second spelling is introduced on the skill surface.
- Whatever is decided for the helper-absent branch is recorded in the task or the commit message, per 046b's boundary on image-baked helper fallbacks.
- Every suite named in `.github/workflows/tests.yml` passes, and `wf-check` passes on the edited workflow.

## Review plan

Reviewer confirms the clause is reachable by a run that *prefers* the helper rather than sitting only in a branch it skips; that the two surfaces now agree and the skill surface was not disturbed; that no second spelling of the recipe was introduced on either; and that any change to the helper-absent branch is stated rather than silent. It treats a restored "performs the whole Session Bootstrap" as a regression.
