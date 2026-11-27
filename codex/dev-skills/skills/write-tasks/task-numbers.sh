#!/usr/bin/env bash
# task-numbers.sh — which task numbers a branch newly claims, and who else
# holds them: the base it is headed for, and every open pull request; which
# numbers stand twice in the working tree; and which open pull requests change
# a named task file.
#
# Usage, from the checkout that holds the branch, or with `-C <dir>` ahead of
# the command, as git takes it:
#   task-numbers.sh claims --repo <owner>/<repo> (--base <branch> | --local-base <commit>)
#                          [--branch <commit>] [--folder <dir>]
#                          [--reserved <number>]... [--member <commit>:<its base commit>]...
#   task-numbers.sh taken  --repo <owner>/<repo> [--folder <dir>]
#   task-numbers.sh duplicates [--folder <dir>]
#   task-numbers.sh touching --repo <owner>/<repo> --task <path> [--task <path>]...
#
# `<owner>/<repo>` is the repository the pull requests are in; write it
# `<host>/<owner>/<repo>` where that is not github.com. `--folder` is the
# repository's task folder (`tasks`, no trailing slash; `./-x` for a name that starts with a dash). A task file is one whose basename starts
# with a full task number and a dash: three or more digits and an optional
# lowercase letter (`001-`, `001a-`, `042b-`, `1042-`), at any depth under the
# folder, so `done/` and `deferred/` keep their numbers. `001` and `001a` are
# two numbers. A number is compared as it is written, never by its value:
# `0999` and `999` are two numbers as well, neither a collision nor a
# duplicate of the other, so a repository that grows past 999 keeps writing
# its old numbers at the width they have. Fewer than three digits is another
# numbering style.
#
# claims  For the pre-PR guard. `--base` is the branch the scanned branch
#         (`--branch`, else HEAD) is recorded as based on: it is fetched from
#         the repository first, never read from a local or remote-tracking
#         ref. `--local-base` is for a base the repository cannot have (an
#         unpushed dependency branch, a local-only run): that exact commit is
#         read, and an answer with claims says `degraded=`.
#         The branch claims every task file it adds against that base, less
#         its own relocations: within one number, each file it removes pairs
#         with one file it adds (the same basename first, then the one git
#         reads as its rename), so an archive, a deferral or a slug rename
#         claims nothing.
#           claim=<number> TAB <path>
#         Each claim is compared with every other holder of its number:
#           collision=<number> TAB <path> TAB <holder> TAB <holder's path> TAB <same-path|other-path>
#         where <holder> is
#           base        a task file anywhere in the base's tree
#           branch      another task file on the scanned branch itself
#           pr:<N>      a task file an open pull request adds against its own
#                       base (never its whole tree: a head inherits its base's
#                       files without claiming them)
#           member:<commit>
#                       a `--member`, read the same way: a branch of the same
#                       run, whether or not it has a pull request yet
#           reserved    a `--reserved` number, with `-` for the path
#         `same-path` is the one case a plain add/add procedure can take.
#         Then what the scan could not see:
#           skipped=<pr:<N>|prs> TAB <reason>
#                       a head or its base that could not be read, or the
#                       enumeration itself
#           limit=200   the enumeration returned as many pull requests as it
#                       asks for, so later ones cannot be named
#           self=pr:<N> the scanned branch's own open pull request (its head
#                       branch bears the branch's name, or its head is a
#                       commit the scanned branch is or contains): not compared
#         under
#           outcome=clean       no collision, and nothing skipped (exit 0)
#           outcome=collision   at least one (exit 3)
#           outcome=incomplete  no collision among what was read, with a
#                               skipped=, limit= or degraded= line (exit 3)
#         and always base= (the commit read) and claims= (how many).
#         A branch that claims nothing answers `clean` without asking GitHub.
# taken   For allocating a number. Every file standing in the working tree's
#         folder and in the whole tree of every open pull request head:
#           taken=<number> TAB <tree|pr:<N>> TAB <path>
#         <number> is `-` for a file that carries no full task number as
#         above: a repository numbering its tasks another way reads the paths.
#         The lines are sorted as text, so `1000` stands before `999`.
#         under outcome=listed, or outcome=incomplete (exit 3) with the same
#         skipped= and limit= lines. A folder that is not in the working tree
#         lists nothing from it (the first task has no folder yet); one that
#         could not be read whole is a failure, and a symlink is read through.
# duplicates
#         For a cleanup sweep. The working tree's folder alone, tracked or
#         not, and nothing remote: no pull request is read, so none can fail
#         it. Full numbers are compared, as the guard does and the allocator
#         does not: two `024` files are a duplicate whatever their slugs or
#         subfolders, `001` beside `001a` is none.
#           duplicate=<number> TAB <path>
#                       once for every file of a number that stands on more
#                       than one
#           unnumbered=<path>
#                       a file that carries no full task number as above, and
#                       so was compared with nothing: a repository numbering
#                       its tasks another way reads these paths
#         under outcome=clean (exit 0) or outcome=duplicate (exit 3), and
#         always numbered= (how many files carried a full number). A folder
#         that is missing, is no folder, or could not be read whole is a
#         failure, not a clean answer; one that is a symlink is read through.
# touching
#         For a batch about to start. Each `--task` is a task file's path from
#         the top of the working tree, taken as a name and never as a pattern.
#         Every open pull request whose own changes reach one of them:
#           touching=pr:<N> TAB <A|M|D|T> TAB <path>
#         with git's letter for what the head does to the file against where
#         it left its own base (added, modified, deleted, type changed; a
#         move reads as the deletion of the old path). A head that only
#         inherits the file from its base changes nothing and is not listed.
#         No pull request is left out as the caller's own: a task file still
#         being added by an open pull request is listed with `A`.
#         under outcome=clean (exit 0), outcome=touched (exit 3), or
#         outcome=incomplete (exit 3) where nothing read touches one and a
#         head or its base could not be read, with the same skipped= and
#         limit= lines; and always tasks= (how many paths were asked about).
#         This lists and decides nothing: whether a task waits is the
#         caller's reading of the pull request.
#
# One enumeration, `gh pr list --state open --limit 200`, is the whole remote
# reading, and each head is read at the commit it named: a head that moves
# afterwards is not seen. Bases and heads are fetched through `pr-branch.sh`
# of the `address-review` skill, in that skill's folder beside this skill's,
# and from the remote it matched; no FETCH_HEAD is read.
#
# Output: `key=value` lines on stdout, `outcome=` first; an explanation goes to
# stderr. Exit status: 0 on clean and listed; 3 on collision, incomplete,
# duplicate and touched; 1 on a failure (the scanned branch, its base or the folder could
# not be read); 64 on a usage error. Needs git, and gh for the remote reading.
# Written for bash 3.2 and later.
set -u

# gh 2.105 and later, where it takes its caller for a coding agent, ends a PR
# read with a block on stderr that advertises `gh event listen`, and has no
# switch for it. That block alone is dropped here, by its own first line and
# the lines that continue it: every other line gh prints passes through, and
# so does its exit status.
gh() {
	command gh "$@" 2>&1 >&3 3>&- | awk '
		hint == 1 && index($0, "    gh event listen ") == 1 { hint = 2; next }
		hint == 2 && index($0, "  - ") == 1 { next }
		{ hint = 0 }
		$0 == "hint: if you need to wait for this pull request to be reviewed, merged, or closed before continuing, use this instead of polling:" { hint = 1; next }
		{ print }' >&2 3>&-
	return "${PIPESTATUS[0]}"
} 3>&1
# Paths as they are, not C-quoted: they are compared and printed as names.
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.quotePath GIT_CONFIG_VALUE_0=false

TAB="$(printf '\t')"
case "$0" in
/*) SELF="$0" ;;
*) SELF="$PWD/$0" ;;
esac
PRB="$(dirname -- "$SELF")/../address-review/pr-branch.sh"
LIMIT=200

say() { printf '%s\n' "$*"; }
note() { printf 'task-numbers: %s\n' "$*" >&2; }
fail() {
	note "$*"
	exit 1
}
usage() {
	note "$*"
	sed -n '7,14p' "$SELF" | sed 's/^# \{0,1\}//' >&2
	exit 64
}
field() { # key, text
	printf '%s\n' "$2" | awk -v k="$1=" 'index($0, k) == 1 { print substr($0, length(k) + 1); exit }'
}

# Reads paths, prints `<number or -> TAB <path>` for every one.
# shellcheck disable=SC2016 # the $names are awk's
LISTED='{
	b = $0; sub(/.*\//, "", b)
	print (match(b, /^[0-9][0-9][0-9]+[a-z]?-/) ? substr(b, 1, RLENGTH - 1) : "-") "\t" $0
}'
# Reads paths, prints `<number> TAB <path>` for each that is a task file.
# shellcheck disable=SC2016 # the $names are awk's
NUMBERED='{
	b = $0; sub(/.*\//, "", b)
	if (match(b, /^[0-9][0-9][0-9]+[a-z]?-/)) print substr(b, 1, RLENGTH - 1) "\t" $0
}'

CMD="${1:-}"
[ $# -gt 0 ] && shift
case "$CMD" in
-C)
	[ $# -ge 2 ] || usage "-C needs a directory and a command"
	# Behind ./ a relative name is a directory and nothing else: not an
	# option, not `-` for the previous directory, not a CDPATH lookup.
	case "$1" in
	/*) cd "$1" 2>/dev/null || fail "could not enter $1." ;;
	*) cd "./$1" 2>/dev/null || fail "could not enter $1." ;;
	esac
	CMD="$2"
	shift 2
	;;
esac

REPO="" BASE="" LOCAL_BASE="" BRANCH="HEAD" FOLDER="tasks" RESERVED="" MEMBERS=""
TASKS=()
while [ $# -gt 0 ]; do
	case "$1" in
	--repo | --base | --local-base | --branch | --folder | --reserved | --member | --task)
		[ $# -ge 2 ] || usage "$1 needs a value"
		case "$1" in
		--repo) REPO="$2" ;;
		--base) BASE="$2" ;;
		--local-base) LOCAL_BASE="$2" ;;
		--branch) BRANCH="$2" ;;
		--folder) FOLDER="$2" ;;
		--reserved)
			printf '%s\n' "$2" | grep -Eq '^[0-9]{3,}[a-z]?$' || usage "--reserved takes a full task number such as 024, 024a or 1024"
			RESERVED="$RESERVED$2
"
			;;
		--member)
			case "$2" in
			?*:?*) ;;
			*) usage "--member takes <commit>:<its base commit>" ;;
			esac
			MEMBERS="$MEMBERS$2
"
			;;
		--task)
			case "$2" in
			'' | /* | *"$TAB"*) usage "--task takes a task file's path from the top of the working tree" ;;
			esac
			TASKS[${#TASKS[@]}]="${2#./}"
			;;
		esac
		shift 2
		;;
	*) usage "unknown argument: $1" ;;
	esac
done

need_common() {
	case "$REPO" in
	?*/?*) ;;
	*) usage "--repo <owner>/<repo> is required (the repository the pull requests are in)" ;;
	esac
	need_tree
}
need_tree() {
	[ -n "$FOLDER" ] || usage "--folder cannot be empty"
	# The folder reaches find as its starting point, where a leading dash
	# would be read as an expression.
	case "$FOLDER" in
	-*) usage "--folder takes a path, not an option: write ./$FOLDER for a folder so named" ;;
	esac
	git rev-parse --git-dir >/dev/null 2>&1 || fail "this is not a git repository."
	# From the top of the working tree: the folder is a path from there, and
	# a pathspec read from a subdirectory would match nothing and look clean.
	local top
	if top="$(git rev-parse --show-toplevel 2>/dev/null)" && [ -n "$top" ]; then
		cd "$top" || fail "could not enter $top."
	fi
	tmp="$(mktemp -d "${TMPDIR:-/tmp}/task-numbers.XXXXXX")" || fail "could not create a temporary directory."
	# shellcheck disable=SC2064 # expand now: the directory this run made
	trap "rm -rf '$tmp'" EXIT
	: >"$tmp/gaps"
	: >"$tmp/bases"
	: >"$tmp/pin.err"
}
gap() { say "$*" >>"$tmp/gaps"; }

# Every file under the folder of the working tree at <top>, into $tmp/files;
# fails where find could not read it whole, its reason in $tmp/err.
tree_files() { # top
	local from
	# Behind ./ no folder name (`!`, `(`) is an expression to find; the paths
	# are printed without it. -H: a folder that is a symlink is read through.
	case "$FOLDER" in
	/*) from="$FOLDER" ;;
	*) from="./$FOLDER" ;;
	esac
	(cd "$1" && find -H "$from" -type f) >"$tmp/found" 2>"$tmp/err" || return 1
	sed 's|^\./||' "$tmp/found" >"$tmp/files"
}

# A branch of the repository, fetched once per run: prints `<remote> TAB
# <oid>`. Why it failed is left in $tmp/pin.err.
pin() { # branch
	local out hit
	hit="$(awk -F "$TAB" -v b="$1" '$1 == b { print $2 "\t" $3; exit }' "$tmp/bases")"
	if [ -n "$hit" ]; then
		[ "${hit##*"$TAB"}" != none ] || return 1
		printf '%s\n' "$hit"
		return 0
	fi
	if [ ! -f "$PRB" ]; then
		say "$PRB is missing: this script runs beside the address-review skill's folder" >"$tmp/pin.err"
		return 1
	fi
	if ! out="$(bash "$PRB" pin-base --repo "$REPO" --base "$1" 2>"$tmp/pin.err")" || [ -z "$(field base "$out")" ] || [ -z "$(field remote "$out")" ]; then
		printf '%s\t-\tnone\n' "$1" >>"$tmp/bases"
		return 1
	fi
	printf '%s\t%s\t%s\n' "$1" "$(field remote "$out")" "$(field base "$out")" >>"$tmp/bases"
	printf '%s\t%s\n' "$(field remote "$out")" "$(field base "$out")"
}

# The open pull requests, as `<number> TAB <head oid> TAB <base name> TAB
# <base oid>` lines in $tmp/prs. A failure is a gap, not an empty list.
REMOTE=""
enumerate() {
	local pinned b
	: >"$tmp/prs"
	if ! gh pr list --repo "$REPO" --state open --limit "$LIMIT" --json number,headRefOid,baseRefName,baseRefOid,headRefName,isCrossRepository \
		--jq '.[] | [.number, .headRefOid, .baseRefName, .baseRefOid, .headRefName, .isCrossRepository] | @tsv' >"$tmp/prs.raw" 2>"$tmp/err"; then
		gap "skipped=prs${TAB}the open pull requests of $REPO could not be listed (gh failed)"
		return 0
	fi
	awk -F "$TAB" 'NF == 6 && $1 ~ /^[0-9]+$/ && $2 ~ /^[0-9a-f]+$/' "$tmp/prs.raw" >"$tmp/prs"
	[ "$(awk 'END { print NR }' "$tmp/prs.raw")" = "$(awk 'END { print NR }' "$tmp/prs")" ] ||
		gap "skipped=prs${TAB}the enumeration held lines that are no pull request"
	[ "$(awk 'END { print NR }' "$tmp/prs")" -lt "$LIMIT" ] || gap "limit=$LIMIT"
	[ -s "$tmp/prs" ] || return 0
	# Any base that can be fetched names the remote the heads come from.
	cut -f3 "$tmp/prs" | sort -u >"$tmp/pr.bases"
	while [ -z "$REMOTE" ] && IFS= read -r b; do
		if pinned="$(pin "$b")"; then REMOTE="${pinned%%"$TAB"*}"; fi
	done <"$tmp/pr.bases"
}

# Makes a head's commit readable here; fails where it cannot be.
have_head() { # number, oid
	git cat-file -e "$2^{commit}" 2>/dev/null && return 0
	[ -n "$REMOTE" ] || return 1
	git fetch --quiet --no-write-fetch-head "$REMOTE" "refs/pull/$1/head" >/dev/null 2>&1 ||
		git fetch --quiet "$REMOTE" "refs/pull/$1/head" >/dev/null 2>&1 || return 1
	git cat-file -e "$2^{commit}" 2>/dev/null
}

# Makes an open pull request's head readable, and settles the commit its own
# changes are read against, in PBASE_OID; where either cannot be had, records
# the gap and fails.
PBASE_OID=""
head_and_base() { # number, head oid, base name, base oid
	local pinned
	# Each distinct base is refreshed once, whether or not a ref of that name
	# is already here: presence says nothing of freshness.
	if pinned="$(pin "$3")"; then PBASE_OID="${pinned##*"$TAB"}"; else PBASE_OID=none; fi
	if ! have_head "$1" "$2"; then
		gap "skipped=pr:$1${TAB}its head $2 could not be fetched"
		return 1
	fi
	# After the head: fetching it can bring the base commit along.
	if [ "$PBASE_OID" = none ]; then
		if git cat-file -e "$4^{commit}" 2>/dev/null; then
			PBASE_OID="$4"
		else
			gap "skipped=pr:$1${TAB}its base '$3' could not be fetched, and the base commit it names is not here"
			return 1
		fi
	fi
}

print_gaps() {
	sort -u "$tmp/gaps"
}

cmd_claims() {
	need_common
	local base_oid branch_oid branch_name pinned degraded="" n head pbase poid hname cross m mc mb moid mboid claims collisions
	if [ -n "$BASE" ] && [ -n "$LOCAL_BASE" ]; then usage "give --base or --local-base, not both"; fi
	[ -n "$BASE$LOCAL_BASE" ] || usage "claims needs --base <branch>, or --local-base <commit> where the repository cannot have the base"
	branch_oid="$(git rev-parse --verify --quiet "$BRANCH^{commit}")" || fail "the branch '$BRANCH' names no commit here. Nothing was scanned."
	if [ -n "$BASE" ]; then
		pinned="$(pin "$BASE")" || fail "could not fetch '$BASE' from $REPO ($(tr '\n' ' ' <"$tmp/pin.err")). A stale ref is not a fallback, and a failed refresh is not a clean scan: where the base exists only locally, name its commit with --local-base."
		REMOTE="${pinned%%"$TAB"*}"
		base_oid="${pinned##*"$TAB"}"
	else
		base_oid="$(git rev-parse --verify --quiet "$LOCAL_BASE^{commit}")" || fail "the base '$LOCAL_BASE' names no commit here. Nothing was scanned."
		degraded="degraded=the base was read from the local commit $base_oid, not fetched"
	fi
	# The branch's own name, where it has one: its open PR is no second claimant.
	branch_name="$(git rev-parse --abbrev-ref "$BRANCH" 2>/dev/null)" || branch_name=""
	# Three dots: against where the branch left its base, so what the base
	# gained since is not read as the branch's removal.
	if ! git diff --no-renames --diff-filter=A --name-only "$base_oid...$branch_oid" -- "$FOLDER/" >"$tmp/adds" ||
		! git diff --no-renames --diff-filter=D --name-only "$base_oid...$branch_oid" -- "$FOLDER/" >"$tmp/dels"; then
		fail "could not read what '$BRANCH' adds and removes against its base. Nothing was scanned."
	fi
	git ls-tree -r --name-only "$base_oid" -- "$FOLDER/" >"$tmp/base.tree" ||
		fail "could not read the task folder of the base. Nothing was scanned."
	awk "$NUMBERED" "$tmp/adds" | sort >"$tmp/adds.n"
	awk "$NUMBERED" "$tmp/dels" | sort >"$tmp/dels.n"
	# git's own rename matches, as `R <old> <new>`, to choose among several
	# additions of one number.
	git diff -M --diff-filter=R --name-status "$base_oid...$branch_oid" -- "$FOLDER/" 2>/dev/null |
		awk -F "$TAB" -v t="$TAB" 'NF == 3 { print "R" t $2 t $3 }' >"$tmp/renames"
	{ cat "$tmp/renames" && sed "s/^/D$TAB/" "$tmp/dels.n" && sed "s/^/A$TAB/" "$tmp/adds.n"; } >"$tmp/tagged"
	# Within a number, each removal takes one addition: the same basename
	# first, then the one git reads as its rename, then the first left. What
	# is left over is a claim.
	awk -F "$TAB" '
		function base(p) { sub(/.*\//, "", p); return p }
		$1 == "R" { renamed[$2] = $3; next }
		$1 == "D" { dels[$2] = dels[$2] "\n" $3; next }
		{ adds[$2] = adds[$2] "\n" $3; seen[$2] = 1 }
		END {
			for (n in seen) {
				na = split(substr(adds[n], 2), a, "\n")
				nd = (n in dels) ? split(substr(dels[n], 2), d, "\n") : 0
				for (i = 1; i <= nd; i++) {
					for (j = 1; j <= na; j++) if (a[j] != "" && base(a[j]) == base(d[i])) { a[j] = ""; d[i] = ""; break }
				}
				for (i = 1; i <= nd; i++) {
					if (d[i] == "" || !(d[i] in renamed)) continue
					for (j = 1; j <= na; j++) if (a[j] != "" && a[j] == renamed[d[i]]) { a[j] = ""; d[i] = ""; break }
				}
				for (i = 1; i <= nd; i++) {
					if (d[i] == "") continue
					for (j = 1; j <= na; j++) if (a[j] != "") { a[j] = ""; break }
				}
				for (j = 1; j <= na; j++) if (a[j] != "") print n "\t" a[j]
			}
		}' "$tmp/tagged" | sort >"$tmp/claims"
	claims="$(awk 'END { print NR }' "$tmp/claims")"

	# Holders, as `<number> TAB <holder> TAB <path>`.
	: >"$tmp/holders"
	if [ "$claims" -gt 0 ]; then
		# The base's whole tree as fetched, less what the branch removes
		# (what landed there since the branch forked is held too), and
		# everything the branch adds, relocations included.
		{ sed "s/^/D$TAB/" "$tmp/dels" && sed "s/^/B$TAB/" "$tmp/base.tree" && sed "s/^/A$TAB/" "$tmp/adds"; } | awk -F "$TAB" -v t="$TAB" '
			$1 == "D" { gone[$2] = 1; next }
			$1 == "B" { if (!($2 in gone)) print "base" t $2; next }
			{ print "branch" t $2 }' | awk -F "$TAB" -v t="$TAB" '{
				b = $2; sub(/.*\//, "", b)
				if (match(b, /^[0-9][0-9][0-9]+[a-z]?-/)) print substr(b, 1, RLENGTH - 1) t $1 t $2
			}' >>"$tmp/holders"
		printf '%s' "$RESERVED" | awk -v t="$TAB" 'NF { print $0 t "reserved" t "-" }' >>"$tmp/holders"
		while IFS= read -r m; do
			[ -n "$m" ] || continue
			mc="${m%%:*}"
			mb="${m#*:}"
			moid="$(git rev-parse --verify --quiet "$mc^{commit}")" || fail "the member '$mc' names no commit here. Nothing here says its numbers are free."
			# The scanned branch named as a member holds nothing against itself.
			[ "$moid" != "$branch_oid" ] || continue
			mboid="$(git rev-parse --verify --quiet "$mb^{commit}")" || fail "the base '$mb' of the member '$mc' names no commit here. Nothing here says its numbers are free."
			if ! git diff --no-renames --diff-filter=A --name-only "$mboid...$moid" -- "$FOLDER/" >"$tmp/member" 2>/dev/null; then
				fail "could not read what the member '$mc' adds against '$mb'. Nothing here says its numbers are free."
			fi
			awk "$NUMBERED" "$tmp/member" | awk -F "$TAB" -v t="$TAB" -v h="member:$mc" '{ print $1 t h t $2 }' >>"$tmp/holders"
		done <<EOF
$MEMBERS
EOF
		enumerate
		while IFS="$TAB" read -r n head pbase poid hname cross; do
			[ -n "$n" ] || continue
			# The branch's own PR: by its head branch's name, or a head the
			# scanned commit is or contains. What such a head adds is the
			# branch's own or already in its base, so nothing is lost.
			if { [ "$cross" != true ] && [ -n "$branch_name" ] && [ "$hname" = "$branch_name" ]; } ||
				{ git cat-file -e "$head^{commit}" 2>/dev/null && git merge-base --is-ancestor "$head" "$branch_oid"; }; then
				gap "self=pr:$n"
				continue
			fi
			head_and_base "$n" "$head" "$pbase" "$poid" || continue
			if ! git diff --no-renames --diff-filter=A --name-only "$PBASE_OID...$head" -- "$FOLDER/" >"$tmp/pr" 2>/dev/null; then
				gap "skipped=pr:$n${TAB}its head and its base share no history here"
				continue
			fi
			awk "$NUMBERED" "$tmp/pr" | awk -F "$TAB" -v t="$TAB" -v h="pr:$n" '{ print $1 t h t $2 }' >>"$tmp/holders"
		done <"$tmp/prs"
	fi

	{ sed "s/^/C$TAB/" "$tmp/claims" && sed "s/^/H$TAB/" "$tmp/holders"; } >"$tmp/both"
	awk -F "$TAB" -v t="$TAB" '
		$1 == "C" { claim[++count] = $2 t $3; next }
		{ holders[$2] = holders[$2] "\n" $3 t $4 }
		END {
			for (c = 1; c <= count; c++) {
				split(claim[c], f, t)
				n = split(substr(holders[f[1]], 2), h, "\n")
				for (i = 1; i <= n; i++) {
					split(h[i], g, t)
					# The claim stands in the branch tree under its own path.
					if (g[1] == "branch" && g[2] == f[2]) continue
					print "collision=" f[1] t f[2] t g[1] t g[2] t ((g[2] == f[2]) ? "same-path" : "other-path")
				}
			}
		}' "$tmp/both" | sort -u >"$tmp/collisions"
	collisions="$(awk 'END { print NR }' "$tmp/collisions")"
	# A branch that claims nothing has nothing a stale base could hide.
	[ -z "$degraded" ] || [ "$claims" -eq 0 ] || gap "$degraded"

	if [ "$collisions" -gt 0 ]; then
		say "outcome=collision"
	elif grep -q -e '^skipped=' -e '^limit=' -e '^degraded=' "$tmp/gaps"; then
		say "outcome=incomplete"
	else
		say "outcome=clean"
	fi
	say "base=$base_oid"
	say "claims=$claims"
	awk -F "$TAB" -v t="$TAB" '{ print "claim=" $1 t $2 }' "$tmp/claims"
	cat "$tmp/collisions"
	print_gaps
	if [ "$collisions" -gt 0 ]; then
		note "'$BRANCH' claims a task number something else holds. First claimant wins: hold this branch and renumber its new file, never a delivered, reserved, done or deferred one."
		exit 3
	fi
	if grep -q -e '^skipped=' -e '^limit=' -e '^degraded=' "$tmp/gaps"; then
		note "no collision among what could be read, and not everything could be. Report what was skipped; do not call the scan complete."
		exit 3
	fi
}

cmd_taken() {
	need_common
	[ -z "$BASE$LOCAL_BASE$RESERVED$MEMBERS" ] && [ "$BRANCH" = HEAD ] && [ ${#TASKS[@]} -eq 0 ] || usage "taken takes --repo and --folder only"
	local top n head pbase poid hname cross
	top="$(git rev-parse --show-toplevel 2>/dev/null)" && [ -n "$top" ] || fail "this checkout has no working tree to inventory."
	: >"$tmp/taken"
	if [ -d "$top/$FOLDER" ]; then
		tree_files "$top" ||
			fail "could not read the folder '$FOLDER' whole ($(tr '\n' ' ' <"$tmp/err")). A partial inventory says nothing of which numbers are free."
		awk "$LISTED" "$tmp/files" | awk -F "$TAB" -v t="$TAB" '{ print "taken=" $1 t "tree" t $2 }' >>"$tmp/taken"
	fi
	enumerate
	while IFS="$TAB" read -r n head pbase poid hname cross; do
		[ -n "$n" ] || continue
		if ! have_head "$n" "$head"; then
			gap "skipped=pr:$n${TAB}its head $head could not be fetched"
			continue
		fi
		# The whole tree: a number standing on a head is taken, inherited or not.
		if ! git ls-tree -r --name-only "$head" -- "$FOLDER/" >"$tmp/pr" 2>/dev/null; then
			gap "skipped=pr:$n${TAB}its tree could not be read"
			continue
		fi
		awk "$LISTED" "$tmp/pr" | awk -F "$TAB" -v t="$TAB" -v h="pr:$n" '{ print "taken=" $1 t h t $2 }' >>"$tmp/taken"
	done <"$tmp/prs"
	if [ -s "$tmp/gaps" ]; then say "outcome=incomplete"; else say "outcome=listed"; fi
	sort -u "$tmp/taken"
	print_gaps
	[ ! -s "$tmp/gaps" ] || {
		note "not every open head could be read. Report the allocation as not fully checked; a head that was not read is not free."
		exit 3
	}
}

cmd_duplicates() {
	[ -z "$REPO$BASE$LOCAL_BASE$RESERVED$MEMBERS" ] && [ "$BRANCH" = HEAD ] && [ ${#TASKS[@]} -eq 0 ] || usage "duplicates takes --folder only: it reads the working tree and nothing remote"
	need_tree
	local top duplicates
	top="$(git rev-parse --show-toplevel 2>/dev/null)" && [ -n "$top" ] || fail "this checkout has no working tree to inventory."
	[ -d "$top/$FOLDER" ] ||
		fail "'$FOLDER' is no folder in this working tree. That is not a clean sweep: name the task folder with --folder where it is another."
	tree_files "$top" ||
		fail "could not read the folder '$FOLDER' whole ($(tr '\n' ' ' <"$tmp/err")). That is not a clean sweep: name the task folder with --folder where it is another."
	awk "$LISTED" "$tmp/files" | sort >"$tmp/tree"
	awk -F "$TAB" '$1 != "-" { count[$1]++; paths[$1] = paths[$1] "duplicate=" $1 "\t" substr($0, length($1) + 2) "\n" }
		END { for (n in count) if (count[n] > 1) printf "%s", paths[n] }' "$tmp/tree" | sort >"$tmp/duplicates"
	duplicates="$(cut -f1 "$tmp/duplicates" | sort -u | awk 'END { print NR }')"
	if [ "$duplicates" -gt 0 ]; then say "outcome=duplicate"; else say "outcome=clean"; fi
	say "numbered=$(awk -F "$TAB" '$1 != "-"' "$tmp/tree" | awk 'END { print NR }')"
	cat "$tmp/duplicates"
	awk -F "$TAB" '$1 == "-" { print "unnumbered=" substr($0, 3) }' "$tmp/tree"
	[ "$duplicates" -eq 0 ] || {
		note "$duplicates task number(s) stand on more than one file in this working tree. Report every path for explicit remediation; a done or deferred task is never renumbered to repair one."
		exit 3
	}
}

cmd_touching() {
	[ -z "$BASE$LOCAL_BASE$RESERVED$MEMBERS" ] && [ "$BRANCH" = HEAD ] && [ "$FOLDER" = tasks ] || usage "touching takes --repo and --task only"
	[ ${#TASKS[@]} -gt 0 ] || usage "touching needs --task <path> for each task file asked about"
	need_common
	local n head pbase poid hname cross touched
	: >"$tmp/touching"
	enumerate
	while IFS="$TAB" read -r n head pbase poid hname cross; do
		[ -n "$n" ] || continue
		head_and_base "$n" "$head" "$pbase" "$poid" || continue
		# Three dots, as the guard reads a head's additions: what the base
		# gained since the head forked is not the head's change.
		if ! git --literal-pathspecs diff --no-renames --name-status "$PBASE_OID...$head" -- "${TASKS[@]}" >"$tmp/pr" 2>/dev/null; then
			gap "skipped=pr:$n${TAB}its head and its base share no history here"
			continue
		fi
		awk -F "$TAB" -v t="$TAB" -v h="pr:$n" -v n="$n" 'NF == 2 { print n t "touching=" h t $1 t $2 }' "$tmp/pr" >>"$tmp/touching"
	done <"$tmp/prs"
	touched="$(awk 'END { print NR }' "$tmp/touching")"
	if [ "$touched" -gt 0 ]; then
		say "outcome=touched"
	elif [ -s "$tmp/gaps" ]; then
		say "outcome=incomplete"
	else
		say "outcome=clean"
	fi
	say "tasks=${#TASKS[@]}"
	sort -t "$TAB" -k1,1n -k4 "$tmp/touching" | cut -f2-
	print_gaps
	if [ "$touched" -gt 0 ]; then
		note "an open pull request changes a task file asked about. Read what it changes before the task is implemented from this copy."
		exit 3
	fi
	[ ! -s "$tmp/gaps" ] || {
		note "no open pull request among those read touches these task files, and not every one could be read. Report what was skipped; do not call the scan complete."
		exit 3
	}
}

case "$CMD" in
claims) cmd_claims ;;
touching) cmd_touching ;;
taken) cmd_taken ;;
duplicates) cmd_duplicates ;;
-h | --help | help)
	awk 'NR > 1 && !/^#/ { exit } NR > 1 { sub(/^# ?/, ""); print }' "$SELF"
	;;
'') usage "name a command: claims, taken, duplicates or touching" ;;
*) usage "unknown command: $CMD" ;;
esac
