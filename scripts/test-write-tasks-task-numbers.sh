#!/usr/bin/env bash
# Hermetic test for the write-tasks skill's bundled `task-numbers.sh`.
#
# Each case builds a throwaway bare "origin" and a clone whose remote carries a
# GitHub-shaped URL that a repository-local `insteadOf` rewrites to the bare
# origin, so the remote is matched by URL for real (through the address-review
# skill's `pr-branch.sh`, which the helper calls). Pull request heads are
# pushed to `refs/pull/<N>/head` there. `gh` is a fake that answers `pr list`
# from a JSON file through the real `jq` and the helper's own `--jq`.
# `TASK_NUMBERS_HELPER` points the suite at another copy (a mutant, say); it
# must sit where `../address-review/pr-branch.sh` resolves.
# shellcheck disable=SC2319 # `ok <label> $?` after a `[ … ]` test is the point
set -u

ROOT="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SHIPPED="$ROOT/plugins/dev-skills/skills/write-tasks/task-numbers.sh"
MIRROR="$ROOT/codex/dev-skills/skills/write-tasks/task-numbers.sh"
HELPER="${TASK_NUMBERS_HELPER:-$SHIPPED}"
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
# pr <N> <head oid> <base name> [base oid]: add an open PR to the enumeration.
pr() {
	jq --argjson n "$1" --arg h "$2" --arg b "$3" --arg bo "${4:-$(git -C "$O" rev-parse "refs/heads/$3" 2>/dev/null || echo 0000000000000000000000000000000000000000)}" \
		'. + [{number: $n, headRefOid: $h, baseRefName: $b, baseRefOid: $bo}]' "$FAKE/prs.json" >"$FAKE/prs.new" && mv "$FAKE/prs.new" "$FAKE/prs.json"
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
put "$R" tasks/notes/1234-four-digits.md
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
call claims --repo acme/widgets --local-base main
is "3: a local base is read as it stands" "$(val base)" "$(tip main)"
is "3: ...which misses what landed, and says the scan is incomplete" "$(val outcome)" incomplete
is "3: ...with exit 3" "$RC" 3
has "3: ...as degraded" "$OUT" "degraded=the base was read from the local commit"
is "3: ...and no collision" "$(count collision)" 0
call claims --repo acme/widgets --local-base no-such-commit
is "3: a local base that names no commit is a failure" "$RC" 1
call claims --repo other/elsewhere --base main
is "3: a repository no remote fetches from is a failure" "$RC" 1

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
jq '.[0].baseRefOid = "2222222222222222222222222222222222222222"' "$FAKE/prs.json" >"$FAKE/prs.new" && mv "$FAKE/prs.new" "$FAKE/prs.json"
call claims "${ARGS[@]}"
is "5: ...and is skipped where that commit is not here either" "$(val outcome)" incomplete
has "5: ...by number" "$OUT" "skipped=pr:12${TAB}its base 'gone'"
is "5: ...with no collision invented" "$(count collision)" 0

new_repo
put "$R" tasks/070-mine.md
jq -n --arg h "$(tip main)" --arg b main '[range(1; 201) | {number: ., headRefOid: $h, baseRefName: $b, baseRefOid: $h}]' >"$FAKE/prs.json"
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
lacks "8: ...but nothing that is no task file" "$OUT" "AGENTS.md"
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
call --help
is "9: --help exits 0" "$RC" 0
has "9: ...printing the contract" "$OUT" "outcome=incomplete"
cmp -s "$SHIPPED" "$MIRROR"
ok "9: the two mirrors ship the same script" $?

if [ "$fails" -gt 0 ]; then
	printf 'write-tasks task-numbers helper test FAILED (%s of %s checks).\n' "$fails" "$checks" >&2
	exit 1
fi
printf 'write-tasks task-numbers helper test passed (%s checks).\n' "$checks"
