# 019 — Review-loop convergence heuristics and delegation-briefing rules for address-review(s)

## Why this task exists

Multi-round review loops across kalm2, Scribz, and powbox sessions kept burning rounds on failure modes that are now well-characterized and cheap to name in the skill text. Each item below cost 2–4 extra reviewer+fixer rounds in at least one real run; none is currently mentioned in `address-review`/`address-reviews`.

## Scope

Add concise guidance (a sentence or two each, in the round-orchestration and fixer/reviewer-briefing sections) for six patterns:

1. **Bound the claim instead of tightening again.** When consecutive rounds each produce a *narrower* residual of the same finding (a criterion is patched, a narrower edge case punctures it, repeat), the artifact is over-claiming. The orchestrator should offer the next fixer "bound the claim honestly" — state premises, name the residual, give the operator definite branches — as a legitimate complete resolution. (A kalm2 DR-runbook PR ran 8 rounds; rounds 3–5 were this loop, and it terminated only on the reframing.)
2. **Same-class findings ⇒ structural defect.** When **two** consecutive rounds land findings of the same class in the same section, stop patching instances and ask whether the structure is the defect. Two is the trigger rather than some larger number because the second same-class finding is already the evidence — one is a defect, two is a pattern — and every round spent patching instances past that point is a round the restructuring would have ended; an implementer may raise the threshold for a section under heavy churn, but must state a number rather than leave it open. Name the two observed triggers: a closed enumeration standing in for an open set (replace with an exclusion rule), and a spec keeping multiple options open so every criterion must hold under all of them (lock one option). (A Scribz task file drew six rounds this way; both restructurings ended their finding classes outright.)
3. **Enumeration, not assertion, for sweeps.** A sweep-style fix-up ("fix this pattern everywhere") must return an explicit enumeration of the search space with per-item verdicts; reviewers of sweeps redo the enumeration rather than spot-checking the supplied one; a commit message must not claim a completed sweep unless the search space was enumerated. (A kalm2 sweep was asserted complete and wrong three rounds running; it converged only when a 52-site enumeration was demanded.)
4. **Severity-split framing.** When the own reviewer passes and the peer blocks on the *same fact* (or vice versa), tell the next fixer explicitly that the channels agree on substance and differ only on severity — it visibly shortens deliberation. No gate change: grounded findings keep their existing force.
5. **Provenance marking in orchestrated briefs.** Mark each factual claim in a delegation prompt as *verified this turn* vs *carried from a prior report — re-derive before relying on it*. Two carried-forward claims in one kalm2 session were wrong and reached a maintainer decision; the implementers caught them only because their briefs said to verify citations.
6. **Diff bases after amend/rebase.** When a fix commit is amended between rounds, name which review the next round is: an **incremental** re-review ("what changed since I last looked") gets the **recorded prior-round SHA** as its base — never the fix commit's parent, which after an amend is `HEAD~1` and spans the whole cumulative fix set, and which produced a false "unrelated changes" blocking finding in a real run. Reserve the fix commit's parent / `HEAD~1` range for an explicitly requested **cumulative** review of the entire fix. So: record each round's ending SHA, and state in the brief which of the two ranges the reviewer is being given and why; alternatively prefer fixup commits squashed at the end, which keeps the two ranges distinct without bookkeeping. After any rebase, delegate ranges relative to stable refs — the entry's effective base as 016 pins it, an immutable OID or snapshot rather than a hard-coded `origin/main` or any other movable remote-tracking name — never absolute SHAs captured pre-rebase (a pre-rebase prior-round SHA is no longer reachable, so re-record it after the rebase).

Out of scope: gating-rule changes, peer-launch mechanics (task 015), scratch hygiene (task 017).

## Context and references

- **Sequencing**: implement AFTER 014. All six heuristics are protocol content, authored ONCE in the canonical `review-cycle` block — the skill text and its `wf-review-cycle` prompt templates — and then carried into every derived rendering: the Codex mirror, and each copy synthesized from the `wf-review-cycle` embeddable section, which per 014a includes the one `wf-address-tasks` embeds. A consumer that reaches the block by reference needs no edit; a consumer holding a synthesized copy does. The per-skill anchors below describe the pre-014 world.
- `plugins/dev-skills/skills/address-review/SKILL.md` — the fix/review loop section (round cap paragraph) is the anchor for items 1–4; the Fixer/Reviewer prompt-content specs anchor items 5–6.
- `plugins/dev-skills/skills/address-reviews/SKILL.md` — inherits per-PR loops; add pointers, not duplication, where it references the single-PR protocol.
- `codex/dev-skills/skills/*` mirrors.

## Target files or areas

- `plugins/dev-skills/skills/review-cycle/SKILL.md` and `plugins/dev-skills/workflows/wf-review-cycle.js` (post-014 primary), the `codex/dev-skills/skills/review-cycle/` mirror, and `plugins/dev-skills/workflows/wf-address-tasks.js`, which per 014a embeds its own copy of the `wf-review-cycle` embeddable section.
- Pre-014 fallback: `plugins/dev-skills/skills/address-review/SKILL.md` (primary), `plugins/dev-skills/skills/address-reviews/SKILL.md`, codex-side mirrors (pointers/mirrors)

## Implementation notes

- Budget discipline: these skills are long already (~318 lines); aim for +15–25 lines total on the Claude side. Each heuristic is one tight paragraph or bullet — the value is naming the pattern and the sanctioned exit, not narrating the war stories.
- Items 1–2 are orchestrator-level (round decisions); 3 is fixer+reviewer contract; 4–6 are briefing content. Place them where those roles are already specified rather than in a new catch-all section.

## Acceptance criteria

- All six patterns are present, each naming its trigger and the prescribed response. Item 2's trigger is a stated number of consecutive rounds — two, or a higher number the delivered text names outright — so "several" or an unbound `N` fails this criterion.
- No existing gate/round-cap semantics changed.
- Combined addition stays within roughly the stated budget; no duplicated prose between the two skills.

## Validation

- Read-through as a fixer and as an orchestrator: for each of the six failure modes, the skill now tells you what to do at the moment you'd hit it.

## Review plan

Reviewer checks each addition sits in the section governing the role that acts on it, and that "bound the claim" is framed as a legitimate resolution requiring honest premises — not as permission to weaken criteria to dodge findings.
