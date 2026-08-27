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
//   3. The ORDER relative to the empty-`items` exit — since its split (task
//      016a, below) two zero-item outcomes rather than one no-op. The rule's
//      third outcome returns NO items by contract, so a gate placed after that
//      exit would hand an unreconciled branch to one of them: "nothing to
//      address" or a published zero-item run — silent wrong answers a reader
//      of the result cannot tell from a genuinely clean PR.
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
// the other two are the two review-addressing SKILLs, in both mirrors (tasks
// 021d and 021e). They are prose no scenario can execute, and the probe they
// replaced (`git cat-file -e` on the OID `gh pr view` reported) is exactly the
// shape a later edit re-imports as a "safety check", so their paragraphs are
// read here beside the brief's. The same read pins the one exception to fetched-
// head adoption: a fetched tip behind that reported OID blocks as a rewind,
// while an advance or an undownloaded force-push keeps the adoption rule.
//
// It also covers the publication guard that landed beside the gate, which is
// prompt prose rather than script logic: a HEAD that is a proper ancestor of
// the PR head must stop the publisher BEFORE the lease it would otherwise
// match and rewind the branch with.
//
// And the two GitHub-reliability recipes the same brief renders inline because
// its publisher has read no skill (task 023a): the push read-back at the ref and
// the reviewer request confirmed from the timeline. Both are second copies of a
// wording the skill authors, so the brief's clause and the skill's sentence in
// both mirrors are read together — the drift the rendering buys back. Both reads
// are PHRASE pins and hold only as far as the phrases they select: a rewrite that
// keeps every one of them while reversing what they say passes, as it does for
// the `FETCH_HEAD` pins further down, so the polarity is the reviewer's to hold.
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
// It covers the EMPTY-`items` exit's split into the skill's two zero-item
// outcomes (task 016a): the terminal no-op taken only on the three-way tip
// agreement the gather is ordered to show (`HEAD`, the starting tip, and the
// recorded `headRefOid` one commit), the zero-item path everywhere else —
// through the same rebase points, an empty-item cycle, and a publication that
// posts its Summary while having no item to reply to or resolve — and the
// fail-closed stop where a zero-item packet cannot show its tips. The
// discriminating comparison is driven one moved tip at a time, so an
// item-count-only or pairwise rewrite fails by name.
//
// The PRE-PUSH point is driven too, which needs the nested cycle to RETURN
// rather than end the scenario: it runs only after a cycle passes, and where it
// replays anything the cycle runs a second time over the rebased tree. That
// second cycle is the run's whole honesty guarantee — its fixer carries the
// dispositions that already passed rather than re-triaging them, its reviewer
// compares against them, and the cycle it replaces still owns open questions and
// deviations that are the maintainer's — so the harness scripts cycle results in
// order instead of stopping at the first call. Four properties of that merge
// are pinned beside the verdict: the second cycle is bounded by what the first
// LEFT of the run's 12-round total rather than by a fixed ceiling (and a run
// with none left stops unpublished), a deviation both cycles state is folded to
// one with one assessment, the superseded cycle's `preRebase*` records reach
// the PR comment rather than only the run's result — which is why the publisher
// is stubbed here at all — and the standing deviations are HANDED to that second
// cycle's two roles (task 016b), which is what makes the fold a judgment of the
// pushed tree rather than a coincidence of identical wording. That carry is what
// the merge then reads back: a deviation the second cycle's own per-pass record
// shows it taking up and dropping is resolved and leaves, while one it never
// restated is silence and keeps standing with the earlier assessment, so the two
// absences are driven separately — the silent one twice, once as a cycle that
// never took the carry up and once with the story that makes the fixer brief's
// restate-first order load-bearing: a carry the replay genuinely resolved,
// claimed by omission, which the merge cannot read as anything but silence.
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
const EXPECTED_CHECKS = 244;

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
// The SCHEMAS live in that same prefix, and two of them carry contract text a
// scenario cannot reach: what the gather must hand over with a prior record, and
// what the publisher must report about what actually reached the PR. Both are
// read as the objects they are rather than by grepping the source.
const { gatherPrompt, publishPrompt, rebasePrompt, recordPrompt, PACKET_SCHEMA, PUBLISH_SCHEMA } = new Function(
  "args",
  `"use strict";\n${prefix}\nreturn { gatherPrompt, publishPrompt, rebasePrompt, recordPrompt, PACKET_SCHEMA, PUBLISH_SCHEMA };`,
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
// `deviationHistory` is part of that shape rather than decoration: it is the
// second cycle's own per-pass record of what its fixer restated, and it is what
// the merge reads to tell a deviation the re-verification TOOK UP from one it
// never saw. A fixture that restates a deviation without recording the pass that
// did would be a cycle result `wf-review-cycle` cannot produce.
const CYCLE_REVERIFIED_RESTATING = {
  ...CYCLE_REVERIFIED,
  deviations: [DEVIATION],
  deviationHistory: [{ pass: 1, deviations: [DEVIATION] }],
  deviationAssessments: [{ deviation: DEVIATION, inSpecRoute: "the replay brought the flag with it", recommendation: "CONFORM — the in-spec route exists on this base" }],
};
// The re-verification RESOLVING the carried deviation, through the protocol the
// fixer brief orders: its fixer restated it on pass 1 (restate-first, the
// believed-resolved ones included), a later pass stopped — the new base carries
// the flag the locked decision names, so the deviation no longer stands — and a
// round PASSED over that claim, which is the only way `wf-review-cycle` takes
// one out of its standing set. So its final `deviations` is empty over a history
// that shows the deviation, which is exactly the pair "resolved" is, and "never
// shown it" is not.
const CYCLE_REVERIFIED_RESOLVED = {
  ...CYCLE_REVERIFIED,
  deviations: [],
  deviationAssessments: [],
  deviationHistory: [{ pass: 1, deviations: [DEVIATION] }, { pass: 2, deviations: [] }],
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
// Its history states its OWN deviation and not the carried one, which makes this
// fixture the other half of the resolved/silent pair too: a re-verification that
// kept a per-pass record and never took the carried deviation up at all.
const SECOND_DEVIATION = "put the retry loop in the request path where the locked decision names the queue; that queue does not exist on this base";
const CYCLE_REVERIFIED_OWN_DEVIATION = {
  ...CYCLE_REVERIFIED,
  deviations: [SECOND_DEVIATION],
  deviationHistory: [{ pass: 1, deviations: [SECOND_DEVIATION] }],
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
// The OTHER shape a `recordOnly` comes in, and the one the re-verification's
// correction has nothing to correct: a record naming no post-run commit at all.
// This is `wf-review-cycle`'s `flakeCarried`, the record its ordinary
// conclusions carry — an empty `range`/`verified` pair beside the failure the
// maintainer is owed — so the correction's output for it is byte-identical to
// its input, and the only thing that tells "returned untouched" from "corrected
// unconditionally" is whether the SAME OBJECT comes back.
const NO_COMMIT_FLAKE_RECORD = {
  pass: 2,
  range: "",
  verified: "",
  note: "the delivery run's only failure was the payments suite; it reproduces on the base and tasks/041-flaky-payments-suite.md is already open on it",
};
const CYCLE_PASS_NO_COMMIT_RECORD = { ...CYCLE_PASS, recordOnly: NO_COMMIT_FLAKE_RECORD };

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
// The attached worktree a `worktree`-mode row works in, in one place because the
// packet, the reclaim stub and the assertions over it must all name the same
// tree.
const WORKTREE_PATH = "/w/.worktrees/c/pr-42";
async function run(packet, opts = {}) {
  const seen = { agentLabels: [], cycleOpts: null, cycleCalls: [], rebasePrompts: [], publishPrompts: [], recordPrompts: [], spendPrompts: [], reclaimPrompts: [] };
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
      // The default is a publication that actually SUCCEEDED, which means a report
      // that can show it: one keyed entry per item, both facts true, and the URL of
      // the Summary comment step 7 ends with. A `published: true` claim over less
      // is not accepted as published, so the old stub — `threadOutcomes: []` beside
      // a triaged map, no `summaryCommentUrl` at all — is one of the shapes under
      // test rather than the control.
      return opts.publish === undefined
        ? {
            published: true,
            pushed: true,
            pushedNewCommits: true,
            summaryCommentUrl: "https://example.invalid/pr/42#issuecomment-5",
            threadOutcomes: (packet.items || []).map((it) => ({
              ref: `src/app.ts:12 ${it.author}`,
              threadId: it.threadId,
              url: it.url,
              outcome: "replied and resolved",
              replied: true,
              resolved: true,
            })),
          }
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
    // The record's OTHER write, and the only one a fully published run makes: it
    // SPENDS the record it replayed, so nothing replays from a map that is now
    // on the PR. Stubbed for the same reason — which exit reaches it, whether it
    // is reached at all, and what it is handed are script logic.
    if (label === "spend-record") {
      seen.spendPrompts.push(prompt);
      return opts.spend === undefined
        ? { posted: true, superseded: true, url: "https://example.invalid/pr/42#issuecomment-9", detail: "superseded the prior record in place" }
        : opts.spend;
    }
    // Giving the worktree back — the one thing only a run that FINISHED does,
    // and the reason the completion gate matters at all: a claim waved through
    // it takes the exit that tears the tree down. It runs solely in `worktree`
    // mode, so a row that wants the property OBSERVED says so in its packet;
    // every other row spawns none of these and the assertions over them would
    // be vacuous, which is what this stub exists to stop.
    if (label === "reclaim") {
      seen.reclaimPrompts.push(prompt);
      return opts.reclaim === undefined
        ? { removed: true, path: WORKTREE_PATH, detail: "removed" }
        : opts.reclaim;
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
function gathered({ workingBranch = "feature/x", items = [], reconcile, locationMode = "inline", worktree, baseOid = GATHERED_BASE_OID, priorRecord, startingHead = "deadbeef", finalHead = "deadbeef", rebased = false }) {
  const packet = {
    ok: true,
    // Every `ok: true` gather the caller can CONTINUE on owes this echo —
    // empty where the request named no target — and the caller stops a run
    // that omits it, since an absent token cannot be told apart from one it
    // must honor. A TERMINAL no-op owes nothing: its exit runs ahead of the
    // guard, and the scenario below pins that, since with every fixture
    // carrying the field a guard moved ahead of the no-op would leave this
    // suite green. Scenarios that exercise a named target override it; the
    // default is "none named".
    rebaseTarget: "",
    pr: {
      number: 42,
      url: "https://example.invalid/pr/42",
      branch: "feature/x",
      workingBranch,
      base: "main",
      headOid: "deadbeef",
      // What the gather step reports and the caller then REPLACES from the rebase
      // phase's report, so `true` is the ordinary state of any run whose rebase
      // replayed anything. Overridable because it selects a brief arm no flag
      // reaches (the lease bullet's `rebased:` pair).
      rebased,
    },
    items,
  };
  if (baseOid !== null) packet.pr.baseOid = baseOid;
  if (locationMode !== null) packet.pr.locationMode = locationMode;
  if (worktree !== undefined) packet.pr.worktree = worktree;
  if (reconcile !== undefined) packet.reconcile = reconcile;
  // A prior disposition record, spread in only when a scenario supplies one: a
  // PR without one omits the field entirely, which is what the schema says and
  // what the no-replay-section case needs.
  if (priorRecord !== undefined) packet.priorRecord = priorRecord;
  // The two tips the zero-item decision compares beside `headOid`, defaulted to
  // that same commit so a zero-item fixture is the TERMINAL no-op unless a
  // scenario moves one — every no-op scenario written before the split keeps
  // meaning what it meant. `null` omits a field, which is what keeps the
  // record's not-recorded fallback and the split's fail-closed stop reachable.
  if (startingHead !== null) packet.pr.startingHead = startingHead;
  if (finalHead !== null) packet.pr.finalHead = finalHead;
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

// --- The empty-`items` exit: the skill's two zero-item outcomes (task 016a) --
// `address-review` step 3 ends a zero-item run two ways, and the item count
// alone cannot pick between them: a TERMINAL no-op only where `HEAD`, the tip
// the run started from, and the recorded `headRefOid` are all one commit, and
// the ZERO-ITEM PATH — the normal review and, unless `no-push`, publication —
// everywhere else, because that tip either carries work the PR head does not
// or moved under the run, and neither is a no-op to report. The
// scenarios here drive the DISCRIMINATING COMPARISON (one packet per tip moved,
// so a pairwise or item-count-only rewrite fails by name), the fail-closed stop
// on missing evidence, and the zero-item path through the pipeline it already
// has: rebase points, an empty-item cycle, and a publication that posts its
// Summary while having no item to reply to or resolve.
{
  const zi = { reconcile: { outcome: "work" }, startingHead: "beefed11", finalHead: "beefed11" };
  const CYCLE_PASS_EMPTY = {
    verdict: "pass",
    rounds: 1,
    workReport: [],
    openQuestions: [],
    deviations: [],
    proactive: "",
    finalSha: "beefed11",
    artifactDir: "/artifacts/pr-42-zero",
  };
  // The discriminating comparison, one moved tip at a time. All three agreeing
  // is the terminal no-op (pinned again above); each single disagreement must
  // continue, so a rewrite comparing only one pair — or none — fails here.
  const agreeing = await run(gathered({ reconcile: { outcome: "work" } }));
  check(
    "zero items with all three tips one commit is the terminal no-op, and its detail says so",
    agreeing.status === "no-op" && /terminal no-op/.test((agreeing.result || {}).detail || "") && /`deadbeef`/.test((agreeing.result || {}).detail || ""),
    JSON.stringify(agreeing.result),
  );
  const localAhead = await run(gathered(zi));
  check(
    "a zero-item run whose unchanged local tip is not the recorded PR head takes the zero-item path into the cycle",
    localAhead.status === "reached-cycle" && localAhead.seen.agentLabels.join(",") === "gather,rebase-pre-fix",
    `status: ${localAhead.status}; labels: ${localAhead.seen.agentLabels.join(",")}`,
  );
  check(
    "and hands that cycle an EMPTY item set rather than inventing work",
    localAhead.seen.cycleOpts && Array.isArray(localAhead.seen.cycleOpts.opts.scope.items) && localAhead.seen.cycleOpts.opts.scope.items.length === 0,
    JSON.stringify(localAhead.seen.cycleOpts && localAhead.seen.cycleOpts.opts.scope.items),
  );
  const movedUnder = await run(gathered({ reconcile: { outcome: "work" }, finalHead: "beefed11" }));
  const startedElsewhere = await run(gathered({ reconcile: { outcome: "work" }, startingHead: "beefed11" }));
  check(
    "the comparison is three-way: a run continues on EITHER local tip disagreeing alone, not only on final-vs-recorded",
    movedUnder.status === "reached-cycle" && startedElsewhere.status === "reached-cycle",
    `finalHead moved alone: ${movedUnder.status}; startingHead differing alone: ${startedElsewhere.status}`,
  );
  // Fail closed: the terminal exit is the one that says "nothing to address"
  // and reclaims the worktree, so it is never taken on tips nobody reported.
  const noFinal = await run(gathered({ reconcile: { outcome: "work" }, finalHead: null }));
  const noStart = await run(gathered({ reconcile: { outcome: "work" }, startingHead: null }));
  check(
    "a zero-item gather missing either local tip stops as a contract violation instead of exiting no-op on the item count",
    noFinal.status === "gather-contract" && noStart.status === "gather-contract" &&
      noFinal.seen.agentLabels.join(",") === "gather" && noStart.seen.agentLabels.join(",") === "gather",
    JSON.stringify({ noFinal: noFinal.status, noStart: noStart.status }),
  );
  // The terminal no-op still reclaims its worktree exactly as before the split,
  // and carries no zero-item record — its own detail is the account.
  const terminalWt = await run(gathered({ reconcile: { outcome: "work" }, locationMode: "worktree", worktree: WORKTREE_PATH }));
  check(
    "a terminal no-op in worktree mode still gives the worktree straight back",
    terminalWt.status === "no-op" && terminalWt.seen.reclaimPrompts.length === 1 &&
      terminalWt.result && terminalWt.result.worktreeReclaim && terminalWt.result.worktreeReclaim.removed === true &&
      terminalWt.result.zeroItem === undefined,
    JSON.stringify({ status: terminalWt.status, reclaims: terminalWt.seen.reclaimPrompts.length, zeroItem: terminalWt.result && terminalWt.result.zeroItem }),
  );
  // The zero-item path through the whole pipeline on a push run: both rebase
  // points, one empty-item cycle, and a publication whose brief has no item to
  // serve — so no reply and no resolve CAN be posted — while the Summary
  // comment still posts, which is the recorded answer to whether a zero-item
  // publication posts one at all (the completion gate requires its URL).
  const ziPublished = await run(gathered(zi), { args: "push", cycles: [CYCLE_PASS_EMPTY] });
  const ziPublishBrief = ziPublished.seen.publishPrompts[0] || "";
  check(
    "a zero-item push run runs both rebase points, one empty cycle, and publication, and publishes",
    ziPublished.status === "fixed-published" && ziPublished.seen.agentLabels.join(",") === "gather,rebase-pre-fix,rebase-pre-push,publish" && ziPublished.seen.cycleCalls.length === 1,
    JSON.stringify({ status: ziPublished.status, labels: ziPublished.seen.agentLabels }),
  );
  check(
    "and its result says which zero-item outcome it took and why — the tips beside the reason",
    ziPublished.result && ziPublished.result.zeroItem && ziPublished.result.zeroItem.outcome === "zero-item path" &&
      ziPublished.result.zeroItem.startingHead === "beefed11" && ziPublished.result.zeroItem.headOid === "deadbeef" &&
      /at gather time the tip stood at `beefed11` while the PR recorded `deadbeef`/.test(ziPublished.result.zeroItem.why || ""),
    JSON.stringify(ziPublished.result && ziPublished.result.zeroItem),
  );
  check(
    "its publish brief carries an EMPTY disposition list and the zero-item arm: Summary posts, no reply, no resolve, `threadOutcomes: []`",
    /## Dispositions to publish\n\n\[\]/.test(ziPublishBrief) && /ZERO-ITEM publication/.test(ziPublishBrief) &&
      /Summary comment STILL POSTS/.test(ziPublishBrief) && /post no reply and resolve no thread/.test(ziPublishBrief),
    ziPublishBrief ? `zero-item arm rendered: ${/ZERO-ITEM publication/.test(ziPublishBrief)}; empty dispositions: ${/## Dispositions to publish\n\n\[\]/.test(ziPublishBrief)}` : "no publish brief dispatched",
  );
  check(
    "and its fix brief orders the zero-item pass: nothing to triage, NO synthetic commit, an empty workReport",
    ziPublished.seen.cycleOpts && /ZERO work items/.test(ziPublished.seen.cycleOpts.opts.scope.instructions || "") &&
      /no synthetic commit/.test(ziPublished.seen.cycleOpts.opts.scope.instructions || "") &&
      /EMPTY `workReport`/.test(ziPublished.seen.cycleOpts.opts.scope.instructions || ""),
    ((ziPublished.seen.cycleOpts || {}).opts || { scope: {} }).scope.instructions ? "rendered without the zero-item paragraph" : "no cycle dispatched",
  );
  // The premise each zero-item brief states is the DISAGREEMENT that actually
  // continued the run, stated as the GATHER-TIME reading it is — never a claim
  // about what the push moved or which tip was reviewed. Those tips are read
  // before the rebase points, and a replaying rebase moves `HEAD` after them,
  // so any such claim derived from them can be false at publication time; two
  // review rounds punctured two differently-worded such sentences, so the pin
  // here is on the claim shape's ABSENCE beside the gather-time facts. The fix
  // brief embeds `zeroItem.why` and the publish brief re-reads the same
  // reported tips; the AHEAD case names both gather-time tips.
  const ziAheadInstructions = ((ziPublished.seen.cycleOpts || {}).opts || { scope: {} }).scope.instructions || "";
  check(
    "the zero-item briefs state the AHEAD disagreement as gather-time readings: both tips named, no push-motion or reviewed-tip claim",
    /at gather time the tip stood at `beefed11` while the PR recorded `deadbeef`/.test(ziAheadInstructions) &&
      /the local tip stood at `beefed11` while the PR recorded `deadbeef`/.test(ziPublishBrief) &&
      /naming those tips as the gather-time readings they are/.test(ziPublishBrief) &&
      /Do NOT assert from them what the push above moved or which tip was reviewed/.test(ziPublishBrief) &&
      !/push above publishes/.test(ziPublishBrief) && !/reviewed local tip/.test(ziPublishBrief),
    JSON.stringify({ fixPremiseNamesTips: /at gather time the tip stood at `beefed11` while the PR recorded `deadbeef`/.test(ziAheadInstructions), summaryArm: (ziPublishBrief.match(/ZERO-ITEM publication[^]{0,260}/) || [])[0] }),
  );
  check(
    "and the fix brief scopes its no-commit order to the pass — a later round's finding is fixed normally",
    /make NO commit of any kind in this pass/.test(ziAheadInstructions) &&
      /a finding a later round of this cycle hands you is fixed normally/.test(ziAheadInstructions),
    (ziAheadInstructions.match(/make NO commit[^—]*(—[^—]*)?/) || ["no no-commit order rendered"])[0],
  );
  // The MOVED-UNDER case, driven whole: `startingHead != finalHead == headOid`
  // continues — only a fresh review can vouch for a tip that moved under the
  // run — and both briefs state that gather-time move and nothing more: the
  // old "the push above had nothing new to move" was a push-motion claim a
  // replaying pre-push rebase falsifies, so its absence is pinned here beside
  // the ahead-claim's.
  const ziMoved = await run(gathered({ reconcile: { outcome: "work" }, startingHead: "beefed11" }), { args: "push", cycles: [{ ...CYCLE_PASS_EMPTY, finalSha: "deadbeef" }] });
  const ziMovedInstructions = ((ziMoved.seen.cycleOpts || {}).opts || { scope: {} }).scope.instructions || "";
  const ziMovedPublish = ziMoved.seen.publishPrompts[0] || "";
  check(
    "a moved-under zero-item run's fix brief premise is the moved tip, not the ahead case's tip-disagreement claim",
    ziMoved.status === "fixed-published" && /tip moved under this run/.test(ziMovedInstructions) &&
      !/while the PR recorded/.test(ziMovedInstructions),
    JSON.stringify({ status: ziMoved.status, premise: (ziMovedInstructions.match(/ZERO-ITEM PATH[^.]*/) || ["no zero-item paragraph rendered"])[0] }),
  );
  check(
    "and its Summary arm states the gather-time move — started elsewhere, gather ended on the recorded head — with no claim of what the push moved, while the Summary still posts",
    /at gather time the tip had moved under the run/.test(ziMovedPublish) &&
      /gather ended on the recorded PR head `deadbeef`/.test(ziMovedPublish) &&
      !/nothing new to move/.test(ziMovedPublish) && !/did not carry/.test(ziMovedPublish) &&
      /Do NOT assert from them what the push above moved or which tip was reviewed/.test(ziMovedPublish) &&
      /Summary comment STILL POSTS/.test(ziMovedPublish),
    JSON.stringify({ summaryArm: (ziMovedPublish.match(/ZERO-ITEM publication[^]{0,300}/) || ["no zero-item arm rendered"])[0] }),
  );
  // The same path local-only: `no-push` reviews the tip and stops, and the
  // empty map records NOTHING — `leaveDispositionRecord`'s no-entries rule is
  // the skill's "say so in the report rather than posting an empty record".
  const ziLocal = await run(gathered(zi), { args: "no-push", cycles: [CYCLE_PASS_EMPTY] });
  check(
    "a zero-item `no-push` run reviews the tip, finishes local-only, says which outcome it took, and posts no empty record",
    ziLocal.status === "fixed-local" && ziLocal.result && ziLocal.result.zeroItem && /zero-item path/.test(ziLocal.result.zeroItem.outcome) &&
      ziLocal.seen.recordPrompts.length === 0,
    JSON.stringify({ status: ziLocal.status, zeroItem: ziLocal.result && ziLocal.result.zeroItem, records: ziLocal.seen.recordPrompts.length }),
  );
  // `no-rebase` on the zero-item path: no rebase report will ever pin the
  // review base, so the gather's own resolved OID is consumed here exactly as
  // on an itemful `no-rebase` run — and its absence stops the run.
  const ziNoRebase = await run(gathered(zi), { args: "no-push no-rebase", cycles: [CYCLE_PASS_EMPTY] });
  check(
    "a `no-rebase` zero-item run pins the gather-resolved base OID as the cycle's review base",
    ziNoRebase.status === "fixed-local" && ziNoRebase.seen.cycleOpts && ziNoRebase.seen.cycleOpts.opts.base === GATHERED_BASE_OID,
    JSON.stringify({ status: ziNoRebase.status, base: ziNoRebase.seen.cycleOpts && ziNoRebase.seen.cycleOpts.opts.base }),
  );
  const ziNoRebaseUnpinned = await run(gathered({ ...zi, baseOid: null }), { args: "no-push no-rebase" });
  check(
    "and one whose gather resolved no base OID stops unpinned rather than delegating a movable name",
    ziNoRebaseUnpinned.status === "unpinned-base" && ziNoRebaseUnpinned.seen.cycleOpts === null,
    ziNoRebaseUnpinned.status,
  );
  // The producer half, which no scenario reaches: the gather brief must order
  // the three tips reported and state the two outcomes, or every check above
  // rides on fields no compliant gather ever populates.
  const brief = gatherPrompt("#42");
  const zeroPara = brief.split("\n").find((l) => l.includes("no unresolved threads and no included standalone item")) || "";
  check(
    "the gather brief's zero-item paragraph states the three-way comparison and both outcomes",
    /pr\.finalHead/.test(zeroPara) && /pr\.startingHead/.test(zeroPara) && /pr\.headOid/.test(zeroPara) &&
      /all three the same commit/.test(zeroPara) && /TERMINAL no-op/.test(zeroPara) && /ZERO-ITEM PATH/.test(zeroPara) &&
      /leaves no attested no-op to report/.test(zeroPara) && /cover either/.test(zeroPara),
    zeroPara ? zeroPara.slice(0, 200) : "the gather brief has no zero-item paragraph",
  );
  const finalPara = brief.split("\n").find((l) => l.includes("pr.finalHead") && l.includes("once more")) || "";
  check(
    "and orders `pr.finalHead` read in the working location as the gather's last read, on every ok packet",
    finalPara.includes("read \`git rev-parse HEAD\` in the working location once more") &&
      /report it as `pr\.finalHead`/.test(finalPara) && /on every packet you return with `ok: true`/.test(finalPara),
    finalPara ? finalPara.slice(0, 200) : "the gather brief never orders a final-HEAD read",
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

  // That fetch is the reconciliation's own, and it has to be. The location step
  // above fetches too, but it fetches in whatever tree the run STARTS in — the
  // worktree it may go on to attach does not exist yet. `FETCH_HEAD` does not
  // cross that boundary: Git keeps it in the per-worktree git dir, so
  // `git rev-parse --git-path FETCH_HEAD` in a linked worktree answers with
  // `.git/worktrees/<name>/FETCH_HEAD` and a freshly attached one has no such
  // file, where the read fails outright. So a brief offering the location step's
  // fetch as serving the reconciliation too supplies a reason to skip the fetch
  // the check above pins, at the gate that decides whether the branch may be
  // acted on at all. Pinned as the phrase's absence plus the fact's presence:
  // the first catches the clause returning in the words it was written in, the
  // second keeps the reason stated where the next reader meets it instead of
  // re-derived. Both are phrasing pins and claim no more — a fresh way of saying
  // "one fetch is enough" passes them, and polarity stays the reviewer's to hold.
  const servesBoth = /one fetch serves both/.test(brief);
  const statesPerWorktree = brief.includes("git rev-parse --git-path FETCH_HEAD");
  check(
    "and the location step's fetch is not offered as serving it too, the per-worktree `FETCH_HEAD` fact being stated instead",
    !servesBoth && statesPerWorktree,
    `offers one fetch for both: ${servesBoth}; states the per-worktree fact: ${statesPerWorktree}`,
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
    const rewindRule =
      "when both commits are available and the fetched OID is a proper ancestor of the `headRefOid` that `gh pr view` reported, block the entry for a maintainer decision without adopting the fetched OID";
    const unchangedCases =
      /Every other difference keeps the existing adoption rule:.*including an advance and a force-push whose reported OID was not downloaded/;
    const unread = [];
    const unphrased = [];
    const unclassifiedRewinds = [];
    const changedExistingCases = [];
    const inconsistentGuards = [];
    const gated = [];
    const probed = [];
    const paragraphs = new Map();
    const guards = new Map();
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
          paragraphs.set(`${mirror}/${skill}`, para);
          if (!/git rev-parse (?:--verify )?FETCH_HEAD/.test(para)) unread.push(`${path}'s rule paragraph does not read the fetched head`);
          if (!phrase.test(para)) unphrased.push(`${path} does not state ${phrase}`);
          if (!para.includes(rewindRule)) unclassifiedRewinds.push(`${path} does not state the fetched-behind-reported block`);
          if (!unchangedCases.test(para)) changedExistingCases.push(`${path} does not preserve advances and undownloaded force-pushes`);
          const probes = gatingProbes(para);
          if (probes.length) gated.push(`${path} runs ${probes.join(", ")}`);
        }
        if (skill === "address-reviews") {
          const guard = text.split("\n\n").find((p) => p.includes("**Remote-tip refresh guard** — the one rule"));
          if (!guard) {
            inconsistentGuards.push(`${path} has no Remote-tip refresh guard paragraph`);
          } else {
            guards.set(mirror, guard);
            const guardClauses = [
              "Before Phase A, where no cycle has recorded a head yet, use the `headRefOid` that `gh pr view` reported at setup as the earlier observation",
              "if the fetched tip is a proper ancestor of that available reported OID, block the entry for the same maintainer decision rather than recording it as replaceable",
              "Every other setup difference keeps the existing non-blocking behavior",
              "this includes a head which advanced during setup and an unavailable reported OID in the undownloaded-force-push case",
            ];
            const missingClauses = guardClauses.filter((clause) => !guard.includes(clause));
            if (missingClauses.length) inconsistentGuards.push(`${path}'s guard misses ${missingClauses.join("; ")}`);
          }
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
      "and both skills, in both mirrors, block a fetched tip behind the reported head as a maintainer rewind before adopting it",
      unclassifiedRewinds.length === 0,
      unclassifiedRewinds.join("; "),
    );
    check(
      "while every other setup difference still adopts the fetched tip, including advances and undownloaded force-pushes",
      changedExistingCases.length === 0,
      changedExistingCases.join("; "),
    );
    check(
      "and the batch guard uses the reported setup OID before Phase A to block that rewind while leaving advances and undownloaded force-pushes non-blocking",
      inconsistentGuards.length === 0,
      inconsistentGuards.join("; "),
    );
    const driftedParagraphs = ["address-review", "address-reviews"].filter(
      (skill) => paragraphs.get(`plugins/dev-skills/skills/${skill}`) !== paragraphs.get(`codex/dev-skills/skills/${skill}`),
    );
    if (guards.get("plugins/dev-skills/skills") !== guards.get("codex/dev-skills/skills")) driftedParagraphs.push("address-reviews guard");
    check(
      "and the corrected setup and guard paragraphs are identical in their Codex mirrors",
      driftedParagraphs.length === 0,
      `drifted: ${driftedParagraphs.join(", ")}`,
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
      /Report the token on every packet you return with `ok: true` that the caller can CONTINUE on/.test(src) &&
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
  const pinsOnlyAConsumedGather = /AFTER the gathering below/.test(basePara) && /NON-EMPTY/.test(basePara) && /terminal no-op the caller finishes before reading any base OID/.test(basePara) && /three tips[\s\S]*DISAGREE/.test(basePara);
  check(
    "and even the `no-rebase` rendering pins it only where the caller consumes it — a non-empty gather, or the zero-item path whose tips disagree — since a terminal no-op finishes before reading any base OID",
    pinsOnlyAConsumedGather,
    `pins only a consumed gather: ${pinsOnlyAConsumedGather}`,
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
  const offStop = off.indexOf(`aborted: "off-shoot does not carry the PR head: <both tips and the probe's commits>"`);
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
  const gate = off.split("\n").find((l) => l.includes(`aborted: "off-shoot does not carry the PR head: <both tips and the probe's commits>"`)) || "";
  const namesBothTips = /BOTH tips/.test(gate) && gate.includes("deadbeef") && /\bHEAD\b/.test(gate);
  const namesTheCommits = /every commit the probe printed/.test(gate);
  const refusesToReconcile = /Do NOT fast-forward, merge, rebase/.test(gate);
  check(
    "and that stop names both tips and the commits it saw, and reconciles nothing to make the push legal",
    namesBothTips && namesTheCommits && refusesToReconcile,
    `names both tips: ${namesBothTips}; names the commits: ${namesTheCommits}; refuses to reconcile: ${refusesToReconcile}`,
  );

  // The schema the publisher fills that field FROM, exactly as for the push
  // read-back's stop: an example list offering the bare literal offers
  // precisely the value the gate forbids for this stop, and a publisher that
  // takes it satisfies the abort while the tips and the probe's commits land
  // nowhere the caller can read.
  const offAbortedExample = PUBLISH_SCHEMA.properties.aborted.description;
  check(
    "and the schema it fills that field from offers this stop's appended form rather than its bare literal",
    /`off-shoot does not carry the PR head: <both tips and the probe's commits>`/.test(offAbortedExample) &&
      !/`off-shoot does not carry the PR head`/.test(offAbortedExample),
    (offAbortedExample.match(/`off-shoot does not carry[^`]*`/) || ["no example for this stop"])[0],
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
        "**Read context:** `gh pr view NUMBER --repo <owner>/<repo> --json",
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
        [
          /<!-- address-review:disposition-record -->/,
          /never by matching prose/,
          /update that comment in place/,
          /this run writes exactly one record/,
          // What the lookup matches decides which comment the update overwrites,
          // so the first-line test and the author filter are part of the rule
          // rather than of the recipe.
          /whose \*\*first line is exactly\*\* that marker/,
          /keep the authenticated-author filter/,
        ],
      ],
      [
        "every entry's field set, whatever its disposition",
        "**Every entry carries the same field set whatever its disposition**",
        [/the permalink \(the thread's, the standalone comment's url, or the lane's details URL\), and the reply body verbatim/, /written there once rather than in both slots/, /adding the committed file and its queued or deferred placement/],
      ],
      // Step 3's replay premise has to admit both routes a standalone item
      // arrives by, or the gathering step excludes a recorded misfired
      // finding before the replay bullet (pinned below) ever sees it.
      [
        "step 3's replay premise for a recorded standalone item",
        "- **Top-level review summaries** (`gh pr view --json reviews`)",
        [/an earlier run having gathered it — by the request that identified it or as a misfired finding that qualified on its own — and is what makes that entry replayable at all/],
      ],
      [
        "the recipe that finds it",
        "**The disposition record** — find a prior one by its marker",
        [/first line, byte for byte\*\*, never `contains`/, /would otherwise be selected and `PATCH`ed away/],
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
      // The rendering for the one case the canonical format cannot state as
      // written: once part of the map is on origin, `status: not published`
      // is false — while what the local-only line claims of the tips follows
      // the push rather than the map, false only where the remote moved or
      // already held the tips and still true where the map landed through the
      // API with no successful push — and a reader who believes the canonical
      // lines stops looking for the replies that never landed. Pinned
      // in the skill because the skill is where the format is defined once;
      // `recordPrompt` renders it and the exit matrix drives it. What "landed"
      // MEANS is pinned beside the rendering, because that is where it went
      // wrong twice: a push command running is not the remote moving, and the
      // per-thread account states END STATE rather than this run's own writes,
      // so what the record may call landed is what the PR CARRIES — which is the
      // reading that keeps a turn from re-posting a reply already there. The
      // paragraph's own ENTRY CONDITION is pinned with it, an opener selecting
      // on this run's own writes contradicting the rule its next sentence
      // states; and on the codex mirror, which no workflow renders, that opener
      // IS the contract an agent derives the rendering from.
      [
        "the part-way publication's rendering of that format",
        "**A publication that stopped part-way**",
        [
          /status: published in part/,
          /`status: not published` is false once part of the map is on origin/,
          /a map that landed through the API with no successful push/,
          /leaves the tips still LOCAL-ONLY/,
          // The surface the tips claim is attributed to: the replacement LINE
          // carries the clause, in the two states whose landed list cannot —
          // the renderer's side of the same fact is pinned where the rendered
          // record line is read, so the two cannot drift apart again.
          /so the line appends that the tips above are still LOCAL-ONLY/,
          /so the line appends that the tips above are already on origin/,
          /the one state that appends no tips clause, the landed list already saying it/,
          /reached origin: <what landed> — still outstanding: <what is left>/,
          /What counts as landed is what \*\*is on the PR\*\*, never what this run itself did/,
          /a reply an earlier run posted and a resolve already done are landed too/,
          /`Everything up-to-date` moved nothing/,
          /keeps its entry and its verbatim reply/,
          /reported no outcome for says that rather than guessing/,
        ],
      ],
      // The third state's ENTRY CONDITION, for the same reason the part-way
      // opener above is pinned and by the same mechanism: it is the one line an
      // agent decides from, and it drifted once already into "the run has
      // already mutated the PR" — which `claimsPRState` is not. That selector
      // reads END STATE, so a no-op push that moved nothing and an entry
      // reporting a reply a PRIOR run posted both satisfy it with this run
      // having written nothing; the record's own printed reason says so in the
      // words pinned here. The prose is the whole contract on the codex mirror,
      // where a reader who takes those two shapes for "not unknown" emits the
      // canonical rendering and asserts nothing reached origin over a reply the
      // PR is carrying.
      [
        "the third state's entry condition",
        "**A publication whose outcome is not known**",
        [/incomplete while the PR already carries part of this map/],
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
      "and the skill carries the same decisions in both mirrors, in the order that makes the stops reachable — the proper-ancestor stop and the off-shoot's gate ahead of both pushes, the PR's ref as the off-shoot's target with the fields both recipes resolve it from, the check that substitution excepts, and the disposition record's carve-out, marker, supersession, SHA/patch-id and part-way-publication rules",
      missing.length === 0,
      missing.join("; "),
    );
  }
}

// --- The GitHub-reliability recipes the publish brief renders inline ---------
// Task 023 put one authoritative recipe for each of five `gh`/API behaviors at
// the step that performs the operation, and scoped that to the skills. This
// workflow performs two of those operations from prose of its own — the push at
// step 2, the `--add-reviewer` request at step 6 — and its publisher has read no
// skill, so 023a renders both recipes into the brief rather than pointing at the
// section that authors them.
//
// That makes each one a SECOND copy of a settled wording, which is what is
// pinned here: the brief's clause, by the phrases that carry the instruction, and
// the SAME rules in both mirrors of the skill that owns them — so a recipe
// reworded on one side and not the other fails rather than drifting quietly. The
// two mirrors are hand-edited in lockstep with no generator, which is why both
// are read.
//
// The reads below are PHRASE pins and claim exactly as much as the phrases they
// select. Measured, not assumed: reversing a recipe's polarity while preserving
// every pinned phrase — "…is ordinarily fine and only ever is a stop where you
// already had reason to doubt the push" — passes every check here. A regex over
// prose cannot separate an instruction from its negation, which is the same hole
// the `FETCH_HEAD` pin comments below state of their own reads; what these catch is a side
// reworded, moved out of its step, or dropped, and the polarity stays the
// reviewer's to hold.
//
// What is NOT here is a third recipe. Item 5 (re-verify at publish boundaries)
// is already performed by the brief's own steps 1 and 3, so it is checked as
// PRESENCE OF THOSE STEPS rather than of a restatement: a copy of item 5 beside
// them is the text commit 390156a deliberately declined to write.
{
  const brief = publishPrompt(
    gathered({ reconcile: { outcome: "work" } }),
    [],
    { push: true, pingCopilot: true },
    [],
    [],
  );
  // The push's read-back, which the brief used to end without: `git push`
  // returning is not the ref having moved, and the API read that looks like
  // proof is the one this recipe rules out. Read from step 2's own segment, so a
  // clause that survives somewhere else in the brief does not answer for the
  // step that pushes; and required to sit AFTER the push instructions, since a
  // read-back stated before them confirms nothing.
  const step2 = brief.slice(brief.indexOf("2. Push."), brief.indexOf("3. Re-read unresolved threads"));
  const readBack = {
    "reads the ref itself": /confirm what actually LANDED against the ref itself/.test(step2),
    "refuses the PR API as the evidence": /rather than from `gh pr view --json headRefOid`/.test(step2),
    "names the per-URL ls-remote": /git ls-remote "<url>" refs\/heads\//.test(step2) && /git remote get-url --push --all <remote>/.test(step2),
    "requires every push URL": /require every one of them to come back with the HEAD you pushed/.test(step2),
    "treats silence as a stop": /exits 0 even when it prints nothing/.test(step2) && /is a stop rather than a pass/.test(step2),
    "stops rather than claiming publication": step2.includes('aborted: "push not confirmed at the ref'),
    // The per-URL evidence has exactly ONE channel, so the brief has to name it:
    // `aborted` is the only field `PUBLISH_SCHEMA` has for a stop's reason, the
    // caller quotes it verbatim as the record's reason, and that record's status
    // line is required to say what each push URL returned. Told merely to
    // "report" the evidence with no field named, a publisher satisfies the
    // literal abort and drops it, and the status line downstream has nothing to
    // say.
    "sends the per-URL evidence into that same field":
      step2.includes('aborted: "push not confirmed at the ref: <what each URL returned>"'),
    // The abort is the ONE fact the record and the run's result read to withhold
    // their origin claims, so the stop leaves the advance TO it: ordering
    // `pushedNewCommits: false` here would have the publisher assert the very fact
    // its read-back failed to establish — in the direction that claims less about
    // origin, but a claim either way.
    "leaves the advance to the abort rather than to a flag":
      /whether the ref MOVED is exactly the fact this read-back failed to establish/.test(step2) &&
      /do not set either flag to stand for it in either direction/.test(step2),
    "orders no boolean for the advance it could not establish": !/`pushedNewCommits: (?:true|false)`/.test(step2),
    "states it after the push": step2.indexOf("confirm what actually LANDED") > step2.indexOf("--force-with-lease="),
  };
  const readBackMissing = Object.entries(readBack).filter(([, ok]) => !ok).map(([what]) => what);
  check(
    "the publish brief verifies its push at the ref rather than through the PR API, after the push and before the replies",
    readBackMissing.length === 0,
    readBackMissing.join("; ") || `step 2 carries all ${Object.keys(readBack).length} clauses`,
  );

  // The third place that must agree with the step above: the schema the publisher
  // fills that field FROM. An example list offering the bare literal offers
  // precisely the value the step forbids for this stop, and a publisher that takes
  // it satisfies the abort while the record's status line is left with nothing to
  // say. The phrase is one shared constant across all three, so it cannot drift;
  // the evidence placeholder is written per site, so it is the half pinned here.
  const abortedExample = PUBLISH_SCHEMA.properties.aborted.description;
  check(
    "and the schema it fills that field from offers the appended form rather than the bare literal",
    /`push not confirmed at the ref: <what each URL returned>`/.test(abortedExample) &&
      !/`push not confirmed at the ref`/.test(abortedExample),
    (abortedExample.match(/`push not confirmed[^`]*`/) || ["no example for this stop"])[0],
  );

  // The reviewer request, whose confirmation the brief gave no instruction for at
  // all: the read that looks authoritative is empty on a request that succeeded,
  // so an agent left to its own devices re-issues a request that landed. Read
  // from the pings step, and only under the flag that orders the request.
  const step6 = brief.slice(brief.indexOf("6. Pings"));
  const confirmation = {
    "confirms from the timeline": /`review_requested` event in `gh api --paginate/.test(step6),
    "refuses the GraphQL read": /never from `gh pr view --json reviewRequests`/.test(step6) && /reads back empty on a request that succeeded/.test(step6),
    "says REST can confirm but not refute": /can confirm a request but never refute one/.test(step6),
    "matches by snapshot rather than by clock":
      /Snapshot the `id`s of the events naming that reviewer BEFORE issuing the request/.test(step6) &&
      /require one that is NOT in that snapshot/.test(step6) &&
      /matching by event id rather than against your own clock/.test(step6),
    "paginates both reads": /paginate BOTH reads/.test(step6),
    "an unconfirmed request neither fails nor re-issues":
      /do not fail publication, and do NOT issue the request again/.test(step6) && /requested, unconfirmed/.test(step6),
  };
  const confirmationMissing = Object.entries(confirmation).filter(([, ok]) => !ok).map(([what]) => what);
  check(
    "and confirms the Copilot reviewer request from the timeline, without re-issuing one it cannot confirm",
    confirmationMissing.length === 0,
    confirmationMissing.join("; ") || `step 6 carries all ${Object.keys(confirmation).length} clauses`,
  );

  // Conditional ARMS of this builder, rendered. The arms at risk are plain strings
  // inside the template literal, so a `${…}` written into one reaches the agent as
  // its own source text — which is how the confirmation above shipped, telling the
  // publisher to read `.../pulls/${packet.pr.number}/…`. One render answers only
  // for the arms that render, and each arm is a place the next one can hide, so
  // BOTH inputs that select an arm are driven: the flags, and — since no flag
  // reaches them — the packet's own `rebased` and worktree pair.
  //
  // What this sweep drives is the list below and nothing else: the three per-bot
  // pings, the none-requested arm, both flake-record arms, the deviation section
  // with and without its assessments, the lease bullet's `rebased: yes` (its `no`
  // twin renders in every other row), and the worktree working location. That is a
  // driven ENUMERATION rather than a claim over the builder: an arm added to
  // `publishPrompt` is covered once it is added here, and until then this check
  // says nothing about it.
  //
  // The `rebased` pair is the arm this sweep was missing, and it is this check's
  // own bug class: two plain quoted strings, of which only `no` rendered while
  // `true` is the ordinary state of any run whose pre-fix rebase replayed anything
  // (the caller replaces `pr.rebased` from that rebase's report). Measured: a
  // `${packet.pr.base}` planted in its `yes` arm reached the brief as source text
  // with every suite green.
  //
  // The worktree pair is driven because it is FREE, not because it is at risk:
  // both of its arms are template literals, so an interpolation written into
  // either renders normally and this class cannot reach it.
  const arms = {
    "the copilot arm": { flags: { push: true, pingCopilot: true }, args: [[], []] },
    "the codex and claude arms": { flags: { push: true, pingCodex: true, pingClaude: true }, args: [[], []] },
    "no ping requested": { flags: { push: true }, args: [[], []] },
    "a deviation with its assessment": {
      flags: { push: true, pingClaude: true },
      args: [[{ decision: "d1", what: "renamed the flag" }], [{ decision: "d1", inSpecRoute: "keep the name", recommendation: "conform" }]],
    },
    "a deviation with no assessment, and both flake records": {
      flags: { push: true },
      args: [
        [{ decision: "d1", what: "renamed the flag" }],
        [],
        { note: "a flaky storage probe", range: "abc1234..def5678", verified: "range re-run clean" },
        { note: "the same probe before the rebase" },
      ],
    },
    "a branch this run rebased": { flags: { push: true }, args: [[], []], packet: { rebased: true } },
    "a worktree working location": { flags: { push: true }, args: [[], []], packet: { locationMode: "worktree", worktree: "/w/.worktrees/c/pr-42" } },
  };
  // `DESTROY_BOUNDARY` (task 018) carries one legitimate `${…}`-shaped span of
  // its own — the guarded-`cd` bash form `${DC:?dc-enter returned no path — see its error above; if it is not installed, install it from the dev-skills plugin bin/}` — and
  // every arm renders it via the shared boundary text, so it is excluded by name
  // rather than narrowing the scan: the scan's job is catching a builder
  // interpolation this template failed to resolve, not a bash parameter
  // expansion the boundary text states on purpose.
  const KNOWN_LITERAL_SPANS = ["${DC:?dc-enter returned no path — see its error above; if it is not installed, install it from the dev-skills plugin bin/}"];
  const unrendered = [];
  const rendered = {};
  for (const [what, { flags, args, packet }] of Object.entries(arms)) {
    rendered[what] = publishPrompt(gathered({ reconcile: { outcome: "work" }, ...packet }), [], flags, ...args);
    const hits = rendered[what].match(/\$\{[^}]*\}/g) || [];
    const hit = hits.find((h) => !KNOWN_LITERAL_SPANS.includes(h));
    if (hit) unrendered.push(`${what}: ${hit}`);
  }
  // Driven arms are only coverage while they still SELECT what they were added
  // for, and the two packet-driven rows are selected by packet fields a rename or a
  // dropped override would silently take away — leaving two rows rendering the same
  // arms as the rows above them and a check reading as broader than it is. Read out
  // of the rows the sweep actually drove, not from renders repeated here, which
  // would answer for their own inputs rather than for the sweep's.
  const selected = {
    "the `rebased: yes` arm": /\(rebased: yes\)/.test(rendered["a branch this run rebased"] || ""),
    "the worktree arm": /Your working location is the worktree `\/w\/\.worktrees\/c\/pr-42`/.test(rendered["a worktree working location"] || ""),
  };
  const unselected = Object.entries(selected).filter(([, ok]) => !ok).map(([what]) => what);
  check(
    "and the publish brief renders every arm this sweep drives — the ping combinations, both deviation and flake shapes, and the packet-driven `rebased: yes` and worktree arms — leaving no builder interpolation in the text the agent reads",
    unrendered.length === 0 && unselected.length === 0,
    [unrendered.join("; "), unselected.length ? `no row selects ${unselected.join(", ")}` : ""].filter(Boolean).join("; ") ||
      `all ${Object.keys(arms).length} rows render clean, and the two packet-driven rows select the arms they were added for`,
  );

  // Item 5, satisfied by the steps rather than by a copy of it. Both halves are
  // pinned positively, because "no restatement here" is only the right answer
  // while the steps themselves still do it.
  const step1 = brief.slice(brief.indexOf("1. Re-check before publication"), brief.indexOf("2. Push."));
  const reVerified =
    /re-fetch the PR and confirm it is still open/.test(step1) &&
    /Re-read unresolved threads after the push/.test(brief);
  check(
    "and re-verifies the PR at the publish boundary through its own steps, needing no fourth copy of that rule",
    reVerified,
    `step 1 re-fetches: ${/re-fetch the PR and confirm it is still open/.test(step1)}; step 3 re-reads: ${/Re-read unresolved threads after the push/.test(brief)}`,
  );

  // And the sections that AUTHOR both recipes, in both mirrors: the brief is a
  // rendering of them, so a rule that lives only in the brief is a rule the next
  // reader of the skill contradicts, and one reworded only in the skill leaves
  // the workflow's copy stating superseded wording. Anchored to the sentence that
  // carries each rule, so a rewrite keeping the paragraph and dropping the rule
  // fails rather than passing on the file's other mentions of `ls-remote` or
  // `--add-reviewer`.
  const wanted = [
    [
      "the push read-back",
      "confirm what actually landed against the ref itself",
      [
        /rather than `gh pr view --json headRefOid`/,
        /for each URL `git remote get-url --push --all <remote>` lists/,
        /exits 0 even when it prints nothing/,
      ],
    ],
    [
      "the reviewer-request confirmation",
      "**Confirm the request from the timeline, never from `gh pr view --json reviewRequests`:**",
      [
        /the durable evidence is a `review_requested` event/,
        /snapshot the `id`s of the events naming the intended reviewer/,
        /Compare by event id, never against your own clock/,
        /Paginate \*\*both\*\* reads/,
        /do not fail the run, and do not issue this one again/,
      ],
    ],
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
    for (const [what, anchor, phrases] of wanted) {
      const line = text.split("\n").find((l) => l.includes(anchor));
      if (!line) {
        missing.push(`${path} states nothing for ${what}`);
        continue;
      }
      for (const phrase of phrases) if (!phrase.test(line)) missing.push(`${path}'s ${what} does not state ${phrase}`);
    }
  }
  check(
    "and both mirrors of the skill still author those two recipes — the ref read-back and the timeline confirmation — that the brief renders",
    missing.length === 0,
    missing.join("; "),
  );
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
  // The other side of that guard, and the reason it sits where it does: a
  // TERMINAL no-op — a zero-item gather whose three tips agree — owes no echo,
  // because that exit runs ahead of the guard and finishes the run before
  // anything reads the field. Driven, because every other fixture carries
  // `rebaseTarget` and so a guard hoisted ahead of that exit would turn this
  // legitimate no-op into a stop with the whole suite still green.
  const emptyWithoutEcho = await run({ ...gathered({ reconcile: { outcome: "work" } }), rebaseTarget: undefined });
  check(
    "but a terminal-no-op gather owes no echo — that exit finishes ahead of the guard rather than stopping on it",
    emptyWithoutEcho.result && emptyWithoutEcho.result.status === "no-op",
    `status: ${emptyWithoutEcho.result && emptyWithoutEcho.result.status}`,
  );
  // The ZERO-ITEM PATH is the other zero-item outcome, and it does owe the
  // echo: it continues to both rebase points, so an omitted token there is the
  // same silent wrong boundary an itemful run's is.
  const zeroItemWithoutEcho = await run({ ...gathered({ reconcile: { outcome: "work" }, startingHead: "beefed11", finalHead: "beefed11" }), rebaseTarget: undefined });
  check(
    "while a zero-item packet the run CONTINUES on owes it — an omitted echo stops the zero-item path exactly as it stops an itemful run",
    zeroItemWithoutEcho.result && zeroItemWithoutEcho.result.status === "gather-contract" && zeroItemWithoutEcho.seen.rebasePrompts.length === 0,
    `status: ${zeroItemWithoutEcho.result && zeroItemWithoutEcho.result.status}; rebase briefs dispatched: ${zeroItemWithoutEcho.seen.rebasePrompts.length}`,
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
  // The deviations standing when the rebase happened travel the same way, and to
  // the same two roles. The second cycle's own deviation set starts EMPTY, so a
  // deviation this list does not carry is in front of nobody: the fixer
  // `review-cycle` orders to restate every standing one has nothing to restate,
  // and the reviewer whose round owns the in-spec-route judgment and the
  // RATIFY/CONFORM verdict for the tree being pushed never sees the deviation it
  // is judging. Each role is checked for the duty only it has — restating
  // verbatim, and refusing an unrestated carry — since a block that reached one
  // of them alone leaves the other unable to do its half.
  check(
    "and hands both roles the deviations standing when the rebase happened — the fixer to restate verbatim, the reviewer as its drop baseline",
    !!second &&
      second.instructions.includes(DEVIATION) &&
      second.reviewInstructions.includes(DEVIATION) &&
      /VERBATIM/.test(second.instructions) &&
      /CLAIMED DROP/.test(second.reviewInstructions),
    JSON.stringify({
      fixerShown: !!second && second.instructions.includes(DEVIATION),
      fixerToldToRestate: !!second && /VERBATIM/.test(second.instructions),
      reviewerShown: !!second && second.reviewInstructions.includes(DEVIATION),
      reviewerToldItIsADropClaim: !!second && /CLAIMED DROP/.test(second.reviewInstructions),
    }),
  );
  // The protocol those blocks order, pinned as the clauses that close the hole a
  // brief telling the fixer to LEAVE OUT a resolved carry would reopen: the
  // merge below reads a resolution out of the second cycle's per-pass record,
  // and an omitted carry is in no record, so the only readable resolution is
  // restate-first-then-drop. The fixer's side orders exactly that; a wording
  // that reverts to "leave one out where the replay closed it" fails here by
  // name, because that instruction produces the unreadable shape.
  check(
    "and the fixer's carry brief orders restate-first: every carry restated on the FIRST pass, a replay-resolution claimed by a later pass's drop, never by omission",
    !!second &&
      /Restate EVERY one of them in your `deviations` on your FIRST pass/.test(second.instructions) &&
      /including any you believe the replay resolved/.test(second.instructions) &&
      /Do NOT claim a resolution by leaving one out/.test(second.instructions) &&
      /stop restating it on a later pass/.test(second.instructions),
    JSON.stringify({
      restateFirst: !!second && /Restate EVERY one of them in your `deviations` on your FIRST pass/.test(second.instructions),
      resolvedIncluded: !!second && /including any you believe the replay resolved/.test(second.instructions),
      omissionForbidden: !!second && /Do NOT claim a resolution by leaving one out/.test(second.instructions),
      dropOnALaterPass: !!second && /stop restating it on a later pass/.test(second.instructions),
    }),
  );
  // And the reviewer's side of the same protocol: an unrestated carry is a claim
  // the cycle has no channel to record — no verdict can drop it, the merge folds
  // it forward regardless — so the duty is refusal (require the restatement),
  // never adjudicating an omission whose acceptance would settle nothing. The
  // round-1 wording, "passing this round is what drops it", was FALSE for
  // exactly this path, which is what these clauses replace.
  check(
    "and the reviewer's carry brief calls an unrestated carry a claim the cycle has no channel to record, requiring the restatement rather than adjudicating the omission",
    !!second &&
      /no channel to record/.test(second.reviewInstructions) &&
      /no verdict of yours can drop it/.test(second.reviewInstructions) &&
      /Require the restatement as a blocking issue/.test(second.reviewInstructions),
    JSON.stringify({
      noChannel: !!second && /no channel to record/.test(second.reviewInstructions),
      noVerdictDrops: !!second && /no verdict of yours can drop it/.test(second.reviewInstructions),
      restatementRequired: !!second && /Require the restatement as a blocking issue/.test(second.reviewInstructions),
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
  // Now that the carried set reaches the re-verification, the union is no longer
  // the whole rule: a deviation the replay RESOLVED has to be able to leave,
  // rather than being folded forward forever under a judgment formed against the
  // base the replay moved off. What licenses that is the second cycle's own
  // per-pass record — `wf-review-cycle` drops a deviation only once a round
  // PASSED with the claim in view — so a deviation its history shows it taking up
  // and its final set no longer carrying was resolved over the rebased tree, and
  // the stale earlier assessment goes with it rather than being published beside
  // a deviation that no longer stands.
  const resolvedRun = await run(gathered(withWork), {
    cycles: [CYCLE_PASS, CYCLE_REVERIFIED_RESOLVED],
    rebases: { "pre-fix": REBASE_NOOP, "pre-push": REBASE_REPLAY },
  });
  const res = resolvedRun.result || {};
  check(
    "a carried deviation the re-verification took up and then dropped leaves the merged set, taking its stale assessment with it",
    resolvedRun.status === "fixed-local" &&
      JSON.stringify(res.deviations || []) === "[]" &&
      (res.deviationAssessments || []).length === 0,
    JSON.stringify({ status: resolvedRun.status, deviations: res.deviations, assessments: res.deviationAssessments }),
  );
  // And the half that keeps the merge conservative, which is the same absence
  // read against a different record: a re-verification that kept a per-pass
  // record and never restated the carried deviation at all never took it up, so
  // its absence is SILENCE and not a judgment. `review-cycle` forbids a deviation
  // vanishing with a loop's last turn and forbids one reaching the maintainer
  // carrying only the implementer's half, so it keeps standing WITH the
  // pre-rebase round's assessment. Without this pair, "the second cycle's set
  // wins" would drop every deviation a re-verification simply failed to mention.
  const dev = (dr.deviations || []).indexOf(DEVIATION);
  const keptAssessment = (dr.deviationAssessments || []).find((a) => a && a.deviation === DEVIATION);
  check(
    "while one it never restated is silence, not a drop: it keeps standing, still carrying the pre-rebase round's assessment",
    dev === 0 && !!keptAssessment && keptAssessment.recommendation === CYCLE_PASS.deviationAssessments[0].recommendation,
    JSON.stringify({ index: dev, assessment: keptAssessment, history: (dr.deviationHistory || []).map((h) => h && h.deviations) }),
  );
  // The same silence with the story that makes the fixer brief's restate-first
  // order load-bearing rather than pedantry: the replay GENUINELY resolved the
  // carried deviation, and the fixer claimed that by omission — never restating
  // it — instead of through the ordered restate-then-drop. `wf-review-cycle`
  // sets `deviationHistory` only once some pass reported a deviation, so a fixer
  // that omitted the carry and stated nothing of its own returns a result with
  // no history at all — the `replayed` run's second cycle is exactly that shape —
  // and the merge cannot tell this story from a cycle that never saw the
  // deviation. It reads silence, and the deviation folds forward still standing
  // under the stale pre-rebase assessment: conservative in the direction that
  // matters (noise — one more report with a stale judgment beside it — never
  // loss), and the cost the brief's restate-first order exists to keep an
  // ordinary run from paying.
  const or = replayed.result || {};
  const omittedAssessment = (or.deviationAssessments || []).find((a) => a && a.deviation === DEVIATION);
  check(
    "a carry the replay resolved but the fixer omitted outright never enters the record, so it folds forward still standing with the stale assessment — the shape the restate-first order exists to prevent",
    !(or.deviationHistory || []).some((h) => h && Array.isArray(h.deviations) && h.deviations.includes(DEVIATION)) &&
      JSON.stringify(or.deviations) === JSON.stringify([DEVIATION]) &&
      !!omittedAssessment &&
      omittedAssessment.recommendation === CYCLE_PASS.deviationAssessments[0].recommendation,
    JSON.stringify({ deviations: or.deviations, assessment: omittedAssessment, history: (or.deviationHistory || []).map((h) => h && h.deviations) }),
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
  // The correction's OTHER branch: a record that already names no post-run commit
  // is returned untouched, since there is nothing about it the re-verification
  // falsified. Its output is byte-identical either way — correcting an empty
  // `range`/`verified` pair to empty changes no value — so a value comparison
  // cannot see the difference and the pin is object IDENTITY: the untouched
  // branch hands back the record it was given, and a correction that ran
  // unconditionally hands back a copy. The record travels by reference from the
  // merge to the result, so that is observable here.
  const noCommit = await run(gathered(withWork), {
    cycles: [CYCLE_PASS_NO_COMMIT_RECORD, CYCLE_REVERIFIED],
    rebases: { "pre-fix": REBASE_NOOP, "pre-push": REBASE_REPLAY },
  });
  check(
    "a superseded record that already names no post-run commit is carried through untouched rather than re-corrected",
    (noCommit.result || {}).preRebaseRecordOnly === NO_COMMIT_FLAKE_RECORD,
    JSON.stringify({ record: (noCommit.result || {}).preRebaseRecordOnly, sameObject: (noCommit.result || {}).preRebaseRecordOnly === NO_COMMIT_FLAKE_RECORD }),
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
    // This file's frontmatter `description` is what the harness loads the skill
    // by, and nothing else here measures it, so the next clause anyone appends
    // would break loading with the suite green. The cap is 1024; the margin is what
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

// --- The disposition record, on every exit that does not publish in full -----
// Step 8's report is chat output, so an unpublished run's map — which thread was
// pushed back, what the drafted rationale said — died with the session. It now
// goes to the PR as one comment, and WHICH exits leave it is script logic, so
// the failure mode worth testing is an exit that holds a map, does not publish
// it, and records nothing. Every such exit is driven here, including the three
// that no computed reason can reach: the pre-push rebase's stops and an
// exhausted re-verification budget, both AHEAD of that computation, and a
// publication that did not complete, PAST it.
// The published exit is tested from the other side: it must record NOTHING,
// because its replies, resolves and Summary comment are the durable record there
// and a record beside them would say "not published" of published work.
{
  const withWork = { reconcile: { outcome: "work" }, items: [ITEM] };
  // A second gathered thread on the SAME line by the SAME author — what a
  // re-review round ordinarily leaves behind — so the two dispositions below
  // share a `ref` and are told apart only by `threadId`.
  // `authorIsBot` true while the login stays `a-reviewer`: publication compares
  // the echoed flag against this item, and the flag alone — never the login —
  // decides whether a push-back may be resolved. Keeping the login is what lets
  // the two entries go on sharing a `ref`.
  const ITEM_2 = { ...ITEM, threadId: "T2", commentId: "C2", authorIsBot: true, body: "a second finding on the same line", url: "https://example.invalid/pr/42#d2" };
  const withTwo = { reconcile: { outcome: "work" }, items: [ITEM, ITEM_2] };
  const CYCLE_PASS_TWO = {
    ...CYCLE_PASS,
    workReport: [
      CYCLE_PASS.workReport[0],
      {
        ...CYCLE_PASS.workReport[0],
        threadId: "T2",
        commentId: "C2",
        url: "https://example.invalid/pr/42#d2",
        kind: "push-back",
        // A BOT thread, so this push-back is one publication genuinely still
        // owes a resolve on — step 7 resolves a push-back exactly there. The
        // login is left alone on purpose: `authorIsBot` is the flag both the
        // brief and the debt count read, never a guess from the name, and
        // keeping the login means the two entries still share a `ref` so the
        // standing lines can only be told apart by `threadId`.
        authorIsBot: true,
        detail: "the guard is deliberate; the same line was re-raised without new grounds",
        newFinding: false,
      },
    ],
  };
  // A gathered STANDALONE item and a thread the run left ambiguous — the two
  // kinds step 4 of the publish brief never replies to, and never resolves. Both
  // carry `replied: false` on a genuinely COMPLETE publication, so a record that
  // counts them as debt tells the replay turn to post what the brief forbids: a
  // thread reply for an item with no thread, and a reply on a thread this run
  // deliberately left silent and open.
  const ITEM_STANDALONE = {
    type: "standalone",
    author: "a-maintainer",
    authorIsBot: false,
    body: "a decision comment the request named as outstanding",
    url: "https://example.invalid/pr/42#issuecomment-3",
  };
  const ITEM_3 = { ...ITEM, threadId: "T3", commentId: "C3", body: "a third finding", url: "https://example.invalid/pr/42#d3" };
  const withPolicyKinds = { reconcile: { outcome: "work" }, items: [ITEM, ITEM_STANDALONE, ITEM_3] };
  const CYCLE_PASS_POLICY_KINDS = {
    ...CYCLE_PASS,
    workReport: [
      CYCLE_PASS.workReport[0],
      {
        type: "standalone",
        url: "https://example.invalid/pr/42#issuecomment-3",
        ref: "issue comment a-maintainer",
        kind: "actionable-fixed",
        detail: "folded into the Summary comment, which is where a standalone item is addressed",
        author: "a-maintainer",
        authorIsBot: false,
        newFinding: true,
      },
      {
        ...CYCLE_PASS.workReport[0],
        threadId: "T3",
        commentId: "C3",
        url: "https://example.invalid/pr/42#d3",
        ref: "src/app.ts:31 a-reviewer",
        kind: "ambiguous-skipped",
        detail: "needs a call on which of the two contracts wins; left open",
        newFinding: false,
      },
    ],
  };
  // The publication that stops after replying to the one thread it owes a reply
  // to. Its account is COMPLETE — one entry per disposition — and the two
  // policy-ineligible entries are `replied: false` because nothing was ever owed
  // on them, not because anything failed.
  const PUBLISH_PART_WAY_POLICY_KINDS = {
    published: false,
    pushed: true,
    pushedNewCommits: true,
    aborted: "thread T1 was replied to and resolved, then posting the Summary comment failed with a 502",
    summaryCommentUrl: "",
    threadOutcomes: [
      { ref: "src/app.ts:12 a-reviewer", threadId: "T1", outcome: "replied and resolved", replied: true, resolved: true },
      { ref: "issue comment a-maintainer", url: "https://example.invalid/pr/42#issuecomment-3", outcome: "Summary-only; no thread to reply to", replied: false, resolved: false },
      { ref: "src/app.ts:31 a-reviewer", threadId: "T3", outcome: "left open, per its disposition", replied: false, resolved: false },
    ],
  };
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
  // The same abort on a PR that already carries a record. Superseding is a
  // `PATCH` in place, so writing this run's known-incomplete map over that
  // comment destroys the entry it holds for the item this map leaves uncovered
  // — the one durable copy of a previous run's judgment and drafted reply.
  const PRIOR_RECORD = {
    url: "https://example.invalid/pr/42#issuecomment-9",
    body: "<!-- address-review:disposition-record -->\n# address-review packet — PR #42 (feature/x)\nstatus: not published (a local-only run)\n",
  };
  const withPrior = { reconcile: { outcome: "work" }, items: [ITEM], priorRecord: PRIOR_RECORD };
  // The OTHER two shapes of the same incompleteness, each COVERING the gathered
  // item while being exactly what publication cannot act on: two entries naming
  // the same thread, and one entry rejected as unpublishable. In both, the
  // item's identity IS carried by a disposition — so the carry step's base
  // predicate ("no disposition below carries it") would skip the prior record's
  // entry for it, stranding the one durable copy of a judged reply behind a
  // doubled or unusable account. The brief must name those identities as
  // compromised and have the prior entry carried anyway.
  const CYCLE_DOUBLED = {
    ...CYCLE_PASS,
    workReport: [
      CYCLE_PASS.workReport[0],
      { ...CYCLE_PASS.workReport[0], kind: "push-back", detail: "the guard is deliberate; the same line was re-raised without new grounds" },
    ],
  };
  const CYCLE_DEFECT = {
    ...CYCLE_PASS,
    workReport: [{ ...CYCLE_PASS.workReport[0], detail: "" }],
  };
  // And the CONTROL for the compromised clause: an incompleteness that is ONLY
  // an uncovered item, beside a disposition that is clean — no identity is
  // compromised, since an uncovered item's prior entry is one the base
  // predicate already carries, so the clause must not render.
  const withTwoPrior = { reconcile: { outcome: "work" }, items: [ITEM, ITEM_2], priorRecord: PRIOR_RECORD };
  // The OTHER kind that turns on the thread rather than on the kind, and the one
  // the fixture above omits: step 7 resolves a push-back or a deferral only on a
  // BOT thread and leaves the human one open unless the maintainer explicitly
  // authorized otherwise. So an unresolved human push-back and an unresolved
  // human deferral are policy on a complete publication, while the bot
  // push-back beside them genuinely still owes its resolve — which is what makes
  // the count observable in both directions rather than merely small.
  const ITEM_4 = { ...ITEM, threadId: "T4", commentId: "C4", body: "a fourth finding", url: "https://example.invalid/pr/42#d4" };
  const ITEM_5 = { ...ITEM, threadId: "T5", commentId: "C5", body: "a fifth finding", url: "https://example.invalid/pr/42#d5" };
  const ITEM_6 = { ...ITEM, threadId: "T6", commentId: "C6", author: "a-bot", authorIsBot: true, body: "a sixth finding", url: "https://example.invalid/pr/42#d6" };
  // And the branch of that policy the three above do not reach: step 4 resolves a
  // human deferral where the deferral was MAINTAINER-DIRECTED, so this is a
  // human thread publication does owe a resolve on — and the caller cannot know
  // it, the direction living in the disposition's `detail` prose rather than in a
  // field. It is therefore out of the resolve count like its agent-proposed
  // sibling above, which is the declined half of the peer's finding: the run
  // still publishes over `resolved: false` here, and the record still tells the
  // next turn the resolve turns on that authorization rather than that one is
  // owed. Driven rather than argued, so whichever way a later round decides it,
  // the decision is visible.
  const ITEM_7 = { ...ITEM, threadId: "T7", commentId: "C7", body: "a seventh finding", url: "https://example.invalid/pr/42#d7" };
  const withPolicyResolves = { reconcile: { outcome: "work" }, items: [ITEM_4, ITEM_5, ITEM_6, ITEM_7] };
  // The same packet with the work happening in an attached WORKTREE, which is
  // the only mode that reclaims one. Rows asserting that a refused completion
  // KEEPS the tree, and that a prescribed one gives it back, run through this:
  // in `inline` mode nothing is ever reclaimed, so those assertions hold for a
  // reason that has nothing to do with the gate under test.
  const inWorktree = (o) => ({ ...o, locationMode: "worktree", worktree: WORKTREE_PATH });
  const CYCLE_PASS_POLICY_RESOLVES = {
    ...CYCLE_PASS,
    workReport: [
      {
        ...CYCLE_PASS.workReport[0],
        threadId: "T4",
        commentId: "C4",
        url: "https://example.invalid/pr/42#d4",
        ref: "src/app.ts:12 a-reviewer",
        kind: "push-back",
        detail: "the guard is deliberate; declined with the rationale drafted below",
        authorIsBot: false,
        newFinding: false,
      },
      {
        ...CYCLE_PASS.workReport[0],
        threadId: "T5",
        commentId: "C5",
        url: "https://example.invalid/pr/42#d5",
        ref: "src/app.ts:20 a-reviewer",
        kind: "deferred-to-task",
        detail: "queued as tasks/099x-something.md; agent-proposed, so the thread stays open",
        authorIsBot: false,
        newFinding: false,
      },
      {
        ...CYCLE_PASS.workReport[0],
        threadId: "T6",
        commentId: "C6",
        url: "https://example.invalid/pr/42#d6",
        ref: "src/app.ts:31 a-bot",
        kind: "push-back",
        author: "a-bot",
        authorIsBot: true,
        detail: "the bot re-raised a settled point; declined, and a bot thread IS resolved",
        newFinding: false,
      },
      {
        ...CYCLE_PASS.workReport[0],
        threadId: "T7",
        commentId: "C7",
        url: "https://example.invalid/pr/42#d7",
        ref: "src/app.ts:44 a-reviewer",
        kind: "deferred-to-task",
        detail: "queued as tasks/099y-something.md; MAINTAINER-DIRECTED, so step 4 resolves this human thread",
        authorIsBot: false,
        newFinding: false,
      },
    ],
  };
  // Every reply landed and no resolve did, so the reply half is silent and the
  // resolve half is the only thing the outstanding line can be wrong about.
  const PUBLISH_PART_WAY_POLICY_RESOLVES = {
    published: false,
    pushed: true,
    pushedNewCommits: true,
    aborted: "all three replies landed, then resolving thread T6 failed with a 502",
    summaryCommentUrl: "",
    threadOutcomes: [
      { ref: "src/app.ts:12 a-reviewer", threadId: "T4", outcome: "replied; left open per policy", replied: true, resolved: false },
      { ref: "src/app.ts:20 a-reviewer", threadId: "T5", outcome: "replied; left open per policy", replied: true, resolved: false },
      { ref: "src/app.ts:31 a-bot", threadId: "T6", outcome: "replied; resolve rejected with a 502", replied: true, resolved: false },
      { ref: "src/app.ts:44 a-reviewer", threadId: "T7", outcome: "replied; the maintainer-directed resolve was rejected with a 502 too", replied: true, resolved: false },
    ],
  };
  // A cycle that reported an ERROR instead of a verdict, holding a nonempty map
  // no reviewer ever passed. `workReportReviewed: false` is the cycle's own
  // answer to that, and it is stated rather than omitted: the field is what the
  // exemption keys on, so a fixture leaving it out would exercise a shape the
  // cycle never returns.
  const CYCLE_ERROR = { ...CYCLE_PASS, verdict: "error", workReportReviewed: false, detail: "the review cycle harness returned no verdict" };
  // The SAME error verdict over a map a reviewer round DID pass: `wf-review-cycle`
  // sets `confirming` only after a round passed, so a confirmation pass that
  // stops the cycle leaves exactly this shape — an `error` beside the map that
  // just passed review. The old exemption, keyed on the exit rather than on the
  // fact, dropped it.
  const CYCLE_ERROR_REVIEWED = {
    ...CYCLE_ERROR,
    workReportReviewed: true,
    detail: "the final confirmation pass returned nothing on pass 4",
  };
  // The same shape with the TREE MOVED under the map that passed. A pass packet
  // is adopted only after the cycle accepts it, while the working location's
  // HEAD moves the moment that pass COMMITS — so a pass that commits and is then
  // rejected (returning nothing, blocking, coming back unclean) leaves the
  // cycle's `finalSha` at the reviewed tip while `git rev-parse HEAD` prints a
  // later one. `carried` therefore has to CITE the reported tip exactly as
  // `replaced` does: reading it in the working location would cite a tree no
  // reviewer passed, and the recorded commits all being its ancestors, the next
  // run's replay probe prints nothing and the record reads as replaying as
  // written. The distinct SHA is what makes the citation observable at all.
  const CYCLE_ERROR_REVIEWED_MOVED = {
    ...CYCLE_ERROR_REVIEWED,
    finalSha: "0ddba11",
    detail: "the pass after the one that passed committed its fix and then blocked, so its packet was never adopted",
  };
  // The re-verification erroring, with a map of its OWN — distinguishable from
  // the pre-rebase cycle's, so "the merged report is the failed
  // re-verification's" is observable rather than asserted.
  const CYCLE_REVERIFIED_ERROR = {
    ...CYCLE_REVERIFIED,
    verdict: "error",
    workReportReviewed: false,
    detail: "the reviewer harness died mid-round",
    workReport: [{ ...CYCLE_PASS.workReport[0], detail: "re-triaged after the replay, and the round never finished" }],
  };
  // And the same re-verification stopped by its own confirmation pass, so ITS
  // map carries a passing round's verdict over the rebased tree.
  const CYCLE_REVERIFIED_ERROR_REVIEWED = {
    ...CYCLE_REVERIFIED_ERROR,
    workReportReviewed: true,
    detail: "the post-rebase confirmation pass came back on an unclean worktree",
  };
  // The pre-push rebase halting on a conflict it cannot judge: the map has
  // passed review, and the abort left the tree that verdict describes.
  const REBASE_HALTED = {
    ok: true,
    halted: true,
    noop: false,
    effectiveBase: REBASE_REPLAY.effectiveBase,
    before: "cafebabe",
    after: "cafebabe",
    recoveryRef: "refs/pre-rebase/feature/x/20260810-101112",
    validationPassed: false,
    question: "the fix and the base both rewrote the same guard; which wins is a semantic call",
    detail: "aborted the rebase and left the tree clean and idle",
  };
  // A publication that PUSHED and then failed: the map's replies are what is
  // left to replay, and the record must not call those tips local-only.
  const PUBLISH_PART_WAY = {
    published: false,
    pushed: true,
    pushedNewCommits: true,
    aborted: "the push landed but replying to thread T1 failed with a 502",
    summaryCommentUrl: "",
    threadOutcomes: [{ ref: "src/app.ts:12 a-reviewer", threadId: "T1", outcome: "reply rejected with a 502", replied: false, resolved: false }],
  };
  // The same exit with a reply and the Summary ALREADY on the PR: what landed
  // and what is outstanding are then different subsets of the same map, which is
  // the distinction a later turn re-posts a reply for want of.
  const PUBLISH_PART_WAY_REPLIED = {
    published: false,
    pushed: true,
    pushedNewCommits: true,
    aborted: "the reply landed but resolving thread T1 was rejected, and the pings never ran",
    summaryCommentUrl: "https://example.invalid/pr/42#issuecomment-7",
    threadOutcomes: [{ ref: "src/app.ts:12 a-reviewer", threadId: "T1", outcome: "replied; resolve rejected", replied: true, resolved: false }],
  };
  // A push that SUCCEEDED while moving nothing — `Everything up-to-date`, the
  // remote already pointing at this tip — and then failed on its first reply.
  // `pushed` is true and nothing whatever reached origin, which is why the
  // rendering cannot be selected on it.
  const PUBLISH_NOOP_PUSH = {
    published: false,
    pushed: true,
    pushedNewCommits: false,
    aborted: "the push was a no-op and replying to thread T1 failed with a 502",
    summaryCommentUrl: "",
    threadOutcomes: [{ ref: "src/app.ts:12 a-reviewer", threadId: "T1", outcome: "reply rejected with a 502", replied: false, resolved: false }],
  };
  // The SAME no-op push over an account that reports the reply already ON the
  // PR. This is the ordinary replay: a prior run posted that reply and died
  // before its Summary, so this run's push is `Everything up-to-date`, step 4
  // SKIPS the reply under its duplicate rule and reports `replied: true` — the
  // end state the schema requires — and then the Summary post fails. Nothing
  // this run did reached the PR, and the record still says the map is published
  // IN PART, because that is what a record is for: the reply is on the PR and
  // the next turn must not post it again. The row above is the same push with
  // nothing of the map on the PR, which keeps the canonical status — so the two
  // together pin that the rendering turns on what the PR CARRIES and not on
  // which run put it there.
  const PUBLISH_NOOP_PUSH_PRIOR_REPLY = {
    published: false,
    pushed: true,
    pushedNewCommits: false,
    aborted: "the push was `Everything up-to-date`, an equivalent reply of mine was already on T1, and posting the Summary comment failed with a 502",
    summaryCommentUrl: "",
    threadOutcomes: [{ ref: "src/app.ts:12 a-reviewer", threadId: "T1", outcome: "an equivalent reply of mine was already on the thread, so I posted none", replied: true, resolved: false }],
  };
  // The push whose own READ-BACK could not confirm the ref (task 023a's recipe at
  // step 2 stops there), which is the first abort reachable AFTER `git push`
  // returned 0 — so the push is exactly the thing in doubt. The brief leaves the
  // advance to that abort rather than ordering a flag value, so a publisher may
  // come back either way; this is the report whose flags claim no advance.
  const PUBLISH_PUSH_UNCONFIRMED = {
    published: false,
    pushed: true,
    pushedNewCommits: false,
    aborted: "push not confirmed at the ref: origin's second push url returned no ref for refs/heads/feature/x",
    summaryCommentUrl: "",
    threadOutcomes: [{ ref: "src/app.ts:12 a-reviewer", threadId: "T1", outcome: "never reached — the run stopped at the push read-back", replied: false, resolved: false }],
  };
  // The same stop from a publisher that CLAIMED the advance anyway. Both reports
  // are driven because the flags are what the stop declares unestablished, so a
  // record that reads them renders a false claim on one value or the other: this
  // one puts the tips on origin, the one above puts them nowhere.
  const PUBLISH_PUSH_UNCONFIRMED_ADVANCE_CLAIMED = {
    published: false,
    pushed: true,
    pushedNewCommits: true,
    aborted: "push not confirmed at the ref: ls-remote against the mirror push url timed out",
    summaryCommentUrl: "",
    threadOutcomes: [{ ref: "src/app.ts:12 a-reviewer", threadId: "T1", outcome: "never reached — the run stopped at the push read-back", replied: false, resolved: false }],
  };
  // And the same stop over an account this run cannot read, which is the third
  // state's own path: the push half must not be rendered as `advanced` there
  // either, on the strength of a flag the stop says nothing supports.
  const PUBLISH_PUSH_UNCONFIRMED_UNACCOUNTED = {
    published: false,
    pushed: true,
    pushedNewCommits: true,
    aborted: "push not confirmed at the ref, and the run then lost the thread ids it was replying through",
    summaryCommentUrl: "",
    threadOutcomes: [],
  };
  // And the same exit reached with nothing on origin at all, which records
  // exactly like a stop before publication. Its account is EMPTY and complete:
  // the push is step 2 and the replies are step 4, so a publisher that never
  // pushed acted on no thread, and there is nothing an entry could say. This is
  // the one shape in which `[]` is the whole truth rather than a silence.
  const PUBLISH_NOTHING = {
    published: false,
    pushed: false,
    pushedNewCommits: false,
    aborted: "the PR head moved under the run, so nothing was pushed",
    summaryCommentUrl: "",
    threadOutcomes: [],
  };
  // A publication whose reply AND resolve landed on one thread while the other
  // was never reached. The resolve half is what makes this fixture necessary:
  // with a single unresolved thread everywhere, the landed-resolve clause is
  // never rendered and the outstanding side can count every thread instead of
  // the complement without any check noticing. The two dispositions share one
  // `ref` — same path:line, same author, which is ordinary once a re-review
  // lands a second finding on a line — so an account keyed on `ref` cannot say
  // which of them was replied to, and only `threadId` can.
  const PUBLISH_PART_WAY_RESOLVED = {
    published: false,
    pushed: true,
    pushedNewCommits: true,
    aborted: "thread T1 was replied to and resolved, then posting the Summary comment failed with a 502",
    summaryCommentUrl: "",
    threadOutcomes: [
      { ref: "src/app.ts:12 a-reviewer", threadId: "T1", outcome: "replied and resolved", replied: true, resolved: true },
      { ref: "src/app.ts:12 a-reviewer", threadId: "T2", outcome: "never reached before the abort", replied: false, resolved: false },
    ],
  };
  // The publisher returning NOTHING. It pushes at step 2 and reports at step 4,
  // so "died after pushing" is the ordinary shape of this — and the run holds no
  // fact whatever about what reached origin.
  const PUBLISH_SILENT = null;
  // A report that pushed and then accounted for NO thread. Read as `[]`, this
  // asserts that no reply landed; what it actually says is nothing at all.
  const PUBLISH_UNACCOUNTED = {
    published: false,
    pushed: true,
    pushedNewCommits: true,
    aborted: "the push landed and then the run lost the thread ids it was replying through",
    summaryCommentUrl: "",
    threadOutcomes: [],
  };
  // And an account that names ONE thread twice while leaving the other unnamed —
  // the shape a `ref`-keyed account degenerates into. The two entries disagree,
  // so which is that thread's outcome is undecidable and neither may be counted.
  const PUBLISH_DUPLICATE_ACCOUNT = {
    published: false,
    pushed: true,
    pushedNewCommits: true,
    aborted: "the Summary comment was rejected",
    summaryCommentUrl: "",
    threadOutcomes: [
      { ref: "src/app.ts:12 a-reviewer", threadId: "T1", outcome: "replied", replied: true, resolved: false },
      { ref: "src/app.ts:12 a-reviewer", threadId: "T1", outcome: "not reached", replied: false, resolved: false },
    ],
  };
  // A no-op push whose account is SHORT: `pushed` true, `pushedNewCommits` false,
  // one of two items unnamed, and no reply, resolve or Summary reported. The bare
  // `pushed` half of the mutation test is the only thing that makes this account
  // unusable at all — read without it, the same report renders "this run changed
  // NOTHING on origin … no reply, resolve or Summary comment reached it" over an
  // item it never accounted for, with no per-thread block at all. It is also the
  // one third-state fixture whose push SUCCEEDED while moving nothing.
  const PUBLISH_NOOP_PUSH_UNACCOUNTED = {
    published: false,
    pushed: true,
    pushedNewCommits: false,
    aborted: "the push was a no-op, replying to thread T1 failed with a 502, and T2 was never reached",
    summaryCommentUrl: "",
    threadOutcomes: [{ ref: "src/app.ts:12 a-reviewer", threadId: "T1", outcome: "reply rejected with a 502", replied: false, resolved: false }],
  };
  // A report with no `threadOutcomes` FIELD at all. Read as `[]` it accounts for
  // every thread as untouched; what it says is nothing. The schema requires the
  // field, so this is the shape that arrives when that requirement is not what
  // stopped the report — which is the only reason the condition exists.
  const PUBLISH_NO_OUTCOMES_FIELD = {
    published: false,
    pushed: true,
    pushedNewCommits: true,
    aborted: "the push landed and the run died before it could account for anything",
    summaryCommentUrl: "",
  };
  // And one with no `summaryCommentUrl` FIELD, whose per-thread account is
  // COMPLETE, unique, keyed — and says the reply and the resolve both landed. The
  // record still reserves every entry, which is the wholesale-distrust rule
  // rather than an oversight: a report that broke its own required-field contract
  // is not read field by field, so its entries buy nothing here.
  const PUBLISH_NO_SUMMARY_FIELD = {
    published: false,
    pushed: true,
    pushedNewCommits: true,
    aborted: "the re-review pings were rejected",
    threadOutcomes: [{ ref: "src/app.ts:12 a-reviewer", threadId: "T1", outcome: "replied and resolved", replied: true, resolved: true }],
  };
  // An account naming every disposition this run holds AND one it does not. This
  // is what keeps the stray-entry condition from being redundant with the
  // unaccounted-item one: a SUPERSET account leaves nothing unnamed, so that
  // condition never fires, and what is left is an account partly about other work.
  const PUBLISH_STRAY_ACCOUNT = {
    published: false,
    pushed: true,
    pushedNewCommits: true,
    aborted: "the Summary comment was rejected",
    summaryCommentUrl: "",
    threadOutcomes: [
      { ref: "src/app.ts:12 a-reviewer", threadId: "T1", outcome: "replied", replied: true, resolved: false },
      { ref: "other/file.ts:3 someone-else", threadId: "T9", outcome: "replied", replied: true, resolved: false },
    ],
  };
  // A report claiming the publication COMPLETE over an account of nothing. It is
  // schema-valid, and taken at its word it exits `fixed-published`, gives the
  // worktree back, and writes NO record — the same silence every row above is
  // refused for, waved through on the one path that reclaims the tree.
  const PUBLISH_CLAIMED_COMPLETE_SHORT = {
    published: true,
    pushed: true,
    pushedNewCommits: true,
    summaryCommentUrl: "",
    threadOutcomes: [],
  };
  // And the same claim over an account this run CAN read, short only of the
  // Summary comment step 7 ends with. Nothing is unknown here, so the record
  // renders the part-way publication it is, with the Summary named as outstanding.
  const PUBLISH_CLAIMED_COMPLETE_NO_SUMMARY = {
    published: true,
    pushed: true,
    pushedNewCommits: true,
    summaryCommentUrl: "",
    threadOutcomes: [{ ref: "src/app.ts:12 a-reviewer", threadId: "T1", outcome: "replied and resolved", replied: true, resolved: true }],
  };
  // And the same claim over a `summaryCommentUrl` that is PRESENT and BLANK —
  // whitespace, which is what a publisher that posted no Summary and still has a
  // required field to fill reports. That string is what decides `published`, so it
  // is compared TRIMMED: untrimmed, `"   "` is a truthy URL, the claim is accepted,
  // and the run exits `fixed-published`, gives the worktree back and writes NO
  // record — the defect the row above closes, restored by one removed `.trim()`.
  const PUBLISH_CLAIMED_COMPLETE_BLANK_SUMMARY = {
    ...PUBLISH_CLAIMED_COMPLETE_NO_SUMMARY,
    summaryCommentUrl: "   ",
  };
  // And the claim its own account CONTRADICTS rather than merely falls short of.
  // Both of these are READABLE — one keyed entry per disposition, unique,
  // complete, the Summary comment's url actually there — so every test above
  // passes them, and taken at their word they exit `fixed-published`, reclaim the
  // worktree, write NO record, and SPEND the prior record still holding the map:
  // a durable copy of work the report itself says never reached the PR, deleted
  // on the say-so of the report that says it.
  const PUBLISH_CLAIMED_COMPLETE_UNREPLIED = {
    published: true,
    pushed: true,
    pushedNewCommits: true,
    summaryCommentUrl: "https://example.invalid/pr/42#issuecomment-5",
    threadOutcomes: [{ ref: "src/app.ts:12 a-reviewer", threadId: "T1", outcome: "the reply was rejected", replied: false, resolved: false }],
  };
  // The resolve half of the same contradiction, so the gate cannot be satisfied
  // by the reply alone: the thread was replied to and left unresolved while the
  // publisher calls the publication complete.
  const PUBLISH_CLAIMED_COMPLETE_UNRESOLVED = {
    ...PUBLISH_CLAIMED_COMPLETE_UNREPLIED,
    threadOutcomes: [{ ref: "src/app.ts:12 a-reviewer", threadId: "T1", outcome: "replied; the resolve was rejected", replied: true, resolved: false }],
  };
  // And the PUSH half of the same contradiction: a schema-valid report claiming
  // completion over `pushed: false`, its per-item account keyed and complete and
  // the Summary URL present, so every readability test and both halves above
  // pass it — the one field saying the opposite of the claim is the push itself,
  // which step 2 makes the start of every complete publication (an `Everything
  // up-to-date` no-op reports `pushed: true`). Waved through, this report exits
  // `fixed-published`, reclaims the tree, and spends the prior record while the
  // fixes its replies cite never reached origin.
  const PUBLISH_CLAIMED_COMPLETE_UNPUSHED = {
    published: true,
    pushed: false,
    pushedNewCommits: false,
    summaryCommentUrl: "https://example.invalid/pr/42#issuecomment-5",
    threadOutcomes: [{ ref: "src/app.ts:12 a-reviewer", threadId: "T1", outcome: "replied and resolved", replied: true, resolved: true }],
  };
  // The two controls that keep that gate from refusing the publications this
  // workflow's own brief PRESCRIBES, which is the only way the stronger test
  // could be wrong. Step 4 replies to neither a `standalone` item (the Summary
  // comment addresses it) nor an `ambiguous-skipped` thread (left silent and
  // open), so both carry `replied: false` on a genuinely complete publication —
  // and it leaves a human push-back or deferral unresolved by policy while
  // resolving the bot push-back beside it. Every one of these must still publish.
  const PUBLISH_COMPLETE_POLICY_KINDS = {
    published: true,
    pushed: true,
    pushedNewCommits: true,
    summaryCommentUrl: "https://example.invalid/pr/42#issuecomment-5",
    threadOutcomes: [
      { ref: "src/app.ts:12 a-reviewer", threadId: "T1", outcome: "replied and resolved", replied: true, resolved: true },
      { ref: "issue comment a-maintainer", url: "https://example.invalid/pr/42#issuecomment-3", outcome: "addressed in the Summary comment; no thread to reply to", replied: false, resolved: false },
      { ref: "src/app.ts:31 a-reviewer", threadId: "T3", outcome: "left without a reply and left open, per its disposition", replied: false, resolved: false },
    ],
  };
  const PUBLISH_COMPLETE_POLICY_RESOLVES = {
    published: true,
    pushed: true,
    pushedNewCommits: true,
    summaryCommentUrl: "https://example.invalid/pr/42#issuecomment-5",
    threadOutcomes: [
      { ref: "src/app.ts:12 a-reviewer", threadId: "T4", outcome: "replied; left open per policy", replied: true, resolved: false },
      { ref: "src/app.ts:20 a-reviewer", threadId: "T5", outcome: "replied; left open per policy", replied: true, resolved: false },
      { ref: "src/app.ts:31 a-bot", threadId: "T6", outcome: "replied and resolved — a bot thread", replied: true, resolved: true },
      { ref: "src/app.ts:44 a-reviewer", threadId: "T7", outcome: "replied; the maintainer-directed resolve did not go through", replied: true, resolved: false },
    ],
  };
  // A first cycle whose round PASSED over one map and whose later pass replaced it
  // before the cycle stopped. `workReportReviewed` is false — what leaves is the
  // replacement — while the judged map rides out under `reviewedWorkReport`, and
  // it is the one holding drafted replies nobody will otherwise post.
  const CYCLE_ERROR_REPLACED = {
    ...CYCLE_ERROR,
    detail: "the pass after the one that passed blocked",
    reviewedWorkReport: [{ ...CYCLE_PASS.workReport[0], detail: "judged by round 1, then replaced by a later pass" }],
    reviewedFinalSha: "feedface",
  };
  // The same replacement on the post-rebase exit, where the pre-rebase map used
  // to stand in for the judged one and the judged one was lost outright.
  const CYCLE_REVERIFIED_ERROR_REPLACED = {
    ...CYCLE_REVERIFIED_ERROR,
    detail: "the pass after the one that passed came back on an unclean worktree",
    reviewedWorkReport: [{ ...CYCLE_PASS.workReport[0], detail: "judged over the rebased tree, then replaced by a later pass" }],
    reviewedFinalSha: "feedface",
  };
  // And a re-verification whose round passed over a map with NO ENTRIES. Nothing
  // is owed for that map; everything is owed for the run, since the pre-rebase map
  // that passed review holds drafted replies — and selecting on "was it reviewed"
  // alone suppressed the record entirely, probed as `recordDispatched: false`.
  const CYCLE_REVERIFIED_ERROR_EMPTY_REVIEWED = {
    ...CYCLE_REVERIFIED_ERROR,
    workReportReviewed: true,
    detail: "the confirmation pass over the rebased tree returned nothing",
    workReport: [],
    reviewedWorkReport: [],
    reviewedFinalSha: "feedface",
  };
  const REPLAY_POINTS = { rebases: { "pre-fix": REBASE_NOOP, "pre-push": REBASE_REPLAY } };
  const cases = [
    ["a `no-push` run that passed", { args: "no-push no-rebase", cycles: [CYCLE_PASS] }, "fixed-local", true],
    ["a `no-push` run stopped at the round cap", { args: "no-push no-rebase", cycles: [CYCLE_CAP] }, "review-cap", true],
    ["a push run stopped at the round cap", { args: "push no-rebase", cycles: [CYCLE_CAP] }, "review-cap-not-published", true],
    ["a push run whose dispositions leave a gathered item uncovered", { args: "push no-rebase", cycles: [CYCLE_UNCOVERED] }, "publish-aborted-incomplete-dispositions", true],
    ["an incomplete map on a PR that already carries a record", { args: "push no-rebase", cycles: [CYCLE_UNCOVERED] }, "publish-aborted-incomplete-dispositions", true, withPrior],
    ["a doubled disposition on a PR that already carries a record", { args: "push no-rebase", cycles: [CYCLE_DOUBLED] }, "publish-aborted-conflicting-dispositions", true, withPrior],
    ["an unpublishable disposition on a PR that already carries a record", { args: "push no-rebase", cycles: [CYCLE_DEFECT] }, "publish-aborted-incomplete-dispositions", true, withPrior],
    ["an uncovered item beside a clean disposition on a PR that already carries a record", { args: "push no-rebase", cycles: [CYCLE_PASS] }, "publish-aborted-incomplete-dispositions", true, withTwoPrior],
    ["a complete map on a PR that already carries a record", { args: "no-push no-rebase", cycles: [CYCLE_PASS] }, "fixed-local", true, withPrior],
    ["a pre-push rebase that halted on a conflict", { args: "push", cycles: [CYCLE_PASS], rebases: { "pre-fix": REBASE_NOOP, "pre-push": REBASE_HALTED } }, "rebase-halted", true],
    ["a replay with no reviewer rounds left to re-verify it", { args: "push", cycles: [{ ...CYCLE_PASS, rounds: 12 }], ...REPLAY_POINTS }, "reverify-budget-exhausted", true],
    ["a re-verification that returned nothing", { args: "push", cycles: [CYCLE_PASS, null], ...REPLAY_POINTS }, "error", true],
    ["a publication that pushed and then failed part-way", { args: "push no-rebase", cycles: [CYCLE_PASS], publish: PUBLISH_PART_WAY }, "fixed-publish-failed", true],
    ["a publication whose reply and Summary landed before it failed", { args: "push no-rebase", cycles: [CYCLE_PASS], publish: PUBLISH_PART_WAY_REPLIED }, "fixed-publish-failed", true],
    ["a publication whose push was a no-op before it failed", { args: "push no-rebase", cycles: [CYCLE_PASS], publish: PUBLISH_NOOP_PUSH }, "fixed-publish-failed", true],
    ["a publication whose no-op push found the reply already on the PR", { args: "push no-rebase", cycles: [CYCLE_PASS], publish: PUBLISH_NOOP_PUSH_PRIOR_REPLY }, "fixed-publish-failed", true],
    ["a publication whose push could not be confirmed at the ref", { args: "push no-rebase", cycles: [CYCLE_PASS], publish: PUBLISH_PUSH_UNCONFIRMED }, "fixed-publish-failed", true],
    ["a publication that claimed the advance its read-back could not confirm", { args: "push no-rebase", cycles: [CYCLE_PASS], publish: PUBLISH_PUSH_UNCONFIRMED_ADVANCE_CLAIMED }, "fixed-publish-failed", true],
    ["a publication whose unconfirmed push left its account short", { args: "push no-rebase", cycles: [CYCLE_PASS], publish: PUBLISH_PUSH_UNCONFIRMED_UNACCOUNTED }, "fixed-publish-failed", true],
    ["a publication that aborted with nothing on origin", { args: "push no-rebase", cycles: [CYCLE_PASS], publish: PUBLISH_NOTHING }, "fixed-publish-failed", true],
    ["a publication whose reply and resolve landed on one of two threads", { args: "push no-rebase", cycles: [CYCLE_PASS_TWO], publish: PUBLISH_PART_WAY_RESOLVED }, "fixed-publish-failed", true, withTwo],
    ["a publication holding items publication owes neither a reply nor a resolve", { args: "push no-rebase", cycles: [CYCLE_PASS_POLICY_KINDS], publish: PUBLISH_PART_WAY_POLICY_KINDS }, "fixed-publish-failed", true, withPolicyKinds],
    ["a publication holding human push-backs and deferrals it owes no resolve on", { args: "push no-rebase", cycles: [CYCLE_PASS_POLICY_RESOLVES], publish: PUBLISH_PART_WAY_POLICY_RESOLVES }, "fixed-publish-failed", true, withPolicyResolves],
    // The three shapes in which the publisher's account cannot carry a claim
    // about origin. Every one of them used to render as "nothing reached
    // origin", which is a statement about a state the run has no fact about.
    ["a publisher that returned nothing at all", { args: "push no-rebase", cycles: [CYCLE_PASS], publish: PUBLISH_SILENT }, "fixed-publish-failed", true],
    ["a publication that pushed and then accounted for no thread", { args: "push no-rebase", cycles: [CYCLE_PASS], publish: PUBLISH_UNACCOUNTED }, "fixed-publish-failed", true],
    ["a publication whose account names one thread twice and the other not at all", { args: "push no-rebase", cycles: [CYCLE_PASS_TWO], publish: PUBLISH_DUPLICATE_ACCOUNT }, "fixed-publish-failed", true, withTwo],
    ["a publication whose no-op push left an item unaccounted", { args: "push no-rebase", cycles: [CYCLE_PASS_TWO], publish: PUBLISH_NOOP_PUSH_UNACCOUNTED }, "fixed-publish-failed", true, withTwo],
    ["a publication whose report carries no threadOutcomes array", { args: "push no-rebase", cycles: [CYCLE_PASS], publish: PUBLISH_NO_OUTCOMES_FIELD }, "fixed-publish-failed", true],
    ["a publication whose report omits the summaryCommentUrl", { args: "push no-rebase", cycles: [CYCLE_PASS], publish: PUBLISH_NO_SUMMARY_FIELD }, "fixed-publish-failed", true],
    ["a publication whose account names an item this run does not hold", { args: "push no-rebase", cycles: [CYCLE_PASS], publish: PUBLISH_STRAY_ACCOUNT }, "fixed-publish-failed", true],
    // The PUBLISHED path's own silence: a claim of completion is accepted only
    // over a report that can support it, or the one exit that reclaims the tree
    // and writes nothing is reachable by a claim nobody can check.
    ["a publisher claiming a COMPLETE publication over an account of nothing", { args: "push no-rebase", cycles: [CYCLE_PASS], publish: PUBLISH_CLAIMED_COMPLETE_SHORT }, "fixed-publish-failed", true],
    ["a publisher claiming a COMPLETE publication with no Summary comment posted", { args: "push no-rebase", cycles: [CYCLE_PASS], publish: PUBLISH_CLAIMED_COMPLETE_NO_SUMMARY }, "fixed-publish-failed", true],
    ["a publisher claiming a COMPLETE publication over a blank Summary comment url", { args: "push no-rebase", cycles: [CYCLE_PASS], publish: PUBLISH_CLAIMED_COMPLETE_BLANK_SUMMARY }, "fixed-publish-failed", true],
    // And the readable account that CONTRADICTS the claim rather than falling
    // short of it — on a PR carrying a record, since the exit this refuses is
    // the one that would spend it.
    // Both run in WORKTREE mode, since the exit this gate keeps them out of is
    // the one that tears that tree down: inline, "the worktree is kept" is true
    // of every row for a reason the gate has nothing to do with.
    ["a publisher claiming a COMPLETE publication its own account says never replied", { args: "push no-rebase", cycles: [CYCLE_PASS], publish: PUBLISH_CLAIMED_COMPLETE_UNREPLIED }, "fixed-publish-failed", true, inWorktree(withPrior)],
    ["a publisher claiming a COMPLETE publication over a thread its account leaves unresolved", { args: "push no-rebase", cycles: [CYCLE_PASS], publish: PUBLISH_CLAIMED_COMPLETE_UNRESOLVED }, "fixed-publish-failed", true, inWorktree(withWork)],
    ["a publisher claiming a COMPLETE publication whose push never succeeded", { args: "push no-rebase", cycles: [CYCLE_PASS], publish: PUBLISH_CLAIMED_COMPLETE_UNPUSHED }, "fixed-publish-failed", true, inWorktree(withPrior)],
    // The controls for it: the publications the brief PRESCRIBES, whose entries
    // report `replied: false`/`resolved: false` because nothing was owed there.
    // In worktree mode too, so the control shows the tree actually going back.
    ["a complete publication over the two kinds it owes no reply", { args: "push no-rebase", cycles: [CYCLE_PASS_POLICY_KINDS], publish: PUBLISH_COMPLETE_POLICY_KINDS }, "fixed-published", false, inWorktree(withPolicyKinds)],
    ["a complete publication leaving human push-backs and deferrals unresolved by policy", { args: "push no-rebase", cycles: [CYCLE_PASS_POLICY_RESOLVES], publish: PUBLISH_COMPLETE_POLICY_RESOLVES }, "fixed-published", false, inWorktree(withPolicyResolves)],
    ["a run that published", { args: "push no-rebase", cycles: [CYCLE_PASS] }, "fixed-published", false],
    // The same publication on a PR that already carries a record. It still
    // leaves none of its own — the map is on the PR — but it must SPEND the one
    // standing, or that record's `standalone` entry is re-gathered as fresh work
    // by every later run, forever.
    ["a run that published on a PR that already carries a record", { args: "push no-rebase", cycles: [CYCLE_PASS] }, "fixed-published", false, withPrior],
    ["an abort with no dispositions at all", { args: "push no-rebase", cycles: [CYCLE_NO_MAP] }, "publish-aborted-incomplete-dispositions", false],
    // What the exemption covers, stated as the FACT it now rests on rather than
    // as the two exits it used to name: a map no reviewer round ever judged, of
    // unknown completeness over an unknown tree. A record is REPLAYED rather
    // than re-triaged, so writing one would hand the next run's round 1 a
    // baseline nobody stood behind — while the map rides out in the result.
    ["a first cycle that errored with no round behind its map", { args: "push no-rebase", cycles: [CYCLE_ERROR] }, "error", false],
    ["a re-verification that errored with no round behind its map", { args: "push", cycles: [CYCLE_PASS, CYCLE_REVERIFIED_ERROR], ...REPLAY_POINTS }, "error", true],
    // And the same two exits over a map a reviewer round DID pass, which the
    // exit's name cannot distinguish: `confirming` is set only after a round
    // passed, so a confirmation pass that stops the cycle leaves an `error`
    // verdict standing over the map that just passed review.
    ["a first cycle that errored after a round had passed over its map", { args: "push no-rebase", cycles: [CYCLE_ERROR_REVIEWED] }, "error", true],
    ["a first cycle that errored after a pass committed and was then rejected", { args: "push no-rebase", cycles: [CYCLE_ERROR_REVIEWED_MOVED] }, "error", true],
    ["a re-verification that errored after a round had passed over its map", { args: "push", cycles: [CYCLE_PASS, CYCLE_REVERIFIED_ERROR_REVIEWED], ...REPLAY_POINTS }, "error", true],
    // And the two shapes in which the map a reviewer judged is NOT the map the
    // cycle carries out: a later pass replaced it, or the judged one is empty.
    ["a first cycle that errored after a later pass replaced the map a round passed", { args: "push no-rebase", cycles: [CYCLE_ERROR_REPLACED] }, "error", true],
    ["a re-verification that errored after a later pass replaced the map its round passed", { args: "push", cycles: [CYCLE_PASS, CYCLE_REVERIFIED_ERROR_REPLACED], ...REPLAY_POINTS }, "error", true],
    ["a re-verification whose passing round judged a map with no entries", { args: "push", cycles: [CYCLE_PASS, CYCLE_REVERIFIED_ERROR_EMPTY_REVIEWED], ...REPLAY_POINTS }, "error", true],
  ];
  const wrong = [];
  let recordBrief = "";
  const briefs = {};
  const spends = {};
  const results = {};
  // The account each row's publisher reported, so the record's DUMP of it can be
  // compared against the fixture rather than against a shape restated here — an
  // absent or non-array field being the empty account the record prints.
  const publishOf = Object.fromEntries(cases.map(([what, opts]) => [what, opts.publish]));
  const accountOf = (what) => {
    const reported = (publishOf[what] || {}).threadOutcomes;
    return Array.isArray(reported) ? reported : [];
  };
  for (const [what, opts, status, records, packetOpts] of cases) {
    const r = await run(gathered(packetOpts || withWork), opts);
    const dispatched = r.seen.agentLabels.includes("record");
    const reported = !!(r.result || {}).dispositionRecord;
    if (r.status !== status) wrong.push(`${what} exited ${r.status}, expected ${status}`);
    if (dispatched !== records) wrong.push(`${what} ${dispatched ? "recorded" : "recorded nothing"}, expected the opposite`);
    if (reported !== records) wrong.push(`${what} ${reported ? "reports" : "does not report"} a dispositionRecord, expected the opposite`);
    briefs[what] = r.seen.recordPrompts[0] || "";
    spends[what] = r.seen.spendPrompts[0] || "";
    results[what] = r.result || {};
    if (records && !recordBrief) recordBrief = r.seen.recordPrompts[0] || "";
  }
  check(
    "every exit that does not publish in full while holding a disposition map leaves the record, and a published run leaves none",
    wrong.length === 0,
    wrong.join("; "),
  );

  // The two lines this part-way publication falsifies — its push advanced the
  // remote, so the tips claim falls with the status here. A part-way
  // publication's record must say what reached origin and what is left; the
  // same exit reached with nothing pushed must still say the tips are
  // local-only, which is what pins the rendering to the FACT rather than to
  // the exit.
  const partWay = briefs["a publication that pushed and then failed part-way"];
  const nothingLanded = briefs["a publication that aborted with nothing on origin"];
  check(
    "a part-way publication's record says what landed and what remains, while the same exit with nothing on origin still says LOCAL ONLY",
    /status: published in part/.test(partWay) &&
      /^reached origin: the push, which advanced the remote branch — still outstanding: 1 of 1 thread\(s\) still owed their reply/m.test(partWay) &&
      !/LOCAL ONLY/.test(partWay) &&
      /status: not published/.test(nothingLanded) &&
      /the tips above are LOCAL ONLY — this run pushed nothing, so they are not on origin/.test(nothingLanded) &&
      !/published in part/.test(nothingLanded),
    JSON.stringify({
      partWayStatus: (partWay.match(/status: [^(]*/) || [])[0],
      partWayLanded: (partWay.match(/^reached origin: .*/m) || [])[0],
      partWayLocalOnly: /LOCAL ONLY/.test(partWay),
      nothingLandedStatus: (nothingLanded.match(/status: [^(]*/) || [])[0],
    }),
  );

  // The push that RAN and moved nothing. `pushed` is true here and nothing
  // whatever reached origin, so a rendering selected on `pushed` calls this
  // "published in part" and sends a reader looking for replies and a Summary
  // comment that were never posted. It is not the local-only case either: the
  // remote already pointed at this tip, so the record says what is true of both
  // halves — the tips are there, nothing this run did is.
  const noopPush = briefs["a publication whose push was a no-op before it failed"];
  check(
    "a push that succeeded while moving nothing is not a part-way publication, and its record says so without calling the tips local-only",
    /status: not published/.test(noopPush) &&
      !/published in part/.test(noopPush) &&
      !/^reached origin:/m.test(noopPush) &&
      /this run changed NOTHING on origin: its push was an `Everything up-to-date` no-op, so the tips above are already on origin while no reply, resolve or Summary comment reached it/.test(noopPush) &&
      !/LOCAL ONLY/.test(noopPush),
    JSON.stringify({
      status: (noopPush.match(/status: [^(]*/) || [])[0],
      originLine: (noopPush.match(/^(this run changed|the tips above|reached origin).*/m) || ["no origin line at all"])[0].slice(0, 80),
    }),
  );

  // The SAME no-op push over an account reporting the reply already on the PR,
  // which is what "`replied` is END STATE" made reachable: a replay whose push
  // moves nothing, whose reply step 4 skips as a duplicate of an earlier run's,
  // and whose Summary then fails. What the record may call landed is what the PR
  // CARRIES, not what this run put there — so it is a part-way publication, and
  // the entry says the reply is already posted. Read as a diary of this run's own
  // writes it would be a lie; read as the state of the PR it is exactly what the
  // next turn needs, and the alternative — a record naming only this run's writes
  // — has it post that reply a second time. The row above is the control: the
  // same push flags with nothing of the map on the PR still keep the canonical
  // status and the no-op line, so the rendering turns on the PR's state rather
  // than on `pushed`.
  const noopPrior = briefs["a publication whose no-op push found the reply already on the PR"];
  const noopPriorResult = results["a publication whose no-op push found the reply already on the PR"];
  check(
    "a reply that is on the PR is landed whichever run posted it — a no-op push over one renders as published in part, while the same push over a PR carrying none does not",
    /status: published in part/.test(noopPrior) &&
      /^reached origin: 1 thread reply — still outstanding: 1 of 1 not resolved, the Summary comment — and the tips above are already on origin, this run having put nothing there: its push was an `Everything up-to-date` no-op$/m.test(noopPrior) &&
      // The push moved nothing, so no push clause may be named as landed, and
      // the no-op line the control row prints belongs to the control row alone.
      !/the push, which advanced the remote branch/.test(noopPrior) &&
      !/this run changed NOTHING on origin/.test(noopPrior) &&
      !/LOCAL ONLY/.test(noopPrior) &&
      // And the entry says the reply is there, which is the whole point: a
      // standing of "still owed" here posts it twice.
      /thread=T1 {2}src\/app\.ts:12 a-reviewer — reply ALREADY POSTED — do not post it again; resolve still owed\./.test(noopPrior) &&
      /what reached origin: 1 thread reply/.test(noopPriorResult.note || "") &&
      // And the brief's own lead says which claim its author is writing, in the
      // same terms: this run did not put that reply there, and a lead saying it
      // did is the sentence the rendering was wrong about.
      /This run's publication stopped with PART OF THIS MAP ALREADY ON THE PR/.test(noopPrior) &&
      /What is named as having reached origin is what the PR CARRIES, whichever run put it there — a reply an earlier run posted counts/.test(noopPrior),
    JSON.stringify({
      status: (noopPrior.match(/status: [^(]*/) || ["no status line"])[0],
      originLine: (noopPrior.match(/^(this run changed|the tips above|reached origin).*/m) || ["no origin line at all"])[0].slice(0, 110),
      standing: (noopPrior.match(/^ {2}thread=.*/m) || ["no standing line"])[0],
    }),
  );

  // The push that RAN and could not be CONFIRMED at the ref — the abort task 023a
  // put after the push, and the first one reachable once `git push` has already
  // returned 0. It is the one state the other three cannot hold: `advanced` and
  // `noop` both put these tips ON origin, "pushed nothing" puts them nowhere, and
  // what the stop establishes is that nobody knows which. So it is read out of the
  // ABORT rather than out of the push flags, whose truth is precisely what the stop
  // withdraws — driven from both reports a publisher can hand back, one whose flags
  // claim no advance and one that claims it, because a record reading either flag
  // renders a false claim on one value or the other.
  const unconfirmedRuns = {
    "denying the advance": "a publication whose push could not be confirmed at the ref",
    "claiming the advance": "a publication that claimed the advance its read-back could not confirm",
  };
  const claimedOrigin = [];
  for (const [what, caseName] of Object.entries(unconfirmedRuns)) {
    const b = briefs[caseName];
    const wrongLines = [
      /LOCAL ONLY/.test(b) ? "calls the tips local-only" : "",
      /already on origin/.test(b) ? "calls the tips already on origin" : "",
      /published in part/.test(b) ? "calls it a part-way publication" : "",
      /^reached origin:/m.test(b) ? "names something as having reached origin" : "",
      /status: not published/.test(b) ? "renders the canonical not-published status" : "",
      /published NOTHING/.test(b) ? "leads with having published nothing" : "",
      /goes looking for commits that are not there/.test(b) ? "warns of commits that are not there" : "",
      /^status: UNKNOWN whether its push reached origin, and nothing else was published \(/m.test(b) ? "" : "does not say the push's own outcome is unknown in its status line",
      /^whether this run's push reached origin is UNKNOWN — `git push` returned and the read-back at the ref did not confirm the ref moved, so read the ref itself before treating the tips above as either published or local, while no reply, resolve or Summary comment reached the PR$/m.test(b)
        ? ""
        : "does not say in place of the local-only line that the push's landing is unknown",
      /takes this record for "nothing reached origin" treats these tips as unpushed when the ref may already carry them/.test(b) ? "" : "does not warn the reader off reading it as nothing-reached-origin",
    ].filter(Boolean);
    if (wrongLines.length) claimedOrigin.push(`${what}: ${wrongLines.join(", ")}`);
    const note = (results[caseName] || {}).note || "";
    if (!/whether its push reached origin is UNKNOWN/.test(note)) claimedOrigin.push(`${what}: the run's own note does not carry it either`);
  }
  check(
    "a push the read-back could not confirm claims neither presence nor absence on origin, whichever way the publisher reported its own flags",
    claimedOrigin.length === 0,
    claimedOrigin.join("; ") || "both reports render the same unknown-push record",
  );

  // And the same fact in the RESULT, which is a second reader with a second copy
  // of the publisher's report: the report is echoed there field for field, so a
  // `pushedNewCommits` boolean beside an UNKNOWN disposition is this exit stating
  // the very thing its record spends three lines withdrawing — `false` reading as
  // "the remote did not move", which the failed read-back establishes no better
  // than `true`. So the echoed flag holds NO value there, driven from both reports
  // for the same reason the record is: whichever boolean arrived is the one that
  // must not be passed on. The other fields are echoed verbatim, `pushed` included
  // — that a push command succeeded is a fact this stop leaves standing.
  const echoWrong = [];
  for (const [what, caseName] of Object.entries(unconfirmedRuns)) {
    const report = (results[caseName] || {}).publishReport || {};
    if (report.pushedNewCommits !== null) {
      echoWrong.push(`${what}: the result echoes \`pushedNewCommits: ${JSON.stringify(report.pushedNewCommits)}\``);
    }
    if (report.pushed !== true) echoWrong.push(`${what}: the result drops the push it DID establish (\`pushed: ${JSON.stringify(report.pushed)}\`)`);
    if (!/^push not confirmed at the ref/.test(String(report.aborted || ""))) {
      echoWrong.push(`${what}: the result's echoed report does not carry the abort that says why (\`${report.aborted}\`)`);
    }
  }
  // And the exits this substitution is NOT for, where the flag is a fact the
  // publisher established and the result must hand it on: a stop AFTER a push that
  // advanced the remote, and one after a push that moved nothing. Withholding the
  // flag from every report would read as this run never knowing whether its push
  // advanced anything, which is a different false claim in the other direction.
  for (const [caseName, expected] of [
    ["a publication that pushed and then failed part-way", true],
    ["a publication whose push was a no-op before it failed", false],
  ]) {
    const report = (results[caseName] || {}).publishReport || {};
    if (report.pushedNewCommits !== expected) {
      echoWrong.push(`${caseName}: the result no longer echoes the flag its publisher DID establish (\`${JSON.stringify(report.pushedNewCommits)}\`, expected \`${expected}\`)`);
    }
  }
  check(
    "and the run's own result states no value for the advance its read-back could not establish, whichever way the publisher reported it — while passing on the push it did establish there, and the advance itself on the exits that established it",
    echoWrong.length === 0,
    echoWrong.join("; ") || "both results echo the report with the unestablished advance held at no value",
  );

  // And the same stop where the account is ALSO unusable, which selects the third
  // state's rendering instead. Its push half must collapse to the least-claiming
  // of the three there rather than reading `pushedNewCommits` — the flag this
  // publisher set while its own abort says nothing supports it.
  const unconfirmedUnaccounted = briefs["a publication whose unconfirmed push left its account short"];
  check(
    "and where its account is unusable too, the push half collapses to the state that claims the least rather than to the advance the flag asserts",
    /^status: UNKNOWN whether anything was published \(/m.test(unconfirmedUnaccounted) &&
      /whether anything reached origin is UNKNOWN — not even a push is known to have advanced the remote branch, so whether the tips above are on origin is unknown too/.test(unconfirmedUnaccounted) &&
      !/the push WAS published/.test(unconfirmedUnaccounted) &&
      !/the tips above are already on origin/.test(unconfirmedUnaccounted) &&
      !/LOCAL ONLY/.test(unconfirmedUnaccounted),
    JSON.stringify({
      status: (unconfirmedUnaccounted.match(/status: [^(]*/) || [])[0],
      originLine: (unconfirmedUnaccounted.match(/^(whether|this run|the push|the tips above|reached origin).*/m) || ["no origin line at all"])[0].slice(0, 90),
    }),
  );

  // The breakdown itself, which is what a later turn acts on. A reply and a
  // Summary comment already on the PR are LANDED, so neither may be named as
  // outstanding — a Summary listed as both is a record contradicting itself —
  // and the per-thread entries carry the publisher's own account so the turn
  // that replays this resolves a replied thread instead of replying twice. What
  // the publisher did NOT report is stated as unknown rather than assumed
  // either way: that is the limit of what this record can know.
  const replied = briefs["a publication whose reply and Summary landed before it failed"];
  const landedLine = (replied.match(/^reached origin: .*/m) || [""])[0];
  check(
    "and the breakdown names a landed reply and Summary as landed, never also as outstanding, with each entry's own standing carried beside it",
    /1 thread reply/.test(landedLine) &&
      landedLine.includes("the Summary comment at https://example.invalid/pr/42#issuecomment-7") &&
      !/still outstanding: [^\n]*Summary comment/.test(landedLine) &&
      /still outstanding: 1 of 1 not resolved/.test(landedLine) &&
      /thread=T1 {2}src\/app\.ts:12 a-reviewer — reply ALREADY POSTED — do not post it again; resolve still owed\./.test(replied),
    JSON.stringify({ landedLine: landedLine || "no origin line at all", standing: (replied.match(/^ {2}thread=.*/m) || ["no standing line"])[0] }),
  );

  // The RESOLVE half of that breakdown, over two threads rather than one. With a
  // single unresolved thread in every fixture, the landed-resolve clause is never
  // rendered at all and the outstanding side can count every thread instead of
  // the complement, so two truthfulness mutations pass green: a landed resolve
  // ALSO reported as outstanding, and a landed resolve dropped from the record
  // altogether. Both are this task's failure, in the direction each round has
  // found new. The two dispositions share a `ref` on purpose — same path:line,
  // same author, which is what a re-review leaves — so the standing lines can
  // only be told apart by `threadId`, and an account joined by `ref` would put
  // T1's landed reply on T2's entry.
  const resolved = briefs["a publication whose reply and resolve landed on one of two threads"];
  const resolvedLanded = (resolved.match(/^reached origin: .*/m) || [""])[0];
  check(
    "and a resolve that landed is named as landed, never also as outstanding, with its own entry keyed by threadId rather than by the ref it shares",
    /1 thread reply, 1 thread resolve/.test(resolvedLanded) &&
      /still outstanding: 1 of 2 thread\(s\) still owed their reply, 1 of 2 not resolved/.test(resolvedLanded) &&
      !/\b2 of 2 not resolved/.test(resolvedLanded) &&
      /thread=T1 {2}src\/app\.ts:12 a-reviewer — reply ALREADY POSTED — do not post it again; thread ALREADY RESOLVED — do not resolve it again\./.test(resolved) &&
      /thread=T2 {2}src\/app\.ts:12 a-reviewer — no reply reached the PR — the reply below is still owed; resolve still owed\./.test(resolved) &&
      !/thread=T1[^\n]*resolve still owed/.test(resolved),
    JSON.stringify({ landedLine: resolvedLanded || "no origin line at all", standing: (resolved.match(/^ {2}thread=.*\n {2}thread=.*/m) || ["no standing lines"])[0] }),
  );

  // And the debt counted over the items publication OWES something on, rather
  // than over every disposition. Step 4 of the publish brief replies to no
  // `standalone` item (it is addressed in the Summary comment alone and never
  // resolved as a thread) and to no `ambiguous-skipped` thread (it is left
  // without a reply and left open), so both are `replied: false` on a COMPLETE
  // publication. Counted as debt, this record tells the maintainer and the
  // replay turn that a forbidden action is outstanding — and the per-entry
  // standing is the sharper half of the same defect, since it is the line the
  // next turn acts on entry by entry: "the reply below is still owed" on a
  // standalone item asks for a reply on a thread it does not have.
  // The map here holds one of each beside one ordinary fixed thread whose reply
  // and resolve both landed, so the counts have a nonzero complement to be wrong
  // about in either direction.
  const policyKinds = briefs["a publication holding items publication owes neither a reply nor a resolve"];
  const policyLanded = (policyKinds.match(/^reached origin: .*/m) || [""])[0];
  check(
    "and the debt excludes what publication never owed — a standalone item and an ambiguous-skipped thread are neither counted nor told they are owed a reply",
    // One repliable thread, and it was replied to and resolved: nothing at all
    // is owed but the Summary comment.
    /still outstanding: the Summary comment$/.test(policyLanded) &&
      !/still owed their reply/.test(policyLanded) &&
      !/not resolved/.test(policyLanded) &&
      /thread=T1 {2}src\/app\.ts:12 a-reviewer — reply ALREADY POSTED — do not post it again; thread ALREADY RESOLVED — do not resolve it again\./.test(policyKinds) &&
      /thread=https:\/\/example\.invalid\/pr\/42#issuecomment-3 {2}issue comment a-maintainer — NOTHING is owed on it: a standalone item is addressed in the Summary comment alone, never by a thread reply, and is never resolved as a thread\./.test(policyKinds) &&
      /thread=T3 {2}src\/app\.ts:31 a-reviewer — NOTHING is owed on it: an ambiguous-skipped thread is deliberately left without a reply and left open\./.test(policyKinds) &&
      !/(issuecomment-3|T3)[^\n]*still owed/.test(policyKinds),
    JSON.stringify({ landedLine: policyLanded || "no origin line at all", standing: (policyKinds.match(/^ {2}thread=.*\n {2}thread=.*\n {2}thread=.*/m) || ["no standing lines"])[0] }),
  );

  // And the OTHER half of that rule, which turns on the thread rather than on
  // the kind: step 7 resolves a push-back or a deferral only on a BOT thread and
  // leaves the human one open unless the maintainer explicitly authorized
  // otherwise. So a human push-back and a human deferral are unresolved BY
  // POLICY on a complete publication — counting either as debt, or telling its
  // entry a resolve is still owed, asks the next turn for exactly the action the
  // brief forbids, and the per-entry line is the sharper half since it is what
  // that turn acts on entry by entry. The bot push-back beside them is the
  // control: its resolve genuinely IS owed, so the count is observable in both
  // directions rather than merely small.
  // T7 is the MAINTAINER-DIRECTED human deferral, the branch step 4 does resolve
  // and the caller cannot see (the direction is `detail` prose). It is treated
  // exactly as its agent-proposed sibling — out of the count, and told the
  // resolve turns on that authorization — which is the declined half of the
  // peer's finding, driven so the decision is observable rather than argued.
  const policyResolves = briefs["a publication holding human push-backs and deferrals it owes no resolve on"];
  const resolvesLanded = (policyResolves.match(/^reached origin: .*/m) || [""])[0];
  check(
    "and the resolve debt excludes a human push-back and a human deferral — the maintainer-directed one included — while the bot thread beside them still owes one",
    // All four replies landed, so the reply half is silent; of the four threads
    // only the bot one is owed a resolve, and it is the only one counted.
    /still outstanding: 1 of 1 not resolved, the Summary comment$/.test(resolvesLanded) &&
      !/still owed their reply/.test(resolvesLanded) &&
      /thread=T4 {2}src\/app\.ts:12 a-reviewer — reply ALREADY POSTED — do not post it again; resolve NOT owed — a human push-back or deferral is left open unless the maintainer explicitly authorized resolving it; do not resolve it on this record's word\./.test(policyResolves) &&
      /thread=T5 {2}src\/app\.ts:20 a-reviewer — reply ALREADY POSTED — do not post it again; resolve NOT owed — a human push-back or deferral is left open unless the maintainer explicitly authorized resolving it/.test(policyResolves) &&
      /thread=T6 {2}src\/app\.ts:31 a-bot — reply ALREADY POSTED — do not post it again; resolve still owed\./.test(policyResolves) &&
      /thread=T7 {2}src\/app\.ts:44 a-reviewer — reply ALREADY POSTED — do not post it again; resolve NOT owed — a human push-back or deferral is left open unless the maintainer explicitly authorized resolving it/.test(policyResolves) &&
      !/(T4|T5|T7)[^\n]*resolve still owed/.test(policyResolves),
    JSON.stringify({ landedLine: resolvesLanded || "no origin line at all", standing: (policyResolves.match(/^ {2}thread=.*\n {2}thread=.*\n {2}thread=.*/m) || ["no standing lines"])[0] }),
  );

  // What a KNOWN-INCOMPLETE map may not do to a record that is already on the
  // PR. Supersession is a `PATCH` in place, so writing this run's map over an
  // earlier record destroys the entry that record holds for every item this map
  // omits, doubles, or cannot publish — the only durable copy of a previous
  // run's judgment and drafted reply for it, lost through the very mechanism
  // that exists to keep it. The replacement is still written, as a new comment
  // beside the one it does not replace: its entries are a real triage of the
  // items they do cover, and dropping them to protect the older record would
  // trade one loss for the other. The complete-map row is the control — the
  // supersession this rule must not cost the ordinary run.
  const incompleteOverPrior = briefs["an incomplete map on a PR that already carries a record"];
  const completeOverPrior = briefs["a complete map on a PR that already carries a record"];
  check(
    "a known-incomplete map is posted beside a prior record rather than superseding it in place, while a complete one still supersedes",
    /SUPERSEDES NOTHING/.test(incompleteOverPrior) &&
      /this run's map is INCOMPLETE \(1 gathered item\(s\) carry no disposition\)/.test(incompleteOverPrior) &&
      /leave every record step 1 found standing, your own included, reporting `superseded: false`/.test(incompleteOverPrior) &&
      incompleteOverPrior.includes("the most recent is https://example.invalid/pr/42#issuecomment-9") &&
      !/--method PATCH/.test(incompleteOverPrior) &&
      // And the record says it of itself, so a reader does not take a partial
      // account for the whole one.
      /- This map is INCOMPLETE \(1 gathered item\(s\) carry no disposition\), so say so in the `status:` line's reason and name the earlier record that still stands \(https:\/\/example\.invalid\/pr\/42#issuecomment-9\)/.test(incompleteOverPrior) &&
      // The control: nothing here narrows the ordinary run's one-record-per-PR
      // supersession, which is the property the whole rule is a carve-out from.
      /--method PATCH repos\/<owner>\/<repo>\/issues\/comments\/<id>/.test(completeOverPrior) &&
      !/SUPERSEDES NOTHING/.test(completeOverPrior) &&
      !/This map is INCOMPLETE/.test(completeOverPrior),
    JSON.stringify({
      incompleteStep2: (incompleteOverPrior.match(/^2\. Compose the body below[^\n]*/m) || ["no step 2"])[0].slice(0, 200),
      completeStep2: (completeOverPrior.match(/^2\. Compose the body below[^\n]*/m) || ["no step 2"])[0].slice(0, 160),
    }),
  );

  // Standing beside the new comment is not preservation on its own: the gather
  // replays only the MOST RECENT record, so once the incomplete one is posted,
  // an entry living only in the record it displaces would never be replayed
  // again — a `standalone` item only that record names never even re-gathered —
  // while the older comment stood unread. So the incomplete brief has the record
  // CARRY the displaced record's orphaned entries forward, keyed by the identity
  // publication routes on rather than by `ref`, marked as carried so a reader
  // knows this run did not re-judge them. The two controls: a complete map
  // supersedes in place and carries nothing this way, and an incomplete map on a
  // PR with NO prior record has nothing to carry and no instruction to try.
  const incompleteNoPrior = briefs["a push run whose dispositions leave a gathered item uncovered"];
  check(
    "an incomplete record carries the displaced record's orphaned entries forward — fetched from the replayed record, keyed by thread identity, marked as carried — while a complete map and a prior-less incomplete one carry nothing",
    /CARRY the earlier record's orphaned entries into this one/.test(incompleteOverPrior) &&
      /whose identity \(`thread=<threadId or url>`\) no disposition below carries/.test(incompleteOverPrior) &&
      incompleteOverPrior.includes("marking each `carried unchanged from https://example.invalid/pr/42#issuecomment-9`") &&
      /the next run's gather replays only the MOST RECENT record/.test(incompleteOverPrior) &&
      /gh api repos\/<owner>\/<repo>\/issues\/comments\/<id> --jq \.body/.test(incompleteOverPrior) &&
      // Gone or spent, the replayed record has no entries to carry — say so
      // rather than inventing any.
      /Where that comment is gone, or is spent and holds no `## Threads` block, carry nothing and say so in `detail`/.test(incompleteOverPrior) &&
      !/CARRY the earlier record's orphaned entries/.test(completeOverPrior) &&
      !/CARRY the earlier record's orphaned entries/.test(incompleteNoPrior),
    JSON.stringify({
      carry: (incompleteOverPrior.match(/CARRY the earlier record's orphaned entries[^\n]*/) || ["no carry instruction"])[0].slice(0, 160),
      completeCarries: /CARRY the earlier record's orphaned entries/.test(completeOverPrior),
      priorlessCarries: /CARRY the earlier record's orphaned entries/.test(incompleteNoPrior),
    }),
  );

  // The carry's base predicate — "no disposition below carries it" — is blind to
  // the other two shapes of the same incompleteness: a DOUBLED item's identity
  // and an UNPUBLISHABLE entry's identity ARE carried by a disposition, which is
  // exactly the account this map cannot publish, so the prior record's entry for
  // them would be skipped and stranded off the replay surface the newest record
  // becomes. The brief must name those identities as compromised — carried by
  // nothing, so the displaced record's entry is carried anyway. The uncovered
  // row above is the union shape: its one entry names a never-gathered thread,
  // so the item it left uncovered rides the base predicate while the stray
  // entry's own identities are compromised. The control: a map whose only
  // incompleteness is an uncovered item beside a CLEAN disposition names no
  // compromised identity at all.
  const doubledOverPrior = briefs["a doubled disposition on a PR that already carries a record"];
  const defectOverPrior = briefs["an unpublishable disposition on a PR that already carries a record"];
  const cleanUncoveredOverPrior = briefs["an uncovered item beside a clean disposition on a PR that already carries a record"];
  check(
    "a doubled or unpublishable disposition's identity is named compromised — carrying nothing, so the displaced record's entry for it is carried too — while a clean map's uncovered item names none",
    /this run's map is INCOMPLETE \(1 gathered item\(s\) carry more than one disposition\)/.test(doubledOverPrior) &&
      /carrying NOTHING for this test/.test(doubledOverPrior) &&
      /the identities so compromised here are `T1`, so a prior entry keyed to one of them is carried too/.test(doubledOverPrior) &&
      /this run's map is INCOMPLETE \(a disposition is not publishable/.test(defectOverPrior) &&
      /the identities so compromised here are `T1`, `https:\/\/example\.invalid\/pr\/42#d1`, so a prior entry keyed to one of them is carried too/.test(defectOverPrior) &&
      /the identities so compromised here are `T2`, `https:\/\/example\.invalid\/pr\/42#d2`/.test(incompleteOverPrior) &&
      /CARRY the earlier record's orphaned entries into this one/.test(cleanUncoveredOverPrior) &&
      !/carrying NOTHING for this test/.test(cleanUncoveredOverPrior) &&
      !/identities so compromised/.test(cleanUncoveredOverPrior),
    JSON.stringify({
      doubled: (doubledOverPrior.match(/the identities so compromised[^\n]*/) || ["no compromised clause"])[0].slice(0, 160),
      defect: (defectOverPrior.match(/the identities so compromised[^\n]*/) || ["no compromised clause"])[0].slice(0, 160),
      uncoveredUnion: (incompleteOverPrior.match(/the identities so compromised[^\n]*/) || ["no compromised clause"])[0].slice(0, 160),
      cleanHasClause: /carrying NOTHING for this test/.test(cleanUncoveredOverPrior),
    }),
  );

  // What ENDS a record. A record is replayed rather than re-triaged, and the
  // review-thread half of that replay self-terminates on the PR: step 3 keeps
  // only unresolved threads, so a record whose threads a later run resolved
  // replays to nothing. A `standalone` entry has no such state — nothing on the
  // PR marks a comment as addressed, which is exactly why the gather
  // reintroduces one FROM the record — so the record is the whole claim that the
  // item is outstanding, and one left standing over a map that has since been
  // published hands that item to every later run as fresh work, indefinitely.
  // So a full publication SPENDS the record it replayed: superseded in place,
  // marker kept so the next run still FINDS it and reads it as spent rather than
  // absent, and no entries — the absence being what leaves nothing to replay.
  // Both directions are driven, since each loses the property on its own: the
  // spend happens where a record stands, and NOTHING is written where none does,
  // a new comment there being the very thing this ends.
  const spentBrief = spends["a run that published on a PR that already carries a record"];
  const spentResult = results["a run that published on a PR that already carries a record"];
  check(
    "a run that publishes in full spends the prior record it replayed — superseded in place, marker kept, entries gone — and posts nothing where no record stands",
    // The write itself, at the repository the PR is in and never as a new comment.
    /--method PATCH repos\/<owner>\/<repo>\/issues\/comments\/<id>/.test(spentBrief) &&
      !/repos\/\{owner\}\/\{repo\}/.test(spentBrief) &&
      !/gh pr comment/.test(spentBrief) &&
      // And the record it targets is the one this run REPLAYED, named by the
      // url the gather reported, rather than "the most recent record of my
      // own" the supersession selects on. The two differ where the replayed
      // record is another actor's, and where the incomplete-map carve-out left
      // a second record of this account's standing beside an earlier one — and
      // the difference is not symmetric: a mis-targeted supersession replaces
      // one map with another, a mis-targeted spend EMPTIES one. So the id comes
      // from that url, and a PR that no longer carries it is written nothing at
      // all rather than fallen back from.
      spentBrief.includes(PRIOR_RECORD.url) &&
      /whose comment id is the number its `#issuecomment-<id>` fragment ends with/.test(spentBrief) &&
      /Where that listing does not carry that id as a record of your own[^\n]*write NOTHING/.test(spentBrief) &&
      /Do NOT fall back to the most recent record of your own, or to any other/.test(spentBrief) &&
      // The body: the marker it must still be findable by, the spent status, and
      // the two blocks whose ABSENCE is the termination.
      spentBrief.includes("<!-- address-review:disposition-record -->") &&
      /status: SPENT — the map this record held has since been published in full/.test(spentBrief) &&
      /no `## Threads` block and no `## Summary comment` block/.test(spentBrief) &&
      // The Summary comment the publisher actually posted, so a reader of the
      // spent record is sent to where the map now lives.
      spentBrief.includes("https://example.invalid/pr/42#issuecomment-5") &&
      // It is not a disposition record: the published exit still reports none.
      !spentResult.dispositionRecord &&
      spentResult.spentRecord &&
      spentResult.spentRecord.superseded === true &&
      // And the control: the same publication on a PR carrying no record writes
      // nothing at all, rather than posting one nobody asked for.
      spends["a run that published"] === "",
    JSON.stringify({
      spentStatus: (spentBrief.match(/^status: [^\n]*/m) || ["no status line"])[0].slice(0, 140),
      noPriorSpend: spends["a run that published"] ? "a spend brief was rendered with no prior record" : "none, as required",
    }),
  );

  // The THIRD state, in all three shapes it arrives in. Absence of a report is
  // not evidence of absence of mutations: the publisher pushes at step 2 and
  // replies at step 4, so a stop with a reply already on the PR is the ORDINARY
  // shape of this failure. A record asserting "nothing reached origin" over it
  // either sends a later turn to re-post a reply that landed or leaves one that
  // never landed unposted forever.
  // Each row also names the half of "what reached origin" its report DOES settle,
  // and the `status:` line that half implies. The push flags are reported
  // positively and in THREE states, so a run whose push advanced the remote knows
  // its tips are there while knowing nothing about its replies, and one whose push
  // moved nothing knows the tips are there too — calling either unknown
  // understates what the run holds. And the status line must SAY what the origin
  // line says: "UNKNOWN whether anything was published" standing two lines above
  // "the push advanced the remote branch" is one record making both claims, which
  // is why they are read out of one place and asserted together here.
  // What each of the three push states must say, in all three places the record
  // says it: the lead that tells the brief's author which rendering it is writing,
  // the `status:` line, and the line that replaces the local-only one. ONE table,
  // because the defect these replaced was exactly those three disagreeing — a
  // status of "UNKNOWN whether anything was published" standing two lines above
  // "what IS known is that the push advanced the remote branch".
  const PUSH_STATE_TEXT = {
    advanced: {
      lead: "This run's publication PUSHED and then stopped, and WHAT ELSE IT PUBLISHED IS UNKNOWN:",
      claims: "So this record says the push was published, and neither claims that any reply, resolve or Summary comment reached the PR nor claims that none did",
      status: "status: published in part (the push), and UNKNOWN whether any reply, resolve or Summary comment was published (",
      origin: "the push WAS published — it advanced the remote branch, so the tips above ARE on origin — while whether any reply, resolve or Summary comment below was published is UNKNOWN",
    },
    noop: {
      lead: "This run's publication stopped and WHAT IT PUBLISHED IS UNKNOWN:",
      claims: "Its push succeeded while moving nothing, so this record says the tips are already on origin, and neither claims that any reply, resolve or Summary comment reached the PR nor claims that none did",
      status: "status: UNKNOWN whether any reply, resolve or Summary comment was published (",
      origin: "this run's push published NOTHING — it was an `Everything up-to-date` no-op, so the tips above are already on origin though this run put nothing there — while whether any reply, resolve or Summary comment below was published is UNKNOWN",
    },
    unknown: {
      lead: "This run's publication stopped and WHAT IT PUBLISHED IS UNKNOWN:",
      claims: "So this record neither claims that nothing reached origin nor claims that anything did",
      status: "status: UNKNOWN whether anything was published (",
      origin: "whether anything reached origin is UNKNOWN — not even a push is known to have advanced the remote branch, so whether the tips above are on origin is unknown too",
    },
  };
  // Each row: why the account could not be used, and which push state the report
  // settles. The push flags are reported positively, so a run whose push advanced
  // the remote knows its tips are there while knowing nothing about its replies,
  // and one whose push moved nothing knows they are there too — calling either
  // unknown understates what the run holds, which is the same understatement in
  // the same direction.
  const unknownCases = {
    "a publisher that returned nothing at all": [
      "the publisher returned nothing at all, so no field of its report exists",
      "unknown",
    ],
    "a publication that pushed and then accounted for no thread": [
      "its account leaves 1 of 1 item(s) unnamed (T1) while reporting that the PR already carries part of this map",
      "advanced",
    ],
    "a publication whose account names one thread twice and the other not at all": [
      "its account names an item more than once (T1), so which entry is that item's outcome is undecidable",
      "advanced",
    ],
    "a publication whose no-op push left an item unaccounted": [
      "its account leaves 1 of 2 item(s) unnamed (T2) while reporting that the PR already carries part of this map",
      "noop",
    ],
    "a publication whose report carries no threadOutcomes array": [
      "its report carries no `threadOutcomes` array, so it accounts for nothing it did to any thread",
      "advanced",
    ],
    "a publication whose report omits the summaryCommentUrl": [
      "its report omits the REQUIRED `summaryCommentUrl`, so whether a Summary comment reached the PR is unstated — and a report that broke its own field contract is not read field by field, its per-thread half included",
      "advanced",
    ],
    "a publication whose account names an item this run does not hold": [
      "its account names T9, which is no disposition this run holds, so it is an account of some other work",
      "advanced",
    ],
    "a publisher claiming a COMPLETE publication over an account of nothing": [
      "its account leaves 1 of 1 item(s) unnamed (T1) while reporting that the PR already carries part of this map",
      "advanced",
    ],
  };
  const notThird = Object.entries(unknownCases).filter(([what, [why, state]]) => {
    const b = briefs[what];
    const said = PUSH_STATE_TEXT[state];
    return !(
      // All three lines, from the one table — the lead that tells the brief's
      // author which rendering it is writing, the status line, and the origin
      // line — so a record cannot say one thing in one of them and its opposite
      // in another.
      b.includes(said.lead) &&
      b.includes(said.claims) &&
      b.includes(said.status) &&
      b.includes(said.origin) &&
      b.includes(why) &&
      /the publisher pushes BEFORE it replies, so a stop with something already on origin is the ordinary shape of this failure/.test(b) &&
      // The same reservation in the one line a maintainer reads first.
      /what reached origin is UNKNOWN/.test((results[what] || {}).note || "") &&
      !/LOCAL ONLY/.test(b) &&
      !/^reached origin:/m.test(b) &&
      !/no reply, resolve or Summary comment reached it/.test(b) &&
      // The reader-warning takes the UNKNOWN case first, which is only observable
      // where a landed mutation stands beside it — the rows whose push advanced
      // the remote — and none of these may warn about the other two states.
      /a reader who takes this record for "nothing was published" either re-posts a reply that already landed or never posts one that did not/.test(b) &&
      !/takes a part-way publication for a complete one/.test(b) &&
      !/takes those SHAs for origin's/.test(b) &&
      // The only durable copy of the account that could not be used, dumped for a
      // maintainer's eye — with the rule that says why an entry claiming a landed
      // reply still leaves its thread reserved.
      /What the publisher DID report is below/.test(b) &&
      // Scoped to the ACCOUNT, which is the half that is distrusted: the same
      // record's origin line acts on the push flags two lines above, so a closing
      // clause saying no part of the report is acted on contradicts it. Both
      // mirrors state the rule with that scope ("its per-thread half included");
      // the rendering used to drop it.
      b.includes(`distrusted WHOLE, so no part of its per-thread account is acted on here, an entry that looks complete included: ${JSON.stringify(accountOf(what))}.`) &&
      // And the reservation reaches every ENTRY, which is exactly what the old
      // rendering dropped: the per-thread block was gated on something having
      // landed, so it was absent precisely when the account was missing.
      /^ {2}thread=T1 {2}src\/app\.ts:12 a-reviewer — UNKNOWN whether its reply is posted or its thread resolved: check it on the PR before replying, and before resolving\.$/m.test(b) &&
      !/ALREADY POSTED/.test(b)
    );
  });
  check(
    "and no usable account is a THIRD state — what is unknown is said as unknown, what the push settled is said as settled, and every entry carries the reservation rather than none",
    notThird.length === 0,
    notThird.map(([what]) => `${what}: ${((briefs[what] || "").match(/status: [^(]*/) || ["no status line"])[0]}`).join("; "),
  );

  // The no-op push inside the third state, which is the state a two-valued push
  // flag lost. `pushed` is the only fact that makes this account unusable at all,
  // so dropping that half renders a positive claim ("this run changed NOTHING on
  // origin … no reply, resolve or Summary comment reached it") over an item the run
  // never accounted for, and drops the per-thread block that would have said so.
  // What the run knows is that the tips are on origin and that it put them nowhere.
  const noopUnaccounted = briefs["a publication whose no-op push left an item unaccounted"];
  check(
    "a no-op push whose account is short is the third state, saying the tips are already on origin while this run put nothing there — and every entry is reserved",
    /status: UNKNOWN whether any reply, resolve or Summary comment was published \(/.test(noopUnaccounted) &&
      !/published in part/.test(noopUnaccounted) &&
      /this run's push published NOTHING — it was an `Everything up-to-date` no-op, so the tips above are already on origin though this run put nothing there/.test(noopUnaccounted) &&
      !/no reply, resolve or Summary comment reached it/.test(noopUnaccounted) &&
      !/LOCAL ONLY/.test(noopUnaccounted) &&
      /^ {2}thread=T1 {2}[^\n]*UNKNOWN whether its reply is posted/m.test(noopUnaccounted) &&
      /^ {2}thread=T2 {2}[^\n]*UNKNOWN whether its reply is posted/m.test(noopUnaccounted),
    JSON.stringify({
      status: (noopUnaccounted.match(/status: [^(]*/) || ["no status line"])[0],
      originLine: (noopUnaccounted.match(/^(this run's push|the push WAS|whether anything|this run changed|the tips above|reached origin).*/m) || ["no origin line at all"])[0].slice(0, 90),
      entries: (noopUnaccounted.match(/^ {2}thread=\S+/gm) || []).join(","),
    }),
  );

  // The PUBLISHED path's own silence, which every prior round left standing while
  // hardening the not-published one. `published: true` claims all of step 7, and
  // taken at its word over an account of nothing it exited `fixed-published`, gave
  // the worktree back, and wrote no record at all — the publisher's claim being the
  // only thing that said the replies landed.
  const claimedShort = results["a publisher claiming a COMPLETE publication over an account of nothing"];
  const claimedShortBrief = briefs["a publisher claiming a COMPLETE publication over an account of nothing"];
  check(
    "a publication reporting itself COMPLETE over a report that cannot say so is not published: the run records instead, and says which claim it refused",
    claimedShort.status === "fixed-publish-failed" &&
      // The publisher's own claim still rides out verbatim; what changed is that
      // the run no longer reads it as the answer.
      claimedShort.publishReport.published === true &&
      !claimedShort.worktreeReclaim &&
      /the publisher reported the publication COMPLETE over a report that cannot say so — its account leaves 1 of 1 item\(s\) unnamed \(T1\)/.test(claimedShortBrief) &&
      /the publisher reported it COMPLETE over a report that cannot say so/.test(claimedShort.note || "") &&
      // The other side of the split the contradiction rows drive: this report is
      // SILENT about the claim, so neither line may call it a contradiction.
      !/says the OPPOSITE/.test(claimedShortBrief) &&
      !/says the OPPOSITE/.test(claimedShort.note || ""),
    JSON.stringify({ status: claimedShort.status, claim: (claimedShort.publishReport || {}).published, note: (claimedShort.note || "").slice(0, 140) }),
  );

  // The other way a completion claim fails: not a report that cannot SAY what it
  // claims, but one whose own account says the opposite. Both rows below are
  // readable by every test above — one keyed entry per disposition, unique,
  // complete, the Summary comment's url there — so nothing else stops them, and
  // the exit they would otherwise take is the one that reclaims the worktree,
  // writes no record, and SPENDS the prior record still holding this map. The
  // unreplied row therefore runs on a PR that carries one, and no spend brief is
  // rendered for it: the durable copy survives the report that contradicted
  // itself.
  const contradicted = {
    "a publisher claiming a COMPLETE publication its own account says never replied":
      "its own account contradicts that claim — 1 of 1 thread(s) publication owes a reply report that none reached the PR, and 1 of 1 it owes a resolve report the thread still unresolved",
    "a publisher claiming a COMPLETE publication over a thread its account leaves unresolved":
      "its own account contradicts that claim — 1 of 1 it owes a resolve report the thread still unresolved",
    "a publisher claiming a COMPLETE publication whose push never succeeded":
      "its own account contradicts that claim — it reports that no push command succeeded (`pushed: false`), which no complete publication reports: step 2's push is where publication starts, and an `Everything up-to-date` no-op already reports true",
  };
  const notRefused = Object.entries(contradicted).filter(([what, why]) => {
    const r = results[what] || {};
    return !(
      r.status === "fixed-publish-failed" &&
      // The publisher's claim still rides out verbatim; what changed is that the
      // run stopped reading it as the answer.
      (r.publishReport || {}).published === true &&
      !r.worktreeReclaim &&
      // And it is refused in the words of what it DID: a report whose own
      // entries say the opposite of the claim is not a report that could not
      // say so. Both readers of that phrase — the record's `status:` line and
      // the note a maintainer reads first — must carry the same one, and
      // neither may fall back to the silence wording that the rows above earn.
      briefs[what].includes(`the publisher reported the publication COMPLETE over a report that says the OPPOSITE — ${why}`) &&
      !briefs[what].includes("over a report that cannot say so") &&
      (r.note || "").includes("the publisher reported it COMPLETE over a report that says the OPPOSITE") &&
      !(r.note || "").includes("over a report that cannot say so")
    );
  });
  check(
    "a completion claim its own account CONTRADICTS is refused like one it cannot support — over the push half, the reply half and the resolve half alike — and is told as a contradiction rather than as a silence, so the worktree is kept, the record written, and the prior record not spent",
    notRefused.length === 0 &&
      spends["a publisher claiming a COMPLETE publication its own account says never replied"] === "" &&
      spends["a publisher claiming a COMPLETE publication whose push never succeeded"] === "",
    JSON.stringify({
      notRefused: notRefused.map(([what]) => `${what}: ${(results[what] || {}).status}`),
      spentAnyway: [
        spends["a publisher claiming a COMPLETE publication its own account says never replied"] ? "a spend brief was rendered over a contradicted claim" : "",
        spends["a publisher claiming a COMPLETE publication whose push never succeeded"] ? "a spend brief was rendered over an unpushed completion claim" : "",
      ].filter(Boolean).join("; ") || "none, as required",
    }),
  );

  // The landed lead's one claim about the TIPS, which used to be unconditional:
  // replies and resolves land through the API, so a map part-way on the PR does
  // not imply a push, and the refused unpushed completion claim above is landed
  // — its replies are on the PR — while its own account says no push succeeded,
  // so its tips are still local-only. The two controls are the landed shapes
  // whose tips ARE on origin: a push that advanced the remote, and a no-op push
  // over a reply already posted.
  const unpushedClaimBrief = briefs["a publisher claiming a COMPLETE publication whose push never succeeded"];
  check(
    "a landed map with no successful push is told its tips are still LOCAL-ONLY, while a landed map whose push advanced the remote or no-opped keeps NOT local-only",
    /and its tips are still LOCAL-ONLY — replies and resolves land through the API without a push, and this run's own account reports no successful push, so what is on the PR does not put these tips on origin/.test(unpushedClaimBrief) &&
      !/its tips are NOT local-only/.test(unpushedClaimBrief) &&
      /and its tips are NOT local-only/.test(partWay) &&
      !/still LOCAL-ONLY/.test(partWay) &&
      /and its tips are NOT local-only/.test(noopPrior) &&
      !/still LOCAL-ONLY/.test(noopPrior),
    JSON.stringify({
      unpushed: (unpushedClaimBrief.match(/and its tips are [^\n]*/) || ["no tips clause"])[0].slice(0, 120),
      partWay: (partWay.match(/and its tips are [^\n]*/) || ["no tips clause"])[0].slice(0, 60),
      noopPrior: (noopPrior.match(/and its tips are [^\n]*/) || ["no tips clause"])[0].slice(0, 60),
    }),
  );

  // And the RECORD LINE carries the same tips fact durably, which is the surface
  // the skill's part-way paragraph attributes it to — the brief's lead dies with
  // the run, while the `reached origin:` line is what a later turn replays — so
  // this pin reads that line rather than the lead: the API-landed shape appends
  // its still-LOCAL-ONLY clause, the no-op shape appends already-on-origin
  // (asserted in full on its own row above), and the advanced shape appends
  // nothing, its landed list already naming the push that put the tips there.
  check(
    "the replacement line itself says where the push leaves the tips — still LOCAL-ONLY appended on an API-landed map, already-on-origin appended on a no-op push, nothing appended where the landed push already says it",
    /^reached origin: [^\n]+ — and the tips above are still LOCAL-ONLY: what landed rode the API with no successful push, so nothing of the branch is on origin$/m.test(unpushedClaimBrief) &&
      /^reached origin: [^\n]+ — and the tips above are already on origin, this run having put nothing there: its push was an `Everything up-to-date` no-op$/m.test(noopPrior) &&
      /^reached origin: the push, which advanced the remote branch — still outstanding: [^\n]+$/m.test(partWay) &&
      !/— and the tips above are/.test(partWay),
    JSON.stringify({
      unpushedLine: (unpushedClaimBrief.match(/^reached origin: .*/m) || ["no origin line at all"])[0].slice(-130),
      noopPriorLine: (noopPrior.match(/^reached origin: .*/m) || ["no origin line at all"])[0].slice(-130),
      partWayLine: (partWay.match(/^reached origin: .*/m) || ["no origin line at all"])[0],
    }),
  );

  // And the controls that keep that gate off the publications this workflow's own
  // brief PRESCRIBES, which is the only way the stronger test could be wrong: a
  // `standalone` item and an `ambiguous-skipped` thread are never replied to at
  // all, and a human push-back or deferral is left unresolved by policy while the
  // bot push-back beside it is resolved. Every one of those entries reports
  // `replied: false` or `resolved: false` on a genuinely COMPLETE publication, so
  // a gate that read the raw account rather than what step 4 OWES would refuse
  // them — and these two rows are what says it does not.
  // The second row also carries the MAINTAINER-DIRECTED human deferral, whose
  // resolve step 4 does owe and this gate cannot see. It publishes over
  // `resolved: false` there, which is the residual the completion gate's own
  // comment names and bounds: the thread stays unresolved on the PR and the next
  // gather takes it back as an item, while the reply — the half a spend would
  // destroy — is already posted. Driven here so the decision is a fixture rather
  // than an argument, and so a later round that buys the missing field breaks
  // this row rather than finding nothing to change.
  const prescribed = [
    "a complete publication over the two kinds it owes no reply",
    "a complete publication leaving human push-backs and deferrals unresolved by policy",
  ];
  const wronglyRefused = prescribed.filter((what) => {
    const r = results[what] || {};
    return !(
      r.status === "fixed-published" &&
      !r.dispositionRecord &&
      briefs[what] === "" &&
      // And the tree GOES BACK, which is the half the refused rows above must
      // not reach. Both rows run in worktree mode, so this is the reclaim
      // actually happening rather than the absent one an inline row reports.
      r.worktreeReclaim &&
      r.worktreeReclaim.removed === true
    );
  });
  check(
    "while the publications the publish brief prescribes still publish and give their worktree back — the two kinds it never replies to, and the human push-back or deferral it leaves open by policy, the maintainer-directed one included",
    wronglyRefused.length === 0,
    wronglyRefused.map((what) => `${what}: ${(results[what] || {}).status}`).join("; "),
  );

  // And the half of that requirement the account test cannot carry: an account
  // this run CAN read, short only of the Summary comment step 7 ends with. Nothing
  // is unknown, so the record renders the part-way publication it is — with the
  // Summary as the one thing outstanding, which is exactly what a later turn owes.
  // Both shapes of that missing Summary: the field EMPTY, and the field present
  // and BLANK. The URL is the string that decides `published`, so it decides it
  // trimmed — otherwise the whitespace row is a truthy URL, the completion claim
  // is accepted, and the run exits `fixed-published` with the worktree given back
  // and no record at all. One removed `.trim()` restores exactly that, and the
  // empty-field row cannot see it.
  const claimedNoSummaryBriefs = {
    "an empty summaryCommentUrl": briefs["a publisher claiming a COMPLETE publication with no Summary comment posted"],
    "a whitespace-only summaryCommentUrl": briefs["a publisher claiming a COMPLETE publication over a blank Summary comment url"],
  };
  const summaryNotOutstanding = Object.entries(claimedNoSummaryBriefs).filter(([, b]) => !(
    /status: published in part \(/.test(b) &&
    /^reached origin: the push, which advanced the remote branch, 1 thread reply, 1 thread resolve — still outstanding: the Summary comment$/m.test(b) &&
    /it names no `summaryCommentUrl`, so the Summary comment step 7 ends with is not on the PR/.test(b) &&
    !/UNKNOWN whether/.test(b) &&
    /thread=T1 {2}src\/app\.ts:12 a-reviewer — reply ALREADY POSTED — do not post it again; thread ALREADY RESOLVED — do not resolve it again\./.test(b)
  ));
  check(
    "and one whose account IS readable but names no posted Summary comment records a part-way publication with the Summary outstanding, nothing unknown — a url reported as whitespace being no url",
    summaryNotOutstanding.length === 0,
    summaryNotOutstanding.map(([what, b]) => `${what}: ${(b.match(/status: [^(]*/) || ["no status line"])[0]} / ${(b.match(/^reached origin: .*/m) || ["no origin line at all"])[0]}`).join("; "),
  );

  // Both halves of the same rule in the other direction, so the third state
  // cannot swallow the two that ARE knowable: a publisher whose push never
  // succeeded and whose account is empty reported four facts, not none — nothing
  // pushed, nothing replied, nothing resolved, no Summary — and the steps run in
  // that order, so `[]` is the complete account of having acted on no thread.
  const nothingBrief = briefs["a publication that aborted with nothing on origin"];
  check(
    "while an empty account from a publisher that never pushed stays the knowable case, not the unknown one",
    !/UNKNOWN/.test(nothingBrief) &&
      /the tips above are LOCAL ONLY/.test(nothingBrief) &&
      /nothing reached origin: its own account reports no push, no reply, no resolve and no Summary comment/.test(nothingBrief),
    (nothingBrief.match(/status: [^(]*/) || ["no status line"])[0],
  );

  // And the schema half, which is what makes silence visible at all: read out of
  // an ABSENT field, `threadOutcomes` is `[]` and `summaryCommentUrl` is `""` —
  // two positive claims about what did not happen, from a report that said
  // nothing. Required, the same silence is a schema violation.
  check(
    "and the two fields those claims are derived from are required, so a silent publisher is a visible violation",
    ["published", "pushed", "pushedNewCommits", "threadOutcomes", "summaryCommentUrl"].every((f) => (PUBLISH_SCHEMA.required || []).includes(f)) &&
      /REQUIRED on every report, ABORTED ONES INCLUDED/.test(PUBLISH_SCHEMA.properties.threadOutcomes.description) &&
      /REQUIRED on every report, aborted ones included/.test(PUBLISH_SCHEMA.properties.summaryCommentUrl.description),
    JSON.stringify(PUBLISH_SCHEMA.required),
  );

  // A re-verification that returned NOTHING holds the map that passed review on
  // the base before the replay — `cycle` is not reassigned until the merge below
  // it — so it is the exhausted-budget exit's case, not the cycle-error exits'.
  // The reason must say which base that verdict was rendered on, or the record
  // overstates itself.
  const reverifyGone = briefs["a re-verification that returned nothing"];
  check(
    "a re-verification that returned nothing records the map that passed before the replay, saying which base that verdict was rendered on",
    /the re-verification cycle returned nothing, so no verdict describes the rebased tree/.test(reverifyGone) &&
      /The dispositions below passed review on the base the branch sat on before that replay/.test(reverifyGone) &&
      /reviewer Pass \(3 round\(s\)\)/.test(reverifyGone) &&
      reverifyGone.includes(CYCLE_PASS.workReport[0].detail) &&
      /refs\/pre-rebase\/feature\/x\/20260809-121314/.test(results["a re-verification that returned nothing"].note || ""),
    JSON.stringify({
      reason: (reverifyGone.match(/This run published NOTHING: [^\n]*/) || ["no reason line"])[0].slice(0, 160),
      note: results["a re-verification that returned nothing"].note,
    }),
  );

  // The declined half, stated as the fact it now rests on rather than as the exit
  // it used to be keyed on: a map NO REVIEWER ROUND JUDGED. The merged report of
  // a failed re-verification is that cycle's OWN map rather than the pre-rebase
  // one — `mergedCycle` spreads `after` — so on that exit the unjudged map is
  // withheld while the map that PASSED on the pre-replay base is recorded, and
  // both ride out in the result under keys of their own. Dropping the passing map
  // was the loss this task exists to prevent, committed by the record itself.
  const erroredReverify = results["a re-verification that errored with no round behind its map"];
  const erroredReverifyBrief = briefs["a re-verification that errored with no round behind its map"];
  check(
    "a cycle that errored over an unjudged map records nothing of it, while the map that PASSED before the replay is recorded rather than dropped",
    Array.isArray(erroredReverify.dispositions) &&
      erroredReverify.dispositions.length === 1 &&
      erroredReverify.dispositions[0].detail === CYCLE_REVERIFIED_ERROR.workReport[0].detail &&
      // Both maps ride out, each under its own key, so which one the record holds
      // never has to be inferred.
      erroredReverify.preRebaseDispositions[0].detail === CYCLE_PASS.workReport[0].detail &&
      // And the record is the one that passed, not the one that errored.
      erroredReverifyBrief.includes(CYCLE_PASS.workReport[0].detail) &&
      !erroredReverifyBrief.includes(CYCLE_REVERIFIED_ERROR.workReport[0].detail) &&
      /errored with no judged map of its own to record — no reviewer round passed over a map with entries over the rebased tree/.test(erroredReverifyBrief) &&
      /The dispositions below are the ones that PASSED review on the base the branch sat on before that replay/.test(erroredReverifyBrief) &&
      /reviewer Pass, on the base the branch sat on before the replay \(3 round\(s\)\)/.test(erroredReverifyBrief) &&
      // The first cycle's error, over a map nothing judged, records nothing at
      // all — there is no second map behind it to record.
      results["a first cycle that errored with no round behind its map"].dispositions.length === 1 &&
      !results["a first cycle that errored with no round behind its map"].dispositionRecord,
    JSON.stringify({
      mergedDetail: (erroredReverify.dispositions || [{}])[0].detail,
      preRebase: (erroredReverify.preRebaseDispositions || [{}])[0].detail,
      reason: (erroredReverifyBrief.match(/This run published NOTHING: [^\n]*/) || ["no reason line"])[0].slice(0, 120),
    }),
  );

  // And the case that refutes keying the exemption on the exit's NAME at all.
  // `wf-review-cycle` sets `confirming` only after a round PASSED, and its
  // confirmation pass can stop the cycle — returning nothing, blocking, coming
  // back on an unclean worktree — so an `error` verdict standing over the very
  // map that just passed review is an ordinary outcome rather than a contrived
  // one. Withholding a record there loses a reviewed map with drafted replies
  // nobody will ever post, which is exactly the loss task 021a is about.
  const errorAfterPass = briefs["a first cycle that errored after a round had passed over its map"];
  const reverifyErrorAfterPass = briefs["a re-verification that errored after a round had passed over its map"];
  check(
    "and an error verdict standing over a map a round DID pass is recorded on both exits, saying which round rendered it",
    /errored AFTER a reviewer round had passed over the dispositions below/.test(errorAfterPass) &&
      /the final confirmation pass returned nothing on pass 4/.test(errorAfterPass) &&
      /reviewer passed a round, after which the cycle errored \(3 round\(s\)\)/.test(errorAfterPass) &&
      errorAfterPass.includes(CYCLE_PASS.workReport[0].detail) &&
      // The post-rebase twin records ITS map — the newer of the two, judged over
      // the rebased tree — rather than the pre-rebase one.
      /the post-rebase re-verification errored AFTER a reviewer round had passed over the dispositions below/.test(reverifyErrorAfterPass) &&
      /judged over the rebased tree/.test(reverifyErrorAfterPass) &&
      reverifyErrorAfterPass.includes(CYCLE_REVERIFIED_ERROR.workReport[0].detail) &&
      results["a re-verification that errored after a round had passed over its map"].preRebaseDispositions[0].detail === CYCLE_PASS.workReport[0].detail,
    JSON.stringify({
      firstReason: (errorAfterPass.match(/This run published NOTHING: [^\n]*/) || ["no reason line"])[0].slice(0, 120),
      reverifyReason: (reverifyErrorAfterPass.match(/This run published NOTHING: [^\n]*/) || ["no reason line"])[0].slice(0, 120),
    }),
  );

  // And the tip THAT map is cited over, which the `carried` case used to read in
  // the working location on the reasoning that the two are the same commit. They
  // are not always: a pass packet is adopted only once the cycle accepts it,
  // while the working location's HEAD moves the moment that pass COMMITS — so a
  // pass that commits and is then rejected before adoption leaves the cycle's
  // `finalSha` at the reviewed tip while `git rev-parse HEAD` prints a later one.
  // Reading it there would cite a tree no reviewer passed, and since the recorded
  // commits are all its ancestors the next run's replay probe prints nothing and
  // the record reads as replaying as written. So `carried` cites the reported tip
  // exactly as `replaced` does.
  const carriedMoved = briefs["a first cycle that errored after a pass committed and was then rejected"];
  check(
    "and a carried map cites the tip the cycle reported for the round that judged it, rather than reading the working location a rejected pass may have moved",
    /The `final HEAD` below is `0ddba11` — the tip that verdict WAS rendered over — rather than the tip standing in the working location, which a later pass may have moved past\./.test(carriedMoved) &&
      /\| final HEAD 0ddba11 \| recorded headRefOid/.test(carriedMoved) &&
      /`final HEAD` is given above as `0ddba11` — write it EXACTLY as given and read no tip for it/.test(carriedMoved) &&
      // Still the carried map's own reason, not the replaced one's.
      /errored AFTER a reviewer round had passed over the dispositions below/.test(carriedMoved) &&
      carriedMoved.includes(CYCLE_PASS.workReport[0].detail),
    JSON.stringify({
      header: (carriedMoved.match(/^starting HEAD [^\n]*/m) || ["no header line"])[0].slice(0, 140),
    }),
  );

  // And the two shapes where the judged map is NOT the map the cycle carries out,
  // which selecting on "was the carried map reviewed" alone got wrong in opposite
  // directions. A later pass REPLACING a judged map left that map recorded nowhere
  // and carried under no key of its own — the loss this whole mechanism exists
  // against, reached through the flag meant to prevent it. A judged map with NO
  // ENTRIES records nothing (which is right for the map) and used to suppress the
  // record outright (which loses the pre-rebase map that passed review with its
  // drafted replies). So the selection takes the most recent judged map that HAS
  // entries, and falls through when it has none.
  const replacedFirst = briefs["a first cycle that errored after a later pass replaced the map a round passed"];
  const replacedReverify = briefs["a re-verification that errored after a later pass replaced the map its round passed"];
  const emptyReviewed = briefs["a re-verification whose passing round judged a map with no entries"];
  const emptyReviewedResult = results["a re-verification whose passing round judged a map with no entries"];
  check(
    "the map RECORDED is the most recent JUDGED one with entries — a judged map a later pass replaced is recorded rather than lost, and a judged EMPTY one falls through rather than suppressing the record",
    // The first cycle's exit: the judged map, not the unjudged replacement it is
    // carrying out (which rides out under `dispositions`).
    replacedFirst.includes("judged by round 1, then replaced by a later pass") &&
      !replacedFirst.includes(CYCLE_PASS.workReport[0].detail) &&
      /errored after a later pass had SUPERSEDED the map a reviewer round passed over — replacing its entries, or committing a new tip under the same ones —/.test(replacedFirst) &&
      /reviewer passed a round, after which a later pass superseded the map it judged and the cycle errored/.test(replacedFirst) &&
      // The tip the record cites is the one the recorded verdict was rendered
      // over — `reviewedFinalSha` — and NOT the working location's, which a
      // later pass moved past. Both halves are pinned: the reason says which it
      // is, and the header line carries that SHA in place of the read the
      // ordinary run makes. Said at all because "replaced" alone reads as a
      // claim the same-map/new-tip shape falsifies: the cycle reports
      // `workReportReviewed: false` for a later pass that committed a new
      // `finalSha` over the IDENTICAL entries, and nothing was replaced there —
      // what changed is the tree under the map. And cited rather than merely
      // caveated because a replay PROBES this field: with the recorded commits
      // all ancestors of the later tip, probing that tip prints nothing and the
      // record reads as replaying as written over a tree no reviewer passed.
      /The `final HEAD` below is `feedface` — the tip that verdict WAS rendered over — rather than the tip standing in the working location, which a later pass may have moved past\./.test(replacedFirst) &&
      /\| final HEAD feedface \| recorded headRefOid/.test(replacedFirst) &&
      /`final HEAD` is given above as `feedface` — write it EXACTLY as given and read no tip for it/.test(replacedFirst) &&
      // The post-rebase exit: its own judged map, not the pre-rebase map that used
      // to stand in for it, and not the replacement either.
      replacedReverify.includes("judged over the rebased tree, then replaced by a later pass") &&
      !replacedReverify.includes(CYCLE_REVERIFIED_ERROR.workReport[0].detail) &&
      !replacedReverify.includes(CYCLE_PASS.workReport[0].detail) &&
      // Both halves of that same wording on the post-rebase twin, which renders
      // its own copy of it.
      /errored after a later pass had SUPERSEDED the map its reviewer round passed over — replacing its entries, or committing a new tip under the same ones —/.test(replacedReverify) &&
      /reviewer passed a round over the rebased tree, after which a later pass superseded the map it judged and the cycle errored/.test(replacedReverify) &&
      /The `final HEAD` below is `feedface` — the tip that verdict WAS rendered over — rather than the tip standing in the working location, which a later pass may have moved past\./.test(replacedReverify) &&
      /\| final HEAD feedface \| recorded headRefOid/.test(replacedReverify) &&
      // The empty judged map: the record is written, over the map that passed on
      // the pre-replay base, rather than not written at all.
      emptyReviewed.includes(CYCLE_PASS.workReport[0].detail) &&
      /no reviewer round passed over a map with entries over the rebased tree/.test(emptyReviewed) &&
      emptyReviewedResult.dispositions.length === 0 &&
      emptyReviewedResult.preRebaseDispositions[0].detail === CYCLE_PASS.workReport[0].detail &&
      // And the field those fixtures are named after is one the cycle actually
      // REPORTS. The cycle is stubbed here, so every row above would keep passing
      // over a field `wf-review-cycle` had stopped emitting — the selection then
      // silently falling back to the pre-rebase map in production while the suite
      // stayed green. So it is read from the producer's SOURCE here. This is the
      // cheap textual half rather than the only guard on that contract:
      // `test-review-cycle-retirement` joins the two halves BEHAVIOURALLY on both
      // of its workflow legs, driving the cycle and asserting what it reports in
      // that field — the same-map/new-tip shape included.
      readFileSync(join(here, "..", "plugins", "dev-skills", "workflows", "wf-review-cycle.js"), "utf8")
        .includes("{ reviewedWorkReport: reviewedPass.workReport, reviewedFinalSha: reviewedPass.finalSha }"),
    JSON.stringify({
      replacedFirst: (replacedFirst.match(/This run published NOTHING: [^\n]*/) || ["no reason line"])[0].slice(0, 130),
      replacedReverify: (replacedReverify.match(/This run published NOTHING: [^\n]*/) || ["no reason line"])[0].slice(0, 130),
      emptyReviewed: (emptyReviewed.match(/This run published NOTHING: [^\n]*/) || ["no reason line"])[0].slice(0, 130),
    }),
  );

  // The producer of that breakdown. Nothing else in the run can answer "did this
  // reply reach the PR": `pushed` says only that a push command succeeded, and an
  // `outcome` string is prose. So the publisher reports the two facts per thread,
  // keyed by the identity publication routes on rather than by a `ref` two
  // threads share, and reports them on the path that needs them most — the one
  // where it aborted.
  const outcomeItem = PUBLISH_SCHEMA.properties.threadOutcomes.items;
  const publishBriefRun = await run(gathered(withWork), { args: "push no-rebase", cycles: [CYCLE_PASS] });
  const pubBrief = publishBriefRun.seen.publishPrompts[0] || "";
  check(
    "and the publisher is what produces it — per thread, the state ON THE PR when its turn ended, keyed by threadId/url, and reported even where publication aborted",
    ["ref", "outcome", "replied", "resolved"].every((f) => (outcomeItem.required || []).includes(f)) &&
      /True ONLY if the reply is ON THE PR when your turn ends/.test(outcomeItem.properties.replied.description) &&
      /Never what you intended or attempted/.test(outcomeItem.properties.resolved.description) &&
      // And the one shape in which "what SUCCEEDED" and "what is on the PR"
      // differ: a reply step 4's duplicate rule told the publisher to SKIP,
      // an equivalent one of its own already being there. Reported false, the
      // caller reads a complete publication as still owing that reply — which
      // the completion gate now refuses over — and a later turn posts it twice.
      /a reply you skipped under step 4's duplicate rule, an equivalent one of yours already being there, is on the PR/.test(outcomeItem.properties.replied.description) &&
      /true likewise for a thread you found already resolved rather than resolving yourself/.test(outcomeItem.properties.resolved.description) &&
      /MANDATORY on a `review-thread` item's entry/.test(outcomeItem.properties.threadId.description) &&
      /two threads a re-review left on the same line by the same author share it, so it can key nothing/.test(outcomeItem.properties.ref.description) &&
      /REQUIRED on every report, ABORTED ONES INCLUDED/.test(PUBLISH_SCHEMA.properties.threadOutcomes.description) &&
      // And the field's own description says which question it answers, since
      // that is what a record's `landed` is derived from: where each item
      // STANDS on the PR, not what this publisher wrote.
      /Your ACCOUNT of where each item STANDS ON THE PR when your turn ends/.test(PUBLISH_SCHEMA.properties.threadOutcomes.description) &&
      /`landed` is what the PR CARRIES rather than what this run put there/.test(PUBLISH_SCHEMA.properties.threadOutcomes.description) &&
      /NOT evidence that anything this run did reached origin/.test(PUBLISH_SCHEMA.properties.pushed.description) &&
      /set that entry's `replied` and `resolved` to the state of the thread ON THE PR when your turn ends rather than to what you attempted/.test(pubBrief) &&
      /a reply you skipped under the duplicate rule above, an equivalent one of yours already being there, is `replied: true`/.test(pubBrief) &&
      /Report them even where publication stops part-way, and report EXACTLY ONE entry per item you were given/.test(pubBrief) &&
      /an account keyed on it cannot say which of them was replied to/.test(pubBrief),
    JSON.stringify({ required: outcomeItem.required, brief: /threadOutcomes/.test(pubBrief) }),
  );

  // The brief itself. What a later run needs from this comment is the marker
  // that finds it, the supersession that keeps one per PR, the reply bodies
  // verbatim, and the two things a replay must NOT take from it: the SHAs as a
  // condition, and the tips as commits on origin.
  const recordClauses = {
    // The lookup selects the comment a `PATCH` then overwrites, so what it
    // matches on is a hazard and not a detail: the marker is DEFINED as the
    // body's first line, and a `contains` test also selects an ordinary comment
    // that merely quotes it. The author filter stays either way.
    "the marker a later run matches, as the body's first line and not by a substring":
      /<!-- address-review:disposition-record -->/.test(recordBrief) &&
      /the MARKER identifies a record, never its prose/.test(recordBrief) &&
      recordBrief.includes('select((.body | split("\\n")[0] | rtrimstr("\\r")) == "<!-- address-review:disposition-record -->")') &&
      !/select\(\.body \| contains\(/.test(recordBrief) &&
      /Keep the ones authored by the authenticated user/.test(recordBrief),
    "superseding its own prior record in place rather than appending a second": /--method PATCH repos\/<owner>\/<repo>\/issues\/comments\/<id>/.test(recordBrief) && /instead of a stack of near-duplicates/.test(recordBrief),
    // All three of this brief's PR writes address the repository the PR is IN,
    // named from the PR's own URL. Left to `{owner}`/`{repo}` and a bare `gh pr
    // comment`, every one of them answers for the current directory's
    // repository — the HEAD fork on a cross-repository PR — so the lookup finds
    // no prior record, the PATCH addresses a comment id in the fork, and the
    // create posts onto a same-numbered PR there. The negative half is the
    // point: a re-introduced placeholder fails rather than passing on the
    // prose alone.
    "the three PR writes qualified at the repository the PR is in, named from its own URL":
      recordBrief.includes("the PR's own URL `https://example.invalid/pr/42`") &&
      /gh api --paginate repos\/<owner>\/<repo>\/issues\/\d+\/comments/.test(recordBrief) &&
      /gh pr comment \d+ --repo <owner>\/<repo> --body-file -/.test(recordBrief) &&
      !/repos\/\{owner\}\/\{repo\}/.test(recordBrief) &&
      /never the repository your working location resolves to/.test(recordBrief),
    "exactly one PR write, and no reply, resolve, push or ping beside it": /You make exactly ONE PR write/.test(recordBrief) && /no push, no reply, no resolve, no Summary comment, no ping/.test(recordBrief),
    "the drafted replies and the ready-to-post Summary body, verbatim": /reply: "<the exact reply body a publishing turn would post, verbatim>"/.test(recordBrief) && /ready to post unchanged/.test(recordBrief),
    // Which thread a follow-up closes is not re-derivable from the PR, so an
    // entry carrying only its task file cannot be replayed at all.
    "every entry carrying the same field set whatever its kind":
      /EVERY entry carries the same field set whatever its kind/.test(recordBrief) &&
      /beside them rather than in place of them/.test(recordBrief),
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

  // The PUBLISH brief's own PR-scoped calls, qualified the same way and for the
  // same reason — and this is the brief that MUTATES the PR. It is handed to a
  // subagent told to read `AGENTS.md`/`CLAUDE.md` and nothing else, so it never
  // receives the skill's "GitHub API recipes" section where the rule is
  // otherwise stated once: a rule stated only there is no coverage for the
  // agent that reads THIS text. Both halves are asserted, and the negative one
  // is the point — a re-introduced `{owner}`/`{repo}` placeholder or a bare
  // `gh pr comment` fails here rather than passing on the recipes' prose.
  // Every ping flag is set so the arms that carry three of these calls render.
  const qualifiedPub = publishPrompt(
    gathered({ reconcile: { outcome: "work" } }),
    [],
    { push: true, pingCodex: true, pingClaude: true, pingCopilot: true },
    [],
    [],
  );
  // The calls it ORDERS are the ones carrying a PR argument. The bare spellings
  // it also names are not calls to qualify: the WHICH REPOSITORY paragraph
  // quotes them as the defaults it is warning against, and steps 2 and 6 name
  // `gh pr view --json …` as an evidence channel they forbid outright.
  const orderedPrCalls = qualifiedPub.match(/gh pr (?:view|comment|edit) (?:\d+|<PR#>)[^`]*/g) || [];
  const publishClauses = {
    "the WHICH REPOSITORY paragraph, naming the repository from the PR's own URL":
      qualifiedPub.includes("the PR's own URL `https://example.invalid/pr/42`") &&
      /never the repository your working location resolves to/.test(qualifiedPub) &&
      /Do not re-derive it from a bare `gh repo view --json nameWithOwner`/.test(qualifiedPub),
    "step 1's head-repository read": /gh pr view 42 --repo <owner>\/<repo> --json headRepository,headRepositoryOwner,isCrossRepository/.test(qualifiedPub),
    "step 4's reply POST": /gh api --method POST repos\/<owner>\/<repo>\/pulls\/42\/comments\/<commentId>\/replies/.test(qualifiedPub),
    // The resolve mutation has no repository argument to carry, so the brief
    // says what stands in for one rather than leaving it implied.
    "step 4's resolve, qualified by the thread id's provenance rather than by an argument it has none of":
      /has no repository argument to qualify, so what qualifies it is the id's PROVENANCE/.test(qualifiedPub) &&
      /never re-fetch or re-derive a thread id in your own turn/.test(qualifiedPub),
    "step 5's Summary comment": /gh pr comment 42 --repo <owner>\/<repo>/.test(qualifiedPub),
    "step 6's codex and claude pings, each naming the command it posts with":
      (qualifiedPub.match(/gh pr comment <PR#> --repo <owner>\/<repo>/g) || []).length === 2,
    "step 6's Copilot request and both of its timeline reads":
      /gh pr edit <PR#> --repo <owner>\/<repo> --add-reviewer @copilot/.test(qualifiedPub) &&
      /repos\/<owner>\/<repo>\/pulls\/<PR#>\/requested_reviewers/.test(qualifiedPub) &&
      /repos\/<owner>\/<repo>\/issues\/<PR#>\/timeline/.test(qualifiedPub),
    "no `{owner}`/`{repo}` placeholder left anywhere in it": !/\{owner\}\/\{repo\}/.test(qualifiedPub),
    "and no ordered `gh pr` call left bare":
      orderedPrCalls.length >= 5 && orderedPrCalls.every((call) => call.includes("--repo <owner>/<repo>")),
  };
  const publishAbsent = Object.entries(publishClauses).filter(([, present]) => !present).map(([name]) => name);
  check(
    "and the publish brief qualifies every PR-scoped call it orders at the repository the PR is in, named from its own URL",
    publishAbsent.length === 0,
    publishAbsent.length ? `missing: ${publishAbsent.join("; ")}` : `all ${orderedPrCalls.length} ordered \`gh pr\` calls carry --repo, and no placeholder survives`,
  );

  // `starting HEAD` is part of the record's single canonical content, so it
  // cannot be sourced from a rebase report: these rows all run `no-rebase`, so
  // there is no rebase point at all, and the tip the GATHER read is the only one
  // that exists. The brief must carry it rather than the not-recorded fallback.
  const STARTING_TIP = "5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a";
  const withTip = await run(gathered({ ...withWork, startingHead: STARTING_TIP }), { args: "no-push no-rebase", cycles: [CYCLE_PASS] });
  const tipBrief = withTip.seen.recordPrompts[0] || "";
  check(
    "and a `no-rebase` run's record still cites the starting tip, from the gather rather than a rebase report",
    tipBrief.includes(`starting HEAD ${STARTING_TIP} | final HEAD`) && !/not recorded/.test(tipBrief),
    (tipBrief.match(/starting HEAD [^|]*/) || ["no starting HEAD line"])[0],
  );
  // And where neither the gather nor a rebase reported one, the brief says so
  // instead of inventing a tip — the fallback that keeps a missing provenance
  // field from costing the record.
  const noTip = await run(gathered({ ...withWork, startingHead: null }), { args: "no-push no-rebase", cycles: [CYCLE_PASS] });
  const noTipBrief = noTip.seen.recordPrompts[0] || "";
  check(
    "and says it was not recorded where nothing reported one, rather than inventing a tip",
    /starting HEAD \(not recorded — neither the gather nor a rebase point reported one\)/.test(noTipBrief),
    (noTipBrief.match(/starting HEAD [^|]*/) || ["no starting HEAD line"])[0],
  );
  // The record's header, THREE copies of one shape: the skill's Content block in
  // both mirrors, and the brief that renders it. They drifted at birth — the
  // change that created both grouped `base` on a different line in each — which
  // is the two-copies failure this skill family's implementation notes warn
  // about, and nothing but a reader's eye had ever compared them. So the FIELD
  // GROUPING is pinned here: which fields share a line, in which order, in all
  // three. Values are not compared (the skill's are examples, the brief's are
  // placeholders); a field is matched by the name it opens with.
  const HEADER_LINES = [
    ["starting HEAD", "final HEAD", "recorded headRefOid"],
    ["base", "validation", "reviewer", "peer"],
  ];
  const headerGrouping = (text) =>
    HEADER_LINES.map((fields) => {
      const line = text.split("\n").find((l) => l.startsWith(`${fields[0]} `));
      if (!line) return `(no line opening with "${fields[0]}")`;
      return line
        .split(" | ")
        .map((field) => fields.find((name) => field.startsWith(name)) || `(unexpected field: ${field.slice(0, 24)})`)
        .join(" | ");
    }).join(" / ");
  const wantedGrouping = HEADER_LINES.map((fields) => fields.join(" | ")).join(" / ");
  const groupings = { "the record brief": headerGrouping(tipBrief) };
  for (const mirror of ["plugins/dev-skills/skills", "codex/dev-skills/skills"]) {
    groupings[mirror] = headerGrouping(readFileSync(join(here, "..", mirror, "address-review", "SKILL.md"), "utf8"));
  }
  const drifted = Object.entries(groupings).filter(([, g]) => g !== wantedGrouping);
  check(
    "and the record header groups its fields identically in the brief and in both mirrors of the skill that defines the shape",
    drifted.length === 0,
    drifted.map(([who, g]) => `${who}: ${g}`).join("; ") || wantedGrouping,
  );

  // The three rules this round settled, in the skill that DEFINES the record —
  // both mirrors, since the brief is one rendering of that section and a rule
  // living only in the brief is a rule the next reader of the skill will
  // contradict. Read as text because they are prose no scenario executes.
  const RULE_CLAUSES = {
    "the push's three states, so the record never calls unknown what the run knows":
      "The push is reported positively and holds three states rather than two",
    "and the status line saying what the line under it says, rather than contradicting it":
      "The status line says what the line under it says, in the same terms",
    "a contract-breaking report distrusted whole rather than field by field":
      "is distrusted **whole** rather than field by field, its per-thread half included",
    "and a claim of publication accepted only over a report that can show it":
      "A run reporting itself complete over less has not published in this sense",
    // The other half of that acceptance, which the sentence above does not
    // cover: a report that is READABLE and says the opposite of what it claims.
    "and refused likewise where the account CONTRADICTS the claim rather than falling short of it":
      "and neither has one whose account **contradicts** the claim",
    // The push half of that contradiction: a completion claim over a report
    // saying no push command succeeded is refused even where the per-item
    // account is complete and the Summary URL present — the shape that once
    // spent the record and reclaimed the tree with every fix still local.
    "and the push named among what a completion claim's own report can contradict":
      "or while reporting that no push command succeeded, which no complete publication reports",
  };
  const missingRules = [];
  for (const mirror of ["plugins/dev-skills/skills", "codex/dev-skills/skills"]) {
    const text = readFileSync(join(here, "..", mirror, "address-review", "SKILL.md"), "utf8");
    for (const [name, clause] of Object.entries(RULE_CLAUSES)) {
      if (!text.includes(clause)) missingRules.push(`${mirror}: ${name}`);
    }
  }
  check(
    "and both mirrors of that skill state the rules the brief renders — the push's three states, the status line agreeing with them, wholesale distrust, and what a claim of publication needs",
    missingRules.length === 0,
    missingRules.join("; "),
  );

  // And the record's LIFECYCLE rules, read the same way and out of the same two
  // mirrors. Two are carve-outs from the one-record-per-PR supersession the
  // skill states two paragraphs above, and both are invisible from the brief a
  // single run renders: a map this run knows is incomplete goes BESIDE the
  // earlier record rather than over it, and a map published in full SPENDS the
  // record it came from. The spend is what makes the standalone replay
  // terminate, so a mirror that lost it would document an unbounded rule — and
  // the two clauses after it are what keep that spend honest at both ends:
  // WHICH record it writes over, and what the run handed the result of it does.
  const LIFECYCLE_CLAUSES = {
    "an incomplete map posted beside the earlier record rather than PATCHed over it":
      "**One map may not supersede: a map this run already knows is incomplete**",
    // And what keeps that carve-out from stranding the older record's entries:
    // the gather replays only the most recent record, so the partial one copies
    // the displaced record's uncovered entries in, marked as carried, and the
    // newest record stays the one complete replay surface.
    "the incomplete record carrying the displaced record's orphaned entries forward":
      "carries the displaced record's orphaned entries forward",
    // And the shapes the carry's base predicate is blind to: a doubled or
    // unpublishable disposition CARRIES the item's identity while being exactly
    // the account the map cannot publish, so it counts as carrying nothing and
    // the displaced record's entry for the identity is carried anyway.
    "a doubled or unpublishable disposition counting as carrying nothing, so the prior entry it would mask is carried too":
      "a disposition that is itself the incompleteness (one of several naming the same gathered item, or one publication rejected as unpublishable) carrying nothing for this test",
    "and a full publication spending the record it replayed, leaving no entries to replay":
      "**A run that publishes in full SPENDS the record it replayed.**",
    "the spend named as what ends the standalone replay":
      "What ends this — the standalone half's answer to the unresolved-only rule the thread half self-terminates on — is the spend above",
    // WHICH record the spend writes over. It is not the one the supersession
    // selects: a mis-targeted supersession replaces one map with another, a
    // mis-targeted spend EMPTIES one, so the spend names the record it replayed
    // and writes nothing where the PR no longer carries it.
    "the spend targeting the record the run replayed rather than the account's most recent":
      "What it spends is **the record it replayed**, named by that comment's own id",
    // And what the far end of that lifecycle owes: a run handed a spent record
    // is told what it is, or it is told to probe a `final HEAD` no spent record
    // cites — on the ordinary path, every run after a published one.
    "and a spent record replaying to nothing when the next run is handed it":
      "- **A spent record replays to nothing.**",
  };
  const missingLifecycle = [];
  for (const mirror of ["plugins/dev-skills/skills", "codex/dev-skills/skills"]) {
    const text = readFileSync(join(here, "..", mirror, "address-review", "SKILL.md"), "utf8");
    for (const [name, clause] of Object.entries(LIFECYCLE_CLAUSES)) {
      if (!text.includes(clause)) missingLifecycle.push(`${mirror}: ${name}`);
    }
  }
  check(
    "and both mirrors state the record's lifecycle — the incomplete map posted beside an earlier record, the published map that spends it, which record that spend writes over, and what a spent one replays to",
    missingLifecycle.length === 0,
    missingLifecycle.join("; "),
  );

  // The FOURTH rendering (task 021f), read the same way and out of the same two
  // mirrors: the record shape for a run whose own push read-back could not
  // confirm the ref — the stop step 7's read-back ends on, which is the only one
  // reachable AFTER `git push` has already returned 0. Every other rendering
  // asserts presence or absence on origin, and that is exactly what the stop
  // failed to establish, so the shape has to claim neither.
  //
  // The ROUTE into it is pinned beside the shape, and it is not decoration: the
  // third state's own closing sentence used to send this run to the canonical
  // rendering (an empty per-item account is complete rather than defective,
  // because the read-back stops before the first reply), so the record printed
  // `not published` and the LOCAL ONLY line — a stated route to a FALSE claim of
  // absence, which no amount of new shape below it corrects while the sentence
  // stands. A pin on the shape alone would pass over the very defect.
  //
  // These are pins on the PHRASING, like the RULE_CLAUSES above and with the
  // same limit stated for the same reason: a substring read cannot tell a rule
  // from its reversal, so what it catches is a clause deleted or reworded away
  // — the shape an ordinary edit takes — and polarity stays the reviewer's.
  // Each span is long enough that a clause GUTTED down to its keywords ("the
  // status line stays as it is, though whether its push reached origin is
  // UNKNOWN", or a route reverted to "keeps the canonical rendering above") no
  // longer contains it; a bare keyword pin would have survived all three.
  //
  // The workflow's rendering of this same case (`unconfirmedPush` in
  // `recordPrompt`, entered off the push read-back's abort) now sits on the same
  // base as the skill's, so the two-sided comparison the shape was written for
  // follows this check, beside the brief-vs-skill reads above.
  const UNCONFIRMED_PUSH_CLAUSES = {
    "the fourth rendering's status line, which claims neither presence nor absence on origin":
      "status: UNKNOWN whether its push reached origin, and nothing else was published",
    "and the line that replaces the local-only one, sending the reader to the ref itself":
      "whether this run's push reached origin is UNKNOWN — `git push` returned and the read-back at the ref did not confirm the ref moved, so read the ref itself before treating the tips above as either published or local",
    "and the route into it, so the empty-account rule stops sending this stop to the canonical rendering":
      "that run keeps the canonical rendering above unless its own push read-back is what stopped it",
  };
  const missingUnconfirmed = [];
  for (const mirror of ["plugins/dev-skills/skills", "codex/dev-skills/skills"]) {
    const text = readFileSync(join(here, "..", mirror, "address-review", "SKILL.md"), "utf8");
    for (const [name, clause] of Object.entries(UNCONFIRMED_PUSH_CLAUSES)) {
      if (!text.includes(clause)) missingUnconfirmed.push(`${mirror}: ${name}`);
    }
  }
  check(
    "and both mirrors give a push whose read-back could not confirm the ref its own rendering — its status line, the line in place of the local-only one, and the route into it out of the empty-account rule",
    missingUnconfirmed.length === 0,
    missingUnconfirmed.join("; "),
  );

  // And the TWO-SIDED half of that, which the check above could not have: the two
  // lines this rendering changes are BYTE-SHARED between the skill's paragraph and
  // the brief's `unconfirmedPush` entry, so they are read out of the RENDERED
  // brief and both mirrors together, the way the header grouping and the two
  // reliability recipes are. Neither half is derived from the other and no
  // generator keeps them in step, so a rewording on either side alone leaves the
  // other's copy standing and fails here — the skill would otherwise describe a
  // second shape while the brief kept printing the first, which is the exact drift
  // this rendering exists in two places to buy back.
  //
  // Same limit as every pin above, stated for the same reason: these are substring
  // reads, so a rule REVERSED while its span survives passes, and polarity stays
  // the reviewer's. What this catches is a span deleted, reworded, or gutted on one
  // side.
  const SHARED_UNCONFIRMED_SPANS = {
    "the status line": "UNKNOWN whether its push reached origin, and nothing else was published",
    "and the line in place of the local-only one":
      "whether this run's push reached origin is UNKNOWN — `git push` returned and the read-back at the ref did not confirm the ref moved, so read the ref itself before treating the tips above as either published or local, while no reply, resolve or Summary comment reached the PR",
  };
  const unconfirmedSurfaces = { "the record brief": briefs["a publication whose push could not be confirmed at the ref"] || "" };
  for (const mirror of ["plugins/dev-skills/skills", "codex/dev-skills/skills"]) {
    unconfirmedSurfaces[mirror] = readFileSync(join(here, "..", mirror, "address-review", "SKILL.md"), "utf8");
  }
  const unsharedSpans = [];
  for (const [where, text] of Object.entries(unconfirmedSurfaces)) {
    for (const [name, span] of Object.entries(SHARED_UNCONFIRMED_SPANS)) {
      if (!text.includes(span)) unsharedSpans.push(`${where}: ${name}`);
    }
  }
  check(
    "and the skill's wording for it is word for word what the brief prints — its status line and its origin line read out of the rendered brief and both mirrors together, so rewording either side alone fails",
    unsharedSpans.length === 0,
    unsharedSpans.join("; "),
  );

  // The three-state lookup's DEFAULT, which no exit reaches today because the
  // publisher's caller is exhaustive — and which must still render the
  // least-claiming of the three rather than throw, since a prompt builder that
  // throws loses the record outright, which is the loss this mechanism exists
  // against. Rendered directly, with a push fact the lookup does not know.
  // The names are the other half of that: a state of `constructor`, `toString`,
  // `valueOf`, `hasOwnProperty`, `isPrototypeOf` or `__proto__` is INHERITED from
  // `Object.prototype` by any plain object literal, so the lookup returns a truthy
  // value that is not one of the three, the `||` never fires, and the brief renders
  // `status: undefined`, its lead and claims sentences as the literal word
  // `undefined`, and an origin line whose whole claim is that same word — matching
  // none of the three renderings, and so worse than throwing. Probing only a name
  // like `sideways` left that whole class uncovered.
  const renderStrangePush = (pushState) => {
    try {
      return recordPrompt(
        { pr: { number: 42, workingBranch: "feature/x", base: "main", headOid: "deadbeef" } },
        [{ ref: "src/app.ts:12 a-reviewer", threadId: "T1" }],
        {
          why: "the publisher stopped.",
          unknown: "its account cannot be read",
          pushState,
          rounds: 1,
          perThread: ["thread=T1  src/app.ts:12 a-reviewer — UNKNOWN whether its reply is posted or its thread resolved: check it on the PR before replying, and before resolving."],
        },
      );
    } catch (err) {
      return `the record brief threw: ${(err && err.message) || err}`;
    }
  };
  const STRANGE_PUSH_STATES = ["sideways", "", "constructor", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf", "__proto__"];
  const notLeastClaiming = STRANGE_PUSH_STATES.filter((state) => {
    const b = renderStrangePush(state);
    return !(
      /status: UNKNOWN whether anything was published \(/.test(b) &&
      /whether anything reached origin is UNKNOWN — not even a push is known to have advanced the remote branch/.test(b)
    );
  });
  check(
    "and a push fact the record does not recognize renders the least-claiming of the three states rather than costing the record — a name Object.prototype supplies included",
    notLeastClaiming.length === 0,
    notLeastClaiming
      .map((state) => {
        const b = renderStrangePush(state);
        return `${JSON.stringify(state)}: ${(b.match(/status: [^(]*/) || [b.slice(0, 100)])[0]}`;
      })
      .join("; "),
  );

  // The producer half, which no scenario reaches because the gather agent is
  // stubbed: nothing puts a starting tip in the packet unless the brief reads
  // one, and it is read in the working location before any fix or rebase — the
  // only point at which the tip the run started from still exists.
  const tipPara = gatherPrompt("#42").split("\n").find((l) => l.includes("pr.startingHead")) || "";
  check(
    "and the gather brief is what produces it — read in the working location, before any fix or rebase, on every run",
    tipPara.includes("Read the tip this run STARTS from and report it as `pr.startingHead`") &&
      tipPara.includes("`git rev-parse HEAD` in the working location") &&
      /before anything is fixed or rebased/.test(tipPara) &&
      /EVERY run has one/.test(tipPara),
    tipPara ? tipPara.slice(0, 160) : "the gather brief says nothing about a starting tip",
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
      /the recorded tip is local-only/.test(priorPara) &&
      priorPara.includes("Report the most recent one as `priorRecord`") &&
      /body VERBATIM and WHOLE/.test(priorPara),
    priorPara ? priorPara.slice(0, 200) : "the gather brief says nothing about a prior disposition record",
  );

  // A recorded STANDALONE disposition is replayable only if the item behind it
  // is gathered again. Step 3's rule admits a standalone comment only where the
  // request names it, so on a later "push now" turn the recorded disposition has
  // no item to attach to — the fixer owes exactly one disposition per gathered
  // item, and the publication guard rejects a standalone disposition whose url
  // was never gathered. The recorded judgment and the Summary text drafted for
  // it are then dropped in silence by the very run that read the record.
  const standalonePara = brief.split("\n").find((l) => l.includes('type: "standalone"')) || "";
  check(
    "and a standalone item a prior record holds a disposition for is gathered again, so that entry has something to replay onto",
    /OR if the prior record above already holds a `standalone` disposition for it/.test(standalonePara) &&
      /re-fetch that url and emit the comment as an item where it is still there/.test(standalonePara) &&
      /publication rejects a `standalone` disposition whose url was never gathered/.test(standalonePara) &&
      // And it is re-judged rather than replayed on the record's word, the same
      // authority every other replayed disposition answers to.
      /re-judges it against the branch exactly as it re-judges a thread's disposition/.test(standalonePara) &&
      // A comment that is gone is not outstanding work: gathering it would put
      // an item on the run that nothing can be done about.
      /Where the comment is gone \(deleted, or the url no longer resolves\), emit no item/.test(standalonePara),
    standalonePara ? standalonePara.slice(0, 240) : "the gather brief says nothing about standalone items",
  );

  // And the sweep that finds it addresses the repository the PR is in. It is
  // the same paragraph, so the same `{owner}`/`{repo}` default that would send
  // the record's own writes at the head fork would send this sweep there too —
  // and a prior record the sweep cannot see is a replay that silently does not
  // happen, which no later step reports as a failure.
  check(
    "and the sweep that finds it is repository-qualified, so a fork clone does not read the head fork's comments instead",
    /gh api --paginate repos\/<owner>\/<repo>\/issues\/<PR>\/comments/.test(priorPara) &&
      /repository-qualified from the PR's OWN URL/.test(priorPara) &&
      !/repos\/\{owner\}\/\{repo\}\/issues/.test(priorPara),
    priorPara ? priorPara.slice(0, 240) : "the gather brief says nothing about a prior disposition record",
  );
}

// --- Replaying a prior record: the packet must actually carry it --------------
// The gather brief is told to re-judge a prior record, and the record exists so
// that judgment is not paid for twice. But the cycle's scope contract carries
// `{ title, instructions, reviewInstructions, items }` and the items are the
// gathered threads, which hold no disposition — so unless the record travels in
// the packet AND is embedded in the round-1 brief, the drafted replies and the
// dispositions are lost and re-triaged, which is the exact expense this whole
// mechanism exists to prevent. That, and the `B...F` probe the skill requires of
// a replay, are what this block drives.
{
  const RECORD_BODY = [
    "<!-- address-review:disposition-record -->",
    "# address-review packet — PR #42 (feature/x)",
    "status: not published (`no-push` was given)",
    "## Threads",
    "[push-back]  src/app.ts:12  a-reviewer  thread=T1",
    '             reply: "the null case cannot arise here: the caller resolves it two frames up"',
  ].join("\n");
  const withRecord = {
    reconcile: { outcome: "work" },
    items: [ITEM],
    priorRecord: { url: "https://example.invalid/pr/42#issuecomment-9", body: RECORD_BODY },
  };
  const replayed = await run(gathered(withRecord), { args: "no-push no-rebase" });
  const scope = replayed.seen.cycleOpts ? replayed.seen.cycleOpts.opts.scope : null;
  const fixer = (scope && scope.instructions) || "";
  check(
    "a prior record reaches the round-1 fixer VERBATIM, with the permalink that names it",
    fixer.includes(RECORD_BODY) && fixer.includes("https://example.invalid/pr/42#issuecomment-9"),
    fixer ? `the brief ${fixer.includes(RECORD_BODY) ? "omits the permalink" : "does not carry the record body"}` : "no cycle was reached",
  );
  check(
    "and carries the replay rule the skill requires — patch-id first, rejecting nothing, the tree per thread, every SHA re-derived",
    /git rev-list --right-only --cherry-pick B\.\.\.F/.test(fixer) &&
      /rejects nothing/.test(fixer) &&
      /Fall through to the tree/.test(fixer) &&
      fixer.includes("RE-DERIVE the `Fixed in <sha>` citation") &&
      /never report it as fixed on the record's word/.test(fixer) &&
      fixer.includes("assert nothing about `F` equalling `B`"),
    fixer.slice(fixer.indexOf("DISPOSITION RECORD"), fixer.indexOf("DISPOSITION RECORD") + 200),
  );
  // The one record those steps cannot be run on, driven as a ROUND TRIP rather
  // than read off either end: a SPENT record — what a published run leaves
  // behind — gathered by the next run and handed to its round-1 fixer. The
  // marker is kept so it is found, so it arrives as `priorRecord` like any
  // other; but it names no disposition and cites no `final HEAD`, so step 1's
  // `B...F` probe has no `F` and the brief would otherwise be internally
  // impossible on the ORDINARY path — every run after a published one. The body
  // comes out of the spend brief this workflow actually renders, so the carve-out
  // and the shape it keys on cannot drift apart.
  const spendRun = await run(gathered(withRecord), { args: "push no-rebase", cycles: [CYCLE_PASS] });
  const spentBody = ((spendRun.seen.spendPrompts[0] || "").match(/```\n(<!-- address-review:disposition-record -->[\s\S]*?)\n```/) || [])[1] || "";
  const afterSpend = await run(
    gathered({ reconcile: { outcome: "work" }, items: [ITEM], priorRecord: { url: "https://example.invalid/pr/42#issuecomment-9", body: spentBody } }),
    { args: "no-push no-rebase" },
  );
  const afterSpendFixer = ((((afterSpend.seen.cycleOpts || {}).opts || {}).scope || {}).instructions) || "";
  check(
    "and a SPENT record — the body a published run leaves — reaches the next fixer told what it is: nothing to probe, nothing to carry, every item ordinary untriaged work",
    // The shape the carve-out keys on, read off the body the spend actually writes.
    /^status: SPENT/m.test(spentBody) &&
      !spentBody.includes("## Threads") &&
      !/final HEAD/.test(spentBody) &&
      // It is still carried verbatim — a spent record is found, not hidden.
      afterSpendFixer.includes(spentBody) &&
      // And the brief says what it means before the steps that cannot run on it.
      /\*\*First, is it SPENT\?\*\*/.test(afterSpendFixer) &&
      /It holds no disposition and cites no `final HEAD`, so there is nothing to probe and nothing to carry forward/.test(afterSpendFixer) &&
      /every item you were given is ordinary untriaged work/.test(afterSpendFixer) &&
      afterSpendFixer.indexOf("First, is it SPENT?") < afterSpendFixer.indexOf("Patch-id first, as a probe and never a gate"),
    JSON.stringify({ spentBody: spentBody.slice(0, 120) || "no body was extracted from the spend brief", carved: /First, is it SPENT\?/.test(afterSpendFixer) }),
  );
  // And the reviewer is what makes the replay bite: a fixer that copied a stale
  // `Fixed in <sha>` out of the record would otherwise publish it into the
  // thread, since the SHA is prose inside `detail` that no schema can check.
  check(
    "and the reviewer confirms a replayed disposition against the tree, with its citation re-derived",
    /REPLAYED from an earlier run's disposition record is confirmed against the tree exactly like a fresh one/.test((scope && scope.reviewInstructions) || "") &&
      /must name a commit the branch carries NOW/.test((scope && scope.reviewInstructions) || ""),
    ((scope && scope.reviewInstructions) || "").slice(0, 120),
  );
  // VERBATIM has to survive the EMBEDDING, and a record's own text is what
  // threatens it: the `## Summary comment` block it ends with holds a full
  // markdown body, which may itself be fenced. Wrapped in a fixed ``` the
  // record's own fence closes the wrapper, and the mark that says where the
  // record ends goes ambiguous for exactly the part it exists to carry. Nor may
  // the body be trimmed on the way in — a reply body's own leading or trailing
  // blank line is content, and "verbatim" is the whole promise.
  // Two bodies, whose longest backtick run differs by one, because a delimiter
  // is only safe if it is a function of THIS body: a constant four backticks
  // survives the three-backtick body and is closed early by the four-backtick
  // one, which markdown allows and a Summary body quoting a fenced block
  // produces. So what is asserted is that the delimiter GREW with the body.
  const fencedRecord = (run_) => [
    "<!-- address-review:disposition-record -->",
    "# address-review packet — PR #42 (feature/x)",
    "",
    "## Summary comment (verbatim, ready to post)",
    "## Summary of Review Fixes",
    "Fixed the guard:",
    `${run_}js`,
    "if (!x) return;",
    run_,
    "and swept the same pattern in two siblings.",
    "",
  ].join("\n");
  const embedded = [];
  for (const inner of ["```", "````"]) {
    const body = fencedRecord(inner);
    const fenced = await run(
      gathered({ reconcile: { outcome: "work" }, items: [ITEM], priorRecord: { url: "https://example.invalid/pr/42#issuecomment-9", body } }),
      { args: "no-push no-rebase" },
    );
    const fixerBrief = (((fenced.seen.cycleOpts || {}).opts || {}).scope || {}).instructions || "";
    embedded.push({ body, brief: fixerBrief, wrapper: (fixerBrief.match(/\n(`{4,})\n/) || [])[1] || "" });
  }
  check(
    "a record whose own Summary body is fenced is embedded WHOLE, in a delimiter longer than any backtick run inside it — and one that grows with the body rather than being a longer constant",
    embedded.every(
      ({ body, brief, wrapper }) =>
        brief.includes(body) &&
        wrapper.length >= 4 &&
        !body.includes(wrapper) &&
        brief.includes(`\n${wrapper}\n${body}\n${wrapper}`) &&
        brief.includes(`the two lines of ${wrapper.length} backticks below`),
    ) && embedded[1].wrapper.length === embedded[0].wrapper.length + 1,
    JSON.stringify(embedded.map(({ body, brief, wrapper }) => ({
      wrapper: wrapper || "no fence of four or more backticks",
      whole: brief.includes(body),
    }))),
  );
  // And the contract that gets it here in one piece: a record reported without
  // its body replays to nothing while the run reads as having found one, so the
  // packet requires the body and the permalink together rather than accepting
  // half a record.
  const priorRecordSchema = PACKET_SCHEMA.properties.priorRecord;
  check(
    "and the packet requires a prior record's body and permalink together, so half a record is rejected rather than silently skipping replay",
    ["url", "body"].every((f) => (priorRecordSchema.required || []).includes(f)) &&
      /VERBATIM and WHOLE — not trimmed, not re-wrapped, not excerpted/.test(priorRecordSchema.properties.body.description) &&
      /replays to NOTHING while the run reads as having found one/.test(priorRecordSchema.properties.body.description),
    JSON.stringify(priorRecordSchema.required || "nothing required"),
  );

  // A PR with no prior record carries no replay section at all: there is nothing
  // to replay, and a section describing a record that does not exist would have
  // the fixer probing a `final HEAD` it was never given.
  const fresh = await run(gathered({ reconcile: { outcome: "work" }, items: [ITEM] }), { args: "no-push no-rebase" });
  const freshFixer = ((fresh.seen.cycleOpts || {}).opts || {}).scope
    ? fresh.seen.cycleOpts.opts.scope.instructions
    : "";
  check(
    "and a PR with no prior record hands the fixer no replay section",
    !!freshFixer && !/DISPOSITION RECORD/.test(freshFixer) && !/cherry-pick B\.\.\.F/.test(freshFixer),
    freshFixer ? "the fixer brief carries a replay section with no record to replay" : "no cycle was reached",
  );
}

check(`suite ran all ${EXPECTED_CHECKS} checks`, ran === EXPECTED_CHECKS, `ran ${ran}`);

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll address-review reconciliation checks passed.");
