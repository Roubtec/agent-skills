#!/usr/bin/env node
// Renders EVERY prompt a dynamic workflow hands to a spawned subagent and
// asserts two rules are in the rendered text: the destroy boundary, and — where
// the brief orders a build or validation — a destination for output redirected
// to a file. It also deletion-guards the same destination rule where it lives in
// prose the workflows do not render, the `SKILL.md` briefs of both skill
// mirrors. The file name names the first of those jobs, which is the one it
// shipped with; task 045 widened the remit to the other two.
//
// Why rendering rather than reading: the boundary lives in shared constants and
// in a section one workflow embeds byte-for-byte from another, so the source
// reads as covered long before every prompt actually carries it. Three review
// rounds of task 017 each eyeballed the sources and each missed a path. A
// rendered string cannot be argued with.
//
// Two separable jobs for the BOUNDARY, because in a workflow it is a CONSTANT
// and every use of it is a bare `${CONSTANT}` interpolation:
//
//   PRESENCE, checked per rendered prompt, by exact string containment. Each
//   brief must carry one of the boundary constants DECLARED IN ITS OWN FILE,
//   verbatim. Nothing is re-derived from prose, so a prompt cannot pass with a
//   partial or hand-edited copy that happens to satisfy a set of phrase
//   regexes.
//
//   CONTENT, checked per boundary constant, against the clause list below.
//   Task 017's criterion is about what the constants SAY, and they say it once
//   each; asserting eleven clauses against all sixty renders re-derived the
//   same five answers sixty times over. The constants are evaluated out of the
//   same declaration prefix the builders come from, so this is the value the
//   briefs actually interpolate rather than the source text of the literal.
//
// A THIRD job, task 045's, over the same renders: THE OUTPUT DESTINATION. Task
// 017 put a sentence naming where redirected build output goes into every brief
// that orders a build or validation, and nothing asserted it — which is the
// class every one of that task's four missed rounds fell into. It cannot be
// checked the way the boundary is, and the fork is worth stating here rather
// than leaving to be inferred from the code:
//
//   The destination is NOT one constant. `CYCLE_REDIRECTED_OUTPUT` covers the
//   `review-cycle-core` briefs; the artifact-directory-less re-review, the
//   collision resolution and the delegated rebase each carry their own wording,
//   deliberately, because the safe destination differs by whether the role
//   commits from the tree it would write into. Collapsing them into one
//   constant would flatten that distinction, so this check does not ask for one.
//
//   So something must decide WHICH renders have to carry a destination at all,
//   and the two obvious answers are both broken. Deriving "orders a build" from
//   the rendered prose is what the PRESENCE rule above refuses to do for the
//   boundary, and for the same reason: a vocabulary of build-ordering phrases
//   silently drops every brief phrased outside it, and would have to parse
//   negation besides — `cyclePeerPrompt` says "run no builds or tests".
//   Listing the build-ordering builders instead reintroduces exactly the
//   failure mode task 045 exists to close: a new builder absent from the list
//   is missed in silence.
//
//   What this suite does instead is what it already does for call sites and
//   fixtures — ACCOUNTING, not searching. The verdict is TOTAL over the
//   DISCOVERED render set and FAIL-CLOSED: every fixture case carries a third
//   element saying whether that render orders a build (`NO_BUILD`, or a
//   destination spec), and a case carrying none FAILS as unclassified. A list
//   missing an entry passes; a total map missing an entry cannot, and the set
//   it must be total over is discovered from the sources rather than written
//   down. A new builder therefore fails twice: once for having no fixture, and
//   again for having no verdict once given one. The verdict is per RENDER
//   rather than per builder because both the answer and the wording can differ
//   between branches of one builder — `cycleReviewPrompt` names a different
//   destination when it is handed no artifact directory, and `rebasePrompt`
//   names a different temp directory per rebase point.
//
// What the verdict does NOT catch, plainly: being WRONG. A brief that grows a
// build order while its case still says `NO_BUILD` passes, because the verdict
// is a claim in the source and not a derivation from the prose. That claim is
// at least visible and reviewable where a silent omission was not, and one
// direction of it is cross-checked mechanically: a `NO_BUILD` render must carry
// no destination clause this suite knows, so a build order added together with
// its destination but without the verdict flip fails, as does a destination
// clause left behind after its build order was removed. The dangerous
// direction — a build order added with NO destination — is what the verdict
// alone answers for. The rendering gaps stated below still apply unchanged: a
// new branch inside an existing builder is unrendered until its fixtures widen,
// verdict or no verdict.
//
// PRESENCE of a destination is exact containment, as for the boundary, in
// whichever of two shapes the site has. Where the clause IS a constant, the
// case names it and the check contains that constant's EVALUATED value out of
// the declaration prefix — the `DESTROY_BOUNDARY` mould, and the third shape
// task 045 offered, honored exactly where the shape already exists. Where the
// clause is bespoke per site, the case pins it as verbatim spans, split around
// whatever the render interpolates (a slug, a rebase point). A pin is not a
// phrase regex: it is the prose itself, byte for byte, and it spans the
// POSITIVE destination rather than only the "never a fixed shared scratchpad
// name" prohibition — so a clause gutted to its keywords with the instruction
// destroyed fails it. CONTENT is checked once per destination constant besides,
// for the boundary's reason: exact containment of a constant says nothing about
// what the constant says. A file declaring no destination constant is fine,
// unlike the boundary, because its clauses are inline by design.
//
// And a FOURTH job, over files this suite renders nothing from: 017's
// destination clauses also ship in the `SKILL.md` briefs of BOTH skill mirrors,
// where the file text IS the brief and there is no builder. That half is
// therefore a DELETION GUARD — a verbatim anchor of every shipped clause must
// stay present, in both mirrors — plus a CENSUS: every `SKILL.md` in either
// mirror is scanned for the shared-scratchpad warning and its count must equal
// the anchors declared for it, so a clause that arrives, or leaves, fails until
// the table below is brought up to date.
//
// The ASYMMETRY that leaves is the point, and must not be read as parity with
// the rendered checks. Call-site accounting discovers a new BUILDER because a
// call is syntax, whatever its prompt says. Nothing here discovers a new prose
// brief: a `SKILL.md` section that orders a build and names no destination —
// 017's actual failure mode — carries no warning phrase for the census to count
// and no anchor to go missing, and passes green. Prose briefs are guarded
// against deletion; they are not discovered.
//
// A workflow is a runtime script, not a module: it opens with `export const
// meta` and ends in top-level `await agent(...)`. So this suite evaluates the
// DECLARATION PREFIX of each shipped file — everything up to the documented cut
// marker below, which is the file's first executable statement — inside a
// `new Function` wrapper, and calls the prompt builders out of it. That is the
// same technique `test-checkout-cleanliness-report.mjs` uses on a single
// function, widened to the whole prefix so each builder gets the helpers it
// calls (`shq`, the `cycle*` contract and block builders) for free; extracted
// alone they raise a ReferenceError instead of rendering. "Each shipped file"
// is literal rather than aspirational: the cut markers are a hand-maintained
// map, so the set of `wf-*.js` on disk is asserted to equal its keys before
// anything is evaluated — see CUT below.
//
// The set of prompt builders is DISCOVERED from the `agent(<fn>(...))` call
// sites in each source, not listed here, so a prompt path added later fails
// this suite until it is given a fixture — the failure mode the enumeration in
// task 017 kept hitting. Discovery recognizes one call shape, whitespace before
// the paren included — `agent (fn(...))` matched neither pattern until this was
// widened, so it was neither rendered nor reported and vanished from the audit
// entirely. What the suite guarantees otherwise rests on ACCOUNTING rather than
// on searching: every LITERAL `agent(` occurrence in the source must be either a
// matched call site or a prose mention on a comment line, and anything else
// fails the suite. A later unspaced `agent(p, ...)` over a variable, or an
// inline template literal, is therefore loud rather than silently unrendered;
// the spaced form is the second gap below. The accounting pattern stays literal
// where discovery does not, deliberately:
// prompt templates here write English `agent (...)` — `wf-address-review.js`'s
// ping step says so of Copilot's coding agent — which is prose rather than an
// unrecognized call, so counting it would fail the suite on the shipped
// sources. The comment exclusion is reported with its line numbers on every run
// rather than applied quietly.
//
// Two gaps that accounting cannot close, stated plainly rather than implied
// away. A NEW BRANCH INSIDE AN EXISTING BUILDER: rendering is fixture-driven,
// so a builder this suite already renders can grow a conditional whose other
// arm no fixture supplies, and its call site still looks accounted for. That is
// inherent to rendering rather than an oversight — widen the fixtures for the
// builder when it gains a branch, as `prPrompt` and `mainCheckoutStatusPrompt`
// already do below. And a SPACED CALL OVER A VARIABLE, `agent (p, ...)`: it
// names no builder for discovery to render, and the literal accounting pattern
// skips it over the space, so it passes silently where the unspaced form is
// loud. Left open deliberately — it takes both deviations at once, no such call
// exists in these sources, and letting accounting match the space would fail
// the shipped tree on the English `agent (...)` in `wf-address-review.js`'s
// ping step, which lives in a template literal rather than on a comment line.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workflows = join(root, "plugins/dev-skills/workflows");

// The first executable statement of each shipped workflow. Everything before it
// is declarations (plus `export const meta`, neutralized below). Kept as exact
// strings rather than line numbers so an edit above them cannot silently shift
// the cut; a marker that stops matching fails the suite loudly.
const CUT = {
  "wf-review-cycle.js": "\nconst structured = args &&",
  "wf-address-tasks.js": "\nconst peerMode = /",
  "wf-address-review.js": "\nconst raw = flattenArgs(args);",
};

// CUT drives the whole run, so a `wf-*.js` this map does not name would be
// evaluated by nothing and the suite would still report "0 failing" — a new
// workflow whose only prompt carried no boundary would ship green. So the
// SHIPPED SET is read off the directory and required to equal CUT's keys, in
// both directions: an unlisted file fails until it is given a cut marker
// (exactly as a new builder fails until it is given a fixture), and a key
// naming a file that no longer exists stops the run right there, naming the
// key, rather than being skipped or reaching the render loop. This is what
// lets the claim "each shipped file" be made literally.
function shippedWorkflows() {
  return readdirSync(workflows)
    .filter((f) => /^wf-.*\.js$/.test(f))
    .sort();
}

// What every boundary CONSTANT must say. Task 017's criterion is that each site
// states the PERMITTED-versus-FORBIDDEN boundary, so the permitted half is
// asserted too: a constant that lost its Permitted line would otherwise still
// pass. Each entry is one semantic clause the boundary states, matched by the
// phrase that carries it rather than by a byte comparison of the whole
// constant. This must fail when a clause is LOST. What that buys is narrow, and
// measured rather than hoped for: the phrases now pin just over two thirds of
// each constant in contiguous literal runs, so it is the unpinned remainder —
// the mechanics, the reasons, the tails — that may be reworded freely, and the
// pinned spans that may not. Inside a pinned span even an obviously benign edit
// fails: dropping an Oxford comma does, lowercasing `NOT in a clone` does, and
// so does ADDING a command to the forbidden list, i.e. hardening the boundary
// breaks this suite. That is the deal these patterns make, and it is why
// tightening them further has a real cost. Say this rather than "a rewording is
// not a failure", which is broader than any of them delivers.
//
// Each phrase spans the words that make its clause OPERATIVE — its polarity,
// its qualifier, its enumeration — and never merely a tail that an INVERTED or
// NARROWED boundary satisfies just as well, WITH TWO DELIBERATE EXCEPTIONS
// named below. That rule is written down because every phrase which broke it
// was measured green against a boundary saying something else: a wildcard
// spanning the directive's verb passed "never belongs ONLY in a disposable
// clone"; a wildcard spanning that directive's qualifier instead passed both
// "that cannot change state" and "that must change state", the second narrowing
// the rule until ordinary state-changing verification escapes it; a bare `and
// force-pushing` passed the same command list under an "Also permitted:" label;
// a phrase starting on the blast-radius clause's verb passed "so nothing you do
// can reach every sibling worktree" and a halved enumeration; a carve-out
// matched from "whether as an exact command" passed a boundary with the scope it
// bounds — "beyond what this assignment itself spells out" — deleted outright;
// and the fallback phrase, holding no wildcard at all but starting one word past
// its directive's verb, passed both "NEVER use an absolute path outside the
// repository" and "you may ignore the rule that you use an absolute path outside
// the repository" — a boundary that has kept "clone-only" while naming no
// destination to fall back to, which is the live checkout again. So these
// phrases run long, and none of them holds a wildcard any more: every matched
// span is contiguous literal text, and the one place two shipped spellings
// differ inside a span is enumerated ("and", which only the section's copy has)
// rather than skipped over.
//
// THE TWO EXCEPTIONS, stated here rather than left to be rediscovered as a bug.
// A rule with unrecorded exceptions is worse than a bounded one: a reader who
// takes the rule at face value trusts these two entries for something they do
// not do, and each round that rediscovers one spends itself re-measuring what
// was already known. Both are measured green against boundaries saying
// something else, and both are kept anyway, for the reason given:
//
//   "disposable-clone destination" is a bare existence check on `command -v
//   dc-enter` — no polarity, no qualifier. Inverting the sentence around it
//   ("Do NOT run `command -v dc-enter`; where it is found, avoid ...") is
//   green, and so is replacing the whole `dc-enter` calling convention — the
//   `DC="$(dc-enter <slug>)"` form, `dc-remove`, the reused-slug refusal — with
//   "Run `command -v dc-enter` if you like." Kept bare because those mechanics
//   are a helper's usage text rather than clause material: pinning them would
//   put `dc-enter`'s calling convention under this suite, where every future
//   change to the helper breaks a destroy-boundary test. What must survive is
//   pinned in full by the clauses either side — verification belongs ONLY in a
//   disposable clone, and, where the helper is absent, the fallback is an
//   absolute path outside the repository — and both hold whatever the helper's
//   usage text says. "In full" is the load-bearing word and the neighbouring
//   phrases are what have to deliver it, which is why the fallback's phrase
//   spans its condition and verb rather than starting at the destination: the
//   shorter span is green against a fallback that FORBIDS or WAIVES the
//   absolute path, and this exception's whole safety rests on it. This entry
//   asserts only that a destination is named at all.
//
//   "permitted set" stops after `queries` and leaves the permitted half's SCOPE
//   tail unpinned, so WIDENING that tail is green: "— plus edits, commits, and
//   pushes anywhere in the repository." in the section copy, "and any mutation
//   you judge necessary." in the out-of-section one. This one is a residual
//   rather than a design choice, and pinning it is what was rejected: the two
//   shipped copies spell the tail differently ("plus, where the contract above
//   authorizes it, edits, commits, and pushes confined to the worktree and
//   branch it names" versus "and the specific mutations this assignment spells
//   out"), so no single literal span covers both and a pattern would need an
//   alternation — an added case, against this repository's bias toward deleting
//   them, and paid for out of a tolerance already spent down to under a third.
//   So the entry keeps the job it was added for, which is narrower than the
//   rule above: it fails when the Permitted line is LOST, not when it is
//   widened. The forbidden half is the half that binds, and it is pinned
//   through its enumeration, its carve-out, and its no-exemptions clause.
//
// The addressing clause is the longest of them for a further reason: it states
// three things at once — the positive form, the glob ban, and the unchecked-`cd`
// ban — so a copy keeping only the first would read as compliant while dropping
// the two prohibitions the incident it exists for actually turned on.
const REQUIRED = [
  // A deliberate exception (see above): pinned only through `queries`. Fails on
  // a LOST Permitted line, not on a widened one.
  ["permitted set", /Permitted: reading, searching, (?:and )?read-only `git`\/`gh` queries/],
  ["forbidden set", /Forbidden: `rm -rf`, `git reset --hard`, `git clean`, `git branch -f`, `git update-ref`, `git gc`, and force-pushing/],
  ["exact-command / named-skill carve-out", /each of them beyond what this assignment itself spells out, whether as an exact command or as a skill it names to invoke/],
  ['"not in a clone" qualifier', /NOT in a clone, NOT in a temp directory, NOT "safely"/],
  ["exemptions are granted, not self-selected", /You may not self-authorize one by putting yourself somewhere you believe is safe; what this assignment spells out, and the disposable clone below, are the only exemptions — and only because this assignment names them/],
  ["worktree is not a blast radius", /A worktree is not a blast radius/],
  ["shared `.git` reaches every sibling worktree", /so `branch -f`, `reset`, `update-ref`, and `gc` reach every sibling worktree through the shared `\.git`/],
  ["a repository is addressed by path", /Address any repository other than your own checkout BY PATH: `git -C <absolute path>`\. NEVER derive a working directory from a glob, and NEVER chain a state-changing git command after a `cd` whose success you have not checked/],
  ["empirical verification is clone-only", /Empirical verification that could change state belongs ONLY in a disposable clone/],
  // A deliberate exception (see above): a bare existence check, deliberately.
  // Asserts that a destination is named, not what the surrounding sentence says
  // of it.
  ["disposable-clone destination", /command -v dc-enter/],
  ["absolute-path fallback", /Where the helper is absent, use an absolute path outside the repository — never a relative one/],
];

// What a destination CONSTANT must say, on REQUIRED's terms and for its reason:
// a brief carrying the constant verbatim proves the text was interpolated, not
// that the text still instructs anything, so the gutting this closes is the one
// that keeps the vocabulary and destroys the instruction. Keyed by constant
// name rather than by file, since the two copies of this one are a single
// declaration mirrored into the embedded section. A destination constant this
// map does not name FAILS, exactly as an unlisted workflow or an unfixtured
// builder does: the alternative is a new constant whose content nothing checks.
const DESTINATION_CLAUSES = {
  CYCLE_REDIRECTED_OUTPUT: [
    ["governs output redirected to a file", /build or validation output you redirect to a file/],
    ["names the round directory as the destination", /goes under that same round directory/],
    ["forbids a fixed shared scratchpad name", /never a fixed shared scratchpad name/],
  ],
};

// Every `agent(<fn>(...))` in the file — the complete set of prompt paths — plus
// an accounting of every OTHER literal `agent(` occurrence, so an unrecognized
// call shape reads as a failure rather than as an absence of call sites. Comment
// lines are the one excluded kind (these sources discuss `agent()` in prose),
// and the caller reports that exclusion with its lines rather than dropping it
// silently.
function promptBuilders(src) {
  const lines = src.split("\n");
  const sites = new Set();
  const found = new Set();
  for (const m of src.matchAll(/\bagent\s*\(\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
    found.add(m[1]);
    sites.add(m.index);
  }
  const prose = [];
  const unaccounted = [];
  for (const m of src.matchAll(/\bagent\(/g)) {
    if (sites.has(m.index)) continue;
    const line = src.slice(0, m.index).split("\n").length;
    (/^\s*(?:\/\/|\*|\/\*)/.test(lines[line - 1]) ? prose : unaccounted).push(line);
  }
  return { names: [...found].sort(), sites: sites.size, prose, unaccounted };
}

// Every top-level boundary constant the file declares — `DESTROY_BOUNDARY` for
// a workflow's own briefs, `CYCLE_DESTROY_BOUNDARY` for the review-cycle-core
// section's four roles. Discovered rather than listed, so a third one added
// later is content-checked and becomes an accepted presence value on its own.
// A file that declares none fails: nothing it renders could then carry one.
function boundaryNames(src) {
  return [...src.matchAll(/^const (\w*DESTROY_BOUNDARY) = `/gm)].map((m) => m[1]);
}

// The same discovery for the output-destination constants — today one per file
// in the two workflows that carry the `review-cycle-core` section, and none in
// `wf-address-review.js`, whose destination clauses are all inline. Declaring
// none is therefore NOT a failure here, which is the one place this check parts
// from `boundaryNames` above: every workflow must carry a boundary, while a
// workflow's destinations may legitimately all be per-site prose.
function destinationNames(src) {
  return [...src.matchAll(/^const (\w*REDIRECTED_OUTPUT) = ["`]/gm)].map((m) => m[1]);
}

function load(file) {
  const src = readFileSync(join(workflows, file), "utf8");
  const marker = CUT[file];
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`${file}: cut marker not found: ${JSON.stringify(marker)}`);
  const prefix = src.slice(0, at).replace(/^export const meta/m, "const meta");
  // A top-level statement starts at column 0 in these sources; an indented
  // `await` belongs to an async function declaration and never runs here. A
  // top-level one would mean the cut marker sits past the first executable
  // statement, so the prefix is no longer declarations-only.
  if (/^(?:(?:const|let|var)\b[^\n=]*=\s*)?await\b/m.test(prefix)) {
    throw new Error(`${file}: declaration prefix reaches a top-level await; the cut marker is too late`);
  }
  const { names, ...accounting } = promptBuilders(src);
  const bNames = boundaryNames(src);
  const dNames = destinationNames(src);
  if (!bNames.length) throw new Error(`${file}: declares no top-level *DESTROY_BOUNDARY constant`);
  // `args` is the workflow's own injected parameter; a few late declarations in
  // the prefix read it. An empty string keeps them inert. Each requested name is
  // returned by an explicit reference, so a builder — or a boundary constant —
  // that is not declared in the prefix is a ReferenceError here rather than a
  // silent skip. The constants come back EVALUATED, which is exactly what the
  // briefs interpolate; the source-text identity check further down is a
  // separate question and reads the literal instead.
  const wanted = [...names, ...bNames, ...dNames];
  const body = `"use strict";\n${prefix}\nreturn { ${wanted.map((n) => `${n}: ${n}`).join(", ")} };`;
  const out = new Function("args", body)("");
  const fns = Object.fromEntries(names.map((n) => [n, out[n]]));
  const boundaries = bNames.map((n) => [n, out[n]]);
  const destinations = new Map(dNames.map((n) => [n, out[n]]));
  return { src, names, fns, boundaries, destinations, accounting };
}

// --- Output-destination verdicts ------------------------------------------
// One of these is the THIRD element of every fixture case below, and a case
// carrying none fails as unclassified. `NO_BUILD` says the render orders no
// build or validation; the others say it does, and say where its redirected
// output goes — either the destination CONSTANT the brief interpolates, checked
// by exact containment of that constant's evaluated value, or verbatim PINS of a
// bespoke per-site clause, checked the same way and split around whatever the
// render interpolates through the middle of it. The header states why the
// verdict is declared rather than derived from the prose, and what that leaves
// uncaught.

const NO_BUILD = { orders: false };
const destinationConstant = (constant) => ({ orders: true, constant });
const destinationPins = (...pins) => ({ orders: true, pins });

// A cycle round writes under the round directory the same brief already told it
// to report back.
const ROUND_DIRECTORY = destinationConstant("CYCLE_REDIRECTED_OUTPUT");

// A reviewer handed NO artifact directory — the collision re-review, which runs
// outside any cycle — makes its own instead. Two pins: the render interpolates
// the task slug into the `mktemp` example between them.
const REREVIEW_TEMP_DIRECTORY = destinationPins(
  "If any build or validation output must land in a file, create a UNIQUE directory for it first — outside the worktree, e.g. `mktemp -d ",
  "(never a fixed shared name: concurrent reviewers share one scratch directory) — and write inside it.",
);

// The collision resolver commits from the worktree it validates, so this one
// sends output outside EVERY worktree rather than inside its own — the per-role
// difference that keeps these clauses from collapsing into one constant.
const COLLISION_TEMP_DIRECTORY = destinationPins(
  'if you redirect its output to a file, create a UNIQUE directory for that first, OUTSIDE every worktree (`mktemp -d "${TMPDIR:-/tmp}/collision-resolve.XXXXXX"`), and write there — never a fixed shared scratchpad name',
  "and never inside the worktree, which you are about to commit.",
);

// The delegated rebase validates the checkout it stands in, and puts the run's
// point in the directory name so its two points cannot collide with each other.
// Hence a verdict per point rather than per builder.
const rebaseTempDirectory = (point) =>
  destinationPins(
    `If you redirect any build output to a file, create a UNIQUE directory for it first, OUTSIDE the checkout (\`mktemp -d "\${TMPDIR:-/tmp}/rebase-${point}.XXXXXX"\`) — never a fixed shared scratchpad name`,
  );

// --- Fixtures -------------------------------------------------------------
// One entry per rendered path: label, render, and output-destination verdict. A
// discovered builder with no fixture is a failure, not a skip; so is a fixture
// case with no verdict.

const task = {
  slug: "042-widget",
  branch: "task/042-widget",
  base: "main",
  path: "tasks/042-widget.md",
  content: "# 042 — Widget\n",
};

const cycleBase = {
  slug: "042-widget",
  branch: "task/042-widget",
  base: "main",
  worktree: "/w/.worktrees/c/042-widget",
  artifactType: "code",
  scope: { instructions: "Implement the task.", items: [{ id: "i1", text: "do the thing" }] },
};
// The two configurations that take different branches through cycleContract():
// a standalone run with no per-role overrides, and a batch consumer that
// overrides ALL FOUR roles (wf-address-tasks does exactly this). Every role the
// section can ask a contract for is listed, `measurer` included: with one
// missing, its brief renders the DEFAULT contract under both configurations and
// the pair is one text rendered twice rather than the two branches this pair
// exists to cover.
const cycleStandalone = { ...cycleBase, contracts: undefined };
const cycleOverridden = {
  ...cycleBase,
  contracts: {
    fixer: "## WORKTREE CONTRACT\n(consumer-supplied fixer contract)",
    reviewer: "## WORKTREE CONTRACT\n(consumer-supplied reviewer contract)",
    peer: "## WORKTREE CONTRACT\n(consumer-supplied peer contract)",
    measurer: "## WORKTREE CONTRACT\n(consumer-supplied measurer contract)",
  },
};
const fixState = { round: 2, findings: { reviewer: [{ id: "f1", text: "x" }] }, confirming: false, artifactDir: "/tmp/a", openQuestions: [] };
const reviewState = { round: 2, packet: { dispositions: [] }, artifactDir: "/tmp/a" };
const peerState = { round: 2, packet: { dispositions: [] } };
// The states above all carry an artifact directory, which the fixer and
// reviewer briefs branch on — and both take the empty branch in a real run:
// round 1 has not created the directory yet, and wf-address-tasks's collision
// re-review calls the reviewer builder outside any cycle with `artifactDir: ""`.
// That is the "new branch inside an existing builder" gap the header names, so
// each is rendered rather than argued to be the same text.
const closeOutState = { passBase: "abc1234", edits: ["typo in a comment"], fixes: [{ finding: "the comment misspells the field name", detail: "reworded it" }] };
// The record-only check is handed a range and nothing else — deliberately no
// list of what the pass says is in it (see the builder), so this state is the
// whole input.
const recordOnlyState = { passBase: "abc1234" };
// The packet measurement is handed the pass ORDINAL and nothing else, for the
// record-only check's reason carried one step further: it is told nothing about
// the pass whose worktree it measures, because the pass's `clean` self-report
// is the very claim it exists to check independently.
const packetCheckState = { pass: 2 };
const fixStateRound1 = { ...fixState, round: 1, findings: null, artifactDir: "" };
const reviewStateNoArtifact = { ...reviewState, round: 1, artifactDir: "" };

// Locked-decision deviations reach two delivery builders — `prPrompt` and
// `publishPrompt` — and each branches twice over them: standing deviations with
// the reviewing round's assessments, and standing deviations the cycle recorded
// none for. Four arms, so four renders; the same "new branch inside an existing
// builder" gap, closed the same way.
const deviations = ["Delivered a polling loop instead of the locked webhook: the webhook endpoint is not reachable from CI."];
const deviationAssessments = [
  { deviation: deviations[0], inSpecRoute: "None — the locked route needs an endpoint this environment cannot expose.", recommendation: "RATIFY — conforming would block the release on an infrastructure change." },
];
const publishPacket = { pr: { number: 42, url: "https://example.invalid/pr/42", branch: "b", workingBranch: "b", base: "main", headOid: "deadbeef", rebased: false }, items: [] };
const publishPacketWorktree = { ...publishPacket, pr: { ...publishPacket.pr, locationMode: "worktree", worktree: "/w/.worktrees/c/pr-42" } };

// The cycle briefs, each rendered under BOTH configurations, because
// cycleContract() branches on whether the consumer overrode the role.
const cycleCases = {
  cycleFixPrompt: [
    ["cycleFixPrompt (standalone)", (f) => f.cycleFixPrompt(cycleStandalone, fixState), ROUND_DIRECTORY],
    ["cycleFixPrompt (batch/overridden)", (f) => f.cycleFixPrompt(cycleOverridden, fixState), ROUND_DIRECTORY],
    ["cycleFixPrompt (round 1, no artifact directory yet)", (f) => f.cycleFixPrompt(cycleOverridden, fixStateRound1), ROUND_DIRECTORY],
  ],
  cycleReviewPrompt: [
    ["cycleReviewPrompt (standalone)", (f) => f.cycleReviewPrompt(cycleStandalone, reviewState), ROUND_DIRECTORY],
    ["cycleReviewPrompt (batch/overridden)", (f) => f.cycleReviewPrompt(cycleOverridden, reviewState), ROUND_DIRECTORY],
    ["cycleReviewPrompt (no artifact directory — collision re-review)", (f) => f.cycleReviewPrompt(cycleOverridden, reviewStateNoArtifact), REREVIEW_TEMP_DIRECTORY],
  ],
  cyclePeerPrompt: [
    ["cyclePeerPrompt (standalone)", (f) => f.cyclePeerPrompt(cycleStandalone, peerState), NO_BUILD],
    ["cyclePeerPrompt (batch/overridden)", (f) => f.cyclePeerPrompt(cycleOverridden, peerState), NO_BUILD],
  ],
  cycleGroundingPrompt: [
    ["cycleGroundingPrompt (standalone)", (f) => f.cycleGroundingPrompt(cycleStandalone, [{ id: "p1", text: "y", severity: "minor" }]), NO_BUILD],
    ["cycleGroundingPrompt (batch/overridden)", (f) => f.cycleGroundingPrompt(cycleOverridden, [{ id: "p1", text: "y", severity: "minor" }]), NO_BUILD],
  ],
  cycleCloseOutPrompt: [
    ["cycleCloseOutPrompt (standalone)", (f) => f.cycleCloseOutPrompt(cycleStandalone, closeOutState), NO_BUILD],
    ["cycleCloseOutPrompt (batch/overridden)", (f) => f.cycleCloseOutPrompt(cycleOverridden, closeOutState), NO_BUILD],
  ],
  cycleRecordOnlyPrompt: [
    ["cycleRecordOnlyPrompt (standalone)", (f) => f.cycleRecordOnlyPrompt(cycleStandalone, recordOnlyState), NO_BUILD],
    ["cycleRecordOnlyPrompt (batch/overridden)", (f) => f.cycleRecordOnlyPrompt(cycleOverridden, recordOnlyState), NO_BUILD],
  ],
  cyclePacketCheckPrompt: [
    ["cyclePacketCheckPrompt (standalone)", (f) => f.cyclePacketCheckPrompt(cycleStandalone, packetCheckState), NO_BUILD],
    ["cyclePacketCheckPrompt (batch/overridden)", (f) => f.cyclePacketCheckPrompt(cycleOverridden, packetCheckState), NO_BUILD],
  ],
};

const FIXTURES = {
  "wf-review-cycle.js": {
    ...cycleCases,
    scopePrompt: [["scopePrompt", (f) => f.scopePrompt("review the current change"), NO_BUILD]],
  },
  "wf-address-tasks.js": {
    ...cycleCases,
    bootstrapPrompt: [["bootstrapPrompt", (f) => f.bootstrapPrompt(), NO_BUILD]],
    storageProbePrompt: [["storageProbePrompt", (f) => f.storageProbePrompt(".worktrees"), NO_BUILD]],
    mainCheckoutStatusPrompt: [
      ["mainCheckoutStatusPrompt (baseline)", (f) => f.mainCheckoutStatusPrompt("pre-batch baseline"), NO_BUILD],
      ["mainCheckoutStatusPrompt (post-batch)", (f) => f.mainCheckoutStatusPrompt("post-batch"), NO_BUILD],
    ],
    resolvePrompt: [["resolvePrompt", (f) => f.resolvePrompt("tasks/*.md"), NO_BUILD]],
    prPrompt: [
      ["prPrompt (remote)", (f) => f.prPrompt(task, { notes: "caveat", deviations: [] }, true), NO_BUILD],
      ["prPrompt (remote, record-only close)", (f) => f.prPrompt(task, { notes: "caveat", deviations: [], recordOnly: { pass: 2, range: "a..b", verified: "only the flake task", note: "the payments suite failed on the base too" } }, true), NO_BUILD],
      ["prPrompt (no remote)", (f) => f.prPrompt(task, { notes: "", deviations: [] }, false), NO_BUILD],
      ["prPrompt (remote, deviation + assessment)", (f) => f.prPrompt(task, { notes: "caveat", deviations, deviationAssessments }, true), NO_BUILD],
      ["prPrompt (remote, deviation, cycle recorded no assessment)", (f) => f.prPrompt(task, { notes: "", deviations, deviationAssessments: [] }, true), NO_BUILD],
    ],
    cleanupNote: [["cleanupNote", (f) => f.cleanupNote(task), NO_BUILD]],
    collisionScanPrompt: [["collisionScanPrompt", (f) => f.collisionScanPrompt([{ slug: task.slug, branch: task.branch, base: task.base }]), NO_BUILD]],
    resolveCollisionsPrompt: [
      ["resolveCollisionsPrompt (remote)", (f) => f.resolveCollisionsPrompt([task], [{ kind: "path", name: "src/a.ts", branches: [task.branch, "task/043-x"] }], true), COLLISION_TEMP_DIRECTORY],
      ["resolveCollisionsPrompt (no remote)", (f) => f.resolveCollisionsPrompt([task], [{ kind: "path", name: "src/a.ts", branches: [task.branch, "task/043-x"] }], false), COLLISION_TEMP_DIRECTORY],
    ],
    collisionReReviewPrompt: [
      ["collisionReReviewPrompt (remote)", (f) => f.collisionReReviewPrompt(task, true, "on"), REREVIEW_TEMP_DIRECTORY],
      ["collisionReReviewPrompt (no remote)", (f) => f.collisionReReviewPrompt(task, false, "on"), REREVIEW_TEMP_DIRECTORY],
      ["collisionReReviewPrompt (standing deviation)", (f) => f.collisionReReviewPrompt(task, true, "on", deviations), REREVIEW_TEMP_DIRECTORY],
    ],
  },
  "wf-address-review.js": {
    gatherPrompt: [["gatherPrompt", (f) => f.gatherPrompt("#42 push"), NO_BUILD]],
    publishPrompt: [
      ["publishPrompt", (f) => f.publishPrompt(publishPacket, [], { push: true, pingCodex: false }), NO_BUILD],
      ["publishPrompt (deviation + assessment)", (f) => f.publishPrompt(publishPacket, [], { push: true, pingCodex: false }, deviations, deviationAssessments), NO_BUILD],
      ["publishPrompt (deviation, cycle recorded no assessment)", (f) => f.publishPrompt(publishPacket, [], { push: true, pingCodex: false }, deviations, []), NO_BUILD],
      ["publishPrompt (record-only close)", (f) => f.publishPrompt(publishPacket, [], { push: true, pingCodex: false }, [], [], { pass: 2, range: "a..b", verified: "only the flake task", note: "the payments suite failed on the base too" }), NO_BUILD],
      // The publisher's working-location contract branches on whether this run
      // attached a worktree, and the worktree arm is the one that also tells it
      // to keep off the main checkout — the "new branch inside an existing
      // builder" gap again, closed the same way.
      ["publishPrompt (worktree mode)", (f) => f.publishPrompt(publishPacketWorktree, [], { push: true, pingCodex: false }), NO_BUILD],
    ],
    // The delegated rebase brief branches twice: on WHICH of the run's two
    // points it is (the purpose paragraph and the validation wording), and on
    // whether the run attached a worktree (the location contract, the arm that
    // also tells it to keep off the main checkout). Same "new branch inside an
    // existing builder" gap the comments above name, closed the same way.
    rebasePrompt: [
      ["rebasePrompt (pre-fix, inline)", (f) => f.rebasePrompt("pre-fix", publishPacket, "main"), rebaseTempDirectory("pre-fix")],
      ["rebasePrompt (pre-push, inline)", (f) => f.rebasePrompt("pre-push", publishPacket, "main"), rebaseTempDirectory("pre-push")],
      ["rebasePrompt (pre-fix, worktree mode)", (f) => f.rebasePrompt("pre-fix", publishPacketWorktree, "abc1234def5678"), rebaseTempDirectory("pre-fix")],
    ],
    reclaimPrompt: [["reclaimPrompt", (f) => f.reclaimPrompt("/w/.worktrees/c/pr-42", 42, "publication completed"), NO_BUILD]],
  },
};

// --- Run ------------------------------------------------------------------

let failures = 0;
let rendered = 0;
let clauseChecks = 0;
let destinationChecks = 0;
let destinationClauseChecks = 0;
let proseAnchors = 0;
const rows = [];

// Printing is a function so the workflow-set check below can report and stop.
// A CUT key naming a file that is gone must not fall through to the render
// loop: `load()` reaches it first and dies with a raw ENOENT, which fails the
// run but discards the diagnostic row that says which key it was.
function report() {
  const w = (i) => Math.max(...rows.map((r) => r[i].length));
  const widths = [w(0), w(1), w(2)];
  for (const r of rows) {
    console.log(`${r[0].padEnd(widths[0])}  ${r[1].padEnd(widths[1])}  ${r[2].padEnd(widths[2])}  ${r[3]}`);
  }
  // "Accounted for" is the CUT keys whose file is actually shipped, not the key
  // count: on the vanished path one key names a file that is gone, and counting
  // it would contradict the row directly above that says exactly that.
  const accountedFor = Object.keys(CUT).filter((f) => shipped.includes(f)).length;
  console.log(`\n${rendered} rendered prompt paths across ${accountedFor} accounted-for workflows, ${clauseChecks} boundary constants clause-checked, ${destinationChecks} of those renders ordering a build and destination-checked (${destinationClauseChecks} destination constants clause-checked), ${proseAnchors} prose destination clauses deletion-guarded, ${failures} failing.`);
  if (failures) process.exit(1);
}

const shipped = shippedWorkflows();
const listed = Object.keys(CUT).sort();
const unlisted = shipped.filter((f) => !listed.includes(f));
const vanished = listed.filter((f) => !shipped.includes(f));
if (unlisted.length || vanished.length) {
  failures++;
  const why = [
    unlisted.length ? `shipped but not in CUT: ${unlisted.join(", ")} — add its cut marker and fixtures` : "",
    vanished.length ? `in CUT but not shipped: ${vanished.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  rows.push(["(all)", "workflow set", "FAIL", why]);
  // Only the vanished direction is fatal to the rest of the run; an unlisted
  // file leaves every CUT key resolvable, so that half still reports in full.
  if (vanished.length) report();
} else {
  rows.push(["(all)", "workflow set", "ok", `${shipped.length} shipped wf-*.js all accounted for: ${shipped.join(", ")}`]);
}

for (const file of Object.keys(CUT)) {
  const { names, fns, boundaries, destinations, accounting } = load(file);
  const fixtures = FIXTURES[file] || {};
  const { sites, prose, unaccounted } = accounting;
  if (unaccounted.length) {
    failures++;
    rows.push([file, "agent( accounting", "FAIL", `unrecognized agent( call shape at line ${unaccounted.join(", ")} — discovery renders nothing for it`]);
  } else {
    const excluded = prose.length ? ` (line ${prose.join(", ")})` : "";
    rows.push([file, "agent( accounting", "ok", `${sites} call sites; ${prose.length} prose mention(s) in comments excluded${excluded}`]);
  }
  // CONTENT: the clauses, once per constant this file declares.
  for (const [bName, text] of boundaries) {
    clauseChecks++;
    const missing = REQUIRED.filter(([, re]) => !re.test(text)).map(([what]) => what);
    if (missing.length) {
      failures++;
      rows.push([file, `${bName} (clauses)`, "FAIL", `missing: ${missing.join("; ")}`]);
    } else {
      rows.push([file, `${bName} (clauses)`, "ok", `all ${REQUIRED.length} clauses, ${Buffer.byteLength(text)} bytes`]);
    }
  }
  // The same content question for each destination constant this file declares,
  // and for the same reason. Unlike the boundary, declaring none is no failure;
  // declaring one this suite has no clause list for is.
  for (const [dName, text] of destinations) {
    destinationClauseChecks++;
    const clauses = DESTINATION_CLAUSES[dName];
    if (!clauses) {
      failures++;
      rows.push([file, `${dName} (clauses)`, "FAIL", "destination constant with no clause list — add one to DESTINATION_CLAUSES"]);
      continue;
    }
    const missing = clauses.filter(([, re]) => !re.test(text)).map(([what]) => what);
    if (missing.length) {
      failures++;
      rows.push([file, `${dName} (clauses)`, "FAIL", `missing: ${missing.join("; ")}`]);
    } else {
      rows.push([file, `${dName} (clauses)`, "ok", `all ${clauses.length} clauses, ${Buffer.byteLength(text)} bytes`]);
    }
  }
  // Every destination clause this file's own cases know about — the constants it
  // declares, plus the first pin of each bespoke spec used for one of its
  // renders. This is what a NO_BUILD render is asserted to carry NONE of.
  const knownDestinations = [
    ...destinations,
    ...Object.values(fixtures)
      .flat()
      .flatMap(([label, , dest]) => (dest && dest.pins ? [[label, dest.pins[0]]] : [])),
  ];
  for (const name of names) {
    if (!fixtures[name]) {
      failures++;
      rows.push([file, `${name} (NO FIXTURE)`, "FAIL", "reaches agent() but this suite renders no case for it"]);
      continue;
    }
    for (const [label, render, dest] of fixtures[name]) {
      rendered++;
      let text;
      try {
        text = render(fns);
      } catch (err) {
        failures++;
        rows.push([file, label, "FAIL", `render threw: ${err.message}`]);
        continue;
      }
      // PRESENCE: exact containment of one of this file's own constants. Every
      // boundary use in these sources is a bare `${CONSTANT}` interpolation, so
      // a rendered brief carries the constant verbatim or does not carry it.
      const carried = boundaries.find(([, b]) => text.includes(b));
      if (!carried) {
        failures++;
        rows.push([file, label, "FAIL", `no boundary: carries none of ${boundaries.map(([n]) => n).join(", ")} verbatim`]);
      } else {
        rows.push([file, label, "ok", `${text.length} chars, carries ${carried[0]}`]);
      }
      // DESTINATION: the verdict this case declares, applied to the same render.
      // Absent, the case is unclassified and fails — that fail-closed default is
      // the whole answer to "how does this suite decide what orders a build".
      if (!dest) {
        failures++;
        rows.push([file, `${label} (destination)`, "FAIL", "no output-destination verdict on this fixture case — add NO_BUILD or a destination spec"]);
      } else if (dest.orders) {
        destinationChecks++;
        const spans = dest.constant ? [destinations.get(dest.constant)] : dest.pins;
        if (dest.constant && spans[0] === undefined) {
          failures++;
          rows.push([file, `${label} (destination)`, "FAIL", `verdict names ${dest.constant}, which this file does not declare`]);
        } else {
          const absent = spans.filter((span) => !text.includes(span));
          if (absent.length) {
            failures++;
            rows.push([file, `${label} (destination)`, "FAIL", `orders a build but does not carry ${absent.length} of ${spans.length} destination span(s) verbatim; first missing: ${JSON.stringify(absent[0].slice(0, 70))}…`]);
          } else {
            rows.push([file, `${label} (destination)`, "ok", dest.constant ? `carries ${dest.constant}` : `carries ${spans.length} pinned span(s)`]);
          }
        }
      } else {
        // The one mechanical cross-check on a negative verdict: a brief that
        // orders no build must not carry a destination clause either. It catches
        // the drift in both directions — a build order added with its clause but
        // without flipping the verdict, and a clause left behind after its build
        // order went away — and catches nothing about the dangerous direction,
        // which the verdict alone answers for.
        const stray = knownDestinations.find(([, span]) => text.includes(span));
        if (stray) {
          failures++;
          rows.push([file, `${label} (destination)`, "FAIL", `declared NO_BUILD but carries the destination clause of ${stray[0]}`]);
        }
      }
    }
  }
  // A fixture naming a builder that no longer reaches agent() is stale.
  for (const name of Object.keys(fixtures)) {
    if (!names.includes(name)) {
      failures++;
      rows.push([file, `${name} (STALE FIXTURE)`, "FAIL", "no agent() call site renders this builder any more"]);
    }
  }
}

// The three out-of-section `DESTROY_BOUNDARY` constants are maintained as
// byte-identical copies, and two of them SAY SO in prose beside themselves; the
// clause regexes above match each independently and would pass a drifted copy,
// so the comments' claim is checked here rather than trusted. The two in-section
// `CYCLE_DESTROY_BOUNDARY` copies are not rechecked: the `review-cycle-core`
// awk/diff byte-identity check already covers the whole section holding them.
const copies = Object.keys(CUT).map((file) => [
  file,
  (readFileSync(join(workflows, file), "utf8").match(/^const DESTROY_BOUNDARY = `((?:\\.|[^`\\])*)`;$/m) || [])[1],
]);
const drifted = copies.filter(([, text]) => text !== copies[0][1]).map(([file]) => file);
const missing = copies.filter(([, text]) => text === undefined).map(([file]) => file);
if (missing.length || drifted.length) {
  failures++;
  const why = missing.length ? `no top-level \`const DESTROY_BOUNDARY\` in ${missing.join(", ")}` : `copies differ: ${copies[0][0]} vs ${drifted.join(", ")}`;
  rows.push(["(all)", "DESTROY_BOUNDARY identity", "FAIL", why]);
} else {
  rows.push(["(all)", "DESTROY_BOUNDARY identity", "ok", `${copies.length} copies byte-identical, ${Buffer.byteLength(copies[0][1])} bytes each`]);
}

// The same question for the finish-in-turn rule, which now exists twice over:
// `CYCLE_FINISH_IN_TURN` inside the mirrored `review-cycle-core` section binds
// the cycle's roles, and each workflow that also briefs deputies of its own
// out here declares `DEPUTY_FINISH_IN_TURN` for them, because out-of-section
// code does not reach into the section. Two spellings of one rule are two
// rules the moment one is edited, so the canonical text is read from
// `wf-review-cycle.js` — the section's source — and every deputy copy must
// match it exactly. A file declaring no deputy copy simply has no deputies;
// that is not a failure. A file declaring one that no longer matches is — and
// so is a file whose prompts interpolate `${DEPUTY_FINISH_IN_TURN}` while the
// declaration pattern below finds nothing to compare, since "has no deputies"
// and "declares its copy in a shape this check cannot read" are the same
// silence otherwise, and the second one would exempt exactly the file the
// check exists for. The `DESTROY_BOUNDARY` check above fails closed on a
// missing declaration because every workflow must carry one; this one cannot,
// so the interpolation is what says a declaration was owed.
const rule = (file, name) =>
  (readFileSync(join(workflows, file), "utf8").match(new RegExp(`^const ${name} = ("(?:\\\\.|[^"\\\\])*");$`, "m")) || [])[1];
const canonicalRule = rule("wf-review-cycle.js", "CYCLE_FINISH_IN_TURN");
const deputyRuleReads = shippedWorkflows().map((file) => [file, rule(file, "DEPUTY_FINISH_IN_TURN")]);
const deputyRules = deputyRuleReads.filter(([, text]) => text !== undefined);
const unreadableDeputyRules = deputyRuleReads
  .filter(([file, text]) => text === undefined && readFileSync(join(workflows, file), "utf8").includes("${DEPUTY_FINISH_IN_TURN}"))
  .map(([file]) => file);
if (!canonicalRule) {
  failures++;
  rows.push(["(all)", "FINISH_IN_TURN identity", "FAIL", "no top-level `const CYCLE_FINISH_IN_TURN` in wf-review-cycle.js"]);
} else if (unreadableDeputyRules.length) {
  failures++;
  rows.push(["(all)", "FINISH_IN_TURN identity", "FAIL", `interpolates \`\${DEPUTY_FINISH_IN_TURN}\` but declares no readable top-level \`const DEPUTY_FINISH_IN_TURN = "…";\`: ${unreadableDeputyRules.join(", ")}`]);
} else {
  const ruleDrifted = deputyRules.filter(([, text]) => text !== canonicalRule).map(([file]) => file);
  if (ruleDrifted.length) {
    failures++;
    rows.push(["(all)", "FINISH_IN_TURN identity", "FAIL", `DEPUTY_FINISH_IN_TURN differs from the cycle's rule in ${ruleDrifted.join(", ")}`]);
  } else {
    rows.push(["(all)", "FINISH_IN_TURN identity", "ok", `${deputyRules.length} deputy copy(ies) match the cycle's rule`]);
  }
}

// --- The prose briefs, which nothing renders ------------------------------
// 017's destination clauses also ship in the skills, mirrored on both sides,
// where the file text IS the brief — there is nothing to evaluate and nothing to
// render. So this half is a deletion guard plus a census, and the header states
// exactly what that reaches and what it does not.
//
// One anchor per shipped clause, verbatim, each spanning the POSITIVE
// destination and not only the "never a fixed shared scratchpad name"
// prohibition, so a clause gutted to its keywords with the instruction destroyed
// fails it. Each anchor must appear EXACTLY once in its file: twice would mean
// two clauses one anchor cannot tell apart, and the second copy is how a
// deletion of the first would go unnoticed.
//
// Both mirrors are held to the same anchors, which is the strongest form of the
// lockstep rule this repository keeps by hand: these clauses are byte-identical
// across the two sides today, so a mirror reworded on one side alone fails here.
const PROSE_MIRRORS = ["plugins/dev-skills/skills", "codex/dev-skills/skills"];
// The warning every one of these clauses carries, and the census key. It is not
// the anchor: a clause could keep this phrase and lose its destination, which is
// exactly what the anchors are long enough to catch.
const PROSE_WARNING = /shared scratchpad (?:name|filename)/g;
const PROSE_CLAUSES = {
  "address-review": [
    "hand it the path any build or check output must land in — namespaced by this PR number, or created with `mktemp -d`, and outside the checkout it commits from — never a fixed shared scratchpad name",
  ],
  "address-reviews": [
    "Any output that must land in a file goes inside this worktree (a gitignored path, removed before any commit), never a shared scratchpad filename",
  ],
  "address-tasks": [
    // The implementer template, the reviewer's own rule, and the quoted brief
    // for the integration-check subagent, which validates from a worktree it
    // must leave clean and so is sent outside every worktree instead.
    "Any build or check output that must land in a file goes inside this worktree (a gitignored path, removed before any commit), never a shared scratchpad filename",
    "any build or check output that must land in a file goes inside this task's worktree (a gitignored path, removed before any commit), never a shared scratchpad filename",
    "create a unique directory for it first with `mktemp -d`, outside every worktree, and write there — never a fixed shared scratchpad name",
  ],
  "address-tasks-serialized": [
    "Any build or lint output that must land in a file goes there, never a fixed shared scratchpad name",
    "Any build or check output that must land in a file goes there, never a fixed shared scratchpad name",
  ],
  // The briefless spawn instruction: the rule sits in the skill text the
  // orchestrator itself follows, because there is no template to carry it.
  "reap-tasks": [
    "Output that must land in a file goes to a path namespaced by the task number, or one created with `mktemp -d` — never a fixed shared scratchpad name",
  ],
  "resolve-open-questions": [
    "Hand it the path any of that output must land in — namespaced by the item, or created with `mktemp -d` — never a fixed shared scratchpad name",
    "Hand it the path any of that validation output must land in — namespaced by the item, or created with `mktemp -d`, and outside the worktree it commits from, which must be left clean — never a fixed shared scratchpad name",
  ],
  // The inherited contract: every consumer of the cycle's Reviewer role reaches
  // its destination rule through this one clause.
  "review-cycle": [
    "tell it where any output of that build goes, a path under the cycle's artifact directory below or inside the reviewed worktree, never a fixed shared scratchpad name and never left to the reviewer to pick",
  ],
};

for (const mirror of PROSE_MIRRORS) {
  const dir = join(root, mirror);
  // The census reads EVERY skill in the mirror rather than the declared ones, so
  // a clause arriving in a file this table does not name fails here instead of
  // shipping unguarded. It cannot see a brief that never had a clause at all.
  const census = new Map();
  for (const skill of readdirSync(dir).sort()) {
    let text;
    try {
      text = readFileSync(join(dir, skill, "SKILL.md"), "utf8");
    } catch {
      continue;
    }
    const n = (text.match(PROSE_WARNING) || []).length;
    if (n) census.set(skill, n);
  }
  const undeclared = [...census.keys()].filter((skill) => !PROSE_CLAUSES[skill]);
  if (undeclared.length) {
    failures++;
    rows.push([mirror, "prose census", "FAIL", `carries a destination clause but is not guarded: ${undeclared.join(", ")} — add its anchor(s)`]);
  } else {
    rows.push([mirror, "prose census", "ok", `${census.size} skills carry destination clauses, all guarded`]);
  }
  for (const [skill, anchors] of Object.entries(PROSE_CLAUSES)) {
    const path = `${mirror}/${skill}/SKILL.md`;
    let text;
    try {
      text = readFileSync(join(dir, skill, "SKILL.md"), "utf8");
    } catch (err) {
      failures++;
      rows.push([path, "prose destination", "FAIL", `cannot read: ${err.message}`]);
      continue;
    }
    const wrong = anchors.map((anchor) => [anchor, text.split(anchor).length - 1]).filter(([, n]) => n !== 1);
    const counted = census.get(skill) || 0;
    if (wrong.length) {
      failures++;
      const [anchor, n] = wrong[0];
      rows.push([path, "prose destination", "FAIL", `${wrong.length} of ${anchors.length} anchor(s) not present exactly once; first found ${n}x: ${JSON.stringify(anchor.slice(0, 70))}…`]);
    } else if (counted !== anchors.length) {
      failures++;
      rows.push([path, "prose destination", "FAIL", `${counted} destination clause(s) in the file but ${anchors.length} anchored — a clause arrived or left; update the anchors`]);
    } else {
      proseAnchors += anchors.length;
      rows.push([path, "prose destination", "ok", `${anchors.length} clause(s) anchored, ${counted} in the file`]);
    }
  }
}

report();
