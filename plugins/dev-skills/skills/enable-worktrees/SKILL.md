---
name: enable-worktrees
description: A repository needs to be made ready for git-worktree-based parallel development. Trigger when the user wants to enable, set up, or prepare a repo for parallel worktree tasks, fix a repo that is not worktree-ready, or run enable-worktrees. Keeps worktree scaffolding container-local and out of the commit history. Not for executing a task batch (use address-tasks), declaring artifact shadows (use declare-shadows), or unrelated .gitignore edits.
---

Prepare the current repository to support the git-worktree parallel-development workflow.

This is the **setup** counterpart to `address-tasks`.
That skill *runs* a task batch across worktrees and assumes the repo is already prepared; this skill *prepares* the repo's committed config so the workflow works hands-free on every future container.
Run it once per repo, and re-run any time to verify or repair.

This is a small, mechanical config task — do it inline yourself.
Do **not** spawn implementer/reviewer subagents.

## What "worktree-ready" means

Declared workspace subdirectories are kept container-local so writes there never reach the host bind mount.
The launcher-mounted `.worktrees` volume takes precedence; `.git/worktrees` is bind-mounted from inside that volume (so per-worktree git metadata is durable, not tmpfs), and any other declared root that is not already a mountpoint gets a tmpfs shadow.
For worktree-based parallelism a repo needs two committed things.

1. **`.powbox.yml`** at the repo root declaring the worktree scaffolding as **literal** shadow paths. powbox's `detect-shadows.sh` creates literal paths (no `* ? [ ]` glob metacharacters) at container startup *even when they do not exist yet* and tmpfs-shadows any that are not already mountpoints, so committed declarations apply hands-free on a fresh checkout:

   ```yaml
   shadow:
     - .worktrees          # orchestrator-created worktrees (one per task)
     - .claude/worktrees   # harness-native worktrees (EnterWorktree / Agent isolation)
     - .git/worktrees      # per-worktree git metadata — bind-mounted from the
                           #   persistent .worktrees volume (durable across recycle),
                           #   keeping the host's registrations out and ours off the host
   ```

2. **`.gitignore`** ignoring the two working-tree roots so worktree files are never committed:

   ```gitignore
   .worktrees/
   .claude/worktrees/
   ```

   `.git/worktrees` needs **no** gitignore entry — it lives inside the untracked `.git/` directory.

Those two are necessary, not sufficient.
A `$ROOT/.powbox.local.yml` carrying its own top-level `shadow:` key replaces the committed list **wholesale**, so a repo can hold both files in perfect shape and still mount none of what they declare.
The root that breaks first is `.claude/worktrees`: no launcher volume backs it, so it depends entirely on the declaration for its tmpfs, and while the effective list omits it, harness-native worktrees silently land on the host bind mount.
`wt-bootstrap` then fails closed on that root — it refuses to start when a worktree root is not a container-local mountpoint — and points its remedy back at this skill, so an unresolved override reads as this skill failing at the very thing it reported fixing.
Step 2 detects the case; until the effective list carries all three roots the repo is not worktree-ready, whatever `.powbox.yml` says.

Why this is safe and durable: the common `.git` (objects + refs) is *not* shadowed, so committed work persists on the host and survives container recycle.
The powbox launcher backs `.worktrees` with a **persistent per-project volume** (which also holds the pnpm store, so worktree `pnpm install` hardlinks from it), and `.git/worktrees` is bind-mounted from `.worktrees/.gitworktrees` inside that same volume — so per-worktree git metadata is durable too, and a worktree (including its uncommitted changes) survives a container stop/recreate with `git status` still working.
Only `.claude/worktrees` (harness-native working trees) stays ephemeral tmpfs.
Container registrations never leak onto the host: the bind hides the host's own `.git/worktrees` and keeps ours inside the container-local volume.
The `.worktrees` entry below is then a harmless **fallback** — skipped when the volume is mounted, used only if the container is launched without it (in which case `.git/worktrees` falls back to tmpfs). powbox's README "Workspace Shadow Mounts → Git Worktree Parallel Development" has the full model (readable under `/ctx/<mount-name>` if the powbox repo is mounted as context, but this skill ships the contract so that is optional).

## Procedure

Operate on the current repository only.
The facts come from `probe.sh` in the sibling `declare-shadows` skill folder, run by its path: it only reads, it mounts and prunes nothing, and its header (`probe.sh --help`) defines every field named below.
Every edit is idempotent and surgical — preserve unrelated content, comments, and formatting, and never remove shadow entries or gitignore lines you did not add.

1. **Probe.**
   Run `probe.sh worktrees` from the repository's main checkout; `repo=` is the root, `$ROOT` below.
   Only `outcome=probed` lets the run continue.
   On `not-a-repository`, stop and tell the user — worktrees require git.
   On `malformed`, `.powbox.yml` does not parse or is not a mapping, or a `shadow:` value in it or in an active override is not a list of non-empty string paths — null, a scalar, a mapping, or a list containing a null, a collection, or an empty string — and each `malformed=` line names the file: stop, report, and write **nothing at all** — not `.powbox.yml`, not `.gitignore` — rather than coercing a pathname or inventing a list inside a user-local file.
   An empty list is well-formed, and deliberately so — it disables the committed declarations, exactly the case step 2 exists to catch.
   On `no-yq`, a powbox file exists and nothing here can read it: stop and ask the user to install `yq` or to run this inside the powbox container.
   `checkout=linked` is a linked worktree, which powbox never mounts on: run the probe from the main checkout instead.

2. **Reconcile `.powbox.yml` — reading the override first.**
   `override=active` is the local override described above: `detect-shadows.sh` reads `$ROOT/.powbox.local.yml` instead of the committed list and logs `detect-shadows: shadow list overridden by .powbox.local.yml`.
   `powbox_local_yml=unparseable` is no override either, because powbox takes none from a file it cannot parse: it falls back to `.powbox.yml`, which is then genuinely the effective list.
   Whenever `powbox_local_yml_ignored=no` — override or not — tell the user: the file is user-local, powbox's launcher only *warns* about the gap, and this skill never stages or commits it (see step 6).

   Then give `.powbox.yml` every root whose `worktree_root=` line reads `committed=no`.
   - `powbox_yml=absent` → create it with a `shadow:` list containing the three literal entries above.
   - Present → add the missing entries to its `shadow:` list.
     **Keep every existing entry** (other shadow paths, monorepo `node_modules` globs, etc.) untouched.

   `.powbox.yml` gets the three entries either way — it is the durable, shared record every teammate and future container inherits — but an active override's list is the one that mounts.
   With `override=none` the committed list is the effective one and this step is done; the rest of it applies only to `override=active`.
   If all three roots read `override=yes`, the effective list is compliant and there is nothing to resolve (step 5 still verifies it) — but `.powbox.yml` is still replaced wholesale, so record that too and name its entries the override lacks, the `override_drops=` lines: those are the declarations that stay unmounted.
   Otherwise say plainly that what you wrote is inert, and confirm one of two resolutions before editing a user-local file: add the three entries to the override's `shadow:` list, keeping its existing entries and its other keys untouched; or have the user retire the override by dropping its `shadow:` key so the committed list takes effect.
   Retiring is not free: name the entries it would stop declaring — the `override_only=` lines, every path the override holds and `.powbox.yml` does not — and note that `shadow-refresh.sh` only adds mounts, so each keeps its tmpfs, and its host-invisible writes, until the next container start.

3. **Reconcile `.gitignore`.**
   `$ROOT/.gitignore` has to ignore `.worktrees/` and `.claude/worktrees/`, and `ignored=shared` on a root's line says a committed rule already does.
   - The probe asks git rather than matching text, so an existing equivalent entry is accepted (`.worktrees` without a trailing slash also matches the directory).
     Every rule of an ignore file with any uncommitted change reads `unshared`, so when `rule=` names `.gitignore` itself the rule needs nothing added; it reads `shared` once that file's pending change is committed, which may be the user's own edit rather than yours.
     Otherwise add what reads `no`, or `unshared` — a rule teammates do not have, whose source `rule=` names — under a short comment such as `# powbox git worktrees (container-local; never commit working trees)`.
   - Do **not** add `.git/worktrees`.

4. **Guard against leaked tracking.**
   A root whose line reads a `tracked=` count above zero has files in the index.
   `git -C "$ROOT" rm -r --cached -- <root>` them (keeping the working copy) so worktree contents stop being committed.
   Report what you untracked.

5. **Apply immediately in this session — optional, except after an override.**
   Committed declarations take effect automatically at the *next* container start.
   To shadow the directories now, in the running container, without relaunching, run `shadow-refresh.sh "$ROOT"` and then the probe again.

   `mounts=healthy` is the answer to require.
   `.worktrees` is healthy when it is its own mount on any container-local filesystem — normally the per-project volume, or tmpfs as a fallback.
   `.git/worktrees` must be a mountpoint and, when `.worktrees` is the persistent volume, durable (non-tmpfs, bound from it); `.claude/worktrees` must be tmpfs.
   If a check fails, tell the user to rebuild the powbox image on the host (`./build.sh all`) and relaunch; the repo config you wrote is still correct.
   `mounts=unknown` means the mount table was not read — no `findmnt` (`tools=`), which is not a powbox container, or one that failed, as stderr says: say which, and that nothing was verified.

   Skip this step only when step 2 found no override.
   A repo whose declarations may be inert is the one case where skipping the verification hides the failure completely — so once step 2 is settled — resolution applied, or the override already carrying the three roots — run these checks rather than deferring them to the next container start, and treat a failure as the run's outcome.
   Until they pass, the effective list is unproven and the repo must not be called worktree-ready.

6. **Commit the config.**
   These files belong in version control so every teammate and every future container inherits a worktree-ready repo.
   Stage and commit only this change — `.powbox.yml` and `.gitignore`, and not unrelated edits those files may already carry — following the repo's commit conventions, or, if the user prefers to review first, leave it staged and say so.
   Never stage `.powbox.local.yml`, whatever you agreed to write in it.

## Report

State concisely:

- Whether the repo was already compliant, or what you changed, per file.
- Whether a `.powbox.local.yml` override is in effect — and if so, that it replaces the committed list wholesale, whether that effective list already carries the three roots or the `.powbox.yml` entries are inert until it is resolved, any other `.powbox.yml` path the override drops, which resolution the user chose, what it stops declaring, and which file each change landed in.
  Never report the repo worktree-ready while an override's effective list still omits the three roots.
- A `.powbox.local.yml` that exists but does not parse — present but inert: powbox takes no override from it, so `.powbox.yml` is genuinely the effective list, and the override the user intended does nothing until that file's YAML is fixed.
- A `.powbox.local.yml` that exists but is not gitignored.
- Anything you untracked in step 4.
- Whether the container-local mounts are live in the current session (step 5) or pending the next container start.
- Any blocker: not a git repo, a malformed `shadow:` list in `.powbox.yml` or in an active override, or a stale image.

## Notes

- This skill changes only **repo config** — it does not create worktrees or run tasks.
  To execute a task batch across worktrees afterward, use `address-tasks`.
- If a harness other than Claude keeps its native worktrees under a different root (a Codex equivalent, say), declare and gitignore that root the same way, alongside the three above.
