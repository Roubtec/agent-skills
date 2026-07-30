# 015 — Adopt the peer-review-run contract in the review skills' peer steps

## Why this task exists

The skills that launch a cross-harness peer (`address-review`, `address-reviews`, `address-tasks`, `address-tasks-serialized`, `resolve-open-questions`) document a raw backgrounded launch (`codex exec --sandbox read-only --cd "$worktree" -o "$outfile" … &`, `address-review/SKILL.md:187`). Months of field use across kalm2, jabko, Scribz, and powbox sessions show that pattern is a reliability tarpit every orchestrator re-hits:

- run through a harness Bash tool, the wrapping shell exits immediately and the completion notification describes the **launcher**, not the peer — every launch needed a `nohup … &` workaround plus a `pgrep` liveness verification round-trip;
- `pgrep -f "codex exec"` returns the entire multi-KB prompt from the process command line (34 KB in one liveness check), and `pkill -f <token>` has killed the killing shell itself when the token appeared in its own argv;
- prompts assembled in double-quoted shell variables were corrupted by backtick/`$( )` expansion;
- a single foreground call capped by the Bash tool's 10-minute maximum silently forfeited the peer opinion on exactly the largest, most security-sensitive diffs (exit 143, no output file);
- an empty `-o` file is ambiguous between "still running", "finished but forfeited", and "crashed".

powbox now bakes `peer-review-run` (`/usr/local/bin/peer-review-run`), a provider-neutral runner that owns all of this: literal prompt-file handling (stdin, never shell-interpolated), read-only provider execution with config/hook isolation, process-group supervision with timeout, transient-only retry (auth/usage short-circuits to `unavailable`), reaping on every exit path, and a machine-readable result — final stdout line is one JSON object, schema `powbox.peer-review-run/v1`: `{ schema, provider, outcome, verdict, elapsedSeconds, exitStatus, attempts, retried, liveProgress, artifactDir, reason }`, `outcome ∈ passed | issues | unavailable | timeout | forfeited | failed`, exit 0 for any produced outcome. powbox's `docs/architecture.md` explicitly names this contract as the adoption boundary for these skills.

## Scope

Included:

- Replace the raw launch snippet in every affected skill's peer section with a `peer-review-run` invocation: `peer-review-run --provider codex --worktree "$worktree" --prompt-file "$promptfile" --artifact-root "$artifact_root" [--timeout N]` (Claude-led skills review with codex; the codex-side skill variants under `codex/dev-skills/` review with `--provider claude` — update those symmetrically).
- Map helper outcomes onto the skills' existing gate vocabulary: `issues`/`passed` feed the verdict logic unchanged; `unavailable`, `timeout`, `forfeited`, `failed` are the existing explicit non-blocking outcomes. The `artifactDir` points at the full review prose for verbatim relay to fixers.
- Keep the existing protocol semantics untouched: preflight-once, `peer-opinions=off`, grounding spot-check, blocking+minor gating, verbatim finding relay, peer never required for publication.
- Add a **fallback** paragraph for environments without the helper (`command -v peer-review-run` fails): the hardened manual pattern — write the prompt via quoted heredoc (`<<'PROMPT'`), launch with `nohup … &` with stdin closed and a unique per-attempt output path, check liveness by a unique token in the output path (never the prompt text), kill by PID captured at launch (never `pkill -f`), treat a non-empty result artifact containing a `VERDICT:` line as authoritative, and never run the peer as a capped foreground call. **The capture rule is provider-specific and must be written that way, not mirrored verbatim:** a codex peer writes its result via `-o <path>`, but `claude` has no `-o` flag, so a Claude peer — the provider the `codex/dev-skills/` mirrors fall back to — captures redirected stdout with stderr kept in a separate file (`claude -p … > <stdout-file> 2> <stderr-file>`, never `2>&1`), per the established contract in `tasks/done/001d-codex-task-loop-peer-opinions.md`. Copying the codex wording symmetrically into the mirrors would leave them naming an artifact their provider never produces.
- Peer prompt guidance additions (apply in the templates the skills carry): forbid network access (read-only sandboxes have no GitHub egress — pass verbatim thread text/diffs instead), and require the peer to state explicitly whether it **executed** tests or judged them statically (read-only sandboxes typically cannot write build-tool caches, so "this test would fail" is usually a static claim).
- Concurrency for the batch skills: an **optimistic session-local adaptive throttle**, not a fixed cap. Start unbounded; when peer outcomes show trouble (timeouts, `failed`, empty/garbled outputs — sustained fan-outs of concurrent `codex exec` runs have degraded into empty final outputs), cap NEW launches at 8 (or the current in-flight count if lower — in-flight calls are never killed, they just finish), halve on each further trouble cluster (4, then floor 2), and QUEUE invocations beyond the cap rather than forfeiting them. **The cap never drops below the floor of 2, whichever rule produced it:** the trouble that triggers a step-down is usually a peer *finishing* badly, so when the troubled call was the only one in flight the "current in-flight count" is zero — a literal reading would cap new launches at zero, queue every subsequent peer, and leave no running call whose completion could ever raise the cap again. Clamp to `max(2, …)` so the throttle always keeps draining the queue. Auth/usage short-circuits stay classified `unavailable` (non-blocking, not throttle events). The counter is session-local with no cross-container coordination (the maintainer runs several containers concurrently, so no global measure exists), resets next session, and every step-down is surfaced in the run summary so a future learnings pass can calibrate real limits.

Out of scope:

- Changes to `peer-review-run` itself (powbox-owned).
- The GitHub-bot re-ping flows (unrelated to the CLI peer).

## Context and references

- **Sequencing**: implement AFTER [014](014-extract-review-cycle-building-block.md). 014 already lands the baseline `peer-review-run` invocation inside the `review-cycle` block, so this task narrows to what 014 does not carry: the fallback paragraph, the no-network and executed-vs-static prompt guidance, the adaptive throttle below, and sweeping any pre-014 raw-launch text that still lingers in un-extracted copies. The per-skill target list below describes the pre-014 world; prefer landing 014 first over fanning the swap across ten files.
- `plugins/dev-skills/skills/address-review/SKILL.md:180-195` — the current launch snippet and gate rules (the semantics to preserve).
- `plugins/dev-skills/skills/address-tasks/SKILL.md:44,141` — preflight and the batch launch site.
- powbox `docker/shared/peer-review-run` header and `docs/architecture.md` (peer-review-run bullet) — the invocation/result contract; treat it as stable and cite the schema name rather than copying implementation detail.
- `codex/dev-skills/skills/*` — the codex-side variants needing the mirrored `--provider claude` update.
- `tasks/done/001d-codex-task-loop-peer-opinions.md` — the delivered Claude-as-peer invocation contract (redirected stdout, separate stderr, no `-o` flag); the fallback paragraph's Claude half must stay consistent with it.

## Target files or areas

- `plugins/dev-skills/skills/review-cycle/SKILL.md` and `plugins/dev-skills/workflows/wf-review-cycle.js` (the canonical peer step, once 014 lands), `codex/dev-skills/skills/review-cycle/` mirror.
- Pre-014 fallback: `plugins/dev-skills/skills/{address-review,address-reviews,address-tasks,address-tasks-serialized,resolve-open-questions}/SKILL.md` and `codex/dev-skills/skills/*` peer sections.

## Implementation notes

- A single supervised **foreground** `peer-review-run` call is now the recommended shape (the helper owns timeout/retry/reaping), sized under the caller's tool timeout via `--timeout`; where a skill wants reviewer+peer concurrency, launching the `peer-review-run` invocation in the background and reading its single-line JSON on completion is fine — the helper's PID is safe to track.
- Choose `--artifact-root` OUTSIDE the reviewed worktree (the helper requires it) and inside session-scoped scratch space; artifact dirs are per-invocation and private.
- Keep the diff-oriented prompt guidance: the Claude provider has no shell, so prompts should embed the diff or name the base ref.
- Do not grow the skills: this change should roughly swap snippet-for-snippet plus the short fallback paragraph; resist restating the helper's internals.

## Acceptance criteria

- No skill documents a raw `codex exec … &` launch as the primary path; all peer steps invoke `peer-review-run` and consume its JSON contract.
- The fallback paragraph exists once (or once per skill where structure demands) with the five hardening rules above, and its result-capture rule names each provider's own artifact (codex `-o`, Claude redirected stdout) rather than assuming `-o` exists everywhere.
- Peer prompt templates carry the no-network and executed-vs-static-verification instructions.
- Codex-side variants mirror the change with `--provider claude`.
- Existing gate semantics (grounding, blocking+minor, non-blocking unavailability, `peer-opinions=off`) are textually preserved.

## Validation

- Dry-run one `address-review` round in a powbox container against a disposable PR: peer launches via the helper, outcome JSON parses, an `unavailable` (e.g. codex logged out) round proceeds non-blocking.
- Grep check: no remaining `codex exec` launch instructions outside the fallback paragraphs.

## Review plan

Reviewer diffs each skill's peer section before/after to confirm semantics-preserving substitution, and checks the fallback pattern against the five failure modes listed in "Why this task exists" — each must be addressed or explicitly accepted.
