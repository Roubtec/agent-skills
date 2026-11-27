#!/usr/bin/env node
// Focused pin for how the SKILLS and the WORKFLOWS get the worktree base's
// ignore rule established: through the `address-tasks` skill's `bootstrap.sh`,
// and through nothing else.
//
// The rule used to be a recipe stated in prose on five surfaces — three skill
// steps, each shipped in two hand-edited mirrors, and two workflow briefs — and
// every incident this file records was one of those copies drifting. Task 018a:
// two bootstrap steps appended to a literal `.git/info/exclude`, which is not a
// path at all when the checkout is a linked worktree, and `address-review`
// resolved the path through Git but not from inside the repository, so the
// rule landed in a file nothing reads. Task 047: both bootstrap steps told a
// run to prefer `wt-bootstrap`, which establishes no ignore rule and reports
// `ok` without one. Task 047a: the batch workflow said the same of it.
//
// Task 057 moved the recipe into the script, so what each incident protects now
// lives in two places. The recipe's own clauses — the exclude file asked of Git
// from inside the main checkout, the trailing-slash probe, the second probe and
// its stop, the rule established whether or not `wt-bootstrap` answered — are
// BEHAVIOUR, and `scripts/test-address-tasks-bootstrap.sh` runs them from a
// primary checkout, a subdirectory and a linked worktree. What is left to pin
// by text is here: that every surface calls the script, that none of them
// states the recipe beside it (a second spelling is how the drift starts
// again), and the judgement each surface keeps — what a stop means there.
//
// Run: node scripts/test-skill-worktree-base-exclude.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { logicalLines } from "./lib/logical-lines.mjs";

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

// Locate the step by its stable anchor and fail loudly if the anchor no longer
// selects exactly one logical line, so the test cannot silently pass against a
// file it did not find.
function stepLine(tree, skill, anchor) {
  const path = join(repo, tree, "dev-skills", "skills", skill, "SKILL.md");
  const hits = logicalLines(readFileSync(path, "utf8")).filter((l) => l.includes(anchor));
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

// A workflow's prompt states each numbered step as one line, the same shape the
// skills' steps have, so a clause can be pinned to the exact line that must
// carry it rather than to the file. That matters where a phrase is stated more
// than once: `establishes no ignore rule` appears twice in `wf-address-tasks.js`
// — the prompt's step 1 and `BOOTSTRAP_SCHEMA`'s `wtBase` description — so a
// file-wide pin would survive the prompt's copy being reworded into an actively
// WRONG claim while the schema's copy went on satisfying it, which is exactly
// the claim 047a retired. Fails loudly, like `stepLine`, if the anchor stops
// selecting one line, so no pin can silently run against text it did not find.
function workflowLine(text, file, anchor) {
  const hits = text.split("\n").filter((l) => l.includes(anchor));
  if (hits.length !== 1) {
    console.error(`FAIL: ${file} has ${hits.length} lines containing ${JSON.stringify(anchor)}; expected 1.`);
    process.exit(1);
  }
  return hits[0];
}

// What every one of the three steps must say. The script is another skill's
// for two of them, so the line that names it names its owner too, and the rule
// still goes where it dirties nothing: the repo-local exclude file, never the
// tracked `.gitignore`.
const SHARED = [
  ["names the script", /`bootstrap\.sh (?:run|ignore)`/],
  ["forbids doing the script's work by hand", /by hand/],
  ["says the rule goes in the repo-local exclude file", /repo-local exclude file/],
  ["points away from the tracked `.gitignore`", /the tracked `\.gitignore`/],
];

// The hand recipe, in any of the spellings it has had. No surface may carry
// one: the script is the recipe, and a copy beside the call is free to drift.
const HAND_RECIPE = [
  ["a `check-ignore` probe", /check-ignore/],
  ["an exclude file named as a path", /info\/exclude/],
  ["an append instruction", /append `?\/\.worktrees\/`?/],
];

// The two BOOTSTRAP steps run the whole bootstrap. Each keeps the judgement:
// a stop is a blocker, and the base is the one the script reported — the rule
// it lists is the one root-anchored name `/.worktrees/`, so an in-repo base
// chosen anywhere else would be ready and unignored. Task 047's clause stays on
// the same line as the call: the helper the script prefers establishes no
// ignore rule, so the rule has to be said to be the script's on BOTH paths, or
// a later round can restore "the helper covers it".
const FULL = [
  ["runs the whole bootstrap", /`bootstrap\.sh run`/],
  ["makes a stop a blocker that creates no worktree", /`outcome=stop` is a blocker[^\n]*create no worktree/],
  ["forbids working around a stop", /never work around it/],
  ["makes a failure that printed no outcome a blocker too", /Any other non-zero exit[^\n]*is a blocker too[^\n]*create no worktree/],
  ["keeps a host-shared base a notice, not a blocker", /`host-shared=yes`[^\n]*is \*\*not\*\* a blocker[^\n]*tell the user once[^\n]*proceed/],
  ["takes the reported base and no other", /`wt-base=` path[^\n]*\band no other/],
  ["admits the preferred helper's container-scoped base beneath `.worktrees/`", /`<repo>\/\.worktrees\/\$CONTAINER_NAME`/],
  ["says the preferred helper establishes no ignore rule", /establishes no ignore rule/],
  ["says the rule is the script's on both paths", /the ignore rule is the script's own on both paths/],
  ["points away from the tracked `.gitignore`", /NOT in the tracked `\.gitignore`/],
  ["leaves a leftover with content alone", /never remove one yourself/],
];

// The `address-review` step deliberately makes neither the second probe nor a
// still-unignored base a blocker — task 018a scoped that deviation out rather
// than reconciling it — so the exclusion is pinned as ABSENCE rather than as
// omission from the list above. Omission pins one direction only: it stops the
// clause being dropped where it belongs, while the reconciliation this decision
// refuses — adding it here — would sail through. The script probes twice
// whoever calls it, so what the decision comes to now is what this skill does
// with its stop: it attaches all the same and reports, and that is pinned as
// stated too, since a silent line would leave a run to guess. Moving the
// clause in either direction costs a deliberate edit to this file.
const ABSENT_REPROBE = [
  ["deliberately carries no re-probe and no still-no blocker", /re-?probe|still-no/i],
  ["deliberately makes the script's stop no blocker", /is a blocker/],
];

const STEPS = [
  {
    skill: "address-reviews",
    anchor: "**Prepare the worktree base and prune stale state.**",
    owner: true,
    clauses: [...SHARED, ...FULL, ["makes an unreachable remote a stop here", /`remote=no` is a stop too/]],
  },
  {
    skill: "address-tasks",
    anchor: "**Run the worktree bootstrap:**",
    clauses: [...SHARED, ...FULL, ["keeps an unreachable remote a fallback, not a blocker", /`remote=no` is \*\*not\*\* a blocker/]],
  },
  {
    skill: "address-review",
    anchor: "Branch resolution and attach follow `address-reviews`",
    owner: true,
    clauses: [
      ...SHARED,
      ["runs the ignore rule alone", /`bootstrap\.sh ignore`/],
      ["runs it before the first attach", /before the first attach run `bootstrap\.sh ignore`/],
      ["says what this skill does with a stop", /`outcome=stop` does not halt this run/],
      ["carries the stop into the final report", /`blocker=` line into the final report/],
      ["makes a stop that names no base attach nothing", /A stop with no `wt-base=` line[^\n]*attach nothing/],
      ["makes a failure that printed no outcome attach nothing", /Any other non-zero exit[^\n]*no `outcome=` line[^\n]*attach nothing/],
    ],
    absent: ABSENT_REPROBE,
  },
];

for (const { skill, anchor, clauses, absent = [], owner = false } of STEPS) {
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

  // A consumer says whose script it is, where a reader meets the name.
  if (owner) {
    check(`${skill}: names the script's owner beside it`, /sibling `address-tasks` skill folder/.test(plugins) && /sibling `address-tasks` skill folder/.test(codex));
  }

  // The recipe is the script's. Counted over the whole file rather than the
  // step line, so it does not matter where a copy would land.
  for (const tree of ["plugins", "codex"]) {
    const text = readFileSync(join(repo, tree, "dev-skills", "skills", skill, "SKILL.md"), "utf8");
    for (const [name, re] of HAND_RECIPE) {
      check(`${tree}/${skill}: states no hand recipe — ${name}`, !re.test(text));
    }
    const calls = text.match(/`bootstrap\.sh (?:run|ignore)`/g) ?? [];
    check(`${tree}/${skill}: orders the script exactly once`, calls.length === 1, `${calls.length} occurrence(s)`);
  }
}

// The workflows reach the same script through the plugin's `bin/` shim, and
// state no recipe either. `wf-address-review.js` attaches one worktree and so
// runs the ignore rule alone; unlike the skill of the same name it stops on
// the script's stop, as it always has.
for (const [file, text] of [["wf-address-review.js", reviewWorkflow], ["wf-address-tasks.js", tasksWorkflow]]) {
  for (const [name, re] of HAND_RECIPE) {
    check(`${file}: states no hand recipe — ${name}`, !re.test(text));
  }
}
{
  const calls = reviewWorkflow.match(/`address-tasks-bootstrap [a-z -]+`/g) ?? [];
  check("wf-address-review.js orders `address-tasks-bootstrap ignore`, once", calls.length === 1 && calls[0] === "`address-tasks-bootstrap ignore`", JSON.stringify(calls));
  const line = workflowLine(reviewWorkflow, "wf-address-review.js", "`address-tasks-bootstrap ignore`");
  check("wf-address-review.js: the script's stop is a blocker that attaches nothing", /`outcome=stop`[^.]*`ok: false`[^.]*attach nothing/.test(line));
  check("wf-address-review.js: a failure that printed no outcome is a blocker that attaches nothing", /Any other exit, or no `outcome=` line, is a blocker too[^.]*attach nothing/.test(line));
  check("wf-address-review.js: points away from the tracked `.gitignore`", /NOT the tracked `\.gitignore`/.test(line));
  check("wf-address-review.js: forbids establishing the rule any other way", /Establish the rule no other way/.test(line));
}

// Task 047a's obligation on the batch workflow. Its bootstrap prompt used to
// tell its subagent that `wt-bootstrap` "performs the whole Session Bootstrap
// deterministically" — a list with no ignore rule in it, because the helper
// establishes none. The prompt now runs the script, which runs the helper and
// then establishes the rule; `--require-helper` keeps the helper-ABSENT branch
// the stop it was, because the batch's later steps need the other `wt-*`
// helpers (task 046b keeps that fallback reachable rather than retiring it),
// and the script writes nothing on that stop.
//
// The retired claim is asserted ABSENT: 047a's review plan treats a restored
// "performs the whole Session Bootstrap" as a regression, and omission from a
// clause list would not notice one coming back.
const tasksHelperStep = workflowLine(tasksWorkflow, "wf-address-tasks.js", "1. From the repo root, run `address-tasks-bootstrap run --require-helper`");
const tasksReadyStep = workflowLine(tasksWorkflow, "wf-address-tasks.js", "2. `outcome=ready` (exit 0)");
const tasksStopStep = workflowLine(tasksWorkflow, "wf-address-tasks.js", "3. `outcome=stop` (exit 3)");
const tasksWtBaseField = workflowLine(tasksWorkflow, "wf-address-tasks.js", "Absolute path to this container's worktree base");

// Anchored to the step that runs the script, not to the file: the schema's
// copy of the same statement must not be able to stand in for it.
check("wf-address-tasks.js: says the helper establishes no ignore rule", /establishes no ignore rule/.test(tasksHelperStep));
check("wf-address-tasks.js: says the script does that half, before any worktree is added", /the script then does that half[^.]*BEFORE any worktree is added/.test(tasksHelperStep));
check("wf-address-tasks.js: forbids a hand-made rule, check, or helper run beside the script's", /Establish nothing by hand/.test(tasksHelperStep));
check("wf-address-tasks.js: points away from the tracked `.gitignore`", /never in the tracked `\.gitignore`/.test(tasksHelperStep));
{
  const calls = tasksWorkflow.match(/`address-tasks-bootstrap [a-z -]+`/g) ?? [];
  check("wf-address-tasks.js orders `address-tasks-bootstrap run --require-helper`, once", calls.length === 1 && calls[0] === "`address-tasks-bootstrap run --require-helper`", JSON.stringify(calls));
}
// The schema field carries the statement too — the acceptance criterion covers
// "prompt literals or schema field descriptions" — so it is pinned in its own
// right rather than left to be satisfied by the prompt's copy.
check(
  "wf-address-tasks.js: `BOOTSTRAP_SCHEMA`'s `wtBase` says the helper establishes no ignore rule",
  /establishes no ignore rule/.test(tasksWtBaseField),
);
// The ready step maps the script's lines "with no reinterpretation", and the
// stop step is what keeps that from outranking a refusal: a still-unignored
// base arrives as a stop, and an `ok` returned over it is exactly the answer
// the batch would add worktrees under. So the stop is pinned as final, and as
// the place the unignored base and the missing helper both arrive.
check("wf-address-tasks.js: a ready answer is mapped with no reinterpretation", /no reinterpretation/.test(tasksReadyStep) && /`wt-base=`/.test(tasksReadyStep));
check(
  "wf-address-tasks.js: a stop is returned as `ok: false` with the script's blocker, and is final",
  /`ok: false` with its `blocker=` line verbatim[^.]*that decision is final/.test(tasksStopStep),
);
check("wf-address-tasks.js: the stop covers a base still not ignored", /still not ignored/.test(tasksStopStep));
check("wf-address-tasks.js: the stop covers a missing `wt-bootstrap`, with no plain-git fallback", /not on PATH[^.]*rather than fall back to plain git/.test(tasksStopStep));
check(
  "wf-address-tasks.js no longer claims the helper performs the whole Session Bootstrap",
  !/performs the whole Session Bootstrap/.test(tasksWorkflow),
);

// `declare-shadows` names `.git/info/exclude` too, as a rule source that does
// not reach teammates rather than a file to append to. It is out of the step
// pins' scope on purpose; this check keeps that decision visible instead of
// leaving a later audit to rediscover the mention and "fix" it. The hand-recipe
// scan above runs over the three skills that call the script, so this file is
// the one place the literal appears with no scan over it — which is why the
// mention is counted rather than merely looked for. "Only" has to mean only: a
// SECOND mention, such as an added instruction to append there directly, is the
// defect this file's single disclaimed mention would otherwise camouflage.
// Matched bare or backticked, so a mention that drops the code span counts.
const EXCLUDE_LITERAL = /`?\.git\/info\/exclude`?/g;
for (const tree of ["plugins", "codex"]) {
  const path = join(repo, tree, "dev-skills", "skills", "declare-shadows", "SKILL.md");
  const mentions = logicalLines(readFileSync(path, "utf8")).flatMap((line) =>
    [...line.matchAll(EXCLUDE_LITERAL)].map(() => line),
  );
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

// No recipe in `address-reviews` tells a run to `cd` INTO a path built out of
// `$WT_BASE` any more: the fork attach that did (task 046a) went with fork-PR
// support. `cd ""` returns 0 and moves nowhere, and an empty `$WT_BASE` makes
// the path the absolute `/pr-<N>`, so the absence pin stays and runs file-wide:
// a `$WT_BASE` — or a `${WT_BASE}` — may follow a `cd` only where the `:?` that
// makes an empty base fatal immediately follows the name.
const UNGUARDED_CD = /\bcd[ \t]+(?:--[ \t]+)?"?\$\{?WT_BASE(?!:\?)/;
{
  const texts = ["plugins", "codex"].map((tree) => [
    tree,
    readFileSync(join(repo, tree, "dev-skills", "skills", "address-reviews", "SKILL.md"), "utf8"),
  ]);
  for (const [tree, text] of texts) {
    check(
      `${tree}/address-reviews: the fork attach recipe is gone, and no \`gh pr checkout\` is ordered`,
      !text.includes("gh pr checkout"),
    );
    check(
      `${tree}/address-reviews: no unguarded \`cd\` into a \`$WT_BASE\`-built path — quoted, unquoted, or \`--\`-prefixed — survives anywhere in the file`,
      !UNGUARDED_CD.test(text),
    );
  }
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll checks passed.");
