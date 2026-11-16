#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
ROOT="$PWD"
export PATH="$ROOT/.cache/node/bin:$PATH"
export ELECTRON_CACHE="$ROOT/.cache/electron" ELECTRON_BUILDER_CACHE="$ROOT/.cache/electron-builder" npm_config_cache="$ROOT/.cache/npm" npm_config_devdir="$ROOT/.cache/node-gyp" npm_config_prefix="$ROOT/.cache/npm-global"
export HOME="$ROOT/.cache/home" TMPDIR="$ROOT/.cache/tmp" TMP="$ROOT/.cache/tmp" TEMP="$ROOT/.cache/tmp" XDG_CACHE_HOME="$ROOT/.cache/xdg"
mkdir -p "$HOME" "$TMPDIR" "$XDG_CACHE_HOME"
exec npm "$@"
