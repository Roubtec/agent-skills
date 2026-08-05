# 014a — Retire open questions a later cycle pass has superseded

## Why this task exists

The review cycle accumulates escalated open questions by unconditional append:

```js
// plugins/dev-skills/workflows/wf-review-cycle.js:682
for (const q of fix.openQuestions || []) openQuestions.push(q);
```

Nothing ever removes one. A question raised in an early pass therefore rides all the way into the cycle's terminal result even when a later pass has settled the underlying issue.

The concrete path, raised by codex on PR #39 (thread `PRRT_kwDOTNFS7M6Wczx5`, https://github.com/Roubtec/agent-skills/pull/39#discussion_r3715682180):

> If a fixer escalates a finding to an open question and the next reviewer rejects that escalation as an evasion or misunderstanding, a later pass can fix or decline the issue, but this unconditional append leaves the earlier question in the final `openQuestions[]`. The completed cycle then hands `resolve-open-questions` stale decisions that no longer block the accepted artifact, so users may be asked to resolve work that was already corrected.

That is a real cost, and it lands on a human: `resolve-open-questions` consumes these questions as its four-part brief without re-derivation (`plugins/dev-skills/skills/resolve-open-questions/SKILL.md:47` — its grounding step re-verifies carried claims, but it has no way to learn that the *whole question* is moot), so the maintainer is walked through a decision the cycle already made for them.

The maintainer's ruling on the thread (https://github.com/Roubtec/agent-skills/pull/39#discussion_r3717010843):

> as long as this is deterministically decidable, it sounds like a good idea. if the scope would bloat, consider a follow-up task.

It is filed rather than fixed on PR #39 because the deterministic half of that condition is not reachable with the wire format as it stands.

## Why it cannot be decided from the data the cycle has today

Supersession needs a link from a later disposition back to the question an earlier pass raised. The cycle has exactly one such link, and it points the wrong way: a disposition carries `questionId` only when its own `disposition` is `escalated` (`wf-review-cycle.js:212`), naming the question it *creates*.

Follow the failing path through the existing structure:

1. Pass N escalates finding `F` and raises question `q1`. Because `escalated` + a known `questionId` is a valid disposition (`wf-review-cycle.js:570`), `F` is covered and is **not** carried forward.
2. The next reviewer rejects the escalation. It comes back as a **new** finding with a **new** round-scoped id — not as `F`.
3. Pass N+1 disposes that new finding `fixed`. Nothing in that disposition names `q1`.

So `q1` is stale and no field says so. Matching the two findings by text is not an option either — `cycleUndisposedFindings` deliberately matches by id, never by text ("paraphrase-proof where text matching is not", `wf-review-cycle.js:545-546`), and reintroducing text matching to solve this would undo that.

Closing the loop therefore means extending the pinned wire format, which is what makes this its own change rather than a line in PR #39:

- `CYCLE_FIX_SCHEMA`'s disposition item needs a way to name questions a `fixed`/`declined` disposition retires (`wf-review-cycle.js:206-213`).
- The fixer prompt must show the currently-open questions, or the fixer has no ids to name — `cycleFixPrompt` does not pass them today.
- The rule belongs in the fixer's `## Rules` block beside the existing "every `escalated` disposition gets an `openQuestions` entry" line.
- Every edit has to be mirrored byte-for-byte into `wf-address-tasks.js`'s embedded copy of `review-cycle-core` (the same append sits at `wf-address-tasks.js:1029`).
- The wire format is documented prose in **both** skill mirrors — `plugins/dev-skills/skills/review-cycle/SKILL.md:78-84` and `codex/dev-skills/skills/review-cycle/SKILL.md:129-…` — which must move in lockstep.

That is a pinned-contract change across five files, consumed by a sixth skill, landing inside a 24-file PR whose subject is the extraction itself.

## Scope

Included:

- Add the back-reference to `CYCLE_FIX_SCHEMA` so a `fixed` or `declined` disposition can name the open question(s) it retires. Reusing `questionId` (widening its description beyond `escalated`) and adding a distinct field are both acceptable; pick one and state why in the commit.
- Pass the currently-open questions into `cycleFixPrompt` so the fixer has stable ids to name, and state the retirement rule in its `## Rules` block.
- Decide **mark vs. remove** and implement it. Marking (e.g. a `supersededBy`/`superseded` field on the question) preserves the round history and lets `resolve-open-questions` skip it knowingly; removing keeps the result lean and matches how the cycle already treats its result as lean-with-bulk-behind-`artifactDir`. Removal is the weaker choice if anything downstream still needs to see that the question existed — the artifact directory keeps the full history either way, so state the reasoning.
- Guard the retirement the way the rest of the cycle guards its contracts — structurally. A retirement naming an unknown question id must not silently no-op; treat it like the existing `stray:` disposition-error handling rather than ignoring it.
- Keep `knownQuestionIds` (`wf-review-cycle.js:699`) correct under the new rule: a question retired in pass N must not make a later `escalated` disposition that names it read as valid.
- Mirror into `wf-address-tasks.js`'s embedded `review-cycle-core` section; verify the two sections stay byte-identical.
- Update the wire-format prose in both `review-cycle` skill mirrors, and check whether `resolve-open-questions` needs a line about skipping retired questions.

Excluded:

- Any change to how `resolve-open-questions` serves questions beyond consuming the new state.
- Re-deriving supersession from finding text. Explicitly out — see above.

## Acceptance criteria

- A cycle in which a pass escalates a finding and a later pass retires that question does not surface the question in its terminal `openQuestions`, or surfaces it explicitly marked, per the decision above.
- A retirement naming an unknown question id is reported, not silently dropped.
- The `review-cycle-core` sections in `wf-review-cycle.js` and `wf-address-tasks.js` are byte-identical.
- `wf-check` (or the runtime-wrapped `node --check`) passes on every touched workflow script — a bare `node --check` on these sources cannot fail, so it is not the gate; see `plugins/dev-skills/workflows/README.md`'s Validation section for the wrapping.
- Both `review-cycle` SKILL.md mirrors document the retirement rule, and their divergence is unchanged apart from it.

## Prerequisites

None. Task 014 (the extraction, PR #39) must have merged, since this edits the section it introduces.
