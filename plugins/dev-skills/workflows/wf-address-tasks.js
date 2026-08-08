/**
 * wf-address-tasks — dynamic-workflow form of the `address-tasks` skill.
 *
 * Resolve a batch of pre-planned task files into dependency waves, then run
 * each task through the shared review cycle — implement -> fresh-eyes review
 * plus a best-effort cross-harness codex peer review -> fix, bounded by the
 * cycle's canonical round cap — scan reviewed sibling branches for add/add
 * collisions before delivery and deconflict them (an orchestrator-deputy agent
 * renames one side, regenerates derived files, and the changed branch is
 * re-reviewed) — or hold a name that must stay identical — then open PRs for
 * the delivered tasks and report. Invoke as
 * `/dev-skills:wf-address-tasks <glob-or-file-list> [peer-opinions=off]`.
 *
 * Why a workflow rather than a skill
 * ----------------------------------
 * The control flow the skill spells out in prose — dependency waves, the
 * bounded implement -> review -> fix loop, dependent waves gated on their
 * prerequisites, "the implementer finishes before its reviewer starts" —
 * becomes ordinary JavaScript here, run deterministically instead of relying
 * on the model to follow it. Independent tasks fan out via `parallel()`.
 *
 * The per-task loop itself is NOT stated here: it is a synthesized copy of the
 * canonical wf-review-cycle's marked embeddable section (see the section
 * header below). EMBEDDED rather than nested deliberately: this script owns
 * the task fan-out, so every peer launch must be made by this one flat script,
 * whose module state is shared across the parallel() fan-out — the place
 * where task 015's session-local peer throttle can live beside the wave
 * throttling below and actually see every launch. A nested child would hold
 * its own state, and a throttle there would count one peer, never see a
 * sibling's, and cap nothing. No peer cap, floor, or fan-out shape is set
 * here; that policy is 015's alone.
 *
 * Worktree model — why NOT `isolation: "worktree"`
 * ------------------------------------------------
 * The runtime's built-in `isolation: "worktree"` creates a fresh temporary
 * worktree per agent at a runtime-chosen path (default `.claude/worktrees/`),
 * started from the repository's DEFAULT branch, with no documented way to
 * redirect it. That is wrong for this container in two ways:
 *   1. It does not honor powbox's `.worktrees/$CONTAINER_NAME/<slug>` convention
 *      — the per-container subdir on the persistent project volume that carries
 *      the pnpm hardlink store and lets two containers (Claude + Codex) share one
 *      repo without a peer's prune reaping live work. The runtime would land in
 *      the tmpfs-shadowed `.claude/worktrees/` instead (full package copies, a
 *      shared ~2 GB cap, no per-`$CONTAINER_NAME` discipline).
 *   2. A SEPARATE worktree per agent, started from the default branch, hides an
 *      implementer's commits from its reviewer.
 * So this workflow uses the same explicit worktree model as the
 * `address-tasks` skill: each task gets ONE worktree under
 * `.worktrees/$CONTAINER_NAME/<slug>`, created by its first implementer and
 * REUSED by that task's reviewer and every later round (so the reviewer sees the
 * commits and no agent ever tries to re-check-out a branch already checked out).
 * Tasks run concurrently because each lives in its own worktree; an agent's
 * WORKTREE CONTRACT keeps it inside its own directory. Push is for durability;
 * cross-stage visibility comes from sharing the on-disk worktree, not the remote.
 *
 * The worktree/git MECHANICS are not spelled out in prompt text. They live in
 * three image-baked helpers — `wt-bootstrap` (root-safety checks + orphan prune
 * + remote probe), `wt-enter` (rerun-safe worktree resolve/attach/create), and
 * `wt-remove` (guarded cleanup) — the same single source of truth the
 * worktree-running skills call. Agents here invoke those scripts and exercise
 * judgment; they never re-derive the lifecycle from prose.
 *
 * Runtime notes:
 *  - The script itself cannot read files or run shell/git — every git, gh, and
 *    file operation happens inside a spawned agent.
 *  - There is no mid-run user input. A blocker is surfaced by returning a result
 *    object, never by pausing to ask.
 */

// The runtime requires `export const meta = {...}` (a pure literal) as the
// FIRST statement: it is how the script registers as the
// `/dev-skills:wf-address-tasks` command and what the pre-run approval prompt
// shows. Wave phases are dynamic (`Wave N (...)`), so only the fixed phases
// are declared here; undeclared phase() titles still get their own progress
// group. The "Peer review (codex)" title must stay byte-identical to
// CYCLE_PEER_PHASE in the embedded review-cycle-core section below — a
// mismatch silently splits the progress display into an extra group.
export const meta = {
  name: "wf-address-tasks",
  description: "Implement a batch of pre-planned task files: dependency waves, per-task worktree, and the shared review cycle per task — implement -> fresh-eyes review plus a best-effort cross-harness codex peer review -> fix (review is cross-harness; peer outcomes never block; bounded round cap) — with a pre-PR collision guard that deconflicts add/add clashes (rename one side + re-review) or holds an imperative name, one PR per delivered task.",
  whenToUse: "Execute a folder/glob of pre-planned task files end to end with per-task worktree isolation and cross-harness review (a best-effort codex peer beside each task's fresh reviewer). Not for one-off coding requests or planning new tasks.",
  phases: [
    { title: "Bootstrap", detail: "wt-bootstrap: root-safety checks, orphan prune, remote probe" },
    { title: "Resolve batch", detail: "read task files, derive dependency waves and branches" },
    { title: "Peer review (codex)", detail: "best-effort cross-harness second opinion beside each task's reviewer rounds; its outcome never blocks" },
    { title: "Collision scan", detail: "diff added files across sibling branches for add/add clashes" },
    { title: "Collision resolve", detail: "rename one side of each clash, regen, re-review, then deliver" },
    { title: "Summary" },
  ],
};

// Conservative per-task estimate. On the volume-backed path pnpm packages are
// hardlinked, so the real cost is build artifacts + package metadata; 1 GiB
// keeps a comfortable margin without measuring a representative install (which
// a deterministic script cannot do).
const PER_WORKTREE_BYTES = 1024 ** 3;

const BOOTSTRAP_SCHEMA = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    blocker: { type: "string", description: "Why the batch cannot proceed (worktree roots unsafe, CONTAINER_NAME unset, wt-bootstrap missing). Empty when ok." },
    wtBase: { type: "string", description: "Absolute path to this container's worktree base, `<repo>/.worktrees/$CONTAINER_NAME`." },
    remote: { type: "boolean", description: "True if push/PR is available (remote reachable); false means local-branch-only fallback." },
    availBytes: { type: "number", description: "Free bytes on the .worktrees mount, verbatim from wt-bootstrap (drives wave-width throttling)." },
  },
  required: ["ok"],
};

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    defaultBase: { type: "string", description: "PR base branch for independent tasks (the user's override, else the current branch, else main)." },
    waves: {
      type: "array",
      description: "Tasks grouped into dependency waves; wave N runs only after wave N-1 has finished.",
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            slug: { type: "string", description: "Stable, ref-safe identifier (task number + short name); also the worktree dir name." },
            path: { type: "string", description: "Path to the task file." },
            content: { type: "string", description: "Full verbatim content of the task file." },
            branch: { type: "string", description: "Branch the implementer should create and work on." },
            base: { type: "string", description: "Base branch to create from and target the PR against (a prior task's branch for dependents)." },
            dependsOn: { type: "array", items: { type: "string" }, description: "Slugs of in-batch tasks this one depends on (its base is one of them). Empty array for independent tasks — required, never omitted, so a forgotten dependency cannot silently unblock a dependent." },
            upstream: { type: "string", description: "Short note on what an in-batch dependency introduced, or empty." },
          },
          required: ["slug", "path", "content", "branch", "base", "dependsOn"],
        },
      },
    },
  },
  required: ["defaultBase", "waves"],
};

const PR_SCHEMA = {
  type: "object",
  properties: {
    opened: { type: "boolean", description: "True ONLY if `gh pr create` succeeded and a PR URL exists." },
    url: { type: "string", description: "The created PR URL when opened is true." },
    pushed: { type: "boolean", description: "Whether the branch was pushed to the remote." },
    reason: { type: "string", description: "When opened is false: why (no remote auth, gh error, branch-target failure). Empty when opened." },
  },
  required: ["opened", "pushed"],
};

const COLLISION_SCHEMA = {
  type: "object",
  properties: {
    collisions: {
      type: "array",
      description: "Each entry is one newly-added surface that two or more INDEPENDENT sibling branches created on their own — a likely add/add clash (or duplicate definition) when the branches linearize. Empty array when none.",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", description: "path | filename | symbol — a duplicated repo-relative path, a duplicated basename at different paths, or a duplicated exported top-level name (class/function/const/interface/type/enum)." },
          name: { type: "string", description: "The colliding value: the repo-relative path, the basename, or the symbol name." },
          branches: { type: "array", items: { type: "string" }, description: "The two or more branches that each independently added it." },
          detail: { type: "string", description: "One actionable line for the integrator (e.g. 'both define class PaymentReconciliationController — rename one side and regen contracts')." },
        },
        required: ["kind", "name", "branches"],
      },
    },
  },
  required: ["collisions"],
};

const RESOLUTION_SCHEMA = {
  type: "object",
  properties: {
    resolutions: {
      type: "array",
      description: "One entry per collision from the scan: how it was deconflicted (which side renamed, to what) or that the shared name is imperative and the collision is blocked for a human.",
      items: {
        type: "object",
        properties: {
          collision: { type: "string", description: "The exact `name` of the collision (from the guard's list) this entry resolves." },
          action: { type: "string", description: "renamed | blocked. `renamed` = a side was renamed, regenerated, and committed; `blocked` = the name must stay identical and cannot be changed without a design decision." },
          changedBranches: { type: "array", items: { type: "string" }, description: "Branches actually modified + committed by this resolution (each is re-reviewed before delivery). Empty when blocked." },
          from: { type: "string", description: "The original colliding name/path. Empty when blocked." },
          to: { type: "string", description: "The new name/path on the renamed side(s). Empty when blocked." },
          regenerated: { type: "string", description: "Derived files regenerated after the rename (e.g. 'contracts'), or empty if none." },
          reason: { type: "string", description: "Why that side was chosen to rename, why multiple sides were renamed, or why the collision is blocked." },
        },
        required: ["collision", "action", "changedBranches"],
      },
    },
  },
  required: ["resolutions"],
};

// The boundary for this script's OWN briefs — every agent it spawns outside the
// embedded review-cycle-core section, which states the same rule for the three
// cycle roles through CYCLE_DESTROY_BOUNDARY. Two constants rather than one
// because the section is mirrored byte-for-byte from wf-review-cycle.js and
// cannot reference anything this file declares; the text below is instead
// identical to wf-address-review.js's, which brief for brief is the same shape:
// an assignment that spells out its own mutations and has no role contract to
// hang the boundary off. Several of these briefs point a subagent at mutating
// git or `gh` work in the SHARED tree, and `cleanupNote` sends it out of its
// worktree to the repo root — the exact posture the `rm -rf ./*` incident had.
const DESTROY_BOUNDARY = `## DESTROY BOUNDARY

Permitted: reading, searching, read-only \`git\`/\`gh\` queries, and the specific mutations this assignment spells out.
Forbidden: \`rm -rf\`, \`git reset --hard\`, \`git clean\`, \`git branch -f\`, \`git update-ref\`, \`git gc\`, and force-pushing — each of them beyond what this assignment itself spells out, whether as an exact command or as a skill it names to invoke — NOT in a clone, NOT in a temp directory, NOT "safely". You may not self-authorize one by putting yourself somewhere you believe is safe; what this assignment spells out, and the disposable clone below, are the only exemptions — and only because this assignment names them, not because a clone is safe.
A worktree is not a blast radius: it isolates the working tree, not the repository, so \`branch -f\`, \`reset\`, \`update-ref\`, and \`gc\` reach every sibling worktree through the shared \`.git\`.
Empirical verification that could change state belongs ONLY in a disposable clone. Run \`command -v dc-enter\`; where it is found, work in \`DC="$(dc-enter <slug>)"\` — it prints one absolute path on stdout, \`dc-remove <slug>\` drops it, and a reused slug is REFUSED rather than re-derived, so pass \`--replace\` or remove the slug first if this may run twice. Where the helper is absent, use an absolute path outside the repository — never a relative one, and never the repository itself.`;

function bootstrapPrompt() {
  return `Prepare this container for a worktree-isolated task batch. This is setup only — edit no project files.

${DESTROY_BOUNDARY}

1. From the repo root, run \`wt-bootstrap\` (an image-baked helper on PATH). It performs the whole Session Bootstrap deterministically: verifies the worktree roots are container-local (never the host bind mount), prunes ONLY this container's orphaned worktrees under \`.worktrees/$CONTAINER_NAME/\`, sets up the container-local SSH→HTTPS remote rewrite, probes push access, and prints one JSON object.
2. Map that JSON onto the structured result verbatim — \`ok\`, \`blocker\`, \`wtBase\`, \`remote\`, \`availBytes\` — with no reinterpretation. \`remote: false\` is NOT a blocker (the batch falls back to local branches and skips PRs).
3. If \`wt-bootstrap\` is not on PATH, the image predates it: return \`ok: false\` with blocker \`"image predates the wt-* helpers; rebuild the powbox image and relaunch"\`. Do not re-derive the checks by hand.
4. On \`ok: false\` from the script, return its \`blocker\` verbatim (typical remedies it names: set CONTAINER_NAME, run \`enable-worktrees\`, rebuild/relaunch).`;
}

const STORAGE_PROBE_SCHEMA = {
  type: "object",
  properties: {
    availBytes: { type: "number", description: "Free bytes on the .worktrees mount right now, from `df`; 0 when the probe could not measure." },
  },
  required: ["availBytes"],
};

function storageProbePrompt(wtBase) {
  return `Measure free storage for wave-width throttling. This is measurement only — edit nothing, create nothing.

${DESTROY_BOUNDARY}

Run \`df -B1 --output=avail ${shq(wtBase)}\` (POSIX fallback: \`df -kP\`, avail column, times 1024) and return the mount's free bytes as \`availBytes\`. If the path is missing or \`df\` fails, return \`availBytes: 0\`.`;
}

// Non-destructive cleanliness report for the SHARED main checkout. Every task
// runs in its own `.worktrees/$CONTAINER_NAME/<slug>` worktree, but the
// repository's MAIN checkout is shared with any peer harness invoked in this
// same container (Codex ↔ Claude) and with the user. Capturing porcelain status
// at the Bootstrap and Summary boundaries lets the batch flag main-checkout dirt
// WITHOUT ever modifying it — no stage/reset/clean/stash, and never a failure
// merely because the user deliberately started dirty.
const MAIN_CHECKOUT_SCHEMA = {
  type: "object",
  properties: {
    dirty: { type: "array", items: { type: "string" }, description: "One `git status --porcelain -z --untracked-files=all` record per changed path in the shared MAIN checkout (never a worktree): the 2-char `XY` status field, a space, then the repo-relative path (current path for a rename/copy). `--untracked-files=all` means each untracked FILE is listed on its own rather than collapsed to its directory, so files under a pre-existing untracked directory stay attributable. The `XY` prefix is preserved verbatim so the summary can tell a status-code change apart from a brand-new path. Empty when clean. The reading is bounded rather than exhaustive: `git status` surfaces what it surfaces — ignored paths (`.worktrees/` among them) fall outside it, as does anything else it does not report — so an empty or unchanged list bounds what the summary may claim, never proves nothing was written." },
    measured: { type: "boolean", description: "True only if `git status` ran in the main checkout and produced a definitive list. False when it could not be measured — then `dirty` is best-effort and must not be read as authoritative." },
  },
  required: ["dirty", "measured"],
};

function mainCheckoutStatusPrompt(when) {
  return `Non-destructive cleanliness snapshot of the SHARED main checkout (${when}). OBSERVE ONLY — do NOT stage, commit, reset, clean, stash, or edit anything. This step must never modify the tree; a checkout that is already dirty (e.g. the user's own work-in-progress) is fine and must not be "fixed".

${DESTROY_BOUNDARY}

Why: each task runs in its own \`.worktrees/$CONTAINER_NAME/<slug>\` worktree, but the repository's MAIN checkout is shared — a peer harness invoked in this container and the user both see it. Snapshotting its porcelain status at batch boundaries lets the summary report main-checkout dirt without touching it.

From the MAIN checkout root — your current working directory; confirm with \`git rev-parse --show-toplevel\` and do NOT \`cd\` into any \`.worktrees/...\` worktree — run \`git status --porcelain -z --untracked-files=all\` (the \`-z\` form leaves paths unquoted, so parsing is unambiguous; \`--untracked-files=all\` lists every untracked FILE individually instead of collapsing them to their directory, so a file added or removed beneath a pre-existing untracked directory stays individually attributable at the next boundary). Split the output on NUL and return one entry per changed record in \`dirty\`, each the record's 2-character \`XY\` status field, a space, then the repo-relative path — e.g. \` M src/app.ts\`, \`?? notes.txt\`. Keep the \`XY \` prefix verbatim (its first column can be a space) so the summary can distinguish a status-code change from a new path. For a rename/copy record git emits the ORIGINAL path as a second NUL-separated field after the current one — keep only the current-path entry and drop that trailing original. Return an empty array when the checkout is clean, with \`measured: true\`. If git cannot run, the directory is a linked worktree rather than the main checkout, or the status is otherwise indeterminate, return \`measured: false\` with whatever \`dirty\` you have and do not fail.`;
}

// Compare the pre-batch baseline against the post-batch snapshot. Purely
// descriptive: it classifies each path by whether it was already dirty before
// the batch (`preexisting`), appeared during it (`newPaths`), or DISAPPEARED
// during it (`disappeared`). When NO baseline was measured there is nothing to
// diff against, so final dirt is neither `new` nor `preexisting` — it goes into
// the neutral `unattributed` bucket and is never claimed to have appeared during
// the batch. A vanished baseline path is the load-bearing
// signal — the feature exists to surface possible destructive loss of user
// work, so a baseline path that is gone by Summary (a `git reset`/`clean`/
// `stash`, or an errant commit, could have taken someone's uncommitted work
// with it) must be reported, never swallowed into a "clean" verdict.
//
// Comparison is by PATH, not by the full `XY path` porcelain line: a path whose
// only change is its status code (` M f` → `MM f`) is the SAME pre-existing
// path (recorded as a `transition`), not a brand-new one. It never claims the
// new paths were agent-created (a concurrent peer harness or the user could
// equally be the source), and never claims the batch AS A WHOLE left the
// checkout untouched — only this report step is provably non-destructive; the
// batch's other stages run in per-task worktrees but are not separately proven
// to have stayed out of the main checkout. With no measured baseline it
// declines to attribute anything.
function mainCheckoutSummary(baseline, final) {
  // Included in every note so the report can never read as having itself
  // changed the checkout. Deliberately free of mutation verbs — the vanished
  // note below DOES name reset/clean/stash, but only as hypothetical EXTERNAL
  // causes, never as something this step did.
  const OBSERVED = "This report only observed the checkout and changed nothing in it.";
  // Finding: do not claim the WHOLE workflow was non-destructive — only the
  // observation step is guaranteed so.
  const OTHER_STAGES = "Other batch stages run in per-task worktrees and are not separately proven to have left the main checkout untouched.";
  // The claim bound, carried by EVERY note — including the ones with the least
  // information, where an unqualified sentence reads most like an all-clear.
  // Phrased against what the readings list rather than against a baseline, so
  // the one bound covers the unmeasured-baseline branches too. Deliberately an
  // EXCLUSION rather than a list of blind spots: the list is open, and widening
  // what the reading sees (individually-listed untracked files today, ignored
  // paths tomorrow) improves the report while leaving the claim exactly this
  // narrow. Reporting that a listed path was re-classified is an observation
  // this comparison can make; asserting that path was left alone is not.
  const CLAIM_BOUND = "This report says only what its readings could see: it claims nothing about what was written INTO paths those readings already list, nor about anything they do not surface at all.";

  // Parse one porcelain record into { raw, status, path }. Prefer `-z` output
  // (unquoted paths) upstream, but stay robust to plain porcelain: the leading
  // 2-char XY status field must NOT be trimmed (its first column can be a
  // space, e.g. " M"); a rename/copy record reads as `ORIG -> NEW`, so keep NEW
  // (the current path); and a defensively-unquoted path covers the non-`-z`
  // quoting case. A bare string with no XY prefix (index 2 is not a space) is
  // treated as a whole path with empty status.
  const parseEntry = (value) => {
    const raw = String(value == null ? "" : value);
    let status = "";
    let path = raw;
    if (raw.length > 3 && raw[2] === " ") {
      status = raw.slice(0, 2);
      path = raw.slice(3);
    }
    const arrow = path.indexOf(" -> ");
    if (arrow !== -1) path = path.slice(arrow + 4);
    if (path.length >= 2 && path[0] === '"' && path[path.length - 1] === '"') {
      path = path.slice(1, -1);
    }
    return { raw, status, path };
  };
  // Drop empty records before parsing: the `-z` porcelain output ends in a
  // NUL, so a naive split leaves a trailing "" — that is a split artifact, not
  // a real path, and must never surface as a phantom "" entry in
  // `newPaths`/`disappeared`.
  const parseList = (arr) =>
    Array.isArray(arr)
      ? arr.filter((v) => String(v == null ? "" : v) !== "").map(parseEntry)
      : [];

  const baselineMeasured = !!(baseline && baseline.measured);
  const baselineEntries = baselineMeasured ? parseList(baseline.dirty) : [];
  const baselineByPath = new Map(baselineEntries.map((e) => [e.path, e]));

  if (!final || !final.measured) {
    return {
      measured: false,
      baselineKnown: baselineMeasured,
      preexisting: baselineEntries.map((e) => e.raw),
      newPaths: [],
      disappeared: [],
      unattributed: [],
      transitions: [],
      flagged: false,
      note: `Post-batch main-checkout status could not be measured; cleanliness comparison skipped. ${OBSERVED} ${OTHER_STAGES} ${CLAIM_BOUND}`,
    };
  }

  const finalEntries = parseList(final.dirty);
  const finalByPath = new Map(finalEntries.map((e) => [e.path, e]));

  const preexistingEntries = baselineMeasured
    ? finalEntries.filter((e) => baselineByPath.has(e.path))
    : [];
  // With a measured baseline, final dirt splits into `new` (absent at baseline)
  // vs `preexisting`. With NO baseline there is nothing to diff, so it is
  // neither — it lands in the neutral `unattributed` bucket, never `new` (which
  // would falsely assert it appeared DURING the batch).
  const newEntries = baselineMeasured
    ? finalEntries.filter((e) => !baselineByPath.has(e.path))
    : [];
  const unattributedEntries = baselineMeasured ? [] : finalEntries.slice();
  const disappearedEntries = baselineMeasured
    ? baselineEntries.filter((e) => !finalByPath.has(e.path))
    : [];
  const transitions = preexistingEntries
    .filter((e) => baselineByPath.get(e.path).status !== e.status)
    .map((e) => ({ path: e.path, from: baselineByPath.get(e.path).status, to: e.status }));

  const preexisting = preexistingEntries.map((e) => e.raw);
  const newPaths = newEntries.map((e) => e.raw);
  const disappeared = disappearedEntries.map((e) => e.raw);
  const unattributed = unattributedEntries.map((e) => e.raw);

  let note;
  let flagged = false;
  if (!baselineMeasured) {
    if (finalEntries.length === 0) {
      note = `Shared main checkout showed nothing dirty at the final boundary, but no pre-batch baseline was captured, so nothing could be compared against it. ${OBSERVED} ${OTHER_STAGES} ${CLAIM_BOUND}`;
    } else {
      flagged = true;
      note = `Shared main checkout was dirty at the final boundary (${finalEntries.length} path(s)), but no pre-batch baseline was captured, so there is nothing to attribute them against and they are NOT credited to this batch. ${OBSERVED} ${OTHER_STAGES} ${CLAIM_BOUND} Inspect and clean up yourself if unexpected.`;
    }
  } else if (newPaths.length === 0 && disappeared.length === 0) {
    if (finalEntries.length === 0) {
      note = `Shared main checkout is clean and no pre-batch dirt disappeared. ${OBSERVED} ${OTHER_STAGES} ${CLAIM_BOUND}`;
    } else {
      const trans = transitions.length ? ` — ${transitions.length} changed status code while staying dirty on the same path` : "";
      note = `Shared main checkout dirt is unchanged from the pre-batch baseline (${preexisting.length} pre-existing path(s)${trans}); no path appeared and no pre-existing path disappeared during the batch. ${OBSERVED} ${OTHER_STAGES} ${CLAIM_BOUND}`;
    }
  } else {
    flagged = true;
    const parts = [];
    if (newPaths.length) parts.push(`gained ${newPaths.length} new dirty path(s)`);
    if (disappeared.length) parts.push(`LOST ${disappeared.length} path(s) that were dirty at the baseline`);
    const newClause = newPaths.length
      ? " New paths are attributed to no one in particular — a concurrent peer harness, the user, or a run that strayed from its worktree could each be the source."
      : "";
    const vanishClause = disappeared.length
      ? " Vanished baseline dirt can mean that uncommitted work was committed, reset, cleaned, or stashed away — by the user, a peer harness, or a batch stage that strayed from its worktree; if unexpected, check the reflog/stash before assuming it is lost."
      : "";
    note = `Shared main checkout ${parts.join(" and ")} during the batch, alongside ${preexisting.length} pre-existing path(s).${newClause}${vanishClause} ${OBSERVED} ${OTHER_STAGES} ${CLAIM_BOUND} Review before any cleanup.`;
  }

  return {
    measured: true,
    baselineKnown: baselineMeasured,
    preexisting,
    newPaths,
    disappeared,
    unattributed,
    transitions,
    flagged,
    note,
  };
}

function resolvePrompt(input) {
  return `You are scoping a batch of pre-planned task files for implementation. Do NOT implement anything.

${DESTROY_BOUNDARY}

Read \`AGENTS.md\` / \`CLAUDE.md\` first for project conventions.

Argument (a glob or file list; a \`peer-opinions=off\` token is a flag the loop already handled, not a task file — ignore it here): ${JSON.stringify(input)}

Do this:
1. Resolve the argument to the concrete set of task files and read each one in full.
2. Determine dependencies: an explicit "Depends on" field, shared infrastructure, or files/modules two tasks both create or migrate. When in doubt, treat tasks that touch the same files or migrations as dependent.
3. Group tasks into WAVES: wave 1 is every task with no unmet dependency; wave 2 depends only on wave 1; and so on. Tasks within a wave are independent and will run concurrently.
4. For each task set:
   - a ref-safe \`slug\` (task number + short name; also its worktree dir name),
   - a \`branch\` to implement on,
   - a \`base\`: the user's explicit base (if given) else the current branch for independent tasks; for a dependent task, the \`branch\` of the dependency it most directly extends (stacked PRs),
   - \`dependsOn\`: the slugs of in-batch tasks it depends on (the task(s) whose branch is its base), or empty,
   - \`upstream\`: a one-line note on what an in-batch dependency introduced, if any.
5. Set \`defaultBase\` to the user's explicit base override, else the current checked-out branch, else \`main\`.

Return the structured plan. Paste each task file's FULL content verbatim into \`content\` — downstream agents have no other access to it.`;
}

// Shell-quote a ref/slug/path before embedding it in a copy-paste command
// these prompts emit. `slug`/`branch`/`base` come from the plan agent's reading
// of task files and `wtBase` from the bootstrap agent's reading of
// `wt-bootstrap`, so a stray space or shell metacharacter (a git ref name
// forbids spaces but little else; a path forbids neither) could push/PR the
// wrong ref, measure the wrong mount, or run the rest of the line. Quoting via
// `JSON.stringify` is not equivalent — its DOUBLE quotes still expand `$…` and
// backticks. Single-quote and escape embedded quotes instead; adjacent quoted
// spans like `'a'..'b'` concatenate into one shell word, so `base..branch`
// still works. Declared here but hoisted, so the earlier storage probe uses it.
function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function worktreeContract(task, { mayCreate = false } = {}) {
  // wt-enter encodes the rerun-safe lifecycle (reuse the existing worktree,
  // attach an existing branch, create off the base) so prompts never re-derive
  // it. Stages that must not create work (reviewer, PR) omit the base: a
  // missing branch then errors instead of silently checking out an empty tree.
  const enter = mayCreate
    ? `WT="$(wt-enter ${shq(task.slug)} ${shq(task.branch)} ${shq(task.base)})" && cd "$WT"`
    : `WT="$(wt-enter ${shq(task.slug)} ${shq(task.branch)})" && cd "$WT"`;
  return `## WORKTREE CONTRACT (do this before anything else)

Resolve your worktree with the image-baked helper and \`cd\` into it:

    ${enter}

\`wt-enter\` is rerun-safe: it reuses this task's existing worktree (prior commits intact)${mayCreate ? `, attaches the existing branch \`${task.branch}\` if its worktree is gone, or creates the branch off \`${task.base}\` if neither exists yet` : ` or re-attaches the existing branch \`${task.branch}\`; it deliberately CANNOT create the branch for this stage — if it errors that the branch does not exist, the implementation is missing`}. If the command fails, STOP and report its error verbatim — never improvise your own \`git worktree add\` or \`git switch\`.

Then verify: \`git rev-parse --show-toplevel\` prints exactly \`$WT\` and \`git branch --show-current\` prints \`${task.branch}\`. If either is wrong, STOP and report.
Do ALL work inside WT only. Never \`cd\` to the repo root or touch sibling worktrees — other agents are working in their own worktrees concurrently.
Scope every cleanup to WT (\`git -C "$WT" …\`) and commit checkpoints often. The container's main checkout and its \`.worktrees\` volume are SHARED — a peer harness or a sibling task may hold uncommitted work there — so never run \`git reset --hard\`, and especially not \`git clean -fdx\` (it ignores \`.gitignore\`, so it would also wipe the \`.worktrees\` scaffolding), against the shared main checkout to reclaim space.`;
}

// ============================================================================
// Synthesized from wf-review-cycle.js EMBEDDABLE SECTION "review-cycle-core".
// Canonical home: plugins/dev-skills/workflows/wf-review-cycle.js — edit the
// canonical section there first, then refresh this copy verbatim.
// Embedded (not nested) DELIBERATELY: this script owns the task fan-out, so
// the fan-out, every peer launch, and any cross-cycle policy (task 015's
// session-local peer throttle) sit in this one flat script's state. A nested
// child cycle would hold its own state, where a throttle counts one peer,
// never sees a sibling's, and caps nothing. The shared batchPeerState below
// the section is the first such cross-cycle state: one batch-wide peer
// preflight/availability object handed to every per-task cycle. No peer cap,
// floor, or chunked fan-out is introduced here; that policy is 015's alone.
// ============================================================================
// ============================================================================
// BEGIN EMBEDDABLE SECTION: review-cycle-core
// Canonical home: plugins/dev-skills/workflows/wf-review-cycle.js
// A synthesized copy of this section MUST keep a header naming this canonical
// section ("Synthesized from wf-review-cycle.js EMBEDDABLE SECTION
// review-cycle-core") so edits here have a findable list of copies to refresh.
// The section depends only on the workflow runtime globals (agent, parallel,
// log) plus plain JS; it holds no module state, so a fan-out owner embedding
// it keeps every launch it makes in that owner's own flat script state.
// ============================================================================

// The canonical convergence safeguard. Consumers may only LOWER it.
const CYCLE_MAX_ROUNDS = 12;

// Exact phase title of the peer stage. Every script carrying this section MUST
// declare a meta.phases entry whose `title` matches this string byte-for-byte.
const CYCLE_PEER_PHASE = "Peer review (codex)";

// Bound a caller-supplied round cap. A larger value still stops at the
// canonical 12 (no consumer can configure its way past the convergence
// safeguard); 0, a negative, or a fractional value is a caller contract
// violation rejected outright — silently accepting it would yield a cycle
// that reviews nothing. Absent/undefined means the canonical cap.
function cycleRoundCap(maxRounds) {
  if (maxRounds == null) return CYCLE_MAX_ROUNDS;
  const n = Number(maxRounds);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(
      `Invalid maxRounds ${JSON.stringify(maxRounds)}: must be a positive whole number of reviewer rounds (it may only lower the canonical cap of ${CYCLE_MAX_ROUNDS}).`
    );
  }
  return Math.min(n, CYCLE_MAX_ROUNDS);
}

// Shell-quote a ref before embedding it in a copy-paste command these prompts
// emit. Git ref names forbid spaces but little else, so a branch or base
// carrying `$`, a backtick, or `;` — legal, and reachable from a task-derived
// name — would still expand or run inside the DOUBLE quotes `JSON.stringify`
// produces, scoping the review against the wrong ref or executing something
// unintended. Single-quote instead and escape embedded quotes; adjacent quoted
// spans like `feat/'b'` concatenate into one shell word, so the ref resolves.
// Prefixed `cycle` like the rest of this section: a consumer synthesizing the
// section into its own flat script may already define its own `shq`.
function cycleShq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

// Reduce a slug to ONE filesystem path segment before it lands in the artifact
// directory template. The slug is routinely a branch name — the fallback on
// both entry paths (`args.branch` structured, `scoped.branch` from scoping),
// and "ref-safe" admits `/` — which `mktemp -d ".../review-cycle-<slug>.XXXXXX"`
// reads as a parent directory that does not exist, failing the pass outright.
// Quoting cannot help here: `cycleShq` stops the shell mangling the value, not
// the path splitting on it. The rest of the filter is readability and defense
// in depth (a `$` splits no path), the length is bounded so the name stays
// well inside NAME_MAX, and an all-punctuation slug falls back to `cycle`.
// The `cycleShq` wrapper stays around the result: quoting every interpolated
// value is this section's uniform rule, so a later loosening of this filter
// cannot silently reintroduce an injection.
function cycleSlugSegment(s) {
  const seg = String(s == null ? "" : s)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .slice(0, 48)
    .replace(/^[-._]+|[-._]+$/g, "");
  return seg || "cycle";
}

// Pinned wire format for escalated open questions. It maps one-to-one onto the
// four-part brief `resolve-open-questions` serves (grounded context, concrete
// trigger, distinct options, recommendation), so a completed cycle's questions
// are consumable without re-derivation — that skill still re-verifies every
// carried claim (reachability especially) against current state before serving.
// A question a later pass SETTLES is MARKED, never dropped: the cycle stamps a
// `retired` object ({ pass, disposition, findingId, detail }) onto the
// accumulated entry, so the result still shows the question was raised and why
// it stopped needing an answer. The claim lands as `retirementPending` first
// and becomes `retired` only once a reviewer round PASSES with it in view — so
// a claim no reviewer accepted, including on the error and round-cap exits
// that never reach such a round, cannot read as settled to a consumer that
// skips retired questions. Both marks are script-applied and deliberately NOT
// schema properties — a fixer states a retirement through its disposition's
// `retiresQuestionIds`, never by self-marking a question it emits, and a
// volunteered mark of either kind is stripped where questions are accumulated.
const CYCLE_OPEN_QUESTION_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", description: "Stable within the run (e.g. \"<cycle-slug>-q1\"); referenced by dispositions and coupledWith." },
    question: { type: "string", description: "The decision itself, phrased as the fork — not a narrative." },
    origin: { type: "string", description: "reviewer | peer | implementer | rebase" },
    originRound: { type: "integer", description: "Cycle round it arose in." },
    blocking: { type: "boolean", description: "True: the cycle could not pass without the answer; false: parked nit/deferral." },
    artifacts: { type: "array", items: { type: "string" }, description: "Authoritative pointers only (\"file:line\", ref, PR/thread URL, task file) — never paraphrase." },
    trigger: { type: "string", description: "The concrete situation that manifests the problem." },
    reachability: { type: "string", description: "live | dormant | impossible-until | unknown — a CARRIED claim, re-derived before serving." },
    reachabilityCondition: { type: "string", description: "The flag/prerequisite when dormant/impossible-until; empty otherwise." },
    options: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          consequence: { type: "string", description: "What choosing it actually produces — blast radius, where it lands, what stays exposed." },
        },
        required: ["label", "consequence"],
      },
      description: "Drafted resolutions with blast radius; may be empty.",
    },
    recommendation: { type: "string", description: "Escalator's pick + one-line why; empty when the call turns on maintainer intent." },
    coupledWith: { type: "array", items: { type: "string" }, description: "Ids of sibling questions sharing the one underlying decision." },
  },
  required: ["id", "question", "origin", "originRound", "blocking", "artifacts", "trigger", "reachability", "reachabilityCondition", "options", "recommendation", "coupledWith"],
};

const CYCLE_FIX_SCHEMA = {
  type: "object",
  properties: {
    blocker: { type: "string", description: "Why this pass cannot proceed responsibly (wrong worktree, unresolvable state). Empty when the pass completed." },
    changed: { type: "boolean", description: "True if this pass changed the artifact (new commits / rewritten files); false for a disposition-only or no-op pass." },
    summary: { type: "string", description: "One paragraph: what this pass did." },
    dispositions: {
      type: "array",
      description: "EXACTLY one entry per reviewer/peer finding this pass was handed. EVERY handed finding must appear once — coverage is checked structurally by `findingId`; an uncovered finding, a finding given duplicate dispositions, and a disposition naming an id that was never handed all carry back to the next pass.",
      items: {
        type: "object",
        properties: {
          findingId: { type: "string", description: "The handed finding's `id`, echoed exactly — this is how coverage is verified. Omit only for a spontaneous disposition (e.g. of a pass-note), which has no handed id." },
          finding: { type: "string", description: "The finding, verbatim or by precise reference." },
          origin: { type: "string", description: "reviewer | peer" },
          disposition: { type: "string", description: "fixed | declined | escalated — nothing else counts as a disposition." },
          detail: { type: "string", description: "fixed: what changed + commit. declined: the reason (a decline is verified by the next fresh reviewer, never final here). escalated: one line naming the question." },
          questionId: { type: "string", description: "MUST be set when disposition is `escalated`: the id of the openQuestions entry this raised. It must name a question the cycle carries LIVE — the one this pass raises, or one an earlier pass raised that no retirement has claimed. An absent, empty, or already-retired id names no decision the maintainer will be asked to make and is reported back, never a silent no-op." },
          retiresQuestionIds: { type: "array", items: { type: "string", minLength: 1 }, description: "Ids of STILL-LIVE open questions from EARLIER passes that this disposition SETTLES, so the cycle stops carrying decisions the maintainer no longer has to make. Only `fixed` and `declined` retire (an `escalated` disposition raises a question rather than settling one), and only a question that was already open: a question this same packet RAISES cannot also be settled by it — that is a contradiction, not a retirement. Naming an id the cycle does not carry open from an earlier pass — an empty string included, which names nothing — is reported back, never a silent no-op. Retire nothing you did not actually settle: the retirement takes effect only once a reviewer round passes with it in view." },
        },
        required: ["finding", "origin", "disposition", "detail"],
      },
    },
    openQuestions: { type: "array", items: CYCLE_OPEN_QUESTION_SCHEMA, description: "One entry per `escalated` disposition, in the pinned wire format." },
    deviations: { type: "array", items: { type: "string" }, description: "Each: a deviation from a LOCKED maintainer decision — what was delivered instead and the constraint that forced it. Report, don't correct; the cycle surfaces these for the human." },
    workReport: { type: "array", items: { type: "object" }, description: "One entry per work item in the scope, in the per-item shape the scope's instructions define (a consumer contract rides through here untyped); echoed into the cycle result." },
    proactive: { type: "string", description: "Same-pattern fixes made beyond the literal items, or empty." },
    finalSha: { type: "string", description: "HEAD sha after this pass, with everything committed." },
    clean: { type: "boolean", description: "True only if `git status --porcelain` is empty with every intended change committed." },
    artifactDir: { type: "string", description: "Absolute path of this cycle's unique artifact directory — REQUIRED every pass: round 1 creates it (outside the worktree) and reports it, later passes echo the directory they were given. The result contract promises full round history reachable through it." },
  },
  required: ["changed", "dispositions", "openQuestions", "deviations", "clean", "artifactDir"],
};

const CYCLE_REVIEW_SCHEMA = {
  type: "object",
  properties: {
    pass: { type: "boolean", description: "True only if the artifact holds up per its type (build passes for code, every claim/disposition verified) and no material issue remains." },
    issues: {
      type: "array",
      description: "Numbered, actionable findings when pass is false. Empty when pass is true.",
      items: {
        type: "object",
        properties: {
          category: { type: "string", description: "criteria-gap | logic | error-handling | edge-case | dead-code | consistency | duplication | types | verbiage | scoping | conventions" },
          location: { type: "string", description: "file:line, or the item/section the finding concerns." },
          problem: { type: "string" },
          fix: { type: "string" },
        },
        required: ["category", "location", "problem", "fix"],
      },
    },
    emptyDiffFlag: { type: "boolean", description: "True if the diff against the base looked empty despite claimed work — signals a race/wrong-worktree, not real absence." },
    notes: { type: "string", description: "Pass-notes: caveats and stray remarks worth carrying. The cycle's final fixer pass disposes anything actionable here rather than letting it drop." },
  },
  required: ["pass", "issues"],
};

// Peer-stage result. `outcome` uses the peer-review-run vocabulary
// (powbox.peer-review-run/v1) so the eventual helper swap changes the prompt,
// not this contract.
const CYCLE_PEER_SCHEMA = {
  type: "object",
  properties: {
    outcome: { type: "string", description: "passed | issues | unavailable | timeout | forfeited | failed. Anything else is normalized to forfeited by the stage." },
    findings: {
      type: "array",
      description: "The peer's numbered findings when outcome is `issues`; empty otherwise.",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", description: "blocking | minor — BOTH gate the round." },
          location: { type: "string", description: "file:line" },
          claim: { type: "string", description: "The finding with its one-line rationale, verbatim." },
        },
        required: ["severity", "claim"],
      },
    },
    notes: { type: "string", description: "Anything after the verdict worth carrying (pass-notes), verbatim." },
    detail: { type: "string", description: "For a non-passed/issues outcome: why (logged out, timed out after retry, empty output, provider crash...)." },
  },
  required: ["outcome", "findings"],
};

const CYCLE_GROUNDING_SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          finding: { type: "string", description: "The finding checked, by its claim text." },
          grounded: { type: "boolean", description: "False ONLY for a self-evidently false claim or a nonexistent file:line reference. When in doubt, true — discarding is the exception." },
          why: { type: "string" },
        },
        required: ["finding", "grounded"],
      },
    },
  },
  required: ["verdicts"],
};

// What a subagent of this cycle may run, and what it may not — carried by every
// command-running prompt the section composes: fixer, reviewer, peer, grounding.
// A reviewer subagent authorized to verify a claim empirically once ran
// `rm -rf ./*` in a shared main checkout: its setup clone had failed invisibly
// inside a pipeline under `set -e` (a pipeline's status is its last command), so
// it was still at the repository root while believing it stood in a clone. Kept
// OUT of cycleDefaultContract deliberately: a consumer with its own worktree
// lifecycle overrides the contract via cycle.contracts and would otherwise drop
// the boundary along with it. The peer stage carries it like the rest: its
// `codex exec --sandbox read-only` constrains the CODEX process, not the
// subagent that composes and launches it, which has an unrestricted shell.
const CYCLE_DESTROY_BOUNDARY = `## DESTROY BOUNDARY

Permitted: reading, searching, and read-only \`git\`/\`gh\` queries — plus, where the contract above authorizes it, edits, commits, and pushes confined to the worktree and branch it names.
Forbidden: \`rm -rf\`, \`git reset --hard\`, \`git clean\`, \`git branch -f\`, \`git update-ref\`, \`git gc\`, and force-pushing — each of them beyond what this assignment itself spells out, whether as an exact command or as a skill it names to invoke — NOT in a clone, NOT in a temp directory, NOT "safely". You may not self-authorize one by putting yourself somewhere you believe is safe; what this assignment spells out, and the disposable clone below, are the only exemptions — and only because this assignment names them, not because a clone is safe.
A worktree is not a blast radius: it isolates the working tree, not the repository, so \`branch -f\`, \`reset\`, \`update-ref\`, and \`gc\` reach every sibling worktree through the shared \`.git\`.
Empirical verification that could change state belongs ONLY in a disposable clone. Run \`command -v dc-enter\`; where it is found, work in \`DC="$(dc-enter <slug>)"\` — it prints one absolute path on stdout, \`dc-remove <slug>\` drops it, and a reused slug is REFUSED rather than re-derived, so pass \`--replace\` or remove the slug first if this may run twice. Where the helper is absent, use an absolute path outside the repository — never a relative one, and never the repository itself.`;

// Where a role's redirected output goes. Every cycle brief that orders a build
// orders one whose output the role may want in a file, and a role left to pick
// its own path picks the session scratchpad: two concurrent reviewers both
// redirected their build output to `<scratchpad>/verify.log` there once, and
// one read the other worktree's results and returned a verdict for the wrong
// branch. The brief names the destination rather than leaving it to be chosen.
const CYCLE_REDIRECTED_OUTPUT = "Any build or validation output you redirect to a file goes under that same round directory, under any name you like — never a fixed shared scratchpad name: parallel cycles share one scratch directory.";

// Provenance of a brief's claims, carried by the fixer, reviewer, and peer
// briefs alike. Two claims relayed from an earlier round were wrong in a real
// run and reached a maintainer decision; only roles told to re-derive caught it.
const CYCLE_CARRIED_CLAIMS = "Provenance: only what you verify against the committed tree yourself is established this turn. Every finding, disposition, open question, and citation relayed to you here is CARRIED — not verified this turn, whatever its source; it may be stale, or have been wrong when written — so re-derive one before you rely on it.";

// Default worktree/branch contract when the consumer supplies none. A consumer
// with its own worktree lifecycle (wt-enter etc.) passes richer per-role
// contract text via cycle.contracts instead.
function cycleDefaultContract(cycle) {
  const where = cycle.worktree
    ? `Your worktree is \`${cycle.worktree}\`. Before anything else, \`cd\` into it and verify \`git rev-parse --show-toplevel\` prints exactly that path; if not, STOP and report — do not run any git or edit command outside it. Other agents may be working in other worktrees concurrently; stay in yours.`
    : `You work in the repository's current checkout — do NOT create a worktree and do NOT switch branches.`;
  return `${where}
You must be on branch \`${cycle.branch}\` — confirm with \`git branch --show-current\`; if it differs, STOP and report.`;
}

function cycleContract(cycle, role) {
  const contracts = cycle.contracts || {};
  return contracts[role] || cycleDefaultContract(cycle);
}

function cycleItemsBlock(cycle) {
  const items = cycle.scope && Array.isArray(cycle.scope.items) ? cycle.scope.items : [];
  return items.length ? `\n## Work items (verbatim)\n\n${JSON.stringify(items, null, 2)}\n` : "";
}

function cycleFindingsBlock(findings) {
  if (!findings) return "";
  const parts = [];
  if (Array.isArray(findings.carried) && findings.carried.length) {
    parts.push(`### Findings carried forward — the previous pass gave these NO single valid disposition (missing \`findingId\`, duplicate dispositions for one id, an unrecognized disposition value, an \`escalated\` naming no live open question — including one that same pass retired, which settles a decision rather than escalating to it — or, for a \`disposition-error\` entry, a disposition naming a finding id never handed, a retirement that settled nothing, or a spontaneous \`escalated\` disposition whose \`questionId\` names no live question). Dispose EVERY one now, exactly one disposition each, echoing its \`id\` as \`findingId\`.\n\n${JSON.stringify(findings.carried, null, 2)}`);
  }
  if (Array.isArray(findings.reviewer) && findings.reviewer.length) {
    parts.push(`### Reviewer findings\n\n${JSON.stringify(findings.reviewer, null, 2)}`);
  }
  if (findings.reviewerNotes) {
    parts.push(`### Reviewer notes\n\n${findings.reviewerNotes}`);
  }
  if (Array.isArray(findings.peer) && findings.peer.length) {
    parts.push(`### Peer (codex) findings\n\n${JSON.stringify(findings.peer, null, 2)}`);
  }
  if (findings.peerNotes) {
    parts.push(`### Peer (codex) notes\n\n${findings.peerNotes}`);
  }
  return parts.length ? `\n## Findings to dispose (each given VERBATIM — reconcile overlap or conflict yourself)\n\nWhere the reviewer and the peer name the SAME fact and differ only in whether it gates, the two channels agree on the substance and split on severity: dispose it on the merits and say which way, rather than re-litigating a fact neither disputes. Framing only — the gate is unchanged, and a grounded finding keeps its full force.\n\n${parts.join("\n\n")}\n` : "";
}

// The still-live open questions, shown to every fixer pass after the one that
// raised them. Without this block the fixer has no ids to name, so a question a
// later pass settles could never be retired — the whole point of the field.
// Omitted is every question a retirement already claims — settled (`retired`)
// or still awaiting the reviewer round that decides it (`retirementPending`):
// the claim stands either way, and a second one would only duplicate it.
// That omission is also why the block says outright that a claim cannot be
// withdrawn: there is no channel for a later pass to retract one (the question
// leaves this list the moment it is claimed, so no later disposition can even
// name it), and a fixer is owed that as a stated property of the contract
// rather than one it discovers when its claim keeps coming back.
function cycleOpenQuestionsBlock(openQuestions) {
  const live = (openQuestions || []).filter((q) => q && q.id && !q.retired && !q.retirementPending);
  if (!live.length) return "";
  return `\n## Open questions still live from earlier passes (verbatim)\n\nThese are queued for the maintainer as they stand. If a disposition you make now SETTLES one — you fixed the underlying issue, or you are declining it on grounds that dispose of the decision itself — name that question's \`id\` in the disposition's \`retiresQuestionIds\`, so the cycle stops carrying a decision the maintainer no longer has to make. Retire nothing you did not actually settle: an unretired question is served to the maintainer, and a wrongly retired one takes a real decision off the table. A retirement is a claim, not an effect — this round's fresh reviewer is shown it and the question stays live for the maintainer until a round passes over it. A claim also cannot be WITHDRAWN once made: no later pass can retract it, so it is re-presented to each following round until one passes over it and ships to the maintainer as still-live if none ever does. Name only what you would stand behind.\n\n${JSON.stringify(live, null, 2)}\n`;
}

function cycleFixPrompt(cycle, state) {
  const scope = cycle.scope || {};
  const roundIntro = state.confirming
    ? `The fresh reviewer has PASSED this cycle. This is the FINAL CONFIRMATION PASS of the disposition rule: read the passing reports below and dispose anything in them still worth acting on (pass-notes, stray remarks) — \`fixed\`, \`declined\` (with reason), or \`escalated\`. If nothing needs acting on, return \`changed: false\` with an empty \`dispositions\` array; that ends the cycle. Anything you fix or dispute will go through another reviewer round.`
    : state.findings
      ? `This is fix-up round ${state.round}. Address the findings below: dispose EVERY one explicitly — \`fixed\`, \`declined\` (with a reason; the next fresh reviewer verifies declines), or \`escalated\` to an open question in the pinned format — echoing each finding's \`id\` as your disposition's \`findingId\`, exactly ONE disposition per finding (coverage is checked structurally; an uncovered or double-disposed finding comes back to the next pass and blocks the round). Never drop one silently, and never implement a fix you believe is wrong just to clear a finding. Two convergence heuristics apply once rounds start repeating themselves. If consecutive rounds each puncture a NARROWER residual of the same finding, the artifact is over-claiming rather than under-specified: "bound the claim honestly" — state the premises, name the residual outright, give the operator definite branches — is a legitimate COMPLETE \`fixed\` disposition, but only where the bounded claim is one the artifact actually keeps; weakening a criterion to dodge the finding is not bounding it. If TWO consecutive rounds land findings of the same CLASS in the same section, stop patching instances and ask whether the structure is the defect — the two observed triggers are a closed enumeration standing in for an open set (replace it with an exclusion rule) and a spec keeping several options open so every criterion must hold under all of them (lock one option) — and if you raise that threshold for a section under heavy churn, state in \`summary\` the number you raised it to.`
      : `This is round 1: carry out the assignment below.`;
  const artifactHome = state.artifactDir
    ? `This cycle's artifact directory is \`${state.artifactDir}\` — report it back as \`artifactDir\` and write this pass's packet prose (what you did, dispositions, question drafts) under it as \`round-${state.round}/\`.`
    : `Create this cycle's UNIQUE artifact directory first — outside the worktree, e.g. \`mktemp -d "\${TMPDIR:-/tmp}/review-cycle-"${cycleShq(cycleSlugSegment(cycle.slug))}".XXXXXX"\` (never a fixed shared name: parallel cycles share scratch space) — report it as \`artifactDir\` (REQUIRED: the cycle refuses to run rounds with no home for their history), and write this pass's packet prose under it as \`round-${state.round}/\`.`;
  const artifactLine = `${artifactHome} ${CYCLE_REDIRECTED_OUTPUT}`;
  return `You are the fixer for one review cycle (branch \`${cycle.branch}\`, review base \`${cycle.base}\`, artifact type ${cycle.artifactType}).

## WORKTREE CONTRACT (do this before anything else)

${cycleContract(cycle, "fixer")}

${CYCLE_DESTROY_BOUNDARY}

Read the repository's agent-context files (\`AGENTS.md\` / \`CLAUDE.md\`) first for conventions.

${roundIntro}

## Assignment

${scope.instructions || "Address the work items below."}
${cycleItemsBlock(cycle)}${cycleFindingsBlock(state.findings)}${cycleOpenQuestionsBlock(state.openQuestions)}
## Rules

- ${artifactLine}
- Commit at logical milestones; run the project's build/lint before declaring done (code artifacts).
- A sweep ("fix this pattern everywhere") is ENUMERATED, never asserted: return the explicit search space with a per-item verdict, and claim a completed sweep in a commit message only where you enumerated that space. This round's reviewer redoes the enumeration rather than spot-checking yours.
- ${CYCLE_CARRIED_CLAIMS}
- If you must deliver something other than a decision the maintainer LOCKED, do not silently conform or correct: report it in \`deviations\` — what you delivered instead and the constraint that forced it. The cycle surfaces it for the human (report, don't correct).
- Every \`escalated\` disposition gets an \`openQuestions\` entry in the schema's pinned format, under an id no earlier pass used (re-using one reads as a re-report of that pass's question, which the cycle keeps instead of yours), with authoritative artifact pointers (file:line, refs) — never paraphrase — and its \`questionId\` back-reference — which must name a question this cycle carries LIVE (the one you just raised, or one an earlier pass raised that no retirement has claimed); an absent, empty, or settled id names no decision the maintainer will be asked to make and comes back to the next pass as a disposition error. Raise a question only for a decision still open: a \`fixed\` or \`declined\` disposition that SETTLES a still-live question from an EARLIER pass names that question's \`id\` in \`retiresQuestionIds\` instead (only those two dispositions retire; a question this pass raises cannot also be retired by it; and retiring an id the cycle does not carry open from an earlier pass comes back to the next pass as a disposition error).
- Before returning, \`git status --porcelain\` MUST be empty with every intended change committed; set \`clean\` and \`finalSha\` accordingly. An unclean tree is resolved or reported as a \`blocker\`, never handed to review.
- Pushing is governed by the assignment above; do nothing PR-side, and do NOT use the \`TaskCreate\`/\`TaskUpdate\`/\`TaskList\` tools.

Return the structured packet, including \`workReport\` per the assignment's per-item contract when it defines one.`;
}

function cycleReviewChecks(artifactType) {
  if (artifactType === "prose") {
    return `This is a PROSE artifact (a drafted task file or document); there is no build to run. Check verbiage, scoping, internal consistency, and the repository's house conventions — for task files, the documented numbering style (see the tasks folder's AGENTS.md where present). Read each drafted file in full.`;
  }
  if (artifactType === "decision") {
    return `This is an APPLIED-DECISION diff. Verify the diff implements exactly the locked option and nothing beyond it, then do the quality pass (logic, error handling, edge cases, dead code, consistency, duplication, type safety) on the touched files. Run the build/type-check first; a failure is an automatic blocker.`;
  }
  return `This is a CODE artifact. Run the full build/type-check FIRST; a failure is an automatic blocker (\`pass: false\`). Check every acceptance criterion the work items state against the actual code, then do the quality pass (logic, error handling, edge cases, dead code, consistency, duplication, type safety) on the touched files.`;
}

function cycleReviewPrompt(cycle, state) {
  const handed = state.handedFindings
    ? [...(state.handedFindings.carried || []), ...(state.handedFindings.reviewer || []), ...(state.handedFindings.peer || [])]
    : [];
  const handedBlock = handed.length
    ? `\n## Findings handed to the fixer this round (verbatim, with ids — verify EVERY one received an explicit, justified disposition below; a finding with no disposition was silently dropped, itself a blocking issue)\n\n${JSON.stringify(handed, null, 2)}\n`
    : "";
  const dispositionsBlock = state.packet && Array.isArray(state.packet.dispositions) && state.packet.dispositions.length
    ? `\n## Proposed finding dispositions (verify each; a \`declined\` must be technically justified, not a convenient dismissal — you may overrule it)\n\n${JSON.stringify(state.packet.dispositions, null, 2)}\n`
    : "";
  // A retirement is the fixer asserting a queued maintainer decision is
  // settled, so it goes to the same fresh reviewer that adjudicates a decline:
  // it is the only disposition that can take a question OFF the human's list,
  // and the dispositions block alone shows the id, never what was asked. This
  // round's verdict is what makes the claim take effect, so a claim an earlier
  // round did not pass is re-presented here rather than left unadjudicated.
  const proposedRetirementsBlock = Array.isArray(state.proposedRetirements) && state.proposedRetirements.length
    ? `\n## Open questions proposed for RETIREMENT (the fixer claims each is now SETTLED, so the maintainer will not be asked it — verify that claim against the committed state, exactly as you would a \`declined\`; a question retired without being genuinely settled silently drops a decision the human should have made, itself a blocking issue). Each entry's \`retirementPending\` names the pass and disposition claiming it; passing this round is what settles them, so one an earlier round did not pass appears again here.\n\n${JSON.stringify(state.proposedRetirements, null, 2)}\n`
    : "";
  const workBlock = state.packet && Array.isArray(state.packet.workReport) && state.packet.workReport.length
    ? `\n## Fixer's per-item report (verify the claims hold in the committed state; you were NOT given its reasoning)\n\n${JSON.stringify(state.packet.workReport, null, 2)}\n`
    : "";
  // This brief orders a full build, so the reviewer needs a destination for the
  // build's output as much as for its own report — including on the pass that
  // runs with no cycle behind it (the collision re-review), where leaving the
  // path to the reviewer is exactly how a shared scratch name gets chosen.
  const persistLine = state.artifactDir
    ? `\nPersist your full report for the round history: write the same content you return (verdict, numbered issues, notes) to \`${state.artifactDir}/round-${state.round}/reviewer-report.md\`. ${CYCLE_REDIRECTED_OUTPUT} That directory is OUTSIDE the worktree, and those files are the only exceptions to the no-file-creation rule.\n`
    : `\nYou were given no cycle artifact directory, so there is no round history to persist. If any build or validation output must land in a file, create a UNIQUE directory for it first — outside the worktree, e.g. \`mktemp -d "\${TMPDIR:-/tmp}/re-review-"${cycleShq(cycleSlugSegment(cycle.slug))}".XXXXXX"\` (never a fixed shared name: concurrent reviewers share one scratch directory) — and write inside it. Those files are the only exception to the no-file-creation rule.\n`;
  return `You are an independent fresh-eyes reviewer for one review cycle (branch \`${cycle.branch}\`, review base \`${cycle.base}\`, artifact type ${cycle.artifactType}). You have no knowledge of how the work was built, and that is the point. Edit NOTHING; create, update, or delete no files; do not use the task-tracker tools.

## WORKTREE CONTRACT (do this before anything else)

${cycleContract(cycle, "reviewer")}

${CYCLE_DESTROY_BOUNDARY}

Read the repository's agent-context files (\`AGENTS.md\` / \`CLAUDE.md\`) first for conventions.

${cycleReviewChecks(cycle.artifactType)}

Where the work claims a same-pattern sweep ("fixed everywhere"), REDO the enumeration of its search space yourself rather than spot-checking the enumeration supplied; a sweep asserted with no enumeration behind it is a finding in its own right.

${CYCLE_CARRIED_CLAIMS}

Scope with \`git diff --name-only ${cycleShq(cycle.base)}...HEAD\` — deliberately the CUMULATIVE range, the whole change against \`base\` rather than an incremental since-the-last-round diff, because each round re-reviews the work as a whole. Then read each touched file IN FULL — do not read commit messages or diff content (both anchor you to the fixer's intent); follow references into untouched files when needed. If the diff looks empty despite claimed work, set \`emptyDiffFlag\` and stop — that signals a wrong worktree/branch, not real absence.
${persistLine}${cycle.scope && cycle.scope.reviewInstructions ? `\n## Consumer review criteria (verify each item against these too)\n\n${cycle.scope.reviewInstructions}\n` : ""}${cycleItemsBlock(cycle)}${handedBlock}${dispositionsBlock}${proposedRetirementsBlock}${workBlock}
Return \`pass: true\` only if everything holds and no material issue remains; else \`pass: false\` with numbered, actionable \`issues\`. Be strict but fair — real gaps and functional problems, not style nits. Put pass-worthy caveats in \`notes\` (the cycle disposes them rather than dropping them).`;
}

// The peer invocation happens INSIDE this subagent prompt, never in the
// script (a workflow cannot shell out). Baseline destination: the
// `peer-review-run` helper (schema powbox.peer-review-run/v1) — retained
// pinned raw launch until that helper can carry the codex peer's CONFIGURED
// high-capability model, the one half of the review-strength passthrough still
// outstanding; its effort passthrough and strength reporting have landed. See
// the header comment. The launch pins review strength per invocation
// (-c model_reasoning_effort=medium; the model stays the peer's configured
// high-capability default from ~/.codex/config.toml) and never writes back to
// saved configuration.
function cyclePeerPrompt(cycle, state) {
  const evidence = {
    branch: cycle.branch,
    base: cycle.base,
    artifactType: cycle.artifactType,
    reviewCriteria: (cycle.scope && cycle.scope.reviewInstructions) || "",
    items: (cycle.scope && cycle.scope.items) || [],
    dispositions: (state.packet && state.packet.dispositions) || [],
    workReport: (state.packet && state.packet.workReport) || [],
  };
  const preflightStep = state.peerPreflighted
    ? `1. Preflight: already done this run — an earlier round verified the \`codex\` binary and login, so skip the probes. An auth/usage error from the launch itself still returns \`unavailable\`.`
    : `1. Preflight: if \`command -v codex\` fails, return outcome \`unavailable\` (detail: missing binary). If \`codex login status\` exits non-zero and \`CODEX_API_KEY\` is unset, return \`unavailable\` (detail: logged out). An auth/usage error from the launch itself is also \`unavailable\`.`;
  return `You run the best-effort cross-harness PEER REVIEW stage for one review-cycle round. You launch a read-only \`codex\` review of the committed state, wait for it, and return its result structurally. You NEVER fail this stage: every problem becomes a non-blocking outcome in the schema (\`unavailable\`, \`timeout\`, \`forfeited\`, \`failed\`) with a one-line \`detail\` — never an error, never a refusal to answer.

## WORKTREE CONTRACT

${cycleContract(cycle, "peer")}

${CYCLE_DESTROY_BOUNDARY}

The peer examines this worktree READ-ONLY; you edit nothing either. The cycle's fresh reviewer is examining the same committed state concurrently — two readers are safe, and the reviewer alone owns builds/execution.

## Steps

${preflightStep}
2. Prepare unique per-attempt paths under this cycle's artifact directory: \`round_dir=${cycleShq(`${state.artifactDir}/round-${state.round}`)}\`, \`mkdir -p "$round_dir"\`, with \`prompt_file\`, \`outfile\`, \`stderr_file\` inside it (suffix \`-attempt2\` on a retry; never reuse a path).
3. Write the peer prompt below VERBATIM to \`$prompt_file\` with a quoted heredoc (\`<<'PEER_PROMPT'\`) — never assemble it through shell interpolation.
4. Launch the peer as ONE supervised foreground call, bounded UNDER your own Bash tool limit so the tool can never kill it mid-run unaccounted (set the Bash tool timeout to 600000 ms and bound the peer tighter with \`timeout\`):

   \`\`\`bash
   worktree="<the worktree path from the contract above>"
   # Pin peer effort per invocation; never changes the container's saved config.
   timeout 540 codex exec --sandbox read-only --cd "$worktree" -o "$outfile" \\
     -c mcp_servers={} -c model_reasoning_effort=medium "$(<"$prompt_file")" \\
     < /dev/null 2> "$stderr_file"
   \`\`\`

   Exit 124 means the bounded timeout fired: retry ONCE with fresh attempt paths, then return outcome \`timeout\`. Any other failure (crash, non-zero exit with no usable output): retry once, then return \`failed\`. Auth/usage errors: \`unavailable\` without retry.
5. Read \`$outfile\`. A \`VERDICT: PASS\` line → outcome \`passed\` (anything after it goes to \`notes\` verbatim). A \`VERDICT: ISSUES\` line → outcome \`issues\`, with every numbered finding mapped verbatim into \`findings\` (severity from its \`blocking\`/\`minor\` tag — default \`blocking\` when untagged — plus its \`file:line\` as \`location\` and the finding text as \`claim\`; do not summarize, merge, or rewrite). No verdict line, or empty/unintelligible output → \`forfeited\`.

## Peer prompt (write this text to the prompt file verbatim, filling only the placeholders)

You are an independent read-only peer reviewer. Review the committed state of branch ${JSON.stringify(cycle.branch)} against base ${JSON.stringify(cycle.base)} in the current directory (artifact type: ${cycle.artifactType}). Read the actual files; edit nothing; run no builds or tests. Verify the work items and any proposed dispositions below in the committed code; a declined finding must be technically justified. ${CYCLE_CARRIED_CLAIMS} Evidence (verbatim):

${JSON.stringify(evidence, null, 2)}

Reply with exactly \`VERDICT: PASS\` or \`VERDICT: ISSUES\`, followed for issues by numbered findings each tagged \`blocking\` or \`minor\`, with \`file:line\` and a one-line rationale.

## Output

Return the structured result: \`outcome\`, \`findings\` (verbatim, tagged), \`notes\`, \`detail\`.`;
}

// The peer stage NEVER fails the round: a dead subagent (null return /
// schema-validation miss), a thrown stage, and every helper-vocabulary outcome
// that is not passed/issues all normalize to a recorded non-blocking outcome.
// The normalization is written as a complement (anything not passed/issues is
// non-blocking), so `failed` — and any future outcome — cannot fall through a
// switch over the named ones.
function normalizeCyclePeerResult(res) {
  if (!res || typeof res !== "object") {
    return { outcome: "forfeited", findings: [], notes: "", detail: "peer subagent returned nothing (died or failed schema validation); recorded non-blocking", synthesized: true };
  }
  const gating = res.outcome === "passed" || res.outcome === "issues";
  const known = ["passed", "issues", "unavailable", "timeout", "forfeited", "failed"];
  const outcome = known.includes(res.outcome) ? res.outcome : "forfeited";
  return {
    outcome,
    findings: outcome === "issues" && Array.isArray(res.findings) ? res.findings : [],
    notes: typeof res.notes === "string" ? res.notes : "",
    detail: typeof res.detail === "string" && res.detail
      ? res.detail
      : (gating ? "" : `peer outcome ${JSON.stringify(res.outcome)} recorded non-blocking`),
    // Script-synthesized results (dead/schema-failed subagent, thrown stage)
    // carry this marker: no peer subagent demonstrably ran, so the run-level
    // preflight must not be considered done on their account. A real agent
    // result never sets it (the field is not in CYCLE_PEER_SCHEMA).
    synthesized: res.synthesized === true,
  };
}

async function runCyclePeerStage(cycle, state) {
  if (cycle.peer === "off") {
    return { outcome: "disabled", findings: [], notes: "", detail: "peer-opinions=off" };
  }
  try {
    const res = await agent(cyclePeerPrompt(cycle, state), {
      label: `${cycle.labelPrefix || ""}peer#${state.round}`,
      schema: CYCLE_PEER_SCHEMA,
      phase: CYCLE_PEER_PHASE,
    });
    return normalizeCyclePeerResult(res);
  } catch (e) {
    // A thrown stage must not drop the round (or, under pipeline(), the item).
    return { outcome: "forfeited", findings: [], notes: "", detail: `peer stage threw (${e && e.message ? e.message : String(e)}); recorded non-blocking`, synthesized: true };
  }
}

function cycleGroundingPrompt(cycle, findings) {
  return `Cheap grounding spot-check, read-only. The fresh reviewer PASSED this round; only the peer findings below would gate it. For each, check that its \`file:line\` (or referenced site) exists in the worktree and that the claim is not self-evidently false. Do NOT re-review or judge severity — discard is only for nonexistent references and self-evidently false claims; when in doubt, \`grounded: true\`.

${cycleContract(cycle, "reviewer")}

${CYCLE_DESTROY_BOUNDARY}

## Findings

${JSON.stringify(findings, null, 2)}

Return a verdict per finding. Edit nothing.`;
}

// Structural enforcement of the disposition rule: every handed finding carries
// a script-assigned `id`, and a pass's dispositions must name each id with
// EXACTLY ONE recognized disposition (`escalated` additionally naming an open
// question that exists). A finding left uncovered — including one whose id
// drew duplicate, possibly conflicting, dispositions — gates the round and is
// carried forward VERBATIM to the next fixer pass, so no finding can vanish
// between rounds on a fixer's silence. A disposition naming an id that matches
// no handed finding covered nothing and is rejected: it comes back as a
// synthesized `disposition-error` carried entry (id prefixed `stray:` so it
// can never collide with a real round-scoped id) the next pass must dispose,
// so a mis-aimed disposition cannot pass silently either. When NOTHING was
// handed there is no coverage contract to enforce: every disposition is then
// spontaneous (e.g. of a pass-note) and carries no findingId requirement.
// Matching is by id, never by finding text — paraphrase-proof where text
// matching is not.
//
// The same treatment covers the OTHER direction of the question link: a
// `fixed`/`declined` disposition may name questions it retires, and a
// retirement that settles nothing — an id no question carries live FROM AN
// EARLIER PASS, or one attached to a disposition that settles nothing — comes
// back as a `disposition-error` carried entry (id prefixed `retire:`, which like
// `stray:` can never collide with a real round-scoped id) rather than no-op'ing
// silently. Unlike the coverage contract, that guard binds even on a pass
// handed nothing, since a retirement is a claim about the cycle's own
// accumulated questions rather than about this round's findings.
//
// An `escalated` disposition's `questionId` back-reference gets the same
// treatment (id prefixed `question:`, collision-proof for the same reason)
// wherever the coverage walk does not already judge it. Coverage judges it for
// a disposition that names a handed finding — an id naming no live question
// fails to cover, and the finding comes back carried, which IS the report — but
// a SPONTANEOUS disposition (no `findingId`, and every disposition on a pass
// handed nothing, which the final confirmation pass always is) covers nothing
// by construction, so that channel says nothing at all and the back-reference
// the contract requires would no-op silently. Reporting it there and only
// there also keeps one breach to one entry, rather than spending an extra
// round on a second report of a finding already carried.
//
// RETIRABLE and KNOWN are deliberately DIFFERENT sets. An `escalated`
// disposition names the question its own packet just raised, so
// `knownQuestionIds` must include this pass's new entries; a retirement asserts
// an EARLIER pass's queued decision is settled, so `retirableQuestionIds` is
// snapshotted BEFORE those entries are appended. Collapsing the two would let
// one packet raise `q1`, retire `q1`, and still have an `escalated` disposition
// naming `q1` count as covered — the finding would be disposed by a question the
// same breath marked settled, reaching neither the next pass nor the maintainer.
// The same reasoning invalidates an `escalated` disposition naming a question
// THIS packet retires (an earlier pass's question is nameable by both): the
// finding is carried forward rather than covered by a decision being taken off
// the table, which is why the retirements are collected before coverage is
// judged.
//
// Every SCHEMA-VALID entry survives this filter, the empty string included: the
// schema asks for non-empty ids (`minLength: 1`), so an empty one is a
// contract breach naming no live question — precisely what the guard below
// exists to report — and dropping it here would make the one shape the schema
// still admits as a `string` the one shape that no-ops silently. Non-strings
// are off-schema and cannot be reported AS an id (the entry is keyed by it), so
// they stay filtered, the same way a malformed disposition is simply not one.
function cycleRetiredQuestionIds(d) {
  return (Array.isArray(d.retiresQuestionIds) ? d.retiresQuestionIds : []).filter((q) => typeof q === "string");
}

function cycleUndisposedFindings(findings, fix, knownQuestionIds, retirableQuestionIds) {
  const handed = findings
    ? [...(findings.carried || []), ...(findings.reviewer || []), ...(findings.peer || [])]
    : [];
  const handedIds = new Set(handed.map((f) => f && f.id).filter(Boolean));
  const counts = new Map(); // handed id -> how many dispositions named it
  const covered = new Set();
  const stray = new Map(); // synthesized-entry id -> one carried entry per contract error
  const dispositions = (fix.dispositions || []).filter(Boolean);
  // The questions this packet actually retires — exactly what the caller will
  // mark — gathered first, because coverage below may not lean on one of them.
  const retiring = new Set();
  for (const d of dispositions) {
    if (d.disposition !== "fixed" && d.disposition !== "declined") continue;
    for (const qid of cycleRetiredQuestionIds(d)) if (retirableQuestionIds.has(qid)) retiring.add(qid);
  }
  // The one liveness test both question guards below use: known to the cycle
  // (this pass's own new questions included) and not being retired out from
  // under the escalation by this very packet.
  const liveQuestion = (qid) => knownQuestionIds.has(qid) && !retiring.has(qid);
  for (const d of dispositions) {
    const retires = cycleRetiredQuestionIds(d);
    if (retires.length) {
      const settles = d.disposition === "fixed" || d.disposition === "declined";
      for (const qid of retires) {
        if (settles && retirableQuestionIds.has(qid)) continue;
        stray.set(`retire:${qid}`, {
          id: `retire:${qid}`,
          category: "disposition-error",
          problem: settles
            ? `A ${d.disposition} disposition claimed to retire open question ${JSON.stringify(qid)}, which this cycle does not carry as a live open question from an EARLIER pass — it was never raised, this same pass raised it (one pass cannot both raise and settle a question: report whichever of the two is true, never both), or an earlier pass already retired it, or claimed to (a claim still awaiting the reviewer round that decides it has already spoken for the question) — so the retirement settled nothing. Re-issue it against the correct live question id as needed, and dispose this entry (e.g. declined) explaining the stray.`
            : `A disposition claimed to retire open question ${JSON.stringify(qid)}, but its \`disposition\` is ${JSON.stringify(d.disposition || "")} — only a \`fixed\` or \`declined\` disposition retires a question (an \`escalated\` one raises a question rather than settling it) — so the retirement was not applied. Re-issue it on the disposition that actually settles the question, and dispose this entry (e.g. declined) explaining the stray.`,
        });
      }
    }
    // When NOTHING was handed there is no coverage contract to enforce (the
    // retirement guard above still binds), and a disposition with no findingId
    // is spontaneous — neither carries a coverage obligation. What such a
    // disposition still owes, when it is `escalated`, is its question
    // back-reference, which nothing below it would ever look at.
    //
    // The HANDED case is deliberately NOT given an entry here as well, because
    // it is not silent and so needs no second carrier: `liveQuestion` in the
    // coverage walk below refuses to mark the finding covered, so the finding
    // returns as `outstanding.carried` under a header that names this very
    // reason (task 014a's scenario 16 pins it). A `disposition-error` entry is
    // this section's carrier of LAST resort — `stray:` and `retire:` exist
    // because nothing else would surface those breaches at all — so raising
    // one beside an already-carried finding would spend two entries, and two
    // fixer obligations, on one mistake.
    //
    // LIVE is the whole test, and a `retired`/`retirementPending` id is the
    // SAME breach as one no pass ever raised rather than a case of its own: in
    // both, the back-reference points at no decision the maintainer will be
    // asked to make — a question this cycle settled, or claims to have settled
    // pending the round that decides it, is off that list as surely as one
    // that was never on it, so a disposition escalating to it escalates to
    // nothing. Naming a STILL-LIVE id is no breach at all, even though the
    // re-report rule then keeps the raising pass's question body over this
    // pass's: that decision does reach the maintainer, and failing the round
    // over a restatement would cost the confirmation pass — where the cycle is
    // trying to converge — another round for nothing.
    //
    // An absent or non-string id normalizes to the empty string, which names
    // nothing and is exactly the breach worth reporting: the contract asks for
    // a non-empty id — a conditional no schema keyword here expresses, which
    // is why this guard has to enforce it for the spontaneous dispositions it
    // sees — and letting the empty one through would make the one breach still
    // typed as a `string` the one shape that no-ops.
    if (!handed.length || !d.findingId) {
      if (d.disposition === "escalated") {
        const qid = typeof d.questionId === "string" ? d.questionId : "";
        if (!liveQuestion(qid)) {
          stray.set(`question:${qid}`, {
            id: `question:${qid}`,
            category: "disposition-error",
            problem: `An \`escalated\` disposition named questionId ${JSON.stringify(qid)}, which this cycle does not carry as a LIVE open question — no pass raised it (an absent or empty id names nothing), or a retirement has already settled it, or claimed to (a claim still awaiting the reviewer round that decides it has already spoken for the question), or this same pass retires it (settling a decision rather than escalating to it) — so the back-reference points at no decision the maintainer will be asked to make. Re-issue the escalation with an \`openQuestions\` entry under an id no earlier pass used and name THAT id, or dispose what you escalated some other way, and dispose this entry (e.g. declined) explaining the stray.`,
          });
        }
      }
      continue;
    }
    if (!handedIds.has(d.findingId)) {
      stray.set(`stray:${d.findingId}`, {
        id: `stray:${d.findingId}`,
        category: "disposition-error",
        problem: `A disposition named findingId ${JSON.stringify(d.findingId)}, which matches no finding handed that round, so it covered nothing. Re-issue it against the correct handed id as needed, and dispose this entry (e.g. declined) explaining the stray.`,
      });
      continue;
    }
    counts.set(d.findingId, (counts.get(d.findingId) || 0) + 1);
    const valid =
      d.disposition === "fixed" ||
      d.disposition === "declined" ||
      (d.disposition === "escalated" && d.questionId && liveQuestion(d.questionId));
    if (valid) covered.add(d.findingId);
  }
  // Exactly one disposition per id: duplicates — conflicting or not — collapse
  // to "not validly disposed", carrying the finding forward.
  for (const [id, n] of counts) if (n > 1) covered.delete(id);
  return [...handed.filter((f) => !covered.has(f.id)), ...stray.values()];
}

// runReviewCycle — the whole protocol as one awaitable function.
//
// cycle: {
//   slug, worktree, branch, base, artifactType ("code"|"prose"|"decision"),
//   `base` must not MOVE under the cycle: never a movable remote-tracking name
//     like `origin/main`, never a pre-rebase SHA (unreachable afterwards — so
//     re-record it); pin it to an immutable OID or a recorded snapshot wherever
//     it can move mid-run. Rounds review the CUMULATIVE `base...HEAD` by
//     design: an INCREMENTAL re-review needs the recorded prior-round SHA, not
//     a fix commit's parent — after an amend `HEAD~1` spans the whole fix set.
//   scope: { title, instructions, items },
//   maxRounds (validated through cycleRoundCap), peer ("on"|"off"),
//   mode ("full"|"light"),
//   contracts: { fixer, reviewer, peer } — optional per-role preamble text
//     (a worktree-lifecycle consumer passes its own wt-enter contract here),
//   labelPrefix — optional, prefixes agent labels for fan-out consumers,
//   peerState — optional SHARED peer-availability state for a fan-out owner
//     embedding many cycles: hand every cycle ONE object of the shape
//     { preflighted: false, unavailable: false, unavailableDetail: "" } and
//     the install/login preflight runs once for the whole batch, with an
//     unavailable peer sticking batch-wide (the canonical batch rule).
//     Availability state ONLY — no peer cap, queue, or fan-out shape lives
//     here (that policy is task 015's). Omitted, each cycle keeps its own
//     (the standalone behavior).
// }
//
// Returns the cycle result contract (lean; bulk prose stays behind artifactDir):
// { verdict: "pass"|"review-cap"|"error", detail, rounds, findingDispositions,
//   openQuestions, deviations, workReport, proactive, finalSha, notes,
//   reviewerNotes, peerRounds, discardedPeerFindings, undisposed, outstanding,
//   artifactDir, artifactDirAnomalies (present only when a later pass tried
//   to move the artifact directory) }
// An `openQuestions` entry a later pass settled carries a `retired` mark; a
// consumer serving these to a human (resolve-open-questions) skips those. A
// retirement no reviewer round has accepted carries `retirementPending`
// instead and is STILL a live decision — that is what an `error` or
// `review-cap` exit leaves behind, neither having reached the round that
// would have settled it.
async function runReviewCycle(cycle) {
  const cap = cycleRoundCap(cycle.maxRounds);
  const lp = cycle.labelPrefix || "";
  const findingDispositions = [];
  const openQuestions = [];
  // Retirement claims awaiting a reviewer round's verdict. Not a result field:
  // each element IS the accumulated question object, so accepting one mutates
  // what the result already carries.
  const pendingRetirements = [];
  const deviations = [];
  const peerRounds = [];
  const discardedPeerFindings = [];
  const artifactDirAnomalies = [];
  let artifactDir = "";
  let packet = null;
  let rounds = 0;
  let fixerPasses = 0;
  let findings = null; // findings block for the next fixer pass; null on round 1
  let confirming = false; // next fixer pass is the final confirmation pass
  // Peer availability state: `preflighted` (the install/login preflight runs
  // once, never per round) and sticky `unavailable` (an unavailable peer is
  // not re-probed). A fan-out owner embedding many cycles passes ONE shared
  // object as cycle.peerState so the whole batch preflights once and
  // unavailability sticks batch-wide; a standalone cycle gets its own. (The
  // runtime is single-threaded JS, so sibling cycles mutate a shared object
  // safely between awaits.)
  const peerState = cycle.peerState || { preflighted: false, unavailable: false, unavailableDetail: "" };
  let reviewerNotes = ""; // the latest reviewer's pass-notes (PR-body caveats for consumers)

  const result = (verdict, detail, extra) => ({
    verdict,
    detail: detail || "",
    rounds,
    findingDispositions,
    openQuestions,
    deviations,
    workReport: (packet && packet.workReport) || [],
    proactive: (packet && packet.proactive) || "",
    finalSha: (packet && packet.finalSha) || "",
    notes: (packet && packet.summary) || "",
    reviewerNotes,
    peerRounds,
    discardedPeerFindings,
    artifactDir,
    ...(artifactDirAnomalies.length ? { artifactDirAnomalies } : {}),
    ...(extra || {}),
  });

  while (true) {
    fixerPasses += 1;
    const fix = await agent(cycleFixPrompt(cycle, { round: fixerPasses, findings, confirming, artifactDir, openQuestions }), {
      label: `${lp}fix#${fixerPasses}`,
      schema: CYCLE_FIX_SCHEMA,
    });
    if (!fix) return result("error", `fixer returned nothing on pass ${fixerPasses}`);
    if (fix.blocker) return result("error", `fixer blocked on pass ${fixerPasses}: ${fix.blocker}`);
    if (!fix.clean) return result("error", `fixer left an unclean worktree on pass ${fixerPasses}; refusing to review a partial state`);
    // The result contract promises the FULL round history reachable through
    // ONE pointer, so the FIRST reported artifactDir is authoritative, and it
    // is validated once here: absolute, and outside the worktree when the
    // cycle knows that path (a consumer whose agents resolve the worktree
    // themselves passes worktree: "", where only the fixer prompt's
    // outside-the-worktree instruction applies). A later pass echoing a
    // DIFFERENT directory does not move the pointer — earlier rounds would
    // become unreachable through it — but the anomaly is logged and recorded.
    if (fix.artifactDir && !artifactDir) {
      const wt = (cycle.worktree || "").replace(/\/+$/, "");
      if (!fix.artifactDir.startsWith("/")) {
        return result("error", `fixer reported a non-absolute artifactDir ${JSON.stringify(fix.artifactDir)} on pass ${fixerPasses}; the round-history home must be an absolute path outside the worktree`);
      }
      if (wt && (fix.artifactDir === wt || fix.artifactDir.startsWith(`${wt}/`))) {
        return result("error", `fixer placed artifactDir ${JSON.stringify(fix.artifactDir)} inside the worktree on pass ${fixerPasses}; the round-history home must live outside it`);
      }
      artifactDir = fix.artifactDir;
    } else if (fix.artifactDir && fix.artifactDir !== artifactDir) {
      artifactDirAnomalies.push({ pass: fixerPasses, reported: fix.artifactDir, kept: artifactDir });
      log(`fixer pass ${fixerPasses} reported artifactDir ${JSON.stringify(fix.artifactDir)}; keeping the first-captured ${JSON.stringify(artifactDir)} so the round history stays reachable through one pointer.`);
    }
    // A cycle with no home for its rounds' history may not run them.
    if (!artifactDir) return result("error", `fixer reported no artifactDir on pass ${fixerPasses}; refusing to run rounds whose history has no home`);
    for (const d of fix.dispositions || []) findingDispositions.push({ ...d, pass: fixerPasses });
    // The questions a disposition in THIS packet may retire: the ones live
    // before the pass's own are appended below — a question an earlier claim
    // already covers, accepted or still pending, is not retirable again.
    // Snapshotted here rather than beside `knownQuestionIds`, because that
    // append is precisely what destroys the distinction the two sets exist to
    // keep (see cycleUndisposedFindings).
    const retirableQuestionIds = new Set(openQuestions.filter((q) => q && !q.retired && !q.retirementPending).map((q) => q.id).filter(Boolean));
    // Accumulate newly raised questions. Every pass after the first is SHOWN
    // the still-live ones (so it has ids to retire), which makes re-reporting
    // one a live possibility; the entry from the pass that raised it stays
    // authoritative. Appending a second entry under the same id would fork the
    // question's state — a retirement marks one copy while the other stays
    // live, and a re-report of a RETIRED question would resurrect it.
    for (const q of fix.openQuestions || []) {
      if (q && q.id && openQuestions.some((x) => x && x.id === q.id)) {
        log(`fixer pass ${fixerPasses} re-reported open question ${JSON.stringify(q.id)}; keeping the entry from the pass that raised it (a re-report neither forks nor revives a question).`);
        continue;
      }
      // The retirement marks are script-applied and no schema properties, so a
      // volunteered one is stripped rather than trusted: self-marking would
      // settle a question with no disposition behind it, bypassing both the
      // guard above and the reviewer that adjudicates every retirement — the
      // decision would leave the maintainer's list with nobody having claimed
      // to settle it. A fixer retires only through `retiresQuestionIds`.
      if (q && typeof q === "object" && ("retired" in q || "retirementPending" in q)) {
        const stripped = { ...q };
        delete stripped.retired;
        delete stripped.retirementPending;
        log(`fixer pass ${fixerPasses} volunteered a retirement mark on open question ${JSON.stringify(q.id || "")}; stripping it (a question is settled only by a later disposition's \`retiresQuestionIds\`, which the round's reviewer then adjudicates).`);
        openQuestions.push(stripped);
        continue;
      }
      openQuestions.push(q);
    }
    for (const dev of fix.deviations || []) deviations.push(dev);
    // Accumulate the pass packet field-by-field. A later pass updates what it
    // actually reports, and an explicitly EMPTY field never clobbers a
    // populated one from an earlier pass: schema-driven agents commonly emit
    // every declared property, and the confirming pass is even asked for an
    // empty `dispositions` array — an empty `workReport` (or blank `finalSha`)
    // alongside it would otherwise wipe the per-item report consumers replay
    // (wf-address-review publishes thread replies/resolves from it).
    packet = packet || {};
    if (Array.isArray(fix.workReport) && fix.workReport.length) packet.workReport = fix.workReport;
    if (typeof fix.summary === "string" && fix.summary) packet.summary = fix.summary;
    if (typeof fix.proactive === "string" && fix.proactive) packet.proactive = fix.proactive;
    if (typeof fix.finalSha === "string" && fix.finalSha) packet.finalSha = fix.finalSha;

    // Disposition coverage: every handed finding must be validly disposed by
    // id. Anything uncovered gates the round below and is carried forward.
    // Only LIVE questions count as known: a question an earlier pass retired —
    // or claimed to retire, pending the round that decides it — is spoken for,
    // so it can neither validate an `escalated` disposition naming it nor be
    // retired a second time. This set includes the questions this pass
    // just raised — an `escalated` disposition names one of those — which is
    // why the narrower `retirableQuestionIds` snapshot, not this one, decides
    // what this pass may retire. This pass's own retirements are applied AFTER
    // the check, so a question is still live for the disposition retiring it.
    const knownQuestionIds = new Set(openQuestions.filter((q) => q && !q.retired && !q.retirementPending).map((q) => q.id).filter(Boolean));
    const undisposed = cycleUndisposedFindings(findings, fix, knownQuestionIds, retirableQuestionIds);

    // Record the retirements this pass claims. Marking rather than removing:
    // the result then still shows the question was raised and what settled it,
    // so a consumer skips it knowingly and a WRONG retirement is visible in the
    // same lean result as the disposition that made it, not only in the
    // artifact directory. A retirement naming an unknown id already came back
    // above as a carried `disposition-error`, so nothing is dropped here
    // silently.
    //
    // The mark lands PENDING, and only a PASSING round below turns it into the
    // `retired` one consumers skip. Marking on the fixer's word alone would
    // undo the reason for marking at all: on the paths where the reviewer never
    // accepted the claim — it rejected the retirement, or the cycle errored or
    // hit the round cap before any round passed — the terminal result would
    // read as settled, hiding exactly the decision a stopped run most owes the
    // human. Pending claims accumulate rather than expire when a round fails: a
    // round can fail on something else entirely, and a fixer cannot restate a
    // claim whose finding is no longer carried (there may be no `fixed`/
    // `declined` disposition left to hang it on), so each unaccepted claim is
    // re-presented to the next round until a round passes over it.
    for (const d of fix.dispositions || []) {
      if (!d || (d.disposition !== "fixed" && d.disposition !== "declined")) continue;
      for (const qid of cycleRetiredQuestionIds(d)) {
        // Same snapshot the guard judged, so a rejected retirement (unknown id,
        // or a question this very pass raised) is never applied behind it.
        if (!retirableQuestionIds.has(qid)) continue;
        const q = openQuestions.find((x) => x && x.id === qid && !x.retired && !x.retirementPending);
        if (!q) continue;
        q.retirementPending = { pass: fixerPasses, disposition: d.disposition, findingId: d.findingId || "", detail: d.detail || "" };
        pendingRetirements.push(q);
      }
    }

    // Terminal condition of the disposition rule: the reviewer has passed and
    // the fixer's last pass disposed nothing new (and changed nothing that
    // would need a fresh review). Nothing left for a reviewer to look at.
    if (confirming && !fix.changed && (fix.dispositions || []).length === 0) {
      return result("pass", "reviewer passed; final confirmation pass disposed nothing new");
    }

    // Anything else needs a (re-)review — bounded by the cap. This check is
    // reachable at the cap only through a confirmation pass that produced new
    // work: changed content, or dispositions of its own (a FAILED round at the
    // cap returns below, before another fixer could run and leave
    // never-reviewed changes behind).
    //
    // Those dispositions can themselves breach a contract, and the retirement
    // guard binds on a pass handed nothing — so a confirmation pass that names
    // an unknown (or already-claimed) question id lands its `retire:<id>` entry
    // in `undisposed` on exactly this path. Carrying it out under the SAME
    // `outstanding.carried` key the failed-round cap exit below uses is what
    // makes the breach structurally reportable rather than a generic note; a
    // consumer reading one exit's shape reads this one's.
    if (rounds >= cap) {
      return result("review-cap", `hit the ${cap}-round cap without convergence`, {
        outstanding: {
          note: "final confirmation pass produced work (content changes, dispositions, or both) that could not be re-reviewed within the cap",
          ...(undisposed.length ? { carried: undisposed } : {}),
        },
      });
    }
    rounds += 1;

    const state = {
      round: rounds,
      packet: { ...packet, dispositions: fix.dispositions || [] },
      artifactDir,
      handedFindings: findings,
      proposedRetirements: pendingRetirements,
      peerPreflighted: peerState.preflighted,
    };
    // The peer launches BESIDE the fresh reviewer — the canonical concurrent
    // launch (the examination-only peer is the protocol's sole same-checkout
    // concurrency exception: the reviewer alone owns builds/execution, and two
    // readers are safe). runCyclePeerStage can neither throw nor block the
    // round, so on any peer problem this degrades to the reviewer's verdict
    // exactly as a sequential launch would.
    const [review, rawPeer] = await parallel([
      () =>
        agent(cycleReviewPrompt(cycle, state), {
          label: `${lp}review#${rounds}`,
          schema: CYCLE_REVIEW_SCHEMA,
        }),
      async () =>
        // `disabled` wins over sticky unavailability: under a SHARED peerState
        // a sibling's `unavailable` must not relabel a peer-off cycle's rounds.
        cycle.peer !== "off" && peerState.unavailable
          ? { outcome: "unavailable", findings: [], notes: "", detail: peerState.unavailableDetail || "peer marked unavailable earlier this run" }
          : runCyclePeerStage(cycle, state),
    ]);
    // Re-normalizing is idempotent for the stage's own results and guards the
    // one path it cannot: a runtime that hands back a null parallel slot. The
    // cycle's `disabled` outcome is not helper vocabulary, so carry it as-is.
    const peer = rawPeer && rawPeer.outcome === "disabled" ? rawPeer : normalizeCyclePeerResult(rawPeer);
    peerRounds.push({ round: rounds, outcome: peer.outcome, detail: peer.detail });
    if (peer.outcome === "unavailable") {
      peerState.unavailable = true;
      if (peer.detail && !peerState.unavailableDetail) peerState.unavailableDetail = peer.detail;
    } else if (peer.outcome !== "disabled" && !peer.synthesized) {
      // The preflight is demonstrably done only when a peer SUBAGENT actually
      // reported back. A script-synthesized forfeit (dead/schema-failed
      // subagent, thrown stage, null parallel slot) proves nothing ran, so the
      // next round must still probe rather than skip on a false "an earlier
      // round verified the binary and login".
      peerState.preflighted = true;
    }

    if (!review) return result("error", `reviewer returned nothing on round ${rounds}`);
    if (review.emptyDiffFlag) return result("error", `reviewer saw an empty diff on round ${rounds} (likely wrong worktree/branch)`);
    reviewerNotes = review.notes || "";

    // Gate: reviewer must pass, and BOTH blocking and minor grounded peer
    // findings gate. Every non-passed/issues peer outcome is non-blocking.
    let peerGating = peer.outcome === "issues" ? peer.findings : [];
    if (review.pass && peerGating.length) {
      // Grounding spot-check — only when the reviewer passed and peer findings
      // alone would gate. Discard is the one path a finding leaves the cycle
      // without a fixer disposition, and it is noted.
      const ground = await agent(cycleGroundingPrompt(cycle, peerGating), {
        label: `${lp}ground#${rounds}`,
        schema: CYCLE_GROUNDING_SCHEMA,
        effort: "low",
      });
      if (ground && Array.isArray(ground.verdicts)) {
        const ungrounded = ground.verdicts.filter((v) => v && v.grounded === false);
        if (ungrounded.length) {
          for (const u of ungrounded) discardedPeerFindings.push({ round: rounds, finding: u.finding, why: u.why || "" });
          const dropped = new Set(ungrounded.map((v) => v.finding));
          peerGating = peerGating.filter((f) => !dropped.has(f.claim));
        }
      }
    }

    // The round passes only when the reviewer passes, no grounded peer finding
    // gates, AND every finding handed to this round's fixer was validly
    // disposed — an uncovered finding fails the round and is carried forward,
    // so the terminal pass can never leave a finding without a disposition.
    const roundPassed = !!review.pass && peerGating.length === 0 && undisposed.length === 0;
    if (!roundPassed) {
      confirming = false;
      findings = {
        carried: undisposed,
        // `id` is spread LAST so the script-assigned, round-scoped id stays
        // authoritative even when an agent's finding object volunteers its own
        // `id` field (coverage matching depends on these exact string ids; an
        // agent-supplied one — a number, say — would be uncoverable).
        reviewer: (review.issues || []).map((f, i) => ({ ...f, id: `r${rounds}-${i + 1}` })),
        reviewerNotes: review.notes || "",
        peer: peerGating.map((f, i) => ({ ...f, id: `p${rounds}-${i + 1}` })),
        peerNotes: peer.notes || "",
      };
      // A failed round at the cap stops HERE — no further fixer pass may run,
      // or its changes would land committed but never reviewed.
      if (rounds >= cap) {
        return result("review-cap", `hit the ${cap}-round cap without convergence`, { outstanding: findings });
      }
      continue;
    }

    // The round passed with every pending retirement in view, so the fresh
    // reviewer accepted each claim the same way it accepted this round's
    // declines: they become `retired` — the state a consumer serving questions
    // to a human skips — and stop being re-presented. Promoted HERE, before
    // either terminal pass path, so a `pass` verdict never ships a claim in the
    // pending state and a stopped run never ships one in the settled state.
    for (const q of pendingRetirements) {
      q.retired = q.retirementPending;
      delete q.retirementPending;
    }
    pendingRetirements.length = 0;

    // Round passed. light mode ends here, recording undisposed remarks as such.
    if (cycle.mode === "light") {
      return result("pass", "reviewer passed (light mode: final confirmation pass skipped)", {
        undisposed: [review.notes, peer.notes].filter(Boolean),
      });
    }

    // Full mode: one final fixer confirmation pass over the passing reports, so
    // pass-notes get considered by an agent with full context, never dropped by
    // the orchestrator. If it disposes nothing new, the loop terminates above;
    // anything it fixes or disputes goes through another reviewer round.
    confirming = true;
    findings = {
      carried: [],
      reviewer: [],
      reviewerNotes: review.notes || "(no notes — confirm nothing in the passing reports needs acting on)",
      peer: [],
      peerNotes: peer.notes || "",
    };
  }
}

// ============================================================================
// END EMBEDDABLE SECTION: review-cycle-core
// ============================================================================

// ONE shared peer-availability state for the whole batch (the embedded
// cycle's `cycle.peerState` contract — see runReviewCycle above): every
// per-task cycle gets this same object, so the codex install/login preflight
// runs once for the batch and an unavailable peer sticks batch-wide, per the
// canonical batch rule, instead of each task's cycle re-probing. This is the
// fan-out owner's cross-cycle state the embedding mode exists for.
// Availability state ONLY — task 015's peer-launch throttle policy does not
// live here.
const batchPeerState = { preflighted: false, unavailable: false, unavailableDetail: "" };

// Build one task's cycle config for the embedded runReviewCycle. The worktree
// lifecycle stays with the wt-* helpers via worktreeContract (per-role
// contracts below); the task-specific assignment — task content, upstream
// context, the push-for-durability policy — rides the cycle's scope.
function taskCycleConfig(task, remote, peerMode) {
  const upstream = task.upstream ? `\n\n## Upstream context\n\n${task.upstream}` : "";
  const pushLine = remote
    ? `After every commit, push for durability: \`git push -u origin ${shq(task.branch)}\` first, \`git push\` thereafter. The reviewer reads your worktree directly, so a transient push failure is not fatal — keep committing and note it — but pushed commits are the backup if the worktree is lost.`
    : `Remote push is unavailable this run; commit locally (the shared \`.git\` persists). Do not fail on missing push.`;
  return {
    slug: task.slug,
    worktree: "",
    branch: task.branch,
    base: task.base,
    artifactType: "code",
    peer: peerMode,
    mode: "full",
    peerState: batchPeerState,
    labelPrefix: `${task.slug}:`,
    contracts: {
      fixer: worktreeContract(task, { mayCreate: true }),
      reviewer: worktreeContract(task),
      peer: worktreeContract(task),
    },
    scope: {
      title: task.slug,
      instructions: `Implement the task below to its description and acceptance criteria. The base branch already contains any dependency's work — build on it.${upstream}\n\n${pushLine}\nDo not revert unrelated edits.`,
      items: [{ taskFile: task.path, taskContent: task.content }],
    },
  };
}

function prPrompt(task, notes, remote) {
  if (!remote) {
    return `Remote push/PR is unavailable this run. Verify branch \`${task.branch}\` and its commits are intact: \`WT="$(wt-enter ${shq(task.slug)} ${shq(task.branch)})" && git -C "$WT" log --oneline ${shq(task.base)}..${shq(task.branch)}\` shows the work. Return \`opened: false\`, \`pushed: false\`, \`reason: "no remote auth this run"\`. Do not fail.

${DESTROY_BOUNDARY}`;
  }
  const caveats = notes ? `\n\nReviewer caveats to surface in the PR body:\n${notes}` : "";
  return `Open a pull request for branch \`${task.branch}\` against base \`${task.base}\`. Work from this task's worktree: \`WT="$(wt-enter ${shq(task.slug)} ${shq(task.branch)})" && cd "$WT"\` (rerun-safe resolve of the existing worktree; if it errors, STOP and report).

${DESTROY_BOUNDARY}

1. Ensure the branch is pushed: \`git push -u origin ${shq(task.branch)}\` (or \`git push\`).
2. \`gh pr create --base ${shq(task.base)} --head ${shq(task.branch)} --title "<concise title>" --body "<summary>"\`.
   - Reference the task file (${task.path}); don't restate the whole task unless it adds review value.
   - Note tradeoffs / intentional divergences / uncertainties.${caveats}

Return \`opened: true\` with the \`url\` ONLY if \`gh pr create\` actually produced a PR URL. If the push succeeded but the PR could not be created (auth, API, or base-branch error), return \`opened: false\`, \`pushed: true\`, and \`reason\`. Do not claim a PR that was not created.`;
}

function cleanupNote(task) {
  // Best-effort worktree removal is requested after delivery; commits and the
  // branch persist in shared `.git` and on the remote, so removal is safe.
  return `Remove this task's worktree to reclaim space — the branch and commits persist. From the repo root (not inside the worktree) run \`wt-remove ${shq(task.slug)}\`. It refuses to delete uncommitted work; if it refuses, report why instead of forcing (\`--force\` only clears git's refusal over ignored build artifacts — the clean checks still apply). It never deletes the branch \`${task.branch}\`. Report done.

${DESTROY_BOUNDARY}

\`wt-remove\` is the ONLY removal this assignment spells out, and the repo root is the one place you run it from: you are standing in the SHARED main checkout, outside every worktree, so nothing here is yours to delete by hand. A refusal is the helper working — report it.`;
}

function collisionScanPrompt(branches) {
  const list = branches
    .map(
      (b) =>
        `- slug ${JSON.stringify(b.slug)}: branch ${JSON.stringify(b.branch)} diverged from base ${JSON.stringify(b.base)}\n      list its added files with: git diff --diff-filter=A --name-only ${shq(b.base)}...${shq(b.branch)}`
    )
    .join("\n");
  return `You are a read-only PRE-PR COLLISION GUARD for a batch of sibling task branches implemented in parallel, each reviewed and ready for its own PR. Edit, stage, commit, or push NOTHING. Work from the repo ROOT; do not enter or create any worktree — these branches live in the shared \`.git\` and you compare them by ref.

${DESTROY_BOUNDARY}

Why this exists: independent siblings never conflict while they are implemented (each in its own worktree), so two of them can each ADD the same new file path — or a file with the same basename, or a file that exports the same top-level class/symbol — with no warning. The clash only surfaces later, when the branches linearize or merge (an add/add conflict, or a duplicate definition). Find those overlaps now so they can be reconciled before merge.

Branches:
${list}

Method:
1. For each branch, list ONLY the files it ADDED relative to its OWN base by running the exact, ready-to-run command listed for that branch under "Branches" above — its base and branch are already shell-quoted there because a generated/task-derived ref can contain shell metacharacters (\`$\`, backticks, \`;\`); never hand-substitute a raw \`<branch>\` into the command. It has the form:
       git diff --diff-filter=A --name-only <base>...<branch>
   The three-dot form compares against the merge-base, so a dependent branch built on a sibling will NOT re-list that sibling's files and legitimate stacking is never flagged.
2. Report a collision when, across two or more DIFFERENT branches:
   - the same repo-relative path was added (kind \`path\`), OR
   - the same basename was added at different paths (kind \`filename\`), OR
   - two added source files (sharing a basename, or clearly the same kind of module) declare the same exported top-level name — class/function/const/interface/type/enum (kind \`symbol\`). Open ONLY those candidate files to confirm; keep it cheap.
3. For each collision give the colliding value, the 2+ branches that added it, and a one-line reconciliation hint. In \`branches\`, use the exact branch strings from the Branches list without shell quote characters.

Flag only genuine overlaps between independently-based branches; never flag a file a branch merely inherited from its base. If nothing overlaps, return an empty \`collisions\` array.`;
}

function normalizeBranchName(s) {
  const value = String(s || "").trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function collisionBranchNames(collision) {
  return Array.isArray(collision.branches)
    ? collision.branches.map(normalizeBranchName).filter(Boolean)
    : [];
}

// This deputy is ordered to run the project build, so it needs a destination
// for that build's output for the same reason the cycle's roles do: a role left
// to pick its own path picks the session scratchpad, and that scratchpad is
// shared per session rather than per batch — so "one deputy per wave" does not
// make it safe from the reviewer, peer, or later run beside it. The sentence is
// written out here rather than shared with the cycle's CYCLE_REDIRECTED_OUTPUT,
// which sits INSIDE the byte-identical `review-cycle-core` section and cannot
// be reached from out here, and which names a different destination anyway: the
// cycle's roles write into a round directory they keep, while this deputy needs
// its log out of the worktree it is about to `git add` and commit.
function resolveCollisionsPrompt(tasks, waveCollisions, remote) {
  const taskList = tasks
    .map(
      (t) =>
        `- slug ${JSON.stringify(t.slug)}: branch ${JSON.stringify(t.branch)} (base ${JSON.stringify(t.base)})\n      enter its worktree with: WT="$(wt-enter ${shq(t.slug)} ${shq(t.branch)})" && cd "$WT"`
    )
    .join("\n");
  const collisionList = JSON.stringify(waveCollisions, null, 2);
  const pushLine = remote
    ? "Push each rename for durability and so the PR carries it: `git push` (the implement loop already set the upstream)."
    : "Remote push is unavailable this run; commit locally — the shared `.git` persists.";
  return `You are the orchestrator's deputy DECONFLICTING add/add naming collisions between sibling task branches built in parallel. Each branch already passed review on its own, but the pre-PR scan found that two or more INDEPENDENTLY added the same new file path, basename, or exported top-level symbol — which will clash (an add/add conflict, or a duplicate definition) when the branches merge. You decide how to deconflict, and you carry it out.

Each held branch's commits persist in the shared \`.git\`; its worktree may have been reclaimed after review to bound disk use. For each branch you CHANGE, \`cd\` into its worktree using the exact, ready-to-run \`wt-enter\` command listed for that branch under "Held branches" below — its slug and branch are already shell-quoted there because a generated/task-derived branch name can contain shell metacharacters (\`$\`, backticks, \`;\`). NEVER hand-substitute a raw \`<branch>\` into \`wt-enter\` — copy the listed command verbatim. No base argument is needed: the branch already exists and \`wt-enter\` is rerun-safe, re-attaching the worktree if it was reclaimed.

If \`wt-enter\` errors, STOP and report it. Verify \`git rev-parse --show-toplevel\` is that worktree and \`git branch --show-current\` is that branch before editing. Touch ONLY the worktree of the branch you are changing; never edit a sibling's worktree. Read \`AGENTS.md\` / \`CLAUDE.md\` for the project's regen and build commands.

${DESTROY_BOUNDARY}

Held branches:
${taskList}

Collisions to resolve (from the read-only scan; \`name\` is the colliding value):
${collisionList}

For each collision:
1. Pick the side(s) to change. There is no inherent "first", so choose the LEAST disruptive rename(s): branches with fewer references, not a path a framework mandates, not a name a task file pins. Read the colliding files on each branch first. Rename enough sides that AT MOST ONE branch keeps the original colliding path/basename/symbol. With a two-branch collision, renaming one side is normally enough and the other then delivers unchanged; with three or more branches, you may need to rename multiple sides.
2. If the name is genuinely IMPERATIVE — it MUST stay identical (a framework-required filename, an external/published contract, or a name a task file explicitly mandates) — do NOT invent a divergent name. Mark the collision \`blocked\` with the reason and leave those branches untouched; a human decides. Blocking a real conflict beats shipping a wrong rename.
3. Otherwise, on EACH branch you chose to change, rename the file and/or exported symbol plus every in-branch reference to it, to a clear name that is distinct from the original AND from any other renamed side — so two renamed branches cannot themselves re-collide on the new name. Regenerate anything derived from it (e.g. contracts). Run the project build / type-check — it MUST pass; if you redirect its output to a file, create a UNIQUE directory for that first, OUTSIDE every worktree (\`mktemp -d "\${TMPDIR:-/tmp}/collision-resolve.XXXXXX"\`), and write there — never a fixed shared scratchpad name (one session's agents share that directory, and two that both wrote \`<scratchpad>/verify.log\` once crossed results between worktrees), and never inside the worktree, which you are about to commit. Commit with a clear message. ${pushLine}
4. Record the outcome with \`collision\` set to the exact \`name\` from the list above: \`renamed\` (with \`changedBranches\`, \`from\`, \`to\`, what you \`regenerated\`, and why that side) or \`blocked\` (with the reason; empty \`changedBranches\`).

Do NOT open any PR and do NOT remove any worktree — the workflow re-reviews each changed branch and handles delivery. Return one resolution entry per collision.`;
}

// Common carrier for every post-cycle terminal result. Whatever terminal
// status a task reaches AFTER its review cycle completed — delivered, held by
// the collision guard, capped, or errored — the cycle's for-the-human record
// (open questions, deviations, peer rounds, and the artifact pointer) must
// ride along so it survives to the Summary. `artifactDirAnomalies` is set
// only when a later pass tried to move the artifact directory — a warning
// that the round history may not ALL sit under `artifactDir` — so it rides
// beside the pointer wherever it goes. Works on both the raw cycle result and
// any task result derived from it: the field names are identical.
function cycleCarried(result) {
  return {
    rounds: result.rounds,
    openQuestions: result.openQuestions,
    deviations: result.deviations,
    peerRounds: result.peerRounds,
    artifactDir: result.artifactDir,
    ...(result.artifactDirAnomalies ? { artifactDirAnomalies: result.artifactDirAnomalies } : {}),
  };
}

async function implementTask(task, remote, peerMode) {
  // The loop is the embedded runReviewCycle above. Sequential fixer -> reviewer
  // awaits inside the cycle plus a SHARED on-disk worktree mean the implementer
  // has fully finished and committed in WT before the reviewer cd's into the
  // same WT, so the reviewer always sees the commits. Cross-task concurrency
  // comes from parallel() over distinct WTs, not from per-agent runtime
  // isolation; the examination-only peer beside each reviewer round is the
  // cycle's sole same-worktree concurrency exception.
  const result = await runReviewCycle(taskCycleConfig(task, remote, peerMode));
  const carried = cycleCarried(result);
  if (result.verdict === "error") {
    return { slug: task.slug, branch: task.branch, status: "error", detail: result.detail, ...carried };
  }
  if (result.verdict !== "pass") {
    // Leave the worktree for inspection on a cap-out; commits are durable.
    return { slug: task.slug, branch: task.branch, status: "review-cap", outstanding: result.outstanding || null, ...carried };
  }
  // Reviewed and ready, but not delivered yet: the wave-level collision guard
  // runs before any PR is opened or worktree is cleaned up.
  return { slug: task.slug, branch: task.branch, status: "ready", notes: result.reviewerNotes || "", ...carried };
}

async function deliverTask(task, ready, remote) {
  const pr = await agent(prPrompt(task, ready.notes, remote), {
    label: `pr:${task.slug}`,
    schema: PR_SCHEMA,
  });

  // Best-effort cleanup once the work is durable (pushed/committed).
  await agent(cleanupNote(task), { label: `cleanup:${task.slug}` });

  // Open questions, deviations, and the artifact pointer (with any anomaly
  // record beside it) bubble up with the delivery result — they exist for the
  // human and must survive to Summary.
  const carried = cycleCarried(ready);
  if (pr && pr.opened && pr.url) {
    return { slug: task.slug, branch: task.branch, status: "done", prUrl: pr.url, ...carried };
  }
  // Reviewed and (usually) pushed, but no PR — do NOT count this as a landed PR.
  return {
    slug: task.slug,
    branch: task.branch,
    status: remote ? "pushed-no-pr" : "local-only",
    pushed: pr ? pr.pushed : false,
    reason: pr ? pr.reason : "PR agent returned nothing",
    ...carried,
  };
}

// --- Flag parsing: `peer-opinions=off` must arrive through args (a workflow
// cannot read prose elsewhere) and suppresses the embedded cycle's peer stage
// for every task in the batch. Flatten any args shape first — structured
// delivery would otherwise stringify to "[object Object]".
function flattenBatchArgs(a) {
  if (a == null) return "";
  if (typeof a === "string") return a;
  if (Array.isArray(a)) return a.map(flattenBatchArgs).join(" ");
  if (typeof a === "object") return Object.values(a).map(flattenBatchArgs).join(" ");
  return String(a);
}
const peerMode = /\bpeer[\s-]*opinions?\s*=\s*off\b/.test(flattenBatchArgs(args).toLowerCase()) ? "off" : "on";

phase("Bootstrap");
const boot = await agent(bootstrapPrompt(), { label: "bootstrap", schema: BOOTSTRAP_SCHEMA });
if (!boot || !boot.ok) {
  return { error: "Worktree bootstrap failed; batch not started.", blocker: boot ? boot.blocker : "(agent returned nothing)" };
}
// `remote` is optional in BOOTSTRAP_SCHEMA (only `ok` is required), so a
// schema-valid response can omit it. Treat remote as available ONLY when
// explicitly true: pushing and opening PRs are outward side effects, so a
// missing/undefined probe result must fall back to local-branch-only rather
// than silently attempt a publish.
const remote = boot.remote === true;

// Pre-batch baseline of the SHARED main checkout (see MAIN_CHECKOUT_SCHEMA).
// Observation only — a dirty start is the user's prerogative and never blocks
// the batch; a null/unmeasured result just means the Summary report cannot
// attribute post-batch dirt to this run.
const mainCheckoutBaseline = await agent(mainCheckoutStatusPrompt("pre-batch baseline"), {
  label: "main-checkout-baseline",
  schema: MAIN_CHECKOUT_SCHEMA,
  effort: "low",
});

// The closing half of the cleanliness check, factored out so that EVERY exit
// past the baseline runs it — a batch that aborts or delivers nothing is
// exactly the case the check exists for, and gating it on the Summary path
// alone would skip it whenever the run went worst. This report step is
// non-destructive: it only reports dirt — distinguishing pre-existing from
// newly-appeared paths and, crucially, from baseline paths that DISAPPEARED (a
// possible destructive loss) — and never modifies, resets, or fails on it. It
// does not vouch for the batch's other stages. Logs the flagged AND the
// not-measured outcome: a skipped comparison is easy to miss if only `flagged`
// reports surface, and its note says exactly why the check has nothing
// authoritative this run.
async function finalMainCheckoutReport() {
  // The closing reading is itself an agent stage, and an agent stage throws
  // (runCyclePeerStage exists because of it). This function is the last step of
  // every exit including the aborted one, so a throw here would take down the
  // very report an abort is owed — and, on the normal path, a completed batch's
  // whole result with it. A reading that fails is an UNMEASURED report, whose
  // note already says the comparison had nothing authoritative; never a second
  // crash.
  let final = null;
  try {
    final = await agent(mainCheckoutStatusPrompt("post-batch"), {
      label: "main-checkout-final",
      schema: MAIN_CHECKOUT_SCHEMA,
      effort: "low",
    });
  } catch (e) {
    log(`Post-batch main-checkout reading threw (${e && e.message ? e.message : String(e)}); reporting the comparison as unmeasured.`);
  }
  const summary = mainCheckoutSummary(mainCheckoutBaseline, final);
  if (summary.flagged || !summary.measured) {
    const details = [];
    if (summary.newPaths.length) details.push(`new: ${summary.newPaths.join(", ")}`);
    if (summary.disappeared.length) details.push(`disappeared: ${summary.disappeared.join(", ")}`);
    if (summary.unattributed.length) details.push(`unattributed: ${summary.unattributed.join(", ")}`);
    log(`${summary.note}${details.length ? ` [${details.join("; ")}]` : ""}`);
  }
  return summary;
}

// Every stage from here on runs with the pre-batch baseline already taken, so
// each one owes the closing comparison — including the ones that never reach a
// `return`. An agent stage throws (runCyclePeerStage catches exactly that), and
// a throw would otherwise unwind past the baseline's other half and leave an
// aborted batch with no cleanliness report at all, which is the case the check
// exists for. So the batch body runs inside a try whose catch reports rather
// than rethrows. What the report needs from the body is declared out here: a
// crash mid-batch still has terminal statuses worth returning.
let plan = null;
// Track each task's terminal status so dependent waves can be gated.
const statusBySlug = new Map();
const results = [];
const throttled = [];
const collisions = [];

try {
  phase("Resolve batch");
  plan = await agent(resolvePrompt(args), { label: "resolve", schema: PLAN_SCHEMA });
  if (!plan || !Array.isArray(plan.waves) || plan.waves.length === 0) {
    // A batch that resolves no task is still a batch that terminated with the
    // baseline already taken, so it owes the same report as a delivering one.
    phase("Summary");
    return { error: "Could not resolve any task files from the argument.", args, mainCheckout: await finalMainCheckoutReport() };
  }

  // Map every in-batch branch to the slug that produces it. A dependent task's
  // `base` IS its prerequisite's `branch` (stacked PRs), so this lets the gate
  // derive the prerequisite structurally instead of trusting only the plan
  // agent's `dependsOn` list — a forgotten entry can no longer slip a dependent
  // past a failed prerequisite and have it build on known-bad work. Independent
  // tasks base off `defaultBase` / the current branch, which no in-batch task
  // produces, so they pick up no spurious dependency.
  const slugByBranch = new Map();
  for (const wave of plan.waves) {
    if (!Array.isArray(wave)) continue;
    for (const task of wave) {
      if (task && typeof task.branch === "string" && typeof task.slug === "string") {
        slugByBranch.set(task.branch, task.slug);
      }
    }
  }

  // Wave width: run every dependency-ready task unless measured storage headroom
  // requires sub-batching. The workflow runtime/provider owns its own active-agent
  // ceiling and rate limiting; do not impose an arbitrary smaller policy cap here.
  // An unmeasured reading (0) yields `Infinity` — no storage cap — which behaves
  // correctly at both use sites (`slice(i, i + Infinity)` takes the rest of the
  // wave; `runnable.length > widthCap` never fires). Bootstrap's reading serves
  // only the first wave: later waves run against headroom already consumed by
  // earlier waves' pnpm-store growth, ccache, and build artifacts that worktree
  // reclaim does not return, so each subsequent wave boundary re-probes `df`
  // through a cheap agent and recomputes the cap from the fresh reading.
  let availBytes = typeof boot.availBytes === "number" ? boot.availBytes : 0;
  const widthCapFor = (bytes) => (bytes > 0 ? Math.max(1, Math.floor(bytes / PER_WORKTREE_BYTES)) : Infinity);

  for (let w = 0; w < plan.waves.length; w++) {
    const wave = plan.waves[w];
    if (!Array.isArray(wave) || wave.length === 0) continue;

    // Dependency gating: a task whose in-batch dependency did not finish
    // successfully must NOT run — it would branch from a missing/partial/rejected
    // prerequisite. A dependency is "succeeded" if it landed a PR (`done`) OR, on a
    // no-remote run, was implemented and reviewed locally (`local-only`): its base
    // branch and commits persist in the shared `.git`, so dependents can still
    // build on it. `error`/`review-cap`/`skipped-dep`/`pushed-no-pr`,
    // `collision-hold`, `collision-blocked`, and `collision-scan-error` do not unlock.
    // Effective deps = the declared `dependsOn` UNION the prerequisite derived from
    // the `base`→`branch` relationship, so the gate holds even if the plan agent
    // omits a `dependsOn` entry it should have listed.
    const succeeded = (s) => s === "done" || s === "local-only";
    const runnable = [];
    for (const task of wave) {
      const deps = new Set(Array.isArray(task.dependsOn) ? task.dependsOn : []);
      const baseDep = slugByBranch.get(task.base);
      if (baseDep && baseDep !== task.slug) deps.add(baseDep);
      const failedDep = [...deps].find((d) => !succeeded(statusBySlug.get(d)));
      if (failedDep) {
        const r = { slug: task.slug, branch: task.branch, status: "skipped-dep", blockedBy: failedDep, depStatus: statusBySlug.get(failedDep) || "missing" };
        statusBySlug.set(task.slug, "skipped-dep");
        results.push(r);
      } else {
        runnable.push(task);
      }
    }
    if (runnable.length === 0) continue;

    phase(`Wave ${w + 1} (${runnable.length} task${runnable.length === 1 ? "" : "s"})`);
    // Re-probe free space at each wave boundary after the first (see the wave-width
    // comment above). A failed or unmeasurable probe keeps the previous reading —
    // stale-but-conservative beats silently dropping the throttle mid-batch. A
    // 1-task wave skips the probe: its cap can never throttle (widthCap >= 1).
    if (w > 0 && runnable.length > 1) {
      const probe = await agent(storageProbePrompt(boot.wtBase || ".worktrees"), { label: `storage-probe:w${w + 1}`, schema: STORAGE_PROBE_SCHEMA, effort: "low" });
      if (probe && typeof probe.availBytes === "number" && probe.availBytes > 0) availBytes = probe.availBytes;
    }
    const widthCap = widthCapFor(availBytes);
    if (runnable.length > widthCap) {
      log(`Throttling wave ${w + 1} to ${widthCap} concurrent task(s) to fit measured storage headroom (~1 GiB per worktree).`);
      throttled.push({ wave: w + 1, tasks: runnable.length, width: widthCap });
    }
    // Sub-batch the wave at the width cap: a wave that exhausts the .worktrees
    // mount mid-flight delivers nothing. But the pre-PR collision scan must compare
    // EVERY reviewed branch before any delivery, so — unlike the old per-task flow
    // that delivered and `wt-remove`d each task as it finished — delivery is now
    // deferred to after the whole wave is scanned. Left unmanaged, that would let
    // reviewed worktrees from earlier slices pile up while later slices run,
    // re-introducing the ENOSPC the sub-batching exists to prevent. So reclaim each
    // finished slice's reviewed worktrees right here: the branch refs persist in
    // the shared `.git`, the scan compares by ref (it never enters a worktree), and
    // the resolver, re-review, and delivery each re-attach on demand via `wt-enter`
    // — keeping the live worktree count bounded by the cap. Only when the wave is
    // actually sub-batched; a single-slice wave already fits the cap, so reclaiming
    // it just to re-attach for delivery would be pure churn.
    const ready = [];
    const subBatched = runnable.length > widthCap;
    for (let i = 0; i < runnable.length; i += widthCap) {
      const slice = runnable.slice(i, i + widthCap);
      const sliceResults = await parallel(slice.map((task) => () => implementTask(task, remote, peerMode)));
      const sliceReady = [];
      sliceResults.forEach((r, j) => {
        const res = r || { slug: slice[j].slug, branch: slice[j].branch, status: "error", detail: "task crashed" };
        if (res.status === "ready") {
          const entry = { task: slice[j], result: res };
          ready.push(entry);
          sliceReady.push(entry);
        } else {
          statusBySlug.set(res.slug, res.status);
          results.push(res);
        }
      });
      if (subBatched && sliceReady.length) {
        await parallel(sliceReady.map(({ task }) => () => agent(cleanupNote(task), { label: `reclaim:${task.slug}` })));
      }
    }

    // Pre-PR collision guard. Independent sibling branches in this wave each live
    // in their own worktree, so two can ADD the same new file or exported symbol
    // with no in-worktree conflict. Scan reviewed branches before delivery so a
    // known clash does not become a fresh PR that immediately needs a rename.
    let heldBranches = new Set();
    let scanError = "";
    if (ready.length >= 2) {
      phase(`Collision scan (wave ${w + 1})`);
      const scan = await agent(
        collisionScanPrompt(ready.map(({ task }) => ({ slug: task.slug, branch: task.branch, base: task.base || plan.defaultBase }))),
        { label: `collision-scan:w${w + 1}`, schema: COLLISION_SCHEMA }
      );
      if (!scan || !Array.isArray(scan.collisions)) {
        scanError = `collision scan failed for wave ${w + 1}; holding reviewed branches before PR delivery`;
        log(scanError);
      } else if (scan.collisions.length) {
        collisions.push(...scan.collisions.map((c) => ({ ...c, wave: w + 1 })));
        heldBranches = new Set(scan.collisions.flatMap(collisionBranchNames));
        log(`${scan.collisions.length} cross-branch naming collision(s) in wave ${w + 1}; holding ${heldBranches.size} branch(es) before PR delivery.`);
      }
    }

    // Partition the wave's reviewed branches: clean ones are deliverable; ones the
    // scan flagged go to resolution; a scan failure holds everything it covered.
    const deliverable = [];
    const heldTasks = [];
    ready.forEach(({ task, result }) => {
      if (scanError) {
        const held = {
          slug: task.slug,
          branch: task.branch,
          status: "collision-scan-error",
          detail: scanError,
          ...cycleCarried(result),
        };
        statusBySlug.set(task.slug, held.status);
        results.push(held);
      } else if (heldBranches.has(task.branch) || heldBranches.has(task.slug)) {
        heldTasks.push({ task, result });
      } else {
        deliverable.push({ task, result });
      }
    });

    // Collision resolution. Neither side of an add/add clash is inherently "first",
    // so a single orchestrator-deputy agent — seeing every held branch and its
    // worktree, still in place — decides which side to rename and does it: rename
    // the file/symbol, regenerate derived files, commit, push. A name that MUST
    // stay identical (framework-mandated, externally fixed, or pinned by a task
    // file) is reported `blocked` instead of getting an invented divergent name.
    // Each branch the resolver CHANGED is then re-reviewed fresh (one pass) before
    // it may deliver; the unchanged side of a resolved clash delivers as-is; a
    // blocked, unresolved, or re-review-failed branch stays held for a human.
    if (heldTasks.length) {
      const waveCollisions = collisions.filter((c) => c.wave === w + 1);
      const relatedFor = (task) =>
        waveCollisions.filter((c) => {
          const names = collisionBranchNames(c);
          return names.includes(task.branch) || names.includes(task.slug);
        });

      phase(`Collision resolve (wave ${w + 1})`);
      const resolution = await agent(
        resolveCollisionsPrompt(
          heldTasks.map(({ task }) => ({ slug: task.slug, branch: task.branch, base: task.base || plan.defaultBase })),
          waveCollisions,
          remote
        ),
        { label: `collision-resolve:w${w + 1}`, schema: RESOLUTION_SCHEMA }
      );
      const resolutions = resolution && Array.isArray(resolution.resolutions) ? resolution.resolutions : null;

      // Index the resolver's outcome by branch and by collision name. A collision
      // is actually resolved only when enough involved branches were changed that
      // at most one branch still carries the original colliding value. This matters
      // for 3+ branch clashes: renaming one side leaves the other two still
      // colliding, so those unchanged branches must stay held.
      const changedBranches = new Set();
      const changedBranchesByCollision = new Map();
      const blockedNames = new Set();
      if (resolutions) {
        for (const r of resolutions) {
          const changed = Array.isArray(r.changedBranches) ? r.changedBranches.map(normalizeBranchName).filter(Boolean) : [];
          if (r.action === "renamed") {
            changed.forEach((n) => changedBranches.add(n));
            if (r.collision) {
              const existing = changedBranchesByCollision.get(r.collision) || new Set();
              changed.forEach((n) => existing.add(n));
              changedBranchesByCollision.set(r.collision, existing);
            }
          } else if (r.action === "blocked" && r.collision) {
            blockedNames.add(r.collision);
          }
        }
      }
      const collisionBlocked = (c) => blockedNames.has(c.name);
      // Only branches the resolver reported as changed FOR THIS collision count
      // toward resolving it. An earlier version also credited any branch in the
      // global `changedBranches` set, to guard against a resolver that mistypes the
      // collision echo — but that is unsound when a branch sits in more than one
      // collision: renaming branch B to fix an A/B path clash would also mark B
      // "changed" for an unrelated B/C symbol clash, dropping that clash to a single
      // remaining branch and letting B and C both deliver while still colliding. A
      // mis-echoed rename now conservatively leaves the branch held (for a manual
      // pass / re-scan) instead — matching this guard's bias that holding a real
      // conflict beats shipping a wrong delivery.
      const changedForCollision = (c) => new Set(changedBranchesByCollision.get(c.name) || []);
      const remainingForCollision = (c) => {
        const changed = changedForCollision(c);
        return collisionBranchNames(c).filter((n) => !changed.has(n));
      };
      const collisionResolved = (c) => !collisionBlocked(c) && remainingForCollision(c).length <= 1;
      const collisionStillIncludes = (c, task) => {
        if (collisionBlocked(c)) return true;
        const names = collisionBranchNames(c);
        const participates = names.includes(task.branch) || names.includes(task.slug);
        if (!participates) return false;
        const changed = changedForCollision(c);
        if (changed.has(task.branch) || changed.has(task.slug)) return false;
        return remainingForCollision(c).length >= 2;
      };

      for (const { task, result } of heldTasks) {
        const related = relatedFor(task);
        const isChanged = changedBranches.has(task.branch) || changedBranches.has(task.slug);

        if (!resolutions) {
          const held = { slug: task.slug, branch: task.branch, status: "collision-hold", detail: "collision resolver returned no result; branch held before PR delivery — deconflict manually and re-review", collisions: related, ...cycleCarried(result) };
          statusBySlug.set(task.slug, held.status);
          results.push(held);
        } else if (related.some(collisionBlocked)) {
          // An imperative shared name still clashes even if this branch was also
          // touched — keep it held for a human/design decision.
          const held = { slug: task.slug, branch: task.branch, status: "collision-blocked", detail: "shared name must stay identical (imperative); resolver could not deconflict — needs a human/design decision", collisions: related, ...cycleCarried(result) };
          statusBySlug.set(task.slug, held.status);
          results.push(held);
        } else if (related.some((c) => collisionStillIncludes(c, task))) {
          const held = { slug: task.slug, branch: task.branch, status: "collision-hold", detail: "collision still has two or more unchanged branches after resolver ran; branch held before PR delivery — rename enough sides and re-review", collisions: related, ...cycleCarried(result) };
          statusBySlug.set(task.slug, held.status);
          results.push(held);
        } else if (isChanged) {
          // Fresh re-review of the rename — ONE pass of the cycle's reviewer
          // brief, with no fixer loop and no peer stage. This is deliberately
          // not another full cycle: the branch already cleared the complete
          // cycle (peer included) before the collision guard ran, the check is
          // scoped to the deconfliction rename, and the address-tasks skill
          // specifies exactly this — "re-review each changed task with fresh
          // eyes" — a single-reviewer pass that predates the shared cycle.
          // Hold on failure rather than loop.
          const verdict = await agent(cycleReviewPrompt(taskCycleConfig(task, remote, peerMode), { round: 1, packet: null, artifactDir: "" }), { label: `re-review:${task.slug}`, schema: CYCLE_REVIEW_SCHEMA });
          if (verdict && verdict.pass && !verdict.emptyDiffFlag) {
            deliverable.push({ task, result: { ...result, notes: verdict.notes || result.notes } });
          } else {
            const held = { slug: task.slug, branch: task.branch, status: "collision-hold", detail: "rename did not pass fresh re-review; held before PR delivery", outstanding: verdict ? verdict.issues : null, collisions: related, ...cycleCarried(result) };
            statusBySlug.set(task.slug, held.status);
            results.push(held);
          }
        } else if (related.every(collisionResolved)) {
          // Unchanged side of a clash the resolver fixed on the other branch.
          deliverable.push({ task, result });
        } else {
          // Resolver neither changed nor blocked this branch's clash — do not
          // re-introduce it by delivering; hold for a manual pass.
          const held = { slug: task.slug, branch: task.branch, status: "collision-hold", detail: "collision left unresolved by the resolver; branch held before PR delivery — deconflict manually and re-review", collisions: related, ...cycleCarried(result) };
          statusBySlug.set(task.slug, held.status);
          results.push(held);
        }
      }
    }

    for (let i = 0; i < deliverable.length; i += widthCap) {
      const slice = deliverable.slice(i, i + widthCap);
      const delivered = await parallel(slice.map(({ task, result }) => () => deliverTask(task, result, remote)));
      delivered.forEach((r, j) => {
        // Even on a delivery crash the cycle itself completed, so its record is
        // still in hand — carry it rather than losing it with the crash.
        const res = r || { slug: slice[j].task.slug, branch: slice[j].task.branch, status: "error", detail: "delivery crashed", ...cycleCarried(slice[j].result) };
        statusBySlug.set(res.slug, res.status);
        results.push(res);
      });
    }
  }
} catch (e) {
  // Reported, not rethrown: the batch is over either way, and the closing
  // comparison plus whatever terminal statuses were reached are more use to the
  // reader than an unwound stack. `finalMainCheckoutReport` cannot throw, so
  // this exit always carries a report — an unmeasured one if the reading failed.
  phase("Summary");
  return { error: `Batch aborted: ${e && e.message ? e.message : String(e)}`, batch: args, remote, peer: peerMode, throttled, collisions, results, mainCheckout: await finalMainCheckoutReport() };
}

phase("Summary");
// Post-batch snapshot of the shared main checkout, compared against the
// baseline (see finalMainCheckoutReport, which the empty-batch return and the
// thrown-stage catch above run too).
const mainCheckout = await finalMainCheckoutReport();
const landed = results.filter((r) => r.status === "done").length;
log(`Batch complete: ${landed}/${results.length} tasks landed a PR.`);
// Open questions and locked-decision deviations bubble up structurally — they
// exist for the human; each task's full round history stays behind its
// artifactDir pointer.
const openQuestions = results.flatMap((r) => (Array.isArray(r.openQuestions) ? r.openQuestions : []));
const deviations = results.flatMap((r) => (Array.isArray(r.deviations) ? r.deviations : []));
return { batch: args, defaultBase: plan.defaultBase, remote, peer: peerMode, waves: plan.waves.length, throttled, collisions, mainCheckout, openQuestions, deviations, results };
