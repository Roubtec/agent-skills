# 046a — Sweep the remaining unguarded `cd`-into-a-variable sites

## Why

Task 046 closed the destroy-boundary occurrences: every shipped copy of the boundary that names the disposable clone now mandates a guarded `cd -- "${DC:?…}"` rather than a bare `cd "$DC"`. That is the site the incident actually went through, and it is the only one 046 touched. The message inside that expansion has since grown the install step it points at, in task 046b's review round, so grep for the guarded form rather than for the wording 046 shipped.

It is not the only site. These skills and workflows tell an agent to `cd` into a path held in a variable in several other places — a task worktree resolved by `wt-enter`, a checkout path a brief carries, an artifact directory a round created — and each of those has the same failure mode 046 measured: `cd ""` exits 0 and moves nowhere, so a lookup that produced nothing leaves the agent in whatever directory it was already in, believing it left. The worktree case is the one with teeth, since the directory it was already in is usually the shared main checkout.

This task is the residual sweep. It is queued rather than deferred: it has no unmet prerequisite, and 046 landing is what makes the target form already written down.

## What to do

- Sweep `plugins/dev-skills/workflows/wf-*.js`, `plugins/dev-skills/skills/*/SKILL.md`, and the `codex/dev-skills/skills/*/SKILL.md` mirrors for every place the text tells an agent to change directory into a path held in a variable — searching for `cd "$`, `cd $`, and the `WT=`/`DC=`/`ARTIFACT` assignment forms that feed one, since the instruction and the `cd` are often sentences apart.
- Give each site the same guarded form, with a message naming the step that was supposed to produce the path (`wt-enter returned no path`, and so on) rather than a generic one — the message is the whole diagnostic when it fires.
- Where a site already carries a different guard (an explicit `[ -n "$WT" ]` test, a `git rev-parse --show-toplevel` comparison), leave it and note it as covered rather than adding a second check; prefer one form per site.
- Keep the plugin and codex mirrors consistent, and check whether any of the touched text is under a byte-identity assertion before editing it — `scripts/test-subagent-destroy-boundary.mjs` and the `review-cycle-core` section check both hold text in this area.
- Consolidate wording where two adjacent rules now say overlapping things. Task 017b's boundary adds "NEVER chain a state-changing git command after a `cd` whose success you have not checked", and 046's addition explains why checking the status is not enough for the empty case; after both have landed, one clause carrying both facts may read better than two.

## Acceptance criteria

- No shipped skill or workflow text instructs an agent to `cd` into a path held in a variable without a guard that fails on an empty or unset value.
- Each guard's message names the step that should have produced the path.
- The plugin and codex copies of every touched section still agree, and every suite named in `.github/workflows/tests.yml` passes.
- Sites already guarded by other means are listed in the PR description as covered, so the sweep's completeness is checkable rather than asserted.
