<#
.SYNOPSIS
    Import the MSVC x64 developer environment into the current PowerShell session.

.DESCRIPTION
    Why this exists.

    `cc-rs` (the crate ring and libsqlite3-sys build with) discovers the Visual C++ toolchain by
    itself, so `cargo build` normally works from a plain shell. What a plain shell cannot give you is
    the *environment* the MSVC tools expect: `INCLUDE`, `LIB`, `PATH` and `WindowsSdkDir`. Without
    them a C compile started by hand — `cl curve25519.c`, `dumpbin /imports`, a `cdb` walk over a
    crash dump — fails with `fatal error C1083: Cannot open include file: 'stddef.h'`.

    Dot-source this script to get the same environment a "x64 Native Tools Command Prompt for VS"
    has, inside the session you already have:

        . .\scripts\windows-msvc-env.ps1

    It imports every variable `vcvars64.bat` sets, collapses the duplicated `PATH` entries that
    repeated `vcvars` imports pile up (this repo's shell had 17 duplicates), then proves the
    toolchain works by compiling a one-line C file in `%TEMP%` and deleting it again. Run it with
    `-File` and the import ends with that process; the check still tells you whether MSVC works.
    A trailing command runs inside the imported environment and its exit code becomes the
    script's (with `-File` it is passed as a quoted string):

        pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\windows-msvc-env.ps1 '{ cargo build }'

    One MSVC defect is handled in the repository instead of here: `cl.exe` 14.44 fails with
    `D8050 : cannot execute 'c1.dll'` on ring's C sources when `cc-rs` passes `-Z7`, so
    `.cargo/config.toml` switches debug info off for the two crates that compile C. Only Windows
    needs either piece; see docs/DEVELOPERS.md.

.EXAMPLE
    . .\scripts\windows-msvc-env.ps1
    Import the MSVC x64 environment into this session, then run `cargo build`.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\windows-msvc-env.ps1
    Report whether MSVC compiles C code on this machine, without keeping the environment.

.EXAMPLE
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\windows-msvc-env.ps1 '{ cl /nologo probe.c }'
    Import the environment, then run the trailing command inside it; its exit code is returned.
#>
[CmdletBinding()]
param(
    # A scriptblock when dot-sourced; `-File` passes every argument as a string, so a string is
    # accepted too and compiled into a scriptblock below.
    [object]$Command
)

$ErrorActionPreference = 'Stop'

if ($Command -is [string]) {
    # `-File` passes the argument as a string. Strip one optional `{ ... }` wrapper: Create()
    # would otherwise parse it as a scriptblock *literal*, which returns the inner scriptblock
    # as an object instead of running the code.
    $text = $Command.Trim()
    if ($text.StartsWith('{') -and $text.EndsWith('}')) {
        $text = $text.Substring(1, $text.Length - 2)
    }
    $Command = [scriptblock]::Create($text)
}
elseif ($Command -and $Command -isnot [scriptblock]) {
    throw "Command must be a scriptblock or a string containing PowerShell code (got $($Command.GetType().Name))."
}

# `exit` in a dot-sourced script closes the caller's own session, so the exit code is returned
# through a function instead and only turned into an `exit` for a normal script invocation.
$script:DotSourced = $MyInvocation.InvocationName -eq '.'

function Get-VcVarsPath {
    <# The `vcvars64.bat` of the newest Visual Studio / Build Tools installation that has the x64 C++ tools. #>
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (Test-Path $vswhere) {
        $install = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
        if ($LASTEXITCODE -eq 0 -and $install) {
            $candidate = Join-Path ($install | Select-Object -First 1) 'VC\Auxiliary\Build\vcvars64.bat'
            if (Test-Path $candidate) { return $candidate }
        }
    }

    # No vswhere result: fall back to the conventional installations.
    $roots = @(
        (Join-Path $env:ProgramFiles 'Microsoft Visual Studio\2022'),
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\2022'),
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\2019')
    )
    foreach ($root in $roots) {
        if (-not (Test-Path $root)) { continue }
        foreach ($edition in @('Enterprise', 'Professional', 'Community', 'BuildTools')) {
            $candidate = Join-Path $root "$edition\VC\Auxiliary\Build\vcvars64.bat"
            if (Test-Path $candidate) { return $candidate }
        }
    }

    return $null
}

function Import-VcVars {
    <#
        Runs `vcvars64.bat` in cmd and copies every variable it sets into this process: the batch
        file exports to its own process only, so reading `set` output is the supported way.

        Two shell hazards are avoided here. A global npm package can own a `cmd` shim that shadows
        cmd.exe on PATH (its CLI answers `cmd /c ...` with "too many arguments"), so cmd is invoked
        by its full System32 path. And the vcvars output goes to a temp file, not `>nul`: an MSYS
        layer (Git Bash) rewrites a `nul` token in the command line to `/dev/null`, which cmd
        cannot open — "The system cannot find the path specified", exit 1.
    #>
    param([Parameter(Mandatory)][string]$Path)

    $cmdExe = Join-Path $env:SystemRoot 'System32\cmd.exe'
    $log = Join-Path ([System.IO.Path]::GetTempPath()) ('warsha-vcvars-' + [guid]::NewGuid().ToString('N') + '.log')
    try {
        $lines = & $cmdExe /c "call `"$Path`" >`"$log`" 2>&1 && set"
        $code = $LASTEXITCODE
        if ($code -ne 0) {
            $detail = ''
            if (Test-Path $log) {
                $detail = ((Get-Content $log -Tail 5 | ForEach-Object { "$_".Trim() }) -join ' ')
            }
            throw "vcvars64.bat failed with exit code $code ($Path). $detail"
        }

        $imported = 0
        foreach ($line in $lines) {
            if ($line -notmatch '^([^=]+)=(.*)$') { continue }
            Set-Item -Path "env:$($Matches[1])" -Value $Matches[2]
            $imported++
        }
        return $imported
    }
    finally {
        Remove-Item $log -ErrorAction SilentlyContinue
    }
}

function Compress-PathVariable {
    <# Drops empty and repeated entries from PATH; every repeated vcvars import appends its directories again. #>
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $entries = @($env:PATH -split ';' | Where-Object { $_ })
    $kept = foreach ($entry in $entries) {
        if ($seen.Add($entry.TrimEnd('\'))) { $entry }
    }
    $env:PATH = ($kept -join ';')
    return $entries.Count - @($kept).Count
}

function Test-CCompiler {
    <#
        Compiles one C file with `cl.exe` in %TEMP%. A compiler that is on PATH without a usable
        INCLUDE/LIB fails here with C1083 or LNK1104 — the states a developer would otherwise hit
        halfway through `cargo build`.
    #>
    $dir = Join-Path ([System.IO.Path]::GetTempPath()) ('warsha-msvc-check-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $dir | Out-Null
    try {
        Set-Content -Path (Join-Path $dir 'probe.c') -Encoding Ascii -Value @'
#include <stddef.h>
int main(void) { return (int)sizeof(size_t) == 0; }
'@
        Push-Location $dir
        try {
            $output = & cl.exe /nologo /c probe.c 2>&1
            $code = $LASTEXITCODE
        }
        finally {
            Pop-Location
        }
        if ($code -ne 0) {
            return @{ Ok = $false; Detail = (($output | ForEach-Object { "$_".Trim() }) -join ' ') }
        }
        return @{ Ok = $true; Detail = '' }
    }
    finally {
        Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue
    }
}

function Invoke-MsvcEnv {
    $vcvars = Get-VcVarsPath
    if (-not $vcvars) {
        Write-Host 'FAIL  no Visual Studio installation with the x64 C++ tools was found (no VC\Auxiliary\Build\vcvars64.bat).' -ForegroundColor Red
        Write-Host '      Install "Desktop development with C++" from the Visual Studio Installer.' -ForegroundColor Yellow
        return 1
    }

    $imported = Import-VcVars -Path $vcvars
    $removed = Compress-PathVariable
    Write-Host "Imported $imported variables from $vcvars" -ForegroundColor Cyan
    if ($removed -gt 0) {
        Write-Host "Collapsed $removed duplicate PATH entries" -ForegroundColor Cyan
    }

    $problems = @()

    $cl = Get-Command cl.exe -ErrorAction SilentlyContinue
    if (-not $cl) {
        $problems += 'cl.exe is not on PATH'
    }
    else {
        # `/Bv` is the MSVC option that prints the compiler version and stops.
        $banner = ((& $cl.Source /Bv 2>&1 | Select-Object -First 1) -join '').Trim()
        Write-Host "cl.exe       $($cl.Source)" -ForegroundColor Cyan
        Write-Host "             $banner" -ForegroundColor Cyan
    }

    $link = Get-Command link.exe -ErrorAction SilentlyContinue
    if (-not $link) {
        $problems += 'link.exe is not on PATH'
    }
    else {
        Write-Host "link.exe     $($link.Source)" -ForegroundColor Cyan
    }

    if ($env:WindowsSdkDir) {
        Write-Host "Windows SDK  $env:WindowsSdkDir$($env:WindowsSDKVersion)" -ForegroundColor Cyan
    }

    if ($cl) {
        $probe = Test-CCompiler
        if (-not $probe.Ok) {
            $problems += "cl.exe cannot compile a one-line C file: $($probe.Detail)"
        }
    }

    foreach ($problem in $problems) {
        Write-Host "FAIL  $problem" -ForegroundColor Red
    }
    if ($problems.Count -gt 0) {
        return 1
    }

    Write-Host 'PASS  the MSVC x64 environment is imported and compiles C code' -ForegroundColor Green
    return 0
}

$result = Invoke-MsvcEnv

if ($result -eq 0 -and $Command) {
    Write-Host "Running in the imported environment: $Command" -ForegroundColor Cyan
    $global:LASTEXITCODE = 0
    & $Command
    $commandCode = $LASTEXITCODE
    if ($null -eq $commandCode) { $commandCode = 0 }
    if ($commandCode -ne 0) {
        Write-Host "FAIL  the trailing command exited with code $commandCode" -ForegroundColor Red
    }
    $result = $commandCode
}

if (-not $script:DotSourced) {
    exit $result
}
