# 035a — Deduplicate flake follow-up tasks across concurrent branches

## Why this task exists

Task 035's unrelated-flake policy has each implementer that meets an evidenced flake queue a follow-up task, and bounds the resulting duplication with a greppable suite name in the title plus a grep-first-and-append step before writing a new one. That grep runs inside a per-task worktree on its own branch, so it sees already-landed tasks and tasks this same branch wrote — not the flake task a concurrent sibling committed on the sibling's branch minutes earlier. The concurrent case is exactly the motivating scenario (one batch, several implementers, one flaky suite), so in the case that matters most the grep finds nothing and every sibling writes its own task under a different number. 035 makes that honest rather than fixing it: duplicates are declared acceptable and consolidation is the maintainer's job at the next reaping sweep, since `reap-tasks` flags duplicate task *numbers*, not duplicate content.

## Why it is deferred rather than queued

The cheap remedy is the one 035 ships, and it may well be sufficient forever: consolidating two or three same-titled flake tasks costs the maintainer a minute, while every candidate fix costs standing machinery.

- **Widening the search across sibling refs** (grep the batch's other task branches, not just the working tree) narrows the window without closing it — a sibling that has not committed yet, or commits a second later, still duplicates — so it buys a partial guarantee at the price of a new cross-branch read in the writer's path, and a hedged guarantee is worth less here than a small exact one.
- **A batch-level owner** (the orchestrator, not the implementer, writes flake tasks) does close the race, but it moves flake-task authorship out of the implement→review→fix loop and into batch orchestration — a real change to `address-tasks` and `wf-address-tasks`, not a clause in the review-cycle block, and one that couples every implementer's flake finding to a round trip through the orchestrator.

Neither is justified until the duplication is observed to actually cost something. The condition also cannot occur yet: nothing writes flake tasks until 035 itself ships.

## Trigger to promote this task

A batch in which concurrent flake tasks were queued and the maintainer's consolidation sweep was more than incidental effort — several near-duplicate task files, or duplicates that survived a sweep and confused later scheduling. Promote with the observed batch cited, and pick between the two shapes above on that evidence.

## Scope if promoted

- Decide between widening the writer's search across the batch's sibling refs and hoisting flake-task authorship to a batch-level owner; do not do both.
- Author the outcome once in the canonical `review-cycle` block if it stays a writer-side rule, or in the batch skills if it becomes an orchestrator responsibility, and carry it into every derived rendering per the pattern 019 establishes.
- Revise 035's honest scoping clause (the one that states what the grep can see) to match whatever ships, so the two do not contradict each other.

## Context and references

- Task 035 — item 2, the unrelated-flake deferral policy and its duplication-bounding step; this task is the residue that policy knowingly leaves to the maintainer.
- Task 027 — the task-number collision guard, which already reads across in-flight branches; whatever cross-branch reading this task might need should reuse that approach rather than invent a second one.
