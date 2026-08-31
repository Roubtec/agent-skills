---
name: resolve-tasks
description: Task pointers - numbers, file paths, globs - need to be turned into a definite, provenance-tagged set of task files. Trigger when the user asks to resolve, look up, or inspect task pointers, or run resolve-tasks; task-consuming skills call it before planning work. Read-only - it never edits, moves, or renumbers task files. Not for review-skill numbers, which are PR numbers.
---

# Resolve task pointers

Resolve task pointers before a consumer plans work, without changing the repository.

**Arguments:** `<mixed-list of task numbers, task-file paths, and globs>`

This skill is read-only.
It may read repository guidance and recursively inspect the task tree, but it never edits, moves, archives, promotes, or renumbers a task file.

## Resolution

1. Resolve the repository root and its task folder from repository guidance first, then established layout; do not assume `tasks/` when the repository names another folder.
2. Read the task folder's naming guidance.
   Infer a documented or de-facto convention from the files when no guidance exists, including non-numeric schemes such as the `A-01-...` fallback emitted by `write-tasks`; do not force another repository through this repository's convention.
3. Deduplicate identical raw inputs while retaining their first-seen order.
   Interpret an existing well-formed task-spec path as a path before considering number syntax; interpret a token containing glob metacharacters as a glob; interpret a token admitted by the resolved numbering convention as a number; treat every other token as an explicit path under the path semantics below.
4. Inventory well-formed task spec files recursively through the whole task subtree, including `done/`, `deferred/`, and future nested folders.
   A well-formed task spec follows the repository's resolved task-filename convention and its task-document form; a filename-shaped arbitrary file is not a task spec.
   This includes conventions inferred from the repository's real specs, such as `A-01-...`, rather than admitting arbitrary files just because they were named explicitly.
   Under this repository's three-digit convention, use the full-number parsing definition owned by Task 027; accept an unpadded numeric input such as `27` as `027`.
   A suffixed number such as `015b` selects only `015b`, and a bare primary such as `015` selects only `015`, never the suffixed family.
5. Resolve each number against the inventory and each explicit path or glob using the invoking consumer's documented path/glob semantics.
   When this skill is invoked directly or a consumer defines no different semantics, resolve a literal path relative to the repository root and expand shell-style glob metacharacters relative to that root without shell evaluation; an absent literal or unmatched glob selects nothing.
   Number inputs select only well-formed task specs in the resolved task subtree.
   Explicit paths and globs retain the consumer's existing reach, but not arbitrary-file reach: include every existing well-formed task spec they would already have selected, including one outside the resolved task subtree.
   Deduplicate the resulting paths, but attach every selecting raw input to each path as `{ raw, kind }`, where `kind` is `number`, `path`, or `glob`.
   This provenance is authoritative for consumer policy: consumers must not re-resolve an input to decide how a selected path entered the set.
6. Classify each matched **full number**, once across the entire subtree:
   - `ambiguous` when more than one inventoried file carries that full number, regardless of folder or slug.
   - `done` when its sole file is within the task folder's `done/` subtree.
   - `deferred` when its sole file is within the task folder's `deferred/` subtree.
   - `active` when its sole file is anywhere else in the task subtree.

`ambiguous` takes precedence over folder classifications: a half-finished move with one copy active and one in `done/` is ambiguous, not active or done.
Globs are never classified as a unit; every matched file participates in the classification of the full number it carries.

For every raw number, path, or glob that selects no well-formed task file, emit one `not-found` diagnostic keyed to that raw input.
Keep these diagnostics separate from number classifications because an unmatched input has no file and therefore no full number to classify.

An explicitly selected task file outside the resolved task subtree is not `not-found` and has no subtree classification.
Report its `classification` as `outside-subtree`, retain any full number parsed from its well-formed filename on the path entry for context, and omit that number from `numbers`; the four-way full-number classification is exclusively a statement about the resolved task subtree.
Do not invent `active`, `done`, or `deferred` status for an external path.

## Result packet

Return one mechanically usable task-resolution packet with exactly these top-level collections:

- `paths`: the deduplicated repository-relative task paths in stable input/discovery order; each entry carries `path`, `number`, `classification`, and `selectedBy: [{ raw, kind }]`.
  `classification` is one of the four subtree classifications or `outside-subtree` for an explicitly selected external task file.
- `numbers`: one entry for every inside-subtree full number represented in `paths`, carrying `number`, `classification`, and every inventoried `path` for that number.
  An outside-subtree path contributes no entry.
  This is a per-number view, never a per-input or per-glob classification.
- `notFound`: one entry per unmatched deduplicated raw input, carrying `raw`, `kind`, and a concise diagnostic.

For an ambiguous **number input**, include every candidate in both `paths` and `numbers`; selection or exclusion is consumer policy, not resolution.
An explicit path or glob does not pull an unselected same-number sibling into `paths`, although `numbers` still lists every inventoried path that made an inside-subtree selected file's classification ambiguous.
Include classifications for explicitly selected inside-subtree paths as report context even when the consumer will execute them regardless of classification; an outside-subtree explicit selection carries only the `outside-subtree` status defined above.

## Boundary with consumers

This module resolves and reports only.
A consumer decides whether a number-resolved `done`, `deferred`, or `ambiguous` file is executable, and uses `selectedBy` to distinguish those number selections from explicit paths and globs.
If any path has both number and explicit provenance, it counts as explicitly selected for that consumer decision.

Do not apply this module to `address-review` or `address-reviews`: numbers passed to those review skills are PR numbers, not task numbers.
