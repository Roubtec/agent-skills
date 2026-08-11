# 018a — Resolve the worktree-base exclude through Git in the review skills

## Why this task exists

`address-reviews`' bootstrap step tells the agent to make the worktree base ignored by listing it in `.git/info/exclude`. That literal path does not exist when the checkout the batch is bootstrapped from is itself a linked worktree — there `.git` is a gitfile rather than a directory, `.git/info` is not a directory at all, and the append fails outright. The protection is then never established, so the nested `git worktree add` leaves `?? .worktrees/` in the very checkout the step promises not to dirty, and a halt — which is precisely what keeps a worktree standing — leaves it there indefinitely. Agent containers run from linked worktrees routinely, so this is the ordinary path rather than a corner.

Task 018 fixed exactly this in `wf-address-review.js`'s gather brief: probe `git check-ignore -q "<repo>/.worktrees/"` with the trailing slash a directory-only rule needs, and where it answers no, append `/.worktrees/` to the file `git rev-parse --git-path info/exclude` names — asked from inside `<repo>`, because in a primary checkout that answer comes back CWD-relative — then re-probe and make a still-no answer a blocker. The skills were left carrying the literal, because the defect is pre-existing on `main` and 018's reviewer correctly scoped it out of that PR.

What makes it worth a task of its own rather than a note: `address-review`'s own "Branch resolution and attach follow `address-reviews` → 'Resolving and checking out each entry' wholesale" paragraph means a single-PR run inherits the broken recipe too, and a batch run reads the broken literal directly. The workflow is fixed and the skills it mirrors are not, which is also a standing invitation for a later round to "reconcile" them in the wrong direction.

## Scope

Included:

- Replace the literal `.git/info/exclude` in the `address-reviews` bootstrap step with the resolved form, matching what `wf-address-review.js`'s gather brief now states: the trailing-slash `check-ignore` probe, the append to the file `git rev-parse --git-path info/exclude` names, that question asked from inside the repository, and a re-probe whose still-no answer is a blocker.
- Apply the same change to the Codex mirror, in lockstep — there is no generator; both files are hand-edited and their divergence count must not move.
- Audit `address-review`'s own steps for any second spelling of the literal, since it inherits the recipe wholesale rather than restating it; fix it there and in its mirror if one is found.
- Keep the reason in the prose: the literal is not merely less portable, it FAILS from a linked worktree, and the trailing slash is what makes the probe honest before the directory exists.

Out of scope:

- `wf-address-review.js`, which task 018 already fixed. This task brings the skills to it, not the other way round.
- Any change to where worktrees are placed, to the `wt-enter`/`wt-remove` helper preferences, or to the arm order — all settled elsewhere.
- Editing the tracked `.gitignore` in place of the repo-local exclude. That file is the maintainer's and the rule is per-clone scaffolding.

## Context and references

- `plugins/dev-skills/skills/address-reviews/SKILL.md` — the bootstrap step beginning "**Prepare the worktree base and prune stale state.**", which carries the literal.
- `codex/dev-skills/skills/address-reviews/SKILL.md` — the same step in the Codex mirror.
- `plugins/dev-skills/skills/address-review/SKILL.md` and its Codex mirror — the paragraph beginning "Branch resolution and attach follow `address-reviews`", which is why the broken literal reaches a single-PR run too.
- `plugins/dev-skills/workflows/wf-address-review.js` — the gather brief's worktree case (arm 4, "Anything else"), which states the corrected recipe to copy from.
- `scripts/test-address-review-reconcile.mjs` — the check named "the worktree base is made ignored before any arm adds under it…", which pins that recipe on the workflow side and is the model for pinning it on the skill side.
- Raised as a nit in PR #71's round-5 review and deferred there rather than bundled.

## Target files or areas

- `plugins/dev-skills/skills/address-reviews/SKILL.md`
- `codex/dev-skills/skills/address-reviews/SKILL.md`
- `plugins/dev-skills/skills/address-review/SKILL.md` (audit; fix if a second spelling is there)
- `codex/dev-skills/skills/address-review/SKILL.md` (mirror, only if the skill changes)

## Implementation notes

- Verify the claim rather than restating it: from a linked worktree, `ls .git/info` answers "Not a directory" while `git rev-parse --git-path info/exclude` resolves to the shared file `check-ignore` actually reads. Do it in a disposable checkout, never in a real one.
- `git rev-parse --git-path info/exclude` prints a RELATIVE path in a primary checkout and an absolute one in a linked worktree, so the instruction must say where the question is asked from; a `git -C <repo>` form whose answer is appended to from another directory writes the rule where nothing reads it.
- Prefer copying the workflow's wording over paraphrasing it. Two spellings of one recipe is the drift this repo keeps paying for.

## Acceptance criteria

- Neither `address-reviews` SKILL.md names `.git/info/exclude` as a path to write; both name the resolved form, the trailing-slash probe, the CWD the question is asked from, and the blocker on a still-no re-probe.
- The `address-review` pair is confirmed either unaffected or fixed, with its mirror in step.
- Mirror divergence for each edited pair is unchanged from its `main` baseline; the edited paragraphs are byte-identical across the two mirrors.
- The workflow's own recipe is untouched.

## Validation

- Run the repository's mirror-parity comparison for every edited pair and show the divergence count is unchanged.
- Run all CI steps and `wf-check`.
- If a skill-side pin is added, negative-control it: break what it pins, confirm it fails by name, restore exactly, confirm green.

## Review plan

Reviewer confirms the linked-worktree failure was reproduced rather than asserted, that both mirrors moved together with unchanged divergence, that the `address-review` audit was performed rather than claimed, and that the workflow's recipe and the tracked `.gitignore` are untouched.
