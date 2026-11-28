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
#                        itself (the file is this script as it runs, which
#                        bash reads as it goes: run a copy of it instead),
#                        untracked, locked (a control's lock stood in this
#                        repository as this one began), uncommitted (the
#                        file differs from its commit, staged or not, or
#                        the index tells git not to compare it),
#                        unreadable (it holds a NUL byte, or could not be
#                        copied), unwritable (the change could not be
#                        written), failed (a step of the script's own could
#                        not be done, and stderr says which)
#   outcome=interrupted  a signal (`signal=`) ended the run; the command, where
#                        it had started, was stopped (exit 1)
#   outcome=unrestored   the file could NOT be put back (exit 1). `backup=`
#                        names a copy of its prior bytes, which is kept, and
#                        the lock with it; with no `backup=`, that copy was
#                        removed while the control ran, the file was left as
#                        it stood, and stderr says what git reports of it
#
#   file=<path>          as it was named
#   matches=<n>          how many times `--old` stands in the file, counted no
#                        further than 2
#   status=<n>           the command's exit status, on caught, missed and
#                        not-run
#   lock=<path>          on locked, and on unrestored beside `backup=`: the
#                        name that marks a control in progress
#   holder=<pid>         on locked: the process the lock records, where it
#                        was read whole and records one
#   holder-running=<yes|no>  beside `holder=`: whether a process with that
#                        number is running here now, which is all it says
#   backup=<path>        on locked too, where the lock holds a copy of the
#                        bytes its control's file had
#   restored=yes         wherever writing the change was attempted, on every
#                        outcome but unrestored: the file's bytes were compared
#                        with the copy taken before, and git reports it
#                        unchanged
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
# other's change in place. A control makes a directory of its own,
# `perturb.XXXXXX` in the file's git directory (a linked worktree has its
# own), records its process and its file there, and only then takes the lock:
# `ln -sn` makes `perturb.lock` beside it a symbolic link to that directory,
# and the link is read back. Making a link fails wherever the name is taken,
# and no two calls can both make it, so one control holds the lock and it is
# whole from the moment it stands; reading it back answers for a directory
# standing at that name, into which `ln` would have put the link. On exit
# the link goes first and the directory after it, and both stay on unrestored
# with `backup=`.
#
# A second control does not wait and removes nothing: it is refused as locked.
# Where the lock stood unchanged while it was read, `holder=`,
# `holder-running=` and `backup=` say what it records and stderr says what to
# do in each case: wait while that control runs; only where it runs nowhere,
# put the bytes back, never commit the change, and then remove the lock. This
# script does not decide which it is, since a process number passes to other
# processes and a control in another container or under another user does not
# show here. Where the lock went or changed hands while it was read, only
# `lock=` is printed and the control is to be run again.
#
# An INT, TERM or HUP sent to this script while it makes its checks is
# ignored: the control goes on, and the signal can be sent again. The checks
# take tens of milliseconds for a small file and seconds per megabyte of a
# large one. Once they are done, from just before the change is written, a
# signal stops the command where it has started and is answered
# `interrupted`, as it was in every trial measured under bash 3.2.57 and
# 5.2.37. One that comes before this script's first line has run ends the
# process with the signal's own status and no output, nothing changed and
# nothing left.
#
# This script cannot catch SIGKILL or a lost machine: the file then stays
# changed and the lock stands, or, killed as it began or ended, a
# `perturb.XXXXXX` directory is left that nothing reads. A control puts its
# file back from the copy in its own directory whatever became of the lock,
# says on stderr where the lock was no longer its own, and leaves what stands
# at that name alone; one whose copy was removed leaves the file as it
# stands, never empty, and answers unrestored.
#
# Output: `key=value` lines on stdout, `outcome=` first. Exit status: 0 on
# caught; 3 on missed, no-match, ambiguous, timed-out and not-run; 1 on
# refused, interrupted and unrestored; 64 on a usage error, which prints no
# `outcome=` line. Written for bash 3.2 and later.
set -u
trap '' INT TERM HUP

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

FILE="" TMP="" NAME="" LOCK="" HELD=0 BACKUP="" TARGET="" TARGET_DIR="" TARGET_BASE="" MATCHES="" APPLIED=0 WRITTEN=0 KEEP=0 CMD_PID="" WATCH_PID=""

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

# The link goes before anything it leads to, so a lock that still stands was
# read whole. Only this run's own link is removed.
release() {
	[ -n "$TMP" ] && [ "$KEEP" = 0 ] || return 0
	if [ -n "$NAME" ] && [ "$(readlink "$LOCK" 2>/dev/null)" = "$NAME" ]; then
		rm -f -- "$LOCK"
	elif [ "$HELD" = 1 ]; then
		note "$LOCK was removed or taken over while this control ran, so another control may have run beside it. What stands there now was left alone."
	fi
	rm -rf -- "$TMP"
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
	if [ ! -L "$TARGET" ]; then
		if [ -f "$TARGET" ]; then
			cat <"$BACKUP" >"$TARGET"
		elif [ ! -e "$TARGET" ]; then
			cp -p "$BACKUP" "$TARGET" && touch "$TARGET"
		fi
	fi 2>/dev/null
	if cmp -s "$BACKUP" "$TARGET" 2>/dev/null && [ -f "$TARGET" ] && [ ! -L "$TARGET" ] && [ -z "$(file_status)" ]; then
		APPLIED=0
		return 0
	fi
	return 1
}
# After a failed restore: 0, the lock kept, where the copy is there to name.
kept() {
	if [ -f "$BACKUP" ]; then
		KEEP=1
		note "COULD NOT RESTORE $FILE: it does not hold its prior bytes, or git still reports it changed. A copy of them is kept at $BACKUP. Put them back, then remove $TMP, and $LOCK where it still leads there: until then the next control here is refused."
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
		if kept; then printf 'backup=%s\nlock=%s\n' "$BACKUP" "$LOCK"; fi
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
# The lock's name is taken: say what stands there, and remove nothing of it.
locked() {
	local link dir pid="" run="" was="" copy="" also="" says undo
	# Where a directory stands at the lock's name, `ln` put the link inside it.
	rm -f -- "$LOCK/$NAME" 2>/dev/null
	link="$(readlink "$LOCK" 2>/dev/null)"
	dir="$(cd -P -- "$LOCK" 2>/dev/null && pwd -P)"
	if [ -n "$dir" ]; then
		pid="$(cat "$dir/pid" 2>/dev/null)"
		case "$pid" in "" | *[!0-9]*) pid="" ;; esac
		was="$(cat "$dir/target" 2>/dev/null)"
		[ ! -f "$dir/original" ] || copy="$dir/original"
		[ -z "$pid" ] || { kill -0 "$pid" 2>/dev/null && run=yes; } || run=no
	fi
	printf 'outcome=refused\nfile=%s\nreason=locked\nlock=%s\n' "$FILE" "$LOCK"
	# Looked at again after the reading, and after the holder was looked
	# for: a lock that still leads where it led was whole all the while.
	if { [ ! -e "$LOCK" ] && [ ! -L "$LOCK" ]; } || [ "$(readlink "$LOCK" 2>/dev/null)" != "$link" ]; then
		note "$LOCK was taken as this control began and was let go of or changed hands while it was read, as it does when another control ends at that moment: run this again. (Where this repeats with no other control about, a symbolic link cannot be made there.) Nothing was changed and the command was not run."
		exit 1
	fi
	[ -z "$link" ] || [ -z "$dir" ] || also=" and $dir"
	says="It records no process"
	if [ -n "$pid" ]; then
		printf 'holder=%s\nholder-running=%s\n' "$pid" "$run"
		says="It records process $pid, and a process with that number is running here now"
		[ "$run" = yes ] || says="It records process $pid, and no process with that number is running here now"
	fi
	if [ -n "$copy" ]; then
		printf 'backup=%s\n' "$copy"
		undo="copy $copy back over ${was:-its file} wherever \`git diff\` still shows its change"
	else
		undo="it kept no copy of ${was:-a file}, so it changed nothing unless the copy was removed since, and \`git diff\` shows such a change to undo"
	fi
	note "$LOCK marks a control in progress in this repository, and two at once would each run with the other's change in place. $says, which settles nothing by itself: a process number passes to other processes, and a control in another container or under another user does not show here. While that control is running, wait for it and run this again. Only where it is running nowhere (it was killed, or its machine went down): $undo, never commit that change, and then remove $LOCK$also. Nothing was changed and the command was not run."
	exit 1
}
# shellcheck disable=SC2329 # the signal traps run it
on_signal() {
	note "stopped by SIG$1."
	answer interrupted 1 "signal=$1"
}
trap cleanup EXIT

DIR="" OLD="" NEW="" TIMEOUT="" HAVE_OLD=0 HAVE_NEW=0
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
	cd -- "$DIR" 2>/dev/null || refuse failed "could not enter $DIR."
fi
command -v -- "$1" >/dev/null 2>&1 || usage "'$1' is not a command this shell can run from here, so its failure would say nothing about the change"

ROOT="$(pwd -P)" || refuse failed "could not tell where this control runs."
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
# bash reads a script as it runs it, so changing this one under it would run
# whatever then stood at the place bash had reached.
[ ! "$TARGET" -ef "$SELF" ] || refuse itself "$FILE is this script, which bash reads as it runs: run a copy of it on $FILE instead."
git -C "$TARGET_DIR" ls-files --error-unmatch -- "$TARGET_BASE" >/dev/null 2>&1 || refuse untracked "$FILE is not a file git tracks, so all of it is uncommitted."

# Taken before the file is compared with its commit, so that a second control
# never reads a file the first is about to change, and under the git directory,
# where neither `git status` nor a commit sees it.
GITDIR="$(cd -- "$TARGET_DIR" && cd -P -- "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)" || refuse failed "could not find the git directory of $FILE."
LOCK="$GITDIR/perturb.lock"
if ! TMP="$(mktemp -d "$GITDIR/perturb.XXXXXX" 2>/dev/null)" || ! { printf '%s\n' "$TARGET" >"$TMP/target" && printf '%s\n' "$$" >"$TMP/pid"; } 2>/dev/null; then
	refuse failed "could not make a directory for this control in $GITDIR."
fi
NAME="${TMP##*/}"
{ ln -sn "$NAME" "$LOCK" && [ "$(readlink "$LOCK")" = "$NAME" ]; } 2>/dev/null || locked
HELD=1
# An assume-unchanged or skip-worktree entry is one git does not compare, so
# its status is empty whatever the file holds. `ls-files -v` tags any other
# entry `H`.
case "$(git -C "$TARGET_DIR" ls-files -v -- "$TARGET_BASE" 2>/dev/null)" in
"H "*) ;;
*) refuse uncommitted "the index tells git not to compare $FILE with its commit (assume-unchanged or skip-worktree), so nothing says it holds committed work. \`git update-index --no-assume-unchanged --no-skip-worktree -- <file>\` clears that, and \`git diff\` then shows any difference: a control runs on committed work only." ;;
esac
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
"" | *[!0-9]*) refuse failed "could not prepare the change." ;;
*)
	printf 'outcome=ambiguous\nfile=%s\nmatches=%s\n' "$FILE" "$COUNT"
	note "--old stands in $FILE more than once. Name a longer string that stands there once. Nothing was changed and the command was not run."
	exit 3
	;;
esac
! cmp -s "$TMP/changed" "$BACKUP" || refuse failed "the change left $FILE as it was."

# Signals are caught only from here, and from here to the answer no `$(...)`
# runs while one can be: under bash 5.2.37 a trap that came due during the
# checks was at times lost, ended the run with no answer, or left it spinning.
trap 'on_signal INT' INT
trap 'on_signal TERM' TERM
trap 'on_signal HUP' HUP
MATCHES=1 APPLIED=1 WRITTEN=1
# The changed bytes are opened before the file is, as the copy is in restore.
if ! cat <"$TMP/changed" >"$TARGET" 2>/dev/null || ! cmp -s "$TMP/changed" "$TARGET"; then
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
