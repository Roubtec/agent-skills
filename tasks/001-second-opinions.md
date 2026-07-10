# 001 - Best-Effort Second Opinions for Implementation Work

my current workflow involves (same for the Claude and Codex counterpart, to the extent their respective harnesses afford):
0. writing a plan in iterations with agentic help, however that comes about.
1. writing tasks using @plugins/dev-skills/skills/write-tasks/SKILL.md usually based on a bigger plan (or individual tasks if needed)
2. addressing any loose ends in the tasks using @plugins/dev-skills/skills/resolve-open-questions/SKILL.md
3. addressing the tasks, usually in parallel, using @codex/dev-skills/skills/address-tasks/SKILL.md (or the serialized counterpart).
4. observing the automated & human reviews for any PRs that come out of "address-tasks" delivered work
5. running @codex/dev-skills/skills/address-reviews/SKILL.md or the singular version to deal with review feedback and deliver fixes & responses to any review comments.
6. after reviews have been addressed, we often invoke the continuation mode of "resolve-open-questions" to answer any requests for feedback/direction/approval and to tweak any follow-up tasks (sometimes referred to as "deferred") that may have been filed as a response to a review comment (if an edge-case fix would bloat the scope of the current PR, for example).

once the reviews no longer surface material findings, we usually merge.

please help me find opportunities to streamline / simplify / automate this process somewhat. we still want to have some interactive opportunities within the review/fix/review process.

my first idea is to leverage that both agent harnesses (Claude _and_ Codex) are often installed in the environment. (note that this is not guaranteed since these skills are supposed to be applicable generically.) "address-tasks" already has the work of an isolated implementer sub-agent reviewed by an independent reviewer sub-agent, which has proven effective. if we found that there is the other harness available, we could call it via the CLI to review the work instead of a sub-agent (or better - in parallel with a sub-agent) to get the most "second opinions" during the initial development locally. incorporating the strengths of both agents more systematically, we might be able to reduce the churn once the PR is opened.

if the other agent fails to respond (e.g. it is not even installed), we can forfeit its opinion and continue with own feedback only as currently happens. if it responds with "usage exceeded"- or "missing login"-type feedback, same applies. if it has a transient error, we can retry once or twice before giving up. this is a best-effort attempt at solidifying code before even opening a PR during "address-tasks".

the same could apply to "address-reviews" as well, where we could seek a best-effort second opinion from the other agent harness before responding to review comments. "resolve-open-questions" could also benefit from this approach if it needs to implement any of the resolutions.

the Codex agent already leverages `claude -p` heavily on its own. i would like to examine whether the Claude agent could also leverage the `codex` executable in a similar way, and if so, how to do it. if we can get both agents to leverage each other in a best-effort manner, we might be able to reduce the number of iterations needed to get a PR ready for merge.

i don't know whether the CLI access for "claude" or "codex" can directly request a particular model + effort combo, maybe that's something that we should consider based on the user's wishes.

is it plausible that a single-prompt cross agent invocation gives enough room to request a thorough review and receive the verdict & findings?

---

## Solidified findings (verified in-container, 2026-07-10)

The open questions above were answered empirically against the shipped CLIs (codex logged in via ChatGPT; claude). Verdict: **viable — proceed with implementation.**

### Can Claude leverage `codex` the way Codex leverages `claude -p`? — Yes

`codex exec` is the symmetric counterpart to `claude -p`: a single invocation runs a **full agentic loop** (repo exploration, file reads, shell), not a one-completion answer. Verified working:

- `codex exec --sandbox read-only -o <file> "<prompt>"` — exit 0, final message written to `<file>` (stdout carries the event stream). `--sandbox read-only` is the right posture for a reviewer: it reads the worktree but cannot mutate it.
- `codex review --base <branch>` — a **purpose-built non-interactive review subcommand**: reviews the current checkout's diff against the base and prints verdict/findings as the final message (exit 0, verified live on this branch). Caveats: `--base` and a custom prompt are **mutually exclusive** (hard error, exit 2), and it reviews the repo at the current working directory, so run it from inside the task's worktree. `--uncommitted` and `--commit <sha>` variants exist.
- `codex exec --output-schema <schema.json>` forces the final message into a JSON Schema, so the orchestrator can demand `{verdict, findings[]}` and parse mechanically; `--json` (JSONL events) and `--cd <worktree>` / `--ephemeral` also exist.

### Failure modes — all detectable, matching the best-effort design

- not installed → `command -v codex` fails.
- not logged in → `codex login status` exits 1 ("Not logged in"). This preflight matters: an unauthenticated `codex exec` retries for ~30s before exiting 1.
- transient/API errors → non-zero exit; retry once or twice, then forfeit the opinion.

### Model + effort per invocation — Yes, both directions

- `codex exec -m <model> -c model_reasoning_effort=<level>` (defaults come from `~/.codex/config.toml`).
- `claude -p --model <alias|full-name> --effort <low|medium|high|xhigh|max>`, plus `--output-format json` / `--json-schema <schema>` for structured verdicts.

Recommendation: default to the peer's own configured defaults; expose an optional model/effort knob in the skill arguments rather than hardcoding.

### Is a single prompt enough for a thorough review? — Yes

Because the invocation is agentic, the prompt only needs to carry **scope** (worktree path, base branch or commit range) and the **output contract** (verdict + numbered findings) — not the diff itself. Verified live: `codex review --base main` on this branch performed a real review pass and returned a coherent verdict as its final message.

### Design decisions to carry into implementation

1. **Skills stay generic and self-sufficient**: detection, login preflight, invocation, and forfeit/retry logic live in the skills — peer availability is never guaranteed.
2. **Run the cross-agent reviewer in parallel with the reviewer sub-agent** (the "or better" option above): the peer call is just a shell command the orchestrator can run in the background during Phase B, so both opinions land in the same fix round with no extra round-trips.
3. **The peer opinion augments but never gates**: merge its findings into the fix round, but keep the own-harness reviewer as the pass/fail gatekeeper, so peer flakiness can never wedge a batch.
4. **Read-only posture for review invocations** (`--sandbox read-only` for codex; `claude -p` is naturally read-only without granted permissions).
5. Insertion points: `address-tasks` / `address-tasks-serialized` review phase, `address-review`'s fresh-eyes verification, and `resolve-open-questions` when it implements resolutions.

### Powbox complement (done)

Powbox's container guidance now advertises each peer's one-shot form and the best-effort semantics — see https://github.com/Roubtec/powbox/pull/98. This helps ad-hoc in-container delegation, but the skills must not depend on it.
