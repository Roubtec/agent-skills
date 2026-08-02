# 015a — Let a peer `VERDICT: PASS` carry brief, optionally-actionable notes without context sprawl

> **Provenance:** re-homed from powbox task 029a when powbox forfeited its skills and workflows to this repo (powbox task 051). Its two named consumers were powbox's `wf-address-review.js` / `wf-address-tasks.js` and this repo's review skills; both now live here, so the whole task does. `peer-review-run` itself stays powbox-owned and is explicitly out of scope, exactly as before.

## Why this task exists

`peer-review-run` (powbox task 029) reduces a peer reviewer's output to a coarse helper-side `verdict` field (`pass | issues | none`, alongside the fuller `outcome`) plus an `artifactDir` pointer; the peer itself still emits only `VERDICT: PASS` or `VERDICT: ISSUES`, and nothing here changes that. The full review prose stays on disk and is not surfaced by default. Today's peer-prompt convention only asks for findings on `ISSUES`, so a `VERDICT: PASS` is a dead end — any nits the reviewer noticed are generated and then discarded. That wastes the tokens already spent and is mildly lossy: a "pass, but consider X" is more useful to a maintainer than a blunt pass.

The opportunity ("Lever 1" from the powbox PR #113 review discussion) is to shape the peer's OUTPUT so a pass can carry a few terse, optionally-actionable notes when justified, while keeping the orchestrator's context lean. This is a prompt-convention refinement, not new machinery: no second LLM to parse the first, and no change to the deterministic, hermetic helper.

## Scope

In scope — refine the peer-prompt convention used by the CALLERS of `peer-review-run` so the peer is asked to:

- reason as much as it needs, but STRUCTURE its final message compactly;
- emit the `VERDICT:` line exactly as today (first line, unchanged token contract);
- THEN, when justified, list a few terse notes/nits as one-line bullets — `path:line — <=~15 words` — INCLUDING on a `PASS` (framed as "note, not necessarily fix");
- keep the `PASS`/`ISSUES` bar exactly where it is: anything the peer thinks ought to be FIXED is a finding and still requires `VERDICT: ISSUES`, which 014/015 gate on regardless of whether it is tagged blocking or minor. A pass-note is by construction what fell BELOW that bar, so the notes section is a way to say the smaller thing the peer previously discarded — never a lighter channel for a finding it would otherwise have raised. Say this in the prompt itself: a peer told it may now write nits under a `PASS` will otherwise drift its minor findings there, and the gate quietly stops firing;
- stay brief: cap the notes (a small handful), and OMIT the section entirely when there is nothing material to say.

Apply the convention wherever a peer prompt is constructed. After 014 it is authored once — in the canonical `review-cycle` peer step and its `wf-review-cycle` rendering — and then carried into every derived rendering: the Codex mirror, and each copy synthesized from that rendering's embeddable section, which per 014 includes the one `wf-address-tasks` embeds so its throttle owns the peer launches. Before 014 it is every skill that still carries its own peer section, and only those: the two `wf-*` workflows construct no peer prompt to refine, because 014 is what gives them a peer step at all (see 014's opening), so they inherit the convention when that step is written rather than being swept now. Prefer landing this after 014 so the convention is authored once and refreshed into its copies rather than swept across ten files; if it lands first, sweep every constructor and let 014 inherit the wording.

Also: have the consuming skill/workflow surface a passing peer's notes COMPACTLY (e.g. one bullet each in the round summary), WITHOUT ingesting the full prose — a clean pass must stay a cheap one-line signal by default.

Out of scope (explicitly do NOT do):

- any change to powbox's `docker/shared/peer-review-run` itself — it stays prompt-neutral, deterministic, and hermetically testable (its offline unit suite, 198 checks at time of writing, must keep passing untouched). The `verdict` enum and the result schema do NOT change;
- a second LLM invocation to parse the peer's output;
- extracting or structuring findings INTO the result JSON — notes stay free text in `artifactDir`, read by the consumer only when it wants them;
- auto-acting on pass-notes — they are advisory because of where the bar sits (above), not because the gate was relaxed; a clean pass must not be turned into a fix round.

## Context and references

- powbox PR #113 (task 029 review-addressing) discussion: the verdict-parser hardening, and the "Lever 1 vs Lever 2" effort/cost analysis that motivated this task.
- powbox `docs/architecture.md` → the `peer-review-run` bullet: the result contract (`verdict`/`outcome`, `artifactDir`) and the "agent-skills adoption boundary" that names this repo as the downstream consumer of the invocation/result contract.
- The helper already feeds the prompt to the provider on stdin from `--prompt-file` (never argv), so shaping output is purely a prompt-wording change in the callers; the input surface is already confined.
- Task 015 — the peer step's invocation contract, fallback pattern, and prompt guidance; this task adds one more prompt rule on that same surface. Task 014 — the extraction that collapses the constructors to a single canonical definition the remaining renderings are derived from.

## Target files or areas

- After 014: `plugins/dev-skills/skills/review-cycle/SKILL.md`, `plugins/dev-skills/workflows/wf-review-cycle.js`, the `codex/dev-skills/skills/review-cycle/` mirror, and `plugins/dev-skills/workflows/wf-address-tasks.js`, which per 014 embeds its own copy of the cycle's peer step.
- Before 014: the peer-prompt sketches in `plugins/dev-skills/skills/{address-review,address-reviews,address-tasks,address-tasks-serialized,resolve-open-questions}/SKILL.md` and their `codex/dev-skills/skills/` mirrors — and nothing under `plugins/dev-skills/workflows/`, which holds no peer prompt until 014 writes one.
- Optionally a companion one-line note in powbox's `docs/architecture.md` recording the peer-prompt convention next to the contract — powbox-owned, not a prerequisite here.

## Implementation notes

- Preserve the token contract: the `VERDICT:` line stays first and verbatim (`VERDICT: PASS` / `VERDICT: ISSUES`), so the helper's `detect_verdict` needs no change.
- Conserve OUTPUT tokens, not reasoning: tell the peer to think freely, then report tersely. Do NOT instruct it to reason less — that would weaken adversarial-review depth, which is the whole point of a second opinion.
- Guard context sprawl: bound the notes (a small cap), require `path:line` anchors and a hard per-note word budget, and instruct "omit the notes section when there is nothing material." The consumer surfaces pass-notes as a compact list and must not pull the full review prose into the orchestrator's main context on a pass.
- Frame pass-notes as advisory ("note, not necessarily fix") to avoid scope creep on an otherwise-clean pass.
- Keep the Claude-side and Codex-side renderings in lockstep, and do not expand scope (no new result fields, no helper changes).

## Acceptance criteria

- The peer prompts ask for a compact, bounded notes/nits section that is populated (when justified) even on a `PASS`, with `path:line` anchors and a per-note word budget, and omitted when empty.
- A passing peer review with a nit results in the consumer surfacing that nit compactly (a short bullet), while a clean pass with nothing to say produces no notes and the usual one-line signal.
- `peer-review-run` and its powbox test suite are unchanged and still green.
- Every peer-prompt constructor in this repo carries the same convention — the Claude skills, their Codex mirrors, and, once 014 has created it, the workflow rendering — so no consumer drifts on the peer-prompt shape.

## Validation

- In a powbox container: `bash scripts/test-peer-review-run.sh` in the powbox checkout still passes unchanged (proves the helper/contract were not touched).
- Exercise one real review round (or a dry run) and confirm: a peer PASS with a nit surfaces it as a compact note; a clean PASS stays a one-line signal; the orchestrator context does not gain the full review prose on a pass.
- `node --check` any workflow file touched.

## Review plan

- Confirm powbox's `docker/shared/peer-review-run` and its suite are untouched — the change is prompt/consumer-side only.
- Read the revised peer prompts: verdict token unchanged; notes bounded (cap + word budget + `path:line`); pass-notes framed advisory; "omit when nothing material" present.
- Verify context hygiene: a pass surfaces at most a short note list, never the full prose, by default.
- Confirm the Claude and Codex renderings are consistent and no scope beyond the prompt convention crept in.

## Deferred option (do not implement here)

"Lever 2" — an out-of-context subagent that reads `artifactDir` and returns a distilled digest — remains available if peer output ever balloons enough that even the terse notes are heavy. It fits the architecture (map-reduce over the artifact) but is a heavier tool for a marginal gain, and Lever 1 (short output at the source) should make it unnecessary. Recorded as an option only; not scheduled.
