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
  test-review-cycle-retirement.mjs      # behavior coverage for the review cycle's claim lifecycles (question retirement, locked-decision deviations) and its independent packet-worktree measurement
  test-storage-probe-target.mjs         # regression coverage for the batch workflow's df-probe targeting and throttle retention
  test-collision-dispatch.mjs           # behavior coverage for the batch workflow's pre-PR collision dispatch: a held branch delivers only once a re-scan of the refs no longer names its clash
  test-subagent-destroy-boundary.mjs    # renders every workflow subagent prompt and asserts the destroy boundary is in it (and that no copy of it, or of the finish-in-turn rule, has drifted)
  test-unreviewed-close-carriage.mjs    # asserts each consumer carries a cycle that concluded with no fresh reviewer through to the maintainer, and asserts the one consumer that can falsify part of that record corrects it
  test-address-review-reconcile.mjs     # drives the review-addressing workflow's branch-reconciliation gate (the off-shoot exemption, the outcomes it fails closed on, its position ahead of the empty-items no-op) and reads the rule the gather brief states them from
  verify-014-peer-strength-pin.md       # harness-neutral prompt: observe the peer step's pinned review strength (task 014)
```

- **`plugins/`** holds the Claude Code plugins. Each subdirectory is one independently installable plugin; `dev-skills` carries cross-repo software development skills including the shared `review-cycle` building block (the canonical fix → fresh-eyes review → best-effort cross-harness peer review → fix protocol the other skills reference), safe post-batch local branch cleanup, the `enable-worktrees` and `declare-shadows` repository setup skills, the `session-learnings` retrospective skill, and Claude dynamic workflows for review addressing, planned task batches, and the review cycle itself. Its `bin/` executables are available on the Bash tool's PATH while the plugin is enabled. Additional plugins for other domains get sibling directories here and an entry in `marketplace.json`.
- **`plugins/dev-skills/bin/dc-enter` and `dc-remove`** give empirical verification somewhere safe to happen. `dc-enter <slug> [<ref>]` prints the absolute path of a disposable clone of the invoking repository — a real clone, so deleting refs, committing, rewriting history, or running `gc` inside it cannot reach the repository you are working in — and `dc-remove <slug>` drops it however wrecked it is, while being unable to reach anything it did not create. Two things bound that guarantee, and both are the surrounding environment rather than the clone: `dc-enter` refuses to hand back a clone whose isolation the caller's own git configuration would quietly weaken — a remote, or a `remote.pushDefault`/`branch.<name>.pushRemote`/`branch.<name>.remote` push destination, defined outside the clone's config where no local write can remove it, asked with HEAD in the state the clone is handed back on so that a conditional `includeIf "onbranch:…"` definition is refused too; switching branches inside the clone can still activate one the handed-back branch did not match, which no check over the branches that exist can pre-empt because such a pattern may name a branch that does not exist yet, and refusing on the mere presence of an `onbranch:` include would also turn away the everyday per-branch identity setup — and "inside it" means a git command that actually addresses the clone, so clear `GIT_DIR` and its relatives in your own shell before using the path, because they override `git -C`, `dc-enter` can only drop them from its own process, and it warns on stderr whenever one that names another repository's directory, index, objects, or config file was set (not for the ones on git's list that aim git nowhere, such as `GIT_PREFIX`, which git exports to every alias). Separately from that guarantee, `dc-enter` refuses a source it cannot copy faithfully: a **partial clone** (`git clone --filter=…`) keeps part of its history on a promisor remote and fetches it on demand, and a local clone copies the objects that are present while inheriting none of that configuration — so a clone of it can carry refs whose objects it can neither find nor fetch, and a subagent would get a baseline that disagrees with the repository it claims to copy. Neither repair is the helper's to make (fetching them is an unbounded network fetch nobody asked for; keeping them fetchable means handing back a clone still tied to a repository outside it), so it refuses before creating anything, naming the configuration it decided by. That decision reads the configuration rather than traversing the history on every run, so it is deliberately over-inclusive: a partial clone whose objects have all been materialized is refused too, and the diagnostic says so rather than leaving the caller to infer that something is missing. A *shallow* source is bounded rather than refused, because what its clone loses is objects no ref names rather than objects the source's refs reach: git declines the local-copy shortcut for a shallow repository and negotiates a pack instead, so the clone gets what that fetch brings — `refs/heads` and `refs/tags` with everything reachable from them, less anything the source hides from its own `upload-pack` — and a ref beyond that still mirrors fine where its object came with the fetch (an ordinary shallow checkout clones without complaint) but makes `dc-enter` die at the mirror and hand nothing back where it did not (a shallow checkout carrying a stash does exactly that), and an object no ref reaches simply does not come across — so a shallow clone cannot answer "was this unreferenced object still there?". A source that borrows from another store loses part of the same property for a different reason: the dissociation that stops the borrowing repacks what the mirrored refs reach, so an unreachable object living only in the donor, or one that was packed in the source before it became unreachable, does not survive it — a loose one in the source's own store does. A clone of an ordinary, self-contained source carries them all, and that is the case the property is stated for. A worktree is not a substitute: it isolates the working tree but shares `.git`, so `branch -f`, `reset`, `update-ref`, and `gc` all reach every sibling worktree. `DC_ROOT` is the placement interface: powbox will express its "outside `/workspace`" placement by setting it, and until it does — and everywhere off powbox — the clones land under `$TMPDIR`. Because that default is a directory every account on the machine can walk, the directories `dc-enter` creates there are made `0700` rather than left to the umask: the clone is a copy of the invoking repository and keeps its privacy. It must name an absolute, newline-free path; a relative one is refused rather than resolved against the caller's working directory, because the two helpers need not be invoked from the same one and would otherwise address different clones. An existing clone for a slug is refused rather than silently discarded, because concurrent sibling subagents of one container derive the same path; `dc-remove <slug>` frees it, and `dc-enter --replace <slug>` discards it deliberately.
- **`codex/`** mirrors the plugin tree with the Codex CLI flavors of the same skills. The two flavors share most of their text but diverge deliberately where harness capabilities differ; a verbiage change is one PR touching both files side by side. Each Codex skill includes its `agents/openai.yaml` UI metadata. This tree is *not* installed by Claude's plugin runtime; powbox refreshes it onto the Codex config volume at container start from the same marketplace clone. Because that tree carries no `bin/`, a Codex user not on powbox puts the disposable-clone helpers on their own PATH themselves: `mkdir -p ~/.local/bin && install -m 755 plugins/dev-skills/bin/dc-enter plugins/dev-skills/bin/dc-remove ~/.local/bin/`. The `mkdir` is not decoration — `install`'s multiple-source form copies into an *existing* directory, so on a fresh account without `~/.local/bin` the command alone fails and leaves neither helper installed. Skipping that leaves any guidance that looks for `dc-enter` with `command -v` on its no-helper fallback for good, since nothing else installs them on that side.

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

Read the pre-merge check rollup by `__typename`, and test for the terminal values positively. In `gh pr view <PR#> --json headRefOid,statusCheckRollup`, a `CheckRun` has settled once its `.status` is `COMPLETED`, and its verdict is `.conclusion`; a `StatusContext` has settled once its `.state` is `SUCCESS`, `FAILURE`, or `ERROR`, and its verdict is that same `.state`. Naming the terminal values is what makes the poll correct: an in-progress `CheckRun` reports `conclusion: ""` rather than null, so a jq `//` fallback never fires, and a `StatusContext` carries no `status` field at all, so excluding `PENDING` alone wrongly settles an `EXPECTED` context — required, not yet reported. Bound the wait with an overall timeout and name whatever is still unsettled when it expires, and keep the `headRefOid` the rollup described — the merge below pins to it.

Merge with `gh pr merge <PR#> --merge --match-head-commit <the polled headRefOid>`, so a head that advanced while you waited on the checks fails the merge instead of landing unchecked — an unpinned merge takes whatever the head is by then, which is not the commit whose rollup you read. Treat deleting the branch as its own step whenever a worktree still has it checked out: `--delete-branch` merges, deletes the remote branch, and only then fails the local delete with "used by worktree", so the non-zero exit says nothing about the merge, which already succeeded. Remove the worktree before merging, or omit the flag and delete the branch yourself afterwards; if you do meet that error, re-read the PR's merge state before retrying anything.

## Focused tests

Run `bash scripts/test-gh-review-threads.sh` after any behavior change to `plugins/dev-skills/bin/gh-review-threads`; the hermetic suite stubs `gh` and needs only Bash and `jq`.

Run `bash scripts/test-dc-helpers.sh` after any behavior change to `plugins/dev-skills/bin/dc-enter` or `plugins/dev-skills/bin/dc-remove`; the hermetic suite builds throwaway repositories under one `mktemp -d` root, never touches this repository, and needs only Bash, git, and coreutils.

Run `node scripts/test-checkout-cleanliness-report.mjs` after changing the batch workflow's checkout-report behavior.

Run `node scripts/test-storage-probe-target.mjs` after changing where the batch workflow points its `df` storage probes or what it does with a reading: it pins that a bootstrap reporting `ok` without an absolute worktree base fails the batch before any task runs, that every probe measures that validated path rather than a relative fallback, and that a probe which failed or could not measure keeps the previous reading instead of widening or disabling the concurrency cap.

Run `node scripts/test-collision-dispatch.mjs` after changing how the batch workflow settles a wave's held branches after its collision resolver has run. It drives the shipped dispatch with scripted resolver, re-scan, and re-review packets, and pins the property the stage exists for: a held branch delivers only where a second read-only scan of the refs no longer names it, so a rename the resolver reports but the tree does not carry holds both sides — the untouched one included, which is the side that used to deliver with no check at all. Every degraded path is covered the same way (no resolution packet, an unusable re-scan, too few of a clash's branches in hand to compare, a clash the re-scan still sees, a failed re-review, a re-review that passed but left a standing deviation from a LOCKED decision unassessed), as is the cost: a wave that collided with nothing spawns no agent from this stage.

Run `node scripts/test-review-cycle-retirement.mjs` after changing how the review cycle raises, retires, or serves open questions, or how it carries a locked-decision deviation — the two things a pass can claim off the maintainer's list, both of which need a round to pass over the claim — as does a deviation a pass first puts ON that list on its way out, which needs the reviewer's half of the protocol just as much — and after changing any gate that decides what ends a cycle without a fresh reviewer seeing it: the trivial-round close-out, the record-only close over the delivery gate's one tolerated post-run commit, or the validation tier a reviewer's brief states; it drives the shipped `review-cycle-core` section of both workflows through scripted rounds. Run it after changing the packet hard-check's measuring half too — the independent reading of a fixer's worktree that decides whether the cycle adopts its packet at all, which every one of those gates now sits behind: the suite pins that a measured-dirty or mid-operation packet is refused however cleanly the pass reported itself, that a reading nobody could take is refused as unknown rather than passing as clean, and that the measurer's own brief neither asserts a branch a detached HEAD would fail nor resolves a worktree it could rebuild. It also covers how `wf-review-cycle.js` parses the invoker's GRANT of that close-out, which decides whether the gate is reachable at all: the grant is read from the same prose string that carries the review TARGET, so it counts only as a standalone token and a branch named `feature/close-out-ui` grants nothing.

Run `node scripts/test-subagent-destroy-boundary.mjs` after changing any workflow prompt; it renders every brief the three workflows hand a spawned subagent — discovering the set from their own `agent()` call sites — and fails when one is missing the destroy boundary, when a newly added prompt builder has no rendered case, when a workflow is added to that directory without being given a cut marker, when a cut marker names a workflow that is no longer there, when the three out-of-section boundary constants have drifted apart, or when a workflow's own deputy copy of the finish-in-turn rule has drifted from the review cycle's — or is interpolated by its prompts without a declaration the check can read.

Run `node scripts/test-unreviewed-close-carriage.mjs` after changing what a review-cycle consumer does with a cycle that CONCLUDED without a fresh reviewer seeing the final content — the trivial-round close-out and the record of a delivery run that failed on the evidenced-unrelated flake disposition, whether that record names the gate's one tolerated post-run commit or no commit of its own at all — the terminal conclusion's pass having committed nothing, its evidence citing an already-active task; the light conclusion's commits having been seen by the round that just passed; or the close-out's edits riding in the close-out record the same result carries. A fourth route into that no-commit shape belongs to a consumer rather than to the cycle: `wf-address-tasks.js` gives a branch its pre-PR collision guard renamed a fresh delivery-tier re-review over the cumulative range, so that reviewer has seen the tolerated commit and the record must stop claiming none did — the suite covers that correction, and equally what it must leave alone. That re-review is also the branch's LAST delivery-tier run, with no fixer pass around it to record a failure it defers, so its verdict carries the fixer's recording field and the suite asserts the dispatch publishes what comes back — a record of its own in the no-commit shape, superseding the corrected one and appended to the flake history — while a failure the re-review can tie to no active task keeps holding the branch. The cycle records both, and the delivery gate admits a failed delivery run only on the promise that the failures reach the maintainer, so the suite drives the shipped result carriers and PR-body/summary-comment briefs of `wf-address-tasks.js` and `wf-address-review.js` and fails when either drops, stops rendering, or over-claims that record. It covers the per-pass flake history beside them: that record speaks for the concluding pass, so an intermediate pass's evidenced-unrelated failure reaches the maintainer through the history or not at all. The per-pass packet measurement log rides those same two carriers and is covered here for the sharper version of that reason: the cycle refuses a measured-dirty packet with a message that sends the reader to that log BY NAME for the list of uncommitted paths, so a carrier that drops it leaves the refusal promising a list the result does not carry.

Run `node scripts/test-address-review-reconcile.mjs` after changing how `wf-address-review.js` decides whether a run may act on the checked-out branch at all. It evaluates the shipped script with the runtime globals stubbed and drives scripted gather packets through it, so the gate is exercised as running code: a run on the PR's own branch continues only on `work` or `fast-forwarded` and stops on everything else — an unknown outcome string, an empty one, an absent report, and a `not-applicable` that on THIS branch contradicts itself rather than exempting anything; a run on a local off-shoot of a merge-pending PR proceeds whatever the gather reported, because the exemption is keyed on the two branch names; and the gate stays ahead of the empty-`items` no-op, without which the rule's third outcome — which returns no items by contract — would be reported as "nothing to address". It reads the producer of those outcomes too, out of the rendered gather brief that no scenario reaches: both probes, the off-shoot skip reporting `not-applicable`, and that the outcomes the brief tells the agent to report before proceeding are exactly the ones the gate lets through — the two sides agree on literal strings and neither derives one from the other. It covers the publication guard beside it as well: a HEAD that is a proper ancestor of the PR head must stop the publisher before the lease that would match and rewind the branch.

Parse-check any changed dynamic workflow under `plugins/dev-skills/workflows/`. That check is not a `scripts/` suite: the command, and what a pass does and does not establish, live in `plugins/dev-skills/workflows/README.md`'s Validation section rather than here.

## Consumers

| Consumer                        | Channel                                                               |
|---------------------------------|-----------------------------------------------------------------------|
| Claude Code users (any machine) | plugin install from this marketplace                                  |
| powbox containers (Claude)      | same plugin channel, pre-installed at image build                     |
| powbox containers (Codex)       | `codex/` tree synced at start from the marketplace clone              |

The `enable-worktrees`, `declare-shadows`, and `session-learnings` skills intentionally describe powbox facilities but live here so both harness flavors refresh through the shared plugin channel. Container implementation details such as helper binaries, mount setup, and skill-sync machinery remain in the `Roubtec/powbox` repo.

## GitHub Automation

This repo runs focused tests and Claude automation against its own PRs via three workflows in `.github/workflows/`. The two Claude workflows require a `CLAUDE_CODE_OAUTH_TOKEN` repo secret.

- **`tests.yml`** — runs the regression suites in `scripts/` (see Focused tests above for what each one covers) on every PR.
- **`claude.yml`** — a mention bot. Comment `@claude ...` on an issue or PR (or in a PR review) to summon it; only OWNER/MEMBER/COLLABORATOR authors can trigger it, since the job runs with write permissions.
- **`claude-code-review.yml`** — runs Anthropic's `code-review` plugin automatically when a PR is opened (or reopened / marked ready for review) and posts inline review comments; later pushes are not auto-reviewed — ask for a re-review with an `@claude` mention. Skipped on PRs from forks, which don't receive the secret.
