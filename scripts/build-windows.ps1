$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
if (-not (Test-Path '.cache\node\node.exe')) { throw 'Extract the official Windows x64 Node 22 ZIP into .cache/node first; no global installation is needed.' }
& "$PSScriptRoot\npm-local.ps1" ci --ignore-scripts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& "$PSScriptRoot\npm-local.ps1" run setup:electron
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& "$PSScriptRoot\npm-local.ps1" run pack:win-dir
exit $LASTEXITCODE
