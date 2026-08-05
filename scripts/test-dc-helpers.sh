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
#       leave the source's refs and reachable objects untouched, the clone takes
#       a commit where nothing has configured an identity, and neither an
#       inherited GIT_CONFIG nor a caller's own global branch.<name>.* setting
#       breaks the run or lets the clone's config surgery reach outside it
#   (c) the <ref> interface: default is the INVOKING worktree's HEAD (not the
#       main worktree's), branch/tag/sha/rev forms, a short name that is both a
#       branch and a tag resolving to the branch, a qualified ref and a
#       $GIT_DIR pseudo-ref each still winning over a branch named literally
#       like it, and refusal on a bad ref
#   (d) the ref namespace: an exact mirror of the source's refs, demonstrated on
#       a source carrying refs outside refs/heads/ and refs/tags/ — including one
#       hiding a namespace from upload-pack, which a refspec fetch would drop
#   (e) clone-root refusals: inside the worktree, the git dir, another worktree,
#       or reached through a symlink — non-zero with an empty stdout — plus the
#       worktree enumeration failing closed on every shape of bad listing
#   (f) reuse: an existing clone is refused (a concurrent sibling may be in it),
#       --replace re-derives it pristine, and neither a stranger's directory nor
#       one whose marker records another clone is ever discarded
#   (g) per-agent and per-worktree path scoping, and the sibling case where two
#       callers share both
#   (h) dc-remove: removes a dirty clone, refuses a path, refuses an empty slug
#       even when another argument follows, refuses a foreign or mis-marked
#       directory, no-ops on an unknown slug, and removes exactly the path
#       dc-enter printed (which pins the two path derivations together)
#   (i) the incident's shape: a failed clone step must not let a script proceed
#       to operate in the repository root, even when piped as the original was
#   (j) hardlink policy: --no-hardlinks by default, DC_HARDLINKS=1 opt-in, with
#       the isolation guarantee holding either way
#   (k) clone-root hygiene: repeated separators collapse, a relative root and a
#       newline-bearing one are refused by both helpers — including a newline at
#       the very end and one only the RESOLVED root has — and a newline anywhere
#       in the SOURCE's path, end included, still works. These are the checks
#       that must be made on the value the caller supplied rather than on the
#       canonicalized one, since canonicalizing changes it.

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
# A fresh HOME does not achieve that on its own. `GIT_CONFIG_GLOBAL` and
# `XDG_CONFIG_HOME` both redirect git's "global" config away from $HOME;
# `GIT_CONFIG_COUNT` and `GIT_CONFIG_PARAMETERS` inject config settings with no
# file involved at all — git exports the latter to every subprocess of a `git -c`
# invocation, so a suite run from inside a hook, an alias, or `submodule foreach`
# inherits one; and the GIT_AUTHOR_*/GIT_COMMITTER_*/EMAIL variables supply a
# committer identity directly. A development container setting any of them —
# powbox sets GIT_CONFIG_GLOBAL — would hand this suite the identity a clean CI
# runner does not have, so a fixture step that forgot the `g` wrapper below would
# pass locally and exit 128 in CI. Clearing them makes a local run reproduce the
# runner, and the probe below asserts that it does rather than trusting this list
# to stay complete.
# `GIT_CONFIG` is cleared for a different reason, and for the SUITE's own sake
# rather than the helpers'. It supplies no identity to git as a whole — `git
# config` is the only command that honours it — but it redirects that command's
# reads AND writes at the named file, and this suite asserts on the clones' own
# configuration with `git -C "$CLONE" config`. Left set, those assertions would
# describe the caller's file instead of the clone they name. dc-enter drops the
# variable itself so a caller carrying one still gets a clone; section (b)
# asserts that, which is a separate job from keeping these reads honest.
export HOME="$WORK/home"
export GIT_CONFIG_NOSYSTEM=1
unset GIT_CONFIG_GLOBAL GIT_CONFIG_SYSTEM GIT_CONFIG_COUNT GIT_CONFIG_PARAMETERS GIT_CONFIG
unset GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL EMAIL
export XDG_CONFIG_HOME="$WORK/home/.config"
mkdir -p "$HOME"
# Scrubbing the environment is still not enough on its own: with nothing
# configured at all, git INVENTS an identity from the account's gecos name and
# the hostname, and accepts the invented one wherever that hostname carries a
# domain. On such a host a fixture step missing the `g` wrapper would commit
# happily and section (b)'s check of dc-enter's own identity fallback would pass
# without the fallback ever running. `user.useConfigOnly` forbids the invention,
# so "no identity unless something configured one" holds everywhere rather than
# only where the hostname happens to be bare. This is the one setting the suite
# deliberately puts in its throwaway HOME; everything else stays scrubbed.
printf '[user]\n\tuseConfigOnly = true\n' >"$HOME/.gitconfig"
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

# The environment block above, asserted rather than assumed. `g` exists because
# the fixtures must commit where nothing offers an identity, and section (b)
# proves dc-enter fills that gap inside the clone — both are vacuous if some
# variable this list does not know about still supplies one. A leak makes those
# checks pass here and exit 128 on a clean runner, which is the single failure
# mode the environment block exists to prevent, so it is caught at the top of the
# run rather than diagnosed from a CI log.
git init -q -b main "$WORK/hermetic-probe"
assert_eq "env: no committer identity reaches git from the host" \
	"$(git -C "$WORK/hermetic-probe" var GIT_COMMITTER_IDENT 2>/dev/null || echo none)" "none"

# Carry the path dc-enter printed into a named variable, ABORTING the run rather
# than letting an unusable one flow onward. An empty $OUT is the danger: `git -C
# ''` is documented to leave the working directory unchanged, so it does not fail
# — it silently addresses whatever repository the suite is running in, which is
# THIS one, and the mutating assertions in sections (b), (f), (h) and (j) would
# then delete refs, force branches, and run `gc --prune=now` against a `.git`
# shared with every sibling worktree. `dirname ""` is the same trap one step on:
# it yields ".", which is how an empty path becomes `rm -rf .`. Both are the
# incident's own shape — an unchecked path from a step that did not do what the
# script assumed — so a suite about destructive-command safety fails closed here
# instead of asserting and carrying on.
# Every path this suite CARRIES FORWARD goes through here. The few places that
# use "$OUT" inline, in sections (c) and (d), are single read-only comparisons:
# an empty path there can only make an assertion fail, never mutate or remove
# anything.
require_clone() {
	local var="$1" label="$2"
	case "$OUT" in
	"$WORK"/*) ;;
	*)
		printf 'test-dc-helpers: %s: expected a clone path under %q, got %q — aborting before it reaches git -C or rm\n' \
			"$label" "$WORK" "$OUT" >&2
		exit 1
		;;
	esac
	[ -d "$OUT/.git" ] || {
		printf 'test-dc-helpers: %s: %q is not a clone — aborting before it reaches git -C or rm\n' \
			"$label" "$OUT" >&2
		exit 1
	}
	printf -v "$var" '%s' "$OUT"
}

# Inode number of a path, GNU stat first and BSD stat as the fallback.
inode_of() {
	local path="$1"
	stat -c '%i' -- "$path" 2>/dev/null || stat -f '%i' -- "$path"
}

# refs, and the full set of reachable objects, as comparable strings. The ref
# comparison includes %(symref), so a mirror that flattened a symbolic ref into a
# direct one at the same commit does not pass as exact.
refs_of() { git -C "$1" for-each-ref --format='%(refname) %(objectname) %(symref)'; }
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
	# Through the `g` wrapper: `notes add` writes a notes COMMIT, so it needs an
	# identity the hermetic environment above deliberately withholds. Its stderr is
	# NOT swallowed: `set -e` aborts the whole run if this fails, and a run that
	# dies with no diagnostic at all is the "why did this die?" experience the
	# missing wrapper produced. Adding a fresh note prints nothing on stdout, so
	# only that side needs quieting.
	g -C "$dir" notes add -f -m "a note" HEAD >/dev/null
	printf 'stashed\n' >"$dir/file.txt"
	g -C "$dir" stash -q
	g -C "$dir" branch -q other HEAD~1
	# A symbolic ref — what every real clone has as refs/remotes/origin/HEAD.
	git -C "$dir" update-ref refs/remotes/origin/main HEAD
	git -C "$dir" symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main
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
# `wc -l` is compared as a string, and BSD wc pads its count with leading spaces,
# so the whitespace is stripped rather than trusted to be absent.
assert_eq "a: stdout is exactly one line" "$(wc -l <<<"$OUT" | tr -d '[:space:]')" 1
require_clone CLONE_A "a: probe"
assert_true "a: clone is a git repository" "$([ -d "$CLONE_A/.git" ] && echo true || echo false)"
assert_true "a: clone is outside the source" "$(case "$CLONE_A" in "$SRC1"/*) echo false ;; *) echo true ;; esac)"
assert_eq "a: clone tree is clean" "$(git -C "$CLONE_A" status --porcelain)" ""
assert_eq "a: no remote points back at the source" "$(git -C "$CLONE_A" remote)" ""
# ... and no config left naming the remote the clone no longer has, which would
# make a stray push fail with "does not appear to be a git repository" rather
# than the honest "no upstream".
assert_eq "a: no stale remote or upstream config survives" \
	"$(git -C "$CLONE_A" config --get-regexp '^(remote|branch)\.' || true)" ""
assert_eq "a: uncommitted source changes are not carried" "$(cat "$CLONE_A/file.txt")" "tracked"
# An empty first argument is rejected as the empty SLUG it is, rather than
# sliding the next argument into the slug's place.
in_repo "$SRC1" "$DC_ENTER" "" probe
assert_ne "a: an empty slug is refused even with a second argument" "$RC" 0
assert_eq "a: the empty-slug refusal is silent on stdout" "$OUT" ""
in_repo "$SRC1" "$DC_ENTER" probe ""
assert_ne "a: an empty <ref> is refused" "$RC" 0
assert_eq "a: the empty-ref refusal is silent on stdout" "$OUT" ""
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
# Deliberately NOT through the `g` wrapper, which every other fixture commit
# uses: the wrapper supplies an identity of its own, so a clone whose fallback
# identity dc-enter failed to configure would commit just the same and the check
# below would prove nothing. Nothing else in this environment offers one — the
# probe at the top of the run asserts that — so this succeeds only because
# dc-enter filled the gap itself.
in_repo "$CLONE_A" git commit -q --allow-empty -m "clone-only commit"
assert_eq "b: the clone can commit with no identity available anywhere" "$RC" 0
git -C "$CLONE_A" reflog expire --expire=now --all
git -C "$CLONE_A" gc --prune=now --quiet
assert_eq "b: source refs unchanged" "$(refs_of "$SRC1")" "$REFS_BEFORE"
assert_eq "b: source reachable objects unchanged" "$(objects_of "$SRC1")" "$OBJS_BEFORE"
in_repo "$SRC1" git fsck --no-progress --no-dangling --connectivity-only
assert_eq "b: source still passes fsck" "$RC" 0
assert_eq "b: the unreachable ref's commit survives in the source" \
	"$(git -C "$SRC1" cat-file -t "$(git -C "$SRC1" rev-parse refs/pruned/reserved)")" "commit"
assert_contains "b: clone accepted a commit" "$(git -C "$CLONE_A" log -1 --format=%s)" "clone-only commit"

# A caller carrying `GIT_CONFIG` in its environment. `git config` is the only
# command that honours it, and `git config` is precisely what dc-enter uses to
# detach the clone's remote, clear its stale upstream configuration, and fill its
# identity — so an inherited one aims all of that at the caller's file. dc-enter
# drops the variable; without that it dies at the first of those calls with
# `no such section: remote.dc-source`, blaming the clone for the caller's
# environment, and produces no clone at all.
mkdir -p "$WORK/b"
GIT_CONFIG_EXTERNAL="$WORK/b/external.gitconfig"
printf '[dc]\n\tsentinel = untouched\n' >"$GIT_CONFIG_EXTERNAL"
GIT_CONFIG_EXTERNAL_BEFORE="$(cat "$GIT_CONFIG_EXTERNAL")"
in_repo "$SRC1" env "GIT_CONFIG=$GIT_CONFIG_EXTERNAL" "$DC_ENTER" gitconfigenv
assert_eq "b: an inherited GIT_CONFIG still yields a clone" "$RC" 0
require_clone CLONE_GITCONFIG "b: gitconfigenv"
assert_eq "b: ... whose identity landed in the CLONE's own config" \
	"$(git -C "$CLONE_GITCONFIG" config --local user.email)" "dc-enter@invalid"
assert_eq "b: ... and no stale remote or upstream config survived there either" \
	"$(git -C "$CLONE_GITCONFIG" config --local --get-regexp '^(remote|branch)\.' || true)" ""
assert_eq "b: ... leaving the file GIT_CONFIG named untouched" \
	"$(cat "$GIT_CONFIG_EXTERNAL")" "$GIT_CONFIG_EXTERNAL_BEFORE"

# The same boundary from the other side: a caller whose own global config carries
# a `branch.<name>.*` setting. `branch.main.rebase = true` is an everyday one, and
# the branch it names is the one the fixture's clone actually has. dc-enter
# enumerates the clone's stale upstream config `--local`; read merged instead, the
# loop is handed a key that lives only in the caller's file, `--unset-all` finds
# nothing local to remove, and the helper dies naming a key it never wrote. The
# clone still has to come out with no remote or upstream config of its own.
GLOBAL_BRANCH_CFG="$WORK/b/global-branch.gitconfig"
printf '[user]\n\tuseConfigOnly = true\n[branch "main"]\n\trebase = true\n' >"$GLOBAL_BRANCH_CFG"
in_repo "$SRC1" env "GIT_CONFIG_GLOBAL=$GLOBAL_BRANCH_CFG" "$DC_ENTER" globalbranchcfg
assert_eq "b: a caller's global branch.<name>.* still yields a clone" "$RC" 0
require_clone CLONE_GLOBALBRANCH "b: globalbranchcfg"
assert_eq "b: ... with no remote or upstream config of its own left behind" \
	"$(git -C "$CLONE_GLOBALBRANCH" config --local --get-regexp '^(remote|branch)\.' || true)" ""
assert_eq "b: ... and the caller's global config untouched" \
	"$(git config --file "$GLOBAL_BRANCH_CFG" --get branch.main.rebase)" "true"

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
require_clone CLONE_C "c: fromwt"
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
# A fully qualified local head names its branch just as plainly as the short
# form: it resolves as a commit like any other revision, so without normalization
# it would detach despite naming a branch.
in_repo "$WT2" "$DC_ENTER" byfullref refs/heads/other
assert_eq "c: a fully qualified refs/heads/ ref exits 0" "$RC" 0
assert_eq "c: a fully qualified refs/heads/ ref checks that branch out" \
	"$(git -C "$OUT" symbolic-ref HEAD)" "refs/heads/other"
# No other qualified form is normalized — a remote-tracking ref is not a local
# branch and detaches, which is what the header promises.
in_repo "$WT2" "$DC_ENTER" byremoteref refs/remotes/origin/main
assert_eq "c: a remote-tracking ref exits 0" "$RC" 0
assert_eq "c: a remote-tracking ref detaches" \
	"$(git -C "$OUT" symbolic-ref -q HEAD || echo DETACHED)" "DETACHED"
# A non-branch revision detaches at the resolved commit.
in_repo "$WT2" "$DC_ENTER" bytag v1
assert_eq "c: explicit tag exits 0" "$RC" 0
assert_eq "c: explicit tag detaches" "$(git -C "$OUT" symbolic-ref -q HEAD || echo DETACHED)" "DETACHED"
assert_eq "c: explicit tag is at the tag's commit" \
	"$(git -C "$OUT" rev-parse HEAD)" "$(git -C "$SRC2" rev-parse "v1^{commit}")"
# A short name that is BOTH a local branch and a tag, at different commits.
# gitrevisions disambiguates it as the TAG, so a helper that resolved the commit
# from the bare name would check the branch out, see a HEAD that disagrees with
# the commit it resolved, and detach at the tag — verifying the wrong thing while
# blaming a ref that never moved. The documented contract is that a local branch
# is checked out, so the branch must win.
g -C "$SRC2" branch -q ambig main~1
g -C "$SRC2" tag ambig main
assert_ne "c: the ambiguous fixture's branch and tag differ" \
	"$(git -C "$SRC2" rev-parse "refs/heads/ambig")" "$(git -C "$SRC2" rev-parse "refs/tags/ambig^{commit}")"
in_repo "$WT2" "$DC_ENTER" ambig ambig
assert_eq "c: an ambiguous branch/tag name exits 0" "$RC" 0
assert_eq "c: an ambiguous name checks the BRANCH out, not the tag" \
	"$(git -C "$OUT" symbolic-ref -q HEAD || echo DETACHED)" "refs/heads/ambig"
assert_eq "c: an ambiguous name is at the branch's commit" \
	"$(git -C "$OUT" rev-parse HEAD)" "$(git -C "$SRC2" rev-parse "refs/heads/ambig")"
# Only refs/heads/ is normalized, so the qualified tag form still detaches at the
# tag even though a same-named branch exists.
in_repo "$WT2" "$DC_ENTER" ambigtag refs/tags/ambig
assert_eq "c: the qualified tag form of an ambiguous name exits 0" "$RC" 0
assert_eq "c: the qualified tag form still detaches" \
	"$(git -C "$OUT" symbolic-ref -q HEAD || echo DETACHED)" "DETACHED"
assert_eq "c: the qualified tag form is at the tag's commit" \
	"$(git -C "$OUT" rev-parse HEAD)" "$(git -C "$SRC2" rev-parse "refs/tags/ambig^{commit}")"
# ... including in the pathological repository where a LOCAL BRANCH is named
# literally `refs/tags/ambig` or `tags/ambig`. Both are legal branch names, and
# both make the qualified form the caller wrote ALSO look like the short name of
# a branch. git resolves the caller's string first as a full ref name and then as
# `refs/<name>`, reaching the tag either way, so the helper must too: checking the
# branch out instead would verify a commit the caller's own ref does not point at
# — the wrong-commit conclusion the <ref> interface exists to prevent — and no
# refusal or warning would say so.
g -C "$SRC2" branch -q "refs/tags/ambig" main~1
g -C "$SRC2" branch -q "tags/ambig" main~1
assert_ne "c: the same-named branches sit at a different commit from the tag" \
	"$(git -C "$SRC2" rev-parse "refs/heads/refs/tags/ambig")" \
	"$(git -C "$SRC2" rev-parse "refs/tags/ambig^{commit}")"
in_repo "$WT2" "$DC_ENTER" qualtagbranch refs/tags/ambig
assert_eq "c: a branch named like the qualified tag exits 0" "$RC" 0
assert_eq "c: a branch named like the qualified tag does not win: HEAD detaches" \
	"$(git -C "$OUT" symbolic-ref -q HEAD || echo DETACHED)" "DETACHED"
assert_eq "c: ... at the tag's commit, not that branch's" \
	"$(git -C "$OUT" rev-parse HEAD)" "$(git -C "$SRC2" rev-parse "refs/tags/ambig^{commit}")"
in_repo "$WT2" "$DC_ENTER" halfqualbranch tags/ambig
assert_eq "c: a branch named like the refs/-relative tag exits 0" "$RC" 0
assert_eq "c: a branch named like the refs/-relative tag does not win: HEAD detaches" \
	"$(git -C "$OUT" symbolic-ref -q HEAD || echo DETACHED)" "DETACHED"
assert_eq "c: ... also at the tag's commit" \
	"$(git -C "$OUT" rev-parse HEAD)" "$(git -C "$SRC2" rev-parse "refs/tags/ambig^{commit}")"
g -C "$SRC2" branch -q -D "refs/tags/ambig"
g -C "$SRC2" branch -q -D "tags/ambig"
# ... and in the repository carrying a PSEUDO-REF beside a same-named branch.
# `ORIG_HEAD`, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD` and `BISECT_HEAD`
# live in `$GIT_DIR`, and git's rules reach them BEFORE `refs/heads/<name>` — so
# in a repository stopped mid-rebase, mid-merge or mid-cherry-pick that also
# carries a branch called `ORIG_HEAD`, the caller's `ORIG_HEAD` is the pseudo-ref.
# The same guard that handles the qualified forms above already covers this,
# because `git show-ref --verify` reports a pseudo-ref that exists and stays
# silent when it does not — but that agreement is the whole reason the guard is
# correct here and nothing in its own text says so, so it is pinned rather than
# reasoned about. Getting it wrong hands back the branch's commit while the
# caller's own `git rev-parse ORIG_HEAD` names the other one.
# These are per-WORKTREE, which is the shape that matters: dc-enter resolves in
# the INVOKING worktree, so the fixture writes them into that worktree's own git
# directory rather than the shared one.
WT2_GIT_DIR="$(git -C "$WT2" rev-parse --absolute-git-dir)"
for pseudo in ORIG_HEAD MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_HEAD; do
	pseudo_slug="$(printf '%s' "$pseudo" | tr 'A-Z_' 'a-z-')"
	g -C "$SRC2" branch -q "$pseudo" main
	git -C "$WT2" rev-parse --verify main~1 >"$WT2_GIT_DIR/$pseudo"
	assert_ne "c: the $pseudo fixture's pseudo-ref and branch differ" \
		"$(git -C "$WT2" rev-parse --verify "$pseudo")" \
		"$(git -C "$WT2" rev-parse --verify "refs/heads/$pseudo")"
	in_repo "$WT2" "$DC_ENTER" "pseudo-$pseudo_slug" "$pseudo"
	assert_eq "c: $pseudo beside a same-named branch exits 0" "$RC" 0
	assert_eq "c: the $pseudo branch does not win: HEAD detaches" \
		"$(git -C "$OUT" symbolic-ref -q HEAD || echo DETACHED)" "DETACHED"
	assert_eq "c: ... at the commit git rev-parse $pseudo names, not the branch's" \
		"$(git -C "$OUT" rev-parse HEAD)" "$(git -C "$WT2" rev-parse --verify "$pseudo^{commit}")"
	# The other side of the same guard: with no pseudo-ref present the string is
	# an ordinary short branch name again and the branch IS checked out, so
	# clearing the candidate is never over-eager.
	rm -f -- "$WT2_GIT_DIR/$pseudo"
	in_repo "$WT2" "$DC_ENTER" "branch-$pseudo_slug" "$pseudo"
	assert_eq "c: $pseudo with no pseudo-ref present exits 0" "$RC" 0
	assert_eq "c: ... names the branch, which is checked out" \
		"$(git -C "$OUT" symbolic-ref -q HEAD || echo DETACHED)" "refs/heads/$pseudo"
	g -C "$SRC2" branch -q -D "$pseudo"
done
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
# A symbolic ref whose target does not exist: `for-each-ref` does not report one,
# so the enumeration cannot see it and it is the one documented gap in the
# mirror. Added only here, because `git fsck` reports it as a broken ref and
# sections (b) and (j) assert a clean source.
git -C "$SRC2" symbolic-ref refs/dangling/sym refs/heads/does-not-exist
in_repo "$SRC2" "$DC_ENTER" mirror
assert_eq "d: exits 0" "$RC" 0
require_clone CLONE_D "d: mirror"
assert_eq "d: every ref mirrored at its original name" "$(refs_of "$CLONE_D")" "$(refs_of "$SRC2")"
assert_contains "d: a non-standard namespace is present" "$(refs_of "$CLONE_D")" "refs/pruned/reserved"
assert_contains "d: pre-rebase reservations are present" "$(refs_of "$CLONE_D")" "refs/pre-rebase/main"
assert_contains "d: notes are present" "$(refs_of "$CLONE_D")" "refs/notes/commits"
assert_contains "d: the stash ref is present" "$(refs_of "$CLONE_D")" "refs/stash"
assert_eq "d: a symbolic source ref arrives symbolic, not flattened" \
	"$(git -C "$CLONE_D" symbolic-ref refs/remotes/origin/HEAD)" "refs/remotes/origin/main"
in_repo "$SRC2" git symbolic-ref --quiet "refs/dangling/sym"
assert_eq "d: the source really does hold a dangling symref" "$RC" 0
in_repo "$CLONE_D" git symbolic-ref --quiet "refs/dangling/sym"
assert_ne "d: a dangling source symref cannot come across (for-each-ref hides it)" "$RC" 0
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
# A source that hides a namespace from upload-pack still mirrors exactly. This is
# what makes "exact" a property of the ref store rather than of what the source
# chooses to advertise: a `+refs/*:refs/*` fetch would silently drop these, and a
# subagent verifying behaviour IN refs/pruned/ would conclude the reservation
# vanished for entirely the wrong reason.
SRC_HIDDEN="$WORK/d/hidden"
mkdir -p "$WORK/d"
make_source "$SRC_HIDDEN"
git -C "$SRC_HIDDEN" config uploadpack.hideRefs refs/pruned
git -C "$SRC_HIDDEN" config transfer.hideRefs refs/pre-rebase
export DC_ROOT="$WORK/d/root"
assert_eq "d: the fixture really does hide those refs from upload-pack" \
	"$(git ls-remote "$SRC_HIDDEN" 'refs/pruned/*' 'refs/pre-rebase/*')" ""
in_repo "$SRC_HIDDEN" "$DC_ENTER" hidden
assert_eq "d: a source hiding refs from upload-pack exits 0" "$RC" 0
assert_eq "d: ... and still mirrors exactly" "$(refs_of "$OUT")" "$(refs_of "$SRC_HIDDEN")"
assert_contains "d: ... including the hidden namespace" "$(refs_of "$OUT")" "refs/pruned/reserved"
assert_eq "d: ... with the hidden ref's object present" \
	"$(git -C "$OUT" cat-file -t "$(git -C "$SRC_HIDDEN" rev-parse refs/pruned/reserved)")" "commit"

echo "== (e) clone-root refusals and a worktree listing that fails closed =="
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
require_clone CLONE_E "e: scoped"
SCOPE_E="$(dirname "$(dirname "$CLONE_E")")"
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

# A git that cannot enumerate worktrees unambiguously is refused rather than
# parsed with the newline form, which cannot distinguish a path containing a
# newline from a record boundary.
mkdir -p "$WORK/e/nozbin"
cat >"$WORK/e/nozbin/git" <<'SHIM'
#!/usr/bin/env bash
# Pretends to be a git predating `git worktree list -z`.
for a in "$@"; do
	if [ "$a" = "-z" ]; then
		for b in "$@"; do
			if [ "$b" = "worktree" ]; then
				echo "error: unknown option \`z'" >&2
				exit 129
			fi
		done
	fi
done
exec "$REAL_GIT" "$@"
SHIM
chmod +x "$WORK/e/nozbin/git"
in_repo "$SRC3" env "REAL_GIT=$(command -v git)" "PATH=$WORK/e/nozbin:$PATH" "DC_ROOT=$WORK/e/root" "$DC_ENTER" noz
assert_ne "e: refuses a git that cannot list worktrees with -z" "$RC" 0
assert_eq "e: that refusal is silent on stdout" "$OUT" ""
assert_contains "e: that refusal names the missing capability" "$ERR" "worktree list --porcelain -z"
in_repo "$SRC3" env "REAL_GIT=$(command -v git)" "PATH=$WORK/e/nozbin:$PATH" "DC_ROOT=$WORK/e/root" "$DC_REMOVE" noz
assert_ne "e: dc-remove refuses the same git" "$RC" 0

# A listing that SUCCEEDS but reports no worktree records at all is not "this
# repository has no worktrees" — every repository has at least its main one. It
# is a listing that cannot be trusted, and trusting it would leave the clone free
# to land inside a worktree the helper never heard of.
mkdir -p "$WORK/e/emptybin"
cat >"$WORK/e/emptybin/git" <<'SHIM'
#!/usr/bin/env bash
# Pretends to be a git whose worktree listing comes back empty.
prev=""
for a in "$@"; do
	if [ "$prev" = "worktree" ] && [ "$a" = "list" ]; then exit 0; fi
	prev="$a"
done
exec "$REAL_GIT" "$@"
SHIM
chmod +x "$WORK/e/emptybin/git"
in_repo "$SRC3" env "REAL_GIT=$(command -v git)" "PATH=$WORK/e/emptybin:$PATH" "DC_ROOT=$WORK/e/root" "$DC_ENTER" nowt
assert_ne "e: refuses a worktree listing carrying no records" "$RC" 0
assert_eq "e: that refusal is silent on stdout" "$OUT" ""
assert_contains "e: that refusal says the listing cannot be trusted" "$ERR" "reported no worktrees"
in_repo "$SRC3" env "REAL_GIT=$(command -v git)" "PATH=$WORK/e/emptybin:$PATH" "DC_ROOT=$WORK/e/root" "$DC_REMOVE" nowt
assert_ne "e: dc-remove refuses an empty listing too" "$RC" 0

# A listing that fails for a reason other than an old git must not be reported as
# a version problem: git's own message is carried through, or the reader chases
# the wrong bug.
mkdir -p "$WORK/e/errbin"
cat >"$WORK/e/errbin/git" <<'SHIM'
#!/usr/bin/env bash
# Pretends to be a current git tripping over a broken worktree registration.
prev=""
for a in "$@"; do
	if [ "$prev" = "worktree" ] && [ "$a" = "list" ]; then
		echo "fatal: could not read '.git/worktrees/broken/gitdir'" >&2
		exit 128
	fi
	prev="$a"
done
exec "$REAL_GIT" "$@"
SHIM
chmod +x "$WORK/e/errbin/git"
in_repo "$SRC3" env "REAL_GIT=$(command -v git)" "PATH=$WORK/e/errbin:$PATH" "DC_ROOT=$WORK/e/root" "$DC_ENTER" brokenwt
assert_ne "e: refuses a worktree listing that errors" "$RC" 0
assert_eq "e: that refusal is silent on stdout" "$OUT" ""
assert_contains "e: that refusal carries git's own diagnosis" "$ERR" ".git/worktrees/broken/gitdir"

# A malformed slug never reaches the filesystem.
for badslug in "../escape" "a/b" "" "-x" ".hidden"; do
	in_repo "$SRC3" env "DC_ROOT=$WORK/e/root" "$DC_ENTER" "$badslug"
	assert_ne "e: refuses slug '$badslug'" "$RC" 0
	assert_eq "e: refuses slug '$badslug' silently on stdout" "$OUT" ""
done

echo "== (f) an existing clone is refused; --replace re-derives it pristine =="
export DC_ROOT="$WORK/f/root"
SRC4="$WORK/f/src"
mkdir -p "$WORK/f"
make_source "$SRC4"
in_repo "$SRC4" "$DC_ENTER" reuse
assert_eq "f: first call exits 0" "$RC" 0
require_clone CLONE_F "f: reuse"
# Wreck it the way an experiment would: delete refs, collect objects, dirty and
# litter the tree, and remove a tracked file.
git -C "$CLONE_F" update-ref -d refs/pruned/reserved
git -C "$CLONE_F" update-ref -d refs/pre-rebase/main
git -C "$CLONE_F" gc --prune=now --quiet
printf 'wrecked\n' >"$CLONE_F/file.txt"
printf 'litter\n' >"$CLONE_F/untracked.txt"
# A second call REFUSES rather than discarding it. That is what makes the helper
# safe for concurrent siblings: sibling subagents of one container share both an
# identity and a worktree, so they derive this very path, and a re-derivation
# would pull the refs and objects out from under one mid-verification.
in_repo "$SRC4" "$DC_ENTER" reuse
assert_ne "f: a second call on an existing clone exits non-zero" "$RC" 0
assert_eq "f: that refusal is silent on stdout" "$OUT" ""
assert_contains "f: that refusal says the slug is taken" "$ERR" "already has a clone"
assert_contains "f: that refusal offers --replace" "$ERR" "--replace"
assert_eq "f: the existing clone is left exactly as it was" "$(cat "$CLONE_F/file.txt")" "wrecked"
assert_true "f: including its litter" "$([ -e "$CLONE_F/untracked.txt" ] && echo true || echo false)"
# --replace is the explicit "that clone is mine and I am done with it".
in_repo "$SRC4" "$DC_ENTER" --replace reuse
assert_eq "f: --replace exits 0" "$RC" 0
assert_eq "f: --replace returns the same deterministic path" "$OUT" "$CLONE_F"
assert_eq "f: the wreckage is gone — refs are pristine again" "$(refs_of "$CLONE_F")" "$(refs_of "$SRC4")"
assert_eq "f: the wreckage is gone — tree is clean" "$(git -C "$CLONE_F" status --porcelain)" ""
assert_eq "f: the wreckage is gone — tracked content restored" "$(cat "$CLONE_F/file.txt")" "tracked"
assert_true "f: the wreckage is gone — litter removed" \
	"$([ ! -e "$CLONE_F/untracked.txt" ] && echo true || echo false)"
assert_contains "f: the discard is announced on stderr" "$ERR" "discarding the existing clone"
# Even a clone whose .git was destroyed is re-derived by --replace rather than
# refused: the marker that proves ownership lives beside the clone, not inside it.
rm -rf "$CLONE_F/.git"
in_repo "$SRC4" "$DC_ENTER" --replace reuse
assert_eq "f: a clone whose .git was destroyed is re-derived" "$RC" 0
assert_eq "f: re-derived clone is a repository again" \
	"$(git -C "$CLONE_F" rev-parse --is-inside-work-tree)" "true"
# The destructive helper applies the SAME ownership proof as dc-remove: a marker
# carrying the right magic but recording another clone path, or another source
# repository, is not this invocation's to discard even with --replace.
in_repo "$SRC4" "$DC_ENTER" mismatched
require_clone CLONE_MM "f: mismatched"
SESSION_MM="$(dirname "$CLONE_MM")"
printf 'precious\n' >"$SESSION_MM/precious.txt"
printf 'dc-clone-v2\0helper=dc-enter\0clone=/somewhere/else/repo\0source=%s\0' "$SRC4" \
	>"$SESSION_MM/dc-clone-meta"
in_repo "$SRC4" "$DC_ENTER" --replace mismatched
assert_ne "f: --replace refuses a marker recording another clone path" "$RC" 0
assert_eq "f: that refusal is silent on stdout" "$OUT" ""
assert_eq "f: the mis-marked directory's contents survive" "$(cat "$SESSION_MM/precious.txt")" "precious"
printf 'dc-clone-v2\0helper=dc-enter\0clone=%s\0source=/somewhere/else\0' "$CLONE_MM" \
	>"$SESSION_MM/dc-clone-meta"
in_repo "$SRC4" "$DC_ENTER" --replace mismatched
assert_ne "f: --replace refuses a marker recording another source repository" "$RC" 0
assert_eq "f: the mis-marked directory still survives" "$(cat "$SESSION_MM/precious.txt")" "precious"
# dc-remove refuses the source mismatch for the same reason: the scope component
# is a CRC32 of the worktree path, so comparing the path itself turns a hash
# collision between two worktrees into a refusal rather than a silent merge.
in_repo "$SRC4" "$DC_REMOVE" mismatched
assert_ne "f: dc-remove refuses the same source mismatch" "$RC" 0
assert_contains "f: and says which source it expected" "$ERR" "records source repository"
rm -rf "$SESSION_MM"
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
require_clone PATH_ONE "g: shared/agent-one"
in_repo "$SRC4" env "DC_AGENT=agent-two" "$DC_ENTER" shared
require_clone PATH_TWO "g: shared/agent-two"
assert_ne "g: two agents do not collide on one slug" "$PATH_ONE" "$PATH_TWO"
assert_true "g: both agents' clones exist at once" \
	"$([ -d "$PATH_ONE/.git" ] && [ -d "$PATH_TWO/.git" ] && echo true || echo false)"
in_repo "$WORK/f/src-wt" "$DC_ENTER" shared
assert_ne "g: two worktrees of one repository do not collide on a slug" "$OUT" "$PATH_ONE"
in_repo "$SRC4" "$DC_ENTER" stable
require_clone FIRST_STABLE "g: stable"
in_repo "$SRC4" "$DC_REMOVE" stable
in_repo "$SRC4" "$DC_ENTER" stable
assert_eq "g: the same agent, worktree, and slug resolve to one path" "$OUT" "$FIRST_STABLE"
# This repository's own fan-out model: several subagents of ONE container share
# $CONTAINER_NAME and a worktree, so nothing distinguishes them and they derive
# the same path. The second must refuse, leaving the first's clone whole — this
# is the case a per-agent path component alone cannot separate.
in_repo "$SRC4" env "DC_AGENT=" "CONTAINER_NAME=one-container" "$DC_ENTER" sibling
assert_eq "g: the first sibling gets a clone" "$RC" 0
require_clone SIBLING_ONE "g: sibling"
git -C "$SIBLING_ONE" update-ref refs/heads/mid-verification HEAD
in_repo "$SRC4" env "DC_AGENT=" "CONTAINER_NAME=one-container" "$DC_ENTER" sibling
assert_ne "g: an indistinguishable sibling is refused, not served" "$RC" 0
assert_eq "g: that refusal is silent on stdout" "$OUT" ""
assert_contains "g: that refusal warns about a concurrent sibling" "$ERR" "concurrent sibling"
assert_true "g: the first sibling's clone survives intact" \
	"$([ -d "$SIBLING_ONE/.git" ] && echo true || echo false)"
assert_eq "g: including the ref it was working on" \
	"$(git -C "$SIBLING_ONE" rev-parse --verify refs/heads/mid-verification)" \
	"$(git -C "$SIBLING_ONE" rev-parse HEAD)"
# Distinguishing them with DC_AGENT avoids the contention entirely.
in_repo "$SRC4" env "DC_AGENT=sibling-two" "CONTAINER_NAME=one-container" "$DC_ENTER" sibling
assert_eq "g: a sibling setting DC_AGENT gets its own clone" "$RC" 0
assert_ne "g: ... at a different path" "$OUT" "$SIBLING_ONE"

echo "== (h) dc-remove =="
in_repo "$SRC4" "$DC_ENTER" doomed
require_clone CLONE_H "h: doomed"
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
# An empty first argument is the empty SLUG it is, not a placeholder the next
# argument slides through — the same check section (a) makes on dc-enter. Getting
# it wrong here is worse than there: this helper's answer to a malformed argument
# list would be to REMOVE the clone named by the argument it should have refused.
in_repo "$SRC4" "$DC_ENTER" bystander
require_clone CLONE_BYSTANDER "h: bystander"
in_repo "$SRC4" "$DC_REMOVE" "" bystander
assert_ne "h: an empty slug is refused even with a second argument" "$RC" 0
assert_true "h: the second argument's clone is untouched" \
	"$([ -d "$CLONE_BYSTANDER" ] && echo true || echo false)"
in_repo "$SRC4" "$DC_REMOVE" bystander
assert_eq "h: naming that slug properly still removes it" "$RC" 0
assert_true "h: ... and now it is gone" "$([ ! -e "$CLONE_BYSTANDER" ] && echo true || echo false)"
# A directory at a slug's path that the helper did not create is refused.
in_repo "$SRC4" "$DC_REMOVE" foreign
assert_ne "h: refuses a foreign directory" "$RC" 0
assert_eq "h: the foreign directory survives" "$(cat "$FOREIGN_DIR/keep.txt")" "precious"
# A marker whose recorded clone path is not the one this invocation derived is
# bookkeeping that does not match, so it is refused.
in_repo "$SRC4" "$DC_ENTER" mismarked
require_clone CLONE_MIS "h: mismarked"
MIS_SESSION="$(dirname "$CLONE_MIS")"
printf 'dc-clone-v2\0clone=/somewhere/else/repo\0source=%s\0' "$SRC4" >"$MIS_SESSION/dc-clone-meta"
in_repo "$SRC4" "$DC_REMOVE" mismarked
assert_ne "h: refuses a marker that records another clone path" "$RC" 0
assert_contains "h: the mismatch is explained" "$ERR" "records clone path"
assert_true "h: the mis-marked directory survives" "$([ -d "$CLONE_MIS" ] && echo true || echo false)"
# The two helpers' path derivations agree: dc-remove removes exactly the path
# dc-enter printed.
in_repo "$SRC4" "$DC_ENTER" pinned
require_clone CLONE_PINNED "h: pinned"
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
require_clone CLONE_J "j: nolinks"
SRC_INODE="$(inode_of "$SRC6/$LOOSE_PATH")"
CLONE_INODE="$(inode_of "$CLONE_J/$LOOSE_PATH")"
assert_ne "j: objects are copied, not hardlinked, by default" "$SRC_INODE" "$CLONE_INODE"
in_repo "$SRC6" env "DC_HARDLINKS=1" "$DC_ENTER" links
require_clone CLONE_JL "j: links"
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

echo "== (k) clone-root hygiene: separators, absoluteness, and newlines =="
SRC7="$WORK/k/src"
mkdir -p "$WORK/k/root"
make_source "$SRC7"
unset DC_ROOT
# A repeated separator must COLLAPSE, not vanish: a root of "<work>/k//root"
# resolves to "<work>/k/root", never "<work>/kroot".
in_repo "$SRC7" env "DC_ROOT=$WORK/k//root" "$DC_ENTER" seps
assert_eq "k: a doubled separator in the root is accepted" "$RC" 0
assert_contains "k: ... and collapses to a single one" "$OUT" "$WORK/k/root/"
assert_true "k: ... with the clone really there" "$([ -d "$OUT/.git" ] && echo true || echo false)"
require_clone CLONE_K "k: seps"
in_repo "$SRC7" env "DC_ROOT=$WORK/k///root/" "$DC_REMOVE" seps
assert_eq "k: dc-remove collapses separators identically" "$RC" 0
assert_true "k: ... and removed the clone dc-enter printed" "$([ ! -e "$CLONE_K" ] && echo true || echo false)"
# A RELATIVE root is refused by both helpers rather than resolved against
# whatever directory each happened to be invoked from. Canonicalizing it first
# would make the absolute-path guard unfalsifiable — canon() prepends $PWD and
# asserts its own result is absolute — and the two helpers would then derive
# DIFFERENT clones from one DC_ROOT: dc-enter explicitly supports being run from
# a nested subdirectory (section (c)), so the caller entering from a subdirectory
# and removing from the repository root is a reachable configuration. The clone
# would be created, left behind, and reported as "nothing to remove" with a zero
# exit.
mkdir -p "$SRC7/deep/er"
REL_TARGET="$WORK/k/relroot"
in_repo "$SRC7/deep/er" env "DC_ROOT=../../../relroot" "$DC_ENTER" relroot
assert_ne "k: dc-enter refuses a relative root" "$RC" 0
assert_eq "k: ... silently on stdout" "$OUT" ""
assert_contains "k: ... saying it must be absolute" "$ERR" "must be an absolute path"
assert_true "k: ... and creates nothing where it would have resolved" \
	"$([ ! -e "$REL_TARGET" ] && echo true || echo false)"
in_repo "$SRC7" env "DC_ROOT=../../../relroot" "$DC_REMOVE" relroot
assert_ne "k: dc-remove refuses a relative root too" "$RC" 0
assert_contains "k: ... rather than reporting nothing to remove" "$ERR" "must be an absolute path"
rm -rf "$SRC7/deep"
# A newline in the root is refused by BOTH helpers. dc-enter's whole calling
# convention is one path on one line of stdout — the incident's own script ended
# its clone step with `| tail -n 1` — and a clone created under such a root would
# be unusable through that convention.
NL_ROOT="$WORK/k/ro
ot"
mkdir -p "$NL_ROOT"
in_repo "$SRC7" env "DC_ROOT=$NL_ROOT" "$DC_ENTER" newline
assert_ne "k: dc-enter refuses a root containing a newline" "$RC" 0
assert_eq "k: ... silently on stdout" "$OUT" ""
assert_contains "k: ... saying why" "$ERR" "newline"
assert_eq "k: ... and leaves nothing behind under it" "$(ls -A "$NL_ROOT")" ""
in_repo "$SRC7" env "DC_ROOT=$NL_ROOT" "$DC_REMOVE" newline
assert_ne "k: dc-remove refuses the same root" "$RC" 0
# A root whose newline is the LAST byte is the one that escapes a check made
# after canonicalization: command substitution strips every trailing newline it
# captures, so the refusal saw a newline-free path and the clone landed under
# THAT path instead — succeeding in a directory the caller never named.
mkdir -p "$WORK/k/trailroot"
TRAIL_ROOT="$WORK/k/trailroot
"
in_repo "$SRC7" env "DC_ROOT=$TRAIL_ROOT" "$DC_ENTER" trailnl
assert_ne "k: dc-enter refuses a root ending in a newline" "$RC" 0
assert_eq "k: ... silently on stdout" "$OUT" ""
assert_contains "k: ... saying why" "$ERR" "newline"
assert_eq "k: ... rather than silently using the newline-free path" "$(ls -A "$WORK/k/trailroot")" ""
in_repo "$SRC7" env "DC_ROOT=$TRAIL_ROOT" "$DC_REMOVE" trailnl
assert_ne "k: dc-remove refuses a root ending in a newline" "$RC" 0
# ... and a root that acquires a newline only when RESOLVED — the raw value is
# clean, but a symlinked component points at a directory whose real name is not.
# This one can only be caught after canonicalization, which is why both helpers
# check the raw value AND the resolved one.
NL_REAL="$WORK/k/re
al"
mkdir -p "$NL_REAL"
ln -s "$NL_REAL" "$WORK/k/nl-link"
in_repo "$SRC7" env "DC_ROOT=$WORK/k/nl-link" "$DC_ENTER" vianl
assert_ne "k: dc-enter refuses a root RESOLVING into a newline-bearing path" "$RC" 0
assert_eq "k: ... silently on stdout" "$OUT" ""
assert_contains "k: ... saying why" "$ERR" "newline"
assert_eq "k: ... and leaves nothing behind under the real directory" "$(ls -A "$NL_REAL")" ""
in_repo "$SRC7" env "DC_ROOT=$WORK/k/nl-link" "$DC_REMOVE" vianl
assert_ne "k: dc-remove refuses the same resolved root" "$RC" 0
# The SOURCE repository's path is not the helper's to choose, so a newline there
# still works: the marker is NUL-delimited, so it records such a path
# unambiguously and dc-remove can still prove ownership from it.
NL_SRC="$WORK/k/sr
c"
make_source "$NL_SRC"
in_repo "$NL_SRC" env "DC_ROOT=$WORK/k/root" "$DC_ENTER" nlsource
assert_eq "k: a source path containing a newline is fine" "$RC" 0
assert_eq "k: ... and mirrors exactly" "$(refs_of "$OUT")" "$(refs_of "$NL_SRC")"
require_clone CLONE_NL "k: nlsource"
in_repo "$NL_SRC" env "DC_ROOT=$WORK/k/root" "$DC_REMOVE" nlsource
assert_eq "k: ... and dc-remove parses its marker and removes it" "$RC" 0
assert_true "k: ... leaving nothing" "$([ ! -e "$CLONE_NL" ] && echo true || echo false)"
# The source path a bare `$(git rev-parse --show-toplevel)` cannot survive: its
# newline is the LAST byte, and command substitution strips it, so the helper
# would derive a different directory. The decoy below IS that directory, and it
# is a repository too — so the mistake would not fail loudly, it would quietly
# clone the wrong repository and hand a subagent the wrong-baseline conclusion
# these helpers exist to prevent.
TRAIL_SRC="$WORK/k/tsrc
"
make_source "$TRAIL_SRC"
DECOY_SRC="$WORK/k/tsrc"
git init -q -b main "$DECOY_SRC"
g -C "$DECOY_SRC" commit -q --allow-empty -m "decoy only"
g -C "$DECOY_SRC" branch -q decoy-only
in_repo "$TRAIL_SRC" env "DC_ROOT=$WORK/k/root" "$DC_ENTER" trailsrc
assert_eq "k: a source path ENDING in a newline is fine" "$RC" 0
require_clone CLONE_TRAIL "k: trailsrc"
assert_eq "k: ... and mirrors that source exactly" "$(refs_of "$CLONE_TRAIL")" "$(refs_of "$TRAIL_SRC")"
assert_eq "k: ... at that source's HEAD" \
	"$(git -C "$CLONE_TRAIL" rev-parse HEAD)" "$(git -C "$TRAIL_SRC" rev-parse HEAD)"
assert_true "k: ... and not from the decoy repository at the newline-free path" \
	"$(git -C "$CLONE_TRAIL" show-ref --verify --quiet refs/heads/decoy-only && echo false || echo true)"
# dc-remove derives the same source — trailing newline and all — so its ownership
# proof still matches the marker dc-enter wrote.
in_repo "$TRAIL_SRC" env "DC_ROOT=$WORK/k/root" "$DC_REMOVE" trailsrc
assert_eq "k: ... and dc-remove derives the identical source and removes it" "$RC" 0
assert_true "k: ... leaving nothing" "$([ ! -e "$CLONE_TRAIL" ] && echo true || echo false)"

if [ "$fails" -eq 0 ]; then
	printf 'test-dc-helpers: %d checks passed\n' "$checks"
else
	printf 'test-dc-helpers: %d of %d checks FAILED\n' "$fails" "$checks" >&2
	exit 1
fi
