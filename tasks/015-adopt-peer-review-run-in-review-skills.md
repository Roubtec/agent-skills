# 015 — Adopt the peer-review-run contract in the review skills' peer steps

## Why this task exists

The skills that launch a cross-harness peer (`address-review`, `address-reviews`, `address-tasks`, `address-tasks-serialized`, `resolve-open-questions`) document a raw backgrounded launch (`codex exec --sandbox read-only --cd "$worktree" -o "$outfile" … &`, `address-review/SKILL.md:187`).
Months of field use across kalm2, jabko, Scribz, and powbox sessions show that pattern is a reliability tarpit every orchestrator re-hits:

- run through a harness Bash tool, the wrapping shell exits immediately and the completion notification describes the **launcher**, not the peer — every launch needed a `nohup … &` workaround plus a `pgrep` liveness verification round-trip;
- `pgrep -f "codex exec"` returns the entire multi-KB prompt from the process command line (34 KB in one liveness check), and `pkill -f <token>` has killed the killing shell itself when the token appeared in its own argv;
- prompts assembled in double-quoted shell variables were corrupted by backtick/`$( )` expansion;
- a single foreground call capped by the Bash tool's 10-minute maximum silently forfeited the peer opinion on exactly the largest, most security-sensitive diffs (exit 143, no output file);
- an empty `-o` file is ambiguous between "still running", "finished but forfeited", and "crashed".

powbox now bakes `peer-review-run` (`/usr/local/bin/peer-review-run`), a provider-neutral runner that owns all of this: literal prompt-file handling (stdin, never shell-interpolated), read-only provider execution with config/hook isolation, process-group supervision with timeout, transient-only retry (auth/usage short-circuits to `unavailable`), reaping on every exit path, and a machine-readable result — final stdout line is one JSON object, schema `powbox.peer-review-run/v1`: `{ schema, provider, outcome, verdict, elapsedSeconds, exitStatus, attempts, retried, liveProgress, artifactDir, reason }`, `outcome ∈ passed | issues | unavailable | timeout | forfeited | failed`, exit 0 for any produced outcome.
powbox's `docs/architecture.md` explicitly names this contract as the adoption boundary for these skills.

## Scope

Included:

- Replace the raw launch snippet in every affected skill's peer section with a `peer-review-run` invocation: `peer-review-run --provider codex --worktree "$worktree" --prompt-file "$promptfile" --artifact-root "$artifact_root" [--timeout N]` (Claude-led skills review with codex; the codex-side skill variants under `codex/dev-skills/` review with `--provider claude` — update those symmetrically).
- Map helper outcomes onto the skills' existing gate vocabulary: `issues`/`passed` feed the verdict logic unchanged; `unavailable`, `timeout`, `forfeited`, `failed` are the existing explicit non-blocking outcomes. The `artifactDir` points at the full review prose for verbatim relay to fixers.
- Keep the existing protocol semantics untouched: preflight-once, `peer-opinions=off`, grounding spot-check, blocking+minor gating, verbatim finding relay, peer never required for publication.
- Add a **fallback** paragraph for environments without the helper (`command -v peer-review-run` fails): the hardened manual pattern — write the prompt via quoted heredoc (`<<'PROMPT'`), launch with `nohup … &` with stdin closed and a unique per-attempt output path, check liveness by a unique token in the output path (never the prompt text), kill by PID captured at launch (never `pkill -f`), treat a non-empty `-o` containing a `VERDICT:` line as authoritative, and never run the peer as a capped foreground call.
- Peer prompt guidance additions (apply in the templates the skills carry): forbid network access (read-only sandboxes have no GitHub egress — pass verbatim thread text/diffs instead), and require the peer to state explicitly whether it **executed** tests or judged them statically (read-only sandboxes typically cannot write build-tool caches, so "this test would fail" is usually a static claim).
- Concurrency note for the batch skills: cap simultaneous peer invocations (2–3) — sustained fan-outs of concurrent `codex exec` runs have been observed to degrade into empty final outputs.

Out of scope:

- Changes to `peer-review-run` itself (powbox-owned).
- The GitHub-bot re-ping flows (unrelated to the CLI peer).

## Context and references

- `plugins/dev-skills/skills/address-review/SKILL.md:180-195` — the current launch snippet and gate rules (the semantics to preserve).
- `plugins/dev-skills/skills/address-tasks/SKILL.md:44,141` — preflight and the batch launch site.
- powbox `docker/shared/peer-review-run` header and `docs/architecture.md` (peer-review-run bullet) — the invocation/result contract; treat it as stable and cite the schema name rather than copying implementation detail.
- `codex/dev-skills/skills/*` — the codex-side variants needing the mirrored `--provider claude` update.

## Target files or areas

- `plugins/dev-skills/skills/{address-review,address-reviews,address-tasks,address-tasks-serialized,resolve-open-questions}/SKILL.md`
- `codex/dev-skills/skills/*` peer sections

## Implementation notes

- A single supervised **foreground** `peer-review-run` call is now the recommended shape (the helper owns timeout/retry/reaping), sized under the caller's tool timeout via `--timeout`; where a skill wants reviewer+peer concurrency, launching the `peer-review-run` invocation in the background and reading its single-line JSON on completion is fine — the helper's PID is safe to track.
- Choose `--artifact-root` OUTSIDE the reviewed worktree (the helper requires it) and inside session-scoped scratch space; artifact dirs are per-invocation and private.
- Keep the diff-oriented prompt guidance: the Claude provider has no shell, so prompts should embed the diff or name the base ref.
- Do not grow the skills: this change should roughly swap snippet-for-snippet plus the short fallback paragraph; resist restating the helper's internals.

## Acceptance criteria

- No skill documents a raw `codex exec … &` launch as the primary path; all peer steps invoke `peer-review-run` and consume its JSON contract.
- The fallback paragraph exists once (or once per skill where structure demands) with the five hardening rules above.
- Peer prompt templates carry the no-network and executed-vs-static-verification instructions.
- Codex-side variants mirror the change with `--provider claude`.
- Existing gate semantics (grounding, blocking+minor, non-blocking unavailability, `peer-opinions=off`) are textually preserved.

## Validation

- Dry-run one `address-review` round in a powbox container against a disposable PR: peer launches via the helper, outcome JSON parses, an `unavailable` (e.g. codex logged out) round proceeds non-blocking.
- Grep check: no remaining `codex exec` launch instructions outside the fallback paragraphs.

## Review plan

Reviewer diffs each skill's peer section before/after to confirm semantics-preserving substitution, and checks the fallback pattern against the five failure modes listed in "Why this task exists" — each must be addressed or explicitly accepted.
