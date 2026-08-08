# 044 — Strip drifting prose from the workflows: sweep what is already there, and extend the discipline to prompt literals

## Why this task exists

Task 043 stops new drift-prone comments being written; it does not remove the mass already shipped, and it governs code comments only.

A batch run addressing three review threads on PR #56 spent eight reviewer rounds converging. The three threads were dispositioned in the first fix pass; rounds 3 through 8 found almost nothing about them, and instead found successive falsehoods in the explanatory prose each previous round had written while fixing something else. Roughly half of those findings were maintainer-facing text with no runtime effect at all — a comment claiming a call site renders an unstated tier after the same branch had made it state one, a suite header claiming no second copy of anything under test lives there after the same round added one, a parenthetical giving one conclusion another conclusion's reason. Each cost a full fix-review-peer round, and each fix wrote more prose for the next round to falsify.

The mechanism is narrower than "comments rot". Nearly every drifting statement was a **per-case why**: an explanation of why a value is what it is across a closed set of cases. `recordOnly` accumulated four exits over the PR's life, and every sentence enumerating three of them became false the moment the fourth arrived. Statements of *what the code does* survived; statements of *why, case by case* did not.

The mirrors multiply the cost. A sentence inside the `review-cycle-core` embeddable section exists byte-identically in two workflows, and its counterpart in a skill exists again in both the plugins and codex trees, so one explanation can occupy four maintained places and one drift can produce four findings. This is visible in the run's negative controls, which repeatedly failed "exactly two, one per leg".

The same shape appears in text that is not a comment. Prompt literals and schema field descriptions are read by an agent rather than a maintainer, so a false statement there is a behavior defect and deletion is not always available — but the per-case why is exactly as fragile in a prompt as in a comment, and the run's most expensive single finding was one: a clause telling the reader why a record named no commit, rewritten three times and false twice, until both reviewers independently concluded the fix was to stop stating the why and keep only the instruction. That resolution is the general rule this task generalises.

## Scope

Included:

- **A sweep of existing comments in the three workflow scripts against 043's shipped-comment test.** Delete what restates adjacent code, what narrates a condition-by-condition outcome matrix, and what duplicates intent already stated in the corresponding skill. Delete rather than precision-edit; a stale narration comment's correct fix is removal. This is a deletion pass, not a rewriting pass — where a comment is wrong and load-bearing, fix it, but the default disposition is removal.
- **A keep-list, stated positively so the sweep cannot over-reach.** Keep a rejected alternative and the reason it was rejected (these prevent re-litigation and do not drift, because they describe a decision rather than a current state — the `wt-remove` `SQUASH_MSG` note in the container guidance is the model); keep a non-obvious external constraint; keep a deliberate asymmetry a reader would otherwise take for a bug; keep a still-standing overruled-review decision per 043's carve-out. Everything else in 043's welcome categories continues to qualify.
- **Extend the discipline to prompt literals and schema field descriptions, as a different rule.** These are behavior — an agent acts on a prompt, and a schema description steers the structured output it produces — so the rule is not deletion but **state what to do, never why it is so across cases**. A consumer holds one instance and cannot tell which case it is, so any stated per-case why may be false for the instance in hand. Where a prompt currently explains why a field is empty, or why a check is skipped, or which of several situations produced the state it describes, reduce it to the instruction. Where the why is genuinely operative — the reader must act differently depending on it — the prompt must carry the discriminator as data, not as prose the reader is asked to infer from.
- **Point at the skill for intent; do not relocate detail into it.** A workflow comment that restates what the corresponding skill already says should be deleted, not moved. The skill states intent, the code states mechanism, and neither restates the other. This is a hard boundary: expanding a skill toward an exhaustive specification of its workflow is a failure mode this repo has already paid for (see 029's history), and no part of this sweep may push workflow detail up into a skill.
- **Prefer one authoring point over four aligned copies.** Where an explanation must survive, place it where it is authored once — inside the `review-cycle-core` embeddable section rather than beside each consumer's call site, so the mirror machinery propagates it instead of a human aligning copies.

Out of scope: the test scripts' comments and check names (they drifted too, but a test's prose is read at failure time and the economics differ — a separate task if the sweep shows it is worth one); `README.md` and the skill files themselves; task files, which 041 already governs; and any change to what the workflows *do*. This is a prose sweep with zero behavioral delta, which is what makes it cheap to review.

## Context and references

- Task 043 is the forward rule and the prerequisite: it authors the shipped-comment test, the welcome categories, the channel routing and the reviewer-side weighting in the canonical `review-cycle` block. 044 sweeps the existing corpus against that test and extends it to the non-comment prose 043 does not cover. Implement 043 first; this task applies it.
- Task 041 covers stable, symbol-anchored references in task files — the same anti-drift instinct applied to citations rather than explanations.
- The `review-cycle` skill's own record contract already states the principle this task generalises: a consumer is told whether a record names an unreviewed post-run commit, and never why it does not. That sentence is the model for the prompt-literal rule.

## Target files or areas

- `plugins/dev-skills/workflows/wf-review-cycle.js`, `wf-address-tasks.js`, and `wf-address-review.js` — comments, prompt literals, and schema field descriptions.
- The `review-cycle-core` embeddable section, whose byte-identity between the first two files must survive the sweep unchanged.

## Implementation notes

- Work in passes by category rather than file by file: first comments that restate code, then per-case whys in comments, then per-case whys in prompt literals and schema descriptions. Mixing the passes makes the diff unreviewable and invites exactly the scope creep this task exists to reduce.
- The sweep is an enumeration, not an assertion: list every site considered with its disposition, so a reviewer checks a list rather than re-deriving the corpus. A claim that the corpus was swept is not a deliverable.
- Measure the result. Record the line count of each workflow and of the embeddable section before and after; the point of the task is a smaller corpus, and an unmeasured sweep cannot show it achieved one.
- Byte-identity between the two `review-cycle-core` copies must hold at every commit, not only at the end — a deletion pass is unusually easy to apply to one copy and forget in the other.
- Expect the diff to be large and almost entirely deletions. Resist adding a comment explaining why a comment was removed; version control holds that.

## Acceptance criteria

- Every comment remaining in the three workflow scripts either passes 043's shipped-comment test or falls under this task's keep-list, and the sweep's enumeration shows the disposition of each site considered.
- No prompt literal or schema field description states a per-case why. Where a reader must act on a distinction, the prompt carries it as data rather than as prose to be inferred.
- No workflow comment restates intent the corresponding skill already states, and no skill gained workflow detail as a result of the sweep — skill files are untouched by this task.
- `review-cycle-core` remains byte-identical between `wf-review-cycle.js` and `wf-address-tasks.js`, and the plugins/codex skill-mirror divergence counts are unchanged, since no skill is edited.
- Before/after line counts are recorded for each workflow and for the embeddable section.
- Every regression suite passes with no change to any check count — a prose sweep that moves a count has changed behavior and needs a negative control explaining why.

## Validation

- Run the full regression suite set and `wf-check` on each edited workflow; every count must be unchanged from the pre-sweep baseline.
- Verify the embeddable section's byte-identity with the documented extraction after every commit.
- Render the prompt builders the sweep touched and diff their output against the pre-sweep rendering: for a comment-only deletion the rendered text must be identical, and for a prompt-literal reduction the diff must contain only the removed why-clause. Rendering is the check that matters here — reading the builder is what let three successive rounds ship a false clause.

## Review plan

Reviewer verifies the sweep deleted nothing on the keep-list — especially rejected-alternative rationale, whose loss invites re-litigation and is invisible until someone re-raises the point — and that no deletion removed a discriminator a consumer actually acts on. It checks the rendered-prompt diffs rather than the builders, confirms byte-identity and unchanged check counts, and confirms no skill file moved. It treats a comment the sweep *added* as a finding.
