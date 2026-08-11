#!/usr/bin/env node
// Focused pin for how the SKILLS establish the worktree base's ignore rule.
//
// `scripts/test-address-review-reconcile.mjs` pins this recipe on the WORKFLOW
// side ("the worktree base is made ignored before any arm adds under it…").
// The same recipe is also stated in prose by three skill steps, each shipped in
// two hand-edited mirrors with no generator between them, so six files can drift
// from the workflow and from each other one review-driven edit at a time. That
// is exactly what task 018a had to repair: all three carried a literal
// `.git/info/exclude`, which is not a path at all when the checkout is itself a
// linked worktree (`.git` is a gitfile, `.git/info` is not a directory, the
// append fails outright), so the protection was never established and the nested
// `git worktree add` left `?? .worktrees/` in the very checkout the step
// promises not to dirty.
//
// What is pinned here is the resolved form's load-bearing clauses, not whole
// sentences: reword freely around them. The clauses are asserted to appear in
// the WORKFLOW's own text too, so the skills cannot be "reconciled" into a
// second spelling of one recipe.
//
// Run: node scripts/test-skill-worktree-base-exclude.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`ok  - ${name}`);
  } else {
    failures++;
    console.error(`NOT ok - ${name}${detail ? `: ${detail}` : ""}`);
  }
}

// The step is a one-line paragraph in every mirror (AGENTS.md: one line per
// paragraph). Locate it by its stable anchor and fail loudly if the anchor no
// longer selects exactly one line, so the test cannot silently pass against a
// file it did not find.
function stepLine(tree, skill, anchor) {
  const path = join(repo, tree, "dev-skills", "skills", skill, "SKILL.md");
  const hits = readFileSync(path, "utf8").split("\n").filter((l) => l.includes(anchor));
  if (hits.length !== 1) {
    console.error(`FAIL: ${path} has ${hits.length} lines containing ${JSON.stringify(anchor)}; expected 1.`);
    process.exit(1);
  }
  return hits[0];
}

// The workflow states the recipe inside a JS template literal, where every
// backtick of the prose is escaped; unescape so the clauses compare as text.
const workflowText = readFileSync(
  join(repo, "plugins", "dev-skills", "workflows", "wf-address-review.js"),
  "utf8",
).replace(/\\`/g, "`");

// Clauses every one of the three steps must carry. Each is the ANSWER to a way
// the recipe silently fails: ask Git for the exclude file rather than spelling
// it (a linked worktree has no `.git/info` directory); ask from inside the
// repository (a primary checkout answers CWD-relative, so an answer appended to
// from elsewhere writes the rule where `check-ignore` never reads it); and probe
// with the trailing slash a directory-only rule needs before the directory it
// names exists — which is every first run.
const SHARED = [
  ["names the exclude file through `git rev-parse --git-path info/exclude`", /git rev-parse --git-path info\/exclude/],
  ["says the question is asked from inside the repository", /from inside `<repo>`/],
  ["probes with the trailing slash", /trailing slash/i],
];

// The two BOOTSTRAP steps state the full recipe, command and all. The
// `address-review` restatement deliberately carries neither the re-probe nor its
// blocker (task 018a scoped that out rather than reconciling it); do not add it
// to that file's list without deciding that question first.
const FULL = [
  ["gives the probe command with the trailing slash", /git check-ignore -q "<repo>\/\.worktrees\/"/],
  ["re-probes and makes a still-no answer a blocker", /re-probe and make a still-no answer a blocker/],
  ["warns that a linked worktree has no `.git/info` directory", /`\.git\/info` is not a directory at all/],
  ["points away from the tracked `.gitignore`", /NOT the tracked `\.gitignore`/],
];

const STEPS = [
  {
    skill: "address-reviews",
    anchor: "**Prepare the worktree base and prune stale state.**",
    clauses: [...SHARED, ...FULL],
  },
  {
    skill: "address-tasks",
    anchor: "**Choose the worktree base directory** (`$WT_BASE`)",
    clauses: [...SHARED, ...FULL],
  },
  {
    skill: "address-review",
    anchor: "Branch resolution and attach follow `address-reviews`",
    clauses: [
      ...SHARED,
      ["warns that a literal `.git/info/exclude` is not a path at all", /a literal `\.git\/info\/exclude` is not a path at all/],
      ["points away from the tracked `.gitignore`", /the tracked `\.gitignore`/],
    ],
  },
];

for (const { skill, anchor, clauses } of STEPS) {
  const plugins = stepLine("plugins", skill, anchor);
  const codex = stepLine("codex", skill, anchor);

  // Mirror parity is the standing risk: the step is shared prose, so the two
  // copies must be byte-identical rather than merely similar.
  check(`${skill}: the step is byte-identical across the two mirrors`, plugins === codex);

  for (const [name, re] of clauses) {
    check(`${skill}: ${name}`, re.test(plugins) && re.test(codex));
  }

  // Nothing may name `.git/info/exclude` as a path to WRITE. Every occurrence
  // has to be under a disclaimer — the RELATIVE answer a primary checkout gives,
  // or the literal you must not spell — which is what distinguishes the fixed
  // text from the instruction it replaced.
  for (const [tree, line] of [["plugins", plugins], ["codex", codex]]) {
    const bad = [...line.matchAll(/`\.git\/info\/exclude`/g)].filter(
      (m) => !/literal|RELATIVE/.test(line.slice(Math.max(0, m.index - 60), m.index)),
    );
    check(
      `${tree}/${skill}: no undisclaimed \`.git/info/exclude\` stated as a path to write`,
      bad.length === 0,
      `${bad.length} undisclaimed mention(s)`,
    );
  }
}

// One recipe, one spelling: the shared clauses are the workflow's own words, so
// a later round cannot "reconcile" the skills into a second phrasing of it.
for (const [name, re] of SHARED) {
  check(`wf-address-review.js states the same clause — ${name}`, re.test(workflowText));
}

// `declare-shadows` names `.git/info/exclude` too, as a rule source that does
// not reach teammates rather than a file to append to. It is out of this pin's
// scope on purpose; this check keeps that decision visible instead of leaving a
// later audit to rediscover the mention and "fix" it.
for (const tree of ["plugins", "codex"]) {
  const path = join(repo, tree, "dev-skills", "skills", "declare-shadows", "SKILL.md");
  const text = readFileSync(path, "utf8");
  check(
    `${tree}/declare-shadows names the exclude only as an unshared rule source`,
    /`\.git\/info\/exclude`/.test(text) && /does not ignore the path for teammates/.test(text),
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll checks passed.");
