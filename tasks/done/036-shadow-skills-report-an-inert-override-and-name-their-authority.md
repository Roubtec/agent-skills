# 036 — enable-worktrees + declare-shadows: report an inert `.powbox.local.yml`, and name the script both skills treat as authority

## Why this task exists

Task 034 taught `enable-worktrees` to detect an active `.powbox.local.yml` shadow override using powbox's own guarded test, and 034a mirrored that wording into `declare-shadows`. Three small things are left, and they are grouped here because each one has to land in **both** skills or not at all — fixing any of them in one skill alone re-opens exactly the divergence 034a closed.

**Neither skill reports a local file that exists but does not parse.** `detect-shadows.sh` swallows `yq` errors with `|| true`, so a parse failure is indistinguishable from "no `shadow:` key": the override is simply not active, `.powbox.yml` becomes genuinely the effective list, and no override log is emitted. 034a taught both skills to state that fallback, correctly. But each skill's Report section then says only whether an override is *in effect* (`enable-worktrees` step 7) or *masking the committed list* (`declare-shadows`'s Report). A user who wrote a malformed `.powbox.local.yml` therefore gets their intended override silently ignored by powbox and silently unmentioned by the skill. Verified in a container on 2026-08-08: a local file whose YAML does not parse — one deliberately still containing a textual `shadow:` key — emitted the committed list with no override log at all.

This is the one case where the agent knows something the user would want to know and says nothing. It is minor because nothing unsafe is written; it is worth fixing because the whole point of the Report section is to tell the user which file won.

**One sentence is loose in both skills.** The shared step-2 wording says to guard the `yq` call on the existence test because "on a repo with no local file at all it simply errors". The command quoted one clause earlier carries `2>/dev/null`, so that error is *silent* and yields the same no-override answer. The guard is hygiene — no pointless call, no stray non-zero — rather than a fix for noise. The sentence sits next to the command that contradicts it.

**Six sites treat `detect-shadows.sh` as the authority; none says where it is.** Both skills cite it by name as the thing their rules must agree with, and neither states that powbox bakes it onto `PATH`. During 034a's implementation the orchestrator had to hedge the implementer's prompt — "it may or may not be reachable; do not fabricate its output" — and the implementer found it at `/usr/local/bin/detect-shadows.sh` anyway and validated the full four-state sweep against the real script rather than against the task file's quotation of it. Naming the path is what lets the *next* such task instruct "verify against the real script" without a hedge.

## Scope

Included:

- **An inert-override clause in each skill's Report section:** a `.powbox.local.yml` that exists but does not parse is reported as present but inert, with `.powbox.yml` named as the genuinely effective list. Distinct from the existing malformed-`shadow:`-value rule, which stops and reports and stays exactly as it is.
- **Reword the "simply errors" clause** in the shared step-2 wording so it reflects the `2>/dev/null` in the command it sits beside: the unguarded call errors *silently* and returns the same answer, so the existence guard is hygiene rather than a behaviour fix. Keep the instruction to guard.
- **State where the authority lives:** powbox bakes `detect-shadows.sh` onto `PATH` in its containers, so a skill's claims about shadow detection can be checked against the script itself.
- **All four mirror files**, which must stay in parity apart from harness-specific wording and each file's own line style.

Out of scope:

- The override-detection test itself and the fallback rule 034/034a settled — unchanged.
- The malformed-`shadow:`-value rule, which must stay fail-closed. Parse failure and malformed value are different conditions with opposite outcomes, and this task must not blur them; it only adds reporting for the first.
- Teaching either skill to merge override sections beyond `shadow:`.
- Anything about powbox's own repository. Container implementation details live in `Roubtec/powbox`; this task adds one statement of fact about a script these two skills already cite, which is within the remit they already have as the skills that intentionally describe powbox facilities.

## Context and references

- **Prerequisite: PR #49 (task 034a) must merge first.** The `declare-shadows` half of the "simply errors" wording exists only on `task/034a-declare-shadows-override-test-and-parse-failure` until then, so an implementer who picks this up earlier finds nothing to reword in that skill. This is the same shape as 034a's own dependency on PR #41.
- 034 — taught `enable-worktrees` the guarded override test and the parse-failure fallback.
- 034a — mirrored both into `declare-shadows`. Its closing pass declined all three items here precisely because each needs both skills, and its Scope excluded `enable-worktrees`. This task file is the record of that deferral.
- `enable-worktrees` step 7's Report bullet ("Whether a `.powbox.local.yml` override is in effect…") and `declare-shadows`'s Report bullet ("Whether a `.powbox.local.yml` override is masking the committed list…") — the two homes for the inert-override clause. Line numbers deliberately omitted; re-derive them, since PR #49 moves the `declare-shadows` file.
- powbox `detect-shadows.sh`, the `POWBOX_LOCAL_YML` branch — the authority for the test, the `|| true` swallow, and the absence of an override log on a parse failure.

## Target files or areas

- `plugins/dev-skills/skills/enable-worktrees/SKILL.md`
- `codex/dev-skills/skills/enable-worktrees/SKILL.md`
- `plugins/dev-skills/skills/declare-shadows/SKILL.md`
- `codex/dev-skills/skills/declare-shadows/SKILL.md`

## Implementation notes

- Reuse one wording across both skills rather than writing each separately; two skills stating the same powbox contract two ways is how the divergence this task descends from arose in the first place.
- Keep it proportionate: a clause in each Report section, one reworded sentence, and one statement of fact. `declare-shadows` step 2 is already dense — prefer tightening to appending.
- The inert-override report should say what the user can do about it (the file is there and doing nothing), not merely that a parse failed.

## Acceptance criteria

- Each skill's Report section names a present-but-unparseable `.powbox.local.yml` as inert, and names `.powbox.yml` as the effective list in that case.
- The existing parse-failure fallback rule is unchanged in substance: such a run still proceeds rather than stopping.
- The malformed-`shadow:`-value rule still stops and reports, unchanged and unambiguous against the parse-failure case.
- No shipped sentence claims an unguarded `yq` on a missing file produces a visible error, given the `2>/dev/null` in the quoted command; the instruction to guard the call survives.
- Both skills state that `detect-shadows.sh` is on `PATH` in a powbox container and is the authority for shadow detection.
- All four mirrors carry the changes and differ only in harness-specific wording and line style.

## Validation

- In a scratch repo, exercise the local-file states — absent, `ctx:`-only, unparseable YAML, and a well-formed `shadow:` list — against the real `detect-shadows.sh`, and confirm each skill's stated Report output matches what the script actually does, including that the unparseable case emits the committed list with no override log.
- Confirm by reading, not by comparison against powbox, that the malformed-`shadow:`-value rule stayed fail-closed. powbox never stops on a malformed value, so that input is the one place the skill deliberately diverges and a comparison there would assert the opposite of the intended behaviour.
- Diff the two mirrors of each skill to confirm the edits landed identically.

## Review plan

Reviewer confirms the inert-override clause is reporting only and did not alter the fallback rule, that parse failure and malformed value remain distinct with opposite outcomes, that the reworded "simply errors" sentence no longer contradicts the `2>/dev/null` in the command beside it while still requiring the guard, that both skills received identical wording rather than two paraphrases, and that all four mirrors stay in parity.
