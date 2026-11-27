#!/usr/bin/env bash
# Hermetic test for the address-tasks skill's bundled `bootstrap.sh`: real git
# in throwaway repositories, no network, and a PATH built from symlinks so that
# `wt-bootstrap`, `findmnt`, `df` and `jq` are each present, absent or faked as
# a case needs, whatever the machine running this carries.
# `BOOTSTRAP_HELPER` points the suite at another copy of the script (a mutant,
# say).
set -u

ROOT="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SHIPPED="$ROOT/plugins/dev-skills/skills/address-tasks/bootstrap.sh"
MIRROR="$ROOT/codex/dev-skills/skills/address-tasks/bootstrap.sh"
SHIM="$ROOT/plugins/dev-skills/bin/address-tasks-bootstrap"
WORKFLOWS="$ROOT/plugins/dev-skills/workflows"
HELPER="${BOOTSTRAP_HELPER:-$SHIPPED}"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/bootstrap-test.XXXXXX")" || exit 1
WORKDIR="$(cd "$WORKDIR" && pwd -P)"
trap 'rm -rf "$WORKDIR"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
# A real file rather than /dev/null, so a write to the user's configuration shows.
printf '[user]\n\tname = t\n' >"$WORKDIR/gitconfig"
cp "$WORKDIR/gitconfig" "$WORKDIR/gitconfig.orig"
export GIT_CONFIG_GLOBAL="$WORKDIR/gitconfig" GIT_CONFIG_SYSTEM=/dev/null
unset CONTAINER_NAME POWBOX_SELF_HOSTED GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE

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
		printf '      unwanted: %s\n      got:      %s\n' "$3" "$2" >&2
		;;
	*) ok "$1" 0 ;; esac
}
absent() { # <label> <path>
	if [ -e "$2" ]; then ok "$1" 1; else ok "$1" 0; fi
}
present() { # <label> <path>
	if [ -e "$2" ]; then ok "$1" 0; else ok "$1" 1; fi
}
is() { # <label> <actual> <expected>
	if [ "$2" = "$3" ]; then ok "$1" 0; else
		ok "$1" 1
		printf '      wanted: %s\n      got:    %s\n' "$3" "$2" >&2
	fi
}

# ---------------------------------------------------------------- the PATHs --
# TOOLS holds what the script needs and nothing optional; the directories
# stacked in front of it add one fake or one optional tool each.
TOOLS="$WORKDIR/tools"
mkdir -p "$TOOLS" "$WORKDIR/with-jq" "$WORKDIR/fake-findmnt" "$WORKDIR/fake-df" "$WORKDIR/fake-helper"
for tool in bash git awk sed grep tail wc tr dirname mktemp rm mkdir rmdir cat df env readlink; do
	real="$(command -v "$tool")" || {
		echo "this suite needs $tool on PATH" >&2
		exit 1
	}
	ln -s "$real" "$TOOLS/$tool"
done
ln -s "$(command -v jq)" "$WORKDIR/with-jq/jq" || {
	echo "this suite needs jq on PATH" >&2
	exit 1
}
cat >"$WORKDIR/fake-findmnt/findmnt" <<'FAKE'
#!/usr/bin/env bash
type="$(cat "$FAKE_STATE/fstype")"
[ "$type" != FAIL ] || { echo "findmnt: no such mount" >&2; exit 1; }
printf '%s\n' "$type"
FAKE
cat >"$WORKDIR/fake-df/df" <<'FAKE'
#!/usr/bin/env bash
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
printf 'fake 100 1 %s 1%% /\n' "$(cat "$FAKE_STATE/df")"
FAKE
cat >"$WORKDIR/fake-helper/wt-bootstrap" <<'FAKE'
#!/usr/bin/env bash
echo called >>"$FAKE_STATE/helper-calls"
echo "helper diagnostic" >&2
cat "$FAKE_STATE/helper-json"
exit "$(cat "$FAKE_STATE/helper-rc")"
FAKE
chmod +x "$WORKDIR/fake-findmnt/findmnt" "$WORKDIR/fake-df/df" "$WORKDIR/fake-helper/wt-bootstrap"
export FAKE_STATE="$WORKDIR/state"
mkdir -p "$FAKE_STATE"
echo ext4 >"$FAKE_STATE/fstype"

P_BARE="$TOOLS"                                       # no findmnt, no jq, no helper
P_GIT="$WORKDIR/fake-findmnt:$WORKDIR/with-jq:$TOOLS" # the plain-git path
P_HELPER="$WORKDIR/fake-helper:$P_GIT"                # the wt-bootstrap path
USE="$P_GIT"

n=0
fresh() { # → R, a new repository with one commit and a subdirectory
	n=$((n + 1))
	R="$WORKDIR/repo$n"
	git init -q -b main "$R"
	mkdir "$R/sub"
	echo x >"$R/sub/f"
	git -C "$R" add sub/f
	git -C "$R" commit -q -m init
	DIR="$R"
}
call() { # [args...] → OUT (stdout), ERR (stderr), RC; run from $DIR on PATH $USE
	OUT="$(cd "$DIR" && PATH="$USE" bash "$HELPER" "$@" 2>"$WORKDIR/err")"
	RC=$?
	ERR="$(cat "$WORKDIR/err")"
}
val() { printf '%s\n' "$OUT" | sed -n "s/^$1=//p" | head -n 1; }
first() { printf '%s\n' "$OUT" | head -n 1; }
rules() { grep -c -Fx -- '/.worktrees/' "$1" 2>/dev/null || true; }
# Every place the acceptance criteria name: git itself, asked from each.
ignored_everywhere() { # <label> [<linked worktree>]
	git -C "$R" check-ignore -q .worktrees/
	ok "$1: ignored, asked from the primary checkout" $?
	(cd "$R/sub" && git check-ignore -q "$R/.worktrees/")
	ok "$1: ignored, asked from a subdirectory" $?
	if [ -n "${2:-}" ]; then
		git -C "$2" check-ignore -q .worktrees/
		ok "$1: ignored, asked from a linked worktree" $?
	fi
}
clean() { is "$1: the checkout is left clean" "$(git -C "$R" status --porcelain --untracked-files=all)" ""; }

# ------------------------------------------------------------------- usage --
fresh
call
is "usage: no command is a usage error" "$RC" 64
is "usage: ...with nothing on stdout" "$OUT" ""
call frobnicate
is "usage: an unknown command is a usage error" "$RC" 64
call run ignore
is "usage: two commands is a usage error" "$RC" 64
call ignore --require-helper
is "usage: --require-helper on ignore is a usage error" "$RC" 64
call -C
is "usage: -C with no directory is a usage error" "$RC" 64
is "usage: none of them wrote an ignore rule" "$(rules "$R/.git/info/exclude")" 0
call --help
is "usage: --help exits 0" "$RC" 0
has "usage: ...printing the contract" "$OUT" "outcome=stop"
has "usage: ...from its first line" "$(first)" "bootstrap.sh"
DIR="$WORKDIR"
call ignore
is "usage: outside a repository is a failure" "$RC" 1
is "usage: ...with nothing on stdout" "$OUT" ""

# ----------------------------------------------------- ignore: where it lands --
fresh
call ignore
is "primary: ready" "$RC" 0
is "primary: outcome first" "$(first)" "outcome=ready"
is "primary: the rule was added" "$(val ignore)" added
is "primary: the base is the main checkout's .worktrees" "$(val wt-base)" "$R/.worktrees"
is "primary: listed once in the repo-local exclude" "$(rules "$R/.git/info/exclude")" 1
ignored_everywhere primary
clean primary
absent "primary: no tracked .gitignore was created" "$R/.gitignore"
absent "primary: ignore alone creates no directory" "$R/.worktrees"
lacks "primary: ignore alone reports nothing of the rest" "$OUT" "remote="
call ignore
is "primary: a second run finds it present" "$(val ignore)" present
is "primary: ...and lists nothing twice" "$(rules "$R/.git/info/exclude")" 1

fresh
DIR="$R/sub"
call ignore
is "subdirectory: ready" "$RC" 0
is "subdirectory: the base is still the main checkout's" "$(val wt-base)" "$R/.worktrees"
is "subdirectory: the rule is in the main checkout's exclude" "$(rules "$R/.git/info/exclude")" 1
absent "subdirectory: nothing was written beside the caller" "$R/sub/.git"
ignored_everywhere subdirectory
clean subdirectory

fresh
LW="$WORKDIR/linked$n"
git -C "$R" worktree add -q -b side "$LW"
DIR="$LW"
call ignore
is "linked worktree: ready" "$RC" 0
is "linked worktree: the base is the main checkout's, not the worktree's" "$(val wt-base)" "$R/.worktrees"
is "linked worktree: the rule is in the shared exclude" "$(rules "$R/.git/info/exclude")" 1
ignored_everywhere "linked worktree" "$LW"
clean "linked worktree"
is "linked worktree: its own tree is left clean too" "$(git -C "$LW" status --porcelain --untracked-files=all)" ""

fresh
DIR="$WORKDIR"
call -C "$R/sub" ignore
is "-C: answers for the directory named" "$(val wt-base)" "$R/.worktrees"
is "-C: ...and writes there" "$(rules "$R/.git/info/exclude")" 1

fresh
DIR="$R"
OUT="$(cd "$DIR" && CONTAINER_NAME=box PATH="$USE" bash "$HELPER" ignore 2>/dev/null)"
is "CONTAINER_NAME: the base is its subdirectory" "$(val wt-base)" "$R/.worktrees/box"
is "CONTAINER_NAME: the rule added is still the one root-anchored name" "$(rules "$R/.git/info/exclude")" 1
ignored_everywhere CONTAINER_NAME

# ------------------------------------------------------ ignore: the rule itself --
# A rule already in the tracked .gitignore, and no directory on disk: only the
# trailing slash gets a yes out of git here.
fresh
echo '/.worktrees/' >"$R/.gitignore"
git -C "$R" add .gitignore
git -C "$R" commit -q -m ignore
call ignore
is "tracked rule: ready" "$RC" 0
is "tracked rule: found present with no directory on disk" "$(val ignore)" present
is "tracked rule: nothing appended" "$(rules "$R/.git/info/exclude")" 0
clean "tracked rule"

fresh
printf '*.log' >"$R/.git/info/exclude"
call ignore
is "no final newline: the rule gets a line of its own" "$(rules "$R/.git/info/exclude")" 1
is "no final newline: ...and the line before it survives" "$(grep -c -Fx -- '*.log' "$R/.git/info/exclude")" 1

fresh
rm -f "$R/.git/info/exclude"
rmdir "$R/.git/info"
call ignore
is "no info directory: ready" "$RC" 0
is "no info directory: created and written" "$(rules "$R/.git/info/exclude")" 1

# A tracked negation outranks the exclude file, so the rule cannot take.
fresh
echo '!/.worktrees/' >"$R/.gitignore"
git -C "$R" add .gitignore
git -C "$R" commit -q -m negate
call ignore
is "un-ignored: a stop" "$RC" 3
is "un-ignored: outcome first" "$(first)" "outcome=stop"
has "un-ignored: the blocker says what is wrong" "$(val blocker)" "still not ignored"
is "un-ignored: the base is named" "$(val wt-base)" "$R/.worktrees"
lacks "un-ignored: no claim that it was added" "$OUT" "ignore="
is "un-ignored: the tracked .gitignore is untouched" "$(cat "$R/.gitignore")" '!/.worktrees/'
clean un-ignored
call ignore
is "un-ignored: a second run stops again" "$RC" 3
is "un-ignored: ...without listing the rule twice" "$(rules "$R/.git/info/exclude")" 1

B="$WORKDIR/bare.git"
git init -q --bare "$B"
DIR="$B"
call ignore
is "bare: no main checkout is a stop" "$RC" 3
has "bare: ...saying so" "$(val blocker)" "cannot find the main checkout"

# ------------------------------------------------------------- run, plain git --
ORIGIN="$WORKDIR/origin.git"
git init -q --bare "$ORIGIN"

fresh
git -C "$R" remote add origin "$ORIGIN"
git -C "$R" push -q origin main
call run
is "git: ready" "$RC" 0
is "git: outcome first" "$(first)" "outcome=ready"
is "git: says which path answered" "$(val via)" git
is "git: the base" "$(val wt-base)" "$R/.worktrees"
is "git: the rule was added" "$(val ignore)" added
is "git: origin answered" "$(val remote)" yes
is "git: the filesystem is named" "$(val fstype)" ext4
case "$(val avail-bytes)" in '' | *[!0-9]* | 0) ok "git: free space is a positive figure" 1 ;; *) ok "git: free space is a positive figure" 0 ;; esac
present "git: the base exists afterwards" "$R/.worktrees"
ignored_everywhere git
clean git
absent "git: no tracked .gitignore was created" "$R/.gitignore"
cmp -s "$WORKDIR/gitconfig" "$WORKDIR/gitconfig.orig"
ok "git: the user's git configuration is untouched" $?
call run
is "git: a second run is ready" "$RC" 0
is "git: ...and finds the rule present" "$(val ignore)" present

echo 2048 >"$FAKE_STATE/df"
USE="$WORKDIR/fake-df:$P_GIT"
call run
is "git: free space is df's kilobytes as bytes" "$(val avail-bytes)" 2097152
echo 0 >"$FAKE_STATE/df"
call run
is "git: a zero reading is unknown, not a figure" "$(val avail-bytes)" unknown
echo n/a >"$FAKE_STATE/df"
call run
is "git: an unreadable figure is unknown" "$(val avail-bytes)" unknown
is "git: ...and not a failure" "$RC" 0
USE="$P_GIT"

fresh
call run
is "git: no origin is remote=no" "$(val remote)" no
is "git: ...and still ready" "$RC" 0
git -C "$R" remote add origin "$WORKDIR/nowhere.git"
call run
is "git: an origin that does not answer is remote=no" "$(val remote)" no

# No remote named origin, and a repository in a directory of that name: the
# probe must not take the directory for the remote.
fresh
git init -q --bare "$R/origin"
call run
is "git: a directory named origin is not the remote" "$(val remote)" no

fresh
OUT="$(cd "$R" && CONTAINER_NAME=box PATH="$USE" bash "$HELPER" run 2>/dev/null)"
is "git: CONTAINER_NAME scopes the base" "$(val wt-base)" "$R/.worktrees/box"
present "git: ...and that is the directory created" "$R/.worktrees/box"

fresh
git -C "$R" worktree add -q -b gone "$WORKDIR/gone$n"
rm -rf "$WORKDIR/gone$n"
call run
lacks "git: a registration whose directory is gone is pruned" "$(git -C "$R" worktree list)" "gone$n"

N="$WORKDIR/new
line"
git init -q -b main "$N"
DIR="$N"
call ignore
is "a repository path holding a newline is a failure" "$RC" 1
is "...with nothing on stdout" "$OUT" ""

# Leftovers under the base: empty goes, content stays and is named, anything
# registered (or holding something registered) is not mentioned at all.
fresh
call run
mkdir "$R/.worktrees/empty" "$R/.worktrees/full"
echo work >"$R/.worktrees/full/notes"
git -C "$R" worktree add -q -b live "$R/.worktrees/live"
git -C "$R" worktree add -q -b inner "$R/.worktrees/group/inner"
mkdir "$WORKDIR/elsewhere"
ln -s "$WORKDIR/elsewhere" "$R/.worktrees/link"
call run
is "orphans: ready" "$RC" 0
has "orphans: an empty leftover is removed" "$OUT" "pruned=empty"
absent "orphans: ...really" "$R/.worktrees/empty"
has "orphans: a leftover with content is named" "$OUT" "orphan=full"
is "orphans: ...and its content is still there" "$(cat "$R/.worktrees/full/notes")" work
lacks "orphans: a registered worktree is not mentioned" "$OUT" "=live"
lacks "orphans: a directory holding a registered worktree is not mentioned" "$OUT" "=group"
present "orphans: a registered worktree survives" "$R/.worktrees/live/.git"
present "orphans: ...and so does one further down" "$R/.worktrees/group/inner/.git"
lacks "orphans: a symlink is neither removed nor reported" "$OUT" "=link"
present "orphans: ...and still there" "$R/.worktrees/link"
clean orphans

fresh
echo 9p >"$FAKE_STATE/fstype"
call run
is "host share: a stop" "$RC" 3
has "host share: naming the filesystem" "$(val blocker)" "host-shared filesystem (9p)"
is "host share: no rule was written on the way out" "$(rules "$R/.git/info/exclude")" 0
absent "host share: no base was created" "$R/.worktrees"
for type in drvfs virtiofs; do
	echo "$type" >"$FAKE_STATE/fstype"
	call run
	is "host share: $type is refused too" "$RC" 3
done
call ignore
is "host share: ignore alone does not read the filesystem" "$RC" 0
echo FAIL >"$FAKE_STATE/fstype"
fresh
call run
is "findmnt failing is a failure, not an unknown" "$RC" 1
is "...with nothing on stdout" "$OUT" ""
is "...and nothing written" "$(rules "$R/.git/info/exclude")" 0
echo ext4 >"$FAKE_STATE/fstype"

fresh
USE="$P_BARE"
call run
is "no findmnt: ready" "$RC" 0
is "no findmnt: the filesystem is unknown, and said to be" "$(val fstype)" unknown
is "no findmnt, no jq: the plain-git path needs neither" "$(val via)" git

fresh
USE="$P_GIT"
call run --require-helper
is "--require-helper: a missing wt-bootstrap is a stop" "$RC" 3
has "--require-helper: ...saying so" "$(val blocker)" "wt-bootstrap is not on PATH"
is "--require-helper: no rule was written on the way out" "$(rules "$R/.git/info/exclude")" 0
absent "--require-helper: no base was created" "$R/.worktrees"

# ----------------------------------------------------------- run, wt-bootstrap --
helper() { # <exit status> <json>
	echo "$1" >"$FAKE_STATE/helper-rc"
	printf '%s\n' "$2" >"$FAKE_STATE/helper-json"
	: >"$FAKE_STATE/helper-calls"
}
USE="$P_HELPER"

fresh
helper 0 "{\"ok\":true,\"wtBase\":\"$R/.worktrees/box/\",\"remote\":true,\"availBytes\":123456,\"prunedOrphans\":[\"a\",\"b\"],\"quarantinedOrphans\":[\"c\"]}"
call run --require-helper
is "helper: ready" "$RC" 0
is "helper: outcome first" "$(first)" "outcome=ready"
is "helper: says which path answered" "$(val via)" wt-bootstrap
is "helper: its base, without the trailing slash" "$(val wt-base)" "$R/.worktrees/box"
is "helper: the rule it does not establish was added" "$(val ignore)" added
is "helper: ...in the exclude file" "$(rules "$R/.git/info/exclude")" 1
is "helper: remote" "$(val remote)" yes
is "helper: free space" "$(val avail-bytes)" 123456
has "helper: pruned orphans, one per line" "$OUT" "pruned=a
pruned=b"
has "helper: quarantined orphans" "$OUT" "quarantined=c"
lacks "helper: no plain-git keys" "$OUT" "fstype="
has "helper: its diagnostics reach stderr" "$ERR" "helper diagnostic"
is "helper: called once" "$(wc -l <"$FAKE_STATE/helper-calls" | tr -d ' ')" 1
ignored_everywhere helper
clean helper

helper 0 "{\"ok\":true,\"wtBase\":\"$R/.worktrees/box\",\"remote\":false,\"availBytes\":0,\"prunedOrphans\":[],\"quarantinedOrphans\":[]}"
call run
is "helper: remote false is remote=no, and ready" "$(val remote):$RC" "no:0"
is "helper: a zero reading is unknown" "$(val avail-bytes)" unknown
is "helper: the rule is present the second time" "$(val ignore)" present
lacks "helper: no orphan lines for empty lists" "$OUT" "pruned="

: >"$FAKE_STATE/helper-calls"
call ignore
is "helper: ignore alone does not call it" "$(wc -l <"$FAKE_STATE/helper-calls" | tr -d ' ')" 0

fresh
helper 1 '{"ok":false,"blocker":"unsafe worktree root (not a mountpoint): /x/.worktrees — run enable-worktrees"}'
call run
is "helper blocker: a stop" "$RC" 3
is "helper blocker: passed on verbatim" "$(val blocker)" "unsafe worktree root (not a mountpoint): /x/.worktrees — run enable-worktrees"
is "helper blocker: no rule was written on the way out" "$(rules "$R/.git/info/exclude")" 0
helper 0 '{"ok":false,"blocker":"refused"}'
call run
is "helper blocker: ok false stops whatever the exit status" "$RC" 3
helper 1 '{"ok":false}'
call run
is "helper blocker: a missing blocker is still a stop" "$RC" 3
has "helper blocker: ...and says it was missing" "$(val blocker)" "named no blocker"

helper 1 '{"ok":false,"blocker":"first line\nsecond line"}'
call run
is "helper blocker: a blocker of two lines is carried on one" "$(val blocker)" "first line second line"
is "helper blocker: ...leaving two lines of answer" "$(printf '%s\n' "$OUT" | wc -l | tr -d ' ')" 2

helper 1 "{\"ok\":true,\"wtBase\":\"$R/.worktrees/box\"}"
call run
is "helper contract: ok with a failing exit is a failure" "$RC" 1
is "helper contract: ...with nothing on stdout" "$OUT" ""
helper 0 'Segmentation fault'
call run
is "helper contract: an answer that is not JSON is a failure" "$RC" 1
is "helper contract: ...with nothing on stdout" "$OUT" ""
helper 0 '{"ok":"yes"}'
call run
is "helper contract: ok that is not a boolean is a failure" "$RC" 1
helper 0 '{"ok":true,"wtBase":".worktrees/box"}'
call run
is "helper contract: a relative base is a failure" "$RC" 1
helper 0 '{"ok":true}'
call run
is "helper contract: ok with no base is a failure" "$RC" 1
helper 0 '{"ok":true,"wtBase":"/somewhere/else/entirely"}'
call run
is "helper contract: a base git cannot answer for is a failure" "$RC" 1
is "helper contract: none of those wrote a rule" "$(rules "$R/.git/info/exclude")" 0

helper 0 "{\"ok\":true,\"wtBase\":\"$R/.worktrees/box\"}"
USE="$WORKDIR/fake-helper:$WORKDIR/fake-findmnt:$TOOLS"
call run
is "helper without jq: a stop" "$RC" 3
has "helper without jq: ...saying so" "$(val blocker)" "jq not found"
USE="$P_GIT"

# --------------------------------------------------------------- as shipped --
cmp -s "$SHIPPED" "$MIRROR"
ok "shipped: the two mirrors are byte-identical" $?
for path in plugins/dev-skills/skills/address-tasks/bootstrap.sh codex/dev-skills/skills/address-tasks/bootstrap.sh plugins/dev-skills/bin/address-tasks-bootstrap; do
	is "shipped: $path is committed executable" "$(git -C "$ROOT" ls-files -s -- "$path" | cut -c1-6)" 100755
done
fresh
OUT="$(cd "$R" && PATH="$USE" bash "$SHIM" ignore 2>/dev/null)"
is "shim: forwards to the bundled script" "$(first):$(val ignore)" "outcome=ready:added"
LINK="$WORKDIR/linked-shim"
ln -s "$SHIM" "$LINK"
OUT="$(cd "$R" && PATH="$USE" bash "$LINK" ignore 2>/dev/null)"
is "shim: forwards through a symlink to itself" "$(val ignore)" present

# The workflows' briefs name the shim's commands; run each as written, so a
# brief that drifts to a spelling the script rejects fails here. A workflow
# naming no command at all is a failure: it would be stating the recipe again.
for wf in wf-address-tasks.js wf-address-review.js; do
	found=0
	while IFS= read -r command; do
		[ -n "$command" ] || continue
		found=$((found + 1))
		fresh
		# shellcheck disable=SC2086 # the brief's own words, split as a shell would
		OUT="$(cd "$R" && PATH="$USE" bash "$SHIM" ${command#address-tasks-bootstrap } 2>/dev/null)"
		RC=$?
		case "$command" in
		*--require-helper*) is "$wf: \`$command\` runs as written (a stop here, there being no helper)" "$RC:$(first)" "3:outcome=stop" ;;
		*) is "$wf: \`$command\` runs as written" "$RC:$(first)" "0:outcome=ready" ;;
		esac
	done <<EOF
$(grep -E -o 'address-tasks-bootstrap( (--)?[a-z][a-z-]*)+' "$WORKFLOWS/$wf" | sort -u)
EOF
	[ "$found" -gt 0 ]
	ok "$wf: its brief names an address-tasks-bootstrap command" $?
done

if [ "$fails" -gt 0 ]; then
	printf 'address-tasks bootstrap helper test FAILED (%s of %s checks).\n' "$fails" "$checks" >&2
	exit 1
fi
printf 'address-tasks bootstrap helper test passed (%s checks).\n' "$checks"
