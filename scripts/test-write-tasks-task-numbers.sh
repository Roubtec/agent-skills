#!/usr/bin/env bash
# Hermetic test for the write-tasks skill's bundled `task-numbers.sh`, and for
# `task-citations.sh` beside it.
#
# Each case builds a throwaway bare "origin" and a clone whose remote carries a
# GitHub-shaped URL that a repository-local `insteadOf` rewrites to the bare
# origin, so the remote is matched by URL for real (through the address-review
# skill's `pr-branch.sh`, which the helper calls). Pull request heads are
# pushed to `refs/pull/<N>/head` there. `gh` is a fake that answers `pr list`
# from a JSON file through the real `jq` and the helper's own `--jq`.
# `TASK_NUMBERS_HELPER` points the suite at another copy (a mutant, say); it
# must sit where `../address-review/pr-branch.sh` resolves;
# `TASK_CITATIONS_HELPER` does the same for the other script, which needs no
# neighbour.
# shellcheck disable=SC2319,SC2016 # `ok <label> $?` after a `[ … ]` test is the point; a task line's backticks are its text
set -u

ROOT="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SHIPPED="$ROOT/plugins/dev-skills/skills/write-tasks/task-numbers.sh"
MIRROR="$ROOT/codex/dev-skills/skills/write-tasks/task-numbers.sh"
HELPER="${TASK_NUMBERS_HELPER:-$SHIPPED}"
CITES_SHIPPED="$ROOT/plugins/dev-skills/skills/write-tasks/task-citations.sh"
CITES="${TASK_CITATIONS_HELPER:-$CITES_SHIPPED}"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/task-numbers-test.XXXXXX")" || exit 1
trap 'rm -rf "$WORKDIR"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
unset GH_HOST
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

FAKE="$WORKDIR/bin"
mkdir -p "$FAKE"
export FAKE
cat >"$FAKE/gh" <<'FAKEGH'
#!/usr/bin/env bash
# `pr list` answers from $FAKE/prs.json through the caller's --jq; it fails
# where $FAKE/fail-list exists. Everything else fails.
printf '%s\n' "$*" >>"$FAKE/gh.log"
expr=. args=("$@")
i=0
while [ $i -lt ${#args[@]} ]; do
	[ "${args[$i]}" != --jq ] || expr="${args[$((i + 1))]:-}"
	i=$((i + 1))
done
case "$1 $2" in
"pr list")
	[ ! -f "$FAKE/fail-list" ] || exit 1
	jq -r "$expr" "$FAKE/prs.json"
	;;
*) exit 1 ;;
esac
FAKEGH
chmod +x "$FAKE/gh"
export PATH="$FAKE:$PATH"

O="" R="" U=""
tip() { git -C "${2:-$R}" rev-parse "$1"; }
# put <repo> <path> [text]: write a file, and commit it.
put() {
	mkdir -p "$1/$(dirname "$2")"
	printf '%s\n' "${3:-x}" >"$1/$2"
	git -C "$1" add "$2"
	git -C "$1" commit -q -m "add $2"
}
new_repo() {
	local d
	d="$(mktemp -d "$WORKDIR/case.XXXXXX")"
	O="$d/origin.git"
	R="$d/repo"
	U="$d/other"
	rm -f "$FAKE/prs.json" "$FAKE/fail-list" "$FAKE/gh.log"
	printf '[]\n' >"$FAKE/prs.json"
	git init -q --bare -b main "$O"
	git init -q -b main "$R"
	put "$R" tasks/001-first.md
	put "$R" tasks/done/002-second.md
	put "$R" tasks/deferred/003a-third.md
	put "$R" tasks/AGENTS.md
	put "$R" src/004-not-a-task.md
	git -C "$R" remote add origin "https://github.com/Acme/Widgets.git"
	git -C "$R" config "url.$O.insteadOf" "https://github.com/Acme/Widgets.git"
	git -C "$R" push -q -u origin main
	git clone -q "$O" "$U"
	git -C "$R" checkout -q -b feature
}
# pr <N> <head oid> <base name> [base oid] [head branch name]: add an open PR
# to the enumeration.
pr() {
	jq --argjson n "$1" --arg h "$2" --arg b "$3" --arg bo "${4:-$(git -C "$O" rev-parse "refs/heads/$3" 2>/dev/null || echo 0000000000000000000000000000000000000000)}" --arg hn "${5:-pr-$1-head}" \
		'. + [{number: $n, headRefOid: $h, baseRefName: $b, baseRefOid: $bo, headRefName: $hn, isCrossRepository: false}]' "$FAKE/prs.json" >"$FAKE/prs.new" && mv "$FAKE/prs.new" "$FAKE/prs.json"
}
# other_pr <N> <branch> <base> <path>...: a PR from the other clone, adding
# those files on a branch off <base>, its head published as refs/pull/<N>/head.
other_pr() {
	local n="$1" b="$2" base="$3" p
	shift 3
	git -C "$U" fetch -q origin
	git -C "$U" checkout -q -B "$b" "origin/$base"
	for p in "$@"; do put "$U" "$p"; done
	git -C "$U" push -q origin "$b:refs/pull/$n/head"
	pr "$n" "$(tip "$b" "$U")" "$base"
}
call() { # <command> [args...] → OUT (stdout), ERR (stderr), RC
	OUT="$(cd "$R" && bash "$HELPER" "$@" 2>"$WORKDIR/err")"
	RC=$?
	ERR="$(cat "$WORKDIR/err")"
}
cite() { # [args...] → OUT, ERR, RC, from the top of $R
	OUT="$(cd "$R" && bash "$CITES" "$@" 2>"$WORKDIR/err")"
	RC=$?
	ERR="$(cat "$WORKDIR/err")"
}
val() { printf '%s\n' "$OUT" | sed -n "s/^$1=//p" | head -n 1; }
count() { printf '%s\n' "$OUT" | grep -c "^$1=" || true; }
ARGS=(--repo acme/widgets --base main)

# --- 1. claims on the branch itself -------------------------------------------
new_repo
put "$R" src/code.txt
call claims "${ARGS[@]}"
is "1: a branch that adds no task file is clean" "$(val outcome)" clean
is "1: ...with exit 0" "$RC" 0
is "1: ...claiming nothing" "$(val claims)" 0
is "1: ...against the fetched base" "$(val base)" "$(git -C "$O" rev-parse refs/heads/main)"
[ ! -f "$FAKE/gh.log" ]
ok "1: ...and without asking GitHub" $?
is "1: outcome is the first line" "$(printf '%s\n' "$OUT" | head -n 1)" "outcome=clean"

put "$R" tasks/010-new.md
put "$R" tasks/README.md
put "$R" tasks/notes/12-two-digits.md
call claims "${ARGS[@]}"
is "1: a new task file with a free number is clean" "$(val outcome)" clean
is "1: ...as one claim" "$(val claims)" 1
has "1: ...named with its number" "$OUT" "claim=010${TAB}tasks/010-new.md"
is "1: ...files with no task number are not claims" "$(count claim)" 1
has "1: the enumeration names the repository and its bound" "$(cat "$FAKE/gh.log")" "pr list --repo acme/widgets --state open --limit 200"

put "$R" tasks/002-other.md
call claims "${ARGS[@]}"
is "1: a number a done/ file holds on the base is a collision" "$(val outcome)" collision
is "1: ...with exit 3" "$RC" 3
has "1: ...naming the claim, the holder and its path" "$OUT" "collision=002${TAB}tasks/002-other.md${TAB}base${TAB}tasks/done/002-second.md${TAB}other-path"
is "1: ...once" "$(count collision)" 1
has "1: ...with the first-claimant rule on stderr" "$ERR" "First claimant wins"

new_repo
put "$R" tasks/003-plain.md
put "$R" tasks/001a-suffixed.md
call claims "${ARGS[@]}"
is "1: 003 and 003a, 001 and 001a are different numbers" "$(val outcome)" clean
is "1: ...both claimed" "$(val claims)" 2

new_repo
put "$R" tasks/020-one.md
put "$R" tasks/sub/020-two.md
call claims "${ARGS[@]}"
is "1: two new files on one branch claiming one number collide" "$(val outcome)" collision
has "1: ...each with the other, as the branch's own" "$OUT" "collision=020${TAB}tasks/020-one.md${TAB}branch${TAB}tasks/sub/020-two.md${TAB}other-path"
has "1: ...both ways" "$OUT" "collision=020${TAB}tasks/sub/020-two.md${TAB}branch${TAB}tasks/020-one.md${TAB}other-path"
is "1: ...and a claim is never its own holder" "$(count collision)" 2

# --- 2. relocations -----------------------------------------------------------
new_repo
git -C "$R" mv tasks/001-first.md tasks/done/001-first.md
git -C "$R" commit -q -m archive
call claims "${ARGS[@]}"
is "2: archiving a task claims nothing" "$(val claims)" 0
is "2: ...and is clean" "$(val outcome)" clean
git -C "$R" mv tasks/deferred/003a-third.md tasks/003a-renamed-slug.md
git -C "$R" commit -q -m promote
call claims "${ARGS[@]}"
is "2: a promotion with a new slug claims nothing either" "$(val claims)" 0

new_repo
git -C "$R" mv tasks/001-first.md tasks/done/001-first.md
git -C "$R" commit -q -m archive
put "$R" tasks/001-second-claimant.md
call claims "${ARGS[@]}"
is "2: one removal exempts one addition, not two" "$(val claims)" 1
has "2: ...the same basename is the relocation, the other the claim" "$OUT" "claim=001${TAB}tasks/001-second-claimant.md"
is "2: ...and it collides" "$(val outcome)" collision
has "2: ...with the relocated file on the branch" "$OUT" "collision=001${TAB}tasks/001-second-claimant.md${TAB}branch${TAB}tasks/done/001-first.md${TAB}other-path"
is "2: ...and not with the base's copy the branch removed" "$(count collision)" 1

# An archive under a new slug beside a new file of the same number: the
# archive is the relocation, whichever sorts first.
new_repo
printf 'a long enough body\nfor git to match\nthe renamed archive\nto its source\n' >"$R/tasks/005-old.md"
git -C "$R" add tasks/005-old.md
git -C "$R" commit -q -m seed
git -C "$R" push -q origin feature:main
git -C "$R" mv tasks/005-old.md tasks/done/005-renamed.md
git -C "$R" commit -q -m "archive under a new slug"
put "$R" tasks/005-brand-new.md "something else entirely"
call claims "${ARGS[@]}"
has "2: a renamed archive is the relocation, and the new file the claim" "$OUT" "claim=005${TAB}tasks/005-brand-new.md"
is "2: ...the one claim" "$(val claims)" 1

new_repo
git -C "$R" rm -q tasks/001-first.md
git -C "$R" commit -q -m drop
put "$R" tasks/002-reuse.md
call claims "${ARGS[@]}"
is "2: a removal never pairs across numbers" "$(val claims)" 1
is "2: ...so the reused number still collides with the base" "$(val outcome)" collision

# --- 3. the base is fetched ---------------------------------------------------
new_repo
put "$U" tasks/030-landed.md
git -C "$U" push -q origin main
put "$R" tasks/030-mine.md
call claims "${ARGS[@]}"
is "3: a number that landed on the base since the last fetch is a collision" "$(val outcome)" collision
has "3: ...held by the base" "$OUT" "collision=030${TAB}tasks/030-mine.md${TAB}base${TAB}tasks/030-landed.md${TAB}other-path"
is "3: ...read at the fetched commit" "$(val base)" "$(git -C "$O" rev-parse refs/heads/main)"
is "3: ...which the local base branch does not have" "$(git -C "$R" cat-file -e main:tasks/030-landed.md 2>/dev/null && echo there || echo absent)" absent
call claims --repo acme/widgets --base no-such-branch
is "3: a base that cannot be fetched is a failure, not a clean scan" "$RC" 1
is "3: ...with nothing on stdout" "$OUT" ""
has "3: ...pointing at --local-base" "$ERR" "--local-base"
has "3: ...and passing on why the fetch failed" "$ERR" "could not fetch refs/heads/no-such-branch"
call claims --repo acme/widgets --local-base main
is "3: a local base is read as it stands" "$(val base)" "$(tip main)"
is "3: ...which misses what landed, and says the scan is incomplete" "$(val outcome)" incomplete
is "3: ...with exit 3" "$RC" 3
has "3: ...as degraded" "$OUT" "degraded=the base was read from the local commit"
is "3: ...and no collision" "$(count collision)" 0
git -C "$R" checkout -q -b plain main
put "$R" src/more.txt
call claims --repo acme/widgets --local-base main
is "3: a branch that claims nothing is clean on a local base too" "$(val outcome)" clean
git -C "$R" checkout -q feature
call claims --repo acme/widgets --local-base no-such-commit
is "3: a local base that names no commit is a failure" "$RC" 1
call claims --repo other/elsewhere --base main
is "3: a repository no remote fetches from is a failure" "$RC" 1
has "3: ...saying that no remote matches" "$ERR" "no remote of this checkout fetches from other/elsewhere"

# The base drops a task after the branch forked: the branch's inherited copy
# is neither its addition nor a holder, and the number is free again.
new_repo
git -C "$U" rm -q tasks/001-first.md
git -C "$U" commit -q -m drop
git -C "$U" push -q origin main
call claims "${ARGS[@]}"
is "3: a file the base dropped since the fork is not the branch's addition" "$(val claims)" 0
put "$R" tasks/001-again.md
call claims "${ARGS[@]}"
is "3: ...and its number is free for a new claim" "$(val outcome)" clean
is "3: ...which is the one claim" "$(val claims)" 1

# --- 4. open pull requests ----------------------------------------------------
new_repo
other_pr 5 theirs main tasks/040-theirs.md tasks/041-shared-path.md
put "$R" tasks/040-mine.md
put "$R" tasks/041-shared-path.md
put "$R" tasks/042-free.md
call claims "${ARGS[@]}"
is "4: a number an open PR adds is a collision" "$(val outcome)" collision
has "4: ...held by that PR, at another path" "$OUT" "collision=040${TAB}tasks/040-mine.md${TAB}pr:5${TAB}tasks/040-theirs.md${TAB}other-path"
has "4: ...or at the same path, which is the add/add case" "$OUT" "collision=041${TAB}tasks/041-shared-path.md${TAB}pr:5${TAB}tasks/041-shared-path.md${TAB}same-path"
is "4: ...and a free number is not one" "$(count collision)" 2
git -C "$R" cat-file -e "$(tip theirs "$U")^{commit}"
ok "4: the head was fetched through the PR ref" $?

# A PR stacked on PR 5's branch inherits 040 without claiming it.
new_repo
other_pr 5 theirs main tasks/040-theirs.md
git -C "$U" push -q origin theirs
other_pr 6 child theirs tasks/043-child.md
put "$R" tasks/040-mine.md
call claims "${ARGS[@]}"
has "4: a stacked PR's parent holds the parent's number" "$OUT" "pr:5${TAB}tasks/040-theirs.md"
lacks "4: ...and the child does not, though its tree carries the file" "$OUT" "pr:6"
is "4: ...so there is one collision" "$(count collision)" 1

# The base drops a task after PR 5 forked: PR 5 does not thereby add it.
new_repo
other_pr 5 theirs main tasks/045-theirs.md
git -C "$U" checkout -q main
git -C "$U" rm -q tasks/001-first.md
git -C "$U" commit -q -m drop
git -C "$U" push -q origin main
put "$R" tasks/001-again.md
call claims "${ARGS[@]}"
is "4: a file the base dropped since a PR forked is not that PR's addition" "$(val outcome)" clean

# The enumerated head is not what the PR ref holds any more.
new_repo
other_pr 5 theirs main tasks/046-theirs.md
jq '.[0].headRefOid = "3333333333333333333333333333333333333333"' "$FAKE/prs.json" >"$FAKE/prs.new" && mv "$FAKE/prs.new" "$FAKE/prs.json"
put "$R" tasks/047-mine.md
call claims "${ARGS[@]}"
has "4: a head the PR ref no longer holds is skipped, not read as another commit" "$OUT" "skipped=pr:5${TAB}its head 3333333333333333333333333333333333333333 could not be fetched"

new_repo
other_pr 5 theirs main tasks/050-theirs.md
put "$R" tasks/051-mine.md
call claims "${ARGS[@]}"
is "4: an open PR claiming other numbers leaves the scan clean" "$(val outcome)" clean
is "4: ...with exit 0" "$RC" 0

new_repo
put "$R" tasks/060-mine.md
git -C "$R" push -q origin feature:refs/pull/9/head
pr 9 "$(tip feature)" main
call claims "${ARGS[@]}"
is "4: the scanned branch's own open PR is not a second claimant" "$(val outcome)" clean
has "4: ...and is named" "$OUT" "self=pr:9"
put "$R" tasks/061-more.md
call claims "${ARGS[@]}"
is "4: ...nor when the branch is a commit ahead of it" "$(val outcome)" clean
has "4: ...still named" "$OUT" "self=pr:9"
git -C "$R" reset -q --soft main
git -C "$R" commit -q -m "rewritten, so the PR head is no ancestor"
jq '.[0].headRefName = "feature"' "$FAKE/prs.json" >"$FAKE/prs.new" && mv "$FAKE/prs.new" "$FAKE/prs.json"
call claims "${ARGS[@]}"
is "4: ...nor after a rewrite, where the PR's head branch bears its name" "$(val outcome)" clean
jq '.[0].isCrossRepository = true' "$FAKE/prs.json" >"$FAKE/prs.new" && mv "$FAKE/prs.new" "$FAKE/prs.json"
call claims "${ARGS[@]}"
is "4: a fork's branch of the same name is somebody else's" "$(val outcome)" collision
call claims "${ARGS[@]}" --member feature:main
lacks "4: the scanned branch named as a member holds nothing against itself" "$OUT" "member:feature"

# From a subdirectory the folder is still read from the top.
new_repo
put "$R" tasks/002-other.md
OUT="$(cd "$R/src" && bash "$HELPER" claims "${ARGS[@]}" 2>/dev/null)"
is "4: a run from a subdirectory reads the same folder" "$(val outcome)" collision
OUT="$(cd "$R/tasks" && bash "$HELPER" claims "${ARGS[@]}" 2>/dev/null)"
is "4: ...from inside the task folder too" "$(val claims)" 1
other_pr 5 theirs main tasks/090-theirs.md
OUT="$(cd "$R/src" && bash "$HELPER" taken --repo acme/widgets 2>/dev/null)"
has "4: ...and taken reads open heads from there as well" "$OUT" "taken=090${TAB}pr:5"

# A name git would quote is printed as it is.
new_repo
put "$R" "tasks/006-café.md"
call claims "${ARGS[@]}"
has "4: a non-ASCII path is printed raw" "$OUT" "claim=006${TAB}tasks/006-café.md"

# The remote is learned from any base that can be fetched.
new_repo
put "$R" tasks/070-mine.md
git -C "$U" checkout -q -b fresh-base origin/main
put "$U" tasks/070-far.md
git -C "$U" push -q origin fresh-base:refs/pull/21/head
pr 20 1111111111111111111111111111111111111111 aaa-gone
pr 21 "$(tip fresh-base "$U")" main
call claims --repo acme/widgets --local-base main
has "4: a head is fetched though the first PR's base is gone" "$OUT" "pr:21${TAB}tasks/070-far.md"

# --- 5. what the scan could not see -------------------------------------------
new_repo
put "$R" tasks/070-mine.md
touch "$FAKE/fail-list"
call claims "${ARGS[@]}"
is "5: an enumeration that fails is incomplete, never clean" "$(val outcome)" incomplete
is "5: ...with exit 3" "$RC" 3
has "5: ...saying what was skipped" "$OUT" "skipped=prs${TAB}"
has "5: ...and what to do on stderr" "$ERR" "do not call the scan complete"
rm "$FAKE/fail-list"

pr 11 1111111111111111111111111111111111111111 main
call claims "${ARGS[@]}"
is "5: a head that cannot be fetched is incomplete" "$(val outcome)" incomplete
has "5: ...naming the PR" "$OUT" "skipped=pr:11${TAB}its head 1111111111111111111111111111111111111111 could not be fetched"

new_repo
put "$R" tasks/070-mine.md
other_pr 12 theirs main tasks/070-theirs.md
jq '.[0].baseRefName = "gone"' "$FAKE/prs.json" >"$FAKE/prs.new" && mv "$FAKE/prs.new" "$FAKE/prs.json"
call claims "${ARGS[@]}"
is "5: a PR whose base branch is gone is read against the base commit it names" "$(val outcome)" collision
has "5: ...and still collides" "$OUT" "pr:12"
# The base commit a PR names may arrive only with its head.
new_repo
put "$R" tasks/070-mine.md
git -C "$U" checkout -q -b gone-base origin/main
put "$U" tasks/071-on-gone-base.md
GONE="$(tip gone-base "$U")"
put "$U" tasks/070-theirs.md
git -C "$U" push -q origin gone-base:refs/pull/13/head
pr 13 "$(tip gone-base "$U")" gone "$GONE"
call claims "${ARGS[@]}"
has "5: a base commit that arrives with the head is used" "$OUT" "collision=070${TAB}tasks/070-mine.md${TAB}pr:13${TAB}tasks/070-theirs.md"
lacks "5: ...and what sits under it is not the PR's addition" "$OUT" "tasks/071-on-gone-base.md"

new_repo
put "$R" tasks/070-mine.md
other_pr 12 theirs main tasks/070-theirs.md
jq '.[0].baseRefName = "gone"' "$FAKE/prs.json" >"$FAKE/prs.new" && mv "$FAKE/prs.new" "$FAKE/prs.json"
jq '.[0].baseRefOid = "2222222222222222222222222222222222222222"' "$FAKE/prs.json" >"$FAKE/prs.new" && mv "$FAKE/prs.new" "$FAKE/prs.json"
call claims "${ARGS[@]}"
is "5: ...and is skipped where that commit is not here either" "$(val outcome)" incomplete
has "5: ...by number" "$OUT" "skipped=pr:12${TAB}its base 'gone'"
is "5: ...with no collision invented" "$(count collision)" 0

new_repo
put "$R" tasks/070-mine.md
jq -n --arg h "$(tip main)" --arg b main '[range(1; 201) | {number: ., headRefOid: $h, baseRefName: $b, baseRefOid: $h, headRefName: "pr-\(.)", isCrossRepository: false}]' >"$FAKE/prs.json"
call claims "${ARGS[@]}"
is "5: an enumeration at its bound is incomplete" "$(val outcome)" incomplete
has "5: ...saying the bound" "$OUT" "limit=200"
jq '.[0:199]' "$FAKE/prs.json" >"$FAKE/prs.new" && mv "$FAKE/prs.new" "$FAKE/prs.json"
call claims "${ARGS[@]}"
is "5: one under the bound is complete" "$(val outcome)" clean

new_repo
put "$R" tasks/070-mine.md
other_pr 5 theirs main tasks/070-theirs.md
pr 11 1111111111111111111111111111111111111111 main
call claims "${ARGS[@]}"
is "5: a collision outranks a skipped head" "$(val outcome)" collision
has "5: ...which is still reported" "$OUT" "skipped=pr:11"

# --- 6. run-local members -----------------------------------------------------
new_repo
put "$R" tasks/080-mine.md
call claims "${ARGS[@]}" --reserved 080
is "6: a reserved number is a collision" "$(val outcome)" collision
has "6: ...held as reserved" "$OUT" "collision=080${TAB}tasks/080-mine.md${TAB}reserved${TAB}-${TAB}other-path"
call claims "${ARGS[@]}" --reserved 081 --reserved 080a
is "6: other reserved numbers are not" "$(val outcome)" clean
git -C "$R" checkout -q -b sibling main
put "$R" tasks/080-sibling.md
put "$R" tasks/082-sibling.md
git -C "$R" checkout -q feature
call claims "${ARGS[@]}" --member sibling:main
is "6: a sibling with no PR yet is compared as a member" "$(val outcome)" collision
has "6: ...by what it adds against its own base" "$OUT" "collision=080${TAB}tasks/080-mine.md${TAB}member:sibling${TAB}tasks/080-sibling.md${TAB}other-path"
is "6: ...and only where the numbers meet" "$(count collision)" 1
git -C "$R" checkout -q -b dropped main
git -C "$R" rm -q tasks/001-first.md
git -C "$R" commit -q -m drop
git -C "$R" checkout -q feature
put "$R" tasks/001-mine.md
call claims "${ARGS[@]}" --member sibling:dropped
lacks "6: what a member's base dropped since it forked is not the member's addition" "$OUT" "member:sibling${TAB}tasks/001-first.md"
call claims "${ARGS[@]}" --member no-such:main
is "6: a member that cannot be read is a failure" "$RC" 1
call claims "${ARGS[@]}" --member sibling:no-such
is "6: ...and so is one whose base names no commit" "$RC" 1
has "6: ...which is named" "$ERR" "the base 'no-such' of the member 'sibling'"
# A base half git would read as an option. The fixture is the working
# directory, so a script that let it through would leave one empty file there.
call claims "${ARGS[@]}" --member "sibling:--output=member-base-leak"
is "6: a member's base that is an option to git is a failure, not an empty member" "$RC" 1
is "6: ...with no outcome" "$OUT" ""
[ -z "$(find "$R" -maxdepth 1 -name '*member-base-leak*')" ]
ok "6: ...and it reached git as no option" $?
call claims "${ARGS[@]}" --branch sibling
has "6: --branch scans a branch other than HEAD" "$OUT" "claim=082${TAB}tasks/082-sibling.md"
is "6: ...and it alone" "$(val claims)" 2

# --- 7. another task folder ---------------------------------------------------
new_repo
put "$R" plans/001-elsewhere.md
call claims "${ARGS[@]}"
is "7: files outside the task folder are not claims" "$(val claims)" 0
call claims "${ARGS[@]}" --folder plans
is "7: --folder names another one" "$(val claims)" 1
is "7: ...where the conventional folder's numbers hold nothing" "$(val outcome)" clean

# --- 8. taken -----------------------------------------------------------------
new_repo
other_pr 5 theirs main tasks/090-theirs.md
printf 'x\n' >"$R/tasks/091-untracked.md"
call taken --repo acme/widgets
is "8: taken lists" "$(val outcome)" listed
is "8: ...with exit 0" "$RC" 0
has "8: ...the working tree's numbers at any depth" "$OUT" "taken=002${TAB}tree${TAB}tasks/done/002-second.md"
has "8: ...an untracked task file too" "$OUT" "taken=091${TAB}tree${TAB}tasks/091-untracked.md"
has "8: ...what an open head adds" "$OUT" "taken=090${TAB}pr:5${TAB}tasks/090-theirs.md"
has "8: ...and what it inherits, since that number stands on the head" "$OUT" "taken=001${TAB}pr:5${TAB}tasks/001-first.md"
has "8: ...and a file with no full number, under a dash" "$OUT" "taken=-${TAB}tree${TAB}tasks/AGENTS.md"
lacks "8: ...but nothing outside the folder" "$OUT" "src/004-not-a-task.md"
touch "$FAKE/fail-list"
call taken --repo acme/widgets
is "8: an enumeration that fails is incomplete" "$(val outcome)" incomplete
is "8: ...with exit 3" "$RC" 3
has "8: ...still listing the tree" "$OUT" "taken=001${TAB}tree"
rm "$FAKE/fail-list"
pr 11 1111111111111111111111111111111111111111 main
call taken --repo acme/widgets
has "8: a head that cannot be fetched is named" "$OUT" "skipped=pr:11"
is "8: ...and makes the listing incomplete" "$(val outcome)" incomplete
rm "$R/tasks/091-untracked.md"
jq '.[0:1]' "$FAKE/prs.json" >"$FAKE/prs.new" && mv "$FAKE/prs.new" "$FAKE/prs.json"
call taken --repo acme/widgets --folder plans
is "8: a folder the working tree does not have lists nothing from it" "$(count taken)" 0
is "8: ...and fails nothing" "$RC" 0
ln -s tasks "$R/tk"
call taken --repo acme/widgets --folder tk
has "8: a task folder that is a symlink is read through" "$OUT" "taken=001${TAB}tree${TAB}tk/001-first.md"
rm "$R/tk"
mkdir -p "$R/plans/closed" && printf 'x\n' >"$R/plans/007-a.md" && chmod 000 "$R/plans/closed"
# Only where the mode binds (not as root): a folder find cannot enter.
if ! ls "$R/plans/closed" >/dev/null 2>&1; then
	call taken --repo acme/widgets --folder plans
	is "8: a folder that cannot be read whole is a failure, not a shorter listing" "$RC" 1
	is "8: ...with no outcome" "$OUT" ""
fi
chmod 755 "$R/plans/closed"
# A folder named as one of find's operators. The fixture is the working
# directory, so a script that read it as one would print paths and no more.
mkdir "$R/!" && printf 'x\n' >"$R/!/009-a.md"
call taken --repo acme/widgets --folder '!'
has "8: a folder named as a find operator is read as a folder" "$OUT" "taken=009${TAB}tree${TAB}!/009-a.md"
is "8: ...and it alone" "$(printf '%s\n' "$OUT" | grep -c "${TAB}tree${TAB}")" 1

# --- 9. usage, and the mirrors ------------------------------------------------
call claims --base main
is "9: no repository is a usage error" "$RC" 64
call claims --repo acme/widgets
is "9: no base is a usage error" "$RC" 64
call claims --repo acme/widgets --base main --local-base main
is "9: two bases is a usage error" "$RC" 64
call claims "${ARGS[@]}" --reserved 24
is "9: a reserved number that is no full number is a usage error" "$RC" 64
call claims "${ARGS[@]}" --member sibling
is "9: a member with no base is a usage error" "$RC" 64
call claims "${ARGS[@]}" --frobnicate
is "9: an unknown option is a usage error" "$RC" 64
call taken --repo acme/widgets --base main
is "9: taken takes no base" "$RC" 64
call frobnicate
is "9: an unknown command is a usage error" "$RC" 64
has "9: ...with the usage lines" "$ERR" "task-numbers.sh claims --repo"
call claims "${ARGS[@]}" --branch no-such-branch
is "9: a scanned branch that names no commit is a failure" "$RC" 1
OUT="$(cd "$WORKDIR" && bash "$HELPER" -C "$R" claims "${ARGS[@]}" 2>/dev/null)"
is "9: -C names the checkout" "$(val outcome)" clean
# `-` is the previous directory to cd, here the fixture: read so, the sweep
# would answer for it.
OUT="$(cd "$R" && cd "$WORKDIR" && bash "$HELPER" -C - duplicates 2>/dev/null)"
RC=$?
is "9: -C takes a directory, not cd's own - or an option" "$RC" 1
is "9: ...with no outcome" "$OUT" ""
call claims "${ARGS[@]}" --folder ""
is "9: an empty --folder is a usage error" "$RC" 64
call --help
is "9: --help exits 0" "$RC" 0
has "9: ...printing the contract" "$OUT" "outcome=incomplete"
OUT="$(cd "$R" && bash "$ROOT/plugins/dev-skills/bin/write-tasks-task-numbers" claims "${ARGS[@]}" 2>/dev/null)"
is "9: the plugin's shim runs the same script" "$(val outcome)" clean
cmp -s "$SHIPPED" "$MIRROR"
ok "9: the two mirrors ship the same script" $?

# --- 10. duplicates -----------------------------------------------------------
new_repo
# Nothing remote can be read: the sweep's answer must not depend on it.
touch "$FAKE/fail-list"
pr 11 1111111111111111111111111111111111111111 main
call duplicates
is "10: a tree with no number twice is clean" "$(val outcome)" clean
is "10: ...with exit 0, whatever the open heads" "$RC" 0
is "10: outcome is the first line" "$(printf '%s\n' "$OUT" | head -n 1)" "outcome=clean"
is "10: ...counting the files that carry a full number, at any depth" "$(val numbered)" 3
has "10: ...and naming a file that carries none" "$OUT" "unnumbered=tasks/AGENTS.md"
lacks "10: ...but nothing outside the folder" "$OUT" "src/004-not-a-task.md"
[ ! -f "$FAKE/gh.log" ]
ok "10: ...and without asking GitHub" $?
rm "$FAKE/fail-list"
printf 'x\n' >"$R/tasks/001a-suffixed.md"
mkdir -p "$R/tasks/done" && printf 'x\n' >"$R/tasks/done/AGENTS.md"
call duplicates
is "10: 001 beside 001a is no duplicate" "$(val outcome)" clean
is "10: ...and names neither" "$(count duplicate)" 0
is "10: ...nor two files that carry no number" "$(count unnumbered)" 2
printf 'x\n' >"$R/tasks/done/001-again.md"
call duplicates
is "10: one full number on two files is a duplicate" "$(val outcome)" duplicate
is "10: ...with exit 3" "$RC" 3
has "10: ...naming the tracked file" "$OUT" "duplicate=001${TAB}tasks/001-first.md"
has "10: ...and the untracked one in another folder" "$OUT" "duplicate=001${TAB}tasks/done/001-again.md"
is "10: ...and those two alone, not the suffixed neighbour" "$(count duplicate)" 2
is "10: ...among every numbered file" "$(val numbered)" 5
has "10: ...saying what a duplicate is not repaired by" "$ERR" "never renumbered"
printf 'x\n' >"$R/tasks/003a-other-slug.md"
printf 'x\n' >"$R/tasks/deferred/001-third.md"
call duplicates
is "10: every file of every duplicated number is named" "$(count duplicate)" 5
has "10: ...a suffixed number against itself" "$OUT" "duplicate=003a${TAB}tasks/deferred/003a-third.md"
has "10: ...and the third holder of one" "$OUT" "duplicate=001${TAB}tasks/deferred/001-third.md"
OUT="$(cd "$R/src" && bash "$HELPER" duplicates 2>/dev/null)"
is "10: from a subdirectory the folder is still read from the top" "$(count duplicate)" 5
call duplicates --folder plans
is "10: a folder that is not there is a failure, not a clean sweep" "$RC" 1
is "10: ...with no outcome" "$OUT" ""
mkdir -p "$R/plans/old" && printf 'x\n' >"$R/plans/007-a.md" && printf 'x\n' >"$R/plans/old/007-b.md"
call duplicates --folder plans
has "10: --folder names another one" "$OUT" "duplicate=007${TAB}plans/old/007-b.md"
is "10: ...where the conventional folder's duplicates are not read" "$(count duplicate)" 2
rm "$R/plans/old/007-b.md"
mkdir "$R/plans/closed" && chmod 000 "$R/plans/closed"
# Only where the mode binds (not as root): a folder find cannot enter.
if ! ls "$R/plans/closed" >/dev/null 2>&1; then
	call duplicates --folder plans
	is "10: a folder that cannot be read whole is a failure" "$RC" 1
	is "10: ...with no outcome" "$OUT" ""
fi
chmod 755 "$R/plans/closed"
call duplicates --repo acme/widgets
is "10: duplicates takes no repository" "$RC" 64
has "10: ...with the usage lines" "$ERR" "task-numbers.sh duplicates"
call duplicates --branch main
is "10: ...and no branch" "$RC" 64
call duplicates --reserved 001
is "10: ...and no reserved number" "$RC" 64
call duplicates --base main
is "10: ...and no base" "$RC" 64
call duplicates --local-base main
is "10: ...local or not" "$RC" 64
call duplicates --member feature:main
is "10: ...and no member" "$RC" 64
# A folder value that find would read as an expression. The fixture is the
# working directory and the expression a harmless one, so a script that let
# it through would print paths and nothing more.
call duplicates --folder -print
is "10: a --folder that starts with a dash is a usage error" "$RC" 64
is "10: ...with no outcome" "$OUT" ""
has "10: ...saying how a folder so named is written" "$ERR" "./-print"
[ -d "$R/.git" ] && [ -f "$R/tasks/001-first.md" ]
ok "10: ...and the checkout is as it was" $?
mkdir "$R/-print" && printf 'x\n' >"$R/-print/008-a.md"
call taken --repo acme/widgets --folder -print
is "10: ...for taken too, even where a folder bears that name" "$RC" 64
call claims --repo acme/widgets --base main --folder -print
is "10: ...and for claims" "$RC" 64
call duplicates --folder ./-print
is "10: ...while ./ names that folder" "$(val numbered)" 1
ln -s tasks "$R/tk"
call duplicates --folder tk
is "10: a task folder that is a symlink is read through" "$(val outcome)" duplicate
has "10: ...under the name it was given" "$OUT" "duplicate=001${TAB}tk/done/001-again.md"
# Folders named as find's operators: read as one, `!` would list every
# directory of the fixture as unnumbered and count nothing.
mkdir "$R/!" "$R/(" && printf 'x\n' >"$R/!/009-a.md" && printf 'x\n' >"$R/(/009-b.md"
call duplicates --folder '!'
is "10: a folder named as a find operator is read as a folder" "$(val numbered)" 1
is "10: ...and nothing else is listed" "$(count unnumbered)" 0
call duplicates --folder '('
is "10: ...an opening parenthesis too" "$(val numbered)" 1
call duplicates --folder ')'
is "10: ...and one that is not there is a missing folder" "$RC" 1
call duplicates --folder tasks/001-first.md
is "10: a --folder that names a file is a failure, not a clean sweep" "$RC" 1
is "10: ...with no outcome" "$OUT" ""
OUT="$(cd "$R" && bash "$ROOT/plugins/dev-skills/bin/write-tasks-task-numbers" duplicates 2>/dev/null)"
is "10: the plugin's shim runs it" "$(count duplicate)" 5
call --help
has "10: --help prints its contract" "$OUT" "outcome=duplicate"

# --- 11. numbers past 999 ------------------------------------------------------
new_repo
put "$R" tasks/1000-big.md
put "$R" tasks/1001a-suffixed.md
put "$R" tasks/12345-five.md
put "$R" tasks/12-two.md
call claims "${ARGS[@]}"
is "11: four-digit task files with free numbers are clean" "$(val outcome)" clean
is "11: ...each one a claim, and a two-digit name none" "$(val claims)" 3
has "11: ...named with its whole number" "$OUT" "claim=1000${TAB}tasks/1000-big.md"
has "11: ...suffix included" "$OUT" "claim=1001a${TAB}tasks/1001a-suffixed.md"
has "11: ...and at any width past three" "$OUT" "claim=12345${TAB}tasks/12345-five.md"
call claims "${ARGS[@]}" --reserved 1000
is "11: --reserved accepts a four-digit number, which collides" "$(val outcome)" collision
has "11: ...held as reserved" "$OUT" "collision=1000${TAB}tasks/1000-big.md${TAB}reserved${TAB}-${TAB}other-path"
call claims "${ARGS[@]}" --reserved 1001 --reserved 1000a --reserved 100
is "11: 1001 beside 1001a, 1000a and 100 beside 1000 are other numbers" "$(val outcome)" clean
call claims "${ARGS[@]}" --reserved 1000A
is "11: a reserved number with a capital suffix is still a usage error" "$RC" 64
other_pr 7 theirs main tasks/sub/1000-theirs.md
call claims "${ARGS[@]}"
is "11: a four-digit number an open head adds is a collision" "$(val outcome)" collision
has "11: ...naming the head" "$OUT" "collision=1000${TAB}tasks/1000-big.md${TAB}pr:7${TAB}tasks/sub/1000-theirs.md${TAB}other-path"
is "11: ...once" "$(count collision)" 1
git -C "$R" checkout -q -b wide-sibling main
put "$R" tasks/1001a-sibling.md
git -C "$R" checkout -q feature
mv "$FAKE/prs.json" "$FAKE/prs.kept" && printf '[]\n' >"$FAKE/prs.json"
call claims "${ARGS[@]}" --member wide-sibling:main
has "11: a member's four-digit suffixed number is compared whole" "$OUT" "collision=1001a${TAB}tasks/1001a-suffixed.md${TAB}member:wide-sibling${TAB}tasks/1001a-sibling.md${TAB}other-path"
is "11: ...and it alone" "$(count collision)" 1
mv "$FAKE/prs.kept" "$FAKE/prs.json"
call taken --repo acme/widgets
is "11: taken lists a four-digit tree" "$(val outcome)" listed
has "11: ...under its whole number" "$OUT" "taken=1000${TAB}tree${TAB}tasks/1000-big.md"
has "11: ...suffix included" "$OUT" "taken=1001a${TAB}tree${TAB}tasks/1001a-suffixed.md"
has "11: ...on an open head too" "$OUT" "taken=1000${TAB}pr:7${TAB}tasks/sub/1000-theirs.md"
has "11: ...while two digits stay another numbering style" "$OUT" "taken=-${TAB}tree${TAB}tasks/12-two.md"
call duplicates
is "11: four-digit numbers standing once each are no duplicate" "$(val outcome)" clean
is "11: ...and are counted as numbered" "$(val numbered)" 6
has "11: ...a two-digit name is not" "$OUT" "unnumbered=tasks/12-two.md"
printf 'x\n' >"$R/tasks/done/1000-again.md"
printf 'x\n' >"$R/tasks/100-short.md"
call duplicates
is "11: a four-digit number standing twice is a duplicate" "$(val outcome)" duplicate
has "11: ...naming one file" "$OUT" "duplicate=1000${TAB}tasks/1000-big.md"
has "11: ...and the other" "$OUT" "duplicate=1000${TAB}tasks/done/1000-again.md"
is "11: ...and no number that only starts the same" "$(count duplicate)" 2

# A four-digit number the base holds, and one the branch itself holds twice.
new_repo
git -C "$R" checkout -q main
put "$R" tasks/done/2000-landed.md
git -C "$R" push -q origin main
git -C "$R" checkout -q feature
put "$R" tasks/2000-mine.md
put "$R" tasks/2001-one.md
put "$R" tasks/sub/2001-two.md
call claims "${ARGS[@]}"
has "11: a four-digit number a file on the base holds is a collision" "$OUT" "collision=2000${TAB}tasks/2000-mine.md${TAB}base${TAB}tasks/done/2000-landed.md${TAB}other-path"
has "11: ...and so is one the branch itself holds twice" "$OUT" "collision=2001${TAB}tasks/2001-one.md${TAB}branch${TAB}tasks/sub/2001-two.md${TAB}other-path"
is "11: ...each named once per holder" "$(count collision)" 3

# Compared as written: a padded number and a bare one are two numbers.
new_repo
put "$R" tasks/0999-padded.md
put "$R" tasks/999-plain.md
call claims "${ARGS[@]}"
is "11: 0999 beside 999 is no collision" "$(val outcome)" clean
is "11: ...both claimed" "$(val claims)" 2
call claims "${ARGS[@]}" --reserved 999
is "11: a reserved 999 is held against the file written 999" "$(count collision)" 1
has "11: ...and not the one written 0999" "$OUT" "collision=999${TAB}tasks/999-plain.md${TAB}reserved"
call duplicates
is "11: ...and the sweep reads them as two numbers" "$(val outcome)" clean
call taken --repo acme/widgets
has "11: ...each listed as it is written" "$OUT" "taken=0999${TAB}tree${TAB}tasks/0999-padded.md"
has "11: ...the bare one too" "$OUT" "taken=999${TAB}tree${TAB}tasks/999-plain.md"

# --- 12. touching ---------------------------------------------------------------
# edit_pr <N> <branch> <base> <path> [text]: a PR from the other clone that
# rewrites (or adds) that one file on a branch off <base>.
edit_pr() {
	git -C "$U" fetch -q origin
	git -C "$U" checkout -q -B "$2" "origin/$3"
	put "$U" "$4" "${5:-edited by $2}"
	git -C "$U" push -q origin "$2:refs/pull/$1/head"
	pr "$1" "$(tip "$2" "$U")" "$3"
}
ASK=(touching --repo acme/widgets --task tasks/001-first.md --task tasks/done/002-second.md)

new_repo
edit_pr 5 edits main tasks/001-first.md
git -C "$U" push -q origin edits
other_pr 6 child edits tasks/095-child.md
call "${ASK[@]}"
is "12: an open PR that edits a named task file is reported" "$(val outcome)" touched
is "12: ...with exit 3" "$RC" 3
has "12: ...by number, what it does, and the path" "$OUT" "touching=pr:5${TAB}M${TAB}tasks/001-first.md"
lacks "12: a PR stacked on it inherits the edit and is not reported" "$OUT" "pr:6"
is "12: ...so one line stands" "$(count touching)" 1
is "12: ...beside how many paths were asked about" "$(val tasks)" 2
is "12: outcome is the first line" "$(printf '%s\n' "$OUT" | head -n 1)" "outcome=touched"
has "12: ...with what to do on stderr" "$ERR" "Read what it changes"
call touching --repo acme/widgets --task ./tasks/001-first.md
has "12: a path written behind ./ is the same path" "$OUT" "touching=pr:5${TAB}M${TAB}tasks/001-first.md"
OUT="$(cd "$R/src" && bash "$HELPER" "${ASK[@]}" 2>/dev/null)"
has "12: a run from a subdirectory reads the paths from the top" "$OUT" "touching=pr:5${TAB}M${TAB}tasks/001-first.md"
OUT="$(cd "$R" && bash "$ROOT/plugins/dev-skills/bin/write-tasks-task-numbers" "${ASK[@]}" 2>/dev/null)"
has "12: the plugin's shim runs it" "$OUT" "touching=pr:5${TAB}M${TAB}tasks/001-first.md"

new_repo
other_pr 5 theirs main tasks/096-theirs.md
call "${ASK[@]}"
is "12: a PR that changes other files leaves the answer clean" "$(val outcome)" clean
is "12: ...with exit 0" "$RC" 0
is "12: ...and no line" "$(count touching)" 0
call touching --repo acme/widgets --task 'tasks/*.md'
is "12: a path is a name, never a pattern" "$(val outcome)" clean

# The base rewrites the task after PR 5 forked: that is not PR 5's change.
new_repo
other_pr 5 theirs main tasks/097-theirs.md
git -C "$U" checkout -q main
put "$U" tasks/001-first.md "rewritten on the base"
git -C "$U" push -q origin main
call "${ASK[@]}"
is "12: what the base changed since a PR forked is not that PR's change" "$(val outcome)" clean

new_repo
git -C "$U" fetch -q origin
git -C "$U" checkout -q -B archive origin/main
git -C "$U" mv tasks/001-first.md tasks/done/001-first.md
git -C "$U" commit -q -m archive
git -C "$U" push -q origin archive:refs/pull/7/head
pr 7 "$(tip archive "$U")" main
edit_pr 8 adds main tasks/098-not-here-yet.md
call "${ASK[@]}" --task tasks/098-not-here-yet.md
has "12: a PR that moves a named task away deletes that path" "$OUT" "touching=pr:7${TAB}D${TAB}tasks/001-first.md"
has "12: ...and one that adds a named path adds it" "$OUT" "touching=pr:8${TAB}A${TAB}tasks/098-not-here-yet.md"
is "12: ...the lower PR first" "$(printf '%s\n' "$OUT" | grep '^touching=' | head -n 1)" "touching=pr:7${TAB}D${TAB}tasks/001-first.md"

new_repo
touch "$FAKE/fail-list"
call "${ASK[@]}"
is "12: an enumeration that fails is incomplete, never clean" "$(val outcome)" incomplete
is "12: ...with exit 3" "$RC" 3
has "12: ...saying what was skipped" "$OUT" "skipped=prs${TAB}"
has "12: ...and what to do on stderr" "$ERR" "do not call the scan complete"
rm "$FAKE/fail-list"
pr 11 1111111111111111111111111111111111111111 main
call "${ASK[@]}"
is "12: a head that cannot be fetched is incomplete" "$(val outcome)" incomplete
has "12: ...naming the PR" "$OUT" "skipped=pr:11${TAB}its head 1111111111111111111111111111111111111111 could not be fetched"
edit_pr 5 edits main tasks/001-first.md
call "${ASK[@]}"
is "12: a touching PR outranks a skipped head" "$(val outcome)" touched
has "12: ...which is still reported" "$OUT" "skipped=pr:11"

new_repo
edit_pr 12 edits main tasks/001-first.md
other_pr 13 theirs main tasks/099-theirs.md
jq '.[0].baseRefName = "gone"' "$FAKE/prs.json" >"$FAKE/prs.new" && mv "$FAKE/prs.new" "$FAKE/prs.json"
call "${ASK[@]}"
has "12: a PR whose base branch is gone is read against the base commit it names" "$OUT" "touching=pr:12${TAB}M${TAB}tasks/001-first.md"
jq '.[0].baseRefOid = "2222222222222222222222222222222222222222"' "$FAKE/prs.json" >"$FAKE/prs.new" && mv "$FAKE/prs.new" "$FAKE/prs.json"
call "${ASK[@]}"
is "12: ...and is skipped where that commit is not here either" "$(val outcome)" incomplete
has "12: ...by number" "$OUT" "skipped=pr:12${TAB}its base 'gone'"
is "12: ...with no touch invented" "$(count touching)" 0

new_repo
jq -n --arg h "$(tip main)" --arg b main '[range(1; 201) | {number: ., headRefOid: $h, baseRefName: $b, baseRefOid: $h, headRefName: "pr-\(.)", isCrossRepository: false}]' >"$FAKE/prs.json"
call "${ASK[@]}"
is "12: an enumeration at its bound is incomplete" "$(val outcome)" incomplete
has "12: ...saying the bound" "$OUT" "limit=200"

new_repo
call touching --repo acme/widgets
is "12: no task named is a usage error" "$RC" 64
has "12: ...with the usage lines" "$ERR" "task-numbers.sh touching --repo"
call touching --task tasks/001-first.md
is "12: no repository is a usage error" "$RC" 64
call "${ASK[@]}" --base main
is "12: touching takes no base" "$RC" 64
call touching --repo acme/widgets --task "$R/tasks/001-first.md"
is "12: an absolute path is a usage error" "$RC" 64
call taken --repo acme/widgets --task tasks/001-first.md
is "12: taken takes no task" "$RC" 64
call duplicates --task tasks/001-first.md
is "12: ...nor does duplicates" "$RC" 64

# --- 13. task-citations.sh ------------------------------------------------------
# A repository with a little code, and a task that cites it.
cite_repo() {
	new_repo
	git -C "$R" checkout -q main
	put "$R" src/lib/widget.sh 'render_widget() { :; }'
	put "$R" src/core.js 'function renderWidget() { return MAX_RETRIES; } // retryCount'
	put "$R" tasks/done/008-old.md 'mentions onlyInTasks and nothing else'
}
# task <path> <line>...: write a task file (uncommitted) from those lines.
task() {
	local f="$R/$1"
	shift
	mkdir -p "$(dirname "$f")"
	printf '%s\n' "$@" >"$f"
}
T=tasks/100-new.md

cite_repo
task "$T" 'Edit `src/lib/widget.sh`, not `src/lib/gone.sh`.' 'Call `renderWidget()`, not `missingHelper()`.'
cite "$T"
is "13: a path and an identifier that are not in the tree are unresolved" "$(val outcome)" unresolved
is "13: ...with exit 3" "$RC" 3
has "13: ...the path named with its task file" "$OUT" "unresolved=path${TAB}$T${TAB}src/lib/gone.sh"
has "13: ...and the identifier as it was written" "$OUT" "unresolved=identifier${TAB}$T${TAB}missingHelper()"
is "13: ...those two alone, not the two that exist" "$(count unresolved)" 2
is "13: ...of four looked up" "$(val checked)" 4
is "13: ...against the commit named" "$(val ref)" "$(tip HEAD)"
is "13: outcome is the first line" "$(printf '%s\n' "$OUT" | head -n 1)" "outcome=unresolved"
has "13: ...and stderr says it is a list, not a verdict" "$ERR" "not a verdict"

cite_repo
task "$T" 'See `widget.sh`, `lib/widget.sh`, `./src/core.js`, `src/lib/`, `src/` and `done/`.' \
	'Uses `MAX_RETRIES`, `render_widget`, `Core.prototype.renderWidget`, `core::retryCount` and `renderWidget`.'
cite "$T"
is "13: a basename, a path's tail, a directory and a qualified name all resolve" "$(val outcome)" clean
is "13: ...with exit 0" "$RC" 0
is "13: ...each one looked up" "$(val checked)" 11

cite_repo
task "$T" 'Run `git diff --stat`, pass `--force` or `-n`, set `key=value`, name `<owner>/<repo>`.' \
	'Globs `*.md` and `src/*.sh`; words `main`, `HEAD`, `claims`, `write-tasks`; numbers `3.2`, `024`, `0/3/1/64`.' \
	'An extension `.md`; `/abs/gone.sh`; `../up/gone.sh`; `origin/main`; `refs/pull/5/head`; `$HOME/gone.sh`; `"gone.sh"`.' \
	'```sh' 'cat `src/fenced-gone.sh`' '```' '    ~~~' '`src/also-fenced-gone.sh`' '    ~~~' \
	'An unclosed `src/unclosed-gone.sh span.'
cite "$T"
is "13: command lines, flags, placeholders, globs, words, numbers and refs are no citations" "$(val outcome)" clean
is "13: ...and none was looked up" "$(val checked)" 0

cite_repo
task "$T" 'Create `src/lib/new-helper.sh` and `brand_new_function()`.' 'Not a directory of the tree: `nolib/thing`; but `src/nothing` starts in one.' \
	'Only tasks say `onlyInTasks`.' 'Twice: `src/lib/gone.sh` and `src/lib/gone.sh`.' 'A method on a file: `core.js`, `process.env`.'
cite "$T"
has "13: a file the task asks for is listed" "$OUT" "unresolved=path${TAB}$T${TAB}src/lib/new-helper.sh"
has "13: ...and a function it asks for" "$OUT" "unresolved=identifier${TAB}$T${TAB}brand_new_function()"
has "13: a path with no extension is checked where its first step is a directory" "$OUT" "unresolved=path${TAB}$T${TAB}src/nothing"
lacks "13: ...and not where it is none" "$OUT" "nolib/thing"
has "13: an identifier that stands only in the task folder is unresolved" "$OUT" "unresolved=identifier${TAB}$T${TAB}onlyInTasks"
is "13: a span cited twice is listed once" "$(printf '%s\n' "$OUT" | grep -c "src/lib/gone.sh")" 1
has "13: a dotted name with a short lowercase tail reads as a file" "$OUT" "unresolved=path${TAB}$T${TAB}process.env"
is "13: ...and that is the whole list" "$(count unresolved)" 6

# The ref's tree is what is read, not the working tree.
cite_repo
task "$T" 'Edit `src/lib/later.sh` with `laterName`.'
printf 'laterName\n' >"$R/src/lib/later.sh"
cite "$T"
is "13: a file that is only in the working tree is not in HEAD" "$(count unresolved)" 2
git -C "$R" checkout -q -b later
git -C "$R" add src/lib/later.sh && git -C "$R" commit -q -m later
git -C "$R" checkout -q main
cite --ref later "$T"
is "13: --ref names the commit whose tree is read" "$(val outcome)" clean
is "13: ...and it is printed" "$(val ref)" "$(tip later)"
cite --ref main "$T"
is "13: ...while main still lacks both" "$(count unresolved)" 2

cite_repo
task "$T" 'Edit `src/lib/gone.sh`.'
task tasks/101-other.md 'Edit `src/lib/gone.sh` and `src/core.js`.'
cite "$T" tasks/101-other.md
is "13: each task file is listed for what it cites" "$(count unresolved)" 2
has "13: ...the second under its own name" "$OUT" "unresolved=path${TAB}tasks/101-other.md${TAB}src/lib/gone.sh"
is "13: ...and counted once per file" "$(val checked)" 3
OUT="$(cd "$R/tasks" && bash "$CITES" 100-new.md 2>/dev/null)"
has "13: a task file is read at the path given, from a subdirectory too" "$OUT" "unresolved=path${TAB}100-new.md${TAB}src/lib/gone.sh"
OUT="$(cd "$WORKDIR" && bash "$CITES" -C "$R" "$T" 2>/dev/null)"
is "13: -C names the checkout" "$(val outcome)" unresolved
OUT="$(cd "$R" && bash "$ROOT/plugins/dev-skills/bin/write-tasks-task-citations" "$T" 2>/dev/null)"
is "13: the plugin's shim runs the same script" "$(val outcome)" unresolved
# Another task folder: what stands only there is not an occurrence.
put "$R" plans/009-plan.md 'mentions planOnly_name'
task "$T" 'Uses `planOnly_name`.'
cite "$T"
is "13: outside the task folder an occurrence counts" "$(val outcome)" clean
cite --folder plans "$T"
is "13: --folder names the folder that does not count" "$(val outcome)" unresolved

cite --ref no-such-ref "$T"
is "13: a ref that names no commit is a failure" "$RC" 1
is "13: ...with no outcome" "$OUT" ""
cite tasks/no-such-task.md
is "13: a task file that is not there is a failure" "$RC" 1
is "13: ...with no outcome" "$OUT" ""
cite
is "13: no task file is a usage error" "$RC" 64
has "13: ...with the usage lines" "$ERR" "task-citations.sh [--ref <commit>]"
cite --frobnicate "$T"
is "13: an unknown option is a usage error" "$RC" 64
cite --ref
is "13: an option with no value is a usage error" "$RC" 64
cite --help
is "13: --help exits 0" "$RC" 0
has "13: ...printing the contract" "$OUT" "outcome=unresolved"
cmp -s "$CITES_SHIPPED" "$ROOT/codex/dev-skills/skills/write-tasks/task-citations.sh"
ok "13: the two mirrors ship the same script" $?

if [ "$fails" -gt 0 ]; then
	printf 'write-tasks task-numbers helper test FAILED (%s of %s checks).\n' "$fails" "$checks" >&2
	exit 1
fi
printf 'write-tasks task-numbers helper test passed (%s checks).\n' "$checks"
