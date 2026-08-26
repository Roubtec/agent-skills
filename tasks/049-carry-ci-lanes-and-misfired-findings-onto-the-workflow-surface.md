# 049 — Carry the CI-lane and misfired-top-level-finding rules onto the review-addressing workflow surface

## Why this task exists

PR #114 taught the `address-review` skill (both mirrors) two things the workflow flavor still does not do: gather every failing CI lane on the reconciled PR head as a review item and dispose of it by cause (step 3's "CI on the PR head" bullet and step 4's "CI failure" disposition), and take a bot reviewer's findings misfired into a top-level review summary or issue comment as standalone items where they are fresh and applicable (step 3's four conditions). `wf-address-review.js` was left out of that PR on purpose: its gather stage emits only `review-thread` and `standalone` items, and a `standalone` item only where the request or a prior disposition record names it, so a run driven through `/dev-skills:wf-address-review` reads CI and misfired findings exactly as it did before — not at all. The same PR briefed the peer about its read-only sandbox in the byte-mirrored `review-cycle-core` section, so that third change already reaches every workflow and is not part of this task.

A skill and its workflow flavor stating different rules for the same run is the drift the repo's mirror discipline exists to prevent, and `scripts/test-address-review-reconcile.mjs` reads the skill prose beside the workflow so neither can drift alone — which is why this lands as a task rather than silently.

## Scope

Included:

- **CI lanes as items in `wf-address-review.js`'s gather stage.** Read `statusCheckRollup` the way README's *Contributing* section reads it (by `__typename`, terminal values tested positively), gather each lane whose verdict is not `SUCCESS`/`NEUTRAL`/`SKIPPED` with its identity (`workflowName` plus `name` for an Actions `CheckRun`, `context` for a `StatusContext`; repeated instances on one head are one lane, failing while any is) and details URL plus, for an Actions `CheckRun` only, the bounded failed-log tail (`gh run view --repo <owner>/<repo> --job <job-id> --log-failed | tail -n 200` where the URL names the job, else the `<run-id>` form, since `--log-failed` itself prints every failed step whole — under `set -o pipefail`, so a failed `gh` is a failed gather rather than an empty tail) with the repository taken from the run URL (a `StatusContext` or external-app `CheckRun` has no workflow run: record that logs and re-runs are unavailable), and skip lanes still in progress or describing a head other than the reconciled one — exactly the skill's step 3 bullet. This is a new item kind (`ci-failure` or equivalent) in the gather schema; the fix stage's per-item disposition contract and the publication stage's summary rendering grow the matching case.
- **Disposition by cause**, per the skill's step 4: actionable when this branch caused it and the fix is in scope; ambiguous (maintainer's choice, hands-off records it and pushes nothing for it) when structural, sprawling, or pre-existing; an evidenced flake re-run only on a no-op push and once per run (several failed jobs share the run id), with a repeat flake offered as a follow-up task. The Summary comment's "CI" section names each lane with its cause and disposition.
- **Misfired top-level findings as standalone items.** The gather stage's top-level sweep already fetches every review summary and issue comment; add the skill's freshness/applicability test (written against the current head, no thread already raises it, no maintainer reply dismisses it and the review's `state` is not `DISMISSED`, the code it names still exists) and emit each qualifying finding as a `standalone` item identified by its source permalink plus its ordinal within that comment (every finding one body holds shares the permalink), taking none when freshness is only ambiguous and saying so in `detail`. Publication renders them under the Summary comment's "Top-level findings" section; nothing replies on the bot's comment.
- **Disposition record and replay** carry both kinds: a CI item and a misfired finding both need an entry shape the record can replay, keyed by the lane identity the gather stage records (the run URL is per head, so it is the lane's permalink, and replay matches a recorded lane to the new head's rollup by that identity), or comment permalink plus finding ordinal, in place of a thread id, and the spend/supersede rules apply unchanged.
- **Tests.** Extend `scripts/test-address-review-reconcile.mjs` to drive scripted packets carrying each new item kind through the gates, and to pin the skill prose phrases these rules ride on ("CI on the PR head", "fresh and applicable") beside the workflow's, so a later reword in one place fails here.
- **README's Focused tests section** for the reconcile suite names the new coverage.

Out of scope:

- The `address-reviews` batch orchestrator's own gather (it delegates to this skill's `delegated-fix` mode, which runs the skill's step 3 and inherits the rules) — verify it inherits rather than restate.
- Waiting on a fresh CI rollup after the push; the skill's step 7 says CI gates the merge and the next round reads it.

## Context and references

- `plugins/dev-skills/skills/address-review/SKILL.md` and its `codex/` mirror — step 3 bullets "CI on the PR head" and the top-level summaries bullet's "One more source qualifies on its own", step 4's "CI failure" disposition, step 7 item 3's flake re-run and item 5's "Top-level findings" / "CI" sections.
- `plugins/dev-skills/workflows/wf-address-review.js` — the gather-stage prompt builder (the paragraph beginning "Gather feedback into `items`") and the item schema whose `type` description lists `review-thread` and `standalone`; the publication stage's Summary comment step.
- `README.md` → *Contributing*, the rollup-reading rules to copy rather than re-derive.
- `scripts/test-address-review-reconcile.mjs` — the suite that reads skill prose beside the workflow.

## Acceptance criteria

- A `wf-address-review` run against a PR with a red lane on its head gathers that lane, and its Summary comment names the lane with the cause found and one of the three dispositions.
- A run against a PR whose bot review posted findings only as a top-level comment gathers each fresh, applicable finding as a `standalone` item and lists its disposition under "Top-level findings"; a stale one is left as context.
- `node scripts/test-address-review-reconcile.mjs` passes with cases for both item kinds, and fails when the skill's step 3 phrases above are removed from either mirror.
