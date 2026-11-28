#!/usr/bin/env bash
# perturb.sh — one control that cannot pass silently: change one committed
# file by one exact string, run a command that is expected to fail, put the
# file back, and say which of those happened.
#
# Usage:
#   perturb.sh [-C <dir>] [--timeout <seconds>] --file <path> --old <string> --new <string> -- <command> [<arg>...]
#
# `-C <dir>` is where the control runs (default: the current directory): the
# command runs there, and `--file` is read from there and must lie inside it.
# A role alone in its own worktree names that worktree, after committing; a
# role reviewing a tree others are reading names its disposable clone.
#
# `--old` must stand in the file exactly once, byte for byte, and is replaced
# by `--new` (which may be empty). Neither is a pattern. The command then runs
# with the file changed, its stdin empty and its output on stderr, and the file
# is put back whatever the command did.
#
#   outcome=caught       the command failed with the file changed, which is
#                        what a control is run to see (exit 0)
#   outcome=missed       the command passed although the file was changed: the
#                        check does not notice this change (exit 3)
#   outcome=no-match     `--old` is not in the file. Nothing was changed and
#                        the command was not run (exit 3)
#   outcome=ambiguous    `--old` stands in the file more than once, so the
#                        change would not be the one named. Nothing was changed
#                        and the command was not run (exit 3)
#   outcome=timed-out    the command was still running after `--timeout`
#                        seconds and was stopped; it neither passed nor failed
#                        (exit 3)
#   outcome=not-run      the command ended with status 126 or 127, a shell's
#                        answer for a command it could not run or find, so
#                        nothing says the check ran at all; a check that ran
#                        and ended with either of its own reads the same
#                        (exit 3)
#   outcome=refused      the control did not start, by `reason=` (exit 1):
#                        not-a-repository, missing, outside (the file is not
#                        inside `-C`), not-a-file (a symlink included),
#                        untracked, busy (a control is running in this
#                        repository), stale (an earlier control here never
#                        finished), uncommitted (the file differs from its
#                        commit, staged or not), unreadable (it holds a NUL
#                        byte, or could not be copied), unwritable (the
#                        change could not be written)
#   outcome=interrupted  a signal (`signal=`) ended the run; the command was
#                        stopped (exit 1)
#   outcome=unrestored   the file could NOT be put back (exit 1). `backup=`
#                        names a copy of its prior bytes, which is kept; with
#                        no `backup=`, that copy was removed while the control
#                        ran, the file was left as it stood, and stderr says
#                        what git reports of it
#
#   file=<path>          as it was named
#   matches=<n>          how many times `--old` stands in the file, counted no
#                        further than 2
#   status=<n>           the command's exit status, on caught, missed and
#                        not-run
#   lock=<dir>           on busy and stale, and on unrestored beside
#                        `backup=`: the directory that marks a control in
#                        progress
#   holder=<pid>         on busy and stale: the process the mark records, where
#                        it records one
#   backup=<path>        on busy and stale too, where the mark holds a copy of
#                        the bytes its control's file had
#   restored=yes         wherever the file was written to, on every outcome
#                        but unrestored: its bytes were compared with the copy
#                        taken before the change, and git reports it unchanged
#   was=<outcome>        on unrestored: what the answer would have been
#
# `caught` says the command failed, not why. A command that fails for a reason
# of its own (a wrong path, a broken setup, a test that was already failing)
# reads exactly like one that noticed the change, so read `status=` and the
# command's output for the failure you expected.
#
# The file is put back from a copy this script made, never through git, so
# nothing else in the tree is touched and nothing uncommitted can be lost: a
# file that differs from its commit is refused before anything is written.
# The file is read whole and searched in the shell, which takes seconds per
# megabyte.
# It is put back on every exit this script can catch, a signal and a timeout
# included, and on each of them whatever is left of the command's process
# group is stopped first, so a process the command started and left behind
# cannot write the file afterwards; one that left that group for a group or
# session of its own is out of reach. What the command writes elsewhere is
# the command's, and so are mode bits git does not record.
#
# One control runs in a repository at a time: two would each run with the
# other's change in place. The mark is a directory, `perturb.lock` in the
# file's git directory (a linked worktree has its own), which also holds the
# copy of the file and is removed on exit, except on unrestored. This script
# cannot catch SIGKILL or a lost machine: the file then stays changed and the
# mark stays. Nothing removes a mark but the run that made it, or you, so the
# next control is refused: as busy while the process the mark records is
# running here, as stale otherwise. Neither is certain (a process number
# passes to another process, and a control in another container or under
# another user does not show here), so both print the same facts and stderr
# says what to make sure of before the mark is removed. A control whose mark
# or copy was removed under it leaves its file as it stands, never empty, and
# answers unrestored.
#
# Output: `key=value` lines on stdout, `outcome=` first. Exit status: 0 on
# caught; 3 on missed, no-match, ambiguous, timed-out and not-run; 1 on
# refused, interrupted and unrestored, and on a failure of the script's own,
# which prints nothing on stdout; 64 on a usage error. Written for bash 3.2
# and later.
set -u

case "$0" in
/*) SELF="$0" ;;
*) SELF="$PWD/$0" ;;
esac

note() { printf 'perturb: %s\n' "$*" >&2; }
usage() {
	note "$*"
	sed -n '6,7p' "$SELF" | sed 's/^# \{0,1\}//' >&2
	exit 64
}

TMP="" LOCK="" BACKUP="" TARGET="" TARGET_DIR="" TARGET_BASE="" MATCHES="" APPLIED=0 WRITTEN=0 KEEP=0 CMD_PID="" WATCH_PID="" TAKING=0 PENDING=""

# Empty where git reports the file as its commit has it.
file_status() {
	git -C "$TARGET_DIR" --no-optional-locks status --porcelain -- "$TARGET_BASE" 2>&1 || echo "git status failed"
}

stop_children() {
	local n=0
	if [ -n "$WATCH_PID" ]; then
		kill -KILL -"$WATCH_PID" 2>/dev/null
		wait "$WATCH_PID" 2>/dev/null
		WATCH_PID=""
	fi
	if [ -n "$CMD_PID" ]; then
		# TERM for the whole group, KILL two seconds on for a first process
		# that ignores it, and KILL at once for whatever outlives that process:
		# where the command has already ended, that is everything it left.
		if kill -TERM -"$CMD_PID" 2>/dev/null; then
			local reaper
			set -m
			(
				sleep 2
				kill -KILL -"$CMD_PID"
			) </dev/null >/dev/null 2>&1 &
			reaper=$!
			set +m
			wait "$CMD_PID" 2>/dev/null
			kill -KILL -"$CMD_PID" 2>/dev/null
			# KILL, because this runs with TERM ignored and the reaper
			# inherited that.
			kill -KILL -"$reaper" 2>/dev/null
			wait "$reaper" 2>/dev/null
			# A killed process may still finish the write it was in, so the
			# group is seen empty before the file is put back. The bound is for
			# zombies nobody reaps, which answer for as long as they stand.
			while kill -0 -"$CMD_PID" 2>/dev/null && [ "$n" -lt 20 ]; do
				sleep 0.1
				n=$((n + 1))
			done
		else
			wait "$CMD_PID" 2>/dev/null
		fi
		CMD_PID=""
	fi
}

# The mark is this run's while it records this process: one removed by hand
# may since have been made again by another control.
mine() { [ -n "$TMP" ] && [ "$(cat "$TMP/pid" 2>/dev/null)" = "$$" ]; }
release() {
	[ -n "$TMP" ] && [ "$KEEP" = 0 ] || return 0
	case "$(cat "$TMP/pid" 2>/dev/null)" in "$$" | "") rm -rf -- "$TMP" ;; esac
}

# 0 where the file holds its prior bytes again and git agrees.
restore() {
	[ "$APPLIED" = 1 ] || return 0
	# A symlink left in the file's place is not written through. A file
	# still there is written in place, so it keeps its mode and takes a new
	# modification time: a build that compares times would otherwise keep
	# what it made from the changed file. The copy is opened before the
	# file is, so a copy that has gone leaves the file as it stands and not
	# empty.
	if mine && [ ! -L "$TARGET" ]; then
		if [ -f "$TARGET" ]; then
			cat <"$BACKUP" >"$TARGET"
		elif [ ! -e "$TARGET" ]; then
			cp -p "$BACKUP" "$TARGET" && touch "$TARGET"
		fi
	fi 2>/dev/null
	if mine && cmp -s "$BACKUP" "$TARGET" 2>/dev/null && [ -f "$TARGET" ] && [ ! -L "$TARGET" ] && [ -z "$(file_status)" ]; then
		APPLIED=0
		return 0
	fi
	return 1
}
# After a failed restore: 0, the mark kept, where the copy is there to name.
kept() {
	if mine && [ -f "$BACKUP" ]; then
		KEEP=1
		note "COULD NOT RESTORE $FILE: it does not hold its prior bytes, or git still reports it changed. A copy of them is kept at $BACKUP. Put them back, then remove $TMP: until then the next control here is refused."
		return 0
	fi
	local now="still as its commit has it"
	[ -z "$(file_status)" ] || now="changed"
	note "COULD NOT RESTORE $FILE: the copy of its prior bytes, $BACKUP, was removed while this control ran, so the file was left as it stood and nothing was checked. It was as its commit has it when the control began, and git now reports it $now: \`git diff\` shows whatever is left to undo, and none of that is to be committed."
	return 1
}

# shellcheck disable=SC2329 # the EXIT trap runs it
cleanup() {
	trap '' INT TERM HUP
	stop_children
	restore || kept || :
	release
}

# Every answer that follows a change goes through here, so none is given
# before the file was put back and checked.
answer() { # <outcome> <exit status> [<line>...]
	local outcome="$1" rc="$2"
	shift 2
	trap '' INT TERM HUP
	stop_children
	if restore; then
		printf 'outcome=%s\nfile=%s\n' "$outcome" "$FILE"
		[ -z "$MATCHES" ] || printf 'matches=%s\n' "$MATCHES"
		[ $# -eq 0 ] || printf '%s\n' "$@"
		[ "$WRITTEN" = 0 ] || printf 'restored=yes\n'
	else
		printf 'outcome=unrestored\nfile=%s\nmatches=1\n' "$FILE"
		if kept; then printf 'backup=%s\nlock=%s\n' "$BACKUP" "$TMP"; fi
		printf 'was=%s\n' "$outcome"
		[ $# -eq 0 ] || printf '%s\n' "$@"
		rc=1
	fi
	trap - EXIT
	release
	exit "$rc"
}
refuse() { # <reason> <message>
	printf 'outcome=refused\nfile=%s\nreason=%s\n' "$FILE" "$1"
	note "$2 Nothing was changed and the command was not run."
	exit 1
}
# The mark is already there: say what it records, and remove nothing. Returns
# only where the mark went away while it was being read.
held() {
	local raw pid was reason lead clear n=0
	# A mark is recorded within moments of being made, so one with no record
	# yet is given two seconds before it is read as abandoned.
	while [ -d "$LOCK" ] && [ ! -e "$LOCK/pid" ] && [ "$n" -lt 20 ]; do
		sleep 0.1
		n=$((n + 1))
	done
	raw="$(cat "$LOCK/pid" 2>/dev/null)"
	pid="$raw"
	case "$pid" in "" | *[!0-9]*) pid="" ;; esac
	if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
		reason=busy
	elif [ -d "$LOCK" ] && [ "$(cat "$LOCK/pid" 2>/dev/null)" = "$raw" ]; then
		# Still standing with the same record: no finished run's leftovers.
		reason=stale
	else
		return 0
	fi
	was="$(cat "$LOCK/target" 2>/dev/null)"
	printf 'outcome=refused\nfile=%s\nreason=%s\nlock=%s\n' "$FILE" "$reason" "$LOCK"
	[ -z "$pid" ] || printf 'holder=%s\n' "$pid"
	if [ -f "$LOCK/original" ]; then
		printf 'backup=%s\n' "$LOCK/original"
		clear="Its file is ${was:-not named}, and the bytes that file had are kept in $LOCK/original: where \`git diff\` still shows that control's change, copy them back over the file, and do not commit it. Then remove $LOCK and run this again."
	else
		clear="It kept no copy of ${was:-a file}, so it had changed nothing, unless the copy was removed since: \`git diff\` shows such a change, which is not to be committed. Remove $LOCK and run this again."
	fi
	if [ "$reason" = busy ]; then
		lead="another control is running in this repository (process $pid), and two at once would each run with the other's change in place: wait for it. Only if process $pid is no run of this script was the mark left by a control that was killed, and then: "
	elif [ -n "$pid" ]; then
		lead="an earlier control here never finished (its process $pid is gone). Make sure it is not running in another container or as another user, where it would not show here, and then: "
	else
		lead="an earlier control here was stopped as it began, before it recorded its process. "
	fi
	note "$lead$clear Nothing was changed and the command was not run."
	exit 1
}
# shellcheck disable=SC2329 # the signal traps run it
on_signal() {
	# Between making the mark and knowing it was made, a signal waits: it
	# would otherwise leave a mark no run owns.
	if [ "$TAKING" = 1 ]; then
		PENDING="$1"
		return 0
	fi
	note "stopped by SIG$1."
	answer interrupted 1 "signal=$1"
}

DIR="" FILE="" OLD="" NEW="" TIMEOUT="" HAVE_OLD=0 HAVE_NEW=0
while [ $# -gt 0 ]; do
	case "$1" in
	-h | --help | help)
		awk 'NR > 1 && !/^#/ { exit } NR > 1 { sub(/^# ?/, ""); print }' "$SELF"
		exit 0
		;;
	-C | --file | --old | --new | --timeout)
		[ $# -ge 2 ] || usage "$1 needs a value"
		case "$1" in
		-C) DIR="$2" ;;
		--file) FILE="$2" ;;
		--old) OLD="$2" HAVE_OLD=1 ;;
		--new) NEW="$2" HAVE_NEW=1 ;;
		--timeout) TIMEOUT="$2" ;;
		esac
		shift 2
		;;
	--)
		shift
		break
		;;
	*) usage "unknown argument: $1 (the command follows --)" ;;
	esac
done
[ -n "$FILE" ] || usage "name the file to change: --file <path>"
[ "$HAVE_OLD" = 1 ] && [ -n "$OLD" ] || usage "name the string to replace: --old <string>"
[ "$HAVE_NEW" = 1 ] || usage "name its replacement: --new <string> (which may be empty)"
[ "$OLD" != "$NEW" ] || usage "--old and --new are the same string, which changes nothing"
[ $# -gt 0 ] || usage "name the command expected to fail, after --"
case "$TIMEOUT" in
"") ;;
*[!0-9]* | 0*) usage "--timeout takes a whole number of seconds, 1 or more" ;;
esac
if [ -n "$DIR" ]; then
	cd -- "$DIR" 2>/dev/null || {
		note "could not enter $DIR."
		exit 1
	}
fi
command -v -- "$1" >/dev/null 2>&1 || usage "'$1' is not a command this shell can run from here, so its failure would say nothing about the change"

ROOT="$(pwd -P)" || exit 1
git rev-parse --git-dir >/dev/null 2>&1 || refuse not-a-repository "$ROOT is not inside a git repository, so nothing says the file is committed."
case "$FILE" in
/*) TARGET="$FILE" ;;
*) TARGET="$ROOT/$FILE" ;;
esac
TARGET_BASE="$(basename -- "$TARGET")"
TARGET_DIR="$(cd -P -- "$(dirname -- "$TARGET")" 2>/dev/null && pwd -P)" || refuse missing "$FILE is not there."
TARGET="$TARGET_DIR/$TARGET_BASE"
[ "$ROOT" != / ] || ROOT=""
case "$TARGET_DIR/" in
"$ROOT"/*) ;;
*) refuse outside "$FILE is not inside ${ROOT:-/}, the directory this control was pointed at." ;;
esac
[ -e "$TARGET" ] || [ -L "$TARGET" ] || refuse missing "$FILE is not there."
[ -f "$TARGET" ] && [ ! -L "$TARGET" ] || refuse not-a-file "$FILE is not a regular file."
git -C "$TARGET_DIR" ls-files --error-unmatch -- "$TARGET_BASE" >/dev/null 2>&1 || refuse untracked "$FILE is not a file git tracks, so all of it is uncommitted."

# Taken before the file is compared with its commit, so that a second control
# never reads a file the first is about to change, and under the git directory,
# where neither `git status` nor a commit sees it.
LOCK="$(cd -- "$TARGET_DIR" && cd -P -- "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)" || {
	note "could not find the git directory of $FILE."
	exit 1
}
LOCK="$LOCK/perturb.lock"
trap cleanup EXIT
trap 'on_signal INT' INT
trap 'on_signal TERM' TERM
trap 'on_signal HUP' HUP
TRIES=0
while :; do
	TAKING=1
	if mkdir "$LOCK" 2>/dev/null; then TMP="$LOCK"; fi
	TAKING=0
	[ -z "$PENDING" ] || on_signal "$PENDING"
	[ -z "$TMP" ] || break
	held
	TRIES=$((TRIES + 1))
	[ "$TRIES" -lt 3 ] || {
		note "could not make $LOCK."
		exit 1
	}
done
# Each record is moved into place whole, so a reader never sees half of one.
if ! { printf '%s\n' "$TARGET" >"$TMP/target" && printf '%s\n' "$$" >"$TMP/pid.new" && mv "$TMP/pid.new" "$TMP/pid"; } 2>/dev/null; then
	note "could not record this control in $TMP."
	exit 1
fi
[ -z "$(file_status)" ] || refuse uncommitted "$FILE differs from its commit. \`git diff\` shows the difference, and a control runs on committed work only: where it is work you mean to keep, commit it first; where it is what a control that was stopped left behind, undo it and do not commit it."
BACKUP="$TMP/original"
if ! cp -p "$TARGET" "$BACKUP.new" 2>/dev/null || ! cmp -s "$TARGET" "$BACKUP.new" || ! mv "$BACKUP.new" "$BACKUP" 2>/dev/null; then
	refuse unreadable "$FILE could not be copied."
fi

# Byte semantics, in a subshell so the command inherits the caller's locale:
# a multibyte locale would count in characters and stumble on a byte sequence
# that is not one. Prints the match count; writes $TMP/changed on exactly one.
COUNT="$(
	LC_ALL=C
	content="$(
		cat "$BACKUP"
		printf x
	)"
	content=${content%x}
	printf '%s' "$content" | cmp -s - "$BACKUP" || {
		echo unreadable
		exit 0
	}
	rest=$content
	n=0
	while :; do
		head=${rest%%"$OLD"*}
		[ "${#head}" -ne "${#rest}" ] || break
		n=$((n + 1))
		[ "$n" -lt 2 ] || break
		first=$head
		rest=${rest:$((${#head} + ${#OLD}))}
	done
	if [ "$n" = 1 ]; then
		printf '%s%s%s' "$first" "$NEW" "$rest" >"$TMP/changed" || {
			echo failed
			exit 0
		}
	fi
	echo "$n"
)"
case "$COUNT" in
unreadable) refuse unreadable "$FILE holds a NUL byte, which this script cannot carry." ;;
0)
	printf 'outcome=no-match\nfile=%s\nmatches=0\n' "$FILE"
	note "--old is not in $FILE. Nothing was changed and the command was not run."
	exit 3
	;;
1) ;;
"" | *[!0-9]*)
	note "could not prepare the change. Nothing was changed and the command was not run."
	exit 1
	;;
*)
	printf 'outcome=ambiguous\nfile=%s\nmatches=%s\n' "$FILE" "$COUNT"
	note "--old stands in $FILE more than once. Name a longer string that stands there once. Nothing was changed and the command was not run."
	exit 3
	;;
esac
if cmp -s "$TMP/changed" "$BACKUP"; then
	note "the change left $FILE as it was. Nothing was changed and the command was not run."
	exit 1
fi

MATCHES=1 APPLIED=1 WRITTEN=1
if ! { mine && cat <"$TMP/changed" >"$TARGET"; } 2>/dev/null || ! cmp -s "$TMP/changed" "$TARGET"; then
	note "could not write the change to $FILE. The command was not run."
	answer refused 1 "reason=unwritable"
fi

# Job control gives the command a process group of its own, so what is stopped
# is everything it started and not just its first process.
set -m
"$@" </dev/null >&2 &
CMD_PID=$!
if [ -n "$TIMEOUT" ]; then
	(
		sleep "$TIMEOUT"
		: >"$TMP/timed-out"
		kill -TERM -"$CMD_PID"
		sleep 2
		kill -KILL -"$CMD_PID"
	) </dev/null >/dev/null 2>&1 &
	WATCH_PID=$!
fi
set +m
STATUS=0
wait "$CMD_PID" 2>/dev/null || STATUS=$?
if [ -e "$TMP/timed-out" ]; then
	note "the command was still running after $TIMEOUT seconds and was stopped."
	answer timed-out 3 "timeout=$TIMEOUT"
fi
# CMD_PID stays set: its group may hold processes the command left behind.
case "$STATUS" in
0)
	note "the command PASSED with $FILE changed: it does not notice this change."
	answer missed 3 "status=0"
	;;
126 | 127)
	note "the command ended with status $STATUS, which is what a shell gives for a command it could not run or find: nothing says the check ran at all."
	answer not-run 3 "status=$STATUS"
	;;
esac
answer caught 0 "status=$STATUS"
