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
  - Treat a refused sweep the same way as a breadcrumb that changed since the inventory: report whatever the refusal establishes — for a moved ref, the mismatch and the ref's current position; for a vanished one, neither, per the bullet below — and print no command; or
  - Print a command only after re-deriving the expected-old value from the ref's current OID **and re-running the reachability classification against that current OID**, and say explicitly that the user must inspect the ref before pasting it, since the breadcrumb moved for a reason nobody has explained yet.

  The second alternative cannot skip that reclassification. A breadcrumb repointed between inventory and sweep may now hold commits unreachable from the resolved default, which is exactly what makes a breadcrumb load-bearing (`:167`) — and `:293` already forbids printing a removal command for one of those. Re-deriving the OID alone would convert the one command Git currently refuses into one that succeeds and deletes the only ref still advertising that work, turning a fail-safe usability defect into the loss the skill exists to prevent. So if the current target classifies as load-bearing, print no command and report it under the load-bearing wording instead. The first alternative is the smaller edit, matches how the adjacent case is already handled, and needs no reclassification precisely because it prints nothing. Pick one and state why.
- **Distinguish a vanished breadcrumb from a moved one.** The expected-old deletion also refuses when another process deleted the ref in between, and that refusal has a different shape: Git reports `cannot lock ref '<ref>': unable to resolve reference '<ref>'`, naming neither the actual nor the expected OID, because there is no current position to name. Verified against Git in a powbox container on 2026-08-06 — a moved ref reports `is at <actual> but expected <expected>`; an absent one reports neither. "Report the ref's current position" is therefore unsatisfiable for this perfectly ordinary race, and the report must name the breadcrumb as vanished — which is the outcome the sweep wanted anyway — rather than claim a mismatch it cannot describe. `:253` conflates the two and must be corrected alongside: it says Git refuses "reporting where the ref actually is, when the breadcrumb moved **or vanished** in between", and for the vanished half that is not what Git prints.
- Make step 11's report categories (`:268`) and the print rule agree, so "changed since the inventory" and "refused by the expected-old-OID check" are not given opposite treatment without a stated reason for the difference. If the vanished case earns its own disposition, add it there rather than folding it into either.
- Apply to both harness renderings, which must stay in parity apart from their harness-specific invocation and confirmation wording.

Out of scope:

- Any change to the classification, confirmation, or deletion mechanics of 031a — the executed form `git update-ref --no-deref -d "$ref" "$old_oid"` stays exactly as it is, and the expected-old-OID guard is the thing working correctly here. The `:253` correction above is to that bullet's *description* of the refusal, not to the command it prescribes; and the reclassification the second alternative requires governs what step 11 may print, not how step 6 classifies.
- The age-threshold, load-bearing, and unrecognized-ref print rules in the same paragraph, which are consistent and correct. This task leans on the load-bearing rule rather than revising it.

## Context and references

- 031a — the parent task that added the sweep and this reporting paragraph.
- 031 — the task that introduced the skill and its breadcrumb mechanism.
- `plugins/dev-skills/skills/prune-branches/SKILL.md:253` — the executed deletion form and its description of the refusal, `:167` — the load-bearing classification the second alternative must re-run, and `:290-293` — the printed-command rules this task repairs. Both mirrors are 315 lines and identically numbered as of `885cdee`; re-derive if they have moved.

## Target files or areas

- `plugins/dev-skills/skills/prune-branches/SKILL.md`
- `codex/dev-skills/skills/prune-branches/SKILL.md`

## Implementation notes

- Keep it proportionate: this is one paragraph reconciled with itself, not a rework of step 11.
- The expected-old-OID refusal is worth naming as informative in its own right. A breadcrumb that moved between inventory and cleanup means something else touched `refs/pruned/**` during the run, which the user should probably know about regardless of what command they are or are not handed.

## Acceptance criteria

- No path in step 11 prints a removal command whose expected-old OID is known to be stale.
- No path in step 11 prints a removal command that would succeed against a target never classified as redundant at the OID the command carries — a re-derived expected-old value is paired with a re-derived classification, or no command is printed.
- A breadcrumb refused by the expected-old-OID check and a breadcrumb observed to have changed since the inventory are reported consistently, or the reason they differ is stated.
- When a moved breadcrumb's deletion refuses, the report tells the user what the ref currently holds, so the situation is diagnosable without re-running the skill. When the ref has vanished it is reported as vanished, and no criterion or prescribed wording demands a current OID that does not exist.
- No shipped text claims Git's refusal names the ref's actual position in every case — `:253` included.
- Both mirrors carry the change and differ only in their harness-specific invocation and confirmation wording.

## Validation

- In a scratch repository, exercise all three races between inventory and cleanup and confirm the report's wording for each matches whichever resolution was adopted — and that any command it does print succeeds when pasted:
  - repoint the breadcrumb to another redundant commit;
  - repoint it to a commit unreachable from the resolved default, and confirm no working removal command is printed for it;
  - delete the breadcrumb outright, and confirm it is reported as vanished rather than as a mismatch.
- Capture Git's actual refusal text in each case rather than paraphrasing it, since the moved and vanished forms differ and only the first names an OID.
- Confirm the mirrors' divergence count is unchanged apart from harness-specific wording.

## Review plan

Reviewer checks that the two clauses can no longer be read as contradicting each other, that no printed command can carry an OID the ref is known not to hold, and that no printed command can succeed against a target whose current classification was never checked. Reviewer also confirms the vanished case is reported without demanding an OID Git does not supply, that the executed deletion form and the expected-old-OID guard are untouched, and that the two mirrors stay in parity.
