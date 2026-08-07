# Agent Session Learnings - 2026-08-07 17:25 UTC

Repository: Roubtec/agent-skills
Agent: Claude
Session focus: Implement task 017 via `address-tasks` (PR #47, 27 commits, ~10 implement→review rounds), then `resolve-open-questions` over the five parked decisions
Transport: Temporary branch `learnings/session-20260807-172543` (no PR)

## Summary

- `wf-check` and `wf-status` are documented in the container instructions as baked and on `PATH`, but neither exists. Every workflow-touching agent this session rediscovered this and fell back to the repo's hand-rolled wrapper. This is the highest-value fix here: either bake them or correct the doc.
- A negative control that silently fails to mutate is indistinguishable from a passing one. It happened three times this session before an agent built a landing assertion. This belongs in the review-side skills as an explicit instruction, not as a thing each agent rediscovers.
- Five consecutive `grep`-based sweeps of the same small population were each incomplete, because each matched one phrasing. Two of them were mine, and I relayed one to the user as fact.
- Bounding a review round ("report only what is factually false, not further refinements") converged a loop that four unbounded rounds had not. Cheap, reusable, and worth writing into the review skills.

## Issues and Opportunities

### 1. `wf-check` / `wf-status` documented as baked but absent from `PATH`

- Type: tooling
- Severity: high
- Evidence: `command -v wf-check` and `command -v wf-status` both return nothing in this container. The container instructions list both under "Workflow debugging" as available on `PATH`. `plugins/dev-skills/workflows/README.md` already carries a dated note ("not on PATH in this repo's powbox image, checked 2026-08-05") and documents a hand-rolled `sed` + `node --check` stand-in wrapper.
- Impact: every agent that validated a workflow this session re-probed for `wf-check`, then read the README's fallback, then ran a four-line shell wrapper — repeated across roughly ten rounds and three separate agents. The wrapper also carries a documented caveat that its pass does not establish what the real tool would.
- Suggested improvement: bake `wf-check`/`wf-status` into the image, or remove them from the container instructions' tool table until they land. A doc that promises a tool that is absent costs a probe plus a fallback read on every single use.
- Repro/trigger: any session that edits `plugins/dev-skills/workflows/wf-*.js`.
- Confidence: observed

### 2. Stale background watcher processes survive across sessions and can poison `pgrep`-based waits

- Type: sandbox
- Severity: medium
- Evidence: `pgrep -af "pgrep -f"` shows at least five long-lived `bash -c` loops from *earlier* sessions still polling, referencing other sessions' scratchpad paths (e.g. one waiting on `codex exec --sandbox read-only` and then `cat`ting a `peer-review-pr42.txt` that belongs to a prior run). They appear to spin indefinitely.
- Impact: two hazards. They consume a slot and CPU forever; and because their own command line contains the pattern they poll for, a naive `pgrep -f "codex exec"` in a *new* session matches the stale watcher rather than the real process. I avoided this only by matching on a worktree-specific path. An agent using the obvious pattern would wait on the wrong PID or return immediately.
- Suggested improvement: reap orphaned background shells at container start or session start; or document the hazard and recommend matching on a session-unique substring. A `powbox`-side "list/kill orphaned session watchers" helper would also serve.
- Repro/trigger: any session that backgrounds a wait-loop and is then interrupted or ends without cleanup.
- Confidence: observed

### 3. A negative control that fails to mutate looks exactly like a passing one

- Type: agent-instructions
- Severity: high
- Evidence: three times this session, an agent mutating a JS template literal used unescaped backticks, the edit did not match, the file was unchanged, and the test suite reported `0 failing` — the same output as a genuine pass. Twice it was caught by luck or by a later reviewer; the last agent finally wrote a mutation helper that exits 9 when the target string does not match, and reported that it fired on one of its own edits.
- Impact: a false-green control is worse than no control, because it is reported as evidence. One of these produced a "verified by mutation" claim that had verified nothing.
- Suggested improvement: add to the reviewer/fixer prompt contracts in `address-review`, `address-tasks*`, and `review-cycle`: when running a negative control, assert the mutation landed (non-zero diff, or an exact-string replace that fails loudly on no-match) *before* trusting the result. One sentence, and it converts a silent failure into a loud one.
- Repro/trigger: any control that edits code inside a template literal or any file with escaping.
- Confidence: observed

### 4. Single-pattern `grep` sweeps repeatedly reported as exhaustive

- Type: agent-instructions
- Severity: medium
- Evidence: the question "which skills are named for a subagent to invoke?" was swept five times over the same seven files. Each sweep matched one phrasing and missed others — "invoke the \`X\` skill" missed "invoke that skill where available", which missed the unbackticked "per the write-tasks skill conventions", which missed "delegated to the \`rebase-stack\` skill in a subagent", which missed "run a scoped \`review-cycle\`". Four review rounds each falsified a claim built on the previous sweep. Two of the incomplete sweeps were mine, and I stated one to the user as settled fact before a reviewer disproved it.
- Impact: four rounds of implement→review spent re-qualifying one sentence, plus a user-facing correction.
- Suggested improvement: for any "find every place X is referenced" question, require at least two independent patterns (bare token plus a verb window) and treat the result as a floor. Worth a line in the review skills' grounding step, next to the existing cross-branch-read guidance.
- Confidence: observed

### 5. A claim restated in N places drifts; re-qualifying it does not converge

- Type: agent-instructions
- Severity: medium
- Evidence: one supporting sentence was falsified in four consecutive rounds — "exactly two referents", then "the only unbounded referent", then "always possessively", then "the only referent whose own behaviour is destructive". Each fix added a sharper qualifier; the next round broke it. Deleting the claim shape (dropping universals and counts, listing the items and the two facts that mattered) converged in one round with both reviewers passing.
- Impact: roughly four avoidable rounds.
- Suggested improvement: this repo's `skills-encode-intent-not-specs` lesson has a sibling worth writing down: when successive rounds each falsify a *different* version of one claim, the defect is the claim's shape, not its wording. Brief the fixer with the list of qualifiers already tried and falsified, and instruct it not to write another.
- Repro/trigger: any prose claim that generalises over a swept set.
- Confidence: observed

### 6. Bounding a review round's remit converged a loop that four unbounded rounds had not

- Type: workflow
- Severity: medium
- Evidence: after four rounds of ever-finer prose findings, I gave both reviewers an explicit remit — "report only (a) a statement that is factually false, or (b) a functional defect; do not propose further precision refinements; a clean report is the expected outcome" — and both returned clean on substantive checks that still found real coverage (a full re-sweep, eight fact checks, six mutation controls).
- Impact: without it, the loop was on track to consume more of the 12-round cap on wording.
- Suggested improvement: give `address-tasks*` and `review-cycle` an explicit late-round remit narrowing: once a PR has passed once, subsequent rounds should gate on falsity and defects rather than on further precision. This is distinct from lowering the bar — the bounded round still ran every control.
- Confidence: observed

### 7. `Agent` tool ignored `run_in_background: false`

- Type: agent-instructions
- Severity: low
- Evidence: implementer and reviewer spawns were issued with `run_in_background: false` and every one returned "Async agent launched successfully... The agent is working in the background."
- Impact: none here — the orchestration waited on completion notifications anyway — but `address-tasks-serialized`'s correctness argument rests on "spawn one agent, wait for its result", and a skill author reading that flag as load-bearing would be relying on something that does not take effect.
- Suggested improvement: either honour the flag or note in the skills that foreground execution is not available and the phase discipline must come from waiting on notifications.
- Confidence: observed

### 8. A task's specification changed three times mid-implementation via a concurrently-open PR

- Type: workflow
- Severity: medium
- Evidence: task 017's spec was being revised on the open `batch-wrap-up` PR while 017 was being implemented. It grew from five to seven spawning skills and two to three workflows, added three delivery routes, and replaced the prescribed verification method. The branch had to be rebased mid-run and re-scoped twice.
- Impact: one rebase, one full re-scope, one wasted implementation round against superseded scope.
- Suggested improvement: add a line to `address-tasks*`' bootstrap: before implementing a task file, check whether any open PR modifies that file (`gh pr list` plus a diff of the task path), and if so base on it or wait. Cheap check, and it would have caught this at minute one — I found it only by chance while inspecting branch state.
- Repro/trigger: any batch run started while a task-curation PR is open.
- Confidence: observed

### 9. `git checkout -- <dir>` during a negative control reverted an agent's own uncommitted work

- Type: agent-instructions
- Severity: low
- Evidence: an implementer restoring a control with `git checkout -- plugins/dev-skills/workflows/` also discarded its own in-progress README edit in that directory. Self-reported, re-applied, verified; nothing shipped from that state.
- Impact: near-miss only, but the silent version of this loses work an agent believes it saved.
- Suggested improvement: when a prompt authorises temporary mutations for a control, tell the agent to restore by exact path (or via a saved copy), never by directory. Fits naturally beside the destroy-boundary text this very PR added.
- Confidence: observed

## Follow-Up Candidates

- Bake `wf-check`/`wf-status`, or drop them from the container instructions' tool table until they exist (item 1).
- Reap orphaned background watcher shells at session start, and document the `pgrep` self-match hazard (item 2).
- Add "assert your mutation landed" to the reviewer/fixer contracts in `address-review`, `address-tasks*`, `review-cycle` (item 3).
- Add a two-pattern minimum for exhaustive-sweep grounding in the review skills (item 4).
- Add a late-round remit narrowing to `address-tasks*` and `review-cycle` (item 6).
- Add an open-PR check on the task file to `address-tasks*` bootstrap (item 8).
- Note in the skills whether `Agent` foreground execution is actually available (item 7).
