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
// reads as covered long before every prompt actually carries it. Four review
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
//   each; asserting ten clauses against all sixty-six renders re-derived the
//   same five answers sixty-six times over. The constants are evaluated out of the
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
//   fixtures — ACCOUNTING, not searching. The verdict is FAIL-CLOSED and TOTAL,
//   and it is worth being exact about what it is total OVER, because the two
//   halves of the render set are not established the same way. BUILDER NAMES are
//   discovered from the sources; the RENDER CASES for each builder are
//   ENUMERATED by hand in `FIXTURES`. The verdict is total over those enumerated
//   cases: every one carries a third element saying whether that render orders a
//   build (`NO_BUILD`, or a destination spec), and a case carrying none FAILS as
//   unclassified. A list missing an entry passes; a total map missing an entry
//   cannot. So a new BUILDER fails twice — once for having no fixture, because
//   its name is discovered rather than written down, and again for having no
//   verdict once given one — while a new BRANCH of a builder that already has
//   fixtures yields no new render case, and so no new verdict to be missing.
//   That is the rendering gap this header ends on, and the destination check
//   inherits it whole rather than closing it. The verdict is per RENDER
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
// clause left behind after its build order was removed. "Clause this suite
// knows" is deliberately read off the DECLARED clauses rather than off the ones
// some case still claims — see BESPOKE_DESTINATIONS — because the latter is
// emptied by the wrong verdict this cross-check is aimed at. The dangerous
// direction — a build order added with NO destination — is what the verdict
// alone answers for, and only over the render cases enumerated below. The
// rendering gaps stated at the end of this header apply to it unchanged, the
// first of them sharply: a new BRANCH inside a builder these fixtures already
// render is unrendered, unclassified and green until its fixtures widen, so a
// branch that grows a build order and names no destination is caught by nothing
// here. Widen the fixtures when a builder gains a branch.
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
// destroyed fails it. A verdict that claims a build order and pins NOTHING fails
// too, in both shapes that vacuum takes: an empty span, which every string
// contains, and an EMPTY LIST of them, which `some`/`filter` answer vacuously —
// that one reported "carries 0 pinned span(s)" as a pass until it was
// demonstrated. Containment of nothing establishes nothing, so it is unclassified
// rather than satisfied. CONTENT is checked once per destination constant
// besides, for the boundary's reason — exact containment of a constant says
// nothing about what the constant says — but as a continuous pin rather than a
// set of phrase regexes, because three regexes over one sentence were satisfied
// by its negation; see DESTINATION_PINS. A file declaring no destination constant
// is fine, unlike the boundary, because its clauses are inline by design.
//
// And a FOURTH job, over files this suite renders nothing from: 017's
// destination clauses also ship in the `SKILL.md` briefs of BOTH skill mirrors,
// where the file text IS the brief and there is no builder. That half is
// therefore a DELETION GUARD — a verbatim anchor of every shipped clause must
// stay present, in both mirrors — plus a CENSUS: every `SKILL.md` in either
// mirror is scanned for the shared-scratchpad warning and its count must equal
// the WARNING-CARRYING anchors declared for it, so a clause that arrives, or
// leaves, fails until the table below is brought up to date. Warning-carrying is
// the qualifier that makes the equality statable: one shipped clause delegates
// its warning by reference and so carries none to count, and it is anchored
// without joining that count. It is censused instead by the delegation it makes,
// against the anchors declared for THAT category, so both categories are held to
// a count read off the mirrors rather than one of them resting on the table
// alone. The table below states all three categories.
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
// marker below, where the file's runtime body begins — inside a
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
//
// EVERY COLLECTION THIS SUITE ITERATES OR REDUCES OVER, and what an empty one
// does. This enumeration is here because the same hole was found three times by
// three readers in the same mechanism: an empty collection satisfies `some`,
// `filter`, `find` and `for…of` vacuously, and every check built on one is a
// check that can be switched off by emptying its input rather than by breaking
// it. `[]` is also TRUTHY, so a `!collection` guard does not catch it. Read this
// list before adding a check, and extend it when you do.
//
// What it enumerates is every collection whose EMPTINESS COULD SWITCH A CHECK
// OFF, however that collection is derived: `deputyRules` and `census` are both
// computed rather than declared, and both are listed. What it leaves out — as a
// class, rather than one at a time — is the derived RESULT lists whose empty state
// IS the verdict their check reports as a pass: `unlisted`, `vanished`,
// `unaccounted`, `prose`, `drifted`, `missing`, `unreadableDeputyRules`,
// `ruleDrifted`, `undeclared`, `wrong`, `absent`, `emptyTables`, `blankSpans`,
// and `stray`, the one `find` among them rather than a list. Whichever shape,
// emptying one of those is not an edit available to anyone: each is DERIVED from
// something this file establishes elsewhere — most of them by filtering a
// collection this list already covers — and each comes back empty exactly when
// the condition it detects is absent. `prose` and `unaccounted` are the two whose
// source is a scan rather than a listed collection: they partition one source's
// literal `agent(` occurrences between them, and they sit in this class for
// different reasons. `unaccounted` fits it exactly: non-empty increments
// `failures` and prints a FAIL row, so its empty state IS the pass that check
// reports. `prose` reports no verdict at all — it is printed for the record and
// gates nothing — so it has no check of its own to switch off. What keeps both
// out of the inventory is that neither is a hand-written INPUT: emptying either
// takes deleting `agent(` occurrences from a shipped source, and what a lost
// occurrence costs is a builder that goes unrendered, which is
// `promptBuilders(src).names`' entry below. What this list exists to catch is a
// check switched off by emptying its INPUT; a result list has no such door.
//
// `emptyTables` is in that class on both counts — it is filtered out of the
// inline guard registry, and it comes back empty exactly when no declared table
// is empty — and it is the case the "most of them" above hedges around: the
// collection it filters was itself covered by no entry. That INPUT is what needed
// one, and it has one below.
//
//   `CUT` — empty: every shipped `wf-*.js` is unlisted, which FAILs the
//     workflow-set check, and nothing renders. The run then dies in the
//     `DESTROY_BOUNDARY` identity check reading `copies[0]` of an empty list, so
//     it exits non-zero on a stack trace with no table rather than on that row —
//     measured, and left alone: loud is the requirement, and no ordinary edit
//     empties this map.
//   the shipped set, `shippedWorkflows()` — empty: every CUT key has vanished,
//     which FAILs and stops the run right there, on the row that names the keys.
//   `REQUIRED` — empty: reported "all 0 clauses" as a pass until the
//     declared-tables check below was added. Guarded there now.
//   `DESTINATION_PINS` — empty, or an entry that is empty or holds an empty
//     span: every destination constant a file declares FAILs for having no
//     usable pin. A file declaring no destination constant checks nothing here,
//     which is legitimate — see `destinationNames`.
//   `boundaryNames(src)` — empty: `load()` throws. Every workflow must declare a
//     boundary, since nothing it renders could otherwise carry one.
//   `destinationNames(src)` — empty is LEGITIMATE, the one exception in this
//     list: `wf-address-review.js`'s destination clauses are all inline prose.
//   `promptBuilders(src).names` — empty: that file renders nothing, and every
//     fixture it has FAILs as stale. A file with neither call sites nor fixtures
//     passes with zero renders, which is the truth about a workflow that spawns
//     no subagent; the `agent(` accounting is what makes "no call sites" mean it.
//   `FIXTURES[file]` — missing or empty: every builder discovered in that file
//     FAILs as having no fixture.
//   `fixtures[name]` — an empty CASE LIST: FAILs. Before that guard it was the
//     quietest hole in the suite, because `[]` is truthy and so passed the
//     missing-fixture check, then rendered nothing, so the builder lost its
//     boundary PRESENCE check and its destination verdict at once and was not
//     stale either: `cycleFixPrompt: []` took the run to 54 renders and 14
//     destination checks with zero FAIL rows.
//   `dest.pins` — empty list, or a list holding an empty span: FAILs as
//     unclassified rather than satisfied. Both shapes are checked in the render
//     loop and the reasoning is beside them.
//   `knownDestinations` — empty: the NO_BUILD cross-check finds no stray clause
//     and passes vacuously. It USED to be emptiable in one edit, and the claim
//     here that it could not be was wrong twice over: built from the specs a
//     file's cases still claimed, classifying `wf-address-review.js`'s only
//     build-ordering renders (`rebasePrompt`'s three) as `NO_BUILD` emptied it —
//     that file declares no destination constant either — and the three renders
//     passed while still carrying their clause verbatim, at exit 0. It is now
//     built from `BESPOKE_DESTINATIONS` plus the file's own constants, so no
//     verdict reaches it; the remaining ways to empty it are emptying that table
//     or emptying every constant, and both FAIL their own check. The `.filter`
//     that drops empty spans is there so one emptied span is reported once as its
//     own failure rather than as every NO_BUILD render carrying it.
//   `BESPOKE_DESTINATIONS` — empty, or an entry holding an empty span: the
//     cross-check searches for that clause in nothing, silently. Guarded by the
//     declared-tables check below, both shapes.
//   `PROSE_MIRRORS` — empty: reported "0 prose destination clauses
//     deletion-guarded" as a pass. Guarded by the declared-tables check below.
//   the GUARD REGISTRY those three are read out of — the inline
//     `[["REQUIRED", REQUIRED], …]` literal `emptyTables` filters — which is the
//     INPUT to the declared-tables check rather than one of its results, and the
//     one hand-written collection here that no other entry covers. Empty: all
//     three tables lose their emptiness guard at once, so emptying `REQUIRED`
//     after that passes again. SHRUNK: only the table whose pair went loses it —
//     measured, by dropping `["REQUIRED", REQUIRED]` and then emptying
//     `REQUIRED`, which passes at exit 0 on the row `declared tables ok
//     REQUIRED 0 clauses…`, i.e. the promise made under `REQUIRED` above
//     ("Guarded there now") rests on an input that is itself unguarded. That is
//     the shrinkage class stated after this list, and this registry is its
//     floor: nothing censuses it against anything.
//   `PROSE_CLAUSES` — empty: every skill carrying a warning phrase or a
//     by-reference clause is undeclared, so the census FAILs in both mirrors.
//   the `anchors` and `byReference` lists inside one `PROSE_CLAUSES` entry —
//     empty TOGETHER, or holding an empty string: FAILs as an entry that claims a
//     guard and asserts nothing. A `byReference` key PRESENT and EMPTY FAILs on its
//     own too, and that one was measured on this check rather than reasoned about:
//     the anchors and the warning census both still held, so the by-reference
//     clause lost its only guard and the run passed. An ABSENT `byReference` is
//     the ordinary shape for a file with no such clause, and no failure in
//     itself — but it is no longer a free way to un-guard one either: the
//     by-reference census counts the delegating clause the mirrors ship and holds
//     `byReference.length` to it, so deleting the key while the clause ships FAILs.
//     That edit used to be the one guard in this table removable in silence.
//     `anchors` empty ALONE — or the key omitted, which is the same claim — is
//     legitimate (no entry is shaped that way today): it says the file's only
//     guarded clause carries no warning, and the warning equality then holds at
//     zero.
//   `census` — empty (no skill carries a warning or a by-reference clause): every
//     declared entry FAILs with "0 warning-carrying destination clause(s) in the
//     file but N anchored", or with its by-reference counterpart.
//   `deputyRules` — empty: the drift comparison over the deputy copies of the
//     finish-in-turn rule answers vacuously, and it reported "0 deputy copy(ies)
//     match the cycle's rule" as a pass until this was demonstrated by deleting
//     every declaration AND every `${DEPUTY_FINISH_IN_TURN}` interpolation from
//     the workflows. `unreadableDeputyRules` catches only the half where the
//     interpolation outlives the declaration, so that edit passed. Empty now
//     FAILs, on a narrower premise than the one first written here: briefing a
//     subagent out of section does not oblige a declaration — `wf-review-cycle.js`
//     briefs its scope agent out here and declares none — so what makes zero
//     illegitimate is the tree as it stands, where two of the three workflows
//     declare this rule AND interpolate it. No declaration anywhere therefore
//     means the declarations went, not the deputies.
//     What still passes is the PER-FILE version of the same loss — one workflow
//     dropping its declaration and its interpolations together while keeping the
//     deputies — since a file declaring no copy is legitimate and this check
//     cannot tell the two apart; see the comment on the check.
//     `deputyRuleReads` is empty only when the shipped set is, which is listed
//     above.
//   `rows` — never empty when `report()` runs: the workflow-set row is pushed
//     before anything can fail, and `Math.max(...[])` in the column widths would
//     be `-Infinity` if it were.
//
// SHRINKAGE, the class this inventory does not reach, stated once here rather
// than under each entry. Every line above reasons about a collection going
// EMPTY, and the guards this suite has answer that shape wherever the emptied
// collection is one a check names: an emptied table fails the declared-tables
// check, an emptied case list fails as unclassified — with the guard registry
// above as the floor, since emptying IT switches those very guards off.
// Removing ONE ENTRY from a hand-written collection is the other shape, and the
// answer splits by whether anything counts that collection against the shipped
// files. Where something does, shrinking FAILS on its own: dropping a
// warning-carrying anchor from `PROSE_CLAUSES` leaves the census counting a
// clause the table no longer declares, and dropping a `byReference` anchor now
// fails too, against the guards beside it. Where nothing does —
// `BESPOKE_DESTINATIONS`' entries, the guard registry above — shrinking is
// invisible, and what the guards buy is that closing the resulting hole takes a
// SECOND deliberate edit: removing the `rebaseTempDirectory` entry from
// `BESPOKE_DESTINATIONS` AND flipping `rebasePrompt` to `NO_BUILD` passes at
// exit 0, where before those guards one edit did. Two edits rather than one is a
// real strengthening and not a proof of coverage; a purely hand-declared entry is
// only ever as safe as the review of the diff that removes it.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workflows = join(root, "plugins/dev-skills/workflows");

// Where each shipped workflow's runtime body begins: the prefix above it is
// what this suite evaluates, with `export const meta` neutralized below. Kept as
// exact strings rather than line numbers so an edit above them cannot silently
// shift the cut; a marker that stops matching fails the suite loudly.
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
// measured rather than hoped for: summing each phrase's match length over each
// evaluated constant, the phrases pin two thirds of the constants IN AGGREGATE in
// contiguous literal runs — 66.8% over the five, which is 65.4% of a
// `CYCLE_DESTROY_BOUNDARY` and 67.8% of a `DESTROY_BOUNDARY`, so no single
// fraction is true of EACH constant and the aggregate is the honest way to state
// it. It was 58.5% before task 046b retired the no-helper fallback clause and
// folded its neighbour into one longer span, and 60.0% before that task's review
// round pinned the guarded `cd` and the install step its message names. So it is
// the unpinned third — the mechanics, the reasons, the tails — that may be
// reworded freely, and the pinned spans that may not. State the fraction as
// measured rather than as remembered, and re-measure it whenever an entry is
// added or a constant is reworded: an earlier figure here said "just over two
// thirds" while the phrases pinned three fifths, and its replacement said three
// fifths "of each constant" when that was only ever true in aggregate.
// Inside a pinned span even an obviously benign edit
// fails: dropping an Oxford comma does, lowercasing `NOT in a clone` does, and
// so does ADDING a command to the forbidden list, i.e. hardening the boundary
// breaks this suite. That is the deal these patterns make, and it is why
// tightening them further has a real cost. Say this rather than "a rewording is
// not a failure", which is broader than any of them delivers.
//
// Each phrase spans the words that make its clause OPERATIVE — its polarity,
// its qualifier, its enumeration — and never merely a tail that an INVERTED or
// NARROWED boundary satisfies just as well, WITH ONE DELIBERATE EXCEPTION
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
// and the retired no-helper fallback's phrase, holding no wildcard at all but
// starting one word past its directive's verb, passed both "NEVER use an
// absolute path outside the repository" and "you may ignore the rule that you
// use an absolute path outside the repository". That clause no longer ships —
// task 046b retired it once the helpers became a precondition rather than a
// branch — but the measurement is what the surviving destination span is built
// on, so it is kept rather than deleted with the clause: a span that starts past
// its directive's verb passes a boundary saying the opposite. So these
// phrases run long, and none of them holds a wildcard any more: every matched
// span is contiguous literal text, and the one place two shipped spellings
// differ inside a span is enumerated ("and", which only the section's copy has)
// rather than skipped over.
//
// WHY THE DESTINATION CLAUSE IS PINNED WHERE IT IS. Until task 046b this rule
// was stated over two entries: a bare existence check on `command -v dc-enter`,
// which asserted only that a destination was named at all, and the no-helper
// fallback's phrase beside it, which carried "in full" for both. Retiring the
// fallback took one leg out from under the other — a bare existence check whose
// stated safety rested on a neighbouring clause that no longer ships guards
// nothing — so the pair is now one span that runs from the directive's polarity
// straight into the destination it names: `belongs ONLY in a disposable clone:
// work in `DC="$(dc-enter <slug>)"``. Nothing shorter would do, and the shape of
// the failure is the one measured above: a span starting past the verb is green
// against a boundary saying the opposite, and a span stopping before the
// destination is green against a boundary that names none — which is the live
// checkout again, since a clone-only rule with no way to get a clone is a rule
// with no destination.
//
// The span reaches the INVOCATION FORM and stops there, deliberately. The rest
// of the helper's usage text — `dc-remove`, `--replace`, the reused-slug
// refusal — stays unpinned here for the reason the old bare entry gave and which
// still holds: those mechanics are a helper's usage text rather than clause
// material, and pinning them would put `dc-enter`'s calling convention under this
// suite, where every future change to the helper breaks a destroy-boundary test.
// What changed is only that the invocation form itself is no longer optional to
// pin, because it is now the ONLY destination the boundary names.
//
// THE GUARDED `cd` IS PINNED SEPARATELY, by the entry after it, and was pinned by
// nothing at all until task 046b's review round. It is not the helper's usage
// text: with the no-helper fallback retired, an empty `DC` aborting the shell is
// the ONLY thing between a missing helper and a subagent running in the shared
// checkout, and 046b's acceptance criterion is stated over it — the stop must NAME
// THE INSTALL STEP — which is why the span runs through the `${DC:?…}` message
// rather than stopping at the `cd`. An earlier round claimed the form was "pinned
// elsewhere on its own terms", in `test-address-review-reconcile.mjs`'s
// `KNOWN_LITERAL_SPANS`. That was wrong in the strongest available direction: that
// list is an EXCLUSION list for a scan hunting unrendered `${…}` builder
// interpolations, so deleting the guarded `cd` makes that scan pass more easily
// and could never fail it. Measured before the entry below existed — deleting the
// sentence `Never `cd` into a path held in a variable unguarded: … Write `cd --
// "${DC:?…}"`, and confirm `pwd` before the first command that writes.` from all
// five boundary constants passed all twelve suites at exit 0.
//
// THE ONE EXCEPTION, stated here rather than left to be rediscovered as a bug.
// A rule with unrecorded exceptions is worse than a bounded one: a reader who
// takes the rule at face value trusts this entry for something it does not do,
// and each round that rediscovers it spends itself re-measuring what was already
// known. It is measured green against boundaries saying something else, and it
// is kept anyway, for the reason given:
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
//   them, and paid for out of the unpinned third measured above.
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
  ["clone-only verification and its named destination", /Empirical verification that could change state belongs ONLY in a disposable clone: work in `DC="\$\(dc-enter <slug>\)"`/],
  // The stop, and the install step it names — see the paragraph above. Pinned
  // from its own imperative verb through the message the shell prints, since a
  // span starting later is green against a boundary that leaves the `cd`
  // unguarded, and one stopping at the `cd` is green against a stop that names
  // no remedy.
  ["guarded `cd`, naming the install step", /Write `cd -- "\$\{DC:\?dc-enter returned no path — install it from the dev-skills plugin bin\/\}"`, and confirm `pwd` before the first command that writes/],
];

// What a destination CONSTANT must say, for REQUIRED's reason — a brief carrying
// the constant verbatim proves the text was interpolated, not that the text still
// instructs anything, so the gutting this closes is the one that keeps the
// vocabulary and destroys the instruction — but NOT on REQUIRED's terms, and the
// difference was demonstrated rather than reasoned. REQUIRED matches each clause
// by the phrase that carries it because it spans ten clauses over five
// constants, where a byte comparison would turn every wording tweak into a
// failure. That tolerance does not survive one sentence: three phrase regexes
// over this constant ("output you redirect to a file", "goes under that same
// round directory", "never a fixed shared scratchpad name") were ALL satisfied by
// a text that reverses the rule — "No build or validation output you redirect to
// a file goes under that same round directory … write it wherever you find
// convenient, never a fixed shared scratchpad name" — because each phrase matched
// in isolation and nothing bound them into one instruction.
//
// So a destination constant is pinned the way a bespoke per-site clause below is:
// as CONTINUOUS verbatim spans of the positive instruction, contained in the
// constant's evaluated value. No reversal, negation or re-ordering of the
// sentence can satisfy that, since the pin is the sentence. The cost is
// deliberate and is the same cost the pins carry: rewording the constant means
// editing the pin here. The explanatory tail after the pin ("parallel cycles
// share one scratch directory") is left free, so the reason may be rewritten
// without the rule moving.
//
// Keyed by constant name rather than by file, since the two copies of this one
// are a single declaration mirrored into the `review-cycle-core` section, whose
// byte-identity check already covers them drifting apart — the same division of
// labour the `DESTROY_BOUNDARY` identity check below draws. A destination
// constant this map does not name FAILS, exactly as an unlisted workflow or an
// unfixtured builder does: the alternative is a new constant whose content
// nothing checks. So does one whose entry is empty, or holds an empty span:
// containment of no span at all, like containment of an empty one, establishes
// nothing.
const DESTINATION_PINS = {
  CYCLE_REDIRECTED_OUTPUT: [
    "Any build or validation output you redirect to a file goes under that same round directory, under any name you like — never a fixed shared scratchpad name",
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
// Hence a verdict per point rather than per builder. The point lands in the
// MIDDLE of the clause, so everything before it — the part every point's render
// carries — is declared on its own: that stem is what the NO_BUILD cross-check
// below searches for, since it has to recognize this clause without knowing
// which point produced it.
const REBASE_DESTINATION_STEM =
  'If you redirect any build output to a file, create a UNIQUE directory for it first, OUTSIDE the checkout (`mktemp -d "${TMPDIR:-/tmp}/rebase-';
const rebaseTempDirectory = (point) =>
  destinationPins(`${REBASE_DESTINATION_STEM}${point}.XXXXXX"\`) — never a fixed shared scratchpad name`);

// Every bespoke destination clause THIS SUITE declares, named by the spec that
// carries it. This is the NO_BUILD cross-check's search set, and it is built from
// the DECLARATIONS rather than from the verdicts that use them, because built
// from the verdicts it was emptied by the very edit it exists to catch: a case
// flipped to `NO_BUILD` took its spec out of the set in the same edit, and in
// `wf-address-review.js` — whose only build-ordering renders are `rebasePrompt`'s
// three, and which declares no destination constant either — that emptied the
// set outright, so all three renders passed as NO_BUILD while still carrying
// their destination clause verbatim. Measured: exit 0, nothing failing.
// One span per spec is enough, since a clause is RECOGNIZED here rather than
// validated — the render loop above is what checks a claimed destination in
// full — so the parametric one contributes its point-independent stem.
const BESPOKE_DESTINATIONS = [
  ["REREVIEW_TEMP_DIRECTORY", REREVIEW_TEMP_DIRECTORY.pins[0]],
  ["COLLISION_TEMP_DIRECTORY", COLLISION_TEMP_DIRECTORY.pins[0]],
  ["rebaseTempDirectory", REBASE_DESTINATION_STEM],
];

// --- Fixtures -------------------------------------------------------------
// One entry per rendered path: label, render, and output-destination verdict. A
// discovered builder with no fixture is a failure, not a skip; so is a builder
// whose case list is EMPTY, which renders nothing and so asserts nothing; and so
// is a fixture case with no verdict.

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
  cyclePeerPreflightPrompt: [
    ["cyclePeerPreflightPrompt", (f) => f.cyclePeerPreflightPrompt(), NO_BUILD],
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
    // The disposition record's one PR write. It branches on the working
    // location exactly as `publishPrompt` does — and only the worktree arm tells
    // it to keep off the main checkout — so both arms are rendered, the same
    // "new branch inside an existing builder" gap closed the same way. It orders
    // no build: the body it composes goes to `gh` on stdin, which is what keeps
    // it from needing an output destination at all.
    recordPrompt: [
      ["recordPrompt", (f) => f.recordPrompt(publishPacket, [], { why: "`no-push` was given.", rounds: 2, reviewerPassed: true, deviations: [] }), NO_BUILD],
      ["recordPrompt (worktree mode)", (f) => f.recordPrompt(publishPacketWorktree, [], { why: "the cycle hit its cap.", rounds: 12, reviewerPassed: false, deviations }), NO_BUILD],
      // The third branch: a publication that stopped PART-WAY renders the same
      // record with its status and provenance lines changed, so the branch is
      // rendered here rather than left to the two that say nothing landed.
      ["recordPrompt (a publication that stopped part-way)", (f) => f.recordPrompt(publishPacket, [], { why: "replying to a thread failed after the push landed.", rounds: 2, reviewerPassed: true, deviations: [], landed: "the push" }), NO_BUILD],
    ],
    // The record's other write, and the only one a fully published run makes:
    // it spends the record it replayed so nothing replays from a map that is
    // now on the PR. It reads nothing in the working location — the body goes
    // to `gh` on stdin — so it has no location arm to branch on and orders no
    // build, and one render covers it.
    spendRecordPrompt: [["spendRecordPrompt", (f) => f.spendRecordPrompt(publishPacket, { summaryUrl: "https://example.invalid/pr/42#issuecomment-5" }), NO_BUILD]],
    reclaimPrompt: [["reclaimPrompt", (f) => f.reclaimPrompt("/w/.worktrees/c/pr-42", 42, "publication completed"), NO_BUILD]],
  },
};

// --- Run ------------------------------------------------------------------

let failures = 0;
let rendered = 0;
let clauseChecks = 0;
let destinationChecks = 0;
let destinationContentChecks = 0;
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
  console.log(`\n${rendered} rendered prompt paths across ${accountedFor} accounted-for workflows, ${clauseChecks} boundary constants clause-checked, ${destinationChecks} of those renders ordering a build and destination-checked (${destinationContentChecks} destination constants content-pinned), ${proseAnchors} prose destination clauses deletion-guarded, ${failures} failing.`);
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
  // declaring one this suite has no pin for is — and so is a pin list that
  // asserts nothing, for the reason the empty-span check further down states.
  for (const [dName, text] of destinations) {
    destinationContentChecks++;
    const pins = DESTINATION_PINS[dName];
    if (!pins || !pins.length || pins.some((pin) => !pin)) {
      failures++;
      const why = !pins
        ? "destination constant with no pin — add its positive instruction to DESTINATION_PINS"
        : "destination constant whose pin list is empty or holds an empty span — containment of nothing establishes nothing";
      rows.push([file, `${dName} (content)`, "FAIL", why]);
      continue;
    }
    const absent = pins.filter((pin) => !text.includes(pin));
    if (absent.length) {
      failures++;
      rows.push([file, `${dName} (content)`, "FAIL", `does not carry ${absent.length} of ${pins.length} pinned instruction(s) verbatim; first missing: ${JSON.stringify(absent[0].slice(0, 70))}…`]);
    } else {
      rows.push([file, `${dName} (content)`, "ok", `all ${pins.length} pinned instruction(s), ${Buffer.byteLength(text)} bytes`]);
    }
  }
  // Every destination clause a NO_BUILD render of this file is asserted to carry
  // NONE of: the destination CONSTANTS this file declares — one it does not
  // declare cannot be interpolated here — plus every bespoke clause the suite
  // declares, whatever file it was written for, since a bespoke clause is prose
  // and prose can be pasted anywhere. Deliberately not "the specs this file's
  // cases still claim": that set is emptied by the wrong verdict it exists to
  // catch, which is what BESPOKE_DESTINATIONS' comment records.
  const knownDestinations = [
    ...destinations,
    ...BESPOKE_DESTINATIONS,
    // An empty span is contained in every string, so a destination constant
    // emptied out would report every NO_BUILD render as carrying it. That is a
    // failure of the constant, reported once as such below, not of thirty-three
    // briefs — the measured count, taken by emptying `CYCLE_REDIRECTED_OUTPUT`
    // and dropping this guard: the NO_BUILD renders of the two files that declare
    // it, 11 in `wf-review-cycle.js` and 22 in `wf-address-tasks.js`, out of 40
    // NO_BUILD renders overall. An emptied BESPOKE_DESTINATIONS span is dropped
    // here for the same reason and reported once by the declared-tables check.
  ].filter(([, span]) => span);
  for (const name of names) {
    // An EMPTY case list is checked with the missing one, because `[]` is truthy
    // and `for…of` over it iterates zero times: the builder would keep its
    // fixture key, go unrendered, and lose its boundary PRESENCE check and its
    // destination verdict together, in silence and without going stale.
    if (!fixtures[name] || !fixtures[name].length) {
      failures++;
      rows.push([
        file,
        `${name} (NO FIXTURE)`,
        "FAIL",
        fixtures[name]
          ? "reaches agent() but its fixture case list is empty — an empty list renders nothing and so asserts nothing, neither the boundary nor a destination"
          : "reaches agent() but this suite renders no case for it",
      ]);
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
        } else if (!spans.length) {
          // Containment of NOTHING proves nothing, the same way containment of an
          // empty span does, and the vacuous form is the quieter one: `[].some`
          // is false and `[].filter` is empty, so a verdict claiming a build
          // order while pinning no span at all used to report "carries 0 pinned
          // span(s)" as a pass — a verdict asserting a build and asserting
          // nothing whatever about its destination.
          failures++;
          rows.push([file, `${label} (destination)`, "FAIL", "orders a build but its verdict pins no destination span at all — that asserts nothing, so the case is unclassified rather than satisfied"]);
        } else if (spans.some((span) => !span)) {
          // Containment of an empty span proves nothing: every string contains
          // one. So an emptied constant or pin fails here rather than passing.
          failures++;
          rows.push([file, `${label} (destination)`, "FAIL", `orders a build and its destination ${dest.constant ? `constant ${dest.constant}` : "pin"} is empty — containment of an empty span establishes nothing`]);
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
// match it exactly. A file declaring no deputy copy is not a failure, but the
// reason is narrower than "it has no deputies": `wf-review-cycle.js` declares
// none while briefing one subagent out here (the scope agent), so what a missing
// declaration actually means is that the file binds no deputy of its own to this
// rule, which this check cannot tell apart from having none to bind. A file
// declaring a copy that no longer matches IS a failure — and so is a file whose
// prompts interpolate `${DEPUTY_FINISH_IN_TURN}` while the
// declaration pattern below finds nothing to compare, since "has no deputies"
// and "declares its copy in a shape this check cannot read" are the same
// silence otherwise, and the second one would exempt exactly the file the
// check exists for. The `DESTROY_BOUNDARY` check above fails closed on a
// missing declaration because every workflow must carry one; this one cannot,
// so the interpolation is what says a declaration was owed. What it CAN fail
// closed on is the total: no copy anywhere, checked below.
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
} else if (!deputyRules.length) {
  // ZERO COPIES, checked before the drift comparison over them, which an empty
  // list answers vacuously: it reported "0 deputy copy(ies) match the cycle's
  // rule" as a pass until this was demonstrated, by deleting every declaration
  // AND every `${DEPUTY_FINISH_IN_TURN}` interpolation from the shipped
  // workflows — the half `unreadableDeputyRules` above cannot see, since it
  // reaches only the case where the interpolation outlives the declaration.
  // Zero is not a legitimate state of this tree, and the reason is narrower than
  // "every shipped workflow briefs a subagent out here" — the comment above
  // establishes that briefing one obliges no declaration, since
  // `wf-review-cycle.js` briefs its scope agent out of section and declares
  // nothing. What rules zero out is the tree as it stands: two of the three
  // workflows declare this rule and interpolate it today, so no declaration
  // anywhere means the declarations went, not the deputies.
  failures++;
  rows.push(["(all)", "FINISH_IN_TURN identity", "FAIL", "no workflow declares a top-level `const DEPUTY_FINISH_IN_TURN`, so the cycle's rule binds no deputy anywhere and every comparison over the copies is vacuous"]);
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
// fails it. "Spanning the destination" means the destination ITSELF, not a
// pronoun pointing at it: where a shipped clause names its destination in a
// preceding sentence and refers back to it ("goes there"), the anchor must begin
// at that sentence. Two of the anchors below did not, and emptying the sentence
// their "there" pointed at — destroying the instruction and leaving the pronoun
// aimed at nothing — kept both anchors present, both mirrors green and the census
// count unchanged. A clause that names NO destination of its own — category 2
// below, which delegates the destination by reference — is the one exception to
// that qualifier and not a loophole in it: its anchor spans the obligation and
// the reference, which is the whole of what the clause says, so gutting either
// half still fails it. Each anchor must appear EXACTLY once in its file: twice
// would mean two clauses one anchor cannot tell apart, and the second copy is how
// a deletion of the first would go unnoticed. An entry with NO anchors fails, for
// the reason an empty pin list does above: it claims a guard and asserts nothing.
//
// Both mirrors are held to the same anchors, which is the strongest form of the
// lockstep rule this repository keeps by hand: these clauses are byte-identical
// across the two sides today, so a mirror reworded on one side alone fails here.
//
// A grep for the CONCEPT finds more clauses than the census counts, so this
// table sorts them into THREE categories and states the census equality over the
// first alone. Naming all three is what reconciles the two numbers; naming one of
// them did not, and the clause that fell through the gap is category 2:
//
//   1. WARNING-CARRYING clauses (`anchors`) — a clause that spells the shared-name
//      warning `PROSE_WARNING` counts. `counted` must equal exactly this many, so
//      one arriving or leaving fails until the table is brought up to date.
//   2. BY-REFERENCE requirements (`byReference`) — a clause that IMPOSES a
//      destination requirement while delegating both the destination and the
//      warning to a rule anchored elsewhere in the same file. `review-cycle`'s
//      delegated rebase step is the one member: its brief carries "the pinned base
//      below, and a destination for any build output under this cycle's
//      artifact-directory rules", which names the `## Artifacts and hygiene` rule
//      anchored below rather than restating it. It carries no warning spelling at
//      all, so NO widening of `PROSE_WARNING` can reach it and the census cannot
//      count it — but deleting it deletes the obligation on the caller to hand the
//      rebase subagent a destination, which nothing else in either mirror states.
//      So it is deletion-guarded like any other clause and left out of the
//      equality instead of left out of the guard. Measured before this category
//      existed: deleting the clause from BOTH mirrors left the suite at exit 0,
//      24 anchors, nothing failing. The category cannot be used to smuggle a
//      countable clause out of the census: a `byReference` anchor that DOES spell
//      the warning raises `counted` while `anchors.length` stays put, so the
//      equality fails.
//      Because the census cannot count these clauses by their warning, they get a
//      census of their own — `PROSE_BY_REFERENCE`, keyed on the REFERENCE the way
//      the first is keyed on the WARNING — held to `byReference.length` by the
//      same equality. That closes the one door category 1 never had: DELETING the
//      `byReference` key while the clause still ships was exit 0, 24 prose
//      anchors, nothing failing, since no census reached the clause and the
//      anchors it declared went with the key. Both directions are now
//      symmetrical with category 1, and the residue is the same one: deleting the
//      clause from both mirrors AND its key here is two edits, which is the
//      shrinkage class the header states.
//   3. DELIBERATELY UNANCHORED restatements — a brief template that RESTATES an
//      already-anchored allocation by pointing back at it:
//      `address-tasks-serialized`'s "Any build or lint output that must land in a
//      file goes to `<validation-output path allocated above>`, never anywhere
//      else", twice per mirror. It names no destination of its own and carries no
//      warning phrase, by design. What separates it from category 2 is that it
//      imposes nothing: the rule it points at is anchored in the same file, in
//      both mirrors, so deleting the restatement cannot delete the rule. That is
//      why this shape is not guarded at all where category 2 is.
const PROSE_MIRRORS = ["plugins/dev-skills/skills", "codex/dev-skills/skills"];
// The warning every one of these clauses carries, and the census key. It is not
// the anchor: a clause could keep this phrase and lose its destination, which is
// exactly what the anchors are long enough to catch.
//
// It is an alternation of the SPELLINGS THAT SHIP rather than one phrase, which
// is the census's sharpest edge and was found by a clause slipping past it: the
// `review-cycle` Artifacts rule — the all-roles destination rule every consumer
// of the cycle inherits — writes "never a fixed shared filename: parallel cycles
// share one scratchpad", so a pattern keyed on "shared scratchpad name" counted
// it zero times and it shipped neither censused nor anchored. Deleting it left
// the suite green. A clause that spells the warning some third way is the same
// hole again, which is the "guarded against deletion, not discovered" asymmetry
// the header states, reaching one level further than it might read: it also
// bounds what the census DISCOVERS in a file it already guards. Widen this
// alternation when a clause arrives spelling it differently.
//
// The alternation stays narrow on purpose. The live canonical destination rules
// use the warning forms above: `review-cycle`'s Reviewer and Artifacts and
// hygiene rules say "fixed shared scratchpad name" and "fixed shared filename",
// while consumer-specific validation rules say "shared scratchpad filename".
// Matching generic shared-name vocabulary would also count `address-tasks`'
// unrelated filename/symbol collision rules, which task 045 leaves out of scope.
const PROSE_WARNING = /shared scratchpad (?:name|filename)|fixed shared filename/g;
// The second census key, for category 2, and it exists for the reason the
// category does: those clauses spell no warning, so `PROSE_WARNING` can never
// count one and the equality above holds at zero however many of them ship or
// leave. That left the `byReference` key itself unguarded — removing it took the
// clause's only guard away in one edit, at exit 0, since the anchors went with
// the key and no count noticed. So a by-reference clause is censused by what
// makes it one: the REFERENCE it delegates to, where category 1 is censused by
// the warning it spells. `byReference.length` is held to this count by the same
// equality, in the same place, so the category is now guarded in both directions.
//
// This buys the enforcement without a hand-written expected count per file: the
// number comes off the shipped mirrors, like the first census's. Its limits are
// the first census's too, and stated for the same reason — it is one alternative
// because one delegation ships, a clause delegating some other way is counted
// zero times and is the "guarded, not discovered" asymmetry again, so widen this
// pattern when one arrives. Narrowing it is not a quiet way out: a pattern that
// stops matching leaves `byReference` declaring a clause the census no longer
// finds, which fails the equality.
const PROSE_BY_REFERENCE = /under this cycle's artifact-directory rules/g;
const PROSE_CLAUSES = {
  "address-review": {
    anchors: [
      "hand it the path any build or check output must land in — namespaced by this PR number, or created with `mktemp -d`, and outside the checkout it commits from — never a fixed shared scratchpad name",
    ],
  },
  "address-reviews": {
    anchors: [
      "Any output that must land in a file goes inside this worktree (a gitignored path, removed before any commit), never a shared scratchpad filename",
    ],
  },
  "address-tasks": {
    // The implementer template, the reviewer's own rule, and the quoted brief
    // for the integration-check subagent, which validates from a worktree it
    // must leave clean and so is sent outside every worktree instead.
    anchors: [
      "Any build or check output that must land in a file goes inside this worktree (a gitignored path, removed before any commit), never a shared scratchpad filename",
      "any build or check output that must land in a file goes inside this task's worktree (a gitignored path, removed before any commit), never a shared scratchpad filename",
      "create a unique directory for it first with `mktemp -d`, outside every worktree, and write there — never a fixed shared scratchpad name",
    ],
  },
  // Both of these clauses state their destination in a PRECEDING sentence and
  // refer back to it as "there", so an anchor starting at "Any build or … output"
  // would span a pronoun rather than a destination: emptying the sentence that
  // defines it — leaving "goes there" pointing at nothing — kept both anchors
  // present and the census count unchanged. The anchors therefore begin at the
  // allocation sentence and run through the "goes there" continuation, which is
  // the whole instruction rather than the half that survives its own gutting.
  "address-tasks-serialized": {
    anchors: [
      "**An absolute path for validation output**, which you allocate — namespaced by this task's number or created with `mktemp -d`, and outside the working tree the implementer commits from. Any build or lint output that must land in a file goes there, never a fixed shared scratchpad name",
      "**An absolute path for validation output**, which you allocate — namespaced by this task's number or created with `mktemp -d`. Any build or check output that must land in a file goes there, never a fixed shared scratchpad name",
    ],
  },
  // The briefless spawn instruction: the rule sits in the skill text the
  // orchestrator itself follows, because there is no template to carry it.
  "reap-tasks": {
    anchors: [
      "Output that must land in a file goes to a path namespaced by the task number, or one created with `mktemp -d` — never a fixed shared scratchpad name",
    ],
  },
  "resolve-open-questions": {
    anchors: [
      "Hand it the path any of that output must land in — namespaced by the item, or created with `mktemp -d` — never a fixed shared scratchpad name",
      "Hand it the path any of that validation output must land in — namespaced by the item, or created with `mktemp -d`, and outside the worktree it commits from, which must be left clean — never a fixed shared scratchpad name",
    ],
  },
  // Two clauses: the Reviewer role's, which every consumer of the cycle reaches
  // through this one file, and the ALL-ROLES rule under `## Artifacts and
  // hygiene` that the Fixer contract points at rather than restating — the rule
  // the whole cycle's redirected output obeys, and the one this table missed
  // until the census pattern above was widened to its spelling.
  //
  // The second anchor spans three sentences because the clause does: the
  // destination is allocated in the first and the redirected output "goes there"
  // in the third, so an anchor starting at the third would span a pronoun rather
  // than a destination — the failure two anchors above this one already
  // demonstrated. Continuity then carries the middle sentence along, which is
  // part of allocating the directory (a slug's `/` splits the path), so the cost
  // is that rewording it means editing this anchor. That is the pins' cost
  // everywhere in this suite, taken knowingly.
  "review-cycle": {
    anchors: [
      "tell it where any output of that build goes, a path under the cycle's artifact directory below or inside the reviewed worktree, never a fixed shared scratchpad name and never left to the reviewer to pick",
      "Every cycle uses its own unique artifact directory outside the worktree — suffix the cycle slug, reduced first to a single path segment, or create it with `mktemp -d` — never a fixed shared filename: parallel cycles share one scratchpad, and fixed names have crossed review streams between concurrent runs before.\n" +
        "A slug is routinely a branch name, and the `/` in one splits the suffix into a parent directory: `mktemp` refuses that outright, and a `mkdir -p` path takes it silently, nesting the round history where nobody will look for it.\n" +
        "The full round history (reviewer reports, peer output, fixer packets) lives there, as does any build or validation output a role redirects to a file",
    ],
    // Category 2, the by-reference requirement: `## The delegated rebase step`
    // obliges the brief to carry a destination and delegates WHICH destination to
    // the artifact-directory rule anchored just above. The anchor starts at
    // "carries that absolute path" so it spans the obligation rather than the
    // trailing reference alone, which a sentence could keep while dropping what it
    // is a list of. It arrived with task 016 rather than 017 and shipped
    // unguarded, which is what made this category necessary.
    byReference: [
      "so the brief carries that absolute path, the branch, the pinned base below, and a destination for any build output under this cycle's artifact-directory rules",
    ],
  },
};

// Every table this suite declares by hand drives a check that an EMPTY table
// switches OFF rather than breaks, and the header enumerates all of them. These
// two are the ones nothing else would notice: an emptied `REQUIRED` reported
// "all 0 clauses" per boundary constant as a pass, and an emptied
// `PROSE_MIRRORS` reported "0 prose destination clauses deletion-guarded" as
// one. The rest fail on their own — an empty `CUT` leaves every shipped workflow
// unlisted, an empty `PROSE_CLAUSES` leaves every censused clause undeclared —
// so they are not restated here.
const emptyTables = [
  ["REQUIRED", REQUIRED],
  ["PROSE_MIRRORS", PROSE_MIRRORS],
  ["BESPOKE_DESTINATIONS", BESPOKE_DESTINATIONS],
].filter(([, table]) => !table.length);
// An emptied span in that last table is the same vacuum one step down: the
// cross-check drops it (an empty span is contained in every string, so keeping it
// would report every NO_BUILD render as carrying it) and would then search for
// one clause fewer in silence. Reported here, once, for the same reason an
// emptied destination constant is.
const blankSpans = BESPOKE_DESTINATIONS.filter(([, span]) => !span).map(([name]) => name);
if (emptyTables.length || blankSpans.length) {
  failures++;
  const why = [
    emptyTables.length ? `${emptyTables.map(([n]) => n).join(", ")} empty — an empty table asserts nothing for every check built on it` : "",
    blankSpans.length ? `BESPOKE_DESTINATIONS holds an empty span for ${blankSpans.join(", ")} — the cross-check silently searches for one clause fewer` : "",
  ]
    .filter(Boolean)
    .join("; ");
  rows.push(["(all)", "declared tables", "FAIL", why]);
} else {
  rows.push(["(all)", "declared tables", "ok", `REQUIRED ${REQUIRED.length} clauses, PROSE_MIRRORS ${PROSE_MIRRORS.length} mirrors, BESPOKE_DESTINATIONS ${BESPOKE_DESTINATIONS.length} clauses`]);
}

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
    // Two counts per file, one per censused category: the warning-carrying
    // clauses and the by-reference ones. A file is in the census when it carries
    // either, so a by-reference clause arriving in a file this table does not
    // name fails as undeclared exactly as a warning-carrying one does.
    const counted = (text.match(PROSE_WARNING) || []).length;
    const byRefCounted = (text.match(PROSE_BY_REFERENCE) || []).length;
    if (counted || byRefCounted) census.set(skill, { counted, byRefCounted });
  }
  const undeclared = [...census.keys()].filter((skill) => !PROSE_CLAUSES[skill]);
  if (undeclared.length) {
    failures++;
    rows.push([mirror, "prose census", "FAIL", `carries a destination clause but is not guarded: ${undeclared.join(", ")} — add its anchor(s)`]);
  } else {
    rows.push([mirror, "prose census", "ok", `${census.size} skills carry destination clauses, all guarded`]);
  }
  for (const [skill, entry] of Object.entries(PROSE_CLAUSES)) {
    const path = `${mirror}/${skill}/SKILL.md`;
    let text;
    try {
      text = readFileSync(join(dir, skill, "SKILL.md"), "utf8");
    } catch (err) {
      failures++;
      rows.push([path, "prose destination", "FAIL", `cannot read: ${err.message}`]);
      continue;
    }
    // Category 1 is what the census equality is stated over; category 2 is
    // deletion-guarded on the same terms and excluded from that count, because it
    // carries no warning for the census to have counted. Both are anchored, so
    // both are checked present exactly once and both count toward the tally.
    // `entry.anchors || []` because an OMITTED `anchors` key is the same claim as
    // an empty one — the file's only guarded clause carries no warning — and the
    // header offers that shape as legitimate. Reading it bare crashed on
    // `TypeError: anchors is not iterable` before any table was printed, which is
    // not what "legitimate" reads as anywhere else in this suite.
    const anchors = entry.anchors || [];
    const byReference = entry.byReference || [];
    const guarded = [...anchors, ...byReference];
    const wrong = guarded.map((anchor) => [anchor, text.split(anchor).length - 1]).filter(([, n]) => n !== 1);
    const { counted = 0, byRefCounted = 0 } = census.get(skill) || {};
    // A skill listed here with no anchors of either kind claims to be guarded and
    // asserts nothing — the same vacuum an empty pin list is on the rendered side
    // — and an empty anchor is that vacuum one step down, since every file
    // contains one. The census would catch a clause arriving in the file, but an
    // entry whose anchors were all removed alongside its clauses leaves a
    // guarded-looking key that no longer guards anything. Drop the key instead.
    //
    // A `byReference` key PRESENT and EMPTY is its own vacuum and the quieter one,
    // measured on this check the day it was written: `anchors` and the warning
    // census both still held, so the by-reference clause silently lost its only
    // guard and the run passed. Writing the key is the claim; an ABSENT key says
    // the file has no such clause — the ordinary shape, and no failure IN ITSELF,
    // though the by-reference census below now decides whether the file agrees:
    // absent while such a clause ships fails the equality, which is what closed
    // the last edit in this table that removed a guard for free. An `anchors` key
    // empty or omitted beside a non-empty `byReference` is legitimate too — it
    // says the file's only guarded clause carries no warning, and the warning
    // equality then holds at zero.
    const vacuous = !guarded.length
      ? "listed with no anchors of either kind — an entry asserting nothing; remove the key or give it its clause(s)"
      : guarded.some((anchor) => !anchor)
        ? "holds an empty anchor — every file contains one, so it guards nothing"
        : entry.byReference && !entry.byReference.length
          ? "declares a `byReference` category and puts no anchor in it — an empty list guards nothing; drop the key or anchor the clause"
          : "";
    if (vacuous) {
      failures++;
      rows.push([path, "prose destination", "FAIL", vacuous]);
    } else if (wrong.length) {
      failures++;
      const [anchor, n] = wrong[0];
      rows.push([path, "prose destination", "FAIL", `${wrong.length} of ${guarded.length} anchor(s) not present exactly once; first found ${n}x: ${JSON.stringify(anchor.slice(0, 70))}…`]);
    } else if (counted !== anchors.length) {
      failures++;
      rows.push([path, "prose destination", "FAIL", `${counted} warning-carrying destination clause(s) in the file but ${anchors.length} anchored — a clause arrived or left; update the anchors`]);
    } else if (byRefCounted !== byReference.length) {
      failures++;
      rows.push([path, "prose destination", "FAIL", `${byRefCounted} by-reference destination clause(s) in the file but ${byReference.length} anchored — a clause arrived, left, lost its \`byReference\` key, or was reworded past \`PROSE_BY_REFERENCE\`; update the anchors or the pattern`]);
    } else {
      proseAnchors += guarded.length;
      const also = byReference.length ? ` + ${byReference.length} by-reference` : "";
      rows.push([path, "prose destination", "ok", `${anchors.length} clause(s) anchored${also}, ${counted} counted in the file${byRefCounted ? ` + ${byRefCounted} by reference` : ""}`]);
    }
  }
}

report();
