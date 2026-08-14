# 046b — Retire the no-helper fallback prose for the disposable-clone helpers

## Why

Fourteen shipped skill files — seven under `plugins/dev-skills/skills/` and their seven `codex/dev-skills/skills/` mirrors — carry a "where the helper is absent" fallback for `dc-enter`/`dc-remove`. That prose exists once per skill and says roughly the same thing each time, and the skills are already long enough that a rule repeated fourteen times is a real cost.

Measured provenance — re-measured against the current powbox image, which falsified the three-row table this task was originally written on — says the fallback's live audience is every Codex session:

| Consumer | `dc-enter` on PATH? | Why |
|---|---|---|
| Claude on powbox | yes | Claude's plugin runtime puts `plugins/dev-skills/bin/` on PATH — *not* powbox |
| Claude off powbox | yes | the same plugin runtime, and the helpers ship in that tree |
| Codex on powbox | **no** | no plugin runtime, and powbox bakes `gh-review-threads` from this repository but not the `dc-*` pair |
| Codex off powbox | **no** | `codex/` carries only `skills/` — no `bin/`, no install scaffolding |

The measurement behind the two `no` rows: on the current image `/usr/local/bin/dc-enter` and `/usr/local/bin/dc-remove` do not exist, while `/usr/local/bin/gh-review-threads` does and is byte-identical to this repository's copy, and `command -v dc-enter` inside a Claude container resolves under `~/.claude/plugins/cache/` rather than `/usr/local/bin`. The image-baked set beside `gh-review-threads` is `wt-bootstrap`, `wt-enter`, `wt-remove`, `wt-common.sh`, `wf-check`, `wf-status` and `gitcat`.

So the gap is not one off-powbox population that skipped a documented step — it is every Codex session, and a Codex user on powbox is exactly as uncovered as one off it. It remains an *install-state* difference rather than a harness-capability one, and `README.md` documents the remedy today (`mkdir -p ~/.local/bin && install -m 755 plugins/dev-skills/bin/dc-enter plugins/dev-skills/bin/dc-remove ~/.local/bin/`), but the population that has to run that command is every Codex user rather than a stray one, and the fix is landing in the image rather than in this repository's trees.

Two facts bound what this task may claim, and both were measured rather than assumed:

- **The `codex/` tree is not where this gets fixed.** Powbox task 061, in the `Roubtec/powbox` repository, bakes both helpers into `/usr/local/bin` from this repository's `plugins/dev-skills/bin/` through the same pipe that already bakes `gh-review-threads`, and settles the duplication question in the same breath: a baked copy for Claude alone "would create two artifacts to keep in sync for no gain. The baked copy serves both." A copy under `codex/dev-skills/bin/` would be a third. Shipping `bin/` into `codex/` would not put it on PATH by itself either — Codex has no equivalent of Claude's plugin runtime; the tree is files in a config folder — so it would buy a self-contained tree at the price of a mirror to keep in sync, with the manual PATH step surviving either way.
- **This retirement covers the plugin-shipped helpers only.** `wt-bootstrap`, `wt-enter`, `wt-remove`, `wf-check` and `gitcat` are baked into the powbox image and are *not* shipped from this repo, so a container on an older image genuinely lacks them and their fallbacks stay reachable. Task 046 widened one such fallback (the Cleanup pre-removal marker list) precisely because it is reachable. Do not delete those.

`gh-review-threads` is settled and needs no drift check: powbox sources it directly from this repo and its CI smoke tests assert the script's presence.

## Scope amendment

The provenance table above was corrected against measurement after this task was written, and the powbox counterpart was located. Two parts of the original scope are withdrawn or deferred as a result; the rest stands.

**Withdrawn — acceptance criterion 1, shipping `bin/` into `codex/`.** Do not create `codex/dev-skills/bin/`. Powbox task 061 in the `Roubtec/powbox` repository bakes both helpers for both flavors from this repository's `plugins/dev-skills/bin/`, on the settled ground that "the baked copy serves both" and that a second artifact would be "two artifacts to keep in sync for no gain". A `codex/` copy would be the third artifact, and would contradict the one-source-of-truth rule that repository's architecture chapter encodes for vendored baked helpers.

**Deferred — the single stated precondition and the fourteen per-skill deletions.** Both are gated on powbox task 061 landing. That task's implementation notes state: "Do not add a fallback path for containers built before this lands. The consumer wording that 017 owns already degrades on `command -v`, which is the whole point of that clause." Powbox 061 therefore relies on this repository keeping the per-skill fallback until the baked helpers ship; deleting it first would leave every Codex session with neither the helper nor the fallback, which is precisely the silent degradation the helpers exist to prevent. Once 061 has landed and a rebuilt image carries `/usr/local/bin/dc-enter` and `/usr/local/bin/dc-remove`, the precondition and the deletions land on this task's branch.

**Delivered ahead of that gate:** the corrected `codex/` bullet in `README.md` — every Codex session needs the documented `install` step today, not only a Codex user off powbox — and this correction to the task file itself.

## What to do

- **Now:** correct `README.md`'s `codex/` bullet so it states that every Codex session needs the documented `install` step, keeping the install command and the `mkdir -p` rationale sentence, both of which are correct and load-bearing.
- **After powbox task 061 lands:** state the helpers as a **precondition** in one place rather than as a fallback in fourteen: the skills may assume `dc-enter`/`dc-remove` are on PATH, and a run that finds them missing stops with a message naming the install step instead of degrading into a hand-rolled path.
- **After powbox task 061 lands:** remove the per-skill "where the helper is absent, name an absolute path outside the repository" prose from all fourteen files once that precondition exists, keeping the destroy boundary's *destination* rule itself intact — what goes is the branch for the helper being absent, not the requirement that empirical verification happens in a disposable clone.
- Leave every fallback for an image-baked helper untouched, and say so in the PR description so the sweep's boundary is checkable rather than asserted.

## Considered and declined

**Move the no-helper guidance into a separate file referenced only by the Codex-flavored skills.** Rejected because it keys the difference on the wrong axis: the two flavors are kept in lockstep and diverge only where *harness capabilities* differ, whereas a missing helper is an *install-state* difference, and flavor-keyed guidance would besides split one contract across two documents. The conclusion stands, but the reason originally given for it — "the same Codex user on powbox has the helper on PATH" — rested on the falsified table and is false today, since a Codex user on powbox has no `dc-enter` either. The corrected reason is that install state is what varies while the flavor does not: the same `codex/` tree is covered or uncovered depending on whether the helpers were installed by hand or baked into the image, and powbox task 061 will cover every Codex session on a rebuilt image without a single skill file changing — so guidance keyed on the flavor would go false the moment that lands.

## Acceptance criteria

- ~~The `codex/` tree carries the disposable-clone helpers, and the method is documented where a user setting that tree up will see it.~~ **Withdrawn** — see "Scope amendment"; powbox task 061 bakes them for both flavors instead, and this repository keeps `plugins/dev-skills/bin/` as the single source.
- `README.md`'s `codex/` bullet states that the documented install step is needed by every Codex session rather than only by one off powbox, with the install command and the `mkdir -p` rationale intact.
- *(gated on powbox task 061)* The helper precondition is stated exactly once, and a missing helper produces a stop that names the install step rather than a silent fall back to an unguarded path.
- *(gated on powbox task 061)* No shipped skill file retains a per-skill no-helper fallback for `dc-enter`/`dc-remove`; the destination rule and the guarded `cd` form task 046 added both survive.
- Fallbacks for `wt-bootstrap`, `wt-enter`, `wt-remove`, `wf-check` and `gitcat` are unchanged, and the PR description lists them as deliberately retained.
- The plugin and codex copies of every touched section still agree, and every suite named in `.github/workflows/tests.yml` passes.
