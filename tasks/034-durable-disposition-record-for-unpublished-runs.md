# 034 — A durable home for the disposition map of a run that does not publish

## Why this task exists

`address-review` step 8 already requires a run to report every thread's disposition with a stable reference, and says why: *"On a **no-push** run this mapping is essential: a later 'push now' turn uses it to replay the exact replies/resolves without re-deriving everything."*

Nothing makes that mapping outlive the session. It is chat output. Close the session and the record of which thread was pushed back, what the drafted rationale said, and what the Summary comment was going to say is gone — and the next run re-triages from scratch, most likely reaching a different answer on exactly the judgment calls that were expensive the first time.

The maintainer raised this on PR #29 while deciding the blocked-parent policy (thread `PRRT_kwDOTNFS7M6VaOvv`), asking directly: *"how would a packet like that look like? where would it live so that i may be replayed?"* Three homes were weighed and two were ruled out on evidence:

- **A gitignored file in the repo.** Killed by two maintainer objections. Worktree teardown deletes ignored files by design — `prune-branches` and `address-tasks` both state that ignored files must not hold a removal back — so the record dies exactly when the worktree is cleaned up. And `git clean -fdx` on a shared checkout takes it too.
- **A custom git ref** (`refs/address-review/<branch>/<ts>`, alongside `refs/pre-rebase/**` and `refs/pruned/**`). Survives teardown, `git clean`, and rebase. Rejected on visibility: this is precisely the objection task 031a records against `refs/pruned/**` — a record you can only find by remembering the `git for-each-ref` incantation is not a record the maintainer will actually find, and refs accumulate and pin objects indefinitely.
- **A top-level PR comment.** Chosen. Immune to worktree teardown, `git clean`, rebase, session end, and container recreation; visible with no incantation; and `address-review` step 3 already reads issue comments, so a later run finds it without being told where to look.

The maintainer's decision was explicit that this is a first cut, not a settled design: *"this is a similar issue that we have not seen through to nailing down a solid design. let's go with a top-level comment for now — better than nothing and even if local is lost, the next recovery implementer will have their path trailblazed."*

It is filed rather than implemented on PR #29 because it is not a local edit. It changes the `no-push` contract, which is currently stated as *zero* PR mutations in the argument table, the flag-interactions table, step 7, step 8, and the checklist of `address-review`, is passed through by `address-reviews`, and is re-stated in both dynamic workflows. Quietly redefining a flag whose entire purpose is "mutate nothing" — across six files, inside a PR about stacked-PR rebase guidance — is the wrong way for that change to land.

## Scope

Included:

- Define the record's **content** once, in `address-review`, and reference it from the other callers rather than restating it. Step 8 already enumerates most of it; the record adds only the drafted reply bodies and the ready-to-post Summary body, which are the parts that cannot be re-derived. Shape agreed on PR #29:

  ```
  # address-review packet — PR #141 (task/141-foo)
  status: not published (<reason>)
  starting HEAD 9f3a1c2 | final HEAD abc1234 | recorded headRefOid 9f3a1c2
  base 21af561 | validation PASS | reviewer Pass (2 rounds) | peer forfeited

  ## Threads
  [fixed]     SKILL.md:265  codex  thread=PRRT_kwDO...vv
              url:   .../pull/141#discussion_r369...
              reply: "Fixed in <tip>: gate merged parents on ..."
  [push-back] SKILL.md:148  codex  thread=PRRT_kwDO...v1
              reply: "<full drafted rationale, verbatim>"
  [task]      -> tasks/034-foo.md (queued)

  ## Summary comment (verbatim, ready to post)
  <full markdown body>
  ```

- **Record SHAs as provenance, never as a replay gate.** This is the correctness requirement, not a detail. The maintainer's objection was that *"the branch may want a rebase before the final push"*, which invalidates any `final HEAD == branch tip` assertion while changing nothing about whether the work is still there. Replay must verify that every commit unique to the recorded final tip is still **represented in the branch by patch-id** — the same test PR #29 adopted for branch reconciliation and for the merged-parent guard — and must re-derive each `Fixed in <sha>` citation at replay time rather than replaying a stale SHA. A replay keyed on SHA equality is a failed implementation of this task however well it stores the record.
- Decide and state plainly what `no-push` now means. It cannot both post this comment and promise zero PR mutations. Either carve out the record comment as the single documented exception (and say so in every one of the places listed above, not just one), or gate the comment behind something other than `no-push`. Pick one and make all six statements agree; a partial edit leaves the contract self-contradicting, which is worse than either choice.
- Apply the same record to a run that intended to publish and could not: an entry blocked at the round cap, holding a blocker, or awaiting a maintainer decision.
- Post at most one such comment per PR per run, and make a later run recognize and supersede its own prior record rather than stacking near-duplicates — the same idempotence step 7 already requires of thread replies.
- Cover both harness renderings of every affected skill, plus the inlined briefs in `plugins/dev-skills/workflows/wf-address-review.js` and `wf-address-tasks.js`.

Out of scope:

- The custom-ref and gitignored-file homes, both rejected above. Revisit only if the comment home proves inadequate in practice.
- Sweeping or expiring old record comments. If they prove noisy, that is its own task, and it is the same shape as 031a.
- Any change to the blocked-parent publication policy PR #29 settled. That policy is what makes this record rare rather than routine: a dependent now publishes instead of being held, so the record is for genuine `no-push` runs and genuinely blocked entries.

## Context and references

- PR #29 thread `PRRT_kwDOTNFS7M6VaOvv` (`codex/dev-skills/skills/address-reviews/SKILL.md`, publication section) — where the maintainer asked the question and chose the comment home. The reasoning is in the thread; this file is the record of it.
- `address-review` step 8, the "stable reference" bullet — the existing content requirement this task persists.
- `address-review` argument table, flag-interactions table, step 7, step 8, checklist — the five places stating `no-push` means zero PR mutations.
- `address-reviews` argument table (`no-push` pass-through) and its checklist.
- `plugins/dev-skills/workflows/wf-address-review.js`, `wf-address-tasks.js` — inlined briefs restating the same contract.
- Task 031a — the visibility objection that ruled out the custom-ref home; read it before proposing a ref-based design.

## Target files or areas

- `codex/dev-skills/skills/address-review/SKILL.md`, `plugins/dev-skills/skills/address-review/SKILL.md`
- `codex/dev-skills/skills/address-reviews/SKILL.md`, `plugins/dev-skills/skills/address-reviews/SKILL.md`
- `plugins/dev-skills/workflows/wf-address-review.js`, `plugins/dev-skills/workflows/wf-address-tasks.js`

## Implementation notes

- Define the shape once and reference it. This skill family's failure mode is the same paragraph drifting between two mirrors and two workflows; a second verbatim copy of the record format is a third place to drift.
- The comment needs a stable machine-recognizable marker so a later run can find and supersede it without matching on prose.
- State explicitly that the cited tip is local-only and not on origin. A reader who assumes otherwise will look for commits that are not there.

## Acceptance criteria

- A `no-push` run, and a run blocked before publication, leave a durable record on the PR containing every thread's stable reference, disposition, drafted reply body, and the ready-to-post Summary body.
- Replay verifies by patch-id representation and re-derives SHA citations. A design asserting `final HEAD == branch tip` fails this criterion, because a pre-push rebase is the expected case rather than an edge case.
- The `no-push` contract reads consistently in all of: `address-review`'s argument table, flag-interactions table, step 7, step 8, and checklist; `address-reviews`' argument table and checklist; and both workflows. A change landing in some of those and not the others fails.
- Re-running against the same PR supersedes the prior record instead of appending a second one.
- Both mirrors of each skill stay in parity apart from their harness-specific lines.

## Validation

- Walk the PR #29 scenario: a descendant reviewed and blocked behind a parent at the round cap, session ended, new session replays from the comment alone — without the original context, and after an intervening rebase of the descendant branch.

## Review plan

Reviewer confirms the record is SHA-independent for validity, that every stated `no-push` contract location agrees after the change, and that the record format is defined in one place rather than copied into each caller.
