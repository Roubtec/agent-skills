# Claude Instructions

[AGENTS.md](AGENTS.md):

@AGENTS.md

## Code Review Format Guidelines

- Post each finding as a separate **inline comment** anchored to the exact file and line it concerns — one comment per issue, so each becomes its own independently resolvable thread. Do NOT fold all findings into a single monolithic comment.
- Prefix each inline comment with a severity marker so its weight is obvious at a glance: "⚠️ Bug", "🔒 Security", "💡 Suggestion", or "nit:".
- Keep the final summary as an overview: briefly describe what the PR does, list the count of findings by category, and call out any cross-cutting or systemic issues that don't belong on a single line. Do NOT repeat the per-line findings there — they live in the inline threads.
- Use any existing comments for context, and don't re-raise findings already made.
