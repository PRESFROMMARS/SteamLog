$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$root = (Get-Location).Path
$env:PATH = "$root\.cache\node;$env:PATH"
$paths = @{
 ELECTRON_CACHE='.cache/electron'; ELECTRON_BUILDER_CACHE='.cache/electron-builder';
 npm_config_cache='.cache/npm'; npm_config_devdir='.cache/node-gyp'; npm_config_prefix='.cache/npm-global';
 HOME='.cache/home'; USERPROFILE='.cache/home'; APPDATA='.cache/appdata'; LOCALAPPDATA='.cache/localappdata';
 TMPDIR='.cache/tmp'; TMP='.cache/tmp'; TEMP='.cache/tmp'; XDG_CACHE_HOME='.cache/xdg'
}
foreach ($key in $paths.Keys) {
 $value = Join-Path $root $paths[$key]
 New-Item -ItemType Directory -Force $value | Out-Null
 [Environment]::SetEnvironmentVariable($key, $value, 'Process')
}
& "$root\.cache\node\npm.cmd" @args
exit $LASTEXITCODE
