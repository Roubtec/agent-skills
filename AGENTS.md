# Agent Instructions

## Documentation Practices

Update [README.md](README.md) if there are any changes to the project overview, tech stack, or development practices.

Use one line per paragraph in Markdown if possible. Do not pre-wrap lines in commit messages. (Do not dwell on or point out existing line wrapping transgression in reviews, just follow the rules going forward.)

Task specifications on which many PRs are based live in [`tasks/`](./tasks/).

How we open and merge PRs is a development practice like any other, so it lives in [README.md](README.md#contributing) rather than here — read it before opening or merging one.

## Code Review Guidelines

Before doing a code review, read ALL existing review comments and threads on the PR for context before making suggestions. Findings previously delegated to follow-up work need not be re-raised unless the facts changed since the delegation.

Calibrate findings against the helpers to [README.md's safety posture](README.md#safety-posture): these are accident guardrails, not a security boundary. Weight a finding by whether an ordinary run can reach it, and prefer a fix that deletes complexity over one that adds a case.

## When Asked to Address Review Comments

- Read ALL existing review comments and threads on the PR for context before making changes.
- Resolve each review comment thread after addressing it (unless there are still open questions).
- If a review comment is unclear, leave a reply asking for clarification rather than guessing.
- If you find any other issues or gaps that should be fixed, commit an extra fixup commit that is separate from the main changes (if practical) to address them. This helps reviewers see the scope clearly and gives you a chance to explain the extra fixes in the commit message.
