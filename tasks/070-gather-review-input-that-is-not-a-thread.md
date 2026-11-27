# 070 — Gather review input that is not a thread

## Why this task exists

`address-review` gathers a pull request's unresolved threads with a script, and everything else a reviewer left by reading.
`misfired-findings.md` covers a bot that put findings into a top-level review body instead of threads, but finding such a body, and deciding whether it is still current, is left to the orchestrator's judgement over raw API output.
Two kinds of input slip through:

- **Suppressed comments.** Copilot's review can carry, inside its review body, a collapsed list of comments it chose not to post inline. They are findings with a file and a line, and they never become threads, so a thread-based gather returns nothing for them; such lists have held findings that were real and still applied. The current freshness rule also drops a body written against a superseded head unread, although the code a finding in it points at may not have changed since, and that too has left live findings behind.
- **A body that claims findings and posted none.** A bot's review states that it found a number of issues, and the bot authored no thread and no finding text. There is nothing to address, but a run that ends as a clean no-op tells the maintainer the review was dealt with, when in fact its findings never arrived.

Recognising a non-thread input is a mechanical question about the review objects, and belongs in the gather's script. What to do about one stays a judgement.

## Scope

Included:

- **A scripted listing of a pull request's submitted reviews** for the gather: for each, who wrote it and whether that is a bot, its state, the commit it was written against, its permalink, how many inline comments it authored, and the entries of any suppressed-comment block in its body with their file and line.
- **A freshness answer the gather can use**: for a review written against a head that is no longer current, whether each file a suppressed entry points at changed between that commit and the current head.
- **`misfired-findings.md` updated to read that listing**, and to stop discarding a superseded-head finding without looking: one whose cited code is unchanged is still a candidate, subject to that file's other tests.
- **A named outcome for a bot review that claims findings while having authored none**: it is reported in the Summary comment and the final report as review input that never arrived, and it keeps the run from ending as a silent no-op.
- The workflow's gather in `wf-address-review.js`, both mirrors, and tests.

Out of scope:

- How a finding taken from a review body is identified, disposed and recorded: `misfired-findings.md` and the disposition record keep their rules.
- Parsing free prose for findings. The script extracts the one structured block it can recognise and otherwise reports counts; reading a body remains the orchestrator's.
- Threads that arrive after a ping, and re-requesting a review automatically.
- `gh-review-threads.sh`'s output, which powbox consumes under a contract of its own.

## Context and references

- `plugins/dev-skills/skills/address-review/misfired-findings.md`, in full: the fresh-and-applicable tests, why `commit_id` is read from the REST review object, and the "take none where freshness is only ambiguous" rule.
- `address-review/SKILL.md` → "Step 3 — Gather the review feedback", including the terminal no-op it ends with, and "Step 8 — Final report" for where blocked input is listed.
- `address-review/gh-review-threads.sh`: its header explains why it never uses `--paginate` and asserts that every item it returns belongs to the requested pull request. A sibling that lists reviews owes the same assertion.
- `plugins/dev-skills/workflows/wf-address-review.js`: the gather stage and the item schema's `standalone` type with its `finding` ordinal.
- `scripts/test-gh-review-threads.sh` shows how a `gh` stub drives such a suite; `scripts/test-address-review-reconcile.mjs` pins the workflow's gather.

## Target files or areas

`plugins/dev-skills/skills/address-review/` and its Codex mirror, `plugins/dev-skills/bin/` for a shim, `plugins/dev-skills/workflows/wf-address-review.js`, `scripts/` for a suite, `.github/workflows/tests.yml`, `README.md`.

## Implementation notes

- **A new script, not a change to `gh-review-threads.sh`.** That file's JSON output is a contract with a consumer outside this repository. A sibling in the `address-review` folder with a `bin/` shim for the workflow keeps it untouched.
- **Establish the block's real shape from live reviews before parsing it**, and record in the header which reviewer and which shape the parser was written against. A reviewer that changes its markup must degrade to "a block is present, entries unparsed" with the review's permalink, never to "no block".
- **Scope every answer to the pull request.** Assert each returned review's own URL names the requested repository and number, and fail closed on a mismatch, as the thread fetcher does.
- "Claims findings" cannot be decided by a script. The script reports, per bot review, the body's presence and the number of inline comments that review authored; `misfired-findings.md` says what a body that advertises findings beside a zero count means. Note that this repository's own review format asks a reviewer for a count of findings in its summary and the findings in threads, so a reviewer that posts the summary and fails on the threads produces exactly this body.
- **Relaxing the superseded-head rule must not reopen finished rounds.** The existing guards do that work and stay: no thread on the pull request already raises the finding, no maintainer reply dismisses it, the review is not dismissed, and a prior disposition record that holds it wins. Only the automatic discard on `commit_id` goes, replaced by the unchanged-file test.
- The file-changed test is a local `git diff` between two commits the run already has or can fetch; where the review's commit is unreachable, say so and treat the entry as ambiguous under the existing rule.
- Follow the helper contract of the existing scripts: bash 3.2, `outcome=` first, exits 0/3/1/64, the header comment as the contract, byte-identical in both mirrors.
- The pull request for task 053 rewrites step 7 and its Summary comment; rebase over it if it has not merged.

## Acceptance criteria

- For a pull request with a review that carries a suppressed-comment block, the listing gives each entry with its file and line, on the skill and the workflow surface.
- A suppressed entry written against an earlier head, in a file unchanged since, reaches the item list as a standalone item; one whose file changed does not, and the report says it was left out and why.
- A bot review with a body and no inline comments is named in the Summary comment and the final report, and such a run does not end as the terminal no-op without mentioning it.
- A review belonging to another pull request in the script's input makes it fail closed.
- No finding an earlier round already disposed is taken again.
- The full test set passes.

## Validation

- Run every suite `tests.yml` runs, plus `shellcheck`.
- Drive the script with stubbed API responses for each case above, including a malformed block and a foreign review; mutation-test each guard after committing.
- Run it read-only against one real pull request that has a bot review and quote the listing in the pull request.

## Review plan

Check each relaxed or added rule against "could this make a run re-address a round that is done", then read the parser for what it does with a block it does not recognise.
