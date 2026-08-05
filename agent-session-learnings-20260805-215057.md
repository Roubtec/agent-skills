# Agent Session Learnings - 2026-08-05 21:50 UTC

Repository: Roubtec/agent-skills
Agent: Claude
Session focus: `address-tasks` batch of five pre-planned task files (012a, 014a, 020, 031a, 034) run in parallel worktrees, each through an implement→review→fix loop with codex peer opinions, delivered as PRs #40-#44 plus a local review stack.
Transport: Temporary branch `learnings/session-20260805-215057` (no PR)

## Summary

- Four tools the container documentation lists as baked are absent from `PATH` (`markdownlint-cli2`, `actionlint`, `wf-check`, `wf-status`), and parallel subagents each rediscovered this independently and then diverged in how they compensated — so validation coverage differed between branches of the same batch for no principled reason.
- Peer review paid for itself decisively: three of the four round-1 blockers came from codex on branches our own reviewers had passed, including one where the pre-fix command demonstrably deleted `refs/heads/main`. It was also wrong twice, and both times a cheap orchestrator-side check settled it faster than another round would have.
- The orchestration gaps worth fixing are small and specific: detached peer processes produce no completion notification, peers do not label blocker-vs-follow-up until asked, and reviewers only mutation-test a new regression suite if told to.

## Issues and Opportunities

### 1. Four documented tools are absent from `PATH`

- Type: tooling
- Severity: high
- Evidence: `command -v` returns nothing for `markdownlint-cli2`, `actionlint`, `wf-check`, and `wf-status`. The container instructions list `markdownlint-cli2` 0.23.2 and `actionlint` 1.7.12 as "the baked default" and describe `wf-check`/`wf-status` in the tooling table. Three separate subagents reported the absence unprompted; one worked around it with `npx --yes markdownlint-cli2` (which succeeded), another skipped Markdown linting entirely, and a third fell back to the wrapped `node --check` documented in the repo's own workflows README.
- Impact: repeated rediscovery across parallel agents, and inconsistent validation between branches in one batch — two branches were Markdown-linted and two were not. Each rediscovery cost a turn or two of probing.
- Suggested improvement: either bake the four tools as documented, or correct the tooling table to say they are reachable via `npx`/not present. If `wf-check` is intended to exist, note that this repository's `plugins/dev-skills/workflows/README.md` already carries a dated "not on PATH" note that agents are trusting over the container docs — the two should agree.
- Repro/trigger: any run that lints Markdown or GitHub Actions, or that validates a `wf-*.js` workflow script.
- Confidence: observed

### 2. `yq` is the jq-based wrapper, and the docs do not say so

- Type: docs
- Severity: medium
- Evidence: `yq --version` prints `yq 4.1.2` / `jq-1.7` — the jq-wrapper `yq`, not mikefarah's Go implementation, despite the matching-looking major version. Expressions must be jq syntax. One subagent flagged this explicitly after testing; the version string alone would mislead anyone who assumed mikefarah v4.
- Impact: low this run because the skill under test quotes `yq -r 'has("shadow")'`, which is valid jq. A run that wrote mikefarah-style expressions would fail confusingly, and the `4.1.2` version string actively points the wrong way.
- Suggested improvement: one clause in the tooling table — "`yq` (jq-based wrapper; expressions are jq syntax)".
- Repro/trigger: any skill or script that authors a `yq` expression from memory.
- Confidence: observed

### 3. Detached background processes give no completion notification

- Type: workflow
- Severity: medium
- Evidence: five `codex exec` peer reviews were launched with `&` inside a single `run_in_background` Bash call. The task notification fired when the *launcher* exited (~5 s), not when the peers finished. Detecting completion then required polling `pgrep` and the output files across several turns, repeated for four review rounds.
- Impact: several wasted turns per round, and the polling output competes for context. Multiplied across 15 peer reviews this run.
- Suggested improvement: document (in `address-tasks`/`address-reviews`, which both prescribe the backgrounded `codex exec` form) that each peer should be launched as its *own* backgrounded call so each gets a completion notification, rather than fanned out inside one script. Alternatively note the polling requirement explicitly so agents budget for it instead of discovering it.
- Repro/trigger: any skill fanning out several long-running CLI peers at once.
- Confidence: observed

### 4. Peer prompts do not ask for blocker-vs-follow-up labelling

- Type: agent-instructions
- Severity: medium
- Evidence: across six rounds on one task, peer findings shrank steadily but never stopped, and the exit condition ("peer has no unaddressed grounded findings") kept the loop open. Round 6's peer self-labelled its finding "Follow-up", which is what allowed a clean exit; earlier rounds gave no severity signal, so each required orchestrator adjudication to classify. One round-5 peer finding was asserted as a criterion-violating blocker and turned out, on transcript evidence, to describe behaviour inherited verbatim from the base branch.
- Impact: one task took six rounds where the last two were arguably follow-up material; classifying each finding cost orchestrator turns.
- Suggested improvement: have the peer prompt in `address-tasks`/`address-tasks-serialized` require an explicit per-finding label — blocker (violates a stated acceptance criterion) vs. follow-up — and require a claimed blocker to say which criterion and how it was checked. Grounding rules already exist; this is the missing severity axis.
- Repro/trigger: any converged branch late in its review loop.
- Confidence: observed

### 5. Reviewers do not mutation-test a regression suite unless told to

- Type: agent-instructions
- Severity: medium
- Evidence: a round added a regression suite that passed 32 checks; the next reviewer mutation-tested it and found four documented invariants that could be mutated away with every check still green. Once mutation testing was written into the reviewer prompt, subsequent reviewers found more (one reported the fixer's "10 mutants killed" claim was understated; another found a suite whose scenario mutated a shared module-level object, so 35 unintended traversals of the wrong code path went unreported).
- Impact: a suite that passes vacuously is worse than none, because it is cited as evidence in later rounds. Two rounds were spent recovering this.
- Suggested improvement: add to the reviewer contract — when a round introduces or extends an automated test, the reviewer must verify it *fails* against the pre-fix state rather than accepting that it passes against the post-fix state.
- Repro/trigger: any task whose acceptance criteria are behavioural and get pinned by a new suite.
- Confidence: observed

### 6. Cheap factual disputes should be settled by the orchestrator, not another round

- Type: agent-instructions
- Severity: medium
- Evidence: a peer reported a shell bug in `${path//\/\///}`. One Bash call showed the code collapses `//` to `/` correctly and the peer had misread it. Separately, two agents reached opposite conclusions about the same function; both turned out right about *different* code paths, twice, and each time a transcript settled it in one focused round while argument would not have.
- Impact: low where caught early, but a disputed finding taken at face value would have caused an unnecessary "fix" to correct code.
- Suggested improvement: state in the dispute-handling section that the orchestrator should verify a *checkable* claim directly before spending a round on it, and that when two agents disagree the resolution is a transcript plus a baseline comparison against the base branch — not a third opinion. The "both were right about different paths" outcome occurred twice and is worth naming as a likely shape.
- Repro/trigger: any run with a second-opinion reviewer.
- Confidence: observed

### 7. The safe-verification primitive still does not exist container-side

- Type: sandbox
- Severity: medium
- Evidence: `dc-enter`/`dc-remove` are absent and `DC_ROOT` is unset, so empirical verification still has no safe home — which is exactly the gap task 020 (now PR #42) exists to close on the repo side. Fresh evidence this run: a subagent's own hermetic *test suite* carried an unchecked empty-path variable that, with a stub returning nothing, ran `rm -rf` and `gc --prune=now` against a stand-in repository. That is the original incident's shape reproduced inside the test suite written to prevent it.
- Impact: none realised — it was caught and guarded — but it confirms the hazard recurs even among agents explicitly primed about it.
- Suggested improvement: proceed with the powbox-side bake already filed (helpers on `PATH`, `DC_ROOT` pointed outside `/workspace`). This run supplies a concrete second incident to justify the priority.
- Repro/trigger: any subagent authorised to verify a claim empirically.
- Confidence: observed

### 8. Peer opinions earned their cost — record for the cost/benefit question

- Type: workflow
- Severity: low
- Evidence: 15 codex peer reviews across the batch. Three of four round-1 blockers came from the peer on branches our own reviewers had passed, including a `prune-branches` sweep that deleted `refs/heads/main` via symref dereference, a helper that cloned the wrong repository when a path ended in a newline, and a retirement contract hole. The peer was wrong twice (one misread expansion, one inherited-behaviour claim).
- Impact: positive — these were safety defects in skills whose purpose is safe destructive operations.
- Suggested improvement: keep peer opinions on by default for this skill family; the two false positives were both cheap to refute and neither caused a wrong change. Worth citing if the default is ever revisited.
- Repro/trigger: n/a — evidence entry.
- Confidence: observed

## Follow-Up Candidates

- Reconcile the container tooling table with reality for `markdownlint-cli2`, `actionlint`, `wf-check`, `wf-status`; add the `yq`-is-jq-flavoured clause.
- Amend the peer-review prompt contract in `address-tasks` / `address-tasks-serialized` to require per-finding blocker-vs-follow-up labelling with the criterion named.
- Add "verify a new test fails against the pre-fix state" to the reviewer code-quality checklist.
- Add "settle checkable disputes yourself; resolve agent disagreements with a transcript and a base-branch baseline" to the dispute-handling guidance.
- Document that fanned-out CLI peers should each be launched as their own backgrounded call so completion notifications arrive per peer.
