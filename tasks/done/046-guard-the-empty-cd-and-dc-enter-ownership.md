# 046 — Guard the empty `cd`, and stop `dc-enter` failing on a root-owned source

## Why

A subagent in a batch review ran `DC="$(dc-enter <slug>)"`, the helper failed, `DC` was left empty, and `cd ""` was a **silent no-op** — so `git checkout -b tagclash` and `git tag tagclash` then ran in the **shared main checkout**. It self-restored and nothing was lost, but that is precisely the incident the destroy boundary exists to prevent, reached through the boundary's own sanctioned mechanism. An earlier incident in this repository's history has the same shape one step further along: a subagent ran `rm -rf ./*` in a shared checkout after a failed setup left it somewhere it did not expect.

Two independent defects meet in that run. The helper failed for a reason that is not the caller's fault and not a defect in the helper's error handling; and the calling convention the boundary itself prescribes has a way to fail silently.

## Measured facts

These were measured rather than reasoned about. Do not re-derive them, and do not repeat the misdiagnosis an earlier report of this incident carried.

- `cd ""` exits **0** and leaves the working directory unchanged. This is the only silent failure in the sequence. `cd /nonexistent` already fails loudly (exit 1), so a missing directory is **not** the problem.
- `set -e` **does** abort on `X="$(false)"` at top level. The earlier claim that it does not is wrong. `set -e` is still not the fix here, for a different reason: agents routinely write multi-command lines with no `set -e` at all, and `local X=$(false)` / `export X=$(false)` mask the status even where it is set.
- `cd -- "${X:?message}"` fails loudly on empty **or** unset, is POSIX, and needs no `set -e`.
- `dc-enter` exits **1** correctly when its clone fails. Its error handling is fine; what it reports is not.
- `dc-enter`'s reads of the source failed because the repository directory and its `.git` are **root**-owned while the agent runs as `node`, so git's `safe.directory` check rejects them: `fatal: detected dubious ownership in repository at '…/.git'`. Adding those paths to the container's global `safe.directory` makes `dc-enter` work — but that is container configuration, uncommitted, and does not survive an image rebuild.
- The **first** command to fail is the toplevel lookup, not the clone, so the helper dies with the misleading `not inside a git working tree`. Every subsequent read of the source fails the same way.
- Command-line `-c safe.directory=<path>` **is** honoured by git for the helper's own invocations (measured on git 2.47.3), but **cannot** reach `git clone`'s source read: git spawns `git-upload-pack` with `GIT_CONFIG_PARAMETERS` and `GIT_CONFIG_COUNT` unset, which `GIT_TRACE=1` prints in the child's command line. The exception has to be handed to that child through `--upload-pack`.

## What to do

### 1. `dc-enter` and `dc-remove`: tolerate an ownership mismatch on the repository they were asked to act on

An ownership mismatch is normal for a container bind mount, not a signal of anything, and both helpers were explicitly pointed at this exact repository — so trusting it here is bounded and deliberate, and the code should say why.

- Grant the exception on the helpers' **own** git invocations only: literal `-c safe.directory=<path>` entries covering the directory the helper was run in, its ancestors, and the source's own git directory once git has named it. Never a wildcard, and never a write to the caller's global configuration.
- Enumerate every invocation that reads the source rather than patching the first: the toplevel lookup, the git-directory and common-directory lookups, the partial-clone config reads, the HEAD/ref/branch resolution, the worktree listing, the ref mirror, and the clone itself.
- Hand the same exception to `git clone`'s `git-upload-pack` child through `--upload-pack`, POSIX-quoting each path for the shell git runs that value through. `dc-remove` needs no such step; it never clones.
- Record the reasoning in comments at both sites — the mismatch is ordinary, the trust is scoped to the repository the helper was asked to clone, and the child needs its own copy because git strips command-scope configuration from it.

### 2. The destroy-boundary text: mandate the guarded `cd`

The boundary ships in the `DESTROY_BOUNDARY` / `CYCLE_DESTROY_BOUNDARY` constants of `plugins/dev-skills/workflows/wf-address-review.js`, `wf-address-tasks.js` and `wf-review-cycle.js`, and in the "Subagent destroy boundary" section of the `plugins/dev-skills/skills/*/SKILL.md` files and their `codex/dev-skills/skills/*/SKILL.md` mirrors. Every copy that names the disposable-clone destination gets the guard, in substance:

> Never `cd` into a path held in a variable unguarded — `cd ""` succeeds and changes nothing, so a failed lookup silently leaves you in the shared checkout. Write `cd -- "${DC:?dc-enter returned no path}"`, and verify with `pwd` before any command that writes.

Match the surrounding register and length discipline, and keep the mirrors byte-consistent — `scripts/test-subagent-destroy-boundary.mjs` pins the boundary clause by clause and checks the shipped copies against each other. Place the addition so it does not split any pinned span: appending a sentence after the destination clause does not; an insertion mid-sentence would, and would break on the merge with the in-flight branch of task 017b, whose version of that suite pins long contiguous literal runs.

## Acceptance criteria

- `dc-enter` run from a repository whose directory and `.git` belong to another user, with no `safe.directory` in the caller's configuration, prints a clone path and exits 0; `dc-remove` drops that clone from the same place. Before the change the same invocation fails.
- The ordinary case is unchanged: `scripts/test-dc-helpers.sh` passes, including its source-path hygiene cases, and gains one for a source path containing a single quote — the character the `--upload-pack` value has to escape.
- No `safe.directory` wildcard anywhere, and no helper writes to a git configuration file it does not own.
- Every shipped copy of the destroy boundary that names the disposable clone also carries the guarded-`cd` rule, and the copies that are maintained byte-identical still are.
- `scripts/test-subagent-destroy-boundary.mjs` passes, and its clause patterns still match the edited text.
- The `README.md` description of the helpers states the ownership exception and its bounds.

## Notes

- The ownership case cannot be constructed by the hermetic suite, which runs unprivileged and can only create directories it owns. It was verified by hand against this container's root-owned bind mount; task 046a carries the residual sweep this task does not close.
