# 066 — One peer launch form in every skill, and a launch that fits the review

## Why this task exists

The cross-harness peer review is the part of the cycle that most often goes wrong mechanically, and task 055 answers most of it by moving the launch into `review-cycle/peer.sh`.
This task closes what that script and the text around it still leave open.

**Prerequisite: the pull request for task 055 has merged.**

- **The skills disagree on how a peer is started.** `review-cycle` says the call runs in the foreground inside its own concurrently started role and is never backgrounded. `address-reviews`, `address-tasks` and `address-tasks-serialized` each still say to launch a "background" peer, and `address-review` binds itself to the peer step by name without saying that step has to be read before the first round. An orchestrator that read only a consumer has improvised a shell-backgrounded launch more than once.
- **The budget ignores the size of the review.** A `codex` or `claude` peer gets two short attempts whatever it is reviewing, so the largest reviews time out twice and lose the peer exactly where a second opinion is worth most. The helper underneath already supports one long attempt.
- **Effort is fixed in the script.** Trying a stronger review on a change that warrants one means editing `peer.sh`.
- **A pass says nothing about its basis.** `VERDICT: PASS` with no account of what was looked at cannot be told from a peer that skimmed.
- **A round with no peer result looks like a round whose peer was unavailable.** Nothing lets the round decision tell "launched, no usable result" from "never launched", so a skipped launch can be written up as an unavailable peer.
- **One instruction was dropped in the move.** The skill used to say the evidence is appended with a quoted heredoc and never assembled through shell interpolation. The script builds the prompt safely, but the text no longer says how the facts file itself is written, and that file carries review-thread text verbatim.

## Scope

Included:

- **One statement of the launch form, in "The peer step"**, including which harness form makes a peer concurrent with the Reviewer; every consuming skill points at it, says it is read before the first peer launch, and describes no launch of its own.
- **`peer.sh run` chooses one long attempt for a large review**, on a size it can measure, with a way for the caller to force either budget.
- **An effort argument on `peer.sh run`**, defaulting to today's medium, with one line in the peer step saying when raising it is warranted.
- **`peer-brief.md` asks a passing peer to say what it checked**, and the script reports whether it did.
- **Something the round decision can read** that tells whether a peer was launched for this round and what came back.
- **The quoting instruction for the facts file**, restored in a sentence.
- Both mirrors, the workflow sections that embed the launch, and the script's suite.

Out of scope:

- Running the peer as a background command of the orchestrator instead of inside a spawned role: task 073 records that idea and why it is deferred.
- `peer-review-run` itself, which powbox ships. A review that needs longer than one tool call allows would need a detached mode there, and is not attempted here.
- The outcome vocabulary, the batch throttle, and how a peer finding gates.
- Choosing the attempt directory, which is task 061.

## Context and references

- `plugins/dev-skills/skills/review-cycle/peer.sh`: its header comment is the contract; `provider_setup` holds each provider's budget and the script's fixed effort.
- `review-cycle/SKILL.md` → "The peer step" and "Roles", and `peer-brief.md` for the answer's shape.
- The consumers: grep both mirrors for `background` beside `peer` in `address-reviews`, `address-tasks` and `address-tasks-serialized`, and read the peer mentions in `address-review`.
- `scripts/test-review-cycle-peer.sh`, and `scripts/test-review-cycle-retirement.mjs`, which pins launch wording and the byte-identity of the embedded cycle section in the two workflows that carry it.
- `scripts/verify-014-peer-strength-pin.md` for why review strength is pinned per invocation.

## Target files or areas

`plugins/dev-skills/skills/review-cycle/` and its Codex mirror, the four consuming skills in both mirrors, `plugins/dev-skills/workflows/wf-review-cycle.js` and `wf-address-tasks.js`, the two suites above, `README.md` where it describes the script.

## Implementation notes

- **Strengthen the single path.** The helper exists so that launching a peer takes no thought and is right every time. Prefer behaviour in `peer.sh` to guidance around it, and prefer deleting a consumer's sentence to rewording it.
- **Do not turn a usable review into a forfeit.** A pass that omits its basis is still a review. Report the omission as a field the orchestrator can weigh and mention, in the way the script already reports its evidence proof; do not downgrade the outcome.
- **The size test must be cheap and explainable.** Bytes of the assembled prompt, or of the embedded diff, are measurable before launch; pick one, state the threshold and how it was chosen in the header, and print which budget was applied so a timeout can be read against it. The whole call still has to fit the caller's tool wait.
- **Effort stays pinned per invocation.** The argument changes what one call passes, never the saved configuration, and the script keeps printing the applied effort. Say in the skill who may raise it (the invoker's request, or the orchestrator for a change whose risk it can name) in one line, without a taxonomy.
- **Detecting a missing result needs no new process.** The script already owns the attempt directory; a record of the classified answer written there, and a read of it by round, is enough. Design it together with task 061's `--artifact-root` if that has landed, since both decide what the directory holds.
- The facts file is written with a quoted heredoc or a file-writing tool. Review text can contain `$(…)` and backticks, and a shell that interpolates it runs them.
- `peer-brief.md` is one text for every provider and both mirrors; keep it so, and re-derive the parity allowlist if a difference between the mirrors' skill text moves.
- The embedded cycle section stays byte-identical in both workflows.

## Acceptance criteria

- No skill in either mirror tells an orchestrator to background a peer, and each consumer's peer sentence sends its reader to "The peer step" before the first launch.
- A review above the stated size gets one long attempt, a small one gets today's budget, and the answer says which.
- `peer.sh run` accepts an effort, reports the effort applied, and behaves as today without the argument.
- A passing review that names what it checked, and one that does not, are distinguishable in the script's answer, and both keep the outcome `passed`.
- After a round, one read tells a launched peer with its outcome from a peer that was never launched.
- "The peer step" says how the facts file is written.
- The full test set passes.

## Validation

- Run every suite `tests.yml` runs, `shellcheck` on the script and its suite, and `wf-check` on the workflows.
- Cover the size choice, the effort argument, the basis field and the per-round record with the suite's stub providers; mutation-test each new guard after committing.
- Run one real peer review through the script on a small committed diff and say in the pull request which provider ran and what it returned.

## Review plan

Grep both mirrors for any remaining description of a peer launch outside "The peer step", then read the script for a path where the new fields could change an outcome or block the caller.
