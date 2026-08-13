# Preserve structured pointer boundaries in the address-tasks batch argument

## Why this task exists

Task 039 made task numbers first-class in `wf-address-tasks.js` by routing the batch argument through a resolver and then reconciling the resolver's packet against the argument itself, so a packet that silently drops or invents a pointer is rejected rather than run as a smaller batch. That reconciliation is worth keeping. What it also did, as a side effect nobody scoped, is narrow what a *path or glob* argument is allowed to contain.

Both of 039's own boundaries forbade that. Its out-of-scope note reads "changing the consumers' existing path/glob handling (raw paths keep working; the resolver is additive)", and its acceptance criteria require that "existing path/glob invocations are unchanged in what they execute, gaining only the `not-found` surfacing for an input that matched nothing". A caller that hands the workflow a structured list whose element contains a space or a comma no longer executes that task, so 039 was archived with that criterion unmet.

The workflow contradicts itself on the point. The comment above `shq` in `wf-address-tasks.js` states the reason it single-quotes rather than `JSON.stringify`-quotes: "a git ref name forbids spaces but little else; a path forbids neither". The same file's argument handling then assumes a path contains neither.

## Scope

**In scope.** Make the batch argument preserve the pointer boundaries the caller actually supplied, wherever the caller supplied any — that is, whenever `args` arrives as an array or an object rather than as one flat string. The reconciliation, the hands-off consumer policy, and every diagnostic 039 introduced stay exactly as they are; only the derivation of the pointer list changes.

**Out of scope.**

Making a *single flat string* argument carry a pointer with a space or comma. A bare string genuinely has no boundary information — `tasks/my task.md` and two pointers `tasks/my` and `task.md` are indistinguishable inside it — so the whitespace-and-comma split remains the correct reading there, and inventing a quoting mini-language for it would be a larger design decision than this task should make.

Be honest about what that leaves: this is a **partial** restoration of 039's criterion, not a complete one. A caller who names a spaced path in a flat string is still not served, and one nuance makes that sharper than it first looks. `requiredArgPointers` does strip surrounding quotes, so `"tasks/my task.md"` looks like it ought to work — but the stripping happens *after* the split, so that argument still becomes `tasks/my` and `task.md` with the quotes merely removed from the fragments. Quotes therefore do not express boundaries today, and this task does not make them do so. If a quote-aware flat-string parse is wanted, raise it as its own task rather than smuggling it in here; the decision it needs (which quoting dialect, and what an unbalanced quote means) is exactly the design call this scope is avoiding.

The `resolve-tasks` skill and its mirrors, which are read-only and take no position on how a consumer tokenizes its own argument. The task-number collision guard, which task 027 owns.

## Context and references

The regression is a single change of what `resolvePrompt` is handed, and git history shows both sides of it plainly.

Before 039, the resolve stage called `resolvePrompt(args)` with the structured value, and `resolvePrompt` rendered it with `JSON.stringify(input)`. An array element containing a space therefore reached the resolver as one JSON string, boundaries intact.

After 039, the stage calls `resolvePrompt(flattenBatchArgs(args))`. `flattenBatchArgs` joins array elements and object values with a space, and `requiredArgPointers` then re-splits the result on `/[\s,]+/`. The join is lossy and the split cannot undo it, so the boundaries the caller expressed are gone before either the prompt or the reconciliation sees them.

The failure mode is quiet, which is what makes it worth fixing rather than documenting. `resolvePrompt` instructs the resolver that "a raw pointer can therefore carry neither whitespace nor a comma (so a task-file path containing either cannot be named on this argument at all — report such a token as the tokens it splits into, do not reassemble it)". The fragments duly resolve to nothing, become `not-found` diagnostics, and are excluded under the hands-off policy. `resolutionAccountsForInputs` is then satisfied — every fragment *is* accounted for — and `emptyPlanIsExplained` accepts the empty wave set as a documented no-op. The batch reports success having implemented nothing. It does not abort, and nothing in the summary says a task the caller named was lost.

The concern was raised by a Codex review on PR #91 (the task-archival sweep that moved 039 into `tasks/done/`), and its thread is that PR's top-level Codex review. Task 039's own spec is `tasks/done/039-resolve-tasks-shared-pointer-resolver.md`.

Worth knowing for whoever picks this up: the reason 039's own review rounds did not surface this is that the flattened-string contract is pinned densely and self-consistently in `scripts/test-resolve-tasks-contract.mjs` — dedup, first-seen order, comma splitting, every peer-flag spelling, a filename embedding the flag text, the empty and null argument. Every one of those cases hands `requiredArgPointers` a string or `null`. Not one hands it an array or an object, so the path that regressed was never exercised, and the suite agreed with itself all the way through.

## Target files or areas

`plugins/dev-skills/workflows/wf-address-tasks.js` — the functions `flattenBatchArgs`, `requiredArgPointers`, `resolvePrompt`, and the resolve stage that calls them. There is no `codex/` mirror of the workflows directory, so this is a single-copy change.

`scripts/test-resolve-tasks-contract.mjs` — the argument-pointer checks and the assertion that pins the prompt's current no-reassemble sentence.

## Implementation notes

Derive the pointer list from the structured value where one exists, and fall back to the existing split only for a flat string. State the leaf contract once, unambiguously, and implement exactly it — the distinction that matters is *where a string sits*, not that it is a string, since every leaf of a structured argument is normally a string too:

- `args` is a **string** → today's behavior exactly: split on whitespace and commas, strip surrounding quotes from each token, mask the peer flag, dedupe in first-seen order.
- `args` is an **array or object** → recurse through nested arrays and objects, and treat every non-collection **leaf** as exactly one raw pointer. A leaf is never split, whatever it contains — the caller's structure already said where this pointer ends. Stringify a non-string primitive leaf; drop a leaf that is empty or whitespace-only; dedupe across the whole argument in first-seen order as today.

The second bullet is the whole fix, so do not reintroduce splitting inside it "for consistency" with the first: a leaf that splits is the bug this task exists to remove.

Whichever way you implement that contract, `resolvePrompt` and the reconciliation must derive their pointer list the same way. Today the prompt tells the resolver how to tokenize and the workflow re-derives the same tokens independently; if the workflow now knows boundaries the prompt's instructions cannot reconstruct, the prompt has to be handed the already-bounded list instead of instructions for producing one. Two derivations that can disagree is precisely the failure this reconciliation exists to catch, so do not leave one side splitting while the other does not.

Preserve every behavior the existing checks pin on the flat-string path: `PEER_OPINIONS_FLAG` masking across all the spellings the suite enumerates, a filename that merely embeds the flag text surviving intact, a non-flag token that merely carries `=`, first-seen ordering, deduplication, and the empty/null argument.

One of those is weaker than it looks, and the difference matters if you refactor the tokenizer. Surrounding-quote stripping is pinned only as *prompt text* — the assertion that the workflow tells the resolver each token "has its surrounding quotes stripped" — and by no executable check on `requiredArgPointers` itself. So a refactor can silently drop it and the suite will still pass. If quote stripping is to remain contractual on the flat-string path, add the executable check it never had; if it is not, remove the claim from the prompt rather than leaving the two out of step.

Note that a pointer arriving with its boundary intact may contain characters the prompt is currently free to assume away. Render it into the prompt unambiguously — the pre-039 `JSON.stringify` treatment is the existing precedent in this file and is sufficient — so a pointer containing a quote, a newline, or a brace cannot break the surrounding prompt text or be re-read as two pointers by the resolver.

The peer flag deserves one explicit decision, because today it is masked out of the flattened string before splitting: a flag standing as its own leaf should still be masked, while a flag embedded in a leaf alongside a pointer should not be — that leaf's boundary says it is one pointer, and the flat-string path already refuses to fragment a filename embedding the flag text. Pin both directions.

## Acceptance criteria

- A structured `args` whose element contains a space or a comma resolves that element as exactly one raw pointer, and a batch naming an existing task file that way executes that task rather than reporting fragments as `not-found`.
- A flat-string `args` tokenizes exactly as it does today: every existing check in `scripts/test-resolve-tasks-contract.mjs` covering `requiredArgPointers` continues to pass unmodified — comma splitting, dedup with first-seen order, every peer-flag spelling, the `=`-carrying non-flag token, the filename that embeds the flag text, and the empty/null argument.
- Surrounding-quote stripping on the flat-string path is settled rather than left implicit: either an executable check now pins it, or the prompt no longer claims it. The two must agree.
- The task's partial-restoration boundary is stated where a reader will meet it: a spaced pointer inside a flat string is still unsupported, and quotes still do not make it work, because stripping happens after the split.
- `resolvePrompt` and the reconciliation agree on the pointer list by construction rather than by two independent derivations that happen to match, and the prompt renders each pointer unambiguously enough that a pointer containing quotes or a newline cannot be re-read as two.
- The reconciliation's guarantee is unchanged: a packet that drops a pointer the argument named, or invents one it did not, is still rejected.
- A pointer that is genuinely unresolvable still produces its `not-found` diagnostic and its hands-off exclusion, and an empty wave set backed by exact exclusions is still a successful documented no-op. Only the boundary derivation changes.
- The test suite pins the structured-argument path directly — at minimum a spaced element, a comma-bearing element, a nested array or object, a non-string primitive leaf, an empty or whitespace-only leaf, a mixed structured argument containing both numbers and a spaced path, and a peer flag as its own element.
- The peer-flag decision is pinned in **both** directions: a flag as its own leaf is masked, and a leaf that merely embeds the flag text alongside a pointer stays one intact pointer. The negative case is the one a refactor breaks silently, so it must be asserted rather than assumed from the flat-string equivalent.
- The assertion pinning the prompt's "a raw pointer can therefore carry neither whitespace nor a comma" sentence is revised deliberately rather than deleted, so the suite states the new contract — including that the flat-string reading of that sentence still holds — instead of falling silent on it.
- The `shq` comment's claim that "a path forbids neither" is no longer contradicted by the argument handling in the same file, for a caller that expressed boundaries.

## Validation

Run the repository's full CI set, which is the job list in `.github/workflows/tests.yml`; `node scripts/test-resolve-tasks-contract.mjs` is the directly relevant one and must cover the new structured cases.

Exercise the regression end to end rather than only at the unit boundary: drive the resolve stage with a structured argument naming a real task file whose path contains a space (stage the file in a scratch copy of the task folder, not in `tasks/`), and confirm the plan contains that task in a wave rather than an explained empty no-op. Confirm the same argument as a flat string still splits, so the out-of-scope decision is visibly a decision and not an accident.

## Review plan

Check first that the reconciliation still rejects a dropped or invented pointer — that guarantee is 039's reason for existing and must not be traded for this fix.

Then confirm the two derivations cannot drift: read `resolvePrompt` and the reconciliation together and satisfy yourself that they consume one pointer list rather than each producing their own.

Confirm the flat-string path is genuinely untouched by diffing the existing `requiredArgPointers` checks and finding them unmodified, and that the prompt-sentence assertion was rewritten to state the new contract rather than dropped to make the suite pass.

Finally, confirm the new tests would actually have caught the original regression — a structured argument with a spaced element must fail against the pre-fix workflow.
