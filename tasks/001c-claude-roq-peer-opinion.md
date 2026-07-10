# 001c - Peer Second Opinion for resolve-open-questions Implementations (Claude tree)

## Why this task exists

When `resolve-open-questions` applies a decision that writes code, that change currently gets a fresh-eyes reviewer pass; it should also collect a best-effort `codex` opinion, since these changes land with less ceremony than a full task loop.

## Scope

- `plugins/dev-skills/skills/resolve-open-questions/SKILL.md` only.
- Out of scope: everything else (001a/001b own the other Claude-tree skills; 001f owns the Codex counterpart). No iteration-cap change here — this skill has no bounded review loop today, and introducing one is not part of this task.

## Context and references

- Protocol: `tasks/001-second-opinions.md` § "The Peer Second-Opinion Protocol".
- Insertion point: the "A decision that writes code" flow — implementation is delegated to a fresh subagent, then a fresh-eyes reviewer checks it (edits nothing; PASS or numbered issues).

## Target files or areas

- In that flow, launch the peer invocation (`codex exec --sandbox read-only --cd <tree> -o <outfile> "<prompt>"`) in the background alongside the fresh-eyes reviewer, scoped to the decision's change (commit range), with the umbrella output contract.
- Preflight once per run (`command -v codex`, `codex login status`, with the `CODEX_API_KEY` carve-out per umbrella §1) the first time a resolution needs an implementation; skip entirely for decision-only sessions that write no code.

## Implementation notes

- Triage/gating per umbrella §3, adapted to this skill's shape: grounded peer findings — blocking and minor alike — send the change back through a fresh fix subagent + fresh reviewer before the thread is answered or the task file updated; only noise is pushed back.
- Because the maintainer is interactively present in this skill, a disputed peer finding may also be surfaced to them as part of the item's brief instead of looping — prefer that over burning subagent rounds when the finding is a judgment call rather than a factual defect.
- Best-effort: forfeit silently per invocation, note once in the wrap-up summary. Respect `peer-opinions=off`.
- Keep the addition compact and in the file's established style (one line per paragraph).

## Acceptance criteria

- The code-writing flow describes the parallel peer launch, triage, gating (grounded findings → re-fix before replying; judgment calls → surface to the maintainer), and forfeit semantics consistently with the umbrella.
- Decision-only sessions are explicitly unaffected (no preflight, no peer chatter in the summary).

## Validation

- Read the modified flow end to end; confirm no step replies to a thread or edits a task file while a grounded blocking peer finding on that item is unaddressed.

## Review plan

Reviewer verifies protocol fidelity, the interactive-surface option for disputed findings, and that the skill's maintainer-drives-every-judgment-call principle is preserved (the peer informs, the human decides).
