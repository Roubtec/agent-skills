#!/usr/bin/env node
// Focused test for wf-address-tasks.js's post-batch review stack (task 052):
// the pure planning helpers — the mergeable predicate, the canonical merge
// order, the merge-commit safe prefix, the guide-branch naming — and the
// stage's control flow, `buildReviewStack`, driven with scripted agents.
//
// The workflow is a runtime script (top-level await/return, injected
// `agent`/`phase`/`log` globals), so it cannot be imported. Like the boundary
// suite, this evaluates the declaration prefix above the runtime body with
// those globals passed in as parameters, so what runs here is the shipped
// code rather than a copy. A full `Workflow` run of a real batch is not
// something a script can do; what this pins is everything the script decides
// on its own — which branches count, in what order, where the safe prefix
// ends, which pre-rebase refs the teardown may delete, and that the teardown
// runs on every path that created the worktree while the stage never throws.
//
// Run: node scripts/test-review-stack-plan.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const workflowPath = join(here, "..", "plugins", "dev-skills", "workflows", "wf-address-tasks.js");
const src = readFileSync(workflowPath, "utf8");

const CUT = "\nconst peerMode = /";
const at = src.indexOf(CUT);
if (at < 0) {
  console.error("FAIL: cut marker not found in the workflow source.");
  process.exit(1);
}
const prefix = src.slice(0, at).replace(/^export const meta/m, "const meta");
const NAMES = ["reviewStackMergeable", "reviewStackOrder", "reviewStackSafePrefix", "reviewStackBatchLabel", "reviewStackGuideName", "reviewStackRefSegment", "buildReviewStack", "REVIEW_STACK_MERGEABLE", "REVIEW_STACK_INSPECT_SCHEMA"];
function load({ agent, phase, log }) {
  const body = `"use strict";\n${prefix}\nreturn { ${NAMES.join(", ")} };`;
  // eslint-disable-next-line no-new-func
  return new Function("args", "agent", "phase", "log", body)("", agent, phase, log);
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`ok  - ${name}`);
  } else {
    failures++;
    console.error(`NOT ok - ${name}${detail ? `: ${detail}` : ""}`);
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const pure = load({ agent: () => { throw new Error("no agent expected"); }, phase: () => {}, log: () => {} });

// --- The mergeable predicate ------------------------------------------------
{
  const { reviewStackMergeable: m } = pure;
  for (const status of ["done", "local-only", "pushed-no-pr", "pr-wrong-base"]) {
    check(`mergeable: ${status}`, m({ status }));
  }
  for (const status of ["review-cap", "skipped-dep", "error", "collision-hold", "collision-blocked", "collision-scan-error", "ready", undefined]) {
    check(`not mergeable: ${String(status)}`, !m({ status }));
  }
  check("not mergeable: missing result", !m(undefined) && !m(null));
  check("the predicate is wider than `done`", pure.REVIEW_STACK_MERGEABLE.length > 1 && pure.REVIEW_STACK_MERGEABLE.includes("local-only"));
}

// --- The canonical merge order ---------------------------------------------
const t = (slug, base, dependsOn = []) => ({ slug, branch: `task/${slug}`, base, dependsOn, path: `tasks/${slug}.md`, content: "" });
{
  // A no-remote batch: every reviewed task ends `local-only`, and the stack is
  // still built from all of them.
  const plan = { defaultBase: "main", waves: [[t("042-a", "main"), t("044-c", "main")], [t("043-b", "task/042-a", ["042-a"])]] };
  const results = [
    { slug: "042-a", branch: "task/042-a", status: "local-only" },
    { slug: "044-c", branch: "task/044-c", status: "local-only" },
    { slug: "043-b", branch: "task/043-b", status: "local-only" },
  ];
  const { order, excluded, cycle } = pure.reviewStackOrder(plan, results);
  check("local-only batch: every branch is in the order", same(order.map((x) => x.slug), ["042-a", "043-b", "044-c"]), JSON.stringify(order.map((x) => x.slug)));
  check("local-only batch: nothing excluded, no cycle", excluded.length === 0 && cycle.length === 0);
  check("a dependent follows the branch it extends, ahead of an unrelated lower-wave root", order[1].slug === "043-b");
  check("order entries carry the recorded PR base", order[1].base === "task/042-a" && order[0].base === "main");
}
{
  // Dependency derived from base -> branch with no dependsOn entry.
  const plan = { defaultBase: "main", waves: [[t("050-z", "main")], [t("010-a", "task/050-z")]] };
  const results = [
    { slug: "050-z", branch: "task/050-z", status: "done" },
    { slug: "010-a", branch: "task/010-a", status: "done" },
  ];
  const { order } = pure.reviewStackOrder(plan, results);
  check("base->branch prerequisite is binding even when dependsOn is empty", same(order.map((x) => x.slug), ["050-z", "010-a"]));
  check("derived dependency is reported on the entry", same(order[1].dependsOn, ["050-z"]));
}
{
  // Independent branches: task number breaks the tie, whatever the wave order says.
  const plan = { defaultBase: "main", waves: [[t("045-y", "main"), t("041-x", "main"), t("043-w", "main")]] };
  const results = ["045-y", "041-x", "043-w"].map((slug) => ({ slug, branch: `task/${slug}`, status: "done" }));
  const { order } = pure.reviewStackOrder(plan, results);
  check("independent branches fall back to task number", same(order.map((x) => x.slug), ["041-x", "043-w", "045-y"]));
}
{
  // Exclusions: failed review, skipped dependents, crashed, held, unreported.
  const plan = { defaultBase: "main", waves: [[t("001-a", "main"), t("002-b", "main"), t("003-c", "main"), t("004-d", "main"), t("005-e", "main")], [t("006-f", "task/002-b", ["002-b"])]] };
  const results = [
    { slug: "001-a", branch: "task/001-a", status: "done" },
    { slug: "002-b", branch: "task/002-b", status: "review-cap" },
    { slug: "003-c", branch: "task/003-c", status: "error" },
    { slug: "004-d", branch: "task/004-d", status: "collision-hold" },
    { slug: "005-e", branch: "task/005-e", status: "pr-wrong-base" },
    { slug: "006-f", branch: "task/006-f", status: "skipped-dep" },
  ];
  const { order, excluded } = pure.reviewStackOrder(plan, results);
  check("failed, crashed, held, and skipped branches are excluded", same(order.map((x) => x.slug), ["001-a", "005-e"]));
  check("exclusions carry their terminal status", same(excluded.map((x) => `${x.slug}:${x.status}`), ["002-b:review-cap", "003-c:error", "004-d:collision-hold", "006-f:skipped-dep"]));
  const unreported = pure.reviewStackOrder(plan, results.slice(0, 1));
  check("a task with no result at all is excluded as unreported", unreported.excluded.some((x) => x.slug === "005-e" && x.status === "unreported"));
}
{
  const plan = { defaultBase: "main", waves: [[t("001-a", "main", ["002-b"]), t("002-b", "main", ["001-a"])]] };
  const results = ["001-a", "002-b"].map((slug) => ({ slug, branch: `task/${slug}`, status: "done" }));
  const { cycle } = pure.reviewStackOrder(plan, results);
  check("a dependency cycle is reported rather than looping", cycle.length === 2);
}

// --- The merge-commit safe prefix ------------------------------------------
const oid = (n) => String(n).repeat(40);
{
  const order = [
    { slug: "001-a", branch: "task/001-a", base: "main" },
    { slug: "002-b", branch: "task/002-b", base: "task/001-a" },
    { slug: "003-c", branch: "task/003-c", base: "task/002-b" },
  ];
  const clean = pure.reviewStackSafePrefix(order, order.map((o, i) => ({ branch: o.branch, tip: oid(i + 1), rangeTaken: true, mergeCommits: [] })));
  check("no merges: the whole order is the safe prefix, with tips", clean.prefix.length === 3 && clean.unchecked.length === 0 && clean.guard === null && clean.prefix[2].tip === oid(3));

  const mid = pure.reviewStackSafePrefix(order, [
    { branch: "task/001-a", tip: oid(1), rangeTaken: true, mergeCommits: [] },
    { branch: "task/002-b", tip: oid(2), rangeTaken: true, mergeCommits: ["c".repeat(40)] },
    { branch: "task/003-c", tip: oid(3), rangeTaken: true, mergeCommits: [] },
  ]);
  check("a merge on b2 ends the prefix at b1 and leaves b2 and b3 unchecked", same(mid.prefix.map((p) => p.branch), ["task/001-a"]) && same(mid.unchecked, ["task/002-b", "task/003-c"]));
  check("the guard names the branch and its merge commits", mid.guard && mid.guard.branch === "task/002-b" && same(mid.guard.mergeCommits, ["c".repeat(40)]) && /rev-list --merges task\/001-a\.\.task\/002-b/.test(mid.guard.reason));

  const first = pure.reviewStackSafePrefix(order, [
    { branch: "task/001-a", tip: oid(1), rangeTaken: true, mergeCommits: ["d".repeat(40)] },
    { branch: "task/002-b", tip: oid(2), rangeTaken: true, mergeCommits: [] },
    { branch: "task/003-c", tip: oid(3), rangeTaken: true, mergeCommits: [] },
  ]);
  check("a merge on b1 leaves an empty prefix", first.prefix.length === 0 && first.unchecked.length === 3);

  const short = pure.reviewStackSafePrefix(order, [
    { branch: "task/001-a", tip: oid(1), rangeTaken: true, mergeCommits: [] },
    { branch: "task/002-b", tip: "abc1234", rangeTaken: true, mergeCommits: [] },
    { branch: "task/003-c", tip: oid(3), rangeTaken: true, mergeCommits: [] },
  ]);
  check("an abbreviated tip is not a reading; it ends the prefix", short.prefix.length === 1 && short.guard.branch === "task/002-b");

  const missing = pure.reviewStackSafePrefix(order, [{ branch: "task/001-a", tip: oid(1), rangeTaken: true, mergeCommits: [] }]);
  check("a branch the inspection did not report ends the prefix", missing.prefix.length === 1 && missing.unchecked.length === 2);

  // The peer's round-1 finding: an untaken range used to arrive as an empty
  // `mergeCommits` plus prose in `detail`, which the guard read as merge-free.
  const untaken = pure.reviewStackSafePrefix(order, [
    { branch: "task/001-a", tip: oid(1), rangeTaken: true, mergeCommits: [] },
    { branch: "task/002-b", tip: oid(2), rangeTaken: false, mergeCommits: [], detail: "recorded PR base task/001-a does not resolve locally" },
    { branch: "task/003-c", tip: oid(3), rangeTaken: true, mergeCommits: [] },
  ]);
  check("a range that was not taken is not a merge-free one; it ends the prefix", same(untaken.prefix.map((p) => p.branch), ["task/001-a"]) && same(untaken.unchecked, ["task/002-b", "task/003-c"]));
  check("the untaken-range guard names the branch and carries the agent's detail", untaken.guard && untaken.guard.branch === "task/002-b" && /could not be taken/.test(untaken.guard.reason) && /does not resolve locally/.test(untaken.guard.reason));
  const noField = pure.reviewStackSafePrefix(order, [{ branch: "task/001-a", tip: oid(1), mergeCommits: [] }, { branch: "task/002-b", tip: oid(2), rangeTaken: true, mergeCommits: [] }, { branch: "task/003-c", tip: oid(3), rangeTaken: true, mergeCommits: [] }]);
  check("a reading with no rangeTaken at all is not a clean one", noField.prefix.length === 0 && noField.guard.branch === "task/001-a");
  check("the inspection schema requires rangeTaken", same(pure.REVIEW_STACK_INSPECT_SCHEMA.properties.branches.items.required, ["branch", "tip", "rangeTaken", "mergeCommits"]));
  check("the inspection schema requires the stamp: every name is derived from it before anything is created", pure.REVIEW_STACK_INSPECT_SCHEMA.required.includes("stamp"));
}

// --- Naming -----------------------------------------------------------------
{
  const order = [{ slug: "042-widget" }, { slug: "043-gadget" }, { slug: "045-thing" }];
  const label = pure.reviewStackBatchLabel(order);
  check("batch label spans the task numbers", label === "042-to-045", label);
  const name = pure.reviewStackGuideName(label, "20260827-120000", 0, "042-widget");
  check("guide name follows the skill's form", name === "review-stack/042-to-045-20260827-120000/01-042-widget", name);
  const odd = pure.reviewStackRefSegment("weird slug..with:colons.lock");
  check("ref segments are made ref-safe", odd === "weird-slug-with-colons-lock" && !/\.\.|:/.test(odd), odd);
}

// --- The stage's control flow ----------------------------------------------
// Scripted agents keyed by label prefix; each call is recorded with its label
// and prompt so the test can assert what ran, in what order, and with what.
function stage(script) {
  const calls = [];
  const logs = [];
  const agent = async (prompt, opts) => {
    const label = opts && opts.label ? opts.label : "";
    calls.push({ label, prompt, schema: opts && opts.schema });
    const key = Object.keys(script).find((k) => label.startsWith(k));
    if (!key) throw new Error(`unscripted agent: ${label}`);
    const r = script[key];
    if (typeof r === "function") return r(prompt, calls);
    if (r instanceof Error) throw r;
    return r;
  };
  const fns = load({ agent, phase: () => {}, log: (m) => logs.push(m) });
  return { fns, calls, logs };
}
const plan3 = { defaultBase: "main", waves: [[t("042-a", "main")], [t("043-b", "task/042-a", ["042-a"])], [t("044-c", "task/043-b", ["043-b"])]] };
const results3 = ["042-a", "043-b", "044-c"].map((slug) => ({ slug, branch: `task/${slug}`, status: "local-only" }));
const wtBase = "/repo/.worktrees/c";
const STAMP = "20260827-120000";
const inspectionClean = { ok: true, stamp: STAMP, branches: ["042-a", "043-b", "044-c"].map((s, i) => ({ branch: `task/${s}`, tip: oid(i + 1), rangeTaken: true, mergeCommits: [] })) };
const guidesFor = (prefixSlugs, label) => ({
  ok: true,
  guides: prefixSlugs.map((s, i) => ({ branch: `task/${s}`, guide: `review-stack/${label}-${STAMP}/0${i + 1}-${s}`, tip: oid(i + 1) })),
  worktree: `${wtBase}/_review-stack-${label}-${STAMP}`,
});
const restackOk = (guides, refs) => ({ ok: true, outcomes: guides.map((g) => ({ guide: g, outcome: "rebased clean" })), stoppedAt: "", conflicts: [], emptyGuides: [], preRebaseRefs: refs });
const teardownOk = { tipsUnchanged: true, tipMismatches: [], recovered: false, worktreeRemoved: true, pruned: true, refsDeleted: [], refsNotDeleted: [], detail: "ok" };

(async () => {
  // Fewer than two mergeable: skipped with a reason, no agent runs.
  {
    const { fns, calls } = stage({});
    const r = await fns.buildReviewStack({ plan: plan3, results: [results3[0], { slug: "043-b", branch: "task/043-b", status: "review-cap" }], wtBase });
    check("one mergeable branch: skipped with the fewer-than-two reason, nothing run", r.skipped === true && /1 mergeable branch/.test(r.reason) && calls.length === 0, r.reason);
    const zero = await fns.buildReviewStack({ plan: plan3, results: [], wtBase });
    check("zero mergeable branches: skipped, nothing run", zero.skipped === true && /0 mergeable/.test(zero.reason) && calls.length === 0);
  }

  // The success path: inspect -> guides -> restack -> teardown.
  {
    const label = "042-to-044";
    const guides = guidesFor(["042-a", "043-b", "044-c"], label);
    const own = guides.guides.map((g) => `refs/pre-rebase/${g.guide}/20260827-120101`);
    const foreign = "refs/pre-rebase/task/042-a/20260827-120101";
    const { fns, calls } = stage({
      "review-stack:inspect": inspectionClean,
      "review-stack:guides": guides,
      "review-stack:restack": restackOk(guides.guides.map((g) => g.guide), [...own, foreign]),
      "review-stack:teardown": teardownOk,
    });
    const r = await fns.buildReviewStack({ plan: plan3, results: results3, wtBase });
    check("success: four agents in order", same(calls.map((c) => c.label), ["review-stack:inspect", "review-stack:guides", "review-stack:restack", "review-stack:teardown"]), calls.map((c) => c.label).join(","));
    check("success: built, with the canonical order and the bN -> gN mapping", r.built === true && same(r.canonicalOrder, ["task/042-a", "task/043-b", "task/044-c"]) && same(r.mapping.map((m) => m.guide), guides.guides.map((g) => g.guide)));
    check("success: every branch integration-checked, nothing unchecked", same(r.integrationCheckedPrefix, r.canonicalOrder) && r.notIntegrationChecked.length === 0 && r.mergeGuard === null);
    check("success: the local-only batch built the stack rather than skipping", r.skipped === false);
    const restackPrompt = calls[2].prompt;
    check("restack brief carries the explicit chain onto the batch's base", restackPrompt.includes(`chain ${guides.guides.map((g) => g.guide).join(" ")} onto main`));
    check("restack brief names the dedicated worktree and g1", restackPrompt.includes(guides.worktree) && restackPrompt.includes(`\`git branch --show-current\` prints \`${guides.guides[0].guide}\``));
    const guidesPrompt = calls[1].prompt;
    check("guides brief lists each captured tip and the final stamped names, the script's own", guidesPrompt.includes(oid(3)) && guidesPrompt.includes(`review-stack/${label}-${STAMP}/03-044-c`) && guidesPrompt.includes(`${wtBase}/_review-stack-${label}-${STAMP}`) && !guidesPrompt.includes("<STAMP>") && !guidesPrompt.includes("date -u"));
    check("the inspection brief has the agent read the clock, not the script, before anything is created", calls[0].prompt.includes("date -u +%Y%m%d-%H%M%S") && !/Date\.now|Math\.random|new Date\(\)/.test(src));
    check("the stamp rides the report", r.stamp === STAMP);
    const teardownPrompt = calls[3].prompt;
    check("teardown deletes exactly the batch's own pre-rebase refs; a foreign one is neither listed nor deleted", own.every((ref) => teardownPrompt.includes(`\`${ref}\``)) && !teardownPrompt.includes(foreign) && same(r.preRebaseRefs, own) && same(r.preRebaseRefsNotOwned, [foreign]));
    check("teardown carries every canonical tip captured before the guides were created", ["042-a", "043-b", "044-c"].every((s, i) => teardownPrompt.includes(`\`task/${s}\` must still be \`${oid(i + 1)}\``)));
    check("teardown names wt-remove for the dedicated worktree's slug", teardownPrompt.includes(`wt-remove '_review-stack-${label}-${STAMP}'`));
    check("teardown result joins the report", r.teardown && r.teardown.worktreeRemoved === true && r.canonicalTipsUnchanged === true);
    const inspectPrompt = calls[0].prompt;
    check("inspection lists every canonical branch with its recorded PR base", inspectPrompt.includes("`task/043-b` (recorded PR base `task/042-a`)"));
  }

  // The clean-stop path: the restack stops at g2; the teardown still runs.
  {
    const label = "042-to-044";
    const guides = guidesFor(["042-a", "043-b", "044-c"], label);
    const g = guides.guides.map((x) => x.guide);
    const { fns, calls } = stage({
      "review-stack:inspect": inspectionClean,
      "review-stack:guides": guides,
      "review-stack:restack": { ok: false, outcomes: [{ guide: g[0], outcome: "rebased clean" }, { guide: g[1], outcome: "stopped at this branch" }, { guide: g[2], outcome: "not reached" }], stoppedAt: g[1], stopReason: "non-trivial conflict in src/a.ts; restored g2 to its pre-rebase ref", conflicts: [{ guide: g[1], files: ["src/a.ts"], commit: "e".repeat(40), resolution: "aborted" }], emptyGuides: [], preRebaseRefs: [`refs/pre-rebase/${g[0]}/x`, `refs/pre-rebase/${g[0]}/20260827-120101`, `refs/pre-rebase/${g[1]}/20260827-120101`] },
      "review-stack:teardown": teardownOk,
    });
    const r = await fns.buildReviewStack({ plan: plan3, results: results3, wtBase });
    check("clean stop: reported, not built, teardown still ran", r.built === false && r.skipped === false && calls.at(-1).label === "review-stack:teardown");
    check("clean stop: completed prefix, first unstacked branch, and remaining suffix", same(r.integrationCheckedPrefix, ["task/042-a"]) && r.firstUnstacked === "task/043-b" && same(r.remainingSuffix, ["task/043-b", "task/044-c"]));
    check("clean stop: the stop point and its conflict ride the report", r.restack.stoppedAt === g[1] && r.restack.conflicts[0].files[0] === "src/a.ts" && /043-b/.test(r.reason));
    check("a pre-rebase ref without the stamp form is not the teardown's to delete", same(r.preRebaseRefs, [`refs/pre-rebase/${g[0]}/20260827-120101`, `refs/pre-rebase/${g[1]}/20260827-120101`]) && r.preRebaseRefsNotOwned.length === 1);
  }

  // A restack agent that throws: reported, teardown still runs, nothing thrown.
  {
    const label = "042-to-044";
    const guides = guidesFor(["042-a", "043-b", "044-c"], label);
    const { fns, calls } = stage({
      "review-stack:inspect": inspectionClean,
      "review-stack:guides": guides,
      "review-stack:restack": new Error("agent stage failed"),
      "review-stack:teardown": teardownOk,
    });
    let threw = false;
    let r;
    try { r = await fns.buildReviewStack({ plan: plan3, results: results3, wtBase }); } catch { threw = true; }
    check("restack throw: the stage reports rather than throws", !threw && r && /agent stage failed/.test(r.error));
    check("restack throw: the teardown still reclaims the worktree", calls.at(-1).label === "review-stack:teardown" && calls.at(-1).prompt.includes("(none reported)"));
  }

  // A merge commit mid-order: the safe prefix is built, the rest reported.
  {
    const label = "042-to-044";
    const guides = guidesFor(["042-a", "043-b"], label);
    const inspection = { ok: true, stamp: STAMP, branches: [
      { branch: "task/042-a", tip: oid(1), rangeTaken: true, mergeCommits: [] },
      { branch: "task/043-b", tip: oid(2), rangeTaken: true, mergeCommits: [] },
      { branch: "task/044-c", tip: oid(3), rangeTaken: true, mergeCommits: ["f".repeat(40)] },
    ] };
    const { fns, calls } = stage({
      "review-stack:inspect": inspection,
      "review-stack:guides": guides,
      "review-stack:restack": (prompt) => restackOk(guides.guides.map((x) => x.guide), []),
      "review-stack:teardown": teardownOk,
    });
    const r = await fns.buildReviewStack({ plan: plan3, results: results3, wtBase });
    check("merge guard: only the safe prefix is stacked", r.built === true && same(r.safePrefix, ["task/042-a", "task/043-b"]) && same(r.notIntegrationChecked, ["task/044-c"]) && r.mergeGuard.branch === "task/044-c");
    check("merge guard: the chain handed to the restack holds two guides", calls[2].prompt.includes(`chain ${guides.guides.map((x) => x.guide).join(" ")} onto main`) && !calls[2].prompt.includes("03-044-c"));
    check("merge guard: the batch label still spans the whole canonical order", guides.guides[0].guide.startsWith(`review-stack/${label}-`) && calls[1].prompt.includes(`review-stack/${label}-${STAMP}/01-042-a`));
  }
  {
    // A merge on b2 of three leaves a one-branch prefix: nothing to stack.
    const inspection = { ok: true, stamp: STAMP, branches: [
      { branch: "task/042-a", tip: oid(1), rangeTaken: true, mergeCommits: [] },
      { branch: "task/043-b", tip: oid(2), rangeTaken: true, mergeCommits: ["f".repeat(40)] },
      { branch: "task/044-c", tip: oid(3), rangeTaken: true, mergeCommits: [] },
    ] };
    const { fns, calls } = stage({ "review-stack:inspect": inspection });
    const r = await fns.buildReviewStack({ plan: plan3, results: results3, wtBase });
    check("merge guard on b2: no guide is created, the reason names the guard", calls.length === 1 && r.built === false && /043-b/.test(r.reason) && same(r.notIntegrationChecked, ["task/043-b", "task/044-c"]));
  }

  // Guide-branch drift: the restack does not run; the teardown is briefed with
  // the script's names, never the deputy's misreported ones.
  {
    const label = "042-to-044";
    const guides = guidesFor(["042-a", "043-b", "044-c"], label);
    const own = guides.guides[1].guide;
    guides.guides[1].guide = "review-stack/oops";
    const { fns, calls } = stage({ "review-stack:inspect": inspectionClean, "review-stack:guides": guides, "review-stack:teardown": teardownOk });
    const r = await fns.buildReviewStack({ plan: plan3, results: results3, wtBase });
    check("the teardown brief refuses removal over a worktree holding a non-guide branch", calls[2].prompt.includes("is not one of the guide branches of step 6, remove NOTHING"));
    check("guide drift: restack not run, reason names the drift, teardown reclaims the worktree", same(calls.map((c) => c.label), ["review-stack:inspect", "review-stack:guides", "review-stack:teardown"]) && /oops/.test(r.reason) && calls[2].prompt.includes(guides.worktree));
    check("guide drift: the teardown's guide list is the script's, not the deputy's", calls[2].prompt.includes(`\`${own}\``) && !calls[2].prompt.includes("review-stack/oops") && same(r.mapping.map((m) => m.guide), [guides.guides[0].guide, own, guides.guides[2].guide]));
  }
  // Worktree-path drift: the deputy's path is nobody's to remove on its word
  // alone; the teardown runs over the path the script named and no other.
  {
    const guides = guidesFor(["042-a", "043-b", "044-c"], "042-to-044");
    const named = guides.worktree;
    guides.worktree = `${wtBase}/_some-other-worktree`;
    const { fns, calls } = stage({ "review-stack:inspect": inspectionClean, "review-stack:guides": guides, "review-stack:teardown": teardownOk });
    const r = await fns.buildReviewStack({ plan: plan3, results: results3, wtBase });
    check("worktree drift: restack not run, reason names both paths", same(calls.map((c) => c.label), ["review-stack:inspect", "review-stack:guides", "review-stack:teardown"]) && r.reason.includes(`"${guides.worktree}" rather than "${named}"`));
    check("worktree drift: the teardown is over the script's path, and the deputy's path is nowhere in its brief", calls[2].prompt.includes(`wt-remove '_review-stack-042-to-044-${STAMP}'`) && calls[2].prompt.includes(named) && !calls[2].prompt.includes("_some-other-worktree") && r.worktree === named);
  }
  // The guides deputy failed AFTER attaching the worktree: still torn down.
  {
    const guides = { ...guidesFor(["042-a", "043-b"], "042-to-044"), ok: false, blocker: "g3 exists" };
    const { fns, calls } = stage({ "review-stack:inspect": inspectionClean, "review-stack:guides": guides, "review-stack:teardown": teardownOk });
    const r = await fns.buildReviewStack({ plan: plan3, results: results3, wtBase });
    check("guides failure with the worktree attached: reported, teardown reclaims it", /g3 exists/.test(r.reason) && calls.at(-1).label === "review-stack:teardown" && calls.at(-1).prompt.includes(guides.worktree));
  }
  // The guides deputy threw after it may have attached the worktree: the path
  // is the script's, so the teardown runs over it and finds out.
  {
    const { fns, calls } = stage({ "review-stack:inspect": inspectionClean, "review-stack:guides": new Error("deputy interrupted"), "review-stack:teardown": { ...teardownOk, worktreeRemoved: false, detail: "no worktree is registered there" } });
    const r = await fns.buildReviewStack({ plan: plan3, results: results3, wtBase });
    check("guides throw: reported, teardown still runs over the named path", /deputy interrupted/.test(r.error) && calls.at(-1).label === "review-stack:teardown" && calls.at(-1).prompt.includes(`${wtBase}/_review-stack-042-to-044-${STAMP}`));
    check("the teardown brief treats an unregistered path as nothing to remove, and lists no pre-rebase ref", calls.at(-1).prompt.includes("lists none, the guide-branch step stopped before attaching it") && calls.at(-1).prompt.includes("(none reported)"));
  }
  {
    // The guides agent failed before creating a worktree: the teardown still
    // runs — the deputy's negative is checked at the path, not taken as read.
    const { fns, calls, logs } = stage({ "review-stack:inspect": inspectionClean, "review-stack:guides": { ok: false, guides: [], worktree: "", blocker: "branch exists" }, "review-stack:teardown": { ...teardownOk, worktreeRemoved: false, detail: "no worktree is registered there" } });
    const r = await fns.buildReviewStack({ plan: plan3, results: results3, wtBase });
    check("guides failure with no worktree: reported, teardown ran, its finding logged", calls.length === 3 && /branch exists/.test(r.reason) && logs.some((m) => /NOT removed/.test(m) && /no worktree is registered/.test(m)));
  }
  {
    // A bad stamp is refused before any name is derived: no guide deputy runs.
    const { fns, calls } = stage({ "review-stack:inspect": { ...inspectionClean, stamp: "2026-08-27T12:00:00" }, "review-stack:guides": guidesFor(["042-a", "043-b", "044-c"], "042-to-044"), "review-stack:teardown": teardownOk });
    const r = await fns.buildReviewStack({ plan: plan3, results: results3, wtBase });
    check("a stamp that is not YYYYMMDD-HHMMSS stops the stage before the guide deputy", /YYYYMMDD-HHMMSS/.test(r.reason) && r.built === false && calls.length === 1 && !r.teardown);
  }

  // Inspection failure: nothing created, nothing to tear down, no throw.
  {
    const { fns, calls } = stage({ "review-stack:inspect": new Error("git missing") });
    const r = await fns.buildReviewStack({ plan: plan3, results: results3, wtBase });
    check("inspection throw: reported, no teardown", calls.length === 1 && /git missing/.test(r.error) && !r.teardown);
  }

  // A teardown that throws is reported on the stage's result, not thrown.
  {
    const guides = guidesFor(["042-a", "043-b", "044-c"], "042-to-044");
    const { fns } = stage({ "review-stack:inspect": inspectionClean, "review-stack:guides": guides, "review-stack:restack": restackOk(guides.guides.map((x) => x.guide), []), "review-stack:teardown": new Error("wt-remove refused") });
    const r = await fns.buildReviewStack({ plan: plan3, results: results3, wtBase });
    check("teardown throw: reported on the result", r.built === true && /wt-remove refused/.test(r.teardown.error) && r.canonicalTipsUnchanged === false);
  }

  // A moved canonical tip is logged and reported, never repaired.
  {
    const guides = guidesFor(["042-a", "043-b", "044-c"], "042-to-044");
    const { fns, logs } = stage({ "review-stack:inspect": inspectionClean, "review-stack:guides": guides, "review-stack:restack": restackOk(guides.guides.map((x) => x.guide), []), "review-stack:teardown": { ...teardownOk, tipsUnchanged: false, tipMismatches: [{ branch: "task/042-a", expected: oid(1), actual: oid(9) }] } });
    const r = await fns.buildReviewStack({ plan: plan3, results: results3, wtBase });
    check("moved canonical tip: reported and logged", r.canonicalTipsUnchanged === false && logs.some((m) => /canonical branch tip moved/.test(m)));
  }

  // The Summary integration: the abort catch and the empty-plan return state
  // their reasons, and the normal return joins the stage's result.
  {
    const body = src.slice(at);
    const abortCatch = body.indexOf("} catch (e) {\n  // Reported, not rethrown");
    const abortReturn = body.indexOf("Batch aborted:", abortCatch);
    const abortPath = abortCatch >= 0 && abortReturn > abortCatch ? body.slice(abortCatch, abortReturn) : null;
    check("abort catch excludes the batch with a stated reason", /Batch aborted[\s\S]*reviewStack: \{ built: false, skipped: true, reason: "the batch aborted/.test(body));
    check("abort catch creates nothing: no stage call and no agent between its catch and its return", abortPath !== null && !/buildReviewStack\(|\bagent\(/.test(abortPath));
    check("the normal return carries reviewStack beside mainCheckout", /mainCheckout, reviewStack, openQuestions/.test(body));
    const summaryAt = body.lastIndexOf('phase("Summary");');
    const summary = body.slice(summaryAt);
    check("the stage renders under Summary: no undeclared phase() call inside it", !/phase\("Review stack"\)/.test(src) && !/title: "Review stack"/.test(src));
    check("the stage runs before the closing main-checkout reading, with the placement justified", summary.indexOf("buildReviewStack(") < summary.indexOf("await finalMainCheckoutReport()") && /BEFORE the closing main-checkout reading, deliberately/.test(summary));
  }

  if (failures) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll review-stack checks passed.");
})();
