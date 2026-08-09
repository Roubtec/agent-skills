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
// its first executable statement — with those globals stubbed, and drives
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
const EXPECTED_CHECKS = 110;

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
const mkHeld = (slug) => ({
  task: mkTask(slug),
  result: { slug, branch: `task/${slug}`, status: "ready", notes: "cycle notes", rounds: 2, openQuestions: [], deviations: [], peerRounds: 1, artifactDir: "/tmp/art" },
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

// 5b. A re-scan entry this stage cannot attribute to any held branch. It is a
//     clash reported with no owner, so filtering by branch name yields an empty
//     "still colliding" set for every held branch and would deliver all of them
//     off a packet that just said the clash survives — the exact inversion the
//     guard exists to prevent. The packet reads as unusable instead.
await scenario("unattributable re-scan entry", async () => {
  const cases = [
    ["re-scan entry names no branches at all", [clash([])]],
    ["re-scan entry names branches in an unmatched form", [clash(["refs/heads/task/a", "refs/heads/task/b"])]],
  ];
  for (const [name, collisions] of cases) {
    const out = await run({
      held: [mkHeld("a"), mkHeld("b")],
      collisions: [clash(["task/a", "task/b"])],
      packets: { resolution: renamed(["task/a"]), rescan: { collisions } },
    });
    check(`${name} → nothing delivers`, out.deliverable.length === 0, JSON.stringify(slugs(out.deliverable)));
    check(`${name} → both branches held`, JSON.stringify(slugs(out.held)) === JSON.stringify(["a", "b"]), JSON.stringify(slugs(out.held)));
    check(`${name} → detail says the re-scan established nothing`, out.held.length === 2 && out.held.every((h) => /established nothing/.test(h.detail) && /by hand/.test(h.detail)), JSON.stringify(out.held.map((h) => h.detail)));
    check(`${name} → no re-review is paid for`, !labels(out.calls).some((l) => l.startsWith("re-review:")), JSON.stringify(labels(out.calls)));
  }
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

// 11. Source-level properties the scenarios cannot see. The first is what makes
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
}

check(`the suite ran all ${EXPECTED_CHECKS} checks`, ok + failures === EXPECTED_CHECKS, `ran ${ok + failures}`);

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll collision-dispatch checks passed.");
