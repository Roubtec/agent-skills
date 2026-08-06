# 031b — prune-branches: never print a removal command built on a stale expected-old OID

## Why this task exists

Task 031a taught `prune-branches` to inventory and sweep breadcrumbs left by earlier runs. Step 11's rule for which non-swept breadcrumbs get a printed `git update-ref` cleanup command contradicts itself in one case.

`plugins/dev-skills/skills/prune-branches/SKILL.md:293` (and the identical line in the codex mirror) says to print the command for every redundant breadcrumb that was eligible but not swept —

> under `hands-off`, because the user kept it, or **because the expected-old-OID deletion refused**

— and then, two sentences later, says:

> Print none for a breadcrumb that **changed since the inventory** either, and report the mismatch, because the OID that would make the command safe is no longer the one the ref holds.

Those are the same condition observed at two different moments. An expected-old-OID deletion refuses *precisely because* the ref no longer holds the inventoried OID. So the first clause prints a command carrying a stale expected-old value, and the second clause explains why that command cannot work.

Step 11's own report categories (`:268`) list "changed since the inventory" and "refused by the expected-old-OID check" as separate dispositions while giving them opposite print treatment, which is how the inconsistency stayed invisible.

This fails safe — Git refuses the pasted command and nothing is deleted — so it is a usability defect rather than a safety one. But it hands the user a command that is guaranteed to fail, in a report whose whole purpose is that "the cleanup this run declined to perform stays one paste away", and it does so in exactly the situation where the user most needs to understand that something moved underneath them.

## Scope

Included:

- Resolve the contradiction at `:293` in both mirrors. Two acceptable resolutions:
  - Treat a refused sweep the same way as a breadcrumb that changed since the inventory: report the mismatch and the ref's current position — Git's refusal message already names both the actual and the expected OID — and print no command; or
  - Print a command only after re-deriving the expected-old value from the ref's current OID, and say explicitly that the user must inspect the ref before pasting it, since the breadcrumb moved for a reason nobody has explained yet.

  The first is the smaller edit and matches how the adjacent case is already handled; the second preserves the paste-away convenience. Pick one and state why.
- Make step 11's report categories (`:268`) and the print rule agree, so "changed since the inventory" and "refused by the expected-old-OID check" are not given opposite treatment without a stated reason for the difference.
- Apply to both harness renderings, which must stay in parity apart from their harness-specific invocation and confirmation wording.

Out of scope:

- Any change to the classification, confirmation, or deletion mechanics of 031a — the executed form `git update-ref --no-deref -d "$ref" "$old_oid"` stays exactly as it is, and the expected-old-OID guard is the thing working correctly here.
- The age-threshold, load-bearing, and unrecognized-ref print rules in the same paragraph, which are consistent and correct.

## Context and references

- 031a — the parent task that added the sweep and this reporting paragraph.
- 031 — the task that introduced the skill and its breadcrumb mechanism.
- `plugins/dev-skills/skills/prune-branches/SKILL.md:253` — the executed deletion form, and `:290-293` — the printed-command rules this task repairs. Both mirrors are 315 lines and identically numbered as of `885cdee`; re-derive if they have moved.

## Target files or areas

- `plugins/dev-skills/skills/prune-branches/SKILL.md`
- `codex/dev-skills/skills/prune-branches/SKILL.md`

## Implementation notes

- Keep it proportionate: this is one paragraph reconciled with itself, not a rework of step 11.
- The expected-old-OID refusal is worth naming as informative in its own right. A breadcrumb that moved between inventory and cleanup means something else touched `refs/pruned/**` during the run, which the user should probably know about regardless of what command they are or are not handed.

## Acceptance criteria

- No path in step 11 prints a removal command whose expected-old OID is known to be stale.
- A breadcrumb refused by the expected-old-OID check and a breadcrumb observed to have changed since the inventory are reported consistently, or the reason they differ is stated.
- The report tells the user what the ref currently holds when it refuses, so the situation is diagnosable without re-running the skill.
- Both mirrors carry the change and differ only in their harness-specific invocation and confirmation wording.

## Validation

- In a scratch repository, repoint a breadcrumb between inventory and cleanup, run the sweep, and confirm the report's wording for that breadcrumb matches whichever resolution was adopted — and that any command it does print succeeds when pasted.
- Confirm the mirrors' divergence count is unchanged apart from harness-specific wording.

## Review plan

Reviewer checks that the two clauses can no longer be read as contradicting each other, that no printed command can carry an OID the ref is known not to hold, that the executed deletion form and the expected-old-OID guard are untouched, and that the two mirrors stay in parity.
