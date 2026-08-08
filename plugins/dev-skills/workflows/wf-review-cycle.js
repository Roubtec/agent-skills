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
 *    throttle sit in one flat script's state. Such an owner can also hand
 *    every embedded cycle ONE shared `cycle.peerState` object, so the peer
 *    preflight runs once for the whole batch and unavailability sticks
 *    batch-wide (see runReviewCycle).
 *
 * Workflow rendering of the peer stage
 * ------------------------------------
 * A workflow cannot shell out — agent()/parallel()/pipeline()/log()/phase()
 * are its entire surface — so the peer invocation happens INSIDE a subagent
 * prompt, never in the script. The stage launches BESIDE the fresh reviewer
 * through parallel(), the canonical concurrent launch (the examination-only
 * peer is the protocol's sole same-checkout concurrency exception), and its
 * install/login preflight runs once per run, not per round. The stage's
 * agent() call is schema-validated, and a peer subagent can never fail the
 * stage: a null agent() return, a schema-validation miss, a thrown stage, and
 * every outcome that is not passed/issues all land as a recorded non-blocking
 * round outcome. The peer is never required for the cycle to conclude.
 *
 * The peer's baseline interface is powbox's `peer-review-run` helper (result
 * schema powbox.peer-review-run/v1) — but NOT YET, and only for the MODEL
 * dimension. The effort half already works: the helper takes `--model` and
 * `--effort`, defaults effort to `high` for BOTH providers, re-injects
 * `-c model_reasoning_effort=<effort>` in its codex adapter specifically to
 * survive that adapter's own `--ignore-user-config`, and reports the strength
 * it actually applied as `model`/`effort` in its result — which is the
 * reporting half this stage asked for. What it still cannot carry is the codex
 * peer's CONFIGURED high-capability model: `--ignore-user-config` discards
 * ~/.codex/config.toml, the source of that model, and the helper's own
 * `--model` default (`opus`) applies to claude only, so a codex peer launched
 * through it runs on the CLI's bare default; naming a concrete codex ID instead
 * is barred by the never-dated-model-IDs rule. Until powbox carries that
 * configured model through, the stage's subagent runs the PINNED RAW LAUNCH
 * (codex exec with `-c model_reasoning_effort=medium`; the model stays the
 * peer's configured high-capability default from ~/.codex/config.toml). When it
 * lands, the swap to `peer-review-run --provider codex --worktree ...
 * --prompt-file ... --artifact-root ... --timeout N --effort medium` (flag
 * spelling transcribed from the shipped helper, with --timeout sized under the
 * subagent's own Bash-tool limit, and --effort stated explicitly because the
 * helper's own default is `high`) is task 015's; the outcome vocabulary below
 * already matches the helper's, so the swap is a prompt change, not a
 * control-flow change.
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
  whenToUse: "Run a local fix->review->peer->fix cycle — review is cross-harness, a best-effort codex peer beside the fresh reviewer — on a worktree, branch, diff, or drafted task file before a PR exists, or consume it from another workflow by nesting or by embedding its marked section. Not for addressing PR review threads (wf-address-review) or task batches (wf-address-tasks); those consume this cycle themselves.",
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
// The section depends only on the workflow runtime globals (agent, parallel,
// log) plus plain JS; it holds no module state, so a fan-out owner embedding
// it keeps every launch it makes in that owner's own flat script state.
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

// Shell-quote a ref before embedding it in a copy-paste command these prompts
// emit. Git ref names forbid spaces but little else, so a branch or base
// carrying `$`, a backtick, or `;` — legal, and reachable from a task-derived
// name — would still expand or run inside the DOUBLE quotes `JSON.stringify`
// produces, scoping the review against the wrong ref or executing something
// unintended. Single-quote instead and escape embedded quotes; adjacent quoted
// spans like `feat/'b'` concatenate into one shell word, so the ref resolves.
// Prefixed `cycle` like the rest of this section: a consumer synthesizing the
// section into its own flat script may already define its own `shq`.
function cycleShq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

// Reduce a slug to ONE filesystem path segment before it lands in the artifact
// directory template. The slug is routinely a branch name — the fallback on
// both entry paths (`args.branch` structured, `scoped.branch` from scoping),
// and "ref-safe" admits `/` — which `mktemp -d ".../review-cycle-<slug>.XXXXXX"`
// reads as a parent directory that does not exist, failing the pass outright.
// Quoting cannot help here: `cycleShq` stops the shell mangling the value, not
// the path splitting on it. The rest of the filter is readability and defense
// in depth (a `$` splits no path), the length is bounded so the name stays
// well inside NAME_MAX, and an all-punctuation slug falls back to `cycle`.
// The `cycleShq` wrapper stays around the result: quoting every interpolated
// value is this section's uniform rule, so a later loosening of this filter
// cannot silently reintroduce an injection.
function cycleSlugSegment(s) {
  const seg = String(s == null ? "" : s)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .slice(0, 48)
    .replace(/^[-._]+|[-._]+$/g, "");
  return seg || "cycle";
}

// Pinned wire format for escalated open questions. It maps one-to-one onto the
// four-part brief `resolve-open-questions` serves (grounded context, concrete
// trigger, distinct options, recommendation), so a completed cycle's questions
// are consumable without re-derivation — that skill still re-verifies every
// carried claim (reachability especially) against current state before serving.
// A question a later pass SETTLES is MARKED, never dropped: the cycle stamps a
// `retired` object ({ pass, disposition, findingId, detail }) onto the
// accumulated entry, so the result still shows the question was raised and why
// it stopped needing an answer. The claim lands as `retirementPending` first
// and becomes `retired` only once a reviewer round PASSES with it in view — so
// a claim no reviewer accepted, including on the error and round-cap exits
// that never reach such a round, cannot read as settled to a consumer that
// skips retired questions. Both marks are script-applied and deliberately NOT
// schema properties — a fixer states a retirement through its disposition's
// `retiresQuestionIds`, never by self-marking a question it emits, and a
// volunteered mark of either kind is stripped where questions are accumulated.
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
      description: "EXACTLY one entry per reviewer/peer finding this pass was handed. EVERY handed finding must appear once — coverage is checked structurally by `findingId`; an uncovered finding, a finding given duplicate dispositions, and a disposition naming an id that was never handed all carry back to the next pass.",
      items: {
        type: "object",
        properties: {
          findingId: { type: "string", description: "The handed finding's `id`, echoed exactly — this is how coverage is verified. Omit only for a spontaneous disposition (e.g. of a pass-note), which has no handed id." },
          finding: { type: "string", description: "The finding, verbatim or by precise reference." },
          origin: { type: "string", description: "reviewer | peer" },
          disposition: { type: "string", description: "fixed | declined | escalated — nothing else counts as a disposition." },
          detail: { type: "string", description: "fixed: what changed + commit. declined: the reason (a decline is verified by the next fresh reviewer, never final here). escalated: one line naming the question." },
          questionId: { type: "string", description: "MUST be set when disposition is `escalated`: the id of the openQuestions entry this raised. It must name a question the cycle carries LIVE — the one this pass raises, or one an earlier pass raised that no retirement has claimed. An absent, empty, or already-retired id names no decision the maintainer will be asked to make and is reported back, never a silent no-op." },
          retiresQuestionIds: { type: "array", items: { type: "string", minLength: 1 }, description: "Ids of STILL-LIVE open questions from EARLIER passes that this disposition SETTLES, so the cycle stops carrying decisions the maintainer no longer has to make. Only `fixed` and `declined` retire (an `escalated` disposition raises a question rather than settling one), and only a question that was already open: a question this same packet RAISES cannot also be settled by it — that is a contradiction, not a retirement. Naming an id the cycle does not carry open from an earlier pass — an empty string included, which names nothing — is reported back, never a silent no-op. Retire nothing you did not actually settle: the retirement takes effect only once a reviewer round passes with it in view." },
        },
        required: ["finding", "origin", "disposition", "detail"],
      },
    },
    openQuestions: { type: "array", items: CYCLE_OPEN_QUESTION_SCHEMA, description: "One entry per `escalated` disposition, in the pinned wire format." },
    deviations: { type: "array", items: { type: "string" }, description: "Each deviation from a LOCKED maintainer decision that STILL STANDS after this pass — what was delivered instead and the constraint that forced it. Report, don't correct; the cycle surfaces these for the human. Restate every standing one on every pass — VERBATIM, since the cycle matches these by exact text and a reworded restatement reads as a drop plus a brand-new deviation — and leave out only one that genuinely no longer stands: the result describes the FINAL state and keeps the per-pass reports as history." },
    workReport: { type: "array", items: { type: "object" }, description: "One entry per work item in the scope, in the per-item shape the scope's instructions define (a consumer contract rides through here untyped); echoed into the cycle result." },
    proactive: { type: "string", description: "Same-pattern fixes made beyond the literal items, or empty." },
    finalSha: { type: "string", description: "HEAD sha after this pass, with everything committed." },
    clean: { type: "boolean", description: "True only if the worktree is CLEAN and IDLE: `git status --porcelain` empty with every intended change committed, AND no Git operation in progress (`git rev-parse --git-path rebase-merge` / `rebase-apply`, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG`). A packet returned mid-rebase or mid-cherry-pick can print empty porcelain; the cycle refuses it either way." },
    artifactDir: { type: "string", description: "Absolute path of this cycle's unique artifact directory — REQUIRED every pass: round 1 creates it (outside the worktree) and reports it, later passes echo the directory they were given. The result contract promises full round history reachable through it." },
  },
  required: ["changed", "dispositions", "openQuestions", "deviations", "clean", "artifactDir"],
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
    deviationAssessments: {
      type: "array",
      description: "Your half of report-don't-correct: ONE entry per deviation from a LOCKED decision that still stands on this packet (every one you were shown except the claimed drops you accept). Empty when the packet carries none. A round that leaves a standing deviation unassessed does NOT pass — it would reach the maintainer carrying only the implementer's half. Exactly one usable entry per deviation is published: a second entry for a deviation already assessed, and any entry the round cannot use, is dropped rather than sent on beside the usable one — a hedge here buys nothing.",
      items: {
        type: "object",
        properties: {
          deviation: { type: "string", description: "The deviation's text, copied VERBATIM from the list you were shown — the cycle matches it by exact text." },
          inSpecRoute: { type: "string", description: "Whether a route inside the locked decision existed, and which one — the first thing the maintainer's ratify-or-conform call needs." },
          recommendation: { type: "string", description: "Your verdict as the FIRST word — RATIFY or CONFORM, the whole vocabulary — then the one-line reason. A hedge (`UNSURE`, `needs investigation`) is not a verdict and leaves the deviation unassessed, which does not pass the round. The first word is taken literally, so do not open with both — `RATIFY or CONFORM …` is read as RATIFY; lead with neither if you cannot choose. You recommend; the maintainer decides." },
        },
        required: ["deviation", "inSpecRoute", "recommendation"],
      },
    },
  },
  required: ["pass", "issues"],
};

// The recommendation is a two-valued VERDICT carrying a reason, not free prose:
// what reaches the maintainer is a ratify-or-conform list. Reading it as
// present-or-absent left, one level down, the same hole the structural field
// closed one level up — `UNSURE — needs investigation` is schema-valid and
// trims to something non-empty, so it would count as the reviewer's half while
// answering the only question that half exists to answer. So the verdict is
// parsed, and must LEAD the string exactly as the schema and the brief ask.
// Leading rather than merely occurring, because a reason may legitimately name
// the other verdict ("RATIFY — conforming would cost a release") and an
// occurrence test would have to reject that.
//
// What the rule buys is stated exactly, because the crude version is the one
// worth having: the FIRST word decides, and a string opening with neither
// verdict is not a verdict. It does NOT catch a hedge that opens with one and
// then retracts it — `RATIFY or CONFORM — needs investigation` reads as RATIFY
// — which is why the schema and the brief warn the reviewer that the first word
// is taken literally. Nothing here can separate that string from `RATIFY —
// CONFORM costs a release`, a real choice whose reason names the other verdict;
// a rule rejecting the first would reject the second, and the maintainer reads
// the whole `recommendation` text either way.
const CYCLE_DEVIATION_VERDICTS = ["RATIFY", "CONFORM"];
function cycleDeviationVerdict(recommendation) {
  // Leading punctuation and emphasis are stripped, so `**RATIFY** — …` reads as
  // the verdict it plainly is. A longer word that merely starts with one does
  // not: the character after the verdict must not continue it.
  const text = String(recommendation || "").trim().toUpperCase().replace(/^[^A-Z]+/, "");
  return CYCLE_DEVIATION_VERDICTS.find((v) => text.startsWith(v) && !/[A-Z]/.test(text.charAt(v.length))) || "";
}

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

// What a subagent of this cycle may run, and what it may not — carried by every
// command-running prompt the section composes: fixer, reviewer, peer, grounding.
// A reviewer subagent authorized to verify a claim empirically once ran
// `rm -rf ./*` in a shared main checkout: its setup clone had failed invisibly
// inside a pipeline under `set -e` (a pipeline's status is its last command), so
// it was still at the repository root while believing it stood in a clone. Kept
// OUT of cycleDefaultContract deliberately: a consumer with its own worktree
// lifecycle overrides the contract via cycle.contracts and would otherwise drop
// the boundary along with it. The peer stage carries it like the rest: its
// `codex exec --sandbox read-only` constrains the CODEX process, not the
// subagent that composes and launches it, which has an unrestricted shell.
const CYCLE_DESTROY_BOUNDARY = `## DESTROY BOUNDARY

Permitted: reading, searching, and read-only \`git\`/\`gh\` queries — plus, where the contract above authorizes it, edits, commits, and pushes confined to the worktree and branch it names.
Forbidden: \`rm -rf\`, \`git reset --hard\`, \`git clean\`, \`git branch -f\`, \`git update-ref\`, \`git gc\`, and force-pushing — each of them beyond what this assignment itself spells out, whether as an exact command or as a skill it names to invoke — NOT in a clone, NOT in a temp directory, NOT "safely". You may not self-authorize one by putting yourself somewhere you believe is safe; what this assignment spells out, and the disposable clone below, are the only exemptions — and only because this assignment names them, not because a clone is safe.
A worktree is not a blast radius: it isolates the working tree, not the repository, so \`branch -f\`, \`reset\`, \`update-ref\`, and \`gc\` reach every sibling worktree through the shared \`.git\`.
Empirical verification that could change state belongs ONLY in a disposable clone. Run \`command -v dc-enter\`; where it is found, work in \`DC="$(dc-enter <slug>)"\` — it prints one absolute path on stdout, \`dc-remove <slug>\` drops it, and a reused slug is REFUSED rather than re-derived, so pass \`--replace\` or remove the slug first if this may run twice. Where the helper is absent, use an absolute path outside the repository — never a relative one, and never the repository itself.`;

// Where a role's redirected output goes. Every cycle brief that orders a build
// orders one whose output the role may want in a file, and a role left to pick
// its own path picks the session scratchpad: two concurrent reviewers both
// redirected their build output to `<scratchpad>/verify.log` there once, and
// one read the other worktree's results and returned a verdict for the wrong
// branch. The brief names the destination rather than leaving it to be chosen.
const CYCLE_REDIRECTED_OUTPUT = "Any build or validation output you redirect to a file goes under that same round directory, under any name you like — never a fixed shared scratchpad name: parallel cycles share one scratch directory.";

// Provenance of a brief's claims, carried by the fixer, reviewer, and peer
// briefs alike. Two claims relayed from an earlier round were wrong in a real
// run and reached a maintainer decision; only roles told to re-derive caught it.
const CYCLE_CARRIED_CLAIMS = "Provenance: only what you verify against the committed tree yourself is established this turn. Every finding, disposition, open question, and citation relayed to you here is CARRIED — not verified this turn, whatever its source; it may be stale, or have been wrong when written — so re-derive one before you rely on it.";

// Subagent lifecycle, carried by every role that can start a process. A subagent
// is never resumed, so one that ended its turn "waiting for the monitor
// notification" from a background child it had launched left a dirty worktree
// and no packet until the orchestrator hunted the child down by hand.
const CYCLE_FINISH_IN_TURN = "Finish inside your own turn: nothing resumes you afterwards, so never end it waiting for a notification, a callback, or a child you started. Bound and wait on anything you launch, and reap it before you return — no process of yours may outlive your turn.";

// On top of that, for every role except the peer stage itself: an implementer
// that launched its own detached second opinion outlived it, orphaned, and
// wandered into an unrelated sibling worktree for want of a tight working dir.
const CYCLE_NO_SELF_PEER = "The cycle runs the sanctioned second opinion itself, beside the reviewer — do not launch a peer review of your own.";

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
  if (Array.isArray(findings.carried) && findings.carried.length) {
    parts.push(`### Findings carried forward — the previous pass gave these NO single valid disposition (missing \`findingId\`, duplicate dispositions for one id, an unrecognized disposition value, an \`escalated\` naming no live open question — including one that same pass retired, which settles a decision rather than escalating to it — or, for a \`disposition-error\` entry, a disposition naming a finding id never handed, a retirement that settled nothing, or a spontaneous \`escalated\` disposition whose \`questionId\` names no live question). Dispose EVERY one now, exactly one disposition each, echoing its \`id\` as \`findingId\`.\n\n${JSON.stringify(findings.carried, null, 2)}`);
  }
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
  return parts.length ? `\n## Findings to dispose (each given VERBATIM — reconcile overlap or conflict yourself)\n\nWhere the reviewer and the peer name the SAME fact and differ only in whether it gates, the two channels agree on the substance and split on severity: dispose it on the merits and say which way, rather than re-litigating a fact neither disputes. Framing only — the gate is unchanged, and a grounded finding keeps its full force.\n\n${parts.join("\n\n")}\n` : "";
}

// The still-live open questions, shown to every fixer pass after the one that
// raised them. Without this block the fixer has no ids to name, so a question a
// later pass settles could never be retired — the whole point of the field.
// Omitted is every question a retirement already claims — settled (`retired`)
// or still awaiting the reviewer round that decides it (`retirementPending`):
// the claim stands either way, and a second one would only duplicate it.
// That omission is also why the block says outright that a claim cannot be
// withdrawn: there is no channel for a later pass to retract one (the question
// leaves this list the moment it is claimed, so no later disposition can even
// name it), and a fixer is owed that as a stated property of the contract
// rather than one it discovers when its claim keeps coming back.
function cycleOpenQuestionsBlock(openQuestions) {
  const live = (openQuestions || []).filter((q) => q && q.id && !q.retired && !q.retirementPending);
  if (!live.length) return "";
  return `\n## Open questions still live from earlier passes (verbatim)\n\nThese are queued for the maintainer as they stand. If a disposition you make now SETTLES one — you fixed the underlying issue, or you are declining it on grounds that dispose of the decision itself — name that question's \`id\` in the disposition's \`retiresQuestionIds\`, so the cycle stops carrying a decision the maintainer no longer has to make. Retire nothing you did not actually settle: an unretired question is served to the maintainer, and a wrongly retired one takes a real decision off the table. A retirement is a claim, not an effect — this round's fresh reviewer is shown it and the question stays live for the maintainer until a round passes over it. A claim also cannot be WITHDRAWN once made: no later pass can retract it, so it is re-presented to each following round until one passes over it and ships to the maintainer as still-live if none ever does. Name only what you would stand behind.\n\n${JSON.stringify(live, null, 2)}\n`;
}

// The deviations standing after the previous pass, shown to every later pass so
// the result field can describe the FINAL state instead of latching: a loop that
// carried a round's flag straight into its final result reported a deviation
// rounds after the work had conformed, sending a maintainer to "restore"
// something already present. Restating is what makes replacing safe — a pass
// that omits one is CLAIMING it no longer stands, and the cycle keeps it
// standing until a round passes over that claim. The match is by exact text,
// which is why the block asks for a VERBATIM restatement: a reworded one is
// indistinguishable from a drop plus a new deviation, so a re-punctuation would
// cost a round, or ship the same deviation twice at the top of a PR body.
function cycleDeviationsBlock(deviations) {
  if (!deviations || !deviations.length) return "";
  return `\n## Deviations from LOCKED decisions standing after the last pass (verbatim)\n\nRestate in your \`deviations\`, VERBATIM, every one that STILL stands once this pass is done, and leave out only one that genuinely no longer does (say in \`summary\` what closed it): the cycle's result describes the FINAL state, not the history. Copy each one's text exactly — the cycle matches these by exact text, so a reworded restatement reads as a drop plus a brand-new deviation. Leaving one out is a CLAIM, not an effect — it keeps standing, and this round's reviewer is shown the claim beside it, until a round passes over it; a claim you make on the final confirmation pass earns one more round rather than ending the cycle undecided. Do NOT conform a deviation away to shorten this list — report, don't correct; the maintainer ratifies it or asks for conformance, and has ratified one and reversed their own earlier decision before.\n\n${JSON.stringify(deviations, null, 2)}\n`;
}

function cycleFixPrompt(cycle, state) {
  const scope = cycle.scope || {};
  const roundIntro = state.confirming
    ? `The fresh reviewer has PASSED this cycle. This is the FINAL CONFIRMATION PASS of the disposition rule: read the passing reports below and dispose anything in them still worth acting on (pass-notes, stray remarks) — \`fixed\`, \`declined\` (with reason), or \`escalated\`. If nothing needs acting on, return \`changed: false\` with an empty \`dispositions\` array; that ends the cycle. Anything you fix or dispute will go through another reviewer round.`
    : state.findings
      ? `This is fix-up round ${state.round}. Address the findings below: dispose EVERY one explicitly — \`fixed\`, \`declined\` (with a reason; the next fresh reviewer verifies declines), or \`escalated\` to an open question in the pinned format — echoing each finding's \`id\` as your disposition's \`findingId\`, exactly ONE disposition per finding (coverage is checked structurally; an uncovered or double-disposed finding comes back to the next pass and blocks the round). Never drop one silently, and never implement a fix you believe is wrong just to clear a finding. Two convergence heuristics apply once rounds start repeating themselves. If consecutive rounds each puncture a NARROWER residual of the same finding, the artifact is over-claiming rather than under-specified: "bound the claim honestly" — state the premises, name the residual outright, give the operator definite branches — is a legitimate COMPLETE \`fixed\` disposition, but only where the bounded claim is one the artifact actually keeps; weakening a criterion to dodge the finding is not bounding it. If TWO consecutive rounds land findings of the same CLASS in the same section, stop patching instances and ask whether the structure is the defect — the two observed triggers are a closed enumeration standing in for an open set (replace it with an exclusion rule) and a spec keeping several options open so every criterion must hold under all of them (lock one option) — and if you raise that threshold for a section under heavy churn, state in \`summary\` the number you raised it to.`
      : `This is round 1: carry out the assignment below.`;
  const artifactHome = state.artifactDir
    ? `This cycle's artifact directory is \`${state.artifactDir}\` — report it back as \`artifactDir\` and write this pass's packet prose (what you did, dispositions, question drafts) under it as \`round-${state.round}/\`.`
    : `Create this cycle's UNIQUE artifact directory first — outside the worktree, e.g. \`mktemp -d "\${TMPDIR:-/tmp}/review-cycle-"${cycleShq(cycleSlugSegment(cycle.slug))}".XXXXXX"\` (never a fixed shared name: parallel cycles share scratch space) — report it as \`artifactDir\` (REQUIRED: the cycle refuses to run rounds with no home for their history), and write this pass's packet prose under it as \`round-${state.round}/\`.`;
  const artifactLine = `${artifactHome} ${CYCLE_REDIRECTED_OUTPUT}`;
  return `You are the fixer for one review cycle (branch \`${cycle.branch}\`, review base \`${cycle.base}\`, artifact type ${cycle.artifactType}).

## WORKTREE CONTRACT (do this before anything else)

${cycleContract(cycle, "fixer")}

${CYCLE_DESTROY_BOUNDARY}

Read the repository's agent-context files (\`AGENTS.md\` / \`CLAUDE.md\`) first for conventions.

${roundIntro}

## Assignment

${scope.instructions || "Address the work items below."}
${cycleItemsBlock(cycle)}${cycleFindingsBlock(state.findings)}${cycleOpenQuestionsBlock(state.openQuestions)}${cycleDeviationsBlock(state.deviations)}
## Rules

- ${artifactLine}
- Commit at logical milestones; run the project's build/lint before declaring done (code artifacts).
- A sweep ("fix this pattern everywhere") is ENUMERATED, never asserted: return the explicit search space with a per-item verdict, and claim a completed sweep in a commit message only where you enumerated that space. This round's reviewer redoes the enumeration rather than spot-checking yours.
- ${CYCLE_CARRIED_CLAIMS}
- ${CYCLE_FINISH_IN_TURN} ${CYCLE_NO_SELF_PEER}
- If you must deliver something other than a decision the maintainer LOCKED, do not silently conform or correct: report it in \`deviations\` — what you delivered instead and the constraint that forced it — and restate it VERBATIM on every later pass while it stands. The cycle surfaces it for the human (report, don't correct), who ratifies it or asks you to conform; it buys no slack in the meantime, since completeness, tests, and regressions are graded exactly as strictly.
- Every \`escalated\` disposition gets an \`openQuestions\` entry in the schema's pinned format, under an id no earlier pass used (re-using one reads as a re-report of that pass's question, which the cycle keeps instead of yours), with authoritative artifact pointers (file:line, refs) — never paraphrase — and its \`questionId\` back-reference — which must name a question this cycle carries LIVE (the one you just raised, or one an earlier pass raised that no retirement has claimed); an absent, empty, or settled id names no decision the maintainer will be asked to make and comes back to the next pass as a disposition error. Raise a question only for a decision still open: a \`fixed\` or \`declined\` disposition that SETTLES a still-live question from an EARLIER pass names that question's \`id\` in \`retiresQuestionIds\` instead (only those two dispositions retire; a question this pass raises cannot also be retired by it; and retiring an id the cycle does not carry open from an earlier pass comes back to the next pass as a disposition error).
- Before returning, the worktree MUST be clean AND idle: \`git status --porcelain\` empty with every intended change committed, and no Git operation in progress — check \`git rev-parse --git-path rebase-merge\` and \`rebase-apply\` for an existing path, plus \`MERGE_HEAD\`, \`CHERRY_PICK_HEAD\`, \`REVERT_HEAD\`, \`BISECT_LOG\` (a tree left mid-rebase or mid-cherry-pick can print empty porcelain). Set \`clean\` and \`finalSha\` accordingly; either condition failing is resolved or reported as a \`blocker\`, never handed to review.
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
  return `This is a CODE artifact. Run the full build/type-check FIRST; a failure is an automatic blocker (\`pass: false\`). Check every acceptance criterion the work items state against the actual code, then do the quality pass (logic, error handling, edge cases, dead code, consistency, duplication, type safety) on the touched files.`;
}

function cycleReviewPrompt(cycle, state) {
  const handed = state.handedFindings
    ? [...(state.handedFindings.carried || []), ...(state.handedFindings.reviewer || []), ...(state.handedFindings.peer || [])]
    : [];
  const handedBlock = handed.length
    ? `\n## Findings handed to the fixer this round (verbatim, with ids — verify EVERY one received an explicit, justified disposition below; a finding with no disposition was silently dropped, itself a blocking issue)\n\n${JSON.stringify(handed, null, 2)}\n`
    : "";
  const dispositionsBlock = state.packet && Array.isArray(state.packet.dispositions) && state.packet.dispositions.length
    ? `\n## Proposed finding dispositions (verify each; a \`declined\` must be technically justified, not a convenient dismissal — you may overrule it)\n\n${JSON.stringify(state.packet.dispositions, null, 2)}\n`
    : "";
  // A retirement is the fixer asserting a queued maintainer decision is
  // settled, so it goes to the same fresh reviewer that adjudicates a decline:
  // it is the only disposition that can take a question OFF the human's list,
  // and the dispositions block alone shows the id, never what was asked. This
  // round's verdict is what makes the claim take effect, so a claim an earlier
  // round did not pass is re-presented here rather than left unadjudicated.
  const proposedRetirementsBlock = Array.isArray(state.proposedRetirements) && state.proposedRetirements.length
    ? `\n## Open questions proposed for RETIREMENT (the fixer claims each is now SETTLED, so the maintainer will not be asked it — verify that claim against the committed state, exactly as you would a \`declined\`; a question retired without being genuinely settled silently drops a decision the human should have made, itself a blocking issue). Each entry's \`retirementPending\` names the pass and disposition claiming it; passing this round is what settles them, so one an earlier round did not pass appears again here.\n\n${JSON.stringify(state.proposedRetirements, null, 2)}\n`
    : "";
  const workBlock = state.packet && Array.isArray(state.packet.workReport) && state.packet.workReport.length
    ? `\n## Fixer's per-item report (verify the claims hold in the committed state; you were NOT given its reasoning)\n\n${JSON.stringify(state.packet.workReport, null, 2)}\n`
    : "";
  // The reviewer's half of report-don't-correct: the maintainer rules on a
  // deviation, so the review adds the two things that decision needs — whether
  // an in-spec route existed, and a recommendation — without conforming it away
  // and without grading the rest of the work any more gently for it. Asked for
  // in prose alone it was optional in fact: a schema-valid `{pass: true,
  // issues: [], notes: ""}` passed a round carrying a deviation, and the result
  // then claimed a judgment nobody had made. So it is a STRUCTURAL field the
  // round is gated on, one entry per deviation that still stands.
  const deviationDrops = Array.isArray(state.deviationDrops) ? state.deviationDrops : [];
  const deviationsBlock = Array.isArray(state.deviations) && state.deviations.length
    ? `\n## Deviations from LOCKED decisions standing on this packet (verbatim)\n\nReturn ONE \`deviationAssessments\` entry for each of these the fixer still restates — every one below except the claimed drops you accept — copying its text VERBATIM into \`deviation\` and giving \`inSpecRoute\` (whether an in-spec route existed, and which) and \`recommendation\` (START with ${CYCLE_DEVIATION_VERDICTS.join(" or ")} — those two verdicts are the whole vocabulary, and a hedge such as "UNSURE" is not one of them — then the one-line reason; the first word is taken literally as your verdict, so do not open with both, and lead with neither if you cannot choose). This round does not pass while one of them is unassessed: the maintainer decides, and would otherwise be handed the deviation with only the implementer's half of it. A deviation is neither a finding to be corrected away nor a license for unfinished work — grade completeness, tests, and regressions exactly as strictly.\n\n${JSON.stringify(state.deviations, null, 2)}\n${deviationDrops.length ? `\nOf those, the fixer no longer restates the ones below, CLAIMING each no longer stands. Verify that against the committed state exactly as you would a \`declined\`: passing this round is what drops them, so raise one you do not accept as an issue rather than letting it go — a drop you reject is assessed by the round after it, once the fixer restates it.\n\n${JSON.stringify(deviationDrops, null, 2)}\n` : ""}`
    : "";
  // This brief orders a full build, so the reviewer needs a destination for the
  // build's output as much as for its own report — including on the pass that
  // runs with no cycle behind it (the collision re-review), where leaving the
  // path to the reviewer is exactly how a shared scratch name gets chosen.
  const persistLine = state.artifactDir
    ? `\nPersist your full report for the round history: write the same content you return (verdict, numbered issues, notes) to \`${state.artifactDir}/round-${state.round}/reviewer-report.md\`. ${CYCLE_REDIRECTED_OUTPUT} That directory is OUTSIDE the worktree, and those files are the only exceptions to the no-file-creation rule.\n`
    : `\nYou were given no cycle artifact directory, so there is no round history to persist. If any build or validation output must land in a file, create a UNIQUE directory for it first — outside the worktree, e.g. \`mktemp -d "\${TMPDIR:-/tmp}/re-review-"${cycleShq(cycleSlugSegment(cycle.slug))}".XXXXXX"\` (never a fixed shared name: concurrent reviewers share one scratch directory) — and write inside it. Those files are the only exception to the no-file-creation rule.\n`;
  return `You are an independent fresh-eyes reviewer for one review cycle (branch \`${cycle.branch}\`, review base \`${cycle.base}\`, artifact type ${cycle.artifactType}). You have no knowledge of how the work was built, and that is the point. Edit NOTHING; create, update, or delete no files; do not use the task-tracker tools.

## WORKTREE CONTRACT (do this before anything else)

${cycleContract(cycle, "reviewer")}

${CYCLE_DESTROY_BOUNDARY}

Read the repository's agent-context files (\`AGENTS.md\` / \`CLAUDE.md\`) first for conventions.

${cycleReviewChecks(cycle.artifactType)}

Where the work claims a same-pattern sweep ("fixed everywhere"), REDO the enumeration of its search space yourself rather than spot-checking the enumeration supplied; a sweep asserted with no enumeration behind it is a finding in its own right.

${CYCLE_CARRIED_CLAIMS}

${CYCLE_FINISH_IN_TURN} ${CYCLE_NO_SELF_PEER}

Scope with \`git diff --name-only ${cycleShq(cycle.base)}...HEAD\` — deliberately the CUMULATIVE range, the whole change against \`base\` rather than an incremental since-the-last-round diff, because each round re-reviews the work as a whole. Then read each touched file IN FULL — do not read commit messages or diff content (both anchor you to the fixer's intent); follow references into untouched files when needed. If the diff looks empty despite claimed work, set \`emptyDiffFlag\` and stop — that signals a wrong worktree/branch, not real absence.
${persistLine}${cycle.scope && cycle.scope.reviewInstructions ? `\n## Consumer review criteria (verify each item against these too)\n\n${cycle.scope.reviewInstructions}\n` : ""}${cycleItemsBlock(cycle)}${handedBlock}${dispositionsBlock}${proposedRetirementsBlock}${workBlock}${deviationsBlock}
Return \`pass: true\` only if everything holds and no material issue remains; else \`pass: false\` with numbered, actionable \`issues\`. Be strict but fair — real gaps and functional problems, not style nits. Put pass-worthy caveats in \`notes\` (the cycle disposes them rather than dropping them).`;
}

// The peer invocation happens INSIDE this subagent prompt, never in the
// script (a workflow cannot shell out). Baseline destination: the
// `peer-review-run` helper (schema powbox.peer-review-run/v1) — retained
// pinned raw launch until that helper can carry the codex peer's CONFIGURED
// high-capability model, the one half of the review-strength passthrough still
// outstanding; its effort passthrough and strength reporting have landed. See
// the header comment. The launch pins review strength per invocation
// (-c model_reasoning_effort=medium; the model stays the peer's configured
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
  const preflightStep = state.peerPreflighted
    ? `1. Preflight: already done this run — an earlier round verified the \`codex\` binary and login, so skip the probes. An auth/usage error from the launch itself still returns \`unavailable\`.`
    : `1. Preflight: if \`command -v codex\` fails, return outcome \`unavailable\` (detail: missing binary). If \`codex login status\` exits non-zero and \`CODEX_API_KEY\` is unset, return \`unavailable\` (detail: logged out). An auth/usage error from the launch itself is also \`unavailable\`.`;
  return `You run the best-effort cross-harness PEER REVIEW stage for one review-cycle round. You launch a read-only \`codex\` review of the committed state, wait for it, and return its result structurally. You NEVER fail this stage: every problem becomes a non-blocking outcome in the schema (\`unavailable\`, \`timeout\`, \`forfeited\`, \`failed\`) with a one-line \`detail\` — never an error, never a refusal to answer.

## WORKTREE CONTRACT

${cycleContract(cycle, "peer")}

${CYCLE_DESTROY_BOUNDARY}

The peer examines this worktree READ-ONLY; you edit nothing either. The cycle's fresh reviewer is examining the same committed state concurrently — two readers are safe, and the reviewer alone owns builds/execution.

${CYCLE_FINISH_IN_TURN} That is why the launch below is one supervised foreground call: you return its outcome, never a promise to report the peer's result later.

## Steps

${preflightStep}
2. Prepare unique per-attempt paths under this cycle's artifact directory: \`round_dir=${cycleShq(`${state.artifactDir}/round-${state.round}`)}\`, \`mkdir -p "$round_dir"\`, with \`prompt_file\`, \`outfile\`, \`stderr_file\` inside it (suffix \`-attempt2\` on a retry; never reuse a path).
3. Write the peer prompt below VERBATIM to \`$prompt_file\` with a quoted heredoc (\`<<'PEER_PROMPT'\`) — never assemble it through shell interpolation.
4. Launch the peer as ONE supervised foreground call, bounded UNDER your own Bash tool limit so the tool can never kill it mid-run unaccounted (set the Bash tool timeout to 600000 ms and bound the peer tighter with \`timeout\`):

   \`\`\`bash
   worktree="<the worktree path from the contract above>"
   # Pin peer effort per invocation; never changes the container's saved config.
   timeout 540 codex exec --sandbox read-only --cd "$worktree" -o "$outfile" \\
     -c mcp_servers={} -c model_reasoning_effort=medium "$(<"$prompt_file")" \\
     < /dev/null 2> "$stderr_file"
   \`\`\`

   Exit 124 means the bounded timeout fired: retry ONCE with fresh attempt paths, then return outcome \`timeout\`. Any other failure (crash, non-zero exit with no usable output): retry once, then return \`failed\`. Auth/usage errors: \`unavailable\` without retry.
5. Read \`$outfile\`. A \`VERDICT: PASS\` line → outcome \`passed\` (anything after it goes to \`notes\` verbatim). A \`VERDICT: ISSUES\` line → outcome \`issues\`, with every numbered finding mapped verbatim into \`findings\` (severity from its \`blocking\`/\`minor\` tag — default \`blocking\` when untagged — plus its \`file:line\` as \`location\` and the finding text as \`claim\`; do not summarize, merge, or rewrite). No verdict line, or empty/unintelligible output → \`forfeited\`.

## Peer prompt (write this text to the prompt file verbatim, filling only the placeholders)

You are an independent read-only peer reviewer. Review the committed state of branch ${JSON.stringify(cycle.branch)} against base ${JSON.stringify(cycle.base)} in the current directory (artifact type: ${cycle.artifactType}). Read the actual files; edit nothing; run no builds or tests. Verify the work items and any proposed dispositions below in the committed code; a declined finding must be technically justified. ${CYCLE_CARRIED_CLAIMS} Evidence (verbatim):

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
    return { outcome: "forfeited", findings: [], notes: "", detail: "peer subagent returned nothing (died or failed schema validation); recorded non-blocking", synthesized: true };
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
    // Script-synthesized results (dead/schema-failed subagent, thrown stage)
    // carry this marker: no peer subagent demonstrably ran, so the run-level
    // preflight must not be considered done on their account. A real agent
    // result never sets it (the field is not in CYCLE_PEER_SCHEMA).
    synthesized: res.synthesized === true,
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
    return { outcome: "forfeited", findings: [], notes: "", detail: `peer stage threw (${e && e.message ? e.message : String(e)}); recorded non-blocking`, synthesized: true };
  }
}

function cycleGroundingPrompt(cycle, findings) {
  return `Cheap grounding spot-check, read-only. The fresh reviewer PASSED this round; only the peer findings below would gate it. For each, check that its \`file:line\` (or referenced site) exists in the worktree and that the claim is not self-evidently false. Do NOT re-review or judge severity — discard is only for nonexistent references and self-evidently false claims; when in doubt, \`grounded: true\`.

${cycleContract(cycle, "reviewer")}

${CYCLE_DESTROY_BOUNDARY}

${CYCLE_FINISH_IN_TURN} ${CYCLE_NO_SELF_PEER}

## Findings

${JSON.stringify(findings, null, 2)}

Return a verdict per finding. Edit nothing.`;
}

// Structural enforcement of the disposition rule: every handed finding carries
// a script-assigned `id`, and a pass's dispositions must name each id with
// EXACTLY ONE recognized disposition (`escalated` additionally naming an open
// question that exists). A finding left uncovered — including one whose id
// drew duplicate, possibly conflicting, dispositions — gates the round and is
// carried forward VERBATIM to the next fixer pass, so no finding can vanish
// between rounds on a fixer's silence. A disposition naming an id that matches
// no handed finding covered nothing and is rejected: it comes back as a
// synthesized `disposition-error` carried entry (id prefixed `stray:` so it
// can never collide with a real round-scoped id) the next pass must dispose,
// so a mis-aimed disposition cannot pass silently either. When NOTHING was
// handed there is no coverage contract to enforce: every disposition is then
// spontaneous (e.g. of a pass-note) and carries no findingId requirement.
// Matching is by id, never by finding text — paraphrase-proof where text
// matching is not.
//
// The same treatment covers the OTHER direction of the question link: a
// `fixed`/`declined` disposition may name questions it retires, and a
// retirement that settles nothing — an id no question carries live FROM AN
// EARLIER PASS, or one attached to a disposition that settles nothing — comes
// back as a `disposition-error` carried entry (id prefixed `retire:`, which like
// `stray:` can never collide with a real round-scoped id) rather than no-op'ing
// silently. Unlike the coverage contract, that guard binds even on a pass
// handed nothing, since a retirement is a claim about the cycle's own
// accumulated questions rather than about this round's findings.
//
// An `escalated` disposition's `questionId` back-reference gets the same
// treatment (id prefixed `question:`, collision-proof for the same reason)
// wherever the coverage walk does not already judge it. Coverage judges it for
// a disposition that names a handed finding — an id naming no live question
// fails to cover, and the finding comes back carried, which IS the report — but
// a SPONTANEOUS disposition (no `findingId`, and every disposition on a pass
// handed nothing, which the final confirmation pass always is) covers nothing
// by construction, so that channel says nothing at all and the back-reference
// the contract requires would no-op silently. Reporting it there and only
// there also keeps one breach to one entry, rather than spending an extra
// round on a second report of a finding already carried.
//
// RETIRABLE and KNOWN are deliberately DIFFERENT sets. An `escalated`
// disposition names the question its own packet just raised, so
// `knownQuestionIds` must include this pass's new entries; a retirement asserts
// an EARLIER pass's queued decision is settled, so `retirableQuestionIds` is
// snapshotted BEFORE those entries are appended. Collapsing the two would let
// one packet raise `q1`, retire `q1`, and still have an `escalated` disposition
// naming `q1` count as covered — the finding would be disposed by a question the
// same breath marked settled, reaching neither the next pass nor the maintainer.
// The same reasoning invalidates an `escalated` disposition naming a question
// THIS packet retires (an earlier pass's question is nameable by both): the
// finding is carried forward rather than covered by a decision being taken off
// the table, which is why the retirements are collected before coverage is
// judged.
//
// Every SCHEMA-VALID entry survives this filter, the empty string included: the
// schema asks for non-empty ids (`minLength: 1`), so an empty one is a
// contract breach naming no live question — precisely what the guard below
// exists to report — and dropping it here would make the one shape the schema
// still admits as a `string` the one shape that no-ops silently. Non-strings
// are off-schema and cannot be reported AS an id (the entry is keyed by it), so
// they stay filtered, the same way a malformed disposition is simply not one.
function cycleRetiredQuestionIds(d) {
  return (Array.isArray(d.retiresQuestionIds) ? d.retiresQuestionIds : []).filter((q) => typeof q === "string");
}

function cycleUndisposedFindings(findings, fix, knownQuestionIds, retirableQuestionIds) {
  const handed = findings
    ? [...(findings.carried || []), ...(findings.reviewer || []), ...(findings.peer || [])]
    : [];
  const handedIds = new Set(handed.map((f) => f && f.id).filter(Boolean));
  const counts = new Map(); // handed id -> how many dispositions named it
  const covered = new Set();
  const stray = new Map(); // synthesized-entry id -> one carried entry per contract error
  const dispositions = (fix.dispositions || []).filter(Boolean);
  // The questions this packet actually retires — exactly what the caller will
  // mark — gathered first, because coverage below may not lean on one of them.
  const retiring = new Set();
  for (const d of dispositions) {
    if (d.disposition !== "fixed" && d.disposition !== "declined") continue;
    for (const qid of cycleRetiredQuestionIds(d)) if (retirableQuestionIds.has(qid)) retiring.add(qid);
  }
  // The one liveness test both question guards below use: known to the cycle
  // (this pass's own new questions included) and not being retired out from
  // under the escalation by this very packet.
  const liveQuestion = (qid) => knownQuestionIds.has(qid) && !retiring.has(qid);
  for (const d of dispositions) {
    const retires = cycleRetiredQuestionIds(d);
    if (retires.length) {
      const settles = d.disposition === "fixed" || d.disposition === "declined";
      for (const qid of retires) {
        if (settles && retirableQuestionIds.has(qid)) continue;
        stray.set(`retire:${qid}`, {
          id: `retire:${qid}`,
          category: "disposition-error",
          problem: settles
            ? `A ${d.disposition} disposition claimed to retire open question ${JSON.stringify(qid)}, which this cycle does not carry as a live open question from an EARLIER pass — it was never raised, this same pass raised it (one pass cannot both raise and settle a question: report whichever of the two is true, never both), or an earlier pass already retired it, or claimed to (a claim still awaiting the reviewer round that decides it has already spoken for the question) — so the retirement settled nothing. Re-issue it against the correct live question id as needed, and dispose this entry (e.g. declined) explaining the stray.`
            : `A disposition claimed to retire open question ${JSON.stringify(qid)}, but its \`disposition\` is ${JSON.stringify(d.disposition || "")} — only a \`fixed\` or \`declined\` disposition retires a question (an \`escalated\` one raises a question rather than settling it) — so the retirement was not applied. Re-issue it on the disposition that actually settles the question, and dispose this entry (e.g. declined) explaining the stray.`,
        });
      }
    }
    // When NOTHING was handed there is no coverage contract to enforce (the
    // retirement guard above still binds), and a disposition with no findingId
    // is spontaneous — neither carries a coverage obligation. What such a
    // disposition still owes, when it is `escalated`, is its question
    // back-reference, which nothing below it would ever look at.
    //
    // The HANDED case is deliberately NOT given an entry here as well, because
    // it is not silent and so needs no second carrier: `liveQuestion` in the
    // coverage walk below refuses to mark the finding covered, so the finding
    // returns as `outstanding.carried` under a header that names this very
    // reason (task 014a's scenario 16 pins it). A `disposition-error` entry is
    // this section's carrier of LAST resort — `stray:` and `retire:` exist
    // because nothing else would surface those breaches at all — so raising
    // one beside an already-carried finding would spend two entries, and two
    // fixer obligations, on one mistake.
    //
    // LIVE is the whole test, and a `retired`/`retirementPending` id is the
    // SAME breach as one no pass ever raised rather than a case of its own: in
    // both, the back-reference points at no decision the maintainer will be
    // asked to make — a question this cycle settled, or claims to have settled
    // pending the round that decides it, is off that list as surely as one
    // that was never on it, so a disposition escalating to it escalates to
    // nothing. Naming a STILL-LIVE id is no breach at all, even though the
    // re-report rule then keeps the raising pass's question body over this
    // pass's: that decision does reach the maintainer, and failing the round
    // over a restatement would cost the confirmation pass — where the cycle is
    // trying to converge — another round for nothing.
    //
    // An absent or non-string id normalizes to the empty string, which names
    // nothing and is exactly the breach worth reporting: the contract asks for
    // a non-empty id — a conditional no schema keyword here expresses, which
    // is why this guard has to enforce it for the spontaneous dispositions it
    // sees — and letting the empty one through would make the one breach still
    // typed as a `string` the one shape that no-ops.
    if (!handed.length || !d.findingId) {
      if (d.disposition === "escalated") {
        const qid = typeof d.questionId === "string" ? d.questionId : "";
        if (!liveQuestion(qid)) {
          stray.set(`question:${qid}`, {
            id: `question:${qid}`,
            category: "disposition-error",
            problem: `An \`escalated\` disposition named questionId ${JSON.stringify(qid)}, which this cycle does not carry as a LIVE open question — no pass raised it (an absent or empty id names nothing), or a retirement has already settled it, or claimed to (a claim still awaiting the reviewer round that decides it has already spoken for the question), or this same pass retires it (settling a decision rather than escalating to it) — so the back-reference points at no decision the maintainer will be asked to make. Re-issue the escalation with an \`openQuestions\` entry under an id no earlier pass used and name THAT id, or dispose what you escalated some other way, and dispose this entry (e.g. declined) explaining the stray.`,
          });
        }
      }
      continue;
    }
    if (!handedIds.has(d.findingId)) {
      stray.set(`stray:${d.findingId}`, {
        id: `stray:${d.findingId}`,
        category: "disposition-error",
        problem: `A disposition named findingId ${JSON.stringify(d.findingId)}, which matches no finding handed that round, so it covered nothing. Re-issue it against the correct handed id as needed, and dispose this entry (e.g. declined) explaining the stray.`,
      });
      continue;
    }
    counts.set(d.findingId, (counts.get(d.findingId) || 0) + 1);
    const valid =
      d.disposition === "fixed" ||
      d.disposition === "declined" ||
      (d.disposition === "escalated" && d.questionId && liveQuestion(d.questionId));
    if (valid) covered.add(d.findingId);
  }
  // Exactly one disposition per id: duplicates — conflicting or not — collapse
  // to "not validly disposed", carrying the finding forward.
  for (const [id, n] of counts) if (n > 1) covered.delete(id);
  return [...handed.filter((f) => !covered.has(f.id)), ...stray.values()];
}

// runReviewCycle — the whole protocol as one awaitable function.
//
// cycle: {
//   slug, worktree, branch, base, artifactType ("code"|"prose"|"decision"),
//   `base` must not MOVE under the cycle: never a movable remote-tracking name
//     like `origin/main`, never a pre-rebase SHA (unreachable afterwards — so
//     re-record it); pin it to an immutable OID or a recorded snapshot wherever
//     it can move mid-run. Rounds review the CUMULATIVE `base...HEAD` by
//     design: an INCREMENTAL re-review needs the recorded prior-round SHA, not
//     a fix commit's parent — after an amend `HEAD~1` spans the whole fix set.
//   scope: { title, instructions, items },
//   maxRounds (validated through cycleRoundCap), peer ("on"|"off"),
//   mode ("full"|"light"),
//   contracts: { fixer, reviewer, peer } — optional per-role preamble text
//     (a worktree-lifecycle consumer passes its own wt-enter contract here),
//   labelPrefix — optional, prefixes agent labels for fan-out consumers,
//   peerState — optional SHARED peer-availability state for a fan-out owner
//     embedding many cycles: hand every cycle ONE object of the shape
//     { preflighted: false, unavailable: false, unavailableDetail: "" } and
//     the install/login preflight runs once for the whole batch, with an
//     unavailable peer sticking batch-wide (the canonical batch rule).
//     Availability state ONLY — no peer cap, queue, or fan-out shape lives
//     here (that policy is task 015's). Omitted, each cycle keeps its own
//     (the standalone behavior).
// }
//
// Returns the cycle result contract (lean; bulk prose stays behind artifactDir):
// { verdict: "pass"|"review-cap"|"error", detail, rounds, findingDispositions,
//   openQuestions, deviations, deviationAssessments (the reviewer's half for
//   each deviation still standing — at most ONE entry per deviation, and only
//   an entry the passing round could use), deviationHistory (only once some
//   pass reported one), workReport, proactive, finalSha, notes, reviewerNotes,
//   peerRounds, discardedPeerFindings, undisposed, outstanding, artifactDir,
//   artifactDirAnomalies (present only when a later pass tried
//   to move the artifact directory) }
// NO per-round condition latches into that result: `deviations` is the LAST
// pass's set, not every pass's, so the result describes the FINAL state and
// `deviationHistory` — named as history — is where the rounds live. Dropping
// one is a CLAIM a round must pass over, exactly like a retirement: until then
// it keeps standing in `deviations` (the DROPS still open are `deviations`
// minus the last `deviationHistory` entry), and ANY move the final
// confirmation pass makes to this set — dropping one, or first stating one —
// holds the cycle open for the round that decides it rather than ending it
// undecided, and that round does not pass until the reviewer's in-spec-route
// judgment and RATIFY/CONFORM recommendation for each standing deviation is in
// `deviationAssessments`. So no deviation reaches the maintainer without them,
// and none is taken away without a round accepting that it no longer stands. A
// `pass` verdict carries no open claim; an open one
// is what an `error` or `review-cap` exit leaves behind, neither having reached
// the round that would have settled it. A consumer publishing a PR comment or
// summary from this result leads with `deviations`; they are the maintainer's
// call to ratify or conform, never the loop's.
// An `openQuestions` entry a later pass settled carries a `retired` mark; a
// consumer serving these to a human (resolve-open-questions) skips those. A
// retirement no reviewer round has accepted carries `retirementPending`
// instead and is STILL a live decision — that is what an `error` or
// `review-cap` exit leaves behind, neither having reached the round that
// would have settled it.
async function runReviewCycle(cycle) {
  const cap = cycleRoundCap(cycle.maxRounds);
  const lp = cycle.labelPrefix || "";
  const findingDispositions = [];
  const openQuestions = [];
  // Retirement claims awaiting a reviewer round's verdict. Not a result field:
  // each element IS the accumulated question object, so accepting one mutates
  // what the result already carries.
  const pendingRetirements = [];
  // The deviations still standing (the last pass's set, plus any drop no round
  // has accepted yet) and the per-pass record. Re-evaluated every pass rather
  // than accumulated: see the result contract above.
  let deviations = [];
  const deviationHistory = [];
  // Drops claimed but not yet adjudicated, re-presented to each round until one
  // passes over them — the retirement machinery's rule, for its reason too.
  let pendingDeviationDrops = [];
  const peerRounds = [];
  const discardedPeerFindings = [];
  const artifactDirAnomalies = [];
  let artifactDir = "";
  let packet = null;
  let rounds = 0;
  let fixerPasses = 0;
  let findings = null; // findings block for the next fixer pass; null on round 1
  let confirming = false; // next fixer pass is the final confirmation pass
  // Peer availability state: `preflighted` (the install/login preflight runs
  // once, never per round) and sticky `unavailable` (an unavailable peer is
  // not re-probed). A fan-out owner embedding many cycles passes ONE shared
  // object as cycle.peerState so the whole batch preflights once and
  // unavailability sticks batch-wide; a standalone cycle gets its own. (The
  // runtime is single-threaded JS, so sibling cycles mutate a shared object
  // safely between awaits.)
  const peerState = cycle.peerState || { preflighted: false, unavailable: false, unavailableDetail: "" };
  let reviewerNotes = ""; // the latest reviewer's pass-notes (PR-body caveats for consumers)
  // The reviewer's half of report-don't-correct, as accepted by the last round
  // that PASSED. Replaced rather than accumulated, for the reason `deviations`
  // is: it describes the deviations standing now, not every judgment ever made.
  let deviationAssessments = [];

  const result = (verdict, detail, extra) => {
    // An assessment travels only beside the deviation it judges: one whose
    // deviation a later round dropped would re-latch exactly what `deviations`
    // stopped latching. A deviation with no entry here reached no round that
    // passed over it — an `error` or `review-cap` exit, which ships it standing
    // and unjudged rather than pretending otherwise.
    const standingAssessments = deviationAssessments.filter((a) => a && deviations.includes(a.deviation));
    return {
      verdict,
      detail: detail || "",
      rounds,
      findingDispositions,
      openQuestions,
      deviations,
      ...(standingAssessments.length ? { deviationAssessments: standingAssessments } : {}),
      ...(deviationHistory.some((h) => h.deviations.length) ? { deviationHistory } : {}),
      workReport: (packet && packet.workReport) || [],
      proactive: (packet && packet.proactive) || "",
      finalSha: (packet && packet.finalSha) || "",
      notes: (packet && packet.summary) || "",
      reviewerNotes,
      peerRounds,
      discardedPeerFindings,
      artifactDir,
      ...(artifactDirAnomalies.length ? { artifactDirAnomalies } : {}),
      ...(extra || {}),
    };
  };

  while (true) {
    fixerPasses += 1;
    const fix = await agent(cycleFixPrompt(cycle, { round: fixerPasses, findings, confirming, artifactDir, openQuestions, deviations }), {
      label: `${lp}fix#${fixerPasses}`,
      schema: CYCLE_FIX_SCHEMA,
    });
    if (!fix) return result("error", `fixer returned nothing on pass ${fixerPasses}`);
    if (fix.blocker) return result("error", `fixer blocked on pass ${fixerPasses}: ${fix.blocker}`);
    // Packet hard-check: a packet is adopted only from a worktree that is both
    // clean AND idle. Never silently — the pass is redriven or resumed instead,
    // because a tree left mid-rebase or mid-cherry-pick prints empty porcelain
    // and would hand the next round a worktree nobody can safely build on.
    if (!fix.clean) return result("error", `fixer returned a worktree that is not clean and idle on pass ${fixerPasses} (uncommitted changes, or a Git operation still in progress); refusing to adopt the packet — redrive or resume that pass`);
    // The result contract promises the FULL round history reachable through
    // ONE pointer, so the FIRST reported artifactDir is authoritative, and it
    // is validated once here: absolute, and outside the worktree when the
    // cycle knows that path (a consumer whose agents resolve the worktree
    // themselves passes worktree: "", where only the fixer prompt's
    // outside-the-worktree instruction applies). A later pass echoing a
    // DIFFERENT directory does not move the pointer — earlier rounds would
    // become unreachable through it — but the anomaly is logged and recorded.
    if (fix.artifactDir && !artifactDir) {
      const wt = (cycle.worktree || "").replace(/\/+$/, "");
      if (!fix.artifactDir.startsWith("/")) {
        return result("error", `fixer reported a non-absolute artifactDir ${JSON.stringify(fix.artifactDir)} on pass ${fixerPasses}; the round-history home must be an absolute path outside the worktree`);
      }
      if (wt && (fix.artifactDir === wt || fix.artifactDir.startsWith(`${wt}/`))) {
        return result("error", `fixer placed artifactDir ${JSON.stringify(fix.artifactDir)} inside the worktree on pass ${fixerPasses}; the round-history home must live outside it`);
      }
      artifactDir = fix.artifactDir;
    } else if (fix.artifactDir && fix.artifactDir !== artifactDir) {
      artifactDirAnomalies.push({ pass: fixerPasses, reported: fix.artifactDir, kept: artifactDir });
      log(`fixer pass ${fixerPasses} reported artifactDir ${JSON.stringify(fix.artifactDir)}; keeping the first-captured ${JSON.stringify(artifactDir)} so the round history stays reachable through one pointer.`);
    }
    // A cycle with no home for its rounds' history may not run them.
    if (!artifactDir) return result("error", `fixer reported no artifactDir on pass ${fixerPasses}; refusing to run rounds whose history has no home`);
    for (const d of fix.dispositions || []) findingDispositions.push({ ...d, pass: fixerPasses });
    // The questions a disposition in THIS packet may retire: the ones live
    // before the pass's own are appended below — a question an earlier claim
    // already covers, accepted or still pending, is not retirable again.
    // Snapshotted here rather than beside `knownQuestionIds`, because that
    // append is precisely what destroys the distinction the two sets exist to
    // keep (see cycleUndisposedFindings).
    const retirableQuestionIds = new Set(openQuestions.filter((q) => q && !q.retired && !q.retirementPending).map((q) => q.id).filter(Boolean));
    // Accumulate newly raised questions. Every pass after the first is SHOWN
    // the still-live ones (so it has ids to retire), which makes re-reporting
    // one a live possibility; the entry from the pass that raised it stays
    // authoritative. Appending a second entry under the same id would fork the
    // question's state — a retirement marks one copy while the other stays
    // live, and a re-report of a RETIRED question would resurrect it.
    for (const q of fix.openQuestions || []) {
      if (q && q.id && openQuestions.some((x) => x && x.id === q.id)) {
        log(`fixer pass ${fixerPasses} re-reported open question ${JSON.stringify(q.id)}; keeping the entry from the pass that raised it (a re-report neither forks nor revives a question).`);
        continue;
      }
      // The retirement marks are script-applied and no schema properties, so a
      // volunteered one is stripped rather than trusted: self-marking would
      // settle a question with no disposition behind it, bypassing both the
      // guard above and the reviewer that adjudicates every retirement — the
      // decision would leave the maintainer's list with nobody having claimed
      // to settle it. A fixer retires only through `retiresQuestionIds`.
      if (q && typeof q === "object" && ("retired" in q || "retirementPending" in q)) {
        const stripped = { ...q };
        delete stripped.retired;
        delete stripped.retirementPending;
        log(`fixer pass ${fixerPasses} volunteered a retirement mark on open question ${JSON.stringify(q.id || "")}; stripping it (a question is settled only by a later disposition's \`retiresQuestionIds\`, which the round's reviewer then adjudicates).`);
        openQuestions.push(stripped);
        continue;
      }
      openQuestions.push(q);
    }
    // Deviations describe the state AFTER this pass, so the pass's own set
    // replaces the standing one it was shown rather than adding to it — a
    // latched flag reported a deviation rounds after the work had conformed.
    // But a drop is a CLAIM, not an effect: "no longer stands" and "the fixer
    // forgot it" look identical in the packet, so a dropped deviation KEEPS
    // STANDING until a round passes with the claim in view, exactly as a
    // retirement does. Otherwise the final confirmation pass — asked for an
    // empty `dispositions` array — could erase a live deviation on its way out,
    // leaving the one call the loop is not allowed to make recorded nowhere the
    // maintainer reads; the terminal check below is what keeps such a claim
    // from being the cycle's last word.
    // Deduplicated on the way in: the cycle matches deviations by exact text,
    // so two identical entries are ONE deviation twice over, not two. Left as
    // reported they would ride into `deviations` — and from there to the top of
    // a PR body — as a doubled bullet, and count twice toward the set-move
    // quantity below, which is the one place a set is being asked how far it
    // moved rather than merely whether it did.
    const restated = [...new Set(fix.deviations || [])];
    for (const gone of deviations.filter((d) => !restated.includes(d) && !pendingDeviationDrops.includes(d))) {
      log(`fixer pass ${fixerPasses} did not restate deviation ${JSON.stringify(gone)}; it KEEPS STANDING as a claimed drop until a round passes with the claim in view.`);
    }
    // `deviations` is the set this pass was shown, so what it left out is
    // exactly the claim set: a drop the pass restates after all is withdrawn.
    pendingDeviationDrops = deviations.filter((d) => !restated.includes(d));
    // Adding one is the same event in the other direction — a deviation no
    // round has been shown — so both count as ONE quantity: whether this pass
    // moved the deviation set. That keeps the terminal check below a single
    // question instead of a rule that gates drops and lets adds through. No
    // carry-forward is needed: `confirming` is set only after a round PASSED,
    // and that round was shown every deviation standing before this pass, so a
    // pass's own adds are the only ones that can still be unadjudicated.
    const deviationSetChanges = pendingDeviationDrops.length + restated.filter((d) => !deviations.includes(d)).length;
    deviationHistory.push({ pass: fixerPasses, deviations: restated });
    deviations = [...restated, ...pendingDeviationDrops];
    // Accumulate the pass packet field-by-field. A later pass updates what it
    // actually reports, and an explicitly EMPTY field never clobbers a
    // populated one from an earlier pass: schema-driven agents commonly emit
    // every declared property, and the confirming pass is even asked for an
    // empty `dispositions` array — an empty `workReport` (or blank `finalSha`)
    // alongside it would otherwise wipe the per-item report consumers replay
    // (wf-address-review publishes thread replies/resolves from it).
    packet = packet || {};
    if (Array.isArray(fix.workReport) && fix.workReport.length) packet.workReport = fix.workReport;
    if (typeof fix.summary === "string" && fix.summary) packet.summary = fix.summary;
    if (typeof fix.proactive === "string" && fix.proactive) packet.proactive = fix.proactive;
    if (typeof fix.finalSha === "string" && fix.finalSha) packet.finalSha = fix.finalSha;

    // Disposition coverage: every handed finding must be validly disposed by
    // id. Anything uncovered gates the round below and is carried forward.
    // Only LIVE questions count as known: a question an earlier pass retired —
    // or claimed to retire, pending the round that decides it — is spoken for,
    // so it can neither validate an `escalated` disposition naming it nor be
    // retired a second time. This set includes the questions this pass
    // just raised — an `escalated` disposition names one of those — which is
    // why the narrower `retirableQuestionIds` snapshot, not this one, decides
    // what this pass may retire. This pass's own retirements are applied AFTER
    // the check, so a question is still live for the disposition retiring it.
    const knownQuestionIds = new Set(openQuestions.filter((q) => q && !q.retired && !q.retirementPending).map((q) => q.id).filter(Boolean));
    const undisposed = cycleUndisposedFindings(findings, fix, knownQuestionIds, retirableQuestionIds);

    // Record the retirements this pass claims. Marking rather than removing:
    // the result then still shows the question was raised and what settled it,
    // so a consumer skips it knowingly and a WRONG retirement is visible in the
    // same lean result as the disposition that made it, not only in the
    // artifact directory. A retirement naming an unknown id already came back
    // above as a carried `disposition-error`, so nothing is dropped here
    // silently.
    //
    // The mark lands PENDING, and only a PASSING round below turns it into the
    // `retired` one consumers skip. Marking on the fixer's word alone would
    // undo the reason for marking at all: on the paths where the reviewer never
    // accepted the claim — it rejected the retirement, or the cycle errored or
    // hit the round cap before any round passed — the terminal result would
    // read as settled, hiding exactly the decision a stopped run most owes the
    // human. Pending claims accumulate rather than expire when a round fails: a
    // round can fail on something else entirely, and a fixer cannot restate a
    // claim whose finding is no longer carried (there may be no `fixed`/
    // `declined` disposition left to hang it on), so each unaccepted claim is
    // re-presented to the next round until a round passes over it.
    for (const d of fix.dispositions || []) {
      if (!d || (d.disposition !== "fixed" && d.disposition !== "declined")) continue;
      for (const qid of cycleRetiredQuestionIds(d)) {
        // Same snapshot the guard judged, so a rejected retirement (unknown id,
        // or a question this very pass raised) is never applied behind it.
        if (!retirableQuestionIds.has(qid)) continue;
        const q = openQuestions.find((x) => x && x.id === qid && !x.retired && !x.retirementPending);
        if (!q) continue;
        q.retirementPending = { pass: fixerPasses, disposition: d.disposition, findingId: d.findingId || "", detail: d.detail || "" };
        pendingRetirements.push(q);
      }
    }

    // Terminal condition of the disposition rule: the reviewer has passed and
    // the fixer's last pass disposed nothing new (and changed nothing that
    // would need a fresh review). Nothing left for a reviewer to look at.
    //
    // A MOVE OF THE DEVIATION SET is something left to look at, in either
    // direction. The set moves by OMISSION and by first mention rather than on
    // a disposition — which is why a retirement claim can never reach this
    // check (it rides in `dispositions`, so the array is not empty) while a
    // deviation move otherwise would, ending the cycle with it unadjudicated.
    // Dropping one takes it off the maintainer's list unverified; adding one
    // puts it on that list carrying only the implementer's half of the
    // protocol — no reviewer judgment of whether an in-spec route existed, no
    // RATIFY/CONFORM recommendation. Adding one is not an exotic input either:
    // a pass is told to REPORT a deviation rather than correct it, and a
    // deviation is not a finding, so a confirmation pass that first recognizes
    // one leaves `changed` false and `dispositions` empty by following the
    // contract exactly. The conjunct gives every such claim the same shape: it
    // earns a round, a passing round settles it, and the next confirmation
    // pass — restating the set it was shown — terminates here. One extra
    // round, only where a confirmation pass actually moved the set, and
    // bounded by the same cap check below.
    if (confirming && !fix.changed && (fix.dispositions || []).length === 0 && deviationSetChanges === 0) {
      return result("pass", "reviewer passed; final confirmation pass disposed nothing new");
    }

    // Anything else needs a (re-)review — bounded by the cap. This check is
    // reachable at the cap only through a confirmation pass that produced new
    // work: changed content, dispositions of its own, or a move it made to the
    // deviation set — dropping one or first stating one — that no round has
    // adjudicated (a FAILED round at the cap returns below, before another
    // fixer could run and leave never-reviewed changes behind).
    //
    // Those dispositions can themselves breach a contract, and the retirement
    // guard binds on a pass handed nothing — so a confirmation pass that names
    // an unknown (or already-claimed) question id lands its `retire:<id>` entry
    // in `undisposed` on exactly this path. Carrying it out under the SAME
    // `outstanding.carried` key the failed-round cap exit below uses is what
    // makes the breach structurally reportable rather than a generic note; a
    // consumer reading one exit's shape reads this one's.
    if (rounds >= cap) {
      return result("review-cap", `hit the ${cap}-round cap without convergence`, {
        outstanding: {
          note: "final confirmation pass produced work (content changes, dispositions of its own, or a move to the deviation set — a drop, or a newly stated deviation — that no round adjudicated) that could not be re-reviewed within the cap",
          ...(undisposed.length ? { carried: undisposed } : {}),
        },
      });
    }
    rounds += 1;

    const state = {
      round: rounds,
      packet: { ...packet, dispositions: fix.dispositions || [] },
      artifactDir,
      handedFindings: findings,
      proposedRetirements: pendingRetirements,
      peerPreflighted: peerState.preflighted,
      // What still stands after the pass just made — the reviewer adds the
      // in-spec-route judgment and a ratify/conform recommendation to it — plus
      // the ones this pass claims no longer stand, which the same reviewer
      // accepts by passing the round or rejects by raising an issue.
      deviations,
      deviationDrops: pendingDeviationDrops,
    };
    // The peer launches BESIDE the fresh reviewer — the canonical concurrent
    // launch (the examination-only peer is the protocol's sole same-checkout
    // concurrency exception: the reviewer alone owns builds/execution, and two
    // readers are safe). runCyclePeerStage can neither throw nor block the
    // round, so on any peer problem this degrades to the reviewer's verdict
    // exactly as a sequential launch would.
    const [review, rawPeer] = await parallel([
      () =>
        agent(cycleReviewPrompt(cycle, state), {
          label: `${lp}review#${rounds}`,
          schema: CYCLE_REVIEW_SCHEMA,
        }),
      async () =>
        // `disabled` wins over sticky unavailability: under a SHARED peerState
        // a sibling's `unavailable` must not relabel a peer-off cycle's rounds.
        cycle.peer !== "off" && peerState.unavailable
          ? { outcome: "unavailable", findings: [], notes: "", detail: peerState.unavailableDetail || "peer marked unavailable earlier this run" }
          : runCyclePeerStage(cycle, state),
    ]);
    // Re-normalizing is idempotent for the stage's own results and guards the
    // one path it cannot: a runtime that hands back a null parallel slot. The
    // cycle's `disabled` outcome is not helper vocabulary, so carry it as-is.
    const peer = rawPeer && rawPeer.outcome === "disabled" ? rawPeer : normalizeCyclePeerResult(rawPeer);
    peerRounds.push({ round: rounds, outcome: peer.outcome, detail: peer.detail });
    if (peer.outcome === "unavailable") {
      peerState.unavailable = true;
      if (peer.detail && !peerState.unavailableDetail) peerState.unavailableDetail = peer.detail;
    } else if (peer.outcome !== "disabled" && !peer.synthesized) {
      // The preflight is demonstrably done only when a peer SUBAGENT actually
      // reported back. A script-synthesized forfeit (dead/schema-failed
      // subagent, thrown stage, null parallel slot) proves nothing ran, so the
      // next round must still probe rather than skip on a false "an earlier
      // round verified the binary and login".
      peerState.preflighted = true;
    }

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

    // Deviation coverage, the mirror of disposition coverage: every deviation
    // this pass says still STANDS must carry the reviewer's half — in-spec
    // route and a recommendation that actually reads as one of the two verdicts
    // (`cycleDeviationVerdict`) — before a round may pass over
    // it. A claimed drop is exempt because passing the round is what removes
    // it; a drop the reviewer rejects raises an issue, which fails the round
    // and brings the deviation back to the next one for assessment.
    //
    // Asked only of a round that would OTHERWISE pass, exactly as the grounding
    // spot-check is: a round already failing on findings sends the fixer work
    // it can do, and adding one it CANNOT — the reviewer's own judgment — would
    // make every failed round carrying a deviation cost an extra pass to
    // dispose a finding the next reviewer answers by itself.
    const wouldPass = !!review.pass && peerGating.length === 0 && undisposed.length === 0;
    const assessments = Array.isArray(review.deviationAssessments) ? review.deviationAssessments : [];
    // Keyed by deviation text, the FIRST usable entry winning, because what the
    // round gates on is exactly what it may publish. The gate needs only ONE
    // usable entry per standing deviation, so recording the raw array instead
    // would let a second, hedged entry for the same deviation ride to the
    // maintainer beside the valid one — reinstating in what SHIPS the
    // present-or-absent reading `cycleDeviationVerdict` closed in what is
    // CHECKED. An entry the gate could not use is nobody's half of anything.
    const usableAssessments = new Map();
    for (const a of assessments) {
      if (!a || typeof a.deviation !== "string") continue;
      if (!String(a.inSpecRoute || "").trim() || !cycleDeviationVerdict(a.recommendation)) continue;
      if (!usableAssessments.has(a.deviation)) usableAssessments.set(a.deviation, a);
    }
    const assessed = new Set(usableAssessments.keys());
    const unassessedDeviations = wouldPass ? restated.filter((d) => !assessed.has(d)) : [];
    // Handed to the next fixer as findings of their own, because that is the
    // only channel this loop has back into a round. The fixer cannot supply the
    // reviewer's judgment, so the fix text says outright what it must NOT do:
    // conforming the deviation away to clear the finding is the exact move
    // report-don't-correct exists to prevent.
    const assessmentIssues = unassessedDeviations.map((d) => ({
      category: "criteria-gap",
      location: "locked-decision deviation standing on this packet",
      problem: `This round's reviewer returned no usable \`deviationAssessments\` entry for a deviation that still stands: ${JSON.stringify(d)} — either no entry at all, or one missing the in-spec-route judgment, or one whose \`recommendation\` does not lead with ${CYCLE_DEVIATION_VERDICTS.join(" or ")} (a hedge is not a verdict). It would reach the maintainer carrying only the implementer's half of report-don't-correct — no judgment of whether an in-spec route existed, no RATIFY/CONFORM recommendation.`,
      fix: "Do NOT conform, reword, or drop the deviation to clear this — report, don't correct: restate it VERBATIM as before. Decline this finding on that ground; the next fresh reviewer is asked for the missing assessment.",
    }));

    // The round passes only when the reviewer passes, no grounded peer finding
    // gates, every finding handed to this round's fixer was validly disposed —
    // an uncovered finding fails the round and is carried forward, so the
    // terminal pass can never leave a finding without a disposition — AND every
    // standing deviation was assessed.
    const roundPassed = wouldPass && unassessedDeviations.length === 0;
    if (!roundPassed) {
      confirming = false;
      findings = {
        carried: undisposed,
        // `id` is spread LAST so the script-assigned, round-scoped id stays
        // authoritative even when an agent's finding object volunteers its own
        // `id` field (coverage matching depends on these exact string ids; an
        // agent-supplied one — a number, say — would be uncoverable).
        reviewer: [...(review.issues || []), ...assessmentIssues].map((f, i) => ({ ...f, id: `r${rounds}-${i + 1}` })),
        reviewerNotes: review.notes || "",
        peer: peerGating.map((f, i) => ({ ...f, id: `p${rounds}-${i + 1}` })),
        peerNotes: peer.notes || "",
      };
      // A failed round at the cap stops HERE — no further fixer pass may run,
      // or its changes would land committed but never reviewed.
      if (rounds >= cap) {
        return result("review-cap", `hit the ${cap}-round cap without convergence`, { outstanding: findings });
      }
      continue;
    }

    // The round passed with every pending retirement in view, so the fresh
    // reviewer accepted each claim the same way it accepted this round's
    // declines: they become `retired` — the state a consumer serving questions
    // to a human skips — and stop being re-presented. Promoted HERE, before
    // either terminal pass path, so a `pass` verdict never ships a claim in the
    // pending state and a stopped run never ships one in the settled state.
    for (const q of pendingRetirements) {
      q.retired = q.retirementPending;
      delete q.retirementPending;
    }
    pendingRetirements.length = 0;
    // The same verdict settles the deviation drops this round was shown: the
    // fresh reviewer saw each claim beside what still stands and passed, so
    // those deviations stop standing. Promoted HERE too, before either terminal
    // pass path, so no exit can drop a deviation no round accepted.
    if (pendingDeviationDrops.length) {
      deviations = deviations.filter((d) => !pendingDeviationDrops.includes(d));
      pendingDeviationDrops = [];
    }
    // And the same verdict accepts the reviewer's half for what still stands —
    // the entries the gate above found usable, at most one per deviation, not
    // the raw array it read them out of. Recorded only on a PASSING round,
    // beside the claims it settles: an assessment from a round that failed
    // judged a packet the fixer has since changed.
    deviationAssessments = [...usableAssessments.values()];

    // Round passed. light mode ends here, recording undisposed remarks as such.
    if (cycle.mode === "light") {
      return result("pass", "reviewer passed (light mode: final confirmation pass skipped)", {
        undisposed: [review.notes, peer.notes].filter(Boolean),
      });
    }

    // Full mode: one final fixer confirmation pass over the passing reports, so
    // pass-notes get considered by an agent with full context, never dropped by
    // the orchestrator. If it disposes nothing new, the loop terminates above;
    // anything it fixes or disputes goes through another reviewer round.
    confirming = true;
    findings = {
      carried: [],
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

// The scope agent runs OUTSIDE the embeddable section, so nothing placed at the
// `cycleContract()` call sites reaches it. Same boundary, stated for a brief
// that carries no worktree contract to hang it off: identical to the one
// `wf-address-review.js` states for its own two agents.
const DESTROY_BOUNDARY = `## DESTROY BOUNDARY

Permitted: reading, searching, read-only \`git\`/\`gh\` queries, and the specific mutations this assignment spells out.
Forbidden: \`rm -rf\`, \`git reset --hard\`, \`git clean\`, \`git branch -f\`, \`git update-ref\`, \`git gc\`, and force-pushing — each of them beyond what this assignment itself spells out, whether as an exact command or as a skill it names to invoke — NOT in a clone, NOT in a temp directory, NOT "safely". You may not self-authorize one by putting yourself somewhere you believe is safe; what this assignment spells out, and the disposable clone below, are the only exemptions — and only because this assignment names them, not because a clone is safe.
A worktree is not a blast radius: it isolates the working tree, not the repository, so \`branch -f\`, \`reset\`, \`update-ref\`, and \`gc\` reach every sibling worktree through the shared \`.git\`.
Empirical verification that could change state belongs ONLY in a disposable clone. Run \`command -v dc-enter\`; where it is found, work in \`DC="$(dc-enter <slug>)"\` — it prints one absolute path on stdout, \`dc-remove <slug>\` drops it, and a reused slug is REFUSED rather than re-derived, so pass \`--replace\` or remove the slug first if this may run twice. Where the helper is absent, use an absolute path outside the repository — never a relative one, and never the repository itself.`;

function scopePrompt(input) {
  return `You are scoping one review cycle. Read the repository's agent-context files (\`AGENTS.md\` / \`CLAUDE.md\`) first. This is scoping only — edit nothing, commit nothing.

${DESTROY_BOUNDARY}

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

// In structured mode trust ONLY the structured field, like the sibling flags
// (mode, maxRounds): flattening the object would regex-scan scope.items —
// verbatim third-party content such as PR review-thread bodies — where a
// merely QUOTED `peer-opinions=off` token must not disable the peer.
const peerOff = structured
  ? args.peer === "off"
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
// Retired questions stay in the result (marked) but are settled, so the
// headline counts only the ones still awaiting a human. A retirement no round
// ever accepted is NOT settled: it counts as open, and is called out so the
// tail of an errored or capped run is not read as one decision lighter.
const retiredQuestions = cycleResult.openQuestions.filter((q) => q && q.retired).length;
const unacceptedRetirements = cycleResult.openQuestions.filter((q) => q && !q.retired && q.retirementPending).length;
log(`review-cycle ${cycleConfig.slug}: ${cycleResult.verdict} after ${cycleResult.rounds} reviewer round(s); ${cycleResult.openQuestions.length - retiredQuestions} open question(s)${unacceptedRetirements ? ` (${unacceptedRetirements} carrying a retirement claim no round accepted)` : ""}${retiredQuestions ? ` (+${retiredQuestions} retired by a later pass)` : ""}; peer: ${cycleResult.peerRounds.map((p) => p.outcome).join(", ") || "n/a"}.`);
return {
  target: { slug: cycleConfig.slug, worktree: cycleConfig.worktree, branch: cycleConfig.branch, base: cycleConfig.base, artifactType: cycleConfig.artifactType },
  mode: cycleConfig.mode,
  peer: cycleConfig.peer,
  ...cycleResult,
};
