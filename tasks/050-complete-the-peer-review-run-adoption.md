# 050 — Complete the `peer-review-run` adoption now that both powbox prerequisites have landed

## Why this task exists

Task 015 adopted powbox's `peer-review-run` helper as the peer step's destination interface but could not switch to it, because two powbox-side prerequisites were unmet: the helper's Codex adapter discarded the configured high-capability model along with the rest of `~/.codex/config.toml`, and result schema `powbox.peer-review-run/v1` exposed only `artifactDir`, with no documented provider-neutral field holding the peer's full review prose to relay verbatim.
Both have since landed. Powbox task 029c ("Preserve the configured Codex model and expose peer review prose") is merged, and the installed helper carries both halves: it parses `${CODEX_HOME:-$HOME/.codex}/config.toml` with `tomllib` under an isolated interpreter and passes a safely resolved root `model` through as one `-m` argument, and it emits an additive `reviewFile` field — the absolute path of `<artifactDir>/review.txt`, the provider's full final review message with provider JSON envelopes decoded — for every `passed` and `issues` outcome on both providers.

So the deferral that both mirrors and both workflow cores currently ship as standing policy is now false, and the work it deferred is due.
This is a prose-deleting change rather than a feature: the shipped text in `wf-review-cycle.js`'s peer-stage header comment already states that "the outcome vocabulary below already matches the helper's, so the swap is a prompt change, not a control-flow change".

## Scope

Included:

- **Make the helper call the primary launch** in the `review-cycle` skill's Peer role, both mirrors, and in the byte-mirrored `review-cycle-core` section carried by `wf-review-cycle.js` and `wf-address-tasks.js`. The Claude-led side runs `--provider codex`; the Codex-led mirror runs `--provider claude`. Both pass `--worktree`, `--prompt-file`, `--artifact-root`, `--timeout`, and an explicit `--effort medium`, the last because the helper's own effort default is `high` for both providers. Neither passes `--model`: on the Codex side the point of the prerequisite is that an omitted model now resolves to the configured high-capability model, and on the Claude side the helper's documented default is already `opus`, which is what that mirror pins today.
- **Demote the hardened manual launch to the fallback** the shipped text already prescribes for it — taken when `command -v peer-review-run` fails, and on the capability-degradation route below. Keep it complete enough to run; do not leave it as a stub that names the helper.
- **Retire the deferral prose.** The "helper swap is deliberately incomplete on both providers" paragraph in both `review-cycle` mirrors, the two-prerequisite passage in `wf-review-cycle.js`'s peer-stage header comment, and the numbered prerequisite item inside `cyclePeerPrompt`'s peer brief all state a condition that no longer holds. Delete them rather than re-qualifying them; what survives is the fallback's own trigger, which is a live rule, not a record of a past blocker.
- **A capability probe on the result, not on the binary.** `reviewFile` is additive *within* schema v1, so the schema string cannot distinguish a helper that carries it from one that does not, and an older baked image may have either. Decide it from the result: a `passed` or `issues` outcome whose `reviewFile` is null or names a file that is not there is a helper too old to relay findings verbatim, so that round takes the manual fallback and the run records the degradation once rather than probing again per round.
- **Do not make `model: null` a fallback trigger.** For a Codex peer it has two causes that the result cannot tell apart — a helper predating the passthrough, and a user config with no root `model` (or one whose root `profile`/`model_provider` makes the model unsafe to forward, which powbox deliberately degrades the same way). In the second case the manual launch inherits exactly the same bare default, so falling back buys no strength and costs a round. Record the applied `model`/`effort` the result reports as a strength note in the cycle's peer record instead.
- **Preserve the verbatim-relay contract.** Read `reviewFile` and relay its bytes; never guess a filename below `artifactDir` and never parse a provider-native envelope. The existing rule that a pass-note is not a lighter channel for a finding is unchanged.
- **Preserve the Codex-led mirror's embedded diff-evidence contract.** That rendering builds its Claude peer's prompt with pinned base/tip OIDs and an embedded audit copy between `BEGIN EMBEDDED GIT EVIDENCE` and `END EMBEDDED GIT EVIDENCE`, and normalizes a missing OID or token proof to `forfeited` with an exact reason. The helper takes the prompt through `--prompt-file`, so that whole contract rides the swap unchanged — carry it, and carry both of its failure branches, rather than rebuilding it.
- **Caller-side wait sizing.** Keep the shipped figures: at least 570 seconds and strictly below the roughly 600-second tool cap, because the helper may make two 260-second attempts and spend roughly five seconds reaping each.
- **Update `scripts/verify-015-peer-review-run.md`.** Its step 5 currently *requires* the deferral to still hold and fails any path that consumes the helper's review payload; that expectation inverts. Its report shape's demand for "confirmation that both powbox prerequisites remain unmet" inverts with it.
- **Extend `scripts/test-review-cycle-retirement.mjs`** to pin the new peer launch shape and the capability-degradation route, alongside the byte-identity check it already makes over the two executable cores.
- **README's Focused tests entry** for that suite names the added coverage, and the `scripts/` map line for `verify-015-peer-review-run.md` stops describing "retained raw peer paths" as the thing it exercises.

Out of scope:

- Any change to review policy: the round cap, the disposition rules, the adaptive throttle's forfeiture-reason mapping, the shared preflight latch, and the non-blocking status of every peer outcome all stay exactly as they are.
- The direct-provider process-identity and PID-lifecycle helpers, which belong to the manual fallback and survive with it. The helper owns its own timeout, retry, and reaping on the primary path; do not wrap it in a second lifecycle.
- Closing powbox issue #145. It is powbox's to close, and this task must not wait on it — see the implementation note below.
- Changing what `peer-opinions=off` does, or introducing any new caller flag.

## Context and references

- `plugins/dev-skills/skills/review-cycle/SKILL.md` and its `codex/` mirror — the **Peer** role bullet, the "Preflight once per run" paragraph, "Review strength is pinned per invocation", "The helper swap is deliberately incomplete on both providers", and "Hardened manual launch".
- `plugins/dev-skills/workflows/wf-review-cycle.js` — the peer-stage header comment beginning "The peer's baseline interface is powbox's `peer-review-run` helper", and the symbols `cyclePeerPrompt`, `cyclePeerPreflightPrompt`, `normalizeCyclePeerResult`, `CYCLE_PEER_SCHEMA`, and `CYCLE_PEER_PREFLIGHT_SCHEMA`, all inside the section marked `BEGIN EMBEDDABLE SECTION: review-cycle-core`.
- `plugins/dev-skills/workflows/wf-address-tasks.js` — the byte-identical embedded copy of that section, carried under the header "Synthesized from wf-review-cycle.js EMBEDDABLE SECTION `review-cycle-core`".
- The installed helper itself, `peer-review-run` on `PATH` — its header comment states the result contract, and is the authority for flag spellings and field semantics. Powbox's own `docker/shared/peer-review-run` and `tasks/done/029c-preserve-configured-codex-model-in-peer-review-run.md` are the upstream record.
- Task 015 is the adoption this completes; task 014c corrected an earlier passthrough claim about the same helper. Both are archived and stay as written.

## Target files or areas

`plugins/dev-skills/skills/review-cycle/SKILL.md` and `codex/dev-skills/skills/review-cycle/SKILL.md`; the `review-cycle-core` section in `plugins/dev-skills/workflows/wf-review-cycle.js` and its embedded copy in `plugins/dev-skills/workflows/wf-address-tasks.js`; `scripts/test-review-cycle-retirement.mjs`; `scripts/verify-015-peer-review-run.md`; `README.md`.

`wf-address-review.js` needs no edit: it nests `wf-review-cycle` for its verify loop and so inherits the swap.

## Implementation notes

- **Verify against the installed helper, not against powbox issue #145, which is still open.** The issue is a tracking artifact; the code shipped with powbox task 029c. Confirm on the machine you implement on — that `peer-review-run` on `PATH` documents `reviewFile` in its result contract and reads `$CODEX_HOME/config.toml` — and say in the PR which build you confirmed against. A task that cites the open issue as evidence the prerequisite is unmet has read the wrong source.
- The two executable cores must stay byte-identical; `test-review-cycle-retirement.mjs` asserts it under the check named "the two executable review-cycle cores remain byte-identical". Edit the canonical copy in `wf-review-cycle.js` and re-synthesize, rather than hand-editing both.
- The two skill mirrors are hand-edited with no generator between them: change both in lockstep. Their divergence here is genuine — the mirrors launch opposite providers — so expect the paragraph to differ by provider and by nothing else.
- Establish `artifact_root` as a unique, private, session-scoped directory outside the reviewed worktree before the call, per the rule the shipped text already carries. The all-roles output-destination rule under **Artifacts and hygiene** governs it; do not compose a second placement rule here.
- Prefer deleting a case to adding one. The fallback exists because a real population runs older helpers; the degradation record exists because a silently weaker review is the failure this whole step guards against. Nothing else in the swap needs a branch.

## Acceptance criteria

- Both `review-cycle` mirrors and both workflow cores launch the peer through `peer-review-run` as the primary path, with `--effort medium` explicit and no `--model`, and reach the peer's full review through the result's `reviewFile`.
- No shipped file still states that a powbox prerequisite is outstanding, and none still instructs a reader to retain the raw launch as primary.
- The manual launch remains present and complete as the fallback, reachable on an absent helper and on a `passed`/`issues` result with no usable `reviewFile`, and a run that takes it says so once.
- A Codex-side result reporting `model: null` does not trigger the fallback; the applied `model`/`effort` are recorded either way.
- The Codex-led mirror's embedded-evidence prompt contract and both of its `forfeited`/annotated-`issues` failure branches are intact on the helper path.
- `scripts/verify-015-peer-review-run.md` asks an exerciser to confirm the swap rather than the deferral.
- The two embedded `review-cycle-core` sections are still byte-identical.

## Validation

- `node scripts/test-review-cycle-retirement.mjs` passes with the added cases, and the full `tests.yml` script set stays green.
- Exercise one real peer round per provider against a trivial committed change in a scratch worktree, following `scripts/verify-015-peer-review-run.md` as updated: confirm the applied model and `reasoning effort: medium` for the Codex peer, and that the relayed findings are the bytes of `reviewFile`.
- Exercise the degradation route with a stub `peer-review-run` on `PATH` that returns a `passed` result with `reviewFile: null`, and confirm the round takes the manual fallback and records the reason once.

## Review plan

Reviewer checks that the deferral prose is deleted rather than softened, that the fallback is a complete runnable path rather than a pointer, that the capability probe reads the result rather than the schema string or the binary's presence, that `model: null` is a note and not a fallback trigger and the task's reasoning for that distinction still holds against the installed helper's documented degradation cases, that no path guesses an artifact filename or parses a provider envelope, that the Codex-led mirror's evidence contract survived the move to `--prompt-file`, and that the two executable cores are byte-identical with the skill mirrors differing only by provider.
