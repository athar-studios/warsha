<#
.SYNOPSIS
    Windows-native dependency install for Warsha, with a Storybook binary check.

.DESCRIPTION
    Why this exists.

    pnpm writes the `node_modules/.bin` launchers for the platform it is *running on*. This project
    is validated in WSL, but the working copy lives on the Windows drive, so an install started from
    WSL against this tree (or any Linux shell on a shared /mnt/c path) leaves POSIX shell scripts in
    `node_modules/.bin` and no `.cmd` / `.ps1` launcher at all. On Windows every workspace CLI then
    fails the same way — `tsc`, `vite`, `vitest`, `eslint` and `storybook`:

        'storybook' is not recognized as an internal or external command,
        operable program or batch file.
        ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @warsha/ui@0.1.0 storybook:
        `storybook dev -p 6006 --no-open`

    "Storybook has no working binary on Windows" is that state, not a missing package: the CLI is
    installed, its launcher belongs to the other operating system.

    This script installs on Windows itself. It needs no globally installed pnpm: it uses the pnpm
    corepack already cached under `%LOCALAPPDATA%\pnpm\.tools`, or falls back to `npx pnpm@9.0.0`,
    which downloads nothing into the global prefix. Afterwards it proves the binaries run, so the
    broken state is reported in one line instead of surfacing later as a confusing `tsc` failure.

.PARAMETER Check
    Verify only — do not install. Exits 1 with the reason when the launchers belong to another
    operating system.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\windows-setup.ps1
    Install on Windows and check the Storybook binary.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\windows-setup.ps1 -Check
    Report whether the installed binaries are usable from Windows.
#>
[CmdletBinding()]
param(
    [switch]$Check
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$uiBin = Join-Path $root 'packages\ui\node_modules\.bin'

function Get-PnpmCommand {
    <#
        The pnpm this repo pins (`packageManager: pnpm@9.0.0`), found without a global install:
        the corepack tool cache first, then `npx --yes`, which runs it from the npx cache.
    #>
    $cached = Join-Path $env:LOCALAPPDATA 'pnpm\.tools\pnpm\9.0.0\bin\pnpm.CMD'
    if (Test-Path $cached) {
        return @{ File = $cached; Prefix = @() }
    }
    $npx = Get-Command npx -ErrorAction SilentlyContinue
    if ($npx) {
        return @{ File = $npx.Source; Prefix = @('--yes', 'pnpm@9.0.0') }
    }
    throw "No pnpm found. Install Node 20+ (which ships npx) and re-run, or run 'npx --yes pnpm@9.0.0 install --frozen-lockfile' yourself."
}

function Test-Launchers {
    <#
        Returns the list of problems that stop the workspace CLIs from running on Windows.
    #>
    $problems = @()

    foreach ($required in @('storybook', 'tsc', 'vite', 'vitest')) {
        $launcher = Join-Path $uiBin "$required.cmd"
        $posix = Join-Path $uiBin $required
        if (-not (Test-Path $launcher)) {
            if (Test-Path $posix) {
                $problems += "$required.cmd is missing (a POSIX '$required' script is there instead — this tree was installed by pnpm running on Linux)"
            }
            else {
                $problems += "$required.cmd is missing (nothing installed — run this script without -Check)"
            }
        }
    }

    return $problems
}

function Get-StorybookVersion {
    <# Runs the Storybook CLI the way `pnpm --filter @warsha/ui storybook` would, and reads the version. #>
    $launcher = Join-Path $uiBin 'storybook.cmd'
    if (-not (Test-Path $launcher)) { return $null }
    Push-Location (Join-Path $root 'packages\ui')
    try {
        $output = & $launcher --version 2>&1
        if ($LASTEXITCODE -ne 0) { return $null }
        # The CLI is chatty on stderr; the version is the line that looks like one.
        return ($output | Where-Object { $_ -match '^\d+\.\d+\.\d+' } | Select-Object -First 1)
    }
    finally {
        Pop-Location
    }
}

Write-Host "Warsha Windows setup — $root" -ForegroundColor Cyan

if (-not $Check) {
    if (-not (Test-Path (Join-Path $root 'pnpm-lock.yaml'))) {
        throw "pnpm-lock.yaml not found in $root — run this script from the repository."
    }

    $pnpm = Get-PnpmCommand
    Write-Host "`n=== pnpm install --frozen-lockfile ($($pnpm.File)) ===" -ForegroundColor Cyan
    # `confirm-modules-purge=false` because this is exactly the tree pnpm wants to ask about: it was
    # installed on another platform, so pnpm stops at "The modules directories will be removed and
    # reinstalled from scratch. Proceed?" — a question this script is the answer to. Without the flag
    # the install waits for input that never comes and the launchers are never written.
    # `Out-Host` so the install's progress is printed before the check below, not after it.
    & $pnpm.File @($pnpm.Prefix) 'install' '--frozen-lockfile' '--config.confirm-modules-purge=false' '--dir' $root 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "pnpm install failed with exit code $LASTEXITCODE."
    }
}

Write-Host "`n=== binary check ===" -ForegroundColor Cyan
$problems = Test-Launchers
foreach ($problem in $problems) {
    Write-Host "FAIL  $problem" -ForegroundColor Red
}
if ($problems.Count -gt 0) {
    Write-Host "`nRe-run this script without -Check to install on Windows. Do not run 'pnpm install' from WSL against this Windows copy: it rewrites node_modules/.bin for Linux." -ForegroundColor Yellow
    exit 1
}

$version = Get-StorybookVersion
if (-not $version) {
    Write-Host 'FAIL  storybook.cmd exists but did not report a version' -ForegroundColor Red
    exit 1
}

Write-Host "PASS  node_modules/.bin has Windows launchers for storybook, tsc, vite and vitest" -ForegroundColor Green
Write-Host "PASS  storybook --version reports $version" -ForegroundColor Green
exit 0
