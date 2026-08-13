#!/usr/bin/env node
// Behavior suite for wf-address-tasks.js's pre-PR collision dispatch —
// `settleWaveCollisions`, the stage that turns one wave's HELD branches into
// deliveries and holds after the resolver deputy has run.
//
// The property it exists for: a branch reaches delivery only when the clash has
// been RE-DERIVED from the refs after resolution, and only behind a fresh
// delivery-tier re-review of its own. The resolver reports what it renamed, and
// a rename can be reported and only partly applied — the file moved but the
// duplicate export left behind, or one branch renamed and its generated mirror
// forgotten. Believing that report let both sides open PRs carrying the very
// clash the guard exists to stop.
//
// So the resolver's packet is HOLD-ONLY evidence here, and the suite pins both
// halves of that. It can hold — by being absent, by being empty, or by refusing a
// name as imperative — and it can do nothing else. It cannot release a branch
// (the re-scan decides that) and it cannot excuse one from the re-review (every
// held branch of a cleared clash gets one), because "which branches did you
// touch" is a self-report this stage has no way to check: a resolver that renamed
// on two branches and named one would otherwise deliver the omitted branch's
// post-cycle edits unreviewed.
//
// The workflow is a runtime script (top-level await/return, injected
// `agent`/`phase`/`log` globals), so it cannot be imported. This evaluates the
// shipped file's DECLARATION PREFIX — everything up to the documented cut marker,
// where its runtime body begins — with those globals stubbed, and drives
// scripted resolver / re-scan / re-review packets through the ACTUAL shipped
// `settleWaveCollisions`. No second copy of the dispatch exists here, which is
// why the source checks at the end assert the batch body still calls it: a
// dispatch nothing calls would pass every scenario below.
//
// Run: node scripts/test-collision-dispatch.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const workflowPath = join(here, "..", "plugins", "dev-skills", "workflows", "wf-address-tasks.js");
const src = readFileSync(workflowPath, "utf8");

// Same marker the destroy-boundary suite cuts on: the file's first executable
// statement. Kept as an exact string rather than a line number so an edit above
// it cannot silently shift the cut.
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

// The suite gates on failures, so a scenario that stops running is invisible to
// it — an edit that drops one, or a guard that swallows a throw, would pass.
// Counting the oks too lets the run assert it executed the whole suite. Bump
// this deliberately when adding or removing a check; the number is the assertion.
const EXPECTED_CHECKS = 199;

async function scenario(name, fn) {
  try {
    await fn();
  } catch (err) {
    check(`${name} ran without throwing`, false, String((err && err.stack) || err));
  }
}

function loadDispatch(agent) {
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
    `"use strict";\n${prefix}\nreturn settleWaveCollisions;`,
  )("", agent, () => {}, () => {}, async (fns) => Promise.all(fns.map((f) => f())));
}

// Scripted agent. Every call is recorded with its label, prompt, and schema, so
// a scenario can assert both what ran and what did NOT. An unrecognized label
// throws rather than returning a default: a dispatch that grew a new agent stage
// must be taught here instead of silently getting `null` and holding for the
// wrong reason.
function scriptedAgent(packets, calls) {
  return async function agent(prompt, opts) {
    const label = (opts && opts.label) || "";
    calls.push({ label, prompt, schema: opts && opts.schema });
    if (label.startsWith("collision-resolve:")) return packets.resolution;
    if (label.startsWith("collision-rescan:")) {
      if (packets.rescan === THROWS) throw new Error("re-scan agent exploded");
      return packets.rescan;
    }
    if (label.startsWith("re-review:")) {
      const slug = label.slice("re-review:".length);
      const reviews = packets.reviews || {};
      return Object.prototype.hasOwnProperty.call(reviews, slug) ? reviews[slug] : PASS_REVIEW;
    }
    throw new Error(`unexpected agent label: ${label}`);
  };
}

const PASS_REVIEW = { pass: true, issues: [], notes: "rename reads clean", flakeRecord: "" };
// Scripted stand-in for an agent stage that throws rather than returning a
// packet. This repository does not establish when `agent()` throws versus
// returns null, so the dispatch must answer both the same way.
const THROWS = Symbol("agent throws");

const mkTask = (slug) => ({ slug, branch: `task/${slug}`, base: "main", path: `tasks/${slug}.md`, content: `# ${slug}\n` });
const mkHeld = (slug, extra) => ({
  task: mkTask(slug),
  result: { slug, branch: `task/${slug}`, status: "ready", notes: "cycle notes", rounds: 2, openQuestions: [], deviations: [], peerRounds: 1, artifactDir: "/tmp/art", ...extra },
});
const mkTaskWithBranch = (slug, branch) => ({ slug, branch, base: "main", path: `tasks/${slug}.md`, content: `# ${slug}\n` });
const mkHeldWithBranch = (slug, branch, extra) => ({
  task: mkTaskWithBranch(slug, branch),
  result: { slug, branch, status: "ready", notes: "cycle notes", rounds: 2, openQuestions: [], deviations: [], peerRounds: 1, artifactDir: "/tmp/art", ...extra },
});

const NAME = "src/shared.ts";
const clash = (branches, name = NAME) => ({ kind: "path", name, branches, detail: `both add ${name} — rename one side`, wave: 1 });
const RESCAN_DETAIL = "re-scan: both branches still add it";
const renamed = (changedBranches, collision = NAME) => ({ resolutions: [{ collision, action: "renamed", changedBranches, from: collision, to: "src/shared-b.ts", regenerated: "", reason: "fewer references" }] });

async function run({ held, collisions, packets }) {
  const calls = [];
  const settle = loadDispatch(scriptedAgent(packets, calls));
  const out = await settle({
    heldTasks: held,
    waveCollisions: collisions,
    wave: 1,
    defaultBase: "main",
    remote: true,
    peerMode: "off",
  });
  return { ...out, calls };
}

const slugs = (entries) => entries.map((e) => (e.task ? e.task.slug : e.slug)).sort();
const labels = (calls) => calls.map((c) => c.label);
const heldBySlug = (out, slug) => out.held.find((h) => h.slug === slug);

// 1. THE DEFECT. The resolver reports a rename with `changedBranches` set, but
//    the tree does not reflect it — the re-scan still names both sides. Neither
//    branch may deliver, and that includes the side the resolver never touched,
//    which used to deliver through the resolved-elsewhere arm with no check at
//    all.
await scenario("unreflected rename", async () => {
  const out = await run({
    held: [mkHeld("a"), mkHeld("b")],
    collisions: [clash(["task/a", "task/b"])],
    // The re-scan's own clash object, distinguishable from the discovery one it
    // is otherwise identical to, so the "carries the re-derived clash" check
    // below can tell them apart at all.
    packets: { resolution: renamed(["task/a"]), rescan: { collisions: [{ ...clash(["task/a", "task/b"]), detail: RESCAN_DETAIL }] } },
  });
  check("unreflected rename → nothing delivers", out.deliverable.length === 0, JSON.stringify(slugs(out.deliverable)));
  check("unreflected rename → both branches held", JSON.stringify(slugs(out.held)) === JSON.stringify(["a", "b"]), JSON.stringify(slugs(out.held)));
  check("unreflected rename → the RESOLVER-CHANGED side is held", heldBySlug(out, "a") && heldBySlug(out, "a").status === "collision-hold");
  check("unreflected rename → the UNTOUCHED side is held too", heldBySlug(out, "b") && heldBySlug(out, "b").status === "collision-hold");
  for (const s of ["a", "b"]) {
    const h = heldBySlug(out, s);
    check(`unreflected rename → ${s}'s detail says the clash is still in the refs`, /still in the refs/.test(h.detail), h.detail);
    check(`unreflected rename → ${s}'s detail says what to do next`, /rename enough sides/.test(h.detail) && /re-review/.test(h.detail), h.detail);
    check(`unreflected rename → ${s} carries the RE-DERIVED clash, not the discovery one`, Array.isArray(h.collisions) && h.collisions.length === 1 && h.collisions[0].name === NAME && h.collisions[0].detail === RESCAN_DETAIL, JSON.stringify(h.collisions));
    check(`unreflected rename → ${s} still carries its cycle record`, h.artifactDir === "/tmp/art" && h.rounds === 2);
  }
  check("unreflected rename → no re-review is paid for", !labels(out.calls).some((l) => l.startsWith("re-review:")), JSON.stringify(labels(out.calls)));
});

// 2. THE TOO-STRICT CONTROL. A genuinely resolved two-branch clash with a
//    correctly-reporting resolver still delivers: the re-scan comes back empty
//    and both sides deliver, each behind a fresh re-review of its own. An
//    over-tightening that held here would be a failure, not a safe default.
await scenario("resolved two-branch clash", async () => {
  const out = await run({
    held: [mkHeld("a"), mkHeld("b")],
    collisions: [clash(["task/a", "task/b"])],
    packets: { resolution: renamed(["task/a"]), rescan: { collisions: [] } },
  });
  check("resolved clash → both sides deliver", JSON.stringify(slugs(out.deliverable)) === JSON.stringify(["a", "b"]), JSON.stringify(slugs(out.deliverable)));
  check("resolved clash → nothing held", out.held.length === 0, JSON.stringify(out.held));
  check("resolved clash → EVERY held side is re-reviewed, not just the reported one", JSON.stringify(labels(out.calls).filter((l) => l.startsWith("re-review:")).sort()) === JSON.stringify(["re-review:a", "re-review:b"]), JSON.stringify(labels(out.calls)));
  const a = out.deliverable.find((d) => d.task.slug === "a");
  check("resolved clash → the re-review's notes ride to delivery", a.result.notes === "rename reads clean", JSON.stringify(a.result.notes));
  const b = out.deliverable.find((d) => d.task.slug === "b");
  check("resolved clash → the side the resolver did not name still delivers, carrying its cycle record", b.result.rounds === 2 && b.result.artifactDir === "/tmp/art", JSON.stringify(b.result));
  // Ordering: resolve, then re-scan, then any re-review. A re-review before the
  // re-scan would mean a branch was being cleared on the resolver's word.
  const order = labels(out.calls);
  check("resolved clash → resolve runs before the re-scan", order.indexOf("collision-resolve:w1") === 0 && order.indexOf("collision-rescan:w1") === 1, JSON.stringify(order));
  check("resolved clash → the re-scan runs before any re-review", order.indexOf("collision-rescan:w1") < order.indexOf("re-review:a"), JSON.stringify(order));
  const rescanCall = out.calls.find((c) => c.label === "collision-rescan:w1");
  check("resolved clash → the re-scan is the read-only discovery scan, same schema", rescanCall.schema && Array.isArray(rescanCall.schema.required) && rescanCall.schema.required.includes("collisions"));
  check("resolved clash → the re-scan is scoped to the held branches", /task\/a/.test(rescanCall.prompt) && /task\/b/.test(rescanCall.prompt));
});

// 3. 027's 3+ branch rule, now re-derived rather than computed from the packet:
//    a scan reports a value only where two or more branches still carry it, so a
//    three-way clash with one side renamed still names the other two.
await scenario("three-way clash, one side renamed", async () => {
  const out = await run({
    held: [mkHeld("a"), mkHeld("b"), mkHeld("c")],
    collisions: [clash(["task/a", "task/b", "task/c"])],
    packets: { resolution: renamed(["task/a"]), rescan: { collisions: [clash(["task/b", "task/c"])] } },
  });
  check("three-way → the renamed side delivers", JSON.stringify(slugs(out.deliverable)) === JSON.stringify(["a"]), JSON.stringify(slugs(out.deliverable)));
  check("three-way → the two still-colliding sides are held", JSON.stringify(slugs(out.held)) === JSON.stringify(["b", "c"]), JSON.stringify(slugs(out.held)));
  check("three-way → both holds are collision-hold", out.held.every((h) => h.status === "collision-hold"));
  check("three-way → the held pair's clash names exactly them", out.held.every((h) => JSON.stringify(h.collisions[0].branches) === JSON.stringify(["task/b", "task/c"])));
  // Cost control on the widened re-review: it covers the branches that DELIVER,
  // not every branch the wave held. A held branch is not about to open a PR, so
  // paying a delivery-tier reviewer over it buys nothing.
  check("three-way → only the delivering side is re-reviewed", JSON.stringify(labels(out.calls).filter((l) => l.startsWith("re-review:"))) === JSON.stringify(["re-review:a"]), JSON.stringify(labels(out.calls)));
});

// 3b. The same three-way clash with BOTH remaining sides renamed: at most one
//     branch keeps the value, the re-scan is empty, and all three deliver.
await scenario("three-way clash, enough sides renamed", async () => {
  const out = await run({
    held: [mkHeld("a"), mkHeld("b"), mkHeld("c")],
    collisions: [clash(["task/a", "task/b", "task/c"])],
    packets: { resolution: renamed(["task/a", "task/b"]), rescan: { collisions: [] } },
  });
  check("three-way resolved → all three deliver", JSON.stringify(slugs(out.deliverable)) === JSON.stringify(["a", "b", "c"]), JSON.stringify(slugs(out.deliverable)));
  check("three-way resolved → all three delivering sides are re-reviewed", JSON.stringify(labels(out.calls).filter((l) => l.startsWith("re-review:")).sort()) === JSON.stringify(["re-review:a", "re-review:b", "re-review:c"]), JSON.stringify(labels(out.calls)));
});

// 4. THE OTHER TOO-STRICT CONTROL. A wave with no collisions holds nothing and
//    spawns no agent at all — the re-verification costs only the waves that
//    actually collided, and widening who gets re-reviewed must not change that.
await scenario("no collisions", async () => {
  const out = await run({ held: [], collisions: [], packets: {} });
  check("no collisions → nothing delivered from the dispatch", out.deliverable.length === 0);
  check("no collisions → nothing held", out.held.length === 0);
  check("no collisions → zero agent calls", out.calls.length === 0, JSON.stringify(labels(out.calls)));
});

// 5. Degraded re-scan. Anything that is not a usable collision list leaves every
//    involved branch held, with a detail that says what to do next.
await scenario("degraded re-scan", async () => {
  const bad = [
    ["re-scan returned nothing", null],
    ["re-scan returned undefined", undefined],
    ["re-scan omitted collisions", {}],
    ["re-scan returned a non-array", { collisions: "none" }],
  ];
  for (const [name, rescan] of bad) {
    const out = await run({
      held: [mkHeld("a"), mkHeld("b")],
      collisions: [clash(["task/a", "task/b"])],
      packets: { resolution: renamed(["task/a"]), rescan },
    });
    check(`${name} → nothing delivers`, out.deliverable.length === 0, JSON.stringify(slugs(out.deliverable)));
    check(`${name} → both branches held`, JSON.stringify(slugs(out.held)) === JSON.stringify(["a", "b"]));
    check(`${name} → detail names the re-scan and the next step`, out.held.every((h) => /re-scan/.test(h.detail) && /by hand/.test(h.detail)), JSON.stringify(out.held.map((h) => h.detail)));
    check(`${name} → no re-review is paid for`, !labels(out.calls).some((l) => l.startsWith("re-review:")));
  }
});

// 5b. A re-scan entry this stage cannot attribute to any held branch is a clash
//     reported with no owner. Filtering it by branch name yields an empty "still
//     colliding" set for every held branch and would deliver all of them off a
//     packet that just said the clash survives — the exact inversion the guard
//     exists to prevent. The packet reads as unusable instead.
await scenario("unattributable re-scan entry", async () => {
  const out = await run({
    held: [mkHeld("a"), mkHeld("b")],
    collisions: [clash(["task/a", "task/b"])],
    packets: { resolution: renamed(["task/a"]), rescan: { collisions: [clash([])] } },
  });
  check("re-scan entry names no branches at all → nothing delivers", out.deliverable.length === 0, JSON.stringify(slugs(out.deliverable)));
  check("re-scan entry names no branches at all → both branches held", JSON.stringify(slugs(out.held)) === JSON.stringify(["a", "b"]), JSON.stringify(slugs(out.held)));
  check("re-scan entry names no branches at all → detail says the re-scan established nothing", out.held.length === 2 && out.held.every((h) => /established nothing/.test(h.detail) && /by hand/.test(h.detail)), JSON.stringify(out.held.map((h) => h.detail)));
  check("re-scan entry names no branches at all → no re-review is paid for", !labels(out.calls).some((l) => l.startsWith("re-review:")), JSON.stringify(labels(out.calls)));
});

// 5bb. Fully-qualified local refs name the same branches as their ordinary
//      branch strings. The shared attribution helper deliberately makes that
//      spelling usable at re-scan too; a packet that still reports the clash
//      therefore holds as live evidence, not as a void packet.
await scenario("fully-qualified re-scan entry", async () => {
  const out = await run({
    held: [mkHeld("a"), mkHeld("b")],
    collisions: [clash(["task/a", "task/b"])],
    packets: { resolution: renamed(["task/a"]), rescan: { collisions: [clash(["refs/heads/task/a", "heads/task/b"])] } },
  });
  check("fully-qualified re-scan entry → nothing delivers", out.deliverable.length === 0, JSON.stringify(slugs(out.deliverable)));
  check("fully-qualified re-scan entry → both branches held", JSON.stringify(slugs(out.held)) === JSON.stringify(["a", "b"]), JSON.stringify(slugs(out.held)));
  check("fully-qualified re-scan entry → detail says the clash remains in the refs", out.held.length === 2 && out.held.every((h) => /still in the refs/.test(h.detail)), JSON.stringify(out.held.map((h) => h.detail)));
  check("fully-qualified re-scan entry → no re-review is paid for", !labels(out.calls).some((l) => l.startsWith("re-review:")), JSON.stringify(labels(out.calls)));
});

// 5bc. Making a qualified name attributable deliberately changes 027a's packet
//       gate: another held branch that the usable re-scan no longer names can
//       clear. This is the shared-helper reach 027b accepts, pinned here so it
//       cannot arrive or disappear as an accidental assertion relaxation.
await scenario("fully-qualified re-scan clears another clash", async () => {
  const out = await run({
    held: [mkHeld("a"), mkHeld("b"), mkHeld("c")],
    collisions: [clash(["task/a", "task/b"]), clash(["task/b", "task/c"], "Widget")],
    packets: {
      resolution: renamed(["task/c"], "Widget"),
      rescan: { collisions: [clash(["refs/heads/task/a", "heads/task/b"])] },
    },
  });
  check("qualified packet → only the branch clear of its clash delivers", JSON.stringify(slugs(out.deliverable)) === JSON.stringify(["c"]), JSON.stringify(slugs(out.deliverable)));
  check("qualified packet → both branches still carrying the qualified clash are held", JSON.stringify(slugs(out.held)) === JSON.stringify(["a", "b"]), JSON.stringify(slugs(out.held)));
  check("qualified packet → the cleared branch receives its re-review", labels(out.calls).includes("re-review:c"), JSON.stringify(labels(out.calls)));
  check("qualified packet → still-colliding branches receive no re-review", !labels(out.calls).includes("re-review:a") && !labels(out.calls).includes("re-review:b"), JSON.stringify(labels(out.calls)));
});

// 5bd. Attributable names do not make a partly foreign entry usable. The shared
//       gate requires every reported name to belong to a held task; otherwise
//       the foreign side could deliver without ever being checked again.
await scenario("partly attributed re-scan entry", async () => {
  const out = await run({
    held: [mkHeld("a"), mkHeld("b"), mkHeld("c")],
    collisions: [clash(["task/a", "task/b", "task/c"])],
    packets: {
      resolution: renamed(["task/a"]),
      rescan: { collisions: [clash(["task/a", "task/b", "origin/task/c"])] },
    },
  });
  check("partly attributed re-scan entry → nothing delivers", out.deliverable.length === 0, JSON.stringify(slugs(out.deliverable)));
  check("partly attributed re-scan entry → all three branches are held", JSON.stringify(slugs(out.held)) === JSON.stringify(["a", "b", "c"]), JSON.stringify(slugs(out.held)));
  check("partly attributed re-scan entry → every hold says the re-scan established nothing", out.held.every((h) => /established nothing/.test(h.detail) && /attribute every named branch/.test(h.detail)), JSON.stringify(out.held.map((h) => h.detail)));
  check("partly attributed re-scan entry → no re-review is paid for", !labels(out.calls).some((l) => l.startsWith("re-review:")), JSON.stringify(labels(out.calls)));
});

// 5c. One unattributable entry voids the WHOLE packet rather than being filtered
//     out of it: the branch the packet's usable entries clear would otherwise
//     deliver on a scan that also reported a clash belonging to nobody.
await scenario("partly unattributable re-scan", async () => {
  const out = await run({
    held: [mkHeld("a"), mkHeld("b"), mkHeld("c")],
    collisions: [clash(["task/a", "task/b"]), clash(["task/b", "task/c"], "Widget")],
    packets: {
      resolution: renamed(["task/a"]),
      rescan: { collisions: [clash(["task/b", "task/c"], "Widget"), clash([], "Ghost")] },
    },
  });
  check("partly unattributable → nothing delivers", out.deliverable.length === 0, JSON.stringify(slugs(out.deliverable)));
  check("partly unattributable → all three branches held", JSON.stringify(slugs(out.held)) === JSON.stringify(["a", "b", "c"]), JSON.stringify(slugs(out.held)));
  check("partly unattributable → every hold says the re-scan established nothing", out.held.length === 3 && out.held.every((h) => /established nothing/.test(h.detail)), JSON.stringify(out.held.map((h) => h.detail)));
});

// 5d. The re-scan stage THROWS. Letting it unwind to the batch-body catch would
//     discard the deliveries this wave's uncontested branches already earned and
//     leave the held ones with no result to act on, so the throw is answered with
//     the same hold as any other unusable re-scan.
await scenario("re-scan throws", async () => {
  const out = await run({
    held: [mkHeld("a"), mkHeld("b")],
    collisions: [clash(["task/a", "task/b"])],
    packets: { resolution: renamed(["task/a"]), rescan: THROWS },
  });
  check("re-scan throws → the re-scan was actually attempted", labels(out.calls).includes("collision-rescan:w1"), JSON.stringify(labels(out.calls)));
  check("re-scan throws → nothing delivers", out.deliverable.length === 0, JSON.stringify(slugs(out.deliverable)));
  check("re-scan throws → both branches held with the re-scan detail", JSON.stringify(slugs(out.held)) === JSON.stringify(["a", "b"]) && out.held.every((h) => h.status === "collision-hold" && /established nothing/.test(h.detail) && /by hand/.test(h.detail)), JSON.stringify(out.held.map((h) => h.detail)));
  check("re-scan throws → no re-review is paid for", !labels(out.calls).some((l) => l.startsWith("re-review:")), JSON.stringify(labels(out.calls)));
});

// 5e. The narrower shape of 5b's hole, and the one that costs deliveries: a
//     three-branch clash whose re-scan malforms into a single entry naming only
//     ONE of the held branches. That entry is attributable to somebody, so a
//     "names at least one held branch" test reads the packet as usable — and the
//     two branches it does not name then have an empty still-colliding set and
//     BOTH deliver, each still carrying the value, which is 027's 3+ branch rule
//     inverted. `COLLISION_SCHEMA` calls `branches` "the two or more branches
//     that each independently added it", so a lone name is malformed by the
//     scan's own contract and is evidence about nobody.
await scenario("re-scan entry names one held branch", async () => {
  const out = await run({
    held: [mkHeld("a"), mkHeld("b"), mkHeld("c")],
    collisions: [clash(["task/a", "task/b", "task/c"])],
    packets: { resolution: renamed(["task/a"]), rescan: { collisions: [clash(["task/a"])] } },
  });
  check("one-branch re-scan entry → nothing delivers", out.deliverable.length === 0, JSON.stringify(slugs(out.deliverable)));
  check("one-branch re-scan entry → all three branches held", JSON.stringify(slugs(out.held)) === JSON.stringify(["a", "b", "c"]), JSON.stringify(slugs(out.held)));
  check("one-branch re-scan entry → every hold says the re-scan established nothing", out.held.length === 3 && out.held.every((h) => /established nothing/.test(h.detail) && /by hand/.test(h.detail)), JSON.stringify(out.held.map((h) => h.detail)));
  check("one-branch re-scan entry → no re-review is paid for", !labels(out.calls).some((l) => l.startsWith("re-review:")), JSON.stringify(labels(out.calls)));
});

// 5f. The re-scan reports a single name that happens to equal one held branch's
//     OWN name and another held branch's SLUG (task `a` on branch `b`, task `b`
//     on branch `task/b`). That one string matches two held task entries, but
//     it is still only one reported branch — `collisionIsAttributable` must
//     count distinct normalized names, not just matched tasks, or this shape
//     clears both sides on a scan that never named a second branch at all.
await scenario("re-scan entry is a cross-task branch/slug alias", async () => {
  const out = await run({
    held: [mkHeldWithBranch("a", "b"), mkHeldWithBranch("b", "task/b")],
    collisions: [clash(["b", "task/b"])],
    packets: { resolution: renamed(["b"]), rescan: { collisions: [clash(["b"])] } },
  });
  check("cross-task alias re-scan → nothing delivers", out.deliverable.length === 0, JSON.stringify(slugs(out.deliverable)));
  check("cross-task alias re-scan → both branches held", JSON.stringify(slugs(out.held)) === JSON.stringify(["a", "b"]), JSON.stringify(slugs(out.held)));
  check("cross-task alias re-scan → every hold says the re-scan established nothing", out.held.length === 2 && out.held.every((h) => /established nothing/.test(h.detail) && /by hand/.test(h.detail)), JSON.stringify(out.held.map((h) => h.detail)));
  check("cross-task alias re-scan → no re-review is paid for", !labels(out.calls).some((l) => l.startsWith("re-review:")), JSON.stringify(labels(out.calls)));
});

// 5g. The same alias shape, but the re-scan names the branch TWICE with
//     different raw spellings (`b` and `refs/heads/b`) that both normalize to
//     one value. Two raw entries still collapse to one distinct reported
//     branch, so this must be rejected the same way as 5f even though the
//     entry's `branches` array has length 2.
await scenario("re-scan entry duplicates one branch under two spellings", async () => {
  const out = await run({
    held: [mkHeldWithBranch("a", "b"), mkHeldWithBranch("b", "task/b")],
    collisions: [clash(["b", "task/b"])],
    packets: { resolution: renamed(["b"]), rescan: { collisions: [clash(["b", "refs/heads/b"])] } },
  });
  check("duplicate-normalized re-scan → nothing delivers", out.deliverable.length === 0, JSON.stringify(slugs(out.deliverable)));
  check("duplicate-normalized re-scan → both branches held", JSON.stringify(slugs(out.held)) === JSON.stringify(["a", "b"]), JSON.stringify(slugs(out.held)));
  check("duplicate-normalized re-scan → every hold says the re-scan established nothing", out.held.length === 2 && out.held.every((h) => /established nothing/.test(h.detail) && /by hand/.test(h.detail)), JSON.stringify(out.held.map((h) => h.detail)));
  check("duplicate-normalized re-scan → no re-review is paid for", !labels(out.calls).some((l) => l.startsWith("re-review:")), JSON.stringify(labels(out.calls)));
});

// 6. Fewer than two of a clash's branches in hand. A scan over ONE branch has no
//    sibling to compare against and returns an empty set for want of one, which
//    would read as "clash gone" on no evidence — so no scan is run and the
//    branch is held.
await scenario("single held branch", async () => {
  const out = await run({
    held: [mkHeld("a")],
    collisions: [clash(["task/a", "task/b"])],
    packets: { resolution: renamed(["task/a"]), rescan: { collisions: [] } },
  });
  check("single held branch → does not deliver", out.deliverable.length === 0, JSON.stringify(slugs(out.deliverable)));
  check("single held branch → held", out.held.length === 1 && out.held[0].status === "collision-hold");
  check("single held branch → detail says the re-scan established nothing", /established nothing/.test(out.held[0].detail), out.held[0].detail);
  check("single held branch → no re-scan agent is spawned", !labels(out.calls).some((l) => l.startsWith("collision-rescan:")), JSON.stringify(labels(out.calls)));
});

// 7. The resolver returned nothing usable. Nothing is known about the tree, so
//    no re-scan is spent and every branch is held.
//
//    The last case is the one an empty array makes: `[]` is truthy, so it used
//    to walk straight past this arm into a re-scan that — the clash having
//    genuinely gone — cleared every branch, which then delivered through an
//    "untouched by the resolver" arm that nothing had established. A packet with
//    no entry at all has reported on none of the collisions it was handed, and
//    would have dropped any `blocked` refusal it made on the way, so it is the
//    same answer as no packet and is scripted here beside the others rather than
//    left to differ by an accident of JS truthiness.
await scenario("resolver returned nothing", async () => {
  for (const [name, resolution] of [["resolver returned nothing", null], ["resolver omitted resolutions", {}], ["resolver returned a non-array", { resolutions: 7 }], ["resolver returned an empty packet", { resolutions: [] }]]) {
    const out = await run({
      held: [mkHeld("a"), mkHeld("b")],
      collisions: [clash(["task/a", "task/b"])],
      packets: { resolution, rescan: { collisions: [] } },
    });
    check(`${name} → nothing delivers`, out.deliverable.length === 0, JSON.stringify(slugs(out.deliverable)));
    check(`${name} → both held with the resolver detail`, out.held.length === 2 && out.held.every((h) => h.status === "collision-hold" && /resolver returned no usable result/.test(h.detail)), JSON.stringify(out.held.map((h) => h.detail)));
    check(`${name} → no re-scan agent is spawned`, !labels(out.calls).some((l) => l.startsWith("collision-rescan:")), JSON.stringify(labels(out.calls)));
  }
});

// 8. An imperative shared name. The resolver refused it, which is the one thing
//    only the resolver can report, so the human-facing status stays
//    `collision-blocked` rather than being flattened into a generic hold.
await scenario("blocked collision", async () => {
  const out = await run({
    held: [mkHeld("a"), mkHeld("b")],
    collisions: [clash(["task/a", "task/b"])],
    packets: {
      resolution: { resolutions: [{ collision: NAME, action: "blocked", changedBranches: [], reason: "framework mandates the path" }] },
      rescan: { collisions: [clash(["task/a", "task/b"])] },
    },
  });
  check("blocked → nothing delivers", out.deliverable.length === 0);
  check("blocked → both held as collision-blocked", out.held.length === 2 && out.held.every((h) => h.status === "collision-blocked"), JSON.stringify(out.held.map((h) => h.status)));
  check("blocked → detail asks for a human decision", out.held.every((h) => /human\/design decision/.test(h.detail)));
});

// 9. The two checks on a renamed branch are separate and BOTH must pass: a clash
//    the re-scan cleared still cannot deliver on a failed re-review.
await scenario("re-review failures", async () => {
  const cases = [
    ["re-review failed", { pass: false, issues: [{ claim: "left a dangling import" }], notes: "", flakeRecord: "" }],
    ["re-review saw an empty diff", { pass: true, emptyDiffFlag: true, issues: [], notes: "", flakeRecord: "" }],
    ["re-review returned nothing", null],
  ];
  for (const [name, review] of cases) {
    const out = await run({
      held: [mkHeld("a"), mkHeld("b")],
      collisions: [clash(["task/a", "task/b"])],
      packets: { resolution: renamed(["task/a"]), rescan: { collisions: [] }, reviews: { a: review } },
    });
    check(`${name} → the renamed side is held`, JSON.stringify(slugs(out.held)) === JSON.stringify(["a"]), JSON.stringify(slugs(out.held)));
    check(`${name} → the hold names the re-review`, /fresh re-review/.test(out.held[0].detail), out.held[0].detail);
    check(`${name} → the cleared untouched side still delivers`, JSON.stringify(slugs(out.deliverable)) === JSON.stringify(["b"]));
    // The too-strict control for the assessment carriage on this arm: a branch
    // with no standing deviation is a branch this stage asked about nothing, so
    // it grows no assessments key it did not already have.
    check(`${name} → and a branch with no standing deviation grows no assessments key`, !("deviationAssessments" in out.held[0]), JSON.stringify(Object.keys(out.held[0])));
  }
});

// 9b. The resolver UNDER-REPORTS what it touched: it edited BOTH branches but
//     named only one in `changedBranches`. Nothing here can tell — the resolver
//     held write access to every held worktree, and the clash's disappearance
//     proves only that something moved — so the report selects nobody and every
//     branch of the cleared clash is re-reviewed. The omitted side's failing
//     review is what makes this scenario able to fail: without the widened
//     re-review it delivers its unreviewed post-cycle edits, and no packet the
//     dispatch could inspect would have said so.
await scenario("resolver under-reports which branches it changed", async () => {
  const out = await run({
    held: [mkHeld("a"), mkHeld("b")],
    collisions: [clash(["task/a", "task/b"])],
    packets: {
      resolution: renamed(["task/a"]),
      rescan: { collisions: [] },
      reviews: { b: { pass: false, issues: [{ claim: "the rename left a dangling import" }], notes: "", flakeRecord: "" } },
    },
  });
  check("under-reported rename → the unnamed side is re-reviewed too", JSON.stringify(labels(out.calls).filter((l) => l.startsWith("re-review:")).sort()) === JSON.stringify(["re-review:a", "re-review:b"]), JSON.stringify(labels(out.calls)));
  check("under-reported rename → the unnamed side is held on its failed review", JSON.stringify(slugs(out.held)) === JSON.stringify(["b"]), JSON.stringify(slugs(out.held)));
  check("under-reported rename → the hold names the re-review", out.held.length === 1 && /fresh re-review/.test(out.held[0].detail), JSON.stringify(out.held.map((h) => h.detail)));
  check("under-reported rename → only the side that passed delivers", JSON.stringify(slugs(out.deliverable)) === JSON.stringify(["a"]), JSON.stringify(slugs(out.deliverable)));
});

// 10. A branch in TWO clashes, one resolved and one not. The re-scan answers per
//     clash rather than per branch, so crediting the rename against the wrong
//     clash cannot deliver it.
await scenario("branch in two clashes", async () => {
  const out = await run({
    held: [mkHeld("a"), mkHeld("b"), mkHeld("c")],
    collisions: [clash(["task/a", "task/b"]), clash(["task/b", "task/c"], "Widget")],
    packets: {
      resolution: { resolutions: [...renamed(["task/a"]).resolutions, ...renamed(["task/b"], "Widget").resolutions] },
      rescan: { collisions: [clash(["task/b", "task/c"], "Widget")] },
    },
  });
  check("two clashes → only the branch clear of both delivers", JSON.stringify(slugs(out.deliverable)) === JSON.stringify(["a"]), JSON.stringify(slugs(out.deliverable)));
  check("two clashes → both sides of the surviving clash are held", JSON.stringify(slugs(out.held)) === JSON.stringify(["b", "c"]), JSON.stringify(slugs(out.held)));
  check("two clashes → the held pair's clash is the surviving one", out.held.every((h) => h.collisions.length === 1 && h.collisions[0].name === "Widget"));
});

// --- Deviation state across the re-review ---------------------------------
//
// A deconfliction rename changes a file path or an exported symbol on purpose,
// and a deviation's text is the implementer's prose naming what it delivered —
// commonly that same file or symbol. The cycle's own reviewer judged that text
// against the PRE-rename tree; the re-review is the only stage that ever sees
// the post-rename one. So it is shown the standing deviations, its assessments
// replace the carried ones, and the gate its brief states — a standing deviation
// left unassessed does not pass — is applied here as a HOLD, there being no
// round to spend instead.

const DEVIATION = "Delivered the helper as src/shared.ts instead of the LOCKED src/shared-config.ts: the generator owns that path.";
const OTHER_DEVIATION = "Skipped the LOCKED integration test: its fixture service is unreachable from CI.";
const PRE_RENAME = { deviation: DEVIATION, inSpecRoute: "none — the generator owns the locked path", recommendation: "RATIFY — the constraint is real" };
const POST_RENAME = { deviation: DEVIATION, inSpecRoute: "none before the rename; the locked path is free now", recommendation: "CONFORM — the rename freed the locked path" };
const DEVIATING = (extra) => mkHeld("a", { deviations: [DEVIATION], deviationAssessments: [PRE_RENAME], ...extra });
const reviewOf = (extra) => ({ pass: true, issues: [], notes: "rename reads clean", flakeRecord: "", ...extra });
const briefFor = (out, slug) => (out.calls.find((c) => c.label === `re-review:${slug}`) || {}).prompt || "";
const DEVIATIONS_HEADING = "Deviations from LOCKED decisions standing on this packet";

// 11. The deviations reach the reviewer, and its answer — not the cycle's —
//     reaches the PR body.
await scenario("standing deviation assessed by the re-review", async () => {
  const out = await run({
    held: [DEVIATING(), mkHeld("b")],
    collisions: [clash(["task/a", "task/b"])],
    packets: { resolution: renamed(["task/a"]), rescan: { collisions: [] }, reviews: { a: reviewOf({ deviationAssessments: [POST_RENAME] }) } },
  });
  const brief = briefFor(out, "a");
  check("deviation shown → the re-review brief carries the standing deviation VERBATIM", brief.includes(JSON.stringify(DEVIATION)), brief.slice(-400));
  check("deviation shown → the brief asks for the reviewer's half by name", brief.includes(DEVIATIONS_HEADING) && /deviationAssessments/.test(brief));
  // The gate the brief asserts, and the consequence this path has instead of a
  // round. Both must be there: the block's claim is rendered from inside the
  // mirrored section, and a path that shows it while delivering an unassessed
  // deviation anyway would be prose outrunning enforcement.
  check("deviation shown → the brief states the unassessed gate", /does not pass while one of them is unassessed/.test(brief), "brief");
  check("deviation shown → and states THIS path's consequence, a hold rather than another round", /the branch is HELD before its PR instead/.test(brief), "brief");
  check("deviation shown → and asks for staleness to be RAISED, not rewritten", /gone stale/.test(brief) && /never one to rewrite/.test(brief), "brief");
  check("deviation assessed → the branch delivers", JSON.stringify(slugs(out.deliverable)) === JSON.stringify(["a", "b"]), JSON.stringify(slugs(out.deliverable)));
  const a = out.deliverable.find((d) => d.task.slug === "a");
  check("deviation assessed → the delivered result carries the POST-rename assessment", JSON.stringify(a.result.deviationAssessments) === JSON.stringify([POST_RENAME]), JSON.stringify(a.result.deviationAssessments));
  check("deviation assessed → and no assessment formed before the rename", !JSON.stringify(a.result.deviationAssessments).includes(PRE_RENAME.recommendation), JSON.stringify(a.result.deviationAssessments));
  check("deviation assessed → the deviation TEXT is left alone (only a fixer may restate one)", JSON.stringify(a.result.deviations) === JSON.stringify([DEVIATION]), JSON.stringify(a.result.deviations));
});

// 12. THE TOO-STRICT CONTROL for the whole feature: a branch with no standing
//     deviations renders no block, is asked for nothing, and delivers with
//     whatever it carried untouched.
await scenario("no standing deviations", async () => {
  const carried = [{ deviation: "an entry no standing deviation matches", inSpecRoute: "n/a", recommendation: "RATIFY — stale" }];
  const out = await run({
    held: [mkHeld("a", { deviationAssessments: carried }), mkHeld("b")],
    collisions: [clash(["task/a", "task/b"])],
    packets: { resolution: renamed(["task/a"]), rescan: { collisions: [] } },
  });
  check("no deviations → both sides deliver exactly as before", JSON.stringify(slugs(out.deliverable)) === JSON.stringify(["a", "b"]), JSON.stringify(slugs(out.deliverable)));
  check("no deviations → the brief renders no deviations block at all", !briefFor(out, "a").includes(DEVIATIONS_HEADING) && !briefFor(out, "b").includes(DEVIATIONS_HEADING));
  check("no deviations → and no gate claim the path would then have to keep", !/does not pass while one of them is unassessed/.test(briefFor(out, "a")) && !/the branch is HELD before its PR instead/.test(briefFor(out, "a")), "brief");
  const a = out.deliverable.find((d) => d.task.slug === "a");
  check("no deviations → the dispatch touches the carried assessments not at all", JSON.stringify(a.result.deviationAssessments) === JSON.stringify(carried), JSON.stringify(a.result.deviationAssessments));
  const b = out.deliverable.find((d) => d.task.slug === "b");
  check("no deviations → and invents no assessments key on a result that had none", !("deviationAssessments" in b.result), JSON.stringify(Object.keys(b.result)));
});

// 13. The reviewer raises the deviation's staleness as an issue. It is the
//     ordinary failed-re-review arm — the point is that a reviewer SHOWN the
//     deviation can now reach it at all, and that the arm carries no assessment
//     of it onward either way.
await scenario("re-review raises the deviation as stale", async () => {
  const issue = { claim: `the deviation names src/shared.ts, which the deconfliction renamed to src/shared-b.ts; its text no longer describes this branch` };
  const out = await run({
    held: [DEVIATING(), mkHeld("b")],
    collisions: [clash(["task/a", "task/b"])],
    // The failing pass volunteers a usable entry of its own, so the assertion
    // below cannot pass merely because the reviewer returned none.
    packets: { resolution: renamed(["task/a"]), rescan: { collisions: [] }, reviews: { a: { pass: false, issues: [issue], notes: "", flakeRecord: "", deviationAssessments: [POST_RENAME] } } },
  });
  check("stale deviation → the branch is held, not delivered", JSON.stringify(slugs(out.held)) === JSON.stringify(["a"]) && JSON.stringify(slugs(out.deliverable)) === JSON.stringify(["b"]), JSON.stringify(slugs(out.held)));
  check("stale deviation → the hold names the re-review and carries the finding", /fresh re-review/.test(heldBySlug(out, "a").detail) && JSON.stringify(heldBySlug(out, "a").outstanding) === JSON.stringify([issue]), JSON.stringify(heldBySlug(out, "a")));
  // Neither assessment may ride this arm. The pre-rename one because the batch
  // Summary flattens held records' `deviationAssessments` too, so it would put
  // an obsolete RATIFY in front of the maintainer under the very deviation this
  // pass just called stale; the failing pass's own because `runReviewCycle`
  // accepts the reviewer's half on a PASSING round alone. The deviation reaches
  // the human standing and unjudged, which is what an exit no round approved
  // has to say.
  check("stale deviation → the hold carries no assessment: not the pre-rename one, not the failing pass's own", JSON.stringify(heldBySlug(out, "a").deviationAssessments) === "[]", JSON.stringify(heldBySlug(out, "a").deviationAssessments));
  check("stale deviation → while the deviation itself and the cycle record still ride", JSON.stringify(heldBySlug(out, "a").deviations) === JSON.stringify([DEVIATION]) && heldBySlug(out, "a").artifactDir === "/tmp/art" && heldBySlug(out, "a").rounds === 2, JSON.stringify(heldBySlug(out, "a").deviations));
});

// 14. THE NEW GATE. The reviewer passes the branch but leaves the standing
//     deviation without a usable half of its own. Every shape the cycle's own
//     gate rejects is rejected here, and the branch is held rather than
//     delivering a deviation the maintainer would rule on knowing only what the
//     implementer said.
await scenario("re-review leaves the deviation unassessed", async () => {
  const cases = [
    ["no assessments field at all", reviewOf()],
    ["an empty assessments array", reviewOf({ deviationAssessments: [] })],
    ["an entry for a deviation that is not standing", reviewOf({ deviationAssessments: [{ ...POST_RENAME, deviation: OTHER_DEVIATION }] })],
    ["an entry with no in-spec-route judgment", reviewOf({ deviationAssessments: [{ ...POST_RENAME, inSpecRoute: "  " }] })],
    ["a hedged recommendation", reviewOf({ deviationAssessments: [{ ...POST_RENAME, recommendation: "UNSURE — needs investigation" }] })],
    ["a recommendation refusing to choose", reviewOf({ deviationAssessments: [{ ...POST_RENAME, recommendation: "RATIFY or CONFORM — needs investigation" }] })],
    ["a malformed entry", reviewOf({ deviationAssessments: [null, { inSpecRoute: "none", recommendation: "RATIFY — fine" }] })],
  ];
  for (const [name, review] of cases) {
    const out = await run({
      held: [DEVIATING(), mkHeld("b")],
      collisions: [clash(["task/a", "task/b"])],
      packets: { resolution: renamed(["task/a"]), rescan: { collisions: [] }, reviews: { a: review } },
    });
    check(`${name} → the branch does not deliver`, JSON.stringify(slugs(out.deliverable)) === JSON.stringify(["b"]), JSON.stringify(slugs(out.deliverable)));
    const h = heldBySlug(out, "a");
    check(`${name} → it is held as a collision-hold`, h && h.status === "collision-hold", JSON.stringify(out.held.map((x) => x.status)));
    check(`${name} → the detail says what is missing and what to do next`, /left a deviation from a LOCKED decision unassessed/.test(h.detail) && /re-review this branch and record/.test(h.detail) && /without conforming, rewording, or dropping it/.test(h.detail), h.detail);
    check(`${name} → the hold names the deviation the human must get an assessment for`, JSON.stringify(h.unassessedDeviations) === JSON.stringify([DEVIATION]), JSON.stringify(h.unassessedDeviations));
    // The batch Summary flattens every result's assessments — held ones too —
    // into one list. A record that says "unassessed" while shipping the
    // pre-rename cycle's RATIFY for that same deviation puts an obsolete verdict
    // in front of the maintainer under the exact deviation nobody has judged
    // since the rename.
    check(`${name} → and carries no assessment for it, the pre-rename one included`, JSON.stringify(h.deviationAssessments) === "[]", JSON.stringify(h.deviationAssessments));
    check(`${name} → and still carries its cycle record`, h.artifactDir === "/tmp/art" && h.rounds === 2 && JSON.stringify(h.deviations) === JSON.stringify([DEVIATION]));
  }
});

// 14b. Partial coverage: one of two standing deviations assessed. The hold names
//      only the one still missing its half — and reports the halves it DOES
//      carry from the same pass, so the record cannot say assessed and
//      unassessed of one deviation at once.
await scenario("re-review assesses one deviation of two", async () => {
  const staleOther = { deviation: OTHER_DEVIATION, inSpecRoute: "none — CI cannot reach the fixture", recommendation: "RATIFY — the constraint is environmental" };
  const out = await run({
    held: [mkHeld("a", { deviations: [DEVIATION, OTHER_DEVIATION], deviationAssessments: [PRE_RENAME, staleOther] }), mkHeld("b")],
    collisions: [clash(["task/a", "task/b"])],
    packets: { resolution: renamed(["task/a"]), rescan: { collisions: [] }, reviews: { a: reviewOf({ deviationAssessments: [POST_RENAME] }) } },
  });
  check("partial coverage → the branch does not deliver", JSON.stringify(slugs(out.deliverable)) === JSON.stringify(["b"]), JSON.stringify(slugs(out.deliverable)));
  check("partial coverage → the hold names only the unassessed one", JSON.stringify(heldBySlug(out, "a").unassessedDeviations) === JSON.stringify([OTHER_DEVIATION]), JSON.stringify(heldBySlug(out, "a").unassessedDeviations));
  check("partial coverage → the hold carries THIS pass's half for the assessed one, and neither pre-rename entry", JSON.stringify(heldBySlug(out, "a").deviationAssessments) === JSON.stringify([POST_RENAME]), JSON.stringify(heldBySlug(out, "a").deviationAssessments));
  check("partial coverage → both deviations were shown to the reviewer", briefFor(out, "a").includes(JSON.stringify(DEVIATION)) && briefFor(out, "a").includes(JSON.stringify(OTHER_DEVIATION)), "brief");
});

// 14c. What a covered branch PUBLISHES, which is exactly what the gate accepted:
//      at most one entry per standing deviation, and none for anything else. A
//      hedge riding to the maintainer beside the usable entry would reinstate in
//      what ships the ambiguity the gate closed in what is checked.
await scenario("only usable assessments are published", async () => {
  const hedge = { ...POST_RENAME, recommendation: "UNSURE — on reflection" };
  const foreign = { ...POST_RENAME, deviation: OTHER_DEVIATION };
  const out = await run({
    held: [DEVIATING(), mkHeld("b")],
    collisions: [clash(["task/a", "task/b"])],
    packets: { resolution: renamed(["task/a"]), rescan: { collisions: [] }, reviews: { a: reviewOf({ deviationAssessments: [POST_RENAME, hedge, foreign] }) } },
  });
  const a = out.deliverable.find((d) => d.task.slug === "a");
  check("publication → the branch delivers", a !== undefined, JSON.stringify(slugs(out.deliverable)));
  check("publication → exactly the one usable entry ships, hedge and foreign entry dropped", JSON.stringify(a.result.deviationAssessments) === JSON.stringify([POST_RENAME]), JSON.stringify(a.result.deviationAssessments));
});

// 14d. A branch held for any earlier reason is never asked, so the gate costs
//      nothing on the paths that already hold — and cannot deliver one either.
await scenario("still-colliding branch is never asked for assessments", async () => {
  const out = await run({
    held: [DEVIATING(), mkHeld("b")],
    collisions: [clash(["task/a", "task/b"])],
    packets: { resolution: renamed(["task/a"]), rescan: { collisions: [clash(["task/a", "task/b"])] } },
  });
  check("still colliding → no re-review is paid for", !labels(out.calls).some((l) => l.startsWith("re-review:")), JSON.stringify(labels(out.calls)));
  check("still colliding → the hold is the refs one, not the assessment one", heldBySlug(out, "a").detail.includes("still in the refs") && !("unassessedDeviations" in heldBySlug(out, "a")), heldBySlug(out, "a").detail);
});

// 15. Source-level properties the scenarios cannot see. The first is what makes
//     every scenario above speak for the shipped workflow at all: a dispatch the
//     batch body no longer calls would pass all of them.
{
  const fnStart = src.indexOf("async function settleWaveCollisions(");
  check("settleWaveCollisions is declared", fnStart !== -1);
  const body = src.slice(fnStart, src.indexOf("\n}", fnStart));
  const callSite = src.indexOf("await settleWaveCollisions({");
  check("the batch body awaits settleWaveCollisions", callSite !== -1 && callSite > fnStart, String(callSite));
  check("the re-scan reuses the read-only discovery scan", /collisionScanPrompt\(heldTasks\.map/.test(body));
  check("the re-scan is validated by the discovery schema", /label: `collision-rescan:w\$\{wave\}`, schema: COLLISION_SCHEMA/.test(body));
  // Every delivery in this stage sits after the re-derived state exists. The
  // count is asserted too: a second push added elsewhere in the function —
  // before the gate, or outside the loop — fails here rather than sliding in
  // unread. There is exactly ONE now: the arm that delivers without a re-review
  // was the "untouched by the resolver" arm, and it is gone.
  const gate = body.indexOf("let rescanned = null;");
  const pushes = [...body.matchAll(/deliverable\.push\(/g)].map((m) => m.index);
  check("the re-derived state is established in the dispatch", gate !== -1);
  check("the dispatch has exactly one delivery site", pushes.length === 1, String(pushes.length));
  check("every delivery site sits after the re-scan gate", gate !== -1 && pushes.length > 0 && pushes.every((i) => i > gate));
  // The structural property the scenarios can only sample: the dispatch takes no
  // decision at all off the resolver's account of what it touched. A scenario
  // covers the shapes it scripts; this covers the field.
  //
  // It matches the bare identifier anywhere in the function, comments included,
  // and that breadth is the point: a property-access pattern (`.changedBranches`)
  // reads tighter but lets `const { changedBranches } = r` through, which is an
  // ordinary refactor of exactly the access this branch removed. Absence of the
  // name is the invariant, and it costs nothing to keep — the field's rationale
  // belongs in the doc comment above the function, where it already lives.
  const at = body.indexOf("changedBranches");
  check("the dispatch reads no `changedBranches` off the resolver's packet", at === -1, body.slice(Math.max(0, at - 80), at + 80));
  // The deviation carriage, pinned at the source because the scenarios above
  // sample its behavior through a stubbed reviewer: the standing set is what the
  // brief is built from, and the re-review's coverage is what the delivering
  // push publishes. A dispatch that computed the coverage and delivered the
  // carried assessments anyway would pass every scenario that never scripts a
  // pre-rename entry.
  check("the re-review is handed the branch's standing deviations", /collisionReReviewPrompt\(task, remote, peerMode, standingDeviations\)/.test(body), "dispatch body");
  check("and the delivering push publishes the re-review's assessments, not the carried ones", /deviationAssessments: coverage\.assessments/.test(body) && /const coverage = collisionDeviationCoverage\(standingDeviations, reviewed \? verdict : null\);/.test(body), "dispatch body");
}

check(`the suite ran all ${EXPECTED_CHECKS} checks`, ok + failures === EXPECTED_CHECKS, `ran ${ok + failures}`);

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll collision-dispatch checks passed.");
