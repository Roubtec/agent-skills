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
   - `tasks/015-adopt-peer-review-run-in-review-skills.md` — the queued task that reads this rationale as input, and the one site where the stale claim is not merely stated but **acted on**. Its strength-baseline bullet — since retitled "Carry the review-strength baseline across the swap, and pin effort at `medium`" — says the helper "passes **neither**" and that a codex peer launched through it "runs at `reasoning effort: none`", then makes the model/effort passthrough a **hard prerequisite** of converting any peer step — "the swap must not land until the helper accepts that model/effort passthrough". Its acceptance criteria restate the prerequisite at `:57` and `:62`, which the correction must reach. Its validation bullet at `:68` — "Anything other than the pinned baseline — in particular `reasoning effort: none` — fails this task" — **stands as written**: it names the symptom as a failing observation to check for, not as something the helper produces, and stays true whatever the helper passes. The next bullet, at `:69`, does **not** stand: it tells the future prompt file to carry the observability shape "the codex header landing on stderr and vanishing under the helper's `--json`, and claude's result envelope carrying no effort field at all, so neither peer surfaces both values unaided on every path". That reasoning is about what the *peer* prints, and it is what makes the helper path read as the unobservable one — but the helper reports the strength it applied itself, so on that path both values come from the helper's own result even when the peer's header is gone. Left as written it sends that prompt file's runner after instrumentation that already exists, or makes a helper-path reading look impossible. Narrow it the same way as the rest: the gap is real on a **raw** launch and closed on the helper path by the helper's reporting. Correcting the shipped text while leaving 015 alone is the one outcome this task exists to prevent, since 015's implementer would keep treating an already-delivered effort passthrough as a blocker.

   The corrected claim should say what is true: the helper pins effort for both providers and defaults it to `high`, and it reports the strength it applied; what it still cannot do is carry the codex peer's *configured* high-capability model, because its codex adapter discards the very configuration that model comes from. That, and not the effort, is what keeps the pinned raw launch the codex side's interface.

   In 015 specifically, the correction has to reach the **conclusion**, not just the premise. The prerequisite narrows rather than disappears: what the swap still waits on for the codex provider is the model half alone, and 015 already anticipates this exact case — "an effort-only passthrough would still leave that peer on whatever model codex defaults to bare" — so the bullet's own logic survives the correction and only its factual half needs replacing. Leave 015's decision intact if that is where the narrowed prerequisite still lands; the requirement is that it rests on what the helper actually does. Note also that 015's blocking condition is per-provider, and item 3 below settles the claude side, on which no prerequisite remains outstanding at all.

2. **Revisit the two in-section pointers** at `plugins/dev-skills/workflows/wf-review-cycle.js:477` and `plugins/dev-skills/workflows/wf-address-tasks.js:824`, which both read "retained pinned raw launch until powbox's review-strength passthrough lands; see the header comment". The passthrough has partly landed, so "until it lands" is no longer the whole condition. If these change, they are inside the `review-cycle-core` embeddable section and must move byte-for-byte in both files.

3. **Decide the claude side explicitly rather than by stale default.** `codex/dev-skills/skills/review-cycle/SKILL.md` runs a *claude* peer, and the helper's defaults for that provider are `--model opus --effort high` (`:583`, `:609`) — which matched 014's pin exactly when this task was written. They no longer match it: 015 records the maintainer's decision to make `medium` the default and encouraged effort, superseding the `high` in 001's quality floor and 014's peer step. So the codex-side mirror could still legitimately move its peer step onto the helper today, gaining the helper's timeout, retry, and reaping, but it must pass `--effort medium` explicitly rather than accept the helper's default. Decide whether it should move, and record the decision either way — the point is that it stops being decided by a claim that is not true.

4. **Minor, unrelated but same-area:** `plugins/dev-skills/skills/write-tasks/SKILL.md:3` and its codex mirror describe only task-file authoring. Every other cycle consumer's `description` advertises the cross-harness review; `write-tasks` runs the verbiage cycle **by default** (`:154-158`) and its description does not say so, so a dispatcher reading descriptions alone cannot know. Add a clause.

Out of scope:

- Any change to `peer-review-run` itself (powbox-owned).
- Actually moving the Claude-led renderings onto the helper. That is 015's swap, governed by 015's "Preserve the review-strength baseline across the swap" bullet; this task only stops 015 from inheriting a false premise. Item 3 above is a decision to record, not a migration to perform here. Correspondingly, the 015 edit is confined to the strength-baseline bullet, the places its prerequisite is restated (`:57`, `:62`), and the observability claim at `:69` — nothing else in that file, and in particular not its adjacent fallback-paragraph bullet, its remit, or its validation at `:68`.
- 015's stale **line citations**, which are task 015b's whole subject and are explicitly not a behavioural change there. The two tasks touch the same file without overlapping: 015b re-derives numbers, this one corrects a claim. Whichever lands second re-reads the file rather than assuming the other left it as described.
- `tasks/done/014-extract-review-cycle-building-block.md`, which states the claim as the record of a decision taken at the time. Archived task files are left alone, as 015b's own out-of-scope list establishes for the same reason.
- Re-litigating the pin values themselves.

## Context and references

- 014 — the extraction that shipped the claim; its acceptance criterion requiring the codex peer to reach its configured high-capability model is what makes the model half of the gap real.
- 015 — the helper-adoption task that reads this rationale as input, and itself restates it as a hard prerequisite; corrected here, per scope item 1.
- 015b — re-derives 015's line citations and nothing else. Sequencing is free, but the two should not be implemented concurrently on the same file.
- `scripts/verify-014-peer-strength-pin.md` — the committed harness-neutral prompt file whose pass criteria encode the same stale symptom.
- `/usr/local/bin/peer-review-run` in a powbox container — the authority. Re-verify the line citations above against the installed build before editing, since it is baked rather than vendored here and may have moved again.

## Target files or areas

- `plugins/dev-skills/workflows/wf-review-cycle.js`, `plugins/dev-skills/workflows/wf-address-tasks.js`
- `plugins/dev-skills/skills/review-cycle/SKILL.md`, `codex/dev-skills/skills/review-cycle/SKILL.md`
- `scripts/verify-014-peer-strength-pin.md`
- `tasks/015-adopt-peer-review-run-in-review-skills.md` — the queued task carrying the claim as a blocking prerequisite
- `plugins/dev-skills/skills/write-tasks/SKILL.md` and its codex mirror (item 4 only)

## Implementation notes

- Re-derive every line citation in this file before editing; they are as of `885cdee`.
- Keep the correction proportionate. This is one wrong sentence restated in five places, plus its knock-on in 015's validation guidance, not an invitation to re-argue the peer design.
- The claim is stated once canonically and referenced elsewhere — preserve that shape rather than fixing each site independently with its own wording.
- 015 is the exception to that shape: it is a queued task file rather than shipped text, and it draws a scheduling conclusion from the claim, so it needs the conclusion revisited rather than a pointer to the canonical statement.

## Acceptance criteria

- No shipped text asserts that `peer-review-run` accepts no model or effort argument, or that a helper launch runs at `reasoning effort: none`.
- No **queued** task asserts it either. Specifically, 015 no longer states that the helper passes neither dimension, and its prerequisite on the swap is narrowed to what the helper genuinely still cannot do — the codex peer's configured model — so its implementer cannot read an already-delivered effort passthrough as a blocker. Archived tasks under `tasks/done/` are exempt.
- 015's validation guidance no longer describes the helper path as one where the applied strength cannot be read: `:69`'s observability shape is narrowed to the raw launch, and the helper's own reporting of the effective model and effort is recorded, so the prompt file that bullet commissions is not written to instrument around it. Its validation at `:68` is unchanged.
- The retained raw launch's stated reason is one that holds against the installed helper: the codex peer's configured high-capability model, not effort.
- `scripts/verify-014-peer-strength-pin.md`'s pass criteria describe a symptom a runner would actually observe on a helper launch.
- The claude-side helper decision is recorded with its reasoning, whichever way it goes. If it moves onto the helper, it passes `--effort medium` explicitly per 015's pin rather than accepting the helper's `high` default.
- If the in-section pointers changed, the `review-cycle-core` sections in `wf-review-cycle.js` and `wf-address-tasks.js` are still byte-identical.
- `write-tasks`' description in both mirrors states that it runs the review cycle on drafted tasks by default.

## Validation

- `diff <(awk '/BEGIN EMBEDDABLE SECTION: review-cycle-core/,/END EMBEDDABLE SECTION: review-cycle-core/' plugins/dev-skills/workflows/wf-review-cycle.js) <(awk '/BEGIN EMBEDDABLE SECTION: review-cycle-core/,/END EMBEDDABLE SECTION: review-cycle-core/' plugins/dev-skills/workflows/wf-address-tasks.js)` is empty.
- `wf-check` (or the wrapped `node --check` documented in `plugins/dev-skills/workflows/README.md`'s Validation section) passes on every touched workflow script; a bare `node --check` on those sources can only fail on an error above their first `export`, so it is not the gate.
- `node scripts/test-review-cycle-retirement.mjs` and `node scripts/test-checkout-cleanliness-report.mjs` exit 0.
- `grep -rn "accepts no model\|reasoning effort: none\|passes \*\*neither\*\*\|surfaces both values unaided" plugins codex scripts tasks` returns nothing that asserts the corrected-away claim. Search `tasks/` too, not only the shipped trees — omitting it is how 015 was missed in the first place. The grep reports matching *lines*, and several of these files match on more than one, so do not check it against a hit count — classify every hit instead. Four classes are legitimate: this task file (which quotes the claim throughout in order to correct it), `tasks/done/014-…` (an archived record, matching more than once), `tasks/015-…md:68` (which names `reasoning effort: none` as an observation that *fails* its validation, and is correct as it stands), and corrected text naming either symptom — the strength claim, or `:69`'s observability gap — as something bounded to a raw launch rather than as what a helper launch produces. A hit outside those four classes is either a site this task missed or a correction that did not land.
- Confirm the corrected claim against the installed helper directly rather than against this task file.

## Review plan

Reviewer checks the corrected claim against the installed `peer-review-run` rather than against the prose, confirms the model-versus-effort distinction is stated precisely enough that a later reader can act on it, that the claude-side decision is recorded rather than left implicit, and that the embeddable section stayed byte-identical if it moved at all. Reviewer also reads 015 end to end afterwards and confirms it no longer blocks the swap on something already delivered, that the correction reached its acceptance criteria at `:57` and `:62` and its observability claim at `:69` rather than only the narrative bullet, and that its validation at `:68` was left alone.
