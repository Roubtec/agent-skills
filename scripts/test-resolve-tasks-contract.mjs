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
  ["admits only well-formed task specs", /well-formed task spec follows the repository's resolved task-filename convention and its task-document form[\s\S]*arbitrary file is not a task spec/],
  ["recognizes inferred nonnumeric task schemes", /conventions inferred from the repository's real specs, such as `A-01-/],
  ["normalizes unpadded numbers", /`27` as `027`/],
  ["keeps primaries separate from suffix families", /`015b` selects only `015b`[\s\S]*`015` selects only `015`/],
  ["recurses through done and deferred", /recursively through the whole task subtree, including `done\/`, `deferred\/`, and future nested folders/],
  ["tags every path with raw input provenance", /attach every selecting raw input[\s\S]*\{ raw, kind \}/],
  ["classifies per full number", /Classify each matched \*\*full number\*\*, once across the entire subtree/],
  ["makes ambiguity precede folder status", /`ambiguous` takes precedence over folder classifications/],
  ["classifies glob matches individually", /Globs are never classified as a unit/],
  ["keeps number resolution in the task subtree", /Number inputs select only well-formed task specs in the resolved task subtree/],
  ["preserves external explicit path and glob matches", /Explicit paths and globs retain the consumer's existing reach[\s\S]*including one outside the resolved task subtree/],
  ["defines direct literal-path resolution", /invoked directly[\s\S]*resolve a literal path relative to the repository root/],
  ["defines direct glob resolution without shell evaluation", /expand shell-style glob metacharacters relative to that root without shell evaluation/],
  ["reports absent literals and unmatched globs", /absent literal or unmatched glob selects nothing/],
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
  check(`${skill} reconciles the packet with the raw pointer list`, /Reconcile the returned packet against the list you handed it[\s\S]*a pointer the packet accounts for nowhere is a resolution failure to report/.test(pluginPreflight));
  check(`${skill} keys policy from provenance`, /packet's `selectedBy` provenance/.test(pluginPreflight));
  check(`${skill} preserves explicit path and glob execution`, /explicit path or glob[\s\S]*`outside-subtree`/.test(pluginPreflight));
  check(`${skill} pins interactive as the available-session default`, /direct skill invocation defaults to interactive whenever the maintainer can answer in the current session/.test(pluginPreflight));
  check(`${skill} selects hands-off only explicitly or for a non-pausing runtime`, /hands-off only when the maintainer explicitly requests it or the invoking runtime cannot accept mid-run input/.test(pluginPreflight));
  check(`${skill} surfaces not-found for every input form`, /Unmatched number, path, or glob never executes[\s\S]*`not-found` diagnostic is always surfaced/i.test(pluginPreflight));
  check(`${skill} shows mappings for every invocation containing a number`, /show the resolved mapping whenever the invocation contains any number input/.test(pluginPreflight));
  check(`${skill} shows mappings for anomalies from every input form`, /show the mapping whenever any input form produces a non-`active` classification or `not-found` anomaly/.test(pluginPreflight));
  check(`${skill} requires per-number ambiguous selection`, /for each `ambiguous` number[\s\S]*select exactly one candidate or exclude that number/i.test(pluginPreflight));
  check(`${skill} never blanket-runs ambiguity`, /blanket continue must never (include|verify) every candidate/.test(pluginPreflight));
  check(`${skill} hands-off policy keeps active numbers and explicit inputs`, /hands-off run[\s\S]*(execute|verify) only the number-selected unambiguous `active` paths plus every explicit path\/glob selection/.test(pluginPreflight));
  check(`${skill} hands-off policy documents all exclusions`, /Exclude and document every number-selected[\s\S]*every `not-found` input; never guess an ambiguous number/.test(pluginPreflight));
  check(`${skill} does not restate resolver mechanics`, !/three digits|optional lowercase|Inventory well-formed|Parse each task filename/.test(pluginPreflight));
}

const reap = read("plugins", "dev-skills", "skills", "reap-tasks", "SKILL.md");
const reapPreflight = section(reap, "## Task-pointer preflight", "\n## ");
check("reap-tasks reads number-selected done as already reaped", /resolves only to `done` means already reaped: report it and never re-verify it, even after confirmation/.test(reapPreflight));
check("reap-tasks never offers to reverify number-selected done", /confirmation asks only whether to proceed with the remaining selected work; it must never offer to re-verify that done entry/.test(reapPreflight));
check("reap-tasks makes deferred eligibility confirmation-only", /number-selected unambiguous `deferred` path becomes eligible only after the maintainer explicitly includes it in an interactive run and is excluded hands-off/.test(reapPreflight));
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
  ["pins exact matched-number exclusion reasons", /exact reason \\`number-selected <classification> task is excluded in hands-off mode\\`/],
  ["pins exact not-found exclusion reasons", /exact reason \\`not-found input is excluded in hands-off mode\\`/],
  ["omits classification from not-found exclusions", /while omitting \\`number\\` and \\`classification\\`/],
  ["supports only an exactly accounted empty batch", /Return an empty \\`waves\\` array only when resolution leaves no executable task and the exact structured exclusions above account for every excluded input/],
  ["independently verifies the resolver hard list", /independently validates every wave path against the resolution hard list and re-derives both hands-off eligibility and exact exclusion accounting/],
  ["requires exact wave coverage", /Put every executable resolved path in exactly one wave, and put no excluded, unknown, or unrelated path in any wave/],
  ["requires structured resolution in the plan", /required: \["defaultBase", "resolution", "waves"\]/],
  ["returns resolution in the normal summary", /collisions, resolution: plan\.resolution, mainCheckout/],
];
for (const [name, pattern] of workflowClauses) check(`workflow ${name}`, pattern.test(workflow));

const exclusionsSchema = section(workflow, "        exclusions: {", "      required: [\"paths\", \"numbers\", \"notFound\", \"exclusions\"]");
check("workflow exclusion schema does not require classification", /required: \["raw", "kind", "paths", "reason"\]/.test(exclusionsSchema) && !/required: \[[^\]]*"classification"/.test(exclusionsSchema));
check("workflow not-found exclusions require an empty path list", /a \\`not-found\\` exclusion carries[\s\S]*\\`paths: \[\]\\`/.test(workflow));

const planValidationMatch = workflow.match(/function handsOffPathEligibility\(entry\) \{[\s\S]*?function emptyPlanIsExplained\(plan\) \{[\s\S]*?\n\}/);
check("workflow defines shared hands-off eligibility and exact plan validation gates", !!planValidationMatch);
if (planValidationMatch) {
  // eslint-disable-next-line no-new-func
  const validators = new Function(`${planValidationMatch[0]}; return { emptyPlanIsExplained, planResolutionIsExact, requiredArgPointers, resolutionAccountsForInputs };`)();
  const { emptyPlanIsExplained, planResolutionIsExact, requiredArgPointers, resolutionAccountsForInputs } = validators;
  const path = (classification, kinds, name = "tasks/001-example.md", raw = "001") => ({ path: name, number: "001", classification, selectedBy: kinds.map((kind) => ({ raw: kind === "number" ? raw : name, kind })) });
  const numberView = (classification, paths) => ({ number: "001", classification, paths });
  const numberExclusion = (classification, paths, raw = "001") => ({ raw, kind: "number", number: "001", classification, paths, reason: `number-selected ${classification} task is excluded in hands-off mode` });
  const missing = (raw = "999", kind = "number") => ({ raw, kind, diagnostic: `${raw} matched no task` });
  const missingExclusion = (raw = "999", kind = "number") => ({ raw, kind, paths: [], reason: "not-found input is excluded in hands-off mode" });
  const packet = ({ paths = [], numbers = [], notFound = [], exclusions = [], waves = [] } = {}) => ({ resolution: { paths, numbers, notFound, exclusions }, waves });

  const donePath = path("done", ["number"]);
  const doneNoOp = packet({ paths: [donePath], numbers: [numberView("done", [donePath.path])], exclusions: [numberExclusion("done", [donePath.path])] });
  check("valid excluded done number is a documented no-op", emptyPlanIsExplained(doneNoOp) === true);
  const ambiguousA = path("ambiguous", ["number"], "tasks/001-a.md");
  const ambiguousB = path("ambiguous", ["number"], "tasks/done/001-b.md");
  const ambiguousPaths = [ambiguousA.path, ambiguousB.path];
  check("valid excluded ambiguity is a documented no-op", emptyPlanIsExplained(packet({ paths: [ambiguousA, ambiguousB], numbers: [numberView("ambiguous", ambiguousPaths)], exclusions: [numberExclusion("ambiguous", ambiguousPaths)] })) === true);
  check("an ambiguous number cannot omit a candidate from the hard path list", emptyPlanIsExplained(packet({ paths: [ambiguousA], numbers: [numberView("ambiguous", ambiguousPaths)], exclusions: [numberExclusion("ambiguous", [ambiguousA.path])] })) === false);
  check("valid not-found-only resolution is a documented no-op", emptyPlanIsExplained(packet({ notFound: [missing()], exclusions: [missingExclusion()] })) === true);
  check("unrelated not-found cannot mask a done path missing its exclusion", emptyPlanIsExplained(packet({ paths: [donePath], numbers: [numberView("done", [donePath.path])], notFound: [missing()], exclusions: [missingExclusion()] })) === false);
  check("a missing matched-number exclusion fails closed", emptyPlanIsExplained(packet({ paths: [donePath], numbers: [numberView("done", [donePath.path])] })) === false);
  check("an orphan exclusion fails closed", emptyPlanIsExplained(packet({ paths: [donePath], numbers: [numberView("done", [donePath.path])], exclusions: [numberExclusion("done", [donePath.path]), missingExclusion("888")] })) === false);
  check("a mismatched exclusion classification fails closed", emptyPlanIsExplained(packet({ paths: [donePath], numbers: [numberView("done", [donePath.path])], exclusions: [numberExclusion("deferred", [donePath.path])] })) === false);
  check("a mismatched exclusion full number fails closed", emptyPlanIsExplained(packet({ paths: [donePath], numbers: [numberView("done", [donePath.path])], exclusions: [{ ...numberExclusion("done", [donePath.path]), number: "002" }] })) === false);
  check("a mismatched exclusion path set fails closed", emptyPlanIsExplained(packet({ paths: [donePath], numbers: [numberView("done", [donePath.path])], exclusions: [numberExclusion("done", ["tasks/002-other.md"])] })) === false);
  check("a duplicate exclusion fails closed", emptyPlanIsExplained(packet({ paths: [donePath], numbers: [numberView("done", [donePath.path])], exclusions: [numberExclusion("done", [donePath.path]), numberExclusion("done", [donePath.path])] })) === false);
  check("one raw input cannot be both selected and not-found under another kind", emptyPlanIsExplained(packet({ paths: [donePath], numbers: [numberView("done", [donePath.path])], notFound: [missing("001", "path")], exclusions: [numberExclusion("done", [donePath.path]), missingExclusion("001", "path")] })) === false);

  const active = path("active", ["number"]);
  const activePacket = (waves) => packet({ paths: [active], numbers: [numberView("active", [active.path])], waves });
  check("valid nonempty plan covers its executable hard path", planResolutionIsExact(activePacket([[{ path: active.path, dependsOn: [] }]])) === true);
  check("nonempty plan cannot omit an executable hard path", planResolutionIsExact(activePacket([])) === false);
  check("nonempty plan cannot include an excluded hard path", planResolutionIsExact({ ...doneNoOp, waves: [[{ path: donePath.path, dependsOn: [] }]] }) === false);
  check("nonempty plan cannot duplicate an executable hard path", planResolutionIsExact(activePacket([[{ path: active.path, dependsOn: [] }], [{ path: active.path, dependsOn: [] }]])) === false);
  check("nonempty plan cannot include an unknown path", planResolutionIsExact(activePacket([[{ path: "tasks/999-unknown.md", dependsOn: [] }]])) === false);
  check("wave validation preserves dependency metadata", planResolutionIsExact(activePacket([[{ path: active.path, dependsOn: ["upstream"] }]])) === true);

  const mixed = path("done", ["number", "path"]);
  check("explicit provenance wins while the number selection remains accounted", planResolutionIsExact(packet({ paths: [mixed], numbers: [numberView("done", [mixed.path])], exclusions: [numberExclusion("done", [mixed.path])], waves: [[{ path: mixed.path, dependsOn: [] }]] })) === true);
  const outside = path("outside-subtree", ["glob"], "plans/A-01-example.md");
  check("an explicit outside-subtree task is executable", planResolutionIsExact(packet({ paths: [outside], waves: [[{ path: outside.path, dependsOn: [] }]] })) === true);
  // Well-formed on purpose: without the `numbers` entry this inside-subtree
  // path makes the packet malformed, and the assertion below would pass on
  // that branch instead of the wave-coverage one it exists to exercise.
  check("not-found cannot mask an active explicit path omitted from waves", emptyPlanIsExplained(packet({ paths: [path("active", ["path"])], numbers: [numberView("active", ["tasks/001-example.md"])], notFound: [missing("tasks/missing-*.md", "glob")], exclusions: [missingExclusion("tasks/missing-*.md", "glob")] })) === false);
  check("unknown path provenance fails closed", emptyPlanIsExplained(packet({ paths: [path("done", ["mystery"])], exclusions: [numberExclusion("done", [donePath.path])] })) === false);
  check("empty workflow plan without diagnostics is unexplained", emptyPlanIsExplained(packet()) === false);
  check("empty workflow plan without a resolution packet is unexplained", emptyPlanIsExplained({ waves: [] }) === false);

  const same = (actual, expected) => Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
  check("argument pointers keep first-seen order and deduplicate", same(requiredArgPointers("039 041 039"), ["039", "041"]));
  check("argument pointers split commas as well as whitespace", same(requiredArgPointers("039,041 tasks/050-x.md"), ["039", "041", "tasks/050-x.md"]));
  check("argument pointers drop flag-shaped tokens", same(requiredArgPointers("039 peer-opinions=off"), ["039"]));
  check("argument pointers of an empty argument are empty", same(requiredArgPointers(""), []) && same(requiredArgPointers(null), []));

  const twoInputs = [
    { path: "tasks/039-a.md", number: "039", classification: "active", selectedBy: [{ raw: "039", kind: "number" }] },
    { path: "tasks/041-b.md", number: "041", classification: "active", selectedBy: [{ raw: "041", kind: "number" }] },
  ];
  const covering = { paths: twoInputs, numbers: [], notFound: [], exclusions: [] };
  check("a packet covering every argument pointer is accepted", resolutionAccountsForInputs(covering, ["039", "041"]) === true);
  check("a silently dropped argument pointer fails closed", resolutionAccountsForInputs({ ...covering, paths: [twoInputs[0]] }, ["039", "041"]) === false);
  check("a not-found diagnostic accounts for its argument pointer", resolutionAccountsForInputs({ ...covering, paths: [twoInputs[0]], notFound: [missing("041")] }, ["039", "041"]) === true);
  check("a packet raw the argument never named fails closed", resolutionAccountsForInputs(covering, ["039"]) === false);
  check("a packet without the resolver collections fails closed", resolutionAccountsForInputs({ paths: twoInputs }, ["039", "041"]) === false && resolutionAccountsForInputs(null, []) === false);
}
check("workflow reconciles the resolver packet with the raw argument before dispatch", /if \(!resolutionAccountsForInputs\(plan\.resolution, requiredArgPointers\(flattenBatchArgs\(args\)\)\)\)[\s\S]*error: "Could not resolve task pointers from the argument\."/.test(workflow));
check("workflow tells the resolver its packet is reconciled with the argument", /re-derives the raw pointer list from the argument itself and requires your packet to account for every deduplicated pointer/.test(workflow));
check("workflow validates every plan before dispatch", /if \(!planResolutionIsExact\(plan\)\)[\s\S]*error: "Could not resolve task pointers from the argument\."/.test(workflow));
check("workflow retains resolution on malformed plan errors", /!plan \|\| !Array\.isArray\(plan\.waves\)[\s\S]*resolution: plan && plan\.resolution \? plan\.resolution : null/.test(workflow));
check("workflow retains resolution on inconsistent plan errors", /!planResolutionIsExact\(plan\)[\s\S]*resolution: plan\.resolution/.test(workflow));
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
