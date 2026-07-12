# 001e - Wire Peer Second Opinions into the Codex Review-Addressing Skills

## Why this task exists

Mirror of 001b for the Codex tree: disposition verification in the review-addressing loop should collect a best-effort `claude -p` opinion before the branch is re-published.

## Scope

- `codex/dev-skills/skills/address-review/SKILL.md` — peer opinion alongside the fresh `explorer` Reviewer, publication gate, cap 3 → 6.
- `codex/dev-skills/skills/address-reviews/SKILL.md` — peer wiring in the orchestrator-owned Phase B, cap wording ("up to 3 reviewer rounds", "after round 3"), batch preflight, fan-out rate signal.
- Out of scope: Claude tree (001b), task executors (001d), `resolve-open-questions` (001f), powbox files.

## Context and references

- Protocol: `tasks/001-second-opinions.md` § "The Peer Second-Opinion Protocol".
- Structural blueprint: `tasks/001b-claude-review-skills-peer-opinions.md` — mirror its decisions (peer verifies dispositions with the same inputs as the fresh Reviewer, minus the fixer's reasoning; grounded findings — blocking and minor alike — block publication like reviewer Issues).
- **Dependency: schedule after 001b passes review.** The orchestrator passes 001b's branch name so the implementer can read the delivered Claude-tree text (`git show <branch>:plugins/dev-skills/skills/address-review/SKILL.md`, or `gitcat` where available) and mirror it.

## Target files or areas

- `address-review/SKILL.md`: launch `claude -p "<prompt>"` (cwd = the PR branch checkout `address-review` is operating in — the same tree the fresh Reviewer reads, never the repo root of some other checkout — umbrella prompt/output contract including the pre-computed diff artifact granted via `--add-dir` (the guarded peer has no shell for `git diff`, and out-of-cwd reads are auto-denied without the grant), stdout and stderr captured to separate per-invocation files per umbrella §2 (`claude` has no `-o` flag), read-only guard per umbrella §2, ~12-minute timeout, one retry) in the background when the fresh Reviewer spawn happens; triage and gate per umbrella §3; the "at most 3 reviewer rounds total" cap becomes **6**.
- `address-reviews/SKILL.md`: wire the peer into the orchestrator-owned Phase B — this skill delegates only `delegated-fix`/`publish-reviewed` to `address-review` and runs the fresh `explorer` review itself, so peer logic in `address-review` is not inherited; launch the peer against each entry's worktree alongside that entry's fresh reviewer, each invocation capturing to its own stdout and stderr files and receiving its own pre-computed diff artifact granted via `--add-dir` (umbrella §2 — concurrent entries would otherwise interleave on the orchestrator's streams, and the guarded peer cannot run `git diff` itself), and collect/triage both before the round outcome (umbrella §§2–3); cap mentions become 6; one-time `command -v claude` + `claude auth status` preflight in the shared bootstrap (umbrella §1, including its `ANTHROPIC_API_KEY` and missing-subcommand carve-outs); note that concurrent entries each invoke the peer, so repeated peer-side rate/usage failures are a signal to fan out less.

## Implementation notes

- Same disposition checklist for the peer as for the Reviewer — minus the execution steps: the peer examines code only (umbrella §2); build/typecheck stays the Reviewer's job. Run the `claude -p` peer with the explicit read-only guard from umbrella §2 (e.g. `--tools "Read,Glob,Grep" --disallowedTools "mcp__*"`); never grant it permission-bypass flags.
- Best-effort semantics throughout; forfeits noted once in the final report; respect `peer-opinions=off`.
- The peer call is a plain shell command, not a Codex subagent — the skill's one-subagent-at-a-time rules don't apply to it, but it must only run against a committed, clean tree.
- Match the codex tree's style; keep additions tight.

## Acceptance criteria

- Publication is unreachable while a grounded peer finding is outstanding and rounds remain; `address-reviews` launches and triages the peer in its own Phase B (batch runs must not silently skip the second opinion); cap is 6; exhaustion behavior unchanged (stop, do not push, surface findings).
- No stale "3 reviewer rounds" / "round 3" text in either file; no powbox assumptions.

## Validation

- `grep -n "3 rounds\|round 3\|3 reviewer" codex/dev-skills/skills/address-review*/SKILL.md` is empty; read the publish path end to end.

## Review plan

Reviewer checks semantic symmetry with the delivered 001b, the disposition-context inputs, the publication gate, and cap raises.
