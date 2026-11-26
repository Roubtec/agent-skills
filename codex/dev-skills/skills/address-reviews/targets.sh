#!/usr/bin/env bash
# targets.sh — a review batch's entries, their stack, and each rebase target.
#
# Usage, from the orchestrator's own checkout (or `-C <dir>` ahead of the command):
#   targets.sh plan  --repo <owner>/<repo> [--target <ref>] [--no-rebase | --except <entry>...] <entry>...
#   targets.sh repin --repo <owner>/<repo> --pr <N>
#
# `<owner>/<repo>` is the one repository every PR of the batch is in; write it
# `<host>/<owner>/<repo>` where that is not github.com. Every `gh` call names
# it, and the PR number wherever it has one.
#
# plan   Reads every entry once, in the order given, and prints the batch:
#          outcome=planned
#          repo=      the repository as the PRs' own URLs name it, always
#                     `<host>/<owner>/<repo>`: what every later command for
#                     these entries is given
#          named=     the commit `--target` resolved to (only with `--target`)
#          stacked=   yes | no: some usable entry is based on another listed
#                     PR's branch, whether or not that parent is skipped
#          skipped=   how many entries carry a `skip=` reason
#        then one line per entry, TAB-separated `key=value` fields, every
#        parent ahead of its dependents (by depth in the stack, then as
#        listed):
#          entry=     the entry as it was given
#          kind=      pr | branch
#          pr=        its PR number
#          skip=      `-`, or why this entry cannot be worked (below)
#          order=     its place in that parent-first order, from 1
#          parent=    the listed PR whose head branch is this one's base
#                     branch, `-` for none
#          same-head= an earlier-listed PR publishing from the same head
#                     branch, `-` for none: the two cannot run at once
#          head-ref=  the PR's head branch
#          head=      the head commit, as fetched now: create or compare the
#                     branch at this, never at a remote-tracking ref
#          reported=  the head commit GitHub reported just before that fetch
#          relation=  how a local branch of that name stands to it: absent |
#                     equal | behind | ahead | represented | divergent
#          base-ref=  the PR's base branch
#          base-oid=  the base commit GitHub reports for the PR
#          rebase=    yes | no
#          target=    where `pin=` comes from: default | named | parent
#          pin=       an exact commit, or `-`
#        A field with nothing to say is `-`.
#        With rebase=yes, `pin=` is what the entry's first rebase goes onto:
#          target=default  its own base branch, fetched from the repository
#                          now. That branch moves, so `repin` reads it again
#                          just before each rebase.
#          target=named    the `--target` commit, the same for the whole run
#          target=parent   pin=-: its parent's tip once the parent's own
#                          rebase has returned, which nothing can name yet.
#                          A dependent goes onto its parent whatever
#                          `--target` says, and its parent is named even
#                          where that parent is itself skipped or not rebased.
#        With rebase=no, `pin=` is the entry's effective base for the whole
#        run, fixed here: under `--no-rebase` the `--target` commit where one
#        was given (target=named), else its own base branch fetched now
#        (target=default); for an `--except` entry always its own base branch.
#        An entry is a PR number (`38`, `#38`); anything else is a local
#        branch name, which `refs/heads/<name>` says outright for a branch
#        named like a number. A branch entry has to be a local branch here and
#        the head of exactly one open PR.
#        `--target` is resolved once, in this checkout, as one argument to
#        `git rev-parse --verify '<it>^{commit}'`: a local branch, a
#        remote-tracking ref or a commit. Nothing is fetched for it and
#        nothing is substituted for it. To run `plan` again later in a batch,
#        pass the `named=` commit as `--target`: a ref name may have moved.
#        `--no-rebase` turns rebasing off for every entry; `--except <entry>`
#        (repeatable) for one, spelled as it is listed. An entry listed twice,
#        or as a number and as its branch, is planned once, and is excepted
#        when either spelling is.
#        skip= reasons, each explained on stderr, the other entries unaffected:
#          not-local   a branch entry that is not a local branch here
#          no-pr       a branch entry with no open PR from that head
#          ambiguous   a branch entry with several open PRs from that head
#          alias       the same PR as an earlier entry (`pr=` says which)
#          closed | fork | rewind | no-remote
#                      as `pr-branch.sh head` of the address-review skill
#                      stops on them; `no-remote` also where the base branch
#                      has no remote to be fetched from. A fork PR is the
#                      parent of nothing: its head branch is not this
#                      repository's.
#        and stops, printing no entry, on:
#          outcome=unresolved  `--target` does not resolve here (`target=`)
#          outcome=cycle       the listed PRs are based on each other in a
#                              ring, so there is no parent-first order
# repin  One PR's own base branch, read from the PR and fetched again: what a
#        target=default entry is pinned to immediately before each of its
#        rebases. Not for target=named or target=parent, which never move.
#          outcome=pinned   pr= repo= base-ref= (as the PR names it now) pin=
#        and stops on closed (`state=`) or no-remote.
#
# The fetching and pinning are not reimplemented here: they are `head` and
# `pin-base` of the address-review skill's `pr-branch.sh`, called from that
# skill's folder beside this skill's. Nothing here moves a branch, creates a
# worktree or rebases.
#
# Output: `key=value` lines on stdout, `outcome=` first; the explanation of a
# stop or a skip goes to stderr. Exit status: 0 to proceed (skipped entries
# included: read `skip=`), 3 on a stop that needs a decision, 1 on a failure
# (network, gh, a base branch that cannot be fetched, a head that moves under
# the fetch: nothing is printed, since half a plan is not one), 64 on a
# usage error. Needs gh. Written for bash 3.2 and later.
set -u

SEP="$(printf '\037')"
TAB="$(printf '\t')"
case "$0" in
/*) SELF="$0" ;;
*) SELF="$PWD/$0" ;;
esac
PRB="$(dirname -- "$SELF")/../address-review/pr-branch.sh"

say() { printf '%s\n' "$*"; }
note() { printf 'targets: %s\n' "$*" >&2; }
fail() {
	note "$*"
	exit 1
}
usage() {
	note "$*"
	sed -n '4,6p' "$SELF" | sed 's/^# \{0,1\}//' >&2
	exit 64
}
stop() { # <outcome> <explanation> [key=value...]
	say "outcome=$1"
	note "$2"
	shift 2
	local l
	for l in "$@"; do say "$l"; done
	exit 3
}
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
# The value of the first `<key>=` line of a helper's output.
field() { # key, text
	printf '%s\n' "$2" | awk -v k="$1=" 'index($0, k) == 1 { print substr($0, length(k) + 1); exit }'
}

TMP=""
setup() {
	git rev-parse --git-dir >/dev/null 2>&1 || fail "not inside a Git repository: run this from the orchestrator's own checkout."
	[ -f "$PRB" ] || fail "$PRB is missing. This helper uses the address-review skill's scripts, which install in the folder beside this skill's."
	TMP="$(mktemp -d "${TMPDIR:-/tmp}/targets.XXXXXX")" || fail "could not create a temporary directory."
	# shellcheck disable=SC2064 # expand now: the directory this run made
	trap "rm -rf '$TMP'" EXIT
}

# Runs the address-review skill's pr-branch.sh: PRB_OUT is its stdout, PRB_RC 0
# or 3. Its explanation of a stop is passed on; anything else fails this run.
PRB_OUT="" PRB_RC=0
prb() {
	PRB_RC=0
	PRB_OUT="$(bash "$PRB" "$@" 2>"$TMP/err")" || PRB_RC=$?
	case "$PRB_RC" in
	0) ;;
	3) cat "$TMP/err" >&2 ;;
	*)
		cat "$TMP/err" >&2
		fail "pr-branch.sh $1 failed, so nothing is planned. \"Could not tell\" is not an answer."
		;;
	esac
}

REPO="" PR="" TARGET="" HAS_TARGET=0 NO_REBASE=0 CANON=""
N=0  # entries
NX=0 # --except values

parse() {
	while [ $# -gt 0 ]; do
		case "$1" in
		--repo | --pr | --target | --except)
			[ $# -ge 2 ] || usage "$1 needs a value"
			case "$1" in
			--repo) REPO="$2" ;;
			--pr) PR="$2" ;;
			--target)
				[ -n "$2" ] || usage "--target needs a ref or a commit"
				TARGET="$2"
				HAS_TARGET=1
				;;
			--except)
				X_RAW[NX]="$2"
				NX=$((NX + 1))
				;;
			esac
			shift 2
			;;
		--no-rebase)
			NO_REBASE=1
			shift
			;;
		-*) usage "unknown argument: $1" ;;
		*)
			E_RAW[N]="$1"
			N=$((N + 1))
			shift
			;;
		esac
	done
	case "$REPO" in
	?*/?*) ;;
	*) usage "--repo <owner>/<repo> is required (the repository the PRs are in)" ;;
	esac
}

# What an entry names: KEY is `pr:<N>` or `branch:<name>`.
KEY=""
classify() { # entry as given
	local e="$1" n
	case "$e" in
	'' | *[[:space:][:cntrl:]]*) usage "'$e' is not an entry: a PR number or a branch name" ;;
	esac
	n="${e#'#'}"
	case "$n" in
	'' | *[!0-9]*)
		e="${e#refs/heads/}"
		[ -n "$e" ] || usage "'$1' is not an entry: a PR number or a branch name"
		KEY="branch:$e"
		;;
	*)
		n="$(printf '%s' "$n" | sed 's/^0*//')"
		[ -n "$n" ] || usage "'$e' is not a PR number"
		KEY="pr:$n"
		;;
	esac
}

# One PR as `gh` reports it: R_NUM R_STATE R_URL R_HEAD R_OID R_BASE R_BOID.
FIELDS=number,state,url,headRefName,headRefOid,baseRefName,baseRefOid
JQ='[.number, .state, .url, .headRefName, .headRefOid, .baseRefName, .baseRefOid] | map(. // "" | tostring) | join("\u001f")'
R_NUM="" R_STATE="" R_URL="" R_HEAD="" R_OID="" R_BASE="" R_BOID=""
take() { # one answer line, what it answers for
	IFS="$SEP" read -r R_NUM R_STATE R_URL R_HEAD R_OID R_BASE R_BOID <<EOF
$1
EOF
	[ -n "$R_NUM" ] && [ -n "$R_URL" ] && [ -n "$R_HEAD" ] && [ -n "$R_OID" ] && [ -n "$R_BASE" ] ||
		fail "$2 in $REPO answered without a number, a URL, a head or a base. Nothing is planned."
}
# The repository a PR's own URL names, which has to be the one `--repo` names.
canon() { # url, what it is the URL of
	local u host path owner name got want
	u="${1#*://}"
	host="${u%%/*}"
	path="${u#*/}"
	owner="${path%%/*}"
	path="${path#*/}"
	name="${path%%/*}"
	# Always with its host: a bare owner/name is read on whatever host
	# GH_HOST names, which need not be the one this URL is on.
	got="$host/$owner/$name"
	want="$(lower "$REPO")"
	# A selector without a host takes the host gh placed it on.
	case "$want" in
	github.com/* | */*/*) ;;
	*) want="$(lower "$host")/$want" ;;
	esac
	case "$(lower "$host/$owner/$name")" in
	"$want") ;;
	*) fail "$2 is in $got by its own URL, not in $REPO. One batch is one repository: pass --repo $got if that is the one meant." ;;
	esac
	[ -z "$CANON" ] || [ "$(lower "$CANON")" = "$(lower "$got")" ] ||
		fail "$2 is in $got by its own URL, and an earlier entry in $CANON. One batch is one repository."
	CANON="$got"
}

# The base branch's commit, fetched once per branch per run: PIN is the commit,
# or empty with PIN_SKIP the reason it has none.
PIN="" PIN_SKIP="" NC=0
pin_default() { # base branch
	local c=0
	while [ "$c" -lt "$NC" ]; do
		if [ "${C_BASE[c]}" = "$1" ]; then
			PIN="${C_PIN[c]}"
			PIN_SKIP="${C_SKIP[c]}"
			return 0
		fi
		c=$((c + 1))
	done
	PIN="" PIN_SKIP=""
	prb pin-base --repo "$CANON" --base "$1"
	if [ "$PRB_RC" -eq 0 ]; then
		PIN="$(field base "$PRB_OUT")"
		[ -n "$PIN" ] || fail "pr-branch.sh pin-base answered without a commit for $1. Nothing is planned."
	else
		PIN_SKIP="$(field outcome "$PRB_OUT")"
		[ -n "$PIN_SKIP" ] || fail "pr-branch.sh pin-base stopped without saying why. Nothing is planned."
	fi
	C_BASE[NC]="$1"
	C_PIN[NC]="$PIN"
	C_SKIP[NC]="$PIN_SKIP"
	NC=$((NC + 1))
}

cmd_plan() {
	parse "$@"
	[ -z "$PR" ] || usage "plan takes its entries as plain arguments, not --pr"
	[ "$N" -gt 0 ] || usage "plan needs at least one entry: a PR number or a branch name"
	[ "$NO_REBASE" -eq 0 ] || [ "$NX" -eq 0 ] || usage "give --no-rebase or --except, not both: --no-rebase already covers every entry"
	local i j x out count named="" hit d p steps max order stacked=no skipped=0 name
	i=0
	while [ "$i" -lt "$N" ]; do
		classify "${E_RAW[i]}"
		E_KEY[i]="$KEY"
		E_EXC[i]=0
		i=$((i + 1))
	done
	x=0
	while [ "$x" -lt "$NX" ]; do
		classify "${X_RAW[x]}"
		hit=0
		i=0
		while [ "$i" -lt "$N" ]; do
			if [ "${E_KEY[i]}" = "$KEY" ]; then
				E_EXC[i]=1
				hit=1
			fi
			i=$((i + 1))
		done
		[ "$hit" -eq 1 ] || usage "--except ${X_RAW[x]} names no entry of this batch"
		x=$((x + 1))
	done
	setup

	# The target the request named: here, once, before anything else is read.
	if [ "$HAS_TARGET" -eq 1 ]; then
		prb pin-base --target "$TARGET"
		[ "$PRB_RC" -eq 0 ] || stop unresolved "the batch's rebase target does not resolve, so no entry is planned. Nothing was fetched for it and nothing stands in for it." "target=$TARGET"
		named="$(field base "$PRB_OUT")"
		[ -n "$named" ] || fail "pr-branch.sh pin-base answered without a commit for '$TARGET'. Nothing is planned."
	fi

	# Each entry's PR, then its head.
	i=0
	while [ "$i" -lt "$N" ]; do
		E_PR[i]=- E_SKIP[i]=- E_DATA[i]=0 E_PARENT[i]=-1 E_SAME[i]=- E_DEPTH[i]=0
		E_HEADREF[i]=- E_HEAD[i]=- E_REPORTED[i]=- E_REL[i]=- E_BASEREF[i]=- E_BOID[i]=-
		E_REBASE[i]=- E_TARGET[i]=- E_PIN[i]=-
		case "${E_KEY[i]}" in
		pr:*)
			E_KIND[i]="pr"
			name="${E_KEY[i]#pr:}"
			out="$(gh pr view "$name" --repo "$REPO" --json "$FIELDS" --jq "$JQ")" ||
				fail "could not read PR #$name in $REPO (gh failed). Nothing is planned."
			take "$out" "PR #$name"
			[ "$R_NUM" = "$name" ] || fail "asked for PR #$name in $REPO and was answered with #$R_NUM. Nothing is planned."
			;;
		*)
			E_KIND[i]=branch
			name="${E_KEY[i]#branch:}"
			if ! git show-ref --verify --quiet "refs/heads/$name"; then
				E_SKIP[i]=not-local
				note "entry '${E_RAW[i]}' skipped: '$name' is not a local branch of this checkout. A branch entry works your local ref; name the PR by number to work its head instead."
				i=$((i + 1))
				continue
			fi
			out="$(gh pr list --head "$name" --state open --repo "$REPO" --json "$FIELDS" --jq ".[] | $JQ")" ||
				fail "could not list the open PRs from '$name' in $REPO (gh failed). Nothing is planned."
			count="$(printf '%s\n' "$out" | awk 'length { n++ } END { print n + 0 }')"
			if [ "$count" -eq 0 ]; then
				E_SKIP[i]=no-pr
				note "entry '${E_RAW[i]}' skipped: no open PR in $REPO has '$name' as its head, so there are no review threads to address."
				i=$((i + 1))
				continue
			fi
			if [ "$count" -gt 1 ]; then
				E_SKIP[i]=ambiguous
				note "entry '${E_RAW[i]}' skipped: $count open PRs in $REPO have '$name' as their head. Name the one meant by its number."
				i=$((i + 1))
				continue
			fi
			take "$out" "the PR from '$name'"
			[ "$R_HEAD" = "$name" ] || fail "asked $REPO for the PRs from '$name' and was answered with one from '$R_HEAD'. Nothing is planned."
			;;
		esac
		canon "$R_URL" "PR #$R_NUM"
		E_PR[i]="$R_NUM"
		# The same PR twice is planned once, and is excepted if either is.
		j=0
		while [ "$j" -lt "$i" ]; do
			if [ "${E_DATA[j]}" -eq 1 ] && [ "${E_PR[j]}" = "$R_NUM" ]; then
				E_SKIP[i]="alias"
				[ "${E_EXC[i]}" -eq 0 ] || E_EXC[j]=1
				note "entry '${E_RAW[i]}' skipped: it is PR #$R_NUM, which entry '${E_RAW[j]}' already is."
				break
			fi
			j=$((j + 1))
		done
		if [ "${E_SKIP[i]}" = alias ]; then
			i=$((i + 1))
			continue
		fi
		E_DATA[i]=1
		E_HEADREF[i]="$R_HEAD"
		E_REPORTED[i]="$R_OID"
		E_BASEREF[i]="$R_BASE"
		E_BOID[i]="${R_BOID:--}"
		prb head --repo "$CANON" --pr "$R_NUM" --expect "$R_OID"
		if [ "$PRB_RC" -eq 0 ]; then
			E_HEAD[i]="$(field head "$PRB_OUT")"
			E_REL[i]="$(field relation "$PRB_OUT")"
			[ -n "${E_HEAD[i]}" ] && [ -n "${E_REL[i]}" ] || fail "pr-branch.sh head answered without a head or a relation for PR #$R_NUM. Nothing is planned."
		else
			E_SKIP[i]="$(field outcome "$PRB_OUT")"
			[ -n "${E_SKIP[i]}" ] || fail "pr-branch.sh head stopped on PR #$R_NUM without saying why. Nothing is planned."
			note "entry '${E_RAW[i]}' skipped: PR #$R_NUM is ${E_SKIP[i]}, as explained above."
		fi
		i=$((i + 1))
	done

	# The parent map: an entry whose base branch is another entry's head branch.
	i=0
	while [ "$i" -lt "$N" ]; do
		if [ "${E_DATA[i]}" -eq 1 ]; then
			j=0
			while [ "$j" -lt "$N" ]; do
				# A fork's head branch is another repository's: its name
				# meeting a base or a head here is a coincidence.
				if [ "$j" -ne "$i" ] && [ "${E_DATA[j]}" -eq 1 ] && [ "${E_SKIP[j]}" != fork ]; then
					[ "${E_PARENT[i]}" -ne -1 ] || [ "${E_HEADREF[j]}" != "${E_BASEREF[i]}" ] || E_PARENT[i]="$j"
					[ "$j" -ge "$i" ] || [ "${E_SAME[i]}" != - ] || [ "${E_HEADREF[j]}" != "${E_HEADREF[i]}" ] || E_SAME[i]="${E_PR[j]}"
				fi
				j=$((j + 1))
			done
		fi
		i=$((i + 1))
	done
	# Depth below a root gives the parent-first order; a ring has no root.
	max=0
	i=0
	while [ "$i" -lt "$N" ]; do
		d=0 steps=0
		p="${E_PARENT[i]}"
		while [ "$p" -ne -1 ]; do
			d=$((d + 1))
			steps=$((steps + 1))
			[ "$steps" -le "$N" ] || stop cycle "PR #${E_PR[i]} is based on a chain of the listed PRs that leads back into itself, so there is no parent-first order. Nothing is planned." "pr=${E_PR[i]}"
			p="${E_PARENT[p]}"
		done
		E_DEPTH[i]="$d"
		[ "$d" -le "$max" ] || max="$d"
		i=$((i + 1))
	done

	# Rebase or not, and what each entry is pinned to.
	i=0
	while [ "$i" -lt "$N" ]; do
		if [ "${E_SKIP[i]}" = - ]; then
			if [ "$NO_REBASE" -eq 1 ] || [ "${E_EXC[i]}" -eq 1 ]; then
				E_REBASE[i]=no
				if [ "$NO_REBASE" -eq 1 ] && [ "$HAS_TARGET" -eq 1 ]; then E_TARGET[i]=named; else E_TARGET[i]=default; fi
			else
				E_REBASE[i]=yes
				if [ "${E_PARENT[i]}" -ne -1 ]; then
					E_TARGET[i]=parent
				elif [ "$HAS_TARGET" -eq 1 ]; then
					E_TARGET[i]=named
				else
					E_TARGET[i]=default
				fi
			fi
			case "${E_TARGET[i]}" in
			named) E_PIN[i]="$named" ;;
			default)
				pin_default "${E_BASEREF[i]}"
				if [ -n "$PIN" ]; then
					E_PIN[i]="$PIN"
				else
					E_SKIP[i]="$PIN_SKIP" E_REBASE[i]=- E_TARGET[i]=-
					note "entry '${E_RAW[i]}' skipped: its base branch '${E_BASEREF[i]}' is $PIN_SKIP, as explained above. A remote-tracking ref is not a fallback."
				fi
				;;
			esac
		fi
		i=$((i + 1))
	done

	i=0
	while [ "$i" -lt "$N" ]; do
		if [ "${E_SKIP[i]}" != - ]; then
			skipped=$((skipped + 1))
		elif [ "${E_PARENT[i]}" -ne -1 ]; then
			stacked=yes
		fi
		i=$((i + 1))
	done
	say "outcome=planned"
	say "repo=${CANON:--}"
	[ "$HAS_TARGET" -eq 0 ] || say "named=$named"
	say "stacked=$stacked"
	say "skipped=$skipped"
	order=0 d=0
	while [ "$d" -le "$max" ]; do
		i=0
		while [ "$i" -lt "$N" ]; do
			if [ "${E_DEPTH[i]}" -eq "$d" ]; then
				order=$((order + 1))
				p=-
				[ "${E_PARENT[i]}" -eq -1 ] || p="${E_PR[${E_PARENT[i]}]}"
				say "entry=${E_RAW[i]}${TAB}kind=${E_KIND[i]}${TAB}pr=${E_PR[i]}${TAB}skip=${E_SKIP[i]}${TAB}order=$order${TAB}parent=$p${TAB}same-head=${E_SAME[i]}${TAB}head-ref=${E_HEADREF[i]}${TAB}head=${E_HEAD[i]}${TAB}reported=${E_REPORTED[i]}${TAB}relation=${E_REL[i]}${TAB}base-ref=${E_BASEREF[i]}${TAB}base-oid=${E_BOID[i]}${TAB}rebase=${E_REBASE[i]}${TAB}target=${E_TARGET[i]}${TAB}pin=${E_PIN[i]}"
			fi
			i=$((i + 1))
		done
		d=$((d + 1))
	done
}

cmd_repin() {
	parse "$@"
	[ "$N" -eq 0 ] || usage "unexpected argument: ${E_RAW[0]}"
	[ "$HAS_TARGET" -eq 0 ] && [ "$NO_REBASE" -eq 0 ] && [ "$NX" -eq 0 ] || usage "repin takes --repo and --pr only: a named target is never pinned again"
	case "$PR" in
	'' | *[!0-9]*) usage "--pr <N> is required" ;;
	esac
	setup
	local out
	out="$(gh pr view "$PR" --repo "$REPO" --json "$FIELDS" --jq "$JQ")" ||
		fail "could not read PR #$PR in $REPO (gh failed). Nothing is pinned."
	take "$out" "PR #$PR"
	[ "$R_NUM" = "$PR" ] || fail "asked for PR #$PR in $REPO and was answered with #$R_NUM. Nothing is pinned."
	canon "$R_URL" "PR #$PR"
	[ "$R_STATE" = OPEN ] || stop closed "PR #$PR is $R_STATE, not open, so there is nothing to rebase it onto." "pr=$PR" "state=$R_STATE"
	prb pin-base --repo "$CANON" --base "$R_BASE"
	if [ "$PRB_RC" -ne 0 ]; then
		out="$(field outcome "$PRB_OUT")"
		[ -n "$out" ] || fail "pr-branch.sh pin-base stopped without saying why. Nothing is pinned."
		stop "$out" "PR #$PR's base branch '$R_BASE' could not be pinned, as explained above. A remote-tracking ref is not a fallback." "pr=$PR" "base-ref=$R_BASE"
	fi
	out="$(field base "$PRB_OUT")"
	[ -n "$out" ] || fail "pr-branch.sh pin-base answered without a commit for $R_BASE. Nothing is pinned."
	say "outcome=pinned"
	say "pr=$PR"
	say "repo=$CANON"
	say "base-ref=$R_BASE"
	say "pin=$out"
}

if [ "${1:-}" = -C ]; then
	[ $# -ge 2 ] || usage "-C needs a directory"
	cd -- "$2" 2>/dev/null || fail "cannot enter $2"
	shift 2
fi
[ $# -ge 1 ] || usage "a command is required"
command="$1"
shift
case "$command" in
plan) cmd_plan "$@" ;;
repin) cmd_repin "$@" ;;
-h | --help | help)
	awk 'NR > 1 && !/^#/ { exit } NR > 1 { sub(/^# ?/, ""); print }' "$SELF"
	;;
*) usage "unknown command: $command" ;;
esac
