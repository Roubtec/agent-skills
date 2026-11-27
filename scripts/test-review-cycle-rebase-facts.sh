#!/usr/bin/env bash
# Hermetic test for the review-cycle skill's bundled `rebase-facts.sh`: real git
# in a throwaway repository, no network. Each forecast is checked against what
# `git rebase` then does there. `REBASE_FACTS_HELPER` points the suite at
# another copy of the script (a mutant, say).
set -u

ROOT="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SHIPPED="$ROOT/plugins/dev-skills/skills/review-cycle/rebase-facts.sh"
MIRROR="$ROOT/codex/dev-skills/skills/review-cycle/rebase-facts.sh"
SHIM="$ROOT/plugins/dev-skills/bin/review-cycle-rebase-facts"
HELPER="${REBASE_FACTS_HELPER:-$SHIPPED}"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/rebase-facts-test.XXXXXX")" || exit 1
trap 'rm -rf "$WORKDIR"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
TAB="$(printf '\t')"

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
		printf '      unwanted: %s\n' "$3" >&2
		;;
	*) ok "$1" 0 ;; esac
}
is() { # <label> <actual> <expected>
	if [ "$2" = "$3" ]; then ok "$1" 0; else
		ok "$1" 1
		printf '      wanted: %s\n      got:    %s\n' "$3" "$2" >&2
	fi
}

R="$WORKDIR/repo"
call() { # [args...] → OUT (stdout), ERR (stderr), RC
	OUT="$(cd "$R" && bash "$HELPER" "$@" 2>"$WORKDIR/err")"
	RC=$?
	ERR="$(cat "$WORKDIR/err")"
}
val() { printf '%s\n' "$OUT" | sed -n "s/^$1=//p" | head -n 1; }
all() { printf '%s\n' "$OUT" | sed -n "s/^$1=//p" | tr '\n' ' '; }
tip() { git -C "$R" rev-parse "$1"; }
# line <file> <n> <text>: set line n of a five-line file, and commit.
line() {
	awk -v n="$2" -v t="$3" 'NR == n { print t; next } { print }' "$R/$1" >"$WORKDIR/edit" && cp "$WORKDIR/edit" "$R/$1"
	git -C "$R" commit -q -am "$1:$2 $3"
}
add() { # <file> <text>
	printf '%s\n' "$2" >"$R/$1"
	git -C "$R" add "$1"
	git -C "$R" commit -q -m "add $1"
}
branch() { git -C "$R" checkout -q -b "$1" "${2:-main}"; }
on() { git -C "$R" checkout -q "$1"; }
# The replay the delegated step runs, on the checked-out branch.
replay() { git -C "$R" rebase -q --no-update-refs --no-rebase-merges "$@" >/dev/null 2>&1; }
state() {
	git -C "$R" for-each-ref | cksum
	git -C "$R" rev-parse HEAD
	find "$R" -type f | sort | cksum
	cksum "$R/.git/index"
}

git init -q -b main "$R"
printf 'l1\nl2\nl3\nl4\nl5\n' >"$R/f"
printf 'l1\nl2\nl3\nl4\nl5\n' >"$R/g"
seq 1 20 >"$R/long"
git -C "$R" add f g long
git -C "$R" commit -q -m init
INIT="$(tip main)"

# --- 1: an unmoved base is a proved no-op --------------------------------
branch a
line f 1 A1
add only-a x
A="$(tip a)"
call before --onto main
is "1: an unmoved base exits 0" "$RC" 0
is "1: ...as a no-op, outcome first" "$(printf '%s\n' "$OUT" | head -n 1)" "outcome=noop"
is "1: ...naming the branch tip" "$(val branch)" "$A"
is "1: ...the target as a commit" "$(val onto)" "$INIT"
is "1: ...and the fork point, which is the target" "$(val fork-point)" "$INIT"
is "1: ...with nothing to replay" "$(val replay)" 0
is "1: ...no merge in range" "$(val merges)" 0
is "1: ...nothing to replay onto" "$(val onto-ahead)" 0
is "1: ...and nothing changed underneath" "$(val paths)" disjoint
lacks "1: ...so no onto-path line" "$OUT" "onto-path="
replay "$INIT"
is "1: git agrees: the replay moves no tip" "$(tip a)" "$A"
call before --onto main a
is "1: the branch may be named instead of checked out" "$(val branch)" "$A"

# --- 2: a moved, disjoint base replays and carries -----------------------
on main
add only-main m
line g 5 M5
MAIN2="$(tip main)"
on a
call before --onto main
is "2: a moved base exits 0" "$RC" 0
is "2: ...as a replay" "$(val outcome)" replay
is "2: ...forking where the branch left the old base" "$(val fork-point)" "$INIT"
is "2: ...with the branch's two commits to replay" "$(val replay)" 2
is "2: ...onto the base's two new ones" "$(val onto-ahead)" 2
is "2: ...touching none of the branch's files" "$(val paths)" disjoint
is "2: ...and naming what changed underneath" "$(all onto-path)" "g only-main "
lacks "2: ...with no shared file" "$OUT" "shared="
replay "$MAIN2"
A2="$(tip a)"
call after --old-base "$INIT" --old-tip "$A" --new-base "$MAIN2"
is "2: a patch-identical replay over disjoint paths exits 0" "$RC" 0
is "2: ...carrying the verdict" "$(val outcome)" carry
is "2: ...from the old tip" "$(val old-tip)" "$A"
is "2: ...to the new one" "$(val new-tip)" "$A2"
is "2: ...patch-identical" "$(val identical)" yes
is "2: ...commit for commit" "$(val old-commits):$(val new-commits)" "2:2"
is "2: ...over disjoint paths" "$(val paths)" disjoint
is "2: ...still naming the base side's files for the reader" "$(all onto-path)" "g only-main "
lacks "2: ...and giving no reason" "$OUT" "reason="
call after --old-base "$INIT" --old-tip "$A" --new-base "$MAIN2" a
is "2: after takes the branch by name too" "$(val new-tip)" "$A2"
call after --old-base "$INIT" --old-tip "$A2" --new-base "$MAIN2"
is "2: a tip that did not move is unchanged" "$(val outcome)" unchanged
is "2: ...and exits 0" "$RC" 0
call before --onto "$MAIN2"
is "2: the second point over the same pin is a no-op" "$(val outcome)" noop

# --- 3: a moved, overlapping base replays clean and is still verified ----
branch b "$INIT"
line long 20 B20
B="$(tip b)"
on main
line long 1 M1
MAIN3="$(tip main)"
on b
call before --onto main
is "3: an overlapping base is a replay" "$(val outcome)" replay
is "3: ...over shared paths" "$(val paths)" shared
is "3: ...naming the shared file" "$(all shared)" "long "
is "3: ...and exits 0: the forecast stops nothing" "$RC" 0
replay "$MAIN3"
ok "3: (the replay itself is clean)" $?
call after --old-base "$INIT" --old-tip "$B" --new-base "$MAIN3"
is "3: a clean replay over a shared path exits 3" "$RC" 3
is "3: ...to be verified" "$(val outcome)" verify
is "3: ...though patch-identical" "$(val identical)" yes
is "3: ...because the paths are shared" "$(val paths)" shared
has "3: ...which stderr says" "$ERR" "paths=shared"

# --- 4: a pure-join merge in range is never a no-op ----------------------
branch side "$INIT"
add only-side s
branch joined "$INIT"
add only-joined j
git -C "$R" merge -q --no-ff -m join side
J="$(tip joined)"
call before --onto "$INIT"
is "4: a merge in range over an unmoved base is a replay" "$(val outcome)" replay
is "4: ...counted" "$(val merges)" 1
is "4: ...and named" "$(val merge)" "$J"
is "4: ...beside the two commits a replay carries" "$(val replay)" 2
is "4: ...though the target is contained" "$(val onto-ahead)" 0
is "4: ...and is the fork point" "$(val fork-point)" "$INIT"
replay "$INIT"
ok "4: git agrees: the replay flattens the merge and moves the tip" "$([ "$(tip joined)" != "$J" ] && echo 0 || echo 1)"
call after --old-base "$INIT" --old-tip "$J" --new-base "$INIT"
is "4: a flattened merge is not patch-identical" "$(val identical)" no
is "4: ...for that reason" "$(val reason)" merge
is "4: ...so the tree is verified" "$(val outcome):$RC" "verify:3"
call before --onto "$INIT"
is "4: flattened once, the range is linear and the point a no-op" "$(val outcome)" noop
# A merge a replay re-created keeps the commit count and every patch, and is
# still not the range that was verified.
branch kept "$INIT"
add only-kept k
git -C "$R" merge -q --no-ff -m join side
KEPT="$(tip kept)"
git -C "$R" rebase -q --no-update-refs --rebase-merges "$MAIN2" >/dev/null 2>&1
call after --old-base "$INIT" --old-tip "$KEPT" --new-base "$MAIN2"
is "4: a merge re-created by the replay leaves the counts equal" "$(val old-commits):$(val new-commits)" "3:3"
is "4: ...and is not patch-identical all the same" "$(val identical):$(val reason)" "no:merge"
is "4: ...so nothing is carried over disjoint paths" "$(val paths):$(val outcome):$RC" "disjoint:verify:3"
# What a merge changed by hand is the branch's own, though no replayed commit holds it.
branch evil "$INIT"
add only-evil e
git -C "$R" merge -q --no-ff --no-commit side >/dev/null 2>&1
awk 'NR == 1 { print "EVIL"; next } { print }' "$R/g" >"$WORKDIR/edit" && cp "$WORKDIR/edit" "$R/g"
git -C "$R" commit -q -am "join, with an edit"
call before --onto "$MAIN2"
is "4: a file only a merge's own edit touches is the branch's" "$(val paths):$(all shared)" "shared:g "

# --- 5: a stacked child, and a parent tip that is not its ancestor -------
branch parent "$INIT"
line g 1 P1
P1="$(tip parent)"
branch child parent
add only-child c
line f 2 C2
CHILD="$(tip child)"
call before --onto "$P1" --parent-tip "$P1"
is "5: a child on an unmoved parent is a no-op" "$(val outcome)" noop
is "5: ...forking at the parent tip" "$(val fork-point)" "$P1"
is "5: ...which is printed back" "$(val parent-tip)" "$P1"
on parent
line g 2 P2
P2="$(tip parent)"
on child
call before --onto "$P2" --parent-tip "$P1"
is "5: a parent that gained a commit is a replay" "$(val outcome)" replay
is "5: ...of the child's own two commits alone" "$(val replay)" 2
is "5: ...onto the parent's one new commit" "$(val onto-ahead)" 1
is "5: ...whose file the child does not touch" "$(val paths):$(all onto-path)" "disjoint:g "
# The parent is rewritten: its old tip is P2, and a child still on P1 holds it not.
git -C "$R" checkout -q -b rewritten "$INIT"
line g 1 P1
line g 2 P2-reworded
P3="$(tip rewritten)"
on child
call before --onto "$P3" --parent-tip "$P2"
is "5: a parent tip the child does not descend from exits 3" "$RC" 3
is "5: ...as a stale parent, outcome first" "$(printf '%s\n' "$OUT" | head -n 1)" "outcome=stale-parent"
is "5: ...naming the tip it was handed" "$(val parent-tip)" "$P2"
lacks "5: ...and forecasting nothing from it" "$OUT" "fork-point="
has "5: ...and saying why" "$ERR" "not an ancestor"
is "5: ...where the boundary the child does hold still answers" "$(call before --onto "$P3" --parent-tip "$P1" && val outcome)" replay
replay --onto "$P2" "$P1"
call after --old-base "$P1" --old-tip "$CHILD" --new-base "$P2"
is "5: the child's replay onto the grown parent carries" "$(val outcome):$RC" "carry:0"

# --- 6: a replay that dropped, altered or reworded a commit --------------
# The base already holds the branch's LAST commit, so every pair that remains matches.
branch d "$INIT"
add only-d d
line f 4 D4
D="$(tip d)"
branch main6 "$INIT"
git -C "$R" cherry-pick "$D" >/dev/null 2>&1
add only-main6 m
MAIN6="$(tip main6)"
on d
replay "$MAIN6"
call after --old-base "$INIT" --old-tip "$D" --new-base "$MAIN6"
is "6: a replay that dropped a commit exits 3" "$RC" 3
is "6: ...not patch-identical" "$(val identical)" no
is "6: ...by count" "$(val reason)" count
is "6: ...two commits before, one after" "$(val old-commits):$(val new-commits)" "2:1"
is "6: ...so the tree is verified" "$(val outcome)" verify
# A conflict resolved by hand: the same commit count, another patch.
branch e "$INIT"
line g 3 E3
E="$(tip e)"
branch main7 "$INIT"
line g 3 M3
MAIN7="$(tip main7)"
on e
replay "$MAIN7"
printf 'l1\nl2\nE3+M3\nl4\nl5\n' >"$R/g"
git -C "$R" add g
GIT_EDITOR=true git -C "$R" rebase --continue >/dev/null 2>&1
E2="$(tip e)"
call after --old-base "$INIT" --old-tip "$E" --new-base "$MAIN7"
is "6: a replay that resolved a conflict is not patch-identical" "$(val identical):$(val reason)" "no:patch"
is "6: ...naming the pair that differs" "$(val differs)" "$E$TAB$E2"
is "6: ...and its paths are shared besides" "$(val paths):$(val outcome):$RC" "shared:verify:3"
# The same patches under another message.
branch h "$INIT"
add only-h h
H="$(tip h)"
git -C "$R" commit -q --amend -m "reworded"
call after --old-base "$INIT" --old-tip "$H" --new-base "$INIT"
is "6: a reworded commit is not the same commit" "$(val identical):$(val reason)" "no:message"
is "6: ...whatever the paths say" "$(val paths):$(val outcome):$RC" "disjoint:verify:3"
# The same patch but for its whitespace: what a hand edit during the replay leaves.
branch w "$INIT"
printf 'if x:\n    y()\nz()\n' >"$R/p.py"
git -C "$R" add p.py
git -C "$R" commit -q -m "add p.py"
W="$(tip w)"
printf 'if x:\n    y()\n    z()\n' >"$R/p.py"
git -C "$R" commit -q -a --amend --no-edit
call after --old-base "$INIT" --old-tip "$W" --new-base "$INIT"
is "6: a commit altered only in its whitespace is not patch-identical" "$(val identical):$(val reason)" "no:patch"
is "6: ...so nothing is carried over disjoint paths" "$(val paths):$(val outcome):$RC" "disjoint:verify:3"
# A rename counts under both of its names.
branch ren "$INIT"
git -C "$R" mv g g2
git -C "$R" commit -q -m "rename g"
branch main8 "$INIT"
line g 5 M5
on ren
call before --onto main8
is "6: a renamed file is touched under its old name" "$(val paths):$(all shared)" "shared:g "
# ...on the base's side as well: the file the branch edits is gone from under it.
branch edits "$INIT"
line g 1 G1
on main8
git -C "$R" mv g g3
git -C "$R" commit -q -m "rename g on the base"
on edits
call before --onto main8
is "6: a file the base renamed is changed underneath under its old name" "$(val paths):$(all shared)" "shared:g "
# A branch with nothing of its own left: the rebase would only fast-forward it.
branch behind "$INIT"
call before --onto "$MAIN2"
is "6: a branch its target already contains has nothing to replay" "$(val outcome):$(val replay)" "replay:0"
is "6: ...and a target ahead of it" "$(val onto-ahead)" 2

# --- 7: the contract -------------------------------------------------------
on a
STATE="$(state)"
call before --onto main
call before --onto "$P2" --parent-tip "$P1" child
call after --old-base "$INIT" --old-tip "$A" --new-base "$MAIN2"
is "7: nothing is written: refs, index, tree and every file under .git are as they were" "$(state)" "$STATE"
call before
is "7: before without --onto is a usage error" "$RC" 64
is "7: ...with nothing on stdout" "$OUT" ""
has "7: ...and the usage on stderr" "$ERR" "before --onto <commit>"
call after --old-base "$INIT" --old-tip "$A"
is "7: after without all three is a usage error" "$RC" 64
call
is "7: no command is a usage error" "$RC" 64
call sideways
is "7: an unknown command is a usage error" "$RC" 64
call before --onto main --bogus
is "7: an unknown flag is a usage error" "$RC" 64
call before --onto main a b
is "7: two branches is a usage error" "$RC" 64
call before --onto main --old-tip "$A"
is "7: after's flags on before is a usage error" "$RC" 64
call before --onto no-such-ref
is "7: a target that names no commit is a failure" "$RC" 1
is "7: ...with nothing on stdout" "$OUT" ""
has "7: ...naming it" "$ERR" "no-such-ref"
call before --onto main --parent-tip no-such-ref
is "7: so is a parent tip that names none" "$RC" 1
git -C "$R" checkout -q --orphan island
git -C "$R" commit -q --allow-empty -m island
on a
call before --onto island
is "7: a target with no history in common is a failure" "$RC" 1
has "7: ...saying so" "$ERR" "share no history"
call after --old-base "$MAIN3" --old-tip "$A" --new-base "$MAIN2"
is "7: an old base that is no ancestor of the old tip is a failure" "$RC" 1
is "7: ...with nothing on stdout" "$OUT" ""
call after --old-base "$INIT" --old-tip "$A" --new-base "$MAIN3"
is "7: a new base the branch was not replayed onto is a failure" "$RC" 1
# A read that fails proves nothing: no answer, and never a carry on two empty reads.
REAL_GIT="$(command -v git)"
mkdir "$WORKDIR/shim"
cat >"$WORKDIR/shim/git" <<SHIM
#!/bin/sh
case " \$* " in *" \$BREAK_GIT "*) exit 1 ;; esac
exec "$REAL_GIT" "\$@"
SHIM
chmod +x "$WORKDIR/shim/git"
for broken in "patch-id" "cat-file" "--merges" "diff-tree --stdin" "diff-tree -r"; do
	OUT="$(cd "$R" && PATH="$WORKDIR/shim:$PATH" BREAK_GIT="$broken" bash "$HELPER" after --old-base "$INIT" --old-tip "$A" --new-base "$MAIN2" a 2>/dev/null)"
	is "7: a failed '$broken' read fails the call and carries nothing" "$?:$OUT" "1:"
done
OUT="$(cd "$R" && PATH="$WORKDIR/shim:$PATH" BREAK_GIT="no-such-word" bash "$HELPER" after --old-base "$INIT" --old-tip "$A" --new-base "$MAIN2" a 2>/dev/null)"
is "7: ...where the same call through the same shim, unbroken, carries" "$?:$(val outcome)" "0:carry"
OUT="$(cd "$WORKDIR" && bash "$HELPER" before --onto main 2>"$WORKDIR/err")"
is "7: outside a repository is a failure" "$?" 1
OUT="$(bash "$HELPER" -C "$R" before --onto "$MAIN2" a 2>/dev/null)"
is "7: -C names the repository" "$(val outcome)" noop
call --help
is "7: --help exits 0" "$RC" 0
has "7: ...printing the contract" "$OUT" "outcome=stale-parent"
OUT="$(cd "$R" && bash "$SHIM" before --onto "$MAIN2" a 2>/dev/null)"
is "7: the bin/ shim runs the same script" "$(val outcome)" noop
ok "7: the Codex mirror is byte-identical" "$(cmp -s "$SHIPPED" "$MIRROR" && echo 0 || echo 1)"

if [ "$fails" -gt 0 ]; then
	printf 'review-cycle rebase-facts helper test FAILED (%s of %s checks).\n' "$fails" "$checks" >&2
	exit 1
fi
printf 'review-cycle rebase-facts helper test passed (%s checks).\n' "$checks"
