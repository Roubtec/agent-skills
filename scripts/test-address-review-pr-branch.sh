#!/usr/bin/env bash
# Hermetic test for the address-review branch helper
# (plugins/dev-skills/skills/address-review/pr-branch.sh).
#
# Every case builds a throwaway bare "origin" and a clone of it under one temp
# directory, so nothing here touches a real repository or the network. The
# clone's remote is configured with a GitHub-shaped URL that a repository-local
# `insteadOf` rewrites to the bare origin, which is how the helper's
# match-the-remote-by-URL step is exercised for real. `gh` is a fake that
# answers `pr view` from a JSON file each case writes, run through the real
# `jq` with the helper's own `--jq` expression.
# shellcheck disable=SC2319 # `ok <label> $?` after a `[ … ]` test is the point
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="${PR_BRANCH:-$SCRIPT_DIR/../plugins/dev-skills/skills/address-review/pr-branch.sh}"
MIRROR="$SCRIPT_DIR/../codex/dev-skills/skills/address-review/pr-branch.sh"
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
is() { # <label> <actual> <expected>
	if [ "$2" = "$3" ]; then ok "$1" 0; else
		ok "$1" 1
		printf '      wanted: %s\n      got:    %s\n' "$3" "$2" >&2
	fi
}
commit() { # <repo> <file> <content> → a commit that changes a file
	printf '%s\n' "$3" >"$1/$2"
	git -C "$1" add "$2"
	git -C "$1" commit -q -m "$2: $3"
}
tip() { git -C "${2:-$R}" rev-parse "$1"; }
remote_tip() { git -C "$O" rev-parse --verify --quiet "refs/heads/$1"; }

FAKE="$WORKDIR/bin"
mkdir -p "$FAKE"
# shellcheck disable=SC2016 # the fake's own $1/$* must reach it unexpanded
{
	printf '#!/usr/bin/env bash\n'
	printf 'echo "$*" >>"%s/gh.log"\n' "$FAKE"
	printf '[ "$1 $2" = "pr view" ] || exit 1\n'
	printf '[ -f "%s/pr.json" ] || exit 1\n' "$FAKE"
	printf 'expr=.; while [ $# -gt 0 ]; do [ "$1" = --jq ] && expr="$2"; shift; done\n'
	printf 'jq -r "$expr" "%s/pr.json"\n' "$FAKE"
} >"$FAKE/gh"
chmod +x "$FAKE/gh"
export PATH="$FAKE:$PATH"
# pr <state> <headRefName> <headRefOid> [<isCrossRepository> [<baseRefName>]]
pr() {
	printf '{"state":"%s","headRefName":"%s","headRefOid":"%s","baseRefName":"%s","isCrossRepository":%s}\n' \
		"$1" "$2" "$3" "${5-main}" "${4:-false}" >"$FAKE/pr.json"
}

# new_repo → O (bare origin), R (clone on `feature`, two commits past main,
# pushed), U (a second clone, to move origin from elsewhere).
new_repo() {
	local d
	d="$(mktemp -d "$WORKDIR/case.XXXXXX")"
	O="$d/origin.git"
	R="$d/repo"
	U="$d/other"
	git init -q --bare -b main "$O"
	git init -q -b main "$R"
	commit "$R" base one
	git -C "$R" remote add origin "https://github.com/Acme/Widgets.git"
	git -C "$R" config "url.$O.insteadOf" "https://github.com/Acme/Widgets.git"
	git -C "$R" push -q -u origin main
	git -C "$R" checkout -q -b feature
	commit "$R" f1 one
	commit "$R" f2 one
	git -C "$R" push -q -u origin feature
	git clone -q "$O" "$U"
	git -C "$U" checkout -q feature
	: >"$FAKE/gh.log"
}
run() { # <command> [args...] → OUT (stdout), ERR (stderr), RC
	OUT="$(cd "$R" && bash "$HELPER" "$@" 2>"$WORKDIR/err")"
	RC=$?
	ERR="$(cat "$WORKDIR/err")"
}
val() { printf '%s\n' "$OUT" | sed -n "s/^$1=//p" | head -n 1; }
ARGS=(--repo acme/widgets --pr 7)

# --- 1. check ---------------------------------------------------------------
new_repo
run check
is "1: a clean tree passes" "$RC" 0
has "1: ...and reports the tip" "$OUT" "tip=$(tip HEAD)"
echo x >"$R/stray"
run check
is "1: an untracked file is a stop" "$RC" 3
has "1: ...named as such" "$OUT" "reason=uncommitted changes"
has "1: ...with the explanation on stderr" "$ERR" "Nothing was changed"
rm "$R/stray"
# An empty cherry-pick stops with CHERRY_PICK_HEAD set and a clean porcelain.
git -C "$R" cherry-pick "$(tip HEAD)" >/dev/null 2>&1
is "1: (setup) the stopped cherry-pick leaves the porcelain empty" "$(git -C "$R" status --porcelain)" ""
run check
is "1: a cherry-pick left in progress is a stop though the tree reads clean" "$RC" 3
has "1: ...naming the operation" "$OUT" "CHERRY_PICK_HEAD"
git -C "$R" cherry-pick --abort
git -C "$R" bisect start >/dev/null 2>&1
run check
has "1: a bisect in progress is a stop too" "$OUT" "BISECT_LOG"
git -C "$R" bisect reset >/dev/null 2>&1

# --- 2. reconcile: equal, behind, ahead, rebased ----------------------------
new_repo
HEAD0="$(tip HEAD)"
pr OPEN feature "$HEAD0"
run reconcile "${ARGS[@]}"
is "2: equal exits 0" "$RC" 0
is "2: equal is reported" "$(val outcome)" equal
is "2: the remote is found by its configured URL, case-insensitively" "$(val remote)" origin
is "2: the PR's base ref is passed on" "$(val base-ref)" main
grep -q -- "pr view 7 --repo acme/widgets" "$FAKE/gh.log"
ok "2: the PR read names the number and the repository" $?

commit "$U" f3 one
git -C "$U" push -q origin feature
NEW="$(tip HEAD "$U")"
pr OPEN feature "$NEW"
run reconcile "${ARGS[@]}"
is "2: strictly behind is fast-forwarded" "$(val outcome)" fast-forwarded
is "2: ...to the PR head" "$(tip HEAD)" "$NEW"
is "2: ...and the pre-reconcile tip is reported as the start" "$(val was)" "$HEAD0"

# GitHub still reports the old head while the ref has advanced: adopt the fetch.
commit "$U" f4 one
git -C "$U" push -q origin feature
NEWER="$(tip HEAD "$U")"
pr OPEN feature "$NEW"
run reconcile "${ARGS[@]}"
is "2: a fetched head ahead of the reported one is adopted" "$(val head)" "$NEWER"

commit "$R" f5 one
run reconcile "${ARGS[@]}"
is "2: local commits on top of the head are 'ahead'" "$(val outcome)" ahead
is "2: ...and the branch is not moved" "$(tip HEAD)" "$(val tip)"

# Rebase the branch onto a moved main: no shared SHAs, same patches.
git -C "$R" checkout -q main
commit "$R" base two
git -C "$R" checkout -q feature
git -C "$R" rebase -q main
pr OPEN feature "$NEWER"
run reconcile "${ARGS[@]}"
is "2: a rebased branch carrying the head by patch-id is 'represented'" "$(val outcome)" represented
is "2: ...exit 0" "$RC" 0

# --- 3. reconcile: the stops ------------------------------------------------
new_repo
commit "$U" g1 remote
git -C "$U" push -q origin feature
commit "$R" g2 local
BEFORE="$(tip HEAD)"
pr OPEN feature "$(tip HEAD "$U")"
run reconcile "${ARGS[@]}"
is "3: divergence exits 3" "$RC" 3
is "3: ...as 'divergent'" "$(val outcome)" divergent
has "3: ...naming the remote-only commit" "$OUT" "remote-only=$(tip HEAD "$U") g1: remote"
has "3: ...and the local-only one" "$OUT" "local-only=$BEFORE g2: local"
is "3: ...and moving nothing" "$(tip HEAD)" "$BEFORE"

# A merge on the remote that resolved a conflict by hand carries content. The
# local branch carries both sides' patches but not that resolution.
new_repo
git -C "$U" checkout -q -b side main
commit "$U" f1 conflicting
git -C "$U" checkout -q feature
git -C "$U" merge -q side >/dev/null 2>&1
printf 'resolved by hand\n' >"$U/f1"
git -C "$U" add f1
git -C "$U" commit -q -m "merge side"
git -C "$U" push -q origin feature
git -C "$R" checkout -q main
commit "$R" base two
git -C "$R" checkout -q feature
git -C "$R" rebase -q main
pr OPEN feature "$(tip HEAD "$U")"
run reconcile "${ARGS[@]}"
is "3: a remote merge carrying its own resolution is not 'represented'" "$(val outcome)" divergent
has "3: ...and the merge is the commit named" "$OUT" "remote-only=$(tip HEAD "$U") merge side"

# A merge that only joined its parents is ignored.
new_repo
git -C "$U" checkout -q -b side main
commit "$U" s1 side
git -C "$U" checkout -q feature
git -C "$U" merge -q --no-ff -m "join side" side
git -C "$U" push -q origin feature
git -C "$R" fetch -q origin
git -C "$R" cherry-pick "$(tip side "$U")" >/dev/null 2>&1
git -C "$R" commit -q --amend -m "s1 picked, under another id"
pr OPEN feature "$(tip HEAD "$U")"
run reconcile "${ARGS[@]}"
is "3: a remote merge that merely joined its parents is ignored" "$(val outcome)" represented

new_repo
HEAD0="$(tip HEAD)"
git -C "$U" push -q --force origin "feature~1:refs/heads/feature"
pr OPEN feature "$HEAD0"
run reconcile "${ARGS[@]}"
is "3: a head ref behind what GitHub reports is a 'rewind' stop" "$(val outcome)" rewind
is "3: ...exit 3" "$RC" 3
is "3: ...adopting nothing" "$(tip HEAD)" "$HEAD0"

new_repo
pr OPEN feature "$(tip HEAD)" true
run reconcile "${ARGS[@]}"
is "3: a fork PR is refused" "$(val outcome)" fork
pr OPEN feature "$(tip HEAD)" true ""
run reconcile "${ARGS[@]}"
is "3: ...and an empty field ahead of it does not shift the answer past the refusal" "$(val outcome)" fork
pr MERGED feature "$(tip HEAD)"
run reconcile "${ARGS[@]}"
is "3: a PR that is not open is refused" "$(val outcome)" closed
pr OPEN elsewhere "$(tip HEAD)"
run reconcile "${ARGS[@]}"
is "3: a tree on another branch than the head ref is refused" "$(val outcome)" wrong-branch
pr OPEN feature "$(tip HEAD)"
run reconcile --repo other/thing --pr 7
is "3: no remote for the PR's repository is a stop" "$(val outcome)" no-remote
echo x >"$R/stray"
run reconcile "${ARGS[@]}"
is "3: a dirty tree is a stop before anything is read" "$(val outcome)" dirty
rm "$R/stray"
rm "$FAKE/pr.json"
run reconcile "${ARGS[@]}"
is "3: a failed PR read exits 1" "$RC" 1

# --- 3b. finding the remote --------------------------------------------------
new_repo
pr OPEN feature "$(tip HEAD)"
git -C "$R" config "url.$O.insteadOf" "git@github.com:Acme/Widgets.git"
git -C "$R" remote set-url origin "git@github.com:Acme/Widgets.git"
run reconcile "${ARGS[@]}"
is "3b: an ssh-form URL names the repository" "$(val remote)" origin
git -C "$R" config "url.$O.insteadOf" "https://github.com/acme/widgets/"
git -C "$R" remote set-url origin "https://github.com/acme/widgets/"
run reconcile "${ARGS[@]}"
is "3b: so does one with a trailing slash and no .git" "$(val remote)" origin
git -C "$R" remote add upstream "https://github.com/acme/widgets/"
git -C "$R" remote add aaa "https://github.com/acme/widgets/"
run reconcile "${ARGS[@]}"
is "3b: among several matching remotes the branch's own is preferred" "$(val remote)" origin
git -C "$R" config branch.feature.pushRemote upstream
run reconcile "${ARGS[@]}"
is "3b: ...and its pushRemote ahead of that" "$(val remote)" upstream
git -C "$R" remote remove upstream
git -C "$R" remote remove aaa
git -C "$R" remote set-url --push origin "https://github.com/someone/fork.git"
run reconcile "${ARGS[@]}"
is "3b: a remote that fetches from the repository but pushes elsewhere is not it" "$(val outcome)" no-remote
git -C "$R" remote set-url origin "https://github.com/someone/fork.git"
git -C "$R" remote set-url --push origin "https://github.com/acme/widgets/"
run reconcile "${ARGS[@]}"
is "3b: nor is one that only pushes to it" "$(val outcome)" no-remote

# --- 4. pin-base ------------------------------------------------------------
new_repo
LOCAL_MAIN="$(tip main)"
git -C "$U" checkout -q main
commit "$U" base moved
git -C "$U" push -q origin main
run pin-base --repo acme/widgets --base main
is "4: the base is fetched fresh, not read from a stale tracking ref" "$(val base)" "$(tip main "$U")"
is "4: ...without moving the local base branch" "$(tip main)" "$LOCAL_MAIN"
run pin-base --target feature~1
is "4: a named target resolves in this checkout" "$(val base)" "$(tip feature~1)"
run pin-base --target no/such-ref
is "4: a target that does not resolve is a stop" "$RC" 3
is "4: ...with nothing substituted" "$(val base)" ""

# --- 5. push ----------------------------------------------------------------
new_repo
HEAD0="$(tip HEAD)"
pr OPEN feature "$HEAD0"
run push "${ARGS[@]}" --expect "$HEAD0"
is "5: nothing to push is 'up-to-date'" "$(val outcome)" up-to-date
is "5: ...and did not advance" "$(val advanced)" no
# GitHub reports another head than the one this run worked against, though the
# ref itself has not moved yet: the PR's own answer is enough to stop.
pr OPEN feature "$(tip main)"
run push "${ARGS[@]}" --expect "$HEAD0"
is "5: a PR reporting another head than the expected one is a stop" "$(val outcome)" head-moved
pr OPEN feature "$HEAD0"

commit "$R" f3 one
run push "${ARGS[@]}" --expect "$HEAD0"
is "5: commits on top are a plain push" "$(val mode)" fast-forward
is "5: ...reported as pushed" "$(val outcome)" pushed
is "5: ...and they are on origin" "$(remote_tip feature)" "$(tip HEAD)"

HEAD1="$(tip HEAD)"
pr OPEN feature "$HEAD1"
git -C "$R" commit -q --amend -m "f3 reworded"
run push "${ARGS[@]}" --expect "$HEAD1"
is "5: rewritten history is a rewrite, by exact lease" "$(val mode)" rewrite
is "5: ...and lands" "$(remote_tip feature)" "$(tip HEAD)"

# Origin moves after the PR was read: GitHub and the ref disagree.
HEAD2="$(tip HEAD)"
git -C "$U" fetch -q origin
git -C "$U" reset -q --hard origin/feature
commit "$U" f6 theirs
git -C "$U" push -q origin feature
THEIRS="$(tip HEAD "$U")"
pr OPEN feature "$HEAD2"
git -C "$R" commit -q --amend -m "f3 reworded again"
run push "${ARGS[@]}" --expect "$HEAD2"
is "5: a head ref that moved under the run is a stop" "$(val outcome)" head-moved
is "5: ...and origin keeps the other writer's commit" "$(remote_tip feature)" "$THEIRS"
pr OPEN feature "$THEIRS"
run push "${ARGS[@]}" --expect "$HEAD2"
is "5: a PR head that is no longer the expected one is a stop" "$(val outcome)" head-moved

# Origin moves in the instant between the helper's fetch and its push: only
# the lease stands in the way, on a fast-forward as much as on a rewrite.
for shape in fast-forward rewrite; do
	new_repo
	HEAD0="$(tip HEAD)"
	pr OPEN feature "$HEAD0"
	commit "$U" f7 theirs
	THEIRS="$(tip HEAD "$U")"
	printf '#!/bin/sh\nunset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE\ngit -C "%s" push -q origin feature\n' "$U" >"$R/.git/hooks/pre-push"
	chmod +x "$R/.git/hooks/pre-push"
	if [ "$shape" = rewrite ]; then git -C "$R" commit -q --amend -m "f2 reworded"; else commit "$R" f8 mine; fi
	run push "${ARGS[@]}" --expect "$HEAD0"
	is "5: a $shape push that loses the race is 'rejected'" "$(val outcome)" rejected
	is "5: ...and origin keeps the other writer's commit ($shape)" "$(remote_tip feature)" "$THEIRS"
done

# Two push URLs, and the second refuses: the first has already taken the push.
new_repo
HEAD0="$(tip HEAD)"
pr OPEN feature "$HEAD0"
git init -q --bare -b main "$(dirname "$O")/second.git"
git -C "$R" remote set-url --add --push origin "https://github.com/Acme/Widgets.git"
git -C "$R" remote set-url --add --push origin "$(dirname "$O")/second.git"
commit "$R" f3 one
run push "${ARGS[@]}" --expect "$HEAD0"
is "5: a push one URL took and another refused is 'unconfirmed', not 'rejected'" "$(val outcome)" unconfirmed
is "5: ...saying the command was refused" "$(val push-command)" refused
is "5: ...while the PR's repository does carry the tip" "$(remote_tip feature)" "$(tip HEAD)"

echo x >"$R/stray"
run push "${ARGS[@]}" --expect "$HEAD0"
is "5: a dirty tree is never pushed from" "$(val outcome)" dirty
rm "$R/stray"

# Strictly behind: the lease would match and rewind the PR.
new_repo
commit "$U" f3 theirs
git -C "$U" push -q origin feature
THEIRS="$(tip HEAD "$U")"
git -C "$R" fetch -q origin
pr OPEN feature "$THEIRS"
run push "${ARGS[@]}" --expect "$THEIRS"
is "5: a tip behind the PR head is a stop" "$(val outcome)" behind
is "5: ...and origin is not rewound" "$(remote_tip feature)" "$THEIRS"

# The push returns but one push URL does not show the tip.
new_repo
HEAD0="$(tip HEAD)"
pr OPEN feature "$HEAD0"
git init -q --bare -b main "$(dirname "$O")/mirror.git"
git -C "$R" remote set-url --add --push origin "https://github.com/Acme/Widgets.git"
git -C "$R" remote set-url --add --push origin "$(dirname "$O")/mirror.git"
run push "${ARGS[@]}" --expect "$HEAD0"
is "5: every push URL is read back, and one without the ref is 'unconfirmed'" "$(val outcome)" unconfirmed
has "5: ...naming the URL that did not answer" "$OUT" "readback=$(dirname "$O")/mirror.git no answer"
is "5: ...exit 3" "$RC" 3

new_repo
pr OPEN feature "$(tip HEAD)"
run push "${ARGS[@]}" --expect abc123
is "5: a short expected id is a usage error" "$RC" 64
pr OPEN feature "$(tip HEAD)" true
run push "${ARGS[@]}" --expect "$(tip HEAD)"
is "5: a fork PR is never pushed to" "$(val outcome)" fork
! grep "pr view" "$FAKE/gh.log" | grep -qv -- "pr view 7 --repo acme/widgets"
ok "5: every PR read names the number and the repository" $?

# --- 6. the shipped files ---------------------------------------------------
cmp -s "$SCRIPT_DIR/../plugins/dev-skills/skills/address-review/pr-branch.sh" "$MIRROR"
ok "the Codex mirror ships the same helper, byte for byte" $?
for f in plugins/dev-skills/skills/address-review/pr-branch.sh codex/dev-skills/skills/address-review/pr-branch.sh; do
	mode="$(git -c safe.directory='*' -C "$SCRIPT_DIR/.." ls-files -s -- "$f" | cut -d' ' -f1)"
	is "$f is committed executable" "$mode" 100755
done
OUT="$("$SCRIPT_DIR/../plugins/dev-skills/skills/address-review/pr-branch.sh" --help 2>&1)"
has "the helper runs by path and prints its contract" "$OUT" "pr-branch.sh reconcile"

if [ "$fails" -gt 0 ]; then
	printf 'address-review pr-branch helper test: %d/%d checks FAILED.\n' "$fails" "$checks" >&2
	exit 1
fi
printf 'address-review pr-branch helper test passed (%d checks).\n' "$checks"
