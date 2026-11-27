# Open questions: the format, the id checks, retirement, and the result

This file is part of the `review-cycle` skill, under its `SKILL.md` → "Escalation: open questions", beside it.
It is read in full by the orchestrator the first time its cycle holds an open question — a pass returned an `escalated` disposition, a delegated rebase halted, or the invoker handed one in — and by a Fixer before it escalates; a cycle in which nothing is escalated never needs it.

## The format of a question

An open question is typically consumed by `resolve-open-questions`, whose four-part brief (grounded context, concrete trigger, distinct options, recommendation) the fields below map onto one-to-one, so a completed cycle's questions are consumable without re-derivation (that skill's grounding step still re-verifies every carried claim against current state before serving).

Record each question with: a stable `id` within the run (e.g. `<cycle-slug>-q1`; referenced by the disposition that raised it and by `coupledWith`); the `question` phrased as the decision fork, not a narrative; its `origin` (reviewer | peer | implementer | rebase) and the round it arose in; whether it was `blocking` (the cycle could not pass without the answer) or a parked nit; `artifacts` — authoritative pointers only (`file:line`, ref, PR/thread URL, task file), never a paraphrase; the concrete `trigger` that manifests the problem; its `reachability` (live | dormant | impossible-until | unknown, plus the condition when dormant or prerequisite-bound) — a carried claim, re-derived before anyone acts on it; drafted `options` with the blast radius of each (may be empty); a `recommendation` with a one-line why (empty when the call turns on maintainer intent); and `coupledWith` — ids of sibling questions sharing the one underlying decision.

## A question's id, and the disposition that names it

That `id` must be one no earlier pass used.
Re-using one reads as a **re-report** of that pass's question rather than a new question, so the cycle keeps the entry from the pass that raised it and drops the re-report.

The disposition's `questionId` back-reference is checked in its own right, not only where it decides whether a handed finding was covered: a **spontaneous** disposition — one naming no finding, and every disposition on a pass handed nothing, which the final confirmation pass always is — covers nothing by construction, so nothing else would ever look at it.
An `escalated` disposition whose `questionId` names no question the cycle carries **live** — one no pass raised, an absent or empty id, or one a retirement has already settled or claimed — is reported like any other disposition error rather than quietly pointing at nothing; a settled id is that same breach and not a case of its own, since a decision off the maintainer's list is nothing to escalate to whether it was taken off or never on it.
Naming a still-live id is no breach at all, even where the re-report rule above then keeps the raising pass's question over the restatement: that decision does reach the maintainer, and failing the round over a restatement would cost a converging cycle another round for nothing.

## Retiring a superseded question

A later pass often settles the issue behind a question an earlier pass raised — the next reviewer rejects the escalation as an evasion, and the pass after it simply fixes the thing — and the cycle should then stop asking the maintainer to decide it.
When a `fixed` or `declined` disposition settles a still-live open question, it names that question's `id` among the questions it retires, and the cycle **marks** the question retired (recording the pass and disposition that settled it) rather than dropping it.
Like a decline, a retirement is not final on the fixer's say-so: the next fresh Reviewer is handed the question that was retired and what the fixer claims settled it, and overrules an unearned retirement — this is the one disposition that takes a decision off the maintainer's list rather than adding to it.
So the mark lands **pending** and becomes the settled one a consumer skips only once a round PASSES with it in view: a claim no round accepted — the Reviewer rejected it, or no round ever judged it because the cycle errored or hit its round cap — leaves the question live for the maintainer, which is the whole point of marking rather than dropping.
An unaccepted claim is re-presented to the next round rather than expiring: a round can fail on something else entirely, and a fixer whose finding is no longer carried has no disposition left to restate the claim on.
Nor can a claim be WITHDRAWN: the question leaves the fixer's live list the moment it is claimed, so no later pass can retract it; an unaccepted claim ships as the live decision it still is.
Only `fixed` and `declined` retire — an `escalated` disposition raises a question rather than settling one; only a question an EARLIER pass raised can be retired, since a pass that both raises and settles one is contradicting itself rather than superseding anything; a retirement naming an id the cycle does not carry live from an earlier pass — an empty id included, which names nothing — is reported like any other disposition error rather than silently doing nothing; and a question a retirement settles can never validate an escalation that names it, whether that retirement came from an earlier pass or the same one.
Show each fixer pass the questions still live, or it has no ids to name.

## Questions in the cycle's result

Open questions always surface structurally in the cycle's result — they exist for the human — while the bulk prose stays on disk behind the artifact pointer; a retired one rides along marked, and a consumer serving questions to the maintainer passes over it — a retirement still pending a round's verdict does not carry that mark, and is served as the live decision it still is.
