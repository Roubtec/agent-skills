#!/usr/bin/env bash
# task-numbers.sh — which task numbers a branch newly claims, and who else
# holds them: the base it is headed for, and every open pull request.
#
# Usage, from the checkout that holds the branch, or with `-C <dir>` ahead of
# the command, as git takes it:
#   task-numbers.sh claims --repo <owner>/<repo> (--base <branch> | --local-base <commit>)
#                          [--branch <commit>] [--folder <dir>]
#                          [--reserved <number>]... [--member <commit>:<its base commit>]...
#   task-numbers.sh taken  --repo <owner>/<repo> [--folder <dir>]
#
# `<owner>/<repo>` is the repository the pull requests are in; write it
# `<host>/<owner>/<repo>` where that is not github.com. `--folder` is the
# repository's task folder (`tasks`, no trailing slash). A task file is one whose basename starts
# with a full task number and a dash: three digits and an optional lowercase
# letter (`001-`, `001a-`, `042b-`), at any depth under the folder, so
# `done/` and `deferred/` keep their numbers. `001` and `001a` are two numbers.
#
# claims  For the pre-PR guard. `--base` is the branch the scanned branch
#         (`--branch`, else HEAD) is recorded as based on: it is fetched from
#         the repository first, never read from a local or remote-tracking
#         ref. `--local-base` is for a base the repository cannot have (an
#         unpushed dependency branch, a local-only run): that exact commit is
#         read, and the answer says `degraded=`.
#         The branch claims every task file it adds against that base, less
#         its own relocations: within one number, each file it removes pairs
#         with one file it adds (the same basename first), so an archive, a
#         deferral or a slug rename claims nothing.
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
#                       a `--member`, read the same way: a sibling of the same
#                       run that has no pull request yet
#           reserved    a `--reserved` number, with `-` for the path
#         `same-path` is the one case a plain add/add procedure can take.
#         Then what the scan could not see:
#           skipped=<pr:<N>|prs> TAB <reason>
#                       a head or its base that could not be read, or the
#                       enumeration itself
#           limit=200   the enumeration returned as many pull requests as it
#                       asks for, so later ones cannot be named
#           self=pr:<N> an open pull request whose head is the scanned commit
#         under
#           outcome=clean       no collision, and nothing skipped (exit 0)
#           outcome=collision   at least one (exit 3)
#           outcome=incomplete  no collision among what was read, with a
#                               skipped=, limit= or degraded= line (exit 3)
#         and always base= (the commit read) and claims= (how many).
#         A branch that claims nothing answers `clean` without asking GitHub.
# taken   For allocating a number. Every task file standing in the working
#         tree's folder and in the whole tree of every open pull request head:
#           taken=<number> TAB <tree|pr:<N>> TAB <path>
#         under outcome=listed, or outcome=incomplete (exit 3) with the same
#         skipped= and limit= lines.
#
# One enumeration, `gh pr list --state open --limit 200`, is the whole remote
# reading, and each head is read at the commit it named: a head that moves
# afterwards is not seen. Bases and heads are fetched through `pr-branch.sh`
# of the `address-review` skill, in that skill's folder beside this skill's,
# and from the remote it matched; no FETCH_HEAD is read.
#
# Output: `key=value` lines on stdout, `outcome=` first; an explanation goes to
# stderr. Exit status: 0 on clean and listed, 3 on collision and incomplete, 1
# on a failure (the scanned branch or its base could not be read), 64 on a
# usage error. Needs git, and gh for the remote reading. Written for bash 3.2
# and later.
set -u

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
	sed -n '5,10p' "$SELF" | sed 's/^# \{0,1\}//' >&2
	exit 64
}
field() { # key, text
	printf '%s\n' "$2" | awk -v k="$1=" 'index($0, k) == 1 { print substr($0, length(k) + 1); exit }'
}

# Reads paths, prints `<number> TAB <path>` for each that is a task file.
# shellcheck disable=SC2016 # the $names are awk's
NUMBERED='{
	b = $0; sub(/.*\//, "", b)
	if (match(b, /^[0-9][0-9][0-9][a-z]?-/)) print substr(b, 1, RLENGTH - 1) "\t" $0
}'

CMD="${1:-}"
[ $# -gt 0 ] && shift
case "$CMD" in
-C)
	[ $# -ge 2 ] || usage "-C needs a directory and a command"
	cd "$1" 2>/dev/null || fail "could not enter $1."
	CMD="$2"
	shift 2
	;;
esac

REPO="" BASE="" LOCAL_BASE="" BRANCH="HEAD" FOLDER="tasks" RESERVED="" MEMBERS=""
while [ $# -gt 0 ]; do
	case "$1" in
	--repo | --base | --local-base | --branch | --folder | --reserved | --member)
		[ $# -ge 2 ] || usage "$1 needs a value"
		case "$1" in
		--repo) REPO="$2" ;;
		--base) BASE="$2" ;;
		--local-base) LOCAL_BASE="$2" ;;
		--branch) BRANCH="$2" ;;
		--folder) FOLDER="$2" ;;
		--reserved)
			printf '%s\n' "$2" | grep -Eq '^[0-9]{3}[a-z]?$' || usage "--reserved takes a full task number such as 024 or 024a"
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
	[ -n "$FOLDER" ] || usage "--folder cannot be empty"
	git rev-parse --git-dir >/dev/null 2>&1 || fail "this is not a git repository."
	tmp="$(mktemp -d "${TMPDIR:-/tmp}/task-numbers.XXXXXX")" || fail "could not create a temporary directory."
	# shellcheck disable=SC2064 # expand now: the directory this run made
	trap "rm -rf '$tmp'" EXIT
	: >"$tmp/gaps"
}
gap() { say "$*" >>"$tmp/gaps"; }

# A branch of the repository, fetched now: prints `<remote> TAB <oid>`.
pin() { # branch
	local out
	[ -f "$PRB" ] || return 1
	out="$(bash "$PRB" pin-base --repo "$REPO" --base "$1" 2>/dev/null)" || return 1
	[ -n "$(field base "$out")" ] && [ -n "$(field remote "$out")" ] || return 1
	printf '%s\t%s\n' "$(field remote "$out")" "$(field base "$out")"
}

# The open pull requests, as `<number> TAB <head oid> TAB <base name> TAB
# <base oid>` lines in $tmp/prs. A failure is a gap, not an empty list.
REMOTE=""
enumerate() {
	local pinned
	: >"$tmp/prs"
	if ! gh pr list --repo "$REPO" --state open --limit "$LIMIT" --json number,headRefOid,baseRefName,baseRefOid \
		--jq '.[] | [.number, .headRefOid, .baseRefName, .baseRefOid] | @tsv' >"$tmp/prs.raw" 2>"$tmp/err"; then
		gap "skipped=prs${TAB}the open pull requests of $REPO could not be listed (gh failed)"
		return 0
	fi
	awk -F "$TAB" 'NF == 4 && $1 ~ /^[0-9]+$/ && $2 ~ /^[0-9a-f]+$/' "$tmp/prs.raw" >"$tmp/prs"
	[ "$(awk 'END { print NR }' "$tmp/prs.raw")" = "$(awk 'END { print NR }' "$tmp/prs")" ] ||
		gap "skipped=prs${TAB}the enumeration held lines that are no pull request"
	[ "$(awk 'END { print NR }' "$tmp/prs")" -lt "$LIMIT" ] || gap "limit=$LIMIT"
	[ -s "$tmp/prs" ] || return 0
	if [ -z "$REMOTE" ]; then
		# Any base names the remote: the first pull request's will do.
		if pinned="$(pin "$(head -n 1 "$tmp/prs" | cut -f3)")"; then REMOTE="${pinned%%"$TAB"*}"; fi
	fi
}

# Makes a head's commit readable here; fails where it cannot be.
have_head() { # number, oid
	git cat-file -e "$2^{commit}" 2>/dev/null && return 0
	[ -n "$REMOTE" ] || return 1
	git fetch --quiet --no-write-fetch-head "$REMOTE" "refs/pull/$1/head" >/dev/null 2>&1 ||
		git fetch --quiet "$REMOTE" "refs/pull/$1/head" >/dev/null 2>&1 || return 1
	git cat-file -e "$2^{commit}" 2>/dev/null
}

print_gaps() {
	sort -u "$tmp/gaps"
}

cmd_claims() {
	need_common
	local base_oid branch_oid pinned degraded="" n head pbase pbase_oid poid m mc mb claims collisions
	if [ -n "$BASE" ] && [ -n "$LOCAL_BASE" ]; then usage "give --base or --local-base, not both"; fi
	[ -n "$BASE$LOCAL_BASE" ] || usage "claims needs --base <branch>, or --local-base <commit> where the repository cannot have the base"
	branch_oid="$(git rev-parse --verify --quiet "$BRANCH^{commit}")" || fail "the branch '$BRANCH' names no commit here. Nothing was scanned."
	if [ -n "$BASE" ]; then
		pinned="$(pin "$BASE")" || fail "could not fetch '$BASE' from $REPO. A stale ref is not a fallback, and a failed refresh is not a clean scan: where the base exists only locally, name its commit with --local-base."
		REMOTE="${pinned%%"$TAB"*}"
		base_oid="${pinned##*"$TAB"}"
	else
		base_oid="$(git rev-parse --verify --quiet "$LOCAL_BASE^{commit}")" || fail "the base '$LOCAL_BASE' names no commit here. Nothing was scanned."
		degraded="degraded=the base was read from the local commit $base_oid, not fetched"
	fi
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
	{ sed "s/^/D$TAB/" "$tmp/dels.n" && sed "s/^/A$TAB/" "$tmp/adds.n"; } >"$tmp/tagged"
	# Within a number, each removal takes one addition: the same basename
	# first, then the first left. What is left over is a claim.
	awk -F "$TAB" '
		function base(p) { sub(/.*\//, "", p); return p }
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
				if (match(b, /^[0-9][0-9][0-9][a-z]?-/)) print substr(b, 1, RLENGTH - 1) t $1 t $2
			}' >>"$tmp/holders"
		printf '%s' "$RESERVED" | awk -v t="$TAB" 'NF { print $0 t "reserved" t "-" }' >>"$tmp/holders"
		while IFS= read -r m; do
			[ -n "$m" ] || continue
			mc="${m%%:*}"
			mb="${m#*:}"
			if ! git diff --no-renames --diff-filter=A --name-only "$mb...$mc" -- "$FOLDER/" >"$tmp/member" 2>/dev/null; then
				fail "could not read what the member '$mc' adds against '$mb'. Nothing here says its numbers are free."
			fi
			awk "$NUMBERED" "$tmp/member" | awk -F "$TAB" -v t="$TAB" -v h="member:$mc" '{ print $1 t h t $2 }' >>"$tmp/holders"
		done <<EOF
$MEMBERS
EOF
		enumerate
		: >"$tmp/bases"
		while IFS="$TAB" read -r n head pbase poid; do
			[ -n "$n" ] || continue
			if [ "$head" = "$branch_oid" ]; then
				gap "self=pr:$n"
				continue
			fi
			# Each distinct base is refreshed once, whether or not a ref of
			# that name is already here: presence says nothing of freshness.
			pbase_oid="$(awk -F "$TAB" -v b="$pbase" '$1 == b { print $2; exit }' "$tmp/bases")"
			if [ -z "$pbase_oid" ]; then
				if pinned="$(pin "$pbase")"; then pbase_oid="${pinned##*"$TAB"}"; else pbase_oid=none; fi
				printf '%s\t%s\n' "$pbase" "$pbase_oid" >>"$tmp/bases"
			fi
			if [ "$pbase_oid" = none ]; then
				if git cat-file -e "$poid^{commit}" 2>/dev/null; then
					pbase_oid="$poid"
				else
					gap "skipped=pr:$n${TAB}its base '$pbase' could not be fetched, and the base commit it names is not here"
					continue
				fi
			fi
			if ! have_head "$n" "$head"; then
				gap "skipped=pr:$n${TAB}its head $head could not be fetched"
				continue
			fi
			if ! git diff --no-renames --diff-filter=A --name-only "$pbase_oid...$head" -- "$FOLDER/" >"$tmp/pr" 2>/dev/null; then
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
	[ -z "$degraded" ] || gap "$degraded"

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
	[ -z "$BASE$LOCAL_BASE$RESERVED$MEMBERS" ] && [ "$BRANCH" = HEAD ] || usage "taken takes --repo and --folder only"
	local top n head pbase poid
	top="$(git rev-parse --show-toplevel 2>/dev/null)" && [ -n "$top" ] || fail "this checkout has no working tree to inventory."
	: >"$tmp/taken"
	if [ -d "$top/$FOLDER" ]; then
		(cd "$top" && find "$FOLDER" -type f) | awk "$NUMBERED" | awk -F "$TAB" -v t="$TAB" '{ print "taken=" $1 t "tree" t $2 }' >>"$tmp/taken"
	fi
	enumerate
	while IFS="$TAB" read -r n head pbase poid; do
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
		awk "$NUMBERED" "$tmp/pr" | awk -F "$TAB" -v t="$TAB" -v h="pr:$n" '{ print "taken=" $1 t h t $2 }' >>"$tmp/taken"
	done <"$tmp/prs"
	if [ -s "$tmp/gaps" ]; then say "outcome=incomplete"; else say "outcome=listed"; fi
	sort -u "$tmp/taken"
	print_gaps
	[ ! -s "$tmp/gaps" ] || {
		note "not every open head could be read. Report the allocation as not fully checked; a head that was not read is not free."
		exit 3
	}
}

case "$CMD" in
claims) cmd_claims ;;
taken) cmd_taken ;;
-h | --help | help)
	awk 'NR > 1 && !/^#/ { exit } NR > 1 { sub(/^# ?/, ""); print }' "$SELF"
	;;
'') usage "name a command: claims or taken" ;;
*) usage "unknown command: $CMD" ;;
esac
