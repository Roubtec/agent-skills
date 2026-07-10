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
