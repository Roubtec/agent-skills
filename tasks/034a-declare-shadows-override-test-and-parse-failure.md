# 034a — declare-shadows: quote powbox's guarded override test and its parse-failure fallback

## Why this task exists

Task 034 taught `enable-worktrees` to detect an active `.powbox.local.yml` shadow override using powbox's own test verbatim, including both halves of it and what happens when the file is unparseable. The sibling `declare-shadows` skill, which PR #34 fixed for the same class of gap, describes the override in prose only: "If `$ROOT/.powbox.local.yml` exists and has a top-level `shadow:` key, it **replaces the committed `.powbox.yml` list wholesale**". The rule is correct as far as it goes, but two things `detect-shadows.sh` actually does are absent.

First, the concrete test is not quoted, so an implementer has to invent one. `detect-shadows.sh` uses `[ -f "$POWBOX_LOCAL_YML" ] && [ "$(yq -r 'has("shadow")' "$POWBOX_LOCAL_YML" 2>/dev/null || true)" = true ]` — the existence guard and the `has("shadow")` probe together, with `yq` errors swallowed. `enable-worktrees` now quotes exactly that (the Copilot finding on PR #41 was that a half-quoted version invites an unguarded `yq` that errors noisily on a repo with no local file); `declare-shadows` quotes none of it, so the same trap is reachable there by a different route.

Second, and more substantively, `declare-shadows` never says what an unparseable `.powbox.local.yml` means. powbox's `|| true` makes a parse failure indistinguishable from "no `shadow:` key": the override is simply not active and `.powbox.yml` becomes genuinely the effective list, with no override log emitted. The skill's fail-closed rule covers a *malformed `shadow:` value* (null, scalar, mapping, list with a null/collection/empty member) and tells the agent to stop and report — correctly — but an agent that cannot parse the file at all is left to choose between stopping (diverging from powbox, which quietly proceeds on the committed list) and guessing. The conservative failure mode is a halted run reporting an override problem that powbox does not have; nothing unsafe is written, which is why this is minor rather than a bug.

The gap was raised by the cross-harness codex peer during PR #41's review cycle. It was declined there on scope: task 034's Scope section names "Any change to `declare-shadows`, which PR #34 already fixed" as explicitly out of scope, and PR #41 touches only the `enable-worktrees` mirrors. This task file is the record of the deferral.

## Scope

Included:

- In `declare-shadows` step 2, quote powbox's own override test with both halves — the `[ -f … ]` existence guard and the `yq -r 'has("shadow")' … 2>/dev/null` probe — and say to guard the `yq` call on the existence test rather than running it unconditionally, matching the wording task 034 landed in `enable-worktrees` step 2.
- State the parse-failure rule explicitly: an unparseable `.powbox.local.yml` is no override, because powbox treats it as none and falls back to `.powbox.yml`, which is then genuinely the effective list. Distinguish it from the existing malformed-`shadow:`-value rule, which still stops and reports.
- Keep the change proportionate — this is wording in one step, not a restructuring of the override handling that PR #34 already settled.
- Apply to both harness renderings, which must stay in parity apart from harness-specific wording and each file's own line style.

Out of scope:

- Any change to `enable-worktrees`, which task 034 and PR #41 already cover.
- The step 3 candidate enumeration, the step 6/step 8 write and commit steps, or the resolution model (retire the override vs. mirror the change into it) — all unchanged.
- Teaching either skill to merge override sections beyond `shadow:`.

## Context and references

- 034 — the parent task; its Implementation notes ("quote it rather than inventing a variant") and its Scope exclusion of `declare-shadows` are why this is a separate task.
- PR #41 (`task/034-enable-worktrees-respect-local-shadow-override`) — the review cycle where the codex peer raised the divergence and it was declined on scope. The Copilot finding it echoes is on `plugins/dev-skills/skills/enable-worktrees/SKILL.md:56` and `codex/dev-skills/skills/enable-worktrees/SKILL.md:46`.
- `plugins/dev-skills/skills/enable-worktrees/SKILL.md` step 2 (currently line 46) and `codex/dev-skills/skills/enable-worktrees/SKILL.md` step 2 (currently line 56) — the settled wording to mirror.
- `plugins/dev-skills/skills/declare-shadows/SKILL.md` step 2 (currently line 66) and `codex/dev-skills/skills/declare-shadows/SKILL.md` step 2 (currently line 81) — the paragraphs to edit.
- powbox `detect-shadows.sh`, the `POWBOX_LOCAL_YML` branch — the authority for both the test and the `|| true` swallow.

## Target files or areas

- `plugins/dev-skills/skills/declare-shadows/SKILL.md`
- `codex/dev-skills/skills/declare-shadows/SKILL.md`

## Implementation notes

- Reuse the `enable-worktrees` sentences rather than paraphrasing them; two skills stating the same powbox contract in two different ways is how the divergence arose.
- The existing "An active `shadow:` still has to be a list of non-empty string paths…" sentence stays as is. Parse failure and malformed value are different conditions with opposite outcomes — fall back silently vs. stop and report — so the text must not blur them.
- `declare-shadows` step 2 is already a dense paragraph; prefer tightening to appending if the addition makes it unreadable.

## Acceptance criteria

- `declare-shadows` step 2 quotes the same two-part test as `enable-worktrees` step 2, including the instruction to guard `yq` on the existence check.
- A run against a repo whose `.powbox.local.yml` is unparseable proceeds on `.powbox.yml` as the effective list and reports no override, rather than stopping.
- A run against a repo whose `.powbox.local.yml` carries a malformed `shadow:` value still stops and reports, unchanged.
- A `.powbox.local.yml` with only `ctx:` remains a no-op.
- Both mirrors carry the change and differ only in harness-specific wording and line style.

## Validation

- In a scratch repo, exercise four local-file states — absent, `ctx:`-only, unparseable YAML, and a well-formed `shadow:` list — and confirm the skill's stated outcome matches what `detect-shadows.sh` actually emits in each (including which file it logs as the source and whether the override log line appears).
- Diff the two `declare-shadows` mirrors to confirm the edit landed identically in both.

## Review plan

Reviewer checks that the quoted test matches `detect-shadows.sh` character for character in both halves, that the parse-failure rule states fallback rather than fail-closed and does not contaminate the malformed-value rule that must stay fail-closed, that the wording matches `enable-worktrees` step 2 rather than paraphrasing it, and that the two mirrors stay in parity.
