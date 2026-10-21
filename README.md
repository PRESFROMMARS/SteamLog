# SteamLog · 早餐店扫码账本

Local Electron / React / TypeScript sales ledger, branded **STEAMLOG // SF CHINATOWN LEDGER**. No network services, remote fonts, audio assets, animation or background polling of the database.

## 从 GitHub 恢复开发环境

克隆仓库或在 GitHub 的 Code → Download ZIP 下载后解压，即可恢复源码。详细操作见 [RESTORE_FROM_GITHUB.md](RESTORE_FROM_GITHUB.md)。本仓库不包含密钥、营业账本、备份、缓存、依赖或安装包；这些目录已通过 `.gitignore` 排除。软件离线运行，不需要 API Key。

**源码备份不等于营业数据备份。** 删除本地项目之前，请先退出软件，将 `.dev-data/`（开发版）以及使用中的便携版 `data/` 完整备份到 U 盘或其他安全位置，并确认备份可恢复。

上传前可运行 `node scripts/audit-source.cjs` 检查待提交文件中的常见密钥格式；实际上传暂存区可用 `node scripts/audit-source.cjs --staged` 复核。该检查在本地运行，只报告位置，不输出疑似密钥原文。

## Current opening configuration

The menu contains 47 Chinese breakfast items in 8 categories. Prices, ledger displays, counter sheets and CSV monetary columns use **RMB / CNY**, with 100 integer fen per yuan. Entered prices are taken literally; SteamLog performs no USD exchange-rate conversion. All displayed times, business dates, hourly analytics, closeouts, backup dates and CSV timestamps use `Asia/Taipei` (UTC+08:00). Old demo transactions, test backups and sample exports have been cleared from the working ledger.

## Run on this Mac

```sh
cd /path/to/SteamLog
./scripts/npm-local.sh run dev
```

The downloaded Node 22.16.0 runtime is in `.cache/node`. No global Node installation is required. npm 10 prints `prefix cannot be changed from project config` because the requested `.npmrc` contains `prefix`; this diagnostic is nonfatal. The wrappers also set `npm_config_prefix` explicitly to keep it local. The wrapper always changes to the project root and sets local npm, Electron, builder, node-gyp, temporary, home and XDG cache directories. `.npmrc` is committed; dependency versions are locked in `package-lock.json`.

```sh
./scripts/npm-local.sh run typecheck
./scripts/npm-local.sh run rebuild
./scripts/npm-local.sh test
./scripts/npm-local.sh run build
./scripts/npm-local.sh start
```

`dev` compiles the main/preload code once and starts Vite with renderer hot reload. Restart after main-process changes. `start` opens the last production build. Run `rebuild` after any dependency reinstall: SQLite must match Electron's ABI, not ordinary Node's ABI. Tests run through Electron as Node, using disposable databases under `.cache/tests`; they never modify the sales database.

## Fresh Windows 10 deployment / development

Copy source and lockfile, excluding `.cache`, `node_modules`, generated outputs and `.dev-data`. Place an official **Windows x64 Node 22 runtime** inside `.cache/node` (containing `node.exe` and `npm.cmd`). Do not copy macOS native modules. Run from PowerShell at the project root:

```powershell
.\scripts\npm-local.ps1 ci
.\scripts\npm-local.ps1 run rebuild
.\scripts\npm-local.ps1 run typecheck
.\scripts\npm-local.ps1 test
.\scripts\npm-local.ps1 run build
.\scripts\npm-local.ps1 start
```

Windows installation and physical scanner acceptance testing have not been performed on this Mac. A Windows prebuilt native SQLite binary is expected; a source-build fallback may require existing compiler tools. Do not install system compiler tooling as part of this project's containment workflow. The portable Windows x64 build is now implemented; see [DEPLOYMENT_WINDOWS.md](DEPLOYMENT_WINDOWS.md) for cross-platform packaging, a one-step Windows source build, and shop-PC hardware acceptance.

## Containment

- `.npmrc` was the first project file created before npm use.
- Downloaded runtime, dependency caches, native build headers, temporary files and redirected home directories live under `.cache/`.
- Electron redirects userData, sessionData, logs, temp and crashDumps synchronously before ready. Development data: `.dev-data/`; packaged data: executable-adjacent `data/`.
- Chromium disk shader and HTTP caches are disabled. No crash reporter is started.
- Use the provided wrappers, not bare npm/Electron commands, to maintain the environment redirects. The operating system may independently maintain process/security records; an application cannot prohibit OS-managed records.
- Do not delete `.dev-data` unless intentionally deleting the shop's ledger. `.cache` can be removed when the app is closed, but this also removes the local Node runtime.

## Scanner behavior

`ScannerEngine` owns an isolated bounded input buffer, multiplier, mode and five-second timer for each of SCANNER_1, SCANNER_2 and KEYBOARD. An input stream idle for over one second discards its unfinished barcode. Control/SKU matching trims whitespace and ignores case. Unknown or inactive SKUs emit an error and preserve armed modifiers until they expire. A successful product insert resets only its source scanner. All writes are synchronous on Electron's main thread; there is no read-modify-write IPC race.

Global key capture accepts barcode characters followed by Enter outside text inputs. Enter on an ordinary focused button still works if no barcode is buffered. The lab can route complete scans to either scanner and dispatch interleaved character streams in one main-process tick with a shared captured timestamp. Its dual-fire test writes **real** sales, reports inserted IDs and checks that S1 records 5 × B001 while S2 records 1 × S001. Undo the test rows to remove their effect on revenue.

**Physical HID routing:** Windows now uses the bundled C# WM_INPUT helper with per-device buffers and stable device-path channel bindings. The System tab provides diagnostics, calibration and swap. Raw packets record directly through the Main engine even when unfocused; the focused renderer wedge copy is suppressed. Mac uses KEYBOARD fallback and the logical dual-scanner simulator. Native Windows compilation and physical dual-gun acceptance remain unverified on this Mac. See [the deployment guide](DEPLOYMENT_WINDOWS.md) for setup and limits.

## Ledger semantics

- SQLite opens synchronously with WAL, NORMAL synchronous and foreign keys enabled. The 47-item opening menu seeds atomically in RMB (integer fen) only when the product table is empty.
- Integer-cent prices and immutable product snapshots are stored per row. Database checks enforce positive integral quantities and signed subtotals. SQL triggers reject deletes and all updates except an initial one-way void with a timestamp. Voids preserve financial fields; summaries filter voided rows.
- ACT-UNDO prefers the source scanner's newest non-voided row from the preceding 60 seconds; otherwise it uses today's latest non-voided global row. Manual Undo targets its row directly and is idempotent.
- All business dates and hourly buckets use Asia/Taipei (UTC+08:00, no daylight saving). ISO creation timestamps are UTC. The UI refreshes date/hour-scoped data at Taipei hour boundaries (including midnight); the quarter-second clock ticks only rerender telemetry. Barcode writes never wait for audio unlocking.
- Net revenue sums active signed subtotals. Net items sold sums active SALE quantities minus active REFUND quantities. Valid transactions excludes voids; the recent-stream footer also shows all today's rows including voids. Special operations counts each special/voided row once.
- Audio is synthesized locally. A keypress or click unlocks Web Audio; mute suppresses cues. Timers and subscriptions are cleaned up.
- Context isolation, sandboxed preload, narrow IPC, trusted-frame checks, denied navigation/popups and denied permission requests keep SQLite unavailable to the renderer.

## Verification

`test` exercises WAL/foreign keys, seeding, same-tick buffer isolation, 500-sale stress, modes/multipliers, unknown/inactive products, expiry resets and notifications, immutable snapshots, SQL update/delete protection, irreversible voiding, scanner-prioritized and global fallback undo, Taipei midnight, and persistence on reopen. These are core integration tests under the actual installed Electron ABI.

Existing development ledger rows remain intact. Phase 2 UI CRUD verification added and removed one unused temporary product; it created no sales.


## Phase 2 interface

The shell keeps scanner subscriptions, global unfocused capture, audio, modifier timers and last-action telemetry mounted across all four tabs. Input, textarea, select and contenteditable focus clears/pauses keyboard capture. The simulator toggle is available from every tab. All four tabs are implemented through Phase 3.

### Live dashboard

- Hero cards show net revenue with gross/refunds, net units and valid transaction count, current Taipei hour units/revenue, peak hour, best seller, and refund/gift/waste quantities plus original values and void count.
- Ranking includes every product with activity today (even if all rows are voided), with an option to include unused active products. Rank is by net units, then revenue, then product ID. Positive net units form the volume-share denominator; negative-return-only products show 0%. Labels use each product's latest snapshot today, so editing the catalog does not rewrite sales history.
- Static SVG charts show separate units/revenue scales, including negative values, for 05:00–19:00 or all 24 hours. Peak hour uses net units, then revenue, then earlier hour.
- Stream type/scanner filters run in SQL **before** the latest-40 limit. Non-void type filters exclude voided rows; All includes them. Undo stays immediate and idempotent.

### Products and counter sheet

Main-process IPC validates all mutations. SKUs normalize to uppercase and contain 1–32 letters, digits or dashes. MUL-*, MOD-*, ACT-* and the X2/X3/X5/X10 aliases are reserved. Disabled SKUs still reserve their unique code. Prices parse decimal dollar strings into integer cents without floating-point multiplication. Catalog changes preserve ledger snapshots. Deleting a product with any transaction history (including voided rows) archives it; unused products may be permanently removed. A one-time seed marker prevents intentionally empty catalogs being reseeded.

The counter sheet groups active products by category and sort order. Choose compact four-column or standard three-column layout and Letter/A4 paper. Long SKUs automatically span extra columns to preserve barcode module width. Enable Dev/test mode to scan barcode cards using a selected logical scanner; this writes real sales when clicking product cards.

The zero-dependency encoder in `electron/code128.ts` emits Start B, weighted modulo-103 checksum, Stop, and ten-module quiet zones. Printable ASCII uses Code Set B; ASCII controls use a single-character SHIFT to Set A. SVG bars are vector rectangles, with no barcode font or remote assets. The [Zint Code 128 implementation](https://github.com/zint/zint/blob/master/backend/code128.c) is a reference for the standard symbol table and checksum.

**Print Barcode Sheet** uses the native print service with only the board visible. The current verification Mac has no printer configured, so physical print/scanner acceptance remains outstanding. **Export PDF** works without a printer and always writes to `.dev-data/exports/` (or packaged executable-adjacent `data/exports/`). PDF filenames include a timestamp and never overwrite an existing file. No save dialog permits exports outside the contained data directory.

### Phase 2 verification

`npm-local.sh test` includes the original Electron-native integration suite plus exact-cent CRUD, reserved/unique SKUs, edit snapshots, safe archive/delete, net dashboard aggregates, filtered latest 40, Taipei hour/day boundaries, and Code 128 reference vectors / all 128 ASCII characters / quiet zones. UI checks covered cross-tab keyboard modifiers, focused-input suppression, temporary product add/delete, rendering and native print error handling. Compact Letter and A4 exports were each one page and visually inspected. An independent macOS Vision decoder read **all 19 barcodes from both exports at 300 DPI**. This is software validation; Windows hardware and physical print quality still require shop acceptance.


## Phase 3 analytics and exports

Historical analytics supports Today, Yesterday, Last 7/30 Days, Monday-start This Week, This Month, All Time and inclusive custom Taipei business-date ranges. Daily, Monday-week and monthly SQL aggregates use stored Taipei business dates, not the host computer timezone. Zero buckets are filled. Calendar-day averages include days with no activity; net totals exclude voids and subtract refunds. All catalog products remain in the ranking, including active items with zero sales and disabled items with history. Labels/current prices come from today's catalog; transaction amounts come from immutable ledger snapshots.

Choose 2–5 products for grouped comparison bars, a totals/daily-average/peak-hour matrix, and optional product-filtered hourly distribution. Series colors remain consistent with selection order. Charts expose exact units/revenue in hover titles and expandable tables. Long trends page through 60 buckets to keep DOM/SVG cost bounded on the target PC; ranges above 4,000 buckets require weekly/monthly granularity. The top telemetry clock updates independently; analytics queries debounce bursts of scan events.

Both Analytics and Backup & System share the selected date range. CSV exports are consistent **online SQLite snapshots**, with UTF-8 BOM, quoted fields, doubled quotes and CRLF rows. Transaction exports include every row in range, including voids; product exports include zero-sale catalog items and aggregate only valid financial activity. Money is formatted with two decimals. Formula-like text cells receive an apostrophe prefix for Excel safety; numeric refunds remain numeric negative values. No Excel package is required.

Exports always go to `runtimeRoot/exports/`. **Show in Folder** reveals the saved file for opening in Excel or manually copying to USB. App-controlled export dialogs cannot bypass containment.

## Phase 3 backup, mirror and recovery

SQLite online backups are serialized and accept live scanner writes between page transfers. New snapshots are written as `.partial`, checked for SQLite integrity/foreign keys/schema, flushed, then renamed to complete `.db` files. Only complete snapshots are listed/restorable. Automatic triggers are startup (if no verified snapshot exists for the Taipei day), every 100 live records during 05:00–19:59 Taipei, and clean shutdown. The live-record counter is committed with each transaction and excludes demo imports. Startup and shutdown triggers are independent of shop hours.

Primary directory: `.dev-data/backups/` during normal local runs; executable-adjacent `data/backups/` when packaged. Keep the latest **40 automatic** snapshots, plus all manual and pre-restore/pre-clear/pre-demo safety snapshots. Manual/safety snapshots are not auto-pruned. Shutdown waits for active CSV/backup work and completes an online snapshot before closing SQLite. A failed shutdown backup offers Retry or an explicit choice to quit without that snapshot.

### Explicit USB mirror exception

As authorized for Phase 3, **only the explicitly configured mirror folder may be outside the project**. Every primary backup, export, cache, recovery journal and runtime file stays inside the project. Set a full USB/secondary folder path under Backup & System while the drive is mounted. External folders must already exist; SteamLog never creates external fallback folders or writes to OS user-data locations. Internal mirror folders can be created when explicitly configured.

The single mirror folder's canonical path and device/folder identity are saved in project-local `mirror-config.json`, independently of database backups. Restoring an older database cannot silently reactivate a different external path. Copies are written directly inside that one folder using partial-file completion. If the path is missing, inaccessible or has changed mount identity, the internal backup still succeeds and a non-blocking warning appears across tabs and in Backup & System. Re-select the intended folder if its mount identity changes. Mirror failures do not disable scanning or erase primary snapshots. No external mirror was configured during automated/UI acceptance testing.

### Restore and startup recovery

Restore uses a native confirmation and verifies the selected local snapshot. It first creates a pre-restore online safety backup, waits for exports/backups, checkpoints/closes SQLite and swaps a staged database. A project-local restore-intent journal and rollback file recover interrupted swaps on the next launch. Catalog and ledger data are restored together; scanner states reset and incoming writes queued during maintenance are replayed in order afterward. The mirror configuration stays independently bound to the explicitly chosen folder.

If the live SQLite file cannot open, startup offers recovery from the newest verified local snapshot. It preserves the unreadable live database/WAL/SHM files in `runtimeRoot/recovery-quarantine/` before replacing them. Canceling preserves the live files. To use a USB-mirrored backup after disk replacement, manually copy the unchanged `.db` snapshot into the new local primary backups folder; SteamLog validates it before restore. Application recovery does not substitute for testing the physical Windows PC and removable drive.

### Demo and opening-day cleanup

The demo button requests native confirmation, creates a safety snapshot and inserts about 1,500 rows in one SQLite transaction across 30 Taipei business dates. It uses morning rush, weekday/weekend variation, product-specific hour patterns and occasional refund/gift/waste/void rows. It is guarded against duplicate seeding. The insertion benchmark is returned separately from the preceding backup time.

Clear All Transactions requests confirmation and a completed pre-clear safety snapshot. It preserves products and temporarily removes/reinstates the delete guard inside one SQLite transaction; normal ledger updates/deletes remain prohibited. It resets the demo and live backup counters. Restore the pre-clear snapshot to recover the removed test ledger.

## Phase 3 validation

The Electron-native suite covers range totals and zero-fill, Taipei date/ISO Monday-week/month boundaries, slow movers, CSV BOM/Chinese/quotes/newlines/negative numbers/formula text, concurrent scanning with online backup, startup and auto-100 triggers, mirror boundary/unavailable-drive fallback, retention, invalid restore rejection, safety restore, interrupted-swap rollback, startup corruption recovery and the immutable ledger guard after clearing. On this Mac, a 1,540-row demo transaction took about 6 ms (the target Windows hardware has not been benchmarked).

UI acceptance used isolated `.cache/phase3-acceptance/` data via `STEAMLOG_TEST_DATA`. It verified seeding, analytics charts/comparison peaks, both exports, scanner modifiers on the System tab, manual backup, and confirmed clear followed by restore of all 1,527 demo rows. The normal `.dev-data/steamlog.sqlite3` ledger was not seeded or cleared. No additional npm dependencies were required for Phase 3.


## Phase 4 production shell and portable build

The app takes a single-instance lock before opening SQLite; a second launch restores and focuses the existing window. F11 and the persistent telemetry button toggle fullscreen. Renderer crashes/unresponsiveness reload with bounded backoff while Main owns the database and armed scanner state. Main exception/rejection logs stay in the local runtime logs directory and rotate at 2 MB. No startup/auto-launch integration exists.

`./scripts/npm-local.sh run build:renderer` compiles renderer and Electron files. `./scripts/npm-local.sh run pack:win-dir` stages a separate Windows Electron-compatible SQLite prebuilt, validates PE/AMD64 and creates `release/SteamLog-win32-x64/`. Copy the entire folder to the shop PC. All runtime files are executable-adjacent under `data/`, including `data/db/ledger.db`, backups, exports and the compiled helper. Legacy databases migrate safely on first Phase 4 launch.

Phase 4 automated tests cover persistent mappings/diagnostics, same-tick channel routing, calibration consumption, swapping/expiry, extra-device rejection, packet validation, Quick Scan / wedge duplicate suppression in either order, Mac helper skip, legacy restore/migration, logging/backoff and PE architecture guards. `test:runtime` starts a real isolated Electron app, forces a renderer crash and an unresponsive event, checks Main ledger/FSM preservation, verifies the second-instance path and local exception/rejection logging, and exits through the shutdown backup. Mac UI acceptance verified System diagnostics, F11/fullscreen, global fallback scanning and dual-fire simulation. Test data stays in `.cache/phase4-*`; the normal development ledger is not seeded or cleared.

The Windows portable build completed on Mac, and its SQLite addon is verified Windows x64 while the Mac addon remains arm64. Physical Windows scanner routing and native C# compilation still require target-machine acceptance, documented in [DEPLOYMENT_WINDOWS.md](DEPLOYMENT_WINDOWS.md).

## 日结与防重扫

- 今日看板右上角「今日日结汇总」显示台北营业日、首末笔有效销售、净销量、有效扫码记录数、净营业额和退款/赠送/报损/撤销汇总。扫码记录数并非顾客订单数。
- 每次打开或更新日结都会生成完整 `closeout` 数据库快照，随后尝试同步到已明确配置的 U 盘文件夹；未配置或拔出时保留本机备份并提示，不创建外部替代目录。日结备份长期保留。
- 汇总和备份期间短暂排队后续扫码，以保证同一截止时间；日结不清零、不锁账。
- 备份与设置中的「同枪极速防重扫」默认关闭。开启建议 250 毫秒，可设 50～1000 毫秒；同一逻辑通道相同条码在间隔内仅接受一次，忽略时给轻提示，不重置模式和数量、不播放成功声。不同通道互不影响；不同条码仍照常通过。保护也涵盖重复撤销和数量/模式条码。
- 快速人工重复扫码也可能被忽略，请用实机调整间隔或关闭。设置写入本机数据库，重启与恢复后生效。
- v4 首次打开旧账本时，在项目 `backups/` 内先生成 `pre-timezone-safety` 完整快照，再依据原始 ISO 时刻原子迁移日期与小时。金额、数量、商品快照、交易标识及原始时刻保持不变；完成后恢复不可改写触发器。恢复旧版备份时同样自动迁移。内部绝对时间继续使用标准 ISO UTC 存储，界面、CSV 与日志显示台北时间。


## 中文提示与明日备货推荐

- 程序的确认、恢复、启动/退出故障、商品校验及扫码枪连接提示使用中文。系统文件/SQLite 错误通过统一中文提示说明可采取的操作，IPC 原始诊断保存在本机日志；操作系统管理的打印等窗口仍取决于系统语言。
- 今日看板右上角「明日备货推荐」按台北时间推荐明天的各商品备货数量。仅查询历史，不改写销售或商品，也不需要联网。
- 参考近 28 个已结束的自然日，排除尚未结束的今天和未来流水。店内有未撤销销售的日期视为营业日，未记账日期不当作零销量；商品从首次有效销售日起统计，其后已观察营业日没有销量的商品按 0 件计算。
- 近期日均取最近最多 7 个营业日。同星期样本至少 2 次时，基数为同星期日均的 60% 加近期日均的 40%；否则采用近期日均。增加所选余量后向上取整，默认 10%，可选 0/5/10/15/20/30/50%。只计算未撤销的 SALE 数量，不计退款、赠送或报损。
- 历史不足显示「先少量试备」，无历史商品显示「待积累」，不会伪造数量。模拟账本有醒目演示提醒。推荐未扣减现存库存，也无法识别缺货、节假日、天气或团购，请按实际情况调整。
- `npm-local.sh test` 包含备货计算与中文错误测试；`npm-local.sh run test:preparation-ui` 使用 `.cache/preparation-ui/` 独立账本验证真实窗口、余量切换、中文确认取消及截图，正常营业账本保持原样。


## 每日记录：缺货、休息日、实际备货与剩余（v5）

备货窗口新增「每日记录」，可选日期、自动/正常营业/休息、逐商品填写实际备货（含当天补货）、收工剩余和是否缺货。空白表示未知，0 表示真实为零。剩余不能大于备货，缺货不能同时有正剩余。可提前标记明天休息，也可补录历史。今日只有明确勾选「今日已收工」后才纳入明日推荐；收工不锁账。明天若休息则建议为 0，历史休息日会排除，但销售流水保留。

缺货日从普通日均排除。最近 7 个营业日中最高缺货销量构成下限，至少增加 10% 或 1 件；选择更高余量时用该余量，仅加一次。常规销量推荐和缺货下限取较大值。最近 7 个营业日至少 2 天记录了备货和剩余、合计剩余/备货达到 20% 时，显示减量提示，不再次压低销量推荐。两项判断都展示依据，不推测实际流失需求。

新增 `preparation_days` / `preparation_items` 随账本完整备份和恢复。v4 及旧备份打开时自动创建空记录并升级为 v5；旧版程序不能直接打开 v5 账本。仅有备货历史的商品删除时也改为停用。清空操作的确认已包含每日备货记录，会先创建安全备份。

`test` 新增持久化、旧账本升级、备份恢复、休息/收工、缺货下限、剩余提示、空白/零及原子输入校验。`test:preparation-ui` 验证真实表单填写保存和推荐联动。`preview:preparation` 打开 `.cache/preparation-preview-v2/` 独立演示账本，正常营业数据不会被写入模拟记录。
