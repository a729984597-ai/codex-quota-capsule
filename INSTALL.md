# 安装与运行（Windows）

## 最终用户（推荐）

1. 安装 [Node.js 20+](https://nodejs.org/)（运行时刷新桥接需要）
2. 安装 Codex CLI（`npm i -g @openai/codex`）并自行 `codex login`
3. 运行安装包或绿色版：
   - **绿色版（免安装，仓库根目录）**：双击 `Quota Capsule Beta.exe`（需与同目录 `resources/` 一起保留）
   - **安装包**：`apps/windows/src-tauri/target/release/bundle/nsis/Quota Capsule Beta_0.1.0_x64-setup.exe`
4. 双击启动；托盘可显示/隐藏、立即刷新、退出

> 未签名安装包可能被 SmartScreen 拦截，选择「仍要运行」即可（本项目暂不代码签名）。

运行时仍需要本机 **Node** 与已登录的 **Codex CLI**；应用本身是独立 `.exe`，不再依赖 `npm run win:dev`。

## 前置条件（开发/打包）

- Windows 10/11
- Node.js 20+（系统 PATH 可访问，或位于 `C:\Program Files\nodejs\node.exe`）
- Rust（rustup）+ Visual Studio 2022 Build Tools（C++ 工作负载）
- WebView2 Runtime（一般已随 Edge 安装）
- Codex CLI（`@openai/codex`）且已登录

> 本机若 `%APPDATA%\npm` 不在 PATH，应用仍会探测 `%APPDATA%\npm\codex.cmd`。

## 开发

```powershell
npm ci
npm test
npm run build
# 在已加载 MSVC 环境的终端中：
npm run win:dev
```

可选环境变量：

- `QUOTA_CAPSULE_ROOT`：仓库根目录（定位 `scripts/refresh-once.mjs`；正式包一般不需要）

## 打包为 .exe

在已加载 MSVC（`vcvars64.bat`）的终端中：

```powershell
npm run win:build
```

会：

1. 构建 `packages/core`、`packages/source-codex`
2. 暂存桥接到 `apps/windows/src-tauri/resources/`
3. 产出：
   - 仓库根目录：`Quota Capsule Beta.exe` + `resources/`（免安装，可直接双击）
   - `apps/windows/src-tauri/target/release/bundle/nsis/Quota Capsule Beta_*_x64-setup.exe`

## 故障排查

| 现象 | 处理 |
| --- | --- |
| 状态 `cli_missing` | 安装 Codex CLI，确认 `codex.cmd` 存在 |
| 状态 `auth_required` | 在终端自行 `codex login`（本应用不代登录） |
| 状态 `node_missing` | 安装 Node 20+ 并确保 PATH 可用 |
| 提示桥接脚本缺失 | 重新安装，或确认 exe 旁有 `resources/`；开发时设 `QUOTA_CAPSULE_ROOT` |
| 每分钟闪黑框 | 确认使用当前版本（spawn 带 `CREATE_NO_WINDOW`） |
| 中文乱码 | 已改为 `--out` 文件传递 JSON；升级后重启应用 |
| SmartScreen 警告 | 未签名安装包的预期行为，选择仍要运行 |

## 验收清单

1. `npm test` 通过
2. `npm run win:build` 产出 `.exe` 与 NSIS 安装包
3. 双击 `.exe`：已登录 Codex 时胶囊更新；托盘「立即刷新」可用
4. Codex 不可用：显示不可用/旧数据，不崩溃
5. 托盘可隐藏/显示/退出
6. `%AppData%\Quota Capsule Beta\last-success.json` 无 secrets
