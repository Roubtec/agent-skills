# 023b — A reliability recipe for the task workflow's PR-creation read-backs

## Why this task exists

Task 023 put one authoritative recipe for each of five GitHub/`gh` behaviors at the step that performs the operation, and 023a carried two of them into `wf-address-review.js`'s publication brief because that workflow is a peer entry point whose publisher has read no skill. Both rounds of 023a's review found a sixth operation of the same kind, in a different workflow, and both agreed it is outside 023's five rather than an instance of one of them.

`wf-address-tasks.js`'s `prPrompt` reads a PR it has just created back through the same eventually-consistent API that 023's item 1 exists for. Its step 1 pushes the branch and its step 2 runs `gh pr create --head` immediately after; step 3 then asserts the new PR's base with `gh pr view <pr-url> --json baseRefName`; and step 4 recovers a creation that failed before printing a URL by looking the PR up by head branch with `gh pr list --head`. Every one of those reads can answer for a state the server has not converged on yet: a `gh pr create` that succeeded server-side may not yet be visible to a by-head lookup, and a base just set may not yet be what a read-back reports.

Item 1 does not cover this. It is scoped to confirming a PUSH at the ref — `headRefOid` after a push, read back with `git ls-remote` per push URL — and `prPrompt` verifies no push at all: what it verifies is a PR's existence and its base. So the operations rhyme while the recipe does not transfer, which is why this is its own task rather than an extension of 023 or a third inline copy in 023a's branch.

The cost of the gap is concrete in both directions. A by-head lookup that has not converged reports nothing, step 4 retries creation, and the run opens a second PR for one branch — the failure mode step 4 was written to prevent. A base read-back that has not converged reports the pre-repair base, and the run reports `opened: false` with `baseOk: false` over a PR that is in fact correctly based, holding a delivered branch back.

## Scope

Included:

- **One recipe for the PR-creation read-backs, at the steps that perform them**, in `prPrompt`. What settles each read, and what a read that cannot settle it means: a lookup that finds nothing is not proof that no PR exists, and a base that disagrees once is not proof the repair failed.
- **Whether the existing structured contract can already carry the distinction.** `PR_SCHEMA`'s `opened`, `baseOk`, `baseRepaired` and `reason` are the fields the caller acts on; decide whether an unconverged read needs a value of its own there or is adequately reported through `reason`, and say which in the change. Do not assume a new field.
- **The retry decision, which is the load-bearing half.** Step 4 retries creation only where its lookup finds nothing; a recipe that leaves that condition unchanged has bought nothing. State what makes a nothing-found lookup trustworthy enough to retry on, and what to do instead where it is not.

Out of scope: the five recipes 023 settled and 023a rendered, whose wording neither this task nor its review reopens; the delivery-tier base assertion itself (task 037 settled what is asserted and where); and `wf-address-review.js`, which performs no PR creation.

## Constraints this task must respect

Task 044's rule governs what may be written into a workflow prompt: state the instruction, not a per-case why. `prPrompt` is a brief handed to a subagent, so a recipe here is inline text rather than a pointer — 023a's peer-entry-point finding applies to this workflow for the same reason, and its Scope records why a pointer was rejected.

Where the recipe restates a rule the `address-tasks` skill already owns, it is a second copy and must be pinned against that skill's sentence the way 023a's two are, or it will drift. Where the skill owns no such rule, the workflow is the sole authoring point and nothing is duplicated into a skill.

## Context and references

- Task 023 — the parent, its five behaviors, and its "one authoritative recipe at the step that performs the operation" criterion.
- Task 023a — where this gap was found, and where the peer-entry-point question was answered for the sibling workflow.
- Task 037 — the base assertion `prPrompt`'s step 3 performs, and why the read-back happens at all.

## Target files or areas

- `plugins/dev-skills/workflows/wf-address-tasks.js` — `prPrompt` and, if the decision above calls for it, `PR_SCHEMA`.
- `scripts/test-unreviewed-close-carriage.mjs` — the suite that already renders `prPrompt` (both the remote and no-remote paths); the pin belongs beside its existing reads of that brief rather than in a new suite.

## Acceptance criteria

- Every read-back in `prPrompt` either carries what settles it or says what an unsettled answer means, and the retry condition states which answers it may act on.
- No second PR can be opened on the strength of a lookup that merely has not converged.
- Any wording shared with the `address-tasks` skill is pinned against that skill's own sentence in both mirrors; no workflow prose is moved into a skill.
- The suite that renders `prPrompt` covers the added clauses, and its check count moves deliberately.

## Validation

- The nine focused suites in `.github/workflows/tests.yml` stay green, and `wf-check` passes on `wf-address-tasks.js`.
- Render `prPrompt` for both the remote and no-remote paths and read the added clauses out of the rendered text rather than out of the builder.

## Review plan

Reviewer checks that the recipe changed the retry decision rather than only describing the hazard around it, that nothing here restates one of 023's five under a new name, and that any copy shared with the skill fails when either side is reworded alone.
