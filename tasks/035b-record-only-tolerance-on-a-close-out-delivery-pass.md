# 035b — Let the record-only tolerance reach a close-out-offering delivery pass

## Why this task exists

Task 035 ships three things that interlock, and one pair of them collides.

The **trivial-round close-out** concludes a cycle without another reviewer round when a pass's whole change was non-semantic. Because offering it is offering to conclude, the fixer brief that carries the grant tells that pass to run the **delivery tier** over its final state — the close-out skips the re-review, never the gate.

The **unrelated-flake policy** says that where the delivery run itself surfaced an evidenced-unrelated failure, the pass commits the diagnosis-only follow-up task after the run without rerunning the suite, and calls that record-only commit "the one thing a completed delivery pass survives".

The **record-only close** is the exit that makes that promise real: it reads the range with a cheap read-only check and, finding nothing but the flake record, concludes without buying a reviewer round.

Put them together and the promise does not hold on the close-out path. A non-confirming pass offers a close-out, is therefore told to run the delivery tier, and that full run surfaces the flake — which is the expected place for it, since tiered validation makes the delivery run the first full-suite run of most cycles. The policy then requires the diagnosis task to be committed, so the close-out range now carries a new task file. A task file states acceptance criteria, so the close-out check's `nonSemantic` question answers false and the close-out is forfeited for a normal reviewer round — told the delivery tier, whose reviewer runs the whole suite — after which the confirmation pass owes that tier again. That is precisely the three-runs-of-the-suite cost the record-only tolerance exists to spare, and it is bought by a commit that adds a queue entry and a note.

The record-only exit cannot rescue it, because that exit's condition is gated on the pass being the **confirmation** pass, and a close-out-offering pass is not. The two tolerances are disjoint where they should compose.

This was raised as a P2 on PR #56 by the codex reviewer, in the thread titled "Apply record-only tolerance to close-out delivery passes".

## Why it was not fixed in PR #56

The fix is a new gate shape, not a clause. The close-out check reads one range and answers two questions about the whole of it; making it tolerate a record suffix means splitting the range into the fixes portion and the record portion, judging each by its own rule, and deciding what the result carries when both apply — the branch would then hold a conclusion that is simultaneously a `closeOut` record and a `recordOnly` record, and the consumers that publish each of those to the maintainer would need to say so coherently. That is scope this PR's own review had already converged on without.

The failure mode is also conservative: nothing ships unreviewed. The cycle spends more review than intended, never less. So the branch is defendable as it stands, and the cost is efficiency in a narrow conjunction.

## Reachability today

No shipped consumer grants the close-out. The grant is read only from a direct `wf-review-cycle` invocation carrying the bare `close-out` token (or the structured `closeOut: "on"`); `wf-address-tasks` and `wf-address-review` configure their nested cycles without it. So the collision needs a hand-invoked cycle that grants the close-out **and** whose non-confirming pass's delivery run surfaces an evidenced-unrelated failure. Schedule it accordingly — this is queued rather than deferred because the work is well specified and the condition becomes live the moment a consumer grants the close-out, not because it is expected to bite soon.

## Scope

- Decide the shape first, and record the decision in the task's PR: either (a) teach the close-out check to accept a record-only **suffix** on the range while judging the preceding hunks by the existing non-semantic rule, or (b) drop the `confirming` conjunct from the record-only exit and let it run on any pass that meets the rest of its conditions. Option (b) is smaller but weaker — the record-only exit's other conjuncts were written for a confirmation pass, and an intermediate pass can leave findings undisposed, which the retirement suite's scenario for the record-only close pins deliberately. Do not do both.
- Whichever shape wins, keep the licence on the **diff**: the pass must not be able to self-certify a record suffix any more than it can self-certify triviality today. The cheap read-only check is the pattern; a second question on the existing close-out check is cheaper than a second agent call.
- Say what the result carries when a close-out concludes over a range that also held the record. Both records exist to tell the maintainer that content shipped with no fresh reviewer, so the conclusion must name both the unreviewed non-semantic edits and the unreviewed flake commit, and the flake note must still reach the PR body or batch summary the way the record-only close makes it reach one today.
- Carry the outcome into every rendering: the canonical `review-cycle` block in both workflow copies (the section is byte-identical, so the two move together), the `review-cycle` skill's prose in both the `plugins/` and `codex/` mirrors, and the retirement suite's close-out and record-only scenarios, whose per-leg check count is itself an assertion that must be bumped deliberately.
- Add the negative control the repository requires for any new or changed test assertion.

## Acceptance criteria

- A cycle granted the close-out, whose non-confirming pass ships non-semantic fixes **and** the flake rule's diagnosis-only record in one range, concludes without buying a reviewer round — or, if option (b) was chosen, reaches the record-only exit on that pass — and the retirement suite pins it.
- A range holding anything beyond the non-semantic fixes and that record still forfeits the exit for the normal reviewer round, and the suite pins that too.
- The conclusion's result names every piece of unreviewed content in the range, and the flake note still reaches the maintainer.
- Both workflow copies still pass the `review-cycle-core` byte-identity check, both skill mirrors carry the change, and every suite in `.github/workflows/tests.yml` passes.

## Context and references

- Task 035 — item 1 (validation tiers), item 2 (the unrelated-flake deferral and its record-only commit), and item 3 (the trivial-round close-out). This task is the seam between item 3 and the tolerance item 1 promises item 2.
- Task 035a — the other residue of item 2, deferred; unrelated to this seam, but the same policy's follow-up.
- PR #56 — the review thread "Apply record-only tolerance to close-out delivery passes", where this was first stated.
