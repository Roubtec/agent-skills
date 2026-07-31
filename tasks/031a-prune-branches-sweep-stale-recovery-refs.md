# 031a — prune-branches: inventory and sweep stale recovery refs from earlier runs

## Why this task exists

`prune-branches` creates a `refs/pruned/<YYYYMMDD-UTC>/<branch>` breadcrumb before every non-Merged deletion, and step 11 prints the exact `git update-ref -d` cleanup command for the refs that run created. It never looks at the breadcrumbs left by *previous* runs. Those accumulate indefinitely, and unlike branches they are invisible to `git branch` — you only see them if you remember the `git for-each-ref refs/pruned/` incantation. Refs also keep their commits advertised forever, so the bytes never get garbage-collected either.

The maintainer raised this while reviewing PR #31: the point of pruning is to reduce the amount of scaffolding you carry around, and silently trading visible branches for invisible refs undercuts that. It surfaced specifically as the counter-argument to gating PR-derived Merged classification on the default base (the `--base` fix in #31), because that gate moves some branches from "deleted, no ref" into "deleted, with recovery ref". The gate was the right call on safety grounds, so the ref-accumulation cost is dealt with here instead.

## Scope

Included:

- Inventory every existing `refs/pruned/**` ref during the normal run, not just the ones this run creates, and surface them in the step 7 audit listing and the step 11 report with their date segment, branch name, and tip.
- Classify each pre-existing breadcrumb by whether it is still needed: a breadcrumb whose commit is now reachable from the resolved default (the work landed) is redundant and is a cleanup candidate; one holding otherwise-unreachable commits is still load-bearing and must be reported as such, never swept.
- Offer removal of redundant breadcrumbs under the same confirmation model the skill already uses for branches — never delete a ref the run did not propose and the user did not confirm, and always use the expected-old-OID form (`git update-ref -d <ref> <old-oid>`) so a breadcrumb that moved since inventory is not removed by accident.
- Decide and document the `hands-off` behaviour. The conservative default is to report redundant breadcrumbs without deleting them, matching how `hands-off` already refuses to touch Uncertain branches.
- An age threshold is worth considering so a breadcrumb from the current or previous run is never swept out from under a user who is still orienting; if adopted, state it explicitly rather than leaving it implicit.
- Apply to both harness renderings: `codex/dev-skills/skills/prune-branches/SKILL.md` and `plugins/dev-skills/skills/prune-branches/SKILL.md`, which must stay in parity apart from their harness-specific invocation and confirmation wording.

Out of scope:

- Any change to how breadcrumbs are named, claimed, or verified during a run (step 8 stays as is).
- Reflog expiry, `git gc` tuning, or any other repository-maintenance concern beyond `refs/pruned/**`.
- Sweeping `refs/pre-rebase/**`, which belongs to the rebase skills and has different retention expectations.

## Context and references

- 031 — the parent task that introduced the skill and its recovery-ref mechanism.
- PR #31 review thread on `--base` gating (`codex/dev-skills/skills/prune-branches/SKILL.md`, the Merged bucket in step 6) — where the maintainer flagged that converting branches into refs is "arguably even worse because refs are not readily visible."
- Step 8 of either SKILL.md — breadcrumb reservation, the source of the refs this task sweeps.
- Step 11 of either SKILL.md — the current run-scoped cleanup reporting this task generalises.

## Target files or areas

- `codex/dev-skills/skills/prune-branches/SKILL.md`
- `plugins/dev-skills/skills/prune-branches/SKILL.md`

## Implementation notes

- Reachability is the right redundancy test and it is cheap: `git merge-base --is-ancestor <ref> <default-oid>` per breadcrumb, reusing the freshly fetched default comparison OID the skill already captures in step 4.
- Keep the existing budget discipline. If the ref count can be large, cap the inventory the way branch and PR lookups are capped, and say plainly in the report that the cap truncated the listing.
- The skill's absolute safety rules already forbid overwriting or deleting existing refs during reservation; that rule is about step 8's claim loop and needs rewording, not weakening, so it does not read as forbidding this deliberate, confirmed sweep.
- Dynamic ref names must be argv-safe or shell-quoted like every other interpolated value in the skill.

## Acceptance criteria

- A run in a repository containing breadcrumbs from earlier runs lists them, separated into redundant and still-load-bearing, in both the audit listing and the final report.
- No breadcrumb is ever deleted without an explicit confirmation covering it, and every deletion uses the expected-old-OID form.
- A breadcrumb whose commits are unreachable from the resolved default is never proposed for deletion, whatever its age.
- `hands-off` behaviour is stated explicitly in the skill text and matches whatever this task decides.
- Both mirrors carry the change and differ only in their harness-specific invocation and confirmation wording.

## Validation

- In a scratch repository, create breadcrumbs of both kinds — one pointing at a commit merged into the default, one at an orphaned commit — plus one dated to the current run, and confirm the classification, the confirmation gate, and the report wording.
- Confirm the expected-old-OID deletion refuses when the breadcrumb is repointed between inventory and cleanup.

## Review plan

Reviewer checks that redundancy is decided by reachability rather than age or name, that no path can delete an unreachable breadcrumb, that the confirmation model matches the one used for branch deletion, that the step 8 safety-rule rewording did not weaken the reservation guarantee, and that the two mirrors stay in parity.
