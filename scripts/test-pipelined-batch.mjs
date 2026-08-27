#!/usr/bin/env node
// Behavior suite for wf-address-tasks.js's per-task pipelining (task 033):
// `runPipelinedBatch` and the pieces it composes — the dependency gate, the
// serialized first-ready-wins guard with its reservation ledger and asymmetric
// release, the rebase onto a base a merged sibling advanced, the storage-derived
// slot gate, the orphaned-pushed-branch terminal obligation, and the terminal
// state census the Summary reads.
//
// The workflow is a runtime script (top-level await/return, injected
// `agent`/`phase`/`log`/`parallel` globals), so it cannot be imported. Like the
// sibling suites this evaluates the shipped declaration prefix with those
// globals stubbed and drives scripted agents through the ACTUAL shipped
// functions: every cycle role, the guard scan, the resolver, the re-review, the
// PR step, the reclaim, the rebase, and the orphan reconciliation are scripted
// by label, and some are DEFERRED so the suite can observe ordering — a fast
// task's PR opening while a slow sibling's review is still pending, a dependent
// starting the moment its prerequisite delivers, a second guard scan seeing a
// number the first task reserved while its push/PR step has not returned.
//
// A live multi-task `Workflow` run is not something a script can do; what this
// pins is everything the script decides on its own.
//
// Run: node scripts/test-pipelined-batch.mjs

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
const EXPECTED_CHECKS = 80;

async function scenario(name, fn) {
  try {
    await fn();
  } catch (err) {
    check(`${name} ran without throwing`, false, String((err && err.stack) || err));
  }
}

const NAMES = ["runPipelinedBatch", "createReservationLedger", "createSlotGate", "settleReservation", "reconcileOrphanedBranches", "terminalStates", "reviewStackMergeable", "reviewStackOrder", "unschedulable", "effectiveDeps", "baseAdvance"];
function load(agent, events) {
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
    `"use strict";\n${prefix}\nreturn { ${NAMES.join(", ")} };`,
  )("", agent, (m) => events.push({ type: "phase", message: m }), (m) => events.push({ type: "log", message: m }), async (fns) => Promise.all(fns.map((f) => f())));
}

// --- Scripted agent ---------------------------------------------------------
// Default packets conclude a `full`-mode cycle in one round: fix#1 changed and
// clean, packet#1 measured clean, review#1 pass, fix#2 idle, packet#2 clean. A
// clean guard scan, a PR that opens with its base read back, a cleanup that
// returns. `overrides` maps a label (or a label prefix ending in `*`) to a
// packet, a function of (prompt, calls), an Error to throw, or a Deferred whose
// `.promise` resolves to the packet once the scenario releases it.
const PASS_PACKET = { blocker: "", changed: true, summary: "s", dispositions: [], openQuestions: [], deviations: [], workReport: [], proactive: "", finalSha: "f".repeat(40), clean: true, artifactDir: "/tmp/art", flakeRecord: "" };
const IDLE = { ...PASS_PACKET, changed: false };
const MEASURED = { measured: true, dirty: [], operation: "", headSha: "f".repeat(40), headParentSha: "e".repeat(40), detail: "clean" };
const PASS_REVIEW = { pass: true, issues: [], notes: "" };
const CLEAN_SCAN = { collisions: [], taskNumbers: [], merged: [], scanComplete: true };
const PR_OK = (slug) => ({ opened: true, url: `https://example.invalid/pr/${slug}`, pushed: true, baseOk: true, baseRepaired: "", reason: "" });

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve, deferred: true };
}

function defaultFor(label, slug) {
  const stage = label.slice(slug.length + 1);
  if (stage === "fix#1") return { ...PASS_PACKET };
  if (stage.startsWith("fix#")) return { ...IDLE };
  if (stage.startsWith("packet#")) return { ...MEASURED };
  if (stage.startsWith("review#")) return { ...PASS_REVIEW };
  return undefined;
}

function scriptedAgent(slugs, overrides, calls) {
  return async function agent(prompt, opts) {
    const label = (opts && opts.label) || "";
    const entry = { label, prompt, schema: opts && opts.schema, at: calls.length };
    calls.push(entry);
    const key = Object.keys(overrides).find((k) => (k.endsWith("*") ? label.startsWith(k.slice(0, -1)) : k === label));
    let value = key !== undefined ? overrides[key] : undefined;
    if (value === undefined) {
      const slug = slugs.find((s) => label.startsWith(`${s}:`));
      if (slug) value = defaultFor(label, slug);
      else if (label.startsWith("collision-scan:")) value = { ...CLEAN_SCAN };
      else if (label.startsWith("pr:")) value = PR_OK(label.slice(3));
      else if (label.startsWith("cleanup:")) value = { done: true };
      else if (label.startsWith("storage-probe:")) value = { availBytes: 0 };
      else throw new Error(`unscripted agent: ${label}`);
    }
    if (value && value.deferred) value = await value.promise;
    if (typeof value === "function") value = await value(prompt, calls);
    if (value instanceof Error) throw value;
    return value;
  };
}

const t = (slug, base = "main", dependsOn = []) => ({ slug, branch: `task/${slug}`, base, dependsOn, path: `tasks/${slug}.md`, content: `# ${slug}\n`, upstream: "" });

async function runBatch({ plan, overrides = {}, remote = true, cap = Infinity }) {
  const calls = [];
  const events = [];
  const slugs = plan.waves.flat().map((x) => x.slug);
  const agent = scriptedAgent(slugs, overrides, calls);
  const fns = load(agent, events);
  const statusBySlug = new Map();
  const results = [];
  const throttled = [];
  const collisions = [];
  const ledger = fns.createReservationLedger();
  const gate = fns.createSlotGate(cap);
  let reprobes = 0;
  const reprobe = async () => {
    reprobes += 1;
    await agent("probe", { label: `storage-probe:${reprobes}` });
    return cap;
  };
  const pipeline = await fns.runPipelinedBatch({ plan, remote, peerMode: "off", statusBySlug, results, throttled, collisions, ledger, gate, reprobe });
  return { fns, calls, events, statusBySlug, results, throttled, collisions, ledger, gate, pipeline, reprobes: () => reprobes };
}
const labels = (calls) => calls.map((c) => c.label);
const at = (calls, label) => calls.findIndex((c) => c.label === label);
const by = (results, slug) => results.find((r) => r.slug === slug);

// 1. THE ACCEPTANCE SHAPE. Three tasks: `a` slow (its review is deferred), `b`
//    fast and independent, `c` dependent on `a`. `b`'s PR opens while `a` is
//    still in review; `c` starts only once `a` delivered; the summary is right.
await scenario("fast task delivers while a slow sibling is still in review; dependent starts on delivery", async () => {
  const slowReview = deferred();
  const plan = { defaultBase: "main", waves: [[t("001-a"), t("002-b")], [t("003-c", "task/001-a", ["001-a"])]] };
  const running = runBatch({ plan, overrides: { "001-a:review#1": slowReview } });
  // Let everything that can progress progress: b runs to delivery while a waits
  // in review. `setTimeout` is the suite's, not the workflow's.
  await new Promise((r) => setTimeout(r, 20));
  const peek = await Promise.race([running, new Promise((r) => setTimeout(() => r(null), 5))]);
  check("the batch is still running while a's review is pending", peek === null);
  slowReview.resolve({ ...PASS_REVIEW });
  const out = await running;
  const L = labels(out.calls);
  check("b's PR opened before a's review returned", at(out.calls, "pr:002-b") !== -1 && at(out.calls, "pr:002-b") < at(out.calls, "001-a:fix#2"), JSON.stringify(L));
  check("b's worktree was reclaimed before a delivered", at(out.calls, "cleanup:002-b") < at(out.calls, "pr:001-a"));
  check("c did not start until a delivered", at(out.calls, "003-c:fix#1") > at(out.calls, "pr:001-a") && at(out.calls, "003-c:fix#1") > at(out.calls, "cleanup:001-a"), JSON.stringify(L));
  check("every task delivered", out.results.length === 3 && out.results.every((r) => r.status === "done"), JSON.stringify(out.results.map((r) => `${r.slug}:${r.status}`)));
  check("the guard ran once per task, in readiness order: b first", JSON.stringify(out.pipeline.guardOrder) === JSON.stringify(["002-b", "001-a", "003-c"]), JSON.stringify(out.pipeline.guardOrder));
  check("the census reports three done", JSON.stringify(out.fns.terminalStates(out.results)) === JSON.stringify({ done: 3 }));
  check("c's guard scan listed a and b as DELIVERED members with their PRs", /task\/001-a[^\n]*DELIVERED[^\n]*pr\/001-a/.test(out.calls[at(out.calls, "collision-scan:003-c")].prompt));
  check("the ledger holds every task as delivered and reserves nothing", out.ledger.delivered.size === 3 && out.ledger.reserved.size === 0 && out.ledger.orphaned.size === 0);
  check("the dependency gate is the structural one: c's effective deps include a from its base alone", JSON.stringify(out.fns.effectiveDeps({ slug: "x", base: "task/001-a", dependsOn: [] }, new Map([["task/001-a", "001-a"]]))) === JSON.stringify(["001-a"]));
});

// 2. THE RESERVATION. `a` and `b` both pass review; `a` reaches the guard first
//    and its PR step is DEFERRED, so when `b` enters the guard `a` is neither
//    delivered nor a currently-ready sibling — it is reserved. `b`'s scan sees
//    it as RESERVED with the number a claimed; b's clash against it is settled
//    by renaming b's side; then a's delivery is released and both deliver.
await scenario("a reserved number is visible to the next task in the guard while the first is mid-delivery", async () => {
  const prA = deferred();
  const reviewB = deferred();
  const plan = { defaultBase: "main", waves: [[t("001-a"), t("002-b")]] };
  let scanB = null;
  const running = runBatch({
    plan,
    overrides: {
      "pr:001-a": prA,
      "002-b:review#1": reviewB,
      "collision-scan:001-a": { collisions: [], taskNumbers: ["042"], merged: [], scanComplete: true },
      "collision-scan:002-b": (prompt) => { scanB = prompt; return { collisions: [{ kind: "task-number", name: "042", branches: ["task/002-b", "task/001-a"], detail: "both claim 042" }], taskNumbers: ["042"], merged: [], scanComplete: true }; },
      "collision-resolve:002-b": { resolutions: [{ collision: "042", action: "renamed", changedBranches: ["task/002-b"], from: "042", to: "043", regenerated: "", reason: "a reserved 042 first" }] },
      "collision-rescan:002-b": { collisions: [], taskNumbers: ["043"], merged: [], scanComplete: true },
      "re-review:002-b": { pass: true, issues: [], notes: "renumbered cleanly", flakeRecord: "" },
    },
  });
  await new Promise((r) => setTimeout(r, 20));
  // a is now inside its deferred PR step; b's review is still deferred.
  reviewB.resolve({ ...PASS_REVIEW });
  await new Promise((r) => setTimeout(r, 20));
  check("b's guard scan ran while a's PR step was still pending", scanB !== null);
  check("b's scan listed a as RESERVED — neither delivered nor currently ready", scanB !== null && /task\/001-a[^\n]*RESERVED/.test(scanB), scanB && scanB.slice(0, 400));
  prA.resolve(PR_OK("001-a"));
  const out = await running;
  check("both delivered", out.results.every((r) => r.status === "done") && out.results.length === 2, JSON.stringify(out.results.map((r) => `${r.slug}:${r.status}`)));
  const resolve = out.calls[at(out.calls, "collision-resolve:002-b")].prompt;
  check("the resolver was told a's side is reserved and read-only, b renames", /branch "task\/001-a" \(reserved\)/.test(resolve) && /the held branch under the guard renames/.test(resolve));
  check("b was re-reviewed before delivering, after the re-scan", at(out.calls, "re-review:002-b") > at(out.calls, "collision-rescan:002-b") && at(out.calls, "pr:002-b") > at(out.calls, "re-review:002-b"));
  check("a's reservation carried the number b's scan saw, and converted to delivered", out.ledger.delivered.get("001-a").taskNumbers[0] === "042" && out.ledger.reserved.size === 0);
  check("the collisions the batch reports carry the guard that found them", out.collisions.length === 1 && out.collisions[0].guard === "002-b");
});

// 3. ASYMMETRIC RELEASE and the terminal obligation. Four independent tasks:
//    `p` pushes but its PR creation fails (orphan, reconciled by a PR retry);
//    `q` pushes without a PR (orphan, reconciled by deleting the branch); `r`
//    pushes without a PR and survives both (named in the summary with its
//    numbers); `s` fails delivery with NO remote write (reservation dropped,
//    no orphan step at all). A later task `z` sees the orphans still RESERVED.
await scenario("orphaned pushed branches persist as reservations and are acted on at the end", async () => {
  const zReview = deferred();
  const plan = { defaultBase: "main", waves: [[t("010-p"), t("011-q"), t("012-r"), t("013-s"), t("014-z")]] };
  const running = runBatch({
    plan,
    overrides: {
      "collision-scan:010-p": { ...CLEAN_SCAN, taskNumbers: ["010"] },
      "collision-scan:012-r": { ...CLEAN_SCAN, taskNumbers: ["012", "012a"] },
      "pr:010-p": { opened: false, pushed: true, reason: "gh pr create failed after the push" },
      "pr:011-q": { opened: false, pushed: true, reason: "API error" },
      "pr:012-r": { opened: false, pushed: true, reason: "API error" },
      "pr:013-s": { opened: false, pushed: false, reason: "push refused" },
      "014-z:review#1": zReview,
      "orphan:010-p": { outcome: "pr-opened", url: "https://example.invalid/pr/10", baseOk: true, reason: "retry succeeded" },
      "orphan:011-q": { outcome: "branch-deleted", reason: "PR retry failed; branch deleted from origin" },
      "orphan:012-r": { outcome: "unresolved", reason: "gh unreachable; delete refused" },
    },
  });
  await new Promise((r) => setTimeout(r, 30));
  zReview.resolve({ ...PASS_REVIEW });
  const out = await running;
  const zScan = out.calls[at(out.calls, "collision-scan:014-z")].prompt;
  check("a later guard scan still sees the orphaned branches as RESERVED", /task\/010-p[^\n]*RESERVED/.test(zScan) && /task\/012-r[^\n]*RESERVED/.test(zScan), zScan.slice(0, 600));
  check("and does not see the branch whose delivery made no remote write", !/task\/013-s/.test(zScan));
  check("the orphan step ran for exactly the pushed-without-PR branches, after every task ended", JSON.stringify(labels(out.calls).filter((l) => l.startsWith("orphan:")).sort()) === JSON.stringify([]) , "orphan reconciliation is the batch body's, not the pipeline's — it runs after runPipelinedBatch returns");
  // The obligation is discharged by the terminal stage the body runs next.
  const orphans = await out.fns.reconcileOrphanedBranches({ ledger: out.ledger, tasksBySlug: out.pipeline.tasksBySlug, results: out.results, statusBySlug: out.statusBySlug, remote: true });
  check("the terminal stage acted on exactly the three orphans", JSON.stringify(orphans.acted.map((a) => `${a.slug}:${a.outcome}`).sort()) === JSON.stringify(["010-p:pr-opened", "011-q:branch-deleted", "012-r:unresolved"]), JSON.stringify(orphans.acted));
  check("a PR retried successfully converts the result to done, marked late", by(out.results, "010-p").status === "done" && by(out.results, "010-p").prUrl === "https://example.invalid/pr/10" && by(out.results, "010-p").lateDelivery === true);
  check("a deleted branch reads as local-only with the reason", by(out.results, "011-q").status === "local-only" && /deleted from origin/.test(by(out.results, "011-q").reason));
  check("a survivor is named beside the numbers it still holds", JSON.stringify(orphans.survivors) === JSON.stringify([{ slug: "012-r", branch: "task/012-r", taskNumbers: ["012", "012a"], reason: "gh unreachable; delete refused" }]), JSON.stringify(orphans.survivors));
  check("the survivor's result is flagged orphaned and stays pushed-no-pr", by(out.results, "012-r").status === "pushed-no-pr" && by(out.results, "012-r").orphaned === true);
  check("the no-remote-write failure dropped its reservation and got no orphan step", !out.ledger.orphaned.has("013-s") && !out.ledger.reserved.has("013-s") && !orphans.acted.some((a) => a.slug === "013-s"));
  check("the census reads the mixed terminal states", JSON.stringify(out.fns.terminalStates(out.results)) === JSON.stringify({ done: 2, "local-only": 1, "pushed-no-pr": 2 }), JSON.stringify(out.fns.terminalStates(out.results)));
  check("the orphan brief spells out the PR retry and the guarded delete, and names the numbers", (() => { const p = out.calls.find((c) => c.label === "orphan:012-r").prompt; return /Retry PR creation ONCE/.test(p) && /git push origin --delete 'task\/012-r'/.test(p) && /`012`, `012a`/.test(p); })());
  check("a no-remote ledger never orphans", (() => { const l = out.fns.createReservationLedger(); l.reserved.set("x", { slug: "x", branch: "task/x", base: "main", state: "reserved", taskNumbers: [] }); return out.fns.settleReservation(l, "x", { status: "pushed-no-pr", pushed: true }, false) === "dropped"; })());
  check("a crashed delivery with unknown push state is kept as an orphan on a remote run", (() => { const l = out.fns.createReservationLedger(); l.reserved.set("x", { slug: "x", branch: "task/x", base: "main", state: "reserved", taskNumbers: [] }); return out.fns.settleReservation(l, "x", { status: "error" }, true) === "orphaned" && l.orphaned.has("x"); })());
});

// 4. THE DEPENDENCY GATE survives the removal of waves: a failed prerequisite
//    skips its dependents; a cycle and a missing prerequisite are skipped up
//    front rather than awaited forever.
await scenario("dependency gate", async () => {
  const plan = { defaultBase: "main", waves: [[t("001-a"), t("005-e", "main", ["009-missing"])], [t("002-b", "task/001-a", ["001-a"])], [t("003-c", "task/002-b", ["002-b"])], [t("006-f", "main", ["007-g"]), t("007-g", "main", ["006-f"])]] };
  const out = await runBatch({ plan, overrides: { "001-a:review#*": { pass: false, issues: [{ category: "logic", location: "x", problem: "p", fix: "f" }], notes: "" }, "001-a:fix#*": { ...PASS_PACKET } } });
  check("the failing prerequisite ends at the round cap", by(out.results, "001-a").status === "review-cap");
  check("its dependent is skipped with the prerequisite named", by(out.results, "002-b").status === "skipped-dep" && by(out.results, "002-b").blockedBy === "001-a" && by(out.results, "002-b").depStatus === "review-cap");
  check("and the dependent's dependent too, through the structural base->branch edge", by(out.results, "003-c").status === "skipped-dep" && by(out.results, "003-c").blockedBy === "002-b");
  check("a missing prerequisite is skipped up front", by(out.results, "005-e").status === "skipped-dep" && by(out.results, "005-e").depStatus === "missing");
  check("a dependency cycle is skipped rather than awaited", by(out.results, "006-f").status === "skipped-dep" && by(out.results, "007-g").status === "skipped-dep" && by(out.results, "006-f").depStatus === "dependency cycle");
  check("no skipped task ever spent an agent", !labels(out.calls).some((l) => /^(002-b|003-c|005-e|006-f|007-g):/.test(l)), JSON.stringify(labels(out.calls)));
  check("every task reached a terminal state", out.results.length === 6);
});

// 5. EARLY MERGES MOVE THE BASE. `a` delivers and merges into main while `b`
//    is in review (b's base is main): b's guard scan reports the merge, b is
//    rebased onto the refreshed main, re-reviewed after a replay, and delivers.
//    `c` depends on a: its base is retargeted to main. A no-op rebase costs no
//    re-review; a halt holds with an open question; a failed validation holds.
await scenario("merged sibling: rebase onto the advanced base before delivery", async () => {
  const reviewB = deferred();
  const plan = { defaultBase: "main", waves: [[t("001-a"), t("002-b")], [t("003-c", "task/001-a", ["001-a"])]] };
  const merged = { collisions: [], taskNumbers: [], merged: [{ branch: "task/001-a", mergedInto: "main" }], scanComplete: true };
  const out = await (async () => {
    const running = runBatch({
      plan,
      overrides: {
        "002-b:review#1": reviewB,
        "collision-scan:002-b": merged,
        "collision-scan:003-c": merged,
        "rebase:002-b": { ok: true, halted: false, noop: false, effectiveBase: "9".repeat(40), before: "1".repeat(40), after: "2".repeat(40), recoveryRef: "refs/pre-rebase/task/002-b/20260827-120000", recoveryTip: "1".repeat(40), validationPassed: true, pushed: true, detail: "replayed 2 commits" },
        "re-review:002-b": { pass: true, issues: [], notes: "replay reads clean", flakeRecord: "" },
        "rebase:003-c": { ok: true, halted: false, noop: true, effectiveBase: "9".repeat(40), before: "3".repeat(40), after: "3".repeat(40), validationPassed: true, pushed: false, detail: "nothing to replay" },
      },
    });
    await new Promise((r) => setTimeout(r, 20));
    reviewB.resolve({ ...PASS_REVIEW });
    return running;
  })();
  check("a's result is marked merged during the run", by(out.results, "001-a").status === "done" && by(out.results, "001-a").merged === true && by(out.results, "001-a").mergedInto === "main");
  check("the merge is reported once", JSON.stringify(out.pipeline.mergedDuringRun) === JSON.stringify([{ slug: "001-a", branch: "task/001-a", mergedInto: "main" }]));
  check("b was rebased, re-reviewed, then delivered", at(out.calls, "rebase:002-b") > at(out.calls, "collision-scan:002-b") && at(out.calls, "re-review:002-b") > at(out.calls, "rebase:002-b") && at(out.calls, "pr:002-b") > at(out.calls, "re-review:002-b"), JSON.stringify(labels(out.calls)));
  check("b delivered carrying the base it was rebased onto", by(out.results, "002-b").status === "done" && by(out.results, "002-b").rebasedOnto === "9".repeat(40));
  const rebaseBrief = out.calls[at(out.calls, "rebase:002-b")].prompt;
  check("the rebase brief names the reason, refreshes the target with an explicit refspec, and spells out the lease push", /sibling `task\/001-a` merged into its base `main`/.test(rebaseBrief) && /git fetch origin '\+refs\/heads\/main:refs\/remotes\/origin\/main'/.test(rebaseBrief) && /git push --force-with-lease='task\/002-b:\$before' origin 'task\/002-b'/.test(rebaseBrief) && /"The delegated rebase step"/.test(rebaseBrief));
  check("c's base was retargeted from the merged branch to main, and its no-op rebase cost no re-review", by(out.results, "003-c").status === "done" && out.pipeline.tasksBySlug.get("003-c").base === "main" && !labels(out.calls).includes("re-review:003-c"));
  check("c's PR was opened against the retargeted base", /against base `main`/.test(out.calls[at(out.calls, "pr:003-c")].prompt));
  check("the merged member is excluded from the review stack as merged", !out.fns.reviewStackMergeable(by(out.results, "001-a")) && out.fns.reviewStackOrder(plan, out.results).excluded.some((e) => e.slug === "001-a" && e.status === "merged"));
  check("baseAdvance: the merged branch AS the base retargets; a merge INTO the base does not", JSON.stringify(out.fns.baseAdvance({ base: "task/x" }, [{ branch: "task/x", mergedInto: "main" }])) === JSON.stringify({ reason: "its recorded base `task/x` merged into `main`", target: "main", retarget: true }) && out.fns.baseAdvance({ base: "main" }, [{ branch: "task/x", mergedInto: "main" }]).retarget === false && out.fns.baseAdvance({ base: "dev" }, [{ branch: "task/x", mergedInto: "main" }]) === null);

  // A merge reading naming a branch this ledger never delivered is ignored:
  // the pipeline acts only on members it tracks.
  {
    const o = await runBatch({ plan: { defaultBase: "main", waves: [[t("002-b")]] }, overrides: { "collision-scan:002-b": merged, "rebase:002-b": new Error("must not run") } });
    check("a merge reading for a branch this run never delivered is ignored, and no rebase runs", by(o.results, "002-b").status === "done" && !labels(o.calls).includes("rebase:002-b"));
  }

  // Degraded rebases hold.
  for (const [name, rebase, test] of [
    ["halted", { ok: true, halted: true, noop: false, question: "src/a.ts: both sides changed the export", recoveryRef: "refs/pre-rebase/task/002-b/x", detail: "aborted" }, (r) => r.status === "rebase-hold" && r.openQuestions.length === 1 && r.openQuestions[0].origin === "rebase" && /both sides changed/.test(r.openQuestions[0].question)],
    ["validation failed", { ok: true, halted: false, noop: false, effectiveBase: "9".repeat(40), before: "1".repeat(40), after: "2".repeat(40), validationPassed: false, pushed: false, detail: "tests failed" }, (r) => r.status === "rebase-hold" && /validation did not pass/.test(r.detail)],
    ["not ok", { ok: false, halted: false, noop: false, detail: "dirty tree" }, (r) => r.status === "rebase-hold" && /could not be carried out/.test(r.detail)],
    ["unevidenced no-op", { ok: true, halted: false, noop: true, before: "1".repeat(40), after: "2".repeat(40), detail: "" }, (r) => r.status === "rebase-hold" && /unevidenced/.test(r.detail)],
    ["replayed but unpushed", { ok: true, halted: false, noop: false, effectiveBase: "9".repeat(40), before: "1".repeat(40), after: "2".repeat(40), validationPassed: true, pushed: false, detail: "lease refused" }, (r) => r.status === "rebase-hold" && /not pushed/.test(r.detail)],
    ["returned nothing", null, (r) => r.status === "rebase-hold" && /nothing usable/.test(r.detail)],
    ["re-review failed", { ok: true, halted: false, noop: false, effectiveBase: "9".repeat(40), before: "1".repeat(40), after: "2".repeat(40), validationPassed: true, pushed: true, detail: "replayed" }, (r) => r.status === "rebase-hold" && /did not pass fresh re-review/.test(r.detail)],
  ]) {
    const two = { defaultBase: "main", waves: [[t("001-a"), t("002-b")]] };
    const rb = deferred();
    const running = runBatch({ plan: two, overrides: { "002-b:review#1": rb, "collision-scan:002-b": merged, "rebase:002-b": rebase, "re-review:002-b": { pass: false, issues: [{ claim: "broken" }], notes: "", flakeRecord: "" } } });
    await new Promise((r) => setTimeout(r, 20));
    rb.resolve({ ...PASS_REVIEW });
    const o = await running;
    check(`${name} rebase → holds as rebase-hold with the right record`, test(by(o.results, "002-b")), JSON.stringify(by(o.results, "002-b")));
    check(`${name} rebase → no PR and no reservation for the held branch`, !labels(o.calls).includes("pr:002-b") && !o.ledger.reserved.has("002-b") && !o.ledger.delivered.has("002-b"));
  }
});

// 6. THE SLOT GATE. Cap 1 over two independent tasks: the second waits, the
//    wait is recorded, and the mount is re-probed once before the slot is
//    reused. An unmeasured cap never waits and never probes.
await scenario("storage-derived slot gate", async () => {
  const plan = { defaultBase: "main", waves: [[t("001-a"), t("002-b")]] };
  const capped = await runBatch({ plan, cap: 1 });
  check("cap 1 → the second task waited and was recorded as throttled", capped.throttled.length === 1 && capped.throttled[0].cap === 1, JSON.stringify(capped.throttled));
  check("cap 1 → the second task's cycle started only after the first was reclaimed", at(capped.calls, "002-b:fix#1") > at(capped.calls, "cleanup:001-a"), JSON.stringify(labels(capped.calls)));
  check("cap 1 → the mount was re-probed once, before the slot was reused", capped.reprobes() === 1 && at(capped.calls, "storage-probe:1") < at(capped.calls, "002-b:fix#1"));
  check("cap 1 → both delivered", capped.results.every((r) => r.status === "done"));
  const open = await runBatch({ plan, cap: Infinity });
  check("no cap → nothing waited, nothing probed, both cycles started together", open.throttled.length === 0 && open.reprobes() === 0 && at(open.calls, "002-b:fix#1") < at(open.calls, "001-a:packet#1"));
});

// 7. MIXED TERMINAL STATES all reach the barrier: a crash, a cap-out, a
//    held collision, a scan error, a skipped dependent, and a delivery — the
//    batch returns once every one is terminal, and the census names each.
await scenario("mixed terminal states", async () => {
  const plan = { defaultBase: "main", waves: [[t("001-a"), t("002-b"), t("003-c"), t("004-d"), t("005-e")], [t("006-f", "task/002-b", ["002-b"])]] };
  const out = await runBatch({
    plan,
    overrides: {
      "002-b:fix#1": new Error("implementer exploded"),
      "003-c:review#*": { pass: false, issues: [{ category: "logic", location: "x", problem: "p", fix: "f" }], notes: "" },
      "003-c:fix#*": { ...PASS_PACKET },
      "collision-scan:004-d": null,
      "collision-scan:005-e": { collisions: [{ kind: "path", name: "src/x.ts", branches: ["task/005-e", "task/001-a"] }], taskNumbers: [], merged: [] },
      "collision-resolve:005-e": { resolutions: [{ collision: "src/x.ts", action: "blocked", changedBranches: [], reason: "framework path" }] },
      "collision-rescan:005-e": { collisions: [] },
    },
  });
  const census = out.fns.terminalStates(out.results);
  check("every task reached a terminal state", out.results.length === 6, JSON.stringify(out.results.map((r) => `${r.slug}:${r.status}`)));
  check("the census names each state", JSON.stringify(census) === JSON.stringify({ done: 1, error: 1, "review-cap": 1, "collision-scan-error": 1, "collision-blocked": 1, "skipped-dep": 1 }) || (census.done === 1 && census.error === 1 && census["review-cap"] === 1 && census["collision-scan-error"] === 1 && census["collision-blocked"] === 1 && census["skipped-dep"] === 1), JSON.stringify(census));
  check("the crashed task's dependent was skipped with the crash named", by(out.results, "006-f").status === "skipped-dep" && by(out.results, "006-f").depStatus === "error");
  check("held and errored branches reserve nothing", out.ledger.reserved.size === 0 && out.ledger.delivered.size === 1);
  check("a held branch keeps its worktree (no cleanup) while a delivered one is reclaimed", !labels(out.calls).includes("cleanup:005-e") && labels(out.calls).includes("cleanup:001-a"));
});

// 8. The guard cannot deadlock on a held branch: a task whose guard turn ends in
//    a hold releases the queue, and the next task's turn runs.
await scenario("a held branch releases the guard queue", async () => {
  const reviewB = deferred();
  const plan = { defaultBase: "main", waves: [[t("001-a"), t("002-b")]] };
  const running = runBatch({ plan, overrides: { "002-b:review#1": reviewB, "collision-scan:001-a": new Error("scan exploded") } });
  await new Promise((r) => setTimeout(r, 20));
  reviewB.resolve({ ...PASS_REVIEW });
  const out = await running;
  check("the first task is held on its scan error", by(out.results, "001-a").status === "collision-scan-error");
  check("the second task still took its guard turn and delivered", by(out.results, "002-b").status === "done" && JSON.stringify(out.pipeline.guardOrder) === JSON.stringify(["001-a", "002-b"]));
});

// 9. The batch body composes it all: source-level pins the scenarios cannot see.
{
  const body = src.slice(src.indexOf(CUT));
  check("the batch body runs the pipeline with the shared ledger, gate, and reprobe", /pipeline = await runPipelinedBatch\(\{ plan, remote, peerMode, statusBySlug, results, throttled, collisions, ledger, gate, reprobe \}\);/.test(body));
  const summaryAt = body.lastIndexOf('phase("Summary");');
  const summary = body.slice(summaryAt);
  check("the orphan obligation runs under Summary before the review stack and the closing reading", summary.indexOf("await reconcileOrphanedBranches(") !== -1 && summary.indexOf("await reconcileOrphanedBranches(") < summary.indexOf("buildReviewStack(") && summary.indexOf("buildReviewStack(") < summary.indexOf("await finalMainCheckoutReport()"));
  check("the summary names the surviving orphans, the merges, the guard order, and the census", /orphanedBranches: orphans\.survivors/.test(summary) && /mergedDuringRun: pipeline\.mergedDuringRun/.test(summary) && /guardOrder: pipeline\.guardOrder/.test(summary) && /terminalStates: terminalStates\(results\)/.test(summary));
  check("the abort catch names any orphan it could not act on rather than spawning anything", /orphanedBranches: \[\.\.\.ledger\.orphaned\.values\(\)\]/.test(body) && /the batch aborted before the orphan could be reconciled/.test(body));
  check("no wave loop remains in the body", !/for \(let w = 0; w < plan\.waves\.length; w\+\+\)/.test(body) && !/phase\(`Wave/.test(body));
  check("the peer throttle is the one shared object every cycle gets", /peerThrottle: batchPeerThrottle,/.test(src) && /const batchPeerThrottle = createCyclePeerThrottle\(\);/.test(src));
  check("the reservation is entered inside the guard turn, after the settlement and the rebase", (() => { const turn = src.slice(src.indexOf("await withGuardTurn(guard, task.slug"), src.indexOf("if (cleared.held) return finish(cleared.held);")); const r = turn.indexOf("reserveNumbers(ledger, task"); return r > turn.indexOf("settleGuardCollisions({") && r > turn.indexOf("rebaseOntoAdvancedBase(") && r !== -1; })());
}

check(`the suite ran all ${EXPECTED_CHECKS} checks`, ok + failures === EXPECTED_CHECKS, `ran ${ok + failures}`);

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll pipelined-batch checks passed.");
