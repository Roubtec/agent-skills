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

Parse-check the shipped workflow sources — `plugins/dev-skills/workflows/wf-review-cycle.js`, `wf-address-review.js`, and `wf-address-tasks.js` — with powbox's `wf-check` where it has landed: it is built against the runtime's own loading, which nothing in this repo can speak for. It is not on PATH in this repo's powbox image (checked 2026-08-05), so until it lands, stand in for it with a hand-rolled wrapper — from the repository root, once per file:

```
D="$(mktemp -d "${TMPDIR:-/tmp}/wf-check.XXXXXX")" \
  && sed '1,/^export const meta/s/^export const meta/const meta/' <file> > "$D/body.js" \
  && { echo '(async function(args, agent, phase, workflow, parallel, pipeline, log){"use strict";'; cat "$D/body.js"; echo '});'; } > "$D/w.cjs" \
  && node --check "$D/w.cjs" && rm -rf "$D"
```

Do NOT substitute a bare `node --check <file>`: the first statement in these sources is `export const meta`, and Node's module-syntax detection swallows every parse error after that token, so a bare check can fail only on an error ahead of it, up in the header comment.

The two moves the parse turns on: `export const meta` becomes a plain `const`, so the file is no longer module syntax, and the `async` function body makes the top-level `await` these scripts use legal — not their top-level `return`, which the CommonJS parse the `.cjs` extension selects admits anyway. `sed` writes to a file rather than piping into the brace group so its own exit status gates the chain — piped, an unreadable `<file>` is masked, because the shell reports the pipeline's *last* status and the brace group wraps empty input happily. `"use strict";` is ours, not an observed runtime property: it only ever rejects more, and a module-loading runtime parses strictly anyway. `mktemp -d` keeps concurrent checks apart (`wf-address-tasks` fans out task worktrees whose agents may each run one, the rule in `wf-review-cycle.js`'s artifact-directory instruction), and a failing run leaves the directory behind: a parse error's line numbers refer to the wrapped file, and an empty `body.js` with no `w.cjs` means `sed` never read the source.

These behaviors were verified on 2026-08-05 with GNU sed 4.9 and Node v24.18.1, under both `bash` and `dash`:

- Exit 0 on each of the three sources, run from the repository root.
- Exit 2 — `sed`'s own status, before `node` runs — from a wrong cwd or a typo'd path.
- Exit 1 on all three with `let OBVIOUSLY_BROKEN = ;` appended.
- A bare `node --check` exits 0 on all three both unchanged and with that same error appended, and fails only when the error is placed before the `export`.
- Both halves of the wrapper are load-bearing: without the `sed`, all three fail with `SyntaxError: Unexpected token 'export'`; without the function body, or with a non-`async` one, all three fail with `SyntaxError: await is only valid in async functions and the top level bodies of modules`. Neither half is what admits their top-level `return` — `printf 'return 1;\n' > r.cjs && node --check r.cjs` exits 0.
- A parameter name colliding with a top-level `const`, `let`, or `class` is itself a parse error — `(async function(args, agent, meta, log){"use strict"; const meta = 1; });` → `SyntaxError: Identifier 'meta' has already been declared` — and after the `sed` all three sources declare exactly such a top-level `const meta`.

A pass is not a promise that the runtime will accept the file: this wrapper stands in for the runtime's wrapping rather than reproducing it. The real parameter list is not derivable here, and by the last measurement that guess is not neutral — a real list containing `meta` would reject what this stand-in accepts. Nothing past parsing is covered either (the `meta`-literal and determinism rules under *Authoring constraints*), so a pass means only that the source is syntactically valid in a shape that admits its top-level `await`.

Run `node scripts/test-checkout-cleanliness-report.mjs` for the focused regression suite covering `wf-address-tasks.js`'s `mainCheckoutSummary` function. The test extracts that function from the shipped workflow rather than maintaining a second copy.

Run `node scripts/test-subagent-destroy-boundary.mjs` after changing any prompt these workflows compose. It evaluates each shipped file's declaration prefix and renders every builder reached from an `agent()` call site, asserting the destroy boundary's clauses in the rendered text rather than in the source — the boundary lives in shared constants and in a section one workflow embeds byte-for-byte, so the sources read as covered long before every prompt carries it. The set of paths is discovered from the sources, and every `agent(` occurrence is accounted for, so a call shape the discovery does not recognize fails the suite instead of passing as nothing to render. What it cannot see is a new branch inside a builder it already renders: widen that builder's fixtures when one is added.

Run `node scripts/test-review-cycle-retirement.mjs` for the behavior suite covering the open-question retirement lifecycle — which terminal results may read as settled, which must still serve the question, and how a retirement naming nothing live is reported. It evaluates the shipped `review-cycle-core` section of BOTH workflow files with the injected globals stubbed and scripted fixer/reviewer packets driven through `runReviewCycle`, so the embedded copy is exercised as running code rather than only as identical bytes. Byte-identity is still the contract the section is mirrored under; this suite does not replace the `awk`/`diff` check above.
