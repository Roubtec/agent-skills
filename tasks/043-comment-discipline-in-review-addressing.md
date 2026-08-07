# 043 — Comment discipline when addressing review feedback: no prose re-implementation, current-rationale-only provenance

## Why this task exists

Review threads routinely ask to "document" nearby behavior, and fixers over-comply: a comment enumerating the outcome matrix of the function computing those outcomes right below it is the function re-implemented in prose — non-executable duplicate content that drifts from the code, attracts nitpick threads, precision edits, and language-ambiguity findings, and then consumes review rounds of its own. The sibling failure is provenance accretion: comments narrating the sequence of decisions that led to the current shape stay behind after a later decision supersedes them all, even though version control already keeps the archaeological record. Neither failure is hypothetical — both are recurring churn sources in review-addressing runs — and the skills currently say nothing about what a comment added in response to review is *for*.

## Scope

Included:

- **A comment-discipline rule in `address-review`**, placed with the fixing guidance (step 5) and reflected in triage: a comment earns its place only by recording what the code cannot show — why an arbitrary constant or choice is what it is, an external constraint, or a decision that deliberately overrules review feedback (so the point is not re-raised in later rounds). Never add a comment that restates what adjacent code does — an outcome matrix, condition-by-condition narration, or any prose a reader gets by reading the function itself with minimal effort. A "document this behavior" review comment may therefore be satisfied by a minimal why-comment, or pushed back on, rather than by prose re-implementation.
- **Current-rationale-only provenance:** when a change supersedes a previously commented decision, replace the old rationale — do not append history. The comment always reads as the reasoning for the code as it now stands; superseded reasoning lives in version control. The one history-shaped thing a comment legitimately carries is a still-standing overruled-review decision, because its job is preventing a live re-raise, and it too is replaced when genuinely superseded.
- **Reviewer-side weighting in the canonical `review-cycle` block:** the Reviewer's quality pass treats a prose-re-implementation comment as removable noise (flag it for deletion), not as material to precision-edit, and does not report the absence of behavior-narrating comments as a gap. Author this once in `review-cycle` and let the renderings carry it; `address-review` step 6 already consumes those gates by reference.

Out of scope: repository-wide comment style policy (this governs the review-addressing flows, where the churn arises), docstrings/API documentation conventions, and any relaxation of the rule that overruled review decisions get recorded.

## Context and references

- `plugins/dev-skills/skills/address-review/SKILL.md` — step 4 (triage; "document this" comments arrive as actionable items) and step 5 (fix guidance; the fixer-prompt sketch is where the rule reaches delegated fixers).
- `plugins/dev-skills/skills/review-cycle/SKILL.md` — the Reviewer role's quality pass, the single authoring point for the reviewer-side weighting, propagated to `wf-review-cycle.js`, the `wf-address-tasks.js` embedded copy, and the codex mirror per the established pattern.
- The repo's own review-format guidance (`CLAUDE.md`) already pushes severity-weighted, non-nitpick review; this task extends the same economy to the comments fixes leave behind.

## Target files or areas

- `plugins/dev-skills/skills/address-review/SKILL.md` (primary), `plugins/dev-skills/skills/review-cycle/SKILL.md` plus its workflow templates and embedded copy, and the codex-side mirrors of both.

## Implementation notes

- Keep the rule compact — a short paragraph per touchpoint stating the test ("does this record something the code cannot show?"), the two welcome categories (rationale for arbitrary choices; standing overruled decisions), and the replacement-not-appendix provenance rule.
- The overruled-decision carve-out is what makes the rule practical in review loops: without it, deleting provenance invites the same bot to re-raise the same point next round. Word it so the carve-out cannot justify keeping *superseded* decision history.
- Deleting a stale narration comment is a better fix than precision-editing it; say so, since the precision-edit is the observed failure mode.
- Sequencing: the reviewer-side weighting lands in the same `review-cycle` sections tasks 019 and 035 touch; implement after those to avoid churny conflicts (soft ordering, not a prerequisite).

## Acceptance criteria

- `address-review` states the comment-discipline rule where fixes are specified, the fixer-prompt sketch carries it, and triage acknowledges the minimal-why-or-push-back resolution for "document this" comments.
- The provenance rule (replace, never append; version control keeps history; overruled-decision carve-out bounded to still-standing decisions) is present.
- The `review-cycle` Reviewer weighting treats prose-re-implementation comments as removable noise and absent narration as a non-finding, authored once and consistent across renderings.
- No change to how overruled review decisions are recorded or to push-back mechanics; codex mirrors match.

## Validation

- Read-through at the decision moments: "the bot asked me to document this function's outcomes", "my fix invalidates the comment explaining the old approach", "the reviewer wants the wording of this behavior comment tightened" — the text now answers each.
- `wf-check` passes on any edited workflow script; grep renderings for the rule's key vocabulary to confirm consistency.

## Review plan

Reviewer checks the rule cannot be read as license to delete genuinely load-bearing rationale (the two welcome categories are stated positively), that the carve-out is bounded to standing decisions, and that the reviewer-side weighting was authored once in the canonical block rather than duplicated per consumer.
