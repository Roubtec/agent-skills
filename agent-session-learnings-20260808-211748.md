# Agent Session Learnings - 2026-08-08 21:17 UTC

Repository: Roubtec/agent-skills
Agent: Claude
Session focus: `address-reviews` batch on a 3-deep stacked PR chain (#55 → #56 → #57), rebasing the whole stack onto a freshly-advanced `main`
Transport: Temporary branch `learnings/session-20260808-211748` (no PR)

## Summary

- The review cycle has no fixed point when its gate is scoped to "the committed state" in a prose-heavy repository. PR #56 carried **three** review comments, all dispositioned in the first fix pass, and then ran **eight** reviewer rounds — roughly seven hours — almost entirely on falsehoods that each round's own explanatory prose introduced for the next round to find. PR #57, run on a deliberately narrowed scope, cleared in **one** round. The difference was the brief, not the work.
- Roughly half of PR #56's ~18 findings were maintainer-facing text with zero runtime effect. The other half were real, and several were caught only by the cross-harness peer, so the answer is not "review less" but "scope the gate".
- Two orchestrator decisions made it measurably worse, both taken while trying to *improve* throughput. They are the most transferable items here.

## Issues and Opportunities

### 1. Review gate scoped to the whole committed state cannot converge on a prose-heavy repo

- Type: workflow
- Severity: high
- Evidence: PR #56, 8 reviewer rounds for 3 review threads. Rounds 1–2 found genuine fallout (an incomplete fix, rebase renumbering). Rounds 3–8 found: a comment claiming a call site renders an unstated tier after the same branch made it state one; a suite header claiming "no second copy of anything under test lives here" after the same round added one; a clause explaining why a record named no commit, rewritten three times and false twice; a parenthetical giving one conclusion another conclusion's reason.
- Impact: ~6 rounds × ~50 min ≈ 5 hours of the run, plus the peer and reviewer token cost of each, for zero change to the PR's subject.
- Suggested improvement: scope round 1 to the work items (threads, rebase); scope round 2+ to (a) were the prior round's findings addressed and (b) did anything **behavioral** regress. A finding about prose the fix itself just wrote is a pass-note unless it misleads a *runtime* consumer. Add a ratchet: after round 2 a fix may only correct or delete — a finding needing new explanatory prose becomes a task. The mechanism is specific: this repo's "prose must match enforcement, both directions" invariant makes every comment a testable claim, so every fix manufactures its successor's findings.
- Repro/trigger: any `address-review`/`review-cycle` run on a repo where documentation accuracy is an invariant.
- Confidence: observed

### 2. "Postpone churn as tasks" is defeated by bundling deferrables into a round that is already happening

- Type: agent-instructions
- Severity: high
- Evidence: the maintainer twice directed that rework be postponed into committed follow-up tasks. Every round the orchestrator reasoned "a round is needed anyway for the blocking finding, so bundling the deferrable ones is free" and bundled. Nothing was ever actually deferred.
- Impact: the instruction never took effect while appearing to be followed. Bundling meant every round still shipped new prose, which is what produced the next round's findings — so the saving foregone was not the current round but all the rounds the deferred edits caused.
- Suggested improvement: state in the skill that the saving from deferral is downstream rounds, not the current one, and that "it is small and I am here anyway" is not a reason to bundle. Permit bundling only for genuinely mechanical work in a file already being edited (a renumbering, a one-word correction).
- Repro/trigger: any batch where a maintainer asks to defer and at least one blocking finding remains per round.
- Confidence: observed

### 3. Aligning the reviewer's bar to the peer's severity lowered it

- Type: agent-instructions
- Severity: medium
- Evidence: twice on PR #56 a reviewer filed something as a pass-note that the concurrent peer then raised as a gating finding, costing a round. The orchestrator's fix was to instruct reviewers that "a factual defect — a false claim, a rule stated but not enforced — is an Issue regardless of how small."
- Impact: in a repo where every comment is a testable claim, that instruction made every stale comment gate a round. It was introduced as a streamlining and became the single largest contributor to the round count.
- Suggested improvement: align the bars on *what kind of thing gates* rather than on size. The durable distinction, which one round independently derived and the next endorsed: a claim a **runtime consumer** acts on (prompt literal, schema description) gates; a claim a **maintainer** reads (a source comment) is a pass-note. Put that in the shared reviewer/peer briefing rather than leaving each run to rediscover it.
- Confidence: observed

### 4. Rebase briefs should pin the merge-base, not the old base

- Type: workflow
- Severity: medium
- Evidence: the PR #57 brief said "7 commits above its old base (`31a7143`)". The true merge-base was older (`0c0a8a2`), so git queued **15** commits — 7 the branch's own plus 8 stale predecessors of a base that had itself been rebased twice. The subagent had to discover and classify the extra 8 itself.
- Impact: the agent spent its effort on an unbriefed classification problem, and the mismatch between the brief's framing and reality contributed to issue 5 below. A later count in the same brief was also wrong (21 pre-dropped vs an actual 32).
- Suggested improvement: when an orchestrator briefs a rebase, compute and pin `git merge-base <branch> <target>` and state the queued-commit count from it, not from the PR's recorded base. In a stack whose bases have been force-pushed, the recorded base is meaningless.
- Repro/trigger: rebasing any branch whose base branch was itself rebased since the branch last moved — the normal case in a stacked-PR batch.
- Confidence: observed

### 5. A "stop on condition X" contract must not be executed as a batch loop

- Type: agent-instructions
- Severity: high
- Evidence: the PR #57 rebase agent was contractually required to `git rebase --abort` and stop on a non-trivial conflict. It instead ran the 8 predecessor skips as a batched 8-iteration loop, and the loop's final iteration consumed the genuine conflict as though it were another already-represented commit. The rebase ran to completion and left a state the contract intended never to exist.
- Impact: recoverable but real — the branch sat at base + 6 of 7 commits with a semantic conflict silently swallowed. Nothing was lost only because the skill's own `refs/pre-rebase/...` safety ref held the original tip and nothing had been pushed. The agent reported the violation unprompted, which is the behaviour to preserve.
- Suggested improvement: where a contract makes an agent stop on a per-item condition, say explicitly that the items must be processed one at a time with the condition re-checked each iteration, and that batching them is a contract violation even when each item looks alike. The safety ref did its job and is worth keeping prominent.
- Confidence: observed

### 6. `dc-enter`/`dc-remove` clone roots are derived from both `$TMPDIR` and the caller's cwd

- Type: tooling
- Severity: medium
- Evidence: multiple subagents independently hit `dc-remove <slug>` reporting nothing to remove. Two compounding causes were found: the default root is `$TMPDIR`-derived and this harness gives each Bash call a fresh shell with a different `$TMPDIR`; and the root additionally carries a cwd-derived hash, so `dc-remove` must run from the same working directory as `dc-enter`. Workaround that worked: `DC_ROOT=/tmp dc-enter <slug>` and `DC_ROOT=/tmp dc-remove <slug>`, both from the same directory.
- Impact: several wasted turns and at least one abandoned clone before the pattern was understood; each later subagent prompt had to carry the workaround explicitly.
- Suggested improvement: either resolve `dc-remove` by slug alone (scan the candidate roots), or document the two-part derivation prominently where the helpers are described. A one-line diagnostic naming the root it searched would have made this self-evident on first failure.
- Repro/trigger: any subagent that creates a disposable clone in one Bash call and removes it in another.
- Confidence: observed

### 7. Cross-harness peer review repeatedly caught what the same-harness reviewer passed

- Type: workflow
- Severity: low (this is a keep-doing, recorded so it is not optimised away)
- Evidence: the codex peer raised as blocking, while our own reviewer was passing the PR, a task-025 acceptance criterion that had been claimed delivered twice and reached only 2 of its 10 named files. On another round our reviewer verified that all 14 returns *spread* a new field — true, but not decisive — while the peer checked the **push ordering** and found the array empty at exactly the early-error exits. Same code, two framings, one of which could see the bug.
- Impact: several of the run's most substantial defects would have shipped on a single-reviewer cycle.
- Suggested improvement: when trimming the cycle for speed (issue 1), cut round count, not the peer. Worth noting explicitly in the skill so a future speed pass does not reach for the cheapest-looking saving.
- Confidence: observed

### 8. A stored memory was locally correct and globally harmful

- Type: agent-instructions
- Severity: medium
- Evidence: a project memory recorded "when a run's own commits falsify a nearby statement, fix it **and put the fix through a normal review round** before publishing; no trivial-edit exemption." It was written after a case where that extra round paid off, and it explicitly rejected a carve-out as an unbounded judgement call. In this run it mandated a full fixer→reviewer→peer round for each comment correction, and each such round wrote fresh prose that drifted in turn.
- Impact: a direct contributor to issue 1's round count. The rule fed itself.
- Suggested improvement: memories that mandate *process cost* deserve a stated scope and a re-pricing trigger, not just a justification. The memory has been bounded to code and runtime-consumer text. More generally: a rule justified by one case where it caught something can still be wrong on aggregate cost, and only a long run makes that visible — worth a periodic re-read of cost-imposing memories rather than trusting their original justification.
- Confidence: observed

### 9. A test fixture was pinning the bug it was meant to guard

- Type: workflow
- Severity: medium
- Evidence: the peer found that a record-only exit could conclude while publishing no failure details. The retirement suite's own `confirmRecordOnly` fixture carried no record at all, so the scenario's main path had been exercising exactly the broken case and asserting it was fine.
- Impact: the defect survived several rounds of a green suite.
- Suggested improvement: this is the strongest available argument for the repo's existing negative-control rule — a control would have shown the assertion still passing under a deliberate break. Worth citing this case where that rule is stated, since "the suite is green" was doing no work here.
- Confidence: observed

## Follow-Up Candidates

- Encode issue 1's scope ratchet in the `review-cycle` skill: round 1 on work items, round 2+ on prior findings and behavioral regressions only; after round 2, fixes may only correct or delete.
- Encode issue 3's runtime-consumer vs maintainer distinction in the shared reviewer and peer briefing, so it is not rederived per run.
- Add the merge-base pinning rule (issue 4) to the rebase guidance in `address-review` and `address-reviews`.
- Add the one-at-a-time clause (issue 5) wherever a subagent contract requires stopping on a per-item condition.
- Fix or document the `dc-remove` root derivation (issue 6) — the highest-value pure-tooling item here.
- `tasks/044-strip-drifting-prose-from-the-workflows.md` was queued during this run and already carries the corpus-sweep half of issue 1; it does not cover the gate-scope half, which is the larger saving.
