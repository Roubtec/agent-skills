# 069 — Let `dc-remove` find a clone by its slug, or say where it looked

## Why this task exists

`dc-enter <slug>` makes a disposable clone and `dc-remove <slug>` deletes it.
Both derive the clone's location from the clone root, the agent name and a hash of the invoking worktree's path, so `dc-remove` finds a clone only when it is run from the same worktree, with the same environment, as the `dc-enter` that made it.

Run from anywhere else in the same repository (the main checkout after the work moved to a worktree, a sibling worktree, a later shell with a different root), it derives a directory that does not exist, prints "nothing to remove" and exits 0.
That exit status is deliberate, so a cleanup trap can call it unconditionally, but here it reports success while the clone stays on disk.
Clones have accumulated this way across sessions, each a full copy of a repository, and the slug then stays taken for the next `dc-enter` from the original worktree.

This helper is canonical in this repository: `plugins/dev-skills/bin/dc-remove` is the source, and powbox bakes its copy from here. The fix belongs here.

## Scope

Included:

- **On a miss, `dc-remove` looks for the slug in the sibling scopes under the same clone root** and decides from each candidate's marker whether it belongs to this repository.
- **A miss that stays a miss says where it looked**: the root and how it was chosen, the scope it derived and from which worktree, and any clone of that slug it found but would not touch, with the reason.
- **Tests** in `scripts/test-dc-helpers.sh`, in the same pull request, as the helper's header requires.
- **The header comments of both helpers**, and the sentence in `subagent-boundary.md` about dropping a clone if what it promises changes.

Out of scope:

- `dc-enter`'s derivation and its refusal of a slug that already has a clone.
- A reaper for clones whose source worktree no longer exists; that is an environment concern, and powbox's.
- Any way to hand `dc-remove` a path. The signature stays slug-only.

## Context and references

- `plugins/dev-skills/bin/dc-remove`: the header states the guarantee ("It can only ever delete a directory `dc-enter` created") and the two mechanics behind it. The sections "Clone root and slug path" and "Ownership proof" are where the derivation and the checks live; `REPO_PATHS` already holds every worktree registered against the invoking repository.
- `plugins/dev-skills/bin/dc-enter`: the marker it writes records the clone path and the source worktree.
- `scripts/test-dc-helpers.sh` pins the two derivations together; README describes how powbox takes both helpers from this repository.
- README → "Safety posture": these helpers are accident guardrails, not a security boundary, and a fix that deletes complexity is preferred to one that adds a case.

## Target files or areas

`plugins/dev-skills/bin/dc-remove`, `plugins/dev-skills/bin/dc-enter` for its header and marker if the marker has to record more, `scripts/test-dc-helpers.sh`, every `subagent-boundary.md` only if its sentence about `dc-remove` changes, `README.md` where it describes the helpers.

## Implementation notes

- **The ownership proof may not get weaker.** Today a clone is removed only when its marker's clone path and source both match what this invocation derived. A clone found in a sibling scope matches neither by construction, so decide what proves it is this repository's: the marker's recorded source being one of the worktrees the helper already enumerates is the obvious candidate, with the marker's own clone path matching the directory it was found in.
- **A slug is unique to its caller, not to the repository.** Two worktrees can each hold a clone under the same slug, and a concurrent sibling may be using its own. So an unambiguous single match owned by this repository may be removed, while more than one match, or a match whose source is not a registered worktree, is reported and left alone. If you conclude that removing across scopes is not safe enough even then, report-only with a non-zero exit is an acceptable outcome: the defect is the silent success, and saying where the clone is fixes that half on its own. State the choice and the reasoning in the pull request.
- **Keep the unconditional-trap property for a true miss.** No clone of that slug anywhere under the root is still exit 0. A clone that exists and was not removed is not a success and must not exit 0.
- The search is bounded to the scope directories directly under the clone root; it follows no symlink and reads nothing but markers.
- A different clone root between the two calls cannot be searched for. That case is covered by the message naming the root and where it came from.
- Keep the script's discipline: no load-bearing pipe, no change of working directory, paths captured without losing a trailing newline, and every refusal naming what it refused.
- Powbox picks the change up at its next image build; nothing is pinned, so nothing else needs editing there.

## Acceptance criteria

- `dc-remove <slug>` run from a different worktree of the same repository than the `dc-enter` that made the clone either removes it or exits non-zero naming its path; it never prints "nothing to remove" and exits 0 while that clone exists under the same root.
- With no clone of that slug under the root, it exits 0 and its message names the root, the derived scope and the worktree the scope was derived from.
- Two clones of one slug from two worktrees are never both removed by one call, and a call from a third location removes neither.
- A directory under the root that carries no valid marker, or a marker naming another repository, is never removed.
- `scripts/test-dc-helpers.sh` covers each of those cases and passes.

## Validation

- Run `bash scripts/test-dc-helpers.sh` and every other suite `tests.yml` runs, plus `shellcheck`.
- Mutation-test each new check on a throwaway copy, after committing: weaken the source match, drop the ambiguity refusal, and confirm the suite fails each time.
- Reproduce the original miss by hand in a scratch repository with a linked worktree, before and after.

## Review plan

Look for any input under which the widened search deletes a directory the old helper would have refused, then read the miss message as someone who has just been told there is nothing to remove.
