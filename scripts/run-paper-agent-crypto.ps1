# Invoked by the Windows Scheduled Task "StockDashboardPaperAgentCrypto".
# Runs one pass of the crypto-only paper agent and appends timestamped
# output to agent-run.log so a run at 3am is still reviewable in the
# morning, not just whatever's left in Task Scheduler's own history.
#
# Calls node + tsx's CLI directly rather than "npm run" - piping npm.cmd
# (a cmd.exe batch wrapper) through PowerShell redirection mangled the
# log into garbled every-other-character text; going straight to node
# avoids that extra hop entirely.

$ErrorActionPreference = "Continue"
Set-Location "D:\Projects\Stock Dashboard"

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -Path "agent-run.log" -Value "`n=== Run at $timestamp ===" -Encoding utf8

$output = & "C:\Program Files\nodejs\node.exe" "node_modules\tsx\dist\cli.mjs" "src\agent\runAgent.ts" "CRYPTO" 2>&1
$output | Add-Content -Path "agent-run.log" -Encoding utf8
