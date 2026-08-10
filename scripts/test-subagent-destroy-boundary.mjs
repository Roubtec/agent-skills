#!/usr/bin/env node
// Renders EVERY prompt a dynamic workflow hands to a spawned subagent and
// asserts the destroy boundary is in the rendered text.
//
// Why rendering rather than reading: the boundary lives in shared constants and
// in a section one workflow embeds byte-for-byte from another, so the source
// reads as covered long before every prompt actually carries it. Three review
// rounds of task 017 each eyeballed the sources and each missed a path. A
// rendered string cannot be argued with.
//
// Two separable jobs, because in a workflow the boundary is a CONSTANT and
// every use of it is a bare `${CONSTANT}` interpolation:
//
//   PRESENCE, checked per rendered prompt, by exact string containment. Each
//   brief must carry one of the boundary constants DECLARED IN ITS OWN FILE,
//   verbatim. Nothing is re-derived from prose, so a prompt cannot pass with a
//   partial or hand-edited copy that happens to satisfy a set of phrase
//   regexes.
//
//   CONTENT, checked per boundary constant, against the clause list below.
//   Task 017's criterion is about what the constants SAY, and they say it once
//   each; asserting twelve clauses against all sixty renders re-derived the
//   same five answers sixty times over. The constants are evaluated out of the
//   same declaration prefix the builders come from, so this is the value the
//   briefs actually interpolate rather than the source text of the literal.
//
// A workflow is a runtime script, not a module: it opens with `export const
// meta` and ends in top-level `await agent(...)`. So this suite evaluates the
// DECLARATION PREFIX of each shipped file — everything up to the documented cut
// marker below, which is the file's first executable statement — inside a
// `new Function` wrapper, and calls the prompt builders out of it. That is the
// same technique `test-checkout-cleanliness-report.mjs` uses on a single
// function, widened to the whole prefix so each builder gets the helpers it
// calls (`shq`, the `cycle*` contract and block builders) for free; extracted
// alone they raise a ReferenceError instead of rendering. "Each shipped file"
// is literal rather than aspirational: the cut markers are a hand-maintained
// map, so the set of `wf-*.js` on disk is asserted to equal its keys before
// anything is evaluated — see CUT below.
//
// The set of prompt builders is DISCOVERED from the `agent(<fn>(...))` call
// sites in each source, not listed here, so a prompt path added later fails
// this suite until it is given a fixture — the failure mode the enumeration in
// task 017 kept hitting. Discovery recognizes one call shape, whitespace before
// the paren included — `agent (fn(...))` matched neither pattern until this was
// widened, so it was neither rendered nor reported and vanished from the audit
// entirely. What the suite guarantees otherwise rests on ACCOUNTING rather than
// on searching: every LITERAL `agent(` occurrence in the source must be either a
// matched call site or a prose mention on a comment line, and anything else
// fails the suite. A later unspaced `agent(p, ...)` over a variable, or an
// inline template literal, is therefore loud rather than silently unrendered;
// the spaced form is the second gap below. The accounting pattern stays literal
// where discovery does not, deliberately:
// prompt templates here write English `agent (...)` — `wf-address-review.js`'s
// ping step says so of Copilot's coding agent — which is prose rather than an
// unrecognized call, so counting it would fail the suite on the shipped
// sources. The comment exclusion is reported with its line numbers on every run
// rather than applied quietly.
//
// Two gaps that accounting cannot close, stated plainly rather than implied
// away. A NEW BRANCH INSIDE AN EXISTING BUILDER: rendering is fixture-driven,
// so a builder this suite already renders can grow a conditional whose other
// arm no fixture supplies, and its call site still looks accounted for. That is
// inherent to rendering rather than an oversight — widen the fixtures for the
// builder when it gains a branch, as `prPrompt` and `mainCheckoutStatusPrompt`
// already do below. And a SPACED CALL OVER A VARIABLE, `agent (p, ...)`: it
// names no builder for discovery to render, and the literal accounting pattern
// skips it over the space, so it passes silently where the unspaced form is
// loud. Left open deliberately — it takes both deviations at once, no such call
// exists in these sources, and letting accounting match the space would fail
// the shipped tree on the English `agent (...)` in `wf-address-review.js`'s
// ping step, which lives in a template literal rather than on a comment line.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workflows = join(root, "plugins/dev-skills/workflows");

// The first executable statement of each shipped workflow. Everything before it
// is declarations (plus `export const meta`, neutralized below). Kept as exact
// strings rather than line numbers so an edit above them cannot silently shift
// the cut; a marker that stops matching fails the suite loudly.
const CUT = {
  "wf-review-cycle.js": "\nconst structured = args &&",
  "wf-address-tasks.js": "\nconst peerMode = /",
  "wf-address-review.js": "\nconst raw = flattenArgs(args);",
};

// CUT drives the whole run, so a `wf-*.js` this map does not name would be
// evaluated by nothing and the suite would still report "0 failing" — a new
// workflow whose only prompt carried no boundary would ship green. So the
// SHIPPED SET is read off the directory and required to equal CUT's keys, in
// both directions: an unlisted file fails until it is given a cut marker
// (exactly as a new builder fails until it is given a fixture), and a key
// naming a file that no longer exists stops the run right there, naming the
// key, rather than being skipped or reaching the render loop. This is what
// lets the claim "each shipped file" be made literally.
function shippedWorkflows() {
  return readdirSync(workflows)
    .filter((f) => /^wf-.*\.js$/.test(f))
    .sort();
}

// What every boundary CONSTANT must say. Task 017's criterion is that each site
// states the PERMITTED-versus-FORBIDDEN boundary, so the permitted half is
// asserted too: a constant that lost its Permitted line would otherwise still
// pass. Each entry is one semantic clause the boundary states, matched by the
// phrase that carries it — deliberately not a byte comparison of the whole
// constant, which would turn every future wording tweak into a failure. This
// must fail when a clause is LOST. The tolerance that buys is bounded by each
// phrase rather than general: wording the phrase leaves open may change freely,
// and a rewording that moves the phrase itself reads here as a loss. Say that
// rather than "a rewording is not a failure", which is broader than any of
// these patterns delivers.
//
// The directive clause is the one place a wildcard used to span a verb: it read
// `/Empirical verification[^\n]*belongs ONLY in a disposable clone/`, which a
// NEGATED boundary satisfies — "never belongs ONLY in a disposable clone", "does
// not belong ONLY in a disposable clone" — so the suite could pass a boundary
// saying the opposite of what it must. The gap is now bounded to the qualifier
// that was narrowed last round ("that could change state", "that could mutate
// state"), with `that ... state belongs ONLY` literal around it, so the
// directive's own verb can no longer be reworded out from under the match. The
// qualifier window admits a hyphen ("that could change on-disk state") because
// excluding one narrowed the clause below its own intent while closing nothing:
// the negation the literal text fences out cannot be spelled with one.
//
// The addressing clause is the other pattern written long, for the opposite
// reason: that clause states three things at once — the positive form, the glob
// ban, and the unchecked-`cd` ban — so a copy keeping only the first would read
// as compliant while dropping the two prohibitions the incident it exists for
// actually turned on. The pattern therefore spans all three, joined by windows
// too narrow to hold a verb rather than by wildcards, and matches each
// prohibition through its own imperative, which is not something a permission
// can be spelled with. The last of them runs on through its NEGATIVE QUALIFIER
// as well, because there the imperative alone does not carry the clause: what
// separates the banned form from the guarded one is "you have not checked", and
// a match stopping at "whose success" is equally satisfied by an inverted
// qualifier ("whose success you have checked") that bans the guarded form and
// leaves the unchecked one free, or by one dismissing the check outright
// ("whose success need not be checked").
const REQUIRED = [
  ["permitted set", /Permitted: reading, searching,[^\n]*read-only `git`\/`gh` queries/],
  ["forbidden set", /`rm -rf`, `git reset --hard`, `git clean`, `git branch -f`, `git update-ref`, `git gc`/],
  ["force-pushing forbidden", /and force-pushing/],
  ["exact-command / named-skill carve-out", /whether as an exact command or as a skill it names to invoke/],
  ['"not in a clone" qualifier', /NOT in a clone, NOT in a temp directory, NOT "safely"/],
  ["exemptions are granted, not self-selected", /the only exemptions — and only because this assignment names them/],
  ["worktree is not a blast radius", /A worktree is not a blast radius/],
  ["shared `.git` reaches every sibling worktree", /reach every sibling worktree through the shared `\.git`/],
  ["a repository is addressed by path", /Address any repository other than [^\n]{0,40}BY PATH: `git -C <absolute path>`[^\n]{0,40}NEVER derive a working directory from a glob[^\n]{0,40}NEVER chain a state-changing git command after a `cd` whose success you have not checked/],
  ["empirical verification is clone-only", /Empirical verification that [a-z -]+ state belongs ONLY in a disposable clone/],
  ["disposable-clone destination", /command -v dc-enter/],
  ["absolute-path fallback", /absolute path outside the repository — never a relative one/],
];

// Every `agent(<fn>(...))` in the file — the complete set of prompt paths — plus
// an accounting of every OTHER literal `agent(` occurrence, so an unrecognized
// call shape reads as a failure rather than as an absence of call sites. Comment
// lines are the one excluded kind (these sources discuss `agent()` in prose),
// and the caller reports that exclusion with its lines rather than dropping it
// silently.
function promptBuilders(src) {
  const lines = src.split("\n");
  const sites = new Set();
  const found = new Set();
  for (const m of src.matchAll(/\bagent\s*\(\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
    found.add(m[1]);
    sites.add(m.index);
  }
  const prose = [];
  const unaccounted = [];
  for (const m of src.matchAll(/\bagent\(/g)) {
    if (sites.has(m.index)) continue;
    const line = src.slice(0, m.index).split("\n").length;
    (/^\s*(?:\/\/|\*|\/\*)/.test(lines[line - 1]) ? prose : unaccounted).push(line);
  }
  return { names: [...found].sort(), sites: sites.size, prose, unaccounted };
}

// Every top-level boundary constant the file declares — `DESTROY_BOUNDARY` for
// a workflow's own briefs, `CYCLE_DESTROY_BOUNDARY` for the review-cycle-core
// section's four roles. Discovered rather than listed, so a third one added
// later is content-checked and becomes an accepted presence value on its own.
// A file that declares none fails: nothing it renders could then carry one.
function boundaryNames(src) {
  return [...src.matchAll(/^const (\w*DESTROY_BOUNDARY) = `/gm)].map((m) => m[1]);
}

function load(file) {
  const src = readFileSync(join(workflows, file), "utf8");
  const marker = CUT[file];
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`${file}: cut marker not found: ${JSON.stringify(marker)}`);
  const prefix = src.slice(0, at).replace(/^export const meta/m, "const meta");
  // A top-level statement starts at column 0 in these sources; an indented
  // `await` belongs to an async function declaration and never runs here. A
  // top-level one would mean the cut marker sits past the first executable
  // statement, so the prefix is no longer declarations-only.
  if (/^(?:(?:const|let|var)\b[^\n=]*=\s*)?await\b/m.test(prefix)) {
    throw new Error(`${file}: declaration prefix reaches a top-level await; the cut marker is too late`);
  }
  const { names, ...accounting } = promptBuilders(src);
  const bNames = boundaryNames(src);
  if (!bNames.length) throw new Error(`${file}: declares no top-level *DESTROY_BOUNDARY constant`);
  // `args` is the workflow's own injected parameter; a few late declarations in
  // the prefix read it. An empty string keeps them inert. Each requested name is
  // returned by an explicit reference, so a builder — or a boundary constant —
  // that is not declared in the prefix is a ReferenceError here rather than a
  // silent skip. The constants come back EVALUATED, which is exactly what the
  // briefs interpolate; the source-text identity check further down is a
  // separate question and reads the literal instead.
  const wanted = [...names, ...bNames];
  const body = `"use strict";\n${prefix}\nreturn { ${wanted.map((n) => `${n}: ${n}`).join(", ")} };`;
  const out = new Function("args", body)("");
  const fns = Object.fromEntries(names.map((n) => [n, out[n]]));
  const boundaries = bNames.map((n) => [n, out[n]]);
  return { src, names, fns, boundaries, accounting };
}

// --- Fixtures -------------------------------------------------------------
// One entry per rendered path. A discovered builder with no fixture is a
// failure, not a skip.

const task = {
  slug: "042-widget",
  branch: "task/042-widget",
  base: "main",
  path: "tasks/042-widget.md",
  content: "# 042 — Widget\n",
};

const cycleBase = {
  slug: "042-widget",
  branch: "task/042-widget",
  base: "main",
  worktree: "/w/.worktrees/c/042-widget",
  artifactType: "code",
  scope: { instructions: "Implement the task.", items: [{ id: "i1", text: "do the thing" }] },
};
// The two configurations that take different branches through cycleContract():
// a standalone run with no per-role overrides, and a batch consumer that
// overrides ALL FOUR roles (wf-address-tasks does exactly this). Every role the
// section can ask a contract for is listed, `measurer` included: with one
// missing, its brief renders the DEFAULT contract under both configurations and
// the pair is one text rendered twice rather than the two branches this pair
// exists to cover.
const cycleStandalone = { ...cycleBase, contracts: undefined };
const cycleOverridden = {
  ...cycleBase,
  contracts: {
    fixer: "## WORKTREE CONTRACT\n(consumer-supplied fixer contract)",
    reviewer: "## WORKTREE CONTRACT\n(consumer-supplied reviewer contract)",
    peer: "## WORKTREE CONTRACT\n(consumer-supplied peer contract)",
    measurer: "## WORKTREE CONTRACT\n(consumer-supplied measurer contract)",
  },
};
const fixState = { round: 2, findings: { reviewer: [{ id: "f1", text: "x" }] }, confirming: false, artifactDir: "/tmp/a", openQuestions: [] };
const reviewState = { round: 2, packet: { dispositions: [] }, artifactDir: "/tmp/a" };
const peerState = { round: 2, packet: { dispositions: [] } };
// The states above all carry an artifact directory, which the fixer and
// reviewer briefs branch on — and both take the empty branch in a real run:
// round 1 has not created the directory yet, and wf-address-tasks's collision
// re-review calls the reviewer builder outside any cycle with `artifactDir: ""`.
// That is the "new branch inside an existing builder" gap the header names, so
// each is rendered rather than argued to be the same text.
const closeOutState = { passBase: "abc1234", edits: ["typo in a comment"], fixes: [{ finding: "the comment misspells the field name", detail: "reworded it" }] };
// The record-only check is handed a range and nothing else — deliberately no
// list of what the pass says is in it (see the builder), so this state is the
// whole input.
const recordOnlyState = { passBase: "abc1234" };
// The packet measurement is handed the pass ORDINAL and nothing else, for the
// record-only check's reason carried one step further: it is told nothing about
// the pass whose worktree it measures, because the pass's `clean` self-report
// is the very claim it exists to check independently.
const packetCheckState = { pass: 2 };
const fixStateRound1 = { ...fixState, round: 1, findings: null, artifactDir: "" };
const reviewStateNoArtifact = { ...reviewState, round: 1, artifactDir: "" };

// Locked-decision deviations reach two delivery builders — `prPrompt` and
// `publishPrompt` — and each branches twice over them: standing deviations with
// the reviewing round's assessments, and standing deviations the cycle recorded
// none for. Four arms, so four renders; the same "new branch inside an existing
// builder" gap, closed the same way.
const deviations = ["Delivered a polling loop instead of the locked webhook: the webhook endpoint is not reachable from CI."];
const deviationAssessments = [
  { deviation: deviations[0], inSpecRoute: "None — the locked route needs an endpoint this environment cannot expose.", recommendation: "RATIFY — conforming would block the release on an infrastructure change." },
];
const publishPacket = { pr: { number: 42, url: "https://example.invalid/pr/42", branch: "b", workingBranch: "b", base: "main", headOid: "deadbeef", rebased: false }, items: [] };
const publishPacketWorktree = { ...publishPacket, pr: { ...publishPacket.pr, locationMode: "worktree", worktree: "/w/.worktrees/c/pr-42" } };

// The cycle briefs, each rendered under BOTH configurations, because
// cycleContract() branches on whether the consumer overrode the role.
const cycleCases = {
  cycleFixPrompt: [
    ["cycleFixPrompt (standalone)", (f) => f.cycleFixPrompt(cycleStandalone, fixState)],
    ["cycleFixPrompt (batch/overridden)", (f) => f.cycleFixPrompt(cycleOverridden, fixState)],
    ["cycleFixPrompt (round 1, no artifact directory yet)", (f) => f.cycleFixPrompt(cycleOverridden, fixStateRound1)],
  ],
  cycleReviewPrompt: [
    ["cycleReviewPrompt (standalone)", (f) => f.cycleReviewPrompt(cycleStandalone, reviewState)],
    ["cycleReviewPrompt (batch/overridden)", (f) => f.cycleReviewPrompt(cycleOverridden, reviewState)],
    ["cycleReviewPrompt (no artifact directory — collision re-review)", (f) => f.cycleReviewPrompt(cycleOverridden, reviewStateNoArtifact)],
  ],
  cyclePeerPrompt: [
    ["cyclePeerPrompt (standalone)", (f) => f.cyclePeerPrompt(cycleStandalone, peerState)],
    ["cyclePeerPrompt (batch/overridden)", (f) => f.cyclePeerPrompt(cycleOverridden, peerState)],
  ],
  cycleGroundingPrompt: [
    ["cycleGroundingPrompt (standalone)", (f) => f.cycleGroundingPrompt(cycleStandalone, [{ id: "p1", text: "y", severity: "minor" }])],
    ["cycleGroundingPrompt (batch/overridden)", (f) => f.cycleGroundingPrompt(cycleOverridden, [{ id: "p1", text: "y", severity: "minor" }])],
  ],
  cycleCloseOutPrompt: [
    ["cycleCloseOutPrompt (standalone)", (f) => f.cycleCloseOutPrompt(cycleStandalone, closeOutState)],
    ["cycleCloseOutPrompt (batch/overridden)", (f) => f.cycleCloseOutPrompt(cycleOverridden, closeOutState)],
  ],
  cycleRecordOnlyPrompt: [
    ["cycleRecordOnlyPrompt (standalone)", (f) => f.cycleRecordOnlyPrompt(cycleStandalone, recordOnlyState)],
    ["cycleRecordOnlyPrompt (batch/overridden)", (f) => f.cycleRecordOnlyPrompt(cycleOverridden, recordOnlyState)],
  ],
  cyclePacketCheckPrompt: [
    ["cyclePacketCheckPrompt (standalone)", (f) => f.cyclePacketCheckPrompt(cycleStandalone, packetCheckState)],
    ["cyclePacketCheckPrompt (batch/overridden)", (f) => f.cyclePacketCheckPrompt(cycleOverridden, packetCheckState)],
  ],
};

const FIXTURES = {
  "wf-review-cycle.js": {
    ...cycleCases,
    scopePrompt: [["scopePrompt", (f) => f.scopePrompt("review the current change")]],
  },
  "wf-address-tasks.js": {
    ...cycleCases,
    bootstrapPrompt: [["bootstrapPrompt", (f) => f.bootstrapPrompt()]],
    storageProbePrompt: [["storageProbePrompt", (f) => f.storageProbePrompt(".worktrees")]],
    mainCheckoutStatusPrompt: [
      ["mainCheckoutStatusPrompt (baseline)", (f) => f.mainCheckoutStatusPrompt("pre-batch baseline")],
      ["mainCheckoutStatusPrompt (post-batch)", (f) => f.mainCheckoutStatusPrompt("post-batch")],
    ],
    resolvePrompt: [["resolvePrompt", (f) => f.resolvePrompt("tasks/*.md")]],
    prPrompt: [
      ["prPrompt (remote)", (f) => f.prPrompt(task, { notes: "caveat", deviations: [] }, true)],
      ["prPrompt (remote, record-only close)", (f) => f.prPrompt(task, { notes: "caveat", deviations: [], recordOnly: { pass: 2, range: "a..b", verified: "only the flake task", note: "the payments suite failed on the base too" } }, true)],
      ["prPrompt (no remote)", (f) => f.prPrompt(task, { notes: "", deviations: [] }, false)],
      ["prPrompt (remote, deviation + assessment)", (f) => f.prPrompt(task, { notes: "caveat", deviations, deviationAssessments }, true)],
      ["prPrompt (remote, deviation, cycle recorded no assessment)", (f) => f.prPrompt(task, { notes: "", deviations, deviationAssessments: [] }, true)],
    ],
    cleanupNote: [["cleanupNote", (f) => f.cleanupNote(task)]],
    collisionScanPrompt: [["collisionScanPrompt", (f) => f.collisionScanPrompt([{ slug: task.slug, branch: task.branch, base: task.base }])]],
    resolveCollisionsPrompt: [
      ["resolveCollisionsPrompt (remote)", (f) => f.resolveCollisionsPrompt([task], [{ kind: "path", name: "src/a.ts", branches: [task.branch, "task/043-x"] }], true)],
      ["resolveCollisionsPrompt (no remote)", (f) => f.resolveCollisionsPrompt([task], [{ kind: "path", name: "src/a.ts", branches: [task.branch, "task/043-x"] }], false)],
    ],
    collisionReReviewPrompt: [
      ["collisionReReviewPrompt (remote)", (f) => f.collisionReReviewPrompt(task, true, "on")],
      ["collisionReReviewPrompt (no remote)", (f) => f.collisionReReviewPrompt(task, false, "on")],
      ["collisionReReviewPrompt (standing deviation)", (f) => f.collisionReReviewPrompt(task, true, "on", deviations)],
    ],
  },
  "wf-address-review.js": {
    gatherPrompt: [["gatherPrompt", (f) => f.gatherPrompt("#42 push")]],
    publishPrompt: [
      ["publishPrompt", (f) => f.publishPrompt(publishPacket, [], { push: true, pingCodex: false })],
      ["publishPrompt (deviation + assessment)", (f) => f.publishPrompt(publishPacket, [], { push: true, pingCodex: false }, deviations, deviationAssessments)],
      ["publishPrompt (deviation, cycle recorded no assessment)", (f) => f.publishPrompt(publishPacket, [], { push: true, pingCodex: false }, deviations, [])],
      ["publishPrompt (record-only close)", (f) => f.publishPrompt(publishPacket, [], { push: true, pingCodex: false }, [], [], { pass: 2, range: "a..b", verified: "only the flake task", note: "the payments suite failed on the base too" })],
      // The publisher's working-location contract branches on whether this run
      // attached a worktree, and the worktree arm is the one that also tells it
      // to keep off the main checkout — the "new branch inside an existing
      // builder" gap again, closed the same way.
      ["publishPrompt (worktree mode)", (f) => f.publishPrompt(publishPacketWorktree, [], { push: true, pingCodex: false })],
    ],
    // The delegated rebase brief branches twice: on WHICH of the run's two
    // points it is (the purpose paragraph and the validation wording), and on
    // whether the run attached a worktree (the location contract, the arm that
    // also tells it to keep off the main checkout). Same "new branch inside an
    // existing builder" gap the comments above name, closed the same way.
    rebasePrompt: [
      ["rebasePrompt (pre-fix, inline)", (f) => f.rebasePrompt("pre-fix", publishPacket, "main")],
      ["rebasePrompt (pre-push, inline)", (f) => f.rebasePrompt("pre-push", publishPacket, "main")],
      ["rebasePrompt (pre-fix, worktree mode)", (f) => f.rebasePrompt("pre-fix", publishPacketWorktree, "abc1234def5678")],
    ],
    reclaimPrompt: [["reclaimPrompt", (f) => f.reclaimPrompt("/w/.worktrees/c/pr-42", 42, "publication completed")]],
  },
};

// --- Run ------------------------------------------------------------------

let failures = 0;
let rendered = 0;
let clauseChecks = 0;
const rows = [];

// Printing is a function so the workflow-set check below can report and stop.
// A CUT key naming a file that is gone must not fall through to the render
// loop: `load()` reaches it first and dies with a raw ENOENT, which fails the
// run but discards the diagnostic row that says which key it was.
function report() {
  const w = (i) => Math.max(...rows.map((r) => r[i].length));
  const widths = [w(0), w(1), w(2)];
  for (const r of rows) {
    console.log(`${r[0].padEnd(widths[0])}  ${r[1].padEnd(widths[1])}  ${r[2].padEnd(widths[2])}  ${r[3]}`);
  }
  // "Accounted for" is the CUT keys whose file is actually shipped, not the key
  // count: on the vanished path one key names a file that is gone, and counting
  // it would contradict the row directly above that says exactly that.
  const accountedFor = Object.keys(CUT).filter((f) => shipped.includes(f)).length;
  console.log(`\n${rendered} rendered prompt paths across ${accountedFor} accounted-for workflows, ${clauseChecks} boundary constants clause-checked, ${failures} failing.`);
  if (failures) process.exit(1);
}

const shipped = shippedWorkflows();
const listed = Object.keys(CUT).sort();
const unlisted = shipped.filter((f) => !listed.includes(f));
const vanished = listed.filter((f) => !shipped.includes(f));
if (unlisted.length || vanished.length) {
  failures++;
  const why = [
    unlisted.length ? `shipped but not in CUT: ${unlisted.join(", ")} — add its cut marker and fixtures` : "",
    vanished.length ? `in CUT but not shipped: ${vanished.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  rows.push(["(all)", "workflow set", "FAIL", why]);
  // Only the vanished direction is fatal to the rest of the run; an unlisted
  // file leaves every CUT key resolvable, so that half still reports in full.
  if (vanished.length) report();
} else {
  rows.push(["(all)", "workflow set", "ok", `${shipped.length} shipped wf-*.js all accounted for: ${shipped.join(", ")}`]);
}

for (const file of Object.keys(CUT)) {
  const { names, fns, boundaries, accounting } = load(file);
  const fixtures = FIXTURES[file] || {};
  const { sites, prose, unaccounted } = accounting;
  if (unaccounted.length) {
    failures++;
    rows.push([file, "agent( accounting", "FAIL", `unrecognized agent( call shape at line ${unaccounted.join(", ")} — discovery renders nothing for it`]);
  } else {
    const excluded = prose.length ? ` (line ${prose.join(", ")})` : "";
    rows.push([file, "agent( accounting", "ok", `${sites} call sites; ${prose.length} prose mention(s) in comments excluded${excluded}`]);
  }
  // CONTENT: the clauses, once per constant this file declares.
  for (const [bName, text] of boundaries) {
    clauseChecks++;
    const missing = REQUIRED.filter(([, re]) => !re.test(text)).map(([what]) => what);
    if (missing.length) {
      failures++;
      rows.push([file, `${bName} (clauses)`, "FAIL", `missing: ${missing.join("; ")}`]);
    } else {
      rows.push([file, `${bName} (clauses)`, "ok", `all ${REQUIRED.length} clauses, ${Buffer.byteLength(text)} bytes`]);
    }
  }
  for (const name of names) {
    if (!fixtures[name]) {
      failures++;
      rows.push([file, `${name} (NO FIXTURE)`, "FAIL", "reaches agent() but this suite renders no case for it"]);
      continue;
    }
    for (const [label, render] of fixtures[name]) {
      rendered++;
      let text;
      try {
        text = render(fns);
      } catch (err) {
        failures++;
        rows.push([file, label, "FAIL", `render threw: ${err.message}`]);
        continue;
      }
      // PRESENCE: exact containment of one of this file's own constants. Every
      // boundary use in these sources is a bare `${CONSTANT}` interpolation, so
      // a rendered brief carries the constant verbatim or does not carry it.
      const carried = boundaries.find(([, b]) => text.includes(b));
      if (!carried) {
        failures++;
        rows.push([file, label, "FAIL", `no boundary: carries none of ${boundaries.map(([n]) => n).join(", ")} verbatim`]);
      } else {
        rows.push([file, label, "ok", `${text.length} chars, carries ${carried[0]}`]);
      }
    }
  }
  // A fixture naming a builder that no longer reaches agent() is stale.
  for (const name of Object.keys(fixtures)) {
    if (!names.includes(name)) {
      failures++;
      rows.push([file, `${name} (STALE FIXTURE)`, "FAIL", "no agent() call site renders this builder any more"]);
    }
  }
}

// The three out-of-section `DESTROY_BOUNDARY` constants are maintained as
// byte-identical copies, and two of them SAY SO in prose beside themselves; the
// clause regexes above match each independently and would pass a drifted copy,
// so the comments' claim is checked here rather than trusted. The two in-section
// `CYCLE_DESTROY_BOUNDARY` copies are not rechecked: the `review-cycle-core`
// awk/diff byte-identity check already covers the whole section holding them.
const copies = Object.keys(CUT).map((file) => [
  file,
  (readFileSync(join(workflows, file), "utf8").match(/^const DESTROY_BOUNDARY = `((?:\\.|[^`\\])*)`;$/m) || [])[1],
]);
const drifted = copies.filter(([, text]) => text !== copies[0][1]).map(([file]) => file);
const missing = copies.filter(([, text]) => text === undefined).map(([file]) => file);
if (missing.length || drifted.length) {
  failures++;
  const why = missing.length ? `no top-level \`const DESTROY_BOUNDARY\` in ${missing.join(", ")}` : `copies differ: ${copies[0][0]} vs ${drifted.join(", ")}`;
  rows.push(["(all)", "DESTROY_BOUNDARY identity", "FAIL", why]);
} else {
  rows.push(["(all)", "DESTROY_BOUNDARY identity", "ok", `${copies.length} copies byte-identical, ${Buffer.byteLength(copies[0][1])} bytes each`]);
}

// The same question for the finish-in-turn rule, which now exists twice over:
// `CYCLE_FINISH_IN_TURN` inside the mirrored `review-cycle-core` section binds
// the cycle's roles, and each workflow that also briefs deputies of its own
// out here declares `DEPUTY_FINISH_IN_TURN` for them, because out-of-section
// code does not reach into the section. Two spellings of one rule are two
// rules the moment one is edited, so the canonical text is read from
// `wf-review-cycle.js` — the section's source — and every deputy copy must
// match it exactly. A file declaring no deputy copy simply has no deputies;
// that is not a failure. A file declaring one that no longer matches is — and
// so is a file whose prompts interpolate `${DEPUTY_FINISH_IN_TURN}` while the
// declaration pattern below finds nothing to compare, since "has no deputies"
// and "declares its copy in a shape this check cannot read" are the same
// silence otherwise, and the second one would exempt exactly the file the
// check exists for. The `DESTROY_BOUNDARY` check above fails closed on a
// missing declaration because every workflow must carry one; this one cannot,
// so the interpolation is what says a declaration was owed.
const rule = (file, name) =>
  (readFileSync(join(workflows, file), "utf8").match(new RegExp(`^const ${name} = ("(?:\\\\.|[^"\\\\])*");$`, "m")) || [])[1];
const canonicalRule = rule("wf-review-cycle.js", "CYCLE_FINISH_IN_TURN");
const deputyRuleReads = shippedWorkflows().map((file) => [file, rule(file, "DEPUTY_FINISH_IN_TURN")]);
const deputyRules = deputyRuleReads.filter(([, text]) => text !== undefined);
const unreadableDeputyRules = deputyRuleReads
  .filter(([file, text]) => text === undefined && readFileSync(join(workflows, file), "utf8").includes("${DEPUTY_FINISH_IN_TURN}"))
  .map(([file]) => file);
if (!canonicalRule) {
  failures++;
  rows.push(["(all)", "FINISH_IN_TURN identity", "FAIL", "no top-level `const CYCLE_FINISH_IN_TURN` in wf-review-cycle.js"]);
} else if (unreadableDeputyRules.length) {
  failures++;
  rows.push(["(all)", "FINISH_IN_TURN identity", "FAIL", `interpolates \`\${DEPUTY_FINISH_IN_TURN}\` but declares no readable top-level \`const DEPUTY_FINISH_IN_TURN = "…";\`: ${unreadableDeputyRules.join(", ")}`]);
} else {
  const ruleDrifted = deputyRules.filter(([, text]) => text !== canonicalRule).map(([file]) => file);
  if (ruleDrifted.length) {
    failures++;
    rows.push(["(all)", "FINISH_IN_TURN identity", "FAIL", `DEPUTY_FINISH_IN_TURN differs from the cycle's rule in ${ruleDrifted.join(", ")}`]);
  } else {
    rows.push(["(all)", "FINISH_IN_TURN identity", "ok", `${deputyRules.length} deputy copy(ies) match the cycle's rule`]);
  }
}

report();
