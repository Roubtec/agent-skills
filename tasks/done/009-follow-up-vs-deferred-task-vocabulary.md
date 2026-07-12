# 009 - Separate "Follow-Up" from "Deferred" in the Task-Filing Vocabulary Across the Skills

## Why this task exists

The maintainer's task-filing model distinguishes two destinations for a task file written outside its own implementation session: `tasks/` holds work **planned for implementation** (queued as soon as practical, even when it has well-specced prerequisites, so ordering can be reasoned about via numbering), while `tasks/deferred/` is a reservoir of **work we do not currently intend to schedule** — specs that depend on functionality not certain to come, issues the app cannot be having yet or that have not manifested and would cost a lot to fix, options awaiting a spike or a bake-off against a competing candidate.
Review feedback maps onto four outcomes: (1) fold the fix into the PR; (2) valid but scope-blowing → **follow-up task in `tasks/`**, queued so the feature becomes complete and the reviewer sees the feedback taken to heart; (3) valid but not actionable now for a structural reason → **deferred task in `tasks/deferred/`**, well-specced with context so it can be picked up when conditions change; (4) moot or wrong → push back, no task.
The skills currently use "defer"/"deferred" for outcome 2 — the disposition is literally named `deferred-to-task`, replies say "Deferred to tasks/0NN-…", the summary section is "Deferred to follow-up tasks" — while the only sentence that mentions `tasks/deferred/` sits directly under that disposition with no criteria ("parked, not-yet-scheduled work goes in its deferred subfolder"). A recipe-follower who has just labelled an item "deferred" is invited to file it in the "deferred" folder, which is exactly the misfiling the maintainer has observed: perfectly valid follow-up work landing in `tasks/deferred/` when it belongs in `tasks/` with prerequisites spelled out.
This task renames outcome-2 vocabulary to "follow-up" (with "postpone" as the verb where one is needed), reserves "defer"/"deferred" exclusively for outcome 3 and the `tasks/deferred/` folder, and adds explicit placement criteria with a default that leans `tasks/`.

## Scope

- Retool the task-filing vocabulary in both flavors (`plugins/` and `codex/` trees) of: `address-review`, `address-reviews`, `resolve-open-questions`, and `write-tasks`.
- Add the placement rule (queued `tasks/` by default; `tasks/deferred/` only on named criteria) where review-driven task files get written: `address-review` step 5 and `resolve-open-questions`' task-hygiene section (hoisted by task 007). `write-tasks` gets only a light default-destination note, no criteria (see notes).
- Tighten this repo's `tasks/AGENTS.md` so its `tasks/deferred/` description matches the model (see notes).
- Optionally (small, both flavors): one line in `review-tasks` so a close-out sweep also glances at `tasks/deferred/` and surfaces entries whose blocking condition looks satisfied — promotion stays a maintainer decision, the sweep only reports.
- Out of scope: frontmatter `description` fields anywhere (trigger surfaces stay byte-stable — `address-review`'s description already says "committed follow-up task file" and is acceptable as-is); benign non-filing uses of "defer" (e.g. `address-tasks`' "defer e2e to CI", `review-tasks`' "deferred to a later phase", `address-reviews`' worktree-validation note); any change to disposition mechanics, thread hygiene, publish flow, or the 007 restructure itself.

## Context and references

- The four-outcome model and folder semantics above are the maintainer's specification (recorded 2026-07-10); treat them as authoritative over any older phrasing in the skills or `tasks/AGENTS.md`.
- Current usage inventory (plugin flavor; codex twin mirrors with small line offsets):
  - `plugins/dev-skills/skills/address-review/SKILL.md` — triage label `deferred-to-task` (step 4); "For the **deferred** items…" + the `tasks/deferred/` sentence with no criteria (step 5); reviewer instruction "deferred-to-task items… with the deferral itself justified" (step 6); reply template "Deferred to tasks/0NN-…" and Summary section "Deferred to follow-up tasks" (step 7); report bullet "Deferrals…" (step 8); hands-off bullet "defer it to a committed follow-up task"; maintainer-decision wording "defer to a follow-up task" (step 3).
  - `plugins/dev-skills/skills/address-reviews/SKILL.md` — stacked-PR paragraph using `deferred-to-task` for cross-PR task records; `ping-contributing` rows ("re-raise of an already-deferred concern").
  - `plugins/dev-skills/skills/resolve-open-questions/SKILL.md` — "deferred-to-task dispositions" as a work-list source; options axis "*defer / leave as-is*" and "add the do-now-vs-defer axis"; recommendation heuristics ("Dormant → lean **defer**", "Impossible until a named prerequisite → **defer**", "recommend the committed task/deliberate build"); the task-hygiene rules (hoisted by task 007).
  - `plugins/dev-skills/skills/write-tasks/SKILL.md` — no placement guidance at all today; only a passing "review deferrals" mention.
  - `tasks/AGENTS.md` (this repo) — describes `tasks/deferred/` as "not yet actionable (e.g. because their prerequisites are not ready or they are optional future improvements)", which wrongly pushes prerequisite-bearing-but-planned work toward `deferred/`.
- Task 007 (`tasks/007-hoist-task-hygiene-adapter-in-resolve-open-questions.md`) restructures `resolve-open-questions`; **implement 007 before this task** so the placement rule lands in the hoisted section once. If 007 is abandoned, apply the same edits to the un-hoisted "Deferred items → task hygiene" subsection instead.

## Target files or areas

- `plugins/dev-skills/skills/{address-review,address-reviews,resolve-open-questions,write-tasks}/SKILL.md` and their `codex/dev-skills/skills/…` twins.
- `plugins/dev-skills/skills/review-tasks/SKILL.md` + twin (optional sweep line only).
- `tasks/AGENTS.md` (this repo).

## Implementation notes

1. **Rename the disposition** `deferred-to-task` → `follow-up-task` everywhere it appears (triage label, reviewer instructions, reply templates, Summary section, report bullets, `address-reviews` pass-through, `resolve-open-questions` source list). It remains **one** disposition — "resolved by a committed task file" — with placement as an explicit second decision, not two dispositions (considered & declined: a two-label split would double the disposition matrix in step 4/6/7 for a distinction that only affects the file's folder).
2. **Add the placement rule at the review-driven writing sites** (address-review step 5; the same rule restated compactly in `resolve-open-questions`' task-hygiene section): default to the repo's task folder (commonly `tasks/`) — a follow-up with prerequisites states them in the spec and is **numbered/ordered, not deferred**; place in the deferred subfolder (e.g. `tasks/deferred/`) **only** when the work is deliberately unscheduled: it depends on functionality not certain to arrive, addresses a condition that cannot occur yet or has not manifested and is costly to fix, or awaits a spike / a decision between competing options. When unsure, prefer `tasks/` — a mis-queued task is re-prioritized at batch time; a mis-deferred task is forgotten.
3. **Reply/summary wording** (address-review step 7): replies become "Follow-up task committed: `tasks/0NN-…` — queued for an upcoming batch" for queued work, and "Deferred with full context to `tasks/deferred/0NN-…` — <the condition it waits on>" for parked work, so the reviewer can see which of the two happened; the Summary section title becomes "Follow-up tasks" with deferred-placement entries explicitly flagged. Keep the existing resolve/leave-open rules untouched.
4. **`resolve-open-questions` vocabulary**: rename the options axis to distinguish the outcomes — e.g. *do it now (A/B) / postpone (follow-up task, queued) / park (deferred, condition-bound) / leave as-is* — and rephrase the recommendation heuristics so "Dormant"/"Impossible until X" lean **postpone-with-prerequisites-specced by default, park only when the waking condition is genuinely uncertain**; "defer" as a bare verb should no longer be the recommended label for queued follow-up work. The task-hygiene section gains the placement rule (note 2) plus one line on promotion: a deferred task whose condition has arrived moves to `tasks/` and takes a number.
5. **`write-tasks` stays the suite's most generic skill** (maintainer decision 2026-07-10) — do **not** put the queued-vs-deferred criteria here; they live with the review-facing callers. Add only a short default-destination note: honor an explicit folder and/or numbering the user or invoking skill supplies; otherwise default to the repo's task folder (commonly `tasks/`), creating it if it does not exist, and follow the repo's documented numbering house style (e.g. a `tasks/AGENTS.md`) when continuing the sequence.
6. **`tasks/AGENTS.md`**: reword the deferred sentence so the criterion is *intent not to schedule*, not *has unmet prerequisites* — e.g. "Tasks we want to keep specced but do not currently plan to implement (uncertain prerequisites, conditions that cannot occur yet, options pending a spike or bake-off) live in `tasks/deferred/`; a planned task with unmet prerequisites stays in `tasks/` with the prerequisites stated, so ordering stays visible. Deferred tasks move to `tasks/` (and take a number) when we decide to act on them."
7. Keep both flavors textually parallel; skills stay repo-agnostic ("follow whatever layout the repo already uses" survives — the criteria travel with the *e.g.* folder names). Match each file's existing wrapped style; do not reflow untouched paragraphs.

## Acceptance criteria

- `grep -rn "deferred-to-task" plugins/ codex/` returns nothing; the disposition reads `follow-up-task` consistently across triage, review, publish, report, and pass-through text in both flavors.
- In the edited skills, "defer"/"deferred" refers only to `tasks/deferred/`-style parking (or appears in the untouched benign uses listed in Scope); queued outcome-2 work is called "follow-up" (noun) / "postpone" (verb) throughout.
- The placement rule with the lean-toward-`tasks/` default and the named deferred criteria appears at both review-driven writing sites (address-review step 5, resolve-open-questions task hygiene), phrased once per file, not duplicated within a file; `write-tasks` carries only the generic default-destination note with no deferred criteria.
- Frontmatter of every touched skill is byte-identical to before.
- `tasks/AGENTS.md` no longer names unmet prerequisites as a deferral criterion.
- Both flavors mirror; the PR notes the 007 ordering dependency and how it was handled.

## Validation

- No build applies. `git diff` shows no frontmatter hunks and no files outside the listed targets.
- Grep sweep per the first two acceptance criteria; manually read address-review steps 4–8 end to end in one flavor to confirm the renamed disposition threads through coherently (triage → reviewer → reply → summary → report).
- Diff the two flavors' changed hunks against each other for parity.

## Review plan

Reviewer greps for leftover `deferred-to-task` and for "defer" used on queued work, reads the two placement-rule sites for consistency of criteria and default and `write-tasks` for the criteria-free default note, confirms frontmatter stability and flavor parity, and checks the `tasks/AGENTS.md` reword matches the maintainer's model stated in this task.
