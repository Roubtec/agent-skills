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

That is a real cost, and it is paid downstream: the cycle discards something it knew — that a later pass settled the issue — and leaves `resolve-open-questions` to re-derive it, since that skill consumes these questions as its four-part brief without re-derivation (`plugins/dev-skills/skills/resolve-open-questions/SKILL.md:47`). Its grounding step is written to catch exactly this ("Confirm the gap still exists as described. An earlier fix or an intervening change may have altered or resolved it; re-verify against the current state before you put it to the user" — `SKILL.md:91-92`), so a superseded question usually stops there rather than reaching the maintainer. But that re-derivation is work the cycle should not have had to ask for, and it is the only thing standing between a stale question and the maintainer: whatever the grounding pass misses is served as a live decision the cycle already made for them.

The maintainer's ruling on the thread (https://github.com/Roubtec/agent-skills/pull/39#discussion_r3717010843):

> as long as this is deterministically decidable, it sounds like a good idea. if the scope would bloat, consider a follow-up task.

It is filed rather than fixed on PR #39 because the deterministic half of that condition is not reachable with the wire format as it stands — *Context and references* traces the failing path.

## Scope

Included:

- Add a back-reference to `CYCLE_FIX_SCHEMA` so a `fixed` or `declined` disposition can name the open question(s) it retires.
- Pass the currently-open questions into `cycleFixPrompt` so the fixer has stable ids to name, and state the retirement rule in its `## Rules` block.
- Decide **mark vs. remove** for a retired question and implement it.
- Guard a retirement that names an unknown question id structurally, the way the rest of the cycle guards its contracts.
- Keep `knownQuestionIds` correct under the new rule.
- Mirror every change into `wf-address-tasks.js`'s embedded `review-cycle-core` section and verify the two sections stay byte-identical.
- Update the wire-format prose in both `review-cycle` skill mirrors, and check whether `resolve-open-questions` needs a line about skipping retired questions.

Out of scope:

- Any change to how `resolve-open-questions` serves questions beyond consuming the new state.
- Re-deriving supersession from finding text. Explicitly excluded — see *Context and references*.

## Context and references

Line numbers below are as of task 014 (PR #39), which introduces the marked section they point into; re-derive them before editing if the section has moved since.

**Why supersession cannot be decided from the data the cycle has today.** It needs a link from a later disposition back to the question an earlier pass raised. The cycle has exactly one such link, and it points the wrong way: a disposition carries `questionId` only when its own `disposition` is `escalated` (`plugins/dev-skills/workflows/wf-review-cycle.js:212`), naming the question it *creates*.

Follow the failing path through the existing structure:

1. Pass N escalates finding `F` and raises question `q1`. Because `escalated` + a known `questionId` is a valid disposition (`wf-review-cycle.js:567-570`), `F` is covered and is **not** carried forward.
2. The next reviewer rejects the escalation. It comes back as a **new** finding with a **new** round-scoped id — not as `F`.
3. Pass N+1 disposes that new finding `fixed`. Nothing in that disposition names `q1`.

So `q1` is stale and no field says so. Matching the two findings by text is not an option either — `cycleUndisposedFindings` deliberately matches by id, never by text ("paraphrase-proof where text matching is not", `wf-review-cycle.js:545-546`), and reintroducing text matching to solve this would undo that.

Closing the loop therefore means extending the pinned wire format, which is what makes this its own change rather than a line in PR #39:

- `CYCLE_FIX_SCHEMA`'s disposition item needs a way to name questions a `fixed`/`declined` disposition retires (`wf-review-cycle.js:204-215`).
- The fixer prompt must show the currently-open questions, or the fixer has no ids to name — `cycleFixPrompt` (`wf-review-cycle.js:339`) does not pass them today.
- The rule belongs in the fixer's `## Rules` block (`wf-review-cycle.js:363-370`) beside the existing "Every `escalated` disposition gets an `openQuestions` entry" line at `wf-review-cycle.js:368`.
- Every edit has to be mirrored byte-for-byte into `wf-address-tasks.js`'s embedded copy of `review-cycle-core` (the same append sits at `wf-address-tasks.js:1029`).
- The wire format is documented prose in **both** skill mirrors — `plugins/dev-skills/skills/review-cycle/SKILL.md:78-84` and `codex/dev-skills/skills/review-cycle/SKILL.md:129-135` — which must move in lockstep.

That is a pinned-contract change spanning both workflow scripts and both `review-cycle` skill mirrors, with `resolve-open-questions` to check as a consumer, landing in a PR whose subject is the extraction itself.

## Target files or areas

- `plugins/dev-skills/workflows/wf-review-cycle.js` — the canonical `review-cycle-core` section: `CYCLE_FIX_SCHEMA`, `cycleFixPrompt`, `cycleUndisposedFindings`, the `knownQuestionIds` construction (`wf-review-cycle.js:699`), and the append itself.
- `plugins/dev-skills/workflows/wf-address-tasks.js` — the synthesized copy of that section, which must stay byte-identical to the canonical one.
- `plugins/dev-skills/skills/review-cycle/SKILL.md` and `codex/dev-skills/skills/review-cycle/SKILL.md` — the wire-format prose mirrors.
- `plugins/dev-skills/skills/resolve-open-questions/SKILL.md` — the consumer; check whether it needs a line about skipping retired questions.

## Implementation notes

Task 014 (the `review-cycle` extraction, PR #39) must land first. This edits the marked section that task introduces, and the byte-identical mirroring constraint exists only because of it.

Reusing `questionId` (widening its description beyond `escalated`) and adding a distinct field are both acceptable ways to carry the back-reference; pick one and state why in the commit.

**Mark vs. remove** is a genuine open decision, not a detail to settle silently. Marking (e.g. a `supersededBy`/`superseded` field on the question) preserves the round history and lets `resolve-open-questions` skip it knowingly; removing keeps the result lean and matches how the cycle already treats its result as lean-with-bulk-behind-`artifactDir`. Removal is the weaker choice if anything downstream still needs to see that the question existed — the artifact directory keeps the full history either way. State the reasoning for whichever is chosen.

Guard the retirement structurally: a retirement naming an unknown question id must not silently no-op. Treat it like the existing `stray:` disposition-error handling (`wf-review-cycle.js:558-562`) rather than ignoring it.

Keep `knownQuestionIds` correct under the new rule: a question retired in pass N must not make a later `escalated` disposition that names it read as valid.

The two `review-cycle` skill mirrors have no generator — hand-edit both in lockstep, and confirm their deliberate divergence is unchanged apart from the retirement rule.

## Acceptance criteria

- A cycle in which a pass escalates a finding and a later pass retires that question does not surface the question in its terminal `openQuestions`, or surfaces it explicitly marked, per the mark-vs-remove decision.
- A retirement naming an unknown question id is reported, not silently dropped.
- A question already retired cannot validate a later `escalated` disposition that names it.
- The `review-cycle-core` sections in `wf-review-cycle.js` and `wf-address-tasks.js` are byte-identical.
- Both `review-cycle` SKILL.md mirrors document the retirement rule, and their divergence is unchanged apart from it.

## Validation

- Confirm the embedded section is byte-identical:
  `diff <(awk '/BEGIN EMBEDDABLE SECTION: review-cycle-core/,/END EMBEDDABLE SECTION: review-cycle-core/' plugins/dev-skills/workflows/wf-review-cycle.js) <(awk '/BEGIN EMBEDDABLE SECTION: review-cycle-core/,/END EMBEDDABLE SECTION: review-cycle-core/' plugins/dev-skills/workflows/wf-address-tasks.js)`
- Parse-check every touched workflow script with `wf-check`, or with the wrapped `node --check` documented in `plugins/dev-skills/workflows/README.md`'s Validation section — a bare `node --check` on these sources cannot fail, so it is not the gate.
- Run `node scripts/test-checkout-cleanliness-report.mjs`.
- Diff the two `review-cycle` SKILL.md mirrors against each other and confirm the divergence count is unchanged apart from the new rule.

## Review plan

Reviewer should walk the failing path in *Context and references* against the changed code and confirm the retired question can no longer reach the terminal result unmarked; check that an unknown question id in a retirement surfaces as a disposition error rather than a no-op; confirm the mark-vs-remove decision is stated with its reasoning rather than assumed; and verify the embedded section and both skill mirrors moved together.
