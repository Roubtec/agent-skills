# 046b — Ship the disposable-clone helpers to the Codex flavor, and retire the no-helper fallback prose

## Why

Fourteen shipped skill files — seven under `plugins/dev-skills/skills/` and their seven `codex/dev-skills/skills/` mirrors — carry a "where the helper is absent" fallback for `dc-enter`/`dc-remove`. That prose exists once per skill and says roughly the same thing each time, and the skills are already long enough that a rule repeated fourteen times is a real cost.

Measured provenance says the fallback has exactly one live audience:

| Consumer | `dc-enter` on PATH? | Why |
|---|---|---|
| powbox, either harness | yes | powbox places the helpers |
| Claude off powbox | yes | the plugin runtime puts `plugins/dev-skills/bin/` on PATH, and the helpers ship in that tree |
| Codex off powbox | **no** | `codex/` carries only `skills/` — no `bin/`, no install scaffolding |

So the gap is not structural. It is an install-state difference for one population, and that population is already hand-maintaining a skills tree in its own config folder. The repo documents the remedy today (`install -m 755 plugins/dev-skills/bin/dc-enter plugins/dev-skills/bin/dc-remove ~/.local/bin/`), which means the fallback's real audience is a user who skipped a documented one-line step.

Two facts bound what this task may claim, and both were measured rather than assumed:

- **Shipping `bin/` into `codex/` does not by itself put it on PATH.** Codex has no equivalent of Claude's plugin runtime; the tree is files in a config folder. Shipping the helpers there makes the tree self-contained — one thing to copy rather than two trees to reconcile — but the PATH step stays manual. The precondition therefore has to be stated, not merely implied by the files being present.
- **This retirement covers the plugin-shipped helpers only.** `wt-bootstrap`, `wt-enter`, `wt-remove`, `wf-check` and `gitcat` are baked into the powbox image and are *not* shipped from this repo, so a container on an older image genuinely lacks them and their fallbacks stay reachable. Task 046 widened one such fallback (the Cleanup pre-removal marker list) precisely because it is reachable. Do not delete those.

`gh-review-threads` is settled and needs no drift check: powbox sources it directly from this repo and its CI smoke tests assert the script's presence.

## What to do

- Ship the disposable-clone helpers with the Codex flavor so that tree is self-contained rather than pointing at the plugin tree for its own tooling. Decide during implementation whether that is a copy, a build step, or a documented install target, and state which — the constraint is that a Codex user who takes the `codex/` tree gets the helpers with it.
- State the helpers as a **precondition** in one place rather than as a fallback in fourteen: the skills may assume `dc-enter`/`dc-remove` are on PATH, and a run that finds them missing stops with a message naming the install step instead of degrading into a hand-rolled path.
- Remove the per-skill "where the helper is absent, name an absolute path outside the repository" prose from all fourteen files once that precondition exists, keeping the destroy boundary's *destination* rule itself intact — what goes is the branch for the helper being absent, not the requirement that empirical verification happens in a disposable clone.
- Leave every fallback for an image-baked helper untouched, and say so in the PR description so the sweep's boundary is checkable rather than asserted.

## Considered and declined

**Move the no-helper guidance into a separate file referenced only by the Codex-flavored skills.** Rejected because it keys the difference on the wrong axis. The two flavors are kept in lockstep and diverge only where *harness capabilities* differ, whereas a missing helper is an *install-state* difference: the same Codex user on powbox has the helper on PATH. Flavor-keyed guidance would therefore be false for every Codex user on powbox, and would split one contract across two documents to serve a population defined by something other than its harness.

## Acceptance criteria

- The `codex/` tree carries the disposable-clone helpers, and the method is documented where a user setting that tree up will see it.
- The helper precondition is stated exactly once, and a missing helper produces a stop that names the install step rather than a silent fall back to an unguarded path.
- No shipped skill file retains a per-skill no-helper fallback for `dc-enter`/`dc-remove`; the destination rule and the guarded `cd` form task 046 added both survive.
- Fallbacks for `wt-bootstrap`, `wt-enter`, `wt-remove`, `wf-check` and `gitcat` are unchanged, and the PR description lists them as deliberately retained.
- The plugin and codex copies of every touched section still agree, and every suite named in `.github/workflows/tests.yml` passes.
