#!/usr/bin/env node
// Focused behavior test for `wf-address-review.js`'s BRANCH RECONCILIATION GATE
// — the script-side control flow that decides, before anything is addressed,
// whether this run may act on the checked-out branch at all (task 021b).
//
// Three properties hold the gate up, and each is a separate way to lose it:
//
//   1. The OFF-SHOOT EXEMPTION. Reconciliation is keyed on the two BRANCH
//      NAMES: only a run whose checked-out branch IS the PR's head ref
//      reconciles. Where they differ the supported local off-shoot of a
//      merge-pending PR is in play, "behind the PR head" is that case's normal
//      state, and the run proceeds whatever the gather reported.
//   2. FAILING CLOSED. On the PR's own branch, only `work` and
//      `fast-forwarded` let the run continue. Everything else stops it —
//      `unrecognized`, an outcome string this script does not know, an empty
//      one, an absent report, and `not-applicable` (which on THIS branch is a
//      contradiction, not an exemption: keying the gate on the outcome instead
//      of the names would let a misreporting agent bypass reconciliation).
//   3. The ORDER relative to the empty-`items` no-op. The rule's third outcome
//      returns NO items by contract, so a gate placed after the no-op would
//      report an unreconciled branch as "nothing to address" — the silent
//      wrong answer, and the one a reader of the result cannot tell from a
//      genuinely clean PR.
//
// The workflows are runtime scripts (top-level await/return, injected
// `agent`/`workflow`/`phase`/`log` globals), so they cannot be imported. This
// evaluates the ACTUAL shipped source — no second copy of the gate — with those
// globals stubbed, and drives scripted gather packets through it, reading the
// result the script returns. The nested review cycle is the "the run proceeded"
// signal: reaching `workflow("wf-review-cycle", ...)` at all means the gate let
// this run through.
//
// The gate is only the CONSUMER of `packet.reconcile`. The producer is a
// paragraph of the gather brief, which no scenario reaches because the gather
// agent is stubbed — so the RULE it states is read out of the rendered brief
// directly: both probes, the head they compare against, the off-shoot skip, and
// the outcome strings, whose agreement with the strings the gate keys on
// nothing else pins.
//
// It also covers the publication guard that landed beside the gate, which is
// prompt prose rather than script logic: a HEAD that is a proper ancestor of
// the PR head must stop the publisher BEFORE the lease it would otherwise
// match and rewind the branch with.
//
// It covers the DELEGATED REBASE POINTS that run just after the gate (task
// 016), for the same reason and through the same harness: the base each one
// pins is what every later delegation's diff range is taken against, so the
// caller must reject anything but a commit, and a conflict the step cannot judge
// must stop the run with its question rather than being guessed at. Its own
// producer half — the brief that makes the agent resolve and pin a commit at all
// — is read out of the rendered text like the gather brief's.
//
// And it covers the sibling gate that runs just ahead of this one (task 018):
// the WORKING LOCATION, which decides not whether the run may act on the branch
// but in which tree it acts. Both gates are the same shape — a gather-reported
// field the caller must not read charitably — and both fail closed, so they are
// driven through the same harness rather than a second copy of it. Two things
// hang off that location and are pinned beside it: a HALT keeps the worktree
// (bar the fork arm's rejected landing, below), so the blocker exit — which
// runs before the pair is even validated — has to name the surviving path, and
// the brief has to oblige a blocker packet to carry it; and the three
// helper-free attach arms each fail as written if they lose a clause (a
// pathless `git worktree add --detach`, an add that never reads the live
// registration a halted run left behind, an arm order that lets a prior fork
// run's leftover local branch claim the re-run, a landing verification that
// states no consequence, or one whose consequence keeps a tree the re-run would
// then stop on forever), which no scenario can observe because the gather agent
// is stubbed.
//
// Run: node scripts/test-address-review-reconcile.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const workflows = join(here, "..", "plugins", "dev-skills", "workflows");
const SOURCE = "wf-address-review.js";

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

// How many checks this suite must run. Read BEFORE the assertion itself, so it
// does not count: that final `check(...)` evaluates `ran === EXPECTED_CHECKS`
// as an argument, ahead of its own `ran++`. So this number is one LESS than the
// `check(` call sites in the file, by construction — counting the sites reads
// one too many and is not a way to audit it. Bump it deliberately when adding
// or removing a check — a scenario that silently stops running is invisible to
// a suite that only gates on failures.
const EXPECTED_CHECKS = 61;

const src = readFileSync(join(workflows, SOURCE), "utf8");
// The runtime requires `export const meta` as the first statement, which is
// module syntax; a function body is not a module. Dropping the `export` is the
// only edit made to the shipped text.
const body = src.replace(/^export const meta/m, "const meta");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
// eslint-disable-next-line no-new-func
const script = new AsyncFunction(
  "args",
  "agent",
  "phase",
  "workflow",
  "parallel",
  "pipeline",
  "log",
  `"use strict";\n${body}`,
);

// The prompt builders are plain functions in the DECLARATION PREFIX — the text
// above the first statement that touches an injected global — so they can be
// evaluated on their own and rendered without driving a scenario. Both halves
// of the reconciliation are read that way: the rule the gather brief states,
// and the publication guard beside it.
const cut = src.indexOf("\nconst raw = flattenArgs(args);");
if (cut < 0) throw new Error(`${SOURCE}: cut marker not found for the declaration prefix`);
const prefix = src.slice(0, cut).replace(/^export const meta/m, "const meta");
// eslint-disable-next-line no-new-func
const { gatherPrompt, publishPrompt, rebasePrompt } = new Function(
  "args",
  `"use strict";\n${prefix}\nreturn { gatherPrompt, publishPrompt, rebasePrompt };`,
)("");

// Reaching the nested cycle ends the scenario: everything past the gate is
// another workflow's business. Thrown rather than returned so "the run
// proceeded" cannot be confused with any status the script itself returns.
const REACHED_CYCLE = Symbol("nested review cycle reached");

// A clean pre-fix rebase: it replayed nothing and pinned the base to a commit.
// This is the default because it is the common outcome, and because every
// scenario written before the rebase points existed must keep meaning what it
// meant — the gates under test are ahead of the rebase or indifferent to it.
const REBASE_NOOP = {
  ok: true,
  halted: false,
  noop: true,
  effectiveBase: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
  before: "cafebabe",
  after: "cafebabe",
  validationPassed: true,
  detail: "already on the pinned base; nothing replayed",
};

// Run the shipped script with one scripted gather packet. `no-push` keeps the
// run local-only by default: the gate is flag-independent, and a publish path
// would need stubs for work this suite is not about. `opts.args` overrides the
// request, which two gates beside it need: whether a working branch other than
// the PR head ref was ever selected is read from the request rather than the
// packet, and the rebase opt-out needs its own token. `opts.rebase` scripts
// what the delegated rebase agent reports back.
async function run(packet, opts = {}) {
  const seen = { agentLabels: [], cycleOpts: null, rebasePrompts: [] };
  const agent = async (prompt, aopts) => {
    const label = (aopts && aopts.label) || "";
    seen.agentLabels.push(label);
    if (label === "gather") return packet;
    if (label.startsWith("rebase-")) {
      seen.rebasePrompts.push(prompt);
      return opts.rebase === undefined ? REBASE_NOOP : opts.rebase;
    }
    throw new Error(`unexpected agent call past the gate: ${label}`);
  };
  const workflow = async (name, opts) => {
    seen.cycleOpts = { name, opts };
    throw REACHED_CYCLE;
  };
  const nope = () => {
    throw new Error("unexpected fan-out call");
  };
  try {
    const result = await script(opts.args === undefined ? "no-push" : opts.args, agent, () => {}, workflow, nope, nope, () => {});
    return { status: (result && (result.status || (result.error ? "error" : "?"))) || "?", result, seen };
  } catch (err) {
    if (err === REACHED_CYCLE) return { status: "reached-cycle", result: null, seen };
    throw err;
  }
}

// One gathered item, in `PACKET_SCHEMA`'s `items` shape — `type`/`body` and the
// required `author`/`authorIsBot`, not a shorthand of this suite's own. Nothing
// past the gate reads an item here (the nested cycle is stubbed), but the first
// thing that would routes on `type`, so the fixture states the real shape.
const ITEM = {
  type: "review-thread",
  threadId: "T1",
  commentId: "C1",
  author: "a-reviewer",
  authorIsBot: false,
  body: "a finding",
  url: "https://example.invalid/pr/42#d1",
};
// A gather packet in the shape the schema requires. `reconcile` is spread in
// last so a scenario can omit it entirely — the absent-report case. The
// location pair is written the same way: `locationMode` defaults to the inline
// mode every reconciliation scenario runs in, and passing `null` omits the
// field, which the working-location gate below rejects.
function gathered({ workingBranch = "feature/x", items = [], reconcile, locationMode = "inline", worktree }) {
  const packet = {
    ok: true,
    pr: {
      number: 42,
      url: "https://example.invalid/pr/42",
      branch: "feature/x",
      workingBranch,
      base: "main",
      headOid: "deadbeef",
      rebased: false,
    },
    items,
  };
  if (locationMode !== null) packet.pr.locationMode = locationMode;
  if (worktree !== undefined) packet.pr.worktree = worktree;
  if (reconcile !== undefined) packet.reconcile = reconcile;
  return packet;
}

// --- The working-location gate ----------------------------------------------
// The other script-side gate ahead of all work (task 018): which tree this run
// acts in. It is the gather agent's choice, and the caller validates the pair
// rather than trusting it at each use, because BOTH ways of getting it wrong
// send later phases somewhere they must not go. There is deliberately no
// default: reading an absent mode as `inline` looks safe (it asserts no path)
// and is not — a gather that attached a worktree and failed to report it would
// hand the cycle the empty string, i.e. the main checkout, which in that mode
// is not on the PR branch at all.
{
  const absent = await run(gathered({ locationMode: null, reconcile: { outcome: "work" }, items: [ITEM] }));
  check(
    "an absent locationMode stops the run and names the field",
    absent.status === "error" && /locationMode/.test((absent.result || {}).error || ""),
    JSON.stringify(absent.result),
  );
  const unknown = await run(gathered({ locationMode: "checkout", reconcile: { outcome: "work" }, items: [ITEM] }));
  check("an unrecognized locationMode stops the run", unknown.status === "error", JSON.stringify(unknown.result));
  const pathless = await run(gathered({ locationMode: "worktree", reconcile: { outcome: "work" }, items: [ITEM] }));
  check(
    "worktree mode with no absolute path stops the run rather than using the main checkout",
    pathless.status === "error" && /worktree/.test((pathless.result || {}).error || ""),
    JSON.stringify(pathless.result),
  );
  const contradictory = await run(gathered({ locationMode: "inline", worktree: "/w/.worktrees/c/pr-42", reconcile: { outcome: "work" }, items: [ITEM] }));
  check("inline mode carrying a worktree path stops the run — one of the two is wrong", contradictory.status === "error", JSON.stringify(contradictory.result));
  const wt = await run(gathered({ locationMode: "worktree", worktree: "/w/.worktrees/c/pr-42", reconcile: { outcome: "work" }, items: [ITEM] }));
  check("worktree mode with an absolute path proceeds to the nested cycle", wt.status === "reached-cycle", wt.status);
  const inline = await run(gathered({ reconcile: { outcome: "work" }, items: [ITEM] }));
  check(
    "and hands the cycle that worktree, where an inline run hands it the empty string (this checkout)",
    wt.seen.cycleOpts && wt.seen.cycleOpts.opts.worktree === "/w/.worktrees/c/pr-42" &&
      inline.seen.cycleOpts && inline.seen.cycleOpts.opts.worktree === "",
    JSON.stringify({
      worktreeRun: wt.seen.cycleOpts && wt.seen.cycleOpts.opts && wt.seen.cycleOpts.opts.worktree,
      inlineRun: inline.seen.cycleOpts && inline.seen.cycleOpts.opts && inline.seen.cycleOpts.opts.worktree,
    }),
  );
}

// --- What a HALTED run hands back: the worktree it left standing -------------
// The reclaim step runs only where the run FINISHED; halting is what KEEPS the
// tree (the fork arm's rejected landing hands its own back, inside the gather
// and before this exit ever sees a path), so a blocker raised after the attach
// is the one exit that must name the surviving path. It is also the exit that runs BEFORE the location pair is
// validated — the gather stopped, so there may be no usable pair at all — which
// is what makes this a property of its own rather than a corollary of the gate:
// the path is read defensively and surfaced in the `note` a maintainer reads
// first, not left to be dug out of the echoed `pr` object.
{
  const blockedPr = {
    number: 42,
    url: "https://example.invalid/pr/42",
    branch: "feature/x",
    workingBranch: "feature/x",
    base: "main",
    headOid: "deadbeef",
    locationMode: "worktree",
    worktree: "/w/.worktrees/c/pr-42",
  };
  const blocked = await run({ ok: false, blocker: "the reused worktree is mid-cherry-pick", pr: blockedPr, items: [] });
  const br = blocked.result || {};
  check(
    "a blocker raised after the attach names the surviving worktree where a maintainer reads it first",
    blocked.status === "error" && /\/w\/\.worktrees\/c\/pr-42/.test(br.note || "") && /still standing/.test(br.note || ""),
    JSON.stringify(br),
  );
  check(
    "and nothing reclaims it or runs past the gather",
    blocked.seen.agentLabels.join(",") === "gather" && blocked.seen.cycleOpts === null,
    JSON.stringify(blocked.seen),
  );
  // The other direction: a run that never attached anything has no path to
  // report, and reporting one would send the maintainer to a tree that does not
  // exist.
  const early = await run({ ok: false, blocker: "gh auth status failed", items: [] });
  check(
    "a blocker raised before any attach reports no worktree rather than inventing one",
    early.status === "error" && !("note" in (early.result || {})),
    JSON.stringify(early.result),
  );
}

// --- The producer half: how the working location is chosen -------------------
// The gate above validates the pair the gather agent REPORTED. What lets that
// report say `workingBranch != branch` at all is the gather brief's case list,
// which no scenario reaches because the gather agent is stubbed — so it is read
// out of the rendered brief: working on a branch that is NOT the PR head ref is
// reachable ONLY by the request naming it with `off-shoot`. Two review rounds
// tried to infer that case from the shape of the history instead; "already
// CARRIES the PR head" was the last such predicate, and it rejected the very
// case it was written for (an off-shoot cut BEFORE the head and advanced carries
// no head) while still admitting a stacked child that has not been PR'd. Both
// halves are pinned here: the token has to be the route, and that predicate must
// not come back.
{
  const brief = gatherPrompt("#42");
  const cases = brief.split("\n\n").find((p) => p.includes("take the FIRST case that applies")) || "";
  const tokenRoutes = /`off-shoot` token/.test(cases) && /NOTHING BUT THE TOKEN/.test(cases);
  const inferredFromShape = /CARRIES the PR head/.test(brief);
  check(
    "the off-shoot working location is selected by the `off-shoot` token, never inferred from the branch's shape",
    tokenRoutes && !inferredFromShape,
    `token route stated: ${tokenRoutes}; carries-the-head predicate present: ${inferredFromShape}`,
  );
  // The one check that survives beside the token is a stop for AMBIGUITY — the
  // named branch is also another open PR's head — and it has to answer exactly
  // that question and no neighbouring one. Two neighbouring ones are what a
  // base-repository PR LIST answers instead: `gh pr list --head <branch>` reads
  // one base repository (a PR based in another is simply absent), matches a bare
  // branch NAME (its own `--help` refuses `<owner>:<branch>`, so a fork's
  // same-named head answers for a branch it has nothing to do with), and stops
  // at 30 items. Filtering its rows back down to the right question took a
  // repository-qualified comparison whose components each had to be pinned
  // separately here, and it still could not recover the rows the list never
  // returned.
  //
  // So the probe is ROOTED at the head instead — the head repository's own ref,
  // which is what the question is about — and the pins follow that root. Every
  // open PR whose head IS that ref comes back whatever repository its base is
  // in, and nothing else does, which is why one filter now does what two could
  // not: exclude the PR being addressed by its `url`, since where the branch IS
  // that PR's head the query answers with the very PR under work and an
  // unqualified stop would halt an ordinary target-branch run on a token that is
  // merely redundant there.
  //
  // Three things hold that root up and each is a separate way to lose it: the
  // query shape (a `ref(qualifiedName:...)` carrying `associatedPullRequests`,
  // not a PR list), the ref it is rooted AT (this branch's own resolved push
  // remote/ref — without which the query names no ref at all), and the standing
  // refusal of the list form, which is what a later round would otherwise
  // restore as the obvious simplification.
  // Which PR is "a DIFFERENT one" has to be asked of a GLOBALLY unique
  // identifier, and the number is not one: a PR number is scoped to that PR's
  // own BASE repository, while this answer set spans base repositories by
  // construction — which is the entire reach the query root was widened for. So
  // an addressed #71 and a conflicting #71 based elsewhere compare EQUAL, and
  // the number filter discards precisely the case the widening reached. The
  // query already asks for `url`; both halves are pinned, the comparison and
  // the standing refusal of the number, because "just compare the number" is
  // what a later round restores as the obvious simplification.
  const excludesAddressedPr = /count a hit only where the PR's `url` DIFFERS from the resolved PR's own `url`/.test(cases);
  const refusesTheNumberComparison = /Compare the `url` and never the `number`/.test(cases);
  const rootsAtTheHeadRef = /ref\(qualifiedName:"refs\/heads\/<ref>"\)\{ associatedPullRequests\(states:OPEN/.test(cases);
  const resolvesThatRefFromPushTarget = /resolve `C`'s own push remote\/ref/.test(cases);
  const refusesTheListForm = /`gh pr list --head` delivers neither half/.test(cases);
  // `isCrossRepository` was named here as a cheap short-circuit until it was
  // found to license skipping the very comparison it stood in front of: the
  // field says whether the OTHER PR's own head and base repositories differ,
  // which is not the question asked. The query root now settles whose head it
  // is, so the field is not merely unqualified but has nothing left to answer —
  // and the refusal stays, because what invites it back is the same look of a
  // cheap answer that got it added the first time.
  const refusesShortCircuit = /`isCrossRepository` has no part in this and is not requested/.test(cases);
  check(
    "the conflicting-PR stop excludes the PR being addressed by its globally unique `url` — never by a base-scoped number — and asks the head repository's own ref which open PRs it heads, refusing the base-scoped PR list and any short-circuit of it",
    excludesAddressedPr && refusesTheNumberComparison && rootsAtTheHeadRef && resolvesThatRefFromPushTarget && refusesTheListForm && refusesShortCircuit,
    `url-identity filter stated: ${excludesAddressedPr}; number comparison refused: ${refusesTheNumberComparison}; rooted at the head ref: ${rootsAtTheHeadRef}; that ref resolved from this branch's push target: ${resolvesThatRefFromPushTarget}; base-scoped list form refused: ${refusesTheListForm}; short-circuit refused: ${refusesShortCircuit}`,
  );
  // Forced `inline` checks the target branch out in THIS checkout, and the
  // branch it checks out may already be there: a maintainer who has worked this
  // PR before still has a local `T` lying around, which is an ordinary place to
  // force the mode from. A create is not a checkout — `git checkout -b` and
  // `git switch -c` REFUSE a branch that already exists — so an unconditional
  // "create a local tracking branch" fails that run at setup, before the
  // supported mode is entered at all. Case 4's worktree arms already split
  // EXISTS from NONE; nothing but this text makes case 2 split it too.
  const inlineCase = cases.split("\n").find((l) => l.startsWith("2. ")) || "";
  if (!inlineCase) throw new Error(`${SOURCE}: forced-inline case not found; its checkout rule cannot be read`);
  const reusesExistingT = /where one EXISTS/.test(inlineCase);
  const createsOnlyWhenAbsent = /only where NONE/.test(inlineCase);
  check(
    "forced `inline` checks out an existing local `T` and creates one only where none exists",
    reusesExistingT && createsOnlyWhenAbsent,
    `reuse arm stated: ${reusesExistingT}; create conditioned on absence: ${createsOnlyWhenAbsent}`,
  );
  // Four clauses in the same case list, each of which the worktree case fails as
  // written without — and none of the failures is visible to the gate above,
  // which only ever sees what the gather REPORTED.
  //
  // `git worktree add` takes its path as a mandatory argument
  // (`git worktree add … <path> [<commit-ish>]`), so the fork arm's `--detach`
  // form needs one too: pathless, the command fails before `gh pr checkout` is
  // reached and the default worktree mode never runs for a fork PR at all.
  check(
    "the fork attach's detached add carries the worktree path",
    /git worktree add --detach "<worktree base>\/pr-<N>"/.test(cases),
    cases.includes("--detach") ? "the `--detach` add is present but pathless" : "no `--detach` add found",
  );
  // And `git worktree prune` clears STALE registrations only, so the LIVE one a
  // halted run left is exactly what survives it — which is the run this stable
  // slug exists to resume. Without a reuse arm the helper-free fallback's add
  // fails on an occupied path, so the documented resume works only where the
  // optional helper exists. The read is asserted to precede the ARMS rather than
  // to appear anywhere in the case, because scoping it to one arm is how this
  // was lost before: the fork arm is always helper-free and uses the same stable
  // path, so a read stated only for the local-`T` arms leaves the one attach
  // with no helper alternative unable to resume at all.
  // Scoping means nothing if the anchor can vanish: `indexOf` answers -1 for an
  // absent marker and `slice(0, -1)` would then hand every assertion below the
  // WHOLE case block, degrading this into the "appears somewhere" check it
  // exists to replace. Fail closed on the marker, as the declaration-prefix cut
  // above does.
  const armsAt = cases.indexOf("take the FIRST of these three arms");
  if (armsAt < 0) throw new Error(`${SOURCE}: arm-list marker not found; the registration read cannot be scoped ahead of the arms`);
  const registrationRule = cases.slice(0, armsAt);
  const readsRegistrations = /git worktree list/.test(registrationRule);
  const coversEveryArm = /any of the three arms below/.test(registrationRule);
  const reusesMatch = /REUSE it/.test(registrationRule);
  const stopsOnMismatch = /registered on anything ELSE/.test(registrationRule);
  check(
    "the registration read precedes every attach arm, reuses a `pr-<N>` tree already on the head ref, and stops on any other",
    readsRegistrations && coversEveryArm && reusesMatch && stopsOnMismatch,
    `reads registrations ahead of the arms: ${readsRegistrations}; scoped to every arm: ${coversEveryArm}; reuse arm: ${reusesMatch}; mismatch stop: ${stopsOnMismatch}`,
  );
  // The base every arm adds under has to be IGNORED, and this case is the only
  // thing that makes it so: `git worktree add` excludes nothing on its own and
  // neither does `wt-enter`, so in a repository not already carrying the rule
  // the nested add leaves `?? .worktrees/` in the main checkout — the one tree
  // this case promises never to dirty — and a halt, which is precisely what
  // KEEPS the worktree, leaves it standing. Pinned ahead of the arms for the
  // same reason the registration read is: stated inside one arm it would exempt
  // the other two, and the fork arm is always helper-free. Both halves are read,
  // because the probe without the write is a check nothing acts on: the
  // `check-ignore` probe, and the untracked repo-local exclude file it appends
  // to rather than the tracked `.gitignore`, which is the maintainer's.
  // Three shapes fail silently here and each is worth naming. The probe carries
  // a TRAILING SLASH because `/.worktrees/` is a directory-only rule and `git
  // check-ignore` answers NO for a bare `.worktrees` that is not on disk yet —
  // which is every first run, so the slashless form only ever agrees by
  // accident of ordering, and a re-probe after the append would fail outright.
  // The exclude file is asked of GIT rather than spelled `.git/info/exclude`,
  // because this checkout may itself be a linked worktree — as the run that
  // wrote this one was — where `.git` is a gitfile, `.git/info` is not a
  // directory, and the literal append fails before the base is ever protected.
  // And that question is asked from inside `<repo>`, because the answer is
  // CWD-relative where the neighbouring probe's `<repo>/…` placeholder is
  // absolute: in a primary checkout `--git-path` prints the relative
  // `.git/info/exclude` (a linked worktree gets an absolute path), so an agent
  // that runs it as `git -C <repo> …` and appends from its own directory writes
  // the rule to a file `check-ignore` never reads.
  const probesTheIgnoreRule = /git check-ignore -q "<repo>\/\.worktrees\/"/.test(registrationRule);
  const resolvesTheExcludeThroughGit =
    /append `\/\.worktrees\/` to the file `git rev-parse --git-path info\/exclude` names/.test(registrationRule) &&
    /rather than writing a literal `\.git\/info\/exclude`/.test(registrationRule) &&
    /NOT the tracked/.test(registrationRule);
  const resolvesItFromInsideTheRepo = /run (?:it )?from inside `<repo>`[\s\S]*?RELATIVE/.test(registrationRule);
  check(
    "the worktree base is made ignored before any arm adds under it, probed as a directory and appended to the exclude file Git itself names — resolved from inside `<repo>`, never a literal `.git/info/exclude` and never the tracked `.gitignore`",
    probesTheIgnoreRule && resolvesTheExcludeThroughGit && resolvesItFromInsideTheRepo,
    `ignore rule probed as a directory: ${probesTheIgnoreRule}; exclude resolved through git instead of a literal path or .gitignore: ${resolvesTheExcludeThroughGit}; resolved from inside the repo, the answer being CWD-relative: ${resolvesItFromInsideTheRepo}`,
  );
  // Arm ORDER is a contract in its own right, and prose has to settle it: a
  // prior fork run's `gh pr checkout` leaves a same-named local `T` behind, so
  // on the re-run both "a local `T` EXISTS" and "the head is a fork" describe
  // the tree, and the local arm would attach that leftover with no fork remote
  // wired up. The fork arm therefore has to be named as taking precedence, not
  // merely listed alongside.
  const forkFirst = /FORK head takes the first arm, ahead of both local-`T` arms/.test(cases);
  check(
    "the fork arm is stated to take precedence over the local-`T` arms",
    forkFirst,
    forkFirst ? "" : "the fork arm's precedence over the local-`T` arms is unstated",
  );
  // And the landing verification has to say what a FAILURE does. The identity
  // check runs before any checkout, so it cannot see a collision `gh`'s own
  // branch selection creates; a verification with no consequence leaves that
  // case to whatever the agent invents.
  const forkMismatchStops = /verification FAILS[\s\S]*?ok: false[\s\S]*?attach nothing further and substitute nothing/.test(cases);
  check(
    "a failed fork landing verification is a blocker that attaches and substitutes nothing",
    forkMismatchStops,
    forkMismatchStops ? "" : "the fork arm verifies the landing but states no consequence for a mismatch",
  );
  // And that consequence has to GIVE THE TREE BACK, which is the one thing the
  // rest of this case cannot recover from: the halt leaves `pr-<N>` detached or
  // on the rejected ref, and the registration read above then stops every
  // re-run on "registered on anything ELSE" — never a second slug and never a
  // removal — so the slug stays blocked even once the maintainer has fixed the
  // collision. `address-reviews` states the same give-back for the same
  // failure, and this arm is the one place a divergence would be invisible.
  const forkMismatchGivesTreeBack = /verification FAILS[\s\S]*?wt-remove pr-<N>[\s\S]*?git worktree remove/.test(cases);
  check(
    "and it hands that worktree back, so the rejected ref does not block the stable slug on every re-run",
    forkMismatchGivesTreeBack,
    forkMismatchGivesTreeBack ? "" : "the fork arm's failure path states no give-back, leaving `pr-<N>` occupied by the rejected landing",
  );
  // The location pair rides in `pr`, which is otherwise owed only on success —
  // so the packet that could silently omit the path is precisely the halt that
  // KEEPS the worktree standing. The consumer half is pinned above.
  const report = brief.split("\n\n").find((p) => p.includes("Report the choice as")) || "";
  check(
    "and a blocker packet raised after the attach still owes the location pair",
    /owed on a BLOCKER too/.test(report) && /pr\.worktree/.test(report),
    report,
  );
}

// --- On the PR's own branch: the two outcomes that let a run continue -------
{
  const clean = await run(gathered({ reconcile: { outcome: "work" } }));
  check("same-branch `work` with no threads is a plain no-op", clean.status === "no-op", JSON.stringify(clean.result));
  const working = await run(gathered({ reconcile: { outcome: "work" }, items: [ITEM] }));
  check("same-branch `work` with threads proceeds to the nested cycle", working.status === "reached-cycle", working.status);
  check(
    "and hands the cycle the checked-out branch",
    working.seen.cycleOpts && working.seen.cycleOpts.name === "wf-review-cycle" && working.seen.cycleOpts.opts.branch === "feature/x",
    JSON.stringify(working.seen.cycleOpts && working.seen.cycleOpts.opts && working.seen.cycleOpts.opts.branch),
  );
  const ffClean = await run(gathered({ reconcile: { outcome: "fast-forwarded" } }));
  check("same-branch `fast-forwarded` with no threads is a plain no-op", ffClean.status === "no-op", JSON.stringify(ffClean.result));
  // A no-op that had nothing to address may still have MOVED the branch, which
  // is the one outcome a reader cannot infer from "nothing to address".
  check(
    "and that no-op still names the reconciliation and carries its record",
    /fast-forwarded/.test((ffClean.result || {}).detail || "") &&
      ((ffClean.result || {}).reconcile || {}).outcome === "fast-forwarded",
    JSON.stringify(ffClean.result),
  );
  const ffWorking = await run(gathered({ reconcile: { outcome: "fast-forwarded" }, items: [ITEM] }));
  check("same-branch `fast-forwarded` with threads proceeds to the nested cycle", ffWorking.status === "reached-cycle", ffWorking.status);
}

// --- On the PR's own branch: everything else stops the run ------------------
// Every case here carries an EMPTY `items` array, which is the shape the rule's
// third outcome returns by contract. That is what makes the gate's position
// ahead of the empty-`items` no-op load-bearing: move it after, and each of
// these becomes an indistinguishable "nothing to address".
{
  const unrecognized = await run(gathered({ reconcile: { outcome: "unrecognized", detail: "local dropped 2 commits" } }));
  check("same-branch `unrecognized` stops the run", unrecognized.status === "skipped-unreconciled", unrecognized.status);
  const absent = await run(gathered({}));
  check("an absent `reconcile` report stops the run", absent.status === "skipped-unreconciled", absent.status);
  const unknown = await run(gathered({ reconcile: { outcome: "rebased" } }));
  check("an outcome string the script does not know stops the run", unknown.status === "skipped-unreconciled", unknown.status);
  const empty = await run(gathered({ reconcile: { outcome: "" } }));
  check("an empty outcome string stops the run", empty.status === "skipped-unreconciled", empty.status);
  // The gate is keyed on the BRANCH NAMES, not on the outcome. Keyed on the
  // outcome instead, this packet — an agent reporting the off-shoot exemption
  // for a run that is on the PR's own branch — would sail straight through
  // with reconciliation never performed.
  const contradiction = await run(gathered({ reconcile: { outcome: "not-applicable" } }));
  check("`not-applicable` reported ON the PR's own branch stops the run", contradiction.status === "skipped-unreconciled", contradiction.status);
  // And the gate wins over having work to do, not just over having none.
  const withWork = await run(gathered({ reconcile: { outcome: "unrecognized", detail: "diverged" }, items: [ITEM] }));
  check("an unreconciled branch stops the run even with threads to address", withWork.status === "skipped-unreconciled", withWork.status);
  check(
    "and nothing runs past the gate: no nested cycle, no agent but the gather",
    withWork.seen.cycleOpts === null && withWork.seen.agentLabels.join(",") === "gather",
    JSON.stringify(withWork.seen),
  );
}

// --- What the skip hands back ----------------------------------------------
// The skip is not a failure, so what it REPORTS is the whole of its value: a
// maintainer has to be able to see which branch, which PR, and what the probes
// saw without re-running anything.
{
  const record = { outcome: "unrecognized", detail: "local dropped 2 commits present on the head" };
  const skipped = await run(gathered({ reconcile: record }));
  const r = skipped.result || {};
  check(
    "the skip names the branch, the PR and the outcome, and quotes the gather's detail",
    /feature\/x/.test(r.detail || "") && /#42/.test(r.detail || "") && /unrecognized/.test(r.detail || "") && (r.detail || "").includes(record.detail),
    r.detail,
  );
  check(
    "it carries the pr object and the raw reconcile record back",
    JSON.stringify(r.pr) === JSON.stringify(gathered({ reconcile: record }).pr) && JSON.stringify(r.reconcile) === JSON.stringify(record),
    JSON.stringify({ pr: r.pr, reconcile: r.reconcile }),
  );
  check("and says nothing was addressed and nothing pushed, with what to do next", /nothing was pushed/i.test(r.note || "") && /re-run/.test(r.note || ""), r.note);
  const absent = await run(gathered({}));
  check(
    "an absent report is reported as absent rather than blamed on a state",
    /none reported/.test((absent.result || {}).detail || "") && /no detail reported/.test((absent.result || {}).detail || ""),
    (absent.result || {}).detail,
  );
}

// --- The off-shoot exemption ------------------------------------------------
// A local off-shoot of a merge-pending PR: `workingBranch` legitimately differs
// from the PR's head ref, fixes land on the off-shoot, and `branch`/`headOid`
// stay publication metadata. A run only arrives in that shape by the request
// NAMING the off-shoot (the `off-shoot` token, pinned above and, in the block
// after this one, enforced against the request); reconciliation itself is keyed
// on the two branch names and is indifferent to how the location was chosen,
// which is why these scenarios state the packet rather than the route — while
// carrying the token, without which the run stops before reaching this gate.
// Reconciliation is skipped WHOLE here, so no reported outcome — including none
// at all, and including one that contradicts the exemption — may stop the run.
{
  const off = { workingBranch: "feature/x-offshoot" };
  const SELECTED = "#42 off-shoot no-push";
  const clean = await run(gathered({ ...off, reconcile: { outcome: "not-applicable" } }), { args: SELECTED });
  check("off-shoot `not-applicable` with no threads is a plain no-op", clean.status === "no-op", JSON.stringify(clean.result));
  // The no-op's reconciliation record is not path-dependent: the off-shoot run
  // reports what reconciliation concluded exactly as the same-branch one above
  // does. Pinned because the difference is invisible from the gate — both paths
  // reach the SAME return — so a reader is free to conclude the off-shoot result
  // carries no such record, and one did.
  check(
    "and that no-op names the reconciliation and carries its record too",
    /not-applicable/.test((clean.result || {}).detail || "") &&
      ((clean.result || {}).reconcile || {}).outcome === "not-applicable",
    JSON.stringify(clean.result),
  );
  const working = await run(gathered({ ...off, reconcile: { outcome: "not-applicable" }, items: [ITEM] }), { args: SELECTED });
  check("off-shoot `not-applicable` with threads proceeds to the nested cycle", working.status === "reached-cycle", working.status);
  check(
    "and the cycle runs on the off-shoot, not on the PR's head ref",
    working.seen.cycleOpts && working.seen.cycleOpts.opts.branch === "feature/x-offshoot",
    JSON.stringify(working.seen.cycleOpts && working.seen.cycleOpts.opts && working.seen.cycleOpts.opts.branch),
  );
  const absent = await run(gathered({ ...off }), { args: SELECTED });
  check("off-shoot with no `reconcile` report at all still proceeds", absent.status === "no-op", absent.status);
  const contradicting = await run(gathered({ ...off, reconcile: { outcome: "unrecognized", detail: "behind the PR head" } }), { args: SELECTED });
  check("off-shoot `unrecognized` still proceeds — behind the head is that case's normal state", contradicting.status === "no-op", contradicting.status);
}

// --- What ENTITLES a run to that exemption ----------------------------------
// The exemption above is triggered by two branch names the gather agent chose,
// and nothing in the packet says the request ever asked for a working branch
// other than the PR's head ref. So the token is parsed from the ARGS here, by
// the caller, and a differing `workingBranch` without it is a stop. Read the
// exemption without this gate and one gather deviation — the history-shape
// inference its brief forbids, or a plain misread of which branch it stood on —
// skips reconciliation whole and hands the fixing cycle a stacked child to edit
// and commit on, whose own commits publication then pushes onto this PR under
// `branch`. Nothing downstream can catch that: differing names are exactly what
// the supported case looks like, so every later step reads the deviation as the
// mode working. The two directions are pinned together, because a gate keyed on
// the wrong thing passes one of them: the token must ADMIT the supported case
// (covered above, and again here from a differently-spelled request) and REFUSE
// the packet that merely claims it.
{
  const off = { workingBranch: "feature/x-offshoot", reconcile: { outcome: "not-applicable" }, items: [ITEM] };
  const unselected = await run(gathered(off));
  const u = unselected.result || {};
  check(
    "a working branch other than the PR head ref, from a request that never carried `off-shoot`, stops the run",
    unselected.status === "skipped-unselected-working-branch" && /off-shoot/.test(u.detail || ""),
    JSON.stringify(u),
  );
  check(
    "and nothing runs past the gather: no nested cycle, and the off-shoot is never edited",
    unselected.seen.cycleOpts === null && unselected.seen.agentLabels.join(",") === "gather",
    JSON.stringify(unselected.seen),
  );
  // Parsing is lenient over free prose exactly as the push/ping tokens are, and
  // the two directions of that leniency do NOT cost the same, which is what
  // decides how it is pinned. A false positive disables this gate for one run
  // and leaves the behaviour that shipped before it existed. A false negative
  // REFUSES a run the request genuinely selected — `skipped-unselected-working-
  // branch` on a supported case — and it is silent in the direction that reads
  // as the guard working. So the ADMIT direction is swept wide, over every
  // spelling a maintainer plausibly types: spaced and joined, quoted and
  // backticked, abutting a slash, and sharing a request with a quoted phrase or
  // a ref path. A round that narrows the text the token is read out of has to
  // keep every one of these.
  const selections = [
    "#42 off-shoot, no-push",
    "#42 off shoot, no-push",
    "#42 offshoot, no-push",
    "#42 off-shoots, no-push",
    '#42 "off-shoot", no-push',
    "#42 `off-shoot`, no-push",
    '#42 please use "off-shoot mode", no-push',
    "#42 off-shoot/no-push",
    '#42 the review says "use origin/main" and off-shoot "yes"',
    "#42 off-shoot; rebase onto origin/main first, no-push",
    "#42 work on the off-shoot at task/021c-guard, no-push",
    "#42 use off-shoot mode (see `docs/off-shoot.md`), no-push",
    "#42 this run is an off-shoot of the head, no-push",
    "#42 don't push; off-shoot",
  ];
  const refused = [];
  for (const req of selections) {
    const r = await run(gathered(off), { args: req });
    if (r.status !== "reached-cycle") refused.push(`${req} -> ${r.status}`);
  }
  check(
    "and every genuine selection reaches the cycle — spaced, joined, plural, quoted, backticked, slash-abutted, and beside a quoted phrase or a ref path",
    refused.length === 0,
    refused.join("; "),
  );
  // The residual, pinned as the deliberate choice it is rather than left to be
  // rediscovered: a request that merely MENTIONS an off-shoot selects one too,
  // so an incidental mention disables this gate for that run. A narrowing pass
  // over the text the token is read from — strip ref paths, quoted phrases,
  // negations, the way `push-back` is stripped before `push` — was written and
  // removed: measured against this same harness it caught 4 of 10 incidental
  // mentions while REFUSING 3 of the genuine selections above, and the
  // categories leaked anyway. Every row here is one that pass was supposed to
  // catch and the last four are ones it did not, so restoring it in that form
  // fails the check above by name before this one is even consulted. Widening
  // it further is the same trade in the costlier direction. What the gate still
  // catches, and what it is for, is the check at the top of this block: a
  // deviating packet from a request that never says `off-shoot` at all.
  const incidental = [
    "#42 rebase on top of task/021c-publication-guard-for-an-off-shoot, no-push",
    "#42 branch feature/offshoot-ui, no-push",
    '#42 title "Fix offshoot accounting", no-push',
    "#42 this is not an off shoot, no-push",
    '#42 title "Fix the off-shoot in src/a"',
    "#42 no off-shoot, use a worktree",
    "#42 do not use off-shoot mode",
    "#42 don't use the off-shoot mode",
    "#42 don't work on the off-shoot",
    "#42 rebase onto off-shoot-guard, no-push",
  ];
  const stopped = [];
  for (const req of incidental) {
    const r = await run(gathered(off), { args: req });
    if (r.status !== "reached-cycle") stopped.push(`${req} -> ${r.status}`);
  }
  check(
    "while an incidental mention — a ref path, a quoted phrase, a negation — selects the off-shoot too: the accepted residual of reading the token from the whole request, no context stripped",
    stopped.length === 0,
    stopped.join("; "),
  );
}

// --- The producer half: the rule the gather brief states ---------------------
// Everything above exercises the CONSUMER of `packet.reconcile`. What makes
// that field exist is a paragraph of the gather brief that no scenario reaches,
// since the gather agent is stubbed with a packet already written — delete the
// paragraph and every check above still passes while no run ever reconciles
// anything again. So the brief is rendered and read: the two probes it orders,
// the off-shoot skip, and the outcome vocabulary it fixes.
{
  const brief = gatherPrompt("#42");
  const probes = ["git rev-list --right-only --cherry-pick", "git merge-base --is-ancestor"];
  const missing = probes.filter((p) => !brief.includes(p));
  check("the gather brief orders both reconciliation probes", missing.length === 0, `missing: ${missing.join("; ")}`);

  // Where the probes' `R` comes from decides what they compare against. The
  // OID `gh pr view` reported is normally reachable from the checkout itself,
  // so testing that it exists locally passes just as well after the head moved
  // — and every probe then runs against a stale tip.
  const readsFetchedHead = brief.includes("git rev-parse FETCH_HEAD");
  const testsObjectExistence = /cat-file -e/.test(brief);
  check(
    "and takes their `R` from the fetched ref, not from an existence test on the recorded OID",
    readsFetchedHead && !testsObjectExistence,
    `reads FETCH_HEAD: ${readsFetchedHead}; tests object existence: ${testsObjectExistence}`,
  );

  // The off-shoot exemption is stated to the agent as well as enforced by the
  // gate: where the names differ the step is skipped WHOLE, which is what makes
  // `not-applicable` the honest report there rather than an unrun probe's.
  const skipPara = brief.split("\n\n").find((p) => p.includes('outcome: "not-applicable"')) || "";
  check(
    "and skips reconciliation whole where the branch names differ, reporting `not-applicable`",
    /differ/i.test(skipPara) && /skip/i.test(skipPara),
    skipPara ? skipPara.slice(0, 160) : 'no paragraph reports `outcome: "not-applicable"`',
  );

  const stated = [...new Set([...brief.matchAll(/outcome:\s*"([^"]*)"/g)].map((m) => m[1]))].sort();
  check(
    "and names exactly the four outcomes the schema and the gate know",
    stated.join(",") === "fast-forwarded,not-applicable,unrecognized,work",
    stated.join(",") || "the brief states no outcome at all",
  );

  // The coupling nothing else pins. The brief and the gate agree on a set of
  // literal strings and neither derives one from the other, so renaming a token
  // on one side alone leaves both halves internally consistent while every
  // same-branch run thereafter stops with `skipped-unreconciled`. Each outcome
  // the BRIEF states is driven through the actual gate here, on the PR's own
  // branch: the ones that continue a run must be the ones the brief tells the
  // agent to report before proceeding.
  const accepted = [];
  for (const outcome of stated) {
    const attempt = await run(gathered({ reconcile: { outcome }, items: [ITEM] }));
    if (attempt.status === "reached-cycle") accepted.push(outcome);
  }
  check(
    "and the outcomes it reports before proceeding are exactly the ones the gate lets through",
    accepted.join(",") === "fast-forwarded,work",
    `the gate accepts ${accepted.join(",") || "none of the outcomes the brief states"}`,
  );
}

// --- The publication guard beside it ----------------------------------------
// Independent of the reconciliation and prose rather than script logic, so it
// is checked in the rendered brief: a HEAD that is a proper ancestor of the PR
// head has nothing to publish, and the lease MATCHES there — it would succeed
// and delete the newer remote commits. The publisher must stop before reaching
// it, which is a claim about ORDER as much as about presence.
{
  const brief = publishPrompt(gathered({ reconcile: { outcome: "work" } }), [], { push: true }, [], []);
  const stop = brief.indexOf('aborted: "local behind PR head"');
  const lease = brief.indexOf("--force-with-lease=");
  const named = /PROPER ANCESTOR/.test(brief);
  check("the publish brief stops a proper-ancestor HEAD without pushing", stop > -1 && named, `stop@${stop} names-the-case@${named}`);
  check("and states that stop ahead of the lease it would otherwise match", stop > -1 && lease > -1 && stop < lease, `stop@${stop} lease@${lease}`);
}

// --- The delegated rebase points --------------------------------------------
// Rebasing onto the freshest base is the default now, at two points, and both
// are delegated — this script cannot run git, and an orchestrator holding a
// half-finished rebase has nowhere to put a conflict. Three separable ways to
// lose the point of that, each driven through the shipped script rather than
// read out of it:
//
//   1. The PIN. Whatever the rebase reports as the base it landed on becomes
//      the review base handed to the cycle, and it must be a COMMIT. A
//      remote-tracking name accepted here moves under a sibling push or the
//      next fetch, so the reviewer would bound its diff at a tip this branch
//      was never rebased onto — while the branch it judges still sits where it
//      did.
//   2. The HALT. A conflict beyond the step's competence stops the run with the
//      question BEFORE anything is fixed, rather than being guessed at or
//      discovered after a cycle's worth of work.
//   3. The OPT-OUT, and the ORDER against the gate above: `no-rebase`
//      suppresses both points, and the reconciliation gate still runs ahead of
//      the first one (the "nothing runs past the gate" check above now covers
//      that direction on its own, since a rebase agent would show up in the
//      same label list).
{
  const withWork = { reconcile: { outcome: "work" }, items: [ITEM] };
  const clean = await run(gathered(withWork));
  check(
    "a default run delegates the pre-fix rebase, after the gather and before the cycle",
    clean.status === "reached-cycle" && clean.seen.agentLabels.join(",") === "gather,rebase-pre-fix",
    JSON.stringify(clean.seen.agentLabels),
  );
  check(
    "and the cycle's review base is the pinned OID the rebase landed on, not the base ref name",
    clean.seen.cycleOpts && clean.seen.cycleOpts.opts.base === REBASE_NOOP.effectiveBase,
    JSON.stringify(clean.seen.cycleOpts && clean.seen.cycleOpts.opts && clean.seen.cycleOpts.opts.base),
  );
  const unpinned = await run(gathered(withWork), { rebase: { ...REBASE_NOOP, effectiveBase: "origin/main" } });
  check(
    "a rebase reporting a movable ref instead of the commit it landed on stops the run, dispatching nothing",
    unpinned.status === "rebase-unpinned-base" && unpinned.seen.cycleOpts === null,
    JSON.stringify({ status: unpinned.status, cycle: unpinned.seen.cycleOpts }),
  );
  const halted = await run(gathered(withWork), {
    rebase: {
      ok: true,
      halted: true,
      noop: false,
      question: "`src/app.ts` conflicts with the sibling PR's rename; which side owns the guard?",
      detail: "aborted; tree clean and idle",
      recoveryRef: "refs/pre-rebase/feature/x/20260809-101112",
    },
  });
  check(
    "a halted rebase stops the run before anything is fixed",
    halted.status === "rebase-halted" && halted.seen.cycleOpts === null,
    JSON.stringify({ status: halted.status, cycle: halted.seen.cycleOpts }),
  );
  const q = ((halted.result || {}).openQuestions || [])[0] || {};
  check(
    "and the conflict leaves as an open question with origin `rebase`, not as a bare error string",
    q.origin === "rebase" && /which side owns the guard/.test(q.question || ""),
    JSON.stringify((halted.result || {}).openQuestions),
  );
  const off = await run(gathered(withWork), { args: "no-push no-rebase" });
  check(
    "`no-rebase` runs neither point and leaves the base ref as the review base",
    off.status === "reached-cycle" &&
      off.seen.agentLabels.join(",") === "gather" &&
      off.seen.cycleOpts.opts.base === "main",
    JSON.stringify({ labels: off.seen.agentLabels, base: off.seen.cycleOpts && off.seen.cycleOpts.opts.base }),
  );
}

// --- The producer half: what the rebase brief orders -------------------------
// The pin above is enforced on what the agent REPORTS; what makes it report a
// commit at all is the brief, which no scenario reaches because the rebase agent
// is stubbed. So it is rendered and read, exactly as the gather brief's
// reconciliation rule is: resolve the target to an OID and rebase onto that, and
// on a conflict it cannot judge, abort and leave the tree clean rather than
// returning mid-rebase.
{
  const brief = rebasePrompt("pre-fix", gathered({ reconcile: { outcome: "work" } }), "main");
  const resolves = /git rev-parse/.test(brief);
  const rebasesOntoTheOid = /rebase onto THAT OID, never onto the name/.test(brief);
  const namesTheHazard = /every range this run delegates afterwards is taken against `effectiveBase`/.test(brief);
  check(
    "the rebase brief resolves the target to an OID, rebases onto that, and says why a ref name is not an answer",
    resolves && rebasesOntoTheOid && namesTheHazard,
    `rev-parse: ${resolves}; rebases onto the OID: ${rebasesOntoTheOid}; names the hazard: ${namesTheHazard}`,
  );
  const aborts = brief.indexOf("git rebase --abort");
  const confirmsIdle = /CONFIRM the tree is clean and idle/.test(brief);
  const neverMidRebase = /Never leave the tree mid-rebase/.test(brief);
  const hunkRule = /no cleanly auto-merged content from the other side/.test(brief);
  check(
    "and on a conflict beyond its competence it aborts, confirms the tree is clean and idle, and resolves by hunk otherwise",
    aborts > -1 && confirmsIdle && neverMidRebase && hunkRule,
    `abort@${aborts} confirms-idle@${confirmsIdle} never-mid-rebase@${neverMidRebase} hunk-rule@${hunkRule}`,
  );
}

check(`suite ran all ${EXPECTED_CHECKS} checks`, ran === EXPECTED_CHECKS, `ran ${ran}`);

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll address-review reconciliation checks passed.");
