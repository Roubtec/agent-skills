#!/usr/bin/env bash
# task-citations.sh — which of the paths and identifiers a task file cites in
# backticks resolve nowhere in the tree of a commit.
#
# Usage, from the checkout, or with `-C <dir>` ahead of everything else, as
# git takes it:
#   task-citations.sh [--ref <commit>] [--folder <dir>] <task file>...
#
# A task file is read from disk as it stands, at the path given. What it cites
# is looked up in the tree of `--ref` (HEAD where none is given) and never in
# the working tree, so the answer is about the commit an implementer starts
# from. `--folder` is the repository's task folder from the top of the tree
# (`tasks`, no trailing slash).
#
# What is read as a citation. Only a code span between two single backticks
# on one line, outside a fenced block. A span is dropped whole, and so never
# reported, unless every character of it is a letter, a digit or one of
# `_ . / -`, bar a `::` inside it and one `()` at its end: that leaves out
# command lines, `key=value` examples, placeholders in angle brackets, globs
# and anything quoted. A span that starts with a dash is a flag and is dropped
# too. A leading `./` and a trailing `/` are not part of the name. Of what
# remains:
#   path        a span with a slash in it, or one that ends in an extension
#               (a dot and at most eight lowercase letters and digits, a
#               letter among them, behind a stem: `task-numbers.sh`,
#               `tests.yml`, not `3.2` and not `.md`). An absolute path, one
#               with a `..` step, and one with no letter in it are dropped.
#               A span with a slash and no extension is checked only where
#               its first step is a directory somewhere in the tree: otherwise
#               it is more often a branch, a ref or an `owner/repo` than a
#               path.
#               It resolves where its steps stand, in order and adjacent, in
#               some path of the tree: `SKILL.md`, `write-tasks/SKILL.md` and
#               `done/` each resolve by one file that has them.
#   identifier  any other span whose last segment (after a `.` or `::`) is a
#               name (`[A-Za-z_][A-Za-z0-9_]*`) that does not read as a plain
#               word: it holds an underscore, or a capital behind a lowercase
#               letter or a digit, or the span ends in `()`. `claims`, `HEAD`
#               and `main` are words and are dropped.
#               It resolves where that segment stands as a whole word in some
#               text file of the tree outside the task folder.
# Everything else (a bare word, a kebab-case name, a number) is no citation.
#
#   unresolved=<path|identifier> TAB <task file> TAB <the span>
#               once per task file and span, in the order the files were named
# under
#   outcome=clean       every citation resolved (exit 0)
#   outcome=unresolved  at least one did not (exit 3)
# and always ref= (the commit read) and checked= (how many citations were
# looked up, counted once per task file).
#
# This reports and decides nothing. A task routinely names a file it asks for,
# and the rules above cannot tell an example value written like a path from a
# path: the reader of the list says which line is a defect of the task.
#
# Output: `key=value` lines on stdout, `outcome=` first; an explanation goes to
# stderr. Exit status: 0 on clean; 3 on unresolved; 1 on a failure (the ref
# names no commit, a task file could not be read, the tree could not be
# searched); 64 on a usage error. Needs git. Written for bash 3.2 and later.
set -u
# Paths as they are, not C-quoted: they are compared as names.
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.quotePath GIT_CONFIG_VALUE_0=false

TAB="$(printf '\t')"
case "$0" in
/*) SELF="$0" ;;
*) SELF="$PWD/$0" ;;
esac

say() { printf '%s\n' "$*"; }
note() { printf 'task-citations: %s\n' "$*" >&2; }
fail() {
	note "$*"
	exit 1
}
usage() {
	note "$*"
	sed -n '5,7p' "$SELF" | sed 's/^# \{0,1\}//' >&2
	exit 64
}

if [ "${1:-}" = -C ]; then
	[ $# -ge 2 ] || usage "-C needs a directory"
	# Behind ./ a relative name is a directory and nothing else: not an
	# option, not `-` for the previous directory, not a CDPATH lookup.
	case "$2" in
	/*) cd "$2" 2>/dev/null || fail "could not enter $2." ;;
	*) cd "./$2" 2>/dev/null || fail "could not enter $2." ;;
	esac
	shift 2
fi

REF="HEAD" FOLDER="tasks"
FILES=()
while [ $# -gt 0 ]; do
	case "$1" in
	-h | --help | help)
		awk 'NR > 1 && !/^#/ { exit } NR > 1 { sub(/^# ?/, ""); print }' "$SELF"
		exit 0
		;;
	--ref | --folder)
		[ $# -ge 2 ] || usage "$1 needs a value"
		case "$1" in
		--ref) REF="$2" ;;
		--folder) FOLDER="$2" ;;
		esac
		shift 2
		;;
	--)
		shift
		while [ $# -gt 0 ]; do
			FILES[${#FILES[@]}]="$1"
			shift
		done
		;;
	-*) usage "unknown argument: $1" ;;
	*)
		FILES[${#FILES[@]}]="$1"
		shift
		;;
	esac
done
[ ${#FILES[@]} -gt 0 ] || usage "name at least one task file"
[ -n "$FOLDER" ] || usage "--folder cannot be empty"
case "$FOLDER" in
-* | /*) usage "--folder takes a path from the top of the tree: write ./$FOLDER for a folder that starts with a dash" ;;
esac
FOLDER="${FOLDER#./}"

git rev-parse --git-dir >/dev/null 2>&1 || fail "this is not a git repository."
oid="$(git rev-parse --verify --quiet "$REF^{commit}")" || fail "the ref '$REF' names no commit here. Nothing was checked."
tmp="$(mktemp -d "${TMPDIR:-/tmp}/task-citations.XXXXXX")" || fail "could not create a temporary directory."
# shellcheck disable=SC2064 # expand now: the directory this run made
trap "rm -rf '$tmp'" EXIT

# `<path|dir|identifier> TAB <file> TAB <span> TAB <what is looked up>` for
# every citation, once per file. `dir` is a path with no extension, checked
# only where its first step is a directory of the tree.
: >"$tmp/cited"
for f in "${FILES[@]}"; do
	{ [ -f "$f" ] && [ -r "$f" ]; } || fail "the task file '$f' could not be read. Nothing was checked."
	case "$f" in
	*"$TAB"*) fail "the task file '$f' has a tab in its name, which this output cannot carry." ;;
	esac
	# shellcheck disable=SC2016 # the $names are awk's
	awk -v file="$f" -v t="$TAB" '
		function extension(name,    e) {
			if (name !~ /[^.]\.[a-z0-9]+$/) return 0
			e = name; sub(/.*\./, "", e)
			return (length(e) <= 8 && e ~ /[a-z]/)
		}
		/^[ \t]*(```|~~~)/ { fenced = !fenced; next }
		fenced { next }
		{
			n = split($0, part, "`")
			# Even parts stand between two backticks; the last part never does.
			for (i = 2; i < n; i += 2) {
				span = part[i]
				if (span == "" || (span in seen)) continue
				seen[span] = 1
				s = span
				called = sub(/\(\)$/, "", s)
				bare = s; gsub(/::/, "", bare)
				if (bare == "" || bare ~ "[^A-Za-z0-9_./-]" || s ~ /^-/) continue
				if (s !~ /::/ && !called) {
					p = s
					if (substr(p, 1, 2) == "./") p = substr(p, 3)
					if (substr(p, length(p)) == "/") p = substr(p, 1, length(p) - 1)
					last = p; sub("^.*/", "", last)
					if (index(s, "/") || extension(last)) {
						if (p == "" || substr(p, 1, 1) == "/" || index(p, "//") || p !~ /[A-Za-z]/ || index("/" p "/", "/../")) continue
						print (extension(last) ? "path" : "dir") t file t span t p
						continue
					}
				}
				id = s; sub(/.*::/, "", id); sub(/.*\./, "", id)
				if (id !~ /^[A-Za-z_][A-Za-z0-9_]*$/) continue
				if (called || id ~ /_/ || id ~ /[a-z0-9][A-Z]/) print "identifier" t file t span t id
			}
		}' "$f" >>"$tmp/cited" || fail "the task file '$f' could not be read. Nothing was checked."
done

git ls-tree -r --name-only --full-tree "$oid" >"$tmp/tree" || fail "could not list the tree of '$REF'. Nothing was checked."

# Which looked-up paths some path of the tree holds, and which first steps
# are directories there.
# shellcheck disable=SC2016 # the $names are awk's
awk -F "$TAB" '
	FILENAME == ARGV[1] {
		if ($1 == "identifier" || ($4 in want)) next
		want[$4] = 1
		order[++count] = $4
		first = $4; sub("/.*$", "", first)
		if ($1 == "dir") steps[first] = 1
		next
	}
	{
		line = "/" $0 "/"
		for (i = 1; i <= count; i++) {
			p = order[i]
			if (!(p in found) && index(line, "/" p "/")) found[p] = 1
		}
		# The first place a step stands is the file itself only at the end.
		for (s in steps) {
			at = index(line, "/" s "/")
			if (at && at + length(s) + 1 < length(line)) isdir[s] = 1
		}
	}
	END {
		for (p in found) print "found\t" p
		for (s in isdir) print "isdir\t" s
	}' "$tmp/cited" "$tmp/tree" >"$tmp/paths" || fail "could not compare the citations with the tree of '$REF'. Nothing was checked."

# Each identifier once, as a whole word outside the task folder.
: >"$tmp/ids"
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" 2>/dev/null || fail "could not enter the top of the working tree."
awk -F "$TAB" '$1 == "identifier" && !($4 in seen) { seen[$4] = 1; print $4 }' "$tmp/cited" >"$tmp/names"
while IFS= read -r id; do
	git --no-pager grep -q -I -F -w -e "$id" "$oid" -- ":(top)" ":(top,exclude,literal)$FOLDER" >/dev/null 2>"$tmp/err"
	case $? in
	0) say "found${TAB}$id" >>"$tmp/ids" ;;
	1) ;;
	*) fail "could not search the tree of '$REF' for '$id' ($(tr '\n' ' ' <"$tmp/err")). Nothing was checked." ;;
	esac
done <"$tmp/names"

# shellcheck disable=SC2016 # the $names are awk's
awk -F "$TAB" -v t="$TAB" '
	FILENAME == ARGV[1] { if ($1 == "found") path[$2] = 1; else isdir[$2] = 1; next }
	FILENAME == ARGV[2] { name[$2] = 1; next }
	{
		kind = $1
		if (kind == "dir") {
			first = $4; sub("/.*$", "", first)
			if (!(first in isdir)) next
			kind = "path"
		}
		checked++
		if (kind == "path" ? !($4 in path) : !($4 in name)) print "unresolved=" kind t $2 t $3
	}
	END { print "checked=" checked + 0 }' "$tmp/paths" "$tmp/ids" "$tmp/cited" >"$tmp/out" || fail "could not put the answer together. Nothing was checked."

unresolved="$(grep -c '^unresolved=' "$tmp/out")"
if [ "$unresolved" -gt 0 ]; then say "outcome=unresolved"; else say "outcome=clean"; fi
say "ref=$oid"
grep '^checked=' "$tmp/out"
grep '^unresolved=' "$tmp/out"
[ "$unresolved" -eq 0 ] || {
	note "$unresolved citation(s) resolve nowhere in '$REF'. That is a list to read, not a verdict: a task names files it asks for."
	exit 3
}
exit 0
