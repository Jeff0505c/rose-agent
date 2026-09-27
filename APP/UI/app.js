'use strict';
/* ROSE 前端逻辑（零依赖，原生 JS + SSE） */

if (window.rose && window.rose.createEventSource) window.EventSource = window.rose.createEventSource;   // 桌面垫片：SSE → IPC（工厂，可被 new）

const $ = (s) => document.querySelector(s);

/* ---------- i18n（中/英，分批覆盖；settings.global.language: zh | en） ---------- */
const I18N = {
  zh: { newChat:'新会话', searchPh:'搜索会话…', settingsBtn:'设置', sendBtn:'发送', stopBtn:'■ 停止', inputPh:'发消息…（⏎ 发送 / ⇧⏎ 换行）',
    'status.ready':'就绪','status.running':'处理中…','status.error':'出错','status.approvalWait':'等待人工审批',
    'usage.loading':'加载中…','usage.totalTokens':'累计 Tokens','usage.totalTurns':'累计轮次','usage.today':'今日轮次','usage.week':'近 7 天轮次','usage.input':'输入','usage.output':'输出','usage.cached':'其中缓存命中','usage.byModel':'按模型分布','usage.trend':'近 14 天趋势','usage.byRole':'按角色','usage.none':'暂无数据',
    'prompt.title':'全局提示词 AGENTS-GLOBAL.md','prompt.desc':'对所有角色生效；保存后同步到每个运行实例，新对话生效。',
    'common.save':'保存','common.ok':'知道了','common.saveOk':'✓ 已保存','common.polish':'AI 润色',
    'model.enabledHint':'展开 Provider → 点「获取模型」→ 勾选即启用（取消勾选即停用）。每行右侧「改请求名」可就地修改发给供应商的 model 字段。保存后生效。','model.providersTitle':'模型来源 · Provider','model.addProvider':'新增模型配置','model.badgeLocal':'本地·无需Key','model.badgeSet':'已配Key','model.badgeUnset':'无Key','model.delProvider':'删除该 Provider','model.nameLabel':'供应商名称（显示名，可自定义）','model.apiKey':'API Key','model.noKey':'本地模型，无需 API Key','model.keepBlank':'••••••••（留空保持不变）','model.fetch':'获取模型','model.fetchHint':'拉取该 endpoint 的可用模型','model.cachedHas':'已缓存 {n} 个模型','model.metaHas':'{m} 个模型 · {e} 个已启用','model.unset':'未配置','model.filter':'过滤模型…','model.save':'保存模型配置','model.choosePh':'（请选择模型）','model.reqName':'请求名称','model.editReq':'改请求名','model.custom':'自定义','model.listEmpty':'（尚未获取模型；可点上方「获取模型」，或在下方直接填请求名添加）','model.editReqHint':'修改发给供应商的请求名称（model 字段）','model.reqNameHint':'请求名称＝发给供应商的 model 字段（名称下排小字）。列表里没有的模型可在此直接添加：别名、自建网关、预览版都适用。','model.reqNamePh':'例如 deepseek-chat','model.addReq':'添加','model.dupReq':'该请求名称「{n}」已在此供应商下启用','model.reqAdded':'已添加 {n} —— 记得点下方「保存模型配置」','model.renamedSync':'请求名已改为 {to}（原 {from}）；已同步更新 {n} 个使用该模型的会话','model.saveFail':'保存失败：',
    'unsaved.title':'有未保存的更改','unsaved.msg':'模型配置里有改动尚未保存。现在保存吗？','unsaved.save':'保存并关闭','unsaved.discard':'不保存','model.pruned':'已移除 {n} 个失效模型','model.pickTitle':'请选择模型','model.pickMsg':'这个会话还没有选择模型。请在发送框旁的模型下拉里选择本次对话要用的模型。',
    'dlg.close':'关闭','dlg.closeDeny':'关闭（视为拒绝）','dlg.closeSkip':'关闭（跳过，不回答）','ask.title':'需要你的选择','ask.submit':'提交回答','appr.deny':'拒绝','appr.allow':'允许','appr.waitChip':'等待人工审批','appr.waitNote':'该命令正在等待你的人工审批（尚未开始执行）：{c}','appr.deniedChip':'已拒绝，命令未执行','appr.deniedNote':'你已拒绝该操作，命令未执行。','appr.undeliverableChip':'审批未送达','appr.undeliverable':'审批未能送达引擎（{r}）；该操作未执行。','appr.turnEnded':'审批未完成（回合已结束）','appr.submitting':'提交中…','appr.sendFailMsg':'审批提交失败：{e}。任务仍在等待你的决定，请重试或用「拒绝」结束。','appr.sendFailThrown':'IPC/网络异常：{e}','appr.sendFailUnknown':'服务端未返回可读原因','mcpUI.title':'新增 MCP 服务器','mcpUI.type':'服务器类型','mcpUI.typeStdio':'本地进程（stdio：uvx / npx / node 命令）','mcpUI.typeHttp':'远程 · Streamable HTTP（填 URL）','mcpUI.typeSse':'远程 · SSE（旧式 HTTP+SSE，填 URL）','mcpUI.name':'名称（唯一）','mcpUI.namePh':'例如 my-server','mcpUI.args':'参数（空格分隔，可空）','mcpUI.env':'环境变量（每行 KEY=VALUE，可空）','mcpUI.headers':'请求头（每行 Key: Value，可空；鉴权如 Authorization: Bearer xxx）','mcpUI.scope':'绑定范围','mcpUI.test':'测试连接',

    'skill.bar':'技能 · 全局通用 / 角色专用',
    'mcpX.scopeGlobal':'全局（所有角色可用）','mcpX.roleScope':'角色专属','mcpX.testNeedUrl':'请先填 URL','mcpX.testNeedCmd':'请先填 command','mcpX.testing':'测试中…','mcpX.connOk':'✓ 连接成功，{n} 个工具：','mcpX.connFail':'连接失败',

    'editor.name':'名称','editor.icon':'图标','editor.desc':'简介','editor.soul':'角色提示词 · Soul（人格）','editor.agents':'角色提示词','editor.saveRole':'保存角色','editor.createRole':'创建角色','editor.newRoleTitle':'新增角色','editor.namePh':'例如：金融分析','editor.descPh':'一句话专业方向','editor.agentsPh':'定义专业方向、性格、行为准则','editor.needName':'请填写角色名称','polish.empty':'内容为空，无可润色','polish.polishing':'润色中','polish.doneCheck':'✓ 已润色，请检查后再保存','polish.done':'✓ 已润色','polish.fail':'润色失败','polish.failColon':'润色失败: ', 

    'mcp.title':'MCP 工具 · 全局通用 / 角色专属','mcp.add':'新增 MCP 服务器','mcp.note':'已激活 {a} / {t} 个 MCP 服务器','mcp.empty':'暂无 MCP 服务器，点右上角「新增 MCP 服务器」添加','mcp.delTitle':'删除 MCP 服务器','mcp.delMsg':'确定删除「{n}」？','mcp.hint':'已激活的全局 MCP 工具会注入所有角色；角色专属只注入绑定角色。变更后网关会重启 codex 进程以加载新配置。',
'skill.import':'导入技能','skill.importFolder':'导入文件夹','skill.importZip':'导入 zip','skill.activeNote':'已激活 {a} / {t} 个技能','skill.tagGlobal':'全局','skill.tagRole':'角色','skill.actOn':'已激活','skill.actOff':'未激活','skill.empty':'暂无技能，点右上角「导入技能」添加','skill.delSkillTitle':'删除技能','skill.delSkillMsg':'删除技能「{n}」？\n技能目录与绑定信息将被移除。','skill.importFail':'导入失败','skill.deleted':'已删除','skill.impOk':'✓ 导入 {n} 个','skill.impInvalid':'，{m} 个不合规',
 'sk.searchPh':'按名称搜索…','sk.filterAll':'全部角色','sk.noMatch':'没有匹配的技能','mcp.noMatch':'没有匹配的 MCP 服务器',
'model.urlKeyChanged':'URL / Key 已改动 — 点「获取模型」刷新可用模型','model.customName':'自定义供应商','model.addedTag':'已配置','model.customItem':'自定义…','model.customUrlHint':'手动填 URL，适配任意 OpenAI 兼容端点','model.fetching':'获取中…','model.fetchFail':'获取失败','model.delTitle':'删除 Provider','model.delMsg1':'确定删除','model.delMsg2':'？其已启用的模型会一并移除。',

    'memory.global':'全局记忆','memory.globalShared':'所有角色共享','memory.globalPh':'记录跨角色的全局事实、偏好与经验…','memory.roleSub':'角色记忆 · 每个角色独立，仅对对应角色生效','memory.rolePh':'该角色的专属记忆…','memory.noneRole':'暂无角色，先在「角色管理」创建',
    'roles.h4':'角色管理','roles.intro':'为不同专业或身份创建本地角色，并定义各自的人格与提示词；会话用到的沙箱、审批、模型在对话界面单独选择。','roles.add':'新增角色','roles.edit':'编辑','roles.delete':'删除','roles.delTitle':'删除角色','roles.delQ':'删除角色','roles.delWarn':'将同时删除该角色名下所有会话与其工作区，不可恢复。','roles.skillTitle':'专用技能','roles.skillKeep':'保留技能','roles.skillDel':'一并删除', 'roles.skillMsg':'该角色下有 {n} 个专用技能。是否一并删除？\n确定=一并删除技能；取消=保留技能（转为未激活）。',
'common.delete':'删除','common.cancel':'取消',

    'nav.model':'模型配置','nav.prompt':'全局提示词','nav.memory':'记忆','nav.roles':'角色管理','nav.skills':'技能','nav.mcp':'MCP 工具','nav.usage':'用量','nav.general':'通用','nav.env':'环境与诊断',
    'common.unavailable':'该能力当前不可用（服务或引擎未就绪）','cfgWarn.from':'（来自 {s}）','cfgWarn.engineRegression':'引擎配置生成异常（请反馈维护者，不是你的配置问题）：',
    
    'env.check':'环境自检','env.checkDesc':'检查运行时、数据目录、codex 二进制与已启用 MCP 的命令是否可用。只读检测，不修改任何文件。',
    'env.run':'重新检测','env.running':'检测中…','env.allOk':'全部通过','env.failCount':'{n} 项需要处理','env.warnCount':'{n} 项提示',
    'env.sandbox':'Windows 沙箱','env.sandboxDesc':'codex 在 Windows 上自带原生沙箱。elevated 创建独立低权限用户并配置防火墙（需一次管理员授权），unelevated 用受限令牌，网络隔离较弱。',
    'env.sandboxMode':'沙箱级别','env.sandboxElevated':'elevated（推荐）','env.sandboxUnelevated':'unelevated（无需管理员）',
    'env.sandboxStatus':'当前状态','env.sandboxInit':'初始化沙箱','env.sandboxInitRunning':'初始化中…','env.sandboxRecheck':'重新查询状态',
    'env.statusReady':'已就绪','env.statusNotConfigured':'未初始化','env.statusUpdateRequired':'需要更新','env.statusUnknown':'未知','env.statusError':'查询失败',
    'env.diag':'诊断导出','env.diagDesc':'导出一份已脱敏的文本报告（环境自检、沙箱状态、引擎 stderr、配置摘要）。API Key 不会出现在报告里，可直接贴到 issue。',
    'env.diagBtn':'导出诊断文件','env.diagDone':'已保存：{p}','env.diagFail':'导出失败：{e}',
    'env.mcpNote':'注意：本项目不内置 Node/uv 运行时。启用依赖 npx/uvx 的 MCP 时，需要系统已安装对应运行时。',
    'sb.setupOk':'沙箱初始化完成（{m}），状态已刷新为就绪。',
    'sb.setupFailedTitle':'沙箱初始化失败',
    'sb.setupFailedMsg':'模式 {m} 的初始化没有成功。codex 的原始报错如下：',
    'sb.tryUnelevated':'可以改用 unelevated 重试：它不需要管理员授权（用受限令牌 + ACL），代价是网络隔离较弱，但多数机器上比 elevated 更容易成功。',
    'sb.switchUnelevated':'改用 unelevated 重试',
    'sb.setupTimeout':'初始化在 90 秒内没有返回结果（可能卡在权限确认或被安全策略拦截）。',
    'sb.needsInit':'Windows 沙箱未初始化，命令执行可能失败（codex#37818）。点右侧按钮初始化。','sb.updateNeeded':'Windows 沙箱需要更新，请重新初始化。','sb.unknown':'无法确认 Windows 沙箱状态：{e}','sb.worldWritable':'检测到目录对所有人可写，建议收窄权限。',
    'gen.appearance':'外观 · 主题','gen.light':'浅色主题','gen.lightDesc':'明亮清爽，默认','gen.dark':'深色主题','gen.darkDesc':'暗色背景，夜间更护眼','gen.system':'跟随系统','gen.systemDesc':'随操作系统外观自动切换',
    'gen.lang':'界面语言 · Language',
    'gen.closeTitle':'关窗行为','gen.closeHide':'隐藏（默认）','gen.closeHideDesc':'关窗后应用与任务继续运行；点 Dock 图标或再次启动即可找回窗口','gen.closeQuit':'完全关闭','gen.closeQuitDesc':'关窗即退出应用；退出前会先确认运行中的任务','gen.closeNote':'两种行为都会在退出前确认运行中的任务，不会静默中断正在执行的工作。',
    'goal.title':'会话目标','goal.localTag':'本地目标（引擎不可用）','goal.edit':'编辑','goal.save':'保存','goal.cancel':'取消','goal.clear':'清除目标','goal.clearConfirm':'清除本会话的目标？','goal.statusPending':'待开始','goal.statusActive':'进行中','goal.statusDone':'已完成','goal.tokens':'已用 {u} / 预算 {l} tokens','goal.tokensNoBudget':'已用 {u} tokens','goal.editPh':'用一句话描述这个会话要达成的目标…','goal.saved':'✓ 目标已保存','goal.saveFail':'目标保存失败：','goal.unavailable':'目标服务当前不可用（引擎未就绪）；这不影响正常对话。','goal.needSession':'请先打开或新建一个会话，再设置目标',
    'win.reset':'已换窗口 · 检查点','win.resetCount':'已换窗口 · 检查点（第 {n} 次）','win.note':'引擎到达上下文上限后自动续接（不是手动压缩）；压缩环与压缩蒙版不受影响。',
    'sub.title':'子代理','sub.summary':'子代理 {a} 个 · 运行中 {r} · 等待 {w} · 已完成 {d}','sub.unsupported':'引擎未接线（{r}）','sub.stopTurn':'停止本回合（含子代理）','sub.stopTurnHint':'会中断整个回合（含其全部子代理）；app-server 不支持单独结束某一个子代理','sub.clearDone':'清空已完成','sub.stateSpawned':'已派出','sub.stateRunning':'运行中','sub.stateWaiting':'等待中','sub.stateDone':'已完成','sub.stateClosed':'已结束','sub.lastNone':'（暂无输出）',
    'feed.empty':'选择左侧会话，或新建一个','feed.you':'你','session.newChat':'新建会话','session.rename':'重命名','session.delete':'删除','session.noMatch':'无匹配会话','ask.allDone':'全部已答','ask.done':'已答 {a}/{n} 题',
    'role.title':'选择会话角色','role.noRoles':'暂无角色，需先创建','role.newRole':'新建角色',
    'think.title':'思考内容不保存，仅记录耗时','think.seconds':'思考了 {n} 秒','think.inProgress':'思考中','err.generic':'出错了',
    'tool.run':'运行中','tool.done':'完成','tool.fail':'失败','tool.processing':'正在处理…','plan.title':'执行计划',
    'ask.confirmed':'已确认','ask.pendingTitle':'待回答的问题','ask.pending':'待回答','ask.skipped':'（跳过）','ask.otherPh':'其他…','ask.answerPh':'输入你的回答…',
    'appr.needPrefix':'需要审批 · ','appr.operation':'操作','appr.mcpEscalateTitle':'提权授权 · 远程 MCP 工具','appr.mcpConfirmTitle':'确认 · MCP 请求','appr.mcpRun':'允许远程 MCP 执行工具：{t}','appr.patch':'写入审批 · apply_patch','appr.exec':'执行审批 · exec_command','appr.outPolicy':'该操作超出当前角色的沙箱/审批策略',
    'mode.needSess':'先打开或新建一个会话，再选择模式','mode.select':'选择会话模式','mode.plan':'✦ 计划','mode.default':'默认','mode.free':'零监管','mode.planT':'✦ 计划模式','mode.planD':'只读研究 · 产出计划 · 确认后实施（复杂任务建议）','mode.defaultT':'默认模式','mode.defaultD':'可写工作区 · 命令需审批 · 大改动前先说明方案','mode.freeT':'零监管模式','mode.freeD':'完全访问 · 自动执行 · 不审批（仅信任模型时使用）','search.clear':'清除','model.select':'选择本次对话使用的模型',
    'model.enableFirst':'（请先在 设置→模型配置 启用模型）','model.noModelTitle':'尚未配置模型','model.noModelMsg':'还没有启用任何模型。请先在「设置 → 模型配置」新增 Provider、填入 API Key 并启用模型。','model.goSettings':'去配置','att.remove':'移除','att.file':'附件','att.tooBig':'文件过大（>20MB）：','att.upload':'上传图片 / 文件','skill.choose':'选用技能','model.addProvTitle':'新增模型配置 · 选择厂商预设',
    'skill.noSess':'请先打开或新建一个会话，再选用技能','skill.noAvail':'当前会话暂无可用技能','skill.noAvailSub':'未导入/未激活；角色专用技能仅对绑定角色可见','skill.pickTitle':'选用技能（本次对话）',
    'dial.hint':'提示','dial.gotit':'知道了','sm.sub':'配置','stop.title':'停止当前任务（Esc×2）','send.title':'发送（⏎）','queue.title':'排队中（本轮结束后依次发送）','queue.edit':'编辑','queue.del':'删除','queue.steer':'插话发送（直接送进正在执行的任务）','queue.steerFail':'插话失败：','modal.from':'来自：{r} · {s}','modal.queuedMore':'还有 {n} 条来自其它会话的请求在排队','gen.ctxTitle':'上下文与自动压缩','gen.ctxPct':'自动压缩阈值（%）','gen.l0Unit':'tokens','gen.ctxPctShort':'压缩阈值','gen.l0Short':'工具输出上限','gen.l0Label':'单条工具输出上限（tokens）','gen.ctxSave':'保存','gen.ctxSaved':'已保存（下次引擎进程启动生效）','cfg.badTitle':'引擎配置有误','ctx.none':'上下文 —','ctx.usedTok':'已用 {n} tokens','ctx.noWindow':'窗口大小未实测（跑一轮后补全，届时显示百分比）','ctx.noneTip':'该会话还没跑过对话；跑过一轮后这里会显示上下文占用比例，点击可压缩','cfg.badMsg':'ROSE 生成的 config.toml 未被引擎接受，codex 已回落默认配置（模型/厂商/人格/MCP 都不生效，对话基本跑不通）。信息：','ws.pickTitle':'选择这个会话的工作目录','ws.fail':'创建会话失败：','ws.locked':'工作目录创建后不可更改（要换目录请新建会话）','ctx.title':'上下文占用 · 点击压缩上下文','ctx.used':'上下文 {p}%','ctx.compacting':'正在压缩…','ctx.done':'上下文已压缩','ctx.maskTitle':'正在压缩上下文…','ctx.maskSub':'压缩完成后本会话自动恢复；期间可以切换到其他会话继续工作。','ctx.maskElapsed':'已用 {n} 秒','ctx.fail':'压缩失败：','ctx.busy':'有任务进行中，请先停止再压缩上下文','ctx.timeout':'压缩等待超时，已解除本会话的等待状态（如仍需要压缩，可再次点击圆环重试）。','settings':'设置','nav.settings':'设置','side.collapse':'收起侧栏','side.expand':'展开侧栏','common.on':'开','common.off':'关','cmd.head':'指令','cmd.panelOpened':'已打开对应面板','cmd.fail':'执行失败：','cmd.needArg':'缺少参数：{n}','cmd.needSession':'请先打开一个会话再使用该指令','feed.noText':'（本轮无文本输出）','web.backendTitle':'搜索后端','web.mcpOk':'内置搜索工具已就位（模型可自行调用 web_search）','web.mcpDown':'内置搜索工具当前不可用：{r}','web.toolBadge':'内置搜索','web.backendHint':'联网由模型自行调用内置 `web_search` 工具，无需开关；这里只配置搜索后端（留空则用免 Key 的默认源）。','web.sources':'联网搜索 · {p} · {n} 条来源','web.none':'联网搜索没有返回结果','web.provider':'搜索源','web.keyPh':'SearXNG 地址或 API Key（可留空）','web.auto':'自动（推荐）','cmd.web.desc':'联网搜索并给出源链接','cmd.web.needArg':'用法：/web 关键词',
    'cmd.compact.desc':'压缩上下文（codex 官方 thread/compact/start）','cmd.compact.done':'已发起压缩，完成后占用会刷新',
    'cmd.model.desc':'查看/切换本会话模型','cmd.model.none':'没有已启用的模型（去 设置→模型配置 启用）','cmd.model.list':'已启用模型：','cmd.model.current':'当前','cmd.model.unknown':'没有匹配的模型：{n}','cmd.model.set':'本会话模型已切到 {n}（下一轮生效）',
    'cmd.approvals.desc':'查看/切换审批策略','cmd.approvals.cur':'当前审批策略：{n}','cmd.approvals.onRequest':'按需审批（推荐）','cmd.approvals.never':'从不审批（高危）','cmd.approvals.bad':'取值只能是 on-request 或 never','cmd.approvals.set':'审批策略已切到 {n}（下一轮生效）',
    'cmd.plan.desc':'进入/退出计划模式（只读研究后出计划）','cmd.plan.on':'已进入计划模式（只读）','cmd.plan.off':'已退出计划模式（可写工作区）',
    'cmd.rename.desc':'重命名当前会话','cmd.rename.need':'用法：/rename <标题>','cmd.rename.done':'会话已重命名为「{n}」',
    'cmd.status.desc':'查看当前会话配置与上下文占用','cmd.status.role':'角色','cmd.status.model':'模型','cmd.status.sandbox':'沙箱','cmd.status.approval':'审批','cmd.status.plan':'计划模式','cmd.status.workspace':'工作目录','cmd.status.context':'上下文','cmd.status.running':'运行中',
    'cmd.new.desc':'新建会话（选角色 + 工作目录）','cmd.new.done':'请在弹出的面板里选择角色',
    'cmd.init.desc':'生成 AGENTS.md（项目指令文件）','cmd.init.done':'已发出生成 AGENTS.md 的请求',
    'cmd.skills.desc':'打开技能选择器','cmd.mcp.desc':'打开 MCP 工具设置','cmd.usage.desc':'打开用量面板','cmd.settings.desc':'打开设置',
    'cmd.help.desc':'列出全部可用指令','cmd.help.title':'可用指令：','free.confirm':'将授予模型完全访问权限并自动执行所有命令，不做任何审批。\n\n仅在你完全信任模型且确知后果时使用。','free.enable':'仍然启用',
},
  en: { newChat:'New Chat', searchPh:'Search sessions…', settingsBtn:'Settings', sendBtn:'Send', stopBtn:'■ Stop', inputPh:'Message… (⏎ send / ⇧⏎ newline)',
    'status.ready':'Ready','status.running':'Working…','status.error':'Error','status.approvalWait':'Waiting for approval',
    'usage.loading':'Loading…','usage.totalTokens':'Cumulative Tokens','usage.totalTurns':'Cumulative Turns','usage.today':'Turns Today','usage.week':'Last 7 Days','usage.input':'Input','usage.output':'Output','usage.cached':'of which cached','usage.byModel':'By Model','usage.trend':'Last 14 Days','usage.byRole':'By Role','usage.none':'No data',
    'prompt.title':'Global Prompt — AGENTS-GLOBAL.md','prompt.desc':'Applies to all roles; synced to every running instance, effective on new chats.',
    'common.save':'Save','common.ok':'Got it','common.saveOk':'✓ Saved','common.polish':'AI Polish',
    'model.enabledHint':'Expand a provider → tap "Fetch models" → tick to enable (untick to disable). Use "Rename" on a row to edit the model field sent to the provider. Takes effect after saving.','model.providersTitle':'Model Sources · Providers','model.addProvider':'Add provider','model.badgeLocal':'Local · no key','model.badgeSet':'Key set','model.badgeUnset':'No key','model.delProvider':'Delete this provider','model.nameLabel':'Provider name (display, editable)','model.apiKey':'API Key','model.noKey':'Local model — no API key needed','model.keepBlank':'•••••••• (blank keeps current)','model.fetch':'Fetch models','model.fetchHint':'Load available models from this endpoint','model.cachedHas':'{n} model(s) cached','model.metaHas':'{m} models · {e} enabled','model.unset':'Not configured','model.filter':'Filter models…','model.save':'Save model config','model.choosePh':'(choose a model)','model.reqName':'Request name','model.editReq':'Rename','model.custom':'custom','model.listEmpty':'(no models fetched yet — use "Fetch models" above, or type a request name below)', 'model.editReqHint':'Edit the request name (model field) sent to the provider','model.reqNameHint':'The request name is the "model" field sent to the provider (small text under the name). Add any model missing from the list — aliases, self-hosted gateways, preview builds.','model.reqNamePh':'e.g. deepseek-chat','model.addReq':'Add','model.dupReq':'Request name "{n}" is already enabled for this provider','model.reqAdded':'Added {n} — remember to click Save model config below','model.renamedSync':'Request name changed to {to} (was {from}); {n} session(s) using it were updated','model.saveFail':'Save failed: ','unsaved.title':'Unsaved changes','unsaved.msg':'The model configuration has unsaved changes. Save them now?','unsaved.save':'Save & close','unsaved.discard':'Discard','model.pruned':'removed {n} stale model(s)','model.pickTitle':'Choose a model','model.pickMsg':'This session has no model selected yet. Pick one from the model dropdown next to the send box.',
    'dlg.close':'Close','dlg.closeDeny':'Close (treated as deny)','dlg.closeSkip':'Close (skip, no answer)','ask.title':'Your input is needed','ask.submit':'Submit answers','appr.deny':'Deny','appr.allow':'Allow','appr.waitChip':'Waiting for approval','appr.waitNote':'This command is waiting for your approval (not running yet): {c}','appr.deniedChip':'Denied — command not run','appr.deniedNote':'You denied this action; the command was not executed.','appr.undeliverableChip':'Approval not delivered','appr.undeliverable':'The approval could not be delivered to the engine ({r}); the action was not executed.','appr.turnEnded':'Approval unfinished (turn ended)','appr.submitting':'Submitting…','appr.sendFailMsg':'Could not submit your decision: {e}. The task is still waiting — retry, or click Deny to finish.','appr.sendFailThrown':'IPC/network error: {e}','appr.sendFailUnknown':'the server returned no readable reason','mcpUI.title':'Add MCP Server','mcpUI.type':'Server type','mcpUI.typeStdio':'Local process (stdio: uvx / npx / node command)','mcpUI.typeHttp':'Remote · Streamable HTTP (URL)','mcpUI.typeSse':'Remote · SSE (legacy HTTP+SSE, URL)','mcpUI.name':'Name (unique)','mcpUI.namePh':'e.g. my-server','mcpUI.args':'Arguments (space-separated, optional)','mcpUI.env':'Environment (one KEY=VALUE per line, optional)','mcpUI.headers':'Request headers (one per line, Key: Value; auth e.g. Authorization: Bearer xxx)','mcpUI.scope':'Bind scope','mcpUI.test':'Test connection',

    'skill.bar':'Skills · global / role-specific',
    'mcpX.scopeGlobal':'Global (available to all roles)','mcpX.roleScope':'Role-specific','mcpX.testNeedUrl':'Please fill in the URL','mcpX.testNeedCmd':'Please fill in the command','mcpX.testing':'Testing…','mcpX.connOk':'✓ Connected, {n} tool(s):','mcpX.connFail':'Connection failed',

    'editor.name':'Name','editor.icon':'Icon','editor.desc':'Description','editor.soul':'Role Prompt · Soul (persona)','editor.agents':'Role Prompt','editor.saveRole':'Save Role','editor.createRole':'Create Role','editor.newRoleTitle':'New Role','editor.namePh':'e.g. Finance Analyst','editor.descPh':'One-line specialty','editor.agentsPh':'Define specialty, personality & rules of conduct','editor.needName':'Please enter a role name','polish.empty':'Nothing to polish — content is empty','polish.polishing':'Polishing…','polish.doneCheck':'✓ Polished — review before saving','polish.done':'✓ Polished','polish.fail':'Polishing failed','polish.failColon':'Polishing failed: ', 

    'mcp.title':'MCP Tools · global / role-specific','mcp.add':'Add MCP server','mcp.note':'{a}/{t} MCP server(s) active','mcp.empty':'No MCP servers yet — use “Add MCP server” (top-right)','mcp.delTitle':'Delete MCP Server','mcp.delMsg':'Delete “{n}”?','mcp.hint':'Active global MCP tools are injected into every role; role-specific ones only into the bound role. Changes restart the codex process to load the new config.',
'skill.import':'Import skills','skill.importFolder':'Import folder','skill.importZip':'Import zip','skill.activeNote':'{a}/{t} skills active','skill.tagGlobal':'Global','skill.tagRole':'Role','skill.actOn':'Active','skill.actOff':'Inactive','skill.empty':'No skills yet — use “Import skills” (top-right) to add','skill.delSkillTitle':'Delete Skill','skill.delSkillMsg':'Delete skill “{n}”?\nIts folder and bindings will be removed.','skill.importFail':'Import failed','skill.deleted':'Deleted','skill.impOk':'✓ Imported {n}','skill.impInvalid':', {m} invalid',
 'sk.searchPh':'Search by name…','sk.filterAll':'All roles','sk.noMatch':'No matching skills','mcp.noMatch':'No matching MCP servers',
'model.urlKeyChanged':'URL / key changed — tap "Fetch models" to refresh','model.customName':'Custom provider','model.addedTag':'Configured','model.customItem':'Custom…','model.customUrlHint':'Fill URL manually for any OpenAI-compatible endpoint','model.fetching':'Fetching…','model.fetchFail':'Fetch failed','model.delTitle':'Delete Provider','model.delMsg1':'Delete','model.delMsg2':'? Its enabled models will also be removed.',

    'memory.global':'Global Memory','memory.globalShared':'Shared by all roles','memory.globalPh':'Facts, preferences & experience shared across roles…','memory.roleSub':'Role Memory · one per role, applies only to that role','memory.rolePh':'This role’s private memory…','memory.noneRole':'No roles yet — create one in Roles first.',
    'roles.h4':'Roles','roles.intro':'Create local roles for different professions or identities and define each persona & prompt; the sandbox, approval and model used per chat are chosen in the conversation view.','roles.add':'Add Role','roles.edit':'Edit','roles.delete':'Delete','roles.delTitle':'Delete Role','roles.delQ':'Delete role','roles.delWarn':'This also deletes all sessions of this role and its workspace. This cannot be undone.','roles.skillTitle':'Role-specific Skills','roles.skillKeep':'Keep skills','roles.skillDel':'Delete too', 'roles.skillMsg':'This role has {n} role-specific skill(s). Delete them too?\nDelete = also remove skills · Keep = keep skills (inactive).',
'common.delete':'Delete','common.cancel':'Cancel',

    'nav.model':'Model','nav.prompt':'Prompt','nav.memory':'Memory','nav.roles':'Roles','nav.skills':'Skills','nav.mcp':'MCP Tools','nav.usage':'Usage','nav.general':'General','nav.env':'Environment',
    'common.unavailable':'This capability is unavailable right now (service or engine not ready)','cfgWarn.from':'(from {s})','cfgWarn.engineRegression':'The engine failed to generate its config (please report this to the maintainer — it is not your settings): ',
    
    'env.check':'Environment check','env.checkDesc':'Verifies runtime, data directory, codex binary and the commands used by enabled MCP servers. Read-only, changes nothing.',
    'env.run':'Re-check','env.running':'Checking…','env.allOk':'All good','env.failCount':'{n} issue(s) to fix','env.warnCount':'{n} warning(s)',
    'env.sandbox':'Windows sandbox','env.sandboxDesc':'codex ships a native Windows sandbox. "elevated" creates dedicated low-privilege users plus firewall rules (needs one admin approval); "unelevated" uses a restricted token with weaker network isolation.',
    'env.sandboxMode':'Sandbox level','env.sandboxElevated':'elevated (recommended)','env.sandboxUnelevated':'unelevated (no admin)',
    'env.sandboxStatus':'Status','env.sandboxInit':'Initialize sandbox','env.sandboxInitRunning':'Initializing…','env.sandboxRecheck':'Re-query status',
    'env.statusReady':'Ready','env.statusNotConfigured':'Not configured','env.statusUpdateRequired':'Update required','env.statusUnknown':'Unknown','env.statusError':'Query failed',
    'env.diag':'Diagnostics','env.diagDesc':'Exports a redacted text report (env check, sandbox state, engine stderr, config summary). API keys never appear in it — safe to paste into an issue.',
    'env.diagBtn':'Export diagnostics','env.diagDone':'Saved: {p}','env.diagFail':'Export failed: {e}',
    'env.mcpNote':'Note: this project bundles no Node/uv runtime. MCP servers that use npx/uvx require the corresponding runtime on your system.',
    'sb.setupOk':'Sandbox initialization finished ({m}); status refreshed to ready.',
    'sb.setupFailedTitle':'Sandbox initialization failed',
    'sb.setupFailedMsg':'Initialization in mode {m} did not succeed. Raw error from codex:',
    'sb.tryUnelevated':'You can retry with unelevated: it needs no admin approval (restricted token + ACL); the trade-off is weaker network isolation, but it succeeds on far more machines.',
    'sb.switchUnelevated':'Retry with unelevated',
    'sb.setupTimeout':'Initialization produced no result within 90s (stuck on an approval prompt or blocked by security policy).',
    'sb.needsInit':'Windows sandbox is not initialized; command execution may fail (codex#37818). Use the button to initialize.','sb.updateNeeded':'Windows sandbox needs an update — please re-initialize.','sb.unknown':'Cannot determine Windows sandbox state: {e}','sb.worldWritable':'A directory is world-writable; consider tightening permissions.',
    'gen.appearance':'Appearance & Theme','gen.light':'Light','gen.lightDesc':'Bright & clean (default)','gen.dark':'Dark','gen.darkDesc':'Dark background, easier on the eyes at night','gen.system':'System','gen.systemDesc':'Follow the OS appearance automatically',
    'gen.lang':'Interface Language',
    'gen.closeTitle':'Closing the window','gen.closeHide':'Hide (default)','gen.closeHideDesc':'The app and running tasks keep going; click the Dock icon or launch again to bring the window back','gen.closeQuit':'Quit completely','gen.closeQuitDesc':'Closing the window quits the app; running tasks are confirmed before quitting','gen.closeNote':'Both behaviours confirm running tasks before exiting — work is never interrupted silently.',
    'goal.title':'Session goal','goal.localTag':'Local goal (engine unavailable)','goal.edit':'Edit','goal.save':'Save','goal.cancel':'Cancel','goal.clear':'Clear goal','goal.clearConfirm':'Clear the goal for this session?','goal.statusPending':'Pending','goal.statusActive':'In progress','goal.statusDone':'Done','goal.tokens':'{u} used / {l} budget tokens','goal.tokensNoBudget':'{u} tokens used','goal.editPh':'Describe what this session should achieve, in one sentence…','goal.saved':'✓ Goal saved','goal.saveFail':'Could not save the goal: ','goal.unavailable':'The goal service is unavailable right now (engine not ready); chatting is unaffected.','goal.needSession':'Open or start a session first, then set a goal',
    'win.reset':'Window switched · checkpoint','win.resetCount':'Window switched · checkpoint ({n})','win.note':'The engine carried the context over automatically after hitting its context limit — this is not a manual compaction, and the context ring and mask are unaffected.',
    'sub.title':'Sub-agents','sub.summary':'{a} sub-agent(s) · running {r} · waiting {w} · done {d}','sub.unsupported':'Engine not wired ({r})','sub.stopTurn':'Stop this turn (and its sub-agents)','sub.stopTurnHint':'Interrupts the whole turn, including every sub-agent; app-server has no per-sub-agent control RPC','sub.clearDone':'Clear finished','sub.stateSpawned':'Spawned','sub.stateRunning':'Running','sub.stateWaiting':'Waiting','sub.stateDone':'Done','sub.stateClosed':'Ended','sub.lastNone':'(no output yet)',
    'feed.empty':'Select a session on the left, or start a new one','feed.you':'You','session.newChat':'New chat','session.rename':'Rename','session.delete':'Delete','session.noMatch':'No matching sessions','ask.allDone':'All answered','ask.done':'{a}/{n} answered',
    'role.title':'Choose a role for this session','role.noRoles':'No roles yet — create one first','role.newRole':'New Role',
    'think.title':'Reasoning is not saved; only its duration is recorded','think.seconds':'Reasoned for {n} seconds','think.inProgress':'Thinking','err.generic':'Something went wrong',
    'tool.run':'Running','tool.done':'Done','tool.fail':'Failed','tool.processing':'Working…','plan.title':'Execution plan',
    'ask.confirmed':'Confirmed','ask.pendingTitle':'Awaiting your answer','ask.pending':'Awaiting answer','ask.skipped':'(skipped)','ask.otherPh':'Other…','ask.answerPh':'Type your answer…',
    'appr.needPrefix':'Approval needed · ','appr.operation':'action','appr.mcpEscalateTitle':'Escalation · remote MCP tool','appr.mcpConfirmTitle':'Confirm · MCP request','appr.mcpRun':'Allow the remote MCP tool to run: {t}','appr.patch':'Write approval · apply_patch','appr.exec':'Execution approval · exec_command','appr.outPolicy':"This action is outside the role's sandbox / approval policy",
    'mode.needSess':'Open or start a session first, then pick a mode','mode.select':'Choose session mode','mode.plan':'✦ Plan','mode.default':'Default','mode.free':'Auto-run','mode.planT':'✦ Plan mode','mode.planD':'Read-only research · produce a plan · confirm before executing (recommended for complex tasks)','mode.defaultT':'Default mode','mode.defaultD':'Writable workspace · commands need approval · explain big changes first','mode.freeT':'Auto-run mode','mode.freeD':'Full access · auto-execute · no approvals (only when you trust the model)','search.clear':'Clear','model.select':'Choose the model used for this conversation',
    'model.enableFirst':'(Enable a model first in Settings → Models)','model.noModelTitle':'No model configured','model.noModelMsg':'No model is enabled yet. Add a provider, enter its API key, and enable a model in Settings → Models.','model.goSettings':'Open settings','att.remove':'Remove','att.file':'Attachment','att.tooBig':'File too large (>20MB): ','att.upload':'Upload image / file','skill.choose':'Choose skills','model.addProvTitle':'Add provider · choose a preset',
    'skill.noSess':'Open or start a session first, then pick skills','skill.noAvail':'No usable skills for the current session','skill.noAvailSub':'Not imported/activated; role-specific skills are visible only to their bound role','skill.pickTitle':'Choose skills (this chat)',
    'dial.hint':'Notice','dial.gotit':'Got it','sm.sub':'config','stop.title':'Stop current task (Esc×2)','send.title':'Send (⏎)','queue.title':'Queued (sent in order when this task ends)','queue.edit':'Edit','queue.del':'Delete','queue.steer':'Interject now (inject into the running task)','queue.steerFail':'Interject failed: ','modal.from':'From: {r} · {s}','modal.queuedMore':'{n} more request(s) from other sessions queued','gen.ctxTitle':'Context & auto-compact','gen.ctxPct':'Auto-compact threshold (%)','gen.l0Unit':'tokens','gen.ctxPctShort':'Compact at','gen.l0Short':'Tool output cap','gen.l0Label':'Tool output cap (tokens)','gen.ctxSave':'Save','gen.ctxSaved':'Saved (applies when the engine process restarts)','cfg.badTitle':'Engine config rejected','ctx.none':'Context —','ctx.usedTok':'{n} tokens used','ctx.noWindow':'Window size not measured yet (shows a percentage after one turn)','ctx.noneTip':'No turn has run in this session yet; after one turn this shows context usage (click to compact)','cfg.badMsg':'codex rejected the config.toml ROSE generated and fell back to defaults (model/provider/persona/MCP are inactive, which usually breaks conversations). Detail:','ws.pickTitle':'Choose the working directory for this session','ws.fail':'Failed to create session: ','ws.locked':'The working directory is fixed once created (start a new session to change it)','ctx.title':'Context usage · click to compact','ctx.used':'Context {p}%','ctx.compacting':'Compacting…','ctx.done':'Context compacted','ctx.maskTitle':'Compacting context…','ctx.maskSub':'This session resumes automatically once compaction finishes; you can switch to another session meanwhile.','ctx.maskElapsed':'{n}s elapsed','ctx.fail':'Compaction failed: ','ctx.busy':'A task is running — stop it before compacting','ctx.timeout':'Timed out waiting for compaction; this session is released (click the ring to retry if needed).','settings':'Settings','nav.settings':'Settings','side.collapse':'Collapse sidebar','side.expand':'Expand sidebar','common.on':'on','common.off':'off','cmd.head':'Commands','cmd.panelOpened':'Panel opened','cmd.fail':'Failed: ','cmd.needArg':'Missing argument: {n}','cmd.needSession':'Open a session first to use this command','feed.noText':'(no text output this turn)','web.backendTitle':'Search backend','web.mcpOk':'Built-in search tool is ready (the model may call web_search)','web.mcpDown':'Built-in search tool is unavailable: {r}','web.toolBadge':'built-in search','web.backendHint':'The model calls the built-in `web_search` tool on its own — no switch needed. Configure the search backend here (leave empty for the keyless default).','web.sources':'Web search · {p} · {n} sources','web.none':'Web search returned no results','web.provider':'Search provider','web.keyPh':'SearXNG URL or API key (optional)','web.auto':'Auto (recommended)','cmd.web.desc':'Web search and cite sources','cmd.web.needArg':'Usage: /web <query>',
    'cmd.compact.desc':'Compact context (codex thread/compact/start)','cmd.compact.done':'Compaction started; usage refreshes when it finishes',
    'cmd.model.desc':'Show or switch this session\'s model','cmd.model.none':'No model enabled (Settings → Models)','cmd.model.list':'Enabled models:','cmd.model.current':'current','cmd.model.unknown':'No matching model: {n}','cmd.model.set':'Session model switched to {n} (applies next turn)',
    'cmd.approvals.desc':'Show or switch the approval policy','cmd.approvals.cur':'Approval policy: {n}','cmd.approvals.onRequest':'ask on request (recommended)','cmd.approvals.never':'never ask (risky)','cmd.approvals.bad':'Value must be on-request or never','cmd.approvals.set':'Approval policy switched to {n} (applies next turn)',
    'cmd.plan.desc':'Enter or leave plan mode (read-only research first)','cmd.plan.on':'Plan mode on (read-only)','cmd.plan.off':'Plan mode off (writable workspace)',
    'cmd.rename.desc':'Rename the current session','cmd.rename.need':'Usage: /rename <title>','cmd.rename.done':'Session renamed to "{n}"',
    'cmd.status.desc':'Show session configuration and context usage','cmd.status.role':'Role','cmd.status.model':'Model','cmd.status.sandbox':'Sandbox','cmd.status.approval':'Approval','cmd.status.plan':'Plan mode','cmd.status.workspace':'Workspace','cmd.status.context':'Context','cmd.status.running':'Running',
    'cmd.new.desc':'New session (pick role + workspace)','cmd.new.done':'Pick a role in the panel',
    'cmd.init.desc':'Create an AGENTS.md (project instructions)','cmd.init.done':'Requested AGENTS.md generation',
    'cmd.skills.desc':'Open the skill picker','cmd.mcp.desc':'Open MCP tool settings','cmd.usage.desc':'Open the usage panel','cmd.settings.desc':'Open settings',
    'cmd.help.desc':'List all available commands','cmd.help.title':'Available commands:','free.confirm':'This grants the model full access and lets it auto-run every command with no approvals.\n\nOnly use this when you fully trust the model and understand the consequences.','free.enable':'Enable anyway',
},
};
let lang = 'zh';
function tr(k) { const d = (I18N[lang] || I18N.zh); return (d && d[k] !== undefined) ? d[k] : ((I18N.zh[k] !== undefined) ? I18N.zh[k] : k); }
function langFromSettings() { const g=(state.settings&&state.settings.global)||{}; return g.language==='en' ? 'en' : 'zh'; }
// 给带 data-i18n / data-i18n-ph 的静态元素填当前语言文案
function applyStatic() {
  document.querySelectorAll('[data-i18n]').forEach((el) => { const k = el.getAttribute('data-i18n'); if (k) el.textContent = tr(k); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { const k = el.getAttribute('data-i18n-ph'); if (k) el.placeholder = tr(k); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { const k = el.getAttribute('data-i18n-title'); if (k) el.title = tr(k); });
}
function initI18n() { lang = langFromSettings(); applyStatic(); }
function setAgentStatusLang() {
  const st = $('#agentStatus'); if (!st) return;
  let m='ready'; if (st.classList.contains('running')) m='running';
  else if (st.classList.contains('wait')) m='approvalWait';
  else if (st.classList.contains('error')) m='error';
  const t = $('#agentStatusText'); if (t) t.textContent = tr('status.' + m);
}
async function setLang(l) {
  if (l !== 'zh' && l !== 'en') return;
  lang = l;
  state.settings = state.settings || { global: {} }; state.settings.global = state.settings.global || {};
  state.settings.global.language = l;
  applyStatic(); setAgentStatusLang();
  try { await api('PUT', '/api/settings', { global: { language: l } }); } catch {}
  // 重渲染当前设置面板（若非通用则切回通用显示语言项，简化为直接重开当前导航）
  if (typeof renderPanel === 'function') renderPanel();
}


const state = {
  roles: [],
  sessions: [],
  currentSession: null,
  busySessions: {}, // 按会话记录「有任务进行中」：sessionId -> true（SSE 断线/多会话并行也不串扰）
  attachments: [], // 待发送附件 {id,name,size,mime,kind,dataUrl,thumb?}
  allSkills: [],  // 全部技能（GET /api/skills）
  selSkills: [],  // 本次会话选用的技能 id 列表
  queue: [],      // 运行中排队的消息（本轮结束后自动发出，替代"发送即停止"）
  compactingSessions: {}, // 按会话记录"正在压缩"：sessionId -> true（切到别的会话不应显示它的动画）
  platform: null, // { id, arch, sandboxSupported }（GET /api/bootstrap）
  sandbox: null,  // Windows 沙箱状态（GET /api/sandbox）
  sandboxDismissed: null, // 已忽略的横幅状态（同一状态不再重复弹出）
  envcheck: null, // 最近一次环境自检结果
  goals: {},           // sessionId -> 目标对象 | null（服务端/引擎权威，界面只缓存）
  goalSupported: {},   // sessionId -> 该会话是否支持 goals（路由/引擎未就绪时为 false）
  goalEditing: false,  // 目标栏是否处于就地编辑态
  configWarnings: null, // 最近一次设置保存回包的 configWarnings（引擎拒绝某项能力的可读原因）
  approvals: {},   // requestId -> { sessionId, kind, command, toolId }（"等待人工审批"的可见状态来源）
  winResetPending: {}, // 非当前会话收到的窗口续接提示：sessionId -> [{t:'win-reset',...}]
  subagents: {},   // sessionId -> { agentId: {id,title,state,lastText,ts} }（只读；SSE + GET 同步）
  subSupported: {}, // sessionId -> 引擎是否接线了子代理（GET 的 supported）
  subReason: {},    // sessionId -> supported:false 时的原因（照实显示）
  subOpen: true,   // 子代理面板展开态（出现活动子代理时自动展开）
  goalReason: {},  // sessionId -> 目标 supported:false 时的原因（本地快照标记的 title）
};

function markBusy(sid) { if (sid) { state.busySessions[sid] = true; if (isCurrent(sid)) syncGenRow(); } }
function clearBusy(sid) { if (sid) { delete state.busySessions[sid]; if (isCurrent(sid)) syncGenRow(); } }
function isCurrent(sid) { return !!(state.currentSession && state.currentSession.id === sid); }
/** 生成中指示行（.gen）的唯一开关：busy 为真时在末尾保留**一行**，为假时立刻移除。
    必须显式同步：renderFeed 只在重建时创建它，而回合结束不再整体重渲染。 */
function syncGenRow() {
  const feed = $('#feed');
  if (!feed) return;
  const rows = [...feed.querySelectorAll(':scope > .gen')];
  if (curBusy()) {
    rows.slice(0, -1).forEach((r) => r.remove());
    if (!rows.length) feed.appendChild(genRow(currentRole()));
  } else {
    rows.forEach((r) => r.remove());
  }
}
function curBusy() { return !!(state.currentSession && state.busySessions[state.currentSession.id]); }

const ICONS = {
  coder: '<svg viewBox="0 0 24 24"><path d="m8 6-6 6 6 6M16 6l6 6-6 6"/></svg>',
  writer: '<svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  ops: '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a4.5 4.5 0 0 0-6 6L3 18l3 3 5.7-5.7a4.5 4.5 0 0 0 6-6L14 13l-3-3Z"/></svg>',
  data: '<svg viewBox="0 0 24 24"><path d="M3 3v18h18M7 15v3M12 10v8M17 6v12"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  shell: '<svg viewBox="0 0 24 24"><path d="m5 7 4 4-4 4M12 17h7"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>',
  warn: '<svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>',
  ask: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.4 9.3a2.6 2.6 0 1 1 3.9 2.3c-.7.35-1.3.9-1.3 1.9v.2M12 17.3h.01"/></svg>',
  doc: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  // —— 角色图标候选（线条风格）——
  analyst: '<svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="m7 15 3.5-4 3 2 5.5-7"/></svg>',
  finance: '<svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="M7 6h10M7 6v10a2 2 0 0 0 2 2h8V8a2 2 0 0 0-2-2Z"/><path d="M11 10v5M15 10v5"/></svg>',
  product: '<svg viewBox="0 0 24 24"><path d="M12 3 3 8l9 5 9-5Z"/><path d="M3 12l9 5 9-5"/><path d="M3 16l9 5 9-5"/></svg>',
  robot: '<svg viewBox="0 0 24 24"><rect x="5" y="8" width="14" height="11" rx="2"/><path d="M12 8V5M9 19v2M15 19v2"/><circle cx="9.5" cy="13.5" r="1"/><circle cx="14.5" cy="13.5" r="1"/><path d="M12 16.5v.01"/></svg>',
  translate: '<svg viewBox="0 0 24 24"><path d="M7 4 3 8l4 4"/><path d="M3 8h13"/><path d="m17 12 4 4-4 4"/><path d="M21 16H8"/></svg>',
  brief: '<svg viewBox="0 0 24 24"><path d="M3 7h18v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M4 4h7v15a2 2 0 0 1-2-2H4Z"/><path d="M20 4h-7v15a2 2 0 0 0 2-2h5Z"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.3 0-2.5-.3-3.6-.8L4 21l1.8-4A8.5 8.5 0 1 1 21 11.5Z"/><path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9Z"/></svg>',
};

// 角色图标可选键（新角色/角色编辑下拉用）
const ROLE_ICON_KEYS = ['coder', 'writer', 'ops', 'data', 'analyst', 'finance', 'product', 'robot', 'translate', 'brief', 'book', 'chat'];

// 新增角色时「角色提示词」的默认骨架模板（保留各模块标题，内容为简要占位，供用户改写）。默认骨架按当前界面语言给出，便于用户直接改写。
function roleAgentsDefault() {
  return (lang === 'en')
  ? `# Role setup

## Identity & persona
In one sentence define who you are; personality and tone.

## Working method
Drive the work the way this specialty does best: first ____, then ____, finally ____.

## Output contract
- Structure: conclusion first → reasoning & key points → recommendation
- Use lists/tables when helpful; keep it concise by default, expand only when asked for detail

## Boundaries & red lines
- Stay within this role's specialty; do not overreach or take on other fields
- Do not fabricate facts or data; if you cannot find something, state the source or gap honestly`
  : `# 角色设定

## 身份与人格
一句话定义你是谁；性格与语气。

## 工作方法
按该专业最有效的方式推进：先 ____，再 ____，最后 ____。

## 输出契约
- 结构：结论先行 → 依据与要点 → 建议
- 需要时用列表/表格；默认精炼，被要求详细才展开

## 边界与红线
- 只做本角色专业范围；不越界、不硬揽其它专业
- 不编造事实与数据；查不到就如实说明来源或缺口`;
}

const toolIcon = (name) => {
  if (/file|read|write/.test(name)) return ICONS.file;
  if (/search|web/.test(name)) return ICONS.search;
  return ICONS.shell;
};

async function api(method, path, body) {
  if (window.rose) return window.rose.invokeApi(method, path, body);   // 桌面：IPC 直连
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return { raw: txt }; }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- 安全 Markdown 渲染（零依赖，先转义后解析，杜绝 XSS） ---------- */

// 行内规则：行内代码 / 链接(仅 http(s)) / 粗体 / 斜体 / 删除线
function mdInline(s) {
  if (!s) return '';
  const codes = [];
  let t = s.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return '\u0001' + (codes.length - 1) + '\u0001'; });
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, txt, url) =>
    /^https?:\/\//i.test(url) ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${txt}</a>` : m);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  t = t.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  t = t.replace(/\u0001(\d+)\u0001/g, (m, i) => `<code>${codes[+i]}</code>`);
  return t;
}

function mdSplitCells(line) {
  let l = line.trim();
  if (l.charAt(0) === '|') l = l.slice(1);
  if (l.charAt(l.length - 1) === '|') l = l.slice(0, -1);
  return l.split('|').map((c) => c.trim());
}

function mdTableHtml(t) {
  const head = '<tr>' + t.head.map((c) => '<th>' + mdInline(c) + '</th>').join('') + '</tr>';
  const rows = t.rows.map((r) => '<tr>' + r.map((c) => '<td>' + mdInline(c) + '</td>').join('') + '</tr>').join('');
  return '<table><thead>' + head + '</thead><tbody>' + rows + '</tbody></table>';
}

function renderMarkdown(src) {
  if (!src) return '';
  const blocks = [];
  let s = String(src);
  // 1) 隔离围栏代码块，避免内部被误渲染
  s = s.replace(/```[ \t]*([\w+#.-]*)[ \t]*\r?\n([\s\S]*?)\r?\n?```/g, (m, lang, code) => {
    blocks.push({ lang: lang || '', code: esc(code.replace(/\r?\n$/, '')) });
    return '\u0000' + (blocks.length - 1) + '\u0000';
  });
  // 2) 整体 HTML 转义
  s = esc(s);

  const lines = s.split('\n');
  const out = [];
  let list = null, para = [], quote = [], table = null;
  const closeList = () => { if (list) { out.push('<' + list.tag + '>' + list.items.join('') + '</' + list.tag + '>'); list = null; } };
  const closePara = () => { if (para.length) { out.push('<p>' + para.map(mdInline).join('<br>') + '</p>'); para = []; } };
  const closeQuote = () => { if (quote.length) { out.push('<blockquote>' + quote.map(mdInline).join('<br>') + '</blockquote>'); quote = []; } };
  const flushTable = () => { if (table) { out.push(mdTableHtml(table)); table = null; } };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let mm;
    if ((mm = line.match(/^\u0000(\d+)\u0000$/))) { closeList(); closePara(); closeQuote(); flushTable(); const b = blocks[+mm[1]]; const cls = b.lang ? ' class="lang-' + esc(b.lang) + '"' : ''; out.push('<pre><code' + cls + '>' + b.code + '</code></pre>'); continue; }
    if (line.trim() === '') { closeList(); closePara(); closeQuote(); flushTable(); continue; }
    // 表格（含 |，且下一行为分隔行）
    if (!table && line.includes('|') && i + 1 < lines.length && lines[i + 1].includes('-') && /^\s*\|?[\s:-]+\|[\s:|-]*\s*$/.test(lines[i + 1])) {
      closeList(); closePara(); closeQuote();
      table = { head: mdSplitCells(line), rows: [] };
      i++; continue;
    }
    if (table) {
      if (line.includes('|')) { table.rows.push(mdSplitCells(line)); continue; }
      flushTable();
    }
    if ((mm = line.match(/^(#{1,4})\s+(.*)$/))) { closeList(); closePara(); closeQuote(); flushTable(); const lv = mm[1].length; out.push('<h' + lv + '>' + mdInline(mm[2]) + '</h' + lv + '>'); continue; }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { closeList(); closePara(); closeQuote(); flushTable(); out.push('<hr>'); continue; }
    if ((mm = line.match(/^\s*&gt;\s?(.*)$/))) { closeList(); closePara(); flushTable(); quote.push(mm[1]); continue; }
    if ((mm = line.match(/^\s*[-*+]\s+(.*)$/))) { closePara(); closeQuote(); flushTable(); if (!list || list.tag !== 'ul') { closeList(); list = { tag: 'ul', items: [] }; } list.items.push('<li>' + mdInline(mm[1]) + '</li>'); continue; }
    if ((mm = line.match(/^\s*\d+\.\s+(.*)$/))) { closePara(); closeQuote(); flushTable(); if (!list || list.tag !== 'ol') { closeList(); list = { tag: 'ol', items: [] }; } list.items.push('<li>' + mdInline(mm[1]) + '</li>'); continue; }
    closeList(); closeQuote(); flushTable(); para.push(line);
  }
  closeList(); closePara(); closeQuote(); flushTable();
  return out.join('');
}

/* ---------- 渲染侧栏 ---------- */

let sessionQuery = ''; // 会话搜索关键字（侧栏顶部输入框）
const collapsedRoles = new Set(); // 各角色分组是否收起（跨渲染保持，避免新建会话后全部展开）

function renderSidebar() {
  const box = $('#roleGroups');
  box.innerHTML = '';
  const q = sessionQuery.trim().toLowerCase();
  let shownAny = false;
  for (const role of state.roles) {
    let sessions = state.sessions.filter((s) => s.roleId === role.id);
    if (q) sessions = sessions.filter((s) => (s.title || '').toLowerCase().includes(q));
    if (q && !sessions.length) continue;
    shownAny = true;
    const g = document.createElement('div');
    g.className = 'role-group';
    g.innerHTML = `
      <div class="rg-head">
        <span class="ic rico">${ICONS[role.icon] || ICONS.coder}</span>
        <span class="rname">${esc(role.name)}</span>
        <span class="cnt">${sessions.length}</span>
        <span class="ops">
          <span class="rg-op" title="${tr('session.newChat')}"><span class="ic"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></span></span>
        </span>
        <span class="chev">▾</span>
      </div>
      <div class="rg-sessions"></div>`;
    const list = g.querySelector('.rg-sessions');
    if (collapsedRoles.has(role.id)) { list.style.display = 'none'; g.classList.add('collapsed'); }
    for (const s of sessions) {
      const it = document.createElement('div');
      it.className = 'session-item' + (state.currentSession && state.currentSession.id === s.id ? ' active' : '');
      it.innerHTML = `<span class="name">${esc(s.title)}</span><span class="ops"><span class="rn" title="${tr('session.rename')}">✎</span><span class="x" title="${tr('session.delete')}">✕</span></span>`;
      it.addEventListener('click', () => openSession(s.id));
      it.querySelector('.rn').addEventListener('click', (e) => { e.stopPropagation(); renameSession(s, it); });
      it.querySelector('.x').addEventListener('click', (e) => { e.stopPropagation(); deleteSession(s.id); });
      list.appendChild(it);
    }
    g.querySelector('.rg-head').addEventListener('click', (e) => {
      if (e.target.closest('.rg-op')) { newSession(role.id); return; }
      const hide = !collapsedRoles.has(role.id);
      if (hide) collapsedRoles.add(role.id); else collapsedRoles.delete(role.id);
      list.style.display = hide ? 'none' : 'block';
      g.classList.toggle('collapsed', hide);
    });
    box.appendChild(g);
  }
  if (q && !shownAny) {
    const empty = document.createElement('div');
    empty.className = 'session-empty';
    empty.textContent = tr('session.noMatch');
    box.appendChild(empty);
  }
}

/* ---------- 新会话角色选择器 ---------- */

function openRolePicker() {
  const picker = $('#rolePicker');
  if (!picker) return;
  // 无论有无角色都弹角色选择器：无角色时下拉只有『新建角色』，点击后再跳设置引导创建
  renderRolePicker();
  picker.classList.add('show');
}
function closeRolePicker() {
  const picker = $('#rolePicker');
  if (picker) picker.classList.remove('show');
}
function renderRolePicker() {
  const picker = $('#rolePicker');
  if (!picker) return;
  picker.innerHTML = '';
  if (state.roles.length) {
    const t = document.createElement('div');
    t.className = 'rp-title';
    t.textContent = tr('role.title');
    picker.appendChild(t);
    for (const role of state.roles) {
      const b = document.createElement('button');
      b.className = 'rp-item';
      b.type = 'button';
      b.innerHTML = `<span class="ic rp-ic">${ICONS[role.icon] || ICONS.coder}</span>` +
        `<span>${esc(role.name)}<span class="rp-d" style="display:block">${esc(role.description || '')}</span></span>`;
      b.addEventListener('click', (e) => { e.stopPropagation(); closeRolePicker(); newSession(role.id); });
      picker.appendChild(b);
    }
    const sep = document.createElement('div'); sep.className = 'rp-sep'; picker.appendChild(sep);
  } else {
    const t = document.createElement('div');
    t.className = 'rp-title';
    t.textContent = tr('role.noRoles');
    picker.appendChild(t);
  }
  const nb = document.createElement('button');
  nb.className = 'rp-item';
  nb.type = 'button';
  nb.innerHTML = `<span class="ic rp-ic"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></span>` +
    `<span>${tr('role.newRole')}</span><span class="rp-new">→ ${tr('nav.settings')}</span>`;
  nb.addEventListener('click', (e) => { e.stopPropagation(); closeRolePicker(); openSettings('roles'); });
  picker.appendChild(nb);
}

/* ---------- 渲染消息流 ---------- */

// 流式渲染合并器：a-delta 每个分片都重解析整篇 Markdown 是 O(n²)，会把主线程压满
// （表现为"对话过程中拖窗口/滚动无响应"）。改为累积原文、每帧最多渲染一次；
// 需要立即出结果时（全量重建结束）调用 flushAgentRender()。
let agentRenderPending = false;
function renderAgentNow() {
  const md = (raw) => renderMarkdown(String(raw).replace(/\[(?:PLAN|REQUEST_PLAN_MODE)\]/g, ''));
  const dirty = feedState.dirtyAgents;
  if (dirty && dirty.size) {
    for (const a of [...dirty]) {
      dirty.delete(a);
      if (!a || !a.bodyEl) continue;
      if (!a.bodyEl.isConnected) {
        // 该行已随重建被摘掉：正在重建则由重建流程负责；不在重建中说明游标失效 → 整体自愈一次
        if (!feedState.rebuilding && a === feedState.curAgent) { renderFeed(); return; }
        continue;
      }
      const html = md(a._raw);
      if (!html.trim()) {
        // 两种情况都会渲染成空：① 这一轮确实没有文本（只调用了工具）
        // ② 正文只有 [PLAN]/[REQUEST_PLAN_MODE] 标记（被剥离后什么都不剩）。
        // 空白的头像+名字看起来就像渲染坏了，这里给一行明确的灰字。
        a.bodyEl.innerHTML = `<span class="body-note">${esc(tr('feed.noText'))}</span>`;
      } else {
        a.bodyEl.innerHTML = html;
      }
    }
    return;
  }
  // 兜底：没有登记脏标记但 curAgent 有正文要渲染（例如外部直接调用）
  const a = feedState.curAgent;
  if (!a) return;
  if (a.bodyEl && !a.bodyEl.isConnected) { if (!feedState.rebuilding) { renderFeed(); return; } return; }
  a.bodyEl.innerHTML = md(a._raw);
}
function scheduleAgentRender() {
  if (agentRenderPending) return;
  agentRenderPending = true;
  const run = () => { agentRenderPending = false; renderAgentNow(); };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else setTimeout(run, 16);
}
function flushAgentRender() {
  if (!agentRenderPending) return;
  agentRenderPending = false;
  renderAgentNow();
}

function renderFeed() {
  const feed = $('#feed');
  feed.innerHTML = '';
  // 全量重建后重置增量渲染游标
  feedState = { rendered: 0, curAgent: null, dirtyAgents: new Set(), rebuilding: true, openCard: null, planCard: null, reasoning: null, lastPlanSig: null };
  if (!state.currentSession) {
    feed.innerHTML = `<div class="empty">${tr('feed.empty')}</div>`;
    return;
  }
  const role = currentRole();
  // 严格按消息存储顺序重建：user / agent(a-delta 聚合) / tool 卡片交错排列。
  // ⚠️ 单条渲染失败必须只跳过该条：以前一次异常会中断整个 forEach → #feed 只建到一半，
  // 表现就是"之前的回复不见了"（而且控制台之外没有任何提示）。
  let renderFailed = 0, firstFail = null;
  state.currentSession.messages.forEach((m, i) => {
    try { feedAppendMsg(m, i); }
    catch (e) {
      renderFailed++;
      if (!firstFail) firstFail = { i, type: m && m.t, msg: String((e && e.message) || e) };
    }
  });
  if (renderFailed) {
    console.error(`[rose] 有 ${renderFailed} 条消息渲染失败（首条：#${firstFail.i} type=${firstFail.type}：${firstFail.msg}）；其余已正常显示`);
  }
  flushAgentRender();                                                     // 重建结束：立刻成型（不等下一帧）
  feedState.rebuilding = false;
  if (curBusy()) feed.appendChild(genRow(role));   // 与 syncGenRow() 一致：busy 时末尾保留一行
  scrollBottom();
}

// 增量渲染游标：rendered=已上屏消息数；curAgent/openCard 为正在累积的 DOM 节点
let feedState = { rendered: 0, curAgent: null, dirtyAgents: new Set(), rebuilding: false, openCard: null, planCard: null, reasoning: null, lastPlanSig: null };
// 把一条消息追加到 feed（全量重建与 SSE 流式增量共用同一套状态机，保证行为一致）
function feedAppendMsg(m, idx) {
  const feed = $('#feed');
  if (m.t === 'user') {
    feedState.curAgent = null; feedState.openCard = null; feedState.planCard = null; feedState.reasoning = null; feedState.lastPlanSig = null;
    feed.appendChild(userMsg(m));
  } else if (m.t === 'a-delta') {
    if (!feedState.curAgent) { feedState.curAgent = agentMsg(m.ts); feed.appendChild(feedState.curAgent); }
    feedState.curAgent._raw += m.v;
    // ⚠️ 必须按"行"登记脏标记：重建时 curAgent 会被下一条消息换成新行，
    // 只渲染 curAgent 会导致**除最后一条外所有回复的正文都是空的**（头像/名字在、内容空白）。
    feedState.dirtyAgents.add(feedState.curAgent);
    scheduleAgentRender();      // 每帧最多解析一次（流式/重建共用）
  } else if (m.t === 'plan') {
    // 结构化计划：同回合的计划更新复用同一张卡片；内容与上一条完全相同时跳过重绘
    const sig = JSON.stringify(m.v);
    if (feedState.lastPlanSig !== sig) {
      if (!feedState.planCard) { feedState.planCard = planCardEl(); feed.appendChild(feedState.planCard.el); }
      feedState.planCard.fill(m.v.plan, m.v.explanation);
      feedState.lastPlanSig = sig;
    }
  } else if (m.t === 'ask') {
    // 询问只读摘要行（交互在独立弹窗，历史中只留"题目 → 已答"记录）
    const msgs = state.currentSession.messages;
    const ans = (idx !== undefined ? msgs.slice(idx + 1) : []).find((x) => x.t === 'ask-answer' && ridOf(x.v.requestId) === ridOf(m.v.requestId));
    const answers = (ans && ans.v.answers) || m.v.answer || null;
    const el = askSummaryEl(m.v, answers);
    feed.appendChild(el);
  } else if (m.t === 'ask-answer') {
    // 应答不单独渲染（合并进 ask 摘要行）
  } else if (m.t === 'web') {
    // 历史记录兼容：预搜时代落盘的来源卡（现在联网走 web_search 工具，不再产生新记录）
    feed.appendChild(webCardEl(m.v));
    feedState.curAgent = null;
  } else if (m.t === 'think') {
    // 持久化的思考耗时摘要（思考正文不落盘）
    if (feedState.reasoning) { feedState.reasoning.el.fold(); feedState.reasoning = null; }
    const d = document.createElement('div');
    d.className = 'think-card';
    d.title = tr('think.title');
    d.innerHTML = `<div class="tk-head" style="cursor:default"><span class="tk-dot">✦</span><span class="tk-label">${tr('think.seconds').replace('{n}', esc(String(m.v.seconds)))}</span></div>`;
    feed.appendChild(d);
  } else if (m.t === 'win-reset') {
    // 引擎自发压缩后"换上下文窗口（检查点）"的提示行：**与压缩蒙版/圆环完全无关**
    // （只在引擎自动续接时发；手动压缩不发）。契约没有窗口 id，只有次数与原因。
    feedState.curAgent = null;
    const n = Math.max(1, Math.round(Number(m.v && m.v.count) || 1));
    const d = document.createElement('div');
    d.className = 'sys-row win-reset';
    d.innerHTML = `<span class="wr-ic">◎</span><span><b>${esc(n > 1 ? tr('win.resetCount').replace('{n}', String(n)) : tr('win.reset'))}</b><span class="wr-note">${tr('win.note')}</span></span>`;
    feed.appendChild(d);
  } else if (m.t === 'tool') {
    feedState.curAgent = null;
    if (feedState.reasoning) feedState.reasoning.el.fold();
    feedState.openCard = toolCard({ name: m.v.name, args: m.v.args, status: 'run', output: '', server: m.v.server || '' });
    feedState.openCard.dataset.toolId = m.v.toolId || '';
    feedState.openCard.dataset.toolName = m.v.name || '';
    feedState.openCard.dataset.done = '';
    if (m.v.server) feedState.openCard.dataset.server = m.v.server;
    feed.appendChild(feedState.openCard);
  } else if (m.t === 'error') {
    feedState.curAgent = null;
    const d = document.createElement('div');
    d.className = 'err-row';
    d.textContent = '⚠ ' + (m.v || tr('err.generic'));
    feed.appendChild(d);
  } else if (m.t === 'tool-end') {
    if (feedState.reasoning) feedState.reasoning.el.fold();
    const output = typeof m.v.output === 'string' ? m.v.output : JSON.stringify(m.v.output || '');
    // ok:false = 引擎明确回报失败（如联网不可达）：如实显示失败 + 那段可读错误，不吞成空结果
    const toolOk = m.v.ok !== false;
    if (feedState.openCard) {
      feedState.openCard.dataset.done = '1';
      feedState.openCard.fill({ status: toolOk ? 'ok' : 'error', output });
      // 联网工具（web_search）成功时：卡片内追加来源链接（普通工具调用展示 + 来源可点）
      const toolName = m.v.name || feedState.openCard.dataset.toolName || '';
      const toolServer = m.v.server || feedState.openCard.dataset.server || '';
      if (toolOk && isSearchTool(toolServer, toolName)) {
        const web = parseWebToolOutput(toolName, output);
        if (web) feedState.openCard.fillWeb(web);
      }
      feedState.openCard = null;
    } else {
      feed.appendChild(toolCard({ name: 'tool', args: '', status: 'ok', output }));
    }
  }
  feedState.rendered++;
}

// SSE 流式事件：只增量更新 DOM（新会话消息已被 push 进 state），不再整会话重渲染
function appendFeedEvent(d) {
  const msgs = state.currentSession.messages;
  const m = msgs[msgs.length - 1];
  if (!m) return;
  // 思考段落告一段落：折叠思考卡
  if (feedState.reasoning) { feedState.reasoning.el.fold(); feedState.reasoning = null; }
  try { feedAppendMsg(m, msgs.length - 1); }
  catch (e) { console.error('[rose] 单条消息渲染失败（已跳过）：' + ((e && e.message) || e)); return; }
  // 保持"正在处理"指示行在末尾
  const feed = $('#feed');
  const gen = feed.querySelector(':scope > .gen');
  if (gen) feed.appendChild(gen);
  stickToBottom();
}

// 思考过程（r-delta 不落盘，仅会话内即时可见）：聚合成一张可折叠卡片
function appendReasoningDelta(d) {
  const feed = $('#feed');
  if (!feedState.reasoning) {
    feedState.reasoning = { itemId: d.itemId, el: thinkCardEl(), raw: '' };
    feed.appendChild(feedState.reasoning.el);
  }
  if (feedState.reasoning.itemId !== d.itemId) {
    feedState.reasoning.el.fold();
    feedState.reasoning = { itemId: d.itemId, el: thinkCardEl(), raw: '' };
    feed.appendChild(feedState.reasoning.el);
  }
  feedState.reasoning.raw += d.delta;
  feedState.reasoning.el.update(feedState.reasoning.raw);
  const gen = feed.querySelector(':scope > .gen');
  if (gen) feed.appendChild(gen);
  stickToBottom();
}

// 工具输出增量：追加到正在运行的工具卡片
function appendToolOutputDelta(d) {
  const card = feedState.openCard;
  if (!card || card.dataset.toolId !== d.toolId) return;
  card.appendOutput(d.delta);
}

function userMsg(m) {
  const text = m.v || '';
  const att = m.att || [];
  const d = document.createElement('div');
  d.className = 'msg';
  d.innerHTML = `<div class="avatar u">${esc(tr('feed.you').slice(0, 1))}</div>
    <div class="col"><div class="meta"><span class="who">${esc(tr('feed.you'))}</span><span class="time">${fmtTs(m.ts)}</span></div>
    <div class="body">${renderMarkdown(text)}</div></div>`;
  const col = d.querySelector('.col');
  // 附件：图片缩略 + 文件 chip（历史回显）
  // 服务端持久化不再内联 base64：无 src 时按 saved 文件名走附件读取路由取缩略图
  if (att.length) {
    const wrap = document.createElement('div');
    wrap.className = 'msg-img';
    for (const a of att) {
      if (a.kind === 'image') {
        const src = a.src || (a.saved && state.currentSession ? (window.rose ? `rose://attachment/${state.currentSession.id}?f=${encodeURIComponent(a.saved)}` : `/api/sessions/${state.currentSession.id}/attachment?f=${encodeURIComponent(a.saved)}`) : '');
        if (src) {
          const img = document.createElement('img');
          img.src = src; img.alt = a.name || '';
          wrap.appendChild(img);
        }
      } else {
        const tag = document.createElement('span');
        tag.className = 'att-file-tag';
        tag.innerHTML = `<span class="ic">${ICONS.file}</span><span class="af-name">${esc(a.name || tr('att.file'))}</span>`;
        wrap.appendChild(tag);
      }
    }
    col.appendChild(wrap);
  }
  return d;
}

function agentMsg(ts) {
  const d = document.createElement('div');
  d.className = 'msg';
  const role = currentRole();
  d.innerHTML = `<div class="avatar a"><span class="ic">${ICONS[role ? role.icon : 'coder']}</span></div>
    <div class="col"><div class="meta"><span class="who">${esc(role ? role.name : 'Agent')}</span><span class="time">${fmtTs(ts)}</span></div>
    <div class="body"></div></div>`;
  d.bodyEl = d.querySelector('.body');
  d._raw = '';
  return d;
}

function toolCard(o) {
  const d = document.createElement('div');
  d.className = 'tool-card';
  // 内置联网工具（MCP server=rose_search）：卡头加"内置搜索"角标，一眼可辨
  const isSearch = isSearchTool(o.server, o.name);
  d.innerHTML = `
    <div class="th">
      <span class="ic tico">${toolIcon(o.name)}</span>
      <span class="tn">${esc(o.name)}</span>
      ${isSearch ? `<span class="tn-badge">${esc(tr('web.toolBadge'))}</span>` : ''}
      <span class="ta">${esc(o.args || '')}</span>
      <span class="st ${o.status === 'ok' ? 'ok' : ''}">${o.status === 'run' ? '<span class="spin"></span>' + tr('tool.run') : ICONS.check + ' ' + tr('tool.done')}</span>
      <span class="caret">▾</span>
    </div>
    <div class="tb"></div>
    <div class="wc-slot"></div>`;
  d.dataset.server = o.server || '';
  d.querySelector('.th').addEventListener('click', () => d.classList.toggle('open'));
  // 建卡时若已带输出（历史重建 / tool-end 兜底路径）就先填好正文，展开即有内容
  if (o.output) d.querySelector('.tb').textContent = o.output;
  d.fill = (o) => {
    if (o.status) {
      const st = d.querySelector('.st');
      // 三种状态如实区分：运行中 / 成功 / 失败（引擎回 ok:false 时绝不能显示成"完成"）
      if (o.status === 'run') { st.className = 'st'; st.innerHTML = '<span class="spin"></span>' + tr('tool.run'); }
      else if (o.status === 'error') { st.className = 'st err'; st.innerHTML = '✗ ' + tr('tool.fail'); }
      else { st.className = 'st ok'; st.innerHTML = ICONS.check + ' ' + tr('tool.done'); }
    }
    if (o.output !== undefined) d.querySelector('.tb').textContent = o.output || '';
  };
  // 工具输出流式：运行期间逐段追加（tool-end 会以完整输出覆盖）
  // 卡片默认保持收起：输出只在用户点开卡头时才可见（与思考卡一致）
  d.appendOutput = (delta) => {
    d._out = (d._out || '') + delta;
    d.querySelector('.tb').textContent = d._out.length > 8000 ? '…' + d._out.slice(-8000) : d._out;
  };
  // 联网类工具（web_search）：把来源链接渲染进卡内（沿用 .web-card 风格），展开卡即可见
  d.fillWeb = (v) => {
    const slot = d.querySelector('.wc-slot');
    if (!slot || !v) return;
    slot.innerHTML = '';
    slot.appendChild(webCardEl(v));
  };
  return d;
}

/** 联网来源卡片：显示查询词与来源链接（/web 手动搜索与 web_search 工具结果共用） */
function webCardEl(v) {
  const d = document.createElement('div');
  d.className = 'web-card';
  const rows = (v && v.results) || [];
  const items = rows.map((r) => `<div class="wc-item">· <a href="${esc(r.url)}" target="_blank" rel="noreferrer">${esc(r.title || r.url)}</a>`
    + (r.snippet ? `<div class="wc-sn">${esc(String(r.snippet).slice(0, 160))}</div>` : '') + '</div>').join('');
  d.innerHTML = `<div class="wc-head">🌐 ${esc(tr('web.sources').replace('{p}', String((v && v.provider) || 'web')).replace('{n}', String(rows.length)))}`
    + `${v && v.query ? ' · ' + esc(String(v.query).slice(0, 80)) : ''}</div>${items}`;
  return d;
}

/** 是不是内置联网搜索工具：优先看 MCP server 字段（rose_search），其次看工具名（mcp:web_search） */
function isSearchTool(server, name) {
  return /rose[_-]?search/i.test(String(server || '')) || /web[_-]?search|search[_-]?web/i.test(String(name || ''));
}

/** 联网类工具调用：模型自己调 web_search 时，把结果里的来源链接按普通工具卡展示。
    返回 {query, provider, results:[{title,url,snippet}]}；不是联网工具/解不出来则 null（照常只显示原始输出）。 */
function parseWebToolOutput(name, output) {
  if (!isSearchTool('', name)) return null;
  const text = typeof output === 'string' ? output : JSON.stringify(output || '');
  let data = null;
  try { data = JSON.parse(text); } catch { /* 不是 JSON：退回正则抽 URL */ }
  // MCP 常见包装：{ content: [{ type:'text', text:'<json 或纯文本>' }] }
  if (data && Array.isArray(data.content)) {
    const t = data.content.map((c) => (c && typeof c.text === 'string') ? c.text : '').join('\n');
    try { data = JSON.parse(t); } catch { data = t; }
  }
  const results = [];
  const push = (r) => {
    if (!r || typeof r !== 'object') return;
    const url = String(r.url || r.link || r.href || '').trim();
    if (!/^https?:\/\//i.test(url)) return;
    results.push({ url, title: String(r.title || r.name || url), snippet: String(r.snippet || r.description || r.content || r.text || '') });
  };
  if (data && typeof data === 'object') {
    const arr = Array.isArray(data) ? data
      : (Array.isArray(data.results) ? data.results
        : (Array.isArray(data.items) ? data.items : (Array.isArray(data.data) ? data.data : [])));
    arr.forEach(push);
  }
  if (!results.length) {
    // 兜底：从原始文本里抽 http(s) 链接（去重、限量），保证"结果含来源链接"
    const seen = new Set();
    for (const m of text.matchAll(/https?:\/\/[^\s"'<>)\]]+/g)) {
      const url = m[0].replace(/[.,;]+$/, '');
      if (seen.has(url)) continue;
      seen.add(url);
      results.push({ url, title: url, snippet: '' });
      if (results.length >= 8) break;
    }
  }
  if (!results.length) return null;
  const obj = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
  return {
    query: typeof obj.query === 'string' ? obj.query : '',
    provider: typeof obj.provider === 'string' ? obj.provider : '',
    results: results.slice(0, 10),
  };
}

function genRow(role) {
  const d = document.createElement('div');
  d.className = 'gen';
  d.innerHTML = `<div class="avatar"><span class="ic">${ICONS[role ? role.icon : 'coder']}</span></div>
    <div class="col"><div class="lbl"><span class="spin"></span> ${tr('tool.processing')}</div></div>`;
  return d;
}

// 结构化计划卡片（update_plan）：步骤列表 + 状态图标，同回合内增量更新
function planCardEl() {
  const d = document.createElement('div');
  d.className = 'plan-card open';
  d.innerHTML = `
    <div class="th" >
      <span class="ic tico">${ICONS.doc}</span>
      <span class="tn">${tr('plan.title')}</span>
      <span class="caret">▾</span>
    </div>
    <div class="plan-body"></div>`;
  const body = d.querySelector('.plan-body');
  d.querySelector('.th').addEventListener('click', () => {
    d.classList.toggle('open');
    body.style.display = d.classList.contains('open') ? '' : 'none';
  });
  const ICON = { completed: '✓', inProgress: '●', pending: '○' };
  d.fill = (plan, explanation) => {
    body.innerHTML = (explanation ? `<div class="plan-exp">${esc(explanation)}</div>` : '') +
      (plan || []).map((s) => `<div class="plan-step st-${esc(s.status)}"><span class="ps-ic">${ICON[s.status] || '○'}</span><span>${esc(s.step)}</span></div>`).join('');
  };
  return { el: d, fill: d.fill };
}

// 询问选择框卡片：模型通过 request_user_input 向用户提问（可多问题、可带选项）
function askSummaryEl(v, answers) {
  // 消息流中的只读摘要：每问一行"题目 → ✓ 答案"（交互在独立弹窗）
  const d = document.createElement('div');
  d.className = 'ask-summary';
  const hasAns = !!answers;
  d.innerHTML = `<div class="th"><span class="ic tico">${ICONS.ask}</span><span class="tn">${hasAns ? tr('ask.confirmed') : tr('ask.pendingTitle')}</span></div><div class="as-body"></div>`;
  const body = d.querySelector('.as-body');
  for (const q of (v.questions || [])) {
    const row = document.createElement('div');
    row.className = 'as-row';
    const ans = hasAns && answers[q.id] && answers[q.id].answers;
    row.innerHTML = `<span class="as-q">${esc(q.header ? q.header + ' · ' : '')}${esc(q.question)}</span>` +
      (hasAns ? `<span class="as-a">✓ ${esc((ans || []).join('、') || tr('ask.skipped'))}</span>` : '<span class="as-a pending">' + tr('ask.pending') + '</span>');
    body.appendChild(row);
  }
  return d;
}

// ---- 模型提问弹窗（独立模态，收集多题后统一提交） ----
/** requestId 归一化：0 是合法 id（falsy 判断会丢事件），且数字 0 与字符串 '0' 必须等价 */
const ridOf = (v) => (v === undefined || v === null) ? '' : String(v);

const askModalState = { requestId: null, v: null };
// 询问/审批弹窗队列：多角色并行时可能同时来多条，必须逐条处理且**按请求所属会话应答**，
// 旧实现是「新请求直接顶掉旧请求」+ 用当前会话 id 应答 → 两条并行线程都会卡死。
let engineWarnSeen = null;   // 同一份"配置非法"告警只弹一次
const modalQueue = [];
let activeModal = null;
function sessionLabelOf(sid) {
  const ss = (state.sessions || []).find((x) => x.id === sid);
  const role = ss ? (state.roles || []).find((r) => r.id === ss.roleId) : null;
  return { role: (role && role.name) || '会话', title: (ss && ss.title) || sid };
}
function modalFromLine(sid) {
  const { role, title } = sessionLabelOf(sid);
  return `<div class="modal-from">${esc(tr('modal.from').replace('{r}', role).replace('{s}', title))}</div>`;
}
function enforceModals(sid) { // 被应答/取消后，把它从队列里摘掉
  const rid = ridOf(sid);
  for (let i = modalQueue.length - 1; i >= 0; i--) if (ridOf(modalQueue[i].requestId) === rid) modalQueue.splice(i, 1);
  if (activeModal && ridOf(activeModal.requestId) === rid) { activeModal = null; pumpModals(); }
}
function pumpModals() {
  if (activeModal) return;
  const next = modalQueue.shift();
  if (!next) return;
  activeModal = next;
  if (next.kind === 'ask') renderAskModal(next);
  else renderApprovalModal(next);
}
function queueModal(item) {
  item.requestId = ridOf(item.requestId);
  if (activeModal && ridOf(activeModal.requestId) === item.requestId) return;
  if (modalQueue.some((x) => ridOf(x.requestId) === item.requestId)) return;
  modalQueue.push(item);
  pumpModals();
  // 已有弹窗在显示时，新来的请求只更新"还有 N 条"角标（等当前这条处理完自动接上）
  if (activeModal) {
    for (const maskId of ['#askModalMask', '#apprMask']) {
      const box = document.querySelector(maskId + ' .modal-more');
      if (box) { box.textContent = tr('modal.queuedMore').replace('{n}', String(modalQueue.length)); box.style.display = modalQueue.length ? '' : 'none'; }
    }
  }
}
function modalQueueBadge() {
  // 始终输出该元素（无排队时隐藏）：后续新请求到达时可原地更新"还有 N 条"，否则元素不存在无从更新
  const n = modalQueue.length;
  const txt = n ? esc(tr('modal.queuedMore').replace('{n}', String(n))) : '';
  return `<div class="modal-more"${n ? '' : ' style="display:none"'}>${txt}</div>`;
}
function showAskModal(d) { queueModal({ kind: 'ask', ...d }); }
function renderAskModal(d) {
  // 已有一个提问弹窗开着时，直接替换内容（新请求优先）；旧弹窗未提交的答案丢弃但请求不阻塞
  askModalState.requestId = ridOf(d.requestId);
  askModalState.v = d;
  const mask = $('#askModalMask');
  const body = $('#askModalBody');
  body.innerHTML = '';
  const picks = {};
  const qs = d.questions || [];
  const updateSubmit = () => {
    const answered = qs.filter((q) => picks[q.id] && picks[q.id].length).length;
    const btn = $('#askModalSubmit');
    const foot = body.querySelector('.am-foot');
    btn.disabled = answered === 0;
    if (foot) foot.querySelector('.am-count').textContent = answered === qs.length ? tr('ask.allDone') : tr('ask.done').replace('{a}', String(answered)).replace('{n}', String(qs.length));
  };
  for (const q of qs) {
    const qd = document.createElement('div');
    qd.className = 'am-q';
    qd.innerHTML = `<div class="am-qt">${q.header ? `<span class="ask-h">${esc(q.header)}</span>` : ''}${esc(q.question)}</div>`;
    if (Array.isArray(q.options) && q.options.length) {
      const opts = document.createElement('div');
      opts.className = 'ask-opts';
      const choose = (label) => {
        picks[q.id] = [label];
        opts.querySelectorAll('.ask-opt').forEach((b) => b.classList.toggle('sel', b.dataset.label === label));
        // 清空“其他”输入框内容
        const oth = qd.querySelector('.ask-other input');
        if (oth) oth.value = ''; // 仅清空输入框，不发事件（避免覆盖 picks）
        updateSubmit();
      };
      for (const o of q.options) {
        const b = document.createElement('button');
        b.className = 'ask-opt'; b.type = 'button'; b.dataset.label = o.label;
        b.innerHTML = `<span class="ao-label">${esc(o.label)}</span>${o.description ? `<span class="ao-desc">${esc(o.description)}</span>` : ''}`;
        b.addEventListener('click', () => choose(o.label));
        opts.appendChild(b);
      }
      // 「其他」直接做输入框（无独立按钮），点击即可输入；内容作为该题答案
      // codex 透传字段为 camelCase isOther（旧 schema 亦可能 is_other），两者兼容
      const hasOther = q.isOther || q.is_other;
      if (hasOther) {
        const other = document.createElement('div');
        other.className = 'ask-other';
        other.innerHTML = `<input type="text" placeholder="${tr('ask.otherPh')}">`;
        const inp = other.querySelector('input');
        inp.addEventListener('focus', () => {
          // 聚焦输入框即视为选择"其他"，清除已选选项
          opts.querySelectorAll('.ask-opt').forEach((b) => b.classList.remove('sel'));
        });
        inp.addEventListener('input', () => {
          if (inp.value.trim()) { picks[q.id] = [inp.value.trim()]; updateSubmit(); }
          else delete picks[q.id];
        });
        qd.appendChild(opts);
        qd.appendChild(other);
      } else {
        qd.appendChild(opts);
      }
    } else {
      const input = document.createElement('div');
      input.className = 'ask-input';
      input.innerHTML = `<input type="text" placeholder="${tr('ask.answerPh')}">`;
      const inp = input.querySelector('input');
      inp.addEventListener('input', () => { if (inp.value.trim()) picks[q.id] = [inp.value.trim()]; updateSubmit(); });
      qd.appendChild(input);
    }
    body.appendChild(qd);
  }
  const foot = document.createElement('div');
  foot.className = 'am-foot';
  foot.innerHTML = `<span class="am-count"></span>`;
  body.appendChild(foot);
  // 顶部标注来源会话：并行时用户知道这条弹窗属于哪个角色/会话
  if (body.parentElement) {
    body.parentElement.querySelectorAll('.modal-from, .modal-more').forEach((el) => el.remove());
    body.insertAdjacentHTML('beforebegin', modalFromLine(d.sessionId) + modalQueueBadge());
  }
  $('#askModalSubmit').onclick = () => {
    const finalAns = {};
    for (const q of qs) if (picks[q.id] && picks[q.id].length) finalAns[q.id] = { answers: picks[q.id] };
    api('POST', '/api/ask', { sessionId: d.sessionId, requestId: ridOf(d.requestId), answers: finalAns });
    hideAskModal();
  };
  // 右上角 ✕：跳过不回答（回空 answers，避免 turn 空等）
  $('#askModalClose').onclick = () => {
    api('POST', '/api/ask', { sessionId: d.sessionId, requestId: ridOf(d.requestId), answers: {} });
    hideAskModal();
  };
  updateSubmit();
  mask.classList.add('show');
}
/**
 * 回合已结束/被中断：该会话的审批与询问弹窗不可能再有结果，必须撤掉。
 * 否则 activeModal 一直被占着，后面任何会话的审批都只能排队（表现为"点了没反应/一直转"）。
 */
function closeStaleModals(sessionId) {
  const stale = [];
  if (activeModal && (!sessionId || activeModal.sessionId === sessionId)) stale.push(activeModal);
  for (let i = modalQueue.length - 1; i >= 0; i--) {
    if (!sessionId || modalQueue[i].sessionId === sessionId) { stale.push(modalQueue[i]); modalQueue.splice(i, 1); }
  }
  if (!stale.length) return;
  for (const m of stale) enforceModals(m.requestId);
  $('#askModalMask').classList.remove('show');
  $('#apprMask').classList.remove('show');
  askModalState.requestId = null;
  askModalState.v = null;
  activeModal = null;
  pumpModals();
}

function hideAskModal() {
  const rid = askModalState.requestId;
  askModalState.requestId = null;
  askModalState.v = null;
  $('#askModalMask').classList.remove('show');
  if (activeModal && (rid === null || activeModal.requestId === rid)) { activeModal = null; pumpModals(); }
}

function thinkCardEl() {
  const d = document.createElement('div');
  d.className = 'think-card';
  d._start = Date.now();
  d._done = false;
  d.innerHTML = `
    <div class="tk-head">
      <span class="tk-dot">\u2726</span>
      <span class="tk-label">${tr('think.inProgress')}</span>
      <span class="tk-preview"></span>
      <span class="tk-caret">\u25be</span>
    </div>
    <div class="tk-body"></div>`;
  const head = d.querySelector('.tk-head');
  const body = d.querySelector('.tk-body');
  const label = d.querySelector('.tk-label');
  const preview = d.querySelector('.tk-preview');
  head.addEventListener('click', () => {
    d.classList.toggle('open');
    if (!d._done) preview.style.display = d.classList.contains('open') ? 'none' : '';
  });
  d.update = (raw) => {
    body.textContent = raw;
    if (d._done) return;
    // 流式中：标题行显示最近一行思考的预览（正文保持折叠）
    const lines = raw.split('\n').filter((l) => l.trim());
    preview.textContent = lines.length ? lines[lines.length - 1].slice(0, 120) : '';
  };
  d.fold = () => {
    if (d._done) return;
    d._done = true;
    d.classList.remove('open');
    preview.style.display = '';
    preview.textContent = '';
    const secs = Math.max(1, Math.round((Date.now() - d._start) / 1000));
    label.textContent = tr('think.seconds').replace('{n}', String(secs));
  };
  return d;
}


// 审批弹窗：收到工具/命令权限申请时弹出，允许/拒绝后回传
// 入队（真正的弹窗渲染在 renderApprovalModal：由 pumpModals 调度）
function showApprovalModal(ev) { queueModal({ kind: 'appr', ...ev }); }
/* ---------- 审批可见状态：把"在等我点审批"与"在执行"区分开 ----------
   现场问题：点同意后工具卡一直"运行中"，其实是在等人工审批；被拒后卡片只剩一句莫名的"运行中"。
   这里把审批请求映射到对应工具卡（按命令文本匹配，退化为"最后一个未结束的 exec 卡"），
   并在卡状态 chip 上给出「等待人工审批 / 已拒绝，命令未执行 / 审批未送达」等明确状态。 */
const EXEC_TOOL_NAMES = /shell|exec|command|apply_patch|patch/i;

function isExecToolCard(card) {
  if (!card || card.dataset.done === '1') return false;
  return EXEC_TOOL_NAMES.test(card.dataset.toolName || '');
}
/** 找到该审批请求对应的工具卡：先按命令文本精确匹配，再退化为最后一个未结束的 exec 卡 */
function findApprovalCard(ev) {
  const cards = [...document.querySelectorAll('#feed > .tool-card')].filter(isExecToolCard);
  const cmd = String((ev && ev.command) || '').trim();
  if (cmd) {
    for (let i = cards.length - 1; i >= 0; i--) {
      const args = String(cards[i].querySelector('.ta') ? cards[i].querySelector('.ta').textContent : '').trim();
      if (args && (args === cmd || args.includes(cmd) || cmd.includes(args))) return cards[i];
    }
  }
  return cards.length ? cards[cards.length - 1] : null;
}
/** 卡片状态 chip：wait / err / run 三态（wait 必须一眼区别于"运行中"） */
function setCardChip(card, mode, label) {
  if (!card) return;
  const st = card.querySelector('.st');
  if (!st) return;
  if (mode === 'wait') { st.className = 'st wait'; st.innerHTML = '<span class="spin"></span>' + esc(label); }
  else if (mode === 'err') { st.className = 'st err'; st.innerHTML = '✗ ' + esc(label); }
  else if (mode === 'run') { st.className = 'st'; st.innerHTML = '<span class="spin"></span>' + esc(label || tr('tool.run')); }
  else { st.className = 'st ok'; st.innerHTML = ICONS.check + ' ' + esc(label || tr('tool.done')); }
}
function setCardNote(card, text, isErr) {
  if (!card) return;
  let note = card.querySelector('.appr-note');
  if (!note) { note = document.createElement('div'); note.className = 'appr-note'; card.appendChild(note); }
  note.className = 'appr-note' + (isErr ? ' err' : '');
  note.textContent = text;
}
/** 会话头状态：有未决审批 → 「等待人工审批」；否则回到 busy/ready 的真实状态 */
function syncAgentStatus() {
  const sid = state.currentSession && state.currentSession.id;
  const waiting = sid && Object.values(state.approvals).some((a) => a.sessionId === sid);
  if (waiting) setAgentStatus('wait');
  else if (curBusy()) setAgentStatus('running');
  else setAgentStatus('ready');
}
/** 审批请求到达：登记 + 卡片进入等待态 + 会话头状态 */
function markApprovalPending(ev) {
  const rid = ridOf(ev && ev.requestId);
  if (!ev || !rid) return;
  const card = findApprovalCard(ev);
  state.approvals[rid] = {
    sessionId: ev.sessionId, kind: ev.kind, command: ev.command || '',
    toolId: card ? (card.dataset.toolId || '') : '',
  };
  if (card) {
    card.dataset.approvalId = rid;
    setCardChip(card, 'wait', tr('appr.waitChip'));
    setCardNote(card, tr('appr.waitNote').replace('{c}', String(ev.command || '').slice(0, 300)), false);
  }
  syncAgentStatus();
}
/** 审批已应答：允许 → 恢复"运行中"（命令真的开始跑了）；拒绝/关闭 → 明确"已拒绝，命令未执行" */
function resolveApprovalPending(ev, decision) {
  const rid = ridOf(ev && ev.requestId);
  if (rid) delete state.approvals[rid];
  const card = rid
    ? document.querySelector(`#feed > .tool-card[data-approval-id="${rid}"]`)
    : null;
  if (card) {
    delete card.dataset.approvalId;
    if (decision === 'accept') setCardChip(card, 'run', tr('tool.run'));
    else if (decision === 'decline') {
      setCardChip(card, 'err', tr('appr.deniedChip'));
      setCardNote(card, tr('appr.deniedNote'), true);
    } else {
      setCardChip(card, 'err', tr('appr.turnEnded'));
      setCardNote(card, tr('appr.turnEnded'), true);
    }
  }
  syncAgentStatus();
}

function renderApprovalModal(ev) {
  const mask = $('#apprMask');
  const titleEl = mask.querySelector('.appr-title');
  const kind = ev.kind;
  let titleInner, bodyHtml;
  if (kind === 'mcp-tool') {
    // 远程 MCP 工具授权：escalate(提权) / confirm(请求)，文案随界面语言本地化
    const escalate = ev.level === 'escalate';
    const label = escalate ? tr('appr.mcpEscalateTitle') : tr('appr.mcpConfirmTitle');
    titleInner = `<span class="appr-ic">⤴</span><span>${esc(label)}</span>`;
    if (escalate) {
      bodyHtml = `<div class="appr-cmd">${esc(tr('appr.mcpRun').replace('{t}', ev.toolName || ''))}</div>`
        + (ev.reason ? `<div class="appr-why">${esc(ev.reason)}</div>` : '');
    } else {
      bodyHtml = (ev.message ? `<div class="appr-cmd">${esc(ev.message)}</div>` : '')
        + (ev.reason ? `<div class="appr-why">${esc(ev.reason)}</div>` : '');
    }
  } else if (kind === 'patch' || kind === 'exec') {
    // 命令/写盘审批（exec_command / apply_patch，网络出站等命令也走此门）
    const label = kind === 'patch' ? tr('appr.patch') : tr('appr.exec');
    titleInner = `<span class="appr-ic">⚠</span><span>${esc(label)}</span>`;
    bodyHtml = `<div class="appr-cmd">${esc(ev.command || '')}</div><div class="appr-why">${esc(tr('appr.outPolicy'))}</div>`;
  } else {
    titleInner = `<span class="appr-ic">⚠</span><span>${tr('appr.needPrefix')}${esc(ev.title || tr('appr.operation'))}</span>`;
    bodyHtml = `<div class="appr-cmd">${esc(ev.command || '')}</div>` +
      (ev.reason ? `<div class="appr-why">${esc(ev.reason)}</div>` : '');
  }
  titleEl.innerHTML = titleInner;
  const body = mask.querySelector('.modal-body');
  body.innerHTML = modalFromLine(ev.sessionId) + bodyHtml + modalQueueBadge();
  const errEl = $('#apprErr');
  if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
  const finish = async (ok) => {
    // 关键：用请求自带的 sessionId（不是"当前正在看的会话"）——否则并行时会答到别的线程上，两边都卡
    const allowBtn = $('#apprAllow'), denyBtn = $('#apprDeny'), closeBtn = $('#apprClose');
    for (const b of [allowBtn, denyBtn, closeBtn]) if (b) b.disabled = true;
    const keep = denyBtn ? denyBtn.textContent : '';
    if (denyBtn) denyBtn.textContent = tr('appr.submitting');
    let r = null, thrown = null;
    try { r = await api('POST', '/api/approve', { sessionId: ev.sessionId, requestId: ridOf(ev.requestId), decision: ok }); }
    catch (e) { thrown = (e && e.message) || String(e); }
    for (const b of [allowBtn, denyBtn, closeBtn]) if (b) b.disabled = false;
    if (denyBtn) denyBtn.textContent = keep;
    const failed = thrown || !r || r.error || r.ok === false;
    if (failed) {
      // ★ 禁止静默：弹窗留在原地 + 明确错误（状态码/服务端 error/异常文本），并在消息流留一条系统行
      const status = (r && (r.status || r.code)) ? (' [' + (r.status || r.code) + ']') : '';
      const detail = thrown ? tr('appr.sendFailThrown').replace('{e}', thrown)
        : ((r && (r.error || r.message)) || tr('appr.sendFailUnknown'));
      const msg = tr('appr.sendFailMsg').replace('{e}', status + ' ' + detail);
      if (errEl) { errEl.hidden = false; errEl.textContent = '⚠ ' + msg; }
      noticeLine('⚠ ' + msg);
      syncAgentStatus();
      return;   // 不关窗、不当作已应答：用户可以重试或改用关闭（关闭=拒绝）
    }
    mask.classList.remove('show');
    activeModal = null;
    // 本地先落定状态（引擎随后会广播 approval-resolved / tool-end 覆盖为最终结果）
    resolveApprovalPending(ev, ok ? 'accept' : 'decline');
    pumpModals();
  };
  $('#apprAllow').onclick = async () => { await finish(true); };
  $('#apprDeny').onclick = async () => { await finish(false); };
  $('#apprClose').onclick = async () => { await finish(false); }; // 关闭=拒绝，避免 turn 空等
  mask.classList.add('show');
}

function scrollBottom() {
  const r = $('#chatroom');
  r.scrollTop = r.scrollHeight;
}
// 仅当用户当前“贴底”（距底 <80px）才自动跟随滚动；用户上滑阅读则停止抢滚动
function stickToBottom() {
  const r = $('#chatroom');
  if (r.scrollHeight - r.scrollTop - r.clientHeight < 80) { r.scrollTop = r.scrollHeight; }
}
function now() { return new Date().toTimeString().slice(0, 5); }
// 历史消息时间：当天显示 HH:MM，更早显示 MM-DD HH:MM（无 ts 则回退当前时间）
function fmtTs(ts) {
  if (!ts) return now();
  const d = new Date(ts);
  const hm = d.toTimeString().slice(0, 5);
  return d.toDateString() === new Date().toDateString() ? hm
    : `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hm}`;
}
function currentRole() {
  if (!state.currentSession) return null;
  return state.roles.find((r) => r.id === state.currentSession.roleId);
}

/* ---------- 顶栏：智能体状态 + 会话角色 ---------- */

function setAgentStatus(mode, text) {
  // mode: 'ready' | 'running' | 'error' | 'wait'（wait = 等待人工审批，与"处理中"必须能区分）
  const pill = $('#agentStatus');
  if (!pill) return;
  const label = $('#agentStatusText');
  const def = mode === 'running' ? 'status.running' : mode === 'error' ? 'status.error'
    : mode === 'wait' ? 'status.approvalWait' : 'status.ready';
  if (label) label.textContent = text || tr(def);
  pill.classList.remove('running', 'error', 'wait');
  if (mode === 'running' || mode === 'error' || mode === 'wait') pill.classList.add(mode);
}

/** 联网开关的视觉状态（默认开；关闭后本轮不搜） */
function renderTopbar() {
  const role = currentRole();
  if (role) {
    $('#topIcon').innerHTML = ICONS[role.icon] || ICONS.coder;
    $('#topRole').textContent = role.name;
    $('#topTitle').textContent = state.currentSession ? state.currentSession.title : role.name;
  } else {
    $('#topTitle').textContent = 'ROSE';
    $('#topRole').textContent = '—';
  }
  const wsEl = $('#topWorkspace');
  if (wsEl) {
    const wsp = state.currentSession && state.currentSession.workspace;
    wsEl.style.display = wsp ? 'inline-flex' : 'none';
    if (wsp) { wsEl.textContent = wsp; wsEl.title = tr('ws.locked'); }
  }
  const btn = $('#sendBtn');
  const stop = $('#stopBtn');
  btn.title = tr('send.title');
  btn.disabled = !state.currentSession;
  if (stop) stop.style.display = curBusy() ? 'flex' : 'none';
  syncModeUI();
  fillModelSelect();
  renderCtxHint();
  renderQueueHint();
  renderCompactMask();
  renderGoalBar();   // 目标栏跟随会话/目标变化（编辑期间由 renderGoalBar 自己守卫，不吞输入）
}

// ---- 会话模式：由会话策略三元组推断，UI 以三种模式呈现 ----
// 计划模式 = planMode:true + 只读；零监管 = 完全访问 + 自动执行；默认 = 可写工作区 + 需审批
function currentMode(s) {
  const sess = s || state.currentSession;
  if (!sess) return 'default';
  if (sess.planMode) return 'plan';
  if (sess.sandbox === 'danger-full-access' && sess.approval === 'never') return 'free';
  return 'default';
}
// 模式 → 发送给网关的三元组
function modePolicy(mode) {
  if (mode === 'plan') return { planMode: true, sandbox: 'read-only', approval: 'on-request' };
  if (mode === 'free') return { planMode: false, sandbox: 'danger-full-access', approval: 'never' };
  return { planMode: false, sandbox: 'workspace-write', approval: 'on-request' };
}
const MODE_META = {
  plan: { label: 'plan', ic: '✦' },
  default: { label: 'default', ic: '⚙' },
  free: { label: 'free', ic: '⚠' },
};
function syncModeUI() {
  const m = currentMode();
  const btn = $('#modeBtn');
  if (btn) {
    btn.dataset.mode = m;
    $('#modeLbl').textContent = tr('mode.' + MODE_META[m].label);
    $('#modeIc').textContent = MODE_META[m].ic;
    // 无会话时禁用（模式随会话保存），提示先开会话
    const noSess = !state.currentSession;
    btn.classList.toggle('disabled', noSess);
    btn.title = noSess ? tr('mode.needSess') : tr('mode.select');
  }
  const pop = $('#modePop');
  if (pop) pop.querySelectorAll('.mode-opt').forEach((o) => o.classList.toggle('cur', o.dataset.mode === m));
}

// 主界面下拉只展示“模型配置中已启用”的模型（enabledModels，跨 provider 扁平）
function modelOptions() {
  const out = [];
  const glob = (state.settings && state.settings.global) || {};
  const em = glob.enabledModels || [];
  for (const e of em) {
    const providers = (state.settings && state.settings.providers) || {};
    const p = providers[e.providerId] || {};
    // 显示名里若看不出真正的请求名（用户自定义过 label），补一个括号标注，
    // 避免"下拉里叫 A、实际请求 B"这种看不见的偏差
    const base = e.label || ((p.name || e.providerId) + ' · ' + e.modelId);
    const showReq = e.label && !String(e.label).includes(e.modelId);
    out.push({ pid: e.providerId, model: e.modelId, label: showReq ? base + '（' + e.modelId + '）' : base, active: false });
  }
  return out;
}

// 该角色上一次使用的模型（取该角色最近一次带模型的会话）；没有则空
function roleLastModel(roleId) {
  const list = (state.sessions || [])
    .filter((s) => s.roleId === roleId && s.providerId && s.modelId)
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  const s = list[0];
  return s ? { pid: s.providerId, model: s.modelId } : { pid: '', model: '' };
}

// 会话自身记录优先；否则沿用该角色上次使用的模型（**取消全局默认模型**；首次选择前为空）
function currentSessionProviderModel() {
  const s = state.currentSession;
  if (s && s.providerId && s.modelId) return { pid: s.providerId, model: s.modelId };
  return roleLastModel((s && s.roleId) || '');
}

// 发送框旁下拉框当前选中的模型（形如 "providerId|modelId"）；未选返回 null
function pickedModelFromSelect() {
  const sel = $('#modelSelect');
  if (!sel || !sel.value) return null;
  const [pid, model] = sel.value.split('|');
  return (pid && model) ? { pid, model } : null;
}

// 本会话「将要使用」的模型：**发送框下拉框优先**（用户刚选完就该生效），
// 其次会话已记录，最后沿用该角色上次用过的。三者都没有 → null。
// 历史 bug：只查会话与角色历史，不查下拉框，导致「选完模型点发送仍被要求先选模型」。
function effectiveProviderModel() {
  const picked = pickedModelFromSelect();
  if (picked) return picked;
  const cm = currentSessionProviderModel();
  return (cm.pid && cm.model) ? cm : null;
}

function fillModelSelect() {
  const sel = $('#modelSelect');
  if (!sel) return;
  const opts = modelOptions();
  const cur = currentSessionProviderModel();
  if (!opts.length) {
    sel.innerHTML = '<option value="">' + tr('model.enableFirst') + '</option>';
    return;
  }
  const curKey = sel.value;
  // 空值占位项：会话未选模型时不自动挑一个（首次使用交由用户选择）
  sel.innerHTML = '<option value="">' + tr('model.choosePh') + '</option>' + opts
    .map((o) => `<option value="${esc(o.pid)}|${esc(o.model)}">${esc(o.label)}</option>`)
    .join('');
  // 优先保留用户已选值（会话内换模型不会被重置）
  if (curKey && opts.some((o) => (o.pid + '|' + o.model) === curKey)) {
    sel.value = curKey;
  } else {
    const wantKey = cur.pid + '|' + cur.model;
    sel.value = opts.some((o) => (o.pid + '|' + o.model) === wantKey) ? wantKey : '';
  }
}



/* ---------- 侧栏收起/展开（收起后只留 图标：logo / 新建 / 设置） ---------- */
const SIDEBAR_KEY = 'rose.sidebar.collapsed';
function sidebarCollapsed() {
  try { return localStorage.getItem(SIDEBAR_KEY) === '1'; } catch { return false; }
}
function applySidebarCollapsed(v) {
  const app = document.querySelector('.app');
  if (!app) return;
  app.classList.toggle('side-collapsed', !!v);
  try { localStorage.setItem(SIDEBAR_KEY, v ? '1' : '0'); } catch {}
}
function toggleSidebar() { applySidebarCollapsed(!sidebarCollapsed()); }


/* ---------- 原生指令（斜杠命令；对齐 codex TUI 指令名 + dsh 的交互） ---------- */
// 说明：ROSE 走 codex app-server（不是 TUI），所以只收录"引擎/ROSE 真能执行"的指令；
// 未收录的（/vim /pet /quit /raw /cd … 属 TUI 本地功能）不假装支持。
function noticeLine(text) {
  const feed = $('#feed');
  if (!feed) return;
  const d = document.createElement('div');
  d.className = 'sys-row';
  d.textContent = text;
  feed.appendChild(d);
  stickToBottom();
}

const cmd = {
  // —— 引擎侧 ——
  web: {
    args: '<query>', desc: 'cmd.web.desc', needsSession: true,
    async run(arg) {
      const q = String(arg || '').trim();
      if (!q) throw new Error(tr('cmd.web.needArg'));
      const r = await api('POST', '/api/web/search', { query: q, limit: 5 });
      if (!r || !r.results || !r.results.length) return tr('web.none');
      const feed = $('#feed');
      if (feed) { feed.appendChild(webCardEl({ query: q, provider: r.provider, results: r.results })); stickToBottom(); }
      return tr('web.sources').replace('{p}', String(r.provider || 'web')).replace('{n}', String(r.results.length));
    },
  },
  compact: {
    args: '', desc: 'cmd.compact.desc',
    async run() {
      const r = await doCompact();
      if (r && r.error) throw new Error(r.error);
      return tr('cmd.compact.done');
    },
  },
  // —— 会话配置（与发送框旁的控件同一套状态）——
  model: {
    needsSession: true,
    args: '[model]', desc: 'cmd.model.desc',
    async run(arg) {
      const opts = modelOptions();
      if (!arg) {
        if (!opts.length) return tr('cmd.model.none');
        return tr('cmd.model.list') + '\n' + opts.map((o) => `  ${o.model}  (${o.pid})${o.model === state.currentSession.modelId ? '  ← ' + tr('cmd.model.current') : ''}`).join('\n');
      }
      const hit = opts.find((o) => o.model === arg) || opts.find((o) => o.model.toLowerCase().includes(arg.toLowerCase()));
      if (!hit) return tr('cmd.model.unknown').replace('{n}', arg);
      state.currentSession.providerId = hit.pid;
      state.currentSession.modelId = hit.model;
      const inList = (state.sessions || []).find((x) => x.id === state.currentSession.id);
      if (inList) { inList.providerId = hit.pid; inList.modelId = hit.model; }
      fillModelSelect();
      const sel = $('#modelSelect');
      if (sel) sel.value = hit.pid + '|' + hit.model;   // 发送框下拉是"下一轮用哪个模型"的真源
      renderTopbar();
      return tr('cmd.model.set').replace('{n}', hit.model);
    },
  },
  approvals: {
    needsSession: true,
    args: '[on-request|never]', desc: 'cmd.approvals.desc',
    async run(arg) {
      const v = (arg || '').trim();
      if (!v) return tr('cmd.approvals.cur').replace('{n}', state.currentSession.approval || 'on-request') + '\n  on-request  ' + tr('cmd.approvals.onRequest') + '\n  never       ' + tr('cmd.approvals.never');
      if (v !== 'on-request' && v !== 'never') return tr('cmd.approvals.bad');
      state.currentSession.approval = v;
      syncModeUI();
      return tr('cmd.approvals.set').replace('{n}', v);
    },
  },
  plan: {
    needsSession: true,
    args: '', desc: 'cmd.plan.desc',
    async run() {
      const on = !state.currentSession.planMode;
      state.currentSession.planMode = on;
      state.currentSession.sandbox = on ? 'read-only' : 'workspace-write';
      syncModeUI();
      return on ? tr('cmd.plan.on') : tr('cmd.plan.off');
    },
  },
  rename: {
    needsSession: true,
    args: '<title>', desc: 'cmd.rename.desc',
    async run(arg) {
      const t = (arg || '').trim();
      if (!t) return tr('cmd.rename.need');
      const r = await api('PATCH', '/api/sessions/' + state.currentSession.id, { title: t });
      if (r && r.error) return tr('cmd.fail') + r.error;
      state.currentSession.title = t;
      await refreshSessions(); renderSidebar(); renderTopbar();
      return tr('cmd.rename.done').replace('{n}', t);
    },
  },
  status: {
    needsSession: true,
    args: '', desc: 'cmd.status.desc',
    async run() {
      const s0 = state.currentSession;
      const used = Number(s0.contextUsed) || 0, win = Number(s0.contextWindow) || 0;
      const role = currentRole();
      return [
        `${tr('cmd.status.role')}: ${role ? role.name : '-'}`,
        `${tr('cmd.status.model')}: ${s0.modelId || '-'} (${s0.providerId || '-'})`,
        `${tr('cmd.status.sandbox')}: ${s0.sandbox}   ${tr('cmd.status.approval')}: ${s0.approval}`,
        `${tr('cmd.status.plan')}: ${s0.planMode ? tr('common.on') : tr('common.off')}`,
        `${tr('cmd.status.workspace')}: ${s0.workspace || '-'}`,
        `${tr('cmd.status.context')}: ${used ? Math.round(used / 1000) + 'k' + (win ? ' / ' + Math.round(win / 1000) + 'k' : '') : '-'}`,
        `${tr('cmd.status.running')}: ${curBusy() ? tr('common.on') : tr('common.off')}`,
      ].join('\n');
    },
  },
  // —— 应用动作 ——
  new: {
    args: '', desc: 'cmd.new.desc',
    async run() { openRolePicker(); return tr('cmd.new.done'); },
  },
  init: {
    args: '', desc: 'cmd.init.desc',
    async run() {
      // 对齐 codex 的 /init：生成 AGENTS.md（作为普通消息发给模型，落盘可追溯）
      const prompt = 'Create an AGENTS.md file at the repository root containing project-specific instructions for future agent runs: how to build, test, lint, run locally, coding conventions, and any gotchas you can verify from the repo. Keep it concise and factual; do not invent commands you could not verify.';
      const inp = $('#input'); if (inp) inp.value = prompt;
      await send();
      return tr('cmd.init.done');
    },
  },
  skills:    { args: '', desc: 'cmd.skills.desc',    async run() { toggleSkillPicker(); return tr('cmd.panelOpened'); } },
  mcp:       { args: '', desc: 'cmd.mcp.desc',       async run() { openSettings('mcp'); return tr('cmd.panelOpened'); } },
  usage:     { args: '', desc: 'cmd.usage.desc',     async run() { openSettings('usage'); return tr('cmd.panelOpened'); } },
  settings:  { args: '', desc: 'cmd.settings.desc',  async run() { openSettings('model'); return tr('cmd.panelOpened'); } },
  help: {
    args: '', desc: 'cmd.help.desc',
    async run() {
      return tr('cmd.help.title') + '\n' + Object.entries(cmd)
        .map(([n, c]) => `  /${n}${c.args ? ' ' + c.args : ''}`.padEnd(24) + tr(c.desc)).join('\n');
    },
  },
};

// 解析一行输入：命中已注册指令才拦截（否则当普通消息发出去，"/tmp 是啥" 仍可用）
function parseCommand(line) {
  const t = String(line || '').trimStart();
  if (!t.startsWith('/')) return null;
  const m = t.match(/^\/([A-Za-z][\w-]*)(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  const name = m[1].toLowerCase();
  if (!cmd[name]) return null;
  return { name, arg: (m[2] || '').trim() };
}

// 让高亮项滚入面板可视区（面板 max-height 300px，条目多时超出 → 必须自动跟随）
function scrollCmdIntoView(el) {
  const box = $('#cmdPicker');
  if (!box || !el) return;
  const top = el.offsetTop;
  const bottom = top + el.offsetHeight;
  if (top < box.scrollTop) box.scrollTop = top;
  else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
}

let cmdActive = -1;
function cmdCandidates(q) {
  const keys = Object.keys(cmd);
  if (!q) return keys;                              // 光杆 "/" → 列出全部
  return keys.filter((n) => n.startsWith(q));       // 无命中 → 空数组（**不**回退成"全部指令"）
}
function renderCmdPicker() {
  const box = $('#cmdPicker');
  const inp = $('#input');
  if (!box || !inp) return;
  const t = inp.value;
  const hide = () => { box.hidden = true; box.innerHTML = ''; cmdActive = -1; };
  const m = t.match(/^\/([A-Za-z][\w-]*)?$/);    // 光杆 "/" 或 "/xxx"（尚未输入参数）时弹面板
  if (!m) { hide(); return; }
  const cands = cmdCandidates((m[1] || '').toLowerCase());
  if (!cands.length) { hide(); return; }                      // 无命中 → 不显示面板
  if (cmdActive >= cands.length) cmdActive = 0;
  box.hidden = false;
  box.innerHTML = `<div class="cmd-head">${esc(tr('cmd.head'))}</div>` + cands.map((n, i) => `
    <button type="button" class="cmd-item${i === cmdActive ? ' active' : ''}" data-name="${esc(n)}">
      <span class="cmd-name">/${esc(n)}</span>
      ${cmd[n].args ? `<span class="cmd-args">${esc(cmd[n].args)}</span>` : ''}
      <span class="cmd-desc">${esc(tr(cmd[n].desc))}</span>
    </button>`).join('');
  box.querySelectorAll('.cmd-item').forEach((el) => el.addEventListener('mousedown', (e) => {
    e.preventDefault();
    completeCommand(el.dataset.name);
  }));
}
function completeCommand(name) {
  const inp = $('#input');
  if (!inp) return;
  inp.value = '/' + name + (cmd[name] && cmd[name].args ? ' ' : '');
  inp.focus();
  renderCmdPicker();
}
async function runCommandLine(line) {
  const parsed = parseCommand(line);
  if (!parsed) return false;
  const inp = $('#input');
  if (inp) inp.value = '';
  renderCmdPicker();
  const c = cmd[parsed.name];
  if (c.args && !parsed.arg && c.args.startsWith('<')) { noticeLine(tr('cmd.needArg').replace('{n}', '/' + parsed.name + ' ' + c.args)); return true; }
  // 这些指令操作"当前会话"：没有会话时必须给人话，而不是抛 Cannot read properties of null
  if (c.needsSession && !state.currentSession) { noticeLine(tr('cmd.needSession')); return true; }
  try {
    const text = await c.run(parsed.arg);
    if (text) noticeLine(`/${parsed.name}\n${text}`);
  } catch (e) {
    noticeLine(`/${parsed.name}\n${tr('cmd.fail')}${(e && e.message) || e}`);
  }
  return true;
}

/* ---------- 会话动作 ---------- */

async function newSession(roleId) {
  collapsedRoles.delete(roleId); // 新建会话 → 展开该角色分组（其它角色保持原收起状态）
  // 工作目录：**必选、无默认值、建后不可改**（codex 的 cwd 属于线程，中途改等于换线程、丢上下文）
  const workspace = await pickWorkspaceForNewSession();
  if (!workspace) return;
  const s = await api('POST', '/api/sessions', { roleId, workspace });
  if (!s || s.error || !s.id) {
    uiDialog({ title: tr('dial.hint'), message: (s && s.error) || tr('ws.fail'), buttons: [{ label: tr('dial.gotit'), value: true, primary: true }] });
    return;
  }
  await refreshSessions();
  await openSession(s.id);
}

// 新建会话的工作目录选择：系统目录选择框；用户取消 → 放弃建会话
async function pickWorkspaceForNewSession() {
  if (!window.rose || typeof window.rose.pickDirectory !== 'function') {
    // 浏览器直开（无 Electron 垫片）：退化为手输路径
    const typed = window.prompt(tr('ws.pickTitle'), '');
    return typed && typed.trim() ? typed.trim() : null;
  }
  const r = await window.rose.pickDirectory(tr('ws.pickTitle'));
  if (!r || r.canceled || !r.path) return null;
  return r.path;
}
async function deleteSession(id) {
  await api('DELETE', '/api/sessions/' + id);
  if (state.currentSession && state.currentSession.id === id) state.currentSession = null;
  await refreshSessions();
  renderFeed(); renderTopbar(); renderSidebar();
}
let openSeq = 0;   // 点击序号：只有最后一次点击的结果可以落地（避免"后点的先到"）
async function openSession(id) {
  const seq = ++openSeq;
  const messages = await api('GET', '/api/sessions/' + id + '/messages');
  let s = state.sessions.find((x) => x.id === id);
  if (!s) {
    // 本地列表可能过期（别处新建/删除过会话）：先刷新再找。
    // 历史隐患：直接 {...undefined} 会得到**没有 id 的 currentSession**，
    // 之后发送会打到 /api/sessions/undefined/messages，用户只看到一句「session not found」。
    await refreshSessions();
    s = state.sessions.find((x) => x.id === id);
  }
  if (!s) return;   // 会话确实不存在（已被删除）——不要设置残缺的 currentSession
  if (seq !== openSeq) return;   // 期间用户又点了别的会话：本次结果作废（含下面的 render）
  state.currentSession = { ...s, messages };
  state.selSkills = []; // 切换会话时清空已选技能
  state.goalEditing = false;   // 目标栏编辑态不跨会话
  // 切到该会话时补上"它不在前台时"收到的窗口续接提示（这些提示只存在于本次运行）
  const pendWr = state.winResetPending[id];
  if (pendWr && pendWr.length) { messages.push(...pendWr); delete state.winResetPending[id]; }
  // ⚠️ 待发附件也必须清空：否则在 A 里选的文件会被发给 B（发送允许"仅附件"，静默串台）
  state.attachments = [];
  renderAttPicks();
  loadSkills();
  await syncRunning(); // 打开即与服务端对账任务状态（含其它标签页/断线期间开始的任务）
  if (seq !== openSeq) return;
  renderSidebar(); renderFeed(); renderTopbar();
  syncAgentStatus();   // 该会话若有未决审批，会话头直接显示「等待人工审批」
  loadGoal(id);        // 目标以服务端为准（异步，不阻塞首屏）
  loadSubagents(id);   // 子代理列表与服务端对账（路由未就绪时静默回落 SSE）
}
async function refreshSessions() { state.sessions = await api('GET', '/api/sessions'); }

// 与服务端对账：哪些会话当前有任务在跑（SSE 断线/刷新/多标签页场景的兜底）
async function syncRunning() {
  try {
    const r = await api('GET', '/api/running');
    const running = (r && r.running) || [];
    for (const sid of Object.keys(state.busySessions)) if (!running.includes(sid)) delete state.busySessions[sid];
    for (const sid of running) markBusy(sid);
  } catch {}
}

// SSE 断线重连后的补拉：running 对账 + 若错过若干消息则整表以服务端为准重建
async function syncAfterReconnect() {
  await syncRunning();
  if (!state.currentSession) return;
  try {
    const msgs = await api('GET', `/api/sessions/${state.currentSession.id}/messages`);
    if (Array.isArray(msgs) && msgs.length > state.currentSession.messages.length) {
      // 服务端比本地多（断线期间错过的事件）：整体替换重建；正在进行的流由后续 SSE 续接
      state.currentSession.messages = msgs;
      renderFeed();
    }
  } catch {}
}

// 停止当前任务：点击「停止」或 Esc×2 触发
async function stopCurrent() {
  if (!state.currentSession || !curBusy()) return;
  const sid = state.currentSession.id;
  try { await api('POST', '/api/interrupt', { sessionId: sid }); } catch {}
  // 乐观复位（即使中断广播因断线未收到也不卡死）；服务端随后会广播 turn/interrupted
  clearBusy(sid);
  settleSubagents(sid);   // 中断=回合结束：子代理不会再有事件，收口为已完成
  for (const rid of Object.keys(state.approvals)) {
    if (state.approvals[rid].sessionId === sid) resolveApprovalPending({ requestId: rid }, 'cancel');
  }
  renderFeed(); renderTopbar(); renderSubPanel();
}

// 会话重命名（侧栏内联编辑）：Enter 保存 / Esc 取消 / 失焦保存
function renameSession(sess, itemEl) {
  const nameEl = itemEl.querySelector('.name');
  const ops = itemEl.querySelector('.ops');
  const input = document.createElement('input');
  input.className = 'rn-input';
  input.value = sess.title || '';
  input.maxLength = 40;
  nameEl.replaceWith(input);
  if (ops) ops.style.display = 'none';
  input.focus(); input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (save && v && v !== sess.title) {
      await api('PATCH', '/api/sessions/' + sess.id, { title: v });
    }
    await refreshSessions();
    renderSidebar();
    renderTopbar(); // 顶栏标题跟随新名称
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

async function send() {
  const t = $('#input');
  const text = t.value.trim();
  // 斜杠指令优先（命中的指令不发给模型；未命中的当普通消息，"/tmp 是啥" 照常可用）
  if (text.startsWith('/') && (await runCommandLine(text))) return;
  const att = state.attachments.slice();
  const sks = state.selSkills.slice();
  if (!state.currentSession) return;
  if (!text && !att.length && !sks.length) return;
  // 未配置任何模型（会话无模型 且 启用列表为空）：引导去设置，避免把空模型发给引擎
  const cm0 = effectiveProviderModel();
  if (!cm0) {
    if (!modelOptions().length) {
      // 一个模型都没启用 → 引导去设置
      await uiDialog({
        title: tr('model.noModelTitle'),
        message: tr('model.noModelMsg'),
        buttons: [{ label: tr('model.goSettings'), value: true, primary: true }],
      });
      openSettings('model');
    } else {
      // 有可用模型，只是本会话没选 → 提示就地选择
      await uiDialog({
        title: tr('model.pickTitle'),
        message: tr('model.pickMsg'),
        buttons: [{ label: tr('common.ok'), value: true, primary: true }],
      });
    }
    return;
  }
  // 运行中：不再打断当前任务（旧版发送按钮在运行时=停止按钮，极易误停整轮工作），改为排队
  if (curBusy()) {
    state.queue.push({ sessionId: state.currentSession.id, text, att, sks });
    t.value = '';
    state.attachments = [];
    state.selSkills = [];
    renderAttPicks();
    renderSkillChips();
    renderQueueHint();
    return;
  }
  // 正常发送路径也必须清空输入框（排队路径已清）——曾出现"发送后文字还留在输入框"
  t.value = '';
  state.attachments = [];
  state.selSkills = [];
  renderAttPicks();
  renderSkillChips();
  await sendPayload({ sessionId: state.currentSession.id, text, att, sks });
}

// 真正把一条消息发给引擎（历史遗留的乐观上屏 + 错误回滚逻辑保持不变）
async function sendPayload(p) {
  const sid = p.sessionId;
  const text = p.text, att = p.att || [], sks = p.sks || [];
  if (!state.currentSession || state.currentSession.id !== sid) return;
  markBusy(sid);
  state.currentSession.messages.push({ t: 'user', v: text, ts: Date.now(), ...(att.length ? { att: att.map(a2m) } : {}) });
  state.attachments = [];
  state.selSkills = [];
  renderAttPicks();
  renderSkillChips();
  renderFeed(); renderTopbar();
  setAgentStatus('running');
  // 读取发送框旁的模型选择（pid|model），随本条消息带上 → 本会话即用该模型
  const pickedNow = pickedModelFromSelect() || effectiveProviderModel();
  const pid = pickedNow.pid;
  const mid = pickedNow.model;
  const body = { text };
  if (pid && mid) { body.providerId = pid; body.modelId = mid; }
  // 随消息携带当前会话模式对应的策略三元组（沙箱/审批/Plan），网关据此更新 session
  const mode = currentMode(); // 由会话当前三元组推断（send 前 UI 已随点击同步会话）
  Object.assign(body, modePolicy(mode));
  // 附件
  if (att.length) body.attachments = att.map((x) => ({ name: x.name, mime: x.mime, kind: x.kind, dataUrl: x.dataUrl }));
  // 技能（用户主动选用）
  if (sks.length) body.skills = sks;
  const r = await api('POST', `/api/sessions/${state.currentSession.id}/messages`, body);
  // 本地同步该会话所用模型（消息路由只回 {ok}），使「角色上次使用的模型」即时准确
  if ((!r || !r.error) && pid && mid && state.currentSession) {
    state.currentSession.providerId = pid;
    state.currentSession.modelId = mid;
    const inList = (state.sessions || []).find((x) => x.id === state.currentSession.id);
    if (inList) { inList.providerId = pid; inList.modelId = mid; inList.updatedAt = Date.now(); }
  }
  if (r && r.error) {
    // 服务端拒绝（409 有任务进行中 / 400 空消息等）：回滚乐观上屏的用户消息
    const msgs = state.currentSession.messages;
    const last = msgs[msgs.length - 1];
    if (last && last.t === 'user' && last.v === text) msgs.pop();
    clearBusy(sid);
    setAgentStatus('ready');
    renderFeed();
    uiDialog({ title: tr('dial.hint'), message: r.error, buttons: [{ label: tr('dial.gotit'), value: true, primary: true }] });
  }
}




/* ---------- 压缩蒙版：只作用于正在压缩的那个会话 ---------- */
const compactWatchdogs = new Map();   // sessionId -> timeout（按会话，多个压缩互不干扰）
/** 蒙版兜底：引擎若因异常不发 compact-end，超时后主动释放，避免该会话被永久禁止发送。 */
function armCompactWatchdog(sessionId) {
  const old = compactWatchdogs.get(sessionId);
  if (old) clearTimeout(old);
  compactWatchdogs.set(sessionId, setTimeout(() => {
    compactWatchdogs.delete(sessionId);
    if (!state.compactingSessions[sessionId]) return;
    setCompacting(sessionId, false);
    if (state.currentSession && state.currentSession.id === sessionId) {
      uiDialog({ title: tr('dial.hint'), message: tr('ctx.timeout'), buttons: [{ label: tr('dial.gotit'), value: true, primary: true }] });
    }
  }, Number(state.compactTimeoutMs) > 0 ? Number(state.compactTimeoutMs) : 180000));   // 默认 3 分钟（可注入，便于测试）
}
// 压缩很快时（实测小线程 ~1.9s）蒙版会一闪而过，看起来像"没有蒙版"；给一个最短展示时长兜底
const COMPACT_MIN_MS = 1500;
let compactTicker = null;
/** 每秒刷新蒙版上的"已用 N 秒"，让用户看到确实在推进（而不是静态卡片） */
function tickCompactMask() {
  if (compactTicker) return;
  compactTicker = setInterval(() => {
    const sid = state.currentSession && state.currentSession.id;
    if (!sid || !state.compactingSessions[sid]) { clearInterval(compactTicker); compactTicker = null; return; }
    renderCompactMask();
  }, 1000);
}
/** 手工压缩收尾：清掉任何残留的"处理中"（busy 标记 + 末尾指示行 + 停止键/状态灯） */
function resetAfterCompact(sessionId) {
  clearBusy(sessionId);              // 手工压缩不是回合：这里若还有 busy，只可能是历史残留
  if (!isCurrent(sessionId)) return;
  setAgentStatus('ready');
  renderTopbar();
  syncGenRow();
  stickToBottom();
}
function setCompacting(sessionId, on, opts) {
  if (!sessionId) return;
  if (on) {
    // manual=ROSE 主动触发的压缩（圆环//compact）：它不是回合，结束后必须把可能残留的
    // "正在处理"状态一并清掉；auto=引擎在回合内自行压缩，不能碰该回合的 busy。
    state.compactingSessions[sessionId] = { at: Date.now(), manual: !!(opts && opts.manual) };
    armCompactWatchdog(sessionId);
    tickCompactMask();
  } else {
    const cur = state.compactingSessions[sessionId];
    if (!cur) return;
    const wait = COMPACT_MIN_MS - (Date.now() - (cur.at || 0));
    if (wait > 0) {
      // 到点前不动；若期间又开始了新一轮压缩（对象标识变化）则放弃这次释放
      setTimeout(() => { if (state.compactingSessions[sessionId] === cur) setCompacting(sessionId, false); }, wait);
      return;
    }
    const wasManual = !!cur.manual;
    delete state.compactingSessions[sessionId];
    if (wasManual) resetAfterCompact(sessionId);
    const wd = compactWatchdogs.get(sessionId);
    if (wd) { clearTimeout(wd); compactWatchdogs.delete(sessionId); }
    // 秒表只在"确实没有会话在压缩"时停掉（并发压缩时另一个会话还要继续走秒）
    if (compactTicker && !Object.keys(state.compactingSessions).length) { clearInterval(compactTicker); compactTicker = null; }
  }
  renderCompactMask();
  renderCtxHint();
}
// 蒙版元素由 JS 创建（不再依赖 index.html 里有它）：旧版页面/缓存 HTML 下也能工作
function ensureCompactMask() {
  let m = $('#compactMask');
  if (m) return m;
  m = document.createElement('div');
  m.className = 'compact-mask';
  m.id = 'compactMask';
  m.hidden = true;
  m.innerHTML = '<div class="cm-card"><div class="cm-spin" aria-hidden="true"></div>'
    + '<div class="cm-title"></div><div class="cm-bar" aria-hidden="true"></div>'
    + '<div class="cm-elapsed"></div><div class="cm-sub"></div></div>';
  // ⚠️ 挂到 .main（对话列，position:relative 且不滚动），不要挂到滚动容器 #chatroom：
  // 否则 inset:0 会锚在内容原点，长对话滚到底部时蒙版滚出视口 → 用户"看不到蒙版但发不出消息"。
  (document.querySelector('.main') || document.body).appendChild(m);
  // 若样式表里没有 .compact-mask（页面比本次改动更旧），用内联样式兜底，保证它是个能看见的遮罩
  if (getComputedStyle(m).position !== 'absolute') {
    m.style.cssText = 'position:absolute;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;'
      + 'background:rgba(16,20,28,.35);backdrop-filter:blur(6px)';
  }
  return m;
}

function renderCompactMask() {
  const mask = ensureCompactMask();
  const sid = state.currentSession && state.currentSession.id;
  const on = !!(sid && state.compactingSessions[sid]);
  mask.hidden = !on;
  const tEl = mask.querySelector('.cm-title');
  const sEl = mask.querySelector('.cm-sub');
  const eEl = mask.querySelector('.cm-elapsed');
  if (tEl) tEl.textContent = tr('ctx.maskTitle');
  if (sEl) sEl.textContent = tr('ctx.maskSub');
  if (eEl) {
    const started = state.compactingSessions[sid];
    const secs = on && started && started.at ? Math.floor((Date.now() - started.at) / 1000) : 0;
    eEl.textContent = secs >= 1 ? tr('ctx.maskElapsed').replace('{n}', String(secs)) : '';
  }
  // 压缩期间禁止该会话发送（避免和压缩任务抢线程）；其他会话不受影响
  const btn = $('#sendBtn');
  if (btn) btn.disabled = on || !state.currentSession;
  // 占位符不动（蒙版 + 发送键禁用已经足够表达"等待中"）
}

/* ---------- 上下文占用（圆环，参考 DSH 的 ContextMeter） ---------- */
// 常显圆环：进度=已用/窗口；悬停出数值卡；点击=压缩上下文（行为与之前一致）。
const CTX_R = 5.5;                                  // 与 DSH 同参数：viewBox 14×14、r=5.5、描边 2
const CTX_C = 2 * Math.PI * CTX_R;
const fmtTok = (n) => (!n ? '0' : n >= 1000000 ? (n / 1000000).toFixed(Number.isInteger(n / 100000) ? 0 : 1).replace(/\.0$/, '') + 'M' : n >= 1000 ? Math.round(n / 1000) + 'k' : String(n));

function renderCtxHint() {
  const el = $('#ctxHint');
  if (!el) return;
  const s0 = state.currentSession;
  if (!s0) { el.style.display = 'none'; return; }
  el.style.display = 'inline-flex';
  const used = Number(s0.contextUsed) || 0;
  const win = Number(s0.contextWindow) || 0;
  const acp = Number((state.settings && state.settings.global && state.settings.global.autoCompactPercent)) || 80;
  // 只要有"已用"就显示数值（窗口未知时退化为"只报 token，不算百分比"，历史会话常见）
  const hasUsed = used > 0;
  const hasPct = hasUsed && win > 0;
  const pct = hasPct ? Math.min(100, Math.round((used / win) * 100)) : 0;
  el.classList.toggle('danger', hasPct && pct >= acp);
  el.classList.toggle('warn', hasPct && pct < acp && pct >= acp * 0.75);
  el.classList.toggle('unknown', hasUsed && !hasPct);
  el.classList.toggle('compacting', !!(s0 && state.compactingSessions[s0.id]));
  const dash = hasPct ? `${(CTX_C * pct / 100).toFixed(2)} ${CTX_C.toFixed(2)}` : `0 ${CTX_C.toFixed(2)}`;
  el.innerHTML = `
    <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
      <circle class="ring-track" cx="7" cy="7" r="${CTX_R}"/>
      <circle class="ring-fill" cx="7" cy="7" r="${CTX_R}" stroke-dasharray="${dash}" transform="rotate(-90 7 7)"/>
    </svg>
    <span class="ctx-pop" role="tooltip">
      ${hasUsed
        ? (hasPct
          ? `<b>${esc(tr('ctx.used').replace('{p}', String(pct)))}</b>
             <span>${fmtTok(used)} / ${fmtTok(win)} tokens</span>`
          : `<b>${esc(tr('ctx.usedTok').replace('{n}', fmtTok(used)))}</b>
             <span>${esc(tr('ctx.noWindow'))}</span>`)
        : `<b>${esc(tr('ctx.none'))}</b><span>${esc(tr('ctx.noneTip'))}</span>`}
    </span>`;
  el.setAttribute('aria-label', hasPct ? tr('ctx.used').replace('{p}', String(pct))
    : (hasUsed ? tr('ctx.usedTok').replace('{n}', fmtTok(used)) : tr('ctx.none')));
}

/**
 * 点击上下文圆环 = 执行 `/compact` 指令（与输入框里敲 /compact **完全同一条路径**）。
 * 不再额外弹确认框：压缩本身只是把历史压成摘要，蒙版已经明确表达"正在压缩"；
 * 用户要的是"点一下就开始"，少一步骤、少一处分叉。
 */
async function compactContext() {
  if (!state.currentSession) { noticeLine(tr('cmd.needSession')); return; }
  if (curBusy()) { uiDialog({ title: tr('dial.hint'), message: tr('ctx.busy'), buttons: [{ label: tr('dial.gotit'), value: true, primary: true }] }); return; }
  try {
    const text = await cmd.compact.run();
    if (text) flash(text, 'reMsg');
  } catch (e) {
    uiDialog({ title: tr('dial.hint'), message: tr('ctx.fail') + ((e && e.message) || e), buttons: [{ label: tr('dial.gotit'), value: true, primary: true }] });
  }
}

// 唯一压缩入口（圆环点击与 /compact 指令共用）：上蒙版 → 调官方 RPC → 由 compact-end 事件释放
async function doCompact() {
  if (!state.currentSession) return { error: 'no session' };
  const sid = state.currentSession.id;
  setCompacting(sid, true, { manual: true });
  const r = await api('POST', '/api/compact', { sessionId: sid });
  if (r && r.error) { setCompacting(sid, false); return { error: r.error }; }
  return { ok: true };
}

/* ---------- 运行中排队（替代"发送按钮=停止按钮"的旧行为） ---------- */
// 队列渲染在输入框上方：每条支持「插话发送 / 编辑 / 删除」。
function renderQueueHint() {
  const el = $('#queueHint');
  if (!el) return;
  const sid = state.currentSession && state.currentSession.id;
  const mine = state.queue.filter((q) => q.sessionId === sid);
  if (!mine.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = 'block';
  el.innerHTML = `<div class="q-head">⏳ ${esc(tr('queue.title'))}（${mine.length}）</div>` +
    mine.map((q, i) => `<div class="q-item" data-i="${i}">
      <span class="q-text" title="${esc(q.text)}">${esc(q.text || '（仅附件）')}</span>
      <span class="q-acts">
        <button class="q-btn q-steer" data-act="steer" title="${esc(tr('queue.steer'))}">⚡ ${esc(tr('queue.steer'))}</button>
        <button class="q-btn" data-act="edit" title="${esc(tr('queue.edit'))}">✎</button>
        <button class="q-btn q-del" data-act="del" title="${esc(tr('queue.del'))}">✕</button>
      </span></div>`).join('');
  el.querySelectorAll('.q-item').forEach((row) => {
    const idx = Number(row.dataset.i);
    const item = mine[idx];
    row.querySelectorAll('.q-btn').forEach((btn) => btn.addEventListener('click', async () => {
      const act = btn.dataset.act;
      if (act === 'del') {
        state.queue = state.queue.filter((q) => q !== item);
        renderQueueHint();
        return;
      }
      if (act === 'edit') {
        // 取回输入框编辑（从队列移除，避免编辑后重复排队）
        const inp = $('#input');
        if (inp) { inp.value = item.text || ''; inp.focus(); }
        state.attachments = (item.att || []).slice();
        state.selSkills = (item.sks || []).slice();
        renderAttPicks(); renderSkillChips();
        state.queue = state.queue.filter((q) => q !== item);
        renderQueueHint();
        return;
      }
      if (act === 'steer') {
        btn.disabled = true;
        const r = await api('POST', '/api/steer', { sessionId: item.sessionId, text: item.text || '' });
        if (r && r.error) {
          btn.disabled = false;
          uiDialog({ title: tr('dial.hint'), message: tr('queue.steerFail') + r.error, buttons: [{ label: tr('dial.gotit'), value: true, primary: true }] });
          return;
        }
        state.queue = state.queue.filter((q) => q !== item);
        renderQueueHint();
      }
    }));
  });
}

// 本轮结束 → 自动发出该会话排在最前的消息（仅当用户仍停留在该会话，避免跨会话串台）
function flushQueue(sessionId) {
  if (!state.queue.length) return;
  if (state.busySessions[sessionId]) return;
  if (!state.currentSession || state.currentSession.id !== sessionId) return;
  const i = state.queue.findIndex((q) => q.sessionId === sessionId);
  if (i < 0) return;
  const p = state.queue.splice(i, 1)[0];
  renderQueueHint();
  sendPayload(p).catch(() => {});
}

/* ---------- 附件上传 ---------- */
const fmtSize = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
const a2m = (x) => ({ name: x.name, kind: x.kind, mime: x.mime, src: x.kind === 'image' ? x.dataUrl : undefined });
const MAX_ATT = 8, MAX_FILE = 20 * 1024 * 1024; // 最多 8 个、单个 ≤20MB

async function pickAttachments(fileList) {
  if (!state.currentSession) return;
  const files = Array.from(fileList || []);
  for (const f of files) {
    if (state.attachments.length >= MAX_ATT) break;
    if (f.size > MAX_FILE) { uiDialog({ title: tr('dial.hint'), message: tr('att.tooBig') + f.name, buttons: [{ label: tr('dial.gotit'), value: true, primary: true }] }); continue; }
    const kind = f.type.startsWith('image/') ? 'image' : 'file';
    const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
    state.attachments.push({ id: Date.now() + Math.random().toString(36).slice(2, 6), name: f.name, size: f.size, mime: f.type || 'application/octet-stream', kind, dataUrl });
  }
  renderAttPicks();
}

function renderAttPicks() {
  const box = $('#attPicks');
  if (!box) return;
  box.innerHTML = '';
  for (const a of state.attachments) {
    const chip = document.createElement('div');
    chip.className = 'att-chip';
    const media = a.kind === 'image'
      ? `<img class="thumb" src="${esc(a.dataUrl)}" alt="">`
      : `<span class="f-ic"><span class="ic">${ICONS.file}</span></span>`;
    chip.innerHTML = `${media}<span class="a-meta"><span class="a-name">${esc(a.name)}</span><span class="a-size">${fmtSize(a.size)}</span></span><button class="a-x" data-id="${a.id}" title="${tr('att.remove')}">✕</button>`;
    box.appendChild(chip);
  }
  box.querySelectorAll('.a-x').forEach((b) => b.addEventListener('click', () => {
    state.attachments = state.attachments.filter((x) => x.id !== b.dataset.id);
    renderAttPicks();
  }));
}

/* ---------- 会话技能选用 ---------- */

// 该角色可用的激活技能（全局 + 本角色），供会话中主动选用
function availableSkills() {
  const rid = state.currentSession ? state.currentSession.roleId : null;
  if (!rid) return [];
  return state.allSkills.filter((s) => s.active && (s.scope === 'global' || (s.scope === 'role' && s.roleId === rid)));
}

async function loadSkills() {
  const r = await api('GET', '/api/skills');
  state.allSkills = (r && r.skills) || [];
  renderSkillChips();
}

function renderSkillChips() {
  const box = $('#skillPicks');
  const cnt = $('#skillCount');
  if (!box) return;
  box.innerHTML = '';
  const avail = availableSkills();
  const chosen = avail.filter((s) => state.selSkills.includes(s.id));
  for (const s of chosen) {
    const chip = document.createElement('span');
    chip.className = 'sk-chip';
    chip.innerHTML = `${esc(s.name)}<button class="sk-chip-x" data-id="${esc(s.id)}">✕</button>`;
    box.appendChild(chip);
  }
  box.querySelectorAll('.sk-chip-x').forEach((b) => b.addEventListener('click', () => {
    state.selSkills = state.selSkills.filter((id) => id !== b.dataset.id);
    renderSkillChips(); renderSkillPicker();
  }));
  if (cnt) cnt.textContent = String(chosen.length);
}

function renderSkillPicker() {
  const picker = $('#skillPicker');
  if (!picker) return;
  const avail = availableSkills();
  if (!avail.length) {
    const noSess = !state.currentSession;
    picker.innerHTML = `<div class="sp-empty">${noSess ? tr('skill.noSess') : tr('skill.noAvail') + '<br><span style="font-size:10.5px">' + tr('skill.noAvailSub') + '</span>'}</div>`;
    return;
  }
  picker.innerHTML = '<div class="sp-title">' + tr('skill.pickTitle') + '</div>' + avail.map((s) => {
    const checked = state.selSkills.includes(s.id);
    return `<label class="sp-item" title="${esc(s.description || '')}"><input type="checkbox" data-id="${esc(s.id)}" ${checked ? 'checked' : ''}><span><span class="sp-name"><span class="nm">${esc(s.name)}</span><span class="sp-scope">${s.scope === 'global' ? tr('skill.tagGlobal') : tr('skill.tagRole')}</span></span><span class="sp-desc">${esc(s.description || '')}</span></span></label>`;
  }).join('');
  picker.querySelectorAll('input[data-id]').forEach((cb) => cb.addEventListener('change', () => {
    const id = cb.dataset.id;
    if (cb.checked) { if (!state.selSkills.includes(id)) state.selSkills.push(id); }
    else state.selSkills = state.selSkills.filter((x) => x !== id);
    renderSkillChips();
  }));
}

function toggleSkillPicker() {
  const picker = $('#skillPicker');
  if (!picker) return;
  const willShow = !picker.classList.contains('show');
  closeSkillPicker();
  if (willShow) { renderSkillPicker(); picker.classList.add('show'); }
}
function closeSkillPicker() {
  const picker = $('#skillPicker');
  if (picker) picker.classList.remove('show');
}

/* ---------- 会话目标（引擎 goals RPC 为唯一事实源；界面只做展示与手动增改） ---------- */

/** token 数展示：18342 → 18,342（零依赖，纯界面用） */
function fmtTokens(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return '—';
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
// 引擎状态：pending | active | done；缺失/未知按 active（有目标就该看到进度）
function goalStatusOf(g) {
  const s = g && g.status;
  return (s === 'pending' || s === 'done') ? s : 'active';
}
function goalStatusLabel(g) {
  const s = goalStatusOf(g);
  return s === 'pending' ? tr('goal.statusPending') : (s === 'done' ? tr('goal.statusDone') : tr('goal.statusActive'));
}
/** token 用量文案：预算只取 goal.tokenBudget（目标自己的预算）。
    缺失时只报"已用"，绝不用其它字段顶替（单轮硬上限已随「引擎配置」页一并删除）。 */
function goalMetaText(g) {
  if (!g) return '';
  const used = Number.isFinite(Number(g.tokensUsed)) ? Number(g.tokensUsed) : null;
  const budget = Number.isFinite(Number(g.tokenBudget)) ? Number(g.tokenBudget) : 0;
  if (budget > 0) return tr('goal.tokens').replace('{u}', used === null ? '—' : fmtTokens(used)).replace('{l}', fmtTokens(budget));
  if (used === null) return '';
  return tr('goal.tokensNoBudget').replace('{u}', fmtTokens(used));
}

/** 目标栏渲染（唯一入口）：无目标且非编辑态时整体隐藏。
    编辑态是**就地**输入（不引入新弹窗基建），编辑期间 renderTopbar 不会重建它（见 renderGoalBar 守卫）。 */
function renderGoalBar() {
  const bar = $('#goalBar');
  if (!bar) return;
  // 编辑期间禁止重建：renderTopbar() 在回合结束等场景会被调用，重建会吞掉用户正在输入的正文
  if (state.goalEditing && bar.dataset.mode === 'edit') return;
  const s = state.currentSession;
  if (!s) { bar.hidden = true; bar.innerHTML = ''; bar.dataset.mode = 'hidden'; state.goalEditing = false; return; }
  const g = state.goals[s.id] || null;
  if (state.goalEditing) {
    bar.hidden = false;
    bar.dataset.mode = 'edit';
    bar.innerHTML = `
      <span class="goal-ic">◎</span>
      <input class="goal-input" id="goalInput" maxlength="2000" placeholder="${esc(tr('goal.editPh'))}" value="${esc((g && g.text) || '')}" spellcheck="false" autocomplete="off">
      <select class="goal-select" id="goalStatus" title="${esc(tr('goal.title'))}">
        ${[['pending', tr('goal.statusPending')], ['active', tr('goal.statusActive')], ['done', tr('goal.statusDone')]]
          .map(([v, l]) => `<option value="${v}"${goalStatusOf(g) === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}
      </select>
      <button class="goal-act goal-btn-pri" id="goalSave" type="button">${tr('goal.save')}</button>
      <button class="goal-act" id="goalCancel" type="button">${tr('goal.cancel')}</button>
      <span class="goal-msg" id="goalMsg"></span>`;
    const inp = bar.querySelector('#goalInput');
    if (inp) { inp.focus(); inp.select(); }
    bar.querySelector('#goalCancel').addEventListener('click', () => { state.goalEditing = false; renderGoalBar(); });
    bar.querySelector('#goalSave').addEventListener('click', async () => {
      const text = String(bar.querySelector('#goalInput').value || '').trim();
      const status = bar.querySelector('#goalStatus').value;
      if (!text) { const m = bar.querySelector('#goalMsg'); if (m) m.textContent = tr('goal.editPh'); return; }
      const btn = bar.querySelector('#goalSave');
      btn.disabled = true;
      const okSaved = await saveGoal({ text, status });
      if (!okSaved && btn.isConnected) btn.disabled = false;
    });
    if (inp) inp.addEventListener('keydown', (e) => {
      // Enter 保存 / Esc 取消（与项目其它内联编辑一致；中文输入法组字中的 Enter 不触发）
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); bar.querySelector('#goalSave').click(); }
      else if (e.key === 'Escape') { e.preventDefault(); state.goalEditing = false; renderGoalBar(); }
    });
    return;
  }
  if (!g || !g.text) { bar.hidden = true; bar.innerHTML = ''; bar.dataset.mode = 'hidden'; return; }
  const meta = goalMetaText(g);
  const isLocal = state.goalSupported[s.id] === false;
  bar.hidden = false;
  bar.dataset.mode = 'view';
  bar.innerHTML = `
    <span class="goal-ic">◎</span>
    <span class="goal-text" id="goalText" title="${esc(g.text)}">${esc(g.text)}</span>
    <span class="goal-meta" id="goalMeta">${isLocal ? `<span class="goal-pill local" title="${esc(state.goalReason[s.id] || tr('goal.unavailable'))}">${esc(tr('goal.localTag'))}</span>` : ''}<span class="goal-pill ${goalStatusOf(g)}">${esc(goalStatusLabel(g))}</span>${meta ? esc(meta) : ''}</span>
    <button class="goal-act" id="goalEdit" type="button">${tr('goal.edit')}</button>
    <button class="goal-x" id="goalClear" type="button" title="${esc(tr('goal.clear'))}">✕</button>
    <span class="goal-msg" id="goalMsg"></span>`;
  bar.querySelector('#goalEdit').addEventListener('click', openGoalEditor);
  bar.querySelector('#goalClear').addEventListener('click', async () => {
    const v = await uiDialog({
      title: tr('goal.title'), message: tr('goal.clearConfirm'),
      buttons: [{ label: tr('common.cancel'), value: null }, { label: tr('goal.clear'), value: 'clear', danger: true, primary: true }],
    });
    if (v === 'clear') await saveGoal({ clear: true });
  });
}

/** 打开目标编辑器（输入框旁的 ◎ 按钮与栏内「编辑」共用） */
function openGoalEditor() {
  if (!state.currentSession) {
    uiDialog({ title: tr('goal.title'), message: tr('goal.needSession'), buttons: [{ label: tr('common.ok'), value: 1, primary: true }] });
    return;
  }
  if (state.goalSupported[state.currentSession.id] === false) {
    uiDialog({ title: tr('goal.title'), message: tr('goal.unavailable'), buttons: [{ label: tr('common.ok'), value: 1, primary: true }] });
    return;
  }
  state.goalEditing = true;
  renderGoalBar();
}

/** 进会话时拉一次目标（服务端权威）。路由未就绪 → 标记 supported=false，界面显式提示而不是静默空栏 */
async function loadGoal(sid) {
  if (!sid) return;
  let r = null;
  try { r = await api('GET', '/api/sessions/' + sid + '/goal'); } catch { r = null; }
  const routeOk = !!(r && !r.error);
  state.goalSupported[sid] = routeOk && r.supported !== false;
  state.goalReason[sid] = String((r && r.reason) || '');
  if (routeOk) state.goals[sid] = r.goal || null;
  if (isCurrent(sid)) renderGoalBar();
}

/** 手动增改/清除：PUT 一次，用响应体回读收敛（契约不要求二次 GET）。
    payload = { text, status } 或 { clear: true } */
async function saveGoal(payload) {
  const s = state.currentSession;
  if (!s) return false;
  const sid = s.id;
  let r = null;
  try { r = await api('PUT', '/api/sessions/' + sid + '/goal', payload); }
  catch (e) { r = { error: (e && e.message) || String(e) }; }
  if (!r || r.error) {
    uiDialog({
      title: tr('goal.title'),
      message: tr('goal.saveFail') + ((r && r.error) || tr('goal.unavailable')),
      buttons: [{ label: tr('common.ok'), value: 1, primary: true }],
    });
    return false;
  }
  // 服务端权威：优先用响应里的 goal；响应只有裸 goal 对象时也认；再退到刚才的乐观值
  let g;
  if (r.goal !== undefined) g = r.goal;
  else if (typeof r.text === 'string') g = r;
  else if (payload && payload.clear) g = null;
  else g = { ...(state.goals[sid] || {}), ...(payload || {}) };
  state.goals[sid] = g || null;
  // 引擎不可用时服务端回 {ok, supported:false, goal, reason}：目标仍被保存为**本地快照**，
  // 界面照实标"本地目标（引擎不可用）"，不假装引擎已接受。
  state.goalSupported[sid] = r.supported !== false;
  state.goalReason[sid] = String(r.reason || '');
  state.goalEditing = false;
  if (isCurrent(sid)) {
    renderGoalBar();
    const m = $('#goalMsg');
    if (m) { m.textContent = tr('goal.saved'); setTimeout(() => { if (m.isConnected) m.textContent = ''; }, 3000); }
  }
  return true;
}

/* ---------- 子代理面板（只读状态；唯一动作 = 停止本回合，含其子代理） ----------
   事实（探针确认）：app-server 没有子代理控制 RPC —— 因此**不做** per-agent 终止/恢复，
   界面上也不给"单独杀某个子代理"的暗示。停止走既有 interrupt 通道（stopCurrent）。 */
const SUB_STATES = ['running', 'waiting', 'spawned', 'done', 'closed'];
const SUB_ACTIVE = new Set(['running', 'waiting', 'spawned']);

function subListOf(sid) {
  const m = (sid && state.subagents[sid]) || {};
  return Object.values(m).sort((a, b) => {
    const d = SUB_STATES.indexOf(a.state) - SUB_STATES.indexOf(b.state);
    return d !== 0 ? d : ((b.ts || 0) - (a.ts || 0));
  });
}
function subStateLabel(st) {
  return { spawned: tr('sub.stateSpawned'), running: tr('sub.stateRunning'), waiting: tr('sub.stateWaiting'),
    done: tr('sub.stateDone'), closed: tr('sub.stateClosed') }[st] || tr('sub.stateRunning');
}
/** SSE kind=subagent 的落库点：按 agentId upsert（同一子代理的多次事件只更新一行） */
function upsertSubagent(d) {
  if (!d || !d.sessionId || !d.id) return;
  const m = (state.subagents[d.sessionId] = state.subagents[d.sessionId] || {});
  const prev = m[d.id] || {};
  const st = SUB_STATES.includes(d.state) ? d.state : (prev.state || 'running');
  m[d.id] = {
    id: String(d.id),
    title: d.title !== undefined && d.title !== null && d.title !== '' ? String(d.title) : (prev.title || String(d.id)),
    state: st,
    lastText: d.lastText !== undefined ? String(d.lastText) : (prev.lastText || ''),
    ts: Date.now(),
  };
  if (SUB_ACTIVE.has(st)) state.subOpen = true;   // 出现活动子代理 → 自动展开
  if (isCurrent(d.sessionId)) renderSubPanel();
}
/** 回合已结束（turn/中断）时收尾：还在 running/waiting 的行不可能再收到事件，
    按"已完成"收口（引擎随后若补发 done/closed 会覆盖这里）。 */
function settleSubagents(sid) {
  const m = sid && state.subagents[sid];
  if (!m) return;
  let changed = false;
  for (const a of Object.values(m)) if (SUB_ACTIVE.has(a.state)) { a.state = 'done'; a.ts = Date.now(); changed = true; }
  if (changed && isCurrent(sid)) renderSubPanel();
}
function renderSubPanel() {
  const panel = $('#subPanel');
  if (!panel) return;
  const s = state.currentSession;
  const arr = s ? subListOf(s.id) : [];
  // 引擎未接线：只在"回合进行中"给一行说明（此时用户才会期待子代理出现）；
  // 空闲时不占用界面，且**从不**宣称"暂无子代理"。
  const unsupported = !!(s && state.subSupported[s.id] === false && curBusy());
  if (!arr.length && !unsupported) { panel.hidden = true; panel.classList.remove('open'); return; }
  const running = arr.filter((a) => SUB_ACTIVE.has(a.state)).length;
  const waiting = arr.filter((a) => a.state === 'waiting').length;
  const done = arr.filter((a) => a.state === 'done' || a.state === 'closed').length;
  panel.hidden = false;
  panel.classList.toggle('open', !!state.subOpen || (unsupported && !arr.length));
  const sum = $('#subSummary');
  if (sum) {
    sum.textContent = unsupported && !arr.length
      ? tr('sub.unsupported').replace('{r}', state.subReason[s.id] || tr('common.unavailable'))
      : tr('sub.summary').replace('{a}', String(arr.length))
        .replace('{r}', String(running)).replace('{w}', String(waiting)).replace('{d}', String(done));
    sum.title = tr('sub.title');
  }
  const stop = $('#subStop');
  // 与 #stopBtn 同一真相：只有"本回合在跑"且"仍有活动子代理"时才提供停止，
  // 绝不允许出现「回合已结束但子代理面板还亮着停止」这种与 #stopBtn 不一致的状态。
  if (stop) stop.hidden = !(running > 0 && curBusy());
  const clear = $('#subClear');
  if (clear) clear.hidden = done === 0;
  const list = $('#subList');
  if (!list) return;
  if (!arr.length) {
    list.innerHTML = `<div class="sub-row"><span class="sr-last">${esc(tr('sub.unsupported').replace('{r}', state.subReason[s.id] || tr('common.unavailable')))}</span></div>`;
    return;
  }
  list.innerHTML = arr.map((a) => `<div class="sub-row ${esc(a.state)}" data-agent-id="${esc(a.id)}">
      <span class="sr-name" title="${esc(a.title || a.id)}">${esc(a.title || a.id)}</span>
      <span class="sr-state ${esc(a.state)}">${esc(subStateLabel(a.state))}</span>
      <span class="sr-last">${esc(a.lastText || tr('sub.lastNone'))}</span>
    </div>`).join('');
}
/** 进会话时与服务端对账：{ok, supported, subagents[], reason}。
    supported:false（引擎未接线）→ 记住原因：回合进行中会在面板里明写"引擎未接线"，
    而不是给人一个空洞的面板（空面板本身也从不宣称"暂无子代理"）。 */
async function loadSubagents(sid) {
  if (!sid) return;
  let r = null;
  try { r = await api('GET', '/api/sessions/' + sid + '/subagents'); } catch { r = null; }
  if (!r || r.error) return;   // 路由未就绪：只靠 SSE，不刷错误
  state.subSupported[sid] = r.supported !== false;
  state.subReason[sid] = String(r.reason || '');
  const list = Array.isArray(r.subagents) ? r.subagents : (Array.isArray(r.agents) ? r.agents : (Array.isArray(r) ? r : []));
  const m = {};
  for (const a of list) {
    if (!a || !a.id) continue;
    const st = SUB_STATES.includes(a.state) ? a.state : 'running';
    m[String(a.id)] = { id: String(a.id), title: a.title ? String(a.title) : String(a.id), state: st,
      lastText: a.lastText !== undefined ? String(a.lastText) : '', ts: Date.now() };
  }
  state.subagents[sid] = m;
  if (isCurrent(sid)) renderSubPanel();
}
function clearFinishedSubagents() {
  const s = state.currentSession;
  if (!s || !state.subagents[s.id]) return;
  const m = state.subagents[s.id];
  for (const [id, a] of Object.entries(m)) if (a.state === 'done' || a.state === 'closed') delete m[id];
  renderSubPanel();
}

/* ---------- SSE ---------- */

function connectSSE() {
  const es = new EventSource('/events');
  es.addEventListener('message', (e) => {
    const d = JSON.parse(e.data);
    // ① 与"当前在看哪个会话"无关的状态事件：必须先处理，且同时更新会话列表里的值。
    //    这些事件来自后台会话也很常见（并行/切走时压缩完成），早退会把状态丢掉 → 切回该会话仍显示蒙版。
    if (d.kind === 'compact-start') {
      setCompacting(d.sessionId, true);
      if (!d.auto && state.currentSession && d.sessionId === state.currentSession.id) flash(tr('ctx.compacting'), 'reMsg');
      return;
    }
    if (d.kind === 'compact-end') {
      setCompacting(d.sessionId, false);   // 手工压缩会在内部调用 resetAfterCompact（清 busy + 指示行）
      if (state.currentSession && d.sessionId === state.currentSession.id) flash(tr('ctx.done'), 'reMsg');
      return;
    }
    if (d.kind === 'context-usage') {
      const inList = (state.sessions || []).find((x) => x.id === d.sessionId);
      if (inList) { inList.contextUsed = d.used; if (d.window) inList.contextWindow = d.window; }
      if (state.currentSession && d.sessionId === state.currentSession.id) {
        state.currentSession.contextUsed = d.used;
        if (d.window) state.currentSession.contextWindow = d.window;
        renderCtxHint();
      }
      return;
    }
    if (d.kind === 'goal') {
      // 目标是服务端/引擎权威：无论是否正在看该会话都先缓存（切回来即最新）；不重渲染消息流
      state.goals[d.sessionId] = d.goal === undefined ? null : d.goal;
      state.goalSupported[d.sessionId] = true;
      if (isCurrent(d.sessionId)) renderGoalBar();
      return;
    }
    if (d.kind === 'window-reset') {
      // 引擎自发压缩 → 换上下文窗口（检查点）。契约：{sessionId, count, reason:'engine-compaction'}，
      // **没有窗口 id**（引擎只发"发生了续接"这一事实）。这里只追加一条提示行，
      // 绝不引用 compactingSessions / ctxHint —— 换窗口不是压缩蒙版那条链路。
      const rec = {
        t: 'win-reset',
        v: {
          count: Number.isFinite(Number(d.count)) && Number(d.count) > 0 ? Math.round(Number(d.count)) : 1,
          reason: d.reason ? String(d.reason) : 'engine-compaction',
        },
        ts: Date.now(),
      };
      if (isCurrent(d.sessionId)) {
        state.currentSession.messages.push(rec);
        appendFeedEvent(d);   // 行内已含说明文案，不再额外插 sys-row（避免重复提示）
      } else if (d.sessionId) {
        // 后台会话先记着：切到该会话时补进消息流（提示不丢）
        if (!state.winResetPending[d.sessionId]) state.winResetPending[d.sessionId] = [];
        state.winResetPending[d.sessionId].push(rec);
      }
      return;
    }
    if (d.kind === 'subagent') {
      // 子代理状态：后台会话也要收（切回时会话列表/面板已是新的）；只更新面板，不碰消息流
      upsertSubagent(d);
      return;
    }
    // ② 其余事件只影响"正在看的那个会话"
    if (!state.currentSession || d.sessionId !== state.currentSession.id) return;
    const msgs = state.currentSession.messages;
    if (d.kind === 'user') {
      const last = msgs[msgs.length - 1];
      if (!(last && last.t === 'user' && last.v === d.text)) { msgs.push({ t: 'user', v: d.text }); appendFeedEvent(d); }
    }
    else if (d.kind === 'a-delta') { msgs.push({ t: 'a-delta', v: d.delta }); appendFeedEvent(d); }
    else if (d.kind === 'plan') { msgs.push({ t: 'plan', v: { plan: d.plan, explanation: d.explanation }, ts: Date.now() }); appendFeedEvent(d); }
    else if (d.kind === 'tool-start') { msgs.push({ t: 'tool', v: { name: d.name, args: d.args, toolId: d.toolId } }); appendFeedEvent(d); }
    else if (d.kind === 'tool-output-delta') { appendToolOutputDelta(d); }
    else if (d.kind === 'r-delta') { appendReasoningDelta(d); }
    else if (d.kind === 'tool-end') { msgs.push({ t: 'tool-end', v: d }); appendFeedEvent(d); }
  });
  es.addEventListener('engine-event', (e) => {
    const d = JSON.parse(e.data);
    if (d.type === 'config-warning') {
      // 引擎配置非法 → codex 会**静默回落默认值**（厂商/模型/人格/MCP 全部不生效，表现为"对话跑不通"）。
      // 这条必须让用户看见：同一份告警只弹一次。
      const sig = String(d.summary || '') + '|' + String(d.details || '');
      if (sig !== engineWarnSeen) {
        engineWarnSeen = sig;
        uiDialog({
          title: tr('cfg.badTitle'),
          message: tr('cfg.badMsg') + '\n\n' + String(d.details || d.summary || '') + (d.path ? '\n' + d.path : ''),
          buttons: [{ label: tr('dial.gotit'), value: 1, primary: true }],
        });
      }
    } else if (d.type === 'sandbox-setup-completed') {
      // 初始化结束（成功/失败都告知，不静默）：刷新状态与横幅。
      // 若本次点击的初始化流程正在等待（sandboxSetupWaiting），由它统一报告结果，避免重复弹窗。
      state.sandboxDismissed = null;
      refreshSandbox(true);
      if (!d.success && !sandboxSetupWaiting) {
        uiDialog({
          title: tr('env.sandbox'),
          message: (d.error || tr('env.statusUnknown')), buttons: [{ label: tr('common.ok'), value: 1 }],
        });
      }
    } else if (d.type === 'sandbox-readiness') {
      state.sandbox = { ...(state.sandbox || {}), supported: true, readiness: d };
      renderSandboxBanner();
    } else if (d.type === 'approval-undeliverable') {
      // 审批没能送达引擎（进程换了/线程不见/写 stdin 失败）：卡片必须显示"未送达"，不能停在等待态
      const rid = ridOf(d.requestId);
      const rec = rid ? state.approvals[rid] : null;
      if (rec) {
        delete state.approvals[rid];
        const card = document.querySelector(`#feed > .tool-card[data-approval-id="${rid}"]`);
        if (card) {
          delete card.dataset.approvalId;
          setCardChip(card, 'err', tr('appr.undeliverableChip'));
          setCardNote(card, tr('appr.undeliverable').replace('{r}', String(d.reason || '')), true);
        }
        syncAgentStatus();
      }
    } else if (d.type === 'world-writable-warning') {
      state.sandbox = state.sandbox || { supported: true };
      state.sandbox.worldWritable = [d.detail];
      const el = $('#sandboxBannerText');
      if (el) el.textContent = tr('sb.worldWritable');
      const banner = $('#sandboxBanner');
      const btn = $('#sandboxBannerSetup');
      if (btn) btn.hidden = true;
      if (banner) banner.hidden = false;
    }
  });
  es.addEventListener('approval', (e) => {
    const d = JSON.parse(e.data);
    markApprovalPending(d);   // 卡片/会话头先进入「等待人工审批」，与"运行中"区分开
    showApprovalModal(d);     // 后台会话的审批也要弹（否则那条线程永远等不到应答）
  });
  es.addEventListener('ask', (e) => {
    const d = JSON.parse(e.data);
    // 只把占位追加到"正在看的那个会话"的消息流；后台会话的提问照样弹窗处理
    if (state.currentSession && d.sessionId === state.currentSession.id) {
      const msgs = state.currentSession.messages;
      if (!msgs.some((m) => m.t === 'ask' && ridOf(m.v.requestId) === ridOf(d.requestId))) {
        msgs.push({ t: 'ask', v: { requestId: ridOf(d.requestId), questions: d.questions }, ts: Date.now() });
        appendFeedEvent({ kind: 'ask' });
      }
    }
    showAskModal(d);
  });
  es.addEventListener('plan-mode-on', (e) => {
    const d = JSON.parse(e.data);
    if (!state.currentSession || d.sessionId !== state.currentSession.id) return;
    // 模型自动进入计划模式：同步会话三元组与 UI（回合状态随后续轮事件管理）
    state.currentSession.planMode = true;
    state.currentSession.sandbox = 'read-only';
    state.currentSession.approval = 'on-request';
    renderTopbar();
  });
  es.addEventListener('plan-mode-off', (e) => {
    const d = JSON.parse(e.data);
    if (!state.currentSession || d.sessionId !== state.currentSession.id) return;
    // 计划已交付 → 后端自动切回普通模式（还原进 Plan 前的沙箱/审批），这里同步界面
    state.currentSession.planMode = false;
    if (d.sandbox) state.currentSession.sandbox = d.sandbox;
    if (d.approval) state.currentSession.approval = d.approval;
    const inList = (state.sessions || []).find((x) => x.id === d.sessionId);
    if (inList) { inList.planMode = false; inList.sandbox = state.currentSession.sandbox; }
    syncModeUI();
    renderTopbar();
  });
  es.addEventListener('ask-resolved', (e) => {
    const d = JSON.parse(e.data);
    if (!state.currentSession || d.sessionId !== state.currentSession.id) return;
    const msgs = state.currentSession.messages;
    const ask = msgs.find((m) => m.t === 'ask' && ridOf(m.v.requestId) === ridOf(d.requestId));
    if (ask) ask.v.answer = d.answers;
    // 追加应答记录（供刷新后重建已解决状态）
    if (ask && !msgs.some((m) => m.t === 'ask-answer' && ridOf(m.v.requestId) === ridOf(d.requestId))) {
      msgs.push({ t: 'ask-answer', v: { requestId: ridOf(d.requestId), answers: d.answers }, ts: Date.now() });
    }
    // 关闭对应弹窗（如有）
    if (ridOf(askModalState.requestId) === ridOf(d.requestId)) hideAskModal();
    else enforceModals(d.requestId);
  });
  es.addEventListener('approval-resolved', (e) => {
    const d = JSON.parse(e.data);
    enforceModals(d.requestId);
    if (!activeModal) { $('#apprMask').classList.remove('show'); $('#askModalMask').classList.remove('show'); }
    // 服务端裁决为准（可能是别的窗口/别的路径应答的）：有裁决值就据此落定卡片状态
    const rid = ridOf(d.requestId);
    if (d.decision === 'accept' || d.decision === 'decline' || d.decision === 'cancel') {
      resolveApprovalPending({ requestId: rid }, d.decision === 'accept' ? 'accept' : (d.decision === 'decline' ? 'decline' : 'cancel'));
    } else if (state.approvals[rid]) {
      // 没有裁决值（例如回合结束/进程回收清理）：至少解除"等待审批"，不让卡片永远停在等待态
      resolveApprovalPending({ requestId: rid }, 'cancel');
    }
  });
  es.addEventListener('turn', (e) => {
    const d = JSON.parse(e.data);
    // busy 状态按会话记录：无论当前是否正在看该会话都先解除任务标记
    clearBusy(d.sessionId);
    settleSubagents(d.sessionId);   // 回合结束：仍在"运行中"的子代理行按已完成收口（不再有事件会来）
    // 回合结束：该会话不可能再有审批结果了 → 把还挂在"等待人工审批"的卡片收口，不留假等待
    for (const rid of Object.keys(state.approvals)) {
      if (state.approvals[rid].sessionId === d.sessionId) resolveApprovalPending({ requestId: rid }, 'cancel');
    }
    flushQueue(d.sessionId);   // 有排队消息则接着发（本轮结束不再空转）
    closeStaleModals(d.sessionId);   // 回合已结束：该会话没来得及应答的审批弹窗必须撤掉
    if (!state.currentSession || d.sessionId !== state.currentSession.id) return;
    if (d.status === 'error') setAgentStatus('error');
    else setAgentStatus('ready');
    refreshSessions().then(() => { renderSidebar(); renderTopbar(); });
    // ⚠️ 这里原来直接 renderFeed()：清空重建整个列表 → 强制滚到底 + 展开的卡片全折叠
    // （用户正在读长输出时被"拽走"）。改成增量收尾：立即成型 + 仅在贴底时跟随。
    flushAgentRender();
    renderTopbar();
    stickToBottom();
  });
  // 连接/重连对账：EventSource 会自动重连；错过的事件靠 /api/running + 消息补拉恢复，
  // 避免断线后界面永久停留在「处理中」或漏掉已完成内容
  let sseDown = false;
  es.onopen = () => {
    if (sseDown) { sseDown = false; syncAfterReconnect(); }
    else syncRunning(); // 首次连接/页面加载即对账一次（含其它标签页正在跑的任务）
  };
  es.onerror = () => { sseDown = true; }; // 交由 EventSource 自动重连，重连后走 onopen 补拉
}

/* ---------- 设置弹窗（左侧导航） ---------- */

let smNav = 'model';
const NAV_TITLES = { model: 'nav.model', prompt: 'nav.prompt', memory: 'nav.memory', roles: 'nav.roles', skills: 'nav.skills', mcp: 'nav.mcp', usage: 'nav.usage', general: 'nav.general', env: 'nav.env' };
let settingsCache = null; // GET /api/settings 缓存

function openSettings(nav) {
  smNav = nav || 'model';
  $('#settingsMask').classList.add('show');
  renderNav();
  renderPanel();
}
// 模型配置面板：是否有未保存的改动，以及它的保存函数（由面板渲染时注入）
let modelPanelDirty = false;
let modelPanelSave = null;

/**
 * 关闭设置弹窗。模型配置面板有未保存改动时先问一句——
 * 面板里混着 provider 字段、勾选、手动添加等多种改动，误关一次就全丢。
 * @param {boolean} force 跳过询问（保存流程内部调用）
 */
async function closeSettings(force) {
  if (!force && smNav === 'model' && modelPanelDirty && typeof modelPanelSave === 'function') {
    const v = await uiDialog({
      title: tr('unsaved.title'),
      message: tr('unsaved.msg'),
      buttons: [
        { label: tr('common.cancel'), value: null },
        { label: tr('unsaved.discard'), value: 'discard', danger: true },
        { label: tr('unsaved.save'), value: 'save', primary: true },
      ],
    });
    if (v === null) return;                 // 取消：留在设置界面
    if (v === 'save') {
      const okSaved = await modelPanelSave();
      if (!okSaved) return;                 // 保存失败/被拒：不关闭，让用户看到原因
    }
    modelPanelDirty = false;
  }
  $('#settingsMask').classList.remove('show');
}

function renderNav() {
  document.querySelectorAll('#smNav .sm-nav-item').forEach((it) => {
    it.classList.toggle('active', it.dataset.nav === smNav);
  });
  $('#smTitle').textContent = tr(NAV_TITLES[smNav] || 'settings');
}

function renderPanel() {
  const body = $('#smBody');
  body.innerHTML = '';
  if (smNav === 'model') renderModelPanel(body);
  else if (smNav === 'prompt') renderPromptPanel(body);
  else if (smNav === 'memory') renderMemoryPanel(body);
  else if (smNav === 'roles') renderRolesPanel(body);
  else if (smNav === 'skills') renderSkillsPanel(body);
  else if (smNav === 'mcp') renderMcpPanel(body);
  else if (smNav === 'usage') renderUsagePanel(body);
  else if (smNav === 'general') renderGeneralPanel(body);
  else if (smNav === 'env') renderEnvPanel(body);
}

/* ---------- 通用：主题外观（浅色 / 深色 / 跟随系统） ---------- */

// 主题偏好来源 = settings.global.theme（light | dark | system）；缺省按浅色
const themeMq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
function themeValue() {
  const g = (state.settings && state.settings.global) || {};
  const t = g.theme;
  return (t === 'dark' || t === 'system') ? t : 'light';
}
// 依据主题偏好把 <html data-theme> 设为 dark/light；跟随系统时读 matchMedia
function applyTheme() {
  const t = themeValue();
  const dark = t === 'dark' || (t === 'system' && !!themeMq && themeMq.matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}
function initTheme() {
  applyTheme();
  if (themeMq) themeMq.addEventListener('change', applyTheme); // 跟随系统时随系统实时切换（其它偏好下 applyTheme 幂等）
}
async function setTheme(t) {
  state.settings = state.settings || { global: {} };
  state.settings.global = state.settings.global || {};
  state.settings.global.theme = t;
  applyTheme(); // 立即生效
  try { await api('PUT', '/api/settings', { global: { theme: t } }); } catch {}
}

function renderGeneralPanel(body) {
  // 需要 settings（含引擎实测的模型窗口）→ 没拿到时先拉一次再渲染
  if (!state.settings || !state.settings.contextWindows) {
    api('GET', '/api/settings').then((s) => {
      state.settings = { ...(state.settings || {}), ...s };
      renderGeneralPanel(body);
    }).catch(() => {});
    return;
  }
  const curT = themeValue();
  const themeOpts = [
    { v:'light', label: tr('gen.light'), desc: tr('gen.lightDesc') },
    { v:'dark', label: tr('gen.dark'), desc: tr('gen.darkDesc') },
    { v:'system', label: tr('gen.system'), desc: tr('gen.systemDesc') },
  ];
  const langOpts = [
    { v:'zh', label: '中文' },
    { v:'en', label: 'English' },
  ];
  // 卡片只留标题；说明文字进 title（通用页尽量少放正文）
  const card = (o, name, checked, extraAttrs) => `
    <label data-opt="${o.v}" title="${esc(o.desc || '')}" style="display:flex;align-items:center;gap:11px;padding:9px 12px;border:1px solid ${checked ? 'var(--accent)' : 'var(--border)'};border-radius:11px;cursor:pointer;background:${checked ? 'var(--accent-soft)' : 'var(--panel)'};${extraAttrs || ''}">
      <input type="radio" name="${name}" value="${o.v}" ${checked ? 'checked' : ''} style="accent-color:var(--accent);cursor:pointer">
      <span style="flex:1;font-size:13px;color:var(--text);font-weight:600">${o.label}</span>
    </label>`;
  // 自动压缩阈值（%）：窗口解析（用户声明 > 引擎实测 > 家族默认）由服务端算好，见 /api/settings.contextWindows
  const g = (state.settings && state.settings.global) || {};
  const gw = g.web || {};
  const acp = Number.isFinite(Number(g.autoCompactPercent)) ? Number(g.autoCompactPercent) : 80;
  const l0 = Number.isFinite(Number(g.toolOutputTokenLimit)) ? Number(g.toolOutputTokenLimit) : 8000;
  // 关窗行为：hide（默认，关窗后任务继续）/ quit（关窗即走退出流程）。两种都先做退出前任务确认。
  const closeVal = g.closeBehavior === 'quit' ? 'quit' : 'hide';
  const closeOpts = [
    { v:'hide', label: tr('gen.closeHide'), desc: tr('gen.closeHideDesc') },
    { v:'quit', label: tr('gen.closeQuit'), desc: tr('gen.closeQuitDesc') },
  ];
  // task-12：内置搜索 MCP 是否就位（nativeSupport.searchMcp）→ 就位/降级都照实说，不假装可用
  const sm = (state.settings && state.settings.nativeSupport && state.settings.nativeSupport.searchMcp) || null;
  const smOk = !!(sm && sm.supported === true);
  const smNote = !sm ? ''
    : (smOk ? '✓ ' + tr('web.mcpOk') : '⚠ ' + tr('web.mcpDown').replace('{r}', sm.reason || tr('common.unavailable')));
  const cw = (state.settings && state.settings.contextWindows) || {};
  body.innerHTML = `
    <div id="cfgWarn" class="cfg-warn" hidden></div>
    <div class="sp-section">
      <h4>${tr('gen.appearance')}</h4>
      <div style="display:flex;gap:9px;margin-top:8px">
        ${themeOpts.map((o) => card(o, 'theme', curT === o.v, 'flex:1;min-width:0')).join('')}
      </div>
    </div>
    <div class="sp-section">
      <h4>${tr('gen.lang')}</h4>
      <div style="display:flex;gap:10px;max-width:470px;margin-top:8px">
        ${langOpts.map((o) => card(o, 'lang', lang === o.v)).join('')}
      </div>
    </div>
    <div class="sp-section">
      <h4>${tr('gen.ctxTitle')}</h4>
      <div style="display:flex;align-items:center;gap:8px;max-width:640px;flex-wrap:wrap;margin-top:8px">
        <label for="acpInput" class="gen-lbl">${tr('gen.ctxPctShort')}</label>
        <input type="number" id="acpInput" min="10" max="99" step="1" value="${acp}" aria-label="${esc(tr('gen.ctxPct'))}" style="width:70px;padding:5px 8px;border:1px solid var(--border);border-radius:8px;background:var(--panel);color:var(--text);font-family:inherit">
        <span class="gen-lbl">%</span>
        <label for="l0Input" class="gen-lbl">${tr('gen.l0Short')}</label>
        <input type="number" id="l0Input" min="500" max="200000" step="500" value="${l0}" aria-label="${esc(tr('gen.l0Label'))}" style="width:96px;padding:5px 8px;border:1px solid var(--border);border-radius:8px;background:var(--panel);color:var(--text);font-family:inherit">
        <span class="gen-lbl">${tr('gen.l0Unit')}</span>
        <button class="btn" id="acpSave" style="padding:5px 12px;font-size:12px">${tr('gen.ctxSave')}</button>
        <span class="hint" id="acpMsg" style="font-size:11.5px;color:var(--faint)"></span>
      </div>
    </div>
    <div class="sp-section" id="closeBehaviorRow">
      <h4>${tr('gen.closeTitle')}</h4>
      <div style="display:flex;gap:10px;max-width:470px;margin-top:8px">
        ${closeOpts.map((o) => card(o, 'closeBehavior', closeVal === o.v)).join('')}
      </div>
      <p class="hint" id="closeNote" style="font-size:11.5px;color:var(--faint);margin:9px 0 0">${tr('gen.closeNote')}</p>
      <span class="hint" id="closeMsg" style="font-size:11.5px;color:var(--faint)"></span>
    </div>
    <div class="sp-section">
      <h4>${tr('web.backendTitle')}</h4>
      <p class="hint" style="font-size:11.5px;color:var(--faint);margin:0 0 8px">${tr('web.backendHint')}</p>
      <div style="display:flex;align-items:center;gap:10px;max-width:640px;flex-wrap:wrap;margin-top:8px">
        <label for="webProv" class="gen-lbl">${tr('web.provider')}</label>
        <select id="webProv" style="padding:5px 8px;border:1px solid var(--border);border-radius:8px;background:var(--panel);color:var(--text);font-family:inherit">
          ${['auto','bing','searxng','tavily','brave','exa','ddg'].map((v) => `<option value="${v}" ${(gw.provider || 'auto') === v ? 'selected' : ''}>${v === 'auto' ? tr('web.auto') : v}</option>`).join('')}
        </select>
        <input type="text" id="webKey" placeholder="${esc(tr('web.keyPh'))}" value="${esc(gw.searxngUrl || '')}" style="flex:1;min-width:180px;padding:5px 8px;border:1px solid var(--border);border-radius:8px;background:var(--panel);color:var(--text);font-family:inherit">
        <button class="btn" id="webSave" style="padding:5px 12px;font-size:12px">${tr('gen.ctxSave')}</button>
        <span class="hint" id="webMsg" style="font-size:11.5px;color:var(--faint)"></span>
      </div>
      <p class="hint" id="webMcpState" style="font-size:11.5px;color:${smOk ? 'var(--ok)' : 'var(--warn)'};margin:8px 0 0"${smNote ? '' : ' hidden'}>${esc(smNote)}</p>
    </div>`;
  renderCfgWarn();   // 常驻告警条：进通用页即按最近一次保存结果刷新
  body.querySelectorAll('input[name="theme"]').forEach((r) => r.addEventListener('change', async () => {
    if (!r.checked) return;
    await setTheme(r.value); renderGeneralPanel(body);
  }));
  body.querySelectorAll('input[name="lang"]').forEach((r) => r.addEventListener('change', async () => {
    if (!r.checked) return;
    await setLang(r.value); renderGeneralPanel(body);
  }));
  const webSave = body.querySelector('#webSave');
  if (webSave) webSave.addEventListener('click', async () => {
    const prov = body.querySelector('#webProv').value;
    const val = body.querySelector('#webKey').value.trim();
    // 只保存"搜索后端"：联网本身由模型自行调用内置 web_search 工具，无开关、无 enabled 字段
    const web = { provider: prov };
    // 输入框按所选源解释：SearXNG 填地址；tavily/brave/exa 填 key
    if (prov === 'searxng') web.searxngUrl = val;
    else if (['tavily', 'brave', 'exa'].includes(prov)) web.keys = { [prov]: val };
    applyConfigWarnings(await api('PUT', '/api/settings', { global: { web } }), tr('web.backendTitle'));
    const fresh = await api('GET', '/api/settings');
    state.settings = { ...(state.settings || {}), ...fresh };
    renderGeneralPanel(body);
    const m = body.querySelector('#webMsg');
    if (m) { m.textContent = tr('gen.ctxSaved'); setTimeout(() => { m.textContent = ''; }, 4000); }
  });
  const acpBtn = body.querySelector('#acpSave');
  if (acpBtn) acpBtn.addEventListener('click', async () => {
    const inp = body.querySelector('#acpInput');
    const v = Math.round(Number(inp && inp.value));
    if (!Number.isFinite(v) || v < 10 || v > 99) {
      uiDialog({ title: tr('dial.hint'), message: tr('gen.ctxPct') + ' 10–99', buttons: [{ label: tr('dial.gotit'), value: true, primary: true }] });
      return;
    }
    const l0El = body.querySelector('#l0Input');
    const l0v = Math.round(Number(l0El && l0El.value));
    const l0ok = Number.isFinite(l0v) && l0v >= 500 && l0v <= 200000;
    applyConfigWarnings(await api('PUT', '/api/settings', { global: { autoCompactPercent: v, ...(l0ok ? { toolOutputTokenLimit: l0v } : {}) } }), tr('gen.ctxTitle'));
    state.settings = state.settings || {}; state.settings.global = { ...(state.settings.global || {}), autoCompactPercent: v, ...(l0ok ? { toolOutputTokenLimit: l0v } : {}) };
    if (!state.settings.contextWindows) state.settings.contextWindows = {};
    renderGeneralPanel(body);
    const m = body.querySelector('#acpMsg');
    if (m) { m.textContent = tr('gen.ctxSaved'); setTimeout(() => { m.textContent = ''; }, 4000); }
  });
  // 关窗行为：立即落盘（与主题/语言同为"改即生效"的偏好项）
  body.querySelectorAll('input[name="closeBehavior"]').forEach((r) => r.addEventListener('change', async () => {
    if (!r.checked) return;
    const val = r.value === 'quit' ? 'quit' : 'hide';
    state.settings = state.settings || {}; state.settings.global = { ...(state.settings.global || {}), closeBehavior: val };
    try { applyConfigWarnings(await api('PUT', '/api/settings', { global: { closeBehavior: val } }), tr('gen.closeTitle')); } catch {}
    renderGeneralPanel(body);
    const m = body.querySelector('#closeMsg');
    if (m) { m.textContent = tr('gen.ctxSaved'); setTimeout(() => { m.textContent = ''; }, 4000); }
  }));
}

/* ---------- 引擎配置（单轮 token 预算 + 引擎配置告警） ----------
   hooks 已按裁定**整块删除**：引擎判 untrusted 且不执行、无信任 RPC，展示一个永不生效的能力是误导。
   保留：① 单轮 token 预算（禁用态 + 0.152.1 原因，仍是有效信息）；
        ② configWarnings —— PUT /api/settings 回包里"某项能力不生效"的可读原因，与 hooks 无关。 */
/* ---------- 引擎配置告警（configWarnings）----------
   「引擎配置」页已按用户裁定**整页删除**（含单轮 token 上限：该项不可写，展示无意义）。
   但 configWarnings 必须保住：它是"引擎拒绝配置 → 回落默认（模型/厂商/人格全不生效）"的**唯一可见信号**，
   现常驻在 设置 → 通用 顶部。 */
/** 收集 PUT /api/settings 回包的 configWarnings / engineRegression，并立即刷新通用页顶部的告警条 */
function applyConfigWarnings(r, source) {
  if (!r || typeof r !== 'object') return [];
  const warns = Array.isArray(r.configWarnings) ? r.configWarnings.filter(Boolean).map(String) : [];
  if (r.engineRegression && r.error) warns.unshift(tr('cfgWarn.engineRegression') + String(r.error));
  state.configWarnings = warns.length ? { at: Date.now(), source: String(source || ''), items: warns } : null;
  renderCfgWarn();
  return warns;
}
/** 告警条渲染（#cfgWarn 常驻在通用页顶部；无告警时隐藏，不占版面也不说谎） */
function renderCfgWarn() {
  const el = $('#cfgWarn');
  if (!el) return;
  const w = state.configWarnings;
  if (!w || !w.items.length) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  const from = w.source ? ' ' + tr('cfgWarn.from').replace('{s}', w.source) : '';
  el.textContent = '⚠ ' + w.items.join('；') + from;
}

// ---------- 模型配置：Provider 卡片（折叠）+ 获取模型 + 已启用模型 ----------

// 厂商预设：选择后自动填充 baseUrl / envKey / wireApi（参考 DeepSeek 接入模式：
// 根地址或官方 OpenAI 兼容端点，codex 走 responses API）。均需 OpenAI 兼容端点。
const PROVIDER_PRESETS = [
  { id: 'deepseek',   name: 'DeepSeek · 深度求索', en: 'DeepSeek', url: 'https://api.deepseek.com' },
  { id: 'qwen',       name: '通义千问 Qwen · 阿里', en: 'Qwen · Alibaba', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'glm',        name: '智谱 GLM', en: 'Zhipu GLM', url: 'https://open.bigmodel.cn/api/v1' },
  { id: 'kimi',       name: 'Kimi · 月之暗面', en: 'Kimi · Moonshot', url: 'https://api.moonshot.cn/v1' },
  { id: 'doubao',     name: '豆包 · 火山方舟', en: 'Doubao · Volcano Ark', url: 'https://ark.cn-beijing.volces.com/api/v3' },
  { id: 'minimax',    name: 'MiniMax', url: 'https://api.minimaxi.com/v1' },
  { id: 'openai',     name: 'OpenAI', url: 'https://api.openai.com/v1' },
  { id: 'claude',     name: 'Claude · Anthropic', url: 'https://api.anthropic.com/v1' },
  { id: 'gemini',     name: 'Gemini · Google', url: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { id: 'openrouter', name: 'OpenRouter · 聚合', en: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
  { id: 'groq',       name: 'Groq', url: 'https://api.groq.com/openai/v1' },
  { id: 'ollama',     name: 'Ollama · 本地', en: 'Ollama · Local', url: 'http://localhost:11434/v1', keyless: true },
];
const presetName = (ps) => (lang === 'en' && ps.en) ? ps.en : ps.name;
// 免鉴权本地 Provider（如 Ollama）：不需要 API Key。
// ollama 是 codex 内置保留 provider（默认 base_url http://localhost:11434/v1、无需 key），
// 引擎不为其注册 [model_providers.ollama]（直接用内置），此配置仅保留 baseUrl 供「获取模型」拉列表。
const KEYLESS_PROVIDER_IDS = new Set(['ollama']);
const isKeylessProvider = (id, p) => !!(p && p.keyless) || KEYLESS_PROVIDER_IDS.has(id);
let pendingOpenProvider = null; // 新增/删除后重渲染时要展开的 provider id
const provOpen = new Set();     // 用户手动展开的 provider 卡片；默认全部收起，重渲染不改变

function renderModelPanel(body) {
  modelPanelDirty = false;      // 每次重绘视为"已与服务端一致"
  modelPanelSave = null;
  api('GET', '/api/settings').then((s) => {
    settingsCache = s;
    const provs = s.providers || {};
    // 已启用模型集（跨 provider 扁平；数组顺序即优先级，第一项为默认）
    const enabled = JSON.parse(JSON.stringify((s.global && s.global.enabledModels) || []));
    const isEnabled = (pid, mid) => enabled.some((e) => e.providerId === pid && e.modelId === mid);
    const enabledCount = (pid) => enabled.filter((e) => e.providerId === pid).length;

    // 顶部：已启用模型 chips（默认徽章 + 设默认 + 移除）
    const metaBrief = (id, p) => { const c = (p && p.models && p.models.length) || 0; return c ? tr('model.metaHas').replace('{m}', String(c)).replace('{e}', String(enabledCount(id))) : ((p && p.baseUrl) ? esc(p.baseUrl) : tr('model.unset')); };
    const cachedTxt = (n) => tr('model.cachedHas').replace('{n}', String(n));
    // 已启用模型不再单独成区：勾选状态就显示在各 Provider 的模型列表里（勾选=启用），
    // 请求名称也在同一行就地编辑 —— 一个地方管一件事，避免"上面一份、下面一份"。
    const enabledHtml = '';
    const provsHtml = `<div class="sp-section"><div style="display:flex;align-items:center;gap:10px"><h4 style="flex:1;margin:0">${tr('model.providersTitle')}</h4>
        <button class="btn-outline" id="addProvBtn" style="padding:4px 10px;font-size:12px">＋ ${tr('model.addProvider')}</button></div>` +
      Object.entries(provs).map(([id, p]) => {
        const keyless = isKeylessProvider(id, p);
        const st = keyless ? 'keyless' : (p.keySet ? 'set' : 'unset');
        const stLabel = keyless ? tr('model.badgeLocal') : (p.keySet ? tr('model.badgeSet') : tr('model.badgeUnset'));
        const open = provOpen.has(id) || id === pendingOpenProvider ? ' open' : '';
        return `
        <div class="prov-card${open}" id="card_${esc(id)}">
          <div class="prov-head" data-toggle="${esc(id)}">
            <span class="prov-caret">▶</span>
            <span class="prov-name">${esc(p.name || id)}</span>
            <span class="key-badge ${st}" style="font-size:10px">${stLabel}</span>
            <span class="prov-meta"><span id="meta_${esc(id)}">${metaBrief(id, p)}</span><button class="prov-del" data-del="${esc(id)}" title="${tr('model.delProvider')}"><span class="ic">${ICONS.trash}</span></button></span>
          </div>
          <div class="prov-body">
            <div class="prov-field"><label>${tr('model.nameLabel')}</label>
              <input type="text" id="name_${id}" placeholder="${esc(id)}" value="${esc(p.name || '')}" spellcheck="false"></div>
            <div class="prov-field"><label>Base URL</label>
              <input type="text" id="url_${id}" placeholder="https://api.deepseek.com" value="${esc(p.baseUrl || '')}"></div>
            ${keyless
              ? `<div class="prov-field"><label>${tr('model.apiKey')}</label><div class="hint" style="font-size:12px;color:var(--faint);padding:6px 0">${tr('model.noKey')}</div></div>`
              : `<div class="prov-field"><label>${tr('model.apiKey')}</label>
              <input type="password" id="key_${id}" placeholder="${p.keySet ? tr('model.keepBlank') : 'sk-...'}" autocomplete="off"></div>`}
            <div class="prov-fetch">
              <button class="btn-outline" data-fetch="${esc(id)}" style="padding:5px 12px;font-size:12px">↻ ${tr('model.fetch')}</button>
              <span class="hint" id="fetchMsg_${id}">${(p.models && p.models.length) ? cachedTxt(p.models.length) : tr('model.fetchHint')}</span>
            </div>
            <input type="text" class="ml-filter" id="filter_${esc(id)}" placeholder="${tr('model.filter')}" style="display:none">
            <div class="mlist" id="mlist_${id}" style="max-height:240px"></div>
            <div class="req-add">
              <input type="text" class="req-input" id="req_${id}" placeholder="${esc(tr('model.reqNamePh'))}" spellcheck="false" autocomplete="off">
              <button class="btn-outline" data-addreq="${esc(id)}">＋ ${tr('model.addReq')}</button>
            </div>
            <p class="hint" style="font-size:11.5px;color:var(--faint);margin:6px 0 0">${tr('model.reqNameHint')}</p>
          </div>
        </div>`;
      }).join('') + `</div>`;

    const hintHtml = `<p class="hint" style="font-size:11.5px;color:var(--faint);margin:-4px 0 12px">${tr('model.enabledHint')}</p>`;
    body.innerHTML = enabledHtml + hintHtml + provsHtml + `
      <div class="sp-actions"><span class="save-msg" id="modelMsg"></span>
        <button class="btn-accent" id="modelSave">${tr('model.save')}</button>
      </div>`;


    // 自动生成的显示名（用户没自定义 label 时，跟随请求名变化）
    const autoLabel = (pid, mid) => pid + ' · ' + mid;

    function renderMetas() {
      for (const id of Object.keys(provs)) {
        const el = $('#meta_' + id);
        if (el) {
          const cached = provs[id].models;
          el.textContent = (cached && cached.length) ? tr('model.metaHas').replace('{m}', String(cached.length)).replace('{e}', String(enabledCount(id))) : (provs[id].baseUrl || tr('model.unset'));
        }
      }
    }
    // 把一份模型列表渲染成可勾选行（name 与 id 相同只显示一次；带过滤框）
    /**
     * 渲染某 Provider 的模型列表：**勾选=启用**，行内可就地改「请求名称」（发给供应商的 model 字段）。
     * 列表 = 手动添加的自定义项（置顶）+ 拉取到的模型；两处同一套交互，不再有独立的"已启用"区。
     */
    function fillChecklist(pid, list) {
      const box = $('#mlist_' + pid);
      if (!box) return;
      const filter = $('#filter_' + pid);
      const fetched = list.map((m) => ({ id: m.id, name: m.name || m.id }));
      const fetchedIds = new Set(fetched.map((m) => m.id));
      // 自定义项：已启用、但不在拉取列表里的（手动添加的）
      const custom = enabled.filter((e) => e.providerId === pid && !fetchedIds.has(e.modelId))
        .map((e) => ({ id: e.modelId, name: e.modelId, custom: true }));
      const rows = [...custom, ...fetched];
      if (filter) { filter.style.display = rows.length > 8 ? 'block' : 'none'; filter.value = ''; }

      const rowHtml = (m) => {
        const k = pid + '|' + m.id;
        const en = isEnabled(pid, m.id);
        const same = m.name === m.id;
        return `<div class="ml-row" data-text="${esc(((m.name || '') + ' ' + m.id).toLowerCase())}" data-k="${esc(k)}">
          <input type="checkbox" class="ml-ck" data-k="${esc(k)}" ${en ? 'checked' : ''}>
          <span class="ml-name">${esc(m.name)}</span>
          ${same ? '' : `<span class="ml-code">${esc(m.id)}</span>`}
          ${m.custom ? `<span class="ml-badge">${tr('model.custom')}</span>` : ''}
          <button class="ml-edit" data-editk="${esc(k)}" title="${tr('model.editReqHint')}">${tr('model.editReq')}</button>
        </div>`;
      };
      box.innerHTML = rows.map(rowHtml).join('') || `<div class="ml-empty">${tr('model.listEmpty')}</div>`;

      // 勾选/取消 = 启用/停用（取消即从已启用里移除）
      box.querySelectorAll('.ml-ck').forEach((cb) => cb.addEventListener('change', () => {
        const [cpid, cmid] = cb.dataset.k.split('|');
        if (cb.checked) {
          if (!isEnabled(cpid, cmid)) {
            const nameEl = $('#name_' + cpid);
            enabled.push({ providerId: cpid, modelId: cmid, label: ((nameEl && nameEl.value.trim()) || pname(cpid)) + ' · ' + cmid });
          }
        } else {
          const i = enabled.findIndex((e) => e.providerId === cpid && e.modelId === cmid);
          if (i >= 0) enabled.splice(i, 1);
        }
        renderMetas();
      }));

      // 就地改「请求名称」：把该行换成输入框
      box.querySelectorAll('[data-editk]').forEach((btn) => btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        startEditReqInRow(btn.closest('.ml-row'), pid, btn.dataset.editk.split('|')[1]);
      }));

      if (filter) {
        filter.oninput = () => {
          const q = filter.value.trim().toLowerCase();
          box.querySelectorAll('.ml-row').forEach((r) => { r.style.display = !q || r.dataset.text.includes(q) ? '' : 'none'; });
        };
      }
    }

    /** 在列表行内编辑请求名称（默认填当前请求名；回车确认、Esc 取消） */
    function startEditReqInRow(row, pid, originalId) {
      if (!row) return;
      const entry = enabled.find((e) => e.providerId === pid && e.modelId === originalId);
      const cur = entry ? entry.modelId : originalId;
      const wasAuto = !entry || !entry.label || entry.label === autoLabel(pid, cur);
      const cell = row.querySelector('.ml-name');
      const btn = row.querySelector('.ml-edit');
      const restore = () => { refreshProviderList(pid); };
      // 用输入框替换该行的主体
      const wrap = document.createElement('span');
      wrap.className = 'ml-editwrap';
      wrap.innerHTML = `<input class="ml-input" value="${esc(cur)}" spellcheck="false" autocomplete="off">
        <button class="ml-ok" title="${tr('common.saveOk')}">✓</button>
        <button class="ml-cancel" title="${tr('common.cancel')}">✕</button>`;
      cell.replaceWith(wrap);
      if (btn) btn.style.display = 'none';
      const inp = wrap.querySelector('.ml-input');
      inp.focus(); inp.select();
      const commit = () => {
        const v = inp.value.trim();
        if (!v) return restore();
        if (v === cur) return restore();
        if (enabled.some((e) => e.providerId === pid && e.modelId === v && e.modelId !== cur)) {
          uiDialog({ title: tr('model.reqName'), message: tr('model.dupReq').replace('{n}', v), buttons: [{ label: tr('common.ok'), value: 1, primary: true }] });
          inp.focus(); inp.select();
          return;
        }
        if (entry) {
          // 该条是否已持久化到服务端？未持久化的（刚手动添加 / 刚勾选、还没点保存）
          // 不可能被任何会话引用（会话的 modelId 来自已保存的启用列表），
          // 因此本地改名即可；此时调服务端只会 404。
          const saved = ((settingsCache && settingsCache.global && settingsCache.global.enabledModels) || [])
            .some((e) => e.providerId === pid && e.modelId === cur);
          if (!saved) {
            entry.modelId = v;
            if (wasAuto) entry.label = autoLabel(pid, v);
            markDirty();
            refreshProviderList(pid);
            renderMetas();
            const m0 = $('#modelMsg');
            if (m0) { m0.textContent = tr('model.reqAdded').replace('{n}', v); setTimeout(() => { m0.textContent = ''; }, 4000); }
            return;
          }
          // 已持久化 → 走服务端原子改名：同时改设置、**所有正用旧名字的会话**、引擎线程映射。
          // 只改本地数组是不够的：turn/start 注入的 model 取自会话存的 modelId，
          // 那些会话会继续拿旧名字请求（模型不存在）。
          renameEnabledModel(pid, cur, v).then((r) => {
            if (r && r.error) {
              // 兜底：若服务端说没这条（例如状态不同步），退化为本地改名，不让用户卡住
              if (/未找到已启用模型/.test(r.error)) {
                entry.modelId = v;
                if (wasAuto) entry.label = autoLabel(pid, v);
                refreshProviderList(pid); renderMetas();
                return;
              }
              uiDialog({ title: tr('model.reqName'), message: r.error, buttons: [{ label: tr('common.ok'), value: 1, primary: true }] });
              refreshProviderList(pid);
              return;
            }
            const msg = $('#modelMsg');
            if (msg) {
              msg.textContent = tr('model.renamedSync').replace('{from}', cur).replace('{to}', v).replace('{n}', String((r && r.sessions) || 0));
              setTimeout(() => { msg.textContent = ''; }, 6000);
            }
            refreshBootstrap().then(() => { fillModelSelect(); syncEnabledFromServer(pid); });
          });
          return;
        }
        // 该行还没启用：直接按新请求名启用（勾选状态一并更新）
        const nameEl = $('#name_' + pid);
        enabled.push({ providerId: pid, modelId: v, label: ((nameEl && nameEl.value.trim()) || pname(pid)) + ' · ' + v });
        markDirty();
        refreshProviderList(pid);
        renderMetas();
      };
      wrap.querySelector('.ml-ok').addEventListener('click', (ev) => { ev.preventDefault(); commit(); });
      wrap.querySelector('.ml-cancel').addEventListener('click', (ev) => { ev.preventDefault(); restore(); });
      inp.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
        else if (ev.key === 'Escape') { ev.preventDefault(); restore(); }
      });
      inp.addEventListener('click', (ev) => ev.stopPropagation());
    }

    /** 调用服务端原子改名（设置 + 会话 + 线程映射一起改） */
    async function renameEnabledModel(pid, from, to) {
      try { return await api('POST', '/api/models/rename', { providerId: pid, from, to }); }
      catch (e) { return { error: String((e && e.message) || e) }; }
    }

    /** 改名成功后：用服务端最新数据刷新本地 enabled 列表与 UI */
    async function syncEnabledFromServer(pid) {
      const s2 = await api('GET', '/api/settings');
      settingsCache = s2;
      const fresh = ((s2.global && s2.global.enabledModels) || []).map((e) => ({ ...e }));
      enabled.length = 0;
      for (const e of fresh) enabled.push(e);
      refreshProviderList(pid);
      renderMetas();
    }

    /** 用当前缓存重新渲染某个 Provider 的列表（自定义项、勾选、行内改名都依赖它） */
    function refreshProviderList(pid) {
      const cached = (provs[pid] && provs[pid].models) || [];
      fillChecklist(pid, cached);
    }

    const pname = (pid) => (provs[pid] && provs[pid].name) || pid;

    // baseUrl / API Key 一经改动 → 旧的可选模型列表立即作废：清空就地列表 + 移除已启用里该 provider 的旧模型
    const invalidated = new Set();
    function invalidateModels(pid) {
      if (invalidated.has(pid)) return;
      invalidated.add(pid);
      const box = $('#mlist_' + pid); if (box) box.innerHTML = '';
      const filter = $('#filter_' + pid); if (filter) filter.style.display = 'none';
      const msg = $('#fetchMsg_' + pid);
      if (msg) { msg.textContent = tr('model.urlKeyChanged'); msg.style.color = 'var(--accent)'; }
      for (let i = enabled.length - 1; i >= 0; i--) if (enabled[i].providerId === pid) enabled.splice(i, 1);
      renderMetas();
      // 同步内存配置：后端保存时同样会删缓存 models，这里让重置/后续 GET 也看不到旧缓存
      if (settingsCache && settingsCache.providers && settingsCache.providers[pid]) delete settingsCache.providers[pid].models;
    }
    // 监听 url/key 输入：相对「已保存配置」有改动就立刻清除旧可选模型
    for (const [pid, p] of Object.entries(provs)) {
      const urlEl = $('#url_' + pid), keyEl = $('#key_' + pid);
      const origUrl = (p && p.baseUrl) || '';
      const onEdit = () => {
        const urlChanged = urlEl.value.trim() && urlEl.value.trim() !== origUrl;
        const keyChanged = keyEl ? !!keyEl.value.trim() : false;   // keyless 无 key 输入框
        if (urlChanged || keyChanged) invalidateModels(pid);
      };
      urlEl.addEventListener('input', onEdit);
      if (keyEl) keyEl.addEventListener('input', onEdit);
      // 名称改动即时反映到卡片头部与已启用 chips（保存后以输入框值为准重建 label）
      const nameEl = $('#name_' + pid);
      if (nameEl) nameEl.addEventListener('input', () => {
        const nm = nameEl.value.trim() || pid;
        const h = $('#card_' + pid);
        if (h) { const nEl = h.querySelector('.prov-name'); if (nEl) nEl.textContent = nm; }
        let changed = false;
        for (const e of enabled) if (e.providerId === pid) { e.label = nm + ' · ' + e.modelId; changed = true; }
        if (changed) { renderMetas(); }
      });
    }

    // 卡片折叠（状态记入 provOpen，重渲染/刷新不丢）
    body.querySelectorAll('[data-toggle]').forEach((h) => h.addEventListener('click', () => {
      const id = h.dataset.toggle;
      $('#card_' + id).classList.toggle('open');
      if (provOpen.has(id)) provOpen.delete(id); else provOpen.add(id);
    }));

    // 新增模型配置：弹窗选择厂商预设（自动填 URL）或自定义
    const menuBtn = $('#addProvBtn'), pickMask = $('#provPickMask'), pickList = $('#provPickList');
    const renderPickList = () => {
      pickList.innerHTML = PROVIDER_PRESETS.map((ps) => {
        const exists = !!provs[ps.id];
        return `<button class="pp-item" data-preset="${ps.id}"><span class="pp-name">${esc(presetName(ps))}${exists ? `<em class="pp-tag">${tr('model.addedTag')}</em>` : ''}</span><span class="pp-url">${esc(ps.url)}</span></button>`;
      }).join('') + `<button class="pp-item" data-custom="1"><span class="pp-name">${tr('model.customItem')}</span><span class="pp-url">${tr('model.customUrlHint')}</span></button>`;
    };
    const closePick = () => pickMask.classList.remove('show');
    menuBtn.addEventListener('click', () => { renderPickList(); pickMask.classList.add('show'); });
    $('#provPickClose').addEventListener('click', closePick);
    $('#provPickCancel').addEventListener('click', closePick);
    pickMask.addEventListener('click', (e) => { if (e.target === pickMask) closePick(); });
    async function addProvider(ps) {
      closePick();
      let id, entry;
      if (ps.custom) {
        id = 'custom-' + Date.now().toString(36);
        entry = { name: tr('model.customName'), baseUrl: '', envKey: id.toUpperCase().replace(/-/g, '_') + '_API_KEY', wireApi: 'responses' };
      } else {
        id = ps.id;
        if (provs[id]) { provOpen.add(id); renderModelPanel(body); return; }
        entry = { name: presetName(ps).split(' · ')[0], baseUrl: ps.url, envKey: ps.id.toUpperCase() + '_API_KEY', wireApi: 'responses' };
        if (ps.keyless) entry.keyless = true;
      }
      await api('PUT', '/api/settings', { providers: { [id]: entry } });
      provs[id] = { ...entry };
      provOpen.add(id);
      pendingOpenProvider = id;
      renderModelPanel(body);
    }
    pickList.addEventListener('click', (e) => {
      const item = e.target.closest('[data-preset],[data-custom]');
      if (!item) return;
      if (item.dataset.custom) addProvider({ custom: true });
      else {
        const ps = PROVIDER_PRESETS.find((x) => x.id === item.dataset.preset);
        if (ps) addProvider(ps);
      }
    });

    // 删除 Provider（连带移除其已启用模型）
    body.querySelectorAll('[data-del]').forEach((btn) => btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const pid = btn.dataset.del;
      const ok = await uiDialog({ title: tr('model.delTitle'), message: tr('model.delMsg1') + '「' + ((provs[pid] && provs[pid].name) || pid) + '」' + tr('model.delMsg2'), buttons: [{ label: tr('common.delete'), value: true, danger: true, primary: true }] });
      if (!ok) return;
      await api('PUT', '/api/settings', { providers: { [pid]: null } });
      for (let i = enabled.length - 1; i >= 0; i--) if (enabled[i].providerId === pid) enabled.splice(i, 1);
      if (enabled.length) await api('PUT', '/api/settings', { global: { enabledModels: enabled } });
      delete provs[pid];
      provOpen.delete(pid);
      renderModelPanel(body);
    }));

    // 手动添加「请求名称」：拉取列表里没有的模型（别名 / 自建网关 / 预览版）也能启用
    const addReq = (pid) => {
      const inp = $('#req_' + pid);
      if (!inp) return;
      const v = inp.value.trim();
      if (!v) { inp.focus(); return; }
      if (enabled.some((e) => e.providerId === pid && e.modelId === v)) {
        uiDialog({ title: tr('model.reqName'), message: tr('model.dupReq').replace('{n}', v), buttons: [{ label: tr('common.ok'), value: 1 }] });
        return;
      }
      const nameEl = $('#name_' + pid);
      const cname = (nameEl && nameEl.value.trim()) || pname(pid);
      enabled.push({ providerId: pid, modelId: v, label: cname + ' · ' + v });
      inp.value = '';
      const msg = $('#modelMsg');
      if (msg) { msg.textContent = tr('model.reqAdded').replace('{n}', v); setTimeout(() => { msg.textContent = ''; }, 4000); }
      markDirty();
      refreshProviderList(pid);   // 自定义项会作为一行出现在该 Provider 的列表顶部
      renderMetas();
    };
    body.querySelectorAll('[data-addreq]').forEach((b) => b.addEventListener('click', () => addReq(b.dataset.addreq)));
    body.querySelectorAll('.req-input').forEach((inp) => inp.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); addReq(inp.id.replace(/^req_/, '')); }
    }));

    // 拉取模型 → 就地展开可勾选列表
    body.querySelectorAll('[data-fetch]').forEach((btn) => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const pid = btn.dataset.fetch;
        btn.disabled = true; btn.textContent = tr('model.fetching');
        const msg = $('#fetchMsg_' + pid);
        msg.style.color = '';
        const url = $('#url_' + pid).value.trim();
        const keyEl = $('#key_' + pid);
        const key = keyEl ? keyEl.value.trim() : '';   // keyless 无 key 输入框
        const origUrl = (provs[pid] && provs[pid].baseUrl) || '';
        // 仅当 url/key 相对已保存配置有改动才 PUT（后端会一并清除旧 models 缓存）
        if (url && url !== origUrl) await api('PUT', '/api/settings', { providers: { [pid]: { baseUrl: url } } });
        if (key) await api('PUT', '/api/settings', { providers: { [pid]: { apiKey: key } } });
        const r = await api('POST', '/api/models/fetch', { providerId: pid });
        if (r.models) {
          invalidated.delete(pid);
          provs[pid].models = r.models;
          // 服务端会清理「该 provider 下已失效的已启用模型」→ 本地同步，避免勾选态/芯片残留
          if (r.removed) {
            const ids = new Set(r.models.map((m) => m.id));
            for (let i = enabled.length - 1; i >= 0; i--) {
              if (enabled[i].providerId === pid && !ids.has(enabled[i].modelId)) enabled.splice(i, 1);
            }
            refreshProviderList(pid);
          }
          msg.textContent = tr('model.cachedHas').replace('{n}', String(r.models.length))
            + (r.removed ? ' · ' + tr('model.pruned').replace('{n}', String(r.removed)) : '');
          provOpen.add(pid);
          $('#card_' + pid).classList.add('open');
          fillChecklist(pid, r.models);
          renderMetas();
        } else {
          msg.textContent = '✗ ' + (r.error || tr('model.fetchFail'));
          msg.style.color = 'var(--danger)';
          setTimeout(() => { msg.style.color = ''; }, 2500);
        }
        btn.disabled = false; btn.textContent = '↻ ' + tr('model.fetch');
      });
    });

    for (const id of Object.keys(provs)) refreshProviderList(id);

    // 已有缓存的 provider 直接就地展开可勾选列表（不必再点获取）
    for (const [pid, p] of Object.entries(provs)) {
      const cached = p.models;
      if (cached && cached.length && $('#mlist_' + pid)) {
        fillChecklist(pid, cached);
      }
    }
    pendingOpenProvider = null; // 展开意图已消费

    const markDirty = () => { modelPanelDirty = true; };
    // 面板内任何输入/勾选都算改动（provider 名称/URL/Key、模型勾选、过滤框除外）
    body.addEventListener('input', (ev) => {
      const t = ev.target;
      if (t && t.id && String(t.id).startsWith('filter_')) return;   // 过滤只是本地筛选
      markDirty();
    });
    body.addEventListener('change', markDirty);

    const doSaveModelPanel = async () => {
      const providers = {};
      const typedName = (id) => { const el = $('#name_' + id); return el ? el.value.trim() : ''; };
      for (const id of Object.keys(provs)) {
        const url = $('#url_' + id).value.trim();
        const keyEl = $('#key_' + id);
        const key = keyEl ? keyEl.value.trim() : '';   // keyless 无 key 输入框
        const nm = typedName(id);
        const upd = {};
        if (url && url !== provs[id].baseUrl) upd.baseUrl = url;
        if (key) upd.apiKey = key;
        if (nm !== (provs[id].name || '')) upd.name = nm;
        if (Object.keys(upd).length) providers[id] = upd;
      }
      // 以当前输入框的供应商名称重建已启用模型的显示标签（名称可留空 → 回退用 provider id）
      const en = enabled.map((e) => ({ providerId: e.providerId, modelId: e.modelId, label: (typedName(e.providerId) || e.providerId) + ' · ' + e.modelId }));
      const res = await api('PUT', '/api/settings', { providers, global: { enabledModels: en } });
      if (res && res.error) {
        const msg = $('#modelMsg');
        if (msg) { msg.textContent = tr('model.saveFail') + res.error; }
        return false;
      }
      modelPanelDirty = false;
      // 同步内存态并刷新发送框下拉（改请求名后无需刷新界面即可生效）
      await refreshBootstrap();
      fillModelSelect();
      flash('✓ ' + tr('common.save'), 'modelMsg');
      renderModelPanel(body);   // 重绘：卡片名称 / 已启用列表以保存结果为准
      return true;
    };
    // 供"关闭设置时提示保存"调用（closeSettings 里通过 modelPanelSave 触发）
    modelPanelSave = doSaveModelPanel;
    $('#modelSave').addEventListener('click', () => { doSaveModelPanel(); });
  });
}

// ---------- 用量仪表（token 计量，数据来自 data/usage.jsonl） ----------

/* ---------- 环境与诊断 · Windows 沙箱 ---------- */

const SANDBOX_STATUS = {
  ready: ['env.statusReady', 'ok'],
  notConfigured: ['env.statusNotConfigured', 'warn'],
  updateRequired: ['env.statusUpdateRequired', 'warn'],
  error: ['env.statusError', 'fail'],
  unknown: ['env.statusUnknown', 'warn'],
};
const sandboxStatusText = (st) => tr((SANDBOX_STATUS[st] || SANDBOX_STATUS.unknown)[0]);
let sandboxSetupWaiting = false;   // 本次点击触发的初始化是否正在等待结果（避免重复弹窗）

/** 拉取沙箱状态并刷新横幅/面板（win32 之外直接返回） */
async function refreshSandbox(force) {
  if (!(state.platform && state.platform.sandboxSupported)) return null;
  try {
    const s = await api('GET', '/api/sandbox' + (force ? '?refresh=1' : ''));
    state.sandbox = s;
    renderSandboxBanner();
    const el = $('#sbStatus');
    if (el) {
      el.textContent = sandboxStatusText((s.readiness && s.readiness.status) || 'unknown');
      const sel = $('#sbMode');
      if (sel && s.mode) sel.value = s.mode;
    }
    return s;
  } catch { return null; }
}

/** 顶部横幅：readiness 非 ready 时提示（「绝不静默失去隔离」） */
function renderSandboxBanner() {
  const el = $('#sandboxBanner');
  if (!el) return;
  const s = state.sandbox;
  if (!s || !s.supported) { el.hidden = true; return; }
  const st = (s.readiness && s.readiness.status) || 'unknown';
  if (st === 'ready') { el.hidden = true; return; }
  if (state.sandboxDismissed === st) { el.hidden = true; return; }   // 同一状态只提示一次
  const txt = st === 'notConfigured' ? tr('sb.needsInit')
    : st === 'updateRequired' ? tr('sb.updateNeeded')
      : tr('sb.unknown').replace('{e}', (s.readiness && s.readiness.error) || st);
  const text = $('#sandboxBannerText');
  if (text) text.textContent = txt;
  const btn = $('#sandboxBannerSetup');
  if (btn) {
    btn.hidden = !(st === 'notConfigured' || st === 'updateRequired');
    btn.disabled = false;
    btn.textContent = tr('env.sandboxInit');
  }
  el.hidden = false;
}

/** 轮询等待初始化结束（返回 setup.lastResult；超时返回 null） */
async function waitSandboxSetup(timeoutMs = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = await api('GET', '/api/sandbox?refresh=1').catch(() => null);
    if (s) { state.sandbox = s; renderSandboxBanner(); }
    if (s && s.setup && s.setup.running === false && s.setup.lastResult) return s.setup.lastResult;
    if (s && s.setup && s.setup.running === false && s.readiness && s.readiness.status === 'ready') {
      return { success: true, error: null };
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

/**
 * 触发沙箱初始化并**等到有明确结果**。
 * 历史问题：setupStart 返回 started:false 时旧代码静默当成功，用户点「初始化」毫无反应
 * （表现为「elevated 永远无效」）；现在失败必给错误原文 + 一键改用 unelevated。
 */
async function startSandboxSetup(mode) {
  const m = mode || (state.settings && state.settings.global && state.settings.global.windowsSandbox) || 'elevated';
  if (m === 'elevated') {
    const okv = await uiDialog({
      title: tr('env.sandboxInit'),
      message: tr('env.sandboxDesc'),
      buttons: [{ label: tr('common.cancel'), value: null }, { label: tr('common.ok'), value: 'go', primary: true }],
    });
    if (okv !== 'go') return;
  }
  sandboxSetupWaiting = true;
  try {
    const r = await api('POST', '/api/sandbox/setup', { mode: m });
    if (r && r.error) {
      await reportSandboxFailure(m, r.error);
      return;
    }
    const res = await waitSandboxSetup();
    if (res === null) {
      await reportSandboxFailure(m, tr('sb.setupTimeout'));
      return;
    }
    if (!res.success) {
      await reportSandboxFailure(m, res.error || tr('env.statusUnknown'));
      return;
    }
    state.sandboxDismissed = null;
    await refreshSandbox(true);
    uiDialog({ title: tr('env.sandbox'), message: tr('sb.setupOk').replace('{m}', m), buttons: [{ label: tr('common.ok'), value: 1 }] });
  } finally {
    sandboxSetupWaiting = false;
    state.sandbox = null;
    await refreshSandbox(true);
  }
}

/** 初始化失败：给出错误原文，并提供「改用 unelevated 重试」的一键路径 */
async function reportSandboxFailure(mode, errText) {
  const canFallback = mode !== 'unelevated';
  const v = await uiDialog({
    title: tr('sb.setupFailedTitle'),
    message: tr('sb.setupFailedMsg').replace('{m}', mode) + '\n\n' + String(errText || '').slice(0, 600)
      + (canFallback ? '\n\n' + tr('sb.tryUnelevated') : ''),
    buttons: canFallback
      ? [{ label: tr('common.ok'), value: null }, { label: tr('sb.switchUnelevated'), value: 'un', primary: true }]
      : [{ label: tr('common.ok'), value: null }],
  });
  if (v === 'un') {
    const cur = state.settings || { global: {} };
    state.settings = { ...cur, global: { ...(cur.global || {}), windowsSandbox: 'unelevated' } };
    await api('PUT', '/api/settings', { global: { windowsSandbox: 'unelevated' } });
    await startSandboxSetup('unelevated');
  }
}

function envRowHtml(i) {
  const mark = i.level === 'ok' ? '✓' : i.level === 'warn' ? '!' : '✗';
  return `<div class="env-row ${i.level}"><span class="env-mark">${mark}</span><span class="env-id">${esc(i.id)}</span>
    <span class="env-body">${esc(i.detail)}${i.hint ? `<span class="env-hint">↳ ${esc(i.hint)}</span>` : ''}</span></div>`;
}

async function runEnvCheck(body, refresh) {
  const list = body.querySelector('#envList');
  const sum = body.querySelector('#envSummary');
  const btn = body.querySelector('#envRun');
  if (btn) { btn.disabled = true; btn.textContent = tr('env.running'); }
  if (sum) sum.textContent = '';
  try {
    const r = await api('GET', '/api/envcheck' + (refresh ? '?refresh=1' : ''));
    state.envcheck = r;
    if (list) list.innerHTML = (r.items || []).map(envRowHtml).join('');
    if (sum) {
      const s = r.summary || {};
      sum.textContent = s.fail ? tr('env.failCount').replace('{n}', s.fail)
        : s.warn ? tr('env.warnCount').replace('{n}', s.warn)
          : tr('env.allOk');
      sum.style.color = s.fail ? '#dc2626' : s.warn ? '#d97706' : 'var(--faint)';
    }
  } catch (e) {
    if (list) list.innerHTML = `<div class="env-row fail">${esc(String(e && e.message || e))}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = tr('env.run'); }
  }
}

function renderEnvPanel(body) {
  const win = !!(state.platform && state.platform.sandboxSupported);
  body.innerHTML = `
    <div class="sp-section">
      <h4>${tr('env.check')}</h4>
      <p class="hint" style="margin:-2px 0 10px;font-size:12px;color:var(--faint)">${tr('env.checkDesc')}</p>
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:11px">
        <button class="btn-accent" id="envRun">${tr('env.run')}</button>
        <span id="envSummary" style="font-size:12px;color:var(--faint)"></span>
      </div>
      <div id="envList"></div>
    </div>
    ${win ? `<div class="sp-section">
      <h4>${tr('env.sandbox')}</h4>
      <p class="hint" style="margin:-2px 0 10px;font-size:12px;color:var(--faint)">${tr('env.sandboxDesc')}</p>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:9px">
        <span style="font-size:12.5px;color:var(--muted);min-width:74px">${tr('env.sandboxMode')}</span>
        <select id="sbMode" style="flex:1;max-width:320px;padding:7px 10px;border:1px solid var(--border-strong);border-radius:8px;font-size:12.5px;font-family:inherit;background:var(--panel);color:var(--text)">
          <option value="elevated">${tr('env.sandboxElevated')}</option>
          <option value="unelevated">${tr('env.sandboxUnelevated')}</option>
        </select>
      </div>
      <div style="font-size:12.5px;color:var(--muted);margin-bottom:11px">
        ${tr('env.sandboxStatus')}：<b id="sbStatus">…</b>
      </div>
      <div style="display:flex;gap:9px">
        <button class="btn-accent" id="sbInit">${tr('env.sandboxInit')}</button>
        <button class="btn-outline" id="sbRecheck">${tr('env.sandboxRecheck')}</button>
      </div>
    </div>` : ''}
    <div class="sp-section">
      <h4>${tr('env.diag')}</h4>
      <p class="hint" style="margin:-2px 0 10px;font-size:12px;color:var(--faint)">${tr('env.diagDesc')}</p>
      <button class="btn-accent" id="diagBtn">${tr('env.diagBtn')}</button>
      <p class="hint" style="font-size:11.5px;color:var(--faint);margin-top:11px">${tr('env.mcpNote')}</p>
    </div>`;

  body.querySelector('#envRun').addEventListener('click', () => runEnvCheck(body, true));
  const diag = body.querySelector('#diagBtn');
  if (diag) diag.addEventListener('click', async () => {
    diag.disabled = true;
    try {
      const r = await api('GET', '/api/diagnostics');
      const saved = await window.rose.saveText(r.filename, r.text);
      if (saved && saved.canceled) { /* 用户取消：不提示 */ }
      else if (saved && saved.error) uiDialog({ title: tr('env.diag'), message: tr('env.diagFail').replace('{e}', saved.error), buttons: [{ label: tr('common.ok'), value: 1 }] });
      else uiDialog({ title: tr('env.diag'), message: tr('env.diagDone').replace('{p}', (saved && saved.path) || ''), buttons: [{ label: tr('common.ok'), value: 1 }] });
    } catch (e) {
      uiDialog({ title: tr('env.diag'), message: tr('env.diagFail').replace('{e}', String(e && e.message || e)), buttons: [{ label: tr('common.ok'), value: 1 }] });
    } finally { diag.disabled = false; }
  });
  if (win) {
    const sel = body.querySelector('#sbMode');
    sel.value = (state.sandbox && state.sandbox.mode) || (state.settings && state.settings.global && state.settings.global.windowsSandbox) || 'elevated';
    sel.addEventListener('change', async () => {
      const cur = state.settings || { global: {} };
      state.settings = { ...cur, global: { ...(cur.global || {}), windowsSandbox: sel.value } };
      await api('PUT', '/api/settings', { global: { windowsSandbox: sel.value } });
      // 切换级别需重新初始化沙箱（elevated↔unelevated 的隔离机制不同）
      uiDialog({
        title: tr('env.sandbox'),
        message: tr('env.sandboxDesc'),
        buttons: [{ label: tr('common.cancel'), value: null }, { label: tr('env.sandboxInit'), value: 'go', primary: true }],
      }).then((v) => { if (v === 'go') startSandboxSetup(sel.value); });
    });
    body.querySelector('#sbInit').addEventListener('click', () => startSandboxSetup(sel.value));
    body.querySelector('#sbRecheck').addEventListener('click', () => refreshSandbox(true));
    refreshSandbox(false);
  }
  runEnvCheck(body, false);
}

function renderUsagePanel(body) {  body.innerHTML = `<div class="sp-section"><p class="hint" style="color:var(--faint)">${tr('usage.loading')}</p></div>`;
  api('GET', '/api/usage').then((u) => {
    const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(2) + ' M' : n >= 1e3 ? (n / 1e3).toFixed(1) + ' K' : String(n);
    const models = Object.entries(u.byModel).sort((a, b) => b[1] - a[1]);
    const maxModel = models.length ? models[0][1] : 1;
    const roles = Object.entries(u.byRole).sort((a, b) => b[1] - a[1]);
    const roleName = (rid) => { const r = state.roles.find((x) => x.id === rid); return r ? r.name : rid; };
    const days = Object.entries(u.byDay).sort((a, b) => a[0] < b[0] ? -1 : 1).slice(-14);
    const maxDay = Math.max(1, ...days.map(([, v]) => v.input + v.output));
    const none = `<p class="hint" style="color:var(--faint)">${tr('usage.none')}</p>`;
    body.innerHTML = `
      <div class="sp-section">
        <div class="usage-cards">
          <div class="usage-card"><div class="uc-num">${fmt(u.total.input + u.total.output)}</div><div class="uc-lbl">${tr('usage.totalTokens')}</div></div>
          <div class="usage-card"><div class="uc-num">${u.total.turns}</div><div class="uc-lbl">${tr('usage.totalTurns')}</div></div>
          <div class="usage-card"><div class="uc-num">${u.turnsToday}</div><div class="uc-lbl">${tr('usage.today')}</div></div>
          <div class="usage-card"><div class="uc-num">${u.turnsWeek}</div><div class="uc-lbl">${tr('usage.week')}</div></div>
        </div>
        <p class="hint" style="font-size:11.5px;color:var(--faint);margin-top:8px">${tr('usage.input')} ${fmt(u.total.input)}（${tr('usage.cached')} ${fmt(u.total.cached)}）· ${tr('usage.output')} ${fmt(u.total.output)}</p>
      </div>
      <div class="sp-section"><h4>${tr('usage.byModel')}</h4>
        ${models.length ? models.map(([mk, n]) => `
          <div class="usage-row"><span class="ur-name">${esc(mk)}</span>
            <div class="ur-bar"><div style="width:${Math.max(2, Math.round(n / maxModel * 100))}%"></div></div>
            <span class="ur-num">${fmt(n)}</span></div>`).join('') : none}
      </div>
      <div class="sp-section"><h4>${tr('usage.trend')}</h4>
        ${days.length ? `<div class="usage-days">${days.map(([day, v]) => `
          <div class="ud-col" title="${esc(day)}: ${v.input + v.output} tokens"><div class="ud-bar" style="height:${Math.max(3, Math.round((v.input + v.output) / maxDay * 90))}px"></div><span class="ud-lbl">${day.slice(5)}</span></div>`).join('')}</div>`
        : none}
      </div>
      <div class="sp-section"><h4>${tr('usage.byRole')}</h4>
        ${roles.length ? roles.map(([rid, n]) => `
          <div class="usage-row"><span class="ur-name">${esc(roleName(rid))}</span>
            <div class="ur-bar"><div style="width:${Math.max(2, Math.round(n / maxModel * 100))}%"></div></div>
            <span class="ur-num">${fmt(n)}</span></div>`).join('') : none}
      </div>`;
  });
}




// ---------- MCP 工具（独立面板，形态对齐技能：全局 / 角色专属 + 激活 + 绑定） ----------

// 新增 MCP 服务器弹窗：类型(stdio/http/sse)选择 + 动态字段；每次打开全清空、切换类型即清空另一侧，
// 不留预设/残留值（交互从"填什么"出发）。onSaved 回调刷新。
function mcpEditDialog(onSaved) {
  const mask = $('#mcpEditMask');
  const typeEl = $('#mcpType');
  const stdioFields = $('#mcpStdioFields');
  const remoteFields = $('#mcpRemoteFields');
  const reset = () => {
    $('#mcpName').value = ''; $('#mcpCommand').value = ''; $('#mcpArgs').value = ''; $('#mcpEnv').value = '';
    $('#mcpUrl').value = ''; $('#mcpHeaders').value = '';
    $('#mcpTestMsg').textContent = ''; $('#mcpTestMsg').style.color = '';
  };
  const syncType = () => {
    const t = typeEl.value;
    stdioFields.style.display = t === 'stdio' ? '' : 'none';
    remoteFields.style.display = t === 'stdio' ? 'none' : '';
  };
  reset();
  typeEl.value = 'stdio';
  syncType();
  // 绑定范围下拉：全局 + 各角色（动态）
  const scopeSel = $('#mcpScope');
  scopeSel.innerHTML = '<option value="global">' + tr('mcpX.scopeGlobal') + '</option>' +
    state.roles.map((r) => `<option value="role:${esc(r.id)}">${tr('mcpX.roleScope')} · ${esc(r.name)}</option>`).join('');
  const close = () => mask.classList.remove('show');
  $('#mcpEditClose').onclick = close;
  $('#mcpEditCancel').onclick = close;
  mask.onclick = (e) => { if (e.target === mask) close(); };
  typeEl.onchange = () => {
    syncType();
    // 切类型即清空另一侧字段，避免残留/误解
    if (typeEl.value === 'stdio') { $('#mcpUrl').value = ''; $('#mcpHeaders').value = ''; }
    else { $('#mcpCommand').value = ''; $('#mcpArgs').value = ''; $('#mcpEnv').value = ''; }
    $('#mcpTestMsg').textContent = ''; $('#mcpTestMsg').style.color = '';
  };
  const collect = () => {
    const sv = scopeSel.value;
    const [scope, roleId] = sv === 'global' ? ['global', null] : ['role', sv.slice(5)];
    const t = typeEl.value;
    const out = { name: $('#mcpName').value.trim(), type: t, scope, roleId };
    if (t === 'stdio') {
      out.command = $('#mcpCommand').value.trim();
      out.args = $('#mcpArgs').value.trim() ? $('#mcpArgs').value.trim().split(/\s+/) : [];
      out.env = Object.fromEntries($('#mcpEnv').value.split('\n').map((l) => {
        const i = l.indexOf('=');
        return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : null;
      }).filter(Boolean));
    } else {
      out.url = $('#mcpUrl').value.trim();
      out.headers = Object.fromEntries($('#mcpHeaders').value.split('\n').map((l) => {
        const i = l.indexOf(':');
        return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : null;
      }).filter(Boolean));
    }
    return out;
  };
  $('#mcpTestBtn').onclick = async () => {
    const c = collect();
    const msg = $('#mcpTestMsg');
    if (c.type !== 'stdio' && !c.url) { msg.textContent = tr('mcpX.testNeedUrl'); msg.style.color = 'var(--danger)'; return; }
    if (c.type === 'stdio' && !c.command) { msg.textContent = tr('mcpX.testNeedCmd'); msg.style.color = 'var(--danger)'; return; }
    msg.textContent = tr('mcpX.testing'); msg.style.color = '';
    const r = await api('POST', '/api/mcp/test', c);
    if (r.tools) { msg.textContent = tr('mcpX.connOk').replace('{n}', String(r.tools.length)) + r.tools.map((t) => t.name).slice(0, 6).join(', '); msg.style.color = 'var(--ok)'; }
    else { msg.textContent = '✗ ' + (r.error || tr('mcpX.connFail')); msg.style.color = 'var(--danger)'; }
  };
  $('#mcpEditSave').onclick = async () => {
    const c = collect();
    const r = await api('POST', '/api/mcp', c);
    if (r.error) { $('#mcpTestMsg').textContent = r.error; $('#mcpTestMsg').style.color = 'var(--danger)'; return; }
    close();
    if (onSaved) onSaved();
  };
  mask.classList.add('show');
}

function renderMcpPanel(body) {
  body.innerHTML = `
    <div class="skills-bar">
      <span class="sk-title">${tr('mcp.title')}</span>
      <button class="btn-outline" id="mcpAddBtn" style="display:inline-flex;align-items:center;gap:6px"><span class="ic" style="width:14px;height:14px">${ICONS.plus}</span>${tr('mcp.add')}</button>
    </div>
    <div class="sk-filter">
      <input class="sk-search" id="mcpSearch" placeholder="${tr('sk.searchPh')}">
      <select class="sk-role" id="mcpRole">
        <option value="all">${tr('sk.filterAll')}</option>
        <option value="global">${tr('skill.tagGlobal')}</option>
        ${state.roles.map((r) => `<option value="role:${esc(r.id)}">${esc(r.name)}</option>`).join('')}
      </select>
    </div>
    <div class="sk-act-note" id="mcpActiveNote"></div>
    <div id="mcpList"></div>
    <span id="mcpMsg" style="font-size:12px;color:var(--muted);display:block;margin-top:6px"></span>
    <p class="hint" style="font-size:11.5px;color:var(--faint);margin-top:10px">${tr('mcp.hint')}</p>`;
  $('#mcpAddBtn').addEventListener('click', () => mcpEditDialog(() => renderMcpPanel(body)));

  const listEl = $('#mcpList');
  const msgEl = $('#mcpMsg');
  const say = (txt, err) => { msgEl.textContent = txt; msgEl.style.color = err ? 'var(--danger)' : 'var(--muted)'; setTimeout(() => { msgEl.textContent = ''; }, 3500); };

  function cardHtml(s) {
    const bind = ['<option value="global"' + (s.scope === 'global' ? ' selected' : '') + '>' + tr('skill.tagGlobal') + '</option>']
      .concat(state.roles.map((r) => `<option value="role:${esc(r.id)}"${s.scope === 'role' && s.roleId === r.id ? ' selected' : ''}>${esc(r.name)}</option>`))
      .join('');
    const desc = (s.type === 'http' || s.type === 'sse')
      ? `[${s.type === 'http' ? 'Streamable HTTP' : 'SSE'}] ${s.url || ''}`
      : [s.command, (s.args || []).join(' ')].filter(Boolean).join(' ');
    return `<div class="skill-card mcp-card${s.active ? '' : ' off'}" data-id="${esc(s.id)}">
      <div class="skill-head">
        <span class="ic skill-ic">${ICONS.ops}</span>
        <div class="skill-meta">
          <div class="skill-name"><span class="nm">${esc(s.name)}</span><span class="skill-tag">${s.scope === 'global' ? tr('skill.tagGlobal') : tr('skill.tagRole')}</span></div>
          <div class="skill-desc mcp-desc" title="${esc(desc)}">${esc(desc)}</div>
        </div>
        <button class="skill-del" title="${tr('common.delete')}"><span class="ic">${ICONS.trash}</span></button>
      </div>
      <div class="skill-foot">
        <label class="skill-toggle"><span class="switch"><input type="checkbox" ${s.active ? 'checked' : ''}><span class="sl"></span></span><span class="sk-st">${s.active ? tr('skill.actOn') : tr('skill.actOff')}</span></label>
        <select class="skill-bind">${bind}</select>
      </div>
    </div>`;
  }

  // 名称搜索 + 按角色筛选
  const searchEl = $('#mcpSearch');
  const roleEl = $('#mcpRole');
  function matchItem(s, q, roleF) {
    const qq = (q || '').toLowerCase();
    const hay = ((s.name || '') + ' ' + (s.id || '')).toLowerCase();
    if (qq && !hay.includes(qq)) return false;
    if (roleF === 'global') return s.scope === 'global';
    if (roleF && roleF.indexOf('role:') === 0) return s.scope === 'role' && s.roleId === roleF.slice(5);
    return true;
  }

  function bindCards(view, all) {
    listEl.querySelectorAll('.skill-card').forEach((card) => {
      const id = card.dataset.id;
      const s = all.find((x) => x.id === id) || view.find((x) => x.id === id);
      const act = card.querySelector('input[type=checkbox]');
      const st = card.querySelector('.sk-st');
      const bind = card.querySelector('.skill-bind');
      act.addEventListener('change', async () => {
        await api('PATCH', '/api/mcp/' + id, { active: act.checked });
        st.textContent = act.checked ? tr('skill.actOn') : tr('skill.actOff');
        card.classList.toggle('off', !act.checked);
        s.active = act.checked;
        const n2 = $('#mcpActiveNote');
        if (n2) n2.textContent = tr('mcp.note').replace('{a}', String(all.filter((x) => x.active).length)).replace('{t}', String(all.length));
      });
      bind.addEventListener('change', async () => {
        const v = bind.value;
        const [scope, rid] = v === 'global' ? ['global', null] : ['role', v.slice(5)];
        await api('PATCH', '/api/mcp/' + id, { scope, roleId: rid });
        card.querySelector('.skill-tag').textContent = scope === 'global' ? tr('skill.tagGlobal') : tr('skill.tagRole');
        s.scope = scope; s.roleId = rid;
        paint(lastServers);
      });
      card.querySelector('.skill-del').addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await uiDialog({ title: tr('mcp.delTitle'), message: tr('mcp.delMsg').replace('{n}', s.name), buttons: [{ label: tr('common.delete'), value: true, danger: true, primary: true }] });
        if (!ok) return;
        await api('DELETE', '/api/mcp/' + id);
        load();
      });
    });
  }

  function paint(all) {
    const note = $('#mcpActiveNote');
    const active = all.filter((s) => s.active).length;
    if (note) note.textContent = all.length ? tr('mcp.note').replace('{a}', String(active)).replace('{t}', String(all.length)) : '';
    const q = (searchEl.value || '').trim().toLowerCase();
    const roleF = roleEl.value;
    const view = all.filter((s) => matchItem(s, q, roleF));
    if (!all.length) { listEl.innerHTML = '<div class="sk-empty">' + tr('mcp.empty') + '</div>'; return; }
    if (!view.length) { listEl.innerHTML = '<div class="sk-empty">' + tr('mcp.noMatch') + '</div>'; return; }
    listEl.innerHTML = view.map(cardHtml).join('');
    bindCards(view, all);
  }

  let lastServers = [];
  async function load() {
    const r = await api('GET', '/api/mcp');
    lastServers = (r && r.servers) || [];
    paint(lastServers);
  }
  searchEl.addEventListener('input', () => paint(lastServers));
  roleEl.addEventListener('change', () => paint(lastServers));
  load();
}

// ---------- 全局提示词 + 全局记忆 ----------

function renderPromptPanel(body) {
  body.innerHTML = `
    <div class="sp-section"><div class="sec-head"><h4>${tr('prompt.title')}</h4><button class="polish-btn" id="polishAgents"><span class="ic">${ICONS.spark}</span>${tr('common.polish')}</button></div>
      <p class="hint" style="margin:0 0 10px;color:var(--faint);font-size:11.5px">${tr('prompt.desc')}</p>
      <div class="sp-agents"><textarea id="spAgents" spellcheck="false"></textarea></div>
    </div>
    <div class="sp-actions"><span class="save-msg" id="spSaveMsg"></span>
      <button class="btn-accent" id="spSavePrompt">${tr('common.save')}</button></div>`;
  const boot = state.global || {};
  $('#spAgents').value = boot.agentsMd || '';
  $('#polishAgents').addEventListener('click', () => polishEditor($('#polishAgents'), $('#spAgents'), $('#spSaveMsg')));
  $('#spSavePrompt').addEventListener('click', async () => {
    await api('PUT', '/api/settings', { agentsMd: $('#spAgents').value });
    state.global = { ...state.global, agentsMd: $('#spAgents').value };
    flash('✓ ' + tr('common.save'), 'spSaveMsg');
  });
}

// ---------- 记忆（全局 + 各角色）：内容区可折叠 ----------

function renderMemoryPanel(body) {
  body.innerHTML = `
    <div class="sp-section" style="padding-top:2px">
      <div class="mem-item" data-acc="global">
        <div class="mem-head" data-acc-head>
          <span class="mem-caret">▸</span><b>${tr('memory.global')}</b><em>${tr('memory.globalShared')}</em>
        </div>
        <div class="mem-body">
          <textarea id="memGlobal" class="mem-ta" spellcheck="false" placeholder="${tr('memory.globalPh')}"></textarea>
          <div class="mem-actions"><span class="save-msg" id="memGlobalMsg"></span>
            <button class="btn-accent" id="memGlobalSave">${tr('common.save')}</button></div>
        </div>
      </div>
      <p class="mem-sub">${tr('memory.roleSub')}</p>
      <div id="memRoleList"></div>
    </div>`;
  $('#memGlobal').value = ((state.global && state.global.memory) || '');
  $('#memGlobalSave').addEventListener('click', async () => {
    await api('PUT', '/api/settings', { global: { memory: $('#memGlobal').value } });
    state.global = { ...(state.global || {}), memory: $('#memGlobal').value };
    flash('✓ ' + tr('common.save'), 'memGlobalMsg');
  });
  const list = $('#memRoleList');
  if (!state.roles.length) { list.innerHTML = `<p class="hint" style="font-size:12px;color:var(--faint)">${tr('memory.noneRole')}</p>`; return; }
  list.innerHTML = state.roles.map((r) => `
    <div class="mem-item" data-rid="${esc(r.id)}">
      <div class="mem-head" data-acc-head>
        <span class="mem-caret">▸</span><span class="ic rico">${ICONS[r.icon] || ICONS.coder}</span><b>${esc(r.name)}</b>
      </div>
      <div class="mem-body">
        <textarea class="mem-ta" data-ta="1" spellcheck="false" style="min-height:90px" placeholder="${tr('memory.rolePh')}"></textarea>
        <div class="mem-actions"><span class="save-msg" data-msg="1"></span>
          <button class="btn-accent" data-save="1">${tr('common.save')}</button></div>
      </div>
    </div>`).join('');
  body.querySelectorAll('[data-acc-head]').forEach((h) => h.addEventListener('click', () => h.closest('.mem-item').classList.toggle('open')));
  list.querySelectorAll('.mem-item').forEach((card) => {
    const rid = card.dataset.rid;
    const ta = card.querySelector('textarea[data-ta="1"]');
    const msgEl = card.querySelector('[data-msg="1"]');
    const role = state.roles.find((x) => x.id === rid);
    ta.value = (role && role.memory) || '';
    card.querySelector('[data-save="1"]').addEventListener('click', async () => {
      await api('PUT', '/api/roles/' + rid, { memory: ta.value });
      if (role) role.memory = ta.value;
      msgEl.textContent = '✓ ' + tr('common.save');
      setTimeout(() => { msgEl.textContent = ''; }, 2000);
    });
  });
}

// ---------- 角色管理 ----------

function renderRolesPanel(body) {
  let html = `<div class="sp-section"><h4>${tr('roles.h4')}</h4><p class="mem-sub">${tr('roles.intro')}</p>`;
  for (const role of state.roles) {
    html += `<div class="role-card" data-rid="${esc(role.id)}">
      <div class="rc-h">
        <span class="ic rc-icon">${ICONS[role.icon] || ICONS.coder}</span>
        <div class="rc-meta">
          <div class="rc-name">${esc(role.name)}</div>
          <div class="rc-sub">${esc(role.description || '')}</div>
        </div>
        <div class="rc-ops">
          <span class="rc-op" data-edit title="${tr('roles.edit')}"><span class="ic">${ICONS.edit}</span></span>
          <span class="rc-op del" data-del title="${tr('roles.delete')}"><span class="ic">${ICONS.trash}</span></span>
        </div>
      </div>
      <div class="rc-b"></div></div>`;
  }
  html += `<button class="add-role" id="spAddRole"><span class="ic" style="display:inline-flex;width:14px;height:14px;vertical-align:-2px">${ICONS.plus}</span>${tr('roles.add')}</button></div>`;
  body.innerHTML = html;
  body.querySelectorAll('.role-card').forEach((card) => {
    card.querySelector('.rc-h').addEventListener('click', (e) => {
      if (e.target.closest('.rc-op')) return;
      card.classList.toggle('open');
      if (card.classList.contains('open') && !card._loaded) { card._loaded = true; loadRoleEditor(card); }
    });
    const editBtn = card.querySelector('[data-edit]');
    if (editBtn) editBtn.addEventListener('click', () => { card.classList.add('open'); loadRoleEditor(card); });
    const delBtn = card.querySelector('[data-del]');
    if (delBtn) delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const rid = card.dataset.rid;
      const okDel = await uiDialog({ title: tr('roles.delTitle'), message: `${tr('roles.delQ')}「${rid}」？\n${tr('roles.delWarn')}`, buttons: [{ label: tr('common.cancel'), value: null }, { label: tr('roles.delete'), value: true, danger: true }] });
      if (!okDel) return;
      let deleteSkills = false;
      try {
        const sr = await api('GET', '/api/skills');
        const n = ((sr && sr.skills) || []).filter((s) => s.scope === 'role' && s.roleId === rid).length;
        if (n > 0) {
          deleteSkills = await uiDialog({ title: tr('roles.skillTitle'), message: tr('roles.skillMsg').replace('{n}', String(n)), buttons: [{ label: tr('roles.skillKeep'), value: false }, { label: tr('roles.skillDel'), value: true, danger: true }] });
        }
      } catch {}
      await api('DELETE', '/api/roles/' + rid + (deleteSkills ? '?deleteSkills=1' : ''));
      await refreshBootstrap();
      renderRolesPanel(body);
    });
  });
  $('#spAddRole').addEventListener('click', () => newRoleForm(body));
}

// ---------- 技能管理 ----------

function renderSkillsPanel(body) {
  body.innerHTML = `
    <div class="skills-bar">
      <span class="sk-title">${tr('skill.bar')}</span>
      <div class="import-menu" id="skillImportWrap">
        <button class="btn-outline" id="skillImportBtn" style="display:inline-flex;align-items:center;gap:6px"><span class="ic" style="width:14px;height:14px">${ICONS.plus}</span>${tr('skill.import')}</button>
        <div class="im-list" id="skillImportMenu">
          <button class="im-item" data-im="folder"><span class="ic">${ICONS.file}</span>${tr('skill.importFolder')}</button>
          <button class="im-item" data-im="zip"><span class="ic">${ICONS.doc}</span>${tr('skill.importZip')}</button>
        </div>
      </div>
    </div>
    <div class="sk-filter">
      <input class="sk-search" id="skillSearch" placeholder="${tr('sk.searchPh')}">
      <select class="sk-role" id="skillRole">
        <option value="all">${tr('sk.filterAll')}</option>
        <option value="global">${tr('skill.tagGlobal')}</option>
        ${state.roles.map((r) => `<option value="role:${esc(r.id)}">${esc(r.name)}</option>`).join('')}
      </select>
    </div>
    <div class="sk-act-note" id="skillActiveNote"></div>
    <div id="skillList"></div>
    <input type="file" id="skillZipInput" hidden accept=".zip">
    <input type="file" id="skillDirInput" hidden webkitdirectory>
    <span id="skillMsg" style="font-size:12px;color:var(--muted);display:block;margin-top:6px"></span>`;

  const listEl = $('#skillList');
  const msgEl = $('#skillMsg');
  const say = (txt, err) => { msgEl.textContent = txt; msgEl.style.color = err ? 'var(--danger)' : 'var(--muted)'; setTimeout(() => { msgEl.textContent = ''; }, 3500); };

  function renderActiveNote(sk) {
    const note = $('#skillActiveNote');
    if (!note) return;
    const total = (sk || []).length;
    const active = (sk || []).filter((s) => s.active).length;
    note.className = 'sk-act-note';
    note.textContent = total ? tr('skill.activeNote').replace('{a}', String(active)).replace('{t}', String(total)) : '';
  }

  function cardHtml(s) {
    const bind = ['<option value="global"' + (s.scope === 'global' ? ' selected' : '') + '>' + tr('skill.tagGlobal') + '</option>']
      .concat(state.roles.map((r) => `<option value="role:${esc(r.id)}"${s.scope === 'role' && s.roleId === r.id ? ' selected' : ''}>${esc(r.name)}</option>`))
      .join('');
    return `<div class="skill-card${s.active ? '' : ' off'}" data-id="${esc(s.id)}">
      <div class="skill-head">
        <span class="ic skill-ic">${ICONS.spark}</span>
        <div class="skill-meta">
          <div class="skill-name"><span class="nm">${esc(s.name)}</span><span class="skill-tag">${s.scope === 'global' ? tr('skill.tagGlobal') : tr('skill.tagRole')}</span></div>
          <div class="skill-desc" title="${esc(s.description || '')}">${esc(s.description || '')}</div>
        </div>
        <button class="skill-del" title="${tr('common.delete')}"><span class="ic">${ICONS.trash}</span></button>
      </div>
      <div class="skill-foot">
        <label class="skill-toggle"><span class="switch"><input type="checkbox" ${s.active ? 'checked' : ''}><span class="sl"></span></span><span class="sk-st">${s.active ? tr('skill.actOn') : tr('skill.actOff')}</span></label>
        <select class="skill-bind">${bind}</select>
      </div>
    </div>`;
  }

  // 名称搜索 + 按角色筛选
  const searchEl = $('#skillSearch');
  const roleEl = $('#skillRole');
  function matchItem(s, q, roleF) {
    const qq = (q || '').toLowerCase();
    const hay = ((s.name || '') + ' ' + (s.id || '')).toLowerCase();
    if (qq && !hay.includes(qq)) return false;
    if (roleF === 'global') return s.scope === 'global';
    if (roleF && roleF.indexOf('role:') === 0) return s.scope === 'role' && s.roleId === roleF.slice(5);
    return true;
  }

  function bindCards(view, all) {
    listEl.querySelectorAll('.skill-card').forEach((card) => {
      const id = card.dataset.id;
      const s = all.find((x) => x.id === id) || view.find((x) => x.id === id);
      const act = card.querySelector('input[type=checkbox]');
      const st = card.querySelector('.sk-st');
      const bind = card.querySelector('.skill-bind');
      act.addEventListener('change', async () => {
        await api('PATCH', '/api/skills/' + id, { active: act.checked });
        st.textContent = act.checked ? tr('skill.actOn') : tr('skill.actOff');
        card.classList.toggle('off', !act.checked);
        s.active = act.checked;
        renderActiveNote(all);
      });
      bind.addEventListener('change', async () => {
        const v = bind.value; // 'global' | 'role:<id>'
        const patch = v === 'global' ? { scope: 'global', roleId: null } : { scope: 'role', roleId: v.slice(5) };
        await api('PATCH', '/api/skills/' + id, patch);
        const tag = card.querySelector('.skill-tag');
        tag.textContent = v === 'global' ? tr('skill.tagGlobal') : tr('skill.tagRole');
        // 同步内存态，便于筛选切换后立即正确
        s.scope = patch.scope; s.roleId = patch.roleId;
        paint(lastSkills);
      });
      card.querySelector('.skill-del').addEventListener('click', async () => {
        const okDel = await uiDialog({ title: tr('skill.delSkillTitle'), message: tr('skill.delSkillMsg').replace('{n}', s.name), buttons: [{ label: tr('common.cancel'), value: null }, { label: tr('common.delete'), value: true, danger: true }] });
        if (!okDel) return;
        const r = await api('DELETE', '/api/skills/' + id);
        if (r && r.error) say(r.error, true); else { say(tr('skill.deleted')); load(); }
      });
    });
  }

  function paint(all) {
    const q = (searchEl.value || '').trim().toLowerCase();
    const roleF = roleEl.value;
    const view = all.filter((s) => matchItem(s, q, roleF));
    if (!all.length) { listEl.innerHTML = '<div class="sk-empty">' + tr('skill.empty') + '</div>'; return; }
    if (!view.length) { listEl.innerHTML = '<div class="sk-empty">' + tr('sk.noMatch') + '</div>'; return; }
    listEl.innerHTML = view.map(cardHtml).join('');
    bindCards(view, all);
  }

  let lastSkills = [];
  async function load() {
    const r = await api('GET', '/api/skills');
    lastSkills = (r && r.skills) || [];
    renderActiveNote(lastSkills);
    paint(lastSkills);
  }
  searchEl.addEventListener('input', () => paint(lastSkills));
  roleEl.addEventListener('change', () => paint(lastSkills));

  // 导入
  const menu = $('#skillImportMenu');
  $('#skillImportBtn').addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('show'); });
  document.addEventListener('click', () => menu.classList.remove('show'));
  menu.querySelectorAll('.im-item').forEach((it) => it.addEventListener('click', (e) => {
    e.stopPropagation(); menu.classList.remove('show');
    if (it.dataset.im === 'zip') $('#skillZipInput').click();
    else $('#skillDirInput').click();
  }));

  $('#skillZipInput').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    const dataUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
    const r = await api('POST', '/api/skills/import', { zipBase64: dataUrl.split(',')[1] });
    reportImport(r);
  });
  $('#skillDirInput').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []); e.target.value = '';
    if (!files.length) return;
    const items = [];
    for (const f of files) {
      const dataUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
      items.push({ path: f.webkitRelativePath || f.name, base64: dataUrl.split(',')[1] });
    }
    const r = await api('POST', '/api/skills/import-folder', { files: items });
    reportImport(r);
  });

  function reportImport(r) {
    if (!r) { say(tr('skill.importFail'), true); return; }
    if (r.error) { say('✗ ' + r.error, true); return; }
    const imp = (r.imported || []).length, inv = (r.invalid || []).length;
    let txt = tr('skill.impOk').replace('{n}', String(imp));
    if (inv) txt += tr('skill.impInvalid').replace('{m}', String(inv));
    say(txt, !!inv);
    load();
  }

  load();
}

async function loadRoleEditor(card) {
  const rid = card.dataset.rid;
  const role = state.roles.find((r) => r.id === rid);
  if (!role) return;
  const bp = card.querySelector('.rc-b');
  bp.innerHTML = roleEditorHtml(role, role.soul || role.agents || '');
  wireRoleEditor(bp, role);
}

function roleEditorHtml(role, agentsText) {
  return `<div class="role-editor">
    <div class="fields">
      <div><label>${tr('editor.name')}</label><input type="text" id="re_name" value="${esc(role.name)}"></div>
      <div><label>${tr('editor.icon')}</label><select id="re_icon">${ROLE_ICON_KEYS.map((i) => `<option value="${i}" ${role.icon === i ? 'selected' : ''}>${i}</option>`).join('')}</select></div>
      <div class="full"><label>${tr('editor.desc')}</label><input type="text" id="re_desc" value="${esc(role.description || '')}"></div>
      <div class="full"><div class="seclabel"><label style="flex:1">${tr('editor.soul')}</label><button type="button" class="polish-btn" id="rePolish"><span class="ic">${ICONS.spark}</span>${tr('common.polish')}</button></div><textarea id="re_agents">${esc(agentsText)}</textarea></div>
    </div>
    <div class="actions">
      <span class="save-msg" id="reMsg"></span>
      <button class="btn" id="reCancel">${tr('common.cancel')}</button>
      <button class="btn-accent" id="reSave">${tr('editor.saveRole')}</button>
    </div></div>`;
}

function wireRoleEditor(bp, role) {
  const cancel = bp.querySelector('#reCancel');
  if (cancel) cancel.addEventListener('click', () => bp.closest('.role-card').classList.remove('open'));
  const polish = bp.querySelector('#rePolish');
  if (polish) polish.addEventListener('click', () => polishEditor(polish, bp.querySelector('#re_agents'), bp.querySelector('#reMsg')));
  bp.querySelector('#reSave').addEventListener('click', async () => {
    const nextRole = {
      name: bp.querySelector('#re_name').value,
      icon: bp.querySelector('#re_icon').value,
      description: bp.querySelector('#re_desc').value,
    };
    const soul = bp.querySelector('#re_agents').value;
    await api('PUT', '/api/roles/' + role.id, { role: nextRole, soul });
    await refreshBootstrap();
    renderRolesPanel($('#smBody'));
    renderSidebar();
  });
}

function newRoleForm(body) {
  const html = `<div class="role-editor" style="border:1px dashed var(--faint);border-radius:10px;padding:12px">
      <h4 style="margin:0 0 8px">${tr('editor.newRoleTitle')}</h4>
      <div class="fields">
        <div><label>${tr('editor.name')}</label><input type="text" id="nr_name" placeholder="${tr('editor.namePh')}" autocomplete="off"></div>
        <div><label>${tr('editor.icon')}</label><select id="nr_icon">${ROLE_ICON_KEYS.map((i) => `<option value="${i}">${i}</option>`).join('')}</select></div>
        <div class="full"><label>${tr('editor.desc')}</label><input type="text" id="nr_desc" placeholder="${tr('editor.descPh')}"></div>
        <div class="full"><div class="seclabel"><label style="flex:1">${tr('editor.agents')}</label><button type="button" class="polish-btn" id="nrPolish"><span class="ic">${ICONS.spark}</span>${tr('common.polish')}</button></div><textarea id="nr_agents" placeholder="${tr('editor.agentsPh')}"></textarea></div>
      </div>
      <div class="actions"><span class="save-msg" id="nrMsg" style="color:var(--danger)"></span>
        <button class="btn" id="nrCancel">${tr('common.cancel')}</button>
        <button class="btn-accent" id="nrSave">${tr('editor.createRole')}</button></div>
    </div>`;
  const holder = document.createElement('div');
  holder.className = 'sp-section add-role-form';
  holder.style.marginTop = '14px';
  holder.innerHTML = html;
  body.appendChild(holder);
  // 默认预填角色提示词骨架模板（含各模块标题，用户改写后可直接 AI 润色）
  holder.querySelector('#nr_agents').value = roleAgentsDefault();
  holder.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const done = () => { holder.remove(); };
  holder.querySelector('#nrCancel').addEventListener('click', done);
  const nrPolish = holder.querySelector('#nrPolish');
  if (nrPolish) nrPolish.addEventListener('click', () => polishEditor(nrPolish, holder.querySelector('#nr_agents'), holder.querySelector('#nrMsg')));
  holder.querySelector('#nr_name').focus();
  holder.querySelector('#nrSave').addEventListener('click', async () => {
    const name = holder.querySelector('#nr_name').value.trim();
    if (!name) {
      holder.querySelector('#nrMsg').textContent = tr('editor.needName');
      return;
    }
    // ID 系统自动生成（r + 随机串）：满足路径安全校验且天然防重复，用户只认名称
    const id = 'r' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
    await api('POST', '/api/roles', {
      id,
      name,
      icon: holder.querySelector('#nr_icon').value,
      description: holder.querySelector('#nr_desc').value.trim(),
      soul: holder.querySelector('#nr_agents').value,
    });
    done();
    await refreshBootstrap();
    renderRolesPanel($('#smBody'));
    renderSidebar();
  });
}

// 刷新角色 / 全局配置到 state（settings 变更后同步前端展示用）
async function refreshBootstrap() {
  const boot = await api('GET', '/api/bootstrap');
  state.roles = boot.roles;
  state.global = boot.global || {};
  state.settings = boot.global.settings || null;
  state.platform = boot.platform || null;
  renderTopbar();
}

function flash(msg, id) {
  const el = $('#' + id);
  if (!el) return;
  el.textContent = msg;
  setTimeout(() => { el.textContent = ''; }, 2500);
}

// 本地 CSS 对话框（替代浏览器原生 confirm/alert/prompt），Promise<value|null>
let pendingDialog = null;   // 同一时刻只允许一个系统对话框（重入会把前一个 Promise 悬挂住）
function uiDialog({ title = '', message = '', buttons = [] } = {}) {
  // 前一个还没答完 → 先按"取消"收尾，再显示新的（否则旧 Promise 永不 resolve，监听器泄漏）
  if (pendingDialog) { try { pendingDialog(null); } catch {} }
  return new Promise((resolve) => {
    const mask = $('#dlgMask');
    const t = $('#dlgTitle');
    const b = $('#dlgBody');
    const a = $('#dlgActions');
    if (!mask) { resolve(null); return; }
    // 兜底复位：无论此前是否残留，先保证遮罩显示、内容干净
    t.textContent = title;
    b.textContent = message;
    a.innerHTML = '';
    const done = (v) => {
      mask.classList.remove('show');
      mask.onclick = null;
      document.removeEventListener('keydown', onKey);
      if (pendingDialog === done) pendingDialog = null;
      resolve(v);
    };
    pendingDialog = done;
    const onKey = (e) => { if (e.key === 'Escape') done(null); };
    // 点击遮罩（对话框外部）等价于取消，避免界面被遮罩挡住“卡住”
    mask.onclick = (e) => { if (e.target === mask) done(null); };
    const mk = (label, cls, value) => {
      const btn = document.createElement('button');
      btn.className = 'dlg-btn' + (cls ? ' ' + cls : '');
      btn.textContent = label;
      btn.addEventListener('click', (e) => { e.stopPropagation(); done(value); });
      a.appendChild(btn);
    };
    for (const bt of buttons) {
      const cls = [bt.danger ? 'danger' : '', bt.primary ? 'primary' : ''].filter(Boolean).join(' ');
      mk(bt.label, cls || undefined, bt.value);
    }
    if (!buttons.some((bt) => bt.value === null)) mk(tr('common.cancel'), '', null);
    document.addEventListener('keydown', onKey);
    mask.classList.add('show');
  });
}

/* ---------- AI 润色（用当前启用主模型改写提示词） ---------- */
async function polishEditor(btn, ta, statusEl) {
  const txt = (ta.value || '').trim();
  if (!txt) { if (statusEl) { statusEl.textContent = tr('polish.empty'); statusEl.style.color = 'var(--danger)'; setTimeout(() => { statusEl.textContent = ''; }, 2000); } return; }
  const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin-sm"></span>' + tr('polish.polishing');
  if (statusEl) { statusEl.textContent = ''; }
  try {
    const r = await api('POST', '/api/polish', { text: txt });
    if (r && r.polished) {
      ta.value = r.polished;
      if (statusEl) { statusEl.textContent = tr('polish.doneCheck'); statusEl.style.color = 'var(--ok)'; }
      else { flash(tr('polish.done'), 'reMsg'); }
    } else {
      const msg = (r && r.error) || tr('polish.fail');
      if (statusEl) { statusEl.textContent = '✗ ' + msg; statusEl.style.color = 'var(--danger)'; setTimeout(() => { statusEl.textContent = ''; }, 3000); }
      else flash('✗ ' + msg, 'reMsg');
    }
  } catch (e) {
    const msg = tr('polish.failColon') + (e.message || e);
    if (statusEl) { statusEl.textContent = '✗ ' + msg; statusEl.style.color = 'var(--danger)'; }
    else flash('✗ ' + msg, 'reMsg');
  }
  btn.disabled = false; btn.innerHTML = old;
}

/* ---------- 启动 ---------- */

(async function init() {
  const boot = await api('GET', '/api/bootstrap');
  state.roles = boot.roles;
  state.global = boot.global || {};
  state.settings = (boot.global && boot.global.settings) || null;
  state.platform = boot.platform || null;
  initTheme(); // 应用主题偏好（浅色/深色/跟随系统）
  initI18n(); // 应用界面语言（中文/English）
  await refreshSessions();
  loadSkills();
  renderSidebar(); renderTopbar(); renderFeed();
  setAgentStatus('ready');
  connectSSE();
  // Windows 沙箱：首次查询 + 横幅按钮（非 win32 时 refreshSandbox 直接返回）
  const sbSetup = $('#sandboxBannerSetup');
  if (sbSetup) sbSetup.addEventListener('click', async () => {
    sbSetup.disabled = true; sbSetup.textContent = tr('env.sandboxInitRunning');
    await startSandboxSetup();
    sbSetup.disabled = false; sbSetup.textContent = tr('env.sandboxInit');
  });
  const sbClose = $('#sandboxBannerClose');
  if (sbClose) sbClose.addEventListener('click', () => {
    state.sandboxDismissed = (state.sandbox && state.sandbox.readiness && state.sandbox.readiness.status) || 'unknown';
    renderSandboxBanner();
  });
  refreshSandbox(false);

  // 发送 / 停止复用同一按钮：任务运行时显示「■ 停止」
  // 发送与停止彻底分离：运行时点「发送」= 排队（旧版同一个按钮，误点即打断整轮工作）
  $('#sendBtn').addEventListener('click', () => send());
  $('#stopBtn').addEventListener('click', () => stopCurrent());
  const ctxEl = $('#ctxHint');
  if (ctxEl) ctxEl.addEventListener('click', () => compactContext());
  // 会话目标：◎ 按钮 = 打开目标栏编辑态（无目标时用于手动新建）
  const goalEl = $('#goalBtn');
  if (goalEl) goalEl.addEventListener('click', () => openGoalEditor());
  // 子代理面板：表头折叠 / 停止本回合（含子代理）/ 清空已完成
  const subHead = $('#subHead');
  if (subHead) subHead.addEventListener('click', (e) => {
    if (e.target && e.target.closest && e.target.closest('button')) return;   // 点按钮不算折叠
    state.subOpen = !state.subOpen;
    renderSubPanel();
  });
  const subStopEl = $('#subStop');
  if (subStopEl) subStopEl.addEventListener('click', () => stopCurrent());
  const subClearEl = $('#subClear');
  if (subClearEl) subClearEl.addEventListener('click', () => clearFinishedSubagents());
  renderSubPanel();
  $('#input').addEventListener('keydown', (e) => {
    // 指令面板打开时接管方向键/Tab/Enter/Esc（对齐 dsh 的命令面板交互）
    const box = $('#cmdPicker');
    const pickerOpen = box && !box.hidden;
    if (pickerOpen) {
      const items = [...box.querySelectorAll('.cmd-item')];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        cmdActive = (cmdActive + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items.forEach((el, i) => el.classList.toggle('active', i === cmdActive));
        scrollCmdIntoView(items[cmdActive]);
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); box.hidden = true; cmdActive = -1; return; }
      // 回车 = 面板唯一的确认键，且**直接发送**：发送的就是当前高亮项（上下键选中的那条），
      // 不再"先填进输入框再按一次"。带参数时把参数一起带上（此时面板通常已因空格关闭）。
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        const active = items[cmdActive] || items[0];     // ⚠️ 先取高亮项，再复位 cmdActive
        const activeName = active ? active.dataset.name : null;
        const typed = parseCommand(e.currentTarget.value);
        const arg = typed && typed.name === activeName ? typed.arg : '';
        box.hidden = true; cmdActive = -1;
        if (activeName) e.currentTarget.value = '/' + activeName + (arg ? ' ' + arg : '');
        send();
        return;
      }
    }
    // 输入法组合中按 Enter（选词/上屏）不触发发送：isComposing 为标准判据，keyCode 229 兜底旧引擎
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); send(); }
  });
  $('#input').addEventListener('input', () => { cmdActive = 0; renderCmdPicker(); });
  // 上传附件
  $('#attachBtn').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', (e) => {
    pickAttachments(e.target.files);
    e.target.value = ''; // 允许重复选同一文件
  });
  // 会话技能选用
  $('#skillBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleSkillPicker(); });
  // 会话模式选择：按钮开合浮层，点选项即切（零监管高危需确认）
  const modeBtn = $('#modeBtn'), modePop = $('#modePop');
  modeBtn.addEventListener('click', (e) => { e.stopPropagation(); if (!state.currentSession) return; syncModeUI(); modePop.classList.toggle('show'); });
  document.addEventListener('click', (e) => { if (!modePop.contains(e.target)) modePop.classList.remove('show'); });
  modePop.querySelectorAll('.mode-opt').forEach((opt) => {
    opt.addEventListener('click', async () => {
      if (!state.currentSession) return;
      const mode = opt.dataset.mode;
      if (mode === 'free' && currentMode() !== 'free') {
        const ok = await uiDialog({
          title: tr('mode.free') + ' — ' + tr('dial.hint'),
          message: tr('free.confirm'),
          buttons: [{ label: tr('free.enable'), value: true, danger: true, primary: true }],
        });
        if (!ok) return;
      }
      const p = modePolicy(mode);
      state.currentSession.planMode = p.planMode;
      state.currentSession.sandbox = p.sandbox;
      state.currentSession.approval = p.approval;
      syncModeUI();
      modePop.classList.remove('show');
    });
  });
  // 新会话：不再用默认角色——点开角色选择器；无角色时引导去创建
  $('#newChat').addEventListener('click', (e) => { e.stopPropagation(); openRolePicker(); });
  // 侧栏收起：顶部按钮收起；收起后点 logo 展开（logo 悬停会变成"展开"图标）
  const sbToggle = $('#sidebarToggle');
  if (sbToggle) sbToggle.addEventListener('click', (e) => { e.stopPropagation(); toggleSidebar(); });
  const sbLogo = $('#sidebarLogo');
  if (sbLogo) sbLogo.addEventListener('click', (e) => {
    e.stopPropagation();
    if (sidebarCollapsed()) applySidebarCollapsed(false);   // 展开态点 logo 不做事
  });
  applySidebarCollapsed(sidebarCollapsed());
  // 会话搜索（侧栏顶部输入框）
  const ss = $('#sessSearch'), ssClear = $('#sessSearchClear');
  if (ss) ss.addEventListener('input', () => {
    sessionQuery = ss.value;
    if (ssClear) ssClear.hidden = !ss.value.trim();
    renderSidebar();
  });
  if (ssClear) ssClear.addEventListener('click', () => {
    if (ss) { ss.value = ''; ss.focus(); }
    sessionQuery = '';
    ssClear.hidden = true;
    renderSidebar();
  });
  // 点外部任意处关闭角色选择器 / 技能选择器
  document.addEventListener('click', () => { closeRolePicker(); closeSkillPicker(); });
  $('#settingsBtn').addEventListener('click', () => openSettings('model'));
  $('#settingsClose').addEventListener('click', () => closeSettings());   // 不能直接传 closeSettings：事件对象会被当成 force 参数而跳过询问
  $('#settingsMask').addEventListener('click', (e) => { if (e.target === $('#settingsMask')) closeSettings(); });
  document.querySelectorAll('#smNav .sm-nav-item').forEach((it) => it.addEventListener('click', () => openSettings(it.dataset.nav)));
  // Esc×2（任务运行中，1.5s 内两次）停止当前任务
  let escCount = 0, escTimer = null;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeSettings(); closeRolePicker(); closeSkillPicker();
    if (!state.currentSession || !curBusy()) { escCount = 0; return; }
    escCount++;
    clearTimeout(escTimer);
    escTimer = setTimeout(() => { escCount = 0; }, 1500);
    if (escCount >= 2) { escCount = 0; clearTimeout(escTimer); stopCurrent(); }
  });
})();
