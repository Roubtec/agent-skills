# 005 - Bundle the gh-review-threads Helper in the dev-skills Plugin (`bin/`)

## Why this task exists

The `address-review` skill (both flavors) documents a hardened review-thread-fetch contract — fresh single-shot per-page GraphQL queries (never `gh api graphql --paginate`, which has returned another PR's threads under concurrency), nested comment fetch-up, and a repo-qualified fail-closed scope check — and prefers a `gh-review-threads` helper when one is on PATH (`command -v gh-review-threads`).
Powbox bakes that helper into its agent image, but plain-machine plugin users currently only get the hand-run recipe, so the safe path is not the easy path for them.
Verified fact (current official plugin docs): Claude Code plugins support a top-level `bin/` directory whose contents are added to the Bash tool's PATH while the plugin is enabled — so shipping the script in the plugin lights up the hardened path for every plugin user with zero changes to the skills' detection logic.
This task delivers the decision on issue [#3](https://github.com/Roubtec/agent-skills/issues/3); the **implementing** PR's description should carry the closing reference for that issue (spec-only PRs must not use a literal closing keyword, or GitHub closes the issue prematurely on merge).

## Scope

- Vendor the helper script at `plugins/dev-skills/bin/gh-review-threads` with the executable bit committed, adapting only its header comment (see notes).
- Add a drift/sync note to the vendored copy's header stating the relationship to powbox's baked copy.
- Add a short "copy this script onto your PATH" pointer for codex-flavor users who are not on powbox.
- Update `README.md`'s layout section to show the plugin's `bin/` directory (repo convention: README tracks overview changes).
- Out of scope: any change to the script's behavior, flags, or GraphQL query; changes to the skills' helper-detection logic (`command -v` already finds a PATH copy); edits to the powbox repo itself (its baked copy's header gains the reciprocal sync note in a separate powbox-side change — flag that as a follow-up in the PR description).

## Context and references

- Source script: [`docker/shared/gh-review-threads` in the powbox repo](https://github.com/Roubtec/powbox/blob/main/docker/shared/gh-review-threads) — pinned as of powbox `main` commit `6364b4a`: sha256 `62acae9118dda254766e38fb60a1a568d1f3ddefc5d519bdbeef2fa12387c972`, 12829 bytes. A self-contained ~307-line bash script whose only runtime dependencies are `gh` and `jq`; its test harness lives at `scripts/test-gh-review-threads.sh` in the same repo. Powbox bakes the script into its agent containers at `/usr/local/bin/gh-review-threads`, so inside such a container the baked copy is an equivalent source — verify whichever source you use against the sha256 above.
- Helper contract as the skills describe it: `plugins/dev-skills/skills/address-review/SKILL.md` (§ "GitHub API recipes" — the "Optional accelerator" block, and the thread-gathering step) and the codex twin `codex/dev-skills/skills/address-review/SKILL.md`; the vendored script's behavior must keep matching that description (JSON array on stdout; `--all`; `--repo`; exit `3` + empty stdout on contamination after one retry).
- Plugin surface: plugins-reference docs — "Executables | `bin/` | Executables added to the Bash tool's PATH … while the plugin is enabled".
- Issue: https://github.com/Roubtec/agent-skills/issues/3

## Target files or areas

- `plugins/dev-skills/bin/gh-review-threads` (new, mode `100755`).
- `codex/dev-skills/skills/address-review/SKILL.md` or the README's codex section — whichever reads better for the one-line non-powbox pointer (do not duplicate it in both).
- `README.md` (layout diagram + a sentence in the plugin bullet).

## Implementation notes

1. Copy the script verbatim from the pinned powbox source (or the container's baked `/usr/local/bin/gh-review-threads` — same bytes; check the sha256) except for the header comment, which references powbox-internal paths (`docker/{claude,codex}/agent-container/skills/address-review/SKILL.md`): repoint the "kept textually in sync with the recipe" note at this repo's two SKILL.md paths instead.
2. Add a sync note to the header: this vendored copy is proposed as the **canonical** one (it is the publicly distributed copy; powbox bakes a sibling that should be synced from it) — if the maintainer prefers powbox-canonical, invert the wording, but either way both directions of the relationship must be stated in this copy's header.
3. Commit the executable bit (`git update-index --chmod=+x` or equivalent; verify with `git ls-files -s plugins/dev-skills/bin/gh-review-threads` showing `100755`).
4. The codex tree is not distributed through the marketplace and powbox already bakes the helper, so the codex pointer only serves non-powbox codex users: one line telling them to copy `plugins/dev-skills/bin/gh-review-threads` onto their PATH.
5. Optionally add a one-line note in the plugin flavor's `address-review` SKILL.md that the plugin itself bundles the helper — only if it fits naturally in the existing "Optional accelerator" block; the `command -v` probe works without it.
6. One line per paragraph in Markdown (repo convention); keep the commit focused on this task's files.

## Acceptance criteria

- `plugins/dev-skills/bin/gh-review-threads` exists, is byte-identical to the pinned powbox source (`docker/shared/gh-review-threads` @ `6364b4a`, sha256 above) outside the header comment, and carries mode `100755` in the git index.
- The header references only this repo's paths (no `docker/…/agent-container/…` remnants) and states the sync relationship with powbox's baked copy, naming which side is canonical.
- The non-powbox codex pointer exists in exactly one place.
- `README.md` layout shows `bin/` under the plugin.
- The implementing PR's description carries the closing reference for issue #3 and flags the powbox-side reciprocal header note as a follow-up.

## Validation

- `shellcheck plugins/dev-skills/bin/gh-review-threads` passes (or any findings are pre-existing in the powbox copy — do not fix them here; note them).
- `bash -n` parses clean.
- Functional smoke test: run the vendored script against a real PR of this repo (e.g. `plugins/dev-skills/bin/gh-review-threads --all 5`) and diff its output against a reference copy run with the same arguments (the baked `/usr/local/bin/gh-review-threads` inside a powbox container, else the pinned powbox source fetched locally) — must be identical.
- Best-effort end-to-end: install the plugin from a local marketplace checkout and confirm a Bash tool call resolves `command -v gh-review-threads` to the plugin's copy; if the local-install loop is impractical, document that this was not exercised and rely on the documented `bin/` contract.

## Review plan

Reviewer diffs the vendored script against the powbox baked copy (only the header may differ), checks the index mode is `100755`, confirms the sync note names a canonical side, and verifies the codex pointer and README edits are minimal and single-homed.
