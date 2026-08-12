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
 *   - closeOut      "off" (default) | "on" — grants the trivial-round
 *                   close-out: a pass that FIXED every finding it was handed
 *                   and whose whole change is non-semantic may conclude the
 *                   cycle without another reviewer round, once a cheap
 *                   read-only check confirms that on the DIFF
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
 * schema powbox.peer-review-run/v1) — but NOT YET, for TWO prerequisites. On
 * strength, the effort half already works: the helper takes `--model` and
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
 * configured model through (https://github.com/Roubtec/powbox/issues/145), AND
 * until the schema exposes the full provider-neutral review through a
 * documented `reviewFile` or `reviewText` field rather than only an
 * `artifactDir`, the stage's subagent runs the PINNED RAW LAUNCH
 * (codex exec with `-c model_reasoning_effort=medium`; the model stays the
 * peer's configured high-capability default from ~/.codex/config.toml). When it
 * BOTH land, the swap to `peer-review-run --provider codex --worktree ...
 * --prompt-file ... --artifact-root ... --timeout N --effort medium` (flag
 * spelling transcribed from the shipped helper, with --timeout sized under the
 * subagent's own Bash-tool limit, and --effort stated explicitly because the
 * helper's own default is `high`) is task 015's; the outcome vocabulary below
 * already matches the helper's, so the swap is a prompt change, not a
 * control-flow change.
 *
 * Peer concurrency follows the canonical optimistic session-local adaptive
 * throttle below: unbounded until a qualifying trouble outcome, then queued
 * behind the exact capped generations task 015 defines. A fan-out embedding
 * shares one throttle object across every child cycle.
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
    closeOutEdits: { type: "array", items: { type: "string" }, description: "OFFER of a trivial-round close-out (only where the assignment says the invoker granted it): one entry per edit, where this pass's WHOLE change was non-semantic — wording, typos, comment phrasing, formatting; nothing touching behavior, logic, or the meaning of an acceptance criterion. Empty otherwise. The offer is not the license: the cycle re-reads the close-out diff itself, and any executable or behavioral change in it, however it got there, forfeits the close-out for a normal reviewer round — as does an empty range, an edit listed here that the range does not actually carry, or a finding disposed `fixed` that the range holds no change for, since this list cannot vouch for a fix it does not mention." },
    flakeRecord: { type: "string", description: "REQUIRED when this pass's own validation run hit a failure the cycle's flake rule defers as evidenced-unrelated: what failed, the evidence that established unrelatedness, and the follow-up task carrying it — the NEW one this pass committed, or the ACTIVE existing one it cites instead of editing. Empty otherwise, and never a restatement of an earlier pass's record — report only what YOUR OWN run surfaced. The cycle keeps every pass's, so copying an earlier one forward would republish it as your run's; a failure your own run hit AGAIN is your run's record and no restatement at all, so report it. This is the maintainer's only notice that a validation run FAILED, so the cycle carries EVERY pass's record in the run report it returns (the batch summary, where the consumer has one), and publishes the CONCLUDING pass's in the PR body or summary comment besides — including where citing an existing task left that pass with nothing to commit. It buys no exit and skips no round of its own — what a conclusion may skip is licensed by a read of the DIFF — but omitting a record your run owes costs the round that record would have skipped." },
    finalSha: { type: "string", description: "HEAD sha after this pass, with everything committed." },
    clean: { type: "boolean", description: "True only if the worktree is CLEAN and IDLE: `git status --porcelain` empty with every intended change committed, AND no Git operation in progress (`git rev-parse --git-path rebase-merge` / `rebase-apply`, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG`). A packet returned mid-rebase or mid-cherry-pick can print empty porcelain; the cycle refuses it either way. This is a self-report and is not taken as the answer: the cycle MEASURES the same worktree itself the moment your packet returns, so a `clean` the measurement contradicts costs the pass." },
    artifactDir: { type: "string", description: "Absolute path of this cycle's unique artifact directory — REQUIRED every pass: round 1 creates it (outside the worktree) and reports it, later passes echo the directory they were given. The result contract promises full round history reachable through it." },
  },
  required: ["changed", "dispositions", "openQuestions", "deviations", "flakeRecord", "clean", "artifactDir"],
};

// The INDEPENDENT measurement of the worktree a fix packet came back from —
// what `clean` above only asks for. The precise failure the packet hard-check
// exists to contain is a pass that returns `clean: true` from a tree still
// mid-rebase or mid-cherry-pick: such a tree prints EMPTY porcelain, so the
// fixer's own reading can be sincere and wrong, and nothing but the fixer ever
// looked at it. Modelled on `wf-address-tasks.js`'s `MAIN_CHECKOUT_SCHEMA`,
// its `measured: false` degradation included: a reading that could not be taken
// is UNKNOWN, and the one thing it must never read as is clean.
const CYCLE_PACKET_CHECK_SCHEMA = {
  type: "object",
  properties: {
    measured: { type: "boolean", description: "True only if BOTH readings ran and produced definitive answers — the porcelain status AND every operation-state marker. False when either could not be taken; `dirty` and `operation` are then best-effort and must NOT be read as clean." },
    dirty: { type: "array", items: { type: "string" }, description: "One `git status --porcelain -z --untracked-files=all` record per changed path: the 2-character `XY` status field, a space, then the repo-relative path (the current path for a rename/copy). The `XY ` prefix is kept verbatim — its first column can be a space. Empty when the tree is clean." },
    operation: { type: "string", description: "The Git operation still in progress, named by the state marker that showed it — `rebase-merge`, `rebase-apply`, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG` — or EMPTY when none is. Name the marker you actually found, never an inference: most of these leave the porcelain clean, which is the whole reason this reading is taken separately." },
    detail: { type: "string", description: "One line: what the readings found, or — when `measured` is false — which reading could not be taken and why." },
  },
  required: ["measured", "dirty", "operation", "detail"],
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
          recommendation: { type: "string", description: "Your verdict as the FIRST word — RATIFY or CONFORM, the whole vocabulary — then the one-line reason. A hedge (`UNSURE`, `needs investigation`) is not a verdict and leaves the deviation unassessed, which does not pass the round. Opening with both — `RATIFY or CONFORM …` — is a refusal to choose and is rejected as one, not read as RATIFY; otherwise the first word is taken literally, so lead with the verdict you mean, and lead with neither if you cannot choose. You recommend; the maintainer decides." },
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
// verdict is not a verdict. One hedge opens with one and is still not a choice,
// and it is the one an ordinary round reaches rather than hand-crafted input:
// the brief renders `START with RATIFY or CONFORM` and the schema repeats that
// the two are the whole vocabulary, so `RATIFY or CONFORM — needs
// investigation` is the brief's own surface form echoed back, and reading it as
// RATIFY would hand the maintainer a verdict from a reviewer that explicitly
// refused to give one. That exact shape is rejected by name — the two verdicts
// joined by a bare `or`. It leaves `RATIFY — CONFORM costs a release` alone, a
// real choice whose reason names the other verdict, because what follows the
// verdict there is a separator rather than the word `or`. Nothing wider is
// claimed: a reason that retracts its verdict in any other wording still reads
// as that verdict, which is why the schema and the brief also warn that the
// first word is taken literally, and the maintainer reads the whole
// `recommendation` text either way.
const CYCLE_DEVIATION_VERDICTS = ["RATIFY", "CONFORM"];
const CYCLE_DEVIATION_HEDGE = /^(?:RATIFY|CONFORM)\s+OR\s+(?:RATIFY|CONFORM)\b/;
function cycleDeviationVerdict(recommendation) {
  // Leading punctuation and emphasis are stripped, so `**RATIFY** — …` reads as
  // the verdict it plainly is. A longer word that merely starts with one does
  // not: the character after the verdict must not continue it.
  const text = String(recommendation || "").trim().toUpperCase().replace(/^[^A-Z]+/, "");
  if (CYCLE_DEVIATION_HEDGE.test(text)) return "";
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
    reason: { type: "string", description: "The provider/helper reason verbatim; distinguishes empty/garbled forfeitures for the adaptive throttle." },
  },
  required: ["outcome", "findings"],
};

const CYCLE_PEER_PREFLIGHT_SCHEMA = {
  type: "object",
  properties: {
    outcome: { type: "string", description: "available | unavailable" },
    detail: { type: "string", description: "Empty when available; exact missing-binary or logged-out diagnostic when unavailable." },
  },
  required: ["outcome", "detail"],
};

// Verdict of the trivial-round close-out's diff check — the orchestrator's own
// look at what would ship unreviewed, delegated the only way a script that
// cannot run git can look at a diff. It asks TWO questions, one per direction
// the list and the diff can disagree: `nonSemantic` stops the list licensing
// what the diff actually holds, and `editsPresent` stops the pass claiming a
// fix the diff never received. Only the first was asked at first, which left
// an empty range VACUOUSLY non-semantic — so a pass reporting findings `fixed`
// with nothing committed concluded the cycle, its claims adjudicated by
// exactly nobody, since the round that would have caught it is the round this
// exit skips.
//
// `editsPresent` is asked about the pass's WHOLE claim — the edits it listed
// AND the findings it disposed `fixed` — because the two can come apart while
// the range stays non-empty. A pass that forgot one requested fix and shipped
// an unrelated comment tidy-up it did list satisfies a check that only knows
// the list: every listed edit is there, the range is not empty, and the
// forgotten fix is checked by nobody, since the round that would have caught
// it is again the one this exit skips. The `fixed` dispositions therefore
// travel with the list.
const CYCLE_CLOSEOUT_SCHEMA = {
  type: "object",
  properties: {
    nonSemantic: { type: "boolean", description: "True ONLY if every hunk of the close-out diff is non-semantic. Any executable or behavioral change — however it got there, listed or not — is false, which simply buys the normal reviewer round." },
    editsPresent: { type: "boolean", description: "True ONLY if the range is NON-EMPTY and carries everything the pass claims it shipped: every edit it listed, AND a change answering every finding it disposed `fixed`. An EMPTY range is false: it holds no fix at all, so a finding reported `fixed` over it never landed. A claimed edit, or a claimed fix, you cannot find in the diff is false too — an unrelated tidy-up that IS in the range does not stand in for a requested fix that is not. Extra non-semantic hunks beyond the list do not make it false — `nonSemantic` judges those on their own merits." },
    why: { type: "string", description: "One line: what the diff held, or the semantic change, missing claimed edit, or unlanded `fixed` claim that forfeits the close-out." },
  },
  required: ["nonSemantic", "editsPresent", "why"],
};

// Verdict of the record-only check — the same look at a diff, asked of the one
// post-run commit the delivery gate tolerates. Nothing about the pass's own
// account of that commit reaches this check: a tolerance a fixer could
// self-certify is the evasion route the flake rule's evidence requirement
// exists to close, so the range is the only evidence there is.
const CYCLE_RECORD_ONLY_SCHEMA = {
  type: "object",
  properties: {
    recordOnly: { type: "boolean", description: "True ONLY if the range holds nothing but the unrelated-flake RECORD: a NEW diagnosis-only follow-up task file, plus any PR-body or summary note recording what the delivery run surfaced. Any other hunk — a source, test, config, or contract edit, a change to the failing test itself, anything touching the artifact under review — is false, which simply buys the normal reviewer round." },
    why: { type: "string", description: "One line: what the range held, or the change that forfeits the tolerance." },
  },
  required: ["recordOnly", "why"],
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
Address any repository other than your own checkout BY PATH: \`git -C <absolute path>\`. NEVER derive a working directory from a glob, and NEVER chain a state-changing git command after a \`cd\` whose success you have not checked.
Empirical verification that could change state belongs ONLY in a disposable clone. Run \`command -v dc-enter\`; where it is found, work in \`DC="$(dc-enter <slug>)"\` — it prints one absolute path on stdout, \`dc-remove <slug>\` drops it, and a reused slug is REFUSED rather than re-derived, so pass \`--replace\` or remove the slug first if this may run twice. Where the helper is absent, use an absolute path outside the repository — never a relative one, and never the repository itself. Never \`cd\` into a path held in a variable unguarded: \`cd ""\` returns 0 and moves nowhere, so checking the status catches nothing and a lookup that produced no path leaves you in the shared checkout. Write \`cd -- "\${DC:?dc-enter returned no path}"\`, and confirm \`pwd\` before the first command that writes.`;

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

// Unrelated-flake deferral, carried by the fixer: one batch run had every
// implementer independently burn most of its rounds stabilizing the same
// unrelated flaky suite. "Unrelated" is a DEMONSTRATED property (it reproduces
// on the base), never an assertion of convenience and never an inference from
// which code paths the failure happens to run through.
const CYCLE_FLAKE_POLICY = `When a test fails in an area this branch did not touch, do NOT iterate on stabilizing it here — but establish unrelatedness with EVIDENCE first: the failure must REPRODUCE on the base, or on an equivalently controlled comparison holding this branch's own changes out, with at most ONE rerun to confirm intermittence. That reproduction is the proof and nothing else substitutes for it: a failure confined to code paths the branch never edited is a supporting signal ONLY, since a change to a shared utility, a dependency, an environment setting, or a generated input breaks tests whose whole execution stays in untouched code. Evidenced unrelated: queue a follow-up task carrying ONLY the diagnosis already in hand (no further investigation), written under the repository's \`write-tasks\` conventions and committed on this branch, record the flake in \`flakeRecord\` — the field the cycle carries to the PR body or batch summary — so the maintainer can judge, and proceed to delivery with the failure documented — where the DELIVERY run itself surfaced it, commit that task after the run WITHOUT rerunning the suite (that record-only commit is the one thing a completed delivery pass survives). Name the failing suite or test in the task TITLE so a sibling's copy is greppable, and grep the task folder for an existing task on that suite first: an ACTIVE match means the queue entry already exists, so cite it in \`flakeRecord\` and carry your new evidence there rather than editing that task file (a base-landed file edited from several sibling branches at once turns cheap duplicate cleanup into a merge conflict at every merge) — that path commits nothing, and \`flakeRecord\` is then the whole record the maintainer gets, while a match only under \`done/\`/\`deferred/\` is context to cite beside a new schedulable queue entry. Duplicate flake tasks are ACCEPTABLE — far cheaper than concurrent stabilization attempts — and that grep BOUNDS the duplication rather than preventing it: it sees an already-landed task and one this same branch wrote, never a concurrent sibling implementer's, which lives on that sibling's branch and is invisible from here; consolidating whatever lands is the maintainer's next reaping sweep. INCONCLUSIVE is the third outcome, and for an intermittent failure the common one: an attempt that neither confirms nor refutes within the one-rerun bound is recorded as inconclusive, which is NOT unrelated — do not enter the stabilization loop and do not deliver; return it as your \`blocker\` with the failure, what the attempt showed, and any supporting signal, for the maintainer's defer-or-stabilize decision.`;

// The reviewer's half of the same policy — a gate amendment, stated where the
// gate is: the automatic-blocker rule is build/typecheck-specific, and this
// extends its spirit to tests without extending it one step further.
//
// It names BOTH outcomes the fixer's half admits, because the two are one
// disposition with two shapes: a NEW diagnosis task committed here, or an
// already-ACTIVE task cited instead — which that half prescribes precisely so
// a sibling branch does not edit a base-landed file. Recognizing only the
// committed one would make this gate block the outcome the policy asks for,
// on every required round and especially `light` mode's last one, and drive a
// conforming cycle to its cap over a task file the policy told it not to write.
const CYCLE_FLAKE_REVIEW = `A documented, evidenced UNRELATED test failure — reproduced on the base per the cycle's flake rule, with the diagnosis-only follow-up task that rule requires on record: either a NEW one committed on this branch, or the ACTIVE existing task the pass cited instead of duplicating or editing it — is NON-BLOCKING for you once you have SEEN that task. The cited-task shape leaves nothing in this branch's diff by design, and you are not shown the pass's own flake record, so verify the citation where you CAN see it: grep the repository's task folder for an ACTIVE task naming the suite that failed in your own run — the flake rule puts that name in the task TITLE for exactly this reason — rather than expecting a new file in the diff; a failure you can tie to no such task is not documented, and stays blocking. So does any failure this branch plausibly caused, and any reproduction attempt recorded as inconclusive.`;

// Comment discipline, carried by the fixer. A review round asking for
// documentation reliably produces the function re-implemented in prose right
// above it: non-executable duplicate content that drifts, then spends rounds of
// its own on comment correctness. The routing half is what makes the rule
// answerable — rationale that fails the test has somewhere to go.
const CYCLE_COMMENT_DISCIPLINE = `Ship only comments that outlive the PR. A code comment earns its keep only where it still does once the PR closes — why an arbitrary constant or choice is what it is, an external constraint that shaped a decision, a non-obvious invariant or tradeoff the code relies on but cannot express (why an ordering prevents a deadlock, why apparently redundant synchronization is needed), or a still-standing deliberately-overruled review decision, which you MAY record so the point is not re-raised. Never ship prose restating what adjacent code does — an outcome matrix, condition-by-condition narration, anything the code itself gives a reader with minimal effort; self-documenting code is the goal and the comment is the bounded exception for what code cannot show, not a default channel. The test governs explanatory comments, not the repository's own documented documentation convention: where one requires docstrings or API documentation on a public surface, that convention stands untouched. Reasoning that fails the test still has a home: rationale addressed to the people watching this diff goes in a PR reply or the summary comment, which the closing PR leaves behind exactly as it should, and durable knowledge too bulky for a why-comment goes to the repository's docs area (commonly \`docs/\`) — a routing option, never a per-PR ritual. Carry CURRENT rationale only: where a change supersedes a commented decision, the standing overruled one included, replace that comment rather than appending to it (version control holds the history), and delete a comment the code has outgrown instead of precision-editing it.`;

// The reviewer's half of the same rule — an amendment to what counts as a
// finding, stated where findings are opened: the fixer's half cannot stop the
// churn a review round starts.
const CYCLE_COMMENT_REVIEW = `Weight code comments by whether they outlive the PR: one re-implementing adjacent code in prose — an outcome matrix, condition-by-condition narration — is removable noise to flag for DELETION rather than material to precision-edit, and absent behavior-narration is never a gap to report unless the repository's own documented documentation convention requires it.`;

// Which validation tier a pass owes, decided by position: an intermediate pass
// owes the ROUND tier (the cheapest signal covering what it changed), while any
// pass that can be the cycle's LAST owes the DELIVERY tier — the confirmation
// pass, and every pass under `light`, which skips that confirmation pass and so
// can end the cycle on any passing round. A pass offering a trivial-round
// close-out is the third such case; its brief says so rather than being
// detectable here, since the offer arrives with the packet.
function cycleValidationTier(cycle, state) {
  return state.confirming || cycle.mode === "light" ? "delivery" : "round";
}

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
//
// The branch assertion is every role's but the MEASURER's, and is dropped for
// that role rather than excepted around: a rebase and a bisect leave HEAD
// DETACHED, so `git branch --show-current` prints EMPTY — which "differs" from
// the branch name — and a detached HEAD is one of the states the measurer is
// sent to find. Asserting the branch stops it before either reading, so the
// flagship case the measurement exists for (a tree left mid-rebase, whose
// porcelain is empty) would come back `measured: false` instead of naming the
// marker that failed. What a measurer needs is the right WORKTREE, which the
// path assertion establishes on its own; the branch adds nothing to two
// read-only readings and forbids the one they exist for.
function cycleDefaultContract(cycle, role) {
  const where = cycle.worktree
    ? `Your worktree is \`${cycle.worktree}\`. Before anything else, \`cd\` into it and verify \`git rev-parse --show-toplevel\` prints exactly that path; if not, STOP and report — do not run any git or edit command outside it. Other agents may be working in other worktrees concurrently; stay in yours.`
    : `You work in the repository's current checkout — do NOT create a worktree and do NOT switch branches.`;
  return role === "measurer"
    ? `${where}
HEAD there may be DETACHED — a rebase or a bisect leaves it so, and \`git branch --show-current\` then prints nothing at all. That is not a mismatch to stop on: it is one of the states you were sent to read. Switch, attach, or restore no branch.`
    : `${where}
You must be on branch \`${cycle.branch}\` — confirm with \`git branch --show-current\`; if it differs, STOP and report.`;
}

function cycleContract(cycle, role) {
  const contracts = cycle.contracts || {};
  return contracts[role] || cycleDefaultContract(cycle, role);
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
  const tierLine = cycleValidationTier(cycle, state) === "delivery"
    ? `DELIVERY TIER — this pass can be the cycle's last, so validate the FINAL state with the full applicable sanity set: lint, typecheck, build, tests, whichever this repository has. The cycle may not conclude or publish on less, and nothing downstream re-runs it. Two bounded exceptions, and no others: a completed run whose ONLY failures carry the evidenced-unrelated disposition below counts as this pass, with those failures documented for the maintainer; and the pass survives that rule's record-only follow-up commit (the flake task file, plus any PR-body or summary note recording what this run surfaced). Any other change committed after the run voids the pass and reruns the tier — prose here carries behavior (a prompt's text, a config or contract expressed as text), and no later check exists to catch what a wider tolerance would admit.`
    : `ROUND TIER — the cheapest signal that catches what YOU changed: typecheck/lint for ordinary code edits, targeted tests for touched behavior, and no build at all where this round's diff holds no executable change (comments, prose, docs). When in doubt about blast radius run more, not less, and always build a round touching build configuration, dependencies, or generated contracts. Intermediate pushes the assignment mandates for durability are not delivery events and never raise this tier. Say in \`summary\` what you actually ran: this round's reviewer is told the tier and will not block on a heavier suite it did not cover.`;
  const closeOutLine = cycle.closeOut === "on"
    ? `\n- TRIVIAL-ROUND CLOSE-OUT is granted for this cycle (the invoker's bounded discretion, distinct from \`light\`): where this round's REMAINING findings are exclusively NON-SEMANTIC — wording, typos, comment phrasing, formatting; nothing touching behavior, logic, or the meaning of an acceptance criterion — and you FIXED every one of them, list the edits you shipped in \`closeOutEdits\` and the cycle may conclude without another reviewer round. Every finding still gets its explicit disposition; the offer never swallows one — and a \`declined\` or \`escalated\` disposition anywhere on this pass forfeits the offer outright, since that claim is the next fresh reviewer's to adjudicate and leaves NOTHING in the diff for the check below to see. Offer it on the merits only: the license is judged on the DIFF, not on your list, so any executable or behavioral change in the same diff forfeits the close-out and buys a normal round — and the same read checks your whole claim back the other way, against the \`fixed\` dispositions as well as the list, so an empty range, an edit you list that the range does not carry, or a finding you report \`fixed\` that the range holds no change for, forfeits it too. Offering it is offering to CONCLUDE the cycle, so run the DELIVERY tier over the final state as well — the close-out skips the re-review, never that gate.`
    : "";
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
- Commit at logical milestones, and validate at THIS PASS'S TIER (code artifacts). ${tierLine}${closeOutLine}
- ${CYCLE_FLAKE_POLICY}
- A sweep ("fix this pattern everywhere") is ENUMERATED, never asserted: return the explicit search space with a per-item verdict, and claim a completed sweep in a commit message only where you enumerated that space. This round's reviewer redoes the enumeration rather than spot-checking yours.
- ${CYCLE_COMMENT_DISCIPLINE}
- ${CYCLE_CARRIED_CLAIMS}
- ${CYCLE_FINISH_IN_TURN} ${CYCLE_NO_SELF_PEER}
- If you must deliver something other than a decision the maintainer LOCKED, do not silently conform or correct: report it in \`deviations\` — what you delivered instead and the constraint that forced it — and restate it VERBATIM on every later pass while it stands. The cycle surfaces it for the human (report, don't correct), who ratifies it or asks you to conform; it buys no slack in the meantime, since completeness, tests, and regressions are graded exactly as strictly.
- Every \`escalated\` disposition gets an \`openQuestions\` entry in the schema's pinned format, under an id no earlier pass used (re-using one reads as a re-report of that pass's question, which the cycle keeps instead of yours), with authoritative artifact pointers (file:line, refs) — never paraphrase — and its \`questionId\` back-reference — which must name a question this cycle carries LIVE (the one you just raised, or one an earlier pass raised that no retirement has claimed); an absent, empty, or settled id names no decision the maintainer will be asked to make and comes back to the next pass as a disposition error. Raise a question only for a decision still open: a \`fixed\` or \`declined\` disposition that SETTLES a still-live question from an EARLIER pass names that question's \`id\` in \`retiresQuestionIds\` instead (only those two dispositions retire; a question this pass raises cannot also be retired by it; and retiring an id the cycle does not carry open from an earlier pass comes back to the next pass as a disposition error).
- Before returning, the worktree MUST be clean AND idle: \`git status --porcelain\` empty with every intended change committed, and no Git operation in progress — check \`git rev-parse --git-path rebase-merge\` and \`rebase-apply\` for an existing path, plus \`MERGE_HEAD\`, \`CHERRY_PICK_HEAD\`, \`REVERT_HEAD\`, \`BISECT_LOG\` (a tree left mid-rebase or mid-cherry-pick can print empty porcelain). Set \`clean\` and \`finalSha\` accordingly; either condition failing is resolved or reported as a \`blocker\`, never handed to review. The cycle MEASURES the same worktree itself the moment your packet returns, through a turn that is told nothing about your pass — so \`clean\` is checked, not taken, and a reading that contradicts it costs the pass. Report what is true rather than what ends the round.
- Pushing is governed by the assignment above; do nothing PR-side, and do NOT use the \`TaskCreate\`/\`TaskUpdate\`/\`TaskList\` tools.

Return the structured packet, including \`workReport\` per the assignment's per-item contract when it defines one.`;
}

function cycleReviewChecks(artifactType, tier) {
  if (artifactType === "prose") {
    return `This is a PROSE artifact (a drafted task file or document); there is no build to run. Check verbiage, scoping, internal consistency, and the repository's house conventions — for task files, the documented numbering style (see the tasks folder's AGENTS.md where present). Read each drafted file in full.`;
  }
  // The build-first rule applies AT the tier the orchestrator stated, not
  // unconditionally: told "round tier", a reviewer must not block on a suite
  // this round deliberately did not run; told nothing, it runs the full set.
  // Only the ROUND tier is opt-in, and the default is that way round on
  // purpose: an unstated tier is what a renderer with no cycle behind it would
  // leave, and no shipped caller is in that position today — every one states
  // its tier — so the default is purely defensive, and the fail-safe answer for
  // a renderer whose pass could be the last thing before publication is the
  // heavier suite, never the cheaper one.
  const tierLine = tier === "round"
    ? `the ROUND tier — the cheapest signal that catches what this round's diff changed (typecheck/lint for ordinary code edits, targeted tests for touched behavior, and no build at all where the diff holds no executable change), so do NOT block on a heavier suite this tier does not run; when in doubt about blast radius run more, not less, and always build where the diff touches build configuration, dependencies, or generated contracts`
    : `the DELIVERY tier — the full applicable sanity set (lint, typecheck, build, tests, whichever this repository has), because the cycle concludes on this state`;
  if (artifactType === "decision") {
    return `This is an APPLIED-DECISION diff. Verify the diff implements exactly the locked option and nothing beyond it, then do the quality pass (logic, error handling, edge cases, dead code, consistency, duplication, type safety) on the touched files. ${CYCLE_COMMENT_REVIEW} Run the build/type-check first at ${tierLine}; a failure at that tier is an automatic blocker. ${CYCLE_FLAKE_REVIEW}`;
  }
  return `This is a CODE artifact. Run the build/type-check FIRST at ${tierLine}; a failure at that tier is an automatic blocker (\`pass: false\`). ${CYCLE_FLAKE_REVIEW} Check every acceptance criterion the work items state against the actual code, then do the quality pass (logic, error handling, edge cases, dead code, consistency, duplication, type safety) on the touched files. ${CYCLE_COMMENT_REVIEW}`;
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
    ? `\n## Deviations from LOCKED decisions standing on this packet (verbatim)\n\nReturn ONE \`deviationAssessments\` entry for each of these the fixer still restates — every one below except the claimed drops you accept — copying its text VERBATIM into \`deviation\` and giving \`inSpecRoute\` (whether an in-spec route existed, and which) and \`recommendation\` (START with ${CYCLE_DEVIATION_VERDICTS.join(" or ")} — those two verdicts are the whole vocabulary, and a hedge such as "UNSURE" is not one of them — then the one-line reason; opening with both, as in "${CYCLE_DEVIATION_VERDICTS.join(" or ")} — needs investigation", is a refusal to choose and is rejected as one rather than read as the first of them, and otherwise the first word is taken literally as your verdict, so lead with the verdict you mean, or with neither if you cannot choose). This round does not pass while one of them is unassessed: the maintainer decides, and would otherwise be handed the deviation with only the implementer's half of it. A deviation is neither a finding to be corrected away nor a license for unfinished work — grade completeness, tests, and regressions exactly as strictly.\n\n${JSON.stringify(state.deviations, null, 2)}\n${deviationDrops.length ? `\nOf those, the fixer no longer restates the ones below, CLAIMING each no longer stands. Verify that against the committed state exactly as you would a \`declined\`: passing this round is what drops them, so raise one you do not accept as an issue rather than letting it go — a drop you reject is assessed by the round after it, once the fixer restates it.\n\n${JSON.stringify(deviationDrops, null, 2)}\n` : ""}`
    : "";
  // This brief can order a build — at the round's stated tier — so the reviewer
  // needs a destination for its output as much as for its own report — including on the pass that
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

${cycleReviewChecks(cycle.artifactType, state.tier)}

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
// high-capability model AND expose a documented provider-neutral full-review
// payload (`reviewFile` or `reviewText`) rather than only `artifactDir`. See
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
  // Both peer severities gate and its findings reach the fixer, so a peer that
  // never received the reviewer's comment weighting can keep asking for the
  // narration the fixer is told not to ship. Gated on artifact type exactly as
  // `cycleReviewChecks` gates it: a prose review has no code comments to weigh.
  const commentWeighting = cycle.artifactType === "prose" ? "" : ` ${CYCLE_COMMENT_REVIEW}`;
  const preflightStep = `1. Preflight: already done by the run-level shared preflight before this launch, so skip the probes. An auth/usage error from the launch itself still returns \`unavailable\`.`;
  return `You run the best-effort cross-harness PEER REVIEW stage for one review-cycle round. You launch a read-only \`codex\` review of the committed state, wait for it, and return its result structurally. You NEVER fail this stage: every problem becomes a non-blocking outcome in the schema (\`unavailable\`, \`timeout\`, \`forfeited\`, \`failed\`) with a one-line \`detail\` — never an error, never a refusal to answer.

## WORKTREE CONTRACT

${cycleContract(cycle, "peer")}

${CYCLE_DESTROY_BOUNDARY}

The peer examines this worktree READ-ONLY; you edit nothing either. The cycle's fresh reviewer is examining the same committed state concurrently — two readers are safe, and the reviewer alone owns builds/execution.

${CYCLE_FINISH_IN_TURN} The retained manual path therefore launches a supervised background peer, waits or times it out, and reaps it inside this turn: you return its outcome, never a promise to report the peer's result later.

## Steps

${preflightStep}
2. Prepare unique per-attempt paths under this cycle's artifact directory: \`round_dir=${cycleShq(`${state.artifactDir}/round-${state.round}`)}\`, \`mkdir -p "$round_dir"\`, with \`prompt_file\`, \`outfile\`, \`stderr_file\`, and \`pid_file\` inside it (suffix \`-attempt2\` on a retry; never reuse a path).
3. Write the peer prompt below VERBATIM to \`$prompt_file\` with a quoted heredoc (\`<<'PEER_PROMPT'\`) — never assemble it through shell interpolation.
4. Two powbox prerequisites remain: the helper's Codex provider still discards the configured high-capability model ([powbox issue #145](https://github.com/Roubtec/powbox/issues/145)), and schema v1 exposes only \`artifactDir\`, not a documented provider-neutral \`reviewFile\` or \`reviewText\` from which every finding can be relayed verbatim. This task-015 rendering therefore retains the pinned raw launch even when the helper is installed; never guess a private artifact filename or parse a provider-specific envelope. Once BOTH prerequisites land, set \`artifact_root\` outside the worktree, run \`peer-review-run --provider codex --worktree "$worktree" --prompt-file "$prompt_file" --artifact-root "$artifact_root" --timeout 260 --effort medium\` once in the foreground inside this Peer stage, and read the documented full-review payload before applying verdict logic. Then keep the hardened manual launch below only as the fallback when \`command -v peer-review-run\` fails. For now launch it with \`nohup\` and record the peer PID directly:

   \`\`\`bash
   worktree="<the worktree path from the contract above>"
   # Pin peer effort per invocation; never changes the container's saved config.
   nohup sh -c '
     pid_file=$1
     shift
     proc_identity() {
       stat=$(cat "/proc/$1/stat" 2>/dev/null) || return 1
       rest=\${stat##*) }
       [ "$rest" != "$stat" ] || return 1
       set -- $rest
       [ "$#" -ge 20 ] || return 1
       pgrp=$3
       session=$4
       shift 19
       start_time=$1
       for value in "$start_time" "$pgrp" "$session"; do
         case $value in ""|0|*[!0-9]*) return 1 ;; esac
       done
       printf "%s %s %s\\n" "$start_time" "$pgrp" "$session"
     }
     identity=$(proc_identity "$$") || exit 125
     printf "%s %s\\n" "$$" "$identity" > "$pid_file" || exit 125
     exec "$@"
   ' peer-launch "$pid_file" \\
     codex exec --sandbox read-only --cd "$worktree" -o "$outfile" \\
       -c mcp_servers={} -c model_reasoning_effort=medium "$(<"$prompt_file")" \\
     < /dev/null > /dev/null 2> "$stderr_file" &
   \`\`\`

   Ordinary stdout is detached to \`/dev/null\`, never merged into \`$outfile\` or \`$stderr_file\`; the \`-o\` artifact remains authoritative. The handoff records the peer PID plus Linux \`/proc/<pid>/stat\` fields 22 (start time), 5 (process group), and 6 (session). In every later Bash call, parse the stat record by stripping everything through its final closing parenthesis plus following space before counting fields (the comm field may contain spaces or \`)\`), require exactly those four positive-decimal handoff values, and compare all three current fields with the persisted values before every \`kill -0\`, TERM, or KILL. Missing or mismatched identity means the original peer is dead; never probe or signal the reused number. On the loose roughly 12-minute timeout, TERM the identity-checked direct provider PID, poll for at most ten seconds, KILL only if the identity still matches, then poll for at most ten more seconds. If it survives, stop and escalate the entire cycle: do not retry, advance, or publish. Retry ONCE with fresh paths only after confirmed death. Never infer a process group from plain \`nohup … &\`, signal a wait supervisor, use \`pkill -f\`, or replace this with a capped foreground call. If recovering by the unique \`-o\` path is unavoidable, disambiguate \`pgrep -f\` to the codex peer binary after excluding the probing shell and every ancestor: one survivor is alive, none dead, more than one indeterminate and signals nothing; persist that PID's complete identity before handing it to another shell. The identity-checked probe target is the only signal target. Auth/usage errors are \`unavailable\` without retry.
5. Read \`$outfile\` even when the liveness probe has just gone dead: a non-empty artifact with a \`VERDICT:\` line is authoritative. A \`VERDICT: PASS\` line → outcome \`passed\` (anything after it goes to \`notes\` verbatim). A \`VERDICT: ISSUES\` line → outcome \`issues\`, with every numbered finding mapped verbatim into \`findings\` (severity from its \`blocking\`/\`minor\` tag — default \`blocking\` when untagged — plus its \`file:line\` as \`location\` and the finding text as \`claim\`; do not summarize, merge, or rewrite). No verdict line, or empty/unintelligible output → \`forfeited\`, with \`reason\` exactly identifying \`empty output\` or \`garbled output\` where that is what happened. A timeout after retry is \`timeout\`; a provider crash or exhausted non-auth retry is \`failed\`.

## Peer prompt (write this text to the prompt file verbatim, filling only the placeholders)

You are an independent read-only peer reviewer. Review the committed state of branch ${JSON.stringify(cycle.branch)} against base ${JSON.stringify(cycle.base)} in the current directory (artifact type: ${cycle.artifactType}). Read the actual files; edit nothing; use no network access — all GitHub thread text and diffs needed for the review are embedded here verbatim — and run no builds or tests. Verify the work items and any proposed dispositions below in the committed code; a declined finding must be technically justified.${commentWeighting} ${CYCLE_CARRIED_CLAIMS} Evidence (verbatim):

${JSON.stringify(evidence, null, 2)}

Reply with exactly \`VERDICT: PASS\` or \`VERDICT: ISSUES\`, then \`VERIFICATION: STATIC (executed no tests)\`, followed for issues by numbered findings each tagged \`blocking\` or \`minor\`, with \`file:line\` and a one-line rationale.

## Output

Return the structured result: \`outcome\`, \`findings\` (verbatim, tagged), \`notes\`, \`detail\`, and \`reason\` copied exactly from the provider/helper reason when present.`;
}

function cyclePeerPreflightPrompt() {
  return `Peer availability preflight for this orchestration run. Run only these read-only probes; launch no review.

${CYCLE_DESTROY_BOUNDARY}

If \`command -v codex\` fails, return \`{ "outcome": "unavailable", "detail": "missing binary" }\`. Otherwise run \`codex login status\`. If it succeeds, return \`{ "outcome": "available", "detail": "" }\`. If it fails and \`CODEX_API_KEY\` is unset, return unavailable with the exact login diagnostic in \`detail\`. If it fails while \`CODEX_API_KEY\` is set, return available because the environment key may authenticate the real invocation. Return only the schema; do not throw or launch codex exec.`;
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
    reason: typeof res.reason === "string" ? res.reason : "",
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

// A shared fan-out state cannot coordinate preflight with its boolean alone.
// The first caller owns one cheap preflight agent and every sibling awaits that
// promise; once it settles available, all actual peer launches fan out together
// under the independent adaptive throttle. A thrown/schema-invalid result
// clears the latch without marking completion, so one waiter retries while the
// failed owner records a synthesized non-blocking outcome.
async function ensureCyclePeerPreflight(peerState) {
  for (;;) {
    if (peerState.preflighted || peerState.unavailable) {
      return { outcome: peerState.unavailable ? "unavailable" : "available", detail: peerState.unavailableDetail || "" };
    }
    if (peerState.preflightInProgress) {
      await peerState.preflightInProgress.promise;
      continue;
    }
    const latch = {};
    peerState.preflightInProgress = latch;
    latch.promise = (async () => {
      let result;
      try {
        const raw = await agent(cyclePeerPreflightPrompt(), {
          label: "peer-preflight",
          schema: CYCLE_PEER_PREFLIGHT_SCHEMA,
          phase: CYCLE_PEER_PHASE,
        });
        result = raw && (raw.outcome === "available" || raw.outcome === "unavailable")
          ? raw
          : { outcome: "forfeited", detail: "peer preflight returned nothing or failed schema validation", synthesized: true };
      } catch (e) {
        result = { outcome: "forfeited", detail: `peer preflight threw (${e && e.message ? e.message : String(e)})`, synthesized: true };
      }
      if (result.outcome === "unavailable") {
        peerState.unavailable = true;
        if (result.detail && !peerState.unavailableDetail) peerState.unavailableDetail = result.detail;
      } else if (result.outcome === "available") {
        peerState.preflighted = true;
      }
      if (peerState.preflightInProgress === latch) peerState.preflightInProgress = null;
      return result;
    })();
    return latch.promise;
  }
}

// Optimistic session-local adaptive peer throttle. A fan-out owner passes one
// shared object to every embedded cycle; a standalone cycle gets one whose
// unbounded start is observationally a no-op. Calls already in flight are never
// killed, and queued calls wake when completions leave room under the current
// cap. One generation identifies one trouble cluster: a result from a call
// launched before the latest step-down cannot collapse the cap again.
function createCyclePeerThrottle() {
  return { cap: null, generation: 0, inFlight: 0, waiters: [], steps: [] };
}

async function acquireCyclePeerSlot(throttle) {
  while (throttle.cap != null && throttle.inFlight >= throttle.cap) {
    await new Promise((resolve) => throttle.waiters.push(resolve));
  }
  throttle.inFlight += 1;
  return throttle.generation;
}

function cyclePeerTrouble(result) {
  if (!result || result.synthesized) return false;
  if (result.outcome === "timeout" || result.outcome === "failed") return true;
  if (result.outcome !== "forfeited") return false;
  // Reasons are retained verbatim in the result and summary. Classification is
  // deliberately a separate exact mapping: helper diagnostics are a documented
  // wire contract, while broad matches on words such as "empty" or "garbled"
  // can throttle on unrelated forfeitures. The two short forms are emitted only
  // by the retained raw path after it observes the corresponding condition.
  const reasonClass = new Map([
    ["empty output", "empty"],
    ["garbled output", "garbled"],
    ["provider exited 0 with an empty final message", "empty"],
    ["provider exited 0 but produced a malformed/unparseable response", "garbled"],
  ]).get(String(result.reason || ""));
  return reasonClass === "empty" || reasonClass === "garbled";
}

function releaseCyclePeerSlot(throttle, launchGeneration, result) {
  throttle.inFlight = Math.max(0, throttle.inFlight - 1);
  if (cyclePeerTrouble(result) && (throttle.cap == null || launchGeneration === throttle.generation)) {
    const from = throttle.cap;
    const to = from == null
      ? Math.max(2, Math.min(8, throttle.inFlight))
      : Math.max(2, Math.floor(from / 2));
    throttle.cap = to;
    throttle.generation += 1;
    if (from == null || to < from) {
      const step = {
        generation: throttle.generation,
        from: from == null ? "unbounded" : from,
        to,
        inFlight: throttle.inFlight,
        outcome: result.outcome,
        reason: result.reason || result.detail || "",
      };
      throttle.steps.push(step);
      log(`Peer launch throttle stepped from ${step.from} to ${to} after ${result.outcome}${step.reason ? ` (${step.reason})` : ""}; ${throttle.inFlight} call(s) remain in flight.`);
    }
  }
  const waiters = throttle.waiters.splice(0);
  waiters.forEach((resolve) => resolve());
}

function cyclePeerThrottleSummary(throttle) {
  return {
    cap: throttle.cap == null ? "unbounded" : throttle.cap,
    inFlight: throttle.inFlight,
    steps: throttle.steps.slice(),
    sessionLocal: true,
    crossContainerCoordination: false,
  };
}

async function runCyclePeerStage(cycle, state) {
  if (cycle.peer === "off") {
    return { outcome: "disabled", findings: [], notes: "", detail: "peer-opinions=off" };
  }
  const preflight = await ensureCyclePeerPreflight(state.peerState);
  if (preflight.outcome === "unavailable") {
    return { outcome: "unavailable", findings: [], notes: "", detail: preflight.detail || "peer marked unavailable earlier this run" };
  }
  if (preflight.synthesized) {
    return { outcome: "forfeited", findings: [], notes: "", reason: "", detail: `${preflight.detail}; recorded non-blocking`, synthesized: true };
  }
  const launchGeneration = await acquireCyclePeerSlot(state.peerThrottle);
  let result;
  try {
    const res = await agent(cyclePeerPrompt(cycle, state), {
      label: `${cycle.labelPrefix || ""}peer#${state.round}`,
      schema: CYCLE_PEER_SCHEMA,
      phase: CYCLE_PEER_PHASE,
    });
    result = normalizeCyclePeerResult(res);
  } catch (e) {
    // A thrown stage must not drop the round (or, under pipeline(), the item).
    result = { outcome: "forfeited", findings: [], notes: "", reason: "", detail: `peer stage threw (${e && e.message ? e.message : String(e)}); recorded non-blocking`, synthesized: true };
  }
  releaseCyclePeerSlot(state.peerThrottle, launchGeneration, result);
  return result;
}

// The close-out's diff check. Cheap and read-only like the grounding
// spot-check, and for the same reason: it is what lets the cycle skip a whole
// reviewer-plus-peer round. Neither question lets the fixer's list decide
// anything: question 1 judges the DIFF against the list's claim of triviality
// — the difference between a bounded discretion and a self-granted licence —
// and question 2 judges the pass's whole claim against the diff, which is the
// only thing standing between a `fixed` disposition and a range that never
// received it. That claim is the list AND the `fixed` dispositions, because a
// list is silent about the fix it omits: a pass that skipped one requested fix
// and listed an unrelated tidy-up would otherwise clear a list-only check with
// the skipped fix seen by nobody.
function cycleCloseOutPrompt(cycle, state) {
  const fixes = Array.isArray(state.fixes) ? state.fixes : [];
  return `Trivial-round close-out check, read-only. The cycle is about to conclude WITHOUT another reviewer round, so this diff would ship unreviewed. Read \`git diff ${cycleShq(state.passBase)}..HEAD\` in full and answer TWO questions about it.

1. \`nonSemantic\` — is EVERY hunk non-semantic: wording, typos, comment phrasing, formatting, with nothing touching behavior, logic, or the meaning of an acceptance criterion? Judge the DIFF, not the list below, and remember that prose can carry behavior here: a prompt's text, a config or contract expressed as text, an instruction an agent follows. Anything else is \`nonSemantic: false\`.

2. \`editsPresent\` — is the range NON-EMPTY, and does it actually carry everything the pass claims below: every EDIT it listed, and a change answering every FINDING it disposed \`fixed\`? An EMPTY range is \`false\`: nothing landed, so a finding this pass reported \`fixed\` was never fixed at all. A claimed edit you cannot find in the diff is \`false\` too, and so is a \`fixed\` finding the range holds no change for — the two lists are checked separately on purpose, because a tidy-up that IS in the range does not stand in for a requested fix that is not. Extra non-semantic hunks beyond the list are fine here — question 1 already judges those.

Either question answered \`false\` costs nothing but the normal reviewer round.

${cycleContract(cycle, "reviewer")}

${CYCLE_DESTROY_BOUNDARY}

${CYCLE_FINISH_IN_TURN} ${CYCLE_NO_SELF_PEER}

## Edits the pass claims it shipped (verbatim)

${JSON.stringify(state.edits, null, 2)}

## Findings the pass disposed \`fixed\` (verbatim)

${fixes.length ? JSON.stringify(fixes, null, 2) : "(none — this pass disposed no finding `fixed`, so only the edits above are yours to find)"}

Edit nothing.`;
}

// The record-only check: the close-out check's counterpart for the ONE post-run
// commit the delivery tier tolerates. Deliberately given NO list to compare
// against — the close-out has one because a pass OFFERS a close-out, while
// nothing is offered here and a self-report is precisely what must not be able
// to buy this exit. The diff is the whole evidence.
function cycleRecordOnlyPrompt(cycle, state) {
  return `Record-only follow-up check, read-only. The cycle is about to conclude WITHOUT another reviewer round, so this diff would ship unreviewed. Read \`git diff ${cycleShq(state.passBase)}..HEAD\` in full and answer ONE question: does the range hold NOTHING but the unrelated-flake RECORD — a NEW follow-up task file carrying the diagnosis already in hand, plus any PR-body or summary note recording what the delivery run surfaced? Judge the DIFF, and only the diff: you were given no account of it on purpose, and none would settle it. Anything else in the range, however it got there — a source, test, config, or contract edit, an attempt at the failing test itself, an edit to a file the work under review delivers — is \`recordOnly: false\`, which costs nothing but the normal reviewer round.

${cycleContract(cycle, "reviewer")}

${CYCLE_DESTROY_BOUNDARY}

${CYCLE_FINISH_IN_TURN} ${CYCLE_NO_SELF_PEER}

Edit nothing.`;
}

// The packet measurement: porcelain status and the operation-state markers,
// taken by a turn that did NOT produce the packet it judges. A READING, never a
// repair — the posture `wf-address-tasks.js`'s `mainCheckoutStatusPrompt` takes
// for the shared main checkout, and for a sharper reason here: a stage that
// "tidied" this tree would destroy the very evidence the cycle refuses the
// packet on, and an `--abort` or a `reset` could take an unfinished operation's
// work with it. The brief is given no account of the pass, deliberately: the
// self-report is the thing being checked, and a measurer shown `clean: true`
// has been handed the answer it is here to derive. Its contract is the
// `measurer` one for a reason of the same kind: every other role's asserts the
// BRANCH, and the two operations that detach HEAD — a rebase, a bisect — are
// among the states this step is sent to find, so a reviewer's contract would
// order it to stop precisely where the reading matters most.
function cyclePacketCheckPrompt(cycle, state) {
  return `Packet worktree measurement, read-only. Fixer pass ${state.pass} of this review cycle has returned a packet; before the cycle adopts it, MEASURE the worktree it came back from. OBSERVE ONLY — do NOT stage, commit, reset, clean, stash, abort, continue, or edit anything, and do not "tidy" the tree: an unclean or mid-operation worktree is the ANSWER this step exists to return, not a problem for you to solve, and repairing it would destroy the evidence and could take an unfinished operation's work with it.

${cycleContract(cycle, "measurer")}

${CYCLE_DESTROY_BOUNDARY}

${CYCLE_FINISH_IN_TURN} ${CYCLE_NO_SELF_PEER}

Take BOTH readings in that worktree:

1. \`git status --porcelain -z --untracked-files=all\` (the \`-z\` form leaves paths unquoted, so parsing is unambiguous; \`--untracked-files=all\` lists every untracked FILE rather than collapsing it to its directory). Split the output on NUL and return one \`dirty\` entry per record: the record's 2-character \`XY\` status field, a space, then the repo-relative path — e.g. \` M src/app.ts\`, \`?? notes.txt\`. Keep the \`XY \` prefix verbatim; its first column can be a space. For a rename/copy record git emits the ORIGINAL path as a second NUL-separated field after the current one — keep only the current-path entry and drop that trailing original. An empty array means the tree is clean.

2. The operation state, which the porcelain does NOT show. Check \`git rev-parse --git-path rebase-merge\` and \`rebase-apply\` — each PRINTS a path whether or not it exists, so test the path for existence rather than reading the exit status — plus \`MERGE_HEAD\`, \`CHERRY_PICK_HEAD\`, \`REVERT_HEAD\`, and \`BISECT_LOG\`. Return the marker that showed the operation in \`operation\`, or the empty string when none is in progress. A tree left mid-rebase or mid-cherry-pick prints EMPTY porcelain, so reading 1 alone would call it clean — that is the exact case this step exists for.

Report only what YOU measured. You were given no account of what the pass did or claims, on purpose. If a reading cannot be taken at all — git will not run, the path is missing, it is not a checkout — return \`measured: false\` with whatever you have and say in \`detail\` which reading failed and why. Do not fail, and do not guess a clean answer: unknown is a usable result here and a wrong "clean" is not. Edit nothing.`;
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
//   closeOut ("off" default | "on") — the invoker's grant of the trivial-round
//     close-out, a SECOND bounded discretion beside `light` and a different
//     one: `light` skips the final no-op fixer pass, close-out skips the
//     re-review of a pass whose whole change was non-semantic,
//   contracts: { fixer, reviewer, peer, measurer } — optional per-role
//     preamble text (a worktree-lifecycle consumer passes its own wt-enter
//     contract here). A `measurer` contract states WHERE and nothing more: it
//     must not assert the branch, because the packet measurement is sent to
//     find the states that detach HEAD. Omitted, every role falls back to
//     cycleDefaultContract, which drops that assertion for this role itself,
//   labelPrefix — optional, prefixes agent labels for fan-out consumers,
//   peerState — optional SHARED peer-availability state for a fan-out owner
//     embedding many cycles: hand every cycle ONE object of the shape
//     { preflighted: false, preflightInProgress: null, unavailable: false,
//     unavailableDetail: "" } and the install/login preflight runs once for
//     the whole batch, with concurrent first-wave callers sharing its in-flight
//     latch and an unavailable peer sticking batch-wide (the canonical rule).
//   peerThrottle — optional SHARED adaptive-throttle state created by
//     createCyclePeerThrottle() for a fan-out owner. It starts unbounded,
//     queues only after trouble steps it down, and records every step for the
//     run summary. Omitted, each cycle keeps its own (standalone behavior).
// }
//
// Returns the cycle result contract (lean; bulk prose stays behind artifactDir):
// { verdict: "pass"|"review-cap"|"error", detail, rounds, findingDispositions,
//   openQuestions, deviations, deviationAssessments (the reviewer's half for
//   each deviation still standing — at most ONE entry per deviation, only an
//   entry the passing round could use, and only while no later pass adopted
//   work that round never saw), deviationHistory (only once some
//   pass reported one), workReport, workReportReviewed (whether a reviewer
//     round actually passed over THAT map ON THAT TREE — true on an error or
//     cap exit taken past a passing round, since the confirmation pass can stop
//     the cycle over the very map that just passed, and false where no round
//     ever judged the map being carried out, a later pass having replaced the
//     map or committed a new `finalSha` under it),
//   reviewedWorkReport and reviewedFinalSha (present once ANY round has passed:
//     the most recent map a reviewer DID pass over and the tip it was judged
//     on, reported SEPARATELY from the map being carried out, so a consumer that
//     records a judged map has one to record even where a later pass replaced
//     it — the boolean alone says only that the map leaving is not the judged
//     one, which is the shape that used to lose the judged one outright),
//   proactive, finalSha, notes, reviewerNotes,
//   peerRounds ({ round, outcome, detail, reason } entries), peerThrottle,
//   discardedPeerFindings, undisposed, outstanding, artifactDir,
//   closeOut (present only when a trivial-round close-out ENDED the cycle:
//     the pass, the range, and the non-semantic edits that shipped unreviewed),
//   recordOnly (present only when the cycle concluded over a delivery run that
//     FAILED on the flake rule's evidenced-unrelated disposition: the pass, and
//     the pass's own `note` of what that run surfaced, which rides here because
//     no later reviewer round exists to carry it in `reviewerNotes`. That note
//     is what the field exists to carry, so no exit publishes the field without
//     one: a concluding pass that reported no record simply carries none, and
//     the record-only exit is refused for the normal reviewer round. Where the
//     record was a post-run COMMIT — the delivery gate's one tolerated one —
//     `range` names it and `verified` is what the diff check found in it; both
//     are EMPTY on the other three conclusions, where this field names no
//     commit of its OWN — the terminal check's pass committed nothing (the
//     flake rule's cited-active-task outcome), the light conclusion's commits
//     were seen by the round that just passed, and the close-out's ride in the
//     `closeOut.range` this same result carries. So the discriminator a
//     consumer rendering the record reads is exactly that, and no more:
//     whether `recordOnly` names an unreviewed post-run commit, never why it
//     does not),
//   flakeHistory (present once ANY pass reported a `flakeRecord`, and on every
//     exit including the stopped ones, since it is a log rather than a claim
//     about the conclusion: one { pass, note } entry per pass that reported
//     one. `recordOnly` above speaks FOR the conclusion, so it may carry only
//     the concluding pass's record; this is where every other pass's survives),
//   packetChecks (present once any packet was measured, and on every exit: one
//     { pass, measured, dirty, operation, detail } entry per fixer pass whose
//     worktree the cycle MEASURED, in order. Every packet the cycle adopts has
//     one — the final confirmation pass included, since the measurement runs
//     when the packet RETURNS rather than riding a later reviewer round, and
//     three of the four conclusions have no such round. A `measured: false`
//     entry is this shape's whole residual: the reading could not be taken, so
//     the packet was REFUSED rather than adopted, and that entry sits under an
//     `error` verdict saying the cycle stopped on an unverified worktree
//     instead of finishing over one),
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
  // Every pass's `flakeRecord`, in order, and accumulated for the reason
  // `deviationHistory` is: the conclusion's `recordOnly` speaks for the
  // CONCLUDING pass alone (see the record below), so without this an
  // INTERMEDIATE pass's evidenced-unrelated failure reaches the maintainer
  // nowhere the moment a later pass concludes clean — and that pass's record
  // can be the whole of it, where the evidence cited an already-active task and
  // left nothing to commit.
  const flakeHistory = [];
  // Every measured packet's reading, in order, accumulated for `flakeHistory`'s
  // reason and one of its own: the result's claim is that no packet the cycle
  // adopted went unmeasured, and only a per-pass log lets a consumer see that
  // rather than take it. It is a log, so it rides every exit — the refusals
  // most of all, since the entry that REFUSED a packet is the one worth reading.
  const packetChecks = [];
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
  // The map a reviewer round actually PASSED over, snapshotted as text BESIDE
  // the tip it was judged on. It answers a question the verdict cannot:
  // `confirming` is set only after a round passed, and the confirmation pass
  // that follows can stop the cycle outright — returning nothing, blocking,
  // coming back on an unclean worktree — leaving `verdict: "error"` over exactly
  // the map that just passed. A consumer deciding what a stopped cycle's map is
  // worth (wf-address-review withholds a disposition record from an UNREVIEWED
  // map) must not read that as "no reviewer ever judged this". Text rather than
  // a latched boolean because a later pass may REPLACE `workReport`, and only
  // comparing the two answers "is the map LEAVING this cycle the one that was
  // judged".
  // The map is not the whole identity, though: a later pass can commit a new
  // `finalSha` while returning the IDENTICAL map, so comparing text alone calls
  // those dispositions reviewed while they now accompany a tree no reviewer
  // read. So the snapshot carries the tip too, and both halves must match.
  // `null` until a round passes, which no packet can match.
  let reviewedPass = null;
  // Peer availability state: `preflighted` (the install/login preflight runs
  // once, never per round) and sticky `unavailable` (an unavailable peer is
  // not re-probed). A fan-out owner embedding many cycles passes ONE shared
  // object as cycle.peerState so the whole batch preflights once and
  // unavailability sticks batch-wide; a standalone cycle gets its own. (The
  // runtime is single-threaded JS, so sibling cycles mutate a shared object
  // safely between awaits.)
  const peerState = cycle.peerState || { preflighted: false, preflightInProgress: null, unavailable: false, unavailableDetail: "" };
  const peerThrottle = cycle.peerThrottle || createCyclePeerThrottle();
  let reviewerNotes = ""; // the latest reviewer's pass-notes (PR-body caveats for consumers)
  // The reviewer's half of report-don't-correct, as accepted by the last round
  // that PASSED. Replaced rather than accumulated, for the reason `deviations`
  // is: it describes the deviations standing now, not every judgment ever made
  // — and emptied again the moment a later pass adopts work that round never
  // saw (the invalidation past the terminal check below).
  let deviationAssessments = [];

  const result = (verdict, detail, extra) => {
    // An assessment travels only beside the deviation it judges: one whose
    // deviation a later round dropped would re-latch exactly what `deviations`
    // stopped latching (a passing round may volunteer an entry for the very
    // drop it accepts, so this filter still earns its keep beside the
    // invalidation below). A deviation with no entry here reached no round
    // that passed over it in its CURRENT state — an `error` or `review-cap`
    // exit, which ships it standing and unjudged rather than pretending a
    // pre-change judgment still holds.
    const standingAssessments = deviationAssessments.filter((a) => a && deviations.includes(a.deviation));
    const carriedReport = (packet && packet.workReport) || [];
    const carriedSha = (packet && packet.finalSha) || "";
    return {
      verdict,
      detail: detail || "",
      rounds,
      findingDispositions,
      openQuestions,
      deviations,
      ...(standingAssessments.length ? { deviationAssessments: standingAssessments } : {}),
      ...(deviationHistory.some((h) => h.deviations.length) ? { deviationHistory } : {}),
      ...(flakeHistory.length ? { flakeHistory } : {}),
      ...(packetChecks.length ? { packetChecks } : {}),
      workReport: carriedReport,
      // Whether a reviewer round passed over THAT map on THAT tree, not over
      // some earlier one: false before any round finished, false again once a
      // pass replaced the map, false where a pass kept the map and committed a
      // new tip under it, and true on an error/cap exit taken past a passing
      // round. No snapshot at all is the first of those, so it needs no second
      // condition beyond the one that says a round passed.
      workReportReviewed:
        !!reviewedPass && JSON.stringify(carriedReport) === reviewedPass.json && carriedSha === reviewedPass.finalSha,
      // And the judged map ITSELF, beside the tip it was judged on — reported
      // separately from the map the cycle is carrying out, since a later pass
      // may have replaced it. A consumer whose job is to RECORD a judged map
      // (wf-address-review's durable disposition record) otherwise has nothing
      // to record in exactly that case: the boolean says only that the map
      // leaving is not the judged one, so the judged one — with its drafted
      // replies, the expensive half — died with the session that judged it.
      ...(reviewedPass ? { reviewedWorkReport: reviewedPass.workReport, reviewedFinalSha: reviewedPass.finalSha } : {}),
      proactive: (packet && packet.proactive) || "",
      finalSha: (packet && packet.finalSha) || "",
      notes: (packet && packet.summary) || "",
      reviewerNotes,
      peerRounds,
      peerThrottle: cyclePeerThrottleSummary(peerThrottle),
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

    // The evidenced-unrelated delivery-run failure THIS pass reported, if any.
    // Read and LOGGED here — above every error return below, and above the
    // conclusions further down — because `flakeHistory` promises one entry per
    // reporting pass on EVERY exit, and the stopped exits are not the exception
    // to that: a packet that reports a failed validation run and THEN blocks,
    // or comes back from a worktree that is not clean and idle, or names an
    // artifact directory the cycle refuses, is precisely the run whose failure
    // the maintainer is owed, and reading the field after those returns would
    // drop it. Only a pass that returned NOTHING has no record to read; every
    // return from here on carries this pass's.
    //
    // It buys no exit — no conclusion below is licensed by anything this field
    // says. It can WITHHOLD one, though: the record-only close skips a round
    // for the sole purpose of carrying this record, so a pass that reported
    // none takes the normal round instead. And the gate that admits a FAILED
    // delivery run admits it only on the promise that the failure reaches the
    // maintainer, with these conclusions the ones no later reviewer round
    // follows. So `flakeCarried` rides on all FOUR of them — the terminal
    // check, the trivial-round close-out, the record-only close (where it rides
    // inside that exit's own richer record), and the light-mode exit — and on
    // those only: an `error` or `review-cap` exit publishes nothing on the
    // strength of that admission and hands the maintainer the stopped run
    // itself (which still carries `flakeHistory`, a log rather than a published
    // claim).
    // The terminal check is not the exotic case there but the common one: the
    // flake rule tells a pass whose evidence matches an ALREADY-ACTIVE task to
    // cite that task rather than edit it, which leaves nothing to commit, so
    // the pass returns `changed: false` with nothing disposed — by following
    // the contract exactly — and would otherwise conclude the cycle carrying
    // no record at all.
    //
    // The self-report is taken UNVERIFIED in both places; what differs is what
    // it is allowed to buy. On the record-only exit below it never buys the
    // skip — the diff check decides that, and is never shown the note — it only
    // rides in the record that exit exists to carry, which is why its ABSENCE
    // withholds the exit rather than its presence granting one. Where it rides
    // in `flakeCarried` instead it buys nothing either way, licensing no exit
    // and adding a caveat to the maintainer's copy. Read from `fix`, never
    // accumulated: every pass
    // that can CONCLUDE the cycle is a delivery-tier pass, which is what makes
    // the consumers' heading about a failed delivery run true of the concluding
    // pass's record and of no other — an earlier pass's is a wrong answer under
    // it where an absent one is merely no answer.
    //
    // That is a rule about what may be PUBLISHED as this conclusion's, not a
    // licence to lose the earlier record. Every pass's rides in `flakeHistory`,
    // on every exit, so an intermediate pass's failure still reaches the
    // maintainer once a later pass concludes clean — which it otherwise would
    // not, the flake rule's cited-active-task outcome having committed nothing
    // for the diff to show either. The two carriers answer different questions
    // and neither substitutes for the other; nor does either reach the reviewer,
    // whose brief renders no flake record at all.
    const flakeNote = typeof fix.flakeRecord === "string" ? fix.flakeRecord.trim() : "";
    if (flakeNote) flakeHistory.push({ pass: fixerPasses, note: flakeNote });
    const flakeCarried = flakeNote ? { recordOnly: { pass: fixerPasses, range: "", verified: "", note: flakeNote } } : {};

    if (fix.blocker) return result("error", `fixer blocked on pass ${fixerPasses}: ${fix.blocker}`);
    // Packet hard-check, structural half: a packet is adopted only from a
    // worktree that is both clean AND idle, and a pass that says its own is
    // neither is refused here for free, never silently — redriven or resumed
    // instead. The half that catches a `clean` that is sincere and wrong is the
    // measurement below.
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

    // The measuring half of the packet hard-check, and the half `fix.clean`
    // cannot be: `clean` is the fixer's word about its own worktree, so the one
    // failure the check exists to contain — a pass returning `clean: true` from
    // a tree still mid-rebase, which prints EMPTY porcelain — passes the
    // self-report unseen. So every packet the cycle ADOPTS is measured by a turn
    // that did not produce it, before anything branches on the packet's
    // SUBSTANCE — its work report, its dispositions, its diff, any conclusion
    // drawn from them. What runs ahead of the measurement is only what costs no
    // agent turn: the free refusals above, which would make measuring an
    // already-refused packet pure waste; the artifact-directory capture the last
    // of those refusals sits in; and this pass's flake record, logged where it
    // is for the reason given there. Each of the three does read a field off the
    // packet — the measurement is not the first line to touch it — but none of
    // them takes up the WORK the packet claims to have done, which is what an
    // unmeasured worktree would poison.
    //
    // Measured HERE rather than folded into the reviewer's round, which would
    // ride an existing turn: three of the four conclusions have no reviewer
    // round after the pass they conclude on (the terminal check, the
    // trivial-round close-out, the record-only close), so a reviewer-borne
    // reading would leave every one of them unmeasured — the final confirmation
    // pass, the cycle's last word, most of all. And on the rounds it did cover
    // it would arrive only after the reviewer and the peer had already been
    // spent on the tree it turns out nobody could trust. One low-effort
    // read-only turn per pass covers every pass through one mechanism, with no
    // exit special-cased and no round spent ahead of the refusal.
    //
    // A reading that cannot be TAKEN is unknown, and unknown refuses the packet
    // exactly as a dirty one does — the one thing it must never do is read as
    // clean. That refusal is this shape's whole residual: an unmeasurable pass
    // stops the cycle on an `error` verdict, whose `packetChecks` entry records
    // `measured: false`, rather than letting it finish over a worktree nobody
    // established the state of.
    const measurement = await agent(cyclePacketCheckPrompt(cycle, { pass: fixerPasses }), {
      label: `${lp}packet#${fixerPasses}`,
      schema: CYCLE_PACKET_CHECK_SCHEMA,
      effort: "low",
    });
    const measured = !!(measurement && measurement.measured === true);
    const measuredDirty = measurement && Array.isArray(measurement.dirty) ? measurement.dirty : [];
    const measuredOperation = measurement && typeof measurement.operation === "string" ? measurement.operation.trim() : "";
    const measuredDetail = measurement && typeof measurement.detail === "string" ? measurement.detail.trim() : "";
    packetChecks.push({
      pass: fixerPasses,
      measured,
      dirty: measuredDirty,
      operation: measuredOperation,
      // A refusal points the maintainer at this entry, so its one line of prose
      // never ships empty: the schema admits `detail: ""`, and a blank one
      // would leave a `measured: false` entry saying nothing about what could
      // not be read. A measurer that said nothing is kept distinct from one
      // that returned nothing at all, since only the first took a turn.
      detail: measuredDetail
        || (measurement ? "the measuring subagent reported no detail" : "the measuring subagent returned nothing (died or failed schema validation)"),
    });
    if (!measured) {
      return result("error", `the worktree behind fixer pass ${fixerPasses} could not be MEASURED, so its \`clean\` self-report is the only account of it and the cycle does not take one; refusing to adopt the packet — redrive or resume that pass (the \`packetChecks\` entry records the unmeasured reading)`);
    }
    if (measuredDirty.length || measuredOperation) {
      const failedConditions = [
        measuredDirty.length ? `not clean (${measuredDirty.length} uncommitted path(s); see the \`packetChecks\` entry for the list)` : "",
        measuredOperation ? `not idle (a Git operation is still in progress, found at ${measuredOperation})` : "",
      ].filter(Boolean).join(", and ");
      return result("error", `fixer pass ${fixerPasses} reported \`clean: true\`, but the cycle measured that worktree as ${failedConditions}; refusing to adopt the packet — redrive or resume that pass`);
    }

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
    // The SHA this pass started from — the range a trivial-round close-out is
    // judged on. Captured BEFORE the accumulation below overwrites it, and
    // empty on pass 1, which is also why no close-out can conclude round 1.
    const passBase = (packet && packet.finalSha) || "";
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
      return result("pass", flakeNote ? "reviewer passed; final confirmation pass disposed nothing new, over a delivery run whose evidenced-unrelated failure cites an already-active follow-up task" : "reviewer passed; final confirmation pass disposed nothing new", flakeCarried);
    }

    // Trivial-round close-out: the second bounded discretion beside `light`,
    // and a different one — `light` skips the final no-op fixer pass, this
    // skips the RE-REVIEW of a pass whose whole change was non-semantic,
    // knowingly amending the rule that anything the final pass fixes buys
    // another reviewer round (which still holds for anything semantic). Only
    // the invoker grants it, and the fixer's offer is not the licence: the
    // diff is judged by a cheap read-only check, and a semantic hunk in it —
    // however it got there — forfeits the close-out for the normal round. It
    // can swallow nothing else either. Every handed finding must already be
    // validly disposed, and every disposition on the pass must be `fixed`: a
    // `declined` or an `escalated` one is a CLAIM the next fresh reviewer
    // adjudicates, and the diff check cannot stand in for that reviewer
    // because neither disposition leaves anything in the diff to look at — a
    // decline dismissing a semantic finding ships as an empty hunk, so a pass
    // fixing two typos beside it would otherwise conclude the cycle with the
    // decline never adjudicated, against this file's own contract that a
    // decline is verified by the next fresh reviewer, never final here. A pass
    // that moved the deviation set or claimed a retirement still owes the
    // round that adjudicates it, so those claims hold the cycle open exactly
    // as they do at the terminal check above.
    //
    // The check answers TWO questions, because a diff read for triviality
    // alone is blind in the other direction: an EMPTY range is vacuously
    // non-semantic, so a pass reporting its findings `fixed` while committing
    // nothing — or fixing something else instead — would conclude the cycle
    // over fixes that never landed, adjudicated by nobody, since the round
    // that catches exactly that is the round this exit skips. `editsPresent`
    // is that second question, and `fix.changed` is its structural half: a
    // pass that says it changed nothing has nothing to close out over, and
    // saying so while listing `closeOutEdits` is a contradiction the gate
    // settles here rather than spending an agent call on.
    //
    // The `fixed` dispositions go to that question BESIDE the edit list, and
    // that pairing is what makes it answer the case it is named for. The list
    // is the pass's account of what it shipped; the dispositions are its
    // account of what it was ASKED for, and only the second names a fix that
    // never landed. Checked against the list alone, a pass that forgot one
    // requested fix while shipping and listing an unrelated comment tidy-up
    // clears every question here — non-empty range, every listed edit present,
    // nothing semantic — and concludes the cycle with the omission adjudicated
    // by nobody.
    const closeOutOnlyFixes = (fix.dispositions || []).every((d) => d && d.disposition === "fixed");
    const closeOutFixes = (fix.dispositions || []).filter((d) => d && d.disposition === "fixed").map((d) => ({ finding: (d && d.finding) || "", detail: (d && d.detail) || "" }));
    if (cycle.closeOut === "on" && passBase && fix.changed && (fix.closeOutEdits || []).length && undisposed.length === 0 && closeOutOnlyFixes && deviationSetChanges === 0 && pendingRetirements.length === 0) {
      const closeOut = await agent(cycleCloseOutPrompt(cycle, { passBase, edits: fix.closeOutEdits, fixes: closeOutFixes }), {
        label: `${lp}closeout#${fixerPasses}`,
        schema: CYCLE_CLOSEOUT_SCHEMA,
        effort: "low",
      });
      if (closeOut && closeOut.nonSemantic === true && closeOut.editsPresent === true) {
        return result("pass", `trivial-round close-out on fixer pass ${fixerPasses}: non-semantic fixes concluded the cycle without a further reviewer round`, {
          ...flakeCarried,
          closeOut: { pass: fixerPasses, range: `${passBase}..${fix.finalSha || "HEAD"}`, edits: fix.closeOutEdits, verified: (closeOut && closeOut.why) || "" },
        });
      }
      log(`fixer pass ${fixerPasses} offered a trivial-round close-out; the diff check ${!closeOut ? "returned nothing" : closeOut.nonSemantic !== true ? "found a semantic change" : "did not find every claimed edit and fix in the range"}, so the normal reviewer round runs.`);
    }

    // Record-only close: the terminal check above, with its one conjunct taken
    // from the packet — `changed` — decided by a read of the actual diff
    // instead. The delivery tier a confirmation pass owes survives ONE post-run
    // commit, the flake rule's diagnosis-only task file and the note recording
    // what that run surfaced; and tiered validation makes the delivery run the
    // first FULL-suite run of most cycles, so the run that surfaces a flake is
    // usually this one. Without this exit that commit is the only thing between
    // the pass and the terminal check: the cycle buys a round told the DELIVERY
    // tier, whose reviewer runs the whole suite, and the confirmation pass
    // after it owes that tier again — three runs of the suite the tolerance
    // exists to spare, plus a reviewer-and-peer round, bought by a commit that
    // adds a queue entry and a note. Besides `changed`, just accounted for, the
    // three conjuncts it shares with the terminal check — `confirming`, an
    // empty `dispositions`, an unmoved deviation set — are unchanged: a
    // disposition, a deviation-set move, or a retirement claim (which rides in
    // `dispositions`) still earns its round here exactly as it does there. The
    // two it does not share are `passBase` — the diff check needs a range to
    // read — and, beyond the `if` itself, `flakeNote`: the record the exit
    // exists to carry, which gates the check and is taken up below. And the
    // pass neither offers this nor is asked about it
    // — a tolerance a fixer could claim would be the evasion route item 2's own
    // evidence requirement exists to close, so a cheap read-only check judges
    // the range, and anything beyond the record forfeits the exit for the
    // normal round.
    //
    // The pass's own note of what the run surfaced rides IN the record, from
    // the same `flakeRecord` the terminal check above carries — one field, one
    // meaning, whichever conclusion the cycle reaches. This exit is one of the
    // conclusions NO reviewer round follows, so the reviewer pass-notes a
    // consumer publishes as PR caveats were written before the failure
    // existed, and the record is the only carrier the note has left. That is
    // what makes item 2's "note the flake in the PR body or batch summary"
    // reachable on the very path item 1 names as the tolerated one. `verified`
    // stays the independent check's line about the diff and `note` is the
    // pass's own account; they are not interchangeable, and the check never
    // sees the note.
    //
    // So the note is a CONJUNCT of the exit, not merely its payload. The
    // tolerance is granted precisely so the failure reaches the maintainer, and
    // the diff check cannot supply it — it is asked about the RANGE and is never
    // shown the packet — so a pass that committed the record while reporting
    // none of it leaves the result nothing to publish: the consumers would
    // render a section announcing a FAILED delivery run under an empty note,
    // which tells the maintainer less than the round this exit skipped would
    // have. `flakeNote` is that structural half, exactly as `fix.changed` is the
    // close-out's, and it settles the exit with no agent call — which is why
    // the check is not run at all without one, and why it gates the CHECK
    // rather than the block: this seam's property that every refusal here says
    // WHY is worth keeping. Refusing costs nothing but the normal reviewer
    // round, and every earlier pass's record still rides in `flakeHistory`.
    if (confirming && fix.changed && passBase && (fix.dispositions || []).length === 0 && deviationSetChanges === 0) {
      const record = flakeNote
        ? await agent(cycleRecordOnlyPrompt(cycle, { passBase }), {
          label: `${lp}record#${fixerPasses}`,
          schema: CYCLE_RECORD_ONLY_SCHEMA,
          effort: "low",
        })
        : null;
      if (record && record.recordOnly === true) {
        return result("pass", "reviewer passed; the final confirmation pass committed only the unrelated-flake record, which its delivery-tier pass survives", {
          recordOnly: { pass: fixerPasses, range: `${passBase}..${fix.finalSha || "HEAD"}`, verified: record.why || "", note: flakeNote },
        });
      }
      log(`fixer pass ${fixerPasses} changed the tree with nothing to dispose; the record-only check ${!flakeNote ? "was not run — the pass reported no record of what its delivery run surfaced, so the exit would publish a failed delivery run with no account of it" : record ? "found more than the flake record" : "returned nothing"}, so the normal reviewer round runs.`);
    }

    // Every pass past that check is adopted work another round must pass over,
    // so the assessments the last passing round accepted stop describing this
    // branch: the fixer has changed it (or its claims) since the round that
    // judged it — even where it restates the same deviation text, which is the
    // deviation still matching, not the packet. Invalidated HERE, before
    // either cap exit below, so no exit ships a pre-change in-spec-route
    // judgment and recommendation beside work no round approved; the round
    // that passes over this work re-records the reviewer's half in full below,
    // since the assessment gate holds a round open while any standing
    // deviation lacks one.
    deviationAssessments = [];

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
      // The tier the pass just run owed, so the reviewer's build-first rule
      // applies at it rather than unconditionally.
      tier: cycleValidationTier(cycle, { confirming }),
      proposedRetirements: pendingRetirements,
      peerState,
      peerThrottle,
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
    peerRounds.push({ round: rounds, outcome: peer.outcome, detail: peer.detail, reason: peer.reason || "" });
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

    // The round PASSED, so the map this packet carries is one a fresh reviewer
    // judged, and the tip it carries is the tree that judgment was rendered
    // over. Snapshotted here — the one point in the loop where both are true —
    // and read by `result()` on every exit, the stopped ones included.
    reviewedPass = {
      json: JSON.stringify((packet && packet.workReport) || []),
      workReport: (packet && packet.workReport) || [],
      finalSha: (packet && packet.finalSha) || "",
    };

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
    // It carries the flake record too, and is the exit that needs it MOST:
    // `cycleValidationTier` makes every light-mode pass a delivery-tier pass
    // precisely because light skips the confirmation pass, so light is the mode
    // where the run that surfaces a flake is most likely to be a delivery run —
    // and the reviewer round that just passed is no substitute carrier, since
    // its brief is never shown this pass's `flakeRecord` and its notes were
    // written without it.
    if (cycle.mode === "light") {
      return result("pass", "reviewer passed (light mode: final confirmation pass skipped)", {
        ...flakeCarried,
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
Address any repository other than your own checkout BY PATH: \`git -C <absolute path>\`. NEVER derive a working directory from a glob, and NEVER chain a state-changing git command after a \`cd\` whose success you have not checked.
Empirical verification that could change state belongs ONLY in a disposable clone. Run \`command -v dc-enter\`; where it is found, work in \`DC="$(dc-enter <slug>)"\` — it prints one absolute path on stdout, \`dc-remove <slug>\` drops it, and a reused slug is REFUSED rather than re-derived, so pass \`--replace\` or remove the slug first if this may run twice. Where the helper is absent, use an absolute path outside the repository — never a relative one, and never the repository itself. Never \`cd\` into a path held in a variable unguarded: \`cd ""\` returns 0 and moves nowhere, so checking the status catches nothing and a lookup that produced no path leaves you in the shared checkout. Write \`cd -- "\${DC:?dc-enter returned no path}"\`, and confirm \`pwd\` before the first command that writes.`;

function scopePrompt(input) {
  return `You are scoping one review cycle. Read the repository's agent-context files (\`AGENTS.md\` / \`CLAUDE.md\`) first. This is scoping only — edit nothing, commit nothing.

${DESTROY_BOUNDARY}

Request (lenient parsing — free word order): ${JSON.stringify(input)}
Recognized tokens (already handled by the caller, listed for context): \`light\`, \`close-out\`, \`peer-opinions=off\`, \`artifact-type: code|prose|decision\`, \`max-rounds=N\`. Everything else describes the TARGET.

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
// A prose invocation carries the flags and the TARGET in one string, so a
// bare-word flag counts only as its own whitespace-delimited token (with
// surrounding punctuation stripped, so the lenient comma and quote forms still
// land). `\b` is not that boundary — it matches inside a path — so
// `feature/close-out-ui` or `chore/light-theme` would grant a bounded
// discretion the caller never asked for and only ever named a branch.
//
// What the rule costs, stated because it is a BEHAVIOR CHANGE from the `\b`
// regex it replaced, and every part of it fails CLOSED: the spaced `close out`,
// the unhyphenated `closeout`, and the assigned `close-out=on` no longer grant
// — the documented spelling is the bare HYPHENATED token, the only one the
// "Recognized tokens" line above, both SKILL mirrors' Arguments line, and the
// task behind this rule name — and neither does `close-out=off`, which the old
// regex read as a grant, turning an explicit refusal into the very grant it
// refused. An alias no enumeration of the tokens mentions is a discretion
// nobody asked for and nobody could have asked for: the scope agent, not told
// the spelling is reserved, folds it into the TARGET.
// What the rule does NOT close, and cannot: a target that IS the bare token, or
// names it as its own word — `review branch close-out`, `review the close-out
// section`, a branch named `light`. One prose string carries both the reserved
// tokens and the target (see the "Recognized tokens" line above), so that
// residual is the interface's, not the regex's; a wider pattern only trades it
// for the path-name grants this rule exists to stop. Structured invocation is
// the unambiguous channel, and the grant only ever buys a bounded, diff-checked
// exit.
const argTokens = new Set(lowerArgs.split(/\s+/).map((t) => t.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")).filter(Boolean));
const lightMode = structured ? args.mode === "light" : argTokens.has("light");
// The trivial-round close-out is granted, never assumed: absent this flag the
// cycle re-reviews every fix, exactly as before.
const closeOutMode = structured ? args.closeOut === "on" : argTokens.has("close-out");
let requestedRounds = structured ? args.maxRounds : null;
if (!structured) {
  const m = lowerArgs.match(/\bmax[\s-]*rounds\s*[=:]\s*(-?\d+(?:\.\d+)?)\b/);
  if (m) requestedRounds = Number(m[1]);
}
let artifactTypeToken = structured ? args.artifactType : null;
if (!structured) {
  // Same token rule for the bare fallback spelling: `review this decision`
  // still names the type, while `feature/decision-log` names a branch.
  const t = lowerArgs.match(/\bartifact[\s-]*type\s*[=:]?\s*(code|prose|decision)\b/);
  artifactTypeToken = t ? t[1] : ["prose", "decision"].find((x) => argTokens.has(x)) || null;
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
    closeOut: closeOutMode ? "on" : "off",
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
    closeOut: closeOutMode ? "on" : "off",
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
  // The MODE flag ("on"/"off"), deliberately not named `closeOut`: the cycle
  // result's own `closeOut` is the RECORD of a close-out that ended the cycle,
  // and the spread below would overwrite this string with it on exactly the
  // runs where the grant mattered — leaving the field a string everywhere
  // except where a reader most needs to tell the two apart.
  closeOutMode: cycleConfig.closeOut,
  peer: cycleConfig.peer,
  ...cycleResult,
};
