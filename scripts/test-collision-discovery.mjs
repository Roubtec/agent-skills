#!/usr/bin/env node
// Behavior suite for wf-address-tasks.js's discovery-stage collision partition.
// It evaluates the shipped declaration prefix and drives its actual
// `discoverWaveCollisions` helper; no second copy of the partition lives here.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const workflowPath = join(here, "..", "plugins", "dev-skills", "workflows", "wf-address-tasks.js");
const src = readFileSync(workflowPath, "utf8");
const CUT = "\nconst peerMode = /";

let failures = 0;
let ok = 0;
function check(name, cond, detail) {
  if (cond) {
    ok++;
    console.log(`ok  - ${name}`);
  } else {
    failures++;
    console.error(`NOT ok - ${name}${detail ? `: ${detail}` : ""}`);
  }
}

const EXPECTED_CHECKS = 50;

function loadDiscovery(agent, events) {
  const at = src.indexOf(CUT);
  if (at < 0) throw new Error(`cut marker not found: ${JSON.stringify(CUT)}`);
  const prefix = src.slice(0, at).replace(/^export const meta/m, "const meta");
  // eslint-disable-next-line no-new-func
  return new Function(
    "args",
    "agent",
    "phase",
    "log",
    "parallel",
    `"use strict";\n${prefix}\nreturn discoverWaveCollisions;`,
  )("", agent, (message) => events.push({ type: "phase", message }), (message) => events.push({ type: "log", message }), async (fns) => Promise.all(fns.map((f) => f())));
}

const mkTask = (slug) => ({ slug, branch: `task/${slug}`, base: "main", path: `tasks/${slug}.md`, content: `# ${slug}\n` });
const mkReady = (slug) => ({
  task: mkTask(slug),
  result: { slug, branch: `task/${slug}`, status: "ready", notes: "cycle notes", rounds: 2, openQuestions: [], deviations: [], peerRounds: 1, artifactDir: "/tmp/art" },
});
const mkTaskWithBranch = (slug, branch) => ({ slug, branch, base: "main", path: `tasks/${slug}.md`, content: `# ${slug}\n` });
const mkReadyWithBranch = (slug, branch) => ({
  task: mkTaskWithBranch(slug, branch),
  result: { slug, branch, status: "ready", notes: "cycle notes", rounds: 2, openQuestions: [], deviations: [], peerRounds: 1, artifactDir: "/tmp/art" },
});
const clash = (branches, name = "src/shared.ts") => ({ kind: "path", name, branches, detail: `both add ${name} — rename one side` });
const slugs = (entries) => entries.map((entry) => (entry.task ? entry.task.slug : entry.slug)).sort();

async function run(ready, scan) {
  const calls = [];
  const events = [];
  const discover = loadDiscovery(async (prompt, opts) => {
    calls.push({ prompt, label: opts && opts.label, schema: opts && opts.schema });
    return scan;
  }, events);
  const out = await discover({ ready, wave: 1, defaultBase: "main" });
  return { ...out, calls, events };
}

const wellFormed = await run(
  [mkReady("a"), mkReady("b"), mkReady("c")],
  { collisions: [clash(["task/a", "task/b"])] },
);
check("well-formed clash → exactly one discovery scan runs", wellFormed.calls.length === 1 && wellFormed.calls[0].label === "collision-scan:w1", JSON.stringify(wellFormed.calls.map((call) => call.label)));
check("well-formed clash → both named branches route to resolution", JSON.stringify(slugs(wellFormed.heldTasks)) === JSON.stringify(["a", "b"]), JSON.stringify(slugs(wellFormed.heldTasks)));
check("well-formed clash → the clean branch stays deliverable", JSON.stringify(slugs(wellFormed.deliverable)) === JSON.stringify(["c"]), JSON.stringify(slugs(wellFormed.deliverable)));
check("well-formed clash → nobody is held at discovery", wellFormed.held.length === 0, JSON.stringify(wellFormed.held));
check("well-formed clash → the collision reaches resolution unchanged apart from its wave", wellFormed.waveCollisions.length === 1 && wellFormed.waveCollisions[0].name === "src/shared.ts" && wellFormed.waveCollisions[0].wave === 1);

const qualified = await run(
  [mkReady("a"), mkReady("b")],
  { collisions: [clash(["refs/heads/task/a", "heads/task/b"])] },
);
check("qualified refs → nothing is deliverable before resolution", qualified.deliverable.length === 0, JSON.stringify(slugs(qualified.deliverable)));
check("qualified refs → both branches route to resolution", JSON.stringify(slugs(qualified.heldTasks)) === JSON.stringify(["a", "b"]), JSON.stringify(slugs(qualified.heldTasks)));
check("qualified refs → the scan is usable rather than a discovery error", qualified.held.length === 0, JSON.stringify(qualified.held));
check("qualified refs → no extra agent call is added", qualified.calls.length === 1, JSON.stringify(qualified.calls.map((call) => call.label)));

const unattributable = await run(
  [mkReady("a"), mkReady("b")],
  { collisions: [clash(["origin/task/a", "origin/task/b"])] },
);
check("unattributable clash → nothing is deliverable", unattributable.deliverable.length === 0, JSON.stringify(slugs(unattributable.deliverable)));
check("unattributable clash → nothing routes to resolution", unattributable.heldTasks.length === 0, JSON.stringify(slugs(unattributable.heldTasks)));
check("unattributable clash → every reviewed branch is held", JSON.stringify(slugs(unattributable.held)) === JSON.stringify(["a", "b"]), JSON.stringify(slugs(unattributable.held)));
check("unattributable clash → hold is actionable", unattributable.held.every((held) => held.status === "collision-scan-error" && /exact branch strings/.test(held.detail) && /deconflict and re-review/.test(held.detail)), JSON.stringify(unattributable.held.map((held) => held.detail)));
check("unattributable clash → no extra agent call is added", unattributable.calls.length === 1, JSON.stringify(unattributable.calls.map((call) => call.label)));

const partlyUnattributable = await run(
  [mkReady("a"), mkReady("b"), mkReady("c")],
  { collisions: [clash(["task/a", "task/b"]), clash(["origin/task/b", "origin/task/c"], "Widget")] },
);
check("partly unattributable packet → nothing is deliverable", partlyUnattributable.deliverable.length === 0, JSON.stringify(slugs(partlyUnattributable.deliverable)));
check("partly unattributable packet → nothing routes to resolution", partlyUnattributable.heldTasks.length === 0, JSON.stringify(slugs(partlyUnattributable.heldTasks)));
check("partly unattributable packet → the whole reviewed wave is held", JSON.stringify(slugs(partlyUnattributable.held)) === JSON.stringify(["a", "b", "c"]), JSON.stringify(slugs(partlyUnattributable.held)));
check("partly unattributable packet → no extra agent call is added", partlyUnattributable.calls.length === 1, JSON.stringify(partlyUnattributable.calls.map((call) => call.label)));

const partlyAttributedEntry = await run(
  [mkReady("a"), mkReady("b"), mkReady("c")],
  { collisions: [clash(["task/a", "task/b", "origin/task/c"])] },
);
check("partly attributed entry → nothing is deliverable", partlyAttributedEntry.deliverable.length === 0, JSON.stringify(slugs(partlyAttributedEntry.deliverable)));
check("partly attributed entry → nothing routes to resolution", partlyAttributedEntry.heldTasks.length === 0, JSON.stringify(slugs(partlyAttributedEntry.heldTasks)));
check("partly attributed entry → the whole reviewed wave is held", JSON.stringify(slugs(partlyAttributedEntry.held)) === JSON.stringify(["a", "b", "c"]), JSON.stringify(slugs(partlyAttributedEntry.held)));
check("partly attributed entry → the foreign name is reported as an attribution failure", partlyAttributedEntry.held.every((held) => /unknown branch/.test(held.detail) && /exact branch strings/.test(held.detail)), JSON.stringify(partlyAttributedEntry.held.map((held) => held.detail)));

const oneBranch = await run(
  [mkReady("a"), mkReady("b")],
  { collisions: [clash(["task/a"])] },
);
check("one-branch clash → nothing is deliverable", oneBranch.deliverable.length === 0, JSON.stringify(slugs(oneBranch.deliverable)));
check("one-branch clash → nothing routes to resolution", oneBranch.heldTasks.length === 0, JSON.stringify(slugs(oneBranch.heldTasks)));
check("one-branch clash → every reviewed branch is held", JSON.stringify(slugs(oneBranch.held)) === JSON.stringify(["a", "b"]), JSON.stringify(slugs(oneBranch.held)));
check("one-branch clash → detail names the attribution failure", oneBranch.held.every((held) => /fewer than two reviewed branches/.test(held.detail)), JSON.stringify(oneBranch.held.map((held) => held.detail)));
check("one-branch clash → no extra agent call is added", oneBranch.calls.length === 1, JSON.stringify(oneBranch.calls.map((call) => call.label)));

// Task `a` is on branch `b`; task `b` is on branch `task/b`. A malformed
// entry naming only `b` matches TWO task entries (task a via its branch,
// task b via its slug) from a SINGLE reported branch name — the two-task
// count must not stand in for a second distinct reported branch.
const crossTaskAlias = await run(
  [mkReadyWithBranch("a", "b"), mkReadyWithBranch("b", "task/b")],
  { collisions: [clash(["b"])] },
);
check("cross-task branch/slug alias → nothing is deliverable", crossTaskAlias.deliverable.length === 0, JSON.stringify(slugs(crossTaskAlias.deliverable)));
check("cross-task branch/slug alias → nothing routes to resolution", crossTaskAlias.heldTasks.length === 0, JSON.stringify(slugs(crossTaskAlias.heldTasks)));
check("cross-task branch/slug alias → the whole reviewed wave is held", JSON.stringify(slugs(crossTaskAlias.held)) === JSON.stringify(["a", "b"]), JSON.stringify(slugs(crossTaskAlias.held)));
check("cross-task branch/slug alias → detail names the attribution failure", crossTaskAlias.held.every((held) => /fewer than two reviewed branches/.test(held.detail)), JSON.stringify(crossTaskAlias.held.map((held) => held.detail)));
check("cross-task branch/slug alias → no extra agent call is added", crossTaskAlias.calls.length === 1, JSON.stringify(crossTaskAlias.calls.map((call) => call.label)));

// Same alias shape, but the malformed entry names `b` twice with different
// raw spellings (`b` and `refs/heads/b`) that both normalize to `b`. Two
// raw entries still normalize to one distinct branch name, so this must be
// rejected the same way even though `names.length` equals the reported count.
const duplicateNormalized = await run(
  [mkReadyWithBranch("a", "b"), mkReadyWithBranch("b", "task/b")],
  { collisions: [clash(["b", "refs/heads/b"])] },
);
check("duplicate-normalized clash → nothing is deliverable", duplicateNormalized.deliverable.length === 0, JSON.stringify(slugs(duplicateNormalized.deliverable)));
check("duplicate-normalized clash → nothing routes to resolution", duplicateNormalized.heldTasks.length === 0, JSON.stringify(slugs(duplicateNormalized.heldTasks)));
check("duplicate-normalized clash → the whole reviewed wave is held", JSON.stringify(slugs(duplicateNormalized.held)) === JSON.stringify(["a", "b"]), JSON.stringify(slugs(duplicateNormalized.held)));
check("duplicate-normalized clash → detail names the attribution failure", duplicateNormalized.held.every((held) => /fewer than two reviewed branches/.test(held.detail)), JSON.stringify(duplicateNormalized.held.map((held) => held.detail)));
check("duplicate-normalized clash → no extra agent call is added", duplicateNormalized.calls.length === 1, JSON.stringify(duplicateNormalized.calls.map((call) => call.label)));

const failedScan = await run([mkReady("a"), mkReady("b")], null);
check("failed scan → nothing is deliverable", failedScan.deliverable.length === 0, JSON.stringify(slugs(failedScan.deliverable)));
check("failed scan → nothing routes to resolution", failedScan.heldTasks.length === 0, JSON.stringify(slugs(failedScan.heldTasks)));
check("failed scan → every reviewed branch is held", JSON.stringify(slugs(failedScan.held)) === JSON.stringify(["a", "b"]), JSON.stringify(slugs(failedScan.held)));
check("failed scan → the existing failure detail is preserved", failedScan.held.every((held) => held.status === "collision-scan-error" && /scan failed/.test(held.detail)), JSON.stringify(failedScan.held.map((held) => held.detail)));
check("failed scan → no extra agent call is added", failedScan.calls.length === 1, JSON.stringify(failedScan.calls.map((call) => call.label)));

const clean = await run([mkReady("a"), mkReady("b")], { collisions: [] });
check("clean scan → both branches are deliverable", JSON.stringify(slugs(clean.deliverable)) === JSON.stringify(["a", "b"]), JSON.stringify(slugs(clean.deliverable)));
check("clean scan → nothing routes to resolution", clean.heldTasks.length === 0, JSON.stringify(slugs(clean.heldTasks)));
check("clean scan → nobody is held", clean.held.length === 0, JSON.stringify(clean.held));
check("clean scan → only the existing discovery agent call runs", clean.calls.length === 1 && clean.calls[0].label === "collision-scan:w1", JSON.stringify(clean.calls.map((call) => call.label)));

const singleton = await run([mkReady("a")], undefined);
check("one reviewed branch → no discovery agent call runs", singleton.calls.length === 0, JSON.stringify(singleton.calls.map((call) => call.label)));
check("one reviewed branch → it remains deliverable", JSON.stringify(slugs(singleton.deliverable)) === JSON.stringify(["a"]), JSON.stringify(slugs(singleton.deliverable)));

const bodyStart = src.indexOf(CUT);
const body = bodyStart >= 0 ? src.slice(bodyStart) : "";
check("the batch body awaits the discovery partition", /await discoverWaveCollisions\(\{ ready, wave: w \+ 1, defaultBase: plan\.defaultBase \}\)/.test(body), "batch body");
check("the discovery output feeds settleWaveCollisions unchanged", /heldTasks: discovery\.heldTasks|const heldTasks = discovery\.heldTasks/.test(body) && /waveCollisions: collisions\.filter/.test(body), "batch body");

check("all expected assertions ran", ok + failures === EXPECTED_CHECKS, `${ok + failures} ran; expected ${EXPECTED_CHECKS}`);

if (failures) {
  console.error(`\n${failures} collision-discovery check(s) failed.`);
  process.exit(1);
}
console.log("\nAll collision-discovery checks passed.");
