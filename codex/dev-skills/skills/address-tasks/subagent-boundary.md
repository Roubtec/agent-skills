# Subagent destroy boundary

You were sent here by the prompt that started you. This binds you for the whole of your task.

- **Permitted:** reading, searching, and read-only `git`/`gh` queries. If your prompt assigns you a worktree or branch to change, also edits, commits, and pushes confined to that worktree and branch.
- **Forbidden, named outright:** `rm -rf`, `git reset --hard`, `git clean`, `git branch -f`, `git update-ref`, `git gc`, and force-pushing — each of them beyond what your prompt itself spells out, whether as an exact command or as a skill it names to invoke.
  You may not authorize one yourself by going somewhere you believe is safe: forbidden **not in a clone, not in a temp directory, not "safely"**.
  What your prompt spelled out, the disposable location below, and the probe directory in the next bullet are the only exemptions.
- **A probe directory you made is yours to remove, and nothing else is.**
  That is a directory you yourself created this turn with `mktemp -d` under a destination your prompt named, removed by the exact path `mktemp` printed, held in a variable guarded against being empty: `rm -rf -- "${P:?}"`. Nothing found by a glob or by name, nothing outside that destination, and no other command on the list.
- **Uncommitted work is never discarded, yours or anyone else's.**
  `git checkout -- <path>`, `git restore`, and a bare `git stash` have each thrown it away. The one use that stands is putting a committed file back after a control you ran on it, once your own work is committed and the file holds nothing uncommitted but that control's edit.
- **A worktree is not a blast radius.**
  It isolates the working tree, not the repository: `branch -f`, `reset`, `update-ref`, and `gc` all reach every sibling worktree through the shared `.git`. Where you share one working tree with other agents, not even the tree is yours.
- **Any repository other than your own checkout is addressed by path.**
  Use `git -C <absolute path>`. Never derive a working directory from a glob, and never chain a state-changing git command after a `cd` whose success you have not checked.
- **Empirical verification that could change state goes only where your prompt sent you.**
  That is a disposable clone: `DC="$(dc-enter <slug>)"` with the slug your prompt names, which prints one absolute path, dropped again with `dc-remove <slug>`. A reused slug is refused rather than re-derived, so anything that may run twice passes `--replace` or removes the slug first.
  If your prompt named no slug, you were not sent anywhere: do not pick a destination, report that the check needs one.
  If `dc-enter` is not found, install it from the dev-skills plugin `bin/` rather than improvising a destination.
  Enter it with the guarded form, because `cd ""` returns 0 and moves nowhere: `cd -- "${DC:?dc-enter returned no path — see its error above; if it is not installed, install it from the dev-skills plugin bin/}"`, and confirm `pwd` before the first command that writes.
- **Install nothing system-wide or global.**
  Every agent in the session shares this machine, so a system package (`apt-get`) or a global one (`npm -g`, `pip` outside a virtual environment) you install or upgrade changes it for all of them: report the need instead. The `dc-enter` install above is the one named exception.
- **Stop only a process you started.**
  Record its PID when you start it and stop that PID; never one found by name or pattern (`pkill`, `killall`, `kill $(pgrep …)`), which reaches other agents' processes.

Why this exists: a reviewer once ran `rm -rf ./*` in a shared main checkout because its `git clone … | tail` setup had failed invisibly (a pipeline's status is its last command), and a fixer once ran `cd "$(ls -d <scratchpad>/tmp.*)" ; git commit …` where the glob matched three directories, so the `cd` failed and the commit landed on `main`.
