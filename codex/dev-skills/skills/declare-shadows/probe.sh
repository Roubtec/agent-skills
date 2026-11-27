#!/usr/bin/env bash
# probe.sh — the facts the declare-shadows and enable-worktrees skills decide
# on, read from one repository in one call. It only reads: no file is written
# inside or outside the repository (not even a temporary one), nothing is
# mounted, and no git command that takes a lock is run.
#
# Usage, from anywhere inside the repository, or with `-C <dir>` first:
#   probe.sh shadows   [--candidate <path>]... [--limit <n>] [--scan-limit <n>]
#   probe.sh worktrees
#   probe.sh --help
#
# Output: `key=value` lines on stdout, `outcome=` first, fields within a value
# separated by a TAB; an explanation goes to stderr. Exit status: 0 on
# `probed`; 3 on an answer that stops the run (`not-a-repository`, `no-yq`,
# `malformed`, `incomplete`); 1 on a failure (git could not answer); 64 on a
# usage error. Needs git; `yq` once a powbox file exists (the jq-wrapper `yq`
# and mikefarah's v4 both work); `findmnt`, `mountpoint` and powbox's
# `detect-shadows.sh` are used when present, and their absence is reported, not
# an error. Written for bash 3.2 and later.
#
# Both commands print the configuration first:
#   repo=<absolute root>
#   checkout=main|linked        `linked` is a linked git worktree: powbox mounts
#                               on the main checkout, so the mount facts below
#                               describe a tree powbox never shadowed.
#   powbox_yml=absent|present
#   powbox_local_yml=absent|present|unparseable
#   powbox_local_yml_ignored=yes|no|-
#   override=none|active        powbox's own test, both halves: the local file
#                               is a regular file AND `yq -r 'has("shadow")'`
#                               on it prints exactly `true`. A local file that
#                               does not parse, or has no `shadow:` key, is no
#                               override.
#   effective=.powbox.local.yml|.powbox.yml|none
#                               the one list this container mounts from
#   declared=<committed|override> TAB <literal|glob|negation> TAB <entry>
#                               every entry of either list, as written. A glob
#                               holds one of `* ? [ ]` and is existence-gated;
#                               powbox skips an entry starting with `!`.
#   override_drops=<entry>      in `.powbox.yml`, missing from an active override
#   override_only=<entry>       in an active override, missing from `.powbox.yml`
#   tools=yq:<present|absent> TAB findmnt:<..> TAB mountpoint:<..> TAB detect-shadows.sh:<..>
# `outcome=malformed` (with `malformed=<file> TAB <reason>` lines, and nothing
# after the configuration) is a `shadow:` value that is not a list of non-empty
# one-line strings, in `.powbox.yml` or in an active override, or a
# `.powbox.yml` that does not parse or is not a mapping. An empty list is well
# formed. `outcome=no-yq` is a powbox file with no `yq` to read it.
#
# shadows   Then one line per candidate directory, a literal path relative to
#           the root:
#             candidate=<path> TAB from=<..> TAB exists=<dir|absent|file|symlink>
#               TAB ignored=<shared|unshared|no|-> TAB tracked=<yes|no|->
#               TAB guard=<..> TAB mount=<none|fstype|unknown> TAB below=<n|->
#               TAB derived=<yes|no|unknown> TAB rule=<source>:<line>:<pattern>
#           from     comma-joined: `committed`, `override` (a declared literal),
#                    `glob` (a directory a declared glob matches now), `named`
#                    (`--candidate`), `ignored` (an ignored directory on disk).
#                    An on-disk directory that is listed only because all its
#                    content is ignored, with no rule ignoring the directory
#                    itself, is not a candidate; `dropped=<n>` counts those.
#           ignored  whether a rule ignores the path itself (an absent path is
#                    asked with a trailing slash, as a directory; the index is
#                    not consulted, `tracked` says that). `-` where the guard
#                    failed on something git will not look past. `shared` is
#                    a rule from a file that is in the HEAD commit and has no
#                    uncommitted change; `unshared` is any other source (a
#                    global excludes file, the repository's own exclude file,
#                    an ignore file edited since HEAD, every rule in it), which
#                    teammates do not have as it stands.
#           tracked  whether the root index holds anything at or below it.
#           guard    `ok`, or the first ownership check it fails:
#                    `outside-root`, `is-root`, `symlink:<component>`,
#                    `not-a-directory:<component>`, `git-boundary:<component>`
#                    (named `.git`, or holding its own `.git`),
#                    `gitlink:<path>` (at or below a mode-160000 entry),
#                    `nested-git:<path>` (a `.git` somewhere below an existing
#                    leaf), `unscanned` (the walk below it stopped at the scan
#                    limit or could not read a directory), or `preauthorized`
#                    for `.worktrees`, `.claude/worktrees` or `.git/worktrees`
#                    declared as that literal entry (a glob matching one does
#                    not count). The path is resolved lexically; no symlink is
#                    followed.
#           mount    the filesystem mounted exactly there; `below` counts the
#                    mounts under it. `unknown` and `-` where the mount table
#                    could not be read: no `findmnt`, or it failed (stderr
#                    says so). No `mounted=` line is printed then.
#           derived  `yes` when `detect-shadows.sh` emits the path and no entry
#                    of the effective list accounts for it: powbox shadows it
#                    from a manifest already. A declared path never reads `yes`.
#                    `unknown` where `detect-shadows.sh` is absent or failed
#                    (stderr says so); no `derived=` line is printed then.
#           And around them:
#             glob=<committed|override> TAB <matches> TAB <pattern>
#             derived=<path>      every such path, on disk or not
#             mounted=<path> TAB <fstype>   every live mount below the root
#             gitignore=<path>    every `.gitignore` in the tree, to read for
#                                 directory patterns nothing on disk matches yet
#             skipped=<path, shell-quoted> TAB <reason>
#             limit=<n>           with `outcome=incomplete`: more candidates
#                                 than `--limit` (default 200); the declared
#                                 and named ones come first
#           The walk below existing candidates is cut off after
#           `--scan-limit` entries in all (default 100000), or at the first
#           nested `.git`, so a very large ignored tree costs a bounded read
#           and answers `unscanned`.
#
# worktrees Then one line per worktree root:
#             worktree_root=<.worktrees|.claude/worktrees|.git/worktrees>
#               TAB committed=<yes|no> TAB override=<yes|no|-> TAB effective=<yes|no>
#               TAB ignored=<shared|unshared|no|-> TAB tracked=<n|->
#               TAB mountpoint=<yes|no|unknown> TAB fs=<fstype|-> TAB rule=<..>
#           `committed`, `override` and `effective` say whether that list holds
#           the root as a literal entry (a glob is existence-gated and does not
#           count). `fs` is the filesystem holding the path, mountpoint or not.
#           `.git/worktrees` needs no ignore rule and reads `-` for both.
#             mounts=healthy|unhealthy|unknown
#             unhealthy=<root> TAB <reason>
#           `unknown` is no `findmnt` to ask, or a linked checkout.
#           where a reason is `not-a-mountpoint`; `expected-tmpfs`
#           (`.claude/worktrees` on anything else); `not-durable`
#           (`.git/worktrees` on tmpfs while `.worktrees` is not: per-worktree
#           metadata would not survive a recycle); `host-filesystem`
#           (`.worktrees` on 9p, drvfs or virtiofs).
set -u
export GIT_OPTIONAL_LOCKS=0
# Paths as they are, not C-quoted: they are compared and printed as names.
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.quotePath GIT_CONFIG_VALUE_0=false

TAB="$(printf '\t')"
NL='
'
case "$0" in
/*) SELF="$0" ;;
*) SELF="$PWD/$0" ;;
esac
WT_ROOTS=".worktrees${NL}.claude/worktrees${NL}.git/worktrees"

OUT=""
say() { OUT="$OUT$*$NL"; }
note() { printf 'probe: %s\n' "$*" >&2; }
finish() { # outcome, exit status
	printf 'outcome=%s\n%s' "$1" "$OUT"
	exit "$2"
}
fail() {
	note "$*"
	exit 1
}
usage() {
	note "$*"
	sed -n '7,9p' "$SELF" | sed 's/^# \{0,1\}//' >&2
	exit 64
}
have() { command -v "$1" >/dev/null 2>&1; }
presence() { if have "$1"; then printf present; else printf absent; fi; }
count_lines() { # text
	[ -n "$1" ] || {
		printf 0
		return
	}
	printf '%s\n' "$1" | awk 'END { print NR }'
}
has_line() { # text, line
	printf '%s\n' "$1" | LINE="$2" awk '$0 == ENVIRON["LINE"] { found = 1 } END { exit !found }'
}
# Sets ROWS to the non-empty lines of a text. A here-document would do, and
# bash before 5.1 backs every one with a temporary file.
split() {
	local IFS="$NL"
	set -f
	# shellcheck disable=SC2206 # splitting on newlines is the point
	ROWS=($1)
	set +f
}

# Resolves `.`, `..`, empty components and leading or trailing slashes without
# touching the filesystem. Sets NORM; fails where the path climbs out of the root.
norm() {
	local rest="$1" comp
	NORM=""
	while [ -n "$rest" ]; do
		comp="${rest%%/*}"
		case "$rest" in
		*/*) rest="${rest#*/}" ;;
		*) rest="" ;;
		esac
		case "$comp" in
		"" | .) ;;
		..)
			[ -n "$NORM" ] || return 1
			case "$NORM" in
			*/*) NORM="${NORM%/*}" ;;
			*) NORM="" ;;
			esac
			;;
		*) NORM="${NORM:+$NORM/}$comp" ;;
		esac
	done
}
entry_kind() {
	case "$1" in
	'!'*) printf negation ;;
	*[][*?]*) printf glob ;;
	*) printf literal ;;
	esac
}

# ---------------------------------------------------------- configuration --

# The two yq families name a node's type differently, and the older of
# mikefarah's has no `type` at all.
ytype() { # file, expression: prints one of seq str map null other per node
	local raw
	raw="$(yq -r "$2 | type" "$1" 2>/dev/null)" || raw="$(yq -r "$2 | tag" "$1" 2>/dev/null)" || return 1
	[ -n "$raw" ] || raw=null
	printf '%s\n' "$raw" | awk '
		$0 == "array" || $0 == "!!seq" { print "seq"; next }
		$0 == "string" || $0 == "!!str" { print "str"; next }
		$0 == "object" || $0 == "!!map" { print "map"; next }
		$0 == "null" || $0 == "!!null" { print "null"; next }
		{ print "other" }'
}

MALFORMED=0
# Sets ENTRIES to the file's `shadow:` list, one entry per line, or records why
# it is not one. The caller has established that the key is there.
read_shadow() { # file, its name
	local kind kinds n lines
	ENTRIES=""
	kind="$(ytype "$1" .shadow)" || fail "yq could not say what kind of value \`shadow:\` is in $2."
	if [ "$kind" != seq ]; then
		say "malformed=$2${TAB}shadow is not a list"
		MALFORMED=1
		return
	fi
	n="$(yq -r '.shadow | length' "$1" 2>/dev/null)" || fail "yq could not count the \`shadow:\` entries of $2."
	[ "$n" != 0 ] || return 0
	kinds="$(ytype "$1" '.shadow[]')" || fail "yq could not say what kind of entries \`shadow:\` holds in $2."
	if [ -n "$(printf '%s\n' "$kinds" | sed '/^str$/d')" ]; then
		say "malformed=$2${TAB}a shadow entry is not a string"
		MALFORMED=1
		return
	fi
	lines="$(yq -r '.shadow[]' "$1" 2>/dev/null)" || fail "yq could not list the \`shadow:\` entries of $2."
	if [ "$(count_lines "$lines")" != "$n" ] || has_line "$lines" ""; then
		say "malformed=$2${TAB}a shadow entry is empty or spans lines"
		MALFORMED=1
		return
	fi
	ENTRIES="$lines"
}

COMMITTED="" OVERRIDE="" OVERRIDE_ACTIVE=0 EFFECTIVE_FROM=committed
COMMITTED_NORM="" OVERRIDE_NORM="" EFFECTIVE_NORM=""
read_config() {
	local yml="$ROOT/.powbox.yml" lyml="$ROOT/.powbox.local.yml" kind has local_state=absent ignored=- e n
	if { [ -f "$yml" ] || [ -f "$lyml" ]; } && ! have yq; then
		say "powbox_yml=$([ -f "$yml" ] && printf present || printf absent)"
		say "powbox_local_yml=$([ -f "$lyml" ] && printf present || printf absent)"
		note "a powbox file is present and there is no yq to read it."
		finish no-yq 3
	fi

	if [ -f "$yml" ]; then
		say "powbox_yml=present"
		if ! yq -r '.' "$yml" >/dev/null 2>&1; then
			say "malformed=.powbox.yml${TAB}does not parse"
			MALFORMED=1
		else
			kind="$(ytype "$yml" .)" || fail "yq could not say what kind of document .powbox.yml is."
			case "$kind" in
			null) ;;
			map)
				has="$(yq -r 'has("shadow")' "$yml" 2>/dev/null || true)"
				if [ "$has" = true ]; then
					read_shadow "$yml" .powbox.yml
					COMMITTED="$ENTRIES"
				fi
				;;
			*)
				say "malformed=.powbox.yml${TAB}not a mapping"
				MALFORMED=1
				;;
			esac
		fi
	else
		say "powbox_yml=absent"
	fi

	if [ -f "$lyml" ]; then
		local_state=present
		if [ "$(yq -r 'has("shadow")' "$lyml" 2>/dev/null || true)" = true ]; then
			OVERRIDE_ACTIVE=1
			read_shadow "$lyml" .powbox.local.yml
			OVERRIDE="$ENTRIES"
		elif ! yq -r '.' "$lyml" >/dev/null 2>&1; then
			local_state=unparseable
		fi
		git -C "$ROOT" check-ignore -q -- .powbox.local.yml
		case $? in
		0) ignored=yes ;;
		1) ignored=no ;;
		*) fail "git could not say whether .powbox.local.yml is ignored." ;;
		esac
	fi
	say "powbox_local_yml=$local_state"
	say "powbox_local_yml_ignored=$ignored"

	if [ "$OVERRIDE_ACTIVE" = 1 ]; then
		say "override=active"
		say "effective=.powbox.local.yml"
		EFFECTIVE_FROM=override
	else
		say "override=none"
		say "effective=$([ -f "$yml" ] && printf .powbox.yml || printf none)"
	fi

	split "$COMMITTED"
	for e in ${ROWS[@]+"${ROWS[@]}"}; do
		say "declared=committed$TAB$(entry_kind "$e")$TAB$e"
		n="$e"
		[ "$(entry_kind "$e")" != literal ] || ! norm "$e" || n="$NORM"
		COMMITTED_NORM="$COMMITTED_NORM$n$NL"
	done
	split "$OVERRIDE"
	for e in ${ROWS[@]+"${ROWS[@]}"}; do
		say "declared=override$TAB$(entry_kind "$e")$TAB$e"
		n="$e"
		[ "$(entry_kind "$e")" != literal ] || ! norm "$e" || n="$NORM"
		OVERRIDE_NORM="$OVERRIDE_NORM$n$NL"
	done
	if [ "$OVERRIDE_ACTIVE" = 1 ]; then
		EFFECTIVE_NORM="$OVERRIDE_NORM"
		split "$COMMITTED_NORM"
		for e in ${ROWS[@]+"${ROWS[@]}"}; do
			has_line "$OVERRIDE_NORM" "$e" || say "override_drops=$e"
		done
		split "$OVERRIDE_NORM"
		for e in ${ROWS[@]+"${ROWS[@]}"}; do
			has_line "$COMMITTED_NORM" "$e" || say "override_only=$e"
		done
	else
		EFFECTIVE_NORM="$COMMITTED_NORM"
	fi
	say "tools=yq:$(presence yq)${TAB}findmnt:$(presence findmnt)${TAB}mountpoint:$(presence mountpoint)${TAB}detect-shadows.sh:$(presence detect-shadows.sh)"
	[ "$MALFORMED" = 0 ] || finish malformed 3
}

# ------------------------------------------------------------ shared facts --

# Sets IGN (shared|unshared|no) and RULE for a path relative to the root, and
# fails where git could not answer. The index is left out of the question: a
# rule over a directory with tracked files in it is still a rule, and what is
# tracked is reported on its own.
ignore_state() { # path, exists (dir|absent|...)
	local ask="$1" out rc src pattern head
	IGN=no RULE=""
	[ "$2" != absent ] || ask="$1/"
	out="$(git -C "$ROOT" check-ignore --no-index -v -- "$ask" 2>/dev/null)"
	rc=$?
	[ "$rc" = 0 ] || [ "$rc" = 1 ] || return 1
	[ "$rc" = 0 ] || return 0
	RULE="${out%"$TAB"*}"
	src="${RULE%%:*}"
	pattern="${RULE#*:}"
	pattern="${pattern#*:}"
	# `check-ignore -v` answers 0 for a negated rule too: that is the rule that
	# un-ignores the path.
	case "$pattern" in '!'*) return 0 ;; esac
	IGN=unshared
	# The whole source file has to be the committed one, not just the matching
	# line: a rule's effect depends on the lines around it (a negation removed
	# but not committed leaves the same line ignoring more than HEAD does).
	head="$(git -C "$ROOT" rev-parse -q --verify "HEAD:$src" 2>/dev/null)" || return 0
	[ "$(git -C "$ROOT" hash-object -- "$src" 2>/dev/null)" != "$head" ] || IGN=shared
}

MOUNT_TARGETS=""
# 1 while there is a mount table to ask.
MOUNTS_READABLE=0
if have findmnt; then
	MOUNTS_READABLE=1
fi
mount_fs() { # absolute path: the filesystem mounted exactly there, `none`, or `unknown`
	local fs
	[ "$MOUNTS_READABLE" = 1 ] || {
		printf unknown
		return
	}
	fs="$(findmnt -no FSTYPE -M "$1" 2>/dev/null | tail -n 1)"
	printf '%s' "${fs:-none}"
}
mounts_below() { # absolute path: prints the mount targets under it
	[ -n "$MOUNT_TARGETS" ] || return 0
	printf '%s\n' "$MOUNT_TARGETS" | PREFIX="$1/" awk 'index($0, ENVIRON["PREFIX"]) == 1'
}

# ------------------------------------------------------------------ shadows --

SCAN_LEFT=100000
GITLINKS=""
# Sets GUARD for a normalized path relative to the root.
guard() { # path, declared (0|1)
	local rel="$1" rest="$1" prefix="" comp p g scan verdict walked
	if [ "$2" = 1 ] && has_line "$WT_ROOTS" "$rel"; then
		GUARD=preauthorized
		return
	fi
	split "$GITLINKS"
	for g in ${ROWS[@]+"${ROWS[@]}"}; do
		case "$rel" in "$g" | "$g"/*)
			GUARD="gitlink:$g"
			return
			;;
		esac
	done
	while [ -n "$rest" ]; do
		comp="${rest%%/*}"
		case "$rest" in
		*/*) rest="${rest#*/}" ;;
		*) rest="" ;;
		esac
		prefix="${prefix:+$prefix/}$comp"
		p="$ROOT/$prefix"
		if [ "$comp" = .git ]; then
			GUARD="git-boundary:$prefix"
			return
		fi
		if [ -L "$p" ]; then
			GUARD="symlink:$prefix"
			return
		fi
		[ -e "$p" ] || break
		if [ ! -d "$p" ]; then
			GUARD="not-a-directory:$prefix"
			return
		fi
		if [ -e "$p/.git" ] || [ -L "$p/.git" ]; then
			GUARD="git-boundary:$prefix"
			return
		fi
	done
	GUARD=ok
	p="$ROOT/$rel"
	[ -d "$p" ] || return 0
	# awk leaving at its verdict is what ends the walk: find dies on its next
	# write, and the status line of a find stopped that way is never read.
	scan="$({
		find "$p" -print
		printf 'find-status %s\n' "$?"
	} 2>/dev/null | MAX="$SCAN_LEFT" awk '
		BEGIN { max = ENVIRON["MAX"] + 0 }
		/^find-status / { if ($2 != 0) verdict = "unreadable"; next }
		{ n++ }
		/\/\.git$/ { verdict = "git\t" $0; exit }
		n > max { verdict = "limit"; exit }
		END { print n + 0 "\t" (verdict == "" ? "clear" : verdict) }')"
	walked="${scan%%"$TAB"*}"
	verdict="${scan#*"$TAB"}"
	SCAN_LEFT=$((SCAN_LEFT - walked))
	case "$verdict" in
	clear) ;;
	git"$TAB"*)
		verdict="${verdict#*"$TAB"}"
		GUARD="nested-git:${verdict#"$ROOT"/}"
		;;
	*) GUARD=unscanned ;;
	esac
}

CAND_PATHS=()
CAND_FROM=()
LIMIT=200
LIMITED=0
add_candidate() { # normalized path, source
	local i=0
	while [ "$i" -lt "${#CAND_PATHS[@]}" ]; do
		if [ "${CAND_PATHS[$i]}" = "$1" ]; then
			case ",${CAND_FROM[$i]}," in *",$2,"*) ;; *) CAND_FROM[i]="${CAND_FROM[$i]},$2" ;; esac
			return 0
		fi
		i=$((i + 1))
	done
	if [ "${#CAND_PATHS[@]}" -ge "$LIMIT" ]; then
		LIMITED=1
		return 1
	fi
	CAND_PATHS[i]="$1"
	CAND_FROM[i]="$2"
}
printable() {
	case "$1" in *"$TAB"* | *"$NL"*) return 1 ;; esac
}
# A declared or named path: it is reported even where it resolves nowhere.
add_written() { # path as written, source
	if norm "$2" && [ -n "$NORM" ]; then
		add_candidate "$NORM" "$1" || true
	else
		add_candidate "$2" "$1" || true
	fi
}

# Prints, NUL-terminated, the directories a declared glob matches now. Meant
# for a process substitution: the directory and the shell options stay there.
glob_matches() { # pattern
	local pattern="$1" m IFS=
	cd "$ROOT" || exit
	shopt -s nullglob
	shopt -s globstar 2>/dev/null
	while [ "${pattern#/}" != "$pattern" ]; do pattern="${pattern#/}"; done
	# shellcheck disable=SC2086 # the expansion is the point
	for m in $pattern; do
		[ ! -d "$m" ] || printf '%s\0' "$m"
	done
}

cmd_shadows() {
	local named="" e kind matches m i rel from exists tracked below derived fs dropped=0 seen_end=0 derived_all="" derived_known=0 root_real line
	while [ $# -gt 0 ]; do
		case "$1" in
		--candidate | --limit | --scan-limit)
			[ $# -ge 2 ] || usage "$1 needs a value"
			case "$1" in
			--candidate)
				printable "$2" && [ -n "$2" ] || usage "--candidate takes one non-empty path without a tab or newline"
				named="$named$2$NL"
				;;
			--limit | --scan-limit)
				case "$2" in '' | *[!0-9]*) usage "$1 takes a number" ;; esac
				if [ "$1" = --limit ]; then LIMIT="$2"; else SCAN_LEFT="$2"; fi
				;;
			esac
			shift 2
			;;
		*) usage "unknown argument: $1" ;;
		esac
	done
	read_config

	GITLINKS="$(git -C "$ROOT" ls-files --stage)" || fail "git could not list the index."
	GITLINKS="$(printf '%s\n' "$GITLINKS" | awk -F '\t' 'substr($1, 1, 6) == "160000" { print $2 }')"
	if [ "$MOUNTS_READABLE" = 1 ] && ! MOUNT_TARGETS="$(findmnt -lno TARGET 2>/dev/null)"; then
		note "findmnt could not list the mounts; every mount fact reads unknown."
		MOUNTS_READABLE=0 MOUNT_TARGETS=""
	fi

	# detect-shadows.sh emits the effective list's own paths beside the ones it
	# derives from manifests; the declared ones are taken out below.
	if have detect-shadows.sh; then
		root_real="$(cd -P -- "$ROOT" && pwd)"
		if line="$(detect-shadows.sh "$ROOT" 2>/dev/null)"; then
			derived_known=1
			derived_all="$(printf '%s\n' "$line" | PREFIX="$root_real/" awk 'index($0, ENVIRON["PREFIX"]) == 1 { print substr($0, length(ENVIRON["PREFIX"]) + 1) }')"
		else
			note "detect-shadows.sh failed; whether a path is derived reads unknown."
		fi
	fi

	for from in committed override; do
		if [ "$from" = committed ]; then e="$COMMITTED"; else e="$OVERRIDE"; fi
		split "$e"
		for line in ${ROWS[@]+"${ROWS[@]}"}; do
			kind="$(entry_kind "$line")"
			case "$kind" in
			literal) add_written "$from" "$line" ;;
			glob)
				matches=0
				while IFS= read -r -d '' m; do
					matches=$((matches + 1))
					if ! printable "$m"; then
						say "skipped=$(printf '%q' "$m")${TAB}a name with a tab or newline"
					elif norm "$m" && [ -n "$NORM" ]; then
						add_candidate "$NORM" glob || true
						[ "$from" != "$EFFECTIVE_FROM" ] || derived_all="$(printf '%s\n' "$derived_all" | LINE="$NORM" awk '$0 != ENVIRON["LINE"]')"
					else
						add_candidate "$m" glob || true
					fi
				done < <(glob_matches "$line")
				say "glob=$from$TAB$matches$TAB$line"
				;;
			esac
		done
	done
	split "$named"
	for line in ${ROWS[@]+"${ROWS[@]}"}; do
		add_written named "$line"
	done

	# Not descending into an ignored directory is what bounds this listing.
	while IFS= read -r -d '' m; do
		if [ "$m" = "//probe-listing-complete//" ]; then
			seen_end=1
			break
		fi
		case "$m" in */) m="${m%/}" ;; *) continue ;; esac
		if ! printable "$m"; then
			say "skipped=$(printf '%q' "$m")${TAB}a name with a tab or newline"
			continue
		fi
		ignore_state "$m" dir || fail "git could not say whether $m is ignored."
		if [ "$IGN" = no ]; then
			dropped=$((dropped + 1))
			continue
		fi
		add_candidate "$m" ignored || break
	done < <(git -C "$ROOT" ls-files -z --others --ignored --exclude-standard --directory &&
		printf '%s\0' "//probe-listing-complete//")
	[ "$seen_end" = 1 ] || [ "$LIMITED" = 1 ] || fail "git could not list the ignored paths."

	split "$derived_all"
	for line in ${ROWS[@]+"${ROWS[@]}"}; do
		has_line "$EFFECTIVE_NORM" "$line" || say "derived=$line"
	done

	i=0
	while [ "$i" -lt "${#CAND_PATHS[@]}" ]; do
		rel="${CAND_PATHS[$i]}"
		from="${CAND_FROM[$i]}"
		i=$((i + 1))
		if ! norm "$rel"; then
			say "candidate=$rel${TAB}from=$from${TAB}exists=-${TAB}ignored=-${TAB}tracked=-${TAB}guard=outside-root${TAB}mount=-${TAB}below=-${TAB}derived=no${TAB}rule="
			continue
		fi
		if [ -z "$NORM" ]; then
			say "candidate=$rel${TAB}from=$from${TAB}exists=dir${TAB}ignored=-${TAB}tracked=-${TAB}guard=is-root${TAB}mount=-${TAB}below=-${TAB}derived=no${TAB}rule="
			continue
		fi
		if [ -L "$ROOT/$rel" ]; then
			exists=symlink
		elif [ -d "$ROOT/$rel" ]; then
			exists=dir
		elif [ -e "$ROOT/$rel" ]; then
			exists='file'
		else
			exists=absent
		fi
		case ",$from," in
		*,committed,* | *,override,*) guard "$rel" 1 ;;
		*) guard "$rel" 0 ;;
		esac
		# git refuses a path beyond a symlink or inside a submodule, which the
		# guard has named by then; anywhere else a refusal is a failure.
		if ! ignore_state "$rel" "$exists"; then
			case "$GUARD" in ok | unscanned | preauthorized | nested-git:*) fail "git could not say whether $rel is ignored." ;; esac
			IGN=-
		fi
		if tracked="$(git --literal-pathspecs -C "$ROOT" ls-files -- "$rel" 2>/dev/null)"; then
			if [ -n "$tracked" ]; then tracked=yes; else tracked=no; fi
		else
			case "$GUARD" in ok | unscanned | preauthorized | nested-git:*) fail "git could not say whether $rel is tracked." ;; esac
			tracked=-
		fi
		fs="$(mount_fs "$ROOT/$rel")"
		if [ "$MOUNTS_READABLE" = 1 ]; then below="$(count_lines "$(mounts_below "$ROOT/$rel")")"; else below=-; fi
		if [ "$derived_known" = 0 ]; then
			derived=unknown
		elif has_line "$derived_all" "$rel" && ! has_line "$EFFECTIVE_NORM" "$rel"; then
			derived=yes
		else
			derived=no
		fi
		say "candidate=$rel${TAB}from=$from${TAB}exists=$exists${TAB}ignored=$IGN${TAB}tracked=$tracked${TAB}guard=$GUARD${TAB}mount=$fs${TAB}below=$below${TAB}derived=$derived${TAB}rule=$RULE"
	done

	split "$(mounts_below "$ROOT")"
	for line in ${ROWS[@]+"${ROWS[@]}"}; do
		say "mounted=${line#"$ROOT"/}$TAB$(mount_fs "$line")"
	done
	line="$(git -C "$ROOT" ls-files --cached --others --exclude-standard -- ':(glob)**/.gitignore')" || fail "git could not list the .gitignore files."
	split "$(printf '%s\n' "$line" | sort -u)"
	for m in ${ROWS[@]+"${ROWS[@]}"}; do
		say "gitignore=$m"
	done
	say "dropped=$dropped"
	if [ "$LIMITED" = 1 ]; then
		say "limit=$LIMIT"
		note "more candidates than --limit $LIMIT; the listing is cut short."
		finish incomplete 3
	fi
	finish probed 0
}

# ---------------------------------------------------------------- worktrees --

cmd_worktrees() {
	local root committed override effective tracked mp fs p known=1 problems="" wt_fs="" git_fs=""
	[ $# -eq 0 ] || usage "worktrees takes no argument: $1"
	read_config
	[ "$MOUNTS_READABLE" = 1 ] || known=0
	split "$WT_ROOTS"
	for root in "${ROWS[@]}"; do
		p="$ROOT/$root"
		if has_line "$COMMITTED_NORM" "$root"; then committed=yes; else committed=no; fi
		if [ "$OVERRIDE_ACTIVE" != 1 ]; then
			override=-
		elif has_line "$OVERRIDE_NORM" "$root"; then
			override=yes
		else
			override=no
		fi
		if has_line "$EFFECTIVE_NORM" "$root"; then effective=yes; else effective=no; fi
		if [ "$root" = .git/worktrees ]; then
			IGN=- RULE="" tracked=-
		else
			ignore_state "$root" "$([ -d "$p" ] && printf dir || printf absent)" || fail "git could not say whether $root is ignored."
			tracked="$(git --literal-pathspecs -C "$ROOT" ls-files -- "$root")" || fail "git could not say whether $root is tracked."
			tracked="$(count_lines "$tracked")"
		fi
		mp=unknown fs=-
		if have mountpoint; then
			if mountpoint -q "$p" 2>/dev/null; then mp=yes; else mp=no; fi
		elif [ "$MOUNTS_READABLE" = 1 ]; then
			if [ "$(mount_fs "$p")" != none ]; then mp=yes; else mp=no; fi
		fi
		if [ "$MOUNTS_READABLE" = 1 ] && [ -e "$p" ]; then
			fs="$(findmnt -nro FSTYPE -T "$p" 2>/dev/null | tail -n 1)"
			fs="${fs:--}"
		fi
		say "worktree_root=$root${TAB}committed=$committed${TAB}override=$override${TAB}effective=$effective${TAB}ignored=$IGN${TAB}tracked=$tracked${TAB}mountpoint=$mp${TAB}fs=$fs${TAB}rule=$RULE"
		[ "$mp" != no ] || problems="${problems}unhealthy=$root${TAB}not-a-mountpoint$NL"
		case "$root" in
		.worktrees) wt_fs="$fs" ;;
		.claude/worktrees) [ "$mp" != yes ] || [ "$fs" = tmpfs ] || problems="${problems}unhealthy=$root${TAB}expected-tmpfs$NL" ;;
		.git/worktrees) git_fs="$fs" ;;
		esac
	done
	if [ "$wt_fs" != tmpfs ] && [ "$git_fs" = tmpfs ]; then
		problems="${problems}unhealthy=.git/worktrees${TAB}not-durable$NL"
	fi
	case "$wt_fs" in
	9p | drvfs | virtiofs) problems="${problems}unhealthy=.worktrees${TAB}host-filesystem$NL" ;;
	esac
	if [ "$known" = 0 ] || [ ! -d "$ROOT/.git" ]; then
		say "mounts=unknown"
	elif [ -n "$problems" ]; then
		say "mounts=unhealthy"
		OUT="$OUT$problems"
	else
		say "mounts=healthy"
	fi
	finish probed 0
}

# --------------------------------------------------------------------- main --

CMD="${1:-}"
[ $# -eq 0 ] || shift
case "$CMD" in
-C)
	[ $# -ge 2 ] || usage "-C needs a directory and a command"
	cd "$1" 2>/dev/null || fail "could not enter $1."
	CMD="$2"
	shift 2
	;;
esac
case "$CMD" in
--help | -h)
	sed -n '2,/^set -u$/p' "$SELF" | sed -e '$d' -e 's/^# \{0,1\}//'
	exit 0
	;;
shadows | worktrees) ;;
"") usage "a command is needed" ;;
*) usage "unknown command: $CMD" ;;
esac

if ! ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || [ -z "$ROOT" ]; then
	note "not inside a git working tree."
	finish not-a-repository 3
fi
say "repo=$ROOT"
if [ -d "$ROOT/.git" ]; then say "checkout=main"; else say "checkout=linked"; fi

case "$CMD" in
shadows) cmd_shadows "$@" ;;
worktrees) cmd_worktrees "$@" ;;
esac
