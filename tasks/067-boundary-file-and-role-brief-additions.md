# 067 — Add the missing lines to the boundary file and the role briefs

## Why this task exists

Orchestrators keep patching the same gaps into the prompts they write.
A run notices a subagent doing something it should not, adds a sentence to later prompts, and the sentence is gone with the session, so the next run rediscovers it.
The durable home for such a sentence is a file the role itself reads: `subagent-boundary.md`, which every spawned role reads first, and the role briefs in `review-cycle/`.
Those files cost the orchestrator's context nothing, which is the whole reason they exist.

**That placement is the point of this task.**
None of the lines below belongs in a `SKILL.md` the orchestrator loads. Where an orchestrator-facing summary has to stay true (the sentence in `review-cycle/SKILL.md` listing the rules every role is held to), adjust a word; do not restate the rule.

Each item below is backed by something that went wrong in a real run, most of them more than once.

## Scope

Included, in `subagent-boundary.md`:

- **Path-level discards.** The forbidden list names the tree-wide destroyers but not `git checkout -- <path>`, `git restore` and a bare `git stash`, which have thrown away uncommitted work more than once, including after `fixer-brief.md` gained its narrower sentence about `git restore`.
- **No system package installs.** The container is shared by every agent in the session; a role that installs or upgrades a system or global package changes it for all of them. It reports the need instead.
- **A role's own probe directory.** `rm -rf` is forbidden "not in a temp directory", so a role that made a scratch directory has no sanctioned way to remove it. Give it one, narrow enough not to reopen the door.
- **Stopping a process.** A role stops only a process whose PID it recorded when it started it, never one found by name or pattern.

Included, in the role briefs:

- **`fixer-brief.md`: no pull-request writes.** An implementer or fixer does not open, edit, mark ready or comment on a pull request unless its prompt spells that out; publication is the orchestrator's.
- **`fixer-brief.md`: no review of your own.** The brief bans launching a peer review. Spawning a reviewer subagent of one's own, and applying a private round cap to it, is the same thing by another route and has happened.
- **`fixer-brief.md`: your own sub-agents report to you.** A role that spawns helpers briefs them to return to it and collects them before it returns; a helper has reached the top-level session directly.
- **`fixer-brief.md` and `reviewer-brief.md`: a long suite runs in the foreground with an explicit timeout.** The lifecycle paragraph says to bound and wait on anything started, yet a suite longer than the default tool timeout is still routinely backgrounded and the turn ended. Name the case.
- **`rebase-brief.md`: the same lifecycle paragraph**, which the rebaser's brief lacks entirely.
- **Sweeps, in both `fixer-brief.md` and `reviewer-brief.md`.** The space a sweep enumerates comes from at least two independent patterns, is reported as a floor, and includes the branch's own diff as well as matches on the subject.

Included, elsewhere:

- **The workflow renders** of the boundary and of these brief rules, which are constants in the workflow sources.
- **The Codex mirror's "How to spawn a subagent in Codex" paragraph** and its copies in the other Codex skills. It orders `worker` and `explorer` roles and a close step; make it match the interface Codex actually exposes, including what to do where a spawn takes no role or offers no close operation.

Out of scope:

- The disposable-clone rules, the perturbation helper (task 065), and anything about the peer launch (task 066).
- Orchestrator-side rules such as addressing worktrees with `-C`.
- A tool-restricted reviewer agent type.

## Context and references

- `plugins/dev-skills/skills/review-cycle/subagent-boundary.md`. The same file sits in every skill folder that spawns a role, in both mirrors, and all copies are byte-identical; find them by name.
- The boundary line each spawning `SKILL.md` opens a subagent prompt with ("Before your first command, read … it binds you. Whatever else you read, never run …"), and the boundary constants in the workflow sources.
- `scripts/test-subagent-destroy-boundary.mjs` renders every workflow prompt, checks the boundary's content clause by clause, and deletion-guards rules in the skill mirrors; its header explains what is pinned and why. `scripts/test-skill-bundled-files.mjs` holds the copies identical across mirrors, and `scripts/test-skill-mirror-parity.mjs` holds the mirrors' structure together.
- `review-cycle/fixer-brief.md`, `reviewer-brief.md` and `rebase-brief.md`: "Finish inside your own turn, and reap what you start", "A sweep is enumerated, never asserted" and its Reviewer counterpart.
- The Codex mirrors of `address-tasks-serialized`, `address-tasks`, `address-review`, `address-reviews` and `review-cycle`; grep for `worker` and `explorer`.

## Target files or areas

Every `subagent-boundary.md` in both mirrors, the three brief files in `review-cycle/` in both mirrors, the Codex `SKILL.md` files that carry the spawn paragraph, the workflow sources where they render these rules, the three suites above, and `README.md` only if it describes a changed rule.

## Implementation notes

- **Write each addition as one line where an existing sentence can take it.** Extend the lifecycle paragraph and the sweep sentence in place. The briefs are read in full by every role every round, so their length is a cost too.
- **Path-level discards have a legitimate use**, restoring a committed file after a control, which the fixer's brief already bounds: after the commit, never on a file holding uncommitted edits. Word the boundary so that use survives and what is forbidden is discarding uncommitted work, yours or anyone else's. Task 065's helper restores without any of these commands and is the route to name if it has landed.
- **The probe-directory exemption is exact.** It covers a directory the role itself created this turn with `mktemp -d` under the destination its prompt named, removed by the path `mktemp` printed, held in a variable guarded against being empty. Nothing found by a glob, nothing outside that destination, and it does not soften the sentence it sits beside.
- **Decide whether the opener line changes.** It is repeated in every spawning skill and rendered into every prompt, so each word there is paid for on every spawn, and it is pinned by the suite. The file is the home; add path-level discards to the line only if you judge the repeated loss warrants it, and say which you chose in the pull request.
- **Check the Codex interface before rewording its paragraph.** Read what a current Codex session offers for spawning, and write the paragraph from that. If the roles and the close step exist as written, leave the paragraph alone and say so.
- The lifecycle paragraph opens with "Nothing resumes you". Keep the instruction whatever the harness does; if that premise is no longer true of a harness, drop the premise, not the rule.
- Every copy of the boundary file changes in the same commit, and the suite's clause list changes with it. A new clause that the suite does not pin is a clause the next edit can delete unnoticed.

## Acceptance criteria

- Every copy of `subagent-boundary.md` in both mirrors is identical and carries the four additions.
- `scripts/test-subagent-destroy-boundary.mjs` fails when any one of the new boundary clauses is deleted, from the file or from a workflow's rendered prompt.
- The three briefs carry their additions in both mirrors, and no orchestrator-loaded `SKILL.md` grew by a restatement of one.
- A role following the boundary can remove a scratch directory it made, and cannot use the exemption on any other path.
- The Codex spawn paragraph matches the interface as verified, with the verification stated in the pull request.
- The full test set passes.

## Validation

- Run every suite `tests.yml` runs.
- Delete each new clause in turn on a throwaway copy and confirm a suite fails.
- State the before and after word counts of the boundary file and each brief in the pull request.

## Review plan

Read the boundary file as a fixer about to restore a file after a control and as a reviewer about to remove a scratch directory, and confirm each finds exactly one permitted way; then check that nothing was added to an orchestrator-facing file that a brief already says.
