# A Repository of Agent Skills

Roubtec's shared agent skills, distributed as a [Claude Code plugin marketplace](https://code.claude.com/docs/en/plugin-marketplaces). This repo is the single home for every skill flavor; each AI harness consumes it through its own channel.

## Layout

```
.claude-plugin/marketplace.json   # the marketplace manifest (marketplace name: roubtec — "agent-skills" is CLI-reserved for anthropics repos)
plugins/
  dev-skills/                     # Claude Code plugin: software development workflow skills
    .claude-plugin/plugin.json
    bin/gh-review-threads          # hardened review-thread helper added to the plugin PATH
    skills/<name>/SKILL.md
    workflows/wf-*.js              # Claude dynamic workflows
codex/
  dev-skills/                     # Codex flavors of the same skills (SKILL.md + agents/openai.yaml)
    skills/<name>/...
scripts/
  test-checkout-cleanliness-report.mjs  # regression coverage for the batch workflow's checkout report
```

- **`plugins/`** holds the Claude Code plugins. Each subdirectory is one independently installable plugin; `dev-skills` carries cross-repo software development skills including safe post-batch local branch cleanup, the `enable-worktrees` repository setup skill, the `session-learnings` retrospective skill, and Claude dynamic workflows for review addressing and planned task batches. Its `bin/` executables are available on the Bash tool's PATH while the plugin is enabled. Additional plugins for other domains get sibling directories here and an entry in `marketplace.json`.
- **`codex/`** mirrors the plugin tree with the Codex CLI flavors of the same skills. The two flavors share most of their text but diverge deliberately where harness capabilities differ; a verbiage change is one PR touching both files side by side. Each Codex skill includes its `agents/openai.yaml` UI metadata. This tree is *not* installed by Claude's plugin runtime; powbox refreshes it onto the Codex config volume at container start from the same marketplace clone.

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

## Contributing

Changes land through PRs, and every merge is a real merge commit: the repo enables merge commits only, with both *Squash and merge* and *Rebase and merge* disabled, so each branch's commits survive intact. What the repo does *not* enforce is that a PR be up to date with the latest `main` before merging, so we rebase each PR onto `main` ourselves and then merge — that convention, not a setting, is what keeps the history linear and each branch's commits readable in order.

Open PRs ready for review rather than as drafts. Agents in particular tend to open drafts conservatively, and here a draft only withholds the automated review round the PR would otherwise trigger; mark one as draft when withholding is the actual intent, not by default.

## Consumers

| Consumer                        | Channel                                                               |
|---------------------------------|-----------------------------------------------------------------------|
| Claude Code users (any machine) | plugin install from this marketplace                                  |
| powbox containers (Claude)      | same plugin channel, pre-installed at image build                     |
| powbox containers (Codex)       | `codex/` tree synced at start from the marketplace clone              |

The `enable-worktrees` and `session-learnings` skills intentionally describe powbox facilities but live here so both harness flavors refresh through the shared plugin channel. Container implementation details such as helper binaries, mount setup, and skill-sync machinery remain in the `Roubtec/powbox` repo.

## GitHub Automation

This repo runs Claude directly against its own PRs via two workflows in `.github/workflows/`. Both require a `CLAUDE_CODE_OAUTH_TOKEN` repo secret.

- **`claude.yml`** — a mention bot. Comment `@claude ...` on an issue or PR (or in a PR review) to summon it; only OWNER/MEMBER/COLLABORATOR authors can trigger it, since the job runs with write permissions.
- **`claude-code-review.yml`** — runs Anthropic's `code-review` plugin automatically when a PR is opened (or reopened / marked ready for review) and posts inline review comments; later pushes are not auto-reviewed — ask for a re-review with an `@claude` mention. Skipped on PRs from forks, which don't receive the secret.
