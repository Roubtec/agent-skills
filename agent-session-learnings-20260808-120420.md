# Agent Session Learnings - 2026-08-08 12:04 UTC

Repository: Roubtec/agent-skills
Agent: Claude
Session focus: `address-reviews` batch across 8 PRs (#51–#58) — per-PR worktree, delegated fix → fresh reviewer + codex peer → fix-up rounds → publish
Transport: Temporary branch `learnings/session-20260808-120420` (no PR)

## Summary

- The cross-harness peer step **silently did not run** for the first ~6 minutes: `codex exec` launched as a background command blocks forever on stdin. Without a CPU-vs-elapsed check it would have timed out into a non-blocking `timeout` outcome on all five entries, and the batch would have published reporting "peer unavailable" while believing it had cross-harness verification. The launch snippet in `review-cycle`'s own peer step omits the fix.
- A bare `VERDICT: PASS` from the peer is 13 bytes of unsubstantiated output. It is indistinguishable from a peer that read nothing, and the contract currently permits it.
- Four of the eleven fix-up rounds this run were spent on **agent-authored task files citing things that do not exist** — a stale ordinal, a fabricated constant name. This is mechanically detectable and is not being detected.

## Issues and Opportunities

### 1. `codex exec` hangs forever on stdin when launched non-interactively

- Type: tooling
- Severity: high
- Evidence: Five concurrent peer reviews sat at `00:00:00` CPU against up to `05:42` elapsed. Their stderr showed `Reading additional input from stdin...`. The identical command with `< /dev/null` appended returned promptly. All five were killed and relaunched; all five then completed normally.
- Impact: ~6 minutes of wall-clock across five entries, plus a near-miss on correctness — the peer outcome vocabulary treats `timeout` as explicitly non-blocking, so every entry would have published with the peer silently absent rather than failing loudly. The failure is invisible unless someone compares CPU time to elapsed time.
- Suggested improvement: append `< /dev/null` to the `codex exec` invocation in the `review-cycle` skill's "The peer step" launch snippet (both mirrors). Separately, when `peer-review-run` gains the strength pin it should own stdin handling so no caller can reintroduce this.
- Repro/trigger: any `codex exec ... "$prompt"` run from a non-interactive/background context with an inherited, never-closed stdin.
- Confidence: observed

### 2. A peer `PASS` carries no evidence it reviewed anything

- Type: agent-instructions
- Severity: medium
- Evidence: Nine of eleven peer rounds returned exactly `VERDICT: PASS` (13 bytes, no trailing newline). The rounds that returned `ISSUES` gave precise `file:line` findings that later proved correct, so the peers were genuinely working — but a passing round produces output identical to a peer that read nothing and guessed.
- Impact: the gate cannot distinguish a substantive pass from an empty one, and the `forfeited` outcome (defined for "empty or unintelligible output") never fires for a well-formed but hollow pass.
- Suggested improvement: require one line of basis on PASS — e.g. `VERDICT: PASS` followed by a single sentence naming what was checked and the strongest thing that could have been wrong. Cheap, and makes a hollow pass visible.
- Repro/trigger: every peer round that passes.
- Confidence: observed (that the output is unsubstantiated); inferred (that a hollow pass could hide there)

### 3. Agent-authored task files cite identifiers and positions that do not exist

- Type: automation
- Severity: high
- Evidence: On PR #55, a task file created by this run cited `MAIN_CHECKOUT_STATUS_SCHEMA` — present nowhere in the repository; the real constant is `MAIN_CHECKOUT_SCHEMA`. The same file located an instruction as "the last bullet" of a block where it was second-to-last. On PR #58, a "re-derive the set" grep recipe reached 3 of the 10 sites it claimed to cover. Each cost a full fix-up round (fix + fresh reviewer + peer).
- Impact: four of this run's eleven fix-up rounds. Two of them fired *after* all substantive work had already passed its gate — had the batch published at that point, a spec an implementer executes would have shipped naming a constant that does not exist.
- Suggested improvement: a `scripts/test-task-file-citations.mjs` in the CI suite that, for every `tasks/*.md`, extracts backticked tokens matching an identifier or path shape and fails on any with zero hits elsewhere in the repository. This catches fabricated constants and dead paths mechanically. Ordinals ("the last bullet") are not greppable and stay a review concern — but the guidance can say to anchor on a verbatim quote instead of a position, which survives insertion.
- Repro/trigger: any run that writes or edits a task file citing repository symbols.
- Confidence: observed

### 4. Shared scratchpad collisions still happen despite the standing rule

- Type: sandbox
- Severity: medium
- Evidence: A publisher subagent wrote to a fixed shared-scratchpad filename (`<scratchpad>/x`), noticed, removed it, and reported the risk that it had truncated a sibling's file of that name. Its prompt carried the per-task-unique-name rule.
- Impact: none this run (the orchestrator verified its own peer artifacts were intact), but this is the second recorded instance of the same class in this container's history.
- Suggested improvement: the rule is stated but relies on compliance. Consider a per-subagent scratchpad subdirectory allocated by the harness and exported as an env var, so "the scratchpad" a subagent sees is already private and a fixed name inside it is safe.
- Repro/trigger: any fan-out where subagent prompts permit scratchpad writes.
- Confidence: observed

### 5. `.git` inside a worktree is a file, so it is not a staging location

- Type: docs
- Severity: low
- Evidence: A publisher tried to stage a summary body at `.git/summary-51.md`; it failed harmlessly because `.git` in a linked worktree is a file, not a directory. It then used a gitignored path inside the worktree.
- Impact: one wasted command; no damage.
- Suggested improvement: one line in the container docs' worktree section — a subagent needing a scratch file inside a worktree should use a gitignored path, and `.git/` is not available as a directory there.
- Repro/trigger: any agent reaching for `.git/` as scratch space while in a linked worktree.
- Confidence: observed

### 6. Copilot advertises finding counts it never posts

- Type: workflow
- Severity: medium
- Evidence: On PR #56, the Copilot review body states `**Findings:** 2 ⚠️ Bug` and, four lines later, "Copilot reviewed 16 out of 16 changed files ... and generated no comments." No inline threads exist for those two findings. Checked #51, #57, #58 — the pattern appears only on #56.
- Impact: two claimed defects are unreachable and were never triaged; an `address-review` run has nothing to act on and no way to tell the maintainer beyond a note.
- Suggested improvement: `address-review`'s thread-gathering step could parse a bot review body for a findings count and, when the count is non-zero while the bot authored zero threads, surface it as an explicit blocked item rather than leaving it to chance. Cheap detection, and it converts a silent loss into a maintainer decision.
- Repro/trigger: Copilot reviews where the overview header and the comment output disagree.
- Confidence: observed

### 7. Orchestrator phase-launch is easy to half-complete

- Type: agent-instructions
- Severity: medium
- Evidence: The orchestrator launched codex peers for two entries' review rounds without launching their fresh reviewers, and had to launch those separately a turn later. The two roles are launched by different mechanisms (a Bash background command vs. an Agent call), which makes an incomplete phase easy to miss when results are arriving incrementally.
- Impact: one wasted turn; no correctness impact, because the gate requires the Reviewer and would not have concluded without it.
- Suggested improvement: `address-reviews`' Phase B wording could state the pairing as a single indivisible action ("launch the Reviewer and, when enabled, the peer in the same message"), which is how the skill already describes it conceptually but not as a checkable step.
- Repro/trigger: batch runs where entries reach their review phase at staggered times.
- Confidence: observed

### 8. Packet relay lets the orchestrator invent stable references

- Type: agent-instructions
- Severity: medium
- Evidence: A `delegated-fix` packet omitted comment `databaseId`s for two of seven threads. When composing the publisher prompt the orchestrator supplied an id that returns 404. The publisher re-fetched threads, matched on node id and body, and anchored correctly — so nothing landed wrong.
- Impact: none, because the publisher validates rather than trusting the packet. But the failure mode it protects against is misfiled replies on the wrong comment.
- Suggested improvement: make the `delegated-fix` packet contract explicit that every item carries thread node id **and** comment `databaseId`, and have the publisher treat a supplied id that does not resolve as a packet error to report (it already recovers; it should say so loudly, which in this case it did).
- Repro/trigger: any packet handoff where the fixer summarizes threads without stable per-comment ids.
- Confidence: observed

## Follow-Up Candidates

- Add `< /dev/null` to the peer launch snippet in both `review-cycle` mirrors (item 1) — one-line change, highest value in this list.
- Write `scripts/test-task-file-citations.mjs` and wire it into `.github/workflows/tests.yml` (item 3).
- Require a one-line basis on peer `PASS` in the peer contract (item 2).
- Add the bot-claims-findings-but-posts-none check to `address-review`'s gathering step (item 6).
- Note in the container docs that `.git` is a file inside a linked worktree (item 5).

## What Worked Well

Worth keeping, since these were load-bearing this run:

- `wt-bootstrap` / `wt-enter` / `wt-remove` handled nine worktrees with no manual `git worktree` calls and no incident; `wt-remove` refused nothing because every tree was genuinely clean.
- `gh-review-threads` was used across eight PRs with concurrent `gh` traffic and never returned another PR's threads — the failure it exists to prevent did not recur.
- Eight concurrent entries plus peers ran without storage or rate pressure (418 GB free throughout); no throttling was needed, so the adaptive-throttling guidance cost nothing when unexercised.
