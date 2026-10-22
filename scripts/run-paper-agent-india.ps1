# Invoked every 5 minutes during NSE hours by the Windows Scheduled Tasks
# "StockDashboardPaperIntraday" and "StockDashboardPaperDaily" (see
# README "Running the paper agents for a day"). Runs ONE pass of the
# chosen PAPER agent and appends timestamped output to its log, so an
# unattended day is reviewable afterwards. Paper only - no real orders.
#
#   -Mode intraday  ->  src\agent\runIntraday.ts        -> agent-intraday.log
#   -Mode daily     ->  src\agent\runAgent.ts IN_STOCK  -> agent-run.log
#   -Mode report    ->  src\agent\dailyReport.ts        -> agent-report.log
#                       (once at 15:45; writes reports\paper-YYYY-MM-DD.md)
#
# Calls node + tsx's CLI directly rather than "npm run" (same reason as
# run-paper-agent-crypto.ps1: npm.cmd through PowerShell redirection
# garbled the log). Market-hours / holiday checks live in the agents'
# own risk manager, so a pass outside hours just logs and exits.

param(
  [Parameter(Mandatory = $true)][ValidateSet("intraday", "daily", "report")][string]$Mode
)

$ErrorActionPreference = "Continue"
Set-Location "D:\Projects\Stock Dashboard"

if ($Mode -eq "intraday") {
  $log = "agent-intraday.log"
  $agentArgs = @("src\agent\runIntraday.ts")
} elseif ($Mode -eq "report") {
  $log = "agent-report.log"
  $agentArgs = @("src\agent\dailyReport.ts")
} else {
  $log = "agent-run.log"
  $agentArgs = @("src\agent\runAgent.ts", "IN_STOCK")
}

$now = Get-Date
# First pass of the day opens a session header, like the hand-run loops did.
$today = $now.ToString("yyyy-MM-dd")
if (-not (Select-String -Path $log -Pattern "session started $today" -Quiet -ErrorAction SilentlyContinue)) {
  Add-Content -Path $log -Value "`n=== $Mode PAPER session started $today $($now.ToString('HH:mm:ss')) (scheduled) ===" -Encoding utf8
}

Add-Content -Path $log -Value "`n--- $($now.ToString('HH:mm:ss')) ---" -Encoding utf8
$output = & "C:\Program Files\nodejs\node.exe" "node_modules\tsx\dist\cli.mjs" @agentArgs 2>&1
$output | ForEach-Object { "$_" } | Add-Content -Path $log -Encoding utf8
