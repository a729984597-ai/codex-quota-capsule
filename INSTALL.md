# 安装与运行（Windows）

## 最终用户（推荐）

1. 安装 [Node.js 22+](https://nodejs.org/)（刷新桥接需要；Cursor 用量读取依赖 Node 内置 sqlite）
2. （可选）Codex CLI（`npm i -g @openai/codex`）并 `codex login`
3. （可选）本机已登录 Cursor（用于 Cursor 用量）
4. 运行绿色版或安装包：
   - **绿色版**：仓库根目录 `Quota Capsule Beta.exe` + 同目录 `resources/`
   - **安装包**：`apps/windows/src-tauri/target/release/bundle/nsis/Quota Capsule Beta_*_x64-setup.exe`
5. 托盘 **监控源**：
   - **自动**：Cursor 进程在跑则盯 Cursor，否则盯 Codex
   - **仅 Cursor / 仅 Codex**
   - **都显示**：一颗胶囊同时展示两家

> 未签名安装包可能被 SmartScreen 拦截，选择「仍要运行」即可。

## 前置条件（开发/打包）

- Windows 10/11
- Node.js 22+（`node:sqlite`）
- Rust + VS 2022 Build Tools + WebView2
- Codex 与/或 Cursor 已登录

## 开发

```powershell
npm ci
npm test
# MSVC 环境：
npm run win:dev
```

## 打包

```powershell
npm run win:build
```

产出根目录免安装 exe，以及 NSIS 安装包。

## 故障排查

| 现象 | 处理 |
| --- | --- |
| Cursor `auth_required` | 在 Cursor 内重新登录 |
| Cursor `cli_missing` | 确认 `%APPDATA%\Cursor\User\globalStorage\state.vscdb` 存在 |
| Codex `cli_missing` | 安装 Codex CLI |
| Codex `auth_required` | 终端执行 `codex login` |
| `node_missing` | 安装 Node 22+ |
| 桥接脚本缺失 | 确认 exe 旁有 `resources/` |

## 验收清单

1. `npm test` 通过
2. `npm run win:build` 产出 exe
3. 自动 / 单源 / 都显示均可切换
4. Cursor 未登录时不崩溃
5. AppData JSON 无 secrets
