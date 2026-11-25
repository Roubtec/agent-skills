#!/usr/bin/env bash
# prune-branches.sh — the mechanics of the prune-branches skill.
#
#   prune-branches.sh plan  [--no-pull] [--keep <branch>]...
#   prune-branches.sh apply --plan <file> [--dry-run] [--hands-off]
#                           [--keep <branch>]... [--delete-uncertain <branch>]...
#                           [--approve-worktree <branch> <path>]...
#                           [--no-sweep] [--keep-breadcrumb <ref>]...
#
# `plan` fetches, resolves origin's default branch, optionally fast-forwards the
# local default, snapshots every local branch, worktree and `refs/pruned/**`
# breadcrumb, classifies them, prints one audit listing and writes a plan file
# whose path is the last line of stdout (`plan: <path>`). It deletes nothing.
#
# `apply` acts on that plan and nothing else: it re-reads every tip against the
# snapshot, reserves a recovery ref for every non-Merged deletion before any
# deletion, removes only worktrees it is entitled to, deletes local branches,
# sweeps the redundant breadcrumbs the plan marked, and prints the report with
# restore commands. `--dry-run` prints the listing as the given flags change it.
#
# What it never does: push, delete a remote ref, edit a PR, force-remove a
# worktree, stash, reset or clean. Remote access is `git fetch`, `git remote
# set-head origin --auto`, the fast-forward-only pull of the local default, and
# read-only `gh` queries against origin's own repository.
#
# Buckets. Merged: the tip is an ancestor of origin's freshly fetched default,
# or a merged PR based on that default has exactly this tip as its head.
# Transient: not merged, but the tip stays reachable from a ref that remains (a
# protected branch, a `refs/pre-rebase/**` ref, or a branch this plan keeps), or
# it is a merge commit whose parents all are. Uncertain: everything else, and
# any unmerged branch that heads an open PR in origin's repository; kept unless
# `--delete-uncertain` names it. Every non-Merged deletion is preserved
# first under `refs/pruned/<YYYYMMDD-UTC>/<branch>` (or the flat fallback
# `refs/pruned/flat/<date>/<percent-encoded>`).
#
# A branch checked out in a linked worktree is deleted only when that worktree
# is a direct child of `<repo>/.worktrees/$CONTAINER_NAME` and `wt-remove` is on
# PATH, or when `--approve-worktree <branch> <path>` names its exact path. The
# main worktree and the invoking one are never removed.
#
# Exit status: 0 on a completed plan or apply (individual rows may still have
# been kept; the report says why), 1 when the run stopped before acting, 64 on
# a usage error.
#
# Written for bash 3.2 and later: no associative arrays, no mapfile.
set -u

PLAN_MAX_AGE=3600
CRUMB_BUDGET=200
CRUMB_MIN_AGE_DAYS=7
TAB="$(printf '\t')"

die() {
	printf 'prune-branches: %s\n' "$*" >&2
	exit 1
}
usage() {
	printf 'prune-branches: %s\n' "$*" >&2
	sed -n '4,9p' "$0" | sed 's/^# \{0,1\}//' >&2
	exit 64
}
# Single-quote a value for a command the user may paste.
sq() {
	printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
canon() { (cd "$1" 2>/dev/null && pwd -P); }
# Julian day number of a YYYYMMDD date, for day differences without GNU date.
jdn() {
	local y=$((10#${1:0:4})) m=$((10#${1:4:2})) d=$((10#${1:6:2}))
	local a=$(((14 - m) / 12))
	local yy=$((y + 4800 - a)) mm=$((m + 12 * a - 3))
	echo $((d + (153 * mm + 2) / 5 + 365 * yy + yy / 4 - yy / 100 + yy / 400 - 32045))
}
in_list() { # <value> <newline-separated list>
	printf '%s\n' "$2" | grep -Fqx -- "$1"
}

# ---------------------------------------------------------------------------
# plan
# ---------------------------------------------------------------------------

# Host of an origin URL, or nothing when the form is not one we can read
# unambiguously.
url_host() {
	case "$1" in
	https://*/*/*) printf '%s' "$1" | sed -E 's#^https://([^/@]*@)?([^/:]+)(:[0-9]+)?/.*#\2#' ;;
	ssh://*/*/*) printf '%s' "$1" | sed -E 's#^ssh://([^/@]*@)?([^/:]+)(:[0-9]+)?/.*#\2#' ;;
	*://*) ;;
	*@*:*/*) printf '%s' "$1" | sed -E 's#^[^@/]+@([^:/]+):.*#\1#' ;;
	esac
}

resolve_selector() {
	ORIGIN_SELECTOR=""
	SELECTOR_NOTE=""
	local host info name url rhost
	host="$(url_host "$ORIGIN_URL")"
	if [ -z "$host" ]; then
		SELECTOR_NOTE="origin URL form not recognized; PR lookups disabled"
		return
	fi
	if ! command -v gh >/dev/null 2>&1; then
		SELECTOR_NOTE="gh not available; PR lookups disabled"
		return
	fi
	info="$(gh repo view "$ORIGIN_URL" --json nameWithOwner,url --jq '.nameWithOwner + "\t" + .url' 2>/dev/null)" || info=""
	name="${info%%"$TAB"*}"
	url="${info#*"$TAB"}"
	rhost="$(url_host "$url")"
	if [ -z "$name" ] || [ -z "$rhost" ] || [ "$(lower "$rhost")" != "$(lower "$host")" ]; then
		SELECTOR_NOTE="gh could not confirm origin's repository; PR lookups disabled"
		return
	fi
	case "$host/$name" in
	*/*/*/*) SELECTOR_NOTE="origin repository name not in OWNER/REPO form; PR lookups disabled" ;;
	*/*/*) ORIGIN_SELECTOR="$host/$name" ;;
	*) SELECTOR_NOTE="origin repository name not in OWNER/REPO form; PR lookups disabled" ;;
	esac
}

resolve_default() {
	DEFAULT_NAME=""
	DEFAULT_SOURCE=""
	local target
	if git remote set-head origin --auto >/dev/null 2>&1; then
		target="$(git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null)" || target=""
		case "$target" in
		refs/remotes/origin/?*)
			if git rev-parse --verify --quiet "$target^{commit}" >/dev/null; then
				DEFAULT_NAME="${target#refs/remotes/origin/}"
				DEFAULT_SOURCE="origin's HEAD advertisement"
			fi
			;;
		esac
	fi
	if [ -z "$DEFAULT_NAME" ] && [ -n "$ORIGIN_SELECTOR" ]; then
		target="$(gh repo view "$ORIGIN_SELECTOR" --json defaultBranchRef --jq '.defaultBranchRef.name' 2>/dev/null)" || target=""
		if [ -n "$target" ] && git check-ref-format --branch "$target" >/dev/null 2>&1; then
			DEFAULT_NAME="$target"
			DEFAULT_SOURCE="GitHub API ($ORIGIN_SELECTOR)"
		fi
	fi
	[ -n "$DEFAULT_NAME" ] || die "could not resolve origin's default branch (git remote set-head origin --auto failed and no GitHub answer). Check connectivity and authentication, then run: git fetch --prune origin && git remote set-head origin --auto. Nothing was deleted."
	git fetch origin "+refs/heads/$DEFAULT_NAME:refs/remotes/origin/$DEFAULT_NAME" >/dev/null 2>&1 ||
		die "could not refresh origin/$DEFAULT_NAME; a stale ref is not a permitted fallback. Nothing was deleted."
	DEFAULT_OID="$(git rev-parse --verify --quiet "refs/remotes/origin/$DEFAULT_NAME^{commit}")" ||
		die "refreshed origin/$DEFAULT_NAME does not resolve to a commit. Nothing was deleted."
}

# worktrees.tsv: path <TAB> branch-ref-or-"detached" <TAB> locked(0|1) <TAB> ordinal
snapshot_worktrees() {
	local path="" branch="detached" locked=0 n=0 line
	: >"$WORK/worktrees.tsv"
	{
		git worktree list --porcelain
		echo
	} | while IFS= read -r line; do
		case "$line" in
		"worktree "*) path="${line#worktree }" ;;
		"branch "*) branch="${line#branch }" ;;
		locked*) locked=1 ;;
		"")
			if [ -n "$path" ]; then
				n=$((n + 1))
				printf '%s\t%s\t%s\t%s\n' "$path" "$branch" "$locked" "$n" >>"$WORK/worktrees.tsv"
			fi
			path=""
			branch="detached"
			locked=0
			;;
		esac
	done
}

# Sets WT_PATH, WT_KIND (none|invoking|main|helper|other), WT_SLUG, WT_LOCKED
# for a branch name.
worktree_of() {
	WT_PATH=""
	WT_KIND=none
	WT_SLUG=""
	WT_LOCKED=0
	local row cp ord
	row="$(awk -F'\t' -v b="refs/heads/$1" '$2 == b { print; exit }' "$WORK/worktrees.tsv")"
	[ -n "$row" ] || return 0
	WT_PATH="$(printf '%s' "$row" | cut -f1)"
	WT_LOCKED="$(printf '%s' "$row" | cut -f3)"
	ord="$(printf '%s' "$row" | cut -f4)"
	cp="$(canon "$WT_PATH")"
	if [ -n "$cp" ] && [ "$cp" = "$INVOKING_TOP" ]; then
		WT_KIND=invoking
	elif [ "$ord" = 1 ]; then
		WT_KIND=main
	elif [ -n "$HELPER_ROOT" ] && [ -n "$cp" ] && [ "$(dirname "$cp")" = "$HELPER_ROOT" ] && command -v wt-remove >/dev/null 2>&1; then
		WT_KIND=helper
		WT_SLUG="$(basename "$cp")"
	else
		WT_KIND=other
	fi
	[ -n "$cp" ] && WT_PATH="$cp"
	return 0
}

update_local_default() {
	if [ "$NO_PULL" = 1 ]; then
		PULL_RESULT="skipped (no-pull); classification still compares against origin/$DEFAULT_NAME as just fetched"
		return
	fi
	local has_local=0 tmp
	git show-ref --verify --quiet "refs/heads/$DEFAULT_NAME" && has_local=1
	worktree_of "$DEFAULT_NAME"
	if [ "$WT_KIND" != none ]; then
		if [ -n "$(git -C "$WT_PATH" status --porcelain=v1 2>/dev/null)" ]; then
			PULL_RESULT="not pulled: $DEFAULT_NAME is checked out with uncommitted changes at $WT_PATH"
		elif git -C "$WT_PATH" pull --ff-only origin "refs/heads/$DEFAULT_NAME" >/dev/null 2>&1; then
			PULL_RESULT="fast-forwarded in $WT_PATH"
		else
			PULL_RESULT="pull --ff-only failed in $WT_PATH; local $DEFAULT_NAME left as it was"
		fi
		return
	fi
	tmp="$(mktemp -d "${TMPDIR:-/tmp}/prune-default.XXXXXX")" || {
		PULL_RESULT="not pulled: could not create a temporary directory"
		return
	}
	rmdir "$tmp"
	if [ "$has_local" = 1 ]; then
		git worktree add --quiet "$tmp" "$DEFAULT_NAME" >/dev/null 2>&1 || {
			PULL_RESULT="not pulled: could not create a temporary worktree for $DEFAULT_NAME"
			return
		}
	else
		git worktree add --quiet --track -b "$DEFAULT_NAME" "$tmp" "refs/remotes/origin/$DEFAULT_NAME" >/dev/null 2>&1 || {
			PULL_RESULT="not pulled: could not create local $DEFAULT_NAME from origin/$DEFAULT_NAME"
			return
		}
	fi
	if git -C "$tmp" pull --ff-only origin "refs/heads/$DEFAULT_NAME" >/dev/null 2>&1; then
		PULL_RESULT="fast-forwarded through a temporary worktree"
		[ "$has_local" = 1 ] || PULL_RESULT="created local $DEFAULT_NAME from origin/$DEFAULT_NAME"
	else
		PULL_RESULT="pull --ff-only failed; local $DEFAULT_NAME left as it was (it has diverged or the fetch failed)"
	fi
	if ! git worktree remove "$tmp" >/dev/null 2>&1; then
		PULL_RESULT="$PULL_RESULT; temporary worktree $tmp could not be removed cleanly and was left in place"
	fi
}

# Refs that remain whatever this run deletes: protected branches and
# refs/pre-rebase/**. Prints the first one that contains <oid>, if any.
kept_ref_containing() {
	local ref
	git for-each-ref --contains "$1" --format='%(refname)' refs/heads refs/pre-rebase 2>/dev/null |
		while IFS= read -r ref; do
			case "$ref" in
			refs/pre-rebase/*)
				printf '%s' "$ref"
				break
				;;
			refs/heads/*)
				if in_list "${ref#refs/heads/}" "$PROTECTED"; then
					printf '%s' "$ref"
					break
				fi
				;;
			esac
		done
}

forced_verdict() { # branch; an open PR outranks whatever a merged one settled
	awk -F'\t' -v b="$1" '$1 == b { if ($2 == "Open" || v == "") v = $2 } END { if (v != "") print v }' "$WORK/forced.tsv"
}

is_candidate() { # branch
	awk -F'\t' -v b="$1" '$2 == b { found = 1 } END { exit !found }' "$WORK/cand.tsv"
}

classify_branches() {
	local tip name upstream track
	: >"$WORK/cand.tsv"
	: >"$WORK/rows.tsv"
	git for-each-ref --format='%(objectname)%09%(refname:strip=2)%09%(upstream)%09%(upstream:track)' refs/heads/ >"$WORK/branches.tsv"
	# shellcheck disable=SC2034 # track is read for its position in the row
	while IFS="$TAB" read -r tip name upstream track; do
		if in_list "$name" "$PROTECTED"; then
			continue
		fi
		if git merge-base --is-ancestor "$tip" "$DEFAULT_OID" 2>/dev/null; then
			printf 'Merged\t%s\t%s\ttip is an ancestor of %s\n' "$name" "$tip" "$DEFAULT_NAME" >>"$WORK/rows.tsv"
		else
			printf '%s\t%s\t%s\n' "$tip" "$name" "$upstream" >>"$WORK/cand.tsv"
		fi
	done <"$WORK/branches.tsv"

	# PR evidence, within fixed budgets. forced.tsv holds branches a PR lookup
	# settled: "Merged" on an exact base-and-head match, "Uncertain" when a
	# merged PR for this branch name carries a different head.
	: >"$WORK/forced.tsv"
	if [ -n "$ORIGIN_SELECTOR" ] && [ -s "$WORK/cand.tsv" ]; then
		local n=0 out verdict
		while IFS="$TAB" read -r tip name upstream; do
			[ -n "$upstream" ] || continue
			n=$((n + 1))
			[ "$n" -le 20 ] || break
			out="$(gh pr list --repo "$ORIGIN_SELECTOR" --state merged --head "$name" --base "$DEFAULT_NAME" --limit 10 \
				--json headRefName,headRefOid,baseRefName --jq '.[] | [.headRefName, .headRefOid, .baseRefName] | @tsv' 2>/dev/null)" || continue
			verdict="$(printf '%s\n' "$out" | awk -F'\t' -v b="$name" -v d="$DEFAULT_NAME" -v t="$tip" '
				$1 == b && $3 == d { seen = 1; if ($2 == t) hit = 1 }
				END { if (hit) print "Merged"; else if (seen) print "Uncertain" }')"
			[ -z "$verdict" ] || printf '%s\t%s\n' "$name" "$verdict" >>"$WORK/forced.tsv"
		done <"$WORK/cand.tsv"
		local num state head oid base seen=0
		git log -n 200 --format='%s' "$DEFAULT_OID" | grep -oE '#[0-9]+' | tr -d '#' | awk '!s[$0]++' | head -n 20 >"$WORK/prnums"
		while IFS= read -r num; do
			# Stop once every candidate is settled.
			seen="$(awk -F'\t' 'FILENAME == ARGV[1] { f[$1] = 1; next } !($2 in f) { c++ } END { print c + 0 }' "$WORK/forced.tsv" "$WORK/cand.tsv")"
			[ "$seen" -gt 0 ] || break
			out="$(gh pr view "$num" --repo "$ORIGIN_SELECTOR" --json state,headRefName,headRefOid,baseRefName \
				--jq '[.state, .headRefName, .headRefOid, .baseRefName] | @tsv' 2>/dev/null)" || continue
			IFS="$TAB" read -r state head oid base <<EOF
$out
EOF
			[ "$state" = MERGED ] && [ "$base" = "$DEFAULT_NAME" ] || continue
			tip="$(awk -F'\t' -v b="$head" '$2 == b { print $1; exit }' "$WORK/cand.tsv")"
			[ -n "$tip" ] || continue
			awk -F'\t' -v b="$head" '$1 == b { found = 1 } END { exit !found }' "$WORK/forced.tsv" && continue
			if [ "$oid" = "$tip" ]; then
				printf '%s\tMerged\n' "$head" >>"$WORK/forced.tsv"
			else
				printf '%s\tUncertain\n' "$head" >>"$WORK/forced.tsv"
			fi
		done <"$WORK/prnums"
		# A branch that heads an open PR in origin's repository is still in
		# review: it is kept unless named, however reachable its tip is.
		gh pr list --repo "$ORIGIN_SELECTOR" --state open --limit 200 --json number,headRefName,isCrossRepository \
			--jq '.[] | select(.isCrossRepository | not) | [.headRefName, .number] | @tsv' 2>/dev/null |
			while IFS="$TAB" read -r head num; do
				printf '%s\tOpen\t%s\n' "$head" "$num" >>"$WORK/forced.tsv"
			done
	fi

	# Strict containment among the remaining candidates: a candidate whose tip is
	# a proper ancestor of another candidate's tip survives through that one.
	local verdict proof parents p ok others o otip first
	while IFS="$TAB" read -r tip name upstream; do
		verdict="$(forced_verdict "$name")"
		if [ "$verdict" = Open ]; then
			p="$(awk -F'\t' -v b="$name" '$1 == b && $2 == "Open" { print $3; exit }' "$WORK/forced.tsv")"
			printf 'Uncertain\t%s\t%s\topen PR #%s has this branch as its head\n' "$name" "$tip" "$p" >>"$WORK/rows.tsv"
			continue
		fi
		if [ "$verdict" = Merged ]; then
			printf 'Merged\t%s\t%s\tmerged PR into %s has exactly this tip as its head\n' "$name" "$tip" "$DEFAULT_NAME" >>"$WORK/rows.tsv"
			continue
		fi
		if [ "$verdict" = Uncertain ]; then
			printf 'Uncertain\t%s\t%s\ta merged PR for this branch has a different head than this tip\n' "$name" "$tip" >>"$WORK/rows.tsv"
			continue
		fi
		proof="$(kept_ref_containing "$tip")"
		if [ -n "$proof" ]; then
			printf 'Transient\t%s\t%s\ttip survives at %s\n' "$name" "$tip" "$proof" >>"$WORK/rows.tsv"
			continue
		fi
		parents="$(git rev-list --parents -n 1 "$tip" | cut -d' ' -f2-)"
		case "$parents" in
		*" "*)
			ok=1
			for p in $parents; do
				[ -n "$(kept_ref_containing "$p")" ] || ok=0
			done
			if [ "$ok" = 1 ]; then
				printf 'Transient\t%s\t%s\tmerge commit whose parents all survive on protected or pre-rebase refs\n' "$name" "$tip" >>"$WORK/rows.tsv"
				continue
			fi
			;;
		esac
		# Another candidate strictly ahead of this one, itself not contained in
		# anything further (so it is one this plan keeps).
		proof=""
		first=""
		others="$(git for-each-ref --contains "$tip" --format='%(objectname)%09%(refname:strip=2)' refs/heads/)"
		while IFS="$TAB" read -r otip o; do
			[ -n "$o" ] && [ "$o" != "$name" ] || continue
			is_candidate "$o" || continue
			# A candidate a merged PR settles is deleted by this plan, so it
			# keeps nothing alive.
			[ "$(forced_verdict "$o")" != Merged ] || continue
			if [ "$otip" = "$tip" ]; then
				# Same tip: the earliest name is the one kept.
				[ -n "$first" ] || { [ "$o" \< "$name" ] && first="$o"; }
				continue
			fi
			if ! git for-each-ref --contains "$otip" --format='%(objectname)' refs/heads/ | grep -q -v -x "$otip"; then
				proof="$o"
			fi
		done <<EOF
$others
EOF
		if [ -n "$proof" ]; then
			printf 'Transient\t%s\t%s\ttip survives at kept branch %s\n' "$name" "$tip" "$proof" >>"$WORK/rows.tsv"
		elif [ -n "$first" ]; then
			printf 'Transient\t%s\t%s\tsame tip as kept branch %s\n' "$name" "$tip" "$first" >>"$WORK/rows.tsv"
		else
			ok="$(git rev-list --count "$DEFAULT_OID..$tip" 2>/dev/null)" || ok="?"
			o=""
			grep -Fq "$TAB$name$TAB" "$WORK/branches.tsv" && o="$(awk -F'\t' -v b="$name" '$2 == b { print $4; exit }' "$WORK/branches.tsv")"
			printf 'Uncertain\t%s\t%s\t%s commit(s) not on %s%s\n' "$name" "$tip" "$ok" "$DEFAULT_NAME" "${o:+; upstream is $o}" >>"$WORK/rows.tsv"
		fi
	done <"$WORK/cand.tsv"
}

# Decode one breadcrumb row into: class, date, shown name.
crumb_rows() { # <layout: hier|flat> <listing file>
	local layout="$1" oid type marker ref rest date comp name alt hex
	while IFS=' ' read -r oid type marker ref; do
		[ -n "$ref" ] || continue
		if [ "$layout" = flat ]; then
			rest="${ref#refs/pruned/flat/}"
		else
			rest="${ref#refs/pruned/}"
		fi
		date="${rest%%/*}"
		comp="${rest#*/}"
		if [ "$marker" != direct ]; then
			printf 'Unrecognized\tkeep\t-\t-\t%s\tsymbolic ref; the tip shown is its target'"'"'s\t%s\n' "$oid" "$ref"
			continue
		fi
		if [ "$type" != commit ]; then
			printf 'Unrecognized\tkeep\t-\t-\t%s\tnot a commit\t%s\n' "$oid" "$ref"
			continue
		fi
		case "$date" in
		[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) ;;
		*)
			printf 'Unrecognized\tkeep\t-\t-\t%s\tdate segment is not YYYYMMDD\t%s\n' "$oid" "$ref"
			continue
			;;
		esac
		if [ "$rest" = "$date" ] || [ -z "$comp" ] || { [ "$layout" = flat ] && [ "${comp#*/}" != "$comp" ]; }; then
			printf 'Unrecognized\tkeep\t-\t-\t%s\tmatches neither breadcrumb layout\t%s\n' "$oid" "$ref"
			continue
		fi
		# A collided claim appended -<short-tip>[-2..9]; strip it only when the
		# hex is a prefix of this row's own OID, and report both readings.
		name="$comp"
		alt=""
		hex="$(printf '%s' "$comp" | sed -nE 's/^.*-([0-9a-f]{4,40})(-[2-9])?$/\1/p')"
		if [ -n "$hex" ] && [ "${oid#"$hex"}" != "$oid" ]; then
			alt="$(printf '%s' "$comp" | sed -E 's/-[0-9a-f]{4,40}(-[2-9])?$//')"
		fi
		if [ "$layout" = flat ]; then
			name="$(printf '%s' "$name" | sed -e 's/%2F/\//g' -e 's/%25/%/g')"
			[ -z "$alt" ] || alt="$(printf '%s' "$alt" | sed -e 's/%2F/\//g' -e 's/%25/%/g')"
		fi
		[ -z "$alt" ] || name="$alt or $name"
		printf 'PENDING\t-\t%s\t%s\t%s\t-\t%s\n' "$date" "$name" "$oid" "$ref"
	done <"$2"
}

classify_breadcrumbs() {
	: >"$WORK/crumbs.tsv"
	CRUMB_NOTES=""
	local fmt='%(objectname) %(objecttype) %(if)%(symref)%(then)symref%(else)direct%(end) %(refname)'
	local split=1 today today_j layout prefix n row class action date name oid reason ref age cur
	if ! git for-each-ref --count=1 --exclude=refs/pruned/flat/ refs/pruned/ >/dev/null 2>&1; then
		split=0
	fi
	today="$(date -u +%Y%m%d)"
	today_j="$(jdn "$today")"
	for layout in hier flat; do
		if [ "$split" = 0 ]; then
			[ "$layout" = hier ] || continue
			git for-each-ref --count=$((CRUMB_BUDGET + 1)) --format="$fmt" refs/pruned/ >"$WORK/crumb.all"
			grep ' refs/pruned/flat/' "$WORK/crumb.all" >"$WORK/crumb.flat" || true
			grep -v ' refs/pruned/flat/' "$WORK/crumb.all" >"$WORK/crumb.hier" || true
			n="$(wc -l <"$WORK/crumb.all" | tr -d ' ')"
			[ "$n" -le "$CRUMB_BUDGET" ] || CRUMB_NOTES="refs/pruned/ truncated at the $CRUMB_BUDGET-breadcrumb budget (this Git cannot list the layouts separately)"
			git for-each-ref --merged="$DEFAULT_OID" --format='%(objectname) %(refname)' refs/pruned/ >"$WORK/crumb.merged"
			git for-each-ref --no-merged="$DEFAULT_OID" --format='%(objectname) %(refname)' refs/pruned/ >"$WORK/crumb.nomerged"
			crumb_rows hier "$WORK/crumb.hier" >"$WORK/crumb.pending"
			crumb_rows flat "$WORK/crumb.flat" >>"$WORK/crumb.pending"
		else
			if [ "$layout" = flat ]; then
				git for-each-ref --count=$((CRUMB_BUDGET + 1)) --format="$fmt" refs/pruned/flat/ >"$WORK/crumb.$layout"
				git for-each-ref --merged="$DEFAULT_OID" --format='%(objectname) %(refname)' refs/pruned/flat/ >"$WORK/crumb.merged"
				git for-each-ref --no-merged="$DEFAULT_OID" --format='%(objectname) %(refname)' refs/pruned/flat/ >"$WORK/crumb.nomerged"
			else
				git for-each-ref --count=$((CRUMB_BUDGET + 1)) --exclude=refs/pruned/flat/ --format="$fmt" refs/pruned/ >"$WORK/crumb.$layout"
				git for-each-ref --merged="$DEFAULT_OID" --exclude=refs/pruned/flat/ --format='%(objectname) %(refname)' refs/pruned/ >"$WORK/crumb.merged"
				git for-each-ref --no-merged="$DEFAULT_OID" --exclude=refs/pruned/flat/ --format='%(objectname) %(refname)' refs/pruned/ >"$WORK/crumb.nomerged"
			fi
			n="$(wc -l <"$WORK/crumb.$layout" | tr -d ' ')"
			if [ "$n" -gt "$CRUMB_BUDGET" ]; then
				prefix="hierarchical"
				[ "$layout" = hier ] || prefix="flat"
				CRUMB_NOTES="${CRUMB_NOTES:+$CRUMB_NOTES; }$prefix layout truncated at the $CRUMB_BUDGET-breadcrumb budget"
				head -n "$CRUMB_BUDGET" "$WORK/crumb.$layout" >"$WORK/crumb.cut" && mv "$WORK/crumb.cut" "$WORK/crumb.$layout"
			fi
			crumb_rows "$layout" "$WORK/crumb.$layout" >"$WORK/crumb.pending"
		fi
		while IFS="$TAB" read -r class action date name oid reason ref; do
			if [ "$class" != PENDING ]; then
				printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$class" "$action" "$date" "$name" "$oid" "$reason" "$ref" >>"$WORK/crumbs.tsv"
				continue
			fi
			age=$((today_j - $(jdn "$date")))
			if grep -Fqx -- "$oid $ref" "$WORK/crumb.merged"; then
				if [ "$age" -ge "$CRUMB_MIN_AGE_DAYS" ]; then
					printf 'Redundant\tsweep\t%s\t%s\t%s\tlanded in %s; %s days old\t%s\n' "$date" "$name" "$oid" "$DEFAULT_NAME" "$age" "$ref" >>"$WORK/crumbs.tsv"
				else
					printf 'Redundant\tkeep\t%s\t%s\t%s\tlanded, but only %s days old (too recent to sweep)\t%s\n' "$date" "$name" "$oid" "$age" "$ref" >>"$WORK/crumbs.tsv"
				fi
			elif grep -Fqx -- "$oid $ref" "$WORK/crumb.nomerged"; then
				printf 'Load-bearing\tkeep\t%s\t%s\t%s\tcommits unreachable from %s\t%s\n' "$date" "$name" "$oid" "$DEFAULT_NAME" "$ref" >>"$WORK/crumbs.tsv"
			else
				cur="$(cat "$WORK/crumb.merged" "$WORK/crumb.nomerged" | awk -v r="$ref" '$2 == r { print $1; exit }')"
				if [ -n "$cur" ]; then
					printf 'Changed\tkeep\t%s\t%s\t%s\tref moved since the inventory, to %s\t%s\n' "$date" "$name" "$oid" "$cur" "$ref" >>"$WORK/crumbs.tsv"
				else
					printf 'Changed\tkeep\t%s\t%s\t%s\tno longer returned by the reachability queries\t%s\n' "$date" "$name" "$oid" "$ref" >>"$WORK/crumbs.tsv"
				fi
			fi
		done <"$WORK/crumb.pending"
		[ "$split" = 1 ] || break
	done
}

cmd_plan() {
	NO_PULL=0
	KEEPS=""
	while [ $# -gt 0 ]; do
		case "$1" in
		--no-pull) NO_PULL=1 ;;
		--keep)
			[ $# -ge 2 ] || usage "--keep needs a branch"
			KEEPS="${KEEPS:+$KEEPS
}$2"
			shift
			;;
		*) usage "unknown plan argument: $1" ;;
		esac
		shift
	done

	git rev-parse --git-dir >/dev/null 2>&1 || die "not inside a Git repository. Nothing was deleted."
	ORIGIN_URL="$(git remote get-url origin 2>/dev/null)" || die "no origin remote, so the default branch cannot be resolved. Nothing was deleted."
	INVOKING_TOP="$(canon "$(git rev-parse --show-toplevel)")"
	CUR_BRANCH="$(git symbolic-ref --quiet --short HEAD 2>/dev/null)" || CUR_BRANCH=""
	HEAD_OID="$(git rev-parse --verify --quiet HEAD)" || HEAD_OID=""
	STATUS_HASH="$(git status --porcelain=v1 --untracked-files=all | git hash-object --stdin)"

	WORK="$(mktemp -d "${TMPDIR:-/tmp}/prune-branches.XXXXXX")" || die "could not create a working directory"
	PLAN="$WORK/plan.tsv"

	git fetch --prune origin >/dev/null 2>&1 || die "git fetch --prune origin failed. Nothing was classified or deleted."
	resolve_selector
	resolve_default
	snapshot_worktrees

	local common root
	common="$(canon "$(git rev-parse --git-common-dir)")"
	root="$(dirname "$common")"
	HELPER_ROOT=""
	case "${CONTAINER_NAME:-}" in
	"" | . | .. | */*) ;;
	*) [ -d "$root/.worktrees/$CONTAINER_NAME" ] && HELPER_ROOT="$(canon "$root/.worktrees/$CONTAINER_NAME")" ;;
	esac

	update_local_default
	snapshot_worktrees

	PROTECTED="$DEFAULT_NAME"
	[ -z "$CUR_BRANCH" ] || PROTECTED="$PROTECTED
$CUR_BRANCH"
	local k unknown=""
	if [ -n "$KEEPS" ]; then
		while IFS= read -r k; do
			if git show-ref --verify --quiet "refs/heads/$k"; then
				PROTECTED="$PROTECTED
$k"
			else
				unknown="${unknown:+$unknown, }$k"
			fi
		done <<EOF
$KEEPS
EOF
	fi

	# A symbolic ref under refs/heads/ is another branch's alias, not a branch:
	# deleting through it would delete its target, so it is never a candidate.
	SYMBOLIC="$(git for-each-ref --format='%(if)%(symref)%(then)%(refname:strip=2)%(end)' refs/heads/ | awk 'NF')"
	[ -z "$SYMBOLIC" ] || PROTECTED="$PROTECTED
$SYMBOLIC"

	classify_branches
	classify_breadcrumbs

	{
		printf 'META\tversion\t1\n'
		printf 'META\tcreated\t%s\n' "$(date +%s)"
		printf 'META\tdate\t%s\n' "$(date -u +%Y%m%d)"
		printf 'META\ttop\t%s\n' "$INVOKING_TOP"
		printf 'META\tcommon\t%s\n' "$common"
		printf 'META\thead\t%s\n' "$HEAD_OID"
		printf 'META\tbranch\t%s\n' "$CUR_BRANCH"
		printf 'META\tstatus\t%s\n' "$STATUS_HASH"
		printf 'META\tdefault\t%s\n' "$DEFAULT_NAME"
		printf 'META\tdefault_oid\t%s\n' "$DEFAULT_OID"
		printf 'META\tdefault_source\t%s\n' "$DEFAULT_SOURCE"
		printf 'META\tpull\t%s\n' "$PULL_RESULT"
		printf 'META\tselector\t%s\n' "${ORIGIN_SELECTOR:-none ($SELECTOR_NOTE)}"
		printf 'META\tcrumb_notes\t%s\n' "$CRUMB_NOTES"
		printf 'META\tunknown_keeps\t%s\n' "$unknown"
		local name tip why
		while IFS= read -r name; do
			tip="$(git rev-parse --verify --quiet "refs/heads/$name")" || continue
			if [ "$name" = "$DEFAULT_NAME" ]; then
				why="authoritative default branch"
			elif [ "$name" = "$CUR_BRANCH" ]; then
				why="current branch in invoking worktree"
			elif in_list "$name" "$SYMBOLIC"; then
				why="symbolic ref to $(git symbolic-ref --quiet "refs/heads/$name"), not a branch of its own"
			else
				why="kept on request"
			fi
			printf 'BRANCH\tProtected\tkeep\t%s\t%s\tnone\t-\t%s\t-\n' "$name" "$tip" "$why"
		done <<EOF
$(printf '%s\n' "$PROTECTED" | awk '!s[$0]++')
EOF
		local bucket action
		while IFS="$TAB" read -r bucket name tip why; do
			worktree_of "$name"
			action=delete
			[ "$bucket" != Uncertain ] || action=keep
			case "$WT_KIND" in
			main)
				action=keep
				why="$why; checked out in the main worktree, which is never removed"
				;;
			other)
				[ "$action" = keep ] || action=needs-approval
				why="$why; checked out in a worktree this run does not own"
				;;
			helper)
				[ "$WT_LOCKED" = 0 ] || {
					action=keep
					why="$why; its worktree is locked"
				}
				;;
			esac
			printf 'BRANCH\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$bucket" "$action" "$name" "$tip" "$WT_KIND" "${WT_SLUG:--}" "$why" "${WT_PATH:--}"
		done <"$WORK/rows.tsv"
		local class date oid ref
		while IFS="$TAB" read -r class action date name oid why ref; do
			printf 'CRUMB\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$class" "$action" "$date" "$name" "$oid" "$why" "$ref"
		done <"$WORK/crumbs.tsv"
	} >"$PLAN"

	print_listing "$PLAN" 0 "" "" "" 0 ""
	printf 'plan: %s\n' "$PLAN"
}

# ---------------------------------------------------------------------------
# listing (shared by plan and apply --dry-run)
# ---------------------------------------------------------------------------

meta() { awk -F'\t' -v k="$2" '$1 == "META" && $2 == k { print $3; exit }' "$1"; }

# Effective action for a branch row under apply's flags.
effective_action() { # bucket action name wtkind wtpath
	local bucket="$1" action="$2" name="$3" kind="$4" path="$5"
	if in_list "$name" "$A_KEEPS"; then
		echo keep
		return
	fi
	if [ "$bucket" = Protected ] || [ "$kind" = main ] || [ "$kind" = invoking ]; then
		echo keep
		return
	fi
	if [ "$bucket" = Uncertain ]; then
		in_list "$name" "$A_UNCERTAIN" || {
			echo keep
			return
		}
		action=delete
		[ "$kind" != other ] || action=needs-approval
	fi
	if [ "$action" = needs-approval ]; then
		if in_list "$name$TAB$path" "$A_APPROVED"; then
			echo delete
		else
			echo keep
		fi
		return
	fi
	echo "$action"
}

print_listing() { # plan hands_off keeps uncertain approved no_sweep keep_crumbs
	local plan="$1"
	A_HANDS_OFF="$2" A_KEEPS="$3" A_UNCERTAIN="$4" A_APPROVED="$5" A_NO_SWEEP="$6" A_KEEP_CRUMBS="$7"
	local d oid tag bucket action name tip kind slug why path eff
	d="$(meta "$plan" default)"
	oid="$(meta "$plan" default_oid)"
	printf "Local branch cleanup against origin's default \`%s\` at %s:\n\n" "$d" "$(git rev-parse --short "$oid" 2>/dev/null || echo "$oid")"
	while IFS="$TAB" read -r tag bucket action name tip kind slug why path; do
		[ "$tag" = BRANCH ] || continue
		eff="$(effective_action "$bucket" "$action" "$name" "$kind" "$path")"
		if [ "$eff" = keep ] && [ "$action" = needs-approval ]; then
			why="$why; pass --approve-worktree with this branch and path to delete it"
		fi
		if [ "$bucket" = Uncertain ] && [ "$eff" = delete ]; then
			why="explicitly confirmed; $why"
		fi
		[ "$path" = - ] || why="$why [worktree: $path]"
		printf '  %-10s %-28s %s  %-6s  %s\n' "$bucket" "$name" "$(git rev-parse --short "$tip" 2>/dev/null || echo "$tip")" "$eff" "$why"
	done <"$plan"
	if grep -q '^CRUMB' "$plan"; then
		local notes class date ref
		notes="$(meta "$plan" crumb_notes)"
		printf '\nRecovery breadcrumbs from earlier runs (%s):\n\n' "${notes:-both layouts inventoried in full}"
		while IFS="$TAB" read -r tag class action date name oid why ref; do
			[ "$tag" = CRUMB ] || continue
			eff="$action"
			if [ "$action" = sweep ]; then
				if [ "$A_HANDS_OFF" = 1 ]; then
					eff="report only (hands-off)"
				elif [ "$A_NO_SWEEP" = 1 ] || in_list "$ref" "$A_KEEP_CRUMBS"; then
					eff="keep (declined)"
				fi
			fi
			printf '  %-13s %-8s  %-22s %-44s %s  %s  %s\n' "$class" "$date" "$name" "$ref" "$(git rev-parse --short "$oid" 2>/dev/null || echo "$oid")" "$eff" "$why"
		done <"$plan"
	fi
	printf '\nNon-Merged deletions are first preserved under unused refs/pruned/... names.\n'
	printf 'Default resolved from %s; local default: %s. PR lookups: %s.\n' "$(meta "$plan" default_source)" "$(meta "$plan" pull)" "$(meta "$plan" selector)"
	d="$(meta "$plan" unknown_keeps)"
	[ -z "$d" ] || printf 'Keep names that match no local branch: %s.\n' "$d"
}

# ---------------------------------------------------------------------------
# apply
# ---------------------------------------------------------------------------

# Claim an unused recovery ref for <branch> at <tip>; prints the ref.
reserve_ref() {
	local branch="$1" tip="$2" date="$3" short enc base cand i got
	short="$(git rev-parse --short "$tip")"
	enc="$(printf '%s' "$branch" | sed -e 's/%/%25/g' -e 's/\//%2F/g')"
	for base in "refs/pruned/$date/$branch" "refs/pruned/flat/$date/$enc"; do
		i=0
		while [ "$i" -lt 10 ]; do
			case "$i" in
			0) cand="$base" ;;
			1) cand="$base-$short" ;;
			*) cand="$base-$short-$i" ;;
			esac
			i=$((i + 1))
			git check-ref-format "$cand" >/dev/null 2>&1 || continue
			if printf 'option no-deref\0create %s\0%s\0' "$cand" "$tip" | git update-ref --stdin -z >/dev/null 2>&1; then
				got="$(git rev-parse --verify --quiet "$cand^{commit}")" || got=""
				if [ "$got" = "$tip" ]; then
					printf '%s' "$cand"
					return 0
				fi
				return 1
			fi
		done
	done
	return 1
}

# Why a linked worktree may not be removed, or nothing when it may.
# Where the current container's wt-remove would look for a slug, or nothing.
helper_path() { # slug
	local root
	command -v wt-remove >/dev/null 2>&1 || return 0
	case "${CONTAINER_NAME:-}" in "" | . | .. | */*) return 0 ;; esac
	root="$(dirname "$(canon "$(git rev-parse --git-common-dir)")")"
	canon "$root/.worktrees/$CONTAINER_NAME/$1"
}

worktree_blocker() { # path branch
	local path="$1" branch="$2" row gd m
	row="$(git worktree list --porcelain | awk -v p="worktree $path" '$0 == p { on = 1; next } on && /^$/ { exit } on { print }')"
	[ -n "$row" ] || {
		echo "worktree is no longer registered"
		return
	}
	printf '%s\n' "$row" | grep -Fqx "branch refs/heads/$branch" || {
		echo "worktree is no longer on this branch"
		return
	}
	printf '%s\n' "$row" | grep -q '^locked' && {
		echo "worktree is locked"
		return
	}
	[ -d "$path" ] || {
		echo "worktree directory is missing"
		return
	}
	[ -z "$(git -C "$path" status --porcelain=v1 --untracked-files=all 2>/dev/null)" ] || {
		echo "worktree has uncommitted or untracked files"
		return
	}
	gd="$(git -C "$path" rev-parse --absolute-git-dir 2>/dev/null)" || {
		echo "worktree state could not be read"
		return
	}
	for m in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG sequencer; do
		[ ! -e "$gd/$m" ] || {
			echo "worktree has an operation in progress ($m)"
			return
		}
	done
}

cmd_apply() {
	local plan="" dry=0 hands=0 nosweep=0 keeps="" uncertain="" approved="" keepcrumbs=""
	while [ $# -gt 0 ]; do
		case "$1" in
		--plan)
			[ $# -ge 2 ] || usage "--plan needs a file"
			plan="$2"
			shift
			;;
		--dry-run) dry=1 ;;
		--hands-off) hands=1 ;;
		--no-sweep) nosweep=1 ;;
		--keep)
			[ $# -ge 2 ] || usage "--keep needs a branch"
			keeps="${keeps:+$keeps
}$2"
			shift
			;;
		--delete-uncertain)
			[ $# -ge 2 ] || usage "--delete-uncertain needs a branch"
			uncertain="${uncertain:+$uncertain
}$2"
			shift
			;;
		--approve-worktree)
			[ $# -ge 3 ] || usage "--approve-worktree needs a branch and a path"
			approved="${approved:+$approved
}$2$TAB$3"
			shift 2
			;;
		--keep-breadcrumb)
			[ $# -ge 2 ] || usage "--keep-breadcrumb needs a ref"
			keepcrumbs="${keepcrumbs:+$keepcrumbs
}$2"
			shift
			;;
		*) usage "unknown apply argument: $1" ;;
		esac
		shift
	done
	[ -n "$plan" ] && [ -f "$plan" ] || usage "apply needs --plan <file> from a plan run"
	if [ "$hands" = 1 ] && { [ -n "$uncertain" ] || [ -n "$approved" ]; }; then
		usage "--hands-off deletes no Uncertain branch and removes no unowned worktree; drop --delete-uncertain / --approve-worktree"
	fi
	[ "$(meta "$plan" version)" = 1 ] || die "not a prune-branches plan: $plan"

	local top common now created d doid date
	top="$(canon "$(git rev-parse --show-toplevel 2>/dev/null)")" || top=""
	common="$(canon "$(git rev-parse --git-common-dir 2>/dev/null)")" || common=""
	[ "$common" = "$(meta "$plan" common)" ] || die "this plan belongs to another repository. Nothing was deleted."
	d="$(meta "$plan" default)"
	doid="$(meta "$plan" default_oid)"
	date="$(meta "$plan" date)"

	if [ "$dry" = 1 ]; then
		print_listing "$plan" "$hands" "$keeps" "$uncertain" "$approved" "$nosweep" "$keepcrumbs"
		return 0
	fi

	now="$(date +%s)"
	created="$(meta "$plan" created)"
	[ $((now - created)) -le "$PLAN_MAX_AGE" ] || die "this plan is more than an hour old; run plan again so deletion follows a fresh fetch. Nothing was deleted."
	[ "$(git rev-parse --verify --quiet "refs/remotes/origin/$d^{commit}")" = "$doid" ] ||
		die "origin/$d moved since the plan was made; run plan again. Nothing was deleted."

	A_HANDS_OFF="$hands" A_KEEPS="$keeps" A_UNCERTAIN="$uncertain" A_APPROVED="$approved"
	local work
	work="$(mktemp -d "${TMPDIR:-/tmp}/prune-apply.XXXXXX")" || die "could not create a working directory"
	: >"$work/todo.tsv"
	: >"$work/kept.tsv"
	: >"$work/deleted.tsv"
	: >"$work/reserved.tsv"
	: >"$work/wt.tsv"

	local tag bucket action name tip kind slug why path eff cur ref blocker
	# Step 8a: the confirmed set, each tip re-read against the snapshot.
	while IFS="$TAB" read -r tag bucket action name tip kind slug why path; do
		[ "$tag" = BRANCH ] && [ "$bucket" != Protected ] || continue
		eff="$(effective_action "$bucket" "$action" "$name" "$kind" "$path")"
		if [ "$eff" != delete ]; then
			printf '%s\t%s\t%s\t%s\n' "$bucket" "$name" "$tip" "$why" >>"$work/kept.tsv"
			continue
		fi
		cur="$(git rev-parse --verify --quiet "refs/heads/$name")" || cur=""
		if [ "$cur" != "$tip" ]; then
			printf 'Uncertain\t%s\t%s\ttip changed during run%s\n' "$name" "$tip" "${cur:+ (now $cur)}" >>"$work/kept.tsv"
			continue
		fi
		printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$bucket" "$name" "$tip" "$kind" "$slug" "$path" >>"$work/todo.tsv"
	done <"$plan"

	# Step 8b: reserve every recovery ref before anything is removed.
	: >"$work/todo2.tsv"
	while IFS="$TAB" read -r bucket name tip kind slug path; do
		ref="-"
		if [ "$bucket" != Merged ]; then
			if ref="$(reserve_ref "$name" "$tip" "$date")"; then
				printf '%s\t%s\t%s\n' "$name" "$tip" "$ref" >>"$work/reserved.tsv"
			else
				printf '%s\t%s\t%s\tno recovery ref could be claimed and verified\n' "$bucket" "$name" "$tip" >>"$work/kept.tsv"
				continue
			fi
		fi
		printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$bucket" "$name" "$tip" "$kind" "$slug" "$path" "$ref" >>"$work/todo2.tsv"
	done <"$work/todo.tsv"

	# Steps 9 and 10: worktree first, then the exact-tip deletion.
	while IFS="$TAB" read -r bucket name tip kind slug path ref; do
		if [ "$kind" = helper ] || [ "$kind" = other ]; then
			blocker="$(worktree_blocker "$path" "$name")"
			if [ -z "$blocker" ]; then
				if [ "$kind" = helper ]; then
					# wt-remove resolves the slug under the current container's
					# root, so that must still be the worktree the plan saw.
					if [ "$(helper_path "$slug")" != "$path" ]; then
						blocker="this container no longer owns the worktree"
					else
						(cd "$top" && wt-remove "$slug") >/dev/null 2>&1 || blocker="wt-remove refused"
					fi
				else
					git worktree remove "$path" >/dev/null 2>&1 || blocker="git worktree remove refused"
				fi
			fi
			if [ -n "$blocker" ]; then
				printf 'Uncertain\t%s\t%s\t%s; worktree %s left in place\n' "$name" "$tip" "$blocker" "$path" >>"$work/kept.tsv"
				printf 'preserved\t%s\t%s\n' "$path" "$blocker" >>"$work/wt.tsv"
				continue
			fi
			printf 'removed\t%s\t-\n' "$path" >>"$work/wt.tsv"
		fi
		if git worktree list --porcelain | grep -Fqx "branch refs/heads/$name"; then
			printf 'Uncertain\t%s\t%s\tchecked out in a worktree\n' "$name" "$tip" >>"$work/kept.tsv"
			continue
		fi
		# The expected old value makes the deletion and the tip check one step.
		if git update-ref --no-deref -d "refs/heads/$name" "$tip" >/dev/null 2>&1; then
			git config --remove-section "branch.$name" >/dev/null 2>&1 || true
			printf '%s\t%s\t%s\t%s\n' "$bucket" "$name" "$tip" "$ref" >>"$work/deleted.tsv"
		else
			cur="$(git rev-parse --verify --quiet "refs/heads/$name")" || cur=""
			printf 'Uncertain\t%s\t%s\ttip changed just before deletion%s\n' "$name" "$tip" "${cur:+ (now $cur)}" >>"$work/kept.tsv"
		fi
	done <"$work/todo2.tsv"

	# Step 10, second half: sweep the redundant breadcrumbs the plan marked.
	: >"$work/crumbs.tsv"
	local class oid target
	while IFS="$TAB" read -r tag class action date name oid why ref; do
		[ "$tag" = CRUMB ] || continue
		if [ "$action" != sweep ]; then
			printf '%s\t%s\t%s\t%s\t%s\t%s\n' "kept: $class" "$date" "$name" "$oid" "$why" "$ref" >>"$work/crumbs.tsv"
			continue
		fi
		if [ "$hands" = 1 ] || [ "$nosweep" = 1 ] || in_list "$ref" "$keepcrumbs"; then
			printf 'declined\t%s\t%s\t%s\t%s\t%s\n' "$date" "$name" "$oid" "$why" "$ref" >>"$work/crumbs.tsv"
			continue
		fi
		if git update-ref --no-deref -d "$ref" "$oid" >/dev/null 2>&1; then
			printf 'swept\t%s\t%s\t%s\t%s\t%s\n' "$date" "$name" "$oid" "$why" "$ref" >>"$work/crumbs.tsv"
		elif target="$(git symbolic-ref --quiet "$ref" 2>/dev/null)"; then
			printf 'refused: replaced\t%s\t%s\t%s\tnow a symbolic ref to %s\t%s\n' "$date" "$name" "$oid" "$target" "$ref" >>"$work/crumbs.tsv"
		elif cur="$(git rev-parse --verify --quiet "$ref" 2>/dev/null)"; then
			if [ "$cur" = "$oid" ]; then
				printf 'failed\t%s\t%s\t%s\tsweep errored with the ref unchanged\t%s\n' "$date" "$name" "$oid" "$ref" >>"$work/crumbs.tsv"
			else
				printf 'refused: moved\t%s\t%s\t%s\tnow at %s\t%s\n' "$date" "$name" "$oid" "$cur" "$ref" >>"$work/crumbs.tsv"
			fi
		else
			printf 'refused: vanished\t%s\t%s\t%s\tthe ref is gone\t%s\n' "$date" "$name" "$oid" "$ref" >>"$work/crumbs.tsv"
		fi
	done <"$plan"

	# Step 11: the report.
	printf 'prune-branches report\n\n'
	printf "Fetched origin; default \`%s\` at %s (from %s). Local default: %s.\n" "$d" "$doid" "$(meta "$plan" default_source)" "$(meta "$plan" pull)"
	printf '\nDeleted:\n'
	[ -s "$work/deleted.tsv" ] || printf '  (none)\n'
	while IFS="$TAB" read -r bucket name tip ref; do
		printf '  %-10s %s  %s' "$bucket" "$name" "$tip"
		[ "$ref" = - ] || printf '  backup %s' "$ref"
		printf '\n'
	done <"$work/deleted.tsv"
	printf '\nKept:\n'
	[ -s "$work/kept.tsv" ] || printf '  (none)\n'
	while IFS="$TAB" read -r bucket name tip why; do
		printf '  %-10s %s  %s  %s\n' "$bucket" "$name" "$tip" "$why"
	done <"$work/kept.tsv"
	if [ -s "$work/wt.tsv" ]; then
		printf '\nWorktrees:\n'
		while IFS="$TAB" read -r tag path why; do
			printf '  %-9s %s' "$tag" "$path"
			[ "$why" = - ] || printf '  (%s)' "$why"
			printf '\n'
		done <"$work/wt.tsv"
	fi
	local unused=""
	while IFS="$TAB" read -r name tip ref; do
		awk -F'\t' -v b="$name" '$2 == b { found = 1 } END { exit !found }' "$work/deleted.tsv" || unused="$unused  $ref  at $tip  (branch $name was not deleted)
"
	done <"$work/reserved.tsv"
	[ -z "$unused" ] || printf '\nRecovery refs reserved for branches that remained:\n%s' "$unused"
	if [ -s "$work/crumbs.tsv" ]; then
		printf '\nBreadcrumbs from earlier runs (tips are the inventoried ones):\n'
		[ -z "$(meta "$plan" crumb_notes)" ] || printf '  note: %s\n' "$(meta "$plan" crumb_notes)"
		while IFS="$TAB" read -r tag date name oid why ref; do
			printf '  %-18s %-8s  %s  %s  %s  %s\n' "$tag" "$date" "$name" "$ref" "$oid" "$why"
		done <"$work/crumbs.tsv"
		grep -q '^refused' "$work/crumbs.tsv" && printf '  A refused sweep is a race: another process touched refs/pruned/** during the run.\n'
	fi

	if [ -s "$work/deleted.tsv" ]; then
		printf '\nRestore a deleted branch from its tip:\n'
		while IFS="$TAB" read -r bucket name tip ref; do
			printf '  git branch %s %s\n' "$(sq "$name")" "$tip"
		done <"$work/deleted.tsv"
	fi
	if [ -s "$work/reserved.tsv" ]; then
		printf '\nInspect or restore through the backup refs:\n'
		printf '  git for-each-ref %s %s\n' "$(sq "refs/pruned/$date/")" "$(sq "refs/pruned/flat/$date/")"
		while IFS="$TAB" read -r name tip ref; do
			printf '  git branch %s %s\n' "$(sq "$name")" "$(sq "$ref")"
		done <"$work/reserved.tsv"
		printf '\nDrop a backup ref once you no longer need it (refs keep commits advertised until dropped):\n'
		while IFS="$TAB" read -r name tip ref; do
			printf '  git update-ref --no-deref -d %s %s\n' "$(sq "$ref")" "$tip"
		done <"$work/reserved.tsv"
	fi
	if grep -q '^declined' "$work/crumbs.tsv"; then
		printf '\nRedundant breadcrumbs left in place this run; to remove them:\n'
		while IFS="$TAB" read -r tag date name oid why ref; do
			[ "$tag" = declined ] || continue
			printf '  git update-ref --no-deref -d %s %s\n' "$(sq "$ref")" "$oid"
		done <"$work/crumbs.tsv"
	fi
	printf '\nA deleted Merged branch has no backup ref; its SHA above, the reflog, or git fsck --lost-found can recover it until garbage collection.\n'

	# Orientation: the invoking checkout must be where the plan found it.
	local nowbranch nowhead nowstatus
	nowbranch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null)" || nowbranch=""
	nowhead="$(git rev-parse --verify --quiet HEAD)" || nowhead=""
	nowstatus="$(git status --porcelain=v1 --untracked-files=all | git hash-object --stdin)"
	if [ "$top" = "$(meta "$plan" top)" ] && [ "$nowbranch" = "$(meta "$plan" branch)" ] && [ "$nowhead" = "$(meta "$plan" head)" ] && [ "$nowstatus" = "$(meta "$plan" status)" ]; then
		printf 'The invoking checkout is on the same branch, commit and working-tree state as when the plan was made.\n'
	else
		printf 'NOTE: the invoking checkout differs from when the plan was made (branch, commit or working-tree state). This run did not change it; nothing was restored.\n'
	fi
	printf 'No remote ref or PR was changed.\n'
	rm -rf "$work"
}

case "${1:-}" in
plan)
	shift
	cmd_plan "$@"
	;;
apply)
	shift
	cmd_apply "$@"
	;;
-h | --help)
	sed -n '2,45p' "$0" | sed 's/^# \{0,1\}//'
	;;
*) usage "expected plan or apply" ;;
esac
