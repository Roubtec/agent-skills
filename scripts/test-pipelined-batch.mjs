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
const EXPECTED_CHECKS = 140;

async function scenario(name, fn) {
  try {
    await fn();
  } catch (err) {
    check(`${name} ran without throwing`, false, String((err && err.stack) || err));
  }
}

const NAMES = ["runPipelinedBatch", "createReservationLedger", "createSlotGate", "settleReservation", "orphanSurvivors", "terminalStates", "abortedReservationReport", "reviewStackMergeable", "reviewStackOrder", "unschedulable", "effectiveDeps", "baseAdvance", "DEP_SUCCEEDED"];
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
      else if (label.startsWith("cleanup:")) value = { removed: true, reason: "" };
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
  // The body's own pre-run default, handed in by reference: the abort catch
  // reads it live, so the suite pins that the batch writes into it.
  const pipeline = { tasksBySlug: new Map(), guardOrder: [], mergedDuringRun: [], orphanReconciliation: [] };
  const returned = await fns.runPipelinedBatch({ plan, remote, peerMode: "off", statusBySlug, results, throttled, collisions, ledger, gate, pipeline });
  if (returned !== pipeline) throw new Error("runPipelinedBatch must return the live pipeline object it was handed");
  return { fns, calls, events, statusBySlug, results, throttled, collisions, ledger, gate, pipeline };
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
  check("b's reservation is the re-scan's claim — the number it renumbered TO, not the one it renumbered away from", JSON.stringify(out.ledger.delivered.get("002-b").taskNumbers) === JSON.stringify(["043"]), JSON.stringify(out.ledger.delivered.get("002-b").taskNumbers));
  check("the collisions the batch reports carry the guard that found them", out.collisions.length === 1 && out.collisions[0].guard === "002-b");
});

// 3. ASYMMETRIC RELEASE and the orphan obligation. Independent tasks: `p`
//    pushes but its PR creation fails (orphan, reconciled by a PR retry); `q`
//    pushes without a PR (orphan, reconciled by deleting the branch); `r`
//    pushes without a PR and survives both (named in the summary with its
//    numbers); `s` fails delivery with NO remote write (reservation dropped,
//    no orphan step at all); `n` returns no PR packet at all. Each orphan is
//    acted on INSIDE its own pipeline, before its terminal state is announced:
//    `dp` depends on `p` and runs on the recovered `done`; `dq` depends on `q`
//    and is skipped, since a branch deleted from origin is `local-only` on a
//    remote run and no dependent may stack a PR on it. A later task `z` sees
//    the survivor still RESERVED and the recovered one DELIVERED with its PR.
await scenario("orphaned pushed branches are reconciled in their own pipeline, and dependents read the reconciled state", async () => {
  const zReview = deferred();
  const plan = { defaultBase: "main", waves: [[t("010-p"), t("011-q"), t("012-r"), t("013-s"), t("014-z"), t("015-n")], [t("016-dp", "task/010-p", ["010-p"]), t("017-dq", "task/011-q", ["011-q"])]] };
  const running = runBatch({
    plan,
    overrides: {
      "collision-scan:010-p": { ...CLEAN_SCAN, taskNumbers: ["010"] },
      "collision-scan:012-r": { ...CLEAN_SCAN, taskNumbers: ["012", "012a"] },
      "collision-scan:015-n": { ...CLEAN_SCAN, taskNumbers: ["015"] },
      "pr:010-p": { opened: false, pushed: true, reason: "gh pr create failed after the push" },
      "pr:011-q": { opened: false, pushed: true, reason: "API error" },
      "pr:012-r": { opened: false, pushed: true, reason: "API error" },
      "pr:013-s": { opened: false, pushed: false, reason: "push refused" },
      // No packet at all: the agent may have pushed before it lost its report.
      "pr:015-n": null,
      "014-z:review#1": zReview,
      "orphan:010-p": { outcome: "pr-opened", url: "https://example.invalid/pr/10", baseOk: true, reason: "retry succeeded" },
      "orphan:011-q": { outcome: "branch-deleted", reason: "PR retry failed; branch deleted from origin" },
      "orphan:012-r": { outcome: "unresolved", reason: "gh unreachable; delete refused" },
      "orphan:015-n": { outcome: "not-on-origin", reason: "ls-remote printed nothing" },
    },
  });
  await new Promise((r) => setTimeout(r, 30));
  zReview.resolve({ ...PASS_REVIEW });
  const out = await running;
  const L = labels(out.calls);
  const zScan = out.calls[at(out.calls, "collision-scan:014-z")].prompt;
  check("a later guard scan still sees the surviving orphan as RESERVED", /task\/012-r[^\n]*RESERVED/.test(zScan), zScan.slice(0, 600));
  check("and sees the orphan whose PR retry succeeded as DELIVERED with that PR", /task\/010-p[^\n]*DELIVERED[^\n]*pr\/10/.test(zScan), zScan.slice(0, 600));
  check("and does not see the branch whose delivery made no remote write", !/task\/013-s/.test(zScan));
  check("a null PR packet leaves the push state unknown: pushed-no-pr, so it was acted on as an orphan rather than dropped", L.includes("orphan:015-n") && by(out.results, "015-n").status === "local-only" && /returned nothing/.test(by(out.results, "015-n").reason) && /never landed/.test(by(out.results, "015-n").reason), JSON.stringify(by(out.results, "015-n")));
  check("each orphan was acted on inside its own pipeline, right after its delivery", ["010-p", "011-q", "012-r", "015-n"].every((x) => at(out.calls, `orphan:${x}`) > at(out.calls, `cleanup:${x}`)) && at(out.calls, "orphan:010-p") < at(out.calls, "016-dp:fix#1"), JSON.stringify(L));
  check("the batch records exactly the four actions", JSON.stringify(out.pipeline.orphanReconciliation.map((a) => `${a.slug}:${a.outcome}`).sort()) === JSON.stringify(["010-p:pr-opened", "011-q:branch-deleted", "012-r:unresolved", "015-n:not-on-origin"]), JSON.stringify(out.pipeline.orphanReconciliation));
  check("a PR retried successfully converts the result to done, marked late", by(out.results, "010-p").status === "done" && by(out.results, "010-p").prUrl === "https://example.invalid/pr/10" && by(out.results, "010-p").lateDelivery === true);
  check("its dependent ran on that recovered state and delivered", by(out.results, "016-dp").status === "done" && at(out.calls, "016-dp:fix#1") > at(out.calls, "orphan:010-p"));
  check("a deleted branch reads as local-only with the reason", by(out.results, "011-q").status === "local-only" && /deleted from origin/.test(by(out.results, "011-q").reason));
  check("its dependent is skipped: local-only on a remote run is a branch origin no longer carries", by(out.results, "017-dq").status === "skipped-dep" && by(out.results, "017-dq").depStatus === "local-only" && !L.some((l) => l.startsWith("017-dq:")));
  check("the dependency gate reads local-only as success on a no-remote run only", out.fns.DEP_SUCCEEDED("local-only", false) && !out.fns.DEP_SUCCEEDED("local-only", true) && out.fns.DEP_SUCCEEDED("done", true) && !out.fns.DEP_SUCCEEDED("pushed-no-pr", true));
  const survivors = out.fns.orphanSurvivors(out.ledger);
  check("a survivor is named beside the numbers it still holds, with the reason its action reported", JSON.stringify(survivors) === JSON.stringify([{ slug: "012-r", branch: "task/012-r", taskNumbers: ["012", "012a"], reason: "gh unreachable; delete refused" }]), JSON.stringify(survivors));
  // Held-ness lives in the ledger, which is what the reconciliation and the
  // summary read. A copy on the result would only latch: reconciliation spreads
  // the prior result into its `done`/`local-only` rewrite, so a claim since
  // settled and converted would still read as held on a final state — 025's
  // no-latched-flags case exactly.
  check("no result carries a held-the-claim flag for the reconciliation to latch onto a settled final state", !out.results.some((r) => "reservationHeld" in r), JSON.stringify(out.results.map((r) => ({ slug: r.slug, status: r.status, reservationHeld: r.reservationHeld }))));
  check("the survivor's result is flagged orphaned and stays pushed-no-pr", by(out.results, "012-r").status === "pushed-no-pr" && by(out.results, "012-r").orphaned === true);
  check("the no-remote-write failure dropped its reservation and got no orphan step", !out.ledger.orphaned.has("013-s") && !out.ledger.reserved.has("013-s") && !L.includes("orphan:013-s"));
  check("the census reads the mixed terminal states", (() => { const c = out.fns.terminalStates(out.results); return c.done === 3 && c["local-only"] === 2 && c["pushed-no-pr"] === 2 && c["skipped-dep"] === 1 && Object.keys(c).length === 4; })(), JSON.stringify(out.fns.terminalStates(out.results)));
  check("the orphan brief spells out the PR retry and the guarded delete, and names the numbers", (() => { const p = out.calls.find((c) => c.label === "orphan:012-r").prompt; return /Retry PR creation ONCE/.test(p) && /git push origin --delete 'task\/012-r'/.test(p) && /`012`, `012a`/.test(p); })());
  check("a no-remote ledger never orphans", (() => { const l = out.fns.createReservationLedger(); l.reserved.set("x", { slug: "x", branch: "task/x", base: "main", state: "reserved", taskNumbers: [] }); return out.fns.settleReservation(l, "x", { status: "pushed-no-pr", pushed: true }, false) === "dropped"; })());
  check("a crashed delivery with unknown push state is kept as an orphan on a remote run", (() => { const l = out.fns.createReservationLedger(); l.reserved.set("x", { slug: "x", branch: "task/x", base: "main", state: "reserved", taskNumbers: [] }); return out.fns.settleReservation(l, "x", { status: "error" }, true) === "orphaned" && l.orphaned.has("x"); })());
  // An orphan step that THROWS is an unresolved survivor, never a batch abort.
  {
    const o = await runBatch({ plan: { defaultBase: "main", waves: [[t("001-a")]] }, overrides: { "collision-scan:001-a": { ...CLEAN_SCAN, taskNumbers: ["001"] }, "pr:001-a": { opened: false, pushed: true, reason: "API error" }, "orphan:001-a": new Error("orphan agent exploded") } });
    check("an orphan action that throws leaves the orphan a named survivor rather than aborting the batch", by(o.results, "001-a").status === "pushed-no-pr" && by(o.results, "001-a").orphaned === true && JSON.stringify(o.fns.orphanSurvivors(o.ledger)) === JSON.stringify([{ slug: "001-a", branch: "task/001-a", taskNumbers: ["001"], reason: "orphan reconciliation returned nothing usable" }]), JSON.stringify(o.fns.orphanSurvivors(o.ledger)));
  }
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
  check("the rebase brief names the reason, refreshes the target with an explicit refspec, and spells out the lease push", /sibling `task\/001-a` merged into its base `main`/.test(rebaseBrief) && /git fetch origin '\+refs\/heads\/main:refs\/remotes\/origin\/main'/.test(rebaseBrief) && /git push --force-with-lease='task\/002-b':"\$before" origin 'task\/002-b'/.test(rebaseBrief) && /"The delegated rebase step"/.test(rebaseBrief));
  check("c's base was retargeted from the merged branch to main, and its no-op rebase cost no re-review", by(out.results, "003-c").status === "done" && out.pipeline.tasksBySlug.get("003-c").base === "main" && !labels(out.calls).includes("re-review:003-c"));
  check("c's no-op still carries the full base OID the deputy pinned", by(out.results, "003-c").rebasedOnto === "9".repeat(40), JSON.stringify(by(out.results, "003-c")));
  check("c's PR was opened against the retargeted base", /against base `main`/.test(out.calls[at(out.calls, "pr:003-c")].prompt));
  check("c's ledger entry followed the retarget, so a sibling's scan reads the member by its new base", out.ledger.delivered.get("003-c").base === "main");
  // The rebase runs OUTSIDE the guard turn, under the reservation: a sibling
  // whose cycle passes while b is mid-rebase takes its turn and sees b RESERVED,
  // rather than queueing behind b's replay, build, tests, and re-review.
  {
    const rb = deferred();
    const reviewD = deferred();
    let scanD = null;
    const running = runBatch({
      plan: { defaultBase: "main", waves: [[t("001-a"), t("002-b"), t("004-d")]] },
      overrides: {
        "002-b:review#1": rb,
        "004-d:review#1": reviewD,
        "collision-scan:002-b": { ...merged, taskNumbers: ["002"] },
        "collision-scan:004-d": (prompt) => { scanD = prompt; return { ...CLEAN_SCAN }; },
        "rebase:002-b": deferred(),
      },
    });
    await new Promise((r) => setTimeout(r, 20));
    rb.resolve({ ...PASS_REVIEW });
    await new Promise((r) => setTimeout(r, 20));
    // b is now inside its deferred rebase; d's review returns and d enters the guard.
    reviewD.resolve({ ...PASS_REVIEW });
    await new Promise((r) => setTimeout(r, 20));
    check("a sibling took its guard turn while the rebase was still pending", scanD !== null && /task\/002-b[^\n]*RESERVED/.test(scanD), scanD && scanD.slice(0, 400));
    const o = await Promise.race([running, new Promise((r) => setTimeout(() => r("pending"), 5))]);
    check("the batch itself is still waiting on that rebase", o === "pending");
  }
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
    ["unevidenced no-op", { ok: true, halted: false, noop: true, effectiveBase: "9".repeat(40), before: "1".repeat(40), after: "2".repeat(40), detail: "" }, (r) => r.status === "rebase-hold" && /unevidenced/.test(r.detail)],
    ["no-op with abbreviated tips", { ok: true, halted: false, noop: true, effectiveBase: "9".repeat(40), before: "abc1234", after: "abc1234", detail: "" }, (r) => r.status === "rebase-hold" && /two equal full-OID tips/.test(r.detail)],
    ["no-op without an effective base", { ok: true, halted: false, noop: true, before: "3".repeat(40), after: "3".repeat(40), detail: "" }, (r) => r.status === "rebase-hold" && /no full effective-base OID/.test(r.detail)],
    ["no-op with an abbreviated effective base", { ok: true, halted: false, noop: true, effectiveBase: "main", before: "3".repeat(40), after: "3".repeat(40), detail: "" }, (r) => r.status === "rebase-hold" && /no full effective-base OID/.test(r.detail)],
    ["replay without an effective base", { ok: true, halted: false, noop: false, before: "1".repeat(40), after: "2".repeat(40), validationPassed: true, pushed: true, detail: "replayed" }, (r) => r.status === "rebase-hold" && /no full effective-base OID/.test(r.detail)],
    ["replayed but unpushed", { ok: true, halted: false, noop: false, effectiveBase: "9".repeat(40), before: "1".repeat(40), after: "2".repeat(40), validationPassed: true, pushed: false, detail: "lease refused" }, (r) => r.status === "rebase-hold" && /not pushed/.test(r.detail)],
    ["returned nothing", null, (r) => r.status === "rebase-hold" && /nothing usable/.test(r.detail)],
    ["re-review failed", { ok: true, halted: false, noop: false, effectiveBase: "9".repeat(40), before: "1".repeat(40), after: "2".repeat(40), validationPassed: true, pushed: true, detail: "replayed" }, (r) => r.status === "rebase-hold" && /did not pass fresh re-review/.test(r.detail)],
  ]) {
    const two = { defaultBase: "main", waves: [[t("001-a"), t("002-b")]] };
    const rb = deferred();
    const running = runBatch({ plan: two, overrides: { "002-b:review#1": rb, "collision-scan:002-b": { ...merged, taskNumbers: ["002"] }, "rebase:002-b": rebase, "re-review:002-b": { pass: false, issues: [{ claim: "broken" }], notes: "", flakeRecord: "" } } });
    await new Promise((r) => setTimeout(r, 20));
    rb.resolve({ ...PASS_REVIEW });
    const o = await running;
    check(`${name} rebase → holds as rebase-hold with the right record`, test(by(o.results, "002-b")), JSON.stringify(by(o.results, "002-b")));
    check(`${name} rebase → no PR and no reservation for the held branch`, !labels(o.calls).includes("pr:002-b") && !o.ledger.reserved.has("002-b") && !o.ledger.delivered.has("002-b") && !o.ledger.orphaned.has("002-b"));
    check(`${name} rebase → the retarget did not move the recorded base`, o.pipeline.tasksBySlug.get("002-b").base === "main");
    check(`${name} rebase → the held result carries the numbers its released claim held`, JSON.stringify(by(o.results, "002-b").taskNumbers) === JSON.stringify(["002"]), JSON.stringify(by(o.results, "002-b")));
  }

  // The post-rebase re-review is the tier the replay owes, and a re-review that
  // THROWS has paid it no more than one that comes back failing — so it takes
  // the same exit, held before delivery. Were it left to escape to the
  // pipeline's catch, that catch would settle the still-held claim as an
  // orphan, and the terminal stage discharges an orphan by RETRYING `gh pr
  // create`: the PR would open on a replayed tip (step 7 force-pushed it) that
  // no delivery-tier pass ever saw.
  {
    const rb = deferred();
    const running = runBatch({
      plan: { defaultBase: "main", waves: [[t("001-a"), t("002-b")]] },
      overrides: {
        "002-b:review#1": rb,
        "collision-scan:002-b": { ...merged, taskNumbers: ["002"] },
        "rebase:002-b": { ok: true, halted: false, noop: false, effectiveBase: "9".repeat(40), before: "1".repeat(40), after: "2".repeat(40), validationPassed: true, pushed: true, detail: "replayed" },
        "re-review:002-b": new Error("re-review agent crashed"),
      },
    });
    await new Promise((r) => setTimeout(r, 20));
    rb.resolve({ ...PASS_REVIEW });
    const o = await running;
    const b = by(o.results, "002-b");
    check("a re-review that THROWS holds the branch exactly as a failing one does — no PR, and no orphan for the terminal stage to open one for", !!b && b.status === "rebase-hold" && /fresh re-review crashed \(re-review agent crashed\)/.test(b.detail) && !labels(o.calls).includes("pr:002-b") && !o.ledger.reserved.has("002-b") && !o.ledger.orphaned.has("002-b") && !o.ledger.delivered.has("002-b"), JSON.stringify({ b, orphaned: [...o.ledger.orphaned.keys()], reserved: [...o.ledger.reserved.keys()] }));
  }

  // A crash PAST the delivery gate — the re-review passed, the PR step itself
  // throws — is the case the orphan routing is for: the push may have landed,
  // so the claim is settled as an orphan the terminal stage acts on and the
  // summary names, rather than an entry no stage reconciles or reports.
  {
    const rb = deferred();
    const running = runBatch({
      plan: { defaultBase: "main", waves: [[t("001-a"), t("002-b")]] },
      overrides: {
        "002-b:review#1": rb,
        "collision-scan:002-b": { ...merged, taskNumbers: ["002"] },
        "rebase:002-b": { ok: true, halted: false, noop: false, effectiveBase: "9".repeat(40), before: "1".repeat(40), after: "2".repeat(40), validationPassed: true, pushed: true, detail: "replayed" },
        "re-review:002-b": { pass: true, issues: [], notes: "replay reads clean", flakeRecord: "" },
        "pr:002-b": new Error("gh pr create crashed"),
        "orphan:002-b": { outcome: "unresolved", reason: "gh unreachable; delete refused" },
      },
    });
    await new Promise((r) => setTimeout(r, 20));
    rb.resolve({ ...PASS_REVIEW });
    const o = await running;
    const b = by(o.results, "002-b");
    check("a delivery that throws past the gate ends the task `error` with its claim settled as an orphan and acted on at once, not stranded in `reserved`", !!b && b.status === "error" && /delivery crashed: gh pr create crashed/.test(b.detail) && b.pushed === undefined && b.orphaned === true && o.ledger.orphaned.has("002-b") && o.ledger.reserved.has("002-b") && !o.ledger.delivered.has("002-b") && at(o.calls, "orphan:002-b") > at(o.calls, "pr:002-b"), JSON.stringify({ b, orphaned: [...o.ledger.orphaned.keys()], reserved: [...o.ledger.reserved.keys()], labels: labels(o.calls) }));
    check("the summary names the survivor with its number", o.pipeline.orphanReconciliation.some((a) => a.slug === "002-b") && JSON.stringify(o.fns.orphanSurvivors(o.ledger)) === JSON.stringify([{ slug: "002-b", branch: "task/002-b", taskNumbers: ["002"], reason: "gh unreachable; delete refused" }]), JSON.stringify(o.fns.orphanSurvivors(o.ledger)));
  }
});

// 6. THE SLOT GATE. Cap 1 over three independent tasks: the later ones wait,
//    each wait is recorded, and the slot handoff spawns NOTHING — it runs from
//    the pipeline's `finally`, past that task's own catch, so an agent call
//    there could only reject the whole batch with siblings mid-cycle and leave
//    the waiters asleep (the round-1 re-probe did exactly that). The cap is the
//    bootstrap's, derived once. An unmeasured cap never waits.
await scenario("storage-derived slot gate", async () => {
  const plan = { defaultBase: "main", waves: [[t("001-a"), t("002-b"), t("003-c")]] };
  const capped = await runBatch({ plan, cap: 1 });
  check("cap 1 → the later tasks waited and were recorded as throttled", capped.throttled.length === 2 && capped.throttled.every((x) => x.cap === 1), JSON.stringify(capped.throttled));
  check("cap 1 → each cycle started only after the previous worktree was reclaimed", at(capped.calls, "002-b:fix#1") > at(capped.calls, "cleanup:001-a") && at(capped.calls, "003-c:fix#1") > at(capped.calls, "cleanup:002-b"), JSON.stringify(labels(capped.calls)));
  check("cap 1 → no agent ran at a slot handoff: the labels are the tasks' own stages, the guard, the PR, and the reclaim", labels(capped.calls).every((l) => /^(001-a|002-b|003-c):|^(collision-scan|pr|cleanup):/.test(l)), JSON.stringify(labels(capped.calls)));
  check("cap 1 → all three delivered and the gate is idle", capped.results.every((r) => r.status === "done") && capped.results.length === 3 && capped.gate.inFlight === 0 && capped.gate.waiters.length === 0);
  const open = await runBatch({ plan, cap: Infinity });
  check("no cap → nothing waited, and the cycles started together", open.throttled.length === 0 && at(open.calls, "002-b:fix#1") < at(open.calls, "001-a:packet#1"));
  // A worktree left in place for inspection is still live: its slot stays
  // held. Cap 1 with a capped-out first task leaves no slot any delivery can
  // free, so the two waiters end `storage-throttled` without spending an agent
  // (and a dependent of one skips on that state) rather than either sleeping
  // forever or being admitted over headroom the retained worktree still holds.
  const capOut = { "001-a:review#*": { pass: false, issues: [{ category: "logic", location: "x", problem: "p", fix: "f" }], notes: "" }, "001-a:fix#*": { ...PASS_PACKET } };
  const retained = await runBatch({ plan: { defaultBase: "main", waves: [[t("001-a"), t("002-b"), t("003-c")], [t("004-d", "task/002-b", ["002-b"])]] }, cap: 1, overrides: capOut });
  check("cap 1, first task retained → the rest end storage-throttled, terminal, with no agent spent", by(retained.results, "001-a").status === "review-cap" && ["002-b", "003-c"].every((x) => by(retained.results, x).status === "storage-throttled" && /held by a worktree left in place/.test(by(retained.results, x).detail)) && !labels(retained.calls).some((l) => /^(002-b|003-c):/.test(l)), JSON.stringify(retained.results.map((r) => `${r.slug}:${r.status}`)));
  check("cap 1, first task retained → each denial is recorded as throttled, and the retained worktree still holds the slot", retained.throttled.filter((x) => x.denied).length === 2 && retained.gate.inFlight === 1 && retained.gate.retained === 1 && retained.gate.waiters.length === 0, JSON.stringify({ throttled: retained.throttled, gate: retained.gate }));
  check("cap 1, first task retained → a dependent of a throttled task skips on that state", by(retained.results, "004-d").status === "skipped-dep" && by(retained.results, "004-d").depStatus === "storage-throttled");
  check("the census names the throttled state", JSON.stringify(retained.fns.terminalStates(retained.results)) === JSON.stringify({ "review-cap": 1, "storage-throttled": 2, "skipped-dep": 1 }), JSON.stringify(retained.fns.terminalStates(retained.results)));
  // Cap 2 with one retained: the one slot left serializes the rest, and
  // nothing is denied while a delivery can still free it.
  const half = await runBatch({ plan, cap: 2, overrides: capOut });
  check("cap 2, one retained → the remaining slot serializes the rest and nothing is denied", by(half.results, "002-b").status === "done" && by(half.results, "003-c").status === "done" && !half.throttled.some((x) => x.denied) && at(half.calls, "003-c:fix#1") > at(half.calls, "cleanup:002-b") && half.gate.inFlight === 1 && half.gate.retained === 1, JSON.stringify({ throttled: half.throttled, labels: labels(half.calls) }));
  // A delivery that throws before the reclaim leaves its worktree too.
  const crashed = await runBatch({ plan: { defaultBase: "main", waves: [[t("001-a"), t("002-b")]] }, cap: 1, overrides: { "pr:001-a": new Error("gh exploded"), "orphan:001-a": { outcome: "branch-deleted", reason: "deleted" } } });
  check("a delivery that threw before the reclaim keeps its slot (its orphan action then settled the branch off origin)", by(crashed.results, "001-a").status === "local-only" && /delivery crashed/.test(by(crashed.results, "001-a").detail) && by(crashed.results, "002-b").status === "storage-throttled" && crashed.gate.retained === 1, JSON.stringify(crashed.results));
  // The reclaim's outcome is READ: a `wt-remove` refusal after a delivered PR
  // leaves the worktree live, so the slot stays held (and, at cap 1, the
  // waiter is denied) while the delivery itself still reads `done`. A cleanup
  // agent that crashes is the same retention, not a delivery error.
  const refused = await runBatch({ plan: { defaultBase: "main", waves: [[t("001-a"), t("002-b")]] }, cap: 1, overrides: { "cleanup:001-a": { removed: false, reason: "wt-remove: refusing — uncommitted changes" } } });
  check("a reclaim `wt-remove` refused keeps its slot: the PR is still done, the worktree is reported retained, and the waiter is denied", by(refused.results, "001-a").status === "done" && /uncommitted changes/.test(by(refused.results, "001-a").worktreeRetained) && by(refused.results, "002-b").status === "storage-throttled" && refused.gate.retained === 1 && refused.gate.inFlight === 1, JSON.stringify({ results: refused.results, gate: refused.gate }));
  check("the cleanup deputy is briefed with a schema that reads the removal back", refused.calls.find((c) => c.label === "cleanup:001-a").schema && refused.calls.find((c) => c.label === "cleanup:001-a").schema.required.includes("removed") && /removed: true/.test(refused.calls.find((c) => c.label === "cleanup:001-a").prompt));
  const cleanupCrashed = await runBatch({ plan: { defaultBase: "main", waves: [[t("001-a"), t("002-b")]] }, cap: 1, overrides: { "cleanup:001-a": new Error("cleanup exploded") } });
  check("a cleanup agent that throws retains the worktree without turning the delivered PR into an error", by(cleanupCrashed.results, "001-a").status === "done" && /cleanup agent crashed: cleanup exploded/.test(by(cleanupCrashed.results, "001-a").worktreeRetained) && !cleanupCrashed.ledger.orphaned.has("001-a") && by(cleanupCrashed.results, "002-b").status === "storage-throttled" && cleanupCrashed.gate.retained === 1, JSON.stringify(cleanupCrashed.results));
  const reclaimedFine = await runBatch({ plan: { defaultBase: "main", waves: [[t("001-a"), t("002-b")]] }, cap: 1 });
  check("a reclaim reported removed releases the slot and marks nothing retained", by(reclaimedFine.results, "001-a").status === "done" && by(reclaimedFine.results, "001-a").worktreeRetained === undefined && by(reclaimedFine.results, "002-b").status === "done" && reclaimedFine.gate.retained === 0, JSON.stringify(reclaimedFine.results));
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

// 8a. A lone first branch that clashes with an OUTSIDE holder (an open PR head,
//     the base) has no run-local member beside it, and still renumbers and
//     clears: the re-scan applies the same comparison set — outside holders
//     included — and its claim is what the reservation records.
await scenario("first branch, outside holder: renumbering clears the guard", async () => {
  const out = await runBatch({
    plan: { defaultBase: "main", waves: [[t("001-a")]] },
    overrides: {
      "collision-scan:001-a": { collisions: [{ kind: "task-number", name: "042", branches: ["task/001-a"], external: true, member: "PR #7", detail: "PR #7 adds tasks/042-x.md" }], taskNumbers: ["042"], merged: [], scanComplete: true },
      "collision-resolve:001-a": { resolutions: [{ collision: "042", action: "renamed", changedBranches: ["task/001-a"], from: "042", to: "043", regenerated: "", reason: "PR #7 holds 042" }] },
      "collision-rescan:001-a": { collisions: [], taskNumbers: ["043"], merged: [], scanComplete: true },
      "re-review:001-a": { pass: true, issues: [], notes: "", flakeRecord: "" },
    },
  });
  check("the lone branch was re-scanned and delivered", labels(out.calls).includes("collision-rescan:001-a") && by(out.results, "001-a").status === "done", JSON.stringify(by(out.results, "001-a")));
  check("its reservation converted to delivered on the renumbered claim", JSON.stringify(out.ledger.delivered.get("001-a").taskNumbers) === JSON.stringify(["043"]));
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
  check("the batch body runs the pipeline with the shared ledger, the gate, and the live pipeline object the abort catch reads", /await runPipelinedBatch\(\{ plan, remote, peerMode, statusBySlug, results, throttled, collisions, ledger, gate, pipeline \}\);/.test(body) && /const pipeline = \{ tasksBySlug: new Map\(\), guardOrder: \[\], mergedDuringRun: \[\], orphanReconciliation: \[\] \};/.test(body));
  check("no df re-probe remains anywhere in the workflow", !/storageProbePrompt|STORAGE_PROBE_SCHEMA|reprobe/.test(src));
  const summaryAt = body.lastIndexOf('phase("Summary");');
  const summary = body.slice(summaryAt);
  check("the Summary spawns nothing for orphans: it names the ledger's survivors and the pipeline's actions, then the review stack, then the closing reading", /const orphans = \{ acted: pipeline\.orphanReconciliation, survivors: orphanSurvivors\(ledger\) \};/.test(summary) && !/await agent\([^\n]*orphan/.test(summary) && summary.indexOf("orphanSurvivors(ledger)") < summary.indexOf("buildReviewStack(") && summary.indexOf("buildReviewStack(") < summary.indexOf("await finalMainCheckoutReport()"));
  check("the pipeline acts on an orphan on both settlement paths — the delivered one and the crash one — before finishing", (() => { const pipe = src.slice(src.indexOf("async function runTaskPipeline("), src.indexOf("function terminalStates(")); return (pipe.match(/=== "orphaned"\) \{\n\s*(?:\/\/[^\n]*\n\s*)?\w+ = await reconcileOrphan\(/g) || []).length === 2; })());
  check("the summary names the surviving orphans, the merges, the guard order, and the census", /orphanedBranches: orphans\.survivors/.test(summary) && /mergedDuringRun: pipeline\.mergedDuringRun/.test(summary) && /guardOrder: pipeline\.guardOrder/.test(summary) && /terminalStates: terminalStates\(results\)/.test(summary));
  check("the abort catch names the ledger's orphans and held reservations through the report helper, rather than spawning anything", /orphanReconciliation: pipeline\.orphanReconciliation, orphanedBranches: abortedReservationReport\(ledger\)/.test(body));
  check("an orphan settled before the abort is named once, under the orphan reason; a claim nothing settled at all is named under the other", (() => { const fns = load(async () => { throw new Error("no agent"); }, []); const l = fns.createReservationLedger(); const x = { slug: "x", branch: "task/x", base: "main", state: "reserved", taskNumbers: ["001"] }; l.reserved.set("x", x); fns.settleReservation(l, "x", { status: "pushed-no-pr", pushed: true }, true); l.reserved.set("y", { slug: "y", branch: "task/y", base: "main", state: "reserved", taskNumbers: ["002"] }); const r = fns.abortedReservationReport(l); return r.length === 2 && r.filter((o) => o.slug === "x").length === 1 && /before the orphan could be reconciled/.test(r.find((o) => o.slug === "x").reason) && /still held its claim/.test(r.find((o) => o.slug === "y").reason); })());
  check("no wave loop remains in the body", !/for \(let w = 0; w < plan\.waves\.length; w\+\+\)/.test(body) && !/phase\(`Wave/.test(body));
  check("the peer throttle is the one shared object every cycle gets", /peerThrottle: batchPeerThrottle,/.test(src) && /const batchPeerThrottle = createCyclePeerThrottle\(\);/.test(src));
  check("the reservation is entered inside the guard turn after the settlement, and the rebase runs after the turn under it", (() => { const turn = src.slice(src.indexOf("await withGuardTurn(guard, task.slug"), src.indexOf("if (cleared.held) return finish(cleared.held);")); const r = turn.indexOf("reserveNumbers(ledger, task"); const rebaseAt = src.indexOf("rebaseOntoAdvancedBase(task, cleared.ready"); return r !== -1 && r > turn.indexOf("settleGuardCollisions({") && !turn.includes("rebaseOntoAdvancedBase(") && rebaseAt > src.indexOf("if (cleared.held) return finish(cleared.held);") && rebaseAt < src.indexOf("delivered = await deliverTask("); })());
}

check(`the suite ran all ${EXPECTED_CHECKS} checks`, ok + failures === EXPECTED_CHECKS, `ran ${ok + failures}`);

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll pipelined-batch checks passed.");
