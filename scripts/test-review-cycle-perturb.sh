#!/usr/bin/env bash
# Hermetic test for the review-cycle skill's bundled `perturb.sh`: real git in
# a throwaway repository, no network. Every case ends by comparing the whole
# repository (each file's bytes and mode, and what git reports) with what it
# was. `PERTURB_HELPER` points the suite at another copy of the script (a
# mutant, say).
# shellcheck disable=SC2016 # the commands under test expand their own variables
set -u

ROOT="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SHIPPED="$ROOT/plugins/dev-skills/skills/review-cycle/perturb.sh"
MIRROR="$ROOT/codex/dev-skills/skills/review-cycle/perturb.sh"
SHIM="$ROOT/plugins/dev-skills/bin/review-cycle-perturb"
HELPER="${PERTURB_HELPER:-$SHIPPED}"
WORKDIR="$(cd -P -- "$(mktemp -d "${TMPDIR:-/tmp}/perturb-test.XXXXXX")" && pwd)" || exit 1
trap 'rm -rf "$WORKDIR"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
# A TMPDIR inside some repository must not make "outside a repository" false.
export GIT_CEILING_DIRECTORIES="$WORKDIR"
# Anything the helper put in a temporary directory would land here, where the
# suite can see that nothing is left behind.
mkdir "$WORKDIR/tmp"
export TMPDIR="$WORKDIR/tmp"

checks=0
fails=0
ok() { # <label> <condition status>
	checks=$((checks + 1))
	if [ "$2" != 0 ]; then
		fails=$((fails + 1))
		printf 'FAIL [%s]\n' "$1" >&2
	fi
}
has() { # <label> <haystack> <needle>
	case "$2" in *"$3"*) ok "$1" 0 ;; *)
		ok "$1" 1
		printf '      wanted: %s\n      got:    %s\n' "$3" "$2" >&2
		;;
	esac
}
is() { # <label> <actual> <expected>
	if [ "$2" = "$3" ]; then ok "$1" 0; else
		ok "$1" 1
		printf '      wanted: %s\n      got:    %s\n' "$3" "$2" >&2
	fi
}

R="$WORKDIR/repo"
SAW="$WORKDIR/saw"
call() { # [args...] → OUT (stdout), ERR (stderr), RC
	OUT="$(cd "$R" && bash "$HELPER" "$@" 2>"$WORKDIR/err")"
	RC=$?
	ERR="$(cat "$WORKDIR/err")"
}
val() { printf '%s\n' "$OUT" | sed -n "s/^$1=//p" | head -n 1; }
# Everything a control must leave as it found it.
snap() {
	git --no-optional-locks -C "$R" status --porcelain
	git -C "$R" rev-parse HEAD
	(cd "$R" && find . -path ./.git -prune -o -print | sort | while IFS= read -r f; do
		if [ -L "$f" ]; then
			printf 'link %s\n' "$f"
		elif [ -f "$f" ]; then
			printf '%s %s %s\n' "$(cksum <"$f")" "$([ -x "$f" ] && echo x || echo -)" "$f"
		else printf 'dir %s\n' "$f"; fi
	done)
	cksum <"$R/.git/index"
}
before() {
	rm -f "$SAW" "$WORKDIR/pid"
	BEFORE="$(snap)"
}
same() { is "$1" "$(snap)" "$BEFORE"; } # <label>
unrun() { ok "$1" "$([ ! -e "$SAW" ] && echo 0 || echo 1)"; } # <label>: the command left no trace
LOCK="$R/.git/perturb.lock"
# What a finished control left: a temporary file, its lock, or its directory.
left() {
	{
		find "$TMPDIR" -mindepth 1
		find "$R/.git" -name 'perturb.*'
	} | wc -l | tr -d ' '
}
# Remove a lock that was kept, by the copy it holds.
drop() { # <backup>
	rm -rf "${1%/*}"
	rm -f "$LOCK"
}
# Run the helper with one command replaced by a script that does the same and
# then something more, at a moment nothing else can reach.
shim() { # <command> <what more, as shell text>
	rm -rf "$WORKDIR/shim"
	mkdir "$WORKDIR/shim"
	printf '#!/bin/sh\n"%s" "$@"\nrc=$?\n%s\nexit $rc\n' "$(command -v "$1")" "$2" >"$WORKDIR/shim/$1"
	chmod +x "$WORKDIR/shim/$1"
}
shimmed() { # [args...] → OUT, ERR, RC, as call
	OUT="$(cd "$R" && PATH="$WORKDIR/shim:$PATH" bash "$HELPER" "$@" 2>"$WORKDIR/err")"
	RC=$?
	ERR="$(cat "$WORKDIR/err")"
}
# A zombie has exited and only awaits its parent, and answers `kill -0` for as
# long as PID 1 does not reap it.
alive() { # <pid>
	local stat
	kill -0 "$1" 2>/dev/null || return 1
	stat="$(cat "/proc/$1/stat" 2>/dev/null)" || return 0
	case "${stat##*) }" in Z*) return 1 ;; esac
	return 0
}
gone() { # <pid>: wait briefly for it to leave
	local _
	for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
		alive "$1" || return 0
		sleep 0.1
	done
	return 1
}

git init -q -b main "$R"
printf 'limit=3\nmode=strict\nmode_note=strict is the default\n' >"$R/conf"
# The check: passes while the limit is 3, and records the file it saw.
cat >"$R/check.sh" <<'CHECK'
#!/bin/sh
cat conf >"$SAW"
echo "checking the limit"
grep -q '^limit=3$' conf
CHECK
chmod +x "$R/check.sh"
printf 'star *.c [a-z] back\\slash $HOME "q"\nlast line, no newline' >"$R/odd"
mkdir "$R/sub"
printf 'x=1\n' >"$R/sub/deep file"
printf 'kept\n' >"$R/other"
git -C "$R" add -A
git -C "$R" commit -q -m init
export SAW
# Where PID 1 reaps nothing, what a stopped command left stands as a zombie,
# which answers for its group until the helper's two seconds for that are up:
# there the checks on a prompt answer claim only that the wait is bounded.
orphan="$(sh -c 'true & echo $!')"
sleep 0.5
PROMPT=2
! kill -0 "$orphan" 2>/dev/null || PROMPT=6
# What `git restore` and a stash would eat, standing beside every control.
printf 'an uncommitted edit\n' >>"$R/other"
printf 'untracked\n' >"$R/scratch"

# --- 1: the four answers ------------------------------------------------------
before
call --file conf --old 'limit=3' --new 'limit=4' -- ./check.sh
is "1: a command that fails with the file changed is caught, exit 0" "$RC:$(printf '%s\n' "$OUT" | head -n 1)" "0:outcome=caught"
is "1: ...with the command's own status" "$(val status)" 1
is "1: ...and every line of the answer" "$OUT" "outcome=caught
file=conf
matches=1
status=1
restored=yes"
has "1: ...the command ran against the changed file" "$(cat "$SAW" 2>/dev/null)" "limit=4"
has "1: ...its output is on stderr, off the answer" "$ERR" "checking the limit"
same "1: ...and the repository is as it was"
is "1: ...with no temporary file left" "$(left)" 0

before
call --file conf --old 'mode=strict' --new 'mode=loose' -- ./check.sh
is "1: a command that passes with the file changed is missed, exit 3" "$RC:$(val outcome):$(val status)" "3:missed:0"
has "1: ...having run against the changed file" "$(cat "$SAW" 2>/dev/null)" "mode=loose"
is "1: ...which was put back" "$(val restored)" yes
same "1: ...and the repository is as it was"

before
call --file conf --old 'limit=30' --new 'limit=4' -- ./check.sh
is "1: a string that is not there is no-match, exit 3" "$RC:$(val outcome):$(val matches)" "3:no-match:0"
unrun "1: ...and the command never ran"
is "1: ...nothing claims a restore of a file never written" "$(val restored)" ""
same "1: ...and the repository is as it was"

before
call --file conf --old 'strict' --new 'loose' -- ./check.sh
is "1: a string that stands there twice is ambiguous, exit 3" "$RC:$(val outcome):$(val matches)" "3:ambiguous:2"
unrun "1: ...and the command never ran"
same "1: ...and the repository is as it was"
call --file conf --old 'i' --new 'I' -- ./check.sh
is "1: ...and the count goes no further than 2" "$RC:$(val outcome):$(val matches)" "3:ambiguous:2"

# --- 2: the string is bytes, not a pattern --------------------------------------
before
call --file odd --old '*.c [a-z] back\slash $HOME "q"' --new 'X' -- sh -c 'cat odd >"$SAW"; false'
is "2: glob characters, a backslash, a dollar and quotes match themselves" "$RC:$(val outcome)" "0:caught"
is "2: ...and only they were replaced" "$(cat "$SAW")" "star X
last line, no newline"
same "2: ...and a file with no final newline comes back without one"

before
call --file odd --old '*' --new 'X' -- sh -c 'cat odd >"$SAW"; false'
is "2: a lone star matches one star, not the file" "$(val outcome):$(head -n 1 "$SAW")" 'caught:star X.c [a-z] back\slash $HOME "q"'
call --file odd --old '[a-z]' --new '' -- sh -c 'cat odd >"$SAW"; false'
is "2: an empty replacement deletes the string" "$(val outcome):$(head -n 1 "$SAW")" 'caught:star *.c  back\slash $HOME "q"'
call --file odd --old 'q"
last' --new 'q" first' -- sh -c 'cat odd >"$SAW"; false'
is "2: a string may span lines" "$(val outcome):$(cat "$SAW")" 'caught:star *.c [a-z] back\slash $HOME "q" first line, no newline'
call --file odd --old 'star ?' --new 'X' -- false
is "2: a question mark is no wildcard" "$(val outcome)" no-match
call --file 'sub/deep file' --old 'x=1' --new 'x=2' -- sh -c 'cat "sub/deep file" >"$SAW"; false'
is "2: a path with a space, below the directory" "$(val outcome):$(cat "$SAW")" "caught:x=2"
same "2: ...and the repository is as it was"
OUT="$(cd "$R/sub" && bash "$HELPER" --file 'deep file' --old 'x=1' --new 'x=2' -- sh -c 'cat "deep file" >"$SAW"; false' 2>/dev/null)"
is "2: the directory it stands in is where the file is read and the command runs" "$(val outcome):$(cat "$SAW")" "caught:x=2"

# --- 3: what is refused before anything is written ------------------------------
refused() { # <label> <reason> [args...]
	local label="$1" reason="$2"
	shift 2
	before
	call "$@" -- ./check.sh
	is "3: $label is refused, exit 1" "$RC:$(val outcome):$(val reason)" "1:refused:$reason"
	unrun "3: ...and the command never ran"
	same "3: ...and the repository is as it was"
}
refused "a file with an unstaged edit" uncommitted --file other --old kept --new lost
has "3: ...pointed at the difference before any commit" "$ERR" "\`git diff\` shows the difference"
has "3: ...its uncommitted edit still there" "$(cat "$R/other")" "an uncommitted edit"
refused "an untracked file" untracked --file scratch --old untracked --new x
printf 'staged\n' >>"$R/sub/deep file"
git -C "$R" add "sub/deep file"
refused "a file with a staged edit" uncommitted --file "sub/deep file" --old x=1 --new x=2
git -C "$R" commit -q -m "deep file" -- "sub/deep file"
printf 'limit=3\n' >"$WORKDIR/outside"
refused "a file outside the directory, by an absolute path" outside --file "$WORKDIR/outside" --old limit=3 --new limit=4
is "3: ...which was not written to" "$(cat "$WORKDIR/outside")" "limit=3"
before
OUT="$(cd "$R/sub" && bash "$HELPER" --file ../conf --old limit=3 --new limit=4 -- sh -c ': >"$SAW"' 2>/dev/null)"
is "3: a file above the directory, by a relative path, is refused" "$?:$(val outcome):$(val reason)" "1:refused:outside"
OUT="$(bash "$HELPER" -C "$R/sub" --file "$R/conf" --old limit=3 --new limit=4 -- sh -c ': >"$SAW"' 2>/dev/null)"
is "3: ...and so is one outside what -C named" "$?:$(val reason)" "1:outside"
unrun "3: ...and neither command ran"
same "3: ...and the repository is as it was"
ln -s "$WORKDIR" "$R/way-out"
ln -s conf "$R/conf-link"
refused "a file reached through a symlinked directory" outside --file way-out/outside --old limit=3 --new limit=4
refused "a symlink to a file" not-a-file --file conf-link --old limit=3 --new limit=4
refused "a directory" not-a-file --file sub --old a --new b
refused "a file that is not there" missing --file nowhere --old a --new b
refused "a file in a directory that is not there" missing --file no/where --old a --new b
rm "$R/way-out" "$R/conf-link"
printf 'a\0b\n' >"$R/binary"
git -C "$R" add binary
git -C "$R" commit -q -m binary
refused "a file holding a NUL byte" unreadable --file binary --old a --new c
mkdir "$WORKDIR/plain"
printf 'limit=3\n' >"$WORKDIR/plain/conf"
OUT="$(cd "$WORKDIR/plain" && bash "$HELPER" --file conf --old limit=3 --new limit=4 -- true 2>/dev/null)"
is "3: outside a repository is refused" "$?:$(val outcome):$(val reason)" "1:refused:not-a-repository"
is "3: ...and the file there is untouched" "$(cat "$WORKDIR/plain/conf")" "limit=3"
is "3: no refusal left a temporary file" "$(left)" 0

# --- 4: a command that does not end by itself -----------------------------------
# The command starts a process of its own and records it, so the suite can see
# that stopping the command stopped that too.
# The sleep is short enough that a helper which stops nothing still ends.
HANG='cat conf >"$SAW"; sleep 15 & echo $! >"$1"; wait'
before
start=$(date +%s)
call --timeout 1 --file conf --old 'limit=3' --new 'limit=4' -- sh -c "$HANG" sh "$WORKDIR/pid"
is "4: a command still running at the timeout is timed-out, exit 3" "$RC:$(val outcome):$(val timeout):$(val restored)" "3:timed-out:1:yes"
ok "4: ...without waiting for the command" "$([ $(($(date +%s) - start)) -lt 10 ] && echo 0 || echo 1)"
has "4: ...which had run against the changed file" "$(cat "$SAW" 2>/dev/null)" "limit=4"
gone "$(cat "$WORKDIR/pid")"
ok "4: ...and the process the command started is stopped with it" $?
same "4: ...and the repository is as it was"
is "4: ...with no temporary file left" "$(left)" 0

before
call --timeout 30 --file conf --old 'limit=3' --new 'limit=4' -- ./check.sh
is "4: a command that ends inside its timeout is answered as usual" "$RC:$(val outcome)" "0:caught"
is "4: ...and its timer is not left running" "$(left)" 0

before
call --file conf --old 'limit=3' --new 'limit=4' -- sh -c 'kill -KILL $$'
is "4: a command killed mid-run failed: caught, with the signal in its status" "$RC:$(val outcome):$(val status):$(val restored)" "0:caught:137:yes"
same "4: ...and the repository is as it was"

# Job control around the launch: without it a background job starts with INT
# ignored, which no script can then catch.
for sig in TERM HUP INT; do
	before
	set -m
	(cd "$R" && exec bash "$HELPER" --file conf --old 'limit=3' --new 'limit=4' -- sh -c "$HANG" sh "$WORKDIR/pid") >"$WORKDIR/out" 2>"$WORKDIR/err" &
	helper=$!
	set +m
	n=0
	while [ ! -s "$WORKDIR/pid" ] && [ "$n" -lt 100 ]; do
		sleep 0.1
		n=$((n + 1))
	done
	has "4: SIG$sig arrives while the file is changed" "$(cat "$R/conf")" "limit=4"
	start=$(date +%s)
	kill "-$sig" "$helper"
	wait "$helper"
	RC=$?
	OUT="$(cat "$WORKDIR/out")"
	is "4: a helper stopped by SIG$sig answers interrupted, exit 1" "$RC:$(val outcome):$(val signal):$(val restored)" "1:interrupted:$sig:yes"
	ok "4: ...as soon as the command is stopped, not two seconds on" "$([ $(($(date +%s) - start)) -lt "$PROMPT" ] && echo 0 || echo 1)"
	gone "$(cat "$WORKDIR/pid")"
	ok "4: ...having stopped the command and what it started" $?
	same "4: ...and the repository is as it was"
	is "4: ...with no temporary file left" "$(left)" 0
done

# A command that ends by itself and leaves a process behind, which writes the
# file a second later: after the answer, unless it was stopped first.
for last in 1 0; do
	before
	call --file conf --old 'limit=3' --new 'limit=4' -- sh -c '(sleep 1; echo late >conf) & echo $! >"$1"; exit "$2"' sh "$WORKDIR/pid" "$last"
	is "4: a command that left a process behind and exited $last is answered by its status" "$RC:$(val outcome):$(val restored)" "$([ "$last" = 0 ] && echo 3:missed || echo 0:caught):yes"
	gone "$(cat "$WORKDIR/pid")"
	ok "4: ...the process it left is stopped" $?
	sleep 1.5
	same "4: ...and never wrote the file after it was put back"
done

# --- 5: a file the command took away ---------------------------------------------
before
call --file check.sh --old 'limit=3' --new 'limit=4' -- sh -c 'rm check.sh; false'
is "5: a file the command deleted is put back" "$RC:$(val outcome):$(val restored)" "0:caught:yes"
same "5: ...with its bytes and its executable bit"

before
call --file conf --old 'limit=3' --new 'limit=4' -- sh -c 'rm conf && mkdir conf && false'
is "5: a directory in the file's place cannot be restored: unrestored, exit 1" "$RC:$(val outcome):$(val was)" "1:unrestored:caught"
is "5: ...and nothing claims it was" "$(val restored)" ""
BACKUP="$(val backup)"
is "5: ...the prior bytes are kept where backup= says" "$(cat "$BACKUP" 2>/dev/null)" "$(git -C "$R" show HEAD:conf)"
has "5: ...and stderr says so" "$ERR" "COULD NOT RESTORE conf"
is "5: ...the lock is kept with them, and leads to where they are" "$(val lock):$(cd -P "$LOCK" 2>/dev/null && pwd -P)/original" "$LOCK:$BACKUP"
call --file odd --old 'star' --new 'X' -- false
is "5: ...so the next control is refused, and pointed at the same bytes" "$RC:$(val outcome):$(val reason):$(val backup)" "1:refused:locked:$BACKUP"
rmdir "$R/conf"
cp "$BACKUP" "$R/conf"
same "5: ...which is all it takes to put the repository back"
drop "$BACKUP"

before
call --file conf --old 'mode=strict' --new 'mode=loose' -- sh -c 'rm conf && ln -s other conf'
is "5: a symlink in the file's place is not written through: unrestored" "$RC:$(val outcome):$(val was)" "1:unrestored:missed"
has "5: ...the file it points at untouched" "$(cat "$R/other")" "an uncommitted edit"
BACKUP="$(val backup)"
rm "$R/conf"
cp "$BACKUP" "$R/conf"
same "5: ...and the backup puts the repository back"
drop "$BACKUP"

before
call --file conf --old 'limit=3' --new 'limit=4' -- sh -c 'chmod +x conf; false'
is "5: bytes back but a mode git still reports is unrestored too" "$RC:$(val outcome)" "1:unrestored"
chmod -x "$R/conf"
same "5: ...the bytes themselves being back"
drop "$(val backup)"

# A write the filesystem refuses, which only binds where the mode does.
if [ "$(id -u)" != 0 ]; then
	before
	call --file conf --old 'limit=3' --new 'limit=4' -- sh -c 'chmod a-w conf; false'
	is "5: a file made read-only cannot be restored: unrestored, exit 1" "$RC:$(val outcome)" "1:unrestored"
	BACKUP="$(val backup)"
	chmod u+w "$R/conf"
	cp "$BACKUP" "$R/conf"
	same "5: ...and the backup puts the repository back"
	drop "$BACKUP"
	chmod a-w "$R/conf"
	before
	call --file conf --old 'limit=3' --new 'limit=4' -- ./check.sh
	is "5: a change that cannot be written is refused" "$RC:$(val outcome):$(val reason)" "1:refused:unwritable"
	unrun "5: ...and the command never ran"
	same "5: ...and the repository is as it was"
	chmod u+w "$R/conf"
	chmod a-w "$R/.git"
	call --file conf --old 'limit=3' --new 'limit=4' -- ./check.sh
	chmod u+w "$R/.git"
	is "5: a git directory that takes no lock is refused, and not in silence" "$RC:$(val outcome):$(val reason)" "1:refused:failed"
	unrun "5: ...and the command never ran"
	same "5: ...and the repository is as it was"
fi
is "5: nothing but the kept backups was left" "$(left)" 0

# --- 6: the call itself ----------------------------------------------------------
before
usage() { # <label> [args...]
	local label="$1"
	shift
	call "$@"
	is "6: $label is a usage error" "$RC:$OUT" "64:"
}
usage "no command" --file conf --old 'limit=3' --new 'limit=4'
usage "no command after --" --file conf --old 'limit=3' --new 'limit=4' --
usage "no --file" --old 'limit=3' --new 'limit=4' -- ./check.sh
usage "no --old" --file conf --new 'limit=4' -- ./check.sh
usage "an empty --old" --file conf --old '' --new 'limit=4' -- ./check.sh
usage "no --new" --file conf --old 'limit=3' -- ./check.sh
usage "the same string twice" --file conf --old 'limit=3' --new 'limit=3' -- ./check.sh
usage "a command before --" --file conf --old 'limit=3' --new 'limit=4' ./check.sh
usage "a timeout that is no number" --timeout soon --file conf --old 'limit=3' --new 'limit=4' -- ./check.sh
usage "a timeout of zero" --timeout 0 --file conf --old 'limit=3' --new 'limit=4' -- ./check.sh
usage "a command that does not exist" --file conf --old 'limit=3' --new 'limit=4' -- ./no-such-check.sh
unrun "6: ...and none of them ran the command"
same "6: ...or touched the repository"
for st in 126 127; do
	call --file conf --old 'limit=3' --new 'limit=4' -- sh -c "exit $st"
	is "6: status $st says nothing ran: not-run, exit 3, never caught" "$RC:$(val outcome):$(val status):$(val restored)" "3:not-run:$st:yes"
done
has "6: ...with a word about what that status means" "$ERR" "could not run"
call --file conf --old 'limit=3' --new 'limit=4' -- bash no-such-test.sh
is "6: a test script that is not there is not-run" "$RC:$(val outcome)" "3:not-run"
OUT="$(bash "$HELPER" -C "$R" --file conf --old 'limit=3' --new 'limit=4' -- ./check.sh 2>/dev/null)"
is "6: -C names where the control runs" "$?:$(val outcome)" "0:caught"
OUT="$(bash "$HELPER" -C "$WORKDIR/nowhere" --file conf --old 'limit=3' --new 'limit=4' -- true 2>/dev/null)"
is "6: a -C that cannot be entered is refused, and not in silence" "$?:$(val outcome):$(val reason)" "1:refused:failed"
call --help
is "6: --help exits 0" "$RC" 0
has "6: ...printing the contract" "$OUT" "outcome=unrestored"
OUT="$(cd "$R" && bash "$SHIM" --file conf --old 'limit=3' --new 'limit=4' -- ./check.sh 2>/dev/null)"
is "6: the bin/ shim runs the same script" "$?:$(val outcome)" "0:caught"
same "6: ...and the repository is as it was"
is "6: ...with no temporary file left" "$(left)" 0

# --- 7: one control at a time, and one that was killed -----------------------------
hang() { # start a control on conf that does not end; $helper is its process
	rm -f "$WORKDIR/pid" "$WORKDIR/second"
	(cd "$R" && exec bash "$HELPER" --file conf --old 'limit=3' --new 'limit=4' -- sh -c "$HANG" sh "$WORKDIR/pid") >"$WORKDIR/out1" 2>"$WORKDIR/err1" &
	helper=$!
	n=0
	while [ ! -s "$WORKDIR/pid" ] && [ "$n" -lt 100 ]; do
		sleep 0.1
		n=$((n + 1))
	done
}
SECOND=': >"$1"; false'
held() { cd -P "$LOCK" 2>/dev/null && pwd -P; } # the directory the lock leads to
before
hang
odd="$(cksum <"$R/odd")"
for f in odd conf; do
	call --file "$f" --old 'star' --new 'X' -- sh -c "$SECOND" sh "$WORKDIR/second"
	is "7: a second control while one runs is refused as locked, with what the lock records ($f)" "$RC:$(val outcome):$(val reason):$(val holder):$(val holder-running):$(val lock):$(val backup)" "1:refused:locked:$helper:yes:$LOCK:$(held)/original"
done
has "7: ...told that a process with that number is running" "$ERR" "It records process $helper, and a process with that number is running here now"
has "7: ...and to wait for it" "$ERR" "While that control is running, wait for it and run this again."
ok "7: ...its command never ran" "$([ ! -e "$WORKDIR/second" ] && echo 0 || echo 1)"
is "7: ...its file is untouched" "$(cksum <"$R/odd")" "$odd"
has "7: ...and the first still has its change in place" "$(cat "$R/conf")" "limit=4"
kill -TERM "$helper"
wait "$helper"
is "7: ...and ends as it would have" "$?:$(sed -n 1p "$WORKDIR/out1")" "1:outcome=interrupted"
gone "$(cat "$WORKDIR/pid")"
same "7: ...and the repository is as it was"
is "7: ...with no lock left" "$(left)" 0

before
hang
{ kill -KILL "$helper" && wait "$helper"; } 2>/dev/null
kill "$(cat "$WORKDIR/pid")" 2>/dev/null
gone "$(cat "$WORKDIR/pid")"
has "7: a helper killed outright leaves the file changed" "$(cat "$R/conf")" "limit=4"
DIR="$(held)"
for f in conf odd; do
	call --file "$f" --old 'limit=4' --new 'limit=5' -- sh -c "$SECOND" sh "$WORKDIR/second"
	is "7: ...and the next control is refused as locked, not as uncommitted ($f)" "$RC:$(val outcome):$(val reason):$(val holder):$(val holder-running):$(val lock):$(val backup)" "1:refused:locked:$helper:no:$LOCK:$DIR/original"
done
has "7: ...told that no such process is running" "$ERR" "It records process $helper, and no process with that number is running here now"
has "7: ...that this settles nothing" "$ERR" "which settles nothing by itself"
has "7: ...where the bytes its file had are, and when to put them back" "$ERR" "Only where it is running nowhere (it was killed, or its machine went down): copy $DIR/original back over $R/conf"
has "7: ...not to commit what it left, and only then to remove the lock" "$ERR" "never commit that change, and then remove $LOCK and $DIR."
case "$ERR" in *"ommit it first"*) ok "7: ...nor anything about committing first" 1 ;; *) ok "7: ...nor anything about committing first" 0 ;; esac
ok "7: ...its command never ran" "$([ ! -e "$WORKDIR/second" ] && echo 0 || echo 1)"
has "7: ...and the helper removed and restored nothing itself" "$(cat "$R/conf" "$LOCK/pid")" "limit=4"
is "7: ...the bytes the file had are where backup= says" "$(cat "$(val backup)")" "$(git -C "$R" show HEAD:conf)"
cp "$(val backup)" "$R/conf"
drop "$(val backup)"
same "7: ...and doing what it said puts the repository back"
call --file conf --old 'limit=3' --new 'limit=4' -- ./check.sh
is "7: ...after which a control runs again" "$RC:$(val outcome)" "0:caught"

# A linked worktree's git directory is not `.git`: the lock goes to its own.
git -C "$R" worktree add -q "$WORKDIR/wt" HEAD 2>/dev/null
OUT="$(bash "$HELPER" -C "$WORKDIR/wt" --file conf --old 'limit=3' --new 'limit=4' -- sh -c '{ ls -d "$1"; git status --porcelain; } >"$SAW" 2>&1; false' sh "$R/.git/worktrees/wt/perturb.lock" 2>/dev/null)"
is "7: in a linked worktree a control runs" "$?:$(val outcome)" "0:caught"
is "7: ...its lock in that worktree's git directory, and only the change in git's sight" "$(cat "$SAW")" "$R/.git/worktrees/wt/perturb.lock
 M conf"
is "7: ...and gone afterwards, the worktree clean" "$(find "$R/.git/worktrees/wt" -name 'perturb.*' | wc -l | tr -d ' '):$(git -C "$WORKDIR/wt" status --porcelain)" "0:"
git -C "$R" worktree remove "$WORKDIR/wt"
same "7: ...and the repository is as it was"
is "7: ...with nothing left" "$(left)" 0

# --- 8: every state a second control can find the lock in --------------------------
# Absent, held by a running control, and left by a killed one with its copy are
# section 7's. A lock is whole while it stands, so what is left is one that
# goes or changes hands while it is read, one recorded under a process number
# that is gone or now another's, and what only a hand can put at its name.
sleep 60 &
live=$!
true &
dead=$!
wait "$dead"
lock_by() { # <pid>: a lock as a control with that process would have made it
	mkdir "$R/.git/perturb.byhand"
	printf '%s\n' "$R/odd" >"$R/.git/perturb.byhand/target"
	printf '%s\n' "$1" >"$R/.git/perturb.byhand/pid"
	ln -s perturb.byhand "$LOCK"
}
unlock() { rm -rf "$LOCK" "$R/.git/perturb.byhand" "$R/.git/perturb.other"; }

# The lock is read, and looked at again after the reading: `readlink` here
# takes it away, or hands it to another control, once it has answered.
before
for then in 'rm -f "$1"' 'rm -f "$1"; ln -s perturb.other "$1"'; do
	lock_by "$live"
	shim readlink "$then"
	shimmed --file conf --old 'limit=3' --new 'limit=4' -- sh -c "$SECOND" sh "$WORKDIR/second"
	is "8: a lock that went or changed hands while it was read is refused with nothing said of a holder" "$RC:$(val outcome):$(val reason):$(val lock):$(val holder):$(val holder-running)" "1:refused:locked:$LOCK::"
	has "8: ...and the control is to be run again" "$ERR" "run this again"
	case "$ERR" in *"emove $LOCK"*) ok "8: ...with no word of removing anything" 1 ;; *) ok "8: ...with no word of removing anything" 0 ;; esac
	unlock
done

# A lock is whole from the moment it stands: a second control started by the
# first one's own `ln`, as soon as the link is made, reads all of it.
cat >"$WORKDIR/second.sh" <<SECOND_SH
#!/bin/sh
echo "\$1" >"$WORKDIR/first"
cd "$R" && bash "$HELPER" --file odd --old star --new X -- sh -c '$SECOND' sh "$WORKDIR/second" >"$WORKDIR/out2" 2>/dev/null
SECOND_SH
chmod +x "$WORKDIR/second.sh"
export SECOND_SH="$WORKDIR/second.sh"
shim ln '[ -e "$SAW.sent" ] || case "$*" in *perturb.lock) : >"$SAW.sent"; "$SECOND_SH" "$PPID" ;; esac'
shimmed --file conf --old 'limit=3' --new 'limit=4' -- ./check.sh
rm -f "$SAW.sent"
is "8: a second control started the moment the first one's lock is made reads the whole of it" "$(tr '\n' ' ' <"$WORKDIR/out2")" "outcome=refused file=odd reason=locked lock=$LOCK holder=$(cat "$WORKDIR/first") holder-running=yes "
is "8: ...and the first runs as it would have" "$RC:$(val outcome):$(val restored)" "0:caught:yes"

lock_by "$dead"
call --file conf --old 'limit=3' --new 'limit=4' -- sh -c "$SECOND" sh "$WORKDIR/second"
is "8: a lock whose process is gone and which holds no copy has no backup to name" "$RC:$(val reason):$(val holder):$(val holder-running):$(val backup)" "1:locked:$dead:no:"
has "8: ...said to have kept none, with where a change would show all the same" "$ERR" "it kept no copy of $R/odd, so it changed nothing unless the copy was removed since, and \`git diff\` shows such a change to undo"
ok "8: ...and is left for the caller to remove" "$([ -L "$LOCK" ] && [ -d "$R/.git/perturb.byhand" ] && echo 0 || echo 1)"
unlock

# What this script never leaves at the lock's name: a directory, and a link
# that leads nowhere.
mkdir "$LOCK"
call --file conf --old 'limit=3' --new 'limit=4' -- sh -c "$SECOND" sh "$WORKDIR/second"
is "8: a directory at the lock's name is no lock taken: refused, with no holder to name" "$RC:$(val reason):$(val holder):$(val backup)" "1:locked::"
has "8: ...said to record no process" "$ERR" "It records no process"
is "8: ...and left as it was, with nothing put inside it" "$(ls -A "$LOCK")" ""
rmdir "$LOCK"
ln -s perturb.nowhere "$LOCK"
call --file conf --old 'limit=3' --new 'limit=4' -- sh -c "$SECOND" sh "$WORKDIR/second"
is "8: a link that leads nowhere is refused the same way" "$RC:$(val reason):$(val holder):$(val backup)" "1:locked::"
ok "8: ...and left for the caller to remove" "$([ -L "$LOCK" ] && echo 0 || echo 1)"
case "$ERR" in *"Only where it is running nowhere"*"then remove $LOCK."*) ok "8: ...which it is told to do only where no control is running" 0 ;; *) ok "8: ...which it is told to do only where no control is running" 1 ;; esac
unlock
ok "8: ...and none of these ran the second command" "$([ ! -e "$WORKDIR/second" ] && echo 0 || echo 1)"
same "8: ...and the repository is as it was"
is "8: ...with nothing of the second control left" "$(left)" 0

# A killed control's process number, taken by another process: the facts are
# the same but for that one, and so is what to do.
before
hang
{ kill -KILL "$helper" && wait "$helper"; } 2>/dev/null
kill "$(cat "$WORKDIR/pid")" 2>/dev/null
gone "$(cat "$WORKDIR/pid")"
DIR="$(held)"
printf '%s\n' "$live" >"$DIR/pid"
call --file odd --old 'star' --new 'X' -- sh -c "$SECOND" sh "$WORKDIR/second"
is "8: a killed control's lock under a process number now another's says that one is running, and still names the copy" "$RC:$(val reason):$(val holder):$(val holder-running):$(val lock):$(val backup)" "1:locked:$live:yes:$LOCK:$DIR/original"
has "8: ...told that the number settles nothing" "$ERR" "which settles nothing by itself: a process number passes to other processes"
has "8: ...and what to do where the control runs nowhere" "$ERR" "copy $DIR/original back over $R/conf"
has "8: ...and not to commit what it left" "$ERR" "never commit that change"
case "$ERR" in *"ommit it first"*) ok "8: ...nor anything about committing first" 1 ;; *) ok "8: ...nor anything about committing first" 0 ;; esac
cp "$(val backup)" "$WORKDIR/kept"
drop "$(val backup)"
call --file conf --old 'limit=4' --new 'limit=5' -- sh -c "$SECOND" sh "$WORKDIR/second"
is "8: ...with the lock removed and the change still there, the file is refused as uncommitted" "$RC:$(val reason)" "1:uncommitted"
has "8: ...and what a stopped control left is to be undone, not committed" "$ERR" "where it is what a control that was stopped left behind, undo it and do not commit it"
ok "8: ...its command never ran" "$([ ! -e "$WORKDIR/second" ] && echo 0 || echo 1)"
cp "$WORKDIR/kept" "$R/conf"
same "8: ...and the kept bytes put the repository back"

# A signal at the two moments a run could be caught with nothing said: before
# anything else has run, and as the lock is made.
before
shim git '[ -e "$SAW.sent" ] || { : >"$SAW.sent"; kill -TERM "$PPID"; }'
shimmed --file conf --old 'limit=3' --new 'limit=4' -- ./check.sh
rm -f "$SAW.sent"
is "8: a signal that arrives with the first thing the helper runs is answered interrupted" "$RC:$(val outcome):$(val signal):$(val restored)" "1:interrupted:TERM:"
unrun "8: ...the command never ran"
shim ln 'case "$*" in *perturb.lock) kill -TERM "$PPID" ;; esac'
shimmed --file conf --old 'limit=3' --new 'limit=4' -- ./check.sh
is "8: a signal that arrives as the lock is made is answered interrupted" "$RC:$(val outcome):$(val signal):$(val restored)" "1:interrupted:TERM:"
unrun "8: ...the command never ran"
is "8: ...and the lock it had just made is not left behind" "$(left)" 0
same "8: ...and the repository is as it was"

# --- 9: the lock or the copy taken from under a running control ---------------------
# The file is put back from the control's own copy whatever became of the lock,
# and is never opened for writing with nothing to write: with the copy gone it
# stays as the control changed it, which git shows, and is not emptied.
undo() { git -C "$R" show HEAD:conf >"$R/conf"; }
before
call --file conf --old 'limit=3' --new 'limit=4' -- sh -c 'rm "$1"; false' sh "$LOCK"
is "9: a control whose lock was removed as it ran still puts its file back" "$RC:$(val outcome):$(val restored)" "0:caught:yes"
has "9: ...and says the lock was no longer its own" "$ERR" "was removed or taken over while this control ran"
same "9: ...and the repository is as it was"
is "9: ...with nothing left" "$(left)" 0

# The lock removed and taken by another control, with a copy of its own.
before
call --file conf --old 'limit=3' --new 'limit=4' -- sh -c 'rm "$1" && mkdir "$1.d" && echo 1 >"$1.d/pid" && echo other >"$1.d/original" && ln -s perturb.lock.d "$1"; false' sh "$LOCK"
is "9: a control whose lock is another's by now puts its file back from its own copy" "$RC:$(val outcome):$(val restored)" "0:caught:yes"
has "9: ...and says the lock was no longer its own" "$ERR" "What stands there now was left alone"
is "9: ...the other control's lock and copy left alone" "$(readlink "$LOCK"):$(cat "$LOCK/pid" "$LOCK/original" 2>&1)" "perturb.lock.d:1
other"
rm -r "$LOCK.d"
rm "$LOCK"
same "9: ...and the repository is as it was, without the other control's bytes"
is "9: ...with nothing left" "$(left)" 0

before
call --file conf --old 'limit=3' --new 'limit=4' -- sh -c 'rm -r "$(cd -P "$1" && pwd -P)"; false' sh "$LOCK"
is "9: a control whose directory was removed as it ran is unrestored, naming no copy and no lock" "$RC:$(val outcome):$(val was):$(val backup):$(val lock):$(val restored)" "1:unrestored:caught:::"
is "9: ...its file left as it stood, not emptied" "$(cat "$R/conf")" "$(git -C "$R" show HEAD:conf | sed 's/^limit=3$/limit=4/')"
has "9: ...told that the copy was removed" "$ERR" "was removed while this control ran"
has "9: ...and what git reports of the file" "$ERR" "git now reports it changed"
case "$ERR" in *"then remove"* | *"Remove "*) ok "9: ...and not told to remove anything" 1 ;; *) ok "9: ...and not told to remove anything" 0 ;; esac
undo
same "9: ...and undoing what git shows puts the repository back"
is "9: ...with nothing left, the lock that led nowhere included" "$(left)" 0

before
call --file conf --old 'limit=3' --new 'limit=4' -- sh -c 'rm "$1/original"; false' sh "$LOCK"
is "9: a control whose copy alone was removed is unrestored too" "$RC:$(val outcome):$(val backup):$(val lock)" "1:unrestored::"
has "9: ...its file left as it stood" "$(cat "$R/conf")" "limit=4"
is "9: ...and its lock, which holds nothing now, is not kept" "$(left)" 0
call --file conf --old 'limit=4' --new 'limit=5' -- sh -c "$SECOND" sh "$WORKDIR/second"
is "9: ...so the next control is refused for the change itself" "$RC:$(val reason)" "1:uncommitted"
undo
same "9: ...and undoing what git shows puts the repository back"

# The same where the change is written: the directory goes just before, at the
# helper's last look at the changed bytes, and the file must not be opened.
before
shim cmp 'case "$2" in */changed) rm -r "${2%/changed}" ;; esac'
shimmed --file conf --old 'limit=3' --new 'limit=4' -- ./check.sh
is "9: a control whose directory was removed before it wrote its change writes nothing" "$RC:$(val outcome):$(val was):$(val backup)" "1:unrestored:refused:"
has "9: ...and says git reports the file as its commit has it" "$ERR" "git now reports it still as its commit has it"
unrun "9: ...the command never ran"
same "9: ...and the file was never emptied: the repository is as it was"
ok "9: ...and none of these ran a second command" "$([ ! -e "$WORKDIR/second" ] && echo 0 || echo 1)"
is "9: ...with nothing left" "$(left)" 0
kill "$live" 2>/dev/null
wait "$live" 2>/dev/null

ok "6: the Codex mirror is byte-identical" "$(cmp -s "$SHIPPED" "$MIRROR" && echo 0 || echo 1)"

if [ "$fails" -gt 0 ]; then
	printf 'review-cycle perturb helper test FAILED (%s of %s checks).\n' "$fails" "$checks" >&2
	exit 1
fi
printf 'review-cycle perturb helper test passed (%s checks).\n' "$checks"
