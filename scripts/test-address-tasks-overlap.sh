#!/usr/bin/env bash
# Hermetic test for the address-tasks skill's bundled `overlap.sh`: real git in
# a throwaway repository, no network. `OVERLAP_HELPER` points the suite at
# another copy of the script (a mutant, say).
set -u

ROOT="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SHIPPED="$ROOT/plugins/dev-skills/skills/address-tasks/overlap.sh"
MIRROR="$ROOT/codex/dev-skills/skills/address-tasks/overlap.sh"
SHIM="$ROOT/plugins/dev-skills/bin/address-tasks-overlap"
HELPER="${OVERLAP_HELPER:-$SHIPPED}"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/overlap-test.XXXXXX")" || exit 1
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
count() { printf '%s\n' "$OUT" | grep -c "^$1=" || true; }
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

git init -q -b main "$R"
printf 'l1\nl2\nl3\nl4\nl5\n' >"$R/f"
printf 'l1\nl2\nl3\nl4\nl5\n' >"$R/g"
git -C "$R" add f g
git -C "$R" commit -q -m init
INIT="$(tip main)"

# a: f line 1, and a file of its own.   b: f line 5.   c: f line 1 (conflicts
# with a).   d: only a file of its own.   a2: stacked on a.
branch a
line f 1 A1
add only-a x
branch a2 a
add only-a2 x
branch b
line f 5 B5
branch c
line f 1 C1
branch d
add only-d x
git -C "$R" checkout -q main

# --- 1. the three outcomes ----------------------------------------------------
call --base main a d
is "1: branches with no file in common are clean" "$(val outcome)" clean
is "1: ...with exit 0" "$RC" 0
is "1: ...naming the base it compared against" "$(val base)" "$INIT"
has "1: ...each branch's tip and its trial merge into the base" "$OUT" "branch=a$TAB$(tip a)${TAB}clean"
has "1: ...and the pair" "$OUT" "pair=a${TAB}d${TAB}clean"
is "1: ...with no shared file" "$(count shared)" 0
is "1: outcome is the first line" "$(printf '%s\n' "$OUT" | head -n 1)" "outcome=clean"

call --base main a b
is "1: a file both touch that still merges is an overlap" "$(val outcome)" overlap
is "1: ...with exit 0" "$RC" 0
has "1: ...on the pair" "$OUT" "pair=a${TAB}b${TAB}overlap"
has "1: ...naming the file" "$OUT" "shared=a${TAB}b${TAB}f"
is "1: ...and it alone: a's own file is not shared" "$(count shared)" 1
is "1: ...with no conflict" "$(count conflict)" 0

call --base main a c
is "1: a pair whose trial merge fails is a conflict" "$(val outcome)" conflict
is "1: ...with exit 3" "$RC" 3
has "1: ...on the pair" "$OUT" "pair=a${TAB}c${TAB}conflict"
has "1: ...naming the conflicting file" "$OUT" "conflict=a${TAB}c${TAB}f"
is "1: ...and nothing else as one" "$(count conflict)" 1
has "1: ...which is a shared file too" "$OUT" "shared=a${TAB}c${TAB}f"
has "1: ...each branch still merging into the base on its own" "$OUT" "branch=c$TAB$(tip c)${TAB}clean"
has "1: ...and stderr saying nothing was changed" "$ERR" "Nothing was changed"

# --- 2. every pair, in the order named ----------------------------------------
call --base main a b c d
is "2: four branches make six pairs" "$(count pair)" 6
is "2: one conflict makes the whole answer a conflict" "$(val outcome)" conflict
is "2: pairs come in the order the branches were named" "$(printf '%s\n' "$OUT" | sed -n 's/^pair=//p' | cut -f1,2 | tr '\t\n' '- ')" "a-b a-c a-d b-c b-d c-d "
has "2: an overlap beside a conflict keeps its own verdict" "$OUT" "pair=b${TAB}c${TAB}overlap"
call --base main d c b a
is "2: the order follows the arguments" "$(printf '%s\n' "$OUT" | sed -n 's/^pair=//p' | head -n 1 | cut -f1,2 | tr '\t' '-')" "d-c"

# --- 3. stacks and what the base already holds --------------------------------
call --base main a a2 b
has "3: a branch built on another is stacked with it, not compared" "$OUT" "pair=a${TAB}a2${TAB}stacked"
lacks "3: ...so its parent's files are not shared with the parent" "$OUT" "shared=a${TAB}a2"
has "3: ...while it still overlaps a third branch through the parent's change" "$OUT" "pair=a2${TAB}b${TAB}overlap"
call --base main a2 a
has "3: stacked is found whichever way the pair is named" "$OUT" "pair=a2${TAB}a${TAB}stacked"

# Two children of one unmerged parent: the parent's files are neither's own.
branch p
line g 3 P3
branch p1 p
line g 5 P1
add only-p1 x
branch p2 p
add only-p2 x
git -C "$R" checkout -q main
call --base main p1 p2
is "3: two children of one parent do not share the parent's files" "$(val outcome)" clean
is "3: ...none at all" "$(count shared)" 0
call --base main p2 p1
is "3: ...whichever is named first" "$(count shared)" 0

call --base a a b
has "3: a branch the base already contains is merged" "$OUT" "branch=a$TAB$(tip a)${TAB}merged"
is "3: ...and takes part in no pair" "$(count pair)" 0
call --base a a b d
is "3: ...leaving the others to pair up" "$(count pair)" 1
has "3: ...as themselves" "$OUT" "pair=b${TAB}d${TAB}clean"

# --- 4. a base that moved -----------------------------------------------------
# main gains a change to g line 1 and f line 1; e forks after it and touches
# g line 5. b forked before it.
git -C "$R" checkout -q main
line g 1 M1
line f 1 M1
branch e
line g 5 E5
git -C "$R" checkout -q main
call --base main b e
has "4: what the base gained between two fork points is no branch's change" "$OUT" "pair=b${TAB}e${TAB}clean"
is "4: ...so nothing is shared" "$(count shared)" 0
call --base main e b
is "4: ...whichever is named first" "$(count shared)" 0
has "4: ...and a branch from the older base that still merges says so" "$OUT" "branch=b$TAB$(tip b)${TAB}clean"
call --base main a e
has "4: a branch the moved base conflicts with says so" "$OUT" "branch=a$TAB$(tip a)${TAB}conflict"
has "4: ...naming the file" "$OUT" "base-conflict=a${TAB}f"
is "4: ...which makes the answer a conflict" "$(val outcome)" conflict
is "4: ...with exit 3" "$RC" 3
has "4: ...while the other branch is clean against the base" "$OUT" "branch=e$TAB$(tip e)${TAB}clean"
call --base main a d
has "4: (setup) a pair that merges, one of them conflicting with the base" "$OUT" "pair=a${TAB}d${TAB}clean"
is "4: a conflict with the base alone makes the answer a conflict" "$(val outcome)" conflict
is "4: ...naming its one file" "$(count base-conflict)" 1
is "4: the base is resolved to a commit" "$(val base)" "$(tip main)"
call --base "$INIT" a b
is "4: an exact commit works as the base" "$(val base)" "$INIT"
is "4: ...and answers as that base would" "$(val outcome)" overlap
call --base main "$(tip b)" e
has "4: a branch may be named by its commit" "$OUT" "branch=$(tip b)$TAB$(tip b)${TAB}clean"

# --- 5. it changes nothing ----------------------------------------------------
REFS_BEFORE="$(git -C "$R" for-each-ref)"
OBJECTS_HEAD="$(tip HEAD)"
call --base main a a2 b c d e p1 p2
is "5: (setup) a run over every branch answers" "$(val outcome)" conflict
is "5: no ref was created or moved" "$(git -C "$R" for-each-ref)" "$REFS_BEFORE"
is "5: HEAD is where it was" "$(tip HEAD)" "$OBJECTS_HEAD"
is "5: the working tree is clean" "$(git -C "$R" status --porcelain)" ""
is "5: the checkout is where it was" "$(git -C "$R" symbolic-ref --short HEAD)" main
LEFT=0
[ ! -e "$R/.git/MERGE_HEAD" ] && [ ! -e "$R/.git/AUTO_MERGE" ] || LEFT=1
ok "5: no merge is left in progress" "$LEFT"

# --- 6. -C, the shim, and what is refused -------------------------------------
OUT="$(cd "$WORKDIR" && bash "$HELPER" -C "$R" --base "$INIT" a b 2>/dev/null)"
is "6: -C names the repository" "$(val outcome)" overlap
OUT="$(cd "$R" && bash "$SHIM" --base "$INIT" a b 2>/dev/null)"
is "6: the plugin's shim runs the same script" "$(val outcome)" overlap
cmp -s "$SHIPPED" "$MIRROR"
ok "6: the two mirrors ship the same script" $?

call --base main a
is "6: one branch is a usage error" "$RC" 64
has "6: ...with the usage line" "$ERR" "overlap.sh [-C <dir>] --base <commit> <branch> <branch>..."
call a b
is "6: no base is a usage error" "$RC" 64
call --base main a a
is "6: a branch named twice is a usage error" "$RC" 64
has "6: ...saying so" "$ERR" "named twice"
call --base main a b --frobnicate
is "6: an unknown option is a usage error" "$RC" 64
call --base
is "6: --base with no value is a usage error" "$RC" 64
call --base main a nope
is "6: a branch that names no commit is a failure, not a clean answer" "$RC" 1
is "6: ...with nothing on stdout" "$OUT" ""
has "6: ...naming it" "$ERR" "the branch 'nope' names no commit"
call --base nope a b
is "6: a base that names no commit is a failure" "$RC" 1
is "6: ...with nothing on stdout" "$OUT" ""
git -C "$R" checkout -q --orphan island
git -C "$R" rm -q -rf .
add island x
git -C "$R" checkout -q main
call --base main a island
is "6: a branch with no history in common is a failure" "$RC" 1
is "6: ...with nothing on stdout" "$OUT" ""
has "6: ...saying so" "$ERR" "share no history"
OUT="$(cd "$WORKDIR" && bash "$HELPER" --base main a b 2>"$WORKDIR/err")"
is "6: outside a repository is a failure" "$?" 1
call --help
is "6: --help exits 0" "$RC" 0
has "6: ...printing the contract" "$OUT" "outcome=conflict"

if [ "$fails" -gt 0 ]; then
	printf 'address-tasks overlap helper test FAILED (%s of %s checks).\n' "$fails" "$checks" >&2
	exit 1
fi
printf 'address-tasks overlap helper test passed (%s checks).\n' "$checks"
