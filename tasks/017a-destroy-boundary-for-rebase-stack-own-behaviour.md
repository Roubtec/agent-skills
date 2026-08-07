# 017a — State `rebase-stack`'s own destroy boundary, the one destructive referent of 017's carve-out

## Why this task exists

Task 017 item 5 gave every subagent-spawning skill and workflow a destroy boundary, and that boundary carves out the destructive commands the assignment itself authorises — "each of them beyond what this assignment itself spells out, whether as an exact command **or as a skill it names to invoke**". The carve-out is deliberate: a brief that tells a subagent to invoke a skill has authorised whatever that skill does, and the boundary must not forbid the work it just assigned.

A sweep of all seven spawning skills and all three workflows finds three skills named, in text a subagent reads, as a skill to invoke — the carve-out's own relation — rather than cross-referenced for a rule they define:

- `address-review` — `address-reviews/SKILL.md:167` and `:200`, which carries 017's boundary itself (`address-review/SKILL.md:86`), so what it authorises is bounded by text a reader can find;
- `rebase-stack` — `address-tasks/SKILL.md:272` and `:277`, which carries no boundary of any kind;
- `write-tasks` — `address-review/SKILL.md:168` ("invoke that skill where available"), `reap-tasks/SKILL.md:64`, and `wf-address-review.js:245`'s `deferred-to-task` disposition, which reaches the fixer through the nested cycle's `scope.instructions` (`:423`); it carries no boundary either, and needs none — see the next paragraph.

The other spawning skills are cross-referenced in that same text for rules and contracts they define — `review-cycle` most of all, since the five skills before it delegate their role contracts to it, and always possessively ("follow the `review-cycle` skill's fresh-spawn rule", "per the `review-cycle` skill's peer preflight") rather than as a skill to invoke — but each carries 017's boundary itself, so naming one is bounded by construction rather than by a sweep.

So `rebase-stack` is the only referent whose **own behaviour** is destructive, and that is what makes it the one the carve-out leaves unbounded in substance. `write-tasks` is recorded above so a later sweep does not rediscover it and file a redundant task: it is a task-authoring skill containing no destructive command at all — no `rm`, `git reset --hard`, `git clean`, `git branch -f`, `git update-ref`, `git gc`, or force-push — whose only spelled-out `git` commands are a `fetch` and an `ls-tree` in its number-allocation recipe (`write-tasks/SKILL.md:73-74`), whose one further act on the repository is committing the task files it wrote on the current branch (`:18`), and which forbids pushing outright (`:22`). Naming it authorises nothing that needs bounding. `rebase-stack`'s own behaviour, by contrast, is genuinely destructive: it runs `git clean -fd` before returning (`plugins/dev-skills/skills/rebase-stack/SKILL.md:69`, mirrored at `codex/dev-skills/skills/rebase-stack/SKILL.md:70`), applies the same clean-stop after a restore (`:249` / `:250`), and runs `git reset --hard <pre-rebase-ref>` on the current disposable branch in delegated unattended mode (`:286` / `:287`). A subagent handed "invoke the `rebase-stack` skill" is therefore authorised, through the carve-out, to run commands the skill nowhere states a boundary for.

017 recorded this in its out-of-scope section and left the question of a task of its own explicitly unfiled and undecided. This task is the maintainer's decision to file it.

## Scope

Included:

- State, in `rebase-stack`'s own text, what its destructive commands are permitted to reach and what they are not. This is a **rule about what the skill does when invoked**, in the same voice as the rest of the skill's steps.
- Cover the three cited sites — the pre-return `git clean -fd`, the post-restore clean-stop, and the delegated-unattended `git reset --hard <pre-rebase-ref>` — naming what each is scoped to: the current disposable guide branch and the worktree the invocation named, never a canonical task branch, never a remote ref, and never a sibling worktree.
- Say the part a worktree does not give you, since this skill is routinely delegated into a dedicated worktree (`address-tasks/SKILL.md:268`): a worktree isolates the working tree, not the repository, so `reset --hard` on the wrong branch reaches every sibling worktree through the shared `.git`. `git clean -fd` is bounded to the tree it runs in; the ref-moving half is not.
- Mirror every edit into `codex/dev-skills/skills/rebase-stack/SKILL.md` in lockstep. There is no generator: both mirrors are hand-edited together, and the divergence between them must not grow.

Out of scope:

- **Adding 017 item 5's prompt contract to `rebase-stack`.** 017's acceptance criteria fail a delivery that adds its boundary text to `rebase-stack` "as a prompt contract or as a spawn instruction", and 017 item 5 excluded the skill because it issues no spawn instruction at all — only a note about being *called by* a subagent (`SKILL.md:71`). The two kinds of boundary are different objects: item 5's is a contract a skill **writes for someone else**, this task's is a rule about what a skill **does itself**. Conflating them is what produced an earlier 017 draft's wrong skill list, and a future implementer who "fixes" this task by pasting the item 5 boundary into `rebase-stack` has broken 017 rather than delivered 017a.
- Any change to `address-tasks`, `address-reviews`, or the carve-out wording in the boundary constants. The carve-out is correct; what it points at is what is missing.
- `enable-worktrees`, which forbids spawning outright (`SKILL.md:10`) and is out of scope for the same reason it was in 017.
- `write-tasks`, the carve-out's third referent. Naming it authorises nothing destructive, so a boundary there would add a case rather than close a hazard. It is named in the sweep above precisely so this stays a recorded decision rather than something a later sweep rediscovers.

## Context and references

- 017 — item 5 authors the prompt-contract boundary and its carve-out; its out-of-scope section is where this task was parked, and its acceptance criteria are what an implementer must not break here.
- 020 — the disposable-clone helpers. Not relevant to this task: `rebase-stack`'s destructive commands are its assigned work on branches created to be discarded, not empirical verification looking for somewhere safe to happen.
- `plugins/dev-skills/skills/rebase-stack/SKILL.md` and its codex mirror — the file this task edits, and the three cited sites.
- `plugins/dev-skills/skills/address-tasks/SKILL.md:249-289` — the post-batch restack that delegates to this skill, including the disposable `review-stack/...` guide branches (`:249`), the read-only declaration over the canonical branches (`:278`), and the post-return check that every canonical `bN` tip still equals the SHA captured beforehand (`:282`). That is the context this task's boundary is written against.

## Target files or areas

- `plugins/dev-skills/skills/rebase-stack/SKILL.md` and `codex/dev-skills/skills/rebase-stack/SKILL.md`, in lockstep.

## Implementation notes

- Honest framing, because the risk here is real but bounded and the task must not be written as though it were an incident. `rebase-stack` operates on disposable `review-stack/...` guide branches by design; `address-tasks` declares the canonical task branches and all remote refs read-only in the delegating prompt (`:278`) and verifies afterwards that every canonical tip is unmoved (`:282`). This is a **missing statement**, not a known loss — nothing has gone wrong through this path. What is missing is that the guarantee lives only in the caller's prompt and in the skill's habits, so an invocation that reaches the skill by another route inherits no statement of it at all.
- Keep it terse, per 017's own implementation note: a rule statement plus what it is scoped to, placed where the destructive commands already are, rather than a new section restating the hazard.
- Do not renumber or restructure the skill's steps; the three sites are load-bearing line references in this task and in 017.

## Acceptance criteria

- `rebase-stack`'s text states, in both mirrors, what its `git reset --hard` and `git clean -fd` are scoped to and what they must never reach, covering all three cited sites.
- The statement is a rule about the skill's own behaviour. A delivery that instead adds 017 item 5's prompt-contract boundary to `rebase-stack`, in any form, fails this criterion and 017's own.
- The worktree-isolates-the-working-tree-not-the-repository fact is stated for the ref-moving half specifically, rather than asserted generally over both commands.
- Both mirrors carry the same statement; the Claude/codex divergence count for this file is unchanged by anything other than the intended edit.
- No change to `address-tasks`, `address-reviews`, `write-tasks`, the boundary constants, or the three workflows.

## Validation

- `node scripts/test-subagent-destroy-boundary.mjs` still passes unchanged: this task touches no workflow prompt and no boundary constant, so a failure here means the delivery went outside its scope.
- Diff the two mirrors of `rebase-stack/SKILL.md` and confirm the only differences are the pre-existing ones plus the intended edit applied to both.
- Re-verify the three cited line numbers against the delivered file and correct them in this task file if the edit moved them.

## Review plan

Reviewer confirms the delivered text is a statement about what `rebase-stack` does rather than a contract it hands to a subagent — the distinction this task exists to preserve — and that 017's `rebase-stack`-and-`enable-worktrees` criterion still passes. Reviewer checks all three destructive sites are covered rather than only the `reset --hard` one, that the scoping names the disposable guide branch and the invocation's own worktree rather than "the repository", and that the worktree-isolation fact is attached to the ref-moving command rather than spread over both. Reviewer reads both mirrors side by side rather than one and an assurance.
