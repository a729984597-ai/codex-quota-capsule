# Quota Capsule（Windows）

面向 Codex / Cursor 用户的 Windows 桌面额度胶囊：悬浮窗 + 系统托盘，只读本机额度周期，直观显示距离用尽还有多少余量。

## 功能（MVP）

- 无边框置顶悬浮胶囊（可拖动、单击展开）
- 系统托盘：显示/隐藏、立即刷新、退出
- 监控源：自动 / 仅 Cursor / 仅 Codex / **都显示**
- 五状态：充足 / 偏低 / 紧张 / 已用尽 / 数据暂不可用
- 60 秒自动刷新 + 手动刷新
- 本地持久化最近成功快照、窗口位置、监控源偏好（`%AppData%\Quota Capsule Beta\`）
- 可双击运行的 `.exe` / NSIS 安装包（`npm run win:build`）

## 技术栈

- TypeScript：`packages/core`、`packages/source-codex`、`packages/source-cursor`
- Tauri 2：`apps/windows`
- 桥接脚本：打包进应用 `resources/`，由本机 Node 22+ 执行

## 快速开始

- **只想用**：到 GitHub [Releases](https://github.com/a729984597-ai/codex-quota-capsule/releases) 下载绿色版 zip，解压后双击 `Quota Capsule Beta.exe`（绿色版已内置 Node，无需另装）。
- **开发/打包**：见 [INSTALL.md](./INSTALL.md)。

> `git clone` 不会附带 exe；绿色版通过 Release 分发。

## 隐私

- Codex：只读本地 `account/rateLimits/read`
- Cursor：只读本机 `state.vscdb` 中的 accessToken，调用用量 API；**不写回、不落盘 token**
- 不 logout、不上传；日志不含 token / cookie / prompt

## 许可

MIT
