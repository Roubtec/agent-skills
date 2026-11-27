# A named rebase target, `no-rebase`, and an entry kept out of rebasing

This file is part of the `address-reviews` skill, and the section and phase names it cites are that skill's `SKILL.md`, beside it.
It is read in full before `targets.sh plan` runs, when the invocation carries `rebase on top of <target>` or `no-rebase`, or its prose keeps an entry out of rebasing.
A batch with none of the three rebases every entry onto its own base ref, or a stacked dependent onto its parent's new tip, and never reads it.

## Handing them to the plan

`--target` carries a `rebase on top of <target>` token, quoted as ONE argument; `--no-rebase` carries the batch-wide token; `--except` names each entry the invocation prose excluded.
`no-rebase` is per-invocation, not per entry: it turns the default off for the whole batch.
A single entry sits out only because the invocation prose said so ("rebase everything except `special/snowflake`"), which you honor as an ordinary instruction and record in the summary — there is no flag syntax for it — and an entry the invocation prose excluded is treated the same way as an entry of a `no-rebase` batch.
Such an entry is `rebase=no` in the plan and is not "rebase-enabled" wherever `SKILL.md` uses the phrase: neither rebase point runs for it, and a dependent for which rebase remained disabled has no restack obligation.

## A named target is one commit for the whole batch

It is resolved to a commit ONCE at setup, by `targets.sh plan`, and reused at both rebase points.
A target the invocation named is resolved WHERE IT WAS NAMED — in your own checkout, ONCE, by that call, with nothing fetched for it — so the call runs after Bootstrap's `git fetch origin`: a remote-tracking ref resolved before that fetch names a staler commit than the request meant.
Where it stops on `unresolved`, stop the batch and report what you tried rather than substituting anything.
Its `named=` commit is the batch's one base: that single OID serves every rebase-enabled entry at both of its points — overridden only for a stacked dependent, whose parent tip wins — and it, never the ref name again, is what any later `plan` is given as `--target`.

"Re-pin a default target at each rebase point" does not reach it: a named target is the batch's single pinned base by construction, so it is not re-resolved per point.
That the second point then normally finds nothing to do for a named target is intended.
Normally rather than always — a pure-join merge still in range is flattened by the replay, moving the tip over an unmoved base — so a point is skipped only on the proof `review-cycle`'s `rebase-facts.sh before` gives, `outcome=noop`, which counts that merge, and never on your impression that the base has not moved.

## The effective base of an entry that did not rebase

`no-rebase` wins over a named target for the REBASE but does not discard the target itself: it remains the pinned effective base every entry's ranges are taken against.
Where no rebase ran for an entry at all — a `no-rebase` batch, or an entry the invocation prose excluded — its effective base is its line's `pin=`, fixed ONCE at setup: the invocation-named target's own pinned OID on a `no-rebase` batch that named one, since `no-rebase` suppresses the rebase without discarding the token, and the entry's own base ref otherwise.
That `pin=` is what Phase A hands the fixer as the pinned effective base and what Phase B's review range is taken against, and `SKILL.md`'s rule against re-deriving it from `origin/<base>` or the entry's `baseRefName` holds for it unchanged.
