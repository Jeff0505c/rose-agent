---
name: office-xlsx
description: "用 ROSE 随包工具链读取、创建、修改 Excel 工作簿（.xlsx），含数据、公式、格式与 pandas 分析。触发词：Excel、表格、工作簿、.xlsx、透视、汇总、数据清洗、报表、图表、公式、多工作表。把 .xlsx 当输入或交付物时先加载本技能。全流程使用随包 Python（openpyxl / XlsxWriter / pandas）与随包只读结构检查器，不依赖用户自装运行时。纯数据与公式任务不需要视觉检查；只有排版美化才需要考虑渲染。不要用于 Word（.docx）或 PPT（.pptx）。"
---

# XLSX（Excel 工作簿）· 随包工具链

一切命令走 **ROSE 随包 Office 运行时**（自带 Python 3.12 + openpyxl/XlsxWriter/pandas/numpy 等库）。
**硬规则**：只用绝对路径调用随包解释器；**不**回退系统 `python3`/Excel/`soffice`。

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

## 新建工作簿（openpyxl）

```python
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment

wb = Workbook()
ws = wb.active
ws.title = "明细"
ws.append(["月份", "营收", "成本", "毛利"])
for row in (("1月", 120, 80), ("2月", 155, 92)):
    ws.append(row)
ws["D2"] = "=B2-C2"                     # 公式写字符串，Excel 打开时计算
ws["D3"] = "=B3-C3"
ws.freeze_panes = "A2"
ws.column_dimensions["A"].width = 12
ws["A1"].font = Font(bold=True)
ws["A1"].fill = PatternFill("solid", fgColor="DDEBF7")
ws["B2"].number_format = "#,##0.00"
ws.merge_cells("A5:D5")
ws["A5"] = "合计"
ws["A5"].alignment = Alignment(horizontal="center")
wb.save("report.xlsx")
```

- **公式不会被本工具链求值**：检查器只确认公式存在；要"结果值"就得自己用 pandas/numpy 算出数值再写入（推荐做法：写值 + 另写一列公式，或值公式二者择一）。
- 大表不要逐格赋值：用 `ws.append(list)` 或 pandas `to_excel`。
- 需要图表/精细格式且**只新建**时用 XlsxWriter（`Workbook("out.xlsx")` + `add_chart`）——它**不能读改已有文件**。

## 读取与修改

```python
from openpyxl import load_workbook

wb = load_workbook("in.xlsx")                    # 公式原样读回（"=B2-C2"）
ws = wb["明细"]
for row in ws.iter_rows(min_row=2, values_only=True):
    print(row)

wb2 = load_workbook("in.xlsx", data_only=True)   # 读缓存值
# ⚠ 若该文件从未被 Excel/WPS 打开保存过，缓存值不存在 → 单元格读出 None（不是 0，也不是错误）
```

pandas 路径（数据分析首选）：

```python
import pandas as pd
df = pd.read_excel("in.xlsx", sheet_name="明细")       # 需要 openpyxl（随包已装）
summary = df.groupby("月份", as_index=False)[["营收", "成本"]].sum()
with pd.ExcelWriter("out.xlsx", engine="openpyxl") as w:
    df.to_excel(w, sheet_name="明细", index=False)
    summary.to_excel(w, sheet_name="汇总", index=False)
```

- 保留原文件格式的改法：`load_workbook` 后只改需要的单元格再 `save`（openpyxl 会保留大部分样式，但会丢掉图表/宏/部分控件）。
- 多工作表：`wb.create_sheet("汇总")`、`wb.sheetnames`、`wb.remove(ws)`。

## 交付前：结构检查（必做）

```bash
"$PY" "$CHECK" report.xlsx --contains "毛利" --contains "合计" --count 2
```

- `--count N` 指**工作表数量**；`--contains` 断言单元格文本（共享字符串与内联字符串都覆盖）。
- 报告里 `counts.formulas` 会告诉你公式个数——**只表示存在**，不表示算得对。
- 退出码 0 = 断言全过；1 = 失败（看 `errors`）；2 = 参数错。

## 视觉检查的取舍

- **纯数据/公式任务不做视觉检查**（对齐 DSH 的口径）：正确性靠断言（`--contains`/`--count`）与你自己算出的数值。
- 只有"排版要好看"（列宽、配色、打印区域）才谈得上渲染；**本轮没有随包渲染器**，
  如实告知用户"渲染组件未安装（后续阶段）"，**不要**调用系统 Excel/LibreOffice 顶替，也不要凭想象描述观感。

## 能力边界

- 只认 `.xlsx`（旧格式 `.xls`、加密、宏工作簿不在支持范围）。
- openpyxl 保存会丢弃图表、宏与部分控件；需要这些东西时改用 XlsxWriter 重建（只新建）。
