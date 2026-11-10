# Orchestrator diagnostic (v2): filter to genuine power/boot providers only, last 14h, UTC.
$since = (Get-Date).AddHours(-14)
$now = Get-Date
Write-Output ("now {0:yyyy-MM-dd HH:mm:ss}Z" -f $now.ToUniversalTime())
try {
  $boot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
  Write-Output ("last boot {0:yyyy-MM-dd HH:mm:ss}Z" -f $boot.ToUniversalTime())
} catch { Write-Output "last boot unavailable" }
$providers = 'Microsoft-Windows-Kernel-Power','Microsoft-Windows-Power-Troubleshooter','Microsoft-Windows-Kernel-General','EventLog','Microsoft-Windows-Kernel-Boot'
$ev = Get-WinEvent -FilterHashtable @{ LogName='System'; StartTime=$since; ProviderName=$providers } -ErrorAction SilentlyContinue |
  Where-Object { $_.Id -in 1,12,13,41,42,107,109,506,507,566,6005,6006,6008 } |
  Sort-Object TimeCreated
if (-not $ev) { Write-Output 'no sleep/resume/boot/shutdown events in the last 14h'; exit 0 }
foreach ($e in $ev) {
  $m = ($e.Message -split "`r?`n")[0]
  if ($m.Length -gt 110) { $m = $m.Substring(0,110) }
  '{0:MM-dd HH:mm:ss}Z id={1,-4} {2} :: {3}' -f $e.TimeCreated.ToUniversalTime(), $e.Id, ($e.ProviderName -replace 'Microsoft-Windows-',''), $m
}