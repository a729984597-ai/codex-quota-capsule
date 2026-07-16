# 安装与运行（Windows）

## 前置条件

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

- `QUOTA_CAPSULE_ROOT`：仓库根目录（定位 `scripts/refresh-once.mjs`）

## 打包

```powershell
npm run win:build
```

产物在 `apps/windows/src-tauri/target/release/bundle/`。

## 故障排查

| 现象 | 处理 |
| --- | --- |
| 状态 `cli_missing` | 安装 Codex CLI，确认 `codex.cmd` 存在 |
| 状态 `auth_required` | 在终端自行 `codex login`（本应用不代登录） |
| 状态 `node_missing` | 安装 Node 20+ 并确保 PATH 可用 |
| 每分钟闪黑框 | 确认使用当前版本（spawn 带 `CREATE_NO_WINDOW`） |
| 中文乱码 | 已改为 `--out` 文件传递 JSON；升级后重启应用 |

## 验收清单

1. `npm test` 通过
2. `npm run win:build` 产出可执行文件
3. 已登录 Codex 时：启动后胶囊更新；托盘「立即刷新」可用
4. Codex 不可用：显示不可用/旧数据，不崩溃
5. 托盘可隐藏/显示/退出
6. `%AppData%\Quota Capsule Beta\last-success.json` 无 secrets
