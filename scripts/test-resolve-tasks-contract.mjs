#!/usr/bin/env node
// Focused prose-contract coverage for the shared task-pointer resolver, its
// three consumers in both hand-maintained mirrors, and wf-address-tasks's
// hands-off structured-plan adoption.
//
// Run: node scripts/test-resolve-tasks-contract.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const read = (...parts) => readFileSync(join(repo, ...parts), "utf8");

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`ok  - ${name}`);
  else {
    failures++;
    console.error(`NOT ok - ${name}${detail ? `: ${detail}` : ""}`);
  }
}

const pluginResolver = read("plugins", "dev-skills", "skills", "resolve-tasks", "SKILL.md");
const codexResolver = read("codex", "dev-skills", "skills", "resolve-tasks", "SKILL.md");
check("resolve-tasks skill mirrors are byte-identical", pluginResolver === codexResolver);

const resolverClauses = [
  ["is read-only", /This skill is read-only[\s\S]*never edits, moves, archives, promotes, or renumbers/],
  ["resolves the repository task folder", /Resolve the repository root and its task folder from repository guidance first/],
  ["infers another repository's convention", /Infer a documented or de-facto convention[\s\S]*do not force another repository/],
  ["uses Task 027's full-number definition", /full-number parsing definition owned by Task 027/],
  ["normalizes unpadded numbers", /`27` as `027`/],
  ["keeps primaries separate from suffix families", /`015b` selects only `015b`[\s\S]*`015` selects only `015`/],
  ["recurses through done and deferred", /recursively through the whole task subtree, including `done\/`, `deferred\/`, and future nested folders/],
  ["tags every path with raw input provenance", /attach every selecting raw input[\s\S]*\{ raw, kind \}/],
  ["classifies per full number", /Classify each matched \*\*full number\*\*, once across the entire subtree/],
  ["makes ambiguity precede folder status", /`ambiguous` takes precedence over folder classifications/],
  ["classifies glob matches individually", /Globs are never classified as a unit/],
  ["keeps number resolution in the task subtree", /Number inputs select only well-formed task specs in the resolved task subtree/],
  ["preserves external explicit path and glob matches", /Explicit paths and globs retain the consumer's existing reach:[\s\S]*including one outside the resolved task subtree/],
  ["reports external paths without inventing subtree state", /outside the resolved task subtree is not `not-found`[\s\S]*`classification` as `outside-subtree`[\s\S]*omit that number from `numbers`/],
  ["reports not-found per raw input", /For every raw number, path, or glob that selects no well-formed task file, emit one `not-found` diagnostic/],
  ["returns the three resolver collections", /`paths`:[\s\S]*`numbers`:[\s\S]*`notFound`:/],
  ["does not expand an explicit input to an unselected duplicate", /explicit path or glob does not pull an unselected same-number sibling into `paths`/],
  ["gives explicit selection precedence", /both number and explicit provenance, it counts as explicitly selected/],
  ["excludes review-skill PR numbers", /numbers passed to those review skills are PR numbers, not task numbers/],
];
for (const [name, pattern] of resolverClauses) check(`resolver ${name}`, pattern.test(pluginResolver));

function section(text, start, end) {
  const from = text.indexOf(start);
  if (from < 0) return "";
  const to = text.indexOf(end, from + start.length);
  return text.slice(from, to < 0 ? text.length : to);
}

for (const skill of ["address-tasks", "address-tasks-serialized", "reap-tasks"]) {
  const plugin = read("plugins", "dev-skills", "skills", skill, "SKILL.md");
  const codex = read("codex", "dev-skills", "skills", skill, "SKILL.md");
  const preflightEnd = skill === "address-tasks" ? "\nThis skill is the parallel sibling" : "\n## ";
  const pluginPreflight = section(plugin, "## Task-pointer preflight", preflightEnd);
  const codexPreflight = section(codex, "## Task-pointer preflight", preflightEnd);
  check(`${skill} exposes numbers as a first-class argument`, /mixed-list of task numbers, task-file paths, and globs/.test(plugin) && /mixed-list of task numbers, task-file paths, and globs/.test(codex));
  check(`${skill} preflight exists in both mirrors`, pluginPreflight.length > 0 && codexPreflight.length > 0);
  check(`${skill} preflight is byte-identical across mirrors`, pluginPreflight === codexPreflight);
  check(`${skill} delegates resolution to a fresh own-context subagent`, /run `resolve-tasks`[\s\S]{0,80}fresh resolution subagent with its own context window/.test(pluginPreflight));
  check(`${skill} keys policy from provenance`, /packet's `selectedBy` provenance/.test(pluginPreflight));
  check(`${skill} preserves explicit path and glob execution`, /explicit path or glob[\s\S]*`outside-subtree`/.test(pluginPreflight));
  check(`${skill} pins interactive as the available-session default`, /direct skill invocation defaults to interactive whenever the maintainer can answer in the current session/.test(pluginPreflight));
  check(`${skill} selects hands-off only explicitly or for a non-pausing runtime`, /hands-off only when the maintainer explicitly requests it or the invoking runtime cannot accept mid-run input/.test(pluginPreflight));
  check(`${skill} surfaces not-found for every input form`, /Unmatched number, path, or glob never executes[\s\S]*`not-found` diagnostic is always surfaced/i.test(pluginPreflight));
  check(`${skill} shows bare-number mappings interactively`, /show the resolved mapping before (executing|verifying) a bare-numbers invocation/.test(pluginPreflight));
  check(`${skill} requires per-number ambiguous selection`, /for each `ambiguous` number[\s\S]*select exactly one candidate or exclude that number/i.test(pluginPreflight));
  check(`${skill} never blanket-runs ambiguity`, /blanket continue must never (include|verify) every candidate/.test(pluginPreflight));
  check(`${skill} hands-off policy keeps active numbers and explicit inputs`, /hands-off run[\s\S]*(execute|verify) only the number-selected unambiguous `active` paths plus every explicit path\/glob selection/.test(pluginPreflight));
  check(`${skill} hands-off policy documents all exclusions`, /Exclude and document every number-selected[\s\S]*every `not-found` input; never guess an ambiguous number/.test(pluginPreflight));
  check(`${skill} does not restate resolver mechanics`, !/three digits|optional lowercase|Inventory well-formed|Parse each task filename/.test(pluginPreflight));
}

const reap = read("plugins", "dev-skills", "skills", "reap-tasks", "SKILL.md");
const reapPreflight = section(reap, "## Task-pointer preflight", "\n## ");
check("reap-tasks reads number-selected done as already reaped", /resolves only to `done` means already reaped: report it and never re-verify it/.test(reapPreflight));
check("reap-tasks never offers to reverify number-selected done", /confirmation asks only whether to proceed with the remaining selected work; it must never offer to re-verify that done entry/.test(reapPreflight));
check("reap-tasks defines no-argument sweep input", /ordinary no-argument sweep retains its existing inventory flow:[\s\S]*pass those discovered candidate paths through this same resolver packet boundary/.test(reapPreflight));

const workflow = read("plugins", "dev-skills", "workflows", "wf-address-tasks.js");
const workflowClauses = [
  ["accepts mixed task pointers", /mixed list of task numbers, task-file paths, and globs/],
  ["delegates mechanics to resolve-tasks", /Follow the \\`resolve-tasks\\` skill's shared contract/],
  ["applies hands-off policy", /Apply the workflow's HANDS-OFF consumer policy/],
  ["keeps explicit selections", /Include as executable every explicit path\/glob selection whatever its classification/],
  ["keeps explicit selections outside the task subtree", /outside the resolved task subtree whose report status is \\`outside-subtree\\`/],
  ["excludes all non-active number states", /Exclude every number-selected \\`done\\`, \\`deferred\\`, or \\`ambiguous\\` classification/],
  ["never guesses ambiguity", /never guess an ambiguous number/],
  ["records structured exclusions", /resolution\.exclusions/],
  ["omits classification from not-found exclusions", /omit it[\s\S]*for a \\`not-found\\` input, which has no matched task file or full number to classify/],
  ["supports only an explained empty batch", /Return an empty \\`waves\\` array only when resolution leaves no executable task[\s\S]*resolution\.exclusions[\s\S]*resolution\.notFound[\s\S]*resolution failure, not a no-op/],
  ["requires structured resolution in the plan", /required: \["defaultBase", "resolution", "waves"\]/],
  ["returns resolution in the normal summary", /collisions, resolution: plan\.resolution, mainCheckout/],
];
for (const [name, pattern] of workflowClauses) check(`workflow ${name}`, pattern.test(workflow));

const exclusionsSchema = section(workflow, "        exclusions: {", "      required: [\"paths\", \"numbers\", \"notFound\", \"exclusions\"]");
check("workflow exclusion schema does not require classification", /required: \["raw", "kind", "paths", "reason"\]/.test(exclusionsSchema) && !/required: \[[^\]]*"classification"/.test(exclusionsSchema));
check("workflow not-found exclusions require an empty path list", /set \\`paths: \[\]\\` for a \\`not-found\\` input/.test(workflow));

const emptyPlanMatch = workflow.match(/function emptyPlanIsExplained\(plan\) \{[\s\S]*?\n\}/);
check("workflow defines an empty-plan explanation gate", !!emptyPlanMatch);
if (emptyPlanMatch) {
  // eslint-disable-next-line no-new-func
  const emptyPlanIsExplained = new Function(`return (${emptyPlanMatch[0]});`)();
  const packet = (overrides = {}) => ({ resolution: { paths: [], numbers: [], notFound: [], exclusions: [], ...overrides }, waves: [] });
  check("empty workflow plan with an exclusion is a documented no-op", emptyPlanIsExplained(packet({ exclusions: [{ reason: "done number" }] })) === true);
  check("empty workflow plan with not-found is a documented no-op", emptyPlanIsExplained(packet({ notFound: [{ raw: "999" }] })) === true);
  check("empty workflow plan without diagnostics is unexplained", emptyPlanIsExplained(packet()) === false);
  check("empty workflow plan without a resolution packet is unexplained", emptyPlanIsExplained({ waves: [] }) === false);
}
check("workflow returns the prior resolution error for unexplained empty waves", /if \(!emptyPlanIsExplained\(plan\)\)[\s\S]*error: "Could not resolve task pointers from the argument\."/.test(workflow));
const emptyNoOp = workflow.match(/return \{ batch: args, defaultBase: plan\.defaultBase, remote, peer: peerMode, peerThrottle:[^\n]+waves: 0,[^\n]+results: \[\] \};/);
check("workflow explained-empty summary retains the normal summary fields", !!emptyNoOp && /throttled: \[\]/.test(emptyNoOp[0]) && /collisions: \[\]/.test(emptyNoOp[0]) && /openQuestions: \[\]/.test(emptyNoOp[0]) && /deviations: \[\]/.test(emptyNoOp[0]) && /deviationAssessments: \[\]/.test(emptyNoOp[0]));

for (const skill of ["address-tasks", "address-tasks-serialized", "reap-tasks", "resolve-tasks"]) {
  const metadata = read("codex", "dev-skills", "skills", skill, "agents", "openai.yaml");
  check(`${skill} Codex metadata exposes mixed task pointers`, /numbers-paths-or-globs/.test(metadata));
  check(`${skill} Codex metadata no longer advertises folder-or-glob only`, !/folder-or-glob/.test(metadata));
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll checks passed.");
