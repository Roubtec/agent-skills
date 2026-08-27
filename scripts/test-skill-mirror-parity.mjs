#!/usr/bin/env node
// Structural parity guard for the two hand-edited skill mirrors.
//
// Every skill ships twice — `plugins/dev-skills/skills/<name>/SKILL.md` for
// Claude and `codex/dev-skills/skills/<name>/SKILL.md` for Codex — with no
// generator between them. The mirrors legitimately differ in PROSE (they
// address different harnesses), so byte parity is the wrong instrument, and
// the divergence COUNT a PR summary recites is no instrument at all: it moves
// on every reword and holds still when a rule is added to one mirror and
// dropped from the other. What should not differ is STRUCTURE, and that is
// all this suite compares. For each skill named in either tree it asserts:
//
//   PRESENCE  — the skill exists in both trees.
//   HEADINGS  — the ordered sequence of ATX headings (level + text) matches.
//   COUNTS    — within each section both mirrors share, the number of
//               ordered-list items and of top-level bullets matches; a
//               section one mirror holds alone is counted against an empty
//               counterpart, so its items are deltas of their own.
//
// Measurement rules, stated so a quoted figure can be reproduced: ATX headings
// only (`#`..`######` at column zero followed by a space); list markers at
// column zero only, so nested items are the parent's prose; every line inside
// a fenced code block (``` or ~~~, indented by up to three spaces as CommonMark
// allows, so a fence nested in a list item counts) and inside YAML front matter
// is excluded —
// `review-cycle`'s launch snippets carry shell comments that would otherwise
// count as four headings. A section runs from its heading to the next heading
// of ANY level; the text before the first heading is the preamble section.
//
// Legitimate structural divergence lives in the allowlist file beside this
// suite, `skill-mirror-parity-allowlist.json`, as data. An entry pins one
// exact delta — the skill, the heading, and either the one-sided heading's
// side or both mirrors' counts for one element kind — with a one-line reason
// naming the harness difference that produces it. It is a pinned delta, not
// an exempted region: a divergence the list does not name fails, a divergence
// that no longer matches its entry fails (so adding or deleting a one-sided
// bullet inside an excused section fails — an excused one-sided HEADING pins
// the heading alone, and each list item under it is a count delta needing its
// own entry), an entry whose divergence has disappeared fails (so the list
// cannot rot into things that used to be true), and each entry excuses exactly
// one divergence (so a second copy of an excused one-sided heading fails).
//
// Neighbouring suites pin CLAUSES and stay untouched by this one:
// `test-resolve-tasks-contract.mjs` asserts byte identity for `resolve-tasks`
// and each consumer's preflight block, `test-skill-worktree-base-exclude.mjs`
// for three named steps, and `test-subagent-destroy-boundary.mjs` censuses
// specific clauses. None of them notices a whole step or section appearing
// on one side only, which is exactly and only what this suite catches.
//
// Hermetic: reads files, no network, no `gh`, no repository writes.
// Run: node scripts/test-skill-mirror-parity.mjs

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const ALLOWLIST_PATH = join(here, "skill-mirror-parity-allowlist.json");
const TREES = {
  claude: join(repo, "plugins", "dev-skills", "skills"),
  codex: join(repo, "codex", "dev-skills", "skills"),
};
const SIDES = Object.keys(TREES);
const ELEMENTS = { ordered: "ordered-list items", bullets: "top-level bullets" };

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`ok  - ${name}`);
  else {
    failures++;
    console.error(`NOT ok - ${name}${detail ? `: ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------- parsing --

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
// A closing hash run is optional and, per CommonMark, must follow whitespace:
// `## Arguments#` is heading text ending in a hash, not a closed heading.
const HEADING = /^(#{1,6}) +(.*?)(?:\s+#+)?\s*$/;
const ORDERED = /^\d+[.)] /;
const BULLET = /^[-*+] /;

// Returns the sections in document order. Each carries its heading key
// (`"## Text"`, or `"(preamble)"` for the text before the first heading), the
// heading's level and text, and its two element counts plus each element's
// first line (for naming what a count divergence is, best-effort).
function parseStructure(markdown) {
  const lines = markdown.split(/\r?\n/);
  const sections = [];
  let current = { key: "(preamble)", level: 0, text: "", ordered: [], bullets: [] };
  let fence = null;
  let i = 0;
  if (lines[0] === "---") {
    // YAML front matter: skip to its closing delimiter, if there is one.
    const close = lines.indexOf("---", 1);
    if (close !== -1) i = close + 1;
  }
  for (; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(FENCE);
    if (fence) {
      // A fence closes on the same character, at least as long as the opener.
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length && line.trim() === fenceMatch[1]) fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      sections.push(current);
      const level = heading[1].length;
      const text = heading[2].trim();
      current = { key: `${heading[1]} ${text}`, level, text, ordered: [], bullets: [] };
      continue;
    }
    if (ORDERED.test(line)) current.ordered.push(line.trim());
    else if (BULLET.test(line)) current.bullets.push(line.trim());
  }
  sections.push(current);
  return sections;
}

// Longest common subsequence over two key arrays; returns the index pairs kept
// on both sides, so everything else is one-sided.
function lcsPairs(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

// Compares one skill's two mirrors and returns its divergences, each in the
// same shape an allowlist entry pins:
//   { kind: "heading", skill, heading, side }
//   { kind: "count", skill, heading, element, claude, codex, extra }
function compareMirrors(skill, texts) {
  const structure = Object.fromEntries(SIDES.map((side) => [side, parseStructure(texts[side])]));
  const keys = Object.fromEntries(SIDES.map((side) => [side, structure[side].map((s) => s.key)]));
  const pairs = lcsPairs(keys.claude, keys.codex);
  const divergences = [];
  const paired = Object.fromEntries(SIDES.map((side) => [side, new Set()]));
  for (const [ci, xi] of pairs) {
    paired.claude.add(ci);
    paired.codex.add(xi);
  }
  const EMPTY = { ordered: [], bullets: [] };
  const comparisons = pairs.map(([ci, xi]) => [structure.claude[ci], structure.codex[xi]]);
  for (const side of SIDES) {
    structure[side].forEach((section, index) => {
      if (paired[side].has(index)) return;
      divergences.push({ kind: "heading", skill, heading: section.key, side });
      // Its items are compared against an empty counterpart below, so the
      // heading allowance does not silently cover everything beneath it.
      comparisons.push(side === "claude" ? [section, EMPTY] : [EMPTY, section]);
    });
  }
  for (const [c, x] of comparisons) {
    const key = c === EMPTY ? x.key : c.key;
    for (const element of Object.keys(ELEMENTS)) {
      if (c[element].length === x[element].length) continue;
      // Best-effort naming of the delta: items whose text appears on one side
      // only. Reworded items surface on both lists; they are a hint, not a pin.
      const only = (mine, theirs) => mine.filter((t) => !theirs.includes(t));
      divergences.push({
        kind: "count",
        skill,
        heading: key,
        element,
        claude: c[element].length,
        codex: x[element].length,
        extra: { claude: only(c[element], x[element]), codex: only(x[element], c[element]) },
      });
    }
  }
  return divergences;
}

function describe(d) {
  if (d.kind === "heading") return `${d.skill} / "${d.heading}": heading present in the ${d.side} mirror only`;
  const more = d.claude > d.codex ? "claude" : "codex";
  const hint = SIDES.map((side) => (d.extra[side].length ? `${side}-only ${d.element}: ${d.extra[side].map((t) => JSON.stringify(t.slice(0, 80))).join(", ")}` : null))
    .filter(Boolean)
    .join("; ");
  return `${d.skill} / "${d.heading}": ${ELEMENTS[d.element]} differ — claude ${d.claude}, codex ${d.codex} (${more} holds ${Math.abs(d.claude - d.codex)} more)${hint ? `; ${hint}` : ""}`;
}

// An allowlist entry matches a divergence only when every pinned field agrees.
function matches(entry, d) {
  if (entry.skill !== d.skill || entry.heading !== d.heading) return false;
  if (d.kind === "heading") return entry.side === d.side && entry.claude === undefined && entry.codex === undefined;
  return entry.side === undefined && entry.element === d.element && entry.claude === d.claude && entry.codex === d.codex;
}

function describeEntry(e) {
  const delta = e.side ? `heading on the ${e.side} side only` : `${e.element} claude ${e.claude} / codex ${e.codex}`;
  return `${e.skill} / "${e.heading}": ${delta}`;
}

// ------------------------------------------------------------------- main --

function main() {
  // Parser self-check, on a fixture rather than a mirror: a fence indented
  // inside a list item is still a fence, so the heading and bullet it holds
  // are excluded; the column-zero heading after it is not.
  const fixture = ["- item", "   ```", "# heading", "- bullet", "   ```", "## Real", "## Closed ##", "## Trailing#"].join("\n");
  const parsed = parseStructure(fixture);
  check(
    "parser excludes headings and bullets inside a fence indented up to three spaces",
    parsed.length === 4 && parsed[0].key === "(preamble)" && parsed[0].bullets.length === 1 && parsed[1].key === "## Real",
    JSON.stringify(parsed.map((s) => [s.key, s.bullets.length])),
  );
  // A closing hash run needs whitespace before it; a hash glued to the text
  // is text, so a mirror renaming `## Arguments` to `## Arguments#` diverges.
  check(
    "parser strips a closing hash run only after whitespace",
    parsed.length === 4 && parsed[2].key === "## Closed" && parsed[3].key === "## Trailing#",
    JSON.stringify(parsed.map((s) => s.key)),
  );

  // Comparison self-check, on fixtures rather than mirrors: a one-sided
  // section's items count against an empty counterpart, and a one-sided
  // heading duplicated on its side is two heading divergences, not one.
  const oneSided = compareMirrors("fixture", { claude: "## A\n", codex: "## A\n## B\n- x\n1. y\n## B\n" });
  check(
    "a one-sided section's items are count divergences and a duplicated one-sided heading is two",
    JSON.stringify(oneSided.map((d) => (d.kind === "heading" ? [d.heading, d.side] : [d.heading, d.element, d.claude, d.codex]))) ===
      JSON.stringify([["## B", "codex"], ["## B", "codex"], ["## B", "ordered", 0, 1], ["## B", "bullets", 0, 1]]),
    JSON.stringify(oneSided),
  );

  let allowlist;
  try {
    allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  } catch (err) {
    allowlist = undefined;
    check("allowlist file parses as JSON", false, err.message);
  }
  check("allowlist is an array of entries", Array.isArray(allowlist));
  const entries = Array.isArray(allowlist) ? allowlist : [];
  for (const [i, e] of entries.entries()) {
    const wellFormed =
      typeof e.skill === "string" &&
      typeof e.heading === "string" &&
      typeof e.reason === "string" &&
      e.reason.trim() !== "" &&
      ((SIDES.includes(e.side) && e.element === undefined && e.claude === undefined && e.codex === undefined) ||
        (e.side === undefined && Object.keys(ELEMENTS).includes(e.element) && Number.isInteger(e.claude) && Number.isInteger(e.codex) && e.claude !== e.codex));
    check(`allowlist entry ${i} pins one exact delta with a reason`, wellFormed, JSON.stringify(e));
    const twin = entries.findIndex((o, j) => j < i && matches(o, { ...e, kind: e.side ? "heading" : "count" }));
    check(`allowlist entry ${i} is not a duplicate`, twin === -1, `duplicates entry ${twin}`);
  }

  const names = new Set();
  for (const side of SIDES) {
    for (const name of readdirSync(TREES[side])) if (existsSync(join(TREES[side], name, "SKILL.md"))) names.add(name);
  }
  check("at least one skill was discovered in the mirrors", names.size > 0);

  // Each entry excuses exactly one divergence: consumed on first match, so a
  // second divergence identical to an excused one (the same one-sided heading
  // duplicated within a mirror) stays unexcused, and liveness is consumption.
  const consumed = new Set();
  for (const skill of [...names].sort()) {
    const missing = SIDES.filter((side) => !existsSync(join(TREES[side], skill, "SKILL.md")));
    check(`${skill}: SKILL.md present in both trees`, missing.length === 0, `missing from the ${missing.join(", ")} mirror`);
    if (missing.length) continue;
    const texts = Object.fromEntries(SIDES.map((side) => [side, readFileSync(join(TREES[side], skill, "SKILL.md"), "utf8")]));
    const unexcused = compareMirrors(skill, texts).filter((d) => {
      const i = entries.findIndex((e, j) => !consumed.has(j) && matches(e, d));
      if (i !== -1) consumed.add(i);
      return i === -1;
    });
    check(`${skill}: heading sequence and per-section counts match, or every divergence is pinned in the allowlist`, unexcused.length === 0, unexcused.map(describe).join("\n         "));
  }

  for (const [i, e] of entries.entries()) {
    check(`allowlist entry ${i} still names a live divergence — ${describeEntry(e)}`, consumed.has(i), "its divergence is absent or no longer matches; remove or re-pin the entry");
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll checks passed.");
}

main();
