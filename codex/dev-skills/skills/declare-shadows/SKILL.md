---
name: declare-shadows
description: A repository's gitignored build-artifact folders should be shielded from the host bind mount. Trigger when the user wants to declare, review, or fix shadow mounts for a repo, shield ignored artifact folders from the host, onboard a newly added project into the shadow config, or run declare-shadows. Applies the judgment auto-detection cannot - disposable output gets shadowed, build caches do not. Not for setting up worktrees (use enable-worktrees), running a task batch (use address-tasks), or unrelated .gitignore edits.
---

Review the current repository's gitignored artifact directories and declare the ones worth shadowing in `.powbox.yml`.

This is the **judgment** counterpart to powbox's automatic detection.
`detect-shadows.sh` already derives the unambiguous cases from project manifests — each workspace package's `node_modules`, and each `*.csproj`/`*.fsproj`/`*.vbproj` project's `bin` and `obj`.
Everything else (`dist/`, `.next/`, generated clients, `target/`, `.venv/`) cannot be derived from a manifest, because being gitignored does not make a directory safe to throw away.
That call is what this skill exists to make.

Run it once per repo, and again when a new project or toolchain is added.
This is a small, mechanical config task — do it inline yourself.
Do **not** spawn worker or explorer subagents.

## What a shadow does, and what it costs

A declared path gets a fresh **tmpfs** mounted over it at container start, so writes there stay container-local and never reach the host bind mount.
Two consequences drive every decision below:

- **The win: no host/container mixing.**
  Build output is frequently platform- and path-specific.
  Native `node_modules` binaries built for Linux break a Windows host's own install; MSBuild bakes absolute paths like `/home/node/.nuget/packages/` into `obj/`, which a host Visual Studio build then trips over.
  Shadowing keeps the two worlds apart.
- **The cost: it is RAM, and it is ephemeral.**
  Each shadow is its own tmpfs (2 GB cap by default, `SHADOW_TMPFS_SIZE`), allocated lazily.
  Everything in it is gone on container recreation.

So the test is not "is this directory gitignored?" — it is **"is this directory cheap to regenerate, and harmful to share with the host?"**

## What to shadow, and what to leave alone

**Shadow — disposable output.**
Regenerated from source by an ordinary build, no cross-run value:

- Compiled/bundled output: `dist/`, `build/`, `out/`, `lib/` (when generated)
- Generated code that a codegen step recreates: Prisma/GraphQL/OpenAPI client dirs
- Platform-specific dependency trees the auto-detection misses: a Python `.venv/`, vendored native addons

These are illustrations, not a catalogue.
Judge each directory from what you know about this repo's toolchains: a build tree that also holds the compiler's incremental state is the mixed case below, not disposable output.

**Do not shadow — caches.**
Their entire value is surviving between runs.
Shadowing one trades a real, repeated build slowdown for cleanliness you did not need, because a cache is already private-by-design and rarely host-incompatible:

- Task/build caches: `.turbo/`, `.gradle/`, `.nx/`, `.mypy_cache/`, `.ruff_cache/`, `.pytest_cache/`
- Mixed directories — output and cache in one tree, such as `.next/` holding its build alongside `.next/cache/`.
  Prefer shadowing nothing here, or the output subpath only — never blanket-shadow the parent and silently discard the cache on every recreate.

**Do not shadow — anything another mechanism already handles.**
Redundant entries are noise that future readers must re-derive:

- Any workspace package's `node_modules` (from `pnpm-workspace.yaml` / `package.json` `workspaces`)
- Any `bin`/`obj` beside a `*.csproj`/`*.fsproj`/`*.vbproj`
- The root `node_modules` (the launcher mounts a Docker volume there)
- `.worktrees`, `.claude/worktrees`, `.git/worktrees` (declared by `enable-worktrees` itself, not derived by the auto-detection)

**Do not shadow — anything with content a human might want.**
Shadowing makes it invisible from the host and destroys it on recreate:

- Artifacts someone opens on the host: coverage reports, Playwright `test-results/`, screenshots, profiling output
- Local state: SQLite databases, uploads, seeded fixtures, `.env` files
- Anything **tracked by git** — a shadow would mask committed files.
  Verify before declaring.

When a directory is genuinely borderline, leave it undeclared and say so in your report.
A missing shadow is a minor inefficiency; a wrong one silently deletes something on every container recreate.

## Declare literals, not globs

powbox treats the two forms differently, and for artifact directories only one of them works:

- A **literal** path (no `*`, `?`, `[`, `]`) is created and shadowed at startup **even when it does not exist yet**.
- A **glob** is existence-gated — only directories present at container start are shadowed.

Build output does not exist on a fresh clone or after a clean, which is exactly when the shadow has to be established.
So `apps/web/dist` (literal, per project) works and `apps/*/dist` (glob) silently shadows nothing on a fresh checkout.
Enumerate the projects.

## Procedure

Operate on the current repository only.
The facts come from `probe.sh`, beside this file: it only reads, it mounts nothing, and its header (`probe.sh --help`) defines every field named below.
Every edit is idempotent and surgical — preserve unrelated content, comments, and formatting, and remove an entry you did not add only after the user confirms it in step 4.

1. **Probe.**
   Run `probe.sh shadows` from inside the repository; `repo=` is the root, `$ROOT` below.
   Only `outcome=probed` lets the run continue.
   On `not-a-repository`, stop and tell the user.
   On `malformed`, `.powbox.yml` does not parse or is not a mapping, or a `shadow:` value in it or in an active override is not a list of non-empty string paths — null, a scalar, a mapping, or a list containing a null, collection, or empty string — and each `malformed=` line names the file: stop and report rather than coercing a pathname or editing a list you would have to invent.
   An empty list is well-formed, and deliberately so: it disables the committed declarations.
   On `no-yq`, a powbox file exists and nothing here can read it: stop and ask the user to install `yq` or to run this inside the powbox container.
   On `incomplete`, run it again with a larger `--limit`.
   `checkout=linked` is a linked worktree, which powbox never mounts on: run the probe from the main checkout instead.

   The probe lists what exists, so a project that has never been built shows nothing.
   Read each file a `gitignore=` line names for directory patterns that have not materialized yet, enumerate the project paths they would produce, and run the probe again with one `--candidate <path>` per path so they are judged on the same facts.

2. **Read the override first.**
   `override=active` means `$ROOT/.powbox.local.yml` has a top-level `shadow:` key and **replaces the committed `.powbox.yml` list wholesale** — the override's list, not the committed one, is what this container mounts (`effective=`).
   The probe uses powbox's own test, not a variant of it, and keeps both of its halves — the file is there, and `yq -r 'has("shadow")'` on it prints `true` — so presence alone is not enough: a local file with only `ctx:` overrides nothing, and the committed list stays the effective one.
   `powbox_local_yml=unparseable` is a different condition from `malformed`, with the opposite outcome: powbox takes no override from a file it cannot parse and falls back to `.powbox.yml`, which is then genuinely the effective list, so the run continues.
   Audit an active override: a cache or database declared there is exactly as live as one in `.powbox.yml`, which is why its entries are candidates too (`from=override`).
   Say so and confirm how to proceed before editing — the committed file stays the durable record of the agreed set, but nothing you write there takes effect while the override stands, so the user has to either retire the override or accept the same change in it.
   `powbox_local_yml_ignored=no` is a gap to surface whenever it appears: the file is user-local, and powbox's launcher only *warns* about it.

3. **Classify each candidate** against the three "do not shadow" lists above.
   Each `candidate=` line is one literal path with its facts.
   Paths already declared in either list are candidates too (`from=committed`, `override`, or `glob` for a directory a declared glob matches): a review or fix run has to re-judge what is declared, not only what is missing, and either list can end up the effective one.
   Judge an already-declared path by the same lists — one that now lands in a "do not shadow" list is a finding, not a fixture.
   Keep a candidate, new or declared, only when every fact below holds; a declared one that fails is a finding and must not be approved or retained.

   - `ignored=shared`.
     Because the declaration you would commit is shared, the ignore rule has to be shared too: `rule=` names the matching source, and a rule that is not part of the committed tree (`unshared`) — a personal global excludes file, `.git/info/exclude`, or an uncommitted `.gitignore` edit — does not ignore the path for teammates, so treat such a candidate as unignored.
     Every rule of an ignore file with any uncommitted change reads `unshared`, because a rule's effect depends on the lines around it: when `rule=` names such a file, the rule only needs committing, not adding again.
   - `tracked=no`.
     A shadow would mask committed files.
   - `guard=ok`.
     The root index cannot reveal files owned by another index or a symlink target, so leave any candidate that fails this guard undeclared and surface it with the reason the probe gives.
     This deliberately surfaces a candidate with a nested `.git` anywhere below it even when that nested checkout is disposable, such as an editable package inside `.venv`; accept that conservative false negative rather than risk hiding human-owned repository content.
     `unscanned` is the same answer until a run with a larger `--scan-limit` clears it.
   - `mount=none` and `below=0`.
     `mount=unknown` with `below=-` means the mount table could not be read, and no `mounted=` line is printed either.
     Where `tools=` reads `findmnt:absent`, this is not a powbox container and nothing here is a shadow: judge the candidate on the other facts and report that its mounts were not verified.
     Where it reads `findmnt:present`, the read failed, as stderr says: treat the candidate as you would a mounted one, below.
     Anything else means the visible contents belong to a mount rather than the underlying host tree, so mark the host view unverifiable; a mount below the candidate means part of its view is the child mount's, and a tmpfs over the parent would occlude that live mount.
     Do not approve or retain a declaration for such a path, and do not propose removing an existing one, from this mounted view; ask the user to inspect the host path outside the container or restart in an environment where that mount is absent and rerun before deciding.
     When `mount=` is a filesystem other than `tmpfs`, also report that the path is not an active shadow: powbox skips an existing mountpoint, so a declaration there is ineffective and writes continue to the existing bind mount or volume.
   - `derived=no`.
     `yes`, like every `derived=` line, is a path powbox already shadows from a manifest.
     `unknown` means `detect-shadows.sh` was absent or failed, so the probe cannot say and prints no `derived=` line: leave the manifest-derived folders of the list above undeclared on your own reading, judge the rest on the other facts, and report that the check was not made.

   `guard=preauthorized` is the one exemption from those facts: the exact, already-declared `enable-worktrees` roots (`.worktrees`, `.claude/worktrees`, and `.git/worktrees`).
   Preserve them exactly, and never propose removing them from either list in this audit.

   Do not approve a glob as one literal path.
   Each `glob=` line gives a declared glob and how many directories it matches now; those matches are the `from=glob` candidates.
   Surface the glob even when every match passes and propose replacing it with those audited literals in step 4.
   A glob with no current matches is unverifiable, so surface it too.

4. **Confirm the judgment calls with the user.**
   List what you propose to shadow, what you are deliberately leaving alone, and any existing declaration you propose to drop, each with a one-line reason.
   Caches and human-facing output are the entries most worth naming explicitly — a user who wants `.turbo/` shadowed anyway should get to say so.
   Never remove an existing entry without that confirmation; it may be deliberate.

5. **Write `.powbox.yml`.**
   Add the agreed literal paths to the `shadow:` list, creating the file with a `shadow:` key if absent.
   Keep every existing entry that survived step 4, and drop only the ones the user agreed to remove.
   Give each new entry a short trailing comment saying what regenerates it, so the next reader does not have to re-derive the decision:

   ```yaml
   shadow:
     - apps/web/dist # bundler output — regenerated by `pnpm build`
     - packages/db/generated # prisma client — regenerated by `prisma generate`
   ```

   When step 2 found an active override, follow the resolution the user chose there.
   If they kept it, apply the same agreed additions and removals to `$ROOT/.powbox.local.yml` as well, or the fix stays theoretical; if they retired it, drop that file's `shadow:` key — leaving its other keys alone — so the committed list is what takes effect.
   Either way, never stage `.powbox.local.yml` in step 7: it is user-local.

6. **(Optional) Apply immediately in this session.**
   Committed declarations take effect at the next container start; to shadow the new paths now, without relaunching, run `shadow-refresh.sh "$ROOT"` and then the probe again.
   Expect `mount=tmpfs` on each newly declared path.
   `none` means nothing is mounted there; any other filesystem means an existing mount was left in place — powbox skips a path that is already a mountpoint, so a host bind would still be passing writes through to the host.

   A path that was non-empty before shadowing will appear **empty** afterwards — the tmpfs hides the previous host content, which is the intent.
   Warn the user before running this if any candidate held something they had not regenerated.

   Removal is not symmetrical, and this part applies even when you skip the refresh above.
   `shadow-refresh.sh` only adds mounts, and an unprivileged shell cannot unmount one, so a path that step 5 leaves undeclared — whether you dropped it from a list or it fell out when the override carrying it was retired — keeps its tmpfs for the rest of the session.
   The probe's `mounted=` lines name every live mount under the repository (none are printed while `mount=` reads `unknown`, which is no evidence of absence), so read them after the edit rather than testing the paths you removed: a removed **glob** has no path of its own to test, and the concrete mounts powbox created from it stay live.
   While a removed path is still listed as `tmpfs`, writes there still land in the ephemeral mount and stay invisible from the host — which, for the database or upload directory that made the declaration unsafe in the first place, is the whole problem.
   Copy out anything that has to survive, and tell the user plainly that the removal itself only takes effect at the next container start.

7. **Commit the config.**
   `.powbox.yml` belongs in version control so every teammate and future container inherits it.
   Stage and commit only this change — not unrelated edits the file may already carry — following the repo's conventions, or leave it staged and say so if the user prefers to review.

## Report

State concisely:

- What you declared, and what regenerates each entry.
- What you deliberately left undeclared, and why — especially caches and anything host-facing.
- Any pre-existing declaration you removed or flagged as unsafe, and what it was costing — for a removed one, whether its tmpfs is still mounted in this session, what you rescued from it, and that the removal lands only on the next container start.
- Any path an active mount left unverifiable until its host tree can be inspected and, for a non-`tmpfs` mount, that it is not an active shadow.
- Whether a `.powbox.local.yml` override is masking the committed list, and which file each agreed change landed in.
- A `.powbox.local.yml` that exists but does not parse — present but inert: powbox takes no override from it, so `.powbox.yml` is genuinely the effective list, and the override the user intended does nothing until that file's YAML is fixed.
- Whether the shadows are live in this session (step 6) or pending the next container start.
- Any blocker: not a git repo, a malformed `shadow:` list in either `.powbox.yml` or an active override, or a candidate that turned out to be tracked.

## Notes

- This skill changes only **repo config** — it creates no directories and runs no build.
- Re-run it after adding a project in a language whose artifacts are not auto-detected.
  Adding a JS workspace package or a .NET project needs nothing: those are derived from the manifest automatically.
- If a declared directory keeps overflowing its tmpfs (`ENOSPC` during a build), raise `SHADOW_TMPFS_SIZE` for the container rather than removing the declaration.
