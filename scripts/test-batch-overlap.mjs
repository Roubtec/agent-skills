#!/usr/bin/env node
// Focused test for wf-address-tasks.js's end-of-batch overlap report: the pure
// helpers — the mergeable predicate, the recommended merge order, the brief,
// the parser of `overlap.sh`'s output — and the stage's control flow,
// `runOverlapCheck`, driven with scripted agents.
//
// The workflow is a runtime script (top-level await/return, injected
// `agent`/`phase`/`log` globals), so it cannot be imported. Like the boundary
// suite, this evaluates the declaration prefix above the runtime body with
// those globals passed in as parameters, so what runs here is the shipped
// code rather than a copy. A full `Workflow` run of a real batch is not
// something a script can do; what this pins is everything the script decides
// on its own — which branches count, in what order, what the one deputy is
// told, how its answer is read, and that nothing short of a whole, consistent
// answer is ever reported as clean while the stage never throws. The parser
// and the brief's own command are also run against the real `overlap.sh`, on a
// throwaway repository.
//
// Run: node scripts/test-batch-overlap.mjs

import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, delimiter } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(here, "..", "plugins", "dev-skills");
const workflowPath = join(pluginRoot, "workflows", "wf-address-tasks.js");
const src = readFileSync(workflowPath, "utf8");

const CUT = "\nconst peerMode = /";
const at = src.indexOf(CUT);
if (at < 0) {
  console.error("FAIL: cut marker not found in the workflow source.");
  process.exit(1);
}
const prefix = src.slice(0, at).replace(/^export const meta/m, "const meta");
const NAMES = ["overlapMergeable", "recommendedMergeOrder", "overlapPrompt", "parseOverlapOutput", "runOverlapCheck", "overlapLogLines", "OVERLAP_MERGEABLE", "OVERLAP_SCHEMA"];
function load({ agent, phase, log }) {
  const body = `"use strict";\n${prefix}\nreturn { ${NAMES.join(", ")} };`;
  // eslint-disable-next-line no-new-func
  return new Function("args", "agent", "phase", "log", body)("", agent, phase, log);
}

const EXPECTED_CHECKS = 128;
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const pure = load({ agent: () => { throw new Error("no agent expected"); }, phase: () => {}, log: () => {} });

// --- The mergeable predicate ------------------------------------------------
{
  const { overlapMergeable: m } = pure;
  for (const status of ["done", "local-only", "pushed-no-pr", "pr-wrong-base"]) {
    check(`mergeable: ${status}`, m({ status }));
  }
  for (const status of ["review-cap", "skipped-dep", "error", "collision-hold", "collision-blocked", "collision-scan-error", "ready", undefined]) {
    check(`not mergeable: ${String(status)}`, !m({ status }));
  }
  check("not mergeable: missing result", !m(undefined) && !m(null));
  // Task 033: a delivered branch whose PR merged during the run is on the
  // base already, so it is not compared, and the exclusion says why.
  check("not mergeable: done but merged during the run", !m({ status: "done", merged: true }));
  {
    const plan = { defaultBase: "main", waves: [[{ slug: "001-a", branch: "task/001-a", base: "main", dependsOn: [] }, { slug: "002-b", branch: "task/002-b", base: "main", dependsOn: [] }]] };
    const { order, excluded } = pure.recommendedMergeOrder(plan, [{ slug: "001-a", branch: "task/001-a", status: "done", merged: true, mergedInto: "main" }, { slug: "002-b", branch: "task/002-b", status: "done" }]);
    check("a merged member is excluded as `merged`, its siblings still ordered", order.length === 1 && order[0].slug === "002-b" && excluded.length === 1 && excluded[0].status === "merged", JSON.stringify({ order, excluded }));
  }
  check("the predicate is wider than `done`", pure.OVERLAP_MERGEABLE.length > 1 && pure.OVERLAP_MERGEABLE.includes("local-only"));
}

// --- The canonical merge order ---------------------------------------------
const t = (slug, base, dependsOn = []) => ({ slug, branch: `task/${slug}`, base, dependsOn, path: `tasks/${slug}.md`, content: "" });
{
  // A no-remote batch: every reviewed task ends `local-only`, and the order
  // still holds all of them.
  const plan = { defaultBase: "main", waves: [[t("042-a", "main"), t("044-c", "main")], [t("043-b", "task/042-a", ["042-a"])]] };
  const results = [
    { slug: "042-a", branch: "task/042-a", status: "local-only" },
    { slug: "044-c", branch: "task/044-c", status: "local-only" },
    { slug: "043-b", branch: "task/043-b", status: "local-only" },
  ];
  const { order, excluded, cycle } = pure.recommendedMergeOrder(plan, results);
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
  const { order } = pure.recommendedMergeOrder(plan, results);
  check("base->branch prerequisite is binding even when dependsOn is empty", same(order.map((x) => x.slug), ["050-z", "010-a"]));
  check("derived dependency is reported on the entry", same(order[1].dependsOn, ["050-z"]));
}
{
  // Independent branches: task number breaks the tie, whatever the wave order says.
  const plan = { defaultBase: "main", waves: [[t("045-y", "main"), t("041-x", "main"), t("043-w", "main")]] };
  const results = ["045-y", "041-x", "043-w"].map((slug) => ({ slug, branch: `task/${slug}`, status: "done" }));
  const { order } = pure.recommendedMergeOrder(plan, results);
  check("independent branches fall back to task number", same(order.map((x) => x.slug), ["041-x", "043-w", "045-y"]));
}
{
  // An unpadded numbering convention: the task number is compared as a number,
  // never as the slug's text, or `10-` would precede `2-`.
  const plan = { defaultBase: "main", waves: [[t("10-j", "main"), t("2-b", "main"), t("9-i", "main"), t("2a-c", "main"), t("misc", "main")]] };
  const results = ["10-j", "2-b", "9-i", "2a-c", "misc"].map((slug) => ({ slug, branch: `task/${slug}`, status: "done" }));
  const { order } = pure.recommendedMergeOrder(plan, results);
  check("unpadded task numbers sort numerically, a letter suffix after its number, an unnumbered slug last", same(order.map((x) => x.slug), ["2-b", "2a-c", "9-i", "10-j", "misc"]), JSON.stringify(order.map((x) => x.slug)));
  // A separator run sorts before a digit run, so a segment that ends where
  // the other's is still being extended comes first (`2-a-3` before `2-a3`).
  const sep = ["2-a3", "2-a-3"].map((s) => t(s, "main"));
  const sepOrder = pure.recommendedMergeOrder({ defaultBase: "main", waves: [sep] }, sep.map((x) => ({ slug: x.slug, branch: `task/${x.slug}`, status: "done" }))).order;
  check("a separator run sorts before a digit run", same(sepOrder.map((x) => x.slug), ["2-a-3", "2-a3"]), JSON.stringify(sepOrder.map((x) => x.slug)));
}
{
  // The `write-tasks` phase-prefixed fallback (`A-01-...`): the number behind
  // the prefix is what is compared, within its phase, and a slug with no such
  // number still sorts last.
  const slugs = ["A-10-j", "B-1-k", "A-2-b", "misc", "A-9-i", "A-2a-c"];
  const plan = { defaultBase: "main", waves: [slugs.map((s) => t(s, "main"))] };
  const results = slugs.map((slug) => ({ slug, branch: `task/${slug}`, status: "done" }));
  const { order } = pure.recommendedMergeOrder(plan, results);
  check("phase-prefixed task numbers sort numerically within their phase, an unnumbered slug last", same(order.map((x) => x.slug), ["A-2-b", "A-2a-c", "A-9-i", "A-10-j", "B-1-k", "misc"]), JSON.stringify(order.map((x) => x.slug)));
}
{
  // `write-tasks`' other fallback, a numeric phase (`02-12-...`): the task
  // number behind the phase compares as a number too — `2` before `3` before
  // `12` — because the order is decided segment by segment over the whole
  // slug rather than by which leading digits the parser takes for the phase.
  // A plain-numbered slug whose name starts with a digit (`042-3d-model`) is
  // not displaced from its number.
  const slugs = ["02-12-hook", "02-3-x", "01-9-y", "02-2-z"];
  const plan = { defaultBase: "main", waves: [slugs.map((s) => t(s, "main"))] };
  const results = slugs.map((slug) => ({ slug, branch: `task/${slug}`, status: "done" }));
  const { order } = pure.recommendedMergeOrder(plan, results);
  check("numeric-phase slugs sort by phase, then by task number as a number within it", same(order.map((x) => x.slug), ["01-9-y", "02-2-z", "02-3-x", "02-12-hook"]), JSON.stringify(order.map((x) => x.slug)));
  const mixed = ["045-y", "041-x", "043-w", "042-3d-model", "042-widget"].map((s) => t(s, "main"));
  const mixedOrder = pure.recommendedMergeOrder({ defaultBase: "main", waves: [mixed] }, mixed.map((x) => ({ slug: x.slug, branch: x.branch, status: "done" }))).order;
  check("a digit-led name segment keeps its task number's place", same(mixedOrder.map((x) => x.slug), ["041-x", "042-3d-model", "042-widget", "043-w", "045-y"]), JSON.stringify(mixedOrder.map((x) => x.slug)));
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
  const { order, excluded } = pure.recommendedMergeOrder(plan, results);
  check("failed, crashed, held, and skipped branches are excluded", same(order.map((x) => x.slug), ["001-a", "005-e"]));
  check("exclusions carry their terminal status", same(excluded.map((x) => `${x.slug}:${x.status}`), ["002-b:review-cap", "003-c:error", "004-d:collision-hold", "006-f:skipped-dep"]));
  const unreported = pure.recommendedMergeOrder(plan, results.slice(0, 1));
  check("a task with no result at all is excluded as unreported", unreported.excluded.some((x) => x.slug === "005-e" && x.status === "unreported"));
}
{
  const plan = { defaultBase: "main", waves: [[t("001-a", "main", ["002-b"]), t("002-b", "main", ["001-a"])]] };
  const results = ["001-a", "002-b"].map((slug) => ({ slug, branch: `task/${slug}`, status: "done" }));
  const { cycle } = pure.recommendedMergeOrder(plan, results);
  check("a dependency cycle is reported rather than looping", cycle.length === 2);
}

// --- The brief ---------------------------------------------------------------
{
  const p = pure.overlapPrompt({ base: "main", branches: ["task/042-a", "task/043-b", "task/044-c"] });
  check("brief: the one command, with the base and the branches in the order given", p.includes("`address-tasks-overlap -C \"$(git rev-parse --show-toplevel)\" --base 'main' 'task/042-a' 'task/043-b' 'task/044-c'`"), p);
  check("brief: observe-only, in the main checkout, fetching nothing", p.includes("OBSERVE ONLY — create, move, check out, delete, fetch, and push nothing") && p.includes("You stand in the repository's SHARED main checkout") && p.includes("it fetches nothing") && p.includes("fetch nothing to make a name resolve"));
  check("brief: exit 3 is an answer, not a failure, and nothing is retried or repaired", p.includes("`0` and `3` are both ANSWERS") && p.includes("not a failure — retry nothing, investigate nothing, repair nothing") && p.includes("never re-run with other arguments"));
  check("brief: stdout verbatim with its tabs, the exit status, and stderr on any other status", p.includes("`stdout` VERBATIM — every line, in order, unedited and unsummarized") && p.includes("the tabs must reach the report as tabs") && p.includes("Where the exit status was anything but `0` or `3`, report `stderr` verbatim too"));
  check("brief: a helper the shell cannot find is reported, never hand-rolled", p.includes("on PATH for this session; where the shell cannot find it, report `ran: false`") && p.includes("\"overlap helper not found\"") && p.includes("never hand-roll the comparison in its place"));
  check("brief: it carries the destroy boundary and the finish-in-turn rule once each, and no unrendered template (the boundary's own `${DC:?…}` guard aside)", (p.match(/^## DESTROY BOUNDARY$/gm) || []).length === 1 && (p.match(/Finish inside your own turn/g) || []).length === 1 && !/\$\{|undefined|\[object/.test(p.replace("${DC:?dc-enter returned no path", "")));
  check("brief: it lists every branch as bN, headed for the base", p.includes("- b1: `task/042-a`") && p.includes("- b3: `task/044-c`") && p.includes("all headed for `main`"));
  check("the schema requires the run flag, the exit status, and stdout", same(pure.OVERLAP_SCHEMA.required, ["ran", "exitStatus", "stdout"]));
}

// --- The parser ----------------------------------------------------------------
const oid = (n) => String(n).repeat(40);
const T = "\t";
const out = (...lines) => `${lines.join("\n")}\n`;
{
  const parse = pure.parseOverlapOutput;
  const three = ["task/a", "task/b", "task/c"];
  const conflict = out(
    "outcome=conflict", `base=${oid(0)}`,
    `branch=task/a${T}${oid(1)}${T}clean`, `branch=task/b${T}${oid(2)}${T}conflict`, `base-conflict=task/b${T}src/x.js`, `branch=task/c${T}${oid(3)}${T}clean`,
    `pair=task/a${T}task/b${T}conflict`, `shared=task/a${T}task/b${T}src/a file.js`, `conflict=task/a${T}task/b${T}src/a file.js`,
    `pair=task/a${T}task/c${T}overlap`, `shared=task/a${T}task/c${T}README.md`, `shared=task/a${T}task/c${T}docs/x.md`,
    `pair=task/b${T}task/c${T}clean`,
  );
  const r = parse(conflict, three);
  check("parse: outcome and base", r.ok === true && r.outcome === "conflict" && r.base === oid(0), JSON.stringify(r));
  check("parse: per-branch base verdicts, with the files a base conflict names", same(r.branches, [{ branch: "task/a", oid: oid(1), verdict: "clean", conflicts: [] }, { branch: "task/b", oid: oid(2), verdict: "conflict", conflicts: ["src/x.js"] }, { branch: "task/c", oid: oid(3), verdict: "clean", conflicts: [] }]), JSON.stringify(r.branches));
  check("parse: pairs with their shared and conflict files, a path with a space kept whole", same(r.pairs, [{ a: "task/a", b: "task/b", verdict: "conflict", shared: ["src/a file.js"], conflicts: ["src/a file.js"] }, { a: "task/a", b: "task/c", verdict: "overlap", shared: ["README.md", "docs/x.md"], conflicts: [] }, { a: "task/b", b: "task/c", verdict: "clean", shared: [], conflicts: [] }]), JSON.stringify(r.pairs));
  // A relay that flattened the tabs is still read: only the last field, a
  // path, can hold whitespace.
  check("parse: tabs flattened to spaces read the same, CRLF line ends too", same(parse(conflict.replace(/\t/g, "  ").replace(/\n/g, "\r\n"), three), r));

  const clean = out("outcome=clean", `base=${oid(0)}`, `branch=task/a${T}${oid(1)}${T}clean`, `branch=task/b${T}${oid(2)}${T}clean`, `pair=task/a${T}task/b${T}clean`);
  check("parse: a clean pair", parse(clean, ["task/a", "task/b"]).outcome === "clean");
  const stacked = out("outcome=clean", `base=${oid(0)}`, `branch=task/a${T}${oid(1)}${T}merged`, `branch=task/b${T}${oid(2)}${T}clean`, `branch=task/c${T}${oid(3)}${T}clean`, `pair=task/b${T}task/c${T}stacked`);
  const st = parse(stacked, three);
  check("parse: a merged branch takes no pair, and a stacked pair is clean", st.ok === true && st.branches[0].verdict === "merged" && same(st.pairs.map((p) => p.verdict), ["stacked"]), JSON.stringify(st));

  // Nothing short of the whole output is a reading.
  const refused = (name, text, expected, pattern) => { const x = parse(text, expected); check(`parse refuses: ${name}`, x.ok === false && pattern.test(x.reason) && x.outcome === undefined, JSON.stringify(x)); };
  refused("empty output", "", three, /printed nothing/);
  refused("blank lines only", "\n\n", three, /printed nothing/);
  refused("null", null, three, /printed nothing/);
  refused("prose instead of the output", "The branches merge cleanly.", three, /first line/);
  refused("an outcome outside the vocabulary", clean.replace("outcome=clean", "outcome=fine"), ["task/a", "task/b"], /first line/);
  refused("the outcome line not first", out(`base=${oid(0)}`, "outcome=clean"), [], /first line/);
  refused("no base line", clean.replace(`base=${oid(0)}\n`, ""), ["task/a", "task/b"], /no `base=` line/);
  refused("an abbreviated base", clean.replace(oid(0), "abc1234"), ["task/a", "task/b"], /not one this parser knows/);
  refused("an unknown key", `${clean}note=hello\n`, ["task/a", "task/b"], /not one this parser knows/);
  refused("a line with no key", `${clean}some of these branches do not merge\n`, ["task/a", "task/b"], /not one this parser knows/);
  refused("a branch verdict outside the vocabulary", clean.replace(`${oid(2)}${T}clean`, `${oid(2)}${T}fine`), ["task/a", "task/b"], /not one this parser knows/);
  refused("a pair verdict outside the vocabulary", clean.replace(`task/b${T}clean\n`, `task/b${T}fine\n`), ["task/a", "task/b"], /not one this parser knows/);
  refused("a pair naming a branch that has no branch line", clean.replace("pair=task/a", "pair=task/z"), ["task/a", "task/b"], /not one this parser knows/);
  refused("a shared line for a pair that was never printed", `${clean}shared=task/b${T}task/a${T}x\n`, ["task/a", "task/b"], /not one this parser knows/);
  refused("a base-conflict line under a branch that merges", `${clean}base-conflict=task/a${T}x\n`, ["task/a", "task/b"], /not one this parser knows/);
  refused("a branch printed twice", clean.replace(`branch=task/b${T}${oid(2)}${T}clean\n`, `branch=task/a${T}${oid(1)}${T}clean\n`), ["task/a"], /not one this parser knows/);
  refused("a requested branch with no verdict", clean, three, /no `branch=` line for `task\/c`/);
  refused("a verdict for a branch that was not requested", clean, ["task/a"], /which the command was not given/);
  refused("a truncated pair list", conflict.replace(`pair=task/b${T}task/c${T}clean\n`, ""), three, /2 `pair=` line\(s\) for 3 unmerged branch\(es\), which make 3/);
  refused("an outcome its own lines do not add up to (conflict printed as clean)", conflict.replace("outcome=conflict", "outcome=clean"), three, /add up to `conflict`/);
  refused("an outcome its own lines do not add up to (clean printed as overlap)", clean.replace("outcome=clean", "outcome=overlap"), ["task/a", "task/b"], /add up to `clean`/);
  // A verdict its own file lines do not bear out is a garbled or cut-off relay.
  refused("a shared file under a clean pair", `${clean}shared=task/a${T}task/b${T}x\n`, ["task/a", "task/b"], /reads `clean` with 1 `shared=` and 0 `conflict=`/);
  refused("a conflict file under a clean pair", `${clean}conflict=task/a${T}task/b${T}x\n`, ["task/a", "task/b"], /reads `clean` with 0 `shared=` and 1 `conflict=`/);
  refused("an overlap that names no shared file", clean.replace("outcome=clean", "outcome=overlap").replace(`task/b${T}clean\n`, `task/b${T}overlap\n`), ["task/a", "task/b"], /reads `overlap` with 0 `shared=`/);
  refused("a pair conflict that names no file", clean.replace("outcome=clean", "outcome=conflict").replace(`task/b${T}clean\n`, `task/b${T}conflict\n`), ["task/a", "task/b"], /reads `conflict` with 0 `shared=` and 0 `conflict=`/);
  refused("a base conflict that names no file", conflict.replace(`base-conflict=task/b${T}src/x.js\n`, ""), three, /`task\/b` reads `conflict` with 0 `base-conflict=`/);
  refused("a file under a stacked pair", `${stacked}shared=task/b${T}task/c${T}x\n`, three, /reads `stacked` with 1 `shared=`/);
  refused("a pair naming a branch the base already contains", stacked.replace(`pair=task/b${T}task/c${T}stacked\n`, `pair=task/a${T}task/c${T}clean\n`), three, /names a branch the base already contains/);
}

// --- The real script, on a throwaway repository ----------------------------------
// main holds three files; 1 and 2 rewrite the same line of a.txt, 3 edits the
// top of b.txt and 5 its bottom, 4 is stacked on 3, and 0 is merged already.
const shim = join(pluginRoot, "bin", "address-tasks-overlap");
const repo = mkdtempSync(join(tmpdir(), "batch-overlap-"));
const git = (...argv) => {
  const r = spawnSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...argv], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${argv.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const commitFile = (file, text, message) => { writeFileSync(join(repo, file), text); git("add", "--", file); git("commit", "-q", "-m", message); };
const lines = (first, last) => `${[first, "2", "3", "4", "5", "6", "7", "8", last].join("\n")}\n`;
const runShim = (argv, cwd = repo) => spawnSync("bash", [shim, ...argv], { encoding: "utf8", cwd });
try {
  git("init", "-q", "-b", "main");
  commitFile("a.txt", lines("1", "9"), "a");
  commitFile("b.txt", lines("1", "9"), "b");
  commitFile("c.txt", "c\n", "c");
  git("checkout", "-q", "-b", "task/000-merged"); commitFile("m.txt", "m\n", "merged work");
  git("checkout", "-q", "main"); git("merge", "-q", "--ff-only", "task/000-merged");
  git("checkout", "-q", "-b", "task/001-a"); commitFile("a.txt", lines("one", "9"), "1");
  git("checkout", "-q", "-b", "task/002-b", "main"); commitFile("a.txt", lines("uno", "9"), "2");
  git("checkout", "-q", "-b", "task/003-c", "main"); commitFile("b.txt", lines("one", "9"), "3");
  git("checkout", "-q", "-b", "task/004-d", "task/003-c"); commitFile("c.txt", "c4\n", "4");
  git("checkout", "-q", "-b", "task/005-e", "main"); commitFile("b.txt", lines("1", "nine"), "5");
  git("checkout", "-q", "main");
  const refsBefore = git("for-each-ref");
  const all = ["task/000-merged", "task/001-a", "task/002-b", "task/003-c", "task/004-d", "task/005-e"];

  const run = runShim(["-C", repo, "--base", "main", ...all]);
  check("real script: a conflicting set exits 3", run.status === 3, `status ${run.status}: ${run.stderr}`);
  const r = pure.parseOverlapOutput(run.stdout, all);
  check("real script: its output parses whole", r.ok === true && r.outcome === "conflict" && r.base === git("rev-parse", "main"), JSON.stringify(r));
  const by = (a, b) => (r.pairs || []).find((p) => p.a === a && p.b === b) || {};
  check("real script: per-branch verdicts carry each tip, the merged one marked", r.ok && same(r.branches.map((b) => `${b.branch}:${b.verdict}`), ["task/000-merged:merged", "task/001-a:clean", "task/002-b:clean", "task/003-c:clean", "task/004-d:clean", "task/005-e:clean"]) && r.branches.every((b) => b.oid === git("rev-parse", b.branch)), JSON.stringify(r.branches));
  check("real script: the conflicting pair names its file as shared and as conflicting", by("task/001-a", "task/002-b").verdict === "conflict" && same(by("task/001-a", "task/002-b").shared, ["a.txt"]) && same(by("task/001-a", "task/002-b").conflicts, ["a.txt"]), JSON.stringify(by("task/001-a", "task/002-b")));
  check("real script: a pair touching one file apart merges as an overlap", by("task/003-c", "task/005-e").verdict === "overlap" && same(by("task/003-c", "task/005-e").shared, ["b.txt"]) && by("task/003-c", "task/005-e").conflicts.length === 0, JSON.stringify(by("task/003-c", "task/005-e")));
  check("real script: a stacked pair and an unrelated pair", by("task/003-c", "task/004-d").verdict === "stacked" && by("task/001-a", "task/003-c").verdict === "clean" && r.pairs.length === 10, JSON.stringify(r.pairs));

  const overlap = runShim(["-C", repo, "--base", "main", "task/003-c", "task/005-e"]);
  const o = pure.parseOverlapOutput(overlap.stdout, ["task/003-c", "task/005-e"]);
  check("real script: an overlapping set exits 0 and parses as overlap", overlap.status === 0 && o.ok === true && o.outcome === "overlap", `${overlap.status} ${JSON.stringify(o)}`);
  const clean = runShim(["-C", repo, "--base", "main", "task/001-a", "task/003-c"]);
  const c = pure.parseOverlapOutput(clean.stdout, ["task/001-a", "task/003-c"]);
  check("real script: a disjoint set exits 0 and parses as clean", clean.status === 0 && c.ok === true && c.outcome === "clean" && c.pairs.length === 1, `${clean.status} ${JSON.stringify(c)}`);
  const missing = runShim(["-C", repo, "--base", "main", "task/001-a", "task/nope"]);
  check("real script: a failure prints nothing the parser takes for an answer", missing.status === 1 && pure.parseOverlapOutput(missing.stdout, ["task/001-a", "task/nope"]).ok === false, `${missing.status} ${missing.stdout}`);

  // The brief's own command, run as written: a deputy that does exactly what
  // it is told, with the plugin's `bin/` on PATH as the plugin runtime has it.
  const deputy = (env) => async (prompt) => {
    const m = prompt.match(/`(address-tasks-overlap [^`]*)`/);
    if (!m) throw new Error("the brief names no command");
    const x = spawnSync("bash", ["-c", m[1]], { encoding: "utf8", cwd: repo, env });
    return x.status === 127 ? { ran: false, exitStatus: -1, stdout: "", detail: "overlap helper not found" } : { ran: true, exitStatus: x.status, stdout: x.stdout, stderr: x.stderr };
  };
  const withBin = { ...process.env, PATH: `${join(pluginRoot, "bin")}${delimiter}${process.env.PATH}` };
  const planOf = (slugs) => ({ defaultBase: "main", waves: [slugs.map((s) => ({ slug: s, branch: `task/${s}`, base: s === "004-d" ? "task/003-c" : "main", dependsOn: [] }))] });
  const resultsOf = (slugs) => slugs.map((s) => ({ slug: s, branch: `task/${s}`, status: "done" }));
  const slugs = ["005-e", "004-d", "003-c", "002-b", "001-a"];
  const live = await load({ agent: deputy(withBin), phase: () => {}, log: () => {} }).runOverlapCheck({ plan: planOf(slugs), results: resultsOf(slugs) });
  check("brief run as written: the stage reports the conflict, in the recommended order, with exit 3 as its answer", live.ran === true && live.outcome === "conflict" && live.exitStatus === 3 && same(live.mergeOrder, ["task/001-a", "task/002-b", "task/003-c", "task/004-d", "task/005-e"]) && same(live.branches.map((b) => b.branch), live.mergeOrder) && live.pairs.some((p) => p.verdict === "conflict" && same(p.conflicts, ["a.txt"])), JSON.stringify(live));
  const gone = await load({ agent: deputy(process.env), phase: () => {}, log: () => {} }).runOverlapCheck({ plan: planOf(slugs), results: resultsOf(slugs) });
  check("brief run as written without the plugin's bin on PATH: did not run, helper not found", gone.ran === false && gone.skipped === false && gone.reason === "overlap check did not run: overlap helper not found" && gone.outcome === undefined, JSON.stringify(gone));
  check("real script: every run left the repository's refs and working tree as they were", git("for-each-ref") === refsBefore && git("status", "--porcelain") === "" && git("worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ")).length === 1);
} finally {
  rmSync(repo, { recursive: true, force: true });
}

// --- The stage's control flow ----------------------------------------------
// One scripted agent; each call is recorded with its label, prompt, and options
// so the test can assert what ran and with what.
function stage(answer) {
  const calls = [];
  const agent = async (prompt, opts) => {
    calls.push({ label: opts && opts.label, prompt, schema: opts && opts.schema, effort: opts && opts.effort });
    if (answer === undefined) throw new Error("unscripted agent");
    if (answer instanceof Error) throw answer;
    return typeof answer === "function" ? answer(prompt) : answer;
  };
  return { fns: load({ agent, phase: () => {}, log: () => {} }), calls };
}
const plan3 = { defaultBase: "main", waves: [[t("042-a", "main")], [t("043-b", "task/042-a", ["042-a"])], [t("044-c", "main")]] };
const results3 = ["042-a", "043-b", "044-c"].map((slug) => ({ slug, branch: `task/${slug}`, status: "local-only" }));
const order3 = ["task/042-a", "task/043-b", "task/044-c"];
const stdoutOverlap = out("outcome=overlap", `base=${oid(0)}`, ...order3.map((b, i) => `branch=${b}${T}${oid(i + 1)}${T}clean`), `pair=task/042-a${T}task/043-b${T}stacked`, `pair=task/042-a${T}task/044-c${T}clean`, `pair=task/043-b${T}task/044-c${T}overlap`, `shared=task/043-b${T}task/044-c${T}README.md`);
const stdoutConflict = stdoutOverlap.replace("outcome=overlap", "outcome=conflict").replace(`task/044-c${T}overlap`, `task/044-c${T}conflict`) + `conflict=task/043-b${T}task/044-c${T}README.md\n`;

// Fewer than two mergeable: skipped with a reason, no agent runs.
{
  const { fns, calls } = stage();
  const r = await fns.runOverlapCheck({ plan: plan3, results: [results3[0], { slug: "043-b", branch: "task/043-b", status: "review-cap" }] });
  check("one mergeable branch: skipped with the fewer-than-two reason, nothing run, the one branch still the order", r.skipped === true && r.ran === false && /1 mergeable branch;/.test(r.reason) && same(r.mergeOrder, ["task/042-a"]) && calls.length === 0, r.reason);
  const zero = await fns.runOverlapCheck({ plan: plan3, results: [] });
  check("zero mergeable branches: skipped, nothing run, every task among the exclusions", zero.skipped === true && /0 mergeable branches/.test(zero.reason) && zero.excluded.length === 3 && calls.length === 0);
  // A cycle leaves its members out of the order: two mergeable branches in
  // one are the cycle diagnostic, never "the batch reached 0 mergeable".
  const cyclic = { defaultBase: "main", waves: [[t("042-a", "main", ["043-b"]), t("043-b", "main", ["042-a"])]] };
  const c = await fns.runOverlapCheck({ plan: cyclic, results: results3.slice(0, 2) });
  check("a dependency cycle among mergeable branches: skipped naming the cycle, not the count, nothing run", c.skipped === true && /not acyclic \(042-a, 043-b\)/.test(c.reason) && !/reached \d+ mergeable/.test(c.reason) && calls.length === 0, c.reason);
  check("a skip logs its reason", same(fns.overlapLogLines(r), [`Overlap check skipped: ${r.reason}`]));
}

// A name a shell — or the script's own option parser — would interpret skips
// the stage before the deputy runs.
for (const bad of ["task/042-a$b", "task/042-a;rm", "task/042-`a`", "-task/042-a", "task/042 a", "task/042\ta"]) {
  const plan = { defaultBase: "main", waves: [[t("042-a", "main"), t("043-b", "main")]] };
  plan.waves[0][0].branch = bad;
  const results = [{ slug: "042-a", branch: bad, status: "done" }, { slug: "043-b", branch: "task/043-b", status: "done" }];
  const { fns, calls } = stage();
  const r = await fns.runOverlapCheck({ plan, results });
  check(`branch ${JSON.stringify(bad)}: the stage is skipped, nothing run`, r.skipped === true && calls.length === 0 && r.reason.includes(JSON.stringify(bad)), r.reason);
}
{
  const plan = { defaultBase: "main$x", waves: [[t("042-a", "main$x"), t("043-b", "main$x")]] };
  const results = ["042-a", "043-b"].map((slug) => ({ slug, branch: `task/${slug}`, status: "done" }));
  const { fns, calls } = stage();
  const r = await fns.runOverlapCheck({ plan, results });
  check("a base that is not shell-inert is skipped too", r.skipped === true && calls.length === 0 && /main\$x/.test(r.reason), r.reason);
  const ok = stage({ ran: false, exitStatus: -1, stdout: "" });
  const admitted = await ok.fns.runOverlapCheck({ plan: { defaultBase: "release/v1.2_x", waves: plan.waves }, results });
  check("an ordinary ref with `/`, `.`, and `_` is admitted, and reaches the command as the base", admitted.skipped === false && ok.calls.length === 1 && ok.calls[0].prompt.includes("--base 'release/v1.2_x' 'task/042-a' 'task/043-b'"), admitted.reason);
}

// An answer: one low-effort agent, the branches in the recommended order.
{
  const { fns, calls } = stage({ ran: true, exitStatus: 0, stdout: stdoutOverlap });
  const r = await fns.runOverlapCheck({ plan: plan3, results: results3 });
  check("one low-effort agent, under the stage's label and schema", calls.length === 1 && calls[0].label === "overlap:check" && calls[0].effort === "low" && calls[0].schema === fns.OVERLAP_SCHEMA);
  check("the command names the batch's default base and the branches in the recommended merge order", calls[0].prompt.includes("--base 'main' 'task/042-a' 'task/043-b' 'task/044-c'`"));
  const far = stage({ ran: true, exitStatus: 0, stdout: stdoutOverlap });
  const rr = await far.fns.runOverlapCheck({ plan: plan3, results: results3, remote: true });
  check("on a remote run the base is the remote's, which a merged sibling's refresh moves and the local branch does not follow", far.calls[0].prompt.includes("--base 'origin/main' 'task/042-a'") && rr.base === "origin/main", rr.base);
  check("overlap: reported with the merge order, the outcome, the base verdicts, and the pairs", r.ran === true && r.skipped === false && r.outcome === "overlap" && r.exitStatus === 0 && r.base === "main" && r.baseOid === oid(0) && same(r.mergeOrder, order3) && same(r.branches.map((b) => b.verdict), ["clean", "clean", "clean"]) && same(r.pairs[2], { a: "task/043-b", b: "task/044-c", verdict: "overlap", shared: ["README.md"], conflicts: [] }) && r.excluded.length === 0, JSON.stringify(r));
  check("overlap: the log names the outcome, the order, and the overlapping pair's files", same(fns.overlapLogLines(r), ["Overlap check: overlap. Recommended merge order: task/042-a, task/043-b, task/044-c.", "Overlap check: `task/043-b` and `task/044-c` touch the same files and still merge — README.md."]), JSON.stringify(fns.overlapLogLines(r)));
}
{
  const { fns } = stage({ ran: true, exitStatus: 3, stdout: stdoutConflict, stderr: "overlap: some of these branches do not merge as they stand." });
  const r = await fns.runOverlapCheck({ plan: plan3, results: results3 });
  check("exit 3 is an answer: the conflict is reported as the outcome, not as a failed run", r.ran === true && r.outcome === "conflict" && r.exitStatus === 3 && r.reason === "" && same(r.pairs[2].conflicts, ["README.md"]), JSON.stringify(r));
  check("conflict: the log names the pair that does not merge and its files", fns.overlapLogLines(r).some((l) => l === "Overlap check: `task/043-b` and `task/044-c` do not merge as they stand; whichever merges second needs the rebase — README.md."), JSON.stringify(fns.overlapLogLines(r)));
  const baseConflict = out("outcome=conflict", `base=${oid(0)}`, `branch=task/042-a${T}${oid(1)}${T}conflict`, `base-conflict=task/042-a${T}src/x.js`, `branch=task/043-b${T}${oid(2)}${T}clean`, `branch=task/044-c${T}${oid(3)}${T}clean`, `pair=task/042-a${T}task/043-b${T}stacked`, `pair=task/042-a${T}task/044-c${T}clean`, `pair=task/043-b${T}task/044-c${T}clean`);
  const b = stage({ ran: true, exitStatus: 3, stdout: baseConflict });
  const br = await b.fns.runOverlapCheck({ plan: plan3, results: results3 });
  check("a branch that does not merge into the base is reported and logged with its files", br.ran === true && same(br.branches[0].conflicts, ["src/x.js"]) && b.fns.overlapLogLines(br).includes("Overlap check: `task/042-a` does not merge into the base as it stands — src/x.js."), JSON.stringify(br));
}

// Everything else did not run — and is never clean.
{
  const notRun = async (name, answer, pattern) => {
    const { fns, calls } = stage(answer);
    let r;
    let threw = false;
    try { r = await fns.runOverlapCheck({ plan: plan3, results: results3 }); } catch { threw = true; }
    const logged = threw ? [] : fns.overlapLogLines(r);
    check(`did not run: ${name}`, !threw && r.ran === false && r.skipped === false && r.outcome === undefined && r.branches === undefined && r.pairs === undefined && /^overlap check did not run: /.test(r.reason) && pattern.test(r.reason) && same(r.mergeOrder, order3) && calls.length === 1 && logged[0] === r.reason.replace(/^o/, "O") && logged[1] === "Recommended merge order, not checked for overlap: task/042-a, task/043-b, task/044-c.", threw ? "threw" : JSON.stringify(r));
  };
  await notRun("the agent stage throws", new Error("agent stage failed"), /agent stage threw \(agent stage failed\)/);
  await notRun("the agent returns nothing", null, /returned nothing usable/);
  await notRun("the helper is not on PATH", { ran: false, exitStatus: -1, stdout: "", detail: "overlap helper not found" }, /overlap helper not found$/);
  await notRun("not run, and no reason given", { ran: false, exitStatus: -1, stdout: "" }, /no reason was reported/);
  await notRun("exit 1 carries the script's stderr", { ran: true, exitStatus: 1, stdout: "", stderr: "overlap: the branch 'task/043-b' names no commit here. Nothing was compared.\n" }, /exited 1: overlap: the branch 'task\/043-b' names no commit here\. Nothing was compared\.$/);
  await notRun("exit 64 carries the usage error", { ran: true, exitStatus: 64, stdout: "", stderr: "overlap: name at least two branches" }, /exited 64: overlap: name at least two branches/);
  await notRun("exit 1 with clean-looking stdout is still not an answer", { ran: true, exitStatus: 1, stdout: stdoutOverlap }, /exited 1: \(no stderr reported\)/);
  await notRun("a missing exit status", { ran: true, stdout: stdoutOverlap }, /exited undefined/);
  await notRun("exit 0 with nothing on stdout", { ran: true, exitStatus: 0, stdout: "" }, /could not be read — it printed nothing/);
  await notRun("exit 0 with a summary in place of the output", { ran: true, exitStatus: 0, stdout: "All three branches merge cleanly." }, /could not be read — its first line/);
  await notRun("exit 0 with a truncated output", { ran: true, exitStatus: 0, stdout: stdoutOverlap.split("\n").slice(0, 5).join("\n") }, /0 `pair=` line\(s\) for 3 unmerged/);
  await notRun("exit 0 beside outcome=conflict", { ran: true, exitStatus: 0, stdout: stdoutConflict }, /`outcome=conflict` beside exit status 0/);
  await notRun("exit 3 beside outcome=overlap", { ran: true, exitStatus: 3, stdout: stdoutOverlap }, /`outcome=overlap` beside exit status 3/);
  await notRun("an output for other branches than the ones asked about", { ran: true, exitStatus: 0, stdout: stdoutOverlap.replace(/task\/044-c/g, "task/099-z") }, /no `branch=` line for `task\/044-c`/);
}

// The Summary integration: every exit carries the field, with a stated reason
// where nothing was compared, and the stage sits before the closing reading.
{
  const body = src.slice(at);
  const abortCatch = body.indexOf("} catch (e) {\n  // Reported, not rethrown");
  const abortReturn = body.indexOf("Batch aborted:", abortCatch);
  const abortPath = abortCatch >= 0 && abortReturn > abortCatch ? body.slice(abortCatch, abortReturn) : null;
  check("abort catch reports no overlap check, with a stated reason", /Batch aborted[\s\S]*overlap: \{ ran: false, skipped: true, reason: "the batch aborted/.test(body));
  check("abort catch spawns nothing for it: no stage call and no agent between its catch and its return", abortPath !== null && !/runOverlapCheck\(|\bagent\(/.test(abortPath));
  check("the normal return carries overlap beside mainCheckout", /mainCheckout, overlap, openQuestions/.test(body));
  const resolverExits = body.match(/return \{ error: "Could not resolve task pointers from the argument\.".*\n/g) || [];
  check("every resolver-failure exit carries the skipped overlap result", resolverExits.length === 4 && resolverExits.every((line) => /overlap: overlapSkippedUnresolved\(\)/.test(line)), `${resolverExits.length} exits`);
  check("the resolver-failure and empty-batch results are skipped with a stated reason", /overlapSkippedUnresolved = \(\) => \(\{ ran: false, skipped: true, reason: "the task pointers were not resolved/.test(body) && /overlap: \{ ran: false, skipped: true, reason: "the batch resolved no task/.test(body));
  const summary = body.slice(body.lastIndexOf('phase("Summary");'));
  check("the stage renders under Summary: no phase of its own", !/phase\("Overlap/.test(src) && !/title: "Overlap/.test(src));
  check("the stage runs before the closing main-checkout reading, with the placement justified, and its lines are logged", summary.indexOf("await runOverlapCheck({ plan, results, remote })") !== -1 && summary.indexOf("runOverlapCheck(") < summary.indexOf("await finalMainCheckoutReport()") && /BEFORE the closing main-checkout reading, deliberately/.test(summary) && /for \(const line of overlapLogLines\(overlap\)\) log\(line\);/.test(summary));
  check("nothing of the review stack is left in the workflow", !/review.?stack|rebase-stack|guide branch|pre-rebase\/review/i.test(src));
}

check(`the suite ran all ${EXPECTED_CHECKS} checks`, ran === EXPECTED_CHECKS, `ran ${ran}`);
if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll batch-overlap checks passed.");
