# agent-skills

Roubtec's shared agent skills, distributed as a [Claude Code plugin
marketplace](https://code.claude.com/docs/en/plugin-marketplaces). This repo is
the single home for every skill flavor; each AI harness consumes it through its
own channel.

## Layout

```
.claude-plugin/marketplace.json   # the marketplace manifest (marketplace name: roubtec — "agent-skills" is CLI-reserved for anthropics repos)
plugins/
  dev-skills/                     # Claude Code plugin: software development workflow skills
    .claude-plugin/plugin.json
    bin/gh-review-threads          # hardened review-thread helper added to the plugin PATH
    skills/<name>/SKILL.md
codex/
  dev-skills/                     # Codex flavors of the same skills (SKILL.md + agents/openai.yaml)
    skills/<name>/...
```

- **`plugins/`** holds the Claude Code plugins. Each subdirectory is one independently installable plugin; `dev-skills` is the first (cross-repo software development workflow: planned task batches, review addressing, stacked-PR maintenance, open-question resolution, task authoring), and its `bin/` executables are available on the Bash tool's PATH while the plugin is enabled. Additional plugins for other domains get sibling directories here and an entry in `marketplace.json`.
- **`codex/`** mirrors the plugin tree with the Codex CLI flavors of the same
  skills. The two flavors share most of their text but diverge deliberately
  where harness capabilities differ; a verbiage change is one PR touching both
  files side by side. This tree is *not* distributed through the marketplace —
  powbox bakes it into its agent image and seeds it onto the Codex config
  volume.

## Installing (Claude Code users)

```
claude plugin marketplace add Roubtec/agent-skills
claude plugin install dev-skills@roubtec
```

Or from within Claude Code: `/plugin` → search for the `roubtec`
marketplace. Skills then appear namespaced, e.g. `/dev-skills:address-review`.

Repos that use these skills carry a pointer in `.claude/settings.json` so
collaborators are prompted to install on first trust:

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

Merging to `main` **is** the release: the plugin manifests intentionally carry
no `version` field, so Claude Code versions installs by git commit SHA and
every merged commit is picked up as an update. Only curated (PR → review →
merge) changes propagate.

To stay current, either enable auto-update for this marketplace (`/plugin` →
Marketplaces → `roubtec` → Enable auto-update; updates apply at session
start) or refresh manually:

```
claude plugin marketplace update roubtec
```

## Consumers

| Consumer                        | Channel                                                               |
|---------------------------------|-----------------------------------------------------------------------|
| Claude Code users (any machine) | plugin install from this marketplace                                  |
| powbox containers (Claude)      | same plugin channel, pre-installed at image build                     |
| powbox containers (Codex)       | `codex/` tree baked into the image, seeded to the Codex config volume |

powbox-*specific* skills (those that only make sense inside its sandbox) do not
live here — they remain in the `Roubtec/powbox` repo and reach containers through its
image-bake + seed mechanism.

## GitHub automation

This repo runs Claude directly against its own PRs via two workflows in `.github/workflows/`.
Both require a `CLAUDE_CODE_OAUTH_TOKEN` repo secret.

- **`claude.yml`** — a mention bot. Comment `@claude ...` on an issue or PR (or in a PR review) to summon it; only OWNER/MEMBER/COLLABORATOR authors can trigger it, since the job runs with write permissions.
- **`claude-code-review.yml`** — runs Anthropic's `code-review` plugin automatically when a PR is opened (or reopened / marked ready for review) and posts inline review comments; later pushes are not auto-reviewed — ask for a re-review with an `@claude` mention. Skipped on PRs from forks, which don't receive the secret.
