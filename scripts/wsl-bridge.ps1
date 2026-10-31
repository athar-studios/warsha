# Warsha WSL bridge: runs OUTSIDE ZadLoop's sandbox.
# ZadLoop requests a validation run by creating .bridge\run.flag;
# results land in .bridge\result.log and .bridge\done.flag.
$p = 'C:\Users\Dragonfly\Downloads\Warsha'
$b = "$p\bridge-io"
while ($true) {
  if (Test-Path "$b\run.flag") {
    Remove-Item "$b\run.flag","$b\done.flag" -Force -ErrorAction SilentlyContinue
    "started $(Get-Date -Format o)" | Set-Content "$b\status.txt"
    $cmd = "rsync -a --delete --exclude node_modules --exclude target --exclude .pnpm-store --exclude .npm-cache --exclude bridge-io /mnt/c/Users/Dragonfly/Downloads/Warsha/ /root/warsha/ && cd /root/warsha && bash scripts/wsl-setup.sh"
    & C:\Windows\System32\wsl.exe -d Ubuntu -u root -- bash -lc $cmd *> "$b\run-output.log"
    $code = $LASTEXITCODE
    & C:\Windows\System32\wsl.exe -d Ubuntu -u root -- bash -lc "cat /root/warsha/wsl-validation.log" > "$b\result.log" 2>&1
    & C:\Windows\System32\wsl.exe -d Ubuntu -u root -- bash -lc "mkdir -p /mnt/c/Users/Dragonfly/Downloads/Warsha/bridge-io/shots && cp -f /root/warsha/apps/desktop/e2e/screens.visual.spec.ts-snapshots/*.png /mnt/c/Users/Dragonfly/Downloads/Warsha/bridge-io/shots/ 2>/dev/null; cp -f /root/warsha/apps/remote/e2e/smoke.visual.spec.ts-snapshots/*.png /mnt/c/Users/Dragonfly/Downloads/Warsha/bridge-io/shots/ 2>/dev/null"
    "exit=$code finished $(Get-Date -Format o)" | Set-Content "$b\done.flag"
    "idle" | Set-Content "$b\status.txt"
  }
  Start-Sleep -Seconds 5
}


