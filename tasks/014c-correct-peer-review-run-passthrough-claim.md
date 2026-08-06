# 014c — Correct the `peer-review-run` passthrough claim the review-cycle renderings ship

## Why this task exists

Task 014 shipped the canonical review cycle with its peer step on a **pinned raw launch** rather than on powbox's `peer-review-run` helper, and it explains why in prose that every rendering carries. That explanation is now factually wrong on its central point.

The shipped text says the helper "accepts no model or effort argument", and concludes that a peer launched through it "runs at `reasoning effort: none` on a bare default model, a silent strength regression".

The installed helper accepts both. Verified against `/usr/local/bin/peer-review-run` in this container on 2026-08-06:

- `--model <ID>` and `--effort <LEVEL>` are in the synopsis (`:18`) and parsed (`:549-556`).
- Effort **defaults to `high`** for both providers when the caller omits it (`:583`).
- The codex adapter re-injects `-c model_reasoning_effort="$EFFORT"` (`:1000`) specifically to compensate for its own `--ignore-user-config` (`:1008-1012`).
- The helper reports what it actually applied, via `EFFECTIVE_MODEL` / `EFFECTIVE_EFFORT` (`:881-882`, `:941-946`, `:1012-1019`) — which is the reporting half task 014 asked for.

The helper's build timestamp is roughly twelve hours before PR #39 merged, so the claim was already stale when it shipped rather than having been overtaken since.

**There is no behavioral defect and no strength regression.** Every rendering pins strength in its own raw launch, and none of them reaches the helper, so 014's binding safety property — no rendering reaches the helper without the pin — holds unconditionally. Only the stated reason is wrong.

Retaining the raw launch also remains the *right call* for the codex side, but for a narrower reason than the text gives: 014's acceptance criterion requires the codex peer to reach its **configured high-capability model**, and the helper still cannot deliver that. `--ignore-user-config` discards `$CODEX_HOME/config.toml`, and the helper applies its `--model` default of `opus` only for claude (`:609`), leaving codex on the CLI's bare default. So the model half of the gap is real; the effort half is not.

This matters because the claim is load-bearing for a decision. Anyone deciding whether to move a rendering onto the helper — including whoever implements 015 — reads this text as the reason not to, and the reason it gives is one they can disprove in a minute. A wrong rationale that survives is worse than a missing one, because it stops the question being asked again.

## Scope

Included:

1. **Narrow the claim to the model half** at every site that states it:
   - `plugins/dev-skills/workflows/wf-review-cycle.js:75-82` (header comment — the canonical statement; note this sits *outside* the `review-cycle-core` embeddable section, so correcting it needs no section re-sync)
   - `plugins/dev-skills/skills/review-cycle/SKILL.md:76` ("Destination interface — `peer-review-run`, not yet.")
   - `codex/dev-skills/skills/review-cycle/SKILL.md:127` (the mirror of the same paragraph)
   - `scripts/verify-014-peer-strength-pin.md:25` — which tells the runner that `reasoning effort: none` is "the specific symptom of a helper launch with no strength passthrough". It is not, on the installed helper; a bare-default *model* beside `reasoning effort: high` is what a helper launch now looks like.

   The corrected claim should say what is true: the helper pins effort for both providers and defaults it to `high`, and it reports the strength it applied; what it still cannot do is carry the codex peer's *configured* high-capability model, because its codex adapter discards the very configuration that model comes from. That, and not the effort, is what keeps the pinned raw launch the codex side's interface.

2. **Revisit the two in-section pointers** at `plugins/dev-skills/workflows/wf-review-cycle.js:477` and `plugins/dev-skills/workflows/wf-address-tasks.js:824`, which both read "retained pinned raw launch until powbox's review-strength passthrough lands; see the header comment". The passthrough has partly landed, so "until it lands" is no longer the whole condition. If these change, they are inside the `review-cycle-core` embeddable section and must move byte-for-byte in both files.

3. **Decide the claude side explicitly rather than by stale default.** `codex/dev-skills/skills/review-cycle/SKILL.md` runs a *claude* peer, and the helper's defaults for that provider are exactly 014's pin: `--model opus --effort high` (`:583`, `:609`). So the codex-side mirror could legitimately move its peer step onto the helper today, gaining the helper's timeout, retry, and reaping. Decide whether it should, and record the decision either way — the point is that it stops being decided by a claim that is not true.

4. **Minor, unrelated but same-area:** `plugins/dev-skills/skills/write-tasks/SKILL.md:3` and its codex mirror describe only task-file authoring. Every other cycle consumer's `description` advertises the cross-harness review; `write-tasks` runs the verbiage cycle **by default** (`:154-158`) and its description does not say so, so a dispatcher reading descriptions alone cannot know. Add a clause.

Out of scope:

- Any change to `peer-review-run` itself (powbox-owned).
- Actually moving the Claude-led renderings onto the helper. That is 015's swap, governed by 015's "Preserve the review-strength baseline across the swap" bullet; this task only stops 015 from inheriting a false premise. Item 3 above is a decision to record, not a migration to perform here.
- Re-litigating the pin values themselves.

## Context and references

- 014 — the extraction that shipped the claim; its acceptance criterion requiring the codex peer to reach its configured high-capability model is what makes the model half of the gap real.
- 015 — the helper-adoption task that reads this rationale as input.
- `scripts/verify-014-peer-strength-pin.md` — the committed harness-neutral prompt file whose pass criteria encode the same stale symptom.
- `/usr/local/bin/peer-review-run` in a powbox container — the authority. Re-verify the line citations above against the installed build before editing, since it is baked rather than vendored here and may have moved again.

## Target files or areas

- `plugins/dev-skills/workflows/wf-review-cycle.js`, `plugins/dev-skills/workflows/wf-address-tasks.js`
- `plugins/dev-skills/skills/review-cycle/SKILL.md`, `codex/dev-skills/skills/review-cycle/SKILL.md`
- `scripts/verify-014-peer-strength-pin.md`
- `plugins/dev-skills/skills/write-tasks/SKILL.md` and its codex mirror (item 4 only)

## Implementation notes

- Re-derive every line citation in this file before editing; they are as of `885cdee`.
- Keep the correction proportionate. This is one wrong sentence restated in four places, not an invitation to re-argue the peer design.
- The claim is stated once canonically and referenced elsewhere — preserve that shape rather than fixing each site independently with its own wording.

## Acceptance criteria

- No shipped text asserts that `peer-review-run` accepts no model or effort argument, or that a helper launch runs at `reasoning effort: none`.
- The retained raw launch's stated reason is one that holds against the installed helper: the codex peer's configured high-capability model, not effort.
- `scripts/verify-014-peer-strength-pin.md`'s pass criteria describe a symptom a runner would actually observe on a helper launch.
- The claude-side helper decision is recorded with its reasoning, whichever way it goes.
- If the in-section pointers changed, the `review-cycle-core` sections in `wf-review-cycle.js` and `wf-address-tasks.js` are still byte-identical.
- `write-tasks`' description in both mirrors states that it runs the review cycle on drafted tasks by default.

## Validation

- `diff <(awk '/BEGIN EMBEDDABLE SECTION: review-cycle-core/,/END EMBEDDABLE SECTION: review-cycle-core/' plugins/dev-skills/workflows/wf-review-cycle.js) <(awk '/BEGIN EMBEDDABLE SECTION: review-cycle-core/,/END EMBEDDABLE SECTION: review-cycle-core/' plugins/dev-skills/workflows/wf-address-tasks.js)` is empty.
- `wf-check` passes on every touched workflow script.
- `node scripts/test-review-cycle-retirement.mjs` and `node scripts/test-checkout-cleanliness-report.mjs` exit 0.
- `grep -rn "accepts no model\|reasoning effort: none" plugins codex scripts` returns nothing that asserts the corrected-away claim.
- Confirm the corrected claim against the installed helper directly rather than against this task file.

## Review plan

Reviewer checks the corrected claim against the installed `peer-review-run` rather than against the prose, confirms the model-versus-effort distinction is stated precisely enough that a later reader can act on it, that the claude-side decision is recorded rather than left implicit, and that the embeddable section stayed byte-identical if it moved at all.
