# 027 — Guard task-file numbering against same-number collisions across in-flight branches

## Why this task exists

Task numbers are allocated by scanning the working tree for the next free number, but concurrent branches each scan their **own** tree. In Scribz, PR #78 created `tasks/024-bound-the-unconfirmed-entitlement-retry-rate.md` while PR #83 already carried `tasks/024-bound-sqlcmd-execution-time-in-the-integration-rig.md`; the filenames differ, so Git reports no conflict and both would have merged, silently corrupting the numbering convention. It was caught only by an explicit manual cross-branch check. The `address-tasks` pre-PR collision guard already deconflicts **add/add clashes on identical paths**; the same-number-different-name case is invisible to it.

## Scope

Included:

- **`address-tasks` (and serialized variant) pre-PR guard extension:** before opening a PR that adds task files, check the new files' task numbers against the comparison set defined under Implementation notes below, matching by the full number plus any letter suffix as the rule there specifies (both the set and the matching rule live there, so this bullet describes only how the scan is carried out); a same-number-different-name hit is handled like the existing add/add clash (renumber one side + re-review, or hold with an imperative name). Resolve each head to an object the local repo can actually read before scanning it. Enumerate with `gh pr list --state open --limit <high-enough> --json number,headRefOid` — pin the limit (or paginate) rather than accepting the CLI's silent default of 30, or a repo with more open PRs under-scans in exactly the way this guard exists to prevent. Then fetch each head from the **base** repo's PR ref namespace, which covers same-repo and fork heads uniformly and needs nothing but the PR number: `git fetch origin refs/pull/<N>/head` followed by `git ls-tree -r --name-only FETCH_HEAD -- tasks/` (or `git ls-tree -r --name-only <headRefOid> -- tasks/` once fetched). The `-r` is load-bearing: without it `ls-tree` reports the `tasks/done` and `tasks/deferred` subtrees as single tree objects rather than their filenames, so a PR that archives a task into `tasks/done/` would hide the number it still holds and the guard would clear a second claimant of it. Archived and deferred tasks remain part of the numbering history (`tasks/AGENTS.md`), so every scan — base branch and PR head alike — recurses the whole `tasks/` subtree. A bare `git ls-tree <headRefName>` is not sufficient — a head that exists only as `origin/<name>`, or on a fork, does not resolve as a local ref and a normal base-repo fetch does not create it, so the guard would silently skip those PRs while claiming to scan every head. Prefer the `refs/pull/` route over reconstructing a fork's `owner/repo` for a contents-API call: a renamed fork makes that pair unreliable, and the PR ref is served by the base repo regardless.
- **`write-tasks` numbering guidance:** when allocating numbers, scan not just the working tree but also open PR heads for taken numbers, recursing the whole `tasks/` subtree on both, not just its top level (a number preserved by an archived or deferred task is still taken, and an enumerated `done/`+`deferred/` pair would silently miss any subfolder added later). Allocation deliberately reasons about the **numeric slot** here — `001a` occupies slot `001` for the purpose of picking the next free primary — which is the opposite end of the guard's full-number matching and is correct for this step, not an oversight to be normalized; on collision risk (or when the repo has multiple task-bearing PRs in flight), prefer the next number clear of all of them and say so in the task-writing commit message.
- **`review-tasks` sweep addition:** during task cleanup cycles, flag duplicate task numbers across the whole `tasks/` subtree (including `done/` and `deferred/`, where a renumber-on-archive would break references — report, don't rename there). The sweep compares the **full** task number by the same rule as the guard below (three digits plus any letter suffix), not the bare three-digit prefix: a prefix comparison flags every legitimate `001`/`001a`/`001b` family as a duplicate, filling the audit meant to catch real collisions with noise.

Out of scope:

- A manifest-based allocator (repo-level choice; only worth proposing if the guard proves insufficient).
- Renumbering existing duplicates in any consumer repo.

## Context and references

- `plugins/dev-skills/skills/address-tasks/SKILL.md` — the existing pre-PR collision guard (add/add deconfliction) whose mechanism and vocabulary this extends.
- `plugins/dev-skills/skills/write-tasks/SKILL.md` — "File naming and ordering" section.
- `plugins/dev-skills/skills/review-tasks/SKILL.md` — the audit sweep.
- `tasks/AGENTS.md` in this repo — the odd/even numbering house style the guard protects (consumer repos carry equivalents).

## Target files or areas

- `address-tasks/SKILL.md`, `address-tasks-serialized/SKILL.md`, `write-tasks/SKILL.md`, `review-tasks/SKILL.md`, codex mirrors.

## Implementation notes

- State the matching rule precisely so the guard doesn't false-positive on legitimate `001`/`001a` families. Parse each task filename into its **full task number** — the three digits plus the optional lowercase letter suffix (`001`, `001a`, `042b`) — and its slug. Two files **collide** when their full task numbers are identical and their slugs differ. Two files whose full task numbers differ **never** collide, even when their numeric portions match: `001` and `001a` are distinct numbers that coexist by design, as do `001a` and `001b`. Identical full number *and* identical slug is the plain add/add clash the existing guard already handles.
- Keep it cheap: one `gh pr list` at guard time plus one tree read per open head; degrade gracefully (note-and-proceed) when the remote is unavailable or a head cannot be resolved, since local-only runs can't see PR heads — report which heads were skipped rather than treating the scan as complete.
- Write the guard parallelism-ready for [033](033-vertical-task-pipelining.md), and **define the comparison set here, once** — 033 composes this guard rather than redefining it, so a second statement of the set there or anywhere else is a defect, not a summary. The set is the union of two groups. **Always:** the **base branch**, and every **open PR head**. **In a pipelined run, additionally:** branches **delivered earlier in the same run**, anything **merged since the run started**, numbers **reserved** by a task that has cleared the guard but not yet finished delivering, and **currently-ready siblings** awaiting the guard. First claimant wins; the second claimant renumbers, and it is never the delivered or reserved side.

## Acceptance criteria

- The batch skills' guard section names the same-number-different-name case and its deconfliction procedure.
- `write-tasks` instructs checking open PR heads as well as the working tree before allocating, recursing the whole `tasks/` subtree on both, and says why allocation compares numeric slots where the guard compares full numbers.
- `review-tasks` flags duplicate full task numbers across the whole subtree, with the report-don't-rename exception for archived folders.
- The matching rule distinguishes suffix families from true collisions: it compares full number+suffix, so `001`/`001a` never trip it and `024`/`024` with different slugs always does.
- The guard resolves every open PR head to a readable tree via the base repo's `refs/pull/<N>/head` rather than assuming a local ref, enumerates open PRs without relying on a default result cap, scans the whole `tasks/` subtree **recursively** rather than its top level alone, and names any head it could not scan instead of silently omitting it.

## Validation

- Walk the Scribz `024` scenario against the new text: both the writing skill (allocation) and the batch skill (pre-PR guard) now catch it at different stages.

## Review plan

Reviewer verifies the matching rule against the house numbering convention (odd primaries, even inserts, letter suffixes) and that remote-unavailable degradation is note-and-proceed, not silent skip.
