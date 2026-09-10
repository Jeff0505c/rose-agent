# 第三方组件与许可

本仓库**不分发**任何第三方二进制；运行时资产由使用者在本地获取（见 `npm run setup`）。

## 运行时资产（不随仓库分发）

| 组件 | 许可 | 获取方式 |
|---|---|---|
| [codex CLI](https://github.com/openai/codex)（唯一执行引擎） | Apache-2.0 | `npm run setup` 按平台下载并按 SHA256 校验（版本锁在 `scripts/codex-pin.json`） |
| [Electron](https://github.com/electron/electron) | MIT | `npm run install` 安装依赖时获取；打包产物会随附其 LICENSE 与 Chromium 许可清单 |
| [github-mcp-server](https://github.com/github/github-mcp-server)（可选工具） | MIT | 自行下载放入 `tools/`（仓库不含） |

## 随仓库分发的默认技能（`defaults/skills/`，共 49 个）

| 来源 | 数量 | 许可 |
|---|---|---|
| [everything-claude-code (ECC)](https://github.com/affaan-m/ECC) | 39 | MIT |
| [superpowers](https://github.com/obra/superpowers) | 8 | MIT |
| 自带 LICENSE.txt 的技能（`frontend-design`、`skill-creator`） | 2 | Apache-2.0 |

**刻意不包含** Anthropic 发布的技能（docx / pdf / pptx / xlsx / mcp-builder / theme-factory /
web-artifacts-builder / webapp-testing）：其附带许可明确禁止"复制、在服务之外保留副本、分发、
创建衍生作品"，不适合放进公开仓库。若你已通过官方渠道获得使用权，可自行在应用内导入
（设置 → 技能 → 导入）。
