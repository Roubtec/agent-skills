# The durable disposition record

This file is part of the `address-review` skill, and its step numbers and section names are that skill's `SKILL.md`, beside it.
It is read in full by a run that found a prior record, by one that will not publish its disposition map in full, and by one that published after replaying a record.

Step 8's report is chat output, and dies with the session.
So every run that ends **without publishing in full** leaves that mapping on the PR itself, as one top-level comment.

**When it is posted.**
Any run holding a triaged disposition map that did not publish it in full: a `no-push` run, and a run that intended to publish and could not — stopped at step 6's round cap, halted on a blocker, or waiting on a maintainer decision.
Hands-off runs included.
A publication that stopped part-way is the same case rather than an exception: it has replies left to replay, so it leaves the record too — in the `part` state below, since `not published` is false once part of the map is on origin, while what the record may say of the tips follows the push rather than the map: "local only" is false where a push advanced the remote or an `Everything up-to-date` no-op found the tips already there, still true where what landed rode the API with no successful push.
A run that published posts none — step 7's replies, resolves, and Summary comment are the durable record there — and "published" means a publication whose own report can show it: an account of every item, and the URL of the Summary comment step 7 ends with.
A run reporting itself complete over less has not published in this sense, and neither has one whose account **contradicts** the claim: a report calling the publication complete while its own entries say a thread it owed a reply never got one — or while reporting that no push command succeeded, which no complete publication reports, step 2's push being where publication starts and an `Everything up-to-date` no-op push already reporting its success — is refused exactly as one that accounts for nothing — over the same set of what step 7 owes each disposition that the outstanding count below is taken over, so the two cannot drift apart.
It leaves the record, keeps its worktree, and reports an incomplete publication.
A run with nothing triaged posts none either, whether step 3's terminal no-op or a stop before triage: there is no mapping to replay, so say so in the report rather than posting an empty record.
One last run posts none: one whose review stopped without any reviewer round ever having passed over the map it holds — a round that never finished, over a tree nobody read.
That map rides out in the run's report instead.
That exemption is about the MAP and never about how the review stopped: a final confirmation pass that stops the cycle leaves an error standing over the map a round has just passed, and that map is recorded like any other.

**One record per PR per run, written by `record.sh`.**
`record.sh` sits beside this file and is run by absolute path, like `pr-branch.sh`, answering the same way: `outcome=` first, exit 3 on a stop, exit 1 on a failure.
After an exit 1 from `post` or `spend`, run `find` before writing again, since the write may have landed.
It words the record's header and makes the one write.
A record is a comment whose first line is the marker `<!-- address-review:disposition-record -->`, byte for byte, so a later run finds it by that marker and never by matching prose: `record.sh find --repo <owner>/<repo> --pr <N>` prints the most recent record of the authenticated user (`id=`, `url=`, `spent=`) and an `other=<url> <login> <updated-at> spent=<yes|no>` line for every further one.
Another actor's record shows only as an `other=` line, under `outcome=none` where you have none of your own, and is still the record to replay where it is the most recent.
`record.sh post` writes over that most recent record of your own where there is one and posts a new comment where there is none, so this run writes exactly one record, the same idempotence step 7 requires of thread replies.
Report the `other=` records it lists: nothing here deletes, sweeps, or expires a record, and another actor's is never written to.
**One map may not supersede: a map this run already knows is incomplete** — an item gathered and left with no disposition, one carrying two, or an entry publication rejected as unpublishable.
Pass `--incomplete`, which posts it as a *new* comment, leaves every earlier record standing, and says in the status line that it is partial, naming the record of yours that still stands.
Step 3's gather replays only the **most recent** record, so the partial record **carries the displaced record's orphaned entries forward**: every `## Threads` entry of the record this run replayed whose identity (`thread=<threadId or url>`, the url carrying its finding ordinal for a misfired finding) none of its own dispositions carries — a disposition that is itself the incompleteness (one of several naming the same gathered item, or one publication rejected as unpublishable) carrying nothing for this test, since its account of the item is the very thing the map cannot publish while the displaced record's entry is the only durable copy of a judged reply for it — is copied in verbatim and whole, marked as carried unchanged from that record, so the newest record stays the one complete replay surface while the older one stands as provenance — the next run's replay re-judges every entry against the tree either way, a carried one included.
**A run that publishes in full SPENDS the record it replayed:** `record.sh spend --repo <owner>/<repo> --pr <N> --branch <branch> --id <that record's comment id> --summary-url <the Summary comment's url>` empties it in place — the marker, the header line, and a `SPENT` status, with no `## Threads` block and no `## Summary comment` block.
It spends only a record already there: where the PR carries none, there is nothing to spend and nothing is posted, since a published run has nothing to hand forward.
`--id` is **the record this run replayed**, never the "most recent record of my own" that `post` selects on — the two differ where the record replayed is another actor's, and where the incomplete-map carve-out left a second one of this account's standing beside an earlier one.
Where it answers `absent`, the PR no longer carries that exact record of your own: nothing was written, and the report says so.

**Content.**
The header is the script's, worded from the facts you pass; the body is yours, on stdin — the `## Threads` block and the `## Summary comment` block:

```sh
record.sh post --repo <owner>/<repo> --pr 141 --branch task/141-foo \
  --state not-published --reason '<why, one line>' \
  --starting 9f3a1c2 --final abc1234 --head-oid 9f3a1c2 --base 21af561 \
  --validation PASS --reviewer 'Pass (2 rounds)' --peer forfeited <<'RECORD'
## Threads
[fixed]     SKILL.md:265  codex  thread=PRRT_kwDO...vv
            url:   .../pull/141#discussion_r369...
            reply: "Fixed in <tip>: gate merged parents on ..."
[push-back] SKILL.md:148  codex  thread=PRRT_kwDO...v1
            url:   .../pull/141#discussion_r369...
            reply: "<full drafted rationale, verbatim>"
[task]      SKILL.md:302  codex  thread=PRRT_kwDO...v2
            url:   .../pull/141#discussion_r369...
            reply: "Follow-up task committed: tasks/0NNa-foo.md — queued for an upcoming batch"
            -> tasks/0NNa-foo.md (queued)

## Summary comment (verbatim, ready to post)
<full markdown body>
RECORD
```

Write "codex"/"claude"/"copilot" plain in the body and in the facts: a bare `@`-mention would summon a review round for unpublished work, and the script stops on one (`mention`).
Where a reply or a finding quotes one verbatim, keep it inside a code span or a fenced block, which notifies nobody.

**Which `--state`** — the first of these that is true of the run, since each later one asserts more about origin than the ones above it allow:

- **`unknown` — the publication left no usable account of what it posted.**
  The per-item account is missing, incomplete while the PR already carries part of this map, names one item twice, or names an item that is no disposition this run holds — those entries are keyed by `threadId`/`url` — a misfired finding's url with its ordinal, a CI lane's identity as step 3 gathers it — never by a `ref`, which two threads a re-review left on one line share.
  Absence of a report is not evidence that nothing reached the PR: publication pushes first and replies after, so a stop after the push with nothing usable reported is the ordinary shape of a part-way stop.
  `--reason` says which facts are missing, and `--missing <one line>` puts them on the record's origin line.
  Say what is unknown; never say nothing reached origin — and never say unknown of what the run does know: `--push` carries the one fact still held, `advanced` where the push moved the remote, `noop` where it was an `Everything up-to-date` no-op, `none` where no successful push is known.
  A report that broke its own required-field contract is distrusted **whole** rather than field by field, its per-thread half included: every thread entry carries the reservation to check it on the PR before replying or resolving, even where only the Summary URL is missing and the account looks complete.
  One empty account is complete rather than missing — a publisher whose push never succeeded acted on no thread, since the push precedes every reply and the Summary — and that run is `not-published`, or `unconfirmed` where its own push read-back is what stopped it.
- **`part` — part of the map is on the PR and the rest is not.**
  `--reason` says what landed and what did not.
  `--landed` names what **is on the PR**, never what this run itself did: each thread's end state when publication stopped, so a reply an earlier run posted, a reply skipped as a duplicate, and a resolve already done all count.
  `--outstanding` names what step 7 still owes, which is not every disposition without a reported reply: a standalone item is addressed in the Summary comment alone and is never resolved as a thread, and an ambiguous-skipped thread is deliberately left without a reply and left open, so both stand at "nothing is owed" on a *complete* publication.
  The **resolve** is owed over a narrower set again: step 7 resolves a push-back or a deferral only on a bot thread, so a human push-back or deferral is unresolved by policy on a complete publication — it is out of the resolve count, and its entry says the resolve turns on the maintainer's authorization rather than that one is still owed.
  `--push` is required here, and says what that means for the tips: `advanced` where a push put them on origin (name it in `--landed`), `noop` where they were already there, `none` where what landed rode the API with no successful push and the tips are still local.
- **`unconfirmed` — `pr-branch.sh push` answered `unconfirmed`, and nothing else was published.**
  Whether the ref moved is the one fact that stop failed to establish, so the record calls the tips neither published nor local; put what each push URL returned (the `readback=` lines) in `--reason`.
  The entries carry no reservation: the read-back stops ahead of the first reply, so what this run posted is not in doubt.
- **`not-published` — nothing of the map is on the PR.**
  A `no-push` run, a round cap, a blocker.
  Add `--push noop` where a push succeeded as an `Everything up-to-date` no-op and no reply, resolve or Summary comment followed: the tips are then already on origin, and the record must not call them local.

In `part` and `unknown`, every thread keeps its entry and its verbatim reply, and each entry says where it stands, from what the publication actually confirmed per thread rather than from what it set out to do: an entry whose reply is already posted says so and whether its resolve is still owed, and one the publication reported no outcome for says that rather than guessing either way, since a reply posted twice and a reply never posted are both worse than an entry that sends the next turn to look.

**Every entry carries the same field set whatever its disposition** — the stable reference (path:line, the comment author, and the thread's node id; for a standalone item, whose url is its permalink below and is written there once rather than in both slots, the comment author and — for a misfired finding — the finding's ordinal within its comment, `finding N of M`, since every finding that comment holds shares the one url — and, on its own `finding:` line, that finding's text verbatim as step 3 took it — as a one-line JSON string literal, its newlines and quotes escaped, since a finding is ordinarily several paragraphs or a code fence and placed raw would run into the entry's other slots — since the ordinal alone cannot tell the recorded finding from different text a later edit of the comment puts at N; for a CI lane, its identity as step 3 gathers it — its details URL names one head's run and the next push replaces it, so it is the lane's permalink rather than its identity), the permalink (the thread's, the standalone comment's url, or the lane's details URL), and the reply body verbatim — with a follow-up-task entry adding the committed file and its queued or deferred placement, and a standalone item or CI lane, which has no thread to reply on, carrying in the reply slot the Summary-comment text drafted for it (its cause and disposition, for a lane) rather than a reply nothing will post.

Everything else in the record can be re-derived from the PR.
The drafted reply bodies and the ready-to-post Summary body cannot, so they go in **verbatim**; step 8's report is the source of both.

**The SHAs are provenance, never a replay gate.**
They say what this run saw, not what a later run must find.
A rebase before the final push invalidates any `final HEAD == branch tip` assertion while changing nothing about whether the work is still there.
So never assert that equality, and never replay a recorded `Fixed in <sha>` citation as written: **re-derive every SHA from the branch at replay time**, so each reply cites a commit the branch actually carries.

**Replaying a record.**
What replay must establish is that the reviewed work is still in the branch, and the branch's tree as it now stands is the authority on that.

- **A spent record replays to nothing.**
  A record whose status line reads `SPENT` and which carries no `## Threads` block was emptied by the run that published its map, the marker kept so this step reads it as spent rather than as absent.
  It names no disposition and cites no final tip, so the probes below have nothing to run on: every gathered item is ordinary untriaged work, and the report says the record handed over was spent.
  The rest of this list is about a record that still holds entries.
- **Patch-id is the first probe, not the gate.**
  With `F` the recorded final tip and `B` the branch tip now, `git rev-list --right-only --cherry-pick B...F` printing nothing means every recorded commit is represented and the record replays as written — the same representation test step 1's reconciliation uses.
- **A non-empty result rejects nothing.**
  A rebase that resolved a conflict, or split or squashed a commit, mutates the resulting patch-ids while keeping the work — `rebase-stack` documents that as the patch-id cascade — and such a rebase is this record's expected case rather than an edge one.
  A probe that cannot run at all says the same: `F` may no longer be a local object (a fresh clone, a pruned repository), and an absent recorded commit is not an absent fix.
  Fall through to the tree.
- **Then judge per thread, against the tree rather than the record.**
  Is the fix this disposition claims present in the branch as it now stands — for a follow-up-task disposition, is its task file still committed there?
  Present → replay the disposition, its SHA re-derived.
  Genuinely gone → that thread loses its disposition and must **not** be replied to as fixed; re-triage it from scratch this run.
  Unsettleable from the tree → it goes to the maintainer with the record intact (hands-off: leave the thread open and report it), never discarded because a probe was inconclusive.
- **Replay against the threads as they now stand**, per step 3's unresolved-only rule.
  A record whose threads have since been resolved and published replays to nothing, which is the right answer rather than a conflict: a record is only ever the account of the run that wrote it.
- **A recorded standalone item is gathered again.**
  Re-fetch each standalone url the record names and reintroduce the comment as an item where it is still there — an earlier run having gathered it, by the request that identified it or as a misfired finding that qualified on its own, is what makes it one — then judge it against the tree like any other.
  A misfired finding is reintroduced by its recorded ordinal, checked against the finding's text the record carries for it, decoded from the JSON string literal its `finding:` line holds — the record carries it for exactly this, since the ordinal alone cannot tell the recorded finding from whatever text a later edit puts at N — and where the comment now holds fewer than M findings, or the text at N differs from the recorded text beyond whitespace, the body was edited or reordered since and that entry is unsettleable and goes to the maintainer rather than being matched to whichever finding now sits at N.
  Where the comment is gone, it is not outstanding work and that entry replays to nothing.
  A recorded CI lane is re-gathered in the same spirit: step 3 reads the rollup of the current head, and where that lane — matched by the identity step 3 gathers, the new head's run carrying a new details URL — is still failing it is an item again, judged against the tree like any other; where it has since gone green — the push that recorded it re-ran it — or is still running, nothing re-gathers it, so the entry replays as its recorded cause and disposition into this run's Summary comment rather than being dropped, since a green lane on the new head is the outcome the entry claimed and its account is what is still owed.
  The same holds where no lane of the current head's rollup carries the recorded identity at all — the workflow or check renamed or removed since, or not fired for this head by a path filter: the entry replays as its recorded account with that absence named, for the maintainer to read, rather than falling out of the run because nothing matched it; no state of the rollup drops a recorded lane, so an otherwise clean PR still carries that account out rather than taking the terminal no-op over it.
  What ends this — the standalone half's answer to the unresolved-only rule the thread half self-terminates on — is the spend above: the run that publishes such an entry leaves a record with no entries at all, so nothing is re-gathered from it again.
