@echo off
setlocal enabledelayedexpansion

if "%~1"=="" (
    echo Usage: gt "commit message"
    echo        gt --empty
    exit /b 1
)

if "%~1"=="--empty" (
    git add -A || exit /b 1
    git commit --allow-empty -m "Empty Push" || exit /b 1
    call :sync_push || exit /b 1
    echo Done.....
    exit /b 0
)

REM -A rather than . so the whole worktree is staged regardless of which directory
REM gt was run from. With "git add .", running it from api/ left changes elsewhere
REM unstaged, and the rebase below then refused to start on a dirty tree.
git add -A || exit /b 1

REM Nothing staged is not a failure. There may still be local commits that never got
REM pushed - a rejected push last time round leaves exactly that state - so fall
REM through to the sync instead of aborting and leaving them stranded.
git diff --cached --quiet
if not errorlevel 1 (
    echo No staged changes - syncing any unpushed commits.
) else (
    git commit -m %1 || exit /b 1
)

call :sync_push || exit /b 1

echo Done.....
exit /b 0


:sync_push
REM bump-version.yml pushes a "chore: bump to vX [skip ci]" commit to main after every
REM push. It is gated behind an integrity job that runs the full suite first, so the bot's
REM commit lands roughly 60-90 seconds later - not instantly.
REM
REM That matters because pull and push are two operations, and the bump can land in the
REM gap between them. A single pull-then-push handles a bump that has ALREADY landed and
REM is powerless against one that lands mid-flight: the push is rejected for being behind,
REM which is not a conflict and needs no intervention, only another go round.
set /a gt_attempt=0

:gt_retry
set /a gt_attempt+=1

REM --autostash so a stray unstaged file (a build artefact, an editor's scratch write)
REM cannot abort the rebase. It is put back afterwards either way.
git pull --rebase --autostash
if errorlevel 1 (
    echo.
    echo Rebase stopped on a real conflict - the bump only touches version.json, so this
    echo is something else. Resolve it, then run:
    echo     git rebase --continue ^&^& git push
    echo Or abandon the rebase with:  git rebase --abort
    exit /b 1
)

git push
if not errorlevel 1 exit /b 0

if !gt_attempt! GEQ 5 (
    echo.
    echo Push still rejected after !gt_attempt! attempts. That is more than the version
    echo bot accounts for - check whether something else is pushing to main.
    exit /b 1
)

echo Push rejected - a commit landed while we were pushing. Retrying ^(!gt_attempt!/5^)...
timeout /t 3 /nobreak >nul 2>&1
goto :gt_retry
