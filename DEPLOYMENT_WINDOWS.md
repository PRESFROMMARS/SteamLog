# SteamLog · Windows 10 x64 portable deployment

Current menu: **47 products, 8 categories, RMB / CNY prices**. All displayed times, business dates, hourly groups, closeout summaries and CSV timestamps use Asia/Taipei (UTC+08:00). No exchange-rate conversion is performed.

## Develop on this Mac

From the project root:

```sh
./scripts/npm-local.sh run dev
```

This is `npm run dev` with the project-local Node runtime and cache/home/temp redirects. Main-process edits require a restart. Use `./scripts/npm-local.sh run typecheck`, `./scripts/npm-local.sh test`, and `./scripts/npm-local.sh run test:runtime` to verify. The runtime test intentionally crashes an isolated renderer and uses only `.cache/phase4-runtime/` data.

## Build the Windows folder on Mac or Windows

```sh
./scripts/npm-local.sh run pack:win-dir
```

Equivalent npm script: `npm run pack:win-dir`. On Windows use `./scripts/npm-local.ps1 run pack:win-dir`. All npm scripts route through `scripts/local.cjs`, which sets project-local Electron, builder, npm, node-gyp, HOME and temporary directories before running tools. Use the platform wrapper for dependency installation as well.

The pipeline builds React/Vite and Electron TypeScript, then creates a clean **separate** `.cache/win-app/` staging directory from the lockfile. It installs production dependencies with lifecycle scripts disabled and uses `prebuild-install` to fetch the **better-sqlite3 Windows x64 / Electron ABI** release matching the installed Electron version. It checks the native addon for PE/AMD64 before electron-builder packages it and checks again in the unpacked result. The Mac arm64 addon is never overwritten. Electron-builder fetches Windows Electron into `.cache/electron/`; its own downloads stay in `.cache/electron-builder/`.

`npmRebuild` is deliberately disabled **only because the staging script has already installed and checked the correct native prebuilt**. Run the npm packaging script, not bare electron-builder. Packaging refuses to overwrite an output folder that already contains runtime `data/`. Missing prebuilt binaries or network failures stop the build; the script does not install global compiler tooling or silently package a Mac addon. The checked versions are pinned by `package-lock.json` (currently Electron 37.10.3, better-sqlite3 12.11.1, builder 26.0.12).

### One-step clean build directly on Windows

Copy source and lockfile, excluding `node_modules`, `.cache`, `.dev-data`, `dist`, `dist-electron`, and `release`. Extract an official Windows x64 **Node 22** ZIP into project-local `.cache/node/` so it contains `node.exe` and `npm.cmd`. No Node installer, admin rights or global tools are needed. Then run at the project root:

```powershell
.\scripts\build-windows.ps1
```

This runs contained `npm ci --ignore-scripts`, downloads the local Electron development binary, then packages the Windows folder with the same staged native prebuilt. For Windows development after this setup, run `npm-local.ps1 run rebuild` to match the local dev SQLite addon to Electron, then `npm-local.ps1 run dev`. Do not copy Mac `node_modules` to Windows. If a required prebuilt is unavailable, keep the pinned versions or build the native addon on a Windows build machine with already-installed tooling; no compiler/toolchain auto-install is part of this project.

## Copy to the shop PC

Copy the **entire** `release/SteamLog-win32-x64/` folder to a writable local folder on the Windows 10 PC. Double-click `SteamLog.exe`. The shop PC needs neither Node nor npm. Do not put the portable folder in protected Program Files. First launch creates:

```text
SteamLog-win32-x64/
  SteamLog.exe
  resources/                         # required application files
    win-raw-scanner/RawScannerListener.cs
  data/
    db/ledger.db                     # WAL and SHM companions while running
    backups/                         # internal online snapshots
    exports/                         # CSV and counter-sheet PDFs
    bin/RawScannerListener.exe        # compiled locally on first launch
    logs/error.log                   # bounded local error log + .1 rotation
    userData/, sessionData/, temp/, crashDumps/
```

No installer, auto-launch, Registry entries, Startup-folder shortcuts, shell integration or global settings are created. Keep all files in the folder together. Quit before moving it or copying the live database. Use completed `.db` snapshots for live copies. To upgrade an existing portable deployment, quit SteamLog and replace application files while **preserving its `data/` folder**. Development uses `.dev-data/db/ledger.db`; the previous `.dev-data/steamlog.sqlite3` is checkpointed and migrated on the first Phase 4 launch, with interrupted-migration recovery. Existing backups stay compatible.

Only the explicitly configured, existing USB mirror folder may receive writes outside this project, per the approved Phase 3 exception. Missing/unmounted/changed-identity mirrors show a warning and leave internal snapshots intact. No external fallback folders are created. OS-managed security/process records are outside application control.

## Connect and calibrate the two scanners

1. Configure both scanners as **USB HID US-English keyboard**, Enter or Tab suffix, inter-character delay **≤35 ms**. A partial scan idle for over 300 ms expires. Do not use an unusually slow scanner configuration.
2. Open **Backup & System → Dual-Scanner Hardware Channels**. Windows compiles the bundled C# source using built-in Framework 4.x `csc.exe` into `data/bin/`; no NuGet or compiler installation occurs. Look for green **WINDOWS RAW INPUT**.
3. Click **绑定 1 号枪**, scan any code with gun 1; repeat for gun 2. Each calibration scan is consumed without recording a sale. Bindings use full device paths, including interface/serial identity, rather than transient handles or VID/PID alone. Recalibrate after a port/device change if needed. **Swap Channels** exchanges both bindings atomically.
4. First-time rapid scanner bursts auto-bind the two free channels. Check their identities before service: timing is a heuristic and sufficiently fast human typing can resemble a scanner. Additional devices stay unassigned until calibrated. Normal slow keyboard typing is rejected by the helper.
5. With focus on the dashboard, scan B001 once and verify **one** row. Repeat with the app unfocused. Arm gun 1 with MUL-05, then fire B001 on gun 1 and S001 on gun 2 together: verify **5 × B001 / SCANNER_1** and **1 × S001 / SCANNER_2** with no mixed token or duplicate row. Test Enter and Tab suffixes, unplug/replug, swap, restart, and unknown SKU handling. Undo these acceptance rows afterward.

Raw Input owns physical scanner input while connected; the renderer discards its global wedge copy and suppresses barcode Enter/Tab activation of focused buttons. Quick Scan submissions also deduplicate against raw packets within 80 ms in either delivery order; explicit simulator buttons remain usable. HID scanners still type into the OS's focused text field/other application: background capture does not suppress system-wide keyboard input. Avoid placing an editable business form in focus while clerks scan. Slow manual typing in form inputs is excluded from global capture.

The helper has independent buffers/Shift state per hDevice, a heartbeat watchdog and bounded reconnect backoff, and exits if its parent dies. A disconnected helper switches to visible standard keyboard fallback; **background capture and physical dual-device isolation are unavailable in fallback**. Mac always uses standard HID / simulator mode. Detected-device diagnostics and saved bindings persist in local SQLite settings.

## Recovery and shop acceptance

F11 or the telemetry fullscreen button toggles edge-to-edge operation. A second launch restores/focuses the existing window. Renderer crashes/unresponsiveness trigger a reload with capped backoff while Main retains SQLite and scanner FSM state. Main JS exception/rejection handlers append to local `data/logs/error.log`; a main-process/native/OS failure still requires relaunch and SQLite/startup-backup recovery. Shutdown stops the helper, drains accepted scans and completes the online backup before closing SQLite.

The Windows folder was built and its native PE/x64 files verified on Mac. **The C# helper has not been compiled/executed on Windows, and simultaneous physical scanners have not been tested on the target PC.** Complete the hardware steps above before real service. Also verify print quality, USB mirror removal, screen resolution and sustained shop-volume scanning on the i5-4590T / 4 GB machine. No performance claim for that PC is inferred from Mac simulation.

References: [Microsoft Raw Input](https://learn.microsoft.com/en-us/windows/win32/inputdev/using-raw-input), [electron-builder cross-platform native dependencies](https://www.electron.build/v26/docs/features/multi-platform-build/), [official Node releases](https://nodejs.org/dist/latest-v22.x/).

## Ready-to-share ZIP (2026-10-18)

`release/SteamLog-2026-10-18-win-x64.zip` contains the entire portable folder and a Chinese `使用说明.txt`, with no shop ledger. It includes Chinese application prompts and the dashboard next-day preparation recommendation. Extract everything before launching `SteamLog.exe`. This ZIP was integrity checked; Windows physical scanner acceptance remains required. Future builds must recreate the ZIP to avoid distributing stale application files.
