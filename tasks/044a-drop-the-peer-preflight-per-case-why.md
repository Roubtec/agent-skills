# 044a — Drop the peer-preflight per-case why task 044's sweep missed

## Why

Task 044 swept prompt literals and schema field descriptions in the three workflow scripts for per-case why clauses — prose explaining why a branch of a closed case set produced the state it describes, rather than stating only what to do — and reduced each to the bare instruction. Its own rule: "Where a prompt currently explains why a field is empty, or why a check is skipped, or which of several situations produced the state it describes, reduce it to the instruction."

One site matching that rule exactly survived the sweep. `cyclePeerPreflightPrompt()`'s prompt literal, present byte-identically in both `plugins/dev-skills/workflows/wf-review-cycle.js` and `plugins/dev-skills/workflows/wf-address-tasks.js` (inside the `review-cycle-core` embeddable section, so both copies must move together), walks a four-way branch on `codex` availability and ends:

> "If it fails while `CODEX_API_KEY` is set, return available because the environment key may authenticate the real invocation."

The clause after "available" is a per-case why: it explains *why* this branch returns `available` rather than telling the subagent only *to* return it, exactly the pattern 044's other three branches in the same sentence were already stripped to (each of the preceding three sentences states only the condition and the return value, no rationale clause). The line predates 044's sweep — `git blame` attributes it to `0e57584e` ("Fix peer lifecycle and batch preflight races"), and none of 044's sweep commits touch `cyclePeerPreflightPrompt`, so this was never in that sweep's enumeration rather than being a considered keep.

It does not fall under 044's keep-list: it is not a rejected-alternative rationale, not a non-obvious external constraint a reader would otherwise take for a bug, and not a still-standing overruled-review decision. It is a plain per-case why on an already-unambiguous instruction.

## What to do

In both `plugins/dev-skills/workflows/wf-review-cycle.js` and `plugins/dev-skills/workflows/wf-address-tasks.js`, in `cyclePeerPreflightPrompt()`'s prompt literal, change:

> "If it fails while `CODEX_API_KEY` is set, return available because the environment key may authenticate the real invocation."

to:

> "If it fails while `CODEX_API_KEY` is set, return available."

Keep the two copies byte-identical inside `review-cycle-core`, per 044's own constraint. No other clause in that sentence is in scope — the preceding three branches were already reduced by 044 and are not to be touched.

## Acceptance criteria

- The "because the environment key may authenticate the real invocation" clause (or any equivalent per-case rationale) is gone from `cyclePeerPreflightPrompt()`'s prompt literal in both files.
- `review-cycle-core` remains byte-identical between `wf-review-cycle.js` and `wf-address-tasks.js`.
- `wf-check` passes on both edited workflows.
- `node scripts/test-subagent-destroy-boundary.mjs` still passes — this prompt is one of its tracked rendered-prompt paths, so re-run its rendered-prompt diff after the edit and confirm the only change is the removed clause.
- Every suite named in `.github/workflows/tests.yml` passes with unchanged check counts elsewhere (only the one rendered prompt's content is expected to change).

## Validation

Render `cyclePeerPreflightPrompt()`'s output before and after the edit and diff it: the diff must contain only the removed why-clause, per 044's own validation method for prompt-literal reductions.
