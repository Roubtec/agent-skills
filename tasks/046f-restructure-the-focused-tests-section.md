# 046f — Restructure `README.md`'s `## Focused tests` section

## Why

`README.md`'s `## Focused tests` section is the wordiest thing left in the file. Nine of its paragraphs run past 600 characters and four past 1,800: the `test-review-cycle-retirement.mjs` paragraph is roughly 3,000 characters on one line, and `test-unreviewed-close-carriage.mjs`, `test-subagent-destroy-boundary.mjs`'s second paragraph, and `test-skill-worktree-base-exclude.mjs` are each over 1,800. Together the section's paragraphs are about 14,700 characters.

This is the same complaint the maintainer raised on the PR that produced task 046b, in a review comment on the `## Layout` bullets: *"consider whether these massive lines could do as normal structured prose with headings instead… if the contract is clear, the mechanism need not be documented publicly in a README file, in my opinion… the file is getting too wordy for my liking."* That comment authorized restructuring the rest of the file too. Layout was restructured in that PR and this section was deliberately left, because the two are not the same job and bundling them would have tripled a review already carrying a safety change.

They differ in what the prose is *for*, which is why this task exists separately rather than as a second pass of the same edit. Layout's bulk was **mechanism** — how `dc-enter` decides what to refuse — and the implementation and its hermetic suite are better sources for it, so trimming it removed a drift risk outright. This section's bulk is **contract**: each paragraph states what a suite pins and, by implication, what a change to it must not silently break. Several encode measured decisions and their rationale (which exclusions are deliberate, what a check deliberately does not catch, what was reported as a pass before it was checked). Deleting that is not the same trade, and a restructure that treats it as if it were will lose the reason a check exists while keeping the sentence that says it exists.

Note also that these paragraphs are already the *pointer* layer: several end by saying the rationale lives in the suite's own comments. That is the pattern to extend, not to invent.

## What to do

- Give the section per-suite `###` subsections rather than one flat run of paragraphs, so a reader looking for one suite is not scanning a wall. Keep AGENTS.md's one-line-per-paragraph rule — the goal is fewer and shorter paragraphs, never wrapped long lines.
- Lead each subsection with the *trigger*: the command, and the one-sentence statement of what change obliges you to run it. That is the part a contributor actually needs, and today it is often buried mid-paragraph behind a clause about what the suite pins.
- Move the accumulated detail — the enumerated properties, the measured trade-offs, the named accepted misses — **into the suites' own header comments** where it is not already there, and have the README point at them. Several suites already carry exactly this and say so; `test-address-review-reconcile.mjs`'s paragraph already ends by stating that its rationale lives in its own comments beside the reads it governs. Make that the rule for the section rather than the exception.
- Do not delete a measured fact without relocating it. Anything recording that something was *measured* — a percentage, a "reported as a pass until it was checked", a deliberately accepted miss, an exclusion asserted in the direction a later round would move it — is load-bearing precisely because a later round will otherwise re-derive it or quietly reverse it. Relocation is fine; loss is not.
- Check whether the fenced directory tree at the top of `## Layout` should shrink in the same pass. Several of its `scripts/` comments are themselves multi-hundred-character summaries duplicating this section — `test-address-review-reconcile.mjs`'s tree comment is over 2,000 characters — so the same content is currently carried three times: tree comment, Focused tests paragraph, and suite header.

## Considered and declined

**Fold this into the 046b PR.** Declined there and recorded here. That PR carried a safety change to the disposable-clone destroy boundary across nineteen sites plus its guard suite, and the Layout restructure already made the README diff large. Adding a rewrite of fourteen-odd test-contract paragraphs would have buried the safety change in a documentation diff several times its size, and the two need different review attention — one is judged against the helper's behavior, the other against what each suite actually pins.

**Trim the section to one line per suite and let the suites carry everything.** Tempting and probably too far in one step, so it is offered as the end state rather than the instruction. Some of this text is genuinely reader-facing (which suite to run after touching what) and some is genuinely suite-facing (why a check is shaped as it is). Do the split deliberately, suite by suite, rather than by a global length target.

## Acceptance criteria

- Every suite named in `.github/workflows/tests.yml` still has an entry in `## Focused tests` that names its command and states what change obliges a contributor to run it, findable without reading past the first paragraph of its subsection.
- No measured fact is lost: every percentage, accepted miss, deliberate exclusion, and "was reported as a pass before it was checked" note either survives in the README or is present in the relevant suite's own comments, and the README points there. Demonstrate this with a diff review naming where each relocated fact went, rather than asserting it.
- The section's total prose shrinks materially, and no paragraph in it exceeds roughly 1,200 characters.
- AGENTS.md's one-line-per-paragraph rule holds throughout; no paragraph was pre-wrapped to meet the length criterion.
- `README.md` still names no line numbers and makes no prediction about another repository.
- Every suite named in `.github/workflows/tests.yml` passes. No suite reads `README.md` today, so a failure here means something other than the README moved.
