# 001b - Wire Peer Second Opinions into the Claude Review-Addressing Skills

## Why this task exists

When review feedback is being addressed, the fresh-eyes verification of each disposition should also collect a best-effort `codex` opinion, so mistaken fixes or convenient push-backs are caught before the branch is re-published and reviewers re-pinged.

## Scope

- `plugins/dev-skills/skills/address-review/SKILL.md` — peer opinion in the disposition-verification step, publication gate, cap 3 → 6.
- `plugins/dev-skills/skills/address-reviews/SKILL.md` — batch counterpart: peer wiring in the orchestrator-owned Phase B, cap wording, preflight placement, fan-out considerations.
- Out of scope: task executors (001a), `resolve-open-questions` (001c), Codex tree (001e), powbox files.

## Context and references

- Protocol: `tasks/001-second-opinions.md` § "The Peer Second-Opinion Protocol".
- In `address-review`, the insertion point is the step that spawns "one fresh Reviewer subagent" to verify dispositions (currently followed by "Allow at most **3 reviewer rounds total**").
- `address-reviews` delegates only the fix packet (`delegated-fix`) and publication (`publish-reviewed`) to `address-review` — it owns the fresh-review Phase B itself, so the peer logic added to `address-review`'s reviewer step is **not** inherited by batch runs; `address-reviews` must launch and triage the peer in its own Phase B, or batched review-addressing silently skips the second opinion.

## Target files or areas

- `address-review/SKILL.md`: launch the peer invocation in the background when the fresh Reviewer subagent is spawned, giving it the same inputs the Reviewer gets (unresolved threads + dispositions verbatim, effective review base, current branch — but not the fixer's reasoning) and the umbrella output contract. Union/gating per umbrella §3: grounded peer findings block publication exactly like reviewer Issues; the reviewer-round cap becomes **6**.
- `address-reviews/SKILL.md`: wire the peer into the orchestrator-owned Phase B — launch it in the background against each entry's worktree at the same moment that entry's fresh reviewer is spawned, and collect/triage both verdicts before the round outcome, per umbrella §§2–3; the "up to 3 reviewer rounds" mentions become 6; add the one-time peer preflight to the shared bootstrap so each entry doesn't re-probe; note that concurrent entries each invoke the peer, so repeated peer-side rate/usage errors are a signal to fan out less (mirroring the existing provider rate-limiting guidance).

## Implementation notes

- Invocation form and prompt contract identical to 001a (`codex exec --sandbox read-only --cd <worktree> -o <outfile> "<prompt>"`).
- The peer verifies **dispositions**, not just code: fixes hold in committed code, push-backs are technically justified, deferrals point at a committed task file that covers the concern — same checklist the fresh Reviewer gets, **minus the execution steps**: the peer examines code only (umbrella §2); running the build/typecheck stays the fresh Reviewer's job.
- In `delegated-fix` mode `address-review` spawns no Reviewer, and likewise launches no peer — the batch orchestrator owns both; the peer launch in `address-review` itself applies to standalone runs that reach the reviewer step.
- Best-effort semantics per umbrella §1–§3; forfeits never block publication on their own and are noted once in the final report.
- Respect `peer-opinions=off`; in hands-off batch mode the default remains on.
- Match existing style: one line per paragraph; keep additions tight.

## Acceptance criteria

- `address-review` collects and triages the peer verdict alongside the fresh Reviewer's, with grounded peer findings (blocking and minor) gating publication; cap is 6; exhaustion behavior unchanged (stop, do not push, surface findings).
- `address-reviews` launches and triages the peer in its own Phase B (batch runs must not silently skip the second opinion), carries no stale "3 reviewer rounds" text, and states the batch-level preflight and rate-signal guidance.
- No powbox-specific assumptions introduced.

## Validation

- `grep -n "3 rounds\|round 3\|3 reviewer" plugins/dev-skills/skills/address-review*/SKILL.md` is empty.
- Read the publish step end to end: it must be impossible to reach "push" while a grounded peer finding is outstanding and rounds remain.

## Review plan

Reviewer checks protocol fidelity against the umbrella, that the peer receives disposition context (not implementation reasoning), the publication gate wording, and that batch fan-out guidance stays consistent with the existing rate-limiting language.
