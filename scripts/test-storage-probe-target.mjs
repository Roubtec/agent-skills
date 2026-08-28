#!/usr/bin/env node
// Focused unit test for wf-address-tasks.js's storage-probe targeting and its
// throttle-retention rule: `validateBootstrapWtBase` (a bootstrap reporting `ok`
// without an absolute worktree base fails the batch before any task runs) and
// `nextAvailBytes` (a probe that failed or could not measure keeps the previous
// reading, rather than widening or disabling the concurrency cap on a reading
// nobody took). The workflow is a runtime script
// (top-level await/return, injected `agent`/`phase`/`log` globals), so it cannot
// be imported as a module; the pure functions are extracted by source and
// evaluated in isolation, exercising the ACTUAL shipped code rather than a copy
// — the same approach as test-checkout-cleanliness-report.mjs.
//
// The properties that live at CALL SITES rather than inside a pure function —
// that every `df` probe measures that validated base rather than a relative
// fallback, and that the gate runs before any task work — are asserted against
// the workflow source below.
//
// Run: node scripts/test-storage-probe-target.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const workflowPath = join(here, "..", "plugins", "dev-skills", "workflows", "wf-address-tasks.js");
const src = readFileSync(workflowPath, "utf8");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`ok  - ${name}`);
  } else {
    failures++;
    console.error(`NOT ok - ${name}${detail ? `: ${detail}` : ""}`);
  }
}

// Extract a top-level `function NAME(...) { ... }` up to the first closing brace
// at column 0 (its own — every inner `}` is indented). Fail loudly if the shape
// changed, so the test can't silently pass against code it no longer found.
function extractFunction(name, argList) {
  const re = new RegExp(`function ${name}\\(${argList}\\) \\{[\\s\\S]*?\\n\\}`);
  const match = src.match(re);
  if (!match) {
    console.error(`FAIL: could not locate ${name} in the workflow source.`);
    process.exit(1);
  }
  // eslint-disable-next-line no-new-func
  return new Function(`return (${match[0]});`)();
}

const validateBootstrapWtBase = extractFunction("validateBootstrapWtBase", "boot");
const nextAvailBytes = extractFunction("nextAvailBytes", "previous, reading");

// The width cap is a one-line arrow beside the wave loop, not a top-level
// function; extract it together with the constant it closes over so the
// "a failed probe cannot disable an active cap" claim is checked end to end.
const capMatch = src.match(/const PER_WORKTREE_BYTES = [^;]+;/);
const widthMatch = src.match(/const widthCapFor = \([^)]*\) => [^;]+;/);
if (!capMatch || !widthMatch) {
  console.error("FAIL: could not locate PER_WORKTREE_BYTES / widthCapFor in the workflow source.");
  process.exit(1);
}
// eslint-disable-next-line no-new-func
const widthCapFor = new Function(`${capMatch[0]}\n${widthMatch[0]}\nreturn widthCapFor;`)();
const GIB = 1024 ** 3;

// 1. An omitted / empty / non-string `wtBase` on an `ok` bootstrap is a contract
//    failure, and the blocker says so rather than naming a guessed path.
{
  const cases = [
    ["wtBase omitted", { ok: true }],
    ["wtBase empty string", { ok: true, wtBase: "" }],
    ["wtBase whitespace only", { ok: true, wtBase: "   " }],
    ["wtBase non-string", { ok: true, wtBase: 42 }],
    ["wtBase null", { ok: true, wtBase: null }],
    ["no bootstrap result at all", null],
  ];
  for (const [name, boot] of cases) {
    const r = validateBootstrapWtBase(boot);
    check(`${name} → rejected`, r.ok === false, JSON.stringify(r));
    check(`${name} → blocker names the bootstrap contract`, /contract/i.test(r.blocker) && /wtBase/.test(r.blocker));
    // The two rejection branches must stay distinguishable: a missing base is
    // not a relative one, and an operator reading the blocker has to be told
    // which failure they actually hit.
    check(`${name} → blocker reports a MISSING base, not a relative one`, /without a/i.test(r.blocker) && !/relative/i.test(r.blocker), r.blocker);
    check(`${name} → no path handed back`, r.wtBase === "");
  }
}

// 2. A RELATIVE base is rejected — the case the removed `.worktrees` fallback
//    used to produce, and the one that silently measures the probe agent's own
//    working directory instead of the .worktrees mount.
{
  const relatives = [".worktrees", "./.worktrees", "../repo/.worktrees", "worktrees/x", "~/repo/.worktrees"];
  for (const raw of relatives) {
    const r = validateBootstrapWtBase({ ok: true, wtBase: raw });
    check(`relative wtBase ${JSON.stringify(raw)} → rejected`, r.ok === false, JSON.stringify(r));
    check(`relative wtBase ${JSON.stringify(raw)} → blocker names the contract`, /contract/i.test(r.blocker) && /absolute/i.test(r.blocker));
    check(`relative wtBase ${JSON.stringify(raw)} → blocker says RELATIVE and echoes the value`, /relative/i.test(r.blocker) && r.blocker.includes(raw), r.blocker);
    check(`relative wtBase ${JSON.stringify(raw)} → no path handed back`, r.wtBase === "");
  }
}

// 3. A valid absolute base is accepted verbatim (surrounding whitespace from the
//    agent's transcription and any trailing slash trimmed, nothing else rewritten).
{
  const r = validateBootstrapWtBase({ ok: true, wtBase: "/workspace/repo/.worktrees/agent-1" });
  check("absolute wtBase → accepted", r.ok === true);
  check("absolute wtBase → returned verbatim", r.wtBase === "/workspace/repo/.worktrees/agent-1");
  check("absolute wtBase → no blocker", r.blocker === "");
  const padded = validateBootstrapWtBase({ ok: true, wtBase: "  /workspace/repo/.worktrees/agent-1\n" });
  check("padded absolute wtBase → accepted and trimmed", padded.ok === true && padded.wtBase === "/workspace/repo/.worktrees/agent-1");
  // A path with a space is legal and must survive; the probe prompt shell-quotes it.
  const spaced = validateBootstrapWtBase({ ok: true, wtBase: "/work space/repo/.worktrees/a" });
  check("absolute wtBase containing a space → accepted unmangled", spaced.ok === true && spaced.wtBase === "/work space/repo/.worktrees/a");
  // A trailing slash is dropped: the review-stack stage joins the base with
  // `/<slug>` into a path it then matches EXACTLY against what git reports,
  // and git collapses the `//` such a base would produce.
  const slashed = validateBootstrapWtBase({ ok: true, wtBase: "/workspace/repo/.worktrees/agent-1/" });
  check("absolute wtBase with a trailing slash → accepted with the slash dropped", slashed.ok === true && slashed.wtBase === "/workspace/repo/.worktrees/agent-1");
  const doubled = validateBootstrapWtBase({ ok: true, wtBase: "/workspace/repo/.worktrees/agent-1//\n" });
  check("absolute wtBase with trailing slashes and whitespace → both dropped", doubled.ok === true && doubled.wtBase === "/workspace/repo/.worktrees/agent-1");
  const root = validateBootstrapWtBase({ ok: true, wtBase: "/" });
  check("the bare root keeps its one slash", root.ok === true && root.wtBase === "/");
}

// 4. Retention: a later probe that failed or could not measure keeps the last
//    valid positive reading, and therefore cannot disable an active cap.
{
  const prior = 2 * GIB;
  const priorCap = widthCapFor(prior);
  check("a positive reading yields a finite cap", Number.isFinite(priorCap) && priorCap === 2);
  const failures_ = [
    ["probe returned nothing", null],
    ["probe returned undefined", undefined],
    ["probe omitted availBytes", {}],
    ["probe could not measure (0)", { availBytes: 0 }],
    ["probe returned a negative", { availBytes: -1 }],
    ["probe returned NaN", { availBytes: Number.NaN }],
    ["probe returned a string", { availBytes: "4294967296" }],
  ];
  for (const [name, probe] of failures_) {
    const next = nextAvailBytes(prior, probe);
    check(`${name} → prior reading retained`, next === prior, String(next));
    check(`${name} → cap not widened`, widthCapFor(next) === priorCap);
    check(`${name} → cap not disabled`, Number.isFinite(widthCapFor(next)));
  }
  const good = nextAvailBytes(prior, { availBytes: 8 * GIB });
  check("a fresh positive reading replaces the prior one", good === 8 * GIB && widthCapFor(good) === 8);
  const shrunk = nextAvailBytes(prior, { availBytes: 1 * GIB });
  check("a smaller positive reading still replaces (throttle tightens)", shrunk === 1 * GIB && widthCapFor(shrunk) === 1);
}

// 4b. The same rule seeds the batch from the bootstrap reading: an unmeasured
//     bootstrap leaves 0 (no cap — the documented `Infinity` behavior), a
//     measured one seeds the cap.
{
  check("unmeasured bootstrap seeds 0 → no cap", nextAvailBytes(0, { ok: true }) === 0 && widthCapFor(nextAvailBytes(0, { ok: true })) === Infinity);
  check("measured bootstrap seeds its reading", nextAvailBytes(0, { ok: true, availBytes: 3 * GIB }) === 3 * GIB);
}

// 5. Call-site properties, asserted against the source: every `df` probe is
//    handed the VALIDATED base, and no relative fallback survives anywhere.
{
  // Task 033 replaced the wave-boundary `df` re-probe with a cap derived ONCE
  // from the bootstrap reading: the probe brief and its schema are gone —
  // declaration and call sites alike, which is why the pattern below is the
  // bare identifier — so the only measurement that reaches the cap is the
  // bootstrap's, seeded through the retention rule from the unmeasured 0, and
  // no slot handoff spawns an agent.
  check("no storage-probe brief remains, declared or called", !/storageProbePrompt/.test(src) && !/STORAGE_PROBE_SCHEMA/.test(src));
  check("no relative `.worktrees` literal is used as a probe target", !/["'`]\.?\/?\.worktrees["'`]\s*\)/.test(src));
  check("the cap is derived once from the bootstrap reading through nextAvailBytes", /const availBytes = nextAvailBytes\(0, boot\);/.test(src) && /createSlotGate\(widthCapFor\(availBytes\)\)/.test(src));
  check("a slot handoff spawns nothing", /function releaseSlot\(gate\) \{/.test(src) && !/releaseSlot\([^)]*,/.test(src));
}

// 6. The gate runs before any task work: an unusable base must abort the batch
//    at Bootstrap, before any worktree is added under a base nobody measured.
{
  // Anchored on the assignment so the function's own DECLARATION (which appears
  // far earlier in the file) cannot satisfy the ordering assertions below.
  const gate = src.indexOf("= validateBootstrapWtBase(boot)");
  const bootstrapCall = src.indexOf('label: "bootstrap"');
  const resolvePhase = src.indexOf('phase("Resolve batch")');
  check("the gate exists at the bootstrap acceptance site", gate !== -1 && bootstrapCall !== -1 && gate > bootstrapCall);
  // `gate !== -1` is load-bearing: a missing gate yields -1, which would satisfy
  // a bare `gate < resolvePhase` and let this ordering claim pass vacuously.
  check("the gate runs before the batch resolves any task", gate !== -1 && resolvePhase !== -1 && gate < resolvePhase);
  check("an invalid base returns an error naming the missing absolute base", /error: "Worktree bootstrap returned no usable absolute worktree base; batch not started\."/.test(src));
  check("the gate's blocker is surfaced to the caller", /blocker: bootWtBase\.blocker/.test(src));
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll storage-probe-target checks passed.");
