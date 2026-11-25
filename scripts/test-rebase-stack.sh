#!/usr/bin/env bash
# Hermetic test for the rebase-stack helper
# (plugins/dev-skills/skills/rebase-stack/stack.sh).
#
# Every case builds a throwaway repository under one temp directory and never
# touches this one or the network. Where the helper only plans, the plan is
# then carried out with the real `git rebase` it names, so what it calls safe
# is shown to be. Needs Bash, git and coreutils.
# shellcheck disable=SC2319 # `ok <label> $?` after a `[ … ]` test is the point
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SHIPPED="$SCRIPT_DIR/../plugins/dev-skills/skills/rebase-stack/stack.sh"
HELPER="${STACK_HELPER:-$SHIPPED}"
MIRROR="$SCRIPT_DIR/../codex/dev-skills/skills/rebase-stack/stack.sh"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.test GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.test

checks=0
fails=0
ok() { # <label> <condition status>
	checks=$((checks + 1))
	if [ "$2" != 0 ]; then
		fails=$((fails + 1))
		printf 'FAIL [%s]\n' "$1" >&2
	fi
}
has() { # <label> <haystack> <needle>
	case "$2" in *"$3"*) ok "$1" 0 ;; *)
		ok "$1" 1
		printf '      wanted: %s\n      got:    %s\n' "$3" "$2" >&2
		;;
	esac
}
lacks() { # <label> <haystack> <needle>
	case "$2" in *"$3"*)
		ok "$1" 1
		printf '      unwanted: %s\n      in:       %s\n' "$3" "$2" >&2
		;;
	*) ok "$1" 0 ;; esac
}
is() { # <label> <actual> <expected>
	if [ "$2" = "$3" ]; then ok "$1" 0; else
		ok "$1" 1
		printf '      wanted: %s\n      got:    %s\n' "$3" "$2" >&2
	fi
}
commit() { # <file> <content> → a commit on the current branch of $R
	printf '%s\n' "$2" >"$R/$1"
	git -C "$R" add "$1"
	git -C "$R" commit -q -m "$1: $2"
}
tip() { git -C "$R" rev-parse "refs/heads/$1"; }
run() { # <command> [args...] → OUT (stdout), ERR (stderr), RC
	OUT="$(cd "$R" && bash "$HELPER" "$@" 2>"$WORKDIR/err")"
	RC=$?
	ERR="$(cat "$WORKDIR/err")"
}
val() { printf '%s\n' "$OUT" | sed -n "s/^$1=//p" | head -n 1; }
vals() { printf '%s\n' "$OUT" | sed -n "s/^$1=//p"; }
field() { # <branch line> <n> → the n-th tab-separated field
	printf '%s\n' "$1" | cut -f"$2"
}

# stack → R: main (m1), and f1 ⊂ f2 ⊂ f3, two commits each, cut in sequence.
stack() {
	R="$(mktemp -d "$WORKDIR/case.XXXXXX")"
	git init -q -b main "$R"
	commit m1 one
	local b prev=main
	for b in f1 f2 f3; do
		git -C "$R" checkout -q -b "$b" "$prev"
		commit "$b-a" one
		commit "$b-b" one
		prev="$b"
	done
}
# land <branch> → main moves on by one commit of its own, then takes that
# branch's commits by cherry-pick: the same patches under new hashes, which is
# what rebase-and-merge leaves behind.
land() {
	git -C "$R" checkout -q main
	commit m2 one
	git -C "$R" cherry-pick "main@{1}..$1" >/dev/null 2>&1 || git -C "$R" cherry-pick "$(git -C "$R" merge-base main "$1")..$1" >/dev/null
}

# --- 1. preflight -------------------------------------------------------------
stack
run preflight
is "1: a clean tree on a branch is ready" "$(val outcome)" ready
is "1: the source defaults to the current branch" "$(val source)" f3
is "1: the target defaults to main" "$(val target)" main
is "1: ...by its commit" "$(val target-oid)" "$(tip main)"
git -C "$R" tag main f1
run preflight
is "1: a tag named like the target does not answer for the branch" "$(val target-oid)" "$(tip main)"
git -C "$R" tag -d main >/dev/null
case "$(val stamp)" in [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]) ok "1: it hands out the run's one stamp" 0 ;; *) ok "1: it hands out the run's one stamp" 1 ;; esac
echo x >"$R/stray"
run preflight
is "1: an untracked file does not stop it" "$(val outcome)" ready
is "1: ...but is counted, for the caller to weigh against the checkouts ahead" "$(val untracked)" 1
rm "$R/stray"
echo changed >"$R/m1"
run preflight
is "1: a modified file is a stop" "$(val outcome)" dirty
is "1: ...with exit 3" "$RC" 3
git -C "$R" checkout -q -- m1
mkdir "$R/.git/rebase-merge"
run preflight
is "1: a rebase in progress is a stop" "$(val outcome)" rebase-in-progress
rmdir "$R/.git/rebase-merge"
mkdir "$R/.git/rebase-apply"
run preflight
is "1: ...under either backend" "$(val outcome)" rebase-in-progress
rmdir "$R/.git/rebase-apply"
mkdir "$R/.git/rebase-merge"
echo changed >"$R/m1"
run preflight
is "1: a paused rebase with a dirty tree is named as the rebase, not as dirt" "$(val outcome)" rebase-in-progress
git -C "$R" checkout -q -- m1
rmdir "$R/.git/rebase-merge"
mkdir "$R/sub"
echo x >"$R/stray"
echo y >"$R/sub/stray"
OUT="$(cd "$R/sub" && bash "$HELPER" preflight 2>/dev/null)"
is "1: untracked files are counted over the whole tree, from wherever it is asked" "$(val untracked)" 2
rm -r "$R/stray" "$R/sub"
run preflight --source nope
is "1: a source that is no branch is a stop" "$(val outcome)" no-source
run preflight --target nope
is "1: so is a target that resolves to nothing" "$(val outcome)" no-target
git -C "$R" checkout -q --detach
run preflight
is "1: a detached HEAD names no source" "$(val outcome)" no-source
run preflight --source f2
is "1: ...unless one is given" "$(val source)" f2
git -C "$R" branch -q -m main master
run preflight --source f3
is "1: with no main, the target is master" "$(val target)" master
git -C "$R" branch -q -m master trunk
run preflight --source f3
is "1: with neither, the target has to be named" "$(val outcome)" no-target

# --- 2. detect ------------------------------------------------------------------
# f1 has landed on main under new hashes; f2 grew a fix after f3 was cut.
stack
land f1
git -C "$R" checkout -q f2
commit f2-fix one
git -C "$R" branch -q snap "f2~1"
git -C "$R" branch -q unrelated main
git -C "$R" checkout -q -b above f3
commit above one
git -C "$R" checkout -q f3
run detect --source f3 --target main
is "2: a chain is found" "$(val outcome)" chain
is "2: the frontier is the newest source commit main already carries by patch" "$(val ef)" "$(tip f1)"
is "2: ...named as such" "$(val ef-kind)" patch-equivalent
is "2: ...with the count of them" "$(val equivalent)" 2
is "2: the chain is f2 then the source" "$(vals branch | cut -f1 | tr '\n' ' ')" "f2 f3 "
LINE="$(vals branch | head -n 1)"
is "2: each branch carries its tip" "$(field "$LINE" 2)" "$(tip f2)"
is "2: ...its commits past the branch above it" "$(field "$LINE" 3)" 1
is "2: ...that branch's name" "$(field "$LINE" 4)" f3
is "2: ...and its tip's subject" "$(field "$LINE" 5)" "f2-fix: one"
is "2: the source closes the list" "$(vals branch | tail -n 1 | cut -f3,4)" "0	source"
has "2: a ref with no commits of its own is a near miss, not a chain branch" "$OUT" "near=snap	no commits of its own past f3"
is "2: a branch the source is an ancestor of is flagged as the likelier source" "$(val checkpoint)" above
lacks "2: a branch off the target is neither" "$OUT" "unrelated"
lacks "2: the landed branch is not in the chain" " $(vals branch | cut -f1 | tr '\n' ' ')" " f1 "
lacks "2: with no cached origin ref, nothing is said of one" "$OUT" "origin-oid"
is "2: the frontier's subject is given for the listing" "$(val ef-subject)" "f1-b: one"
git -C "$R" tag f2 main
git -C "$R" tag unrelated f3
run detect --source f3 --target main
is "2: a tag sharing a branch's name changes nothing" "$(vals branch | cut -f1,2 | tr '\n' ' ')" "f2	$(tip f2) f3	$(tip f3) "
git -C "$R" tag -d f2 unrelated >/dev/null
run detect --source f1 --target main
is "2: standing on the landed branch, the branch above it is still flagged" "$(vals checkpoint | tr '\n' ' ')" "above f2 f3 snap "
is "2: ...and never listed as a chain branch below it" "$(vals branch | cut -f1)" f1
git -C "$R" update-ref refs/remotes/origin/main "$(tip main)~1"
run detect --source f3 --target main
is "2: a cached origin ref is reported" "$(val origin-oid)" "$(git -C "$R" rev-parse 'main~1')"
is "2: ...with how far local is ahead of it" "$(val origin-behind) $(val origin-ahead)" "1 0"

git -C "$R" checkout -q f1
commit f1-late one
git -C "$R" checkout -q f3
run detect --source f3 --target main
lacks "2: a landed branch that grew a late commit forks AT the frontier, so it is still not a chain branch" " $(vals branch | cut -f1 | tr '\n' ' ')" " f1 "

# Nothing landed: the frontier is the plain merge-base.
stack
git -C "$R" checkout -q f1
commit f1-fix one
git -C "$R" checkout -q f3
run detect --source f3 --target main
is "2: with nothing patch-equivalent, the frontier is the merge-base" "$(val ef) $(val ef-kind)" "$(tip main) merge-base"
is "2: a branch with a fix of its own is a chain branch" "$(vals branch | cut -f1 | tr '\n' ' ')" "f1 f3 "
has "2: ...and one without is reported, since auto-detection cannot carry it" "$OUT" "near=f2"
git -C "$R" checkout -q f2
commit f2-fix one
git -C "$R" checkout -q f3
run detect --source f3 --target main
is "2: candidates are ordered from the frontier up" "$(vals branch | cut -f1 | tr '\n' ' ')" "f1 f2 f3 "
is "2: ...each counted against the next" "$(vals branch | cut -f3,4 | tr '\n' ' ')" "1	f2 1	f3 0	source "

stack
run detect --source f3 --target main
is "2: a chain whose branches hold nothing of their own is 'empty', to be confirmed" "$(val outcome)" empty
is "2: ...with the source still listed" "$(vals branch | cut -f1)" f3
run detect --source f3
is "2: detect needs both ends" "$RC" 64
run detect --source nope --target main
is "2: a source that is no branch is a failure" "$RC" 1

# --- 3. segments ----------------------------------------------------------------
stack
run segments f1 f2 f3
is "3: a chain of ancestors is one run" "$(vals segment)" "run f1 f2 f3"
git -C "$R" checkout -q f1
commit f1-fix one
run segments f1 f2 f3
is "3: a branch that grew past its successor stands alone" "$(vals segment | tr '\n' '|')" "single f1|run f2 f3|"
git -C "$R" checkout -q f2
commit f2-fix one
run segments f1 f2 f3
is "3: ...and so on down the chain" "$(vals segment | tr '\n' '|')" "single f1|single f2|single f3|"
run segments f1 nope
is "3: a name that is no branch is a failure" "$RC" 1

# --- 4. qualify, and the replay it names ------------------------------------------
stack
git -C "$R" checkout -q main
commit m2 one
run qualify --base main f1 f2 f3
is "4: a clean linear run qualifies" "$(val outcome)" combined
is "4: ...from its one fork" "$(val fork)" "$(git -C "$R" rev-parse 'main~1')"
is "4: ...with the replay spelled out against the base's commit" "$(val replay)" "git rebase --update-refs --no-rebase-merges --no-fork-point $(tip main) f3"
lacks "4: this tree stands on no run branch, so nothing has to step aside" "$OUT" "detach-first"
git -C "$R" checkout -q f2
run qualify --base main f1 f2 f3
is "4: standing on a run branch, the tree is told to step aside first" "$(val detach-first)" f2
git -C "$R" checkout -q main
git -C "$R" cherry-pick f3 >/dev/null 2>&1
run qualify --base main f1 f2 f3
is "4: the LAST tip may already be on the base by patch; only the ones before it must be replayed" "$(val outcome)" combined
git -C "$R" reset -q --hard HEAD~1
git -C "$R" tag f2 main
git -C "$R" branch -q other "main~1"
git -C "$R" tag other main

# Carry it out, then verify and restore.
STAMP=20260101-000000
BEFORE="$(tip f1) $(tip f2) $(tip f3)"
run snapshot --stamp "$STAMP" f1 f2 f3
is "4: the run is snapshotted" "$(val outcome)" saved
is "4: ...one ref per branch" "$(git -C "$R" rev-parse "refs/pre-rebase/f1/$STAMP" "refs/pre-rebase/f2/$STAMP" "refs/pre-rebase/f3/$STAMP" | tr '\n' ' ')" "$BEFORE "
run verify --stamp "$STAMP" --base main f1 f2 f3
is "4: before the replay, the run has not moved off its snapshot" "$(val outcome)" postcondition-failed
run verify --stamp "$STAMP" --base "$(git -C "$R" rev-parse 'main~1')" f1 f2 f3
is "4: ...even against a base it already sits on, in order" "$(val outcome)" postcondition-failed
has "4: ...the reason being that it did not move" "$ERR" "did not move off its snapshot"
run qualify --base main f1 f2 f3
REPLAY="$(val replay)"
(cd "$R" && eval "$REPLAY" >/dev/null 2>&1)
is "4: the replay it named runs clean, read as the shell text it is" "$?" 0
run verify --stamp "$STAMP" --base main f1 f2 f3
is "4: ...and passes verification, tags named like branches notwithstanding" "$(val outcome)" verified
git -C "$R" merge-base --is-ancestor refs/heads/main refs/heads/f1 && git -C "$R" merge-base --is-ancestor refs/heads/f1 refs/heads/f2 && git -C "$R" merge-base --is-ancestor refs/heads/f2 refs/heads/f3
ok "4: ...the run now a line on top of the base" $?
git -C "$R" checkout -q main
git -C "$R" worktree add -q --detach "$WORKDIR/elsewhere" main
OUT="$(cd "$WORKDIR/elsewhere" && bash "$HELPER" restore --stamp "$STAMP" f1 f2 f3 2>/dev/null)"
is "4: a run can be put back, from any worktree of the repository" "$(val outcome)" restored
is "4: ...every branch on its snapshot" "$(tip f1) $(tip f2) $(tip f3)" "$BEFORE"
git -C "$R" worktree remove "$WORKDIR/elsewhere"
git -C "$R" tag -d f2 other >/dev/null
git -C "$R" branch -q -D other

# What disqualifies a run.
run qualify --base "$(git -C "$R" rev-parse 'main~1')" f1 f2 f3
is "4: a run already on its base has nothing to replay together" "$(val outcome)" per-branch
has "4: ...and says so" "$(val reason)" "already starts at the base"
git -C "$R" branch -q stray "f2~1"
run qualify --base main f1 f2 f3
is "4: another local branch pointing into the range disqualifies the run" "$(val outcome)" per-branch
has "4: ...naming it" "$(val reason)" "local branch stray"
git -C "$R" branch -q -D stray
run qualify --base main f1 f3
is "4: so does a chain branch left out of the run" "$(val outcome)" per-branch
git -C "$R" worktree add -q "$WORKDIR/other" f2
run qualify --base main f1 f2 f3
is "4: a run branch checked out in another worktree disqualifies it" "$(val outcome)" per-branch
has "4: ...naming the worktree" "$(val reason)" "$WORKDIR/other"
git -C "$R" worktree remove "$WORKDIR/other"
run qualify --base main f2 f1 f3
is "4: branches out of stacking order do not qualify" "$(val outcome)" per-branch
git -C "$R" branch -q -m f3 "fix/it's"
run qualify --base main f1 f2 "fix/it's"
(cd "$R" && eval "$(val replay)" >/dev/null 2>&1)
is "4: the printed replay is shell text that survives a quote in a branch name" "$?" 0
git -C "$R" merge-base --is-ancestor main "fix/it's"
ok "4: ...and did what it said" $?
run qualify --base main f1
is "4: one branch is not a run" "$RC" 64
run qualify f1 f2
is "4: qualify needs the base" "$RC" 64

# An intermediate tip already on the base by patch would be dropped, and its ref left behind.
stack
land f1
run qualify --base main f1 f2 f3
is "4: a run whose first tip is patch-equivalent to the base does not qualify" "$(val outcome)" per-branch
has "4: ...because the replay would drop it" "$(val reason)" "patch-equivalent"
run qualify --base main f2 f3
is "4: ...while the rest of it does not qualify either, f1 still pointing into the range" "$(val outcome)" per-branch

# A base that already holds the first branch: its tip is not in the range.
stack
git -C "$R" checkout -q main
git -C "$R" merge -q --ff-only f1
commit m2 one
run qualify --base main f1 f2 f3
is "4: a run branch the base already contains does not qualify" "$(val outcome)" per-branch
has "4: ...its tip lying outside the replay range" "$(val reason)" "f1's tip is not in the replay range"

# A merge inside the run.
stack
git -C "$R" checkout -q main
commit m2 one
git -C "$R" checkout -q -b side f2
commit side one
git -C "$R" checkout -q f3
git -C "$R" merge -q --no-ff -m "merge side" side
git -C "$R" branch -q -D side
run qualify --base main f1 f2 f3
is "4: a run carrying a merge does not qualify" "$(val outcome)" per-branch
has "4: ...and says why" "$(val reason)" "merge commit"

# --- 5. snapshot, verify, restore: the stops ---------------------------------------
stack
git -C "$R" checkout -q main
commit m2 one
STAMP=20260102-000000
run snapshot --stamp "$STAMP" f1 f2 f3
run snapshot --stamp "$STAMP" f1 f2 f3
is "5: a snapshot taken twice of an unmoved run is the same snapshot" "$(val outcome)" saved
run snapshot f1
is "5: a snapshot needs the stamp" "$RC" 64
run snapshot --stamp "../x" f1
is "5: ...and a stamp that is only a stamp" "$RC" 64
(cd "$R" && git rebase -q --update-refs --no-rebase-merges --no-fork-point main f3 >/dev/null 2>&1)
git -C "$R" checkout -q main
git -C "$R" branch -q bystander f1
git -C "$R" branch -q -f bystander main
run verify --stamp "$STAMP" --base main f1 f2 f3
is "5: a branch created since the freeze is not one that moved" "$(val outcome)" verified
git -C "$R" branch -q -D bystander
SNAP1="$(git -C "$R" rev-parse "refs/pre-rebase/f1/$STAMP")"
SNAP3="$(git -C "$R" rev-parse "refs/pre-rebase/f3/$STAMP")"
git -C "$R" branch -q -f f3 "$SNAP3"
run verify --stamp "$STAMP" --base main f1 f2 f3
is "5: a run branch left on its snapshot fails the postcondition" "$(val outcome)" postcondition-failed
is "5: ...naming it" "$(val branch)" f3
run snapshot --stamp "$STAMP" f1
is "5: a snapshot is never overwritten with a branch that has moved" "$(val outcome)" conflict
is "5: ...the first one standing" "$(git -C "$R" rev-parse "refs/pre-rebase/f1/$STAMP")" "$SNAP1"
touch "$R/.git/refs/heads/f2.lock"
BEFORE="$(tip f1) $(tip f2) $(tip f3)"
run restore --stamp "$STAMP" f1 f2 f3
is "5: a restore the transaction refuses is a stop" "$(val outcome)" ref-moved
is "5: ...that moved nothing, the branches it could have moved included" "$(tip f1) $(tip f2) $(tip f3)" "$BEFORE"
rm "$R/.git/refs/heads/f2.lock"
run restore --stamp 20990101-000000 f1
is "5: a run with no snapshot is not restored" "$(val outcome)" no-snapshot
mv "$R/.git/rebase-stack-$STAMP.taken" "$WORKDIR/heads.keep"
run restore --stamp "$STAMP" f1 f2 f3
is "5: nor is one whose record of the frozen tips is gone" "$(val outcome)" no-snapshot
sed "s/^f1 .*/f1 $(tip main)/" "$WORKDIR/heads.keep" >"$R/.git/rebase-stack-$STAMP.taken"
run restore --stamp "$STAMP" f1 f2 f3
is "5: ...or disagrees with a snapshot" "$(val outcome)" no-snapshot
is "5: ...which moves nothing" "$(tip f1) $(tip f2) $(tip f3)" "$BEFORE"
mv "$WORKDIR/heads.keep" "$R/.git/rebase-stack-$STAMP.taken"
# A branch that moves after restore has read it and before the transaction:
# the hook fires on restore's own detach.
git -C "$R" checkout -q f3
# shellcheck disable=SC2016 # the hook's own $(...) must reach it unexpanded
printf '#!/bin/sh\ngit update-ref refs/heads/f1 "$(git rev-parse main)"\n' >"$R/.git/hooks/post-checkout"
chmod +x "$R/.git/hooks/post-checkout"
run restore --stamp "$STAMP" f1 f2 f3
is "5: a branch that moved under the restore is not overwritten" "$(val outcome)" ref-moved
is "5: ...its concurrent move standing, and the others unmoved with it" "$(tip f1) $(tip f2)" "$(tip main) $(printf '%s' "$BEFORE" | cut -d' ' -f2)"
rm "$R/.git/hooks/post-checkout"
git -C "$R" branch -q -f f1 "$(printf '%s' "$BEFORE" | cut -d' ' -f1)"
git -C "$R" checkout -q main
mkdir "$R/.git/rebase-merge"
run restore --stamp "$STAMP" f1 f2 f3
is "5: nor is anything restored under a rebase in progress" "$(val outcome)" rebase-in-progress
rmdir "$R/.git/rebase-merge"
git -C "$R" checkout -q f2
run restore --stamp "$STAMP" f1 f2 f3
is "5: standing on a run branch, restore detaches and proceeds" "$(val outcome)" restored
is "5: ...leaving the tree detached" "$(git -C "$R" branch --show-current)" ""
is "5: ...and the branch on its snapshot" "$(tip f2)" "$(git -C "$R" rev-parse "refs/pre-rebase/f2/$STAMP")"

# Branch by branch under one stamp: a later snapshot must not unsettle an earlier one.
stack
git -C "$R" checkout -q main
commit m2 one
STAMP=20260104-000000
ORIG1="$(tip f1)"
run snapshot --stamp "$STAMP" f1
(cd "$R" && git rebase -q --no-update-refs --no-rebase-merges main f1 >/dev/null 2>&1)
run snapshot --stamp "$STAMP" f2
git -C "$R" checkout -q main
run restore --stamp "$STAMP" f1
is "5: a branch snapshotted and rebased before a later branch's snapshot can still be restored" "$(val outcome)" restored
is "5: ...to where it was first taken" "$(tip f1)" "$ORIG1"
git -C "$R" tag main f1
run qualify --base main f1 f2 f3
is "5: a tag named like the base does not answer for the branch there either" "$(val base-oid)" "$(tip main)"
git -C "$R" tag -d main >/dev/null
git -C "$R" worktree add -q "$WORKDIR/held" f2
BEFORE2="$(tip f2)"
run restore --stamp "$STAMP" f2
is "5: a branch checked out in another worktree is not moved from here" "$(val outcome)" checked-out
is "5: ...and stays where it was" "$(tip f2)" "$BEFORE2"
git -C "$R" worktree remove "$WORKDIR/held"

# Branch names that awk would compare as numbers.
git -C "$R" branch -q 01 f3
git -C "$R" branch -q 1 f2
STAMP=20260105-000000
run snapshot --stamp "$STAMP" 01
run snapshot --stamp "$STAMP" 1
git -C "$R" branch -q -f 1 main
run restore --stamp "$STAMP" 1
is "5: branches named 01 and 1 are two branches, each with its own record" "$(val outcome)" restored
is "5: ...restored to its own snapshot" "$(tip 1)" "$(tip f2)"
git -C "$R" branch -q -D 01 1

# A branch outside the run that moved during the replay.
stack
git -C "$R" checkout -q main
commit m2 one
git -C "$R" branch -q bystander main
STAMP=20260103-000000
run snapshot --stamp "$STAMP" f1 f2 f3
(cd "$R" && git rebase -q --update-refs --no-rebase-merges --no-fork-point main f3 >/dev/null 2>&1)
git -C "$R" checkout -q main
git -C "$R" branch -q -f bystander "main~1"
run verify --stamp "$STAMP" --base main f1 f2 f3
is "5: a branch outside the run that moved is a stop of its own" "$(val outcome)" outside-moved
has "5: ...naming it" "$OUT" "moved=bystander"
is "5: ...with exit 3" "$RC" 3
run verify --stamp 20990101-000000 --base main f1 f2
is "5: verify without a snapshot's record is a failure" "$RC" 1

# --- 6. the shipped files -------------------------------------------------------
cmp -s "$SHIPPED" "$MIRROR"
ok "6: the Codex mirror ships the same helper, byte for byte" $?
for f in plugins/dev-skills/skills/rebase-stack/stack.sh codex/dev-skills/skills/rebase-stack/stack.sh; do
	mode="$(git -c safe.directory='*' -C "$SCRIPT_DIR/.." ls-files -s -- "$f" | cut -d' ' -f1)"
	is "6: $f is committed executable" "$mode" 100755
done
OUT="$(bash "$SHIPPED" --help 2>&1)"
has "6: the helper prints its contract" "$OUT" "stack.sh restore"
lacks "6: ...and none of its code" "$OUT" "set -u"
stack
run bogus
is "6: an unknown command is a usage error" "$RC" 64
has "6: ...showing every command" "$ERR" "stack.sh restore"

if [ "$fails" -gt 0 ]; then
	printf 'rebase-stack helper test: %d/%d checks FAILED.\n' "$fails" "$checks" >&2
	exit 1
fi
printf 'rebase-stack helper test passed (%d checks).\n' "$checks"
