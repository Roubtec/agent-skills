# 045 — Assert the output-destination rule the way the destroy boundary is asserted

## Why this task exists

Task 017 put an output-destination sentence into every subagent brief that orders a build or validation, but `scripts/test-subagent-destroy-boundary.mjs` asserts only the destroy boundary — so deleting a destination clause today breaks no test, and the rule is protected by reading alone. 017's own delivery is the evidence that reading is not enough: four consecutive review rounds each found a build-ordering brief the previous round's reading had missed — the cycle briefs, then `resolveCollisionsPrompt`/`gatherPrompt`/`resolve-open-questions`' generic delegation, then the two batch skills' implementer templates plus `address-review`'s Fixer contract and `address-tasks`' restack subagent, then `resolve-open-questions`' second, review-specific spawn site. The suite's own header already records that three rounds of 017 eyeballed the sources and each missed a path; that PR added a fourth. Every one of those was a missing destination, which is precisely the class no assertion covers.

## Scope

Included:

- **The assertion**, over the prompt paths the suite already renders, that a brief ordering a build or validation names a destination for redirected output.
- **The design fork it must resolve, stated rather than assumed.** The existing PRESENCE check works by exact containment of a boundary constant *declared in the prompt's own file*. The destination text is not one constant: `CYCLE_REDIRECTED_OUTPUT` covers only the `review-cycle-core` briefs, while `resolveCollisionsPrompt`, `gatherPrompt` and the skill sites carry bespoke per-site wording — deliberately, because the safe destination differs by whether the role commits from the tree it would write into. So the check must first decide *which* rendered prompts order a build, and both obvious routes are compromised: deriving it from the rendered prose is exactly what the suite's header rejects ("nothing is re-derived from prose"), while hardcoding the list of build-ordering builders reintroduces the failure mode this task exists to close — a new builder absent from the list is silently missed. Pick a route with that tension acknowledged; do not treat this as a cheap fourth check.
- **A candidate third shape, offered not mandated:** make the destination a per-file constant in the `DESTROY_BOUNDARY` mould, so presence becomes exact containment again. The cost is that today's per-role wording must collapse into a small set of constants, which may not survive the roles' genuinely different safe destinations.
- **The prose skill briefs, which nothing renders.** 017's destination clauses also live in Markdown `SKILL.md` briefs across both mirrors — `address-review`'s Fixer contract, the batch skills' implementer and reviewer templates, and their siblings; enumerate them by grepping for the shared-scratchpad warning, not from any list here — and several of 017's missed rounds were exactly such files, so an assertion over the rendered workflow prompts alone leaves a deleted prose clause green. There is no builder to render there: the file text is the brief, so the prose assertion is necessarily a deletion guard — a stable anchor of each shipped clause must remain present in its file, in both mirrors — and it cannot discover a *new* prose brief the way call-site accounting discovers a new builder. State that asymmetry in the suite header and README rather than implying prose parity with the rendered checks.
- **A cross-reference at the `review-cycle` Fixer contract.** Its "commit/validation instructions" line reads as uncovered; the Artifacts all-roles rule ~93 lines below actually covers it, and PR #47 confirmed that by rendering. Point the first at the second so the next derivation does not re-raise it — a pointer, never a restatement, per 043.

Out of scope: changing any destination wording that shipped with 017; extending the rule to artifacts other than redirected build/validation output; and any re-litigation of 017's per-role destination choices, which were reviewed and are settled.

## Context and references

- Task 017 — the sweep this task makes enforceable. Its acceptance criterion is reviewer-shaped ("a reviewer told to run a build is told where that build's output goes"), which is why the non-reviewer sites had to be derived rather than listed, and why nothing asserts them.
- PR #47 — the four rounds above. Both its final reviewer and the codex peer judged this gap worth recording and not worth another round on that branch.
- `scripts/test-subagent-destroy-boundary.mjs` header — the "why rendering rather than reading" rationale, and the exact-containment principle this task must either honor or knowingly depart from.
- The suite is described in more than one place — root README's focused-tests paragraph enumerates what it fails on, its scripts-tree comment names its remit in one line, and `plugins/dev-skills/workflows/README.md` carries its own detailed paragraph on what the suite evaluates; widening the suite is a documented-contract change and every one of those descriptions moves with it.

## Target files or areas

- `scripts/test-subagent-destroy-boundary.mjs`
- `README.md` — the paragraph listing the suite's failure conditions, and the scripts-tree comment line naming the suite
- `plugins/dev-skills/workflows/README.md` — the paragraph describing what the suite evaluates (no codex mirror of this file exists)
- `plugins/dev-skills/skills/review-cycle/SKILL.md` and `codex/dev-skills/skills/review-cycle/SKILL.md` — the Fixer-contract cross-reference, both mirrors in lockstep
- The `SKILL.md` mirror pairs carrying 017's destination clauses — read as assertion inputs; this task does not modify them

## Implementation notes

Reuse the existing declaration-prefix and `new Function` harness and the prompt paths it already renders; the rendered side needs no new rendering machinery, only a second assertion over the same renders, and the prose side needs only file reads — there is nothing to render. If the suite's remit widens, say so in its header comment and in every README description of the suite — root README's entry and tree comment, and the workflows README's paragraph — rather than letting the code and the documented contract drift. Keep the two skill mirrors byte-identical in the added clause and confirm the pair's divergence count is unchanged.

## Acceptance criteria

- Every rendered prompt that orders a build or validation is asserted to name a destination, and the mechanism for deciding "orders a build" is stated in the source together with what it does and does not catch.
- Every shipped prose brief carrying a 017 destination clause is deletion-guarded in both mirrors, and the suite header and README state that prose briefs are guarded against deletion but not discovered.
- Removing a shipped destination clause from any one brief — a rendered workflow prompt or a Markdown skill brief, in either mirror — makes the suite fail, demonstrated by actually doing it, not asserted.
- Every description of the suite matches what it now checks: root README's failure-conditions enumeration and scripts-tree comment, and the workflows README's paragraph on what the suite evaluates.
- The `review-cycle` Fixer contract points at the Artifacts all-roles rule in both mirrors, with that pair's divergence count unchanged.

## Validation

Run `node scripts/test-subagent-destroy-boundary.mjs`, then the negative control above, then the focused suites named in `.github/workflows/tests.yml`. Re-check every skill mirror divergence count against its pre-change value.

## Review plan

The reviewer must independently re-derive at least one build-ordering site rather than trusting the check's own notion of the set, and must run the negative control themselves — a check believed on its own passing report is the same mistake, one level up, as the reading this task replaces.
