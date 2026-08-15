# 046e — Deletion-guard the destroy-boundary bullet in the skill mirrors

## Why

`scripts/test-subagent-destroy-boundary.mjs` guards two surfaces: the briefs the workflows render, and the briefs that ship as prose in the `SKILL.md` files of both skill mirrors. The prose half is `PROSE_CLAUSES`, and it covers task 045's *output-destination* clauses only.

The destroy-boundary bullet those same files ship is guarded by nothing. It is the bullet beginning `- **Empirical verification that could change state goes where you send it.**`, one per skill in the seven skills that name `dc-enter` — `address-review`, `address-reviews`, `address-tasks`, `address-tasks-serialized`, `reap-tasks`, `resolve-open-questions`, `review-cycle` — under `plugins/dev-skills/skills/` and mirrored under `codex/dev-skills/skills/`, fourteen copies in all, byte-identical across the two mirrors today. Deleting it from all fourteen passes every suite named in `.github/workflows/tests.yml`, measured in a disposable clone during task 046b's review round.

Task 046b sharpened the cost of that gap rather than creating it. With the no-helper fallback retired, the bullet's guarded `cd` — `cd -- "${DC:?dc-enter returned no path — install it from the dev-skills plugin bin/}"` — is the only thing standing between a missing helper and a subagent running in the shared checkout, and for a skill-driven run this prose is the only place that rule reaches. The workflow-rendered copies of the same rule gained a pin in that round, the `REQUIRED` entry labelled `guarded \`cd\`, naming the install step`; the fourteen prose copies did not.

It was left out of 046b deliberately, because closing it is a design change rather than a row. The census that makes the prose guard fail-closed, `PROSE_WARNING`, is keyed on the spellings the shared-name warning takes, and this bullet spells no warning at all — so anchors appended to an existing entry's `anchors` list would break that entry's `counted !== anchors.length` equality. The shape that fits is the one category 2 already established: a category of its own with a census key of its own, on the `byReference` / `PROSE_BY_REFERENCE` model, so the count comes off the shipped mirrors rather than a hand-written expected number.

## What to do

- Add a third guarded category to `PROSE_CLAUSES` for the destroy-boundary bullet, anchored verbatim in both mirrors like the existing two, with anchors spanning the bullet's operative clauses rather than its opening: the named destination (`DC="$(dc-enter <slug>)"`) and the guarded `cd` with the install pointer its message carries.
- Give the category a census key of its own, matched against every `SKILL.md` in either mirror the way `PROSE_WARNING` and `PROSE_BY_REFERENCE` are, and hold the declared anchor count to it — so a bullet arriving in a skill the table does not name fails as undeclared, and one leaving a declared skill fails the equality. A hand-written expected count is not a substitute; that is the property the two existing censuses exist for.
- Keep the vacuum guards the other categories carry: an empty anchor list, an empty anchor string, and a key present-but-empty must all fail, for the reasons stated beside them.
- Extend the script header's enumeration of prose categories and its inventory of collections whose emptiness switches a check off, and update the paragraph in `plugins/dev-skills/workflows/README.md` that describes the prose half — today it states the guard as covering the destination clauses alone.

## Acceptance criteria

- Deleting the destroy-boundary bullet from both mirrors of any one skill fails `node scripts/test-subagent-destroy-boundary.mjs`, demonstrated in a disposable clone rather than argued.
- Gutting the bullet — keeping its opening sentence while destroying the destination or the guarded `cd` — fails too, so the anchor spans the instruction and not the vocabulary.
- Adding the bullet to a skill the table does not declare fails as undeclared, and removing it from a declared skill fails the count equality; both demonstrated.
- The existing categories still reconcile: the warning census and the by-reference census both hold, and the header's three-category explanation is extended rather than contradicted.
- The plugin and codex copies of every touched section still agree, and every suite named in `.github/workflows/tests.yml` passes.
