# verify-014-peer-strength-pin — read the peer's effective review strength against the pin

A prose check for an agent, not a CI script. Task 014 requires every rendering of the review cycle's peer step to launch at a pinned review strength: a Claude-led run reviews with codex through `peer-review-run --provider codex … --effort medium` with no `--model`, the helper passing the root `model` of `~/.codex/config.toml` through where one is usable, and on its fallback through `codex exec -c model_reasoning_effort=medium`; a codex-led run reviews with `claude` at `--model opus --effort medium`, helper and fallback alike. This file exists because the pin must be **observed on a real invocation**, not trusted from the instruction — and because each harness can only observe its own half: a Claude-led run launches only the codex peer, and the claude peer is reachable only from the codex harness through `codex/dev-skills/skills/review-cycle/`. Run this once per harness; the two reports together cover both sides of the pin.

## What to do

You are running in one harness (Claude Code or Codex). Exercise the peer step of **your own** rendering of the review cycle — the `review-cycle` skill installed for your harness, or the workflow that embeds it — against any trivial committed change, and report the model and reasoning effort **your own peer** actually reported, compared against the pin above. Never present one provider's reading as "the" reading; state which side you exercised and which side this run leaves unexercised.

1. Make or pick a trivial committed change in a scratch worktree (a one-line doc edit is enough).
2. Run one peer round of your rendering's peer step exactly as the skill/workflow states it — including the primary `peer-review-run` launch it now documents; the raw-launch observations below apply only when that rendering's fallback is taken. Do not add flags of your own beyond capture paths.
3. Read the effective strength from the surfaces below — they move with the **launch shape**, not just the provider.
4. Report: harness, launch shape used, the model string observed, the effort observed (or "not observable on this surface" with the reason from the map below), and PASS/FAIL against the pin.

## Where the values are actually readable (the observability map)

Verified in-container at codex-cli 0.147.0; re-verify if the CLI moved.

- **Codex peer (Claude-led run).** `codex exec` writes its `model:` and `reasoning effort:` header to **stderr**, and needs no terminal to do it: piped or fully backgrounded, the header still appears. Read it from the separately captured stderr file the fallback raw launch keeps. Stdout carries nothing but the answer — a reading aimed there finds neither value and must not conclude the pin is absent.
- **Codex under `--json`** (which the `peer-review-run` helper adds wherever the installed CLI supports it): the header is suppressed — stdout becomes thread/turn events, stderr falls silent, and `--ephemeral` persists no session file — so neither value reaches the helper's `provider.stdout`/`provider.stderr` artifacts. Read them off the helper instead: its `powbox.peer-review-run/v1` result reports the strength it actually applied as `model` and `effort`, `model` null on the codex side only where no root `model` was usable (the config carries none, or its root `profile`/`model_provider` made it unsafe to forward), `effort` null only where the CLI's probe finds no `--effort`. The header suppression is a property of the flag, not the helper: on a CLI whose probe finds no `--json` support, the header does land in `provider.stderr`.
- **Claude peer (codex-led run).** `claude --output-format json` reports the model in `modelUsage`: read the main entry's `canonicalModel`, not the mere presence of a key — a run also bills a small helper model alongside the main one. The result envelope carries **no effort field anywhere**, so `--effort` is not observable from it on any path; report the model reading and name the effort as unobservable-by-contract.
- **The unobservable residue** is therefore narrow, specific, and confined to the fallback raw launches: the claude peer's effort, which its result envelope carries on no path. A helper launch leaves no such residue — the helper's own result reports the strength it applied, with `model` null only where no root model was usable, itself the reading that no model passthrough applied. That reporting is the half 014's powbox ask called for, and it has landed. Do not fail the run for the residue, but do fail for anything the map says is readable and reads wrong.

## Pass/fail

- Codex peer, helper launch: the result's `effort` must be `medium`; any other level — including the helper's own `high` default, which says `--effort medium` was not passed — **fails task 014**. Its `model` must be the root `model` of `~/.codex/config.toml` where that file carries one with no root `profile` or `model_provider`; `model: null` there is the unconfigured or degraded case and is recorded as the applied strength, not failed. Codex peer, fallback launch: the captured stderr header must show `reasoning effort: medium`, and `reasoning effort: none` — what an unpinned raw launch inherits — **fails task 014**; its model line is the container's configured model where the config carries one, a bare default otherwise. A bare stderr header beside no helper result is what identifies a raw launch as the shape you exercised; `reasoning effort: none` in it identifies an unpinned one.
- Claude peer: `modelUsage`'s main `canonicalModel` must be an Opus-class model (the `opus` alias's resolution), not an economy tier; the effort pin is carried by the documented launch flags and is unobservable in the result envelope — say so rather than guessing.

## Lifetime

This file ships with the task-014 branch so the observation stays reproducible on demand; it may be dropped once both harnesses' readings are recorded on the delivering PR.
