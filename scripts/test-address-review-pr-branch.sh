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
# `jq` with the helper's own `--jq` expression. With a `hint` file beside it,
# the fake ends a PR read as gh 2.105 does for a coding agent: with its
# `gh event listen` block on stderr.
# shellcheck disable=SC2319 # `ok <label> $?` after a `[ … ]` test is the point
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="${PR_BRANCH:-$SCRIPT_DIR/../plugins/dev-skills/skills/address-review/pr-branch.sh}"
MIRROR="$SCRIPT_DIR/../codex/dev-skills/skills/address-review/pr-branch.sh"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
unset GH_HOST
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
	printf 'if [ -f "%s/gh-error" ]; then cat "%s/gh-error" >&2; exit 1; fi\n' "$FAKE" "$FAKE"
	printf '[ -f "%s/pr.json" ] || exit 1\n' "$FAKE"
	printf 'expr=.; while [ $# -gt 0 ]; do [ "$1" = --jq ] && expr="$2"; shift; done\n'
	printf 'jq -r "$expr" "%s/pr.json"\n' "$FAKE"
	printf '[ ! -f "%s/hint" ] || cat "%s/hint" >&2\n' "$FAKE" "$FAKE"
} >"$FAKE/gh"
chmod +x "$FAKE/gh"
export PATH="$FAKE:$PATH"
# A `git` that cannot reach any remote for a read-back, put ahead on PATH by
# the cases that need one: an `ls-remote` of a URL fails — the read-back's, as
# against the helper's own read of the remote by name — and everything else is
# the real git.
REAL_GIT="$(command -v git)"
DEAF="$WORKDIR/deaf"
mkdir -p "$DEAF"
# shellcheck disable=SC2016 # the shim's own $@ must reach it unexpanded
{
	printf '#!/usr/bin/env bash\n'
	printf 'ls=0 named=0\n'
	printf 'for a in "$@"; do [ "$a" = ls-remote ] && ls=1; [ "$a" = origin ] && named=1; done\n'
	printf '[ "$ls$named" = 10 ] && exit 128\n'
	printf 'exec "%s" "$@"\n' "$REAL_GIT"
} >"$DEAF/git"
chmod +x "$DEAF/git"
# pr <state> <headRefName> <headRefOid> [<isCrossRepository> [<baseRefName>]]
pr() {
	printf '{"state":"%s","headRefName":"%s","headRefOid":"%s","baseRefName":"%s","isCrossRepository":%s,"url":"https://%s/Acme/Widgets/pull/7"}\n' \
		"$1" "$2" "$3" "${5-main}" "${4:-false}" "${PR_HOST:-github.com}" >"$FAKE/pr.json"
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

# --- 2b. head: the same reading, from a tree that is not on the branch --------
new_repo
git -C "$R" checkout -q main
LOCAL="$(tip feature)"
pr OPEN feature "$LOCAL"
echo x >"$R/stray"
run head "${ARGS[@]}"
is "2b: head answers from another branch, clean tree or not" "$(val outcome)" open
is "2b: ...with the fetched head" "$(val head)" "$LOCAL"
is "2b: ...the head ref and the base ref" "$(val head-ref) $(val base-ref)" "feature main"
is "2b: ...and a local branch at the head as 'equal'" "$(val relation)" equal
[ ! -e "$R/.git/FETCH_HEAD" ]
ok "2b: ...leaving no FETCH_HEAD for an overlapping run to misread" $?
rm "$R/stray"
commit "$U" f3 theirs
git -C "$U" push -q origin feature
pr OPEN feature "$LOCAL"
run head "${ARGS[@]}"
is "2b: the head is what the fetch brought, not what the PR reported" "$(val head)" "$(tip HEAD "$U")"
is "2b: a local branch strictly behind it is 'behind'" "$(val relation)" behind
is "2b: ...and is not moved" "$(tip feature)" "$LOCAL"
is "2b: ...nor is the checkout" "$(git -C "$R" branch --show-current)" main
git -C "$R" branch -q -f feature "$(val head)"
git -C "$R" checkout -q feature
commit "$R" f4 mine
git -C "$R" checkout -q main
run head "${ARGS[@]}"
is "2b: a local branch past the head is 'ahead'" "$(val relation)" ahead
git -C "$R" checkout -q feature
git -C "$R" reset -q --soft HEAD~2
git -C "$R" commit -q -m "f3 and f4, squashed differently"
git -C "$R" checkout -q main
run head "${ARGS[@]}"
is "2b: a local branch missing the head's own commit is 'divergent'" "$(val relation)" divergent
is "2b: ...which is an answer, not a stop" "$RC" 0
git -C "$R" branch -q -f feature "$(val head)"
git -C "$R" checkout -q feature
git -C "$R" commit -q --amend -m "f3 reworded"
commit "$R" f5 mine
git -C "$R" checkout -q main
run head "${ARGS[@]}"
is "2b: a rewritten local branch carrying the head's patches is 'represented'" "$(val relation)" represented
has "2b: ...with the local tip named" "$OUT" "local=$(tip feature)"
git -C "$R" checkout -q -b newer "$(tip HEAD "$U")"
commit "$R" f6 newer
git -C "$R" checkout -q main
pr OPEN feature "$(tip newer)"
run head "${ARGS[@]}"
is "2b: with the reported head ahead of the fetched one, head stops on the rewind" "$(val outcome)" rewind
has "2b: ...naming the local tip beside the two heads" "$OUT" "local=$(tip feature)"
# GitHub has caught up with the rewind, but the caller read the head before it.
pr OPEN feature "$(tip HEAD "$U")"
run head "${ARGS[@]}"
is "2b: once GitHub reports the rewound head, the fresh read alone sees nothing" "$(val outcome)" open
run head "${ARGS[@]}" --expect "$(tip newer)"
is "2b: ...so a head the caller read earlier is tested too, and the rewind stops" "$(val outcome)" rewind
has "2b: ...naming the head it was behind" "$OUT" "reported=$(tip newer)"
pr OPEN feature "$(tip newer)"
pr OPEN feature "$(tip HEAD "$U")"
git -C "$R" branch -q -D feature
run head "${ARGS[@]}"
is "2b: no local branch of that name is 'absent'" "$(val relation)" absent
git -C "$R" tag feature main
run head "${ARGS[@]}"
is "2b: ...and a tag of that name does not answer for one" "$(val relation)" absent
git -C "$R" tag -d feature >/dev/null
lacks_local="$(val local)"
is "2b: ...with no local tip to name" "$lacks_local" ""
pr CLOSED feature "$(tip HEAD "$U")"
run head "${ARGS[@]}"
is "2b: a closed PR is a stop" "$(val outcome)" closed
pr OPEN feature "$(tip HEAD "$U")" true
run head "${ARGS[@]}"
is "2b: a fork PR is a stop" "$(val outcome)" fork
pr OPEN feature "$(tip HEAD "$U")"
git -C "$R" remote set-url origin "https://github.com/someone/else.git"
run head "${ARGS[@]}"
is "2b: with no remote for the repository, head stops" "$(val outcome)" no-remote

new_repo
commit "$U" f2 theirs
git -C "$U" push -q origin feature
pr OPEN feature "$(tip HEAD "$U")"
commit "$R" f2 mine
blob="$(git -C "$R" rev-parse HEAD:f2)"
rm -f "$R/.git/objects/${blob:0:2}/${blob:2}"
git -C "$R" checkout -q main
run head "${ARGS[@]}"
is "2b: a comparison that could not run is a failure, never a relation" "$RC" 1
is "2b: ...with no outcome" "$(val outcome)" ""

# The remote moves between the helper's read of the ref and its fetch: a git
# that pushes from the other clone just ahead of each fetch, while armed.
RACY="$WORKDIR/racy"
mkdir -p "$RACY"
# shellcheck disable=SC2016 # the shim's own $@ must reach it unexpanded
{
	printf '#!/usr/bin/env bash\n'
	printf 'f=0; for a in "$@"; do [ "$a" = fetch ] && f=1; done\n'
	printf 'if [ "$f" = 1 ] && [ -s "%s/armed" ]; then\n' "$RACY"
	printf '  n="$(cat "%s/armed")"; echo $((n - 1)) >"%s/armed"; [ "$n" -gt 1 ] || : >"%s/armed"\n' "$RACY" "$RACY" "$RACY"
	printf '  echo "$n" >>"%s/other/race"; "%s" -C "%s/other" add race; "%s" -C "%s/other" commit -q -m race; "%s" -C "%s/other" push -q origin feature\n' '__D__' "$REAL_GIT" '__D__' "$REAL_GIT" '__D__' "$REAL_GIT" '__D__'
	printf 'fi\n'
	printf 'exec "%s" "$@"\n' "$REAL_GIT"
} >"$RACY/git.tmpl"
racy() { # <times the remote moves under a fetch> <command...> → OUT, RC
	sed "s|__D__|$(dirname "$R")|g" "$RACY/git.tmpl" >"$RACY/git"
	chmod +x "$RACY/git"
	echo "$1" >"$RACY/armed"
	shift
	OUT="$(cd "$R" && PATH="$RACY:$PATH" bash "$HELPER" "$@" 2>/dev/null)"
	RC=$?
}
new_repo
pr OPEN feature "$(tip HEAD)"
racy 1 reconcile "${ARGS[@]}"
is "2b: a head that moved under the fetch is read again, and the head it settles on is the one adopted" "$(val head)" "$(remote_tip feature)"
is "2b: ...here an advance, fast-forwarded to" "$(val outcome)" fast-forwarded
new_repo
pr OPEN feature "$(tip HEAD)"
racy 5 reconcile "${ARGS[@]}"
is "2b: a head that will not hold still is a failure, never an older commit passed off as it" "$RC" 1
is "2b: ...with no outcome" "$(val outcome)" ""

# -C runs a command in another tree, as git takes it.
new_repo
OUT="$(cd "$WORKDIR" && bash "$HELPER" -C "$R" check 2>/dev/null)"
is "2b: -C names the tree to work in" "$(val tip)" "$(tip HEAD)"
echo x >"$R/stray"
OUT="$(cd "$WORKDIR" && bash "$HELPER" -C "$R" check 2>/dev/null)"
is "2b: ...and it is that tree whose dirt is reported" "$(val outcome)" dirty
(cd "$WORKDIR" && bash "$HELPER" -C "$WORKDIR/no-such-tree" check >/dev/null 2>&1)
is "2b: a tree that cannot be entered is a failure" "$?" 1
(cd "$WORKDIR" && bash "$HELPER" -C >/dev/null 2>&1)
is "2b: -C with no directory is a usage error" "$?" 64
cp "$HELPER" "$WORKDIR/copy.sh"
OUT="$(cd "$WORKDIR" && bash ./copy.sh -C "$R" --help 2>&1)"
has "2b: --help still finds the script after -C, by a relative path" "$OUT" "pr-branch.sh head"
OUT="$(cd "$WORKDIR" && bash ./copy.sh -C "$R" bogus 2>&1)"
has "2b: ...and so does the usage block, down to its last line" "$OUT" "pr-branch.sh push"
(cd "$WORKDIR" && bash "$HELPER" head "${ARGS[@]}" >/dev/null 2>&1)
is "2b: head outside a repository is a failure" "$?" 1

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

# A comparison that cannot run is a failure, never "nothing would be lost":
# with a blob of this branch's own commit gone, the patch-id pass dies.
new_repo
commit "$U" f2 theirs
git -C "$U" push -q origin feature
pr OPEN feature "$(tip HEAD "$U")"
commit "$R" f2 mine
blob="$(git -C "$R" rev-parse HEAD:f2)"
rm -f "$R/.git/objects/${blob:0:2}/${blob:2}"
BEFORE="$(tip HEAD)"
run reconcile "${ARGS[@]}"
is "3: a patch-id comparison that could not run is a failure" "$RC" 1
is "3: ...with no outcome, least of all 'represented'" "$(val outcome)" ""
has "3: ...saying what was not established" "$ERR" "could not compare"
is "3: ...and the branch is where it was" "$(tip HEAD)" "$BEFORE"

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
run pin-base --repo acme/widgets --base main
is "3b: ...except to pin a base from, which pushes nothing" "$(val outcome)" pinned
git -C "$R" remote set-url origin "https://github.com/someone/fork.git"
git -C "$R" remote set-url --push origin "https://github.com/acme/widgets/"
run reconcile "${ARGS[@]}"
is "3b: nor is one that only pushes to it" "$(val outcome)" no-remote

# Only the first fetch URL is fetched from, so a mirror there is what decides.
new_repo
pr OPEN feature "$(tip HEAD)"
git -C "$R" config --unset-all remote.origin.url
git -C "$R" config --add remote.origin.url "https://github.com/someone/mirror.git"
git -C "$R" config --add remote.origin.url "https://github.com/Acme/Widgets.git"
git -C "$R" config remote.origin.pushurl "https://github.com/Acme/Widgets.git"
run reconcile "${ARGS[@]}"
is "3b: a remote whose first fetch URL is a mirror is not the PR's, whatever its second names" "$(val outcome)" no-remote

# The host is part of the repository's name: a mirror elsewhere is not it.
new_repo
pr OPEN feature "$(tip HEAD)"
for url in "https://gitlab.com/Acme/Widgets.git" "git@gitlab.com:Acme/Widgets.git" "https://github.com.evil.test/Acme/Widgets.git" "https://evil.test/github.com/Acme/Widgets.git" "git@github.com:other/Acme/Widgets.git"; do
	git -C "$R" config "url.$O.insteadOf" "$url"
	git -C "$R" remote set-url origin "$url"
	run reconcile "${ARGS[@]}"
	is "3b: a same-named repository on another host is not the PR's ($url)" "$(val outcome)" no-remote
done
for url in "ssh://git@github.com:22/Acme/Widgets.git" "https://someone@GitHub.com/Acme/Widgets" "github.com:Acme/Widgets.git" "ssh://git@ssh.github.com:443/Acme/Widgets.git"; do
	git -C "$R" config "url.$O.insteadOf" "$url"
	git -C "$R" remote set-url origin "$url"
	run reconcile "${ARGS[@]}"
	is "3b: the host is found behind a user, a port or the scp form ($url)" "$(val remote)" origin
done
git -C "$R" config "url.$O.insteadOf" "https://ghe.example.test/Acme/Widgets.git"
git -C "$R" remote set-url origin "https://ghe.example.test/Acme/Widgets.git"
run reconcile "${ARGS[@]}"
is "3b: an Enterprise remote is not github.com's repository" "$(val outcome)" no-remote
has "3b: ...and the stop names the host it looked for" "$ERR" "on github.com,"
PR_HOST=ghe.example.test pr OPEN feature "$(tip HEAD)"
run reconcile "${ARGS[@]}"
is "3b: ...but it is the repository of a PR whose own URL is on that host" "$(val remote)" origin
pr OPEN feature "$(tip HEAD)"
run reconcile --repo ghe.example.test/acme/widgets --pr 7
is "3b: ...but it is the one a host-qualified selector names" "$(val remote)" origin
run pin-base --repo acme/widgets --base main
is "3b: with no PR read, the host defaults to github.com" "$(val outcome)" no-remote
OUT="$(cd "$R" && GH_HOST=ghe.example.test bash "$HELPER" pin-base --repo acme/widgets --base main 2>/dev/null)"
is "3b: ...or to the one GH_HOST names" "$(val outcome)" pinned

# --- 4. pin-base ------------------------------------------------------------
new_repo
LOCAL_MAIN="$(tip main)"
git -C "$U" checkout -q main
commit "$U" base moved
git -C "$U" push -q origin main
run pin-base --repo acme/widgets --base main
is "4: the base is fetched fresh, not read from a stale tracking ref" "$(val base)" "$(tip main "$U")"
is "4: ...naming the remote it matched" "$(val remote)" origin
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

# The same instant, and this checkout also learns of the move before the push:
# a fetch from elsewhere (a sibling worktree, an editor's background fetch)
# brings the remote-tracking ref up to the other writer's commit. A lease that
# names no commit takes its expectation from that ref, so it would match and
# overwrite; only one exact on `--expect` still refuses. The helper's own fetch
# must see the expected head, so the move rides in on a git that makes it just
# ahead of the real `git push`.
LAPPED="$WORKDIR/lapped"
mkdir -p "$LAPPED"
for shape in fast-forward rewrite; do
	new_repo
	HEAD0="$(tip HEAD)"
	pr OPEN feature "$HEAD0"
	commit "$U" f7 theirs
	THEIRS="$(tip HEAD "$U")"
	# shellcheck disable=SC2016 # the shim's own $@ must reach it unexpanded
	{
		printf '#!/usr/bin/env bash\n'
		printf 'for a in "$@"; do [ "$a" = push ] && { "%s" -C "%s" push -q origin feature; "%s" fetch -q origin; echo moved >>"%s/moved"; break; }; done\n' "$REAL_GIT" "$U" "$REAL_GIT" "$LAPPED"
		printf 'exec "%s" "$@"\n' "$REAL_GIT"
	} >"$LAPPED/git"
	chmod +x "$LAPPED/git"
	: >"$LAPPED/moved"
	if [ "$shape" = rewrite ]; then git -C "$R" commit -q --amend -m "f2 reworded"; else commit "$R" f8 mine; fi
	OUT="$(cd "$R" && PATH="$LAPPED:$PATH" bash "$HELPER" push "${ARGS[@]}" --expect "$HEAD0" 2>/dev/null)"
	is "5: (setup) the helper reached its push, once ($shape)" "$(grep -c moved "$LAPPED/moved")" 1
	is "5: the remote-tracking ref names the other writer's commit, which a lease read from it would match ($shape)" "$(tip refs/remotes/origin/feature)" "$THEIRS"
	is "5: a $shape push is 'rejected' on the expected head, whatever the remote-tracking ref says" "$(val outcome)" rejected
	is "5: ...and origin keeps the other writer's commit, lease by commit ($shape)" "$(remote_tip feature)" "$THEIRS"
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
is "5: ...and every push URL's answer is given, the one that took it included" "$(printf '%s\n' "$OUT" | grep -c '^readback=')" 2
has "5: ...that one by the tip it shows" "$OUT" "readback=$O $(tip HEAD)"

# A hook refuses a push of a tip origin already carries: the ref shows it,
# but no push of this run's succeeded.
new_repo
HEAD0="$(tip HEAD)"
pr OPEN feature "$HEAD0"
printf '#!/bin/sh\nexit 1\n' >"$R/.git/hooks/pre-push"
chmod +x "$R/.git/hooks/pre-push"
run push "${ARGS[@]}" --expect "$HEAD0"
is "5: a refused push is never 'up-to-date', even where the ref already shows the tip" "$(val outcome)" refused
is "5: ...and is a stop" "$RC" 3
commit "$R" f3 one
run push "${ARGS[@]}" --expect "$HEAD0"
is "5: ...and where it does not, it is 'rejected'" "$(val outcome)" rejected
rm "$R/.git/hooks/pre-push"

# A refused push whose read-back gets no answer has established nothing.
new_repo
HEAD0="$(tip HEAD)"
pr OPEN feature "$HEAD0"
commit "$U" f7 theirs
printf '#!/bin/sh\nunset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE\ngit -C "%s" push -q origin feature\n' "$U" >"$R/.git/hooks/pre-push"
chmod +x "$R/.git/hooks/pre-push"
commit "$R" f8 mine
OUT="$(cd "$R" && PATH="$DEAF:$PATH" bash "$HELPER" push "${ARGS[@]}" --expect "$HEAD0" 2>/dev/null)"
is "5: a refused push nobody could read back is 'unconfirmed', not 'rejected'" "$(val outcome)" unconfirmed
is "5: ...saying the command was refused" "$(val push-command)" refused
has "5: ...and that the URL did not answer" "$OUT" "no answer"
rm "$R/.git/hooks/pre-push"

# A push that went through, with the same silence afterwards.
new_repo
HEAD0="$(tip HEAD)"
pr OPEN feature "$HEAD0"
commit "$R" f3 one
OUT="$(cd "$R" && PATH="$DEAF:$PATH" bash "$HELPER" push "${ARGS[@]}" --expect "$HEAD0" 2>/dev/null)"
is "5: a push that returned but could not be read back is 'unconfirmed'" "$(val outcome)" unconfirmed
is "5: ...though it did land" "$(remote_tip feature)" "$(tip HEAD)"

# No temporary file, no push: the read-back is provisioned first.
new_repo
HEAD0="$(tip HEAD)"
pr OPEN feature "$HEAD0"
commit "$R" f3 one
OUT="$(cd "$R" && TMPDIR="$WORKDIR/no-such-dir" bash "$HELPER" push "${ARGS[@]}" --expect "$HEAD0" 2>/dev/null)"
RC=$?
is "5: a read-back that cannot be provisioned fails the command" "$RC" 1
is "5: ...before anything is pushed" "$(remote_tip feature)" "$HEAD0"

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
has "5: ...naming the URL that answered without the ref" "$OUT" "readback=$(dirname "$O")/mirror.git absent"
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

# An ancestry probe that cannot run is neither "yes" nor "no".
BLIND="$WORKDIR/blind"
mkdir -p "$BLIND"
# shellcheck disable=SC2016 # the shim's own $@ must reach it unexpanded
{
	printf '#!/usr/bin/env bash\n'
	printf 'for a in "$@"; do [ "$a" = merge-base ] && exit 128; done\n'
	printf 'exec "%s" "$@"\n' "$REAL_GIT"
} >"$BLIND/git"
chmod +x "$BLIND/git"
new_repo
HEAD0="$(tip HEAD)"
pr OPEN feature "$HEAD0"
commit "$R" f3 one
OUT="$(cd "$R" && PATH="$BLIND:$PATH" bash "$HELPER" push "${ARGS[@]}" --expect "$HEAD0" 2>/dev/null)"
RC=$?
is "5: an ancestry probe that could not run fails the push" "$RC" 1
is "5: ...with no outcome" "$(val outcome)" ""
is "5: ...and nothing pushed down the rewrite arm" "$(remote_tip feature)" "$HEAD0"
commit "$U" f4 theirs
git -C "$U" push -q origin feature
pr OPEN feature "$(tip HEAD "$U")"
OUT="$(cd "$R" && PATH="$BLIND:$PATH" bash "$HELPER" reconcile "${ARGS[@]}" 2>/dev/null)"
RC=$?
is "5: ...and fails a reconcile the same way" "$RC" 1
is "5: ...which reports no relation it did not establish" "$(val outcome)" ""

# The checkout is switched while the fetch is on the network: the fast-forward
# would move whichever branch is checked out by then.
SWITCH="$WORKDIR/switch"
mkdir -p "$SWITCH"
# shellcheck disable=SC2016 # the shim's own $@ must reach it unexpanded
{
	printf '#!/usr/bin/env bash\n'
	printf 'for a in "$@"; do [ "$a" = fetch ] && { "%s" "$@"; rc=$?; "%s" checkout -q main; exit $rc; }; done\n' "$REAL_GIT" "$REAL_GIT"
	printf 'exec "%s" "$@"\n' "$REAL_GIT"
} >"$SWITCH/git"
chmod +x "$SWITCH/git"
new_repo
MAIN0="$(tip main)"
commit "$U" f3 theirs
git -C "$U" push -q origin feature
pr OPEN feature "$(tip HEAD "$U")"
OUT="$(cd "$R" && PATH="$SWITCH:$PATH" bash "$HELPER" reconcile "${ARGS[@]}" 2>/dev/null)"
RC=$?
is "5: (setup) the checkout was switched during the fetch" "$(git -C "$R" branch --show-current)" main
is "5: a checkout switched during the fetch is a stop" "$(val outcome)" wrong-branch
is "5: ...and the branch now checked out is not fast-forwarded" "$(tip main)" "$MAIN0"

# ...or the branch itself gains a commit meanwhile.
# shellcheck disable=SC2016 # the shim's own $@ must reach it unexpanded
{
	printf '#!/usr/bin/env bash\n'
	printf 'for a in "$@"; do [ "$a" = fetch ] && { "%s" "$@"; rc=$?; "%s" commit -q --allow-empty -m meanwhile; exit $rc; }; done\n' "$REAL_GIT" "$REAL_GIT"
	printf 'exec "%s" "$@"\n' "$REAL_GIT"
} >"$SWITCH/git"
new_repo
commit "$U" f3 theirs
git -C "$U" push -q origin feature
pr OPEN feature "$(tip HEAD "$U")"
OUT="$(cd "$R" && PATH="$SWITCH:$PATH" bash "$HELPER" reconcile "${ARGS[@]}" 2>/dev/null)"
RC=$?
is "5: a branch that moved during the fetch fails the reconcile" "$RC" 1
is "5: ...with no relation reported for a tip it did not read" "$(val outcome)" ""

# --- 5b. gh's agent hint ----------------------------------------------------
# The block as gh 2.105.0 prints it (pkg/cmd/event/shared/hint.go).
HINT="$WORKDIR/hint"
cat >"$HINT" <<'HINT'
hint: if you need to wait for this pull request to be reviewed, merged, or closed before continuing, use this instead of polling:
    gh event listen --resource https://github.com/Acme/Widgets/pull/7 --event com.github.pull_request.review.submitted.v1,com.github.pull_request.state.changed.v1
  - It prints the first event as a JSON line on stdout and exits; run it again to wait for the next one.
  - Add `--timeout` to stop waiting after a while, for example `--timeout 30m`; it then exits with status 8.
  - Events carry no details; read the pull request to see what changed.
  - It misses changes made before it starts, so read the pull request once it is running.
  - See `gh event listen --help` for other event types.
  - Event subscriptions are in preview and may not be enabled for your account.
HINT
new_repo
pr OPEN feature "$(tip HEAD)"
cp "$HINT" "$FAKE/hint"
run reconcile "${ARGS[@]}"
is "5b: a PR read that ends in gh's agent hint is read all the same" "$(val outcome)" equal
is "5b: ...and none of the hint reaches the helper's stderr" "$ERR" ""
git -C "$R" checkout -q -b elsewhere
run reconcile "${ARGS[@]}"
is "5b: ...which then holds the helper's own explanation alone" "$(printf '%s\n' "$ERR" | grep -c .)" 1
has "5b: ...whole" "$ERR" "pr-branch: "
git -C "$R" checkout -q feature
printf 'gh: the network broke\n' >"$FAKE/gh-error"
cat "$HINT" >>"$FAKE/gh-error"
run reconcile "${ARGS[@]}"
is "5b: a gh that fails still fails the read" "$RC" 1
has "5b: ...and its own error line still gets through" "$ERR" "gh: the network broke"
case "$ERR" in *"gh event listen"*) ok "5b: ...without the hint beside it" 1 ;; *) ok "5b: ...without the hint beside it" 0 ;; esac
rm -f "$FAKE/hint" "$FAKE/gh-error"

# Every bundled helper that calls `gh pr` carries the same filter. Each copy is
# run on its own against a gh that prints the block among lines that only
# resemble it.
NOISY="$WORKDIR/noisy"
mkdir -p "$NOISY"
{
	printf '#!/usr/bin/env bash\n'
	printf 'echo "stdout: $*"\n'
	printf 'echo "warning: before" >&2\n'
	printf 'cat "%s" >&2\n' "$HINT"
	printf 'echo "gh: after" >&2\n'
	printf 'echo "  - a list item of some other message" >&2\n'
	printf 'echo "    gh event listen named elsewhere" >&2\n'
	printf 'echo "hint: some other hint" >&2\n'
	printf 'head -n 1 "%s" >&2\n' "$HINT"
	printf 'echo "gh: right after the first line alone" >&2\n'
	printf 'exit 7\n'
} >"$NOISY/gh"
chmod +x "$NOISY/gh"
KEPT='warning: before
gh: after
  - a list item of some other message
    gh event listen named elsewhere
hint: some other hint
gh: right after the first line alone'
for f in address-review/ping.sh address-review/pr-branch.sh address-reviews/targets.sh merge-train/train.sh prune-branches/prune-branches.sh write-tasks/task-numbers.sh; do
	for m in plugins codex; do
		sed -n '/^gh() {$/,/^} 3>&1$/p' "$SCRIPT_DIR/../$m/dev-skills/skills/$f" >"$WORKDIR/filter.sh"
		[ -s "$WORKDIR/filter.sh" ]
		ok "5b: $m $f carries the hint filter" $?
		OUT="$(PATH="$NOISY:$PATH" bash -c '. "$1"; gh pr view 7 --repo acme/widgets 2>"$2"' _ "$WORKDIR/filter.sh" "$WORKDIR/err")"
		is "5b: $m $f: gh's exit status passes through" "$?" 7
		is "5b: $m $f: its stdout too, with its arguments" "$OUT" "stdout: pr view 7 --repo acme/widgets"
		is "5b: $m $f: and every line of stderr but the block" "$(cat "$WORKDIR/err")" "$KEPT"
	done
done
# Checked on the working files, so that a filter dropped from a helper that
# has a `gh pr` call is seen where no suite of its own prints the block.
# gh prints the block after a plain REST read of a pull request too
# (`gh api repos/<owner>/<repo>/pulls/<N>`), which this check does not look
# for: no helper makes one today, so a helper that starts to needs the
# filter added by hand and this pattern widened.
for f in "$SCRIPT_DIR"/../plugins/dev-skills/skills/*/*.sh; do
	if grep -v '^[[:space:]]*#' "$f" | grep -Eq '(^|[^[:alnum:]_.-])gh pr '; then
		grep -q '^gh() {$' "$f"
		ok "5b: ${f##*/skills/} calls \`gh pr\` and so filters gh's stderr" $?
	fi
done

# --- 6. the shipped files ---------------------------------------------------
cmp -s "$SCRIPT_DIR/../plugins/dev-skills/skills/address-review/pr-branch.sh" "$MIRROR"
ok "the Codex mirror ships the same helper, byte for byte" $?
for f in plugins/dev-skills/skills/address-review/pr-branch.sh codex/dev-skills/skills/address-review/pr-branch.sh; do
	mode="$(git -c safe.directory='*' -C "$SCRIPT_DIR/.." ls-files -s -- "$f" | cut -d' ' -f1)"
	is "$f is committed executable" "$mode" 100755
done
OUT="$("$SCRIPT_DIR/../plugins/dev-skills/skills/address-review/pr-branch.sh" --help 2>&1)"
has "the helper runs by path and prints its contract" "$OUT" "pr-branch.sh reconcile"
# The plugin's bin/ gives the same script a name on PATH, for a workflow agent
# that holds a brief rather than a skill folder.
SHIM="$SCRIPT_DIR/../plugins/dev-skills/bin/address-review-pr-branch"
is "the bin/ shim is committed executable" "$(git -c safe.directory='*' -C "$SCRIPT_DIR/.." ls-files -s -- plugins/dev-skills/bin/address-review-pr-branch | cut -d' ' -f1)" 100755
new_repo
OUT="$(cd "$R" && PATH="$(dirname "$SHIM"):$PATH" address-review-pr-branch check 2>&1)"
has "the shim runs the bundled helper by name, in the caller's directory" "$OUT" "tip=$(tip HEAD)"
ln -s "$SHIM" "$WORKDIR/linked-shim"
OUT="$(cd "$R" && bash "$WORKDIR/linked-shim" check 2>&1)"
has "the shim follows a symlink to itself" "$OUT" "tip=$(tip HEAD)"
cp "$SHIM" "$WORKDIR/address-review-pr-branch"
OUT="$(bash "$WORKDIR/address-review-pr-branch" check 2>&1)"
is "a shim copied away from the plugin fails as 'not found' does" "$?" 127
has "...saying what it needs beside it" "$OUT" "only works from the dev-skills plugin's own bin/"

if [ "$fails" -gt 0 ]; then
	printf 'address-review pr-branch helper test: %d/%d checks FAILED.\n' "$fails" "$checks" >&2
	exit 1
fi
printf 'address-review pr-branch helper test passed (%d checks).\n' "$checks"
