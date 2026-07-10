# Agent Instructions

## Documentation Practices

Update [README.md](README.md) if there are any changes to the project overview, tech stack, or development practices.

Use one line per paragraph in Markdown if possible.

Do not pre-wrap lines in commit messages.

Task specifications on which many PRs are based live in [`tasks/`](./tasks/).

## Code Review Guidelines

Before doing a code review, read ALL existing review comments and threads on the PR for context before making suggestions. Findings previously delegated to follow-up work need not be re-raised unless the facts changed since the delegation.

## When Asked to Address Review Comments

- Read ALL existing review comments and threads on the PR for context before making changes.
- Resolve each review comment thread after addressing it (unless there are still open questions).
- If a review comment is unclear, leave a reply asking for clarification rather than guessing.
- If you find any other issues or gaps that should be fixed, commit an extra fixup commit that is separate from the main changes (if practical) to address them. This helps reviewers see the scope clearly and gives you a chance to explain the extra fixes in the commit message.
