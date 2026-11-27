# A Repository of Agent Skills

Roubtec's shared agent skills, distributed as a [Claude Code plugin marketplace](https://code.claude.com/docs/en/plugin-marketplaces). This repo is the single home for every skill flavor; each AI harness consumes it through its own channel.

## Layout

```text
.claude-plugin/marketplace.json   # the marketplace manifest (marketplace name: roubtec — "agent-skills" is CLI-reserved for anthropics repos)
plugins/
  dev-skills/                     # Claude Code plugin: software development workflow skills
    .claude-plugin/plugin.json
    bin/gh-review-threads          # hardened review-thread helper added to the plugin PATH
    bin/dc-enter                   # makes a disposable clone to verify claims in, printing only its path
    bin/dc-remove                  # drops one, and can reach nothing else
    bin/address-review-pr-branch   # a name on PATH for skills/address-review/pr-branch.sh, for workflow agents
    bin/address-review-record      # the same for skills/address-review/record.sh
    bin/address-review-ping        # the same for skills/address-review/ping.sh
    bin/address-tasks-overlap      # the same for skills/address-tasks/overlap.sh
    bin/write-tasks-task-numbers   # the same for skills/write-tasks/task-numbers.sh
    skills/<name>/SKILL.md
    workflows/wf-*.js              # Claude dynamic workflows
codex/
  dev-skills/                     # Codex flavors of the same skills (SKILL.md + agents/openai.yaml)
    skills/<name>/...
scripts/
  lib/logical-lines.mjs                 # shared Markdown paragraph-rejoining reader for the suites that pin skill prose by its words rather than its wrapping
  test-gh-review-threads.sh             # hermetic contract coverage for the review-thread helper
  test-dc-helpers.sh                    # hermetic contract coverage for the disposable-clone helpers
  test-prune-branches.sh                # hermetic coverage for the prune-branches helper
  test-address-review-pr-branch.sh      # hermetic coverage for the address-review branch helper (head, reconcile, base pin, publication push) and its `bin/` shim
  test-rebase-stack.sh                  # hermetic coverage for the rebase-stack helper (preflight and its sweep, detect, segments, qualify, snapshot, verify, restore)
  test-merge-train.sh                   # hermetic coverage for the merge-train helper (check, survey, rebase, push, merge)
  test-address-review-ci.sh             # hermetic coverage for the address-review CI helper (failing lanes, log tail, re-run)
  test-address-tasks-overlap.sh         # hermetic coverage for the address-tasks overlap helper (trial merges of every pair of delivered branches and of each into the base) and its `bin/` shim
  test-address-tasks-bootstrap.sh       # hermetic coverage for the address-tasks bootstrap helper (the worktree base, its ignore rule from a primary checkout, a subdirectory and a linked worktree, the `wt-bootstrap` and plain-git paths, every stop) and its `bin/` shim
  test-address-reviews-targets.sh       # hermetic coverage for the address-reviews targets helper (entry pairing, the stack and its parent-first order, target pinning, the re-pin)
  test-write-tasks-task-numbers.sh      # hermetic coverage for the write-tasks task-number helper (a branch's claims against the base and every open PR head, relocation pairing, the allocator's inventory, the sweep's duplicates)
  test-address-review-ping.sh           # hermetic coverage for the address-review ping helper (comment pings, the Copilot request and its timeline confirmation) and its `bin/` shim
  test-address-review-record.sh         # hermetic coverage for the address-review disposition-record helper (find, render, post, spend)
  test-checkout-cleanliness-report.mjs  # regression coverage for the batch workflow's checkout report
  test-review-cycle-retirement.mjs      # behavior coverage for the review cycle's claim lifecycles, terminal gates, and packet measurement
  test-storage-probe-target.mjs         # regression coverage for the batch workflow's df-probe targeting and throttle retention
  test-collision-discovery.mjs          # behavior coverage for the batch workflow's discovery-stage collision partition
  test-collision-dispatch.mjs           # behavior coverage for the batch workflow's pre-PR collision dispatch
  test-subagent-destroy-boundary.mjs    # asserts the destroy boundary and the output-destination rule over every rendered subagent brief, guards the destination rule where it ships as skill prose and the disposable-clone bullet in the subagent-boundary.md file beside each brief, and holds that file to byte-identical copies each brief names
  test-unreviewed-close-carriage.mjs    # asserts each consumer carries a cycle that concluded with no fresh reviewer through to the maintainer
  test-address-review-reconcile.mjs     # behavior coverage for the review-addressing workflow's reconciliation and location gates, delegated rebase points, publication guard, and disposition record
  test-skill-worktree-base-exclude.mjs  # asserts the skill steps and workflow briefs that make the worktree base ignored do it through the bootstrap helper and state no recipe of their own
  test-resolve-tasks-contract.mjs       # pins the shared task-pointer packet, consumer policies, mirror parity, and workflow hands-off exclusions
  test-skill-mirror-parity.mjs          # asserts the two skill mirrors agree in structure — skill presence, heading sequence, per-section list-item counts — with legitimate deltas pinned in skill-mirror-parity-allowlist.json
  skill-mirror-parity-allowlist.json    # the pinned structural deltas the parity suite excuses, one harness reason each
  test-skill-bundled-files.mjs          # asserts every file a skill ships beside its SKILL.md is mirrored, committed with the right mode, named by the skill, and that every file a skill or workflow names exists
  test-batch-overlap.mjs                # behavior coverage for the batch workflow's end-of-batch overlap report: mergeable predicate, merge order, the deputy's brief, the output parser (fed the real overlap.sh), and the never-clean-on-failure control flow
  check-bash32-syntax.sh                # `bash -n` on every bundled helper and `bin/` shim under the bash that runs it; CI runs it in the `bash:3.2` image
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

### Helpers bundled inside a skill

A skill whose procedure is deterministic ships it as a script in its own folder and calls it by path, so the script arrives, updates, and is removed with the skill on every install route: Claude's plugin, powbox's seeding of either mirror, or a hand copy of the folder. Nothing has to be on `PATH`. A workflow agent holds a brief rather than a skill folder, so where a workflow needs one of these scripts the plugin's `bin/` carries a small shim that runs the copy beside it (`address-review-pr-branch`, `address-review-record`, `address-review-ping`, `address-tasks-overlap`, `address-tasks-bootstrap`, `write-tasks-task-numbers`): Claude's plugin runtime puts that directory on the Bash tool's PATH, nothing is installed on the user's machine, and the Codex tree, which has no workflows, needs none. `prune-branches/prune-branches.sh` is the first; the brief keeps only what needs judgement (reading the user's guidance, the confirmation, relaying the report). `address-review/pr-branch.sh` carries that skill's branch mechanics: the clean-and-idle check, reconciling the branch with the PR head, pinning a review base, and the publication push with its read-back; `address-reviews` runs its `check` command from the orchestrator's tree and reaches `head` and `pin-base` through its own `targets.sh`, and `wf-address-review.js` publishes through its `push`. `address-review/record.sh` words the disposition record's header for each publish state and makes its one write: finding a prior record by its marker, writing over the run's own, or spending the one it replayed. `address-review/ci.sh` reads the status rollup of a PR's head into failing lanes with their identities, tails a failing job's log, and re-runs a run's failed jobs, taking the repository and the run from the lane's own URL. `address-review/ping.sh` summons the next review round, one reviewer per action: a dedicated `@codex review` or `@claude review` comment, and for Copilot a reviewer request that it confirms from the PR's timeline by the id of an event that was not there before. `address-review/gh-review-threads.sh` is a byte-identical copy of `bin/gh-review-threads`, there so the skill has the scope-checked thread fetcher on every install route and carries no hand-run query; the `bin/` file stays the original because powbox bakes it by copying that one file. `rebase-stack/stack.sh` does that skill's ref arithmetic: the preflight, chain detection by the effective frontier, splitting a chain into runs, deciding whether a run may be replayed once with `--update-refs`, the pre-rebase snapshots, the post-replay verification, and the guarded restore; the rebases themselves, and every conflict, stay with the agent. `address-tasks/overlap.sh` forecasts how a batch's delivered branches will meet, by trial-merging each into the base and every pair with `git merge-tree`, touching no ref, index or working tree; it is the default end of a batch in the skill and the workflow, and the skill's full local review stack is built only on request. `address-tasks/bootstrap.sh` is the session bootstrap `address-tasks` and `address-reviews` open with: it settles the worktree base, makes it ignored in the repo-local exclude file, prunes stale worktree state, probes push access and measures free space, through powbox's `wt-bootstrap` where that is on PATH (which establishes no ignore rule) and through plain git where it is not, which reports a host-shared filesystem under the base rather than refusing it and enforces none of the powbox layout the helper checks; its `ignore` command is the ignore rule alone, which `address-review` and `wf-address-review.js` run before attaching one worktree, and `wf-address-tasks.js` runs the whole of it with `--require-helper`. `address-reviews/targets.sh` plans a review batch in one call: it reads each entry's PR, pairs a branch entry to its one open PR, fetches each head, finds the stack and a parent-first order, and pins every rebase target to an exact commit (the entry's own base, a target the request named, resolved once in the orchestrator's checkout, or its parent), with `repin` reading a default target again before each rebase; it calls `address-review`'s `pr-branch.sh` (`head`, `pin-base`) from the folder beside its own. `write-tasks/task-numbers.sh` reads which task numbers a branch newly claims and who else holds them (the fetched base's whole task tree, and what every open PR head adds), which is the batch skills' pre-PR guard, lists every number standing in the working tree and on open heads for the allocator, and names every file whose full number stands twice in the working tree, without a remote read, for the `reap-tasks` sweep; it matches the remote through `address-review`'s `pr-branch.sh`, and the rules for a collision or an incomplete scan sit in `task-number-guard.md` beside it, read only then. `merge-train/train.sh` reads a PR's standing for the train (open, on the default branch, review items, the rollup, comments since the last look), surveys a list of PRs for stacks and shared files, rebases a PR onto the default branch's freshly fetched tip with the files that landed since it forked, and merges on an exact head after checking all of that again; it calls `address-review`'s `pr-branch.sh` and `ci.sh` from the folder beside its own rather than carry a second copy of the reconcile, the leased push or the rollup reading. The same folder can carry prose that only a subagent reads, so the orchestrator does not hold it in context: `subagent-boundary.md` in each skill that spawns one, `review-cycle/rebase-brief.md`, which is how the delegated rebase step is carried out and which the rebaser is told to read in full, and `review-cycle/fixer-brief.md`, `reviewer-brief.md` and `peer-brief.md`, which hold each review role's own rules: a Fixer or Reviewer is told to read its brief, and the peer's is copied into its prompt file. A skill also keeps there the rules only some of its runs need, so the rest do not carry them: `address-review/disposition-record.md` (posting, replaying and spending the durable disposition record) and `address-review/misfired-findings.md` (findings a bot posted outside its threads), and `address-tasks/review-stack.md` (the local review stack, read only when a batch is asked for one), each of which `SKILL.md` sends a run to read in full when its case arises. A role brief is shared across skills the same way: `address-tasks` and `address-tasks-serialized` send their implementers and reviewers to `review-cycle`'s `fixer-brief.md` and `reviewer-brief.md` in the folder beside their own, and add only their own facts to the prompt. Such a script targets bash 3.2 and needs nothing beyond `git`, using `gh` and the powbox helpers only when present. That each one passes `bash -n` under bash 3.2 is what `scripts/check-bash32-syntax.sh` checks, in CI inside the `bash:3.2` image. Each mirror carries its own copy, held byte-identical by the script's test.

### `codex/`

Mirrors the plugin tree with the Codex CLI flavors of the same skills. The two flavors share most of their text but diverge deliberately where harness capabilities differ, so a verbiage change is one PR touching both files side by side; each Codex skill includes its `agents/openai.yaml` UI metadata.

This tree is *not* installed by Claude's plugin runtime — powbox refreshes it onto the Codex config volume at container start from the same marketplace clone. It carries no `bin/` and no runtime puts one on a Codex session's PATH, so that session gets the disposable-clone helpers from the container image or not at all. Powbox bakes `dc-enter` and `dc-remove` from this repository's `plugins/dev-skills/bin/` into `/usr/local/bin`, alongside `gh-review-threads` and through the same pipe, so a session on a current powbox image has them already.

A session off powbox, or on an image built before that bake, installs them itself: `mkdir -p ~/.local/bin && install -m 755 plugins/dev-skills/bin/dc-enter plugins/dev-skills/bin/dc-remove ~/.local/bin/`. The `mkdir` is not decoration — `install`'s multiple-source form copies into an *existing* directory, so on a fresh account without `~/.local/bin` the command alone fails and leaves neither helper installed. That install step is the remedy the precondition under Consumers names.

## Installing (Claude Code Users)

```sh
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

```sh
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

## Markdown formatting

Markdown style is owned by markdownlint: `.markdownlint.jsonc` pins the house rules (asterisk emphasis, compact tables, fenced code blocks), the nested config under each mirror's `skills/` directory relaxes the heading-title rules SKILL.md files deliberately break, and CI runs the same pinned `markdownlint-cli2` over every Markdown file.

The editor is wired to the identical answer: the committed `.vscode/settings.json` makes the markdownlint extension the Markdown formatter and fixes on save, and `.prettierignore` keeps Prettier — whose Markdown style (aligned tables, underscore emphasis) fights the house rules — away from Markdown entirely. So the IDE, the CLI, agents, and CI all produce the same bytes, and saving an already-clean file changes nothing.

Anywhere without the editor extension — agents, terminals, hooks — the same answer is one command, no repo dependencies needed: `npx --yes markdownlint-cli2@0.23.2 --fix "**/*.md"` (drop `--fix` to check without rewriting). The version is pinned to the one CI runs in `tests.yml`, which is also what the extension bundles; when the extension's bundled `markdownlint-cli2` moves on, bump the pin here and in `tests.yml` together — the extension leads, the pin follows. Not every rule is auto-fixable, so a fix pass can still leave violations that need a hand edit; CI names them.

One editor-side trap is worth knowing: VS Code's built-in prompt-file support opens `SKILL.md` (and `*.prompt.md`, `*.instructions.md`, `copilot-instructions.md`, `*.agent.md`, `*.chatmode.md`, and Markdown under `.claude/rules`, `.claude/agents`, `.github/agents`) in a language mode of its own rather than `markdown`, and the markdownlint extension formats only `markdown` documents — so without intervention those files silently get no formatting at all while CI still lints them. The committed `files.associations` in `.vscode/settings.json` pins them back to Markdown; the trade is VS Code's dedicated tooling for those files (frontmatter completions, the status-bar label), not highlighting.

## Focused tests

Each subsection leads with the command and the change that obliges you to run it. What a suite pins, and the measured trade-offs behind how each of its checks is drawn, live in that script's own comments.

### `test-gh-review-threads.sh`

Run `bash scripts/test-gh-review-threads.sh` after any behavior change to `plugins/dev-skills/bin/gh-review-threads`; the hermetic suite stubs `gh` and needs only Bash and `jq`.

### `test-dc-helpers.sh`

Run `bash scripts/test-dc-helpers.sh` after any behavior change to `plugins/dev-skills/bin/dc-enter` or `plugins/dev-skills/bin/dc-remove`; the hermetic suite builds throwaway repositories under one `mktemp -d` root, never touches this repository, and needs only Bash, git, and coreutils.

### `test-prune-branches.sh`

Run `bash scripts/test-prune-branches.sh` after any change to `prune-branches.sh` in either mirror's `prune-branches` skill folder; the hermetic suite builds throwaway origins and clones under one `mktemp -d` root, drives `gh` and `wt-remove` through fakes, and also holds the two mirrors' copies of the helper to the same bytes.

### `test-address-review-pr-branch.sh`

Run `bash scripts/test-address-review-pr-branch.sh` after any change to `pr-branch.sh` in either mirror's `address-review` skill folder or to `bin/address-review-pr-branch`; the hermetic suite builds a throwaway origin and two clones per case under one `mktemp -d` root, answers `gh pr view` from a fake, and also holds the two mirrors' copies of the helper to the same bytes and to the executable bit. `test-address-review-reconcile.mjs` reads the same helper's source where it used to pin the brief's git recipes.

### `test-rebase-stack.sh`

Run `bash scripts/test-rebase-stack.sh` after any change to `stack.sh` in either mirror's `rebase-stack` skill folder; the hermetic suite builds throwaway branch chains under one `mktemp -d` root, answers the helper's one `gh` question from a fake through real `jq`, carries out the replay the helper names with the real `git rebase`, and also holds the two mirrors' copies to the same bytes and to the executable bit.

### `test-merge-train.sh`

Run `bash scripts/test-merge-train.sh` after any change to `train.sh` in either mirror's `merge-train` skill folder, or to `address-review`'s `pr-branch.sh` or `ci.sh`, which it calls; the hermetic suite answers every `gh` question from canned JSON run through real `jq` with the helper's own programs, runs the rebase and the push against throwaway repositories whose remote is a bare repository behind an `insteadOf` rewrite, and also holds the two mirrors' copies to the same bytes and to the executable bit.

### `test-address-review-ci.sh`

Run `bash scripts/test-address-review-ci.sh` after any change to `ci.sh` in either mirror's `address-review` skill folder; the hermetic suite answers the rollup query from canned GraphQL responses run through the real `jq` with the helper's own `--jq` program, and also holds the two mirrors' copies to the same bytes and to the executable bit.

### `test-address-reviews-targets.sh`

Run `bash scripts/test-address-reviews-targets.sh` after any change to `targets.sh` in either mirror's `address-reviews` skill folder, or to `head` or `pin-base` in `address-review`'s `pr-branch.sh`, which it calls; the hermetic suite answers `gh` from canned JSON through real `jq`, uses real git against a throwaway bare origin, and covers entry classification and pairing, each per-entry skip, stack detection and order, the three kinds of target, `--no-rebase` and `--except`, the batch stops, and `repin`. `TARGETS_HELPER` points it at another copy of the script.

### `test-write-tasks-task-numbers.sh`

Run `bash scripts/test-write-tasks-task-numbers.sh` after any change to `task-numbers.sh` in either mirror's `write-tasks` skill folder, or to `pin-base` in `address-review`'s `pr-branch.sh`, which it calls; the hermetic suite pushes pull request heads to a throwaway bare origin's `refs/pull/<N>/head`, answers the enumeration from canned JSON run through real `jq` with the helper's own `--jq`, and covers claims and relocation pairing, a base that moved or dropped a task since the fork, stacked and unreadable heads, the enumeration bound, run-local members, another task folder, the allocator's `taken` listing, and the sweep's `duplicates` reading of the working tree, which asks GitHub nothing. `TASK_NUMBERS_HELPER` points it at another copy, which must sit beside an `address-review` folder.

### `test-address-review-ping.sh`

Run `bash scripts/test-address-review-ping.sh` after any change to `ping.sh` in either mirror's `address-review` skill folder or to `bin/address-review-ping`; the hermetic suite logs every `gh` call a fake receives, answers the timeline from canned JSON run through real `jq` with the helper's own program, and also holds the two mirrors' copies to the same bytes and to the executable bit.

### `test-address-review-record.sh`

Run `bash scripts/test-address-review-record.sh` after any change to `record.sh` in either mirror's `address-review` skill folder or to `bin/address-review-record`; the hermetic suite keeps a PR's comments in one JSON file behind a fake `gh` that runs the helper's own `--jq` expressions through the real `jq`, and also holds the two mirrors' copies to the same bytes and to the executable bit. `test-address-review-reconcile.mjs` runs the same helper's `render` where it used to compare the skill's wording of a record state with the workflow's record brief, so that suite needs Bash too.

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

Run it after changing the packet hard-check's measuring half too — the independent reading of a fixer's worktree that decides whether the cycle adopts its packet at all, which every one of those gates sits behind — and after changing the peer roster (which providers a round asks, each one's independent stage, and what an absent, unavailable, or broken provider costs the round), the shared peer preflight, the peer prompt's primary `peer-review-run` launch shape or its capability-degradation route (a `passed`/`issues` result with no usable `reviewFile` takes the manual fallback, stated once per run; a reported `model: null` is a strength note and never a trigger), the adaptive throttle's forfeiture-reason mapping, the direct-provider process-identity helpers, or how `wf-review-cycle.js` parses the invoker's grant of the close-out.

It drives the shipped `review-cycle-core` section of both workflows through scripted rounds. Why each check is drawn where it is lives in the script's own comments beside the scenario it governs — including why a parentless HEAD is read as a definitive empty rather than a failed reading, which is what keeps an ordinary depth-1 checkout from refusing every packet, and why a branch named `feature/close-out-ui` grants no close-out.

### `test-subagent-destroy-boundary.mjs`

Run `node scripts/test-subagent-destroy-boundary.mjs` after changing any workflow prompt, any skill brief that tells a subagent where its build or validation output goes, or the `subagent-boundary.md` file that carries the destroy boundary's disposable-clone bullet beside each skill that sends subagents to it.

It renders every brief the three workflows hand a spawned subagent — discovering the set from their own `agent()` call sites — and fails when a render is missing the destroy boundary, when a new prompt builder has no rendered case, when the cut-marker map and the workflows on disk disagree in either direction, when the three out-of-section boundary constants have drifted apart, or when a workflow's deputy copy of the finish-in-turn rule has drifted from the review cycle's, is interpolated without a declaration the check can read, or has stopped existing anywhere in the directory.

Over those same renders it carries task 017's other rule — a brief that orders a build or validation must name a destination for output redirected to a file — and it deletion-guards that rule, which ships as `SKILL.md` prose in both skill mirrors and has nothing to render, alongside the destroy boundary's own disposable-clone bullet, which now ships in a `subagent-boundary.md` file beside each `SKILL.md` that sends subagents to it and which the census reads as part of the brief. A census over every skill in either mirror sorts the shipped clauses into the four categories that reconcile the counts.

It also holds the boundary file itself to the two things that census cannot see: every shipped copy is byte-identical across both mirrors, and a brief names `subagent-boundary.md` exactly when it ships one — neither a brief that names the file without shipping it, nor a file shipped beside a brief that never names it.

Read the prose half as a deletion guard rather than as parity with the rendered checks: a call is syntax, so a new builder is discovered, while a new prose brief that orders a build and names no destination has nothing to be discovered by. The script's header states each check's premise, every accepted miss, and what every empty collection does — including the cases that reported a pass until they were demonstrated.

### `test-unreviewed-close-carriage.mjs`

Run `node scripts/test-unreviewed-close-carriage.mjs` after changing what a review-cycle consumer does with a cycle that concluded without a fresh reviewer seeing the final content — the trivial-round close-out, and the record of a delivery run that failed on the evidenced-unrelated flake disposition — or after changing the per-pass flake history and the packet measurement log that ride the same carriers.

The delivery gate admits a failed delivery run only on the promise that the failures reach the maintainer, so the suite drives the shipped result carriers and PR-body/summary-comment briefs of `wf-address-tasks.js` and `wf-address-review.js` and fails when either drops, stops rendering, or over-claims that record. It also covers the one consumer stage that can falsify part of the record — the pre-PR collision guard's fresh re-review of a renamed branch, which sees the very commit the record says no fresh reviewer saw — on both halves: what it must correct, and what it must leave alone.

Which routes reach the record's no-commit shape, and why the measurement log is named in the refusal message that sends a reader to it, are in the script's own comments.

### `test-address-review-reconcile.mjs`

Run `node scripts/test-address-review-reconcile.mjs` after changing `wf-address-review.js`'s branch-reconciliation gate, working-location rules, delegated rebase points, zero-item exits, publication guard, or disposition record — or the paragraphs of the `address-review`/`address-reviews` skill mirrors that state those same rules in prose, which the suite reads beside the workflow so neither can drift alone. The record and spend briefs are read by carrying out the `address-review-record` command they order against the shipped `record.sh`, so the suite also needs `bash` and `jq`.

It evaluates the shipped script with the runtime globals stubbed and drives scripted packets through it, so the gates are exercised as running code. The prose checks are phrase pins that catch a clause reworded, moved out of its step, or dropped, but cannot hold polarity — a rule reversed around a surviving phrase passes — so polarity stays the reviewer's to hold.

It also covers the two item kinds task 049 carried from the `address-review` skill's step 3 onto the workflow: a `ci-failure` item per lane failing on the reconciled head — identified by its lane, never by the details URL that names one head's run, and disposed of by cause, with `flake-rerun` the one kind only a lane may take and `push-back` and `deferred-to-task` the two it may not — and a bot's findings misfired into a top-level review summary or issue comment as `standalone` items where fresh and applicable, identified by the comment's permalink plus the finding's `N of M` ordinal. Scripted packets carry both kinds through the gather's identity guards and the coverage and publishability gates (a packet gathering one identity twice, or a misfired finding whose ordinal is not the exact `N of M` form, stops at the gather rather than collapsing onto the last item; an entry for one finding covers no other finding sharing its url; a lane keyed twice conflicts; every cross-kind naming — read trimmed on both sides, the way coverage keys it — and every re-run ordered on a lane the head no longer shows failing is rejected, as is `already-addressed` on a lane the head still shows failing; the record carries each misfired finding's text beside its ordinal as a one-line JSON string literal, for the replay's edit check; an accepted flake re-run is recorded per run id, so a later turn orders only the runs still owed, and a lane counts as re-run only where the accepted ids cover every run it names), and the phrases the rules ride on — "CI on the PR head" and "fresh and applicable" among them — are pinned in both skill mirrors beside the workflow's own gather brief, so a reword of either surface alone fails. The rationale for each check, and every measured trade-off behind the accepted misses, lives in the suite's own comments beside the reads they govern, not here.

### `test-skill-worktree-base-exclude.mjs`

Run `node scripts/test-skill-worktree-base-exclude.mjs` after changing how any SKILL.md or workflow brief gets the worktree base ignored, or adding any recipe to `address-reviews` that `cd`s into a path built out of `$WT_BASE` — the suite refuses one that is not guarded against an empty base.

The ignore rule is established by `address-tasks/bootstrap.sh` (task 057), and the recipe's own clauses — the exclude file asked of Git from inside the main checkout, the trailing-slash probe, the second probe and its stop — are behaviour that `test-address-tasks-bootstrap.sh` runs. This suite pins what is left in prose on the five surfaces that used to state the recipe, three skill steps in two hand-edited mirrors each and two workflow briefs: that each step's two mirrors are byte-identical, that each surface orders the script exactly once (the skills by name beside its owner, the workflows through the `address-tasks-bootstrap` shim), and that none of them states a hand recipe beside the call — no `check-ignore` probe, no exclude file named as a path, no append instruction — since a second spelling is how the drift tasks 018a, 047 and 047a repaired began. It also pins the judgement each surface keeps: the two bootstrap steps make a stop a blocker, take the reported base and no other, and say on the line that runs the script that `wt-bootstrap` establishes no ignore rule; `wf-address-tasks.js` says the same, returns a stop as final, and keeps a missing `wt-bootstrap` a stop; and the claim task 047a retired, that the helper "performs the whole Session Bootstrap", stays ABSENT.

Two exclusions are pinned as decisions rather than left to a later audit, each asserted in the direction a later round would actually move it: `address-review`'s step is asserted NOT to make the script's stop a blocker (it attaches all the same and reports, the standing difference from the batch skills), and `declare-shadows` is asserted to name the exclude exactly ONCE, under its framing as a rule source that does not reach teammates. Why each is drawn that way, and why the second is a count rather than a search, is in the script's own comments beside those checks.

### `test-resolve-tasks-contract.mjs`

Run `node scripts/test-resolve-tasks-contract.mjs` after changing `resolve-tasks`, any task consumer's pointer preflight, or `wf-address-tasks`' resolve stage (its exact-plan gate also fails a wave entry closed whose `slug`/`branch` identity is missing or duplicated, rather than letting the pipeline drop it).

### `test-skill-mirror-parity.mjs`

Run `node scripts/test-skill-mirror-parity.mjs` after adding, removing, or editing any `SKILL.md` in either mirror — `plugins/dev-skills/skills/` or `codex/dev-skills/skills/` — or after editing `scripts/skill-mirror-parity-allowlist.json`.

The mirrors are hand-edited in lockstep and legitimately differ in prose, so this suite compares structure only: every skill exists in both trees, the ordered sequence of ATX headings (level and text, fenced blocks excluded) matches, and each shared section holds the same number of ordered-list items and top-level bullets. It replaces the divergence count a PR summary used to recite, which no check ever depended on. A legitimate structural difference is pinned in the allowlist as an exact delta — the skill, the heading, and the one-sided heading or both mirrors' counts — with a one-line harness reason; an unlisted divergence, a divergence that drifted from its entry, and an entry whose divergence has vanished all fail, and a failure names the skill, the heading, the element, and the side. Each entry excuses exactly one divergence, so a pinned one-sided heading duplicated within its mirror fails, and a one-sided section's list items are counted against an empty counterpart, so the heading entry excuses the heading alone and each item beneath it is a delta of its own. The three clause-scoped suites above keep pinning what they pin; this one only notices a whole step, bullet, or section arriving on one side.

### `test-skill-bundled-files.mjs`

Run `node scripts/test-skill-bundled-files.mjs` after adding, renaming, or removing any file beside a `SKILL.md` — a helper script or a brief — in either mirror, after adding a `bin/` shim that forwards into a skill folder, or after naming such a file in a skill or workflow.

A skill folder is copied whole to wherever its harness installs it, so a sentence like "read `reviewer-brief.md`, beside this file" works only when the file is really there, in both mirrors, with the mode the sentence assumes; nothing else fails when one is forgotten. The suite asserts each bundled file is byte-identical across the mirrors, committed `100755` when it is a `*.sh` and `100644` otherwise, and named by its own skill; that every bare `name.sh` or `name.md` a skill or workflow mentions is bundled where the text says it is; that each forwarding shim's target exists; and that a bundled file listed in the suite's `COPIES` is byte-identical to the `bin/` script it copies. A file another skill owns must be introduced once, on a line naming that skill. A script that deliberately lives outside the skill folders goes in the suite's `EXTERNAL` list with the reason, and an entry nothing names any more fails. Adding a bundled file needs no edit to the suite: put it in both mirrors and name it in the `SKILL.md`.

### `test-batch-overlap.mjs`

Run `node scripts/test-batch-overlap.mjs` after changing `wf-address-tasks.js`'s end-of-batch overlap report: the mergeable predicate, the recommended merge order, `overlapPrompt`, `parseOverlapOutput`, `runOverlapCheck`, or the Summary stage and abort catch that place it. It also runs the real `overlap.sh` on a throwaway repository through the `bin/` shim and feeds its output to the parser, so a change to the script's output contract fails here. The workflow builds no review stack: that is an opt-in of the `address-tasks` skill alone.

### `test-address-tasks-overlap.sh`

Run `bash scripts/test-address-tasks-overlap.sh` after any change to `overlap.sh` in either mirror's `address-tasks` skill folder or to `bin/address-tasks-overlap`; the hermetic suite builds a throwaway repository and covers the three outcomes, stacked pairs, two children of one parent, a base that moved between fork points, a branch the base already contains, that no ref, index or working tree is touched, and every refusal. `OVERLAP_HELPER` points it at another copy of the script.

### `test-address-tasks-bootstrap.sh`

Run `bash scripts/test-address-tasks-bootstrap.sh` after any change to `bootstrap.sh` in either mirror's `address-tasks` skill folder, to `bin/address-tasks-bootstrap`, or to the command either workflow's brief gives that shim; the hermetic suite builds throwaway repositories and a PATH of its own, on which `wt-bootstrap`, `findmnt`, `df` and `jq` are present, absent or faked as each case needs. It covers the ignore rule from a primary checkout, a subdirectory and a linked worktree (asking `git check-ignore` from all three afterwards), a rule already tracked with no directory on disk, an exclude file with no final newline or no `info/` directory, a tracked negation that keeps the base un-ignored, the plain-git path's leftovers, remote probe, free space and host-share report (never a stop), a repository entered through a symlink, the translation of every `wt-bootstrap` answer including the ones that break its contract, that nothing is written on a stop reached before the rule, and that neither a tracked `.gitignore` nor the user's git configuration is touched. It also runs each `address-tasks-bootstrap` command the two workflows name, as written. `BOOTSTRAP_HELPER` points it at another copy of the script.

### `test-pipelined-batch.mjs`

Run `node scripts/test-pipelined-batch.mjs` after changing the batch workflow's per-task pipeline (task 033): how a task waits for its prerequisites, the serialized first-ready-wins guard and the reservation it holds through delivery, the rebase onto a base a merged sibling advanced (chased through merged ancestors, and adopted only with its recovery proof), the storage-derived slot gate and the slot a worktree left in place keeps (a reclaim waits for the task's settled, delivered state — which releases the task's dependents before the reclaim, a merge observed mid-reclaim still landing on the result), the numbers a held branch's result names, the in-pipeline reconciliation of pushed branches left without a PR and the PR body its retry carries, or the terminal-state census the summary reads.

It drives the shipped pipeline with scripted agents, some deferred so the suite can observe order rather than only outcomes. A live multi-task workflow run is outside what a script can do; what it establishes, and the perturbations it was checked against, are in `plugins/dev-skills/workflows/README.md`'s Validation section.

### `check-bash32-syntax.sh`

Run `podman run --rm -v "$PWD":/w:ro -w /w docker.io/library/bash:3.2 bash scripts/check-bash32-syntax.sh --require 3.2` (or the same with `docker`) after any change to a `*.sh` in a skill folder of either mirror or to a file in `plugins/dev-skills/bin/`. It is a parse check, not a suite: `bash -n` on every bundled helper and shim, which it finds by glob, under the bash that runs it. bash 3.2's `-n` does not parse the body of a double-quoted `"$(...)"`, so an unparenthesised `case` pattern there passes the check and fails only when run: parenthesise patterns inside substitutions. Run plainly as `bash scripts/check-bash32-syntax.sh` it reports the version it used and establishes nothing about bash 3.2 unless that is the bash on hand; `--require 3.2` turns any other version into a failure. CI runs it as its own `bash32` job, and runs no suite under bash 3.2.

### Dynamic workflow parse check

Parse-check any changed dynamic workflow under `plugins/dev-skills/workflows/`. That check is not a `scripts/` suite: the command, and what a pass does and does not establish, live in `plugins/dev-skills/workflows/README.md`'s Validation section rather than here.

## Consumers

| Consumer | Channel |
| --------------------------------- | ----------------------------------------------------------------------- |
| Claude Code users (any machine) | plugin install from this marketplace |
| powbox containers (Claude) | same plugin channel, pre-installed at image build |
| powbox containers (Codex) | `codex/` tree synced at start from the marketplace clone |

The `enable-worktrees`, `declare-shadows`, and `session-learnings` skills intentionally describe powbox facilities but live here so both harness flavors refresh through the shared plugin channel. Container implementation details such as helper binaries, mount setup, and skill-sync machinery remain in the `Roubtec/powbox` repo.

**`dc-enter` and `dc-remove` are a precondition of these skills, not a branch inside them, and this is the one place that says so.** Wherever a skill or workflow in either tree names the disposable clone — seven skills per mirror, and the five boundary constants the three workflows declare — it names it unconditionally; none carries a no-helper fallback any more, because a fallback is a second destination and the whole point of the rule is that there is only one. All three consumers above are covered without anyone doing anything: Claude's plugin runtime puts `plugins/dev-skills/bin/` on PATH on any machine, and powbox bakes both helpers from that same directory into `/usr/local/bin` alongside `gh-review-threads`, which covers its Codex containers too. A fourth population the table does not list — a Codex session off powbox, or one on an image built before that bake — installs them itself with the command the `codex/` section under Layout gives; it is absent from the table because the table is keyed on distribution channel, and that population has none. Where that step was skipped, a run stops rather than degrades: `DC="$(dc-enter <slug>)"` yields nothing, and the guarded `cd -- "${DC:?…}"` every brief carries aborts before the first command that writes — never a hand-rolled path outside the repository, which is what the retired fallback used to license. The remedy is stated twice because neither placement covers both cases: the brief names it at the invocation, which is the half that survives `set -e` (an absent helper exits the assignment 127, so the shell dies before the `cd` expands anything), and the stop's own message repeats it for a run that got that far. That message points at the error `dc-enter` printed rather than asserting absence, because absence is not its commonest cause — the helper refusing a reused slug exits non-zero with empty stdout too, and there it is installed and its own stderr already names the fix. Both are pointers rather than second copies of the step: the command that installs the helpers is written once, in the `codex/` section under Layout.

## GitHub Automation

This repo runs focused tests and Claude automation against its own PRs via three workflows in `.github/workflows/`. The two Claude workflows require a `CLAUDE_CODE_OAUTH_TOKEN` repo secret.

- **`tests.yml`** — runs the regression suites in `scripts/` (see Focused tests above for what each one covers) on every PR.
- **`claude.yml`** — a mention bot. Comment `@claude ...` on an issue or PR (or in a PR review) to summon it; only OWNER/MEMBER/COLLABORATOR authors can trigger it, since the job runs with write permissions.
- **`claude-code-review.yml`** — runs Anthropic's `code-review` plugin automatically when a PR is opened (or reopened / marked ready for review) and posts inline review comments; later pushes are not auto-reviewed — ask for a re-review with an `@claude` mention. Skipped on PRs from forks, which don't receive the secret.
