# 012 — Adopt powbox's baked skills and Claude workflows into this repo as the source of truth

## Why this task exists

Powbox still bakes and seeds four prompt-material items that belong with the rest of the dev workflow material in this repo: the Claude dynamic workflows `wf-address-review.js` and `wf-address-tasks.js` (seeded into `~/.claude/workflows/`), and the `enable-worktrees` + `session-learnings` skills for both harnesses. Everything else already flows from here — Claude dev-skills via the `dev-skills@roubtec` plugin, Codex dev-skills via the start-time sync from the marketplace clone — so these stragglers are the last items whose iteration requires a powbox image rebuild instead of a plugin refresh. Claude Code plugins support a `workflows/` directory at the plugin root (workflows register plugin-namespaced, e.g. `/dev-skills:wf-address-tasks`), so the plugin can carry the workflows natively. A powbox branch (`forfeit-skills-and-workflows-to-agent-skills`) removes the bake/seed on that side; the maintainer merges it only after this task ships, so sequencing risk is on the powbox side, not here. This relocation is also a prerequisite for 014: the shared `wf-review-cycle` workflow must be born in the plugin, and refactoring `wf-address-*` to use it happens on the copies that live here.

## Scope

Included:

- Add `plugins/dev-skills/workflows/` carrying `wf-address-review.js` and `wf-address-tasks.js`, taken verbatim from powbox `docker/claude/agent-container/workflows/` (current seeded copies are also on the config volume at `~/.claude/workflows/`). Keep `meta.name` as-is (`wf-address-review`, `wf-address-tasks`); the plugin namespace disambiguates from the same-named skills.
- Verify the plugin manifest needs no change for the default `workflows/` location (add the `workflows` manifest field only if the layout demands it).
- Port the relevant parts of powbox's `workflows/README.md` (authoring constraints, worktree model rationale, verified runtime facts) into a README next to the workflow sources here; powbox keeps only its container-specific content (wt-* helper contract, volume rationale) plus a pointer.
- Add `enable-worktrees` and `session-learnings` to `plugins/dev-skills/skills/` (Claude) and `codex/dev-skills/skills/` (Codex), taken from powbox's baked copies — INCLUDING the Codex-side `agents/openai.yaml` sidecars (UI labels/default prompts); a bare SKILL.md mirror regresses the Codex UI. The Codex start-time sync iterates whatever the marketplace clone carries, so the Codex copies flow with no powbox-side mechanism change beyond its forfeit branch.
- Import powbox's `scripts/test-checkout-cleanliness-report.mjs` (unit test of `wf-address-tasks.js`'s `mainCheckoutSummary`, extracted from the shipped source) alongside the relocated workflow, with paths adapted — the powbox forfeit branch deletes it, so this repo must carry the regression coverage or it is lost.
- Update this repo's README to list the new components and note the invocation rename for the workflows (bare `/wf-address-tasks` from the seeded copy becomes `/dev-skills:wf-address-tasks` from the plugin; existing seeded copies keep working until powbox's `agent-update-skills --prune` retires them), and sweep any prose/prompts in this repo that reference the bare `/wf-…` form.

Out of scope:

- The powbox-side removal (its forfeit branch, merged by the maintainer after this lands).
- Any behavioral change to the four items — this is a verbatim relocation; refactors ride later tasks (014, 033).

## Context and references

- powbox `docker/claude/agent-container/workflows/` and `docker/{claude,codex}/agent-container/skills/` — the sources to import.
- powbox `docker/shared/sync-codex-skills.sh` header — documents that the Codex sync channel follows the clone's contents.
- powbox branch `forfeit-skills-and-workflows-to-agent-skills` (local, at `f10672d`) — the counterpart change; its task 051 lists the merge prerequisites this task satisfies. Merge ordering is strict: powbox's build hard-fails only on an EMPTY Codex skill palette, not an incomplete one, so a premature powbox merge would silently ship images missing the two skills — hence the completeness criterion below.
- powbox open tasks re-homed here by the forfeit, once its counterpart branch has merged: its 041 (peer-review stage in the wf-* workflows) is substantially covered by 014/015, with the workflow-rendering residue those two did not state folded into 014 itself; its 029a (peer `VERDICT: PASS` notes) arrives intact as 015a; its 047 `wf-check` fixtures consume the workflow copies this task creates.
- Claude Code plugin docs, "Distribute a workflow in a plugin" — the `workflows/` plugin dir and namespacing behavior.

## Target files or areas

- `plugins/dev-skills/workflows/` (new), `plugins/dev-skills/skills/{enable-worktrees,session-learnings}/`, `codex/dev-skills/skills/{enable-worktrees,session-learnings}/`, `README.md`.

## Implementation notes

- Diff the powbox-baked copies against the seeded copies on the config volume before importing; if they diverge, the powbox repo copy wins (it is the built source) and the divergence is noted in the PR.
- The two skills reference image-baked helpers (`wt-bootstrap`, `.powbox.yml` schema); that coupling is acceptable — the skills already fail informatively when the helpers are missing — but keep their text free of powbox-repo-relative paths.
- Do not edit the workflows' logic while importing; even comment fixes belong in a follow-up so the relocation diff stays reviewable as a pure move.

## Acceptance criteria

- Both workflows live under `plugins/dev-skills/workflows/`, parse (meta block first, plain JS), and are invocable plugin-namespaced in a consumer session.
- Both skills exist on both harness sides — Codex copies with their `agents/openai.yaml` sidecars — with content matching the powbox sources at the import commit.
- The imported `mainCheckoutSummary` regression test runs green via `node`.
- README documents the new components and the invocation rename; no bare `/wf-…` invocation references remain in this repo's prose.
- No powbox-repo paths remain in the imported texts.

## Validation

- `node --check` both workflow files.
- In a powbox container with the updated marketplace: `/dev-skills:wf-address-review` resolves as a command; the Codex sync report lists the two new skills after a container restart.

## Review plan

Reviewer verifies the import is byte-faithful to the powbox sources (or that divergences are called out), and that the README's rename note makes the transition unambiguous for a user with old seeded copies still present.
