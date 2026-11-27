# 073 — Run the peer review as a background command of the orchestrator

## Why this task exists

In the review cycle the peer occupies a whole spawned role every round.
That role's only job is to make one foreground call to `review-cycle/peer.sh` and hand back the classified answer.
The alternative is for the orchestrator to start that call itself as a background command its harness tracks, and to read the answer when the harness reports the command finished.

This file records that the idea was considered, so the next person to notice the cost does not have to rediscover the reasoning.
**Not doing this task at all is an explicit and acceptable outcome.**

## What it would save

- One subagent spawn per round for each entry, and a second where the optional second peer runs: the spawn's latency, its tokens, and a context that reads a brief in order to run one command.
- One relay. A role between the script and the orchestrator can paraphrase an outcome or a reason that the batch throttle matches literally, or return without having run the script.

## What it reverses

- Task 055 chose to keep the launch model: the helper runs exactly once, in the foreground, inside the concurrently started Peer role, and is never backgrounded, polled or signalled. "The peer step" in `review-cycle/SKILL.md` says the same to every orchestrator.
- That rule exists because improvised background launches were the largest source of peer failures before the launch was scripted: no completion signal, a launch waiting on an open stdin, and teardown by guesswork.

## Why it is deferred rather than queued

The maintainer considered this and decided not now.
Waiting for a peer's answer takes some intelligence and can be a little flaky, and the question has come up before.
The foreground call has one property the alternative lacks: the answer arrives in the same turn that asked for it.
A background command makes the round decision depend on a completion notice that has to be matched to the right round and entry, that may arrive after the Reviewer has already returned, and whose absence has to be noticed by something.

Task 066 addresses the surrounding problems inside the current model: one launch form in every skill, a budget that fits the review, and a round with no peer result made detectable.
Whether any need remains is only knowable once those fixes have been used.

## Trigger to promote this task

Promote only on an observation, cited with the run it came from, made after task 066 has landed:

- the Peer role itself is a measurable share of a round's cost or a repeated source of failure (a role that returned without running the script, or altered what the script answered), **and**
- the harness's background commands are shown to report completion reliably for a command of this length: exactly once, attributable to the command that started it, and still delivered after the orchestrator's context has been compacted.

Either one alone is not enough.
A costly role with no reliable completion signal reproduces the old failures, and a reliable signal with no observed cost is a change for its own sake.

## Scope if promoted

- Decide whether the orchestrator-run call replaces the Peer role or is a second sanctioned form, and prefer replacing: two launch forms is the state task 066 removes.
- Say in "The peer step" how a completion notice is tied to its round and entry, and what the round decision does when none arrives. The per-round record task 066 adds is the natural thing to read.
- Keep `peer.sh` as the only launcher. This changes who calls it and how the caller waits, not what it does.
- Carry the change into both mirrors and the workflows, where a stage already awaits its own calls and the question may not arise at all.

## Context and references

- Task 055, for the launch model and why it was kept, and task 066, for the fixes that come first.
- `plugins/dev-skills/skills/review-cycle/SKILL.md` → "Roles" (the Peer) and "The peer step".
