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
  test-review-cycle-retirement.mjs      # behavior coverage for the review cycle's claim lifecycles, packet-worktree measurement, shared peer preflight, and peer-process identity handoffs
  test-storage-probe-target.mjs         # regression coverage for the batch workflow's df-probe targeting and throttle retention
  test-collision-discovery.mjs          # behavior coverage for the batch workflow's discovery-stage collision partition: a reported clash must name at least two reviewed branches or hold the wave
  test-collision-dispatch.mjs           # behavior coverage for the batch workflow's pre-PR collision dispatch: a held branch delivers only once a re-scan of the refs no longer names its clash
  test-subagent-destroy-boundary.mjs    # renders every workflow subagent prompt and asserts the destroy boundary is in it, and an output destination in every one that orders a build or validation (and that no copy of either, or of the finish-in-turn rule, has drifted); guards the same destination clauses, and the destroy boundary's own disposable-clone bullet, against deletion where they ship as skill prose instead
  test-unreviewed-close-carriage.mjs    # asserts each consumer carries a cycle that concluded with no fresh reviewer through to the maintainer, and asserts the one consumer that can falsify part of that record corrects it
  test-address-review-reconcile.mjs     # drives the review-addressing workflow's branch-reconciliation gate (the off-shoot exemption, the outcomes it fails closed on, its position ahead of the empty-items exit, and that exit's own split into the skill's two zero-item outcomes — a terminal no-op only on three-way tip agreement, the zero-item path everywhere else, and a fail-closed stop where a zero-item packet cannot show its tips), the working-location gate beside it and the surviving-worktree report a halted run owes, and the delegated rebase points after it (the full commit a delegation range may be taken against, the halt that stops the run with its question, the validation a replay must report, the evidence a no-op claim must carry, the `no-rebase` opt-out and the base it pins instead, and the pre-push point's re-verification over the rebased tree), and reads the rules and attach commands the gather and rebase briefs state them from, plus the same head-source rule where the two review-addressing skills state it as prose, in both mirrors; it also reads the publication guard beside the gate — the stops that must precede the lease, the proof an off-shoot owes that it carries the recorded head, where each case resolves the target it pushes to, and the re-check of the working location — in the rendered publish brief and in both of the skill's mirrors; it also drives the disposition record an unpublished run leaves — which exits leave one, what the brief must carry, which repository its writes address, the tip it cites for a map a later pass moved out from under, what a stopped publication may call landed — what the PR CARRIES rather than what that run itself posted, so a replay whose no-op push found its reply already there is published in part — and what it may call outstanding, the two ways a completion claim is refused and told apart (a report that cannot say so, and one whose own account says the opposite), the worktree each of those keeps and the prescribed publications that still give theirs back, when a map it knows is incomplete may not supersede an earlier record, and how the next run replays a prior one — the standalone entry it re-gathers, and the full publication that spends the record holding it
  test-skill-worktree-base-exclude.mjs  # asserts the skill steps that make the worktree base ignored carry the workflows' own recipe, byte-identical across both mirror trees and with no undisclaimed mention of the literal exclude path; pins the same clauses in `wf-address-review.js` and in `wf-address-tasks.js`'s bootstrap prompt, where the retired "performs the whole Session Bootstrap" claim is pinned absent
  test-resolve-tasks-contract.mjs        # pins the shared task-pointer packet, consumer policies, mirror parity, and workflow hands-off exclusions
  verify-014-peer-strength-pin.md       # harness-neutral prompt: observe the peer step's pinned review strength (task 014)
  verify-015-peer-review-run.md         # harness-neutral prompt: exercise retained raw peer paths, strength, evidence, and helper prerequisites (task 015)
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

Each subsection leads with the command and the change that obliges you to run it. What a suite pins, and the measured trade-offs behind how each of its checks is drawn, live in that script's own header comment rather than here.

### `test-gh-review-threads.sh`

Run `bash scripts/test-gh-review-threads.sh` after any behavior change to `plugins/dev-skills/bin/gh-review-threads`; the hermetic suite stubs `gh` and needs only Bash and `jq`.

### `test-dc-helpers.sh`

Run `bash scripts/test-dc-helpers.sh` after any behavior change to `plugins/dev-skills/bin/dc-enter` or `plugins/dev-skills/bin/dc-remove`; the hermetic suite builds throwaway repositories under one `mktemp -d` root, never touches this repository, and needs only Bash, git, and coreutils.

### `test-checkout-cleanliness-report.mjs`

Run `node scripts/test-checkout-cleanliness-report.mjs` after changing the batch workflow's checkout-report behavior.

### `test-storage-probe-target.mjs`

Run `node scripts/test-storage-probe-target.mjs` after changing where the batch workflow points its `df` storage probes or what it does with a reading.

### `test-collision-discovery.mjs`

Run `node scripts/test-collision-discovery.mjs` after changing how the batch workflow partitions a discovery scan before collision resolution; it drives the shipped discovery helper with scripted scan packets.

### `test-collision-dispatch.mjs`

Run `node scripts/test-collision-dispatch.mjs` after changing how the batch workflow settles a wave's held branches after its collision resolver has run.

The property the stage exists for is that a held branch delivers only where a second read-only scan of the refs no longer names it. Which degraded paths are covered, and what the check costs a wave that collided with nothing, are enumerated in the script's own header comment.

Run `node scripts/test-review-cycle-retirement.mjs` after changing how the review cycle raises, retires, or serves open questions, or how it carries a locked-decision deviation — the two things a pass can claim off the maintainer's list, both of which need a round to pass over the claim — as does a deviation a pass first puts ON that list on its way out, which needs the reviewer's half of the protocol just as much — and after changing any gate that decides what ends a cycle without a fresh reviewer seeing it: the trivial-round close-out, its independently checked record-only suffix over a close-out delivery pass, the standalone record-only close over the delivery gate's one tolerated post-run commit, or the validation tier a reviewer's brief states; it drives the shipped `review-cycle-core` section of both workflows through scripted rounds. Run it after changing the packet hard-check's measuring half too — the independent reading of a fixer's worktree that decides whether the cycle adopts its packet at all and resolves the committed HEAD and parent that delimit a one-commit close-out suffix, which every one of those gates now sits behind: the suite pins that a measured-dirty or mid-operation packet is refused however cleanly the pass reported itself, that a reading nobody could take is refused as unknown rather than passing as clean, that a checker cannot substitute the whole pass range for the final commit's actual parent-to-tip range, that the parent is read out of HEAD's own commit header rather than by resolving `HEAD^` — which a root commit and every shallow clone make fail — so a parentless HEAD is a definitive empty costing only the suffix claim instead of a `measured: false` that would refuse every packet in an ordinary depth-1 checkout, and that the measurer's own brief neither asserts a branch a detached HEAD would fail nor resolves a worktree it could rebuild. It also drives the shared peer-preflight latch under concurrent first-wave calls, including reset after a synthesized throw, checks the adaptive throttle's exact helper/raw forfeiture-reason mapping and negative near-matches on both workflow copies, and extracts the Codex-side prose's direct-provider PID/start-time helpers to simulate `/proc` reuse, start-read and identity-file-write cleanup, bounded TERM/KILL, survivor failure, and missing-process death without signalling a real process; the same section pins that the Claude-provider helper conversion remains deferred until powbox documents a provider-neutral full-review payload, parses the retained raw path's passed-versus-issues evidence-failure contract, and pins byte identity of the two workflow cores. Finally, it covers how `wf-review-cycle.js` parses the invoker's GRANT of that close-out, which decides whether the gate is reachable at all: the grant is read from the same prose string that carries the review TARGET, so it counts only as a standalone token and a branch named `feature/close-out-ui` grants nothing.

Run `node scripts/test-subagent-destroy-boundary.mjs` after changing any workflow prompt, any skill brief that tells a subagent where its build or validation output goes, or the disposable-clone bullet the skill briefs ship; it renders every brief the three workflows hand a spawned subagent — discovering the set from their own `agent()` call sites — and fails when one is missing the destroy boundary, when a newly added prompt builder has no rendered case, when a workflow is added to that directory without being given a cut marker, when a cut marker names a workflow that is no longer there, when the three out-of-section boundary constants have drifted apart, or when a workflow's own deputy copy of the finish-in-turn rule has drifted from the review cycle's — or is interpolated by its prompts without a declaration the check can read, or has stopped existing anywhere in the directory, which fails because two of the three workflows declare that rule and interpolate it today — briefing a subagent out of section does not by itself oblige a declaration — so no declaration anywhere means the declarations went rather than the deputies, and a rule bound to no deputy at all was reported as a pass before it was checked.

The same suite carries task 017's other rule over those renders: a brief that orders a build or validation must name a destination for output redirected to a file. Which renders those are is neither derived from the prose nor listed — a list missing an entry passes, which is the failure mode this closes — but declared per render as a verdict the fixtures must be total over, so a builder new to the suite fails for having no verdict just as it fails for having no fixture. Be exact about what that totality covers: builder names are discovered from the sources, while each builder's render cases are enumerated in the fixtures by hand, so the verdicts are total over the enumerated cases rather than over every render a builder can produce — a new branch of a builder already fixtured yields no case, and so no verdict to be missing, until its fixtures widen. The destination itself is then matched by exact containment: of the constant the brief interpolates where the clause is a constant, and of verbatim pins spanning the positive destination where the clause is bespoke to its site, which several deliberately are because the safe destination differs by whether the role commits from the tree it would write into; a verdict claiming a build order while pinning no span at all fails as unclassified rather than passing vacuously, since containment of nothing establishes nothing. A render declared to order no build is cross-checked the other way, against every destination clause the suite declares rather than against the ones its own fixtures still claim — the difference matters because the wrong verdict this catches used to empty the search set in the same edit. What remains uncaught is a build order added with no destination clause at all and its verdict left saying so, or one grown on a branch no fixture renders, and the script's header says so.

Those clauses also ship as prose, in the `SKILL.md` briefs of both skill mirrors, where the file text is the brief and there is nothing to render. That half is a deletion guard — a verbatim anchor of every shipped clause must stay present in both mirrors, backed by a census over every skill in either mirror so a clause that arrives or leaves fails too, as long as it spells the shared-name warning the census counts: that key is an alternation of the spellings that ship, and the cycle's own all-roles destination rule shipped neither censused nor anchored because it spells it differently. The count the census is held to is of the warning-carrying anchors, which is the qualifier that makes the equality statable at all: one shipped clause — the delegated rebase step's, which obliges the brief to carry a destination and delegates *which* to the artifact-directory rule anchored above it — spells no warning for any census key to count, so it is anchored without joining that count, and it shipped guarded by nothing until that category existed. It is censused all the same, by a second key over the delegation it makes rather than over a warning it never spells, and held to the anchors declared for that category: dropping the key that declares them while the clause still ships fails as loudly as dropping a warning-carrying anchor does, where until that census it was the one guard in the table removable in a single silent edit. A third guarded category joined those two and is not a destination rule at all: the destroy boundary's own disposable-clone bullet, which the seven skills naming `dc-enter` ship once each in both mirrors, byte-identical across all fourteen copies. It spells no shared-name warning and delegates nothing, so neither census above reaches it, and it has a census key of its own — the subject the bullet opens with — with its anchor held to that count the same way, so a bullet arriving in a skill the table does not name fails as undeclared and one leaving a declared skill fails the count. A grep for the concept therefore finds more clauses than any one census counts, and the script's table sorts them into the four categories that reconcile the numbers. It is not parity with the rendered checks and must not be read as such: call-site accounting discovers a new builder because a call is syntax, while a new prose brief that orders a build and names no destination has nothing to be discovered by. Prose briefs are guarded against deletion; they are not discovered.

Run `node scripts/test-unreviewed-close-carriage.mjs` after changing what a review-cycle consumer does with a cycle that CONCLUDED without a fresh reviewer seeing the final content — the trivial-round close-out and the record of a delivery run that failed on the evidenced-unrelated flake disposition, whether that record names the gate's one tolerated post-run commit or no commit of its own at all — the terminal conclusion's pass having committed nothing, its evidence citing an already-active task; the light conclusion's commits having been seen by the round that just passed; or the close-out's edits riding in the close-out record the same result carries. A fourth route into that no-commit shape belongs to a consumer rather than to the cycle: `wf-address-tasks.js` gives a branch its pre-PR collision guard renamed a fresh delivery-tier re-review over the cumulative range, so that reviewer has seen the tolerated commit and the record must stop claiming none did — the suite covers that correction, and equally what it must leave alone. That re-review is also the branch's LAST delivery-tier run, with no fixer pass around it to record a failure it defers, so its verdict carries the fixer's recording field and the suite asserts the dispatch publishes what comes back — a record of its own in the no-commit shape, superseding the corrected one and appended to the flake history — while a failure the re-review can tie to no active task keeps holding the branch. The cycle records both, and the delivery gate admits a failed delivery run only on the promise that the failures reach the maintainer, so the suite drives the shipped result carriers and PR-body/summary-comment briefs of `wf-address-tasks.js` and `wf-address-review.js` and fails when either drops, stops rendering, or over-claims that record. It covers the per-pass flake history beside them: that record speaks for the concluding pass, so an intermediate pass's evidenced-unrelated failure reaches the maintainer through the history or not at all. The per-pass packet measurement log rides those same two carriers and is covered here for the sharper version of that reason: the cycle refuses a measured-dirty packet with a message that sends the reader to that log BY NAME for the list of uncommitted paths, so a carrier that drops it leaves the refusal promising a list the result does not carry.

Run `node scripts/test-address-review-reconcile.mjs` after changing `wf-address-review.js`'s branch-reconciliation gate, working-location rules, delegated rebase points, zero-item exits, publication guard, or disposition record — or the paragraphs of the `address-review`/`address-reviews` skill mirrors that state those same rules in prose, which the suite reads beside the workflow so neither can drift alone. It evaluates the shipped script with the runtime globals stubbed and drives scripted packets through it, so the gates are exercised as running code; the prose checks are phrase pins that catch a clause reworded, moved out of its step, or dropped, but cannot hold polarity — a rule reversed around a surviving phrase passes — so polarity stays the reviewer's to hold. The rationale for each check, and every measured trade-off behind the accepted misses, lives in the suite's own comments beside the reads they govern, not here.

Run `node scripts/test-skill-worktree-base-exclude.mjs` after changing how any SKILL.md — or either workflow's own statement of it, `wf-address-tasks.js`'s bootstrap prompt and `wf-address-review.js`'s worktree-attach step — tells a run to make the worktree base ignored. The reconcile suite above pins that recipe on the workflow side; three skill steps state it in prose as well — `address-reviews`' and `address-tasks`' bootstrap steps and `address-review`'s attach paragraph — each shipped in two hand-edited mirrors with no generator between them, which is six files that can drift from the workflow and from each other one edit at a time. It asserts each step's two mirrors are byte-identical, that each carries the load-bearing clauses (the exclude file asked of `git rev-parse --git-path info/exclude`, that question asked from inside the repository, and the trailing-slash probe), and that no mention of `.git/info/exclude` stands undisclaimed as a path to write — the defect task 018a repaired, where the literal append simply fails from a linked worktree. The same clauses are asserted against the own text of both workflows that state the recipe, `wf-address-review.js` and `wf-address-tasks.js`, so no surface can be reconciled into a second spelling of one recipe; on `wf-address-tasks.js` it also pins the bootstrap prompt's step that discharges the obligation — its preference clauses, each anchored to the line that must carry them, and its probe stated exactly once across the whole file — and asserts the claim task 047a retired, that the helper "performs the whole Session Bootstrap", stays ABSENT. Two exclusions are pinned as decisions rather than left to a later audit, each asserted in the direction a later round would actually move it, since a required-clause list pins only the direction that drops one: `address-review`'s restatement is asserted NOT to carry the re-probe or its blocker, so reconciling that deviation costs a deliberate edit to the suite instead of passing unnoticed, and `declare-shadows` is asserted to name the exclude exactly ONCE, under its framing as a rule source that does not reach teammates rather than a file to append to — the count is what makes that "only" mean only, this being the one skill whose two mirror files carry the literal with no undisclaimed-mention scan over them.

### `test-resolve-tasks-contract.mjs`

Run `node scripts/test-resolve-tasks-contract.mjs` after changing `resolve-tasks`, any task consumer's pointer preflight, or `wf-address-tasks`' resolve stage.

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
