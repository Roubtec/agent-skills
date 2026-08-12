# 021d — Read the PR head from the fetch, not from an object-existence test, in the review-addressing skills

## Why this task exists

Both review-addressing skills fetch the PR's exact head ref and then guard against the head having moved since `gh pr view` reported it — and both guard with the wrong probe. `plugins/dev-skills/skills/address-review/SKILL.md`, in "Step 1 — Resolve and verify the PR" under "Reconcile the working location's branch with the PR head before triaging anything", says to "confirm the recorded commit is a local object (`git cat-file -e <headRefOid>^{commit}`)" and to re-read the PR head only when that fails. `plugins/dev-skills/skills/address-reviews/SKILL.md` states the same check in its canonical worktree-entry path, the paragraph beginning "The canonical path. Resolve the PR, then prefer a same-named local branch if you have one", before creating the entry's branch at the recorded OID.

Object existence cannot answer the question either one is asking. The check is written for a force-push landing in the window, which leaves the recorded OID undownloaded — but the far more ordinary movement is an advance, and there the recorded OID is still reachable from the local checkout (in `address-review` it is typically an ancestor of `HEAD`; in `address-reviews` it came in with the same fetch). `git cat-file -e` therefore succeeds and the run proceeds against a stale head. In `address-review` that stale head goes straight into the reconciliation: the first probe finds nothing unrepresented, the run reports work-as-it-stands, and it addresses review on a checkout that is in fact strictly behind — precisely the defect task 021b's rule exists to stop, arriving through the rule's own front door. With items to address, the cost is a whole fix-and-review cycle before publication notices the moved head; with none, the run reports a clean no-op that was not one.

PR #67 fixed this in `plugins/dev-skills/workflows/wf-address-review.js`, whose gather brief now takes the comparison head from `git rev-parse FETCH_HEAD` — what the fetch actually brought — and records it as `pr.headOid` when it differs from what was read earlier. The skills were left as they are because 021b scoped itself to rendering the settled rule for the workflow, not to editing the rule; this task carries the same correction back to the skill side, where the wording differs enough per skill that it is not a copy-paste.

## Scope

Included:

- Replace the object-existence check in `address-review`'s reconciliation paragraph with a comparison of what the fetch brought against the recorded `headRefOid`, and reconcile against the fetched OID. Keep the force-push case working: an undownloaded recorded OID is still a head that moved, and the fetched OID answers that case as well as the advance case, so the fix should delete the extra step rather than add one beside it.
- Apply the same correction to `address-reviews`'s canonical worktree-entry path, where the recorded OID names the commit an entry's branch is created at. Decide there whether "the head moved" means adopt the fetched OID as the entry's head (the skill's existing instruction, "re-read the PR head, record the refreshed OID as this entry's head, and continue from it") or something else; the skip-and-record fallback for a head that keeps moving stays.
- Mirror both changes into `codex/dev-skills/skills/address-review/SKILL.md` and `codex/dev-skills/skills/address-reviews/SKILL.md` in the same PR — the flavors diverge deliberately elsewhere, but this sentence is shared text and no generator keeps them in step.

Out of scope:

- Re-litigating the reconciliation rule itself (its probes, its three outcomes, its no-work-lost heuristic). Only where the head it compares against comes from is in question.
- `wf-address-review.js`, already fixed in PR #67 and covered by `scripts/test-address-review-reconcile.mjs`.
- The off-shoot publication hazard, which is task 021c.

## Context and references

- `plugins/dev-skills/workflows/wf-address-review.js` — the gather brief's reconciliation paragraph (the one instructing `git rev-parse FETCH_HEAD`), which is the shape to carry across.
- `scripts/test-address-review-reconcile.mjs` — the check named "and takes their `R` from the fetched ref, not from an existence test on the recorded OID", which pins the workflow side.
- PR #67 thread `PRRT_kwDOTNFS7M6Xj00y` — the review finding this task comes from, raised against the workflow and disposed there; the skills were deferred to here.
- Task 021b — the rule the workflow renders; task 021c — the other 021b follow-up, on publication rather than on the head being compared.

## Target files or areas

- `plugins/dev-skills/skills/address-review/SKILL.md`
- `plugins/dev-skills/skills/address-reviews/SKILL.md`
- `codex/dev-skills/skills/address-review/SKILL.md` (mirror)
- `codex/dev-skills/skills/address-reviews/SKILL.md` (mirror)
- `scripts/test-address-review-reconcile.mjs` — the regression pin for the four skill paragraphs, beside the workflow-side check it already carries

## Implementation notes

- Prefer deleting the existence check to keeping it beside a comparison: the fetched OID is a local object by construction, so a second probe on it re-states what the fetch already established.
- Name what the fetch is read with, so the instruction is executable rather than a principle — the workflow uses `git rev-parse FETCH_HEAD` after fetching the exact head ref.
- The two skills' paragraphs read differently and serve different next steps (reconcile a checked-out branch vs. create an entry's branch). Rewrite each in its own terms rather than pasting one into the other.

## Acceptance criteria

- Neither skill treats the recorded OID's presence in the local object store as evidence that the head did not move.
- Both take the head they act on from what the fetch brought, and record it where the rest of the skill consumes it (`address-review`'s reconciliation and lease, `address-reviews`'s entry head).
- A force-pushed head that left the recorded OID undownloaded is still handled, and `address-reviews`'s skip-and-record fallback for a head that keeps moving is unchanged.
- The two Codex mirrors carry the identical correction; the count of deliberate divergences between each pair is unchanged.

## Validation

- Walk both cases against the delivered text: a head advanced by a push (recorded OID still reachable locally) and a head force-pushed away (recorded OID absent). Both must reach the same "the head moved" handling.
- The pin belongs in `scripts/test-address-review-reconcile.mjs`, beside the workflow-side check it already carries: that suite pins this rule on the workflow side only, and its brief-reading check does not read SKILL.md. Skill prose is pinnable all the same — `scripts/test-subagent-destroy-boundary.mjs` reads `SKILL.md` files in both mirrors, which is the precedent rather than the destination — so extend the reconciliation suite to read the rule out of the paragraph that states it in both skills and both mirrors. Reading each paragraph for the fetched-head command is not sufficient, because a gutted rule contains it too: both "do not use `git rev-parse FETCH_HEAD`; retain the recorded OID" and an existence gate re-spelled `git rev-parse --verify <headRefOid>^{commit}` with the fetched head demoted to a fallback would pass such a check. So read each paragraph for the *phrase* that skill states the rule in (`address-review`'s "rather than the recorded `headRefOid`"; `address-reviews`' "adopt the fetched OID as this entry's head"), and for the absence of any object-existence gate other than that read of the fetched head — `cat-file -e`/`-t` in any spelling, and `rev-parse` only where it asks `--verify` or carries a peel suffix (`^{commit}`, `^{}`), the spellings an existence gate on a commit takes, because these skills also run `rev-parse` for a branch name, a toplevel, a rebase path and a pinned ref, and banning those would fail an ordinary edit that mentions one in the rule paragraph — with `cat-file` in those modes banned file-wide besides, since re-importing that probe anywhere in either skill is the regression, and banned there in the same spellings the paragraph read counts, off one shared source, so the file-wide ban cannot narrow to a literal `cat-file -e` while the paragraph read still catches `-t` and loose spacing. The deleted probe is the shape a later edit re-imports as a safety check, and nothing else would notice. Claim no more for those reads than they do: both pin the phrasing, so they fail a rewrite that drops it or re-imports a probe, and they *miss* a rule reversed while the pinned phrase survives, a demotion of the fetched head stated without naming a command, a probe in a spelling outside those, or one written outside a backticked span, which is all the read looks at. A regex over prose cannot separate "adopt this head" from "adopt it only where the other is missing" — so state the limits with the checks rather than sharpening the regexes at polarity, which the reviewer holds. State one further limit apart from those, because it runs the other way — an *over-report* rather than a miss: the exemption must recognize the fetched-head read only in its canonical spelling (the whole span being `git rev-parse FETCH_HEAD`, with an optional `--verify`, an optional peel suffix, and nothing else), so a re-spelled read that also asks `--verify` or peels — `git -C <path> rev-parse --verify FETCH_HEAD^{commit}`, `git rev-parse --verify --quiet FETCH_HEAD`, `git rev-parse --verify FETCH_HEAD > <file>` — is reported as a gate, while a re-spelling carrying neither marker never reaches the probe and passes regardless. The remedy is to normalize the spelling in the paragraph or to widen the recognizer deliberately, never to relax the exemption back to a mention of `FETCH_HEAD`; unlike the misses, this one fails loudly and prints the span. Say which limits are misses and which is the over-report wherever they are listed, so a reader does not take every limit for a hole.
- Prove each of those checks by gutting the shipped text in a disposable clone rather than trusting the suite's own pass: both gutted shapes above must fail and name the check they broke, and a benign rewording of the prose around the rule must still pass, so the pin is not a byte comparison in disguise. Prove the probe read in both directions too, since the spellings it excludes are what keeps it from firing on ordinary prose: a non-query `rev-parse` added inside the rule paragraph (`git rev-parse --abbrev-ref HEAD`) must still pass, while an existence gate on the recorded OID (`git rev-parse --verify <headRefOid>^{commit}`) must fail — including when it is spelled beside the fetched-head read in one span, in either order, or with a comment naming `FETCH_HEAD`, which is where a mention-anywhere exemption let the reversed rule through. Fixture each part of the discriminator so that no part rides on another: the shared span with the read on each side pins the exemption's span-end anchoring, and a gate asking only `--verify` and one that only peels pin the two branches of the probe separately, while a gate spelled `cat-file -t` and one spelled with the words spaced apart pin the spellings the `cat-file` branch accepts — which is the file-wide ban's own source, so narrowing it to one literal spelling fails a case here rather than quietly weakening a read no fixture exercises — and dropping any one of those parts must fail a case and name it. That pins the parts, not every character that spells them: the anchor's trailing backtick and its `$` are redundant with each other, because an extracted span always ends in a backtick and never contains one, so removing `$` alone changes no verdict and leaves the suite green. Say so where the fixtures are stated, rather than implying every character of the regex is load-bearing.

## Review plan

Reviewer confirms the existence check is gone rather than supplemented, that the force-push case is still covered, that each skill's paragraph was rewritten in its own terms, and that both Codex mirrors moved with them.
