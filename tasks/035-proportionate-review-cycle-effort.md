# 035 — Proportionate effort in the review cycle: validation tiers, unrelated-flake deferral, and trivial-round close-out

## Why this task exists

The review cycle currently applies maximum rigor uniformly: consumers instruct implementers to run full validation before reporting done and reviewers to build first every round, with nothing licensing less on an intermediate round — so repos with heavy suites (15+ minute DB/e2e runs) pay that cost per verbiage tweak, and a round whose only findings were two wording nits still buys a full fresh-reviewer-plus-peer round. One real batch run of 7 tasks had every implementer independently burn most of its implement→review→fix rounds trying to stabilize the same unrelated flaky test suite. The protocol needs to say where full rigor is mandatory (the delivery boundary) so it can stop paying for it everywhere else.

## Scope

Three protocol items, authored once in the canonical `review-cycle` block — the skill text and the `wf-review-cycle` prompt templates — and carried into every derived rendering (the Codex mirror, the `wf-address-tasks` embedded copy), per the pattern 019 establishes. Consumer skills keep only their deltas.

1. **Tiered validation.** Name two tiers and who decides. The **round tier** (every intermediate round) runs the cheapest signal able to catch what that round actually changed: typecheck/lint for ordinary code edits, targeted tests for touched behavior, and — when the round's diff contains no executable change (comments, prose, docs) — no build at all. The **delivery tier** (before the cycle concludes, and always before the final push and any PR creation or publication) runs the full applicable sanity set: lint, typecheck, build, tests — whichever of these the repo has. Intermediate durability pushes — the push-after-every-commit discipline `address-tasks` (skill and workflow rendering) mandates for worktree safety — are not delivery events and never require the delivery tier; the boundary is the final state being concluded or published, not the act of pushing. A cycle must not conclude or publish on anything less than a delivery-tier pass of the final state. The orchestrator picks each round's tier and states it in the fixer and reviewer briefs; the reviewer's existing build-first rule applies at the stated tier rather than unconditionally. Guards: when in doubt about blast radius, run more, not less; a round touching build configuration, dependencies, or generated contracts always builds.
2. **Unrelated-flake deferral.** When a test fails in an area the branch did not touch, first establish unrelatedness cheaply and with evidence: the failure must reproduce on the base, or on an equivalently controlled comparison that holds the branch's own changes out, with at most one rerun to confirm intermittence. That reproduction is the proof, and nothing else substitutes for it — a failure confined to code paths the branch never edited is a supporting signal only, because a branch that changes a shared utility, a dependency, an environment setting, or a generated input can break a test whose whole execution stays in untouched code. Then do **not** iterate on stabilizing it in this branch: queue a follow-up task carrying only the diagnosis already in hand (no further investigation), note the flake in the PR body or batch summary so the maintainer can judge, and proceed to delivery with the failure documented. Reuse the existing follow-up-task machinery: `write-tasks` conventions, committed on the current branch. The reviewer treats a documented, evidenced unrelated flake as non-blocking; the existing automatic-blocker rule is build/typecheck-specific, and this item extends its spirit to tests — any failure the branch plausibly caused stays blocking. State explicitly that concurrent agents queuing duplicate flake tasks is acceptable — far cheaper than concurrent stabilization attempts — but do not promise that a sweep collapses them: `reap-tasks` flags duplicate task *numbers*, not duplicate content, so two flake tasks under different numbers would sit in the queue indefinitely. Bound the duplication where it is created instead: name the failing suite or test in the task title so a sibling copy is greppable, have the writer grep the task folder for an existing task on that suite first and add its evidence to that file when one already exists, and leave consolidating whatever still lands to the maintainer at the next reaping sweep.
3. **Trivial-round close-out.** When a passing-adjacent round's remaining findings are exclusively non-semantic — wording, typos, comment phrasing, formatting; nothing touching behavior, logic, or the meaning of acceptance criteria — the orchestrator may have the fixes applied and conclude the cycle without another reviewer-plus-peer round. The result records the close-out and lists the edits that shipped unreviewed; every finding still receives an explicit disposition. This deliberately amends the rule that anything the final pass fixes goes through another reviewer round: that rule keeps holding for anything semantic, and the close-out is never a way to swallow a finding without disposition. Position it beside `light` mode as a second bounded invoker/orchestrator discretion, and keep the two distinct (`light` skips the final no-op fixer pass; close-out skips the re-review of trivially-fixed findings).

Out of scope: the round cap and its semantics, the peer launch mechanics (015), the disposition vocabulary, and the six convergence heuristics of 019.

## Context and references

- The wasteful patterns this encodes against were observed in live batch runs; the 7-task flaky-suite incident is the motivating case for item 2.
- Task 019 — convergence heuristics landing in the same sections; implement this after 019 to avoid churny conflicts. Unlike 019, this task **does** amend gates, knowingly: item 1 conditions the reviewer's build-first rule on the stated tier, item 2 makes an evidenced unrelated test failure non-blocking, and item 3 lifts the re-review rule for non-semantic fixes.
- Task 033 — pipelining raises round throughput, which multiplies whatever each round costs; this task is what keeps that affordable.
- Task 014 — the extraction that makes the canonical block the single authoring point.

## Target files or areas

- `plugins/dev-skills/skills/review-cycle/SKILL.md` and `plugins/dev-skills/workflows/wf-review-cycle.js` (primary), the `codex/dev-skills/skills/review-cycle/` mirror, and the `wf-review-cycle` embedded copy inside `plugins/dev-skills/workflows/wf-address-tasks.js`.
- Consumer validation phrasing to align with the tiers (deltas only, no duplicated protocol prose): the implementer-prompt validation bullets in `plugins/dev-skills/skills/{address-tasks,address-tasks-serialized}/SKILL.md`, the build/lint-before-done line in `address-review` step 5, and their codex mirrors.

## Implementation notes

- Budget discipline as in 019: each item is one tight paragraph placed in the section governing the role that acts on it; aim for roughly +20–30 lines on the Claude side per rendering.
- Item 1's tier decision must be legible in the round record — a reviewer told "round tier: typecheck only" knows not to block on an unrun suite; one told nothing runs the delivery tier.
- Item 2's evidence requirement is the anti-evasion guard: "unrelated" is a demonstrated property (it reproduces on the base), never an assertion of convenience and never an inference from which code paths the failure happens to run through.
- Item 3 must not weaken 019's heuristics: consecutive rounds of trivial findings in the same section remain a structural signal, not an invitation to close out repeatedly.

## Acceptance criteria

- The canonical block names both validation tiers, who selects the round tier, and the no-executable-change case that skips builds; the delivery tier is stated as mandatory before conclusion and publication (final push, PR creation) and lists lint/typecheck/build/tests as-applicable, with intermediate durability pushes explicitly exempt.
- The flake policy is present with its base-reproduction evidence requirement (untouched code paths stated as insufficient on their own), one-rerun bound, diagnosis-only task content, PR/summary note, non-blocking reviewer treatment, and the duplicate-tasks-are-acceptable statement together with the greppable-title plus grep-first-and-append reuse step that bounds the duplication.
- The close-out is present, bounded to non-semantic findings, recorded in the cycle result with the unreviewed edits listed, and explicitly reconciled with both the every-fix-re-reviewed rule and `light` mode.
- No other gate, cap, or disposition semantics changed; all renderings (skill, workflow templates, embedded copy, codex mirror) say the same thing.

## Validation

- Read-through at the three decision moments: "the suite takes 15 minutes and I changed a comment", "an untouched suite is red", "the last round asked for two wording fixes" — the text now answers each.
- `wf-check` passes on every edited workflow script; grep the renderings for tier vocabulary to confirm consistency.

## Review plan

Reviewer checks each item sits with the role that acts on it, that none of the three opens an evasion route (a skipped round-tier build can never substitute for the delivery gate; unrelatedness requires evidence; close-out cannot swallow a semantic finding or an undisposed one), and that the renderings did not drift from one another.
