# 029 — resolve-open-questions: re-home orphaned findings when their PR merges or vanishes mid-session

## Why this task exists

Long review-addressing sessions outlive their own PRs: in a kalm2 batch, PRs #139/#140 merged (by the maintainer, mid-run) while non-blocking nits on them were still open. The nits' files had moved to `main` and the branches carrying them were gone, so landing each nit required choosing a still-open PR to host it, rebasing that PR so the file was present, and explaining the provenance. The judgment calls (which PR "owns" an orphaned nit? when is rebase-first mandatory?) were made ad hoc; `resolve-open-questions` — the skill that processes exactly these leftover items — has no guidance for them.

## Scope

Add a short "re-homing orphaned findings" note to `resolve-open-questions` (and a pointer from `address-reviews`' wrap-up, which is where the orphans are usually discovered):

1. **Match by code ownership:** host an orphaned finding on the open PR that already touches the file/subsystem it concerns; if none does, prefer a committed follow-up task file over stretching an unrelated PR's scope.
2. **Rebase first, onto the host's own base:** before applying the fix, bring the chosen host branch forward so the finding's file (now on `main`) is actually present on it — otherwise the fix re-introduces or conflicts with merged content. Rebase onto the host PR's **actual base ref**, not onto the merge target by default: when the host is stacked on another open PR, rebasing it straight onto `main` replays the parent's commits into the host's own diff (especially once the parent's merge rewrote its SHAs). For a stacked host, restack it in the topological order of task [021](021-stacked-pr-rebase-and-conflict-resolution-guidance.md) — parent onto the true base first, then the host onto its parent's new tip — rather than skipping to the target.
3. **State provenance:** the commit message (and thread reply, when the original thread still exists) names the merged PR the finding came from, so the host PR's reviewer understands the out-of-scope-looking hunk.
4. **Mid-run merge checkpoint:** when a batch discovers an in-scope PR was merged mid-session, re-derive PR/merge state from the API before triaging its leftovers (do not act on the session's earlier snapshot).

Out of scope: the deferral-vs-fix decision framework (already the skill's core), and the definition of stacked-PR rebase ordering itself (task 021 — rule 2 points at it rather than restating it).

## Context and references

- `plugins/dev-skills/skills/resolve-open-questions/SKILL.md` — the per-item grounding/resolution loop; the re-homing note belongs where an item's target branch is established.
- `plugins/dev-skills/skills/address-reviews/SKILL.md` — wrap-up/reporting section for the pointer.
- Codex-side mirrors.

## Target files or areas

- `resolve-open-questions/SKILL.md`, `address-reviews/SKILL.md` (pointer only), codex mirrors.

## Implementation notes

- Keep it to one tight paragraph plus the four numbered rules; the skill is already 357 lines.
- Rule 1's fallback (follow-up task file) should reference the skill's existing deferred-task vocabulary rather than inventing a new mechanism.

## Acceptance criteria

- The four rules are present and anchored where the skill picks a target branch for an item.
- Rule 2 names the host PR's own base ref as the rebase target and defers to 021 for a stacked host, so re-homing can never replay a parent's commits into the host's diff.
- `address-reviews` points to them from its wrap-up.

## Validation

- Walk the kalm2 scenario (nits orphaned by two mid-run merges) against the new text: host selection, rebase-first, and provenance are each answered.

## Review plan

Reviewer checks the guidance prefers task-file deferral over scope-stretching when no owning PR exists, and that nothing here contradicts the skill's existing decision-capture flow.
