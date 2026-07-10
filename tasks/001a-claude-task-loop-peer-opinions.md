# 001a - Wire Peer Second Opinions into the Claude Task-Loop Skills

## Why this task exists

The implement→review→fix loop in the Claude-tree task executors should collect a best-effort second opinion from the `codex` CLI in parallel with the own reviewer subagent, per the umbrella protocol.
This is the highest-leverage insertion point: it hardens code before a PR ever opens.

## Scope

- `plugins/dev-skills/skills/address-tasks-serialized/SKILL.md` — the base contract: add the peer-opinion protocol section, integrate it into the review step, raise the iteration cap 3 → 6.
- `plugins/dev-skills/skills/address-tasks/SKILL.md` — the parallel variant: integrate the peer into Phase B (review), add the preflight to Session Bootstrap, raise the cap 3 → 6.
- Out of scope: the Codex-tree counterparts (001d), the review-addressing skills (001b), `resolve-open-questions` (001c), and any powbox files.

## Context and references

- Protocol: `tasks/001-second-opinions.md` § "The Peer Second-Opinion Protocol" — implement it as written (availability preflight, invocation, triage/gating, round accounting). Do not invent divergent semantics.
- `address-tasks` inherits the implementer/reviewer contracts from `address-tasks-serialized`, so the full protocol text belongs in the **serialized** skill (as a new section, e.g. "Peer second opinion (best-effort)"), with `address-tasks` referencing it and adding only the parallel-execution specifics.

## Target files or areas

- `plugins/dev-skills/skills/address-tasks-serialized/SKILL.md`: new protocol section; the review step (reviewer spawn) gains the parallel peer launch; the "Cap the feedback loop at 3 iterations" item becomes 6 with the runaway-guard rationale and unchanged exhaustion behavior.
- `plugins/dev-skills/skills/address-tasks/SKILL.md`: Session Bootstrap gains the one-time peer preflight (`command -v codex` + `codex login status`); Phase B says to launch the peer invocation in the background per task worktree at the same moment the wave's reviewer subagents are spawned, and to collect both before triage; "up to **3 iterations**" (intro) and "up to **3 rounds** total" (Phase B) become 6.

## Implementation notes

- Peer invocation from this tree: `codex exec --sandbox read-only --cd <worktree> -o <outfile> "<prompt>"` with the prompt contract from the umbrella (scope, context, "edit nothing", `VERDICT` + numbered `blocking`/`minor` findings with `file:line`).
- Gating semantics exactly per umbrella §3: both feedback sets go to the fixer verbatim; grounded peer findings — blocking and minor alike — gate even on an own-reviewer pass and get fixed pre-PR; only noise is pushed back, with the next round's own reviewer adjudicating disputes.
- The peer is examination-only per umbrella §2: it reads code and diffs, never runs builds or tests — the own reviewer keeps its build-as-blocker contract unchanged, which is what makes the parallel launch safe.
- The skill must remain generic: it cannot assume `codex` exists, is logged in, or that powbox guidance is present. Forfeit silently per round, note once in the final summary.
- Respect the optional `peer-opinions=off` skill argument.
- Match the existing document style: one line per paragraph, bold markers consistent with surrounding text, imperative voice.
- Keep the added text tight — these SKILL.md files are prompts; every sentence costs context. Prefer one compact section over scattered repetition.

## Acceptance criteria

- Both files describe the peer preflight, parallel launch, triage/gating, and forfeit semantics consistently with the umbrella protocol.
- No occurrence of the old cap remains in either file (`grep -n "3 rounds\|3 iterations\|round 3"` is empty for both); the new cap is 6 with exhaustion behavior unchanged (no PR, surface findings).
- `address-tasks` still defers contract rationale to `address-tasks-serialized` rather than duplicating the full protocol text.

## Validation

- Read both files end to end for narrative coherence (the loop description, phase ordering, and cap must tell one consistent story).
- Run the greps above; also `grep -n "codex exec" both files` to confirm the invocation form matches the umbrella.

## Review plan

Reviewer reads the umbrella protocol first, then diffs both SKILL.md files, checking: protocol fidelity (no invented semantics), cap raised everywhere, best-effort language preserved (peer absence never fails a run), and style consistency (one-line paragraphs).
