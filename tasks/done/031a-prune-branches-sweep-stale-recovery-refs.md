# 031a — prune-branches: inventory and sweep stale recovery refs from earlier runs

## Why this task exists

`prune-branches` creates a breadcrumb before every non-Merged deletion — `refs/pruned/<YYYYMMDD-UTC>/<branch>` normally, or `refs/pruned/flat/<YYYYMMDD-UTC>/<percent-encoded-branch>` when a prefix conflict blocks the hierarchical family — and step 11 prints the exact `git update-ref -d` cleanup command for the refs that run created. It never looks at the breadcrumbs left by *previous* runs. Those accumulate indefinitely, and unlike branches they are invisible to `git branch` — you only see them if you remember the `git for-each-ref refs/pruned/` incantation. Refs also keep their commits advertised forever, so the bytes never get garbage-collected either.

The maintainer raised this while vetting the review dispositions on PR #31, not in a thread on the PR itself: the point of pruning is to reduce the amount of scaffolding you carry around, and silently trading visible branches for invisible refs undercuts that. It surfaced specifically as the counter-argument to gating PR-derived Merged classification on the default base (the `--base` fix in #31), because that gate moves some branches from "deleted, no ref" into "deleted, with recovery ref". The gate was the right call on safety grounds, so the ref-accumulation cost is dealt with here instead.

## Scope

Included:

- Inventory the existing `refs/pruned/**` refs during the normal run, not just the ones this run creates, and surface them in the step 7 audit listing and the step 11 report with their date segment, branch name, and tip. Both breadcrumb layouts count: the hierarchical `refs/pruned/<date>/<branch>` and the flat `refs/pruned/flat/<date>/<encoded>` fallback, whose date and branch sit in different positions and whose name must be percent-decoded before it is shown. Report the real branch name in both cases, so a flat breadcrumb is not listed under a date segment of `flat`. This inventory is subject to the same budget discipline as the skill's other lookups (see the implementation notes); a truncated listing must say so rather than read as complete.
- Classify each pre-existing breadcrumb by whether it is still needed: a breadcrumb whose commit is now reachable from the resolved default (the work landed) is redundant and is a cleanup candidate; one holding otherwise-unreachable commits is still load-bearing and must be reported as such, never swept.
- Offer removal of redundant breadcrumbs under the same confirmation model the skill already uses for branches — never delete a ref the run did not propose and the user did not confirm, and always use the expected-old-OID form (`git update-ref -d "$ref" "$old_oid"`) so a breadcrumb that moved since inventory is not removed by accident.
- Decide and document the `hands-off` behaviour. The conservative default is to report redundant breadcrumbs without deleting them, matching how `hands-off` already refuses to touch Uncertain branches.
- An age threshold is worth considering so a breadcrumb from the current or previous run is never swept out from under a user who is still orienting; if adopted, state it explicitly rather than leaving it implicit.
- Apply to both harness renderings: `codex/dev-skills/skills/prune-branches/SKILL.md` and `plugins/dev-skills/skills/prune-branches/SKILL.md`, which must stay in parity apart from their harness-specific invocation and confirmation wording.
- One deliberate exception to the step 8 carve-out below, admitted during implementation: open step 8's reservation transaction with `option no-deref`, so a claim binds the candidate name itself. The sweep work turned up the same dereference hazard on the write side. `git update-ref --stdin` follows symbolic refs by default, `create` included; a symref at a candidate name whose target exists is refused either way, but a *dangling* one resolves through to its missing target, so the claim succeeds against that and writes a stray ref outside `refs/pruned/` while the candidate stays a symref — and item 6's verification then resolves it, finds exactly the expected OID, and passes, so the branch is deleted against a breadcrumb that is really a pointer elsewhere. Reproduced on both the files and reftable backends. Step 5's inventory cannot backstop it, because `for-each-ref` skips a dangling symref rather than listing it, so `no-deref` is the only guard that applies. A demonstrated path from "reserve a breadcrumb" to "create a ref under `refs/heads/`", inside the step that exists to protect work, was not worth deferring; it is a single directive and can be dropped on its own if the maintainer would rather it arrived in its own PR.

Out of scope:

- Any change to how breadcrumbs are named, claimed, or verified during a run — step 8 stays as is, apart from the single `option no-deref` exception recorded above and the safety-rule rewording noted under implementation notes.
- Reflog expiry, `git gc` tuning, or any other repository-maintenance concern beyond `refs/pruned/**`.
- Sweeping `refs/pre-rebase/**`, which belongs to the rebase skills and has different retention expectations.

## Context and references

- 031 — the parent task that introduced the skill and its recovery-ref mechanism.
- PR #31 review thread on `--base` gating (`codex/dev-skills/skills/prune-branches/SKILL.md`, the Merged bucket in step 6) — the thread that prompted this task. The objection itself is not in that thread: the maintainer raised it while vetting the disposition, arguing that trading visible branches for `refs/pruned/**` breadcrumbs is arguably worse, because refs are not readily visible without remembering the syntax. This task file is the record of it.
- Step 8 of either SKILL.md — breadcrumb reservation, the source of the refs this task sweeps.
- Step 11 of either SKILL.md — the current run-scoped cleanup reporting this task generalises.

## Target files or areas

- `codex/dev-skills/skills/prune-branches/SKILL.md`
- `plugins/dev-skills/skills/prune-branches/SKILL.md`

## Implementation notes

- Reachability is the right redundancy test and it is cheap: `git merge-base --is-ancestor "$ref" "$default_oid"` per breadcrumb, reusing the freshly fetched default comparison OID the skill already captures in step 4.
- Keep the existing budget discipline. If the ref count can be large, cap the inventory the way branch and PR lookups are capped, and say plainly in the report that the cap truncated the listing.
- The skill's absolute safety rules already forbid overwriting or deleting existing refs during reservation; that rule is about step 8's claim loop and needs rewording, not weakening, so it does not read as forbidding this deliberate, confirmed sweep.
- Dynamic ref names must be argv-safe or shell-quoted like every other interpolated value in the skill.

## Acceptance criteria

- A run in a repository containing breadcrumbs from earlier runs lists them, separated into redundant and still-load-bearing, in both the audit listing and the final report, up to whatever budget the implementation adopts and saying so plainly when that budget truncated the listing. Breadcrumbs of both layouts appear, each under its real branch name and date.
- No breadcrumb is ever deleted without an explicit confirmation covering it, and every deletion uses the expected-old-OID form.
- A breadcrumb whose commits are unreachable from the resolved default is never proposed for deletion, whatever its age.
- `hands-off` behaviour is stated explicitly in the skill text and matches whatever this task decides.
- Both mirrors carry the change and differ only in their harness-specific invocation and confirmation wording.

## Validation

- In a scratch repository, create breadcrumbs of both kinds — one pointing at a commit merged into the default, one at an orphaned commit — plus one dated to the current run, and confirm the classification, the confirmation gate, and the report wording. Cover both layouts, including a flat breadcrumb for a branch whose name contains `/` and one whose name contains a literal `%`.
- Confirm the expected-old-OID deletion refuses when the breadcrumb is repointed between inventory and cleanup.

## Review plan

Reviewer checks that redundancy is decided by reachability rather than age or name, that no path can delete an unreachable breadcrumb, that the confirmation model matches the one used for branch deletion, that the step 8 safety-rule rewording did not weaken the reservation guarantee, that the `option no-deref` exception stays confined to binding a claim to its candidate name and changes nothing else about how breadcrumbs are named, claimed, or verified, and that the two mirrors stay in parity.
