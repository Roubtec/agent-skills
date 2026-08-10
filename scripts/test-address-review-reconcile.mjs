#!/usr/bin/env node
// Focused behavior test for `wf-address-review.js`'s BRANCH RECONCILIATION GATE
// — the script-side control flow that decides, before anything is addressed,
// whether this run may act on the checked-out branch at all (task 021b).
//
// Three properties hold the gate up, and each is a separate way to lose it:
//
//   1. The OFF-SHOOT EXEMPTION. Reconciliation is keyed on the two BRANCH
//      NAMES: only a run whose checked-out branch IS the PR's head ref
//      reconciles. Where they differ the supported local off-shoot of a
//      merge-pending PR is in play, "behind the PR head" is that case's normal
//      state, and the run proceeds whatever the gather reported.
//   2. FAILING CLOSED. On the PR's own branch, only `work` and
//      `fast-forwarded` let the run continue. Everything else stops it —
//      `unrecognized`, an outcome string this script does not know, an empty
//      one, an absent report, and `not-applicable` (which on THIS branch is a
//      contradiction, not an exemption: keying the gate on the outcome instead
//      of the names would let a misreporting agent bypass reconciliation).
//   3. The ORDER relative to the empty-`items` no-op. The rule's third outcome
//      returns NO items by contract, so a gate placed after the no-op would
//      report an unreconciled branch as "nothing to address" — the silent
//      wrong answer, and the one a reader of the result cannot tell from a
//      genuinely clean PR.
//
// The workflows are runtime scripts (top-level await/return, injected
// `agent`/`workflow`/`phase`/`log` globals), so they cannot be imported. This
// evaluates the ACTUAL shipped source — no second copy of the gate — with those
// globals stubbed, and drives scripted gather packets through it, reading the
// result the script returns. The nested review cycle is the "the run proceeded"
// signal: reaching `workflow("wf-review-cycle", ...)` at all means the gate let
// this run through.
//
// The gate is only the CONSUMER of `packet.reconcile`. The producer is a
// paragraph of the gather brief, which no scenario reaches because the gather
// agent is stubbed — so the RULE it states is read out of the rendered brief
// directly: both probes, the head they compare against, the off-shoot skip, and
// the outcome strings, whose agreement with the strings the gate keys on
// nothing else pins.
//
// That brief is one of three renderings of where the compared head comes from;
// the other two are the two review-addressing SKILLs, in both mirrors (task
// 021d). They are prose no scenario can execute, and the probe they replaced
// (`git cat-file -e` on the OID `gh pr view` reported) is exactly the shape a
// later edit re-imports as a "safety check", so their paragraphs are read here
// beside the brief's.
//
// It also covers the publication guard that landed beside the gate, which is
// prompt prose rather than script logic: a HEAD that is a proper ancestor of
// the PR head must stop the publisher BEFORE the lease it would otherwise
// match and rewind the branch with.
//
// It covers the DELEGATED REBASE POINTS that run just after the gate (task
// 016), for the same reason and through the same harness: the base each one
// pins is what every later delegation's diff range is taken against, so the
// caller must reject anything but a full commit, and a conflict the step cannot
// judge must stop the run with its question rather than being guessed at. Its
// own producer half — the brief that makes the agent resolve and pin a commit at
// all — is read out of the rendered text like the gather brief's, and read
// against the canonical nugget's clauses, which this rendering exists to carry
// to an agent that has read no skill and so must not drift from.
//
// The PRE-PUSH point is driven too, which needs the nested cycle to RETURN
// rather than end the scenario: it runs only after a cycle passes, and where it
// replays anything the cycle runs a second time over the rebased tree. That
// second cycle is the run's whole honesty guarantee — its fixer carries the
// dispositions that already passed rather than re-triaging them, its reviewer
// compares against them, and the cycle it replaces still owns open questions and
// deviations that are the maintainer's — so the harness scripts cycle results in
// order instead of stopping at the first call. Three properties of that merge
// are pinned beside the verdict: the second cycle is bounded by what the first
// LEFT of the run's 12-round total rather than by a fixed ceiling (and a run
// with none left stops unpublished), a deviation both cycles state is folded to
// one with one assessment, and the superseded cycle's `preRebase*` records reach
// the PR comment rather than only the run's result — which is why the publisher
// is stubbed here at all.
//
// And it covers the sibling gate that runs just ahead of this one (task 018):
// the WORKING LOCATION, which decides not whether the run may act on the branch
// but in which tree it acts. Both gates are the same shape — a gather-reported
// field the caller must not read charitably — and both fail closed, so they are
// driven through the same harness rather than a second copy of it. Two things
// hang off that location and are pinned beside it: a HALT keeps the worktree
// (bar the fork arm's rejected landing, below), so the blocker exit — which
// runs before the pair is even validated — has to name the surviving path, and
// the brief has to oblige a blocker packet to carry it; and the three
// helper-free attach arms each fail as written if they lose a clause (a
// pathless `git worktree add --detach`, an add that never reads the live
// registration a halted run left behind, an arm order that lets a prior fork
// run's leftover local branch claim the re-run, a landing verification that
// states no consequence, or one whose consequence keeps a tree the re-run would
// then stop on forever), which no scenario can observe because the gather agent
// is stubbed.
//
// Run: node scripts/test-address-review-reconcile.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const workflows = join(here, "..", "plugins", "dev-skills", "workflows");
const SOURCE = "wf-address-review.js";

let failures = 0;
let ran = 0;
function check(name, cond, detail) {
  ran++;
  if (cond) {
    console.log(`ok  - ${name}`);
  } else {
    failures++;
    console.error(`NOT ok - ${name}${detail ? `: ${detail}` : ""}`);
  }
}

// How many checks this suite must run. Read BEFORE the assertion itself, so it
// does not count: that final `check(...)` evaluates `ran === EXPECTED_CHECKS`
// as an argument, ahead of its own `ran++`. So this number is one LESS than the
// `check(` call sites in the file, by construction — counting the sites reads
// one too many and is not a way to audit it. Bump it deliberately when adding
// or removing a check — a scenario that silently stops running is invisible to
// a suite that only gates on failures.
const EXPECTED_CHECKS = 156;

const src = readFileSync(join(workflows, SOURCE), "utf8");
// The runtime requires `export const meta` as the first statement, which is
// module syntax; a function body is not a module. Dropping the `export` is the
// only edit made to the shipped text.
const body = src.replace(/^export const meta/m, "const meta");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
// eslint-disable-next-line no-new-func
const script = new AsyncFunction(
  "args",
  "agent",
  "phase",
  "workflow",
  "parallel",
  "pipeline",
  "log",
  `"use strict";\n${body}`,
);

// The prompt builders are plain functions in the DECLARATION PREFIX — the text
// above the first statement that touches an injected global — so they can be
// evaluated on their own and rendered without driving a scenario. Both halves
// of the reconciliation are read that way: the rule the gather brief states,
// and the publication guard beside it.
const cut = src.indexOf("\nconst raw = flattenArgs(args);");
if (cut < 0) throw new Error(`${SOURCE}: cut marker not found for the declaration prefix`);
const prefix = src.slice(0, cut).replace(/^export const meta/m, "const meta");
// eslint-disable-next-line no-new-func
const { gatherPrompt, publishPrompt, rebasePrompt } = new Function(
  "args",
  `"use strict";\n${prefix}\nreturn { gatherPrompt, publishPrompt, rebasePrompt };`,
)("");

// Reaching the nested cycle ends the scenario: everything past the gate is
// another workflow's business. Thrown rather than returned so "the run
// proceeded" cannot be confused with any status the script itself returns.
const REACHED_CYCLE = Symbol("nested review cycle reached");

// A clean pre-fix rebase: it replayed nothing and pinned the base to a commit.
// This is the default because it is the common outcome, and because every
// scenario written before the rebase points existed must keep meaning what it
// meant — the gates under test are ahead of the rebase or indifferent to it.
// The recovery ref is part of the fixture rather than optional decoration: the
// brief saves it before anything is replayed and orders the step not to skip it,
// the caller refuses to adopt a report without one, and the stops name it to the
// maintainer — a fixture that omitted it would have this suite asserting a
// promise it never made the report keep. It carries the read-back beside it for
// the same reason: the name alone says nothing about whether the ref exists or
// what it points at, so the report the caller accepts is the one that shows it
// resolving to the tip the rebase started from.
const REBASE_NOOP = {
  ok: true,
  halted: false,
  noop: true,
  effectiveBase: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
  before: "cafebabe",
  after: "cafebabe",
  recoveryRef: "refs/pre-rebase/feature/x/20260809-090000",
  recoveryTip: "cafebabe",
  validationPassed: true,
  detail: "already on the pinned base; nothing replayed",
};
// A rebase that REPLAYED something: a different pinned base, a moved tip, and a
// passing post-rebase validation. What the pre-push point does with this is the
// re-verification the scenarios below drive.
const REBASE_REPLAY = {
  ok: true,
  halted: false,
  noop: false,
  effectiveBase: "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c",
  before: "cafebabe",
  after: "d00dfeed",
  recoveryRef: "refs/pre-rebase/feature/x/20260809-121314",
  recoveryTip: "cafebabe",
  validationPassed: true,
  detail: "replayed 2 commits onto the fresh base; build and tests passed",
};
// The full OID a scenario's gather reports for the PR's base ref. Under
// `no-rebase` this is the run's review base — nothing rebased to pin one.
const GATHERED_BASE_OID = "9988776655443322110099887766554433221100";

// A deviation from a locked decision, in the shape `wf-review-cycle` reports
// one: a STRING, which the cycle matches by exact text and has every later pass
// restate VERBATIM. The fixture states that shape rather than an opaque object
// because the exact text IS the identity the merge folds the two cycles' sets
// on, and an assessment names its deviation by copying it.
const DEVIATION = "delivered the guard inline rather than behind the flag the locked decision names; that flag does not exist on this base";
// A passing first cycle, in the result shape `wf-review-cycle` returns: enough
// of it that the consumer's coverage checks pass (one workReport entry per
// gathered item) and its for-the-human sets are non-empty, since whether those
// survive the re-verification is exactly what is under test.
const CYCLE_PASS = {
  verdict: "pass",
  rounds: 3,
  workReport: [
    {
      type: "review-thread",
      threadId: "T1",
      commentId: "C1",
      url: "https://example.invalid/pr/42#d1",
      ref: "src/app.ts:12 a-reviewer",
      kind: "actionable-fixed",
      detail: "guarded the null case in abc1234",
      author: "a-reviewer",
      authorIsBot: false,
      newFinding: true,
    },
  ],
  openQuestions: [{ id: "pr-42-q1", origin: "reviewer", blocking: false, question: "parked before the rebase" }],
  deviations: [DEVIATION],
  deviationAssessments: [{ deviation: DEVIATION, inSpecRoute: "none on the base it sat on", recommendation: "RATIFY — the flag lands with the follow-up" }],
  proactive: "swept the same pattern in two siblings",
  finalSha: "d00dfeed",
  artifactDir: "/artifacts/pr-42",
};
// The re-verification's own result: fewer rounds, its own question, and no
// deviation of its own — so a merged result must still carry the first cycle's.
const CYCLE_REVERIFIED = {
  ...CYCLE_PASS,
  rounds: 1,
  openQuestions: [{ id: "pr-42-post-q1", origin: "reviewer", blocking: false, question: "parked after the rebase" }],
  deviations: [],
  deviationAssessments: [],
  artifactDir: "/artifacts/pr-42-post-rebase",
};
// The re-verification RESTATING the deviation that still stands, which is what
// the cycle orders every pass to do — so this, not the empty set above, is the
// ordinary shape of a run whose deviation survives the rebase. Concatenated
// blindly it publishes the same deviation twice and hands "beside the deviation
// they name" two assessments for one deviation; its own assessment is the later
// round's judgment of it, and disagrees with the first, so which one survives
// the fold is observable.
const CYCLE_REVERIFIED_RESTATING = {
  ...CYCLE_REVERIFIED,
  deviations: [DEVIATION],
  deviationAssessments: [{ deviation: DEVIATION, inSpecRoute: "the replay brought the flag with it", recommendation: "CONFORM — the in-spec route exists on this base" }],
};
// The other shape a two-cycle deviation set comes in: the re-verification states
// a deviation of its OWN, so the merged result must carry BOTH, each beside the
// assessment that names it. This fixture is what makes the fold's IDENTITY
// observable rather than only the fold: where both cycles state the SAME
// deviation, "folded to one" and "folded to nothing but the last one" are the
// same observation, so an identity that returned a constant would pass while
// collapsing every deviation to the last and every assessment to the last —
// exactly what `review-cycle` forbids, since none may vanish with the loop's
// last turn and no deviation may reach the maintainer carrying only the
// implementer's half.
const SECOND_DEVIATION = "put the retry loop in the request path where the locked decision names the queue; that queue does not exist on this base";
const CYCLE_REVERIFIED_OWN_DEVIATION = {
  ...CYCLE_REVERIFIED,
  deviations: [SECOND_DEVIATION],
  deviationAssessments: [{ deviation: SECOND_DEVIATION, inSpecRoute: "the queue lands with the follow-up", recommendation: "RATIFY — no in-spec route exists on this base either" }],
};
// A first cycle that CONCLUDED over a failed delivery run, on the flake rule's
// evidenced-unrelated disposition, and over the one post-run commit that exit
// tolerates. The re-verification supersedes its verdict; the failure is still
// the maintainer's, and the PR comment is the run's only surface for it.
const FLAKE_RECORD = {
  pass: 4,
  range: "abc1234..def5678",
  verified: "the range holds one commit, the flake-diagnosis task file",
  note: "the delivery run's only failure was the payments suite, which reproduces on the base; filed as tasks/041-flaky-payments-suite.md",
};
const CYCLE_PASS_RECORD_ONLY = {
  ...CYCLE_PASS,
  recordOnly: FLAKE_RECORD,
  closeOut: { pass: 4, range: "abc1234..def5678", edits: ["reworded a comment"], verified: "every hunk non-semantic" },
};

// Run the shipped script with one scripted gather packet. `no-push` keeps the
// run local-only by default: the gate is flag-independent, and most of what is
// under test here stops well before publication. `opts.args` overrides the
// request, which three gates beside it need: whether a working branch other
// than the PR head ref was ever selected is read from the request rather than
// the packet, the rebase opt-out needs its own token, and the scenarios that
// read the PUBLISH brief need a request carrying no `no-push` flag, since
// publication is the default. `opts.rebase` scripts what every
// delegated rebase agent reports back and `opts.rebases` scripts one point
// at a time (keyed `pre-fix`/`pre-push`), and `opts.cycles` scripts what the
// nested cycle RETURNS, call by call — without it the first call ends the
// scenario, which is all the gates ahead of the cycle need. The publisher is
// stubbed as a clean success and its rendered brief kept, since what the caller
// HANDS it is script logic even though the brief itself is prose.
async function run(packet, opts = {}) {
  const seen = { agentLabels: [], cycleOpts: null, cycleCalls: [], rebasePrompts: [], publishPrompts: [], recordPrompts: [] };
  const agent = async (prompt, aopts) => {
    const label = (aopts && aopts.label) || "";
    seen.agentLabels.push(label);
    if (label === "gather") return packet;
    if (label.startsWith("rebase-")) {
      seen.rebasePrompts.push(prompt);
      const point = label.slice("rebase-".length);
      if (opts.rebases && Object.prototype.hasOwnProperty.call(opts.rebases, point)) return opts.rebases[point];
      return opts.rebase === undefined ? REBASE_NOOP : opts.rebase;
    }
    if (label === "publish") {
      seen.publishPrompts.push(prompt);
      return opts.publish === undefined
        ? { published: true, pushed: true, pushedNewCommits: true, threadOutcomes: [] }
        : opts.publish;
    }
    // The disposition record: the one PR write an exit that publishes nothing
    // makes. Stubbed as a clean post and its brief kept, for the publisher's
    // reason — WHICH exits reach it, and what they are handed, is script logic.
    if (label === "record") {
      seen.recordPrompts.push(prompt);
      return opts.record === undefined
        ? { posted: true, superseded: false, url: "https://example.invalid/pr/42#issuecomment-1", detail: "posted" }
        : opts.record;
    }
    throw new Error(`unexpected agent call past the gate: ${label}`);
  };
  const workflow = async (name, wopts) => {
    seen.cycleCalls.push({ name, opts: wopts });
    // The FIRST call, so every scenario written before the cycle returned
    // anything still reads the cycle it was written about.
    if (!seen.cycleOpts) seen.cycleOpts = { name, opts: wopts };
    const scripted = Array.isArray(opts.cycles) ? opts.cycles[seen.cycleCalls.length - 1] : undefined;
    if (scripted === undefined) throw REACHED_CYCLE;
    return scripted;
  };
  const nope = () => {
    throw new Error("unexpected fan-out call");
  };
  try {
    const result = await script(opts.args === undefined ? "no-push" : opts.args, agent, () => {}, workflow, nope, nope, () => {});
    return { status: (result && (result.status || (result.error ? "error" : "?"))) || "?", result, seen };
  } catch (err) {
    if (err === REACHED_CYCLE) return { status: "reached-cycle", result: null, seen };
    throw err;
  }
}

// One gathered item, in `PACKET_SCHEMA`'s `items` shape — `type`/`body` and the
// required `author`/`authorIsBot`, not a shorthand of this suite's own. Nothing
// past the gate reads an item here (the nested cycle is stubbed), but the first
// thing that would routes on `type`, so the fixture states the real shape.
const ITEM = {
  type: "review-thread",
  threadId: "T1",
  commentId: "C1",
  author: "a-reviewer",
  authorIsBot: false,
  body: "a finding",
  url: "https://example.invalid/pr/42#d1",
};
// A gather packet in the shape the schema requires. `reconcile` is spread in
// last so a scenario can omit it entirely — the absent-report case. The
// location pair is written the same way: `locationMode` defaults to the inline
// mode every reconciliation scenario runs in, and passing `null` omits the
// field, which the working-location gate below rejects.
function gathered({ workingBranch = "feature/x", items = [], reconcile, locationMode = "inline", worktree, baseOid = GATHERED_BASE_OID }) {
  const packet = {
    ok: true,
    // Every `ok: true` gather WITH ITEMS owes this echo — empty where the
    // request named no target — and the caller stops a run that omits it, since
    // an absent token cannot be told apart from one it must honor. An empty
    // gather owes nothing: its no-op exit runs ahead of the guard, and the
    // scenario below pins that, since with every fixture carrying the field a
    // guard moved ahead of the no-op would leave this suite green. Scenarios
    // that exercise a named target override it; the default is "none named".
    rebaseTarget: "",
    pr: {
      number: 42,
      url: "https://example.invalid/pr/42",
      branch: "feature/x",
      workingBranch,
      base: "main",
      headOid: "deadbeef",
      rebased: false,
    },
    items,
  };
  if (baseOid !== null) packet.pr.baseOid = baseOid;
  if (locationMode !== null) packet.pr.locationMode = locationMode;
  if (worktree !== undefined) packet.pr.worktree = worktree;
  if (reconcile !== undefined) packet.reconcile = reconcile;
  return packet;
}

// --- The working-location gate ----------------------------------------------
// The other script-side gate ahead of all work (task 018): which tree this run
// acts in. It is the gather agent's choice, and the caller validates the pair
// rather than trusting it at each use, because BOTH ways of getting it wrong
// send later phases somewhere they must not go. There is deliberately no
// default: reading an absent mode as `inline` looks safe (it asserts no path)
// and is not — a gather that attached a worktree and failed to report it would
// hand the cycle the empty string, i.e. the main checkout, which in that mode
// is not on the PR branch at all.
{
  const absent = await run(gathered({ locationMode: null, reconcile: { outcome: "work" }, items: [ITEM] }));
  check(
    "an absent locationMode stops the run and names the field",
    absent.status === "error" && /locationMode/.test((absent.result || {}).error || ""),
    JSON.stringify(absent.result),
  );
  const unknown = await run(gathered({ locationMode: "checkout", reconcile: { outcome: "work" }, items: [ITEM] }));
  check("an unrecognized locationMode stops the run", unknown.status === "error", JSON.stringify(unknown.result));
  const pathless = await run(gathered({ locationMode: "worktree", reconcile: { outcome: "work" }, items: [ITEM] }));
  check(
    "worktree mode with no absolute path stops the run rather than using the main checkout",
    pathless.status === "error" && /worktree/.test((pathless.result || {}).error || ""),
    JSON.stringify(pathless.result),
  );
  const contradictory = await run(gathered({ locationMode: "inline", worktree: "/w/.worktrees/c/pr-42", reconcile: { outcome: "work" }, items: [ITEM] }));
  check("inline mode carrying a worktree path stops the run — one of the two is wrong", contradictory.status === "error", JSON.stringify(contradictory.result));
  const wt = await run(gathered({ locationMode: "worktree", worktree: "/w/.worktrees/c/pr-42", reconcile: { outcome: "work" }, items: [ITEM] }));
  check("worktree mode with an absolute path proceeds to the nested cycle", wt.status === "reached-cycle", wt.status);
  const inline = await run(gathered({ reconcile: { outcome: "work" }, items: [ITEM] }));
  check(
    "and hands the cycle that worktree, where an inline run hands it the empty string (this checkout)",
    wt.seen.cycleOpts && wt.seen.cycleOpts.opts.worktree === "/w/.worktrees/c/pr-42" &&
      inline.seen.cycleOpts && inline.seen.cycleOpts.opts.worktree === "",
    JSON.stringify({
      worktreeRun: wt.seen.cycleOpts && wt.seen.cycleOpts.opts && wt.seen.cycleOpts.opts.worktree,
      inlineRun: inline.seen.cycleOpts && inline.seen.cycleOpts.opts && inline.seen.cycleOpts.opts.worktree,
    }),
  );
}

// --- What a HALTED run hands back: the worktree it left standing -------------
// The reclaim step runs only where the run FINISHED; halting is what KEEPS the
// tree (the fork arm's rejected landing hands its own back, inside the gather
// and before this exit ever sees a path), so a blocker raised after the attach
// is the one exit that must name the surviving path. It is also the exit that runs BEFORE the location pair is
// validated — the gather stopped, so there may be no usable pair at all — which
// is what makes this a property of its own rather than a corollary of the gate:
// the path is read defensively and surfaced in the `note` a maintainer reads
// first, not left to be dug out of the echoed `pr` object.
{
  const blockedPr = {
    number: 42,
    url: "https://example.invalid/pr/42",
    branch: "feature/x",
    workingBranch: "feature/x",
    base: "main",
    headOid: "deadbeef",
    locationMode: "worktree",
    worktree: "/w/.worktrees/c/pr-42",
  };
  const blocked = await run({ ok: false, blocker: "the reused worktree is mid-cherry-pick", pr: blockedPr, items: [] });
  const br = blocked.result || {};
  check(
    "a blocker raised after the attach names the surviving worktree where a maintainer reads it first",
    blocked.status === "error" && /\/w\/\.worktrees\/c\/pr-42/.test(br.note || "") && /still standing/.test(br.note || ""),
    JSON.stringify(br),
  );
  check(
    "and nothing reclaims it or runs past the gather",
    blocked.seen.agentLabels.join(",") === "gather" && blocked.seen.cycleOpts === null,
    JSON.stringify(blocked.seen),
  );
  // The other direction: a run that never attached anything has no path to
  // report, and reporting one would send the maintainer to a tree that does not
  // exist.
  const early = await run({ ok: false, blocker: "gh auth status failed", items: [] });
  check(
    "a blocker raised before any attach reports no worktree rather than inventing one",
    early.status === "error" && !("note" in (early.result || {})),
    JSON.stringify(early.result),
  );
}

// --- The producer half: how the working location is chosen -------------------
// The gate above validates the pair the gather agent REPORTED. What lets that
// report say `workingBranch != branch` at all is the gather brief's case list,
// which no scenario reaches because the gather agent is stubbed — so it is read
// out of the rendered brief: working on a branch that is NOT the PR head ref is
// reachable ONLY by the request naming it with `off-shoot`. Two review rounds
// tried to infer that case from the shape of the history instead; "already
// CARRIES the PR head" was the last such predicate, and it rejected the very
// case it was written for (an off-shoot cut BEFORE the head and advanced carries
// no head) while still admitting a stacked child that has not been PR'd. Both
// halves are pinned here: the token has to be the route, and that predicate must
// not come back.
{
  const brief = gatherPrompt("#42");
  const cases = brief.split("\n\n").find((p) => p.includes("take the FIRST case that applies")) || "";
  const tokenRoutes = /`off-shoot` token/.test(cases) && /NOTHING BUT THE TOKEN/.test(cases);
  const inferredFromShape = /CARRIES the PR head/.test(brief);
  check(
    "the off-shoot working location is selected by the `off-shoot` token, never inferred from the branch's shape",
    tokenRoutes && !inferredFromShape,
    `token route stated: ${tokenRoutes}; carries-the-head predicate present: ${inferredFromShape}`,
  );
  // The one check that survives beside the token is a stop for AMBIGUITY — the
  // named branch is also another open PR's head — and it has to answer exactly
  // that question and no neighbouring one. Two neighbouring ones are what a
  // base-repository PR LIST answers instead: `gh pr list --head <branch>` reads
  // one base repository (a PR based in another is simply absent), matches a bare
  // branch NAME (its own `--help` refuses `<owner>:<branch>`, so a fork's
  // same-named head answers for a branch it has nothing to do with), and stops
  // at 30 items. Filtering its rows back down to the right question took a
  // repository-qualified comparison whose components each had to be pinned
  // separately here, and it still could not recover the rows the list never
  // returned.
  //
  // So the probe is ROOTED at the head instead — the head repository's own ref,
  // which is what the question is about — and the pins follow that root. Every
  // open PR whose head IS that ref comes back whatever repository its base is
  // in, and nothing else does, which is why one filter now does what two could
  // not: exclude the PR being addressed by its `url`, since where the branch IS
  // that PR's head the query answers with the very PR under work and an
  // unqualified stop would halt an ordinary target-branch run on a token that is
  // merely redundant there.
  //
  // Three things hold that root up and each is a separate way to lose it: the
  // query shape (a `ref(qualifiedName:...)` carrying `associatedPullRequests`,
  // not a PR list), the ref it is rooted AT (this branch's own resolved push
  // remote/ref — without which the query names no ref at all), and the standing
  // refusal of the list form, which is what a later round would otherwise
  // restore as the obvious simplification.
  // Which PR is "a DIFFERENT one" has to be asked of a GLOBALLY unique
  // identifier, and the number is not one: a PR number is scoped to that PR's
  // own BASE repository, while this answer set spans base repositories by
  // construction — which is the entire reach the query root was widened for. So
  // an addressed #71 and a conflicting #71 based elsewhere compare EQUAL, and
  // the number filter discards precisely the case the widening reached. The
  // query already asks for `url`; both halves are pinned, the comparison and
  // the standing refusal of the number, because "just compare the number" is
  // what a later round restores as the obvious simplification.
  const excludesAddressedPr = /count a hit only where the PR's `url` DIFFERS from the resolved PR's own `url`/.test(cases);
  const refusesTheNumberComparison = /Compare the `url` and never the `number`/.test(cases);
  const rootsAtTheHeadRef = /ref\(qualifiedName:"refs\/heads\/<ref>"\)\{ associatedPullRequests\(states:OPEN/.test(cases);
  const resolvesThatRefFromPushTarget = /resolve `C`'s own push remote\/ref/.test(cases);
  const refusesTheListForm = /`gh pr list --head` delivers neither half/.test(cases);
  // `isCrossRepository` was named here as a cheap short-circuit until it was
  // found to license skipping the very comparison it stood in front of: the
  // field says whether the OTHER PR's own head and base repositories differ,
  // which is not the question asked. The query root now settles whose head it
  // is, so the field is not merely unqualified but has nothing left to answer —
  // and the refusal stays, because what invites it back is the same look of a
  // cheap answer that got it added the first time.
  const refusesShortCircuit = /`isCrossRepository` has no part in this and is not requested/.test(cases);
  check(
    "the conflicting-PR stop excludes the PR being addressed by its globally unique `url` — never by a base-scoped number — and asks the head repository's own ref which open PRs it heads, refusing the base-scoped PR list and any short-circuit of it",
    excludesAddressedPr && refusesTheNumberComparison && rootsAtTheHeadRef && resolvesThatRefFromPushTarget && refusesTheListForm && refusesShortCircuit,
    `url-identity filter stated: ${excludesAddressedPr}; number comparison refused: ${refusesTheNumberComparison}; rooted at the head ref: ${rootsAtTheHeadRef}; that ref resolved from this branch's push target: ${resolvesThatRefFromPushTarget}; base-scoped list form refused: ${refusesTheListForm}; short-circuit refused: ${refusesShortCircuit}`,
  );
  // Forced `inline` checks the target branch out in THIS checkout, and the
  // branch it checks out may already be there: a maintainer who has worked this
  // PR before still has a local `T` lying around, which is an ordinary place to
  // force the mode from. A create is not a checkout — `git checkout -b` and
  // `git switch -c` REFUSE a branch that already exists — so an unconditional
  // "create a local tracking branch" fails that run at setup, before the
  // supported mode is entered at all. Case 4's worktree arms already split
  // EXISTS from NONE; nothing but this text makes case 2 split it too.
  const inlineCase = cases.split("\n").find((l) => l.startsWith("2. ")) || "";
  if (!inlineCase) throw new Error(`${SOURCE}: forced-inline case not found; its checkout rule cannot be read`);
  const reusesExistingT = /where one EXISTS/.test(inlineCase);
  const createsOnlyWhenAbsent = /only where NONE/.test(inlineCase);
  check(
    "forced `inline` checks out an existing local `T` and creates one only where none exists",
    reusesExistingT && createsOnlyWhenAbsent,
    `reuse arm stated: ${reusesExistingT}; create conditioned on absence: ${createsOnlyWhenAbsent}`,
  );
  // Four clauses in the same case list, each of which the worktree case fails as
  // written without — and none of the failures is visible to the gate above,
  // which only ever sees what the gather REPORTED.
  //
  // `git worktree add` takes its path as a mandatory argument
  // (`git worktree add … <path> [<commit-ish>]`), so the fork arm's `--detach`
  // form needs one too: pathless, the command fails before `gh pr checkout` is
  // reached and the default worktree mode never runs for a fork PR at all.
  check(
    "the fork attach's detached add carries the worktree path",
    /git worktree add --detach "<worktree base>\/pr-<N>"/.test(cases),
    cases.includes("--detach") ? "the `--detach` add is present but pathless" : "no `--detach` add found",
  );
  // And `git worktree prune` clears STALE registrations only, so the LIVE one a
  // halted run left is exactly what survives it — which is the run this stable
  // slug exists to resume. Without a reuse arm the helper-free fallback's add
  // fails on an occupied path, so the documented resume works only where the
  // optional helper exists. The read is asserted to precede the ARMS rather than
  // to appear anywhere in the case, because scoping it to one arm is how this
  // was lost before: the fork arm is always helper-free and uses the same stable
  // path, so a read stated only for the local-`T` arms leaves the one attach
  // with no helper alternative unable to resume at all.
  // Scoping means nothing if the anchor can vanish: `indexOf` answers -1 for an
  // absent marker and `slice(0, -1)` would then hand every assertion below the
  // WHOLE case block, degrading this into the "appears somewhere" check it
  // exists to replace. Fail closed on the marker, as the declaration-prefix cut
  // above does.
  const armsAt = cases.indexOf("take the FIRST of these three arms");
  if (armsAt < 0) throw new Error(`${SOURCE}: arm-list marker not found; the registration read cannot be scoped ahead of the arms`);
  const registrationRule = cases.slice(0, armsAt);
  const readsRegistrations = /git worktree list/.test(registrationRule);
  const coversEveryArm = /any of the three arms below/.test(registrationRule);
  const reusesMatch = /REUSE it/.test(registrationRule);
  const stopsOnMismatch = /registered on anything ELSE/.test(registrationRule);
  check(
    "the registration read precedes every attach arm, reuses a `pr-<N>` tree already on the head ref, and stops on any other",
    readsRegistrations && coversEveryArm && reusesMatch && stopsOnMismatch,
    `reads registrations ahead of the arms: ${readsRegistrations}; scoped to every arm: ${coversEveryArm}; reuse arm: ${reusesMatch}; mismatch stop: ${stopsOnMismatch}`,
  );
  // The base every arm adds under has to be IGNORED, and this case is the only
  // thing that makes it so: `git worktree add` excludes nothing on its own and
  // neither does `wt-enter`, so in a repository not already carrying the rule
  // the nested add leaves `?? .worktrees/` in the main checkout — the one tree
  // this case promises never to dirty — and a halt, which is precisely what
  // KEEPS the worktree, leaves it standing. Pinned ahead of the arms for the
  // same reason the registration read is: stated inside one arm it would exempt
  // the other two, and the fork arm is always helper-free. Both halves are read,
  // because the probe without the write is a check nothing acts on: the
  // `check-ignore` probe, and the untracked repo-local exclude file it appends
  // to rather than the tracked `.gitignore`, which is the maintainer's.
  // Three shapes fail silently here and each is worth naming. The probe carries
  // a TRAILING SLASH because `/.worktrees/` is a directory-only rule and `git
  // check-ignore` answers NO for a bare `.worktrees` that is not on disk yet —
  // which is every first run, so the slashless form only ever agrees by
  // accident of ordering, and a re-probe after the append would fail outright.
  // The exclude file is asked of GIT rather than spelled `.git/info/exclude`,
  // because this checkout may itself be a linked worktree — as the run that
  // wrote this one was — where `.git` is a gitfile, `.git/info` is not a
  // directory, and the literal append fails before the base is ever protected.
  // And that question is asked from inside `<repo>`, because the answer is
  // CWD-relative where the neighbouring probe's `<repo>/…` placeholder is
  // absolute: in a primary checkout `--git-path` prints the relative
  // `.git/info/exclude` (a linked worktree gets an absolute path), so an agent
  // that runs it as `git -C <repo> …` and appends from its own directory writes
  // the rule to a file `check-ignore` never reads.
  const probesTheIgnoreRule = /git check-ignore -q "<repo>\/\.worktrees\/"/.test(registrationRule);
  const resolvesTheExcludeThroughGit =
    /append `\/\.worktrees\/` to the file `git rev-parse --git-path info\/exclude` names/.test(registrationRule) &&
    /rather than writing a literal `\.git\/info\/exclude`/.test(registrationRule) &&
    /NOT the tracked/.test(registrationRule);
  const resolvesItFromInsideTheRepo = /run (?:it )?from inside `<repo>`[\s\S]*?RELATIVE/.test(registrationRule);
  check(
    "the worktree base is made ignored before any arm adds under it, probed as a directory and appended to the exclude file Git itself names — resolved from inside `<repo>`, never a literal `.git/info/exclude` and never the tracked `.gitignore`",
    probesTheIgnoreRule && resolvesTheExcludeThroughGit && resolvesItFromInsideTheRepo,
    `ignore rule probed as a directory: ${probesTheIgnoreRule}; exclude resolved through git instead of a literal path or .gitignore: ${resolvesTheExcludeThroughGit}; resolved from inside the repo, the answer being CWD-relative: ${resolvesItFromInsideTheRepo}`,
  );
  // Arm ORDER is a contract in its own right, and prose has to settle it: a
  // prior fork run's `gh pr checkout` leaves a same-named local `T` behind, so
  // on the re-run both "a local `T` EXISTS" and "the head is a fork" describe
  // the tree, and the local arm would attach that leftover with no fork remote
  // wired up. The fork arm therefore has to be named as taking precedence, not
  // merely listed alongside.
  const forkFirst = /FORK head takes the first arm, ahead of both local-`T` arms/.test(cases);
  check(
    "the fork arm is stated to take precedence over the local-`T` arms",
    forkFirst,
    forkFirst ? "" : "the fork arm's precedence over the local-`T` arms is unstated",
  );
  // And the landing verification has to say what a FAILURE does. The identity
  // check runs before any checkout, so it cannot see a collision `gh`'s own
  // branch selection creates; a verification with no consequence leaves that
  // case to whatever the agent invents.
  const forkMismatchStops = /verification FAILS[\s\S]*?ok: false[\s\S]*?attach nothing further and substitute nothing/.test(cases);
  check(
    "a failed fork landing verification is a blocker that attaches and substitutes nothing",
    forkMismatchStops,
    forkMismatchStops ? "" : "the fork arm verifies the landing but states no consequence for a mismatch",
  );
  // And that consequence has to GIVE THE TREE BACK, which is the one thing the
  // rest of this case cannot recover from: the halt leaves `pr-<N>` detached or
  // on the rejected ref, and the registration read above then stops every
  // re-run on "registered on anything ELSE" — never a second slug and never a
  // removal — so the slug stays blocked even once the maintainer has fixed the
  // collision. `address-reviews` states the same give-back for the same
  // failure, and this arm is the one place a divergence would be invisible.
  const forkMismatchGivesTreeBack = /verification FAILS[\s\S]*?wt-remove pr-<N>[\s\S]*?git worktree remove/.test(cases);
  check(
    "and it hands that worktree back, so the rejected ref does not block the stable slug on every re-run",
    forkMismatchGivesTreeBack,
    forkMismatchGivesTreeBack ? "" : "the fork arm's failure path states no give-back, leaving `pr-<N>` occupied by the rejected landing",
  );
  // The location pair rides in `pr`, which is otherwise owed only on success —
  // so the packet that could silently omit the path is precisely the halt that
  // KEEPS the worktree standing. The consumer half is pinned above.
  const report = brief.split("\n\n").find((p) => p.includes("Report the choice as")) || "";
  check(
    "and a blocker packet raised after the attach still owes the location pair",
    /owed on a BLOCKER too/.test(report) && /pr\.worktree/.test(report),
    report,
  );
}

// --- On the PR's own branch: the two outcomes that let a run continue -------
{
  const clean = await run(gathered({ reconcile: { outcome: "work" } }));
  check("same-branch `work` with no threads is a plain no-op", clean.status === "no-op", JSON.stringify(clean.result));
  const working = await run(gathered({ reconcile: { outcome: "work" }, items: [ITEM] }));
  check("same-branch `work` with threads proceeds to the nested cycle", working.status === "reached-cycle", working.status);
  check(
    "and hands the cycle the checked-out branch",
    working.seen.cycleOpts && working.seen.cycleOpts.name === "wf-review-cycle" && working.seen.cycleOpts.opts.branch === "feature/x",
    JSON.stringify(working.seen.cycleOpts && working.seen.cycleOpts.opts && working.seen.cycleOpts.opts.branch),
  );
  const ffClean = await run(gathered({ reconcile: { outcome: "fast-forwarded" } }));
  check("same-branch `fast-forwarded` with no threads is a plain no-op", ffClean.status === "no-op", JSON.stringify(ffClean.result));
  // A no-op that had nothing to address may still have MOVED the branch, which
  // is the one outcome a reader cannot infer from "nothing to address".
  check(
    "and that no-op still names the reconciliation and carries its record",
    /fast-forwarded/.test((ffClean.result || {}).detail || "") &&
      ((ffClean.result || {}).reconcile || {}).outcome === "fast-forwarded",
    JSON.stringify(ffClean.result),
  );
  const ffWorking = await run(gathered({ reconcile: { outcome: "fast-forwarded" }, items: [ITEM] }));
  check("same-branch `fast-forwarded` with threads proceeds to the nested cycle", ffWorking.status === "reached-cycle", ffWorking.status);
}

// --- On the PR's own branch: everything else stops the run ------------------
// Every case here carries an EMPTY `items` array, which is the shape the rule's
// third outcome returns by contract. That is what makes the gate's position
// ahead of the empty-`items` no-op load-bearing: move it after, and each of
// these becomes an indistinguishable "nothing to address".
{
  const unrecognized = await run(gathered({ reconcile: { outcome: "unrecognized", detail: "local dropped 2 commits" } }));
  check("same-branch `unrecognized` stops the run", unrecognized.status === "skipped-unreconciled", unrecognized.status);
  const absent = await run(gathered({}));
  check("an absent `reconcile` report stops the run", absent.status === "skipped-unreconciled", absent.status);
  const unknown = await run(gathered({ reconcile: { outcome: "rebased" } }));
  check("an outcome string the script does not know stops the run", unknown.status === "skipped-unreconciled", unknown.status);
  const empty = await run(gathered({ reconcile: { outcome: "" } }));
  check("an empty outcome string stops the run", empty.status === "skipped-unreconciled", empty.status);
  // The gate is keyed on the BRANCH NAMES, not on the outcome. Keyed on the
  // outcome instead, this packet — an agent reporting the off-shoot exemption
  // for a run that is on the PR's own branch — would sail straight through
  // with reconciliation never performed.
  const contradiction = await run(gathered({ reconcile: { outcome: "not-applicable" } }));
  check("`not-applicable` reported ON the PR's own branch stops the run", contradiction.status === "skipped-unreconciled", contradiction.status);
  // And the gate wins over having work to do, not just over having none.
  const withWork = await run(gathered({ reconcile: { outcome: "unrecognized", detail: "diverged" }, items: [ITEM] }));
  check("an unreconciled branch stops the run even with threads to address", withWork.status === "skipped-unreconciled", withWork.status);
  check(
    "and nothing runs past the gate: no nested cycle, no agent but the gather",
    withWork.seen.cycleOpts === null && withWork.seen.agentLabels.join(",") === "gather",
    JSON.stringify(withWork.seen),
  );
}

// --- What the skip hands back ----------------------------------------------
// The skip is not a failure, so what it REPORTS is the whole of its value: a
// maintainer has to be able to see which branch, which PR, and what the probes
// saw without re-running anything.
{
  const record = { outcome: "unrecognized", detail: "local dropped 2 commits present on the head" };
  const skipped = await run(gathered({ reconcile: record }));
  const r = skipped.result || {};
  check(
    "the skip names the branch, the PR and the outcome, and quotes the gather's detail",
    /feature\/x/.test(r.detail || "") && /#42/.test(r.detail || "") && /unrecognized/.test(r.detail || "") && (r.detail || "").includes(record.detail),
    r.detail,
  );
  check(
    "it carries the pr object and the raw reconcile record back",
    JSON.stringify(r.pr) === JSON.stringify(gathered({ reconcile: record }).pr) && JSON.stringify(r.reconcile) === JSON.stringify(record),
    JSON.stringify({ pr: r.pr, reconcile: r.reconcile }),
  );
  check("and says nothing was addressed and nothing pushed, with what to do next", /nothing was pushed/i.test(r.note || "") && /re-run/.test(r.note || ""), r.note);
  const absent = await run(gathered({}));
  check(
    "an absent report is reported as absent rather than blamed on a state",
    /none reported/.test((absent.result || {}).detail || "") && /no detail reported/.test((absent.result || {}).detail || ""),
    (absent.result || {}).detail,
  );
}

// --- The off-shoot exemption ------------------------------------------------
// A local off-shoot of a merge-pending PR: `workingBranch` legitimately differs
// from the PR's head ref, fixes land on the off-shoot, and `branch`/`headOid`
// stay publication metadata. A run only arrives in that shape by the request
// NAMING the off-shoot (the `off-shoot` token, pinned above and, in the block
// after this one, enforced against the request); reconciliation itself is keyed
// on the two branch names and is indifferent to how the location was chosen,
// which is why these scenarios state the packet rather than the route — while
// carrying the token, without which the run stops before reaching this gate.
// Reconciliation is skipped WHOLE here, so no reported outcome — including none
// at all, and including one that contradicts the exemption — may stop the run.
{
  const off = { workingBranch: "feature/x-offshoot" };
  const SELECTED = "#42 off-shoot no-push";
  const clean = await run(gathered({ ...off, reconcile: { outcome: "not-applicable" } }), { args: SELECTED });
  check("off-shoot `not-applicable` with no threads is a plain no-op", clean.status === "no-op", JSON.stringify(clean.result));
  // The no-op's reconciliation record is not path-dependent: the off-shoot run
  // reports what reconciliation concluded exactly as the same-branch one above
  // does. Pinned because the difference is invisible from the gate — both paths
  // reach the SAME return — so a reader is free to conclude the off-shoot result
  // carries no such record, and one did.
  check(
    "and that no-op names the reconciliation and carries its record too",
    /not-applicable/.test((clean.result || {}).detail || "") &&
      ((clean.result || {}).reconcile || {}).outcome === "not-applicable",
    JSON.stringify(clean.result),
  );
  // This is the one scenario here that reaches a rebase point, and the rebase
  // report names the branch it saved a recovery ref FOR — which the caller checks
  // against the branch it dispatched. So an off-shoot run's report carries the
  // off-shoot's ref: the shared fixture's `feature/x` one would be another
  // branch's backup, which is exactly what that check refuses.
  const offRebase = { rebase: { ...REBASE_NOOP, recoveryRef: `refs/pre-rebase/${off.workingBranch}/20260809-090000` } };
  const working = await run(gathered({ ...off, reconcile: { outcome: "not-applicable" }, items: [ITEM] }), { args: SELECTED, ...offRebase });
  check("off-shoot `not-applicable` with threads proceeds to the nested cycle", working.status === "reached-cycle", working.status);
  check(
    "and the cycle runs on the off-shoot, not on the PR's head ref",
    working.seen.cycleOpts && working.seen.cycleOpts.opts.branch === "feature/x-offshoot",
    JSON.stringify(working.seen.cycleOpts && working.seen.cycleOpts.opts && working.seen.cycleOpts.opts.branch),
  );
  const absent = await run(gathered({ ...off }), { args: SELECTED });
  check("off-shoot with no `reconcile` report at all still proceeds", absent.status === "no-op", absent.status);
  const contradicting = await run(gathered({ ...off, reconcile: { outcome: "unrecognized", detail: "behind the PR head" } }), { args: SELECTED });
  check("off-shoot `unrecognized` still proceeds — behind the head is that case's normal state", contradicting.status === "no-op", contradicting.status);
}

// --- What ENTITLES a run to that exemption ----------------------------------
// The exemption above is triggered by two branch names the gather agent chose,
// and nothing in the packet says the request ever asked for a working branch
// other than the PR's head ref. So the token is parsed from the ARGS here, by
// the caller, and a differing `workingBranch` without it is a stop. Read the
// exemption without this gate and one gather deviation — the history-shape
// inference its brief forbids, or a plain misread of which branch it stood on —
// skips reconciliation whole and hands the fixing cycle a stacked child to edit
// and commit on, whose own commits publication then pushes onto this PR under
// `branch`. Nothing downstream can catch that: differing names are exactly what
// the supported case looks like, so every later step reads the deviation as the
// mode working. The two directions are pinned together, because a gate keyed on
// the wrong thing passes one of them: the token must ADMIT the supported case
// (covered above, and again here from a differently-spelled request) and REFUSE
// the packet that merely claims it.
{
  const off = { workingBranch: "feature/x-offshoot", reconcile: { outcome: "not-applicable" }, items: [ITEM] };
  // Every selecting row below reaches a rebase point, and the caller checks the
  // recovery ref the rebase reports against the branch it dispatched. So these
  // runs need the OFF-SHOOT's ref; the shared fixture's `feature/x` one is
  // another branch's backup and would stop every row on `rebase-unsaved-
  // recovery-ref` — a refusal that says nothing about the token read under test.
  const offRebase = { rebase: { ...REBASE_NOOP, recoveryRef: `refs/pre-rebase/${off.workingBranch}/20260809-090000` } };
  const unselected = await run(gathered(off));
  const u = unselected.result || {};
  check(
    "a working branch other than the PR head ref, from a request that never carried `off-shoot`, stops the run",
    unselected.status === "skipped-unselected-working-branch" && /off-shoot/.test(u.detail || ""),
    JSON.stringify(u),
  );
  check(
    "and nothing runs past the gather: no nested cycle, and the off-shoot is never edited",
    unselected.seen.cycleOpts === null && unselected.seen.agentLabels.join(",") === "gather",
    JSON.stringify(unselected.seen),
  );
  // Parsing is lenient over free prose exactly as the push/ping tokens are, and
  // the two directions of that leniency do NOT cost the same, which is what
  // decides how it is pinned. A false positive disables this gate for one run
  // and leaves the behaviour that shipped before it existed. A false negative
  // REFUSES a run the request genuinely selected — `skipped-unselected-working-
  // branch` on a supported case — and it is silent in the direction that reads
  // as the guard working. So the ADMIT direction is swept wide, over every
  // spelling a maintainer plausibly types: spaced and joined, quoted and
  // backticked, abutting a slash, and sharing a request with a quoted phrase or
  // a ref path. A round that narrows the text the token is read out of has to
  // keep every one of these.
  const selections = [
    "#42 off-shoot, no-push",
    "#42 off shoot, no-push",
    "#42 offshoot, no-push",
    "#42 off-shoots, no-push",
    '#42 "off-shoot", no-push',
    "#42 `off-shoot`, no-push",
    '#42 please use "off-shoot mode", no-push',
    "#42 off-shoot/no-push",
    '#42 the review says "use origin/main" and off-shoot "yes"',
    "#42 off-shoot; rebase onto origin/main first, no-push",
    "#42 work on the off-shoot at task/021c-guard, no-push",
    "#42 use off-shoot mode (see `docs/off-shoot.md`), no-push",
    "#42 this run is an off-shoot of the head, no-push",
    "#42 don't push; off-shoot",
  ];
  const refused = [];
  for (const req of selections) {
    const r = await run(gathered(off), { args: req, ...offRebase });
    if (r.status !== "reached-cycle") refused.push(`${req} -> ${r.status}`);
  }
  check(
    "and every genuine selection reaches the cycle — spaced, joined, plural, quoted, backticked, slash-abutted, and beside a quoted phrase or a ref path",
    refused.length === 0,
    refused.join("; "),
  );
  // The residual, pinned as the deliberate choice it is rather than left to be
  // rediscovered: a request that merely MENTIONS an off-shoot selects one too,
  // so an incidental mention disables this gate for that run. A narrowing pass
  // over the text the token is read from — strip ref paths, quoted phrases,
  // negations, the way `push-back` is stripped before `push` — was written and
  // removed: measured against this same harness it caught 4 of 10 incidental
  // mentions while REFUSING 3 of the genuine selections above, and the
  // categories leaked anyway. Every row here is one that pass was supposed to
  // catch and the last four are ones it did not, so restoring it in that form
  // fails the check above by name before this one is even consulted. Widening
  // it further is the same trade in the costlier direction. What the gate still
  // catches, and what it is for, is the check at the top of this block: a
  // deviating packet from a request that never says `off-shoot` at all.
  const incidental = [
    "#42 rebase on top of task/021c-publication-guard-for-an-off-shoot, no-push",
    "#42 branch feature/offshoot-ui, no-push",
    '#42 title "Fix offshoot accounting", no-push',
    "#42 this is not an off shoot, no-push",
    '#42 title "Fix the off-shoot in src/a"',
    "#42 no off-shoot, use a worktree",
    "#42 do not use off-shoot mode",
    "#42 don't use the off-shoot mode",
    "#42 don't work on the off-shoot",
    "#42 rebase onto off-shoot-guard, no-push",
  ];
  const stopped = [];
  for (const req of incidental) {
    const r = await run(gathered(off), { args: req, ...offRebase });
    if (r.status !== "reached-cycle") stopped.push(`${req} -> ${r.status}`);
  }
  check(
    "while an incidental mention — a ref path, a quoted phrase, a negation — selects the off-shoot too: the accepted residual of reading the token from the whole request, no context stripped",
    stopped.length === 0,
    stopped.join("; "),
  );
}

// --- The producer half: the rule the gather brief states ---------------------
// Everything above exercises the CONSUMER of `packet.reconcile`. What makes
// that field exist is a paragraph of the gather brief that no scenario reaches,
// since the gather agent is stubbed with a packet already written — delete the
// paragraph and every check above still passes while no run ever reconciles
// anything again. So the brief is rendered and read: the two probes it orders,
// the off-shoot skip, and the outcome vocabulary it fixes.
{
  const brief = gatherPrompt("#42");
  const probes = ["git rev-list --right-only --cherry-pick", "git merge-base --is-ancestor"];
  const missing = probes.filter((p) => !brief.includes(p));
  check("the gather brief orders both reconciliation probes", missing.length === 0, `missing: ${missing.join("; ")}`);

  // Where the probes' `R` comes from decides what they compare against. The
  // OID `gh pr view` reported is normally reachable from the checkout itself,
  // so testing that it exists locally passes just as well after the head moved
  // — and every probe then runs against a stale tip.
  const readsFetchedHead = brief.includes("git rev-parse FETCH_HEAD");
  // `cat-file` in its existence modes asks nothing but whether the object is
  // there, so it counts however it is spelled: `-t` reports the type but fails
  // identically on a missing object, and the spacing between the two words is
  // free. One source for every read of it in this file — this brief's, the four
  // SKILL paragraphs' and the file-wide ban below — because a second spelling of
  // the same ban is one that silently narrows: a probe re-imported as
  // `git cat-file  -e` or `git cat-file -t` would satisfy a literal
  // `cat-file -e` read while the paragraph read caught it, or the reverse.
  const catFileProbe = /cat-file\s+-[et]\b/;
  const testsObjectExistence = catFileProbe.test(brief);
  check(
    "and takes their `R` from the fetched ref, not from an existence test on the recorded OID",
    readsFetchedHead && !testsObjectExistence,
    `reads FETCH_HEAD: ${readsFetchedHead}; tests object existence: ${testsObjectExistence}`,
  );

  // The same rule, in the two SKILLs that state it to a reader rather than to a
  // subagent — and in both mirrors, which no generator keeps in step. Each file
  // is anchored to the PARAGRAPH that carries the rule, not to the file, so the
  // read stays where the decision is made. Today every `FETCH_HEAD` mention in
  // all four files already sits inside that paragraph (2 occurrences in
  // `address-review`, 4 in `address-reviews`, one line each), so the anchoring
  // is defensive rather than load-bearing: it keeps a rule paragraph reverted to
  // an existence test from being excused by a mention some future edit adds
  // elsewhere in the file, which a file-level search would accept.
  //
  // Reading the paragraph for the fetched-head command is not enough by itself.
  // A gutted instruction — "do not use `git rev-parse FETCH_HEAD`; retain the
  // recorded OID" — contains the command, and an existence gate re-spelled as
  // `git rev-parse --verify <headRefOid>^{commit}` with the fetched head demoted
  // to a fallback contains it too. So each paragraph is read for two more
  // things: the PHRASE its own skill states the rule in (`address-review`'s
  // "rather than the recorded `headRefOid`"; `address-reviews`' "adopt the
  // fetched OID as this entry's head"), and the absence of any object-existence
  // gate other than reading the fetched head itself — which commands count, and
  // in which spellings, is enumerated below. `cat-file` in its existence modes
  // is banned file-wide as well, because re-importing that probe anywhere in
  // either skill is the regression — and it is banned there in exactly the
  // spellings the paragraph read counts, off the one `catFileProbe` above, so
  // the file-wide ban cannot narrow to a single spelling while the paragraph
  // read stays wide.
  //
  // Both are pins on the PHRASING, not on the meaning, and the claim goes no
  // further than that: a regex over prose cannot tell "adopt X" from "adopt X
  // only where Y", so what these catch is an edit that drops the phrasing or
  // re-imports a probe — the shape an ordinary rewrite takes. What they MISS,
  // stated so nobody reads a pass as a semantic guarantee: a rule REVERSED
  // while the pinned phrase survives ("never adopt the fetched OID as this
  // entry's head" contains it), a demotion of the fetched head stated without
  // naming any git command, a probe spelled outside the forms enumerated below
  // — a `rev-parse` that neither asks `--verify` nor peels, `cat-file` in any
  // other mode — and any of them written without backticks, since only
  // backticked spans are read. Polarity is the reviewer's to hold; sharpening a
  // regex at it only buys the next evasion.
  //
  // One limit runs the other way and is listed apart from those, because it is
  // an OVER-report rather than a miss. The exemption below recognizes the
  // fetched-head read only in its CANONICAL spelling — the whole span being
  // `git rev-parse FETCH_HEAD`, with an optional `--verify`, an optional peel
  // suffix, and nothing else — so a re-spelled read that ALSO asks `--verify`
  // or peels is reported as a gate: `git -C <path> rev-parse --verify
  // FETCH_HEAD^{commit}`, `git rev-parse --verify --quiet FETCH_HEAD`,
  // `git rev-parse --verify FETCH_HEAD > <file>`. A re-spelling
  // carrying neither marker never reaches the probe at all, so it passes
  // regardless — which is why the four shipped paragraphs, all using the bare
  // read, are unaffected. The remedy when it does fire is to normalize the
  // spelling in the paragraph, or to widen the recognizer deliberately — never
  // to relax it back to "the span mentions `FETCH_HEAD`", the evasion the
  // whole-read anchor exists to close. It fails loudly and prints the offending
  // span, so unlike the misses above it cannot be mistaken for a pass.
  {
    const mirrors = ["plugins/dev-skills/skills", "codex/dev-skills/skills"];
    // The probe is looked for command-first, not by proximity to a name for the
    // recorded OID: `<headRefOid>`, `"$PR_HEAD"` and a bare `HEAD^{commit}` are
    // the same gate. But `rev-parse` is not one command: these four files run it
    // in three spellings that query no object's existence at all
    // (`--show-toplevel`, `--git-path rebase-merge`, `origin/main`), plus
    // `--abbrev-ref HEAD`, which two of them still carry as the counter-example
    // the publication re-check names — so counting every `rev-parse` as an
    // existence probe would fail an ordinary edit that mentions one of those
    // inside the rule paragraph. `rev-parse` therefore counts only in its object-query
    // spellings — `--verify`, or a peel suffix (`^{commit}`, `^{}`), which is
    // how an existence gate on a commit is written; `cat-file -e`/`-t` asks
    // nothing else and counts however it is spelled. Reading the fetch itself is
    // benign, and that one span is exempted by being the fetched-head read
    // WHOLE, not by mentioning `FETCH_HEAD` somewhere: a span that gates on the
    // recorded OID and names `FETCH_HEAD` beside it — `… ^{commit} || git
    // rev-parse FETCH_HEAD`, or the same gate with a trailing comment
    // mentioning it — is the gate, not the read.
    const existenceProbe = new RegExp(`${catFileProbe.source}|rev-parse\\b[^\`]*(?:--verify\\b|\\^\\{[a-z]*\\})`);
    const fetchedHeadRead = /^`git rev-parse (?:--verify )?FETCH_HEAD(?:\^\{[a-z]*\})?`$/;
    const gatingProbes = (para) =>
      (para.match(/`[^`\n]+`/g) || []).filter((span) => existenceProbe.test(span) && !fetchedHeadRead.test(span));
    // The discriminator is fixtured on synthetic spans, because it is the whole
    // reason this read stays off ordinary prose: get it wrong in the loose
    // direction and a reversed rule passes, wrong in the strict direction and an
    // edit that merely mentions a branch-name query fails. Neither miss is
    // visible from the shipped text, which contains none of these spans.
    // Each PART of the discriminator is fixtured separately, so that no part
    // rides on another: the shared span appears with the read on both sides
    // (drop the exemption's trailing anchor and "starts with the read" is
    // excused, which is the same evasion with its halves swapped), and one gate
    // asks only `--verify` while another only peels (drop either branch of the
    // probe and that gate goes unseen). What a fixture pins is the PART, not
    // every character that spells it: the exemption's trailing backtick and its
    // `$` are redundant with each other, since an extracted span always ends in
    // a backtick and never contains one, so deleting `$` alone changes no
    // verdict and the suite stays green. Deleting the backtick misjudges the
    // peel-spelled read; deleting the trailing anchor entirely misjudges the
    // shared span with the read first.
    // The `cat-file` branch is fixtured in its spellings for the same reason,
    // and those fixtures do double duty: `catFileProbe` is the file-wide ban
    // as well, so narrowing it to one literal spelling — the shape that lets a
    // re-imported probe back in unseen — misjudges a case here rather than
    // quietly weakening a read no fixture exercises.
    const probeFixtures = [
      ["a non-query `rev-parse`", "Record the tip with `git rev-parse --abbrev-ref HEAD` first.", false],
      ["the fetched-head read", "take the head from `git rev-parse FETCH_HEAD` instead", false],
      ["the same read spelled with a peel", "resolve `git rev-parse --verify FETCH_HEAD^{commit}`", false],
      ["a gate on the recorded OID", "confirm `git rev-parse --verify <headRefOid>^{commit}` first", true],
      [
        "a gate sharing its span with the read",
        "prefer `git rev-parse --verify <headRefOid>^{commit} || git rev-parse FETCH_HEAD`",
        true,
      ],
      [
        "a gate sharing its span with the read, the read first",
        "prefer `git rev-parse FETCH_HEAD || git rev-parse --verify <headRefOid>^{commit}`",
        true,
      ],
      [
        "a gate whose comment names the read",
        "run `git rev-parse --verify <headRefOid>^{commit}  # cheaper than reading FETCH_HEAD`",
        true,
      ],
      ["a gate that only asks `--verify`", "confirm `git rev-parse --verify <headRefOid>` first", true],
      ["a gate that only peels", "confirm `git rev-parse <headRefOid>^{commit}` first", true],
      ["a gate spelled `cat-file -e`", "confirm `git cat-file -e <headRefOid>^{commit}` first", true],
      ["the same gate spelled `cat-file -t`", "confirm `git cat-file -t <headRefOid>^{commit}` first", true],
      ["the same gate with the words spaced apart", "confirm `git cat-file  -e <headRefOid>^{commit}` first", true],
    ];
    const misjudged = probeFixtures
      .filter(([, para, isGate]) => (gatingProbes(para).length > 0) !== isGate)
      .map(([what]) => what);
    check(
      "and that read counts a gate on the recorded OID even beside the fetched-head read, in either order and whether it asks `--verify` or only peels, while leaving a non-query `rev-parse` alone",
      misjudged.length === 0,
      `misjudged: ${misjudged.join("; ")}`,
    );
    const rulePara = [
      [
        "address-review",
        "**Reconcile the working location's branch with the PR head before triaging anything.**",
        /rather than (?:from )?the recorded `headRefOid`/,
      ],
      ["address-reviews", "The canonical path.", /adopt(?:ing)? the fetched OID as (?:this|the) entry's head/],
    ];
    const unread = [];
    const unphrased = [];
    const gated = [];
    const probed = [];
    for (const mirror of mirrors) {
      for (const [skill, anchor, phrase] of rulePara) {
        const path = `${mirror}/${skill}/SKILL.md`;
        let text;
        try {
          text = readFileSync(join(here, "..", mirror, skill, "SKILL.md"), "utf8");
        } catch (err) {
          unread.push(`${path} cannot be read: ${err.message}`);
          continue;
        }
        const para = text.split("\n\n").find((p) => p.includes(anchor));
        if (!para) {
          unread.push(`${path} has no paragraph carrying ${JSON.stringify(anchor)}`);
        } else {
          if (!/git rev-parse (?:--verify )?FETCH_HEAD/.test(para)) unread.push(`${path}'s rule paragraph does not read the fetched head`);
          if (!phrase.test(para)) unphrased.push(`${path} does not state ${phrase}`);
          const probes = gatingProbes(para);
          if (probes.length) gated.push(`${path} runs ${probes.join(", ")}`);
        }
        if (catFileProbe.test(text)) probed.push(path);
      }
    }
    check(
      "and both skills state that same rule, in both mirrors — the head comes from `git rev-parse FETCH_HEAD`",
      unread.length === 0,
      unread.join("; "),
    );
    check(
      "and each carries the phrase its own skill states the rule in, so a rewrite that drops the phrasing fails",
      unphrased.length === 0,
      unphrased.join("; "),
    );
    check(
      "and no rule paragraph gates on an object's existence — `cat-file -e`/`-t`, or a `rev-parse` that asks `--verify` or peels — except in reading the fetched head itself",
      gated.length === 0,
      gated.join("; "),
    );
    check(
      "and no skill has re-imported the existence probe on the recorded OID",
      probed.length === 0,
      `tests \`cat-file -e\`/\`-t\`: ${probed.join(", ")}`,
    );
  }

  // The off-shoot exemption is stated to the agent as well as enforced by the
  // gate: where the names differ the step is skipped WHOLE, which is what makes
  // `not-applicable` the honest report there rather than an unrun probe's.
  const skipPara = brief.split("\n\n").find((p) => p.includes('outcome: "not-applicable"')) || "";
  check(
    "and skips reconciliation whole where the branch names differ, reporting `not-applicable`",
    /differ/i.test(skipPara) && /skip/i.test(skipPara),
    skipPara ? skipPara.slice(0, 160) : 'no paragraph reports `outcome: "not-applicable"`',
  );

  // The base commit this brief resolves is the review base of every `no-rebase`
  // run, and WHICH REPOSITORY it is read in decides whether it is the PR's base
  // at all. The branch's push remote is the HEAD repository: on a
  // cross-repository PR `<push-remote>/<baseRefName>` is a same-named branch in
  // the fork or nothing, so a run there pins a commit off another branch — or
  // fails — while looking exactly like a run that worked. And a remote-tracking
  // ref is only as fresh as its last fetch, so reading one instead of fetching
  // can pin a commit the base has moved past even same-repo. Both halves are
  // pinned: the base repository is the PR's own, and the ref is fetched and
  // resolved from what the fetch brought.
  // And WHICH VALUE names that repository, which is the same hazard one step in:
  // `gh repo view` with no repository argument answers for the repository the
  // directory it runs in resolves to, so in the very fork-clone case this
  // paragraph exists for it names the HEAD fork and the fetch lands on a
  // same-named branch there. The PR's own URL is the explicit, already-resolved
  // value that cannot drift with the working directory.
  const noRebaseBrief = gatherPrompt("#42 no-rebase", true);
  const basePara = noRebaseBrief.split("\n\n").find((p) => p.includes("pr.baseOid")) || "";
  const readsBaseRepo = /base always lives in the repository the PR itself is in/.test(basePara);
  const notThePushRemote = /NOT this branch's push remote|not through this branch's push remote/.test(basePara);
  const namesItFromThePrUrl = /this PR's OWN URL names/.test(basePara) && /you report as `pr\.url`/.test(basePara);
  const refusesTheDirectoryDerivedRepo =
    /Do not ask a bare `gh repo view/.test(basePara) && /answers for the repository the DIRECTORY it runs in/.test(basePara);
  const fetchesIt = /git fetch <the remote whose URL is that repository/.test(basePara) && /moving any branch/i.test(basePara);
  const resolvesTheFetch = /rev-parse --verify FETCH_HEAD\^\{commit\}/.test(basePara);
  const refusesTheTrackingRef = /remote-tracking ref is only as fresh as/.test(basePara);
  check(
    "and resolves the base commit in the PR's OWN repository — named from the PR's URL, not from the directory `gh repo view` would answer for — freshly fetched, rather than through the branch's push remote or a remote-tracking ref",
    readsBaseRepo && notThePushRemote && namesItFromThePrUrl && refusesTheDirectoryDerivedRepo && fetchesIt && resolvesTheFetch && refusesTheTrackingRef,
    `base repository stated: ${readsBaseRepo}; push remote refused: ${notThePushRemote}; named from the PR url: ${namesItFromThePrUrl}; directory-derived repo refused: ${refusesTheDirectoryDerivedRepo}; fetches the ref: ${fetchesIt}; resolves the fetch: ${resolvesTheFetch}; refuses a tracking ref: ${refusesTheTrackingRef}`,
  );

  // ...but only where the request named no target of its own. `no-rebase`
  // drops the REBASE, not the target the request named, and the caller reads
  // this one value as the review base for the whole run — so a brief that
  // resolves `baseRefName` unconditionally bounds a
  // `rebase on top of <target> no-rebase` run at the underlying branch and
  // hands the reviewer and the peer that branch's own commits as this PR's
  // diff, the same harm the base-repository paragraph above exists to prevent,
  // arriving by the other road. The gather is the only actor that can pick the
  // arm, being what reports `rebaseTarget` in the first place.
  const namedArmFirst = basePara.includes("where you are about to report a NON-EMPTY `rebaseTarget`, that token is the target");
  const saysWhyTheTokenSurvives = basePara.includes("`no-rebase` suppresses the REBASE, not the target the request named");
  const resolvesItWhereNamed = basePara.includes("Resolve THAT one where it was named — here, in this working location") && basePara.includes("fetch NOTHING for it");
  const baseRefIsTheOtherArm = basePara.includes("Only where `rebaseTarget` is EMPTY is the target this PR's own `baseRefName`");
  check(
    "and takes a still-standing `rebase on top of <target>` as that base instead, resolved where it was named — `no-rebase` drops the rebase, not the target",
    namedArmFirst && saysWhyTheTokenSurvives && resolvesItWhereNamed && baseRefIsTheOtherArm,
    `named arm stated: ${namedArmFirst}; why the token survives: ${saysWhyTheTokenSurvives}; resolved where named without a fetch: ${resolvesItWhereNamed}; base ref is the other arm: ${baseRefIsTheOtherArm}`,
  );

  // The brief is only half the contract the gather agent is handed: the SCHEMA
  // goes with it and is where this field's MEANING is stated, in the same
  // agent-facing imperative voice ("Report `false` here"). It described a
  // base-repository fetch unconditionally while the brief above ordered the
  // working-location arm — one field, two contracts, and the one the schema
  // stated was the very substitution the rule exists to forbid. Read out of the
  // shipped source, the schema object not being exported to this harness.
  const baseOidDesc = (src.match(/baseOid: \{ type: "string", description: "([\s\S]*?)" \},/) || [])[1] || "";
  const schemaNamesTheTarget = /THIS RUN'S TARGET/.test(baseOidDesc);
  const schemaHasTheNamedArm = /resolved WHERE IT WAS NAMED, in the working location, and fetched from nowhere/.test(baseOidDesc);
  const schemaScopesTheBaseArm = /only where the request named none is the target this PR's own base ref/.test(baseOidDesc);
  check(
    "and the schema's own `baseOid` contract names those same two arms, rather than a base-repository fetch alone",
    schemaNamesTheTarget && schemaHasTheNamedArm && schemaScopesTheBaseArm,
    `names the run's target: ${schemaNamesTheTarget}; carries the named arm: ${schemaHasTheNamedArm}; scopes the base arm: ${schemaScopesTheBaseArm}`,
  );
  // And the token that picks between the arms is owed structurally, not merely
  // asked for: an omitted `rebaseTarget` reads as "the request named none" and
  // takes the base-ref arm silently, which since this field became the review
  // base is a wrong boundary rather than only a wrong rebase target.
  check(
    "and an OMITTED `rebaseTarget` stops the run rather than reading as `the request named none`",
    /status: "gather-contract"/.test(src) &&
      /if \(typeof packet\.rebaseTarget !== "string"\)/.test(src) &&
      /Report the token on every packet you return with `ok: true` and items to address/.test(src) &&
      // Guarded HERE and not in any schema's `required`, which would take a
      // blocker packet's `blocker` and `pr.worktree` down with the validation.
      // Asserted on the field LISTS rather than one literal spelling: reordered
      // or respaced, a literal match would let the reversed decision back in
      // with the suite green.
      !(src.match(/required: \[[^\]]*\]/g) || []).some((list) => list.includes("rebaseTarget")),
    "the omission is unguarded again, or it was pushed into the schema where a blocker packet pays for it",
  );

  // And that paragraph renders ONLY where its value is consumed. The caller
  // reads a gather-time `pr.baseOid` on the `no-rebase` path alone — a rebasing
  // run supersedes it with the OID its rebase landed on — so the default
  // rendering ordering the fetch anyway forces a base-repository fetch on every
  // checkout that cannot reach that repository (a private fork clone with only
  // a local explicit target) for a value nothing reads.
  const pinsOnlyANonEmptyGather = /AFTER the gathering below/.test(basePara) && /NON-EMPTY/.test(basePara) && /terminal no-op the caller finishes before reading any base OID/.test(basePara);
  check(
    "and even the `no-rebase` rendering pins it only after a non-empty gather, since an empty-items run finishes before reading any base OID",
    pinsOnlyANonEmptyGather,
    `pins only a non-empty gather: ${pinsOnlyANonEmptyGather}`,
  );

  const defaultBasePara = brief.split("\n\n").find((p) => p.includes("pr.baseOid")) || "";
  const reportsItEmpty = /report `pr\.baseOid` EMPTY and fetch NOTHING for it/.test(defaultBasePara);
  const ordersNoBaseFetch = !/rev-parse --verify FETCH_HEAD\^\{commit\}/.test(defaultBasePara) && !/git fetch <the remote whose URL is that repository/.test(defaultBasePara);
  check(
    "while the default rendering reports the field empty and fetches nothing for it, since only the `no-rebase` path consumes a gather-time base OID",
    reportsItEmpty && ordersNoBaseFetch,
    `reports it empty: ${reportsItEmpty}; orders no base fetch: ${ordersNoBaseFetch}`,
  );

  const stated = [...new Set([...brief.matchAll(/outcome:\s*"([^"]*)"/g)].map((m) => m[1]))].sort();
  check(
    "and names exactly the four outcomes the schema and the gate know",
    stated.join(",") === "fast-forwarded,not-applicable,unrecognized,work",
    stated.join(",") || "the brief states no outcome at all",
  );

  // The coupling nothing else pins. The brief and the gate agree on a set of
  // literal strings and neither derives one from the other, so renaming a token
  // on one side alone leaves both halves internally consistent while every
  // same-branch run thereafter stops with `skipped-unreconciled`. Each outcome
  // the BRIEF states is driven through the actual gate here, on the PR's own
  // branch: the ones that continue a run must be the ones the brief tells the
  // agent to report before proceeding.
  const accepted = [];
  for (const outcome of stated) {
    const attempt = await run(gathered({ reconcile: { outcome }, items: [ITEM] }));
    if (attempt.status === "reached-cycle") accepted.push(outcome);
  }
  check(
    "and the outcomes it reports before proceeding are exactly the ones the gate lets through",
    accepted.join(",") === "fast-forwarded,work",
    `the gate accepts ${accepted.join(",") || "none of the outcomes the brief states"}`,
  );
}

// --- The publication guard beside it ----------------------------------------
// Independent of the reconciliation and prose rather than script logic, so it
// is checked in the rendered brief: a HEAD that is a proper ancestor of the PR
// head has nothing to publish, and the lease MATCHES there — it would succeed
// and delete the newer remote commits. The publisher must stop before reaching
// it, which is a claim about ORDER as much as about presence.
{
  const brief = publishPrompt(gathered({ reconcile: { outcome: "work" } }), [], { push: true }, [], []);
  const stop = brief.indexOf('aborted: "local behind PR head"');
  const lease = brief.indexOf("--force-with-lease=");
  const named = /PROPER ANCESTOR/.test(brief);
  check("the publish brief stops a proper-ancestor HEAD without pushing", stop > -1 && named, `stop@${stop} names-the-case@${named}`);
  check("and states that stop ahead of the lease it would otherwise match", stop > -1 && lease > -1 && stop < lease, `stop@${stop} lease@${lease}`);
}

// --- The off-shoot's publication gate ---------------------------------------
// The hole the reconciliation deliberately leaves (task 021c). On the off-shoot
// path reconciliation is skipped WHOLE, so nothing has compared the two tips by
// the time the publisher runs — and an off-shoot cut BEFORE the recorded head,
// advanced with its own commits, is neither an ancestor nor a descendant of it.
// The lease is no protection there: the recorded OID is exactly what the remote
// still points at, so it MATCHES, the push succeeds, and the PR branch is
// rewound over every commit between the cut point and the head. Prose again, so
// it is read out of the rendered brief — and the claim is about ORDER (before
// the lease), about what the stop REPORTS (both tips, not a guess), and about
// the gate being keyed on the two branch NAMES exactly as 021b's is.
{
  const off = publishPrompt(
    gathered({ workingBranch: "local/side-work", reconcile: { outcome: "not-applicable" } }),
    [],
    { push: true },
    [],
    [],
  );
  const probe = off.indexOf("git rev-list --right-only --cherry-pick HEAD...");
  const offStop = off.indexOf('aborted: "off-shoot does not carry the PR head"');
  const offLease = off.indexOf("--force-with-lease=");
  // The probe's POLARITY is read too, not only its presence: a gate that runs
  // the probe and treats what it prints as information ("print it for the
  // record and continue") keeps every other string this block reads. What no
  // regex here can hold is a rule reversed while the phrasing survives — that
  // is the reviewer's, exactly as in the fetched-head block above.
  const requiresEmpty = /require it to print NOTHING/.test(off);
  check(
    "the publish brief makes an off-shoot establish the recorded head is represented in it, before any lease",
    probe > -1 && offStop > -1 && offLease > -1 && probe < offLease && offStop < offLease && requiresEmpty,
    `probe@${probe} stop@${offStop} lease@${offLease} requires-empty@${requiresEmpty}`,
  );

  // The stop must name what it SAW rather than reporting a classification, and
  // it must not offer to make the push legal instead: fast-forwarding, merging
  // or rebasing the off-shoot is the maintainer's call, exactly as the
  // reconciliation's third outcome is.
  const gate = off.split("\n").find((l) => l.includes('aborted: "off-shoot does not carry the PR head"')) || "";
  const namesBothTips = /BOTH tips/.test(gate) && gate.includes("deadbeef") && /\bHEAD\b/.test(gate);
  const namesTheCommits = /every commit the probe printed/.test(gate);
  const refusesToReconcile = /Do NOT fast-forward, merge, rebase/.test(gate);
  check(
    "and that stop names both tips and the commits it saw, and reconciles nothing to make the push legal",
    namesBothTips && namesTheCommits && refusesToReconcile,
    `names both tips: ${namesBothTips}; names the commits: ${namesTheCommits}; refuses to reconcile: ${refusesToReconcile}`,
  );

  // Keyed on the two names, and RENDERED with both, so the publisher settles
  // applicability from its own brief rather than probing the shape of the
  // history — the one thing task 018 forbids. The PR's own branch is left to the
  // reconciliation deliberately: re-asking there would stop an ordinary run
  // whose default rebase flattened a merge commit the recorded head carries.
  const keyedOnNames = gate.includes("local/side-work") && gate.includes("feature/x");
  const leavesTheOwnBranch = /run no probe there/.test(gate) && /reconciliation established representation/.test(gate);
  check(
    "and keys that gate on the two branch names it renders, leaving a run on the PR's own branch to the reconciliation",
    keyedOnNames && leavesTheOwnBranch,
    `renders both names: ${keyedOnNames}; leaves the own branch to the reconciliation: ${leavesTheOwnBranch}`,
  );

  // The residual case, which is the same gap seen from the other side: the lease
  // case used to trigger on "history was rewritten", so a tip that is neither a
  // proper ancestor nor a descendant of the expected tip and rewrote nothing
  // matched no enumerated instruction at all — the run was left to choose at
  // exactly the point where the wrong choice is the rewinding one. The remainder
  // must therefore be "everything else". `rebased:` stays rendered as context;
  // what it may not be again is the trigger.
  const seg = off.slice(off.indexOf("normal push (", offStop), offLease);
  const remainder = /OTHERWISE/.test(seg) && /every remaining state, whether or not this run rewrote history/.test(seg);
  const notGatedOnRewrite = !/If history was rewritten/.test(seg);
  const rebasedStillReported = /rebased: no/.test(seg);
  check(
    "and hands the remaining state an instruction — the lease is what everything else gets, not what a rewritten history gets",
    remainder && notGatedOnRewrite && rebasedStillReported,
    `remainder stated: ${remainder}; not gated on a rewrite: ${notGatedOnRewrite}; rebased still reported: ${rebasedStillReported}`,
  );

  // Item 1 is the other half of the same exposure and reaches the run FIRST: it
  // resolves a push target and stops on a mismatch, and an off-shoot's own
  // upstream never matches the PR head — so read as the branch's own resolution
  // it halts every off-shoot run after all its work, at the one step whose remit
  // is to decide what may be pushed from it. Read from the item as a WHOLE: the
  // exception is a bullet of its own, because it is the off-shoot's alone (the
  // block below pins the other bullet, which the same-branch case keeps).
  const item1 = off.slice(off.indexOf("1. Re-check before publication"), off.indexOf("2. Push."));
  const targetIsThePr = /resolve the target from the PR instead/.test(item1) && /its head repository and/.test(item1);
  const notTheOffShootsUpstream =
    /off-shoot's own upstream is NOT the target/.test(item1) && /normal state rather than a stop/.test(item1);
  check(
    "and item 1 resolves the publication target from the PR, so an off-shoot's own upstream is not a stop before the gate is reached",
    targetIsThePr && notTheOffShootsUpstream,
    `target is the PR's: ${targetIsThePr}; off-shoot upstream not a stop: ${notTheOffShootsUpstream}`,
  );

  // The same decisions in the SKILL that states them to a reader rather than
  // to a subagent, in both mirrors, which no generator keeps in step. Anchored to
  // the sentence that carries each decision, so a rewrite that keeps the heading
  // and drops the rule fails rather than passing on the file's other mentions.
  {
    const wanted = [
      [
        // The stop the workflow brief has always carried and the skill did not:
        // a HEAD that is a proper ancestor of the expected tip has nothing to
        // publish, and the lease MATCHES there, so the fallback rewinds the
        // branch over the newer remote commits.
        "the proper-ancestor stop",
        "**First, a `HEAD` that is a proper ancestor of the expected tip is a stop, not a push.**",
        [/nothing of yours to publish/, /the lease \*matches\*/, /Stop and report, exactly as for a rejected lease/],
      ],
      [
        "the off-shoot representation gate",
        "**Then, an off-shoot must carry the recorded head.**",
        [
          /`git rev-list --right-only --cherry-pick HEAD\.\.\.<expected-head-oid>`/,
          /patch-id rather than raw ancestry/,
          /naming both tips/,
          /do not fast-forward, merge or rebase the off-shoot/,
        ],
      ],
      [
        "the off-shoot's publication target",
        "**On a named off-shoot the target is the PR's head ref, never the branch's own upstream.**",
        [/is never pushed to by this run/, /that mode's normal state/, /Mode 4 is the only mode this substitution covers/],
      ],
      [
        "the check that substitution excepts",
        "1. **Re-check before publication:**",
        [
          /Resolve the current branch's exact push remote\/ref, verify they match that PR head/,
          /still standing on the branch this run has been working on/,
          // The SPELLING, not only the requirement, and for the same reason the
          // rendered brief is read for it below: `git rev-parse --abbrev-ref
          // HEAD` is documented to produce a non-ambiguous name, so it prints
          // `heads/<name>` wherever a tag shares the branch's name and aborts a
          // valid publication. The span runs into "in that spelling" rather than
          // stopping at the command, because both spellings appear on this line
          // — the wrong one as the counter-example — so a bare mention of the
          // right one would still pass a line that swapped which is asked for.
          /`git branch --show-current`, in that spelling/,
          // The CONSEQUENCE, not only the requirement. Everything above pins
          // what the step must establish; none of it pins what happens when the
          // establishing fails, and a line that resolves the target, finds it
          // unmatched and then publishes anyway keeps every other span here.
          // The span runs to "instead of guessing" rather than stopping at the
          // verb, because "stop" alone also appears on this line as the
          // moved-checkout case — so a bare mention would pass a line whose
          // push-target failure had been softened to a note-and-continue.
          /stop and report instead of guessing/,
        ],
      ],
      [
        "the normal push the stops precede",
        "- Then, if the expected remote tip is an ancestor of `HEAD`",
        [/`git push <remote> HEAD:refs\/heads\/<headRefName>`/],
      ],
      ["the lease as the remainder", "- **Otherwise** — every remaining state", [/whether or not this run rewrote history/]],
      [
        // The target rule above is only followable if the shipped commands
        // actually supply what it reads. `headRepositoryOwner` alone does not
        // name a fork whose repository NAME differs from the base's, so a run
        // that follows the recipes verbatim reaches publication with the work
        // done and no target it can verify. Both recipes are pinned because the
        // publish step's own read is not where the fields first arrive: step 1
        // is what a run follows to RECORD them, and a run that recorded nothing
        // has nothing for the publish-time read to confirm.
        "the fields its off-shoot target rule reads",
        "**Read context:** `gh pr view NUMBER --json",
        [/headRepository,/, /headRepositoryOwner,/, /isCrossRepository/],
      ],
      [
        "the fields step 1 records them from",
        "2. **Auto-detect** — `gh pr view --json",
        [/headRepository,/, /headRepositoryOwner,/, /isCrossRepository/],
      ],
      // The durable disposition record, whose whole value is that a LATER run
      // finds and replays it — so what is pinned is the marker it is found by,
      // the supersession that keeps one per PR, and the two rules a replay goes
      // wrong without. Each is anchored to the sentence that carries it, so a
      // rewrite keeping the heading and dropping the rule fails.
      [
        "`no-push`'s one carved-out write",
        "| `no-push` | **Local-only run**",
        [/It makes \*\*exactly one\*\* PR write, the single documented exception/, /no push, no replies\/resolves, no summary comment, no ping/],
      ],
      [
        "the record's marker and its supersession",
        "**One record per PR per run, superseding your own rather than stacking.**",
        [/<!-- address-review:disposition-record -->/, /never by matching prose/, /update that comment in place/, /this run writes exactly one record/],
      ],
      [
        "the SHAs as provenance rather than a replay gate",
        "**The SHAs are provenance, never a replay gate.**",
        [/never assert that equality/, /re-derive every SHA from the branch at replay time/],
      ],
      [
        "patch-id as the first probe",
        "- **Patch-id is the first probe, not the gate.**",
        [/git rev-list --right-only --cherry-pick B\.\.\.F/, /printing nothing means every recorded commit is represented/],
      ],
      [
        "and a non-empty patch-id probe rejecting nothing",
        "- **A non-empty result rejects nothing.**",
        [/patch-id cascade/, /Fall through to the tree/],
      ],
    ];
    // Item 2's bullets are an ordered exclusion chain — "work these in order …
    // each excludes the ones above it and the last is 'everything else'" — so
    // presence is not enough: the lease MATCHES in exactly the states the two
    // stops describe, so a stop stated below it is a stop no run reaches, and
    // every bullet can be present and correctly phrased with the guard gone.
    const anchorOf = (what) => wanted.find(([w]) => w === what)[1];
    const orderedChain = [
      "the proper-ancestor stop",
      "the off-shoot representation gate",
      "the normal push the stops precede",
      "the lease as the remainder",
    ];
    const missing = [];
    for (const mirror of ["plugins/dev-skills/skills", "codex/dev-skills/skills"]) {
      const path = `${mirror}/address-review/SKILL.md`;
      let text;
      try {
        text = readFileSync(join(here, "..", mirror, "address-review", "SKILL.md"), "utf8");
      } catch (err) {
        missing.push(`${path} cannot be read: ${err.message}`);
        continue;
      }
      const lines = text.split("\n");
      for (const [what, anchor, phrases] of wanted) {
        const line = lines.find((l) => l.includes(anchor));
        if (!line) {
          missing.push(`${path} states nothing for ${what}`);
          continue;
        }
        for (const phrase of phrases) if (!phrase.test(line)) missing.push(`${path}'s ${what} does not state ${phrase}`);
      }
      // An absent bullet is already reported above, so read the chain over the
      // ones that are there: out of order is a separate failure from missing.
      const placed = orderedChain
        .map((what) => [what, lines.findIndex((l) => l.includes(anchorOf(what)))])
        .filter(([, at]) => at !== -1);
      for (let i = 1; i < placed.length; i += 1)
        if (placed[i][1] < placed[i - 1][1]) missing.push(`${path} states ${placed[i][0]} before ${placed[i - 1][0]}`);
    }
    check(
      "and the skill carries the same decisions in both mirrors, in the order that makes the stops reachable — the proper-ancestor stop and the off-shoot's gate ahead of both pushes, the PR's ref as the off-shoot's target with the fields both recipes resolve it from, the check that substitution excepts, and the disposition record's carve-out, marker, supersession, and SHA/patch-id rules",
      missing.length === 0,
      missing.join("; "),
    );
  }
}

// --- The check the off-shoot exception must not swallow ----------------------
// The exception above substitutes a PR-DERIVED push target for the branch's own
// resolution, and only the off-shoot needed that substitution. Item 1's "resolve
// THIS branch's exact push remote/ref and verify they match the PR head" is a
// check in its own right on every other path: it is what stops a run whose
// checkout moved to some unrelated branch after the review, which would
// otherwise trust the recorded equal names, skip the representation probe as a
// same-branch run, and lease-push the wrong HEAD onto the PR. So the ordinary
// path's resolution must survive, keyed on the two names exactly as its
// exception is, and item 1 must re-verify that the checkout still STANDS on the
// recorded working branch — the name both gates key on is otherwise a record
// taken before the fixes landed rather than a present fact.
{
  const same = publishPrompt(gathered({ reconcile: { outcome: "work" } }), [], { push: true }, [], []);
  const item1 = same.slice(same.indexOf("1. Re-check before publication"), same.indexOf("2. Push."));
  const lines = item1.split("\n");
  const ownTarget = lines.find((l) => /Where the two names are the SAME/.test(l)) || "";
  const prDerived = lines.find((l) => /Where they DIFFER/.test(l)) || "";
  // Presence of the resolution is not the claim — a bullet that resolves the
  // branch's own target and then treats a mismatch as information keeps every
  // other string here, so the STOP is read as well.
  const resolvesOwn = /resolve THAT branch's exact push remote\/ref and verify they match the PR head/.test(ownTarget);
  const stopsOnMismatch = /STOP rather than pushing to a target you resolved some other way/.test(ownTarget);
  check(
    "the publish brief still resolves the same-branch case's own push remote/ref, and stops where they do not match the PR head",
    resolvesOwn && stopsOnMismatch,
    `resolves the branch's own target: ${resolvesOwn}; stops on a mismatch: ${stopsOnMismatch}`,
  );

  // And the substitution stays in the bullet it belongs to: an exception written
  // as the unconditional rule is exactly how this check was lost.
  const scoped = /resolve the target from the PR instead/.test(prDerived) && !/resolve the target from the PR instead/.test(ownTarget);
  check(
    "and confines the PR-derived target to the differing-names case, so the exception does not swallow the check it excepts",
    scoped && ownTarget !== "" && prDerived !== "",
    `PR-derived resolution confined to the differing case: ${scoped}; same-names bullet found: ${ownTarget !== ""}; differing bullet found: ${prDerived !== ""}`,
  );

  // The checkout re-verification, read from the OFF-SHOOT render because only
  // there do the two names differ: what item 1 must require HEAD to be on is the
  // branch the run addressed, not the PR's head ref.
  const off = publishPrompt(
    gathered({ workingBranch: "local/side-work", reconcile: { outcome: "not-applicable" } }),
    [],
    { push: true },
    [],
    [],
  );
  const offItem1 = off.slice(off.indexOf("1. Re-check before publication"), off.indexOf("2. Push."));
  // Read for the spelling too, not just the requirement: `git rev-parse
  // --abbrev-ref HEAD` is documented to produce a NON-AMBIGUOUS name, so it
  // prints `heads/<name>` wherever a tag shares the branch's name — a check
  // asked that way aborts a valid publication, and the wrong spelling is the
  // obvious one to write back in.
  const readsTheCheckout =
    /`git branch --show-current` must print `local\/side-work`/.test(offItem1) && !/--abbrev-ref HEAD` must print/.test(offItem1);
  // The stop carries its own reason string, like every other stop in this step:
  // one the schema's `aborted` examples list, so the publisher reports it rather
  // than inventing a phrase of its own for a state nothing else names.
  const stopsOnAnotherBranch =
    /where it prints anything else, set `published: false`, `aborted: "working location moved off the branch"`, and STOP without pushing/.test(
      offItem1,
    );
  check(
    "and re-verifies the checkout still stands on the branch the run addressed — the working branch, not the head ref — stopping with a named reason when it does not",
    readsTheCheckout && stopsOnAnotherBranch,
    `requires HEAD on the working branch: ${readsTheCheckout}; stops with the named reason: ${stopsOnAnotherBranch}`,
  );
}

// --- The delegated rebase points --------------------------------------------
// Rebasing onto the freshest base is the default now, at two points, and both
// are delegated — this script cannot run git, and an orchestrator holding a
// half-finished rebase has nowhere to put a conflict. Three separable ways to
// lose the point of that, each driven through the shipped script rather than
// read out of it:
//
//   1. The PIN. Whatever the rebase reports as the base it landed on becomes
//      the review base handed to the cycle, and it must be a COMMIT. A
//      remote-tracking name accepted here moves under a sibling push or the
//      next fetch, so the reviewer would bound its diff at a tip this branch
//      was never rebased onto — while the branch it judges still sits where it
//      did.
//   2. The HALT. A conflict beyond the step's competence stops the run with the
//      question BEFORE anything is fixed, rather than being guessed at or
//      discovered after a cycle's worth of work.
//   3. The OPT-OUT, and the ORDER against the gate above: `no-rebase`
//      suppresses both points, and the reconciliation gate still runs ahead of
//      the first one (the "nothing runs past the gate" check above now covers
//      that direction on its own, since a rebase agent would show up in the
//      same label list).
{
  const withWork = { reconcile: { outcome: "work" }, items: [ITEM] };
  const clean = await run(gathered(withWork));
  check(
    "a default run delegates the pre-fix rebase, after the gather and before the cycle",
    clean.status === "reached-cycle" && clean.seen.agentLabels.join(",") === "gather,rebase-pre-fix",
    JSON.stringify(clean.seen.agentLabels),
  );
  check(
    "and the cycle's review base is the pinned OID the rebase landed on, not the base ref name",
    clean.seen.cycleOpts && clean.seen.cycleOpts.opts.base === REBASE_NOOP.effectiveBase,
    JSON.stringify(clean.seen.cycleOpts && clean.seen.cycleOpts.opts && clean.seen.cycleOpts.opts.base),
  );
  // The default target is the PR's base ref; an explicit
  // `rebase on top of <target>` token is a ref of the maintainer's, and the two
  // are resolved in different places (the brief's two arms are read directly
  // below). WHICH arm a run gets is the caller's to say, so the wiring is read
  // here rather than only the builder: the gather reports the token in
  // `rebaseTarget`, and a brief rendered for the default arm on it would send
  // the fetch at the base repository for a ref that need not exist there.
  const explicitlyTargeted = await run({ ...gathered(withWork), rebaseTarget: "my-local-base" });
  const explicitBriefDispatched = explicitlyTargeted.seen.rebasePrompts[0] || "";
  check(
    "and a gathered `rebaseTarget` reaches the rebase brief as an explicitly named target, not as the PR's own base ref",
    /The target is `my-local-base`, named outright by this run's request/.test(explicitBriefDispatched) &&
      !/git fetch /.test(explicitBriefDispatched),
    explicitBriefDispatched
      ? `the dispatched brief takes the ${/named outright/.test(explicitBriefDispatched) ? "explicit" : "default"} arm and ${/git fetch /.test(explicitBriefDispatched) ? "still fetches" : "fetches nothing"}`
      : "no rebase brief was dispatched at all",
  );
  // The other side of that guard, and the reason it sits where it does: an
  // EMPTY successful gather owes no echo, because the terminal no-op exit runs
  // ahead of the guard and finishes the run before anything reads the field.
  // Driven, because every other fixture carries `rebaseTarget` and so a guard
  // hoisted ahead of that exit would turn this legitimate no-op into a stop
  // with the whole suite still green.
  const emptyWithoutEcho = await run({ ...gathered({ reconcile: { outcome: "work" } }), rebaseTarget: undefined });
  check(
    "but an EMPTY gather owes no echo — the terminal no-op finishes ahead of the guard rather than stopping on it",
    emptyWithoutEcho.result && emptyWithoutEcho.result.status === "no-op",
    `status: ${emptyWithoutEcho.result && emptyWithoutEcho.result.status}`,
  );

  // And the same wiring's failure mode, driven rather than read: a gather that
  // OMITS the echo must stop the run, not be read as "the request named none".
  // The two are indistinguishable downstream, and since this field also decides
  // the review base on the `no-rebase` path, guessing wrong bounds every range
  // this run delegates at a commit the request never asked for.
  const echoOmitted = await run({ ...gathered(withWork), rebaseTarget: undefined });
  check(
    "and a gather that omits `rebaseTarget` altogether stops the run rather than being read as `the request named none`",
    echoOmitted.result && echoOmitted.result.status === "gather-contract" && echoOmitted.seen.rebasePrompts.length === 0,
    `status: ${echoOmitted.result && echoOmitted.result.status}; rebase briefs dispatched: ${echoOmitted.seen.rebasePrompts.length}`,
  );

  // The same wiring where the named target's NAME EQUALS the PR's base ref —
  // `rebase on top of main` on a PR based on `main`. It is redundant but legal,
  // and the likeliest redundant form now that rebasing is the default, so the
  // arm cannot be chosen by comparing the two names: that comparison reads this
  // request as "named none" and fetches `refs/heads/main` from the PR's base
  // repository instead of resolving the ref the maintainer named right here.
  // The check above cannot see it — its target differs from the base by
  // construction — so the equality case is driven on its own.
  const redundantlyTargeted = await run({ ...gathered(withWork), rebaseTarget: "main" });
  const redundantBriefDispatched = redundantlyTargeted.seen.rebasePrompts[0] || "";
  check(
    "and a gathered `rebaseTarget` whose name EQUALS the PR's base ref still reaches the brief as an explicitly named one",
    /The target is `main`, named outright by this run's request/.test(redundantBriefDispatched) &&
      !/git fetch /.test(redundantBriefDispatched),
    redundantBriefDispatched
      ? `the dispatched brief takes the ${/named outright/.test(redundantBriefDispatched) ? "explicit" : "default"} arm and ${/git fetch /.test(redundantBriefDispatched) ? "still fetches" : "fetches nothing"}`
      : "no rebase brief was dispatched at all",
  );
  const unpinned = await run(gathered(withWork), { rebase: { ...REBASE_NOOP, effectiveBase: "origin/main" } });
  check(
    "a rebase reporting a movable ref instead of the commit it landed on stops the run, dispatching nothing",
    unpinned.status === "rebase-unpinned-base" && unpinned.seen.cycleOpts === null,
    JSON.stringify({ status: unpinned.status, cycle: unpinned.seen.cycleOpts }),
  );
  const halted = await run(gathered(withWork), {
    rebase: {
      ok: true,
      halted: true,
      noop: false,
      question: "`src/app.ts` conflicts with the sibling PR's rename; which side owns the guard?",
      detail: "aborted; tree clean and idle",
      recoveryRef: "refs/pre-rebase/feature/x/20260809-101112",
    },
  });
  check(
    "a halted rebase stops the run before anything is fixed",
    halted.status === "rebase-halted" && halted.seen.cycleOpts === null,
    JSON.stringify({ status: halted.status, cycle: halted.seen.cycleOpts }),
  );
  const q = ((halted.result || {}).openQuestions || [])[0] || {};
  check(
    "and the conflict leaves as an open question with origin `rebase`, not as a bare error string",
    q.origin === "rebase" && /which side owns the guard/.test(q.question || ""),
    JSON.stringify((halted.result || {}).openQuestions),
  );
  const abbreviated = await run(gathered(withWork), { rebase: { ...REBASE_NOOP, effectiveBase: "1a2b3c4" } });
  check(
    "an ABBREVIATED base is rejected like a ref name — a prefix is not an immutable boundary",
    abbreviated.status === "rebase-unpinned-base" && abbreviated.seen.cycleOpts === null,
    JSON.stringify({ status: abbreviated.status, cycle: abbreviated.seen.cycleOpts }),
  );
  // The acceptance condition is that build+tests RAN after every non-noop
  // rebase, so the caller requires the passing report positively: a replay that
  // says nothing about validation is as unusable as one that reports a failure,
  // and reading only for an explicit `false` lets the silent one through.
  const unvalidated = { ...REBASE_REPLAY };
  delete unvalidated.validationPassed;
  const silent = await run(gathered(withWork), { rebase: unvalidated });
  check(
    "a replay that reports NO validation outcome stops the run, exactly as a failing one does",
    silent.status === "rebase-validation-failed" && silent.seen.cycleOpts === null,
    JSON.stringify({ status: silent.status, cycle: silent.seen.cycleOpts }),
  );
  const failed = await run(gathered(withWork), { rebase: { ...REBASE_REPLAY, validationPassed: false } });
  check(
    "and a replay whose build/tests failed stops it too",
    failed.status === "rebase-validation-failed",
    JSON.stringify(failed.status),
  );
  // `noop: true` is the value that switches those very checks OFF — the
  // validation above here, and at the pre-push point the whole re-verification
  // of the rebased tree — so it is adopted on the unchanged tip the brief orders
  // reported beside it rather than on the flag. A claim naming no tips, or two
  // different ones, has replayed something or cannot say, and taking it at its
  // word publishes a replayed tree that was neither validated nor reviewed.
  const tipless = { ...REBASE_NOOP };
  delete tipless.before;
  delete tipless.after;
  const unevidenced = await run(gathered(withWork), { rebase: tipless });
  check(
    "a `noop: true` naming neither tip stops the run, dispatching nothing",
    unevidenced.status === "rebase-unevidenced-noop" && unevidenced.seen.cycleOpts === null,
    JSON.stringify({ status: unevidenced.status, cycle: unevidenced.seen.cycleOpts }),
  );
  const moved = await run(gathered(withWork), { rebase: { ...REBASE_NOOP, after: "d00dfeed" } });
  check(
    "and so does one whose two tips disagree — a moved tip is a replay however the report labelled it",
    moved.status === "rebase-unevidenced-noop" && moved.seen.cycleOpts === null,
    JSON.stringify({ status: moved.status, cycle: moved.seen.cycleOpts }),
  );
  // The way back from a replay. A stop past a successful point promises the
  // maintainer a saved pre-rebase tip only where the report ESTABLISHED the ref
  // holding it, so the report has to carry one: a successful rebase that names
  // none has skipped the single `update-ref` the brief spells out, and adopting
  // it would leave every later stop with nothing to offer but the namespace to
  // search.
  const unsaved = { ...REBASE_REPLAY };
  delete unsaved.recoveryRef;
  const noWayBack = await run(gathered(withWork), { rebase: unsaved });
  check(
    "a successful rebase that names no `refs/pre-rebase/` recovery ref stops the run, dispatching nothing",
    noWayBack.status === "rebase-unsaved-recovery-ref" && noWayBack.seen.cycleOpts === null,
    JSON.stringify({ status: noWayBack.status, cycle: noWayBack.seen.cycleOpts }),
  );
  // And the values a PREFIX test would wave through, which are worse than the
  // absent one above because they read as an answer: a truncated ref, and a ref
  // that is somebody else's backup. Neither names the backup of THIS replay, so
  // adopting either publishes a rewritten history whose advertised way back does
  // not exist or restores another branch.
  for (const [label, ref] of [
    ["truncated to the namespace", "refs/pre-rebase/"],
    ["naming another branch's backup", "refs/pre-rebase/feature/other/20260809-121314"],
    ["carrying no timestamp", "refs/pre-rebase/feature/x/main"],
  ]) {
    const misnamed = await run(gathered(withWork), { rebase: { ...REBASE_REPLAY, recoveryRef: ref } });
    check(
      `a recovery ref ${label} stops the run, dispatching nothing`,
      misnamed.status === "rebase-unsaved-recovery-ref" && misnamed.seen.cycleOpts === null,
      JSON.stringify({ status: misnamed.status, cycle: misnamed.seen.cycleOpts }),
    );
    check(
      `and the stop stops promising the maintainer a saved tip it just refused (${label})`,
      !/saved at/.test((misnamed.result || {}).note || ""),
      JSON.stringify((misnamed.result || {}).note),
    );
  }
  // The other half: a perfectly-shaped name still says nothing about whether the
  // ref was created or where it points. The brief reads it back for exactly
  // that, so a report that cannot show the ref resolving to the tip the rebase
  // started from is refused on the evidence rather than accepted on the string.
  const unverifiedNotes = [];
  for (const [label, patch] of [
    ["resolving to some other commit than the tip it started from", { recoveryTip: "0badf00d" }],
    ["reporting no resolved tip at all", { recoveryTip: undefined }],
    ["reporting no pre-rebase tip to check it against", { before: undefined }],
  ]) {
    const unverified = { ...REBASE_REPLAY, ...patch };
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete unverified[k];
    const bad = await run(gathered(withWork), { rebase: unverified });
    unverifiedNotes.push((bad.result || {}).note || "");
    check(
      `a recovery ref ${label} stops the run, dispatching nothing`,
      bad.status === "rebase-unverified-recovery-ref" && bad.seen.cycleOpts === null,
      JSON.stringify({ status: bad.status, cycle: bad.seen.cycleOpts }),
    );
  }
  check(
    "and none of those stops promises the maintainer a pre-rebase tip saved at the ref it just refused",
    unverifiedNotes.length === 3 && unverifiedNotes.every((n) => !/saved at/.test(n)),
    JSON.stringify(unverifiedNotes),
  );
  // This one says more than the namespace the fallback points at, and that is
  // why it overrides it: the report named that exact ref and the name is
  // well-formed for this branch, it just was not shown pointing at the tip the
  // rebase started from, so the maintainer has one specific name to go and look
  // at rather than a directory to search. Whether the ref exists is what this
  // stop could not establish, which is why the note sends them to check it.
  check(
    "and the unverified stop names the ref it refused, telling the maintainer to check that one itself",
    unverifiedNotes.every((n) => n.includes(REBASE_REPLAY.recoveryRef) && /check that ref yourself/.test(n)),
    JSON.stringify(unverifiedNotes),
  );
  // The note every rebase stop carries is built from the same two-part evidence
  // those checks require, rather than from the bare presence of a string — so
  // the stops that run BEFORE them stop promising a ref nobody established
  // either. `rebase-validation-failed` is the one that matters: it is reachable
  // with history ALREADY rewritten, which is exactly when a maintainer needs an
  // honest way back, and it cannot tell an established ref from a plausible
  // string on its own.
  const failedWithWayBack = await run(gathered(withWork), { rebase: { ...REBASE_REPLAY, validationPassed: false } });
  check(
    "a stop reached BEFORE the recovery checks names the ref where the report did establish one",
    failedWithWayBack.status === "rebase-validation-failed" &&
      ((failedWithWayBack.result || {}).note || "").includes(`saved at \`${REBASE_REPLAY.recoveryRef}\``),
    JSON.stringify((failedWithWayBack.result || {}).note),
  );
  for (const [label, patch] of [
    ["a name truncated to the namespace", { recoveryRef: "refs/pre-rebase/" }],
    ["a well-formed name resolving somewhere else", { recoveryTip: "0badf00d" }],
  ]) {
    const unestablished = await run(gathered(withWork), { rebase: { ...REBASE_REPLAY, validationPassed: false, ...patch } });
    const note = (unestablished.result || {}).note || "";
    check(
      `and promises nothing where it did not — ${label} — pointing at the namespace to search instead`,
      unestablished.status === "rebase-validation-failed" && !/saved at/.test(note) && /`refs\/pre-rebase\/feature\/x\/`/.test(note),
      JSON.stringify(note),
    );
  }
  // The halt says it in two places, and both are gated on the same evidence: its
  // note, and the list of artifacts its open question hands the maintainer to
  // look at. An unestablished ref belongs in neither.
  const haltedUnsaved = await run(gathered(withWork), {
    rebase: { ok: true, halted: true, noop: false, question: "which side owns the guard?", detail: "aborted", recoveryRef: "refs/pre-rebase/" },
  });
  const haltedArtifacts = ((((haltedUnsaved.result || {}).openQuestions || [])[0] || {}).artifacts) || [];
  check(
    "and a halt neither promises an unestablished ref nor lists it among its open question's artifacts",
    haltedUnsaved.status === "rebase-halted" &&
      !/saved at/.test((haltedUnsaved.result || {}).note || "") &&
      !haltedArtifacts.some((a) => /refs\/pre-rebase/.test(String(a))),
    JSON.stringify({ note: (haltedUnsaved.result || {}).note, artifacts: haltedArtifacts }),
  );
  // The rebase brief hands the delegated step the base repository's identity as
  // this PR's own URL, which makes that field load-bearing rather than
  // decorative: absent, the brief would interpolate `undefined` and the step
  // would be back to deriving the repository from its working directory — the
  // head fork in a fork clone. So it stops the run before any brief is built.
  const urlless = gathered(withWork);
  delete urlless.pr.url;
  const noUrl = await run(urlless);
  check(
    "a gather that reports no PR url stops the run, since the rebase brief names the base repository from it",
    noUrl.status === "error" &&
      /url/.test((noUrl.result || {}).error || "") &&
      noUrl.seen.agentLabels.join(",") === "gather",
    JSON.stringify({ status: noUrl.status, error: (noUrl.result || {}).error, labels: noUrl.seen.agentLabels }),
  );
  const off = await run(gathered(withWork), { args: "no-push no-rebase" });
  check(
    "`no-rebase` runs neither point and pins the base ref's commit as the review base, never its name",
    off.status === "reached-cycle" &&
      off.seen.agentLabels.join(",") === "gather" &&
      off.seen.cycleOpts.opts.base === GATHERED_BASE_OID,
    JSON.stringify({ labels: off.seen.agentLabels, base: off.seen.cycleOpts && off.seen.cycleOpts.opts.base }),
  );
  // The opt-out is the one path with no rebase report to check, so the pin is
  // checked on the gather's resolution instead. Unusable there means the run
  // stops: delegating the ref name is the defect the rebasing path refuses.
  for (const [label, packetOpts] of [
    ["absent", { ...withWork, baseOid: null }],
    ["a ref name", { ...withWork, baseOid: "origin/main" }],
    ["abbreviated", { ...withWork, baseOid: "9988776" }],
  ]) {
    const unpinned = await run(gathered(packetOpts), { args: "no-push no-rebase" });
    check(
      `\`no-rebase\` with the base commit ${label} stops the run, dispatching nothing`,
      unpinned.status === "unpinned-base" && unpinned.seen.cycleOpts === null,
      JSON.stringify({ status: unpinned.status, cycle: unpinned.seen.cycleOpts }),
    );
  }
  // The opt-out is read out of free prose, and one thing in that prose is not
  // prose at all: `rebase on top of <target>` carries a REF NAME, and
  // `feature/no-rebase` is an ordinary one. Read as written it suppresses the
  // very rebase the request asked for and silently drops the target the gather
  // reported — one instruction, both halves of it defeated. Both directions are
  // driven, because the trap in fixing this is trading the false positive for a
  // false negative: a request that negates the phrase itself is a real opt-out
  // and must stay one.
  const targetNamedNoRebase = await run(
    { ...gathered(withWork), rebaseTarget: "feature/no-rebase" },
    { args: "no-push rebase on top of feature/no-rebase" },
  );
  check(
    "a rebase TARGET whose branch name contains `no-rebase` does not opt the run out of rebasing",
    targetNamedNoRebase.status === "reached-cycle" &&
      targetNamedNoRebase.seen.agentLabels.join(",") === "gather,rebase-pre-fix" &&
      /The target is `feature\/no-rebase`, named outright/.test(targetNamedNoRebase.seen.rebasePrompts[0] || ""),
    JSON.stringify({ labels: targetNamedNoRebase.seen.agentLabels, brief: (targetNamedNoRebase.seen.rebasePrompts[0] || "").slice(0, 120) }),
  );
  const negatedTheTarget = await run(gathered(withWork), { args: "no-push do not rebase on top of main" });
  check(
    "while a request that NEGATES the phrase still opts out — the value is elided, the words are not",
    negatedTheTarget.status === "reached-cycle" &&
      negatedTheTarget.seen.agentLabels.join(",") === "gather" &&
      negatedTheTarget.seen.cycleOpts.opts.base === GATHERED_BASE_OID,
    JSON.stringify({ labels: negatedTheTarget.seen.agentLabels, base: negatedTheTarget.seen.cycleOpts && negatedTheTarget.seen.cycleOpts.opts.base }),
  );
  // The same defect on the flag that decides whether this run touches the PR at
  // all: `fix/no-push` is an equally ordinary ref component, and read out of the
  // target it turns a publishing run into a local-only one that reports success
  // having pushed nothing. One elision covers every flag, so one direction of it
  // is driven here rather than the whole set.
  const targetNamedNoPush = await run(gathered(withWork), {
    args: "rebase on top of fix/no-push",
    cycles: [CYCLE_PASS],
  });
  check(
    "and a target branch containing `no-push` does not suppress publication",
    targetNamedNoPush.seen.agentLabels.includes("publish"),
    JSON.stringify({ status: targetNamedNoPush.status, labels: targetNamedNoPush.seen.agentLabels }),
  );
  // The elision ends at a SEPARATOR, not at the next space, because this parsing
  // is documented as lenient over commas and `&`: `rebase on top of main,no-push`
  // is an ordinary way to write the request, not an exotic one. Taken to the next
  // space the target swallows the flag glued to it, and the flag it swallows
  // most expensively is the one that keeps the run local — publishing what the
  // maintainer asked not to publish, the one direction this whole construct
  // exists to get right.
  for (const [label, args] of [
    ["a comma", "rebase on top of main,no-push"],
    ["an `&`", "rebase on top of main&no-push"],
  ]) {
    const joined = await run(gathered(withWork), { args, cycles: [CYCLE_PASS] });
    check(
      `a \`no-push\` joined to the target by ${label} survives the elision and keeps the run local`,
      !joined.seen.agentLabels.includes("publish"),
      JSON.stringify({ status: joined.status, labels: joined.seen.agentLabels }),
    );
  }
  // Both halves at once: the target VALUE is still elided (its own `no-push`
  // component does not suppress anything) while the genuine flag written after
  // the separator is still read. Publication on its own evidences only the first
  // half — `push` is the default, so a run that read `ping-codex` nowhere still
  // publishes — so the flag itself is read back where the caller resolves it:
  // the publish brief renders the flag object it hands the publisher.
  const separatedBoth = await run(gathered(withWork), {
    args: "rebase on top of fix/no-push,ping-codex",
    cycles: [CYCLE_PASS],
  });
  const separatedFlags = (separatedBoth.seen.publishPrompts[0] || "").match(/Flags for this publication: .*/);
  check(
    "while the target value itself is still elided across that separator, so only the genuine flag is read",
    separatedBoth.seen.agentLabels.includes("publish") && /"pingCodex":true/.test(separatedFlags ? separatedFlags[0] : ""),
    JSON.stringify({ status: separatedBoth.status, labels: separatedBoth.seen.agentLabels, flags: separatedFlags && separatedFlags[0] }),
  );
  // The same second half on the other separator and the other consumer, since a
  // flag read out of `flagText` need not reach the publisher at all:
  // `peer-opinions=off` reaches the nested cycle, so it is read back out of the
  // options the run hands it rather than out of a rendered brief.
  const separatedPeer = await run(gathered(withWork), {
    args: "rebase on top of fix/x&peer-opinions=off",
    cycles: [CYCLE_PASS],
  });
  check(
    "and a `peer-opinions=off` written after that separator reaches the nested cycle as `peer: off`",
    Boolean(separatedPeer.seen.cycleOpts) && separatedPeer.seen.cycleOpts.opts.peer === "off",
    JSON.stringify({ status: separatedPeer.status, peer: separatedPeer.seen.cycleOpts && separatedPeer.seen.cycleOpts.opts.peer }),
  );
}

// --- The pre-push point and its re-verification ------------------------------
// The second point runs once the cycle has PASSED, because what it exists for is
// the tree that is about to be pushed. Where it replays anything, the passing
// verdict describes a tree nobody will push, so the cycle runs again over the
// rebased one — and that second run is where the mechanism can go wrong in ways
// no earlier scenario reaches: it must be told the dispositions it is ordered to
// carry forward, its reviewer must be given them as a baseline, it must be
// bounded, and replacing the first cycle must not take the first cycle's open
// questions and deviations with it.
{
  const withWork = { reconcile: { outcome: "work" }, items: [ITEM] };
  const noopSecond = await run(gathered(withWork), { cycles: [CYCLE_PASS] });
  check(
    "a passing cycle is followed by the pre-push point, and a no-op there needs no second cycle",
    noopSecond.status === "fixed-local" &&
      noopSecond.seen.agentLabels.join(",") === "gather,rebase-pre-fix,rebase-pre-push,record" &&
      noopSecond.seen.cycleCalls.length === 1,
    JSON.stringify({ status: noopSecond.status, labels: noopSecond.seen.agentLabels, cycles: noopSecond.seen.cycleCalls.length }),
  );
  // A halt at the SECOND point stops a run that already has a passed cycle
  // behind it, so it is the one exit where two sources of open questions meet.
  // They are reported oldest first — the order the two-cycle merge below keeps
  // every human-facing set in — rather than leading with the halt because it
  // arrived last.
  const haltedSecond = await run(gathered(withWork), {
    cycles: [CYCLE_PASS],
    rebases: {
      "pre-fix": REBASE_NOOP,
      "pre-push": {
        ok: true,
        halted: true,
        noop: false,
        question: "`src/app.ts` conflicts with the base's rename; which side owns the guard?",
        detail: "aborted; tree clean and idle",
        recoveryRef: "refs/pre-rebase/feature/x/20260809-131415",
      },
    },
  });
  const haltIds = ((haltedSecond.result || {}).openQuestions || []).map((q) => q && q.id).join(",");
  check(
    "a halt at the pre-push point stops the run, reporting the passed cycle's questions ahead of the halt's",
    haltedSecond.status === "rebase-halted" && haltIds === "pr-42-q1,pr-42-rebase-pre-push",
    JSON.stringify({ status: haltedSecond.status, ids: haltIds }),
  );
  const replayed = await run(gathered(withWork), {
    cycles: [CYCLE_PASS, CYCLE_REVERIFIED],
    rebases: { "pre-fix": REBASE_NOOP, "pre-push": REBASE_REPLAY },
  });
  check(
    "a replaying pre-push point re-runs the cycle over the rebased tree, on the base THAT rebase landed on",
    replayed.status === "fixed-local" &&
      replayed.seen.cycleCalls.length === 2 &&
      replayed.seen.cycleCalls[1].opts.base === REBASE_REPLAY.effectiveBase,
    JSON.stringify({ status: replayed.status, cycles: replayed.seen.cycleCalls.length, base: replayed.seen.cycleCalls[1] && replayed.seen.cycleCalls[1].opts.base }),
  );
  const second = replayed.seen.cycleCalls[1] ? replayed.seen.cycleCalls[1].opts.scope : null;
  const passedDisposition = CYCLE_PASS.workReport[0];
  check(
    "and hands it the dispositions that passed — to the fixer told to carry them forward, and to the reviewer as its baseline",
    !!second &&
      second.instructions.includes(passedDisposition.detail) &&
      second.reviewInstructions.includes(passedDisposition.detail) &&
      /carry/i.test(second.instructions) &&
      /baseline/i.test(second.reviewInstructions),
    JSON.stringify({
      fixerCarriesThem: !!second && second.instructions.includes(passedDisposition.detail),
      reviewerCarriesThem: !!second && second.reviewInstructions.includes(passedDisposition.detail),
    }),
  );
  const cap = replayed.seen.cycleCalls[1] ? replayed.seen.cycleCalls[1].opts.maxRounds : undefined;
  check(
    "and bounds it with a lowered round cap, so two cycles cannot double the run's worst case",
    typeof cap === "number" && cap > 0 && cap < 12,
    `maxRounds: ${JSON.stringify(cap)}`,
  );
  // A lowered ceiling is not the cap. `review-cycle` states its cap as at most
  // 12 reviewer rounds TOTAL, an invoker may lower it and never raise it, and
  // this run reports `rounds` as its own total across both cycles — so what
  // bounds the second cycle is what the FIRST left of that budget, with the
  // ceiling as the most a re-verification may take of it. A fixed 4 would hand
  // a run that already spent 11 rounds four more and report 15.
  const nearlySpent = await run(gathered(withWork), {
    cycles: [{ ...CYCLE_PASS, rounds: 10 }, CYCLE_REVERIFIED],
    rebases: { "pre-fix": REBASE_NOOP, "pre-push": REBASE_REPLAY },
  });
  const remaining = nearlySpent.seen.cycleCalls[1] ? nearlySpent.seen.cycleCalls[1].opts.maxRounds : undefined;
  check(
    "and the bound is what the first cycle LEFT of the run's 12 rounds, not a fixed ceiling",
    remaining === 2,
    `a 10-round first cycle left maxRounds: ${JSON.stringify(remaining)}`,
  );
  // And where it left nothing, there is no budget to review the rebased tree
  // with at all. The verdict standing describes a tree nobody will push, so the
  // run stops — no second cycle, and nothing published — rather than buying
  // rounds the cap does not have.
  const spent = await run(gathered(withWork), {
    args: "push",
    cycles: [{ ...CYCLE_PASS, rounds: 12 }, CYCLE_REVERIFIED],
    rebases: { "pre-fix": REBASE_NOOP, "pre-push": REBASE_REPLAY },
  });
  check(
    "a first cycle that spent the whole budget stops the run at the replay, with no second cycle and nothing published",
    spent.status === "reverify-budget-exhausted" &&
      spent.seen.cycleCalls.length === 1 &&
      !spent.seen.agentLabels.includes("publish"),
    JSON.stringify({ status: spent.status, cycles: spent.seen.cycleCalls.length, labels: spent.seen.agentLabels }),
  );
  // And the recovery ref it promises is the EXACT one the replay reported, not a
  // clause a report without one drops on its way out: the note is the only place
  // this stop tells the maintainer how to get the pre-rebase tip back.
  check(
    "and says so in terms of the cap and the rounds already spent, with the branch's recovery ref named",
    /12/.test((spent.result || {}).detail || "") &&
      /never raise/.test((spent.result || {}).detail || "") &&
      /nothing was pushed/i.test((spent.result || {}).note || "") &&
      ((spent.result || {}).note || "").includes(`saved at \`${REBASE_REPLAY.recoveryRef}\``),
    JSON.stringify({ detail: (spent.result || {}).detail, note: (spent.result || {}).note }),
  );
  // The merge folds the two human-facing sets rather than concatenating them: a
  // deviation the re-verification restates VERBATIM (which the cycle orders it
  // to) is ONE deviation, and it carries ONE assessment — the later round's,
  // since that is the round that judged the tree being pushed. Concatenated, the
  // publisher's summary comment leads with the same deviation twice and its
  // "carry each assessment beside the deviation they name" names two.
  const restated = await run(gathered(withWork), {
    cycles: [CYCLE_PASS, CYCLE_REVERIFIED_RESTATING],
    rebases: { "pre-fix": REBASE_NOOP, "pre-push": REBASE_REPLAY },
  });
  const rr = restated.result || {};
  check(
    "a deviation both cycles state appears ONCE in the merged result, with the re-verification's assessment of it",
    JSON.stringify(rr.deviations) === JSON.stringify([DEVIATION]) &&
      (rr.deviationAssessments || []).length === 1 &&
      (rr.deviationAssessments || [])[0].recommendation === CYCLE_REVERIFIED_RESTATING.deviationAssessments[0].recommendation,
    JSON.stringify({ deviations: rr.deviations, assessments: rr.deviationAssessments }),
  );
  // And the discriminating half of that: where the two cycles state DIFFERENT
  // deviations, both reach the maintainer and each keeps its own assessment. The
  // check above cannot see the difference between folding on the deviation's text
  // and folding on nothing, because its two fixtures state the same deviation;
  // this one fails outright if the identity stops telling two deviations apart.
  const distinct = await run(gathered(withWork), {
    cycles: [CYCLE_PASS, CYCLE_REVERIFIED_OWN_DEVIATION],
    rebases: { "pre-fix": REBASE_NOOP, "pre-push": REBASE_REPLAY },
  });
  const dr = distinct.result || {};
  check(
    "two DIFFERENT deviations both survive the fold, oldest first, each still carrying the assessment that names it",
    JSON.stringify(dr.deviations) === JSON.stringify([DEVIATION, SECOND_DEVIATION]) &&
      JSON.stringify((dr.deviationAssessments || []).map((a) => [a && a.deviation, a && a.recommendation])) ===
        JSON.stringify([
          [DEVIATION, CYCLE_PASS.deviationAssessments[0].recommendation],
          [SECOND_DEVIATION, CYCLE_REVERIFIED_OWN_DEVIATION.deviationAssessments[0].recommendation],
        ]),
    JSON.stringify({ deviations: dr.deviations, assessments: dr.deviationAssessments }),
  );
  // The superseded cycle's three `preRebase*` records. Each speaks for something
  // the re-verification did not undo — a delivery run that FAILED, a close-out's
  // unreviewed non-semantic edits, and a round history under another directory —
  // so replacing the verdict must not take them with it.
  const superseded = await run(gathered(withWork), {
    args: "push",
    cycles: [CYCLE_PASS_RECORD_ONLY, CYCLE_REVERIFIED],
    rebases: { "pre-fix": REBASE_NOOP, "pre-push": REBASE_REPLAY },
  });
  const sr = superseded.result || {};
  check(
    "the superseded cycle's delivery-failure record, close-out and artifact directory ride out under their `preRebase*` names",
    !!sr.preRebaseRecordOnly &&
      JSON.stringify(sr.preRebaseCloseOut) === JSON.stringify(CYCLE_PASS_RECORD_ONLY.closeOut) &&
      sr.preRebaseArtifactDir === CYCLE_PASS.artifactDir,
    JSON.stringify({ record: sr.preRebaseRecordOnly, closeOut: sr.preRebaseCloseOut, artifactDir: sr.preRebaseArtifactDir }),
  );
  check(
    "with the one claim in it the re-verification falsified corrected — a fresh reviewer has since read that commit — and the failure it exists to report intact",
    !!sr.preRebaseRecordOnly &&
      sr.preRebaseRecordOnly.range === "" &&
      sr.preRebaseRecordOnly.verified === "" &&
      sr.preRebaseRecordOnly.note === FLAKE_RECORD.note &&
      sr.preRebaseRecordOnly.pass === FLAKE_RECORD.pass,
    JSON.stringify(sr.preRebaseRecordOnly),
  );
  // And the record reaches the PR, which is the whole point of keeping it: the
  // publish brief is this run's ONLY PR-facing surface, so a record that rides
  // out in the result and not in that brief is a gap the maintainer never sees.
  const publishBrief = superseded.seen.publishPrompts[0] || "";
  check(
    "and the publisher is handed it, under the same delivery-failure heading, labelled as the cycle the re-verification replaced",
    publishBrief.includes(FLAKE_RECORD.note) &&
      /## Delivery-run failure — recorded, not reviewed/.test(publishBrief) &&
      /cycle before the pre-push rebase/.test(publishBrief) &&
      /plus the delivery-run failure section defined below/.test(publishBrief),
    JSON.stringify({
      note: publishBrief.includes(FLAKE_RECORD.note),
      heading: /## Delivery-run failure/.test(publishBrief),
      labelled: /cycle before the pre-push rebase/.test(publishBrief),
      crossReferenced: /plus the delivery-run failure section defined below/.test(publishBrief),
    }),
  );
  // The replacement is what makes the verdict honest; it must not also make the
  // first cycle's for-the-human records disappear. A parked question or a
  // standing locked-decision deviation raised before the rebase is the
  // maintainer's either way, and the deviation is what a publish run leads its
  // summary comment with.
  const r = replayed.result || {};
  const questionIds = (r.openQuestions || []).map((q) => q && q.id).join(",");
  check(
    "and the result carries BOTH cycles' open questions and the superseded cycle's deviations",
    questionIds === "pr-42-q1,pr-42-post-q1" &&
      JSON.stringify(r.deviations) === JSON.stringify(CYCLE_PASS.deviations),
    JSON.stringify({ questionIds, deviations: r.deviations }),
  );
  check(
    "and reports the rounds of both, rather than only the re-verification's",
    r.rounds === CYCLE_PASS.rounds + CYCLE_REVERIFIED.rounds &&
      (r.roundsByCycle || {}).beforeRebase === CYCLE_PASS.rounds &&
      (r.roundsByCycle || {}).reverification === CYCLE_REVERIFIED.rounds,
    JSON.stringify({ rounds: r.rounds, roundsByCycle: r.roundsByCycle }),
  );
}

// --- The producer half: what the rebase brief orders -------------------------
// The pin above is enforced on what the agent REPORTS; what makes it report a
// commit at all is the brief, which no scenario reaches because the rebase agent
// is stubbed. So it is rendered and read, exactly as the gather brief's
// reconciliation rule is: resolve the target to an OID and rebase onto that, and
// on a conflict it cannot judge, abort and leave the tree clean rather than
// returning mid-rebase.
{
  const briefPacket = gathered({ reconcile: { outcome: "work" } });
  const brief = rebasePrompt("pre-fix", briefPacket, "main");
  // The same brief rendered for the OTHER working location. The mode decides
  // where every command in it runs, so both renderings are read below.
  const briefInWorktree = rebasePrompt(
    "pre-fix",
    gathered({ reconcile: { outcome: "work" }, locationMode: "worktree", worktree: "/w/.worktrees/c/pr-42" }),
    "main",
  );
  const resolves = /git rev-parse/.test(brief);
  const rebasesOntoTheOid = /rebase onto THAT OID, never onto the name/.test(brief);
  const namesTheHazard = /every range this run delegates afterwards is taken against `effectiveBase`/.test(brief);
  check(
    "the rebase brief resolves the target to an OID, rebases onto that, and says why a ref name is not an answer",
    resolves && rebasesOntoTheOid && namesTheHazard,
    `rev-parse: ${resolves}; rebases onto the OID: ${rebasesOntoTheOid}; names the hazard: ${namesTheHazard}`,
  );
  const aborts = brief.indexOf("git rebase --abort");
  const confirmsIdle = /CONFIRM the tree is clean and idle/.test(brief);
  const neverMidRebase = /Never leave the tree mid-rebase/.test(brief);
  const hunkRule = /no cleanly auto-merged content from the other side/.test(brief);
  check(
    "and on a conflict beyond its competence it aborts, confirms the tree is clean and idle, and resolves by hunk otherwise",
    aborts > -1 && confirmsIdle && neverMidRebase && hunkRule,
    `abort@${aborts} confirms-idle@${confirmsIdle} never-mid-rebase@${neverMidRebase} hunk-rule@${hunkRule}`,
  );

  // WHICH REPOSITORY the target ref is fetched from, for the same reason the
  // gather brief's base resolution is pinned above: the default target is the
  // PR's base ref, which lives in the PR's own repository, while the branch's
  // push remote is the HEAD repository — a different one on every fork PR, where
  // the same ref name is another branch's tip or nothing. Rebasing onto that
  // pins a commit off the wrong branch and the run looks like it worked.
  // Naming that repository is not enough: this step has to be HANDED it, because
  // the one command that would name it for itself — `gh repo view` with no
  // repository argument — answers for the repository its working directory
  // resolves to, which in a fork clone is that same head fork. So the caller
  // interpolates the PR's own already-resolved URL, and the brief is read for it.
  const fetchesFromBaseRepo = /repository the PR itself is in/.test(brief) && /NOT this branch's push remote/.test(brief);
  const carriesThePrUrl = brief.includes(briefPacket.pr.url) && /whose `<owner>\/<repo>` IS that repository/.test(brief);
  const refusesTheDirectoryDerivedRepo =
    /Do not re-derive it from a bare `gh repo view/.test(brief) && /answers for the repository the DIRECTORY it runs in/.test(brief);
  const fetchesTheRef = /git fetch <the remote whose URL is that repository/.test(brief);
  const resolvesWhatItFetched = /`FETCH_HEAD` for a ref you just fetched/.test(brief);
  check(
    "and fetches the target from the repository that ref lives in — the PR's own, handed over as its resolved URL rather than re-derived from the working directory — never through the branch's push remote",
    fetchesFromBaseRepo && carriesThePrUrl && refusesTheDirectoryDerivedRepo && fetchesTheRef && resolvesWhatItFetched,
    `base repository stated: ${fetchesFromBaseRepo}; carries the PR url: ${carriesThePrUrl}; directory-derived repo refused: ${refusesTheDirectoryDerivedRepo}; fetches the ref: ${fetchesTheRef}; resolves what it fetched: ${resolvesWhatItFetched}`,
  );

  // And the other half of "the repository that ref lives in": that clause is
  // true of the DEFAULT target, which is the PR's base ref, and false of an
  // explicit `rebase on top of <target>` token, which names whatever the
  // maintainer named — routinely a local branch, or one in the head fork.
  // `git fetch <repository> <refspec>` reads the refspec in the repository
  // operand, so rendering the paragraph above for an explicit target either
  // pins an unrelated same-named branch upstream or stops a run whose target
  // was on disk the whole time — the token's pre-default behaviour was to
  // resolve it locally, and that is what the explicit arm restores. Read the
  // arm for what it ORDERS (resolve here, fetch nothing) and for the absence of
  // the fetch it must not inherit, since the two arms share one builder and a
  // careless merge of them would silently reinstate it.
  const explicitBrief = rebasePrompt("pre-fix", briefPacket, "my-local-base", true);
  const resolvesWhereNamed = /Resolve it WHERE IT WAS NAMED/.test(explicitBrief) &&
    /git rev-parse --verify 'my-local-base\^\{commit\}'/.test(explicitBrief) && /quoted as ONE argument/.test(explicitBrief);
  const fetchesNothingForIt = /Fetch NOTHING for it/.test(explicitBrief) && !/git fetch /.test(explicitBrief);
  const refusesTheBaseRepoLookup = /do not go looking for it in the PR's base repository/.test(explicitBrief);
  const stopsRatherThanSubstitute = /report `ok: false` naming what you tried, and substitute nothing/.test(explicitBrief);
  // The shared tail still applies to both arms: whatever it resolved is what
  // gets reported and rebased onto, at full length.
  const stillPinsTheOid = /Report exactly that full OID as `effectiveBase` and rebase onto THAT OID/.test(explicitBrief);
  check(
    "but an explicitly named target is resolved in the working location and fetched from nowhere, since the token routinely names a local branch the base repository does not have",
    resolvesWhereNamed && fetchesNothingForIt && refusesTheBaseRepoLookup && stopsRatherThanSubstitute && stillPinsTheOid,
    `resolves where named: ${resolvesWhereNamed}; fetches nothing: ${fetchesNothingForIt}; base-repo lookup refused: ${refusesTheBaseRepoLookup}; stops rather than substitutes: ${stopsRatherThanSubstitute}; still pins the OID: ${stillPinsTheOid}`,
  );

  // This brief is the workflow layer's rendering of the canonical nugget
  // (`review-cycle` → "The delegated rebase step"), carried inline because it is
  // handed to a subagent that has read no skill. Rendering it is the established
  // pattern; the risk the pattern carries is CONTENT drift, so each operative
  // clause of the nugget that this pipeline can reach is pinned here. The two it
  // cannot reach are deliberately absent and are named in the builder's comment:
  // the parent map with its `--onto` form (one PR), and the pinned-base snapshot
  // ref (the pin is rebased onto, so HEAD keeps it reachable).
  //
  // Each clause is anchored to its IMPERATIVE, never to a noun it happens to
  // contain, because a keyword survives the destruction of the instruction
  // around it. A reviewer gutted three of these in a disposable clone with the
  // whole suite still green: step 3 reduced to "Recovery refs live under
  // refs/pre-rebase/ by convention; skip this step if it is inconvenient", the
  // halt clause to "a `question` is optional and may be empty", and the final
  // report sentence deleted outright (its field names occur elsewhere in the
  // brief, in prose that orders nothing). So the recovery ref is paired with the
  // order not to skip it, the halt with what its question must name, and the
  // packet's field list is matched INSIDE the report sentence rather than
  // anywhere in the brief.
  const reportSentence = (brief.match(/Report `ok`[\s\S]*?`question` when you halted\./) || [""])[0];
  const nuggetClauses = {
    "saving the recovery ref before the first replay, and not skipping it": /git update-ref "refs\/pre-rebase\//.test(brief) && /do not skip it/.test(brief),
    "reading that ref back and reporting what it resolves to, so the name is not the evidence":
      /must print `\$before`/.test(brief) && /that read-back OID as `recoveryTip`/.test(brief),
    "verifying the target is a commit, and the full OID it prints": /rev-parse --verify/.test(brief) && /never an abbreviation/.test(brief),
    "the working location it runs in — verified first in a worktree, never switched inline":
      /`cd` into it and verify `git rev-parse --show-toplevel` prints exactly that path/.test(briefInWorktree) &&
      /STOP and report `ok: false`/.test(briefInWorktree) &&
      /Do NOT create a worktree and do NOT switch branches/.test(brief),
    "the no-op reported as one, with no validation run on it and the two tips that evidence it":
      /noop: true/.test(brief) && /run no validation/.test(brief) && /adopts it only where both are reported and equal/.test(brief),
    "idempotence — why two points cannot double-apply": /cannot double-apply/.test(brief),
    "the merge guard — a merge that introduced its own content halts rather than being silently flattened":
      /git rev-list --merges/.test(brief) && /--remerge-diff/.test(brief) && /On such a merge rebase NOTHING/.test(brief),
    "the octopus blind spot — a merge the probe cannot answer for halts unprobed instead of reading as a pure join":
      /octopus/.test(brief) && /declining to answer/.test(brief) && /treat such a merge as content-bearing without probing it/.test(brief),
    "the replay's shape stated outright — `--no-update-refs --no-rebase-merges` on the rebase it runs, against inherited config on either axis":
      /git rebase --no-update-refs --no-rebase-merges <the effectiveBase OID>/.test(brief) && /rebase\.updateRefs=true/.test(brief) && /rebase\.rebaseMerges=true/.test(brief),
    "the delivery-tier validation after a replay": /the project's build AND its test suite/.test(brief),
    "reporting the conflicts it resolved and the commits it skipped": /git rebase --skip/.test(brief) && /Narrate one line each in `detail`/.test(brief),
    "the halt reported with a question naming the conflict it turns on": /report `halted: true` with a `question` naming the conflicting files, the offending commit/.test(brief),
    "the packet it hands back": ["effectiveBase", "recoveryRef", "recoveryTip", "validationPassed", "before", "after"].every((f) => reportSentence.includes(f)),
    "and nothing else changed — no commits, no push, no PR mutation": /Change nothing else/.test(brief),
  };
  const absent = Object.entries(nuggetClauses).filter(([, present]) => !present).map(([name]) => name);
  check(
    "and carries every clause of the canonical nugget this pipeline can reach, since the agent reading it has read no skill",
    absent.length === 0,
    `missing: ${absent.join("; ")}`,
  );
}

// --- The mirrors' restatements of the rebase halt ----------------------------
// Two consecutive review rounds landed the same class of finding in the
// `address-review` SKILL.md pair: prose equating the delegated rebase's halt
// with an aborted conflict, written before the merge guard added a second halt
// source that aborts nothing (a content-bearing merge met before any replay).
// The canonical rule already forbids the shape — `review-cycle` → "The
// delegated rebase step" is "defined here and referenced rather than restated"
// — so the structural fix makes the two spots that kept restating it (the
// `hands-off`+default-rebase flag bullet and the Hands-off mode stop list)
// DEFER to step 2's definitional bullet by reference, enumerating no cases of
// their own. This pin is what keeps a later round from restoring the closed
// enumeration as the obvious simplification, and both halves are pinned: the
// deferring spots still defer (each names the definitional bullet instead of a
// case list), and the conflict-only phrasings the two spots carried do not come
// back anywhere in either mirror. It reads the SKILL.md pair rather than the
// workflow source because the workflow's own restatements are schema and brief
// text the checks above already exercise, while nothing else reads the mirrors.
{
  const mirrors = {
    "plugins mirror": join(here, "..", "plugins", "dev-skills", "skills", "address-review", "SKILL.md"),
    "codex mirror": join(here, "..", "codex", "dev-skills", "skills", "address-review", "SKILL.md"),
  };
  for (const [name, path] of Object.entries(mirrors)) {
    const text = readFileSync(path, "utf8");
    const deferrals = (text.match(/step 2's "A halt is a stop, not a guess" defines the cases/g) || []).length;
    const bulletDefers = /defines the cases, and this bullet does not restate them/.test(text);
    const listDefers = /defines the cases, and this list does not restate them/.test(text);
    check(
      `${name}: the flag bullet and the hands-off stop list defer to step 2's halt definition instead of restating its cases`,
      deferrals >= 2 && bulletDefers && listDefers,
      `deferrals: ${deferrals}; flag bullet defers: ${bulletDefers}; stop list defers: ${listDefers}`,
    );
    // The single-PR skill is where the two-arm `no-rebase` review base was
    // first stated, and it is the site the same defect keeps returning to: a
    // `rebase on top of <target>` target that `no-rebase` did not discard is
    // what bounds every range, and falling back to `baseRefName` there hands
    // the reviewer and the peer the underlying branch's own commits as this
    // PR's diff. Pinned in both mirrors because nothing else reaches this file:
    // gutted back to one arm, the rest of the suite stays green.
    const keepsTheStandingTarget = text.includes("A `rebase on top of <target>` target still standing") &&
      text.includes("not discarded by `no-rebase`, which suppresses the rebase and not the target");
    const resolvesItWhereNamed = /resolves where it was named: locally, `git rev-parse --verify/.test(text);
    const baseRefIsTheOtherArm = text.includes("pin `baseRefName`, resolved exactly as the rebasing path's default target is");
    // ...and it is the arm for a request that named NONE, never the fallback
    // for a named target that failed to resolve — the one silence that put
    // `baseRefName` right beside the failure as the apparent next step.
    const failureIsNotTheBaseRef = text.includes("stop and report what you tried rather than substituting anything") &&
      text.includes("never the fallback for one that failed to resolve");
    // ...and the flag rule that an agent reads FIRST must not have told it the
    // token was simply ignored, or it arrives at step 6 with nothing standing.
    const flagRuleAgrees = text.includes("for the REBASE only: the token is not discarded");
    check(
      `${name}: a \`rebase on top of <target>\` target survives \`no-rebase\` as the review base, and the flag rule says so too`,
      keepsTheStandingTarget && resolvesItWhereNamed && baseRefIsTheOtherArm && failureIsNotTheBaseRef && flagRuleAgrees,
      `keeps the standing target: ${keepsTheStandingTarget}; resolves where named: ${resolvesItWhereNamed}; base ref is the other arm: ${baseRefIsTheOtherArm}; a failed resolution stops rather than falling back: ${failureIsNotTheBaseRef}; flag rule agrees: ${flagRuleAgrees}`,
    );
    check(
      `${name}: no prose equates the delegated rebase's halt with an aborted conflict`,
      !/delegated rebase aborts cleanly/.test(text) && !/Non-trivial rebase conflict/.test(text) && !/sharp edge is a conflict/.test(text),
      "a conflict-only restatement of the halt is back",
    );
  }
}

// --- The canonical nugget's own new clauses, in the mirrors ------------------
// The two clauses the brief pins above — the octopus blind spot and
// `--no-update-refs` on the replay — are the workflow's RENDERING of rules that
// live in `review-cycle` → "The delegated rebase step", and the stacked
// `--onto` form exists only there and in the `address-reviews` pair that quotes
// it (the single-PR pipeline cannot reach it, so no brief check can cover it).
// A peer round proved the gap: with only the brief pinned, gutting either
// canonical clause — or stripping the flag off every stacked quote — left the
// whole suite green. So the canonical mirrors are pinned by their imperatives
// here, and the quoting pair is held to carrying no unflagged stacked form.
{
  const rcMirrors = {
    "plugins review-cycle": join(here, "..", "plugins", "dev-skills", "skills", "review-cycle", "SKILL.md"),
    "codex review-cycle": join(here, "..", "codex", "dev-skills", "skills", "review-cycle", "SKILL.md"),
  };
  for (const [name, path] of Object.entries(rcMirrors)) {
    const text = readFileSync(path, "utf8");
    check(
      `${name}: the canonical nugget states the replay's shape on both axes and halts the octopus merge unprobed`,
      /So every rebase this step runs passes `--no-update-refs`/.test(text) &&
        /the stated flags are `--no-update-refs --no-rebase-merges`/.test(text) &&
        /`git rebase --no-update-refs --no-rebase-merges --onto <new parent tip> <old parent tip>`/.test(text) &&
        !/`git rebase --onto <new parent tip> <old parent tip>`/.test(text) &&
        !/`git rebase --no-update-refs --onto <new parent tip> <old parent tip>`/.test(text) &&
        /halts unprobed, exactly as if it carried content/.test(text) &&
        /declining to answer/.test(text),
      "a canonical clause the brief renders was gutted, or the stacked form lost its flag",
    );
  }
  const quotingMirrors = {
    "plugins address-reviews": join(here, "..", "plugins", "dev-skills", "skills", "address-reviews", "SKILL.md"),
    "codex address-reviews": join(here, "..", "codex", "dev-skills", "skills", "address-reviews", "SKILL.md"),
  };
  for (const [name, path] of Object.entries(quotingMirrors)) {
    const text = readFileSync(path, "utf8");
    const flagged = (text.match(/`git rebase --no-update-refs --no-rebase-merges --onto <new parent tip> <old parent tip>`/g) || []).length;
    check(
      `${name}: every quoted stacked rebase carries --no-update-refs --no-rebase-merges`,
      flagged >= 2 && !/`git rebase --onto <new parent tip> <old parent tip>`/.test(text) && !/`git rebase --no-update-refs --onto <new parent tip> <old parent tip>`/.test(text),
      `flagged quotes: ${flagged}; an unflagged or half-flagged stacked form is back`,
    );
  }
}

// --- Both target-pinning arms, in the prose mirrors --------------------------
// The workflow's two `rebasePrompt` arms are driven as running code above, but
// the SKILLS state the same rule in prose and are what a human-driven run
// follows. The batch skill had exactly one arm: it exempted a target the
// invocation named only where that target was already an exact commit, so a
// named BRANCH fell through to the default recipe and was fetched as each
// entry's own `refs/heads/<baseRefName>` — the request's target silently
// replaced by every entry's own base, with the batch then reviewing and
// force-pushing branches nobody asked to move. Both halves are pinned: the
// canonical nugget must admit the working-location arm at all, and the batch
// skill must resolve a named ref there rather than fetching it as a base ref.
{
  for (const [name, path] of Object.entries({
    "plugins review-cycle": join(here, "..", "plugins", "dev-skills", "skills", "review-cycle", "SKILL.md"),
    "codex review-cycle": join(here, "..", "codex", "dev-skills", "skills", "review-cycle", "SKILL.md"),
  })) {
    const text = readFileSync(path, "utf8");
    check(
      `${name}: the canonical pin states both arms — a request-named target is resolved in the working location, not fetched`,
      text.includes("a target the **request** named outright") &&
        text.includes("resolved in the working location (`git rev-parse --verify`") &&
        text.includes("fetched from nowhere"),
      "the nugget's pin describes only the base-repository fetch, so an explicitly named target has nowhere to resolve",
    );
  }
  for (const [name, path] of Object.entries({
    "plugins address-reviews": join(here, "..", "plugins", "dev-skills", "skills", "address-reviews", "SKILL.md"),
    "codex address-reviews": join(here, "..", "codex", "dev-skills", "skills", "address-reviews", "SKILL.md"),
  })) {
    const text = readFileSync(path, "utf8");
    check(
      `${name}: an invocation-named target is a documented argument and a named REF resolves where it was named`,
      text.includes("[rebase on top of <target>]") &&
        text.includes("| `rebase on top of <target>` |") &&
        text.includes("resolved WHERE IT WAS NAMED") &&
        text.includes("Fetch nothing for it, and never send it at the base repository") &&
        // The failure mode is half the rule: a named ref that does not resolve
        // must stop the batch, since the one substitution available is the very
        // base-ref fetch the sentence before it forbids.
        text.includes("stop the batch and report what you tried rather than substituting anything") &&
        !text.includes("A target the invocation itself named as an exact commit is pinned as given"),
      "the exact-commit-only exemption is back, the token is undocumented, or a target that does not resolve no longer stops the batch",
    );
    check(
      `${name}: an invocation-named target is pinned ONCE for the batch, and survives no-rebase as the effective base`,
      // The per-point re-pin rule governs the DEFAULT target alone: a target the
      // request named is the batch's single base by construction, and
      // re-resolving it per entry per point would land concurrent entries on
      // whatever that ref carried when each of them got there.
      text.includes("It is the DEFAULT target this governs, and only it") &&
        text.includes("that single OID serves every rebase-enabled entry at both of its points") &&
        // `no-rebase` suppresses the rebase, not the token — bounding a
        // named-target run's ranges at `baseRefName` would hand every reviewer
        // the underlying branch's commits as this PR's diff. Counted rather
        // than merely found: the rule and the Phase B brief that consumes it
        // are two sites, and a positive fragment anywhere in the file passed
        // while the second one still said `baseRefName` unconditionally.
        (text.match(/the invocation-named target's own pinned OID/g) || []).length >= 2 &&
        // The exclusion is the statement that THAT branch stays on its own base,
        // so a prose-excluded entry takes `baseRefName` even where a target was
        // named — bounding it at a target it was deliberately not moved onto is
        // the same wrong-boundary harm by the other road.
        text.includes("excluding it is the statement that THAT branch stays on its own base") &&
        // The checklist states the same rule in its own words, so counting the
        // rule's phrasing does not reach it: gutted back to an unconditional
        // `baseRefName` it would audit a run as correct that bounded every
        // range at the wrong commit.
        text.includes("that named target's pinned OID on a `no-rebase` batch") &&
        text.includes("since `no-rebase` suppresses the rebase without discarding the token") &&
        // A named target cannot drift, so the second point normally reports a
        // no-op — but the canonical step still flattens a pure-join merge in
        // range, so "guaranteed" would license skipping the point itself.
        !/guaranteed no-op for a named target/.test(text) &&
        text.includes("never a reason for you not to spawn it"),
      "the named target is re-resolved per point, a site still falls back to `baseRefName` under `no-rebase`, or the second point is claimed to be a guaranteed no-op",
    );
    // This file's frontmatter `description` is the longest in the repository and
    // this branch grew it twice. It is what the harness loads the skill by, and
    // nothing else here measures it, so the next clause anyone appends would
    // break loading with the suite green. The cap is 1024; the margin is what
    // makes the check useful rather than a tripwire that fires on the change
    // that breaks it.
    const description = (text.match(/^description: (.*)$/m) || [])[1] || "";
    check(
      `${name}: the frontmatter description stays clear of the 1024-character load limit`,
      description.length > 0 && description.length <= 1000,
      `description is ${description.length} characters`,
    );
  }
}

// --- The disposition record, on every exit that publishes nothing ------------
// Step 8's report is chat output, so an unpublished run's map — which thread was
// pushed back, what the drafted rationale said — died with the session. It now
// goes to the PR as one comment, and WHICH exits leave it is script logic: the
// reason is computed from the same conditions the exits branch on, so the
// failure mode worth testing is an exit that publishes nothing and records
// nothing. The published exit is tested from the other side: it must record
// NOTHING, because its replies, resolves and Summary comment are the durable
// record there and a record beside them would say "not published" of published
// work.
{
  const withWork = { reconcile: { outcome: "work" }, items: [ITEM] };
  // The cap: a cycle that returned its report without a passing verdict.
  const CYCLE_CAP = { ...CYCLE_PASS, verdict: "fail", outstanding: { reviewer: [{ finding: "still wrong" }] } };
  // A passing cycle whose one entry names a thread that was never gathered, so
  // the gathered ITEM is uncovered: publication aborts before any push while the
  // run still holds a map worth recording.
  const CYCLE_UNCOVERED = {
    ...CYCLE_PASS,
    workReport: [{ ...CYCLE_PASS.workReport[0], threadId: "T2", url: "https://example.invalid/pr/42#d2" }],
  };
  // The same abort with NO map at all — nothing to replay, so nothing to record.
  const CYCLE_NO_MAP = { ...CYCLE_PASS, workReport: [] };
  const cases = [
    ["a `no-push` run that passed", "no-push", CYCLE_PASS, "fixed-local", true],
    ["a `no-push` run stopped at the round cap", "no-push", CYCLE_CAP, "review-cap", true],
    ["a push run stopped at the round cap", "push", CYCLE_CAP, "review-cap-not-published", true],
    ["a push run whose dispositions leave a gathered item uncovered", "push", CYCLE_UNCOVERED, "publish-aborted-incomplete-dispositions", true],
    ["a run that published", "push", CYCLE_PASS, "fixed-published", false],
    ["an abort with no dispositions at all", "push", CYCLE_NO_MAP, "publish-aborted-incomplete-dispositions", false],
  ];
  const wrong = [];
  let recordBrief = "";
  for (const [what, args, cycle, status, records] of cases) {
    const r = await run(gathered(withWork), { args: `${args} no-rebase`, cycles: [cycle] });
    const dispatched = r.seen.agentLabels.includes("record");
    const reported = !!(r.result || {}).dispositionRecord;
    if (r.status !== status) wrong.push(`${what} exited ${r.status}, expected ${status}`);
    if (dispatched !== records) wrong.push(`${what} ${dispatched ? "recorded" : "recorded nothing"}, expected the opposite`);
    if (reported !== records) wrong.push(`${what} ${reported ? "reports" : "does not report"} a dispositionRecord, expected the opposite`);
    if (records && !recordBrief) recordBrief = r.seen.recordPrompts[0] || "";
  }
  check(
    "every exit that publishes nothing while holding a disposition map leaves the record, and a published run leaves none",
    wrong.length === 0,
    wrong.join("; "),
  );

  // The brief itself. What a later run needs from this comment is the marker
  // that finds it, the supersession that keeps one per PR, the reply bodies
  // verbatim, and the two things a replay must NOT take from it: the SHAs as a
  // condition, and the tips as commits on origin.
  const recordClauses = {
    "the marker a later run matches, not its prose": /<!-- address-review:disposition-record -->/.test(recordBrief) && /the MARKER identifies a record, never its prose/.test(recordBrief),
    "superseding its own prior record in place rather than appending a second": /--method PATCH repos\/\{owner\}\/\{repo\}\/issues\/comments\/<id>/.test(recordBrief) && /instead of a stack of near-duplicates/.test(recordBrief),
    "exactly one PR write, and no reply, resolve, push or ping beside it": /You make exactly ONE PR write/.test(recordBrief) && /no push, no reply, no resolve, no Summary comment, no ping/.test(recordBrief),
    "the drafted replies and the ready-to-post Summary body, verbatim": /reply: "<the exact reply body a publishing turn would post, verbatim>"/.test(recordBrief) && /ready to post unchanged/.test(recordBrief),
    "the SHAs as provenance rather than a condition a replay checks": /The SHAs are PROVENANCE, not a promise/.test(recordBrief) && /Do not write "the branch tip is <sha>" as a condition a replay must check/.test(recordBrief),
    "the cited tips stated as local-only, not on origin": /the tips above are LOCAL ONLY — this run pushed nothing, so they are not on origin/.test(recordBrief),
    "no bare @-mention, which would summon a review of unpublished work": /with no bare `@`-mentions anywhere/.test(recordBrief),
    "the dispositions it is recording": recordBrief.includes(CYCLE_PASS.workReport[0].detail),
  };
  const absent = Object.entries(recordClauses).filter(([, present]) => !present).map(([name]) => name);
  check(
    "and the record brief carries what a later run replays from, and refuses what it must not replay",
    absent.length === 0,
    `missing: ${absent.join("; ")}`,
  );

  // The next run's side of the same comment: the gather step meets it as an
  // issue comment, and reading it as feedback would re-triage this workflow's
  // own output as if a maintainer had written it.
  const brief = gatherPrompt("#42");
  const priorPara = brief.split("\n").find((l) => l.includes("DISPOSITION RECORD")) || "";
  check(
    "and the gather brief meets a prior record as a proposal to re-judge — never an item, never maintainer authority, and never trusted for its SHAs",
    /<!-- address-review:disposition-record -->/.test(priorPara) &&
      /never an item and carries no maintainer authority/.test(priorPara) &&
      /re-judge every disposition it names against the branch as it now stands/.test(priorPara) &&
      /the recorded tip is local-only/.test(priorPara),
    priorPara ? priorPara.slice(0, 200) : "the gather brief says nothing about a prior disposition record",
  );
}

check(`suite ran all ${EXPECTED_CHECKS} checks`, ran === EXPECTED_CHECKS, `ran ${ran}`);

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll address-review reconciliation checks passed.");
