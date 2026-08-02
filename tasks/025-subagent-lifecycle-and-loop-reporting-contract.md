# 025 — Subagent lifecycle contract: finish your own children, report final state, surface deviations

## Why this task exists

Delegated subagents in the task/review loops have returned in states the orchestrator had to detect and repair, and loop summaries have misdescribed what shipped. All items are observed, each from a different real run:

- a fix-up subagent spawned a background `codex` to double-check itself, then **ended its turn "waiting for the monitor notification"** — leaving a dirty worktree and no conclusion; subagents are not auto-resumed, so the orchestrator had to notice the missing packet, hunt the child process, and resume it by hand (kalm2);
- an implementer launched its own detached `codex` self-review that outlived it, orphaned, and wandered into an unrelated sibling worktree because it lacked a tight `--cd` (powbox);
- a review loop's `decisionDeviation` flag latched on the round it first appeared and was never re-evaluated; the final result reported a deviation that rounds later had already conformed — a maintainer acting on the summary would have "restored" something already present (Scribz);
- an auto-conforming loop **reverted** an implementer's justified deviation from a locked maintainer decision before the maintainer ever saw it; when finally shown, the maintainer ratified the deviation and reversed part of their own earlier decision (Scribz).

## Scope

Add to the delegated-agent contracts (implementer, fixer, reviewer prompt specs) and loop-orchestration sections of `address-tasks`, `address-tasks-serialized`, `address-review`, `address-reviews`:

1. **No waiting to be resumed.** A subagent must never end its turn expecting a later wake-up. If it starts a long-running child, it either blocks on that child's completion within its own turn or finalizes on its own analysis; "I'll wait for the notification" is a contract violation.
2. **Reap your children.** A subagent must not leave background processes running when it returns; anything it spawned is reaped (or completed) before the final packet. Implementers/fixers should not launch their own peer reviews at all — the orchestrator's peer step is the sanctioned second opinion.
3. **Packet hard-check.** On every returned fix/implementation packet, the orchestrator verifies the worktree is both clean AND idle: `git -C <worktree> status --porcelain` is empty (all changes committed as the contract already requires) **and** no Git operation is in progress. Check the operation-state paths explicitly (`git -C <worktree> rev-parse --git-path rebase-merge` / `rebase-apply`, plus `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG`) — a subagent that returns mid-rebase or mid-cherry-pick can leave a working tree whose porcelain output happens to be empty, and a porcelain-only check would accept that packet and hand the next round an unsafe worktree. Failing either condition means redrive or resume, never silent adoption.
4. **Report, don't correct, deviations from locked decisions.** When an implementer delivers something other than a decision marked locked, it states what it delivered instead and the constraint that forced it; the reviewer adds whether an in-spec route existed and a ratify/conform recommendation; the loop records the deviation prominently (top of any PR comment/summary) and leaves the decision to the human. Completeness, tests, and regressions are graded as strictly as ever — a deviation is not license for unfinished work.
5. **No latched flags.** Any per-round condition carried into a loop's final result must be re-evaluated each round; the final result describes the **final** state, with history kept separately and named as history.

Out of scope: peer-launch mechanics (task 015), scratch hygiene (task 017).

## Context and references

- **Sequencing**: implement AFTER 014. Items 1–3 and 5 are the review-cycle block's packet/loop contract and are authored ONCE there, then carried into every derived rendering — the Codex mirror, and each copy synthesized from the `wf-review-cycle` embeddable section, which per 014a includes the one `wf-address-tasks` embeds; a consumer that reaches the block by reference needs no edit. Item 4's report-don't-correct shape feeds the block's result contract directly (a reported deviation travels alongside `openQuestions[]` so the maintainer sees it at cycle end). The per-skill anchors below describe the pre-014 world.
- `plugins/dev-skills/skills/address-review/SKILL.md` — the delegated-fix contract ("leave the worktree clean…") that items 1–3 harden.
- `plugins/dev-skills/skills/address-tasks/SKILL.md` / `-serialized` — implementer contract and round-loop result assembly (items 1–5).
- Codex-side mirrors.

## Target files or areas

- `plugins/dev-skills/skills/review-cycle/SKILL.md` and `plugins/dev-skills/workflows/wf-review-cycle.js` (post-014 primary), the `codex/dev-skills/skills/review-cycle/` mirror, and `plugins/dev-skills/workflows/wf-address-tasks.js`, which per 014a embeds its own copy of that rendering.
- Pre-014 fallback: the four skill files above plus codex mirrors.

## Implementation notes

- Items 1–2 belong verbatim in the subagent prompt templates (they bind the subagent); items 3 and 5 bind the orchestrator; item 4 needs both sides (implementer reporting shape, reviewer recommendation, orchestrator surfacing).
- Keep additions tight (~15 lines total per skill); reuse the existing contract vocabulary ("packet", "round", "locked decision") rather than introducing new terms.

## Acceptance criteria

- Subagent prompt specs forbid wait-to-be-resumed and unreaped children, and drop any implication that self-launched peer review is expected.
- Orchestrator sections specify the hard-check — porcelain cleanliness AND no in-progress Git operation — with redrive/resume as the response to either failing.
- The deviation protocol (report-don't-correct, with strict grading preserved) is present where locked decisions are handed to implementers.
- The no-latched-flags rule is present where loop results are assembled.

## Validation

- Replay each of the four incidents against the new text: the contract now names the violation at the moment it occurred.

## Review plan

Reviewer checks the binding direction of each rule (subagent vs orchestrator) matches where it is written, and that the deviation rule cannot be read as weakening the review gate.
