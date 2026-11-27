# Later rounds: relaying findings, the next review's range, stalls, and the round cap

This file is part of the `review-cycle` skill, and the sections it names (**Roles**, **The loop and its gates**) are that skill's `SKILL.md`, beside it.
It is read in full once the first reviewer round has not ended the cycle — the round did not pass, or the pass after it fixed or disputed something — and by no cycle that converges in one round.
Its rules are part of **The loop and its gates** and bind wherever that section is said to bind.

## Relaying a round's findings

**Verbatim relay:** do not summarize, merge, or rewrite feedback.
When another fix round is needed, give the fresh fixer the complete available results verbatim as separately labeled blocks so it can reconcile overlap or conflict: `Reviewer findings`, and `Peer (<provider>) findings` for the Peer, under the provider name its launch was given.
A second peer's report travels as its own `Peer (muse) findings` block, never merged into the Peer's.
A pushed-back peer claim is adjudicated by the next fresh Reviewer.
Where the Reviewer passed and the peer blocked on the same fact (or the reverse), tell the fixer outright that the channels agree on the substance and differ only on severity — it visibly shortens deliberation.
That is framing, not a gate change: a grounded finding keeps its existing force.

## Which range the next review covers

**When a fix commit was amended between rounds, name which review the next one is.**
An **incremental** re-review ("what changed since I last looked") gets the **recorded prior-round SHA** as its base — never the fix commit's parent, which after an amend is `HEAD~1` spanning the whole cumulative fix set; reserve that parent range for an explicitly requested **cumulative** review of the entire fix.
So state in the brief, from the ending SHA **Roles** has you record each round, which of the two ranges the Reviewer is given and why — or sidestep the bookkeeping with fixup commits squashed at the end, which keeps the two ranges distinct on its own.

## When rounds stop converging

**Bound the claim instead of tightening it again.**
When consecutive rounds each puncture a *narrower* residual of the same finding — a criterion is patched, a narrower edge case defeats it, repeat — the artifact is over-claiming, so offer the next fixer "bound the claim honestly" as a legitimate **complete** resolution: state the premises, name the residual outright, and give the operator definite branches.
It resolves only if the bounded claim is one the artifact actually keeps — weakening a criterion to dodge the finding is not bounding it.

**Two same-class findings make the structure the defect.**
When **two** consecutive rounds land findings of the same class in the same section, stop patching instances and ask whether the shape is what produces them.
The two observed triggers are a closed enumeration standing in for an open set (replace it with an exclusion rule) and a spec keeping several options open so every criterion must hold under all of them (lock one option).
A consumer may raise the threshold for a section under heavy churn, but must state a number rather than leave it open.

## At the round cap

If issues persist after the last round the cap allows — round 12, or the lower number an invoker set — stop iterating, do not deliver or publish, and surface every outstanding finding set verbatim.
