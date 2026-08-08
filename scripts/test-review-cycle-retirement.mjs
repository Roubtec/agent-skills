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
// The workflows are runtime scripts (top-level await/return, injected
// `agent`/`parallel`/`log` globals), so they cannot be imported. This evaluates
// the ACTUAL shipped `review-cycle-core` section — no second copy — with those
// globals stubbed, and drives scripted fixer/reviewer packets through
// `runReviewCycle`. Both workflow files are exercised, so the canonical section
// and wf-address-tasks.js's embedded copy are checked as running code rather
// than only as identical bytes.
//
// Run: node scripts/test-review-cycle-retirement.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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
const CHECKS_PER_LEG = 78;

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
  // eslint-disable-next-line no-new-func
  return new Function("agent", "parallel", "pipeline", "log", "phase", `${section}\nreturn runReviewCycle;`)(
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
function scriptedAgent(fixes, reviews, seen) {
  const fixQueue = [...fixes];
  const reviewQueue = [...reviews];
  return async function agent(prompt, opts) {
    const label = (opts && opts.label) || "";
    if (label.startsWith("fix#")) {
      seen.fixPrompts.push(prompt);
      const p = fixQueue.shift();
      return p === undefined ? null : p;
    }
    if (label.startsWith("review#")) {
      seen.reviewPrompts.push(prompt);
      const p = reviewQueue.shift();
      return p === undefined ? { pass: true, issues: [], notes: "" } : p;
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

async function run(src, { fixes, reviews, cycle }) {
  const seen = { fixPrompts: [], reviewPrompts: [] };
  // Deep-clone every scripted packet. The cycle MUTATES the question objects it
  // accumulates — that is how a retirement mark lands — and the packets above
  // are module-level literals shared by every scenario and BOTH workflow legs.
  // Without this, scenario 1's accepted retirement stamps `retired` onto the
  // shared `Q1` and each later scenario silently exercises the volunteered-mark
  // STRIP path instead of the clean one it means to test.
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const runReviewCycle = loadCycle(src, scriptedAgent(clone(fixes), clone(reviews), seen));
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

  const ran = legOk + legFail;
  check(`suite ran all ${CHECKS_PER_LEG} checks`, ran === CHECKS_PER_LEG, `ran ${ran}`);
  legOk = 0;
  legFail = 0;
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll review-cycle retirement checks passed.");
