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
// It also covers the publication guard that landed beside the gate, which is
// prompt prose rather than script logic: a HEAD that is a proper ancestor of
// the PR head must stop the publisher BEFORE the lease it would otherwise
// match and rewind the branch with.
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
// does not count. Bump it deliberately when adding or removing one — a
// scenario that silently stops running is invisible to a suite that only gates
// on failures.
const EXPECTED_CHECKS = 29;

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
const { gatherPrompt, publishPrompt } = new Function(
  "args",
  `"use strict";\n${prefix}\nreturn { gatherPrompt, publishPrompt };`,
)("");

// Reaching the nested cycle ends the scenario: everything past the gate is
// another workflow's business. Thrown rather than returned so "the run
// proceeded" cannot be confused with any status the script itself returns.
const REACHED_CYCLE = Symbol("nested review cycle reached");

// Run the shipped script with one scripted gather packet. `no-push` keeps the
// run local-only: the gate is flag-independent, and a publish path would need
// stubs for work this suite is not about.
async function run(packet) {
  const seen = { agentLabels: [], cycleOpts: null };
  const agent = async (prompt, opts) => {
    const label = (opts && opts.label) || "";
    seen.agentLabels.push(label);
    if (label === "gather") return packet;
    throw new Error(`unexpected agent call past the gate: ${label}`);
  };
  const workflow = async (name, opts) => {
    seen.cycleOpts = { name, opts };
    throw REACHED_CYCLE;
  };
  const nope = () => {
    throw new Error("unexpected fan-out call");
  };
  try {
    const result = await script("no-push", agent, () => {}, workflow, nope, nope, () => {});
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
// last so a scenario can omit it entirely — the absent-report case.
function gathered({ workingBranch = "feature/x", items = [], reconcile }) {
  const packet = {
    ok: true,
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
  if (reconcile !== undefined) packet.reconcile = reconcile;
  return packet;
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
// stay publication metadata. Reconciliation is skipped WHOLE here, so no
// reported outcome — including none at all, and including one that contradicts
// the exemption — may stop the run.
{
  const off = { workingBranch: "feature/x-offshoot" };
  const clean = await run(gathered({ ...off, reconcile: { outcome: "not-applicable" } }));
  check("off-shoot `not-applicable` with no threads is a plain no-op", clean.status === "no-op", JSON.stringify(clean.result));
  const working = await run(gathered({ ...off, reconcile: { outcome: "not-applicable" }, items: [ITEM] }));
  check("off-shoot `not-applicable` with threads proceeds to the nested cycle", working.status === "reached-cycle", working.status);
  check(
    "and the cycle runs on the off-shoot, not on the PR's head ref",
    working.seen.cycleOpts && working.seen.cycleOpts.opts.branch === "feature/x-offshoot",
    JSON.stringify(working.seen.cycleOpts && working.seen.cycleOpts.opts && working.seen.cycleOpts.opts.branch),
  );
  const absent = await run(gathered({ ...off }));
  check("off-shoot with no `reconcile` report at all still proceeds", absent.status === "no-op", absent.status);
  const contradicting = await run(gathered({ ...off, reconcile: { outcome: "unrecognized", detail: "behind the PR head" } }));
  check("off-shoot `unrecognized` still proceeds — behind the head is that case's normal state", contradicting.status === "no-op", contradicting.status);
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
  const testsObjectExistence = /cat-file -e/.test(brief);
  check(
    "and takes their `R` from the fetched ref, not from an existence test on the recorded OID",
    readsFetchedHead && !testsObjectExistence,
    `reads FETCH_HEAD: ${readsFetchedHead}; tests object existence: ${testsObjectExistence}`,
  );

  // The off-shoot exemption is stated to the agent as well as enforced by the
  // gate: where the names differ the step is skipped WHOLE, which is what makes
  // `not-applicable` the honest report there rather than an unrun probe's.
  const skipPara = brief.split("\n\n").find((p) => p.includes('outcome: "not-applicable"')) || "";
  check(
    "and skips reconciliation whole where the branch names differ, reporting `not-applicable`",
    /differ/i.test(skipPara) && /skip/i.test(skipPara),
    skipPara ? skipPara.slice(0, 160) : 'no paragraph reports `outcome: "not-applicable"`',
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

check(`suite ran all ${EXPECTED_CHECKS} checks`, ran === EXPECTED_CHECKS, `ran ${ran}`);

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll address-review reconciliation checks passed.");
