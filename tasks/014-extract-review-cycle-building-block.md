# 014 — Extract the review cycle (fix -> own review -> peer review -> fix) as a reusable building block

## Why this task exists

The implement -> fresh-eyes review -> best-effort peer review -> fix loop is currently spelled out about ten times: in five prose skills (`address-review`, `address-reviews`, `address-tasks`, `-serialized`, `resolve-open-questions`), their five Codex mirrors, and inlined again in `wf-address-review.js` and `wf-address-tasks.js` — which, notably, carry NO peer step at all. Every protocol improvement (peer launch hardening, convergence heuristics, lifecycle contract) therefore fans out to ten edit sites, and the maintainer must restate the pattern in prose every time an ad-hoc change deserves the same treatment. Running this cycle locally, before a PR exists, is the cheapest place to catch findings: GitHub review rounds add days of latency and CI spend, so the PR should be the last sanity check, not the first reviewer. Extracting one canonical protocol with three renderings (prose skill, workflow, Codex mirror) makes the pattern a first-class drop-in and lets the consuming skills shrink to references plus their deltas.

## Scope

Included:

- **Canonical `review-cycle` skill** (`plugins/dev-skills/skills/review-cycle/`), both the referenced protocol and a user-invocable drop-in ("run the review cycle on this change/worktree/task file"). It defines, once:
  - the roles: fixer/implementer packet contract, fresh-eyes reviewer brief, best-effort peer step. The peer step is BORN invoking the powbox `peer-review-run` helper (schema `powbox.peer-review-run/v1`) as its baseline interface — `unavailable`/`timeout`/`forfeited` are explicit non-blocking outcomes and the peer is never required; 015 then layers the fallback pattern, prompt-guidance, and throttle on this single site, so the two tasks compose rather than circle;
  - the gates: grounding spot-check, blocking+minor peer findings both gate, verbatim finding relay, 12-round cap;
  - the disposition rule: every reviewer/peer finding is dispatched to a fixer that explicitly disposes each item — `fixed`, `declined` (with reason), or `escalated` to an open question — and the cycle ends only when the reviewer passes AND the fixer's last pass disposed nothing new. No finding is ever dropped by the orchestrator without an agent having considered it with full context.
  - a `light` mode that skips the final no-op fixer pass for small mechanical changes, at the invoker's explicit choice;
  - **artifact-type parameterization**: code diff (default), task-file/doc prose (reviewer checks verbiage, scoping, house numbering style), applied-decision diffs.
- **`wf-review-cycle` workflow** (`plugins/dev-skills/workflows/`), the same protocol as a self-contained script taking `{worktree, branch, base, scope, artifactType, maxRounds, peer, mode}`, where `maxRounds` may only **lower** the canonical 12-round cap, and only to a positive whole number of rounds — a caller asking for more gets 12, while `0`, a negative, or a fractional value is rejected outright rather than yielding a cycle that reviews nothing — so the convergence safeguard stays a property of the protocol rather than of each consumer's configuration, and no two consumers can quietly acquire different cap semantics. Its result contract is the information-flow backbone:
  - lean structured return: final verdict, per-finding dispositions (an `escalated` disposition names the question `id` it raised), `openQuestions[]` in the PINNED wire format below, and an `artifactDir` path holding the full per-round prose (reviewer reports, peer output, fixer packets) for anyone who needs the unabridged history. The format maps one-to-one onto the four-part brief `resolve-open-questions` serves (grounded context, concrete trigger, distinct options, recommendation) so a bare `resolve-open-questions` invocation consumes it without re-derivation — while its step-2 grounding still applies: every carried claim is re-verified against current state before serving, per item 5 of 019.

    ```
    openQuestions: [{
      id,                     // stable within the run (e.g. "<cycle-slug>-q1"); referenced by dispositions and coupledWith
      question,               // the decision itself, phrased as the fork — not a narrative
      origin,                 // reviewer | peer | implementer | rebase
      originRound,            // cycle round it arose in
      blocking,               // true: the cycle could not pass without the answer; false: parked nit/deferral
      artifacts: [],          // authoritative pointers only ("file:line", ref, PR/thread URL, task file) — never paraphrase
      trigger,                // the concrete situation that manifests the problem
      reachability,           // live | dormant | impossible-until | unknown — a CARRIED claim, re-derived before serving
      reachabilityCondition,  // the flag/prerequisite when dormant/impossible-until; empty otherwise
      options: [{ label, consequence }],  // drafted resolutions with blast radius; may be empty
      recommendation,         // escalator's pick + one-line why; empty when the call turns on maintainer intent
      coupledWith: []         // ids of sibling questions sharing the one underlying decision
    }]
    ```

  - open questions ALWAYS bubble up structurally (they exist for the human), bulk prose stays on disk behind the pointer — per-cycle unique dirs per the hygiene rules of 017;
  - deviations from locked decisions surface per the report-don't-correct rule of 025.
- **Embeddability**: structure the script so the cycle logic sits in clearly-delimited copyable functions with a marked embeddable section, and document both consumption modes — `workflow('wf-review-cycle', …)` child invocation where the runtime supports nesting, and synthesis (an orchestrator authoring a single flat workflow that embeds the section) where it does not, or where the consumer must own the launches the embedded logic makes (see 014a). An embedded copy carries a header naming the canonical section it was synthesized from, so a later edit to that section has a findable list of copies to refresh; how the refresh is carried out is the implementer's judgment rather than a generator or drift check pinned down here.
- **Consumer conversion**: `wf-address-review.js` / `wf-address-tasks.js` replace their inlined loops with the shared cycle (this closes their missing-peer gap); the five prose skills replace their restated protocol sections with a reference plus skill-specific deltas; `write-tasks` gains an explicit self-review + peer-review step on drafted task files (the verbiage cycle — suppressible in prose per invocation); `resolve-open-questions` runs a scoped cycle on each applied decision's diff.
- **Codex mirror**: `codex/dev-skills/skills/review-cycle/` carrying the same protocol with the peer direction flipped (`--provider claude`), referenced by the Codex skill mirrors.

Out of scope:

- Peer-launch mechanics and the adaptive concurrency throttle (015).
- The convergence-heuristic and lifecycle-contract TEXT (019, 025 — those tasks now write their content INTO this block; see their amended targets).
- Vertical pipelining of the batch flows (033).

## Context and references

- `plugins/dev-skills/skills/address-review/SKILL.md` — the richest current statement of the protocol (peer section, gates, round cap); the extraction's semantic baseline.
- `plugins/dev-skills/workflows/wf-address-{review,tasks}.js` (after 012) — the inlined loops to replace; note `wf-address-tasks`'s `VERDICT_SCHEMA` as the seed of the result contract.
- Tasks 015, 019, 025 — content that lands in (or is invoked by) the block; implement 014 first, then those three each edit ONE place.
- `resolve-open-questions/SKILL.md` — the downstream consumer of `openQuestions[]`; its item format is the target shape for escalations.

## Target files or areas

- `plugins/dev-skills/skills/review-cycle/` (new), `plugins/dev-skills/workflows/wf-review-cycle.js` (new), `codex/dev-skills/skills/review-cycle/` (new).
- `plugins/dev-skills/workflows/wf-address-{review,tasks}.js`, the five prose skills, `write-tasks/SKILL.md`, plus Codex mirrors (references, not restatement).

## Implementation notes

- Depends on 012 for the workflow home. The skill half can be drafted in parallel, but land together so consumers reference a complete block.
- While replacing the imported workflows' inlined loops, normalize the legacy unnamespaced invocation references retained in their comments by 012's verbatim relocation; the plugin-namespaced commands documented beside the workflows are authoritative in the meantime.
- Trimming is a goal: each consuming skill's protocol section should collapse to a reference plus deltas; if a consumer's text does not shrink, the extraction boundary is probably wrong.
- The disposition rule costs one extra fixer turn per cycle; that is the accepted price for "no finding dropped unconsidered" on meaningful changes — hence the explicit `light` opt-out rather than a heuristic.
- Escalated open questions must round-trip: `resolve-open-questions` with no arguments should be able to consume a completed cycle's `openQuestions[]` from context without re-derivation.

## Acceptance criteria

- One CANONICAL definition per harness (the `review-cycle` skill text for prose consumers; `wf-review-cycle.js` for workflows) — the Codex mirror and any copy synthesized from the marked section are derived renderings of it, each synthesized copy naming the section it came from; no consumer restates gates, round caps, or peer semantics in its own words.
- `wf-address-review` and `wf-address-tasks` invoke the shared cycle, including the peer step, via nesting or the embeddable section — `wf-address-tasks` by the embeddable section, because 014a requires the script that owns the fan-out to be the one making the peer launches its throttle governs.
- `maxRounds` is bounded at both ends: a caller passing a larger value still stops at 12, so no consumer can configure its way past the convergence safeguard, and a nonpositive or fractional value is rejected rather than silently producing a run that skips the review gate.
- `write-tasks` explicitly runs the verbiage cycle on drafted tasks by default.
- A cycle's result carries dispositions for every finding and structurally surfaces open questions; full round history is reachable via `artifactDir`.
- The drop-in works: invoking the skill on an ad-hoc uncommitted change runs the full cycle without batch scaffolding.

## Validation

- `node --check` on the workflow scripts.
- Dry-run the drop-in skill on a trivial local change (peer available and peer logged-out) — the second run must complete with the peer outcome recorded as non-blocking.
- Grep: no remaining inline restatement of the round-cap/gate text in consumer skills.

## Review plan

Reviewer checks the extraction is semantics-preserving against `address-review`'s current gate text, that the disposition rule cannot be read as weakening the reviewer gate (declines are reviewed next round, not final), and that `openQuestions[]` items match what `resolve-open-questions` can consume.
