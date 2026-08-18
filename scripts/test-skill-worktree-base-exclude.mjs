#!/usr/bin/env node
// Focused pin for how the SKILLS establish the worktree base's ignore rule.
//
// `scripts/test-address-review-reconcile.mjs` pins this recipe on the WORKFLOW
// side ("the worktree base is made ignored before any arm adds under it…").
// The same recipe is also stated in prose by three skill steps, each shipped in
// two hand-edited mirrors with no generator between them, so six files can drift
// from the workflow and from each other one review-driven edit at a time. That
// is what task 018a had to repair, in two different shapes. The two BOOTSTRAP
// steps told a run to append to a literal `.git/info/exclude`, which is not a
// path at all when the checkout is itself a linked worktree (`.git` is a
// gitfile, `.git/info` is not a directory, the append fails outright). The
// `address-review` restatement already resolved the path through Git and named
// the literal only to warn against it; its defect was solely the missing CWD
// clause — a primary checkout answers RELATIVE, so an answer appended to from
// another directory writes the rule where nothing reads it. Either way the
// protection was never established and the nested `git worktree add` left
// `?? .worktrees/` in the very checkout the step promises not to dirty.
//
// What is pinned here is the resolved form's load-bearing clauses, not whole
// sentences: reword freely around them. The clauses are asserted to appear in
// the WORKFLOWS' own text too — both of the two that state the recipe — so no
// surface can be "reconciled" into a second spelling of one recipe.
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

// The workflows state the recipe inside a JS template literal, where every
// backtick of the prose is escaped; unescape so the clauses compare as text.
function workflowText(file) {
  return readFileSync(join(repo, "plugins", "dev-skills", "workflows", file), "utf8").replace(/\\`/g, "`");
}
const reviewWorkflow = workflowText("wf-address-review.js");
const tasksWorkflow = workflowText("wf-address-tasks.js");

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

// The literal, matched bare or backticked: the scans below promise "every
// occurrence", and a mention that drops the code span must not slip past them.
const EXCLUDE_LITERAL = /`?\.git\/info\/exclude`?/g;

// The two BOOTSTRAP steps state the full recipe, command and all. The recipe
// probes and appends the one root-anchored name `/.worktrees/`, so the step may
// not offer an in-repo base OUTSIDE that name, which the re-probe would wave
// through unignored. Beneath it is a different matter and is pinned as its own
// clause: the append is a directory rule that carries the whole subtree, and
// `wt-bootstrap` — the helper both steps tell a run to prefer — reports
// `<repo>/.worktrees/$CONTAINER_NAME` as its base (`wf-address-tasks.js`'s
// BOOTSTRAP_SCHEMA), so a step that admitted only `.worktrees/` itself would
// reject the very result it just asked for. Asserting the subtree admission
// keeps a later round from re-tightening it back into that conflict.
const FULL = [
  ["constrains the in-repo base to `.worktrees/` and its subtree, and nothing else", /in-repo base is `\.worktrees\/` or a path beneath it\b[^\n]*\band nothing else/],
  ["admits the preferred helper's container-scoped base beneath it", /`<repo>\/\.worktrees\/\$CONTAINER_NAME`/],
  ["gives the probe command with the trailing slash", /git check-ignore -q "<repo>\/\.worktrees\/"/],
  ["re-probes and makes a still-no answer a blocker", /re-probe and make a still-no answer a blocker/],
  ["warns that a linked worktree has no `.git/info` directory", /`\.git\/info` is not a directory at all/],
  ["points away from the tracked `.gitignore`", /NOT the tracked `\.gitignore`/],
];

// The `address-review` restatement deliberately carries neither the re-probe nor
// its blocker — task 018a scoped that deviation out rather than reconciling it —
// so the exclusion is pinned as ABSENCE rather than as omission from the list
// above. Omission pins one direction only: it stops the clause being dropped
// where it belongs, while the reconciliation this decision refuses — adding it
// here — would sail through. Asserted both ways, moving that clause in either
// direction costs a deliberate edit to this file, which is what "pinned as a
// decision" has to mean. The pattern is loose on purpose: a reconciliation
// copies the workflow's own spelling, and either half of it selects.
const ABSENT_REPROBE = [
  ["deliberately carries no re-probe and no still-no blocker", /re-?probe|still-no/i],
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
    absent: ABSENT_REPROBE,
  },
];

for (const { skill, anchor, clauses, absent = [] } of STEPS) {
  const plugins = stepLine("plugins", skill, anchor);
  const codex = stepLine("codex", skill, anchor);

  // Mirror parity is the standing risk: the step is shared prose, so the two
  // copies must be byte-identical rather than merely similar.
  check(`${skill}: the step is byte-identical across the two mirrors`, plugins === codex);

  for (const [name, re] of clauses) {
    check(`${skill}: ${name}`, re.test(plugins) && re.test(codex));
  }

  for (const [name, re] of absent) {
    check(`${skill}: ${name}`, !re.test(plugins) && !re.test(codex));
  }

  // Nothing may name `.git/info/exclude` as a path to WRITE. Every occurrence
  // has to be under a disclaimer — the RELATIVE answer a primary checkout gives,
  // or the literal you must not spell — which is what distinguishes the fixed
  // text from the instruction it replaced.
  for (const [tree, line] of [["plugins", plugins], ["codex", codex]]) {
    const bad = [...line.matchAll(EXCLUDE_LITERAL)].filter(
      (m) => !/literal|RELATIVE/.test(line.slice(Math.max(0, m.index - 60), m.index)),
    );
    check(
      `${tree}/${skill}: no undisclaimed \`.git/info/exclude\` stated as a path to write`,
      bad.length === 0,
      `${bad.length} undisclaimed mention(s)`,
    );
  }
}

// Both BOOTSTRAP steps tell a run to PREFER the baked `wt-bootstrap` helper
// over doing the checks by hand. The helper establishes no ignore rule — it
// names neither `check-ignore` nor an exclude file anywhere — and in
// self-hosted mode, where the worktree roots are ordinary subdirectories rather
// than mounts, it reports `ok` for a repository that ignores nothing. So a run
// that reads "prefer it", takes the reported `wtBase`, and skips the by-hand
// branch never establishes the rule and never reaches the blocker inside the
// branch it skipped. The obligation therefore has to be stated on the
// PREFERENCE statement itself, which in `address-tasks` is a paragraph away
// from the step it defers to — out of reach of the step pins above, hence its
// own anchor here. Pinned so a later round cannot restore an unqualified "it
// covers those and nothing else" over the ignore half.
const PREFERENCE_ANCHOR = "If a `wt-bootstrap` helper is on PATH";
const PREFERENCE = [
  ["says the preferred helper establishes no ignore rule", /establishes no ignore rule/],
  ["leaves making an in-repo base ignored with the run", /still yours to make ignored/],
];

for (const skill of ["address-tasks", "address-reviews"]) {
  const plugins = stepLine("plugins", skill, PREFERENCE_ANCHOR);
  const codex = stepLine("codex", skill, PREFERENCE_ANCHOR);

  check(`${skill}: the \`wt-bootstrap\` preference is byte-identical across the two mirrors`, plugins === codex);

  for (const [name, re] of PREFERENCE) {
    check(`${skill}: ${name}`, re.test(plugins) && re.test(codex));
  }

  // The preference statement must POINT AT the recipe, not restate it: a second
  // spelling beside the first is the drift this whole file exists to stop, and
  // the pins above would not notice one added outside the step line. Counted
  // file-wide, so it does not matter which line the copy would land on.
  for (const tree of ["plugins", "codex"]) {
    const path = join(repo, tree, "dev-skills", "skills", skill, "SKILL.md");
    const probes = readFileSync(path, "utf8").match(/git check-ignore/g) ?? [];
    check(
      `${tree}/${skill}: states the ignore recipe's probe exactly once`,
      probes.length === 1,
      `${probes.length} occurrence(s)`,
    );
  }
}

// One recipe, one spelling: the shared clauses are the workflows' own words, so
// a later round cannot "reconcile" the skills into a second phrasing of it.
for (const [name, re] of SHARED) {
  check(`wf-address-review.js states the same clause — ${name}`, re.test(reviewWorkflow));
}

// Task 047a carried the same obligation onto the OTHER workflow surface.
// `wf-address-tasks.js`'s bootstrap prompt used to tell its subagent that
// `wt-bootstrap` "performs the whole Session Bootstrap deterministically" and
// then enumerate what it does — a list with no ignore rule in it, because the
// helper establishes none — while its helper-ABSENT branch returned a blocker
// and said not to re-derive the checks by hand. So the rule was established in
// no configuration: helper present, the step reported complete; helper absent,
// the run stopped. Only the first of those was a defect, and only it was fixed:
// the absent branch still stops, because a bootstrap that returns `ok: false`
// adds no worktree and so has no base to protect (task 046b keeps that fallback
// reachable rather than retiring it).
//
// Pinned beside the skills' PREFERENCE block rather than in a workflow-only
// suite, so the two surfaces cannot drift apart again: the workflow now states
// the SHARED clauses in the same spelling, carries the preference clauses the
// skills carry, and states the probe exactly once — this file being the one
// that counts occurrences, since a second spelling here is the drift it exists
// to stop. The retired claim is asserted ABSENT: 047a's review plan treats a
// restored "performs the whole Session Bootstrap" as a regression, and omission
// from a clause list would not notice one coming back.
for (const [name, re] of SHARED) {
  check(`wf-address-tasks.js states the same clause — ${name}`, re.test(tasksWorkflow));
}
for (const [name, re] of PREFERENCE) {
  check(`wf-address-tasks.js: ${name}`, re.test(tasksWorkflow));
}
check(
  "wf-address-tasks.js no longer claims the helper performs the whole Session Bootstrap",
  !/performs the whole Session Bootstrap/.test(tasksWorkflow),
);
{
  const probes = tasksWorkflow.match(/git check-ignore/g) ?? [];
  check(
    "wf-address-tasks.js states the ignore recipe's probe exactly once",
    probes.length === 1,
    `${probes.length} occurrence(s)`,
  );
  // Same undisclaimed-literal scan the skill steps get: every mention of the
  // literal must sit under a disclaimer (the RELATIVE answer a primary checkout
  // gives, or the literal you must not spell), never stand as a path to write.
  const bad = [...tasksWorkflow.matchAll(EXCLUDE_LITERAL)].filter(
    (m) => !/literal|RELATIVE/.test(tasksWorkflow.slice(Math.max(0, m.index - 60), m.index)),
  );
  check(
    "wf-address-tasks.js: no undisclaimed `.git/info/exclude` stated as a path to write",
    bad.length === 0,
    `${bad.length} undisclaimed mention(s)`,
  );
}

// `declare-shadows` names `.git/info/exclude` too, as a rule source that does
// not reach teammates rather than a file to append to. It is out of the step
// pins' scope on purpose; this check keeps that decision visible instead of
// leaving a later audit to rediscover the mention and "fix" it. The undisclaimed
// scan above runs over the three step LINES, so this file is the one place the
// literal appears with no scan over it — which is why the mention is counted
// rather than merely looked for. "Only" has to mean only: a SECOND mention, such
// as an added instruction to append there directly, is the defect this file's
// single disclaimed mention would otherwise camouflage.
for (const tree of ["plugins", "codex"]) {
  const path = join(repo, tree, "dev-skills", "skills", "declare-shadows", "SKILL.md");
  const mentions = readFileSync(path, "utf8")
    .split("\n")
    .flatMap((line) => [...line.matchAll(EXCLUDE_LITERAL)].map(() => line));
  check(
    `${tree}/declare-shadows names the exclude exactly once`,
    mentions.length === 1,
    `${mentions.length} mention(s)`,
  );
  check(
    `${tree}/declare-shadows names the exclude only as an unshared rule source`,
    mentions.length === 1 && /does not ignore the path for teammates/.test(mentions[0]),
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll checks passed.");
