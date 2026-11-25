#!/usr/bin/env node
// Guard for the files a skill ships beside its SKILL.md.
//
// A skill folder is copied whole to wherever its harness installs it, and a
// SKILL.md that says "read `reviewer-brief.md`, beside this file" or "run
// `stack.sh` by its path" only works when that file really sits there, in BOTH
// mirrors, with the mode the instruction assumes. Nothing else fails when one
// is forgotten: the skill still loads, and the first run to reach the sentence
// finds nothing to read. This suite fails first. Over
// `plugins/dev-skills/skills/` and `codex/dev-skills/skills/` it asserts:
//
//   MIRRORED   — a skill's bundled files (everything in its folder except
//                SKILL.md and Codex's `agents/` metadata) are the same set in
//                both mirrors, byte for byte.
//   MODE       — a bundled `*.sh` is committed executable (100755), since the
//                skills call these by path; anything else is 100644.
//   NAMED      — every bundled file is named by its own SKILL.md, or by another
//                bundled Markdown file in the folder, in each mirror: a file
//                nothing points at is dead weight in every install.
//   RESOLVES   — every `name.sh` / `name.md` a skill's prose mentions is either
//                bundled in that skill's folder, bundled in another skill that
//                some line of the same document names together with the file
//                (so a reader is told once whose file it is), or listed in
//                EXTERNAL below with the reason it lives elsewhere. The same
//                goes for the workflow scripts, which have no folder of their
//                own and so may name any skill's.
//   SHIMS      — each `plugins/dev-skills/bin/` shim that forwards into a skill
//                folder points at a bundled file that exists.
//
// A name is a bare lowercase `kebab-case.sh|.md` token: one with a path in
// front of it (`tasks/foo.md`), a numeric prefix (`024-foo.md`), an `=` before
// it (`peer-opinions=off.md`), or capitals
// (`AGENTS.md`, `SKILL.md`) is an example or a repository file, not a claim
// about the skill folder.
//
// When adding a file to a skill folder: add it to both mirrors, name it in the
// SKILL.md, and this suite needs no edit. When a skill starts naming a script
// that lives outside the folder, add it to EXTERNAL.
//
// Hermetic apart from `git ls-files` for the committed modes. Run:
//   node scripts/test-skill-bundled-files.mjs

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const TREES = { claude: "plugins/dev-skills/skills", codex: "codex/dev-skills/skills" };
const WORKFLOWS = "plugins/dev-skills/workflows";
const BIN = "plugins/dev-skills/bin";

// Names skills mention that are deliberately not in any skill folder.
const EXTERNAL = {
  "detect-shadows.sh": "powbox's shadow detector, on PATH in a powbox container",
  "shadow-refresh.sh": "powbox's shadow re-mount script, on PATH in a powbox container",
};

const NAME = /(?<![\w./=-])[a-z][a-z0-9-]*\.(?:sh|md)\b/g;

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`ok  - ${name}`);
  else {
    failures++;
    console.error(`NOT ok - ${name}${detail ? `: ${detail}` : ""}`);
  }
}

// ------------------------------------------------------------------ model --
// A model is { trees: { side: { skill: { file: { mode, text } } } },
//              workflows: { file: text }, shims: { name: text } }.
// `audit` is pure over it, so the negative cases below run on small fixtures.

function isBundled(file) {
  return file !== "SKILL.md" && !file.startsWith("agents/");
}

function audit(model, external = EXTERNAL) {
  const problems = [];
  const sides = Object.keys(model.trees);
  const usedExternal = new Set();
  const skills = [...new Set(sides.flatMap((s) => Object.keys(model.trees[s])))].sort();

  for (const skill of skills) {
    const folders = sides.map((s) => model.trees[s][skill] || {});
    const names = [...new Set(folders.flatMap((f) => Object.keys(f).filter(isBundled)))].sort();
    for (const file of names) {
      // MIRRORED
      const copies = folders.map((f) => f[file]);
      sides.forEach((s, i) => {
        if (!copies[i]) problems.push(`mirrored: ${skill}/${file} is missing from the ${s} mirror`);
      });
      if (copies.every(Boolean) && new Set(copies.map((c) => c.text)).size > 1) problems.push(`mirrored: ${skill}/${file} differs between the mirrors`);
      // MODE
      const want = file.endsWith(".sh") ? "100755" : "100644";
      sides.forEach((s, i) => {
        if (copies[i] && copies[i].mode !== want) problems.push(`mode: ${s} ${skill}/${file} is committed ${copies[i].mode}, expected ${want}`);
      });
    }
  }

  // Which skills bundle a given name, per side.
  const owners = {};
  for (const s of sides) {
    owners[s] = {};
    for (const [skill, folder] of Object.entries(model.trees[s])) for (const file of Object.keys(folder).filter(isBundled)) (owners[s][file] ||= []).push(skill);
  }

  // A skill's name, not the stem of a file name: `prune-branches.sh` on a line
  // does not say whose it is. A file's name, whole: `tool.sh` is not named by
  // `updated-tool.sh`.
  const mentions = (line, skill) => new RegExp(`(?<![\\w-])${skill}(?![\\w-]|\\.(?:sh|md)\\b)`).test(line);
  const names = (text, file) => new RegExp(`(?<![\\w-])${file.replace(/[.]/g, "\\.")}(?![\\w-])`).test(text);
  function resolve(where, text, side, ownSkill) {
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      for (const [name] of line.matchAll(NAME)) {
        const at = `${where}:${i + 1}`;
        const own = owners[side][name] || [];
        if (ownSkill && own.includes(ownSkill)) continue;
        if (own.length) {
          // A workflow has no folder, so any skill's file is in reach by name.
          if (!ownSkill || lines.some((l) => names(l, name) && own.some((skill) => mentions(l, skill)))) continue;
          problems.push(`resolves: ${at} names \`${name}\`, which ${ownSkill} does not bundle; ${own.join(", ")} does, and no line of the document names the file together with that skill`);
        } else if (name in external) usedExternal.add(name);
        else problems.push(`resolves: ${at} names \`${name}\`, which no skill folder bundles and EXTERNAL does not list`);
      }
    });
  }

  for (const s of sides) {
    for (const [skill, folder] of Object.entries(model.trees[s])) {
      const prose = Object.keys(folder).filter((f) => f.endsWith(".md") && !f.startsWith("agents/"));
      for (const file of prose) resolve(`${s} ${skill}/${file}`, folder[file].text, s, skill);
      // NAMED
      for (const file of Object.keys(folder).filter(isBundled)) {
        const named = prose.some((p) => p !== file && names(folder[p].text, file));
        if (!named) problems.push(`named: ${s} ${skill}/${file} is bundled but nothing in the folder names it`);
      }
    }
  }
  for (const [file, text] of Object.entries(model.workflows)) resolve(`workflows/${file}`, text, sides[0], null);

  // SHIMS
  for (const [name, text] of Object.entries(model.shims)) {
    const m = text.match(/^target="\$here\/\.\.\/skills\/([^/"]+)\/([^"]+)"$/m);
    if (!m) continue;
    if (!(model.trees[sides[0]][m[1]] || {})[m[2]]) problems.push(`shims: bin/${name} forwards to skills/${m[1]}/${m[2]}, which does not exist`);
  }

  for (const name of Object.keys(external)) if (!usedExternal.has(name)) problems.push(`external: \`${name}\` is listed in EXTERNAL but no skill names it any more`);
  return problems;
}

// ------------------------------------------------------------- real trees --

function loadTree(rel) {
  const modes = {};
  for (const line of execFileSync("git", ["-C", repo, "ls-files", "-s", "--", rel], { encoding: "utf8" }).split("\n")) {
    const m = line.match(/^(\d+) \S+ \d+\t(.+)$/);
    if (m) modes[m[2]] = m[1];
  }
  const tree = {};
  for (const skill of readdirSync(join(repo, rel))) {
    const dir = join(repo, rel, skill);
    if (!statSync(dir).isDirectory()) continue;
    tree[skill] = {};
    const walk = (sub) => {
      for (const entry of readdirSync(join(dir, sub), { withFileTypes: true })) {
        const file = sub ? `${sub}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(file);
        // An untracked file has no committed mode; report it as such rather than guess.
        else tree[skill][file] = { mode: modes[`${rel}/${skill}/${file}`] || "untracked", text: readFileSync(join(dir, file), "utf8") };
      }
    };
    walk("");
  }
  return tree;
}

function loadFlat(rel, keep) {
  const out = {};
  if (!existsSync(join(repo, rel))) return out;
  for (const name of readdirSync(join(repo, rel))) if (keep(name)) out[name] = readFileSync(join(repo, rel, name), "utf8");
  return out;
}

const real = {
  trees: Object.fromEntries(Object.entries(TREES).map(([side, rel]) => [side, loadTree(rel)])),
  workflows: loadFlat(WORKFLOWS, (n) => n.endsWith(".js")),
  shims: loadFlat(BIN, () => true),
};
const realProblems = audit(real);
check("every bundled skill file is mirrored, moded, named and resolvable", realProblems.length === 0, `\n  ${realProblems.join("\n  ")}`);
const bundledCount = Object.values(real.trees.claude).reduce((n, folder) => n + Object.keys(folder).filter(isBundled).length, 0);
check("the audit saw bundled files to check", bundledCount > 0, `${bundledCount} found`);
check("the audit saw forwarding shims to check", Object.values(real.shims).some((t) => /^target="\$here\/\.\.\/skills\//m.test(t)));

// --------------------------------------------------------------- fixtures --
// Each problem class must fire on a fixture that has exactly that defect, and
// a sound fixture must pass, or a silent audit above proves nothing.

const f = (text, mode = "100644") => ({ mode, text });
function fixture(edit) {
  const side = () => ({
    alpha: { "SKILL.md": f("Run `tool.sh` beside this file, then read `role-brief.md`.\n"), "tool.sh": f("#!/bin/sh\n", "100755"), "role-brief.md": f("Be careful.\n") },
    beta: { "SKILL.md": f("Hand the reviewer the alpha skill's `role-brief.md`, and run `far-away.sh`.\n") },
  });
  const model = { trees: { claude: side(), codex: side() }, workflows: { "wf.js": "const p = 'read role-brief.md';\n" }, shims: { "alpha-tool": 'target="$here/../skills/alpha/tool.sh"\n' } };
  model.trees.codex.alpha["agents/openai.yaml"] = f("name: alpha\n");
  if (edit) edit(model);
  return audit(model, { "far-away.sh": "lives elsewhere" });
}
const fires = (name, edit, pattern) => {
  const got = fixture(edit);
  check(`fixture: ${name}`, got.length >= 1 && got.some((p) => pattern.test(p)), JSON.stringify(got));
};

check("fixture: a sound pair of mirrors has no problems", fixture().length === 0, JSON.stringify(fixture()));
fires("a brief missing from one mirror is reported", (m) => delete m.trees.codex.alpha["role-brief.md"], /^mirrored: alpha\/role-brief\.md is missing from the codex mirror/);
fires("a helper that differs between the mirrors is reported", (m) => (m.trees.codex.alpha["tool.sh"].text += "echo drift\n"), /^mirrored: alpha\/tool\.sh differs/);
fires("a helper committed without the executable bit is reported", (m) => (m.trees.claude.alpha["tool.sh"].mode = "100644"), /^mode: claude alpha\/tool\.sh is committed 100644, expected 100755/);
fires("a bundled file nothing names is reported", (m) => { for (const s of ["claude", "codex"]) m.trees[s].beta["stray-brief.md"] = f("Unreferenced.\n"); }, /^named: claude beta\/stray-brief\.md/);
fires("a named file that no folder bundles is reported", (m) => (m.trees.claude.alpha["SKILL.md"].text += "Then read `missing-brief.md`.\n"), /^resolves: claude alpha\/SKILL\.md:2 names `missing-brief\.md`, which no skill folder bundles/);
fires("another skill's file named without naming that skill is reported", (m) => (m.trees.claude.beta["SKILL.md"].text += "Run `tool.sh` too, as alphabet does.\n"), /^resolves: claude beta\/SKILL\.md:2 names `tool\.sh`, which beta does not bundle; alpha does/);
fires("a file whose stem is its skill's name does not introduce itself", (m) => { for (const s of ["claude", "codex"]) { m.trees[s].gamma = { "SKILL.md": f("Run `gamma.sh`.\n"), "gamma.sh": f("#!/bin/sh\n", "100755") }; } m.trees.claude.beta["SKILL.md"].text += "Run `gamma.sh` beside this file.\n"; }, /^resolves: claude beta\/SKILL\.md:2 names `gamma\.sh`, which beta does not bundle; gamma does/);
fires("a bundled file is not named by a longer name that ends in it", (m) => { for (const s of ["claude", "codex"]) { m.trees[s].alpha["updated-tool.sh"] = f("#!/bin/sh\n", "100755"); m.trees[s].alpha["SKILL.md"] = f("Run `updated-tool.sh` beside this file, then read `role-brief.md`.\n"); } }, /^named: claude alpha\/tool\.sh is bundled but nothing in the folder names it/);
fires("a workflow naming a file no folder bundles is reported", (m) => (m.workflows["wf.js"] += "'read gone-brief.md'\n"), /^resolves: workflows\/wf\.js:2 names `gone-brief\.md`/);
fires("a shim forwarding to a missing file is reported", (m) => (m.shims["alpha-gone"] = 'target="$here/../skills/alpha/gone.sh"\n'), /^shims: bin\/alpha-gone forwards to skills\/alpha\/gone\.sh/);
fires("an EXTERNAL entry nothing names any more is reported", (m) => { for (const s of ["claude", "codex"]) m.trees[s].beta["SKILL.md"] = f("Hand the reviewer the alpha skill's `role-brief.md`.\n"); }, /^external: `far-away\.sh`/);
check("fixture: another skill's file introduced once with its skill may be named bare afterwards", fixture((m) => { for (const s of ["claude", "codex"]) m.trees[s].beta["SKILL.md"].text += "Then `role-brief.md` again.\n"; }).length === 0);
check("fixture: paths, numbered examples and capitalised repository files are not names", fixture((m) => { for (const s of ["claude", "codex"]) m.trees[s].beta["SKILL.md"].text += "See `tasks/done/foo.md`, `024-foo.md`, `AGENTS.md`, `tasks/039-peer-opinions=off.md` and `docs/x/build-notes.md`.\n"; }).length === 0);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
