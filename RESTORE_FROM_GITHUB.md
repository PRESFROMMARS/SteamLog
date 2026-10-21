# 从 GitHub 恢复 SteamLog

本仓库用于保存可继续修改的源码。GitHub 上的源码副本不包含本地运行数据、已下载依赖和安装包。

## 以后重新下载

1. 打开你的私有仓库，登录 GitHub。
2. 点击 **Code → Download ZIP**，解压；也可使用 `git clone` 克隆仓库。
3. 保持解压后的目录结构完整，在该目录打开 Codex 或终端。
4. 根据下面步骤准备 Node 和依赖，然后即可修改和运行。

## Mac 上恢复开发

从 [Node.js 官方下载目录](https://nodejs.org/dist/v22.16.0/) 下载与你的电脑匹配的 Node 22.16.0 压缩包，Apple 芯片选择 `darwin-arm64`，Intel 选择 `darwin-x64`。对照同目录官方 SHASUMS256.txt 校验文件后解压，将解压后的运行时目录放到项目 `.cache/node/`，确保存在 `.cache/node/bin/node` 和 `.cache/node/bin/npm`。

在项目根目录运行：

```sh
chmod +x scripts/npm-local.sh
./scripts/npm-local.sh ci --ignore-scripts
./scripts/npm-local.sh run setup:electron
./scripts/npm-local.sh run rebuild
./scripts/npm-local.sh run typecheck
./scripts/npm-local.sh test
./scripts/npm-local.sh run dev
```

安装依赖需要联网。应用运行和记账不需要联网或 API Key。SQLite 原生模块须匹配本机 Electron，不能复制其他系统的 node_modules。

## Windows 上构建免安装版

下载 Node 22 的官方 Windows x64 ZIP 并校验后，将其内容放到项目 `.cache/node/`，确保有 `node.exe` 和 `npm.cmd`。然后运行：

```powershell
.\scripts\build-windows.ps1
```

生成的完整便携文件夹在 `release/SteamLog-win32-x64/`。发给使用者时压缩整个文件夹；运行前完整解压，再双击 `SteamLog.exe`。详见 [DEPLOYMENT_WINDOWS.md](DEPLOYMENT_WINDOWS.md)。

## 营业数据必须单独保留

- 本机开发版数据位于 `.dev-data/`。
- Windows 便携版数据位于 `SteamLog.exe` 旁的 `data/`。
- GitHub 仓库排除了这些目录及数据库、备份、导出和日志。
- 删除或移动本地项目之前，先正常退出程序，完整备份上述实际使用的数据目录到其他安全位置，并验证备份可读取和恢复。不要在程序运行时单独复制正在写入的数据库。
- 重新下载源码不会自动恢复真实流水。恢复开发版时，将保存的 `.dev-data/` 放回项目根目录；便携版则保留原 `data/` 并替换程序文件。也可按程序内备份恢复流程恢复经过校验的快照。
- 保留当前新版程序或备份；v5 数据库不能用较旧版本直接打开。

## 修改后保存回 GitHub

每次修改后，先检查要提交的文件，运行密钥检查和相关测试，再提交并推送。GitHub 网页也能上传修改过的源码。上传源码前不要选中整个含数据和缓存的项目文件夹。

本项目没有附带开放源代码许可证；保存到私有仓库不等于授权他人销售或使用。
