# 043 — Comment discipline in the review cycle: ship only comments that outlive the PR

## Why this task exists

Review rounds routinely ask fixers to "document" nearby behavior, and fixers over-comply: a comment enumerating the outcome matrix of the function computing those outcomes right below it is the function re-implemented in prose — non-executable duplicate content that drifts from the code, attracts nitpick threads, precision edits, and language-ambiguity findings, and then consumes review rounds of its own iterating on comment correctness. The sibling failure is provenance accretion: each fix round is an invitation to append rationale, so comments narrating the sequence of decisions that led to the current shape pile up even after a later decision supersedes them all. Recent runs burned real effort on exactly this churn, with zero added product value — and the cost is not only the churn: a file bloated with heavy documentation comments is more expensive for every future reader and agent to parse in every single pass. The failure mode attaches to the cycle's roles — the fixer answering findings and the reviewer judging comments — not to any one consumer skill, so the rule belongs in the canonical block those roles are defined in.

## Scope

Included:

- **The shipped-comment test, authored once in the canonical `review-cycle` block, in the Fixer contract:** a code comment ships only if it still earns its keep after the PR closes. What earns its keep is what the code cannot show — why an arbitrary constant or choice is what it is, an external constraint or influence that shaped a decision, or a still-standing deliberately-overruled review decision (kept so the point is not re-raised). Never ship a comment that restates what adjacent code does — an outcome matrix, condition-by-condition narration, or any prose a reader gets from the code itself with minimal effort. Self-documenting code is the goal; the comment is the bounded exception for decisions outside forces shaped, not a default channel. Placing this in the Fixer contract makes every consumer inherit it — a batch implementer is the cycle's round-1 fixer, so `address-tasks` code is covered without any consumer-side restatement.
- **Channel routing for reasoning that fails the test:** any amount of rationale may land in a PR reply or the summary comment — that is the right home for reasoning addressed to the people watching the current diff, and it is left behind automatically once the PR closes, exactly as it should be. Durable knowledge too bulky for a why-comment goes to the repo's docs area (commonly `docs/`), findable by anyone eager to reason about a past decision without taxing every future read of the code file. The code comment is reserved for what a reader needs at the point of reading. State this routing beside the test so "don't ship it" always comes with "here is where it goes instead".
- **Current-rationale-only provenance:** when a change supersedes a previously commented decision, replace the old rationale — do not append history. The comment always reads as the reasoning for the code as it now stands; superseded reasoning lives in version control. The one history-shaped thing a comment legitimately carries is a still-standing overruled-review decision, and it too is replaced when genuinely superseded.
- **Reviewer-side weighting, in the same canonical block:** the Reviewer's quality pass treats a prose-re-implementation comment as removable noise (flag it for deletion), not as material to precision-edit, and does not report the absence of behavior-narrating comments as a gap.
- **`address-review` keeps only its thread-level deltas:** triage acknowledges that a "document this behavior" thread may be satisfied by a minimal why-comment, by a PR reply carrying the fuller rationale, or by push-back — never by prose re-implementation; and the overruled-decision carve-out's cross-round purpose is stated here, where it bites — external reviewers re-raise across PR rounds and runs, which is what the standing comment exists to prevent.

Out of scope: legislating how comments are written outside these review flows, docstrings/API documentation conventions, any relaxation of the rule that overruled review decisions get recorded, and any mandate to produce docs files per PR — the docs area is a routing option, not a ritual.

## Context and references

- `plugins/dev-skills/skills/review-cycle/SKILL.md` — the Fixer contract and the Reviewer role's quality pass: the single authoring point for both halves, propagated to `wf-review-cycle.js`, the `wf-address-tasks.js` embedded copy, and the codex mirror per the established pattern.
- `plugins/dev-skills/skills/address-review/SKILL.md` — step 4 (triage; "document this" comments arrive as actionable items) and step 5 (fix guidance; the fixer-prompt sketch): the home of the thread-level deltas only.
- The repo's own review-format guidance (`CLAUDE.md`) already pushes severity-weighted, non-nitpick review; this task extends the same economy to the comments fixes leave behind.

## Target files or areas

- `plugins/dev-skills/skills/review-cycle/SKILL.md` plus `wf-review-cycle.js` and the `wf-address-tasks.js` embedded copy (primary), `plugins/dev-skills/skills/address-review/SKILL.md` (deltas), and the codex-side mirrors of both.

## Implementation notes

- Keep the canonical rule compact — one tight paragraph for the fixer side stating the test ("still useful after the PR closes?"), the welcome categories, and the routing; one sentence-level addition for the reviewer side. The consumer deltas in `address-review` are a few sentences.
- The overruled-decision carve-out is what makes the rule practical in review loops: without it, deleting provenance invites the same reviewer to re-raise the same point next round. Word it so the carve-out cannot justify keeping *superseded* decision history.
- Deleting a stale narration comment is a better fix than precision-editing it; say so, since the precision-edit is the observed failure mode.
- Sequencing: the canonical-block edits land in the same `review-cycle` sections tasks 019 and 035 touch; implement after those to avoid churny conflicts (soft ordering, not a prerequisite).

## Acceptance criteria

- The canonical block's Fixer contract carries the outlives-the-PR test, the welcome categories stated positively, and the channel routing (PR reply / docs area / shipped comment); the provenance rule and the reviewer-side weighting are present in the same block; all authored once and consistent across renderings.
- `address-review` carries only the thread-level deltas: the minimal-why-or-reply-or-push-back resolution for "document this" threads and the cross-round purpose of the overruled-decision carve-out; it restates no canonical rule.
- Batch implementers are covered through the round-1-fixer mechanism with no duplicated consumer-side restatement.
- No change to how overruled review decisions are recorded or to push-back mechanics; codex mirrors match.

## Validation

- Read-through at the decision moments: "the bot asked me to document this function's outcomes", "I want reviewers to understand my fix's reasoning", "my fix invalidates the comment explaining the old approach", "this decision deserves a durable record somewhere" — the text now answers each with the right channel.
- `wf-check` passes on any edited workflow script; grep renderings for the rule's key vocabulary to confirm consistency.

## Review plan

Reviewer checks the rule cannot be read as license to delete genuinely load-bearing rationale, that the carve-out stays bounded to standing decisions, that both halves are authored once in the canonical block with `address-review` holding only deltas, and that the routing guidance offers channels without mandating docs output per PR.
