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
// A workflow is a runtime script, not a module: it opens with `export const
// meta` and ends in top-level `await agent(...)`. So this suite evaluates the
// DECLARATION PREFIX of each shipped file — everything up to the documented cut
// marker below, which is the file's first executable statement — inside a
// `new Function` wrapper, and calls the prompt builders out of it. That is the
// same technique `test-checkout-cleanliness-report.mjs` uses on a single
// function, widened to the whole prefix so each builder gets the helpers it
// calls (`shq`, the `cycle*` contract and block builders) for free; extracted
// alone they raise a ReferenceError instead of rendering.
//
// The set of prompt builders is DISCOVERED from the `agent(<fn>(...))` call
// sites in each source, not listed here, so a prompt path added later fails
// this suite until it is given a fixture — the failure mode the enumeration in
// task 017 kept hitting.

import { readFileSync } from "node:fs";
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

// What every rendered prompt must contain. The three clauses task 017 item 5
// names: the forbidden set with its self-authorization qualifier, the
// worktree-is-not-the-repository line, and a named destination for empirical
// verification.
const REQUIRED = [
  ['forbidden set', /`rm -rf`, `git reset --hard`, `git clean`, `git branch -f`, `git update-ref`, `git gc`/],
  ['"not in a clone" qualifier', /NOT in a clone, NOT in a temp directory, NOT "safely"/],
  ["worktree is not a blast radius", /A worktree is not a blast radius/],
  ["disposable-clone destination", /command -v dc-enter/],
  ["absolute-path fallback", /absolute path outside the repository — never a relative one/],
];

// Every `agent(<fn>(...))` in the file — the complete set of prompt paths.
function promptBuilders(src) {
  const found = new Set();
  for (const m of src.matchAll(/\bagent\(\s*([A-Za-z_$][\w$]*)\s*\(/g)) found.add(m[1]);
  return [...found].sort();
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
  const names = promptBuilders(src);
  // `args` is the workflow's own injected parameter; a few late declarations in
  // the prefix read it. An empty string keeps them inert. Each requested name is
  // returned by an explicit reference, so a builder that is not declared in the
  // prefix is a ReferenceError here rather than a silent skip.
  const body = `"use strict";\n${prefix}\nreturn { ${names.map((n) => `${n}: ${n}`).join(", ")} };`;
  const fns = new Function("args", body)("");
  return { src, names, fns };
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
// overrides ALL THREE roles (wf-address-tasks does exactly this).
const cycleStandalone = { ...cycleBase, contracts: undefined };
const cycleOverridden = {
  ...cycleBase,
  contracts: {
    fixer: "## WORKTREE CONTRACT\n(consumer-supplied fixer contract)",
    reviewer: "## WORKTREE CONTRACT\n(consumer-supplied reviewer contract)",
    peer: "## WORKTREE CONTRACT\n(consumer-supplied peer contract)",
  },
};
const fixState = { round: 2, findings: { reviewer: [{ id: "f1", text: "x" }] }, confirming: false, artifactDir: "/tmp/a", openQuestions: [] };
const reviewState = { round: 2, packet: { dispositions: [] }, artifactDir: "/tmp/a" };
const peerState = { round: 2, packet: { dispositions: [] } };

// The cycle briefs, each rendered under BOTH configurations, because
// cycleContract() branches on whether the consumer overrode the role.
const cycleCases = {
  cycleFixPrompt: [
    ["cycleFixPrompt (standalone)", (f) => f.cycleFixPrompt(cycleStandalone, fixState)],
    ["cycleFixPrompt (batch/overridden)", (f) => f.cycleFixPrompt(cycleOverridden, fixState)],
  ],
  cycleReviewPrompt: [
    ["cycleReviewPrompt (standalone)", (f) => f.cycleReviewPrompt(cycleStandalone, reviewState)],
    ["cycleReviewPrompt (batch/overridden)", (f) => f.cycleReviewPrompt(cycleOverridden, reviewState)],
  ],
  cyclePeerPrompt: [
    ["cyclePeerPrompt (standalone)", (f) => f.cyclePeerPrompt(cycleStandalone, peerState)],
    ["cyclePeerPrompt (batch/overridden)", (f) => f.cyclePeerPrompt(cycleOverridden, peerState)],
  ],
  cycleGroundingPrompt: [
    ["cycleGroundingPrompt (standalone)", (f) => f.cycleGroundingPrompt(cycleStandalone, [{ id: "p1", text: "y", severity: "minor" }])],
    ["cycleGroundingPrompt (batch/overridden)", (f) => f.cycleGroundingPrompt(cycleOverridden, [{ id: "p1", text: "y", severity: "minor" }])],
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
      ["prPrompt (remote)", (f) => f.prPrompt(task, "caveat", true)],
      ["prPrompt (no remote)", (f) => f.prPrompt(task, "", false)],
    ],
    cleanupNote: [["cleanupNote", (f) => f.cleanupNote(task)]],
    collisionScanPrompt: [["collisionScanPrompt", (f) => f.collisionScanPrompt([{ slug: task.slug, branch: task.branch, base: task.base }])]],
    resolveCollisionsPrompt: [
      ["resolveCollisionsPrompt (remote)", (f) => f.resolveCollisionsPrompt([task], [{ kind: "path", name: "src/a.ts", branches: [task.branch, "task/043-x"] }], true)],
      ["resolveCollisionsPrompt (no remote)", (f) => f.resolveCollisionsPrompt([task], [{ kind: "path", name: "src/a.ts", branches: [task.branch, "task/043-x"] }], false)],
    ],
  },
  "wf-address-review.js": {
    gatherPrompt: [["gatherPrompt", (f) => f.gatherPrompt("#42 push")]],
    publishPrompt: [
      [
        "publishPrompt",
        (f) =>
          f.publishPrompt(
            { pr: { number: 42, url: "https://example.invalid/pr/42", branch: "b", workingBranch: "b", base: "main", headOid: "deadbeef", rebased: false }, items: [] },
            [],
            { push: true, pingCodex: false }
          ),
      ],
    ],
  },
};

// --- Run ------------------------------------------------------------------

let failures = 0;
const rows = [];

for (const file of Object.keys(CUT)) {
  const { src, names, fns } = load(file);
  const fixtures = FIXTURES[file] || {};
  for (const name of names) {
    if (!fixtures[name]) {
      failures++;
      rows.push([file, `${name} (NO FIXTURE)`, "FAIL", "reaches agent() but this suite renders no case for it"]);
      continue;
    }
    for (const [label, render] of fixtures[name]) {
      let text;
      try {
        text = render(fns);
      } catch (err) {
        failures++;
        rows.push([file, label, "FAIL", `render threw: ${err.message}`]);
        continue;
      }
      const missing = REQUIRED.filter(([, re]) => !re.test(text)).map(([what]) => what);
      if (missing.length) {
        failures++;
        rows.push([file, label, "FAIL", `missing: ${missing.join("; ")}`]);
      } else {
        rows.push([file, label, "ok", `${text.length} chars`]);
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

const w = (i) => Math.max(...rows.map((r) => r[i].length));
const widths = [w(0), w(1), w(2)];
for (const r of rows) {
  console.log(`${r[0].padEnd(widths[0])}  ${r[1].padEnd(widths[1])}  ${r[2].padEnd(widths[2])}  ${r[3]}`);
}
console.log(`\n${rows.length} rendered prompt paths, ${failures} failing.`);
if (failures) process.exit(1);
