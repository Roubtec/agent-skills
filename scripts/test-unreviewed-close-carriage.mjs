#!/usr/bin/env node
// Focused behavior test for what the review cycle's CONSUMERS do with a record
// of a conclusion no fresh reviewer saw — the trivial-round close-out and the
// record-only close over the delivery gate's one tolerated post-run commit.
//
// The cycle produces those records; `test-review-cycle-retirement.mjs` covers
// that half. This covers the other half, which is where the same gap has now
// opened twice: a consumer's result adapter forwards a NAMED list of fields, so
// every field the cycle's contract grows is dropped until the adapter is
// taught it. A dropped `recordOnly` is not a cosmetic loss — the delivery gate
// admits a FAILED delivery run only on the promise that the failures are
// documented where the maintainer sees them, and these two consumers are the
// only things standing between that record and the maintainer.
//
// The workflows are runtime scripts (top-level await/return, injected
// `agent`/`parallel`/`log` globals), so they cannot be imported. Each subject is
// extracted from the ACTUAL shipped source — the declarations before the
// workflow's first executable statement for the prompt builders, the literal
// object for `wf-address-review.js`'s inline carrier — and evaluated in
// isolation. No second copy of anything under test lives here.
//
// Run: node scripts/test-unreviewed-close-carriage.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const workflows = join(here, "..", "plugins", "dev-skills", "workflows");

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
// does not count. Bump it deliberately when adding or removing one — a check
// that silently stops running is invisible to a suite that only gates on
// failures.
const EXPECTED_CHECKS = 17;

// Evaluate a workflow's declarations up to its first executable statement and
// hand back the named ones. Each is returned by an explicit reference, so a
// renamed or removed subject is a ReferenceError here rather than a silent skip.
function loadDeclarations(file, cut, wanted) {
  const src = readFileSync(join(workflows, file), "utf8");
  const at = src.indexOf(cut);
  if (at < 0) throw new Error(`${file}: cut marker not found: ${JSON.stringify(cut)}`);
  const prefix = src.slice(0, at).replace(/^export const meta/m, "const meta");
  const body = `"use strict";\n${prefix}\nreturn { ${wanted.map((n) => `${n}: ${n}`).join(", ")} };`;
  // eslint-disable-next-line no-new-func
  return new Function("args", body)("");
}

// The record a record-only close leaves behind: the check's line about the
// range, and — the part with no other carrier, since no reviewer round follows
// this exit — the pass's own note of what the delivery run surfaced.
const NOTE = "the delivery run's only failure was the payments suite, which reproduces on the base; queued as tasks/046-flaky-payments-suite.md";
const RECORD = { pass: 3, range: "aaaa..bbbb", verified: "only a new diagnosis-only task file", note: NOTE };
const CLOSE_OUT = { pass: 3, range: "aaaa..bbbb", edits: ["reworded a comment"], verified: "every hunk non-semantic" };
// A cycle result that concluded on one of those exits, and one that did not.
const cycleResult = (extra) => ({
  verdict: "pass",
  rounds: 2,
  openQuestions: [],
  deviations: [],
  peerRounds: [],
  artifactDir: "/tmp/art",
  // The cycle's own `notes` is the last pass's `summary`. It must NOT ride the
  // carrier: a task result derived from this one already uses `notes` for the
  // reviewer's PR-body caveats, and the carrier is applied to both shapes.
  notes: "what the final pass did",
  reviewerNotes: "reviewer caveat",
  ...extra,
});

// --- wf-address-tasks.js: the batch adapter -------------------------------
{
  const src = readFileSync(join(workflows, "wf-address-tasks.js"), "utf8");
  const m = src.match(/function cycleCarried\(result\) \{[\s\S]*?\n\}/);
  if (!m) {
    console.error("FAIL: could not locate cycleCarried in wf-address-tasks.js.");
    process.exit(1);
  }
  // eslint-disable-next-line no-new-func
  const cycleCarried = new Function(`return (${m[0]});`)();

  const carried = cycleCarried(cycleResult({ recordOnly: RECORD, closeOut: CLOSE_OUT }));
  check("the batch carrier forwards the record-only close", JSON.stringify(carried.recordOnly) === JSON.stringify(RECORD), JSON.stringify(carried.recordOnly));
  check("and the pass's own note of what the run surfaced rides with it", (carried.recordOnly || {}).note === NOTE, JSON.stringify(carried.recordOnly));
  check("and it forwards the trivial-round close-out beside it", JSON.stringify(carried.closeOut) === JSON.stringify(CLOSE_OUT), JSON.stringify(carried.closeOut));

  // Present-only, exactly like `deviationHistory` and `artifactDirAnomalies`:
  // a cycle that concluded normally must not carry an empty record, which a
  // reader would have to interpret.
  const plain = cycleCarried(cycleResult());
  check("a cycle that concluded normally carries neither key", !("recordOnly" in plain) && !("closeOut" in plain), JSON.stringify(plain));

  // The field that must NOT ride: `notes` means the cycle's last-pass summary
  // on the raw result and the reviewer's PR-body caveats on a task result
  // derived from it, and the carrier is applied to both.
  check("the carrier does not forward `notes`, whose name means two different things across the shapes it is applied to", !("notes" in carried), JSON.stringify(Object.keys(carried)));

  // `deliverTask` re-applies the carrier to the task result `implementTask`
  // built, so the record has to survive the second pass as well.
  const ready = { slug: "s", branch: "b", status: "ready", notes: "reviewer caveat", ...carried };
  const delivered = cycleCarried(ready);
  check("the record survives the carrier's second application, on the derived task result", JSON.stringify(delivered.recordOnly) === JSON.stringify(RECORD) && JSON.stringify(delivered.closeOut) === JSON.stringify(CLOSE_OUT), JSON.stringify(delivered));

  const { prPrompt } = loadDeclarations("wf-address-tasks.js", "\nconst peerMode = /", ["prPrompt"]);
  const task = { slug: "t035", branch: "task/035-x", base: "main", path: "tasks/035-x.md" };
  const withRecord = prPrompt(task, { notes: "reviewer caveat", deviations: [], recordOnly: RECORD }, true);
  check("the PR body brief carries the recorded-not-reviewed section", /Delivery-run failure — recorded, not reviewed/.test(withRecord), "pr prompt");
  check("with the unreviewed range named", withRecord.includes(RECORD.range), "pr prompt");
  check("and the delivery run's own note of the failure in it", withRecord.includes(NOTE), "pr prompt");
  check("and the range check's separate line beside it", withRecord.includes(RECORD.verified), "pr prompt");
  check("and the reviewer's caveats still reach the body", /Reviewer caveats to surface in the PR body/.test(withRecord), "pr prompt");

  const withoutRecord = prPrompt(task, { notes: "reviewer caveat", deviations: [] }, true);
  check("a cycle with no such close gets no such section", !/recorded, not reviewed/.test(withoutRecord), "pr prompt");

  // The no-remote branch opens no PR at all, so it must not be handed a record
  // it has nowhere to put.
  const noRemote = prPrompt(task, { notes: "", deviations: [], recordOnly: RECORD }, false);
  check("the no-remote brief, which opens no PR, carries no record", !noRemote.includes(NOTE) && !/recorded, not reviewed/.test(noRemote), "pr prompt");
}

// --- wf-address-review.js: the sibling consumer's inline carrier -----------
{
  const src = readFileSync(join(workflows, "wf-address-review.js"), "utf8");
  const m = src.match(/\nconst carried = \{[\s\S]*?\n\};/);
  if (!m) {
    console.error("FAIL: could not locate the `carried` object literal in wf-address-review.js.");
    process.exit(1);
  }
  const literal = m[0].replace(/^\nconst carried = /, "").replace(/;$/, "");
  // eslint-disable-next-line no-new-func
  const carriedOf = new Function("cycle", `return (${literal});`);

  const carried = carriedOf(cycleResult({ recordOnly: RECORD, closeOut: CLOSE_OUT }));
  check("the review-addressing carrier forwards both records too", JSON.stringify(carried.recordOnly) === JSON.stringify(RECORD) && JSON.stringify(carried.closeOut) === JSON.stringify(CLOSE_OUT), JSON.stringify(carried));
  const plain = carriedOf(cycleResult());
  check("and carries neither key when the cycle concluded normally", !("recordOnly" in plain) && !("closeOut" in plain), JSON.stringify(plain));

  const { publishPrompt } = loadDeclarations("wf-address-review.js", "\nconst raw = flattenArgs(args);", ["publishPrompt"]);
  const pkt = { pr: { number: 42, url: "https://example.invalid/pr/42", branch: "b", workingBranch: "b", base: "main", headOid: "deadbeef", rebased: false }, items: [] };
  const withRecord = publishPrompt(pkt, [], { push: true }, [], [], RECORD);
  check("the summary comment brief carries the recorded-not-reviewed section with the run's note", /Delivery-run failure — recorded, not reviewed/.test(withRecord) && withRecord.includes(NOTE) && withRecord.includes(RECORD.range), "publish prompt");
  const withoutRecord = publishPrompt(pkt, [], { push: true }, []);
  check("and omits it for a cycle that concluded normally", !/recorded, not reviewed/.test(withoutRecord), "publish prompt");
}

check(`suite ran all ${EXPECTED_CHECKS} checks`, ran === EXPECTED_CHECKS, `ran ${ran}`);

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll unreviewed-close carriage checks passed.");
