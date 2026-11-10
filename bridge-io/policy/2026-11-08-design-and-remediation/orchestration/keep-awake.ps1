# Orchestrator keep-awake. Prevents idle SYSTEM sleep while the run executes (like `caffeinate`).
# Non-persistent: the execution state belongs to this process and is released automatically when it
# exits. It changes NO power-plan setting. Hard cap of 10 hours so it can never run forever.
Add-Type -Namespace Warsha -Name Power -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll")]
public static extern uint SetThreadExecutionState(uint esFlags);
'@
$ES_CONTINUOUS = [uint32]2147483648
$ES_SYSTEM_REQUIRED = [uint32]1
$flags = $ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED
$started = Get-Date
$end = $started.AddHours(10)
Write-Output ("keep-awake started {0:yyyy-MM-dd HH:mm:ss}Z, hard stop {1:yyyy-MM-dd HH:mm:ss}Z, pid={2}" -f $started.ToUniversalTime(), $end.ToUniversalTime(), $PID)
while ((Get-Date) -lt $end) {
  [void][Warsha.Power]::SetThreadExecutionState($flags)
  Start-Sleep -Seconds 30
}
[void][Warsha.Power]::SetThreadExecutionState($ES_CONTINUOUS)
Write-Output "keep-awake ended (hard stop reached)"