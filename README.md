# A Repository of Agent Skills

Roubtec's shared agent skills, distributed as a [Claude Code plugin marketplace](https://code.claude.com/docs/en/plugin-marketplaces). This repo is the single home for every skill flavor; each AI harness consumes it through its own channel.

## Layout

```
.claude-plugin/marketplace.json   # the marketplace manifest (marketplace name: roubtec — "agent-skills" is CLI-reserved for anthropics repos)
plugins/
  dev-skills/                     # Claude Code plugin: software development workflow skills
    .claude-plugin/plugin.json
    bin/gh-review-threads          # hardened review-thread helper added to the plugin PATH
    bin/dc-enter                   # makes a disposable clone to verify claims in, printing only its path
    bin/dc-remove                  # drops one, and can reach nothing else
    skills/<name>/SKILL.md
    workflows/wf-*.js              # Claude dynamic workflows
codex/
  dev-skills/                     # Codex flavors of the same skills (SKILL.md + agents/openai.yaml)
    skills/<name>/...
scripts/
  test-gh-review-threads.sh             # hermetic contract coverage for the review-thread helper
  test-dc-helpers.sh                    # hermetic contract coverage for the disposable-clone helpers
  test-checkout-cleanliness-report.mjs  # regression coverage for the batch workflow's checkout report
  test-review-cycle-retirement.mjs      # behavior coverage for the review cycle's claim lifecycles, terminal gates, and packet measurement
  test-storage-probe-target.mjs         # regression coverage for the batch workflow's df-probe targeting and throttle retention
  test-collision-discovery.mjs          # behavior coverage for the batch workflow's discovery-stage collision partition
  test-collision-dispatch.mjs           # behavior coverage for the batch workflow's pre-PR collision dispatch
  test-subagent-destroy-boundary.mjs    # asserts the destroy boundary and the output-destination rule over every rendered subagent brief, and guards both, plus the disposable-clone bullet, where they ship as skill prose
  test-unreviewed-close-carriage.mjs    # asserts each consumer carries a cycle that concluded with no fresh reviewer through to the maintainer
  test-address-review-reconcile.mjs     # behavior coverage for the review-addressing workflow's reconciliation and location gates, delegated rebase points, publication guard, and disposition record
  test-skill-worktree-base-exclude.mjs  # asserts the skill steps that make the worktree base ignored carry the workflow's own recipe
  test-resolve-tasks-contract.mjs       # pins the shared task-pointer packet, consumer policies, mirror parity, and workflow hands-off exclusions
  test-skill-mirror-parity.mjs          # asserts the two skill mirrors agree in structure — skill presence, heading sequence, per-section list-item counts — with legitimate deltas pinned in skill-mirror-parity-allowlist.json
  skill-mirror-parity-allowlist.json    # the pinned structural deltas the parity suite excuses, one harness reason each
  test-review-stack-plan.mjs            # behavior coverage for the batch workflow's post-batch review stack: mergeable predicate, merge order, safe prefix, and the stage's reclaim-on-every-path control flow
  verify-014-peer-strength-pin.md       # harness-neutral prompt: observe the peer step's pinned review strength (task 014)
  verify-015-peer-review-run.md         # harness-neutral prompt: exercise the peer-review-run primary launch, its reviewFile relay, the stub-helper degradation route, strength, and evidence (tasks 015, 050)
```

### `plugins/`

Holds the Claude Code plugins. Each subdirectory is one independently installable plugin, and a new domain gets a sibling directory here plus an entry in `marketplace.json`.

`dev-skills` carries the cross-repo software development skills, two of which the others build on: `review-cycle`, the canonical fix → fresh-eyes review → best-effort cross-harness peer review → fix protocol, and `resolve-tasks`, the shared task-number/path/glob resolver. Its `bin/` executables are on the Bash tool's PATH while the plugin is enabled, and its `workflows/` are Claude dynamic workflows.

### `plugins/dev-skills/bin/dc-enter` and `dc-remove`

These give empirical verification somewhere safe to happen. `dc-enter <slug> [<ref>]` prints the absolute path of a disposable clone of the invoking repository, and `dc-remove <slug>` drops it however wrecked it is while being unable to reach anything it did not create.

It is a real clone, so deleting refs, committing, rewriting history, or running `gc` inside it cannot reach the repository you are working in. A worktree is not a substitute: it isolates the working tree but shares `.git`, so `branch -f`, `reset`, `update-ref`, and `gc` all reach every sibling worktree.

The only thing `dc-enter` writes to stdout is that path, so `DC="$(dc-enter probe)"` yields either a usable path or an empty string plus a non-zero status — guard it with `[ -n "$DC" ] && [ -d "$DC/.git" ] || exit 1` before using it. Clear `GIT_DIR` and its relatives in your own shell first as well: they override `git -C`, and the helper can only drop them from its own process.

A slug that already has a clone is refused rather than reused, because concurrent sibling subagents derive the same path; `dc-remove <slug>` frees it, and `dc-enter --replace <slug>` re-derives it pristine.

`DC_ROOT` is the placement interface: a container image or a caller that wants the clones somewhere particular says so by setting it. The root is `$DC_ROOT` when that is set, else `$TMPDIR` when that is set, else `/tmp`, and it must be an absolute, newline-free path. Because the default root is a directory every account on the machine can walk into, the directories `dc-enter` creates there are made `0700` rather than left to the umask: the clone is a copy of the invoking repository and keeps its privacy.

`dc-enter` also refuses rather than handing back a clone whose isolation the surrounding environment would weaken — one whose caller-side git configuration defines a remote or a push destination outside the clone, where no local write can remove it — and refuses a **partial clone** it cannot copy faithfully. A **shallow** source is bounded rather than refused, so its clone cannot answer "was this unreferenced object still there?". Each of those refusals names the configuration it decided by.

Why each of those is drawn where it is, and what bounds it, is documented in the helper's own header comment in `plugins/dev-skills/bin/dc-enter`; `scripts/test-dc-helpers.sh` pins the behavior.

### `codex/`

Mirrors the plugin tree with the Codex CLI flavors of the same skills. The two flavors share most of their text but diverge deliberately where harness capabilities differ, so a verbiage change is one PR touching both files side by side; each Codex skill includes its `agents/openai.yaml` UI metadata.

This tree is *not* installed by Claude's plugin runtime — powbox refreshes it onto the Codex config volume at container start from the same marketplace clone. It carries no `bin/` and no runtime puts one on a Codex session's PATH, so that session gets the disposable-clone helpers from the container image or not at all. Powbox bakes `dc-enter` and `dc-remove` from this repository's `plugins/dev-skills/bin/` into `/usr/local/bin`, alongside `gh-review-threads` and through the same pipe, so a session on a current powbox image has them already.

A session off powbox, or on an image built before that bake, installs them itself: `mkdir -p ~/.local/bin && install -m 755 plugins/dev-skills/bin/dc-enter plugins/dev-skills/bin/dc-remove ~/.local/bin/`. The `mkdir` is not decoration — `install`'s multiple-source form copies into an *existing* directory, so on a fresh account without `~/.local/bin` the command alone fails and leaves neither helper installed. That install step is the remedy the precondition under Consumers names.

## Installing (Claude Code Users)

```
claude plugin marketplace add Roubtec/agent-skills
claude plugin install dev-skills@roubtec
```

Or from within Claude Code: `/plugin` → search for the `roubtec` marketplace. Skills and workflows then appear namespaced, e.g. `/dev-skills:address-review` and `/dev-skills:wf-address-tasks`.

The workflow names changed when ownership moved from powbox's config-volume seed to this plugin: the old bare `/wf-address-review` and `/wf-address-tasks` commands are now `/dev-skills:wf-address-review` and `/dev-skills:wf-address-tasks`. Existing seeded copies continue to answer the old names until powbox's `agent-update-skills --prune` retires them.

Repos that use these skills carry a pointer in `.claude/settings.json` so collaborators are prompted to install on first trust:

```json
{
  "extraKnownMarketplaces": {
    "roubtec": {
      "source": { "source": "github", "repo": "Roubtec/agent-skills" }
    }
  },
  "enabledPlugins": {
    "dev-skills@roubtec": true
  }
}
```

## Updates & releases

Merging to `main` **is** the release: the plugin manifests intentionally carry no `version` field, so Claude Code versions installs by git commit SHA and every merged commit is picked up as an update. Only curated (PR → review → merge) changes propagate.

To stay current, either enable auto-update for this marketplace (`/plugin` → Marketplaces → `roubtec` → Enable auto-update; updates apply at session start) or refresh manually:

```
claude plugin marketplace update roubtec
```

## Safety posture

The safety helpers these skills drive — the `wt-*` worktree helpers, the `dc-enter`/`dc-remove` disposable clones, and the isolation rules the batch skills impose — exist to contain accidents, not attackers. The failure they are built against is a typo or a model hallucination irreversibly losing or clobbering work. A git remote is the real backstop there: work that has been pushed survives nearly anything a local mistake can do, which is why these skills commit and push rather than trusting a working tree. The helpers are the local guardrail beside it, keeping a mistake inside the worktree that made it.

That makes them a quasi-sandbox for parallel agent work under happy-path conditions: best effort, low walls, deliberately. A skill in this repo is Markdown that someone installed on purpose, run by an agent that is itself trying to deliver a good result. It is a collaborative setting driven by a shared goal, not an adversarial one, and treating it as adversarial buys very little at a steep price in complexity.

So weight a hardening change by whether an accident can reach it. A divergence an ordinary run can hit is worth fixing. One that needs hand-authored git internals no git command ever writes, plus a deliberately adversarial name, is a finger someone had to work hard to bump — record it and move on rather than spending a review round on it. Where a fix is warranted, prefer the one that deletes complexity over the one that adds a case: letting git answer a question beats reimplementing git's answer carefully. A guarantee small enough to state exactly is worth more than a broad one hedged into uselessness.

This weights hardening findings; it is not licence to wave through defects. A commit landing on the wrong branch, a step reported as done that never ran, a helper claiming a guarantee it does not deliver — those *are* the accidents this posture is about, and they stay findings at full weight however small the diff that fixes them.

We are in the business of making a hammer, not of making sure the hammer cannot bump a finger belonging to someone trying very hard to bump it.

## Contributing

Changes land through PRs, and every merge is a real merge commit: the repo enables merge commits only, with both *Squash and merge* and *Rebase and merge* disabled, so each branch's commits survive intact. What the repo does *not* enforce is that a PR be up to date with the latest `main` before merging, so we rebase each PR onto `main` ourselves and then merge — that convention, not a setting, is what keeps the history linear and each branch's commits readable in order.

Open PRs ready for review rather than as drafts. Agents in particular tend to open drafts conservatively, and here a draft only withholds the automated review round the PR would otherwise trigger; mark one as draft when withholding is the actual intent, not by default.

Open a PR against the ref its branch actually builds on, which for a stacked branch is its parent, not `main`. The base decides what diff the PR shows, so a dependent PR opened against `main` presents its parent's commits as its own work and collects the review comments its parent's PR should have had — and misdirected review is expensive, because the fixes it earns then land on the wrong branch. Assert it rather than assuming it: after `gh pr create` returns, read back the PR it printed (`gh pr view <pr-url> --json baseRefName`) and require the base you intended; on a mismatch repair it with `gh pr edit <pr-url> --base <intended-base>` and say which PR was repaired and from what, rather than fixing it silently.

Read the pre-merge check rollup by `__typename`, and test for the terminal values positively. In `gh pr view <PR#> --json headRefOid,statusCheckRollup`, a `CheckRun` has settled once its `.status` is `COMPLETED`, and its verdict is `.conclusion`; a `StatusContext` has settled once its `.state` is `SUCCESS`, `FAILURE`, or `ERROR`, and its verdict is that same `.state`. Naming the terminal values is what makes the poll correct: an in-progress `CheckRun` reports `conclusion: ""` rather than null, so a jq `//` fallback never fires, and a `StatusContext` carries no `status` field at all, so excluding `PENDING` alone wrongly settles an `EXPECTED` context — required, not yet reported. Bound the wait with an overall timeout and name whatever is still unsettled when it expires, and keep the `headRefOid` the rollup described — the merge below pins to it.

Settled is not green, so test the verdicts positively in the same spirit: merge only once every `CheckRun` conclusion is `SUCCESS`, `NEUTRAL`, or `SKIPPED` and every `StatusContext` state is `SUCCESS`, and stop on anything else — a `CheckRun` conclusion of `FAILURE`, `TIMED_OUT`, `CANCELLED`, `ACTION_REQUIRED`, `STARTUP_FAILURE` or `STALE`, and a `StatusContext` state of `FAILURE` or `ERROR`, all report as settled, so a poll that only waits for settlement happily lands a known-red head. Nothing downstream re-checks this for you: `--match-head-commit` pins the commit, not its verdicts, and branch protection blocks only the checks it has actually been configured to require.

Merge with `gh pr merge <PR#> --merge --match-head-commit <the polled headRefOid>`, so a head that advanced while you waited on the checks fails the merge instead of landing unchecked — an unpinned merge takes whatever the head is by then, which is not the commit whose rollup you read. Treat deleting the branch as its own step whenever a worktree still has it checked out: `--delete-branch` merges, deletes the remote branch, and only then fails the local delete with "used by worktree", so the non-zero exit says nothing about the merge, which already succeeded. Remove the worktree before merging, or omit the flag and delete the branch yourself afterwards; if you do meet that error, re-read the PR's merge state before retrying anything.

## Focused tests

Each subsection leads with the command and the change that obliges you to run it. What a suite pins, and the measured trade-offs behind how each of its checks is drawn, live in that script's own comments.

### `test-gh-review-threads.sh`

Run `bash scripts/test-gh-review-threads.sh` after any behavior change to `plugins/dev-skills/bin/gh-review-threads`; the hermetic suite stubs `gh` and needs only Bash and `jq`.

### `test-dc-helpers.sh`

Run `bash scripts/test-dc-helpers.sh` after any behavior change to `plugins/dev-skills/bin/dc-enter` or `plugins/dev-skills/bin/dc-remove`; the hermetic suite builds throwaway repositories under one `mktemp -d` root, never touches this repository, and needs only Bash, git, and coreutils.

### `test-checkout-cleanliness-report.mjs`

Run `node scripts/test-checkout-cleanliness-report.mjs` after changing the batch workflow's checkout-report behavior.

### `test-storage-probe-target.mjs`

Run `node scripts/test-storage-probe-target.mjs` after changing where the batch workflow points its `df` storage probes or what it does with a reading.

### `test-collision-discovery.mjs`

Run `node scripts/test-collision-discovery.mjs` after changing how the batch workflow's pre-delivery guard partitions its scan before collision resolution; it drives the shipped discovery helper with scripted scan packets.

### `test-collision-dispatch.mjs`

Run `node scripts/test-collision-dispatch.mjs` after changing how the batch workflow settles a branch its guard held after the collision resolver has run.

The property the stage exists for is that a held branch delivers only where a second read-only scan of the refs no longer names it. Which degraded paths are covered, and what the check costs a guard step that collided with nothing, are enumerated in the script's own header comment.

### `test-review-cycle-retirement.mjs`

Run `node scripts/test-review-cycle-retirement.mjs` after changing how the review cycle raises, retires, or serves open questions, how it carries a locked-decision deviation — the two things a pass can claim off the maintainer's list, plus the one it can put ON that list on its way out — or any gate that ends a cycle without a fresh reviewer seeing the result: the trivial-round close-out and its record-only suffix, the standalone record-only close over the delivery gate's one tolerated post-run commit, the light-mode conclusion, and the validation tier a reviewer's brief states.

Run it after changing the packet hard-check's measuring half too — the independent reading of a fixer's worktree that decides whether the cycle adopts its packet at all, which every one of those gates sits behind — and after changing the shared peer preflight, the peer prompt's primary `peer-review-run` launch shape or its capability-degradation route (a `passed`/`issues` result with no usable `reviewFile` takes the manual fallback, stated once per run; a reported `model: null` is a strength note and never a trigger), the adaptive throttle's forfeiture-reason mapping, the direct-provider process-identity helpers, or how `wf-review-cycle.js` parses the invoker's grant of the close-out.

It drives the shipped `review-cycle-core` section of both workflows through scripted rounds. Why each check is drawn where it is lives in the script's own comments beside the scenario it governs — including why a parentless HEAD is read as a definitive empty rather than a failed reading, which is what keeps an ordinary depth-1 checkout from refusing every packet, and why a branch named `feature/close-out-ui` grants no close-out.

### `test-subagent-destroy-boundary.mjs`

Run `node scripts/test-subagent-destroy-boundary.mjs` after changing any workflow prompt, any skill brief that tells a subagent where its build or validation output goes, or the disposable-clone bullet the skill briefs ship.

It renders every brief the three workflows hand a spawned subagent — discovering the set from their own `agent()` call sites — and fails when a render is missing the destroy boundary, when a new prompt builder has no rendered case, when the cut-marker map and the workflows on disk disagree in either direction, when the three out-of-section boundary constants have drifted apart, or when a workflow's deputy copy of the finish-in-turn rule has drifted from the review cycle's, is interpolated without a declaration the check can read, or has stopped existing anywhere in the directory.

Over those same renders it carries task 017's other rule — a brief that orders a build or validation must name a destination for output redirected to a file — and it deletion-guards that rule, and the destroy boundary's own disposable-clone bullet, where they ship as `SKILL.md` prose in both skill mirrors instead and there is nothing to render. A census over every skill in either mirror sorts the shipped clauses into the four categories that reconcile the counts.

Read the prose half as a deletion guard rather than as parity with the rendered checks: a call is syntax, so a new builder is discovered, while a new prose brief that orders a build and names no destination has nothing to be discovered by. The script's header states each check's premise, every accepted miss, and what every empty collection does — including the cases that reported a pass until they were demonstrated.

### `test-unreviewed-close-carriage.mjs`

Run `node scripts/test-unreviewed-close-carriage.mjs` after changing what a review-cycle consumer does with a cycle that concluded without a fresh reviewer seeing the final content — the trivial-round close-out, and the record of a delivery run that failed on the evidenced-unrelated flake disposition — or after changing the per-pass flake history and the packet measurement log that ride the same carriers.

The delivery gate admits a failed delivery run only on the promise that the failures reach the maintainer, so the suite drives the shipped result carriers and PR-body/summary-comment briefs of `wf-address-tasks.js` and `wf-address-review.js` and fails when either drops, stops rendering, or over-claims that record. It also covers the one consumer stage that can falsify part of the record — the pre-PR collision guard's fresh re-review of a renamed branch, which sees the very commit the record says no fresh reviewer saw — on both halves: what it must correct, and what it must leave alone.

Which routes reach the record's no-commit shape, and why the measurement log is named in the refusal message that sends a reader to it, are in the script's own comments.

### `test-address-review-reconcile.mjs`

Run `node scripts/test-address-review-reconcile.mjs` after changing `wf-address-review.js`'s branch-reconciliation gate, working-location rules, delegated rebase points, zero-item exits, publication guard, or disposition record — or the paragraphs of the `address-review`/`address-reviews` skill mirrors that state those same rules in prose, which the suite reads beside the workflow so neither can drift alone.

It evaluates the shipped script with the runtime globals stubbed and drives scripted packets through it, so the gates are exercised as running code. The prose checks are phrase pins that catch a clause reworded, moved out of its step, or dropped, but cannot hold polarity — a rule reversed around a surviving phrase passes — so polarity stays the reviewer's to hold.

It also covers the two item kinds task 049 carried from the `address-review` skill's step 3 onto the workflow: a `ci-failure` item per lane failing on the reconciled head — identified by its lane, never by the details URL that names one head's run, and disposed of by cause, with `flake-rerun` the one kind only a lane may take and `push-back` and `deferred-to-task` the two it may not — and a bot's findings misfired into a top-level review summary or issue comment as `standalone` items where fresh and applicable, identified by the comment's permalink plus the finding's `N of M` ordinal. Scripted packets carry both kinds through the gather's identity guards and the coverage and publishability gates (a packet gathering one identity twice, or a misfired finding whose ordinal is not the exact `N of M` form, stops at the gather rather than collapsing onto the last item; an entry for one finding covers no other finding sharing its url; a lane keyed twice conflicts; every cross-kind naming — read trimmed on both sides, the way coverage keys it — and every re-run ordered on a lane the head no longer shows failing is rejected, as is `already-addressed` on a lane the head still shows failing; the record carries each misfired finding's text beside its ordinal as a one-line JSON string literal, for the replay's edit check; an accepted flake re-run is recorded per run id, so a later turn orders only the runs still owed, and a lane counts as re-run only where the accepted ids cover every run it names), and the phrases the rules ride on — "CI on the PR head" and "fresh and applicable" among them — are pinned in both skill mirrors beside the workflow's own gather brief, so a reword of either surface alone fails. The rationale for each check, and every measured trade-off behind the accepted misses, lives in the suite's own comments beside the reads they govern, not here.

### `test-skill-worktree-base-exclude.mjs`

Run `node scripts/test-skill-worktree-base-exclude.mjs` after changing how any SKILL.md tells a run to make the worktree base ignored, or the fork-attach recipe beside it that `cd`s into a path built out of `$WT_BASE` — task 046a brought that recipe into this suite's remit without updating the README.

The reconcile suite above pins the ignore recipe on the workflow side; three skill steps state it in prose as well — `address-reviews`' and `address-tasks`' bootstrap steps and `address-review`'s attach paragraph — each shipped in two hand-edited mirrors with no generator between them, which is six files that can drift from the workflow and from each other one edit at a time. This suite asserts each step's two mirrors are byte-identical, that each carries the load-bearing clauses, that the same clauses appear in both `wf-address-review.js`'s and `wf-address-tasks.js`'s own text so the skills cannot be reconciled into a second spelling of one recipe, and that no mention of `.git/info/exclude` stands undisclaimed as a path to write — the defect task 018a repaired, where the literal append simply fails from a linked worktree. On `wf-address-tasks.js` it also pins the bootstrap prompt's own step that discharges the obligation — its preference clauses, each anchored to the line that must carry them, and its probe stated exactly once across the whole file — and asserts the claim task 047a retired, that the helper "performs the whole Session Bootstrap", stays ABSENT.

Two exclusions are pinned as decisions rather than left to a later audit, each asserted in the direction a later round would actually move it: `address-review`'s restatement is asserted NOT to carry the re-probe or its blocker, and `declare-shadows` is asserted to name the exclude exactly ONCE, under its framing as a rule source that does not reach teammates. Why each is drawn that way, and why the second is a count rather than a search, is in the script's own comments beside those checks.

### `test-resolve-tasks-contract.mjs`

Run `node scripts/test-resolve-tasks-contract.mjs` after changing `resolve-tasks`, any task consumer's pointer preflight, or `wf-address-tasks`' resolve stage.

### `test-skill-mirror-parity.mjs`

Run `node scripts/test-skill-mirror-parity.mjs` after adding, removing, or editing any `SKILL.md` in either mirror — `plugins/dev-skills/skills/` or `codex/dev-skills/skills/` — or after editing `scripts/skill-mirror-parity-allowlist.json`.

The mirrors are hand-edited in lockstep and legitimately differ in prose, so this suite compares structure only: every skill exists in both trees, the ordered sequence of ATX headings (level and text, fenced blocks excluded) matches, and each shared section holds the same number of ordered-list items and top-level bullets. It replaces the divergence count a PR summary used to recite, which no check ever depended on. A legitimate structural difference is pinned in the allowlist as an exact delta — the skill, the heading, and the one-sided heading or both mirrors' counts — with a one-line harness reason; an unlisted divergence, a divergence that drifted from its entry, and an entry whose divergence has vanished all fail, and a failure names the skill, the heading, the element, and the side. Each entry excuses exactly one divergence, so a pinned one-sided heading duplicated within its mirror fails, and a one-sided section's list items are counted against an empty counterpart, so the heading entry excuses the heading alone and each item beneath it is a delta of its own. The three clause-scoped suites above keep pinning what they pin; this one only notices a whole step, bullet, or section arriving on one side.

### `test-review-stack-plan.mjs`

Run `node scripts/test-review-stack-plan.mjs` after changing `wf-address-tasks.js`'s post-batch review stack (task 052): the mergeable predicate, the canonical merge order, the merge-commit safe prefix, the guide-branch naming, or `buildReviewStack`'s control flow — or the terminal `Summary` stage and abort catch that place it.

It evaluates the shipped declaration prefix with scripted agents and drives the stage through its success, clean-stop, merge-guard, drift, and throw paths, pinning that the stage reports rather than throws, that the teardown runs on every path that created the dedicated worktree, and that only the batch's own `refs/pre-rebase/...` snapshots reach the teardown's delete list. A full `Workflow` run of a real batch is outside what a script can do; the Git recipes the four briefs prescribe were exercised by hand in a disposable clone when the stage landed, and the placement of the stage before the closing main-checkout reading is asserted here so it cannot drift back behind it.

### `test-pipelined-batch.mjs`

Run `node scripts/test-pipelined-batch.mjs` after changing the batch workflow's per-task pipeline (task 033): how a task waits for its prerequisites, the serialized first-ready-wins guard and the reservation it holds through delivery, the rebase onto a base a merged sibling advanced, the storage-derived slot gate and the slot a worktree left in place keeps (the review stack's worktree takes one too), the numbers a held branch's result names, the in-pipeline reconciliation of pushed branches left without a PR, or the terminal-state census the summary reads.

It drives the shipped pipeline with scripted agents, some deferred so the suite can observe order rather than only outcomes. A live multi-task workflow run is outside what a script can do; what it establishes, and the perturbations it was checked against, are in `plugins/dev-skills/workflows/README.md`'s Validation section.

### Dynamic workflow parse check

Parse-check any changed dynamic workflow under `plugins/dev-skills/workflows/`. That check is not a `scripts/` suite: the command, and what a pass does and does not establish, live in `plugins/dev-skills/workflows/README.md`'s Validation section rather than here.

## Consumers

| Consumer                        | Channel                                                               |
|---------------------------------|-----------------------------------------------------------------------|
| Claude Code users (any machine) | plugin install from this marketplace                                  |
| powbox containers (Claude)      | same plugin channel, pre-installed at image build                     |
| powbox containers (Codex)       | `codex/` tree synced at start from the marketplace clone              |

The `enable-worktrees`, `declare-shadows`, and `session-learnings` skills intentionally describe powbox facilities but live here so both harness flavors refresh through the shared plugin channel. Container implementation details such as helper binaries, mount setup, and skill-sync machinery remain in the `Roubtec/powbox` repo.

**`dc-enter` and `dc-remove` are a precondition of these skills, not a branch inside them, and this is the one place that says so.** Wherever a skill or workflow in either tree names the disposable clone — seven skills per mirror, and the five boundary constants the three workflows declare — it names it unconditionally; none carries a no-helper fallback any more, because a fallback is a second destination and the whole point of the rule is that there is only one. All three consumers above are covered without anyone doing anything: Claude's plugin runtime puts `plugins/dev-skills/bin/` on PATH on any machine, and powbox bakes both helpers from that same directory into `/usr/local/bin` alongside `gh-review-threads`, which covers its Codex containers too. A fourth population the table does not list — a Codex session off powbox, or one on an image built before that bake — installs them itself with the command the `codex/` section under Layout gives; it is absent from the table because the table is keyed on distribution channel, and that population has none. Where that step was skipped, a run stops rather than degrades: `DC="$(dc-enter <slug>)"` yields nothing, and the guarded `cd -- "${DC:?…}"` every brief carries aborts before the first command that writes — never a hand-rolled path outside the repository, which is what the retired fallback used to license. The remedy is stated twice because neither placement covers both cases: the brief names it at the invocation, which is the half that survives `set -e` (an absent helper exits the assignment 127, so the shell dies before the `cd` expands anything), and the stop's own message repeats it for a run that got that far. That message points at the error `dc-enter` printed rather than asserting absence, because absence is not its commonest cause — the helper refusing a reused slug exits non-zero with empty stdout too, and there it is installed and its own stderr already names the fix. Both are pointers rather than second copies of the step: the command that installs the helpers is written once, in the `codex/` section under Layout.

## GitHub Automation

This repo runs focused tests and Claude automation against its own PRs via three workflows in `.github/workflows/`. The two Claude workflows require a `CLAUDE_CODE_OAUTH_TOKEN` repo secret.

- **`tests.yml`** — runs the regression suites in `scripts/` (see Focused tests above for what each one covers) on every PR.
- **`claude.yml`** — a mention bot. Comment `@claude ...` on an issue or PR (or in a PR review) to summon it; only OWNER/MEMBER/COLLABORATOR authors can trigger it, since the job runs with write permissions.
- **`claude-code-review.yml`** — runs Anthropic's `code-review` plugin automatically when a PR is opened (or reopened / marked ready for review) and posts inline review comments; later pushes are not auto-reviewed — ask for a re-review with an `@claude` mention. Skipped on PRs from forks, which don't receive the secret.
