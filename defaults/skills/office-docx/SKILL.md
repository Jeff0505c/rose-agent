---
name: office-docx
description: "用 ROSE 随包工具链创建、读取、修改 Word 文档（.docx）。触发词：Word 文档、报告、备忘录、信函、模板、.docx、页眉页脚、表格、目录、批量替换、求职信、会议纪要。产出或修改 .docx 时先加载本技能。全流程使用随包 Python（python-docx）与随包只读结构检查器，不依赖用户自装运行时；本轮不含渲染器，不宣称外观正确。不要用于 PDF、表格文件（.xlsx）或演示文稿（.pptx）。"
---

# DOCX（Word 文档）· 随包工具链

本技能的一切命令都走 **ROSE 随包 Office 运行时**（自带 Python 3.12 + python-docx/lxml 等库）。
**硬规则**：只用绝对路径调用随包解释器；**不**回退系统 `python3`/`soffice`/`pandoc`；不以"我机器上能跑"为准。

## 第 0 步：取运行时绝对路径（每个会话第一次必做；**只读，不安装**）

ROSE 主进程**已在启动时把随包运行时预装到工作区内**，状态与清单都写在数据目录里：

```bash
# ① 看就绪状态（只读；这两个文件在会话工作区之外，但 workspace-write 下**允许读取**，不会触发审批）
cat "$ROSE_ROOT/work/data/runtime.json"        # → officeRuntime.state: ready | installing | missing-entry | failed | timeout
cat "$ROSE_ROOT/work/runtime/current.json"     # → paths.{python, pythonLibDir, checker, officeRuntime, node}
```

按 `officeRuntime.state` 分三种情况处理：

| 情况 | 怎么做 |
|---|---|
| `ready`（或 `current.json` 存在且路径可用） | 直接用下表的**绝对路径**开始干活 |
| `installing`（预装通常 1–2 秒完成） | **短暂等待后重读**（如 `sleep 2` 再读一次，最多重试几次）；**不要**自己去装（会撞安装锁并触发审批） |
| `current.json` 不存在 / `missing-entry` / `failed` / `timeout` | **明确告知用户**："运行时尚未就绪，ROSE 正在预装 / 请稍候或重启 ROSE 后再试"。不要静默，也不要改用系统解释器 |

从 JSON 里取这几个**绝对路径**（下文用 `$PY`、`$CHECK` 指代前两个）：

| 键 | 用途 |
|---|---|
| `paths.python` | 随包 Python 解释器（3.12.14）→ `$PY` |
| `paths.checker` | 只读 OOXML 结构检查器 → `$CHECK` |
| `paths.pythonLibDir` | 预装库目录（仅诊断：`import` 报错时把它写进报告） |
| `paths.officeRuntime` | 已安装副本内的入口（在会话工作区内；只用于 `status` / `verify` / `paths` 这类**只读**查询） |
| `paths.node` | 已安装副本内的 node 包壳（委托 ROSE 自带 Electron Node，同样在工作区内） |

> ⛔ **本技能不安装运行时，也不得自行运行安装命令。**
> 安装由 **ROSE 主进程**负责（启动即预装），或由**用户显式授权**后执行；模型**不得自作主张**。
> 原因：安装入口在包内路径 `$ROSE_RESOURCES/runtime/**`（会话工作区之外），在其上执行命令**每次都会触发权限审批门**，反复打断用户；主进程走的是免审批的预装路径。
> 若用户明确要求"现在就装/修运行时"，请让用户**重启 ROSE**（触发预装）或在 ROSE 界面里**显式授权**一次，然后重读上面的清单。

**硬规则**：只用清单里的绝对路径调用；**不搜索 PATH**；内置工具失败就报错，**不回退系统 python/LibreOffice/Word/Excel**（避免"在我机器上能跑"的假象）。

## 创建新文档

写一个 Python 脚本（不要一次性 `-c` 拼长串，便于复跑与修错），用 `$PY` 运行：

```python
from docx import Document
from docx.shared import Pt, Inches, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH

doc = Document()                       # 默认 A4；美式信纸：section.page_width/height 用 Inches(8.5)/Inches(11)
doc.add_heading("季度复盘", level=1)
p = doc.add_paragraph("正文段落。")
p.alignment = WD_ALIGN_PARAGRAPH.LEFT
doc.add_paragraph("要点一", style="List Bullet")

t = doc.add_table(rows=1, cols=3)
t.style = "Table Grid"                 # 不设样式在 Word 里是无框线表格
hdr = t.rows[0].cells
for cell, text in zip(hdr, ("项目", "负责人", "状态")):
    cell.text = text
for row in (("上线", "张三", "完成"), ("复盘", "李四", "进行中")):
    cells = t.add_row().cells
    for cell, text in zip(cells, row):
        cell.text = text

doc.save("report.docx")
```

- 中文字体：`run.font.name = "PingFang SC"` 只影响西文；中文需同时设置 `run._element.rPr.rFonts.set(qn('w:eastAsia'), 'PingFang SC')`（`from docx.oxml.ns import qn`）。
- 图片：`doc.add_picture("chart.png", width=Inches(6))`（用绝对路径）。
- **自动目录（TOC）python-docx 不直接支持**：需要手写 `fldChar` 域代码，且**必须由 Word 打开后更新域**才会显示页码。如果你只要"目录感"，用带标题层级的列表；如果坚持真 TOC，写完后明确告知用户"需在 Word 中右键更新域"。
- 页眉页脚：`section.header.paragraphs[0].text = "..."`（读回时它们在 `word/headerN.xml` 里，`doc.paragraphs` 看不到）。

## 读取与修改已有文档

```python
doc = Document("in.docx")               # 打开已有文件（不是新建）
keywords = [p.text for p in doc.paragraphs]
for t in doc.tables:
    for row in t.rows:
        for cell in row.cells:
            print(cell.text)
```

- 段落里"看起来连续的文字"在 XML 中常被拆成多个 run，**字符串查找可能落空** → 需要替换时逐 run 匹配，或按段落重建该段。
- 想直接改 XML（`unzip` → 改 `word/document.xml` → 重新 `zip`）也可以，但改完**必须过检查器**，且注意 `[Content_Types].xml`/关系文件不要动坏。

## 交付前：结构检查（必做）

```bash
"$PY" "$CHECK" report.docx --contains "季度复盘" --contains "进行中" --count 12
```

- `--count N` 这里指**主文档段落数**（页眉页脚与脚注不计入；用检查器报告里的 `counts.paragraphs` 校准）。
- 退出码 0 = 你请求的断言全过；1 = 文件/断言失败（读报告里的 `errors`）；2 = 参数错。
- 检查器**只**回答"包能不能打开、结构对不对、文本在不在"，**不**回答外观/排版/特性保留。

## 能力边界（如实告知，不要含糊）

- **本轮没有随包渲染器**（无 LibreOffice）：无法把 .docx 渲染成 PDF/图片做视觉检查。
  用户要"看一眼成品"时，如实现有渲染组件缺失，就说"渲染组件未安装（随包渲染为后续阶段）"，
  **不要**去找系统 LibreOffice/`soffice`/`pandoc` 顶替，也不要凭想象描述排版效果。
- 旧格式 `.doc`、加密文档、宏文档不在支持范围（检查器只认 `.docx`）。
