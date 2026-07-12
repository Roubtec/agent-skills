# GitHub Review Output Contract

- Post each finding with `mcp__github_inline_comment__create_inline_comment`, anchored to the exact file and line it concerns — one comment per issue, so each finding becomes its own independently resolvable thread. Do not fold multiple findings into one comment.
- Prefix each inline comment with a severity marker so its weight is obvious at a glance: "⚠️ Bug", "🔒 Security", "💡 Suggestion", or "nit:".
- Keep the final response that becomes the top-level PR comment to an overview: briefly describe the PR, count findings by category, and call out cross-cutting issues that do not belong on one line. Do not repeat the inline findings there.
- Use existing comments for context and do not re-raise findings already made.
