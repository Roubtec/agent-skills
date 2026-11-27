#!/usr/bin/env bash
# reviews.sh — a pull request's submitted reviews, listed for the gather.
#
# Usage:
#   reviews.sh --repo <owner>/<repo> --pr <N> [--head <commit>]
#
# `<owner>/<repo>` is the repository the PR is in, read from the PR's own URL;
# write it `<host>/<owner>/<repo>` where that is not github.com.
#
# A review thread is one kind of review input and gh-review-threads.sh, beside
# this file, lists those. This lists the rest of what a review object holds,
# so that recognising input that is not a thread is not left to a reading of
# raw API output: who wrote each review, against which commit, how many inline
# comments it authored, and the comments its body says it suppressed.
#
#   outcome=listed | none
#   head=<oid>           with --head: the commit the answers below compare to
#   review=<JSON>        one line per submitted review, oldest first:
#     id, url            the review's id and permalink (`html_url`)
#     author, bot        `user.login`, and whether `user.type` is `Bot`
#     state              APPROVED, CHANGES_REQUESTED, COMMENTED or DISMISSED
#     commit             the commit it was written against (`commit_id`)
#     submitted          `submitted_at`
#     inline             how many inline comments this review authored
#     cited              [{url, author}]: the pull request's top-level
#                        comments whose text holds this review's permalink,
#                        which is how a Summary comment or a maintainer's
#                        reply names the review it answers
#     body               its body, verbatim (empty where it has none)
#     suppressed         null where the body shows no suppressed-comment
#                        block, else:
#       declared         the count the block's heading states, or null
#       parsed           true only where every entry was read and their
#                        number is the declared one
#       entries          [{file, line, text}] in the body's order; EMPTY
#                        where parsed is false, whatever was read
#     current            with --head: whether `commit` is that commit
#   and with --head each entry carries `changed`: `same` where the entry's
#   file is identical in the review's commit and in --head, `changed` where
#   it differs or is gone, `unknown` where this repository does not hold the
#   review's commit, so nothing here says either.
#
# A body that states findings beside `inline: 0` is not classified here:
# whether prose claims a finding is a reading, and misfired-findings.md,
# beside this file, says what such a review means.
#
# The suppressed-comment block. Written against the reviews of
# `copilot-pull-request-reviewer[bot]` as they stood in August 2026, which
# open the block one of two ways:
#     <details>                          ### Suppressed comments (2)
#     <summary>Suppressed comments (2)</summary>
# (an earlier wording, `Comments suppressed due to low confidence (2)`, is
# read too) and give each entry as
#     **path/to/file.ext:39**
#     * the comment's text
#     ```
#     an excerpt of the code it points at
#     ```
# The block ends at `</details>`, a heading, a rule, or the `- **Files
# reviewed:** …` list that follows it in the heading form. Nothing else is
# parsed out of a body. A line outside a code fence that mentions both
# "suppress" and "comment" marks a block as present even where the heading or
# the entries are not in that shape, so a reviewer that changes its markup
# reads as `parsed: false` with the review's `url` to open, never as no block.
#
# Scope. Every review and comment this reads must carry an `html_url` inside
# the requested repository and pull request; a paginated read run beside
# other `gh` calls has returned another pull request's objects. It pages by
# hand, one fresh `gh api` call per page, never `--paginate`. A response that
# fails the check is discarded and the whole read is made once more; failing
# again it stops with `outcome=foreign` (an object of another pull request)
# or `outcome=malformed` (not the shape the API documents) and lists nothing.
#
# --head compares with a local `git diff` in the current directory and
# fetches nothing: fetch the review's commit and ask again where the answer is
# `unknown` and it matters.
#
# Output: `key=value` lines on stdout, `outcome=` first. Exit status: 0 done,
# 3 on a stop, 1 on a failure (network, gh, git), 64 on a usage error. Needs
# gh and jq, and git with --head. Written for bash 3.2 and later.
set -u -o pipefail

TAB="$(printf '\t')"
case "$0" in
/*) SELF="$0" ;;
*) SELF="$PWD/$0" ;;
esac

say() { printf '%s\n' "$*"; }
note() { printf 'reviews: %s\n' "$*" >&2; }
fail() {
	note "$*"
	exit 1
}
usage() {
	note "$*"
	sed -n '4,5p' "$SELF" | sed 's/^# \{0,1\}//' >&2
	exit 64
}
stop() { # <outcome> <explanation>
	say "outcome=$1"
	note "$2"
	exit 3
}

REPO="" PR="" HEAD_ARG=""
while [ $# -gt 0 ]; do
	case "$1" in
	-h | --help | help)
		awk 'NR > 1 && !/^#/ { exit } NR > 1 { sub(/^# ?/, ""); print }' "$SELF"
		exit 0
		;;
	esac
	[ $# -ge 2 ] || usage "$1 needs a value"
	case "$1" in
	--repo) REPO="$2" ;;
	--pr) PR="$2" ;;
	--head) HEAD_ARG="$2" ;;
	*) usage "unknown argument: $1" ;;
	esac
	shift 2
done
case "$REPO" in
*/*/*/* | /* | */ | *//*) usage "--repo takes <owner>/<repo> or <host>/<owner>/<repo>" ;;
?*/?*) ;;
*) usage "--repo <owner>/<repo> is required (the repository the PR is in)" ;;
esac
case "$PR" in
'' | 0* | *[!0-9]*) usage "--pr <N> is required" ;;
esac

SLUG="$(printf '%s' "$REPO" | awk -F/ '{ print $(NF-1) "/" $NF }')"
HOST="$(printf '%s' "$REPO" | awk -F/ 'NF > 2 { print $1 }')"
# Owner and repository are case-insensitive on GitHub while a url carries the
# canonical casing, so the scope test compares lowercased.
WANT="$(printf 'https://%s/%s/pull/%s' "${HOST:-github.com}" "$SLUG" "$PR" | tr '[:upper:]' '[:lower:]')"

HEAD=""
if [ -n "$HEAD_ARG" ]; then
	HEAD="$(git rev-parse --verify --quiet "$HEAD_ARG^{commit}")" ||
		fail "--head $HEAD_ARG names no commit in the repository of the current directory."
fi

readonly MALFORMED=2

# Every page of one REST listing, merged. One fresh call per page.
listing() { # <endpoint>
	local page=1 out n all='[]'
	while :; do
		out="$(gh api ${HOST:+--hostname} ${HOST:+"$HOST"} "repos/$SLUG/$1?per_page=100&page=$page")" || return 1
		n="$(printf '%s\n' "$out" | jq 'if type == "array" then length else error("not an array") end' 2>/dev/null)" || return "$MALFORMED"
		# Merged through stdin: an accumulated listing can pass the size one
		# argument may have.
		all="$(printf '%s\n%s\n' "$all" "$out" | jq -cs '.[0] + .[1]')" || return "$MALFORMED"
		[ "$n" -ge 100 ] || break
		page=$((page + 1))
		[ "$page" -le 50 ] || return "$MALFORMED"
	done
	printf '%s\n' "$all"
}

# The urls in a listing that are not this pull request's. An object without a
# url cannot be placed, so it is one of them.
outside() {
	jq -r --arg want "$WANT" '
		.[]
		| if (type == "object") and ((.html_url | type) == "string") then .html_url else "(an object with no html_url)" end
		| select((ascii_downcase | (. == $want or startswith($want + "#") or startswith($want + "/") or startswith($want + "?"))) | not)'
}

REVIEWS="" COMMENTS="" TOPLEVEL="" WHY="" OFFENDERS=""
attempt() {
	local status
	WHY="" OFFENDERS=""
	REVIEWS="$(listing "pulls/$PR/reviews")" || {
		status=$?
		[ "$status" = "$MALFORMED" ] || fail "could not read the reviews of PR #$PR in $REPO (gh failed). Nothing here says there are none."
		WHY=malformed
		return 1
	}
	COMMENTS="$(listing "pulls/$PR/comments")" || {
		status=$?
		[ "$status" = "$MALFORMED" ] || fail "could not read the inline comments of PR #$PR in $REPO (gh failed), so no review's count is known."
		WHY=malformed
		return 1
	}
	TOPLEVEL="$(listing "issues/$PR/comments")" || {
		status=$?
		[ "$status" = "$MALFORMED" ] || fail "could not read the top-level comments of PR #$PR in $REPO (gh failed), so nothing says which reviews one of them answers."
		WHY=malformed
		return 1
	}
	OFFENDERS="$(printf '%s\n%s\n%s\n' "$REVIEWS" "$COMMENTS" "$TOPLEVEL" | jq -cs 'add' | outside)" || {
		WHY=malformed
		return 1
	}
	if [ -n "$OFFENDERS" ]; then
		WHY=foreign
		return 1
	fi
}

if ! attempt && ! attempt; then
	if [ "$WHY" = foreign ]; then
		printf 'reviews:   %s\n' "$OFFENDERS" | head -n 5 >&2
		stop foreign "the listing for PR #$PR in $REPO holds objects of another pull request, twice running. Nothing is listed; a read run beside other gh calls likely crossed responses."
	fi
	stop malformed "the listing for PR #$PR in $REPO was not the shape the API documents, twice running. Nothing is listed."
fi

# shellcheck disable=SC2016 # the $names are jq's
LISTED="$(printf '%s\n%s\n%s\n' "$REVIEWS" "$COMMENTS" "$TOPLEVEL" | jq -cs '
	def flush: if .cur then .entries += [.cur | .text |= (sub("^\\s+"; "") | sub("\\s+$"; ""))] | .cur = null else . end;
	def suppressed:
		reduce (gsub("\r"; "") | split("\n")[]) as $l (
			{ fence: false, mode: "before", present: false, declared: null, entries: [], cur: null };
			if ($l | test("^\\s*(```|~~~)")) then
				.fence |= not | if .cur then .cur.text += $l + "\n" else . end
			elif .fence then
				if .cur then .cur.text += $l + "\n" else . end
			elif .mode == "before" then
				( $l | [capture("^\\s*(<summary>|#{1,6}\\s+)\\s*(Suppressed comments|Comments suppressed[^()<]*?)\\s*\\((?<n>[0-9]+)\\)\\s*(</summary>)?\\s*$"; "i")][0] ) as $h
				| if $h then .mode = "in" | .present = true | .declared = ($h.n | tonumber)
				  elif ($l | (test("suppress"; "i") and test("comment"; "i"))) then .present = true
				  else . end
			elif .mode == "in" then
				( $l | [capture("^\\*\\*(?<file>[^\\t\\\\]+):(?<line>[0-9]+)\\*\\*\\s*$")][0] ) as $e
				| if $e then flush | .cur = { file: $e.file, line: ($e.line | tonumber), text: "" }
				  elif ($l | test("^\\s*</details>|^#{1,6}\\s|^-{3,}\\s*$|^- \\*\\*[^*]+:\\*\\*")) then flush | .mode = "done"
				  elif .cur then .cur.text += $l + "\n"
				  else . end
			else . end )
		| flush
		| if .present | not then null
		  else (.declared != null and (.entries | length) == .declared) as $parsed
			| { declared, parsed: $parsed, entries: (if $parsed then .entries else [] end) }
		  end;
	.[1] as $comments
	| .[2] as $toplevel
	| .[0][]
	| select(.state != "PENDING")
	| .id as $id
	| { id, url: .html_url, author: (.user.login // ""), bot: (.user.type == "Bot"), state,
		commit: (.commit_id // ""), submitted: (.submitted_at // ""),
		inline: ([$comments[] | select(.pull_request_review_id == $id)] | length),
		cited: [$toplevel[] | select((.body // "") | test("#pullrequestreview-\($id)([^0-9]|$)")) | { url: .html_url, author: (.user.login // "") }],
		body: (.body // ""), suppressed: ((.body // "") | suppressed) }
')" || fail "could not read the listing of PR #$PR in $REPO back (jq failed)."

if [ -n "$HEAD" ]; then
	# One answer per (review commit, file): `same`, `changed` or `unknown`.
	verdicts=""
	pairs="$(printf '%s\n' "$LISTED" | jq -r 'select(.suppressed) | .commit as $c | .suppressed.entries[] | $c + "\t" + .file' | sort -u)" ||
		fail "could not read the suppressed entries back (jq failed)."
	while IFS="$TAB" read -r commit file; do
		[ -n "$file" ] || continue
		if [ "$commit" = "$HEAD" ]; then
			verdict=same
		elif ! git cat-file -e "$commit^{commit}" 2>/dev/null; then
			verdict=unknown
			note "commit $commit, which a review was written against, is not in this repository: its entries are \`unknown\`."
		elif ! git cat-file -e "$HEAD:$file" 2>/dev/null; then
			verdict=changed
		else
			git --literal-pathspecs diff --quiet "$commit" "$HEAD" -- "$file" 2>/dev/null
			case $? in
			0) verdict=same ;;
			1) verdict=changed ;;
			*) verdict=unknown ;;
			esac
		fi
		verdicts="$verdicts$commit$TAB$file$TAB$verdict
"
	done <<EOF
$pairs
EOF
	# shellcheck disable=SC2016 # the $names are jq's
	LISTED="$(printf '%s\n' "$LISTED" | jq -c --arg head "$HEAD" --arg verdicts "$verdicts" '
		( $verdicts | split("\n") | map(select(length > 0) | split("\t") | { key: (.[0] + "\t" + .[1]), value: .[2] }) | from_entries ) as $v
		| .commit as $c
		| .current = ($c == $head)
		| if .suppressed then .suppressed.entries |= map(.changed = ($v[$c + "\t" + .file] // "unknown")) else . end
	')" || fail "could not add the comparison with $HEAD to the listing (jq failed)."
fi

if [ -n "$LISTED" ]; then say "outcome=listed"; else say "outcome=none"; fi
[ -z "$HEAD" ] || say "head=$HEAD"
printf '%s\n' "$LISTED" | awk 'NF { print "review=" $0 }'
