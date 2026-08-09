#!/usr/bin/env node
// Focused behavior test for what the review cycle's CONSUMERS do with a record
// of a conclusion no fresh reviewer saw — the trivial-round close-out and the
// record-only close over the delivery gate's one tolerated post-run commit —
// plus the per-pass flake history that rides beside them, which is where an
// INTERMEDIATE pass's evidenced-unrelated failure reaches the maintainer once a
// later pass has concluded clean and the record speaks only for that pass.
//
// The per-pass PACKET MEASUREMENT log rides the same carriers and is covered
// here for a sharper version of the same reason: the cycle refuses a
// measured-dirty packet with a message that points the reader at that log BY
// NAME for the list of uncommitted paths, and these carriers are the only thing
// that puts the log beside the message the maintainer reads.
//
// The cycle produces those records; `test-review-cycle-retirement.mjs` covers
// that half. This covers the other half, which is where the same gap keeps
// opening: a consumer's result adapter forwards a NAMED list of
// fields, so every field the cycle's contract grows is dropped until the
// adapter is taught it. A dropped `recordOnly` is not a cosmetic loss — the
// delivery gate admits a FAILED delivery run only on the promise that the
// failures are documented where the maintainer sees them, and these two
// consumers are the only things standing between that record and the maintainer.
//
// Forwarding it faithfully is not the whole duty, though: one consumer runs a
// stage AFTER the cycle that can falsify part of the record — the pre-PR
// collision guard's fresh re-review of a renamed branch, which sees the very
// commit the record says no fresh reviewer saw. `collisionReviewedRecord` is
// covered here too, on both halves: what it must correct, and what it must
// leave alone.
//
// The workflows are runtime scripts (top-level await/return, injected
// `agent`/`parallel`/`log` globals), so they cannot be imported. Each subject is
// extracted from the ACTUAL shipped source, by one of three methods:
//   1. the declarations before the workflow's first executable statement,
//      evaluated together — the prompt builders, and `collisionReviewedRecord`;
//   2. the subject's own source text, matched out and evaluated in isolation —
//      `wf-address-tasks.js`'s `cycleCarried` function and
//      `wf-address-review.js`'s inline `carriedOf` carrier;
//   3. the shipped statement held here VERBATIM as a regex and asserted against
//      the source rather than evaluated — the collision dispatch's call site,
//      which is executable body no harness can drive.
// Of the subjects this suite evaluates (1 and 2), no second copy lives here.
// Method 3 is a second copy on purpose: a copy is the only thing that can fail
// when the call site it pins is edited away, and it buys coverage of a line
// nothing else here can reach.
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
const EXPECTED_CHECKS = 42;

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
// The SAME record from the flake rule's other outcome: the evidence matched an
// already-ACTIVE task, so the pass cited it rather than editing it and had
// nothing to commit. An empty `range` is the discriminator, and it says one
// thing only — this record names no post-run commit of its own, which is true
// of this outcome (nothing was committed), of the light conclusion (its
// commits were seen by the round that just passed), of the close-out
// conclusion (what it committed rides in the `closeOut` record this same
// result carries), and of a record `collisionReviewedRecord` has corrected
// below (a fresh reviewer has since read the commit). Whichever of the four it
// is, the note is then the whole record of the failure: the record points the
// consumer at no commit, and there is still a failed delivery run the
// maintainer must be told about. The rendered clause says exactly that much
// and no more — it does not say why the record points at none, because the
// four members disagree on the why and the fourth one has a commit still
// sitting on the branch.
const CITED_NOTE = "the delivery run's only failure was the payments suite, which reproduces on the base; already queued as tasks/041-flaky-payments-suite.md, cited rather than re-filed";
const CITED_RECORD = { pass: 3, range: "", verified: "", note: CITED_NOTE };
const CLOSE_OUT = { pass: 3, range: "aaaa..bbbb", edits: ["reworded a comment"], verified: "every hunk non-semantic" };
// The record `recordOnly` cannot carry: an INTERMEDIATE pass's. That record
// speaks for the conclusion, and the heading the consumers publish it under is
// about a failed DELIVERY run, so only the concluding pass's belongs there —
// which is exactly why a pass-1 failure a later clean pass superseded reaches
// the maintainer through this list or not at all.
const FLAKE_HISTORY = [{ pass: 1, note: "the round-tier run's only failure was the payments suite, which reproduces on the base; already queued as tasks/041-flaky-payments-suite.md, cited rather than re-filed" }];
// The cycle's per-pass measurement log. It rides these carriers for a reason of
// its own: the cycle REFUSES a measured-dirty packet with a message that points
// the reader at this entry by name for the list of uncommitted paths, and these
// carriers are what puts that entry beside the message the maintainer reads —
// the batch Summary, and the failed-cycle return of the review-addressing run.
// Dropped, the reading survives as a count and the list it promises is nowhere.
const PACKET_CHECKS = [
  { pass: 1, measured: true, dirty: [], operation: "", detail: "clean and idle" },
  { pass: 2, measured: true, dirty: [" M src/app.ts", "?? notes.txt"], operation: "", detail: "two uncommitted paths" },
];
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

  // And the third field of the same class, present-only for the same reason:
  // the batch Summary this carrier feeds is the only place an intermediate
  // pass's flake record reaches the maintainer once a later pass concluded
  // clean, so dropping it here drops the record entirely.
  const withHistory = cycleCarried(cycleResult({ flakeHistory: FLAKE_HISTORY }));
  check("the batch carrier forwards every pass's flake record, with no conclusion-level record beside it", JSON.stringify(withHistory.flakeHistory) === JSON.stringify(FLAKE_HISTORY) && !("recordOnly" in withHistory), JSON.stringify(withHistory));
  check("and carries no history key for a cycle no pass reported a flake on", !("flakeHistory" in plain), JSON.stringify(Object.keys(plain)));

  // The measurement log, which the cycle's refusal message names outright. The
  // refusal it belongs to is an `error` verdict, so the shape that carries it
  // to the maintainer is `implementTask`'s error return — this carrier spread
  // into it — and the Summary is where it is read.
  const measured = cycleCarried(cycleResult({ packetChecks: PACKET_CHECKS }));
  check("the batch carrier forwards the per-pass measurement log the refusal message points the reader at", JSON.stringify(measured.packetChecks) === JSON.stringify(PACKET_CHECKS), JSON.stringify(measured.packetChecks));
  check("and carries no such key for a cycle that measured nothing", !("packetChecks" in plain), JSON.stringify(Object.keys(plain)));

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

  // The no-commit shape. It must render the same section — the delivery run
  // failed either way — and must not describe a commit that does not exist,
  // nor hand the writer an empty range check to copy verbatim.
  const cited = prPrompt(task, { notes: "reviewer caveat", deviations: [], recordOnly: CITED_RECORD }, true);
  check("a record with no commit behind it still gets the recorded-not-reviewed section", /Delivery-run failure — recorded, not reviewed/.test(cited) && cited.includes(CITED_NOTE), "pr prompt");
  check("and names no final commit, saying only that the record points at none and asserting no reason why", !/final commit/.test(cited) && /no post-run commit this record points you at, so cite none/.test(cited) && !/of its own/.test(cited), "pr prompt");
  check("and hands the writer no empty range check to copy", !/rangeCheck/.test(cited), "pr prompt");

  // The no-remote branch opens no PR at all, so it must not be handed a record
  // it has nowhere to put.
  const noRemote = prPrompt(task, { notes: "", deviations: [], recordOnly: RECORD }, false);
  check("the no-remote brief, which opens no PR, carries no record", !noRemote.includes(NOTE) && !/recorded, not reviewed/.test(noRemote), "pr prompt");

  // The one stage that can FALSIFY the record between the cycle and the PR.
  // A branch the pre-PR collision guard's resolver renamed gets a fresh
  // DELIVERY-tier reviewer over the cumulative range before it may deliver, so
  // that reviewer has seen the tolerated post-run commit the record-only exit
  // let through — and the body would otherwise still tell the maintainer no
  // fresh reviewer saw it. The correction is narrow on purpose: the failed
  // delivery run is still the maintainer's to absorb, so only the
  // unreviewed-commit claim goes.
  const { collisionReviewedRecord } = loadDeclarations("wf-address-tasks.js", "\nconst peerMode = /", ["collisionReviewedRecord"]);
  const reviewed = collisionReviewedRecord({ recordOnly: RECORD });
  check("a re-reviewed branch's record stops naming a commit no fresh reviewer saw", reviewed.recordOnly && reviewed.recordOnly.range === "" && reviewed.recordOnly.verified === "", JSON.stringify(reviewed));
  check("while the failed delivery run it exists to report survives the correction", reviewed.recordOnly && reviewed.recordOnly.note === NOTE && reviewed.recordOnly.pass === RECORD.pass, JSON.stringify(reviewed));
  check("a record that already names no commit of its own is left alone, inventing no key", JSON.stringify(collisionReviewedRecord({ recordOnly: CITED_RECORD })) === "{}", JSON.stringify(collisionReviewedRecord({ recordOnly: CITED_RECORD })));
  check("and a cycle that concluded normally gets no record from this correction either", JSON.stringify(collisionReviewedRecord({ notes: "x" })) === "{}", JSON.stringify(collisionReviewedRecord({ notes: "x" })));

  // End to end through the consumer that publishes it: the corrected record
  // must render the no-commit shape, note intact.
  const afterReReview = prPrompt(task, { notes: "reviewer caveat", deviations: [], ...collisionReviewedRecord({ recordOnly: RECORD }) }, true);
  check("so the PR body of a re-reviewed branch reports the failure without claiming an unreviewed commit", /Delivery-run failure — recorded, not reviewed/.test(afterReReview) && afterReReview.includes(NOTE) && !/final commit/.test(afterReReview) && !afterReReview.includes(RECORD.range) && !/rangeCheck/.test(afterReReview), "pr prompt");

  // The re-review's OWN record. That standalone pass runs the branch's last
  // delivery-tier validation — after the resolver changed the branch, with no
  // fixer pass anywhere around it — so a failure it passes over as
  // evidenced-unrelated must come back through its verdict and be published,
  // or the PR opens over a failed final run the maintainer never hears of.
  const { collisionReReviewFlakeRecord, collisionReReviewPrompt, COLLISION_RE_REVIEW_SCHEMA, CYCLE_REVIEW_SCHEMA } = loadDeclarations("wf-address-tasks.js", "\nconst peerMode = /", [
    "collisionReReviewFlakeRecord",
    "collisionReReviewPrompt",
    "COLLISION_RE_REVIEW_SCHEMA",
    "CYCLE_REVIEW_SCHEMA",
  ]);
  const RE_NOTE = "the re-review run's only failure was the payments suite, which reproduces on the base; tied to the ACTIVE tasks/041-flaky-payments-suite.md";
  const own = collisionReReviewFlakeRecord(cycleResult({ recordOnly: RECORD, flakeHistory: FLAKE_HISTORY }), { pass: true, flakeRecord: RE_NOTE });
  check("the re-review's own deferred failure becomes a published record in the no-commit shape, under a named pass", own.recordOnly && own.recordOnly.note === RE_NOTE && own.recordOnly.range === "" && own.recordOnly.verified === "" && own.recordOnly.pass === "collision-re-review", JSON.stringify(own.recordOnly));
  check("and is appended to the flake history without dropping an earlier pass's entry", JSON.stringify(own.flakeHistory) === JSON.stringify([...FLAKE_HISTORY, { pass: "collision-re-review", note: RE_NOTE }]), JSON.stringify(own.flakeHistory));
  check("a cycle no pass reported a flake on starts the history at this pass", JSON.stringify(collisionReReviewFlakeRecord(cycleResult(), { pass: true, flakeRecord: RE_NOTE }).flakeHistory) === JSON.stringify([{ pass: "collision-re-review", note: RE_NOTE }]), "helper");
  check("a verdict carrying no record — absent, empty, or whitespace — is spread-neutral", JSON.stringify(collisionReReviewFlakeRecord(cycleResult({ recordOnly: RECORD }), { pass: true })) === "{}" && JSON.stringify(collisionReReviewFlakeRecord(cycleResult(), { pass: true, flakeRecord: "  " })) === "{}" && JSON.stringify(collisionReReviewFlakeRecord(cycleResult(), null)) === "{}", "helper");

  // Through the call site's spread order and the publishing consumer: the
  // re-review's record replaces the corrected one — it speaks for the branch's
  // actual last delivery-tier run — and renders citing no commit.
  const superseded = { ...collisionReviewedRecord({ recordOnly: RECORD }), ...collisionReReviewFlakeRecord({ recordOnly: RECORD, flakeHistory: FLAKE_HISTORY }, { pass: true, flakeRecord: RE_NOTE }) };
  const ownRendered = prPrompt(task, { notes: "", deviations: [], recordOnly: superseded.recordOnly }, true);
  check("so the PR body of a re-reviewed branch whose re-review run failed reports THAT run's record, naming no commit", /Delivery-run failure — recorded, not reviewed/.test(ownRendered) && ownRendered.includes(RE_NOTE) && !ownRendered.includes(NOTE) && !ownRendered.includes(RECORD.range) && !/rangeCheck/.test(ownRendered), "pr prompt");

  check("the re-review schema is the reviewer schema plus the recording field, which is its one new gate — required exactly as the fixer packet's is, so an omitted record is a schema violation, not a silent non-disclosure", "flakeRecord" in COLLISION_RE_REVIEW_SCHEMA.properties && Object.keys(CYCLE_REVIEW_SCHEMA.properties).every((k) => k in COLLISION_RE_REVIEW_SCHEMA.properties) && JSON.stringify(COLLISION_RE_REVIEW_SCHEMA.required) === JSON.stringify([...CYCLE_REVIEW_SCHEMA.required, "flakeRecord"]), JSON.stringify(COLLISION_RE_REVIEW_SCHEMA.required));
  const brief = collisionReReviewPrompt(task, true, "on");
  check("the re-review brief states the delivery tier and demands the record for a failure it passes over", /DELIVERY tier/.test(brief) && /MUST come back in `flakeRecord`/.test(brief) && /stays blocking/.test(brief), "re-review brief");

  // And the call site actually applies it — a helper nothing spreads into the
  // delivered result corrects nothing. Checked against the source text because
  // the collision dispatch is executable body, which no harness can drive (the
  // header's third extraction method). What each pin establishes is exactly
  // that its statement still ships verbatim: it reads no surrounding guard, so
  // it does not establish which arm of the dispatch holds it.
  const dispatchSrc = readFileSync(join(workflows, "wf-address-tasks.js"), "utf8");
  const APPLIED = /deliverable\.push\(\{ task, result: \{ \.\.\.result, notes: verdict\.notes \|\| result\.notes, \.\.\.freshAssessments, \.\.\.collisionReviewedRecord\(result\), \.\.\.collisionReReviewFlakeRecord\(result, verdict\) \} \}\);/;
  check("the collision dispatch's delivering push spreads the correction and the re-review's own record into the result it delivers", APPLIED.test(dispatchSrc), "wf-address-tasks.js");
  const RE_REVIEW_CALL = /await agent\(collisionReReviewPrompt\(task, remote, peerMode, standingDeviations\), \{ label: `re-review:\$\{task\.slug\}`, schema: COLLISION_RE_REVIEW_SCHEMA \}\)/;
  check("and its re-review runs the extended brief under the extended schema", RE_REVIEW_CALL.test(dispatchSrc), "wf-address-tasks.js");
}

// --- wf-address-review.js: the sibling consumer's inline carrier -----------
{
  const src = readFileSync(join(workflows, "wf-address-review.js"), "utf8");
  // A function of the cycle rather than one object literal, since task 016 gave
  // that run a SECOND cycle — the post-rebase re-verification, which replaces
  // the first when a pre-push rebase replays anything — and a carrier read once
  // would forward the superseded cycle's records into results describing the
  // re-verified one. Matched whole and evaluated, so the parameter's name is
  // this suite's business no longer.
  const m = src.match(/\nconst carriedOf = \([\w$]+\) => \(\{[\s\S]*?\n\}\);/);
  if (!m) {
    console.error("FAIL: could not locate the `carriedOf` carrier in wf-address-review.js.");
    process.exit(1);
  }
  const literal = m[0].replace(/^\nconst carriedOf = /, "").replace(/;$/, "");
  // eslint-disable-next-line no-new-func
  const carriedOf = new Function(`return (${literal});`)();

  const carried = carriedOf(cycleResult({ recordOnly: RECORD, closeOut: CLOSE_OUT }));
  check("the review-addressing carrier forwards both records too", JSON.stringify(carried.recordOnly) === JSON.stringify(RECORD) && JSON.stringify(carried.closeOut) === JSON.stringify(CLOSE_OUT), JSON.stringify(carried));
  const plain = carriedOf(cycleResult());
  check("and carries neither key when the cycle concluded normally", !("recordOnly" in plain) && !("closeOut" in plain), JSON.stringify(plain));
  const withHistory = carriedOf(cycleResult({ flakeHistory: FLAKE_HISTORY }));
  check("it forwards every pass's flake record too, and only when some pass reported one", JSON.stringify(withHistory.flakeHistory) === JSON.stringify(FLAKE_HISTORY) && !("flakeHistory" in plain), JSON.stringify(withHistory));
  const measured = carriedOf(cycleResult({ packetChecks: PACKET_CHECKS }));
  check("and the measurement log the refusal message names, whose failed-cycle return is where that message reaches the maintainer", JSON.stringify(measured.packetChecks) === JSON.stringify(PACKET_CHECKS) && !("packetChecks" in plain), JSON.stringify(measured.packetChecks));

  const { publishPrompt } = loadDeclarations("wf-address-review.js", "\nconst raw = flattenArgs(args);", ["publishPrompt"]);
  const pkt = { pr: { number: 42, url: "https://example.invalid/pr/42", branch: "b", workingBranch: "b", base: "main", headOid: "deadbeef", rebased: false }, items: [] };
  const withRecord = publishPrompt(pkt, [], { push: true }, [], [], RECORD);
  check("the summary comment brief carries the recorded-not-reviewed section with the run's note", /Delivery-run failure — recorded, not reviewed/.test(withRecord) && withRecord.includes(NOTE) && withRecord.includes(RECORD.range), "publish prompt");
  const withoutRecord = publishPrompt(pkt, [], { push: true }, []);
  check("and omits it for a cycle that concluded normally", !/recorded, not reviewed/.test(withoutRecord), "publish prompt");
  // The section sits BELOW the numbered instructions, so the step that writes
  // the summary comment has to name it. A section defined below and referenced
  // nowhere is one the writer can compose the whole comment without ever
  // reaching — and the checks above, which only ask whether the text is
  // present, would stay green through exactly that loss.
  const CROSS_REF = /plus the delivery-run failure section defined below/;
  check("and step 5 cross-references it, so the writer meets it while composing the comment", CROSS_REF.test(withRecord) && !CROSS_REF.test(withoutRecord), "publish prompt");
  const cited = publishPrompt(pkt, [], { push: true }, [], [], CITED_RECORD);
  check("the no-commit record reaches the summary comment too, naming no commit and no empty range check", /Delivery-run failure — recorded, not reviewed/.test(cited) && cited.includes(CITED_NOTE) && !/final commit/.test(cited) && /no post-run commit this record points you at, so cite none/.test(cited) && !/of its own/.test(cited) && !/rangeCheck/.test(cited), "publish prompt");
}

check(`suite ran all ${EXPECTED_CHECKS} checks`, ran === EXPECTED_CHECKS, `ran ${ran}`);

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll unreviewed-close carriage checks passed.");
