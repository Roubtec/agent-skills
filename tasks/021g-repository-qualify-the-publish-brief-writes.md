# 021g — Repository-qualify the publish brief's PR reads and writes

## Why

Task 021a qualified the disposition record's three PR writes at the repository the PR is in, resolved from the PR's own URL, because on a cross-repository PR handled from a fork clone `gh api`'s `{owner}`/`{repo}` placeholders and a bare `gh pr comment` both answer for the repository the current directory resolves to — the head fork — where the PR and its comments are not.

That fix reached the record phase only. The **publish brief** rendered by `publishPrompt` in `plugins/dev-skills/workflows/wf-address-review.js` still orders unqualified calls, and it is the brief that mutates the PR:

- step 1's off-shoot arm reads `gh pr view <N> --json headRepository,headRepositoryOwner,isCrossRepository` with no `--repo`;
- step 4's `review-thread` recipe names the REST reply path `pulls/.../comments/<commentId>/replies` with no repository, and the `resolveReviewThread` GraphQL call beside it takes its ids from that same unqualified context;
- step 5 posts the Summary comment with a bare `gh pr comment`;
- step 6's `ping-copilot` arm runs a bare `gh pr edit <PR#> --add-reviewer @copilot`, and its `ping-codex`/`ping-claude` arms say only "post a dedicated comment", naming no command and no repository — so the agent picks one, and every default resolves to the fork.

The publish brief is handed to a subagent told only to read `AGENTS.md`/`CLAUDE.md`. It never receives the skill's "GitHub API recipes" section, whose intro now states the qualification rule once — a stated rule in a document the publisher never reads is not coverage. So an ordinary supported run (a fork-clone working location, which the workflow's own location step reaches by design) can read or mutate a same-numbered PR in the head fork.

This was raised as a codex peer finding on PR #77 and judged out of scope there: thread 1 named the record's own writes ("all three operations"), the publish brief was untouched by that commit range, and bundling it would have mixed a second, larger surface into a fix-up round. It is recorded here rather than left in a review thread.

## Scope

`plugins/dev-skills/workflows/wf-address-review.js` — the brief rendered by `publishPrompt`. Both `address-review` skill mirrors where they restate any of these calls as prose (`plugins/dev-skills/skills/address-review/SKILL.md` and `codex/dev-skills/skills/address-review/SKILL.md`, headings "Step 7 — Publish after the review gate" and "GitHub API recipes").

Out of scope: the gather brief and the record briefs, both already qualified by 021a; the ping *policy* (which bot, when), which is unchanged.

## What to do

1. Give `publishPrompt` the same WHICH REPOSITORY paragraph the record briefs carry — the `<owner>/<repo>` resolved from `packet.pr.url`, written out literally in each command, and explicitly not re-derived from a bare `gh repo view --json nameWithOwner`, which with no repository argument answers for the directory.
2. Qualify every call listed above: `gh pr view --repo <owner>/<repo>`, `gh api repos/<owner>/<repo>/pulls/...`, `gh pr comment <N> --repo <owner>/<repo>`, `gh pr edit <N> --repo <owner>/<repo> --add-reviewer @copilot`.
3. Decide and state where the GraphQL `resolveReviewThread` call gets its repository context, since it operates on a node id: the id comes from the gather's scope-checked thread list, so the qualification it needs is that the ids were fetched for this PR — say so rather than leaving it implied.
4. Do the same for `wf-address-reviews`-side prose if it restates any of these calls.

## Acceptance criteria

- Rendering the publish brief for a packet whose `pr.url` names `owner/repo` shows `<owner>/<repo>` on every PR-scoped call it orders, and no `repos/{owner}/{repo}` placeholder and no bare `gh pr comment`/`gh pr view`/`gh pr edit` survives in it.
- `scripts/test-address-review-reconcile.mjs` gains a check over the rendered publish brief asserting both halves — the qualified spellings present, and the unqualified ones absent — so a re-introduced placeholder fails rather than passing on the prose alone. It follows the existing check for the record brief ("the three PR writes qualified at the repository the PR is in, named from its own URL") and bumps `EXPECTED_CHECKS`.
- Both skill mirrors state the rule where they restate these calls, and the mirror divergence for `address-review/SKILL.md` is unchanged by the edit (hand-edited in lockstep; there is no generator).
- All nine CI steps in `.github/workflows/tests.yml` pass, and `wf-check plugins/dev-skills/workflows/wf-address-review.js` is clean.

## Notes

Related: 021a (the record's own writes), 017b (addressing repositories by path).
