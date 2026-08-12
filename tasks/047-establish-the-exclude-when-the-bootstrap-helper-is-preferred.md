# 047 — Establish the worktree-base exclude on the path that prefers `wt-bootstrap`

## Why

Both bootstrap steps tell a run to prefer the baked `wt-bootstrap` helper over performing the steps by hand: `plugins/dev-skills/skills/address-tasks/SKILL.md`'s "Session Bootstrap" closes with "If a `wt-bootstrap` helper is on PATH, prefer it for steps 1–4 — it performs those worktree checks, prunes orphans, and prints the base dir (`wtBase`) and free space (`availBytes`) as JSON. It covers those and nothing else", and `plugins/dev-skills/skills/address-reviews/SKILL.md`'s "Prepare the worktree base and prune stale state" step ends with "If a `wt-bootstrap` helper is on PATH, prefer it — it performs these checks and prints the base dir as JSON." Both statements are mirrored in `codex/dev-skills/skills/`.

Step 1 of each is not one check but two things: choosing the base, and *making that base ignored* — the probe/append/re-probe recipe task 018a repaired, whose blocker exists because `git worktree add` excludes nothing on its own and an unignored in-repo base leaves `?? .worktrees/` in the very main checkout the mode promises not to dirty.

`wt-bootstrap` does not do the second half. The helper baked into the powbox image mentions neither `info/exclude` nor `check-ignore` anywhere; it verifies the worktree roots are container-local, reaps this container's orphans, probes push access, and reports storage headroom. So a run that follows the prose literally — sees the helper on PATH, prefers it for step 1, takes its `wtBase` — never establishes the ignore rule and never reaches the blocker that was supposed to stop it. "It covers those and nothing else" reads as though the helper's coverage of step 1 is total, which for the ignore half it is not.

The exposure is narrower than it first looks, and that is why this is booked rather than swept into PR #80 (`https://github.com/Roubtec/agent-skills/pull/80`, where the review of the base-constraint fix surfaced it). Two things usually mask it:

- A repository prepared by the `enable-worktrees` skill already ignores `.worktrees/` in its tracked `.gitignore`, so the probe answers yes and the recipe is a no-op. This repository is such a case.
- In dir-mounted mode `wt-bootstrap` fails closed when a worktree root is not a mountpoint, and that failure is a blocker naming `enable-worktrees` as the remedy — so an unprepared dir-mounted repo does not reach a silent unignored base.

What is left is a genuine reachable case: an **unprepared** repository where `wt-bootstrap` nonetheless reports `ok` — self-hosted (`--isolated`) mode, where the worktree roots are plain subdirectories of the single workspace volume rather than separate mounts. There the helper succeeds, the ignore rule is never written, and the batch dirties the shared main checkout for as long as its worktrees live.

## What to do

Settle first **which side owes the fix**, because the honest answer may not be in this repository:

- `wt-bootstrap` is baked into the powbox image and is not shipped from here, so changing it is a powbox task, not one these skills can perform. If the helper should establish the rule (it already writes container-local Git configuration, so this is within what it does), the skills' prose is correct as written and this task closes as a pointer to that work.
- If the helper is to stay as it is, the skills must stop implying it covers the ignore half.

Assuming the second: in **both** bootstrap steps and **both** mirrors of each (four files), narrow the preference statement so it names what the helper does *not* do — the base is still the run's to make ignored, whichever way the base was chosen — and place the obligation where a helper-preferring run will meet it, rather than only inside the by-hand branch it just skipped. Keep the recipe itself stated once; do not create a second spelling of it, which is exactly what `scripts/test-skill-worktree-base-exclude.mjs` exists to prevent.

Consider pinning the new clause in that same suite, beside the FULL clause list, so a later round cannot quietly restore "it covers those and nothing else" over the ignore half.

## Acceptance criteria

- The decision above is recorded in the task or the commit message: whether the fix lands in powbox's `wt-bootstrap` or in these skills' prose.
- If the skills are changed: all four files (`plugins/` and `codex/` mirrors of `address-tasks` and `address-reviews`) state that preferring `wt-bootstrap` does not discharge the obligation to make an in-repo base ignored, and each pair stays byte-identical in the passage touched.
- The ignore recipe is still stated exactly once per step — no second spelling of the probe/append/re-probe sequence is introduced.
- `node scripts/test-skill-worktree-base-exclude.mjs` still passes, with any new clause pinned there rather than left to a future audit.
- Every suite named in `.github/workflows/tests.yml` passes.
