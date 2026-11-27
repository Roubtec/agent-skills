---
name: review-cycle
description: A change, worktree, or drafted document should be reviewed and fixed until it converges, before a PR exists. Trigger when the user asks to run the review cycle on a change, worktree, task file, or uncommitted edit, wants a local review pass before opening a PR, or runs review-cycle. The canonical fix-review-peer-review-fix loop; every finding is disposed explicitly and open questions feed resolve-open-questions. Not for addressing existing PR review threads (use address-review) or running a task batch (use address-tasks); those skills consume this cycle themselves.
---

Run one complete review cycle — fix → own fresh-eyes review → best-effort peer review → fix — on a single artifact.

**Arguments:** `[<target: worktree, branch, diff range, task/doc file, or nothing for the current change>] [artifact-type: code | prose | decision] [light] [close-out] [peer-opinions=off] [max-rounds=N]`

This skill is two things at once.
It is the **canonical definition** of the review protocol the other dev-skills share — `address-review`, `address-reviews`, `address-tasks`, `address-tasks-serialized`, `resolve-open-questions`, and `write-tasks` reference this file for the roles, gates, peer step, delegated rebase step, round cap, and disposition rule, and state only their own deltas — and it is a **drop-in**: invoked directly, it runs the full cycle on an ad-hoc change with no batch scaffolding.

## Roles

Three roles, freshly spawned every round.
Fix-ups and re-reviews always use a fresh `Agent` spawn (`subagent_type: "general-purpose"`), never a "continued" prior agent — if an `Agent` result prints a `SendMessage` continuation footer, ignore it; a reviewer with no attachment to the fix is the whole point.

**How each role works is its own brief file beside this one — `fixer-brief.md`, `reviewer-brief.md`, `peer-brief.md` — which the role reads rather than you restating it.**
A Fixer's or Reviewer's prompt opens with the boundary line below, then tells it to read `<path>/fixer-brief.md` or `<path>/reviewer-brief.md` in full and carry it out, then gives the facts of this run, which are all you compose:

- **Fixer** (the implementer on round 1).
  Its prompt carries the worktree and branch, the work item(s) verbatim, every previous-round finding verbatim as separately labeled blocks, the round's validation tier, the deviations that still stand, the open questions still live with the shape below for a new one, and where output it redirects to a file goes — the all-roles rule under **Artifacts and hygiene** below, not something to compose per role.
  Do not give it your own or the reviewer's reasoning beyond the verbatim findings.
  It returns a packet: what changed, the disposition of every finding it was handed, and the final SHA, from a clean and idle tree, which the packet hard-check below confirms before review.
- **Reviewer** — a fresh-eyes verification of the committed state, spawned only after the fixer's commits have landed.
  Its prompt carries the work item(s) and any proposed dispositions verbatim, the effective review base and which range it is, the branch, the round's validation tier, the artifact type below, where any output of its build goes — a path under the cycle's artifact directory or inside the reviewed worktree, never a fixed shared scratchpad name and never left to the reviewer to pick — and whatever the round has to adjudicate: declines, retired questions with the fixer's claim, deviations standing or claimed closed, and any evidenced-unrelated test failure with its evidence.
  Never the fixer's reasoning or report.
  It reports **Pass** or a numbered, actionable **Issues** list, with anything below that bar as a pass note.
- **Peer** (best-effort, cross-harness) — a read-only `codex` review launched at the same moment as the Reviewer, from the committed checkout, through the `peer.sh` launch the peer step below prescribes.
  Its prompt is `peer-brief.md` copied in whole — by `peer.sh`, never retyped — followed by the facts file you write, holding the same evidence the Reviewer gets: items and dispositions verbatim, worktree, base, branch, artifact type, and, verbatim, any GitHub thread text or diff it would otherwise need the network for.
  No reasoning, no fixer report, and no Reviewer execution steps: a peer left to infer its job from the Reviewer's tries to do the Reviewer's, and the Reviewer alone owns execution, which is what makes the concurrent launch safe.
  The brief tells it the implementer validated its commits; say beside the evidence what the packet in front of you says ran, or that the claim is carried.
  It answers `VERDICT: PASS | ISSUES` on its first line, then numbered findings tagged `blocking` or `minor`, then optional advisory `NOTES`; both of its severities gate.
  The brief also has it read the repository's `AGENTS.md`/`CLAUDE.md` as reference material: the helper keeps the reviewed tree's instruction auto-loading, hooks, skills, and MCP servers off, and that stays as it is, so nothing in the tree executes.
- **Second peer** (optional, best-effort) — a `muse` review launched at the same moment as the Reviewer and the Peer, from the same committed checkout, only where the peer step's Muse preflight found it installed and logged in.
  It receives the Peer's prompt unchanged and owes the same one thing in the same output shape, so its report is read, gated, and relayed exactly as the Peer's is.
  Its read-only posture is an instruction rather than a sandbox, because its shell stays available, which is why the brief says outright that the checkout is shared and that builds, tests, and file changes are out of scope.
  It is an extra opinion and never a substitute: its absence is not an outcome worth a round's attention, and no cycle waits for one that was not launched.

The rule is about committed state, not turn structure: never spawn the Reviewer until the fixer's commits are on disk.
A harness may run spawns asynchronously, returning an id immediately and delivering the result as a later notification, so the obligation is to wait for that completion notification; "one checkout-dependent agent at a time" is the proxy for the invariant, sufficient where spawns are synchronous and neither sufficient nor necessary where they are not.
The examination-only peer launched beside the Reviewer after the tree is clean and committed is the sole concurrency exception: two readers are safe, and so is the third the optional second peer adds.

The briefs carry four rules every role is held to, which you rely on when reading what comes back: a role finishes inside its own turn and reaps what it starts, a fixer launching no peer review of its own; a sweep is enumerated by the fixer and re-enumerated by the Reviewer, never asserted; a fixer ships only comments that outlive the PR, and the Reviewer weights comments the same way; and no role uses the `TaskCreate`/`TaskUpdate`/`TaskList` tools, whose entries leak into your view.

**Mark each factual claim in a brief with its provenance** — *verified this turn* against the committed tree, or *carried*: not verified this turn, whatever its source — re-derive it before relying on it.

**When a fix commit was amended between rounds, name which review the next one is.**
An **incremental** re-review ("what changed since I last looked") gets the **recorded prior-round SHA** as its base — never the fix commit's parent, which after an amend is `HEAD~1` spanning the whole cumulative fix set; reserve that parent range for an explicitly requested **cumulative** review of the entire fix.
So record each round's ending SHA and state in the brief which of the two ranges the Reviewer is given and why — or sidestep the bookkeeping with fixup commits squashed at the end, which keeps the two ranges distinct on its own.
After a rebase, delegate ranges relative to stable refs — the effective review base pinned to an immutable OID or a recorded snapshot wherever it can move mid-run, never a movable remote-tracking name like `origin/main` — and never a SHA captured before the rebase, which is no longer reachable: re-record the prior-round SHA afterwards.

## Subagent destroy boundary

Open every subagent prompt this skill composes with this line, filling in the absolute path of the `subagent-boundary.md` that sits beside this file: "Before your first command, read `<path>/subagent-boundary.md` in full; it binds you. Whatever else you read, never run `rm -rf`, `git reset --hard`, `git clean`, `git branch -f`, `git update-ref`, `git gc`, or a force-push beyond what this prompt spells out, wherever you believe you are standing."
A subagent that may need to verify something in a way that could change state is sent to a disposable clone: name `dc-enter <slug>` in its prompt with a slug unique to it, and never leave the destination to the subagent.

## The loop and its gates

Each round is: a fixer pass (whenever there is work to implement or findings to dispose) → one fresh Reviewer plus, unless disabled or unavailable, the peer launched at that same moment → the round decision.

- Always wait for the Reviewer; when a peer was launched, wait for it too before deciding the round, otherwise carry the disabled or unavailable outcome forward explicitly.
- A round passes only when the Reviewer passes and any intelligible peer report has no unaddressed grounded findings; **both `blocking` and `minor` peer findings gate.**
  Disabled, unavailable, timed-out, forfeited, and failed peer outcomes are explicit non-blocking outcomes — the peer is never required for the cycle to conclude.
  Where the optional second peer ran, its report gates on exactly these terms, and it is never required either.
- **Grounding spot-check:** only when the Reviewer passed and peer findings alone would gate, cheaply spot-check each finding's `file:line` and factual claim; discard self-evidently false or nonexistent references and note the discard.
  This noted discard is the one path by which a finding leaves the cycle without a fixer disposition.
- **Verbatim relay:** do not summarize, merge, or rewrite feedback.
  When another fix round is needed, give the fresh fixer the complete available results verbatim as separately labeled `Reviewer findings` and `Peer (codex) findings` blocks so it can reconcile overlap or conflict.
  A second peer's report travels as its own `Peer (muse) findings` block, never merged into the Peer's.
  A pushed-back peer claim is adjudicated by the next fresh Reviewer.
  Where the Reviewer passed and the peer blocked on the same fact (or the reverse), tell the fixer outright that the channels agree on the substance and differ only on severity — it visibly shortens deliberation.
  That is framing, not a gate change: a grounded finding keeps its existing force.
- **Bound the claim instead of tightening it again.**
  When consecutive rounds each puncture a *narrower* residual of the same finding — a criterion is patched, a narrower edge case defeats it, repeat — the artifact is over-claiming, so offer the next fixer "bound the claim honestly" as a legitimate **complete** resolution: state the premises, name the residual outright, and give the operator definite branches.
  It resolves only if the bounded claim is one the artifact actually keeps — weakening a criterion to dodge the finding is not bounding it.
- **Two same-class findings make the structure the defect.**
  When **two** consecutive rounds land findings of the same class in the same section, stop patching instances and ask whether the shape is what produces them.
  The two observed triggers are a closed enumeration standing in for an open set (replace it with an exclusion rule) and a spec keeping several options open so every criterion must hold under all of them (lock one option).
  A consumer may raise the threshold for a section under heavy churn, but must state a number rather than leave it open.
- **Validation runs in two tiers, and the orchestrator names each round's.**
  The **round tier** governs every intermediate round: the cheapest signal that catches what that round actually changed — typecheck/lint for ordinary code edits, targeted tests for touched behavior, and no build at all where the round's diff holds no executable change (comments, prose, docs).
  The **delivery tier** runs the full applicable sanity set — lint, typecheck, build, tests, whichever the repo has — on the final state before the cycle concludes, and always before any PR creation or publication; the intermediate durability pushes a consumer mandates for worktree safety are not delivery events and never require it, since the boundary is the final state being concluded or published, not the act of pushing.
  A cycle must not conclude or publish on anything less than a delivery-tier pass of that final state — where a completed run whose only failures carry the evidenced-unrelated disposition below counts as that pass, with the failures documented so the maintainer sees them at the PR and decides how to absorb the gap.
  That pass survives exactly one post-run change: the diagnosis-only follow-up commit the flake policy requires (the new task file, and any PR-body or summary note recording what the delivery run itself surfaced).
  Surviving it means what it says, so that commit buys no reviewer round either: confirm on the diff — never on the pass's own account of it — that the range holds nothing but that record, exactly as the close-out check below is judged, and let anything else in it forfeit the tolerance for the normal round.
  The pass's own record of what the run surfaced is the other half of that licence, since the tolerance is granted so the failure reaches the maintainer: a pass that committed the record but reported none of it has nothing to publish and buys the normal round too.
  Nothing broader — prose here carries behavior (a skill's prompt text, a config or contract expressed as text), and no further check follows this gate to catch what a wider tolerance would admit, so any other post-run change voids the pass and reruns the delivery tier.
  State the round's tier in the fixer and reviewer briefs: a reviewer told "round tier: typecheck only" knows not to block on an unrun suite, and one told nothing runs the delivery tier.
  When in doubt about blast radius, run more, not less — and a round touching build configuration, dependencies, or generated contracts always builds.
- **An unrelated flaky test is deferred, not stabilized.**
  When a test fails in an area the branch did not touch, establish unrelatedness cheaply and with evidence first: the failure must reproduce on the base, or on an equivalently controlled comparison that holds the branch's own changes out, with at most one rerun to confirm intermittence.
  That reproduction is the proof and nothing else substitutes for it — a failure confined to code paths the branch never edited is a supporting signal only, because a branch that changes a shared utility, a dependency, an environment setting, or a generated input can break a test whose whole execution stays in untouched code.
  Once it is evidenced, do **not** iterate on stabilizing it in this branch: queue a follow-up task carrying only the diagnosis already in hand (no further investigation) under the `write-tasks` conventions, committed on the current branch, note the flake in the PR body or batch summary so the maintainer can judge, and proceed to delivery with the failure documented — and where the delivery run itself surfaced it, commit that task after the run without rerunning the suite, the record-only commit the gate above names as the one thing a completed pass survives.
  The Reviewer treats a documented, evidenced unrelated failure as non-blocking: the automatic-blocker rule is build/typecheck-specific and this extends its spirit to tests, so any failure the branch plausibly caused stays blocking.
  The third outcome is named too, and for an intermittent failure it is the common one: a reproduction attempt that neither confirms nor refutes within the one-rerun bound is recorded as **inconclusive**, and inconclusive is not unrelated — the failure stays blocking for the Reviewer, but the branch does not go into stabilizing it either; that task stops short of delivery and escalates to the maintainer with the failure, what the attempt showed, and any supporting signal, for a defer-or-stabilize decision, leaving siblings in a batch unaffected.
- **Duplicate flake tasks are acceptable; bound them where they are created.**
  Name the failing suite or test in the task title, which makes a sibling copy greppable, and grep the task folder for an existing task on that suite before writing one: an **active** match means the queue entry already exists, so cite it and carry the new evidence in the PR body or batch summary rather than editing the task file — a base-landed file edited from several sibling branches at once turns cheap duplicate cleanup into merge conflicts at every merge — while a match only in `done/` or `deferred/` is context to cite beside a new schedulable queue entry.
  Say what that grep can see, so the step is not read as a dedup promise it cannot keep: it catches an already-landed task and one this same branch wrote, but a concurrent sibling implementer's flake task lives on that sibling's branch and is invisible from this worktree — and the concurrent case is the motivating one.
  Cross-branch consolidation stays the maintainer's next reaping sweep by design; the greppable title is what makes it cheap.
- **Packet hard-check.**
  Adopt a returned fix/implementation packet only from a worktree that is both clean and idle: `git -C <worktree> status --porcelain` empty (every intended change committed, as the packet contract already requires) **and** no Git operation in progress — check `git -C <worktree> rev-parse --git-path rebase-merge` and `rebase-apply` for an existing path, plus `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG`.
  Either condition failing means redrive or resume that pass, never silent adoption.
- **No latched flags.**
  Any per-round condition that reaches the cycle's result — a deviation, a peer outcome, a caveat — is re-evaluated every round: the result describes the **final** state, and the round-by-round values are kept separately and named as history.
- **Round cap:** allow at most **12 reviewer rounds total**, including the initial review; every fix-up round counts regardless of which reviewer triggered it.
  The cap is a runaway-loop guard against arcane token bloat, not a quality dial.
  If issues persist after round 12, stop iterating, do not deliver or publish, and surface every outstanding finding set verbatim.
  An invoker may lower the cap for a bounded context, never raise it.

## Disposing findings — how the cycle ends

Every reviewer and peer finding is dispatched to a fixer that explicitly disposes each item: **fixed**, **declined** (with a reason — a decline is verified by the next fresh Reviewer, never final on the fixer's say-so), or **escalated** to an open question (format below).
The cycle ends only when the Reviewer passes **and** the fixer's last pass disposed nothing new: after a passing round, hand the passing fresh Reviewer report — its pass-notes and stray remarks included — to one final fixer pass so those remarks get considered by an agent with full context rather than dropped by the orchestrator; if that pass disposes nothing new, the cycle is done, and anything it fixes or disputes goes through another reviewer round first.
The peer's advisory notes are excluded: they remain human-summary-only under **Compact pass-note consumption** and never enter a fixer or final-confirmation prompt.
**`light` mode**, at the invoker's explicit choice for small mechanical changes, skips that final no-op fixer pass and ends the cycle at the passing round, recording any undisposed remarks as such — it skips that pass, never the delivery-tier gate, so under `light` the last fixer pass is the one that owes it.
**Trivial-round close-out** is the second bounded invoker/orchestrator discretion, and a different one: `light` skips the final no-op fixer pass, while close-out skips the re-review of trivially-fixed findings.
When a passing-adjacent round's remaining findings are exclusively non-semantic — wording, typos, comment phrasing, formatting; nothing touching behavior, logic, or the meaning of an acceptance criterion — the orchestrator may have the fixes applied and conclude the cycle without another reviewer-plus-peer round, which deliberately amends the rule above that anything the final pass fixes goes through another reviewer round: that rule keeps holding for anything semantic, and the close-out is never a way to swallow a finding without disposition, since every finding still receives an explicit one.
The fixer lists only those non-semantic edits in `closeOutEdits`; ordinarily they are the whole pass diff.
**Fixed** is the only disposition a close-out survives: a finding **declined** or **escalated** on that pass forfeits it and buys the normal round, because that claim is the next fresh Reviewer's to adjudicate and — unlike a fix — leaves nothing in the diff for the close-out check to see.
The license is judged on the diff, not the findings list: before concluding, the orchestrator reads the close-out diff itself and confirms the fixes portion holds only the listed non-semantic edits — any executable or behavioral change in that portion, however it got there, forfeits the close-out and buys a normal reviewer round.
That read runs in both directions: the same check also confirms the fixes portion is non-empty and actually carries the pass's whole claim — every edit it listed **and** a change answering every finding it disposed **fixed** — so a claimed edit the range does not hold, or a fix the range never received, forfeits the close-out just as a semantic change does.
One exact suffix is the sole exception to the ordinary whole-diff rule: when the delivery run appends the flake policy's diagnosis-only record as the final commit, the fixer reports it in `flakeRecord` but does not list it in `closeOutEdits`, and may still offer the close-out.
That report merely accounts for the suffix and cannot certify or broaden it: the same read-only check independently identifies and names the suffix from its commit diff, applies the non-semantic and completeness questions to everything before it, and leaves any invalid candidate in the fixes portion where it forfeits the exit; the cycle independently resolves the committed HEAD and its actual parent and accepts only that exact parent-to-tip suffix, so the checker cannot substitute a valid-looking whole-pass range.
Any other semantic content anywhere in the pass diff forfeits the close-out regardless of how `flakeRecord` describes it.
It skips the re-review, never the delivery gate: those fixes are a post-run change, so the concluding pass reruns the delivery tier over them.
Ordinarily the result records the close-out and lists the edits that shipped unreviewed; when that run appended the tolerated record, it also carries a `recordOnly` record naming the exact unreviewed suffix and the pass's note of the flake for the PR body or batch summary, so both kinds of unreviewed content reach the maintainer.
It is no license to repeat, either — consecutive rounds of trivial findings in the same section remain the structural signal above, not an invitation to close out again.

When a fixer delivers something other than a decision the maintainer locked, it reports what it delivered instead and the constraint that forced it; the cycle records the deviation prominently in its result — at the top of any PR comment or summary it produces — and leaves ratify-or-conform to the human.
Report, don't correct: the loop never conforms a deviation away before the maintainer has seen it.
The Reviewer supplies what that decision needs — whether an in-spec route existed, and a recommendation that is one of the two verdicts, ratify or conform — a hedge fills the field without making the call, and counts as no recommendation at all — one per deviation that still stands and recorded as its own item rather than left to prose, so a round does not pass while one of them is unassessed — and grades completeness, tests, and regressions exactly as strictly, since a deviation is no license for unfinished work.
Each later pass restates the deviations that still stand, **verbatim** — the cycle matches them by exact text, so a reworded restatement reads as a drop plus a brand-new deviation — and the result names the ones live at the end rather than every one ever raised.
Leaving one out is a **claim**, not an effect: like a retirement it holds until a round passes with the claim in view — the Reviewer is shown it beside what still stands, and raises one it does not accept as an issue.
Any move the final confirmation pass makes to that set — dropping one, or first stating one — earns one more round rather than ending the cycle undecided, so no deviation vanishes with the loop's last turn, none outlives the round that accepted it was closed, and none reaches the maintainer carrying only the implementer's half of this protocol.

## The peer step

The mechanics of a peer review — the probe, the prompt file, the launch, the wait, the teardown, and the classified result — are `peer.sh`, beside this file: run it by path, and read `peer.sh --help` only when an answer surprises you.
It answers in `key=value` lines with `outcome=` first, and exits 0 for every outcome a cycle continues past.

**Preflight once per run**, unless `peer-opinions=off`: `peer.sh preflight --provider codex`.
`available` and `deferred` both mean launch: `deferred` is a probe that could not tell (a set `CODEX_API_KEY` beside a failed login probe), so there an auth/usage `unavailable` from the first real launch marks the peer unavailable for the rest of the run.
`unavailable` means no peer this run; record its `reason` for one final-summary note.
A batch orchestrator preflights once for the whole batch and never repeats the probe inside entries.

**What the peer is told is a facts file and nothing else.**
Write the evidence the Peer role above lists to a file of its own, and never the implementer's reasoning: the script builds the prompt from `peer-brief.md` and that file alone.
Set `artifact_root` to this cycle's artifact directory, outside the reviewed worktree: the script makes every launch a directory of its own under it and answers that path as `artifact_dir`.

**Launch** inside the concurrently started Peer role: `peer.sh run --provider codex --worktree "$worktree" --artifact-root "$artifact_root" --facts "$facts_file"`, exactly once, in the foreground.
Set the caller-side Bash/tool wait to at least 570 seconds but strictly below its roughly 600-second cap, and do not background, poll, retry, or externally signal the call: where `peer-review-run` is on PATH the script runs it, and that helper owns timeout, transient-only retry, and provider-tree reaping inside that wait.
`outcome=launched` means the script started the provider directly instead, because the helper is absent, `jq` is not there to read its result, or its verdict named no review file this cycle could relay; `fallback_reason` says which, and a run states it once rather than every round.
Then run `peer.sh collect --artifact-dir "$artifact_dir"`, with the `artifact_dir` that answer carries, under the same wait, again for as long as it answers `pending`.
A direct launch gets a loose 12 minutes per attempt; pass `--deadline <seconds>` to `run` where visible progress or review size justifies waiting longer.

**Review strength is pinned per invocation.**
The script reviews at an explicit medium effort and names no model for codex: codex exposes no stable non-dated alias to pin and naming a concrete id is barred by the never-dated-model-IDs rule, so the model is the peer's configured high-capability default (the root `model` of `${CODEX_HOME:-~/.codex}/config.toml` — that configuration is what "configured high-capability model" means wherever these skills say it).
The pin never writes back to the saved configuration.
Record the reported `model` and `effort` as the round's strength note; `model=null` is that note and never a reason to launch again.

**Reading the result.**
For `passed` or `issues`, `review_file` is the peer's full review as plain text: read that file in full before applying verdict logic and relay every finding from it verbatim.
Never look for the review anywhere else, guess a filename, or parse a provider-specific envelope.

**The one stop is exit status 3.**
It means a provider the script launched could not be proved dead (`teardown=survivor`, with its `pid`): stop the cycle and escalate for operator intervention, with no retry, next entry, or publication.
Any other non-zero exit is the script's own failure, never a verdict: record that round's peer as `failed` with the script's stderr line and continue.

**Optional second peer: Muse.**
Muse Code is a third harness some containers carry and most do not, so it is strictly additive: everything above describes the cycle without it, and nothing here changes the Peer.
Preflight it once per run beside the Peer's own preflight, unless `peer-opinions=off`, which disables both: `peer.sh preflight --provider muse`.
`absent` means this container has no Muse and the run says nothing about it; `unavailable` means no second peer this run, said once in the final summary.
A batch orchestrator preflights it once for the whole batch, like the Peer.
Launch it with `peer.sh run --provider muse` on the Peer's facts file and `--artifact-root`, exactly once, in the foreground, inside its own role started at the same moment as the Peer's, under the same caller-side wait.
It runs through `peer-review-run` only, as one long attempt rather than two short ones, so it never answers `launched`; an `unavailable` from the launch itself (the helper is missing, or predates Muse) means no second peer for the rest of the run, stated once.
Contributor mode is the user's saved Muse setting, which also decides how fast their Muse allowance is spent, so leave it alone: set no `MUSE_CONTRIBUTOR_MODE` for the call.
Its result lands in the outcome vocabulary below and feeds the gate, the grounding spot-check, the verbatim relay, and the pass-note consumption on the Peer's terms, its `model` and `effort` are recorded beside the Peer's, and its launches count toward the same batch throttle.

**Compact pass-note consumption.**
Read the review at `review_file` and copy only the bounded bullets below its exact `NOTES (advisory; not necessarily fixes)` heading into the structured peer `notes`; do not import the verification line, issue prose, reasoning, or any text outside that section.
The workflow consumer revalidates the structured value independently: preserve at most three exact `- path:line — note` bullets whose note is at most 15 words, discard every malformed, over-budget, or surplus bullet, and return an empty value when none survive — and drop the value whole for any outcome other than `passed`/`issues`, since a peer that reached no verdict wrote no NOTES section, so bullets arriving beside `unavailable`, `timeout`, `failed` or `forfeited` (which is also where an unrecognized outcome lands) are a misparse of output the stage judged unusable rather than advice.
Surface the surviving bullets under that round's peer entry in the cycle result; the standalone summary logs those bullets compactly, the batch summary returns them in each task's `peerRounds`, and a clean pass remains only the usual one-line outcome.
The extraction reads that file and nothing else.
Pass-notes remain advisory human-facing output in every mode: never include them in a fixer or final-confirmation prompt, and never let them open a fix round or cause edits.

**Outcome vocabulary.**
Whichever path launched the peer, `peer.sh` reports one vocabulary: `passed` and `issues` feed the gate; `unavailable` (missing binary, logged out, auth/usage exhaustion), `timeout` (after the one retry), `forfeited` (empty or unintelligible output), and `failed` (provider crash or exhausted retry) are explicit non-blocking round outcomes.
Carry its `reason` exactly, an empty one included, and never invent or paraphrase one: that exact value is what the batch throttle reads.
Anything that is not `passed` or `issues` is non-blocking — normalize an unrecognized outcome the same way rather than letting it fall through.

**Batch concurrency is an optimistic session-local adaptive throttle.**
Start with no cap.
A `timeout` or `failed` outcome is trouble.
A `forfeited` outcome is trouble only when its exact retained reason maps to empty/garbled output: the script's own literals `empty output` and `garbled output`, or the helper literals `provider exited 0 with an empty final message` and `provider exited 0 but produced a malformed/unparseable response`.
Do not substring-match or paraphrase reasons; in particular, `provider exited 0 but emitted no recognizable VERDICT token`, other forfeitures, and auth/usage `unavailable` outcomes are not throttle events.
On the first trouble, cap new launches at `max(2, min(8, current in-flight))`; never kill calls already in flight, and queue launches beyond the cap.
Each later trouble cluster halves the cap as `max(2, floor(cap / 2))`: a cluster is one cap generation, so only trouble from a call launched under the current cap can step it down and results from calls already in flight at the prior step cannot collapse it again.
The floor of 2 applies whichever rule produced the cap.
The counter is shared by every peer launch in this orchestration session, has no cross-container coordination, resets next session, and every step-down is surfaced in the run summary.

## The delegated rebase step

Bringing one entry's branch onto its freshest base — its own base ref, or its parent's new tip within a stack — is a **delegated** step with a single brief, defined here and referenced rather than restated by the skills that rebase: `address-review` and `address-reviews` name the points they run it at and the argument that opts out, and neither respecifies what the step does.
A workflow brief handed to a subagent that has read no skill renders this step inline instead — the one sanctioned exception, and it may not restate it anywhere else.
The caller **never runs the rebase in its own turn**: it spawns a fresh subagent for it, exactly as it does for a fixer.

**How the step is carried out is `rebase-brief.md`, beside this file, and the rebaser reads it rather than you restating it.**
Open the rebaser's prompt with the destroy-boundary line, then tell it to read `<path>/rebase-brief.md` in full and carry it out.
That file holds the recovery ref and its read-back, pinning the base to a commit, the `--no-update-refs --no-rebase-merges` shape of every replay, the guard that halts on a merge commit carrying its own content, hunk-level conflict resolution under `rebase-stack`, the clean halt, the validation, and what the step returns.
What follows is the caller's half: what the prompt has to carry, and what to do with what comes back.

**Where it runs is the caller's working location for that entry** — the checkout it works inline, or the worktree it attached — so the brief carries that absolute path, the branch, the pinned base below, and a destination for any build output under this cycle's artifact-directory rules.
An inline location means the rebase rewrites a branch someone may be standing on: that is inline working's contract rather than a side effect, and the caller says which mode it is handing over.
The prompt also spells out, as commands, the two ref writes the step makes, because the destroy boundary otherwise forbids `update-ref`: the recovery ref saved before the first replay (`git update-ref refs/pre-rebase/<branch>/<ts> HEAD`, timestamp `YYYYMMDD-HHMMSS`), and the snapshot that keeps a pinned base reachable where nothing else does (`git update-ref refs/pinned-base/<slug>/<ts> <oid>`).
The step reads the recovery ref back and reports the full ref path, the OID it resolved to, and the pre-rebase tip; a caller adopts the replay on that read-back rather than on the ref's shape.

**The target is pinned to a commit, and the caller says whose ref it is.**
The step resolves the target once and rebases onto that **OID**; the OID actually rebased onto is this entry's *effective base*, and it is what every delegation range afterwards names — `<effective base>..HEAD` — under the stable-refs rule above.
Where the target is a ref name rather than a commit, it is fetched fresh from the repository that ref **lives in**, which the caller names in the prompt: for a PR's base that is the repository the PR itself is in, whose `<owner>/<repo>` is the one in the PR's own `url`.
That fetch is one of two arms and the caller says which it is handing over, because WHOSE ref the target is decides where it lives: a target the **request** named outright — `rebase on top of <target>` — is routinely a local branch, so it is resolved in the working location and fetched from nowhere.
Never hand over a movable remote-tracking name such as `origin/<base>`, and never hard-code `origin/main`: entries legitimately target other branches and other entries' heads.

**Stacked entries rebase parent-first, in topological order.**
What makes that possible is a parent map — each entry's PR base and head as **repository-qualified** pairs, from one `gh pr view --json baseRefName,headRefName,headRepository,headRepositoryOwner,isCrossRepository` per entry, the base side being that PR's own repository — specified here and held by the caller, since it spans entries and outlives any one delegation.
Match child to parent on those pairs, never on bare branch names, exactly as `address-reviews` does it: its `targets.sh plan` holds a batch to the one repository its PRs' own URLs name before it matches a base branch to a head branch, and leaves a fork's head branch out of the match.
A parent rebases onto its own base first; each child is then handed its parent's **new** tip and its old one, and rebases onto the new with `--onto`.
Restacking a whole chain after merges is `rebase-stack`'s job: this step names that skill and stops rather than growing into it.

**A no-op is the common outcome, and it is what makes a caller's two points safe.**
Over a linear range, against a base already an ancestor of `HEAD`, the step replays nothing and the tip is unchanged; a pure-join merge still in range is the one exception, flattened once and then gone from the range, so either way a second point cannot re-apply the first's work.
A reported no-op lets the caller keep its verdict over an unchanged tree and skip the validation.
That claim is the one that switches checks OFF, the validation and any re-verification a caller runs over a replayed tree, so a caller adopts it on the unchanged tip it names rather than on the flag alone: a no-op naming a moved tip, or naming none, is unevidenced and stops that caller's run.

**A halt comes back as an open question, with the tree left clean and idle.**
A conflict beyond the step's competence, and a merge commit that introduced content of its own, both halt the entry rather than guess: the rebase is aborted, or never started, and the halt is reported in the format below (`origin: rebase`), naming the files, the offending commit or merge, and what the judgment turns on; the caller gives that question its `id` and round, and its `coupledWith` where it shares a decision with another.
One entry's halt is one entry's: siblings proceed, and nothing of the halted entry is published.

**A rebase that actually replayed something is validated at the delivery tier**, per the validation tiers above; a no-op earns none.
Where a caller rebases after its fixes, that point runs **before** its final reviewer round, so the passing verdict is rendered on the exact tree that will be pushed.

**What the step returns:** the pinned effective base OID, the pre- and post-rebase tips, whether the tip changed at all, the conflicts it resolved and the commits it skipped, the validation outcome, and any halt with its open question.

## Escalation: open questions

An `escalated` disposition raises an open question for the human — typically consumed by `resolve-open-questions`, whose four-part brief (grounded context, concrete trigger, distinct options, recommendation) the fields below map onto one-to-one, so a completed cycle's questions are consumable without re-derivation (that skill's grounding step still re-verifies every carried claim against current state before serving).

Record each question with: a stable `id` within the run (e.g. `<cycle-slug>-q1`; referenced by the disposition that raised it and by `coupledWith`); the `question` phrased as the decision fork, not a narrative; its `origin` (reviewer | peer | implementer | rebase) and the round it arose in; whether it was `blocking` (the cycle could not pass without the answer) or a parked nit; `artifacts` — authoritative pointers only (`file:line`, ref, PR/thread URL, task file), never a paraphrase; the concrete `trigger` that manifests the problem; its `reachability` (live | dormant | impossible-until | unknown, plus the condition when dormant or prerequisite-bound) — a carried claim, re-derived before anyone acts on it; drafted `options` with the blast radius of each (may be empty); a `recommendation` with a one-line why (empty when the call turns on maintainer intent); and `coupledWith` — ids of sibling questions sharing the one underlying decision.

That `id` must be one no earlier pass used.
Re-using one reads as a **re-report** of that pass's question rather than a new question, so the cycle keeps the entry from the pass that raised it and drops the re-report.

The disposition's `questionId` back-reference is checked in its own right, not only where it decides whether a handed finding was covered: a **spontaneous** disposition — one naming no finding, and every disposition on a pass handed nothing, which the final confirmation pass always is — covers nothing by construction, so nothing else would ever look at it.
An `escalated` disposition whose `questionId` names no question the cycle carries **live** — one no pass raised, an absent or empty id, or one a retirement has already settled or claimed — is reported like any other disposition error rather than quietly pointing at nothing; a settled id is that same breach and not a case of its own, since a decision off the maintainer's list is nothing to escalate to whether it was taken off or never on it.
Naming a still-live id is no breach at all, even where the re-report rule above then keeps the raising pass's question over the restatement: that decision does reach the maintainer, and failing the round over a restatement would cost a converging cycle another round for nothing.

**Retiring a superseded question.**
A later pass often settles the issue behind a question an earlier pass raised — the next reviewer rejects the escalation as an evasion, and the pass after it simply fixes the thing — and the cycle should then stop asking the maintainer to decide it.
When a `fixed` or `declined` disposition settles a still-live open question, it names that question's `id` among the questions it retires, and the cycle **marks** the question retired (recording the pass and disposition that settled it) rather than dropping it.
Like a decline, a retirement is not final on the fixer's say-so: the next fresh Reviewer is handed the question that was retired and what the fixer claims settled it, and overrules an unearned retirement — this is the one disposition that takes a decision off the maintainer's list rather than adding to it.
So the mark lands **pending** and becomes the settled one a consumer skips only once a round PASSES with it in view: a claim no round accepted — the Reviewer rejected it, or no round ever judged it because the cycle errored or hit its round cap — leaves the question live for the maintainer, which is the whole point of marking rather than dropping.
An unaccepted claim is re-presented to the next round rather than expiring: a round can fail on something else entirely, and a fixer whose finding is no longer carried has no disposition left to restate the claim on.
Nor can a claim be WITHDRAWN: the question leaves the fixer's live list the moment it is claimed, so no later pass can retract it; an unaccepted claim ships as the live decision it still is.
Only `fixed` and `declined` retire — an `escalated` disposition raises a question rather than settling one; only a question an EARLIER pass raised can be retired, since a pass that both raises and settles one is contradicting itself rather than superseding anything; a retirement naming an id the cycle does not carry live from an earlier pass — an empty id included, which names nothing — is reported like any other disposition error rather than silently doing nothing; and a question a retirement settles can never validate an escalation that names it, whether that retirement came from an earlier pass or the same one.
Show each fixer pass the questions still live, or it has no ids to name.

Open questions always surface structurally in the cycle's result — they exist for the human — while the bulk prose stays on disk behind the artifact pointer; a retired one rides along marked, and a consumer serving questions to the maintainer passes over it — a retirement still pending a round's verdict does not carry that mark, and is served as the live decision it still is.

## Artifact types

The cycle reviews more than code; the invoker names the type, the Reviewer's prompt and the peer's evidence carry it, and their briefs say what each is checked for:

- **code** (default) — a committed diff, built or typechecked first at the round's stated tier.
- **prose** — a drafted task file or document; there is no build to run.
- **decision** — an applied decision's diff, held to exactly the locked option.

## Artifacts and hygiene

Every cycle uses its own unique artifact directory outside the worktree — suffix the cycle slug, reduced first to a single path segment, or create it with `mktemp -d` — never a fixed shared filename: parallel cycles share one scratchpad, and fixed names have crossed review streams between concurrent runs before.
A slug is routinely a branch name, and the `/` in one splits the suffix into a parent directory: `mktemp` refuses that outright, and a `mkdir -p` path takes it silently, nesting the round history where nobody will look for it.
The full round history (reviewer reports, peer output, fixer packets) lives there, as does any build or validation output a role redirects to a file; the cycle's result carries the pointer, not the prose.

## Running it as a drop-in

Invoked directly, resolve the target first: an explicit worktree, branch, diff range, or file set — else the current checkout's uncommitted change or unpushed branch.
Round 1's fixer is the implementer: for an uncommitted ad-hoc change it commits the change as given (no rewriting) so review runs against committed state; for a drafted task or doc it is the drafting itself.
Then run the loop to its verdict.

Report at the end: the verdict and rounds used (and whether the cap was hit), every finding with its disposition, open questions in the format above, any deviation from a locked decision, peer participation (note an unavailable/disabled/forfeited peer once with its reason, plus any discarded ungrounded findings), and the artifact directory.
