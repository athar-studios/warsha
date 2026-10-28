# scripts/wsl-bootstrap.ps1 — run in an ELEVATED Windows PowerShell (admin).
#
#   1. ensures WSL2 is installed, 2. installs Ubuntu, 3. copies the project to
#   ~/warsha inside WSL (including .git), 4. runs scripts/wsl-setup.sh there.
#
# After first run, ~/warsha in WSL is the SINGLE SOURCE OF TRUTH.
# All further development: edit files in WSL, run via:
#   wsl -d Ubuntu -- bash -lc "cd ~/warsha && <command>"
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\wsl-bootstrap.ps1
#
# A reboot may be required after step 1 (WSL2 kernel / VirtualMachinePlatform).
# Re-run the script after rebooting; it is idempotent.

$ErrorActionPreference = 'Stop'
$Source = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Write-Host "Project source (Windows): $Source" -ForegroundColor Cyan
Write-Host "Target (WSL single source of truth): ~/warsha" -ForegroundColor Cyan

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    (New-Object Security.Principal.WindowsPrincipal $id).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}
if (-not (Test-Admin)) { throw 'Run this script from an elevated (Administrator) PowerShell.' }

# --- 1. WSL2 -----------------------------------------------------------------
Write-Host "`n=== 1. WSL2 ===" -ForegroundColor Cyan
try { wsl --status | Out-Host } catch { Write-Host "wsl not available yet." }
$wslExit = $LASTEXITCODE
if ($wslExit -ne 0) {
    Write-Host "Installing WSL2 (this downloads the kernel and may require a reboot)..." -ForegroundColor Yellow
    wsl --install --no-distribution
    if ($LASTEXITCODE -ne 0) { throw 'wsl --install failed. Enable VirtualMachinePlatform + reboot, then re-run.' }
    wsl --set-default-version 2
}

# --- 2. Ubuntu ---------------------------------------------------------------
Write-Host "`n=== 2. Ubuntu distro ===" -ForegroundColor Cyan
$distros = (wsl --list --quiet) 2>$null
if (-not ($distros | Where-Object { $_ -match 'Ubuntu' })) {
    Write-Host "Installing Ubuntu..." -ForegroundColor Yellow
    wsl --install -d Ubuntu --no-launch
}
wsl --set-default-version 2
$distro = ($distros | Where-Object { $_ -match 'Ubuntu' } | Select-Object -First 1)
if (-not $distro) { $distro = 'Ubuntu' }
Write-Host "Using distro: $distro"
wsl --list --verbose | Out-Host

# --- 3. copy project (INCLUDING .git) ---------------------------------------
Write-Host "`n=== 3. Copy project to ~/warsha (including .git) ===" -ForegroundColor Cyan
wsl -d $distro -- bash -lc 'mkdir -p ~/warsha'
# tar over stdin is faster and preserves modes better than a per-file copy
# NO --exclude .git — ~/warsha becomes the canonical repo
Push-Location $Source
try {
    tar -cf - --exclude node_modules --exclude target --exclude dist . |
        wsl -d $distro -- bash -lc 'tar -xf - -C ~/warsha'
} finally { Pop-Location }
wsl -d $distro -- bash -lc 'ls -la ~/warsha | head -n 30'

# --- 4. toolchain + validation ----------------------------------------------
Write-Host "`n=== 4. Toolchain + M0 validation (inside WSL) ===" -ForegroundColor Cyan
Write-Host "From now on, run commands via:" -ForegroundColor Yellow
Write-Host '  wsl -d Ubuntu -- bash -lc "cd ~/warsha && <command>"' -ForegroundColor Yellow
wsl -d $distro -- bash -lc 'cd ~/warsha && bash scripts/wsl-setup.sh'
$code = $LASTEXITCODE
Write-Host "`nwsl-setup.sh exit code: $code" -ForegroundColor $(if ($code -eq 0) { 'Green' } else { 'Red' })
Write-Host "Log is at \\wsl.localhost\$distro\home\$env:USERNAME\warsha\wsl-validation.log"
Write-Host "`n~/warsha is now the canonical repository. Edit/run there." -ForegroundColor Cyan
exit $code