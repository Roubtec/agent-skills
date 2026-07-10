# 001f - Peer Second Opinion for resolve-open-questions Implementations (Codex tree)

## Why this task exists

Mirror of 001c for the Codex tree: when `resolve-open-questions` applies a decision that writes code, the change should also collect a best-effort `claude -p` opinion alongside the fresh-eyes reviewer.

## Scope

- `codex/dev-skills/skills/resolve-open-questions/SKILL.md` only.
- Out of scope: everything else (001d/001e own the other Codex-tree skills; 001c owns the Claude counterpart). No iteration-cap change — this skill has no bounded review loop today.

## Context and references

- Protocol: `tasks/001-second-opinions.md` § "The Peer Second-Opinion Protocol".
- Structural blueprint: `tasks/001c-claude-roq-peer-opinion.md` — mirror its decisions, including the interactive escape: a disputed peer finding that is a judgment call goes to the maintainer as part of the item's brief rather than into a subagent loop.
- **Dependency: schedule after 001c passes review.** The orchestrator passes 001c's branch name so the implementer can read the delivered Claude-tree text (`git show <branch>:plugins/dev-skills/skills/resolve-open-questions/SKILL.md`, or `gitcat` where available) and mirror it.

## Target files or areas

- The "decision that writes code" flow: launch `claude -p "<prompt>"` (cwd = the decision's implementation worktree — the owning branch's worktree the fresh-eyes reviewer reads, never the repo root — umbrella prompt/output contract, stdout/stderr captured to a per-invocation outfile per umbrella §2 (`claude` has no `-o` flag), read-only guard per umbrella §2, ~12-minute timeout, one retry) in the background alongside the fresh-eyes reviewer, scoped to the decision's commit range.
- Preflight (`command -v claude` + `claude auth status`, with umbrella §1's `ANTHROPIC_API_KEY` and missing-subcommand carve-outs) once per run, only when a resolution actually needs an implementation; decision-only sessions are untouched.

## Implementation notes

- Gating per umbrella §3 adapted as in 001c: grounded findings — blocking and minor alike — send the change back through a fresh fix + fresh review before the thread is answered or the task file updated; only noise is pushed back; judgment calls surface to the maintainer.
- Best-effort semantics; forfeit noted once in the wrap-up; respect `peer-opinions=off`.
- Match the codex tree's style; keep the addition compact.

## Acceptance criteria

- The code-writing flow describes parallel peer launch, triage, gating, and forfeit consistently with the umbrella and symmetrically with the delivered 001c.
- Decision-only sessions explicitly unaffected.

## Validation

- Read the modified flow end to end; confirm no thread reply or task-file edit happens while a grounded peer finding on that item is unaddressed.

## Review plan

Reviewer checks symmetry with the delivered 001c, protocol fidelity, and that the maintainer-decides principle is preserved.
