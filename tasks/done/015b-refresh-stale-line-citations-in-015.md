# 015b — Re-derive task 015's stale line citations and stamp their reference frame

## Why this task exists

`tasks/015-adopt-peer-review-run-in-review-skills.md` pins around twenty line numbers into the peer sections of the ten skill files its pre-014 target list names. Most no longer resolve — `plugins/dev-skills/skills/address-tasks/SKILL.md:44` still names the peer preflight it is cited for, but it is the exception — and unlike `tasks/012b` and `tasks/014a` the file carries **no "as of PR #N" stamp**, so a reader takes them all as current and follows most of them into blank lines or unrelated prose. Nothing in the file marks which few still hold.

The staleness has two separate causes, which is why a blanket offset cannot fix it:

- **Task 014 (PR #39) moved the anchors out of the consumer skills.** Extracting the peer step into `review-cycle` deleted 92/84/40/38/55 lines from the five codex-side consumer mirrors and 34/25/34/30/6 from their plugins-side counterparts. `plugins/dev-skills/skills/address-tasks/SKILL.md:140` was exactly the batch launch line `codex exec --sandbox read-only --cd "${worktree}" -o "${outfile}" \` at `main` and is blank at PR #39's tip; the launch itself now lives at `plugins/dev-skills/skills/review-cycle/SKILL.md:67`. `codex/dev-skills/skills/address-tasks/SKILL.md:185`, the `claude -p … < "${prompt_file}"` stdin form at `main`, moved the same way.
- **Several citations, on both sides, were already stale before PR #39.** Checked against `main`: `plugins/dev-skills/skills/address-review/SKILL.md:187` is the "Assign every per-invocation value first" prose where 015 cites it for the raw launch snippet, which sat nine lines below at `:196` — and 015's companion range `:180-195` stops one line short of that snippet, so it never contained what it names. On the codex side, `codex/dev-skills/skills/address-review/SKILL.md:222` is the `claude -p --model opus …` line where 015 cites it for the "do not infer the PGID" rule; `:199` is reviewer criteria where 015 quotes it for "can orphan `claude` or its descendants"; `:227-229` is a `peer_wait_pid=` / `peer_launch_status=125` / `fi` fragment where 015 describes the PGID handoff and `kill -0` probe. Those three anchors are now around `codex/dev-skills/skills/review-cycle/SKILL.md:84`, except the "can orphan" text, which is at `:61`.

015 is a long, carefully argued file whose value is precisely that an implementer can follow it to the exact construct under discussion. Stale pointers into look-alike shell text are worse than none.

## Scope

Included:

- Re-derive every line and range citation in `tasks/015-…md` against the tree at the time this task is implemented. Where the construct moved into `review-cycle`, re-point the citation at its new home and adjust the surrounding sentence, which in several places describes a per-skill copy that no longer exists.
- Add an explicit as-of stamp naming the reference frame, in the form `tasks/012b-…md:28` and `tasks/014a-…md:45` already use.
- Reconcile the "Context and references" and "Target files or areas" sections of 015 with the post-014 layout. 015 already says "The per-skill target list below describes the pre-014 world", but that sentence covers the target list, not the citations scattered through the Scope bullets.

Out of scope:

- Any behavioral change to the peer step, the throttle policy, or the `peer-review-run` adoption 015 specifies. This task touches citations and their framing only.
- `tasks/done/027-…md:12`, which cites `address-tasks/SKILL.md:179-185` and is likewise stale. Archived task files are a record of what was done; leave them.

## Context and references

- Raised by the fresh-eyes reviewer during the review-addressing round on PR #39 (task 014); agent-proposed, not maintainer-directed, so confirm it is wanted before scheduling.
- Sequencing: no hard prerequisite, but it is cheapest immediately before 015 is implemented, since 015's own edits move the same anchors again. Doing it after 015 lands wastes the work.
- `tasks/012b-…md:28` and `tasks/014a-…md:45` — the as-of stamp wording to mirror.

## Target files or areas

- `tasks/015-adopt-peer-review-run-in-review-skills.md` — the only file this task edits.
- Read-only sources for re-deriving the anchors: `plugins/dev-skills/skills/{review-cycle,address-review,address-reviews,address-tasks,address-tasks-serialized,resolve-open-questions}/SKILL.md`, their `codex/dev-skills/skills/` mirrors, and `plugins/dev-skills/workflows/wf-review-cycle.js`.

## Implementation notes

Locate the construct the prose names, then read its line number off the file — never shift an existing number by a computed offset. The offsets differ per file, several anchors crossed into a different file entirely, and the two causes above overlap on both mirror sides, so an offset that looks right for one citation is wrong for the next. A citation that still resolves is not evidence its neighbours do.

Where an anchor no longer exists as a per-skill copy, fixing the number alone leaves a false sentence. Rewrite the claim to name the canonical home, rather than pointing at whatever now occupies those lines.

Cite a range only where the prose genuinely discusses a span; a single line is easier to keep true.

## Acceptance criteria

- Every line and range citation in `tasks/015-…md` resolves, at the implementing tip, to the construct its surrounding prose names — verified individually, not by offset arithmetic.
- The file states its citation reference frame explicitly.
- No sentence in 015 describes a per-skill peer-launch copy that PR #39 removed as though it were still there.
- No citation was silently dropped to avoid re-deriving it; a claim that loses its anchor is rewritten, not deleted.

## Validation

- For each citation, print the cited line or range from the current tip and record the construct found beside the claim it supports — the check is that the two match, so a bare exit status is not evidence.
- Confirm the count of citations before and after is accounted for, so none was dropped in passing.
- No build or workflow parse-check applies: this task edits one Markdown task file and touches no shipped skill or workflow source.

## Review plan

Reviewer should re-resolve every citation independently rather than trusting the implementer's table, and should check the rewritten sentences against the post-014 layout — the failure mode this task exists to prevent is a number that resolves to plausible-looking text that is not the construct the prose means.
