#!/usr/bin/env node
// Focused behavior test for the review cycle's two CLAIM LIFECYCLES: the
// open-question RETIREMENT lifecycle, and the LOCKED-DECISION DEVIATION
// lifecycle including the reviewer's half of it. Both turn on the same
// contract. A retirement is the disposition that takes a decision OFF the
// maintainer's list, and a dropped deviation takes one off the same list, so
// what the TERMINAL result says about either claim is a contract rather than an
// implementation detail: it may read as settled only where a reviewer round
// actually accepted the claim. A deviation the cycle first states puts a
// decision ON that list instead, and reaches the maintainer only carrying the
// reviewer's in-spec-route judgment and RATIFY/CONFORM recommendation — a round
// does not pass while a standing deviation lacks them.
//
// The file name says "retirement" for the older half only. The deviation half
// is the scenarios whose titles name a deviation — anchored that way rather
// than by ordinal, which every inserted scenario moves.
//
// It has grown to cover the section's other terminal gates, which live beside
// that one and decide the same question — what may leave the cycle without a
// fresh reviewer seeing it: a locked-decision deviation a pass moves on or off
// the maintainer's list, the trivial-round close-out, which concludes with no
// reviewer round at all, the validation tier a reviewer's brief states, whose
// default decides what an unstated one runs, the record-only close over the
// delivery gate's one tolerated post-run commit, which concludes with no
// reviewer round either, and the light-mode conclusion, the fourth such exit
// and the one every pass reaches at the delivery tier. Each clause names its
// scenario's subject rather than its ordinal, for the reason stated just above.
//
// The packet MEASUREMENT is that same question read one step earlier — what may
// enter the cycle at all. A pass's `clean` is its own word about its own
// worktree, so an independent reading decides instead; and because three of
// those exits have no reviewer round after the pass they conclude on, the
// reading is taken when the packet RETURNS rather than folded into a later
// round, which is what the confirmation-pass scenario pins.
//
// The workflows are runtime scripts (top-level await/return, injected
// `agent`/`parallel`/`log` globals), so they cannot be imported. This evaluates
// the ACTUAL shipped `review-cycle-core` section — no second copy — with those
// globals stubbed, and drives scripted fixer/reviewer packets through
// `runReviewCycle`. Both workflow files are exercised, so the canonical section
// and wf-address-tasks.js's embedded copy are checked as running code rather
// than only as identical bytes.
//
// Run: node scripts/test-review-cycle-retirement.mjs

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const WORKFLOWS = ["wf-review-cycle.js", "wf-address-tasks.js"];

let failures = 0;
// Per-leg tallies of BOTH outcomes. The suite gates on failures, so a check
// that stops running is invisible to it — an edit that drops a scenario, or a
// `scenario()` guard that swallows one silently, would pass. Counting the oks
// too lets each leg assert it ran the whole suite (see CHECKS_PER_LEG).
let legOk = 0;
let legFail = 0;
function check(name, cond, detail) {
  if (cond) {
    legOk++;
    console.log(`ok  - ${name}`);
  } else {
    failures++;
    legFail++;
    console.error(`NOT ok - ${name}${detail ? `: ${detail}` : ""}`);
  }
}

// How many scenario checks each workflow leg must run (the tally is read
// BEFORE the assertion itself, so it does not count). Bump it deliberately
// when adding or removing one — that is the point: the number is the
// assertion.
const CHECKS_PER_LEG = 203;

// Every scenario runs inside its own guard. A scenario that THROWS — an
// unexpected shape, a cycle that blew up — is recorded as a failed check and
// the remaining scenarios still run. Without this one throw ends the process
// mid-suite, and the second workflow leg (the only thing that proves the
// embedded copy has not drifted from the canonical section as RUNNING CODE) is
// never reached at all, so a regression in the first file would mask it.
async function scenario(name, fn) {
  try {
    await fn();
  } catch (err) {
    check(`${name} ran without throwing`, false, String((err && err.stack) || err));
  }
}

// Load the marked section and hand back `runReviewCycle`, bound to a scripted
// `agent`. Fail loudly if the markers moved, so this cannot silently pass
// against a section it no longer found.
function loadCycle(src, agent) {
  const b = src.indexOf("BEGIN EMBEDDABLE SECTION: review-cycle-core");
  const e = src.indexOf("END EMBEDDABLE SECTION: review-cycle-core");
  if (b < 0 || e < 0 || e < b) throw new Error("review-cycle-core markers not found");
  const section = src.slice(src.indexOf("\n", b) + 1, src.lastIndexOf("\n", e));
  const parallel = async (fns) => Promise.all(fns.map((f) => f()));
  const pipeline = async () => [];
  const log = () => {};
  const phase = () => {};
  // `cycleReviewChecks` comes back beside the cycle because its TIER DEFAULT is
  // reachable no other way: `runReviewCycle` always states a tier, and so does
  // every renderer outside a cycle today, so driving the cycle can never
  // exercise the default and only a direct call can.
  // eslint-disable-next-line no-new-func
  return new Function("agent", "parallel", "pipeline", "log", "phase", `${section}\nreturn { runReviewCycle, cycleReviewChecks, cyclePeerPrompt, runCyclePeerStage, createCyclePeerThrottle, cyclePeerTrouble, normalizeCyclePeerResult, CYCLE_PEER_SCHEMA };`)(
    agent,
    parallel,
    pipeline,
    log,
    phase,
  );
}

// Scripted agent: fixer and reviewer packets are consumed in order. An
// exhausted fixer queue returns nothing, which the cycle treats as an error
// exit — the shape scenario 3 needs.
//
// The close-out and record-only diff checks default to the PERMISSIVE verdict
// (every hunk non-semantic; nothing in the range but the flake record) rather
// than a refusal, so a scenario that reaches either gate concludes. That
// direction is deliberate: both gates' failure mode is firing when they should
// not, and a permissive check makes a broken gate visible as a concluded cycle
// instead of hiding behind a scripted veto.
function scriptedAgent(fixes, reviews, seen, closeOuts = [], records = [], packets = []) {
  const fixQueue = [...fixes];
  const reviewQueue = [...reviews];
  const closeOutQueue = [...closeOuts];
  const recordQueue = [...records];
  const packetQueue = [...packets];
  let lastFix = null;
  return async function agent(prompt, opts) {
    const label = (opts && opts.label) || "";
    if (label.startsWith("fix#")) {
      seen.fixPrompts.push(prompt);
      const p = fixQueue.shift();
      lastFix = p || null;
      return p === undefined ? null : p;
    }
    // The packet measurement defaults PERMISSIVE for the diff checks' reason,
    // and one of its own: every scenario in this suite drives a cycle whose
    // packets are meant to be adopted, so a scripted refusal here would stop
    // them all. A gate that stopped firing therefore shows up as a scenario
    // that concluded, never as one hidden behind a scripted veto.
    if (label.startsWith("packet#")) {
      seen.packetPrompts.push(prompt);
      const p = packetQueue.shift();
      return p === undefined
        ? {
            measured: true,
            dirty: [],
            operation: "",
            headSha: (lastFix && lastFix.finalSha) || "",
            headParentSha: lastFix && lastFix.finalSha === RECORD_TIP ? RECORD_PARENT : ORDINARY_PARENT,
            detail: "scripted: clean and idle with HEAD and its parent resolved",
          }
        : p;
    }
    if (label.startsWith("review#")) {
      seen.reviewPrompts.push(prompt);
      const p = reviewQueue.shift();
      return p === undefined ? { pass: true, issues: [], notes: "" } : p;
    }
    if (label.startsWith("closeout#")) {
      seen.closeOutPrompts.push(prompt);
      const p = closeOutQueue.shift();
      return p === undefined ? { nonSemantic: true, editsPresent: true, recordOnlySuffix: false, recordOnlyRange: "", why: "scripted: every hunk non-semantic, every claimed edit present, no record suffix" } : p;
    }
    if (label.startsWith("record#")) {
      seen.recordPrompts.push(prompt);
      const p = recordQueue.shift();
      return p === undefined ? { recordOnly: true, why: "scripted: nothing but the flake record" } : p;
    }
    if (label.startsWith("ground#")) return { verdicts: [] };
    return null;
  };
}

const CYCLE = {
  slug: "sim",
  worktree: "/wt",
  branch: "b",
  base: "main",
  artifactType: "code",
  scope: { title: "t", instructions: "i", items: [] },
  maxRounds: 3,
  peer: "off",
  mode: "full",
};

const Q1 = {
  id: "q1",
  question: "fork?",
  origin: "reviewer",
  originRound: 1,
  blocking: true,
  artifacts: ["a.js:1"],
  trigger: "t",
  reachability: "live",
  reachabilityCondition: "",
  options: [],
  recommendation: "r",
  coupledWith: [],
};
const Q2 = { ...Q1, id: "q2" };

const PASS_PACKET = { blocker: "", changed: true, summary: "s", openQuestions: [], deviations: [], workReport: [], proactive: "", finalSha: "sha", clean: true, artifactDir: "/tmp/art" };
// Reviewer findings are script-numbered `r<round>-<n>`, so a pass answering
// round 1's single issue echoes `r1-1`.
const escalate = { ...PASS_PACKET, dispositions: [{ findingId: "r1-1", finding: "f", origin: "reviewer", disposition: "escalated", detail: "d", questionId: "q1" }], openQuestions: [Q1] };
const retireOn = (findingId, retiresQuestionIds = ["q1"]) => ({ ...PASS_PACKET, dispositions: [{ findingId, finding: "f", origin: "reviewer", disposition: "fixed", detail: "settled it", retiresQuestionIds }] });
const fixOn = (findingId) => ({ ...PASS_PACKET, dispositions: [{ findingId, finding: "f", origin: "reviewer", disposition: "fixed", detail: "d" }] });
const escalateOn = (findingId, questionId) => ({ ...PASS_PACKET, dispositions: [{ findingId, finding: "f", origin: "reviewer", disposition: "escalated", detail: "d", questionId }] });
const idle = { ...PASS_PACKET, changed: false, dispositions: [] };
const FAIL = (...claims) => ({ pass: false, issues: claims.map((claim) => ({ claim })), notes: "" });
const OK = { pass: true, issues: [], notes: "" };

// One packet that retires an EARLIER pass's `q1` on one disposition while a
// second disposition escalates onto that same `q1` — the shape the same-pass
// retire-and-escalate guard exists for (scenario 10).
const retireAndEscalateSame = {
  ...PASS_PACKET,
  dispositions: [
    { findingId: "r1-1", finding: "f", origin: "reviewer", disposition: "fixed", detail: "settled it", retiresQuestionIds: ["q1"] },
    { findingId: "r1-2", finding: "g", origin: "reviewer", disposition: "escalated", detail: "d", questionId: "q1" },
  ],
};
// An `escalated` disposition that also claims a retirement: it raises `q2` and
// names the live `q1` in `retiresQuestionIds` (scenario 11).
const escalateRetiring = {
  ...PASS_PACKET,
  dispositions: [{ findingId: "r1-1", finding: "f", origin: "reviewer", disposition: "escalated", detail: "d", questionId: "q2", retiresQuestionIds: ["q1"] }],
  openQuestions: [Q2],
};
// One packet whose TWO `fixed` dispositions each claim to retire the same
// still-live `q1` (scenario 14). Only the first claimer may take effect: the
// question is spoken for the moment it is claimed.
const twoRetirementsSameQuestion = {
  ...PASS_PACKET,
  dispositions: [
    { findingId: "r1-1", finding: "f", origin: "reviewer", disposition: "fixed", detail: "first claimer", retiresQuestionIds: ["q1"] },
    { findingId: "r1-2", finding: "g", origin: "reviewer", disposition: "fixed", detail: "second claimer", retiresQuestionIds: ["q1"] },
  ],
};
// A confirmation pass that re-reports an already-retired `q1` verbatim
// (scenario 13). It disposes nothing and changes nothing, so it also
// terminates the cycle.
const reReportQ1 = { ...PASS_PACKET, changed: false, dispositions: [], openQuestions: [Q1] };
// One packet that RAISES `q2` and, in the same breath, claims a `fixed`
// disposition settles it (scenario 12).
const raiseAndRetire = {
  ...PASS_PACKET,
  dispositions: [{ findingId: "r1-1", finding: "f", origin: "reviewer", disposition: "fixed", detail: "settled it", retiresQuestionIds: ["q2"] }],
  openQuestions: [Q2],
};
// A confirmation pass that acts on a pass-note. It is handed nothing, so its
// disposition is SPONTANEOUS (no `findingId`), and the work it reports sends
// the cycle into another reviewer round (scenario 16).
const confirmSpontaneousFix = { ...PASS_PACKET, dispositions: [{ finding: "a pass-note", origin: "reviewer", disposition: "fixed", detail: "acted on it" }] };
// A confirmation pass that spontaneously escalates onto the ALREADY-RETIRED
// `q1`, raising a different decision under that same id (scenario 17).
const confirmEscalateOntoRetired = {
  ...PASS_PACKET,
  changed: false,
  dispositions: [{ finding: "a pass-note", origin: "reviewer", disposition: "escalated", detail: "escalating the note", questionId: "q1" }],
  openQuestions: [{ ...Q1, question: "a different decision under the same id" }],
};
// A confirmation pass whose spontaneous escalations name questions that do not
// exist: one an invented id, one no id at all (scenario 20).
const confirmEscalateNowhere = {
  ...PASS_PACKET,
  dispositions: [
    { finding: "a pass-note", origin: "reviewer", disposition: "escalated", detail: "escalating the note", questionId: "ghost" },
    { finding: "another pass-note", origin: "reviewer", disposition: "escalated", detail: "escalating that one too" },
  ],
};
// A pass that WAS handed a finding: it disposes that finding validly and adds a
// SPONTANEOUS escalation naming nothing (scenario 21).
const handedFixPlusSpontaneousGhost = {
  ...PASS_PACKET,
  dispositions: [
    { findingId: "r1-1", finding: "f", origin: "reviewer", disposition: "fixed", detail: "d" },
    { finding: "a pass-note", origin: "reviewer", disposition: "escalated", detail: "escalating the note", questionId: "ghost" },
  ],
};
// A confirmation pass that spontaneously escalates onto the question its OWN
// packet raises — the normal shape (scenario 22).
const confirmEscalateRaisingOwn = {
  ...PASS_PACKET,
  dispositions: [{ finding: "a pass-note", origin: "reviewer", disposition: "escalated", detail: "escalating the note", questionId: "q2" }],
  openQuestions: [Q2],
};
// A confirmation pass that spontaneously escalates onto an earlier pass's
// STILL-LIVE `q1`, raising no question of its own (scenario 22).
const confirmEscalateOntoLive = {
  ...PASS_PACKET,
  dispositions: [{ finding: "a pass-note", origin: "reviewer", disposition: "escalated", detail: "escalating the note", questionId: "q1" }],
};
// A confirmation pass that retires an earlier pass's still-live `q1` on one
// disposition while spontaneously escalating onto that same `q1` (scenario 23).
const confirmRetireAndEscalateSame = {
  ...PASS_PACKET,
  dispositions: [
    { finding: "a pass-note", origin: "reviewer", disposition: "fixed", detail: "settled it", retiresQuestionIds: ["q1"] },
    { finding: "another pass-note", origin: "reviewer", disposition: "escalated", detail: "escalating that one", questionId: "q1" },
  ],
};
// A confirmation pass that claims to retire `q1` a SECOND time, after a round
// already accepted the first claim (scenario 19).
const confirmRetireAgain = {
  ...PASS_PACKET,
  changed: false,
  dispositions: [{ finding: "a pass-note", origin: "reviewer", disposition: "fixed", detail: "settled it again", retiresQuestionIds: ["q1"] }],
};

// Trivial-round close-out packets (the close-out scenario). Each OFFERS a
// close-out — the same non-semantic edit list — and differs only in how it
// disposed the one finding it was handed, which is the whole question the
// gate answers.
const CLOSE_OUT_EDITS = ["reworded a comment"];
const closeOutFix = (findingId) => ({ ...fixOn(findingId), closeOutEdits: CLOSE_OUT_EDITS });
const closeOutDecline = (findingId) => ({
  ...PASS_PACKET,
  dispositions: [{ findingId, finding: "off-by-one in the cap check", origin: "reviewer", disposition: "declined", detail: "reads fine to me" }],
  closeOutEdits: CLOSE_OUT_EDITS,
});
const closeOutEscalate = (findingId) => ({
  ...escalateOn(findingId, "q1"),
  openQuestions: [Q1],
  closeOutEdits: CLOSE_OUT_EDITS,
});
// The same offer on round 1, where there is no previous pass's SHA to judge a
// close-out range against.
const closeOutRound1 = { ...PASS_PACKET, dispositions: [], closeOutEdits: CLOSE_OUT_EDITS };

// The same offer from a pass that reports its findings `fixed` while saying it
// CHANGED NOTHING — the shape whose range is empty, and so vacuously
// non-semantic, if the gate takes the offer at face value.
const closeOutUnchanged = (findingId) => ({ ...closeOutFix(findingId), changed: false });

// The same offer from a pass that also CLAIMS A RETIREMENT — the claim the
// close-out's own conjunct must hold the cycle open for.
const closeOutRetire = (findingId) => ({ ...retireOn(findingId), closeOutEdits: CLOSE_OUT_EDITS });

// A confirmation pass that committed the unrelated-flake RECORD: it changed the
// tree, disposed nothing, moved no deviation, and reported what its delivery run
// surfaced in `flakeRecord` — where the cycle's own flake rule sends it, "for the
// PR body or batch summary". That is exactly the packet the delivery gate's
// post-run tolerance describes, and `PASS_PACKET` supplies the rest of the shape.
// No reviewer round follows this exit, so `reviewerNotes` was written before the
// failure existed and the record is the only carrier that note has to a
// consumer — which is why the note is a conjunct of the exit and not merely its
// payload.
const FLAKE_NOTE = "the delivery run's only failure was the payments suite, which reproduces on the base; queued as tasks/046-flaky-payments-suite.md";
const RECORD_PARENT = "a".repeat(40);
const RECORD_TIP = "b".repeat(40);
const RECORD_RANGE = `${RECORD_PARENT}..${RECORD_TIP}`;
const WRONG_RECORD_RANGE = `${RECORD_PARENT}..${"c".repeat(40)}`;
const ORDINARY_PARENT = "d".repeat(40);
const confirmRecordOnly = { ...PASS_PACKET, dispositions: [], flakeRecord: FLAKE_NOTE };
const closeOutRecordOnly = (findingId) => ({ ...closeOutFix(findingId), finalSha: RECORD_TIP, flakeRecord: FLAKE_NOTE });
// The same pass with no record of its OWN: it committed the same range and says
// nothing about what failed, so there is nothing for the conclusion to publish.
const confirmRecordOnlySilent = { ...PASS_PACKET, dispositions: [] };
// The flake rule's OTHER outcome: the evidence matched an ALREADY-ACTIVE task,
// so the pass cites it instead of editing it and has nothing at all to commit.
// A confirmation pass shaped exactly like `idle` — which is the point.
const CITED_NOTE = "the delivery run's only failure was the payments suite, which reproduces on the base; already queued as tasks/041-flaky-payments-suite.md, cited rather than re-filed";
const confirmCitingActiveTask = { ...idle, flakeRecord: CITED_NOTE };

// The readings the packet measurement can come back with. `CLEAN_READING` is
// the scripted default's explicit twin, needed wherever a scenario places a
// specific reading on a LATER pass and so must fill the earlier slot itself.
const CLEAN_READING = { measured: true, dirty: [], operation: "", headSha: PASS_PACKET.finalSha, headParentSha: ORDINARY_PARENT, detail: "clean and idle" };
const DIRTY_READING = { measured: true, dirty: [" M src/app.ts", "?? notes.txt"], operation: "", headSha: PASS_PACKET.finalSha, headParentSha: ORDINARY_PARENT, detail: "two uncommitted paths" };
// The reading this whole measurement exists for: a tree left mid-cherry-pick
// prints EMPTY porcelain, so `dirty` is empty and the operation marker is the
// only thing that shows it. A porcelain-only check calls this worktree clean.
const MID_OPERATION_READING = { measured: true, dirty: [], operation: "CHERRY_PICK_HEAD", headSha: PASS_PACKET.finalSha, headParentSha: ORDINARY_PARENT, detail: "a cherry-pick is still in progress; the porcelain is empty" };
const UNMEASURED_READING = { measured: false, dirty: [], operation: "", headSha: "", headParentSha: "", detail: "git would not run in that path" };

// A deviation from a LOCKED maintainer decision, and a pass that reports one.
// Every other packet above carries `deviations: []`, so any of them following
// this one is a pass that has stopped restating it — the claimed drop.
const DEV = "delivered a stub adapter instead of the locked one (upstream API absent)";
const deviate = { ...PASS_PACKET, deviations: [DEV] };
// A confirmation-shaped pass (nothing changed, nothing disposed) that STATES
// the deviation. Which move that is depends only on what preceded it: after
// `deviate` it RESTATES, after a deviation-free pass it ADDS one no round has
// seen. `idle` is the same pass DROPPING it, since `PASS_PACKET` carries
// `deviations: []`. One packet covers all three because the rule under test is
// one rule — whether the pass moved the set — not three cases.
const confirmDeviate = { ...idle, deviations: [DEV] };
// The same deviation reported twice in one packet. The cycle matches
// deviations by exact text, so that is ONE deviation stated twice, and the
// doubling has to be pinned on the LAST pass: an earlier pass's duplicate is
// overwritten by whatever the next pass restates.
const doubleDeviate = { ...PASS_PACKET, deviations: [DEV, DEV] };
const confirmDoubleDeviate = { ...idle, deviations: [DEV, DEV] };
// The Reviewer's half of report-don't-correct, and a passing review carrying
// it. `OK` is deliberately kept WITHOUT one: a round shown a standing deviation
// and answered with a bare pass is the shape scenario 25 pins, so every round
// below that legitimately passes over a standing deviation says so explicitly.
const ASSESS = {
  deviation: DEV,
  inSpecRoute: "none — the locked adapter's upstream API is absent on this platform",
  recommendation: "RATIFY — the stub keeps the contract and is reversible once the API lands",
};
const OK_DEV = { pass: true, issues: [], notes: "", deviationAssessments: [ASSESS] };
// A pass that RESTATES the deviation while disposing the finding it was handed.
// That is what the missing-assessment finding asks for: conforming the
// deviation away to clear the finding is the one move report-don't-correct
// forbids, so the fixture that answers it must still carry the deviation.
const deviateDeclining = (findingId) => ({
  ...PASS_PACKET,
  deviations: [DEV],
  dispositions: [{ findingId, finding: "f", origin: "reviewer", disposition: "declined", detail: "the deviation stands; the assessment is the reviewer's to supply" }],
});

async function run(src, { fixes, reviews, closeOuts, records, packets, cycle }) {
  const seen = { fixPrompts: [], reviewPrompts: [], closeOutPrompts: [], recordPrompts: [], packetPrompts: [] };
  // Deep-clone every scripted packet. The cycle MUTATES the question objects it
  // accumulates — that is how a retirement mark lands — and the packets above
  // are module-level literals shared by every scenario and BOTH workflow legs.
  // Without this, scenario 1's accepted retirement stamps `retired` onto the
  // shared `Q1` and each later scenario silently exercises the volunteered-mark
  // STRIP path instead of the clean one it means to test.
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const { runReviewCycle } = loadCycle(src, scriptedAgent(clone(fixes), clone(reviews), seen, clone(closeOuts || []), clone(records || []), clone(packets || [])));
  const res = await runReviewCycle({ ...CYCLE, ...cycle });
  const questionOf = (id) => (res.openQuestions || []).find((x) => x && x.id === id);
  // The three states a claimed question can be in, as a CONSUMER sees them:
  // `retired` is skipped, anything else is served to the maintainer.
  const stateOf = (id) => {
    const q = questionOf(id);
    return !q ? "absent" : q.retired ? "retired" : q.retirementPending ? "pending" : "live";
  };
  const entriesOf = (id) => (res.openQuestions || []).filter((x) => x && x.id === id);
  // `carriedIds` reads the result contract's OWN key. The stringified blob is
  // kept only for failure detail: grepping it would pass just as happily if
  // `outstanding.carried` were renamed, and that key is what a consumer reads
  // to find what the cycle could not dispose.
  const carriedIds = ((res.outstanding && res.outstanding.carried) || []).map((f) => f && f.id);
  return { res, q: questionOf("q1"), state: stateOf("q1"), questionOf, stateOf, entriesOf, seen, carriedIds, carried: JSON.stringify(res.outstanding || {}) };
}

// How many questions a review prompt's RETIREMENT block carries. `originRound`
// is a question-object field, and questions are serialized into that prompt
// nowhere else, so its occurrence count IS the number of proposed retirements
// the round was shown.
const proposedCount = (prompt) => ((prompt || "").match(/"originRound"/g) || []).length;

for (const name of WORKFLOWS) {
  const src = readFileSync(join(here, "..", "plugins", "dev-skills", "workflows", name), "utf8");
  console.log(`# ${name}`);

  // 1. A retirement a PASSING round adjudicated is settled.
  await scenario("1. accepted retirement", async () => {
    const { res, q, state } = await run(src, { fixes: [escalate, retireOn("r1-1"), idle], reviews: [FAIL("r1"), OK] });
    check("accepted retirement settles the question", res.verdict === "pass" && state === "retired", `${res.verdict}/${state}`);
    check("accepted retirement records the pass and disposition", !!q && !!q.retired && q.retired.pass === 2 && q.retired.disposition === "fixed");
    check("accepted retirement leaves no pending mark behind", !!q && !("retirementPending" in q));
  });

  // 2. A reviewer that keeps REJECTING the claim -> round cap -> NOT settled.
  //    The later passes re-claim the same question, which is not a second
  //    retirement but a stray: a claim already spoke for it, so the guard must
  //    report each re-claim rather than quietly re-applying it.
  await scenario("2. rejected retirement", async () => {
    const { res, q, state, carried, carriedIds } = await run(src, {
      fixes: [escalate, retireOn("r1-1"), retireOn("r2-1"), retireOn("r3-1")],
      reviews: [FAIL("r1"), FAIL("unearned retirement"), FAIL("unearned retirement")],
    });
    check("rejected retirement is not settled at the round cap", res.verdict === "review-cap" && state === "pending", `${res.verdict}/${state}`);
    check("rejected retirement carries no `retired` mark", !!q && !q.retired);
    check("re-retiring an already-claimed question is reported", carriedIds.includes("retire:q1"), carried);
  });

  // 3. A cycle that ERRORS before any round accepted the claim -> NOT settled.
  await scenario("3. errored cycle", async () => {
    const { res, q, state } = await run(src, { fixes: [escalate, retireOn("r1-1")], reviews: [FAIL("r1"), FAIL("r2")], cycle: { maxRounds: 5 } });
    check("errored cycle does not settle an unadjudicated retirement", res.verdict === "error" && state === "pending", `${res.verdict}/${state}`);
    check("unadjudicated retirement carries no `retired` mark", !!q && !q.retired);
  });

  // 4. A round that fails for an UNRELATED reason must not discard the claim:
  //    it is re-presented until a round passes over it.
  await scenario("4. claim survives an unrelated failure", async () => {
    const { res, state, seen } = await run(src, {
      fixes: [escalate, retireOn("r1-1"), fixOn("r2-1"), idle],
      reviews: [FAIL("r1"), FAIL("something else"), OK],
      cycle: { maxRounds: 5 },
    });
    check("claim survives a round that failed on something else", res.verdict === "pass" && state === "retired", `${res.verdict}/${state}`);
    check("unaccepted claim is re-presented to the next reviewer", /proposed for RETIREMENT/.test(seen.reviewPrompts[2] || ""));
    check("re-presented claim shows the pass and disposition claiming it", /retirementPending/.test(seen.reviewPrompts[2] || ""));
  });

  // 5. light mode returns right after a passing round — promotion must precede
  //    that exit, or a light cycle could never settle anything.
  await scenario("5. light mode", async () => {
    const { res, state } = await run(src, { fixes: [escalate, retireOn("r1-1")], reviews: [FAIL("r1"), OK], cycle: { mode: "light" } });
    check("light mode settles an accepted retirement", res.verdict === "pass" && state === "retired", `${res.verdict}/${state}`);
  });

  // 6. A question a claim already covers leaves the fixer's live list, so it is
  //    neither re-retired nor offered as a live decision to name.
  await scenario("6. claimed question leaves the live list", async () => {
    const { seen } = await run(src, { fixes: [escalate, retireOn("r1-1"), retireOn("r2-1"), idle], reviews: [FAIL("r1"), FAIL("r2"), OK], cycle: { maxRounds: 5 } });
    check("a claimed question is no longer offered as live", !/Open questions still live/.test(seen.fixPrompts[2] || ""));
  });

  // 7. The guard reports every retirement that settles nothing — an unknown id
  //    and the empty string alike (the schema asks for non-empty ids, so an
  //    empty one names nothing and must not vanish).
  await scenario("7. retirement that settles nothing", async () => {
    const { carried, carriedIds } = await run(src, {
      fixes: [escalate, retireOn("r1-1", ["nope", ""])],
      reviews: [FAIL("r1"), FAIL("r2")],
      cycle: { maxRounds: 2 },
    });
    check("unknown retirement id is reported, not dropped", carriedIds.includes("retire:nope"), carried);
    check("empty retirement id is reported, not dropped", carriedIds.includes("retire:"), carried);
  });

  // 8. A question under a pending claim cannot validate a later `escalated`
  //    disposition: the finding is carried forward instead of being covered by
  //    a decision somebody already claims to have taken off the table.
  await scenario("8. pending claim cannot cover a later escalation", async () => {
    const { carried, carriedIds } = await run(src, {
      fixes: [escalate, retireOn("r1-1"), escalateOn("r2-1", "q1")],
      reviews: [FAIL("r1"), FAIL("r2"), FAIL("r3")],
    });
    check("claimed question cannot cover a later escalation", carriedIds.includes("r2-1"), carried);
  });

  // 9. The retirement marks are script-applied: a fixer volunteering either is
  //    stripped, so no question is settled with no disposition behind it.
  await scenario("9. volunteered marks are stripped", async () => {
    const volunteered = { ...PASS_PACKET, dispositions: [], openQuestions: [{ ...Q1, retired: { pass: 1 }, retirementPending: { pass: 1 } }] };
    const { q, state } = await run(src, { fixes: [volunteered], reviews: [FAIL("r1")], cycle: { maxRounds: 1 } });
    check("volunteered retirement marks are stripped", !!q && state === "live", state);
  });

  // 10. SAME-PASS retire-and-escalate. One packet retires an earlier pass's
  //     `q1` and escalates another finding onto that same `q1`. The escalation
  //     names a decision the same breath claims is settled, so it covers
  //     nothing: the finding is carried forward, and only that keeps it from
  //     vanishing between the next pass and the maintainer alike.
  await scenario("10. same-pass retire-and-escalate", async () => {
    const { carried, carriedIds, state } = await run(src, {
      fixes: [escalate, retireAndEscalateSame, idle],
      reviews: [FAIL("r1", "r1b"), FAIL("r2"), FAIL("r3")],
    });
    check("escalation onto a question the same pass retires is carried forward", carriedIds.includes("r1-2"), carried);
    check("the same pass's own retirement still takes effect as a claim", state === "pending", state);
  });

  // 11. Only `fixed`/`declined` retire. An `escalated` disposition carrying
  //     `retiresQuestionIds` raises a question rather than settling one, so the
  //     claim must come back as its own `retire:` disposition error AND leave
  //     the named question live — a silent no-op would hide the contradiction,
  //     and applying it would settle a decision on an escalation.
  await scenario("11. escalated disposition cannot retire", async () => {
    const { carried, carriedIds, stateOf } = await run(src, {
      fixes: [escalate, escalateRetiring, idle],
      reviews: [FAIL("r1"), FAIL("r2"), FAIL("r3")],
    });
    check("an `escalated` disposition's retirement is reported", carriedIds.includes("retire:q1"), carried);
    check("an `escalated` disposition's retirement does not mark the question", stateOf("q1") === "live", stateOf("q1"));
  });

  // 12. RAISE-AND-RETIRE in one packet. A packet whose `openQuestions` raises
  //     `q2` while a `fixed` disposition names `q2` in `retiresQuestionIds` is
  //     contradicting itself, not superseding anything — the retirable set is
  //     snapshotted BEFORE the pass's own questions are appended, so it must be
  //     reported and must not mark the brand-new question.
  await scenario("12. raise-and-retire in one packet", async () => {
    const { carried, carriedIds, stateOf } = await run(src, {
      fixes: [escalate, raiseAndRetire, idle],
      reviews: [FAIL("r1"), FAIL("r2"), FAIL("r3")],
    });
    check("retiring a question this same packet raised is reported", carriedIds.includes("retire:q2"), carried);
    check("retiring a question this same packet raised does not mark it", stateOf("q2") === "live", stateOf("q2"));
  });

  // 13. A later pass RE-REPORTING a question id the cycle already carries is
  //     restating it, not raising a new one. The entry from the pass that
  //     raised it stays authoritative and the re-report is dropped: a second
  //     entry under one id would fork the question's state, so a retirement
  //     would mark one copy while the other stayed live — and here, where the
  //     id is already RETIRED, the re-report would resurrect a settled
  //     decision as a live one.
  await scenario("13. re-report neither forks nor revives a question", async () => {
    const { res, entriesOf } = await run(src, { fixes: [escalate, retireOn("r1-1"), reReportQ1], reviews: [FAIL("r1"), OK] });
    check("a re-reported question is not appended a second time", entriesOf("q1").length === 1, `${entriesOf("q1").length} entries / ${res.verdict}`);
    check("a re-report leaves no live copy of a retired question", entriesOf("q1").every((x) => !!x.retired), JSON.stringify(entriesOf("q1").map((x) => (x.retired ? "retired" : x.retirementPending ? "pending" : "live"))));
  });

  // 14. TWO dispositions in one packet claiming the same still-live question.
  //     A question is spoken for the moment a claim lands on it, so the FIRST
  //     claimer wins and the second settles nothing: the question is proposed
  //     to the reviewer once, and the accepted mark names the disposition that
  //     actually claimed it — otherwise the round adjudicates one decision
  //     twice and the result credits the wrong disposition for settling it.
  await scenario("14. one question, one claimer", async () => {
    const { q, state, seen } = await run(src, {
      fixes: [escalate, twoRetirementsSameQuestion, fixOn("r2-1"), idle],
      reviews: [FAIL("r1", "r1b"), FAIL("r2"), OK],
    });
    check("the first claimer of a question wins", state === "retired" && !!q && !!q.retired && q.retired.findingId === "r1-1", `${state}/${(q && q.retired && q.retired.findingId) || "-"}`);
    check("a doubly-claimed question is proposed to the reviewer once", proposedCount(seen.reviewPrompts[2]) === 1, `${proposedCount(seen.reviewPrompts[2])} proposed`);
  });

  // 15. The round cap reached through the FINAL CONFIRMATION pass. That pass
  //     is handed nothing, but the retirement guard binds anyway — a
  //     retirement is a claim about the cycle's accumulated questions, not
  //     about a round's findings — so its breach must leave by the same
  //     `outstanding.carried` door the failed-round cap exit uses. A generic
  //     note here would drop the only structural record that the last thing
  //     the cycle did was claim to settle a question that does not exist.
  await scenario("15. cap reached on the confirmation pass", async () => {
    const { res, carried, carriedIds } = await run(src, {
      fixes: [escalate, retireOn("r1-1", ["nope"])],
      reviews: [OK],
      cycle: { maxRounds: 1 },
    });
    check("confirmation-pass cap exit reports the retirement breach", res.verdict === "review-cap" && carriedIds.includes("retire:nope"), `${res.verdict}/${carried}`);
    check("confirmation-pass cap exit still says why it stopped", /could not be re-reviewed within the cap/.test((res.outstanding || {}).note || ""), carried);
  });

  // 16. ACCEPTANCE CRITERION 3, on the path the criterion is about: a question
  //     a passing round already SETTLED cannot validate a later `escalated`
  //     disposition that names it. Scenario 8 pins only the PENDING half of
  //     that (a claim awaiting its round), so without this one the `retired`
  //     half of the `knownQuestionIds` filter is unpinned — dropping it leaves
  //     the whole suite green while the criterion is broken. Here `q1` is
  //     retired by an ACCEPTED claim, so round 4's `r3-1` must be carried
  //     forward rather than covered by a decision already off the table.
  await scenario("16. accepted retirement cannot cover a later escalation", async () => {
    const { carriedIds, carried, stateOf } = await run(src, {
      fixes: [escalate, retireOn("r1-1"), confirmSpontaneousFix, escalateOn("r3-1", "q1")],
      reviews: [FAIL("r1"), OK, FAIL("r3"), FAIL("r4")],
      cycle: { maxRounds: 4 },
    });
    check("a settled question cannot cover a later escalation", carriedIds.includes("r3-1"), carried);
    check("a later escalation does not unsettle the question it names", stateOf("q1") === "retired", stateOf("q1"));
  });

  // 17. The CONFIRMATION pass is handed nothing, so a disposition it makes is
  //     spontaneous and carries no coverage obligation — there is no finding
  //     for a question to validate. Two things must hold anyway. First, a
  //     SETTLED id is judged the same as one no pass ever raised: the
  //     back-reference names no decision the maintainer will be asked to make,
  //     so the escalation is reported rather than recorded silently. Second,
  //     the report changes nothing about the question itself — the re-report
  //     rule (scenario 13) keeps the raising pass's entry, so the settled
  //     decision is neither revived nor forked, and the disposition stays in
  //     the result against the pass that made it. (A fixer reusing a settled
  //     id is breaking the stated rule that an escalation goes under an id no
  //     earlier pass used; what the cycle owes it is a report and a stable
  //     question state, not a resurrection.)
  await scenario("17. confirmation-pass escalation onto a retired id", async () => {
    const { res, entriesOf, stateOf, carried, carriedIds } = await run(src, {
      fixes: [escalate, retireOn("r1-1"), confirmEscalateOntoRetired],
      reviews: [FAIL("r1"), OK],
      cycle: { maxRounds: 2 },
    });
    check("escalating onto a settled question is reported", carriedIds.includes("question:q1"), carried);
    check("a confirmation-pass escalation neither revives nor forks a retired question", entriesOf("q1").length === 1 && stateOf("q1") === "retired", `${entriesOf("q1").length} entries / ${stateOf("q1")}`);
    check("the spontaneous escalation is still recorded against its pass", (res.findingDispositions || []).some((d) => d && d.pass === 3 && d.disposition === "escalated" && d.questionId === "q1"), JSON.stringify(res.findingDispositions));
  });

  // 18. The wiring the whole feature rests on: a later fixer pass is actually
  //     SHOWN the live open questions. Scenario 6 asserts only the negative
  //     (a claimed question drops out of that block), which a block that never
  //     renders satisfies just as well — so without this, removing the block
  //     from the fixer prompt, or passing it no questions, is invisible.
  //     Nothing else in the cycle gives the fixer an id to retire.
  await scenario("18. the fixer is shown the live open questions", async () => {
    const { seen } = await run(src, { fixes: [escalate, fixOn("r1-1"), idle], reviews: [FAIL("r1"), OK], cycle: { maxRounds: 5 } });
    check("a later fixer pass gets the live open-questions block", /Open questions still live/.test(seen.fixPrompts[1] || ""));
    check("the block carries the question itself, not just a heading", /"id": "q1"/.test(seen.fixPrompts[1] || "") && /"question": "fork\?"/.test(seen.fixPrompts[1] || ""));
  });

  // 19. An ACCEPTED retirement is final, in both directions. Scenarios 2 and 6
  //     pin only the pending half — a claim still awaiting its round — so the
  //     settled half of `retirableQuestionIds` and of the fixer's live-question
  //     filter is otherwise unpinned: a settled question could be re-offered as
  //     a live decision and re-retired, the second claim silently settling
  //     nothing rather than being reported like every other retirement that
  //     settles nothing.
  await scenario("19. an accepted retirement is final", async () => {
    const { q, carriedIds, carried, stateOf, seen } = await run(src, {
      fixes: [escalate, retireOn("r1-1"), confirmRetireAgain],
      reviews: [FAIL("r1"), OK],
      cycle: { maxRounds: 2 },
    });
    check("re-retiring a SETTLED question is reported", carriedIds.includes("retire:q1"), carried);
    check("a settled question is not re-offered as live", !/Open questions still live/.test(seen.fixPrompts[2] || ""));
    check("a rejected second claim leaves the accepted mark intact", stateOf("q1") === "retired" && !!q && !!q.retired && q.retired.pass === 2, `${stateOf("q1")}/${(q && q.retired && q.retired.pass) || "-"}`);
  });

  // 20. The gap this whole guard exists for: a pass handed NOTHING escalates to
  //     a question that does not exist. The coverage walk never judges such a
  //     disposition — it covers nothing by construction — so before the guard
  //     the back-reference the contract requires was the one shape that no-op'd.
  //     The empty/absent id is pinned beside the invented one deliberately:
  //     the contract asks for a non-empty id — no schema keyword here says so,
  //     which is why the guard has to — so an id that is not there names
  //     nothing and is precisely the breach worth reporting.
  await scenario("20. spontaneous escalation naming no question", async () => {
    const { res, carried, carriedIds } = await run(src, {
      fixes: [escalate, confirmEscalateNowhere],
      reviews: [OK],
      cycle: { maxRounds: 1 },
    });
    check("an escalation onto an unknown question id is reported", res.verdict === "review-cap" && carriedIds.includes("question:ghost"), `${res.verdict}/${carried}`);
    check("an escalation with no question id at all is reported", carriedIds.includes("question:"), carried);
  });

  // 21. The other half of the same gap, on a pass that WAS handed findings: a
  //     disposition with no `findingId` is spontaneous there too, so the
  //     coverage walk skips it just the same. The handed finding it disposes
  //     validly must still come out COVERED — the guard reports a dead
  //     back-reference, it does not invent a coverage obligation for a
  //     disposition that has none.
  await scenario("21. spontaneous escalation on a pass that was handed findings", async () => {
    const { carried, carriedIds } = await run(src, {
      fixes: [escalate, handedFixPlusSpontaneousGhost],
      reviews: [FAIL("r1"), OK],
      cycle: { maxRounds: 2 },
    });
    check("a spontaneous escalation is judged even when findings were handed", carriedIds.includes("question:ghost"), carried);
    check("the guard adds no coverage obligation to a disposed finding", !carriedIds.includes("r1-1"), carried);
  });

  // 22. The two shapes that must NOT be reported, or the guard would cost the
  //     confirmation pass a round for nothing. A spontaneous escalation naming
  //     the question its OWN packet raises is the normal shape; naming an
  //     earlier pass's STILL-LIVE question is the documented re-report — the
  //     cycle keeps the raising pass's entry (scenario 13), but the decision
  //     itself does reach the maintainer, so the back-reference points at
  //     something real.
  await scenario("22. a live question back-reference is no breach", async () => {
    const own = await run(src, { fixes: [escalate, confirmEscalateRaisingOwn], reviews: [OK], cycle: { maxRounds: 1 } });
    check("escalating onto the question this same packet raises is accepted", own.carriedIds.length === 0 && own.stateOf("q2") === "live", `${JSON.stringify(own.carriedIds)}/${own.stateOf("q2")}`);
    const live = await run(src, { fixes: [escalate, confirmEscalateOntoLive], reviews: [OK], cycle: { maxRounds: 1 } });
    check("escalating onto an earlier pass's still-live question is accepted", live.carriedIds.length === 0 && live.stateOf("q1") === "live", `${JSON.stringify(live.carriedIds)}/${live.stateOf("q1")}`);
  });

  // 23. SAME-PASS retire-and-escalate, spontaneously. Scenario 10 pins this
  //     contradiction only where the escalation covers a handed finding, where
  //     the coverage walk catches it; here the pass is handed nothing, so only
  //     the back-reference guard can. "Live" therefore means live AFTER this
  //     pass's own retirements — the very predicate coverage uses — or a
  //     confirmation pass could settle a decision and escalate to it in one
  //     breath with nothing said.
  await scenario("23. spontaneous escalation onto a question this pass retires", async () => {
    const { carried, carriedIds, stateOf } = await run(src, {
      fixes: [escalate, fixOn("r1-1"), confirmRetireAndEscalateSame],
      reviews: [FAIL("r1"), OK],
      cycle: { maxRounds: 2 },
    });
    check("escalating onto a question the same pass retires is reported", carriedIds.includes("question:q1"), carried);
    check("the same pass's own retirement still takes effect as a claim", stateOf("q1") === "pending", stateOf("q1"));
  });

  // 24. The same rule on the other thing a pass can silently take off the
  //     maintainer's list: a deviation from a LOCKED decision. A pass that
  //     stops restating one is CLAIMING it no longer stands, so the claim needs
  //     a round exactly as a retirement does. The terminating confirmation pass
  //     is where that matters — it is asked to return an empty `dispositions`
  //     array — so without the claim rule a schema-driven fixer echoing
  //     `deviations: []` there erases a live deviation, leaving the one call
  //     the loop may not make in a log line.
  //
  //     A retirement claim rides IN `dispositions`, so it can never reach the
  //     terminal check; a MOVE OF THE DEVIATION SET rides in neither, so it
  //     would, and the check takes the open move as its own reason to run one
  //     more round. That is what makes the claim kinds converge alike rather
  //     than leaving one unadjudicated on the cycle's ordinary exit.
  //
  //     The rule is one question — did this pass move the set — so both
  //     directions are pinned here: a drop takes a deviation off the
  //     maintainer's list unverified, an add puts one on it carrying only the
  //     implementer's half of the protocol.
  await scenario("24. a confirmation pass that moves the deviation set needs a round", async () => {
    const dropped = await run(src, { fixes: [deviate, idle, idle], reviews: [OK_DEV, OK] });
    check("a drop claimed on the terminal confirmation pass earns a round", dropped.seen.reviewPrompts.length === 2 && /no longer restates/.test(dropped.seen.reviewPrompts[1] || "") && (dropped.seen.reviewPrompts[1] || "").includes(DEV), `${dropped.seen.reviewPrompts.length} review prompt(s)`);
    check("the round that passes over it clears the deviation", dropped.res.verdict === "pass" && (dropped.res.deviations || []).length === 0, `${dropped.res.verdict}/${JSON.stringify(dropped.res.deviations)}`);
    check("the per-pass history rides beside it, named as history", Array.isArray(dropped.res.deviationHistory) && dropped.res.deviationHistory.length === 3 && dropped.res.deviationHistory[0].deviations.length === 1 && dropped.res.deviationHistory[2].deviations.length === 0, JSON.stringify(dropped.res.deviationHistory));

    // It is a SET. One deviation stated twice in a packet is one deviation, and
    // left doubled it would ride to the top of a PR body twice and count twice
    // toward the set move — the one place the quantity, not just its emptiness,
    // is read.
    const doubled = await run(src, { fixes: [doubleDeviate, confirmDoubleDeviate], reviews: [OK_DEV] });
    check("a deviation stated twice in one packet is one deviation", JSON.stringify(doubled.res.deviations) === JSON.stringify([DEV]) && JSON.stringify((doubled.res.deviationHistory || [])[0]) === JSON.stringify({ pass: 1, deviations: [DEV] }), `${JSON.stringify(doubled.res.deviations)} / ${JSON.stringify((doubled.res.deviationHistory || [])[0])}`);

    // The conjunct is narrow: only an OPEN claim holds the cycle open. A
    // confirmation pass that restates what stands still terminates on the spot,
    // so an ordinary cycle carrying a deviation pays no extra round for it.
    const restated = await run(src, { fixes: [deviate, confirmDeviate], reviews: [OK_DEV] });
    check("a confirmation pass that restates costs no extra round", restated.res.verdict === "pass" && restated.seen.reviewPrompts.length === 1, `${restated.res.verdict}/${restated.seen.reviewPrompts.length} review prompt(s)`);
    check("and the restated deviation ships as the final state", JSON.stringify(restated.res.deviations) === JSON.stringify([DEV]), JSON.stringify(restated.res.deviations));
    check("with the reviewing round's half beside it", JSON.stringify(restated.res.deviationAssessments) === JSON.stringify([ASSESS]), JSON.stringify(restated.res.deviationAssessments));

    // The no-latching half, unchanged: a drop a round passed over takes effect,
    // so the result still describes the FINAL state rather than every round's.
    const accepted = await run(src, { fixes: [deviate, fixOn("r1-1"), idle], reviews: [FAIL("r1"), OK] });
    check("a drop a round passes over takes effect", accepted.res.verdict === "pass" && (accepted.res.deviations || []).length === 0, JSON.stringify(accepted.res.deviations));
    check("the round that decides it is SHOWN the claim", /no longer restates/.test(accepted.seen.reviewPrompts[1] || "") && (accepted.seen.reviewPrompts[1] || "").includes(DEV), "round-2 review prompt");

    // The round a confirmation-pass claim earns can also REJECT it — the half
    // that was unreachable while such a claim ended the cycle instead.
    const disputed = await run(src, {
      fixes: [deviate, idle, fixOn("r2-1")],
      reviews: [OK_DEV, FAIL("that deviation still stands"), FAIL("it still stands")],
      cycle: { maxRounds: 3 },
    });
    check("a confirmation-pass claim the round rejects leaves the deviation standing", disputed.res.verdict === "review-cap" && JSON.stringify(disputed.res.deviations) === JSON.stringify([DEV]), `${disputed.res.verdict}/${JSON.stringify(disputed.res.deviations)}`);

    // A reviewer that keeps rejecting the claim -> round cap -> still standing.
    const rejected = await run(src, {
      fixes: [deviate, fixOn("r1-1"), fixOn("r2-1")],
      reviews: [FAIL("r1"), FAIL("that deviation still stands"), FAIL("it still stands")],
      cycle: { maxRounds: 3 },
    });
    check("a claim no round passed is re-presented to the next one", /no longer restates/.test(rejected.seen.reviewPrompts[2] || ""), "round-3 review prompt");
    check("a rejected drop leaves the deviation standing at the cap", rejected.res.verdict === "review-cap" && JSON.stringify(rejected.res.deviations) === JSON.stringify([DEV]), `${rejected.res.verdict}/${JSON.stringify(rejected.res.deviations)}`);

    // The SAME rule in the other direction. A deviation first stated on the
    // confirmation pass is the mirror of a drop: the set moves, and no round
    // has seen the move. It matters because the protocol has two halves — the
    // implementer states the deviation and the constraint that forced it, the
    // Reviewer adds whether an in-spec route existed and a RATIFY/CONFORM
    // recommendation — and the maintainer reads this deviation at the top of
    // the summary either way. Terminating here would hand it over carrying the
    // implementer's half alone.
    //
    // Nor does reaching it take a misbehaving fixer: a pass is told to REPORT a
    // deviation rather than correct it, and a deviation is not a finding, so a
    // confirmation pass that first recognizes one returns exactly this packet
    // — nothing changed, nothing disposed — by following the contract.
    const added = await run(src, { fixes: [PASS_PACKET, confirmDeviate, confirmDeviate], reviews: [OK, OK_DEV] });
    check("a deviation first stated on the confirmation pass earns a round", added.seen.reviewPrompts.length === 2 && (added.seen.reviewPrompts[1] || "").includes(DEV), `${added.seen.reviewPrompts.length} review prompt(s)`);
    check("the round it earns is asked for the Reviewer's half of the protocol", /in-spec route existed/.test(added.seen.reviewPrompts[1] || "") && /RATIFY or CONFORM/.test(added.seen.reviewPrompts[1] || ""), "round-2 review prompt");
    check("an ADD is not presented as a drop", !/no longer restates/.test(added.seen.reviewPrompts[1] || ""), "round-2 review prompt");
    check("and the reviewed deviation ships as the final state", added.res.verdict === "pass" && JSON.stringify(added.res.deviations) === JSON.stringify([DEV]), `${added.res.verdict}/${JSON.stringify(added.res.deviations)}`);

    // At the cap the move exits `review-cap` naming itself, exactly as a drop
    // does — the deviation still standing, never silently passed off as judged.
    const addedAtCap = await run(src, { fixes: [PASS_PACKET, confirmDeviate], reviews: [OK], cycle: { maxRounds: 1 } });
    check("an add the cap leaves unreviewed exits review-cap, deviation standing", addedAtCap.res.verdict === "review-cap" && JSON.stringify(addedAtCap.res.deviations) === JSON.stringify([DEV]), `${addedAtCap.res.verdict}/${JSON.stringify(addedAtCap.res.deviations)}`);
    check("and the cap exit's note names the deviation-set move", /newly stated deviation/.test(((addedAtCap.res.outstanding || {}).note) || ""), JSON.stringify(addedAtCap.res.outstanding || {}));
  });

  // 25. The OTHER half of the same protocol, and the reason scenario 24's
  //     rounds now say `OK_DEV` where they once said `OK`. The implementer
  //     states the deviation and the constraint that forced it; the Reviewer
  //     adds whether an in-spec route existed and a RATIFY/CONFORM
  //     recommendation, because that is what the maintainer's call needs. Asked
  //     for in prose alone it was optional in fact — `{pass: true, issues: [],
  //     notes: ""}` is schema-valid — so a round could pass a deviation
  //     straight through to a PR body carrying the implementer's half only,
  //     while the result claimed it had been reviewed. The assessment is a
  //     structural item and the round is gated on it, exactly as it is gated on
  //     every handed finding having a disposition.
  await scenario("25. a standing deviation gates the round until the reviewer assesses it", async () => {
    const gated = await run(src, {
      fixes: [deviate, deviateDeclining("r1-1"), confirmDeviate],
      reviews: [OK, OK_DEV],
      cycle: { maxRounds: 3 },
    });
    // Read off the SECOND fixer prompt, not the round count: a round that did
    // not pass sends a FIX-UP pass, while one that passed sends the final
    // confirmation pass — and both shapes reach a second reviewer round here,
    // so only the pass's own framing tells the two apart.
    check("a bare pass does not end a round carrying a standing deviation", /This is fix-up round 2/.test(gated.seen.fixPrompts[1] || "") && gated.res.verdict === "pass", `${gated.res.verdict}/${gated.seen.reviewPrompts.length} review prompt(s)`);
    check("the gap comes back to the fixer as a finding naming the deviation", /deviationAssessments/.test(gated.seen.fixPrompts[1] || "") && (gated.seen.fixPrompts[1] || "").includes(DEV), "round-2 fix prompt");
    check("and that finding forbids conforming the deviation away", /Do NOT conform, reword, or drop the deviation/.test(gated.seen.fixPrompts[1] || ""), "round-2 fix prompt");
    check("the assessment the passing round accepted ships with the deviation", JSON.stringify(gated.res.deviationAssessments) === JSON.stringify([ASSESS]), JSON.stringify(gated.res.deviationAssessments));

    // Half an assessment is none. The maintainer's call needs both halves, so
    // an entry that names the deviation and then says nothing about which way
    // to rule leaves it exactly as unassessed as a missing entry does.
    const halfAssessed = await run(src, {
      fixes: [deviate, deviateDeclining("r1-1"), confirmDeviate],
      reviews: [{ pass: true, issues: [], notes: "", deviationAssessments: [{ deviation: DEV, inSpecRoute: "none existed", recommendation: "   " }] }, OK_DEV],
      cycle: { maxRounds: 3 },
    });
    check("an entry with no recommendation does not count as an assessment", /This is fix-up round 2/.test(halfAssessed.seen.fixPrompts[1] || "") && halfAssessed.res.verdict === "pass", `${halfAssessed.res.verdict}/${halfAssessed.seen.reviewPrompts.length} review prompt(s)`);

    // And neither does a recommendation that answers something else. The
    // maintainer's list is a ratify-or-conform list, so a hedge is a
    // filled-in field rather than the choice the field exists to record —
    // exactly as unassessed as the blank above, and caught only because the
    // gate parses the verdict rather than measuring the string's length.
    const hedged = await run(src, {
      fixes: [deviate, deviateDeclining("r1-1"), confirmDeviate],
      reviews: [{ pass: true, issues: [], notes: "", deviationAssessments: [{ deviation: DEV, inSpecRoute: "none existed", recommendation: "UNSURE — needs investigation" }] }, OK_DEV],
      cycle: { maxRounds: 3 },
    });
    check("a recommendation that is not RATIFY or CONFORM does not count either", /This is fix-up round 2/.test(hedged.seen.fixPrompts[1] || "") && hedged.res.verdict === "pass" && JSON.stringify(hedged.res.deviationAssessments) === JSON.stringify([ASSESS]), `${hedged.res.verdict}/${JSON.stringify(hedged.res.deviationAssessments)}`);

    // The hedge that opens WITH a verdict, and the only one an ordinary round
    // reaches: the brief renders "START with RATIFY or CONFORM", so a reviewer
    // that opens its recommendation with the phrase it was told to start with
    // is echoing the brief's surface form rather than crafting input. Read by
    // first word alone it would count as RATIFY, and the maintainer would be
    // handed a verdict from a reviewer that explicitly refused to choose.
    const bothVerdicts = await run(src, {
      fixes: [deviate, deviateDeclining("r1-1"), confirmDeviate],
      reviews: [{ pass: true, issues: [], notes: "", deviationAssessments: [{ deviation: DEV, inSpecRoute: "none existed", recommendation: "RATIFY or CONFORM — needs investigation" }] }, OK_DEV],
      cycle: { maxRounds: 3 },
    });
    check("opening with BOTH verdicts is a refusal to choose, not a RATIFY", /This is fix-up round 2/.test(bothVerdicts.seen.fixPrompts[1] || "") && bothVerdicts.res.verdict === "pass" && JSON.stringify(bothVerdicts.res.deviationAssessments) === JSON.stringify([ASSESS]), `${bothVerdicts.res.verdict}/${JSON.stringify(bothVerdicts.res.deviationAssessments)}`);

    // The positive control the rule above is bounded by, and the reason it
    // tests for a bare `or` rather than for the other verdict occurring: a real
    // choice may name the verdict it rejected in its reason, and must still
    // count. It rides one round with no fix-up in between.
    const NAMES_OTHER = { deviation: DEV, inSpecRoute: "none existed", recommendation: "RATIFY — CONFORM costs a release" };
    const reasonNamesOther = await run(src, {
      fixes: [deviate, confirmDeviate],
      reviews: [{ pass: true, issues: [], notes: "", deviationAssessments: [NAMES_OTHER] }, OK_DEV],
      cycle: { maxRounds: 3 },
    });
    check("a verdict whose reason names the other verdict still counts", reasonNamesOther.res.verdict === "pass" && /FINAL CONFIRMATION PASS/.test(reasonNamesOther.seen.fixPrompts[1] || "") && JSON.stringify(reasonNamesOther.res.deviationAssessments) === JSON.stringify([NAMES_OTHER]), `${reasonNamesOther.res.verdict}/${JSON.stringify(reasonNamesOther.res.deviationAssessments)}`);

    // What the round GATED on is what it PUBLISHES. One usable entry lets the
    // round pass, so a reviewer that also emits a hedged second entry for the
    // same deviation would — if the raw array were recorded — hand the
    // maintainer a RATIFY beside an UNSURE for one decision, which is the
    // present-or-absent reading the verdict parse closed one level up. Only
    // the usable entry ships, and only one of it.
    const alsoHedged = await run(src, {
      fixes: [deviate, confirmDeviate],
      reviews: [{ pass: true, issues: [], notes: "", deviationAssessments: [ASSESS, { deviation: DEV, inSpecRoute: "unclear", recommendation: "UNSURE — could go either way" }] }, OK_DEV],
      cycle: { maxRounds: 3 },
    });
    check("a hedged duplicate does not ride to the maintainer beside the usable entry", alsoHedged.res.verdict === "pass" && JSON.stringify(alsoHedged.res.deviationAssessments) === JSON.stringify([ASSESS]), `${alsoHedged.res.verdict}/${JSON.stringify(alsoHedged.res.deviationAssessments)}`);

    // The judgment does not outlive the packet it judged. A later pass that
    // changes the branch while RESTATING the same deviation text invalidates
    // the accepted assessment on adoption — the text still matching is not the
    // packet still matching — so a failed round at the cap ships the deviation
    // standing and UNJUDGED instead of carrying a pre-change in-spec-route
    // judgment beside work no round approved.
    const staleAtFailedCap = await run(src, {
      fixes: [deviate, deviate],
      reviews: [OK_DEV, FAIL("the changed work regressed")],
      cycle: { maxRounds: 2 },
    });
    check("adopting changed work invalidates the accepted assessment", staleAtFailedCap.res.verdict === "review-cap" && JSON.stringify(staleAtFailedCap.res.deviations) === JSON.stringify([DEV]) && staleAtFailedCap.res.deviationAssessments === undefined, `${staleAtFailedCap.res.verdict}/${JSON.stringify(staleAtFailedCap.res.deviationAssessments)}`);

    // The same invalidation on the OTHER cap exit — a confirmation pass whose
    // adopted work the cap leaves no round to review. Nothing re-judged the
    // changed packet, so nothing rides beside it.
    const staleAtAdoptCap = await run(src, {
      fixes: [deviate, deviate],
      reviews: [OK_DEV],
      cycle: { maxRounds: 1 },
    });
    check("the cap exit before any re-review ships no stale assessment either", staleAtAdoptCap.res.verdict === "review-cap" && JSON.stringify(staleAtAdoptCap.res.deviations) === JSON.stringify([DEV]) && staleAtAdoptCap.res.deviationAssessments === undefined, `${staleAtAdoptCap.res.verdict}/${JSON.stringify(staleAtAdoptCap.res.deviationAssessments)}`);

    // A deviation the pass CLAIMS no longer stands is exempt: passing the round
    // is what removes it, so demanding a ratify-or-conform recommendation on
    // something about to be gone would buy a round for nobody. A drop the
    // reviewer does not accept is an issue, which fails the round on its own.
    const dropOnly = await run(src, { fixes: [deviate, idle, idle], reviews: [OK_DEV, OK] });
    check("a round carrying only a claimed drop passes without one", dropOnly.res.verdict === "pass" && /FINAL CONFIRMATION PASS/.test(dropOnly.seen.fixPrompts[2] || ""), `${dropOnly.res.verdict}/${dropOnly.seen.fixPrompts.length} fix prompt(s)`);
    check("and a result with no standing deviation ships no assessments", dropOnly.res.deviationAssessments === undefined, JSON.stringify(dropOnly.res.deviationAssessments));
  });

  // 26. The trivial-round close-out ends a cycle with NO fresh reviewer ever
  //     seeing the pass, so what it may swallow is a gate, not a detail. It is
  //     checked on the DIFF — and that check is structurally blind to a
  //     disposition that leaves no diff. A `declined` finding ships as an empty
  //     hunk, so a pass fixing two typos beside a declined off-by-one would
  //     otherwise conclude the cycle with the decline adjudicated by nobody,
  //     against the cycle's own contract that a decline is verified by the next
  //     fresh reviewer and never final on the fixer's say-so. `escalated` is
  //     the same shape. Hence: fixed-only, checked structurally, beside the
  //     retirement and deviation claims that already hold the cycle open.
  await scenario("26. a close-out concludes only over fixes", async () => {
    const concluded = await run(src, {
      fixes: [PASS_PACKET, closeOutFix("r1-1")],
      reviews: [FAIL("a wording nit")],
      cycle: { closeOut: "on" },
    });
    check("a fix-only non-semantic pass concludes with no further round", concluded.res.verdict === "pass" && concluded.seen.reviewPrompts.length === 1 && !!concluded.res.closeOut, `${concluded.res.verdict}/${concluded.seen.reviewPrompts.length} review prompt(s)/${JSON.stringify(concluded.res.closeOut)}`);
    check("and the result records the pass, range and unreviewed edits", !!concluded.res.closeOut && concluded.res.closeOut.pass === 2 && concluded.res.closeOut.range === "sha..sha" && JSON.stringify(concluded.res.closeOut.edits) === JSON.stringify(CLOSE_OUT_EDITS), JSON.stringify(concluded.res.closeOut));

    // Option (a): the delivery run follows the non-semantic fixes, then the
    // flake policy appends its one diagnosis-only record commit. The same
    // read-only close-out check splits that suffix itself; the packet's note is
    // withheld from the check so it cannot self-certify the licence.
    const withRecord = await run(src, {
      fixes: [PASS_PACKET, closeOutRecordOnly("r1-1")],
      reviews: [FAIL("a wording nit")],
      closeOuts: [{ nonSemantic: true, editsPresent: true, recordOnlySuffix: true, recordOnlyRange: RECORD_RANGE, why: "non-semantic fixes followed by one diagnosis-only record commit" }],
      cycle: { closeOut: "on" },
    });
    check("a non-confirming close-out pass survives its delivery run's record-only suffix", withRecord.res.verdict === "pass" && withRecord.seen.reviewPrompts.length === 1 && !!withRecord.res.closeOut && !!withRecord.res.recordOnly, `${withRecord.res.verdict}/${withRecord.seen.reviewPrompts.length} review prompt(s)/${JSON.stringify(withRecord.res)}`);
    check("the conclusion detail names both kinds of unreviewed content", /non-semantic fixes plus the independently checked unrelated-flake record suffix/.test(withRecord.res.detail || ""), withRecord.res.detail);
    check("the conclusion names the whole unreviewed close-out range and its non-semantic edits", withRecord.res.closeOut && withRecord.res.closeOut.range === `sha..${RECORD_TIP}` && JSON.stringify(withRecord.res.closeOut.edits) === JSON.stringify(CLOSE_OUT_EDITS), JSON.stringify(withRecord.res.closeOut));
    check("and names the independently checked flake suffix and carries the delivery note", withRecord.res.recordOnly && withRecord.res.recordOnly.range === RECORD_RANGE && withRecord.res.recordOnly.note === FLAKE_NOTE && /diagnosis-only record/.test(withRecord.res.recordOnly.verified || ""), JSON.stringify(withRecord.res.recordOnly));
    check("whose range is exactly the measured final commit's actual parent through its measured tip", withRecord.res.recordOnly && withRecord.res.recordOnly.range === `${withRecord.res.packetChecks.at(-1).headParentSha}..${withRecord.res.packetChecks.at(-1).headSha}`, `${JSON.stringify(withRecord.res.recordOnly)}/${JSON.stringify(withRecord.res.packetChecks.at(-1))}`);
    check("the one check is asked to split and judge all three claims without seeing the pass's flake note", withRecord.seen.closeOutPrompts.length === 1 && /answer THREE questions/.test(withRecord.seen.closeOutPrompts[0] || "") && /recordOnlySuffix/.test(withRecord.seen.closeOutPrompts[0] || "") && /FINAL commit/.test(withRecord.seen.closeOutPrompts[0] || "") && !(withRecord.seen.closeOutPrompts[0] || "").includes(FLAKE_NOTE), "close-out check prompt");
    const offeringFixPrompt = withRecord.seen.fixPrompts[1] || "";
    check("the rendered fixer brief lets a compliant producer offer the path while listing only pre-suffix edits", /list ONLY those non-semantic edits in `closeOutEdits`/.test(offeringFixPrompt) && /SOLE exception is an exact FINAL diagnosis-only record commit/.test(offeringFixPrompt) && /put that failure and its record in `flakeRecord`/.test(offeringFixPrompt) && /leave the record itself OUT of `closeOutEdits`/.test(offeringFixPrompt), "fixer prompt");
    check("the rendered fixer brief makes the claimed record non-self-certifying and forbids every broader semantic change", /`flakeRecord` does not certify or broaden the exception/.test(offeringFixPrompt) && /independently reads the diff and measures the final commit and its actual parent/.test(offeringFixPrompt) && /any other executable, behavioral, or semantic change anywhere in the pass diff/.test(offeringFixPrompt) && /however it got there or how `flakeRecord` describes it, forfeits the close-out/.test(offeringFixPrompt), "fixer prompt");

    // Negative control for the new split: a valid record suffix cannot hide a
    // semantic hunk in the preceding fixes portion. It forfeits both records
    // for the normal round, just like the unsplit close-out veto below.
    const semanticBeforeRecord = await run(src, {
      fixes: [PASS_PACKET, closeOutRecordOnly("r1-1"), idle],
      reviews: [FAIL("a wording nit"), OK],
      closeOuts: [{ nonSemantic: false, editsPresent: true, recordOnlySuffix: true, recordOnlyRange: RECORD_RANGE, why: "an executable hunk preceded the diagnosis-only suffix" }],
      cycle: { closeOut: "on" },
    });
    check("a semantic hunk before a valid record suffix still buys the normal reviewer round", semanticBeforeRecord.res.verdict === "pass" && semanticBeforeRecord.seen.reviewPrompts.length === 2 && !semanticBeforeRecord.res.closeOut && !semanticBeforeRecord.res.recordOnly, `${semanticBeforeRecord.seen.reviewPrompts.length} review prompt(s)/${JSON.stringify(semanticBeforeRecord.res)}`);

    const silentRecord = await run(src, {
      fixes: [PASS_PACKET, closeOutFix("r1-1"), idle],
      reviews: [FAIL("a wording nit"), OK],
      closeOuts: [{ nonSemantic: true, editsPresent: true, recordOnlySuffix: true, recordOnlyRange: RECORD_RANGE, why: "a diagnosis-only suffix" }],
      cycle: { closeOut: "on" },
    });
    check("a verified suffix with no pass note to publish forfeits the close-out", silentRecord.seen.reviewPrompts.length === 2 && !silentRecord.res.closeOut && !silentRecord.res.recordOnly, `${silentRecord.seen.reviewPrompts.length} review prompt(s)/${JSON.stringify(silentRecord.res)}`);

    const unnamedRecord = await run(src, {
      fixes: [PASS_PACKET, closeOutRecordOnly("r1-1"), idle],
      reviews: [FAIL("a wording nit"), OK],
      closeOuts: [{ nonSemantic: true, editsPresent: true, recordOnlySuffix: true, recordOnlyRange: "HEAD^..HEAD", why: "a diagnosis-only suffix without exact OIDs" }],
      cycle: { closeOut: "on" },
    });
    check("a suffix not named by its exact OID range cannot conclude", unnamedRecord.seen.reviewPrompts.length === 2 && !unnamedRecord.res.closeOut && !unnamedRecord.res.recordOnly, `${unnamedRecord.seen.reviewPrompts.length} review prompt(s)/${JSON.stringify(unnamedRecord.res)}`);

    const wrongTipRecord = await run(src, {
      fixes: [PASS_PACKET, closeOutRecordOnly("r1-1"), idle],
      reviews: [FAIL("a wording nit"), OK],
      closeOuts: [{ nonSemantic: true, editsPresent: true, recordOnlySuffix: true, recordOnlyRange: WRONG_RECORD_RANGE, why: "a valid-looking range ending at another commit" }],
      cycle: { closeOut: "on" },
    });
    check("a valid-looking suffix range that does not end at the pass tip cannot conclude", wrongTipRecord.seen.reviewPrompts.length === 2 && !wrongTipRecord.res.closeOut && !wrongTipRecord.res.recordOnly, `${wrongTipRecord.seen.reviewPrompts.length} review prompt(s)/${JSON.stringify(wrongTipRecord.res)}`);

    // The left boundary is not merely another well-shaped OID. Use the
    // previously reviewed tip as the checker's dynamic answer: it is exactly
    // `passBase`, but it is NOT the final commit's parent. The old structural
    // gate accepted this whole-pass range because only its right endpoint was
    // compared; the independent packet reading now rejects it.
    const reviewedTip = "c".repeat(40);
    const wrongParentRecord = await run(src, {
      fixes: [{ ...PASS_PACKET, finalSha: reviewedTip }, closeOutRecordOnly("r1-1"), idle],
      reviews: [FAIL("a wording nit"), OK],
      closeOuts: [{ nonSemantic: true, editsPresent: true, recordOnlySuffix: true, recordOnlyRange: `${reviewedTip}..${RECORD_TIP}`, why: "the checker mislabeled the whole pass range as the final record commit" }],
      cycle: { closeOut: "on" },
    });
    check("a checker returning the dynamic passBase..finalSha range cannot substitute the wrong parent for the final commit's actual parent", wrongParentRecord.seen.reviewPrompts.length === 2 && !wrongParentRecord.res.closeOut && !wrongParentRecord.res.recordOnly, `${wrongParentRecord.seen.reviewPrompts.length} review prompt(s)/${JSON.stringify(wrongParentRecord.res)}`);

    const declined = await run(src, {
      fixes: [PASS_PACKET, closeOutDecline("r1-1"), idle],
      reviews: [FAIL("off-by-one in the cap check"), OK],
      cycle: { closeOut: "on" },
    });
    check("a DECLINED disposition forfeits the close-out for a normal round", declined.res.verdict === "pass" && declined.seen.closeOutPrompts.length === 0 && declined.seen.reviewPrompts.length === 2 && !declined.res.closeOut, `${declined.seen.closeOutPrompts.length} close-out check(s)/${declined.seen.reviewPrompts.length} review prompt(s)`);
    check("and the round it buys is shown the decline to adjudicate", /"disposition": "declined"/.test(declined.seen.reviewPrompts[1] || ""), "round-2 review prompt");

    const escalated = await run(src, {
      fixes: [PASS_PACKET, closeOutEscalate("r1-1"), idle],
      reviews: [FAIL("a wording nit"), OK],
      cycle: { closeOut: "on" },
    });
    check("an ESCALATED disposition forfeits it too", escalated.res.verdict === "pass" && escalated.seen.closeOutPrompts.length === 0 && escalated.seen.reviewPrompts.length === 2, `${escalated.seen.closeOutPrompts.length} close-out check(s)/${escalated.seen.reviewPrompts.length} review prompt(s)`);

    // The diff check's own veto, unchanged: the offer is never the licence.
    const vetoed = await run(src, {
      fixes: [PASS_PACKET, closeOutFix("r1-1"), idle],
      reviews: [FAIL("a wording nit"), OK],
      closeOuts: [{ nonSemantic: false, editsPresent: true, why: "an executable hunk rode along" }],
      cycle: { closeOut: "on" },
    });
    check("a semantic hunk in the diff still forfeits the close-out", vetoed.seen.closeOutPrompts.length === 1 && vetoed.seen.reviewPrompts.length === 2 && !vetoed.res.closeOut, `${vetoed.seen.closeOutPrompts.length} close-out check(s)/${vetoed.seen.reviewPrompts.length} review prompt(s)`);

    // The check's OTHER direction, and the one a triviality read is blind to:
    // an empty range is vacuously non-semantic, so without it a pass could
    // report every finding `fixed`, commit nothing, and conclude the cycle
    // with the claim adjudicated by nobody — the round that catches exactly
    // that being the round this exit skips.
    const missing = await run(src, {
      fixes: [PASS_PACKET, closeOutFix("r1-1"), idle],
      reviews: [FAIL("a wording nit"), OK],
      closeOuts: [{ nonSemantic: true, editsPresent: false, why: "the range does not carry the claimed edit" }],
      cycle: { closeOut: "on" },
    });
    check("a claimed edit the range does not carry forfeits the close-out", missing.seen.closeOutPrompts.length === 1 && missing.seen.reviewPrompts.length === 2 && !missing.res.closeOut, `${missing.seen.closeOutPrompts.length} close-out check(s)/${missing.seen.reviewPrompts.length} review prompt(s)`);
    check("and the check is asked both questions about the range", /`editsPresent`/.test(missing.seen.closeOutPrompts[0] || "") && /NON-EMPTY/.test(missing.seen.closeOutPrompts[0] || "") && /everything the pass claims below/.test(missing.seen.closeOutPrompts[0] || ""), "close-out check prompt");

    // The second question's OTHER input, and the reason it answers the case it
    // is named for. The edit list is the pass's account of what it shipped; the
    // `fixed` dispositions are its account of what it was ASKED for, and only
    // the second names a fix that never landed. Handed the list alone, a pass
    // that forgot one requested fix while shipping and listing an unrelated
    // tidy-up clears every question here — non-empty range, listed edit
    // present, nothing semantic — and concludes the cycle with the omission
    // adjudicated by nobody, since the round that catches it is the one this
    // exit skips.
    check("and it is handed the pass's `fixed` findings beside the edit list", /## Findings the pass disposed `fixed`/.test(missing.seen.closeOutPrompts[0] || "") && /"finding": "f"/.test(missing.seen.closeOutPrompts[0] || "") && /a change answering every FINDING it disposed `fixed`/.test(missing.seen.closeOutPrompts[0] || ""), "close-out check prompt");

    // And a pass with nothing disposed `fixed` is told so, rather than handed
    // an empty array under a heading that reads as work to go find.
    const noFixes = await run(src, {
      fixes: [PASS_PACKET, { ...PASS_PACKET, dispositions: [], closeOutEdits: CLOSE_OUT_EDITS }],
      reviews: [OK],
      cycle: { closeOut: "on" },
    });
    check("a close-out over no `fixed` disposition says so rather than listing none", noFixes.seen.closeOutPrompts.length === 1 && /this pass disposed no finding `fixed`/.test(noFixes.seen.closeOutPrompts[0] || "") && !!noFixes.res.closeOut, `${noFixes.seen.closeOutPrompts.length} close-out check(s)/${JSON.stringify(noFixes.res.closeOut)}`);

    // The structural half of the same guard: a pass claiming `fixed` while
    // reporting it changed nothing contradicts its own offer, and the gate
    // settles that without spending a check on it.
    const unchanged = await run(src, {
      fixes: [PASS_PACKET, closeOutUnchanged("r1-1"), idle],
      reviews: [FAIL("a wording nit"), OK],
      cycle: { closeOut: "on" },
    });
    check("a pass that changed nothing cannot close out over its `fixed` claims", unchanged.seen.closeOutPrompts.length === 0 && unchanged.seen.reviewPrompts.length === 2 && !unchanged.res.closeOut, `${unchanged.seen.closeOutPrompts.length} close-out check(s)/${unchanged.seen.reviewPrompts.length} review prompt(s)`);

    // Round 1 has no previous SHA, so there is no range to judge — the offer
    // cannot conclude a cycle nothing has reviewed yet.
    const first = await run(src, { fixes: [closeOutRound1, idle], reviews: [OK], cycle: { closeOut: "on" } });
    check("round 1 cannot close out", first.seen.closeOutPrompts.length === 0 && first.seen.reviewPrompts.length === 1 && !first.res.closeOut, `${first.seen.closeOutPrompts.length} close-out check(s)`);

    // And with the grant withheld the offer is inert, however it arrives.
    const ungranted = await run(src, { fixes: [PASS_PACKET, closeOutFix("r1-1"), idle], reviews: [FAIL("a wording nit"), OK] });
    check("an offer with no invoker grant is inert", ungranted.seen.closeOutPrompts.length === 0 && ungranted.seen.reviewPrompts.length === 2 && !ungranted.res.closeOut, `${ungranted.seen.closeOutPrompts.length} close-out check(s)`);

    // The two claims scenario 24 and the retirement suite hold the TERMINAL
    // check open for, made on a pass that also offers a close-out. Both are
    // invisible to the diff check — a dropped deviation and a retirement claim
    // ship as no hunk at all — so if this gate did not carry the same two
    // conjuncts, a pass fixing two typos beside either one would conclude the
    // cycle with the claim adjudicated by nobody. Neither is hypothetical: the
    // close-out is offered on a passing-adjacent round, which is exactly where
    // a pass settles the last open question or stops restating a deviation.
    const movedDeviation = await run(src, {
      fixes: [deviate, closeOutFix("r1-1"), idle],
      reviews: [FAIL("a wording nit"), OK],
      cycle: { closeOut: "on" },
    });
    check("a deviation-set move forfeits the close-out for a normal round", movedDeviation.seen.closeOutPrompts.length === 0 && movedDeviation.seen.reviewPrompts.length === 2 && !movedDeviation.res.closeOut, `${movedDeviation.seen.closeOutPrompts.length} close-out check(s)/${movedDeviation.seen.reviewPrompts.length} review prompt(s)`);
    check("and the round it buys is shown the claimed drop", /no longer restates/.test(movedDeviation.seen.reviewPrompts[1] || "") && (movedDeviation.seen.reviewPrompts[1] || "").includes(DEV), "round-2 review prompt");

    const claimedRetirement = await run(src, {
      fixes: [escalate, closeOutRetire("r1-1"), idle],
      reviews: [FAIL("a wording nit"), OK],
      cycle: { closeOut: "on" },
    });
    check("a retirement claim forfeits the close-out for a normal round", claimedRetirement.seen.closeOutPrompts.length === 0 && claimedRetirement.seen.reviewPrompts.length === 2 && !claimedRetirement.res.closeOut, `${claimedRetirement.seen.closeOutPrompts.length} close-out check(s)/${claimedRetirement.seen.reviewPrompts.length} review prompt(s)`);
    check("and the round it buys is the one that adjudicates the claim", /proposed for RETIREMENT/.test(claimedRetirement.seen.reviewPrompts[1] || "") && claimedRetirement.stateOf("q1") === "retired", `${claimedRetirement.stateOf("q1")}`);
  });

  // 27. The reviewer's build-first rule is conditioned on the tier the
  //     orchestrator states, so the default decides what a renderer that states
  //     none would get. No shipped caller is in that position today — every one
  //     states its tier, wf-address-tasks' pre-PR collision re-review included
  //     — so the default is purely defensive, and pinning it is what keeps it
  //     the DELIVERY tier: a renderer with no cycle behind it is one whose pass
  //     can be the last check before a PR opens, and a round-tier default would
  //     silently weaken the next one written.
  await scenario("27. an unstated tier means the delivery tier", async () => {
    const { cycleReviewChecks } = loadCycle(src, async () => null);
    const unstated = cycleReviewChecks("code", undefined);
    check("an unstated tier renders the DELIVERY tier", /DELIVERY tier/.test(unstated) && !/ROUND tier/.test(unstated), unstated.slice(0, 200));
    check("an unstated tier renders it for an applied-decision diff too", /DELIVERY tier/.test(cycleReviewChecks("decision", undefined)));
    check("`round` is the tier that must be asked for", /ROUND tier/.test(cycleReviewChecks("code", "round")) && !/DELIVERY tier/.test(cycleReviewChecks("code", "round")));
    check("`delivery` renders the delivery tier", /DELIVERY tier/.test(cycleReviewChecks("code", "delivery")));
    // The round-tier brief tells the reviewer to skip a heavier suite, so it
    // owes the same escalation guard the fixer's tier line carries.
    check("the round-tier brief carries the escalation guard", /run more, not less/.test(cycleReviewChecks("code", "round")) && /build configuration, dependencies, or generated contracts/.test(cycleReviewChecks("code", "round")), cycleReviewChecks("code", "round"));

    // The reviewer's half of the flake rule has to admit BOTH shapes the
    // fixer's half prescribes. The cited-active-task outcome commits nothing by
    // design — that is the point of citing rather than editing a base-landed
    // file — so a gate that recognized only a newly committed task would block
    // the outcome the policy asks for on every required round, `light` mode's
    // last one included, and drive a conforming cycle to its cap.
    check("the reviewer's flake gate admits a cited ACTIVE task, not only a new commit", /ACTIVE existing task the pass cited/.test(cycleReviewChecks("code", "delivery")) && /NEW one committed on this branch/.test(cycleReviewChecks("code", "delivery")), cycleReviewChecks("code", "delivery"));

    // Admitting the shape is only half of it: the gate must also point the
    // reviewer at a record it HOLDS. `cycleReviewPrompt` never renders the
    // pass's `flakeRecord` — deliberately, and the light-mode scenario below
    // rests on that — so a gate telling the reviewer to "check the pass's flake
    // record" sent it to the one artifact its brief withholds, leaving the
    // cited-task shape unverifiable and blocking anyway: the exact failure the
    // check above exists to prevent, reintroduced one sentence later. What the
    // reviewer does hold is its own failing run and the repository's task
    // folder, which the flake rule makes greppable by requiring the suite name
    // in the task TITLE. Both halves are asserted positively so the gate cannot
    // regress by naming the record again while keeping the grep.
    check("the reviewer's flake gate points the citation check at a record the reviewer HOLDS", /grep the repository's task folder/.test(cycleReviewChecks("code", "delivery")) && /not shown the pass's own flake record/.test(cycleReviewChecks("code", "delivery")), cycleReviewChecks("code", "delivery"));

    // And the cycle states each round's tier, so no in-cycle round relies on
    // the default: an intermediate round is told ROUND, the round a
    // confirmation pass earns is told DELIVERY (it can be the cycle's last).
    const intermediate = await run(src, { fixes: [PASS_PACKET, fixOn("r1-1"), idle], reviews: [FAIL("r1"), OK] });
    check("an intermediate round's reviewer is told the ROUND tier", /ROUND tier/.test(intermediate.seen.reviewPrompts[0] || ""), "round-1 review prompt");
    const confirmed = await run(src, { fixes: [PASS_PACKET, confirmDeviate, confirmDeviate], reviews: [OK, OK] });
    check("the round a confirmation pass earns is told the DELIVERY tier", /DELIVERY tier/.test(confirmed.seen.reviewPrompts[1] || ""), "round-2 review prompt");
  });

  // 28. The record-only close, which is the unstated-tier scenario's rule read
  //     to its conclusion. The delivery tier a confirmation pass owes survives
  //     ONE post-run commit — the flake rule's diagnosis-only task file and the
  //     note recording what that run surfaced — and tiered validation makes
  //     the delivery run the first FULL-suite run of most cycles, so the run
  //     that surfaces a flake is usually that one. Without this exit the
  //     commit is the only thing between the pass and the terminal check: the
  //     cycle buys a round told the DELIVERY tier (that scenario pins it), whose
  //     reviewer runs the whole suite, and the confirmation pass after it owes
  //     that tier again — three runs of the suite the tolerance exists to
  //     spare, for a commit that adds a queue entry and a note.
  //
  //     What keeps it from being a hole is that the pass neither offers it nor
  //     is asked about it: a cheap read-only check judges the RANGE, exactly
  //     as the close-out's does, and every other conjunct of the terminal
  //     check still holds the cycle open — which is what the bounds below pin.
  //     The pass's own record of the failure is a conjunct too, since carrying
  //     that record to the maintainer is the whole reason the round is skipped.
  await scenario("28. a record-only commit concludes without buying a round", async () => {
    const concluded = await run(src, { fixes: [PASS_PACKET, confirmRecordOnly], reviews: [OK], cycle: { maxRounds: 3 } });
    check("a confirmation pass that only committed the record concludes with no further round", concluded.res.verdict === "pass" && concluded.seen.reviewPrompts.length === 1 && !!concluded.res.recordOnly, `${concluded.res.verdict}/${concluded.seen.reviewPrompts.length} review prompt(s)/${JSON.stringify(concluded.res.recordOnly)}`);
    check("and the result records the pass, the range and what the check found", !!concluded.res.recordOnly && concluded.res.recordOnly.pass === 2 && concluded.res.recordOnly.range === "sha..sha" && /nothing but the flake record/.test(concluded.res.recordOnly.verified || ""), JSON.stringify(concluded.res.recordOnly));
    check("the check is asked one question about the DIFF", /Record-only follow-up check/.test(concluded.seen.recordPrompts[0] || "") && /git diff/.test(concluded.seen.recordPrompts[0] || "") && /NOTHING but the unrelated-flake RECORD/.test(concluded.seen.recordPrompts[0] || ""), "record-only check prompt");

    // The record carries the pass's OWN note beside the check's verdict. This
    // exit has no later reviewer round, so nothing else the result carries can
    // tell a consumer's PR body or batch summary what the delivery run
    // surfaced — and the two fields must stay distinguishable, since one is
    // the pass's account and the other the independent check's.
    check("the record carries the pass's own note of what the run surfaced, distinct from the check's line", !!concluded.res.recordOnly && concluded.res.recordOnly.note === FLAKE_NOTE && concluded.res.recordOnly.verified !== concluded.res.recordOnly.note, JSON.stringify(concluded.res.recordOnly));

    // The other half of "the pass's OWN note", and the half a single fixture
    // cannot see: a record reading anything the cycle ACCUMULATES would
    // publish an earlier pass's account under a heading about a failed
    // delivery run. So a pass that reports nothing is REFUSED the exit rather
    // than publishing an empty one: the heading announces a failed delivery run
    // either way, and announcing one with no account of it tells the maintainer
    // less than the round this exit skips would have. Together with the check
    // above, this pins the record to THIS pass's `flakeRecord`: one fails if a
    // populated one stops reaching the note, the other if an absent one buys
    // the exit at all — whether left empty or filled from a predecessor's.
    const silent = await run(src, { fixes: [{ ...PASS_PACKET, flakeRecord: FLAKE_NOTE }, confirmRecordOnlySilent, idle], reviews: [OK, OK], cycle: { maxRounds: 3 } });
    check("a confirming pass that reports no flake record is refused the exit, buying the normal round rather than publishing an empty record", silent.res.recordOnly === undefined && silent.seen.recordPrompts.length === 0 && silent.seen.reviewPrompts.length === 2, `${JSON.stringify(silent.res.recordOnly)}/${silent.seen.recordPrompts.length} record check(s)/${silent.seen.reviewPrompts.length} review prompt(s)`);

    // The other side of that rule, and the reason it is not a data loss: what
    // the record may not PUBLISH as this conclusion's, `flakeHistory` keeps.
    // The two answer different questions — the record speaks for a conclusion
    // whose heading is about a failed DELIVERY run, and only a pass that can
    // conclude the cycle runs that tier — so an INTERMEDIATE pass's record is
    // wrong under that heading and still owed to the maintainer. The terminal
    // exit is where dropping it would bite hardest: nothing is left in the diff
    // to show it either, once the flake rule's cited-active-task outcome has
    // committed nothing.
    check("but the earlier pass's record is not lost with it — `flakeHistory` keeps every pass's", JSON.stringify(silent.res.flakeHistory) === JSON.stringify([{ pass: 1, note: FLAKE_NOTE }]), JSON.stringify(silent.res.flakeHistory));
    const superseded = await run(src, { fixes: [{ ...PASS_PACKET, flakeRecord: FLAKE_NOTE }, idle], reviews: [OK], cycle: { maxRounds: 3 } });
    check("including where a clean confirming pass concludes at the TERMINAL exit, which carries no record at all", superseded.res.verdict === "pass" && superseded.res.recordOnly === undefined && JSON.stringify(superseded.res.flakeHistory) === JSON.stringify([{ pass: 1, note: FLAKE_NOTE }]), `${JSON.stringify(superseded.res.recordOnly)}/${JSON.stringify(superseded.res.flakeHistory)}`);
    check("while a cycle no pass reported a flake on carries no history at all", (await run(src, { fixes: [PASS_PACKET, idle], reviews: [OK] })).res.flakeHistory === undefined, "plain terminal exit");

    // The exits that are not conclusions at all. `flakeHistory` is a log, so
    // the contract promises one entry per reporting pass on EVERY exit — and
    // that binds hardest exactly where the pass did not get to finish: a packet
    // that reports a failed validation run and THEN blocks, or comes back from
    // a worktree that is not clean and idle, or names no artifact directory, is
    // the run whose failure the maintainer most needs told, and it is the one a
    // late append silently loses. Every check the cycle makes on a packet
    // returns before the conclusions do, so the record has to be read the
    // moment the packet is in hand; nothing but these pins would notice it
    // sliding back below them, since a spread on all 14 returns looks correct
    // while the array they spread is still empty. Enumerated, one per error
    // return that can follow a readable packet.
    const blocked = await run(src, { fixes: [{ ...PASS_PACKET, flakeRecord: FLAKE_NOTE, blocker: "the base would not build" }], reviews: [] });
    check("a pass that reports a flake and then BLOCKS still carries that pass's record", blocked.res.verdict === "error" && JSON.stringify(blocked.res.flakeHistory) === JSON.stringify([{ pass: 1, note: FLAKE_NOTE }]), `${blocked.res.verdict}/${JSON.stringify(blocked.res.flakeHistory)}`);
    const unclean = await run(src, { fixes: [{ ...PASS_PACKET, flakeRecord: FLAKE_NOTE, clean: false }], reviews: [] });
    check("so does one whose worktree comes back not clean and idle", unclean.res.verdict === "error" && JSON.stringify(unclean.res.flakeHistory) === JSON.stringify([{ pass: 1, note: FLAKE_NOTE }]), `${unclean.res.verdict}/${JSON.stringify(unclean.res.flakeHistory)}`);
    const homeless = await run(src, { fixes: [{ ...PASS_PACKET, flakeRecord: FLAKE_NOTE, artifactDir: "" }], reviews: [] });
    check("and so does one the cycle refuses for having no home for its round history", homeless.res.verdict === "error" && JSON.stringify(homeless.res.flakeHistory) === JSON.stringify([{ pass: 1, note: FLAKE_NOTE }]), `${homeless.res.verdict}/${JSON.stringify(homeless.res.flakeHistory)}`);

    // The no-commit half of the same rule, and the reachable one: the flake
    // policy tells a pass whose evidence matches an ALREADY-ACTIVE task to
    // cite it rather than edit it, which leaves nothing to commit. That pass
    // is `idle` — nothing changed, nothing disposed — so it exits at the
    // TERMINAL check above, before the record path's `changed` gate. Without
    // the record riding that exit too, a delivery run that FAILED reaches the
    // maintainer nowhere: the consumers publish this record, and the reviewer
    // pass-notes they publish beside it were written before the failure
    // existed.
    const cited = await run(src, { fixes: [PASS_PACKET, confirmCitingActiveTask], reviews: [OK], cycle: { maxRounds: 3 } });
    check("a pass citing an active flake task still concludes without buying a round", cited.res.verdict === "pass" && cited.seen.reviewPrompts.length === 1 && cited.seen.recordPrompts.length === 0, `${cited.res.verdict}/${cited.seen.reviewPrompts.length} review prompt(s)/${cited.seen.recordPrompts.length} record check(s)`);
    check("and its record carries the note with an EMPTY range — this pass cited an active task, so the record names no post-run commit of its own", !!cited.res.recordOnly && cited.res.recordOnly.note === CITED_NOTE && cited.res.recordOnly.range === "" && cited.res.recordOnly.verified === "", JSON.stringify(cited.res.recordOnly));
    check("while an ordinary conclusion carries no record at all", (await run(src, { fixes: [PASS_PACKET, idle], reviews: [OK] })).res.recordOnly === undefined, "plain terminal exit");

    // The check's own veto, the close-out's rule in its own words: the range is
    // the licence, and anything beyond the record in it buys the normal round.
    const vetoed = await run(src, {
      fixes: [PASS_PACKET, confirmRecordOnly, idle],
      reviews: [OK, OK],
      records: [{ recordOnly: false, why: "a source edit rode along" }],
    });
    check("anything beyond the record in the range buys the normal round", vetoed.res.verdict === "pass" && vetoed.seen.recordPrompts.length === 1 && vetoed.seen.reviewPrompts.length === 2 && !vetoed.res.recordOnly, `${vetoed.seen.recordPrompts.length} record check(s)/${vetoed.seen.reviewPrompts.length} review prompt(s)`);
    check("and the round it buys is still told the DELIVERY tier", /DELIVERY tier/.test(vetoed.seen.reviewPrompts[1] || ""), "round-2 review prompt");

    // The bounds. Each is a conjunct the terminal check already carries, so
    // this exit may not be looser than the check it stands in for: a
    // disposition and a deviation-set move are claims a fresh reviewer
    // adjudicates (a retirement claim rides IN `dispositions`, so the first
    // bound covers it), and a pass that is not the CONFIRMATION pass may not
    // reach the check at all — that one is load-bearing beyond cost, since an
    // intermediate pass can leave findings undisposed.
    const disposed = await run(src, { fixes: [PASS_PACKET, confirmSpontaneousFix, idle], reviews: [OK, OK] });
    check("a disposition on the same pass still earns its round", disposed.seen.recordPrompts.length === 0 && disposed.seen.reviewPrompts.length === 2 && !disposed.res.recordOnly, `${disposed.seen.recordPrompts.length} record check(s)/${disposed.seen.reviewPrompts.length} review prompt(s)`);

    const moved = await run(src, { fixes: [PASS_PACKET, { ...confirmRecordOnly, deviations: [DEV] }, confirmDeviate], reviews: [OK, OK_DEV] });
    check("a deviation-set move on the same pass still earns its round", moved.seen.recordPrompts.length === 0 && moved.seen.reviewPrompts.length === 2 && JSON.stringify(moved.res.deviations) === JSON.stringify([DEV]), `${moved.seen.recordPrompts.length} record check(s)/${moved.seen.reviewPrompts.length} review prompt(s)`);

    const intermediate = await run(src, { fixes: [PASS_PACKET, PASS_PACKET], reviews: [FAIL("r1"), OK], cycle: { maxRounds: 2 } });
    check("an intermediate pass never reaches the check, so no finding leaves undisposed", intermediate.seen.recordPrompts.length === 0 && intermediate.res.verdict === "review-cap" && intermediate.carriedIds.includes("r1-1"), `${intermediate.seen.recordPrompts.length} record check(s)/${intermediate.res.verdict}/${intermediate.carried}`);
  });

  // 29. The same record on the LIGHT-mode conclusion — the fourth exit no
  //     reviewer round follows, and the one that needs the record most.
  //     `cycleValidationTier` makes EVERY light-mode pass a delivery-tier pass
  //     precisely because light skips the confirmation pass, so light is the
  //     mode where the run that surfaces a flake is most likely to be the
  //     delivery run. The round that just passed is no substitute carrier: its
  //     brief carries only the packet's dispositions and work report, never
  //     `flakeRecord` — the reviewer's flake gate says so in as many words, the
  //     unstated-tier scenario pins that it SAYS so, and the check below pins
  //     that it is TRUE — so its notes were written without the failure in
  //     view. The record-only scenario's exits and this one are one rule.
  await scenario("29. a light-mode conclusion carries the same flake record", async () => {
    const REVIEWER_CAVEAT = "reviewer caveat";
    const lit = await run(src, {
      fixes: [{ ...PASS_PACKET, flakeRecord: FLAKE_NOTE }],
      reviews: [{ pass: true, issues: [], notes: REVIEWER_CAVEAT }],
      cycle: { mode: "light" },
    });
    check("a light conclusion carries the delivery-tier pass's flake record", lit.res.verdict === "pass" && !!lit.res.recordOnly && lit.res.recordOnly.note === FLAKE_NOTE && lit.res.recordOnly.pass === 1, `${lit.res.verdict}/${JSON.stringify(lit.res.recordOnly)}`);
    check("with the EMPTY range and check line: a light conclusion's record names no post-run commit of its own either, its pass's commits having been seen by the round that just passed", !!lit.res.recordOnly && lit.res.recordOnly.range === "" && lit.res.recordOnly.verified === "", JSON.stringify(lit.res.recordOnly));
    // The omission this whole exit rests on, asserted against a rendered brief
    // rather than against the gate's description of itself. Scenario 27 pins
    // that the gate SAYS the reviewer is not shown the record; nothing pinned
    // that it is so. If a later change plumbs `flakeRecord` onto the brief, the
    // gate would be telling the reviewer a falsehood AND sending it to grep for
    // something it now holds — and without this line the suite would stay green
    // while both this exit's justification and scenario 27's went false.
    check("and the round that passed was never shown that record", !(lit.seen.reviewPrompts[0] || "").includes(FLAKE_NOTE), "round-1 review prompt");
    // `cycleValidationTier`'s light branch, which no other scenario PINS.
    // Reached it certainly is — the light-mode scenario above and this
    // scenario's own clean run below both execute it — but nothing asserts on
    // what it returns: the unstated-tier scenario asserts on the confirming
    // branch and the round branch, and neither is this one. It is the branch
    // that makes the sentence above true — light has no confirmation pass, so
    // THIS round's reviewer is the delivery-tier one — so leaving it unpinned
    // would let a change make a light-mode round's reviewer skip the suite the
    // exit concludes on while every scenario that runs the branch stayed green.
    check("and that round's reviewer was told the DELIVERY tier, light having no confirmation pass to owe it", /DELIVERY tier/.test(lit.seen.reviewPrompts[0] || "") && !/ROUND tier/.test(lit.seen.reviewPrompts[0] || ""), "round-1 review prompt");
    check("and the exit still records the round's undisposed remarks beside it", (lit.res.undisposed || []).includes(REVIEWER_CAVEAT), JSON.stringify(lit.res.undisposed));
    const clean = await run(src, { fixes: [PASS_PACKET], reviews: [OK], cycle: { mode: "light" } });
    check("while a light conclusion over a clean delivery run carries no record at all", clean.res.verdict === "pass" && clean.res.recordOnly === undefined, `${clean.res.verdict}/${JSON.stringify(clean.res.recordOnly)}`);
  });

  // 30. The packet hard-check's MEASURING half. `clean` is the fixer's word
  //     about its own worktree, and the precise failure the check exists to
  //     contain survives it: a pass returning `clean: true` from a tree still
  //     mid-rebase or mid-cherry-pick, which prints EMPTY porcelain, so the
  //     self-report can be sincere and wrong with nobody but the fixer having
  //     looked. So every packet the cycle ADOPTS is measured by a turn that did
  //     not produce it, when the packet returns rather than on a later reviewer
  //     round — three of the four conclusions have no reviewer round after the
  //     pass they conclude on, the final confirmation pass first among them.
  await scenario("30. every adopted packet is measured independently of the pass that produced it", async () => {
    const dirty = await run(src, { fixes: [PASS_PACKET, fixOn("r1-1"), idle], reviews: [FAIL("r1"), OK], packets: [DIRTY_READING] });
    check("a packet claiming `clean: true` from a measured-DIRTY worktree is refused", dirty.res.verdict === "error" && /measured that worktree as not clean/.test(dirty.res.detail || ""), `${dirty.res.verdict}/${dirty.res.detail}`);
    check("and the refusal names the condition that failed and the response", /uncommitted path/.test(dirty.res.detail || "") && /redrive or resume that pass/.test(dirty.res.detail || ""), dirty.res.detail);
    check("and no reviewer round was ever spent on that worktree", dirty.seen.reviewPrompts.length === 0, `${dirty.seen.reviewPrompts.length} review prompt(s)`);

    // The criterion's hardest case, and the one a reviewer-borne reading cannot
    // reach at all: the FINAL CONFIRMATION pass, which no reviewer round
    // follows. Measured when its packet returns, before the terminal exit
    // branches on it — an `idle` confirming packet is otherwise the cycle's
    // `pass` verdict.
    const midOp = await run(src, { fixes: [PASS_PACKET, idle], reviews: [OK], packets: [CLEAN_READING, MID_OPERATION_READING] });
    check("a mid-operation worktree on the FINAL CONFIRMATION pass does not conclude the cycle", midOp.res.verdict === "error" && /CHERRY_PICK_HEAD/.test(midOp.res.detail || ""), `${midOp.res.verdict}/${midOp.res.detail}`);
    check("even though its porcelain was empty, which a status-only check calls clean", /not idle/.test(midOp.res.detail || "") && JSON.stringify((midOp.res.packetChecks || []).at(-1).dirty) === "[]", JSON.stringify(midOp.res.packetChecks));
    check("and the measurement ran on that pass, no reviewer round following it", midOp.seen.packetPrompts.length === 2 && midOp.seen.reviewPrompts.length === 1, `${midOp.seen.packetPrompts.length} measurement(s)/${midOp.seen.reviewPrompts.length} review prompt(s)`);

    // Unknown is not clean, in both shapes it arrives in.
    const unmeasured = await run(src, { fixes: [PASS_PACKET, idle], reviews: [OK], packets: [CLEAN_READING, UNMEASURED_READING] });
    check("a reading that could not be TAKEN is not treated as clean", unmeasured.res.verdict === "error" && /could not be MEASURED/.test(unmeasured.res.detail || ""), `${unmeasured.res.verdict}/${unmeasured.res.detail}`);
    check("and the result carries the unmeasured entry rather than reporting a clean finish", (unmeasured.res.packetChecks || []).at(-1).measured === false && (unmeasured.res.packetChecks || []).at(-1).pass === 2, JSON.stringify(unmeasured.res.packetChecks));

    const dead = await run(src, { fixes: [PASS_PACKET, idle], reviews: [OK], packets: [CLEAN_READING, null] });
    check("a measuring subagent that returned nothing is unmeasured too, never clean", dead.res.verdict === "error" && (dead.res.packetChecks || []).at(-1).measured === false && /returned nothing/.test((dead.res.packetChecks || []).at(-1).detail || ""), `${dead.res.verdict}/${JSON.stringify(dead.res.packetChecks)}`);

    // The refusal above sends the maintainer to this entry for what went
    // wrong, and `detail: ""` is schema-valid — so the entry that answers a
    // refusal never ships blank, and the silent measurer stays distinguishable
    // from the one that never returned.
    const blank = await run(src, { fixes: [PASS_PACKET, idle], reviews: [OK], packets: [CLEAN_READING, { ...UNMEASURED_READING, detail: "   " }] });
    check("and a measurer that returned a BLANK detail still leaves the entry saying which silence it was", blank.res.verdict === "error" && (blank.res.packetChecks || []).at(-1).detail === "the measuring subagent reported no detail", JSON.stringify(blank.res.packetChecks));

    // An EMPTY parent is not an unknown reading. A root commit and every
    // shallow clone leave HEAD with no parent to name, and that is a definitive
    // answer: the packet is measured and adopted like any other, since nothing
    // but a one-commit record suffix ever needed the boundary.
    const PARENTLESS_READING = { ...CLEAN_READING, headParentSha: "", detail: "clean and idle; HEAD has no parent in this repository" };
    const parentless = await run(src, { fixes: [PASS_PACKET, idle], reviews: [OK], packets: [PARENTLESS_READING, PARENTLESS_READING] });
    check("a HEAD with no parent is measured and adopted, never refused as unknown", parentless.res.verdict === "pass" && (parentless.res.packetChecks || []).length === 2 && (parentless.res.packetChecks || []).every((p) => p.measured === true && p.headParentSha === ""), `${parentless.res.verdict}/${JSON.stringify(parentless.res.packetChecks)}`);

    // And the direction that loses: with no parent measured, no well-shaped
    // range can equal it, so a record suffix is refused for want of the
    // boundary it claims rather than accepted on the checker's word. That costs
    // the normal reviewer round, which is the safe way to lose.
    const parentlessSuffix = await run(src, {
      fixes: [PASS_PACKET, closeOutRecordOnly("r1-1"), idle],
      reviews: [FAIL("a wording nit"), OK],
      closeOuts: [{ nonSemantic: true, editsPresent: true, recordOnlySuffix: true, recordOnlyRange: RECORD_RANGE, why: "a diagnosis-only suffix whose parent nothing could measure" }],
      packets: [CLEAN_READING, { ...PARENTLESS_READING, headSha: RECORD_TIP }],
      cycle: { closeOut: "on" },
    });
    check("but a record suffix over that parentless HEAD is refused for want of the boundary it names", parentlessSuffix.seen.reviewPrompts.length === 2 && !parentlessSuffix.res.closeOut && !parentlessSuffix.res.recordOnly, `${parentlessSuffix.seen.reviewPrompts.length} review prompt(s)/${JSON.stringify(parentlessSuffix.res)}`);

    // The too-strict direction: a measured-clean cycle behaves exactly as it
    // did, and every pass it adopted has a reading behind it.
    const clean = await run(src, { fixes: [PASS_PACKET, fixOn("r1-1"), idle], reviews: [FAIL("r1"), OK] });
    check("a measured-clean cycle concludes exactly as before", clean.res.verdict === "pass" && clean.seen.reviewPrompts.length === 2, `${clean.res.verdict}/${clean.seen.reviewPrompts.length} review prompt(s)`);
    check("with one reading per adopted pass, the final confirmation pass included", clean.seen.packetPrompts.length === 3 && JSON.stringify((clean.res.packetChecks || []).map((p) => p.pass)) === "[1,2,3]" && (clean.res.packetChecks || []).every((p) => p.measured === true), JSON.stringify(clean.res.packetChecks));

    // Independence is the property, not merely a second turn: a measurer shown
    // the pass's own account has been handed the answer it exists to derive.
    const SENTINEL = "the fixer's own account of what this pass did";
    const opaque = await run(src, { fixes: [{ ...PASS_PACKET, summary: SENTINEL }, idle], reviews: [OK] });
    const measurePrompt = opaque.seen.packetPrompts[0] || "";
    check("the measuring turn is given no account of the pass whose worktree it judges", !measurePrompt.includes(SENTINEL), "measurement prompt");
    check("and is asked for the state plus HEAD and its parent, the operation state being the one porcelain hides", /--porcelain/.test(measurePrompt) && /CHERRY_PICK_HEAD/.test(measurePrompt) && /prints EMPTY porcelain/.test(measurePrompt) && /git show -s --format=%P HEAD/.test(measurePrompt) && /actual parent/i.test(measurePrompt), "measurement prompt");

    // Where the parent comes from is not a spelling preference. `git rev-parse
    // HEAD^` exits non-zero wherever HEAD has no parent to name — a root
    // commit, and every shallow clone, whose boundary commit git grafts
    // parentless — so a brief asking for it turns an ordinary depth-1 checkout
    // into `measured: false`, and the refusal above then rejects EVERY packet
    // whether or not any close-out suffix needed a boundary. HEAD's own commit
    // header answers without the parent object, and an absent parent is a
    // definitive EMPTY rather than a reading nobody could take.
    check("with the parent taken from HEAD's own header rather than by resolving `HEAD^`, which a root commit and every shallow clone make fail", /rather than from `git rev-parse HEAD\^`/.test(measurePrompt) && /EXITS NON-ZERO/.test(measurePrompt) && /shallow clone/.test(measurePrompt), "measurement prompt");
    check("and an absent parent read as a DEFINITIVE empty, so a depth-1 checkout does not refuse every packet", /DEFINITIVE answer, not a failed reading/.test(measurePrompt) && /keep `measured: true`/.test(measurePrompt), "measurement prompt");
    check("and told to observe only — never to repair the tree it is measuring", /OBSERVE ONLY/.test(measurePrompt) && /do NOT stage, commit, reset, clean, stash, abort/.test(measurePrompt), "measurement prompt");

    // The brief must not FORBID the reading it is sent to take. Every other
    // role's worktree contract asserts the branch, and the two operations that
    // detach HEAD — a rebase, a bisect — are among the states this step exists
    // to find: `git branch --show-current` prints EMPTY there, which "differs"
    // from the branch name, so a branch-asserting contract orders the measurer
    // to STOP before either reading and the flagship case comes back
    // `measured: false` instead of naming the marker that failed.
    check("the measuring turn's brief carries no branch assertion, which a detached HEAD would fail", !/You must be on branch/.test(measurePrompt) && !/if it differs, STOP/.test(measurePrompt), "measurement prompt");
    check("and says outright that a DETACHED HEAD is one of the states it was sent to read", /DETACHED/.test(measurePrompt) && /not a mismatch to stop on/.test(measurePrompt), "measurement prompt");
    check("while the roles that must stay on the branch are still told to", /You must be on branch/.test(opaque.seen.reviewPrompts[0] || "") && /You must be on branch/.test(opaque.seen.fixPrompts[0] || ""), "review/fix prompts");

    // The free structural refusal still runs first, so a pass that says its own
    // worktree is unclean costs no measuring turn.
    const selfUnclean = await run(src, { fixes: [{ ...PASS_PACKET, clean: false }], reviews: [] });
    check("a pass that self-reports unclean is refused for free, before any measuring turn", selfUnclean.res.verdict === "error" && selfUnclean.seen.packetPrompts.length === 0 && selfUnclean.res.packetChecks === undefined, `${selfUnclean.res.verdict}/${selfUnclean.seen.packetPrompts.length} measurement(s)`);

    // The log rides every exit, the stopped ones included — `packetChecks` is
    // the only place a consumer can see that no adopted packet went unmeasured.
    const capped = await run(src, { fixes: [PASS_PACKET, PASS_PACKET], reviews: [FAIL("r1"), FAIL("r2")], cycle: { maxRounds: 2 } });
    check("`packetChecks` rides a stopped exit too, one entry per adopted pass", capped.res.verdict === "review-cap" && (capped.res.packetChecks || []).length === 2, `${capped.res.verdict}/${JSON.stringify(capped.res.packetChecks)}`);

    // And the other two conclusions no reviewer round follows.
    const closed = await run(src, { fixes: [PASS_PACKET, closeOutFix("r1-1")], reviews: [FAIL("a wording nit")], cycle: { closeOut: "on" } });
    check("the trivial-round close-out's concluding pass is measured before that exit branches on it", !!closed.res.closeOut && (closed.res.packetChecks || []).length === 2 && (closed.res.packetChecks || []).at(-1).pass === 2, JSON.stringify(closed.res.packetChecks));
    const recorded = await run(src, { fixes: [PASS_PACKET, confirmRecordOnly], reviews: [OK], cycle: { maxRounds: 3 } });
    check("and so is the record-only close's", !!recorded.res.recordOnly && (recorded.res.packetChecks || []).length === 2, JSON.stringify(recorded.res.packetChecks));
    const lit = await run(src, { fixes: [PASS_PACKET], reviews: [OK], cycle: { mode: "light" } });
    check("and the light conclusion's single pass, whose reviewer round it already had", lit.res.verdict === "pass" && (lit.res.packetChecks || []).length === 1, JSON.stringify(lit.res.packetChecks));
  });

  // 31. WHOSE VERDICT the map leaving the cycle carries. `workReport` is the
  //     one field a consumer REPLAYS (wf-address-review posts thread replies
  //     and resolves from it, and withholds its durable disposition record from
  //     a map no reviewer ever judged), so "was this map reviewed" is a
  //     contract rather than an internal detail — and it is not the verdict.
  //     `confirming` is set only after a round PASSED, and the confirmation
  //     pass that follows can stop the cycle outright, which leaves an `error`
  //     verdict standing over exactly the map that just passed. A consumer
  //     reading the verdict alone calls that map unreviewed and drops it.
  await scenario("31. whether a reviewer judged the map the cycle carries out", async () => {
    const REPORTED = [{ threadId: "T1", kind: "actionable-fixed", detail: "guarded the null case" }];
    const REPLACED = [{ threadId: "T1", kind: "push-back", detail: "re-triaged after the round had passed" }];
    const withMap = { ...PASS_PACKET, workReport: REPORTED };
    const withReplacedMap = { ...PASS_PACKET, workReport: REPLACED };

    // Nothing ever finished: pass 1 returned nothing, so no map and no round.
    const never = await run(src, { fixes: [], reviews: [] });
    check(
      "a cycle stopped before any round says no reviewer judged the map it carries",
      never.res.verdict === "error" && never.res.workReportReviewed === false,
      `${never.res.verdict}/${never.res.workReportReviewed}`,
    );

    // The flagship: round 1 passed over this map, then the CONFIRMATION pass
    // returned nothing. The cycle errors holding the map a reviewer passed.
    const confirmDied = await run(src, { fixes: [withMap], reviews: [OK] });
    check(
      "a confirmation pass that stops the cycle still carries the map a round PASSED, and says so",
      confirmDied.res.verdict === "error" &&
        JSON.stringify(confirmDied.res.workReport) === JSON.stringify(REPORTED) &&
        confirmDied.res.workReportReviewed === true,
      `${confirmDied.res.verdict}/${confirmDied.res.workReportReviewed}/${JSON.stringify(confirmDied.res.workReport)}`,
    );

    // And the precision the flag would lose if it latched: the confirmation
    // pass REPLACED the map, then round 2's reviewer returned nothing. What
    // leaves the cycle is a map no round ever saw, whatever passed before it.
    const replacedThenDied = await run(src, { fixes: [withMap, withReplacedMap], reviews: [OK, null], cycle: { maxRounds: 3 } });
    check(
      "and a map a later pass REPLACED is not reviewed, whatever passed before it",
      replacedThenDied.res.verdict === "error" &&
        JSON.stringify(replacedThenDied.res.workReport) === JSON.stringify(REPLACED) &&
        replacedThenDied.res.workReportReviewed === false,
      `${replacedThenDied.res.verdict}/${replacedThenDied.res.workReportReviewed}/${JSON.stringify(replacedThenDied.res.workReport)}`,
    );

    // A round that RAN AND FAILED, which is the only shape that separates "a
    // round happened" from "a round PASSED": pass 1 reports the map, round 1
    // fails, pass 2 returns nothing. Snapshot on every round rather than only a
    // passing one and this reads as reviewed — and wf-address-review then heads a
    // durable record "AFTER a reviewer round had passed" over the map the
    // exemption exists to withhold, the one map only a failed round ever saw.
    const failedThenDied = await run(src, { fixes: [withMap], reviews: [FAIL("r1")], cycle: { maxRounds: 3 } });
    check(
      "a round that RAN AND FAILED judged nothing, so the map it read is not reviewed",
      failedThenDied.res.verdict === "error" &&
        JSON.stringify(failedThenDied.res.workReport) === JSON.stringify(REPORTED) &&
        failedThenDied.res.workReportReviewed === false &&
        failedThenDied.res.reviewedWorkReport === undefined,
      `${failedThenDied.res.verdict}/${failedThenDied.res.workReportReviewed}/${JSON.stringify(failedThenDied.res.reviewedWorkReport)}`,
    );

    // The same map over a DIFFERENT tree. A later pass can commit a new
    // `finalSha` while returning the identical `workReport` text and then lose
    // its reviewer: compared as text alone those dispositions read as reviewed
    // while they now accompany a tree no reviewer ever read, which is the same
    // false positive a replacement produces and the same consumer acts on it.
    const sameMapNewTip = { ...withMap, finalSha: "b2b2b2b2" };
    const movedThenDied = await run(src, { fixes: [withMap, sameMapNewTip], reviews: [OK, null], cycle: { maxRounds: 3 } });
    check(
      "and a map carried out over a tip no round judged is unreviewed too, its text unchanged though it is",
      movedThenDied.res.verdict === "error" &&
        JSON.stringify(movedThenDied.res.workReport) === JSON.stringify(REPORTED) &&
        movedThenDied.res.finalSha === "b2b2b2b2" &&
        movedThenDied.res.workReportReviewed === false &&
        movedThenDied.res.reviewedFinalSha === "sha",
      `${movedThenDied.res.verdict}/${movedThenDied.res.workReportReviewed}/${movedThenDied.res.finalSha} vs ${movedThenDied.res.reviewedFinalSha}`,
    );

    // And the judged map ITSELF, beside the tip it was judged on, reported
    // separately from the map being carried out. That is what makes a judged map
    // a later pass replaced recordable at all: the boolean says only that the map
    // leaving is not the judged one, so a consumer whose job is to record the
    // judged one (wf-address-review's disposition record) had nothing to record
    // and the map with the drafted replies died with the session that judged it.
    check(
      "the judged map and its tip ride out beside the map being carried, so a replaced one is not lost",
      JSON.stringify(replacedThenDied.res.reviewedWorkReport) === JSON.stringify(REPORTED) &&
        replacedThenDied.res.reviewedFinalSha === "sha" &&
        JSON.stringify(confirmDied.res.reviewedWorkReport) === JSON.stringify(REPORTED) &&
        never.res.reviewedWorkReport === undefined &&
        never.res.reviewedFinalSha === undefined,
      `${JSON.stringify(replacedThenDied.res.reviewedWorkReport)}/${replacedThenDied.res.reviewedFinalSha}/${JSON.stringify(never.res.reviewedWorkReport)}`,
    );
  });

  // 28. A batch's first wave enters several cycles concurrently. A boolean
  //     records a completed preflight but cannot serialize one in progress:
  //     every sibling can snapshot false before the first peer reports back.
  //     Drive the shipped stage directly so the owner/waiter handoff, including
  //     its reset after a synthesized throw, is observed under real Promise
  //     concurrency rather than inferred from the state object's shape.
  await scenario("28. shared peer preflight is exactly-once under first-wave concurrency and resets after synthesis", async () => {
    let releaseOwner;
    let ownerEnteredResolve;
    const ownerEntered = new Promise((resolve) => { ownerEnteredResolve = resolve; });
    const peerPrompts = [];
    let preflightCalls = 0;
    const agent = async (prompt, opts) => {
      if (opts && opts.label === "peer-preflight") {
        preflightCalls += 1;
        ownerEnteredResolve();
        await new Promise((resolve) => { releaseOwner = resolve; });
        return { outcome: "available", detail: "" };
      }
      peerPrompts.push(prompt);
      return { outcome: "passed", findings: [], notes: "- src/example.js:7 — Naming could be clearer.", detail: "" };
    };
    const { cyclePeerPrompt, runCyclePeerStage, createCyclePeerThrottle, cyclePeerTrouble } = loadCycle(src, agent);
    check(
      "the helper's exact empty and malformed reasons are eligible forfeiture trouble",
      cyclePeerTrouble({ outcome: "forfeited", reason: "provider exited 0 with an empty final message" }) &&
        cyclePeerTrouble({ outcome: "forfeited", reason: "provider exited 0 but produced a malformed/unparseable response" }),
      "documented helper reason mapping",
    );
    check(
      "the retained raw path's exact empty and garbled reasons remain eligible",
      cyclePeerTrouble({ outcome: "forfeited", reason: "empty output" }) &&
        cyclePeerTrouble({ outcome: "forfeited", reason: "garbled output" }),
      "documented raw reason mapping",
    );
    check(
      "the helper's no-verdict forfeiture is intentionally excluded from throttle trouble",
      !cyclePeerTrouble({ outcome: "forfeited", reason: "provider exited 0 but emitted no recognizable VERDICT token" }),
      "no-verdict helper reason",
    );
    check(
      "near-match and decorated empty/garbled reasons do not trigger the exact mapping",
      [
        "provider exited 0 with an empty final messages",
        "provider exited 0 but produced a malformed response",
        "prefix: provider exited 0 with an empty final message",
        "garbled output from an unrelated parser",
        "EMPTY OUTPUT",
      ].every((reason) => !cyclePeerTrouble({ outcome: "forfeited", reason })),
      "negative exact-match cases",
    );
    const peerState = { preflighted: false, preflightInProgress: null, unavailable: false, unavailableDetail: "" };
    const peerThrottle = createCyclePeerThrottle();
    const cycle = { ...CYCLE, peer: "on", contracts: {}, labelPrefix: "batch:" };
    const state = (round) => ({
      round,
      artifactDir: "/tmp/review-cycle-preflight-test",
      packet: { workReport: [] },
      handedFindings: [],
      peerState,
      peerThrottle,
    });
    const renderedPeer = cyclePeerPrompt(cycle, state(1));
    check(
      "the peer prompt preserves the first-line verdict and keeps advisory notes compact and optional",
      /exactly `VERDICT: PASS` or `VERDICT: ISSUES` on the first line/.test(renderedPeer) &&
        /NOTES \(advisory; not necessarily fixes\)/.test(renderedPeer) &&
        /at most three one-line bullets/.test(renderedPeer) &&
        /at most 15 words/.test(renderedPeer) &&
        /Omit the section entirely/.test(renderedPeer),
      "rendered peer convention",
    );
    check(
      "the prompt keeps every fix-worthy minor under ISSUES rather than pass notes",
      /Anything you believe ought to be fixed remains a finding under `VERDICT: ISSUES`, even when minor; never demote it to a pass-note/.test(renderedPeer),
      "pass-note bar",
    );
    check(
      "the consumer extracts notes from raw output now and only documented helper payloads later",
      /copy into `notes` ONLY valid bullets/.test(renderedPeer) &&
        /documented `reviewFile`\/`reviewText` payload only/.test(renderedPeer) &&
        /never enumerate `artifactDir`, guess a filename/.test(renderedPeer),
      "raw/future payload split",
    );
    const calls = Array.from({ length: 6 }, (_, i) => runCyclePeerStage(cycle, state(i + 1)));
    await ownerEntered;
    await Promise.resolve();
    check("only one preflight agent runs and no peer launch enters before it settles", preflightCalls === 1 && peerPrompts.length === 0, `${preflightCalls} preflight/${peerPrompts.length} peer call(s)`);
    releaseOwner();
    const results = await Promise.all(calls);
    check("every concurrent peer stage completes after the owner releases", results.length === 6 && results.every((r) => r.outcome === "passed"), JSON.stringify(results.map((r) => r.outcome)));
    check("a passing peer's bounded note survives structurally while clean notes may stay empty", results.every((r) => r.notes === "- src/example.js:7 — Naming could be clearer."), JSON.stringify(results.map((r) => r.notes)));
    check("the parallel first wave executes exactly one real preflight", preflightCalls === 1, `${preflightCalls} preflight call(s)`);
    check("all six peer launches fan out after it and skip duplicate probes", peerPrompts.length === 6 && peerPrompts.every((p) => /Preflight: already done by the run-level shared preflight/.test(p)), `${peerPrompts.length} peer prompt(s)`);
    check("the shared state records completion and leaves no in-progress latch", peerState.preflighted === true && peerState.preflightInProgress === null, JSON.stringify(peerState));

    const summarizedPass = async (notes) => {
      const fixPrompts = [];
      const summaryAgent = async (prompt, opts) => {
        const label = (opts && opts.label) || "";
        if (label === "fix#1") {
          fixPrompts.push(prompt);
          return { ...PASS_PACKET, changed: true, dispositions: [] };
        }
        if (label === "fix#2") {
          fixPrompts.push(prompt);
          return { ...idle };
        }
        if (label.startsWith("packet#")) return { measured: true, dirty: [], operation: "", detail: "" };
        if (label === "review#1") return { ...OK };
        if (label === "peer-preflight") return { outcome: "available", detail: "" };
        if (label === "peer#1") return { outcome: "passed", findings: [], notes, detail: "" };
        return null;
      };
      const loaded = loadCycle(src, summaryAgent);
      return { result: await loaded.runReviewCycle({ ...CYCLE, peer: "on" }), fixPrompts };
    };
    const noteMarker = "- src/example.js:7 — Naming could be clearer.";
    const notedPass = await summarizedPass(noteMarker);
    check(
      "a passing peer note is surfaced compactly but never reaches a fixer or opens another reviewer round",
      notedPass.result.verdict === "pass" && notedPass.result.rounds === 1 && notedPass.fixPrompts.length === 2 && notedPass.fixPrompts.every((p) => !p.includes(noteMarker)) && notedPass.result.peerRounds.length === 1 && notedPass.result.peerRounds[0].detail === `advisory notes:\n${noteMarker}`,
      `${JSON.stringify(notedPass.result.peerRounds)} / ${notedPass.result.rounds} round(s) / ${notedPass.fixPrompts.filter((p) => p.includes(noteMarker)).length} fixer leak(s)`,
    );
    const cleanPass = await summarizedPass("");
    check(
      "a clean peer pass keeps the round detail empty and the usual one-line outcome",
      cleanPass.result.verdict === "pass" && cleanPass.result.rounds === 1 && cleanPass.result.peerRounds.length === 1 && cleanPass.result.peerRounds[0].outcome === "passed" && cleanPass.result.peerRounds[0].detail === "",
      JSON.stringify(cleanPass.result.peerRounds),
    );

    const untrustedNotes = [
      "- src/one.js:1 — First valid advisory note.",
      "- src/bad.js:2 - Wrong separator is discarded.",
      "- src/long.js:3 — one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen",
      "- src/two.js:4 — Second valid advisory note.",
      "- src/no-line.js — Missing line anchor is discarded.",
      "- src/three.js:6 — Third valid advisory note.",
      "- src/four.js:7 — Fourth valid note is surplus.",
    ].join("\n");
    const boundedPass = await summarizedPass(untrustedNotes);
    const boundedNotes = [
      "- src/one.js:1 — First valid advisory note.",
      "- src/two.js:4 — Second valid advisory note.",
      "- src/three.js:6 — Third valid advisory note.",
    ].join("\n");
    const boundedDetail = boundedPass.result.peerRounds[0].detail;
    const summaryMatch = String(boundedDetail || "").match(/(?:^|\n)advisory notes:\n([\s\S]*)$/);
    const humanSummary = String((summaryMatch && summaryMatch[1]) || "").split("\n").filter(Boolean);
    check(
      "consumer normalization discards malformed and over-budget notes, then caps the valid human summary at three",
      boundedPass.result.verdict === "pass" && boundedPass.result.rounds === 1 && boundedDetail === `advisory notes:\n${boundedNotes}` && JSON.stringify(humanSummary) === JSON.stringify(boundedNotes.split("\n")) && boundedPass.fixPrompts.every((p) => !p.includes("First valid advisory note") && !p.includes("Wrong separator") && !p.includes("sixteen") && !p.includes("Fourth valid note")),
      `${JSON.stringify(boundedPass.result.peerRounds)} / ${JSON.stringify(humanSummary)} / ${boundedPass.result.rounds} round(s)`,
    );
    const malformedOnly = await summarizedPass("NOTES (advisory; not necessarily fixes)\n- src/no-line.js — Missing line.\n- src/long.js:3 — one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen");
    check(
      "consumer normalization returns empty notes when no exact bounded bullet survives",
      malformedOnly.result.verdict === "pass" && malformedOnly.result.rounds === 1 && malformedOnly.result.peerRounds[0].detail === "" && malformedOnly.fixPrompts.every((p) => !p.includes("Missing line") && !p.includes("sixteen")),
      JSON.stringify(malformedOnly.result.peerRounds),
    );

    const issuesNoteMarker = "- src/example.js:8 — Advisory-only marker.";
    const issuesFixPrompts = [];
    const issuesAgent = async (prompt, opts) => {
      const label = (opts && opts.label) || "";
      if (label.startsWith("fix#")) issuesFixPrompts.push(prompt);
      if (label === "fix#1") return { ...PASS_PACKET, changed: true, dispositions: [] };
      if (label === "fix#2") return { ...PASS_PACKET, changed: false, dispositions: [{ findingId: "p1-1", finding: "fix the defect", origin: "peer", disposition: "declined", detail: "reviewed and declined" }] };
      if (label === "fix#3") return { ...idle };
      if (label.startsWith("packet#")) return { measured: true, dirty: [], operation: "", detail: "" };
      if (label.startsWith("review#")) return { ...OK };
      if (label === "peer-preflight") return { outcome: "available", detail: "" };
      if (label === "peer#1") return { outcome: "issues", findings: [{ claim: "fix the defect" }], notes: issuesNoteMarker, detail: "" };
      if (label === "peer#2") return { outcome: "passed", findings: [], notes: "", detail: "" };
      if (label === "ground#1") return { verdicts: [] };
      return null;
    };
    const issuesLoaded = loadCycle(src, issuesAgent);
    const issuesResult = await issuesLoaded.runReviewCycle({ ...CYCLE, peer: "on" });
    check(
      "advisory notes beside an issues verdict stay in peerRounds and out of every later fixer input",
      issuesResult.verdict === "pass" && issuesResult.rounds === 2 && issuesResult.peerRounds[0].detail === `advisory notes:\n${issuesNoteMarker}` && issuesFixPrompts.length === 3 && issuesFixPrompts.every((p) => !p.includes(issuesNoteMarker)),
      `${JSON.stringify(issuesResult.peerRounds)} / ${issuesResult.rounds} round(s) / ${issuesFixPrompts.filter((p) => p.includes(issuesNoteMarker)).length} fixer leak(s)`,
    );

    let preflightAttempts = 0;
    let peerAttempts = 0;
    const resetAgent = async (_prompt, opts) => {
      if (opts && opts.label === "peer-preflight") {
        preflightAttempts += 1;
        if (preflightAttempts === 1) throw new Error("synthetic preflight throw");
        return { outcome: "available", detail: "" };
      }
      peerAttempts += 1;
      return { outcome: "passed", findings: [], notes: "", detail: "" };
    };
    const resetLoaded = loadCycle(src, resetAgent);
    const resetState = { preflighted: false, preflightInProgress: null, unavailable: false, unavailableDetail: "" };
    const resetThrottle = resetLoaded.createCyclePeerThrottle();
    const resetStage = (round) => resetLoaded.runCyclePeerStage(cycle, {
      ...state(round),
      peerState: resetState,
      peerThrottle: resetThrottle,
    });
    const resetResults = await Promise.all([resetStage(1), resetStage(2)]);
    check("a thrown owner releases the waiter instead of deadlocking it", resetResults.length === 2 && preflightAttempts === 2, `${preflightAttempts} preflight attempt(s)`);
    check("the thrown stage stays a synthesized non-blocking forfeit while the waiter succeeds", resetResults.some((r) => r.outcome === "forfeited" && r.synthesized) && resetResults.some((r) => r.outcome === "passed"), JSON.stringify(resetResults));
    check("synthesis resets ownership, so the successor preflights again and only it launches a peer", preflightAttempts === 2 && peerAttempts === 1 && resetState.preflighted === true && resetState.preflightInProgress === null, `${preflightAttempts} preflight/${peerAttempts} peer/${JSON.stringify(resetState)}`);
  });

  // 29. The peer stage's ONE non-blocking exception. Every OUTCOME normalizes
  //     non-blocking by design, so a provider the stage could not prove dead
  //     has nowhere to go in that vocabulary: `failed` reads exactly like a
  //     provider that crashed and died. The prompt's surviving-provider stop is
  //     therefore an instruction the contract can only honour through a field
  //     beside the outcome — without one the cycle keeps fixing, concludes, and
  //     hands a consumer a state to publish while the process is still alive.
  //     The negative control is the point of the pair: the SAME `failed`
  //     outcome without the flag must conclude normally, or the check would
  //     pass just as happily against a stage that blocked on `failed` itself.
  await scenario("29. a provider that could not be proven dead stops the cycle, and only the flag stops it", async () => {
    const drive = async (peerResult) => {
      const seen = { fixPrompts: [], reviewPrompts: [], closeOutPrompts: [], recordPrompts: [], packetPrompts: [] };
      const base = scriptedAgent([JSON.parse(JSON.stringify(PASS_PACKET)), JSON.parse(JSON.stringify(idle))], [OK, OK], seen);
      const agent = async (prompt, opts) => {
        const label = (opts && opts.label) || "";
        if (label === "peer-preflight") return { outcome: "available", detail: "" };
        if (label.startsWith("peer#")) return JSON.parse(JSON.stringify(peerResult));
        return base(prompt, opts);
      };
      const { runReviewCycle } = loadCycle(src, agent);
      return runReviewCycle({ ...CYCLE, peer: "on" });
    };
    const survivor = { outcome: "failed", findings: [], notes: "", detail: "PID 4711 still answered kill -0 after KILL", reason: "", teardownFailure: true };
    const stopped = await drive(survivor);
    check(
      "a teardown failure ends the cycle as an error instead of a non-blocking round",
      stopped.verdict === "error" && /teardown/i.test(stopped.detail || "") && /4711/.test(stopped.detail || ""),
      `${stopped.verdict}/${stopped.detail}`,
    );
    check(
      "and the stopping round is still recorded with its outcome and the flag",
      (stopped.peerRounds || []).length === 1 && stopped.peerRounds[0].outcome === "failed" && stopped.peerRounds[0].teardownFailure === true,
      JSON.stringify(stopped.peerRounds),
    );
    const cleared = await drive({ ...survivor, teardownFailure: false });
    check(
      "while the same `failed` outcome without the flag stays non-blocking and the cycle concludes",
      cleared.verdict === "pass" && (cleared.peerRounds || []).every((p) => p.outcome === "failed" && p.teardownFailure === undefined),
      `${cleared.verdict}/${JSON.stringify(cleared.peerRounds)}`,
    );

    const { normalizeCyclePeerResult, CYCLE_PEER_SCHEMA, runCyclePeerStage, createCyclePeerThrottle } = loadCycle(src, async () => {
      throw new Error("synthetic peer stage throw");
    });
    check(
      "the two fields control flow reads are required rather than optional in the peer schema",
      (CYCLE_PEER_SCHEMA.required || []).includes("reason") && (CYCLE_PEER_SCHEMA.required || []).includes("teardownFailure"),
      JSON.stringify(CYCLE_PEER_SCHEMA.required),
    );
    check(
      "normalization carries the flag through while still recording the outcome non-blocking",
      normalizeCyclePeerResult(survivor).teardownFailure === true && normalizeCyclePeerResult(survivor).outcome === "failed",
      JSON.stringify(normalizeCyclePeerResult(survivor)),
    );
    // Notes exist only below a verdict, so one arriving beside a non-verdict
    // outcome — including an unrecognized outcome, which lands on `forfeited`
    // carrying whatever came with it — is a misparse, not advice.
    const strayNote = "- src/stray.js:9 — Bullet beside no verdict at all.";
    const verdictNotes = normalizeCyclePeerResult({ outcome: "passed", findings: [], notes: strayNote, reason: "", teardownFailure: false });
    const strayNotes = ["unavailable", "timeout", "failed", "forfeited", "not-a-real-outcome"].map((outcome) =>
      normalizeCyclePeerResult({ outcome, findings: [], notes: strayNote, reason: "", teardownFailure: false }),
    );
    check(
      "notes survive a verdict but are dropped for every outcome that reached none",
      verdictNotes.notes === strayNote && strayNotes.every((r) => r.notes === ""),
      `${JSON.stringify(verdictNotes.notes)} / ${JSON.stringify(strayNotes.map((r) => [r.outcome, r.notes]))}`,
    );
    // A stage that died observed no survivor, so it may not manufacture the
    // stop: the flag has to come from a stage that watched the process.
    const thrown = await runCyclePeerStage(
      { ...CYCLE, peer: "on", contracts: {} },
      {
        round: 1,
        artifactDir: "/tmp/review-cycle-teardown-test",
        packet: { workReport: [] },
        handedFindings: [],
        peerState: { preflighted: true, preflightInProgress: null, unavailable: false, unavailableDetail: "" },
        peerThrottle: createCyclePeerThrottle(),
      },
    );
    check(
      "but a thrown stage synthesizes no teardown failure of its own",
      thrown.outcome === "forfeited" && thrown.synthesized === true && !thrown.teardownFailure,
      JSON.stringify(thrown),
    );
  });

  const ran = legOk + legFail;
  check(`suite ran all ${CHECKS_PER_LEG} checks`, ran === CHECKS_PER_LEG, `ran ${ran}`);
  legOk = 0;
  legFail = 0;
}

// The invoker's GRANT of the trivial-round close-out, which decides whether
// the gate above is reachable at all. It is parsed from the prose invocation —
// the ONE string that also carries the target — so a bare-word match would let
// a branch NAME grant a bounded discretion nobody asked for. Parsed outside
// the embeddable section, and only here (a batch's `taskCycleConfig` grants no
// close-out), so it runs once rather than per workflow leg.
const GRANT_CHECKS = 13;
{
  console.log("# wf-review-cycle.js — invoker grants");
  const before = legOk + legFail;
  const src = readFileSync(join(here, "..", "plugins", "dev-skills", "workflows", "wf-review-cycle.js"), "utf8");
  const cut = src.indexOf('phase("Scope");');
  if (cut < 0) throw new Error("wf-review-cycle.js: the scope phase call this cuts at is gone");
  const prefix = src.slice(0, cut).replace(/^export const meta/m, "const meta");
  const flags = (input) =>
    // eslint-disable-next-line no-new-func
    new Function("args", "phase", "log", `"use strict";\n${prefix}\nreturn { lightMode, closeOutMode, artifactTypeToken };`)(input, () => {}, () => {});

  check("a bare `close-out` token grants the close-out", flags("close-out; review branch task/035-x").closeOutMode === true);
  check("a TARGET whose name merely contains the words grants nothing", flags("review the branch feature/close-out-ui").closeOutMode === false);
  check("nor does a target that mentions the bare token inside a path", flags("review plugins/close-out/SKILL.md").closeOutMode === false);
  // The token rule's COST, pinned because it is a behavior change from the `\b`
  // regex it replaced and every part of it fails closed. The `closeout` case is
  // there because the documented spelling is the HYPHENATED bare token and
  // nothing — not the scope prompt's recognized-tokens line, not either SKILL
  // mirror's Arguments line, not the task — ever named the other one; an alias
  // no enumeration mentions grants a discretion nobody asked for. The last case
  // is why the change is a fix rather than a trade: the old boundary read the
  // grant out of an explicit REFUSAL.
  check("the spaced `close out` no longer grants it", flags("close out, review branch task/035-x").closeOutMode === false);
  check("nor does the unhyphenated `closeout` spelling", flags("review branch task/035-x, closeout").closeOutMode === false);
  check("nor does the assigned `close-out=on` spelling", flags("close-out=on, review branch task/035-x").closeOutMode === false);
  check("and `close-out=off` no longer grants it either, as the old boundary regex did", flags("close-out=off, review branch task/035-x").closeOutMode === false);
  check("a bare `light` token still selects light mode", flags("light, review branch task/035-x").lightMode === true);
  check("a branch named for it does not", flags("review the branch chore/light-theme").lightMode === false);
  check("the bare artifact-type spelling still lands as its own word", flags("review this decision").artifactTypeToken === "decision");
  check("but not from inside a branch name", flags("review the branch feature/decision-log").artifactTypeToken === null, JSON.stringify(flags("review the branch feature/decision-log")));
  // Structured mode trusts only the structured field, like the sibling flags:
  // `scope.items` carries verbatim third-party content (PR review-thread
  // bodies), where a merely QUOTED token must not grant anything.
  check("a structured invocation grants it through its own field", flags({ branch: "b", base: "main", closeOut: "on" }).closeOutMode === true);
  check("and a token quoted inside structured scope items grants nothing", flags({ branch: "b", base: "main", scope: { items: ["the reviewer wrote: close-out"] } }).closeOutMode === false);

  const granted = legOk + legFail - before;
  check(`grant checks ran all ${GRANT_CHECKS}`, granted === GRANT_CHECKS, `ran ${granted}`);
}

// The batch leg's per-role contracts, which the cycle's own default never
// reaches: a consumer with a worktree lifecycle supplies its own text for every
// role, so the section's `measurer` default — exercised on both legs above — is
// not what a batch's measuring turn actually reads. Checked here, once, outside
// the embeddable section, because that is where `worktreeContract` lives.
const BATCH_CONTRACT_CHECKS = 5;
{
  console.log("# wf-address-tasks.js — the batch's per-role contracts");
  const before = legOk + legFail;
  const src = readFileSync(join(here, "..", "plugins", "dev-skills", "workflows", "wf-address-tasks.js"), "utf8");
  const cut = src.indexOf("\nconst peerMode = /");
  if (cut < 0) throw new Error("wf-address-tasks.js: the cut marker this evaluates up to is gone");
  const prefix = src.slice(0, cut).replace(/^export const meta/m, "const meta");
  // eslint-disable-next-line no-new-func
  const { taskCycleConfig } = new Function("args", `"use strict";\n${prefix}\nreturn { taskCycleConfig };`)("");
  const cfg = taskCycleConfig({ slug: "t025a", branch: "task/025a-measure", base: "main", path: "tasks/025a-measure.md", content: "c" }, true, "off");
  const measurer = (cfg.contracts || {}).measurer || "";

  check("the batch hands the cycle a measurer contract of its own", measurer.length > 0, JSON.stringify(Object.keys(cfg.contracts || {})));
  // The same property the section's default carries, and the reason this leg
  // needs its own check: every other role on this leg is told to assert the
  // branch, and a rebase's or a bisect's detached HEAD — the flagship state
  // this step exists to find — fails that assertion.
  check("which asserts no branch, so a rebase's or a bisect's detached HEAD does not stop the reading", !/branch --show-current/.test(measurer) && !/STOP/.test(measurer) && /DETACHED/.test(measurer), "measurer contract");
  // The measuring stage must not RECONSTRUCT the state it observes. Every
  // worktree resolver here is rerun-safe — `wt-enter` attaches the branch in a
  // fresh checkout when the worktree is gone — so a resolving measurer would
  // read a checkout built moments ago and call the packet clean. It reads
  // git's registration instead, which names the path in every state the tree
  // can be in, and a `git -C <path>` reading is taken from there.
  check("and FINDS the already-registered worktree rather than resolving one, so no reading comes from a checkout built just now", /git worktree list --porcelain/.test(measurer) && !measurer.includes("$(wt-enter") && /git -C/.test(measurer), "measurer contract");
  check("with a worktree that is gone reported as unknown rather than rebuilt", /report it as unknown/.test(measurer) && /Never build it, attach it, or prune it/.test(measurer), "measurer contract");
  check("while the roles that must stay on the branch are still told to", /branch --show-current/.test(cfg.contracts.fixer) && /branch --show-current/.test(cfg.contracts.reviewer) && /branch --show-current/.test(cfg.contracts.peer), "role contracts");

  const n = legOk + legFail - before;
  check(`batch contract checks ran all ${BATCH_CONTRACT_CHECKS}`, n === BATCH_CONTRACT_CHECKS, `ran ${n}`);
}

// The Claude-provider rendering is prose rather than executable workflow code,
// so exercise the exact direct-PID helpers it ships by extracting their code.
// A fake proc root lets the test replace field 22 while keeping the PID
// constant — the reuse failure this guard exists for — without ever probing or
// signalling a real process. The fake `kill` records every operand and can
// model TERM resistance, KILL death, or a teardown survivor.
const PEER_LIFECYCLE_CHECKS = 21;
{
  console.log("# codex review-cycle prose — peer lifecycle negative controls");
  const before = legOk + legFail;
  const prose = readFileSync(join(here, "..", "codex", "dev-skills", "skills", "review-cycle", "SKILL.md"), "utf8");
  const blockStart = prose.indexOf("peer_start_time() {");
  const blockEnd = prose.indexOf("\nnohup claude", blockStart);
  const helperBlock = blockStart >= 0 && blockEnd > blockStart ? prose.slice(blockStart, blockEnd) : "";
  check("the canonical direct-provider identity block is extractable", helperBlock.length > 0, `${blockStart}/${blockEnd}`);

  const scratch = mkdtempSync(join(tmpdir(), "peer-incarnation-test-"));
  try {
    const procRoot = join(scratch, "proc");
    const pidDir = join(procRoot, "731");
    const identityFile = join(scratch, "peer.pid");
    const signalLog = join(scratch, "signals.log");
    // mkdir is kept inside the dynamic shell fixture because the test itself
    // imports no recursive directory-writing helper just for this one path.
    execFileSync("mkdir", ["-p", pidDir]);
    const statLine = (start) => `731 (peer ) name with spaces) S 1 731 731 ${Array(15).fill("0").join(" ")} ${start} 0\n`;
    const runnableBlock = helperBlock.replaceAll('"/proc/$1/stat"', '"$peer_proc_root/$1/stat"');
    const runFixture = (actions, survivor = false) => {
      writeFileSync(signalLog, "");
      let status = 0;
      try {
        execFileSync("sh", ["-c", `${runnableBlock}\npeer_proc_root=$1\npeer_pid_file=$2\nsignal_log=$3\nsurvivor=$4\nkill() { printf '%s\\n' "$*" >> "$signal_log"; if [ "$1" = -0 ]; then [ -f "$peer_proc_root/$2/stat" ]; return; fi; if [ "$1" = -KILL ] && [ "$survivor" != yes ]; then rm -f "$peer_proc_root/$2/stat"; fi; return 0; }\nsleep() { :; }\n${actions}`, "peer-test", procRoot, identityFile, signalLog, survivor ? "yes" : "no"]);
      } catch (err) {
        status = Number(err.status || 1);
      }
      return { signals: readFileSync(signalLog, "utf8").trim().split("\n").filter(Boolean), status };
    };

    writeFileSync(join(pidDir, "stat"), statLine("424242"));
    writeFileSync(identityFile, "731 424242\n");
    const live = runFixture("peer_pid_alive; peer_signal_pid TERM");
    check("the robust parser accepts field 22 after a comm containing spaces and a closing parenthesis", live.signals.length === 2, JSON.stringify(live));
    check("probe and TERM target only the identity-checked positive provider PID", JSON.stringify(live.signals) === JSON.stringify(["-0 731", "-TERM 731"]), JSON.stringify(live));

    writeFileSync(join(pidDir, "stat"), statLine("999999"));
    const reused = runFixture("peer_pid_alive || :; peer_signal_pid TERM || :");
    check("a reused PID with a different start time is never probed or signalled", reused.signals.length === 0, JSON.stringify(reused));

    rmSync(join(pidDir, "stat"));
    const dead = runFixture("peer_pid_alive || :; peer_signal_pid TERM || :");
    check("a missing proc identity is treated as original-process death without a signal", dead.signals.length === 0, JSON.stringify(dead));

    writeFileSync(join(pidDir, "stat"), statLine("424242"));
    writeFileSync(identityFile, "731 424242 surplus\n");
    const malformed = runFixture("peer_pid_alive || :; peer_signal_pid TERM || :");
    check("a malformed handoff with extra fields fails closed before every kill", malformed.signals.length === 0, JSON.stringify(malformed));

    writeFileSync(join(pidDir, "stat"), statLine("424242"));
    const startReadFailure = runFixture("peer_pid=731; peer_start=; peer_abort_unhanded");
    check(
      "a start-time read failure immediately TERM/KILLs the fresh direct child and leaves no survivor",
      startReadFailure.status === 0 &&
        startReadFailure.signals.slice(0, 2).join("|") === "-TERM 731|-KILL 731" &&
        !startReadFailure.signals.some((s) => /^-(TERM|KILL) (?!731$)/.test(s)) &&
        /peer_start=\$\(peer_start_time "\$peer_pid"\) \|\| peer_start=[\s\S]*peer_launch_status=125[\s\S]*peer_abort_unhanded[\s\S]*exit 125[\s\S]*exit 126/.test(prose),
      JSON.stringify(startReadFailure),
    );

    writeFileSync(join(pidDir, "stat"), statLine("424242"));
    const identityWriteFailure = runFixture("peer_pid=731; peer_start=424242; peer_abort_unhanded");
    check(
      "an identity-file write failure uses the acquired start token for bounded cleanup and leaves no survivor",
      identityWriteFailure.status === 0 && identityWriteFailure.signals.includes("-TERM 731") && identityWriteFailure.signals.includes("-KILL 731") && /Either handoff failure stops the entire cycle even when cleanup succeeds/.test(prose),
      JSON.stringify(identityWriteFailure),
    );

    writeFileSync(join(pidDir, "stat"), statLine("424242"));
    writeFileSync(identityFile, "731 424242\n");
    const killed = runFixture("peer_stop_pid");
    check("TERM resistance reaches KILL on the same positive PID and confirmed death succeeds", killed.status === 0 && killed.signals.includes("-TERM 731") && killed.signals.includes("-KILL 731"), JSON.stringify(killed));

    writeFileSync(join(pidDir, "stat"), statLine("424242"));
    const survivor = runFixture("peer_stop_pid", true);
    check("an identity that survives TERM and KILL makes teardown fail", survivor.status !== 0 && survivor.signals.includes("-TERM 731") && survivor.signals.includes("-KILL 731"), JSON.stringify(survivor));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  const pluginsProse = readFileSync(join(here, "..", "plugins", "dev-skills", "skills", "review-cycle", "SKILL.md"), "utf8");
  check(
    "both prose mirrors send only fresh Reviewer remarks to confirmation and keep peer notes human-summary-only",
    [prose, pluginsProse].every(
      (text) =>
        /hand the passing fresh Reviewer report/.test(text) &&
        /The peer's advisory notes are excluded: they remain human-summary-only/.test(text) &&
        /never enter a fixer or final-confirmation prompt/.test(text),
    ),
    "confirmation/pass-note boundary",
  );
  check("the direct Codex provider gets bounded TERM, death verification, safe KILL, and a survivor stop", /send TERM[\s\S]*at most ten seconds[\s\S]*send KILL only if[\s\S]*ten more seconds[\s\S]*stop the cycle and escalate/.test(pluginsProse), "raw Codex lifecycle prose");
  check(
    "the future Codex helper gets a private session artifact root and a caller wait that covers retry plus reaping",
    /first establish `artifact_root` as a unique, private, session-scoped directory outside the reviewed worktree[\s\S]*peer-review-run --provider codex[\s\S]*caller-side Bash\/tool wait to at least 570 seconds but strictly below its roughly 600-second cap[\s\S]*two 260-second attempts[\s\S]*five seconds reaping each one/.test(pluginsProse),
    "future Codex helper envelope",
  );
  const futureHelperStart = prose.indexOf("**Future helper conversion, only after both powbox prerequisites land.**");
  const retainedRawStart = prose.indexOf("**Retained raw launch until both powbox prerequisites land.**");
  const futureHelperProse = futureHelperStart >= 0 && retainedRawStart > futureHelperStart ? prose.slice(futureHelperStart, retainedRawStart) : "";
  check(
    "the Claude-provider helper conversion is exact, prerequisite-bound, and still leaves raw as the current primary",
    /schema `powbox\.peer-review-run\/v1` must expose the complete provider-neutral review through a documented field such as `reviewFile` or `reviewText`/.test(prose) &&
      /`artifactDir` alone does not identify a stable file/.test(prose) &&
      /Until both prerequisites land, use the direct launch below even when `peer-review-run` is installed/.test(prose) &&
      /The direct launch below remains the current primary path/.test(futureHelperProse) &&
      /peer-review-run --provider claude --worktree "\$worktree" --prompt-file "\$prompt_file" --artifact-root "\$artifact_root" --timeout 260 --model opus --effort medium/.test(futureHelperProse) &&
      /caller-side tool wait to at least 570 seconds[\s\S]*two 260-second attempts[\s\S]*five seconds reaping each one/.test(futureHelperProse) &&
      /require schema `powbox\.peer-review-run\/v1`[\s\S]*reported `model` is `opus` and `effort` is `medium`/.test(futureHelperProse) &&
      /when the contract supplies `reviewFile`, read that file in full and relay every finding from it verbatim/.test(futureHelperProse) &&
      /Never infer the review from `artifactDir`/.test(futureHelperProse) &&
      (prose.match(/peer-review-run --provider claude/g) || []).length === 1 &&
      retainedRawStart > futureHelperStart &&
      /nohup claude -p --model opus --effort medium/.test(prose.slice(retainedRawStart)),
    "provider-neutral review payload prerequisite",
  );
  check("the retained Claude launch is direct-PID only and stops on a survivor", /records `\$!` as the direct provider PID[\s\S]*peer_stop_pid[\s\S]*A surviving identity stops the entire cycle/.test(prose) && !/peer_group_alive|peer_signal_group|setsid --fork/.test(prose), "Claude direct-PID lifecycle prose");
  // Dropping the wrapper took its guarded `cd` with it, and `claude -p` has no
  // working-directory flag of its own: without this the peer inspects whichever
  // checkout the launching shell stood in while the embedded evidence describes
  // the reviewed worktree — a verdict over the wrong files rather than a
  // missing one. Both halves are asserted because either alone is satisfiable
  // by prose that does not run, or by a `cd` nothing explains.
  check(
    "and it runs from the reviewed worktree, guarded, before the provider starts",
    /\ncd -- "\$\{worktree:\?[^"\n]*\}" \|\| exit 125\n[\s\S]*\nnohup claude -p /.test(prose) &&
      /The launching shell changes into the reviewed worktree before starting the provider, and forfeits the launch if that fails/.test(prose),
    "peer launch working directory",
  );
  check(
    "the retained raw verdict is proved from literal embedded evidence and exact pinned OIDs",
    /BEGIN GENERATED REVIEW DATA/.test(prose) &&
      /END GENERATED REVIEW DATA/.test(prose) &&
      /BEGIN EMBEDDED GIT EVIDENCE/.test(prose) &&
      /END EMBEDDED GIT EVIDENCE/.test(prose) &&
      /EVIDENCE_BASE_OID: <full OID>/.test(prose) &&
      /EVIDENCE_TIP_OID: <full OID>/.test(prose) &&
      /`printf -- '%s\\n' "\$value"`/.test(prose) &&
      !/`printf '%s\\n' -- "\$value"`/.test(prose) &&
      /The provider receives the evidence in `prompt_file` itself and never has to read `diff_evidence_file`/.test(prose) &&
      /diff evidence unreadable or proof absent/.test(prose) &&
      /Missing or mismatched OID\/token proof changes `passed` to `forfeited`/.test(prose) &&
      /for `issues`, keep the `issues` outcome and every finding verbatim/.test(prose) &&
      !/Read the complete diff evidence at:/.test(prose) &&
      !/native read-only tools may read the one absolute out-of-worktree evidence path/.test(prose),
    "embedded evidence contract",
  );
  const evidenceContractLine = prose.split("\n").find((line) => line.startsWith("After the PID is dead")) || "";
  const passedContract = evidenceContractLine.match(/Missing or mismatched OID\/token proof changes `([^`]+)` to `([^`]+)` with reason exactly `([^`]+)`/);
  const issuesContract = evidenceContractLine.match(/for `([^`]+)`, keep the `([^`]+)` outcome and every finding verbatim[\s\S]*attaching that exact reason and an evidence-failure note/);
  const parsedEvidenceContract = passedContract && issuesContract
    ? {
        proofFailureReason: passedContract[3],
        [passedContract[1]]: { outcome: passedContract[2], preserveFindings: false, attachNote: false },
        [issuesContract[1]]: { outcome: issuesContract[2], preserveFindings: true, attachNote: true },
      }
    : null;
  const applyShippedEvidenceContract = (outcome, findings) => {
    const rule = parsedEvidenceContract && parsedEvidenceContract[outcome];
    if (!rule) return null;
    return {
      outcome: rule.outcome,
      findings: rule.preserveFindings ? findings : [],
      reason: parsedEvidenceContract.proofFailureReason,
      note: rule.attachNote ? "evidence proof failed; findings retained" : "",
    };
  };
  const passedNegative = applyShippedEvidenceContract("passed", []);
  check("the shipped prose contract forfeits a passed verdict with absent proof", passedNegative && passedNegative.outcome === "forfeited" && passedNegative.reason === "diff evidence unreadable or proof absent", JSON.stringify(passedNegative));
  const issueFindings = [{ severity: "blocking", claim: "grounded finding" }];
  const issuesNegative = applyShippedEvidenceContract("issues", issueFindings);
  check("the shipped prose contract retains issues findings and the evidence-failure reason", issuesNegative && issuesNegative.outcome === "issues" && issuesNegative.findings === issueFindings && issuesNegative.reason === "diff evidence unreadable or proof absent" && /findings retained/.test(issuesNegative.note), JSON.stringify(issuesNegative));

  const workflowCores = WORKFLOWS.map((file) => {
    const src = readFileSync(join(here, "..", "plugins", "dev-skills", "workflows", file), "utf8");
    const b = src.indexOf("BEGIN EMBEDDABLE SECTION: review-cycle-core");
    const e = src.indexOf("END EMBEDDABLE SECTION: review-cycle-core");
    return src.slice(src.indexOf("\n", b) + 1, src.lastIndexOf("\n", e));
  });
  check("the two executable review-cycle cores remain byte-identical", workflowCores[0] === workflowCores[1], `${workflowCores[0].length}/${workflowCores[1].length}`);
  check(
    "both workflow cores pin the future helper's private artifact root and caller wait budget",
    workflowCores.every((core) => /first establish \\`artifact_root\\` as a unique, private, session-scoped directory outside the reviewed worktree[\s\S]*peer-review-run --provider codex[\s\S]*caller-side Bash\/tool wait to at least 570 seconds but strictly below its roughly 600-second cap[\s\S]*two 260-second attempts[\s\S]*five seconds reaping each one/.test(core)),
    "future helper envelope in workflow cores",
  );

  const n = legOk + legFail - before;
  check(`peer lifecycle checks ran all ${PEER_LIFECYCLE_CHECKS}`, n === PEER_LIFECYCLE_CHECKS, `ran ${n}`);
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll review-cycle retirement checks passed.");
