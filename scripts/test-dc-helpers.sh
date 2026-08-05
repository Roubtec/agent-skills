#!/usr/bin/env bash
set -euo pipefail

# Offline contract coverage for the disposable-clone helpers in
# plugins/dev-skills/bin: dc-enter (make a clone of the invoking repository that
# is safe to wreck, printing only its path) and dc-remove (drop one, however
# wrecked, and nothing else).
#
# Sync discipline: any behavior change to either helper must update this suite in
# the same PR. If powbox later bakes the helpers onto the container PATH, this
# suite is the consumer contract to import, with DC_ENTER_HELPER/DC_REMOVE_HELPER
# retargeting it at the baked artifacts.
#
# Hermetic and host-independent: every fixture is a throwaway repository under
# one mktemp -d root, and the suite NEVER runs a helper against this repository —
# `in_repo` is the only way a helper is invoked and it always changes directory
# inside a subshell. Needs only Bash, git, and coreutils.
#
# Run from the repository root: bash scripts/test-dc-helpers.sh
#
# Covers:
#   (a) stdout purity and the DC="$(dc-enter probe)" calling convention
#   (b) the isolation guarantee — refs, commits, and gc --prune=now in the clone
#       leave the source's refs and reachable objects untouched
#   (c) the <ref> interface: default is the INVOKING worktree's HEAD (not the
#       main worktree's), branch/tag/sha/rev forms, and refusal on a bad ref
#   (d) the ref namespace: an exact mirror of the source's refs, demonstrated on
#       a source carrying refs outside refs/heads/ and refs/tags/
#   (e) clone-root refusals: inside the worktree, the git dir, another worktree,
#       or reached through a symlink — non-zero with an empty stdout
#   (f) reuse: a wrecked slug is re-derived pristine, and a directory the helper
#       did not create is refused rather than deleted
#   (g) per-agent and per-worktree path scoping
#   (h) dc-remove: removes a dirty clone, refuses a path, refuses a foreign or
#       mis-marked directory, no-ops on an unknown slug, and removes exactly the
#       path dc-enter printed (which pins the two path derivations together)
#   (i) the incident's shape: a failed clone step must not let a script proceed
#       to operate in the repository root, even when piped as the original was
#   (j) hardlink policy: --no-hardlinks by default, DC_HARDLINKS=1 opt-in, with
#       the isolation guarantee holding either way

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DC_ENTER="${DC_ENTER_HELPER:-${ROOT_DIR}/plugins/dev-skills/bin/dc-enter}"
DC_REMOVE="${DC_REMOVE_HELPER:-${ROOT_DIR}/plugins/dev-skills/bin/dc-remove}"

for helper in "$DC_ENTER" "$DC_REMOVE"; do
	[ -x "$helper" ] || {
		echo "test-dc-helpers: helper not found or not executable: $helper" >&2
		exit 1
	}
done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/dc-helpers-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# Hermetic git: no user or system config leaks in, so the helpers' behavior does
# not depend on the machine running the suite.
export HOME="$WORK/home"
export GIT_CONFIG_NOSYSTEM=1
mkdir -p "$HOME"
export DC_AGENT=testagent
unset DC_ROOT DC_HARDLINKS

fails=0
checks=0

assert_eq() {
	checks=$((checks + 1))
	if [ "$2" != "$3" ]; then
		fails=$((fails + 1))
		printf 'FAIL [%s]: got %q, want %q\n' "$1" "$2" "$3" >&2
	fi
}
assert_ne() {
	checks=$((checks + 1))
	if [ "$2" = "$3" ]; then
		fails=$((fails + 1))
		printf 'FAIL [%s]: both values are %q, expected them to differ\n' "$1" "$2" >&2
	fi
}
assert_contains() {
	checks=$((checks + 1))
	case "$2" in
	*"$3"*) ;;
	*)
		fails=$((fails + 1))
		printf 'FAIL [%s]: %q does not contain %q\n' "$1" "$2" "$3" >&2
		;;
	esac
}
assert_true() {
	checks=$((checks + 1))
	if [ "$2" != true ]; then
		fails=$((fails + 1))
		printf 'FAIL [%s]: expected true\n' "$1" >&2
	fi
}

# Run a command with the working directory inside a fixture repository. The `cd`
# lives in a subshell, so the suite's own working directory never moves. Sets
# RC/OUT/ERR; OUT and ERR are captured separately so stdout purity is testable.
RC=0
OUT=""
ERR=""
in_repo() {
	local dir="$1"
	shift
	local err_file="$WORK/.stderr"
	set +e
	# The stderr redirection lives INSIDE the command substitution: on an
	# assignment it would be applied after the substitution had already run and
	# would capture nothing.
	OUT="$(
		{
			cd "$dir" || exit 97
			"$@"
		} 2>"$err_file"
	)"
	RC=$?
	set -e
	ERR="$(cat "$err_file")"
}

g() { git -c user.email=test@invalid -c user.name=Test "$@"; }

# Inode number of a path, GNU stat first and BSD stat as the fallback.
inode_of() {
	local path="$1"
	stat -c '%i' -- "$path" 2>/dev/null || stat -f '%i' -- "$path"
}

# refs, and the full set of reachable objects, as comparable strings.
refs_of() { git -C "$1" for-each-ref --format='%(refname) %(objectname)'; }
objects_of() {
	local raw
	raw="$(git -C "$1" rev-list --objects --all)"
	sort <<<"$raw"
}

# A source repository carrying refs outside refs/heads/ and refs/tags/, an
# unreachable commit held only by one of them, a tag, a stash, and a linked
# worktree whose HEAD differs from the main worktree's.
make_source() {
	local dir="$1"
	git init -q -b main "$dir"
	g -C "$dir" commit -q --allow-empty -m one
	g -C "$dir" commit -q --allow-empty -m two
	printf 'tracked\n' >"$dir/file.txt"
	g -C "$dir" add file.txt
	g -C "$dir" commit -q -m three
	g -C "$dir" tag v1
	# An unreachable commit, reachable only through a non-standard namespace —
	# exactly the shape (refs/pruned/*) the run that produced this task tested.
	g -C "$dir" commit -q --allow-empty -m reserved
	git -C "$dir" update-ref refs/pruned/reserved HEAD
	g -C "$dir" reset -q --hard HEAD~1
	git -C "$dir" update-ref refs/pre-rebase/main HEAD
	git -C "$dir" notes add -f -m "a note" HEAD >/dev/null 2>&1
	printf 'stashed\n' >"$dir/file.txt"
	g -C "$dir" stash -q
	g -C "$dir" branch -q other HEAD~1
	g -C "$dir" worktree add -q "$dir-wt" -b wtbranch HEAD~1
}

echo "== (a) stdout purity and the calling convention =="
SRC1="$WORK/a/src"
mkdir -p "$WORK/a"
make_source "$SRC1"
export DC_ROOT="$WORK/a/root"
in_repo "$SRC1" "$DC_ENTER" probe
assert_eq "a: exit status" "$RC" 0
case "$OUT" in
/*) assert_eq "a: stdout is an absolute path" true true ;;
*) assert_eq "a: stdout is an absolute path" "$OUT" "<absolute path>" ;;
esac
assert_eq "a: stdout is exactly one line" "$(wc -l <<<"$OUT")" 1
CLONE_A="$OUT"
assert_true "a: clone is a git repository" "$([ -d "$CLONE_A/.git" ] && echo true || echo false)"
assert_true "a: clone is outside the source" "$(case "$CLONE_A" in "$SRC1"/*) echo false ;; *) echo true ;; esac)"
assert_eq "a: clone tree is clean" "$(git -C "$CLONE_A" status --porcelain)" ""
assert_eq "a: no remote points back at the source" "$(git -C "$CLONE_A" remote)" ""
assert_eq "a: uncommitted source changes are not carried" "$(cat "$CLONE_A/file.txt")" "tracked"
# The documented convention: command substitution yields a usable path.
cat >"$WORK/convention.sh" <<'SCRIPT'
set -euo pipefail
DC="$("$DC_ENTER_BIN" conv)"
[ -n "$DC" ] && [ -d "$DC/.git" ] || exit 1
printf '%s\n' "$DC"
SCRIPT
in_repo "$SRC1" env "DC_ENTER_BIN=$DC_ENTER" bash "$WORK/convention.sh"
assert_eq "a: DC=\$(dc-enter …) succeeds" "$RC" 0
assert_true "a: substituted path is usable" "$([ -d "$OUT/.git" ] && echo true || echo false)"
# --help is the one other thing allowed on stdout, and only on request.
in_repo "$SRC1" "$DC_ENTER" --help
assert_eq "a: --help exits 0" "$RC" 0
assert_contains "a: --help prints usage on stdout" "$OUT" "usage: dc-enter"
in_repo "$SRC1" "$DC_REMOVE" --help
assert_eq "a: dc-remove --help exits 0" "$RC" 0
assert_contains "a: dc-remove --help prints usage on stdout" "$OUT" "usage: dc-remove"

echo "== (b) the isolation guarantee =="
REFS_BEFORE="$(refs_of "$SRC1")"
OBJS_BEFORE="$(objects_of "$SRC1")"
git -C "$CLONE_A" update-ref refs/heads/x HEAD
git -C "$CLONE_A" branch -q -f other HEAD
git -C "$CLONE_A" update-ref -d refs/pruned/reserved
git -C "$CLONE_A" update-ref -d refs/pre-rebase/main
git -C "$CLONE_A" update-ref -d refs/stash
git -C "$CLONE_A" update-ref -d refs/tags/v1
git -C "$CLONE_A" checkout -q --detach HEAD
git -C "$CLONE_A" branch -q -D main
g -C "$CLONE_A" commit -q --allow-empty -m "clone-only commit"
git -C "$CLONE_A" reflog expire --expire=now --all
git -C "$CLONE_A" gc --prune=now --quiet
assert_eq "b: source refs unchanged" "$(refs_of "$SRC1")" "$REFS_BEFORE"
assert_eq "b: source reachable objects unchanged" "$(objects_of "$SRC1")" "$OBJS_BEFORE"
in_repo "$SRC1" git fsck --no-progress --no-dangling --connectivity-only
assert_eq "b: source still passes fsck" "$RC" 0
assert_eq "b: the unreachable ref's commit survives in the source" \
	"$(git -C "$SRC1" cat-file -t "$(git -C "$SRC1" rev-parse refs/pruned/reserved)")" "commit"
# A commit inside the clone works even with no user identity configured.
assert_contains "b: clone accepted a commit" "$(git -C "$CLONE_A" log -1 --format=%s)" "clone-only commit"

echo "== (c) the <ref> interface =="
SRC2="$WORK/c/src"
mkdir -p "$WORK/c"
make_source "$SRC2"
WT2="$WORK/c/src-wt"
export DC_ROOT="$WORK/c/root"
assert_ne "c: fixture worktree HEAD differs from the main worktree's" \
	"$(git -C "$WT2" rev-parse HEAD)" "$(git -C "$SRC2" rev-parse HEAD)"
in_repo "$WT2" "$DC_ENTER" fromwt
assert_eq "c: dc-enter from a linked worktree exits 0" "$RC" 0
CLONE_C="$OUT"
assert_eq "c: default ref is the INVOKING worktree's HEAD" \
	"$(git -C "$CLONE_C" rev-parse HEAD)" "$(git -C "$WT2" rev-parse HEAD)"
assert_eq "c: default ref keeps the invoking worktree's branch" \
	"$(git -C "$CLONE_C" symbolic-ref HEAD)" "refs/heads/wtbranch"
# From a nested subdirectory of the invoking worktree.
mkdir -p "$WT2/nested/deeper"
in_repo "$WT2/nested/deeper" "$DC_ENTER" nested
assert_eq "c: works from a nested subdirectory" "$RC" 0
assert_eq "c: nested invocation still uses the worktree's HEAD" \
	"$(git -C "$OUT" rev-parse HEAD)" "$(git -C "$WT2" rev-parse HEAD)"
# An explicit branch name checks that branch out.
in_repo "$WT2" "$DC_ENTER" bybranch other
assert_eq "c: explicit branch exits 0" "$RC" 0
assert_eq "c: explicit branch is checked out" "$(git -C "$OUT" symbolic-ref HEAD)" "refs/heads/other"
assert_eq "c: explicit branch is at the source's commit" \
	"$(git -C "$OUT" rev-parse HEAD)" "$(git -C "$SRC2" rev-parse other)"
# A non-branch revision detaches at the resolved commit.
in_repo "$WT2" "$DC_ENTER" bytag v1
assert_eq "c: explicit tag exits 0" "$RC" 0
assert_eq "c: explicit tag detaches" "$(git -C "$OUT" symbolic-ref -q HEAD || echo DETACHED)" "DETACHED"
assert_eq "c: explicit tag is at the tag's commit" \
	"$(git -C "$OUT" rev-parse HEAD)" "$(git -C "$SRC2" rev-parse "v1^{commit}")"
in_repo "$WT2" "$DC_ENTER" byrev "HEAD~1"
assert_eq "c: explicit revision exits 0" "$RC" 0
assert_eq "c: explicit revision resolves in the INVOKING worktree" \
	"$(git -C "$OUT" rev-parse HEAD)" "$(git -C "$WT2" rev-parse "HEAD~1")"
# A detached invoking worktree produces a detached clone at the same commit.
git -C "$WT2" checkout -q --detach HEAD
in_repo "$WT2" "$DC_ENTER" detached
assert_eq "c: detached invoking HEAD exits 0" "$RC" 0
assert_eq "c: detached invoking HEAD yields a detached clone" \
	"$(git -C "$OUT" symbolic-ref -q HEAD || echo DETACHED)" "DETACHED"
assert_eq "c: detached clone is at the invoking commit" \
	"$(git -C "$OUT" rev-parse HEAD)" "$(git -C "$WT2" rev-parse HEAD)"
git -C "$WT2" checkout -q wtbranch
# A ref that does not resolve is refused, silently on stdout.
in_repo "$WT2" "$DC_ENTER" badref no/such/ref
assert_ne "c: unresolvable ref exits non-zero" "$RC" 0
assert_eq "c: unresolvable ref writes nothing to stdout" "$OUT" ""
assert_contains "c: unresolvable ref explains itself on stderr" "$ERR" "does not resolve to a commit"
# Outside a repository at all.
mkdir -p "$WORK/c/norepo"
in_repo "$WORK/c/norepo" "$DC_ENTER" norepo
assert_ne "c: outside a git worktree exits non-zero" "$RC" 0
assert_eq "c: outside a git worktree writes nothing to stdout" "$OUT" ""

echo "== (d) the ref namespace is an exact mirror =="
in_repo "$SRC2" "$DC_ENTER" mirror
assert_eq "d: exits 0" "$RC" 0
CLONE_D="$OUT"
assert_eq "d: every ref mirrored at its original name" "$(refs_of "$CLONE_D")" "$(refs_of "$SRC2")"
assert_contains "d: a non-standard namespace is present" "$(refs_of "$CLONE_D")" "refs/pruned/reserved"
assert_contains "d: pre-rebase reservations are present" "$(refs_of "$CLONE_D")" "refs/pre-rebase/main"
assert_contains "d: notes are present" "$(refs_of "$CLONE_D")" "refs/notes/commits"
assert_contains "d: the stash ref is present" "$(refs_of "$CLONE_D")" "refs/stash"
assert_eq "d: the object behind an unreachable ref came across" \
	"$(git -C "$CLONE_D" cat-file -t "$(git -C "$SRC2" rev-parse refs/pruned/reserved)")" "commit"
# git clone's invented remote-tracking namespace is pruned away, so the mirror
# is exact rather than exact-plus-leftovers.
assert_eq "d: no leftover remote-tracking refs from the clone step" \
	"$(git -C "$CLONE_D" for-each-ref --format='%(refname)' 'refs/remotes/dc-source')" ""
# for-each-ref hides a DANGLING symbolic ref, so check the ref store directly too.
in_repo "$CLONE_D" git symbolic-ref -q "refs/remotes/dc-source/HEAD"
assert_ne "d: not even a dangling remote-tracking HEAD is left behind" "$RC" 0
# ... and a source that genuinely owns refs under the clone step's remote name
# keeps them: dropping the remote must not take mirrored refs with it.
git -C "$SRC2" update-ref refs/remotes/dc-source/main "$(git -C "$SRC2" rev-parse HEAD)"
git -C "$SRC2" update-ref refs/remotes/origin/main "$(git -C "$SRC2" rev-parse HEAD)"
in_repo "$SRC2" "$DC_ENTER" mirror2
assert_eq "d: a source owning the clone remote's namespace mirrors exactly" \
	"$(refs_of "$OUT")" "$(refs_of "$SRC2")"
assert_contains "d: the source's own dc-source refs survive" "$(refs_of "$OUT")" "refs/remotes/dc-source/main"
assert_contains "d: the source's own origin refs survive" "$(refs_of "$OUT")" "refs/remotes/origin/main"
assert_eq "d: the clone still has no remote to push to" "$(git -C "$OUT" remote)" ""
# The source's reflog is documented as absent — the clone keeps a fresh reflog of
# its own, so reflog-only recovery of the source's history is unavailable in it.
in_repo "$SRC2" git rev-parse --verify "HEAD@{4}"
assert_eq "d: the source's reflog reaches back several entries" "$RC" 0
in_repo "$CLONE_D" git rev-parse --verify "HEAD@{4}"
assert_ne "d: the source's reflog history is not carried" "$RC" 0

echo "== (e) clone-root refusals =="
SRC3="$WORK/e/src"
mkdir -p "$WORK/e"
make_source "$SRC3"
for bad in "$SRC3" "$SRC3/sub" "$SRC3/.git/dc" "$WORK/e/src-wt/inside" "$WORK/e/src-wt"; do
	DC_ROOT="$bad" in_repo "$SRC3" env "DC_ROOT=$bad" "$DC_ENTER" inside
	assert_ne "e: refuses DC_ROOT=$bad" "$RC" 0
	assert_eq "e: refuses DC_ROOT=$bad silently on stdout" "$OUT" ""
	assert_contains "e: refuses DC_ROOT=$bad with a reason" "$ERR" "inside the invoking repository"
done
# Nothing was created inside the repository on the way to refusing.
assert_eq "e: refusal creates nothing in the repository" "$(git -C "$SRC3" status --porcelain)" ""
assert_true "e: refusal created no directory inside the repository" \
	"$([ ! -e "$SRC3/sub" ] && [ ! -e "$SRC3/.git/dc" ] && echo true || echo false)"
# A symlinked root that lands inside the repository is refused too.
ln -s "$SRC3" "$WORK/e/link-to-repo"
in_repo "$SRC3" env "DC_ROOT=$WORK/e/link-to-repo/viaLink" "$DC_ENTER" vialink
assert_ne "e: refuses a symlinked root inside the repository" "$RC" 0
assert_eq "e: symlinked-root refusal is silent on stdout" "$OUT" ""
# A scope directory that is a symlink into the repository is refused before the
# clone is placed — the root check above is lexical, so resolving this component
# is what makes it binding.
in_repo "$SRC3" env "DC_ROOT=$WORK/e/root" "$DC_ENTER" scoped
SCOPE_E="$(dirname "$(dirname "$OUT")")"
in_repo "$SRC3" env "DC_ROOT=$WORK/e/root" "$DC_REMOVE" scoped
rm -rf "$SCOPE_E"
mkdir -p "$SRC3/decoy"
ln -s "$SRC3/decoy" "$SCOPE_E"
in_repo "$SRC3" env "DC_ROOT=$WORK/e/root" "$DC_ENTER" scoped
assert_ne "e: refuses a symlinked scope directory" "$RC" 0
assert_eq "e: the symlinked-scope refusal is silent on stdout" "$OUT" ""
assert_contains "e: the symlinked-scope refusal says why" "$ERR" "symlink"
assert_eq "e: nothing was created inside the repository through the symlink" "$(ls -A "$SRC3/decoy")" ""
assert_eq "e: the repository is still clean" "$(git -C "$SRC3" status --porcelain)" ""
rm -f "$SCOPE_E"
rm -rf "$SRC3/decoy"

# A malformed slug never reaches the filesystem.
for badslug in "../escape" "a/b" "" "-x" ".hidden"; do
	in_repo "$SRC3" env "DC_ROOT=$WORK/e/root" "$DC_ENTER" "$badslug"
	assert_ne "e: refuses slug '$badslug'" "$RC" 0
	assert_eq "e: refuses slug '$badslug' silently on stdout" "$OUT" ""
done

echo "== (f) reuse re-derives, and never adopts a stranger's directory =="
export DC_ROOT="$WORK/f/root"
SRC4="$WORK/f/src"
mkdir -p "$WORK/f"
make_source "$SRC4"
in_repo "$SRC4" "$DC_ENTER" reuse
assert_eq "f: first call exits 0" "$RC" 0
CLONE_F="$OUT"
# Wreck it the way an experiment would: delete refs, collect objects, dirty and
# litter the tree, and remove a tracked file.
git -C "$CLONE_F" update-ref -d refs/pruned/reserved
git -C "$CLONE_F" update-ref -d refs/pre-rebase/main
git -C "$CLONE_F" gc --prune=now --quiet
printf 'wrecked\n' >"$CLONE_F/file.txt"
printf 'litter\n' >"$CLONE_F/untracked.txt"
in_repo "$SRC4" "$DC_ENTER" reuse
assert_eq "f: second call exits 0" "$RC" 0
assert_eq "f: second call returns the same deterministic path" "$OUT" "$CLONE_F"
assert_eq "f: the wreckage is gone — refs are pristine again" "$(refs_of "$CLONE_F")" "$(refs_of "$SRC4")"
assert_eq "f: the wreckage is gone — tree is clean" "$(git -C "$CLONE_F" status --porcelain)" ""
assert_eq "f: the wreckage is gone — tracked content restored" "$(cat "$CLONE_F/file.txt")" "tracked"
assert_true "f: the wreckage is gone — litter removed" \
	"$([ ! -e "$CLONE_F/untracked.txt" ] && echo true || echo false)"
assert_contains "f: re-derivation is announced on stderr" "$ERR" "re-deriving"
# Even a clone whose .git was destroyed is re-derived rather than refused: the
# marker that proves ownership lives beside the clone, not inside it.
rm -rf "$CLONE_F/.git"
in_repo "$SRC4" "$DC_ENTER" reuse
assert_eq "f: a clone whose .git was destroyed is re-derived" "$RC" 0
assert_eq "f: re-derived clone is a repository again" \
	"$(git -C "$CLONE_F" rev-parse --is-inside-work-tree)" "true"
# A directory the helper did not create is refused, not deleted.
FOREIGN_DIR="$(dirname "$CLONE_F")/../foreign"
mkdir -p "$FOREIGN_DIR"
printf 'precious\n' >"$FOREIGN_DIR/keep.txt"
in_repo "$SRC4" "$DC_ENTER" foreign
assert_ne "f: refuses a directory it did not create" "$RC" 0
assert_eq "f: refusal is silent on stdout" "$OUT" ""
assert_contains "f: refusal names the missing marker" "$ERR" "dc-clone-meta"
assert_eq "f: the foreign directory is untouched" "$(cat "$FOREIGN_DIR/keep.txt")" "precious"
# A slug path that is a symlink is refused by both helpers rather than followed.
SCOPE_DIR_F="$(dirname "$(dirname "$CLONE_F")")"
ln -s "$FOREIGN_DIR" "$SCOPE_DIR_F/linked"
in_repo "$SRC4" "$DC_ENTER" linked
assert_ne "f: dc-enter refuses a symlinked slug path" "$RC" 0
assert_eq "f: the symlink refusal is silent on stdout" "$OUT" ""
in_repo "$SRC4" "$DC_REMOVE" linked
assert_ne "f: dc-remove refuses a symlinked slug path" "$RC" 0
assert_eq "f: the symlink's target survives" "$(cat "$FOREIGN_DIR/keep.txt")" "precious"
assert_true "f: the symlink itself is left in place" "$([ -L "$SCOPE_DIR_F/linked" ] && echo true || echo false)"
rm -f "$SCOPE_DIR_F/linked"

echo "== (g) per-agent and per-worktree scoping =="
in_repo "$SRC4" env "DC_AGENT=agent-one" "$DC_ENTER" shared
PATH_ONE="$OUT"
in_repo "$SRC4" env "DC_AGENT=agent-two" "$DC_ENTER" shared
PATH_TWO="$OUT"
assert_ne "g: two agents do not collide on one slug" "$PATH_ONE" "$PATH_TWO"
assert_true "g: both agents' clones exist at once" \
	"$([ -d "$PATH_ONE/.git" ] && [ -d "$PATH_TWO/.git" ] && echo true || echo false)"
in_repo "$WORK/f/src-wt" "$DC_ENTER" shared
assert_ne "g: two worktrees of one repository do not collide on a slug" "$OUT" "$PATH_ONE"
in_repo "$SRC4" "$DC_ENTER" stable
FIRST_STABLE="$OUT"
in_repo "$SRC4" "$DC_ENTER" stable
assert_eq "g: the same agent, worktree, and slug resolve to one path" "$OUT" "$FIRST_STABLE"

echo "== (h) dc-remove =="
in_repo "$SRC4" "$DC_ENTER" doomed
CLONE_H="$OUT"
# Dirty in every way dc-remove promises not to care about.
printf 'dirty\n' >"$CLONE_H/file.txt"
printf 'litter\n' >"$CLONE_H/untracked.txt"
git -C "$CLONE_H" update-ref -d refs/stash
in_repo "$SRC4" "$DC_REMOVE" doomed
assert_eq "h: removes a dirty clone without complaint" "$RC" 0
assert_eq "h: dc-remove writes nothing to stdout" "$OUT" ""
assert_true "h: the clone is gone" "$([ ! -e "$CLONE_H" ] && echo true || echo false)"
assert_true "h: the slug directory dc-enter created is gone too" \
	"$([ ! -e "$(dirname "$CLONE_H")" ] && echo true || echo false)"
# Removing the same slug again is a no-op, so a cleanup trap can be unconditional.
in_repo "$SRC4" "$DC_REMOVE" doomed
assert_eq "h: an unknown slug is a no-op" "$RC" 0
assert_eq "h: the no-op writes nothing to stdout" "$OUT" ""
# It takes a slug, never a path — including the invoking repository's own path.
for badarg in "$SRC4" "$CLONE_H" ".." "." "/" "f/oo" "$WORK"; do
	in_repo "$SRC4" "$DC_REMOVE" "$badarg"
	assert_ne "h: refuses the path argument '$badarg'" "$RC" 0
	assert_contains "h: '$badarg' is refused as a path, not a slug" "$ERR" "expected a slug, not a path"
done
assert_true "h: the invoking repository is still intact" \
	"$([ -d "$SRC4/.git" ] && [ -f "$SRC4/file.txt" ] && echo true || echo false)"
# A directory at a slug's path that the helper did not create is refused.
in_repo "$SRC4" "$DC_REMOVE" foreign
assert_ne "h: refuses a foreign directory" "$RC" 0
assert_eq "h: the foreign directory survives" "$(cat "$FOREIGN_DIR/keep.txt")" "precious"
# A marker whose recorded clone path is not the one this invocation derived is
# bookkeeping that does not match, so it is refused.
in_repo "$SRC4" "$DC_ENTER" mismarked
CLONE_MIS="$OUT"
MIS_SESSION="$(dirname "$CLONE_MIS")"
printf 'dc-clone-v1\nclone=/somewhere/else/repo\n' >"$MIS_SESSION/dc-clone-meta"
in_repo "$SRC4" "$DC_REMOVE" mismarked
assert_ne "h: refuses a marker that records another clone path" "$RC" 0
assert_contains "h: the mismatch is explained" "$ERR" "records clone path"
assert_true "h: the mis-marked directory survives" "$([ -d "$CLONE_MIS" ] && echo true || echo false)"
# The two helpers' path derivations agree: dc-remove removes exactly the path
# dc-enter printed.
in_repo "$SRC4" "$DC_ENTER" pinned
CLONE_PINNED="$OUT"
in_repo "$SRC4" "$DC_REMOVE" pinned
assert_eq "h: dc-remove removes what dc-enter printed" "$RC" 0
assert_true "h: dc-enter's printed path is gone" "$([ ! -e "$CLONE_PINNED" ] && echo true || echo false)"

echo "== (i) the incident's shape =="
SRC5="$WORK/i/src"
mkdir -p "$WORK/i"
make_source "$SRC5"
# The original: a clone step that failed inside a pipeline, so `set -e` saw
# `tail`'s status, execution continued with the working directory still at the
# repository root, and `rm -rf ./*` ran there. Both variants below point the
# clone root inside the repository so the clone step fails; the guarded calling
# convention must stop the script either way.
cat >"$WORK/i/guarded.sh" <<'SCRIPT'
set -euo pipefail
DC="$("$DC_ENTER_BIN" probe)"
[ -n "$DC" ] && [ -d "$DC/.git" ] || exit 1
cd "$DC" || exit 1
rm -rf ./*
SCRIPT
cat >"$WORK/i/piped.sh" <<'SCRIPT'
set -euo pipefail
# The incident's exact trap: a load-bearing command piped for output brevity.
DC="$("$DC_ENTER_BIN" probe 2>&1 | tail -n 1)"
[ -n "$DC" ] && [ -d "$DC/.git" ] || exit 1
cd "$DC" || exit 1
rm -rf ./*
SCRIPT
cat >"$WORK/i/piped-nopipefail.sh" <<'SCRIPT'
# The incident's exact configuration: `set -e` WITHOUT pipefail, so the pipeline
# reports tail's success and the failed clone step is invisible to the shell.
# The explicit path guard is then the only thing between it and the repo root.
set -eu
DC="$("$DC_ENTER_BIN" probe 2>&1 | tail -n 1)"
[ -n "$DC" ] && [ -d "$DC/.git" ] || exit 1
cd "$DC" || exit 1
rm -rf ./*
SCRIPT
for variant in guarded piped piped-nopipefail; do
	in_repo "$SRC5" env "DC_ENTER_BIN=$DC_ENTER" "DC_ROOT=$SRC5/inside" bash "$WORK/i/$variant.sh"
	assert_ne "i: the $variant script stops when the clone step fails" "$RC" 0
	assert_true "i: the $variant script did not delete the repository's files" \
		"$([ -f "$SRC5/file.txt" ] && [ -d "$SRC5/.git" ] && echo true || echo false)"
	assert_eq "i: the $variant script left the repository clean" "$(git -C "$SRC5" status --porcelain)" ""
done
# And when the clone step succeeds, the same script wrecks only the clone.
in_repo "$SRC5" env "DC_ENTER_BIN=$DC_ENTER" "DC_ROOT=$WORK/i/root" bash "$WORK/i/guarded.sh"
assert_eq "i: the guarded script succeeds against a real clone" "$RC" 0
assert_eq "i: the repository is untouched by the destructive step" "$(git -C "$SRC5" status --porcelain)" ""
assert_true "i: the repository's tracked file survives" "$([ -f "$SRC5/file.txt" ] && echo true || echo false)"

echo "== (j) hardlink policy =="
SRC6="$WORK/j/src"
mkdir -p "$WORK/j"
make_source "$SRC6"
export DC_ROOT="$WORK/j/root"
# A loose object both repositories will have.
LOOSE_REL="$(git -C "$SRC6" rev-parse HEAD)"
LOOSE_PATH=".git/objects/${LOOSE_REL:0:2}/${LOOSE_REL:2}"
assert_true "j: fixture has the commit as a loose object" \
	"$([ -f "$SRC6/$LOOSE_PATH" ] && echo true || echo false)"
in_repo "$SRC6" "$DC_ENTER" nolinks
CLONE_J="$OUT"
SRC_INODE="$(inode_of "$SRC6/$LOOSE_PATH")"
CLONE_INODE="$(inode_of "$CLONE_J/$LOOSE_PATH")"
assert_ne "j: objects are copied, not hardlinked, by default" "$SRC_INODE" "$CLONE_INODE"
in_repo "$SRC6" env "DC_HARDLINKS=1" "$DC_ENTER" links
CLONE_JL="$OUT"
LINK_INODE="$(inode_of "$CLONE_JL/$LOOSE_PATH")"
assert_eq "j: DC_HARDLINKS=1 takes the hardlinked fast path" "$LINK_INODE" "$SRC_INODE"
# The isolation guarantee holds on the hardlinked path too.
REFS_BEFORE_J="$(refs_of "$SRC6")"
OBJS_BEFORE_J="$(objects_of "$SRC6")"
git -C "$CLONE_JL" update-ref -d refs/pruned/reserved
git -C "$CLONE_JL" reflog expire --expire=now --all
git -C "$CLONE_JL" gc --prune=now --quiet
assert_eq "j: hardlinked clone's gc leaves the source's refs alone" "$(refs_of "$SRC6")" "$REFS_BEFORE_J"
assert_eq "j: hardlinked clone's gc leaves the source's objects alone" "$(objects_of "$SRC6")" "$OBJS_BEFORE_J"
in_repo "$SRC6" git fsck --no-progress --no-dangling --connectivity-only
assert_eq "j: the source still passes fsck after the hardlinked clone's gc" "$RC" 0

if [ "$fails" -eq 0 ]; then
	printf 'test-dc-helpers: %d checks passed\n' "$checks"
else
	printf 'test-dc-helpers: %d of %d checks FAILED\n' "$fails" "$checks" >&2
	exit 1
fi
