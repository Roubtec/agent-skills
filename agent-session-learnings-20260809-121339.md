# Agent Session Learnings - 2026-08-09 12:13 UTC

Repository: Roubtec/agent-skills
Agent: Claude
Session focus: `address-reviews` batch over seven open PRs (#60, #64, #65, #66, #67, #68, #69), including two stacked chains, run to publication.
Transport: Temporary branch `learnings/session-20260809-121339` (no PR)

## Summary

- The cross-harness peer step earned its cost twice in one batch: on two separate PRs the codex peer raised a `blocking` finding on the exact fact the fresh reviewer had consciously weighted *below* the finding bar. One produced a genuine code fix, the other a decline that survived independent empirical verification. Neither would have been surfaced by a single review channel.
- The most expensive orchestration defect was mine and was silent: I launched one entry's reviewer without its paired peer, because the tool call I sent alongside it only *read* other entries' peer output. Nothing failed loudly; I caught it only when reconciling a status table.
- Two environment frictions cost real turns: a report-file guard rejecting `.md` as tool input, and a `dc-enter`/`dc-remove` root asymmetry that orphaned a 43 MB clone.

## Issues and Opportunities

### 1. Subagents inherit the orchestrator's shell cwd, breaking `dc-remove` symmetry

- Type: tooling
- Severity: medium
- Evidence: Three reviewer subagents assigned to worktrees `pr-65`, `pr-67` and `pr-68` all created disposable clones under one root, `/tmp/dc-<agent>-<hash>-3216547016`. That hash is `cksum` of **pr-65's** toplevel — the orchestrator's shell cwd when those agents were spawned. Verified by computing `git rev-parse --show-toplevel | cksum` per worktree rather than by trusting the reporting agent. One clone (43 MB) was left orphaned because `dc-remove <slug>` run from the agent's *own* worktree re-derives a different root and cannot see it.
- Impact: Wasted a reviewer's closing turns diagnosing why cleanup failed; left disk to reap manually at batch end. It also produced a misleading first diagnosis — the reporting agent framed it as a working-directory bug, and I initially propagated it as a collision hazard.
- Suggested improvement: Set `DC_AGENT` per subagent — `dc-enter`'s own header already names this as the way to avoid scope contention. A skill composing subagent prompts could inject `DC_AGENT=<slug>` automatically. Alternatively, prompts should require `cd`-into-worktree **before** any `dc-enter`, which several of this session's later prompts did explicitly.
- Repro/trigger: Any orchestrator that runs a `cd` in its own Bash tool and then spawns subagents expected to use `dc-enter`.
- Confidence: observed
- Note (correcting a plausible misreading): this is **not** a safety hole. `dc-enter` refuses an existing slug directory — non-zero, nothing on stdout, nothing removed — precisely so concurrent siblings sharing one scope cannot clobber each other mid-verification. The defect is cleanup asymmetry, not clobbering.

### 2. Report-file guard rejects `.md` even when the file is tool input

- Type: sandbox
- Severity: medium
- Evidence: A publisher subagent could not write a PR summary body to a `.md` file under the session scratchpad for use with `gh pr comment --body-file`; the same content at a `.txt` path was accepted and the comment posted normally.
- Impact: One failed turn per affected agent. Once known it is a trivial workaround, but each fresh subagent rediscovers it.
- Suggested improvement: Either exempt paths that are demonstrably tool input (outside the repo, under the session scratchpad), or document the `.txt` workaround in the skills that compose publisher prompts. This session added the hint to later prompts by hand.
- Repro/trigger: Any subagent writing a Markdown body file for `gh pr comment`/`gh pr review --body-file`.
- Confidence: observed

### 3. A `codex` peer can exit 0 having produced no verdict and no output file

- Type: tooling
- Severity: medium
- Evidence: The first peer invocation for PR #64 terminated mid-analysis (last line was the model narrating what it was about to do), exit code 0, with **no** `-o` output file created and ~448 KB of stderr consisting largely of whole files echoed back. A single retry under the same pinned settings returned a clean `VERDICT: PASS`.
- Impact: One wasted peer round-trip and an ambiguous outcome to classify — exit 0 reads as success, so only the missing outfile distinguishes it from a real verdict.
- Suggested improvement: The `review-cycle` peer contract already names `forfeited` for empty/unintelligible output; worth stating explicitly that **exit 0 with no outfile** is that case, so orchestrators check for the artifact rather than the exit status. Adding "keep the investigation focused, do not dump whole files, your final message must be the verdict block" to the peer prompt correlated with clean completions on all subsequent invocations (inferred, not controlled).
- Repro/trigger: Long peer prompts over large source files.
- Confidence: observed (the failure); inferred (the prompt mitigation)

### 4. Peer sandbox has no network, and peers try to use it anyway

- Type: agent-instructions
- Severity: low
- Evidence: The first peer invocation attempted `gh-review-threads` and hit connection failures, then stated it could not fetch PR threads. `codex exec --sandbox read-only` has no egress here.
- Impact: Minor wasted peer effort; a peer that believes it is missing evidence may hedge its verdict.
- Suggested improvement: State "the GitHub API is NOT reachable from this sandbox; everything you need is in the files and in this prompt" in every composed peer prompt. Doing so from the second batch onward eliminated the behavior.
- Repro/trigger: Any peer prompt that references PR threads without saying they are already inlined.
- Confidence: observed

### 5. `plugins/dev-skills/workflows/README.md` says `wf-check` is not on PATH; it is

- Type: docs
- Severity: low
- Evidence: That README states `wf-check` is "not on PATH … (checked 2026-08-05)" and documents a hand-rolled `sed`+`node --check` wrapper instead. A fixer subagent found `/usr/local/bin/wf-check` present and ran both forms; all exit 0.
- Impact: Every workflow-touching agent runs the longer wrapper, and one spent turns reconciling the contradiction.
- Suggested improvement: Refresh the claim, or express it as a `command -v wf-check ||` fallback so it cannot go stale.
- Repro/trigger: Any change to a `wf-*.js` source.
- Confidence: observed
- Deliberately not fixed in-session: it surfaced during a close-out round scoped to a non-semantic wording fix, and expanding that scope would have defeated the close-out.

### 6. Pairing the peer with the reviewer is easy to drop silently

- Type: workflow
- Severity: medium
- Evidence: For PR #66 I spawned the fresh reviewer and, in the same message, a Bash call that merely *read* two other entries' finished peer output. No peer was launched for #66. Nothing errored; I detected it only when re-reading my own status table, and had to launch the peer afterwards against the (unchanged, clean) committed tree.
- Impact: A near-miss on shipping an entry with half its verification. The recovery was sound only because the tree had not moved.
- Suggested improvement: `address-reviews` fans out per entry across many turns, and "launch peer beside reviewer" is stated as prose. A per-entry ledger the orchestrator is told to emit each round — entry, round, reviewer status, peer status — would make an omission visible at a glance. Alternatively, state that a reviewer launch and its peer launch must occupy the **same tool-call block**, with nothing else in it.
- Repro/trigger: Batch orchestration where entries advance at different rates and each turn mixes launching with reading.
- Confidence: observed

### 7. `ping-contributing` means a batch has no stable "zero unresolved" end state

- Type: agent-instructions
- Severity: low
- Evidence: After PR #68 published and re-pinged codex, that bot posted three new P2 findings minutes later. A final sweep showed #68 at 3 unresolved threads while the other six sat at 0. One new finding re-raises a concern this batch had already declined with recorded reasoning.
- Impact: Momentary ambiguity about whether the batch had actually finished, and a real temptation to start another cycle that would itself ping again.
- Suggested improvement: Say plainly in the skill that pinging is expected to generate a fresh round *after* publication, that such threads belong to the next invocation rather than this batch, and that the final summary should report them as new rather than as leftovers. Possibly also note that a re-raised finding already answered in a Summary comment is covered by the repo's "don't re-raise" convention.
- Repro/trigger: Every default (`ping-contributing`) batch.
- Confidence: observed

### 8. Cross-harness severity disagreement is the peer step's main yield — worth naming

- Type: workflow
- Severity: low
- Evidence: Twice the fresh reviewer **passed** while recording the finding as a pass note, and the peer independently tagged the *same fact* `blocking`: PR #65 (a failed re-review still republishing pre-rename assessments) and PR #68 (a single-URL push read-back). #65's became a real fix that deleted an asymmetry; #68's became a decline that a second reviewer then verified empirically in throwaway repos, discovering the proposed fix was broken in both shell quoting forms. A third case ran the other way — the round-2 peer corrected the *fixer's* evidence for its own decline.
- Impact: Positive, but only because the orchestrator relayed both channels verbatim and told the fixer they agreed on substance and differed on severity.
- Suggested improvement: The `review-cycle` skill already has the "channels agree on substance, differ on severity" instruction; this run is concrete evidence it is load-bearing. Worth keeping prominent, and worth noting that the reviewer's pass note and the peer's blocking finding should be handed over *together*, verbatim, rather than the orchestrator adjudicating between them.
- Confidence: observed

## Follow-Up Candidates

- Inject `DC_AGENT=<per-subagent-slug>` into composed subagent prompts, or require `cd` before `dc-enter`.
- Document (or lift) the `.md` report-file guard for scratchpad tool-input files.
- Treat "peer exited 0 but wrote no outfile" as an explicit `forfeited` outcome in the peer contract.
- Add the "no network in the peer sandbox" line to every composed peer prompt.
- Refresh or make self-checking the `wf-check` PATH claim in `plugins/dev-skills/workflows/README.md`.
- Consider a per-entry round ledger for `address-reviews`, so a missing peer launch is visible.
- State in `address-reviews` that post-publication ping findings are the next cycle, not batch leftovers.
