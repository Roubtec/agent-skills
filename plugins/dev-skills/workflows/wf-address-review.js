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
 * [no-push] [push] [peer-opinions=off] [ping-codex] [ping-claude]
 * [ping-copilot] [ping-contributing]`.
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
 * A non-trivial rebase conflict (when `rebase on top of` is supplied) is aborted
 * cleanly and stops the run, as in the skill.
 *
 * Worktree model
 * --------------
 * This is a SINGLE-PR, strictly SEQUENTIAL pipeline (gather -> fix -> review ->
 * publish) with no fan-out, so the agents deliberately do NOT use
 * `isolation: "worktree"`. They all run in the one working tree on the PR
 * branch, so the fixer's commits are directly visible to the reviewer and the
 * publisher. (Runtime isolation gives each agent a *separate* temporary worktree
 * started from the default branch, which would hide the fixer's commits from the
 * reviewer — the failure the original draft had. The batch front-end role —
 * many PRs at once — is where per-PR isolation belongs, and that must use the
 * explicit `.worktrees/$CONTAINER_NAME/` convention, not runtime isolation; see
 * wf-address-tasks.js and the directory README.)
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
      description: "Required whenever ok is true. The downstream phases dereference these fields, so populate them all.",
      properties: {
        number: { type: "integer" },
        url: { type: "string" },
        branch: { type: "string", description: "The PR's remote head ref (headRefName) — publication metadata, the push target. May differ from what is checked out." },
        workingBranch: { type: "string", description: "The branch actually checked out in the working tree right now (`git branch --show-current`). Usually equals branch, but for a supported local-offshoot of a merge-pending PR it differs — the fixer edits THIS branch, not the remote head ref." },
        base: { type: "string", description: "Effective review base — the rebase target if a rebase ran, else baseRefName." },
        headOid: { type: "string", description: "Expected remote head OID, for the publication lease. Populate from the PR's headRefOid." },
        rebased: { type: "boolean", description: "True if a rebase rewrote the branch tip (publish must use --force-with-lease)." },
      },
      required: ["number", "url", "branch", "workingBranch", "base", "headOid"],
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

const PUBLISH_SCHEMA = {
  type: "object",
  properties: {
    published: { type: "boolean", description: "True only if the push AND every required reply/resolve/summary/ping step succeeded. False if any guard (moved head, unmatched remote, rejected lease, failed comment) aborted publication." },
    aborted: { type: "string", description: "Why publication stopped, when published is false (e.g. `head moved`, `lease rejected`, `push remote unmatched`). Empty when published." },
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
  required: ["published", "pushed", "pushedNewCommits"],
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
Empirical verification that could change state belongs ONLY in a disposable clone. Run \`command -v dc-enter\`; where it is found, work in \`DC="$(dc-enter <slug>)"\` — it prints one absolute path on stdout, \`dc-remove <slug>\` drops it, and a reused slug is REFUSED rather than re-derived, so pass \`--replace\` or remove the slug first if this may run twice. Where the helper is absent, use an absolute path outside the repository — never a relative one, and never the repository itself.`;

// The rebase branch of this brief orders a build, so it needs a destination for
// that build's output — this gather agent is assigned no artifact path anywhere,
// and a role with no assigned path picks the session scratchpad, which is shared
// per session rather than per run. It works in the CHECKOUT rather than a task
// worktree, so the destination is a unique directory outside it.
function gatherPrompt(input) {
  return `You are preparing a pull request for review-addressing. Read \`AGENTS.md\` / \`CLAUDE.md\` first.

${DESTROY_BOUNDARY}

Request (lenient parsing — commas, &, free word order): ${JSON.stringify(input)}
Possible tokens: a PR number (e.g. #38), \`rebase on top of <branch>\`, \`no-push\`, \`push\`, \`peer-opinions=off\`, \`ping-codex\`, \`ping-claude\`, \`ping-copilot\`, \`ping-contributing\`. You only act on the PR# and the rebase here; the push/ping/peer flags are handled later.

Preflight (set \`ok: false\` with a \`blocker\` and stop on any failure):
1. Working tree clean (\`git status --porcelain\` empty). Do not auto-stash.
2. No rebase already in progress.
3. \`gh auth status\` succeeds.

Resolve the PR: explicit PR# wins (but sanity-check it shares history with the current branch — if genuinely unrelated, blocker and stop); else auto-detect via \`gh pr view\`. When \`ok\` is true you MUST populate the whole \`pr\` object: \`number\`, \`url\`, \`branch\` (the PR's remote headRefName — the push target), \`workingBranch\` (the branch actually checked out now, from \`git branch --show-current\`), \`base\`, \`headOid\` (the PR's headRefOid — the publish phase needs it for a safe \`--force-with-lease\`), and \`rebased\`. Do NOT switch branches: \`workingBranch\` is whatever is checked out. It usually equals \`branch\`, but for a supported local off-shoot of a merge-pending PR it differs — downstream fixes must edit \`workingBranch\`, while \`branch\`/\`headOid\` remain publication metadata for the push.

If \`rebase on top of <branch>\` was given: read \`current_branch="$(git branch --show-current)"\`, require it to be non-empty, save the pre-rebase tip with \`git update-ref refs/pre-rebase/$current_branch/<ts> HEAD\` (the one \`update-ref\` this assignment spells out, and the run's only rebase recovery ref — do not skip it), then \`git rebase <target>\`. Resolve only TRIVIAL conflicts (imports/whitespace/pure additions/already-represented patches → in-file resolve or \`git rebase --skip\`). On the FIRST non-trivial conflict, \`git rebase --abort\`, confirm a clean tree, set \`blocker\` and stop. After a conflicted rebase, run the build to confirm; if you redirect its output to a file, create a UNIQUE directory for that first, OUTSIDE the checkout (\`mktemp -d "\${TMPDIR:-/tmp}/gather-build.XXXXXX"\`), and write there — never a fixed shared scratchpad name, since one session's agents share that directory and a fixed one has crossed results between concurrent runs before. Set \`pr.rebased\` true if the tip was rewritten and \`pr.base\` to the rebase target; otherwise \`pr.base = baseRefName\` and \`pr.rebased = false\`. (When rebased, \`pr.headOid\` is still the *remote* tip you will replace — read it before the rebase.)

Gather feedback into \`items\` (each verbatim):
- UNRESOLVED review threads — PRIMARY: use the baked \`gh-review-threads\` helper. \`gh-review-threads <PR#>\` prints the unresolved threads as a JSON array (each thread \`id isResolved isOutdated path line\` and \`comments[]\` with \`databaseId author{ login __typename } body diffHunk url\`); it already pages with fresh SINGLE-SHOT queries (never \`gh api graphql --paginate\`), does the nested comment fetch-up, and applies the scope check below, failing closed with exit 3 and no stdout on a contaminated response. FALLBACK, only when \`command -v gh-review-threads\` fails (a container built from an older image — the same graceful-degradation used for the gh-version-gated Copilot ping): run the GraphQL \`reviewThreads\` query by hand as SINGLE-SHOT queries, never \`gh api graphql --paginate\` (run concurrently with other gh GraphQL calls it has returned ANOTHER PR's threads); include \`totalCount\` + \`pageInfo{ hasNextPage endCursor }\` and page past 100 threads by passing the returned cursor to a fresh call. Either way SCOPE-CHECK the result (the helper does this for you): every comment \`url\` must match the exact repo-qualified PR path for this PR (\`https://github.com/<owner>/<repo>/pull/<number>\` followed by \`#\`, \`/\`, \`?\`, or end); do not use a plain substring check such as \`/pull/<number>\`. On any mismatch, discard the entire response, retry once with a fresh single-shot query, and if it repeats fail closed; never emit an item whose \`url\` points at a different PR. Keep only \`isResolved == false\`. Emit each as \`type: "review-thread"\` with \`threadId\` (the thread node \`id\`), \`commentId\` (the top comment's \`databaseId\`), \`path\`, \`line\`, \`author\` (the top comment's \`author.login\`), \`authorIsBot\` (true when that comment's \`author.__typename\` is \`Bot\` — from the helper's output or the GraphQL \`author{ login __typename }\`; do not guess from the login), \`body\`, \`url\`. \`threadId\` and \`commentId\` are mandatory for these — they are how publication resolves and replies.
- Top-level context — ALWAYS fetch every review summary (\`gh pr view --json reviews\`) and every issue comment (\`gh api --paginate repos/{owner}/{repo}/issues/<PR>/comments\`), even when the request names no standalone item: this sweep is how maintainer replies and decision comments are discovered. A maintainer reply on an unresolved thread is authoritative — fold it into that thread's context. So is a top-level maintainer comment recording per-item verdicts (often titled "Maintainer Decisions" or similar) — fold each decision into the relevant thread's context as its binding disposition (including "defer to a follow-up task" and "keep as-is").
- A standalone issue comment or review summary becomes its own item ONLY if the request explicitly identifies it as outstanding. Emit it as \`type: "standalone"\` with \`author\`, \`authorIsBot\`, \`body\`, and \`url\` (its permalink is the stable reference; it has no threadId and is never resolved as a thread).

If there are no unresolved threads and no included standalone item, return \`ok: true\` with an empty \`items\` array — the caller will exit as a successful no-op.

Edit NO files here; this is gather-only.`;
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
- \`deferred-to-task\` — the concern is real but fixing it here would expand the PR's scope considerably while the branch is defendable as it stands (builds, covers its main paths), or a maintainer reply/decision comment defers it. Do NOT implement; write a standalone follow-up task file instead, per the write-tasks skill conventions: place it in the repo's task folder (commonly \`tasks/\`; parked work in its deferred subfolder, e.g. \`tasks/deferred/\` — follow the repo's existing layout), number it to continue the existing sequence, restate the concern with file/line references and the PR thread link, and commit it on this branch SEPARATELY from code-fix commits. Never use this to dodge a cheap fix.
- \`ambiguous-skipped\` — needs an authoritative decision you cannot make here.

Preclude repeat comments: for each pattern you fix, grep the PR's changed files and closely related code for the SAME offending pattern and fix those too; report them in \`proactive\`.
Do NOT push, reply, resolve, or comment on the PR — publication is a separate, later step.

Per-item report contract: return EXACTLY ONE \`workReport\` entry per work item — never a second entry for a thread you already reported, since publication would post both replies and resolve on whichever it routed first. Each entry carries: \`type\` (echoed from the item, so \`review-thread\` or \`standalone\`; publication can route no other value, and an entry typed anything else is rejected before publication); \`threadId\` and \`commentId\` (MANDATORY for \`review-thread\` items; publication cannot reply/resolve without them); \`url\` (a \`standalone\` entry's identity, MANDATORY there — echo the gathered item's url VERBATIM; an entry naming a url that was never gathered is untriaged work and is rejected before publication. On a \`review-thread\` entry it is the thread's permalink, for the record); \`ref\` (file:line + author, human-readable); \`kind\` (the disposition kind above); \`detail\` (for fixed: one line + commit sha; for already-addressed: where it's handled; for push-back: the rationale; for deferred: the committed task file path + one-line scope, and whether the deferral was maintainer-directed or agent-proposed; for ambiguous: what decision is needed); \`authorIsBot\` (echoed VERBATIM from the gathered item; MANDATORY — publication uses it to decide whether a push-back/deferred thread may be auto-resolved, so never omit it; if the gathered item lacked it, use false, the safe human default); \`author\` (the comment author's login, echoed VERBATIM — include it for \`standalone\` items too); and \`newFinding\` — true ONLY when the item surfaces a real concern not previously raised on this PR (typically an \`actionable-fixed\`, or a genuinely new \`deferred-to-task\`/\`already-addressed\`); false for a \`push-back\` (the comment was wrong), a re-raise of a concern already deferred to a committed task file, or a bot re-arguing a push-back it already lost — UNLESS the thread carries a genuinely new angle this round. (\`newFinding\` drives the \`ping-contributing\` flag, which re-pings a bot only when it brought a new finding this round; set it honestly even if no ping was requested.)

Which of those fields are structurally enforced: every field publication acts on is re-checked before anything is pushed, and one bad entry aborts the whole publication — \`type\`, \`kind\`, \`detail\`, \`author\`, \`authorIsBot\`, \`newFinding\`, a \`review-thread\` entry's \`threadId\`/\`commentId\`, and a \`standalone\` entry's \`url\`. The identifying ids are matched against the gathered items, and the two echoed fields (\`author\`, \`authorIsBot\`) are compared against the item they came from — so echo what you were handed rather than what you judge to be more accurate. \`ref\` is not required at all, and neither is a \`review-thread\` entry's \`url\` nor a \`standalone\` entry's \`threadId\` — those two are only checked for not naming some OTHER gathered item, which would make one entry read as covering two. Write them anyway: \`ref\` is what names an entry in the run's own report, including when some other field gets that entry rejected.`;
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
function publishPrompt(packet, dispositions, flags, deviations, deviationAssessments) {
  const dev = Array.isArray(deviations) ? deviations : [];
  const assessments = Array.isArray(deviationAssessments) ? deviationAssessments : [];
  const deviationLead = dev.length
    ? `\n\n## Locked-decision deviations — LEAD the summary comment with these\n\nOpen the comment with a "Deviation from a locked decision" section carrying these verbatim, above everything else. Each is the maintainer's to ratify or ask conformance on; publication neither corrects nor softens one.\n\n${JSON.stringify(dev, null, 2)}${
        assessments.length
          ? `\n\nThe reviewing round's assessment of each — carry \`inSpecRoute\` and \`recommendation\` into that same section, beside the deviation they name, so the maintainer reads both halves at once. Relay them; do not re-argue or soften one.\n\n${JSON.stringify(assessments, null, 2)}`
          : `\n\nThe review cycle recorded no assessment for these (it stopped before a round passed over them), so the section carries the implementer's half only — say so plainly rather than supplying a judgment of your own.`
      }`
    : "";
  return `Publish the addressed review for PR #${packet.pr.number} (branch \`${packet.pr.branch}\`). A fresh reviewer has PASSED. Read \`AGENTS.md\` / \`CLAUDE.md\` first.

${DESTROY_BOUNDARY}

Flags for this publication: ${JSON.stringify(flags)}.

Report a STRUCTURED result: set \`published: true\` ONLY if the push and every required reply/resolve/summary/ping below succeeded. If any guard aborts you, set \`published: false\` and \`aborted: "<reason>"\` and report what (if anything) was pushed — never claim success on an aborted publication.

1. Re-check before publication: clean worktree, no rebase in progress; re-fetch the PR and confirm it is still open and still points at the expected head repo/ref. Resolve the branch's exact push remote/ref and verify it matches the PR head (never assume \`origin\`, especially for forks). Expected head OID to replace: \`${packet.pr.headOid}\`. If the head moved or the target can't be matched, set \`published: false\`, \`aborted\`, and STOP — do not guess.
2. Push: if the expected tip is an ancestor of HEAD, normal push (\`git push <remote> HEAD:refs/heads/${shq(packet.pr.branch)}\`). If history was rewritten (rebased: ${packet.pr.rebased ? "yes" : "no"}), use an exact lease: \`git push <remote> --force-with-lease=refs/heads/${shq(packet.pr.branch)}:${shq(packet.pr.headOid)} HEAD:refs/heads/${shq(packet.pr.branch)}\`. If the lease is rejected, NEVER escalate to bare \`--force\`; set \`published: false\`, \`aborted: "lease rejected"\`, and stop.
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
5. Summary comment: post a top-level "Summary of Review Fixes" (\`gh pr comment\`) — ${dev.length ? "opening with the locked-decision deviation section defined below, then " : ""}what was fixed (with proactive same-pattern fixes), a prominent "Pushed back — please re-examine" section, a "Deferred to follow-up tasks" section listing each deferral with its committed task file (agent-proposed deferrals flagged for confirmation), and any ambiguous/skipped or newly-arrived items. Write "codex"/"claude"/"copilot" plain (no bare @-mentions) so only the dedicated pings below trigger a re-review. Put its URL in \`summaryCommentUrl\`.
6. Pings (only after push + summary succeeded, AND only when the push ACTUALLY advanced the remote branch with new commits or rewritten history — never on an \`Everything up-to-date\` no-op push): ${flags.pingCodex ? "post a dedicated comment \`@codex review\`. " : ""}${flags.pingClaude ? "post a dedicated comment \`@claude review\`. " : ""}${flags.pingCopilot ? "request a fresh Copilot review with \`gh pr edit <PR#> --add-reviewer @copilot\` (the canonical CLI request; needs gh >= 2.88.0). Do NOT post an \`@copilot review\` comment — a bare \`@copilot\` mention drives Copilot's coding agent (it can start editing the branch), not its reviewer. The add-reviewer request re-triggers Copilot's review even on a PR it already reviewed (tested working — not a silent no-op), and never misfires into the coding agent. GUARD: before issuing it, confirm the installed \`gh\` supports the \`@copilot\` reviewer value (gh >= 2.88.0 — e.g. check \`gh --version\`); on an older powbox base image where \`gh pr edit --add-reviewer @copilot\` errors, SKIP the Copilot request WITHOUT failing publication — the push and summary already succeeded, so this is non-fatal: keep \`published: true\`, record it in \`pings\` as 'copilot: skipped (gh too old)', and note that the base image needs refreshing (\`agent-update\`) or a one-off manual re-request from the PR's web reviewer menu." : ""}${!flags.pingCodex && !flags.pingClaude && !flags.pingCopilot ? "none requested. " : "If more than one ping was requested, perform each as its own dedicated action (never one comment mentioning several bots). "}If nothing new was pushed this run (the remote ref already pointed at your HEAD — e.g. every disposition was already-addressed/push-back, or the branch was up to date), SKIP all pings even if requested above: re-requesting a review with nothing new to look at would spin the review->address->review loop forever. Set \`pushedNewCommits\` to whether the push advanced the branch, and record which pings (if any) you posted in \`pings\`.${deviationLead}

## Dispositions to publish

${JSON.stringify(dispositions, null, 2)}

Record each item's outcome with its stable reference (file:line, author, threadId or url) in \`threadOutcomes\`.`;
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
const lower = raw.toLowerCase();
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
const pushWords = lower.replace(/\bpush(?:ed|es|ing)?[\s-]*back\b/g, " ");
const pushNegWords = pushWords.replace(/\bpush(?:es|ing)\b/g, "push");
const noPush =
  /\bno[\s-]*push\b/.test(pushNegWords) ||
  /\b(?:not|never|without|skip|cannot|can't|cant|dont|don't|do not)\b[\s-]*push\b/.test(pushNegWords);
// `peer-opinions=off` suppresses the nested cycle's cross-harness peer stage;
// it must arrive through args (the workflow cannot read prose elsewhere).
const peerOffTok = /\bpeer[\s-]*opinions?\s*=\s*off\b/.test(lower);
const pingCodexTok = /\bping[\s-]*codex\b/.test(lower);
const pingClaudeTok = /\bping[\s-]*claude\b/.test(lower);
const pingCopilotTok = /\bping[\s-]*copilot\b/.test(lower);
const pingContribTok = /\bping[\s-]*contributing\b/.test(lower);
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
const flags = {
  push: wantPush,
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
  return { error: "Stopped before any change.", blocker: packet.blocker || "(unspecified)", pr: packet.pr };
}
// The schema requires `pr` fields, but a schema-valid agent can still omit the
// object; validate before any phase dereferences packet.pr.* so an incomplete
// response is a reported failure, not a thrown crash.
if (!packet.pr || packet.pr.number == null || !packet.pr.branch || !packet.pr.workingBranch || !packet.pr.base) {
  return { error: "Gather succeeded but returned incomplete PR metadata (need number, branch, workingBranch, base).", pr: packet.pr || null };
}
// headOid is only consumed by the publish lease, so require it specifically when
// a push is requested — its absence would otherwise interpolate `undefined` into
// the expected-head check and the --force-with-lease, defeating remote-movement
// protection only AFTER fixes were made. Catch it before any work starts.
if (flags.push && !packet.pr.headOid) {
  return { error: "Push requested but gather returned no pr.headOid; refusing to proceed without the expected-head OID needed for a safe --force-with-lease.", pr: packet.pr };
}
if (!packet.items || packet.items.length === 0) {
  return { status: "no-op", detail: "No unresolved threads and no included standalone item — nothing to address.", pr: packet.pr };
}

phase("Fix and verify");
// The loop lives in the canonical wf-review-cycle, consumed by NESTING: this
// pipeline runs one cycle with no fan-out, so there is no cross-cycle state a
// parent would need to own (a fan-out owner embeds the cycle's marked section
// instead — see wf-address-tasks.js and wf-review-cycle.js "Consumption
// modes"). No worktree isolation: the cycle's agents share the current
// checkout on the PR branch, so the reviewer sees the fixer's commits
// directly. A runtime without child-workflow support cannot run the shared
// cycle at all — report that as a blocker rather than silently reviewing less.
if (typeof workflow !== "function") {
  return {
    error: "This workflow runtime does not support nested workflows (`workflow()` is unavailable), and wf-address-review consumes the shared review cycle by nesting. Update the runtime, or use the `address-review` skill.",
    pr: packet.pr,
  };
}
const cycle = await workflow("wf-review-cycle", {
  worktree: "",
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
const carried = {
  ...(cycle.artifactDirAnomalies ? { artifactDirAnomalies: cycle.artifactDirAnomalies } : {}),
  ...(cycle.deviationAssessments ? { deviationAssessments: cycle.deviationAssessments } : {}),
  ...(cycle.deviationHistory ? { deviationHistory: cycle.deviationHistory } : {}),
};
if (cycle.verdict === "error") {
  return { error: `Review cycle failed: ${cycle.detail}`, pr: packet.pr, rounds: cycle.rounds, dispositions: cycle.workReport, openQuestions: cycle.openQuestions, deviations: cycle.deviations, peerRounds: cycle.peerRounds, artifactDir: cycle.artifactDir, ...carried };
}

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
  phase("Report (no-push)");
  return {
    status: passed ? (uncoveredItems.length || duplicatedItems.length || badDispDefect ? "fixed-local-incomplete" : "fixed-local") : "review-cap",
    pr: packet.pr,
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
    note: "Local-only run: no push, no replies/resolves, no comment. Re-run without `no-push` to publish with the default contributing-bot pings, or with `push` to publish quietly.",
  };
}

if (!passed) {
  // push requested but the verify loop hit its cap — do NOT publish unverified work.
  phase("Report (cap hit, not published)");
  return {
    status: "review-cap-not-published",
    pr: packet.pr,
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
const publishReport = await agent(publishPrompt(packet, workReport, publishFlags, cycle.deviations, cycle.deviationAssessments), {
  label: "publish",
  schema: PUBLISH_SCHEMA,
});

phase("Summary");
const published = !!(publishReport && publishReport.published);
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
  publishReport: publishReport || { published: false, aborted: "publisher returned nothing" },
  note: published
    ? (notes.length ? notes.join(" ") : undefined)
    : "Fixes passed review but publication did not fully complete — see publishReport.aborted; nothing may have been pushed.",
};
