# Quota Capsule（Windows）

面向 Codex 用户的 Windows 桌面额度胶囊：悬浮窗 + 系统托盘，只读本机 Codex 周额度，回答「按当前节奏能不能撑到下次重置」。

## 功能（MVP）

- 无边框置顶悬浮胶囊（可拖动、单击展开）
- 系统托盘：显示/隐藏、立即刷新、退出
- 六状态：初步判断 / 够用 / 偏快 / 可能不够 / 已用尽 / 数据暂不可用
- 60 秒自动刷新 + 手动刷新
- 本地持久化最近成功快照与窗口位置（`%AppData%\Quota Capsule Beta\`）
- 可双击运行的 `.exe` / NSIS 安装包（`npm run win:build`）

## 技术栈

- TypeScript：`packages/core`、`packages/source-codex`
- Tauri 2：`apps/windows`
- 桥接脚本：打包进应用 `resources/`，由本机 Node 执行（仍需系统 Node + Codex CLI）

## 快速开始

见 [INSTALL.md](./INSTALL.md)。

最终用户：仓库根目录双击 `Quota Capsule Beta.exe`（需带同目录 `resources/`），或安装 NSIS 包。  
开发者：`npm run win:dev` 热重载；`npm run win:build` 产出安装包并复制免安装版到根目录。

## 隐私

- 只读 Codex `account/rateLimits/read`
- 不登录、不 logout、不上传
- 日志与落盘不含 token / cookie / prompt

## 许可

MIT
