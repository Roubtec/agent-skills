/**
 * wf-address-review — dynamic-workflow form of the `address-review` skill.
 *
 * Work through every UNRESOLVED review thread on one pull request: gather the
 * threads, fix what is right / push back on what is wrong, verify every
 * disposition through the shared review cycle (fresh-eyes reviewer plus a
 * best-effort cross-harness codex peer, bounded by the cycle's round cap),
 * then publish by default (lease-safe push, reply + resolve threads, Summary
 * comment, pings) — a `no-push` run stays local-only and mutates nothing.
 * The re-review pings fire ONLY when the push actually advanced the branch with
 * new commits/rewritten history; a no-op push (nothing new to review) skips them
 * so an automated review -> address -> review loop can terminate.
 *
 * The `ping-contributing` modifier prunes that re-review set further to the
 * bots that brought a NEW finding this round — the disposition schema and the
 * prompts below carry the operative definition — so a multi-bot loop winds
 * down bot-by-bot as each reviewer goes quiet.
 *
 * Invoke as `/dev-skills:wf-address-review [PR#] [rebase on top of <branch>]
 * [no-rebase] [inline] [off-shoot] [no-push] [push] [peer-opinions=off]
 * [ping-codex] [ping-claude] [ping-copilot] [ping-contributing]`.
 *
 * Rebasing onto the freshest base is the DEFAULT, at two delegated points:
 * before the fixing, so the fixer works the code as it will look when merged,
 * and again once the fixes are committed, so the diff a reviewer reads at push
 * time is the change rather than the base's drift. Neither point is run by this
 * script or folded into another agent's job — each is its own subagent under the
 * `review-cycle` skill's "The delegated rebase step" (`rebasePrompt` renders it
 * once for both). Both pin the base to a COMMIT and rebase onto that, which is
 * what makes running two of them safe: nothing to replay is the common outcome.
 * `no-rebase` suppresses both.
 *
 * The pinned OID — the base each rebase actually landed on — replaces the ref
 * NAME as this run's review base, because every range delegated afterwards is
 * taken against it and a remote-tracking name moves under a sibling push. That
 * holds on the opt-out path too: a `no-rebase` run has no rebase report to pin
 * from, so it pins the commit the gather resolved the base ref to. The review
 * base is a commit on every path this script dispatches from.
 * Where the pre-push point replays anything, the passing verdict no longer
 * describes the tree being pushed, so the cycle is re-run over the rebased tree
 * as a re-verification (not a re-triage) and its verdict is the one publication
 * rests on — inside what is left of the cycle's 12-round total, since that cap is
 * a total an invoker may lower and never raise, and this run's `rounds` is its
 * own total across both cycles.
 *
 * Why a workflow rather than a skill
 * ----------------------------------
 * The interesting part of this skill is its control flow: a verify-and-loop
 * cycle with a hard round cap, followed by a conditional publish stage gated on
 * flags. That sequencing is exactly what a workflow expresses as code instead of
 * prose, and the verifier is a textbook fresh-`Agent` spawn.
 *
 * The fix -> review -> fix loop itself is NOT stated here: this workflow nests
 * the canonical cycle (`workflow("wf-review-cycle", ...)`) for its verification
 * loop — roles, gates, disposition rule, best-effort cross-harness codex peer
 * review, and the round cap are all wf-review-cycle's, and this script only
 * supplies the PR-specific scope (triage kinds, per-thread report contract,
 * disposition-verification criteria). Nesting is the right consumption mode
 * here because this pipeline does not fan out; a fan-out owner embeds the
 * cycle's marked section instead (see wf-address-tasks.js). `peer-opinions=off`
 * passes through args into the nested cycle.
 *
 * Workflows have no mid-run user input, so this is structurally the skill's
 * `hands-off` mode: low-stakes ambiguity is decided best-effort by the agents
 * and recorded; high-stakes ambiguity is left open and reported, never guessed.
 * A rebase conflict beyond the delegated step's competence is aborted cleanly,
 * the tree left clean and idle, and the run stops carrying that conflict out as
 * an open question — the hands-off shape of the skill's interactive loop-in.
 *
 * Worktree model
 * --------------
 * This is a SINGLE-PR, strictly SEQUENTIAL pipeline (gather -> fix -> review ->
 * publish) with no fan-out, so the agents deliberately do NOT use
 * `isolation: "worktree"`: every phase works in ONE location, so the fixer's
 * commits are directly visible to the reviewer and the publisher. (Runtime
 * isolation gives each agent a *separate* temporary worktree started from the
 * default branch, which would hide the fixer's commits from the reviewer — the
 * failure the original draft had. The batch front-end role — many PRs at once —
 * is where per-PR isolation belongs, and that must use the explicit
 * `.worktrees/$CONTAINER_NAME/` convention, not runtime isolation; see
 * wf-address-tasks.js and the directory README.)
 *
 * WHICH location is picked rather than fixed, matching the `address-review`
 * skill's "Working location": the gather agent works INLINE in the current
 * checkout when it already stands on the PR head ref (or when the run passed
 * `inline`), and otherwise attaches that branch in an explicit
 * `.worktrees/`-style worktree and reports its absolute path. The one branch
 * other than the head ref this pipeline will work on is a local off-shoot the
 * request NAMES with `off-shoot`; that case is never inferred from the shape of
 * the history, because no test on it can tell an off-shoot cut BEFORE the head
 * from a stacked child cut FROM it — the gather brief's case 1 carries the
 * argument. A hands-off flow has nobody to ask before hijacking the
 * maintainer's checkout, so from any other branch — a detached HEAD included —
 * the worktree is the default rather than the exception, and the main checkout
 * is left free and never required to be clean. The path rides in `pr.worktree` and is handed to the nested cycle
 * and the publisher; because every result echoes the `pr` object, a run that
 * HALTS reports the surviving worktree to the maintainer for free, while a run
 * that FINISHES (published, a local-only pass, or a no-op) gives it back
 * through the reclaim step — which refuses rather than forces, so a tree it
 * declines to remove is reported by path in that result's own note.
 *
 * Runtime notes:
 *  - The script cannot run git/gh/file IO; the gather/fix/review/publish agents
 *    do all of it and hand structured packets back as plain data.
 *  - Fixes are done by a single fixer agent (not fanned out per thread): review
 *    fixes routinely touch the same files, so parallel per-thread fixers would
 *    contend.
 */

// The runtime requires `export const meta = {...}` (a pure literal) as the
// FIRST statement: it is how the script registers as the
// `/dev-skills:wf-address-review` command and what the pre-run approval prompt
// shows. The conditional report phases are not declared; undeclared phase()
// titles get their own group. The "Peer review (codex)" title must stay
// byte-identical to the peer stage's phase string in the nested
// wf-review-cycle (its CYCLE_PEER_PHASE) — a mismatch silently splits the
// progress display into an extra group.
export const meta = {
  name: "wf-address-review",
  description: "Address every unresolved review thread on one PR: fix or push back, verify through the shared review cycle — a fresh-eyes reviewer plus a best-effort cross-harness codex peer review each round (review is cross-harness; peer outcomes never block; bounded round cap) — then publish by default (use no-push for a local-only dry run).",
  whenToUse: "Work through maintainer-vetted review feedback on a single PR hands-off, with cross-harness verification (a best-effort codex peer beside the fresh reviewer). Not for new task batches (wf-address-tasks) or stack rebases.",
  phases: [
    { title: "Gather", detail: "resolve the PR, branch state, and unresolved threads" },
    { title: "Rebase", detail: "delegated rebase onto the freshest base — before fixing, and again before publication" },
    { title: "Fix and verify", detail: "fix/push-back per thread through the nested wf-review-cycle" },
    { title: "Peer review (codex)", detail: "best-effort cross-harness second opinion beside each reviewer round; its outcome never blocks" },
    { title: "Publish", detail: "lease-safe push, thread replies, summary comment, pings" },
    { title: "Summary" },
  ],
};

const PACKET_SCHEMA = {
  type: "object",
  properties: {
    ok: { type: "boolean", description: "False if the run cannot proceed (blocker set)." },
    blocker: { type: "string", description: "Why the run stopped: unidentifiable/unrelated PR, dirty tree, rebase in progress, non-trivial rebase conflict, auth failure. Empty when ok." },
    pr: {
      type: "object",
      description: "Required whenever ok is true — the downstream phases dereference these fields, so populate them all. Required IN FULL on a post-attach BLOCKER too, not in part: the working location is picked only after the PR is resolved, so an `ok: false` packet raised from the attach onwards already knows every field here — `locationMode` and `worktree` above all, because a halt is what KEEPS that worktree standing and this object is the only channel that reports its path. `worktree` names a tree that SURVIVES: the fork arm's rejected landing gives its own back, and reports the field empty. The one packet that omits `pr` is a blocker raised BEFORE the PR is resolved (auth failure, unidentifiable or unrelated PR): it created no worktree and has nothing to report, which is why `pr` is not required at the top level.",
      properties: {
        number: { type: "integer" },
        url: { type: "string" },
        branch: { type: "string", description: "The PR's remote head ref (headRefName) — publication metadata, the push target. May differ from what is checked out." },
        workingBranch: { type: "string", description: "The branch checked out in the WORKING LOCATION (`git branch --show-current` there). Equals branch inline on the PR head ref and always in worktree mode; for a local off-shoot of a merge-pending PR — the case a request selects with the `off-shoot` token, and the only way this pipeline works on a branch that is not the head ref — it differs, and the fixer edits THIS branch, not the remote head ref." },
        locationMode: { type: "string", description: "REQUIRED: exactly `inline` (the work happens in the current checkout) or `worktree` (a worktree was attached for it). There is no default — the caller stops the run on an absent or unrecognized value, because reading one as `inline` would point every later phase at the main checkout, which in worktree mode is not on the PR branch at all." },
        worktree: { type: "string", description: "ABSOLUTE path of the attached worktree in `worktree` mode — required there, since it is where every later phase works. Empty in `inline` mode. It rides in `pr` so that every result echoing the PR object reports a worktree a halted run left standing." },
        base: { type: "string", description: "The PR's `baseRefName`. It is a REF NAME at this stage and nothing more: the rebase phase resolves it (or the requested target) to a commit and the caller replaces this field with that pinned OID, which is what every later delegation names as its review base." },
        baseOid: { type: "string", description: "The full OID that base ref resolves to right now IN THE BASE REPOSITORY — the repository the PR itself is in, freshly fetched, never read through the branch's push remote, which on a cross-repository PR is the head fork. A commit, never a name. REQUIRED. A `no-rebase` run has no rebase report to pin from, so this is the OID it pins as its review base; a rebasing run supersedes it with the OID that rebase landed on. The caller rejects anything that is not a full hex OID on the `no-rebase` path and stops the run." },
        headOid: { type: "string", description: "Expected remote head OID, for the publication lease. Populate from the PR's headRefOid." },
        rebased: { type: "boolean", description: "Whether the branch tip has been rewritten (publish must then use --force-with-lease). Report `false` here — this step performs no rebase; the caller sets it from the rebase phase's own report." },
      },
      required: ["number", "url", "branch", "workingBranch", "locationMode", "base", "baseOid", "headOid"],
    },
    rebaseTarget: {
      type: "string",
      description: "The target named by an explicit `rebase on top of <branch>` token in the request — a branch name or an exact commit, verbatim. EMPTY when the request named none, which is the ordinary case: the rebase phase then targets the PR's own `baseRefName` (this object's `base`). Report the token; do NOT act on it here.",
    },
    reconcile: {
      type: "object",
      description: "What the gather brief's branch reconciliation did. Required whenever ok is true, the off-shoot case included — it reports `not-applicable`. ENFORCED only on a run whose workingBranch equals branch: there the caller stops the run on any outcome but the two that let it continue, an absent report among them.",
      properties: {
        outcome: {
          type: "string",
          description: "`work` (local already carries everything the PR head has), `fast-forwarded` (local was strictly behind and was fast-forwarded onto it), `not-applicable` (workingBranch differs from branch — the local off-shoot case, where reconciliation is skipped entirely), or `unrecognized` (any other branch state: the run stops and the branch goes back to the maintainer). Only `work` and `fast-forwarded` let a run on the PR's own branch proceed.",
        },
        detail: { type: "string", description: "What the two probes saw. MANDATORY for `unrecognized`: both tips and the commits unique to each side, so the maintainer can act on it without re-deriving it." },
      },
      required: ["outcome"],
    },
    items: {
      type: "array",
      description: "Every UNRESOLVED review thread plus any explicitly-included standalone item (issue comment / review summary), verbatim.",
      items: {
        type: "object",
        properties: {
          type: { type: "string", description: "`review-thread` (resolvable, threaded) or `standalone` (a top-level issue/review comment with no resolve state)." },
          threadId: { type: "string", description: "GraphQL review-thread node id — REQUIRED for type `review-thread` (used to resolve). Absent/empty for `standalone`." },
          commentId: { type: "string", description: "Top comment databaseId — REQUIRED for type `review-thread` (used to thread the reply). Absent/empty for `standalone`." },
          path: { type: "string" },
          line: { type: "integer" },
          author: { type: "string", description: "Comment author login. REQUIRED — `ping-contributing` attributes a round's new findings to specific bots by substring-matching this login (codex/copilot/claude), so an empty/absent author silently drops a contributing bot from the re-ping set. Derive it from the same GraphQL `author{ login __typename }` that yields `authorIsBot`; if the author is unavailable (e.g. deleted account) use an empty string — a deleted account is never a live reviewer bot to re-ping, so no attribution is the correct outcome." },
          authorIsBot: { type: "boolean", description: "True if the comment author is a bot / GitHub App. Derive from GraphQL author `__typename` (`Bot`) — NOT from guessing the login; if the author is unavailable (e.g. deleted account), use false, the safe value that keeps the thread open. Drives whether a push-back or deferred thread may be auto-resolved." },
          body: { type: "string", description: "Comment text, verbatim." },
          url: { type: "string", description: "Permalink to the comment (the stable reference for a standalone item, which has no threadId)." },
        },
        required: ["type", "body", "author", "authorIsBot", "url"],
      },
    },
  },
  required: ["ok", "items"],
};

// What one rebase point hands back. `effectiveBase` is the field the rest of
// the run turns on, and the caller checks it is a COMMIT rather than trusting
// it: a movable name here (`origin/main`, `origin/<base>`) would be handed to
// the review cycle as a diff boundary that a sibling push or the next fetch
// moves out from under it, so the reviewer would bound its diff at a tip this
// branch was never rebased onto. There is no conditional-required in JSON
// schema, so that field and every other one required only under a condition are
// validated in the script instead of listed here.
const REBASE_SCHEMA = {
  type: "object",
  properties: {
    ok: { type: "boolean", description: "False when the rebase could not be carried out at all — dirty or mid-operation tree, a target that does not resolve, a git failure. The run stops; nothing is fixed or pushed on the strength of it." },
    halted: { type: "boolean", description: "True when a conflict beyond this step's competence was met: the rebase was ABORTED, the tree left clean and idle, and `question` carries what the maintainer has to decide. Not a failure of the run's mechanics — a decision it cannot make." },
    question: { type: "string", description: "REQUIRED when halted: the conflicting files, the offending commit, and what the judgment turns on. It is reported as this run's open question, so write it for the maintainer rather than as a log line." },
    effectiveBase: { type: "string", description: "The full OID actually rebased onto, as `git rev-parse --verify <target>^{commit}` printed it — a commit, never a ref name and never an abbreviation. REQUIRED whenever ok is true; the caller rejects anything that is not a full hex OID (40 characters, or 64 in a SHA-256 repository) and stops the run, because every delegation range afterwards is taken against this value." },
    noop: { type: "boolean", description: "True when the rebase replayed nothing and the tip is unchanged (the pinned base was already an ancestor of HEAD) — the common and cheap outcome, and what makes two rebase points safe. It is the one value that switches checks off (no validation here, no re-verification of the rebased tree at the pre-push point), so the caller adopts it only where `before` and `after` are both reported and equal, and stops the run otherwise." },
    before: { type: "string", description: "Tip SHA before the rebase — the pre-rebase tip step 3 saved. REQUIRED whenever ok is true: the caller checks the recovery ref against it, and where noop is true it and `after` are also the evidence the no-op is accepted on." },
    after: { type: "string", description: "Tip SHA after it. REQUIRED whenever noop is true, and equal to `before` there; a no-op naming a moved tip, or naming none, is treated as an unevidenced claim and stops the run." },
    recoveryRef: { type: "string", description: "The recovery ref saved before the first replay, written in full: exactly `refs/pre-rebase/<the branch you rebased>/<the UTC timestamp>`, nothing truncated. REQUIRED whenever ok is true — step 3 saves it unconditionally and is told not to skip it. The caller checks the whole name against the branch it dispatched and the timestamp shape the brief stamps, because a truncated or mistyped value names no backup of this replay while still starting with the right characters." },
    recoveryTip: { type: "string", description: "The OID `recoveryRef` resolves to, read back with `git rev-parse --verify` AFTER the `update-ref`. REQUIRED whenever ok is true, and equal to `before`. A name is a way back only where it is seen resolving to the tip the rebase started from: a ref that was never created, or one left over from another branch's replay, is a report the caller refuses rather than a recovery point." },
    validationPassed: { type: "boolean", description: "Whether the post-rebase build/tests passed. Report `true` for a no-op rebase, which runs none. A rebase that replayed anything must report `true` here to go on: the caller requires that value positively, so `false` and an absent field stop the run alike, before any review verdict or push rests on the replay." },
    detail: { type: "string", description: "One line: the target, what was replayed, skipped or resolved, and what validation ran." },
  },
  required: ["ok", "halted", "noop", "detail"],
};

const PUBLISH_SCHEMA = {
  type: "object",
  properties: {
    published: { type: "boolean", description: "True only if the push AND every required reply/resolve/summary/ping step succeeded. False if any guard (moved head, unmatched remote, rejected lease, failed comment) aborted publication." },
    aborted: { type: "string", description: "Why publication stopped, when published is false (e.g. `head moved`, `lease rejected`, `local behind PR head`, `push remote unmatched`). Empty when published. Write it: the run's own note carries this reason inline, so an omitted one reads as `no reason reported` there." },
    pushed: { type: "boolean", description: "Whether a push was performed at all (may be an `Everything up-to-date` no-op)." },
    pushedNewCommits: { type: "boolean", description: "True ONLY if the push actually advanced the remote branch — new commits or rewritten history. False when no push happened or for a no-op `Everything up-to-date` push. Gates whether the re-review pings may fire." },
    threadOutcomes: {
      type: "array",
      description: "Per item: its stable reference and what was done (replied/resolved/left-open).",
      items: {
        type: "object",
        properties: {
          ref: { type: "string" },
          outcome: { type: "string" },
        },
        required: ["ref", "outcome"],
      },
    },
    summaryCommentUrl: { type: "string", description: "URL of the posted Summary of Review Fixes, or empty if not posted." },
    pings: { type: "string", description: "Which ping comments were posted, or empty." },
  },
  // `aborted` stays out of `required`, beside `summaryCommentUrl` and `pings` —
  // this schema's other may-be-empty fields. Requiring it was tried and
  // reversed: a packet that misses validation reaches the caller as nothing at
  // all, so one omitted reason would take `threadOutcomes`, `pushed`,
  // `pushedNewCommits` and the summary URL down with it and force `published`
  // false on a push that had completed. The result note carries whatever is
  // here inline instead, which degrades to "no reason reported" and costs the
  // rest of the report nothing.
  required: ["published", "pushed", "pushedNewCommits"],
};

const RECLAIM_SCHEMA = {
  type: "object",
  properties: {
    removed: { type: "boolean", description: "True only if the worktree is gone. False when the reclaim refused (a dirty or mid-operation tree, or a path that did not verify) — which is a report, not a failure of the run: the run's status still names what happened to the PR, and the surviving path is carried into its `note` as well as this record." },
    path: { type: "string", description: "The worktree path this spoke for. REQUIRED: on the REFUSAL path the run's own note names the surviving tree, but on the SUCCESS path this record is the only place the reclaimed path is ever written down, so a schema that let it be omitted would lose which worktree was given back." },
    detail: { type: "string", description: "One line: how it was removed, or what is held there and why it was left." },
  },
  required: ["removed", "path", "detail"],
};

// Shell-quote EVERY gather-supplied value before embedding it in a copy-paste
// command these prompts emit — ref names and the head OID alike. Both reach
// this script as free text from an agent's `gh pr view` reading rather than as
// validated git syntax, and a ref name may legally carry shell metacharacters
// (`;`, `$`, backticks — git ref names forbid spaces but little else), so an
// unquoted one could run the rest of the line or act on the wrong thing.
// Single-quote and escape embedded quotes; adjacent quoted spans like
// `refs/heads/'b'` concatenate into one shell word, so the path still resolves,
// and so does a quoted `<ref>:<oid>` lease pair.
//
// The rule is scoped to command text on purpose. The head OID also appears once
// as a value the agent is asked to COMPARE against what it re-fetches ("Expected
// head OID to replace"), not to run; quoting it there would have the agent match
// the fetched OID against a quoted rendering of itself, so that occurrence is
// deliberately bare and is not an omission.
function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

// Is this string an immutable commit boundary? Only a FULL object id qualifies:
// 40 lowercase hex characters, or 64 in a SHA-256 repository. An abbreviation
// is a prefix, so a repository that grows can make one resolve to a second
// object or stop resolving at all, and a 7-character hex string is also a legal
// branch name — which is the very thing a pinned base may not be. Every
// delegation range this run hands out is taken against a value that passed
// this, whether the rebase phase pinned it or `no-rebase` pinned the base ref
// the gather resolved.
function isFullOid(s) {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(s);
}

// Map a bot comment author login to the known reviewer bot it represents, or
// null for a human / unrecognized bot. `ping-contributing` uses this to
// attribute a round's new findings to specific bots so it can re-ping only the
// ones still adding value. Substring match keeps it robust to the exact app
// login (e.g. `chatgpt-codex-connector` -> codex, `Copilot` -> copilot).
function botKindOf(login, authorIsBot) {
  if (!authorIsBot) return null;
  const s = String(login || "").toLowerCase();
  if (s.includes("codex")) return "codex";
  if (s.includes("copilot")) return "copilot";
  if (s.includes("claude")) return "claude";
  return null;
}

// What an agent this script spawns may run, and what it may not. A reviewer
// subagent authorized to verify a claim empirically once ran `rm -rf ./*` in a
// shared main checkout: its setup clone had failed invisibly inside a pipeline
// under `set -e` (a pipeline's status is its last command), so it was still at
// the repository root while believing it stood in a clone. This script's own
// two agents (gather, publish) carry it from here; the fix and review briefs
// below ride the NESTED wf-review-cycle, whose review-cycle-core section states
// the same boundary in the prompts it composes, so they do not restate it.
const DESTROY_BOUNDARY = `## DESTROY BOUNDARY

Permitted: reading, searching, read-only \`git\`/\`gh\` queries, and the specific mutations this assignment spells out.
Forbidden: \`rm -rf\`, \`git reset --hard\`, \`git clean\`, \`git branch -f\`, \`git update-ref\`, \`git gc\`, and force-pushing — each of them beyond what this assignment itself spells out, whether as an exact command or as a skill it names to invoke — NOT in a clone, NOT in a temp directory, NOT "safely". You may not self-authorize one by putting yourself somewhere you believe is safe; what this assignment spells out, and the disposable clone below, are the only exemptions — and only because this assignment names them, not because a clone is safe.
A worktree is not a blast radius: it isolates the working tree, not the repository, so \`branch -f\`, \`reset\`, \`update-ref\`, and \`gc\` reach every sibling worktree through the shared \`.git\`.
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

// This brief no longer rebases anything: the rebase is its own delegated step
// (see rebasePrompt below), so what gather does with the token is REPORT it.
// The one branch move left here is the reconciliation's `--ff-only`, which is
// why the brief still spells that out and nothing else.
function gatherPrompt(input) {
  return `You are preparing a pull request for review-addressing. Read \`AGENTS.md\` / \`CLAUDE.md\` first.

${DEPUTY_FINISH_IN_TURN}

${DESTROY_BOUNDARY}

Request (lenient parsing — commas, &, free word order): ${JSON.stringify(input)}
Possible tokens: a PR number (e.g. #38), \`rebase on top of <branch>\`, \`no-rebase\`, \`inline\`, \`off-shoot\`, \`no-push\`, \`push\`, \`peer-opinions=off\`, \`ping-codex\`, \`ping-claude\`, \`ping-copilot\`, \`ping-contributing\`. You act on the PR#, \`inline\`, and \`off-shoot\` here. The rebase you REPORT rather than perform — a separate delegated step does it, twice — so put the branch or commit an explicit \`rebase on top of <branch>\` named into \`rebaseTarget\` and leave it empty when the request named none; \`no-rebase\` and the push/ping/peer flags are read by the caller and are none of your business.

Preflight (set \`ok: false\` with a \`blocker\` and stop on any failure):
1. \`gh auth status\` succeeds.
2. The clean-tree and idle-tree checks belong to the WORKING LOCATION rather than to wherever you start, so run them once the step below has picked it — never here, and never auto-stashing or discarding anything either way. The two checks, wherever they run: \`git status --porcelain\` prints nothing, AND no Git operation is in progress — \`git rev-parse --git-path rebase-merge\` and \`rebase-apply\` for an existing path, plus \`MERGE_HEAD\`, \`CHERRY_PICK_HEAD\`, \`REVERT_HEAD\`, \`BISECT_LOG\`. Those markers are not decoration: a tree left mid-cherry-pick, mid-merge or mid-revert prints EMPTY porcelain and has no rebase path, so a rebase-only probe passes it and this run commits its fixes on top of that state. Working INLINE, this checkout must pass both; a failure is a blocker exactly as before. Working in a WORKTREE, nothing is required of this checkout — it may be dirty or mid-anything — because a worktree created for this run is clean by construction; a REUSED one (the slug survived a prior halted run) gets those same two checks, and whatever they find there is a blocker naming the path and what it holds, never something for you to clean up or force past.

Resolve the PR: explicit PR# wins (but sanity-check it shares history with the branch it would be worked on — if genuinely unrelated, blocker and stop); else auto-detect via \`gh pr view\`. When \`ok\` is true you MUST populate the whole \`pr\` object: \`number\`, \`url\`, \`branch\` (the PR's remote headRefName — the push target), \`workingBranch\` (the branch checked out in the working location, from \`git branch --show-current\` there), \`base\`, \`headOid\` (the PR's headRefOid — the publish phase needs it for a safe \`--force-with-lease\`), \`rebased\`, and the \`locationMode\`/\`worktree\` pair the next step decides. \`workingBranch\` usually equals \`branch\` — in worktree mode it always does — but for a local off-shoot of a merge-pending PR, which only the \`off-shoot\` token selects, it differs; downstream fixes edit \`workingBranch\`, while \`branch\`/\`headOid\` remain publication metadata for the push.

Pick the WORKING LOCATION now — after resolving the PR, before reconciling below (reconciling can fast-forward a branch, and it must move the branch the work will land on). Let \`T\` be the PR's headRefName and \`C\` the current branch (\`git branch --show-current\`, EMPTY when detached). Fetch the PR's exact head ref WITHOUT moving any branch and let \`R\` be \`git rev-parse FETCH_HEAD\` — the same \`R\` the reconciliation below uses, so one fetch serves both.

The identity check first, before any checkout or attach below — settling it afterwards would mean settling it on a ref already occupied. A branch is only this PR's when it shares recent history with the PR head (for a fork head, when its resolved push remote/ref matches the PR head repo/ref). That fork clause gates a candidate meant to BE \`T\` — the same-named local ref, and the branch case 2 checks out; a named off-shoot is a different branch by construction and is not held to it, since what may be pushed from it is the publish step's question. A local ref that merely bears \`T\`'s NAME while carrying unrelated history is a name collision — reusing a name like \`minor-fixes\` across unrelated work is ordinary practice — and it must never become the working location, in any of the four cases. Attach nothing and substitute nothing: not a disambiguated branch name (it would carry no verified push target for the publication lease to match) and not a detached checkout (its commits are reachable from nothing once the worktree is reclaimed). Set \`ok: false\` with a \`blocker\` naming the rejected local ref, the verified PR head, and what each points at, and stop — branch hygiene is the maintainer's call.

Then take the FIRST case that applies:
1. The request carried the \`off-shoot\` token → the maintainer is telling you this checkout stands on a local off-shoot of the PR's branch, so work INLINE on \`C\` and report \`C\` as \`workingBranch\`, with \`T\`/\`headOid\` staying publication metadata for the push. It needs an explicit PR# (auto-detection has no PR to resolve from a branch that is not a PR head) and a NAMED branch: with \`C\` empty (detached) the token selects nothing, so set \`ok: false\` with a \`blocker\` saying exactly that. Run preflight item 2's two checks on this checkout and make a failure the blocker. Where \`C\` equals \`T\` the token is redundant — that is case 3. NOTHING BUT THE TOKEN routes a run here: no probe on the shape of \`C\`'s history may conclude off-shoot, because none can — the supported case is a branch cut BEFORE the PR head and advanced with its own commits, which is the same shape as a stacked child cut FROM the head and advanced, and working on the second as if it were the first publishes that child's own commits onto this PR under \`T\`. One thing can still make the request AMBIGUOUS, though it DISPROVES nothing, so check for it: another OPEN PR whose head is this same branch. Being an off-shoot of this PR and carrying a PR of its own are compatible, so such a PR is no evidence against the token; what it means is that two PRs could be advanced by the same commits and only the maintainer can say which — set \`ok: false\` with a \`blocker\` naming both branches and both PRs rather than choosing between them. Probe AT THE HEAD rather than through some base repository's PR list: resolve \`C\`'s own push remote/ref to an owner, a repository and a ref, then ask GraphQL \`repository(owner:<owner>,name:<repo>){ ref(qualifiedName:"refs/heads/<ref>"){ associatedPullRequests(states:OPEN,first:100){ nodes{ number url baseRepository{nameWithOwner} } } } }\`. Rooting the query at that ref is what makes it exhaustive and exact at once, and it is why ONE filter is left where two were needed: it answers with every open PR whose head IS that repository-qualified ref — whatever repository each one's BASE is in — and with nothing else. \`gh pr list --head\` delivers neither half: it reads ONE base repository, so a PR based in another never appears; its own \`--help\` says \`<owner>:<branch>\` is not supported, so it matches a bare branch NAME that a fork's same-named head answers too; and it stops at 30 items. A \`C\` that has never been pushed resolves \`ref\` to null and is nobody's PR head. The filter that remains: count a hit only where the PR's \`url\` DIFFERS from the resolved PR's own \`url\`, since where \`C\` is this PR's own head the query answers with this very PR and stopping on that would halt an ordinary run. Compare the \`url\` and never the \`number\`: a number is scoped to that PR's OWN base repository, and this answer set spans base repositories by construction — that is the whole reason the query is rooted here — so a conflicting PR can carry the very same number as the one you resolved, and comparing numbers would discard exactly the case this root was widened to reach. The \`url\` is globally unique and the query already asks for it. \`isCrossRepository\` has no part in this and is not requested: the field reports whether a PR's OWN head and base repositories differ, which is not the question — the query root already settles whose head it is — and reading it as an answer is what once made an upstream PR in a fork clone report false for a head that is not the fork \`C\` pushes to. And skipping the reconciliation below is not a licence to publish over the PR head: what may be pushed from an off-shoot is the publish step's question, not this one.
2. The request carried the \`inline\` token → work INLINE in this checkout, on \`T\`. Where \`C\` is not already \`T\`, run preflight item 2's two checks on it FIRST and make a failure the blocker — a run that switches this checkout and only then discovers dirt has moved it for nothing — then check \`T\` out here: \`gh pr checkout <N>\` for a fork head, else check out the local \`T\` where one EXISTS — the identity check above has already cleared it — and create a tracking branch at \`R\` only where NONE does, the same split case 4's two local-\`T\` arms make. A create is not a checkout: \`git checkout -b\`/\`git switch -c\` REFUSE a branch that is already there, so ordering one unconditionally fails the ordinary run forced inline from a checkout that has held this PR's branch before. The run ENDS on that branch; do not restore anything. Where \`C\` already IS \`T\` there is nothing to check out — that is case 3. This token does exactly what it says even when \`C\` is an off-shoot of this PR: it switches to \`T\` and works there, which leaves \`C\`'s ref and commits untouched but is NOT case 1 — only \`off-shoot\` puts the work on \`C\`.
3. \`C\` equals \`T\` and \`T\` passes the identity check above → work INLINE, exactly as this pipeline always has. The branch advances under whoever is standing on it, which is this case's contract rather than a side effect.
4. Anything else — any other branch, and a DETACHED HEAD, which has nothing to advance under anyone → work in a WORKTREE and leave this checkout alone: it is never switched, never dirtied, and never required to be clean, and whoever owns it may repoint it while you work. Attach \`T\` under the stable slug \`pr-<N>\` (stable so a halted run's worktree is found again rather than duplicated), placed under the repository's worktree base (\`<repo>/.worktrees/$CONTAINER_NAME/\`, the convention \`wt-enter\` uses). That base has to BE ignored, and only this run makes it so: \`git worktree add\` excludes nothing on its own, so in a repository that does not already carry the rule the nested add leaves \`?? .worktrees/\` in the main checkout — dirtying the one tree this case promises never to dirty, exposing it to a stray \`git add -A\`, and standing there indefinitely once a halt keeps the worktree. So before the arms below, run \`git check-ignore -q "<repo>/.worktrees/"\` — with the TRAILING SLASH, since \`/.worktrees/\` is a directory-only rule and \`check-ignore\` answers NO for a bare \`.worktrees\` that does not exist on disk yet, which is every first run — and, where it answers no, append \`/.worktrees/\` to the file \`git rev-parse --git-path info/exclude\` names — run it from inside \`<repo>\`, because in a primary checkout it answers with the RELATIVE \`.git/info/exclude\` (only a linked worktree gets an absolute path), so a \`git -C <repo>\` form whose answer you then append to from your own directory writes the rule to a file \`check-ignore\` never reads — then re-probe and make a still-no answer a blocker. Ask Git for that path rather than writing a literal \`.git/info/exclude\`: THIS checkout may itself be a linked worktree, where \`.git\` is a gitfile and \`.git/info\` is not a directory at all, so the literal append fails outright and the protection is never established — while \`--git-path\` resolves to the shared exclude file that \`check-ignore\` actually reads, in a linked worktree and a primary checkout alike. Either way it is the repo-local ignore file, which is untracked and so dirties nothing itself, and NOT the tracked \`.gitignore\`, which is the maintainer's to edit. This is the same base preparation \`address-reviews\` does in its bootstrap; a run that only ever attaches through \`wt-enter\` inherits nothing of it, because the helpers place worktrees there without ignoring the base either. BEFORE any of the three arms below, read \`git worktree list\`: every one of them adds at that same \`<worktree base>/pr-<N>\`, and \`git worktree prune\` — run it first, but it settles nothing here — clears only STALE registrations — a LIVE one survives it, and a live \`pr-<N>\` registration is precisely the halted run this stable slug exists to resume — so an add would fail on a path that is already occupied (and, off the fork arm, on an occupied branch too), leaving the resume path working only where the optional helper exists. Where \`<worktree base>/pr-<N>\` is already registered with \`T\` checked out, REUSE it rather than adding, whichever arm would otherwise have run; it is then the REUSED tree preflight item 2 checks. Where that path is registered on anything ELSE — a tree a halted fork arm below left behind because its give-back refused, included — set \`ok: false\` with a \`blocker\` naming the path and what it holds, never a second slug and never a removal. Then take the FIRST of these three arms that applies. A FORK head takes the first arm, ahead of both local-\`T\` arms: the fork arm is the only one that wires up the fork remote, and a prior fork run's \`gh pr checkout\` leaves a same-named local \`T\` behind, which the "local \`T\` EXISTS" arm would otherwise claim on the re-run and attach with no verified push target. It is \`git worktree add --detach "<worktree base>/pr-<N>"\` — the path argument is mandatory (\`git worktree add … <path> [<commit-ish>]\`), so a pathless form fails before \`gh\` is ever reached — followed by \`gh pr checkout <N>\` inside it, then verify for yourself that you landed on a NAMED branch carrying \`R\` (gh selects a same-named local branch even under \`--detach\`, and only declines to clobber it — that is not a check). Where that verification FAILS — a detached HEAD still standing, a failed \`gh pr checkout\`, or a branch not carrying \`R\` — set \`ok: false\` with a \`blocker\` naming the rejected local ref, the verified PR head, and what each points at, and attach nothing further and substitute nothing, exactly as the identity check above orders (it ran before this checkout and so cannot see a collision \`gh\`'s own branch selection creates); and give this worktree back as part of that report — \`wt-remove pr-<N>\` where \`command -v wt-remove\` finds it, else \`git worktree remove "<worktree base>/pr-<N>"\` — the same give-back \`address-reviews\` orders for this same failure, so the rejected ref does not sit on this stable slug and turn every re-run into the occupied-path stop above, which is the one thing no re-run can clear. Neither is a force, but their refusals are NOT the same: \`wt-remove\` refuses a dirty tree AND one with a Git operation in progress, the operations that leave \`git status\` clean included, while plain \`git worktree remove\` refuses the dirty tree and is blind to that mid-operation state — the same empty-porcelain blindness preflight item 2 above names. Nothing rides on that gap here: this tree was created seconds earlier and had only \`gh pr checkout\` run in it, so there is no operation for it to be in — do not grow a guard for it. Either way, a tree the command declines to remove is still standing and its path goes in the pair below; a removed one leaves nothing to report there. Otherwise, where a local \`T\` EXISTS, attach it: prefer \`wt-enter pr-<N> <T>\` where \`command -v wt-enter\` finds it — it is rerun-safe and prints the absolute path — else \`git worktree add "<worktree base>/pr-<N>" <T>\`. Where NO local \`T\` exists — the commonest way this case is reached, since a PR head you have never checked out has no local ref — the branch must be CREATED at the verified head, which \`wt-enter\` REFUSES to do without a base (\`branch '<T>' does not exist and no <base> was given\`): either \`git fetch origin refs/heads/<T>\` then \`git worktree add -b <T> "<worktree base>/pr-<N>" <R>\`, or \`wt-enter pr-<N> <T> <R>\`, which consults the base only when the branch is missing.

Report the choice as \`locationMode\` (\`inline\` or \`worktree\`) — both fields are REQUIRED of a successful gather, and an absent or unrecognized \`locationMode\` stops the run rather than defaulting to either — and, in worktree mode, its ABSOLUTE path as \`pr.worktree\` (empty inline). That pair is owed on a BLOCKER too, from the moment you attach or reuse a worktree: everything below can still stop the run — a reused tree holding a prior run's dirt, a non-trivial rebase conflict, an unrecognized branch state — and a stop is what LEAVES that worktree standing, so an \`ok: false\` packet raised after the attach carries \`pr.locationMode\` and \`pr.worktree\` — and every other \`pr\` field, all of them resolved before the location was picked and all of them required whenever \`pr\` is present — or the maintainer never learns the path. Name as \`pr.worktree\` only a tree that IS still standing: a blocker raised BEFORE any attach carries none, the honest report of a run that created none, and so does the fork arm's rejected landing once its give-back succeeded. In worktree mode, \`cd\` into it and require \`git rev-parse --show-toplevel\` to print exactly that path before doing anything else; every step below — the reconciliation, the rebase, the thread gathering's git reads — happens there, and NOTHING touches the main checkout again.

Reconcile the checked-out branch with the PR head — ONLY when \`workingBranch\` equals \`branch\`. Where the two names DIFFER the local off-shoot of case 1 is in play — the token put you there: \`branch\`/\`headOid\` are publication metadata for a branch you are not on, "behind the PR head" is that case's normal state, and you MUST skip this step whole — no probes, no branch move — reporting \`reconcile: { outcome: "not-applicable" }\`. (The location step's fetch is not this step: it moved nothing.)

Where the names match: fetch the PR's exact head ref WITHOUT moving the local branch, then take \`R\` from what that fetch actually brought — \`git rev-parse FETCH_HEAD\` — NOT from the recorded \`headRefOid\`. A fetch brings whatever the ref names NOW, and whether the recorded OID is a local object says nothing about that: it is normally reachable from your own checkout, so an existence check passes even when a push has since advanced the head, leaving you to reconcile against the stale tip. Where \`R\` differs from the recorded OID the head moved under you, which is not a failure — record \`R\` as \`pr.headOid\` before continuing, so the lease the publish phase builds names the head you actually reconciled against. Then with \`H\` = \`HEAD\`, run these two probes and take the FIRST outcome that applies:
1. \`git rev-list --right-only --cherry-pick H...R\` — the remote commits not represented in local. EMPTY → local already carries everything the remote has (identical, ahead by unpushed commits, rebased onto a newer base, restacked after a predecessor merged, or any combination). Report \`reconcile: { outcome: "work" }\` and proceed on \`H\` as it stands.
2. Else \`git merge-base --is-ancestor H R\` — true means local is strictly behind and holds nothing the remote lacks. Run \`git merge --ff-only <R>\`, report \`reconcile: { outcome: "fast-forwarded" }\`, and proceed. This fast-forward is the ONE branch move this assignment authorizes, and only on this path.
3. Else this run does not act on the branch. Return \`ok: true\` (this is NOT a failure and NOT a blocker), \`items: []\`, the \`pr\` object populated, and \`reconcile: { outcome: "unrecognized", detail: "<what you saw>" }\` — name both tips and the commits unique to each side. Do NOT pick a side, merge, rebase, reset, or force anything, and gather no threads: the caller stops the run and hands the branch back to the maintainer.

Those two probes are the whole rule; do not grow them into a classifier of branch states, which is exactly what the third outcome exists to make unnecessary. The first is patch-id based on purpose: \`--cherry-pick\` drops commits with a patch-id twin on the other side, so a branch rebased onto a newer base reads as carrying the PR head's content though it shares no SHAs with it, where a raw-ancestry test would call that ordinary state divergent. Do NOT filter merge commits out of that probe: patch-id cannot speak for a merge, so an unrepresented merge on the remote head lands in outcome 3 deliberately — one extra ask when a UI "Update branch" merge advanced the head, in exchange for never silently dropping a conflict resolution such a merge carried.

Rebase NOTHING here, whatever the request asked for. Report \`pr.base = baseRefName\` and \`pr.rebased = false\`. Also resolve that base ref to a commit ONCE and report the full OID as \`pr.baseOid\`, reading it in the BASE repository and not through this branch's push remote. Those are two different repositories whenever the PR is cross-repository: the push remote is the HEAD repository, so \`<push-remote>/<baseRefName>\` there names a same-named branch in the fork — a different branch's tip, or nothing at all — and the push remote stays what it is for, the publication target. There is no base-repository field to ask for and none is needed: a PR's base always lives in the repository the PR itself is in, so the base repository is the \`<owner>/<repo>\` this PR's OWN URL names — the \`https://<host>/<owner>/<repo>/pull/<number>\` you report as \`pr.url\`, an explicit repository-qualified value you already resolved. Do not ask a bare \`gh repo view --json nameWithOwner\` for it: with no repository argument that command answers for the repository the DIRECTORY it runs in resolves to, which in a fork clone is the head fork — the one repository this paragraph exists to keep the fetch away from. \`isCrossRepository\` is no substitute for matching that repository against a remote's URL: it compares the PR's OWN head and base and says nothing about which repository this clone's remotes point at — a fork clone working a PR whose head and base both live upstream reads \`false\` while \`origin\` is still the fork. Where the URL match does land on this branch's push remote, one remote serves both. Fetch that repository's exact base ref WITHOUT moving any branch — \`git fetch <the remote whose URL is that repository, or that repository's URL where a fork clone has no remote for it> refs/heads/<baseRefName>\` — and resolve what the fetch brought: \`git rev-parse --verify FETCH_HEAD^{commit}\`, reporting the full unabbreviated OID git prints. Read no \`<remote>/<baseRefName>\` in its place: a remote-tracking ref is only as fresh as whatever last fetched it, so it can pin a commit the base has since moved past, and nothing else here fetches the base at all. That fetch OVERWRITES \`FETCH_HEAD\`, so run it only after every read of \`R\` above — the location step's, and the reconciliation's where it ran. A \`no-rebase\` run pins its review base to that OID, because every range this run delegates is taken against a commit rather than a name — a name moves under the next fetch or a sibling push. Then put an explicit \`rebase on top of <branch>\` token's target — a branch name or an exact commit, verbatim — into \`rebaseTarget\` (empty when none was named). A delegated rebase step runs immediately after you and again before publication; it resolves that target to a commit, pins it, and reports back what it landed on, and the caller replaces \`pr.base\`/\`pr.rebased\` from that report. Two agents both rebasing would replay the same commits twice, which is precisely why this one does not.

Gather feedback into \`items\` (each verbatim):
- UNRESOLVED review threads — PRIMARY: use the baked \`gh-review-threads\` helper. \`gh-review-threads <PR#>\` prints the unresolved threads as a JSON array (each thread \`id isResolved isOutdated path line\` and \`comments[]\` with \`databaseId author{ login __typename } body diffHunk url\`); it already pages with fresh SINGLE-SHOT queries (never \`gh api graphql --paginate\`), does the nested comment fetch-up, and applies the scope check below, failing closed with exit 3 and no stdout on a contaminated response. FALLBACK, only when \`command -v gh-review-threads\` fails (a container built from an older image — the same graceful-degradation used for the gh-version-gated Copilot ping): run the GraphQL \`reviewThreads\` query by hand as SINGLE-SHOT queries, never \`gh api graphql --paginate\` (run concurrently with other gh GraphQL calls it has returned ANOTHER PR's threads); include \`totalCount\` + \`pageInfo{ hasNextPage endCursor }\` and page past 100 threads by passing the returned cursor to a fresh call. Either way SCOPE-CHECK the result (the helper does this for you): every comment \`url\` must match the exact repo-qualified PR path for this PR (\`https://github.com/<owner>/<repo>/pull/<number>\` followed by \`#\`, \`/\`, \`?\`, or end); do not use a plain substring check such as \`/pull/<number>\`. On any mismatch, discard the entire response, retry once with a fresh single-shot query, and if it repeats fail closed; never emit an item whose \`url\` points at a different PR. Keep only \`isResolved == false\`. Emit each as \`type: "review-thread"\` with \`threadId\` (the thread node \`id\`), \`commentId\` (the top comment's \`databaseId\`), \`path\`, \`line\`, \`author\` (the top comment's \`author.login\`), \`authorIsBot\` (true when that comment's \`author.__typename\` is \`Bot\` — from the helper's output or the GraphQL \`author{ login __typename }\`; do not guess from the login), \`body\`, \`url\`. \`threadId\` and \`commentId\` are mandatory for these — they are how publication resolves and replies.
- Top-level context — ALWAYS fetch every review summary (\`gh pr view --json reviews\`) and every issue comment (\`gh api --paginate repos/{owner}/{repo}/issues/<PR>/comments\`), even when the request names no standalone item: this sweep is how maintainer replies and decision comments are discovered. A maintainer reply on an unresolved thread is authoritative — fold it into that thread's context. So is a top-level maintainer comment recording per-item verdicts (often titled "Maintainer Decisions" or similar) — fold each decision into the relevant thread's context as its binding disposition (including "defer to a follow-up task" and "keep as-is").
- A standalone issue comment or review summary becomes its own item ONLY if the request explicitly identifies it as outstanding. Emit it as \`type: "standalone"\` with \`author\`, \`authorIsBot\`, \`body\`, and \`url\` (its permalink is the stable reference; it has no threadId and is never resolved as a thread).

If there are no unresolved threads and no included standalone item, return \`ok: true\` with an empty \`items\` array — the caller will exit as a successful no-op.

Edit NO project files here; this is gather-only. The working-location setup and the one authorized fast-forward are the whole of the state this step is allowed to change.`;
}

// ONE rebase point, delegated. This is the workflow layer's single rendering of
// the `review-cycle` skill's "The delegated rebase step" — the same
// relationship DESTROY_BOUNDARY has to that skill's destroy-boundary section:
// the canonical statement lives in the skill, this is the text an agent that
// cannot read the skill acts on, and there is exactly one of it here. Both call
// sites share this builder, so the run's two points cannot drift apart.
//
// Rendering it here rather than pointing at the skill is this repo's
// established pattern, not a second specification: a brief handed to a subagent
// that has read nothing else must be self-contained (task 023a states the
// rule — inline the instruction and its one settling read), and
// `test-subagent-destroy-boundary.mjs` enforces exactly that rendering for the
// destroy boundary. What the pattern forbids is the other direction — moving
// this mechanism up into the skill (task 044) — and content drift from the
// nugget, which `test-address-review-reconcile.mjs` pins clause by clause.
// Two nugget clauses have no counterpart below because this pipeline cannot
// reach them: the parent map and the `--onto` parent-first form (one PR, so a
// stacked target arrives as an explicit token already pinned to a commit), and
// the `refs/pinned-base/` snapshot (the pinned OID is rebased onto, so `HEAD`
// keeps it reachable).
//
// Why an agent at all: the script cannot run git, and the skill forbids an
// orchestrator from holding a half-finished rebase — a conflict wants a whole
// turn and a maintainer-facing question, not a branch in the caller's control
// flow.
//
// `point` is `pre-fix` or `pre-push`; only the purpose paragraph and the
// validation wording differ between them, because the mechanics must not. The
// other axis is `explicitTarget`, which varies one step and for a reason that
// is not the point's: WHOSE ref the target is decides where it is resolved.
function rebasePrompt(point, packet, target, explicitTarget) {
  const prePush = point === "pre-push";
  // WHERE the target ref is resolved depends on WHOSE ref it is, and the caller
  // is the only one that knows: the default target is the PR's `baseRefName`,
  // which lives in the PR's own repository, while an explicit
  // `rebase on top of <branch>` token names whatever the maintainer named —
  // routinely a local branch, or one in the head fork. Sending the second at the
  // base repository regresses that token exactly as `git fetch <repository>
  // <refspec>` reads it: an unrelated same-named branch upstream, or nothing at
  // all, which stops a run whose target was on disk the whole time.
  const pin = explicitTarget
    ? `The target is \`${target}\`, named outright by this run's request rather than taken from the PR. Resolve it WHERE IT WAS NAMED — here, in this working location — with \`git rev-parse --verify ${target}^{commit}\`, which takes a local branch, a remote-tracking ref, or an exact commit, proves it names an existing COMMIT, and prints the full object id. Fetch NOTHING for it, and do not go looking for it in the PR's base repository: an explicitly named target is routinely a local branch or one in the head fork, so asking that repository for \`refs/heads/<it>\` pins an unrelated same-named branch there, or fails outright on a target that was on disk all along. Where it does not resolve here, report \`ok: false\` naming what you tried, and substitute nothing.`
    : `The target is \`${target}\`, this PR's own base ref. Where it is a ref name, fetch it fresh first so you pin what it points at NOW — from the repository that ref lives in, which for this PR's base is the repository the PR itself is in (a PR's base always is) and NOT this branch's push remote, which on a cross-repository PR is the head fork where the same name is some other branch or none. WHICH repository that is is already resolved and is handed to you here, in this PR's own URL: \`${packet.pr.url}\`, whose \`<owner>/<repo>\` IS that repository. Do not re-derive it from a bare \`gh repo view --json nameWithOwner\`, which with no repository argument answers for the repository the DIRECTORY it runs in resolves to — in a fork clone the head fork, so it would send this fetch at the very repository the sentence above rules out, and pin a commit off a same-named branch there. Then: \`git fetch <the remote whose URL is that repository, or that repository's URL where no remote points at it> refs/heads/<the ref>\`, moving no branch. Where it is already an exact commit, fetch nothing. Then resolve what you pinned once with \`git rev-parse --verify <it>^{commit}\` — \`FETCH_HEAD\` for a ref you just fetched, the commit itself where the target was already one — which both proves it names an existing COMMIT and prints the full object id.`;
  const where = packet.pr && packet.pr.worktree
    ? `Your working location is the worktree \`${packet.pr.worktree}\`. Before anything else, \`cd\` into it and verify \`git rev-parse --show-toplevel\` prints exactly that path; if not, STOP and report \`ok: false\`. Every command below runs there, and the main checkout — which is on some other branch — is none of this run's business.`
    : `You work in the repository's current checkout, which is on the branch this run is addressing. Do NOT create a worktree and do NOT switch branches: the branch advances under whoever is standing on it, which is this mode's contract rather than a surprise.`;
  return `Rebase one branch for a review-addressing run on PR #${packet.pr.number}, and nothing else. Read \`AGENTS.md\` / \`CLAUDE.md\` first — the build and test commands below come from there.

${DEPUTY_FINISH_IN_TURN}

${DESTROY_BOUNDARY}

${where}

Branch: \`${packet.pr.workingBranch}\` (confirm with \`git branch --show-current\`; stop and report if it is anything else).
This is the ${prePush ? "SECOND" : "FIRST"} of this run's two rebase points: ${prePush
    ? "the fixes are committed and the branch is about to be reviewed and pushed, so this lands them on the base as it stands NOW — the diff a reviewer reads is then the change itself rather than the base's drift, and the verdict that follows describes the exact tree that gets pushed."
    : "nothing has been fixed yet, so this puts the fixer on the code as it will look when merged rather than on a stale base."}
Rebasing twice in one run is deliberate and cannot double-apply: each point pins its base to a commit and rebases onto that, so a base that has not moved since is already an ancestor of \`HEAD\` and git replays nothing.

1. **Preflight.** \`git status --porcelain\` must print nothing AND no Git operation may be in progress — \`git rev-parse --git-path rebase-merge\` and \`rebase-apply\` for an existing path, plus \`MERGE_HEAD\`, \`CHERRY_PICK_HEAD\`, \`REVERT_HEAD\`, \`BISECT_LOG\` (a tree left mid-cherry-pick prints empty porcelain). Either failing is \`ok: false\` with what you found in \`detail\`. Stash nothing, clean nothing, force nothing.
2. **Pin the base.** ${pin} Report exactly that full OID as \`effectiveBase\` and rebase onto THAT OID, never onto the name, and never an abbreviation of it: a short id is a prefix, and a growing repository can make one match a second object, so the caller rejects anything but the full length. The name is not an answer: \`origin/<base>\` moves whenever anything else pushes or fetches, and every range this run delegates afterwards is taken against \`effectiveBase\`, so a name would bound a reviewer's diff at a tip this branch was never rebased onto. The caller rejects a non-commit \`effectiveBase\` and stops the run.
3. **Save the recovery ref, then read it back.** \`current_branch="$(git branch --show-current)"\` (require it non-empty), \`ts="$(date -u +%Y%m%d-%H%M%S)"\`, \`before="$(git rev-parse --verify HEAD)"\`, then \`git update-ref "refs/pre-rebase/$current_branch/$ts" "$before"\`. That is the one \`update-ref\` this assignment spells out and the run's only rebase recovery ref — do not skip it. Then prove it is there and points where you say: \`git rev-parse --verify "refs/pre-rebase/$current_branch/$ts^{commit}"\` must print \`$before\`. Report the ref path IN FULL as \`recoveryRef\` — \`refs/pre-rebase/\` then this branch then the timestamp, nothing truncated and no other branch's — that read-back OID as \`recoveryTip\`, and the pre-rebase tip as \`before\`. The caller checks the three against each other, so a ref it cannot see resolve to that tip stops the run instead of standing as this replay's only way back.
4. **Rebase:** \`git rebase <the effectiveBase OID>\`. Git's patch-id detection drops commits the base already carries. If nothing was replayed and the tip is unchanged, that is the expected no-op: report \`noop: true\` with \`before\` equal to \`after\`, run no validation, and you are done. Those two tips are the evidence, not decoration: \`noop: true\` is what tells the caller to run no validation on this point and to spend no reviewer round re-verifying the tree afterwards, so the caller adopts it only where both are reported and equal, and stops the run on a no-op claim that names a moved tip or names none.
5. **Conflicts — by hunk, in place.** Preserve cleanly auto-merged changes elsewhere in each file. Whole-file \`git checkout --ours\`/\`--theirs\` is safe ONLY after inspecting the merged result and confirming the file carries no cleanly auto-merged content from the other side; otherwise it silently deletes a sibling's already-shipped behavior with no conflict marker left behind.
   - TRIVIAL (import/whitespace/formatting collisions, pure additions, or a patch the new base already represents) → resolve in-file and \`git add\` + \`git rebase --continue\`, or \`git rebase --skip\` for an already-represented commit. Narrate one line each in \`detail\`.
   - BEYOND THAT (a genuine semantic dilemma) → \`git rebase --abort\`, then CONFIRM the tree is clean and idle by step 1's two checks, and report \`halted: true\` with a \`question\` naming the conflicting files, the offending commit, and what the judgment turns on. Never leave the tree mid-rebase, and never guess a resolution: this run is unattended, and addressing review on a wrong base and then force-pushing is worse than not running. If the abort leaves unexpected files, preserve and report them rather than deleting anything.
6. **Validate a rebase that replayed something** — the project's build AND its test suite, discovered from \`AGENTS.md\`/\`CLAUDE.md\`, then \`package.json\` scripts, then ecosystem signals. Report the outcome in \`validationPassed\` and what you ran in \`detail\`. A no-op rebase runs none and reports \`validationPassed: true\`. ${prePush
    ? "A failure here stops the run before the review verdict or the push can rest on the replay"
    : "A failure here stops the run rather than handing a fixer a branch that does not build for reasons it did not cause"} — report it rather than fixing it, and name the recovery ref so the maintainer can get back. If you redirect any build output to a file, create a UNIQUE directory for it first, OUTSIDE the checkout (\`mktemp -d "\${TMPDIR:-/tmp}/rebase-${point}.XXXXXX"\`) — never a fixed shared scratchpad name, since one session's agents share that directory and a fixed one has crossed results between concurrent runs before.

Change nothing else: no commits of your own, no push, no PR mutation, no branch creation or deletion. Report \`ok\`, \`halted\`, \`noop\`, \`effectiveBase\`, \`before\`, \`after\`, \`recoveryRef\`, \`recoveryTip\`, \`validationPassed\`, \`detail\`, and \`question\` when you halted.`;
}

// The fix -> review -> fix loop is the nested wf-review-cycle's, not this
// script's. These two builders supply only the PR-specific scope: the round-1
// assignment with its per-thread report contract (which rides the cycle's
// untyped `workReport` — hence the explicit field list; the cycle's own
// schemas cannot require consumer fields), and the disposition-verification
// criteria the cycle hands verbatim to its reviewer AND its codex peer.
function fixInstructions(packet) {
  return `You are addressing review feedback on PR #${packet.pr.number} (base \`${packet.pr.base}\`). The PR's remote head ref is \`${packet.pr.branch}\`; that is the push target, which may be a different name for a local off-shoot — edit only the checked-out branch named in the contract above, never the remote ref name.

This run is unattended (hands-off): decide low-stakes ambiguity best-effort and record it; for high-stakes ambiguity that needs an authoritative decision, do NOT guess — mark the item \`ambiguous-skipped\` and leave it open.

Triage each work item into exactly one kind and act:
- \`actionable-fixed\` — implement the fix. Commit at logical milestones; keep commits buildable where practical.
- \`already-addressed\` — current code already satisfies it; note where.
- \`push-back\` (should be rare) — the comment is wrong/misunderstands context. Do NOT implement; draft a respectful, specific rationale. Never implement a fix you believe is wrong just to clear a comment.
- \`deferred-to-task\` — the concern is real but fixing it here would expand the PR's scope considerably while the branch is defendable as it stands (builds, covers its main paths), or a maintainer reply/decision comment defers it. Do NOT implement; write a standalone follow-up task file instead, per the write-tasks skill conventions: place it in the repo's task folder (commonly \`tasks/\`; parked work in its deferred subfolder, e.g. \`tasks/deferred/\` — follow the repo's existing layout), number it to continue the existing sequence, restate the concern and link the PR thread — that link permanently anchors the exact line under review, so the task body anchors code references to named symbols per those conventions and stays true after the branch moves — and commit it on this branch SEPARATELY from code-fix commits. Never use this to dodge a cheap fix.
- \`ambiguous-skipped\` — needs an authoritative decision you cannot make here.

A thread asking you to DOCUMENT some behavior is satisfied by a minimal why-comment under the cycle's comment rule (\`actionable-fixed\`), or — where no comment would earn its keep — by \`push-back\`; never by adjacent code re-implemented in prose. There is no reply-only kind: the fuller rationale rides the \`detail\` whichever kind you chose already replies with, so pick the kind that is true of the committed code rather than the one that suits the reply. Where such a push-back is sustained, that rule's carve-out for a standing overruled decision is worth the comment precisely here: an external reviewer re-raises the same point across PR rounds and runs, and this run's replies are not in front of it next time.

Preclude repeat comments: for each pattern you fix, grep the PR's changed files and closely related code for the SAME offending pattern and fix those too; report them in \`proactive\`.
Do NOT push, reply, resolve, or comment on the PR — publication is a separate, later step.

Per-item report contract: return EXACTLY ONE \`workReport\` entry per work item — never a second entry for a thread you already reported, since publication would post both replies and resolve on whichever it routed first. Each entry carries: \`type\` (echoed from the item, so \`review-thread\` or \`standalone\`; publication can route no other value, and an entry typed anything else is rejected before publication); \`threadId\` and \`commentId\` (MANDATORY for \`review-thread\` items; publication cannot reply/resolve without them); \`url\` (a \`standalone\` entry's identity, MANDATORY there — echo the gathered item's url VERBATIM; an entry naming a url that was never gathered is untriaged work and is rejected before publication. On a \`review-thread\` entry it is the thread's permalink, for the record); \`ref\` (file:line + author, human-readable); \`kind\` (the disposition kind above); \`detail\` (for fixed: one line + commit sha; for already-addressed: where it's handled; for push-back: the rationale; for deferred: the committed task file path + one-line scope, and whether the deferral was maintainer-directed or agent-proposed; for ambiguous: what decision is needed); \`authorIsBot\` (echoed VERBATIM from the gathered item; MANDATORY — publication uses it to decide whether a push-back/deferred thread may be auto-resolved, so never omit it; if the gathered item lacked it, use false, the safe human default); \`author\` (the comment author's login, echoed VERBATIM — include it for \`standalone\` items too); and \`newFinding\` — true ONLY when the item surfaces a real concern not previously raised on this PR (typically an \`actionable-fixed\`, or a genuinely new \`deferred-to-task\`/\`already-addressed\`); false for a \`push-back\` (the comment was wrong), a re-raise of a concern already deferred to a committed task file, or a bot re-arguing a push-back it already lost — UNLESS the thread carries a genuinely new angle this round. (\`newFinding\` drives the \`ping-contributing\` flag, which re-pings a bot only when it brought a new finding this round; set it honestly even if no ping was requested.)

Which of those fields are structurally enforced: every field publication acts on is re-checked before anything is pushed, and one bad entry aborts the whole publication — \`type\`, \`kind\`, \`detail\`, \`author\`, \`authorIsBot\`, \`newFinding\`, a \`review-thread\` entry's \`threadId\`/\`commentId\`, and a \`standalone\` entry's \`url\`. The identifying ids are matched against the gathered items, and the two echoed fields (\`author\`, \`authorIsBot\`) are compared against the item they came from — so echo what you were handed rather than what you judge to be more accurate. \`ref\` is not required at all, and neither is a \`review-thread\` entry's \`url\` nor a \`standalone\` entry's \`threadId\` — those two are only checked for not naming some OTHER gathered item, which would make one entry read as covering two. Write them anyway: \`ref\` is what names an entry in the run's own report, including when some other field gets that entry rejected.`;
}

// After the PRE-PUSH rebase replayed something, the verdict that just passed
// describes a tree nobody will push, so the cycle runs once more over the same
// items — as a RE-VERIFICATION rather than a re-triage. A fresh triage of
// threads this run already fixed would relabel those fixes `already-addressed`,
// and publication would then reply "already handled" for work this run did. The
// per-item report contract is `fixInstructions` verbatim below, so the coverage
// and publishability checks read this cycle's report exactly as the first's.
//
// `priorReport` is the FIRST cycle's `workReport`, embedded verbatim in both
// briefs. Without it neither role can do what it is told: the cycle's scope
// contract carries `{ title, instructions, reviewInstructions, items }` and the
// items are the gathered threads, which hold no disposition fields — so a fixer
// ordered to carry dispositions forward would have to reconstruct them from the
// tree (the re-triage this round is not) and a reviewer told to catch a quiet
// relabel would have no baseline to compare against.
function rebaseReverifyInstructions(packet, rebase, priorReport) {
  return `## This branch was rebased AFTER these dispositions passed review

Every work item below was already triaged, acted on, and reviewed to a pass — on the base the branch sat on before. The branch has since been rebased onto \`${rebase.effectiveBase}\` (${rebase.detail || "no detail reported"}), so this round exists to confirm each disposition still holds on the replayed tree and to fix what the replay broke. It is NOT a fresh triage.

- Carry every disposition forward UNCHANGED unless the replay actually invalidated it: same \`kind\`, same identifiers, same \`author\`/\`authorIsBot\`, same \`newFinding\`. Take those values from the report below rather than re-deriving them from the tree, and update \`detail\` only where a commit sha moved or the answer genuinely changed. Where an item below carries no entry in that report, triage it under the per-item contract that follows.
- Do NOT relabel a fix you can still see in the tree as \`already-addressed\`: publication would reply "already handled" for work this run performed.
- Fix only fallout — a conflict resolution that dropped part of a fix, a build or test the replay broke. The one honest relabel is a fix git's patch-id dropping removed because the new base now carries an equivalent: that IS \`already-addressed\`, and \`detail\` says where the base carries it.

### The dispositions that passed on the previous base — carry these forward

${JSON.stringify(priorReport || [], null, 2)}

${fixInstructions(packet)}`;
}

function rebaseReverifyCriteria(rebase, priorReport) {
  return `${reviewCriteria()}

This tree was REBASED onto \`${rebase.effectiveBase}\` after those dispositions passed a round on the previous base, so your verdict is the one that describes what gets pushed. Two things beyond the criteria above: confirm the replay preserved every fix (a hunk-level resolution can silently drop half of one, and a whole-file resolution can delete a sibling's already-shipped behavior with no conflict marker left behind), and confirm no disposition was quietly relabeled by the round after the rebase — a fix still visible in the tree, reported as \`already-addressed\`, publishes the wrong reply. The set that passed before the rebase is below verbatim; it is the baseline you compare this round's report against, entry by entry, and a changed \`kind\`, identifier, \`author\`/\`authorIsBot\` or \`newFinding\` that the replay does not account for is a blocking issue.

### The dispositions that passed on the previous base — the baseline

${JSON.stringify(priorReport || [], null, 2)}`;
}

function reviewCriteria() {
  return `The work items are unresolved PR review threads (plus any explicitly included standalone items), and the fixer's \`workReport\` proposes a disposition \`kind\` per item. Independently confirm each:
- \`actionable-fixed\` / \`already-addressed\` claims must actually hold in the committed code.
- \`push-back\` must be technically justified, not a convenient dismissal.
- \`deferred-to-task\` must point at a committed task file that genuinely covers the concern, with the deferral itself justified (maintainer-directed, or genuinely scope-expanding while the branch builds and covers its main paths) — not an evasion of a cheap fix.
- \`ambiguous-skipped\` must genuinely require an authoritative decision.
Every gathered work item must have EXACTLY ONE \`workReport\` entry (a \`review-thread\` matched by its \`threadId\`, a \`standalone\` by its \`url\`): an item with none was silently dropped, and an item named by two entries carries dispositions publication cannot choose between — it would post a reply per entry and resolve on whichever it routed first. Either is a blocking issue. So is one entry naming TWO gathered items — a \`review-thread\` entry that also carries a gathered standalone's \`url\`, or a \`standalone\` entry that also carries a gathered \`threadId\` — since that reads as covering both while publication only ever serves one.
Each entry's \`author\` and \`authorIsBot\` must match the gathered item they are echoed from — they decide which bot is re-pinged and whether a thread may be auto-resolved, so a "corrected" value is a blocking issue even when it looks more accurate.
You may reclassify any item.`;
}

// A deviation from a locked decision LEADS the summary comment: the maintainer
// ratifies it or asks for conformance, so anything that buries it below the fix
// list is how it goes unseen — and publication never corrects one on their
// behalf. The cycle reports the ones still standing at the end, not every one
// ever raised, so this is the final state rather than a round's history.
// The reviewer's half of that protocol travels with them: the maintainer is
// being asked to ratify or conform, and the two things that decision needs —
// whether an in-spec route existed, and which way the reviewer leaned — are
// produced by the round that passed the deviation. Publishing the deviation
// without them hands over the implementer's half alone, which is the shape the
// cycle spends a whole extra round avoiding.
// `preRebaseRecordOnly` is the SUPERSEDED cycle's record, and it is a separate
// parameter because this comment is the run's only PR-facing surface and a
// re-verified run has two cycles behind it. The re-verification replaces the
// verdict, never the fact that the first cycle's delivery run FAILED, so
// reading `cycle.recordOnly` alone would publish one record and drop the other
// — the gate that permits the evidenced-unrelated disposition being precisely a
// promise that the maintainer sees it.
function publishPrompt(packet, dispositions, flags, deviations, deviationAssessments, recordOnly, preRebaseRecordOnly) {
  const dev = Array.isArray(deviations) ? deviations : [];
  const assessments = Array.isArray(deviationAssessments) ? deviationAssessments : [];
  const deviationLead = dev.length
    ? `\n\n## Locked-decision deviations — LEAD the summary comment with these\n\nOpen the comment with a "Deviation from a locked decision" section carrying these verbatim, above everything else. Each is the maintainer's to ratify or ask conformance on; publication neither corrects nor softens one.\n\n${JSON.stringify(dev, null, 2)}${
        assessments.length
          ? `\n\nThe reviewing round's assessment of each — carry \`inSpecRoute\` and \`recommendation\` into that same section, beside the deviation they name, so the maintainer reads both halves at once. Relay them; do not re-argue or soften one.\n\n${JSON.stringify(assessments, null, 2)}`
          : `\n\nThe review cycle recorded no assessment for these (it stopped before a round passed over them), so the section carries the implementer's half only — say so plainly rather than supplying a judgment of your own.`
      }`
    : "";
  // The cycle concluded over a FAILED delivery run (the flake rule's
  // evidenced-unrelated disposition), and — where there was one — over the
  // tolerated post-run flake commit no fresh reviewer saw. The gate that
  // permits that requires the failure to be documented where the maintainer
  // sees it, and this comment is this run's only PR-facing surface.
  // A run whose pre-push rebase replayed anything has TWO cycles behind it, and
  // the second one's verdict supersedes the first's without superseding its
  // failure — so both records are rendered here, the earlier one labelled as
  // the cycle it replaced. Its unreviewed-commit claim is corrected upstream
  // (see `reverifiedRecord`), so the body it renders is already the no-commit
  // shape; nothing here re-describes a commit a fresh reviewer has since read.
  const flakeBody = (record) =>
    `The review cycle concluded over a FAILED delivery run, on its evidenced-unrelated flake disposition${record.range ? `, and over a final commit (\`${record.range}\`) no fresh reviewer saw — the diagnosis-only follow-up task that failure earned` : ", and over no post-run commit this record points you at, so cite none"}. Carry a section under this exact heading in the summary comment with these verbatim, so the maintainer sees the gap and decides how to absorb it; do not re-diagnose, soften, or omit it.\n\n${JSON.stringify({ note: record.note || "", ...(record.range ? { rangeCheck: record.verified || "" } : {}) }, null, 2)}`;
  const flakeRecord = recordOnly || preRebaseRecordOnly
    ? `\n\n## Delivery-run failure — recorded, not reviewed\n\n${[
        ...(recordOnly ? [flakeBody(recordOnly)] : []),
        ...(preRebaseRecordOnly
          ? [`**The cycle before the pre-push rebase**, whose verdict the re-verification over the rebased tree replaced — the delivery run it concluded over still failed, so it belongs in this same section rather than only in the run's result. ${flakeBody(preRebaseRecordOnly)}`]
          : []),
      ].join("\n\n")}`
    : "";
  // Where publication happens is the gather step's choice, not this brief's:
  // in worktree mode the branch is checked out THERE, and the main checkout is
  // on something else entirely — so a publisher that resolved the branch itself
  // would re-check, lease against, and push a tree this run never touched.
  const where = packet.pr && packet.pr.worktree
    ? `Your working location is the worktree \`${packet.pr.worktree}\`. Before anything else, \`cd\` into it and verify \`git rev-parse --show-toplevel\` prints exactly that path; if not, STOP and report. Every command below — the re-check, the push, and the git reads behind it — runs there. Do NOT touch the main checkout: it is on another branch and is none of this run's business.`
    : `You work in the repository's current checkout, which is on the branch this run addressed — do NOT create a worktree and do NOT switch branches.`;
  return `Publish the addressed review for PR #${packet.pr.number} (branch \`${packet.pr.branch}\`). A fresh reviewer has PASSED. Read \`AGENTS.md\` / \`CLAUDE.md\` first.

${where}

${DEPUTY_FINISH_IN_TURN}

${DESTROY_BOUNDARY}

Flags for this publication: ${JSON.stringify(flags)}.

Report a STRUCTURED result: set \`published: true\` ONLY if the push and every required reply/resolve/summary/ping below succeeded. If any guard aborts you, set \`published: false\` and \`aborted: "<reason>"\` and report what (if anything) was pushed — never claim success on an aborted publication.

1. Re-check before publication: clean worktree, no rebase in progress; re-fetch the PR and confirm it is still open and still points at the expected head repo/ref. Resolve the branch's exact push remote/ref and verify it matches the PR head (never assume \`origin\`, especially for forks). Expected head OID to replace: \`${packet.pr.headOid}\`. If the head moved or the target can't be matched, set \`published: false\`, \`aborted\`, and STOP — do not guess.
2. Push. Establish which of THREE cases you are in before running any push, and never skip ahead to the lease. If HEAD is a PROPER ANCESTOR of the expected tip \`${packet.pr.headOid}\`, the remote branch is ahead of you: there is nothing of yours to publish, a normal push cannot fast-forward it, and the lease below is the trap — it MATCHES, so it succeeds and rewinds the branch, deleting the newer remote commits. Set \`published: false\`, \`aborted: "local behind PR head"\`, and STOP without pushing, exactly as for a rejected lease. Otherwise: if the expected tip is an ancestor of HEAD, normal push (\`git push <remote> HEAD:refs/heads/${shq(packet.pr.branch)}\`). If history was rewritten (rebased: ${packet.pr.rebased ? "yes" : "no"}), use an exact lease: \`git push <remote> --force-with-lease=refs/heads/${shq(packet.pr.branch)}:${shq(packet.pr.headOid)} HEAD:refs/heads/${shq(packet.pr.branch)}\`. If the lease is rejected, NEVER escalate to bare \`--force\`; set \`published: false\`, \`aborted: "lease rejected"\`, and stop.
3. Re-read unresolved threads after the push. Do not mutate newly-arrived feedback that was not triaged this run — leave it open and call it out.
4. Per-item hygiene for each disposition:
   - \`review-thread\` items: reply via REST \`pulls/.../comments/<commentId>/replies\`, resolve via GraphQL \`resolveReviewThread\` on \`threadId\`:
     - actionable-fixed → reply \`Fixed in <sha>: <one line>\` AND resolve.
     - already-addressed → reply pointing to where it's handled AND resolve.
     - push-back → reply with the rationale; resolve ONLY when the disposition's \`authorIsBot\` is true (a bot thread), and leave a thread with \`authorIsBot\` false (human) open unless explicitly authorized. Use that flag, not a guess from the author login.
     - deferred-to-task → reply citing the committed task file (\`Deferred to <task file>: <one line>\`); resolve when the deferral was maintainer-directed or \`authorIsBot\` is true, else leave the human thread open. Never re-implement a deferred thread.
     - ambiguous-skipped → leave open.
   - \`standalone\` items (no thread to resolve): address them only in the Summary comment below; do NOT call \`resolveReviewThread\`. Record their outcome by \`url\`.
   Avoid duplicate replies (check for an equivalent prior reply by the authed user); resolve only after the reply succeeds.
5. Summary comment: post a top-level "Summary of Review Fixes" (\`gh pr comment\`) — ${dev.length ? "opening with the locked-decision deviation section defined below, then " : ""}what was fixed (with proactive same-pattern fixes), a prominent "Pushed back — please re-examine" section, a "Deferred to follow-up tasks" section listing each deferral with its committed task file (agent-proposed deferrals flagged for confirmation), and any ambiguous/skipped or newly-arrived items${recordOnly || preRebaseRecordOnly ? ", plus the delivery-run failure section defined below" : ""}. Write "codex"/"claude"/"copilot" plain (no bare @-mentions) so only the dedicated pings below trigger a re-review. Put its URL in \`summaryCommentUrl\`.
6. Pings (only after push + summary succeeded, AND only when the push ACTUALLY advanced the remote branch with new commits or rewritten history — never on an \`Everything up-to-date\` no-op push): ${flags.pingCodex ? "post a dedicated comment \`@codex review\`. " : ""}${flags.pingClaude ? "post a dedicated comment \`@claude review\`. " : ""}${flags.pingCopilot ? "request a fresh Copilot review with \`gh pr edit <PR#> --add-reviewer @copilot\` (the canonical CLI request; needs gh >= 2.88.0). Do NOT post an \`@copilot review\` comment — a bare \`@copilot\` mention drives Copilot's coding agent (it can start editing the branch), not its reviewer. The add-reviewer request re-triggers Copilot's review even on a PR it already reviewed (tested working — not a silent no-op), and never misfires into the coding agent. GUARD: before issuing it, confirm the installed \`gh\` supports the \`@copilot\` reviewer value (gh >= 2.88.0 — e.g. check \`gh --version\`); on an older powbox base image where \`gh pr edit --add-reviewer @copilot\` errors, SKIP the Copilot request WITHOUT failing publication — the push and summary already succeeded, so this is non-fatal: keep \`published: true\`, record it in \`pings\` as 'copilot: skipped (gh too old)', and note that the base image needs refreshing (\`agent-update\`) or a one-off manual re-request from the PR's web reviewer menu." : ""}${!flags.pingCodex && !flags.pingClaude && !flags.pingCopilot ? "none requested. " : "If more than one ping was requested, perform each as its own dedicated action (never one comment mentioning several bots). "}If nothing new was pushed this run (the remote ref already pointed at your HEAD — e.g. every disposition was already-addressed/push-back, or the branch was up to date), SKIP all pings even if requested above: re-requesting a review with nothing new to look at would spin the review->address->review loop forever. Set \`pushedNewCommits\` to whether the push advanced the branch, and record which pings (if any) you posted in \`pings\`.${deviationLead}${flakeRecord}

## Dispositions to publish

${JSON.stringify(dispositions, null, 2)}

Record each item's outcome with its stable reference (file:line, author, threadId or url) in \`threadOutcomes\`.`;
}

// The one deputy whose whole job is giving the worktree back. It runs only on
// paths where the run FINISHED — published, a local-only pass, or a no-op —
// because a halted run's tree is the evidence a maintainer resumes from, and
// `pr.worktree` reports it in that result instead. Removal loses nothing
// either way: the branch ref and its commits live in the shared `.git`, which
// is also why the branch is never deleted (it is the PR's head). The brief
// REFUSES rather than forces, for the same reason `wt-remove` does.
function reclaimPrompt(worktreePath, prNumber, why) {
  return `Reclaim the git worktree this review-addressing run worked in. This is the run's last step; it changes nothing else.

${DEPUTY_FINISH_IN_TURN}

${DESTROY_BOUNDARY}

Worktree: \`${worktreePath}\` (slug \`pr-${prNumber}\`, PR #${prNumber}). Why now: ${why}.

1. Verify \`git -C ${shq(worktreePath)} rev-parse --show-toplevel\` prints exactly that path. If it does not, remove NOTHING and report \`removed: false\` with what you saw.
2. Refuse rather than force. \`git -C ${shq(worktreePath)} status --porcelain\` must print nothing, and no Git operation may be in progress there (\`rebase-merge\`/\`rebase-apply\` paths, \`MERGE_HEAD\`, \`CHERRY_PICK_HEAD\`, \`REVERT_HEAD\`, \`BISECT_LOG\` — a tree left mid-rebase prints empty porcelain). If anything is held, remove NOTHING: report \`removed: false\` and what is held, so the maintainer can look at it.
3. Otherwise remove it: \`wt-remove pr-${prNumber}\` where \`command -v wt-remove\` finds the helper (it enforces at least those refusals itself), else \`git worktree remove ${shq(worktreePath)}\` followed by \`git worktree prune\`. NEVER \`--force\`, and NEVER delete the branch — it is the PR's head, and removing the worktree leaves its commits and its ref untouched in the shared \`.git\`.

Report \`removed\`, the \`path\`, and one line of \`detail\`.`;
}

// --- Flag parsing (the only logic the script does itself; no shell needed) ---
// `args` may arrive as a string OR, per the workflow docs, as structured data
// (array / object). Flatten any shape into the words it contains so `push` /
// `ping-codex` / `ping-claude` / `ping-copilot` survive `Run
// /dev-skills:wf-address-review on #38 with push` being delivered as an
// object — `String(args)` would yield "[object Object]".
function flattenArgs(a) {
  if (a == null) return "";
  if (typeof a === "string") return a;
  if (Array.isArray(a)) return a.map(flattenArgs).join(" ");
  if (typeof a === "object") return Object.values(a).map(flattenArgs).join(" ");
  return String(a);
}
const raw = flattenArgs(args);
// Every flag below is read from THIS text rather than from the request as
// written, because one construct in the request carries a value that is not
// flag text at all: `rebase on top of <target>` names a ref, and an ordinary
// ref component is spelled exactly like one of these flags. `rebase on top of
// feature/no-rebase` set `noRebase` and suppressed the very rebase it asked
// for, silently ignoring the target the gather went on to report; `fix/no-push`
// and `wip/ping-codex` are the same defect on the other flags. So the target
// VALUE is elided once, here, ahead of all of them — one construct removed
// rather than a guard bolted onto each flag.
// The VALUE only. The words `rebase on top of` stay exactly where they are,
// because a negation governing them is a real opt-out that must still be read:
// `do not rebase on top of main` means no rebase, and eliding the phrase
// wholesale would turn that request into a rebase onto `main` — a false
// negative traded for the false positive, which is not a fix. Nothing else is
// stripped: this is the one construct in the argument grammar that carries a
// free-form value, so the elision is bounded to it and does not generalize into
// heuristic context-stripping (quotes, negations, path shapes), which has been
// measured to admit the phrases it meant to reject while rejecting genuine ones.
// The value ends at a SEPARATOR, not merely at whitespace: this parsing is
// documented as lenient over commas and `&` (`address-review` → Arguments, and
// the gather brief below says so to the agent), so `rebase on top of
// main,no-push` is an ordinary way to write the request — and a value taken to
// the next space would swallow the `no-push` with the target and publish a run
// the maintainer asked to keep local, which is the one direction the default
// must never get wrong. Git does permit both characters IN a ref name, so a
// branch actually called `feature,x` keeps only its first component elided —
// residue that reaches a flag only where the rest is itself spelled like one,
// the same bounded leak the whitespace form already left for a target written
// as several words. The elision is still ONE value, once: it is not widened to
// swallow whatever follows a separator, which would be the context-stripping
// this comment rules out.
const flagText = raw.toLowerCase().replace(/(\brebase[\s-]*on[\s-]*top[\s-]*of\s+)[^\s,&]+/g, "$1");
// Publish-by-default model (changed): a bare run now PUBLISHES and re-pings the
// contributing bots — i.e. it behaves like `ping-contributing`. The flags adjust it:
//   (nothing)                 -> push + ping the contributing bots   (the default)
//   ping-contributing         -> same as the default (redundant, kept for reference)
//   push                      -> push, ping NOBODY (publish quietly)
//   ping-codex|claude|copilot -> push + ping exactly those (overrides contributing)
//   no-push                   -> local-only; mutate no PR at all (the pre-change default)
// `no-push` WINS: it is the only way to suppress the now-default push, so honor it
// even when combined with a (contradictory) ping flag.
//
// Reliability: the canonical flags are single tokens (`push`, `no-push`,
// `ping-codex`, ...), but parsing is lenient over free prose, so guard the real
// collisions. (1) `push-back` is the rebuttal DISPOSITION, never a git push — strip
// it in every spacing and inflection (`pushback`, `push-back`, `push back`,
// `pushed/pushes/pushing back`) BEFORE reading the push token, so a comment like
// "push back on #2" is never misread as publish intent. (2) Match each flag with
// `[\s-]*` between its halves so spaced forms count too (`ping codex`, `no push`),
// not only the hyphenated/joined ones. A spelled-out `push` still means "publish,
// but ping nobody"; pings imply push; only a negation (`no-push`, `no push`,
// `do not push`, `don't push`, `without push`, `skip push`, `cannot push`) opts out.
// (3) Negations are tested against a further-normalized copy in which the surviving
// PRESENT-tense inflections collapse to the bare token, so `no pushing` and `without
// pushing` opt out exactly like `no push` — an opt-out this explicit must never fall
// through to a publish. `pushed` is deliberately NOT normalized: the past tense
// describes what already happened rather than what to do, and it sits next to a
// negation in ordinary prose that means the opposite of an opt-out ("the fixes are
// not pushed yet, so push them when done") — collapsing it would turn an explicit
// publish request into a local-only run. The positive token below reads the
// un-normalized text for the same reason, so an incidental `I already pushed that
// branch` cannot silently suppress the pings the way a deliberate `push` flag does.
const pushWords = flagText.replace(/\bpush(?:ed|es|ing)?[\s-]*back\b/g, " ");
const pushNegWords = pushWords.replace(/\bpush(?:es|ing)\b/g, "push");
const noPush =
  /\bno[\s-]*push\b/.test(pushNegWords) ||
  /\b(?:not|never|without|skip|cannot|can't|cant|dont|don't|do not)\b[\s-]*push\b/.test(pushNegWords);
// `peer-opinions=off` suppresses the nested cycle's cross-harness peer stage;
// it must arrive through args (the workflow cannot read prose elsewhere).
const peerOffTok = /\bpeer[\s-]*opinions?\s*=\s*off\b/.test(flagText);
// The one token that may put this run on a branch that is NOT the PR's head ref.
// The gather agent acts on it, but the caller parses it here too, because the
// gather's own report cannot be the evidence that it was given: `workingBranch`
// differing from `branch` is the ONLY thing that tells the reconciliation gate
// below to skip, and a gather that made the history-shape inference its brief
// forbids reports exactly that shape from a request that never selected it.
//
// This one token reads the RAW request rather than `flagText`, and is the only
// one that does. The elision above exists because a ref component spelled like
// a flag silently flips that flag; this token's two errors are not symmetric in
// that way, and the residual was measured rather than assumed. A false positive
// only DISABLES this guard for that one run, leaving exactly the behaviour that
// shipped before the guard existed. A false negative STOPS a run the request
// genuinely selected, with `skipped-unselected-working-branch` — refusing the
// supported case outright, and reading as the guard working. So the accepted
// residual is stated rather than narrowed: a request that mentions an off-shoot
// without selecting one — a ref path (`rebase on top of
// task/021c-publication-guard-for-an-off-shoot`), a quoted phrase, a negation —
// disables the guard for that run. Reading it from `flagText` would remove the
// ref-path row specifically, which is why it is NOT read from there: that row
// is pinned as a mention that still selects, so narrowing it here would flip a
// check by name. What the guard is for, and still catches, is the shape it was
// added for: a gather that deviates on a request which never says `off-shoot`.
//
// A narrowing pass over that text (strip ref paths, quoted phrases, negations,
// the way `pushWords` strips `push-back` before reading `push`) was written and
// REMOVED, and it is not to come back in that form: measured against the
// shipped gate it bought 4 of 10 incidental mentions while breaking 3 of 14
// genuine selections — `off-shoot/no-push` and `use "off-shoot mode"` were
// stripped whole, and the categories leaked anyway (`no off-shoot`, `do not use
// off-shoot mode`, and `rebase onto off-shoot-guard` all still selected). Both
// its directions are pinned in `scripts/test-address-review-reconcile.mjs`, so
// a re-narrowing that reintroduces either has to fail a check by name first.
const offShootTok = /\boff[\s-]*shoots?\b/.test(raw.toLowerCase());
const pingCodexTok = /\bping[\s-]*codex\b/.test(flagText);
const pingClaudeTok = /\bping[\s-]*claude\b/.test(flagText);
const pingCopilotTok = /\bping[\s-]*copilot\b/.test(flagText);
const pingContribTok = /\bping[\s-]*contributing\b/.test(flagText);
const anyNamedPing = pingCodexTok || pingClaudeTok || pingCopilotTok;
// A positive `push` token — only meaningful when not negated (a negation set noPush
// above). Spelling out `push` means "publish, but ping nobody".
const explicitPushToken = /\bpush\b/.test(pushWords);
const wantPush = !noPush;
// Effective ping-contributing: the bare default and an explicit `ping-contributing`
// both ping the contributing set; a spelled-out `push` (with no contributing token)
// pings nobody; a named ping handles its own bots. Forced false on a no-push run.
const pingContributing =
  wantPush && (pingContribTok || (!anyNamedPing && !explicitPushToken));
// `no-rebase` opts out of BOTH rebase points. Rebasing is otherwise the default
// here, so the only token that can suppress it is a negation — there is no
// positive `rebase` flag to read, since `rebase on top of <branch>` names a
// TARGET rather than switching the behavior on, and the gather agent reports
// that target as free text (lenient parsing is its job, not this regex's) —
// which is also why that target's value is gone from `flagText` by the time
// these two read it, and why `do not rebase on top of main` still opts out.
// Present-tense inflections collapse the same way `no-push` handles them, so
// `no rebasing` and `without rebasing` opt out exactly like `no-rebase`.
const noRebase =
  /\bno[\s-]*rebas(?:e|ing)\b/.test(flagText) ||
  /\b(?:not|never|without|skip|cannot|can't|cant|dont|don't|do not)\b[\s-]*rebas(?:e|ing)\b/.test(flagText);
const flags = {
  push: wantPush,
  noRebase,
  peerOff: peerOffTok,
  pingCodex: wantPush && pingCodexTok,
  pingClaude: wantPush && pingClaudeTok,
  pingCopilot: wantPush && pingCopilotTok,
  pingContributing,
};

phase("Gather");
const packet = await agent(gatherPrompt(args), { label: "gather", schema: PACKET_SCHEMA });
if (!packet) {
  return { error: "Gather phase failed (agent returned nothing)." };
}
if (!packet.ok) {
  // A blocker raised AFTER the gather attached or reused a worktree leaves that
  // tree standing — halting is what keeps it — and this exit runs before the
  // location pair is validated, so the path is read defensively and surfaced in
  // the `note` a maintainer reads first rather than only inside `pr`. Nothing is
  // reclaimed here: the tree is what they inspect, and what a re-run resumes in
  // while it holds the PR head — the one attach that ends on some other ref
  // hands its tree back itself rather than leaving the slug blocked.
  const held = packet.pr && typeof packet.pr.worktree === "string" ? packet.pr.worktree.trim() : "";
  return {
    error: "Stopped before any change to the PR or its branch.",
    blocker: packet.blocker || "(unspecified)",
    pr: packet.pr,
    ...(held
      ? { note: `The worktree \`${held}\` was attached for this run and is still standing; nothing here removes it — inspect it, then remove it by hand, or re-run, which resumes in it while it holds the PR's head ref and stops naming it rather than adding over it otherwise.` }
      : {}),
  };
}
// The schema requires `pr` fields, but a schema-valid agent can still omit the
// object; validate before any phase dereferences packet.pr.* so an incomplete
// response is a reported failure, not a thrown crash.
// `url` is in that list because the rebase brief hands it to the delegated step
// as the identity of the repository the base ref is fetched FROM (a PR's base
// lives in the PR's own repository, and its URL names that repository
// explicitly). Absent, the brief would interpolate `undefined` there and the
// step would be back to re-deriving the repository from its working directory,
// which in a fork clone is the head fork.
if (!packet.pr || packet.pr.number == null || !packet.pr.branch || !packet.pr.workingBranch || !packet.pr.base || !packet.pr.url) {
  return { error: "Gather succeeded but returned incomplete PR metadata (need number, url, branch, workingBranch, base).", pr: packet.pr || null };
}
// headOid is only consumed by the publish lease, so require it specifically when
// a push is requested — its absence would otherwise interpolate `undefined` into
// the expected-head check and the --force-with-lease, defeating remote-movement
// protection only AFTER fixes were made. Catch it before any work starts.
if (flags.push && !packet.pr.headOid) {
  return { error: "Push requested but gather returned no pr.headOid; refusing to proceed without the expected-head OID needed for a safe --force-with-lease.", pr: packet.pr };
}
// The working location, per the gather brief's "Pick the WORKING LOCATION"
// step. Everything after this — the nested cycle, the publisher, the reclaim —
// is pointed at it, so the pair is validated once here rather than trusted at
// each use, and there is NO default in either direction. Reading an absent
// `locationMode` as `inline` looks like the safe fallback (it asserts no path)
// and is not: a gather that attached a worktree and then failed to report the
// pair would hand the cycle `worktree: ""`, i.e. the main checkout, which in
// that mode is not on the PR branch at all and may be dirty or mid-anything —
// and the fixer would commit wherever it landed. Absence and an unrecognized
// value are therefore the same stop, before any phase is dispatched. So is
// `worktree` mode with no absolute path, and so is an inline report carrying a
// path: one of those two is wrong and there is no way to tell which, so a run
// that would work in the checkout while reporting a worktree (or the reverse)
// stops rather than picking.
const locationMode = packet.pr.locationMode;
const worktreePath = typeof packet.pr.worktree === "string" ? packet.pr.worktree.trim() : "";
if (locationMode !== "inline" && locationMode !== "worktree") {
  return {
    error: `Gather returned no usable pr.locationMode (${JSON.stringify(locationMode === undefined ? null : locationMode)}); it must be exactly \`inline\` or \`worktree\`, and nothing is dispatched on a guess — a gather that attached a worktree without saying so would have the fix land in the main checkout.`,
    pr: packet.pr,
  };
}
if (locationMode === "worktree" && !worktreePath.startsWith("/")) {
  return {
    error: `Gather reported worktree mode but no absolute pr.worktree path (${JSON.stringify(packet.pr.worktree === undefined ? null : packet.pr.worktree)}); refusing to run the cycle in the main checkout, which in that mode is not on the PR branch.`,
    pr: packet.pr,
  };
}
if (locationMode === "inline" && worktreePath) {
  return {
    error: `Gather reported inline mode but also a worktree path (${JSON.stringify(worktreePath)}); one of the two is wrong and nothing here can tell which, so no phase is dispatched.`,
    pr: packet.pr,
  };
}
// Give the worktree back — but ONLY where the run finished. A halt keeps it:
// its tree is what a maintainer inspects or a later run resumes from, and
// `pr.worktree` rides in every result that carries the PR object, so those
// exits report the surviving path without each having to say so. Inline runs
// have nothing to reclaim and spawn nothing.
async function reclaimWorktree(why) {
  if (locationMode !== "worktree") return null;
  phase("Reclaim worktree");
  const reclaimed = await agent(reclaimPrompt(worktreePath, packet.pr.number, why), {
    label: "reclaim",
    schema: RECLAIM_SCHEMA,
  });
  return reclaimed || { removed: false, path: worktreePath, detail: "the reclaim agent returned nothing; the worktree may still be there" };
}
// A refused reclaim is not a failed run — the publication (or the local-only
// pass) still happened, and the status says so. What it must not be is
// discoverable only by reading `worktreeReclaim`: the run FINISHED with a tree
// still standing, which is the one thing a finished run promises not to leave
// behind, so the surviving path rides in the `note` a maintainer reads first.
function survivingWorktreeNote(reclaimed) {
  if (!reclaimed || reclaimed.removed) return "";
  return ` The worktree \`${reclaimed.path || worktreePath}\` was NOT reclaimed and is still standing: ${reclaimed.detail || "no detail reported"}. Nothing here forces it — look at it, then remove it by hand.`;
}
// Before the gate that reads those two branch names: was this run ever entitled
// to a `workingBranch` that differs from `branch` at all? Only the `off-shoot`
// token grants that, and the token arrives in THIS script's args — so it is
// checked against the request rather than inferred from the packet. Without
// this, one gather deviation (the history-shape inference its brief forbids, or
// a plain misread of which branch it stood on) is enough to skip reconciliation
// whole and hand the fixing cycle a stacked child to edit and commit on, whose
// own commits publication would then push onto this PR under `branch`. Nothing
// downstream can catch it: differing names are exactly what the supported case
// looks like, so every later step reads the deviation as the mode working.
if (packet.pr.workingBranch !== packet.pr.branch && !offShootTok) {
  return {
    status: "skipped-unselected-working-branch",
    pr: packet.pr,
    reconcile: packet.reconcile || null,
    detail: `Gather reported working branch \`${packet.pr.workingBranch}\`, which is not PR #${packet.pr.number}'s head ref \`${packet.pr.branch}\`, but the request did not carry the \`off-shoot\` token — the only thing that selects a working branch other than the head ref.`,
    note: "Nothing was addressed and nothing was pushed. Working somewhere the request never named would put this run's commits on that branch and publish them onto the PR's head ref; a run that is genuinely on a local off-shoot names it with `off-shoot`, and one that is not belongs on the head ref.",
  };
}
// Branch reconciliation, per the gather brief's "Reconcile the checked-out
// branch" step. Only a run on the PR's OWN branch reconciles: where
// `workingBranch` differs, the local off-shoot the request selected with
// `off-shoot` is in play, and there "local is behind the PR head" is the normal state
// rather than the hazard the rule fires on. Two outcomes let the run continue
// and EVERYTHING else stops it — including an outcome string this script does
// not know and an absent report — which is what keeps the rule at two probes
// instead of a classifier that would have to name every branch state. It runs
// ahead of the empty-`items` no-op below because outcome 3 returns no items:
// reported as a no-op, an unreconciled branch would read as "nothing to do".
const reconcile = packet.reconcile || null;
const reconcileOutcome = (reconcile && reconcile.outcome) || "";
if (
  packet.pr.workingBranch === packet.pr.branch &&
  reconcileOutcome !== "work" &&
  reconcileOutcome !== "fast-forwarded"
) {
  return {
    status: "skipped-unreconciled",
    pr: packet.pr,
    reconcile,
    detail: `Local branch \`${packet.pr.workingBranch}\` was not reconciled with PR #${packet.pr.number}'s head (outcome: ${reconcileOutcome || "none reported"}): ${(reconcile && reconcile.detail) || "no detail reported"}`,
    note: "Nothing was addressed and nothing was pushed. Put the branch into a state the reconciliation recognises — every commit on the PR head represented in it by patch-id, or strictly behind it — and re-run.",
  };
}
if (!packet.items || packet.items.length === 0) {
  // Carry the reconciliation record here too: on the `fast-forwarded` outcome
  // this run MOVED the local branch, which a bare "nothing to address" hides.
  // A no-op is a finish, so a worktree attached for it is given straight back.
  const reclaimed = await reclaimWorktree("nothing to address; the run is a no-op");
  return {
    status: "no-op",
    detail: `No unresolved threads and no included standalone item — nothing to address (branch reconciliation: ${reconcileOutcome || "none reported"}).${survivingWorktreeNote(reclaimed)}`,
    pr: packet.pr,
    reconcile,
    ...(reclaimed ? { worktreeReclaim: reclaimed } : {}),
  };
}

// --- The two rebase points -------------------------------------------------
// Rebasing onto the freshest base is the DEFAULT here, at two points: now,
// before anything is fixed, so the fixer works the code as it will look when
// merged; and again once the fixes are committed, so the diff a reviewer reads
// at push time is the change rather than the base's drift. Both are
// unconditional on a run that reaches them — the difference from the prose
// skill, where an agent may judge a point unnecessary: a no-op rebase is
// cheaper and more deterministic than the judgment that it would be one.
// "Reaches them" is load-bearing, and it is where this pipeline's ordering
// differs from the skill's step 2 (which rebases before it has even gathered the
// threads): here one agent resolves the PR and gathers them together, so a run
// with nothing to address is already known to be a no-op by this line, and it
// rebases nothing. Rewriting the branch on a path that will neither review nor
// push it would leave the maintainer's branch rewritten, diverged from the PR
// head, with no verdict and no push behind it. A run stopped at the
// reconciliation gate above rebases nothing for the same reason.
// The alternative — rebase first, and send a zero-item change through review and
// publication as the prose skill's zero-item path does — was considered and
// deferred rather than rejected: what makes it correct is a zero-item path that
// reviews and publishes at all, and this script's empty-`items` exit predates
// task 016 and returns a no-op even where the local tip is ahead of the PR head.
// Task 016a carries that, and re-decides this position once it lands.
// `no-rebase` is the only opt-out.
//
// Each point pins its base to a COMMIT and rebases onto that, which is what
// makes two points safe: the second finds the first's base already an ancestor
// of HEAD when nothing moved, and replays nothing. Both resolve the same
// TARGET REF afresh, never the OID the first one pinned — reusing that would
// make the second a guaranteed no-op and defeat the whole point of running it.
// Whether the request NAMED a target is what decides where the delegated step
// resolves it, and the gather reports that fact directly: `rebaseTarget` is the
// token verbatim, empty when the request named none. Read it, never infer it
// from `target !== pr.base` — `rebase on top of main` on a PR based on `main`
// is a redundant-but-legal request whose two names are equal, and inferring
// would hand it the default arm, sending a fetch at the base repository for a
// ref the maintainer named here, in the working location.
const explicitRebaseTarget = typeof packet.rebaseTarget === "string" ? packet.rebaseTarget.trim() : "";
const rebaseTargetRef = explicitRebaseTarget || packet.pr.base;
const rebaseRecord = {
  target: rebaseTargetRef,
  explicitTarget: Boolean(explicitRebaseTarget),
  points: [],
  ...(flags.noRebase ? { suppressed: "`no-rebase` was given: neither point ran, and the branch is addressed and published on the base it already sits on. The review base is that base ref resolved to a commit, since nothing rebased to pin one." } : {}),
};
// Runs one point and returns either `{ rebase }` — the report, with `pr.base`
// already replaced by the pinned OID — or `{ stop }`, a result the run returns
// as it stands. Everything that is not a clean rebase stops the run: a halted
// conflict, a failed one, a broken build, a recovery ref the report cannot name in full or show resolving to the tip
// it started from, and an `effectiveBase` that is not a commit. That last check is the load-bearing one, and it is a check rather
// than trust because the whole run's diff boundaries hang off that field: a
// movable name accepted here reaches the review cycle as a base that a sibling
// push or the next fetch moves, so a reviewer would bound its diff at a tip
// this branch was never rebased onto. None of those paths reclaims the
// worktree: each is a halt, and a halted run's tree is what a maintainer
// resumes from (`pr.worktree` names it in the result).
async function rebasePoint(point, target) {
  phase("Rebase");
  const report = await agent(rebasePrompt(point, packet, target, rebaseRecord.explicitTarget), {
    label: `rebase-${point}`,
    schema: REBASE_SCHEMA,
  });
  // The way back, ESTABLISHED before anything is said about it. The note every
  // stop below carries is where this run tells the maintainer how to get the
  // pre-rebase tip back, so it is built from the same evidence the two checks
  // further down require rather than from the bare presence of a string: a stop
  // that says "your pre-rebase tip is saved at <ref>" about a value nobody
  // checked hands over a name that may point nowhere, which is the failure those
  // checks exist to prevent, restated by the sentence meant to help. It matters
  // most exactly where the run has already lost the tree it started from —
  // `rebase-validation-failed` is reachable with history rewritten.
  // The NAME is checked whole rather than as a prefix, because a prefix test
  // lets through the values that are WORSE than an absent one, since they read
  // as an answer: a truncated `refs/pre-rebase/`, or a leftover ref for some
  // other branch's replay, both start with the right characters while naming no
  // backup of this one. And the name is only half of it: a well-formed one still
  // says nothing about whether the ref was ever created, or where it points. The
  // brief reads it back for exactly that, so the caller has the ref's own OID
  // beside the tip the rebase started from and can require the two to agree —
  // evidence the way back leads where the report says, rather than a string that
  // looks right.
  const recoveryRef = report && typeof report.recoveryRef === "string" ? report.recoveryRef.trim() : "";
  const recoveryPrefix = `refs/pre-rebase/${packet.pr.workingBranch}/`;
  const recoveryStamp = recoveryRef.startsWith(recoveryPrefix) ? recoveryRef.slice(recoveryPrefix.length) : "";
  const recoveryNamed = /^\d{8}-\d{6}$/.test(recoveryStamp);
  const recoveryTip = report && typeof report.recoveryTip === "string" ? report.recoveryTip.trim() : "";
  const preRebaseTip = report && typeof report.before === "string" ? report.before.trim() : "";
  const recoverySaved = recoveryNamed && Boolean(preRebaseTip) && recoveryTip === preRebaseTip;
  const stop = (status, detail, extra) => ({
    stop: {
      status,
      pr: packet.pr,
      rebase: { ...rebaseRecord, stoppedAt: { point, target, ...(report || {}) } },
      detail,
      note: recoverySaved
        ? `Nothing was pushed. The branch is where the rebase left it, and its pre-rebase tip is saved at \`${recoveryRef}\`.`
        : `Nothing was pushed. The branch is where the rebase left it, and this run could NOT establish a recovery ref for it — look for one under \`${recoveryPrefix}\` before doing anything else with the branch.`,
      // Spread LAST so a stop can say something more specific than that pair.
      // `rebase-unverified-recovery-ref` is the one that does: the ref it
      // refused is at least well-formed for THIS branch, so naming it beside
      // what it failed on gives the maintainer one specific name to check
      // rather than the namespace the fallback points at. Whether that ref
      // exists is precisely what this stop could NOT establish — its own note
      // says so — so the name is a lead, not a promise.
      ...(extra || {}),
    },
  });
  if (!report) {
    return stop("rebase-failed", `The ${point} rebase agent returned nothing, so no base can be named for this run.`);
  }
  if (report.halted) {
    return stop(
      "rebase-halted",
      `The ${point} rebase met a conflict beyond the delegated step's competence, aborted it, and left the tree clean and idle.`,
      {
        openQuestions: [
          {
            id: `pr-${packet.pr.number}-rebase-${point}`,
            origin: "rebase",
            blocking: true,
            question: report.question || "(the rebase reported a halt with no question — re-run it, or resolve the rebase by hand)",
            artifacts: [packet.pr.url, `branch ${packet.pr.workingBranch}`, `target ${target}`, ...(recoverySaved ? [recoveryRef] : [])],
          },
        ],
      },
    );
  }
  if (!report.ok) {
    return stop("rebase-failed", `The ${point} rebase could not be carried out: ${report.detail || "no detail reported"}`);
  }
  const pinned = typeof report.effectiveBase === "string" ? report.effectiveBase.trim() : "";
  if (!isFullOid(pinned)) {
    return stop(
      "rebase-unpinned-base",
      `The ${point} rebase reported ${JSON.stringify(report.effectiveBase === undefined ? null : report.effectiveBase)} as the base it landed on, which is not a full commit OID. A ref name cannot be a delegation boundary — it moves — and an abbreviation is a prefix that can go ambiguous or stop resolving, so nothing downstream is dispatched on either.`,
    );
  }
  // `noop: true` is the one value that switches checks OFF — the post-rebase
  // validation just below, and at the pre-push point the whole re-verification
  // of the rebased tree — so it is adopted on its evidence rather than on the
  // flag. Step 4 of the brief orders the no-op reported "with `before` equal to
  // `after`", which is exactly that evidence; a report naming a moved tip, or
  // naming none, has replayed something or cannot say, and either way the two
  // checks it would switch off are the ones standing between that replay and a
  // push nobody validated or reviewed. The tips are compared only with each
  // other, so unlike `effectiveBase` they are not held to the full-OID rule:
  // nothing downstream is dispatched on them.
  if (report.noop === true) {
    const before = typeof report.before === "string" ? report.before.trim() : "";
    const after = typeof report.after === "string" ? report.after.trim() : "";
    if (!before || before !== after) {
      return stop(
        "rebase-unevidenced-noop",
        `The ${point} rebase reported \`noop: true\` while naming ${JSON.stringify(report.before === undefined ? null : report.before)} and ${JSON.stringify(report.after === undefined ? null : report.after)} as the tips before and after it. A no-op is the one report that runs no post-rebase validation and spends no round re-verifying the rebased tree, so it is adopted only on the unchanged tip the brief orders reported beside it.`,
      );
    }
  }
  // Positively, not merely "did not report a failure": the acceptance condition
  // is that build+tests ran after every non-noop rebase, so a replay that
  // reports nothing about validation is as unusable as one that reports a
  // failure — and the two stop the run identically rather than one slipping
  // through as `undefined !== false`.
  if (report.noop !== true && report.validationPassed !== true) {
    return stop(
      "rebase-validation-failed",
      `The ${point} rebase replayed commits without reporting a PASSING post-rebase build and test run (validationPassed: ${JSON.stringify(report.validationPassed === undefined ? null : report.validationPassed)}): ${report.detail || "no detail reported"}`,
    );
  }
  // The way back, required rather than hoped for. Both halves were read above,
  // where the note is built from them; here they decide whether the run goes on.
  // A report that cannot name one has skipped the single `update-ref` the brief
  // spells out or lost the name of it, and adopting it would take the run on to
  // the rewritten history — force-pushed at the pre-push point — while
  // advertising a recovery point that does not exist or belongs to a different
  // branch.
  if (!recoveryNamed) {
    return stop(
      "rebase-unsaved-recovery-ref",
      `The ${point} rebase reported ${JSON.stringify(report.recoveryRef === undefined ? null : report.recoveryRef)} as its recovery ref, which is not the \`${recoveryPrefix}<YYYYmmdd-HHMMSS>\` ref the brief orders saved before the first replay for this branch. That ref is this run's only way back to the pre-rebase tip, so nothing is adopted from a report that cannot name it in full.`,
    );
  }
  if (!recoverySaved) {
    return stop(
      "rebase-unverified-recovery-ref",
      `The ${point} rebase named \`${recoveryRef}\` as its recovery ref while reporting ${JSON.stringify(report.recoveryTip === undefined ? null : report.recoveryTip)} as what that ref resolves to and ${JSON.stringify(report.before === undefined ? null : report.before)} as the tip it started from. A ref is a way back only where it is read back pointing AT that tip, so a report that cannot show the two agreeing is not adopted.`,
      { note: `Nothing was pushed. The branch is where the rebase left it, and \`${recoveryRef}\` was NOT shown resolving to the tip it started from — check that ref yourself before treating it as this branch's way back.` },
    );
  }
  const record = { point, target, ...report, effectiveBase: pinned, recoveryRef, recoveryTip };
  rebaseRecord.points.push(record);
  // The pinned commit becomes this run's effective review base and the
  // boundary of every range delegated from here on, replacing the ref NAME
  // gather reported. `rebased` latches true across the two points: publication
  // needs the lease as soon as either one rewrote history.
  packet.pr.base = pinned;
  if (!record.noop) packet.pr.rebased = true;
  return { rebase: record };
}

if (flags.noRebase) {
  // Suppressing the rebase does not suppress the PIN. Every range delegated
  // below is taken against `pr.base`, so leaving the ref NAME there would hand
  // the cycle a boundary the next fetch or a sibling push moves — the same
  // defect the `effectiveBase` check refuses on the rebasing path, arriving by
  // the one path that has no rebase report to check. The gather resolved the
  // base ref to a commit for exactly this, which is `address-review` step 6's
  // fallback for a turn in which no rebase ran; an unusable value stops the run
  // rather than being delegated as a name. That stop is a halt like the rebase
  // stops below, so it keeps the worktree and reports it through `pr.worktree`
  // rather than reclaiming it.
  const pinnedBase = typeof packet.pr.baseOid === "string" ? packet.pr.baseOid.trim() : "";
  if (!isFullOid(pinnedBase)) {
    return {
      status: "unpinned-base",
      pr: packet.pr,
      rebase: rebaseRecord,
      detail: `\`no-rebase\` was given and the gather reported ${JSON.stringify(packet.pr.baseOid === undefined ? null : packet.pr.baseOid)} as the base ref's commit, which is not a full commit OID. With no rebase to pin one, that value IS this run's review base, and a movable name or an abbreviation cannot bound a delegated diff.`,
      note: "Nothing was addressed and nothing was pushed. Re-run so the gather resolves the PR's base ref to a full commit OID, or drop `no-rebase` and let the rebase phase pin it.",
    };
  }
  rebaseRecord.pinnedBase = pinnedBase;
  packet.pr.base = pinnedBase;
} else {
  const first = await rebasePoint("pre-fix", rebaseTargetRef);
  if (first.stop) return first.stop;
}

phase("Fix and verify");
// The loop lives in the canonical wf-review-cycle, consumed by NESTING: this
// pipeline runs one cycle with no fan-out, so there is no cross-cycle state a
// parent would need to own (a fan-out owner embeds the cycle's marked section
// instead — see wf-address-tasks.js and wf-review-cycle.js "Consumption
// modes"). No RUNTIME worktree isolation either way: the cycle's agents share
// this run's one working location — the current checkout inline, the attached
// worktree otherwise — so the reviewer sees the fixer's commits directly. The
// cycle takes that location as its `worktree` option, and an empty string is
// how it spells "the current checkout", which is exactly inline mode.
// A runtime without child-workflow support cannot run the shared
// cycle at all — report that as a blocker rather than silently reviewing less.
if (typeof workflow !== "function") {
  return {
    error: "This workflow runtime does not support nested workflows (`workflow()` is unavailable), and wf-address-review consumes the shared review cycle by nesting. Update the runtime, or use the `address-review` skill.",
    pr: packet.pr,
  };
}
// `let`, because a pre-push rebase that replays anything makes THIS verdict
// describe a tree nobody will push; the re-verification cycle below supersedes
// it so every check and every result past this point reads the cycle that judged
// the tree actually being published — carrying this cycle's open questions,
// deviations and round count along, which are the run's rather than a loop's.
let cycle = await workflow("wf-review-cycle", {
  worktree: locationMode === "worktree" ? worktreePath : "",
  branch: packet.pr.workingBranch,
  base: packet.pr.base,
  artifactType: "code",
  peer: flags.peerOff ? "off" : "on",
  mode: "full",
  scope: {
    title: `pr-${packet.pr.number}`,
    instructions: fixInstructions(packet),
    reviewInstructions: reviewCriteria(),
    items: packet.items,
  },
});
if (!cycle) {
  return { error: "Nested review cycle returned nothing.", pr: packet.pr };
}
// The cycle sets `artifactDirAnomalies` only when a later pass tried to move
// the artifact directory — a warning that the round history may not ALL sit
// under `artifactDir`. It is for-the-human data of the same class as
// openQuestions/deviations, so every result that carries the pointer also
// carries the anomaly record beside it.
// `deviationHistory` rides in the same carrier and for the same reason: the
// cycle's `deviations` is by contract the FINAL standing set, so the per-pass
// record is the only place a maintainer reading this result can see that a pass
// stopped restating one. The cycle sets it once any pass reported a deviation.
// `deviationAssessments` rides here too — the reviewer's in-spec-route judgment
// and RATIFY/CONFORM recommendation for each deviation still standing. The
// publisher leads its summary comment with it, and every OTHER exit reports the
// deviations without publishing anything, so those exits are the only place a
// reader of this result meets them at all.
// `closeOut` and `recordOnly` are one class and ride here for one reason: each
// records a cycle that CONCLUDED over something no fresh reviewer saw — the
// close-out's non-semantic edits, and for `recordOnly` a delivery run that
// FAILED on the evidenced-unrelated flake disposition (with the tolerated
// post-run flake commit where there was one), whose `note` is that run's own
// account of what failed.
// This run pushes to a PR and reports back to the maintainer who started it, so
// the carrier is where that fact reaches them, and every return of this run's
// RESULT spreads it — enumerated rather than swept, since they are not the only
// returns below: the failed-cycle error, the no-push report, the
// cap-not-published report, the three publish-abort guards (an uncovered item, a
// doubly-covered one, a malformed covering entry), and the published report.
// Seven. The many other returns below sit inside `dispositionDefect` and hand
// back a diagnostic string rather than a result, so they spread nothing.
// The nested cycle is granted no close-out above, so `closeOut` cannot arise
// here today — it rides in the same conditional because the two records are one
// rule, and granting the close-out later then needs no second edit HERE; the
// publish brief below renders `recordOnly` and not `closeOut`, so it would
// still need teaching.
// `flakeHistory` rides beside them for the half `recordOnly` cannot cover: that
// record speaks for the CONCLUDING pass, so an intermediate pass's
// evidenced-unrelated failure would reach the maintainer nowhere once a later
// pass concluded clean, and the cited-active-task outcome leaves nothing in the
// diff either. Present once any pass reported one.
// `packetChecks` rides for a reason of its own: the cycle's refusal of a
// measured-dirty packet points the reader at that entry BY NAME ("see the
// `packetChecks` entry for the list"), and the failed-cycle return below is
// where that refusal reaches the maintainer — dropped, the message promises a
// list this result does not carry. It is also the only place a reader can see
// that no packet the cycle adopted went unmeasured. Present once any packet was
// measured, on every exit including the stopped ones.
// A function rather than a fixed object because the cycle it speaks for can be
// REPLACED below: read once ahead of the pre-push rebase, it would carry the
// superseded cycle's records into results describing the re-verified one.
const carriedOf = (c) => ({
  ...(c.artifactDirAnomalies ? { artifactDirAnomalies: c.artifactDirAnomalies } : {}),
  ...(c.deviationAssessments ? { deviationAssessments: c.deviationAssessments } : {}),
  ...(c.deviationHistory ? { deviationHistory: c.deviationHistory } : {}),
  ...(c.closeOut ? { closeOut: c.closeOut } : {}),
  ...(c.recordOnly ? { recordOnly: c.recordOnly } : {}),
  ...(c.flakeHistory ? { flakeHistory: c.flakeHistory } : {}),
  ...(c.packetChecks ? { packetChecks: c.packetChecks } : {}),
  // The four keys `mergedCycle` below adds, so a re-verified run reports both
  // cycles rather than only the one that judged the pushed tree.
  ...(c.roundsByCycle ? { roundsByCycle: c.roundsByCycle } : {}),
  ...(c.preRebaseArtifactDir ? { preRebaseArtifactDir: c.preRebaseArtifactDir } : {}),
  ...(c.preRebaseCloseOut ? { preRebaseCloseOut: c.preRebaseCloseOut } : {}),
  ...(c.preRebaseRecordOnly ? { preRebaseRecordOnly: c.preRebaseRecordOnly } : {}),
});
// The re-verification cycle REPLACES the verdict — it is the one that judged the
// tree being pushed — but it must not replace the run's for-the-human record.
// A parked open question or a still-standing locked-decision deviation raised
// before the rebase is the maintainer's either way, and `review-cycle` forbids a
// deviation vanishing with a loop's last turn (`publishPrompt`'s deviation lead
// reads exactly this set). So the verdict-bearing fields come from the second
// cycle and the human-facing sets are both cycles' concatenated, oldest first.
// `rounds` becomes the run's total for the same reason: neither cycle's own
// count describes what the run spent, and `roundsByCycle` keeps the split.
// Two of the merged sets are read by a HUMAN rather than keyed off by a
// machine, and concatenating those two hands the publisher the same deviation
// twice: `review-cycle` has every pass restate each standing deviation VERBATIM
// and matches them by exact text, so one still standing after the rebase
// arrives from both cycles character-identical. Published as-is it would lead
// the summary comment twice, and "carry each assessment beside the deviation
// they name" would name two assessments per deviation — the ambiguity the
// publish brief's one-assessment-per-deviation wording cannot survive. So both
// are folded on the identity the cycle itself uses, the deviation's exact text:
// a deviation appears once, and an assessment resolves to the LATER cycle's,
// whose round judged the tree actually being pushed, while one the
// re-verification never assessed keeps the earlier round's half rather than
// losing it. Nothing else is deduped — the other sets are per-pass history,
// where two identical entries are two real events.
const deviationText = (entry) => (typeof entry === "string" ? entry : JSON.stringify(entry));
function mergedCycle(before, after) {
  const both = (key) => {
    const list = [...(Array.isArray(before[key]) ? before[key] : []), ...(Array.isArray(after[key]) ? after[key] : [])];
    return list.length ? { [key]: list } : {};
  };
  // Keyed insert, so the LAST writer of a key wins while the position stays the
  // one it was first seen at — the deviations keep their oldest-first order and
  // each assessment stays where the deviation it names is.
  const foldedBy = (key, identity) => {
    const byIdentity = new Map();
    for (const entry of both(key)[key] || []) byIdentity.set(identity(entry), entry);
    return byIdentity.size ? { [key]: [...byIdentity.values()] } : {};
  };
  const proactive = [before.proactive, after.proactive].filter((s) => typeof s === "string" && s.trim()).join(" ");
  return {
    ...after,
    rounds: (Number(before.rounds) || 0) + (Number(after.rounds) || 0),
    roundsByCycle: { beforeRebase: before.rounds, reverification: after.rounds },
    ...both("openQuestions"),
    ...foldedBy("deviations", deviationText),
    ...foldedBy("deviationAssessments", (a) => deviationText(a && a.deviation !== undefined ? a.deviation : a)),
    ...both("deviationHistory"),
    ...both("findingDispositions"),
    ...both("peerRounds"),
    ...both("discardedPeerFindings"),
    ...both("flakeHistory"),
    ...both("packetChecks"),
    ...both("artifactDirAnomalies"),
    ...(proactive ? { proactive } : {}),
    ...(before.artifactDir && before.artifactDir !== after.artifactDir ? { preRebaseArtifactDir: before.artifactDir } : {}),
    ...(before.closeOut ? { preRebaseCloseOut: before.closeOut } : {}),
    ...(before.recordOnly ? { preRebaseRecordOnly: reverifiedRecord(before.recordOnly) } : {}),
  };
}
// The one claim in that carried record the re-verification FALSIFIES. A
// record-only exit is admitted over a tolerated post-run commit no fresh
// reviewer saw; the re-verification then reviews the rebased tree over its own
// `base..HEAD`, so a fresh reviewer has since read every commit on the branch,
// that one included. Emptying the range and the check line describing it is how
// the cycle already spells "this record names no post-run commit", and it is the
// same correction the batch's collision re-review makes for the same reason
// (`wf-address-tasks.js` → `collisionReviewedRecord`). The `note` and the `pass`
// stay: the delivery run really did fail, that is what the gate admitted it on,
// and the maintainer is owed it whoever has since read the commit. Range-only,
// so a record already naming no commit is returned untouched.
function reverifiedRecord(record) {
  return record.range ? { ...record, range: "", verified: "" } : record;
}
// A re-verification fixes replay fallout rather than doing fresh work, so it
// runs under a LOWERED cap. But a per-cycle ceiling is not the whole rule:
// `review-cycle` states its cap as at most 12 reviewer rounds TOTAL, which an
// invoker may lower and never raise, and this run REPORTS `rounds` as its own
// total across both cycles — so a first cycle that passed on its twelfth round
// plus four more would spend, and report, 16. What bounds the second cycle is
// therefore the run's REMAINING budget, of which 4 is the most a re-verification
// may take; where none remains the run stops instead of buying rounds the cap
// does not have (the arcane token bloat the cap exists against). Two full
// 12-round cycles — the 24-round worst case this ceiling was first written
// against — are ruled out by the budget on its own.
const CYCLE_MAX_ROUNDS = 12;
const REVERIFY_MAX_ROUNDS = 4;
if (cycle.verdict === "error") {
  return { error: `Review cycle failed: ${cycle.detail}`, pr: packet.pr, rebase: rebaseRecord, rounds: cycle.rounds, dispositions: cycle.workReport, openQuestions: cycle.openQuestions, deviations: cycle.deviations, peerRounds: cycle.peerRounds, artifactDir: cycle.artifactDir, ...carriedOf(cycle) };
}

// The SECOND rebase point: the fixes are committed and the next thing that
// happens is publication, so this is where the branch meets the base as it
// stands now. In the prose skill this point runs BEFORE the final reviewer
// round; here the reviewer rounds live inside the nested cycle, which cannot be
// interrupted at its last one — so the ordering is delivered the other way
// round, by re-running the cycle over the rebased tree whenever the replay
// changed anything. Either way the acceptance condition is the same one: the
// verdict that authorizes the push describes the exact tree being pushed. A
// no-op replays nothing, so the verdict already standing describes that tree
// and no round is spent proving it.
// That is deliberately the WEAKER of the two conditions the skill's step 2
// states, and the divergence is bounded here rather than closed: the skill also
// asks that no push-authorizing verdict be rendered on a tree whose last base
// refresh predates its last fix, and the re-verification below runs in `full`
// mode and is told to fix replay fallout, so its fixer commits land after this
// point's rebase with nothing rebasing again before publication. Closing it
// would mean LOOPING this point and the re-verification until the last base
// refresh postdates the last fix — which is reachable, and is what one
// re-verification that commits no fixes leaves behind. What a bounded round
// budget cannot promise is reaching it INSIDE the budget: a base that keeps
// moving, each replay drawing another fix, costs a re-verification per pass
// until the budget runs out and the run stops unpublished. This pipeline runs
// the pair exactly ONCE, so the residual is that one cycle wide — the
// re-verification's own fixes sit on a base pinned before them — and the
// exact-tree condition is the one this pipeline keeps and publication rests on.
// It runs on `no-push` runs too, exactly as the skill's step 5 does: the local
// branch is left on the fresh base either way, and a dry run that reported a
// pass on a tree it then rebased would be reporting on nothing.
if (cycle.verdict === "pass" && !flags.noRebase) {
  const second = await rebasePoint("pre-push", rebaseTargetRef);
  if (second.stop) {
    return {
      ...second.stop,
      rounds: cycle.rounds,
      dispositions: cycle.workReport,
      // Oldest first, the order `mergedCycle` keeps every human-facing set in:
      // the cycle's questions were raised before the rebase point that stopped
      // the run, so they lead and the halt's question follows.
      openQuestions: [...(cycle.openQuestions || []), ...(second.stop.openQuestions || [])],
      deviations: cycle.deviations,
      peerRounds: cycle.peerRounds,
      artifactDir: cycle.artifactDir,
      ...carriedOf(cycle),
    };
  }
  if (!second.rebase.noop) {
    phase("Fix and verify");
    // The cycle that passed on the previous base. Its `workReport` is what the
    // re-verification is told to carry forward and what its reviewer compares
    // against, and its human-facing records are merged into the replacement
    // below rather than dropped with it.
    const preRebaseCycle = cycle;
    const priorReport = preRebaseCycle.workReport || [];
    // What is left of the run's total round budget after the cycle that just
    // passed, capped at the re-verification's own lower ceiling. Exhausted, the
    // rebased tree cannot be reviewed inside the cap at all — and this run
    // never publishes on a verdict rendered over a tree it then rebased — so it
    // stops here with the branch on the fresh base and nothing pushed, which is
    // the same shape as every other stop this point can reach.
    const reverifyBudget = Math.min(REVERIFY_MAX_ROUNDS, Math.max(0, CYCLE_MAX_ROUNDS - (Number(preRebaseCycle.rounds) || 0)));
    if (reverifyBudget < 1) {
      return {
        status: "reverify-budget-exhausted",
        pr: packet.pr,
        rebase: rebaseRecord,
        rounds: preRebaseCycle.rounds,
        dispositions: preRebaseCycle.workReport,
        openQuestions: preRebaseCycle.openQuestions,
        deviations: preRebaseCycle.deviations,
        peerRounds: preRebaseCycle.peerRounds,
        artifactDir: preRebaseCycle.artifactDir,
        ...carriedOf(preRebaseCycle),
        detail: `The pre-push rebase replayed commits, so the verdict that passed describes a tree nobody will push — and the cycle that produced it had already spent all ${CYCLE_MAX_ROUNDS} of the run's reviewer rounds, leaving no budget to re-verify the rebased tree under a cap an invoker may lower and never raise.`,
        // Named unconditionally: `rebasePoint` adopts no successful report
        // without a `refs/pre-rebase/` ref, so by this line the branch's way
        // back is known rather than hoped for.
        note: `Nothing was pushed. The branch is on the rebased base, and its pre-rebase tip is saved at \`${second.rebase.recoveryRef}\`. Re-run to review the rebased tree with a fresh round budget.`,
      };
    }
    const reverified = await workflow("wf-review-cycle", {
      worktree: locationMode === "worktree" ? worktreePath : "",
      branch: packet.pr.workingBranch,
      base: packet.pr.base,
      artifactType: "code",
      peer: flags.peerOff ? "off" : "on",
      mode: "full",
      maxRounds: reverifyBudget,
      scope: {
        title: `pr-${packet.pr.number}-post-rebase`,
        instructions: rebaseReverifyInstructions(packet, second.rebase, priorReport),
        reviewInstructions: rebaseReverifyCriteria(second.rebase, priorReport),
        items: packet.items,
      },
    });
    if (!reverified) {
      return {
        error: "The post-rebase re-verification cycle returned nothing, so no verdict describes the rebased tree; nothing was pushed.",
        pr: packet.pr,
        rebase: rebaseRecord,
        rounds: cycle.rounds,
        dispositions: cycle.workReport,
        openQuestions: cycle.openQuestions,
        deviations: cycle.deviations,
        peerRounds: cycle.peerRounds,
        artifactDir: cycle.artifactDir,
        ...carriedOf(cycle),
      };
    }
    second.rebase.reverified = {
      rounds: reverified.rounds,
      verdict: reverified.verdict,
      roundsBeforeRebase: preRebaseCycle.rounds,
      maxRounds: reverifyBudget,
      runCap: CYCLE_MAX_ROUNDS,
    };
    cycle = mergedCycle(preRebaseCycle, reverified);
    if (cycle.verdict === "error") {
      return { error: `Post-rebase re-verification cycle failed: ${cycle.detail}`, pr: packet.pr, rebase: rebaseRecord, rounds: cycle.rounds, dispositions: cycle.workReport, openQuestions: cycle.openQuestions, deviations: cycle.deviations, peerRounds: cycle.peerRounds, artifactDir: cycle.artifactDir, ...carriedOf(cycle) };
    }
  }
}

const carried = carriedOf(cycle);
const passed = cycle.verdict === "pass";
const rounds = cycle.rounds;
const workReport = cycle.workReport || [];

// Per-item coverage: the cycle's `workReport` rides through it untyped (its
// schema cannot require consumer fields), so this consumer enforces its own
// EXACTLY-one-entry-per-item contract — count the covering entries rather than
// asking whether any exists, because both directions publish wrongly. Zero:
// the publisher replies/resolves ONLY what the report names, so the item is
// silently left untouched while a summary still posts. Two or more: a thread
// named twice with different kinds (say `actionable-fixed` and `push-back`)
// draws two contradictory replies, and its resolve is decided by whichever
// entry the publisher happens to route first. Review-threads match by
// threadId, standalone items by url — keyed off the GATHERED item's identity,
// never the report entry's own claimed `type`, so a mistyped entry cannot
// dodge the check. What type-blindness costs is that ONE entry carrying both a
// gathered thread's threadId and a gathered standalone's url counts for both
// items while publication routes it to one; `dispositionDefect` below rejects
// such an entry from either side, so the two checks together still admit
// exactly one entry per item.
const entriesForItem = (item) =>
  item.type === "review-thread"
    ? workReport.filter((d) => d && d.threadId && d.threadId === item.threadId)
    : workReport.filter((d) => d && d.url && d.url === item.url);
const itemRef = (it) => String(it.threadId || it.url || "(item with no threadId or url)");
const uncoveredItems = packet.items.filter((it) => entriesForItem(it).length === 0);
const uncoveredRefs = uncoveredItems.map(itemRef);
const duplicatedItems = packet.items.filter((it) => entriesForItem(it).length > 1);
const duplicatedRefs = duplicatedItems.map(
  (it) => `${itemRef(it)} [${entriesForItem(it).map((d) => String((d && d.kind) || "no kind")).join(", ")}]`
);

// A gathered review-thread's covering entry must also be PUBLISHABLE as one:
// the publisher routes on the ENTRY's `type`, REPLIES via its `commentId`
// (REST `.../comments/<id>/replies`), and RESOLVES via its `threadId` — so
// the ids must be a gathered thread's actual pair, not merely nonempty. A
// never-gathered threadId would resolve an unrelated thread by id, and a
// wrong-but-nonempty commentId would thread the reply under one comment while
// resolving another thread. The JSON schema cannot make fields conditionally
// required, and the entry's own claim cannot be trusted for this check, so
// judge against the gathered items (their identity here, their echoed author
// fields further down — which `reviewCriteria` also puts to the cycle's
// reviewer, deliberately: the reviewer catches a mismatch in-cycle where the
// fixer can still correct it, while this check is the last structural backstop
// and can only abort publication): flag any entry typed `review-thread` whose
// threadId is not a gathered thread's or whose commentId is not that thread's
// top comment, and any entry matching a gathered thread's threadId that is not
// typed for it.
//
// Identity alone is not enough to publish from, though. Every remaining field
// `fixInstructions` marks mandatory is consumed by a publish side effect, and
// the untyped `workReport` cannot require any of them: `kind` routes the whole
// per-item hygiene step (a missing one leaves the publisher guessing which
// reply to write and whether to resolve), `detail` IS the reply body,
// `authorIsBot` decides whether a push-back or deferred thread may be
// auto-resolved, and `author` + `newFinding` decide which bots the
// contributing-ping set keeps — an absent one silently drops a bot that did
// bring a new finding. So a schema-valid but incomplete entry has to be
// rejected here, before anything is pushed, rather than reaching the publisher
// as an ambiguous instruction. `author` may be the empty string (the contract's
// value for an unavailable author, e.g. a deleted account); absent is not the
// same thing and is a violation.
//
// The converse is deliberate: `ref` — and a thread entry's own `url`, and a
// standalone entry's own `threadId` — is NOT required here, because none of
// them drives a publish action (`ref` only labels an entry in the run's report,
// where `threadId`/`url`/`kind` already stand in for it), and every extra
// required field is one more way a finished run aborts at the last step over a
// field a provider dropped. `fixInstructions` states that split rather than
// listing every field as equally mandatory, so the two texts agree on which
// ones publication actually enforces.
//
// Two of those fields are ECHOES of the gathered item rather than the fixer's
// own judgment, so type-checking them is not enough either — the same "judge
// against the gathered items, never the entry's own claim" rule that governs
// the ids governs them: `authorIsBot` decides whether a push-back or deferred
// thread may be auto-resolved, so an entry flipping it to true auto-resolves a
// HUMAN thread the run was told to leave open (and flipping it to false
// suppresses the bot resolution), while `author` is what `botKindOf` attributes
// a round's new findings to, so an altered login re-pings the wrong bot or
// drops the one that actually contributed. Both are therefore compared against
// the gathered item for EVERY entry, which is why identity is required in both
// branches below: a `review-thread` entry's threadId must be a gathered
// thread's, and a `standalone` entry's url must be a gathered item's. Requiring
// the url makes the two symmetric — an entry naming a url that was never
// gathered is untriaged work, and while it has no thread to resolve it still
// reaches the summary comment and, through `author`/`newFinding`, the default
// contributing-bot ping set. Neither branch may name a gathered item of the
// OTHER kind on top of its own, since coverage would then count the entry for
// both while publication serves one. (The coverage check above runs the other
// direction, so between them every gathered item has exactly one entry and
// every entry names exactly one gathered item.) Logins are compared
// case-insensitively: `botKindOf` already lowercases, so case cannot change
// any routing, and failing publication over it would be brittle rather than
// protective.
const TRIAGE_KINDS = new Set([
  "actionable-fixed",
  "already-addressed",
  "push-back",
  "deferred-to-task",
  "ambiguous-skipped",
]);
const threadItemById = new Map(
  packet.items.filter((it) => it.type === "review-thread" && it.threadId).map((it) => [it.threadId, it])
);
const standaloneItemByUrl = new Map(
  packet.items.filter((it) => it.type !== "review-thread" && it.url).map((it) => [it.url, it])
);
const sameLogin = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
// Returns why this entry cannot be published, or "" when it carries the full
// per-item contract.
function dispositionDefect(d) {
  if (!d) return "the entry is empty";
  // The gathered item this entry speaks for, once identity checks out — the
  // authority for the echoed fields below. Both branches return a defect when
  // they cannot name one, so past the routing block it is always set.
  let gathered;
  if (d.type === "review-thread") {
    if (!d.threadId || !d.commentId) return "it is a review-thread entry with no threadId/commentId to resolve and reply through";
    if (!threadItemById.has(d.threadId)) return "its threadId was never gathered on this PR, so resolving it would close an unrelated thread";
    gathered = threadItemById.get(d.threadId);
    // A gathered thread with no commentId is a GATHER defect, not this entry's:
    // nothing can be replied through it whatever the entry says. Still fatal to
    // publication, but named as what it is so the re-run fixes the right stage.
    if (gathered.commentId == null || gathered.commentId === "") return "the gathered thread it names carries no commentId of its own, so no reply can be threaded under it — the gather step, not this entry, is what has to be re-run";
    if (String(gathered.commentId) !== String(d.commentId)) return "its commentId is not that gathered thread's top comment, so the reply would thread under one comment while another thread is resolved";
    // Mirror of the standalone branch's gathered-threadId rejection below, and
    // the reason the coverage check above can stay type-blind: coverage matches
    // a standalone item on url alone, so an entry typed `review-thread` that
    // ALSO carries a gathered standalone's url covers two items at once while
    // publication routes it to the thread only — the standalone would then be
    // silently left untouched under a posted summary, the exact failure the
    // coverage check exists to prevent. A thread entry's own `url` is the
    // thread's permalink and is otherwise unenforced; it just may not be
    // another gathered item's identity.
    if (typeof d.url === "string" && standaloneItemByUrl.has(d.url)) return "it is typed review-thread but carries a gathered standalone item's url, so that standalone would read as covered while publication only ever replies to the thread";
  } else if (d.type === "standalone") {
    if (typeof d.url !== "string" || !d.url) return "it is a standalone entry with no url, the only stable reference its outcome can be recorded against";
    if (d.threadId && threadItemById.has(d.threadId)) return "it is typed standalone but names a gathered review thread, so publication would skip the thread's reply/resolve";
    if (!standaloneItemByUrl.has(d.url)) return "its url was never gathered on this PR, so it is untriaged work that no reviewer disposition covers — it would still be written up in the summary comment and counted toward the contributing-bot pings";
    gathered = standaloneItemByUrl.get(d.url);
  } else {
    return `its type ${JSON.stringify(d.type)} is neither review-thread nor standalone, so publication cannot route it`;
  }
  if (!TRIAGE_KINDS.has(d.kind)) return `its kind ${JSON.stringify(d.kind)} is not one of the triage kinds, so publication cannot tell what to reply or whether to resolve`;
  if (typeof d.detail !== "string" || !d.detail.trim()) return "it carries no detail, which is the body of the reply publication would post";
  if (typeof d.author !== "string") return "it has no author, so a bot that brought a new finding would silently drop out of the ping set";
  if (typeof d.authorIsBot !== "boolean") return "it has no authorIsBot, which decides whether a push-back or deferred thread may be auto-resolved";
  if (typeof d.newFinding !== "boolean") return "it has no newFinding, which decides whether its author bot is re-pinged this round";
  // `authorIsBot` absent from the gathered item means `false` — the contract's
  // safe human default, the same one `fixInstructions` tells the fixer to use
  // — so the comparison holds either way.
  const gatheredIsBot = gathered.authorIsBot === true;
  if (d.authorIsBot !== gatheredIsBot) return `its authorIsBot ${d.authorIsBot} contradicts the gathered item's ${gatheredIsBot}, and that flag alone decides whether a push-back or deferred thread is auto-resolved or left open`;
  // A gathered item carrying no author string at all is a gather defect that
  // has already broken ping attribution upstream; there is nothing to judge
  // the echo against, so leave it to the type check above rather than
  // reporting a defect this entry did not cause.
  if (typeof gathered.author === "string" && !sameLogin(d.author, gathered.author)) return `its author ${JSON.stringify(d.author)} is not the gathered item's ${JSON.stringify(gathered.author)}, so the re-review ping would follow the wrong login`;
  return "";
}
// Every defective entry, not just the first: a run with several would otherwise
// need one cycle per defect to surface them all. Compute the defect once per
// entry and keep it beside its ref — the entry itself can be null/empty, so a
// `find`-style search on the entry would hand that back as a falsy "no defect".
const dispDefects = workReport
  .map((d, i) => ({ ref: String((d && (d.ref || d.threadId || d.url || d.kind)) || `entry #${i + 1}`), defect: dispositionDefect(d) }))
  .filter((x) => x.defect);
// Non-empty exactly when at least one entry is unpublishable, so the guards
// below key off it rather than off any entry.
const badDispDefect = dispDefects.length ? dispDefects[0].defect : "";
const badDispRef = dispDefects.length ? dispDefects[0].ref : "";
const moreDefects = dispDefects.length > 1 ? ` ${dispDefects.length - 1} further entr${dispDefects.length === 2 ? "y is" : "ies are"} unpublishable too — see malformedDispositions.` : "";

if (!flags.push) {
  // Local-only run: make NO PR mutations. The disposition map is the deliverable
  // so a later "push" turn can replay replies/resolves precisely — which is why
  // an uncovered item, a doubly-covered one, or a malformed covering entry
  // downgrades the verdict to `fixed-local-incomplete`: a replay from this map
  // would skip, double-post, or misroute those threads, so the result must not
  // read as a clean local fix.
  // A `no-push` FINISH gives the worktree back exactly like a published run
  // does — the fixes are committed on a branch that outlives it. A run stopped
  // at the review cap has NOT finished, so it keeps its worktree: that tree is
  // where the outstanding findings can be looked at and a later run resumes.
  const reclaimed = passed ? await reclaimWorktree("the local-only run finished") : null;
  phase("Report (no-push)");
  return {
    status: passed ? (uncoveredItems.length || duplicatedItems.length || badDispDefect ? "fixed-local-incomplete" : "fixed-local") : "review-cap",
    ...(reclaimed ? { worktreeReclaim: reclaimed } : {}),
    pr: packet.pr,
    rebase: rebaseRecord,
    rounds,
    reviewerPassed: !!passed,
    dispositions: workReport,
    proactiveFixes: cycle.proactive,
    findingDispositions: cycle.findingDispositions,
    openQuestions: cycle.openQuestions,
    deviations: cycle.deviations,
    peerRounds: cycle.peerRounds,
    artifactDir: cycle.artifactDir,
    ...carried,
    outstanding: passed ? null : cycle.outstanding || null,
    ...(uncoveredItems.length
      ? { uncoveredItems: uncoveredRefs, coverageNote: `${uncoveredItems.length} gathered item(s) have no workReport entry; a later publish replay would skip them.` }
      : {}),
    ...(duplicatedItems.length
      ? { duplicatedItems: duplicatedRefs, duplicateNote: `${duplicatedItems.length} gathered item(s) carry more than one workReport entry; a later publish replay would post a reply per entry and resolve on whichever it routed first.` }
      : {}),
    ...(badDispDefect
      ? { malformedDisposition: badDispRef, malformedDispositions: dispDefects, dispositionNote: `Disposition "${badDispRef}" is not publishable: ${badDispDefect}. A later publish replay would misroute or skip it.${moreDefects}` }
      : {}),
    note: `Local-only run: no push, no replies/resolves, no comment. Re-run without \`no-push\` to publish with the default contributing-bot pings, or with \`push\` to publish quietly.${survivingWorktreeNote(reclaimed)}`,
  };
}

if (!passed) {
  // push requested but the verify loop hit its cap — do NOT publish unverified work.
  phase("Report (cap hit, not published)");
  return {
    status: "review-cap-not-published",
    pr: packet.pr,
    rebase: rebaseRecord,
    rounds,
    dispositions: workReport,
    openQuestions: cycle.openQuestions,
    deviations: cycle.deviations,
    peerRounds: cycle.peerRounds,
    artifactDir: cycle.artifactDir,
    ...carried,
    outstanding: cycle.outstanding || null,
    note: "Hit the review cycle's round cap without a passing review; nothing was pushed.",
  };
}

// Guards before any publication side effect (nothing has been pushed yet on a
// push run — the publisher does the push — so aborting here leaves the remote
// clean). First: every gathered item must be covered by a workReport entry, or
// publication would push and post a summary while silently skipping the
// uncovered thread(s).
if (uncoveredItems.length) {
  return {
    status: "publish-aborted-incomplete-dispositions",
    pr: packet.pr,
    rebase: rebaseRecord,
    rounds,
    dispositions: workReport,
    openQuestions: cycle.openQuestions,
    deviations: cycle.deviations,
    peerRounds: cycle.peerRounds,
    artifactDir: cycle.artifactDir,
    ...carried,
    uncoveredItems: uncoveredRefs,
    note: `${uncoveredItems.length} gathered item(s) have no workReport entry; nothing was pushed. Re-run so every item carries its disposition.`,
  };
}

// Second: an item covered MORE than once. The entries disagree by construction
// (one item, several dispositions), so publication would reply once per entry
// and resolve the thread on whichever it routed first — a wrong reply left
// standing beside a right one. There is no safe way to pick between them here;
// only the cycle that produced them can say which disposition it meant.
if (duplicatedItems.length) {
  return {
    status: "publish-aborted-conflicting-dispositions",
    pr: packet.pr,
    rebase: rebaseRecord,
    rounds,
    dispositions: workReport,
    openQuestions: cycle.openQuestions,
    deviations: cycle.deviations,
    peerRounds: cycle.peerRounds,
    artifactDir: cycle.artifactDir,
    ...carried,
    duplicatedItems: duplicatedRefs,
    note: `${duplicatedItems.length} gathered item(s) carry more than one workReport entry (listed with the kinds that clash); nothing was pushed. Re-run so every item carries exactly one disposition.`,
  };
}

// Third: a covering entry that cannot be published — mistyped, naming a
// never-gathered thread, missing/mismatching its identifiers, or missing or
// contradicting a publish-critical field (the `badDispDefect` check above the
// no-push branch, judged against the gathered items and the per-item report
// contract).
if (badDispDefect) {
  return {
    status: "publish-aborted-incomplete-dispositions",
    pr: packet.pr,
    rebase: rebaseRecord,
    rounds,
    dispositions: workReport,
    openQuestions: cycle.openQuestions,
    deviations: cycle.deviations,
    peerRounds: cycle.peerRounds,
    artifactDir: cycle.artifactDir,
    ...carried,
    malformedDisposition: badDispRef,
    malformedDispositions: dispDefects,
    note: `Disposition "${badDispRef}" is not publishable: ${badDispDefect}. Nothing was pushed.${moreDefects} Re-run so every entry carries its gathered type, identifiers, and echoed author fields plus the full per-item report contract (kind, detail, author, authorIsBot, newFinding).`,
  };
}

// A ping summons a FRESH review, which only makes sense when this run actually
// pushed something new. With no new commits and no rebase, the branch tip is
// unchanged — pushing is a no-op and re-pinging would spin the
// review->address->review loop forever, so suppress the pings. We can positively
// know "nothing new" only when the final SHA equals the pre-run remote tip and
// no rebase ran; in every other case (incl. missing finalSha, or a local
// off-shoot whose SHA legitimately differs) we leave the flag on and defer to
// the publisher's own git check, which the prompt also gates on a no-op push.
const knownNoNewCommits =
  !packet.pr.rebased &&
  !!cycle.finalSha &&
  cycle.finalSha === packet.pr.headOid;

// `ping-contributing`: re-ping a bot only when it authored at least one NEW
// finding this round, attributed by the disposition author's login. A bot that
// only re-raised a deferred item or re-argued a lost push-back contributed no
// new finding (newFinding=false) and drops out of the ping set — which is how a
// multi-bot review->address loop winds down reviewer-by-reviewer.
const reviewingBots = new Set();
const contributingBots = new Set();
for (const d of workReport) {
  const bot = botKindOf(d && d.author, d && d.authorIsBot);
  if (!bot) continue;
  reviewingBots.add(bot);
  if (d.newFinding) contributingBots.add(bot);
}
// Candidate set. Without the modifier it is exactly the bots the user named.
// With the modifier AND at least one name, it is that named set (then filtered
// to contributors below); with the modifier supplied ALONE, it falls back to the
// known bots that reviewed this round.
const anyExplicitPing = flags.pingCodex || flags.pingClaude || flags.pingCopilot;
const candidate = {
  codex: flags.pingContributing ? (anyExplicitPing ? flags.pingCodex : reviewingBots.has("codex")) : flags.pingCodex,
  claude: flags.pingContributing ? (anyExplicitPing ? flags.pingClaude : reviewingBots.has("claude")) : flags.pingClaude,
  copilot: flags.pingContributing ? (anyExplicitPing ? flags.pingCopilot : reviewingBots.has("copilot")) : flags.pingCopilot,
};
// When the modifier is off, `contributes` is always true, so the per-bot ping
// reduces exactly to the prior `named && !knownNoNewCommits` behavior.
const contributes = (bot) => !flags.pingContributing || contributingBots.has(bot);
const publishFlags = {
  ...flags,
  pingCodex: candidate.codex && contributes("codex") && !knownNoNewCommits,
  pingClaude: candidate.claude && contributes("claude") && !knownNoNewCommits,
  pingCopilot: candidate.copilot && contributes("copilot") && !knownNoNewCommits,
};

phase("Publish");
// Both cycles' records go to the publisher, not just the surviving cycle's:
// `cycle` here may be the merged one, whose `preRebaseRecordOnly` is the failed
// delivery run of the cycle the re-verification replaced. This comment is the
// only PR-facing surface either record has.
const publishReport = await agent(publishPrompt(packet, workReport, publishFlags, cycle.deviations, cycle.deviationAssessments, cycle.recordOnly, cycle.preRebaseRecordOnly), {
  label: "publish",
  schema: PUBLISH_SCHEMA,
});

const published = !!(publishReport && publishReport.published);
// One record for both the result field and the note below, so the reason the
// note quotes is the one the report shows — including where the publisher
// returned nothing at all and there is no report to quote from.
const publishRecord = publishReport || { published: false, aborted: "publisher returned nothing" };
// Published is the finish this whole pipeline exists for, so the worktree goes
// back here. A publication that aborted keeps it: whatever the publisher
// stopped on is still standing in that tree, and `pr.worktree` names it in the
// result.
const reclaimed = published ? await reclaimWorktree("publication completed") : null;

phase("Summary");
const pingsRequested = flags.pingCodex || flags.pingClaude || flags.pingCopilot || flags.pingContributing;
const nothingNewPushed = knownNoNewCommits || (publishReport && publishReport.pushedNewCommits === false);
// Bots in the candidate set that were skipped purely for bringing no new
// finding this round (only meaningful once something new was actually pushed —
// otherwise every ping is suppressed anyway).
const droppedForNoContribution =
  flags.pingContributing && !nothingNewPushed
    ? ["codex", "claude", "copilot"].filter((b) => candidate[b] && !contributingBots.has(b))
    : [];
const notes = [
  pingsRequested && nothingNewPushed
    ? "Nothing new was pushed this run, so the re-review ping(s) were skipped to keep an automated review->address->review loop from spinning forever."
    : null,
  droppedForNoContribution.length
    ? `ping-contributing: did not re-ping ${droppedForNoContribution.join(", ")} — no new finding from ${droppedForNoContribution.length > 1 ? "them" : "it"} this round.`
    : null,
].filter(Boolean);
return {
  status: published ? "fixed-published" : "fixed-publish-failed",
  pr: packet.pr,
  rebase: rebaseRecord,
  rounds,
  flags: publishFlags,
  reviewingBots: [...reviewingBots],
  contributingBots: [...contributingBots],
  dispositions: workReport,
  proactiveFixes: cycle.proactive,
  findingDispositions: cycle.findingDispositions,
  openQuestions: cycle.openQuestions,
  deviations: cycle.deviations,
  peerRounds: cycle.peerRounds,
  artifactDir: cycle.artifactDir,
  ...carried,
  publishReport: publishRecord,
  ...(reclaimed ? { worktreeReclaim: reclaimed } : {}),
  note: published
    ? (`${notes.join(" ")}${survivingWorktreeNote(reclaimed)}`.trim() || undefined)
    : `Fixes passed review but publication did not fully complete: ${publishRecord.aborted || "no reason reported"}. Nothing may have been pushed.`,
};
