/**
 * wf-address-review — dynamic-workflow form of the `address-review` skill.
 *
 * Work through every UNRESOLVED review thread on one pull request: gather the
 * threads, fix what is right / push back on what is wrong, verify every
 * disposition through the shared review cycle (fresh-eyes reviewer plus a
 * best-effort cross-harness codex peer, bounded by the cycle's round cap),
 * then publish by default (lease-safe push, reply + resolve threads, Summary
 * comment, pings) — a `no-push` run stays local-only, and the one PR write it
 * makes is the disposition record every exit that does not publish IN FULL
 * leaves behind (see `recordPrompt` and `leaveDispositionRecord`), which is
 * `no-push`'s single documented exception. A publication that stopped part-way
 * leaves the same record, saying what of the map the PR already CARRIES — end
 * state, whichever run put it there, never that a push command ran — and what
 * it still owes.
 * The re-review pings fire ONLY when the push actually advanced the branch with
 * new commits/rewritten history; a no-op push (nothing new to review) skips them
 * so an automated review -> address -> review loop can terminate.
 *
 * The `ping-contributing` modifier prunes that re-review set further to the
 * bots that brought a NEW finding this round — the disposition schema and the
 * prompts below carry the operative definition — so a multi-bot loop winds
 * down bot-by-bot as each reviewer goes quiet.
 *
 * Invoke as `/dev-skills:wf-address-review [PR#] [rebase on top of <target>]
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
 * from, so it pins the commit the gather resolved this run's target to — the
 * target an explicit `rebase on top of <target>` named, else the PR's base ref. The review
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
 * A rebase conflict beyond the delegated step's competence is aborted cleanly —
 * and a merge carrying its own content halts the step before any replay, with
 * no rebase started and so nothing to abort — the tree left clean and idle
 * either way, and the run stops carrying what it turns on as an open question —
 * the hands-off shape of the skill's interactive loop-in.
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
    { title: "Record", detail: "on every exit that does not publish in full: leave the run's disposition map on the PR as one record comment" },
    { title: "Publish", detail: "lease-safe push, thread replies, summary comment, pings" },
    { title: "Summary" },
  ],
};

const PACKET_SCHEMA = {
  type: "object",
  properties: {
    ok: { type: "boolean", description: "False if the run cannot proceed (blocker set)." },
    blocker: { type: "string", description: "Why the run stopped — e.g. an unidentifiable or unrelated PR, a dirty tree, a rebase in progress, a halted rebase, an auth failure, or an invocation-named rebase target that does not resolve where it was named. Not a closed list: report whatever stopped you. Empty when ok." },
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
        baseOid: { type: "string", description: "The full OID THIS RUN'S TARGET resolves to right now — which of two things that is, the brief settles and this field follows: a branch or commit an explicit `rebase on top of <target>` named (the `rebaseTarget` you report) is resolved WHERE IT WAS NAMED, in the working location, and fetched from nowhere, since `no-rebase` drops the rebase and not the target; only where the request named none is the target this PR's own base ref, and only then is it resolved IN THE BASE REPOSITORY — the repository the PR itself is in, freshly fetched, never read through the branch's push remote, which on a cross-repository PR is the head fork. A commit, never a name. REQUIRED on a `no-rebase` run whose gather returned items, and ONLY there — that run has no rebase report to pin from, so this is the OID it pins as its review base, and the caller rejects anything that is not a full hex OID on that path and stops the run. An empty gather reports the field EMPTY even there: the caller's no-op exit runs before the check. A rebasing run never reads it (its rebase pins the base itself), so its gather reports the field EMPTY and resolves nothing for it — the brief orders that resolution, by whichever arm, only where the value is consumed." },
        headOid: { type: "string", description: "Expected remote head OID, for the publication lease. Populate from the PR's headRefOid." },
        startingHead: { type: "string", description: "The tip this run STARTS from: `git rev-parse HEAD` in the working location, read after the reconciliation's one authorized fast-forward and before anything is fixed or rebased. Populate it on every successful gather — it is the `starting HEAD` of the disposition record a run that does not publish leaves, and the only place it can be read is here, since a `no-rebase` run has no rebase report to take it from. Absent, the record falls back to the first rebase point's `before` and then to saying it was not recorded, so a missing value costs a provenance field rather than the run." },
        rebased: { type: "boolean", description: "Whether the branch tip has been rewritten (publish must then use --force-with-lease). Report `false` here — this step performs no rebase; the caller sets it from the rebase phase's own report." },
      },
      required: ["number", "url", "branch", "workingBranch", "locationMode", "base", "headOid"],
    },
    rebaseTarget: {
      type: "string",
      description: "The target named by an explicit `rebase on top of <target>` token in the request — a branch name or an exact commit, verbatim. EMPTY when the request named none, which is the ordinary case: the rebase phase then targets the PR's own `baseRefName` (this object's `base`). Report the token on every packet you return with `ok: true` and items to address — empty string and not omitted where the request named none, since that is what the caller consumes, and it stops the run on an absent one: the caller reads this field alone and never infers the token from anything else, and on a `no-rebase` run it is what decides which target the `baseOid` above resolves. Acting on it is otherwise not yours — the rebase phase does that — with the single exception the `no-rebase` arm of your brief spells out, where resolving it IS the base you report.",
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
    priorRecord: {
      type: "object",
      description: "A DISPOSITION RECORD an earlier run of this workflow left on the PR — its most recent one, found by the marker its FIRST LINE carries — or omitted entirely when the PR has none. It is not a work item and carries no maintainer authority. It rides here because the fix phase REPLAYS it instead of re-triaging the judgment calls it already holds: without a field of its own it would reach nothing (the cycle's scope carries the gathered items, and an item holds no disposition), so the expense this record exists to prevent would be paid again every run.",
      properties: {
        url: { type: "string", description: "Permalink to that comment, so the run's report and the fix brief can name it. REQUIRED whenever this object is present." },
        body: { type: "string", description: "The comment body VERBATIM and WHOLE — not trimmed, not re-wrapped, not excerpted. The drafted reply bodies and the ready-to-post Summary body inside it are the only parts of a record no later run can re-derive, so a summary or an excerpt of it is worth nothing here. REQUIRED whenever this object is present: the fix brief embeds this text and nothing else replays the record, so a record reported without its body replays to NOTHING while the run reads as having found one — the silent re-triage this whole mechanism exists to prevent." },
      },
      // Both, so a half-reported record is rejected here rather than degrading
      // into a run that quietly re-triages what it was handed.
      required: ["url", "body"],
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
    halted: { type: "boolean", description: "True when the step stopped for a decision beyond its competence — a conflict met mid-rebase, where the rebase was ABORTED, or a merge carrying its own content found in the range before any replay, where no rebase was started and there was nothing to abort. Either way the tree is left clean and idle and `question` carries what the maintainer has to decide. Not a failure of the run's mechanics — a decision it cannot make." },
    question: { type: "string", description: "REQUIRED when halted: the offending commit (the conflicting one, or the content-bearing merge), the files at issue, and what the judgment turns on. It is reported as this run's open question, so write it for the maintainer rather than as a log line." },
    effectiveBase: { type: "string", description: "The full OID actually rebased onto, as `git rev-parse --verify <target>^{commit}` printed it — a commit, never a ref name and never an abbreviation. REQUIRED whenever ok is true; the caller rejects anything that is not a full hex OID (40 characters, or 64 in a SHA-256 repository) and stops the run, because every delegation range afterwards is taken against this value." },
    noop: { type: "boolean", description: "True when the rebase replayed nothing and the tip is unchanged (the pinned base was already an ancestor of HEAD, with no pure-join merge left in range for the replay to flatten) — the common and cheap outcome, and what makes two rebase points safe. It is the one value that switches checks off (no validation here, no re-verification of the rebased tree at the pre-push point), so the caller adopts it only where `before` and `after` are both reported and equal, and stops the run otherwise." },
    before: { type: "string", description: "Tip SHA before the rebase — the pre-rebase tip step 3 saved. REQUIRED whenever ok is true: the caller checks the recovery ref against it, and where noop is true it and `after` are also the evidence the no-op is accepted on." },
    after: { type: "string", description: "Tip SHA after it. REQUIRED whenever noop is true, and equal to `before` there; a no-op naming a moved tip, or naming none, is treated as an unevidenced claim and stops the run." },
    recoveryRef: { type: "string", description: "The recovery ref saved before the first replay, written in full: exactly `refs/pre-rebase/<the branch you rebased>/<the UTC timestamp>`, nothing truncated. REQUIRED whenever ok is true — step 3 saves it unconditionally and is told not to skip it. The caller checks the whole name against the branch it dispatched and the timestamp shape the brief stamps, because a truncated or mistyped value names no backup of this replay while still starting with the right characters." },
    recoveryTip: { type: "string", description: "The OID `recoveryRef` resolves to, read back with `git rev-parse --verify` AFTER the `update-ref`. REQUIRED whenever ok is true, and equal to `before`. A name is a way back only where it is seen resolving to the tip the rebase started from: a ref that was never created, or one left over from another branch's replay, is a report the caller refuses rather than a recovery point." },
    validationPassed: { type: "boolean", description: "Whether the post-rebase build/tests passed. Report `true` for a no-op rebase, which runs none. A rebase that replayed anything must report `true` here to go on: the caller requires that value positively, so `false` and an absent field stop the run alike, before any review verdict or push rests on the replay." },
    detail: { type: "string", description: "One line: the target, what was replayed, skipped or resolved, and what validation ran." },
  },
  required: ["ok", "halted", "noop", "detail"],
};

// The publisher's stop when its own read-back could not establish that the ref
// moved (the push recipe at step 2 of the brief below). Authored here because
// three places must agree on it byte for byte: the step that tells the publisher
// to report it, the schema that enumerates it, and the disposition record, whose
// push claims are the ones it withdraws.
const PUSH_UNCONFIRMED_ABORT = "push not confirmed at the ref";

const PUBLISH_SCHEMA = {
  type: "object",
  properties: {
    published: { type: "boolean", description: "True only if the push AND every required reply/resolve/summary/ping step succeeded. False if any guard (moved head, unmatched remote, rejected lease, failed comment) aborted publication. The caller accepts it only over a report that can SUPPORT it — an account of every item it can read, and the `summaryCommentUrl` of the Summary comment this step ends with. Claimed over less, the run reports an incomplete publication, keeps its worktree, and leaves its disposition record: a completion nobody can check is not a completion." },
    aborted: { type: "string", description: "Why publication stopped, when published is false (e.g. `head moved`, `working location moved off the branch`, `lease rejected`, `local behind PR head`, `off-shoot does not carry the PR head`, `push remote unmatched`, `" + PUSH_UNCONFIRMED_ABORT + "`). Empty when published. Write it: the run's own note carries this reason inline, so an omitted one reads as `no reason reported` there." },
    pushed: { type: "boolean", description: "Whether a push command SUCCEEDED — an `Everything up-to-date` no-op counts, since it leaves the remote pointing at this tip. False when none was attempted, or when one was rejected or failed. This is NOT evidence that anything this run did reached origin: a no-op push changed nothing there, so `pushedNewCommits` is what says the remote moved." },
    pushedNewCommits: { type: "boolean", description: "True ONLY if the push actually advanced the remote branch — new commits or rewritten history. False when no push happened or for a no-op `Everything up-to-date` push. Gates whether the re-review pings may fire, and it is the push half of what a disposition record may call landed." },
    threadOutcomes: {
      type: "array",
      description: "Your ACCOUNT of where each item STANDS ON THE PR when your turn ends — not a log of your own writes: an equivalent reply of yours that was already there counts as replied, and a thread you found resolved counts as resolved. Keyed one entry per item: its machine identity, its stable reference, what was done in prose, and the two facts a later turn acts on. REQUIRED on every report, ABORTED ONES INCLUDED — one entry per item you were given, whether or not you reached it. What a disposition record calls landed and what it calls still owed are derived as complements of this account — so `landed` is what the PR CARRIES rather than what this run put there — and an item you leave out is not read as untouched: the caller cannot tell a thread you never reached from one whose reply is on the PR unreported, and it says the outcome is UNKNOWN rather than guessing either way. An abort before the push touched anything reports `[]`, which is the complete account of having acted on nothing.",
      items: {
        type: "object",
        properties: {
          threadId: { type: "string", description: "The thread's GraphQL node id, MANDATORY on a `review-thread` item's entry: it is the key this entry is matched to its disposition by, echoed VERBATIM from that disposition." },
          url: { type: "string", description: "The item's url, MANDATORY on a `standalone` item's entry (where it is that item's whole identity, echoed VERBATIM); the thread's permalink on a `review-thread` entry, which is keyed by `threadId` instead." },
          ref: { type: "string", description: "file:line + author, for a human reading the record. NOT an identity: two threads a re-review left on the same line by the same author share it, so it can key nothing — `threadId`/`url` above is what does." },
          outcome: { type: "string" },
          replied: { type: "boolean", description: "True ONLY if the reply is ON THE PR when your turn ends. Never what you intended or attempted — and never a record of your API calls either: a reply you skipped under step 4's duplicate rule, an equivalent one of yours already being there, is on the PR, and reporting it false would have the caller read a complete publication as still owing that reply and a later turn post it twice." },
          resolved: { type: "boolean", description: "True ONLY if the thread is RESOLVED on the PR when your turn ends. Never what you intended or attempted, and true likewise for a thread you found already resolved rather than resolving yourself." },
        },
        required: ["ref", "outcome", "replied", "resolved"],
      },
    },
    summaryCommentUrl: { type: "string", description: "URL of the posted Summary of Review Fixes, or empty if not posted. REQUIRED on every report, aborted ones included: absent, whether a Summary reached the PR is unstated, and an empty string read out of a missing field is a claim this run cannot make." },
    pings: { type: "string", description: "Which ping comments were posted, or empty." },
  },
  // `aborted` stays out of `required`, beside `pings` — this schema's other
  // may-be-empty field. Requiring it was tried and reversed: a packet that
  // misses validation reaches the caller as nothing at all, so one omitted
  // reason would take `threadOutcomes`, `pushed`, `pushedNewCommits` and the
  // summary URL down with it and force `published` false on a push that had
  // completed. The result note carries whatever is here inline instead, which
  // degrades to "no reason reported" and costs the rest of the report nothing.
  // `threadOutcomes` and `summaryCommentUrl` ARE required, for the opposite
  // reason: what a disposition record may say about origin is derived from
  // them, and a field read as `[]`/`""` because it was absent turns silence
  // into the positive claim "nothing reached origin". Required, silence is a
  // visible schema violation instead.
  required: ["published", "pushed", "pushedNewCommits", "threadOutcomes", "summaryCommentUrl"],
};

// What the disposition record's one write hands back. `posted` false is a report
// rather than a failure of the run — the run's status still names what happened
// to the PR — but it means this run's map exists only in the result, so the
// reason rides in `detail` where a maintainer reads it.
const RECORD_SCHEMA = {
  type: "object",
  properties: {
    posted: { type: "boolean", description: "True only if the record comment is on the PR — either newly posted or a prior record of the authenticated user's updated in place." },
    superseded: { type: "boolean", description: "True when this run UPDATED a prior record of its own rather than posting a new comment. Either way exactly one record write happened." },
    url: { type: "string", description: "Permalink to the record comment, or empty when nothing was written." },
    detail: { type: "string", description: "One line: whether it was posted or superseded, any further prior records left untouched, or what failed." },
  },
  required: ["posted", "detail"],
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
// this, whether the rebase phase pinned it or `no-rebase` pinned the commit
// the gather resolved this run's target to — the target an explicit
// `rebase on top of <target>` named, else the PR's base ref.
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
// deputies (gather, record, publish, worktree reclaim) carry it from here; the fix and review briefs
// below ride the NESTED wf-review-cycle, whose review-cycle-core section states
// the same boundary in the prompts it composes, so they do not restate it.
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

// This brief no longer rebases anything: the rebase is its own delegated step
// (see rebasePrompt below), so what gather does with the token is REPORT it.
// The one branch move left here is the reconciliation's `--ff-only`, which is
// why the brief still spells that out and nothing else.
function gatherPrompt(input, noRebase) {
  return `You are preparing a pull request for review-addressing. Read \`AGENTS.md\` / \`CLAUDE.md\` first.

${DEPUTY_FINISH_IN_TURN}

${DESTROY_BOUNDARY}

Request (lenient parsing — commas, &, free word order): ${JSON.stringify(input)}
Possible tokens: a PR number (e.g. #38), \`rebase on top of <target>\`, \`no-rebase\`, \`inline\`, \`off-shoot\`, \`no-push\`, \`push\`, \`peer-opinions=off\`, \`ping-codex\`, \`ping-claude\`, \`ping-copilot\`, \`ping-contributing\`. You act on the PR#, \`inline\`, and \`off-shoot\` here. The rebase you REPORT rather than perform — a separate delegated step does it, twice — so put the branch or commit an explicit \`rebase on top of <target>\` named into \`rebaseTarget\` and leave it empty when the request named none; \`no-rebase\` is read by the caller too, which composes this brief differently for it; the push/ping/peer flags are likewise the caller's and none of your business.

Preflight (set \`ok: false\` with a \`blocker\` and stop on any failure):
1. \`gh auth status\` succeeds.
2. The clean-tree and idle-tree checks belong to the WORKING LOCATION rather than to wherever you start, so run them once the step below has picked it — never here, and never auto-stashing or discarding anything either way. The two checks, wherever they run: \`git status --porcelain\` prints nothing, AND no Git operation is in progress — \`git rev-parse --git-path rebase-merge\` and \`rebase-apply\` for an existing path, plus \`MERGE_HEAD\`, \`CHERRY_PICK_HEAD\`, \`REVERT_HEAD\`, \`BISECT_LOG\`. Those markers are not decoration: a tree left mid-cherry-pick, mid-merge or mid-revert prints EMPTY porcelain and has no rebase path, so a rebase-only probe passes it and this run commits its fixes on top of that state. Working INLINE, this checkout must pass both; a failure is a blocker exactly as before. Working in a WORKTREE, nothing is required of this checkout — it may be dirty or mid-anything — because a worktree created for this run is clean by construction; a REUSED one (the slug survived a prior halted run) gets those same two checks, and whatever they find there is a blocker naming the path and what it holds, never something for you to clean up or force past.

Resolve the PR: explicit PR# wins (but sanity-check it shares history with the branch it would be worked on — if genuinely unrelated, blocker and stop); else auto-detect via \`gh pr view\`. When \`ok\` is true you MUST populate the whole \`pr\` object: \`number\`, \`url\`, \`branch\` (the PR's remote headRefName — the push target), \`workingBranch\` (the branch checked out in the working location, from \`git branch --show-current\` there), \`base\`, \`headOid\` (the PR's headRefOid — the publish phase needs it for a safe \`--force-with-lease\`), \`rebased\`, and the \`locationMode\`/\`worktree\` pair the next step decides. \`workingBranch\` usually equals \`branch\` — in worktree mode it always does — but for a local off-shoot of a merge-pending PR, which only the \`off-shoot\` token selects, it differs; downstream fixes edit \`workingBranch\`, while \`branch\`/\`headOid\` remain publication metadata for the push.

Pick the WORKING LOCATION now — after resolving the PR, before reconciling below (reconciling can fast-forward a branch, and it must move the branch the work will land on). Let \`T\` be the PR's headRefName and \`C\` the current branch (\`git branch --show-current\`, EMPTY when detached). Fetch the PR's exact head ref WITHOUT moving any branch and let \`R\` be \`git rev-parse FETCH_HEAD\` — the same \`R\` the reconciliation below uses, so one fetch serves both.

The identity check first, before any checkout or attach below — settling it afterwards would mean settling it on a ref already occupied. A branch is only this PR's when it shares recent history with the PR head (for a fork head, when its resolved push remote/ref matches the PR head repo/ref). That fork clause gates a candidate meant to BE \`T\` — the same-named local ref, and the branch case 2 checks out; a named off-shoot is a different branch by construction and is not held to it, since what may be pushed from it is the publish step's question. A local ref that merely bears \`T\`'s NAME while carrying unrelated history is a name collision — reusing a name like \`minor-fixes\` across unrelated work is ordinary practice — and it must never become the working location, in any of the four cases. Attach nothing and substitute nothing: not a disambiguated branch name (publication would ACCEPT it rather than stop: a name that differs from \`T\` routes its step 1 to resolve a verified target from the PR, and its step 2 asks such a branch only for REPRESENTATION, which one cut at the verified head passes — so the substitute's commits land on \`refs/heads/<T>\` with nothing there noticing, by a normal push, or under a lease that MATCHES once the default rebase has replayed them) and not a detached checkout (its commits are reachable from nothing once the worktree is reclaimed). Set \`ok: false\` with a \`blocker\` naming the rejected local ref, the verified PR head, and what each points at, and stop — branch hygiene is the maintainer's call.

Then take the FIRST case that applies:
1. The request carried the \`off-shoot\` token → the maintainer is telling you this checkout stands on a local off-shoot of the PR's branch, so work INLINE on \`C\` and report \`C\` as \`workingBranch\`, with \`T\`/\`headOid\` staying publication metadata for the push. It needs an explicit PR# (auto-detection has no PR to resolve from a branch that is not a PR head) and a NAMED branch: with \`C\` empty (detached) the token selects nothing, so set \`ok: false\` with a \`blocker\` saying exactly that. Run preflight item 2's two checks on this checkout and make a failure the blocker. Where \`C\` equals \`T\` the token is redundant — that is case 3. NOTHING BUT THE TOKEN routes a run here: no probe on the shape of \`C\`'s history may conclude off-shoot, because none can — the supported case is a branch cut BEFORE the PR head and advanced with its own commits, which is the same shape as a stacked child cut FROM the head and advanced, and working on the second as if it were the first publishes that child's own commits onto this PR under \`T\`. One thing can still make the request AMBIGUOUS, though it DISPROVES nothing, so check for it: another OPEN PR whose head is this same branch. Being an off-shoot of this PR and carrying a PR of its own are compatible, so such a PR is no evidence against the token; what it means is that two PRs could be advanced by the same commits and only the maintainer can say which — set \`ok: false\` with a \`blocker\` naming both branches and both PRs rather than choosing between them. Probe AT THE HEAD rather than through some base repository's PR list: resolve \`C\`'s own push remote/ref to an owner, a repository and a ref, then ask GraphQL \`repository(owner:<owner>,name:<repo>){ ref(qualifiedName:"refs/heads/<ref>"){ associatedPullRequests(states:OPEN,first:100){ nodes{ number url baseRepository{nameWithOwner} } } } }\`. Rooting the query at that ref is what makes it exhaustive and exact at once, and it is why ONE filter is left where two were needed: it answers with every open PR whose head IS that repository-qualified ref — whatever repository each one's BASE is in — and with nothing else. \`gh pr list --head\` delivers neither half: it reads ONE base repository, so a PR based in another never appears; its own \`--help\` says \`<owner>:<branch>\` is not supported, so it matches a bare branch NAME that a fork's same-named head answers too; and it stops at 30 items. A \`C\` that has never been pushed resolves \`ref\` to null and is nobody's PR head. The filter that remains: count a hit only where the PR's \`url\` DIFFERS from the resolved PR's own \`url\`, since where \`C\` is this PR's own head the query answers with this very PR and stopping on that would halt an ordinary run. Compare the \`url\` and never the \`number\`: a number is scoped to that PR's OWN base repository, and this answer set spans base repositories by construction — that is the whole reason the query is rooted here — so a conflicting PR can carry the very same number as the one you resolved, and comparing numbers would discard exactly the case this root was widened to reach. The \`url\` is globally unique and the query already asks for it. \`isCrossRepository\` has no part in this and is not requested: the field reports whether a PR's OWN head and base repositories differ, which is not the question — the query root already settles whose head it is — and reading it as an answer is what once made an upstream PR in a fork clone report false for a head that is not the fork \`C\` pushes to. And skipping the reconciliation below is not a licence to publish over the PR head: what may be pushed from an off-shoot is the publish step's question, not this one.
2. The request carried the \`inline\` token → work INLINE in this checkout, on \`T\`. Where \`C\` is not already \`T\`, run preflight item 2's two checks on it FIRST and make a failure the blocker — a run that switches this checkout and only then discovers dirt has moved it for nothing — then check \`T\` out here: \`gh pr checkout <N>\` for a fork head, else check out the local \`T\` where one EXISTS — the identity check above has already cleared it — and create a tracking branch at \`R\` only where NONE does, the same split case 4's two local-\`T\` arms make. A create is not a checkout: \`git checkout -b\`/\`git switch -c\` REFUSE a branch that is already there, so ordering one unconditionally fails the ordinary run forced inline from a checkout that has held this PR's branch before. The run ENDS on that branch; do not restore anything. Where \`C\` already IS \`T\` there is nothing to check out — that is case 3. This token does exactly what it says even when \`C\` is an off-shoot of this PR: it switches to \`T\` and works there, which leaves \`C\`'s ref and commits untouched but is NOT case 1 — only \`off-shoot\` puts the work on \`C\`.
3. \`C\` equals \`T\` and \`T\` passes the identity check above → work INLINE, exactly as this pipeline always has. The branch advances under whoever is standing on it, which is this case's contract rather than a side effect.
4. Anything else — any other branch, and a DETACHED HEAD, which has nothing to advance under anyone → work in a WORKTREE and leave this checkout alone: it is never switched, never dirtied, and never required to be clean, and whoever owns it may repoint it while you work. Attach \`T\` under the stable slug \`pr-<N>\` (stable so a halted run's worktree is found again rather than duplicated), placed under the repository's worktree base (\`<repo>/.worktrees/$CONTAINER_NAME/\`, the convention \`wt-enter\` uses). That base has to BE ignored, and only this run makes it so: \`git worktree add\` excludes nothing on its own, so in a repository that does not already carry the rule the nested add leaves \`?? .worktrees/\` in the main checkout — dirtying the one tree this case promises never to dirty, exposing it to a stray \`git add -A\`, and standing there indefinitely once a halt keeps the worktree. So before the arms below, run \`git check-ignore -q "<repo>/.worktrees/"\` — with the TRAILING SLASH, since \`/.worktrees/\` is a directory-only rule and \`check-ignore\` answers NO for a bare \`.worktrees\` that does not exist on disk yet, which is every first run — and, where it answers no, append \`/.worktrees/\` to the file \`git rev-parse --git-path info/exclude\` names — run it from inside \`<repo>\`, because in a primary checkout it answers with the RELATIVE \`.git/info/exclude\` (only a linked worktree gets an absolute path), so a \`git -C <repo>\` form whose answer you then append to from your own directory writes the rule to a file \`check-ignore\` never reads — then re-probe and make a still-no answer a blocker. Ask Git for that path rather than writing a literal \`.git/info/exclude\`: THIS checkout may itself be a linked worktree, where \`.git\` is a gitfile and \`.git/info\` is not a directory at all, so the literal append fails outright and the protection is never established — while \`--git-path\` resolves to the shared exclude file that \`check-ignore\` actually reads, in a linked worktree and a primary checkout alike. Either way it is the repo-local ignore file, which is untracked and so dirties nothing itself, and NOT the tracked \`.gitignore\`, which is the maintainer's to edit. This is the same base preparation \`address-reviews\` does in its bootstrap; a run that only ever attaches through \`wt-enter\` inherits nothing of it, because the helpers place worktrees there without ignoring the base either. BEFORE any of the three arms below, read \`git worktree list\`: every one of them adds at that same \`<worktree base>/pr-<N>\`, and \`git worktree prune\` — run it first, but it settles nothing here — clears only STALE registrations — a LIVE one survives it, and a live \`pr-<N>\` registration is precisely the halted run this stable slug exists to resume — so an add would fail on a path that is already occupied (and, off the fork arm, on an occupied branch too), leaving the resume path working only where the optional helper exists. Where \`<worktree base>/pr-<N>\` is already registered with \`T\` checked out, REUSE it rather than adding, whichever arm would otherwise have run; it is then the REUSED tree preflight item 2 checks. Where that path is registered on anything ELSE — a tree a halted fork arm below left behind because its give-back refused, included — set \`ok: false\` with a \`blocker\` naming the path and what it holds, never a second slug and never a removal. Then take the FIRST of these three arms that applies. A FORK head takes the first arm, ahead of both local-\`T\` arms: the fork arm is the only one that wires up the fork remote, and a prior fork run's \`gh pr checkout\` leaves a same-named local \`T\` behind, which the "local \`T\` EXISTS" arm would otherwise claim on the re-run and attach with no verified push target. It is \`git worktree add --detach "<worktree base>/pr-<N>"\` — the path argument is mandatory (\`git worktree add … <path> [<commit-ish>]\`), so a pathless form fails before \`gh\` is ever reached — followed by \`gh pr checkout <N>\` inside it, then verify for yourself that you landed on a NAMED branch carrying \`R\` (gh selects a same-named local branch even under \`--detach\`, and only declines to clobber it — that is not a check). Where that verification FAILS — a detached HEAD still standing, a failed \`gh pr checkout\`, or a branch not carrying \`R\` — set \`ok: false\` with a \`blocker\` naming the rejected local ref, the verified PR head, and what each points at, and attach nothing further and substitute nothing, exactly as the identity check above orders (it ran before this checkout and so cannot see a collision \`gh\`'s own branch selection creates); and give this worktree back as part of that report — \`wt-remove pr-<N>\` where \`command -v wt-remove\` finds it, else \`git worktree remove "<worktree base>/pr-<N>"\` — the same give-back \`address-reviews\` orders for this same failure, so the rejected ref does not sit on this stable slug and turn every re-run into the occupied-path stop above, which is the one thing no re-run can clear. Neither is a force, but their refusals are NOT the same: \`wt-remove\` refuses a dirty tree AND one with a Git operation in progress, the operations that leave \`git status\` clean included, while plain \`git worktree remove\` refuses the dirty tree and is blind to that mid-operation state — the same empty-porcelain blindness preflight item 2 above names. Nothing rides on that gap here: this tree was created seconds earlier and had only \`gh pr checkout\` run in it, so there is no operation for it to be in — do not grow a guard for it. Either way, a tree the command declines to remove is still standing and its path goes in the pair below; a removed one leaves nothing to report there. Otherwise, where a local \`T\` EXISTS, attach it: prefer \`wt-enter pr-<N> <T>\` where \`command -v wt-enter\` finds it — it is rerun-safe and prints the absolute path — else \`git worktree add "<worktree base>/pr-<N>" <T>\`. Where NO local \`T\` exists — the commonest way this case is reached, since a PR head you have never checked out has no local ref — the branch must be CREATED at the verified head, which \`wt-enter\` REFUSES to do without a base (\`branch '<T>' does not exist and no <base> was given\`): either \`git fetch origin refs/heads/<T>\` then \`git worktree add -b <T> "<worktree base>/pr-<N>" <R>\`, or \`wt-enter pr-<N> <T> <R>\`, which consults the base only when the branch is missing.

Report the choice as \`locationMode\` (\`inline\` or \`worktree\`) — both fields are REQUIRED of a successful gather, and an absent or unrecognized \`locationMode\` stops the run rather than defaulting to either — and, in worktree mode, its ABSOLUTE path as \`pr.worktree\` (empty inline). That pair is owed on a BLOCKER too, from the moment you attach or reuse a worktree: everything below can still stop the run — a reused tree holding a prior run's dirt, a halted rebase, an unrecognized branch state — and a stop is what LEAVES that worktree standing, so an \`ok: false\` packet raised after the attach carries \`pr.locationMode\` and \`pr.worktree\` — and every other \`pr\` field, all of them resolved before the location was picked and all of them required whenever \`pr\` is present — or the maintainer never learns the path. Name as \`pr.worktree\` only a tree that IS still standing: a blocker raised BEFORE any attach carries none, the honest report of a run that created none, and so does the fork arm's rejected landing once its give-back succeeded. In worktree mode, \`cd\` into it and require \`git rev-parse --show-toplevel\` to print exactly that path before doing anything else; every step below — the reconciliation, the rebase, the thread gathering's git reads — happens there, and NOTHING touches the main checkout again.

Reconcile the checked-out branch with the PR head — ONLY when \`workingBranch\` equals \`branch\`. Where the two names DIFFER the local off-shoot of case 1 is in play — the token put you there: \`branch\`/\`headOid\` are publication metadata for a branch you are not on, "behind the PR head" is that case's normal state, and you MUST skip this step whole — no probes, no branch move — reporting \`reconcile: { outcome: "not-applicable" }\`. (The location step's fetch is not this step: it moved nothing.) Skipping it settles only that this run may ACT on the off-shoot; it is not a promise that the off-shoot may be published over the PR head. That is the publish step's own question, and it answers it by requiring the recorded head to be represented in the tip being pushed before any lease.

Where the names match: fetch the PR's exact head ref WITHOUT moving the local branch, then take \`R\` from what that fetch actually brought — \`git rev-parse FETCH_HEAD\` — NOT from the recorded \`headRefOid\`. A fetch brings whatever the ref names NOW, and whether the recorded OID is a local object says nothing about that: it is normally reachable from your own checkout, so an existence check passes even when a push has since advanced the head, leaving you to reconcile against the stale tip. Where \`R\` differs from the recorded OID the head moved under you, which is not a failure — record \`R\` as \`pr.headOid\` before continuing, so the lease the publish phase builds names the head you actually reconciled against. Then with \`H\` = \`HEAD\`, run these two probes and take the FIRST outcome that applies:
1. \`git rev-list --right-only --cherry-pick H...R\` — the remote commits not represented in local. EMPTY → local already carries everything the remote has (identical, ahead by unpushed commits, rebased onto a newer base, restacked after a predecessor merged, or any combination). Report \`reconcile: { outcome: "work" }\` and proceed on \`H\` as it stands.
2. Else \`git merge-base --is-ancestor H R\` — true means local is strictly behind and holds nothing the remote lacks. Run \`git merge --ff-only <R>\`, report \`reconcile: { outcome: "fast-forwarded" }\`, and proceed. This fast-forward is the ONE branch move this assignment authorizes, and only on this path.
3. Else this run does not act on the branch. Return \`ok: true\` (this is NOT a failure and NOT a blocker), \`items: []\`, the \`pr\` object populated, and \`reconcile: { outcome: "unrecognized", detail: "<what you saw>" }\` — name both tips and the commits unique to each side. Do NOT pick a side, merge, rebase, reset, or force anything, and gather no threads: the caller stops the run and hands the branch back to the maintainer.

Those two probes are the whole rule; do not grow them into a classifier of branch states, which is exactly what the third outcome exists to make unnecessary. The first is patch-id based on purpose: \`--cherry-pick\` drops commits with a patch-id twin on the other side, so a branch rebased onto a newer base reads as carrying the PR head's content though it shares no SHAs with it, where a raw-ancestry test would call that ordinary state divergent. Do NOT filter merge commits out of that probe: patch-id cannot speak for a merge, so an unrepresented merge on the remote head lands in outcome 3 deliberately — one extra ask when a UI "Update branch" merge advanced the head, in exchange for never silently dropping a conflict resolution such a merge carried.

Read the tip this run STARTS from and report it as \`pr.startingHead\` — \`git rev-parse HEAD\` in the working location, after the reconciliation above (whether it fast-forwarded, found nothing to do, or was skipped whole as not-applicable) and before anything is fixed or rebased. EVERY run has one, the off-shoot and \`no-rebase\` paths included, which is why it is read here rather than taken from a rebase report a \`no-rebase\` run never produces: it is the \`starting HEAD\` of the disposition record a run that does not publish leaves, where it says which tree that run's verdict was rendered over.

Rebase NOTHING here, whatever the request asked for. Report \`pr.base = baseRefName\` and \`pr.rebased = false\`. ${noRebase ? `This run's review base is the gather's to pin (\`no-rebase\`), but pin it ONLY where there is a run to bound: resolve it AFTER the gathering below, and only where \`items\` came back NON-EMPTY — an empty gather is a terminal no-op the caller finishes before reading any base OID, so there report \`pr.baseOid\` EMPTY and fetch nothing for it. Where items were gathered, resolve the run's target to a commit ONCE and report the full OID as \`pr.baseOid\`. WHICH target that is, is the one thing to settle first, and you are the one holding the answer: where you are about to report a NON-EMPTY \`rebaseTarget\`, that token is the target — \`no-rebase\` suppresses the REBASE, not the target the request named, and bounding this run at \`baseRefName\` instead would hand the reviewer and the peer the underlying branch's own commits as this PR's diff. Resolve THAT one where it was named — here, in this working location, \`git rev-parse --verify '<the token>^{commit}'\` with the operand quoted as ONE argument, taking a local branch, a remote-tracking ref or a commit — and fetch NOTHING for it; where it does not resolve, report \`ok: false\` naming what you tried and substitute nothing. Only where \`rebaseTarget\` is EMPTY is the target this PR's own \`baseRefName\`, and only then does the rest of this paragraph apply: resolve it in the BASE repository and not through this branch's push remote. Those are two different repositories whenever the PR is cross-repository: the push remote is the HEAD repository, so \`<push-remote>/<baseRefName>\` there names a same-named branch in the fork — a different branch's tip, or nothing at all — and the push remote stays what it is for, the publication target. There is no base-repository field to ask for and none is needed: a PR's base always lives in the repository the PR itself is in, so the base repository is the \`<owner>/<repo>\` this PR's OWN URL names — the \`https://<host>/<owner>/<repo>/pull/<number>\` you report as \`pr.url\`, an explicit repository-qualified value you already resolved. Do not ask a bare \`gh repo view --json nameWithOwner\` for it: with no repository argument that command answers for the repository the DIRECTORY it runs in resolves to, which in a fork clone is the head fork — the one repository this paragraph exists to keep the fetch away from. \`isCrossRepository\` is no substitute for matching that repository against a remote's URL: it compares the PR's OWN head and base and says nothing about which repository this clone's remotes point at — a fork clone working a PR whose head and base both live upstream reads \`false\` while \`origin\` is still the fork. Where the URL match does land on this branch's push remote, one remote serves both. Fetch that repository's exact base ref WITHOUT moving any branch — \`git fetch <the remote whose URL is that repository, or that repository's URL where a fork clone has no remote for it> refs/heads/<baseRefName>\` — and resolve what the fetch brought: \`git rev-parse --verify FETCH_HEAD^{commit}\`, reporting the full unabbreviated OID git prints. Read no \`<remote>/<baseRefName>\` in its place: a remote-tracking ref is only as fresh as whatever last fetched it, so it can pin a commit the base has since moved past, and nothing else here fetches the base at all. That fetch OVERWRITES \`FETCH_HEAD\`, so run it only after every read of \`R\` above — the location step's, and the reconciliation's where it ran. A \`no-rebase\` run pins its review base to that OID, because every range this run delegates is taken against a commit rather than a name — a name moves under the next fetch or a sibling push.` : `This run rebases, so the delegated rebase step pins the review base itself and the caller reads a gather-time \`pr.baseOid\` only on a \`no-rebase\` run: report \`pr.baseOid\` EMPTY and fetch NOTHING for it — the base repository is not touched from here, so a checkout that can inspect the PR through \`gh\` but cannot Git-fetch that repository still gathers.`} Then put an explicit \`rebase on top of <target>\` token's target — a branch name or an exact commit, verbatim — into \`rebaseTarget\` (empty when none was named). A delegated rebase step runs immediately after you and again before publication; it resolves that target to a commit, pins it, and reports back what it landed on, and the caller replaces \`pr.base\`/\`pr.rebased\` from that report. Two agents both rebasing would replay the same commits twice, which is precisely why this one does not.

Gather feedback into \`items\` (each verbatim):
- UNRESOLVED review threads — PRIMARY: use the baked \`gh-review-threads\` helper. \`gh-review-threads <PR#>\` prints the unresolved threads as a JSON array (each thread \`id isResolved isOutdated path line\` and \`comments[]\` with \`databaseId author{ login __typename } body diffHunk url\`); it already pages with fresh SINGLE-SHOT queries (never \`gh api graphql --paginate\`), does the nested comment fetch-up, and applies the scope check below, failing closed with exit 3 and no stdout on a contaminated response. FALLBACK, only when \`command -v gh-review-threads\` fails (a container built from an older image — the same graceful-degradation used for the gh-version-gated Copilot ping): run the GraphQL \`reviewThreads\` query by hand as SINGLE-SHOT queries, never \`gh api graphql --paginate\` (run concurrently with other gh GraphQL calls it has returned ANOTHER PR's threads); include \`totalCount\` + \`pageInfo{ hasNextPage endCursor }\` and page past 100 threads by passing the returned cursor to a fresh call. Either way SCOPE-CHECK the result (the helper does this for you): every comment \`url\` must match the exact repo-qualified PR path for this PR (\`https://github.com/<owner>/<repo>/pull/<number>\` followed by \`#\`, \`/\`, \`?\`, or end); do not use a plain substring check such as \`/pull/<number>\`. On any mismatch, discard the entire response, retry once with a fresh single-shot query, and if it repeats fail closed; never emit an item whose \`url\` points at a different PR. Keep only \`isResolved == false\`. Emit each as \`type: "review-thread"\` with \`threadId\` (the thread node \`id\`), \`commentId\` (the top comment's \`databaseId\`), \`path\`, \`line\`, \`author\` (the top comment's \`author.login\`), \`authorIsBot\` (true when that comment's \`author.__typename\` is \`Bot\` — from the helper's output or the GraphQL \`author{ login __typename }\`; do not guess from the login), \`body\`, \`url\`. \`threadId\` and \`commentId\` are mandatory for these — they are how publication resolves and replies.
- Top-level context — ALWAYS fetch every review summary (\`gh pr view --json reviews\`) and every issue comment (\`gh api --paginate repos/<owner>/<repo>/issues/<PR>/comments\`, repository-qualified from the PR's OWN URL exactly as the base fetch above is: \`{owner}\`/\`{repo}\` expand to the repository of the current directory, which on a cross-repository PR is the head fork, where this PR's comments — and any prior record below — are not), even when the request names no standalone item: this sweep is how maintainer replies and decision comments are discovered. A maintainer reply on an unresolved thread is authoritative — fold it into that thread's context. So is a top-level maintainer comment recording per-item verdicts (often titled "Maintainer Decisions" or similar) — fold each decision into the relevant thread's context as its binding disposition (including "defer to a follow-up task" and "keep as-is"). One kind of issue comment is NEITHER of those: a DISPOSITION RECORD left by an earlier run of this workflow, recognized by the marker \`<!-- address-review:disposition-record -->\` as its FIRST LINE, byte for byte, rather than by its prose (a comment that merely quotes the marker is an ordinary comment). It is this workflow's own output, so it is never an item and carries no maintainer authority — do not fold its drafted replies into a thread as a decision. Report the most recent one as \`priorRecord\`: its permalink, and its body VERBATIM and WHOLE, since the drafted replies and the ready-to-post Summary body in it are the parts no later run can re-derive. The fix step below is handed exactly that text and told to re-judge every disposition it names against the branch as it now stands (its SHAs are provenance, not a promise: the recorded tip is local-only and a rebase since then may have rewritten every one of them), so an excerpt or a summary of it costs precisely the judgment the record exists to carry. Leave the comment itself alone — the record phase below is what supersedes it.
- A standalone issue comment or review summary becomes its own item if the request explicitly identifies it as outstanding — OR if the prior record above already holds a \`standalone\` disposition for it, which is an earlier run's request having identified it and is why this is not a second way in. Without that, the record's account of such an item cannot be replayed AT ALL: the fix step must emit exactly one disposition per gathered item, and publication rejects a \`standalone\` disposition whose url was never gathered, so the recorded judgment and the Summary text drafted for it are dropped in silence by the very run that read the record. So for each \`standalone\` entry the record names, re-fetch that url and emit the comment as an item where it is still there — the fix step then re-judges it against the branch exactly as it re-judges a thread's disposition, rather than replaying it on the record's word. Where the comment is gone (deleted, or the url no longer resolves), emit no item and say so in \`detail\`: an item that no longer exists is not outstanding work. Emit each as \`type: "standalone"\` with \`author\`, \`authorIsBot\`, \`body\`, and \`url\` (its permalink is the stable reference; it has no threadId and is never resolved as a thread).

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
  // `rebase on top of <target>` token names whatever the maintainer named —
  // routinely a local branch, or one in the head fork. Sending the second at the
  // base repository regresses that token exactly as `git fetch <repository>
  // <refspec>` reads it: an unrelated same-named branch upstream, or nothing at
  // all, which stops a run whose target was on disk the whole time.
  const pin = explicitTarget
    ? `The target is \`${target}\`, named outright by this run's request rather than taken from the PR. Resolve it WHERE IT WAS NAMED — here, in this working location — with \`git rev-parse --verify ${shq(`${target}^{commit}`)}\` — the operand quoted as ONE argument exactly as rendered, because a ref name may legally carry characters the shell would otherwise expand or split (\`$\`, backticks and \`;\` all pass \`git check-ref-format\`), and an unquoted \`$\`-fragment can silently resolve a DIFFERENT existing ref instead — which takes a local branch, a remote-tracking ref, or an exact commit, proves it names an existing COMMIT, and prints the full object id. Fetch NOTHING for it, and do not go looking for it in the PR's base repository: an explicitly named target is routinely a local branch or one in the head fork, so asking that repository for \`refs/heads/<it>\` pins an unrelated same-named branch there, or fails outright on a target that was on disk all along. Where it does not resolve here, report \`ok: false\` naming what you tried, and substitute nothing.`
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
Rebasing twice in one run is deliberate and cannot double-apply: each point pins its base to a commit and rebases onto that, so a base that has not moved since is already an ancestor of \`HEAD\` and git replays nothing — except to flatten a pure-join two-parent merge still in range (step 4 — an octopus halts there unprobed), which moves the tip once and leaves nothing for the second point to redo.

1. **Preflight.** \`git status --porcelain\` must print nothing AND no Git operation may be in progress — \`git rev-parse --git-path rebase-merge\` and \`rebase-apply\` for an existing path, plus \`MERGE_HEAD\`, \`CHERRY_PICK_HEAD\`, \`REVERT_HEAD\`, \`BISECT_LOG\` (a tree left mid-cherry-pick prints empty porcelain). Either failing is \`ok: false\` with what you found in \`detail\`. Stash nothing, clean nothing, force nothing.
2. **Pin the base.** ${pin} Report exactly that full OID as \`effectiveBase\` and rebase onto THAT OID, never onto the name, and never an abbreviation of it: a short id is a prefix, and a growing repository can make one match a second object, so the caller rejects anything but the full length. The name is not an answer: \`origin/<base>\` moves whenever anything else pushes or fetches, and every range this run delegates afterwards is taken against \`effectiveBase\`, so a name would bound a reviewer's diff at a tip this branch was never rebased onto. The caller rejects a non-commit \`effectiveBase\` and stops the run.
3. **Save the recovery ref, then read it back.** \`current_branch="$(git branch --show-current)"\` (require it non-empty), \`ts="$(date -u +%Y%m%d-%H%M%S)"\`, \`before="$(git rev-parse --verify HEAD)"\`, then \`git update-ref "refs/pre-rebase/$current_branch/$ts" "$before"\`. That is the one \`update-ref\` this assignment spells out and the run's only rebase recovery ref — do not skip it. Then prove it is there and points where you say: \`git rev-parse --verify "refs/pre-rebase/$current_branch/$ts^{commit}"\` must print \`$before\`. Report the ref path IN FULL as \`recoveryRef\` — \`refs/pre-rebase/\` then this branch then the timestamp, nothing truncated and no other branch's — that read-back OID as \`recoveryTip\`, and the pre-rebase tip as \`before\`. The caller checks the three against each other, so a ref it cannot see resolve to that tip stops the run instead of standing as this replay's only way back.
4. **Rebase — merges in the range first.** A plain \`git rebase\` replays NO merge commit, so enumerate them before replaying anything: \`git rev-list --merges <the effectiveBase OID>..HEAD\`. A merge that merely joined its parents flattens harmlessly — its content is its parents', and the replay carries it. One that introduced content of its own (a conflict resolution, or a hand edit made in the merge — \`git show --remerge-diff <it>\` prints the delta) carries work no replayed commit holds, and where nothing replayed conflicts over the same lines the rebase drops that work silently, with the force-push that follows this run making the loss permanent. That probe answers only for a merge with exactly TWO parents: on an octopus merge (more than two — \`git rev-list --parents -n 1 <it>\` shows them) \`git show --remerge-diff\` prints no delta at all — just the commit header and \`diff: warning: Skipping remerge-diff for octopus merges.\` — and exits 0, so that silence is the probe declining to answer, NOT evidence of a pure join — treat such a merge as content-bearing without probing it, and name the files \`git diff <it>^1 <it>\` touches in place of the delta's. On such a merge rebase NOTHING: report \`halted: true\` with a \`question\` naming that merge and the files its delta touches — the same halt shape as step 5's, though with no rebase started there is nothing to abort; confirm the tree clean and idle by step 1's two checks all the same. Otherwise: \`git rebase --no-update-refs --no-rebase-merges <the effectiveBase OID>\` — both flags spelled out because inherited config would otherwise reshape the replay: \`rebase.updateRefs=true\` would have it force-move every other un-checked-out local branch pointing into the range, refs this assignment never touches and the recovery ref does not cover, and \`rebase.rebaseMerges=true\` would have it RECREATE a pure-join merge instead of flattening it, publishing merge topology this step promises to remove and voiding the flatten-once reasoning above. Git's patch-id detection drops commits the base already carries. If nothing was replayed and the tip is unchanged, that is the expected no-op: report \`noop: true\` with \`before\` equal to \`after\`, run no validation, and you are done. Those two tips are the evidence, not decoration: \`noop: true\` is what tells the caller to run no validation on this point and to spend no reviewer round re-verifying the tree afterwards, so the caller adopts it only where both are reported and equal, and stops the run on a no-op claim that names a moved tip or names none.
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
// A prior DISPOSITION RECORD, REPLAYED rather than re-triaged. Replaying it is
// the whole reason one was written: the drafted replies and the judgment behind
// each disposition are the expensive part of a run, and a fixer that never sees
// them pays for them again, most likely reaching a different answer on exactly
// the calls that were costly the first time. So the record is embedded VERBATIM
// in the round-1 brief — the same move `rebaseReverifyInstructions` makes with
// the first cycle's report, for the same structural reason: the cycle's scope
// carries `{ title, instructions, reviewInstructions, items }`, the items are the
// gathered threads, and nothing in them holds a disposition.
// Only the ROUND-1 brief gets it. The re-verification's fixer is handed THIS
// run's own reviewed dispositions instead, which have already absorbed whatever
// the replay concluded, so a second "prior" set there would put two baselines in
// front of one round.
// The rule below is `address-review`'s "Replaying a record" rendered for an agent
// that has read no skill (task 023a's inline-the-instruction rule): patch-id as
// the first probe and never a gate, the tree as the only authority, every SHA
// re-derived. The probe belongs to whoever judges the dispositions, which is this
// fixer — the gather has no dispositions to judge, and by the time it runs the
// branch has not yet met this run's pre-fix rebase.
// VERBATIM is the whole value of this section, and two things would quietly cost
// it. The body is embedded UNCHANGED — trimming decides only whether there is a
// record at all, never what gets embedded, since a reply body's own leading or
// trailing blank line is content. And the delimiter is longer than the longest
// backtick run inside the body, by construction: a record legitimately ENDS with
// its `## Summary comment` block holding a full markdown body, which may itself
// be fenced, so a fixed ``` wrapper is closed by the record's own fence and the
// mark that says where the record ends goes ambiguous for exactly the part the
// record exists to carry. `PACKET_SCHEMA.priorRecord` requires `url` and `body`
// together, so a bodyless record is rejected before this runs; the emptiness test
// is the last line of defense rather than a path a run is meant to take.
function priorRecordSection(priorRecord) {
  const body = priorRecord && typeof priorRecord.body === "string" ? priorRecord.body : "";
  if (!body.trim()) return "";
  const url = priorRecord.url ? ` (${priorRecord.url})` : "";
  const longestRun = (body.match(/`+/g) || []).reduce((n, run) => Math.max(n, run.length), 0);
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `

## An earlier run left a DISPOSITION RECORD on this PR — replay it, do not re-triage it

That comment${url} is an earlier run of this workflow's own output: not feedback, not a maintainer decision, authoritative over nothing, and never a reason on its own to reply to a thread. What it holds that you cannot re-derive is the drafted reply bodies and the judgment behind each disposition, so start from it rather than re-triaging the items it already covers.

**First, is it SPENT?** A record whose \`status:\` line reads \`SPENT\` and which carries no \`## Threads\` block is one a later run already published in full and then emptied, keeping only the marker so this step reads it as spent rather than as absent. It holds no disposition and cites no \`final HEAD\`, so there is nothing to probe and nothing to carry forward: the steps below do not apply to it, every item you were given is ordinary untriaged work, and you say in your report that the record you were handed was spent. Everything below is about a record that still holds entries.

1. **Patch-id first, as a probe and never a gate.** With \`F\` the \`final HEAD\` the record cites and \`B\` the branch tip now, run \`git rev-list --right-only --cherry-pick B...F\`. Printing NOTHING means every recorded commit is represented and the record replays as written.
2. **A non-empty result rejects nothing.** A rebase that resolved a conflict, or split or squashed a commit, rewrites the resulting patch-ids while keeping the work — this run's own pre-fix rebase may have just done it — and it could not decide the question even if it were the gate: a fix that survived a conflict resolution and one that was later reverted both print the recorded commit as unrepresented. Neither can a probe that cannot run at all: \`F\` may no longer be a local object (a fresh clone, a pruned repository), and an absent recorded commit is not an absent fix. Fall through to the tree in every one of those cases, and assert nothing about \`F\` equalling \`B\`.
3. **Then judge per thread, against the tree rather than the record.** Is the fix that disposition claims present in the branch as it now stands — for a \`deferred-to-task\` disposition, is its task file still committed there? Present → carry the disposition and its drafted reply forward, and RE-DERIVE the \`Fixed in <sha>\` citation from the branch as it now stands instead of copying the recorded SHA. Genuinely gone → that thread loses its disposition: triage it from scratch this round, and never report it as fixed on the record's word. Unsettleable from the tree → \`ambiguous-skipped\`, carrying the record's account of it in \`detail\`, rather than discarded because a probe was inconclusive.
4. Say which of those three happened in that item's \`detail\` — replayed, re-triaged because the fix was gone, or handed back as unsettleable. A thread the record does not name is ordinary untriaged work. A record naming threads that are no longer unresolved replays to nothing, which is the right answer rather than a conflict: it is only ever the account of the run that wrote it. A \`standalone\` disposition it names was re-fetched and gathered as a work item for exactly this reason, so it is in your items and takes a disposition like any other; where the comment behind one is gone it was not gathered, and that entry replays to nothing too.

### The prior record, verbatim

Everything between the two lines of ${fence.length} backticks below is that comment's body, byte for byte. The fence is that long because it must be longer than any backtick run inside the record — the Summary body it ends with is itself markdown and may be fenced, and a shorter delimiter would be closed by the record's own fence rather than at its end.

${fence}
${body}
${fence}`;
}

function fixInstructions(packet, priorRecord) {
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

Which of those fields are structurally enforced: every field publication acts on is re-checked before anything is pushed, and one bad entry aborts the whole publication — \`type\`, \`kind\`, \`detail\`, \`author\`, \`authorIsBot\`, \`newFinding\`, a \`review-thread\` entry's \`threadId\`/\`commentId\`, and a \`standalone\` entry's \`url\`. The identifying ids are matched against the gathered items, and the two echoed fields (\`author\`, \`authorIsBot\`) are compared against the item they came from — so echo what you were handed rather than what you judge to be more accurate. \`ref\` is not required at all, and neither is a \`review-thread\` entry's \`url\` nor a \`standalone\` entry's \`threadId\` — those two are only checked for not naming some OTHER gathered item, which would make one entry read as covering two. Write them anyway: \`ref\` is what names an entry in the run's own report, including when some other field gets that entry rejected.${priorRecordSection(priorRecord)}`;
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
A disposition the fixer REPLAYED from an earlier run's disposition record is confirmed against the tree exactly like a fresh one — the record is provenance, not evidence — and its \`Fixed in <sha>\` citation must name a commit the branch carries NOW: a replayed SHA that the tree does not carry is a blocking issue, since publication would post it into the thread.
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
// Step 2's REPRESENTATION probe is the off-shoot's own gate rather than a
// universal pre-lease check, and the scoping is deliberate (task 021c). On the
// PR's own branch the reconciliation already established representation before
// any fix landed, and re-asking here would newly stop an ordinary run: a head
// carrying a merge commit reconciles as `work` by ancestry, and this run's
// default rebase then flattens that merge away — its content replayed onto the
// fresh base, its patch-id gone — so a probe run after the rebase would print
// the merge and abort the very force-push the rebase was performed for. The
// off-shoot has no such prior establishment: reconciliation is skipped whole
// there, so the probe is the only thing between an off-shoot cut before the
// head and a lease that MATCHES.
// Item 1's PR-derived target resolution is scoped to the off-shoot for a
// different reason. The ordinary path's "resolve THIS branch's push remote/ref
// and verify they match the PR head" is a check in its own right — it is what
// stops a run whose checkout moved to some unrelated branch after the review —
// so it is retained rather than replaced, and the PR-derived resolution is the
// exception for the one branch that fails it by construction. Item 1 also
// re-verifies that the checkout still stands on `workingBranch`, which is what
// makes the NAME both gates key on a present fact rather than a record taken
// before the fixes landed.
//
// Two of task 023's GitHub-reliability recipes are rendered INLINE here — the
// push read-back at step 2, the reviewer-request confirmation at step 6 — and
// that is the answer to 023a's prior question rather than an assumption. This
// workflow is a peer ENTRY POINT to the `address-review` skill, not a driver
// whose subagents have read it: it registers its own command, and no brief it
// renders names a file under `skills/` — this publication brief included. So a
// pointer was rejected, exactly as it was for `DESTROY_BOUNDARY` and the
// delegated rebase nugget above: a brief handed to a subagent that has read
// nothing else must be self-contained.
// Each is the instruction and its one settling read and no more (task 044), and
// each is pinned against the skill's own sentence in
// `test-address-review-reconcile.mjs`. That pin is on the PHRASES the two sides
// share and claims no more: it fails a rewording that drops one on either side,
// and it MISSES a rewrite that keeps every pinned phrase while reversing what
// they say — the same hole README states of its own `FETCH_HEAD` pins, and for
// the same reason, so polarity here is the reviewer's to hold rather than the
// pin's. The other three recipes get no text: item 5 is
// already satisfied by steps 1 and 3 re-fetching the PR before the push and
// re-reading the threads after, so restating it would be the copy commit
// 390156a declined, and items 3 and 4 are pre-merge check polling and
// `gh pr merge --delete-branch`, which nothing in this pipeline performs.
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

1. Re-check before publication: clean worktree, no rebase in progress; re-fetch the PR and confirm it is still open and still points at the expected head repo/ref. Confirm the working location still stands on the branch this run addressed — \`git branch --show-current\` must print \`${packet.pr.workingBranch}\`, and ask it in exactly that spelling, not \`git rev-parse --abbrev-ref HEAD\`, which is documented to produce a NON-AMBIGUOUS name and so prints \`heads/${packet.pr.workingBranch}\` wherever a tag shares the branch's name, aborting a publication that was valid — because every rule below is keyed on that NAME rather than on the shape of the history, and a checkout that moved to some other branch since the review would be published from with the wrong HEAD; where it prints anything else, set \`published: false\`, \`aborted: "working location moved off the branch"\`, and STOP without pushing. Then resolve the push target, which is a different question in each case (\`workingBranch\` \`${packet.pr.workingBranch}\` against head ref \`${packet.pr.branch}\`):
   - Where the two names are the SAME, resolve THAT branch's exact push remote/ref and verify they match the PR head (never assume \`origin\`, especially for forks). A branch whose own push resolves somewhere else is not the ref this PR publishes from: STOP rather than pushing to a target you resolved some other way.
   - Where they DIFFER — the off-shoot case — that comparison is one the branch fails by construction, and failing it is not the answer: resolve the target from the PR instead (its head repository and \`refs/heads/${packet.pr.branch}\`) and verify the remote you resolved is that repository. Read that repository as \`gh pr view ${packet.pr.number} --json headRepository,headRepositoryOwner,isCrossRepository\`, naming all three fields: the owner alone does not identify a fork whose repository NAME differs from the base repository's, and \`isCrossRepository\` false is the cheap short-circuit saying one remote serves both. The off-shoot's own upstream is NOT the target, is never pushed to by this run, and its failing to match the PR head is that case's normal state rather than a stop. What an off-shoot may put ON the head ref is step 2's representation probe, not a name comparison here.

   Expected head OID to replace: \`${packet.pr.headOid}\`. If the head moved or the target repository/ref can't be matched, set \`published: false\`, \`aborted\`, and STOP — do not guess.
2. Push. Work the cases below IN ORDER before running any push, and never skip ahead to the lease. Each excludes the ones above it and the last is "everything else", so no state leaves you choosing.
   - If HEAD is a PROPER ANCESTOR of the expected tip \`${packet.pr.headOid}\`, the remote branch is ahead of you: there is nothing of yours to publish, a normal push cannot fast-forward it, and the lease below is the trap — it MATCHES, so it succeeds and rewinds the branch, deleting the newer remote commits. Set \`published: false\`, \`aborted: "local behind PR head"\`, and STOP without pushing, exactly as for a rejected lease.
   - Then, BEFORE any lease, establish that the expected tip is REPRESENTED in what you are about to push. This is the off-shoot's gate: where the branch you addressed is not the PR's head ref (\`workingBranch\` \`${packet.pr.workingBranch}\` against head ref \`${packet.pr.branch}\`) the gather step skipped reconciliation WHOLE — "behind the PR head" is that case's normal state — so nothing in this run has yet compared the two tips. Run \`git rev-list --right-only --cherry-pick HEAD...${shq(packet.pr.headOid)}\`, the reconciliation's own probe (patch-id rather than raw ancestry, so a branch rebased onto a newer base still reads as carrying the head), and require it to print NOTHING. Whatever it prints is work the recorded head carries and this push would delete, and no lease protects it: the recorded OID is exactly what the remote still points at, so the lease MATCHES, the push succeeds, and the PR branch is rewound over commits this run never saw. Set \`published: false\`, \`aborted: "off-shoot does not carry the PR head"\`, and STOP without pushing, naming BOTH tips — the expected tip \`${packet.pr.headOid}\` and the HEAD you would have pushed — and every commit the probe printed. Do NOT fast-forward, merge, rebase or otherwise reconcile the off-shoot to make the push legal: that state goes back to the maintainer, exactly as the reconciliation's third outcome does. One shape reaches this stop with nothing actually lost: an off-shoot that carried the head until this run's own rebase flattened a merge commit the head carries — content replayed, patch-id gone — so the probe prints that merge. Report it the same way rather than filtering merges out, which is the trade the reconciliation's own probe already makes: one extra ask where a UI \"Update branch\" merge is in the head, against never silently dropping what such a merge resolved. Where the two names are the SAME, this is already settled — the reconciliation established representation before any fix landed, and item 1 has just re-verified both that the head has not moved since and that the checkout still stands on that same branch — the name is therefore a present fact rather than a record from the start of the run — so run no probe there and go on.
   - Then, if the expected tip is an ancestor of HEAD, normal push (\`git push <remote> HEAD:refs/heads/${shq(packet.pr.branch)}\`).
   - OTHERWISE — every remaining state, whether or not this run rewrote history (rebased: ${packet.pr.rebased ? "yes" : "no"}) — use an exact lease: \`git push <remote> --force-with-lease=refs/heads/${shq(packet.pr.branch)}:${shq(packet.pr.headOid)} HEAD:refs/heads/${shq(packet.pr.branch)}\`. The remainder is deliberately not "history was rewritten": a tip carrying the expected head by patch-id without having it as an ancestor is the ordinary result of a rebase, and it reaches this same instruction whether that rebase happened in this run or before it. If the lease is rejected, NEVER escalate to bare \`--force\`; set \`published: false\`, \`aborted: "lease rejected"\`, and stop.

   Then, whichever push ran, confirm what actually LANDED against the ref itself rather than from \`gh pr view --json headRefOid\`, which can still report the pre-push head for a while after the push returns: run one \`git ls-remote "<url>" refs/heads/${shq(packet.pr.branch)}\` for each URL \`git remote get-url --push --all <remote>\` lists, and require every one of them to come back with the HEAD you pushed. Read those push URLs back one at a time rather than the remote NAME: \`git push\` writes to EVERY configured push URL, plain \`--push\` names only the first, and where a remote carries a distinct \`pushurl\` the name reads a repository the push never wrote to. \`git ls-remote\` is observational and exits 0 even when it prints nothing, so an absent ref, a disagreeing OID, or a URL you could not reach is a stop rather than a pass: set \`published: false\`, \`aborted: "${PUSH_UNCONFIRMED_ABORT}"\`, \`pushedNewCommits: false\`, and report what each URL returned.
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
6. Pings (only after push + summary succeeded, AND only when the push ACTUALLY advanced the remote branch with new commits or rewritten history — never on an \`Everything up-to-date\` no-op push): ${flags.pingCodex ? "post a dedicated comment \`@codex review\`. " : ""}${flags.pingClaude ? "post a dedicated comment \`@claude review\`. " : ""}${flags.pingCopilot ? "request a fresh Copilot review with \`gh pr edit <PR#> --add-reviewer @copilot\` (the canonical CLI request; needs gh >= 2.88.0). Do NOT post an \`@copilot review\` comment — a bare \`@copilot\` mention drives Copilot's coding agent (it can start editing the branch), not its reviewer. The add-reviewer request re-triggers Copilot's review even on a PR it already reviewed (tested working — not a silent no-op), and never misfires into the coding agent. GUARD: before issuing it, confirm the installed \`gh\` supports the \`@copilot\` reviewer value (gh >= 2.88.0 — e.g. check \`gh --version\`); on an older powbox base image where \`gh pr edit --add-reviewer @copilot\` errors, SKIP the Copilot request WITHOUT failing publication — the push and summary already succeeded, so this is non-fatal: keep \`published: true\`, record it in \`pings\` as 'copilot: skipped (gh too old)', and note that the base image needs refreshing (\`agent-update\`) or a one-off manual re-request from the PR's web reviewer menu. CONFIRM the request you issued from the TIMELINE, never from \`gh pr view --json reviewRequests\`: that GraphQL-backed field reads back empty on a request that succeeded, and REST \`gh api repos/{owner}/{repo}/pulls/<PR#>/requested_reviewers\` lists one only while it is still pending, so it can confirm a request but never refute one — the durable evidence is a \`review_requested\` event in \`gh api --paginate repos/{owner}/{repo}/issues/<PR#>/timeline\`. Snapshot the \`id\`s of the events naming that reviewer BEFORE issuing the request and afterwards require one that is NOT in that snapshot, matching by event id rather than against your own clock, and paginate BOTH reads. Where no unseen event appears, record it in \`pings\` as 'copilot: requested, unconfirmed' and carry on with whatever pings remain: do not fail publication, and do NOT issue the request again." : ""}${!flags.pingCodex && !flags.pingClaude && !flags.pingCopilot ? "none requested. " : "If more than one ping was requested, perform each as its own dedicated action (never one comment mentioning several bots). "}If nothing new was pushed this run (the remote ref already pointed at your HEAD — e.g. every disposition was already-addressed/push-back, or the branch was up to date), SKIP all pings even if requested above: re-requesting a review with nothing new to look at would spin the review->address->review loop forever. Set \`pushedNewCommits\` to whether the push advanced the branch, and record which pings (if any) you posted in \`pings\`.${deviationLead}${flakeRecord}

## Dispositions to publish

${JSON.stringify(dispositions, null, 2)}

Record each item's outcome in \`threadOutcomes\`, and set that entry's \`replied\` and \`resolved\` to the state of the thread ON THE PR when your turn ends rather than to what you attempted — so a reply you skipped under the duplicate rule above, an equivalent one of yours already being there, is \`replied: true\`, and a thread you found already resolved is \`resolved: true\`. That account is read back against what step 4 above OWES each disposition: a report claiming the publication COMPLETE while its own entries say a thread it owed a reply never got one is a contradiction, and the caller refuses the completion claim over it exactly as it refuses one that accounts for nothing. Each entry carries the item's MACHINE IDENTITY — a \`review-thread\` item's \`threadId\`, a \`standalone\` item's \`url\`, echoed verbatim from its disposition — beside the human \`ref\` (file:line + author), which identifies nothing on its own: two threads a re-review left on the same line by the same author share a \`ref\`, and an account keyed on it cannot say which of them was replied to.

Report them even where publication stops part-way, and report EXACTLY ONE entry per item you were given — every item, whether or not you reached it, and never a second entry for one you already reported. Such a run leaves a disposition record, and what it may say about origin is derived from this account as complements: an item your account names once is settled either way, while an item it leaves out, names twice, or names by an identity this run never handed you leaves the record no choice but to say the outcome is UNKNOWN and send the next turn to the PR — because a reply you posted and did not report would be posted twice by a turn that assumed it was owed, and one you never posted would never be posted at all. Where you abort before the push touched anything, report \`[]\` and an empty \`summaryCommentUrl\`: that is the complete account of having acted on nothing, and both fields are required either way.`;
}

// The DURABLE DISPOSITION RECORD — the `address-review` skill's section of that
// name, rendered once for this workflow. Every exit that holds this run's
// disposition map and does not publish it in full writes it, so the map outlives
// the session: this run's result is chat output, and closing the session used to
// lose which thread was pushed back, what the drafted rationale said, and what
// the Summary comment would have said — precisely the judgment calls the next
// run would otherwise re-derive from scratch, most likely differently.
// It is the ONE PR write a `no-push` run makes, carved out as that flag's single
// documented exception rather than gated behind a flag of its own: a gate would
// make durability opt-in and so lose the record in exactly the runs that end
// unexpectedly, and it would add a fifth token to a push/ping resolution this
// family has already learned not to grow.
// Nothing here REPLAYS a record. Replay belongs to the NEXT run: its gather
// step reports a prior record into the packet as a proposal rather than an item,
// and its round-1 fixer is handed that text and the rule for judging it against
// the branch rather than trusting its SHAs (`priorRecordSection`). This brief
// only writes one, and marks it so that step can find it. And it runs BEFORE the worktree is given back, so the
// tips it cites are read where the work actually happened.
// Its three PR writes are REPOSITORY-QUALIFIED from the PR's own URL, for the
// reason the base fetch above already is: on a cross-repository PR handled from
// a fork clone the working location IS the head fork, while the PR and its
// comments live in the base repository — and both `gh api`'s `{owner}`/`{repo}`
// placeholders and a bare `gh pr comment` answer for the current directory's
// repository. Unqualified, the lookup would search the fork and report no prior
// record, the `PATCH` would address a comment id there, and the create would
// post this record onto a same-numbered PR in the fork.
function recordPrompt(packet, dispositions, facts) {
  const where = packet.pr && packet.pr.worktree
    ? `Your working location is the worktree \`${packet.pr.worktree}\`. Before anything else, \`cd\` into it and verify \`git rev-parse --show-toplevel\` prints exactly that path; if not, STOP and report. Every git read below runs there. Do NOT touch the main checkout: it is on another branch and is none of this run's business.`
    : `You work in the repository's current checkout, which is on the branch this run addressed — do NOT create a worktree and do NOT switch branches.`;
  // A publication that stopped PART-WAY holds the same map with replies left to
  // replay, so it leaves the same record — but `status: not published` would be
  // a lie once part of the map is on origin and only the rest failed, and what
  // "this run pushed nothing" claims of the tips follows the push rather than
  // the map (the LANDED-rendering note below). `landed` is what the
  // publisher's account puts ON the PR — end state, so a reply an earlier run
  // posted counts, which is why the lead below says the map is part-way rather
  // than that this run put it there — `outstanding` what is still owed, and
  // `outcomes` its per-thread account of which is which; `landed` selects the
  // rendering the skill's format defines for that case. Empty is the ordinary
  // run: nothing of the map is on the PR at all — and `pushNoop` is the one shape
  // between them, a push that succeeded while moving nothing, where the tips are
  // on origin though nothing of the map is.
  // `unknown` is the THIRD state, and it is not a fourth flavour of "nothing
  // reached origin": it says the publisher gave no usable account of what it
  // posted, so this run does not KNOW. It outranks the other three, because
  // every one of them asserts something about origin that an unaccounted run
  // cannot assert — and the publisher pushes before it replies, so "died after
  // something landed" is the ORDINARY shape of a part-way stop rather than an
  // exotic one. `perThread` is the standing of each entry, keyed to the
  // dispositions by the caller (never by `ref`, which two threads can share).
  // The LANDED rendering reads the push states too, for its one claim about
  // the tips — in the lead, and again on the record's own `reached origin`
  // line, which is the durable copy a later turn acts on and so must not leave
  // the tips fact to the brief that dies with this run: replies and resolves
  // land through the API, so a map part-way on the PR does not imply a push —
  // a refused completion claim whose own account says no push succeeded is
  // landed (its replies are on the PR) while its tips are still local-only,
  // and a record silent about that would send its reader looking for commits
  // origin does not have. Only the `advanced` state appends no tips clause
  // there: its landed list already names the push that put the tips on origin.
  // What an unusable account does NOT put in doubt is the push, which is
  // reported positively and in three states rather than two — so the third
  // state's own rendering says which of them holds and reserves "unknown" for
  // what actually is unknown. All three of its lines come from ONE entry below,
  // because they drifted apart the moment they did not: a status of "UNKNOWN
  // whether anything was published" stood two lines above "what IS known is
  // that the push advanced the remote branch", and the same record both refused
  // to claim anything reached origin and said the tips were there.
  const landed = typeof facts.landed === "string" ? facts.landed.trim() : "";
  const outstanding = typeof facts.outstanding === "string" ? facts.outstanding.trim() : "";
  const outcomes = Array.isArray(facts.outcomes) ? facts.outcomes : [];
  const unknown = typeof facts.unknown === "string" ? facts.unknown.trim() : "";
  const perThread = Array.isArray(facts.perThread) ? facts.perThread.filter((l) => typeof l === "string" && l.trim()) : [];
  // The tip the map below was JUDGED on, which the working location's HEAD is
  // not known to be — either case of `reviewedMapOf`. Empty is the ordinary run,
  // whose `final HEAD` is read where the work happened.
  const judgedTip = typeof facts.judgedTip === "string" ? facts.judgedTip.trim() : "";
  // And whether this map is known NOT to account for the gathered items
  // one-for-one, which is what forbids superseding an earlier record with it:
  // the update is a `PATCH` in place, and an entry the earlier record holds for
  // an item this map omits, doubles, or cannot publish would go with it.
  const incomplete = typeof facts.mapIncomplete === "string" ? facts.mapIncomplete.trim() : "";
  // The identities carried only by dispositions that ARE the incompleteness —
  // doubled or unpublishable — which the carry step below must treat as carried
  // by nothing: the caller computes them against the gathered items, which the
  // record's author cannot re-derive from the dispositions JSON alone.
  const compromised = Array.isArray(facts.compromisedIdentities)
    ? facts.compromisedIdentities.filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim())
    : [];
  const priorUrl = packet.priorRecord && typeof packet.priorRecord.url === "string" ? packet.priorRecord.url.trim() : "";
  // The three push states, each with the lead, the `status:` line and the origin
  // line it implies. An unrecognized or absent state reads as `unknown`, which
  // claims the least. `noop` is the state a two-valued flag lost: a push that
  // succeeded while moving nothing leaves the remote pointing at these tips
  // (`PUBLISH_SCHEMA.pushed` says exactly that of itself), so telling the next
  // turn their presence on origin is unknown understates what the run knows.
  // The table is PROTOTYPE-LESS, and the fallback below is why that is not a
  // flourish: on a plain object literal a `pushState` of `constructor`,
  // `toString`, `valueOf`, `hasOwnProperty`, `isPrototypeOf` or `__proto__`
  // resolves to a truthy INHERITED value, so the `||` never fires and the record
  // renders `status: undefined`, its lead and claims sentences as the literal word
  // `undefined`, and an origin line whose whole claim is that same word — so it
  // matches none of the three renderings and says NOTHING where the fallback
  // exists to say the least. A null prototype deletes that class rather than
  // guarding each name in it.
  const UNKNOWN_BY_PUSH = Object.assign(Object.create(null), {
    advanced: {
      lead: "This run's publication PUSHED and then stopped, and WHAT ELSE IT PUBLISHED IS UNKNOWN",
      claims: "So this record says the push was published, and neither claims that any reply, resolve or Summary comment reached the PR nor claims that none did",
      status: "published in part (the push), and UNKNOWN whether any reply, resolve or Summary comment was published",
      origin: "the push WAS published — it advanced the remote branch, so the tips above ARE on origin — while whether any reply, resolve or Summary comment below was published is UNKNOWN",
    },
    noop: {
      lead: "This run's publication stopped and WHAT IT PUBLISHED IS UNKNOWN",
      claims: "Its push succeeded while moving nothing, so this record says the tips are already on origin, and neither claims that any reply, resolve or Summary comment reached the PR nor claims that none did",
      status: "UNKNOWN whether any reply, resolve or Summary comment was published",
      origin: "this run's push published NOTHING — it was an `Everything up-to-date` no-op, so the tips above are already on origin though this run put nothing there — while whether any reply, resolve or Summary comment below was published is UNKNOWN",
    },
    unknown: {
      lead: "This run's publication stopped and WHAT IT PUBLISHED IS UNKNOWN",
      claims: "So this record neither claims that nothing reached origin nor claims that anything did",
      status: "UNKNOWN whether anything was published",
      origin: "whether anything reached origin is UNKNOWN — not even a push is known to have advanced the remote branch, so whether the tips above are on origin is unknown too",
    },
  });
  const pushCase = UNKNOWN_BY_PUSH[facts.pushState] || UNKNOWN_BY_PUSH.unknown;
  // A push whose own read-back did not CONFIRM the ref is none of the cases
  // above: `git push` returned, so the tips may be on origin, and every line
  // this record would otherwise print asserts their absence — "published
  // NOTHING", `not published`, LOCAL ONLY, and the warning about commits that
  // are not there. All of them come from this ONE entry, the way the three push
  // states' do, because that is what stopped those drifting apart. It defers to
  // the two cases that already claim less or more precisely: an unusable
  // account, which knows nothing about the push either, and a part-way
  // publication, whose lines name what the account CONFIRMED reaching origin —
  // never this push, which the caller withholds from `landed` for that reason.
  const unconfirmedPush = facts.pushUnconfirmed && !unknown && !landed
    ? {
        lead: `This run's publication PUSHED and could not CONFIRM that push at the ref: ${facts.why} So this record says whether the push reached origin is UNKNOWN rather than calling its tips local-only — the two lines below marked for that case are the ones that differ.`,
        status: "UNKNOWN whether its push reached origin, and nothing else was published",
        origin: "whether this run's push reached origin is UNKNOWN — `git push` returned and the read-back at the ref did not confirm the ref moved, so read the ref itself before treating the tips above as either published or local, while no reply, resolve or Summary comment reached the PR",
        reader: " — a reader who takes this record for \"nothing reached origin\" treats these tips as unpushed when the ref may already carry them",
      }
    : null;
  return `Leave this run's disposition record on PR #${packet.pr.number} (branch \`${packet.pr.workingBranch}\`). ${unknown
    ? `${pushCase.lead}: ${facts.why} ${pushCase.claims} — the lines below marked for that case say what is unknown, and every thread entry carries the same reservation.`
    : landed
      ? `This run's publication stopped with PART OF THIS MAP ALREADY ON THE PR: ${facts.why} So this record says what is on it rather than "not published", and its tips are ${facts.pushState === "advanced" || facts.pushState === "noop"
        ? "NOT local-only"
        : "still LOCAL-ONLY — replies and resolves land through the API without a push, and this run's own account reports no successful push, so what is on the PR does not put these tips on origin"} — the two lines below marked for that case are the ones that differ. What is named as having reached origin is what the PR CARRIES, whichever run put it there — a reply an earlier run posted counts — so write it as that rather than as an account of this run's own writes.`
      : unconfirmedPush
        ? unconfirmedPush.lead
        : `This run published NOTHING: ${facts.why}`} Read \`AGENTS.md\` / \`CLAUDE.md\` first.

${where}

${DEPUTY_FINISH_IN_TURN}

${DESTROY_BOUNDARY}

You make exactly ONE PR write — this record comment — and nothing else: no push, no reply, no resolve, no Summary comment, no ping, no label, no review request. If you cannot make that one write, report \`posted: false\` with what failed; never compensate by writing something else.

WHICH REPOSITORY every command below addresses: the one this PR is IN, whose \`<owner>/<repo>\` is already resolved and handed to you in the PR's own URL \`${packet.pr.url}\` — never the repository your working location resolves to. On a cross-repository PR the checkout is the HEAD fork while the PR and its comments live in the base repository, and BOTH command families default to the wrong one there: \`gh api\`'s \`{owner}\`/\`{repo}\` placeholders expand to the repository of the current directory, and a bare \`gh pr comment\` posts into the repository it resolves the same way — so unqualified, the lookup searches the fork and finds no prior record, the \`PATCH\` addresses a comment id in the fork, and the create comments on a same-numbered PR there or fails outright. So write that \`<owner>/<repo>\` out LITERALLY in each command below. Do not re-derive it from a bare \`gh repo view --json nameWithOwner\`, which with no repository argument answers for the directory — in a fork clone the head fork, the one repository this item exists to keep these three writes away from.
1. Find a prior record. \`gh api --paginate repos/<owner>/<repo>/issues/${packet.pr.number}/comments --jq '.[] | select((.body | split("\\n")[0] | rtrimstr("\\r")) == "<!-- address-review:disposition-record -->") | {id, login: .user.login, updated_at}'\` — the MARKER identifies a record, never its prose, and it must be the body's FIRST LINE byte for byte. A \`contains\` test is what you must NOT use: it also selects an ordinary comment that merely QUOTES the marker (a maintainer asking about this mechanism, a review summary echoing it), and step 2 would then \`PATCH\` that person's comment away. The \`rtrimstr("\\r")\` is why a body GitHub hands back with CRLF line endings still matches its own first line. Keep the ones authored by the authenticated user (\`gh api user --jq .login\`).
2. Compose the body below, then write it ONCE, reading it from stdin so composing it puts no file in the working location: ${incomplete
    ? `this run's map is INCOMPLETE (${incomplete}), so it SUPERSEDES NOTHING — post it as a new comment with \`gh pr comment ${packet.pr.number} --repo <owner>/<repo> --body-file -\` and leave every record step 1 found standing, your own included, reporting \`superseded: false\`. The update is a \`PATCH\` in place, so an entry an earlier record of yours holds for an item this map leaves out, names twice, or cannot publish would be destroyed by it and the next run would inherit only this replacement — the very loss this record exists against. Name in \`detail\` the record(s) you left standing${priorUrl ? ` (the most recent is ${priorUrl})` : ""}.`
    : `a prior record of your own → \`gh api --method PATCH repos/<owner>/<repo>/issues/comments/<id> -F body=@-\`, which supersedes it IN PLACE so the PR keeps one record instead of a stack of near-duplicates; none → \`gh pr comment ${packet.pr.number} --repo <owner>/<repo> --body-file -\`.`} Where several of your own are present (one predating the marker, say), ${incomplete ? "report them all in \`detail\`" : "update the most recent and report the rest in \`detail\`"}: delete, sweep or expire NOTHING, and never touch another actor's comment.
3. Write "codex"/"claude"/"copilot" PLAIN in the body, with no bare \`@\`-mentions anywhere, exactly as the Summary comment does — a mention here would summon a review round for work this run did not publish.

The body, marker first (the marker line is what step 1 of the next run matches, so it is mandatory and must be byte-exact):

\`\`\`
<!-- address-review:disposition-record -->
# address-review packet — PR #${packet.pr.number} (${packet.pr.workingBranch})
status: ${unknown ? pushCase.status : landed ? "published in part" : unconfirmedPush ? unconfirmedPush.status : "not published"} (<the reason above, one line${unknown ? ", saying which facts are missing" : landed ? ", saying what landed and what did not" : unconfirmedPush ? ", saying what each push URL returned" : ""}>)
starting HEAD ${facts.startingHead || "(not recorded — neither the gather nor a rebase point reported one)"} | final HEAD ${judgedTip || "<the tip you read>"} | recorded headRefOid ${packet.pr.headOid}
base ${packet.pr.base} | validation <what ran> | reviewer ${facts.reviewerStatus || (facts.reviewerPassed ? "Pass" : "did NOT pass")} (${facts.rounds} round(s)) | peer <participation>
${unknown
    ? `${pushCase.origin}: ${unknown}; the publisher pushes BEFORE it replies, so a stop with something already on origin is the ordinary shape of this failure: check the PR itself before acting on any tip or any entry below`
    : landed
      ? `reached origin: ${landed} — still outstanding: ${outstanding}${facts.pushState === "advanced"
        ? ""
        : facts.pushState === "noop"
          ? " — and the tips above are already on origin, this run having put nothing there: its push was an \`Everything up-to-date\` no-op"
          : " — and the tips above are still LOCAL-ONLY: what landed rode the API with no successful push, so nothing of the branch is on origin"}`
      : unconfirmedPush
        ? unconfirmedPush.origin
        : facts.pushNoop
          ? "this run changed NOTHING on origin: its push was an `Everything up-to-date` no-op, so the tips above are already on origin while no reply, resolve or Summary comment reached it"
          : "the tips above are LOCAL ONLY — this run pushed nothing, so they are not on origin"}

## Threads
[<disposition>] <path>:<line>  <author>  thread=<threadId or url>
                url:   <permalink>
                reply: "<the exact reply body a publishing turn would post, verbatim>"

## Summary comment (verbatim, ready to post)
<the full markdown body>
\`\`\`

${incomplete
    ? `- This map is INCOMPLETE (${incomplete}), so say so in the \`status:\` line's reason${priorUrl ? ` and name the earlier record that still stands (${priorUrl})` : ""}: a reader must not take this record for the whole account of this PR, and the entries it does carry are a real triage of the items they cover rather than a draft. Every one of them still gets its full entry below.${priorUrl
      ? ` And leaving the earlier record standing preserves nothing on its own: the next run's gather replays only the MOST RECENT record — this one, once posted — so an entry living only in the record this one displaces is never replayed again, and a \`standalone\` item only that record names is never even re-gathered, for as long as the older comment stands unread. So CARRY the earlier record's orphaned entries into this one: fetch the body of the record this run replayed — the comment at ${priorUrl}, whose comment id is the number its \`#issuecomment-<id>\` fragment ends with: \`gh api repos/<owner>/<repo>/issues/comments/<id> --jq .body\` — and append to this record's \`## Threads\` block, verbatim and whole (kind, reference, permalink, reply body, any task line), every entry of its own \`## Threads\` block whose identity (\`thread=<threadId or url>\`) no disposition below carries${compromised.length
        ? ` — a disposition that is itself part of what makes this map incomplete (one of several naming the same gathered item, or one publication rejected as unpublishable) carrying NOTHING for this test, since the account it gives of its item is the very thing this map cannot publish while the displaced record's entry is the one durable copy of a judged reply for it: the identities so compromised here are ${compromised.map((v) => `\`${v}\``).join(", ")}, so a prior entry keyed to one of them is carried too`
        : ""}, marking each \`carried unchanged from ${priorUrl}\` so a reader knows this run did not re-judge it — the next run's replay re-judges every entry against the tree either way. Where that comment is gone, or is spent and holds no \`## Threads\` block, carry nothing and say so in \`detail\`.`
      : ""}\n`
    : ""}- ${judgedTip
    ? `\`final HEAD\` is given above as \`${judgedTip}\` — write it EXACTLY as given and read no tip for it. It is the tip the reviewer's verdict was rendered over, and the dispositions below are that round's; the tip standing in the working location may be a LATER one a pass committed on top of it, and citing that would hand the next run's replay probe a tree no reviewer ever passed — which, the recorded commits all being its ancestors, prints nothing and so reads as "the record replays as written". Report what \`git rev-parse HEAD\` prints in the working location in \`detail\` instead, as this run's parting tip.`
    : "`final HEAD` is what `git rev-parse HEAD` prints in the working location. Read it there rather than repeating a SHA from this brief."}
- One \`## Threads\` block entry per disposition below, in that shape, and EVERY entry carries the same field set whatever its kind: the disposition kind, its stable reference (path:line, author, and the \`threadId\` for a review thread or the \`url\` for a standalone item), the permalink, and the reply body VERBATIM — a \`deferred-to-task\` entry adding the committed task file and its queued or deferred placement beside them rather than in place of them, since which thread a follow-up closes is not re-derivable from the PR. The drafted reply bodies and the ready-to-post Summary body are the only parts of this record that cannot be re-derived from the PR later, so they are the parts that must be exact.
- The \`## Summary comment\` block holds the "Summary of Review Fixes" body a publishing run would have posted — what was fixed, a prominent "Pushed back — please re-examine" section, a "Deferred to follow-up tasks" section naming each committed task file, and any ambiguous/skipped item — ready to post unchanged. Where the cycle recorded locked-decision deviations, that body LEADS with them under a "Deviation from a locked decision" section, since a later turn posts what you wrote here as it stands. Standing deviations for this run: ${JSON.stringify(facts.deviations || [])}.
- The SHAs are PROVENANCE, not a promise. Assert nothing about them holding later: the branch may be rebased before any push, which rewrites every one while changing nothing about whether the work is there. Do not write "the branch tip is <sha>" as a condition a replay must check, and do not omit the header's last line${unknown
    ? " — a reader who takes this record for \"nothing was published\" either re-posts a reply that already landed or never posts one that did not"
    : landed
      ? " — a reader who takes a part-way publication for a complete one stops looking for the replies that never landed"
      : unconfirmedPush
        ? unconfirmedPush.reader
        : " — a reader who takes those SHAs for origin's goes looking for commits that are not there"}.${perThread.length
    ? `\n- Every thread keeps its entry and its verbatim reply, this run's stopped publication included — and each entry says WHERE IT STANDS. That standing is NOT yours to derive: the lines below are already matched to the dispositions by the identity publication routes on (\`thread=<threadId or url>\`, never \`ref\` — file:line plus author is shared by two threads a re-review left on one line, so it identifies neither). Copy each line's standing onto the entry it names, above that entry's verbatim reply body, and change nothing else:\n${perThread.map((l) => `  ${l}`).join("\n")}\n  Never drop an entry because its reply landed, and never drop one because its standing is unknown: the difference between the two is the whole reason this rendering exists.${unknown
      ? ` What the publisher DID report is below, for a maintainer's eye and not as a fact to act on — a report that broke the contract these facts are read under is distrusted WHOLE, so no part of its per-thread account is acted on here, an entry that looks complete included: ${JSON.stringify(outcomes)}.`
      : ""}`
    : ""}

Report \`posted\`, \`superseded\` (true when you updated a prior record of your own), \`url\` (the record comment's permalink), and one line of \`detail\`.

## Dispositions to record

${JSON.stringify(dispositions, null, 2)}`;
}

// The write that ENDS a record's life, and the only PR write a fully published
// run makes beyond publication itself.
// A record is REPLAYED rather than re-triaged, and the review-thread half of
// that replay terminates on the PR: the gather keeps only `isResolved == false`,
// so a record whose threads a later run resolved replays to nothing. A
// `standalone` entry has no such state — nothing on the PR marks a comment as
// addressed, which is precisely why the gather reintroduces one from the record
// at all — so the RECORD is the claim that the item is outstanding. A record
// that outlives the publication of its own map therefore hands that item to
// every later run as fresh work, indefinitely: re-gathered, re-judged, re-listed
// in every future Summary comment, and turning what should be the zero-item
// no-op into a full fix/review/publish cycle. So the run that publishes the map
// in full spends the record that held it, by the same in-place supersession the
// record already uses: same marker, so a later run still FINDS it, and no
// entries, which is what leaves nothing for any replay to pick up.
// It supersedes only a record that is already there. Where the PR carries none
// there is nothing to spend, and posting one would create the very thing this
// step exists to end — so the brief's step 2 writes nothing in that case.
// And it spends THE RECORD THIS RUN REPLAYED, named by the url the gather
// reported, rather than "the most recent record of your own" the supersession
// selects by. The two questions are different, and the difference is not
// symmetric: a supersession that lands on the wrong record REPLACES one map with
// another, while a spend EMPTIES it — so a record this run never read, holding
// entries this publication did not put on the PR, would lose them outright. The
// same-account cases where they differ are ordinary enough to name: a PR
// carrying a record from another actor's account (the gather reports the most
// recent record of ANY author, the writes here are filtered to this one), and a
// second record of this account's own left standing beside an earlier one by the
// incomplete-map carve-out. So the id is taken from `priorRecord.url` and the
// write FAILS CLOSED where the PR no longer carries it: an unspent record is
// replayed again by the next run, which the run's `note` surfaces, while a
// mis-targeted spend is a silent deletion nothing later can notice.
// `priorUrl` is always a url here: `spendPriorRecord` returns before rendering
// this where the gather reported none, so step 1 below names one rather than
// carrying a fallback nothing reaches.
function spendRecordPrompt(packet, facts) {
  const summaryUrl = typeof facts.summaryUrl === "string" ? facts.summaryUrl.trim() : "";
  const priorUrl = typeof facts.priorUrl === "string" ? facts.priorUrl.trim() : "";
  return `Spend the prior disposition record on PR #${packet.pr.number} (branch \`${packet.pr.workingBranch}\`). This run PUBLISHED the addressed review IN FULL, so the map that record holds is on the PR and nothing in it is outstanding. Read \`AGENTS.md\` / \`CLAUDE.md\` first.

${DEPUTY_FINISH_IN_TURN}

${DESTROY_BOUNDARY}

You make at most ONE PR write — updating that record comment in place — and nothing else: no push, no reply, no resolve, no Summary comment, no ping, no label, no review request. If you cannot make that one write, report \`posted: false\` with what failed; never compensate by writing something else. And you make NO write at all where step 1 does not find THAT record, still there and still yours: there is then nothing this run may spend, and posting a new comment would create exactly what this step exists to end.

WHICH REPOSITORY every command below addresses: the one this PR is IN, whose \`<owner>/<repo>\` is already resolved and handed to you in the PR's own URL \`${packet.pr.url}\` — never the repository your working location resolves to. On a cross-repository PR the checkout is the HEAD fork while the PR and its comments live in the base repository, and \`gh api\`'s \`{owner}\`/\`{repo}\` placeholders expand to the repository of the current directory — so unqualified, the lookup searches the fork and finds no record to spend, and the \`PATCH\` addresses a comment id in the fork. So write that \`<owner>/<repo>\` out LITERALLY in each command below. Do not re-derive it from a bare \`gh repo view --json nameWithOwner\`, which with no repository argument answers for the directory — in a fork clone the head fork again.
1. Find THE record this run replayed — the comment at ${priorUrl}, whose comment id is the number its \`#issuecomment-<id>\` fragment ends with. It is the ONLY record this run may spend: its map is the one this publication put on the PR, and any other record on this PR is some other run's account, which the in-place update below would EMPTY rather than replace. Confirm it is still there and still yours: \`gh api --paginate repos/<owner>/<repo>/issues/${packet.pr.number}/comments --jq '.[] | select((.body | split("\\n")[0] | rtrimstr("\\r")) == "<!-- address-review:disposition-record -->") | {id, login: .user.login, updated_at}'\` — the MARKER identifies a record, never its prose, and it must be the body's FIRST LINE byte for byte. A \`contains\` test is what you must NOT use: it also selects an ordinary comment that merely QUOTES the marker (a maintainer asking about this mechanism, a review summary echoing it), and step 2 would then \`PATCH\` that person's comment away. The \`rtrimstr("\\r")\` is why a body GitHub hands back with CRLF line endings still matches its own first line. Yours are the ones authored by the authenticated user (\`gh api user --jq .login\`).
2. Where that listing does not carry that id as a record of your own — it is gone, it is another actor's, or no id could be read from the url — write NOTHING: report \`posted: false\`, \`superseded: false\`, and say in \`detail\` which of those it was. Do NOT fall back to the most recent record of your own, or to any other: an unspent record is replayed by the next run and this run's report says so, while a spend written over the wrong record deletes a map nothing later can recover. Otherwise update THAT id IN PLACE with the body below, read from stdin so composing it puts no file in the working location: \`gh api --method PATCH repos/<owner>/<repo>/issues/comments/<id> -F body=@-\`. Report any further records the listing shows in \`detail\` rather than touching them, and never touch another actor's comment: delete, sweep or expire NOTHING.
3. Write "codex"/"claude"/"copilot" PLAIN in the body, with no bare \`@\`-mentions anywhere — a mention here would summon a review round for work that is already published.

The body, marker first (the marker line is mandatory and must be byte-exact: a spent record must still be FOUND as a record by the next run, which is how it reads as spent rather than as absent):

\`\`\`
<!-- address-review:disposition-record -->
# address-review packet — PR #${packet.pr.number} (${packet.pr.workingBranch})
status: SPENT — the map this record held has since been published in full by a later run of this workflow${summaryUrl ? `, whose Summary comment is at ${summaryUrl}` : ""}
nothing here is outstanding: every reply and resolve that publication owed reached the PR, and every standalone item this record named was carried into that run's Summary comment — one it could not settle appearing there as the ambiguous/skipped item it is, which is where a maintainer picks it up, since a spent record hands nothing to a later run. This record is kept, and kept findable by its marker, so a later run reads a SPENT record rather than a live one.
\`\`\`

Write NOTHING else into it — no \`## Threads\` block and no \`## Summary comment\` block, and do not carry the old ones forward. Their content is on the PR now, and their ABSENCE is what ends this record: a run REPLAYS a record rather than re-triaging it, and while the review threads a record names self-terminate on having been resolved, a standalone item has no resolved state on the PR at all — so an entry left standing here would be re-gathered as fresh work by every later run, forever.

Report \`posted\`, \`superseded\` (true when you updated a prior record of your own), \`url\` (that comment's permalink), and one line of \`detail\`.`;
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
// Every flag below except `offShootTok`, whose reason is stated at its
// declaration, is read from THIS text rather than from the request as
// written, because one construct in the request carries a value that is not
// flag text at all: `rebase on top of <target>` names a ref, and an ordinary
// ref component is spelled exactly like one of these flags. `rebase on top of
// feature/no-rebase` set `noRebase` and suppressed the very rebase it asked
// for, silently ignoring the target the gather went on to report; `fix/no-push`
// and `wip/ping-codex` are the same defect on the other flags. So the target
// VALUE is elided once, here, ahead of every flag that reads this text — one
// construct removed rather than a guard bolted onto each flag.
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
//   no-push                   -> local-only; the ONE PR write is the disposition
//                                record every non-publishing exit leaves (the
//                                pre-change default, which mutated nothing)
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
// positive `rebase` flag to read, since `rebase on top of <target>` names a
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
const packet = await agent(gatherPrompt(args, flags.noRebase), { label: "gather", schema: PACKET_SCHEMA });
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
// rather than the hazard the rule fires on. That exemption is about ACTING on
// the branch and nothing else: it is not a promise that the off-shoot may be
// published over the PR head. `publishPrompt`'s step 2 decides that on its own,
// by requiring the recorded head to be represented in the tip being pushed
// before any lease — two gates, two questions, and this one covers only the
// first. Two outcomes let the run continue
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
// The echo is owed wherever it is CONSUMED — an `ok: true` gather with items,
// which is where this sits: behind EVERY preceding exit, the blocker exit and
// the metadata and location validations, the working-branch and reconciliation
// gates, and the empty-gather no-op. There its ABSENCE is a contract violation
// rather than "the request named none": the caller reads this field alone, and
// since it also decides the review base on the `no-rebase` path, a silent
// fallback is a wrong boundary for every range this run delegates and not only
// a wrong rebase target. Checked HERE rather than in the schema's `required`,
// and for the reason `PUBLISH_SCHEMA` records against itself: a packet that
// misses validation reaches the caller as nothing at all, so requiring this
// echo would take a blocker packet's `blocker` and `pr.worktree` down with it —
// the only channel that reports a worktree a halted run left standing. An
// omitted field is distinguishable from an empty one here, so the guard costs
// nothing that the schema would have risked.
if (typeof packet.rebaseTarget !== "string") {
  return {
    status: "gather-contract",
    pr: packet.pr,
    // This stop sits AFTER the reconciliation gate, so it is reachable on
    // `fast-forwarded` — a run that MOVED the local branch and would otherwise
    // report only that nothing was addressed, hiding the move.
    reconcile,
    detail: "The gather reported no `rebaseTarget` at all. That field is the run's only record of whether an explicit `rebase on top of <target>` token was given, and an absent one cannot be told apart from a target the caller must honor — on a `no-rebase` run it decides the review base too, so continuing would bound every delegated range at the PR's base ref on a request that may have named another target.",
    note: `Nothing was addressed and nothing was pushed${reconcile && reconcile.outcome === "fast-forwarded" ? ", though this run did fast-forward the local branch to the PR head before stopping" : ""}. Re-run: the gather must report \`rebaseTarget\` whenever it returns items to address, as the empty string where the request named no target.`,
  };
}
const explicitRebaseTarget = packet.rebaseTarget.trim();
const rebaseTargetRef = explicitRebaseTarget || packet.pr.base;
const rebaseRecord = {
  target: rebaseTargetRef,
  explicitTarget: Boolean(explicitRebaseTarget),
  points: [],
  ...(flags.noRebase ? { suppressed: "`no-rebase` was given: neither point ran, and the branch is addressed and published on the base it already sits on. The review base is that target resolved to a commit, since nothing rebased to pin one." } : {}),
};
// Runs one point and returns either `{ rebase }` — the report, with `pr.base`
// already replaced by the pinned OID — or `{ stop }`, a result the run returns
// as it stands. Everything that is not a clean rebase stops the run: a halt
// (a mid-rebase conflict aborted, or a content-bearing merge met before any
// replay), a failed rebase, a broken build, a recovery ref the report cannot name in full or show resolving to the tip
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
      `The ${point} rebase halted on a decision beyond the delegated step's competence — a mid-rebase conflict it aborted, or a content-bearing merge it met before any replay, with no rebase started — and left the tree clean and idle.`,
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
  // the one path that has no rebase report to check. The gather resolved that
  // commit for exactly this, which is `address-review` step 6's fallback for a
  // turn in which no rebase ran — BOTH of its arms, since `no-rebase` drops
  // the rebase and not the target the request named: the gather resolves a
  // still-standing `rebase on top of <target>` where it was named and this
  // PR's own base ref only where the request named none. Either way an
  // unusable value stops the run rather than being delegated as a name. That stop is a halt like the rebase
  // stops below, so it keeps the worktree and reports it through `pr.worktree`
  // rather than reclaiming it.
  const pinnedBase = typeof packet.pr.baseOid === "string" ? packet.pr.baseOid.trim() : "";
  if (!isFullOid(pinnedBase)) {
    return {
      status: "unpinned-base",
      pr: packet.pr,
      rebase: rebaseRecord,
      detail: `\`no-rebase\` was given and the gather reported ${JSON.stringify(packet.pr.baseOid === undefined ? null : packet.pr.baseOid)} as this run's target commit, which is not a full commit OID. With no rebase to pin one, that value IS this run's review base, and a movable name or an abbreviation cannot bound a delegated diff.`,
      note: "Nothing was addressed and nothing was pushed. Re-run so the gather resolves this run's target — the branch or commit an explicit `rebase on top of <target>` named, else the PR's own base ref — to a full commit OID, or drop `no-rebase` and let the rebase phase pin it.",
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
    // The prior record goes to the ROUND-1 fixer only, which is the one round
    // that triages: this is where replaying it saves the judgment it holds.
    instructions: fixInstructions(packet, packet.priorRecord),
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

// --- The DISPOSITION RECORD, finalized in ONE place --------------------------
// `recordPrompt` is this workflow's rendering of the `address-review` skill's
// "The durable disposition record"; this is the single place the run decides to
// leave one. Every exit that HOLDS this run's disposition map and does not
// publish it in full finalizes through here, so the only question a new exit has
// to answer is whether it calls this — not what it should re-derive. It was one
// inline dispatch keyed on a reason computed from the conditions the exits
// between it and publication branch on, which by construction left out the exits
// AHEAD of that computation (the pre-push rebase's stops, and a replay with no
// re-verification budget left) and the one PAST it (a publication that did not
// complete).
// A map with no entries records nothing: the skill's rule that a run with
// nothing triaged says so in its report rather than posting an empty record.
// An exit that passes no reason records nothing either.
// The ONE substantive exemption is a map NO REVIEWER EVER JUDGED, and it is
// keyed on that fact rather than on which exit is asking — the distinction it
// used to be keyed on, "a cycle that errored", is not the same question and is
// FALSE for some errors. `wf-review-cycle` sets `confirming` only after a round
// PASSED, and the confirmation pass that follows can stop the cycle outright
// (returning nothing, blocking, coming back on an unclean worktree), which
// leaves `verdict: "error"` standing over exactly the map that just passed
// review. So the cycle reports `workReportReviewed` — whether a reviewer round
// passed over the map being carried out, which is false again once a later pass
// replaced it — and every exit reads that. A cap-hit cycle records for the same
// reason it always did: its dispositions are a finished round's triage with
// findings still outstanding, and `reviewer did NOT pass (N rounds)` is a line
// its record prints truthfully.
// What the exemption still covers is a map of genuinely unknown completeness
// over an unknown tree: a round that never finished, no verdict of any kind
// rendered over its entries. A record is REPLAYED rather than re-triaged
// (`priorRecordSection`), so recording that would hand the next run's round 1 a
// baseline no reviewer ever stood behind — while the map itself rides out in the
// result, beside the error that produced it, where a maintainer reads both.
// The post-merge error exit holds TWO maps and neither is exempt by that test:
// `mergedCycle` spreads `after`, so its `workReport` is the failed
// re-verification's own, but `preRebaseCycle`'s PASSED review on the base before
// the replay. Both ride out in the result, and the one RECORDED is the most
// recent JUDGED map that HAS ENTRIES — which is not always the one the cycle
// carries out, and is what `reviewedMapOf` below answers.
// It always runs before the worktree is given back, because every exit that
// reclaims one is below the call that records for it — so the tips it cites are
// read where the work happened.
let dispositionRecord = null;
async function leaveDispositionRecord(why, map, facts) {
  const held = Array.isArray(map) ? map : [];
  if (!why || !held.length) return {};
  phase("Record");
  // The tip this run started from. The gather reads it in the working location
  // after the one fast-forward it may perform, so EVERY run has one — including
  // `no-rebase`, which has no rebase report to take it from. A rebase point's
  // `before` is the same commit and stands in where a gather reported none;
  // absent both, the brief says it was not recorded rather than inventing one.
  const startingHead =
    (typeof packet.pr.startingHead === "string" ? packet.pr.startingHead.trim() : "") ||
    (rebaseRecord.points[0] || {}).before ||
    "";
  const written = await agent(recordPrompt(packet, held, { ...facts, why, startingHead }), {
    label: "record",
    schema: RECORD_SCHEMA,
  });
  dispositionRecord = written || { posted: false, detail: "the record phase returned nothing, so this run's disposition map survives only in this result." };
  return { dispositionRecord };
}
// And the mirror of it on the ONE path that leaves no record: a full
// publication, which has just put on the PR everything a prior record was
// holding. `spendRecordPrompt` above says why that record cannot simply be left
// standing. Nothing is written where the gather found no record — the loop it
// ends needs one to exist — so this is a no-op on the ordinary first run.
async function spendPriorRecord(summaryUrl) {
  const priorUrl = packet.priorRecord && typeof packet.priorRecord.url === "string" ? packet.priorRecord.url.trim() : "";
  if (!priorUrl) return {};
  phase("Record");
  const spent = await agent(spendRecordPrompt(packet, { summaryUrl, priorUrl }), {
    label: "spend-record",
    schema: RECORD_SCHEMA,
  });
  return {
    spentRecord: spent || { posted: false, detail: "the record-spending phase returned nothing, so whether the prior record still holds this run's now-published map is unknown." },
  };
}
// WHICH map a stopped cycle records, in one place because two exits ask it. Both
// halves of the test earn their keep. A map with NO ENTRIES records nothing
// (`leaveDispositionRecord`'s rule above), so selecting on "was it reviewed"
// alone let a passed-but-empty map suppress the record outright — and where a
// second, older reviewed map stood behind it, take that one down with it, which
// is the loss this whole mechanism exists against. And the map a reviewer judged
// is not always the map leaving the cycle: a later pass can REPLACE it and then
// stop the cycle, so the cycle reports the judged map separately
// (`reviewedWorkReport`) and it is recorded while the unjudged map it carries out
// rides out under `dispositions` — without which that judged map, drafted replies
// and all, reached no PR comment and no result key at all.
// `replaced` names ONE branch over TWO shapes, which is why the record's wording
// names both rather than a third `which`: `wf-review-cycle` reports
// `workReportReviewed: false` both for a later pass that returned DIFFERENT
// entries and for one that committed a new `finalSha` while returning the
// identical entries (`test-review-cycle-retirement` drives that same-map/new-tip
// shape on both of its workflow legs). Nothing was replaced in the second, yet the
// consequence is the one that matters here and is the same in both: the verdict
// this map carries was not rendered over the tree leaving the cycle, so the tip
// the record cites is not the tree the reviewer judged. Telling them apart would
// buy a third rendering to say what one honest sentence already says.
// It also carries the TIP that map was judged on, because the record's `final
// HEAD` is not provenance alone: a replay probes it (`priorRecordSection` step
// 1 makes it the `F` of `git rev-list --right-only --cherry-pick B...F`), so
// citing the tip standing in the working location for a map judged on an
// earlier one hands that probe a tree no reviewer ever passed — and since the
// later pass committed OVER the judged tip, the probe prints nothing and the
// record reads as replaying "as written". BOTH cases need it, from the same
// mechanism read in two places: the cycle's `finalSha` moves only when a pass
// packet is ADOPTED, while the working location's HEAD moves the moment that
// pass commits. A pass that commits and is then rejected before adoption —
// returning nothing, blocking, coming back unclean — leaves `carried` true over
// a tip the working location has already advanced past. So each case cites the
// tip the cycle reported for the round that judged it: `finalSha` for `carried`
// (which `workReportReviewed` makes exactly that round's tip) and
// `reviewedFinalSha` for `replaced`. A cycle that reported neither yields an
// empty one and the record falls back to reading the tip rather than inventing
// one.
function reviewedMapOf(cycle) {
  const carried = Array.isArray(cycle.workReport) ? cycle.workReport : [];
  if (cycle.workReportReviewed && carried.length) return { which: "carried", map: carried, sha: typeof cycle.finalSha === "string" ? cycle.finalSha.trim() : "" };
  const judged = Array.isArray(cycle.reviewedWorkReport) ? cycle.reviewedWorkReport : [];
  if (judged.length) return { which: "replaced", map: judged, sha: typeof cycle.reviewedFinalSha === "string" ? cycle.reviewedFinalSha.trim() : "" };
  return { which: "none", map: [], sha: "" };
}
// The one sentence a JUDGED map's reason owes about its tip, in one place
// because four cycle-error exits state it and they must not drift. "May have
// moved past" rather than "has": the tip is cited because the working location's
// HEAD is not KNOWN to be the judged one, and both cases reach here with it
// unmoved just as ordinarily as with it moved — a `replaced` pass that returned
// different entries without committing, and a `carried` pass that was rejected
// having committed nothing.
const judgedTipClause = (judged) =>
  judged.sha
    ? ` The \`final HEAD\` below is \`${judged.sha}\` — the tip that verdict WAS rendered over — rather than the tip standing in the working location, which a later pass may have moved past.`
    : " The `final HEAD` below is the tip standing in the working location, which is therefore NOT necessarily the tree that verdict was rendered over: the cycle reported no tip for the round that judged this map.";
// The same fact in the one line a maintainer reads first. A record that failed
// to post is the more important half: it means the map is in this result and
// nowhere else, which is exactly the loss the record exists to prevent.
function recordNoteText() {
  if (!dispositionRecord) return "";
  return dispositionRecord.posted
    ? `This run's disposition map is on the PR as its disposition record${dispositionRecord.url ? ` (${dispositionRecord.url})` : ""} — the one PR write a run that does not publish in full makes.`
    : `This run's disposition map could NOT be recorded on the PR (${dispositionRecord.detail}), so it survives only in this result.`;
}
// For the exits whose `note` is composed elsewhere (a rebase stop's is built by
// `rebasePoint`, the published exit's by the ping accounting), so the record
// still reaches the line a maintainer reads first.
const withRecordNote = (note) => `${note || ""}${recordNoteText() ? ` ${recordNoteText()}` : ""}`.trim();

// The FIRST cycle-error exit, and the first one to read the reviewed fact rather
// than the verdict. It sits below the helper only because it calls it (the
// helper's `dispositionRecord` is a `let` in this scope, so calling it from
// above would hit the temporal dead zone); nothing between them has an effect.
if (cycle.verdict === "error") {
  const judged = reviewedMapOf(cycle);
  const record = await leaveDispositionRecord(
    judged.which === "carried"
      ? `the review cycle errored AFTER a reviewer round had passed over the dispositions below — its final confirmation pass stopped the cycle — so publication was refused: ${cycle.detail || "no detail reported"}${judgedTipClause(judged)}`
      : judged.which === "replaced"
        ? `the review cycle errored after a later pass had SUPERSEDED the map a reviewer round passed over — replacing its entries, or committing a new tip under the same ones — so publication was refused: ${cycle.detail || "no detail reported"} The dispositions below are that judged map — the most recent one a reviewer actually passed over; the unjudged map the cycle carried out is in this run's result under \`dispositions\` and is deliberately not recorded, since a record is replayed rather than re-triaged.${judgedTipClause(judged)}`
        : "",
    judged.map,
    judged.which === "carried"
      ? { rounds: cycle.rounds, reviewerStatus: "passed a round, after which the cycle errored", deviations: cycle.deviations, judgedTip: judged.sha }
      : { rounds: cycle.rounds, reviewerStatus: "passed a round, after which a later pass superseded the map it judged and the cycle errored", deviations: cycle.deviations, judgedTip: judged.sha },
  );
  return {
    error: `Review cycle failed: ${cycle.detail}`,
    ...record,
    pr: packet.pr,
    rebase: rebaseRecord,
    rounds: cycle.rounds,
    dispositions: cycle.workReport,
    openQuestions: cycle.openQuestions,
    deviations: cycle.deviations,
    peerRounds: cycle.peerRounds,
    artifactDir: cycle.artifactDir,
    ...carriedOf(cycle),
    ...(recordNoteText() ? { note: recordNoteText() } : {}),
  };
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
    // A stop here is the first exit that HOLDS a triaged, reviewed map: the
    // cycle passed, and the rebase aborted cleanly onto the tree that verdict
    // describes. So it records like every other exit that publishes nothing,
    // and the reason names the stop rather than a flag.
    const record = await leaveDispositionRecord(
      `the pre-push rebase stopped the run (${second.stop.status}), so publication was refused: ${second.stop.detail || "no detail reported"} The dispositions below passed review on the base the branch sat on before that point.`,
      cycle.workReport,
      { rounds: cycle.rounds, reviewerPassed: cycle.verdict === "pass", deviations: cycle.deviations },
    );
    return {
      ...second.stop,
      ...record,
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
      note: withRecordNote(second.stop.note),
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
      // The map here passed review too, on the base before the replay, and this
      // exit is the one place a maintainer could otherwise lose it: the run
      // spent its whole round budget and stops, so nothing downstream will ever
      // post its drafted replies. The reason says the verdict is the pre-rebase
      // tree's, which is the fact the record must not overstate.
      const record = await leaveDispositionRecord(
        `the pre-push rebase replayed commits and the run had no reviewer rounds left to re-verify the rebased tree, so publication was refused. The dispositions below passed review on the base the branch sat on before that replay.`,
        preRebaseCycle.workReport,
        { rounds: preRebaseCycle.rounds, reviewerPassed: preRebaseCycle.verdict === "pass", deviations: preRebaseCycle.deviations },
      );
      return {
        status: "reverify-budget-exhausted",
        ...record,
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
        note: withRecordNote(`Nothing was pushed. The branch is on the rebased base, and its pre-rebase tip is saved at \`${second.rebase.recoveryRef}\`. Re-run to review the rebased tree with a fresh round budget.`),
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
      // `cycle` is still `preRebaseCycle` here — the reassignment is below — so
      // this exit holds exactly the map the exhausted-budget exit above holds:
      // one that PASSED review on the base the branch sat on before the replay.
      // The cycle-error exits' exemption does not reach it, and nothing
      // downstream will ever post its drafted replies, so it records for the
      // same reason, with the same care not to claim the verdict describes the
      // rebased tree.
      const record = await leaveDispositionRecord(
        `the pre-push rebase replayed commits and the re-verification cycle returned nothing, so no verdict describes the rebased tree and publication was refused. The dispositions below passed review on the base the branch sat on before that replay.`,
        cycle.workReport,
        { rounds: cycle.rounds, reviewerPassed: cycle.verdict === "pass", deviations: cycle.deviations },
      );
      return {
        error: "The post-rebase re-verification cycle returned nothing, so no verdict describes the rebased tree; nothing was pushed.",
        ...record,
        pr: packet.pr,
        rebase: rebaseRecord,
        rounds: cycle.rounds,
        dispositions: cycle.workReport,
        openQuestions: cycle.openQuestions,
        deviations: cycle.deviations,
        peerRounds: cycle.peerRounds,
        artifactDir: cycle.artifactDir,
        ...carriedOf(cycle),
        note: withRecordNote(`Nothing was pushed. The branch is on the rebased base, and its pre-rebase tip is saved at \`${second.rebase.recoveryRef}\`.`),
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
      // TWO maps stand here, and this exit used to record neither. The merged
      // one is the failed re-verification's own (`mergedCycle` spreads `after`),
      // and it may still have been judged — a confirmation pass that stopped
      // that cycle leaves an error verdict over a map a round passed — while
      // `preRebaseCycle`'s PASSED review on the base before the replay
      // regardless, and used to be dropped on the floor here: recorded nowhere
      // and carried under no result key, which is precisely the loss this record
      // exists against. So both ride out, and the one RECORDED is the most
      // recent JUDGED map that has entries — `reviewedMapOf`, whose two halves
      // are why this is not simply `cycle.workReportReviewed`: a
      // passed-but-EMPTY re-verification map suppressed the record and took this
      // pre-rebase map with it, and a judged map a later pass REPLACED was lost
      // to the pre-rebase one standing in for it.
      const judged = reviewedMapOf(cycle);
      const record = await leaveDispositionRecord(
        judged.which === "carried"
          ? `the post-rebase re-verification errored AFTER a reviewer round had passed over the dispositions below, so publication was refused: ${cycle.detail || "no detail reported"} They are the re-verification's own map, judged over the rebased tree.${judgedTipClause(judged)}`
          : judged.which === "replaced"
            ? `the post-rebase re-verification errored after a later pass had SUPERSEDED the map its reviewer round passed over — replacing its entries, or committing a new tip under the same ones — so publication was refused: ${cycle.detail || "no detail reported"} The dispositions below are that judged map, rendered over the rebased tree; the unjudged map the cycle carried out is in this run's result under \`dispositions\` and is deliberately not recorded, since a record is replayed rather than re-triaged.${judgedTipClause(judged)}`
            : `the post-rebase re-verification errored with no judged map of its own to record — no reviewer round passed over a map with entries over the rebased tree — so publication was refused: ${cycle.detail || "no detail reported"} The dispositions below are the ones that PASSED review on the base the branch sat on before that replay; the re-verification's own map is in this run's result under \`dispositions\` and is deliberately not recorded, since a record is replayed rather than re-triaged.`,
        judged.which === "none" ? preRebaseCycle.workReport : judged.map,
        judged.which === "carried"
          ? { rounds: cycle.rounds, reviewerStatus: "passed a round over the rebased tree, after which the cycle errored", deviations: cycle.deviations, judgedTip: judged.sha }
          : judged.which === "replaced"
            ? { rounds: cycle.rounds, reviewerStatus: "passed a round over the rebased tree, after which a later pass superseded the map it judged and the cycle errored", deviations: cycle.deviations, judgedTip: judged.sha }
            : { rounds: preRebaseCycle.rounds, reviewerStatus: "Pass, on the base the branch sat on before the replay", deviations: preRebaseCycle.deviations },
      );
      return {
        error: `Post-rebase re-verification cycle failed: ${cycle.detail}`,
        ...record,
        pr: packet.pr,
        rebase: rebaseRecord,
        rounds: cycle.rounds,
        dispositions: cycle.workReport,
        // The map that passed on the pre-replay base, under its own key on every
        // one of these exits — including the one that recorded it, so a
        // maintainer reading the result never has to work out which of the two
        // the record holds.
        preRebaseDispositions: preRebaseCycle.workReport || [],
        openQuestions: cycle.openQuestions,
        deviations: cycle.deviations,
        peerRounds: cycle.peerRounds,
        artifactDir: cycle.artifactDir,
        ...carriedOf(cycle),
        note: withRecordNote(`Nothing was pushed. The branch is on the rebased base, and its pre-rebase tip is saved at \`${second.rebase.recoveryRef}\`.`),
      };
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

// THE DISPOSITION RECORD for the exits BETWEEN here and publication. Which
// exits those are is not a list to maintain: the reason below is computed from
// the very conditions they branch on, in their order, so it is non-empty exactly
// when one of them is about to be taken. The exits AHEAD of this line (the
// pre-push rebase's stops, and a replay with no re-verification budget left) and
// the one PAST it (a publication that did not complete) each state their own
// reason where they are taken, and all of them finalize through
// `leaveDispositionRecord`, so an exit added anywhere has exactly one thing to
// decide: whether it records.
// The zero-item exits upstream never reach here, so the empty-map case this
// covers is a cycle that returned an empty report.
const noPublishReason = !flags.push
  ? passed
    ? "`no-push` was given, so this was a local-only run: nothing was pushed and no thread was touched."
    : "`no-push` was given AND the review cycle stopped at its round cap, so nothing was pushed."
  : !passed
    ? "the review cycle stopped at its round cap without a passing verdict, so publication was refused."
    : uncoveredItems.length
      ? `${uncoveredItems.length} gathered item(s) carry no disposition, so publication was aborted before any push.`
      : duplicatedItems.length
        ? `${duplicatedItems.length} gathered item(s) carry more than one disposition, so publication was aborted before any push.`
        : badDispDefect
          ? `a disposition is not publishable (${badDispRef}: ${badDispDefect}), so publication was aborted before any push.`
          : "";
// Whether THIS run's map is known not to account for the gathered items
// one-for-one — the same three guards, read for a different question. It is
// computed off the guards rather than off `noPublishReason`, which does not name
// them on the `no-push` path, where the map is just as defective and the record
// is written just the same.
// What it decides is whether the record may SUPERSEDE an earlier one. Superseding
// is a `PATCH` in place, so an entry a prior record holds for an item this map
// omits, doubles, or cannot publish is destroyed by it, and the next run inherits
// only the unusable replacement — the exact loss this whole mechanism exists
// against, arriving through the mechanism itself. The replacement is still
// written: its entries are a real triage of the items they do cover, and letting
// them die with the session to protect the older record would trade one loss for
// the other. So both survive — this one as a new comment, the earlier one
// standing where it is. Standing is not preservation on its own, though: the
// gather replays only the MOST RECENT record, so the record brief has the new
// comment CARRY the displaced record's orphaned entries forward — an entry
// living only in the older comment would otherwise never be replayed again,
// and a standalone item only it names never even re-gathered.
const mapIncomplete = uncoveredItems.length
  ? `${uncoveredItems.length} gathered item(s) carry no disposition`
  : duplicatedItems.length
    ? `${duplicatedItems.length} gathered item(s) carry more than one disposition`
    : badDispDefect
      ? `a disposition is not publishable (${badDispRef}: ${badDispDefect})`
      : "";
// The identities those same guards found COMPROMISED — each carried by a
// disposition that is itself part of the incompleteness: one of several
// naming the same gathered item, or one publication rejected as
// unpublishable. The record brief's carry step needs them by name, because
// its predicate skips a prior-record entry whose identity a disposition of
// this map carries — and for these identities the disposition carrying them
// is exactly what this map cannot publish, so treating it as coverage would
// strand the displaced record's entry for the item — the durable copy of a
// judged reply the no-supersede rule above exists to keep, for the doubled
// and unpublishable shapes as much as the omitted one — off the replay
// surface the newest record becomes. An uncovered item needs no entry here:
// no disposition carries its identity, so the base predicate already carries
// its prior entry.
const compromisedIdentities = [...new Set([
  ...duplicatedItems.map((it) => (it.type === "review-thread" ? it.threadId : it.url)),
  ...workReport.filter((d) => d && dispositionDefect(d)).flatMap((d) => [d.threadId, d.url]),
].filter((v) => typeof v === "string" && v))];
// Spread into every exit below that publishes nothing, so the result says where
// the map went — or that it went nowhere.
const recordResult = await leaveDispositionRecord(noPublishReason, workReport, {
  rounds,
  reviewerPassed: !!passed,
  deviations: cycle.deviations,
  mapIncomplete,
  compromisedIdentities,
});
const recordNote = recordNoteText();

if (!flags.push) {
  // Local-only run: no push, no reply, no resolve, no Summary comment, no ping —
  // the record above is the one documented PR write. The disposition map is the deliverable
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
    ...recordResult,
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
    note: `Local-only run: no push, no replies/resolves, no Summary comment, no ping.${recordNote ? ` ${recordNote}` : ""} Re-run without \`no-push\` to publish with the default contributing-bot pings, or with \`push\` to publish quietly.${survivingWorktreeNote(reclaimed)}`,
  };
}

if (!passed) {
  // push requested but the verify loop hit its cap — do NOT publish unverified work.
  phase("Report (cap hit, not published)");
  return {
    status: "review-cap-not-published",
    ...recordResult,
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
    note: `Hit the review cycle's round cap without a passing review; nothing was pushed.${recordNote ? ` ${recordNote}` : ""}`,
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
    ...recordResult,
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
    ...recordResult,
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
    ...recordResult,
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

// What the publisher CLAIMED, which is not yet what this run reports: a
// `published: true` claim is a claim about the whole of step 7 — every reply
// posted, every resolve done, the Summary comment on the PR — and it is accepted
// only over an account that can carry it (`published` below). Read as the answer
// on its own, a report claiming completion while accounting for nothing exited
// `fixed-published`, gave the worktree back, and wrote NO record — the same
// silence four rounds hardened the not-published path against, waved through on
// the path that reclaims the tree.
const publishClaimed = !!(publishReport && publishReport.published);
// A publication that did NOT complete still holds this run's map with replies
// left to replay, so it records through the same helper as every exit above —
// the last of the exits that publish nothing in full, and the one the computed
// reason above cannot reach because the publisher had not run yet.
// What it records differs in two lines, and what selects them is what of this
// map the PR ALREADY CARRIES when the publisher stopped — end state, never a
// diary of this run's own writes, so a reply a PRIOR run posted counts and a
// replay whose push moved nothing over it still reads as "published in part".
// `pushed` is not that selector either: it says a push command succeeded, which
// an `Everything up-to-date` no-op also does, so `pushedNewCommits` — the flag
// that says the remote MOVED — is the push half a record may name. What must
// not read as "published in part" is the run NO part of whose map is on the PR:
// a reader who believes it goes looking for replies and a Summary comment that
// were never posted. Only three things can be on the PR, and the publisher
// reports each one: a push that ADVANCED the remote, replies/resolves its
// account confirms (a reply skipped as a duplicate of one already there
// included), and a posted Summary.
// And what the publisher's account cannot say, this run must not say either.
// Absence of a report is not evidence of absence of mutations: the publisher
// pushes at step 2 and replies at step 4, so "died after something landed" is the
// ORDINARY shape of a part-way stop, and a report that names no outcome is a
// report about a state this run has no information about. So every claim below is
// derived from an account that KEYS ONE ENTRY PER DISPOSITION, and where the
// account cannot carry that weight the record says the outcome is unknown.
const outcomes = Array.isArray(publishReport && publishReport.threadOutcomes) ? publishReport.threadOutcomes : [];
// The identity publication itself routes on, and the only thing that can key this
// account: a `review-thread` by its `threadId`, a `standalone` by its `url`.
// `ref` is file:line + author, which two threads a re-review left on one line
// SHARE — keyed on it, one thread's landed reply and another's owed one are the
// same entry. Every disposition reaching publication has one: `dispositionDefect`
// above rejects a review-thread entry with no `threadId` and a standalone with no
// `url` before any push.
const dispKeyOf = (d) => String((d && (d.type === "review-thread" ? d.threadId : d.url)) || "").trim();
const outcomeKeyOf = (o) => String((o && (o.threadId || o.url)) || "").trim();
const dispKeys = workReport.map(dispKeyOf);
const dispKeySet = new Set(dispKeys);
const accountByKey = new Map();
const duplicateKeys = [];
const strayKeys = [];
for (const o of outcomes) {
  const k = outcomeKeyOf(o);
  if (!k || !dispKeySet.has(k)) {
    strayKeys.push(k || "(an entry carrying neither a threadId nor a url)");
    continue;
  }
  if (accountByKey.has(k)) {
    duplicateKeys.push(k);
    continue;
  }
  accountByKey.set(k, o);
}
const unaccountedKeys = dispKeys.filter((k) => !accountByKey.has(k));
const summaryReported = !!publishReport && typeof publishReport.summaryCommentUrl === "string";
const summaryUrl = summaryReported ? publishReport.summaryCommentUrl.trim() : "";
// Nothing the publisher reported puts any part of this map on the PR: no push,
// no Summary, and no entry reporting a reply or a resolve there. Then an account
// short of an entry per item is COMPLETE rather than missing — the push is step 2
// and the replies and Summary are steps 4 and 5, so there is nothing an unnamed
// item's entry could say — and this is the one shape in which `[]` is the whole
// truth.
// It is NOT "did this run mutate the PR". `replied`/`resolved` are END STATE, so
// an entry reporting a reply a PRIOR run posted puts this shape out of reach too
// — which is the right direction: the PR is then carrying part of this map, and
// an item the account leaves unnamed beside it really is unstated.
const claimsPRState =
  !!(publishReport && (publishReport.pushed || publishReport.pushedNewCommits)) ||
  !!summaryUrl ||
  outcomes.some((o) => o && (o.replied || o.resolved));
// Why the account cannot be used, in the words the record prints. EMPTY means it
// keys one entry per disposition, so `landed` and `outstanding` below are two
// halves of one keyed set rather than two lists built independently.
// A report that broke its own REQUIRED-FIELD contract is distrusted WHOLE rather
// than field by field, and the record says so: where only `summaryCommentUrl` is
// missing, the per-thread account can be present, keyed and complete, and every
// entry still carries the reservation. That is deliberate. The reservation does
// not say "this entry is unaccounted for" — it says the outcome is UNKNOWN, which
// is what an entry from a report this run cannot read as a whole is worth.
// Scoping the reservation to the missing field would mean trusting the
// per-thread half of a report whose author demonstrably did not follow the
// contract that half is written under, and buying a second axis of record state
// for a case an ordinary run reaches only once schema enforcement has failed.
const accountDefect = !publishReport
  ? "the publisher returned nothing at all, so no field of its report exists — neither the push flags, nor its per-thread account, nor whether a Summary comment was posted"
  : !Array.isArray(publishReport.threadOutcomes)
    ? "its report carries no `threadOutcomes` array, so it accounts for nothing it did to any thread"
    : !summaryReported
      ? "its report omits the REQUIRED `summaryCommentUrl`, so whether a Summary comment reached the PR is unstated — and a report that broke its own field contract is not read field by field, its per-thread half included"
      : duplicateKeys.length
        ? `its account names ${duplicateKeys.length === 1 ? "an item" : `${duplicateKeys.length} items`} more than once (${duplicateKeys.join(", ")}), so which entry is that item's outcome is undecidable`
        : strayKeys.length
          ? `its account names ${strayKeys.join(", ")}, which is no disposition this run holds, so it is an account of some other work`
          : unaccountedKeys.length && claimsPRState
            ? `its account leaves ${unaccountedKeys.length} of ${workReport.length} item(s) unnamed (${unaccountedKeys.join(", ")}) while reporting that the PR already carries part of this map, so whether those replies are on it is unstated`
            : "";
// WHAT PUBLICATION OWES each disposition, read off two fields of the disposition
// itself (`type`/`kind` and `authorIsBot`) rather than out of a copy of the
// publish brief's per-kind table. TWO consumers read it and must not drift
// apart: the completion gate just below, which asks whether a report claiming
// the publication complete AGREES with its own account, and the record's debt
// count further down, which asks what is left to replay.
// Two kinds publication never owes a REPLY, and counting them tells the
// maintainer and the replay turn that a forbidden action is outstanding: step 4
// of the publish brief posts no reply to a `standalone` item (it is addressed in
// the Summary comment alone and is never resolved as a thread) and none to an
// `ambiguous-skipped` thread (it is deliberately left without one and left
// open), so both carry `replied: false` on a genuinely COMPLETE publication.
const isReviewThreadOwed = (d) => !!d && d.type === "review-thread" && d.kind !== "ambiguous-skipped";
// The RESOLVE is owed over a narrower set again, and for the same reason: step 4
// resolves a `push-back` only when the thread's author is a bot and leaves a
// human one open unless the maintainer explicitly authorized otherwise, and it
// resolves a `deferred-to-task` on the same condition. So a human push-back or
// deferral is unresolved BY POLICY on a complete publication. That authorization
// is a fact no field here records — it rides in the disposition's `detail` prose,
// which is where the fix step is told to say whether a deferral was
// maintainer-directed — so this set is what publication is KNOWN to owe, and
// under-counting is what each consumer can defend separately. The record's
// per-entry standing tells the next turn the resolve turns on that authorization
// rather than asking it for the one action step 4 forbids. The gate refuses a
// completion claim only over a resolve publication is CERTAINLY owed, which
// leaves one case to the publisher's own contract rather than to a standing line
// — no record is written on the path that would carry one — and the gate below
// names that residual where it names the other thing it cannot see.
const isResolveOwed = (d) => isReviewThreadOwed(d) && !((d.kind === "push-back" || d.kind === "deferred-to-task") && d.authorIsBot === false);
const owedKeys = workReport.filter(isReviewThreadOwed).map(dispKeyOf);
const resolveKeys = workReport.filter(isResolveOwed).map(dispKeyOf);
const owedReplies = owedKeys.filter((k) => !(accountByKey.get(k) || {}).replied).length;
const owedResolves = resolveKeys.filter((k) => !(accountByKey.get(k) || {}).resolved).length;
// And what a claim of COMPLETION additionally requires, which is more than an
// account this run can read: the Summary comment is step 7's last write, so a
// report claiming the publication complete while naming no `summaryCommentUrl`
// is not "unstated" — it is a publication missing its final step, reported as
// finished. Any defect below makes this run NOT published: the record is written
// and the worktree kept, exactly as an aborted publication's, rather than the one
// exit that reclaims the tree taking a detected silence for a finish.
// `accountDefect` is reused rather than re-derived because it is the same
// question — can this report's account be read at all — and a second copy of
// that test would be unobservable while it agreed and silent when it stopped.
// And the last thing a completion claim must survive: its own account AGREEING
// with it. The two tests above ask whether that account can be READ; this one
// asks what it SAYS. A report claiming the publication complete while its own
// entries report no reply on a thread publication owes one is not a silence, it
// is a contradiction — and the exit it would otherwise take is the ONE that
// reclaims the worktree, writes no record, and SPENDS the prior record still
// holding this map, so a contradiction waved through there destroys the durable
// copy of work the report itself says never reached the PR. It gets the same
// treatment as every silence above: not published, worktree kept, record written.
// The PUSH is the first half of that agreement, before either per-thread half:
// step 2's push is what every complete publication starts with, and `pushed`
// reports whether a push command SUCCEEDED — an `Everything up-to-date` no-op
// reports true, so no complete publication reports false there. A report
// claiming completion over `pushed: false` therefore says the opposite of its
// claim in one required field — its account can be keyed, complete, and carry a
// Summary URL while the fixes it replied about never left the local branch, so
// without this half the gate accepts exactly that report, spends the prior
// record, and reclaims the tree with feedback marked addressed on origin's
// behalf by a run that never reached origin.
// It is not a second copy of the publish brief's per-kind table. It reads the
// very predicates the record's debt count reads, defined once above, so the gate
// and the count cannot disagree about what step 4 owes — and both carve out
// exactly the kinds step 4 acts on conditionally or not at all, so a genuinely
// COMPLETE publication passes it with nothing to spare.
// What it still does not test is what nothing here can, and there are two such
// shapes. An entry claiming `replied: true` that is not true on the PR: a report
// LYING rather than contradicting itself, which no reading of the report catches.
// And the resolve `isResolveOwed` carves out — the maintainer having authorized
// resolving a human push-back, or directed a human deferral, and the resolve then
// FAILING. Step 4 owes that resolve, and the publisher's own contract answers for
// it (`published: true` only where every required resolve succeeded); what the
// carve-out costs is the caller's ability to CHECK that answer, the authorization
// living in `detail` prose rather than in a field. Buying that field was weighed
// against what it would buy, and what it would buy is bounded: the thread is left
// UNRESOLVED on the PR, so the next run's gather takes it as an item under its
// unresolved-only rule, and the reply — the half whose drafted body lives only in
// the record, and so the half a spend destroys — is already on the PR. That
// asymmetry is the whole reason the reply half cannot afford an under-count here
// and the resolve half can: a missed resolve degrades to the state policy
// produces for a human thread anyway, which is the maintainer's to close.
const unpushedClaim = !!publishReport && publishReport.pushed !== true;
const contradictedByAccount = unpushedClaim || owedReplies || owedResolves
  ? `its own account contradicts that claim — ${[
      unpushedClaim ? "it reports that no push command succeeded (`pushed: false`), which no complete publication reports: step 2's push is where publication starts, and an `Everything up-to-date` no-op already reports true" : "",
      owedReplies ? `${owedReplies} of ${owedKeys.length} thread(s) publication owes a reply report that none reached the PR` : "",
      owedResolves ? `${owedResolves} of ${resolveKeys.length} it owes a resolve report the thread still unresolved` : "",
    ].filter(Boolean).join(", and ")}`
  : "";
const publicationDefect = !publishClaimed
  ? ""
  : accountDefect ||
    (summaryUrl
      ? ""
      : "it names no `summaryCommentUrl`, so the Summary comment step 7 ends with is not on the PR — or was not reported, which this run cannot tell from the other") ||
    contradictedByAccount;
const published = publishClaimed && !publicationDefect;
// Why this run stopped short of a complete publication, in the words the record
// prints. A report claiming completion has no `aborted` to quote — that field is
// empty when published — so the claim it could not support is the reason.
// The two ways it fails are not one, and the tests above already draw the line:
// they ask whether the account can be READ, this one asks what it SAYS. A report
// that cannot say the publication completed is SILENT about it; one whose own
// entries report no reply on a thread publication owes one says the OPPOSITE.
// Told "a report that cannot say so" over the second, the maintainer is told the
// report was silent where it in fact contradicted the claim — so the one phrase
// is picked here, once, and both readers of it (the record's `status:` line and
// the run's `note`) take it from here rather than restating it.
const claimRefusal = contradictedByAccount && publicationDefect === contradictedByAccount
  ? "a report that says the OPPOSITE"
  : "a report that cannot say so";
const stopReason = publishClaimed
  ? `the publisher reported the publication COMPLETE over ${claimRefusal} — ${publicationDefect}`
  : (publishReport && publishReport.aborted) || "the publisher returned nothing";
// What of this map the PR ALREADY CARRIES — which is what the next turn must not
// do again — and NOT a diary of this run's own writes. `replied` and `resolved`
// report each thread's state when the publisher's turn ended, a reply it skipped
// under step 4's duplicate rule (an equivalent one of its own already being
// there) included, so these counts take in a reply a PRIOR run posted and a
// resolve that was already done. That reading is the one the record was
// redefined for: a turn told a reply that is on the PR is still owed posts it
// twice. So "reached origin" here means "is on origin", never "this run put it
// there" — and a replay whose push moved nothing over replies already on the PR
// renders as a publication published IN PART, which is exactly what it is: the
// map is on the PR, whichever run posted it, and only the rest is left to replay.
// The push is the one ACT in the list, and `pushed` is still not it: it says a
// push command succeeded, which an `Everything up-to-date` no-op also does, so
// `pushedNewCommits` — the flag that says the remote MOVED — is the push half a
// record may name here. Nothing about the no-op is lost by that: `pushNoop` below
// is what says it, over the runs where no part of the map is on the PR at all.
const repliedKeys = dispKeys.filter((k) => (accountByKey.get(k) || {}).replied);
const resolvedKeys = dispKeys.filter((k) => (accountByKey.get(k) || {}).resolved);
const repliedCount = repliedKeys.length;
const resolvedCount = resolvedKeys.length;
// One place decides what an unusable account supersedes, and it is not here:
// every consumer below reads `accountDefect` FIRST — the record's rendering, its
// reason, the per-entry standing, and the result's note — so guarding these two
// as well would be a second copy of that precedence, unobservable while it
// agreed and silent when it stopped agreeing.
// The push's FOURTH standing, and the one the three states below cannot hold:
// `git push` returned and the read-back at the ref did not establish that the ref
// moved, so the tips MAY be on origin. Every claim this run would otherwise make
// asserts more than that — "advanced" and "noop" both put the tips there, and
// "pushed nothing" puts them nowhere — so this fact SUPERSEDES all three rather
// than being carried as a fourth value of any of them, whatever the publisher's
// own push flags say: it is exactly those flags the stop declares unestablished.
// Read as a case-folded substring rather than an equality, because failing to
// recognize the stop is the only direction that reads as a claim: an abort that
// appends which URL disagreed still withdraws it, and some other abort quoting
// the phrase only ever claims less.
const pushUnconfirmed =
  !published &&
  !!publishReport &&
  typeof publishReport.aborted === "string" &&
  publishReport.aborted.toLowerCase().includes(PUSH_UNCONFIRMED_ABORT);
const landed = published
  ? ""
  : [
      publishReport && publishReport.pushedNewCommits && !pushUnconfirmed ? "the push, which advanced the remote branch" : "",
      repliedCount ? `${repliedCount} thread ${repliedCount === 1 ? "reply" : "replies"}` : "",
      resolvedCount ? `${resolvedCount} thread resolve${resolvedCount === 1 ? "" : "s"}` : "",
      summaryUrl ? `the Summary comment at ${summaryUrl}` : "",
    ].filter(Boolean).join(", ");
// A push that ran and moved nothing is neither case: the tips ARE on origin
// (the remote already pointed at them), so the local-only line is false too.
// One fact, one extra line in the record, rather than a rendering of its own. It
// keys on `!landed`, which under the end-state reading above is the stronger
// statement it needs — the PR carries no reply, resolve or Summary of this map at
// all, so this run certainly posted none of them. The line it renders says no
// reply, resolve or Summary reached the PR, which is a claim an
// unusable account cannot support — and that is settled in the ONE place named
// just above rather than a second time here: every consumer reads `accountDefect`
// FIRST, so this flag is only ever read where there is none. Guarding it here as
// well would be the second copy of that precedence this file has already refused
// twice — unobservable while it agreed, silent when it stopped agreeing.
const pushNoop = !published && !landed && !pushUnconfirmed && !!(publishReport && publishReport.pushed);
// What is left, as the COMPLEMENT of what landed over the same keyed set rather
// than a second count of its own: every disposition is named exactly once in the
// account, so an item is owed its reply precisely when the account does not
// report one — over the items publication OWES one at all, which is the set
// `isReviewThreadOwed`/`isResolveOwed` above define, once, for this count and
// the completion gate both.
const outstanding = published
  ? ""
  : [
      owedReplies ? `${owedReplies} of ${owedKeys.length} thread(s) still owed their reply` : "",
      owedResolves ? `${owedResolves} of ${resolveKeys.length} not resolved` : "",
      summaryUrl ? "" : "the Summary comment",
    ].filter(Boolean).join(", ") || "no reply, resolve or Summary comment — publication stopped past all of them, so its reason above is what is left to act on";
// Where each entry stands, one line per disposition, matched to it by key. The
// caller derives this rather than handing the record's author the raw account and
// the rule: joining the two is exactly where a shared `ref` would put one
// thread's landed reply on another thread's entry. Emitted on the two paths where
// an entry's standing is not simply "owed" — a part-way publication, and an
// unusable account, where every entry's standing is unknown.
const standingLine = (d) => {
  const key = dispKeyOf(d);
  const label = `thread=${key || "(no threadId or url)"}  ${String((d && d.ref) || "").trim() || "(no ref)"}`;
  if (accountDefect) return `${label} — UNKNOWN whether its reply is posted or its thread resolved: check it on the PR before replying, and before resolving.`;
  const o = accountByKey.get(key);
  // The same two kinds the debt counts above exclude, said per entry: a
  // standing of "still owed" on one of them would have the replay turn post
  // what the publish brief forbids — a thread reply an item has no thread for,
  // or a reply on a thread the run deliberately left silent and open.
  if (!isReviewThreadOwed(d)) {
    const why = d && d.type === "standalone"
      ? "a standalone item is addressed in the Summary comment alone, never by a thread reply, and is never resolved as a thread"
      : "an ambiguous-skipped thread is deliberately left without a reply and left open";
    return `${label} — NOTHING is owed on it: ${why}.${o && (o.replied || o.resolved) ? " Its account nevertheless reports one, so check the thread on the PR before acting." : ""}`;
  }
  // The reply is owed on every entry that reaches here; the RESOLVE is the half
  // that turns on the thread rather than the kind, so an unresolved human
  // push-back or deferral is told it is policy — the same fact the count above
  // reads — rather than told a resolve is still owed, which is the line the next
  // turn acts on entry by entry and the one thing step 4 forbids it to do.
  const resolveStanding = o && o.resolved
    ? "thread ALREADY RESOLVED — do not resolve it again"
    : isResolveOwed(d)
      ? "resolve still owed"
      : "resolve NOT owed — a human push-back or deferral is left open unless the maintainer explicitly authorized resolving it; do not resolve it on this record's word";
  return `${label} — ${o && o.replied ? "reply ALREADY POSTED — do not post it again" : "no reply reached the PR — the reply below is still owed"}; ${resolveStanding}.`;
};
const perThread = published || !(landed || accountDefect) ? [] : workReport.map(standingLine);
const publishRecord = published
  ? await spendPriorRecord(summaryUrl)
  : await leaveDispositionRecord(
      `publication did not complete: ${stopReason}${accountDefect
        ? ` — and WHAT REACHED ORIGIN IS UNKNOWN: ${accountDefect}. Treat nothing below as posted and nothing as unposted until the PR itself says which.`
        : landed
          ? ` — what reached origin: ${landed}; what is left to replay: ${outstanding}.`
          : pushUnconfirmed
            ? ", and whether its push reached origin is UNKNOWN: `git push` returned and the read-back at the ref did not confirm the ref moved, so read the ref itself before treating these tips as either published or local; its own account reports no reply, resolve or Summary comment after it."
            : pushNoop
              ? ", and nothing reached origin: its push was an `Everything up-to-date` no-op that moved nothing, and its own account reports no reply, resolve or Summary comment after it."
              : ", and nothing reached origin: its own account reports no push, no reply, no resolve and no Summary comment."}`,
      workReport,
      {
        rounds,
        reviewerPassed: true,
        deviations: cycle.deviations,
        landed,
        outstanding,
        pushNoop,
        pushUnconfirmed,
        outcomes,
        unknown: accountDefect,
        perThread,
        // The one half of "what reached origin" an unusable account does not put
        // in doubt: the push flags are reported positively, so a run whose push
        // ADVANCED the remote knows its tips are there even where it knows
        // nothing about its replies. Saying "whether anything reached origin is
        // unknown" over that would understate what the run does know — and the
        // run holds THREE push states, not two: a push that succeeded while
        // moving nothing also leaves the remote pointing at these tips, which is
        // what `PUBLISH_SCHEMA.pushed` says of itself and what the non-unknown
        // rendering says in the same breath, so reading it as "no push is known"
        // understates the same fact in the same direction.
        // What a push whose read-back did not CONFIRM the ref puts in doubt is
        // that same half, so it takes the state that claims the least rather
        // than a fourth of its own: "not even a push is known to have advanced
        // the remote branch" is exactly what that stop establishes, and the
        // reason printed beside it is still the account's.
        pushState: pushUnconfirmed
          ? "unknown"
          : publishReport && publishReport.pushedNewCommits
            ? "advanced"
            : publishReport && publishReport.pushed
              ? "noop"
              : "unknown",
      },
    );
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
  // Only ever present on the published path, and only where a prior record was
  // there to spend. A record left standing over a map that is now published is
  // replayed by the next run, so a failure to spend it is the maintainer's to
  // see rather than a silent one.
  publishRecord.spentRecord && !publishRecord.spentRecord.posted
    ? `The prior disposition record was not spent (${publishRecord.spentRecord.detail}); one left standing over a published map is replayed by the next run.`
    : null,
].filter(Boolean);
return {
  status: published ? "fixed-published" : "fixed-publish-failed",
  ...publishRecord,
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
  publishReport: publishReport || { published: false, aborted: "publisher returned nothing" },
  ...(reclaimed ? { worktreeReclaim: reclaimed } : {}),
  note: published
    ? (`${notes.join(" ")}${survivingWorktreeNote(reclaimed)}`.trim() || undefined)
    : withRecordNote(`Fixes passed review but publication did not fully complete — ${publishClaimed ? `the publisher reported it COMPLETE over ${claimRefusal}: ${publicationDefect}` : "see publishReport.aborted"}; ${accountDefect
        ? `what reached origin is UNKNOWN: ${accountDefect}`
        : landed
          ? `what reached origin: ${landed}; what is outstanding: ${outstanding}`
          : pushUnconfirmed
            ? "whether its push reached origin is UNKNOWN — the read-back at the ref did not confirm the ref moved"
            : pushNoop
              ? "nothing reached origin — its push was an `Everything up-to-date` no-op that moved nothing"
              : "nothing reached origin"}.`),
};
