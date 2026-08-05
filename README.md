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
  test-review-cycle-retirement.mjs      # behavior coverage for the review cycle's open-question retirement lifecycle
  verify-014-peer-strength-pin.md       # harness-neutral prompt: observe the peer step's pinned review strength (task 014)
```

- **`plugins/`** holds the Claude Code plugins. Each subdirectory is one independently installable plugin; `dev-skills` carries cross-repo software development skills including the shared `review-cycle` building block (the canonical fix → fresh-eyes review → best-effort cross-harness peer review → fix protocol the other skills reference), safe post-batch local branch cleanup, the `enable-worktrees` and `declare-shadows` repository setup skills, the `session-learnings` retrospective skill, and Claude dynamic workflows for review addressing, planned task batches, and the review cycle itself. Its `bin/` executables are available on the Bash tool's PATH while the plugin is enabled. Additional plugins for other domains get sibling directories here and an entry in `marketplace.json`.
- **`plugins/dev-skills/bin/dc-enter` and `dc-remove`** give empirical verification somewhere safe to happen. `dc-enter <slug> [<ref>]` prints the absolute path of a disposable clone of the invoking repository — a real clone, so deleting refs, committing, rewriting history, or running `gc` inside it cannot reach the repository you are working in — and `dc-remove <slug>` drops it however wrecked it is, while being unable to reach anything it did not create. A worktree is not a substitute: it isolates the working tree but shares `.git`, so `branch -f`, `reset`, `update-ref`, and `gc` all reach every sibling worktree. Powbox points the clones outside `/workspace` by setting `DC_ROOT`; elsewhere they land under `$TMPDIR`.
- **`codex/`** mirrors the plugin tree with the Codex CLI flavors of the same skills. The two flavors share most of their text but diverge deliberately where harness capabilities differ; a verbiage change is one PR touching both files side by side. Each Codex skill includes its `agents/openai.yaml` UI metadata. This tree is *not* installed by Claude's plugin runtime; powbox refreshes it onto the Codex config volume at container start from the same marketplace clone. Because that tree carries no `bin/`, a Codex user not on powbox puts the disposable-clone helpers on their own PATH themselves: `install -m 755 plugins/dev-skills/bin/dc-enter plugins/dev-skills/bin/dc-remove ~/.local/bin/`. Skipping that leaves any guidance that looks for `dc-enter` with `command -v` on its no-helper fallback for good, since nothing else installs them on that side.

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

## Focused tests

Run `bash scripts/test-gh-review-threads.sh` after any behavior change to `plugins/dev-skills/bin/gh-review-threads`; the hermetic suite stubs `gh` and needs only Bash and `jq`.

Run `bash scripts/test-dc-helpers.sh` after any behavior change to `plugins/dev-skills/bin/dc-enter` or `plugins/dev-skills/bin/dc-remove`; the hermetic suite builds throwaway repositories under one `mktemp -d` root, never touches this repository, and needs only Bash, git, and coreutils.

Run `node scripts/test-checkout-cleanliness-report.mjs` after changing the batch workflow's checkout-report behavior.

Run `node scripts/test-review-cycle-retirement.mjs` after changing how the review cycle raises, retires, or serves open questions; it drives the shipped `review-cycle-core` section of both workflows through scripted rounds.

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

- **`tests.yml`** — runs four regression suites on every PR: the hermetic `gh-review-threads` and disposable-clone helper suites, the checkout-cleanliness report test, and the review-cycle open-question retirement lifecycle test.
- **`claude.yml`** — a mention bot. Comment `@claude ...` on an issue or PR (or in a PR review) to summon it; only OWNER/MEMBER/COLLABORATOR authors can trigger it, since the job runs with write permissions.
- **`claude-code-review.yml`** — runs Anthropic's `code-review` plugin automatically when a PR is opened (or reopened / marked ready for review) and posts inline review comments; later pushes are not auto-reviewed — ask for a re-review with an `@claude` mention. Skipped on PRs from forks, which don't receive the secret.
