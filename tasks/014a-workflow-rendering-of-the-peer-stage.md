# 014a — Workflow-rendering rules for the peer stage (a workflow cannot shell out)

> **Provenance:** re-homed from powbox task 041 ("port the peer-review stage into `wf-address-tasks.js` and `wf-address-review.js` via `peer-review-run`") when powbox forfeited the workflows to this repo (powbox task 051). Task 012 recorded 041 as covered by 014/015, and its substance is: 014 gives the `wf-review-cycle` rendering a peer step and converts both `wf-address-*` workflows to it, and 015 supplies the invocation contract, fallback, prompt guidance, and throttle. What neither states is HOW a workflow — which cannot run a shell command — invokes a shell helper, and that is the residue this file carries so it is not rediscovered mid-implementation. Implement it inside 014 (or immediately after) rather than as a separate pass.

## Why this task exists

The peer step's baseline interface is `peer-review-run`, a shell helper. A prose skill invokes it directly, because the agent reading the skill has a Bash tool. A workflow script does not: `agent()`, `parallel()`, `pipeline()`, `log()`, `phase()` are its entire surface, there is no filesystem or child-process access, and so the workflow cannot call the helper at all. The peer stage therefore has a different shape in the workflow rendering than in the prose one, and an implementer who transcribes the prose step into `wf-review-cycle.js` produces a script that cannot run.

The disclosure half matters independently. Both workflows shipped for months with no peer step while their `meta.description`, `whenToUse`, and phase titles read exactly like the prose skills they were ported from. In a Scribz run the difference surfaced only after six tasks had already opened PRs with single-harness review, when the maintainer thought to ask "is this using peer reviews too?" — nothing in the workflow's own text could have answered that. Across kalm2, Scribz, and powbox sessions the peer repeatedly caught grounded defects the own-harness fresh reviewer had passed (false runbook claims, a duplicate-safety hole, unguarded timeout paths), so a silently single-harness workflow is a real quality gap, not a cosmetic one.

## Scope

Included — the workflow-specific rules the `wf-review-cycle` peer step (and, through it, `wf-address-review` / `wf-address-tasks`) must follow:

- **The peer invocation happens inside a subagent prompt, never in the script.** The stage's `agent()` prompt instructs its subagent to run `peer-review-run --provider <p> --worktree <wt> --prompt-file <f> --artifact-root <outside-worktree> --timeout <N>` and to return the parsed JSON result plus the verdict and any notes read out of the artifact file. Use `schema` on that `agent()` call so the result comes back validated rather than parsed out of prose. A single supervised foreground call is safe here only while `--timeout` is sized under the subagent's own Bash-tool limit, per 015's sizing rule: the helper owns timeout, retry, and reaping, but the enclosing tool outranks it, and a helper allowed to outlast that tool is killed mid-run and produces no outcome at all — the capped-foreground forfeiture on the largest diffs that 015 exists to end. Bounded that way, the historical "backgrounded peer + liveness polling" pattern and its footguns (the fallback paragraph of 015) do not apply when the helper is present — the subagent needs the fallback only for its `command -v` miss.
- **A peer subagent must never fail the stage.** `agent()` returns `null` when a subagent dies, and a thrown stage drops its item in `pipeline()`; both must land as a recorded non-blocking round outcome, exactly like the helper's own `unavailable` / `timeout` / `forfeited` results. The peer is never required for the cycle to conclude.
- **Disclose the peer gate in the script's own text.** `meta.description` (and `whenToUse` where present) states that review is cross-harness, and `meta.phases` gains an entry whose `title` matches the exact string passed to `phase()` / `opts.phase` for the peer stage — mismatched titles silently split the progress display into an extra group.
- **`peer-opinions=off` arrives through `args`,** not through prose the workflow cannot read; the parameter travels with the rest of the `wf-review-cycle` input contract (`{worktree, branch, base, scope, artifactType, maxRounds, peer, mode}` per 014) and is honoured by the consuming workflows passing it through.
- **Peer concurrency policy belongs to 015 and is not restated here.** 041 carried a fixed cap of 2–3 concurrent peer invocations; that number is not adopted, and this task sets no cap, floor, or fan-out shape of its own — read 015's throttle bullet for the policy and implement exactly it. The rendering-specific consequences, and all that is stated here, are two. The throttle lives as script state across the `parallel()` / `pipeline()` fan-outs, so it must not degenerate into launching the peers in fixed-size chunks — chunking bounds concurrency but silently loses the queueing, the step-downs, and the summary reporting that 015 requires. And it must live in the script that owns the fan-out — `wf-address-tasks`, beside the wave throttling already there — not inside the per-task cycle: under 014's `workflow('wf-review-cycle', …)` nesting each cycle is a separate child with its own state, so a throttle placed there counts one peer, never sees a sibling's, and reports as implemented while capping nothing. Holding the state there is only half of it, because the state has to reach the launches it governs, and under that same nesting the peer `agent()` call is still made inside the child while the outer `parallel()` has already started every child: the cycle's input contract carries no scheduler handle or shared queue back out, so a parent-held counter can neither observe a sibling's launch nor delay one, and the cap is as inert as it was in the child. The fan-out owner therefore consumes the cycle through 014's embeddable section rather than nesting it, so that the fan-out, every peer launch, and the throttle sit in one flat script's state — which also keeps 015's policy layered onto the cycle's single definition, the embedded section being that definition. Nesting stays fine for a consumer that does not fan out, such as `wf-address-review`, and would become fine here too if the cycle's input contract ever gained an explicit parent-controlled launch channel.

Out of scope:

- Changes to `peer-review-run` (powbox-owned).
- The peer prompt's wording and the concurrency policy — 015 owns the no-network and executed-vs-static rules and the throttle, 015a the pass-notes convention. This task covers only how the workflow rendering reaches the helper and reports the outcome.
- Restating the gate semantics (grounding spot-check, blocking + minor findings both gate, verbatim finding relay, 12-round cap) — 014 defines them once for every rendering.

## Context and references

- Task 014 — the canonical `review-cycle` protocol, the `wf-review-cycle` script, and the conversion of `wf-address-review.js` / `wf-address-tasks.js` (which closes their missing-peer gap). Task 015 — the `peer-review-run` invocation contract, fallback, prompt guidance, and the throttle; its concurrency bullet is the single source of that policy for every rendering, and this task depends on it rather than duplicating it. Task 015a — the pass-notes convention on the same prompts.
- powbox `docker/shared/peer-review-run` header — invocation and result contract (`outcome ∈ passed | issues | unavailable | timeout | forfeited | failed`; final stdout line is one JSON object, schema `powbox.peer-review-run/v1`; exit 0 for any produced outcome). powbox `docs/architecture.md` peer-review-run bullet names this repo as the adoption boundary.
- `plugins/dev-skills/workflows/README.md` — the authoring constraints these scripts live under (meta literal first, deterministic plain JS, no `Date.now()` / `Math.random()`).
- `plugins/dev-skills/skills/address-review/SKILL.md` — the prose peer protocol whose semantics the workflow rendering must not drop.
- powbox task 047 — the `wf-check` / `wf-status` helpers; `wf-check` applies the runtime's exact wrapping so a script with a top-level `return` validates properly. Use it if it has landed; otherwise `node --check` on the body wrapped as the runtime wraps it.

## Target files or areas

- `plugins/dev-skills/workflows/wf-review-cycle.js` (created by 014) — the peer stage itself.
- `plugins/dev-skills/workflows/wf-address-review.js`, `wf-address-tasks.js` — `meta` disclosure and `args` passthrough as they adopt the shared cycle, `wf-address-tasks` by embedding it per the throttle rule above.

## Acceptance criteria

- The workflow peer stage reaches `peer-review-run` only through a subagent prompt, and returns a schema-validated result; no script-level shell invocation exists (there is no API for one).
- A peer subagent that dies, times out, or reports `unavailable` / `forfeited` leaves the round recorded and the cycle running; no path aborts a batch on a peer outcome.
- `meta.description` discloses the cross-harness review, and every `phase()` / `opts.phase` string used by the stage has an exactly-matching `meta.phases` entry.
- `peer-opinions=off` passed through `args` suppresses the peer stage end to end, including in the consuming workflows.
- Peer concurrency is governed solely by 015's throttle: the script that owns the fan-out carries it as state, introduces no cap or floor of its own, and does not substitute a chunked fan-out for it. That script is also the one making the peer launches — `wf-address-tasks` embeds the cycle rather than nesting it — so no launch happens in a child the throttle can neither see nor delay.
- A rule-by-rule read against `address-review/SKILL.md`'s peer section finds nothing dropped in the workflow rendering.

## Validation

- `wf-check` (or the runtime-wrapped `node --check`) passes on every touched workflow.
- A `/dev-skills:wf-address-review` run against a disposable PR in a powbox container exercises one peer round end to end: the stage appears under its own phase, the peer result is recorded, and `peer-opinions=off` on a second run suppresses it.
- Force a peer failure (e.g. point the subagent at an unavailable provider) and confirm the round completes non-blocking.

## Review plan

Reviewer confirms the peer stage is subagent-mediated and schema-validated, that no peer outcome or subagent death can abort a stage or batch, that `meta` disclosure and phase titles match the code, and that concurrency is 015's policy carried as script state in the same script that launches the peers, rather than a cap or a chunked fan-out invented here.
