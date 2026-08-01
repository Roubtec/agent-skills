# 034 — enable-worktrees: respect an active `.powbox.local.yml` shadow override

## Why this task exists

`enable-worktrees` reconciles `$ROOT/.powbox.yml` so `.worktrees`, `.claude/worktrees`, and `.git/worktrees` are declared as literal shadow paths, then reports the repo worktree-ready. It never looks at `$ROOT/.powbox.local.yml`.

That file wins. powbox's `detect-shadows.sh` picks its shadow list like this: if `.powbox.local.yml` exists and `yq 'has("shadow")'` is true, that file *replaces* the committed `.powbox.yml` list wholesale (it even logs `detect-shadows: shadow list overridden by .powbox.local.yml`); only otherwise does it read `.powbox.yml`. Workspace `node_modules` auto-detection is unaffected, but every custom declaration comes from whichever single file won.

So in a repo carrying a local override — a machine-local experiment, a `shadow: []` that disables committed shadows — `enable-worktrees` writes three entries into a file that is not being read, and reports success. The concrete failure is `.claude/worktrees`: it has no launcher volume behind it and depends entirely on the declaration for its tmpfs, so it silently stays on the host bind mount and harness-native worktrees start landing on the host. Step 5's mount verification would catch this, but step 5 is explicitly optional, and the step 6 commit plus the Report give no hint that the declarations are inert.

This was found during the PR #34 same-pattern sweep, not raised by a reviewer. PR #34 fixed the identical gap in the sibling `declare-shadows` skill, which now names the effective list in step 2, folds an active override's entries into its candidate set, and applies agreed changes to the override as well. `enable-worktrees` was left alone there because it is a separate, already-shipped skill that PR #34 does not otherwise touch — hence this task rather than a drive-by edit.

## Scope

Included:

- Detect an active override in the reconcile step: `.powbox.local.yml` present *and* carrying a top-level `shadow:` key. Presence alone is not enough — a ctx-only local config does not override the shadow list.
- Say plainly, in both the step output and the Report, that the committed declarations are inert while the override stands, so a "worktree-ready" verdict is never issued on a config that is not in effect.
- Decide and encode what the skill does about it. The committed `.powbox.yml` must still gain the three entries (it is the durable, shared record), but the override needs the same three or the repo is not actually worktree-ready in this container. Mirror `declare-shadows`' resolution — add them to the override too, or have the user retire it — unless a better one is argued in the implementation.
- Keep `.powbox.local.yml` out of the commit step. It is user-local and expected to be gitignored; powbox's launcher warns when `git check-ignore -q .powbox.local.yml` does not ignore it, so the skill must not stage it, and should surface that ignore gap if it exists.
- Reconsider whether the mount verification should stay optional when an override was found. A repo whose declarations may be inert is the one case where skipping verification hides the failure entirely.
- Apply to both harness renderings, which must stay in parity apart from harness-specific wording.

Out of scope:

- Any change to `declare-shadows`, which PR #34 already fixed.
- Changes to `.gitignore` reconciliation, the leaked-tracking guard, or the worktree model itself.
- Teaching the skill to merge or diff arbitrary override sections beyond `shadow:` — `ctx:` and other keys are not its concern.

## Context and references

- PR #34 (`feat/declare-shadows-skill`) — introduced `declare-shadows` and, in its review round, fixed this same class of gap there. Its step 2 wording is the model to follow.
- `plugins/dev-skills/skills/declare-shadows/SKILL.md` step 2, step 3 candidate enumeration, and step 6 — the resolved shape of "audit the list that is actually in effect".
- powbox `detect-shadows.sh`, the `POWBOX_LOCAL_YML` branch — the authority for wholesale replacement.
- powbox README, "Custom Shadow Paths (`.powbox.yml` / `.powbox.local.yml`)" — states the replacement rule and that `shadow: []` locally disables committed custom shadows while leaving workspace auto-detection active.

## Target files or areas

- `plugins/dev-skills/skills/enable-worktrees/SKILL.md`
- `codex/dev-skills/skills/enable-worktrees/SKILL.md`

## Implementation notes

- The detection test is the same one powbox uses, so quote it rather than inventing a variant: the override counts only when `yq -r 'has("shadow")'` returns `true`.
- `wt-bootstrap` fails closed when a worktree root is not a container-local mountpoint, and its remedy points users at this skill. An override-induced miss therefore surfaces as a bootstrap failure that this skill previously claimed to have fixed — worth naming in the skill text so the loop is not confusing.
- Keep the edit proportionate. This is one detected condition and one honest report, not a matrix of override states.

## Acceptance criteria

- Running the skill in a repo with a `.powbox.local.yml` carrying a top-level `shadow:` key reports that the committed list is overridden, and no run in that state reports the repo worktree-ready without qualification.
- The three worktree roots end up in the list that is actually in effect, by whichever resolution the implementation adopts, and the durable record in `.powbox.yml` is written either way.
- `.powbox.local.yml` is never staged or committed by the skill.
- A `.powbox.local.yml` with only `ctx:` (no `shadow:` key) changes nothing about the run.
- Both mirrors carry the change and differ only in harness-specific wording.

## Validation

- In a scratch repo, exercise three states: no local file; a local file with `ctx:` only; a local file with `shadow:` (including the `shadow: []` case). Confirm the reported verdict and the files written in each.
- Confirm with `detect-shadows.sh` that the resulting configuration actually emits the worktree roots in the override state — the point of the task is that the previous configuration did not.

## Review plan

Reviewer checks that the override is detected by the same test powbox uses rather than by file presence, that no run can report worktree-ready while the declarations are inert, that `.powbox.local.yml` is never staged, that the `ctx:`-only case is a genuine no-op, and that the two mirrors stay in parity.
