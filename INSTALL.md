# 安装与运行（Windows）

## 最终用户（推荐：下载绿色版）

不需要从源码编译，也**不必单独安装 Node.js**（绿色版已内置 Node 22 运行时）。

到 GitHub **Releases** 下载 `Quota-Capsule-Beta-windows-portable.zip`：

1. 打开仓库 → **Releases**
2. 下载最新的 `Quota-Capsule-Beta-windows-portable.zip`
3. 解压后双击 `Quota Capsule Beta.exe`（需保留同目录 `resources/`，内含桥接脚本与 Node）
4. （可选）本机已登录 Codex（`codex login`）和/或 Cursor

> 未签名安装包可能被 SmartScreen 拦截，选择「仍要运行」即可。  
> `git clone` **不会**带上 exe（体积大，已忽略）；要「下载即用」请走 Releases。

### 别的电脑「没效果」时先核对

托盘出现蓝色图标 = 应用已启动。若胶囊显示「数据暂不可用」或一直「刷新中」，按下面排查：

1. **解压完整**：`Quota Capsule Beta.exe` 与同目录 `resources/` 必须在一起（`resources/runtime/node/node.exe` 应存在）
2. 请使用 **v0.1.0-beta.4+**（已修复 Node 22 对 `\\?\` 长路径前缀的兼容问题）
3. 托盘右键 → **监控源**：
   - 主要用 Cursor → 选「仅 Cursor」或「都显示」（并确保本机已登录 Cursor）
   - 主要用 Codex → 安装 Codex CLI 后执行 `codex login`，再点「立即刷新」
4. 左键托盘图标可重新显示悬浮窗；右键可「显示胶囊 / 立即刷新」
5. 点开胶囊展开，查看完整原因文案

### 维护者：如何发布绿色版

```powershell
git tag v0.1.0-beta.2
git push origin v0.1.0-beta.2
```

推送 `v*` 标签后，GitHub Actions 会自动打包并上传到该 Release。也可在 Actions 里手动跑 **Release Windows portable**。

## 最终用户（本地已有构建产物时）

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
