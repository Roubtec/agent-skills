/**
 * wf-address-tasks — dynamic-workflow form of the `address-tasks` skill.
 *
 * Resolve a batch of pre-planned task pointers into dependency waves, then run
 * each task through the shared review cycle — implement -> fresh-eyes review
 * plus a best-effort cross-harness codex peer review -> fix, bounded by the
 * cycle's canonical round cap — scan reviewed sibling branches for add/add
 * collisions before delivery and deconflict them (an orchestrator-deputy agent
 * renames one side, regenerates derived files, a second scan of the refs decides
 * which sides may deliver, and every branch a cleared clash covered is
 * re-reviewed first) — or hold a name that must stay identical — then open PRs
 * for the delivered tasks and report. Invoke as
 * `/dev-skills:wf-address-tasks <task-numbers-paths-or-globs> [peer-opinions=off]`.
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
 * where task 015's session-local peer throttle lives beside the wave
 * throttling below and sees every launch. A nested child would hold its own
 * state, and a throttle there would count one peer, never see a sibling's,
 * and cap nothing. The embedded canonical section owns the exact policy; this
 * fan-out owner supplies its one shared state object and reports its steps.
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
  description: "Implement a batch selected by task numbers, paths, or globs: dependency waves, per-task worktree, and the shared review cycle per task — implement -> fresh-eyes review plus a best-effort cross-harness codex peer review -> fix (review is cross-harness; peer outcomes never block; bounded round cap) — with a pre-PR collision guard that deconflicts add/add clashes (rename one side + re-review) or holds an imperative name, one PR per delivered task.",
  whenToUse: "Execute numbers, paths, or globs for pre-planned task files end to end with per-task worktree isolation and cross-harness review (a best-effort codex peer beside each task's fresh reviewer). Not for one-off coding requests or planning new tasks.",
  phases: [
    { title: "Bootstrap", detail: "wt-bootstrap: root-safety checks, orphan prune, remote probe" },
    { title: "Resolve batch", detail: "read task files, derive dependency waves and branches" },
    { title: "Peer review (codex)", detail: "best-effort cross-harness second opinion beside each task's reviewer rounds; its outcome never blocks" },
    { title: "Collision scan", detail: "diff added files across sibling branches for add/add clashes" },
    { title: "Collision resolve", detail: "rename one side of each clash, regen, commit" },
    { title: "Collision re-scan", detail: "re-derive the clashes from the refs; a branch the re-scan clears delivers only after a fresh re-review" },
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
    wtBase: { type: "string", description: "Absolute path to this container's worktree base, `<repo>/.worktrees/$CONTAINER_NAME`. Mandatory whenever `ok` is true: the batch aborts rather than probe an unknown filesystem." },
    remote: { type: "boolean", description: "True if push/PR is available (remote reachable); false means local-branch-only fallback." },
    availBytes: { type: "number", description: "Free bytes on the .worktrees mount, verbatim from wt-bootstrap (drives wave-width throttling)." },
  },
  required: ["ok"],
};

// `wtBase` is the path every later `df` probe is pointed at, and each probe is a
// fresh agent with its own working directory — so an empty or relative base
// measures whatever filesystem that agent happened to start in rather than the
// `.worktrees` mount, and the storage throttle silently guards the wrong thing.
// `wt-bootstrap` reports an absolute path by contract, so an `ok` bootstrap that
// does not is a broken contract: refuse the batch instead of guessing a path
// from the workflow's or an agent's working directory.
//
// This is deliberately the ONLY gate on the property, rather than also adding
// `wtBase` to BOOTSTRAP_SCHEMA's `required`: an `ok: false` bootstrap has no
// worktree base to report, and a schema-required key would still admit `""` and
// `.worktrees` — so the second gate would add a case without adding enforcement.
function validateBootstrapWtBase(boot) {
  const raw = boot && typeof boot.wtBase === "string" ? boot.wtBase.trim() : "";
  if (!raw) {
    return { ok: false, wtBase: "", blocker: "Bootstrap contract violated: reported ok without a `wtBase`. wt-bootstrap must report an absolute worktree base (`<repo>/.worktrees/$CONTAINER_NAME`); the batch will not guess one." };
  }
  if (raw[0] !== "/") {
    return { ok: false, wtBase: "", blocker: `Bootstrap contract violated: reported ok with a relative \`wtBase\` (${raw}). wt-bootstrap must report an absolute worktree base (\`<repo>/.worktrees/$CONTAINER_NAME\`); the batch will not resolve one against an agent's working directory.` };
  }
  return { ok: true, wtBase: raw, blocker: "" };
}

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    defaultBase: { type: "string", description: "PR base branch for independent tasks (the user's override, else the current branch, else main)." },
    resolution: {
      type: "object",
      description: "The resolve-tasks packet plus the hands-off exclusions applied before planning. It is report context even when no task remains executable.",
      properties: {
        paths: {
          type: "array",
          description: "Every deduplicated resolved path, including excluded ambiguous/non-active number candidates and explicit selections.",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              number: { type: "string" },
              classification: { type: "string", description: "active | done | deferred | ambiguous | outside-subtree (the last is explicit path/glob report context only)" },
              selectedBy: {
                type: "array",
                items: {
                  type: "object",
                  properties: { raw: { type: "string" }, kind: { type: "string", description: "number | path | glob" } },
                  required: ["raw", "kind"],
                },
              },
            },
            required: ["path", "number", "classification", "selectedBy"],
          },
        },
        numbers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              number: { type: "string" },
              classification: { type: "string", description: "active | done | deferred | ambiguous" },
              paths: { type: "array", items: { type: "string" } },
            },
            required: ["number", "classification", "paths"],
          },
        },
        notFound: {
          type: "array",
          items: {
            type: "object",
            properties: { raw: { type: "string" }, kind: { type: "string", description: "number | path | glob" }, diagnostic: { type: "string" } },
            required: ["raw", "kind", "diagnostic"],
          },
        },
        exclusions: {
          type: "array",
          description: "Every non-active number selection and not-found input excluded by the workflow's hands-off policy.",
          items: {
            type: "object",
            properties: {
              raw: { type: "string" },
              kind: { type: "string" },
              number: { type: "string" },
              classification: { type: "string" },
              paths: { type: "array", items: { type: "string" } },
              reason: { type: "string" },
            },
            required: ["raw", "kind", "paths", "reason"],
          },
        },
      },
      required: ["paths", "numbers", "notFound", "exclusions"],
    },
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
  required: ["defaultBase", "resolution", "waves"],
};

const PR_SCHEMA = {
  type: "object",
  properties: {
    opened: { type: "boolean", description: "True ONLY if a PR URL exists (from `gh pr create`, or from the recorded-head lookup that recovers a creation which failed before printing one) AND that PR's base was read back and equals the recorded base, after a repair if one was needed." },
    url: { type: "string", description: "The PR URL — set whenever one exists, including when the base could not be verified or repaired, so the maintainer is handed the PR to retarget." },
    pushed: { type: "boolean", description: "Whether the branch was pushed to the remote." },
    baseOk: { type: "boolean", description: "True ONLY if the PR named by `url` was read back with `gh pr view <url> --json baseRefName` and its base equals the recorded base — after the repair, when one was made. Never true for a base that was not read back." },
    baseRepaired: { type: "string", description: "When the PR was created against the wrong base and `gh pr edit <url> --base` fixed it: the base it carried before the repair. Empty when no repair was needed." },
    reason: { type: "string", description: "When opened is false: why — name the operation that failed and what it reported; a read that did not settle is named with the answer it last returned, and a wrong base the repair could not fix with the base the PR still carries. Empty when opened." },
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
          changedBranches: { type: "array", items: { type: "string" }, description: "Branches actually modified + committed by this resolution — your account of the work, for the run record. The dispatch reads nothing from it: it does NOT select who is re-reviewed, because every held branch is re-reviewed before delivery and this report cannot be checked. Empty when blocked." },
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
Address any repository other than your own checkout BY PATH: \`git -C <absolute path>\`. NEVER derive a working directory from a glob, and NEVER chain a state-changing git command after a \`cd\` whose success you have not checked.
Empirical verification that could change state belongs ONLY in a disposable clone. Run \`command -v dc-enter\`; where it is found, work in \`DC="$(dc-enter <slug>)"\` — it prints one absolute path on stdout, \`dc-remove <slug>\` drops it, and a reused slug is REFUSED rather than re-derived, so pass \`--replace\` or remove the slug first if this may run twice. Where the helper is absent, use an absolute path outside the repository — never a relative one, and never the repository itself. Never \`cd\` into a path held in a variable unguarded: \`cd ""\` returns 0 and moves nowhere, so checking the status catches nothing and a lookup that produced no path leaves you in the shared checkout. Write \`cd -- "\${DC:?dc-enter returned no path}"\`, and confirm \`pwd\` before the first command that writes.`;

// Subagent lifecycle for this workflow's OWN deputies, out here beyond the
// review cycle. The cycle's roles get the same rule from CYCLE_FINISH_IN_TURN
// inside the byte-mirrored `review-cycle-core` section, which out-of-section
// code does not reach into — the reason CYCLE_REDIRECTED_OUTPUT is written out
// again rather than shared. It binds a deputy for the same reason it binds a
// fixer: nothing resumes a subagent, and one that ended its turn waiting on a
// background child it had launched left a dirty worktree and no packet until
// the orchestrator hunted the child down by hand. The sentence is kept
// byte-identical to the cycle's, and `test-subagent-destroy-boundary.mjs`
// asserts that rather than trusting this comment.
const DEPUTY_FINISH_IN_TURN = "Finish inside your own turn: nothing resumes you afterwards, so never end it waiting for a notification, a callback, or a child you started. Bound and wait on anything you launch, and reap it before you return — no process of yours may outlive your turn.";

// The cycle's companion rule, for the one deputy it applies to: the collision
// resolver's changed branches go straight back through this workflow's own
// re-review, so a second opinion it launches for itself is both redundant and
// the shape that once outlived its launcher, orphaned, and wandered into an
// unrelated sibling worktree. Worded for a deputy rather than a cycle role, so
// it is this workflow's sentence rather than a copy of CYCLE_NO_SELF_PEER.
const DEPUTY_NO_SELF_REVIEW = "This workflow re-reviews every branch you change and runs the sanctioned second opinion itself — launch no review of your own; a detached one has outlived its launcher and wandered into a sibling worktree.";

function bootstrapPrompt() {
  return `Prepare this container for a worktree-isolated task batch. This is setup only — edit no project files.

${DESTROY_BOUNDARY}

1. From the repo root, run \`wt-bootstrap\` (an image-baked helper on PATH). It performs the whole Session Bootstrap deterministically: verifies the worktree roots are container-local (never the host bind mount), prunes ONLY this container's orphaned worktrees under \`.worktrees/$CONTAINER_NAME/\`, sets up the container-local SSH→HTTPS remote rewrite, probes push access, and prints one JSON object.
2. Map that JSON onto the structured result verbatim — \`ok\`, \`blocker\`, \`wtBase\`, \`remote\`, \`availBytes\` — with no reinterpretation. \`remote: false\` is NOT a blocker (the batch falls back to local branches and skips PRs). On \`ok: true\`, \`wtBase\` must be the absolute path the script printed: never a relative path, never one derived from your own working directory. The batch aborts without it rather than measure an unknown filesystem.
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

Run \`df -B1 --output=avail ${shq(wtBase)}\` (POSIX fallback: \`df -kP\`, avail column, times 1024) and return the mount's free bytes as \`availBytes\`. Measure that exact path — do not substitute a relative path or one derived from your working directory. If the path is missing or \`df\` fails, return \`availBytes: 0\`.`;
}

// The storage throttle's retention rule, in one place so no probe site can relax
// it: a reading counts only when it is a positive number, and anything else — no
// result at all, a `df` that could not measure (0), a non-numeric or negative
// value — keeps the previous reading. Stale-but-conservative beats dropping the
// cap mid-batch, which is the ENOSPC the throttle exists to prevent.
function nextAvailBytes(previous, reading) {
  const bytes = reading && typeof reading.availBytes === "number" ? reading.availBytes : 0;
  return bytes > 0 ? bytes : previous;
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

function resolvePrompt(pointers) {
  return `You are scoping a batch of pre-planned task pointers for implementation. Do NOT implement anything. This is the batch's own-context-window resolver; do all task-tree scavenging here so the orchestrator receives only your structured result.

${DESTROY_BOUNDARY}

Read \`AGENTS.md\` / \`CLAUDE.md\` first for project conventions.

Argument pointers (a deduplicated, first-seen-order mixed list of task numbers, task-file paths, and globs; JSON array, each element exactly ONE raw input): ${JSON.stringify(pointers)}

That list is the workflow's own derivation of its argument, and step 4's reconciliation compares your packet against the same list, failing the whole batch closed on any disagreement:
- The peer flag (any whole whitespace/comma-bounded token run matching \`/${PEER_OPINIONS_FLAG.source}/i\`) is a flag the loop already handled, not a task pointer. The workflow masks each one out of the argument before deriving the list, so no element here is one; emit no \`paths\` entry and no \`notFound\` diagnostic for a flag or for any word inside it — though an element that DOES appear in the list is by that fact not a flag, whatever flag text it embeds: account for it like any other pointer.
- A flat-string invocation was split on whitespace AND commas, with each token's surrounding quotes stripped AFTER the split: \`039,041\` arrives as two elements, not one, so a pointer derived from a flat string can therefore carry neither whitespace nor a comma, and quoting a spaced path in a flat string does not join it either — such fragments arrive as the elements they split into; do not reassemble them. A structured invocation (an array or object) instead contributes every non-collection leaf as exactly one element, boundaries intact — trimmed of surrounding whitespace but never split or otherwise altered — so a task-file path containing whitespace or a comma can be named only that way.
- Treat each element as exactly one raw input even when it contains whitespace, a comma, or quotes: never split, merge, trim, or re-quote an element, and echo it verbatim as the \`raw\` value in \`selectedBy\`/\`notFound\`. Account for every element and for nothing outside the list: resolve each under the skill's contract and emit its \`not-found\` diagnostic when it selects nothing.

Do this:
1. Follow the \`resolve-tasks\` skill's shared contract to produce its deduplicated provenance-tagged \`paths\`, per-full-number \`numbers\`, and per-input \`notFound\` collections. Do not invent a second filename parser here.
2. Apply the workflow's HANDS-OFF consumer policy. Include as executable every explicit path/glob selection whatever its classification, including an existing well-formed task file outside the resolved task subtree whose report status is \`outside-subtree\` (explicit wins when a path also has number provenance), plus number-selected unambiguous \`active\` paths. Exclude every number-selected \`done\`, \`deferred\`, or \`ambiguous\` classification and every \`not-found\` input; never guess an ambiguous number. Record exactly one exclusion per excluded deduplicated raw input in \`resolution.exclusions\`, with no unrelated entries: a matched number exclusion carries that raw number, \`kind: "number"\`, its full \`number\`, exact \`classification\`, every candidate path that raw input selected, and the exact reason \`number-selected <classification> task is excluded in hands-off mode\`; a \`not-found\` exclusion carries the diagnostic's exact \`raw\` and \`kind\`, \`paths: []\`, and the exact reason \`not-found input is excluded in hands-off mode\`, while omitting \`number\` and \`classification\`. Preserve the complete resolver packet beside the exclusions.
3. Read each executable task file in full. Determine dependencies: an explicit "Depends on" field, shared infrastructure, or files/modules two tasks both create or migrate. When in doubt, treat tasks that touch the same files or migrations as dependent.
4. Group executable tasks into WAVES: wave 1 is every task with no unmet dependency; wave 2 depends only on wave 1; and so on. Tasks within a wave are independent and will run concurrently. Put every executable resolved path in exactly one wave, and put no excluded, unknown, or unrelated path in any wave. Return an empty \`waves\` array only when resolution leaves no executable task and the exact structured exclusions above account for every excluded input; that is a successful, documented no-op. The workflow independently validates every wave path against the resolution hard list and re-derives both hands-off eligibility and exact exclusion accounting, so an exclusion or not-found diagnostic cannot explain away another executable path. It also holds the exact pointer list it handed you above and requires your packet to account for every element — in some path's \`selectedBy\` or as a \`not-found\` diagnostic — and for no pointer the list never named, so an internally consistent packet that silently omits one input is rejected rather than run as a smaller batch. An omitted executable path, a duplicate or unknown wave path, an included non-executable path, or an unaccounted empty wave set is a resolution failure, not a no-op.
5. For each task set:
   - a ref-safe \`slug\` (task number + short name; also its worktree dir name),
   - a \`branch\` to implement on,
   - a \`base\`: the user's explicit base (if given) else the current branch for independent tasks; for a dependent task, the \`branch\` of the dependency it most directly extends (stacked PRs),
   - \`dependsOn\`: the slugs of in-batch tasks it depends on (the task(s) whose branch is its base), or empty,
   - \`upstream\`: a one-line note on what an in-batch dependency introduced, if any.
6. Set \`defaultBase\` to the user's explicit base override, else the current checked-out branch, else \`main\`.

Return the structured plan. Paste each task file's FULL content verbatim into \`content\` — downstream agents have no other access to it.`;
}

// Keep this one classification gate aligned with resolvePrompt's hands-off
// policy: explicit provenance wins regardless of lifecycle, while number-only
// provenance executes only an unambiguous active task. An unknown/malformed
// packet is not evidence that a path was safely excluded.
function handsOffPathEligibility(entry) {
  if (!entry || typeof entry !== "object" || !Array.isArray(entry.selectedBy) || entry.selectedBy.length === 0) return "unknown";
  const kinds = entry.selectedBy.map((selection) => selection && selection.kind);
  if (kinds.some((kind) => kind === "path" || kind === "glob")) return "executable";
  if (!kinds.every((kind) => kind === "number")) return "unknown";
  if (entry.classification === "active") return "executable";
  if (["done", "deferred", "ambiguous"].includes(entry.classification)) return "excluded";
  return "unknown";
}

const HANDS_OFF_NUMBER_REASON = (classification) => `number-selected ${classification} task is excluded in hands-off mode`;
const HANDS_OFF_NOT_FOUND_REASON = "not-found input is excluded in hands-off mode";

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function sameUniqueStrings(actual, expected) {
  if (!Array.isArray(actual) || actual.some((value) => !nonEmptyString(value))) return false;
  if (new Set(actual).size !== actual.length || new Set(expected).size !== expected.length) return false;
  if (actual.length !== expected.length) return false;
  const expectedSet = new Set(expected);
  return actual.every((value) => expectedSet.has(value));
}

// Validate the resolver packet as an internally consistent hard list and derive
// the one allowed exclusion record for every non-active number input and every
// not-found input. Derivation keeps the plan agent's prose from deciding what
// evidence is enough to turn an empty batch green.
function expectedHandsOffExclusions(resolution) {
  if (!resolution || typeof resolution !== "object") return null;
  if (!Array.isArray(resolution.paths) || !Array.isArray(resolution.numbers) || !Array.isArray(resolution.notFound) || !Array.isArray(resolution.exclusions)) return null;

  const validInside = new Set(["active", "done", "deferred", "ambiguous"]);
  const pathNames = new Set();
  const insidePaths = [];
  const selectedInputs = new Set();
  const inputKinds = new Map();
  const numberSelections = new Map();

  for (const entry of resolution.paths) {
    if (!entry || typeof entry !== "object" || !nonEmptyString(entry.path) || !nonEmptyString(entry.number) || pathNames.has(entry.path)) return null;
    if (!validInside.has(entry.classification) && entry.classification !== "outside-subtree") return null;
    pathNames.add(entry.path);
    if (!Array.isArray(entry.selectedBy) || entry.selectedBy.length === 0) return null;
    const entrySelections = new Set();
    for (const selection of entry.selectedBy) {
      if (!selection || typeof selection !== "object" || !nonEmptyString(selection.raw) || !["number", "path", "glob"].includes(selection.kind)) return null;
      const selectionKey = `${selection.kind}\u0000${selection.raw}`;
      if (entrySelections.has(selectionKey)) return null;
      if (inputKinds.has(selection.raw) && inputKinds.get(selection.raw) !== selection.kind) return null;
      inputKinds.set(selection.raw, selection.kind);
      entrySelections.add(selectionKey);
      selectedInputs.add(selectionKey);
      if (selection.kind !== "number") continue;
      if (!validInside.has(entry.classification)) return null;
      const prior = numberSelections.get(selection.raw);
      if (prior && (prior.number !== entry.number || prior.classification !== entry.classification)) return null;
      const group = prior || { raw: selection.raw, kind: "number", number: entry.number, classification: entry.classification, paths: [] };
      if (!group.paths.includes(entry.path)) group.paths.push(entry.path);
      numberSelections.set(selection.raw, group);
    }
    if (entry.classification !== "outside-subtree") insidePaths.push(entry);
    if (handsOffPathEligibility(entry) === "unknown") return null;
  }

  const numbers = new Map();
  for (const entry of resolution.numbers) {
    if (!entry || typeof entry !== "object" || !nonEmptyString(entry.number) || numbers.has(entry.number) || !validInside.has(entry.classification)) return null;
    if (!Array.isArray(entry.paths) || entry.paths.length === 0 || entry.paths.some((path) => !nonEmptyString(path)) || new Set(entry.paths).size !== entry.paths.length) return null;
    if (entry.classification === "ambiguous" ? entry.paths.length < 2 : entry.paths.length !== 1) return null;
    numbers.set(entry.number, entry);
  }
  for (const entry of insidePaths) {
    const number = numbers.get(entry.number);
    if (!number || number.classification !== entry.classification || !number.paths.includes(entry.path)) return null;
  }
  for (const [number, entry] of numbers) {
    if (!insidePaths.some((path) => path.number === number && path.classification === entry.classification)) return null;
  }
  for (const selection of numberSelections.values()) {
    const number = numbers.get(selection.number);
    if (!number || number.classification !== selection.classification || !sameUniqueStrings(selection.paths, number.paths)) return null;
  }

  const expected = [];
  for (const selection of numberSelections.values()) {
    if (selection.classification === "active") continue;
    expected.push({ ...selection, reason: HANDS_OFF_NUMBER_REASON(selection.classification) });
  }

  const notFoundInputs = new Set();
  for (const diagnostic of resolution.notFound) {
    if (!diagnostic || typeof diagnostic !== "object" || !nonEmptyString(diagnostic.raw) || !["number", "path", "glob"].includes(diagnostic.kind) || !nonEmptyString(diagnostic.diagnostic)) return null;
    const key = `${diagnostic.kind}\u0000${diagnostic.raw}`;
    if (notFoundInputs.has(key) || selectedInputs.has(key) || inputKinds.has(diagnostic.raw)) return null;
    inputKinds.set(diagnostic.raw, diagnostic.kind);
    notFoundInputs.add(key);
    expected.push({ raw: diagnostic.raw, kind: diagnostic.kind, paths: [], reason: HANDS_OFF_NOT_FOUND_REASON });
  }
  return expected;
}

function exclusionsExactlyMatch(resolution, expected) {
  if (!expected || resolution.exclusions.length !== expected.length) return false;
  const used = new Set();
  for (const wanted of expected) {
    let match = -1;
    for (let index = 0; index < resolution.exclusions.length; index++) {
      if (used.has(index)) continue;
      const actual = resolution.exclusions[index];
      if (!actual || typeof actual !== "object" || actual.raw !== wanted.raw || actual.kind !== wanted.kind || actual.reason !== wanted.reason) continue;
      if (!sameUniqueStrings(actual.paths, wanted.paths)) continue;
      if (wanted.kind === "number") {
        if (actual.number !== wanted.number || actual.classification !== wanted.classification) continue;
      } else if (Object.prototype.hasOwnProperty.call(actual, "number") || Object.prototype.hasOwnProperty.call(actual, "classification")) {
        continue;
      }
      match = index;
      break;
    }
    if (match < 0) return false;
    used.add(match);
  }
  return true;
}

// The packet is the resolver agent's own account of the argument, so nothing
// inside it can show that the agent SAW every pointer: an input dropped before
// resolution leaves a packet exactly as internally consistent as a correct one,
// and the batch then completes without executing OR reporting that task. So the
// raw pointers are derived from the argument here, ONCE — the resolve stage
// renders this exact list into the resolver's prompt and reconciles the packet
// against the same list, so the prompt and the reconciliation cannot disagree
// about where a pointer begins and ends. This is not a second filename parser —
// it decides nothing about what a token means, only that the packet accounts
// for each one exactly once.
// The peer flag is the documented invocation's one non-pointer argument, so it
// is masked out below with THIS regex — the same one the flag parser near the
// batch body tests, deliberately shared rather than approximated. An
// approximation (dropping every `=`-bearing token, say) makes the two sides
// disagree on the spellings the flag parser tolerates on purpose: `peer
// opinions=off` would leave a stray `peer` pointer and `peer-opinions = off`
// three of them, none of which any resolution can account for, hard-aborting
// the batch on an invocation the flag parser accepts. The lookarounds bound
// the flag to a whole token run between whitespace, commas, or the argument's
// edges — the same boundaries the flat-string splitter below cuts on — because
// a word boundary alone also matches the flag text INSIDE a filename, turning
// an explicit pointer like `tasks/039-peer-opinions=off.md` into the invented
// fragments `tasks/039-` and `.md` that no resolution can account for.
const PEER_OPINIONS_FLAG = /(?<![^\s,])peer[\s-]*opinions?\s*=\s*(off|on)(?![^\s,])/gi;
// A structured leaf is a flag only when, trimmed, it IS one whole — built from
// the same single definition above so the two spellings cannot drift. A leaf
// that merely embeds the flag text beside other content stays one pointer,
// never masked: its boundary came from the caller's structure, not from any
// splitter, and fragmenting it is exactly what the leaf contract forbids.
const PEER_OPINIONS_FLAG_LEAF = new RegExp(`^${PEER_OPINIONS_FLAG.source}$`, "i");
// The leaf contract, stated once. A STRING argument carries no boundary
// information, so it is tokenized: split on whitespace AND commas, each token's
// surrounding quotes stripped AFTER the split (so quotes do not express
// boundaries — a spaced path cannot be named in a flat string), the peer flag
// masked out first. An ARRAY or PLAIN-OBJECT argument is recursed, and every
// non-collection LEAF — null/undefined dropped outright, otherwise
// stringified if not a string, trimmed of surrounding whitespace,
// dropped when empty or when it is exactly the peer flag — is exactly one raw
// pointer, NEVER split, whatever it contains: the caller's structure already
// said where each pointer ends. Only an array or a plain object (own
// prototype Object.prototype or null — the only object shapes a JSON argument
// can carry) counts as caller structure; any other object is a LEAF,
// stringified like a primitive, because recursing its enumerable values reads
// boundaries the caller never expressed — Object.values over a boxed String
// fragments the pointer into its characters, and over a Date yields nothing,
// dropping the pointer silently. Both shapes dedupe in first-seen order.
// The trim is deliberate, not a breach of the never-split promise: the same
// reading that drops a whitespace-only leaf treats edge whitespace as
// packaging rather than pointer content, a trimmed leaf is still one leaf, and
// the prompt and the reconciliation both consume this same trimmed list, so
// the two sides cannot drift over it. The cost is confined to a path whose
// name genuinely begins or ends with whitespace, which then surfaces as a
// not-found exclusion rather than vanishing.
// The traversal is a named function because the flag parser at the batch body
// consumes it too: the pointer gate below keeps every leaf that is NOT exactly
// the peer flag, and the mode read consumes exactly the whole-flag leaves this
// gate masks, so the two sides split the same leaves the same way by
// construction.
function structuredArgLeaves(batchArgs) {
  const leaves = [];
  const collect = (node) => {
    if (node == null) return;
    if (Array.isArray(node)) return node.forEach(collect);
    if (typeof node === "object") {
      const proto = Object.getPrototypeOf(node);
      if (proto === Object.prototype || proto === null) return Object.values(node).forEach(collect);
    }
    const leaf = String(node).trim();
    if (leaf.length > 0) leaves.push(leaf);
  };
  collect(batchArgs);
  return leaves;
}
function requiredArgPointers(batchArgs) {
  if (batchArgs != null && typeof batchArgs === "object") {
    return [...new Set(structuredArgLeaves(batchArgs).filter((leaf) => !PEER_OPINIONS_FLAG_LEAF.test(leaf)))];
  }
  const tokens = String(batchArgs == null ? "" : batchArgs)
    .replace(PEER_OPINIONS_FLAG, " ")
    .split(/[\s,]+/)
    .map((token) => token.replace(/^["']+|["']+$/g, ""))
    .filter((token) => token.length > 0);
  return [...new Set(tokens)];
}

// Exact both ways: an argument pointer the packet never mentions is dropped
// work, and a packet raw the argument never named is invented work.
function resolutionAccountsForInputs(resolution, required) {
  if (!resolution || typeof resolution !== "object") return false;
  if (!Array.isArray(resolution.paths) || !Array.isArray(resolution.notFound)) return false;
  const accounted = new Set();
  for (const entry of resolution.paths) {
    if (!entry || typeof entry !== "object" || !Array.isArray(entry.selectedBy)) return false;
    for (const selection of entry.selectedBy) {
      if (!selection || typeof selection !== "object" || !nonEmptyString(selection.raw)) return false;
      accounted.add(selection.raw);
    }
  }
  for (const diagnostic of resolution.notFound) {
    if (!diagnostic || typeof diagnostic !== "object" || !nonEmptyString(diagnostic.raw)) return false;
    accounted.add(diagnostic.raw);
  }
  return sameUniqueStrings([...accounted], required);
}

// Every executable hard-list path must occur exactly once in the waves, and no
// other path may occur. This applies to non-empty plans too: the executor never
// trusts a structurally valid plan that silently dropped or invented work.
function planResolutionIsExact(plan) {
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.waves)) return false;
  const resolution = plan.resolution;
  const expectedExclusions = expectedHandsOffExclusions(resolution);
  if (!exclusionsExactlyMatch(resolution || {}, expectedExclusions)) return false;

  const executable = new Set();
  for (const entry of resolution.paths) {
    const eligibility = handsOffPathEligibility(entry);
    if (eligibility === "unknown") return false;
    if (eligibility === "executable") executable.add(entry.path);
  }

  const planned = new Set();
  for (const wave of plan.waves) {
    if (!Array.isArray(wave) || wave.length === 0) return false;
    for (const task of wave) {
      if (!task || typeof task !== "object" || !nonEmptyString(task.path) || !executable.has(task.path) || planned.has(task.path)) return false;
      planned.add(task.path);
    }
  }
  if (planned.size !== executable.size) return false;
  return [...executable].every((path) => planned.has(path));
}

// An empty executable plan is valid only after the same exact validator used
// for non-empty waves proves there is no executable path and every exclusion is
// accounted for. A truly empty argument remains a resolution failure/no-result.
function emptyPlanIsExplained(plan) {
  if (!planResolutionIsExact(plan) || plan.waves.length !== 0) return false;
  const expected = expectedHandsOffExclusions(plan.resolution);
  return Array.isArray(expected) && expected.length > 0;
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

function worktreeContract(task, { mayCreate = false, measuring = false } = {}) {
  // wt-enter encodes the rerun-safe lifecycle (reuse the existing worktree,
  // attach an existing branch, create off the base) so prompts never re-derive
  // it. Stages that must not create work (reviewer, PR) omit the base: a
  // missing branch then errors instead of silently checking out an empty tree.
  const enter = mayCreate
    ? `WT="$(wt-enter ${shq(task.slug)} ${shq(task.branch)} ${shq(task.base)})" && cd "$WT"`
    : `WT="$(wt-enter ${shq(task.slug)} ${shq(task.branch)})" && cd "$WT"`;
  // The cycle's packet MEASUREMENT gets its own variant, and it is the one
  // stage that must not RESOLVE a worktree at all. `wt-enter` is rerun-safe by
  // design: where the worktree is gone it attaches the branch in a FRESH
  // checkout, and a checkout built moments ago reads clean whatever the tree
  // the pass returned from held — the one answer this step must never invent.
  // So the measurer FINDS an already-registered worktree in git's own metadata
  // instead, and a worktree that is not there is unknown rather than rebuilt.
  // That also drops the branch assertion every other stage's contract carries,
  // which the DETACHED HEAD a rebase or a bisect leaves would fail: the
  // registration names the path whatever state the tree is in, `detached`
  // included, so nothing has to be read out of a helper's refusal message.
  if (measuring) {
    return `## WORKTREE CONTRACT (do this before anything else)

FIND this task's worktree — never RESOLVE it. \`wt-enter\` and every helper like it is rerun-safe by design: where the worktree is gone it attaches the branch in a fresh checkout, which would read clean whatever the tree you were sent to measure held. Run none of them.

From the repository checkout you start in, take exactly one read-only reading there and nothing else:

    git worktree list --porcelain

Your worktree is the registered one whose directory is named \`${task.slug}\`. Read it with \`git -C <that path> …\`, and read nothing else. That entry names the path whatever state the tree is in — a rebase or a bisect leaves HEAD DETACHED, so the entry reads \`detached\` rather than naming \`${task.branch}\`, and that is one of the states you were sent to read rather than a mismatch to report.

If no entry names that directory, if more than one does, or if the directory it names is missing or git will not run there, then the tree the pass returned from is not there to observe: report it as unknown, quoting what you found. Never build it, attach it, or prune it.

Read only, and only there. Beyond that one query never touch the repo root, and never read a sibling worktree — other agents are working in their own concurrently — and run nothing that writes, switches, attaches, restores, continues, or aborts anything.`;
  }
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
// never sees a sibling's, and caps nothing. The shared batchPeerState and
// batchPeerThrottle below are the two cross-cycle states: one shares preflight
// ownership, completion, and availability, while the other enforces task 015's
// adaptive cap, floor, and queue across every cycle. Task 015 alone defines
// that throttle policy.
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
    deviations: { type: "array", items: { type: "string" }, description: "Each deviation from a LOCKED maintainer decision that STILL STANDS after this pass — what was delivered instead and the constraint that forced it. Report, don't correct; the cycle surfaces these for the human. Restate every standing one on every pass — VERBATIM, since the cycle matches these by exact text and a reworded restatement reads as a drop plus a brand-new deviation — and leave out only one that genuinely no longer stands: the result describes the FINAL state and keeps the per-pass reports as history." },
    workReport: { type: "array", items: { type: "object" }, description: "One entry per work item in the scope, in the per-item shape the scope's instructions define (a consumer contract rides through here untyped); echoed into the cycle result." },
    proactive: { type: "string", description: "Same-pattern fixes made beyond the literal items, or empty." },
    closeOutEdits: { type: "array", items: { type: "string" }, description: "OFFER of a trivial-round close-out (only where the assignment says the invoker granted it): one entry per NON-SEMANTIC edit — wording, typos, comment phrasing, formatting; nothing touching behavior, logic, or the meaning of an acceptance criterion — in the fixes portion BEFORE any final record-only suffix. Ordinarily the whole pass diff must be those non-semantic edits. The SOLE exception is an exact FINAL diagnosis-only record commit required by the unrelated-flake rule: report that delivery failure in `flakeRecord`, but do NOT list the record in `closeOutEdits`. That report merely lets you OFFER the split; it cannot certify one. The cycle independently reads the diff and measures the final commit and its parent to decide whether that exact suffix qualifies. Empty otherwise. The offer is not the license: any other executable, behavioral, or semantic change anywhere in the pass diff, however it got there or how `flakeRecord` describes it, forfeits the close-out for a normal reviewer round — as does an empty fixes portion, an edit listed here that the fixes portion does not actually carry, or a finding disposed `fixed` that the fixes portion holds no change for, since this list cannot vouch for a fix it does not mention." },
    flakeRecord: { type: "string", description: "REQUIRED when this pass's own validation run hit a failure the cycle's flake rule defers as evidenced-unrelated: what failed, the evidence that established unrelatedness, and the follow-up task carrying it — the NEW one this pass committed, or the ACTIVE existing one it cites instead of editing. Empty otherwise, and never a restatement of an earlier pass's record — report only what YOUR OWN run surfaced. The cycle keeps every pass's, so copying an earlier one forward would republish it as your run's; a failure your own run hit AGAIN is your run's record and no restatement at all, so report it. This is the maintainer's only notice that a validation run FAILED, so the cycle carries EVERY pass's record in the run report it returns (the batch summary, where the consumer has one), and publishes the CONCLUDING pass's in the PR body or summary comment besides — including where citing an existing task left that pass with nothing to commit. It buys no exit and skips no round of its own — what a conclusion may skip is licensed by a read of the DIFF — but omitting a record your run owes costs the round that record would have skipped." },
    finalSha: { type: "string", description: "HEAD sha after this pass, with everything committed." },
    clean: { type: "boolean", description: "True only if the worktree is CLEAN and IDLE: `git status --porcelain` empty with every intended change committed, AND no Git operation in progress (`git rev-parse --git-path rebase-merge` / `rebase-apply`, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG`). A packet returned mid-rebase or mid-cherry-pick can print empty porcelain; the cycle refuses it either way. This is a self-report and is not taken as the answer: the cycle MEASURES the same worktree itself the moment your packet returns, so a `clean` the measurement contradicts costs the pass." },
    artifactDir: { type: "string", description: "Absolute path of this cycle's unique artifact directory — REQUIRED every pass: round 1 creates it (outside the worktree) and reports it, later passes echo the directory they were given. The result contract promises full round history reachable through it." },
  },
  required: ["changed", "dispositions", "openQuestions", "deviations", "flakeRecord", "clean", "artifactDir"],
};

// The INDEPENDENT measurement of the worktree a fix packet came back from —
// what `clean` above only asks for. The precise failure the packet hard-check
// exists to contain is a pass that returns `clean: true` from a tree still
// mid-rebase or mid-cherry-pick: such a tree prints EMPTY porcelain, so the
// fixer's own reading can be sincere and wrong, and nothing but the fixer ever
// looked at it. Modelled on `wf-address-tasks.js`'s `MAIN_CHECKOUT_SCHEMA`,
// its `measured: false` degradation included: a reading that could not be taken
// is UNKNOWN, and the one thing it must never read as is clean. The same
// independent turn resolves HEAD and its parent, so a later close-out check
// cannot make an arbitrary valid-looking left OID the boundary of the final
// record-only commit.
// That parent is read out of HEAD's OWN commit header rather than by resolving
// `HEAD^`, which exits non-zero wherever HEAD has no parent to name — a root
// commit, and every shallow clone, whose boundary commit git grafts parentless.
// Asking for `HEAD^` would make an ordinary depth-1 checkout report
// `measured: false` and refuse EVERY packet, close-out granted or not. So an
// absent parent is a definitive reading — empty — and only what NEEDS the
// parent loses: an empty value matches no well-shaped range, so a close-out
// suffix claim is refused there rather than accepted on the checker's word.
const CYCLE_PACKET_CHECK_SCHEMA = {
  type: "object",
  properties: {
    measured: { type: "boolean", description: "True only if ALL readings ran and produced definitive answers — the porcelain status, every operation-state marker, HEAD's full OID, and HEAD's parent, whose definitive answer is EMPTY where HEAD has no parent (a root commit, or a shallow clone's grafted boundary). False only when a reading could not be TAKEN; the remaining fields are then best-effort and must NOT be read as clean or authoritative." },
    dirty: { type: "array", items: { type: "string" }, description: "One `git status --porcelain -z --untracked-files=all` record per changed path: the 2-character `XY` status field, a space, then the repo-relative path (the current path for a rename/copy). The `XY ` prefix is kept verbatim — its first column can be a space. Empty when the tree is clean." },
    operation: { type: "string", description: "The Git operation still in progress, named by the state marker that showed it — `rebase-merge`, `rebase-apply`, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG` — or EMPTY when none is. Name the marker you actually found, never an inference: most of these leave the porcelain clean, which is the whole reason this reading is taken separately." },
    headSha: { type: "string", description: "The exact full OID printed by `git rev-parse HEAD`, or empty when it could not be resolved." },
    headParentSha: { type: "string", description: "The exact full OID of HEAD's first parent, read from HEAD's own commit header (`git show -s --format=%P HEAD`) rather than by resolving `HEAD^`, which errors where no parent is nameable. EMPTY where HEAD has no parent at all — a root commit, or a shallow clone's grafted boundary — which is a definitive reading rather than a failed one. This is independent proof of the only left boundary a final one-commit record suffix may name, so an empty value proves none and refuses every suffix claim." },
    detail: { type: "string", description: "One line: what the readings found, or — when `measured` is false — which reading could not be taken and why." },
  },
  required: ["measured", "dirty", "operation", "headSha", "headParentSha", "detail"],
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
    deviationAssessments: {
      type: "array",
      description: "Your half of report-don't-correct: ONE entry per deviation from a LOCKED decision that still stands on this packet (every one you were shown except the claimed drops you accept). Empty when the packet carries none. A round that leaves a standing deviation unassessed does NOT pass — it would reach the maintainer carrying only the implementer's half. Exactly one usable entry per deviation is published: a second entry for a deviation already assessed, and any entry the round cannot use, is dropped rather than sent on beside the usable one — a hedge here buys nothing.",
      items: {
        type: "object",
        properties: {
          deviation: { type: "string", description: "The deviation's text, copied VERBATIM from the list you were shown — the cycle matches it by exact text." },
          inSpecRoute: { type: "string", description: "Whether a route inside the locked decision existed, and which one — the first thing the maintainer's ratify-or-conform call needs." },
          recommendation: { type: "string", description: "Your verdict as the FIRST word — RATIFY or CONFORM, the whole vocabulary — then the one-line reason. A hedge (`UNSURE`, `needs investigation`) is not a verdict and leaves the deviation unassessed, which does not pass the round. Opening with both — `RATIFY or CONFORM …` — is a refusal to choose and is rejected as one, not read as RATIFY; otherwise the first word is taken literally, so lead with the verdict you mean, and lead with neither if you cannot choose. You recommend; the maintainer decides." },
        },
        required: ["deviation", "inSpecRoute", "recommendation"],
      },
    },
  },
  required: ["pass", "issues"],
};

// The recommendation is a two-valued VERDICT carrying a reason, not free prose:
// what reaches the maintainer is a ratify-or-conform list. Reading it as
// present-or-absent left, one level down, the same hole the structural field
// closed one level up — `UNSURE — needs investigation` is schema-valid and
// trims to something non-empty, so it would count as the reviewer's half while
// answering the only question that half exists to answer. So the verdict is
// parsed, and must LEAD the string exactly as the schema and the brief ask.
// Leading rather than merely occurring, because a reason may legitimately name
// the other verdict ("RATIFY — conforming would cost a release") and an
// occurrence test would have to reject that.
//
// What the rule buys is stated exactly, because the crude version is the one
// worth having: the FIRST word decides, and a string opening with neither
// verdict is not a verdict. One hedge opens with one and is still not a choice,
// and it is the one an ordinary round reaches rather than hand-crafted input:
// the brief renders `START with RATIFY or CONFORM` and the schema repeats that
// the two are the whole vocabulary, so `RATIFY or CONFORM — needs
// investigation` is the brief's own surface form echoed back, and reading it as
// RATIFY would hand the maintainer a verdict from a reviewer that explicitly
// refused to give one. That exact shape is rejected by name — the two verdicts
// joined by a bare `or`. It leaves `RATIFY — CONFORM costs a release` alone, a
// real choice whose reason names the other verdict, because what follows the
// verdict there is a separator rather than the word `or`. Nothing wider is
// claimed: a reason that retracts its verdict in any other wording still reads
// as that verdict, which is why the schema and the brief also warn that the
// first word is taken literally, and the maintainer reads the whole
// `recommendation` text either way.
const CYCLE_DEVIATION_VERDICTS = ["RATIFY", "CONFORM"];
const CYCLE_DEVIATION_HEDGE = /^(?:RATIFY|CONFORM)\s+OR\s+(?:RATIFY|CONFORM)\b/;
function cycleDeviationVerdict(recommendation) {
  // Leading punctuation and emphasis are stripped, so `**RATIFY** — …` reads as
  // the verdict it plainly is. A longer word that merely starts with one does
  // not: the character after the verdict must not continue it.
  const text = String(recommendation || "").trim().toUpperCase().replace(/^[^A-Z]+/, "");
  if (CYCLE_DEVIATION_HEDGE.test(text)) return "";
  return CYCLE_DEVIATION_VERDICTS.find((v) => text.startsWith(v) && !/[A-Z]/.test(text.charAt(v.length))) || "";
}

// Peer-stage result. `outcome` uses the peer-review-run vocabulary
// (powbox.peer-review-run/v1) so the eventual helper swap changes the prompt,
// not this contract.
//
// `reason` and `teardownFailure` are REQUIRED rather than optional because both
// drive control flow rather than diagnostics. `cyclePeerTrouble` classifies the
// EXACT reason string, so an omitted one normalizes to `""`, matches no entry in
// that mapping, and spends a qualifying empty/garbled forfeiture without ever
// stepping the throttle down. `teardownFailure` is the stage's only channel for
// a provider process it could not prove dead — the one condition the
// non-blocking normalization below must NOT absorb.
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
    notes: { type: "string", description: "Only valid bullets from the optional bounded NOTES section, preserved verbatim; empty when no valid advisory bullets survive (including a clean pass) and for every outcome that is not passed/issues, which reaches no verdict and so has no NOTES section to copy." },
    detail: { type: "string", description: "For a non-passed/issues outcome: why (logged out, timed out after retry, empty output, provider crash...)." },
    reason: { type: "string", description: "The provider/helper reason verbatim; distinguishes empty/garbled forfeitures for the adaptive throttle. Always emit it: an empty string where the outcome carries no reason, never an omitted field." },
    teardownFailure: { type: "boolean", description: "The ONE result that is not non-blocking: true ONLY when a provider process this stage launched could not be proven dead after the bounded TERM/KILL sequence. The cycle stops on it for operator intervention. False on every ordinary path, including this stage's own failures." },
  },
  required: ["outcome", "findings", "reason", "teardownFailure"],
};

const CYCLE_PEER_PREFLIGHT_SCHEMA = {
  type: "object",
  properties: {
    outcome: { type: "string", description: "available | unavailable" },
    detail: { type: "string", description: "Empty when available; exact missing-binary or logged-out diagnostic when unavailable." },
  },
  required: ["outcome", "detail"],
};

// Verdict of the trivial-round close-out's diff check — the orchestrator's own
// look at what would ship unreviewed, delegated the only way a script that
// cannot run git can look at a diff. It asks THREE questions: one per direction
// the list and the diff can disagree: `nonSemantic` stops the list licensing
// what the diff actually holds, and `editsPresent` stops the pass claiming a
// fix the diff never received. `recordOnlySuffix` is the one narrow exception
// to the first: the delivery run's diagnosis-only record may be the FINAL
// commit, but it cannot make any preceding semantic hunk disappear. Only the
// first was asked at first, which left
// an empty range VACUOUSLY non-semantic — so a pass reporting findings `fixed`
// with nothing committed concluded the cycle, its claims adjudicated by
// exactly nobody, since the round that would have caught it is the round this
// exit skips.
//
// `editsPresent` is asked about the pass's WHOLE claim — the edits it listed
// AND the findings it disposed `fixed` — because the two can come apart while
// the range stays non-empty. A pass that forgot one requested fix and shipped
// an unrelated comment tidy-up it did list satisfies a check that only knows
// the list: every listed edit is there, the range is not empty, and the
// forgotten fix is checked by nobody, since the round that would have caught
// it is again the one this exit skips. The `fixed` dispositions therefore
// travel with the list.
const CYCLE_CLOSEOUT_SCHEMA = {
  type: "object",
  properties: {
    nonSemantic: { type: "boolean", description: "True ONLY if every hunk before a valid record-only suffix is non-semantic, or every hunk in the whole range when no valid suffix exists. Any executable or behavioral change — however it got there, listed or not — is false, which simply buys the normal reviewer round." },
    editsPresent: { type: "boolean", description: "True ONLY if the portion before a valid record-only suffix is NON-EMPTY and carries everything the pass claims it shipped: every edit it listed, AND a change answering every finding it disposed `fixed`. The suffix cannot stand in for either. An EMPTY fixes portion is false: it holds no fix at all, so a finding reported `fixed` over it never landed. A claimed edit, or a claimed fix, you cannot find in that portion is false too — an unrelated tidy-up that IS there does not stand in for a requested fix that is not. Extra non-semantic hunks beyond the list do not make it false — `nonSemantic` judges those on their own merits." },
    recordOnlySuffix: { type: "boolean", description: "True ONLY if the FINAL commit is a suffix holding nothing but the unrelated-flake record: a NEW diagnosis-only follow-up task file, plus any PR-body or summary note recording what the delivery run surfaced. False when no such suffix exists, and also when the candidate suffix carries any other hunk." },
    recordOnlyRange: { type: "string", description: "When `recordOnlySuffix` is true, the exact full-OID `<parent>..<tip>` range naming that final record-only commit; empty otherwise." },
    why: { type: "string", description: "One line: what the fixes portion and candidate suffix held, or the semantic change, invalid suffix, missing claimed edit, or unlanded `fixed` claim that forfeits the close-out." },
  },
  required: ["nonSemantic", "editsPresent", "recordOnlySuffix", "recordOnlyRange", "why"],
};

// Verdict of the record-only check — the same look at a diff, asked of the one
// post-run commit the delivery gate tolerates. Nothing about the pass's own
// account of that commit reaches this check: a tolerance a fixer could
// self-certify is the evasion route the flake rule's evidence requirement
// exists to close, so the range is the only evidence there is.
const CYCLE_RECORD_ONLY_SCHEMA = {
  type: "object",
  properties: {
    recordOnly: { type: "boolean", description: "True ONLY if the range holds nothing but the unrelated-flake RECORD: a NEW diagnosis-only follow-up task file, plus any PR-body or summary note recording what the delivery run surfaced. Any other hunk — a source, test, config, or contract edit, a change to the failing test itself, anything touching the artifact under review — is false, which simply buys the normal reviewer round." },
    why: { type: "string", description: "One line: what the range held, or the change that forfeits the tolerance." },
  },
  required: ["recordOnly", "why"],
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
Address any repository other than your own checkout BY PATH: \`git -C <absolute path>\`. NEVER derive a working directory from a glob, and NEVER chain a state-changing git command after a \`cd\` whose success you have not checked.
Empirical verification that could change state belongs ONLY in a disposable clone. Run \`command -v dc-enter\`; where it is found, work in \`DC="$(dc-enter <slug>)"\` — it prints one absolute path on stdout, \`dc-remove <slug>\` drops it, and a reused slug is REFUSED rather than re-derived, so pass \`--replace\` or remove the slug first if this may run twice. Where the helper is absent, use an absolute path outside the repository — never a relative one, and never the repository itself. Never \`cd\` into a path held in a variable unguarded: \`cd ""\` returns 0 and moves nowhere, so checking the status catches nothing and a lookup that produced no path leaves you in the shared checkout. Write \`cd -- "\${DC:?dc-enter returned no path}"\`, and confirm \`pwd\` before the first command that writes.`;

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

// Unrelated-flake deferral, carried by the fixer: one batch run had every
// implementer independently burn most of its rounds stabilizing the same
// unrelated flaky suite. "Unrelated" is a DEMONSTRATED property (it reproduces
// on the base), never an assertion of convenience and never an inference from
// which code paths the failure happens to run through.
const CYCLE_FLAKE_POLICY = `When a test fails in an area this branch did not touch, do NOT iterate on stabilizing it here — but establish unrelatedness with EVIDENCE first: the failure must REPRODUCE on the base, or on an equivalently controlled comparison holding this branch's own changes out, with at most ONE rerun to confirm intermittence. That reproduction is the proof and nothing else substitutes for it: a failure confined to code paths the branch never edited is a supporting signal ONLY, since a change to a shared utility, a dependency, an environment setting, or a generated input breaks tests whose whole execution stays in untouched code. Evidenced unrelated: queue a follow-up task carrying ONLY the diagnosis already in hand (no further investigation), written under the repository's \`write-tasks\` conventions and committed on this branch, record the flake in \`flakeRecord\` — the field the cycle carries to the PR body or batch summary — so the maintainer can judge, and proceed to delivery with the failure documented — where the DELIVERY run itself surfaced it, commit that task after the run WITHOUT rerunning the suite (that record-only commit is the one thing a completed delivery pass survives). Name the failing suite or test in the task TITLE so a sibling's copy is greppable, and grep the task folder for an existing task on that suite first: an ACTIVE match means the queue entry already exists, so cite it in \`flakeRecord\` and carry your new evidence there rather than editing that task file (a base-landed file edited from several sibling branches at once turns cheap duplicate cleanup into a merge conflict at every merge) — that path commits nothing, and \`flakeRecord\` is then the whole record the maintainer gets, while a match only under \`done/\`/\`deferred/\` is context to cite beside a new schedulable queue entry. Duplicate flake tasks are ACCEPTABLE — far cheaper than concurrent stabilization attempts — and that grep BOUNDS the duplication rather than preventing it: it sees an already-landed task and one this same branch wrote, never a concurrent sibling implementer's, which lives on that sibling's branch and is invisible from here; consolidating whatever lands is the maintainer's next reaping sweep. INCONCLUSIVE is the third outcome, and for an intermittent failure the common one: an attempt that neither confirms nor refutes within the one-rerun bound is recorded as inconclusive, which is NOT unrelated — do not enter the stabilization loop and do not deliver; return it as your \`blocker\` with the failure, what the attempt showed, and any supporting signal, for the maintainer's defer-or-stabilize decision.`;

// The reviewer's half of the same policy — a gate amendment, stated where the
// gate is: the automatic-blocker rule is build/typecheck-specific, and this
// extends its spirit to tests without extending it one step further.
//
// It names BOTH outcomes the fixer's half admits, because the two are one
// disposition with two shapes: a NEW diagnosis task committed here, or an
// already-ACTIVE task cited instead — which that half prescribes precisely so
// a sibling branch does not edit a base-landed file. Recognizing only the
// committed one would make this gate block the outcome the policy asks for,
// on every required round and especially `light` mode's last one, and drive a
// conforming cycle to its cap over a task file the policy told it not to write.
const CYCLE_FLAKE_REVIEW = `A documented, evidenced UNRELATED test failure — reproduced on the base per the cycle's flake rule, with the diagnosis-only follow-up task that rule requires on record: either a NEW one committed on this branch, or the ACTIVE existing task the pass cited instead of duplicating or editing it — is NON-BLOCKING for you once you have SEEN that task. The cited-task shape leaves nothing in this branch's diff by design, and you are not shown the pass's own flake record, so verify the citation where you CAN see it: grep the repository's task folder for an ACTIVE task naming the suite that failed in your own run — the flake rule puts that name in the task TITLE for exactly this reason — rather than expecting a new file in the diff; a failure you can tie to no such task is not documented, and stays blocking. So does any failure this branch plausibly caused, and any reproduction attempt recorded as inconclusive.`;

// Comment discipline, carried by the fixer. A review round asking for
// documentation reliably produces the function re-implemented in prose right
// above it: non-executable duplicate content that drifts, then spends rounds of
// its own on comment correctness. The routing half is what makes the rule
// answerable — rationale that fails the test has somewhere to go.
const CYCLE_COMMENT_DISCIPLINE = `Ship only comments that outlive the PR. A code comment earns its keep only where it still does once the PR closes — why an arbitrary constant or choice is what it is, an external constraint that shaped a decision, a non-obvious invariant or tradeoff the code relies on but cannot express (why an ordering prevents a deadlock, why apparently redundant synchronization is needed), or a still-standing deliberately-overruled review decision, which you MAY record so the point is not re-raised. Never ship prose restating what adjacent code does — an outcome matrix, condition-by-condition narration, anything the code itself gives a reader with minimal effort; self-documenting code is the goal and the comment is the bounded exception for what code cannot show, not a default channel. The test governs explanatory comments, not the repository's own documented documentation convention: where one requires docstrings or API documentation on a public surface, that convention stands untouched. Reasoning that fails the test still has a home: rationale addressed to the people watching this diff goes in a PR reply or the summary comment, which the closing PR leaves behind exactly as it should, and durable knowledge too bulky for a why-comment goes to the repository's docs area (commonly \`docs/\`) — a routing option, never a per-PR ritual. Carry CURRENT rationale only: where a change supersedes a commented decision, the standing overruled one included, replace that comment rather than appending to it (version control holds the history), and delete a comment the code has outgrown instead of precision-editing it.`;

// The reviewer's half of the same rule — an amendment to what counts as a
// finding, stated where findings are opened: the fixer's half cannot stop the
// churn a review round starts.
const CYCLE_COMMENT_REVIEW = `Weight code comments by whether they outlive the PR: one re-implementing adjacent code in prose — an outcome matrix, condition-by-condition narration — is removable noise to flag for DELETION rather than material to precision-edit, and absent behavior-narration is never a gap to report unless the repository's own documented documentation convention requires it.`;

// Which validation tier a pass owes, decided by position: an intermediate pass
// owes the ROUND tier (the cheapest signal covering what it changed), while any
// pass that can be the cycle's LAST owes the DELIVERY tier — the confirmation
// pass, and every pass under `light`, which skips that confirmation pass and so
// can end the cycle on any passing round. A pass offering a trivial-round
// close-out is the third such case; its brief says so rather than being
// detectable here, since the offer arrives with the packet.
function cycleValidationTier(cycle, state) {
  return state.confirming || cycle.mode === "light" ? "delivery" : "round";
}

// Subagent lifecycle, carried by every role that can start a process. A subagent
// is never resumed, so one that ended its turn "waiting for the monitor
// notification" from a background child it had launched left a dirty worktree
// and no packet until the orchestrator hunted the child down by hand.
const CYCLE_FINISH_IN_TURN = "Finish inside your own turn: nothing resumes you afterwards, so never end it waiting for a notification, a callback, or a child you started. Bound and wait on anything you launch, and reap it before you return — no process of yours may outlive your turn.";

// On top of that, for every role except the peer stage itself: an implementer
// that launched its own detached second opinion outlived it, orphaned, and
// wandered into an unrelated sibling worktree for want of a tight working dir.
const CYCLE_NO_SELF_PEER = "The cycle runs the sanctioned second opinion itself, beside the reviewer — do not launch a peer review of your own.";

// Default worktree/branch contract when the consumer supplies none. A consumer
// with its own worktree lifecycle (wt-enter etc.) passes richer per-role
// contract text via cycle.contracts instead.
//
// The branch assertion is every role's but the MEASURER's, and is dropped for
// that role rather than excepted around: a rebase and a bisect leave HEAD
// DETACHED, so `git branch --show-current` prints EMPTY — which "differs" from
// the branch name — and a detached HEAD is one of the states the measurer is
// sent to find. Asserting the branch stops it before either reading, so the
// flagship case the measurement exists for (a tree left mid-rebase, whose
// porcelain is empty) would come back `measured: false` instead of naming the
// marker that failed. What a measurer needs is the right WORKTREE, which the
// path assertion establishes on its own; the branch adds nothing to two
// read-only readings and forbids the one they exist for.
function cycleDefaultContract(cycle, role) {
  const where = cycle.worktree
    ? `Your worktree is \`${cycle.worktree}\`. Before anything else, \`cd\` into it and verify \`git rev-parse --show-toplevel\` prints exactly that path; if not, STOP and report — do not run any git or edit command outside it. Other agents may be working in other worktrees concurrently; stay in yours.`
    : `You work in the repository's current checkout — do NOT create a worktree and do NOT switch branches.`;
  return role === "measurer"
    ? `${where}
HEAD there may be DETACHED — a rebase or a bisect leaves it so, and \`git branch --show-current\` then prints nothing at all. That is not a mismatch to stop on: it is one of the states you were sent to read. Switch, attach, or restore no branch.`
    : `${where}
You must be on branch \`${cycle.branch}\` — confirm with \`git branch --show-current\`; if it differs, STOP and report.`;
}

function cycleContract(cycle, role) {
  const contracts = cycle.contracts || {};
  return contracts[role] || cycleDefaultContract(cycle, role);
}

function cycleItemsBlock(cycle) {
  const items = cycle.scope && Array.isArray(cycle.scope.items) ? cycle.scope.items : [];
  return items.length ? `\n## Work items (verbatim)\n\n${JSON.stringify(items, null, 2)}\n` : "";
}

function cycleFindingsBlock(findings) {
  if (!findings) return "";
  const parts = [];
  if (Array.isArray(findings.carried) && findings.carried.length) {
    parts.push(`### Findings carried forward — the previous pass gave these NO single valid disposition. Dispose EVERY one now, exactly one disposition each, echoing its \`id\` as \`findingId\`.\n\n${JSON.stringify(findings.carried, null, 2)}`);
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

// The deviations standing after the previous pass, shown to every later pass so
// the result field can describe the FINAL state instead of latching: a loop that
// carried a round's flag straight into its final result reported a deviation
// rounds after the work had conformed, sending a maintainer to "restore"
// something already present. Restating is what makes replacing safe — a pass
// that omits one is CLAIMING it no longer stands, and the cycle keeps it
// standing until a round passes over that claim. The match is by exact text,
// which is why the block asks for a VERBATIM restatement: a reworded one is
// indistinguishable from a drop plus a new deviation, so a re-punctuation would
// cost a round, or ship the same deviation twice at the top of a PR body.
function cycleDeviationsBlock(deviations) {
  if (!deviations || !deviations.length) return "";
  return `\n## Deviations from LOCKED decisions standing after the last pass (verbatim)\n\nRestate in your \`deviations\`, VERBATIM, every one that STILL stands once this pass is done, and leave out only one that genuinely no longer does (say in \`summary\` what closed it): the cycle's result describes the FINAL state, not the history. Copy each one's text exactly — the cycle matches these by exact text, so a reworded restatement reads as a drop plus a brand-new deviation. Leaving one out is a CLAIM, not an effect — it keeps standing, and this round's reviewer is shown the claim beside it, until a round passes over it; a claim you make on the final confirmation pass earns one more round rather than ending the cycle undecided. Do NOT conform a deviation away to shorten this list — report, don't correct; the maintainer ratifies it or asks for conformance, and has ratified one and reversed their own earlier decision before.\n\n${JSON.stringify(deviations, null, 2)}\n`;
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
  const tierLine = cycleValidationTier(cycle, state) === "delivery"
    ? `DELIVERY TIER — this pass can be the cycle's last, so validate the FINAL state with the full applicable sanity set: lint, typecheck, build, tests, whichever this repository has. The cycle may not conclude or publish on less, and nothing downstream re-runs it. Two bounded exceptions, and no others: a completed run whose ONLY failures carry the evidenced-unrelated disposition below counts as this pass, with those failures documented for the maintainer; and the pass survives that rule's record-only follow-up commit (the flake task file, plus any PR-body or summary note recording what this run surfaced). Any other change committed after the run voids the pass and reruns the tier — prose here carries behavior (a prompt's text, a config or contract expressed as text), and no later check exists to catch what a wider tolerance would admit.`
    : `ROUND TIER — the cheapest signal that catches what YOU changed: typecheck/lint for ordinary code edits, targeted tests for touched behavior, and no build at all where this round's diff holds no executable change (comments, prose, docs). When in doubt about blast radius run more, not less, and always build a round touching build configuration, dependencies, or generated contracts. Intermediate pushes the assignment mandates for durability are not delivery events and never raise this tier. Say in \`summary\` what you actually ran: this round's reviewer is told the tier and will not block on a heavier suite it did not cover.`;
  const closeOutLine = cycle.closeOut === "on"
    ? `\n- TRIVIAL-ROUND CLOSE-OUT is granted for this cycle (the invoker's bounded discretion, distinct from \`light\`): where this round's REMAINING findings are exclusively NON-SEMANTIC — wording, typos, comment phrasing, formatting; nothing touching behavior, logic, or the meaning of an acceptance criterion — and you FIXED every one of them, list ONLY those non-semantic edits in \`closeOutEdits\` and the cycle may conclude without another reviewer round. Ordinarily the WHOLE pass diff must be those non-semantic fixes. The SOLE exception is an exact FINAL diagnosis-only record commit required when this pass's DELIVERY run hits a failure the unrelated-flake rule defers: put that failure and its record in \`flakeRecord\`, leave the record itself OUT of \`closeOutEdits\`, and you may still OFFER the close-out. Your \`flakeRecord\` does not certify or broaden the exception: the cycle independently reads the diff and measures the final commit and its actual parent to decide whether that exact suffix qualifies. Every finding still gets its explicit disposition; the offer never swallows one — and a \`declined\` or \`escalated\` disposition anywhere on this pass forfeits the offer outright, since that claim is the next fresh reviewer's to adjudicate and leaves NOTHING in the diff for the check below to see. Offer it on the merits only: any other executable, behavioral, or semantic change anywhere in the pass diff, however it got there or how \`flakeRecord\` describes it, forfeits the close-out and buys a normal round — and the independent read checks your whole pre-suffix claim back the other way, against the \`fixed\` dispositions as well as the list, so an empty fixes portion, an edit you list that the fixes portion does not carry, or a finding you report \`fixed\` that the fixes portion holds no change for, forfeits it too. Offering it is offering to CONCLUDE the cycle, so run the DELIVERY tier over the final state as well — the close-out skips the re-review, never that gate.`
    : "";
  return `You are the fixer for one review cycle (branch \`${cycle.branch}\`, review base \`${cycle.base}\`, artifact type ${cycle.artifactType}).

## WORKTREE CONTRACT (do this before anything else)

${cycleContract(cycle, "fixer")}

${CYCLE_DESTROY_BOUNDARY}

Read the repository's agent-context files (\`AGENTS.md\` / \`CLAUDE.md\`) first for conventions.

${roundIntro}

## Assignment

${scope.instructions || "Address the work items below."}
${cycleItemsBlock(cycle)}${cycleFindingsBlock(state.findings)}${cycleOpenQuestionsBlock(state.openQuestions)}${cycleDeviationsBlock(state.deviations)}
## Rules

- ${artifactLine}
- Commit at logical milestones, and validate at THIS PASS'S TIER (code artifacts). ${tierLine}${closeOutLine}
- ${CYCLE_FLAKE_POLICY}
- A sweep ("fix this pattern everywhere") is ENUMERATED, never asserted: return the explicit search space with a per-item verdict, and claim a completed sweep in a commit message only where you enumerated that space. This round's reviewer redoes the enumeration rather than spot-checking yours.
- ${CYCLE_COMMENT_DISCIPLINE}
- ${CYCLE_CARRIED_CLAIMS}
- ${CYCLE_FINISH_IN_TURN} ${CYCLE_NO_SELF_PEER}
- If you must deliver something other than a decision the maintainer LOCKED, do not silently conform or correct: report it in \`deviations\` — what you delivered instead and the constraint that forced it — and restate it VERBATIM on every later pass while it stands. The cycle surfaces it for the human (report, don't correct), who ratifies it or asks you to conform; it buys no slack in the meantime, since completeness, tests, and regressions are graded exactly as strictly.
- Every \`escalated\` disposition gets an \`openQuestions\` entry in the schema's pinned format, under an id no earlier pass used (re-using one reads as a re-report of that pass's question, which the cycle keeps instead of yours), with authoritative artifact pointers (file:line, refs) — never paraphrase — and its \`questionId\` back-reference — which must name a question this cycle carries LIVE (the one you just raised, or one an earlier pass raised that no retirement has claimed); an absent, empty, or settled id names no decision the maintainer will be asked to make and comes back to the next pass as a disposition error. Raise a question only for a decision still open: a \`fixed\` or \`declined\` disposition that SETTLES a still-live question from an EARLIER pass names that question's \`id\` in \`retiresQuestionIds\` instead (only those two dispositions retire; a question this pass raises cannot also be retired by it; and retiring an id the cycle does not carry open from an earlier pass comes back to the next pass as a disposition error).
- Before returning, the worktree MUST be clean AND idle: \`git status --porcelain\` empty with every intended change committed, and no Git operation in progress — check \`git rev-parse --git-path rebase-merge\` and \`rebase-apply\` for an existing path, plus \`MERGE_HEAD\`, \`CHERRY_PICK_HEAD\`, \`REVERT_HEAD\`, \`BISECT_LOG\` (a tree left mid-rebase or mid-cherry-pick can print empty porcelain). Set \`clean\` and \`finalSha\` accordingly; either condition failing is resolved or reported as a \`blocker\`, never handed to review. The cycle MEASURES the same worktree itself the moment your packet returns, through a turn that is told nothing about your pass — so \`clean\` is checked, not taken, and a reading that contradicts it costs the pass. Report what is true rather than what ends the round.
- Pushing is governed by the assignment above; do nothing PR-side, and do NOT use the \`TaskCreate\`/\`TaskUpdate\`/\`TaskList\` tools.

Return the structured packet, including \`workReport\` per the assignment's per-item contract when it defines one.`;
}

function cycleReviewChecks(artifactType, tier) {
  if (artifactType === "prose") {
    return `This is a PROSE artifact (a drafted task file or document); there is no build to run. Check verbiage, scoping, internal consistency, and the repository's house conventions — for task files, the documented numbering style (see the tasks folder's AGENTS.md where present). Read each drafted file in full.`;
  }
  // The build-first rule applies AT the tier the orchestrator stated, not
  // unconditionally: told "round tier", a reviewer must not block on a suite
  // this round deliberately did not run; told nothing, it runs the full set.
  // Only the ROUND tier is opt-in, and the default is that way round on
  // purpose: an unstated tier is what a renderer with no cycle behind it would
  // leave, and no shipped caller is in that position today — every one states
  // its tier — so the default is purely defensive, and the fail-safe answer for
  // a renderer whose pass could be the last thing before publication is the
  // heavier suite, never the cheaper one.
  const tierLine = tier === "round"
    ? `the ROUND tier — the cheapest signal that catches what this round's diff changed (typecheck/lint for ordinary code edits, targeted tests for touched behavior, and no build at all where the diff holds no executable change), so do NOT block on a heavier suite this tier does not run; when in doubt about blast radius run more, not less, and always build where the diff touches build configuration, dependencies, or generated contracts`
    : `the DELIVERY tier — the full applicable sanity set (lint, typecheck, build, tests, whichever this repository has), because the cycle concludes on this state`;
  if (artifactType === "decision") {
    return `This is an APPLIED-DECISION diff. Verify the diff implements exactly the locked option and nothing beyond it, then do the quality pass (logic, error handling, edge cases, dead code, consistency, duplication, type safety) on the touched files. ${CYCLE_COMMENT_REVIEW} Run the build/type-check first at ${tierLine}; a failure at that tier is an automatic blocker. ${CYCLE_FLAKE_REVIEW}`;
  }
  return `This is a CODE artifact. Run the build/type-check FIRST at ${tierLine}; a failure at that tier is an automatic blocker (\`pass: false\`). ${CYCLE_FLAKE_REVIEW} Check every acceptance criterion the work items state against the actual code, then do the quality pass (logic, error handling, edge cases, dead code, consistency, duplication, type safety) on the touched files. ${CYCLE_COMMENT_REVIEW}`;
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
  // The reviewer's half of report-don't-correct: the maintainer rules on a
  // deviation, so the review adds the two things that decision needs — whether
  // an in-spec route existed, and a recommendation — without conforming it away
  // and without grading the rest of the work any more gently for it. Asked for
  // in prose alone it was optional in fact: a schema-valid `{pass: true,
  // issues: [], notes: ""}` passed a round carrying a deviation, and the result
  // then claimed a judgment nobody had made. So it is a STRUCTURAL field the
  // round is gated on, one entry per deviation that still stands.
  const deviationDrops = Array.isArray(state.deviationDrops) ? state.deviationDrops : [];
  const deviationsBlock = Array.isArray(state.deviations) && state.deviations.length
    ? `\n## Deviations from LOCKED decisions standing on this packet (verbatim)\n\nReturn ONE \`deviationAssessments\` entry for each of these the fixer still restates — every one below except the claimed drops you accept — copying its text VERBATIM into \`deviation\` and giving \`inSpecRoute\` (whether an in-spec route existed, and which) and \`recommendation\` (START with ${CYCLE_DEVIATION_VERDICTS.join(" or ")} — those two verdicts are the whole vocabulary, and a hedge such as "UNSURE" is not one of them — then the one-line reason; opening with both, as in "${CYCLE_DEVIATION_VERDICTS.join(" or ")} — needs investigation", is a refusal to choose and is rejected as one rather than read as the first of them, and otherwise the first word is taken literally as your verdict, so lead with the verdict you mean, or with neither if you cannot choose). This round does not pass while one of them is unassessed: the maintainer decides, and would otherwise be handed the deviation with only the implementer's half of it. A deviation is neither a finding to be corrected away nor a license for unfinished work — grade completeness, tests, and regressions exactly as strictly.\n\n${JSON.stringify(state.deviations, null, 2)}\n${deviationDrops.length ? `\nOf those, the fixer no longer restates the ones below, CLAIMING each no longer stands. Verify that against the committed state exactly as you would a \`declined\`: passing this round is what drops them, so raise one you do not accept as an issue rather than letting it go — a drop you reject is assessed by the round after it, once the fixer restates it.\n\n${JSON.stringify(deviationDrops, null, 2)}\n` : ""}`
    : "";
  // This brief can order a build — at the round's stated tier — so the reviewer
  // needs a destination for its output as much as for its own report — including on the pass that
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

${cycleReviewChecks(cycle.artifactType, state.tier)}

Where the work claims a same-pattern sweep ("fixed everywhere"), REDO the enumeration of its search space yourself rather than spot-checking the enumeration supplied; a sweep asserted with no enumeration behind it is a finding in its own right.

${CYCLE_CARRIED_CLAIMS}

${CYCLE_FINISH_IN_TURN} ${CYCLE_NO_SELF_PEER}

Scope with \`git diff --name-only ${cycleShq(cycle.base)}...HEAD\` — deliberately the CUMULATIVE range, the whole change against \`base\` rather than an incremental since-the-last-round diff, because each round re-reviews the work as a whole. Then read each touched file IN FULL — do not read commit messages or diff content (both anchor you to the fixer's intent); follow references into untouched files when needed. If the diff looks empty despite claimed work, set \`emptyDiffFlag\` and stop — that signals a wrong worktree/branch, not real absence.
${persistLine}${cycle.scope && cycle.scope.reviewInstructions ? `\n## Consumer review criteria (verify each item against these too)\n\n${cycle.scope.reviewInstructions}\n` : ""}${cycleItemsBlock(cycle)}${handedBlock}${dispositionsBlock}${proposedRetirementsBlock}${workBlock}${deviationsBlock}
Return \`pass: true\` only if everything holds and no material issue remains; else \`pass: false\` with numbered, actionable \`issues\`. Be strict but fair — real gaps and functional problems, not style nits. Put pass-worthy caveats in \`notes\` (the cycle disposes them rather than dropping them).`;
}

// The peer invocation happens INSIDE this subagent prompt, never in the
// script (a workflow cannot shell out). Baseline destination: the
// `peer-review-run` helper (schema powbox.peer-review-run/v1) — retained
// pinned raw launch until that helper can carry the codex peer's CONFIGURED
// high-capability model AND expose a documented provider-neutral full-review
// payload (`reviewFile` or `reviewText`) rather than only `artifactDir`. See
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
  // Both peer severities gate and its findings reach the fixer, so a peer that
  // never received the reviewer's comment weighting can keep asking for the
  // narration the fixer is told not to ship. Gated on artifact type exactly as
  // `cycleReviewChecks` gates it: a prose review has no code comments to weigh.
  const commentWeighting = cycle.artifactType === "prose" ? "" : ` ${CYCLE_COMMENT_REVIEW}`;
  const preflightStep = `1. Preflight: already done by the run-level shared preflight before this launch, so skip the probes. An auth/usage error from the launch itself still returns \`unavailable\`.`;
  return `You run the best-effort cross-harness PEER REVIEW stage for one review-cycle round. You launch a read-only \`codex\` review of the committed state, wait for it, and return its result structurally. You NEVER fail this stage: every problem becomes a non-blocking outcome in the schema (\`unavailable\`, \`timeout\`, \`forfeited\`, \`failed\`) with a one-line \`detail\` — never an error, never a refusal to answer. Exactly one condition is not non-blocking, and it travels as a FIELD rather than as an error: a provider process you could not prove dead sets \`teardownFailure\` true, and the cycle stops on it.

## WORKTREE CONTRACT

${cycleContract(cycle, "peer")}

${CYCLE_DESTROY_BOUNDARY}

The peer examines this worktree READ-ONLY; you edit nothing either. The cycle's fresh reviewer is examining the same committed state concurrently — two readers are safe, and the reviewer alone owns builds/execution.

${CYCLE_FINISH_IN_TURN} The retained manual path therefore launches a supervised background peer, waits or times it out, and reaps it inside this turn: you return its outcome, never a promise to report the peer's result later.

## Steps

${preflightStep}
2. Prepare unique per-attempt paths under this cycle's artifact directory: \`round_dir=${cycleShq(`${state.artifactDir}/round-${state.round}`)}\`, \`mkdir -p "$round_dir"\`, with \`prompt_file\`, \`outfile\`, \`stderr_file\`, and \`pid_file\` inside it (suffix \`-attempt2\` on a retry; never reuse a path).
3. Write the peer prompt below VERBATIM to \`$prompt_file\` with a quoted heredoc (\`<<'PEER_PROMPT'\`) — never assemble it through shell interpolation.
4. Two powbox prerequisites remain: the helper's Codex provider still discards the configured high-capability model ([powbox issue #145](https://github.com/Roubtec/powbox/issues/145)), and schema v1 exposes only \`artifactDir\`, not a documented provider-neutral \`reviewFile\` or \`reviewText\` from which every finding can be relayed verbatim. This task-015 rendering therefore retains the pinned raw launch even when the helper is installed; never guess a private artifact filename or parse a provider-specific envelope. Once BOTH prerequisites land, first establish \`artifact_root\` as a unique, private, session-scoped directory outside the reviewed worktree, then run \`peer-review-run --provider codex --worktree "$worktree" --prompt-file "$prompt_file" --artifact-root "$artifact_root" --timeout 260 --effort medium\` once in the foreground inside this Peer stage. Set the caller-side Bash/tool wait to at least 570 seconds but strictly below its roughly 600-second cap: the helper may make two 260-second attempts and spend roughly five seconds reaping each one, leaving at least 40 seconds for setup, parsing, and result emission. Read the documented full-review payload before applying verdict logic. Then keep the hardened manual launch below only as the fallback when \`command -v peer-review-run\` fails. For now launch it with \`nohup\` and record the peer PID directly:

   \`\`\`bash
   worktree="<the worktree path from the contract above>"
   # Pin peer effort per invocation; never changes the container's saved config.
   nohup sh -c '
     pid_file=$1
     shift
     proc_identity() {
       stat=$(cat "/proc/$1/stat" 2>/dev/null) || return 1
       rest=\${stat##*) }
       [ "$rest" != "$stat" ] || return 1
       set -- $rest
       [ "$#" -ge 20 ] || return 1
       pgrp=$3
       session=$4
       shift 19
       start_time=$1
       for value in "$start_time" "$pgrp" "$session"; do
         case $value in ""|0|*[!0-9]*) return 1 ;; esac
       done
       printf "%s %s %s\\n" "$start_time" "$pgrp" "$session"
     }
     identity=$(proc_identity "$$") || exit 125
     printf "%s %s\\n" "$$" "$identity" > "$pid_file" || exit 125
     exec "$@"
   ' peer-launch "$pid_file" \\
     codex exec --sandbox read-only --cd "$worktree" -o "$outfile" \\
       -c mcp_servers={} -c model_reasoning_effort=medium "$(<"$prompt_file")" \\
     < /dev/null > /dev/null 2> "$stderr_file" &
   \`\`\`

   Ordinary stdout is detached to \`/dev/null\`, never merged into \`$outfile\` or \`$stderr_file\`; the \`-o\` artifact remains authoritative. The handoff records the peer PID plus Linux \`/proc/<pid>/stat\` fields 22 (start time), 5 (process group), and 6 (session). In every later Bash call, parse the stat record by stripping everything through its final closing parenthesis plus following space before counting fields (the comm field may contain spaces or \`)\`), require exactly those four positive-decimal handoff values, and compare all three current fields with the persisted values before every \`kill -0\`, TERM, or KILL. Missing or mismatched identity means the original peer is dead; never probe or signal the reused number. On the loose roughly 12-minute timeout, TERM the identity-checked direct provider PID, poll for at most ten seconds, KILL only if the identity still matches, then poll for at most ten more seconds. If it survives, do not retry, do not decide the round, and do not advance: return immediately with \`teardownFailure\` true, outcome \`failed\`, and a \`detail\` naming the surviving PID and the probe that still answered. The cycle stops on that flag for operator intervention; a non-blocking outcome alone would let it keep fixing and publishing while the provider is still alive. Retry ONCE with fresh paths only after confirmed death. Never infer a process group from plain \`nohup … &\`, signal a wait supervisor, use \`pkill -f\`, or replace this with a capped foreground call. If recovering by the unique \`-o\` path is unavoidable, disambiguate \`pgrep -f\` to the codex peer binary after excluding the probing shell and every ancestor: one survivor is alive, none dead, more than one indeterminate and signals nothing; persist that PID's complete identity before handing it to another shell. The identity-checked probe target is the only signal target. Auth/usage errors are \`unavailable\` without retry.
5. Read \`$outfile\` even when the liveness probe has just gone dead: a non-empty artifact with a \`VERDICT:\` line is authoritative. A \`VERDICT: PASS\` line → outcome \`passed\`. A \`VERDICT: ISSUES\` line → outcome \`issues\`, with every numbered finding mapped verbatim into \`findings\` (severity from its \`blocking\`/\`minor\` tag — default \`blocking\` when untagged — plus its \`file:line\` as \`location\` and the finding text as \`claim\`; do not summarize, merge, or rewrite). For either verdict, copy into \`notes\` ONLY valid bullets immediately below the exact \`NOTES (advisory; not necessarily fixes)\` heading: at most three \`- path:line — note\` lines whose note is at most 15 words. Preserve those bullets verbatim; ignore malformed, surplus, or over-budget entries and all other prose, including the verification line and findings. With no valid bullets, return empty \`notes\`. Once the prerequisite-bound helper path is active, apply the same extraction to its documented \`reviewFile\`/\`reviewText\` payload only; never enumerate \`artifactDir\`, guess a filename, or parse a provider-specific envelope. No verdict line, or empty/unintelligible output → \`forfeited\`, with \`reason\` exactly identifying \`empty output\` or \`garbled output\` where that is what happened. A timeout after retry is \`timeout\`; a provider crash or exhausted non-auth retry is \`failed\`. Every outcome carries \`reason\`: the provider diagnostic verbatim where one exists, otherwise the empty string — never omitted, and never invented.

## Peer prompt (write this text to the prompt file verbatim, filling only the placeholders)

You are an independent read-only peer reviewer. Review the committed state of branch ${JSON.stringify(cycle.branch)} against base ${JSON.stringify(cycle.base)} in the current directory (artifact type: ${cycle.artifactType}). Read the actual files; edit nothing; use no network access — all GitHub thread text and diffs needed for the review are embedded here verbatim — and run no builds or tests. Verify the work items and any proposed dispositions below in the committed code; a declined finding must be technically justified.${commentWeighting} ${CYCLE_CARRIED_CLAIMS} Evidence (verbatim):

${JSON.stringify(evidence, null, 2)}

Reason as deeply as needed, then keep the final output compact. Put exactly \`VERDICT: PASS\` or \`VERDICT: ISSUES\` on the first line, then \`VERIFICATION: STATIC (executed no tests)\`. For issues, follow with numbered findings each tagged \`blocking\` or \`minor\`, with \`file:line\` and a one-line rationale. Anything you believe ought to be fixed remains a finding under \`VERDICT: ISSUES\`, even when minor; never demote it to a pass-note. After either verdict, when justified, you may add the exact heading \`NOTES (advisory; not necessarily fixes)\` followed by at most three one-line bullets shaped \`- path:line — note\`, with at most 15 words in each note. These notes are below the fix bar. Omit the section entirely when nothing material falls below that bar.

## Output

Return the structured result: \`outcome\`, \`findings\` (verbatim, tagged), \`notes\`, \`detail\`, \`reason\` copied exactly from the provider/helper reason (the empty string when there is none — never an omitted field), and \`teardownFailure\` (\`false\` on every ordinary path, \`true\` only for the surviving-provider stop above).`;
}

function cyclePeerPreflightPrompt() {
  return `Peer availability preflight for this orchestration run. Run only these read-only probes; launch no review.

${CYCLE_DESTROY_BOUNDARY}

If \`command -v codex\` fails, return \`{ "outcome": "unavailable", "detail": "missing binary" }\`. Otherwise run \`codex login status\`. If it succeeds, return \`{ "outcome": "available", "detail": "" }\`. If it fails and \`CODEX_API_KEY\` is unset, return unavailable with the exact login diagnostic in \`detail\`. If it fails while \`CODEX_API_KEY\` is set, return available because the environment key may authenticate the real invocation. Return only the schema; do not throw or launch codex exec.`;
}

function normalizeCyclePeerNotes(notes) {
  const valid = [];
  for (const line of String(notes || "").split(/\r?\n/)) {
    const bullet = line.match(/^- (\S(?:.*\S)?):([1-9][0-9]*) — (\S(?:.*\S)?)$/);
    if (!bullet || (bullet[3].match(/\S+/g) || []).length > 15) continue;
    valid.push(line);
    if (valid.length === 3) break;
  }
  return valid.join("\n");
}

// The peer stage NEVER fails the round: a dead subagent (null return /
// schema-validation miss), a thrown stage, and every helper-vocabulary outcome
// that is not passed/issues all normalize to a recorded non-blocking outcome.
// The normalization is written as a complement (anything not passed/issues is
// non-blocking), so `failed` — and any future outcome — cannot fall through a
// switch over the named ones.
//
// `teardownFailure` is the single field this carries THROUGH rather than
// absorbing. The outcome beside it still lands non-blocking; the round loop
// reads the flag and stops the cycle, which is what makes the peer prompt's
// surviving-provider stop reachable at all rather than an instruction the
// contract silently discards. A script-synthesized result never sets it — a
// stage that died proves nothing about a provider — so the flag only ever comes
// from a stage that observed the survivor itself.
//
// `findings` and `notes` are gated on a verdict for one shared reason: each is
// copied out of a section the peer prompt writes only under `VERDICT: PASS` or
// `VERDICT: ISSUES`, so a non-verdict outcome arriving with either holds a
// misparse of output the stage itself judged unusable — an unknown outcome
// normalized to `forfeited` keeps whatever came with it — and surfacing those
// bullets would attribute advice to a peer that reached no verdict.
function normalizeCyclePeerResult(res) {
  if (!res || typeof res !== "object") {
    return { outcome: "forfeited", findings: [], notes: "", reason: "", teardownFailure: false, detail: "peer subagent returned nothing (died or failed schema validation); recorded non-blocking", synthesized: true };
  }
  const gating = res.outcome === "passed" || res.outcome === "issues";
  const known = ["passed", "issues", "unavailable", "timeout", "forfeited", "failed"];
  const outcome = known.includes(res.outcome) ? res.outcome : "forfeited";
  return {
    outcome,
    findings: outcome === "issues" && Array.isArray(res.findings) ? res.findings : [],
    notes: gating ? normalizeCyclePeerNotes(res.notes) : "",
    reason: typeof res.reason === "string" ? res.reason : "",
    teardownFailure: res.teardownFailure === true,
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

// A shared fan-out state cannot coordinate preflight with its boolean alone.
// The first caller owns one cheap preflight agent and every sibling awaits that
// promise; once it settles available, all actual peer launches fan out together
// under the independent adaptive throttle. A thrown/schema-invalid result
// clears the latch without marking completion, so one waiter retries while the
// failed owner records a synthesized non-blocking outcome.
async function ensureCyclePeerPreflight(peerState) {
  for (;;) {
    if (peerState.preflighted || peerState.unavailable) {
      return { outcome: peerState.unavailable ? "unavailable" : "available", detail: peerState.unavailableDetail || "" };
    }
    if (peerState.preflightInProgress) {
      await peerState.preflightInProgress.promise;
      continue;
    }
    const latch = {};
    peerState.preflightInProgress = latch;
    latch.promise = (async () => {
      let result;
      try {
        const raw = await agent(cyclePeerPreflightPrompt(), {
          label: "peer-preflight",
          schema: CYCLE_PEER_PREFLIGHT_SCHEMA,
          phase: CYCLE_PEER_PHASE,
        });
        result = raw && (raw.outcome === "available" || raw.outcome === "unavailable")
          ? raw
          : { outcome: "forfeited", detail: "peer preflight returned nothing or failed schema validation", synthesized: true };
      } catch (e) {
        result = { outcome: "forfeited", detail: `peer preflight threw (${e && e.message ? e.message : String(e)})`, synthesized: true };
      }
      if (result.outcome === "unavailable") {
        peerState.unavailable = true;
        if (result.detail && !peerState.unavailableDetail) peerState.unavailableDetail = result.detail;
      } else if (result.outcome === "available") {
        peerState.preflighted = true;
      }
      if (peerState.preflightInProgress === latch) peerState.preflightInProgress = null;
      return result;
    })();
    return latch.promise;
  }
}

// Optimistic session-local adaptive peer throttle. A fan-out owner passes one
// shared object to every embedded cycle; a standalone cycle gets one whose
// unbounded start is observationally a no-op. Calls already in flight are never
// killed, and queued calls wake when completions leave room under the current
// cap. One generation identifies one trouble cluster: a result from a call
// launched before the latest step-down cannot collapse the cap again.
function createCyclePeerThrottle() {
  return { cap: null, generation: 0, inFlight: 0, waiters: [], steps: [] };
}

async function acquireCyclePeerSlot(throttle) {
  while (throttle.cap != null && throttle.inFlight >= throttle.cap) {
    await new Promise((resolve) => throttle.waiters.push(resolve));
  }
  throttle.inFlight += 1;
  return throttle.generation;
}

function cyclePeerTrouble(result) {
  if (!result || result.synthesized) return false;
  if (result.outcome === "timeout" || result.outcome === "failed") return true;
  if (result.outcome !== "forfeited") return false;
  // Reasons are retained verbatim in the result and summary. Classification is
  // deliberately a separate exact mapping: helper diagnostics are a documented
  // wire contract, while broad matches on words such as "empty" or "garbled"
  // can throttle on unrelated forfeitures. The two short forms are emitted only
  // by the retained raw path after it observes the corresponding condition.
  const reasonClass = new Map([
    ["empty output", "empty"],
    ["garbled output", "garbled"],
    ["provider exited 0 with an empty final message", "empty"],
    ["provider exited 0 but produced a malformed/unparseable response", "garbled"],
  ]).get(String(result.reason || ""));
  return reasonClass === "empty" || reasonClass === "garbled";
}

function releaseCyclePeerSlot(throttle, launchGeneration, result) {
  throttle.inFlight = Math.max(0, throttle.inFlight - 1);
  if (cyclePeerTrouble(result) && (throttle.cap == null || launchGeneration === throttle.generation)) {
    const from = throttle.cap;
    const to = from == null
      ? Math.max(2, Math.min(8, throttle.inFlight))
      : Math.max(2, Math.floor(from / 2));
    throttle.cap = to;
    throttle.generation += 1;
    if (from == null || to < from) {
      const step = {
        generation: throttle.generation,
        from: from == null ? "unbounded" : from,
        to,
        inFlight: throttle.inFlight,
        outcome: result.outcome,
        reason: result.reason || result.detail || "",
      };
      throttle.steps.push(step);
      log(`Peer launch throttle stepped from ${step.from} to ${to} after ${result.outcome}${step.reason ? ` (${step.reason})` : ""}; ${throttle.inFlight} call(s) remain in flight.`);
    }
  }
  const waiters = throttle.waiters.splice(0);
  waiters.forEach((resolve) => resolve());
}

function cyclePeerThrottleSummary(throttle) {
  return {
    cap: throttle.cap == null ? "unbounded" : throttle.cap,
    inFlight: throttle.inFlight,
    steps: throttle.steps.slice(),
    sessionLocal: true,
    crossContainerCoordination: false,
  };
}

async function runCyclePeerStage(cycle, state) {
  if (cycle.peer === "off") {
    return { outcome: "disabled", findings: [], notes: "", detail: "peer-opinions=off" };
  }
  const preflight = await ensureCyclePeerPreflight(state.peerState);
  if (preflight.outcome === "unavailable") {
    return { outcome: "unavailable", findings: [], notes: "", detail: preflight.detail || "peer marked unavailable earlier this run" };
  }
  if (preflight.synthesized) {
    return { outcome: "forfeited", findings: [], notes: "", reason: "", detail: `${preflight.detail}; recorded non-blocking`, synthesized: true };
  }
  const launchGeneration = await acquireCyclePeerSlot(state.peerThrottle);
  let result;
  try {
    const res = await agent(cyclePeerPrompt(cycle, state), {
      label: `${cycle.labelPrefix || ""}peer#${state.round}`,
      schema: CYCLE_PEER_SCHEMA,
      phase: CYCLE_PEER_PHASE,
    });
    result = normalizeCyclePeerResult(res);
  } catch (e) {
    // A thrown stage must not drop the round (or, under pipeline(), the item).
    result = { outcome: "forfeited", findings: [], notes: "", reason: "", detail: `peer stage threw (${e && e.message ? e.message : String(e)}); recorded non-blocking`, synthesized: true };
  }
  releaseCyclePeerSlot(state.peerThrottle, launchGeneration, result);
  return result;
}

// The close-out's diff check. Cheap and read-only like the grounding
// spot-check, and for the same reason: it is what lets the cycle skip a whole
// reviewer-plus-peer round. None of its questions lets the fixer's list decide
// anything: question 1 judges the DIFF against the list's claim of triviality
// — the difference between a bounded discretion and a self-granted licence —
// and question 2 judges the pass's whole claim against the diff, which is the
// only thing standing between a `fixed` disposition and a range that never
// received it. That claim is the list AND the `fixed` dispositions, because a
// list is silent about the fix it omits: a pass that skipped one requested fix
// and listed an unrelated tidy-up would otherwise clear a list-only check with
// the skipped fix seen by nobody. Question 3 recognizes one exact suffix: the
// diagnosis-only record committed after the delivery run. The check, not the
// pass, identifies that suffix and names its exact range; all preceding hunks
// remain subject to the original non-semantic and completeness rules.
function cycleCloseOutPrompt(cycle, state) {
  const fixes = Array.isArray(state.fixes) ? state.fixes : [];
  return `Trivial-round close-out check, read-only. The cycle is about to conclude WITHOUT another reviewer round, so this diff would ship unreviewed. Read the commits and \`git diff ${cycleShq(state.passBase)}..HEAD\` in full and answer THREE questions about it. The only split you may make is a valid record-only FINAL commit: if one exists, judge the preceding fixes portion separately and report that exact suffix range. Otherwise judge the whole range as the fixes portion.

1. \`nonSemantic\` — is EVERY hunk in the fixes portion non-semantic: wording, typos, comment phrasing, formatting, with nothing touching behavior, logic, or the meaning of an acceptance criterion? Judge the DIFF, not the list below, and remember that prose can carry behavior here: a prompt's text, a config or contract expressed as text, an instruction an agent follows. Anything else is \`nonSemantic: false\`. An invalid candidate record is not a suffix you may split away, so its hunks remain in this question and ordinarily make it false.

2. \`editsPresent\` — is the fixes portion NON-EMPTY, and does it actually carry everything the pass claims below: every EDIT it listed, and a change answering every FINDING it disposed \`fixed\`? The record suffix cannot stand in for either. An EMPTY fixes portion is \`false\`: nothing landed, so a finding this pass reported \`fixed\` was never fixed at all. A claimed edit you cannot find in that portion is \`false\` too, and so is a \`fixed\` finding it holds no change for — the two lists are checked separately on purpose, because a tidy-up that IS there does not stand in for a requested fix that is not. Extra non-semantic hunks beyond the list are fine here — question 1 already judges those.

3. \`recordOnlySuffix\` — is the FINAL commit a suffix holding NOTHING but the unrelated-flake RECORD: a NEW diagnosis-only follow-up task file carrying the diagnosis already in hand, plus any PR-body or summary note recording what the delivery run surfaced? Judge the commit diff, never an account from the pass (none is provided). Any source, test, config, contract, artifact-under-review, or attempted flake fix in that commit makes this \`false\` and leaves its hunks in questions 1 and 2. When true, return its exact full-OID \`<parent>..<tip>\` as \`recordOnlyRange\`; otherwise return an empty range.

Questions 1 or 2 answered \`false\` cost nothing but the normal reviewer round. Question 3 may be \`false\` when no candidate suffix exists; an invalid candidate still fails question 1 because it cannot be split away.

${cycleContract(cycle, "reviewer")}

${CYCLE_DESTROY_BOUNDARY}

${CYCLE_FINISH_IN_TURN} ${CYCLE_NO_SELF_PEER}

## Edits the pass claims it shipped (verbatim)

${JSON.stringify(state.edits, null, 2)}

## Findings the pass disposed \`fixed\` (verbatim)

${fixes.length ? JSON.stringify(fixes, null, 2) : "(none — this pass disposed no finding `fixed`, so only the edits above are yours to find)"}

Edit nothing.`;
}

// The record-only check: the close-out check's counterpart for the ONE post-run
// commit the delivery tier tolerates. Deliberately given NO list to compare
// against — the close-out has one because a pass OFFERS a close-out, while
// nothing is offered here and a self-report is precisely what must not be able
// to buy this exit. The diff is the whole evidence.
function cycleRecordOnlyPrompt(cycle, state) {
  return `Record-only follow-up check, read-only. The cycle is about to conclude WITHOUT another reviewer round, so this diff would ship unreviewed. Read \`git diff ${cycleShq(state.passBase)}..HEAD\` in full and answer ONE question: does the range hold NOTHING but the unrelated-flake RECORD — a NEW follow-up task file carrying the diagnosis already in hand, plus any PR-body or summary note recording what the delivery run surfaced? Judge the DIFF, and only the diff: you were given no account of it on purpose, and none would settle it. Anything else in the range, however it got there — a source, test, config, or contract edit, an attempt at the failing test itself, an edit to a file the work under review delivers — is \`recordOnly: false\`, which costs nothing but the normal reviewer round.

${cycleContract(cycle, "reviewer")}

${CYCLE_DESTROY_BOUNDARY}

${CYCLE_FINISH_IN_TURN} ${CYCLE_NO_SELF_PEER}

Edit nothing.`;
}

// The packet measurement: porcelain status, operation-state markers, and the
// committed HEAD and parent identities,
// taken by a turn that did NOT produce the packet it judges. A READING, never a
// repair — the posture `wf-address-tasks.js`'s `mainCheckoutStatusPrompt` takes
// for the shared main checkout, and for a sharper reason here: a stage that
// "tidied" this tree would destroy the very evidence the cycle refuses the
// packet on, and an `--abort` or a `reset` could take an unfinished operation's
// work with it. The brief is given no account of the pass, deliberately: the
// self-report is the thing being checked, and a measurer shown `clean: true`
// has been handed the answer it is here to derive. Its contract is the
// `measurer` one for a reason of the same kind: every other role's asserts the
// BRANCH, and the two operations that detach HEAD — a rebase, a bisect — are
// among the states this step is sent to find, so a reviewer's contract would
// order it to stop precisely where the reading matters most.
function cyclePacketCheckPrompt(cycle, state) {
  return `Packet worktree measurement, read-only. Fixer pass ${state.pass} of this review cycle has returned a packet; before the cycle adopts it, MEASURE the worktree it came back from. OBSERVE ONLY — do NOT stage, commit, reset, clean, stash, abort, continue, or edit anything, and do not "tidy" the tree: an unclean or mid-operation worktree is the ANSWER this step exists to return, not a problem for you to solve, and repairing it would destroy the evidence and could take an unfinished operation's work with it.

${cycleContract(cycle, "measurer")}

${CYCLE_DESTROY_BOUNDARY}

${CYCLE_FINISH_IN_TURN} ${CYCLE_NO_SELF_PEER}

Take the worktree-state readings and the independent commit-identity readings in that worktree:

1. \`git status --porcelain -z --untracked-files=all\` (the \`-z\` form leaves paths unquoted, so parsing is unambiguous; \`--untracked-files=all\` lists every untracked FILE rather than collapsing it to its directory). Split the output on NUL and return one \`dirty\` entry per record: the record's 2-character \`XY\` status field, a space, then the repo-relative path — e.g. \` M src/app.ts\`, \`?? notes.txt\`. Keep the \`XY \` prefix verbatim; its first column can be a space. For a rename/copy record git emits the ORIGINAL path as a second NUL-separated field after the current one — keep only the current-path entry and drop that trailing original. An empty array means the tree is clean.

2. The operation state, which the porcelain does NOT show. Check \`git rev-parse --git-path rebase-merge\` and \`rebase-apply\` — each PRINTS a path whether or not it exists, so test the path for existence rather than reading the exit status — plus \`MERGE_HEAD\`, \`CHERRY_PICK_HEAD\`, \`REVERT_HEAD\`, and \`BISECT_LOG\`. Return the marker that showed the operation in \`operation\`, or the empty string when none is in progress. A tree left mid-rebase or mid-cherry-pick prints EMPTY porcelain, so reading 1 alone would call it clean — that is the exact case this step exists for.

3. Resolve \`git rev-parse HEAD\` as \`headSha\`, and HEAD's FIRST PARENT out of HEAD's own commit header — \`git show -s --format=%P HEAD\`, keeping only the first OID it prints — as \`headParentSha\`. Do not derive either from a packet or another agent's prose: this reading is the independent committed-repository proof used to ensure a claimed final one-commit suffix starts at the final commit's ACTUAL parent. Take the parent from that header rather than from \`git rev-parse HEAD^\`, which EXITS NON-ZERO wherever HEAD has no parent to name — a root commit, and every shallow clone, whose boundary commit git grafts parentless. A header that prints no parent is a DEFINITIVE answer, not a failed reading: return \`headParentSha: ""\`, keep \`measured: true\`, and say in \`detail\` that HEAD has no parent here — the packet is then measured and adopted as usual, and only a claim that needs the parent (a one-commit record suffix) is refused for want of proof. If \`git rev-parse HEAD\` itself cannot resolve, return the fields you have and \`measured: false\`.

Report only what YOU measured. You were given no account of what the pass did or claims, on purpose. If a reading cannot be taken at all — git will not run, the path is missing, it is not a checkout — return \`measured: false\` with whatever you have and say in \`detail\` which reading failed and why. Do not fail, and do not guess a clean answer: unknown is a usable result here and a wrong "clean" is not. Edit nothing.`;
}

function cycleGroundingPrompt(cycle, findings) {
  return `Cheap grounding spot-check, read-only. The fresh reviewer PASSED this round; only the peer findings below would gate it. For each, check that its \`file:line\` (or referenced site) exists in the worktree and that the claim is not self-evidently false. Do NOT re-review or judge severity — discard is only for nonexistent references and self-evidently false claims; when in doubt, \`grounded: true\`.

${cycleContract(cycle, "reviewer")}

${CYCLE_DESTROY_BOUNDARY}

${CYCLE_FINISH_IN_TURN} ${CYCLE_NO_SELF_PEER}

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
            ? `A ${d.disposition} disposition claimed to retire open question ${JSON.stringify(qid)}, which this cycle does not carry as a live open question from an EARLIER pass, so the retirement settled nothing. Only a question an earlier pass raised and no retirement has claimed is retirable; one pass cannot both raise and settle a question. Re-issue it against the correct live question id as needed, and dispose this entry (e.g. declined) explaining the stray.`
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
            problem: `An \`escalated\` disposition named questionId ${JSON.stringify(qid)}, which this cycle does not carry as a LIVE open question, so the back-reference points at no decision the maintainer will be asked to make. Re-issue the escalation with an \`openQuestions\` entry under an id no earlier pass used and name THAT id, or dispose what you escalated some other way, and dispose this entry (e.g. declined) explaining the stray.`,
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
//   closeOut ("off" default | "on") — the invoker's grant of the trivial-round
//     close-out, a SECOND bounded discretion beside `light` and a different
//     one: `light` skips the final no-op fixer pass, close-out skips the
//     re-review of a pass whose whole change was non-semantic,
//   contracts: { fixer, reviewer, peer, measurer } — optional per-role
//     preamble text (a worktree-lifecycle consumer passes its own wt-enter
//     contract here). A `measurer` contract states WHERE and nothing more: it
//     must not assert the branch, because the packet measurement is sent to
//     find the states that detach HEAD. Omitted, every role falls back to
//     cycleDefaultContract, which drops that assertion for this role itself,
//   labelPrefix — optional, prefixes agent labels for fan-out consumers,
//   peerState — optional SHARED peer-availability state for a fan-out owner
//     embedding many cycles: hand every cycle ONE object of the shape
//     { preflighted: false, preflightInProgress: null, unavailable: false,
//     unavailableDetail: "" } and the install/login preflight runs once for
//     the whole batch, with concurrent first-wave callers sharing its in-flight
//     latch and an unavailable peer sticking batch-wide (the canonical rule).
//   peerThrottle — optional SHARED adaptive-throttle state created by
//     createCyclePeerThrottle() for a fan-out owner. It starts unbounded,
//     queues only after trouble steps it down, and records every step for the
//     run summary. Omitted, each cycle keeps its own (standalone behavior).
// }
//
// Returns the cycle result contract (lean; bulk prose stays behind artifactDir):
// { verdict: "pass"|"review-cap"|"error", detail, rounds, findingDispositions,
//   openQuestions, deviations, deviationAssessments (the reviewer's half for
//   each deviation still standing — at most ONE entry per deviation, only an
//   entry the passing round could use, and only while no later pass adopted
//   work that round never saw), deviationHistory (only once some
//   pass reported one), workReport, workReportReviewed (whether a reviewer
//     round actually passed over THAT map ON THAT TREE — true on an error or
//     cap exit taken past a passing round, since the confirmation pass can stop
//     the cycle over the very map that just passed, and false where no round
//     ever judged the map being carried out, a later pass having replaced the
//     map or committed a new `finalSha` under it),
//   reviewedWorkReport and reviewedFinalSha (present once ANY round has passed:
//     the most recent map a reviewer DID pass over and the tip it was judged
//     on, reported SEPARATELY from the map being carried out, so a consumer that
//     records a judged map has one to record even where a later pass replaced
//     it — the boolean alone says only that the map leaving is not the judged
//     one, which is the shape that used to lose the judged one outright),
//   proactive, finalSha, notes, reviewerNotes,
//   peerRounds ({ round, outcome, detail, reason } entries, where `detail`
//     appends only the peer prompt's bounded advisory bullets when present,
//     plus teardownFailure on the one round that carried it — a provider the
//     peer stage could not prove dead, which ends the cycle as an `error`
//     rather than degrading to a non-blocking outcome), peerThrottle,
//   discardedPeerFindings, undisposed, outstanding, artifactDir,
//   closeOut (present only when a trivial-round close-out ENDED the cycle:
//     the pass, the range, and the non-semantic edits that shipped unreviewed),
//   recordOnly (present only when the cycle concluded over a delivery run that
//     FAILED on the flake rule's evidenced-unrelated disposition: the pass, and
//     the pass's own `note` of what that run surfaced, which rides here because
//     no later reviewer round exists to carry it in `reviewerNotes`. That note
//     is what the field exists to carry, so no exit publishes the field without
//     one: a concluding pass that reported no record simply carries none, and
//     the record-only exit is refused for the normal reviewer round. Where the
//     record was a post-run COMMIT — the delivery gate's one tolerated one —
//     `range` names it and `verified` is what the diff check found in it; both
//     are EMPTY where this field names no commit of its OWN. So the
//     discriminator a consumer rendering the record reads is exactly that, and
//     no more:
//     whether `recordOnly` names an unreviewed post-run commit, never why it
//     does not),
//   flakeHistory (present once ANY pass reported a `flakeRecord`, and on every
//     exit including the stopped ones, since it is a log rather than a claim
//     about the conclusion: one { pass, note } entry per pass that reported
//     one. `recordOnly` above speaks FOR the conclusion, so it may carry only
//     the concluding pass's record; this is where every other pass's survives),
//   packetChecks (present once any packet was measured, and on every exit: one
//     { pass, measured, dirty, operation, headSha, headParentSha, detail }
//     entry per fixer pass whose
//     worktree the cycle MEASURED, in order. Every packet the cycle adopts has
//     one — the final confirmation pass included, since the measurement runs
//     when the packet RETURNS rather than riding a later reviewer round. A
//     `measured: false`
//     entry is this shape's whole residual: the reading could not be taken, so
//     the packet was REFUSED rather than adopted, and that entry sits under an
//     `error` verdict saying the cycle stopped on an unverified worktree
//     instead of finishing over one),
//   artifactDirAnomalies (present only when a later pass tried
//   to move the artifact directory) }
// NO per-round condition latches into that result: `deviations` is the LAST
// pass's set, not every pass's, so the result describes the FINAL state and
// `deviationHistory` — named as history — is where the rounds live. Dropping
// one is a CLAIM a round must pass over, exactly like a retirement: until then
// it keeps standing in `deviations` (the DROPS still open are `deviations`
// minus the last `deviationHistory` entry), and ANY move the final
// confirmation pass makes to this set — dropping one, or first stating one —
// holds the cycle open for the round that decides it rather than ending it
// undecided, and that round does not pass until the reviewer's in-spec-route
// judgment and RATIFY/CONFORM recommendation for each standing deviation is in
// `deviationAssessments`. So no deviation reaches the maintainer without them,
// and none is taken away without a round accepting that it no longer stands. A
// `pass` verdict carries no open claim; an open one
// is what an `error` or `review-cap` exit leaves behind, neither having reached
// the round that would have settled it. A consumer publishing a PR comment or
// summary from this result leads with `deviations`; they are the maintainer's
// call to ratify or conform, never the loop's.
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
  // The deviations still standing (the last pass's set, plus any drop no round
  // has accepted yet) and the per-pass record. Re-evaluated every pass rather
  // than accumulated: see the result contract above.
  let deviations = [];
  const deviationHistory = [];
  // Every pass's `flakeRecord`, in order, and accumulated for the reason
  // `deviationHistory` is: the conclusion's `recordOnly` speaks for the
  // CONCLUDING pass alone (see the record below), so without this an
  // INTERMEDIATE pass's evidenced-unrelated failure reaches the maintainer
  // nowhere the moment a later pass concludes clean — and that pass's record
  // can be the whole of it, where the evidence cited an already-active task and
  // left nothing to commit.
  const flakeHistory = [];
  // Every measured packet's reading, in order, accumulated for `flakeHistory`'s
  // reason and one of its own: the result's claim is that no packet the cycle
  // adopted went unmeasured, and only a per-pass log lets a consumer see that
  // rather than take it. It is a log, so it rides every exit — the refusals
  // most of all, since the entry that REFUSED a packet is the one worth reading.
  const packetChecks = [];
  // Drops claimed but not yet adjudicated, re-presented to each round until one
  // passes over them — the retirement machinery's rule, for its reason too.
  let pendingDeviationDrops = [];
  const peerRounds = [];
  const discardedPeerFindings = [];
  const artifactDirAnomalies = [];
  let artifactDir = "";
  let packet = null;
  let rounds = 0;
  let fixerPasses = 0;
  let findings = null; // findings block for the next fixer pass; null on round 1
  let confirming = false; // next fixer pass is the final confirmation pass
  // The map a reviewer round actually PASSED over, snapshotted as text BESIDE
  // the tip it was judged on. It answers a question the verdict cannot:
  // `confirming` is set only after a round passed, and the confirmation pass
  // that follows can stop the cycle outright — returning nothing, blocking,
  // coming back on an unclean worktree — leaving `verdict: "error"` over exactly
  // the map that just passed. A consumer deciding what a stopped cycle's map is
  // worth (wf-address-review withholds a disposition record from an UNREVIEWED
  // map) must not read that as "no reviewer ever judged this". Text rather than
  // a latched boolean because a later pass may REPLACE `workReport`, and only
  // comparing the two answers "is the map LEAVING this cycle the one that was
  // judged".
  // The map is not the whole identity, though: a later pass can commit a new
  // `finalSha` while returning the IDENTICAL map, so comparing text alone calls
  // those dispositions reviewed while they now accompany a tree no reviewer
  // read. So the snapshot carries the tip too, and both halves must match.
  // `null` until a round passes, which no packet can match.
  let reviewedPass = null;
  // Peer availability state: `preflighted` (the install/login preflight runs
  // once, never per round) and sticky `unavailable` (an unavailable peer is
  // not re-probed). A fan-out owner embedding many cycles passes ONE shared
  // object as cycle.peerState so the whole batch preflights once and
  // unavailability sticks batch-wide; a standalone cycle gets its own. (The
  // runtime is single-threaded JS, so sibling cycles mutate a shared object
  // safely between awaits.)
  const peerState = cycle.peerState || { preflighted: false, preflightInProgress: null, unavailable: false, unavailableDetail: "" };
  const peerThrottle = cycle.peerThrottle || createCyclePeerThrottle();
  let reviewerNotes = ""; // the latest reviewer's pass-notes (PR-body caveats for consumers)
  // The reviewer's half of report-don't-correct, as accepted by the last round
  // that PASSED. Replaced rather than accumulated, for the reason `deviations`
  // is: it describes the deviations standing now, not every judgment ever made
  // — and emptied again the moment a later pass adopts work that round never
  // saw (the invalidation past the terminal check below).
  let deviationAssessments = [];

  const result = (verdict, detail, extra) => {
    // An assessment travels only beside the deviation it judges: one whose
    // deviation a later round dropped would re-latch exactly what `deviations`
    // stopped latching (a passing round may volunteer an entry for the very
    // drop it accepts, so this filter still earns its keep beside the
    // invalidation below). A deviation with no entry here reached no round
    // that passed over it in its CURRENT state — an `error` or `review-cap`
    // exit, which ships it standing and unjudged rather than pretending a
    // pre-change judgment still holds.
    const standingAssessments = deviationAssessments.filter((a) => a && deviations.includes(a.deviation));
    const carriedReport = (packet && packet.workReport) || [];
    const carriedSha = (packet && packet.finalSha) || "";
    return {
      verdict,
      detail: detail || "",
      rounds,
      findingDispositions,
      openQuestions,
      deviations,
      ...(standingAssessments.length ? { deviationAssessments: standingAssessments } : {}),
      ...(deviationHistory.some((h) => h.deviations.length) ? { deviationHistory } : {}),
      ...(flakeHistory.length ? { flakeHistory } : {}),
      ...(packetChecks.length ? { packetChecks } : {}),
      workReport: carriedReport,
      // Whether a reviewer round passed over THAT map on THAT tree, not over
      // some earlier one: false before any round finished, false again once a
      // pass replaced the map, false where a pass kept the map and committed a
      // new tip under it, and true on an error/cap exit taken past a passing
      // round. No snapshot at all is the first of those, so it needs no second
      // condition beyond the one that says a round passed.
      workReportReviewed:
        !!reviewedPass && JSON.stringify(carriedReport) === reviewedPass.json && carriedSha === reviewedPass.finalSha,
      // And the judged map ITSELF, beside the tip it was judged on — reported
      // separately from the map the cycle is carrying out, since a later pass
      // may have replaced it. A consumer whose job is to RECORD a judged map
      // (wf-address-review's durable disposition record) otherwise has nothing
      // to record in exactly that case: the boolean says only that the map
      // leaving is not the judged one, so the judged one — with its drafted
      // replies, the expensive half — died with the session that judged it.
      ...(reviewedPass ? { reviewedWorkReport: reviewedPass.workReport, reviewedFinalSha: reviewedPass.finalSha } : {}),
      proactive: (packet && packet.proactive) || "",
      finalSha: (packet && packet.finalSha) || "",
      notes: (packet && packet.summary) || "",
      reviewerNotes,
      peerRounds,
      peerThrottle: cyclePeerThrottleSummary(peerThrottle),
      discardedPeerFindings,
      artifactDir,
      ...(artifactDirAnomalies.length ? { artifactDirAnomalies } : {}),
      ...(extra || {}),
    };
  };

  while (true) {
    fixerPasses += 1;
    const fix = await agent(cycleFixPrompt(cycle, { round: fixerPasses, findings, confirming, artifactDir, openQuestions, deviations }), {
      label: `${lp}fix#${fixerPasses}`,
      schema: CYCLE_FIX_SCHEMA,
    });
    if (!fix) return result("error", `fixer returned nothing on pass ${fixerPasses}`);

    // The evidenced-unrelated delivery-run failure THIS pass reported, if any.
    // Read and LOGGED here — above every error return below, and above the
    // conclusions further down — because `flakeHistory` promises one entry per
    // reporting pass on EVERY exit, and the stopped exits are not the exception
    // to that, and reading the field after those returns would drop it. Only a
    // pass that returned NOTHING has no record to read; every return from here
    // on carries this pass's.
    //
    // The self-report is taken UNVERIFIED, and it buys no exit — no conclusion
    // below is licensed by anything this field says. It can WITHHOLD one: the
    // record-only close skips a round for the sole purpose of carrying this
    // record, so a pass that reported none takes the normal round instead.
    // Read from `fix`, never accumulated — it speaks for the concluding pass,
    // and `flakeHistory` is where every pass's record survives.
    const flakeNote = typeof fix.flakeRecord === "string" ? fix.flakeRecord.trim() : "";
    if (flakeNote) flakeHistory.push({ pass: fixerPasses, note: flakeNote });
    const flakeCarried = flakeNote ? { recordOnly: { pass: fixerPasses, range: "", verified: "", note: flakeNote } } : {};

    if (fix.blocker) return result("error", `fixer blocked on pass ${fixerPasses}: ${fix.blocker}`);
    // Packet hard-check, structural half: a packet is adopted only from a
    // worktree that is both clean AND idle, and a pass that says its own is
    // neither is refused here for free, never silently — redriven or resumed
    // instead. The half that catches a `clean` that is sincere and wrong is the
    // measurement below.
    if (!fix.clean) return result("error", `fixer returned a worktree that is not clean and idle on pass ${fixerPasses} (uncommitted changes, or a Git operation still in progress); refusing to adopt the packet — redrive or resume that pass`);
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

    // The measuring half of the packet hard-check, and the half `fix.clean`
    // cannot be: `clean` is the fixer's word about its own worktree, so the one
    // failure the check exists to contain — a pass returning `clean: true` from
    // a tree still mid-rebase, which prints EMPTY porcelain — passes the
    // self-report unseen. So every packet the cycle ADOPTS is measured by a turn
    // that did not produce it, before anything branches on the packet's
    // SUBSTANCE — its work report, its dispositions, its diff, any conclusion
    // drawn from them. What runs ahead of the measurement is only what costs no
    // agent turn: the free refusals above, which would make measuring an
    // already-refused packet pure waste; the artifact-directory capture the last
    // of those refusals sits in; and this pass's flake record, logged where it
    // is for the reason given there. Each of the three does read a field off the
    // packet — the measurement is not the first line to touch it — but none of
    // them takes up the WORK the packet claims to have done, which is what an
    // unmeasured worktree would poison.
    //
    // Measured HERE rather than folded into the reviewer's round, which would
    // ride an existing turn: a conclusion need have no reviewer round after the
    // pass it concludes on, so a reviewer-borne reading would leave those
    // unmeasured — the final confirmation pass, the cycle's last word, most of
    // all. And on the rounds it did cover
    // it would arrive only after the reviewer and the peer had already been
    // spent on the tree it turns out nobody could trust. One low-effort
    // read-only turn per pass covers every pass through one mechanism, with no
    // exit special-cased and no round spent ahead of the refusal.
    //
    // A reading that cannot be TAKEN is unknown, and unknown refuses the packet
    // exactly as a dirty one does — the one thing it must never do is read as
    // clean. That refusal is this shape's whole residual: an unmeasurable pass
    // stops the cycle on an `error` verdict, whose `packetChecks` entry records
    // `measured: false`, rather than letting it finish over a worktree nobody
    // established the state of.
    const measurement = await agent(cyclePacketCheckPrompt(cycle, { pass: fixerPasses }), {
      label: `${lp}packet#${fixerPasses}`,
      schema: CYCLE_PACKET_CHECK_SCHEMA,
      effort: "low",
    });
    const measured = !!(measurement && measurement.measured === true);
    const measuredDirty = measurement && Array.isArray(measurement.dirty) ? measurement.dirty : [];
    const measuredOperation = measurement && typeof measurement.operation === "string" ? measurement.operation.trim() : "";
    const measuredHeadSha = measurement && typeof measurement.headSha === "string" ? measurement.headSha.trim() : "";
    const measuredHeadParentSha = measurement && typeof measurement.headParentSha === "string" ? measurement.headParentSha.trim() : "";
    const measuredDetail = measurement && typeof measurement.detail === "string" ? measurement.detail.trim() : "";
    packetChecks.push({
      pass: fixerPasses,
      measured,
      dirty: measuredDirty,
      operation: measuredOperation,
      headSha: measuredHeadSha,
      headParentSha: measuredHeadParentSha,
      // A refusal points the maintainer at this entry, so its one line of prose
      // never ships empty: the schema admits `detail: ""`, and a blank one
      // would leave a `measured: false` entry saying nothing about what could
      // not be read. A measurer that said nothing is kept distinct from one
      // that returned nothing at all, since only the first took a turn.
      detail: measuredDetail
        || (measurement ? "the measuring subagent reported no detail" : "the measuring subagent returned nothing (died or failed schema validation)"),
    });
    if (!measured) {
      return result("error", `the worktree behind fixer pass ${fixerPasses} could not be MEASURED, so its \`clean\` self-report is the only account of it and the cycle does not take one; refusing to adopt the packet — redrive or resume that pass (the \`packetChecks\` entry records the unmeasured reading)`);
    }
    if (measuredDirty.length || measuredOperation) {
      const failedConditions = [
        measuredDirty.length ? `not clean (${measuredDirty.length} uncommitted path(s); see the \`packetChecks\` entry for the list)` : "",
        measuredOperation ? `not idle (a Git operation is still in progress, found at ${measuredOperation})` : "",
      ].filter(Boolean).join(", and ");
      return result("error", `fixer pass ${fixerPasses} reported \`clean: true\`, but the cycle measured that worktree as ${failedConditions}; refusing to adopt the packet — redrive or resume that pass`);
    }

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
    // Deviations describe the state AFTER this pass, so the pass's own set
    // replaces the standing one it was shown rather than adding to it — a
    // latched flag reported a deviation rounds after the work had conformed.
    // But a drop is a CLAIM, not an effect: "no longer stands" and "the fixer
    // forgot it" look identical in the packet, so a dropped deviation KEEPS
    // STANDING until a round passes with the claim in view, exactly as a
    // retirement does. Otherwise the final confirmation pass — asked for an
    // empty `dispositions` array — could erase a live deviation on its way out,
    // leaving the one call the loop is not allowed to make recorded nowhere the
    // maintainer reads; the terminal check below is what keeps such a claim
    // from being the cycle's last word.
    // Deduplicated on the way in: the cycle matches deviations by exact text,
    // so two identical entries are ONE deviation twice over, not two. Left as
    // reported they would ride into `deviations` — and from there to the top of
    // a PR body — as a doubled bullet, and count twice toward the set-move
    // quantity below, which is the one place a set is being asked how far it
    // moved rather than merely whether it did.
    const restated = [...new Set(fix.deviations || [])];
    for (const gone of deviations.filter((d) => !restated.includes(d) && !pendingDeviationDrops.includes(d))) {
      log(`fixer pass ${fixerPasses} did not restate deviation ${JSON.stringify(gone)}; it KEEPS STANDING as a claimed drop until a round passes with the claim in view.`);
    }
    // `deviations` is the set this pass was shown, so what it left out is
    // exactly the claim set: a drop the pass restates after all is withdrawn.
    pendingDeviationDrops = deviations.filter((d) => !restated.includes(d));
    // Adding one is the same event in the other direction — a deviation no
    // round has been shown — so both count as ONE quantity: whether this pass
    // moved the deviation set. That keeps the terminal check below a single
    // question instead of a rule that gates drops and lets adds through. No
    // carry-forward is needed: `confirming` is set only after a round PASSED,
    // and that round was shown every deviation standing before this pass, so a
    // pass's own adds are the only ones that can still be unadjudicated.
    const deviationSetChanges = pendingDeviationDrops.length + restated.filter((d) => !deviations.includes(d)).length;
    deviationHistory.push({ pass: fixerPasses, deviations: restated });
    deviations = [...restated, ...pendingDeviationDrops];
    // Accumulate the pass packet field-by-field. A later pass updates what it
    // actually reports, and an explicitly EMPTY field never clobbers a
    // populated one from an earlier pass: schema-driven agents commonly emit
    // every declared property, and the confirming pass is even asked for an
    // empty `dispositions` array — an empty `workReport` (or blank `finalSha`)
    // alongside it would otherwise wipe the per-item report consumers replay
    // (wf-address-review publishes thread replies/resolves from it).
    // The SHA this pass started from — the range a trivial-round close-out is
    // judged on. Captured BEFORE the accumulation below overwrites it, and
    // empty on pass 1, which is also why no close-out can conclude round 1.
    const passBase = (packet && packet.finalSha) || "";
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
    //
    // A MOVE OF THE DEVIATION SET is something left to look at, in either
    // direction. The set moves by OMISSION and by first mention rather than on
    // a disposition — which is why a retirement claim can never reach this
    // check (it rides in `dispositions`, so the array is not empty) while a
    // deviation move otherwise would, ending the cycle with it unadjudicated.
    // Dropping one takes it off the maintainer's list unverified; adding one
    // puts it on that list carrying only the implementer's half of the
    // protocol — no reviewer judgment of whether an in-spec route existed, no
    // RATIFY/CONFORM recommendation. Adding one is not an exotic input either:
    // a pass is told to REPORT a deviation rather than correct it, and a
    // deviation is not a finding, so a confirmation pass that first recognizes
    // one leaves `changed` false and `dispositions` empty by following the
    // contract exactly. The conjunct gives every such claim the same shape: it
    // earns a round, a passing round settles it, and the next confirmation
    // pass — restating the set it was shown — terminates here. One extra
    // round, only where a confirmation pass actually moved the set, and
    // bounded by the same cap check below.
    if (confirming && !fix.changed && (fix.dispositions || []).length === 0 && deviationSetChanges === 0) {
      return result("pass", flakeNote ? "reviewer passed; final confirmation pass disposed nothing new, over a delivery run whose evidenced-unrelated failure cites an already-active follow-up task" : "reviewer passed; final confirmation pass disposed nothing new", flakeCarried);
    }

    // Trivial-round close-out: the second bounded discretion beside `light`,
    // and a different one — `light` skips the final no-op fixer pass, this
    // skips the RE-REVIEW of a pass whose whole change was non-semantic,
    // knowingly amending the rule that anything the final pass fixes buys
    // another reviewer round (which still holds for anything semantic). Only
    // the invoker grants it, and the fixer's offer is not the licence: the
    // diff is judged by a cheap read-only check, and a semantic hunk in it —
    // however it got there — forfeits the close-out for the normal round. It
    // can swallow nothing else either. Every handed finding must already be
    // validly disposed, and every disposition on the pass must be `fixed`: a
    // `declined` or an `escalated` one is a CLAIM the next fresh reviewer
    // adjudicates, and the diff check cannot stand in for that reviewer
    // because neither disposition leaves anything in the diff to look at — a
    // decline dismissing a semantic finding ships as an empty hunk, so a pass
    // fixing two typos beside it would otherwise conclude the cycle with the
    // decline never adjudicated, against this file's own contract that a
    // decline is verified by the next fresh reviewer, never final here. A pass
    // that moved the deviation set or claimed a retirement still owes the
    // round that adjudicates it, so those claims hold the cycle open exactly
    // as they do at the terminal check above.
    const closeOutOnlyFixes = (fix.dispositions || []).every((d) => d && d.disposition === "fixed");
    const closeOutFixes = (fix.dispositions || []).filter((d) => d && d.disposition === "fixed").map((d) => ({ finding: (d && d.finding) || "", detail: (d && d.detail) || "" }));
    if (cycle.closeOut === "on" && passBase && fix.changed && (fix.closeOutEdits || []).length && undisposed.length === 0 && closeOutOnlyFixes && deviationSetChanges === 0 && pendingRetirements.length === 0) {
      const closeOut = await agent(cycleCloseOutPrompt(cycle, { passBase, edits: fix.closeOutEdits, fixes: closeOutFixes }), {
        label: `${lp}closeout#${fixerPasses}`,
        schema: CYCLE_CLOSEOUT_SCHEMA,
        effort: "low",
      });
      const suffixRange = closeOut && typeof closeOut.recordOnlyRange === "string" ? closeOut.recordOnlyRange.trim() : "";
      const suffixReported = !!closeOut && closeOut.recordOnlySuffix === true;
      const suffixMatch = suffixRange.match(/^([0-9a-f]{40}|[0-9a-f]{64})\.\.([0-9a-f]{40}|[0-9a-f]{64})$/);
      const suffixShapeValid = !!closeOut && ((closeOut.recordOnlySuffix === false && suffixRange === "") || (suffixReported && suffixMatch && suffixMatch[1].length === suffixMatch[2].length && suffixMatch[1] === measuredHeadParentSha && suffixMatch[2] === measuredHeadSha && measuredHeadSha === fix.finalSha));
      const suffixPublishable = !suffixReported || !!flakeNote;
      if (closeOut && closeOut.nonSemantic === true && closeOut.editsPresent === true && suffixShapeValid && suffixPublishable) {
        const closeOutFlake = suffixReported
          ? { recordOnly: { pass: fixerPasses, range: suffixRange, verified: (closeOut && closeOut.why) || "", note: flakeNote } }
          : flakeCarried;
        return result("pass", `trivial-round close-out on fixer pass ${fixerPasses}: non-semantic fixes${suffixReported ? " plus the independently checked unrelated-flake record suffix" : ""} concluded the cycle without a further reviewer round`, {
          ...closeOutFlake,
          closeOut: { pass: fixerPasses, range: `${passBase}..${fix.finalSha || "HEAD"}`, edits: fix.closeOutEdits, verified: (closeOut && closeOut.why) || "" },
        });
      }
      log(`fixer pass ${fixerPasses} offered a trivial-round close-out; the diff check ${!closeOut ? "returned nothing" : closeOut.nonSemantic !== true ? "found a semantic change outside a valid record suffix" : closeOut.editsPresent !== true ? "did not find every claimed edit and fix before the record suffix" : !suffixShapeValid ? "returned an invalid record-suffix shape or range" : "found a record suffix but the pass reported no flake note to publish"}, so the normal reviewer round runs.`);
    }

    // Record-only close: the terminal check above, with its one conjunct taken
    // from the packet — `changed` — decided by a read of the actual diff
    // instead. The delivery tier a confirmation pass owes survives ONE post-run
    // commit, the flake rule's diagnosis-only task file and the note recording
    // what that run surfaced; and tiered validation makes the delivery run the
    // first FULL-suite run of most cycles, so the run that surfaces a flake is
    // usually this one. Without this exit that commit is the only thing between
    // the pass and the terminal check: the cycle buys a round told the DELIVERY
    // tier, whose reviewer runs the whole suite, and the confirmation pass
    // after it owes that tier again — three runs of the suite the tolerance
    // exists to spare, plus a reviewer-and-peer round, bought by a commit that
    // adds a queue entry and a note. The pass neither offers this nor is asked
    // about it
    // — a tolerance a fixer could claim would be the evasion route item 2's own
    // evidence requirement exists to close, so a cheap read-only check judges
    // the range, and anything beyond the record forfeits the exit for the
    // normal round.
    //
    // The pass's own note of what the run surfaced rides IN the record, from
    // the same `flakeRecord` the terminal check above carries — one field, one
    // meaning, whichever conclusion the cycle reaches. This exit is one of the
    // conclusions NO reviewer round follows, so the reviewer pass-notes a
    // consumer publishes as PR caveats were written before the failure
    // existed, and the record is the only carrier the note has left. That is
    // what makes item 2's "note the flake in the PR body or batch summary"
    // reachable on the very path item 1 names as the tolerated one. `verified`
    // stays the independent check's line about the diff and `note` is the
    // pass's own account; they are not interchangeable, and the check never
    // sees the note.
    //
    // So the note is a CONJUNCT of the exit, not merely its payload. The
    // tolerance is granted precisely so the failure reaches the maintainer, and
    // the diff check cannot supply it — it is asked about the RANGE and is never
    // shown the packet — so a pass that committed the record while reporting
    // none of it leaves the result nothing to publish: the consumers would
    // render a section announcing a FAILED delivery run under an empty note,
    // which tells the maintainer less than the round this exit skipped would
    // have. `flakeNote` is that structural half, exactly as `fix.changed` is the
    // close-out's, and it settles the exit with no agent call — which is why
    // the check is not run at all without one, and why it gates the CHECK
    // rather than the block: this seam's property that every refusal here says
    // WHY is worth keeping. Refusing costs nothing but the normal reviewer
    // round, and every earlier pass's record still rides in `flakeHistory`.
    if (confirming && fix.changed && passBase && (fix.dispositions || []).length === 0 && deviationSetChanges === 0) {
      const record = flakeNote
        ? await agent(cycleRecordOnlyPrompt(cycle, { passBase }), {
          label: `${lp}record#${fixerPasses}`,
          schema: CYCLE_RECORD_ONLY_SCHEMA,
          effort: "low",
        })
        : null;
      if (record && record.recordOnly === true) {
        return result("pass", "reviewer passed; the final confirmation pass committed only the unrelated-flake record, which its delivery-tier pass survives", {
          recordOnly: { pass: fixerPasses, range: `${passBase}..${fix.finalSha || "HEAD"}`, verified: record.why || "", note: flakeNote },
        });
      }
      log(`fixer pass ${fixerPasses} changed the tree with nothing to dispose; the record-only check ${!flakeNote ? "was not run — the pass reported no record of what its delivery run surfaced, so the exit would publish a failed delivery run with no account of it" : record ? "found more than the flake record" : "returned nothing"}, so the normal reviewer round runs.`);
    }

    // Every pass past that check is adopted work another round must pass over,
    // so the assessments the last passing round accepted stop describing this
    // branch: the fixer has changed it (or its claims) since the round that
    // judged it — even where it restates the same deviation text, which is the
    // deviation still matching, not the packet. Invalidated HERE, before
    // either cap exit below, so no exit ships a pre-change in-spec-route
    // judgment and recommendation beside work no round approved; the round
    // that passes over this work re-records the reviewer's half in full below,
    // since the assessment gate holds a round open while any standing
    // deviation lacks one.
    deviationAssessments = [];

    // Anything else needs a (re-)review — bounded by the cap. This check is
    // reachable at the cap only through a confirmation pass that produced new
    // work: changed content, dispositions of its own, or a move it made to the
    // deviation set — dropping one or first stating one — that no round has
    // adjudicated (a FAILED round at the cap returns below, before another
    // fixer could run and leave never-reviewed changes behind).
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
          note: "final confirmation pass produced work (content changes, dispositions of its own, or a move to the deviation set — a drop, or a newly stated deviation — that no round adjudicated) that could not be re-reviewed within the cap",
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
      tier: cycleValidationTier(cycle, { confirming }),
      proposedRetirements: pendingRetirements,
      peerState,
      peerThrottle,
      deviations,
      deviationDrops: pendingDeviationDrops,
    };
    // The peer launches BESIDE the fresh reviewer — the canonical concurrent
    // launch (the examination-only peer is the protocol's sole same-checkout
    // concurrency exception: the reviewer alone owns builds/execution, and two
    // readers are safe). runCyclePeerStage can neither throw nor block the
    // round, so on any peer problem this degrades to the reviewer's verdict
    // exactly as a sequential launch would — with the one exception it REPORTS
    // rather than throws: a provider it could not prove dead comes back with
    // `teardownFailure`, which stops the cycle below.
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
    const peerRoundDetail = [peer.detail, peer.notes ? `advisory notes:\n${peer.notes}` : ""].filter(Boolean).join("\n");
    peerRounds.push({ round: rounds, outcome: peer.outcome, detail: peerRoundDetail, reason: peer.reason || "", ...(peer.teardownFailure ? { teardownFailure: true } : {}) });
    // The one peer condition that is not non-blocking, checked before anything
    // else this round produced. A provider nobody could prove dead may still be
    // reading the worktree the next fixer would write to, so the cycle stops for
    // operator intervention rather than fixing, concluding, or handing a
    // consumer a state to publish. A peer outcome being best-effort never
    // licenses leaving a process alive — which is why the flag rides beside the
    // outcome rather than being one.
    if (peer.teardownFailure) {
      return result("error", `peer teardown failed on round ${rounds}: ${peer.detail || "a provider process could not be proven dead"} — operator intervention required before this cycle runs again`);
    }
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

    // Deviation coverage, the mirror of disposition coverage: every deviation
    // this pass says still STANDS must carry the reviewer's half — in-spec
    // route and a recommendation that actually reads as one of the two verdicts
    // (`cycleDeviationVerdict`) — before a round may pass over
    // it. A claimed drop is exempt because passing the round is what removes
    // it; a drop the reviewer rejects raises an issue, which fails the round
    // and brings the deviation back to the next one for assessment.
    //
    // Asked only of a round that would OTHERWISE pass, exactly as the grounding
    // spot-check is: a round already failing on findings sends the fixer work
    // it can do, and adding one it CANNOT — the reviewer's own judgment — would
    // make every failed round carrying a deviation cost an extra pass to
    // dispose a finding the next reviewer answers by itself.
    const wouldPass = !!review.pass && peerGating.length === 0 && undisposed.length === 0;
    const assessments = Array.isArray(review.deviationAssessments) ? review.deviationAssessments : [];
    // Keyed by deviation text, the FIRST usable entry winning, because what the
    // round gates on is exactly what it may publish. The gate needs only ONE
    // usable entry per standing deviation, so recording the raw array instead
    // would let a second, hedged entry for the same deviation ride to the
    // maintainer beside the valid one — reinstating in what SHIPS the
    // present-or-absent reading `cycleDeviationVerdict` closed in what is
    // CHECKED. An entry the gate could not use is nobody's half of anything.
    const usableAssessments = new Map();
    for (const a of assessments) {
      if (!a || typeof a.deviation !== "string") continue;
      if (!String(a.inSpecRoute || "").trim() || !cycleDeviationVerdict(a.recommendation)) continue;
      if (!usableAssessments.has(a.deviation)) usableAssessments.set(a.deviation, a);
    }
    const assessed = new Set(usableAssessments.keys());
    const unassessedDeviations = wouldPass ? restated.filter((d) => !assessed.has(d)) : [];
    // Handed to the next fixer as findings of their own, because that is the
    // only channel this loop has back into a round. The fixer cannot supply the
    // reviewer's judgment, so the fix text says outright what it must NOT do:
    // conforming the deviation away to clear the finding is the exact move
    // report-don't-correct exists to prevent.
    const assessmentIssues = unassessedDeviations.map((d) => ({
      category: "criteria-gap",
      location: "locked-decision deviation standing on this packet",
      problem: `This round's reviewer returned no usable \`deviationAssessments\` entry for a deviation that still stands: ${JSON.stringify(d)} — either no entry at all, or one missing the in-spec-route judgment, or one whose \`recommendation\` does not lead with ${CYCLE_DEVIATION_VERDICTS.join(" or ")} (a hedge is not a verdict). It would reach the maintainer carrying only the implementer's half of report-don't-correct — no judgment of whether an in-spec route existed, no RATIFY/CONFORM recommendation.`,
      fix: "Do NOT conform, reword, or drop the deviation to clear this — report, don't correct: restate it VERBATIM as before. Decline this finding on that ground; the next fresh reviewer is asked for the missing assessment.",
    }));

    const roundPassed = wouldPass && unassessedDeviations.length === 0;
    if (!roundPassed) {
      confirming = false;
      findings = {
        carried: undisposed,
        // `id` is spread LAST so the script-assigned, round-scoped id stays
        // authoritative even when an agent's finding object volunteers its own
        // `id` field (coverage matching depends on these exact string ids; an
        // agent-supplied one — a number, say — would be uncoverable).
        reviewer: [...(review.issues || []), ...assessmentIssues].map((f, i) => ({ ...f, id: `r${rounds}-${i + 1}` })),
        reviewerNotes: review.notes || "",
        peer: peerGating.map((f, i) => ({ ...f, id: `p${rounds}-${i + 1}` })),
      };
      // A failed round at the cap stops HERE — no further fixer pass may run,
      // or its changes would land committed but never reviewed.
      if (rounds >= cap) {
        return result("review-cap", `hit the ${cap}-round cap without convergence`, { outstanding: findings });
      }
      continue;
    }

    // The round PASSED, so the map this packet carries is one a fresh reviewer
    // judged, and the tip it carries is the tree that judgment was rendered
    // over. Snapshotted here — the one point in the loop where both are true —
    // and read by `result()` on every exit, the stopped ones included.
    reviewedPass = {
      json: JSON.stringify((packet && packet.workReport) || []),
      workReport: (packet && packet.workReport) || [],
      finalSha: (packet && packet.finalSha) || "",
    };

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
    // The same verdict settles the deviation drops this round was shown: the
    // fresh reviewer saw each claim beside what still stands and passed, so
    // those deviations stop standing. Promoted HERE too, before either terminal
    // pass path, so no exit can drop a deviation no round accepted.
    if (pendingDeviationDrops.length) {
      deviations = deviations.filter((d) => !pendingDeviationDrops.includes(d));
      pendingDeviationDrops = [];
    }
    // And the same verdict accepts the reviewer's half for what still stands —
    // the entries the gate above found usable, at most one per deviation, not
    // the raw array it read them out of. Recorded only on a PASSING round,
    // beside the claims it settles: an assessment from a round that failed
    // judged a packet the fixer has since changed.
    deviationAssessments = [...usableAssessments.values()];

    // Round passed. light mode ends here, recording undisposed remarks as such.
    // It carries the flake record too, and is the exit that needs it MOST:
    // `cycleValidationTier` makes every light-mode pass a delivery-tier pass
    // precisely because light skips the confirmation pass, so light is the mode
    // where the run that surfaces a flake is most likely to be a delivery run —
    // and the reviewer round that just passed is no substitute carrier, since
    // its brief is never shown this pass's `flakeRecord` and its notes were
    // written without it.
    if (cycle.mode === "light") {
      return result("pass", "reviewer passed (light mode: final confirmation pass skipped)", {
        ...flakeCarried,
        undisposed: [review.notes].filter(Boolean),
      });
    }

    // Peer pass-notes remain advisory output in `peerRounds`: they are never
    // fixer input and therefore cannot cause edits or another round.
    confirming = true;
    findings = {
      carried: [],
      reviewer: [],
      reviewerNotes: review.notes || "(no notes — confirm nothing in the passing reports needs acting on)",
      peer: [],
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
// fan-out owner's cross-cycle state the embedding mode exists for. The throttle
// is a separate shared object because availability and launch pressure have
// different lifecycles, though both reset with this orchestration session.
const batchPeerState = { preflighted: false, preflightInProgress: null, unavailable: false, unavailableDetail: "" };
const batchPeerThrottle = createCyclePeerThrottle();

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
    peerThrottle: batchPeerThrottle,
    labelPrefix: `${task.slug}:`,
    contracts: {
      fixer: worktreeContract(task, { mayCreate: true }),
      reviewer: worktreeContract(task),
      peer: worktreeContract(task),
      // WHERE only. The cycle's packet measurement is the one stage sent to
      // find states that detach HEAD, so a branch-asserting contract would
      // stop it before either reading — see `worktreeContract`'s note.
      measurer: worktreeContract(task, { measuring: true }),
    },
    scope: {
      title: task.slug,
      instructions: `Implement the task below to its description and acceptance criteria. The base branch already contains any dependency's work — build on it.${upstream}\n\n${pushLine}\nDo not revert unrelated edits.`,
      items: [{ taskFile: task.path, taskContent: task.content }],
    },
  };
}

// `deviations` are the cycle's still-standing departures from a LOCKED
// maintainer decision (final state, not round history). They LEAD the PR body:
// the maintainer ratifies one or asks for conformance, and a deviation reported
// below a wall of summary is one nobody rules on. `deviationAssessments` is the
// reviewing round's half of that same call — whether an in-spec route existed,
// and a RATIFY/CONFORM recommendation — so it leads with them rather than
// leaving the maintainer the implementer's half alone.
//
// `recordOnly` is the other thing the body must carry, for a related reason:
// the cycle concluded over a delivery run that FAILED, on the flake rule's
// evidenced-unrelated disposition, and the gate that allows that says the
// failures are documented where the maintainer sees them at the PR. The batch
// Summary carries the same record, but the person judging the gap reads the PR.
// Reading the fields off the whole ready result rather than taking each as its
// own parameter is what keeps that list one edit long the next time the cycle
// grows a record worth publishing.
function prPrompt(task, ready, remote) {
  const dev = Array.isArray(ready && ready.deviations) ? ready.deviations : [];
  const assessments = Array.isArray(ready && ready.deviationAssessments) ? ready.deviationAssessments : [];
  const notes = (ready && ready.notes) || "";
  const rec = (ready && ready.recordOnly) || null;
  if (!remote) {
    return `Remote push/PR is unavailable this run. Verify branch \`${task.branch}\` and its commits are intact: \`WT="$(wt-enter ${shq(task.slug)} ${shq(task.branch)})" && git -C "$WT" log --oneline ${shq(task.base)}..${shq(task.branch)}\` shows the work. Return \`opened: false\`, \`pushed: false\`, \`reason: "no remote auth this run"\`. Do not fail.

${DESTROY_BOUNDARY}`;
  }
  const caveats = notes ? `\n\nReviewer caveats to surface in the PR body:\n${notes}` : "";
  const deviationLead = dev.length
    ? `\n\nLEAD the PR body with a "Deviation from a locked decision" section, above everything else, carrying these verbatim — each is the maintainer's to ratify or ask conformance on, so neither correct nor soften one:\n${JSON.stringify(dev, null, 2)}${
        assessments.length
          ? `\n   Carry the reviewing round's assessment of each into that same section, beside the deviation it names, so both halves of the call are read at once — relay \`inSpecRoute\` and \`recommendation\`, do not re-argue or soften one:\n${JSON.stringify(assessments, null, 2)}`
          : `\n   The review cycle recorded no assessment for these, so the section carries the implementer's half only — say so plainly rather than supplying a judgment of your own.`
      }`
    : "";
  const flakeRecord = rec
    ? `\n\nThe cycle concluded over a FAILED delivery run, on the flake rule's evidenced-unrelated disposition${rec.range ? `, and over a final commit (\`${rec.range}\`) no fresh reviewer saw — the diagnosis-only follow-up task that failure earned` : ", and over no post-run commit this record points you at, so cite none"}. Carry a "Delivery-run failure — recorded, not reviewed" section in the body with these verbatim, so the maintainer sees the gap here and decides how to absorb it; do not re-diagnose, soften, or omit it:\n${JSON.stringify({ note: rec.note || "", ...(rec.range ? { rangeCheck: rec.verified || "" } : {}) }, null, 2)}`
    : "";
  return `Open a pull request for branch \`${task.branch}\` against base \`${task.base}\`. Work from this task's worktree: \`WT="$(wt-enter ${shq(task.slug)} ${shq(task.branch)})" && cd "$WT"\` (rerun-safe resolve of the existing worktree; if it errors, STOP and report).

${DEPUTY_FINISH_IN_TURN}

${DESTROY_BOUNDARY}

1. Ensure the branch is pushed: \`git push -u origin ${shq(task.branch)}\` (or \`git push\`).
2. \`gh pr create --base ${shq(task.base)} --head ${shq(task.branch)} --title "<concise title>" --body "<summary>"\`.
   - Reference the task file (${task.path}); don't restate the whole task unless it adds review value.
   - Note tradeoffs / intentional divergences / uncertainties.
3. Capture the URL step 2 printed and assert THAT PR's base by URL: \`gh pr view <pr-url> --json baseRefName\` must report \`${task.base}\`. Address the PR by its URL, never by whatever branch you are standing on — the check must follow the PR you just created. Every read in this step reads the same eventually-consistent API the creation and the repair just wrote, so a base that disagrees once is not proof the repair failed — and is not yet a mismatch to repair: re-read until the answer reports \`${task.base}\` or repeats the same other base — a bounded budget of a few re-reads, held briefly apart, an errored read spending it like a stale one — and set \`baseOk: true\` only from a read that reported \`${task.base}\`. A read still unsettled when that budget is spent, before any repair as much as after one, returns \`opened: false\` WITH the \`url\` and \`baseOk: false\`, with \`reason\` naming the read that did not settle and what it last returned. On a mismatch that settled, repair it in the same breath, \`gh pr edit <pr-url> --base ${shq(task.base)}\`, re-read it under the same rule, and return the base it carried before the repair in \`baseRepaired\`. If the repair command itself fails, the failure alone decides nothing — a \`gh pr edit\` failure can arrive after the server applied the change — so rest the verdict on a read settled AFTER the failure, under the same rule: a settled \`${task.base}\` means the repair landed, so return \`baseOk: true\` with \`baseRepaired\` as above; the same other base settled again means that PR is delivered with the wrong base, not delivered — return \`opened: false\` WITH the \`url\`, \`baseOk: false\`, and a \`reason\` naming the settled base it still carries. If the read-back after a repair — failed or succeeded — kept disagreeing without settling, return \`opened: false\` WITH the \`url\` and \`baseOk: false\` the same way, with \`reason\` naming the read that did not settle and the base it last reported — an unsettled read, not a proven wrong base; a repair the server confirmed makes even a repeated old-base answer that unsettled read, never the wrong-base verdict.
4. If \`gh pr create\` fails BEFORE printing a URL, the PR may exist server-side anyway. If the failure itself names an existing PR's URL (an "already exists" error does), take that URL to step 3 rather than looking anything up. Otherwise, before retrying creation, look it up by the head branch you pushed, in the repository that OWNS the PR — the base repository the creation targeted, never the head repository, where a fork's PR does not live: \`gh pr list --repo <base-repo> --head ${shq(task.branch)} --state open --json url,headRepositoryOwner\`. \`--head\` cannot carry an \`<owner>:<branch>\` form, so require the returned PR's head repository owner to match the head you pushed before trusting the match; then assert its base per step 3. This lookup reads the same eventually-consistent API the creation just wrote, so a lookup that finds nothing is not proof no PR exists — retrying on an answer that merely has not converged is how one branch gets two PRs. Retry creation ONLY on a lookup that finds nothing where nothing-found is trustworthy: the creation failure did not claim the PR exists, AND a re-run of the lookup, held briefly rather than immediate, still finds nothing. Even that held pair closes only the unconverged-lookup window — no answer here proves the failed creation did not open a PR whose success report was lost — so the license is for ONE retry: a retry that fails naming an existing PR's URL goes to step 3 like the first attempt's failure would, and a spent retry that still captured no URL and found no match ends this step at \`opened: false\`, \`pushed: true\`, and \`reason\`, not at another attempt. Where those do not both hold, do not retry — return \`opened: false\`, \`pushed: true\`, and a \`reason\` naming the read that did not settle and what each answer said.${deviationLead}${flakeRecord}${caveats}

Return \`opened: true\` with the \`url\` ONLY if a PR URL exists — from step 2 or step 4's lookup — AND step 3's read-back confirmed its base is \`${task.base}\`, after any repair; set \`baseOk\` to that same fact. If the push succeeded but no PR could be created or found (auth, API, or base-branch error), return \`opened: false\`, \`pushed: true\`, and \`reason\`; ending with neither a captured URL nor a lookup match is that failure, not a delivery. Do not claim a PR that was not created, and do not claim one whose base you did not read back.`;
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

// A qualified local ref and its ordinary branch name identify the same ref.
// Canonicalize that spelling here so discovery and the post-resolution re-scan
// deliberately use the same attribution rule and both can consume it as evidence.
function normalizeBranchName(s) {
  let value = String(s || "").trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      value = value.slice(1, -1);
    }
  }
  return value.replace(/^(?:refs\/)?heads\//, "");
}

function collisionBranchNames(collision) {
  return Array.isArray(collision.branches)
    ? collision.branches.map(normalizeBranchName).filter(Boolean)
    : [];
}

function collisionInvolvesTask(collision, task) {
  const names = collisionBranchNames(collision);
  return names.includes(normalizeBranchName(task.branch)) || names.includes(normalizeBranchName(task.slug));
}

function collisionIsAttributable(collision, taskEntries) {
  const names = collisionBranchNames(collision);
  const reportedNameCount = Array.isArray(collision.branches) ? collision.branches.length : 0;
  const knownNames = new Set(taskEntries.flatMap(({ task }) => [normalizeBranchName(task.branch), normalizeBranchName(task.slug)]));
  // COLLISION_SCHEMA defines a clash as "the two or more branches that each
  // independently added it" — that is a constraint on distinct reported names,
  // not merely on how many task entries happen to match. A single normalized
  // name can equal one task's branch AND a different task's slug, satisfying
  // a two-distinct-task count from one reported string; count distinct names
  // separately so that alias coincidence can't stand in for a second branch.
  const distinctNameCount = new Set(names).size;
  return (
    names.length === reportedNameCount &&
    names.every((name) => knownNames.has(name)) &&
    distinctNameCount >= 2 &&
    taskEntries.filter(({ task }) => collisionInvolvesTask(collision, task)).length >= 2
  );
}

// A non-empty discovery packet is usable only when every reported name belongs
// to this reviewed wave and every entry identifies at least two distinct tasks.
// One malformed or foreign name voids the whole packet and holds the whole wave:
// partial attribution could otherwise deliver an omitted side of a live clash.
// A genuinely empty packet remains the ordinary clean-wave path.
async function discoverWaveCollisions({ ready, wave, defaultBase }) {
  let scanError = "";
  let waveCollisions = [];
  if (ready.length >= 2) {
    phase(`Collision scan (wave ${wave})`);
    const scan = await agent(
      collisionScanPrompt(ready.map(({ task }) => ({ slug: task.slug, branch: task.branch, base: task.base || defaultBase }))),
      { label: `collision-scan:w${wave}`, schema: COLLISION_SCHEMA }
    );
    if (!scan || !Array.isArray(scan.collisions)) {
      scanError = `collision scan failed for wave ${wave}; holding reviewed branches before PR delivery`;
      log(scanError);
    } else if (scan.collisions.length) {
      waveCollisions = scan.collisions.map((c) => ({ ...c, wave }));
      if (!scan.collisions.every((c) => collisionIsAttributable(c, ready))) {
        scanError = `collision scan for wave ${wave} reported a clash with an unknown branch or attributable to fewer than two reviewed branches; holding every reviewed branch before PR delivery — re-run the scan with the exact branch strings from its prompt, then deconflict and re-review`;
        log(scanError);
      } else {
        const heldCount = ready.filter(({ task }) => scan.collisions.some((c) => collisionInvolvesTask(c, task))).length;
        log(`${scan.collisions.length} cross-branch naming collision(s) in wave ${wave}; holding ${heldCount} branch(es) before PR delivery.`);
      }
    }
  }

  const deliverable = [];
  const heldTasks = [];
  const held = [];
  ready.forEach(({ task, result }) => {
    if (scanError) {
      held.push({
        slug: task.slug,
        branch: task.branch,
        status: "collision-scan-error",
        detail: scanError,
        ...cycleCarried(result),
      });
    } else if (waveCollisions.some((c) => collisionInvolvesTask(c, task))) {
      heldTasks.push({ task, result });
    } else {
      deliverable.push({ task, result });
    }
  });

  return { deliverable, heldTasks, held, waveCollisions };
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

${DEPUTY_FINISH_IN_TURN} ${DEPUTY_NO_SELF_REVIEW}

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

Do NOT open any PR and do NOT remove any worktree — the workflow re-scans the refs, re-reviews the branches that re-scan clears, and handles delivery. Return one resolution entry per collision: an empty packet is read as no result at all and holds every branch.`;
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
// `deviationHistory` rides beside `deviations` for the same reason: the cycle's
// `deviations` is by contract the FINAL standing set, so the per-pass record is
// the only place the Summary's reader can see that a pass stopped restating
// one. Present only once some pass reported a deviation. `deviationAssessments`
// rides along too — the reviewing round's in-spec-route judgment and
// RATIFY/CONFORM recommendation, which the PR body leads with and which a task
// that never reached a PR (capped, errored, held) shows only through here.
// `closeOut` and `recordOnly` are ONE class and ride here for one reason: each
// records a cycle that CONCLUDED over something no fresh reviewer saw — the
// close-out's non-semantic edits, and for `recordOnly` a delivery run that
// FAILED on the flake rule's evidenced-unrelated disposition (with the
// tolerated post-run flake commit where the record still names one — "still"
// because the collision guard's re-review empties that pair on a branch it
// clears, see `collisionReviewedRecord`) — so this carrier is the only thing
// between that fact and the maintainer. `recordOnly` also
// carries the pass's `note` of what the delivery run surfaced, which is how
// item 2's PR-body-or-batch-summary record survives the exits that have no
// later reviewer round to write it. `flakeHistory` rides for the half that
// record cannot cover: it speaks for the CONCLUDING pass, so an intermediate
// pass's evidenced-unrelated failure would reach the maintainer nowhere once a
// later pass concluded clean — the batch Summary this carrier feeds is where it
// does. A cycle this workflow
// configures cannot report `closeOut` today — `taskCycleConfig` grants no
// close-out and only the invoker's grant opens that exit — so that conditional
// forwards nothing yet; it is written anyway because the two records are one
// rule, and granting the close-out later then needs no second edit HERE;
// `prPrompt` below renders `recordOnly` and not `closeOut`, so it would still
// need teaching, exactly as `wf-address-review.js`'s twin of this note says of
// its own publish brief.
// Both present only when that exit actually ended the cycle.
// `packetChecks` rides for a reason the others do not have: the cycle's own
// refusal message points the reader at that entry BY NAME ("see the
// `packetChecks` entry for the list"), and the batch Summary this carrier feeds
// is where that refusal is read — dropped, the message promises a list the
// result does not carry. It is also the only place a reader can see that no
// packet the cycle adopted went unmeasured. Present once any packet was
// measured, on every exit including the stopped ones.
// Deliberately NOT forwarded: the cycle result's `notes` (the last pass's
// `summary`). This carrier is applied to the raw cycle result AND to task
// results derived from it, where `notes` already means the reviewer's PR-body
// caveats — one name, two meanings, and the second pass through the carrier
// would silently overwrite the first.
function cycleCarried(result) {
  return {
    rounds: result.rounds,
    openQuestions: result.openQuestions,
    deviations: result.deviations,
    ...(result.deviationAssessments ? { deviationAssessments: result.deviationAssessments } : {}),
    ...(result.deviationHistory ? { deviationHistory: result.deviationHistory } : {}),
    peerRounds: result.peerRounds,
    artifactDir: result.artifactDir,
    ...(result.artifactDirAnomalies ? { artifactDirAnomalies: result.artifactDirAnomalies } : {}),
    ...(result.closeOut ? { closeOut: result.closeOut } : {}),
    ...(result.recordOnly ? { recordOnly: result.recordOnly } : {}),
    ...(result.flakeHistory ? { flakeHistory: result.flakeHistory } : {}),
    ...(result.packetChecks ? { packetChecks: result.packetChecks } : {}),
  };
}

// The correction the collision dispatch's re-review owes the record above.
//
// `recordOnly`'s `range` answers ONE question for a consumer rendering it —
// whether the record names a post-run commit NO FRESH REVIEWER SAW — and the
// cycle's result contract says exactly that, and that the consumer reads
// nothing else off it ("never why it does not"). The cycle answers YES only on
// the record-only exit, correctly: no round of its own follows that exit.
//
// This workflow then adds a stage the cycle has no view of. When the pre-PR
// collision guard's resolver has run over a wave's already-reviewed branches, the
// re-review arm runs a fresh DELIVERY-tier reviewer over the CUMULATIVE range
// (`base...HEAD` — the reviewer brief fixes that scope), so a pass there has
// seen every commit on the branch, the tolerated post-run one included. That
// puts the commit in precisely the light conclusion's position — seen by the
// round that just passed — and leaves the record's `range` asserting the
// opposite of what this workflow just arranged.
//
// So empty the range and the check line that describes it. The `note` and the
// `pass` stay: the delivery run really did FAIL, that is what the gate admitted
// it on, and the maintainer is owed it whoever has since read the commit. What
// goes is only the unreviewed-commit claim, and emptying the pair is how the
// cycle itself already encodes "this record names no post-run commit of its
// own". Nothing new is invented for a consumer to interpret.
//
// Present-only and range-only, so it composes as a spread: a result with no
// record, or one whose record already names no commit, is left exactly alone.
function collisionReviewedRecord(result) {
  const rec = result.recordOnly;
  if (!rec || !rec.range) return {};
  return { recordOnly: { ...rec, range: "", verified: "" } };
}

// The re-review's OWN half of that duty. Inside the cycle a reviewer never
// records a flake — a fixer pass with a `flakeRecord` field runs the delivery
// tier around it — but no fixer pass exists anywhere around this standalone
// pass: its run is the branch's last before the PR opens, so a failure it
// passes over under the flake rule's cited-active-task outcome must come back
// through the verdict or reach the maintainer nowhere. Hence the one delta on
// the reviewer's schema and brief — the recording field, in the schema's
// `required` list exactly as the fixer packet's is and for the same reason: an
// ordinarily omitted field is a schema violation rather than an undisclosed
// failed final run, since the delivering arm admits the branch on `pass` alone
// and the carrier reads omission as no-flake. The empty string stays the
// no-flake value. The carrier below publishes what comes back.
const COLLISION_RE_REVIEW_SCHEMA = {
  ...CYCLE_REVIEW_SCHEMA,
  properties: {
    ...CYCLE_REVIEW_SCHEMA.properties,
    flakeRecord: { type: "string", description: "REQUIRED when your own validation run hit a failure you are passing over as evidenced-unrelated under the flake rule: what failed, the ACTIVE follow-up task you tied it to, and the evidence. Empty otherwise. No pass follows this one, so this field is the maintainer's only notice that this run FAILED." },
  },
  required: [...CYCLE_REVIEW_SCHEMA.required, "flakeRecord"],
};

// The deviations standing on the branch's cycle result are handed in, so the
// one stage that sees the POST-rename tree is the one that judges them. The
// deconfliction renamed a file or an exported symbol on purpose, and a
// deviation's text is the implementer's prose naming what it delivered —
// commonly that same file or symbol — so a brief shown none of them lets the PR
// lead with a deviation naming something the branch no longer contains, under a
// verdict formed against the pre-rename tree.
//
// The block itself is `cycleReviewPrompt`'s, rendered from inside the mirrored
// section and unreachable from out here. It tells the reviewer outright that the
// round does not pass while a standing deviation is unassessed, so showing the
// deviations at all commits this path to that gate — see
// `collisionDeviationCoverage`, which applies it. The addition below only
// restates the CONSEQUENCE this path has and the cycle does not (a hold, not
// another round) and names the staleness this pass exists to catch; the
// restatement itself is out of scope here, since only a fixer may restate a
// deviation and this path deliberately has none.
function collisionReReviewPrompt(task, remote, peerMode, deviations) {
  const standing = Array.isArray(deviations) ? deviations : [];
  return `${cycleReviewPrompt(taskCycleConfig(task, remote, peerMode), { round: 1, packet: null, artifactDir: "", tier: "delivery", deviations: standing })}

One addition to the flake rule above: no pass follows this one, so a failure your own validation run hit and you are passing over as evidenced-unrelated MUST come back in \`flakeRecord\` — what failed, the ACTIVE follow-up task you tied it to, and the evidence; leave it empty otherwise. You commit nothing yourself, so a failure you can tie to no ACTIVE task stays blocking (\`pass: false\`), exactly as that rule says.${standing.length ? `

And one to the deviations block above. Those deviations were written BEFORE the deconfliction rename you are reviewing, so read each against the tree as it now stands: one whose text names a file, path, or symbol the rename moved has gone stale, and a stale deviation is an issue to RAISE (\`pass: false\`, naming the text and what it now says wrongly) — never one to rewrite. You commit nothing here and no fixer follows you; restating a deviation is a fixer's job, not yours. The block's assessment rule holds on this path with a different consequence than it has inside a cycle: leaving a standing deviation unassessed costs no round, because no round follows — the branch is HELD before its PR instead, and a human picks it up. So do not conform, reword, or drop one to clear that gate; assess every one of them, or say why you cannot in \`issues\`.` : ""}`;
}

// The reviewer's half of report-don't-correct on the one pass that runs with no
// cycle around it, and the decision this path owes: an incomplete assessment
// HOLDS the branch.
//
// The alternative was a brief that does not claim the gate, and it is not
// available: the deviations block lives inside the byte-mirrored section, states
// "this round does not pass while one of them is unassessed" as a flat fact, and
// cannot be edited from out here — so a path that showed the deviations and
// declined to enforce would have to contradict its own brief a paragraph later.
// Enforcing also matches every other degraded arm of this dispatch: an answer
// this stage cannot use holds the branch rather than delivering it.
//
// Same usability test as `runReviewCycle`'s — an in-spec-route judgment and a
// recommendation that reads as one of the two verdicts, first usable entry per
// deviation winning — plus one narrowing the cycle applies on its way out rather
// than at the gate: an entry counts only for a deviation that STILL STANDS. The
// cycle's result contract filters its raw list that way before publishing it;
// nothing downstream of this stage filters again, so the filter is here.
function collisionDeviationCoverage(deviations, verdict) {
  const standing = new Set(deviations);
  const entries = verdict && Array.isArray(verdict.deviationAssessments) ? verdict.deviationAssessments : [];
  const usable = new Map();
  for (const a of entries) {
    if (!a || typeof a.deviation !== "string" || !standing.has(a.deviation)) continue;
    if (!String(a.inSpecRoute || "").trim() || !cycleDeviationVerdict(a.recommendation)) continue;
    if (!usable.has(a.deviation)) usable.set(a.deviation, a);
  }
  return { assessments: [...usable.values()], unassessed: deviations.filter((d) => !usable.has(d)) };
}

// Publishes the record the re-review returned. `recordOnly` speaks for the
// branch's last delivery-tier run, which this pass now is, so at the call site
// this record is spread AFTER the corrected one and replaces it; every earlier
// reporting pass's record stays in `flakeHistory`, where this one is appended
// too. The empty `range` pair is the no-commit shape — this pass commits
// nothing — and `pass` is named rather than numbered because no fixer-pass
// number exists for it (no consumer reads the field as a number).
function collisionReReviewFlakeRecord(result, verdict) {
  const note = verdict && typeof verdict.flakeRecord === "string" ? verdict.flakeRecord.trim() : "";
  if (!note) return {};
  const history = Array.isArray(result.flakeHistory) ? result.flakeHistory : [];
  return {
    recordOnly: { pass: "collision-re-review", range: "", verified: "", note },
    flakeHistory: [...history, { pass: "collision-re-review", note }],
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
  const pr = await agent(prPrompt(task, ready, remote), {
    label: `pr:${task.slug}`,
    schema: PR_SCHEMA,
  });

  await agent(cleanupNote(task), { label: `cleanup:${task.slug}` });

  const carried = cycleCarried(ready);
  // A PR that exists but whose base was neither verified nor repaired to the
  // recorded one is its own outcome, not a landed delivery: the diff it shows
  // and the review it collects belong to another branch's work. Tested before
  // the success arm and off `baseOk !== true`, so a PR agent that returns
  // `opened: true` without the read-back its schema requires still reads as
  // unverified rather than as done — the same conservatism as `remote === true`.
  if (pr && pr.url && pr.baseOk !== true) {
    return {
      slug: task.slug,
      branch: task.branch,
      status: "pr-wrong-base",
      prUrl: pr.url,
      recordedBase: task.base,
      pushed: pr.pushed === true,
      reason: pr.reason || "PR base was neither read back nor repaired to the recorded base",
      ...carried,
    };
  }
  if (pr && pr.opened && pr.url) {
    return { slug: task.slug, branch: task.branch, status: "done", prUrl: pr.url, ...(pr.baseRepaired ? { baseRepaired: pr.baseRepaired } : {}), ...carried };
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

// Post-resolution settlement of one wave's held branches: resolve the clashes,
// re-verify, and hand back who may deliver and who stays held.
//
// Neither side of an add/add clash is inherently "first", so a single
// orchestrator-deputy agent — seeing every held branch and its worktree, still in
// place — decides which side to rename and does it: rename the file/symbol,
// regenerate derived files, commit, push. A name that MUST stay identical
// (framework-mandated, externally fixed, or pinned by a task file) is reported
// `blocked` instead of getting an invented divergent name.
//
// Delivery is then decided from a SECOND read-only scan of the refs rather than
// from the resolver's report, because a rename can be reported and only partly
// applied — the file moved but the duplicate export left behind, or one branch
// renamed and its regenerated mirror forgotten. Believing the report would let
// both sides open PRs carrying the very clash this guard exists to stop, against
// the guard's own bias that holding a real conflict beats shipping a wrong
// delivery. The re-scan also re-derives 027's 3+ branch rule at no cost: a scan
// reports a value only where two or more branches still carry it, so a three-way
// clash with one side renamed still names the other two and holds them both.
//
// The resolver's packet is HOLD-ONLY evidence, and that is the whole of what
// this stage reads from it. An absent or empty one holds every branch; a
// `blocked` entry holds the branches its collision covers — the one judgment no
// scan can re-derive, since an imperative name is a fact about the world rather
// than about the refs. Nothing in the packet can release a branch, and nothing
// in it can excuse one from the fresh re-review.
//
// It used to also select WHO owed that re-review, from its own
// `changedBranches`. Three review rounds each found one more decision still
// resting on the packet's self-report, and this one cannot be checked from here
// at all: a resolver that renamed on two branches and named one leaves the
// omitted branch reading as untouched, and a resolver that renamed and reported
// nothing leaves every branch reading that way. So the dispatch stops asking.
// Every branch a cleared clash covered is re-reviewed before it delivers, which
// costs one extra pass per untouched side of a real clash and removes the last
// claim this stage took on trust. The two checks on a held branch stay separate
// and both must pass; the re-review runs the ordinary per-task reviewer brief,
// which carries no cross-branch context and so cannot stand in for collision
// proof, exactly as the re-scan carries no per-branch judgment and cannot stand
// in for the review.
async function settleWaveCollisions({ heldTasks, waveCollisions, wave, defaultBase, remote, peerMode }) {
  const deliverable = [];
  const held = [];
  if (!heldTasks.length) return { deliverable, held };

  const involves = collisionInvolvesTask;
  const relatedFor = (task) => waveCollisions.filter((c) => involves(c, task));

  phase(`Collision resolve (wave ${wave})`);
  const resolution = await agent(
    resolveCollisionsPrompt(
      heldTasks.map(({ task }) => ({ slug: task.slug, branch: task.branch, base: task.base || defaultBase })),
      waveCollisions,
      remote
    ),
    { label: `collision-resolve:w${wave}`, schema: RESOLUTION_SCHEMA }
  );
  // An EMPTY array answers exactly as no packet at all, deliberately rather than
  // by the accident that `[]` is truthy: the resolver's brief is "one entry per
  // collision", this stage runs only with collisions in hand, so a packet with no
  // entry at all has reported on nothing — and would also have dropped any
  // `blocked` refusal it made on the way. Emptiness is the whole test, and a
  // non-empty packet's `collision` names are read only for the `blocked` holds
  // below: a refusal naming a collision this stage cannot match is a clash nobody
  // deconflicted, so the re-scan still names it and holds it either way.
  const resolutions = resolution && Array.isArray(resolution.resolutions) && resolution.resolutions.length ? resolution.resolutions : null;

  const blockedNames = new Set();
  if (resolutions) {
    for (const r of resolutions) {
      if (r.action === "blocked" && r.collision) blockedNames.add(r.collision);
    }
  }
  const collisionBlocked = (c) => blockedNames.has(c.name);

  // The re-derived state, scoped to the branches this wave actually held so the
  // extra agent costs only what the clash costs. Two of them at minimum: a scan
  // over a single branch has no sibling to compare against and returns an empty
  // set for want of one, which would read as "clash gone" on no evidence at all.
  //
  // Two further shapes read as unusable rather than as proof of absence, because
  // each would otherwise clear every held branch off a packet that just reported
  // a surviving clash. A THROW is caught here, unlike the wave-boundary storage
  // probe whose abort widens nothing: an abort at this point discards the
  // deliveries this wave's uncontested branches already earned and leaves the
  // held ones with no result to act on, while this task's degraded path owes
  // them an actionable hold. And an entry naming fewer than TWO of the held
  // branches — `branches: []`, a lone name, or a name this wave cannot attribute
  // to one of its held tasks — is not a clash as COLLISION_SCHEMA defines one,
  // "the two or more branches that each independently added it", so the whole
  // packet is evidence about nobody. Qualified local refs are deliberately
  // attributable here through the shared `normalizeBranchName`; unknown names
  // still void the packet even when the same entry also names two held tasks.
  // Two rather than one is what 027's 3+ branch rule costs: a three-way clash
  // malformed down to a single name leaves the two branches it omits with an
  // empty still-colliding set, and both would deliver still carrying the value.
  let rescanned = null;
  if (resolutions && heldTasks.length >= 2) {
    phase(`Collision re-scan (wave ${wave})`);
    let rescan = null;
    try {
      rescan = await agent(
        collisionScanPrompt(heldTasks.map(({ task }) => ({ slug: task.slug, branch: task.branch, base: task.base || defaultBase }))),
        { label: `collision-rescan:w${wave}`, schema: COLLISION_SCHEMA }
      );
    } catch (e) {
      log(`collision re-scan failed for wave ${wave}: ${e && e.message ? e.message : String(e)}`);
    }
    if (rescan && Array.isArray(rescan.collisions) && rescan.collisions.every((c) => collisionIsAttributable(c, heldTasks))) {
      rescanned = rescan.collisions;
    }
  }

  for (const { task, result } of heldTasks) {
    const related = relatedFor(task);
    const stillColliding = rescanned ? rescanned.filter((c) => involves(c, task)).map((c) => ({ ...c, wave })) : null;

    if (!resolutions) {
      held.push({ slug: task.slug, branch: task.branch, status: "collision-hold", detail: "collision resolver returned no usable result (no packet at all, or one with no resolution entries); branch held before PR delivery — deconflict manually and re-review", collisions: related, ...cycleCarried(result) });
    } else if (related.some(collisionBlocked)) {
      // An imperative shared name still clashes even if this branch was also
      // touched — keep it held for a human/design decision.
      held.push({ slug: task.slug, branch: task.branch, status: "collision-blocked", detail: "shared name must stay identical (imperative); resolver could not deconflict — needs a human/design decision", collisions: related, ...cycleCarried(result) });
    } else if (!stillColliding) {
      held.push({ slug: task.slug, branch: task.branch, status: "collision-hold", detail: "post-resolution collision re-scan established nothing (it failed, returned no usable result, could not attribute every named branch, attributed a clash to fewer than two of the held branches, or fewer than two of the colliding branches were in hand to compare); branch held before PR delivery — re-scan these branches by hand, deconflict what remains, and re-review", collisions: related, ...cycleCarried(result) });
    } else if (stillColliding.length) {
      held.push({ slug: task.slug, branch: task.branch, status: "collision-hold", detail: "the clash is still in the refs after the resolver ran; branch held before PR delivery — rename enough sides that at most one branch keeps the name, regenerate whatever derives from it, and re-review", collisions: stillColliding, ...cycleCarried(result) });
    } else {
      // The clash this branch was held for is gone from the refs. Fresh
      // re-review before it delivers — ONE pass of the cycle's reviewer brief,
      // with no fixer loop and no peer stage. This is deliberately not another
      // full cycle: the branch already cleared the complete cycle (peer
      // included) before the collision guard ran, the check is scoped to what
      // the deconfliction did to this branch, and the address-tasks skill
      // specifies exactly this — "re-review each changed task with fresh eyes" —
      // a single-reviewer pass that predates the shared cycle. Hold on failure
      // rather than loop.
      //
      // Every held branch of a cleared clash reaches here, not only the ones the
      // resolver said it changed, because "changed" is a claim this stage cannot
      // check: the resolver had write access to every held worktree, and the
      // clash's disappearance proves only that SOMETHING moved. The skill's
      // "each changed task" is read as the set the resolver could have changed,
      // which is the set it was handed.
      //
      // At the DELIVERY tier, stated rather than inherited. The resolver renamed
      // files and regenerated artifacts AFTER the cycle's own delivery-tier
      // pass, and this is the last check before the PR opens: that post-run
      // change voids the earlier pass and owes the tier again, which this
      // reviewer is the only remaining pass able to run. (An unstated tier
      // renders the delivery tier anyway — that is the fail-safe default — but a
      // gate this load-bearing says so.) The brief, its stated tier, and the
      // `flakeRecord` recording delta live in `collisionReReviewPrompt` /
      // `COLLISION_RE_REVIEW_SCHEMA`.
      //
      // The deviations still standing on the cycle result go with it, and the
      // assessments come back replacing the carried ones: those were formed
      // against the pre-rename tree, and `prPrompt` leads the PR body with them.
      // A deviation the reviewer leaves unassessed holds the branch — the gate
      // its own brief states (`collisionDeviationCoverage`).
      const standingDeviations = Array.isArray(result.deviations) ? result.deviations : [];
      const verdict = await agent(collisionReReviewPrompt(task, remote, peerMode, standingDeviations), { label: `re-review:${task.slug}`, schema: COLLISION_RE_REVIEW_SCHEMA });
      const reviewed = !!(verdict && verdict.pass && !verdict.emptyDiffFlag);
      // The verdict reaches the coverage only through `reviewed`, which is
      // `runReviewCycle`'s own rule for the same field: it records the
      // reviewer's half on a PASSING round alone, "an assessment from a round
      // that failed judged a packet the fixer has since changed". So a failing
      // re-review supplies no assessments here either, whatever it returned.
      const coverage = collisionDeviationCoverage(standingDeviations, reviewed ? verdict : null);
      // The replacement rides EVERY exit past the re-scan, not the delivering
      // one alone: the batch Summary flattens EVERY result's
      // `deviationAssessments` — held records included — into the one list the
      // maintainer reads. So a record naming a deviation unassessed, or handing
      // one back under the reviewer's findings, while still carrying the
      // pre-rename cycle's assessment of it would put an obsolete
      // RATIFY/CONFORM in that list under the very deviation nobody has judged
      // since the rename. Past the re-scan every exit runs on the same
      // conservative bias the re-review above does: which branch the resolver
      // renamed is a claim this stage cannot check, so every branch of a
      // cleared clash is treated as changed and none of them ships a pre-rename
      // in-spec-route judgment and recommendation. Not `runReviewCycle`'s
      // ground for emptying its own — there the fixer demonstrably changed the
      // tree. The hold arms BEFORE that point keep what they carried, no
      // post-rename tree having been established for them.
      // Carrying this pass's usable assessments is what the partial-coverage
      // case needs anyway: the deviations it DID assess get their fresh half,
      // and the rest get none — as does every deviation on a failed pass, left
      // standing and unjudged rather than judged against a tree that is gone.
      // Guarded on there being standing deviations at all, so a branch with none
      // keeps what it carried untouched by a stage that asked about nothing.
      const freshAssessments = standingDeviations.length ? { deviationAssessments: coverage.assessments } : {};
      if (reviewed && !coverage.unassessed.length) {
        // A pass here is a fresh reviewer's read of the whole branch, so it
        // settles the one claim the cycle's `recordOnly` can no longer make —
        // see `collisionReviewedRecord`. Only that claim: the record and its note
        // still ride to the PR body, unchanged otherwise — unless this pass's own
        // run deferred a failure, whose record then supersedes it (see
        // `collisionReReviewFlakeRecord`).
        deliverable.push({ task, result: { ...result, notes: verdict.notes || result.notes, ...freshAssessments, ...collisionReviewedRecord(result), ...collisionReReviewFlakeRecord(result, verdict) } });
      } else if (reviewed) {
        // `freshAssessments` is spread AFTER the carried record on both hold
        // arms, so what a record reports assessed and what it reports
        // unassessed always speak for the same pass.
        held.push({ slug: task.slug, branch: task.branch, status: "collision-hold", detail: "the deconflicted branch passed fresh re-review but left a deviation from a LOCKED decision unassessed, so the PR would lead with the implementer's half of it alone; held before PR delivery — re-review this branch and record the in-spec route and a RATIFY/CONFORM recommendation for each deviation named below, without conforming, rewording, or dropping it", unassessedDeviations: coverage.unassessed, collisions: related, ...cycleCarried(result), ...freshAssessments });
      } else {
        held.push({ slug: task.slug, branch: task.branch, status: "collision-hold", detail: "the deconflicted branch did not pass fresh re-review; held before PR delivery", outstanding: verdict ? verdict.issues : null, collisions: related, ...cycleCarried(result), ...freshAssessments });
      }
    }
  }

  return { deliverable, held };
}

// --- Flag parsing: `peer-opinions=off` must arrive through args (a workflow
// cannot read prose elsewhere) and suppresses the embedded cycle's peer stage
// for every task in the batch. The flag's spelling has ONE definition,
// `PEER_OPINIONS_FLAG` above, shared with the pointer gate that masks it out
// of the argument; the mode is then read from the values that one regex
// captured, so the two sides can never disagree about where the flag begins
// and ends. A second, approximate spelling here would turn a flag this parser
// accepted into a task pointer the gate cannot account for.
// The mode read also follows the pointer gate's boundary reading, shape by
// shape: a flat string or scalar carries no boundaries and is scanned whole,
// while a structured argument toggles the mode only through a leaf that IS
// exactly the flag — the same whole-leaf test, over the same
// `structuredArgLeaves` traversal, that masks that leaf out of the pointer
// list. Flag text embedded in a pointer leaf, or spread across adjacent
// leaves, is pointer content there and stays pointer content here; joining
// the leaves before matching would flip the mode on an invocation whose every
// leaf the pointer side still accounts for as a pointer.
const peerFlagText = args != null && typeof args === "object"
  ? structuredArgLeaves(args).filter((leaf) => PEER_OPINIONS_FLAG_LEAF.test(leaf)).join(" ")
  : String(args == null ? "" : args);
const peerFlagValues = [...peerFlagText.matchAll(PEER_OPINIONS_FLAG)].map((m) => m[1]);
const peerMode = /\boff\b/i.test(peerFlagValues.join(" ")) ? "off" : "on";

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

// Before any task work starts, not at the first probe: an unusable worktree base
// is a bootstrap failure, and discovering it three waves in would waste the whole
// batch. `wtBase` is the only path the storage probes may measure.
const bootWtBase = validateBootstrapWtBase(boot);
if (!bootWtBase.ok) {
  return { error: "Worktree bootstrap returned no usable absolute worktree base; batch not started.", blocker: bootWtBase.blocker };
}
const wtBase = bootWtBase.wtBase;

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
const statusBySlug = new Map();
const results = [];
const throttled = [];
const collisions = [];

try {
  phase("Resolve batch");
  // ONE pointer list, derived from the argument once: the resolver's prompt
  // renders exactly this list and the reconciliation below compares the packet
  // against exactly this list, so the two sides agree by construction — two
  // independent derivations that can disagree is precisely the failure the
  // reconciliation exists to catch. requiredArgPointers keeps a structured
  // invocation's leaf boundaries (a path may contain spaces or commas) and
  // tokenizes only a flat string, which carries no boundaries to keep. The
  // flag parser above reads the same boundaries: only a leaf that IS the flag
  // — exactly what this derivation masks — toggles the peer mode, so flag
  // text embedded in a pointer leaf is pointer content on both sides.
  const batchPointers = requiredArgPointers(args);
  plan = await agent(resolvePrompt(batchPointers), { label: "resolve", schema: PLAN_SCHEMA });
  if (!plan || !Array.isArray(plan.waves)) {
    // A batch that resolves no task is still a batch that terminated with the
    // baseline already taken, so it owes the same report as a delivering one.
    phase("Summary");
    return { error: "Could not resolve task pointers from the argument.", args, resolution: plan && plan.resolution ? plan.resolution : null, mainCheckout: await finalMainCheckoutReport() };
  }
  if (!resolutionAccountsForInputs(plan.resolution, batchPointers)) {
    // The packet dropped or invented a raw pointer relative to the argument
    // itself; an internally consistent partial packet is still lost work.
    phase("Summary");
    return { error: "Could not resolve task pointers from the argument.", args, resolution: plan.resolution, mainCheckout: await finalMainCheckoutReport() };
  }
  if (!planResolutionIsExact(plan)) {
    phase("Summary");
    return { error: "Could not resolve task pointers from the argument.", args, resolution: plan.resolution, mainCheckout: await finalMainCheckoutReport() };
  }
  if (plan.waves.length === 0) {
    phase("Summary");
    if (!emptyPlanIsExplained(plan)) {
      return { error: "Could not resolve task pointers from the argument.", args, resolution: plan.resolution, mainCheckout: await finalMainCheckoutReport() };
    }
    return { batch: args, defaultBase: plan.defaultBase, remote, peer: peerMode, peerThrottle: cyclePeerThrottleSummary(batchPeerThrottle), waves: 0, throttled: [], collisions: [], resolution: plan.resolution, mainCheckout: await finalMainCheckoutReport(), openQuestions: [], deviations: [], deviationAssessments: [], results: [] };
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
  let availBytes = nextAvailBytes(0, boot);
  const widthCapFor = (bytes) => (bytes > 0 ? Math.max(1, Math.floor(bytes / PER_WORKTREE_BYTES)) : Infinity);

  for (let w = 0; w < plan.waves.length; w++) {
    const wave = plan.waves[w];
    if (!Array.isArray(wave) || wave.length === 0) continue;

    // Dependency gating: a task whose in-batch dependency did not finish
    // successfully must NOT run — it would branch from a missing/partial/rejected
    // prerequisite. A dependency is "succeeded" if it landed a PR (`done`) OR, on a
    // no-remote run, was implemented and reviewed locally (`local-only`): its base
    // branch and commits persist in the shared `.git`, so dependents can still
    // build on it. `pr-wrong-base` unlocks too: what that outcome reports is
    // wrong on the PR, not on the branch — the branch is pushed and a dependent
    // stacks on THAT, so holding its whole subtree over a base a maintainer
    // retargets in one command would fail work that is fine.
    // Effective deps = the declared `dependsOn` UNION the prerequisite derived from
    // the `base`→`branch` relationship, so the gate holds even if the plan agent
    // omits a `dependsOn` entry it should have listed.
    const succeeded = (s) => s === "done" || s === "local-only" || s === "pr-wrong-base";
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
    // comment above); `nextAvailBytes` owns what a failed or unmeasurable probe
    // does with the previous reading. A 1-task wave skips the probe: its cap can
    // never throttle (widthCap >= 1).
    //
    // This probe carries no local catch, unlike the two agent stages in this file
    // that do (`runCyclePeerStage`, `finalMainCheckoutReport`) and state their
    // non-blocking warrant; a merely failed probe is not a throw, and is handled
    // above. Why `agent()` throws is not something this repository establishes, so
    // nothing here rests on it: a throw unwinds to the batch-body catch, which
    // returns the terminal statuses reached so far plus the closing cleanliness
    // report, and widens nothing — no wave launches, no worktree is created — so
    // the ENOSPC the throttle exists to prevent stays unreachable by that path.
    if (w > 0 && runnable.length > 1) {
      const probe = await agent(storageProbePrompt(wtBase), { label: `storage-probe:w${w + 1}`, schema: STORAGE_PROBE_SCHEMA, effort: "low" });
      availBytes = nextAvailBytes(availBytes, probe);
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
    const discovery = await discoverWaveCollisions({ ready, wave: w + 1, defaultBase: plan.defaultBase });
    collisions.push(...discovery.waveCollisions);
    const deliverable = discovery.deliverable;
    const heldTasks = discovery.heldTasks;
    for (const held of discovery.held) {
      statusBySlug.set(held.slug, held.status);
      results.push(held);
    }

    const settled = await settleWaveCollisions({
      heldTasks,
      waveCollisions: collisions.filter((c) => c.wave === w + 1),
      wave: w + 1,
      defaultBase: plan.defaultBase,
      remote,
      peerMode,
    });
    deliverable.push(...settled.deliverable);
    for (const h of settled.held) {
      statusBySlug.set(h.slug, h.status);
      results.push(h);
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
  return { error: `Batch aborted: ${e && e.message ? e.message : String(e)}`, batch: args, remote, peer: peerMode, peerThrottle: cyclePeerThrottleSummary(batchPeerThrottle), throttled, collisions, resolution: plan && plan.resolution ? plan.resolution : null, results, mainCheckout: await finalMainCheckoutReport() };
}

phase("Summary");
// Post-batch snapshot of the shared main checkout, compared against the
// baseline (see finalMainCheckoutReport, which the empty-batch return and the
// thrown-stage catch above run too).
const mainCheckout = await finalMainCheckoutReport();
const landed = results.filter((r) => r.status === "done").length;
// A PR whose base could not be verified or repaired is called out beside the
// count rather than folded into it: it needs a retarget before its review is
// worth reading, and the count of landed PRs would otherwise hide that.
const wrongBase = results.filter((r) => r.status === "pr-wrong-base").length;
log(`Batch complete: ${landed}/${results.length} tasks landed a PR.${wrongBase ? ` ${wrongBase} opened against an unverified/wrong base — retarget before reviewing.` : ""}`);
const openQuestions = results.flatMap((r) => (Array.isArray(r.openQuestions) ? r.openQuestions : []));
const deviations = results.flatMap((r) => (Array.isArray(r.deviations) ? r.deviations : []));
// The reviewer's half bubbles up with them, never apart from them: a deviation
// read here without it is one the maintainer would rule on knowing only what
// the implementer said.
const deviationAssessments = results.flatMap((r) => (Array.isArray(r.deviationAssessments) ? r.deviationAssessments : []));
return { batch: args, defaultBase: plan.defaultBase, remote, peer: peerMode, peerThrottle: cyclePeerThrottleSummary(batchPeerThrottle), waves: plan.waves.length, throttled, collisions, resolution: plan.resolution, mainCheckout, openQuestions, deviations, deviationAssessments, results };
