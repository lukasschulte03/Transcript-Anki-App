@echo off
setlocal

set "LECTIO_CODEX_RUNTIME=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies"
set "LECTIO_PNPM_DIR=%LECTIO_CODEX_RUNTIME%\bin\fallback"
set "LECTIO_NODE_DIR=%LECTIO_CODEX_RUNTIME%\node\bin"
set "LECTIO_CARGO_DIR=%USERPROFILE%\.cargo\bin"

if not exist "%LECTIO_PNPM_DIR%\pnpm.cmd" (
  echo [Lectio] pnpm hittades inte i Codex utvecklingsmiljo.
  echo Installera Node.js LTS och kor sedan: corepack enable
  pause
  exit /b 1
)

if not exist "%LECTIO_CARGO_DIR%\cargo.exe" (
  echo [Lectio] Rust hittades inte i %LECTIO_CARGO_DIR%.
  echo Installera Rust fran https://rustup.rs och forsok igen.
  pause
  exit /b 1
)

set "PATH=%LECTIO_PNPM_DIR%;%LECTIO_NODE_DIR%;%LECTIO_CARGO_DIR%;%PATH%"
cd /d "%~dp0"

if /i "%~1"=="--check" (
  echo [Lectio] Utvecklingsmiljon ar redo.
  where node
  where pnpm
  where cargo
  exit /b 0
)

echo [Lectio] Startar utvecklingsversionen...
echo Frontendandringar laddas automatiskt. Avsluta med Ctrl+C.
call pnpm desktop:dev

