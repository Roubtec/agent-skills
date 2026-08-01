---
name: declare-shadows
description: Sweep a repository for gitignored build-artifact directories that should be tmpfs-shadowed and declare them in the repo-root .powbox.yml, so a container build never writes host-incompatible output onto the host bind mount. Applies the judgment auto-detection cannot — shadowing disposable output is a win, shadowing a build cache makes every future build slower. Trigger when the user wants to declare, review, or fix shadow mounts for a repo, shield ignored artifact folders from the host, or onboard a newly added project into the shadow config. Do NOT trigger to set up worktrees (use enable-worktrees), to run a task batch (use address-tasks), or for unrelated .gitignore edits.
---

Review the current repository's gitignored artifact directories and declare the ones worth shadowing in `.powbox.yml`.

This is the **judgment** counterpart to powbox's automatic detection. `detect-shadows.sh` already derives the unambiguous cases from project manifests — each workspace package's `node_modules`, and each `*.csproj`/`*.fsproj`/`*.vbproj` project's `bin` and `obj`. Everything else (`dist/`, `.next/`, generated clients, `target/`, `.venv/`) cannot be derived from a manifest, because being gitignored does not make a directory safe to throw away. That call is what this skill exists to make.

Run it once per repo, and again when a new project or toolchain is added. This is a small, mechanical config task — do it inline yourself. Do **not** spawn implementer/reviewer subagents.

## What a shadow does, and what it costs

A declared path gets a fresh **tmpfs** mounted over it at container start, so writes there stay container-local and never reach the host bind mount. Two consequences drive every decision below:

- **The win: no host/container mixing.** Build output is frequently platform- and path-specific. Native `node_modules` binaries built for Linux break a Windows host's own install; MSBuild bakes absolute paths like `/home/node/.nuget/packages/` into `obj/`, which a host Visual Studio build then trips over. Shadowing keeps the two worlds apart.
- **The cost: it is RAM, and it is ephemeral.** Each shadow is its own tmpfs (2 GB cap by default, `SHADOW_TMPFS_SIZE`), allocated lazily. Everything in it is gone on container recreation.

So the test is not "is this directory gitignored?" — it is **"is this directory cheap to regenerate, and harmful to share with the host?"**

## What to shadow, and what to leave alone

**Shadow — disposable output.** Regenerated from source by an ordinary build, no cross-run value:

- Compiled/bundled output: `dist/`, `build/`, `out/`, `lib/` (when generated)
- Generated code that a codegen step recreates: Prisma/GraphQL/OpenAPI client dirs
- Platform-specific dependency trees the auto-detection misses: a Python `.venv/`, vendored native addons

These are illustrations, not a catalogue. Judge each directory from what you know about this repo's toolchains: a build tree that also holds the compiler's incremental state is the mixed case below, not disposable output.

**Do not shadow — caches.** Their entire value is surviving between runs. Shadowing one trades a real, repeated build slowdown for cleanliness you did not need, because a cache is already private-by-design and rarely host-incompatible:

- Task/build caches: `.turbo/`, `.gradle/`, `.nx/`, `.mypy_cache/`, `.ruff_cache/`, `.pytest_cache/`
- Mixed directories — output and cache in one tree, such as `.next/` holding its build alongside `.next/cache/`. Prefer shadowing nothing here, or the output subpath only — never blanket-shadow the parent and silently discard the cache on every recreate.

**Do not shadow — anything another mechanism already handles.** Redundant entries are noise that future readers must re-derive:

- Any workspace package's `node_modules` (from `pnpm-workspace.yaml` / `package.json` `workspaces`)
- Any `bin`/`obj` beside a `*.csproj`/`*.fsproj`/`*.vbproj`
- The root `node_modules` (the launcher mounts a Docker volume there)
- `.worktrees`, `.claude/worktrees`, `.git/worktrees` (declared by `enable-worktrees` itself, not derived by the auto-detection)

**Do not shadow — anything with content a human might want.** Shadowing makes it invisible from the host and destroys it on recreate:

- Artifacts someone opens on the host: coverage reports, Playwright `test-results/`, screenshots, profiling output
- Local state: SQLite databases, uploads, seeded fixtures, `.env` files
- Anything **tracked by git** — a shadow would mask committed files. Verify before declaring.

When a directory is genuinely borderline, leave it undeclared and say so in your report. A missing shadow is a minor inefficiency; a wrong one silently deletes something on every container recreate.

## Declare literals, not globs

powbox treats the two forms differently, and for artifact directories only one of them works:

- A **literal** path (no `*`, `?`, `[`, `]`) is created and shadowed at startup **even when it does not exist yet**.
- A **glob** is existence-gated — only directories present at container start are shadowed.

Build output does not exist on a fresh clone or after a clean, which is exactly when the shadow has to be established. So `apps/web/dist` (literal, per project) works and `apps/*/dist` (glob) silently shadows nothing on a fresh checkout. Enumerate the projects.

## Procedure

Operate on the current repository only. Every step is idempotent and surgical — preserve unrelated content, comments, and formatting, and remove an entry you did not add only after the user confirms it in step 5.

1. **Locate the repo root.** `ROOT="$(git rev-parse --show-toplevel)"`. If this is not a git repository, stop and tell the user.

2. **Check for a local override first.** If `$ROOT/.powbox.local.yml` exists and has a top-level `shadow:` key, it **replaces the committed `.powbox.yml` list wholesale** — the override's list, not the committed one, is what this container mounts. Audit it: a cache or database declared there is exactly as live as one in `.powbox.yml`, so carry its entries into step 3 as candidates too. Say so and confirm how to proceed before editing — the committed file stays the durable record of the agreed set, but nothing you write there takes effect while the override stands, so the user has to either retire the override or accept the same change in it.

3. **Enumerate candidates.**

   ```bash
   git -C "$ROOT" ls-files --others --ignored --exclude-standard --directory
   ```

   This lists ignored paths that currently exist. Note the gap: a project that has never been built shows nothing, so also read `$ROOT/.gitignore` (and nested ones) for directory patterns that have not materialized yet. Discard plain files — only directories can be shadowed — and of those keep only the ones ignored in their own right (`git -C "$ROOT" check-ignore -q <path>`): a directory whose entire content is ignored is listed even when no rule ignores the directory itself, and shadowing that parent would hide whatever is added to it later. Include every path already declared in either `shadow:` list — the committed one and an active override's, per step 2 — as a candidate too: a review or fix run has to re-judge what is declared, not only what is missing, and either list can end up the effective one.

4. **Classify each candidate** against the three "do not shadow" lists above. For anything you are keeping, confirm it is not tracked: `git -C "$ROOT" ls-files -- <path>` must be empty. Judge an already-declared path by the same lists — one that now lands in a "do not shadow" list is a finding, not a fixture — but an entry another skill owns (the `enable-worktrees` worktree roots) is deliberate infrastructure, not a stray declaration: leave it alone.

5. **Confirm the judgment calls with the user.** List what you propose to shadow, what you are deliberately leaving alone, and any existing declaration you propose to drop, each with a one-line reason. Caches and human-facing output are the entries most worth naming explicitly — a user who wants `.turbo/` shadowed anyway should get to say so. Never remove an existing entry without that confirmation; it may be deliberate.

6. **Write `.powbox.yml`.** Add the agreed literal paths to the `shadow:` list, creating the file with a `shadow:` key if absent. Keep every existing entry that survived step 5, and drop only the ones the user agreed to remove. Give each new entry a short trailing comment saying what regenerates it, so the next reader does not have to re-derive the decision:

   ```yaml
   shadow:
     - apps/web/dist # bundler output — regenerated by `pnpm build`
     - packages/db/generated # prisma client — regenerated by `prisma generate`
   ```

   If the file has a `shadow:` key that is malformed or not a list, stop and report rather than rewriting it.

   When step 2 found an active override, follow the resolution the user chose there. If they kept it, apply the same agreed additions and removals to `$ROOT/.powbox.local.yml` as well, or the fix stays theoretical; if they retired it, drop that file's `shadow:` key — leaving its other keys alone — so the committed list is what takes effect. Either way, never stage `.powbox.local.yml` in step 8: it is user-local, and powbox's launcher only *warns* when `git check-ignore -q -- .powbox.local.yml` does not ignore it, so run that check yourself and surface the gap to the user when the file is not ignored.

7. **(Optional) Apply immediately in this session.** Committed declarations take effect at the next container start; to shadow the new paths now, without relaunching:

   ```bash
   shadow-refresh.sh "$ROOT"
   findmnt -no FSTYPE,SOURCE "$ROOT/<newly-declared-path>"
   ```

   Expect `tmpfs`. A non-zero exit means nothing is mounted there; any other filesystem means an existing mount was left in place — powbox skips a path that is already a mountpoint, so a host bind would still be passing writes through to the host.

   A path that was non-empty before shadowing will appear **empty** afterwards — the tmpfs hides the previous host content, which is the intent. Warn the user before running this if any candidate held something they had not regenerated.

   Removal is not symmetrical, and this part applies even when you skip the refresh above. `shadow-refresh.sh` only adds mounts, and an unprivileged shell cannot unmount one, so a path that step 6 leaves undeclared — whether you dropped it from a list or it fell out when the override carrying it was retired — keeps its tmpfs for the rest of the session. Run the same `findmnt` on every such path: while it still reports `tmpfs`, writes there still land in the ephemeral mount and stay invisible from the host — which, for the database or upload directory that made the declaration unsafe in the first place, is the whole problem. Copy out anything that has to survive, and tell the user plainly that the removal itself only takes effect at the next container start.

8. **Commit the config.** `.powbox.yml` belongs in version control so every teammate and future container inherits it. Stage and commit following the repo's conventions, or leave it staged and say so if the user prefers to review.

## Report

State concisely:

- What you declared, and what regenerates each entry.
- What you deliberately left undeclared, and why — especially caches and anything host-facing.
- Any pre-existing declaration you removed or flagged as unsafe, and what it was costing — for a removed one, whether its tmpfs is still mounted in this session, what you rescued from it, and that the removal lands only on the next container start.
- Whether a `.powbox.local.yml` override is masking the committed list, and which file each agreed change landed in.
- Whether the shadows are live in this session (step 7) or pending the next container start.
- Any blocker: not a git repo, a malformed `.powbox.yml`, or a candidate that turned out to be tracked.

## Notes

- This skill changes only **repo config** — it creates no directories and runs no build.
- Re-run it after adding a project in a language whose artifacts are not auto-detected. Adding a JS workspace package or a .NET project needs nothing: those are derived from the manifest automatically.
- If a declared directory keeps overflowing its tmpfs (`ENOSPC` during a build), raise `SHADOW_TMPFS_SIZE` for the container rather than removing the declaration.
