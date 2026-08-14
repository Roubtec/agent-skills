# 046d — Retire the `DC_ROOT` placement prediction from `dc-enter`'s header

## Why

`plugins/dev-skills/bin/dc-enter`'s header comment predicts what another repository will do with `DC_ROOT`, in the last three sentences of the `CLONE ROOT` comment block — the ones beginning "`DC_ROOT` is the placement interface". It says powbox will express its "outside /workspace" placement by setting the variable, and that "until it does, a clone in a powbox container lands under `$TMPDIR` like anywhere else." Both halves are now measured wrong.

The first half is contradicted by the counterpart's own measurement. Powbox task 061, in the `Roubtec/powbox` repository, records under "Placement and scope decisions" that `TMPDIR` is unset in a current agent container and `/tmp` is the disk-backed overlay filesystem, so clones already land container-local and outside `/workspace` — which is the placement powbox would have set the variable to express. Its conclusion there is that the honest default is not to set it at all, and that the reason to set it anyway "would be to relocate clones onto a persistent volume or to make the intent explicit rather than incidental". That task's status there is "Not started", so this is a measured recommendation rather than a shipped decision; what it settles either way is that the header cannot keep asserting powbox *will* set the variable.

The second half is wrong for powbox specifically. `TMPDIR` is unset in the agent container, so a clone lands under `/tmp` through the helper's own third fallback, not under `$TMPDIR`. The header states the correct order at the top of the same `CLONE ROOT` block — "`$DC_ROOT` if set, else `$TMPDIR`, else `/tmp`" — and `usage()`, the text `dc-enter --help` prints, says the same, so the prediction contradicts the block it closes as well as the container it describes. (`die()` on a bad root names only the selected root source and no resolution order; nothing in this task asks that to change.)

`README.md`'s half of this pair was corrected in task 046b: its `DC_ROOT` sentence in the `dc-enter`/`dc-remove` bullet now states the resolution order and predicts nothing. That correction was deliberately kept to the sentence that says strictly less than the helper's header rather than one that disagrees with it, because editing a shipped helper was out of 046b's scope. This task closes the pair.

## What to do

- Rewrite the `CLONE ROOT` block's closing sentences, the ones beginning "`DC_ROOT` is the placement interface", in `plugins/dev-skills/bin/dc-enter` so they state what the variable *is* — the interface a container image or a caller uses to place the clones deliberately — and what happens when nothing sets it, matching the order that block opens with (`$DC_ROOT`, else `$TMPDIR`, else `/tmp`) rather than naming `$TMPDIR` alone. Keep the "Do not rename it on one side only." sentence: that is a live contract with whatever bakes the helper, not a prediction.
- Leave the "Sync discipline" paragraph's conditional — the sentence beginning "If powbox later bakes", which requires that a baked copy come from this one and keep `DC_ROOT` as the placement interface — as it stands. It states a requirement on a hypothetical, which is a contract rather than a forecast, and powbox task 061 is written to honor it.
- `dc-remove` carried no `DC_ROOT` prediction of its own when this task was written; re-check it rather than inheriting that, and correct anything equivalent found there.
- Check the `codex/dev-skills/` mirror for the same paragraph before finishing. As of this task's writing the Codex tree carries only `skills/` and no `bin/`, so there is nothing to mirror, but that is exactly the fact task 046b re-measured and it should be re-measured rather than inherited.

## Considered and declined

**Fold this into task 046b.** Declined at the time: 046b's branch was scoped to `README.md` and its own task file while three sibling tasks were editing the skill, workflow, and `scripts/` trees concurrently, and touching a shipped helper there was an avoidable collision. The split also keeps the two changes reviewable for what they are — 046b removes a claim from documentation, this removes one from an executable's contract text.

**Set `DC_ROOT` in the powbox image so the prediction comes true instead.** Not this repository's call, and powbox task 061 has already measured against it: the default placement is already correct there, so setting the variable would be configuration for its own sake. If that decision is revisited it is recorded in 061's PR, and this header should still describe the interface rather than one consumer's use of it.

## Acceptance criteria

- No paragraph in `plugins/dev-skills/bin/dc-enter` or `plugins/dev-skills/bin/dc-remove` predicts what powbox will do with `DC_ROOT`, and none names `$TMPDIR` as the sole default.
- The `DC_ROOT` description agrees with the order the header's own `CLONE ROOT` block opens with and with the one `usage()` already prints, all three naming `$DC_ROOT`, else `$TMPDIR`, else `/tmp`. `usage()` is already correct, so this criterion is met by leaving it alone: no runtime output is added or changed by this task.
- The "Do not rename it on one side only." contract and the "Sync discipline" paragraph survive.
- `README.md`'s `DC_ROOT` sentence still agrees with the corrected header; if the header's new wording makes README's sentence redundant or stale, README moves in the same change.
- `bash scripts/test-dc-helpers.sh` passes with its check count unchanged, and every other suite named in `.github/workflows/tests.yml` passes. This is a comment-only change to the helpers, so a moved count is a signal that something else moved with it.
