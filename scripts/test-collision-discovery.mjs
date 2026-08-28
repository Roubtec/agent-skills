#!/usr/bin/env node
// Behavior suite for wf-address-tasks.js's guard-discovery partition (task
// 033's pipelined form of the pre-PR collision guard). It evaluates the shipped
// declaration prefix and drives its actual `discoverGuardCollisions` helper; no
// second copy of the partition lives here.
//
// The property it exists for: a reported clash must involve the ONE branch
// under the guard and attribute through the shared branch-name rule to a
// second holder — a delivered or reserved run-local member, or, marked
// `external`, a member of the same-number guard's comparison set that this run
// never holds (an open PR head, the base branch) — or the branch is held with a
// detail actionable enough to deconflict from. Attribution is the weak point,
// so the scenarios below drive every way it can come up short: a one-branch
// clash with no external holder, an external clash naming no holder, a clash
// among members that does not involve the branch under the guard, a foreign
// name, a cross-entry branch/slug alias, and two raw spellings that normalize
// to one branch — while fully qualified local refs are canonicalized through
// that same rule rather than counted as separate branches.
//
// The two ends are pinned as well: a well-formed clash reaches resolution
// unchanged apart from its guard stamp, and a CLEAN scan costs nothing beyond
// the one read-only scan this stage always makes — the pipelined guard scans
// even the first branch of a run, because the referenced section's remote
// members exist whether or not the run has delivered anything yet. The
// readings the scan carries beside the clashes — the numbers the branch claims
// and the delivered members whose PR has merged — ride back filtered, so the
// pipeline reserves and rebases off what the agent actually reported.
//
// Run: node scripts/test-collision-discovery.mjs

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

const EXPECTED_CHECKS = 62;

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
    `"use strict";\n${prefix}\nreturn { discoverGuardCollisions, collisionIsAttributable, guardScanPrompt };`,
  )("", agent, (message) => events.push({ type: "phase", message }), (message) => events.push({ type: "log", message }), async (fns) => Promise.all(fns.map((f) => f())));
}

const mkTask = (slug, branch = `task/${slug}`) => ({ slug, branch, base: "main", path: `tasks/${slug}.md`, content: `# ${slug}\n` });
const mkReady = (slug, branch) => ({ task: mkTask(slug, branch), result: { slug, branch: branch || `task/${slug}`, status: "ready", notes: "n", rounds: 1, openQuestions: [], deviations: [], peerRounds: 0, artifactDir: "/tmp/art" } });
const member = (slug, state = "delivered", extra = {}) => ({ slug, branch: `task/${slug}`, base: "main", state, prUrl: state === "delivered" ? `https://example.invalid/pr/${slug}` : "", ...extra });
const NAME = "src/shared.ts";
const clash = (branches, extra = {}) => ({ kind: "path", name: NAME, branches, detail: "both add it", ...extra });
const THROWS = Symbol("throws");

async function run({ ready, members = [], scan }) {
  const events = [];
  const calls = [];
  const agent = async (prompt, opts) => {
    calls.push({ label: (opts && opts.label) || "", prompt, schema: opts && opts.schema });
    if (scan === THROWS) throw new Error("scan exploded");
    return scan;
  };
  const { discoverGuardCollisions } = loadDiscovery(agent, events);
  const out = await discoverGuardCollisions({ ready, members, defaultBase: "main" });
  return { ...out, events, calls };
}

// 1. A clean scan: nothing held, the readings ride back, exactly one agent call
//    — even with no members, since the referenced section's remote members are
//    always there to compare against.
{
  const out = await run({ ready: mkReady("a"), scan: { collisions: [], taskNumbers: ["042", " 042a "], merged: [], scanComplete: true } });
  check("clean scan → the branch is not held", out.held === null);
  check("clean scan → no collisions", out.collisions.length === 0);
  check("clean scan → exactly one scan call, even for the first branch of the run", out.calls.length === 1 && out.calls[0].label === "collision-scan:a", JSON.stringify(out.calls.map((c) => c.label)));
  check("clean scan → the claimed task numbers ride back trimmed", JSON.stringify(out.readings.taskNumbers) === JSON.stringify(["042", "042a"]), JSON.stringify(out.readings.taskNumbers));
  check("clean scan → scanComplete true", out.readings.scanComplete === true);
  check("clean scan → the phase is the guard's", out.events.some((e) => e.type === "phase" && e.message === "Collision guard"));
  check("clean scan → the scan is validated by the collision schema", out.calls[0].schema && out.calls[0].schema.required.includes("collisions"));
  check("clean scan → the brief says this is the first branch", /first branch to reach the guard/.test(out.calls[0].prompt));
}

// 2. A well-formed clash against a reserved member reaches resolution unchanged
//    apart from its guard stamp; the branch is not held here (the settlement
//    decides), and the members reach the brief with their state.
{
  const c = clash(["task/a", "task/b"]);
  const out = await run({ ready: mkReady("a"), members: [member("b", "reserved"), member("c")], scan: { collisions: [c], taskNumbers: [], merged: [] } });
  check("member clash → not held by discovery", out.held === null);
  check("member clash → the clash reaches resolution stamped with the guard", out.collisions.length === 1 && out.collisions[0].name === NAME && out.collisions[0].guard === "a" && JSON.stringify(out.collisions[0].branches) === JSON.stringify(["task/a", "task/b"]));
  const p = out.calls[0].prompt;
  check("member clash → the brief lists the reserved member as RESERVED and the delivered one with its PR", /task\/b.*RESERVED/.test(p) && /task\/c.*DELIVERED[^\n]*pr\/c/.test(p), p.slice(0, 200));
  check("member clash → the brief compares by ref from the repo root and enters no worktree", /do not enter or create any worktree/.test(p) && /git diff --diff-filter=A --name-only 'main'\.\.\.'task\/a'/.test(p));
}

// 3. The external arm: the other holder is outside the run.
{
  const ext = { kind: "task-number", name: "042", branches: ["task/a"], external: true, member: "#7" };
  const out = await run({ ready: mkReady("a"), scan: { collisions: [ext], taskNumbers: ["042"], merged: [] } });
  check("external clash with a holder → usable, not held", out.held === null && out.collisions.length === 1 && out.collisions[0].external === true);
  const noHolder = await run({ ready: mkReady("a"), scan: { collisions: [{ ...ext, member: "  " }], taskNumbers: [], merged: [] } });
  check("external clash naming no holder → the branch is held", noHolder.held && noHolder.held.status === "collision-scan-error", JSON.stringify(noHolder.held));
  check("external clash naming no holder → the detail is actionable", /no second holder/.test(noHolder.held.detail) && /exact branch strings/.test(noHolder.held.detail), noHolder.held.detail);
  const notReady = await run({ ready: mkReady("a"), members: [member("b")], scan: { collisions: [{ ...ext, branches: ["task/b"] }], taskNumbers: [], merged: [] } });
  check("external clash naming a member but not the branch under the guard → held", notReady.held && notReady.held.status === "collision-scan-error");
}

// 4. Every way attribution can come up short holds the branch with the
//    scan-error detail and carries its cycle record.
{
  const cases = [
    ["one-branch clash with no external holder", [clash(["task/a"])], []],
    ["clash among members only", [clash(["task/b", "task/c"])], [member("b"), member("c")]],
    ["foreign name", [clash(["task/a", "origin/task/b"])], [member("b")]],
    ["empty branches", [clash([])], [member("b")]],
    ["two spellings of one branch", [clash(["task/a", "refs/heads/task/a"])], [member("b")]],
    ["one usable entry beside a foreign one", [clash(["task/a", "task/b"]), clash(["task/a", "ghost"])], [member("b")]],
  ];
  for (const [name, collisions, members] of cases) {
    const out = await run({ ready: mkReady("a"), members, scan: { collisions, taskNumbers: ["042"], merged: [] } });
    check(`${name} → the branch is held as collision-scan-error`, out.held && out.held.status === "collision-scan-error", JSON.stringify(out.held));
    check(`${name} → the hold carries the cycle record`, out.held && out.held.artifactDir === "/tmp/art" && out.held.rounds === 1);
    check(`${name} → the readings still ride back`, JSON.stringify(out.readings.taskNumbers) === JSON.stringify(["042"]));
  }
}

// 4b. A cross-entry branch/slug alias: task `a` on branch `b`, member `b` on
//     `task/b`. One reported string matches two entries but is one branch.
{
  const out = await run({ ready: mkReady("a", "b"), members: [member("b")], scan: { collisions: [clash(["b"])], taskNumbers: [], merged: [] } });
  check("cross-entry alias singleton → held", out.held && out.held.status === "collision-scan-error");
}

// 5. Fully qualified local refs canonicalize through the shared rule.
{
  const out = await run({ ready: mkReady("a"), members: [member("b")], scan: { collisions: [clash(["refs/heads/task/a", "heads/task/b"])], taskNumbers: [], merged: [] } });
  check("qualified refs → attributable, not held", out.held === null && out.collisions.length === 1);
}

// 6. A scan that returns nothing usable, or throws, holds the branch.
{
  for (const [name, scan] of [["scan returned nothing", null], ["scan omitted collisions", {}], ["scan returned a non-array", { collisions: "none" }], ["scan threw", THROWS]]) {
    const out = await run({ ready: mkReady("a"), scan });
    check(`${name} → held as collision-scan-error`, out.held && out.held.status === "collision-scan-error" && /scan failed/.test(out.held.detail), JSON.stringify(out.held));
    check(`${name} → the scan was attempted once`, out.calls.length === 1);
    check(`${name} → the readings are empty and incomplete`, out.readings.taskNumbers.length === 0 && out.readings.merged.length === 0 && out.readings.scanComplete === false);
  }
}

// 6b. A packet with NO `merged` reading is a failed scan, not "none merged":
//     the pipeline retargets and rebases a dependent off that reading, so an
//     omission read as an empty list would walk it onto a parent branch the
//     base has absorbed. The schema requires the key; the code holds without it.
{
  const out = await run({ ready: mkReady("a"), members: [member("b")], scan: { collisions: [], taskNumbers: ["042"] } });
  check("scan omitted merged → held as collision-scan-error", out.held && out.held.status === "collision-scan-error", JSON.stringify(out.held));
  check("scan omitted merged → the detail names the missing reading and what an omission is not", /no `merged` reading/.test(out.held.detail) && /not "none merged"/.test(out.held.detail), out.held && out.held.detail);
  check("scan omitted merged → the readings are incomplete", out.readings.merged.length === 0 && out.readings.scanComplete === false, JSON.stringify(out.readings));
  check("the scan's schema requires the merged reading beside the collisions", out.calls[0].schema && Array.isArray(out.calls[0].schema.required) && out.calls[0].schema.required.includes("merged") && out.calls[0].schema.required.includes("collisions"), JSON.stringify(out.calls[0].schema && out.calls[0].schema.required));
}

// 7. The merged reading is filtered to well-formed entries; incompleteness is
//    reported with its detail.
{
  const out = await run({ ready: mkReady("a"), members: [member("b")], scan: { collisions: [], taskNumbers: [], merged: [{ branch: "task/b", mergedInto: "main" }, null, { mergedInto: "main" }], scanComplete: false, detail: "gh unavailable" } });
  check("merged reading → only entries naming a branch survive", JSON.stringify(out.readings.merged) === JSON.stringify([{ branch: "task/b", mergedInto: "main" }]), JSON.stringify(out.readings.merged));
  check("incomplete scan → reported with its detail, the branch not held for it", out.readings.scanComplete === false && out.readings.detail === "gh unavailable" && out.held === null);
}

// 8. The brief references the same-number guard's owner and does not present
//    the run-local list as the comparison set.
{
  const events = [];
  const { guardScanPrompt, collisionIsAttributable } = loadDiscovery(async () => null, events);
  const p = guardScanPrompt({ slug: "a", branch: "task/a", base: "main" }, [member("b", "reserved")]);
  check("brief names the section that owns the comparison set", p.includes('`address-tasks-serialized` skill\'s "Task-number collisions across in-flight branches" section'));
  check("brief says that section OWNS the set and that the run-local list is NOT it", /OWNS the comparison set/.test(p) && /the run-local list above is NOT that set/.test(p));
  check("brief asks for the claimed numbers and the merged members", /`taskNumbers`/.test(p) && /`merged`/.test(p) && /gh pr view <url> --json state,mergedAt,baseRefName/.test(p));
  check("brief never asks to rename or edit anything", /Edit, stage, commit, or push NOTHING/.test(p));
  // The attribution helper directly: external needs the known branch AND a holder.
  const entries = [{ task: mkTask("a") }];
  check("attribution: external with holder", collisionIsAttributable({ branches: ["task/a"], external: true, member: "#7" }, entries));
  check("attribution: external without holder", !collisionIsAttributable({ branches: ["task/a"], external: true, member: "" }, entries));
  check("attribution: external with a foreign name is still foreign", !collisionIsAttributable({ branches: ["task/zzz"], external: true, member: "#7" }, entries));
  check("attribution: a lone name without external is not a clash", !collisionIsAttributable({ branches: ["task/a"] }, entries));
}

check(`the suite ran all ${EXPECTED_CHECKS} checks`, ok + failures === EXPECTED_CHECKS, `ran ${ok + failures}`);

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll collision-discovery checks passed.");
