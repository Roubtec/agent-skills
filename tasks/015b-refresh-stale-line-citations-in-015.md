# 015b — Re-derive task 015's stale line citations and stamp their reference frame

## Why this task exists

`tasks/015-adopt-peer-review-run-in-review-skills.md` pins around twenty line numbers into the peer sections of the ten skill files it will edit. Those citations no longer resolve, and unlike `tasks/012b` and `tasks/014a` the file carries **no "as of PR #N" stamp**, so a reader takes them as current and follows them into blank lines or unrelated prose.

The staleness has two separate causes, which is why a blanket offset cannot fix it:

- **Task 014 (PR #39) moved the Claude-side anchors.** Extracting the peer step into `review-cycle` removed 92/84/40/38/55/34/25/34/30 lines from the six consumer skills. `plugins/dev-skills/skills/address-tasks/SKILL.md:140` was exactly the batch launch line `codex exec --sandbox read-only --cd "${worktree}" -o "${outfile}" \` at `main` and is blank at PR #39's tip; the launch itself now lives at `plugins/dev-skills/skills/review-cycle/SKILL.md:67`. `plugins/dev-skills/skills/address-review/SKILL.md:187` and `codex/dev-skills/skills/address-tasks/SKILL.md:185` moved the same way.
- **Several codex-mirror citations were already stale before PR #39.** Checked against `main`: `codex/dev-skills/skills/address-review/SKILL.md:222` is the `claude -p --model opus …` line where 015 cites it for the "do not infer the PGID" rule; `:199` is reviewer criteria where 015 quotes it for "can orphan `claude` or its descendants"; `:227-229` is a `peer_wait_pid=` / `peer_launch_status=125` / `fi` fragment where 015 describes the PGID handoff and `kill -0` probe. Those anchors are now at `codex/dev-skills/skills/review-cycle/SKILL.md:84` and nearby.

015 is a long, carefully argued file whose value is precisely that an implementer can follow it to the exact construct under discussion. Stale pointers into look-alike shell text are worse than none.

## Scope

Included:

- Re-derive every line and range citation in `tasks/015-…md` against the tree at the time this task is implemented, by locating the construct the surrounding prose names rather than by applying an offset. Where the construct moved into `review-cycle` (canonical prose `plugins/dev-skills/skills/review-cycle/SKILL.md`, codex mirror `codex/dev-skills/skills/review-cycle/SKILL.md`, workflow rendering `plugins/dev-skills/workflows/wf-review-cycle.js`), re-point the citation at its new home and adjust the surrounding sentence, which in several places describes a per-skill copy that no longer exists.
- Add an explicit as-of stamp naming the reference frame, in the form `tasks/012b-…md:28` and `tasks/014a-…md:45` already use.
- Reconcile the "Context and references" and "Target files or areas" sections with the post-014 layout: 015 already says "The per-skill target list below describes the pre-014 world", but that sentence covers the target list, not the citations scattered through the Scope bullets.

Out of scope:

- Any behavioral change to the peer step, the throttle policy, or the `peer-review-run` adoption 015 specifies. This task touches citations and their framing only.
- `tasks/done/027-…md:12`, which cites `address-tasks/SKILL.md:179-185` and is likewise stale. Archived task files are a record of what was done; leave them.

## Acceptance criteria

- Every line and range citation in `tasks/015-…md` resolves, at the implementing tip, to the construct its surrounding prose names — verified individually, not by offset arithmetic.
- The file states its citation reference frame explicitly.
- No sentence in 015 describes a per-skill peer-launch copy that PR #39 removed as though it were still there.

## Context and references

- Raised by the fresh-eyes reviewer during the review-addressing round on PR #39 (task 014); agent-proposed, not maintainer-directed, so confirm it is wanted before scheduling.
- Sequencing: no hard prerequisite, but it is cheapest to do immediately before 015 is implemented, since 015's own edits will move these anchors again. Doing it after 015 lands wastes the work.
- `tasks/012b-…md:28` and `tasks/014a-…md:45` — the as-of stamp wording to mirror.
