# 072 — `session-learnings`: name each issue's target, and consult a known-limitations document

## Why this task exists

A `session-learnings` report is written to be read later, usually together with many others.
Two things make that later reading slower than it needs to be:

- **Nothing says where an issue belongs.** One report mixes friction caused by the container environment, by a skill, by the project's own tooling and by the harness. Whoever reads a stack of reports has to work out, entry by entry, who could act on it, although the agent that wrote the entry usually knew.
- **Accepted limitations are reported again every time.** Some friction is known and deliberately left alone: a harness behaviour nobody here can change, a trade-off already decided. Each session meets it fresh and files it again, and each reader re-reads and re-dismisses it.

Both are cheap to improve at the moment of writing, when the context is at hand.

**Two conditions from the maintainer shape this task.**
The skill must not become coupled to any one environment: it discovers a known-limitations document where one exists at a conventional place, and behaves exactly as it does today where none does.
And the pre-sorting is advisory: a reporting agent has limited context, so a later reader still applies their own judgement to every item.

## Scope

Included:

- **A `Target:` line in each issue of the report**, naming where a fix would land, filled in where that is easy to determine and marked unknown where it is not.
- **A discovery convention for known-limitations documents**, defined in the skill: where it looks, in what order, and what minimal shape it expects of what it finds.
- **A step, taken only when a report is about to be written**, that reads whatever the convention finds and compares the run's issues against it.
- **A line in the report** saying which issues were left out as already-known, so the omission can be audited.
- Both mirrors.

Out of scope:

- Writing any known-limitations document. An environment or a project that wants one provides it by following the convention; that is its own repository's work.
- Anything specific to one environment's layout: no path, variable or file that only one container image has may be the only way the skill finds a document.
- The transport half of the skill (ferry and local modes, worktree handling), and the report's other fields.
- A tool that reads many reports at once.

## Context and references

- `plugins/dev-skills/skills/session-learnings/SKILL.md` and its Codex mirror, which differ only in the agent's name: "Scope" for the kinds of friction a report holds, step 2 ("Filter for actionability") and step 6 ("Write the report") with its issue template.
- `scripts/test-skill-mirror-parity.mjs` holds the two mirrors' structure together.

## Target files or areas

`plugins/dev-skills/skills/session-learnings/SKILL.md`, `codex/dev-skills/skills/session-learnings/SKILL.md`, `README.md` if it should name the convention for anyone providing a document.

## Implementation notes

- **Design the convention so that any provider can meet it without this skill knowing the provider.** An environment-level document and a project-level one can both exist, and the skill reads every one it finds. A variable that names a file, and a conventional file name looked for in a small number of stated places, are the obvious shapes; choose, and write the convention down once in the skill so a provider can read it there. Name the convention, not any provider's internals.
- **The document's expected shape is minimal**: Markdown, one short titled entry per limitation, enough words to recognise the friction when met again. The skill must cope with a document that is richer than that, and must not fail on one that is malformed; an unreadable document is treated as absent and mentioned in the final report to the user.
- **Absence is silent in the artifact.** With no document found, the report is what it is today plus the `Target:` lines. Do not add a section saying nothing was found.
- **Matching is a judgement, and the default is to report.** An issue is left out only when it plainly is a recorded limitation and the run adds nothing: no new trigger, no higher cost, no workaround worth recording. Where the run does add something, the issue stays and cites the entry it relates to. Where the agent is unsure, the issue stays.
- **Left-out issues are listed by the entry they matched**, in one line, so a reader can see what was dropped and disagree.
- **`Target:` uses a small closed vocabulary** that does not presume a particular environment, along the lines of the environment or container, the skills, the project, an upstream tool with its name, or unknown. Say in a clause that it is the reporting agent's best reading and binds nobody. An issue that spans two targets names both.
- Read the documents after step 2 has filtered the run's issues and before the report is written, and not at all when there is nothing to report: the read costs context, and it is only worth paying when a report is going to exist.
- The skill follows the one-sentence-per-line rule for `SKILL.md` files, and it is short; keep the addition to a step and a template line, not a new section of rules.

## Acceptance criteria

- Every issue in a report written by the skill carries a `Target:` line from the stated vocabulary.
- In a setting with no known-limitations document, the skill runs to completion and its report differs from today's only by those lines.
- With a document present at a place the convention names, an issue that plainly matches an entry is left out and listed as such, and an issue that matches but brings new evidence is kept with the entry cited.
- The convention is stated in the skill in one place, mentions no single environment's layout as the only route, and is enough for someone else to provide a document that will be found.
- The two mirrors still differ only in the agent's name, and the full test set passes.

## Validation

- Run every suite `tests.yml` runs and the Markdown lint.
- Run the skill in local mode three times in a scratch repository: with no document, with a document holding an entry the run's friction matches, and with a malformed document; attach the three reports' issue sections to the pull request.

## Review plan

Read the added step as an agent in an environment the author never saw, and check it neither fails nor guesses there; then check that nothing in it lets a reporting agent drop an issue on a loose resemblance.
