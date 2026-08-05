#!/usr/bin/env node
// Focused behavior test for the review cycle's open-question RETIREMENT
// lifecycle. A retirement is the one disposition that takes a decision OFF the
// maintainer's list, so what the TERMINAL result says about a claimed question
// is a contract, not an implementation detail: it may read as settled only
// where a reviewer round actually accepted the claim.
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
function check(name, cond, detail) {
  if (cond) {
    console.log(`ok  - ${name}`);
  } else {
    failures++;
    console.error(`NOT ok - ${name}${detail ? `: ${detail}` : ""}`);
  }
}

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
// One packet that RAISES `q2` and, in the same breath, claims a `fixed`
// disposition settles it (scenario 12).
const raiseAndRetire = {
  ...PASS_PACKET,
  dispositions: [{ findingId: "r1-1", finding: "f", origin: "reviewer", disposition: "fixed", detail: "settled it", retiresQuestionIds: ["q2"] }],
  openQuestions: [Q2],
};

async function run(src, { fixes, reviews, cycle }) {
  const seen = { fixPrompts: [], reviewPrompts: [] };
  const runReviewCycle = loadCycle(src, scriptedAgent(fixes, reviews, seen));
  const res = await runReviewCycle({ ...CYCLE, ...cycle });
  const questionOf = (id) => (res.openQuestions || []).find((x) => x && x.id === id);
  // The three states a claimed question can be in, as a CONSUMER sees them:
  // `retired` is skipped, anything else is served to the maintainer.
  const stateOf = (id) => {
    const q = questionOf(id);
    return !q ? "absent" : q.retired ? "retired" : q.retirementPending ? "pending" : "live";
  };
  return { res, q: questionOf("q1"), state: stateOf("q1"), questionOf, stateOf, seen, carried: JSON.stringify(res.outstanding || {}) };
}

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
  await scenario("2. rejected retirement", async () => {
    const { res, q, state } = await run(src, {
      fixes: [escalate, retireOn("r1-1"), retireOn("r2-1"), retireOn("r3-1")],
      reviews: [FAIL("r1"), FAIL("unearned retirement"), FAIL("unearned retirement")],
    });
    check("rejected retirement is not settled at the round cap", res.verdict === "review-cap" && state === "pending", `${res.verdict}/${state}`);
    check("rejected retirement carries no `retired` mark", !!q && !q.retired);
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
    const { carried } = await run(src, {
      fixes: [escalate, retireOn("r1-1", ["nope", ""])],
      reviews: [FAIL("r1"), FAIL("r2")],
      cycle: { maxRounds: 2 },
    });
    check("unknown retirement id is reported, not dropped", /retire:nope/.test(carried));
    check("empty retirement id is reported, not dropped", /"retire:"/.test(carried));
  });

  // 8. A question under a pending claim cannot validate a later `escalated`
  //    disposition: the finding is carried forward instead of being covered by
  //    a decision somebody already claims to have taken off the table.
  await scenario("8. pending claim cannot cover a later escalation", async () => {
    const { carried } = await run(src, {
      fixes: [escalate, retireOn("r1-1"), escalateOn("r2-1", "q1")],
      reviews: [FAIL("r1"), FAIL("r2"), FAIL("r3")],
    });
    check("claimed question cannot cover a later escalation", /r2-1/.test(carried));
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
    const { carried, state } = await run(src, {
      fixes: [escalate, retireAndEscalateSame, idle],
      reviews: [FAIL("r1", "r1b"), FAIL("r2"), FAIL("r3")],
    });
    check("escalation onto a question the same pass retires is carried forward", /r1-2/.test(carried), carried);
    check("the same pass's own retirement still takes effect as a claim", state === "pending", state);
  });

  // 11. Only `fixed`/`declined` retire. An `escalated` disposition carrying
  //     `retiresQuestionIds` raises a question rather than settling one, so the
  //     claim must come back as its own `retire:` disposition error AND leave
  //     the named question live — a silent no-op would hide the contradiction,
  //     and applying it would settle a decision on an escalation.
  await scenario("11. escalated disposition cannot retire", async () => {
    const { carried, stateOf } = await run(src, {
      fixes: [escalate, escalateRetiring, idle],
      reviews: [FAIL("r1"), FAIL("r2"), FAIL("r3")],
    });
    check("an `escalated` disposition's retirement is reported", /retire:q1/.test(carried), carried);
    check("an `escalated` disposition's retirement does not mark the question", stateOf("q1") === "live", stateOf("q1"));
  });

  // 12. RAISE-AND-RETIRE in one packet. A packet whose `openQuestions` raises
  //     `q2` while a `fixed` disposition names `q2` in `retiresQuestionIds` is
  //     contradicting itself, not superseding anything — the retirable set is
  //     snapshotted BEFORE the pass's own questions are appended, so it must be
  //     reported and must not mark the brand-new question.
  await scenario("12. raise-and-retire in one packet", async () => {
    const { carried, stateOf } = await run(src, {
      fixes: [escalate, raiseAndRetire, idle],
      reviews: [FAIL("r1"), FAIL("r2"), FAIL("r3")],
    });
    check("retiring a question this same packet raised is reported", /retire:q2/.test(carried), carried);
    check("retiring a question this same packet raised does not mark it", stateOf("q2") === "live", stateOf("q2"));
  });
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll review-cycle retirement checks passed.");
