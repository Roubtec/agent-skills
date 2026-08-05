---
name: review-cycle
description: Run the canonical implement/fix → fresh-eyes review → best-effort cross-harness peer review → fix cycle on a committed change, worktree, or drafted document until it converges, disposing every reviewer and peer finding explicitly — fixed, declined with reason, or escalated to an open question — and returning a result whose open questions feed resolve-open-questions directly. Trigger when the user asks to run the review cycle on a change, worktree, task file, or ad-hoc uncommitted edit, or wants a local review pass before opening a PR. Do not trigger to address existing PR review threads (use address-review) or to run a task batch (use address-tasks); those skills consume this protocol by reference.
---

Run one complete review cycle — fix → own fresh-eyes review → best-effort peer review → fix — on a single artifact.

**Arguments:** `[<target: worktree, branch, diff range, task/doc file, or nothing for the current change>] [artifact-type: code | prose | decision] [light] [peer-opinions=off] [max-rounds=N]`

Explicit Codex invocation uses `$review-cycle`; natural-language equivalents are fine.

This skill is two things at once.
It is the **canonical definition** of the review protocol the other dev-skills share — `address-review`, `address-reviews`, `address-tasks`, `address-tasks-serialized`, `resolve-open-questions`, and `write-tasks` reference this file for the roles, gates, peer step, round cap, and disposition rule, and state only their own deltas — and it is a **drop-in**: invoked directly, it runs the full cycle on an ad-hoc change with no batch scaffolding.
Running the cycle locally, before a PR exists, is the cheapest place to catch findings: GitHub review rounds add days of latency and CI spend, so the PR should be the last sanity check, not the first reviewer.

## Roles

Three roles, freshly spawned every round. Fix-ups and re-reviews always use a fresh subagent spawn — fixers as `worker` agents, reviewers as `explorer` agents — never `send_input` to continue a prior worker or reviewer; a reviewer with no attachment to the fix is the whole point.

- **Fixer** (the implementer on round 1). Its prompt carries: the worktree/branch contract first (`cd` there, verify `git rev-parse --show-toplevel` and `git branch --show-current`; stop and report rather than guess), the work item(s) verbatim, every previous-round finding verbatim as separately labeled blocks, an instruction to read the repository's agent-context files (`AGENTS.md`, `CLAUDE.md`, or `.github/CLAUDE.md`) first, commit/validation instructions, and the disposition duty below. It returns a packet: what changed, the disposition of every finding it was handed, and the final SHA, with `git status --porcelain` empty and every intended change committed — an unclean or half-committed tree is resolved or reported, never handed to review. Do not give it your own or the reviewer's reasoning beyond the verbatim findings, and tell it not to write to any shared task or plan tracker (child entries leak into the orchestrator's view).
- **Reviewer** — a fresh-eyes verification of the committed state, spawned only after the fixer's commits have landed. Give it the work item(s) and any proposed dispositions verbatim, the effective review base, and the branch — never the fixer's reasoning or report. It reads whole touched files rather than diffs or commit messages (both anchor it to the fixer's intent); if `git diff --name-only <base>...HEAD` looks empty despite claimed work, it reports a likely race/wrong-worktree flag rather than reviewing nothing. For code it runs the build/typecheck first (a failure is an automatic blocker), then verifies the artifact per its type below, then does a quality pass on the touched files (logic correctness, error handling, edge cases, dead code, consistency, duplication, type safety). It reports **Pass** or a numbered, actionable **Issues** list, edits nothing, and writes to no shared task or plan tracker.
- **Peer** (best-effort, cross-harness) — a read-only `claude` review launched in the background at the same moment as the Reviewer, from the committed checkout. It receives the same evidence as the Reviewer — items and dispositions verbatim, worktree, base, branch — but no reasoning, no fixer report, and no Reviewer execution steps. It reads the actual files, edits nothing, and runs no builds or tests; the Reviewer alone owns execution, which is what makes the concurrent launch safe. Require exactly `VERDICT: PASS | ISSUES`, followed for Issues by numbered findings tagged `blocking` or `minor`, each with `file:line` and a one-line rationale.

One checkout-dependent agent at a time: never spawn the Reviewer until the fixer's commits have landed on disk — a reviewer racing an unfinished fixer diffs a half-written branch, sees nothing, and ships the work unverified. The examination-only peer launched beside the Reviewer after the tree is clean and committed is the sole concurrency exception: two readers are safe.

## The loop and its gates

Each round is: a fixer pass (whenever there is work to implement or findings to dispose) → one fresh Reviewer plus, unless disabled or unavailable, the peer launched at that same moment → the round decision.

- Always wait for the Reviewer; when a peer was launched, wait for it too before deciding the round, otherwise carry the disabled or unavailable outcome forward explicitly.
- A round passes only when the Reviewer passes and any intelligible peer report has no unaddressed grounded findings; **both `blocking` and `minor` peer findings gate.** Disabled, unavailable, timed-out, forfeited, and failed peer outcomes are explicit non-blocking outcomes — the peer is never required for the cycle to conclude.
- **Grounding spot-check:** only when the Reviewer passed and peer findings alone would gate, cheaply spot-check each finding's `file:line` and factual claim; discard self-evidently false or nonexistent references and note the discard. This noted discard is the one path by which a finding leaves the cycle without a fixer disposition.
- **Verbatim relay:** do not summarize, merge, or rewrite feedback. When another fix round is needed, give the fresh fixer the complete available results verbatim as separately labeled `Reviewer findings` and `Peer (claude) findings` blocks so it can reconcile overlap or conflict. A pushed-back peer claim is adjudicated by the next fresh Reviewer.
- **Round cap:** allow at most **12 reviewer rounds total**, including the initial review; every fix-up round counts regardless of which reviewer triggered it. The cap is a runaway-loop guard against arcane token bloat, not a quality dial. If issues persist after round 12, stop iterating, do not deliver or publish, and surface every outstanding finding set verbatim. An invoker may lower the cap for a bounded context, never raise it.

## Disposing findings — how the cycle ends

Every reviewer and peer finding is dispatched to a fixer that explicitly disposes each item: **fixed**, **declined** (with a reason — a decline is verified by the next fresh Reviewer, never final on the fixer's say-so), or **escalated** to an open question (format below).
The cycle ends only when the Reviewer passes **and** the fixer's last pass disposed nothing new: after a passing round, hand the passing reports to one final fixer pass so any pass-notes or stray remarks get considered by an agent with full context rather than dropped by the orchestrator; if that pass disposes nothing new, the cycle is done, and anything it fixes or disputes goes through another reviewer round first.
This costs one extra fixer turn per cycle — the accepted price for "no finding dropped unconsidered" on meaningful changes.
**`light` mode**, at the invoker's explicit choice for small mechanical changes, skips that final no-op fixer pass and ends the cycle at the passing round, recording any undisposed remarks as such.

When a fixer delivers something other than a decision the maintainer locked, it reports what it delivered instead and the constraint that forced it; the cycle records the deviation prominently in its result and leaves ratify-or-conform to the human — report, don't correct.

## The peer step

**Preflight once per run**, unless `peer-opinions=off`. Classify the probe explicitly:

- If `command -v claude` fails, mark the peer unavailable.
- If `claude auth status` succeeds, mark the peer available.
- If `claude auth status` fails while `ANTHROPIC_API_KEY` is set, defer classification to the first real invocation because the environment key may authenticate it without a saved login.
- If the failure says this older CLI does not support the `auth status` subcommand, likewise defer classification to the first real invocation because no probe is available.
- For any other `claude auth status` failure, mark the peer unavailable and retain the failure reason.

In either deferred-classification path, an auth/usage failure at the first real invocation marks the peer unavailable for the rest of the run. Unavailability never blocks; record its reason for one final-summary note. A batch orchestrator preflights once for the whole batch and never repeats the probe inside entries.

**Review strength is pinned per invocation.** This codex-led side reviews with `claude` and pins both dimensions, `--model opus --effort high`, because that side has a stable capability alias to pin and a container may most recently have selected an economy tier. The Claude-led mirror of this skill reviews with codex and always passes `-c model_reasoning_effort=high`, leaving the model to the peer's configured high-capability default (`~/.codex/config.toml` — that configuration is what "configured high-capability model" means wherever these skills say it). Each form pins everything its CLI gives a stable handle on, so no pinned dimension follows whichever value a container most recently selected; the pin is per-invocation and never writes back to the saved configuration.

**Launch.** Before launching the peer CLI process, create a unique directory outside the worktree for this invocation and attempt; never reuse or share that directory. Write the prompt verbatim to a file there without evaluating it, and write `git -C <worktree> log --oneline <base>..HEAD` plus `git -C <worktree> diff <base>...HEAD` from this exact worktree to a read-only diff artifact in that same directory. Include the artifact path in the prompt and grant only this invocation directory with `--add-dir`; without that grant an out-of-cwd Read can be auto-denied, while granting a shared parent directory would let concurrent peers cross-read another invocation. Managed hooks and organization settings policy can still apply under `--safe-mode`, so an operator in a managed environment must disable peer opinions or first ensure those hooks cannot mutate the worktree before launching a peer concurrently with the Reviewer. The canonical launch below pins `--model opus --effort high`. Keep both flags exactly as written on every invocation, and never swap in another alias or drop one because the current configuration looks adequate: without them the peer silently inherits whichever model and effort a container most recently selected — including an economy tier that has no business deciding review strength. Never put bracketed optional tokens in the command. Shell-quote every generated path when replacing the placeholders, keep `--safe-mode` and both read-only tool guard flags, and never pass permission-bypass flags.

Launch the peer in a dedicated session and process group; do not use a plain background subshell, because killing that subshell can orphan `claude` or its descendants. Require `setsid` for this path (otherwise disable/forfeit the peer), assign the worktree, invocation directory, prompt, JSON `outfile`, and diagnostic `errfile` paths to shell variables, require both output paths to be inside the invocation directory, and use this launch shape; `--fork --wait` keeps a waitable supervisor alive, while the inner shell records the distinct session/process-group leader before it becomes `claude`:

```sh
peer_session_file="$invocation_dir/session.pid"
if (umask 077 && : > "$peer_session_file"); then
  setsid --fork --wait sh -c '
    session_file=$1
    worktree=$2
    shift 2
    printf "%s\n" "$$" > "$session_file" || exit 125
    cd "$worktree" || exit 125
    exec "$@"
  ' peer-launch "$peer_session_file" "$worktree" \
    claude -p --model opus --effort high --safe-mode --tools "Read,Glob,Grep" --disallowedTools "mcp__*" \
    --add-dir "$invocation_dir" --output-format json \
    < "$prompt_file" > "$outfile" 2> "$errfile" &
  peer_wait_pid=$!
else
  peer_wait_pid=
  peer_launch_status=125
fi
```

Create `peer_session_file` as an empty, owner-only regular file before the launch and do not launch if that preparation fails. Poll for it to become non-empty, require its contents to be a positive decimal PID, and save that value as `peer_pgid`; do not infer it from `peer_wait_pid`, because `setsid --fork` deliberately makes the wait supervisor and session leader different processes. The PID-file write is the first operation in the session and is checked, so `claude` cannot start unless the handoff succeeds. If the supervisor exits before a valid handoff, immediately `wait "$peer_wait_pid"` to reap it, record the launch failure (normally status 125 for the write or `cd` guard), and never advance or retry from that attempt. Use a loose roughly 12-minute timeout, extending it when review size warrants.

After `peer_pgid` passes the numeric/positive check, use the following helpers. The negative PID operand targets the validated process group; omitting `--` is intentional because the Dash `kill` builtin rejects it. Keep this form for TERM, KILL, and every death probe:

```sh
peer_group_alive() {
  kill -0 "-$peer_pgid" 2>/dev/null
}

peer_stop_group() {
  kill -TERM "-$peer_pgid" 2>/dev/null || :
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    peer_group_alive || break
    sleep 1
  done
  if peer_group_alive; then
    kill -KILL "-$peer_pgid" 2>/dev/null || :
  fi
  wait "$peer_wait_pid" 2>/dev/null || :
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    peer_group_alive || break
    sleep 1
  done
  ! peer_group_alive
}

peer_finish_group() {
  if wait "$peer_wait_pid"; then
    peer_wait_status=0
  else
    peer_wait_status=$?
  fi
  if peer_group_alive; then
    peer_stop_group || return 1
  fi
  ! peer_group_alive
}
```

On timeout, call `peer_stop_group`; on observed supervisor completion, call `peer_finish_group` and interpret its saved `peer_wait_status` only after it succeeds. The final command on either path must succeed. `peer_stop_group` always performs TERM → bounded wait → KILL when needed → supervisor `wait` → bounded death check, and failure means a group member survived: do not retry or advance until it is gone. Apply this verification on every completion path, not only timeouts. Keep `outfile` reserved for parseable JSON and use `errfile` only for diagnostics and the retained failure reason. Retry a timeout or transient failure once with an entirely new invocation directory, prompt, outfile, errfile, artifact, session file, and process group, then forfeit that round. `claude -p` may print nothing until completion; parse the captured JSON only far enough to extract the peer's final message, then read only the verdict line for orchestration.

**Outcome vocabulary.** Whatever launches the peer, its result lands in one vocabulary: `passed` and `issues` feed the gate; `unavailable` (missing binary, logged out, auth/usage exhaustion), `timeout` (after the one retry), `forfeited` (empty or unintelligible output), and `failed` (provider crash or exhausted retry) are explicit non-blocking round outcomes. Anything that is not `passed` or `issues` is non-blocking — normalize an unrecognized outcome the same way rather than letting it fall through.

**Destination interface — `peer-review-run`, not yet.** powbox bakes a provider-neutral runner, `peer-review-run`, that owns literal prompt-file handling, read-only execution, timeout, retry, and reaping, and reports the outcome vocabulary above as machine-readable JSON (schema `powbox.peer-review-run/v1`: the final stdout line is one JSON object; `outcome ∈ passed | issues | unavailable | timeout | forfeited | failed`; exit 0 for any produced outcome). It is this step's baseline interface **once it can carry the strength pin**: as baked today it accepts no model or effort argument — its claude adapter inherits the container's saved `~/.claude/settings.json` verbatim, so a peer launched through it silently follows whichever model and effort the container most recently selected, and its codex adapter passes `--ignore-user-config` wherever the installed CLI supports the flag, running that side's peer at `reasoning effort: none` on a bare default model — a silent strength regression either way. Until powbox delivers a passthrough that both carries the pin (model as well as effort for the codex provider) and reports the strength it applied, the pinned raw launch above **is** this step's interface; the swap to the helper is task 015's, in the repos that track these skills' tasks.

## Escalation: open questions

An `escalated` disposition raises an open question for the human — typically consumed by `resolve-open-questions`, whose four-part brief (grounded context, concrete trigger, distinct options, recommendation) the fields below map onto one-to-one, so a completed cycle's questions are consumable without re-derivation (that skill's grounding step still re-verifies every carried claim against current state before serving).

Record each question with: a stable `id` within the run (e.g. `<cycle-slug>-q1`; referenced by the disposition that raised it and by `coupledWith`); the `question` phrased as the decision fork, not a narrative; its `origin` (reviewer | peer | implementer | rebase) and the round it arose in; whether it was `blocking` (the cycle could not pass without the answer) or a parked nit; `artifacts` — authoritative pointers only (`file:line`, ref, PR/thread URL, task file), never a paraphrase; the concrete `trigger` that manifests the problem; its `reachability` (live | dormant | impossible-until | unknown, plus the condition when dormant or prerequisite-bound) — a carried claim, re-derived before anyone acts on it; drafted `options` with the blast radius of each (may be empty); a `recommendation` with a one-line why (empty when the call turns on maintainer intent); and `coupledWith` — ids of sibling questions sharing the one underlying decision.

**Retiring a superseded question.** A later pass often settles the issue behind a question an earlier pass raised — the next reviewer rejects the escalation as an evasion, and the pass after it simply fixes the thing — and the cycle should then stop asking the maintainer to decide it. When a `fixed` or `declined` disposition settles a still-live open question, it names that question's `id` among the questions it retires, and the cycle **marks** the question retired (recording the pass and disposition that settled it) rather than dropping it: the result still shows the question was raised and what closed it, so a consumer skips it knowingly and a *wrong* retirement stays visible beside the disposition that made it instead of only in the artifact directory. Like a decline, a retirement is not final on the fixer's say-so: the next fresh Reviewer is handed the question that was retired and what the fixer claims settled it, and overrules an unearned retirement — this is the one disposition that takes a decision off the maintainer's list rather than adding to it. So the mark lands **pending** and becomes the settled one a consumer skips only once a round PASSES with it in view: a claim no round accepted — the Reviewer rejected it, or no round ever judged it because the cycle errored or hit its round cap — leaves the question live for the maintainer, which is the whole point of marking rather than dropping. A run that ends badly is exactly the run that must not quietly shorten the human's list. An unaccepted claim is re-presented to the next round rather than expiring: a round can fail on something else entirely, and a fixer whose finding is no longer carried has no disposition left to restate the claim on. Only `fixed` and `declined` retire — an `escalated` disposition raises a question rather than settling one; only a question an EARLIER pass raised can be retired, since a pass that both raises and settles one is contradicting itself rather than superseding anything; a retirement naming an id the cycle does not carry live from an earlier pass — an empty id included, which names nothing — is reported like any other disposition error rather than silently doing nothing; and a question a retirement settles can never validate an escalation that names it, whether that retirement came from an earlier pass or the same one. Show each fixer pass the questions still live, or it has no ids to name.

Open questions always surface structurally in the cycle's result — they exist for the human — while the bulk prose stays on disk behind the artifact pointer; a retired one rides along marked, and a consumer serving questions to the maintainer passes over it — a retirement still pending a round's verdict does not carry that mark, and is served as the live decision it still is.

## Artifact types

The cycle reviews more than code; the invoker names the type and the Reviewer and peer briefs adapt:

- **code** (default) — a committed diff. Build/typecheck first, acceptance criteria where a task or spec is in scope, then the quality pass.
- **prose** — a drafted task file or document. The Reviewer checks verbiage, scoping, internal consistency, and the repo's house conventions (for task files: the documented numbering style); there is no build to run.
- **decision** — an applied decision's diff. The Reviewer verifies the diff implements exactly the locked option and nothing beyond it, then the quality pass on the touched files.

## Artifacts and hygiene

Every cycle uses its own unique artifact directory outside the worktree — suffix the cycle slug, reduced first to a single path segment, or create it with `mktemp -d` — never a fixed shared filename: parallel cycles share one scratchpad, and fixed names have crossed review streams between concurrent runs before.
A slug is routinely a branch name, and the `/` in one splits the suffix into a parent directory: `mktemp` refuses that outright, and a `mkdir -p` path takes it silently, nesting the round history where nobody will look for it.
The full round history (reviewer reports, peer output, fixer packets) lives there; the cycle's result carries the pointer, not the prose.

## Running it as a drop-in

Invoked directly, resolve the target first: an explicit worktree, branch, diff range, or file set — else the current checkout's uncommitted change or unpushed branch. Round 1's fixer is the implementer: for an uncommitted ad-hoc change it commits the change as given (no rewriting) so review runs against committed state; for a drafted task or doc it is the drafting itself. Then run the loop to its verdict.

Report at the end: the verdict and rounds used (and whether the cap was hit), every finding with its disposition, open questions in the format above, any deviation from a locked decision, peer participation (note an unavailable/disabled/forfeited peer once with its reason, plus any discarded ungrounded findings), and the artifact directory.
