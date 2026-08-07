# verify-014-peer-strength-pin — read the peer's effective review strength against the pin

A prose check for an agent, not a CI script. Task 014 requires every rendering of the review cycle's peer step to launch at a pinned review strength: a Claude-led run reviews with codex at `-c model_reasoning_effort=medium` (model left to the peer's configured high-capability default in `~/.codex/config.toml`); a codex-led run reviews with `claude` at `--model opus --effort medium`. This file exists because the pin must be **observed on a real invocation**, not trusted from the instruction — and because each harness can only observe its own half: a Claude-led run launches only the codex peer, and the claude peer is reachable only from the codex harness through `codex/dev-skills/skills/review-cycle/`. Run this once per harness; the two reports together cover both sides of the pin.

## What to do

You are running in one harness (Claude Code or Codex). Exercise the peer step of **your own** rendering of the review cycle — the `review-cycle` skill installed for your harness, or the workflow that embeds it — against any trivial committed change, and report the model and reasoning effort **your own peer** actually reported, compared against the pin above. Never present one provider's reading as "the" reading; state which side you exercised and which side this run leaves unexercised.

1. Make or pick a trivial committed change in a scratch worktree (a one-line doc edit is enough).
2. Run one peer round of your rendering's peer step exactly as the skill/workflow states it — including the pinned raw launch form it currently documents. Do not add flags of your own beyond capture paths.
3. Read the effective strength from the surfaces below — they move with the **launch shape**, not just the provider.
4. Report: harness, launch shape used, the model string observed, the effort observed (or "not observable on this surface" with the reason from the map below), and PASS/FAIL against the pin.

## Where the values are actually readable (the observability map)

Verified in-container at codex-cli 0.146.0; re-verify if the CLI moved.

- **Codex peer (Claude-led run).** `codex exec` writes its `model:` and `reasoning effort:` header to **stderr**, and needs no terminal to do it: piped or fully backgrounded, the header still appears. Read it from the separately captured stderr file the pinned raw launch already keeps. Stdout carries nothing but the answer — a reading aimed there finds neither value and must not conclude the pin is absent.
- **Codex under `--json`** (which the `peer-review-run` helper adds wherever the installed CLI supports it): the header is suppressed — stdout becomes thread/turn events, stderr falls silent, and `--ephemeral` persists no session file — so neither value reaches the helper's `provider.stdout`/`provider.stderr` artifacts, and the `powbox.peer-review-run/v1` result carries no strength field of its own. That is a property of the flag, not the helper: on a CLI whose probe finds no `--json` support, the header does land in `provider.stderr`.
- **Claude peer (codex-led run).** `claude --output-format json` reports the model in `modelUsage`: read the main entry's `canonicalModel`, not the mere presence of a key — a run also bills a small helper model alongside the main one. The result envelope carries **no effort field anywhere**, so `--effort` is not observable from it on any path; report the model reading and name the effort as unobservable-by-contract.
- **The unobservable residue** is therefore narrow and specific: both codex values on a `--json` helper launch, and the claude effort always. That residue belongs to the powbox passthrough ask 014 files (a helper that pins strength has to report the strength it applied), not to this check — do not fail the run for it, but do fail for anything the map says is readable and reads wrong.

## Pass/fail

- Codex peer: the stderr header must show `reasoning effort: high`. `reasoning effort: none` is the specific symptom of a helper launch with no strength passthrough and **fails task 014**. The model line should be the container's configured high-capability model from `~/.codex/config.toml`, not a bare default.
- Claude peer: `modelUsage`'s main `canonicalModel` must be an Opus-class model (the `opus` alias's resolution), not an economy tier; the effort pin is carried by the documented launch flags and is unobservable in the result envelope — say so rather than guessing.

## Lifetime

This file ships with the task-014 branch so the observation stays reproducible on demand; it may be dropped once both harnesses' readings are recorded on the delivering PR.
