# Agent Session Learnings - 2026-07-30 23:12 UTC

Repository: Roubtec/agent-skills
Agent: Claude
Session focus: `address-review` on PR #26 (spec-only PR, 16 task files) — round 5 of a multi-round bot review loop, six internal reviewer+peer verification rounds, and a near-miss repo-destruction incident caused by a reviewer subagent.
Transport: Temporary branch `learnings/session-20260730-231224` (no PR)

## Summary

- **A reviewer subagent ran `rm -rf ./*` in the shared main checkout.** Recoverable only by luck — `./*` does not match dotfiles, so `.git` survived. Root cause was my prompt authorizing empirical verification, but the environment offered no safe place to do it. This is the highest-signal item and the rest of the report follows from it.
- **`wt-enter` isolates the working tree but *not* the object store or refs.** Worktrees are the wrong primitive for destructive git testing, and powbox currently has no right primitive. A disposable-clone helper is the obvious gap.
- **Empirical verification by reviewers was genuinely high-value** — it caught four wrong fixes that pure reading missed. The fix is not to ban it but to make it safe, which is a powbox opportunity rather than a skill-guidance-only one.
- **Bot review of a spec-only PR does not converge.** Findings went 11 → 6 → 2 → 8 across rounds, with 7 of the last 8 on files already passed 3–4 times unchanged. The review loop's implicit "findings decrease" assumption does not hold for prose artifacts.

## Issues and Opportunities

### 1. Reviewer subagent destroyed the main checkout; no isolation primitive existed for the job

- Type: sandbox
- Severity: high
- Evidence: A reviewer subagent, asked to verify `gh pr checkout` branch-selection behaviour, wrote a script to build a throwaway clone in the scratchpad and test against it. The clone ran inside a pipeline (`git clone … 2>&1 | tail -2`), so `set -e` saw `tail`'s exit status and did not abort when the clone failed. Execution continued with the working directory still at the repo root, where the script ran `rm -rf ./*`, then `git checkout --orphan`, a commit, and `git branch -f tasks/…`. Tracked files were deleted and the session branch ref was moved onto an orphan commit. Confirmed afterwards in the main repo's reflog (`commit (initial): unrelated root`, `branch: Reset to HEAD`).
- Impact: Full stop on a near-complete review run; a maintainer-visible scare; ~30 minutes of forensics and restoration. No work was lost — `./*` does not match dotfiles so `.git` survived, every tracked file was restored byte-exact, and the maintainer had pre-emptively pushed the branch. The margin was luck, not design.
- Suggested improvement: Three complementary layers, in priority order.
  1. **Bake a disposable-clone helper** (`dc-enter <slug> [<ref>]` / `dc-remove <slug>`), mirroring the `wt-enter`/`wt-remove` ergonomics but producing a *full independent clone* under a container-local path **outside `/workspace`**, printing only its path. This is the missing primitive — see item 2 for why worktrees cannot fill it. Its existence lets skill guidance say "verify in `$(dc-enter probe)`" instead of leaving each agent to hand-roll clone-and-cd.
  2. **Offer a read-only view of the repo for reviewer subagents** — a bind mount or an overlay whose lower layer is the checkout — so that a reviewer that never needs to write simply cannot.
  3. **Skill-guidance hardening** (already applied to later prompts this session): every reviewer/fixer subagent prompt states the permitted read-only command set explicitly and names the forbidden set, including "not in a clone, not in a temp directory, not 'safely'".
- Repro/trigger: Any subagent prompt that authorizes empirical `git`/`gh` verification, whenever its setup step can fail without aborting.
- Confidence: observed

### 2. Worktrees isolate the working tree but not refs or objects — a silent mismatch with how they are used

- Type: docs
- Severity: medium
- Evidence: The incident script's `git branch -f tasks/session-learnings-adoption HEAD` would have moved a shared ref *even if it had run inside a `wt-enter` worktree*, because linked worktrees share `.git`. The container docs correctly warn that the `.worktrees` volume and the main checkout are shared surfaces, but the natural reading of "worktree isolation" — reinforced by `address-tasks`/`address-reviews` using worktrees precisely for parallel-agent isolation — is that a worktree is a safe blast radius. It is safe against *working-tree* collisions and unsafe against ref and object mutations.
- Impact: Encourages exactly the wrong instinct when an agent reaches for isolation before a destructive experiment. Contributed to item 1: the reviewer believed a scratchpad clone was overkill-but-fine, and had no helper steering it.
- Suggested improvement: State the boundary explicitly in the container docs and in the worktree-helper guidance: *a worktree isolates the checkout, not the repository — `branch -f`, `reset`, `update-ref`, `gc`, and `push` all reach every sibling worktree; use a separate clone for anything that mutates refs or objects.* Pair it with the `dc-enter` helper from item 1 so the warning has somewhere to point.
- Repro/trigger: Any agent choosing an isolation mechanism before a destructive or exploratory git operation.
- Confidence: observed

### 3. `set -e` plus a pipeline is a recurring footgun in agent-authored bash

- Type: agent-instructions
- Severity: medium
- Evidence: `git clone -q … "$S/clonetest" 2>&1 | tail -2` under `set -e`. A pipeline's exit status is its *last* command, so the failing clone was invisible and the script continued past its own precondition. Agents pipe to `tail`/`head` habitually to keep output short — the same habit that makes output readable silently disables the error guard.
- Impact: Converted a failed setup step into continued execution in the wrong directory. This is the mechanism that turned a careless script into a destructive one.
- Suggested improvement: Add a short rule to the container/agent guidance: when a command's failure must stop the script, do not pipe it — capture output to a variable or a file and trim afterwards, or set `set -o pipefail` alongside `set -e`. Worth stating as a named trap rather than assumed bash fluency, since every agent harness in the container writes bash this way. A companion rule: after `cd`, verify arrival (`cd "$D" || exit 1`) rather than trusting `set -e` to have covered the path that produced `$D`.
- Repro/trigger: Any generated shell script that pipes a load-bearing command for output brevity.
- Confidence: observed

### 4. The `Agent` tool has no read-only mode, so safety lives entirely in prose

- Type: agent-instructions
- Severity: medium
- Evidence: Restricting a `general-purpose` subagent to read-only work is only expressible as prompt text. The reviewer that caused the incident had a prompt permitting empirical testing; later reviewers in the same session got an explicit forbidden-command list, which worked — but is unenforced, and one paragraph of prose is the whole control. By contrast the codex peer ran `--sandbox read-only` and was structurally incapable of the same mistake, which is why it was never a risk in six rounds.
- Impact: The safety of every review round depends on the orchestrator remembering to write a paragraph, and on the subagent honouring it.
- Suggested improvement: Define a `reviewer` agent type in `.claude/agents/` whose frontmatter grants only read/search tools (no `Write`/`Edit`, and `Bash` restricted or absent), and have the review-cycle skills spawn *that* rather than `general-purpose` with a prose caveat. The codex side already demonstrates the pattern with `--sandbox read-only`; the Claude side should match it. This is a strong fit for task 014's canonical `review-cycle` block, which is where the reviewer brief is being centralized anyway.
- Repro/trigger: Every reviewer spawn in `address-review`, `address-reviews`, `address-tasks`, `-serialized`, and `resolve-open-questions`.
- Confidence: observed

### 5. Bot review of spec-only PRs does not converge; the loop has no exit criterion for prose

- Type: workflow
- Severity: medium
- Evidence: Codex findings on PR #26 across four review rounds: 11 → 6 → 2 → **8**. Of the last round's eight, seven targeted files that had been unchanged for two or more rounds and that codex had already reviewed and passed three or four times (task 021 was untouched since the branch's first commit). The findings were individually valid P2s, but they were newly *sampled*, not newly *introduced*.
- Impact: Four review rounds and roughly a full working day of loop time on a PR containing no executable code, with the finding count rising at the end. Each round's fixes added prose, enlarging the surface for the next round — a positive feedback loop.
- Suggested improvement: Give the review-addressing skills an explicit artifact-aware exit criterion, distinct from "no unresolved threads". For prose/spec artifacts the merge bar should be *states intent, reasoning, and falsifiable acceptance criteria*, with "specify this mechanical detail" findings explicitly out of scope and the implementer expected to supply them. Task 014's `artifactType` parameterization (`task-file/doc prose`) is the natural home; it currently changes what the reviewer *checks* but not when the loop *stops*. Concretely: after round N, findings that do not name a concrete bug, contradiction, false claim, or defect-satisfiable criterion should not gate publication. Stating that bar inside the ping comment measurably changed the review's character when tried late in this session.
- Repro/trigger: Any `address-review` run on a PR whose diff is documentation, specs, or task files.
- Confidence: observed

### 6. Two spec sections had to be restructured because review pressure drove them into over-specification

- Type: workflow
- Severity: low
- Evidence: Task 017's cleanliness assertion drew four same-class findings across two rounds (untracked-directory collapse, already-present untracked path, staged-mid-run reclassification, ignored paths); task 018's attach exception drew four rounds on a single sentence. In both cases each round closed one mechanical case and exposed the next, because the text had drifted into specifying an algorithm (a `git status` diff; a specific `gh` invocation) rather than a requirement.
- Impact: Roughly half of this session's fix rounds. Both were resolved only by rewriting the section to state what it *claims* and leave the mechanic to the implementer — which is the repo's own heuristic, already written down in task 019 items 1 and 2.
- Suggested improvement: This is evidence *for* the guidance in 019 rather than a gap, but it suggests the heuristic needs to fire on the **orchestrator** side automatically: track finding-class-per-section across rounds and surface "this is the second same-class finding here — consider restructuring" in the next fixer's brief, rather than relying on the fixer to notice. Cheap to compute from the finding stream the loop already has.
- Repro/trigger: Multi-round review of any artifact where a rule can be stated at more than one level of abstraction.
- Confidence: observed

### 7. Subagent transcripts are retrievable and were essential for the post-mortem — but undocumented

- Type: docs
- Severity: low
- Evidence: The exact destructive command was reconstructed from `~/.claude/projects/<project>/<session-id>/subagents/agent-<id>.jsonl`. Finding it took several exploratory greps; the main session `.jsonl` does not contain subagent tool calls, so an initial search there returned nothing and briefly suggested the command was unrecoverable.
- Impact: Without it, the incident write-up would have rested on the subagent's own summary — which had buried the repo-root execution as a footnote and misattributed a push. Recovering the literal script is what made the analysis trustworthy.
- Suggested improvement: Document the subagent transcript path in the container docs alongside the scratchpad and worktree layout, with a one-line note that main-session transcripts do *not* include subagent tool calls. Optionally add a tiny helper (`agent-transcript <session-id|latest> [<agent-id>]`) that lists and greps them, since post-mortems on delegated work are exactly when this is needed and exactly when nobody remembers the path.
- Repro/trigger: Any investigation of what a subagent actually did.
- Confidence: observed

### 8. `gh-review-threads` requires the current directory to be inside the repo

- Type: tooling
- Severity: low
- Evidence: Running it from the scratchpad failed with `fatal: not a git repository` / `could not resolve the current repo`. The error message helpfully names `--repo <owner>/<repo>`, so recovery was one retry. Friction arises because the Bash tool resets the working directory between calls while scratchpad-bound workflows `cd` there to write output files.
- Impact: One wasted turn.
- Suggested improvement: Minor. Either resolve the repo from the invoking Git worktree when available regardless of `cwd`, or note in the helper's usage line that it must run inside the repo unless `--repo` is passed. Not worth a dedicated task; fold into the next touch of that script.
- Repro/trigger: Invoking the helper from a scratchpad or any non-repo directory.
- Confidence: observed

## Follow-Up Candidates

- Bake `dc-enter` / `dc-remove` disposable-clone helpers outside `/workspace`, and point skill verification guidance at them (items 1, 2).
- Document the worktree isolation boundary — checkout yes, refs and objects no — in the container docs and worktree-helper guidance (item 2).
- Define a read-only `reviewer` agent type in `.claude/agents/` and have the review-cycle skills spawn it instead of `general-purpose` (item 4); natural companion to task 014.
- Add the `set -e` + pipeline trap and the `cd` verification rule to the container's bash guidance (item 3).
- Extend task 014's `artifactType` to carry a prose-appropriate *loop exit* criterion, not just reviewer focus (item 5).
- Have the review loop track finding-class-per-section and surface the restructure prompt automatically (item 6).
- Document the subagent transcript path; consider an `agent-transcript` helper (item 7).
- Fold a `--repo`-less fallback or a usage note into `gh-review-threads` (item 8).
