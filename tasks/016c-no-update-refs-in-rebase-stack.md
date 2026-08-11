# 016c — Confine rebase-stack's per-branch rebase against an inherited `rebase.updateRefs=true`

## Why

PR #72 gave the delegated rebase step `--no-update-refs` on every rebase it runs, after review showed that `rebase.updateRefs=true` in the user or repository config turns a plain `git rebase` into `--update-refs` and force-moves every other un-checked-out local branch pointing into the replayed range ([the thread](https://github.com/Roubtec/agent-skills/pull/72#discussion_r3762279137)). The review round that verified that fix found the same hazard standing in `rebase-stack`: the per-branch loop of `plugins/dev-skills/skills/rebase-stack/SKILL.md` (step 4, the plain `git rebase <new-base>`) and its `codex/dev-skills/skills/rebase-stack/SKILL.md` mirror inherit the same config.

For this skill the inherited setting is worse than a stray ref move: the loop's whole design is per-branch control — its own "Why per-branch rebase instead of `git rebase --update-refs`" section argues against whole-stack ref-moving — yet with the config set, rebasing an early chain branch drags every later chain branch that points into the range along with it, before the loop reaches those branches with their own conflict handling, validation gating, and snapshot refs. The later branches then arrive at their own iteration already moved, and the loop's bookkeeping (`EF`, snapshot refs, patch-id expectations) describes tips that no longer exist.

This is agent-proposed follow-up work from PR #72's review round, not maintainer-directed; it is queued rather than deferred because the trigger is a single global git config value a maintainer can have set for their own interactive stacked work — exactly the population that runs `rebase-stack`.

## What to do

- In step 4 of both `rebase-stack` files, make the per-branch rebase `git rebase --no-update-refs <new-base>` — and likewise any other invocation the loop prescribes that *starts* a replay, while `git rebase --continue`/`--skip`/`--abort` stay as they are, being continuations of a replay already flagged rather than commands that accept the option — with one clause saying why: an inherited `rebase.updateRefs=true` would move later chain branches before their own iteration, defeating the per-branch design the "Why per-branch rebase" section states.
- Leave the "Why per-branch rebase instead of `git rebase --update-refs`" section's description of `--update-refs` as the deliberate manual fast-path untouched — that section describes the alternative a human may choose, not a command the loop runs.
- Keep the plugin and codex copies aligned in the touched passages as they are today.

## Acceptance criteria

- Every replay-starting rebase command the `rebase-stack` loop itself prescribes carries `--no-update-refs`, in both flavors, with the why stated once; `--continue`/`--skip`/`--abort` forms are untouched.
- The manual `--update-refs` fast-path prose is unchanged.
- Every suite named in `.github/workflows/tests.yml` passes.
