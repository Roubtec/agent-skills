/**
 * wf-review-cycle — the canonical review cycle as a workflow.
 *
 * One complete implement/fix -> fresh-eyes review -> best-effort cross-harness
 * peer review -> fix cycle on a single artifact (a committed change, a worktree,
 * a drafted task file), looping until it converges. This script is the WORKFLOW
 * rendering of the `review-cycle` skill: same roles, gates, disposition rule,
 * and 12-round cap, expressed as deterministic control flow. The prose skill
 * (plugins/dev-skills/skills/review-cycle/SKILL.md) is the canonical statement
 * for prose consumers; this script is the canonical statement for workflows —
 * consumers of either rendering reference it instead of restating gates, caps,
 * or peer semantics.
 *
 * Invoke as `/dev-skills:wf-review-cycle <target and flags>`, or from another
 * workflow (see "Consumption modes" below).
 *
 * Input contract (via `args`, either a structured object or lenient prose):
 *   { worktree, branch, base, scope, artifactType, maxRounds, peer, mode }
 *   - worktree      absolute checkout path, or empty for the current checkout
 *   - branch        the branch under review
 *   - base          effective review base (diff base / merge target)
 *   - scope         { title, instructions, reviewInstructions, items } — the
 *                   work: `items` are the work item(s) verbatim; `instructions`
 *                   is the consumer's round-1 assignment plus any per-item
 *                   report contract its own downstream stages need (extra
 *                   fields the fixer should echo per item ride through
 *                   `workReport` untyped); `reviewInstructions` is the
 *                   consumer's extra verification criteria, given verbatim to
 *                   the reviewer and the peer alike. Push policy is the
 *                   consumer's: state it in `instructions` (the cycle itself
 *                   never pushes or mutates a PR)
 *   - artifactType  "code" (default) | "prose" | "decision"
 *   - maxRounds     may only LOWER the canonical 12-round cap; a larger value
 *                   still stops at 12, and 0, a negative, or a fractional value
 *                   is rejected outright (see cycleRoundCap)
 *   - peer          "on" (default) | "off" — `peer-opinions=off` arrives here,
 *                   through args, never through prose the workflow cannot read
 *   - mode          "full" (default) | "light" — light skips the final no-op
 *                   fixer confirmation pass (small mechanical changes only)
 *
 * Consumption modes
 * -----------------
 * 1. NESTING — where the runtime supports child workflows, invoke it directly:
 *      const cycle = await workflow("wf-review-cycle", { worktree, branch, ... });
 *    Fine for a consumer that does not fan out (wf-address-review). Under
 *    nesting each cycle is a separate child with its own state, so any shared
 *    cross-cycle policy (e.g. a peer-launch throttle) placed inside the child
 *    counts one peer, never sees a sibling's, and caps nothing.
 * 2. SYNTHESIS / EMBEDDING — copy the marked EMBEDDABLE SECTION below into a
 *    single flat consumer script. An embedded copy MUST carry a header naming
 *    the canonical section it was synthesized from, so a later edit to the
 *    section has a findable list of copies to refresh. This is the required
 *    mode where the runtime lacks nesting, or where the consumer must OWN the
 *    launches the embedded logic makes: a fan-out owner (wf-address-tasks)
 *    embeds the section so the fan-out, every peer launch, and any cross-cycle
 *    throttle sit in one flat script's state.
 *
 * Workflow rendering of the peer stage
 * ------------------------------------
 * A workflow cannot shell out — agent()/parallel()/pipeline()/log()/phase()
 * are its entire surface — so the peer invocation happens INSIDE a subagent
 * prompt, never in the script. The stage's agent() call is schema-validated,
 * and a peer subagent can never fail the stage: a null agent() return, a
 * schema-validation miss, a thrown stage, and every outcome that is not
 * passed/issues all land as a recorded non-blocking round outcome. The peer is
 * never required for the cycle to conclude.
 *
 * The peer's baseline interface is powbox's `peer-review-run` helper (result
 * schema powbox.peer-review-run/v1) — but NOT YET: as baked today the helper
 * accepts no model or effort argument and its codex adapter discards the user
 * config, so a peer launched through it runs at `reasoning effort: none` on a
 * bare default model. Until powbox delivers the review-strength passthrough,
 * the stage's subagent runs the PINNED RAW LAUNCH (codex exec with
 * `-c model_reasoning_effort=high`; the model stays the peer's configured
 * high-capability default from ~/.codex/config.toml). When the passthrough
 * lands, the swap to `peer-review-run --provider codex --worktree ...
 * --prompt-file ... --artifact-root ... --timeout N` (flag spelling transcribed
 * from the shipped helper, with --timeout sized under the subagent's own
 * Bash-tool limit) is task 015's; the outcome vocabulary below already matches
 * the helper's, so the swap is a prompt change, not a control-flow change.
 *
 * Peer concurrency policy is task 015's, singly stated there; this script sets
 * no cap, floor, or fan-out shape of its own.
 *
 * Runtime notes:
 *  - The script cannot run git/shell/file IO; agents do all of it.
 *  - No mid-run user input: blockers are returned (or thrown for a caller
 *    contract violation such as an invalid maxRounds), never prompted for.
 */

// The runtime requires `export const meta = {...}` (a pure literal) as the
// FIRST statement. The "Peer review (codex)" phase title below MUST stay
// byte-identical to CYCLE_PEER_PHASE in the embeddable section — a mismatched
// title silently splits the progress display into an extra group.
export const meta = {
  name: "wf-review-cycle",
  description: "Run the canonical review cycle on one change: implement/fix, verify with a fresh-eyes reviewer AND a best-effort cross-harness codex peer review each round, dispose every finding explicitly (fixed / declined / escalated to an open question), and loop to convergence (max 12 reviewer rounds; callers may lower the cap, never raise it). Peer outcomes never block.",
  whenToUse: "Run a local fix->review->peer->fix cycle on a worktree, branch, diff, or drafted task file before a PR exists — or consume it from another workflow by nesting or by embedding its marked section. Not for addressing PR review threads (wf-address-review) or task batches (wf-address-tasks); those consume this cycle themselves.",
  phases: [
    { title: "Scope", detail: "resolve the target worktree, branch, base, artifact type, and work items" },
    { title: "Review cycle", detail: "fixer -> fresh-eyes reviewer rounds with explicit finding dispositions" },
    { title: "Peer review (codex)", detail: "best-effort cross-harness second opinion beside each reviewer round; its outcome never blocks" },
    { title: "Summary" },
  ],
};

// ============================================================================
// BEGIN EMBEDDABLE SECTION: review-cycle-core
// Canonical home: plugins/dev-skills/workflows/wf-review-cycle.js
// A synthesized copy of this section MUST keep a header naming this canonical
// section ("Synthesized from wf-review-cycle.js EMBEDDABLE SECTION
// review-cycle-core") so edits here have a findable list of copies to refresh.
// The section depends only on the workflow runtime globals (agent, log) plus
// plain JS; it holds no module state, so a fan-out owner embedding it keeps
// every launch it makes in that owner's own flat script state.
// ============================================================================

// The canonical convergence safeguard. Consumers may only LOWER it.
const CYCLE_MAX_ROUNDS = 12;

// Exact phase title of the peer stage. Every script carrying this section MUST
// declare a meta.phases entry whose `title` matches this string byte-for-byte.
const CYCLE_PEER_PHASE = "Peer review (codex)";

// Bound a caller-supplied round cap. A larger value still stops at the
// canonical 12 (no consumer can configure its way past the convergence
// safeguard); 0, a negative, or a fractional value is a caller contract
// violation rejected outright — silently accepting it would yield a cycle
// that reviews nothing. Absent/undefined means the canonical cap.
function cycleRoundCap(maxRounds) {
  if (maxRounds == null) return CYCLE_MAX_ROUNDS;
  const n = Number(maxRounds);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(
      `Invalid maxRounds ${JSON.stringify(maxRounds)}: must be a positive whole number of reviewer rounds (it may only lower the canonical cap of ${CYCLE_MAX_ROUNDS}).`
    );
  }
  return Math.min(n, CYCLE_MAX_ROUNDS);
}

// Pinned wire format for escalated open questions. It maps one-to-one onto the
// four-part brief `resolve-open-questions` serves (grounded context, concrete
// trigger, distinct options, recommendation), so a completed cycle's questions
// are consumable without re-derivation — that skill still re-verifies every
// carried claim (reachability especially) against current state before serving.
const CYCLE_OPEN_QUESTION_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", description: "Stable within the run (e.g. \"<cycle-slug>-q1\"); referenced by dispositions and coupledWith." },
    question: { type: "string", description: "The decision itself, phrased as the fork — not a narrative." },
    origin: { type: "string", description: "reviewer | peer | implementer | rebase" },
    originRound: { type: "integer", description: "Cycle round it arose in." },
    blocking: { type: "boolean", description: "True: the cycle could not pass without the answer; false: parked nit/deferral." },
    artifacts: { type: "array", items: { type: "string" }, description: "Authoritative pointers only (\"file:line\", ref, PR/thread URL, task file) — never paraphrase." },
    trigger: { type: "string", description: "The concrete situation that manifests the problem." },
    reachability: { type: "string", description: "live | dormant | impossible-until | unknown — a CARRIED claim, re-derived before serving." },
    reachabilityCondition: { type: "string", description: "The flag/prerequisite when dormant/impossible-until; empty otherwise." },
    options: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          consequence: { type: "string", description: "What choosing it actually produces — blast radius, where it lands, what stays exposed." },
        },
        required: ["label", "consequence"],
      },
      description: "Drafted resolutions with blast radius; may be empty.",
    },
    recommendation: { type: "string", description: "Escalator's pick + one-line why; empty when the call turns on maintainer intent." },
    coupledWith: { type: "array", items: { type: "string" }, description: "Ids of sibling questions sharing the one underlying decision." },
  },
  required: ["id", "question", "origin", "originRound", "blocking", "artifacts", "trigger", "reachability", "reachabilityCondition", "options", "recommendation", "coupledWith"],
};

const CYCLE_FIX_SCHEMA = {
  type: "object",
  properties: {
    blocker: { type: "string", description: "Why this pass cannot proceed responsibly (wrong worktree, unresolvable state). Empty when the pass completed." },
    changed: { type: "boolean", description: "True if this pass changed the artifact (new commits / rewritten files); false for a disposition-only or no-op pass." },
    summary: { type: "string", description: "One paragraph: what this pass did." },
    dispositions: {
      type: "array",
      description: "One entry per reviewer/peer finding this pass was handed. EVERY handed finding must appear — none may be silently dropped.",
      items: {
        type: "object",
        properties: {
          finding: { type: "string", description: "The finding, verbatim or by precise reference." },
          origin: { type: "string", description: "reviewer | peer" },
          disposition: { type: "string", description: "fixed | declined | escalated" },
          detail: { type: "string", description: "fixed: what changed + commit. declined: the reason (a decline is verified by the next fresh reviewer, never final here). escalated: one line naming the question." },
          questionId: { type: "string", description: "REQUIRED when disposition is `escalated`: the id of the openQuestions entry this raised." },
        },
        required: ["finding", "origin", "disposition", "detail"],
      },
    },
    openQuestions: { type: "array", items: CYCLE_OPEN_QUESTION_SCHEMA, description: "One entry per `escalated` disposition, in the pinned wire format." },
    deviations: { type: "array", items: { type: "string" }, description: "Each: a deviation from a LOCKED maintainer decision — what was delivered instead and the constraint that forced it. Report, don't correct; the cycle surfaces these for the human." },
    workReport: { type: "array", items: { type: "object" }, description: "One entry per work item in the scope, in the per-item shape the scope's instructions define (a consumer contract rides through here untyped); echoed into the cycle result." },
    proactive: { type: "string", description: "Same-pattern fixes made beyond the literal items, or empty." },
    finalSha: { type: "string", description: "HEAD sha after this pass, with everything committed." },
    clean: { type: "boolean", description: "True only if `git status --porcelain` is empty with every intended change committed." },
    artifactDir: { type: "string", description: "Absolute path of this cycle's unique artifact directory (round 1 creates it; later passes reuse it)." },
  },
  required: ["changed", "dispositions", "openQuestions", "deviations", "clean"],
};

const CYCLE_REVIEW_SCHEMA = {
  type: "object",
  properties: {
    pass: { type: "boolean", description: "True only if the artifact holds up per its type (build passes for code, every claim/disposition verified) and no material issue remains." },
    issues: {
      type: "array",
      description: "Numbered, actionable findings when pass is false. Empty when pass is true.",
      items: {
        type: "object",
        properties: {
          category: { type: "string", description: "criteria-gap | logic | error-handling | edge-case | dead-code | consistency | duplication | types | verbiage | scoping | conventions" },
          location: { type: "string", description: "file:line, or the item/section the finding concerns." },
          problem: { type: "string" },
          fix: { type: "string" },
        },
        required: ["category", "location", "problem", "fix"],
      },
    },
    emptyDiffFlag: { type: "boolean", description: "True if the diff against the base looked empty despite claimed work — signals a race/wrong-worktree, not real absence." },
    notes: { type: "string", description: "Pass-notes: caveats and stray remarks worth carrying. The cycle's final fixer pass disposes anything actionable here rather than letting it drop." },
  },
  required: ["pass", "issues"],
};

// Peer-stage result. `outcome` uses the peer-review-run vocabulary
// (powbox.peer-review-run/v1) so the eventual helper swap changes the prompt,
// not this contract.
const CYCLE_PEER_SCHEMA = {
  type: "object",
  properties: {
    outcome: { type: "string", description: "passed | issues | unavailable | timeout | forfeited | failed. Anything else is normalized to forfeited by the stage." },
    findings: {
      type: "array",
      description: "The peer's numbered findings when outcome is `issues`; empty otherwise.",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", description: "blocking | minor — BOTH gate the round." },
          location: { type: "string", description: "file:line" },
          claim: { type: "string", description: "The finding with its one-line rationale, verbatim." },
        },
        required: ["severity", "claim"],
      },
    },
    notes: { type: "string", description: "Anything after the verdict worth carrying (pass-notes), verbatim." },
    detail: { type: "string", description: "For a non-passed/issues outcome: why (logged out, timed out after retry, empty output, provider crash...)." },
  },
  required: ["outcome", "findings"],
};

const CYCLE_GROUNDING_SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          finding: { type: "string", description: "The finding checked, by its claim text." },
          grounded: { type: "boolean", description: "False ONLY for a self-evidently false claim or a nonexistent file:line reference. When in doubt, true — discarding is the exception." },
          why: { type: "string" },
        },
        required: ["finding", "grounded"],
      },
    },
  },
  required: ["verdicts"],
};

// Default worktree/branch contract when the consumer supplies none. A consumer
// with its own worktree lifecycle (wt-enter etc.) passes richer per-role
// contract text via cycle.contracts instead.
function cycleDefaultContract(cycle) {
  const where = cycle.worktree
    ? `Your worktree is \`${cycle.worktree}\`. Before anything else, \`cd\` into it and verify \`git rev-parse --show-toplevel\` prints exactly that path; if not, STOP and report — do not run any git or edit command outside it. Other agents may be working in other worktrees concurrently; stay in yours.`
    : `You work in the repository's current checkout — do NOT create a worktree and do NOT switch branches.`;
  return `${where}
You must be on branch \`${cycle.branch}\` — confirm with \`git branch --show-current\`; if it differs, STOP and report.`;
}

function cycleContract(cycle, role) {
  const contracts = cycle.contracts || {};
  return contracts[role] || cycleDefaultContract(cycle);
}

function cycleItemsBlock(cycle) {
  const items = cycle.scope && Array.isArray(cycle.scope.items) ? cycle.scope.items : [];
  return items.length ? `\n## Work items (verbatim)\n\n${JSON.stringify(items, null, 2)}\n` : "";
}

function cycleFindingsBlock(findings) {
  if (!findings) return "";
  const parts = [];
  if (Array.isArray(findings.reviewer) && findings.reviewer.length) {
    parts.push(`### Reviewer findings\n\n${JSON.stringify(findings.reviewer, null, 2)}`);
  }
  if (findings.reviewerNotes) {
    parts.push(`### Reviewer notes\n\n${findings.reviewerNotes}`);
  }
  if (Array.isArray(findings.peer) && findings.peer.length) {
    parts.push(`### Peer (codex) findings\n\n${JSON.stringify(findings.peer, null, 2)}`);
  }
  if (findings.peerNotes) {
    parts.push(`### Peer (codex) notes\n\n${findings.peerNotes}`);
  }
  return parts.length ? `\n## Findings to dispose (each given VERBATIM — reconcile overlap or conflict yourself)\n\n${parts.join("\n\n")}\n` : "";
}

function cycleFixPrompt(cycle, state) {
  const scope = cycle.scope || {};
  const roundIntro = state.confirming
    ? `The fresh reviewer has PASSED this cycle. This is the FINAL CONFIRMATION PASS of the disposition rule: read the passing reports below and dispose anything in them still worth acting on (pass-notes, stray remarks) — \`fixed\`, \`declined\` (with reason), or \`escalated\`. If nothing needs acting on, return \`changed: false\` with an empty \`dispositions\` array; that ends the cycle. Anything you fix or dispute will go through another reviewer round.`
    : state.findings
      ? `This is fix-up round ${state.round}. Address the findings below: dispose EVERY one explicitly — \`fixed\`, \`declined\` (with a reason; the next fresh reviewer verifies declines), or \`escalated\` to an open question in the pinned format. Never drop one silently, and never implement a fix you believe is wrong just to clear a finding.`
      : `This is round 1: carry out the assignment below.`;
  const artifactLine = state.artifactDir
    ? `This cycle's artifact directory is \`${state.artifactDir}\` — write this pass's packet prose (what you did, dispositions, question drafts) under it as \`round-${state.round}/\`.`
    : `Create this cycle's UNIQUE artifact directory first — outside the worktree, e.g. \`mktemp -d "\${TMPDIR:-/tmp}/review-cycle-${cycle.slug || "cycle"}.XXXXXX"\` (never a fixed shared name: parallel cycles share scratch space) — report it as \`artifactDir\`, and write this pass's packet prose under it as \`round-${state.round}/\`.`;
  return `You are the fixer for one review cycle (branch \`${cycle.branch}\`, review base \`${cycle.base}\`, artifact type ${cycle.artifactType}).

## WORKTREE CONTRACT (do this before anything else)

${cycleContract(cycle, "fixer")}

Read the repository's agent-context files (\`AGENTS.md\` / \`CLAUDE.md\`) first for conventions.

${roundIntro}

## Assignment

${scope.instructions || "Address the work items below."}
${cycleItemsBlock(cycle)}${cycleFindingsBlock(state.findings)}
## Rules

- ${artifactLine}
- Commit at logical milestones; run the project's build/lint before declaring done (code artifacts).
- If you must deliver something other than a decision the maintainer LOCKED, do not silently conform or correct: report it in \`deviations\` — what you delivered instead and the constraint that forced it. The cycle surfaces it for the human (report, don't correct).
- Every \`escalated\` disposition gets an \`openQuestions\` entry in the schema's pinned format, with authoritative artifact pointers (file:line, refs) — never paraphrase — and its \`questionId\` back-reference.
- Before returning, \`git status --porcelain\` MUST be empty with every intended change committed; set \`clean\` and \`finalSha\` accordingly. An unclean tree is resolved or reported as a \`blocker\`, never handed to review.
- Pushing is governed by the assignment above; do nothing PR-side, and do NOT use the \`TaskCreate\`/\`TaskUpdate\`/\`TaskList\` tools.

Return the structured packet, including \`workReport\` per the assignment's per-item contract when it defines one.`;
}

function cycleReviewChecks(artifactType) {
  if (artifactType === "prose") {
    return `This is a PROSE artifact (a drafted task file or document); there is no build to run. Check verbiage, scoping, internal consistency, and the repository's house conventions — for task files, the documented numbering style (see the tasks folder's AGENTS.md where present). Read each drafted file in full.`;
  }
  if (artifactType === "decision") {
    return `This is an APPLIED-DECISION diff. Verify the diff implements exactly the locked option and nothing beyond it, then do the quality pass (logic, error handling, edge cases, dead code, consistency, duplication, type safety) on the touched files. Run the build/type-check first; a failure is an automatic blocker.`;
  }
  return `This is a CODE artifact. Run the full build/type-check FIRST; a failure is an automatic blocker (\`pass: false\`). Check every acceptance criterion the work items state against the actual code, then do the quality pass (logic, error handling, edge cases, dead code, consistency, duplication, type safety) on the touched files, and confirm any claimed same-pattern sweep did not miss a sibling occurrence.`;
}

function cycleReviewPrompt(cycle, state) {
  const dispositionsBlock = state.packet && Array.isArray(state.packet.dispositions) && state.packet.dispositions.length
    ? `\n## Proposed finding dispositions (verify each; a \`declined\` must be technically justified, not a convenient dismissal — you may overrule it)\n\n${JSON.stringify(state.packet.dispositions, null, 2)}\n`
    : "";
  const workBlock = state.packet && Array.isArray(state.packet.workReport) && state.packet.workReport.length
    ? `\n## Fixer's per-item report (verify the claims hold in the committed state; you were NOT given its reasoning)\n\n${JSON.stringify(state.packet.workReport, null, 2)}\n`
    : "";
  return `You are an independent fresh-eyes reviewer for one review cycle (branch \`${cycle.branch}\`, review base \`${cycle.base}\`, artifact type ${cycle.artifactType}). You have no knowledge of how the work was built, and that is the point. Edit NOTHING; create, update, or delete no files; do not use the task-tracker tools.

## WORKTREE CONTRACT (do this before anything else)

${cycleContract(cycle, "reviewer")}

Read the repository's agent-context files (\`AGENTS.md\` / \`CLAUDE.md\`) first for conventions.

${cycleReviewChecks(cycle.artifactType)}

Scope with \`git diff --name-only ${JSON.stringify(cycle.base)}...HEAD\`, then read each touched file IN FULL — do not read commit messages or diff content (both anchor you to the fixer's intent); follow references into untouched files when needed. If the diff looks empty despite claimed work, set \`emptyDiffFlag\` and stop — that signals a wrong worktree/branch, not real absence.
${cycle.scope && cycle.scope.reviewInstructions ? `\n## Consumer review criteria (verify each item against these too)\n\n${cycle.scope.reviewInstructions}\n` : ""}${cycleItemsBlock(cycle)}${dispositionsBlock}${workBlock}
Return \`pass: true\` only if everything holds and no material issue remains; else \`pass: false\` with numbered, actionable \`issues\`. Be strict but fair — real gaps and functional problems, not style nits. Put pass-worthy caveats in \`notes\` (the cycle disposes them rather than dropping them).`;
}

// The peer invocation happens INSIDE this subagent prompt, never in the
// script (a workflow cannot shell out). Baseline destination: the
// `peer-review-run` helper (schema powbox.peer-review-run/v1) — retained
// pinned raw launch until powbox's review-strength passthrough lands; see the
// header comment. The launch pins review strength per invocation
// (-c model_reasoning_effort=high; the model stays the peer's configured
// high-capability default from ~/.codex/config.toml) and never writes back to
// saved configuration.
function cyclePeerPrompt(cycle, state) {
  const evidence = {
    branch: cycle.branch,
    base: cycle.base,
    artifactType: cycle.artifactType,
    reviewCriteria: (cycle.scope && cycle.scope.reviewInstructions) || "",
    items: (cycle.scope && cycle.scope.items) || [],
    dispositions: (state.packet && state.packet.dispositions) || [],
    workReport: (state.packet && state.packet.workReport) || [],
  };
  return `You run the best-effort cross-harness PEER REVIEW stage for one review-cycle round. You launch a read-only \`codex\` review of the committed state, wait for it, and return its result structurally. You NEVER fail this stage: every problem becomes a non-blocking outcome in the schema (\`unavailable\`, \`timeout\`, \`forfeited\`, \`failed\`) with a one-line \`detail\` — never an error, never a refusal to answer.

## WORKTREE CONTRACT

${cycleContract(cycle, "peer")}
The peer examines this worktree READ-ONLY; you edit nothing either.

## Steps

1. Preflight: if \`command -v codex\` fails, return outcome \`unavailable\` (detail: missing binary). If \`codex login status\` exits non-zero and \`CODEX_API_KEY\` is unset, return \`unavailable\` (detail: logged out). An auth/usage error from the launch itself is also \`unavailable\`.
2. Prepare unique per-attempt paths under this cycle's artifact directory: \`round_dir="${state.artifactDir || "<artifactDir>"}/round-${state.round}"\`, \`mkdir -p "$round_dir"\`, with \`prompt_file\`, \`outfile\`, \`stderr_file\` inside it (suffix \`-attempt2\` on a retry; never reuse a path).
3. Write the peer prompt below VERBATIM to \`$prompt_file\` with a quoted heredoc (\`<<'PEER_PROMPT'\`) — never assemble it through shell interpolation.
4. Launch the peer as ONE supervised foreground call, bounded UNDER your own Bash tool limit so the tool can never kill it mid-run unaccounted (set the Bash tool timeout to 600000 ms and bound the peer tighter with \`timeout\`):

   \`\`\`bash
   worktree="<the worktree path from the contract above>"
   # Pin peer effort per invocation; never changes the container's saved config.
   timeout 540 codex exec --sandbox read-only --cd "$worktree" -o "$outfile" \\
     -c mcp_servers={} -c model_reasoning_effort=high "$(<"$prompt_file")" \\
     < /dev/null 2> "$stderr_file"
   \`\`\`

   Exit 124 means the bounded timeout fired: retry ONCE with fresh attempt paths, then return outcome \`timeout\`. Any other failure (crash, non-zero exit with no usable output): retry once, then return \`failed\`. Auth/usage errors: \`unavailable\` without retry.
5. Read \`$outfile\`. A \`VERDICT: PASS\` line → outcome \`passed\` (anything after it goes to \`notes\` verbatim). A \`VERDICT: ISSUES\` line → outcome \`issues\`, with every numbered finding mapped verbatim into \`findings\` (severity from its \`blocking\`/\`minor\` tag — default \`blocking\` when untagged — plus its \`file:line\` as \`location\` and the finding text as \`claim\`; do not summarize, merge, or rewrite). No verdict line, or empty/unintelligible output → \`forfeited\`.

## Peer prompt (write this text to the prompt file verbatim, filling only the placeholders)

You are an independent read-only peer reviewer. Review the committed state of branch ${JSON.stringify(cycle.branch)} against base ${JSON.stringify(cycle.base)} in the current directory (artifact type: ${cycle.artifactType}). Read the actual files; edit nothing; run no builds or tests. Verify the work items and any proposed dispositions below in the committed code; a declined finding must be technically justified. Evidence (verbatim):

${JSON.stringify(evidence, null, 2)}

Reply with exactly \`VERDICT: PASS\` or \`VERDICT: ISSUES\`, followed for issues by numbered findings each tagged \`blocking\` or \`minor\`, with \`file:line\` and a one-line rationale.

## Output

Return the structured result: \`outcome\`, \`findings\` (verbatim, tagged), \`notes\`, \`detail\`.`;
}

// The peer stage NEVER fails the round: a dead subagent (null return /
// schema-validation miss), a thrown stage, and every helper-vocabulary outcome
// that is not passed/issues all normalize to a recorded non-blocking outcome.
// The normalization is written as a complement (anything not passed/issues is
// non-blocking), so `failed` — and any future outcome — cannot fall through a
// switch over the named ones.
function normalizeCyclePeerResult(res) {
  if (!res || typeof res !== "object") {
    return { outcome: "forfeited", findings: [], notes: "", detail: "peer subagent returned nothing (died or failed schema validation); recorded non-blocking" };
  }
  const gating = res.outcome === "passed" || res.outcome === "issues";
  const known = ["passed", "issues", "unavailable", "timeout", "forfeited", "failed"];
  const outcome = known.includes(res.outcome) ? res.outcome : "forfeited";
  return {
    outcome,
    findings: outcome === "issues" && Array.isArray(res.findings) ? res.findings : [],
    notes: typeof res.notes === "string" ? res.notes : "",
    detail: typeof res.detail === "string" && res.detail
      ? res.detail
      : (gating ? "" : `peer outcome ${JSON.stringify(res.outcome)} recorded non-blocking`),
  };
}

async function runCyclePeerStage(cycle, state) {
  if (cycle.peer === "off") {
    return { outcome: "disabled", findings: [], notes: "", detail: "peer-opinions=off" };
  }
  try {
    const res = await agent(cyclePeerPrompt(cycle, state), {
      label: `${cycle.labelPrefix || ""}peer#${state.round}`,
      schema: CYCLE_PEER_SCHEMA,
      phase: CYCLE_PEER_PHASE,
    });
    return normalizeCyclePeerResult(res);
  } catch (e) {
    // A thrown stage must not drop the round (or, under pipeline(), the item).
    return { outcome: "forfeited", findings: [], notes: "", detail: `peer stage threw (${e && e.message ? e.message : String(e)}); recorded non-blocking` };
  }
}

function cycleGroundingPrompt(cycle, findings) {
  return `Cheap grounding spot-check, read-only. The fresh reviewer PASSED this round; only the peer findings below would gate it. For each, check that its \`file:line\` (or referenced site) exists in the worktree and that the claim is not self-evidently false. Do NOT re-review or judge severity — discard is only for nonexistent references and self-evidently false claims; when in doubt, \`grounded: true\`.

${cycleContract(cycle, "reviewer")}

## Findings

${JSON.stringify(findings, null, 2)}

Return a verdict per finding. Edit nothing.`;
}

// runReviewCycle — the whole protocol as one awaitable function.
//
// cycle: {
//   slug, worktree, branch, base, artifactType ("code"|"prose"|"decision"),
//   scope: { title, instructions, items },
//   maxRounds (validated through cycleRoundCap), peer ("on"|"off"),
//   mode ("full"|"light"),
//   contracts: { fixer, reviewer, peer } — optional per-role preamble text
//     (a worktree-lifecycle consumer passes its own wt-enter contract here),
//   labelPrefix — optional, prefixes agent labels for fan-out consumers.
// }
//
// Returns the cycle result contract (lean; bulk prose stays behind artifactDir):
// { verdict: "pass"|"review-cap"|"error", detail, rounds, findingDispositions,
//   openQuestions, deviations, workReport, proactive, finalSha, notes,
//   reviewerNotes, peerRounds, discardedPeerFindings, undisposed, outstanding,
//   artifactDir }
async function runReviewCycle(cycle) {
  const cap = cycleRoundCap(cycle.maxRounds);
  const lp = cycle.labelPrefix || "";
  const findingDispositions = [];
  const openQuestions = [];
  const deviations = [];
  const peerRounds = [];
  const discardedPeerFindings = [];
  let artifactDir = "";
  let packet = null;
  let rounds = 0;
  let fixerPasses = 0;
  let findings = null; // findings block for the next fixer pass; null on round 1
  let confirming = false; // next fixer pass is the final confirmation pass
  let peerUnavailable = false; // sticky: an unavailable peer is not re-probed every round
  let reviewerNotes = ""; // the latest reviewer's pass-notes (PR-body caveats for consumers)

  const result = (verdict, detail, extra) => ({
    verdict,
    detail: detail || "",
    rounds,
    findingDispositions,
    openQuestions,
    deviations,
    workReport: (packet && packet.workReport) || [],
    proactive: (packet && packet.proactive) || "",
    finalSha: (packet && packet.finalSha) || "",
    notes: (packet && packet.summary) || "",
    reviewerNotes,
    peerRounds,
    discardedPeerFindings,
    artifactDir,
    ...(extra || {}),
  });

  while (true) {
    fixerPasses += 1;
    const fix = await agent(cycleFixPrompt(cycle, { round: fixerPasses, findings, confirming, artifactDir }), {
      label: `${lp}fix#${fixerPasses}`,
      schema: CYCLE_FIX_SCHEMA,
    });
    if (!fix) return result("error", `fixer returned nothing on pass ${fixerPasses}`);
    if (fix.blocker) return result("error", `fixer blocked on pass ${fixerPasses}: ${fix.blocker}`);
    if (!fix.clean) return result("error", `fixer left an unclean worktree on pass ${fixerPasses}; refusing to review a partial state`);
    if (fix.artifactDir) artifactDir = fix.artifactDir;
    for (const d of fix.dispositions || []) findingDispositions.push({ ...d, pass: fixerPasses });
    for (const q of fix.openQuestions || []) openQuestions.push(q);
    for (const dev of fix.deviations || []) deviations.push(dev);
    if (fix.workReport || fix.finalSha || fix.summary || fix.proactive) packet = { ...(packet || {}), ...fix };

    // Terminal condition of the disposition rule: the reviewer has passed and
    // the fixer's last pass disposed nothing new (and changed nothing that
    // would need a fresh review). Nothing left for a reviewer to look at.
    if (confirming && !fix.changed && (fix.dispositions || []).length === 0) {
      return result("pass", "reviewer passed; final confirmation pass disposed nothing new");
    }

    // Anything else needs a (re-)review — bounded by the cap. This check is
    // reachable at the cap only through a confirmation pass that changed
    // content (a FAILED round at the cap returns below, before another fixer
    // could run and leave never-reviewed changes behind).
    if (rounds >= cap) {
      return result("review-cap", `hit the ${cap}-round cap without convergence`, {
        outstanding: { note: "final confirmation pass changed content that could not be re-reviewed within the cap" },
      });
    }
    rounds += 1;

    const state = { round: rounds, packet: fix, artifactDir };
    const review = await agent(cycleReviewPrompt(cycle, state), {
      label: `${lp}review#${rounds}`,
      schema: CYCLE_REVIEW_SCHEMA,
    });
    const peer = peerUnavailable
      ? { outcome: "unavailable", findings: [], notes: "", detail: "peer marked unavailable earlier this cycle" }
      : await runCyclePeerStage(cycle, state);
    peerRounds.push({ round: rounds, outcome: peer.outcome, detail: peer.detail });
    if (peer.outcome === "unavailable") peerUnavailable = true;

    if (!review) return result("error", `reviewer returned nothing on round ${rounds}`);
    if (review.emptyDiffFlag) return result("error", `reviewer saw an empty diff on round ${rounds} (likely wrong worktree/branch)`);
    reviewerNotes = review.notes || "";

    // Gate: reviewer must pass, and BOTH blocking and minor grounded peer
    // findings gate. Every non-passed/issues peer outcome is non-blocking.
    let peerGating = peer.outcome === "issues" ? peer.findings : [];
    if (review.pass && peerGating.length) {
      // Grounding spot-check — only when the reviewer passed and peer findings
      // alone would gate. Discard is the one path a finding leaves the cycle
      // without a fixer disposition, and it is noted.
      const ground = await agent(cycleGroundingPrompt(cycle, peerGating), {
        label: `${lp}ground#${rounds}`,
        schema: CYCLE_GROUNDING_SCHEMA,
        effort: "low",
      });
      if (ground && Array.isArray(ground.verdicts)) {
        const ungrounded = ground.verdicts.filter((v) => v && v.grounded === false);
        if (ungrounded.length) {
          for (const u of ungrounded) discardedPeerFindings.push({ round: rounds, finding: u.finding, why: u.why || "" });
          const dropped = new Set(ungrounded.map((v) => v.finding));
          peerGating = peerGating.filter((f) => !dropped.has(f.claim));
        }
      }
    }

    const roundPassed = !!review.pass && peerGating.length === 0;
    if (!roundPassed) {
      confirming = false;
      findings = {
        reviewer: review.issues || [],
        reviewerNotes: review.notes || "",
        peer: peerGating,
        peerNotes: peer.notes || "",
      };
      // A failed round at the cap stops HERE — no further fixer pass may run,
      // or its changes would land committed but never reviewed.
      if (rounds >= cap) {
        return result("review-cap", `hit the ${cap}-round cap without convergence`, { outstanding: findings });
      }
      continue;
    }

    // Round passed. light mode ends here, recording undisposed remarks as such.
    if (cycle.mode === "light") {
      const undisposed = [review.notes, peer.notes].filter(Boolean);
      return result("pass", "reviewer passed (light mode: final confirmation pass skipped)", { undisposed });
    }

    // Full mode: one final fixer confirmation pass over the passing reports, so
    // pass-notes get considered by an agent with full context, never dropped by
    // the orchestrator. If it disposes nothing new, the loop terminates above;
    // anything it fixes or disputes goes through another reviewer round.
    confirming = true;
    findings = {
      reviewer: [],
      reviewerNotes: review.notes || "(no notes — confirm nothing in the passing reports needs acting on)",
      peer: [],
      peerNotes: peer.notes || "",
    };
  }
}

// ============================================================================
// END EMBEDDABLE SECTION: review-cycle-core
// ============================================================================

const SCOPE_SCHEMA = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    blocker: { type: "string", description: "Why the cycle cannot start (nothing to review, ambiguous target, dirty unrelated state). Empty when ok." },
    worktree: { type: "string", description: "Absolute path of the checkout under review, or empty for the current checkout." },
    branch: { type: "string" },
    base: { type: "string", description: "Effective review base ref (what the diff is scoped against)." },
    slug: { type: "string", description: "Short ref-safe identifier for this cycle (drives artifact naming)." },
    artifactType: { type: "string", description: "code | prose | decision — from the request, else judged from the target (default code)." },
    items: { type: "array", items: { type: "object" }, description: "The work item(s) verbatim (a task file's content, the change description, the decision text). May be empty for a bare 'review this change'." },
    instructions: { type: "string", description: "Round-1 assignment for the fixer: e.g. 'commit the current uncommitted change as given (no rewriting) so review runs against committed state', or 'the drafted files are already committed; confirm and proceed'." },
  },
  required: ["ok"],
};

function scopePrompt(input) {
  return `You are scoping one review cycle. Read the repository's agent-context files (\`AGENTS.md\` / \`CLAUDE.md\`) first. This is scoping only — edit nothing, commit nothing.

Request (lenient parsing — free word order): ${JSON.stringify(input)}
Recognized tokens (already handled by the caller, listed for context): \`light\`, \`peer-opinions=off\`, \`artifact-type: code|prose|decision\`, \`max-rounds=N\`. Everything else describes the TARGET.

Resolve the target: an explicit worktree path, branch, diff range, or file set — else the current checkout's uncommitted change or unpushed branch. Determine the branch, the effective review base (the ref the work should be diffed against — the branch's merge target, or for an uncommitted change the current HEAD's branch point), a short ref-safe \`slug\`, the \`artifactType\` (code unless the target is a drafted task/doc file set → prose, or an applied decision's diff → decision), the work \`items\` verbatim where the target names any (task file content, decision text), and round-1 \`instructions\` for the fixer (for an uncommitted ad-hoc change: commit it as given, no rewriting, so review runs against committed state).

If there is nothing to review or the target is genuinely ambiguous, return \`ok: false\` with a \`blocker\`.`;
}

// --- Input handling: structured object (nesting) or lenient prose (drop-in) ---
function flattenCycleArgs(a) {
  if (a == null) return "";
  if (typeof a === "string") return a;
  if (Array.isArray(a)) return a.map(flattenCycleArgs).join(" ");
  if (typeof a === "object") return Object.values(a).map(flattenCycleArgs).join(" ");
  return String(a);
}

const structured = args && typeof args === "object" && !Array.isArray(args) && (args.worktree != null || args.scope != null || args.branch != null);
const rawArgs = structured ? "" : flattenCycleArgs(args);
const lowerArgs = rawArgs.toLowerCase();

const peerOff = structured
  ? args.peer === "off" || /\bpeer[\s-]*opinions?\s*=\s*off\b/.test(flattenCycleArgs(args).toLowerCase())
  : /\bpeer[\s-]*opinions?\s*=\s*off\b/.test(lowerArgs);
const lightMode = structured ? args.mode === "light" : /\blight\b/.test(lowerArgs);
let requestedRounds = structured ? args.maxRounds : null;
if (!structured) {
  const m = lowerArgs.match(/\bmax[\s-]*rounds\s*[=:]\s*(-?\d+(?:\.\d+)?)\b/);
  if (m) requestedRounds = Number(m[1]);
}
let artifactTypeToken = structured ? args.artifactType : null;
if (!structured) {
  const t = lowerArgs.match(/\bartifact[\s-]*type\s*[=:]?\s*(code|prose|decision)\b/) || lowerArgs.match(/\b(prose|decision)\b/);
  if (t) artifactTypeToken = t[1];
}

// Validate the cap up front — an invalid value is a caller contract violation,
// rejected before any agent runs (cycleRoundCap throws with a clear message).
const roundCap = cycleRoundCap(requestedRounds);

phase("Scope");
let cycleConfig;
if (structured) {
  cycleConfig = {
    slug: (args.scope && args.scope.title) || args.branch || "cycle",
    worktree: args.worktree || "",
    branch: args.branch,
    base: args.base,
    artifactType: artifactTypeToken || "code",
    scope: args.scope || {},
    maxRounds: roundCap,
    peer: peerOff ? "off" : "on",
    mode: lightMode ? "light" : "full",
    contracts: args.contracts,
    labelPrefix: "",
  };
  if (!cycleConfig.branch || !cycleConfig.base) {
    return { error: "Structured invocation needs at least { branch, base } (plus scope/worktree as applicable)." };
  }
} else {
  const scoped = await agent(scopePrompt(rawArgs), { label: "scope", schema: SCOPE_SCHEMA });
  if (!scoped) return { error: "Scope agent returned nothing." };
  if (!scoped.ok) return { error: "Nothing to cycle.", blocker: scoped.blocker || "(unspecified)" };
  if (!scoped.branch || !scoped.base) {
    return { error: "Scope succeeded but returned incomplete target metadata (need branch and base).", scoped };
  }
  cycleConfig = {
    slug: scoped.slug || scoped.branch,
    worktree: scoped.worktree || "",
    branch: scoped.branch,
    base: scoped.base,
    artifactType: artifactTypeToken || scoped.artifactType || "code",
    scope: { title: scoped.slug || "", instructions: scoped.instructions || "", items: scoped.items || [] },
    maxRounds: roundCap,
    peer: peerOff ? "off" : "on",
    mode: lightMode ? "light" : "full",
    labelPrefix: "",
  };
}

phase("Review cycle");
const cycleResult = await runReviewCycle(cycleConfig);

phase("Summary");
log(`review-cycle ${cycleConfig.slug}: ${cycleResult.verdict} after ${cycleResult.rounds} reviewer round(s); ${cycleResult.openQuestions.length} open question(s); peer: ${cycleResult.peerRounds.map((p) => p.outcome).join(", ") || "n/a"}.`);
return {
  target: { slug: cycleConfig.slug, worktree: cycleConfig.worktree, branch: cycleConfig.branch, base: cycleConfig.base, artifactType: cycleConfig.artifactType },
  mode: cycleConfig.mode,
  peer: cycleConfig.peer,
  ...cycleResult,
};
