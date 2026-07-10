# 001d - Wire Peer Second Opinions into the Codex Task-Loop Skills

## Why this task exists

Mirror of 001a for the Codex tree: the implement→review→fix loop in the Codex task executors should collect a best-effort second opinion from the `claude` CLI in parallel with the own reviewer subagent.

## Scope

- `codex/dev-skills/skills/address-tasks-serialized/SKILL.md` — protocol section, review-step integration, cap 3 → 6.
- `codex/dev-skills/skills/address-tasks/SKILL.md` — Phase B integration, Session Bootstrap preflight, cap 3 → 6 (both the intro "up to 3 iterations" and the Phase B "3 rounds total").
- Out of scope: the Claude tree (001a), review-addressing skills (001e), `resolve-open-questions` (001f), powbox files.

## Context and references

- Protocol: `tasks/001-second-opinions.md` § "The Peer Second-Opinion Protocol" — same semantics as 001a, with the invocation direction reversed.
- Structural blueprint: `tasks/001a-claude-task-loop-peer-opinions.md` — mirror its placement decisions (protocol text in the serialized base skill, parallel-execution specifics in `address-tasks`) so the two trees stay recognizably symmetric.
- **Dependency: schedule after 001a passes review.** The orchestrator passes 001a's branch name so the implementer can read the delivered Claude-tree text (`git show <branch>:plugins/dev-skills/skills/address-tasks-serialized/SKILL.md`, or `gitcat` where available) and mirror it, rather than re-deriving placement from scratch.

## Target files or areas

- Peer invocation from this tree: `claude -p "<prompt>" > <outfile> 2>&1` executed with the working directory set to the task's worktree — one outfile per invocation per umbrella §2's capture contract, since `claude` has no `-o` flag (optionally `--output-format json` for a parseable artifact; effort per the umbrella §2 quality floor — request `--effort high` when the peer's configured default is not known to be high/xhigh; the peer is examination-only, so pass the explicit read-only guard from umbrella §2 — e.g. `--tools "Read,Glob,Grep" --disallowedTools "mcp__*"` — and never permission-bypass flags). The prompt carries the umbrella contract: worktree path, base branch/commit range, task context verbatim, "edit nothing", `VERDICT` + numbered `blocking`/`minor` findings with `file:line`.
- Availability preflight: `command -v claude`, then `claude auth status` (non-zero exit → unavailable), honoring umbrella §1's carve-outs (`ANTHROPIC_API_KEY` set, or an older CLI without the `auth status` subcommand → classify at first real invocation instead).
- The peer call is a plain shell command run by the orchestrator (with the umbrella's loose ~12-minute timeout, one retry on transient failure), launched when the wave's reviewer subagents are spawned; it is not a Codex subagent, so the skill's subagent-interface caveats don't apply to it.

## Implementation notes

- Gating, triage, round accounting, `peer-opinions=off`, and forfeit semantics exactly per umbrella §§1–4; every implementer round counts toward the new cap of 6.
- The skill must remain generic: never assume `claude` exists or is logged in; never reference powbox.
- Match the codex tree's document style (one line per paragraph); keep additions tight.

## Acceptance criteria

- Both files describe preflight, parallel launch, triage/gating, and forfeit consistently with the umbrella; invocation examples use `claude -p`.
- `grep -n "3 rounds\|3 iterations\|round 3"` is empty for both files; the cap is 6 with exhaustion behavior unchanged.
- The tree stays symmetric with 001a's placement (base contract in serialized, delta in parallel variant).

## Validation

- Read both files end to end for coherence; run the greps above; `grep -n "claude -p"` confirms the invocation form.

## Review plan

Reviewer diffs against the 001a implementation for semantic symmetry (same protocol, opposite direction), then checks cap raises and best-effort language as in 001a's review plan.
