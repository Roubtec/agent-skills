# Claude Dynamic Workflows

These are Claude-only dynamic-workflow counterparts to selected development skills: deterministic JavaScript orchestration scripts that spawn and sequence agents while leaving judgment and side effects to those agents. Codex has no workflow runtime, so this directory has no Codex sibling.

The workflows are distributed by the `dev-skills` plugin and register in its namespace: invoke `/dev-skills:wf-address-review`, `/dev-skills:wf-address-tasks`, or `/dev-skills:wf-review-cycle`.

Task 014 replaced the imported workflows' inlined review loops with the shared `wf-review-cycle` and normalized the legacy unnamespaced invocation references their comments carried from the powbox import; the plugin-namespaced commands above are the invocation guidance.

## Availability

These runtime facts were verified on 2026-06-10 against the documentation and Claude Code 2.1.170:

- Dynamic workflows require Claude Code 2.1.154 or newer and a paid Claude plan or supported API provider.
- Pro accounts default workflows off; enable them with the Dynamic workflows row in `/config`, which writes `"enableWorkflows": true` to `~/.claude/settings.json`. The explicit off switches are `"disableWorkflows": true` and `CLAUDE_CODE_DISABLE_WORKFLOWS=1`.
- Claude Code caches the effective plan in `~/.claude/.credentials.json`; re-login refreshes a stale `subscriptionType`, while an explicit `enableWorkflows` setting avoids relying on that default.

## Authoring constraints

- `export const meta = {...}` must be the script's first statement. The runtime registers the command only after parsing that pure literal, whose required fields are `name` and `description`; optional fields include `title`, `whenToUse`, and `phases`.
- Scripts must be deterministic plain JavaScript. `Date.now()`, `Math.random()`, and argument-less `new Date()` are rejected because they break resume, and TypeScript syntax does not parse.
- Workflow scripts own control flow; spawned agents own repository, shell, and Git work. A blocker is returned instead of prompting for input mid-run.

## Worktree model

The runtime's `agent(..., { isolation: "worktree" })` creates a separate temporary worktree for each agent from the repository's default branch, at a runtime-chosen location with no documented redirection option. That would hide an implementer's commits from its reviewer and cannot preserve one stable task worktree across stages.

`wf-address-tasks.js` therefore uses one explicit worktree per task and reuses it for the implementer, reviewer, and later fix rounds. Independent tasks still run concurrently, while sharing the on-disk task worktree makes commits visible across stages. The workflow depends on the environment-provided `wt-bootstrap`, `wt-enter`, and `wt-remove` helpers and reports a blocker when they are unavailable.

`wf-address-review.js` is a single-PR sequential pipeline, so its agents deliberately share the current checkout rather than creating worktrees.

The shared-filesystem assumption was verified on 2026-06-10 with Claude Code 2.1.170: a separately spawned agent could find the first agent's worktree, file, and commit, and a two-task workflow run kept each reviewer on its implementer's task worktree.

## Current scope

`wf-review-cycle.js` is the canonical review cycle for workflows: fixer -> fresh-eyes reviewer -> best-effort cross-harness codex peer -> fix, with explicit finding dispositions, escalated open questions in a pinned wire format, and the canonical round cap. Its cycle logic sits in a marked embeddable section (`review-cycle-core`) with two documented consumption modes — nesting via `workflow("wf-review-cycle", ...)`, and synthesis of the marked section into a flat consumer script.

`wf-address-tasks.js` expresses dependency waves, storage-aware throttling, sibling collision handling, and per-task PR creation, running each task through an embedded copy of `review-cycle-core` (embedded rather than nested so the fan-out owner makes every peer launch in its own flat state — where task 015's throttle will live — and hands every per-task cycle one shared batch-wide peer preflight/availability state). It does not build the post-batch local review stack produced by the `address-tasks` skill.

`wf-address-review.js` nests `wf-review-cycle` for its verify loop and conditionally publishes based on its flags. With no mid-run input, it behaves like the skill's hands-off mode: agents decide low-stakes ambiguity and report high-stakes blockers.

`rebase-stack` remains a skill because its value is sequential conflict judgment and user confirmation rather than agent fan-out.

## Validation

Parse-check the shipped workflow sources — `plugins/dev-skills/workflows/wf-review-cycle.js`, `wf-address-review.js`, and `wf-address-tasks.js` — with powbox's `wf-check` where it has landed: it is built against the runtime's own loading, which nothing in this repo can speak for. It is not on PATH in the powbox image this repo is developed in (checked 2026-08-05), so until it lands, stand in for it with a hand-rolled wrapper — from the repository root, once per file:

```
D="$(mktemp -d "${TMPDIR:-/tmp}/wf-check.XXXXXX")" \
  && sed '1,/^export const meta/s/^export const meta/const meta/' <file> \
  | { echo '(async function(args, agent, phase, workflow, parallel, pipeline, log){"use strict";'; cat; echo '});'; } > "$D/w.cjs" \
  && node --check "$D/w.cjs" && rm -rf "$D"
```

That wrapper is a stand-in, not a reproduction of the runtime's wrapping, and it is worth knowing which half is which. What it does reproduce is the two things the parse turns on: `export const meta` becomes a plain `const`, so the file is no longer module syntax whose detection swallows later errors (see below), and a function body makes the top-level `return` these scripts use legal. `"use strict";` is ours rather than an observed runtime property — included because it only ever rejects more: all three shipped sources pass with it, while it catches syntax sloppy mode accepts (`with(Math){}` — exit 1 strict, exit 0 sloppy), and a runtime that reads `export const meta` by loading the file as a module parses strictly anyway (verified 2026-08-05, Node v24.18.1). What it does NOT reproduce is anything past parsing: the runtime's real parameter list is not derivable from this repo — harmless, since parameter names cannot change parse validity — and neither is whatever else the runtime enforces when it loads a workflow (the `meta`-literal and determinism rules under *Authoring constraints*, for two). So a pass here means the source is syntactically valid in a shape that admits its top-level `return`, not that the runtime will accept it.

The wrapper lands in an `mktemp -d` directory rather than a fixed path because `wf-address-tasks` gives each task its own worktree, so several agents can be running this same check concurrently — the rule the cycle already applies to its own scratch ("never a fixed shared name: parallel cycles share scratch space", in `wf-review-cycle.js`'s artifact-directory instruction). A failing run leaves the directory behind on purpose: the reported line number refers to the wrapped file, not the source.

Do NOT substitute a bare `node --check <file>` on these `.js` sources: it cannot fail on them, so it distinguishes nothing. Verified 2026-08-05 on Node v24.18.1 — all three pass it unchanged AND still pass it with `let OBVIOUSLY_BROKEN = ;` appended; once a `.js` file contains a top-level `export`, an error after it is swallowed, and only an error placed *before* that first module-syntax token is still caught. The wrapped form above passes on all three files and does exit 1 on that same appended error, which is why it is the instruction here. (The bare check's exit 0 rests on Node's module-syntax detection; take that away and the same source fails, but on a different token per variant. Renamed to `.mjs` it is parsed as a module and fails on the top-level `return` the runtime's wrapping makes legal — `SyntaxError: Illegal return statement`. Under `--no-experimental-detect-module`, or renamed to `.cjs`, it is parsed as CommonJS instead, where a top-level `return` is legal and the failure is `SyntaxError: Unexpected token 'export'` at the `export const meta` line. All three sources behave that way, on the same date and Node build.)

Run `node scripts/test-checkout-cleanliness-report.mjs` for the focused regression suite covering `wf-address-tasks.js`'s `mainCheckoutSummary` function. The test extracts that function from the shipped workflow rather than maintaining a second copy.
