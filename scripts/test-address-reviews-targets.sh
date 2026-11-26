#!/usr/bin/env bash
# Hermetic test for the address-reviews batch helper
# (plugins/dev-skills/skills/address-reviews/targets.sh).
#
# Nothing here reaches the network: `gh` is a fake that answers each query from
# canned JSON run through the real `jq` with the helper's own `--jq` program,
# and refuses a call that names no `--repo`; git is the real one, in throwaway
# repositories whose "GitHub" remote is a bare repository behind an insteadOf
# rewrite. The address-review script the helper calls is the shipped one,
# except in section 9, which puts a stub in its place to reach the answers the
# real one cannot be made to give.
# `TARGETS_HELPER` names another copy of the helper to test (a mutant); the
# copy is run from the shipped folder's place, so it finds the same sibling.
# Needs Bash, git, jq and coreutils.
# shellcheck disable=SC2319 # `ok <label> $?` after a `[ … ]` test is the point
# shellcheck disable=SC2016 # the stubs' and the odd ref name's `$` are literal
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SHIPPED="$SCRIPT_DIR/../plugins/dev-skills/skills/address-reviews/targets.sh"
MIRROR="$SCRIPT_DIR/../codex/dev-skills/skills/address-reviews/targets.sh"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
# The helper under test sits in a copy of the skills tree, so that a mutant
# named by TARGETS_HELPER still has the shipped address-review folder beside it.
TREE="$WORKDIR/skills"
mkdir -p "$TREE/address-reviews"
cp -R "$SCRIPT_DIR/../plugins/dev-skills/skills/address-review" "$TREE/address-review"
cp "${TARGETS_HELPER:-$SHIPPED}" "$TREE/address-reviews/targets.sh"
HELPER="$TREE/address-reviews/targets.sh"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
unset GH_HOST GH_REPO

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

FAKE="$WORKDIR/bin"
mkdir -p "$FAKE"
export FAKE
cat >"$FAKE/gh" <<'FAKEGH'
#!/usr/bin/env bash
# Answers from files under $FAKE:
#   pr.<N>.json   `gh pr view <N>`; and `gh pr list --head <branch> --state
#                 open` answers with every one of them that is open on that head
#   later.<N>.json  what `gh pr view <N>` answers from its second read on
#   fail.<N>      `gh pr view <N>` fails
#   fail-list     `gh pr list` fails
#   list-lies     `gh pr list` answers with one PR from another head
# A call without `--repo`, or a `pr view` without a PR number, is refused.
printf '%s\n' "$*" >>"$FAKE/gh.log"
expr=. head="" repo="" state="" args=("$@")
i=0
while [ $i -lt ${#args[@]} ]; do
	a="${args[$i]}" b="${args[$((i + 1))]:-}"
	case "$a" in
	--jq) expr="$b" ;;
	--head) head="$b" ;;
	--repo) repo="$b" ;;
	--state) state="$b" ;;
	esac
	i=$((i + 1))
done
if [ -z "$repo" ]; then
	echo "fake gh: no --repo" >&2
	exit 9
fi
case "$1 $2" in
"pr view")
	case "$3" in '' | *[!0-9]*)
		echo "fake gh: pr view without a PR number" >&2
		exit 9
		;;
	esac
	[ ! -f "$FAKE/fail.$3" ] && [ -f "$FAKE/pr.$3.json" ] || exit 1
	n=$(($(cat "$FAKE/reads.$3" 2>/dev/null || echo 0) + 1))
	echo "$n" >"$FAKE/reads.$3"
	file="$FAKE/pr.$3.json"
	[ ! -f "$FAKE/later.$3.json" ] || [ "$n" -lt 2 ] || file="$FAKE/later.$3.json"
	jq -r "$expr" "$file"
	;;
"pr list")
	[ ! -f "$FAKE/fail-list" ] || exit 1
	[ "$state" = open ] && [ -n "$head" ] || exit 9
	if [ -f "$FAKE/list-lies" ]; then
		cat "$FAKE"/pr.*.json | jq -s --arg h "$head" '[.[] | select(.headRefName != $h)][0:1]' | jq -r "$expr"
		exit
	fi
	cat "$FAKE"/pr.*.json | jq -s --arg h "$head" '[.[] | select(.state == "OPEN" and .headRefName == $h)]' | jq -r "$expr"
	;;
*) exit 1 ;;
esac
FAKEGH
chmod +x "$FAKE/gh"
export PATH="$FAKE:$PATH"

commit() { # <repo> <file> <content>
	printf '%s\n' "$3" >"$1/$2"
	git -C "$1" add -A
	git -C "$1" commit -q -m "$2: $3"
}
tip() { git -C "${2:-$R}" rev-parse "$1"; }
HOST=github.com
# pr <N> <head> <base> [key=value...] — an open same-repository PR whose
# reported head is origin's. Keys: state url oid
pr() {
	local n="$1" head="$2" base="$3" kv
	shift 3
	local state=OPEN url="https://$HOST/Acme/Widgets/pull/$n" oid
	oid="$(git -C "$O" rev-parse --verify --quiet "refs/heads/$head" || echo 0000000000000000000000000000000000000000)"
	for kv in "$@"; do local "${kv%%=*}"="${kv#*=}"; done
	printf '{"number":%s,"state":"%s","url":"%s","headRefName":"%s","headRefOid":"%s","isCrossRepository":false,"baseRefName":"%s","baseRefOid":"%s"}\n' \
		"$n" "$state" "$url" "$head" "$oid" "$base" "$(git -C "$O" rev-parse --verify --quiet "refs/heads/$base" || true)" >"$FAKE/pr.$n.json"
}
# new_repo [<host>] → O (bare origin), R (a clone, on main), U (a second
# clone, to move origin from elsewhere). Branches, all pushed:
#   main ── a ── b          (b is stacked on a)
#     ├── c                 (on origin only: R has no local `c`)
#     ├── rel
#     ├── x ── y
#     └── 38                (a branch named like a number)
# and the PRs 1: a→main, 2: b→a, 3: c→main.
new_repo() {
	local d b
	HOST="${1:-github.com}"
	rm -f "$FAKE"/pr.*.json "$FAKE"/later.*.json "$FAKE"/fail* "$FAKE/list-lies" "$FAKE/gh.log"
	d="$(mktemp -d "$WORKDIR/case.XXXXXX")"
	O="$d/origin.git"
	R="$d/repo"
	U="$d/other"
	git init -q --bare -b main "$O"
	git init -q -b main "$R"
	commit "$R" base one
	git -C "$R" remote add origin "https://$HOST/Acme/Widgets.git"
	git -C "$R" config "url.$O.insteadOf" "https://$HOST/Acme/Widgets.git"
	for b in a b:a rel x y:x 38; do
		git -C "$R" checkout -q -b "${b%%:*}" "$([ "${b#*:}" = "$b" ] && echo main || echo "${b#*:}")"
		commit "$R" "f-${b%%:*}" one
	done
	git -C "$R" checkout -q main
	git -C "$R" push -q -u origin main a b rel x y 38
	git clone -q "$O" "$U"
	git -C "$U" checkout -q -b c main
	commit "$U" f-c one
	git -C "$U" push -q origin c
	pr 1 a main
	pr 2 b a
	pr 3 c main
}
land() { # <branch> <file> <content> — a commit on origin's branch, from elsewhere
	git -C "$U" fetch -q origin
	git -C "$U" checkout -q -B "$1" "origin/$1"
	commit "$U" "$2" "$3"
	git -C "$U" push -q origin "$1"
}
call() { # <command> [args...] → OUT (stdout), ERR (stderr), RC
	rm -f "$FAKE/gh.log" "$FAKE"/reads.*
	OUT="$(cd "${R:-$WORKDIR}" && ird=main bash "$HELPER" "$@" 2>"$WORKDIR/err")"
	RC=$?
	ERR="$(cat "$WORKDIR/err")"
	LOG="$(cat "$FAKE/gh.log" 2>/dev/null)"
}
val() { printf '%s\n' "$OUT" | sed -n "s/^$1=//p" | head -n 1; }
# line <entry> → the entry's line; f <key> <entry> → one field of it
line() { printf '%s\n' "$OUT" | awk -F '\t' -v e="entry=$1" '$1 == e'; }
f() { line "$2" | tr '\t' '\n' | sed -n "s/^$1=//p"; }
entries() { printf '%s\n' "$OUT" | sed -n 's/^entry=\([^	]*\)	.*/\1/p' | tr '\n' ' '; }
P=(plan --repo acme/widgets)

# --- 1. usage -----------------------------------------------------------------
new_repo
call
is "1: no command is a usage error" "$RC" 64
call frobnicate
is "1: an unknown command is a usage error" "$RC" 64
call plan 1
is "1: plan without --repo is a usage error" "$RC" 64
has "1: ...which says what is missing" "$ERR" "--repo <owner>/<repo> is required"
has "1: ...and prints the usage lines" "$ERR" "targets.sh repin --repo"
call plan --repo widgets 1
is "1: a --repo with no owner is a usage error" "$RC" 64
call "${P[@]}"
is "1: plan without an entry is a usage error" "$RC" 64
call "${P[@]}" --frob 1
is "1: an unknown flag is a usage error" "$RC" 64
call "${P[@]}" 1 --target
is "1: --target without a value is a usage error" "$RC" 64
call "${P[@]}" 1 --target ""
is "1: an empty --target is a usage error" "$RC" 64
call "${P[@]}" 1 --except 2
is "1: --except naming no entry is a usage error" "$RC" 64
has "1: ...which names it" "$ERR" "--except 2 names no entry"
call "${P[@]}" 1 2 --no-rebase --except 2
is "1: --no-rebase with --except is a usage error" "$RC" 64
call "${P[@]}" 1 "a b"
is "1: an entry with a space in it is a usage error" "$RC" 64
call "${P[@]}" 1 ""
is "1: an empty entry is a usage error" "$RC" 64
call "${P[@]}" 1 "#0"
is "1: PR 0 is a usage error" "$RC" 64
call "${P[@]}" 1 refs/heads/
is "1: a bare refs/heads/ is a usage error" "$RC" 64
call "${P[@]}" --pr 1 2
is "1: plan takes no --pr" "$RC" 64
call repin --repo acme/widgets
is "1: repin without --pr is a usage error" "$RC" 64
call repin --repo acme/widgets --pr x1
is "1: repin with a non-number is a usage error" "$RC" 64
call repin --repo acme/widgets --pr 1 2
is "1: repin with a stray argument is a usage error" "$RC" 64
call repin --repo acme/widgets --pr 1 --target main
is "1: repin takes no --target" "$RC" 64
call repin --repo acme/widgets --pr 1 --no-rebase
is "1: repin takes no --no-rebase" "$RC" 64
is "1: no usage error reached gh" "$LOG" ""
is "1: ...or printed an outcome" "$OUT" ""
call -C
is "1: -C without a directory is a usage error" "$RC" 64
call -C "$WORKDIR/nowhere" "${P[@]}" 1
is "1: -C into a missing directory is a failure" "$RC" 1

# --- 2. a plan: the stack, the order, the default pins ------------------------
new_repo
STALE="$(tip origin/main)"
land main late one
FRESH="$(tip main "$U")"
REFS="$(git -C "$R" for-each-ref refs/heads)"
call "${P[@]}" 2 '#1' 3
is "2: a plan proceeds" "$RC" 0
is "2: outcome= is the first line" "$(printf '%s\n' "$OUT" | head -n 1)" "outcome=planned"
is "2: the repository is the one the PRs' URLs name" "$(val repo)" "Acme/Widgets"
is "2: a stack is seen" "$(val stacked)" yes
is "2: nothing is skipped" "$(val skipped)" 0
lacks "2: no named= line without --target" "$OUT" "named="
is "2: parents come first, the rest as listed" "$(entries)" "#1 3 2 "
is "2: the order is numbered" "$(f order '#1')$(f order 3)$(f order 2)" 123
is "2: a #-prefixed number is a PR" "$(f kind '#1')$(f pr '#1')" pr1
is "2: the dependent names its parent" "$(f parent 2)" 1
is "2: a root has none" "$(f parent '#1')$(f parent 3)" "--"
is "2: a root is pinned to its own base, fetched now" "$(f pin '#1')" "$FRESH"
[ "$FRESH" != "$STALE" ] && [ "$(f pin 3)" = "$FRESH" ]
ok "2: ...not to the remote-tracking ref the last fetch left" $?
is "2: ...as a default target, rebased" "$(f target '#1')$(f rebase '#1')" defaultyes
is "2: a dependent's target is its parent, not yet a commit" "$(f target 2)$(f pin 2)$(f rebase 2)" "parent-yes"
is "2: the head is the fetched one" "$(f head 2)" "$(tip b)"
is "2: the head and base branches are recorded" "$(f head-ref 2) $(f base-ref 2)" "b a"
is "2: the reported base commit too" "$(f base-oid 2)" "$(tip a)"
is "2: a local branch level with the head is equal" "$(f relation 2)" equal
is "2: a head with no local branch is absent" "$(f relation 3)" absent
is "2: ...and is still fetched" "$(f head 3)" "$(tip c "$U")"
is "2: no entry shares a head" "$(f same-head '#1')$(f same-head 2)$(f same-head 3)" "---"
is "2: every line has all sixteen fields" "$(printf '%s\n' "$OUT" | awk -F '\t' '/^entry=/ && NF != 16' | wc -l | tr -d ' ')" 0
is "2: the head GitHub reported is recorded beside the fetched one" "$(f reported 2)" "$(tip b)"
is "2: no local branch moved" "$(git -C "$R" for-each-ref refs/heads)" "$REFS"
is "2: every gh call names the repository" "$(printf '%s\n' "$LOG" | grep -vc -- '--repo ')" 0
is "2: ...and each PR is read by number" "$(printf '%s\n' "$LOG" | grep -c '^pr view [123] --repo ')" 6
is "2: one base fetched once serves both roots" "$(printf '%s\n' "$ERR" | wc -c | tr -d ' ')" 1
# A rerun of one entry alone is a root: it has no listed parent.
call "${P[@]}" 2
is "2: a dependent listed alone has no parent" "$(f parent 2)$(val stacked)" "-no"
is "2: ...and is pinned to its own base branch on the remote" "$(f target 2) $(f pin 2)" "default $(tip a)"
# A three-deep chain listed backwards.
git -C "$R" checkout -q -b d b
commit "$R" f-d one
git -C "$R" push -q origin d
git -C "$R" checkout -q main
pr 4 d b
call "${P[@]}" 4 2 1
is "2: a chain listed child-first comes out parent-first" "$(entries)" "1 2 4 "
is "2: ...each on its own parent" "$(f parent 4)$(f parent 2)$(f parent 1)" "21-"

# --- 3. a named target --------------------------------------------------------
new_repo
commit "$R" local-only one
git -C "$R" branch -f rel HEAD
git -C "$R" reset -q --hard HEAD~1
LOCALREL="$(tip rel)"
[ "$LOCALREL" != "$(tip origin/rel)" ]
ok "3: (fixture) the local rel is not the remote's" $?
call "${P[@]}" --target rel 1 2 3
is "3: a named target plans" "$RC" 0
is "3: it is resolved here, to the local branch" "$(val named)" "$LOCALREL"
is "3: a root goes onto it" "$(f target 1) $(f pin 1)" "named $LOCALREL"
is "3: ...every root" "$(f target 3) $(f pin 3)" "named $LOCALREL"
is "3: a dependent still goes onto its parent" "$(f target 2)$(f pin 2)" "parent-"
call "${P[@]}" --target "$LOCALREL" 1
is "3: an exact commit is taken as it is" "$(val named) $(f pin 1)" "$LOCALREL $LOCALREL"
call "${P[@]}" --target origin/rel 1
is "3: a remote-tracking ref resolves too" "$(f pin 1)" "$(tip origin/rel)"
git -C "$R" branch 'we$ird' a
call "${P[@]}" --target 'we$ird' 1
is "3: a ref name with a \$ in it is one argument" "$(val named)" "$(tip a)"
git -C "$U" checkout -q -b only-remote main
commit "$U" f-or one
git -C "$U" push -q origin only-remote
call "${P[@]}" --target only-remote 1 2
is "3: a target that is only on the remote stops the batch" "$RC" 3
is "3: ...as unresolved" "$(val outcome)" unresolved
is "3: ...naming it" "$(val target)" only-remote
has "3: ...and saying nothing stands in" "$ERR" "nothing stands in for it"
lacks "3: ...with no entry planned" "$OUT" "entry="
is "3: ...and no PR read" "$LOG" ""
git -C "$R" rev-parse --verify --quiet refs/remotes/origin/only-remote >/dev/null
is "3: ...and nothing fetched for it" "$?" 1
call "${P[@]}" --target "$(tip 'HEAD^{tree}')" 1
is "3: a tree is not a commit" "$(val outcome)" unresolved

# --- 4. no-rebase, and an excepted entry --------------------------------------
new_repo
land a late one
call "${P[@]}" --no-rebase 1 2 3
is "4: a no-rebase batch plans" "$RC" 0
is "4: no entry rebases" "$(f rebase 1)$(f rebase 2)$(f rebase 3)" nonono
is "4: each effective base is its own base branch, fetched" "$(f target 1) $(f pin 1)" "default $(tip main "$U")"
is "4: ...a dependent's too: its parent's branch on the remote" "$(f target 2) $(f pin 2)" "default $(tip a "$U")"
is "4: the stack is still reported" "$(f parent 2)$(val stacked)" 1yes
call "${P[@]}" --no-rebase --target rel 1 2
is "4: with a target, no-rebase keeps it as every effective base" "$(f rebase 1)$(f target 1) $(f pin 1)" "nonamed $(tip rel)"
is "4: ...a dependent's included" "$(f rebase 2)$(f target 2) $(f pin 2)" "nonamed $(tip rel)"
call "${P[@]}" --target rel --except 3 1 2 3
is "4: an excepted entry does not rebase" "$(f rebase 3)" no
is "4: ...and stays on its own base, whatever the target" "$(f target 3) $(f pin 3)" "default $(tip main "$U")"
is "4: its siblings rebase" "$(f rebase 1)$(f target 1)$(f rebase 2)$(f target 2)" yesnamedyesparent
call "${P[@]}" --except '#2' 1 2
is "4: an excepted dependent keeps its parent's remote branch" "$(f rebase 2)$(f target 2) $(f pin 2)" "nodefault $(tip a "$U")"
call "${P[@]}" --except 1 1 2
is "4: a dependent of an excepted parent still goes onto it" "$(f rebase 1)$(f rebase 2)$(f target 2)" noyesparent
call "${P[@]}" --except 1 --except 3 1 2 3
is "4: --except repeats" "$(f rebase 1)$(f rebase 2)$(f rebase 3)" noyesno

# --- 5. branch entries --------------------------------------------------------
new_repo
call "${P[@]}" b a
is "5: branch entries plan" "$RC" 0
is "5: a branch is paired with the open PR from that head" "$(f kind a)$(f pr a)" branch1
is "5: ...and stacks like any other" "$(f parent b) $(entries)" "1 a b "
has "5: the pairing asks for open PRs from that head, in the repository" "$LOG" "pr list --head a --state open --repo acme/widgets"
call "${P[@]}" 01
is "5: a PR number with leading zeros is that PR" "$(f kind 01)$(f pr 01)" pr1
call "${P[@]}" refs/heads/a
is "5: refs/heads/<name> is that branch" "$(f kind refs/heads/a)$(f pr refs/heads/a)" branch1
pr 9 38 main
call "${P[@]}" refs/heads/38
is "5: ...which is how a branch named like a number is said" "$(f kind refs/heads/38)$(f pr refs/heads/38)$(f head-ref refs/heads/38)" branch938
call "${P[@]}" c 1
is "5: a branch that is not local is skipped" "$(f skip c)" not-local
is "5: ...its sibling planned" "$(f skip 1)$(f rebase 1)" "-yes"
is "5: ...and counted" "$(val skipped)" 1
has "5: ...with the reason on stderr" "$ERR" "'c' is not a local branch"
is "5: ...without asking GitHub about it" "$(printf '%s\n' "$LOG" | grep -c 'pr list')" 0
is "5: a skipped entry has no pin" "$(f pin c)$(f rebase c)$(f target c)$(f pr c)" "----"
call "${P[@]}" rel
is "5: a local branch with no open PR is skipped" "$(f skip rel)" no-pr
is "5: ...and the plan still proceeds" "$RC" 0
is "5: ...touching no repository" "$(val repo)" "-"
pr 5 a rel
call "${P[@]}" a
is "5: two open PRs from one head are ambiguous" "$(f skip a)" ambiguous
has "5: ...and the count is said" "$ERR" "2 open PRs"
pr 5 a rel state=CLOSED
call "${P[@]}" a
is "5: a closed PR from the head does not count" "$(f skip a)$(f pr a)" "-1"
call "${P[@]}" 1 a '#1' 2
is "5: a PR listed again as its branch is an alias" "$(f skip a) $(f pr a)" "alias 1"
is "5: ...and so is a number repeated" "$(f skip '#1')" alias
is "5: ...planned once" "$(f skip 1)$(val skipped)" "-2"
is "5: ...and never the parent in place of the first" "$(f parent 2)" 1
has "5: ...with the reason on stderr" "$ERR" "which entry '1' already is"
call "${P[@]}" --except a 1 a 2
is "5: excepting either spelling excepts the PR" "$(f rebase 1)$(f rebase 2)" noyes
call "${P[@]}" --except 1 a 1
is "5: ...whichever came first" "$(f rebase a)$(f skip 1)" noalias
touch "$FAKE/list-lies"
call "${P[@]}" b
is "5: a listing answered with another head is a failure" "$RC$OUT" 1
rm "$FAKE/list-lies"
touch "$FAKE/fail-list"
call "${P[@]}" 1 b
is "5: a failed listing fails the plan" "$RC" 1
is "5: ...printing none of it" "$OUT" ""
rm "$FAKE/fail-list"

# --- 6. entries that cannot be worked -----------------------------------------
new_repo
pr 1 a main state=MERGED
call "${P[@]}" 1 2 3
is "6: a PR that is not open is skipped, not a stop" "$RC $(f skip 1)" "0 closed"
has "6: ...with pr-branch's explanation passed on" "$ERR" "PR #1 is MERGED, not open"
is "6: ...and no pin" "$(f pin 1)$(f rebase 1)$(f head 1)" "---"
is "6: its dependent still names it as parent" "$(f parent 2)$(f target 2)$(f skip 2)" "1parent-"
is "6: a skipped parent is not a usable stack" "$(val stacked)$(val skipped)" yes1
is "6: the sibling is planned" "$(f skip 3)$(f target 3)" "-default"
call "${P[@]}" 1
is "6: a batch of skipped entries reports no stack" "$(val stacked)$(val skipped)" no1
pr 1 a main
jq -c '.isCrossRepository = true' "$FAKE/pr.3.json" >"$FAKE/tmp" && mv "$FAKE/tmp" "$FAKE/pr.3.json"
call "${P[@]}" 1 3
is "6: a fork PR is skipped" "$(f skip 3)$(f skip 1)" "fork-"
# The head ref rewound behind what GitHub reports.
new_repo
git -C "$U" push -q --force origin "$(tip main "$U"):refs/heads/a"
call "${P[@]}" 1 3
is "6: a head fetched behind the reported one is a rewind" "$(f skip 1)" rewind
is "6: ...with nothing adopted" "$(f head 1)" "-"
is "6: ...and the sibling planned" "$(f skip 3)" "-"
# ...and GitHub caught up with the rewind between this run's two reads of it.
new_repo
jq -c --arg o "$(tip main)" '.headRefOid = $o' "$FAKE/pr.1.json" >"$FAKE/later.1.json"
git -C "$U" push -q --force origin "$(tip main "$U"):refs/heads/a"
call "${P[@]}" 1
is "6: a rewind GitHub reports by the second read is still a rewind" "$(f skip 1)" rewind
is "6: ...and the head first reported is on its line" "$(f reported 1)" "$(tip a)"
# Only a skipped entry is stacked.
new_repo
pr 2 b a state=CLOSED
call "${P[@]}" 1 2
is "6: a stack of which only the parent is usable is not reported as one" "$(f skip 2)$(f parent 2)$(val stacked)" closed1no
# No remote of the checkout is the PRs' repository.
new_repo
git -C "$R" remote set-url origin "https://github.com/Acme/Elsewhere.git"
call "${P[@]}" 1
is "6: a checkout with no remote for the repository skips the entry" "$RC $(f skip 1)" "0 no-remote"
# Two PRs from one head, by number.
new_repo
pr 8 a rel
call "${P[@]}" 1 8 2
is "6: two PRs from one head are both planned" "$(f skip 1)$(f skip 8)" "--"
is "6: ...the later one saying whom it shares it with" "$(f same-head 8)$(f same-head 1)" "1-"
is "6: ...and a dependent takes the first listed as parent" "$(f parent 2)" 1
call "${P[@]}" 8 1
is "6: ...in listed order" "$(f same-head 1)$(f same-head 8)" "8-"
pr 10 a x
call "${P[@]}" 1 8 10
is "6: a third names the first of them" "$(f same-head 10)$(f same-head 8)" "11"
# A ring.
new_repo
pr 6 x y
pr 7 y x
call "${P[@]}" 3 6 7
is "6: PRs based on each other stop the batch" "$RC" 3
is "6: ...as a cycle" "$(val outcome)" cycle
lacks "6: ...with no entry planned" "$OUT" "entry="

# --- 7. failures --------------------------------------------------------------
new_repo
call "${P[@]}" 1 77
is "7: a PR that cannot be read fails the plan" "$RC" 1
is "7: ...printing none of it" "$OUT" ""
has "7: ...and naming the PR" "$ERR" "could not read PR #77"
touch "$FAKE/fail.1"
call repin --repo acme/widgets --pr 1
is "7: a PR that cannot be read fails repin" "$RC$OUT" 1
rm "$FAKE/fail.1"
pr 1 a main url=https://github.com/Acme/Other/pull/1
call "${P[@]}" 1
is "7: a PR whose URL names another repository is a failure" "$RC$OUT" 1
has "7: ...which says where it is" "$ERR" "is in Acme/Other by its own URL"
pr 1 a main url=https://github.com/Acme
call "${P[@]}" 1
is "7: a URL that names no repository is a failure" "$RC$OUT" 1
pr 1 a main url=https://github.com/Evil/acme/widgets/pull/1
call "${P[@]}" 1
is "7: a repository is not matched by its tail" "$RC" 1
pr 1 a main
jq -c '.number = 2' "$FAKE/pr.1.json" >"$FAKE/tmp" && mv "$FAKE/tmp" "$FAKE/pr.1.json"
call "${P[@]}" 1
is "7: an answer for another PR is a failure" "$RC$OUT" 1
call repin --repo acme/widgets --pr 1
is "7: ...for repin too" "$RC$OUT" 1
pr 1 a main
jq -c '.baseRefName = null' "$FAKE/pr.1.json" >"$FAKE/tmp" && mv "$FAKE/tmp" "$FAKE/pr.1.json"
call "${P[@]}" --target main 1
is "7: an answer without a base is a failure, though nothing would fetch it" "$RC$OUT" 1
pr 1 a main
pr 3 c main url=https://ghe.example/Acme/Widgets/pull/3
call "${P[@]}" --target main 1 3
is "7: entries on two hosts are not one batch" "$RC$OUT" 1
has "7: ...which says so" "$ERR" "One batch is one repository"
pr 3 c main
pr 1 a main
mv "$O" "$O.gone"
call "${P[@]}" 1
is "7: a head that cannot be fetched fails the plan" "$RC$OUT" 1
has "7: ...saying so" "$ERR" "nothing is planned"
call repin --repo acme/widgets --pr 1
is "7: a base that cannot be fetched fails repin" "$RC$OUT" 1
mv "$O.gone" "$O"
R="$WORKDIR" call "${P[@]}" 1
is "7: outside a repository is a failure" "$RC$OUT" 1
is "7: ...before anything is read" "$LOG" ""

# --- 8. another host, and repin -----------------------------------------------
new_repo ghe.example
call plan --repo ghe.example/acme/widgets 2 1
is "8: a host-qualified repository plans" "$RC" 0
is "8: ...and is reported host-qualified" "$(val repo)" "ghe.example/Acme/Widgets"
is "8: ...with its stack" "$(f parent 2) $(f pin 1)" "1 $(tip main)"
is "8: every gh call names the host-qualified repository" "$(printf '%s\n' "$LOG" | grep -vc -- '--repo ghe.example/')" 0
call plan --repo acme/widgets 1
is "8: a repository gh places on another host is reported with it" "$(val repo) $(f skip 1)" "ghe.example/Acme/Widgets -"
call plan --repo github.com/acme/widgets 1
is "8: a PR on another host than the one named is a failure" "$RC$OUT" 1
call repin --repo ghe.example/acme/widgets --pr 1
is "8: repin on another host" "$(val outcome) $(val repo)" "pinned ghe.example/Acme/Widgets"
new_repo
call plan --repo github.com/acme/widgets 1
is "8: github.com may be said outright" "$RC $(val repo)" "0 Acme/Widgets"
call plan --repo ghe.example/acme/widgets 1
is "8: a PR on github.com is not in a repository named on another host" "$RC$OUT" 1
call "${P[@]}" 1
OLD="$(f pin 1)"
land main late one
call repin --repo acme/widgets --pr 1
is "8: repin proceeds" "$RC" 0
is "8: outcome= is the first line" "$(printf '%s\n' "$OUT" | head -n 1)" "outcome=pinned"
is "8: it pins the base as it is now" "$(val pin)" "$(tip main "$U")"
[ "$(val pin)" != "$OLD" ]
ok "8: ...which is not what the plan pinned" $?
is "8: ...with the PR and its base" "$(val pr) $(val base-ref)" "1 main"
is "8: ...reading that PR, in that repository" "$LOG" "pr view 1 --repo acme/widgets --json number,state,url,headRefName,headRefOid,baseRefName,baseRefOid --jq $(printf '%s\n' "$LOG" | sed 's/.* --jq //')"
pr 1 a rel
call repin --repo acme/widgets --pr 1
is "8: a retargeted PR is pinned to the base it names now" "$(val base-ref) $(val pin)" "rel $(tip rel)"
pr 1 a main state=MERGED
call repin --repo acme/widgets --pr 1
is "8: a PR no longer open stops repin" "$RC $(val outcome) $(val state)" "3 closed MERGED"
lacks "8: ...pinning nothing" "$OUT" "pin="
pr 1 a main
git -C "$R" remote set-url origin "https://github.com/Acme/Elsewhere.git"
call repin --repo acme/widgets --pr 1
is "8: no remote for the repository stops repin" "$RC $(val outcome)" "3 no-remote"

# --- 9. the answers pr-branch.sh cannot be made to give -----------------------
new_repo
REAL="$TREE/address-review/pr-branch.sh"
mv "$REAL" "$REAL.real"
stub() { # the body of a pr-branch.sh that sees its command as $1
	printf '#!/usr/bin/env bash\n%s\n' "$1" >"$REAL"
}
stub 'case "$1" in head) echo outcome=open; echo head=abc; echo relation=equal ;; pin-base) echo outcome=no-remote; echo "nowhere to fetch from" >&2; exit 3 ;; esac'
call "${P[@]}" 1 2
is "9: a base with no remote to fetch from skips the entry" "$RC $(f skip 1)" "0 no-remote"
is "9: ...leaving it no pin or target" "$(f pin 1)$(f target 1)$(f rebase 1)" "---"
has "9: ...with the explanation passed on" "$ERR" "nowhere to fetch from"
is "9: ...and its dependent untouched" "$(f skip 2)$(f target 2)" "-parent"
call repin --repo acme/widgets --pr 1
is "9: ...and stops repin" "$RC $(val outcome) $(val base-ref)" "3 no-remote main"
stub 'case "$1" in head) echo outcome=open; echo head=abc; echo relation=equal ;; pin-base) exit 64 ;; esac'
call "${P[@]}" 1
is "9: a pin-base that fails otherwise fails the plan" "$RC$OUT" 1
stub 'case "$1" in head) echo outcome=open; echo head=abc; echo relation=equal ;; pin-base) echo outcome=pinned ;; esac'
call "${P[@]}" 1
is "9: a pin without a commit is a failure" "$RC$OUT" 1
call repin --repo acme/widgets --pr 1
is "9: ...for repin too" "$RC$OUT" 1
call "${P[@]}" --target main 1
is "9: ...and for a named target" "$RC$OUT" 1
stub 'case "$1" in head) echo outcome=open; echo head=abc ;; pin-base) echo outcome=pinned; echo base=def ;; esac'
call "${P[@]}" 1
is "9: a head without a relation is a failure" "$RC$OUT" 1
stub 'case "$1" in head) echo outcome=odd; exit 1 ;; esac'
call "${P[@]}" 1
is "9: a head read that fails is a failure, whatever it printed first" "$RC$OUT" 1
stub 'case "$1" in head) exit 3 ;; pin-base) exit 3 ;; esac'
call "${P[@]}" 1
is "9: a stop without an outcome is a failure" "$RC$OUT" 1
call repin --repo acme/widgets --pr 1
is "9: ...for repin too" "$RC$OUT" 1
stub 'case "$1" in head) echo outcome=open; echo head=abc; echo relation=equal ;; pin-base) echo outcome=pinned; echo "base=$(date +%s%N)" ;; esac'
call "${P[@]}" 1 3
is "9: one base branch is fetched once for the entries on it" "$(f pin 1)" "$(f pin 3)"
mv "$REAL.real" "$REAL"

# --- 10. the shipped files ----------------------------------------------------
cmp -s "$SHIPPED" "$MIRROR"
ok "10: the Codex mirror ships the same helper, byte for byte" $?
for file in plugins/dev-skills/skills/address-reviews/targets.sh codex/dev-skills/skills/address-reviews/targets.sh; do
	mode="$(git -c safe.directory='*' -C "$SCRIPT_DIR/.." ls-files -s -- "$file" | cut -d' ' -f1)"
	is "10: $file is committed executable" "$mode" 100755
done
OUT="$(bash "$SHIPPED" --help 2>&1)"
has "10: the helper prints its contract" "$OUT" "targets.sh repin"
has "10: ...to its last line" "$OUT" "Written for bash 3.2 and later."
lacks "10: ...and none of its code" "$OUT" "set -u"
[ -f "$(dirname "$MIRROR")/../address-review/pr-branch.sh" ]
ok "10: the Codex mirror has the address-review pr-branch.sh the helper calls" $?
ALONE="$WORKDIR/alone/address-reviews"
mkdir -p "$ALONE"
cp "$HELPER" "$ALONE/targets.sh"
new_repo
OUT="$(cd "$R" && bash "$ALONE/targets.sh" "${P[@]}" 1 2>&1)"
is "10: a copy with no address-review folder beside it fails" "$?" 1
has "10: ...saying what is missing" "$OUT" "address-review skill's scripts"
find "${TMPDIR:-/tmp}" -maxdepth 1 -name 'targets.*' -newer "$FAKE/gh" 2>/dev/null | grep -q .
is "10: no run left its temporary directory behind" "$?" 1

if [ "$fails" -gt 0 ]; then
	printf 'address-reviews targets helper test: %d/%d checks FAILED.\n' "$fails" "$checks" >&2
	exit 1
fi
printf 'address-reviews targets helper test passed (%d checks).\n' "$checks"
