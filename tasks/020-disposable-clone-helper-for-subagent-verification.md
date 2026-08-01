# 020 — Add disposable-clone helpers (`dc-enter`/`dc-remove`) and verify the skills' pointer at them

## Why this task exists

A reviewer subagent asked to verify a claim empirically ran `rm -rf ./*` in the shared main checkout. It had tried to build a throwaway clone first; the clone failed, the failure was hidden from `set -e` by a pipe to `tail`, and execution continued in the repo root. Nothing was lost only because `./*` does not match dotfiles, so `.git` survived.

The root cause recorded in the retrospective is not that the subagent was careless. It is that the prompt authorized empirical verification while the environment offered no safe place to do it, so every agent hand-rolls its own clone-and-cd and each one is a fresh chance to get it wrong. Empirical verification is worth keeping — in that same session it caught four wrong fixes that pure reading missed, and in the run that produced this task it caught a recovery-ref fallback that reintroduced the defect it was meant to fix. The fix is to make it safe, not to ban it.

The missing primitive is a disposable *clone*. A worktree is the wrong tool and is actively misleading here: it isolates the working tree but shares `.git`, so `branch -f`, `reset`, `update-ref`, and `gc` all reach every sibling worktree. The incident's script would have moved a shared ref even had it run inside `wt-enter`.

Task 017 item 5 covers the prose half — telling subagents what they may not do. This task covers the half that actually closes the gap: giving them somewhere safe to do it.

## Scope

Included:

- Write `dc-enter` and `dc-remove` at `plugins/dev-skills/bin/`, executable bits committed. Only part of 005's arrangement transfers: take the placement, the PATH mechanism (the plugin's `bin/` is on the Bash tool's PATH while the plugin is enabled, so plain-machine users get the safe path with no change to skill detection logic), and the drift note. Do **not** look for an upstream to pin — unlike `gh-review-threads` these are net-new here, with no powbox-baked original, so there is nothing to vendor or checksum against.
- Ship the non-powbox Codex pointer too, as 005 did. The plugin's `bin/` reaches Claude Code users only; the `codex/` tree is not distributed through the marketplace, so without a one-line "copy these onto your PATH" note a Codex user's mirrored guidance runs `command -v dc-enter`, never resolves, and silently degrades forever.
- `dc-enter <slug> [<ref>]` produces a disposable clone of the invoking repository and prints **only** its absolute path, so callers can write `DC="$(dc-enter probe)"`. Mirror `wt-enter`'s ergonomics deliberately — that is the shape agents in this ecosystem already know — but not its reuse semantics, per the next point.
- Define `<ref>` or drop it; do not ship it undefined. If kept, it selects what the clone is checked out at, and its default must be the **invoking worktree's** `HEAD`, not the repository's. This is a real trap rather than a pedantic one: the natural implementation derives the source from `git rev-parse --git-common-dir`, which resolves to the main worktree, so a subagent running `dc-enter probe` from a linked worktree would silently verify against the wrong commit — the exact class of wrong-branch conclusion these helpers exist to prevent. Whichever way it goes, cover it with an acceptance criterion.
- Reuse must not hand back a mutated clone. `wt-enter` can reuse safely because a worktree tracks a branch; a disposable clone exists to be wrecked, so a second `dc-enter probe` in one session could otherwise return a repo whose refs the first experiment deleted and whose objects it collected, and the next verification runs against a corrupted baseline. Require that a reused path is either re-derived pristine or refused; "reuse whatever is there" is not acceptable. Scope the path per agent as well, so two agents sharing a temp root on a plain machine do not both resolve slug `probe` to one directory.
- State the isolation guarantee precisely, because it is the whole contract: mutating refs, deleting branches, committing, or running `gc`/`repack`/`prune` inside the clone must not affect the invoking repository's refs or reachable objects. Never create the clone with `--shared` or `--reference`, and expose no option through which a caller could ask for them — those genuinely do couple the object stores. The hardlinking a local clone does by default is **not** a violation and needs no special handling: git objects are immutable and content-addressed, written with `O_EXCL` and never modified in place, so no git operation inside the clone can alter a hardlinked object, and `gc` there only unlinks the clone's own directory entries. A non-git in-place write to `.git/objects` would still reach the source, which is what the `--no-hardlinks` note below weighs.
- Clone root resolution, in order: the `DC_ROOT` environment variable, then a platform temp root, never a path inside the invoking repository or its worktrees. Refuse to run — non-zero, nothing on stdout — when the resolved root would sit inside the repository, rather than falling back to somewhere convenient. Fix the variable name here rather than leaving it to the implementer: powbox's "outside `/workspace`" placement is expressed by setting it, so it is the interface between two repositories, and the two sides will otherwise pick different names.
- State what the clone carries in its ref namespace, and cover it with an acceptance test. A plain `git clone` brings the source's branch tips across as `refs/remotes/origin/*`, creates a local head only for the one it checks out, copies tags, and carries nothing else — so `refs/pruned/*`, `refs/pre-rebase/*`, the stash, and reflogs are simply absent, and the branches that do arrive are not where a caller would look for them. That is not a detail: the run that produced this task was verifying behaviour *in* `refs/pruned/`, and a subagent handed a clone silently missing the namespace under test can conclude a reservation worked or vanished for entirely the wrong reason. Decide whether the clone mirrors all refs or only the default set, and say so.
- `dc-remove <slug>` deletes a clone this helper created. Because the whole point is disposability, its safety bar is inverted from `wt-remove`'s: it may remove a dirty clone, but must never touch the invoking repository or any directory it did not create. Keep the interface consistent with that guarantee — with a slug-only signature the helper resolves the path itself and a caller cannot hand it an arbitrary one, which is the simplest way to make the guarantee hold; if a path form is accepted instead, it must be validated against the helper's own bookkeeping.
- Verify — do not re-author — the `command -v dc-enter` pointer in the skills' empirical-verification guidance. That wording belongs to 017 item 5, which writes it with its degradation clause already in place, so this task only confirms the helper satisfies what that clause promises. Either task may land first; whichever runs second must find the other's half already correct rather than rewriting it.
- A drift/sync note in each script's header stating the relationship to any future powbox-baked copy, matching what 005 did in the other direction.
- Update `README.md`'s layout section, which currently lists `bin/gh-review-threads` as a literal tree entry and so necessarily changes when two more helpers land.

Out of scope:

- Container-side work in the powbox repo: baking the helpers on PATH, choosing the outside-`/workspace` root, a read-only bind mount or overlay for reviewer subagents, and the `set -e`-plus-pipeline and `cd`-verification bash guidance. Those apply to every agent in the container, not only to these skills, and are filed there.
- The prompt-contract prose itself, which is task 017 item 5.
- A read-only reviewer agent type. It is worth doing, but a reviewer still needs `Bash` to run builds, and an agent definition's `tools` list is all-or-nothing for `Bash` — so at minimum it closes the `Write`/`Edit` path while leaving the destructive-shell path open. Whether a `disallowedTools` entry or a `PreToolUse` hook in the agent definition can close that second path too is exactly the question that decision has to settle, and it should not be assumed either way here. Decide it separately, alongside 014.
- Any change to `gh-review-threads`.

## Context and references

- `agent-session-learnings-20260730-231224.md` on branch `origin/learnings/session-20260730-231224` (commit `f9b9c16`), items 1 and 2 — the incident, the forensics, and the three-layer improvement proposal this task takes layer one from. Read cross-branch with `gitcat`, using the `origin/` prefix or the commit sha; the branch may not exist locally.
- 005 — the `gh-review-threads` vendoring, which is the precedent for a helper that lives in this repo and is also baked by powbox: sha256 pin, reciprocal drift notes, and a PATH pointer for non-powbox Codex users.
- 017 — the prose half; its item 5 points at this helper and must degrade cleanly while it does not exist.
- `plugins/dev-skills/bin/gh-review-threads` — the shape and header conventions to follow.

## Target files or areas

- `plugins/dev-skills/bin/dc-enter`, `plugins/dev-skills/bin/dc-remove` (new, mode `100755`).
- The empirical-verification guidance in the five skills that compose subagent prompts — `address-review`, `address-reviews`, `address-tasks`, `address-tasks-serialized`, `resolve-open-questions` — plus their codex-side mirrors and the two dynamic workflows, for the verification pass only; 017 item 5 authors that text.
- A non-powbox PATH pointer for Codex users, in whichever single place reads best (the codex `address-review` mirror or the README's codex section, not both).
- `README.md` layout section.

## Implementation notes

- Keep the helpers dependency-free beyond `git` and coreutils, as `gh-review-threads` is beyond `gh` and `jq`. Anything heavier will not survive being baked into a container image.
- Print only the path on stdout. Diagnostics go to stderr. A helper whose stdout carries anything else cannot be used in `DC="$(dc-enter probe)"`, which is the whole calling convention.
- The scripts are themselves agent-authored bash and must not repeat the trap that caused the incident: no load-bearing command piped for output brevity, `set -o pipefail` alongside `set -e`, and `cd` arrival verified rather than assumed.
- Do not derive the clone source from `git rev-parse --git-common-dir`. It resolves to the main worktree, so from a linked worktree the clone comes up on the main worktree's `HEAD` — the trap described above. `git rev-parse --show-toplevel` gives the invoking worktree, including from a nested subdirectory; cloning the common directory is defensible only if the invoking worktree's `HEAD` is then checked out explicitly.
- `--no-hardlinks` is a cost/benefit call, not a correctness one — the isolation guarantee above holds either way. Weigh the disk and clone-time cost against defence in depth for a subagent that writes into `.git/objects` with something other than git, which is exactly the sort of thing a disposable clone exists to absorb. Record the reasoning whichever way it goes.

## Acceptance criteria

- `dc-enter <slug>` prints one absolute path and nothing else, and the clone it names satisfies the isolation guarantee: creating, moving, and deleting refs, committing, and running `gc --prune=now` inside it leave the invoking repository's refs and reachable objects unchanged. Whether objects are hardlinked is not part of this criterion.
- The helper refuses, non-zero and silent on stdout, when the resolved clone root would fall inside the invoking repository or its worktrees.
- Both are reachable on PATH through the plugin's `bin/` with the plugin enabled, with no change to any skill's detection logic.
- The skills' verification guidance uses `command -v dc-enter` and degrades to an absolute path outside the repository when absent, so nothing regresses on a machine without the helper. This criterion is satisfied by 017 item 5's wording. If 017 has not landed yet, it is deferred to 017's delivery and this task is judged without it — do not author the pointer here to satisfy it.
- `dc-remove` refuses to delete anything outside what it created, including the invoking repository, and removes a clone with uncommitted changes without complaint.
- The `<ref>` argument is either specified with a stated default and covered by a test, or absent from the interface.
- A reused slug never yields a clone a previous run mutated, and two agents sharing one root do not collide on the same slug.
- A Codex user not on powbox has a documented one-line route to put both helpers on PATH, in exactly one place.
- Neither script pipes a load-bearing command, and neither proceeds on the assumption that a directory change succeeded. A script that never changes directory satisfies the second half trivially, and that is a better answer than one that does.
- The clone's ref namespace matches whatever the previous point decided, demonstrated on a source repository carrying refs outside `refs/heads/` and `refs/tags/`.

## Validation

- From inside a linked worktree, `dc-enter probe` yields a clone outside the repository; `git -C "$DC" update-ref refs/heads/x HEAD` and `git -C "$DC" gc --prune=now` leave the invoking repository's refs and objects unchanged.
- With `DC_ROOT` pointed inside the repository, the helper refuses and writes nothing to stdout.
- Called from a linked worktree whose `HEAD` differs from the main worktree's, the clone is checked out at the invoking worktree's commit.
- A second `dc-enter` on a slug whose clone was wrecked by the first does not hand back the wreckage.
- `dc-remove` on a clone with uncommitted changes succeeds; on the invoking repository's own path it refuses.
- Simulate the incident's shape: a script whose clone step fails must not proceed to operate in the repo root.

## Review plan

Reviewer confirms the clone is independent in refs and objects rather than only in working tree, that every refusal path exits non-zero with an empty stdout, that the clone root can never resolve inside the repository, that the calling convention survives being used in command substitution, and that the scripts do not reproduce the pipeline and `cd` traps described in the retrospective.
