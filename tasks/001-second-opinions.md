# 001 - Best-Effort Cross-Agent Second Opinions (umbrella + protocol)

This is the umbrella task for wiring **best-effort cross-agent second opinions** into the dev-skills review loops, plus the accompanying **iteration-budget raise (3 → 6)**.
It defines the canonical protocol once; the implementation is decomposed into tasks 001a–001f, each owning a disjoint set of skill files so they can run in parallel worktrees without collisions.

## Why

Both agent harnesses (Claude and Codex) are often installed side by side (powbox guarantees it; other environments may not).
The `address-tasks` implement→review→fix loop already benefits from an independent reviewer subagent; invoking the *other* harness CLI as an additional reviewer, in parallel, systematically incorporates the strengths of both agents and should reduce review churn after the PR opens.
Peer availability is never guaranteed, so participation is strictly **best-effort** — but once a peer delivers coherent, fact-grounded findings, those findings are first-class and can gate delivery like the own reviewer's.

## Verified capability findings (in-container, 2026-07-10)

- `codex exec --sandbox read-only --cd <dir> -o <file> "<prompt>"` runs a **full agentic loop** in one invocation, exit 0, final message captured to `<file>`. `--output-schema <schema.json>` can force a parseable final message; `--ephemeral` skips session persistence.
- `codex review --base <branch>` is a purpose-built review subcommand, but `--base` and a custom prompt are **mutually exclusive** (hard error, exit 2) — we need a custom output contract, so the protocol uses `codex exec` with a review prompt instead.
- `codex login status` exits 1 when not logged in ("Not logged in"); an unauthenticated `codex exec` retries ~30s before exiting 1, so the preflight matters.
- `claude -p "<prompt>"` is the symmetric counterpart (`--output-format json`, `--json-schema` available). Both CLIs accept per-invocation model/effort: `codex exec -m <model> -c model_reasoning_effort=<level>`; `claude -p --model <alias> --effort <low|medium|high|xhigh|max>`.
- Powbox complement (already merged separately): the container guidance advertises the one-shot forms — https://github.com/Roubtec/powbox/pull/98. The skills must NOT depend on it: **all detection, preflight, invocation, and forfeit logic lives in the skills**, since they must work in any environment, including ones where the peer binary is absent.

## The Peer Second-Opinion Protocol (canonical — implementation tasks reference this section)

### 1. Peer identification and availability preflight (once per skill run)

- The peer is any *other* known harness CLI: from Claude skills the peer is `codex`; from Codex skills the peer is `claude`. Keep the pairing extensible (a future harness adds one entry).
- Preflight in the orchestrator, in the main working tree, before the first review phase: `command -v <peer>` (missing → unavailable), then for codex `codex login status` (non-zero exit → unavailable; skipping this burns ~30s of auth retries on every later invocation). `claude` has no verified cheap status probe: classify at first real invocation — an auth/usage-type failure marks the peer unavailable for the rest of the run.
- Unavailability is never an error and never blocks: proceed with own-harness review only, and note the forfeit (with reason) **once** in the final summary.

### 2. Invocation (per review round, read-only, from the task's worktree)

- From Claude skills: `codex exec --sandbox read-only --cd <worktree> -o <outfile> "<prompt>"`. From Codex skills: `claude -p "<prompt>"` with the working directory set to the worktree.
- Default to the peer's own configured model/effort; add `-m` / `-c model_reasoning_effort=<level>` (codex) or `--model` / `--effort` (claude) only when the user asked for a specific combo.
- The prompt must carry: the worktree path, the review scope (base branch or commit range), the relevant context verbatim (task file, or review threads under verification), an instruction to read the actual files, an explicit "edit nothing", and the **output contract**: `VERDICT: PASS | ISSUES` followed by numbered findings, each tagged `blocking` or `minor` with `file:line` and a one-line rationale.
- **Bounded patience:** the CLI peer is fire-and-collect — there is no reliable built-in signal distinguishing "working" from "hung" (`codex exec` streams events to stdout, which a background-running orchestrator can peek at; `claude -p` prints nothing until the final message). Recommend a **loose ~12-minute timeout** — large reviews may legitimately run long (e.g. the peer runs tests) — with orchestrator discretion to wait longer when it expects a long run or can see activity in the peer's event stream. Most batch runs are unattended, so waiting is acceptable; hanging forever is not. On timeout or transient error, retry once (two attempts total), then forfeit this round's opinion.
- **Concurrency and barrier:** launch the peer in the background at the same moment the own reviewer subagent is spawned — both are read-only against a committed worktree, so this is safe and adds no wall-clock. Wait for **both** reviewers before deciding the round's outcome or spawning the next implementer: feedback is acted on as one set, mirroring how `address-review` fetches all comments before acting.
- **Cadence:** invoke the peer on **every** review round while it remains available (default). Skills accept an optional `peer-opinions=off` argument for users who must conserve peer-side usage.

### 3. Triage, merging, and gating

- **Unintelligible output** (not parseable as a verdict + findings) → forfeit that round's opinion, note it, proceed. Same category as unreachable: best-effort.
- **Aggregation without transformation:** the orchestrator never summarizes, merges, or rewrites either feedback set — that would bloat its context and risk laundering findings. It reads only the two **verdict lines**; the next fix-round implementer receives both sets **verbatim, as two labeled blocks** (e.g. "Reviewer findings" / "Peer (codex) findings") and reconciles overlap or conflicts in its own isolated, focused context.
- **Grounding check** (orchestrator, cheap, only when it decides gating — i.e. the own reviewer passed and peer blockers alone would force the round): each gate-deciding finding must reference verifiable facts — the file/line exists and the claim is not self-evidently false. A spot-check, not a re-review. Ungrounded gate-deciding findings are discarded (noted in the summary); everything else passes through verbatim for the fixer to judge, with the next round's reviewer adjudicating pushed-back items.
- **Gating:** a round passes only when the own reviewer passes AND the peer (when it delivered an intelligible verdict this round) reports no grounded **blocking** findings. Grounded blocking peer findings alone — even with an own-reviewer pass — force a fresh implementer round.
- Grounded **minor** peer findings with an own-reviewer pass do NOT burn a round: record them in the PR description / final report instead.
- **Dispute resolution:** the next round's own reviewer adjudicates contested peer claims — if the fixer pushes back with evidence and the fresh reviewer confirms the peer finding is not real, it stops gating. This prevents a hallucinating peer from looping the task forever.

### 4. Round accounting and iteration budget (3 → 6)

- Every implementer round counts toward the cap, whichever reviewer triggered it.
- Raise the cap from **3 to 6** in every skill that has the loop (both trees). Rationale: the cap is a **runaway-loop guard against arcane token bloat, not a quality dial** — it was already being hit legitimately at 3, and with more eyes picking at the code, more legitimate rounds are expected. Behavior on exhaustion is unchanged: stop, no PR / no push, surface outstanding findings.

### 5. Topology: flat and orchestrator-controlled

The orchestrator invokes **both** reviewers itself (own reviewer subagent + peer CLI) and holds both raw verdicts.
The nested alternative — the own reviewer invoking the peer and synthesizing one coherent review — is rejected: it would either serialize the two reviews or bias them, compromise the independence that makes a second opinion valuable (one reviewer filtering the other's findings through its own synthesis), and hide best-effort failures (timeouts, forfeits, retries) inside a subagent where the orchestrator can neither observe nor account for them.
With aggregation-without-transformation (§3), the orchestrator's context cost of the flat design is one extra verbatim blob per round — acceptable.
The same topology applies symmetrically when a Codex orchestrator invokes a `claude -p` reviewer alongside its own subagent reviewer.

## Decomposition (disjoint file ownership; parallelizable)

| Task | Tree | Files owned |
|------|------|-------------|
| 001a | Claude (`plugins/dev-skills`) | `address-tasks-serialized/SKILL.md`, `address-tasks/SKILL.md` |
| 001b | Claude (`plugins/dev-skills`) | `address-review/SKILL.md`, `address-reviews/SKILL.md` |
| 001c | Claude (`plugins/dev-skills`) | `resolve-open-questions/SKILL.md` |
| 001d | Codex (`codex/dev-skills`) | `address-tasks-serialized/SKILL.md`, `address-tasks/SKILL.md` |
| 001e | Codex (`codex/dev-skills`) | `address-review/SKILL.md`, `address-reviews/SKILL.md` |
| 001f | Codex (`codex/dev-skills`) | `resolve-open-questions/SKILL.md` |

## Out of scope (tracked separately)

- The powbox-seeded workflow scripts `wf-address-tasks.js` / `wf-address-review.js` live in the **powbox repo** (`docker/claude/agent-container/workflows/`), not here. Their `MAX_ROUNDS` was raised to 6 on powbox PR #98; teaching those workflow scripts to collect peer opinions themselves remains a future powbox follow-up.
- Powbox container guidance (peer one-shot forms + best-effort semantics): delivered via https://github.com/Roubtec/powbox/pull/98.

## Acceptance for the umbrella

All of 001a–001f merged; both trees describe the identical protocol (allowing for harness-specific invocation syntax); `grep -rn "3 rounds\|3 iterations\|round 3" plugins/ codex/` returns no stale budget references.
