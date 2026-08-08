# 017b — Two corrections to 017's shipped guidance: address a repository by path, and diagnose from observable state

## Why this task exists

Task 017 delivered two pieces of guidance that a parallel `address-tasks` batch on 2026-08-08 exercised and found wanting. Both are text that ships today; neither is a gap in what 017 intended, and both are corrections to how it was expressed.

**The destroy boundary names forbidden commands and a permitted location, but never the addressing form.** During that batch a fix-up subagent ran a compound command beginning `cd "$(ls -d <scratchpad>/tmp.*)"`. Sibling agents had already created scratch directories under the same parent, so the glob expanded to three paths, `cd` failed, and the remaining `;`-separated commands executed in the repository's shared main checkout — creating an empty commit on `main`, a branch `other`, and two `refs/pruned/**` symrefs. Every individual command was one the prompt authorised, and every one was aimed at a location the prompt authorised. Only the *addressing* was wrong, and the boundary has nothing to say about that. The agent then repaired the damage with `git branch -d` and `git reset --soft` — a command the boundary names as forbidden, self-authorised after the fact — which the orchestrator verified against the reflog rather than accepting: `main` was restored to its original OID, the stray commit left unreachable, nothing pushed and nothing lost.

The failure is fail-safe only by accident. The stray commit happened to be empty; a `checkout`, a `clean`, or a commit carrying content in that position would have reached a co-tenant's uncommitted work, which is the exact hazard the "Main-checkout cleanliness report" exists to detect after the fact and the boundary exists to prevent up front.

**The diagnosis-discipline rule prescribes an instrument the harness forbids.** 017 item 4 shipped "Verify it against that subagent's own transcript — bounded greps for the specific commands it claims it ran." In the Claude Code harness the subagent's transcript path is returned with an explicit instruction not to read or tail it, because it is full JSONL and will overflow the orchestrator's context. Both instructions were live in the same run. The orchestrator verified the incident above through `git reflog` and direct ref inspection instead, which was strictly better evidence — it observed the effect rather than the claim — but it did so by departing from the shipped rule rather than by following it.

## Scope

Included:

- **State the addressing form in the destroy boundary.** A subagent addressing any repository other than its own assigned worktree does so with `git -C <absolute path>`. It never derives a working directory from a glob, and never chains state-changing git commands after a `cd` whose success it has not checked.
- **Do not outlaw the guarded forms already shipped.** An audit of the current text found every `cd` in shipped guidance is already checked or confined: `( cd "$WT_BASE/pr-<N>" && gh pr checkout N )` in `address-reviews`, `cd "$worktree" || exit 125` in `review-cycle`'s peer launch, and `WT="$(wt-enter …)" && cd "$WT"` in `wf-address-tasks.js`. The defect was an *unchecked* `cd` with a glob-derived target followed by `;`-chained state changes, and the new clause must be written narrowly enough that those three keep passing. Prefer stating the requirement positively (`git -C`, and check any `cd`) over prohibiting `cd` outright.
- **Replace the transcript instrument in the diagnosis-discipline rule.** Verification is against **observable state** — reflog, refs, working tree, file contents, command output — with a transcript named only as a fallback where the harness exposes a greppable one. The rule's premise is correct and stays: a subagent's environment or infrastructure diagnosis is a hypothesis, not a finding.
- **Both mirrors of every touched file**, which must stay in parity apart from harness-specific wording.
- **An assertion for the addressing clause** in `scripts/test-subagent-destroy-boundary.mjs`, added as one more entry in that suite's boundary-content clause list, which is checked once per boundary constant. The suite's existing exact-containment presence check then carries the clause into every rendered prompt for free.

Out of scope:

- The forbidden-command list itself, the `dc-enter` disposable-clone exemption, and the worktree-is-not-a-blast-radius paragraph — all correct and unchanged.
- The output-destination assertion, which is task 045's.
- `rebase-stack`'s own destroy boundary, which is task 017a's.
- Any change to what the boundary permits a fixer or implementer to do inside its own worktree.

## Context and references

- 017 — the parent task; item 4 delivered the diagnosis-discipline one-liner and item 5 delivered the destroy boundary. Both are the text this task corrects, so this is a follow-up under 017's number rather than a new claim.
- 017a — states `rebase-stack`'s own destroy boundary; disjoint from this, but it surveys where the boundary is embedded and is the best map of that surface.
- 045 — adds an output-destination assertion to `scripts/test-subagent-destroy-boundary.mjs`, and its Scope states a design fork this task does **not** face. That fork exists because the destination text is not one shared constant and applies only to a subset of builders, so 045 must first decide *which* rendered prompts order a build. The addressing clause has neither problem: it goes inside each `*DESTROY_BOUNDARY` constant, and the suite already checks every such constant against its clause list while separately proving, by exact containment, that each rendered brief carries a whole constant. **So extend that existing clause list — do not import 045's mechanism, and do not invent a second one.** The two tasks are independent here and may land in either order.
- The destroy boundary currently ships in seven skills across both trees (`address-review`, `address-reviews`, `address-tasks`, `address-tasks-serialized`, `reap-tasks`, `resolve-open-questions`, `review-cycle`), plus `plugins/dev-skills/workflows/README.md`. `reap-tasks` is the one easiest to miss, and the one that can least afford to be: its sweep has no worktree isolation at all — every subagent it spawns shares the single checkout — and it requires the boundary in every verification-subagent prompt it composes, so it belongs in the edit sweep and the acceptance check alongside the other six. The diagnosis-discipline rule ships in three across both trees (`address-tasks`, `address-tasks-serialized`, `address-reviews`). Re-derive the exact set before editing; 017a's survey is a starting point, not a current census.

## Target files or areas

- `plugins/dev-skills/skills/{address-review,address-reviews,address-tasks,address-tasks-serialized,reap-tasks,resolve-open-questions,review-cycle}/SKILL.md` and the `codex/` mirrors
- `plugins/dev-skills/workflows/README.md`, and any workflow prompt builder that renders the boundary
- `scripts/test-subagent-destroy-boundary.mjs`

## Implementation notes

- Keep it proportionate. This is one clause added to a boundary that already exists and one instrument swapped in a rule that already exists — not a rewrite of either.
- The boundary is quoted verbatim in many places, so the clause must be short enough to carry everywhere without deforming the surrounding text.
- The incident is worth stating in one sentence wherever the boundary already carries its own cautionary example, for the same reason that example is there: the rule is easier to follow when the reader knows what it is protecting against.

## Acceptance criteria

- Every rendering of the destroy boundary states that a repository other than the subagent's own worktree is addressed by path (`git -C <absolute path>`), that a working directory is never derived from a glob, and that state-changing git commands are never chained after an unchecked `cd`.
- The three guarded `cd` forms already shipped (`address-reviews`'s subshell checkout, `review-cycle`'s `|| exit 125` peer launch, `wf-address-tasks.js`'s `&& cd "$WT"`) remain valid under the new clause, and are not edited to satisfy it.
- No rendering of the diagnosis-discipline rule instructs the orchestrator to read or grep a subagent transcript as its primary instrument; each names observable state instead, and the hypothesis-not-a-finding premise is unchanged.
- `scripts/test-subagent-destroy-boundary.mjs` fails when a boundary constant lacks the addressing clause, through one added entry in its existing per-constant clause list rather than a second detection mechanism.
- Both mirrors carry both changes and differ only in harness-specific wording.

## Validation

- Run `node scripts/test-subagent-destroy-boundary.mjs`, and confirm it fails when the addressing clause is deleted from one boundary constant and passes when it is restored.
- Reproduce the original failure shape in a scratch repository to confirm the clause describes it: create two sibling directories matching one glob, run `cd "$(ls -d <glob>)" ; git commit --allow-empty -m x` from a third repository, and observe the commit landing in the third repository rather than either sibling.
- Grep both trees for the diagnosis-discipline paragraph and confirm no rendering still names a transcript as the primary instrument.

## Review plan

Reviewer confirms the addressing clause is stated positively rather than as a blanket prohibition on `cd`, and specifically checks the three shipped guarded forms still comply — a clause that reads as "never `cd`" is a finding, because it would invalidate working recipes this task explicitly protects. Reviewer also confirms the diagnosis rule's premise survived the instrument swap, that the new assertion is one more clause on the existing per-constant check rather than a second detection mechanism, that `reap-tasks` was swept with the other six skills, and that both mirrors stay in parity.
