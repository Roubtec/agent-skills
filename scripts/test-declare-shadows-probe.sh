#!/usr/bin/env bash
# Hermetic test for `probe.sh`, the read-only probe the declare-shadows skill
# bundles and the enable-worktrees skill calls from the folder beside its own.
#
# Each case builds a throwaway repository under one `mktemp -d` root and runs
# the real probe in it with real git and the real `yq` (either family: the
# jq-wrapper one or mikefarah's v4). `findmnt`, `mountpoint` and powbox's
# `detect-shadows.sh` are fakes answering from files, so a case can state the
# mount table it wants; `yq` is reached through a wrapper that logs each call.
# `shadow-refresh.sh` and `wt-bootstrap` are fakes that only log, and the suite
# asserts the probe never reaches them. `NOTOOLS` is a PATH holding everything
# but those helpers, for the answers a plain machine gets.
# `PROBE_HELPER` points the suite at another copy (a mutant, say).
# shellcheck disable=SC2319 # `ok <label> $?` after a `[ … ]` test is the point
set -u

ROOT="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SHIPPED="$ROOT/plugins/dev-skills/skills/declare-shadows/probe.sh"
MIRROR="$ROOT/codex/dev-skills/skills/declare-shadows/probe.sh"
HELPER="${PROBE_HELPER:-$SHIPPED}"
command -v yq >/dev/null 2>&1 || {
	echo "test-declare-shadows-probe: needs yq on PATH" >&2
	exit 1
}
REAL_YQ="$(command -v yq)"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/shadows-probe-test.XXXXXX")" || exit 1
trap 'rm -rf "$WORKDIR"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
TAB="$(printf '\t')"
NL='
'

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

# ------------------------------------------------------------------ fakes --
FAKE="$WORKDIR/bin"
NOTOOLS="$WORKDIR/notools"
EMPTYTMP="$WORKDIR/tmp"
mkdir -p "$FAKE" "$NOTOOLS" "$EMPTYTMP"
export FAKE REAL_YQ

cat >"$FAKE/yq" <<'FAKEYQ'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$FAKE/yq.log"
exec "$REAL_YQ" "$@"
FAKEYQ
# $FAKE/mounts holds `<target> TAB <fstype>` lines; $FAKE/findmnt-fails makes
# the listing of every mount fail.
cat >"$FAKE/findmnt" <<'FAKEFINDMNT'
#!/usr/bin/env bash
mode=list path=""
while [ $# -gt 0 ]; do
	case "$1" in
	-M) mode=exact path="$2"; shift ;;
	-T) mode=holding path="$2"; shift ;;
	-o) shift ;;
	esac
	shift
done
[ -f "$FAKE/mounts" ] || : >"$FAKE/mounts"
case "$mode" in
list)
	[ ! -f "$FAKE/findmnt-fails" ] || exit 1
	awk -F '\t' '{ print $1 }' "$FAKE/mounts"
	;;
exact) P="$path" awk -F '\t' '$1 == ENVIRON["P"] { print $2; found = 1 } END { exit !found }' "$FAKE/mounts" ;;
holding)
	P="$path" awk -F '\t' '
		($1 == ENVIRON["P"] || index(ENVIRON["P"], $1 "/") == 1) && length($1) > best { best = length($1); fs = $2 }
		END { print (fs == "" ? "overlay" : fs) }' "$FAKE/mounts"
	;;
esac
FAKEFINDMNT
cat >"$FAKE/mountpoint" <<'FAKEMOUNTPOINT'
#!/usr/bin/env bash
[ "$1" != -q ] || shift
[ -f "$FAKE/mounts" ] || exit 1
P="$1" awk -F '\t' '$1 == ENVIRON["P"] { found = 1 } END { exit !found }' "$FAKE/mounts"
FAKEMOUNTPOINT
# $FAKE/detect holds paths relative to the workspace; $FAKE/detect-fails makes it fail.
cat >"$FAKE/detect-shadows.sh" <<'FAKEDETECT'
#!/usr/bin/env bash
[ ! -f "$FAKE/detect-fails" ] || exit 1
[ -f "$FAKE/detect" ] || exit 0
while IFS= read -r rel; do printf '%s/%s\n' "$1" "$rel"; done <"$FAKE/detect"
FAKEDETECT
for forbidden in shadow-refresh.sh wt-bootstrap; do
	# shellcheck disable=SC2016 # the fake's own $* and $FAKE
	printf '#!/usr/bin/env bash\nprintf "%%s\\n" "%s $*" >>"$FAKE/forbidden.log"\n' "$forbidden" >"$FAKE/$forbidden"
done
chmod +x "$FAKE"/*

# Everything on PATH except the helpers the probe treats as optional.
OLDIFS="$IFS"
IFS=:
for d in $PATH; do
	[ -d "$d" ] || continue
	for f in "$d"/*; do
		[ -e "$NOTOOLS/${f##*/}" ] || ln -s "$f" "$NOTOOLS/${f##*/}" 2>/dev/null
	done
done
IFS="$OLDIFS"
rm -f "$NOTOOLS/yq" "$NOTOOLS/findmnt" "$NOTOOLS/mountpoint" "$NOTOOLS/detect-shadows.sh" "$NOTOOLS/shadow-refresh.sh" "$NOTOOLS/wt-bootstrap"
WITHTOOLS="$FAKE:$PATH"
export PATH="$WITHTOOLS"
export TMPDIR="$EMPTYTMP"

# -------------------------------------------------------------- scaffolding --
R="" OUT="" RC=0
new_repo() {
	R="$(mktemp -d "$WORKDIR/case.XXXXXX")/repo"
	rm -f "$FAKE/mounts" "$FAKE/findmnt-fails" "$FAKE/detect" "$FAKE/detect-fails" "$FAKE/yq.log"
	git init -q -b main "$R"
	printf 'x\n' >"$R/README"
	git -C "$R" add README
	git -C "$R" commit -q -m init
}
commit() { # <path> <text>: write and commit a file
	mkdir -p "$R/$(dirname "$1")"
	printf '%b' "$2" >"$R/$1"
	git -C "$R" add -f "$1"
	git -C "$R" commit -q -m "add $1"
}
put() { # <path> [text]: write a file without committing it
	mkdir -p "$R/$(dirname "$1")"
	printf '%b' "${2:-x\n}" >"$R/$1"
}
mount() { # <relative path> <fstype>: mount table entry, creating the directory
	mkdir -p "$R/$1"
	printf '%s\t%s\n' "$R/$1" "$2" >>"$FAKE/mounts"
}
run() { # <probe arguments>
	OUT="$(cd "$R" && bash "$HELPER" "$@" 2>"$WORKDIR/stderr")"
	RC=$?
}
row() { # <key=first field>: the whole output line
	printf '%s\n' "$OUT" | K="$1" awk -F '\t' '$1 == ENVIRON["K"]'
}
fld() { # <key=first field> <field name>
	row "$1" | tr '\t' '\n' | K="$2=" awk 'index($0, ENVIRON["K"]) == 1 { print substr($0, length(ENVIRON["K"]) + 1) }'
}
cand() { fld "candidate=$1" "$2"; } # <path> <field>
wroot() { fld "worktree_root=$1" "$2"; }
first_line() { printf '%s\n' "$OUT" | sed -n 1p; }
# Everything a write could change: every file's bytes, and every entry's mode
# and modification time, `.git` included.
snapshot() {
	(
		cd "$1" || exit
		find . \( -type f -o -type l \) -print | LC_ALL=C sort | while IFS= read -r f; do
			if [ -L "$f" ]; then printf 'link %s -> %s\n' "$f" "$(readlink "$f")"; else printf '%s %s\n' "$(cksum <"$f")" "$f"; fi
		done
		find . -exec ls -ld --time-style=full-iso {} + 2>/dev/null | LC_ALL=C sort
	)
}

# ------------------------------------------------------- shipped file facts --
cmp -s "$SHIPPED" "$MIRROR"
ok "the two mirrors ship the same probe" $?
for f in plugins/dev-skills/skills/declare-shadows/probe.sh codex/dev-skills/skills/declare-shadows/probe.sh; do
	is "$f is committed executable" "$(git -C "$ROOT" ls-files -s -- "$f" | cut -c1-6)" 100755
done
OUT="$(bash "$HELPER" --help 2>&1)"
is "--help exits 0" "$?" 0
has "--help prints the contract" "$OUT" "probe.sh worktrees"
lacks "--help stops at the code" "$OUT" "set -u"

# -------------------------------------------------------------------- usage --
new_repo
for args in "" "bogus" "shadows --limit" "shadows --limit x" "shadows --nope" "worktrees extra" "shadows --candidate" "-C"; do
	# shellcheck disable=SC2086 # the words are the arguments
	run $args
	is "usage error for '$args'" "$RC" 64
	is "usage error for '$args' prints nothing on stdout" "$OUT" ""
done
OUT="$(cd "$WORKDIR" && bash "$HELPER" -C "$R" worktrees 2>/dev/null)"
has "-C names the repository" "$OUT" "repo=$R"

d="$(mktemp -d "$WORKDIR/plain.XXXXXX")"
for cmd in shadows worktrees; do
	OUT="$(cd "$d" && GIT_CEILING_DIRECTORIES="$WORKDIR" bash "$HELPER" "$cmd" 2>/dev/null)"
	is "$cmd outside a repository exits 3" "$?" 3
	is "$cmd outside a repository says so" "$OUT" "outcome=not-a-repository"
done

# ------------------------------------------- a plain checkout, no powbox --
new_repo
commit .gitignore 'dist/\n'
put dist/out.js
for cmd in shadows worktrees; do
	OUT="$(cd "$R" && PATH="$NOTOOLS" bash "$HELPER" "$cmd" 2>"$WORKDIR/stderr")"
	RC=$?
	is "plain $cmd exits 0" "$RC" 0
	is "plain $cmd leads with the outcome" "$(first_line)" "outcome=probed"
	is "plain $cmd: no .powbox.yml" "$(row powbox_yml=absent)" "powbox_yml=absent"
	is "plain $cmd: no local file" "$(row powbox_local_yml=absent)" "powbox_local_yml=absent"
	is "plain $cmd: no override" "$(row override=none)" "override=none"
	is "plain $cmd: no effective list" "$(row effective=none)" "effective=none"
	is "plain $cmd: tools reported absent" "$(row tools=yq:absent)" "tools=yq:absent${TAB}findmnt:absent${TAB}mountpoint:absent${TAB}detect-shadows.sh:absent"
	is "plain $cmd: silent on stderr" "$(cat "$WORKDIR/stderr")" ""
	is "plain $cmd: main checkout" "$(row checkout=main)" "checkout=main"
done
OUT="$(cd "$R" && PATH="$NOTOOLS" bash "$HELPER" shadows 2>/dev/null)"
is "plain: the ignored folder is a candidate" "$(cand dist from)" ignored
is "plain: mount unknown without findmnt" "$(cand dist mount)" unknown
is "plain: below unknown without findmnt" "$(cand dist below)" "-"
is "plain: derived unknown without detect-shadows.sh" "$(cand dist derived)" unknown
OUT="$(cd "$R" && PATH="$NOTOOLS" bash "$HELPER" worktrees 2>/dev/null)"
is "plain: mounts unknown without findmnt" "$(row mounts=unknown)" "mounts=unknown"
is "plain: mountpoint unknown" "$(wroot .worktrees mountpoint)" unknown
is "plain: root not declared" "$(wroot .worktrees committed)$(wroot .worktrees effective)" nono
is "plain: no override column" "$(wroot .worktrees override)" "-"
is "plain: root not ignored" "$(wroot .claude/worktrees ignored)" no
run shadows
is "no powbox file: yq is never run" "$(cat "$FAKE/yq.log" 2>/dev/null)" ""

put .powbox.yml 'shadow:\n  - dist\n'
OUT="$(cd "$R" && PATH="$NOTOOLS" bash "$HELPER" shadows 2>/dev/null)"
is "a powbox file and no yq exits 3" "$?" 3
is "a powbox file and no yq says so" "$(first_line)" "outcome=no-yq"
has "no-yq still names the file" "$OUT" "powbox_yml=present"
lacks "no-yq prints no candidate" "$OUT" "candidate="

# ---------------------------------------------- the fixture: build folders --
new_repo
commit .gitignore 'dist/\nnode_modules/\n.turbo/\n*.log\n.venv/\ncoverage/\ntarget\n'
commit apps/web/src/index.js 'x\n'
commit apps/api/src/index.js 'x\n'
put apps/web/dist/bundle.js
put apps/api/dist/bundle.js
put .turbo/cache/a
put coverage/index.html
put logs/a.log
put logs/b.log
put .venv/lib/x.py
mkdir -p "$R/.venv/src/pkg/.git"
put "has${TAB}tab/dist/x"
run shadows
is "fixture exits 0" "$RC" 0
is "fixture outcome" "$(first_line)" "outcome=probed"
for c in apps/web/dist apps/api/dist .turbo coverage .venv; do
	is "fixture: $c is a candidate from disk" "$(cand "$c" from)" ignored
	is "fixture: $c exists" "$(cand "$c" exists)" dir
	is "fixture: $c is ignored by a committed rule" "$(cand "$c" ignored)" shared
	is "fixture: $c holds nothing tracked" "$(cand "$c" tracked)" no
done
is "fixture: rule names its source" "$(cand apps/web/dist rule)" ".gitignore:1:dist/"
is "fixture: guard passes build output" "$(cand apps/web/dist guard)" ok
is "fixture: a nested checkout trips the guard" "$(cand .venv guard)" "nested-git:.venv/src/pkg/.git"
is "fixture: a folder ignored only through its files is no candidate" "$(row candidate=logs)" ""
is "fixture: and is counted" "$(row dropped=1)" "dropped=1"
is "fixture: an ignored file is no candidate" "$(row candidate=logs/a.log)" ""
has "fixture: an unprintable name is surfaced" "$OUT" "${TAB}a name with a tab or newline"
is "fixture: the ignore file is listed" "$(row gitignore=.gitignore)" "gitignore=.gitignore"
is "fixture: candidates are literal paths" "$(printf '%s\n' "$OUT" | grep -c '^candidate=[^	]*[][*?]')" 0

# An unbuilt project: nothing on disk, named by the caller.
run shadows --candidate apps/new/dist --candidate ./apps/web/dist/ --candidate apps/new/src
is "named: an absent directory matches a directory-only rule" "$(cand apps/new/dist ignored)" shared
is "named: absent" "$(cand apps/new/dist exists)" absent
is "named: guard lets an absent literal through" "$(cand apps/new/dist guard)" ok
is "named: source" "$(cand apps/new/dist from)" named
is "named: spelling is normalized and merged" "$(cand apps/web/dist from)" "named,ignored"
is "named: an unignored path reads no" "$(cand apps/new/src ignored)" no
is "named: an unignored path has no rule" "$(cand apps/new/src rule)" ""

# ------------------------------------------------------- ignore-rule sources --
new_repo
commit .gitignore 'build/\n!apps/keep/build/\n'
put .git/info/exclude 'private/\n'
put apps/a/build/x
put apps/keep/build/x
put private/x
put scratch/x
printf 'scratch/\n' >>"$R/.gitignore"
printf 'everywhere/\n' >"$WORKDIR/global-excludes"
printf '[core]\n\texcludesFile = %s\n' "$WORKDIR/global-excludes" >"$WORKDIR/gitconfig"
put everywhere/x
OUT="$(cd "$R" && GIT_CONFIG_GLOBAL="$WORKDIR/gitconfig" bash "$HELPER" shadows --candidate apps/keep/build 2>/dev/null)"
is "sources: a committed rule in a file edited since is unshared" "$(cand apps/a/build ignored)" unshared
is "sources: the repository's own exclude file is unshared" "$(cand private ignored)" unshared
has "sources: and is named" "$(cand private rule)" "info/exclude:1:private/"
is "sources: an uncommitted .gitignore line is unshared" "$(cand scratch ignored)" unshared
is "sources: a global excludes file is unshared" "$(cand everywhere ignored)" unshared
is "sources: a negated rule is not an ignore" "$(cand apps/keep/build ignored)" no
has "sources: the negation is shown" "$(cand apps/keep/build rule)" "!apps/keep/build/"
git -C "$R" commit -q -am "ignore scratch"
run shadows
is "sources: the same line once committed is shared" "$(cand scratch ignored)" shared
is "sources: a committed rule is shared" "$(cand apps/a/build ignored)" shared
is "sources: the exclude file stays unshared" "$(cand private ignored)" unshared

# The matching line being in HEAD is not enough: what it ignores depends on
# the rest of the file.
new_repo
commit .gitignore 'd/\n!d/\ntrail/   \n'
commit apps/.gitignore 'out/\n'
put d/x
put trail/x
put apps/out/x
run shadows
is "sources: a committed negation is no ignore" "$(row candidate=d)" ""
is "sources: a pattern with trailing spaces is shared" "$(cand trail ignored)" shared
is "sources: a nested ignore file is compared by its own path" "$(cand apps/out ignored)" shared
printf 'd/\ntrail/   \n' >"$R/.gitignore"
run shadows
is "sources: a negation removed but not committed leaves the rule unshared" "$(cand d ignored)" unshared
is "sources: and so is every other rule of that file" "$(cand trail ignored)" unshared
is "sources: another ignore file is unaffected" "$(cand apps/out ignored)" shared
git -C "$R" add .gitignore
run shadows
is "sources: a staged edit is still not in HEAD" "$(cand d ignored)" unshared
new_repo
commit .gitignore 'dist/\r\nout/\r\n'
put dist/x
run shadows
is "sources: a committed CRLF ignore file is shared" "$(cand dist ignored)" shared

# An unborn branch has no commit to share a rule from.
R="$(mktemp -d "$WORKDIR/case.XXXXXX")/repo"
git init -q -b main "$R"
put .gitignore 'dist/\n'
put dist/x
run shadows
is "unborn: exits 0" "$RC" 0
is "unborn: nothing is shared yet" "$(cand dist ignored)" unshared

# ------------------------------------------------------------------ tracked --
new_repo
commit .gitignore 'dist/\ngen/\n'
commit gen/keep.txt 'x\n'
commit src/a.txt 'x\n'
put dist/x
put .powbox.yml 'shadow:\n  - gen\n  - src\n  - dist\n'
run shadows
is "tracked: a declared folder holding a tracked file" "$(cand gen tracked)" yes
is "tracked: a declared source folder" "$(cand src tracked)" yes
is "tracked: a declared source folder is not ignored" "$(cand src ignored)" no
is "tracked: build output" "$(cand dist tracked)" no
is "tracked: declared and on disk" "$(cand dist from)" "committed,ignored"

# ------------------------------------------------------------ ownership guard --
new_repo
commit .gitignore 'dist/\nout/\n'
commit apps/web/a.txt 'x\n'
ln -s apps "$R/link"
ln -s nowhere "$R/dangling"
put file.txt
mkdir -p "$R/ext" && : >"$R/ext/.git"
put ext/dist/x
mkdir -p "$R/hasgit/dist" && ln -s gone "$R/hasgit/.git"
git -C "$R" update-index --add --cacheinfo "160000,$(git -C "$R" rev-parse HEAD),vendor/sub"
put big/out/1
put big/out/2
put big/out/3
put big/out/4
put big/out/deep/.git/HEAD
put apps/web/dist/x
put .powbox.yml 'shadow:\n  - .git/worktrees\n  - .worktrees\n  - .claude/worktrees\n  - ../escape\n  - .\n  - apps/../apps/web/dist\n'
run shadows --candidate link/web/dist --candidate dangling --candidate file.txt/x --candidate file.txt \
	--candidate ext/dist --candidate ext --candidate hasgit/dist --candidate vendor/sub --candidate vendor/sub/build \
	--candidate .git/hooks --candidate big/out --candidate .claude/worktrees/x --candidate fresh/a/b
is "guard: a symlinked component" "$(cand link/web/dist guard)" "symlink:link"
is "guard: a dangling symlink leaf" "$(cand dangling guard)" "symlink:dangling"
is "guard: a dangling symlink is reported as one" "$(cand dangling exists)" symlink
is "guard: a file in the way" "$(cand file.txt/x guard)" "not-a-directory:file.txt"
is "guard: a file as the leaf" "$(cand file.txt guard)" "not-a-directory:file.txt"
is "guard: a parent with its own .git file" "$(cand ext/dist guard)" "git-boundary:ext"
is "guard: a leaf with its own .git file" "$(cand ext guard)" "git-boundary:ext"
is "guard: a parent whose .git is a dangling link" "$(cand hasgit/dist guard)" "git-boundary:hasgit"
is "guard: a gitlink" "$(cand vendor/sub guard)" "gitlink:vendor/sub"
is "guard: below a gitlink" "$(cand vendor/sub/build guard)" "gitlink:vendor/sub"
is "guard: a component named .git" "$(cand .git/hooks guard)" "git-boundary:.git"
is "guard: a .git below the leaf" "$(cand big/out guard)" "nested-git:big/out/deep/.git"
is "guard: a path climbing out" "$(cand ../escape guard)" outside-root
is "guard: a path climbing out is asked nothing else" "$(cand ../escape tracked)" "-"
is "guard: git is not asked past a symlink" "$(cand link/web/dist ignored)" "-"
is "guard: the root itself" "$(cand . guard)" is-root
is "guard: a dotted spelling resolves" "$(cand apps/web/dist guard)" ok
is "guard: an unbuilt literal passes" "$(cand fresh/a/b guard)" ok
for w in .worktrees .claude/worktrees .git/worktrees; do
	is "guard: declared $w is pre-authorized" "$(cand "$w" guard)" preauthorized
done
is "guard: only the exact root is pre-authorized" "$(cand .claude/worktrees/x guard)" ok
put .powbox.yml 'shadow: []\n'
run shadows --candidate .git/worktrees --candidate .worktrees
is "guard: an undeclared .git/worktrees is not pre-authorized" "$(cand .git/worktrees guard)" "git-boundary:.git"
is "guard: an undeclared .worktrees is judged like any path" "$(cand .worktrees guard)" ok
mkdir -p "$R/.worktrees"
put .powbox.yml 'shadow:\n  - ".wor*"\n'
run shadows
is "guard: a glob matching .worktrees is seen" "$(cand .worktrees from)" glob
is "guard: and does not pre-authorize it" "$(cand .worktrees guard)" ok
put .powbox.yml 'shadow: []\n'

for n in 1 2 3 4 5 6; do put "many/out/$n"; done
put other/out/1
run shadows --scan-limit 3 --candidate many/out --candidate other/out
is "scan limit: the walk stops and says so" "$(cand many/out guard)" unscanned
is "scan limit: exit is still 0" "$RC" 0
is "scan limit: the budget is shared, so nothing is left for the next" "$(cand other/out guard)" unscanned
run shadows --scan-limit 7 --candidate many/out --candidate other/out
is "scan limit: a walk that just fits is clear" "$(cand many/out guard)" ok
is "scan limit: and leaves the next one nothing" "$(cand other/out guard)" unscanned
run shadows --scan-limit 9 --candidate many/out --candidate other/out
is "scan limit: both fit" "$(cand many/out guard)$(cand other/out guard)" okok
if [ "$(id -u)" != 0 ]; then
	mkdir -p "$R/locked/out/sub" && chmod 000 "$R/locked/out/sub"
	run shadows --candidate locked/out
	is "guard: an unreadable directory is not read as clear" "$(cand locked/out guard)" unscanned
	chmod 755 "$R/locked/out/sub"
fi

# A find that never runs out before any limit used here, and records reaching
# its end: the walk has to be cut off, not merely left uncounted.
mkdir -p "$WORKDIR/findbin"
cat >"$WORKDIR/findbin/find" <<'FAKEFIND'
#!/usr/bin/env bash
START="$1" LEAD="${FAKE_FIND_LEAD:-}" awk 'BEGIN {
	print ENVIRON["START"]
	if (ENVIRON["LEAD"] != "") print ENVIRON["START"] "/" ENVIRON["LEAD"]
	for (i = 0; i < 400000; i++) print ENVIRON["START"] "/f" i
}' || exit
: >"$FAKE/find.finished"
FAKEFIND
chmod +x "$WORKDIR/findbin/find"
endless() { # <FAKE_FIND_LEAD> <probe arguments>
	local lead="$1"
	shift
	rm -f "$FAKE/find.finished"
	OUT="$(cd "$R" && PATH="$WORKDIR/findbin:$PATH" FAKE_FIND_LEAD="$lead" bash "$HELPER" "$@" 2>"$WORKDIR/stderr")"
	RC=$?
}
endless "" shadows --scan-limit 5 --candidate many/out
is "scan limit: an endless tree answers unscanned" "$RC$(cand many/out guard)" 0unscanned
is "scan limit: and the walk is stopped there" "$(ls "$FAKE/find.finished" 2>/dev/null)" ""
endless deep/.git shadows --candidate many/out
is "scan: a nested .git ends the walk, and a find stopped so is no failed scan" "$(cand many/out guard)" "nested-git:many/out/deep/.git"
is "scan: the walk is stopped at the nested .git" "$(ls "$FAKE/find.finished" 2>/dev/null)" ""
endless "" shadows --scan-limit 400001 --candidate many/out
is "scan: the same find read to its end is clear" "$(cand many/out guard)" ok
is "scan: and is seen finishing" "$(ls "$FAKE/find.finished" 2>/dev/null)" "$FAKE/find.finished"

# -------------------------------------------------- the override, both halves --
new_repo
commit .gitignore 'dist/\n.powbox.local.yml\n'
commit .powbox.yml 'shadow:\n  - .worktrees\n  - apps/web/dist # bundler\n  - ./old/dist/\n'
run shadows
is "no local file: none" "$(row override=none)$(row powbox_local_yml=absent)" "override=nonepowbox_local_yml=absent"
is "no local file: effective list" "$(row effective=.powbox.yml)" "effective=.powbox.yml"
is "no local file: ignore state is not asked" "$(row powbox_local_yml_ignored=-)" "powbox_local_yml_ignored=-"
lacks "no local file: yq is not run on it" "$(cat "$FAKE/yq.log")" ".powbox.local.yml"
has "entries are printed as written" "$OUT" "declared=committed${TAB}literal${TAB}./old/dist/"
is "a declared literal that is absent is still a candidate" "$(cand old/dist from)" committed

put .powbox.local.yml 'ctx:\n  - /somewhere\n'
run shadows
is "local without shadow: present" "$(row powbox_local_yml=present)" "powbox_local_yml=present"
is "local without shadow: no override" "$(row override=none)" "override=none"
is "local without shadow: committed list is effective" "$(row effective=.powbox.yml)" "effective=.powbox.yml"
is "local file ignored" "$(row powbox_local_yml_ignored=yes)" "powbox_local_yml_ignored=yes"

put .powbox.local.yml 'shadow: [unclosed\n'
for cmd in shadows worktrees; do
	run "$cmd"
	is "unparseable local ($cmd): exit 0" "$RC" 0
	is "unparseable local ($cmd): reported" "$(row powbox_local_yml=unparseable)" "powbox_local_yml=unparseable"
	is "unparseable local ($cmd): no override" "$(row override=none)$(row effective=.powbox.yml)" "override=noneeffective=.powbox.yml"
done

put .powbox.local.yml 'shadow:\n  - old/dist\n  - data/db\n'
run shadows
is "override: active" "$(row override=active)" "override=active"
is "override: its list is effective" "$(row effective=.powbox.local.yml)" "effective=.powbox.local.yml"
has "override: entries listed" "$OUT" "declared=override${TAB}literal${TAB}data/db"
is "override: its entries are candidates" "$(cand data/db from)" override
is "override: in both lists" "$(cand old/dist from)" "committed,override"
is "override: committed entries stay candidates" "$(cand apps/web/dist from)" committed
is "override: what it drops" "$(printf '%s\n' "$OUT" | grep '^override_drops=' | tr '\n' ' ')" "override_drops=.worktrees override_drops=apps/web/dist "
is "override: what only it holds" "$(printf '%s\n' "$OUT" | grep '^override_only=' | tr '\n' ' ')" "override_only=data/db "

put .powbox.local.yml 'shadow: []\n'
run worktrees
is "an empty override list is well formed" "$RC$(first_line)" "0outcome=probed"
is "an empty override list is active" "$(row override=active)" "override=active"
is "an empty override drops every committed entry" "$(printf '%s\n' "$OUT" | grep -c '^override_drops=')" 3

git -C "$R" rm -q --cached .gitignore && printf 'dist/\n' >"$R/.gitignore" && git -C "$R" add .gitignore
run worktrees
is "local file not ignored" "$(row powbox_local_yml_ignored=no)" "powbox_local_yml_ignored=no"

malformed() { # <label> <file> <yaml>
	local cmd
	put "$2" "$3"
	for cmd in shadows worktrees; do
		run "$cmd"
		is "malformed $1 in $2 ($cmd): exit 3" "$RC" 3
		is "malformed $1 in $2 ($cmd): outcome" "$(first_line)" "outcome=malformed"
		has "malformed $1 in $2 ($cmd): names the file" "$OUT" "malformed=$2$TAB"
		lacks "malformed $1 in $2 ($cmd): no candidates" "$OUT" "candidate="
		lacks "malformed $1 in $2 ($cmd): no roots" "$OUT" "worktree_root="
	done
}
for file in .powbox.local.yml .powbox.yml; do
	new_repo
	commit .gitignore '.powbox.local.yml\n'
	malformed "null" "$file" 'shadow:\n'
	malformed "scalar" "$file" 'shadow: dist\n'
	malformed "mapping" "$file" 'shadow:\n  a: b\n'
	malformed "null entry" "$file" 'shadow:\n  - dist\n  - null\n'
	malformed "collection entry" "$file" 'shadow:\n  - dist\n  - [a, b]\n'
	malformed "mapping entry" "$file" 'shadow:\n  - a: b\n'
	malformed "number entry" "$file" 'shadow:\n  - 3\n'
	malformed "empty entry" "$file" 'shadow:\n  - dist\n  - ""\n'
	malformed "empty entry between others" "$file" 'shadow:\n  - a\n  - ""\n  - b\n'
	malformed "only an empty entry" "$file" 'shadow:\n  - ""\n'
	malformed "multi-line entry" "$file" 'shadow:\n  - "a\\nb"\n'
done
new_repo
malformed "unparseable" .powbox.yml 'shadow: [unclosed\n'
malformed "non-mapping" .powbox.yml '- dist\n'
rm "$R/.powbox.yml" && : >"$R/.powbox.yml"
run shadows
is "an empty .powbox.yml is no list, not an error" "$RC$(row powbox_yml=present)" "0powbox_yml=present"
put .powbox.yml 'ctx:\n  - /x\n'
run worktrees
is "a .powbox.yml without shadow is no list" "$RC$(wroot .worktrees committed)" "0no"

# -------------------------------------------------------------------- globs --
new_repo
commit .gitignore 'dist/\n'
put apps/web/dist/x
put apps/api/dist/x
put apps/cli/dist
put .powbox.yml 'shadow:\n  - apps/*/dist\n  - libs/*/dist\n  - "!apps/skip"\n  - apps/web/dist\n'
run shadows
has "glob: declared as one" "$OUT" "declared=committed${TAB}glob${TAB}apps/*/dist"
has "glob: negation labelled" "$OUT" "declared=committed${TAB}negation${TAB}!apps/skip"
is "glob: matches counted, directories only" "$(row glob=committed)" "glob=committed${TAB}2${TAB}apps/*/dist
glob=committed${TAB}0${TAB}libs/*/dist"
is "glob: a match is a candidate" "$(cand apps/api/dist from)" "glob,ignored"
is "glob: a match also declared literally" "$(cand apps/web/dist from)" "glob,committed,ignored"
is "glob: the pattern itself is never a candidate" "$(row 'candidate=apps/*/dist')" ""
is "glob: a negation is never a candidate" "$(row 'candidate=!apps/skip')" ""

# ------------------------------------------------------------------- mounts --
new_repo
commit .gitignore 'dist/\nnode_modules/\ndata/\n'
put apps/web/dist/x
put data/x
mount apps/web/dist tmpfs
mount node_modules ext4
mount data/uploads tmpfs
mount data/cache tmpfs
printf '%s\ttmpfs\n' "$R-other/dist" >>"$FAKE/mounts"
run shadows
is "mount: an active shadow" "$(cand apps/web/dist mount)" tmpfs
is "mount: a volume, not a shadow" "$(cand node_modules mount)" ext4
is "mount: none" "$(cand data mount)" none
is "mount: mounts below are counted" "$(cand data below)" 2
is "mount: none below" "$(cand apps/web/dist below)" 0
is "mount: every live mount under the root, and no other" "$(printf '%s\n' "$OUT" | grep '^mounted=' | LC_ALL=C sort | tr '\n' ' ')" "mounted=apps/web/dist${TAB}tmpfs mounted=data/cache${TAB}tmpfs mounted=data/uploads${TAB}tmpfs mounted=node_modules${TAB}ext4 "
# A mount table that cannot be read is not an empty one.
: >"$FAKE/findmnt-fails"
run shadows
is "mount: an unreadable mount table is not fatal" "$RC$(first_line)" "0outcome=probed"
is "mount: and no mount fact is claimed" "$(cand apps/web/dist mount) $(cand data mount) $(cand data below)" "unknown unknown -"
lacks "mount: nor any live mount listed" "$OUT" "mounted="
has "mount: and it is explained" "$(cat "$WORKDIR/stderr")" "findmnt could not list the mounts"
rm "$FAKE/findmnt-fails"

# ------------------------------------------------------------------ derived --
new_repo
commit .gitignore 'node_modules/\ndist/\nbin/\n'
put packages/a/node_modules/x
put apps/web/dist/x
put apps/api/dist/x
put .powbox.yml 'shadow:\n  - apps/web/dist\n  - apps/a*/dist\n'
printf '%s\n' packages/a/node_modules src/App/bin apps/web/dist apps/api/dist >"$FAKE/detect"
run shadows
is "derived: a manifest-derived path on disk" "$(cand packages/a/node_modules derived)" yes
is "derived: listed, built or not" "$(printf '%s\n' "$OUT" | grep '^derived=' | tr '\n' ' ')" "derived=packages/a/node_modules derived=src/App/bin "
is "derived: a declared literal is not" "$(cand apps/web/dist derived)" no
is "derived: a declared glob's match is not" "$(cand apps/api/dist derived)" no
: >"$FAKE/detect-fails"
run shadows
is "derived: a failing detector is not fatal" "$RC" 0
is "derived: and leaves the question open" "$(cand packages/a/node_modules derived) $(cand apps/web/dist derived)" "unknown unknown"
lacks "derived: and lists no derived path" "$OUT" "${NL}derived="
has "derived: and is explained" "$(cat "$WORKDIR/stderr")" "detect-shadows.sh failed"

# -------------------------------------------------------------------- limit --
new_repo
commit .gitignore 'dist/\n'
for n in 1 2 3 4; do put "p$n/dist/x"; done
put .powbox.yml 'shadow:\n  - declared/one\n'
run shadows --limit 2
is "limit: exit 3" "$RC" 3
is "limit: incomplete" "$(first_line)" "outcome=incomplete"
is "limit: stated" "$(row limit=2)" "limit=2"
is "limit: no more candidates than asked" "$(printf '%s\n' "$OUT" | grep -c '^candidate=')" 2
is "limit: the declared entry comes first" "$(cand declared/one from)" committed
run shadows --limit 5
is "limit: exactly enough is complete" "$RC$(first_line)" "0outcome=probed"

# ---------------------------------------------------------------- worktrees --
new_repo
commit .gitignore '.worktrees\n.claude/worktrees/\n'
commit .powbox.yml 'shadow:\n  - .worktrees/\n  - ./.claude/worktrees\n  - .git/worktrees\n  - apps/web/dist\n'
mount .worktrees ext4
mount .claude/worktrees tmpfs
mount .git/worktrees ext4
run worktrees
is "ready: exit 0" "$RC$(first_line)" "0outcome=probed"
for w in .worktrees .claude/worktrees .git/worktrees; do
	is "ready: $w committed, in any spelling" "$(wroot "$w" committed)" yes
	is "ready: $w effective" "$(wroot "$w" effective)" yes
	is "ready: $w is a mountpoint" "$(wroot "$w" mountpoint)" yes
done
is "ready: an entry without the slash ignores the root" "$(wroot .worktrees ignored)" shared
is "ready: rule shown" "$(wroot .claude/worktrees rule)" ".gitignore:2:.claude/worktrees/"
is "ready: .git/worktrees needs no ignore rule" "$(wroot .git/worktrees ignored)$(wroot .git/worktrees tracked)" "--"
is "ready: nothing tracked" "$(wroot .worktrees tracked)" 0
is "ready: filesystems" "$(wroot .worktrees fs) $(wroot .claude/worktrees fs) $(wroot .git/worktrees fs)" "ext4 tmpfs ext4"
is "ready: healthy" "$(row mounts=healthy)" "mounts=healthy"
lacks "ready: no complaint" "$OUT" "unhealthy="
lacks "the probe never calls the mounting or pruning helpers" "$(cat "$FAKE/forbidden.log" 2>/dev/null)" "s"

remount() { # <.worktrees fs|-> <.claude/worktrees fs|-> <.git/worktrees fs|->
	rm -f "$FAKE/mounts"
	[ "$1" = - ] || mount .worktrees "$1"
	[ "$2" = - ] || mount .claude/worktrees "$2"
	[ "$3" = - ] || mount .git/worktrees "$3"
	run worktrees
}
complaints() { printf '%s\n' "$OUT" | grep '^unhealthy=' | tr '\n' ' '; }
remount tmpfs tmpfs tmpfs
is "volume-less fallback (all tmpfs) is healthy" "$(row mounts=healthy)" "mounts=healthy"
remount ext4 - ext4
is "an unmounted harness root" "$(complaints)" "unhealthy=.claude/worktrees${TAB}not-a-mountpoint "
is "an unmounted root is unhealthy" "$(row mounts=unhealthy)" "mounts=unhealthy"
is "an unmounted root still names the filesystem holding it" "$(wroot .claude/worktrees mountpoint) $(wroot .claude/worktrees fs)" "no overlay"
remount ext4 ext4 ext4
is "a harness root that is not tmpfs" "$(complaints)" "unhealthy=.claude/worktrees${TAB}expected-tmpfs "
remount ext4 tmpfs tmpfs
is "metadata on tmpfs beside a persistent volume" "$(complaints)" "unhealthy=.git/worktrees${TAB}not-durable "
for hostfs in 9p drvfs virtiofs; do
	remount "$hostfs" tmpfs "$hostfs"
	is "a $hostfs worktree root" "$(complaints)" "unhealthy=.worktrees${TAB}host-filesystem "
done
remount - - -
is "nothing mounted names all three" "$(complaints)" "unhealthy=.worktrees${TAB}not-a-mountpoint unhealthy=.claude/worktrees${TAB}not-a-mountpoint unhealthy=.git/worktrees${TAB}not-a-mountpoint "

put .powbox.local.yml 'shadow:\n  - .worktrees\n  - data/db\n'
run worktrees
is "override: the root it carries" "$(wroot .worktrees override)$(wroot .worktrees effective)" yesyes
is "override: the root it lacks is not effective" "$(wroot .claude/worktrees committed)$(wroot .claude/worktrees override)$(wroot .claude/worktrees effective)" yesnono
is "override: the committed entries it drops" "$(printf '%s\n' "$OUT" | grep '^override_drops=' | tr '\n' ' ')" "override_drops=.claude/worktrees override_drops=.git/worktrees override_drops=apps/web/dist "
is "override: what retiring it would stop declaring" "$(row override_only=data/db)" "override_only=data/db"
rm "$R/.powbox.local.yml"

new_repo
commit .powbox.yml 'shadow:\n  - .work*\n  - .claude/*\n'
put .git/info/exclude '.worktrees/\n'
commit .worktrees/t1/leak.txt 'x\n'
commit .worktrees/t1/more.txt 'x\n'
run worktrees
is "a glob does not declare a root" "$(wroot .worktrees committed)$(wroot .claude/worktrees committed)" nono
is "a rule teammates lack is unshared" "$(wroot .worktrees ignored)" unshared
is "leaked tracking is counted" "$(wroot .worktrees tracked)" 2
is "no leak under the other root" "$(wroot .claude/worktrees tracked)" 0

new_repo
commit .gitignore '.worktrees/\n'
git -C "$R" worktree add -q "$R/.worktrees/linked" -b side
mount .worktrees/linked/.worktrees ext4
OUT="$(cd "$R/.worktrees/linked" && bash "$HELPER" worktrees 2>/dev/null)"
is "a linked worktree says so" "$(row checkout=linked)" "checkout=linked"
is "a linked worktree gets no mount verdict" "$(row mounts=unknown)" "mounts=unknown"
lacks "a linked worktree gets no complaint" "$OUT" "unhealthy="

# ---------------------------------------------------- the probe only reads --
new_repo
commit .gitignore 'dist/\n.turbo/\n.worktrees/\n.claude/worktrees/\n.powbox.local.yml\n'
commit .powbox.yml 'shadow:\n  - .worktrees\n  - apps/*/dist\n  - gen\n'
commit gen/a.txt 'x\n'
put .powbox.local.yml 'shadow:\n  - .worktrees\n  - data\n'
put apps/web/dist/x
put .turbo/cache/x
put untracked.txt
printf 'changed\n' >"$R/README"
ln -s apps "$R/link"
mount apps/web/dist tmpfs
printf '%s\n' apps/web/node_modules >"$FAKE/detect"
rm -f "$FAKE/forbidden.log"
before="$(snapshot "$R")"
status_before="$(git -C "$R" --no-optional-locks status --porcelain --ignored)"
run shadows --candidate link/x --candidate fresh
is "read-only: shadows ran" "$RC" 0
run worktrees
is "read-only: worktrees ran" "$RC" 0
OUT="$(cd "$R" && PATH="$NOTOOLS" bash "$HELPER" shadows 2>/dev/null)"
is "read-only: git status is unchanged" "$(git -C "$R" --no-optional-locks status --porcelain --ignored)" "$status_before"
is "read-only: every byte, mode and timestamp is unchanged, .git included" "$(snapshot "$R")" "$before"
put .powbox.yml 'shadow: 3\n'
before="$(snapshot "$R")"
run shadows
is "read-only: the malformed stop ran" "$RC" 3
is "read-only: a stopped run changes nothing either" "$(snapshot "$R")" "$before"
new_repo
commit .gitignore 'dist/\n'
commit .powbox.yml 'shadow:\n  - dist\n'
put dist/x
before="$(snapshot "$R")"
run shadows
run worktrees
is "read-only: a plain declared repository is unchanged too" "$(snapshot "$R")" "$before"
is "read-only: no temporary file is left or made" "$(ls -A "$EMPTYTMP")" ""
is "read-only: the mounting and pruning helpers were never run" "$(cat "$FAKE/forbidden.log" 2>/dev/null)" ""

# -------------------------------------------------------- git cannot answer --
new_repo
commit .gitignore 'dist/\n'
put dist/x
printf 'garbage' >"$R/.git/index"
for cmd in shadows worktrees; do
	run "$cmd"
	is "a broken index fails $cmd" "$RC" 1
	is "a broken index prints no answer for $cmd" "$OUT" ""
done

# A git that refuses one kind of question, to tell "nothing there" from "no answer".
REAL_GIT="$(command -v git)"
export REAL_GIT
mkdir -p "$WORKDIR/gitbin"
cat >"$WORKDIR/gitbin/git" <<'FAKEGIT'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$FAKE/git.log"
case " $* " in *" $FAKE_GIT_REFUSES "*) exit 128 ;; esac
exec "$REAL_GIT" "$@"
FAKEGIT
chmod +x "$WORKDIR/gitbin/git"
new_repo
commit .gitignore 'dist/\n.worktrees/\n'
refused() { # <label> <argument git refuses> <probe arguments>
	local label="$1" refuses="$2"
	shift 2
	OUT="$(cd "$R" && PATH="$WORKDIR/gitbin:$PATH" FAKE_GIT_REFUSES="$refuses" bash "$HELPER" "$@" 2>/dev/null)"
	is "$label: exit 1" "$?" 1
	is "$label: no answer printed" "$OUT" ""
}
refused "the ignored listing fails" --ignored shadows
refused "the index listing fails" --stage shadows
refused "the ignore question fails for a candidate" check-ignore shadows --candidate apps/web/dist
refused "the tracked question fails for a candidate" --literal-pathspecs shadows --candidate apps/web/dist
refused "the .gitignore listing fails" ":(glob)**/.gitignore" shadows
refused "the ignore question fails for a root" check-ignore worktrees
refused "the tracked question fails for a root" --literal-pathspecs worktrees
put .powbox.local.yml 'ctx: 1\n'
refused "the local file's ignore question fails" -q worktrees
rm "$R/.powbox.local.yml"
put dist/x
refused "the ignore question fails for a listed folder" check-ignore shadows
OUT="$(cd "$R" && PATH="$WORKDIR/gitbin:$PATH" FAKE_GIT_REFUSES=nothing-at-all bash "$HELPER" shadows 2>/dev/null)"
is "the refusing git is otherwise the real one" "$?" 0
# The probe's promise not to take a lock rests on which git commands it runs.
is "git is asked only read-only questions" "$(awk '{ for (i = 1; i <= NF; i++) if ($i !~ /^-/ && $i != ENVIRON["R"] && !(i > 1 && $(i - 1) == "-C")) { print $i; break } }' "$FAKE/git.log" | LC_ALL=C sort -u | tr '\n' ' ')" "check-ignore hash-object ls-files rev-parse "

printf '%s checks, %s failed\n' "$checks" "$fails"
[ "$fails" = 0 ]
