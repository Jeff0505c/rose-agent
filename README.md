<img src="APP/UI/logo/rose-lockup.svg" alt="ROSE" width="420">

# ROSE

自包含的**本地多角色 AI 智能体桌面应用**，唯一执行引擎是
[codex](https://github.com/openai/codex) 的 `app-server`。
支持 **macOS (Apple Silicon)** 与 **Windows 10/11 (x64)**。

模型 API Key 只存本地；不需要 `~/.codex`，也不需要预先安装任何 agent 框架；
应用**零运行时依赖**、不监听任何端口（界面由 Electron 直接渲染，主进程经 IPC 直连引擎）。

## 功能

- **多角色**：每个角色独立人格（`soul.md`）、记忆、技能与 MCP 绑定，互不污染
- **按轮切换**：模型 / 供应商 / 沙箱级别 / 审批策略每轮注入，换模型无需重启；工作目录按会话固定
- **原生沙箱**：macOS 用系统 seatbelt；Windows 用 codex 原生沙箱
- **上下文管理**：实时占用圆环（悬停看具体数值）、可配自动压缩阈值、一键压缩
  （走官方 `thread/compact/start`；压缩期间该会话显示进度蒙版，可切到其他会话继续工作）
- **原生指令**：输入 `/` 唤起指令面板（↑↓ 选择、回车执行），含
  `/compact`、`/model`、`/approvals`、`/plan`、`/rename`、`/status`、`/new`、
  `/init`、`/skills`、`/mcp`、`/usage`、`/settings`、`/help`；未命中指令时照常当消息发送
- **并行会话**：多会话/多角色同时执行；询问与审批弹窗按来源会话排队，不会串台；
  运行中可插话（steering）或排队后续消息
- **计划模式**：只读调研 → 产出计划 → 确认后实施（模型判定需要计划时可自动进出）
- **技能与 MCP**：可导入 zip 技能并按角色绑定；MCP 支持 stdio / HTTP / SSE
- **本地优先**：中英双语、浅色/深色主题、可收起侧栏；数据（会话/记忆/上传）都在本地目录

## 安装

需要 Node ≥ 22.15（仅用于安装依赖与脚本；应用运行时不需要 Node）。

```bash
git clone <repo> && cd <repo>
npm run install      # 安装依赖：自动探测并选择 npm registry 与 Electron 下载通道
npm run setup        # 拉取当前平台的 codex 引擎二进制（SHA256 锁定 + 落位后自检）
npm run start        # 启动
```

首次使用：**设置 → 模型配置** 新增 Provider 并填入 API Key、启用模型 → 新建会话，选角色与模型即可对话。
Windows 首次会提示初始化沙箱（`elevated` 需一次管理员授权；也可改用 `unelevated`）。
环境自检：`npm run doctor`（会检查数据目录可写、引擎二进制是否完整可执行等）。

引擎资产按版本锁定（`scripts/codex-pin.json`）：下载后校验 SHA256、原子落位，并真跑一次
`--version`；任一环节失败会明确报错，不会留下"看起来存在但起不来"的半成品。

## 许可

[MIT](LICENSE)。第三方组件与随仓库分发的默认技能许可见 [THIRD-PARTY.md](THIRD-PARTY.md)。
本仓库**不分发**任何二进制（codex / Electron / 工具），运行时按需拉取并校验。
