---
name: enable-worktrees
description: Prepare a repository for git-worktree-based parallel development — verify and fix the repo-root .powbox.yml declarations and .gitignore so worktree scaffolding stays container-local (persistent volume for .worktrees and its co-located .git/worktrees metadata, tmpfs for the harness .claude/worktrees root) and is never committed. Trigger when the user wants to enable, set up, or prepare a repo for parallel worktree tasks, or to fix a repo that is not worktree-ready. Do NOT trigger to actually execute a task batch (use address-tasks) or for unrelated .gitignore edits.
---

Prepare the current repository to support the git-worktree parallel-development workflow.

This is the **setup** counterpart to `address-tasks`. That skill *runs* a task batch across worktrees and assumes the repo is already prepared; this skill *prepares* the repo's committed config so the workflow works hands-free on every future container. Run it once per repo, and re-run any time to verify or repair.

This is a small, mechanical config task — do it inline yourself. Do **not** spawn implementer/reviewer subagents.

## What "worktree-ready" means

Declared workspace subdirectories are kept container-local so writes there never reach the host bind mount. The launcher-mounted `.worktrees` volume takes precedence; `.git/worktrees` is bind-mounted from inside that volume (so per-worktree git metadata is durable, not tmpfs), and any other declared root that is not already a mountpoint gets a tmpfs shadow. For worktree-based parallelism a repo needs two committed things.

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

Those two are necessary, not sufficient. A `$ROOT/.powbox.local.yml` carrying its own top-level `shadow:` key replaces the committed list **wholesale**, so a repo can hold both files in perfect shape and still mount none of what they declare. The root that breaks first is `.claude/worktrees`: no launcher volume backs it, so it depends entirely on the declaration for its tmpfs, and while the effective list omits it, harness-native worktrees silently land on the host bind mount. `wt-bootstrap` then fails closed on that root — it refuses to start when a worktree root is not a container-local mountpoint — and points its remedy back at this skill, so an unresolved override reads as this skill failing at the very thing it reported fixing. Step 2 detects the case; until the effective list carries all three roots the repo is not worktree-ready, whatever `.powbox.yml` says.

Why this is safe and durable: the common `.git` (objects + refs) is *not* shadowed, so committed work persists on the host and survives container recycle. The powbox launcher backs `.worktrees` with a **persistent per-project volume** (which also holds the pnpm store, so worktree `pnpm install` hardlinks from it), and `.git/worktrees` is bind-mounted from `.worktrees/.gitworktrees` inside that same volume — so per-worktree git metadata is durable too, and a worktree (including its uncommitted changes) survives a container stop/recreate with `git status` still working. Only `.claude/worktrees` (harness-native working trees) stays ephemeral tmpfs. Container registrations never leak onto the host: the bind hides the host's own `.git/worktrees` and keeps ours inside the container-local volume. The `.worktrees` entry below is then a harmless **fallback** — skipped when the volume is mounted, used only if the container is launched without it (in which case `.git/worktrees` falls back to tmpfs). powbox's README "Workspace Shadow Mounts → Git Worktree Parallel Development" has the full model (readable under `/ctx/<mount-name>` if the powbox repo is mounted as context, but this skill ships the contract so that is optional).

## Procedure

Operate on the current repository only. Every step is idempotent and surgical — preserve unrelated content, comments, and formatting, and never remove shadow entries or gitignore lines you did not add.

1. **Locate the repo root.** `ROOT="$(git rev-parse --show-toplevel)"`. If this is not a git repository, stop and tell the user — worktrees require git.

2. **Reconcile `.powbox.yml` — checking for a local override first.** The local override described above replaces the committed list wholesale: `detect-shadows.sh` reads `$ROOT/.powbox.local.yml` instead and logs `detect-shadows: shadow list overridden by .powbox.local.yml`. powbox bakes `detect-shadows.sh` onto `PATH` in its containers, so it is the authority for how the effective shadow list is derived and every claim here can be checked against the script itself. Use powbox's own test, not a variant of it, and keep both of its halves: the override counts only when `[ -f "$ROOT/.powbox.local.yml" ]` holds **and** `yq -r 'has("shadow")' "$ROOT/.powbox.local.yml" 2>/dev/null` prints `true`. Guard the `yq` call on that existence test rather than running it unconditionally — the `2>/dev/null` above already silences the error a missing file raises, and the answer is the same either way, so the guard is hygiene rather than a behaviour fix — and treat a parse failure on a file that is there as no override either, because powbox does: it falls back to `.powbox.yml`, which is then genuinely the effective list. Presence alone is not enough: a local file with only `ctx:` overrides nothing, so the committed list stays the effective one and the reconciliation below proceeds normally. Whenever that file exists at all — override or not — run `git -C "$ROOT" check-ignore -q -- .powbox.local.yml` and tell the user when it is not ignored: the file is user-local, powbox's launcher only *warns* about the gap, and this skill never stages or commits it (see step 6).

   An active `shadow:` has to be a list of non-empty string paths before you act on it. Null, a scalar, a mapping, or a list containing a null, a collection, or an empty string is malformed: stop, report, and write **nothing at all** — not `.powbox.yml`, not `.gitignore` — rather than coercing a pathname or inventing a list inside a user-local file. An empty list is well-formed, and deliberately so — it disables the committed declarations, exactly the case this step exists to catch.

   Then read `$ROOT/.powbox.yml` if it exists.
   - Absent → create it with a `shadow:` list containing the three literal entries above.
   - Present → ensure the `shadow:` list contains each of the three entries and add any that are missing. **Keep every existing entry** (other shadow paths, monorepo `node_modules` globs, etc.) untouched. If the file has a `shadow:` key that is malformed by the same rule, stop and report rather than rewriting it.

   `.powbox.yml` gets the three entries either way — it is the durable, shared record every teammate and future container inherits — but the override's list is the one that mounts. If it already carries all three roots, the effective list is compliant and there is nothing to resolve (step 5 still verifies it) — but `.powbox.yml` is still replaced wholesale, so record that too and name any of its entries the override lacks: those are the declarations that stay unmounted. Otherwise say plainly that what you wrote is inert, and confirm one of two resolutions before editing a user-local file: add the three entries to the override's `shadow:` list, keeping its existing entries and its other keys untouched; or have the user retire the override by dropping its `shadow:` key so the committed list takes effect. Retiring is not free: name the entries it would stop declaring — every path the override holds and `.powbox.yml` does not — and note that `shadow-refresh.sh` only adds mounts, so each keeps its tmpfs, and its host-invisible writes, until the next container start.

3. **Reconcile `.gitignore`.** Ensure `$ROOT/.gitignore` ignores `.worktrees/` and `.claude/worktrees/`.
   - Accept an existing equivalent entry (`.worktrees` without a trailing slash also matches the directory). Only add what is missing, under a short comment such as `# powbox git worktrees (container-local; never commit working trees)`.
   - Do **not** add `.git/worktrees`.

4. **Guard against leaked tracking.** Run `git -C "$ROOT" ls-files -- .worktrees .claude/worktrees`. If anything is tracked, `git -C "$ROOT" rm -r --cached` it (keeping the working copy) so worktree contents stop being committed. Report what you untracked.

5. **Apply immediately in this session — optional, except after an override.** Committed declarations take effect automatically at the *next* container start. To shadow the directories now, in the running container, without relaunching:

   ```bash
   shadow-refresh.sh "$ROOT"
   for root in "$ROOT/.worktrees" "$ROOT/.claude/worktrees" "$ROOT/.git/worktrees"; do
     mountpoint -q "$root" || { echo "Unsafe worktree root (not a mountpoint): $root" >&2; exit 1; }
     findmnt -no TARGET,FSTYPE -T "$root"
   done
   # Harness working trees stay ephemeral tmpfs.
   [ "$(findmnt -nro FSTYPE -T "$ROOT/.claude/worktrees")" = tmpfs ] ||
     { echo "Unsafe harness worktree root (expected tmpfs): $ROOT/.claude/worktrees" >&2; exit 1; }
   # Per-worktree git metadata must be durable (bound from the volume, non-tmpfs)
   # whenever .worktrees is the persistent volume — a tmpfs .git/worktrees there
   # would be lost on recycle. (Both tmpfs together is the volume-less fallback.)
   wt_fs="$(findmnt -nro FSTYPE -T "$ROOT/.worktrees")"
   gitwt_fs="$(findmnt -nro FSTYPE -T "$ROOT/.git/worktrees")"
   if [ "$wt_fs" != tmpfs ] && [ "$gitwt_fs" = tmpfs ]; then
     echo "Unsafe: .git/worktrees is tmpfs while .worktrees is persistent — worktrees would not survive recycle. Rebuild/relaunch on an image with durable worktree metadata." >&2; exit 1
   fi
   case "$(findmnt -nro FSTYPE -T "$ROOT/.worktrees")" in
     9p|drvfs|virtiofs) echo "Unsafe .worktrees host filesystem" >&2; exit 1 ;;
   esac
   ```

   `.worktrees` is healthy when it is its own mount on any container-local filesystem — normally the per-project volume, or tmpfs as a fallback. `.git/worktrees` must be a mountpoint and, when `.worktrees` is the persistent volume, durable (non-tmpfs, bound from it); `.claude/worktrees` must be tmpfs. If a check fails, tell the user to rebuild the powbox image on the host (`./build.sh all`) and relaunch; the repo config you wrote is still correct.

   Skip this step only when step 2 found no override. A repo whose declarations may be inert is the one case where skipping the verification hides the failure completely — so once step 2 is settled — resolution applied, or the override already carrying the three roots — run these checks rather than deferring them to the next container start, and treat a failure as the run's outcome. Until they pass, the effective list is unproven and the repo must not be called worktree-ready.

6. **Commit the config.** These files belong in version control so every teammate and every future container inherits a worktree-ready repo. Stage and commit only this change — `.powbox.yml` and `.gitignore`, and not unrelated edits those files may already carry — following the repo's commit conventions, or, if the user prefers to review first, leave it staged and say so. Never stage `.powbox.local.yml`, whatever you agreed to write in it.

## Report

State concisely:

- Whether the repo was already compliant, or what you changed, per file.
- Whether a `.powbox.local.yml` override is in effect — and if so, that it replaces the committed list wholesale, whether that effective list already carries the three roots or the `.powbox.yml` entries are inert until it is resolved, any other `.powbox.yml` path the override drops, which resolution the user chose, what it stops declaring, and which file each change landed in. Never report the repo worktree-ready while an override's effective list still omits the three roots.
- A `.powbox.local.yml` that exists but does not parse — present but inert: powbox takes no override from it, so `.powbox.yml` is genuinely the effective list, and the override the user intended does nothing until that file's YAML is fixed.
- A `.powbox.local.yml` that exists but is not gitignored.
- Anything you untracked in step 4.
- Whether the container-local mounts are live in the current session (step 5) or pending the next container start.
- Any blocker: not a git repo, a malformed `shadow:` list in `.powbox.yml` or in an active override, or a stale image.

## Notes

- This skill changes only **repo config** — it does not create worktrees or run tasks. To execute a task batch across worktrees afterward, use `address-tasks`.
- If a harness other than Claude keeps its native worktrees under a different root (a Codex equivalent, say), declare and gitignore that root the same way, alongside the three above.
