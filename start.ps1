$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

$electron = Join-Path $PSScriptRoot "node_modules\electron\dist\electron.exe"
if (-not (Test-Path -LiteralPath $electron)) {
  $cmd = Get-Command electron -ErrorAction SilentlyContinue
  if ($cmd) { $electron = $cmd.Source }
}

if (-not $electron -or -not (Test-Path -LiteralPath $electron)) {
  Write-Host ""
  Write-Host "[FET Manager Desktop] Electron not found."
  Write-Host "Run once:  npm install"
  Write-Host "Then run this script again."
  Write-Host ""
  Read-Host "Press Enter to exit"
  exit 1
}

Write-Host "Starting FET Manager Desktop..."
& $electron $PSScriptRoot
