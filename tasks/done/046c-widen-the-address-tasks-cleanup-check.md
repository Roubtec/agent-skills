# 046c — Widen the address-tasks worktree-removal check to the full six operation markers

## Why

The Cleanup section of `plugins/dev-skills/skills/address-tasks/SKILL.md` and its `codex/dev-skills/skills/address-tasks/SKILL.md` mirror still gate worktree removal on `git status --porcelain` plus "no rebase/merge may be in progress". That is three of the six operation markers the packet hard-check names — `rebase-merge`/`rebase-apply` paths, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG` — and the last three can print empty porcelain, so a tree stopped mid-cherry-pick, mid-revert, or mid-bisect passes the stated check and gets removed with `git worktree remove`, which discards it.

Task 046 fixed the identical gap in the `address-reviews` twin (both flavors). This one was left alone deliberately: the maintainer scoped that widening to `address-reviews`, and 046 stayed inside its locked scope rather than sweeping. The gap is therefore known and booked, not overlooked.

The exposure is bounded by tooling. `wt-remove` — baked into the powbox image, not shipped from this repo — enforces the full set itself and refuses even with `--force`, and both Cleanup bullets already say to prefer it where it is on PATH. So the narrow list binds only the helper-absent fallback: a run off powbox, or on an image predating the helper, that follows the prose literally.

## What to do

- In the Cleanup section of both `address-tasks` files, replace the "no rebase/merge may be in progress" condition with the same six markers the packet hard-check names, and carry the reason in the repo's bounded phrasing — the last three *can* print empty porcelain, rather than always leaving `git status` clean, since a conflicted cherry-pick or revert does show in porcelain.
- Keep the surrounding bullet otherwise intact, including the never-force-remove rule, the `--force`-after-clean-checks carve-out, and the `wt-remove` preference; note in that preference that the helper enforces the full set itself, so the enumerated list is what a helper-absent run falls back to.
- Keep the plugin and codex copies byte-identical in the passage touched, as they are today.

## Acceptance criteria

- Both `address-tasks` Cleanup bullets enumerate all six operation markers, in the same order and wording the `address-reviews` bullets use after task 046.
- The rationale is stated as "can print empty porcelain", matching the packet hard-check's bounded phrasing rather than the absolute one.
- The two flavors' copies of the touched passage are byte-identical.
- Every suite named in `.github/workflows/tests.yml` passes.
