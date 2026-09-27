---
name: office-pptx
description: "用 ROSE 随包工具链创建、读取、修改 PowerPoint 演示文稿（.pptx）。触发词：PPT、演示文稿、幻灯片、汇报材料、路演、培训课件、.pptx、加一页、换模板、图表页。产出或修改 .pptx 时先加载本技能。全流程使用随包 Python（python-pptx）与随包只读结构检查器，不依赖用户自装运行时；本轮不含渲染器，不宣称版式外观正确。不要用于 Word（.docx）或 Excel（.xlsx）。"
---

# PPTX（PowerPoint 演示文稿）· 随包工具链

一切命令走 **ROSE 随包 Office 运行时**（自带 Python 3.12 + python-pptx/lxml/Pillow 等库）。
**硬规则**：只用绝对路径调用随包解释器；**不**回退系统 `python3`/`soffice`/`libreoffice`。

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

## 新建演示文稿

```python
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE

prs = Presentation()                    # 默认模板 16:9？——实为 4:3(10x7.5in)；16:9 见下
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)   # 显式设成 16:9

blank = prs.slide_layouts[6]            # 默认模板里 Blank 通常是 6；用前先打印名字核对
for layout in prs.slide_layouts:
    print(layout.name)                  # 换模板后索引会变：按名字选，别写死

s1 = prs.slides.add_slide(prs.slide_layouts[0])   # 标题版式
s1.shapes.title.text = "季度汇报"
s1.placeholders[1].text = "2026-09 · 产品组"

s2 = prs.slides.add_slide(blank)
box = s2.shapes.add_textbox(Inches(0.6), Inches(0.6), Inches(12), Inches(1.2))
tf = box.text_frame
tf.text = "要点一"                       # 第一段
p = tf.add_paragraph()                  # 后续段落必须 add_paragraph，不要用 "\n"
p.text = "要点二"
p.font.size = Pt(18)

# 表格
tbl = s2.shapes.add_table(3, 3, Inches(0.6), Inches(2.2), Inches(12), Inches(2.5)).table
tbl.cell(0, 0).text = "指标"

# 图表
data = CategoryChartData()
data.categories = ["Q1", "Q2", "Q3"]
data.add_series("营收", (12.0, 15.5, 18.2))
s3 = prs.slides.add_slide(blank)
s3.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(0.6), Inches(1.5),
                    Inches(11), Inches(4.5), data)

prs.save("deck.pptx")
```

- 图片用绝对路径：`slide.shapes.add_picture("/abs/path/pic.png", Inches(1), Inches(1), width=Inches(4))`。
- 占位符文本：`shapes.title` 可能为 `None`（版式没有标题占位符）→ 用 `add_textbox` 兜底。
- **python-pptx 不提供"复制幻灯片"**：要复制版式请用 `add_slide(相同 layout)` 重建内容。
- 文字溢出（autofit）由 PowerPoint 决定，库层面测不出 → 每页文字**少而短**；不要靠缩字号硬塞。

## 读取与修改

```python
prs = Presentation("deck.pptx")
for i, slide in enumerate(prs.slides, 1):
    print(i, [sh.shape_type for sh in slide.shapes])
    for shape in slide.shapes:
        if shape.has_text_frame:
            print(shape.text_frame.text)
```

- `prs.slides` 是只读视图；删页/改页序需要操作 XML（`prs.slides._sldIdLst`），改完**必须**过检查器。
- 模板文件（`.potx`）解包/打包方式与 `.pptx` 相同，但**保留原扩展名**。

## 交付前：结构检查（必做）

```bash
"$PY" "$CHECK" deck.pptx --contains "季度汇报" --count 3
```

- `--count N` 指**幻灯片张数**；`--contains` 断言正文文本（含表格与文本框里的 `a:t`）。
- 退出码 0 = 断言全过；1 = 失败（看 `errors`）；2 = 参数错。
- 检查器不检查版式重叠、字号可读性、图片裁切等**外观**问题。

## 能力边界（如实告知）

- **本轮没有随包渲染器**：无法把 .pptx 渲染成图片/PDF 做视觉检查（DSH 也把渲染列为可选路径）。
  用户要看效果时，如实说明"随包渲染组件未安装（后续阶段）"，**不要**调用系统 PowerPoint/LibreOffice，
  也不要凭想象描述版式。
- 旧格式 `.ppt`、加密与宏演示文稿不在支持范围。
