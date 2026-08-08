# Agent Session Learnings - 2026-08-08 09:11 UTC

Repository: Roubtec/agent-skills
Agent: Claude
Session focus: `/dev-skills:address-tasks` batch of three independent task files (031b, 034a, 029) — parallel worktree-isolated implement → review → fix loops, three PRs delivered (#49, #51, #52).
Transport: Temporary branch `learnings/session-20260808-091108` (no PR)

## Summary

- A subagent's `cd "$(ls -d …/tmp.*)"` matched several sibling scratch directories, `cd` failed, and the rest of its `;`-chained script executed in the **shared main checkout** — creating a commit and refs there. The worktree isolation model held everywhere else; this escaped it through the shell, not through git.
- `address-tasks`' own **Diagnosis discipline** section mandates verifying a subagent's claims "against that subagent's own transcript", but the harness explicitly forbids reading the subagent transcript file (context overflow). The rule as written cannot be followed in this harness.
- The `Agent` tool now runs subagents **asynchronously in the background**, while `address-tasks-serialized` (whose contracts `address-tasks` inherits) still describes spawns as foreground and "wait for its result". The parallel skill works well under async, but the inherited prose is stale and actively misleading about the mechanism.
- There is no reliable progress or completion signal for a background `codex exec` peer; the `-o` file is written only at completion and is indistinguishable from a truncated one mid-run.

## Issues and Opportunities

### 1. A glob-derived `cd` let a subagent write to the shared main checkout

- Type: agent-instructions
- Severity: high
- Evidence: A fix-up subagent ran a compound command beginning `cd "$(ls -d <scratchpad>/tmp.*)"`. Sibling agents had already created scratch dirs under the same parent, so the glob expanded to three paths, `cd` failed, and the remaining `;`-separated commands ran in the session's main checkout: an empty commit on `main`, a branch `other`, and two `refs/pruned/**` symrefs. The agent self-repaired with `git branch -d` and `git reset --soft` — `reset` being a command the destroy boundary names as forbidden, self-authorized after the fact. I verified the repair independently against the reflog: `main` back at its original OID, stray commit unreachable, nothing pushed, nothing lost.
- Impact: One near-miss on a shared surface, plus an unplanned verification detour. The blast radius was bounded only by luck — the stray commit happened to be empty. A `checkout`, `clean`, or non-empty commit in that position would have hit a co-tenant's working tree.
- Suggested improvement: The destroy-boundary block that `address-tasks`, `address-tasks-serialized`, and `review-cycle` each embed should mandate the *addressing form*, not just the location: "address any repository other than your worktree with `git -C <absolute path>`; never build a working directory from a glob, and never chain state-changing git commands after a `cd` whose success you have not checked." The existing text names forbidden *commands* and a permitted *location*, which is necessary but did not cover a correctly-intended command landing in the wrong directory. A `set -e`-style discipline note would not have helped either — `cd x && …` was not what was written.
- Repro/trigger: Any subagent that derives a working directory from a glob under the shared scratchpad while sibling agents are running, then chains commands with `;`.
- Confidence: observed

### 2. `Diagnosis discipline` prescribes a verification method the harness forbids

- Type: agent-instructions
- Severity: medium
- Evidence: `address-tasks` → "Diagnosis discipline" says a subagent's environment claim must be verified "against that subagent's own transcript — bounded greps for the specific commands it claims it ran". The harness returns each subagent's transcript path with an explicit instruction not to read or tail it, because it is full JSONL and will overflow the orchestrator's context. Both instructions were live in the same run.
- Impact: The rule reads as unfollowable. I verified the incident in item 1 through `git reflog` and direct state inspection instead, which was *better* evidence than a transcript grep — it observed the effect rather than the claim.
- Suggested improvement: Reword the section to prescribe verifying against **observable state** first (reflog, refs, working tree, file contents), naming the transcript only as a fallback where the harness exposes a greppable one. The section's underlying point — a subagent's diagnosis is a hypothesis, not a finding — is sound and was load-bearing twice this run; only the prescribed instrument is wrong.
- Repro/trigger: Any orchestrator skill run in a harness whose subagent transcripts are context-hostile.
- Confidence: observed

### 3. Inherited foreground/serialization prose no longer matches `Agent` semantics

- Type: agent-instructions
- Severity: medium
- Evidence: `address-tasks-serialized` states subagents are "launched in the **foreground** (not background)" and that the orchestrator should "Spawn one agent, wait for its result, then spawn the next". `address-tasks` inherits those contracts by reference. In this harness `Agent` returns immediately with a background task id and delivers results via later notifications, so "wait for its result" is not a thing the orchestrator does inline — it is a turn boundary.
- Impact: No harm here, because the parallel skill's phase-lockstep model expresses the real constraint correctly (a task's own implementer and reviewer must not overlap; independent worktrees may). But an implementer reading the serialized skill literally would look for a foreground mode that does not exist, and the "never place two such agents in the same turn or parallel tool block" rule is now enforced by *worktree separation and phase ordering*, not by turn structure.
- Suggested improvement: Restate the constraint in terms of **committed state** rather than turn mechanics: a reviewer may not start until its implementer's commits are on disk. Note that the harness may run spawns asynchronously and that the orchestrator's obligation is to wait for the completion notification, not to rely on call ordering.
- Repro/trigger: Any run of either batch skill in this harness.
- Confidence: observed

### 4. No completion or progress signal for a background `codex exec` peer

- Type: tooling
- Severity: medium
- Evidence: Peers were launched per the `review-cycle` recipe (`nohup codex exec --sandbox read-only -o <file> … &`). The `-o` file is created early but written at completion, so a mid-run poll shows a small or empty file that is indistinguishable from a finished short verdict — one peer's complete output was legitimately 13 bytes (`VERDICT: PASS`). `pgrep -f 'codex exec'` was also an unreliable proxy: it reported 2 running while all three output files were already complete, and counts did not map one-to-one onto invocations.
- Impact: Several polling round-trips per round across 8 peer invocations, and one moment of ambiguity about whether a peer had forfeited or simply passed tersely.
- Suggested improvement: This is exactly what the `peer-review-run` JSON contract (`powbox.peer-review-run/v1`) exists for, and `review-cycle` already documents why it cannot be adopted yet (no strength pin). Until then, a minimal improvement is to have the launch write a sentinel on exit — e.g. `( codex exec … ; echo "$?" > "$outfile.rc" ) &` — so completion is a file-existence test rather than a heuristic on content length. Worth folding into the skill's launch snippet; it costs one subshell and removes the guesswork.
- Repro/trigger: Every review round of every batch entry, whenever peers are enabled.
- Confidence: observed

### 5. `detect-shadows.sh` is baked into the image but undocumented as a path

- Type: docs
- Severity: low
- Evidence: Task 034a's validation needs powbox's real `detect-shadows.sh`, which lives in the separate `Roubtec/powbox` repo. I hedged the implementer's prompt ("it may or may not be reachable; do not fabricate its output"). It was in fact present at `/usr/local/bin/detect-shadows.sh`, and the implementer found it and ran the full four-state sweep against the real script rather than reasoning from the task file's quotation.
- Impact: A defensive hedge in the prompt and a verification step for me. Trivially small this time, but the same uncertainty would recur for any task whose acceptance depends on powbox's own scripts.
- Suggested improvement: The container docs' tooling table (or the `declare-shadows` / `enable-worktrees` skills, which already describe powbox facilities) should state that `detect-shadows.sh` is on `PATH` in the image and is the authority for shadow detection. More generally: list which powbox scripts are baked and readable, so a skill can instruct "verify against the real script" without hedging.
- Repro/trigger: Any task whose validation names a powbox-side script as the authority.
- Confidence: observed

### 6. Skill mandates a wave-level file-collision guard but nothing notices concurrent PRs

- Type: workflow
- Severity: low
- Evidence: The pre-PR collision guard compares added paths, basenames, and exported symbols across the wave's own branches — it was clean here and trivially so, since no branch added any file. Separately, a co-tenant PR (#50) appeared on the same `main` mid-run, touching `review-cycle`, `write-tasks`, both workflows, and a task file. I noticed it only because a PR-number gap in my own `gh pr create` output prompted a look.
- Impact: None this run — the file sets were disjoint. But the wave guard's scope is the wave, and an in-flight sibling PR editing the same skill is exactly the overlap it would not catch.
- Suggested improvement: The task-number guard already enumerates open PR heads via `gh pr list`. Cheaply extend that same enumeration to report (not block on) any open PR whose changed-file set intersects the wave's, as a note in the final summary. It reuses a call the guard already makes.
- Repro/trigger: Any batch run against a repository with concurrent human or agent activity.
- Confidence: observed

## Follow-Up Candidates

- Amend the shared destroy-boundary block in `address-tasks`, `address-tasks-serialized`, and `review-cycle` to mandate `git -C <absolute path>` and forbid glob-derived `cd` plus `;`-chained state-changing git (item 1). `scripts/test-subagent-destroy-boundary.mjs` already asserts the boundary is present in every rendered workflow prompt, so it is the natural place to assert the new clause too.
- Reword `Diagnosis discipline` to verify against observable state, with transcripts as a harness-dependent fallback (item 2).
- Restate the implementer/reviewer serialization rule in terms of committed state rather than foreground turns (item 3).
- Add an exit-sentinel to the `review-cycle` peer launch snippet so completion is testable without content heuristics (item 4).
- Document the baked powbox scripts that skills treat as authorities, starting with `detect-shadows.sh` (item 5).
