#!/usr/bin/env bash
# Hermetic test for the prune-branches helper
# (plugins/dev-skills/skills/prune-branches/prune-branches.sh).
#
# Every case builds a throwaway bare "origin" and a clone of it under one temp
# directory, so nothing here touches a real repository or the network. `gh` is
# absent unless a case installs a fake, which is how the PR-evidence path is
# driven; `wt-remove` likewise.
# shellcheck disable=SC2319 # `ok <label> $?` after a `[ … ]` test is the point
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="${PRUNE_BRANCHES:-$SCRIPT_DIR/../plugins/dev-skills/skills/prune-branches/prune-branches.sh}"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
export TMPDIR="$WORKDIR/tmp"
mkdir -p "$TMPDIR"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.test GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.test
unset CONTAINER_NAME
REAL_PATH="$PATH"
TODAY="$(date -u +%Y%m%d)"

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
		printf '      wanted: %s\n' "$3" >&2
		;;
	esac
}
hasnt() {
	case "$2" in *"$3"*)
		ok "$1" 1
		printf '      unwanted: %s\n' "$3" >&2
		;;
	*) ok "$1" 0 ;; esac
}
exists() { git -C "$R" show-ref --verify --quiet "$1"; }
row() { printf '%s\n' "$OUT" | grep -E "^  [A-Za-z-]+ +$1 " | head -n 1; }
commit() { # <repo> <message>
	git -C "$1" commit -q --allow-empty -m "$2"
}

# new_repo <default-branch> → sets O (bare origin) and R (clone), with three
# commits on the default.
new_repo() {
	local d
	d="$(mktemp -d "$WORKDIR/case.XXXXXX")"
	O="$d/origin.git"
	R="$d/repo"
	git init -q --bare -b "$1" "$O"
	git init -q -b "$1" "$R"
	commit "$R" one
	commit "$R" two
	commit "$R" three
	git -C "$R" remote add origin "$O"
	git -C "$R" push -q -u origin "$1"
}
plan() {
	OUT="$(cd "$R" && PATH="$CASE_PATH" bash "$HELPER" plan "$@" 2>&1)"
	RC=$?
	PLAN="$(printf '%s\n' "$OUT" | sed -n 's/^plan: //p')"
}
apply() {
	OUT="$(cd "$R" && PATH="$CASE_PATH" bash "$HELPER" apply --plan "$PLAN" "$@" 2>&1)"
	RC=$?
}
CASE_PATH="$REAL_PATH"

# --- 1. the buckets, the breadcrumbs, and a full apply -----------------------
new_repo main
git -C "$R" branch merged-a main~1
git -C "$R" branch 'topic;echo_PWN' main~2
git -C "$R" checkout -q -b spike main
commit "$R" s1
git -C "$R" branch sub
commit "$R" s2
git -C "$R" checkout -q -b dup1 main
commit "$R" d1
git -C "$R" branch dup2
git -C "$R" checkout -q -b keepme main
commit "$R" k1
git -C "$R" checkout -q -b combo main
git -C "$R" merge -q --no-ff -m combo keepme
git -C "$R" checkout -q -b wt-other main~1
git -C "$R" checkout -q -b work main
commit "$R" w1
git -C "$R" worktree add -q "$(dirname "$R")/elsewhere" wt-other
ELSE="$(cd "$(dirname "$R")/elsewhere" && pwd -P)"
echo dirty >"$R/untracked.txt"
MAIN_OID="$(git -C "$R" rev-parse main)"
SUB_OID="$(git -C "$R" rev-parse sub)"
LB_OID="$(git -C "$R" rev-parse spike)"
git -C "$R" update-ref refs/pruned/20200101/old "$MAIN_OID"
git -C "$R" update-ref "refs/pruned/$TODAY/new" "$MAIN_OID"
git -C "$R" update-ref refs/pruned/20200101/lb "$LB_OID"
git -C "$R" update-ref refs/pruned/notadate/x "$MAIN_OID"
git -C "$R" update-ref 'refs/pruned/flat/20200101/a%2Fb' "$MAIN_OID"
git -C "$R" symbolic-ref refs/pruned/20200101/decoy refs/heads/keepme
git -C "$R" update-ref "refs/pruned/$TODAY/sub" "$MAIN_OID"

plan --keep keepme --keep nosuch
ok "1: plan exits 0" "$RC"
[ -f "$PLAN" ]
ok "1: plan file written" $?
has "1: ancestor is Merged" "$(row merged-a)" "Merged"
has "1: metachar name is Merged" "$(row 'topic;echo_PWN')" "delete"
has "1: unique work is Uncertain and kept" "$(row spike)" "keep"
has "1: a strict ancestor of a kept branch is Transient" "$(row sub)" "Transient"
has "1: ...proved by that branch" "$(row sub)" "kept branch spike"
has "1: the first of two same-tip branches is kept" "$(row dup1)" "Uncertain"
has "1: the second is Transient through it" "$(row dup2)" "same tip as kept branch dup1"
has "1: a merge of surviving parents is Transient" "$(row combo)" "merge commit whose parents all survive"
has "1: a user keep is Protected" "$(row keepme)" "kept on request"
has "1: the current branch is Protected" "$(row work)" "current branch"
has "1: the default is Protected" "$(row main)" "authoritative default"
has "1: a branch in an unowned worktree needs approval" "$(row wt-other)" "keep"
has "1: ...and says how" "$(row wt-other)" "--approve-worktree"
has "1: an unknown keep is reported" "$OUT" "match no local branch: nosuch"
has "1: old landed breadcrumb is a sweep candidate" "$OUT" "Redundant     20200101  old"
has "1: recent landed breadcrumb is kept" "$OUT" "too recent to sweep"
has "1: unreachable breadcrumb is load-bearing" "$OUT" "Load-bearing  20200101  lb"
has "1: bad date segment is unrecognized" "$OUT" "date segment is not YYYYMMDD"
has "1: flat breadcrumb shows its decoded name" "$OUT" "20200101  a/b "
has "1: a symbolic ref is unrecognized" "$OUT" "symbolic ref"
has "1: gh absence is stated" "$OUT" "PR lookups: none"
exists refs/heads/merged-a
ok "1: plan deletes nothing" $?

apply --dry-run --delete-uncertain spike
has "1: dry run shows an explicitly confirmed Uncertain row" "$(row spike)" "explicitly confirmed"
exists refs/heads/spike
ok "1: dry run deletes nothing" $?

apply --approve-worktree wt-other "$ELSE"
ok "1: apply exits 0" "$RC"
! exists refs/heads/merged-a
ok "1: Merged branch deleted" $?
! exists 'refs/heads/topic;echo_PWN'
ok "1: metachar branch deleted" $?
has "1: its restore command is single-quoted" "$OUT" "git branch 'topic;echo_PWN' "
! exists refs/heads/sub
ok "1: Transient branch deleted" $?
SHORT="$(git -C "$R" rev-parse --short "$SUB_OID")"
[ "$(git -C "$R" rev-parse "refs/pruned/$TODAY/sub-$SHORT")" = "$SUB_OID" ]
ok "1: its backup took the suffixed name because the plain one was taken" $?
[ "$(git -C "$R" rev-parse "refs/pruned/$TODAY/sub")" = "$MAIN_OID" ]
ok "1: the colliding breadcrumb was left as it was" $?
! exists refs/heads/dup2 && exists "refs/pruned/$TODAY/dup2"
ok "1: same-tip duplicate deleted with a backup" $?
! exists refs/heads/combo && exists "refs/pruned/$TODAY/combo"
ok "1: merge branch deleted with a backup" $?
! exists "refs/pruned/$TODAY/merged-a"
ok "1: a Merged deletion gets no backup ref" $?
exists refs/heads/spike && exists refs/heads/dup1 && exists refs/heads/keepme && exists refs/heads/work && exists refs/heads/main
ok "1: Uncertain and Protected branches remain" $?
! exists refs/heads/wt-other && [ ! -d "$ELSE" ]
ok "1: an approved worktree is removed and its branch deleted" $?
! exists refs/pruned/20200101/old && ! exists 'refs/pruned/flat/20200101/a%2Fb'
ok "1: redundant breadcrumbs swept" $?
exists "refs/pruned/$TODAY/new" && exists refs/pruned/20200101/lb && exists refs/pruned/notadate/x
ok "1: recent, load-bearing and unrecognized breadcrumbs kept" $?
[ "$(git -C "$R" symbolic-ref refs/pruned/20200101/decoy)" = refs/heads/keepme ] && exists refs/heads/keepme
ok "1: the symbolic ref and its target are untouched" $?
has "1: orientation confirmed" "$OUT" "same branch, commit and working-tree state"
has "1: report states no remote change" "$OUT" "No remote ref or PR was changed."
[ -f "$R/untracked.txt" ] && [ "$(git -C "$R" symbolic-ref --short HEAD)" = work ]
ok "1: the invoking checkout is untouched" $?
[ "$(git -C "$O" for-each-ref | wc -l | tr -d ' ')" = 1 ]
ok "1: origin still has exactly its one ref" $?

# --- 2. stops before acting --------------------------------------------------
new_repo main
git -C "$R" branch merged-a main~1
git -C "$R" remote set-url origin "$WORKDIR/does-not-exist.git"
plan
[ "$RC" = 1 ]
ok "2: a failed fetch stops the plan" $?
has "2: ...and says nothing was deleted" "$OUT" "Nothing was classified or deleted"
[ -z "$PLAN" ]
ok "2: ...and writes no plan" $?

new_repo main
(cd "$WORKDIR" && PATH="$REAL_PATH" bash "$HELPER" plan >/dev/null 2>&1)
[ $? = 1 ]
ok "2: outside a repository is a stop" $?

new_repo main
git -C "$R" branch merged-a main~1
plan
OTHER_PLAN="$PLAN"
new_repo main
git -C "$R" branch merged-a main~1
PLAN="$OTHER_PLAN"
apply
[ "$RC" = 1 ] && exists refs/heads/merged-a
ok "2: a plan from another repository is refused" $?

new_repo main
git -C "$R" branch merged-a main~1
plan
git -C "$R" update-ref refs/remotes/origin/main main~1
apply
[ "$RC" = 1 ] && exists refs/heads/merged-a
ok "2: a default that moved since the plan is refused" $?

new_repo main
git -C "$R" branch merged-a main~1
plan
sed -i.bak "s/^META${TAB:-	}created	.*/META	created	1000/" "$PLAN"
apply
[ "$RC" = 1 ] && exists refs/heads/merged-a
ok "2: a plan older than an hour is refused" $?

(cd "$R" && PATH="$REAL_PATH" bash "$HELPER" apply --plan "$PLAN" --hands-off --delete-uncertain x >/dev/null 2>&1)
[ $? = 64 ]
ok "2: hands-off with --delete-uncertain is a usage error" $?

# --- 3. hands-off, a moved tip, and explicit Uncertain deletion --------------
new_repo trunk
git -C "$R" branch merged-a trunk~1
git -C "$R" checkout -q -b spike trunk
commit "$R" s1
git -C "$R" checkout -q trunk
git -C "$R" branch moved trunk~2
git -C "$R" update-ref refs/pruned/20200101/old "$(git -C "$R" rev-parse trunk)"
plan
has "3: a default not called main is resolved" "$OUT" "origin's default \`trunk\`"
git -C "$R" update-ref refs/heads/moved trunk~1
apply --hands-off
! exists refs/heads/merged-a
ok "3: hands-off deletes Merged" $?
exists refs/heads/spike
ok "3: hands-off keeps Uncertain" $?
exists refs/heads/moved
ok "3: a tip that moved after the plan is kept" $?
has "3: ...and reported" "$OUT" "tip changed during run"
exists refs/pruned/20200101/old
ok "3: hands-off sweeps nothing" $?
has "3: ...and prints the command that would" "$OUT" "git update-ref --no-deref -d 'refs/pruned/20200101/old' "

plan
SPIKE="$(git -C "$R" rev-parse spike)"
apply --delete-uncertain spike --no-sweep
! exists refs/heads/spike && [ "$(git -C "$R" rev-parse "refs/pruned/$TODAY/spike")" = "$SPIKE" ]
ok "3: a named Uncertain branch is deleted behind a backup ref" $?
exists refs/pruned/20200101/old
ok "3: --no-sweep leaves the breadcrumb" $?

# A breadcrumb that changes between plan and apply is never swept.
new_repo main
git -C "$R" checkout -q -b keeper main
commit "$R" k1
git -C "$R" checkout -q main
M="$(git -C "$R" rev-parse main)"
git -C "$R" update-ref refs/pruned/20200101/moves "$M"
git -C "$R" update-ref refs/pruned/20200101/swaps "$M"
git -C "$R" update-ref refs/pruned/20200101/goes "$M"
plan
git -C "$R" update-ref refs/pruned/20200101/moves main~1
git -C "$R" update-ref -d refs/pruned/20200101/swaps
git -C "$R" symbolic-ref refs/pruned/20200101/swaps refs/heads/keeper
git -C "$R" update-ref -d refs/pruned/20200101/goes
apply
[ "$(git -C "$R" rev-parse refs/pruned/20200101/moves)" = "$(git -C "$R" rev-parse main~1)" ]
ok "3: a breadcrumb that moved is left where it now stands" $?
has "3: ...and reported as moved" "$OUT" "refused: moved"
exists refs/heads/keeper && [ "$(git -C "$R" symbolic-ref refs/pruned/20200101/swaps)" = refs/heads/keeper ]
ok "3: one replaced by a symbolic ref is left, and so is its target" $?
has "3: ...and reported as replaced" "$OUT" "now a symbolic ref to refs/heads/keeper"
has "3: one that vanished is reported as vanished" "$OUT" "refused: vanished"
has "3: a refused sweep is called a race" "$OUT" "another process touched refs/pruned"
hasnt "3: no removal command is printed for a refused breadcrumb" "$OUT" "git update-ref --no-deref -d 'refs/pruned/20200101/moves'"

# --- 4. the local default: pull and no-pull ----------------------------------
new_repo main
git -C "$R" checkout -q -b side main
git -C "$R" branch -f main main~1
plan --no-pull
[ "$(git -C "$R" rev-parse main)" = "$(git -C "$R" rev-parse origin/main~1)" ]
ok "4: no-pull leaves a lagging local default alone" $?
has "4: ...and says so" "$OUT" "skipped (no-pull)"
plan
[ "$(git -C "$R" rev-parse main)" = "$(git -C "$R" rev-parse origin/main)" ]
ok "4: the default run fast-forwards it through a temporary worktree" $?
[ "$(git -C "$R" worktree list | wc -l | tr -d ' ')" = 1 ]
ok "4: ...and removes that worktree" $?

# --- 5. PR evidence, through a fake gh ---------------------------------------
new_repo main
git -C "$R" checkout -q -b squashed main
commit "$R" q1
git -C "$R" push -q -u origin squashed
git -C "$R" checkout -q -b rewritten main
commit "$R" r1
git -C "$R" push -q -u origin rewritten
git -C "$R" checkout -q -b wrongbase main
commit "$R" b1
git -C "$R" push -q -u origin wrongbase
# stackbase sits under stacktop, which a merged PR settles; inreview is
# reachable from the current branch and heads an open PR; nosubject has no
# upstream, so only the default's "(#42)" subject can find its PR.
git -C "$R" checkout -q -b stackbase main
commit "$R" sb1
git -C "$R" checkout -q -b stacktop
commit "$R" st1
git -C "$R" push -q -u origin stacktop
git -C "$R" checkout -q -b nosubject main
commit "$R" n1
# reopened was merged at exactly this tip and now heads a second, open PR.
git -C "$R" checkout -q -b reopened main
commit "$R" ro1
git -C "$R" push -q -u origin reopened
git -C "$R" checkout -q main
commit "$R" "squash of nosubject (#42)"
git -C "$R" push -q origin main
git -C "$R" checkout -q -b standing main
commit "$R" i1
git -C "$R" branch inreview
commit "$R" i2
ST_OID="$(git -C "$R" rev-parse stacktop)"
NS_OID="$(git -C "$R" rev-parse nosubject)"
SQ_OID="$(git -C "$R" rev-parse squashed)"
WB_OID="$(git -C "$R" rev-parse wrongbase)"
RO_OID="$(git -C "$R" rev-parse reopened)"
FAKE="$(dirname "$R")/bin"
mkdir -p "$FAKE"
cat >"$FAKE/gh" <<EOF
#!/usr/bin/env bash
echo "\$*" >>"$FAKE/gh.log"
case "\$1 \$2" in
"repo view") printf 'acme/widgets\thttps://example.test/acme/widgets\n' ;;
"pr list")
	case "\$*" in
	*"--head squashed "*) printf 'squashed\t$SQ_OID\tmain\n' ;;
	*"--head rewritten "*) printf 'rewritten\t0000000000000000000000000000000000000000\tmain\n' ;;
	*"--head wrongbase "*) printf 'wrongbase\t$WB_OID\trelease\n' ;;
	*"--head stacktop "*) printf 'stacktop\t$ST_OID\tmain\n' ;;
	*"--head reopened "*) printf 'reopened\t$RO_OID\tmain\n' ;;
	*"--state open "*) printf 'inreview\t7\nreopened\t8\n' ;;
	esac ;;
"pr view")
	[ "\$3" = 42 ] && printf 'MERGED\tnosubject\t$NS_OID\tmain\n' ;;
esac
EOF
# `git remote get-url origin` answers with a GitHub-shaped URL; everything else
# is the real git, still fetching from the local bare repository.
REAL_GIT="$(command -v git)"
cat >"$FAKE/git" <<EOF
#!/usr/bin/env bash
if [ "\$1 \$2 \$3" = "remote get-url origin" ]; then echo "https://example.test/acme/widgets.git"; exit 0; fi
exec "$REAL_GIT" "\$@"
EOF
chmod +x "$FAKE/gh" "$FAKE/git"
CASE_PATH="$FAKE:$REAL_PATH"
plan
has "5: the selector is origin's own host and repository" "$OUT" "PR lookups: example.test/acme/widgets"
has "5: an exact head match on a merged PR is Merged" "$(row squashed)" "Merged"
has "5: a merged PR with another head forces Uncertain" "$(row rewritten)" "different head"
has "5: a merged PR into another base proves nothing" "$(row wrongbase)" "Uncertain"
has "5: a branch under a PR-merged one is not kept alive by it" "$(row stackbase)" "Uncertain"
has "5: a branch heading an open PR is Uncertain though the current branch contains it" "$(row inreview)" "open PR #7"
has "5: an open PR outranks a merged PR with this exact head" "$(row reopened)" "open PR #8"
has "5: a default-branch subject finds the PR of a branch with no upstream" "$(row nosubject)" "Merged"
grep -q -- "--repo example.test/acme/widgets" "$FAKE/gh.log"
ok "5: every PR query names the selector" $?
! grep "pr " "$FAKE/gh.log" | grep -qv -- "--repo example.test/acme/widgets"
ok "5: ...with no exception" $?
CASE_PATH="$REAL_PATH"

# --- 5b. the subject fallback alone, and a branch that moves under apply -----
new_repo main
git -C "$R" checkout -q -b lonely main
commit "$R" l1
git -C "$R" checkout -q main
commit "$R" "squash of lonely (#9)"
git -C "$R" push -q origin main
git -C "$R" branch racy main~2
git -C "$R" symbolic-ref refs/heads/alias refs/heads/main
LO_OID="$(git -C "$R" rev-parse lonely)"
FAKE="$(dirname "$R")/bin"
mkdir -p "$FAKE"
cat >"$FAKE/gh" <<EOF
#!/usr/bin/env bash
case "\$1 \$2" in
"repo view") printf 'acme/widgets\thttps://example.test/acme/widgets\n' ;;
"pr view") [ "\$3" = 9 ] && printf 'MERGED\tlonely\t$LO_OID\tmain\n' ;;
esac
EOF
# This git moves `racy` in the instant before its deletion is attempted.
cat >"$FAKE/git" <<EOF
#!/usr/bin/env bash
if [ "\$1 \$2 \$3" = "remote get-url origin" ]; then echo "https://example.test/acme/widgets.git"; exit 0; fi
if [ "\$1 \$2 \$3 \$4" = "update-ref --no-deref -d refs/heads/racy" ]; then "$REAL_GIT" update-ref refs/heads/racy "$LO_OID"; fi
exec "$REAL_GIT" "\$@"
EOF
chmod +x "$FAKE/gh" "$FAKE/git"
CASE_PATH="$FAKE:$REAL_PATH"
plan
has "5b: the subject fallback runs when no head lookup settled anything" "$(row lonely)" "Merged"
has "5b: a symbolic ref under refs/heads/ is protected, not a candidate" "$(row alias)" "symbolic ref to refs/heads/main"
apply --hands-off
exists refs/heads/main && [ "$(git -C "$R" symbolic-ref refs/heads/alias)" = refs/heads/main ]
ok "5b: ...so neither it nor its target is deleted" $?
[ "$(git -C "$R" rev-parse --verify --quiet refs/heads/racy)" = "$LO_OID" ]
ok "5b: a branch that moved just before its deletion survives at its new tip" $?
has "5b: ...and is reported kept" "$OUT" "tip changed just before deletion"
CASE_PATH="$REAL_PATH"

# --- 6. a helper-owned worktree, through a fake wt-remove --------------------
new_repo main
git -C "$R" branch owned main~1
git -C "$R" branch dirty main~1
mkdir -p "$R/.worktrees/box"
git -C "$R" worktree add -q "$R/.worktrees/box/owned" owned
git -C "$R" worktree add -q "$R/.worktrees/box/dirty" dirty
echo x >"$R/.worktrees/box/dirty/file"
printf '.worktrees/\n' >>"$R/.git/info/exclude"
FAKE="$(dirname "$R")/bin"
mkdir -p "$FAKE"
cat >"$FAKE/wt-remove" <<EOF
#!/usr/bin/env bash
echo "\$PWD \$*" >>"$FAKE/wt.log"
exec git worktree remove "$R/.worktrees/box/\$1"
EOF
chmod +x "$FAKE/wt-remove"
CASE_PATH="$FAKE:$REAL_PATH"
export CONTAINER_NAME=box
plan
has "6: a branch in this container's helper worktree is proposed for deletion" "$(row owned)" "delete"
apply --hands-off
! exists refs/heads/owned && [ ! -d "$R/.worktrees/box/owned" ]
ok "6: hands-off removes it through wt-remove and deletes the branch" $?
grep -q " owned$" "$FAKE/wt.log"
ok "6: wt-remove was given the slug" $?
exists refs/heads/dirty && [ -f "$R/.worktrees/box/dirty/file" ]
ok "6: a dirty helper worktree keeps its branch and its files" $?
has "6: ...and the report says why" "$OUT" "uncommitted or untracked files"
git -C "$R" branch moved main~1
git -C "$R" worktree add -q "$R/.worktrees/box/moved" moved
git -C "$R" config branch.moved.description gone
plan
export CONTAINER_NAME=elsewhere
apply --hands-off
exists refs/heads/moved && [ -d "$R/.worktrees/box/moved" ]
ok "6: a container renamed since the plan no longer owns the worktree" $?
has "6: ...and the report says so" "$OUT" "no longer owns the worktree"
export CONTAINER_NAME=box
plan
apply --hands-off
! exists refs/heads/moved && ! git -C "$R" config --get branch.moved.description >/dev/null
ok "6: a deleted branch takes its config section with it" $?
unset CONTAINER_NAME
CASE_PATH="$REAL_PATH"
plan
has "6: without CONTAINER_NAME the same worktree needs approval" "$(row dirty)" "--approve-worktree"

cmp -s "$HELPER" "$SCRIPT_DIR/../codex/dev-skills/skills/prune-branches/prune-branches.sh"
ok "the Codex mirror ships the same helper, byte for byte" $?
# The skill runs the helper by path, so the committed mode has to be executable.
[ "$(git -c safe.directory='*' -C "$SCRIPT_DIR/.." ls-files -s -- '*/prune-branches/prune-branches.sh' | grep -c '^100755 ')" = 2 ]
ok "both copies are committed executable" $?
(cd "$R" && "$HELPER" --help >/dev/null 2>&1)
ok "the helper runs by path" $?

# --- 7. usage ----------------------------------------------------------------
(cd "$R" && bash "$HELPER" frobnicate >/dev/null 2>&1)
[ $? = 64 ]
ok "7: an unknown subcommand is a usage error" $?
(cd "$R" && bash "$HELPER" apply >/dev/null 2>&1)
[ $? = 64 ]
ok "7: apply without a plan is a usage error" $?

if [ "$fails" -ne 0 ]; then
	echo "prune-branches helper test: $fails/$checks checks FAILED." >&2
	exit 1
fi
echo "prune-branches helper test passed ($checks checks)."
